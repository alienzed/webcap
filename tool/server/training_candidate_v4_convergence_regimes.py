"""V4: sustained descent followed by a sustained flatter regime."""

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


def detect(detailed_points, checkpoint_points):
    cells, _ = _prepare(detailed_points, checkpoint_points)
    if len(cells) < 8:
        return {"analysisPoints": _public(cells), "regions": []}
    noise = _noise(cells)
    # Adjacent robust-cell movement is normalized to observed noise.
    deltas = [0.0] + [b["loss"] - a["loss"] for a, b in zip(cells, cells[1:])]
    regions = []
    descent_start = None
    flat_start = None
    for i in range(1, len(cells) + 1):
        gap = i < len(cells) and cells[i]["bucket"] != cells[i - 1]["bucket"] + 1
        threshold = max(noise, cells[min(i, len(cells) - 1)]["spread"]) * 2
        movement = deltas[i] if i < len(cells) else float("inf")
        flat = abs(movement) <= threshold and not gap
        if flat_start is not None and (not flat or i == len(cells)):
            end = i - 1
            section = cells[flat_start:end + 1]
            drift = abs(_median([p["loss"] for p in section[-2:]]) - _median([p["loss"] for p in section[:2]]))
            if len(section) >= 4 and drift <= 3 * noise:
                region = _region(cells, flat_start, end, checkpoint_points, "convergence_regime", "Convergence regime", (.65, .30, .05))
                if region:
                    regions.append(region)
            flat_start = None
            descent_start = None
        if i == len(cells):
            break
        if gap or movement > threshold:
            descent_start = None
        elif movement < -threshold:
            if descent_start is None:
                descent_start = i - 1
        elif flat and descent_start is not None and flat_start is None:
            descent = cells[descent_start]["loss"] - cells[i - 1]["loss"]
            if i - 1 - descent_start >= 3 and descent > 6 * noise:
                flat_start = i - 1
            else:
                descent_start = None
    return {"analysisPoints": _public(cells), "regions": regions}
