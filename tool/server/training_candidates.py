"""Read-only LoRA candidate analysis for one recorded training run."""

import math
import statistics
from pathlib import Path


ANALYSIS_VERSION = 2
DETAILED_LOSS_TAG = "train/loss"
EPOCH_LOSS_TAG = "train/epoch_loss"
DEFAULT_SCALAR_TAG = EPOCH_LOSS_TAG


def _median(values):
    return statistics.median(values) if values else 0.0


def _median_absolute_deviation(values):
    if not values:
        return 0.0
    center = _median(values)
    return _median([abs(value - center) for value in values])


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


def normalize_epoch_loss_events(events):
    """Compatibility helper returning finite epoch-loss points in epoch order."""
    points = normalize_scalar_events(events)
    return [{"epoch": point["axis"], "loss": point["loss"]} for point in sorted(points, key=lambda point: point["axis"])]


def read_loss_events(run_dir):
    """Read detailed and epoch TensorBoard streams without creating derived data."""
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
        missing = [tag for tag in (DETAILED_LOSS_TAG, EPOCH_LOSS_TAG) if tag not in tags]
        if missing:
            raise ValueError("TensorBoard scalar " + missing[0] + " is unavailable for this run.")
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


def read_epoch_loss_events(run_dir, scalar_tag=EPOCH_LOSS_TAG):
    """Read one scalar for legacy callers; candidate analysis reads both streams."""
    directory = Path(run_dir)
    if not any(path.is_file() and path.name.startswith("events.out.tfevents") for path in directory.iterdir()):
        raise FileNotFoundError("No TensorBoard event files are available for this run.")
    try:
        from tensorboard.backend.event_processing.event_accumulator import EventAccumulator
        accumulator = EventAccumulator(str(directory), size_guidance={"scalars": 0})
        accumulator.Reload()
        if scalar_tag not in (accumulator.Tags().get("scalars") or []):
            raise ValueError("TensorBoard scalar " + scalar_tag + " is unavailable for this run.")
        points = normalize_epoch_loss_events(accumulator.Scalars(scalar_tag))
    except Exception as exc:
        if isinstance(exc, ValueError) and str(exc).startswith("TensorBoard scalar"):
            raise
        raise ValueError("Could not read TensorBoard event data for this run: " + str(exc)) from exc
    if not points:
        raise ValueError("TensorBoard scalar " + scalar_tag + " has no finite epoch-loss points.")
    return points


def map_detailed_loss_to_epochs(detailed_events, epoch_events):
    """Map detailed samples to the first epoch completion recorded at or after them.

    Scalar x values may not be optimizer steps. Events are deduplicated by x
    using latest wall time, then ordered by (wall time, x, event order). A tied
    detailed event belongs to that completed epoch; a later event is next/open.
    """
    completed = sorted(epoch_events, key=lambda point: (point["wallTime"], point["axis"], point["order"]))
    detailed = sorted(detailed_events, key=lambda point: (point["wallTime"], point["axis"], point["order"]))
    if not completed:
        return []
    result, boundary = [], 0
    for sample, point in enumerate(detailed):
        while boundary < len(completed) and completed[boundary]["wallTime"] < point["wallTime"]:
            boundary += 1
        epoch = completed[boundary]["axis"] if boundary < len(completed) else completed[-1]["axis"] + 1
        result.append({"sample": sample, "epoch": int(epoch), "loss": float(point["loss"])})
    return result


def _rolling_median(points, radius):
    values = [float(point["loss"]) for point in points]
    return [{**point, "loss": _median(values[max(0, index - radius):min(len(values), index + radius + 1)])} for index, point in enumerate(points)]


def _rolling_mean(points, radius):
    values = [float(point["loss"]) for point in points]
    result = []
    for index, point in enumerate(points):
        start, end = max(0, index - radius), min(len(values), index + radius + 1)
        result.append({**point, "loss": sum(values[start:end]) / (end - start)})
    return result


def smooth_epoch_loss_points(points, radius=2):
    """Small centered rolling median for the display-oriented epoch stream."""
    return _rolling_median(list(points or []), radius)


def smooth_detailed_loss_points(points):
    """Robust 9-sample median followed by a light 5-sample centered mean."""
    return _rolling_mean(_rolling_median(list(points or []), 4), 2)


def _noise_band(raw_points, smoothed_points):
    raw = [float(point["loss"]) for point in raw_points]
    smooth = [float(point["loss"]) for point in smoothed_points]
    residuals = [abs(raw[index] - smooth[index]) for index in range(len(raw))]
    deltas = [abs(smooth[index] - smooth[index - 1]) for index in range(1, len(smooth))]
    spread = max(smooth) - min(smooth) if smooth else 0.0
    return max(_median_absolute_deviation(residuals) * 2.0, _median(deltas) * 0.75, spread * 0.02, 1e-12)


def _expand_basin(values, center, band):
    floor, start, end = values[center], center, center
    lower, upper = floor - band * 2.0, floor + band * 2.0
    while start > 0 and lower <= values[start - 1] <= upper:
        start -= 1
    while end + 1 < len(values) and lower <= values[end + 1] <= upper:
        end += 1
    return start, end


def _local_minima(values):
    return [index for index in range(1, len(values) - 1) if values[index] <= values[index - 1] and values[index] <= values[index + 1]]


