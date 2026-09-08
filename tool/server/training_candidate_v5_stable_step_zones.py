"""V5: physical-step stable zones from local lines and robust residual bands."""

import statistics


SEED_STEPS = 100
MIN_ZONE_STEPS = 150


def _median(values):
    return statistics.median(values) if values else 0.0


def _fit(points):
    xs = [point["step"] for point in points]
    ys = [point["loss"] for point in points]
    mean_x, mean_y = _median(xs), _median(ys)
    variance = sum((value - mean_x) ** 2 for value in xs)
    slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / variance if variance else 0.0
    intercept = mean_y - slope * mean_x
    residuals = [y - (intercept + slope * x) for x, y in zip(xs, ys)]
    residual_center = _median(residuals)
    return slope, intercept, _median([abs(value - residual_center) for value in residuals])


def _seed_windows(points):
    seeds = []
    for start, point in enumerate(points):
        end = start
        while end + 1 < len(points) and points[end + 1]["step"] - point["step"] <= SEED_STEPS:
            end += 1
        if end > start and points[end]["step"] - point["step"] >= SEED_STEPS:
            window = points[start:end + 1]
            if len(window) >= 3:
                slope, intercept, spread = _fit(window)
                seeds.append({"start": start, "end": end, "slope": slope, "intercept": intercept, "spread": spread})
    return seeds


def _grade(slope, loss_span, noise):
    change = slope * SEED_STEPS
    gentle_change = max(noise * 6, loss_span * .05)
    flat_change = max(noise * 2, loss_span * .005)
    if change <= -gentle_change:
        return "steep_down"
    if change < -flat_change:
        return "gentle_down"
    if change <= flat_change:
        return "flat"
    if change < gentle_change:
        return "gentle_up"
    return "steep_up"


def _representative(zone, checkpoints):
    inside = [checkpoint for checkpoint in checkpoints
              if zone["startStep"] <= checkpoint["endStep"] <= zone["endStep"]]
    if not inside:
        return None
    if zone["grade"] == "gentle_up":
        return min(inside, key=lambda checkpoint: (checkpoint["endStep"], checkpoint["epoch"]))
    center = (zone["startStep"] + zone["endStep"]) / 2
    return max(inside, key=lambda checkpoint: (
        1 - abs(checkpoint["endStep"] - center) / max(1, (zone["endStep"] - zone["startStep"]) / 2),
        -checkpoint["epoch"],
    ))


def detect(detailed_points, checkpoint_points):
    points = sorted(detailed_points, key=lambda point: point["step"])
    public = [{key: point[key] for key in ("step", "epoch", "loss")} for point in points]
    if len(points) < 3 or not checkpoint_points:
        return {"analysisPoints": public, "regions": []}
    seeds = _seed_windows(points)
    if not seeds:
        return {"analysisPoints": public, "regions": []}
    loss_span = max(point["loss"] for point in points) - min(point["loss"] for point in points)
    observed_noise = _median([seed["spread"] for seed in seeds])
    noise = max(observed_noise, loss_span * 1e-6, 1e-12)
    band = noise * 2
    regions, seed_index = [], 0
    while seed_index < len(seeds):
        seed = seeds[seed_index]
        grade = _grade(seed["slope"], loss_span, noise)
        if seed["spread"] > band or grade in ("steep_down", "steep_up"):
            seed_index += 1
            continue
        end = seed["end"]
        zone_slope, zone_grade = seed["slope"], grade
        while end + 1 < len(points):
            point = points[end + 1]
            expected = seed["intercept"] + seed["slope"] * point["step"]
            refit_slope, _refit_intercept, refit_spread = _fit(points[seed["start"]:end + 2])
            refit_grade = _grade(refit_slope, loss_span, noise)
            if (abs(point["loss"] - expected) > band
                    and (refit_spread > band or refit_grade in ("steep_down", "steep_up"))):
                break
            end += 1
            zone_slope, zone_grade = refit_slope, refit_grade
        start_point, end_point = points[seed["start"]], points[end]
        if end_point["step"] - start_point["step"] < MIN_ZONE_STEPS:
            seed_index += 1
            continue
        zone = {"startStep": start_point["step"], "endStep": end_point["step"], "grade": zone_grade}
        representative = _representative(zone, checkpoint_points)
        if representative is None:
            seed_index += 1
            continue
        inside = [checkpoint for checkpoint in checkpoint_points
                  if zone["startStep"] <= checkpoint["endStep"] <= zone["endStep"]]
        regions.append({
            "startStep": zone["startStep"], "endStep": zone["endStep"],
            "startEpoch": inside[0]["epoch"], "endEpoch": inside[-1]["epoch"],
            "representativeEpoch": representative["epoch"], "current": zone["endStep"] == points[-1]["step"],
            "kind": "stable_step_zone", "label": "Stable step zone",
        })
        seed_index = next((index for index, candidate in enumerate(seeds)
                           if candidate["start"] > end), len(seeds))
    return {"analysisPoints": public, "regions": regions}
