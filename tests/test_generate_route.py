from io import BytesIO

from tool.server import app as app_module


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
