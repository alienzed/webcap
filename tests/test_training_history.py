import json
from pathlib import Path

import pytest

from tool.server import config as config_module
from tool.server import training_history
from tool.server import training_runner


def _wan_config(output, transformer="low_noise_model", set_name="set", epochs=90, lr="4e-5"):
    output = str(output).replace("\\", "/")
    return (
        f'output_dir = "{output}"\n'
        f'dataset = "/training/{set_name}/dataset.lo.toml"\n'
        f'epochs = {epochs}\n'
        f'lr = {lr}\n\n'
        '[model]\n'
        'type = "wan"\n'
        'ckpt_path = "/models/Wan2.2-T2V-A14B"\n'
        f'transformer_path = "/models/{transformer}"\n'
    )


def _krea_config(output, set_name="set"):
    output = str(output).replace("\\", "/")
    return (
        f'output_dir = "{output}"\n'
        f'dataset = "/training/{set_name}/dataset.train.toml"\n\n'
        '[model]\n'
        'type = "krea2"\n'
        'diffusion_model = "/models/krea2.safetensors"\n'
    )


def _h3_config(output, set_name="set"):
    output = str(output).replace("\\", "/")
    return (
        f'output_dir = "{output}"\n'
        f'dataset = "/training/{set_name}/dataset.train.toml"\n'
        'epochs = 100\n\n'
        '[model]\n'
        'type = "minimax_h3"\n'
        'diffusion_model = "/models/minimax_h3_fl2va_pruned_int8_convrot.safetensors"\n'
    )


def _checkpoint(run, config_text, config_name="config.lo.toml", step=42, epoch=0):
    run.mkdir(parents=True)
    (run / config_name).write_text(config_text, encoding="utf-8")
    (run / f"global_step{step}").mkdir()
    (run / "latest").write_text(f"global_step{step}", encoding="utf-8")
    if epoch:
        (run / f"epoch{epoch}").mkdir()


