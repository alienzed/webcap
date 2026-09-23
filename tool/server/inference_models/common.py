SEED_MAX = (2 ** 32) - 1


def validate_seed(seed):
    try:
        value = int(seed)
    except (TypeError, ValueError) as exc:
        raise ValueError("Inference seed must be numeric.") from exc
    if value < 0 or value > SEED_MAX:
        raise ValueError("Inference seed must be between 0 and " + str(SEED_MAX) + ".")
    return value


def normalize_name(value):
    return str(value or "").replace("\\", "/").casefold()
