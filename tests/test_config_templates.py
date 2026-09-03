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


def test_default_training_epochs_follow_canonical_templates():
    assert training_config_files_module.default_training_config_epochs() == (60, 90)


def test_training_templates_use_the_shared_output_root():
    hi = training_config_files_module.read_training_config_template("config.hi.toml")
    lo = training_config_files_module.read_training_config_template("config.lo.toml")

    assert 'output_dir = "{TRAINING_ROOT}/output/runs/{SET_NAME}"' in hi
    assert 'output_dir = "{TRAINING_ROOT}/output/runs/{SET_NAME}"' in lo


def test_generated_training_configs_keep_the_neutral_template_output_dir(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "lilly"
    folder.mkdir(parents=True)
    (folder / "clip.mp4").write_bytes(b"media")
    monkeypatch.setattr(config_module, "FS_ROOT", root)

    training_config_files_module.ensure_training_config_files(folder)

    hi = training_config_files_module.output_dir_from_config(folder, "hi")
    lo = training_config_files_module.output_dir_from_config(folder, "lo")
    assert hi == lo
    assert hi.name == "lilly"
    assert not hi.name.startswith("001-")


def test_krea2_config_is_rendered_with_the_existing_shared_output_dir(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "lilly"
    folder.mkdir(parents=True)
    (folder / "clip.png").write_bytes(b"media")
    monkeypatch.setattr(config_module, "FS_ROOT", root)

    training_config_files_module.ensure_training_config_files(folder)

    krea2_path = folder / "config.krea2.toml"
    assert krea2_path.is_file()
    krea2_text = krea2_path.read_text(encoding="utf-8")
    assert 'dataset    = "' in krea2_text
    assert "dataset.train.toml" in krea2_text
    assert "{TRAINING_ROOT}" not in krea2_text
    assert "{DATASET}" not in krea2_text
    assert training_config_files_module.output_dir_from_config(folder, "krea2") == training_config_files_module.output_dir_from_config(folder, "hi")


def test_profile_generation_only_creates_missing_selected_configs_and_reset_is_explicit(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "lilly"
    folder.mkdir(parents=True)
    (folder / "clip.png").write_bytes(b"media")
    monkeypatch.setattr(config_module, "FS_ROOT", root)

    training_config_files_module.ensure_training_config_files(folder, profile_id="krea2_raw")
    krea = folder / "config.krea2.toml"
    assert krea.is_file()
    assert not (folder / "config.hi.toml").exists()
    krea.write_text("edited = true\n", encoding="utf-8")

    training_config_files_module.ensure_training_config_files(folder, profile_id="krea2_raw")
    assert krea.read_text(encoding="utf-8") == "edited = true\n"
    training_config_files_module.reset_training_config_file(folder, "config.krea2.toml")
    assert "type = \"krea2\"" in krea.read_text(encoding="utf-8")


def test_wan21_config_shares_the_set_output_root(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "lilly"
    folder.mkdir(parents=True)
    (folder / "clip.mp4").write_bytes(b"media")
    monkeypatch.setattr(config_module, "FS_ROOT", root)

    training_config_files_module.ensure_training_config_files(folder, profile_id="wan22_t2v")
    training_config_files_module.ensure_training_config_files(folder, profile_id="wan21_t2v_14b")
    assert training_config_files_module.output_dir_from_config(folder, "wan21") == training_config_files_module.output_dir_from_config(folder, "hi")


def test_h3_config_uses_the_recommended_components_and_shared_output_root(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "lilly"
    folder.mkdir(parents=True)
    (folder / "clip.mp4").write_bytes(b"media")
    monkeypatch.setattr(config_module, "FS_ROOT", root)

    training_config_files_module.ensure_training_config_files(folder, profile_id="minimax_h3")

    path = folder / "config.h3.toml"
    text = path.read_text(encoding="utf-8")
    assert 'type = "minimax_h3"' in text
    assert "minimax_h3_fl2va_pruned_int8_convrot.safetensors" in text
    assert "minimax_h3_video_vae_fp16.safetensors" in text
    assert "minimax_h3_audio_vae_fp32.safetensors" in text
    assert "qwen3vl_32b_minimax_h3_int8_convrot.safetensors" in text
    assert "cfg = 4" in text
    assert training_config_files_module.output_dir_from_config(folder, "h3").name == "lilly"

    path.write_text("edited = true\n", encoding="utf-8")
    training_config_files_module.ensure_training_config_files(folder, profile_id="minimax_h3")
    assert path.read_text(encoding="utf-8") == "edited = true\n"
    training_config_files_module.reset_training_config_file(folder, "config.h3.toml")
    assert 'type = "minimax_h3"' in path.read_text(encoding="utf-8")


def test_launch_group_sequence_advances_in_decimal(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "lilly"
    folder.mkdir(parents=True)
    (folder / "clip.mp4").write_bytes(b"media")
    output_root = root / "output" / "runs"
    (output_root / "009-sana").mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)

    launch_group = training_config_files_module.allocate_training_launch_group(folder)

    assert launch_group == output_root / "010-lilly"


def test_launch_group_sequence_ignores_nonstandard_old_prefixes(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "lilly"
    folder.mkdir(parents=True)
    (folder / "clip.mp4").write_bytes(b"media")
    output_root = root / "output" / "runs"
    (output_root / "0A-sana").mkdir(parents=True)
    monkeypatch.setattr(config_module, "FS_ROOT", root)

    launch_group = training_config_files_module.allocate_training_launch_group(folder)

    assert launch_group == output_root / "001-lilly"


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
