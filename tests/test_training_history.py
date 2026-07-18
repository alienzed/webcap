import pytest

from tool.server import config as config_module
from tool.server import training_history
from tool.server import training_runner


def test_training_history_discovers_only_set_local_runs(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "char" / "lilly"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)

    run = training_history.output_root_for_folder(set_folder) / "20260713_01-00-00"
    run.mkdir(parents=True)
    (run / "global_step1").mkdir()
    (run / "latest").write_text("global_step1", encoding="utf-8")
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
    (run / "global_step1").mkdir()
    (run / "latest").write_text("global_step1", encoding="utf-8")

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


def test_global_history_hides_queue_items_removed_before_or_after_a_run(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "set"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    training_history.record_job(set_folder, {"id": "cancelled", "folder": "set", "status": "cancelled", "createdAt": 1})
    training_history.record_job(set_folder, {"id": "completed", "folder": "set", "status": "completed", "createdAt": 2})

    payload = training_history.all_history_payload()

    assert [job["id"] for job in payload["jobs"]] == ["completed"]


def test_global_history_returns_persisted_rows_without_rechecking_current_inputs(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "set"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    training_history.record_job(set_folder, {
        "id": "job", "folder": "set", "status": "finished_early",
        "input": {"fingerprint": "dataset-a", "configFingerprint": "config-a"},
    })

    monkeypatch.setattr(training_runner, "_input_evidence", lambda folder: (_ for _ in ()).throw(AssertionError("history loading must not inspect current inputs")))

    assert training_history.all_history_payload()["jobs"][0]["input"] == {
        "fingerprint": "dataset-a", "configFingerprint": "config-a"
    }


def test_finished_early_history_uses_the_persisted_run_binding_for_resume(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "set"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    output = training_history.output_root_for_folder(set_folder, "lo") / "run-one-lo"
    (output / "global_step42").mkdir(parents=True)
    (output / "latest").write_text("global_step42", encoding="utf-8")
    training_history.record_job(set_folder, {
        "id": "early", "folder": "set", "status": "finished_early", "stages": "lo",
        "progress": {"stage": "lo", "epoch": 42}, "outputRunPath": str(output),
    })

    payload = training_history.all_history_payload()

    assert payload["jobs"][0]["outputRunPath"] == str(output)


def test_discover_runs_uses_a_latest_marker_but_returns_its_run_directory(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "set"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    output = root / "output" / "runs" / "set-lo"
    (set_folder / "config.lo.toml").write_text('output_dir = "' + str(output) + '"\n', encoding="utf-8")
    resumable = output / "run-resumable"
    resumable.mkdir(parents=True)
    (resumable / "latest").write_text("global_step42", encoding="utf-8")
    (resumable / "global_step42").mkdir()
    not_resumable = output / "run-with-log-only"
    not_resumable.mkdir(parents=True)
    (not_resumable / "training.log").write_text("still running", encoding="utf-8")

    runs = {run["name"]: run for run in training_history.discover_runs(set_folder, "lo")}

    assert runs["run-resumable"]["checkpointAvailable"] is True
    assert runs["run-resumable"]["path"] == str(resumable)
    assert runs["run-resumable"]["checkpointName"] == "latest"
    assert runs["run-with-log-only"]["checkpointAvailable"] is False
    assert runs["run-with-log-only"]["path"] == str(not_resumable)


def test_resume_point_reports_latest_checkpoint_and_artifact_progress(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "set"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    output = root / "output" / "runs" / "set-lo"
    (set_folder / "config.lo.toml").write_text('output_dir = "' + str(output) + '"\nepochs = 90\n', encoding="utf-8")
    run = output / "run-resumable"
    (run / "global_step420").mkdir(parents=True)
    (run / "epoch12").mkdir()
    (run / "latest").write_text("global_step420", encoding="utf-8")

    point = training_history.resume_point_for_path(set_folder, "lo", str(run))

    assert point == {
        "checkpointTag": "global_step420",
        "epoch": 12,
        "step": 420,
        "expectedEpochs": 90,
        "completed": False,
    }

    direct_point = training_history.resume_point_from_directory(set_folder, "lo", str(run))
    assert direct_point["checkpointAvailable"] is True
    assert direct_point["checkpointTag"] == "global_step420"
    assert direct_point["epoch"] == 12
    assert direct_point["step"] == 420


def test_resume_validation_allows_current_config_changes_but_rejects_another_set(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "Estel"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    run = root / "output" / "runs" / "001-Estel" / "wan22-lo" / "run"
    run.mkdir(parents=True)
    (run / "config.lo.toml").write_text('dataset = "/training/Estel/dataset.lo.toml"\nlr = 1e-4\n', encoding="utf-8")
    (run / "global_step42").mkdir()
    (run / "latest").write_text("global_step42", encoding="utf-8")
    (set_folder / "config.lo.toml").write_text("lr = 9e-6\nepochs = 200\n", encoding="utf-8")

    validated = training_history.validate_resumable_run_for_path(set_folder, "lo", str(run))
    assert validated["checkpointAvailable"] is True

    other_set = root / "Anfisa"
    other_set.mkdir()
    with pytest.raises(ValueError, match="belongs to set Estel"):
        training_history.validate_resumable_run_for_path(other_set, "lo", str(run))
    explicit = training_history.validate_resumable_run_for_path(other_set, "hi", str(run), enforce_identity=False)
    assert explicit["checkpointAvailable"] is True


def test_discover_runs_scans_new_launch_group_stage_directories(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "Estel"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    (set_folder / "config.krea2.toml").write_text('output_dir = "/source/Estel"\nepochs = 100\n', encoding="utf-8")
    run = root / "output" / "runs" / "00A-Estel" / "krea2-raw" / "20260718_00-30-10"
    run.mkdir(parents=True)
    (run / "config.krea2.toml").write_text('dataset = "/training/Estel/dataset.train.toml"\n', encoding="utf-8")
    (run / "global_step75").mkdir()
    (run / "latest").write_text("global_step75", encoding="utf-8")

    discovered = training_history.discover_runs(set_folder, "krea2")

    assert len(discovered) == 1
    assert discovered[0]["stage"] == "krea2"
    assert discovered[0]["checkpointTag"] == "global_step75"


def test_discover_runs_rejects_a_global_step_without_a_deepspeed_latest_marker(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "set"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    output = root / "output" / "runs" / "set-lo"
    (set_folder / "config.lo.toml").write_text('output_dir = "' + str(output) + '"\n', encoding="utf-8")
    checkpoint = output / "global_step17"
    checkpoint.mkdir(parents=True)

    assert training_history.discover_runs(set_folder, "lo") == []


def test_discover_runs_rejects_a_latest_marker_that_names_no_checkpoint(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "set"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    output = root / "output" / "runs" / "set-lo"
    (set_folder / "config.lo.toml").write_text('output_dir = "' + str(output) + '"\n', encoding="utf-8")
    run = output / "run-one"
    run.mkdir(parents=True)
    (run / "latest").write_text("global_step999", encoding="utf-8")

    runs = training_history.discover_runs(set_folder, "lo")

    assert runs[0]["checkpointAvailable"] is False


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


def test_discover_runs_detects_the_noise_model_from_the_saved_run_config(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "set"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    output = root / "output" / "runs" / "set"
    for stage, model in (("hi", "high_noise_model"), ("lo", "low_noise_model")):
        run = output / ("run-" + stage)
        run.mkdir(parents=True)
        (run / "config.toml").write_text(
            'transformer_path = "/models/' + model + '"\n', encoding="utf-8"
        )

    runs = {run["name"]: run for run in training_history.discover_runs(set_folder)}

    assert runs["run-hi"]["stage"] == "hi"
    assert runs["run-lo"]["stage"] == "lo"


def test_discover_runs_prefers_saved_run_config_over_current_shared_root_stage(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "char" / "lilly" / "lsAnfisa"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    shared_output = root / "output" / "runs" / "01-lsAnfisa"
    current_hi_output = root / "output" / "runs" / "02-lsAnfisa" / "wan22-hi"
    (set_folder / "config.hi.toml").write_text(
        'output_dir = "' + str(current_hi_output) + '"\nepochs = 50\n', encoding="utf-8"
    )
    (set_folder / "config.lo.toml").write_text(
        'output_dir = "' + str(shared_output) + '"\nepochs = 90\n', encoding="utf-8"
    )
    run = shared_output / "20260717_19-11-37"
    (run / "epoch50").mkdir(parents=True)
    (run / "global_step2950").mkdir()
    (run / "latest").write_text("global_step2950", encoding="utf-8")
    (run / "config.hi.toml").write_text(
        'dataset = "' + str(set_folder / "dataset.hi.toml") + '"\nepochs = 50\n', encoding="utf-8"
    )

    runs = {item["name"]: item for item in training_history.discover_runs(set_folder)}

    assert runs["20260717_19-11-37"]["stage"] == "hi"
    assert runs["20260717_19-11-37"]["expectedEpochs"] == 50
    assert runs["20260717_19-11-37"]["completed"] is True


def test_discover_runs_ignores_webcap_job_sidecars(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "set"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    output = training_history.output_root_for_folder(set_folder)
    (output / ".webcap" / "jobs" / "job-1").mkdir(parents=True)
    real_run = output / "real-run"
    real_run.mkdir(parents=True)
    (real_run / "global_step1").mkdir()
    (real_run / "latest").write_text("global_step1", encoding="utf-8")

    assert [run["name"] for run in training_history.discover_runs(set_folder)] == ["real-run"]


def test_discover_runs_ignores_another_sets_saved_run_config(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "set"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    output = training_history.output_root_for_folder(set_folder)
    own_run = output / "own-run"
    other_run = output / "other-run"
    for run, set_name in ((own_run, "set"), (other_run, "other")):
        run.mkdir(parents=True)
        (run / "config.toml").write_text(
            'dataset = "/training/' + set_name + '/dataset.lo.toml"\n', encoding="utf-8"
        )

    assert [run["name"] for run in training_history.discover_runs(set_folder)] == ["own-run"]


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
