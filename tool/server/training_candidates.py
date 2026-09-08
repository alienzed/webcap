"""Read-only settled-region analysis for one recorded LoRA training run."""

import math
import re
import statistics
from pathlib import Path

from . import training_candidate_v1_epoch_regions, training_candidate_v2_step_ranges


ANALYSIS_VERSION = 6
DETAILED_LOSS_TAG = "train/loss"
EPOCH_LOSS_TAG = "train/epoch_loss"
MIN_CANDIDATE_STEP = 800
# A roughly 69-sample half-life: enough to expose sustained detailed-loss
# regimes without letting isolated TensorBoard samples dominate the display.
DISPLAY_STEP_LOSS_EMA_ALPHA = 0.01
_EPOCH_DIRECTORY_PATTERN = re.compile(r"^epoch(\d+)$")
ALGORITHM_LABELS = {
    "v1": "v1 · Epoch Regions",
    "v2": "v2 · Step Stable Ranges (experimental)",
}


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
        result.append({"sample": sample, "step": int(point["axis"]), "epoch": int(epoch), "loss": float(point["loss"])})
    return result


def aggregate_detailed_loss_by_epoch(mapped_points, completed_epochs):
    """Return one median detailed-loss value for each completed epoch with samples."""
    samples, steps = {}, {}
    for point in mapped_points:
        epoch = int(point["epoch"])
        samples.setdefault(epoch, []).append(float(point["loss"]))
        steps.setdefault(epoch, []).append(int(point["step"]))
    result = []
    for epoch in sorted({int(point["axis"]) for point in completed_epochs}):
        if epoch in samples:
            result.append({
                "epoch": epoch,
                "step": max(steps[epoch]),
                "startStep": min(steps[epoch]),
                "endStep": max(steps[epoch]),
                "loss": _median(samples[epoch]),
            })
    return result


def smooth_step_loss_ema(points, alpha=DISPLAY_STEP_LOSS_EMA_ALPHA):
    """Return a display-only EMA over detailed TensorBoard samples in step order."""
    ordered = sorted(points, key=lambda point: int(point["step"]))
    if not ordered:
        return []
    ema = float(ordered[0]["loss"])
    result = [{"step": int(ordered[0]["step"]), "epoch": int(ordered[0]["epoch"]), "loss": ema}]
    for point in ordered[1:]:
        ema = alpha * float(point["loss"]) + (1.0 - alpha) * ema
        result.append({"step": int(point["step"]), "epoch": int(point["epoch"]), "loss": ema})
    return result


_centered_median = training_candidate_v1_epoch_regions.centered_median
_representative_index = training_candidate_v1_epoch_regions._representative_index
_region_explanation = training_candidate_v1_epoch_regions._region_explanation
detect_settled_regions = training_candidate_v1_epoch_regions.detect_settled_regions


def _detect_v1(detailed_points, checkpoint_points):
    # Keep this thin adapter so v1's long-standing helper remains easy to
    # exercise directly while all detector calculations live in its module.
    trend, regions = detect_settled_regions(checkpoint_points)
    return {"analysisPoints": trend, "regions": regions}


ALGORITHMS = {
    "v1": _detect_v1,
    "v2": training_candidate_v2_step_ranges.detect,
}


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


def analyze_loss_points(detailed_events, epoch_events, run_dir=None, algorithm="v1"):
    """Analyze completed loss points with one explicit candidate algorithm."""
    if algorithm not in ALGORITHMS:
        raise ValueError("Unknown candidate analysis algorithm: " + str(algorithm))
    mapped = map_detailed_loss_to_epochs(detailed_events, epoch_events)
    robust_points = aggregate_detailed_loss_by_epoch(mapped, epoch_events)
    robust_by_epoch = {point["epoch"]: point for point in robust_points}
    completed_epochs = set(robust_by_epoch)
    epoch_loss_points = [
        {
            "epoch": int(point["axis"]),
            "step": int(robust_by_epoch[int(point["axis"])]["endStep"]),
            "loss": float(point["loss"]),
        }
        for point in sorted(epoch_events, key=lambda point: point["axis"])
        if int(point["axis"]) in completed_epochs
    ]
    step_loss_points = sorted([
        {"step": int(point["step"]), "epoch": int(point["epoch"]), "loss": float(point["loss"])}
        for point in mapped
        if point["epoch"] in completed_epochs
    ], key=lambda point: point["step"])
    smoothed_step_loss_points = smooth_step_loss_ema(step_loss_points)
    eligible_points = [point for point in robust_points if point["endStep"] >= MIN_CANDIDATE_STEP]
    eligible_step_points = [point for point in step_loss_points if point["step"] >= MIN_CANDIDATE_STEP]
    detector_result = ALGORITHMS[algorithm](eligible_step_points, eligible_points)
    regions = detector_result["regions"]
    if algorithm == "v1":
        display_trend = _centered_median(robust_points)
        eligible_trend_by_epoch = {point["epoch"]: point for point in detector_result["analysisPoints"]}
        analysis_points = [
            dict(point, loss=eligible_trend_by_epoch.get(point["epoch"], point)["loss"])
            for point in display_trend
        ]
    else:
        analysis_points = detector_result["analysisPoints"]
    saved_artifacts = saved_artifacts_for_run(run_dir) if run_dir is not None else []
    for region in regions:
        region["savedEpochs"] = [
            artifact["epoch"] for artifact in saved_artifacts
            if artifact["status"] == "available" and region["startEpoch"] <= artifact["epoch"] <= region["endEpoch"]
        ]
    candidates = [{
        "epoch": region["representativeEpoch"],
        "step": robust_by_epoch[region["representativeEpoch"]]["endStep"],
        "startEpoch": region["startEpoch"],
        "endEpoch": region["endEpoch"],
        "kind": region["kind"],
        "label": region["label"],
        "savedEpochs": region["savedEpochs"],
        "reason": "Current stable region." if region["current"] else "Stable region.",
        "artifact": artifact_for_epoch(run_dir, region["representativeEpoch"]) if run_dir is not None else {"available": False, "status": "not_checked"},
    } for region in regions]
    return {
        "analysisVersion": ANALYSIS_VERSION,
        "algorithm": algorithm,
        "algorithmLabel": ALGORITHM_LABELS[algorithm],
        "stepLossPoints": step_loss_points,
        "smoothedStepLossPoints": smoothed_step_loss_points,
        "epochLossPoints": epoch_loss_points,
        "analysisPoints": analysis_points,
        "regions": regions,
        "candidates": candidates,
        "savedArtifacts": saved_artifacts,
    }


def analyze_run_directory(run_dir, algorithm="v1"):
    detailed_events, epoch_events = read_loss_events(run_dir)
    return analyze_loss_points(detailed_events, epoch_events, run_dir=run_dir, algorithm=algorithm)
