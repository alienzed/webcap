"""Read-only settled-region analysis for one recorded LoRA training run."""

import math
import re
import statistics
from pathlib import Path


ANALYSIS_VERSION = 3
DETAILED_LOSS_TAG = "train/loss"
EPOCH_LOSS_TAG = "train/epoch_loss"
_EPOCH_DIRECTORY_PATTERN = re.compile(r"^epoch(\d+)$")


def _median(values):
    return statistics.median(values) if values else 0.0


def normalize_scalar_events(events):
    """Keep finite scalar events, resolving duplicate scalar x values by latest wall time."""
    by_axis = {}
    for index, event in enumerate(events or []):
        try:
            axis, loss, wall_time = int(event.step), float(event.value), float(event.wall_time)
        except (AttributeError, TypeError, ValueError):
            continue
        if axis < 0 or not math.isfinite(loss) or not math.isfinite(wall_time):
            continue
        rank = (wall_time, index)
        if axis not in by_axis or rank >= by_axis[axis][0]:
            by_axis[axis] = (rank, loss)
    return [{"axis": axis, "loss": item[1], "wallTime": item[0][0], "order": item[0][1]} for axis, item in by_axis.items()]


def read_loss_events(run_dir):
    """Read the two required TensorBoard scalar streams without writing derived data."""
    directory = Path(run_dir)
    if not any(path.is_file() and path.name.startswith("events.out.tfevents") for path in directory.iterdir()):
        raise FileNotFoundError("No TensorBoard event files are available for this run.")
    try:
        from tensorboard.backend.event_processing.event_accumulator import EventAccumulator
    except ImportError as exc:
        raise RuntimeError("TensorBoard support is unavailable. Install the WebCap requirements.") from exc
    try:
        accumulator = EventAccumulator(str(directory), size_guidance={"scalars": 0})
        accumulator.Reload()
        tags = accumulator.Tags().get("scalars") or []
        missing = next((tag for tag in (DETAILED_LOSS_TAG, EPOCH_LOSS_TAG) if tag not in tags), "")
        if missing:
            raise ValueError("TensorBoard scalar " + missing + " is unavailable for this run.")
        detailed = normalize_scalar_events(accumulator.Scalars(DETAILED_LOSS_TAG))
        epoch = normalize_scalar_events(accumulator.Scalars(EPOCH_LOSS_TAG))
    except Exception as exc:
        if isinstance(exc, ValueError) and str(exc).startswith("TensorBoard scalar"):
            raise
        raise ValueError("Could not read TensorBoard event data for this run: " + str(exc)) from exc
    if not detailed:
        raise ValueError("TensorBoard scalar " + DETAILED_LOSS_TAG + " has no finite loss points.")
    if not epoch:
        raise ValueError("TensorBoard scalar " + EPOCH_LOSS_TAG + " has no finite epoch-loss points.")
    return detailed, epoch


def map_detailed_loss_to_epochs(detailed_events, epoch_events):
    """Assign each detailed event to its first epoch-completion boundary.

    Both streams are ordered by recorded wall time, not elapsed duration. An
    event tied to a completion belongs to that epoch; an event after the final
    completion belongs to the next, still-open epoch and is excluded from the
    completed-epoch analysis.
    """
    boundaries = sorted(epoch_events, key=lambda point: (point["wallTime"], point["axis"], point["order"]))
    detailed = sorted(detailed_events, key=lambda point: (point["wallTime"], point["axis"], point["order"]))
    result, boundary = [], 0
    for sample, point in enumerate(detailed):
        while boundary < len(boundaries) and boundaries[boundary]["wallTime"] < point["wallTime"]:
            boundary += 1
        epoch = boundaries[boundary]["axis"] if boundary < len(boundaries) else boundaries[-1]["axis"] + 1
        result.append({"sample": sample, "epoch": int(epoch), "loss": float(point["loss"])})
    return result


def aggregate_detailed_loss_by_epoch(mapped_points, completed_epochs):
    """Return one median detailed-loss value for each completed epoch with samples."""
    samples = {}
    for point in mapped_points:
        samples.setdefault(int(point["epoch"]), []).append(float(point["loss"]))
    result = []
    for epoch in sorted({int(point["axis"]) for point in completed_epochs}):
        if epoch in samples:
            result.append({"epoch": epoch, "loss": _median(samples[epoch])})
    return result


def _centered_median(points, radius=1):
    values = [float(point["loss"]) for point in points]
    result = []
    for index, point in enumerate(points):
        result.append({"epoch": int(point["epoch"]), "loss": _median(values[max(0, index - radius):min(len(values), index + radius + 1)])})
    return result


def _movement_scale(points):
    values = [float(point["loss"]) for point in points]
    movements = [abs(values[index] - values[index - 1]) for index in range(1, len(values))]
    nonzero = [value for value in movements if value > 0]
    return _median(nonzero) if nonzero else 0.0


