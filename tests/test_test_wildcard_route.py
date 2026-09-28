from pathlib import Path

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
        "directorModel": "director.gguf",
    })

    assert response.status_code == 202
    assert response.get_json()["captionCount"] == 2
    assert seen["client"] == "test"
    assert seen["model"] == "director.gguf"
    assert seen["contract"]["operation"] == "analyze_caption_wildcard"
    assert "subject standing in a kitchen" in seen["contract"]["prompt"]
    assert "subject sitting on a couch" in seen["contract"]["prompt"]


def test_test_wildcard_route_counts_only_nonempty_captions(tmp_path, monkeypatch):
    set_root = tmp_path / "set"
    set_root.mkdir()
    (set_root / "one.png").write_bytes(b"image")
    (set_root / "one.txt").write_text("subject standing", encoding="utf-8")
    (set_root / "two.jpg").write_bytes(b"image")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr(
        app_module,
        "enqueue_llm",
        lambda *_args, **_kwargs: {"jobId": "llm-1", "status": "queued", "queuePosition": 1},
    )

    client = app_module.app.test_client()
    response = client.post("/fs/test_generations/wildcard", json={
        "folder": "set",
        "directorModel": "director.gguf",
    })

    assert response.status_code == 202
    assert response.get_json()["captionCount"] == 1


def test_test_wildcard_route_rejects_set_without_captions(tmp_path, monkeypatch):
    set_root = tmp_path / "set"
    set_root.mkdir()
    (set_root / "one.png").write_bytes(b"image")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", tmp_path)

    client = app_module.app.test_client()
    response = client.post("/fs/test_generations/wildcard", json={
        "folder": "set",
        "directorModel": "director.gguf",
    })

    assert response.status_code == 400
    assert "no captions" in response.get_json()["error"].lower()
