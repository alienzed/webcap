"""V4: macro descent followed by a sustained settled regime."""

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


def _runs(flags):
    result, start = [], None
    for index, flag in enumerate(flags + [False]):
        if flag and start is None:
            start = index
        elif not flag and start is not None:
            result.append((start, index - 1))
            start = None
    return result


def _representative(cells, start, end, checkpoints):
    section = cells[start:end + 1]
    inside = [point for point in checkpoints if section[0]["startStep"] <= point["endStep"] <= section[-1]["endStep"]]
    if not inside:
        return None
    noise = _noise(section)
    center, half = (section[0]["startStep"] + section[-1]["endStep"]) / 2, max((section[-1]["endStep"] - section[0]["startStep"]) / 2, 1)
    spread_span = max(max(point["spread"] for point in section), noise * 4)
    def score(checkpoint):
        point = min(section, key=lambda cell: abs(cell["step"] - checkpoint["endStep"]))
        return (.65 * (1 - abs(checkpoint["endStep"] - center) / half) - .35 * point["spread"] / spread_span, -checkpoint["epoch"])
    return max(inside, key=score)


def detect(detailed_points, checkpoint_points):
    cells, _ = _prepare(detailed_points, checkpoint_points)
    window = 4
    if len(cells) < window * 3:
        return {"analysisPoints": _public(cells), "regions": []}
    noise = _noise(cells)
    macro = [None] * len(cells)
    for index in range(window, len(cells) - window):
        macro[index] = _median([point["loss"] for point in cells[index:index + window]]) - _median([point["loss"] for point in cells[index - window:index]])
    threshold = 3 * noise
    descending = [value is not None and value < -threshold for value in macro]
    settled = [value is not None and abs(value) <= threshold for value in macro]
    for index in range(1, len(settled) - 1):
        if not settled[index] and settled[index - 1] and settled[index + 1]:
            settled[index] = True
    regions = []
    for start, end in _runs(settled):
        # The last macro comparison needs a leading window, so a current shelf
        # ends a few cells before the stream ends. Extend only that trailing
        # case; extending an earlier shelf would pull in the next descent.
        if end == len(cells) - window - 1:
            end = len(cells) - 1
        if end - start + 1 < 4:
            continue
        prior_start = max(window, start - window * 3)
        if sum(descending[prior_start:start]) < window:
            continue
        first = _median([point["loss"] for point in cells[prior_start:prior_start + window]])
        last = _median([point["loss"] for point in cells[start - window:start]])
        if first - last <= 6 * noise:
            continue
        section = cells[start:end + 1]
        if abs(_median([point["loss"] for point in section[-2:]]) - _median([point["loss"] for point in section[:2]])) > 3 * noise:
            continue
        representative = _representative(cells, start, end, checkpoint_points)
        if representative is None:
            continue
        inside = [point for point in checkpoint_points if section[0]["startStep"] <= point["endStep"] <= section[-1]["endStep"]]
        regions.append({
            "startStep": section[0]["startStep"], "endStep": section[-1]["endStep"],
            "startEpoch": inside[0]["epoch"], "endEpoch": inside[-1]["epoch"],
            "representativeEpoch": representative["epoch"], "current": end == len(cells) - 1,
            "kind": "convergence_regime", "label": "Convergence regime",
        })
    return {"analysisPoints": _public(cells), "regions": regions}
