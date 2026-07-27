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


def test_invalid_set_training_metadata_is_visible_and_untouched(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    folder.mkdir(parents=True)
    path = folder / ".webcap_training.json"
    path.write_text("{bad", encoding="utf-8")
    monkeypatch.setattr(config_module, "FS_ROOT", root)

    with pytest.raises(ValueError, match="left unchanged"):
        training_history.training_output_group_for_folder(folder, create=True)

    assert path.read_text(encoding="utf-8") == "{bad"


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

    runs = training_history.discover_runs(set_folder, "lo")

    assert [entry["name"] for entry in runs] == ["20260713_01-00-00"]
    assert runs[0]["matchType"] == "exact"


def test_history_output_root_uses_the_available_profile_config(tmp_path, monkeypatch):
    root = tmp_path / "training"
    set_folder = root / "char" / "lilly"
    output = root / "output" / "runs" / "007-lilly" / "krea2-raw"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    (set_folder / "config.krea2.toml").write_text(_krea_config(output, "lilly"), encoding="utf-8")

    assert training_history.read_history(set_folder)["outputRoot"] == str(output)


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




def test_run_discovery_ignores_removed_or_unreadable_set_artifacts(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    folder.mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    (folder / "config.lo.toml").write_text("not valid toml =", encoding="utf-8")

    assert training_history.discover_runs(folder, "lo") == []
    assert training_history.discover_runs(root / "deleted-set") == []
