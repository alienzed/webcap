from pathlib import Path
from io import BytesIO

import pytest

from tool.server import app as app_module
from tool.server import generate_generation
from tool.server import generate_store


@pytest.fixture(autouse=True)
def isolate_generate_output_root(monkeypatch):
    monkeypatch.setattr(
        generate_store.app_config,
        "output_root",
        lambda: Path(generate_store.app_config.FS_ROOT) / "output",
    )


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


def test_generate_director_passes_reference_roles_into_h3_contract(monkeypatch):
    seen = {}

    def fake_contract(model_id, operation, prompt="", instruction="", settings=None, reference_roles=None):
        seen["modelId"] = model_id
        seen["operation"] = operation
        seen["referenceRoles"] = reference_roles
        return {"operation": operation, "output": "text", "prompt": "contract"}

    monkeypatch.setattr(app_module, "generate_build_director_request", fake_contract)
    monkeypatch.setattr(
        app_module,
        "enqueue_llm",
        lambda client, model_id, contract, context=None, label="": {
            "jobId": "llm-1",
            "status": "queued",
            "queuePosition": 1,
        },
    )
    client = app_module.app.test_client()

    response = client.post("/fs/generate/director", json={
        "modelId": "minimax_h3",
        "directorModel": "director.gguf",
        "operation": "write_prompt",
        "prompt": "A woman crosses a lobby.",
        "settings": {"duration": 8},
        "referenceRoles": ["first_frame", "last_frame"],
    })

    assert response.status_code == 202
    assert seen == {
        "modelId": "minimax_h3",
        "operation": "write_prompt",
        "referenceRoles": ["first_frame", "last_frame"],
    }


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

def test_generate_enqueue_failure_cleans_uploaded_references(monkeypatch):
    cleaned = []
    monkeypatch.setattr(
        app_module,
        "prepare_generate_request",
        lambda _data: (_ for _ in ()).throw(ValueError("bad request")),
    )
    monkeypatch.setattr(
        app_module,
        "generate_cleanup_references",
        lambda references: cleaned.append(dict(references)),
    )
    client = app_module.app.test_client()

    response = client.post("/fs/generate", json={
        "modelId": "minimax_h3",
        "prompt": "idea",
        "references": {"first_frame": ".webcap_runtime/generate-references/ref-1/frame.png"},
    })

    assert response.status_code == 400
    assert cleaned == [{
        "first_frame": ".webcap_runtime/generate-references/ref-1/frame.png"
    }]


def test_generate_list_normalizes_legacy_manifest_paths(tmp_path, monkeypatch):
    monkeypatch.setattr(generate_store.app_config, "FS_ROOT", tmp_path)
    root = tmp_path / "output"
    monkeypatch.setattr(generate_store.app_config, "output_root", lambda: root)

    directory = root / "generations" / "2026-09-23" / "job-1"
    directory.mkdir(parents=True)
    (directory / "result.mp4").write_bytes(b"video")
    (directory / "generation.json").write_text(
        '{"version":1,"jobId":"job-1","createdAt":1,'
        '"mediaPath":"output/generations/2026-09-23/job-1/result.mp4",'
        '"manifestPath":"output/generations/2026-09-23/job-1/generation.json"}',
        encoding="utf-8",
    )

    result = generate_store.list_results()[0]

    assert result["mediaPath"] == "generations/2026-09-23/job-1/result.mp4"
    assert result["manifestPath"] == "generations/2026-09-23/job-1/generation.json"
    assert generate_store.resolve_result_media(result["mediaPath"]).read_bytes() == b"video"


def test_generate_result_uses_configured_output_root_outside_fs_root(tmp_path, monkeypatch):
    fs_root = tmp_path / "sets"
    output_root = tmp_path / "creative"
    fs_root.mkdir()
    monkeypatch.setattr(generate_store.app_config, "FS_ROOT", fs_root)
    monkeypatch.setattr(generate_store.app_config, "output_root", lambda: output_root)

    payload = generate_store.persist_result(
        "job-1",
        {
            "modelId": "minimax_h3",
            "mediaKind": "video",
            "sourcePrompt": "idea",
            "prompt": "resolved",
            "settings": {"seed": 7},
            "loras": [],
            "references": {},
            "wildcardsEnabled": False,
            "workflowFile": "workflow.json",
        },
        {"filename": "render.mp4", "type": "output"},
        b"video",
        "provider-1",
        123,
    )

    assert payload["mediaPath"].startswith("generations/")
    assert payload["manifestPath"].startswith("generations/")
    assert (output_root / payload["mediaPath"]).read_bytes() == b"video"
    assert not (fs_root / "output" / "generations").exists()


