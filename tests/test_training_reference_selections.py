"""Training reference persistence and run-independent selection contracts."""
import json

import pytest

from tool.server import training_reference_selections as refs


def test_save_reload_replace_and_remove_without_run_scope(monkeypatch, tmp_path):
    monkeypatch.setattr(refs, "_resolve_folder", lambda folder: tmp_path)
    checked = []
    monkeypatch.setattr(refs, "verified_reference", lambda *args: checked.append(args))
    selection = {"group": "Body", "term": "athletic", "media": "image.png"}
    assert refs.command("set", "reference_selection_list", {})["selections"] == []
    refs.command("set", "reference_selection_save", dict(selection, runId="run-1"))
    data = json.loads((tmp_path / "training_references.json").read_text())
    assert data == {"version": 2, "selections": [selection]}
    assert checked == [("set", "Body", "athletic", "image.png", None)]
    assert refs.command("set", "reference_selection_list", {})["selections"] == [selection]
    replacement = dict(selection, media="new.png")
    refs.command("set", "reference_selection_save", dict(replacement, runId="run-2"))
    assert refs.command("set", "reference_selection_list", {})["selections"] == [replacement]
    refs.command("set", "reference_selection_remove", {"group": "Body", "term": "athletic"})
    assert refs.command("set", "reference_selection_list", {})["selections"] == []


def test_legacy_run_entries_collapsed_deterministically_and_migrate_on_write(monkeypatch, tmp_path):
    monkeypatch.setattr(refs, "_resolve_folder", lambda folder: tmp_path)
    monkeypatch.setattr(refs, "verified_reference", lambda *args: {"media": args[3]})
    path = tmp_path / "training_references.json"
    legacy = {"version": 1, "selections": [
        {"runId": "run-1", "group": "BB Shape", "term": "ring connectors", "media": "old.png"},
        {"runId": "run-1", "group": "BT Shape", "term": "triangle", "media": "triangle.png"},
        {"runId": "run-2", "group": "BB Shape", "term": "ring connectors", "media": "new.png"},
    ]}
    path.write_text(json.dumps(legacy), encoding="utf-8")
    listed = refs.command("set", "reference_selection_list", {})["selections"]
    assert listed == [
        {"group": "BB Shape", "term": "ring connectors", "media": "new.png"},
        {"group": "BT Shape", "term": "triangle", "media": "triangle.png"},
    ]
    assert json.loads(path.read_text()) == legacy  # Listing never rewrites saved state.
    refs.command("set", "reference_selection_remove", {"group": "BB Shape", "term": "ring connectors"})
    assert refs.command("set", "reference_selection_list", {})["selections"] == [
        {"group": "BT Shape", "term": "triangle", "media": "triangle.png"}
    ]
    assert json.loads(path.read_text()) == {
        "version": 2, "selections": [{"group": "BT Shape", "term": "triangle", "media": "triangle.png"}]
    }


def test_rejected_reference_does_not_overwrite(monkeypatch, tmp_path):
    monkeypatch.setattr(refs, "_resolve_folder", lambda folder: tmp_path)
    def reject(*args):
        raise ValueError("not annotated in this Set")
    monkeypatch.setattr(refs, "verified_reference", reject)
    with pytest.raises(ValueError, match="not annotated"):
        refs.command("set", "reference_selection_save", {
            "group": "Body", "term": "athletic", "media": "other.png"
        })
    assert not (tmp_path / "training_references.json").exists()


def test_corrupt_file_fails_loudly(monkeypatch, tmp_path):
    monkeypatch.setattr(refs, "_resolve_folder", lambda folder: tmp_path)
    (tmp_path / "training_references.json").write_text("{broken")
    with pytest.raises(json.JSONDecodeError):
        refs.command("set", "reference_selection_list", {})
