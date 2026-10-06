import tool.server.config as config_module
import tool.server.training_config_files as training_config_files_module
import pytest


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
    assert "dataset.krea2.toml" in krea2_text
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


def test_failed_atomic_config_replace_keeps_existing_set_toml(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    folder.mkdir()
    config_path = folder / "config.krea2.toml"
    config_path.write_text("existing = true\n", encoding="utf-8")
    monkeypatch.setattr(training_config_files_module.os, "replace", lambda _temporary, _target: (_ for _ in ()).throw(OSError("replace failed")))

    with pytest.raises(OSError, match="replace failed"):
        training_config_files_module.reset_training_config_file(folder, "config.krea2.toml")

    assert config_path.read_text(encoding="utf-8") == "existing = true\n"
    assert not list(folder.glob(".config.krea2.toml.*.tmp"))


def test_failed_raw_toml_save_keeps_existing_file_and_cleans_temp(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    folder.mkdir()
    toml_path = folder / "dataset.train.toml"
    original = b"existing = true\n# preserve these bytes\n"
    toml_path.write_bytes(original)
    monkeypatch.setattr(config_module, "safe_join_fs_root", lambda _folder: folder)
    monkeypatch.setattr(config_module.os, "replace", lambda _temporary, _target: (_ for _ in ()).throw(OSError("replace failed")))

    with pytest.raises(OSError, match="replace failed"):
        config_module.save_toml_file("set", "dataset.train.toml", "replacement = true\n")

    assert toml_path.read_bytes() == original
    assert not list(folder.glob(".dataset.train.toml.*.tmp"))


def test_wan21_config_shares_the_set_output_root(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "lilly"
    folder.mkdir(parents=True)
    (folder / "clip.mp4").write_bytes(b"media")
    monkeypatch.setattr(config_module, "FS_ROOT", root)

    training_config_files_module.ensure_training_config_files(folder, profile_id="wan22_t2v")
    training_config_files_module.ensure_training_config_files(folder, profile_id="wan21_t2v_14b")
    wan21_text = (folder / "config.wan21.toml").read_text(encoding="utf-8")
    assert "dataset.wan21.toml" in wan21_text
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
    assert "dataset.h3.toml" in text
    assert training_config_files_module.output_dir_from_config(folder, "h3").name == "lilly"

    path.write_text("edited = true\n", encoding="utf-8")
    training_config_files_module.ensure_training_config_files(folder, profile_id="minimax_h3")
    assert path.read_text(encoding="utf-8") == "edited = true\n"
    training_config_files_module.reset_training_config_file(folder, "config.h3.toml")
    assert 'type = "minimax_h3"' in path.read_text(encoding="utf-8")



def test_existing_h3_and_wan21_configs_migrate_only_the_legacy_shared_dataset_name(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "lilly"
    folder.mkdir(parents=True)
    (folder / "clip.mp4").write_bytes(b"media")
    monkeypatch.setattr(config_module, "FS_ROOT", root)

    h3 = folder / "config.h3.toml"
    h3.write_text('dataset = "/sets/lilly/dataset.train.toml"\n[model]\ntype = "minimax_h3"\n', encoding="utf-8")
    wan21 = folder / "config.wan21.toml"
    wan21.write_text('dataset = "/sets/lilly/dataset.train.toml"\n[model]\ntype = "wan"\n', encoding="utf-8")

    training_config_files_module.ensure_training_config_files(folder, profile_id="minimax_h3")
    training_config_files_module.ensure_training_config_files(folder, profile_id="wan21_t2v_14b")

    assert 'dataset = "/sets/lilly/dataset.h3.toml"' in h3.read_text(encoding="utf-8")
    assert 'dataset = "/sets/lilly/dataset.wan21.toml"' in wan21.read_text(encoding="utf-8")

    h3.write_text('dataset = "/custom/my-dataset.toml"\n[model]\ntype = "minimax_h3"\n', encoding="utf-8")
    training_config_files_module.ensure_training_config_files(folder, profile_id="minimax_h3")
    assert 'dataset = "/custom/my-dataset.toml"' in h3.read_text(encoding="utf-8")

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


def test_training_repeat_reference_epochs_defaults_to_90():
    normalized = config_module.validate_config_payload({"filesystem": {"root": "C:/training", "models": ""}, "training": {}})
    assert normalized["training"]["repeat_reference_epochs"] == 90


def test_output_root_blank_uses_legacy_fs_output_location(tmp_path, monkeypatch):
    monkeypatch.setattr(config_module, "FS_ROOT", tmp_path)
    monkeypatch.setattr(config_module, "config", {
        "filesystem": {"root": str(tmp_path), "output_root": "", "models": ""}
    })

    assert config_module.output_root() == tmp_path / "output"


def test_filesystem_app_data_root_defaults_blank_and_preserves_configured_path(tmp_path):
    defaulted = config_module.validate_config_payload({
        "filesystem": {"root": "C:/training", "models": ""},
        "training": {},
    })
    assert defaulted["filesystem"]["app_data_root"] == ""

    configured_path = tmp_path / "webcap-state"
    configured = config_module.validate_config_payload({
        "filesystem": {
            "root": "C:/training",
            "app_data_root": str(configured_path),
            "models": "",
        },
        "training": {},
    })
    assert configured["filesystem"]["app_data_root"] == str(configured_path)


def test_default_app_data_root_uses_platform_conventions(monkeypatch, tmp_path):
    monkeypatch.setattr(config_module.sys, "platform", "win32")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "LocalAppData"))
    assert config_module._default_app_data_root() == tmp_path / "LocalAppData" / "WebCap"

    monkeypatch.setattr(config_module.sys, "platform", "linux")
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "xdg"))
    assert config_module._default_app_data_root() == tmp_path / "xdg" / "WebCap"