def test_generate_result_owns_reference_copy_before_transient_cleanup(tmp_path, monkeypatch):
    monkeypatch.setattr(generate_store.app_config, "FS_ROOT", tmp_path)
    source_dir = generate_store.reference_root() / "ref-1"
    source_dir.mkdir(parents=True)
    source = source_dir / "frame.png"
    source.write_bytes(b"reference")
    relative_source = str(source.relative_to(tmp_path)).replace("\\", "/")

    payload = generate_store.persist_result(
        "job-1",
        {
            "modelId": "minimax_h3",
            "mediaKind": "video",
            "sourcePrompt": "idea",
            "prompt": "resolved",
            "settings": {"seed": 7},
            "loras": [],
            "references": {"first_frame": relative_source},
            "wildcardsEnabled": False,
            "workflowFile": "workflow.json",
        },
        {"filename": "render.mp4", "type": "output"},
        b"video",
        "provider-1",
        123,
    )
    durable_reference = tmp_path / payload["references"]["first_frame"]

    assert durable_reference.read_bytes() == b"reference"
    assert payload["references"]["first_frame"] != relative_source

    removed = generate_store.cleanup_references({"first_frame": relative_source})

    assert removed == 1
    assert not source.exists()
    assert durable_reference.read_bytes() == b"reference"

def test_generate_execute_cleans_transient_refs_and_captured_provider_output(tmp_path, monkeypatch):
    class FakeModel:
        def load_template(self):
            return {}

        def build_workflow(
            self,
            template,
            prompt,
            settings,
            loras,
            uploaded,
            filename_prefix,
            available_names,
            resolve_name,
        ):
            assert uploaded == {"first_frame": "uploaded/frame.png"}
            return {"workflow": True}

        def find_output_ref(self, outputs):
            return outputs

    reference = tmp_path / "frame.png"
    reference.write_bytes(b"reference")
    output_ref = {
        "filename": "render.mp4",
        "type": "output",
        "fullpath": str(tmp_path / "comfy-render.mp4"),
    }
    Path(output_ref["fullpath"]).write_bytes(b"provider-video")

    monkeypatch.setattr(generate_generation, "get_inference_model", lambda _model_id: FakeModel())
    monkeypatch.setattr(generate_generation, "resolve_reference_path", lambda _path: reference)
    monkeypatch.setattr(
        generate_generation.inference_runtime,
        "upload_image",
        lambda *_args, **_kwargs: "uploaded/frame.png",
    )
    monkeypatch.setattr(generate_generation.inference_runtime, "available_names", lambda *_args: [])
    monkeypatch.setattr(generate_generation.inference_runtime, "resolve_name", lambda value, *_args: value)
    monkeypatch.setattr(generate_generation.inference_runtime, "queue_workflow", lambda _workflow: "provider-1")
    monkeypatch.setattr(
        generate_generation.inference_runtime,
        "wait_for_output",
        lambda *_args: output_ref,
    )
    monkeypatch.setattr(generate_generation.inference_runtime, "download_output", lambda _ref: b"video")
    monkeypatch.setattr(generate_generation, "execution_update_job", lambda *_args, **_kwargs: None)
    cleaned_refs = []
    monkeypatch.setattr(
        generate_generation,
        "cleanup_references",
        lambda references: cleaned_refs.append(dict(references)),
    )
    monkeypatch.setattr(
        generate_generation,
        "persist_result",
        lambda *args, **kwargs: {"jobId": "job-1", "mediaPath": "output/generations/result.mp4"},
    )

    result = generate_generation.execute("job-1", {
        "modelId": "minimax_h3",
        "prompt": "Prompt",
        "settings": {"seed": 7},
        "loras": [],
        "references": {"first_frame": "runtime/frame.png"},
    })

    assert result["jobId"] == "job-1"
    assert cleaned_refs == [{"first_frame": "runtime/frame.png"}]
    assert not Path(output_ref["fullpath"]).exists()

def test_generate_reference_cleanup_route_is_scoped_to_store_helper(monkeypatch):
    seen = []
    monkeypatch.setattr(
        app_module,
        "generate_cleanup_references",
        lambda paths: seen.extend(paths) or len(paths),
    )
    client = app_module.app.test_client()

    response = client.post("/fs/generate/reference/cleanup", json={
        "paths": [
            ".webcap_runtime/generate-references/ref-1/first.png",
            ".webcap_runtime/generate-references/ref-2/last.png",
        ]
    })

    assert response.status_code == 200
    assert response.get_json()["removed"] == 2
    assert seen == [
        ".webcap_runtime/generate-references/ref-1/first.png",
        ".webcap_runtime/generate-references/ref-2/last.png",
    ]



