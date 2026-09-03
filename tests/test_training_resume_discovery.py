import os
from pathlib import Path
import pytest
from tool.server import config as app_config
from tool.server import training_history
from tool.server.training_action import allocate_action, read_action, set_root_name
from tool.server.training_profiles import MINIMAX_H3_PROFILE_ID, profile_for_mode

def _configure_root(monkeypatch, root): monkeypatch.setattr(app_config, "FS_ROOT", root)
def _write_h3_config(path, output_root, model="minimax-h3", epochs=3):
    Path(path).write_text('output_dir = "' + Path(output_root).as_posix() + '"\nepochs = ' + str(epochs) + '\n\n[model]\ntype = "h3"\ndiffusion_model = "' + model + '"\n', encoding="utf-8")
def _checkpoint(root, name, config_text, tag="global_step12"):
    run = Path(root) / name; (run / tag).mkdir(parents=True); (run / "latest").write_text(tag + "\n", encoding="utf-8"); (run / "config.h3.toml").write_text(config_text, encoding="utf-8"); return run
def _set(tmp_path, name="subject"):
    folder = tmp_path / "sets" / name; folder.mkdir(parents=True); return folder
def _action(folder, name="managed"):
    return allocate_action(folder, profile_for_mode(MINIMAX_H3_PROFILE_ID), "normal", ("h3",), name)

def test_set_roots_are_deterministic_and_action_ids_are_nested(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    first = _set(tmp_path, "Same Name"); second = tmp_path / "other" / "Same Name"; second.mkdir(parents=True)
    a1, data1 = _action(first); a2, data2 = _action(first, "again"); b1, _ = _action(second)
    assert a1.parent.name == set_root_name(first)
    assert a1.name.startswith("001-h3") and a2.name.startswith("002-h3") and b1.name.startswith("001-h3")
    assert a1.parent != b1.parent and data1["actionId"] == a1.relative_to(tmp_path / "output" / "runs").as_posix()
    assert data2["actionId"].startswith(a1.parent.name + "/") and read_action(data1["actionId"])[0] == a1
    with pytest.raises(ValueError): read_action(a1.name)
    with pytest.raises(ValueError): read_action("../" + data1["actionId"])

def test_discovery_is_current_set_shallow_and_uses_relative_output_ids(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path); folder = _set(tmp_path); action, data = _action(folder)
    source = folder / "config.h3.toml"; _write_h3_config(source, action / "output" / "minimax-h3")
    run = _checkpoint(action / "output" / "minimax-h3", "managed-run", source.read_text(encoding="utf-8"))
    other = _set(tmp_path, "other"); other_action, _ = _action(other)
    _checkpoint(other_action / "output" / "minimax-h3", "other-run", source.read_text(encoding="utf-8"))
    _checkpoint(tmp_path / "output" / "runs" / "099-old-flat" / "output", "old-run", source.read_text(encoding="utf-8"))
    _checkpoint(action / "captures" / "junk", "nested-run", source.read_text(encoding="utf-8"))
    runs = training_history.discover_runs(folder, "h3")
    assert [item["path"] for item in runs] == [str(run)]
    assert runs[0]["resumeActionId"] == data["actionId"] and runs[0]["resumeOutputId"] == "output/minimax-h3/managed-run" and runs[0]["matchType"] == "exact"

def test_direct_custom_validation_and_managed_resolution(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path); folder = _set(tmp_path); source = folder / "config.h3.toml"; _write_h3_config(source, tmp_path / "configured-out")
    external = _checkpoint(tmp_path / "external", "run", source.read_text(encoding="utf-8").replace("epochs = 3", "epochs = 5"))
    assert training_history.validate_resumable_run_for_path(folder, "h3", str(external))["matchType"] == "compatible"
    with pytest.raises(ValueError): training_history.validate_resumable_run_for_path(folder, "h3", str(tmp_path / "missing"))
    action, data = _action(folder); managed = _checkpoint(action / "output" / "minimax-h3", "run", source.read_text(encoding="utf-8"))
    assert training_history.resolve_managed_resume(folder, data["actionId"], "output/minimax-h3/run", "h3")["runPath"] == managed
    with pytest.raises(ValueError): training_history.resolve_managed_resume(folder, data["actionId"], "../run", "h3")
    with pytest.raises(ValueError): training_history.resolve_managed_resume(folder, data["actionId"], "output/wrong/run", "h3")

def test_discovery_excludes_wrong_model_invalid_latest_and_sorts(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path); folder = _set(tmp_path); action, _ = _action(folder)
    source = folder / "config.h3.toml"; _write_h3_config(source, action / "output" / "minimax-h3")
    older = _checkpoint(action / "output" / "minimax-h3", "older", source.read_text(encoding="utf-8")); newer = _checkpoint(action / "output" / "minimax-h3", "newer", source.read_text(encoding="utf-8").replace("epochs = 3", "epochs = 5"))
    _checkpoint(action / "output" / "minimax-h3", "wrong", source.read_text(encoding="utf-8").replace("minimax-h3", "other")); _checkpoint(action / "output" / "minimax-h3", "bad", source.read_text(encoding="utf-8"), "not-a-step")
    os.utime(older, (100, 100)); os.utime(newer, (200, 200)); runs = training_history.discover_runs(folder, "h3")
    assert [run["name"] for run in runs] == ["newer", "older"] and runs[0]["matchType"] == "compatible"
