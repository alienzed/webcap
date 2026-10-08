from pathlib import Path

from tool.server import app as app_module


def _sight(description, **inventory):
    base = {
        "viewpoint": [],
        "position": [],
        "things": [],
        "colors": [],
        "setting": [],
        "background": [],
        "lighting": [],
        "surface": [],
        "details": [],
    }
    base.update(inventory)
    return {"description": description, "inventory": base}


def test_vision_schema_synthesis_queues_frozen_schema_contract(tmp_path, monkeypatch):
    set_root = tmp_path / "set"
    set_root.mkdir()
    (set_root / "a.jpg").write_bytes(b"a")
    (set_root / "b.jpg").write_bytes(b"b")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", Path(tmp_path))

    from tool.server import vision_schema_assist
    monkeypatch.setattr(vision_schema_assist, "time", type("T", (), {"time": staticmethod(lambda: 1.0)}))
    vision_schema_assist.save_vision_sight(
        "set",
        "a.jpg",
        "vl",
        _sight(
            "Red triangle top with ring connector.",
            things=[{"name": "bikini top", "qualities": ["triangle"]}],
            colors=[{"thing": "bikini top", "color": "red"}],
            details=["ring connector"],
        ),
    )
    vision_schema_assist.save_vision_sight(
        "set",
        "b.jpg",
        "vl",
        _sight(
            "Black triangle top with ring connector.",
            things=[{"name": "bikini top", "qualities": ["triangle"]}],
            colors=[{"thing": "bikini top", "color": "black"}],
            details=["ring connector"],
        ),
    )

    seen = {}
    def fake_enqueue(client, model_id, contract, context=None, label=""):
        seen.update(client=client, model=model_id, contract=contract, context=context, label=label)
        return {"jobId": "schema-1", "status": "queued", "queuePosition": 1}
    monkeypatch.setattr(app_module, "enqueue_llm", fake_enqueue)

    response = app_module.app.test_client().post("/fs/vision_schema", json={
        "operation": "synthesize",
        "folder": "set",
        "visionModel": "vl",
        "directorModel": "director",
        "existingGroups": [{"group": "BT Shape", "terms": ["triangle"]}],
    })

    assert response.status_code == 202
    assert seen["client"] == "schema"
    assert seen["model"] == "director"
    assert seen["context"] == {}
    assert seen["label"] == "Schema Assist"
    assert seen["contract"]["operation"] == "vision_schema_suggest"
    assert seen["contract"]["sight_evidence"]


def test_vision_tag_suggestions_queue_both_visual_reads(tmp_path, monkeypatch):
    set_root = tmp_path / "set"
    set_root.mkdir()
    (set_root / "a.jpg").write_bytes(b"a")
    (set_root / "b.jpg").write_bytes(b"b")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", Path(tmp_path))

    from tool.server import vision_schema_assist
    groups = [
        {"group": "Viewpoint", "terms": ["front", "side"]},
        {"group": "BT Shape", "terms": ["triangle", "bandeau"]},
    ]
    vision_schema_assist.save_vision_sight(
        "set",
        "b.jpg",
        "vl",
        _sight(
            "Side view of a black bandeau top.",
            viewpoint=["side"],
            things=[{"name": "bikini top", "qualities": ["bandeau"]}],
            colors=[{"thing": "bikini top", "color": "black"}],
        ),
    )
    vision_schema_assist.save_vision_vocabulary_sight(
        "set",
        "b.jpg",
        "vl",
        groups,
        {
            "caption": "Black bandeau top from the side.",
            "matches": [
                {"group": "Viewpoint", "terms": ["side"]},
                {"group": "BT Shape", "terms": ["bandeau"]},
            ],
        },
        caption_template="{bt_shape}, {viewpoint}.",
    )

    seen = {}
    def fake_enqueue(client, model_id, contract, context=None, label=""):
        seen.update(client=client, model=model_id, contract=contract, context=context, label=label)
        return {"jobId": "tags-1", "status": "queued", "queuePosition": 1}
    monkeypatch.setattr(app_module, "enqueue_llm", fake_enqueue)

    response = app_module.app.test_client().post("/fs/vision_schema", json={
        "operation": "suggest_tags",
        "folder": "set",
        "visionModel": "vl",
        "directorModel": "director",
        "files": ["b.jpg"],
        "existingGroups": groups,
        "captionTemplate": "{bt_shape}, {viewpoint}.",
        "currentAssignments": {
            "b.jpg": [{"group": "Viewpoint", "term": "side"}],
        },
    })

    assert response.status_code == 202
    payload = response.get_json()
    assert payload["files"] == ["b.jpg"]
    assert seen["client"] == "schema"
    assert seen["label"] == "Vision Tag Assist"
    assert seen["contract"]["operation"] == "vision_tag_suggest"
    assert seen["contract"]["source_files"] == ["b.jpg"]
    assert '"openSight"' in seen["contract"]["prompt"]
    assert '"contextSight"' in seen["contract"]["prompt"]
    assert "Black bandeau top from the side." in seen["contract"]["prompt"]