def test_generate_result_rating_uses_generation_store(monkeypatch):
    seen = {}
    monkeypatch.setattr(
        app_module,
        "generate_rate_result",
        lambda storage_id, rating: seen.update({"storageId": storage_id, "rating": rating}) or {
            "storageId": storage_id,
            "mediaKey": "result.mp4",
            "rating": 4,
        },
    )
    client = app_module.app.test_client()

    response = client.post("/fs/generate/result/rating", json={
        "storageId": "2026-09-25/job-1",
        "rating": 4,
    })

    assert response.status_code == 200
    assert response.get_json()["rating"] == 4
    assert seen == {"storageId": "2026-09-25/job-1", "rating": 4}


def test_generate_result_rating_persists_in_canonical_media_state(tmp_path, monkeypatch):
    output_root = tmp_path / "creative"
    monkeypatch.setattr(generate_store.app_config, "output_root", lambda: output_root)
    directory = output_root / "generations" / "2026-09-25" / "job-1"
    directory.mkdir(parents=True)
    (directory / "result.mp4").write_bytes(b"video")
    (directory / "generation.json").write_text(
        '{"version":2,"jobId":"job-1","createdAt":1,'
        '"mediaPath":"generations/2026-09-25/job-1/result.mp4"}',
        encoding="utf-8",
    )

    saved = generate_store.rate_result("2026-09-25/job-1", 4)
    listed = generate_store.list_results()[0]

    assert saved["rating"] == 4
    assert listed["rating"] == 4
    assert (directory / ".webcap_state.json").is_file()


def test_generate_delete_route_uses_storage_purge(monkeypatch):
    seen = []
    monkeypatch.setattr(
        app_module,
        "storage_purge",
        lambda area, item_id, folder="": seen.append((area, item_id, folder)) or {"ok": True},
    )
    client = app_module.app.test_client()

    response = client.post("/fs/generate/result/delete", json={
        "storageId": "2026-09-24/job-1",
    })

    assert response.status_code == 200
    assert response.get_json()["storageId"] == "2026-09-24/job-1"
    assert seen == [("generate", "2026-09-24/job-1", "")]


def test_generate_prompt_library_persists_under_output_root(tmp_path, monkeypatch):
    output_root = tmp_path / "creative"
    monkeypatch.setattr(generate_store.app_config, "output_root", lambda: output_root)
    created = generate_store.save_prompt("Night street", "Two people walk through neon rain.")
    updated = generate_store.save_prompt("Night street revised", "Two people walk slowly through neon rain.", prompt_id=created["id"])
    assert generate_store.prompt_library_path() == output_root / "prompts" / "prompts.json"
    assert updated["id"] == created["id"]
    assert generate_store.list_prompts()[0]["name"] == "Night street revised"
    removed = generate_store.delete_prompt(created["id"])
    assert removed["id"] == created["id"]
    assert generate_store.list_prompts() == []


def test_generate_prompt_library_routes(monkeypatch):
    seen = {}
    monkeypatch.setattr(app_module, "generate_list_prompts", lambda: [{"id": "prompt-1", "name": "Saved", "prompt": "Text"}])
    monkeypatch.setattr(app_module, "generate_save_prompt", lambda name, prompt, prompt_id="": seen.update({"save": (name, prompt, prompt_id)}) or {"id": prompt_id or "prompt-2", "name": name, "prompt": prompt})
    monkeypatch.setattr(app_module, "generate_delete_prompt", lambda prompt_id: seen.update({"delete": prompt_id}) or {"id": prompt_id})
    client = app_module.app.test_client()
    listed = client.get("/fs/generate/prompts")
    assert listed.status_code == 200
    assert listed.get_json()["prompts"][0]["id"] == "prompt-1"
    saved = client.post("/fs/generate/prompt", json={"id": "prompt-1", "name": "Renamed", "prompt": "Updated text"})
    assert saved.status_code == 200
    assert seen["save"] == ("Renamed", "Updated text", "prompt-1")
    deleted = client.post("/fs/generate/prompt/delete", json={"id": "prompt-1"})
    assert deleted.status_code == 200
    assert seen["delete"] == "prompt-1"
