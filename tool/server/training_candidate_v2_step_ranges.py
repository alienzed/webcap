"""V2: earned step-space floors with explicit stable-range detection."""

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
    # A median can be zero for a shelf sampled in repeated within-epoch cells;
    # retain ordinary shelf wiggle without letting isolated spikes dominate.
    upper_curvature = sorted(curvature)[int(.75 * (len(curvature) - 1))] if curvature else 0.0
    return max(_median([point["spread"] for point in cells]), upper_curvature / 2,
               max((abs(value) for value in levels), default=1) * 1e-10, 1e-12)


def _runs(flags, cells):
    result, start = [], None
    for index in range(len(flags) + 1):
        gap = index and index < len(cells) and cells[index]["bucket"] != cells[index - 1]["bucket"] + 1
        if start is not None and (index == len(flags) or not flags[index] or gap):
            result.append((start, index - 1))
            start = None
        if index < len(flags) and flags[index] and start is None:
            start = index
    return result


def _representative(cells, start, end, checkpoints):
    section = cells[start:end + 1]
    inside = [point for point in checkpoints if section[0]["startStep"] <= point["endStep"] <= section[-1]["endStep"]]
    if not inside:
        return None
    center = (section[0]["startStep"] + section[-1]["endStep"]) / 2
    half = max((section[-1]["endStep"] - section[0]["startStep"]) / 2, 1)
    noise, floor = _noise(section), min(point["loss"] for point in section)
    span = max(max(point["loss"] for point in section) - floor, noise * 4)
    spread_span = max(max(point["spread"] for point in section), noise * 4)
    def score(checkpoint):
        point = min(section, key=lambda cell: abs(cell["step"] - checkpoint["endStep"]))
        return (.55 * (1 - abs(checkpoint["endStep"] - center) / half)
                - .35 * point["spread"] / spread_span
                - .10 * (point["loss"] - floor) / span, -checkpoint["epoch"])
    return max(inside, key=score)


def _earned_floor(cells, start, end, accepted, noise, epoch_cells):
    level = _median([point["loss"] for point in cells[start:end + 1]])
    # A stable run often starts a few cells after the descent actually ends.
    # Look back about one epoch, derived from the recorded checkpoint width,
    # rather than imposing a startup-step rule.
    prior = cells[max(0, start - epoch_cells):start]
    recent_drop = prior and _median([point["loss"] for point in prior]) - level > 4 * noise
    if not accepted:
        return recent_drop
    previous_floor = min(item["level"] for item in accepted)
    recovered = start > accepted[-1]["end"] + 1 and any(
        abs(level - item["level"]) <= 2 * noise for item in accepted
    )
    return recent_drop or recovered or level < previous_floor - 2 * noise


def detect(detailed_points, checkpoint_points):
    cells, width = _prepare(detailed_points, checkpoint_points)
    if len(cells) < 4:
        return {"analysisPoints": _public(cells), "regions": []}
    noise = _noise(cells)
    epoch_steps = _median([point["endStep"] - point["startStep"] + 1 for point in checkpoint_points])
    epoch_cells = max(4, round(epoch_steps / width))
    flags = []
    for index, point in enumerate(cells):
        local = cells[max(0, index - 2):min(len(cells), index + 3)]
        before, after = cells[max(0, index - 2):index], cells[index + 1:min(len(cells), index + 3)]
        movement = _median([cell["loss"] for cell in after]) - _median([cell["loss"] for cell in before]) if before and after else 0
        flags.append(abs(point["loss"] - _median([cell["loss"] for cell in local])) <= 4 * noise
                     and point["spread"] <= 4 * noise and abs(movement) <= 4 * noise)
    for index in range(1, len(flags) - 1):
        if not flags[index] and flags[index - 1] and flags[index + 1]:
            if abs(cells[index - 1]["loss"] - cells[index + 1]["loss"]) <= 4 * noise and cells[index]["spread"] <= 4 * noise:
                flags[index] = True
    regions, accepted = [], []
    for start, end in _runs(flags, cells):
        section = cells[start:end + 1]
        if len(section) < 4 or section[-1]["endStep"] - section[0]["startStep"] + width < 4 * width:
            continue
        if abs(_median([point["loss"] for point in section[-2:]]) - _median([point["loss"] for point in section[:2]])) > 3 * noise:
            continue
        if not _earned_floor(cells, start, end, accepted, noise, epoch_cells):
            continue
        representative = _representative(cells, start, end, checkpoint_points)
        if representative is None:
            continue
        inside = [point for point in checkpoint_points if section[0]["startStep"] <= point["endStep"] <= section[-1]["endStep"]]
        regions.append({
            "startStep": section[0]["startStep"], "endStep": section[-1]["endStep"],
            "startEpoch": inside[0]["epoch"], "endEpoch": inside[-1]["epoch"],
            "representativeEpoch": representative["epoch"], "current": end == len(cells) - 1,
            "kind": "step_stable_range", "label": "Step stable range",
        })
        accepted.append({"level": _median([point["loss"] for point in section]), "end": end})
    return {"analysisPoints": _public(cells), "regions": regions}
