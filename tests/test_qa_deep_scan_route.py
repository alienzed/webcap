from pathlib import Path

from tool.server import app as app_module


def test_qa_deep_scan_route_freezes_current_set_scope(tmp_path, monkeypatch):
    set_root = tmp_path / "set"
    set_root.mkdir()
    (set_root / "one.jpg").write_bytes(b"image")
    (set_root / "two.jpg").write_bytes(b"image")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", Path(tmp_path))

    seen = {}

    def fake_enqueue(client, model_id, contract, context=None, label=""):
        seen.update({
            "client": client,
            "model": model_id,
            "contract": contract,
            "context": context,
            "label": label,
        })
        return {"jobId": "llm-qa-1", "status": "queued", "queuePosition": 1}

    monkeypatch.setattr(app_module, "enqueue_llm", fake_enqueue)

    client = app_module.app.test_client()
    response = client.post("/fs/qa/deep-scan", json={
        "folder": "set",
        "model": "local::qwen",
        "trainingFocus": "Teach garment details consistently.",
        "items": [
            {
                "fileName": "one.jpg",
                "caption": "subject wearing a red triangle top",
                "groupedTags": [{"group": "BT Shape", "term": "triangle"}],
                "tags": ["triangle", "red"],
            },
            {
                "fileName": "two.jpg",
                "caption": "subject wearing a crimson triangle top",
                "groupedTags": [{"group": "BT Shape", "term": "triangle"}],
                "tags": ["triangle", "red"],
            },
        ],
        "deterministicFindings": [],
    })

    assert response.status_code == 202
    assert seen["client"] == "qa"
    assert seen["model"] == "local::qwen"
    assert seen["label"] == "QA Deep Scan"
    assert seen["context"] == {}
    assert seen["contract"]["operation"] == "qa_deep_scan"
    assert seen["contract"]["source_files"] == ["one.jpg", "two.jpg"]
    assert "Teach garment details consistently." in seen["contract"]["prompt"]
    assert "BT Shape: triangle" in seen["contract"]["prompt"]


def test_qa_deep_scan_route_rejects_media_outside_current_set(tmp_path, monkeypatch):
    set_root = tmp_path / "set"
    set_root.mkdir()
    (set_root / "one.jpg").write_bytes(b"image")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", Path(tmp_path))

    client = app_module.app.test_client()
    response = client.post("/fs/qa/deep-scan", json={
        "folder": "set",
        "model": "local::qwen",
        "items": [{
            "fileName": "invented.jpg",
            "caption": "not real",
            "groupedTags": [],
            "tags": [],
        }],
    })

    assert response.status_code == 400
    assert "not in the current Set" in response.get_json()["error"]
