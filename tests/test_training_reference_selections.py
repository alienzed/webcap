"""Training reference persistence contracts."""
import json

import pytest

from tool.server import training_reference_selections as refs


def test_save_reload_remove(monkeypatch, tmp_path):
    monkeypatch.setattr(refs, "_resolve_folder", lambda folder: tmp_path)
    monkeypatch.setattr(refs, "verified_reference", lambda *args: {"media": args[3]})
    selection = {"runId": "run-1", "group": "Body", "term": "athletic", "media": "image.png"}
    assert refs.command("set", "reference_selection_list", {})["selections"] == []
    refs.command("set", "reference_selection_save", selection)
    data = json.loads((tmp_path / "training_references.json").read_text())
    assert data["version"] == 1
    assert refs.command("set", "reference_selection_list", {})["selections"] == [selection]
    refs.command("set", "reference_selection_remove", selection)
    assert refs.command("set", "reference_selection_list", {})["selections"] == []


def test_rejected_reference_does_not_overwrite(monkeypatch, tmp_path):
    monkeypatch.setattr(refs, "_resolve_folder", lambda folder: tmp_path)
    def reject(*args):
        raise ValueError("not captured by this run")
    monkeypatch.setattr(refs, "verified_reference", reject)
    with pytest.raises(ValueError, match="not captured"):
        refs.command("set", "reference_selection_save", {
            "runId": "run-1", "group": "Body", "term": "athletic", "media": "other.png"
        })
    assert not (tmp_path / "training_references.json").exists()


def test_corrupt_file_fails_loudly(monkeypatch, tmp_path):
    monkeypatch.setattr(refs, "_resolve_folder", lambda folder: tmp_path)
    (tmp_path / "training_references.json").write_text("{broken")
    with pytest.raises(json.JSONDecodeError):
        refs.command("set", "reference_selection_list", {})
