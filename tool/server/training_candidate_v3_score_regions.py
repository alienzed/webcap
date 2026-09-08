"""V3: scalar desirability ranking and spatially diverse score neighborhoods."""

import statistics


def _median(values):
    return statistics.median(values) if values else 0.0


def _prepare(detailed, checkpoints):
    """Robust, equal-step cells (one eighth of a typical completed epoch).

    Cells use actual optimizer steps, so denser logging doesn't stretch time.
    Median/MAD reject isolated extremes before any scoring or segmentation.
    """
    ordered = sorted(detailed, key=lambda point: point["step"])
    if not ordered or not checkpoints:
        return [], 1.0
    gaps = [b["step"] - a["step"] for a, b in zip(ordered, ordered[1:]) if b["step"] > a["step"]]
    spacing = _median(gaps) or 1.0
    epoch_steps = _median([p["endStep"] - p["startStep"] + spacing for p in checkpoints])
    width = max(spacing * 3, epoch_steps / 8)
    buckets = {}
    origin = ordered[0]["step"]
    for point in ordered:
        buckets.setdefault(int((point["step"] - origin) / width), []).append(point)
    cells = []
    for bucket, points in sorted(buckets.items()):
        losses = [p["loss"] for p in points]
        level = _median(losses)
        cells.append({
            "step": points[len(points) // 2]["step"], "epoch": points[len(points) // 2]["epoch"],
            "startStep": points[0]["step"], "endStep": points[-1]["step"],
            "loss": level, "spread": _median([abs(v - level) for v in losses]),
            "bucket": bucket,
        })
    return cells, width


def _public(cells):
    return [{key: p[key] for key in ("step", "epoch", "loss")} for p in cells]


def _noise(cells):
    levels = [p["loss"] for p in cells]
    # Curvature supplies a noise estimate even when within-cell MAD is zero.
    curvature = [abs(c - 2 * b + a) for a, b, c in zip(levels, levels[1:], levels[2:])]
    return max(_median([p["spread"] for p in cells]), _median(curvature) / 2,
               max((abs(v) for v in levels), default=1) * 1e-10, 1e-12)


def _region(cells, start, end, checkpoints, kind, label, weights=(.55, .35, .10)):
    """Project only after range formation; even one contained checkpoint is valid."""
    section = cells[start:end + 1]
    left, right = section[0]["startStep"], section[-1]["endStep"]
    inside = [p for p in checkpoints if left <= p["endStep"] <= right]
    if not inside:
        return None
    center, half = (left + right) / 2, max((right - left) / 2, 1)
    floor = min(p["loss"] for p in section)
    noise = _noise(section)
    level_span = max(max(p["loss"] for p in section) - floor, noise * 4)
    spread_span = max(max(p["spread"] for p in section), noise * 4)
    def score(checkpoint):
        point = min(section, key=lambda p: abs(p["step"] - checkpoint["endStep"]))
        return (weights[0] * (1 - abs(checkpoint["endStep"] - center) / half)
                - weights[1] * point["spread"] / spread_span
                - weights[2] * (point["loss"] - floor) / level_span,
                -checkpoint["epoch"])
    representative = max(inside, key=score)
    return {
        "startStep": left, "endStep": right,
        "startEpoch": min(p["epoch"] for p in inside), "endEpoch": max(p["epoch"] for p in inside),
        "representativeEpoch": representative["epoch"], "current": end == len(cells) - 1,
        "kind": kind, "label": label,
    }


def _scores(cells):
    levels = [p["loss"] for p in cells]
    if len(levels) < 5:
        return []
    # Robust cells already remove individual raw spikes; percentile limits
    # prevent a single remaining extreme cell controlling depth normalization.
    ordered = sorted(levels)
    low, high = ordered[int((len(ordered) - 1) * .05)], ordered[int((len(ordered) - 1) * .95)]
    span = high - low
    if span <= _noise(cells):
        return []
    first = None
    for i in range(max(1, int(len(cells) * .15)), len(cells) - 2):
        if all(high - levels[j] >= span * .15 for j in range(i, i + 3)):
            first = i
            break
    if first is None:
        return []
    bonuses = [max(0, _median(levels[max(0, i - 8):i]) - level) for i, level in enumerate(levels)]
    bonus_scale = max(bonuses) or 1
    result = []
    for i, level in enumerate(levels):
        depth = min(1, max(0, (high - level) / span))
        window = levels[max(0, i - 2):min(len(levels), i + 3)]
        stability = 1 / (1 + statistics.pstdev(window) / span)
        gate = min(1, depth / .5)
        progress = max(0, (cells[i]["step"] - cells[first]["step"]) /
                       max(1, cells[-1]["step"] - cells[first]["step"]))
        early = max(0, 1 - progress) ** .3
        result.append(depth * stability * gate * early * (1 + .4 * bonuses[i] / bonus_scale) if i >= first else 0)
    return result


def detect(detailed_points, checkpoint_points):
    cells, width = _prepare(detailed_points, checkpoint_points)
    scores = _scores(cells)
    if not scores:
        return {"analysisPoints": _public(cells), "regions": []}
    noise = _noise(cells)
    # Avoid filling spare neighborhood slots with numerically nonzero noise.
    score_floor = max(scores) * .1
    promising = [i for i in range(1, len(cells) - 1) if scores[i] >= score_floor and scores[i] > 0
                 and cells[i]["loss"] <= cells[i - 1]["loss"] + noise
                 and cells[i]["loss"] <= cells[i + 1]["loss"] + noise]
    separation = max(width * 2, (cells[-1]["step"] - cells[0]["step"]) * .15)
    groups = []
    for i in sorted(promising, key=lambda j: (-scores[j], cells[j]["step"])):
        group = next((g for g in groups if abs(cells[i]["step"] - cells[g[0]]["step"]) <= separation / 2), None)
        if group is not None:
            if len(group) < 5:
                group.append(i)
        elif all(abs(cells[i]["step"] - cells[g[0]]["step"]) >= separation for g in groups) and len(groups) < 6:
            groups.append([i])
    regions = []
    used = set()
    for group in groups:
        peak = group[0]
        left, right = cells[peak]["step"] - separation / 2, cells[peak]["step"] + separation / 2
        indexes = [i for i, p in enumerate(cells) if left <= p["step"] <= right]
        start, end = indexes[0], indexes[-1]
        region = _region(cells, start, end, checkpoint_points, "ranked_score_region", "Ranked score region")
        if region is None:
            continue
        inside = [p for p in checkpoint_points if region["startStep"] <= p["endStep"] <= region["endStep"] and p["epoch"] not in used]
        if not inside:
            continue
        # Project onto robust score evidence, never an individual raw minimum.
        chosen = max(inside, key=lambda p: (
            scores[min(indexes, key=lambda i: abs(cells[i]["step"] - p["endStep"]))],
            -abs(p["endStep"] - cells[peak]["step"]), -p["epoch"]))
        region["representativeEpoch"] = chosen["epoch"]
        used.add(chosen["epoch"])
        regions.append(region)
    return {"analysisPoints": _public(cells), "regions": regions}
