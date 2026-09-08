"""V3: rank scalar promise, then select a checkpoint from settled evidence."""

import statistics


def _median(values):
    return statistics.median(values) if values else 0.0


def _prepare(detailed, checkpoints):
    ordered = sorted(detailed, key=lambda point: point["step"])
    if not ordered or not checkpoints:
        return [], 1.0
    gaps = [b["step"] - a["step"] for a, b in zip(ordered, ordered[1:]) if b["step"] > a["step"]]
    spacing = _median(gaps) or 1.0
    epoch_steps = _median([point["endStep"] - point["startStep"] + spacing for point in checkpoints])
    width = max(spacing * 3, epoch_steps / 8)
    buckets, origin = {}, ordered[0]["step"]
    for point in ordered:
        buckets.setdefault(int((point["step"] - origin) / width), []).append(point)
    cells = []
    for bucket, points in sorted(buckets.items()):
        losses = [point["loss"] for point in points]
        level = _median(losses)
        cells.append({
            "step": points[len(points) // 2]["step"], "epoch": points[len(points) // 2]["epoch"],
            "startStep": points[0]["step"], "endStep": points[-1]["step"], "loss": level,
            "spread": _median([abs(value - level) for value in losses]), "bucket": bucket,
        })
    return cells, width


def _public(cells):
    return [{key: point[key] for key in ("step", "epoch", "loss")} for point in cells]


def _noise(cells):
    levels = [point["loss"] for point in cells]
    curvature = [abs(c - 2 * b + a) for a, b, c in zip(levels, levels[1:], levels[2:])]
    return max(_median([point["spread"] for point in cells]), _median(curvature) / 2,
               max((abs(value) for value in levels), default=1) * 1e-10, 1e-12)


def _scores(cells):
    levels = [point["loss"] for point in cells]
    if len(levels) < 5:
        return []
    ordered = sorted(levels)
    low, high = ordered[int((len(ordered) - 1) * .05)], ordered[int((len(ordered) - 1) * .95)]
    span = high - low
    if span <= _noise(cells):
        return []
    first = next((index for index in range(max(1, int(len(cells) * .15)), len(cells) - 2)
                  if all(high - levels[position] >= span * .15 for position in range(index, index + 3))), None)
    if first is None:
        return []
    bonuses = [max(0, _median(levels[max(0, index - 8):index]) - level) for index, level in enumerate(levels)]
    bonus_scale = max(bonuses) or 1
    scores = []
    for index, level in enumerate(levels):
        depth = min(1, max(0, (high - level) / span))
        stability = 1 / (1 + statistics.pstdev(levels[max(0, index - 2):min(len(levels), index + 3)]) / span)
        progress = max(0, (cells[index]["step"] - cells[first]["step"]) / max(1, cells[-1]["step"] - cells[first]["step"]))
        scores.append(depth * stability * min(1, depth / .5) * (1 - progress) ** .3 * (1 + .4 * bonuses[index] / bonus_scale) if index >= first else 0)
    return scores


def _score_regions(scores):
    """Peaks merge across shallow valleys; a deep score valley is a boundary."""
    peaks = [index for index in range(1, len(scores) - 1) if scores[index] > 0 and scores[index] >= scores[index - 1] and scores[index] >= scores[index + 1]]
    if not peaks:
        return []
    groups = [[peak] for peak in peaks]
    merged = []
    for group in groups:
        if not merged:
            merged.append(group)
            continue
        prior = merged[-1]
        left, right = prior[-1], group[0]
        if min(scores[left:right + 1]) >= min(scores[left], scores[right]) * .55:
            prior.extend(group)
        else:
            merged.append(group)
    result = []
    for group in sorted(merged, key=lambda item: max(scores[index] for index in item), reverse=True)[:6]:
        peak = max(group, key=lambda index: scores[index])
        threshold, start, end = scores[peak] * .25, peak, peak
        while start > 0 and scores[start - 1] >= threshold:
            start -= 1
        while end + 1 < len(scores) and scores[end + 1] >= threshold:
            end += 1
        result.append((start, end, peak))
    return sorted(result)


def _representative(cells, start, end, checkpoints):
    section = cells[start:end + 1]
    inside = [point for point in checkpoints if section[0]["startStep"] <= point["endStep"] <= section[-1]["endStep"]]
    if not inside:
        return None
    noise, settled = _noise(section), []
    for index, point in enumerate(section):
        before, after = section[max(0, index - 2):index], section[index + 1:min(len(section), index + 3)]
        slope = _median([cell["loss"] for cell in after]) - _median([cell["loss"] for cell in before]) if before and after else 0
        if abs(slope) <= 2 * noise:
            settled.append(point)
    settled_runs, run_start = [], None
    for index in range(len(section) + 1):
        is_settled = index < len(section) and section[index] in settled
        if is_settled and run_start is None:
            run_start = index
        elif not is_settled and run_start is not None:
            if index - run_start >= 3:
                settled_runs.append((section[run_start]["startStep"], section[index - 1]["endStep"]))
            run_start = None
    # A score neighborhood may start on an attractive downslope. A checkpoint
    # is eligible only when its entire saved epoch lies in settled evidence.
    candidates = [point for point in inside if any(
        run_start <= point["startStep"] and point["endStep"] <= run_end
        for run_start, run_end in settled_runs
    )] or inside
    center, half = (section[0]["startStep"] + section[-1]["endStep"]) / 2, max((section[-1]["endStep"] - section[0]["startStep"]) / 2, 1)
    floor, span = min(point["loss"] for point in section), max(max(point["loss"] for point in section) - min(point["loss"] for point in section), noise * 4)
    spread_span = max(max(point["spread"] for point in section), noise * 4)
    def score(checkpoint):
        point = min(section, key=lambda cell: abs(cell["step"] - checkpoint["endStep"]))
        return (
            1 if any(cell is point for cell in settled) else 0,
            -.40 * point["spread"] / spread_span + .35 * (1 - abs(checkpoint["endStep"] - center) / half) - .25 * (point["loss"] - floor) / span,
            -checkpoint["epoch"],
        )
    return max(candidates, key=score)


def detect(detailed_points, checkpoint_points):
    cells, _ = _prepare(detailed_points, checkpoint_points)
    scores = _scores(cells)
    if not scores:
        return {"analysisPoints": _public(cells), "regions": []}
    regions = []
    for start, end, _peak in _score_regions(scores):
        representative = _representative(cells, start, end, checkpoint_points)
        if representative is None:
            continue
        section = cells[start:end + 1]
        inside = [point for point in checkpoint_points if section[0]["startStep"] <= point["endStep"] <= section[-1]["endStep"]]
        regions.append({
            "startStep": section[0]["startStep"], "endStep": section[-1]["endStep"],
            "startEpoch": inside[0]["epoch"], "endEpoch": inside[-1]["epoch"],
            "representativeEpoch": representative["epoch"], "current": end == len(cells) - 1,
            "kind": "ranked_score_region", "label": "Ranked score region",
        })
    return {"analysisPoints": _public(cells), "regions": regions}
