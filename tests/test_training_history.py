from tool.server import config as config_module
from tool.server import training_history


def test_training_history_discovers_only_set_local_runs(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "char" / "lilly"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)

    run = training_history.output_root_for_folder(set_folder) / "20260713_01-00-00"
    run.mkdir(parents=True)
    (run / "checkpoint.pt").write_text("checkpoint", encoding="utf-8")
    (root / "output" / "runs" / "legacy").mkdir(parents=True)

    history = training_history.record_job(set_folder, {
        "id": "job-1", "folder": "char/lilly", "status": "paused", "stage": "paused", "createdAt": 1,
    })

    assert history["outputRoot"] == str(training_history.output_root_for_folder(set_folder))
    assert [entry["name"] for entry in history["runs"]] == ["20260713_01-00-00"]
    assert history["runs"][0]["checkpointAvailable"] is True
    assert (set_folder / ".webcap_training.json").exists()


def test_training_history_summary_uses_the_latest_managed_job(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "set"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)

    training_history.record_job(set_folder, {"id": "one", "folder": "set", "status": "failed", "createdAt": 1})
    training_history.record_job(set_folder, {"id": "two", "folder": "set", "status": "completed", "createdAt": 2})

    assert training_history.summarize_history(set_folder)["status"] == "completed"


def test_discover_runs_uses_each_stage_current_config_output_dir(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "set"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    hi_root = root / "output" / "runs" / "set-hi"
    lo_root = root / "output" / "runs" / "set-lo"
    (set_folder / "config.hi.toml").write_text('output_dir = "' + str(hi_root) + '"\n', encoding="utf-8")
    (set_folder / "config.lo.toml").write_text('output_dir = "' + str(lo_root) + '"\n', encoding="utf-8")
    (hi_root / "hi-run").mkdir(parents=True)
    (lo_root / "lo-run").mkdir(parents=True)

    assert [run["name"] for run in training_history.discover_runs(set_folder, "hi")] == ["hi-run"]
    assert [run["name"] for run in training_history.discover_runs(set_folder, "lo")] == ["lo-run"]
