"""Preserved epoch-region candidate detector (v1)."""

import statistics


def _median(values):
    return statistics.median(values) if values else 0.0


def centered_median(points, radius=1):
    values = [float(point["loss"]) for point in points]
    result = []
    for index, point in enumerate(points):
        result.append({
            "epoch": int(point["epoch"]),
            "step": int(point.get("step", point["epoch"])),
            "startStep": int(point.get("startStep", point.get("step", point["epoch"]))),
            "endStep": int(point.get("endStep", point.get("step", point["epoch"]))),
            "loss": _median(values[max(0, index - radius):min(len(values), index + radius + 1)]),
        })
    return result


def _movement_scale(points):
    values = [float(point["loss"]) for point in points]
    movements = [abs(values[index] - values[index - 1]) for index in range(1, len(values))]
    nonzero = [value for value in movements if value > 0]
    return _median(nonzero) if nonzero else 0.0


def _has_strong_recent_descent(values, index, quiet):
    start = max(1, index - 3)
    deltas = [values[position] - values[position - 1] for position in range(start, index + 1)]
    return len(deltas) == 4 and _median(deltas) < -quiet


def _settled_anchor_indexes(trend, scale):
    """Find local minima and locally flat points, excluding a steady descent."""
    values = [float(point["loss"]) for point in trend]
    if len(values) < 3 or scale <= 0:
        return []
    quiet = scale * 0.75
    anchors = []
    for index in range(1, len(values) - 1):
        local_minimum = values[index] <= values[index - 1] and values[index] <= values[index + 1]
        locally_flat = abs(values[index] - values[index - 1]) <= quiet and abs(values[index + 1] - values[index]) <= quiet
        if (local_minimum or locally_flat) and not _has_strong_recent_descent(values, index, quiet):
            anchors.append(index)
    if abs(values[-1] - values[-2]) <= quiet and abs(values[-2] - values[-3]) <= quiet:
        for index in (len(values) - 2, len(values) - 1):
            if not _has_strong_recent_descent(values, index, quiet):
                anchors.append(index)
    return sorted(set(anchors))


def _region_intervals(trend, anchors, scale):
    """Expand and merge nearby settled evidence using only the epoch-level trend."""
    values = [float(point["loss"]) for point in trend]
    tolerance = scale * 1.5
    intervals = []
    for anchor in anchors:
        center, start, end = values[anchor], anchor, anchor
        while start > 0 and center - tolerance <= values[start - 1] <= center + tolerance:
            start -= 1
        while end + 1 < len(values) and center - tolerance <= values[end + 1] <= center + tolerance:
            end += 1
        intervals.append((start, end))
    merged = []
    for start, end in sorted(intervals):
        prior_floor = min(values[merged[-1][0]:merged[-1][1] + 1]) if merged else None
        current_floor = min(values[start:end + 1])
        same_region = prior_floor is not None and abs(prior_floor - current_floor) <= tolerance
        if not merged:
            merged.append([start, end])
        elif same_region and start <= merged[-1][1] + 1:
            merged[-1][1] = max(merged[-1][1], end)
        elif start <= merged[-1][1]:
            if current_floor < prior_floor:
                merged[-1][1] = start - 1
                if merged[-1][1] < merged[-1][0]:
                    merged.pop()
                merged.append([start, end])
            else:
                trimmed_start = merged[-1][1] + 1
                if trimmed_start <= end:
                    merged.append([trimmed_start, end])
        else:
            merged.append([start, end])
    return [tuple(interval) for interval in merged if interval[1] - interval[0] + 1 >= 2]


def _is_locally_settled(values, scale):
    if len(values) < 2 or scale <= 0:
        return False
    quiet = scale * 0.75
    return max(values) - min(values) <= scale and all(
        abs(values[index] - values[index - 1]) <= quiet for index in range(1, len(values))
    )