def _merge_basin_intervals(intervals, values, band):
    """Merge overlaps and directly adjacent intervals from the same low regime."""
    merged = []
    for start, end in sorted(intervals):
        if not merged:
            merged.append([start, end])
            continue
        prior = merged[-1]
        same_regime = abs(min(values[prior[0]:prior[1] + 1]) - min(values[start:end + 1])) <= band * 2.0
        if start <= prior[1] or (start == prior[1] + 1 and same_regime):
            prior[1] = max(prior[1], end)
        else:
            merged.append([start, end])
    return [tuple(interval) for interval in merged]


def _resolved_exit(values, end, floor, band):
    """Return the sustained exit kind after a basin, if the curve leaves it."""
    upper, lower = floor + band * 2.0, floor - band * 2.0
    later = values[end + 1:]
    for index in range(len(later) - 1):
        if later[index] > upper and later[index + 1] > upper:
            return "upward"
        if later[index] < lower and later[index + 1] < lower:
            return "lower"
    return ""


def _representative_epoch(smoothed_points, start, end):
    by_epoch = {}
    for point in smoothed_points[start:end + 1]:
        by_epoch.setdefault(int(point["epoch"]), []).append(float(point["loss"]))
    return min((_median(losses), epoch) for epoch, losses in by_epoch.items())[1]


def detect_loss_basins(points, smoothed_points):
    """Find low detailed-loss regimes; only a sustained exit confirms one."""
    if len(points) != len(smoothed_points) or len(points) < 3:
        return []
    values = [float(point["loss"]) for point in smoothed_points]
    band = _noise_band(points, smoothed_points)
    intervals = []
    for index in _local_minima(values):
        start, end = _expand_basin(values, index, band)
        floor = min(values[start:end + 1])
        # A basin begins after a meaningful descent into a low regime. This
        # prevents the initial high-loss shelf in a run from becoming a valley
        # merely because training later improves.
        entered_from_above = start > 0 and values[start - 1] > floor + band
        if end - start + 1 >= 3 and entered_from_above:
            intervals.append((start, end))
    basins = []
    for start, end in _merge_basin_intervals(intervals, values, band):
        floor_index = min(range(start, end + 1), key=lambda item: (values[item], item))
        exit_kind = _resolved_exit(values, end, values[floor_index], band)
        epochs = [int(point["epoch"]) for point in smoothed_points[start:end + 1]]
        basins.append({"startIndex": start, "endIndex": end, "startEpoch": min(epochs), "endEpoch": max(epochs), "representativeEpoch": _representative_epoch(smoothed_points, start, end), "confirmed": bool(exit_kind), "exitKind": exit_kind, "floor": values[floor_index]})
    return basins


def _discard_dominated_lower_basins(basins):
    """A later, lower confirmed regime supersedes earlier lower-exit shelves."""
    retained = []
    for index, basin in enumerate(basins):
        later_lower = any(later["confirmed"] and later["floor"] < basin["floor"] and later["startIndex"] > basin["endIndex"] for later in basins[index + 1:])
        if basin["exitKind"] == "lower" and later_lower:
            continue
        retained.append(basin)
    return retained


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


def analyze_loss_points(detailed_events, epoch_events, run_dir=None):
    """Pure detailed-loss analysis with epoch mapping and read-only artifact status."""
    epoch_loss = [{"epoch": int(point["axis"]), "loss": float(point["loss"])} for point in sorted(epoch_events, key=lambda point: point["axis"])]
    detailed_loss = map_detailed_loss_to_epochs(detailed_events, epoch_events)
    epoch_smoothed = smooth_epoch_loss_points(epoch_loss)
    detailed_smoothed = smooth_detailed_loss_points(detailed_loss)
    raw_basins = _discard_dominated_lower_basins(detect_loss_basins(detailed_loss, detailed_smoothed))
    basins = [{key: value for key, value in basin.items() if key not in {"startIndex", "endIndex", "exitKind", "floor"}} for basin in raw_basins]
    candidates = []
    for basin, raw_basin in zip(basins, raw_basins):
        if basin["confirmed"]:
            candidates.append({"epoch": basin["representativeEpoch"], "startEpoch": basin["startEpoch"], "endEpoch": basin["endEpoch"], "reason": "Stable valley followed by a lower regime." if raw_basin["exitKind"] == "lower" else "Stable valley with a sustained exit.", "artifact": artifact_for_epoch(run_dir, basin["representativeEpoch"]) if run_dir is not None else {"available": False, "status": "not_checked"}})
    return {"analysisVersion": ANALYSIS_VERSION, "epochLossPoints": epoch_loss, "epochSmoothedPoints": epoch_smoothed, "detailedLossPoints": detailed_loss, "detailedSmoothedPoints": detailed_smoothed, "basins": basins, "candidates": candidates}


def analyze_epoch_loss_points(points, run_dir=None):
    """Compatibility adapter for focused unit callers using one event per epoch."""
    epoch_events = [{"axis": int(point["epoch"]), "loss": float(point["loss"]), "wallTime": float(index) + 0.99, "order": index} for index, point in enumerate(points)]
    detailed_events = []
    for index, point in enumerate(points):
        for repeat in range(10):
            detailed_events.append({"axis": index * 10 + repeat, "loss": float(point["loss"]), "wallTime": float(index) + repeat / 11.0, "order": len(detailed_events)})
    result = analyze_loss_points(detailed_events, epoch_events, run_dir=run_dir)
    result["scalarTag"] = EPOCH_LOSS_TAG
    result["points"] = result["epochLossPoints"]
    result["smoothedPoints"] = result["epochSmoothedPoints"]
    return result


def analyze_run_directory(run_dir):
    detailed_events, epoch_events = read_loss_events(run_dir)
    return analyze_loss_points(detailed_events, epoch_events, run_dir=run_dir)