def test_app_data_helpers_use_configured_root(tmp_path, monkeypatch):
    root = tmp_path / "webcap-state"
    monkeypatch.setattr(config_module, "config", {
        "filesystem": {"root": str(tmp_path / "sets"), "app_data_root": str(root), "models": ""}
    })

    assert config_module.app_data_root() == root
    assert config_module.app_state_root() == root / "state"
    assert config_module.app_cache_root() == root / "cache"
    assert config_module.training_queue_state_path() == root / "state" / "training_queue.json"
    assert config_module.training_history_state_path() == root / "state" / "recent_runs.json"


def test_filesystem_app_data_root_rejects_relative_override():
    with pytest.raises(ValueError, match="app_data_root"):
        config_module.validate_config_payload({
            "filesystem": {"root": "C:/training", "app_data_root": "relative/app-data", "models": ""},
            "training": {},
        })


def test_filesystem_output_root_defaults_blank_and_preserves_configured_path():
    defaulted = config_module.validate_config_payload({
        "filesystem": {"root": "C:/training", "models": ""},
        "training": {},
    })
    assert defaulted["filesystem"]["output_root"] == ""

    configured = config_module.validate_config_payload({
        "filesystem": {
            "root": "C:/training",
            "output_root": "W:/webcap-output",
            "models": "",
        },
        "training": {},
    })
    assert configured["filesystem"]["output_root"] == "W:/webcap-output"


def test_caption_assist_sequence_defaults_and_allows_natural_mode():
    defaulted = config_module.validate_config_payload({
        "filesystem": {"root": "C:/training", "models": ""},
    })
    assert defaulted["caption_assist"]["preferred_sequence"] == config_module.DEFAULT_CAPTION_ASSIST_SEQUENCE
    assert defaulted["caption_assist"]["preferred_sequence"].endswith("background\nlighting\nview")

    natural = config_module.validate_config_payload({
        "filesystem": {"root": "C:/training", "models": ""},
        "caption_assist": {"preferred_sequence": ""},
    })
    assert natural["caption_assist"]["preferred_sequence"] == ""


def test_storyboard_director_limits_default_output_and_accept_overrides():
    normalized = config_module.validate_config_payload({
        "filesystem": {"root": "C:/training", "models": ""},
        "storyboard": {"director": {}},
    })
    assert normalized["storyboard"]["director"]["context_size"] is None
    assert normalized["storyboard"]["director"]["max_tokens"] == 16384

    automatic = config_module.validate_config_payload({
        "filesystem": {"root": "C:/training", "models": ""},
        "storyboard": {"director": {"max_tokens": None}},
    })
    assert automatic["storyboard"]["director"]["max_tokens"] is None

    overridden = config_module.validate_config_payload({
        "filesystem": {"root": "C:/training", "models": ""},
        "storyboard": {"director": {"context_size": 32768, "max_tokens": 8192}},
    })
    assert overridden["storyboard"]["director"]["context_size"] == 32768
    assert overridden["storyboard"]["director"]["max_tokens"] == 8192