def _split_disturbed_interval(trend, start, end, scale):
    """Split one broad settled interval only around an exceptional recovered excursion."""
    if scale <= 0 or end - start + 1 < 6:
        return [(start, end)]
    values = [float(point["loss"]) for point in trend]
    threshold = scale * 2.0
    split = None
    for disturbance_start in range(start + 2, end - 3 + 1):
        for disturbance_end in range(disturbance_start + 1, end - 2 + 1):
            left = values[start:disturbance_start]
            disturbance = values[disturbance_start:disturbance_end + 1]
            right = values[disturbance_end + 1:end + 1]
            if not _is_locally_settled(left, scale) or not _is_locally_settled(right, scale):
                continue
            floor, ceiling = min(_median(left), _median(right)), max(_median(left), _median(right))
            above = all(value >= ceiling + threshold for value in disturbance)
            below = all(value <= floor - threshold for value in disturbance)
            if above or below:
                score = min((value - ceiling) if above else (floor - value) for value in disturbance)
                candidate = (score, -disturbance_start, -disturbance_end, disturbance_start, disturbance_end)
                if split is None or candidate > split:
                    split = candidate
    if split is None:
        return [(start, end)]
    disturbance_start, disturbance_end = split[-2:]
    return [(start, disturbance_start - 1), (disturbance_end + 1, end)]


def _split_disturbed_intervals(trend, intervals, scale):
    result = []
    for start, end in intervals:
        splits = _split_disturbed_interval(trend, start, end, scale)
        result.extend((split_start, split_end, len(splits) > 1 and index == 1) for index, (split_start, split_end) in enumerate(splits))
    return result


def _representative_index(robust_points, trend, start, end):
    return min(
        range(start, end + 1),
        key=lambda index: (float(trend[index]["loss"]), float(robust_points[index]["loss"]), int(robust_points[index]["epoch"])),
    )


def _region_explanation(trend, anchors, scale, start, end, representative, current, recovered):
    if recovered:
        return "post_disturbance_recovery", "Current stable region · Post-disturbance recovery" if current else "Post-disturbance recovery"
    if current:
        return "current_stable_region", "Current stable region"
    values = [float(point["loss"]) for point in trend]
    if 0 < representative < len(values) - 1 and values[representative] <= values[representative - 1] and values[representative] <= values[representative + 1] and (values[representative] < values[representative - 1] or values[representative] < values[representative + 1]):
        return "local_minimum", "Local minimum"
    quiet = scale * 0.75
    flat_anchors = [
        index for index in anchors if start <= index <= end and 0 < index < len(values) - 1
        and abs(values[index] - values[index - 1]) <= quiet
        and abs(values[index + 1] - values[index]) <= quiet
    ]
    if len(flat_anchors) >= 2:
        return "settled_plateau", "Settled plateau"
    return "stable_region", "Stable region"


def detect_settled_regions(robust_points):
    """Return the unchanged v1 epoch trend and settled regions."""
    trend = centered_median(robust_points)
    if len(trend) < 3:
        return trend, []
    scale = _movement_scale(trend)
    anchors = _settled_anchor_indexes(trend, scale)
    intervals = _split_disturbed_intervals(trend, _region_intervals(trend, anchors, scale), scale)
    regions = []
    for start, end, recovered in intervals:
        representative = _representative_index(robust_points, trend, start, end)
        current = end == len(robust_points) - 1
        kind, label = _region_explanation(trend, anchors, scale, start, end, representative, current, recovered)
        regions.append({
            "startEpoch": int(robust_points[start]["epoch"]),
            "endEpoch": int(robust_points[end]["epoch"]),
            "startStep": int(robust_points[start]["startStep"]),
            "endStep": int(robust_points[end]["endStep"]),
            "representativeEpoch": int(robust_points[representative]["epoch"]),
            "current": current,
            "kind": kind,
            "label": label,
        })
    return trend, regions


def detect(_detailed_points, checkpoint_points):
    trend, regions = detect_settled_regions(checkpoint_points)
    return {"analysisPoints": trend, "regions": regions}
