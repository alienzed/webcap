"""V5: physical-step stable regimes measured from a fixed EMA loss trajectory."""


EMA_RETENTION = .98
EVIDENCE_STEPS = 100
CHANGE_CONFIRM_STEPS = 30
MAX_DOWNWARD_CHANGE = .01
MAX_UPWARD_CHANGE = .005
MAX_MEAN_ABSOLUTE_RESIDUAL = .001
GENTLE_DIRECTION_CHANGE = .001
MAX_STABLE_SLOPE_CHANGE = .004


def _ema_points(points):
    previous = None
    result = []
    for point in points:
        loss = float(point["loss"])
        previous = loss if previous is None else EMA_RETENTION * previous + (1 - EMA_RETENTION) * loss
        result.append({"step": point["step"], "epoch": point["epoch"], "loss": previous})
    return result


def _local_line(points, start, end):
    """Fit one bounded physical-step window and return slope plus mean residual."""
    window = points[start:end + 1]
    count = len(window)
    mean_x = sum(point["step"] for point in window) / count
    mean_y = sum(point["loss"] for point in window) / count
    variance = sum((point["step"] - mean_x) ** 2 for point in window)
    slope = (sum((point["step"] - mean_x) * (point["loss"] - mean_y) for point in window) / variance
             if variance else 0.0)
    intercept = mean_y - slope * mean_x
    mean_residual = sum(abs(point["loss"] - (intercept + slope * point["step"])) for point in window) / count
    return slope, mean_residual


def _state(slope, mean_residual):
    change = slope * EVIDENCE_STEPS
    if mean_residual > MAX_MEAN_ABSOLUTE_RESIDUAL:
        return "wandering", change
    if change < -MAX_DOWNWARD_CHANGE:
        return "down", change
    if change > MAX_UPWARD_CHANGE:
        return "up", change
    if change < -GENTLE_DIRECTION_CHANGE:
        return "gentle_down", change
    if change > GENTLE_DIRECTION_CHANGE:
        return "gentle_up", change
    return "flat", change


def _is_stable(state):
    return state in ("flat", "gentle_down", "gentle_up")


def _representative(start_step, end_step, checkpoints):
    inside = [checkpoint for checkpoint in checkpoints
              if start_step <= checkpoint["endStep"] <= end_step]
    if not inside:
        return None, inside
    midpoint = (start_step + end_step) / 2
    return min(inside, key=lambda checkpoint: (abs(checkpoint["endStep"] - midpoint), checkpoint["epoch"])), inside


def _append_region(regions, points, start, end, checkpoints, current):
    if end < start or points[end]["step"] - points[start]["step"] < EVIDENCE_STEPS:
        return
    representative, inside = _representative(points[start]["step"], points[end]["step"], checkpoints)
    if representative is None:
        return
    regions.append({
        "startStep": points[start]["step"],
        "endStep": points[end]["step"],
        "startEpoch": inside[0]["epoch"],
        "endEpoch": inside[-1]["epoch"],
        "representativeEpoch": representative["epoch"],
        "current": current,
        "kind": "stable_step_zone",
        "label": "Stable step zone",
    })


def detect(detailed_points, checkpoint_points):
    raw_points = sorted(detailed_points, key=lambda point: point["step"])
    points = _ema_points(raw_points)
    if len(points) < 3 or not checkpoint_points:
        return {"analysisPoints": points, "regions": []}

    regions = []
    window_start = 0
    active_start = None
    active_state = None
    active_change = None
    pending_break = None
    pending_window_start = None
    pending_state = None
    for index, point in enumerate(points):
        while points[window_start]["step"] < point["step"] - EVIDENCE_STEPS:
            window_start += 1
        if point["step"] - points[window_start]["step"] < EVIDENCE_STEPS:
            continue
        slope, mean_residual = _local_line(points, window_start, index)
        state, change = _state(slope, mean_residual)
        if _is_stable(state) and active_start is None:
            active_start = window_start
            active_state = state
            active_change = change
            pending_break = None
            pending_window_start = None
            pending_state = None
            continue
        if _is_stable(state) and state == active_state and abs(change - active_change) <= MAX_STABLE_SLOPE_CHANGE:
            pending_break = None
            pending_window_start = None
            pending_state = None
            continue
        if _is_stable(state):
            state = "regime_change:" + state
        if active_start is None:
            continue
        if pending_break is None or pending_state != state:
            pending_break = index
            pending_window_start = window_start
            pending_state = state
            continue
        if point["step"] - points[pending_break]["step"] < CHANGE_CONFIRM_STEPS:
            continue
        # A confirmed departure never belongs to either region. The old run
        # closes before its first unstable EMA window; any later shelf must
        # earn a fresh 100-step window before it can become a new region.
        _append_region(regions, points, active_start, pending_window_start - 1, checkpoint_points, False)
        active_start = None
        active_state = None
        active_change = None
        pending_break = None
        pending_window_start = None
        pending_state = None

    if active_start is not None:
        end = (pending_window_start - 1) if pending_break is not None else len(points) - 1
        _append_region(regions, points, active_start, end, checkpoint_points, pending_break is None and end == len(points) - 1)
    return {"analysisPoints": points, "regions": regions}
