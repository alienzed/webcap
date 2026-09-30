VALID_MODES = {"T2VA", "I2VA", "L2VA", "FL2VA"}


def mode_from_reference_roles(reference_roles):
    roles = {
        str(role or "").strip()
        for role in (reference_roles or [])
        if str(role or "").strip() in {"first_frame", "last_frame"}
    }
    if roles == {"first_frame", "last_frame"}:
        return "FL2VA"
    if roles == {"first_frame"}:
        return "I2VA"
    if roles == {"last_frame"}:
        return "L2VA"
    return "T2VA"


def _duration_text(duration):
    if isinstance(duration, bool):
        raise ValueError("MiniMax H3 duration must be numeric.")
    try:
        value = float(duration)
    except (TypeError, ValueError) as exc:
        raise ValueError("MiniMax H3 duration must be numeric.") from exc
    if value <= 0:
        raise ValueError("MiniMax H3 duration must be greater than zero.")
    return format(value, ".2f")


def alignment_line(mode, duration=None):
    mode = str(mode or "T2VA").strip().upper()
    if mode not in VALID_MODES:
        raise ValueError("Unsupported MiniMax H3 base mode: " + mode)
    if mode == "T2VA":
        return ""
    if mode == "I2VA":
        return "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced."

    duration_text = _duration_text(duration)
    if mode == "L2VA":
        return (
            "How the reference pictures align with the target video — <Picture 1> (from [Shot N]) "
            "aligns with the " + duration_text + "-second mark of the target video."
        )
    return (
        "How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns "
        "with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the "
        + duration_text + "-second mark of the target video."
    )
