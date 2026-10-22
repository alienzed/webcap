import json
from pathlib import Path

import pytest

from tool.server import app as app_module
from tool.server import set_vl_clone
from tool.server import vision_schema_assist


def _sight(text):
    return {
        "description": text,
        "inventory": {
            "viewpoint": [], "position": [], "things": [], "colors": [],
            "setting": [], "background": [], "lighting": [], "surface": [], "details": [],
        },
    }


def _setup(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", tmp_path)
    source = tmp_path / "set"
    source.mkdir()
    for name in ("a.png", "b.png", "c.png"):
        (source / name).write_bytes(name.encode())
        (source / name.replace(".png", ".txt")).write_text("Custom " + name, encoding="utf-8")
    (source / ".webcap_state.json").write_text(json.dumps({
        "caption_requirements": ["BT Shape"], "caption_group_tags_by_media": {
            "a.png": {"BT Shape": ["teardrop"]},
            "b.png": {"BT Shape": ["triangle"]},
            "c.png": {"BT Shape": ["triangle"]},
        }, "ratings_by_media": {"a.png": 5, "b.png": 4, "c.png": 3},
        "reviewedKeys": ["a.png", "b.png", "c.png"],
    }))
    (source / "originals").mkdir()
    (source / "originals" / "backup.png").write_bytes(b"original backup")
    vision_schema_assist.save_vision_sight("set", "a.png", "vl-a", _sight("VL description A."))
    vision_schema_assist.save_vision_sight("set", "b.png", "vl-a", _sight("VL description B."))
    vision_schema_assist.save_vision_sight("set", "c.png", "vl-b", _sight("Other model."))
    return source


def test_clone_uses_matching_sight_and_preserves_source_metadata(tmp_path, monkeypatch):
    source = _setup(tmp_path, monkeypatch)
    before = {p.name: p.read_bytes() for p in source.iterdir() if p.is_file()}
    preview = app_module.app.test_client().get("/fs/set-vl-clone?folder=set")
    assert preview.status_code == 200
    assert preview.get_json()["sources"] == [
        {"model": "vl-a", "available": 2, "excluded": 1},
        {"model": "vl-b", "available": 1, "excluded": 2},
    ]
    response = app_module.app.test_client().post(
        "/fs/set-vl-clone", json={"folder": "set", "model": "vl-a", "set_name": "set-vl-a"}
    )
    assert response.status_code == 200
    assert response.get_json()["copied_count"] == 2
    copied = tmp_path / "set-vl-a"
    assert (copied / "a.png").read_bytes() == b"a.png"
    assert (copied / "a.txt").read_text(encoding="utf-8") == "VL description A."
    assert (copied / "b.txt").read_text(encoding="utf-8") == "VL description B."
    assert not (copied / "c.png").exists()
    assert not (copied / "c.txt").exists()
    assert (copied / "originals" / "backup.png").read_bytes() == b"original backup"
    state = json.loads((copied / ".webcap_state.json").read_text())
    assert state["caption_requirements"] == ["BT Shape"]
    assert state["caption_group_tags_by_media"]["a.png"] == {"BT Shape": ["teardrop"]}
    assert set(state["ratings_by_media"]) == {"a.png", "b.png"}
    assert state["reviewedKeys"] == ["a.png", "b.png"]
    metadata = json.loads((copied / "media_metadata.json").read_text())
    assert set(metadata) == {"a.png", "b.png"}
    assert metadata["a.png"]["vision_sight"]["model"] == "vl-a"
    manifest = json.loads((copied / "vl_caption_clone.json").read_text())
    assert manifest["original_captions"]["a.png"] == "Custom a.png"
    assert manifest["excluded_files"] == ["c.png"]
    assert {p.name: p.read_bytes() for p in source.iterdir() if p.is_file()} == before


def test_clone_conflict_does_not_touch_existing_folder(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    target = tmp_path / "already"
    target.mkdir()
    (target / "marker").write_text("keep")
    response = app_module.app.test_client().post(
        "/fs/set-vl-clone", json={"folder": "set", "model": "vl-a", "set_name": "already"}
    )
    assert response.status_code == 409
    assert (target / "marker").read_text() == "keep"


def test_clone_rejects_unavailable_model_and_invalid_name(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    for model, name in (("vl-c", "set-new"), ("vl-a", "../outside")):
        response = app_module.app.test_client().post(
            "/fs/set-vl-clone", json={"folder": "set", "model": model, "set_name": name}
        )
        assert response.status_code == 400
    assert not (tmp_path / "set-new").exists()


def test_clone_rejects_stale_sight(tmp_path, monkeypatch):
    source = _setup(tmp_path, monkeypatch)
    (source / "a.png").write_bytes(b"changed")
    preview = set_vl_clone.preview_vl_set_clone("set")
    assert next(item for item in preview["sources"] if item["model"] == "vl-a")["available"] == 1
    response = app_module.app.test_client().post(
        "/fs/set-vl-clone", json={"folder": "set", "model": "vl-a", "set_name": "set-vl"}
    )
    assert response.status_code == 200
    assert not (tmp_path / "set-vl" / "a.png").exists()
    assert (tmp_path / "set-vl" / "b.png").exists()
