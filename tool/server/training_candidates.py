"""Read-only LoRA candidate analysis for one recorded training run."""

import math
import statistics
from pathlib import Path


ANALYSIS_VERSION = 1
DEFAULT_SCALAR_TAG = "train/epoch_loss"


def _median(values):
    return statistics.median(values) if values else 0.0


def _median_absolute_deviation(values):
    if not values:
        return 0.0
    center = _median(values)
    return _median([abs(value - center) for value in values])


def normalize_epoch_loss_events(events):
    """Return finite epoch-loss points, keeping the latest duplicate event."""
    by_epoch = {}
    for index, event in enumerate(events or []):
        try:
            epoch = int(event.step)
            loss = float(event.value)
            wall_time = float(event.wall_time)
        except (AttributeError, TypeError, ValueError):
            continue
        if epoch < 0 or not math.isfinite(loss) or not math.isfinite(wall_time):
            continue
        prior = by_epoch.get(epoch)
        rank = (wall_time, index)
        if prior is None or rank >= prior[0]:
            by_epoch[epoch] = (rank, loss)
    return [{"epoch": epoch, "loss": by_epoch[epoch][1]} for epoch in sorted(by_epoch)]


def read_epoch_loss_events(run_dir, scalar_tag=DEFAULT_SCALAR_TAG):
    """Read one scalar from TensorBoard without creating any derived data."""
    directory = Path(run_dir)
    event_files = [path for path in directory.iterdir() if path.is_file() and path.name.startswith("events.out.tfevents")]
    if not event_files:
        raise FileNotFoundError("No TensorBoard event files are available for this run.")
    try:
        from tensorboard.backend.event_processing.event_accumulator import EventAccumulator
    except ImportError as exc:
        raise RuntimeError("TensorBoard support is unavailable. Install the WebCap requirements.") from exc
    try:
        accumulator = EventAccumulator(str(directory), size_guidance={"scalars": 0})
        accumulator.Reload()
        tags = accumulator.Tags().get("scalars") or []
        if scalar_tag not in tags:
            raise ValueError("TensorBoard scalar " + scalar_tag + " is unavailable for this run.")
        points = normalize_epoch_loss_events(accumulator.Scalars(scalar_tag))
    except Exception as exc:
        if isinstance(exc, ValueError) and str(exc).startswith("TensorBoard scalar"):
            raise
        raise ValueError("Could not read TensorBoard event data for this run: " + str(exc)) from exc
    if not points:
        raise ValueError("TensorBoard scalar " + scalar_tag + " has no finite epoch-loss points.")
    return points


def smooth_epoch_loss_points(points, radius=2):
    """Small centered rolling median that preserves the app-shaped point format."""
    normalized = list(points or [])
    values = [float(point["loss"]) for point in normalized]
    result = []
    for index, point in enumerate(normalized):
        start = max(0, index - radius)
        end = min(len(values), index + radius + 1)
        result.append({"epoch": int(point["epoch"]), "loss": _median(values[start:end])})
    return result


def _noise_band(raw_points, smoothed_points):
    raw = [float(point["loss"]) for point in raw_points]
    smooth = [float(point["loss"]) for point in smoothed_points]
    residuals = [abs(raw[index] - smooth[index]) for index in range(len(raw))]
    deltas = [abs(smooth[index] - smooth[index - 1]) for index in range(1, len(smooth))]
    # The residual MAD absorbs noisy individual epochs; the small delta term
    # keeps perfectly smooth curves from treating every tiny movement as a basin.
    return max(_median_absolute_deviation(residuals) * 2.0, _median(deltas) * 0.25, 1e-12)


def _expand_basin(values, center, band):
    floor = values[center]
    start = center
    end = center
    while start > 0 and values[start - 1] <= floor + band:
        start -= 1
    while end + 1 < len(values) and values[end + 1] <= floor + band:
        end += 1
    return start, end


