from pathlib import Path
import tomllib

import pytest
from PIL import Image

from tool.server import training_bundle
from tool.server.training_bundle import materialize_training_bundle
from tool.server.training_config_files import render_training_config_template, training_config_template_path
from tool.server.training_profiles import profiles
from tool.server.training_setup import ensure_training_setup


def _image(folder, name, size=(512, 512), caption="caption"):
    path = folder / name
    Image.new("RGB", size, color=(32, 64, 96)).save(path)
    if caption is not None:
        path.with_suffix(".txt").write_text(caption, encoding="utf-8")
    return path


def _fake_wsl(path, distribution=""):
    del distribution
    return "/mnt/test/" + Path(path).as_posix().replace(":", "").lstrip("/")


def test_every_profile_mode_has_the_expected_persistent_filenames():
    expected = {
        "wan22_t2v": lambda mode: {
            f"config.wan22.{mode}.hi.toml", f"config.wan22.{mode}.lo.toml",
            f"dataset.wan22.{mode}.hi.toml", f"dataset.wan22.{mode}.lo.toml",
        },
        "krea2_raw": lambda mode: {f"config.krea2.{mode}.toml", f"dataset.krea2.{mode}.toml"},
        "wan21_t2v_14b": lambda mode: {f"config.wan21.{mode}.toml", f"dataset.wan21.{mode}.toml"},
        "minimax_h3": lambda mode: {f"config.h3.{mode}.toml", f"dataset.h3.{mode}.toml"},
    }
    for profile in profiles():
        for mode in ("poc", "normal", "quality"):
            setup = profile["setups"][mode]
            names = {item["file"] for item in setup["configs"]} | set(setup["datasetFiles"])
            assert names == expected[profile["id"]](mode)
            for config in setup["configs"]:
                assert training_config_template_path(config["file"]).is_file()


def test_every_mode_template_is_complete_and_points_at_its_own_dataset(tmp_path):
    folder = tmp_path / "set"
    folder.mkdir()
    for profile in profiles():
        for mode in ("poc", "normal", "quality"):
            for config in profile["setups"][mode]["configs"]:
                text = render_training_config_template(config["file"], folder)
                parsed = tomllib.loads(text)
                assert parsed["dataset"].replace("\\", "/").endswith("/" + config["dataset"])
                assert "lr" in parsed["optimizer"]


def test_mode_templates_use_the_approved_learning_rate_ladder(tmp_path):
    expected = {
        "config.wan22.poc.hi.toml": 8e-5,
        "config.wan22.normal.hi.toml": 6e-5,
        "config.wan22.quality.hi.toml": 4e-5,
        "config.wan22.poc.lo.toml": 5e-5,
        "config.wan22.normal.lo.toml": 4e-5,
        "config.wan22.quality.lo.toml": 3e-5,
        "config.wan21.poc.toml": 5e-5,
        "config.wan21.normal.toml": 4e-5,
        "config.wan21.quality.toml": 3e-5,
        "config.krea2.poc.toml": 8e-5,
        "config.krea2.normal.toml": 6e-5,
        "config.krea2.quality.toml": 4e-5,
        "config.h3.poc.toml": 1.2e-4,
        "config.h3.normal.toml": 1e-4,
        "config.h3.quality.toml": 8e-5,
    }
    for name, learning_rate in expected.items():
        parsed = tomllib.loads(render_training_config_template(name, tmp_path))
        assert parsed["optimizer"]["lr"] == learning_rate


def test_setup_seeding_preserves_existing_files_and_resets_from_each_mode_template(tmp_path):
    folder = tmp_path / "set"
    folder.mkdir()
    _image(folder, "one.png")
    legacy = (
        'output_dir = "/legacy/output"\n'
        'dataset = "dataset.train.toml"\n'
        'epochs = 7\nlearning_rate = 3e-5\n'
        '[model]\ntype = "minimax_h3"\n'
    )
    (folder / "config.h3.toml").write_text(legacy, encoding="utf-8")

    ensure_training_setup(folder, "minimax_h3", "normal", selected_media=["one.png"])
    normal = folder / "config.h3.normal.toml"
    assert "learning_rate = 3e-5" in normal.read_text(encoding="utf-8")
    assert 'dataset = "dataset.h3.normal.toml"' in normal.read_text(encoding="utf-8")

    normal.write_text(normal.read_text(encoding="utf-8") + "# kept edit\n", encoding="utf-8")
    ensure_training_setup(folder, "minimax_h3", "normal", selected_media=["one.png"])
    assert normal.read_text(encoding="utf-8").endswith("# kept edit\n")

    ensure_training_setup(folder, "minimax_h3", "quality", selected_media=["one.png"])
    quality = folder / "config.h3.quality.toml"
    assert "WebCap Quality template" in quality.read_text(encoding="utf-8")
    assert "# kept edit" not in quality.read_text(encoding="utf-8")
    quality.write_text(quality.read_text(encoding="utf-8") + "# discard\n", encoding="utf-8")
    normal.write_text(normal.read_text(encoding="utf-8") + "# newest normal\n", encoding="utf-8")
    ensure_training_setup(
        folder, "minimax_h3", "quality", selected_media=["one.png"], reset_file=quality.name
    )
    assert "WebCap Quality template" in quality.read_text(encoding="utf-8")
    assert "# newest normal" not in quality.read_text(encoding="utf-8")
    assert "# discard" not in quality.read_text(encoding="utf-8")


