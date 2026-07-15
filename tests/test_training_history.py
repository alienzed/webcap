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


def test_global_history_is_compact_and_clear_does_not_touch_run_artifacts(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "char" / "lilly"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    output = training_history.output_root_for_folder(set_folder)
    run = output / "run-one"
    run.mkdir(parents=True)
    (run / "checkpoint.pt").write_text("checkpoint", encoding="utf-8")

    training_history.record_job(set_folder, {
        "id": "job-1", "folder": "char/lilly", "status": "completed", "stages": "hi",
        "profile": "poc", "model": {"label": "Example", "source": "example.safetensors"},
        "input": {"count": 2, "fingerprint": "sha256:test", "configFingerprint": "sha256:config"},
    })

    payload = training_history.all_history_payload("example")
    assert len(payload["jobs"]) == 1
    assert "runDirectories" not in payload["jobs"][0]
    assert training_history.clear_history(set_folder) == 1
    assert run.exists()


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


def test_discover_runs_infers_the_stage_from_run_names_in_a_shared_output_dir(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "set"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    output = root / "output" / "runs" / "set"
    (set_folder / "config.hi.toml").write_text(
        'output_dir = "' + str(output) + '"\nepochs = 50\n', encoding="utf-8"
    )
    (set_folder / "config.lo.toml").write_text(
        'output_dir = "' + str(output) + '"\nepochs = 90\n', encoding="utf-8"
    )
    (output / "20260713_05-54-48-erin-hi" / "epoch50").mkdir(parents=True)
    (output / "20260713_06-05-04-sana-lo" / "epoch90").mkdir(parents=True)

    runs = {run["name"]: run for run in training_history.discover_runs(set_folder)}

    assert runs["20260713_05-54-48-erin-hi"]["stage"] == "hi"
    assert runs["20260713_05-54-48-erin-hi"]["expectedEpochs"] == 50
    assert runs["20260713_05-54-48-erin-hi"]["completed"] is True
    assert runs["20260713_06-05-04-sana-lo"]["stage"] == "lo"
    assert runs["20260713_06-05-04-sana-lo"]["expectedEpochs"] == 90
    assert runs["20260713_06-05-04-sana-lo"]["completed"] is True
    assert [run["name"] for run in training_history.discover_runs(set_folder, "lo")] == ["20260713_06-05-04-sana-lo"]


def test_discover_runs_uses_the_saved_config_to_label_the_training_set(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "char" / "lilly" / "hmPenny"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    output = root / "output" / "runs" / "hmPenny"
    (set_folder / "config.lo.toml").write_text(
        'output_dir = "' + str(output) + '"\nepochs = 90\n', encoding="utf-8"
    )
    run = output / "20260713_06-05-04-sana-lo"
    run.mkdir(parents=True)
    (run / "config.toml").write_text(
        'dataset = "/mnt/training/char/lilly/hmPenny/dataset.lo.toml"\n', encoding="utf-8"
    )

    discovered = training_history.discover_runs(set_folder, "lo")

    assert discovered[0]["setName"] == "hmPenny"


def test_completed_stages_requires_the_configured_final_epoch(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "set"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    for stage in ("hi", "lo"):
        output = root / "output" / "runs" / ("set-" + stage)
        (set_folder / ("config." + stage + ".toml")).write_text(
            'output_dir = "' + str(output) + '"\nepochs = 40\n', encoding="utf-8"
        )
        run = output / (stage + "-run")
        (run / "epoch39").mkdir(parents=True)

    assert training_history.completed_stages(set_folder) == (["hi", "lo"], set())

    for stage in ("hi", "lo"):
        run = root / "output" / "runs" / ("set-" + stage) / (stage + "-run")
        (run / "epoch40").mkdir()

    assert training_history.completed_stages(set_folder) == (["hi", "lo"], {"hi", "lo"})


def test_completed_stages_accepts_an_explicit_finished_early_stage(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "set"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    for stage in ("hi", "lo"):
        (set_folder / ("config." + stage + ".toml")).write_text("epochs = 90\n", encoding="utf-8")

    training_history.record_job(set_folder, {"id": "hi", "status": "completed", "stages": "hi"})
    training_history.record_job(set_folder, {"id": "lo", "status": "finished_early", "stages": "lo"})

    assert training_history.completed_stages(set_folder) == (["hi", "lo"], {"hi", "lo"})
