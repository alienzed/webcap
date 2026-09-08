"""V2: locally low/quiet step ranges with anchored regime segmentation."""

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


def _runs(flags, cells):
    runs, start = [], None
    for i in range(len(flags) + 1):
        separated = i > 0 and i < len(cells) and cells[i]["bucket"] != cells[i - 1]["bucket"] + 1
        if start is not None and (i == len(flags) or not flags[i] or separated):
            runs.append((start, i - 1))
            start = None
        if i < len(flags) and flags[i] and start is None:
            start = i
    return runs


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


def detect(detailed_points, checkpoint_points):
    cells, width = _prepare(detailed_points, checkpoint_points)
    if len(cells) < 4:
        return {"analysisPoints": _public(cells), "regions": []}
    noise = _noise(cells)
    flags = []
    for i, point in enumerate(cells):
        local = cells[max(0, i - 2):min(len(cells), i + 3)]
        broader = cells[max(0, i - 16):min(len(cells), i + 17)]
        before = cells[max(0, i - 2):i]
        after = cells[i + 1:min(len(cells), i + 3)]
        movement = (_median([p["loss"] for p in after]) - _median([p["loss"] for p in before])
                    if before and after else local[-1]["loss"] - local[0]["loss"])
        local_noise = max(noise, _median([p["spread"] for p in local]))
        flags.append(point["loss"] <= _median([p["loss"] for p in broader]) + 2 * noise
                     and point["spread"] <= 3 * noise
                     and abs(movement) <= 2 * local_noise)
    # Bridge just one cell, and only when both sides agree in level/stability.
    for i in range(1, len(flags) - 1):
        if not flags[i] and flags[i - 1] and flags[i + 1]:
            if (abs(cells[i - 1]["loss"] - cells[i + 1]["loss"]) <= 2 * noise
                    and cells[i]["spread"] <= 3 * noise
                    and cells[i - 1]["bucket"] + 2 == cells[i + 1]["bucket"]):
                flags[i] = True
    segments = []
    for start, end in _runs(flags, cells):
        anchor = start
        for i in range(start + 2, end):
            baseline = cells[anchor:min(anchor + 3, i)]
            following = cells[i:min(i + 3, end + 1)]
            changed_level = abs(_median([p["loss"] for p in following]) - _median([p["loss"] for p in baseline])) > 4 * noise
            changed_spread = abs(_median([p["spread"] for p in following]) - _median([p["spread"] for p in baseline])) > 2 * noise
            if changed_level or changed_spread:
                segments.append((anchor, i - 1))
                anchor = i
        segments.append((anchor, end))
    regions = []
    for start, end in segments:
        section = cells[start:end + 1]
        if len(section) < 4 or section[-1]["endStep"] - section[0]["startStep"] + width / 3 < 3 * width:
            continue
        # A small coherent drift over the entire region is still a descent/rise.
        if abs(_median([p["loss"] for p in section[-2:]]) - _median([p["loss"] for p in section[:2]])) > 3 * noise:
            continue
        region = _region(cells, start, end, checkpoint_points, "step_stable_range", "Step stable range")
        if region:
            regions.append(region)
    return {"analysisPoints": _public(cells), "regions": regions}
