from pathlib import Path
import json

import pytest

from tool.server import app as app_module


def test_test_wildcard_route_queues_frozen_caption_analysis(tmp_path, monkeypatch):
    set_root = tmp_path / "set"
    set_root.mkdir()
    (set_root / "one.png").write_bytes(b"image")
    (set_root / "one.txt").write_text("subject standing in a kitchen", encoding="utf-8")
    (set_root / "two.jpg").write_bytes(b"image")
    (set_root / "two.txt").write_text("subject sitting on a couch", encoding="utf-8")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr("tool.server.epoch_reference.training_wildcard_members", lambda folder, job_id: {"one.png", "two.jpg"})
    (set_root / ".webcap_state.json").write_text(json.dumps({
        "caption_group_tags_by_media": {
            "one.png": {"Shirt Shape": ["fitted"], "Clothing": ["shirt"]},
            "two.jpg": {"Shirt Shape": ["loose"], "Background": ["studio"]},
        }
    }), encoding="utf-8")

    seen = {}
    monkeypatch.setattr(
        app_module,
        "enqueue_llm",
        lambda client, model_id, contract, context=None, label="": seen.update({
            "client": client,
            "model": model_id,
            "contract": contract,
            "context": context,
            "label": label,
        }) or {"jobId": "llm-1", "status": "queued", "queuePosition": 1},
    )

    client = app_module.app.test_client()
    response = client.post("/fs/test_generations/wildcard", json={
        "folder": "set",
        "jobId": "run-1",
        "directorModel": "director.gguf",
        "focus": "shirt",
        "vocabulary": [
            {"group": "Clothing", "alias": "Garment type", "terms": ["shirt", "jacket"]},
            {"group": "Shirt Shape", "alias": "Shirt construction", "terms": ["fitted", "loose"]},
        ],
    })

    assert response.status_code == 202
    assert response.get_json()["captionCount"] == 2
    assert seen["client"] == "test"
    assert seen["model"] == "director.gguf"
    assert seen["contract"]["operation"] == "analyze_caption_wildcard"
    assert "subject standing in a kitchen" in seen["contract"]["prompt"]
    assert "subject sitting on a couch" in seen["contract"]["prompt"]
    assert "Explicit focus: shirt" in seen["contract"]["prompt"]
    assert '"group":"Shirt Shape"' in seen["contract"]["prompt"]
    assert '"alias":"Shirt construction"' in seen["contract"]["prompt"]
    assert '"group":"Clothing"' not in seen["contract"]["prompt"]
    assert "Set name: set" in seen["contract"]["prompt"]
    assert response.get_json()["focus"] == "shirt"
    assert response.get_json()["setName"] == "set"


def test_test_wildcard_route_counts_only_nonempty_captions(tmp_path, monkeypatch):
    set_root = tmp_path / "set"
    set_root.mkdir()
    (set_root / "one.png").write_bytes(b"image")
    (set_root / "one.txt").write_text("subject standing", encoding="utf-8")
    (set_root / "two.jpg").write_bytes(b"image")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr("tool.server.epoch_reference.training_wildcard_members",
                        lambda folder, job_id: {"one.png", "two.jpg"})
    monkeypatch.setattr(
        app_module,
        "enqueue_llm",
        lambda *_args, **_kwargs: {"jobId": "llm-1", "status": "queued", "queuePosition": 1},
    )

    client = app_module.app.test_client()
    response = client.post("/fs/test_generations/wildcard", json={
        "folder": "set",
        "jobId": "run-1",
        "directorModel": "director.gguf",
    })

    assert response.status_code == 202
    assert response.get_json()["captionCount"] == 1


def test_test_wildcard_route_rejects_set_without_captions(tmp_path, monkeypatch):
    set_root = tmp_path / "set"
    set_root.mkdir()
    (set_root / "one.png").write_bytes(b"image")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr("tool.server.epoch_reference.training_wildcard_members",
                        lambda folder, job_id: {"one.png"})

    client = app_module.app.test_client()
    response = client.post("/fs/test_generations/wildcard", json={
        "folder": "set",
        "directorModel": "director.gguf",
    })

    assert response.status_code == 400
    assert "no captions" in response.get_json()["error"].lower()


def test_wildcard_excludes_media_not_in_training_run(tmp_path, monkeypatch):
    set_root = tmp_path / "set"
    set_root.mkdir()
    for name, caption in [("trained.png", "trained red dress"), ("excluded.jpg", "excluded purple dress")]:
        (set_root / name).write_bytes(b"media")
        (set_root / (Path(name).stem + ".txt")).write_text(caption, encoding="utf-8")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr("tool.server.epoch_reference.training_wildcard_members", lambda folder, job_id: {"trained.png"})
    seen = {}
    monkeypatch.setattr(app_module, "enqueue_llm",
                        lambda _client, _model, contract, **kwargs: seen.update(contract=contract) or {"jobId": "queued"})
    result = app_module.app.test_client().post("/fs/test_generations/wildcard",
                                                 json={"folder": "set", "jobId": "run-1", "directorModel": "director.gguf"})
    assert result.status_code == 202
    assert result.get_json()["trainingMediaCount"] == 1
    assert "trained red dress" in seen["contract"]["prompt"]
    assert "excluded purple dress" not in seen["contract"]["prompt"]


def test_wildcard_rejects_missing_training_run(tmp_path, monkeypatch):
    set_root = tmp_path / "set"
    set_root.mkdir()
    (set_root / "one.png").write_bytes(b"media")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr("tool.server.epoch_reference.training_wildcard_members",
                        lambda folder, job_id: (_ for _ in ()).throw(ValueError("Choose a training run")) if not job_id else {"one.png"})
    response = app_module.app.test_client().post("/fs/test_generations/wildcard",
                                                  json={"folder": "set", "directorModel": "director.gguf"})
    assert response.status_code == 400
    assert "Choose a training run" in response.get_json()["error"]
