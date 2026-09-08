"""V5: nested-window stationarity agreement, without a low-loss/prior-descent gate."""

import statistics


def _median(values):
    return statistics.median(values) if values else 0.0


def _prepare(detailed, checkpoints):
    """Robust, equal-step cells (one sixteenth of a typical completed epoch).

    Cells use actual optimizer steps, so denser logging doesn't stretch time.
    Median/MAD reject isolated extremes before any scoring or segmentation.
    """
    ordered = sorted(detailed, key=lambda point: point["step"])
    if not ordered or not checkpoints:
        return [], 1.0
    gaps = [b["step"] - a["step"] for a, b in zip(ordered, ordered[1:]) if b["step"] > a["step"]]
    spacing = _median(gaps) or 1.0
    epoch_steps = _median([p["endStep"] - p["startStep"] + spacing for p in checkpoints])
    width = max(spacing * 3, epoch_steps / 16)
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


def _stationary(section, noise):
    """Equivalent quarter levels and spreads at this scale, not a p-value test."""
    if len(section) < 4:
        return False
    size = max(1, len(section) // 4)
    quarters = [section[i * size:(i + 1) * size] for i in range(3)] + [section[3 * size:]]
    levels = [_median([p["loss"] for p in q]) for q in quarters]
    spreads = [_median([p["spread"] for p in q]) for q in quarters]
    # Both level equivalence and variance equivalence must hold.
    tolerance = max(noise * 3, _median(spreads) * 2)
    return max(levels) - min(levels) <= tolerance and max(spreads) - min(spreads) <= 3 * noise


def detect(detailed_points, checkpoint_points):
    cells, _ = _prepare(detailed_points, checkpoint_points)
    if len(cells) < 8:
        return {"analysisPoints": _public(cells), "regions": []}
    noise = _noise(cells)
    flags = [False] * len(cells)
    for start in range(len(cells) - 7):
        short, longer = cells[start:start + 4], cells[start:start + 8]
        if longer[-1]["bucket"] - longer[0]["bucket"] != 7:
            continue
        if _stationary(short, noise) and _stationary(longer, noise):
            flags[start:start + 8] = [True] * 8
    regions = []
    for start, end in _runs(flags, cells):
        # Anchor agreement prevents many individually acceptable windows from
        # chaining into a long slowly drifting interval.
        anchor = start
        for stop in range(start + 8, end + 2):
            if stop == end + 1 or not _stationary(cells[anchor:anchor + 4] + cells[stop - 3:stop + 1], noise):
                last = stop if stop == end + 1 else stop - 1
                if last - anchor >= 8:
                    region = _region(cells, anchor, last - 1, checkpoint_points, "multiscale_stationarity", "Multiscale stationarity", (.65, .35, 0))
                    if region:
                        regions.append(region)
                anchor = stop
    return {"analysisPoints": _public(cells), "regions": regions}