def _settled_anchor_indexes(trend, scale):
    """Find local minima and locally flat points, excluding a steady descent."""
    values = [float(point["loss"]) for point in trend]
    if len(values) < 3 or scale <= 0:
        return []
    quiet = scale * 0.75
    anchors = []
    for index in range(1, len(values) - 1):
        local_minimum = values[index] <= values[index - 1] and values[index] <= values[index + 1]
        locally_flat = abs(values[index] - values[index - 1]) <= quiet and abs(values[index + 1] - values[index]) <= quiet
        if local_minimum or locally_flat:
            anchors.append(index)
    # A tail is useful only when its recent movement is quieter than the run's
    # typical epoch-to-epoch movement; a monotonic descending tail is not flat.
    if abs(values[-1] - values[-2]) <= quiet and abs(values[-2] - values[-3]) <= quiet:
        anchors.extend([len(values) - 2, len(values) - 1])
    return sorted(set(anchors))


def _region_intervals(trend, anchors, scale):
    """Expand and merge nearby settled evidence using only the epoch-level trend."""
    values = [float(point["loss"]) for point in trend]
    tolerance = scale * 1.5
    intervals = []
    for anchor in anchors:
        center, start, end = values[anchor], anchor, anchor
        while start > 0 and center - tolerance <= values[start - 1] <= center + tolerance:
            start -= 1
        while end + 1 < len(values) and center - tolerance <= values[end + 1] <= center + tolerance:
            end += 1
        intervals.append((start, end))
    merged = []
    for start, end in sorted(intervals):
        prior_floor = min(values[merged[-1][0]:merged[-1][1] + 1]) if merged else None
        current_floor = min(values[start:end + 1])
        same_region = prior_floor is not None and abs(prior_floor - current_floor) <= tolerance
        if not merged:
            merged.append([start, end])
        elif same_region and start <= merged[-1][1] + 1:
            merged[-1][1] = max(merged[-1][1], end)
        elif start <= merged[-1][1]:
            # Overlap from a genuinely lower later regime marks a boundary,
            # not a transitive bridge between two shelves.
            if current_floor < prior_floor:
                merged[-1][1] = start - 1
                if merged[-1][1] < merged[-1][0]:
                    merged.pop()
                merged.append([start, end])
            else:
                trimmed_start = merged[-1][1] + 1
                if trimmed_start <= end:
                    merged.append([trimmed_start, end])
        else:
            merged.append([start, end])
    return [tuple(interval) for interval in merged if interval[1] - interval[0] + 1 >= 2]


def detect_settled_regions(robust_points):
    """Group locally low or flat robust epochs into candidate-worthy regions."""
    trend = _centered_median(robust_points)
    scale = _movement_scale(trend)
    intervals = _region_intervals(trend, _settled_anchor_indexes(trend, scale), scale)
    regions = []
    for start, end in intervals:
        values = robust_points[start:end + 1]
        representative = min(values, key=lambda point: (float(point["loss"]), int(point["epoch"])))
        regions.append({
            "startEpoch": int(robust_points[start]["epoch"]),
            "endEpoch": int(robust_points[end]["epoch"]),
            "representativeEpoch": int(representative["epoch"]),
            "current": end == len(robust_points) - 1,
        })
    return trend, regions


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


def saved_artifacts_for_run(run_dir):
    """Describe saved epoch adapters without treating them as candidates."""
    artifacts = []
    for directory in sorted(Path(run_dir).iterdir(), key=lambda path: path.name):
        match = _EPOCH_DIRECTORY_PATTERN.fullmatch(directory.name)
        if not match or not directory.is_dir() or directory.is_symlink():
            continue
        files = sorted(path for path in directory.iterdir() if path.is_file() and path.suffix.lower() == ".safetensors")
        if len(files) == 1:
            artifacts.append({"epoch": int(match.group(1)), "fileName": files[0].name, "status": "available"})
        elif len(files) > 1:
            artifacts.append({"epoch": int(match.group(1)), "status": "ambiguous"})
    return sorted(artifacts, key=lambda item: item["epoch"])


def analyze_loss_points(detailed_events, epoch_events, run_dir=None):
    """Analyze robust detailed loss by completed epoch; never modify the run."""
    epoch_loss_points = [{"epoch": int(point["axis"]), "loss": float(point["loss"])} for point in sorted(epoch_events, key=lambda point: point["axis"])]
    mapped = map_detailed_loss_to_epochs(detailed_events, epoch_events)
    robust_points = aggregate_detailed_loss_by_epoch(mapped, epoch_events)
    analysis_points, regions = detect_settled_regions(robust_points)
    candidates = [{
        "epoch": region["representativeEpoch"],
        "startEpoch": region["startEpoch"],
        "endEpoch": region["endEpoch"],
        "reason": "Current stable region." if region["current"] else "Stable region.",
        "artifact": artifact_for_epoch(run_dir, region["representativeEpoch"]) if run_dir is not None else {"available": False, "status": "not_checked"},
    } for region in regions]
    return {
        "analysisVersion": ANALYSIS_VERSION,
        "epochLossPoints": epoch_loss_points,
        "analysisPoints": analysis_points,
        "regions": regions,
        "candidates": candidates,
        "savedArtifacts": saved_artifacts_for_run(run_dir) if run_dir is not None else [],
    }


def analyze_run_directory(run_dir):
    detailed_events, epoch_events = read_loss_events(run_dir)
    return analyze_loss_points(detailed_events, epoch_events, run_dir=run_dir)
