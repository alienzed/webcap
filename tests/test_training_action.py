import json
from pathlib import Path

import pytest

from tool.server import config as config_module
from tool.server import training_action


def _profile():
    return {"id": "wan22_t2v", "label": "Wan 2.2"}


def test_actions_allocate_visible_distinct_parents_and_preserve_run_name(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "sets" / "my set"
    folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)

    first, manifest = training_action.allocate_action(folder, _profile(), "normal", ("hi", "lo"), "clothing / baseline")
    second, _ = training_action.allocate_action(folder, _profile(), "normal", ("hi",), "")

    assert first.name == "001-my-set--clothing-baseline"
    assert second.name == "002-my-set"
    assert manifest["runName"] == "clothing / baseline"
    assert (first / "record" / "configs").is_dir()
    assert (first / "input").is_dir()
    assert json.loads((first / "action.json").read_text(encoding="utf-8"))["folder"] == "sets/my set"


def test_run_name_rejects_unusable_slug():
    with pytest.raises(ValueError, match="usable"):
        training_action.normalize_run_name("!!!")


def test_action_id_never_accepts_path_traversal(tmp_path, monkeypatch):
    monkeypatch.setattr(config_module, "FS_ROOT", tmp_path)
    with pytest.raises(ValueError, match="invalid"):
        training_action.read_action("../outside")


def test_sequence_continues_past_three_digits(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    folder.mkdir(parents=True)
    (root / "output" / "runs" / "999-old").mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    action, _ = training_action.allocate_action(folder, _profile(), "normal", ("hi",), "")
    assert action.name.startswith("1000-")