def test_set_adopts_the_group_with_real_run_activity_and_reuses_it(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    active_group = root / "output" / "runs" / "001-set"
    abandoned_group = root / "output" / "runs" / "002-set"
    _checkpoint(active_group / "wan22-hi" / "20260721_22-03-39", _wan_config(active_group / "wan22-hi"))
    abandoned_group.mkdir(parents=True)

    selected = training_history.training_output_group_for_folder(folder, create=True)

    assert selected == active_group
    assert training_history.training_output_group_for_folder(folder, create=True) == active_group
    history = training_history.read_history(folder)
    assert history["outputGroup"] == "001-set"
    assert not (root / "output" / "runs" / "003-set").exists()


def test_resume_discovery_uses_the_sets_remembered_model_folder(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    remembered_group = root / "output" / "runs" / "014-set"
    remembered_model = remembered_group / "wan22-lo"
    unrelated_current_output = root / "output" / "runs" / "099-set" / "wan22-lo"
    current = _wan_config(unrelated_current_output)
    (folder / "config.lo.toml").write_text(current, encoding="utf-8")
    _checkpoint(remembered_model / "20260721_22-03-39", current, step=9282, epoch=40)
    training_history._write_history(folder, {
        "version": training_history.HISTORY_VERSION,
        "outputGroup": remembered_group.name,
        "jobs": [],
        "runs": [],
    })

    runs = training_history.discover_runs(folder, "lo")

    assert [run["name"] for run in runs] == ["20260721_22-03-39"]
    assert Path(runs[0]["path"]) == remembered_model / "20260721_22-03-39"


def test_training_history_discovers_only_compatible_runs_in_the_configured_output(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "char" / "lilly"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    output = root / "output" / "runs" / "lilly"
    source = _wan_config(output, set_name="lilly")
    (set_folder / "config.lo.toml").write_text(source, encoding="utf-8")
    _checkpoint(output / "20260713_01-00-00", source)
    _checkpoint(root / "output" / "runs" / "other" / "run", source)

    history = training_history.record_job(set_folder, {
        "id": "job-1", "folder": "char/lilly", "status": "paused", "stages": "lo", "createdAt": 1,
    })

    assert [entry["name"] for entry in history["runs"]] == ["20260713_01-00-00"]
    assert history["runs"][0]["matchType"] == "exact"
    assert (root / ".webcap_training" / training_history.RECENT_RUNS_FILE_NAME).is_file()
    assert not (set_folder / ".webcap_training.json").exists()


def test_history_output_root_uses_the_available_profile_config(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "char" / "lilly"
    output = root / "output" / "runs" / "007-lilly" / "krea2-raw"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    (set_folder / "config.krea2.toml").write_text(_krea_config(output, "lilly"), encoding="utf-8")

    assert training_history.history_payload(set_folder)["outputRoot"] == str(output)


def test_krea_history_discovers_a_checkpoint_under_a_prefixed_output_root(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "char" / "lilly"
    output = root / "output" / "runs" / "007-lilly" / "krea2-raw"
    config = _krea_config(output, "lilly")
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    (set_folder / "config.krea2.toml").write_text(config, encoding="utf-8")
    _checkpoint(output / "20260719_13-29-01", config, "config.krea2.toml", step=4720)

    runs = training_history.discover_runs(set_folder, "krea2")

    assert [run["name"] for run in runs] == ["20260719_13-29-01"]
    assert runs[0]["path"] == str(output / "20260719_13-29-01")


def test_h3_history_discovers_a_compatible_checkpoint(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "char" / "lilly"
    output = root / "output" / "runs" / "007-lilly" / "minimax-h3"
    config = _h3_config(output, "lilly")
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    (set_folder / "config.h3.toml").write_text(config, encoding="utf-8")
    _checkpoint(output / "20260814_09-00-00", config, "config.h3.toml", step=9500)

    runs = training_history.discover_runs(set_folder, "h3")

    assert [run["name"] for run in runs] == ["20260814_09-00-00"]
    assert runs[0]["path"] == str(output / "20260814_09-00-00")


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
    run = root / "output" / "runs" / "lilly" / "run-one"
    run.mkdir(parents=True)
    training_history.record_job(set_folder, {
        "id": "job-1", "folder": "char/lilly", "status": "completed", "stages": "hi",
        "model": {"label": "Example", "source": "example.safetensors"},
        "input": {"count": 2, "fingerprint": "sha256:test", "configFingerprint": "sha256:config"},
    })
    payload = training_history.all_history_payload("example")
    assert len(payload["jobs"]) == 1
    assert "runDirectories" not in payload["jobs"][0]
    assert training_history.clear_history(set_folder) == 1
    assert run.exists()


def test_legacy_set_histories_migrate_once_to_central_recent_runs(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    legacy = {
        "version": training_history.HISTORY_VERSION,
        "outputGroup": "001-set",
        "jobs": [{"id": "legacy", "status": "completed", "createdAt": 1}],
        "runs": [],
    }
    (folder / training_history.HISTORY_FILE_NAME).write_text(json.dumps(legacy), encoding="utf-8")

    assert [job["id"] for job in training_history.all_history_payload()["jobs"]] == ["legacy"]

    central = json.loads(
        (root / ".webcap_training" / training_history.RECENT_RUNS_FILE_NAME).read_text(encoding="utf-8")
    )
    local = json.loads((folder / training_history.HISTORY_FILE_NAME).read_text(encoding="utf-8"))
    assert central["jobs"][0]["folder"] == "set"
    assert local == {"version": training_history.HISTORY_VERSION, "outputGroup": "001-set"}


def test_version_4_set_metadata_compacts_without_losing_output_group(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    (folder / training_history.HISTORY_FILE_NAME).write_text(json.dumps({
        "version": 4,
        "outputGroup": "002-set",
    }), encoding="utf-8")

    assert training_history.all_history_payload()["jobs"] == []

    local = json.loads((folder / training_history.HISTORY_FILE_NAME).read_text(encoding="utf-8"))
    assert local == {"version": training_history.HISTORY_VERSION, "outputGroup": "002-set"}


def test_global_history_hides_cancelled_items(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "set"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    training_history.record_job(set_folder, {"id": "cancelled", "folder": "set", "status": "cancelled", "createdAt": 1})
    training_history.record_job(set_folder, {"id": "completed", "folder": "set", "status": "completed", "createdAt": 2})
    assert [job["id"] for job in training_history.all_history_payload()["jobs"]] == ["completed"]


def test_global_history_returns_persisted_rows_without_rechecking_current_inputs(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "set"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    training_history.record_job(set_folder, {
        "id": "job", "folder": "set", "status": "finished_early",
        "input": {"fingerprint": "dataset-a", "configFingerprint": "config-a"},
    })
    monkeypatch.setattr(training_runner, "_input_evidence", lambda folder: (_ for _ in ()).throw(AssertionError("must not inspect inputs")))
    assert training_history.all_history_payload()["jobs"][0]["input"]["fingerprint"] == "dataset-a"


def test_global_history_reports_artifact_availability(tmp_path, monkeypatch):
    root = tmp_path / "root"
    folder = root / "set"
    output = tmp_path / "output"
    artifact_dir = tmp_path / "job"
    folder.mkdir(parents=True)
    output.mkdir()
    artifact_dir.mkdir()
    (artifact_dir / "run.log").write_text("running", encoding="utf-8")
    monkeypatch.setattr(training_history.app_config, "FS_ROOT", root)
    training_history.record_job(folder, {
        "id": "available",
        "status": "completed",
        "outputRoot": str(output),
        "artifactDir": str(artifact_dir),
    })

    job = training_history.all_history_payload()["jobs"][0]

    assert job["sourceAvailable"] is True
    assert job["outputAvailable"] is True
    assert job["logAvailable"] is True


def test_finished_early_history_keeps_the_exact_persisted_run_path(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "set"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    output = root / "output" / "runs" / "set" / "run-one"
    training_history.record_job(set_folder, {
        "id": "early", "folder": "set", "status": "finished_early", "stages": "lo", "outputRunPath": str(output),
    })
    assert training_history.all_history_payload()["jobs"][0]["outputRunPath"] == str(output)


def test_global_history_enriches_legacy_checkpoint_summary_from_the_run_marker(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "set"
    output = root / "output" / "runs" / "set" / "run-one"
    set_folder.mkdir(parents=True)
    output.mkdir(parents=True)
    (output / "latest").write_text("global_step42000\n", encoding="utf-8")
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    training_history.record_job(set_folder, {
        "id": "early", "folder": "set", "status": "finished_early", "stages": "lo",
        "outputRunPath": str(output), "artifactSummary": {"epoch": 52, "steps": 42000},
    })

    summary = training_history.all_history_payload()["jobs"][0]["artifactSummary"]

    assert summary["checkpointTag"] == "global_step42000"


def test_discovery_keeps_exact_and_compatible_resume_choices(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    output = root / "output" / "runs" / "set"
    current = _wan_config(output, lr="4e-5")
    compatible = _wan_config(output, lr="9e-6")
    (folder / "config.lo.toml").write_text(current, encoding="utf-8")
    _checkpoint(output / "exact-old", current, step=100, epoch=10)
    _checkpoint(output / "exact-new", current, step=200, epoch=20)
    _checkpoint(output / "compatible", compatible, step=300, epoch=30)

    runs = training_history.discover_runs(folder, "lo")

    assert {run["name"] for run in runs} == {"exact-old", "exact-new", "compatible"}
    assert {run["matchType"] for run in runs} == {"exact", "compatible"}


def test_discovered_run_output_path_accepts_a_current_same_model_candidate(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    output = root / "output" / "runs" / "set"
    folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    config = _wan_config(output)
    (folder / "config.lo.toml").write_text(config, encoding="utf-8")
    run = output / "20260718_14-20-10"
    _checkpoint(run, config)

    assert training_history.discovered_run_output_path(folder, "lo", str(run)) == run
    with pytest.raises(ValueError, match="not a current same-model candidate"):
        training_history.discovered_run_output_path(folder, "lo", str(output / "other"))


def test_no_exact_hash_shows_all_same_model_fallbacks_recursively(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    output = root / "output" / "runs" / "set"
    current = _wan_config(output, lr="4e-5")
    (folder / "config.lo.toml").write_text(current, encoding="utf-8")
    _checkpoint(output / "moved" / "one", _wan_config("/old/location", set_name="other", lr="1e-5"), step=10)
    _checkpoint(output / "two", _wan_config("/another/location", lr="2e-5"), step=20)
    _checkpoint(output / "different-model", _wan_config(output, transformer="high_noise_model"), step=30)
    invalid = output / "invalid"
    invalid.mkdir(parents=True)
    (invalid / "config.lo.toml").write_text(current, encoding="utf-8")
    (invalid / "latest").write_text("global_step999", encoding="utf-8")

    runs = training_history.discover_runs(folder, "lo")

    assert {run["name"] for run in runs} == {"one", "two"}
    assert all(run["matchType"] == "compatible" for run in runs)
    assert {run["setName"] for run in runs} == {"set", "other"}


def test_shared_output_classifies_high_and_low_by_registry_model_identity(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    output = root / "output" / "runs" / "set"
    hi = _wan_config(output, transformer="high_noise_model", epochs=50)
    lo = _wan_config(output, transformer="low_noise_model", epochs=90)
    (folder / "config.hi.toml").write_text(hi, encoding="utf-8")
    (folder / "config.lo.toml").write_text(lo, encoding="utf-8")
    _checkpoint(output / "20260717_19-11-37", hi, "config.hi.toml", step=2950, epoch=50)
    _checkpoint(output / "20260717_20-40-32", lo, "config.lo.toml", step=12980, epoch=56)

    runs = training_history.discover_runs(folder)

    assert {(run["name"], run["stage"], run["modelLabel"]) for run in runs} == {
        ("20260717_19-11-37", "hi", "Wan2.2 High Noise"),
        ("20260717_20-40-32", "lo", "Wan2.2 Low Noise"),
    }


def test_resume_point_reads_the_explicit_checkpoint_directly(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    (folder / "config.lo.toml").write_text("epochs = 90\n", encoding="utf-8")
    run = root / "elsewhere" / "run"
    _checkpoint(run, "not a parseable training config", step=420, epoch=12)
    assert training_history.resume_point_for_path(folder, "lo", str(run)) == {
        "checkpointTag": "global_step420", "epoch": 12, "step": 420, "expectedEpochs": 90, "completed": False,
    }


def test_recorded_resume_validation_checks_checkpoint_structure_not_set_labels(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "Anfisa"
    folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    run = root / "output" / "runs" / "Estel" / "run"
    _checkpoint(run, 'dataset = "/training/Estel/dataset.lo.toml"\n')
    assert training_history.validate_resumable_run_for_path(folder, "lo", str(run))["checkpointAvailable"] is True
    (run / "latest").write_text("global_step999", encoding="utf-8")
    with pytest.raises(ValueError, match="no valid latest"):
        training_history.validate_resumable_run_for_path(folder, "lo", str(run))


def test_discovery_ignores_webcap_sidecars(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    output = root / "output" / "runs" / "set"
    config = _wan_config(output)
    (folder / "config.lo.toml").write_text(config, encoding="utf-8")
    _checkpoint(output / ".webcap" / "jobs" / "fake", config)
    _checkpoint(output / "real", config)
    assert [run["name"] for run in training_history.discover_runs(folder, "lo")] == ["real"]


def test_completed_models_accept_terminal_jobs(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    output = root / "output" / "runs" / "set"
    (folder / "config.hi.toml").write_text(_wan_config(output, "high_noise_model", epochs=50), encoding="utf-8")
    (folder / "config.lo.toml").write_text(_wan_config(output, "low_noise_model", epochs=90), encoding="utf-8")
    training_history.record_job(folder, {"id": "hi", "status": "completed", "stages": "hi"})
    training_history.record_job(folder, {"id": "lo", "status": "finished_early", "stages": "lo"})
    assert training_history.completed_stages(folder) == (["hi", "lo"], {"hi", "lo"})


def test_run_discovery_ignores_removed_or_unreadable_set_artifacts(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    (folder / "config.lo.toml").write_text("not valid toml =", encoding="utf-8")

    assert training_history.discover_runs(folder, "lo") == []
    assert training_history.discover_runs(root / "deleted-set") == []