def _has_resolved_exit(values, end, floor, band):
    """A valley is confirmed only after the curve has clearly left it."""
    threshold = floor + band * 2.0
    return end + 2 < len(values) and values[end + 1] > threshold and values[end + 2] > threshold


def _has_isolated_raw_spike(raw_values, smooth_values, start, end, band):
    residuals = [abs(raw_values[index] - smooth_values[index]) for index in range(len(raw_values))]
    typical_residual = _median(residuals)
    limit = max(band * 6.0, typical_residual * 6.0, 1e-12)
    return any(smooth_values[index] - raw_values[index] > limit for index in range(start, end + 1))


def detect_loss_basins(points, smoothed_points):
    """Find broad, exited low-loss basins without using run-length gates or quotas."""
    if len(points) != len(smoothed_points) or len(points) < 3:
        return []
    raw_values = [float(point["loss"]) for point in points]
    values = [float(point["loss"]) for point in smoothed_points]
    band = _noise_band(points, smoothed_points)
    basins = []
    visited = set()
    for index, value in enumerate(values):
        if index == 0 or index + 1 == len(values):
            continue
        left = values[index - 1] if index else None
        right = values[index + 1] if index + 1 < len(values) else None
        if left is not None and value > left:
            continue
        if right is not None and value > right:
            continue
        start, end = _expand_basin(values, index, band)
        key = (start, end)
        if key in visited:
            continue
        visited.add(key)
        if end - start + 1 < 3:
            continue
        if _has_isolated_raw_spike(raw_values, values, start, end, band):
            continue
        floor_index = min(range(start, end + 1), key=lambda item: (values[item], item))
        floor = values[floor_index]
        if not _has_resolved_exit(values, end, floor, band):
            basins.append({
                "startEpoch": int(points[start]["epoch"]),
                "endEpoch": int(points[end]["epoch"]),
                "representativeEpoch": int(points[floor_index]["epoch"]),
                "confirmed": False,
            })
            continue
        basins.append({
            "startEpoch": int(points[start]["epoch"]),
            "endEpoch": int(points[end]["epoch"]),
            "representativeEpoch": int(points[floor_index]["epoch"]),
            "confirmed": True,
        })
    basins.sort(key=lambda basin: (basin["startEpoch"], basin["endEpoch"]))
    return basins


def artifact_for_epoch(run_dir, epoch):
    directory = Path(run_dir) / ("epoch" + str(int(epoch)))
    if not directory.is_dir() or directory.is_symlink():
        return {"available": False, "status": "not_saved"}
    files = sorted(path for path in directory.iterdir() if path.is_file() and path.suffix.lower() == ".safetensors")
    if len(files) == 1:
        return {"available": True, "status": "available", "fileName": files[0].name}
    if len(files) > 1:
        return {"available": False, "status": "ambiguous"}
    return {"available": False, "status": "not_saved"}


def analyze_epoch_loss_points(points, run_dir=None):
    """Pure curve analysis plus optional read-only artifact lookup."""
    normalized = [{"epoch": int(point["epoch"]), "loss": float(point["loss"])} for point in points]
    smoothed = smooth_epoch_loss_points(normalized)
    basins = detect_loss_basins(normalized, smoothed)
    candidates = []
    for basin in basins:
        if not basin["confirmed"]:
            continue
        candidate = {
            "epoch": basin["representativeEpoch"],
            "startEpoch": basin["startEpoch"],
            "endEpoch": basin["endEpoch"],
            "reason": "Stable valley with a sustained exit.",
            "artifact": artifact_for_epoch(run_dir, basin["representativeEpoch"]) if run_dir is not None else {"available": False, "status": "not_checked"},
        }
        candidates.append(candidate)
    return {
        "analysisVersion": ANALYSIS_VERSION,
        "scalarTag": DEFAULT_SCALAR_TAG,
        "points": normalized,
        "smoothedPoints": smoothed,
        "basins": basins,
        "candidates": candidates,
    }


def analyze_run_directory(run_dir):
    points = read_epoch_loss_events(run_dir)
    return analyze_epoch_loss_points(points, run_dir=run_dir)
