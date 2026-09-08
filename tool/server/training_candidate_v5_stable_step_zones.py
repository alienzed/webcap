"""V5: multiscale, physical-step loss-basin triage over a fixed EMA."""

from bisect import bisect_left, bisect_right
from collections import deque
from statistics import median


EMA_RETENTION = .98
TREND_WIDTHS = (100, 250, 500, 1000)
SUPPORT_RADIUS = 500
FINAL_NMS_STEPS = 700
MAX_REGIONS = 8
MIN_FALLBACK_REGIONS = 3


def _ema_points(points):
    previous = None
    result = []
    for point in points:
        loss = float(point["loss"])
        previous = loss if previous is None else EMA_RETENTION * previous + (1 - EMA_RETENTION) * loss
        result.append({"step": int(point["step"]), "epoch": int(point["epoch"]), "loss": previous})
    return result


def _centered_trend(points, width):
    """Centered EMA averages with physical-step support on both sides."""
    steps = [point["step"] for point in points]
    prefix = [0.0]
    for point in points:
        prefix.append(prefix[-1] + point["loss"])
    half_width = width / 2
    values = []
    for index, step in enumerate(steps):
        if step - steps[0] < half_width or steps[-1] - step < half_width:
            values.append(None)
            continue
        left = bisect_left(steps, step - half_width)
        right = bisect_right(steps, step + half_width)
        values.append((prefix[right] - prefix[left]) / (right - left))
    return {"width": width, "steps": steps, "values": values}


def _window_highs(trend):
    """Maximum trend values one physical trend-width to each side, in O(n)."""
    steps, values, width = trend["steps"], trend["values"], trend["width"]
    left_high = [None] * len(steps)
    right_high = [None] * len(steps)
    left = deque()
    for index, step in enumerate(steps):
        while left and steps[left[0]] < step - width:
            left.popleft()
        left_high[index] = values[left[0]] if left else None
        if values[index] is not None:
            while left and values[left[-1]] <= values[index]:
                left.pop()
            left.append(index)
    right = deque()
    for index in range(len(steps) - 1, -1, -1):
        step = steps[index]
        while right and steps[right[0]] > step + width:
            right.popleft()
        right_high[index] = values[right[0]] if right else None
        if values[index] is not None:
            while right and values[right[-1]] <= values[index]:
                right.pop()
            right.append(index)
    return left_high, right_high


def _raw_minima(trend):
    steps, values = trend["steps"], trend["values"]
    left_high, right_high = _window_highs(trend)
    candidates = []
    index = 1
    while index < len(values) - 1:
        value = values[index]
        if value is None or values[index - 1] is None or values[index + 1] is None:
            index += 1
            continue
        end = index
        while end + 1 < len(values) and values[end + 1] == value:
            end += 1
        before = values[index - 1]
        after = values[end + 1] if end + 1 < len(values) else None
        if after is not None and value <= before and value <= after and (value < before or value < after):
            center = (index + end) // 2
            if left_high[center] is not None and right_high[center] is not None:
                prominence = max(0.0, min(left_high[center], right_high[center]) - values[center])
                candidates.append({"step": steps[center], "index": center, "loss": values[center],
                                   "prominence": prominence, "width": trend["width"]})
        index = end + 1
    return candidates


