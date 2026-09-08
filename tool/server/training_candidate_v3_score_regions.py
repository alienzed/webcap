"""V3: plain-Python port of the original score-scalars candidate ranking."""

import statistics


WINDOW = 5
ALPHA = 0.3
TREND_WINDOW = 8
TREND_WEIGHT = 0.4
REGIME_CONFIRM_STEPS = 3
REGIME_DROP_FRAC = 0.15
REGIME_MIN_STEP_FRAC = 0.15
DEPTH_GATE = 0.5
REGION_STEP_FRAC = 0.15
MAX_PER_REGION = 5
MAX_REGIONS = 6


def _mean(values):
    return sum(values) / len(values) if values else 0.0


def _public(points):
    return [{"step": point["step"], "epoch": point["epoch"], "loss": point["loss"]} for point in points]


def _trend_bonus(losses):
    bonus = [0 if index < TREND_WINDOW else max(0, _mean(losses[index - TREND_WINDOW:index]) - loss)
             for index, loss in enumerate(losses)]
    maximum = max(bonus) if bonus else 0
    return [value / maximum for value in bonus] if maximum else bonus


def _score_details(points):
    """Original score-scalars.py formula, evaluated over raw step-loss points."""
    losses = [point["loss"] for point in points]
    if len(losses) < 3:
        return []
    minimum, maximum = min(losses), max(losses)
    depth_scores = [(maximum - loss) / (maximum - minimum + 1e-12) for loss in losses]
    stability_scores = [
        1 / (1 + statistics.pstdev(losses[max(0, index - WINDOW):index + WINDOW + 1]))
        for index in range(len(losses))
    ]
    trend_bonus = _trend_bonus(losses)
    rolling_mean = [None] * len(losses)
    for index in range(TREND_WINDOW - 1, len(losses)):
        rolling_mean[index] = _mean(losses[index - TREND_WINDOW + 1:index + 1])
    min_step, max_step = points[0]["step"], points[-1]["step"]
    run_span = max_step - min_step
    regime_start = min_step + REGIME_MIN_STEP_FRAC * run_span
    confirmed, first_regime_index = 0, None
    for index in range(TREND_WINDOW, len(points)):
        point = points[index]
        if point["step"] < regime_start:
            confirmed = 0
            continue
        if (rolling_mean[index] - losses[index]) / (rolling_mean[index] + 1e-12) > REGIME_DROP_FRAC:
            confirmed += 1
            if confirmed >= REGIME_CONFIRM_STEPS:
                first_regime_index = index - REGIME_CONFIRM_STEPS + 1
                break
        else:
            confirmed = 0
    if first_regime_index is None:
        first_regime_index = int(len(points) * .25)
    first_regime_step = points[first_regime_index]["step"]
    denominator = max_step - first_regime_step
    scores = []
    for index, point in enumerate(points):
        progress = (point["step"] - first_regime_step) / (denominator + 1e-12)
        early_weight = (1 - min(1, max(0, progress))) ** ALPHA
        stability = stability_scores[index] * min(1, max(0, depth_scores[index] / DEPTH_GATE))
        score = depth_scores[index] * stability * early_weight * (1 + TREND_WEIGHT * trend_bonus[index])
        scores.append(score if point["step"] >= first_regime_step else 0)
    return scores, first_regime_step


def _scores(points):
    return _score_details(points)[0]


def _eligible_indexes(points):
    losses = [point["loss"] for point in points]
    indexes = []
    for index in range(1, len(points) - 1):
        sharp_min = losses[index] < losses[index - 1] and losses[index] < losses[index + 1]
        plateau = abs(losses[index] - losses[index - 1]) < .002 and abs(losses[index] - losses[index + 1]) < .002
        if sharp_min or plateau:
            indexes.append(index)
    return indexes


def _groups(points, scores, first_regime_step=None):
    run_span = points[-1]["step"] - points[0]["step"]
    region_min_dist = REGION_STEP_FRAC * run_span
    groups = []
    candidates = [index for index in _eligible_indexes(points)
                  if first_regime_step is None or points[index]["step"] >= first_regime_step]
    candidates.sort(key=lambda index: scores[index], reverse=True)
    for index in candidates:
        point = points[index]
        matching = next((group for group in groups if abs(point["step"] - group["center"]["step"]) < region_min_dist), None)
        if matching:
            if len(matching["members"]) < MAX_PER_REGION:
                matching["members"].append(point)
        elif len(groups) < MAX_REGIONS and all(abs(point["step"] - group["center"]["step"]) >= region_min_dist for group in groups):
            groups.append({"center": point, "members": [point]})
    return groups


def _nearest_checkpoint(step, checkpoints):
    return min(checkpoints, key=lambda checkpoint: (abs(checkpoint["endStep"] - step), checkpoint["epoch"]))


def detect(detailed_points, checkpoint_points):
    points = sorted(detailed_points, key=lambda point: point["step"])
    if len(points) < 3 or not checkpoint_points:
        return {"analysisPoints": _public(points), "regions": []}
    scores, first_regime_step = _score_details(points)
    regions = []
    for group in _groups(points, scores, first_regime_step):
        center = group["center"]
        representative = _nearest_checkpoint(center["step"], checkpoint_points)
        selected = [_nearest_checkpoint(member["step"], checkpoint_points) for member in group["members"]]
        selected_steps = [member["step"] for member in group["members"]] + [checkpoint["endStep"] for checkpoint in selected]
        left, right = min(selected_steps), max(selected_steps)
        covered = sorted({checkpoint["epoch"]: checkpoint for checkpoint in selected}.values(), key=lambda checkpoint: checkpoint["epoch"])
        regions.append({
            "startStep": left,
            "endStep": right,
            "startEpoch": covered[0]["epoch"] if covered else representative["epoch"],
            "endEpoch": covered[-1]["epoch"] if covered else representative["epoch"],
            "representativeEpoch": representative["epoch"],
            "current": right >= points[-1]["step"],
            "kind": "ranked_score_region",
            "label": "Ranked score region",
        })
    return {"analysisPoints": _public(points), "regions": regions}
