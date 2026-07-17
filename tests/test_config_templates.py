from pathlib import Path

import tool.server.config as config_module
import tool.server.training_config_files as training_config_files_module


def test_fill_template_placeholders_normalizes_paths(monkeypatch):
    monkeypatch.setattr(
        config_module,
        "config",
        {
            "filesystem": {
                "root": "C:\\training\\",
                "models": "/mnt/w/models//",
            }
        },
    )

    template = (
        'dataset = "{TRAINING_ROOT}/{DATASET}/dataset.lo.toml"\n'
        'model = "{MODELS_ROOT}/Stable-diffusion"\n'
    )
    rendered = config_module.fill_template_placeholders(template, r"/set//nested\subject_a/")

    assert 'dataset = "C:/training/set/nested/subject_a/dataset.lo.toml"' in rendered
    assert 'model = "/mnt/w/models/Stable-diffusion"' in rendered
    assert "training//set" not in rendered
    assert "models//Stable-diffusion" not in rendered


def test_dataset_lo_example_uses_placeholders():
    template_path = Path(__file__).resolve().parents[1] / "docs" / "examples" / "dataset.lo.toml"
    text = template_path.read_text(encoding="utf-8")

    assert "/mnt/w/training/massage/v3/" not in text
    assert text.count('{TRAINING_ROOT}/{DATASET}/auto_dataset/square') >= 2
    assert text.count('{TRAINING_ROOT}/{DATASET}/auto_dataset/169') >= 2


def test_default_training_epochs_follow_canonical_templates():
    assert training_config_files_module.default_training_config_epochs() == (50, 90)


def test_training_templates_use_the_tensorboard_output_root():
    hi = training_config_files_module.read_training_config_template("config.hi.toml")
    lo = training_config_files_module.read_training_config_template("config.lo.toml")

    assert 'output_dir = "{TRAINING_ROOT}/output/sets/{SET_NAME}"' in hi
    assert 'output_dir = "{TRAINING_ROOT}/output/sets/{SET_NAME}"' in lo


def test_new_training_configs_reserve_a_shared_base36_output_dir(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "lilly"
    folder.mkdir(parents=True)
    (folder / "clip.mp4").write_bytes(b"media")
    monkeypatch.setattr(config_module, "FS_ROOT", root)

    training_config_files_module.ensure_training_config_files(folder)

    expected = root / "output" / "sets" / "001-lilly"
    assert training_config_files_module.output_dir_from_config(folder, "hi") == expected
    assert training_config_files_module.output_dir_from_config(folder, "lo") == expected
    assert expected.is_dir()


def test_new_training_config_sequence_advances_in_base36(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "lilly"
    folder.mkdir(parents=True)
    (folder / "clip.mp4").write_bytes(b"media")
    output_root = root / "output" / "sets"
    (output_root / "009-sana").mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)

    training_config_files_module.ensure_training_config_files(folder)

    assert training_config_files_module.output_dir_from_config(folder, "hi") == output_root / "00A-lilly"


def test_new_training_config_sequence_recognizes_legacy_two_character_prefixes(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "lilly"
    folder.mkdir(parents=True)
    (folder / "clip.mp4").write_bytes(b"media")
    output_root = root / "output" / "sets"
    (output_root / "0A-sana").mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)

    training_config_files_module.ensure_training_config_files(folder)

    assert training_config_files_module.output_dir_from_config(folder, "hi") == output_root / "00B-lilly"


def test_regenerating_training_configs_preserves_the_configured_output_dir(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "lilly"
    folder.mkdir(parents=True)
    (folder / "clip.mp4").write_bytes(b"media")
    original = root / "output" / "runs" / "legacy-lilly"
    for stage in ("hi", "lo"):
        (folder / ("config." + stage + ".toml")).write_text(
            'output_dir = "' + original.as_posix() + '"\nepochs = 1\n', encoding="utf-8"
        )
    monkeypatch.setattr(config_module, "FS_ROOT", root)

    training_config_files_module.ensure_training_config_files(folder)

    assert training_config_files_module.output_dir_from_config(folder, "hi") == original
    assert training_config_files_module.output_dir_from_config(folder, "lo") == original
