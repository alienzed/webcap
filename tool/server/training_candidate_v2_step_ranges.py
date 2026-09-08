"""Experimental step-space stable-range candidate detector (v2)."""

import statistics


def _median(values):
    return statistics.median(values) if values else 0.0


def _quantile(values, fraction):
    ordered = sorted(float(value) for value in values)
    if not ordered:
        return 0.0
    index = (len(ordered) - 1) * fraction
    lower, upper = int(index), min(int(index) + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower)


def _samples_per_epoch(points):
    counts = {}
    for point in points:
        counts[int(point["epoch"])] = counts.get(int(point["epoch"]), 0) + 1
    return max(1, int(round(_median(counts.values()))))


def _rolling_signal(points, radius):
    values = [float(point["loss"]) for point in points]
    result = []
    for index, point in enumerate(points):
        window = values[max(0, index - radius):min(len(values), index + radius + 1)]
        level = _median(window)
        deviations = [abs(value - level) for value in window]
        result.append({
            "step": int(point["step"]),
            "epoch": int(point["epoch"]),
            "loss": level,
            "spread": _median(deviations),
        })
    return result


def _merge_short_gaps(flags, gap):
    result = flags[:]
    index = 0
    while index < len(result):
        if result[index]:
            index += 1
            continue
        start = index
        while index < len(result) and not result[index]:
            index += 1
        if start and index < len(result) and index - start <= gap:
            result[start:index] = [True] * (index - start)
    return result


def _ranges(flags, minimum):
    result, start = [], None
    for index, qualifies in enumerate(flags + [False]):
        if qualifies and start is None:
            start = index
        elif not qualifies and start is not None:
            if index - start >= minimum:
                result.append((start, index - 1))
            start = None
    return result


def _normalized(value, minimum, maximum):
    return 0.5 if maximum <= minimum else (value - minimum) / (maximum - minimum)


def _representative(checkpoints, signal, start, end):
    inside = [point for point in checkpoints if int(signal[start]["step"]) <= int(point["endStep"]) <= int(signal[end]["step"])]
    if len(inside) < 3:
        return None
    interior = inside[1:-1]
    center = (int(signal[start]["step"]) + int(signal[end]["step"])) / 2
    half_width = max(1.0, (int(signal[end]["step"]) - int(signal[start]["step"])) / 2)
    spread_by_epoch = {}
    level_by_epoch = {}
    for point in signal[start:end + 1]:
        epoch = int(point["epoch"])
        spread_by_epoch.setdefault(epoch, []).append(float(point["spread"]))
        level_by_epoch.setdefault(epoch, []).append(float(point["loss"]))
    spreads = {epoch: _median(values) for epoch, values in spread_by_epoch.items()}
    levels = {epoch: _median(values) for epoch, values in level_by_epoch.items()}
    minimum_spread, maximum_spread = min(spreads.values()), max(spreads.values())
    minimum_level, maximum_level = min(levels.values()), max(levels.values())
    return max(interior, key=lambda point: (
        0.45 * (1.0 - abs(int(point["endStep"]) - center) / half_width)
        + 0.40 * (1.0 - _normalized(spreads.get(int(point["epoch"]), maximum_spread), minimum_spread, maximum_spread))
        + 0.15 * (1.0 - _normalized(levels.get(int(point["epoch"]), maximum_level), minimum_level, maximum_level)),
        -int(point["epoch"]),
    ))


def detect(detailed_points, checkpoint_points):
    """Find low, quiet, non-descending detailed-step ranges and project to epochs."""
    points = sorted(detailed_points, key=lambda point: int(point["step"]))
    if len(points) < 3 or len(checkpoint_points) < 3:
        return {"analysisPoints": [], "regions": []}
    samples_per_epoch = _samples_per_epoch(points)
    radius = max(1, samples_per_epoch // 2)
    signal = _rolling_signal(points, radius)
    levels = [float(point["loss"]) for point in signal]
    spreads = [float(point["spread"]) for point in signal]
    loss_range = max(levels) - min(levels)
    if loss_range <= 0:
        return {"analysisPoints": signal, "regions": []}
    low_limit = _quantile(levels, 0.65)
    quiet_limit = max(_quantile(spreads, 0.65) * 3.0, loss_range * 0.002)
    slope_radius = max(1, samples_per_epoch)
    flat_limit = max(_quantile(spreads, 0.65) * 4.0, loss_range * 0.04)
    flags = []
    for index, point in enumerate(signal):
        left, right = max(0, index - slope_radius), min(len(signal) - 1, index + slope_radius)
        descent = float(signal[right]["loss"]) - float(signal[left]["loss"])
        flags.append(
            float(point["loss"]) <= low_limit
            and float(point["spread"]) <= quiet_limit
            and descent >= -flat_limit
        )
    flags = _merge_short_gaps(flags, radius)
    minimum_samples = max(samples_per_epoch * 2, radius * 3)
    regions = []
    for start, end in _ranges(flags, minimum_samples):
        representative = _representative(checkpoint_points, signal, start, end)
        if representative is None:
            continue
        eligible = [point for point in checkpoint_points if int(signal[start]["step"]) <= int(point["endStep"]) <= int(signal[end]["step"])]
        regions.append({
            "startEpoch": int(eligible[0]["epoch"]),
            "endEpoch": int(eligible[-1]["epoch"]),
            "startStep": int(signal[start]["step"]),
            "endStep": int(signal[end]["step"]),
            "representativeEpoch": int(representative["epoch"]),
            "current": end == len(signal) - 1,
            "kind": "step_stable_range",
            "label": "Current step-stable range" if end == len(signal) - 1 else "Step-stable range",
        })
    return {"analysisPoints": signal, "regions": regions}
