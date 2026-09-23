from io import BytesIO

from tool.server import app as app_module
from tool.server import generate_generation


def test_generate_enqueue_is_global_and_uses_frozen_prepared_request(monkeypatch):
    prepared = {
        "modelId": "minimax_h3",
        "mediaKind": "video",
        "sourcePrompt": "idea",
        "prompt": "resolved",
        "settings": {"seed": 42},
        "loras": [],
        "references": {},
    }
    seen = {}

    monkeypatch.setattr(app_module, "prepare_generate_request", lambda data: prepared)

    def fake_enqueue(request, label=""):
        seen["request"] = request
        seen["label"] = label
        return {"jobId": "job-1", "status": "queued", "queuePosition": 2}

    monkeypatch.setattr(app_module, "enqueue_generate", fake_enqueue)
    client = app_module.app.test_client()

    response = client.post("/fs/generate", json={
        "modelId": "minimax_h3",
        "prompt": "idea",
    })

    assert response.status_code == 200
    assert response.get_json()["job"]["jobId"] == "job-1"
    assert seen["request"] is prepared
    assert seen["label"] == "idea"


def test_generate_capabilities_results_and_inference_routes(monkeypatch):
    monkeypatch.setattr(app_module, "generate_capabilities", lambda: {
        "models": [{"id": "minimax_h3", "label": "MiniMax H3"}]
    })
    monkeypatch.setattr(app_module, "generate_list_results", lambda limit: [{"jobId": "done-1"}])
    monkeypatch.setattr(app_module, "inference_snapshot", lambda include_terminal=False: {
        "paused": False,
        "jobs": [{"jobId": "job-1", "status": "queued"}],
    })
    monkeypatch.setattr(app_module, "inference_action", lambda operation, job_id="", direction="", position=None: {
        "job": {"jobId": job_id, "status": "cancelled", "operation": operation}
    })

    client = app_module.app.test_client()

    capabilities = client.get("/fs/generate/capabilities")
    assert capabilities.status_code == 200
    assert capabilities.get_json()["models"][0]["id"] == "minimax_h3"

    results = client.get("/fs/generate/results")
    assert results.status_code == 200
    assert results.get_json()["results"] == [{"jobId": "done-1"}]

    queue = client.get("/fs/inference")
    assert queue.status_code == 200
    assert queue.get_json()["queue"]["jobs"][0]["jobId"] == "job-1"

    cancelled = client.post("/fs/inference", json={"operation": "cancel", "jobId": "job-1"})
    assert cancelled.status_code == 200
    assert cancelled.get_json()["job"]["status"] == "cancelled"


def test_generate_reference_upload_uses_generate_store(monkeypatch):
    monkeypatch.setattr(
        app_module,
        "generate_save_reference",
        lambda upload: {"id": "ref-1", "name": upload.filename, "path": ".webcap_runtime/generate-references/ref-1/frame.png"},
    )
    client = app_module.app.test_client()

    response = client.post(
        "/fs/generate/reference",
        data={"file": (BytesIO(b"image"), "frame.png")},
        content_type="multipart/form-data",
    )

    assert response.status_code == 200
    assert response.get_json()["reference"]["name"] == "frame.png"


def test_generate_capabilities_keeps_healthy_models_when_one_is_unavailable(monkeypatch):
    class FakeModel:
        def __init__(self, profile_id, label):
            self.PROFILE_ID = profile_id
            self.profile = {"label": label}

    models = {
        "minimax_h3": FakeModel("minimax_h3", "MiniMax H3"),
        "krea2": FakeModel("krea2", "Krea2"),
    }
    monkeypatch.setattr(generate_generation.inference_runtime, "system_stats", lambda: {})
    monkeypatch.setattr(
        generate_generation,
        "public_models",
        lambda: [
            {"id": "minimax_h3", "label": "MiniMax H3"},
            {"id": "krea2", "label": "Krea2"},
        ],
    )
    monkeypatch.setattr(generate_generation, "get_inference_model", lambda model_id: models[model_id])

    def fake_public_model(model):
        if model.PROFILE_ID == "krea2":
            raise RuntimeError("ComfyUI cannot see diffusion model: krea2_raw_bf16.safetensors")
        return {"id": model.PROFILE_ID, "label": model.profile["label"]}

    monkeypatch.setattr(generate_generation, "_public_model", fake_public_model)

    payload = generate_generation.capabilities()

    assert payload["models"] == [{"id": "minimax_h3", "label": "MiniMax H3"}]
    assert payload["unavailableModels"] == [{
        "id": "krea2",
        "label": "Krea2",
        "error": "ComfyUI cannot see diffusion model: krea2_raw_bf16.safetensors",
    }]


def test_generate_capabilities_publishes_portable_lora_names(monkeypatch):
    class FakeModel:
        PROFILE_ID = "minimax_h3"
        MEDIA_KIND = "video"
        settings = ("aspectRatio",)
        references = ()
        spec = {"default": True}
        profile = {"label": "MiniMax H3"}

        def load_template(self):
            return {}

        def available_lora_names(self, _available_names):
            return [r"mh3\\candidate.safetensors", r"mh3\\base.safetensors"]

        def resolve_assets(self, template, _available_names, _resolve_name):
            return template

        def base_loras(self, _workflow):
            return [r"mh3\\base.safetensors"]

        def setting_options(self, _template, _available_names):
            return {}

        def normalize_settings(self, _template, _new_seed, _values):
            return {"aspectRatio": "16:9"}

        def template_settings(self, _template):
            return {}

    model = FakeModel()
    payload = generate_generation._public_model(model)

    assert payload["loras"] == ["mh3/candidate.safetensors"]
    assert payload["baseLoras"] == ["mh3/base.safetensors"]