def test_storyboard_director_accepts_multiple_named_remote_endpoints():
    normalized = config_module.validate_config_payload({
        "filesystem": {"root": "C:/training", "models": ""},
        "storyboard": {
            "director": {
                "remote_endpoints": [
                    {
                        "id": "macbook",
                        "name": "MacBook Pro",
                        "endpoint": "http://192.168.1.20:11434/v1",
                        "enabled": True,
                    },
                    {
                        "id": "gpu-box",
                        "name": "4060 Ti",
                        "endpoint": "http://192.168.1.30:11434/v1/",
                        "enabled": False,
                    },
                ]
            }
        },
    })

    assert normalized["storyboard"]["director"]["remote_endpoints"] == [
        {
            "id": "macbook",
            "name": "MacBook Pro",
            "endpoint": "http://192.168.1.20:11434/v1",
            "enabled": True,
        },
        {
            "id": "gpu-box",
            "name": "4060 Ti",
            "endpoint": "http://192.168.1.30:11434/v1",
            "enabled": False,
        },
    ]


def test_storyboard_director_migrates_legacy_single_remote_endpoint():
    normalized = config_module.validate_config_payload({
        "filesystem": {"root": "C:/training", "models": ""},
        "storyboard": {
            "director": {
                "mode": "remote",
                "endpoint": "http://director-box:11434/v1",
            }
        },
    })

    assert normalized["storyboard"]["director"]["mode"] == "remote"
    assert normalized["storyboard"]["director"]["remote_endpoints"] == [{
        "id": "remote",
        "name": "Remote",
        "endpoint": "http://director-box:11434/v1",
        "enabled": True,
    }]


def test_storyboard_director_rejects_duplicate_remote_endpoint_ids():
    with pytest.raises(ValueError, match="ids must be unique"):
        config_module.validate_config_payload({
            "filesystem": {"root": "C:/training", "models": ""},
            "storyboard": {
                "director": {
                    "remote_endpoints": [
                        {"id": "same", "endpoint": "http://one:11434/v1"},
                        {"id": "same", "endpoint": "http://two:11434/v1"},
                    ]
                }
            },
        })


def test_training_repeat_reference_epochs_must_be_positive_integer():
    with pytest.raises(ValueError, match="repeat_reference_epochs"):
        config_module.validate_config_payload({"filesystem": {"root": "C:/training", "models": ""}, "training": {"repeat_reference_epochs": 0}})


def test_app_theme_is_validated_as_durable_config():
    defaulted = config_module.validate_config_payload({
        "filesystem": {"root": "C:/training", "models": ""},
    })
    assert defaulted["theme"] == "light"

    dark = config_module.validate_config_payload({
        "filesystem": {"root": "C:/training", "models": ""},
        "theme": "dark",
    })
    assert dark["theme"] == "dark"

    with pytest.raises(ValueError, match="Config.theme"):
        config_module.validate_config_payload({
            "filesystem": {"root": "C:/training", "models": ""},
            "theme": "sepia",
        })


def test_director_model_is_validated_as_durable_config():
    defaulted = config_module.validate_config_payload({
        "filesystem": {"root": "C:/training", "models": ""},
        "training": {},
    })
    assert defaulted["director_model"] == ""

    selected = config_module.validate_config_payload({
        "filesystem": {"root": "C:/training", "models": ""},
        "training": {},
        "director_model": "  local-model-id  ",
    })
    assert selected["director_model"] == "local-model-id"

    with pytest.raises(ValueError, match="Config.director_model"):
        config_module.validate_config_payload({
            "filesystem": {"root": "C:/training", "models": ""},
            "training": {},
            "director_model": 42,
        })


def test_generate_model_is_validated_as_durable_config():
    defaulted = config_module.validate_config_payload({
        "filesystem": {"root": "C:/training", "models": ""},
        "training": {},
    })
    assert defaulted["generate_model"] == ""

    selected = config_module.validate_config_payload({
        "filesystem": {"root": "C:/training", "models": ""},
        "training": {},
        "generate_model": "  minimax_h3  ",
    })
    assert selected["generate_model"] == "minimax_h3"

    with pytest.raises(ValueError, match="Config.generate_model"):
        config_module.validate_config_payload({
            "filesystem": {"root": "C:/training", "models": ""},
            "training": {},
            "generate_model": 42,
        })


def test_vision_model_preference_defaults_blank_and_preserves_qualified_ref():
    defaulted = config_module.validate_config_payload({
        "filesystem": {"root": "C:/training", "models": ""},
    })
    assert defaulted["vision_model"] == ""

    configured = config_module.validate_config_payload({
        "filesystem": {"root": "C:/training", "models": ""},
        "vision_model": "workstation::huihui_ai/qwen3-vl-abliterated:8b",
    })
    assert configured["vision_model"] == "workstation::huihui_ai/qwen3-vl-abliterated:8b"
