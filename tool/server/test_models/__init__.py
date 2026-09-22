import json
from pathlib import Path

from ..training_profiles import profiles as training_profiles
from . import h3, krea2

_ADAPTERS = {
    "h3": h3,
    "krea2": krea2,
}
_TEMPLATE_ROOT = Path(__file__).resolve().parents[2] / "templates" / "comfyui"


class TestModel:
    def __init__(self, profile, policy, adapter):
        self.profile = profile
        self.policy = policy
        self.adapter = adapter
        self.PROFILE_ID = str(profile["id"])
        self.STAGING_KEY = str(policy["stagingKey"])
        self.SESSION_SLUG = str(policy["sessionSlug"])
        self.MEDIA_KIND = str(policy["mediaKind"])
        self.TEMPLATE_PATH = _TEMPLATE_ROOT / str(policy["workflowFile"])
        self.settings = tuple(policy.get("settings") or ())

    def load_template(self):
        try:
            workflow = json.loads(self.TEMPLATE_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError("Could not read Test workflow template: " + self.TEMPLATE_PATH.name) from exc
        if not isinstance(workflow, dict):
            raise ValueError("Test workflow template must be a JSON object: " + self.TEMPLATE_PATH.name)
        return workflow

    def __getattr__(self, name):
        return getattr(self.adapter, name)


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
        supported[str(profile["id"])] = TestModel(profile, policy, adapter)
    return supported


def get_test_model(profile_id=None):
    supported = _test_profiles()
    model_id = str(profile_id or "").strip()
    if not model_id:
        defaults = [model for model in supported.values() if model.policy.get("default") is True]
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
            "id": model.PROFILE_ID,
            "label": str(model.profile["label"]),
            "mediaKind": model.MEDIA_KIND,
            "settings": list(model.settings),
            "default": model.policy.get("default") is True,
        }
        for model in _test_profiles().values()
    ]