def test_vision_tag_suggestions_accept_partial_structured_sight(tmp_path, monkeypatch):def test_vision_tag_suggestions_accept_partial_structured_sight(tmp_path, monkeypatch):
    set_root = tmp_path / "set"
    set_root.mkdir()
    for name in ("a.jpg", "b.jpg"):
        (set_root / name).write_bytes(name.encode("utf-8"))
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", Path(tmp_path))

    from tool.server import vision_schema_assist
    vision_schema_assist.save_vision_sight(
        "set",
        "a.jpg",
        "vl",
        _sight(
            "Front view of a red triangle top.",
            viewpoint=["front"],
            things=[{"name": "bikini top", "qualities": ["triangle"]}],
        ),
    )

    seen = {}
    def fake_enqueue(client, model_id, contract, context=None, label=""):
        seen.update(client=client, model=model_id, contract=contract, context=context, label=label)
        return {"jobId": "tags-partial-1", "status": "queued", "queuePosition": 1}
    monkeypatch.setattr(app_module, "enqueue_llm", fake_enqueue)

    response = app_module.app.test_client().post("/fs/vision_schema", json={
        "operation": "suggest_tags",
        "folder": "set",
        "visionModel": "vl",
        "directorModel": "director",
        "files": ["a.jpg", "b.jpg"],
        "existingGroups": [{"group": "Viewpoint", "terms": ["front", "side"]}],
        "currentAssignments": {},
        "existingOnly": True,
    })

    assert response.status_code == 202
    payload = response.get_json()
    assert payload["files"] == ["a.jpg"]
    assert seen["contract"]["source_files"] == ["a.jpg"]


def test_structured_sight_scan_uses_caption_vision_lane_and_response_contract(tmp_path, monkeypatch):
    set_root = tmp_path / "set"
    set_root.mkdir()
    (set_root / "a.jpg").write_bytes(b"a")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", Path(tmp_path))

    monkeypatch.setattr(app_module, "list_vision_models", lambda: [{"id": "vl"}])
    monkeypatch.setattr(app_module, "resolve_caption_vision_media", lambda folder, media: "data:image/jpeg;base64,YQ==")

    seen = {}
    def fake_enqueue(client, model_id, contract, context=None, label=""):
        seen.update(client=client, model=model_id, contract=contract, context=context, label=label)
        return {"jobId": "sight-1", "status": "queued", "queuePosition": 1}
    monkeypatch.setattr(app_module, "enqueue_llm", fake_enqueue)

    response = app_module.app.test_client().post("/fs/vision_schema", json={
        "operation": "scan_sight",
        "folder": "set",
        "visionModel": "vl",
        "media": "a.jpg",
    })

    assert response.status_code == 202
    assert seen["client"] == "caption"
    assert seen["model"] == "vl"
    assert seen["label"] == "Vision Sight"
    assert seen["contract"]["operation"] == "vision_schema_sight"
    assert seen["context"]["runtimeOverrides"]["maxTokens"] == 900



def test_context_sight_scan_uses_template_and_exact_vocabulary(tmp_path, monkeypatch):
    set_root = tmp_path / "set"
    set_root.mkdir()
    (set_root / "a.jpg").write_bytes(b"a")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", Path(tmp_path))
    monkeypatch.setattr(app_module, "list_vision_models", lambda: [{"id": "vl"}])
    monkeypatch.setattr(app_module, "resolve_caption_vision_media", lambda folder, media: "data:image/jpeg;base64,YQ==")

    seen = {}
    def fake_enqueue(client, model_id, contract, context=None, label=""):
        seen.update(client=client, model=model_id, contract=contract, context=context, label=label)
        return {"jobId": "vocab-sight-1", "status": "queued", "queuePosition": 1}
    monkeypatch.setattr(app_module, "enqueue_llm", fake_enqueue)

    groups = [{"group": "BT Shape", "terms": ["triangle"]}]
    template = "{bt_shape}, {viewpoint}."
    response = app_module.app.test_client().post("/fs/vision_schema", json={
        "operation": "scan_vocabulary_sight",
        "folder": "set",
        "visionModel": "vl",
        "media": "a.jpg",
        "existingGroups": groups,
        "captionTemplate": template,
    })

    assert response.status_code == 202
    assert seen["client"] == "caption"
    assert seen["contract"]["operation"] == "vision_vocabulary_sight"
    assert seen["context"]["existingGroups"] == groups
    assert seen["label"] == "Context Vision"
    prompt_text = seen["contract"]["messages"][1]["content"][0]["text"]
    assert template in prompt_text
    assert "triangle" in prompt_text
    assert "Prefer exact supplied terms when they clearly match what you see." in prompt_text


