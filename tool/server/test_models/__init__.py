from . import h3

_MODELS = {
    h3.PROFILE_ID: h3,
}


def get_test_model(profile_id):
    model_id = str(profile_id or "").strip()
    try:
        return _MODELS[model_id]
    except KeyError as exc:
        raise ValueError("Test Generations does not support model: " + (model_id or "(none)")) from exc


def supported_profile_ids():
    return tuple(_MODELS)
