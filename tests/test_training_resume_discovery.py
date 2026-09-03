import os
import json
from pathlib import Path

from tool.server import config as app_config
from tool.server import training_history
from tool.server.training_action import allocate_action
from tool.server.training_profiles import MINIMAX_H3_PROFILE_ID, profile_for_mode


def _configure_root(monkeypatch, root):
    monkeypatch.setattr(app_config, "FS_ROOT", root)


def _write_h3_config(path, output_root, *, model="minimax-h3", epochs=3):
    Path(path).write_text(
        'output_dir = "' + Path(output_root).as_posix() + '"\n'
        'epochs = ' + str(epochs) + '\n\n'
        '[model]\n'
        'type = "h3"\n'
        'diffusion_model = "' + model + '"\n',
        encoding="utf-8",
    )


def _checkpoint(root, name, config_text, tag="global_step12"):
    run = Path(root) / name
    (run / tag).mkdir(parents=True)
    (run / "latest").write_text(tag + "\n", encoding="utf-8")
    (run / "config.h3.toml").write_text(config_text, encoding="utf-8")
    return run


def _set_with_h3_config(tmp_path, output_root):
    folder = tmp_path / "sets" / "subject"
    folder.mkdir(parents=True)
    config = folder / "config.h3.toml"
    _write_h3_config(config, output_root)
    return folder, config


def test_discovers_legacy_checkpoint_without_queue_or_recent_runs(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    output_root = tmp_path / "legacy-output"
    folder, source_config = _set_with_h3_config(tmp_path, output_root)
    run = _checkpoint(output_root, "interrupted-run", source_config.read_text(encoding="utf-8"))

    runs = training_history.discover_runs(folder, "h3")

    assert len(runs) == 1
    assert runs[0]["path"] == str(run)
    assert runs[0]["matchType"] == "exact"
    assert runs[0]["checkpointTag"] == "global_step12"
    assert "resumeActionId" not in runs[0]


def test_discovers_checkpoint_despite_stale_queue_state(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    output_root = tmp_path / "legacy-output"
    folder, source_config = _set_with_h3_config(tmp_path, output_root)
    run = _checkpoint(output_root, "crashed-run", source_config.read_text(encoding="utf-8"))
    runtime = tmp_path / ".webcap_training"
    runtime.mkdir()
    (runtime / "queue.json").write_text(json.dumps({
        "version": 3, "activeJobId": "stale", "queuePaused": False, "queuePauseReason": "",
        "jobs": [{"id": "stale", "status": "running", "stages": "h3"}],
    }), encoding="utf-8")

    runs = training_history.discover_runs(folder, "h3")

    assert [item["path"] for item in runs] == [str(run)]


def test_discovers_compatible_changed_config_but_rejects_wrong_model_and_invalid_latest(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    output_root = tmp_path / "legacy-output"
    folder, source_config = _set_with_h3_config(tmp_path, output_root)
    changed = source_config.read_text(encoding="utf-8").replace("epochs = 3", "epochs = 5")
    compatible = _checkpoint(output_root, "compatible", changed)
    _checkpoint(output_root, "wrong-model", source_config.read_text(encoding="utf-8").replace('diffusion_model = "minimax-h3"', 'diffusion_model = "other-model"'))
    malformed = _checkpoint(output_root, "malformed", source_config.read_text(encoding="utf-8"), tag="not-a-checkpoint")

    runs = training_history.discover_runs(folder, "h3")

    assert [run["path"] for run in runs] == [str(compatible)]
    assert runs[0]["matchType"] == "compatible"
    assert not (malformed / "latest").read_text(encoding="utf-8").startswith("global_step")


def test_managed_checkpoint_is_enriched_and_deduplicated_with_filesystem_scan(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    folder = tmp_path / "sets" / "subject"
    folder.mkdir(parents=True)
    action, action_data = allocate_action(folder, profile_for_mode(MINIMAX_H3_PROFILE_ID), "normal", ("h3",), "managed")
    output_root = action / "output" / "minimax-h3"
    source_config = folder / "config.h3.toml"
    _write_h3_config(source_config, output_root)
    run = _checkpoint(output_root, "managed-run", source_config.read_text(encoding="utf-8"))

    runs = training_history.discover_runs(folder, "h3")

    assert len(runs) == 1
    assert runs[0]["path"] == str(run)
    assert runs[0]["resumeActionId"] == action_data["actionId"]
    assert runs[0]["resumeOutputId"]
    assert runs[0]["matchType"] == "exact"


def test_mixed_legacy_and_managed_checkpoints_are_sorted_by_activity(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    legacy_root = tmp_path / "legacy-output"
    folder, source_config = _set_with_h3_config(tmp_path, legacy_root)
    legacy = _checkpoint(legacy_root, "legacy", source_config.read_text(encoding="utf-8"))
    action, _ = allocate_action(folder, profile_for_mode(MINIMAX_H3_PROFILE_ID), "normal", ("h3",))
    managed = _checkpoint(action / "output" / "minimax-h3", "managed", source_config.read_text(encoding="utf-8"))
    os.utime(legacy, (100, 100))
    os.utime(managed, (200, 200))

    runs = training_history.discover_runs(folder, "h3")

    assert [run["path"] for run in runs] == [str(managed), str(legacy)]
    assert runs[0]["resumeActionId"] == action.name
    assert "resumeActionId" not in runs[1]
