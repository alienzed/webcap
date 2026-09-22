TEST_SEED_MAX = (2 ** 32) - 1


def validate_test_seed(seed):
    try:
        value = int(seed)
    except (TypeError, ValueError) as exc:
        raise ValueError("Test seed must be numeric.") from exc
    if value < 0 or value > TEST_SEED_MAX:
        raise ValueError(
            "Test seed must be between 0 and " + str(TEST_SEED_MAX) + "."
        )
    return value
