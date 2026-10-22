import json
from pathlib import Path

from ..training_profiles import MINIMAX_H3_PROFILE_ID, KREA2_PROFILE_ID, profile
from . import h3, krea2


_TEMPLATE_ROOT = Path(__file__).resolve().parents[2] / "templates" / "comfyui"
_MODEL_SPECS = {
    MINIMAX_H3_PROFILE_ID: {
        "adapter": h3,
        "mediaKind": "video",
        "workflowFile": "minimax_h3_inference_single_api.json",
        "settings": ("aspectRatio", "megapixels", "duration", "samplingMode", "seed"),
        "references": ("first_frame", "last_frame"),
        "default": True,
    },
    KREA2_PROFILE_ID: {
        "adapter": krea2,
        "mediaKind": "image",
        "workflowFile": "krea2_test_api.json",
        "settings": ("dimensions", "seed"),
        "references": (),
        "default": False,
    },
}


class InferenceModel:
    def __init__(self, profile_id, spec):
        self.profile = profile(profile_id)
        self.spec = spec
        self.adapter = spec["adapter"]
        self.PROFILE_ID = profile_id
        self.MEDIA_KIND = str(spec["mediaKind"])
        self.TEMPLATE_PATH = _TEMPLATE_ROOT / str(spec["workflowFile"])
        self.settings = tuple(spec.get("settings") or ())
        self.references = tuple(spec.get("references") or ())

    def template_path(self, sampling_mode=None):
        files = getattr(self.adapter, "WORKFLOW_FILES", None)
        return _TEMPLATE_ROOT / files[self.adapter.normalize_sampling_mode(sampling_mode)] if files else self.TEMPLATE_PATH

    def load_template(self, sampling_mode=None):
        path = self.template_path(sampling_mode)
        try:
            workflow = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError("Could not read inference workflow template: " + path.name) from exc
        if not isinstance(workflow, dict):
            raise ValueError("Inference workflow template must be a JSON object: " + path.name)
        return workflow

    def __getattr__(self, name):
        return getattr(self.adapter, name)


_MODELS = {model_id: InferenceModel(model_id, spec) for model_id, spec in _MODEL_SPECS.items()}


def get_inference_model(profile_id=None):
    model_id = str(profile_id or "").strip()
    if not model_id:
        defaults = [model for model in _MODELS.values() if model.spec.get("default") is True]
        if len(defaults) == 1:
            return defaults[0]
        raise ValueError("Inference requires a model ID.")
    try:
        return _MODELS[model_id]
    except KeyError as exc:
        raise ValueError("Generate does not support model: " + model_id) from exc


def supported_models():
    return list(_MODELS.values())


def public_models():
    return [
        {
            "id": model.PROFILE_ID,
            "label": str(model.profile["label"]),
            "mediaKind": model.MEDIA_KIND,
            "settings": list(model.settings),
            "references": list(model.references),
            "default": model.spec.get("default") is True,
        }
        for model in _MODELS.values()
    ]
