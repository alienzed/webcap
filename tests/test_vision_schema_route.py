from pathlib import Path

from tool.server import app as app_module


def test_vision_schema_synthesis_queues_frozen_schema_contract(tmp_path, monkeypatch):
    set_root = tmp_path / "set"
    set_root.mkdir()
    (set_root / "a.jpg").write_bytes(b"a")
    (set_root / "b.jpg").write_bytes(b"b")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", Path(tmp_path))

    from tool.server import vision_schema_assist
    monkeypatch.setattr(vision_schema_assist, "time", type("T", (), {"time": staticmethod(lambda: 1.0)}))
    vision_schema_assist.save_vision_sight("set", "a.jpg", "vl", "red triangle top with ring connector")
    vision_schema_assist.save_vision_sight("set", "b.jpg", "vl", "black triangle top with ring connector")

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
    assert seen["contract"]["pattern_evidence"]