def test_dataset_reset_recalculates_only_from_the_visible_media(tmp_path):
    folder = tmp_path / "set"
    folder.mkdir()
    _image(folder, "one.png")
    _image(folder, "two.png")
    ensure_training_setup(folder, "minimax_h3", "poc", selected_media=["one.png"])
    dataset = folder / "dataset.h3.poc.toml"
    one_item_text = dataset.read_text(encoding="utf-8")

    ensure_training_setup(
        folder,
        "minimax_h3",
        "poc",
        selected_media=["one.png", "two.png"],
        reset_file=dataset.name,
    )
    assert dataset.read_text(encoding="utf-8") != one_item_text


def test_bundle_captures_exact_selection_captions_and_only_rewrites_runtime_paths(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    group = tmp_path / "output" / "runs" / "001-set"
    folder.mkdir(parents=True)
    group.mkdir(parents=True)
    _image(folder, "one.png", caption="latest saved caption")
    _image(folder, "two.png", caption=None)
    _image(folder, "excluded.png", caption="not captured")
    ensure_training_setup(folder, "minimax_h3", "normal", selected_media=["one.png", "two.png"])
    config = folder / "config.h3.normal.toml"
    dataset = folder / "dataset.h3.normal.toml"
    config_text = (
        'output_dir = "/old/output" # runtime\n'
        'dataset = "dataset.h3.normal.toml" # runtime\n'
        'epochs = 9\nlearning_rate = 1.234e-5\n'
        '[model]\ntype = "minimax_h3"\ncustom_value = "preserve me"\n'
    )
    dataset_text = (
        'resolutions = [[512, 512]]\nenable_ar_bucket = true\n'
        '[[directory]]\npath = "__WEBCAP_DATASET_ROOT__/square_img" # runtime\n'
        'num_repeats = 4\ncustom_value = "preserve me"\n'
    )
    config.write_text(config_text, encoding="utf-8")
    dataset.write_text(dataset_text, encoding="utf-8")
    monkeypatch.setattr(training_bundle, "to_wsl_path", _fake_wsl)

    bundle = materialize_training_bundle(
        folder,
        group,
        "minimax_h3",
        "normal",
        "h3",
        ["one.png", "two.png"],
        fallback_captions={"two.png": "primer fallback"},
        output_dirs={"h3": "/runs/h3"},
    )

    assert bundle["capturedItemCount"] == 2
    assert (bundle["path"] / "media" / "square_img" / "one.png").is_file()
    assert not (bundle["path"] / "media" / "square_img" / "excluded.png").exists()
    assert (bundle["path"] / "media" / "square_img" / "one.txt").read_text(encoding="utf-8") == "latest saved caption."
    assert (bundle["path"] / "media" / "square_img" / "two.txt").read_text(encoding="utf-8") == "primer fallback."

    captured_config = bundle["artifacts"]["h3Config"].read_text(encoding="utf-8")
    assert 'output_dir = "/runs/h3" # runtime' in captured_config
    assert "learning_rate = 1.234e-5" in captured_config
    assert 'custom_value = "preserve me"' in captured_config
    assert str(bundle["artifacts"]["h3Dataset"]) not in captured_config
    assert _fake_wsl(bundle["artifacts"]["h3Dataset"]) in captured_config

    captured_dataset = bundle["artifacts"]["h3Dataset"].read_text(encoding="utf-8")
    assert "num_repeats = 4" in captured_dataset
    assert 'custom_value = "preserve me"' in captured_dataset
    assert "__WEBCAP_DATASET_ROOT__" not in captured_dataset
    assert "auto_dataset" not in captured_dataset


def test_wan_stages_share_one_bundle_and_repeated_actions_are_distinct(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    group = tmp_path / "output" / "runs" / "001-set"
    folder.mkdir(parents=True)
    group.mkdir(parents=True)
    _image(folder, "one.png")
    ensure_training_setup(folder, "wan22_t2v", "normal", selected_media=["one.png"])
    monkeypatch.setattr(training_bundle, "to_wsl_path", _fake_wsl)

    first = materialize_training_bundle(
        folder, group, "wan22_t2v", "normal", "both", ["one.png"],
        output_dirs={"hi": "/runs/hi", "lo": "/runs/lo"},
    )
    second = materialize_training_bundle(
        folder, group, "wan22_t2v", "normal", "both", ["one.png"],
        output_dirs={"hi": "/runs/hi", "lo": "/runs/lo"},
    )

    assert first["artifacts"]["hiConfig"].parent == first["artifacts"]["loConfig"].parent
    assert first["path"] != second["path"]
    assert first["path"].parent == group / ".webcap" / "datasets"


def test_missing_managed_bundle_fails_loudly(tmp_path):
    from tool.server import training_runner

    with pytest.raises(FileNotFoundError, match="Captured training files are missing"):
        training_runner._bundle_from_path(tmp_path / "missing", "minimax_h3", "normal", "h3")