def _nms_minima(minima, width):
    separation = max(50, width / 2)
    retained = []
    bins = {}
    for minimum in sorted(minima, key=lambda item: (-item["prominence"], item["loss"], item["step"])):
        bucket = int(minimum["step"] // separation)
        nearby = [candidate for candidate_bucket in (bucket - 1, bucket, bucket + 1)
                  for candidate in bins.get(candidate_bucket, [])]
        if all(abs(minimum["step"] - candidate["step"]) >= separation for candidate in nearby):
            retained.append(minimum)
            bins.setdefault(bucket, []).append(minimum)
    return sorted(retained, key=lambda item: item["step"])


def _percentiles(minima):
    positive = sorted(item["prominence"] for item in minima if item["prominence"] > 0)
    for item in minima:
        if not positive or item["prominence"] <= 0:
            item["percentile"] = 0.0
        elif len(positive) == 1:
            item["percentile"] = 1.0
        else:
            item["percentile"] = (bisect_right(positive, item["prominence"]) - 1) / (len(positive) - 1)


def _within(minima, step, radius):
    steps = [item["step"] for item in minima]
    left = bisect_left(steps, step - radius)
    right = bisect_right(steps, step + radius)
    return minima[left:right]


def _support_minimum(minima, anchor_step):
    nearby = _within(minima, anchor_step, SUPPORT_RADIUS)
    if not nearby:
        return None
    return min(nearby, key=lambda item: (
        -item["prominence"] / (1 + abs(item["step"] - anchor_step) / SUPPORT_RADIUS),
        item["loss"], item["step"],
    ))


def _anchor_hypotheses(minima_by_width):
    anchors = []
    coarse = minima_by_width[1000]
    weights = {100: .10, 250: .20, 500: .30, 1000: .40}
    for coarse_anchor in coarse:
        support = {1000: coarse_anchor}
        for width in (100, 250, 500):
            support[width] = _support_minimum(minima_by_width[width], coarse_anchor["step"])
        supported = [item for item in support.values() if item is not None]
        prominence_score = sum(weights[width] * (support[width]["percentile"] if support[width] else 0.0)
                               for width in TREND_WIDTHS)
        offsets = [abs(item["step"] - coarse_anchor["step"]) for item in supported]
        alignment_score = 1 - min(1.0, median(offsets) / SUPPORT_RADIUS)
        anchors.append({
            "anchor": coarse_anchor,
            "support": support,
            "supportedScaleCount": len(supported),
            "prominenceScore": prominence_score,
            "persistenceScore": len(supported) / 4,
            "alignmentScore": alignment_score,
        })
    coarse_losses = [item["anchor"]["loss"] for item in anchors]
    for item in anchors:
        item["depthScore"] = sum(loss >= item["anchor"]["loss"] for loss in coarse_losses) / len(coarse_losses)
        item["basinScore"] = (.55 * item["prominenceScore"] + .15 * item["depthScore"]
                              + .20 * item["persistenceScore"] + .10 * item["alignmentScore"])
    return anchors


def _apply_floor_compatibility(hypotheses):
    positive = [item["anchor"]["prominence"] for item in hypotheses if item["anchor"]["prominence"] > 0]
    tolerance = 2 * median(positive) if positive else 0.0
    best_floor = None
    for item in sorted(hypotheses, key=lambda candidate: candidate["anchor"]["step"]):
        loss = item["anchor"]["loss"]
        item["floorCompatible"] = best_floor is None or loss <= best_floor + tolerance
        best_floor = loss if best_floor is None else min(best_floor, loss)
    return tolerance


def _ranked(hypotheses):
    return sorted(hypotheses, key=lambda item: (
        -item["basinScore"], -item["prominenceScore"], item["anchor"]["loss"], item["anchor"]["step"],
    ))


def _accept(selected, candidates, limit):
    for item in candidates:
        if len(selected) >= limit:
            break
        if all(abs(item["anchor"]["step"] - accepted["anchor"]["step"]) >= FINAL_NMS_STEPS for accepted in selected):
            selected.append(item)


def _fallback_anchor(trend):
    valid = [(index, value) for index, value in enumerate(trend["values"]) if value is not None]
    if not valid:
        return None
    minimum = min(value for _index, value in valid)
    tied_runs, run = [], []
    for index, value in valid:
        if value == minimum:
            run.append(index)
        elif run:
            tied_runs.append(run)
            run = []
    if run:
        tied_runs.append(run)
    tied = max(tied_runs, key=lambda item: (len(item), -item[0]))
    index = tied[len(tied) // 2]
    return {"step": trend["steps"][index], "index": index, "loss": minimum,
            "prominence": 0.0, "percentile": 0.0, "width": 1000}


def _nearest_trend_loss(trend, step):
    valid = [(trend_step, value) for trend_step, value in zip(trend["steps"], trend["values"]) if value is not None]
    if not valid:
        return float("inf")
    steps = [item[0] for item in valid]
    position = bisect_left(steps, step)
    choices = valid[max(0, position - 1):position + 1]
    return min(choices, key=lambda item: abs(item[0] - step))[1]


def _floor_center(hypothesis, minima_by_width):
    anchor = hypothesis["anchor"]
    for width in (250, 500, 100):
        nearby = _within(minima_by_width[width], anchor["step"], SUPPORT_RADIUS)
        if nearby:
            return min(nearby, key=lambda item: (item["loss"], -item["prominence"],
                                                  abs(item["step"] - anchor["step"]), item["step"]))
    return anchor


def _representative(floor_center, checkpoints, trend_250):
    nearby = [checkpoint for checkpoint in checkpoints
              if abs(checkpoint["endStep"] - floor_center["step"]) <= SUPPORT_RADIUS]
    candidates = nearby or checkpoints
    return min(candidates, key=lambda checkpoint: (
        _nearest_trend_loss(trend_250, checkpoint["endStep"]),
        abs(checkpoint["endStep"] - floor_center["step"]),
        -checkpoint["epoch"],
    ))


def _basin_boundaries(hypothesis, floor_center, representative, trends, minima_by_width, run_start, run_end):
    anchor = hypothesis["anchor"]
    support = _within(minima_by_width[500], anchor["step"], SUPPORT_RADIUS)
    basin_minimum = min(support, key=lambda item: (abs(item["step"] - floor_center["step"]), item["step"])) if support else anchor
    trend = trends[500]
    level = basin_minimum["loss"] + .5 * basin_minimum["prominence"]
    index = basin_minimum["index"]
    left = index
    while left > 0 and trend["steps"][left] >= anchor["step"] - 1000 and trend["values"][left] is not None and trend["values"][left] <= level:
        left -= 1
    right = index
    while right + 1 < len(trend["steps"]) and trend["steps"][right] <= anchor["step"] + 1000 and trend["values"][right] is not None and trend["values"][right] <= level:
        right += 1
    start = max(trend["steps"][left], anchor["step"] - 1000)
    end = min(trend["steps"][right], anchor["step"] + 1000)
    start = min(start, representative["endStep"])
    end = max(end, representative["endStep"])
    if end - start < 100:
        start = max(run_start, representative["endStep"] - 50)
        end = min(run_end, start + 100)
        start = max(run_start, end - 100)
    return start, end


def _region(hypothesis, representative, start, end, checkpoints, current):
    inside = [checkpoint for checkpoint in checkpoints if start <= checkpoint["endStep"] <= end]
    return {
        "startStep": start,
        "endStep": end,
        "startEpoch": inside[0]["epoch"] if inside else representative["epoch"],
        "endEpoch": inside[-1]["epoch"] if inside else representative["epoch"],
        "representativeEpoch": representative["epoch"],
        "current": current,
        "kind": "multiscale_loss_basin",
        "label": "Multiscale loss basin",
        "basinScore": hypothesis["basinScore"],
        "prominenceScore": hypothesis["prominenceScore"],
        "persistenceScore": hypothesis["persistenceScore"],
        "floorCenterStep": hypothesis["floorCenter"]["step"],
        "anchorStep": hypothesis["anchor"]["step"],
    }


def detect(detailed_points, checkpoint_points):
    raw_points = sorted(detailed_points, key=lambda point: point["step"])
    points = _ema_points(raw_points)
    if len(points) < 3 or not checkpoint_points:
        return {"analysisPoints": points, "regions": []}
    trends = {width: _centered_trend(points, width) for width in TREND_WIDTHS}
    minima_by_width = {width: _nms_minima(_raw_minima(trends[width]), width) for width in TREND_WIDTHS}
    for minima in minima_by_width.values():
        _percentiles(minima)
    hypotheses = _anchor_hypotheses(minima_by_width)
    _apply_floor_compatibility(hypotheses)
    normal = [item for item in hypotheses if item["supportedScaleCount"] >= 3 and item["floorCompatible"]]
    selected = []
    early = next((item for item in sorted(normal, key=lambda candidate: candidate["anchor"]["step"])
                  if item["prominenceScore"] >= .75 and item["persistenceScore"] >= .75), None)
    if early is not None:
        selected.append(early)
    _accept(selected, [item for item in _ranked(normal) if item is not early], MAX_REGIONS)
    if len(selected) < MIN_FALLBACK_REGIONS:
        fallback = [item for item in hypotheses if item["supportedScaleCount"] >= 2 and item not in selected]
        _accept(selected, _ranked(fallback), MIN_FALLBACK_REGIONS)
    if not selected:
        anchor = _fallback_anchor(trends[1000])
        if anchor is not None:
            selected = [{"anchor": anchor, "support": {1000: anchor}, "supportedScaleCount": 1,
                         "prominenceScore": 0.0, "persistenceScore": .25, "alignmentScore": 1.0,
                         "depthScore": 1.0, "basinScore": .4, "floorCompatible": True}]
    regions = []
    for hypothesis in sorted(selected, key=lambda item: item["anchor"]["step"]):
        floor_center = _floor_center(hypothesis, minima_by_width)
        hypothesis["floorCenter"] = floor_center
        representative = _representative(floor_center, checkpoint_points, trends[250])
        start, end = _basin_boundaries(hypothesis, floor_center, representative, trends, minima_by_width,
                                       points[0]["step"], points[-1]["step"])
        regions.append(_region(hypothesis, representative, start, end, checkpoint_points, end == points[-1]["step"]))
    return {"analysisPoints": points, "regions": regions}
