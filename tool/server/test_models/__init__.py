from ..training_profiles import profiles as training_profiles
from . import h3, krea2

_ADAPTERS = {
    "h3": h3,
    "krea2": krea2,
}


def _test_profiles():
    supported = {}
    for profile in training_profiles():
        policy = profile.get("test") if isinstance(profile.get("test"), dict) else {}
        if not policy.get("enabled"):
            continue
        adapter_name = str(policy.get("adapter") or "").strip()
        adapter = _ADAPTERS.get(adapter_name)
        if adapter is None:
            raise RuntimeError("Test model policy references unknown adapter: " + adapter_name)
        supported[str(profile["id"])] = (profile, policy, adapter)
    return supported


def get_test_model(profile_id):
    model_id = str(profile_id or "").strip()
    supported = _test_profiles()
    if not model_id:
        defaults = [
            item for item in supported.values()
            if item[1].get("default") is True
        ]
        if len(defaults) == 1:
            return defaults[0]
        raise ValueError("Test Generations requires a model ID.")
    try:
        return supported[model_id]
    except KeyError as exc:
        raise ValueError("Test Generations does not support model: " + model_id) from exc


def supported_profile_ids():
    return tuple(_test_profiles())


def supported_models():
    return [
        {
            "id": profile_id,
            "label": profile["label"],
            "mediaKind": str(policy.get("mediaKind") or ""),
            "settings": list(policy.get("settings") or ()),
        }
        for profile_id, (profile, policy, _adapter) in _test_profiles().items()
    ]