def test_vocabulary_synthesis_accepts_partial_visual_coverage(tmp_path, monkeypatch):def test_vocabulary_synthesis_accepts_partial_visual_coverage(tmp_path, monkeypatch):
    set_root = tmp_path / "set"
    set_root.mkdir()
    for name in ("a.jpg", "b.jpg", "c.jpg"):
        (set_root / name).write_bytes(name.encode("utf-8"))
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", Path(tmp_path))

    from tool.server import vision_schema_assist
    groups = [{"group": "BT Shape", "terms": ["triangle"]}]
    for name in ("a.jpg", "b.jpg"):
        vision_schema_assist.save_vision_sight(
            "set",
            name,
            "vl",
            _sight(
                "Triangle top.",
                things=[{"name": "bikini top", "qualities": ["triangle"]}],
            ),
        )
    vision_schema_assist.save_vision_vocabulary_sight(
        "set",
        "a.jpg",
        "vl",
        groups,
        {
            "caption": "Tiny triangle top.",
            "matches": [{"group": "BT Shape", "terms": ["triangle"]}],
        },
    )

    seen = {}
    def fake_enqueue(client, model_id, contract, context=None, label=""):
        seen.update(client=client, model=model_id, contract=contract, context=context, label=label)
        return {"jobId": "partial-vocab-1", "status": "queued", "queuePosition": 1}
    monkeypatch.setattr(app_module, "enqueue_llm", fake_enqueue)

    response = app_module.app.test_client().post("/fs/vision_schema", json={
        "operation": "synthesize_vocabulary",
        "folder": "set",
        "visionModel": "vl",
        "directorModel": "director",
        "existingGroups": groups,
    })

    assert response.status_code == 202
    payload = response.get_json()
    assert payload["analysis"]["openItemCount"] == 2
    assert payload["analysis"]["schemaAwareItemCount"] == 1
    assert any(row.get("source") == "context_caption" for row in payload["analysis"]["evidence"])
    assert seen["label"] == "Vocabulary Synthesis"


def test_vocabulary_challenge_queues_schema_contract_from_both_visual_passes(tmp_path, monkeypatch):
    set_root = tmp_path / "set"
    set_root.mkdir()
    (set_root / "a.jpg").write_bytes(b"a")
    (set_root / "b.jpg").write_bytes(b"b")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", Path(tmp_path))

    from tool.server import vision_schema_assist
    groups = [{"group": "BT Shape", "terms": ["triangle"]}]
    for name in ("a.jpg", "b.jpg"):
        vision_schema_assist.save_vision_sight(
            "set",
            name,
            "vl",
            _sight(
                "Triangle top.",
                things=[{"name": "bikini top", "qualities": ["triangle"]}],
            ),
        )
        vision_schema_assist.save_vision_vocabulary_sight(
            "set",
            name,
            "vl",
            groups,
            {
                "caption": "Triangle top.",
                "matches": [{"group": "BT Shape", "terms": ["triangle"]}],
            },
        )

    seen = {}
    def fake_enqueue(client, model_id, contract, context=None, label=""):
        seen.update(client=client, model=model_id, contract=contract, context=context, label=label)
        return {"jobId": "challenge-1", "status": "queued", "queuePosition": 1}
    monkeypatch.setattr(app_module, "enqueue_llm", fake_enqueue)

    response = app_module.app.test_client().post("/fs/vision_schema", json={
        "operation": "challenge_vocabulary",
        "folder": "set",
        "visionModel": "vl",
        "directorModel": "director",
        "existingGroups": groups,
        "draftSchema": {"groups": []},
    })

    assert response.status_code == 202
    assert seen["client"] == "schema"
    assert seen["contract"]["operation"] == "vision_schema_challenge"
    assert seen["label"] == "Vocabulary Challenge"
    assert any(row.get("source") == "context" for row in seen["contract"]["sight_evidence"])
    assert any(row.get("source") == "context_caption" for row in seen["contract"]["sight_evidence"])
