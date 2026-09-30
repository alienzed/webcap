from tool.server import app as app_module


def test_review_assistant_route_freezes_requested_visible_scope(tmp_path, monkeypatch):
    set_root = tmp_path / "set"
    set_root.mkdir()
    (set_root / "one.png").write_bytes(b"image")
    (set_root / "one.txt").write_text("subject standing in a kitchen", encoding="utf-8")
    (set_root / "two.jpg").write_bytes(b"image")
    (set_root / "two.txt").write_text("subject sitting on a couch", encoding="utf-8")
    (set_root / "three.jpg").write_bytes(b"image")
    (set_root / "three.txt").write_text("this caption must stay outside the visible scope", encoding="utf-8")
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
    response = client.post("/fs/review/assistant", json={
        "folder": "set",
        "files": ["two.jpg", "one.png"],
        "instruction": "Perform a full review.",
        "directorModel": "remote::qwen",
    })

    assert response.status_code == 202
    payload = response.get_json()
    assert payload["itemCount"] == 2
    assert payload["captionCount"] == 2
    assert seen["client"] == "review"
    assert seen["model"] == "remote::qwen"
    assert seen["label"] == "Review Dataset"
    assert seen["contract"]["operation"] == "analyze_caption_set"
    assert seen["contract"]["source_files"] == ["two.jpg", "one.png"]
    assert "subject standing in a kitchen" in seen["contract"]["prompt"]
    assert "subject sitting on a couch" in seen["contract"]["prompt"]
    assert "this caption must stay outside the visible scope" not in seen["contract"]["prompt"]


def test_review_assistant_route_rejects_unknown_scope_file(tmp_path, monkeypatch):
    set_root = tmp_path / "set"
    set_root.mkdir()
    (set_root / "one.png").write_bytes(b"image")
    (set_root / "one.txt").write_text("subject standing", encoding="utf-8")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", tmp_path)

    client = app_module.app.test_client()
    response = client.post("/fs/review/assistant", json={
        "folder": "set",
        "files": ["one.png", "invented.jpg"],
        "directorModel": "qwen",
    })

    assert response.status_code == 400
    assert "not in the current Set" in response.get_json()["error"]


def test_review_assistant_route_never_saves_captions(tmp_path, monkeypatch):
    set_root = tmp_path / "set"
    set_root.mkdir()
    (set_root / "one.png").write_bytes(b"image")
    caption_path = set_root / "one.txt"
    caption_path.write_text("original caption", encoding="utf-8")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr(
        app_module,
        "enqueue_llm",
        lambda *_args, **_kwargs: {"jobId": "llm-1", "status": "queued", "queuePosition": 1},
    )

    client = app_module.app.test_client()
    response = client.post("/fs/review/assistant", json={
        "folder": "set",
        "files": ["one.png"],
        "instruction": "Analyze only.",
        "directorModel": "qwen",
    })

    assert response.status_code == 202
    assert caption_path.read_text(encoding="utf-8") == "original caption"
