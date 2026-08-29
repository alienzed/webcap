from pathlib import Path
import json
import subprocess
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


def _video_bundle_files(folder):
    (folder / "config.h3.normal.toml").write_text(
        'dataset = "dataset.h3.normal.toml"\noutput_dir = "/runs/old"\nepochs = 1\n[model]\ntype = "minimax_h3"\n',
        encoding="utf-8",
    )
    (folder / "dataset.h3.normal.toml").write_text(
        'enable_ar_bucket = true\n\n[[directory]]\n'
        'path = "__WEBCAP_DATASET_ROOT__/square"\n'
        'num_repeats = 1\ngroup = "videos"\nsize_buckets = [[352, 352, 68]]\n',
        encoding="utf-8",
    )


def _video_manifest(*names, fps=16):
    return {
        "version": 2,
        "target_fps": None,
        "images": [],
        "videos": [
            {
                "file": name,
                "ar": "square",
                "width": 512,
                "height": 512,
                "fps": fps,
                "frames": 80,
                "duration": 5.0,
                "prepared_path": "square/" + name,
            }
            for name in names
        ],
        "skipped": [],
        "selection": {"mode": "visible_subset", "selected_files": list(names)},
    }


@pytest.mark.parametrize(("target_fps", "source_fps"), [(24, 16), (16, 24)])
def test_bundle_video_transcodes_to_profile_fps_with_high_quality_audio(tmp_path, monkeypatch, target_fps, source_fps):
    source = tmp_path / "clip.mp4"
    destination = tmp_path / "bundle" / "clip.mp4"
    source.write_bytes(b"source-video")
    observed = {}

    def fake_run(command, **kwargs):
        observed["command"] = command
        observed["kwargs"] = kwargs
        Path(command[-1]).write_bytes(b"transcoded-video")
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(training_bundle.subprocess, "run", fake_run)

    capture = training_bundle._copy_or_convert_bundle_video(source, destination, target_fps, source_fps)

    assert capture == {"action": "transcoded"}
    assert source.read_bytes() == b"source-video"
    assert destination.read_bytes() == b"transcoded-video"
    assert observed["kwargs"] == {"check": True, "capture_output": True, "text": True}
    assert observed["command"] == [
        "ffmpeg", "-y", "-i", str(source),
        "-map", "0:v:0", "-map", "0:a?", "-map_metadata", "0",
        "-vf", f"fps={target_fps}:round=near,format=yuv420p",
        "-vsync", "cfr",
        "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-crf", "10", "-preset", "slow", "-c:a", "copy",
        str(destination.with_name("clip.webcap-transcoding.mp4")),
    ]


def test_bundle_video_at_target_fps_copies_without_ffmpeg(tmp_path, monkeypatch):
    source = tmp_path / "clip.mp4"
    destination = tmp_path / "bundle" / "clip.mp4"
    source.write_bytes(b"source-video")
    monkeypatch.setattr(
        training_bundle.subprocess,
        "run",
        lambda *args, **kwargs: pytest.fail("matching-FPS video should not invoke ffmpeg"),
    )

    capture = training_bundle._copy_or_convert_bundle_video(source, destination, 24, 24.05)

    assert capture == {"action": "copied"}
    assert destination.read_bytes() == source.read_bytes()


def test_bundle_video_unknown_fps_attempts_conversion_and_falls_back_to_copy(tmp_path, monkeypatch, capsys):
    source = tmp_path / "clip.mp4"
    destination = tmp_path / "bundle" / "clip.mp4"
    source.write_bytes(b"source-video")

    def missing_ffmpeg(*args, **kwargs):
        raise FileNotFoundError("ffmpeg")

    monkeypatch.setattr(training_bundle.subprocess, "run", missing_ffmpeg)

    capture = training_bundle._copy_or_convert_bundle_video(source, destination, 24, None)

    assert capture["action"] == "copied_fallback"
    assert destination.read_bytes() == source.read_bytes()
    assert "[WARN] Could not normalize video to 24 FPS: clip.mp4" in capsys.readouterr().out


def test_bundle_video_conversion_failure_falls_back_to_copy(tmp_path, monkeypatch, capsys):
    source = tmp_path / "clip.mp4"
    destination = tmp_path / "bundle" / "clip.mp4"
    source.write_bytes(b"source-video")

    def failed_conversion(*args, **kwargs):
        raise subprocess.CalledProcessError(1, ["ffmpeg"], stderr="unsupported output container")

    monkeypatch.setattr(training_bundle.subprocess, "run", failed_conversion)

    capture = training_bundle._copy_or_convert_bundle_video(source, destination, 24, 16)

    assert capture == {"action": "copied_fallback", "error": "unsupported output container"}
    assert destination.read_bytes() == source.read_bytes()
    assert "copying the source unchanged" in capsys.readouterr().out


def test_bundle_skips_video_only_after_conversion_and_copy_both_fail(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    group = tmp_path / "output" / "runs" / "001-set"
    folder.mkdir(parents=True)
    group.mkdir(parents=True)
    _video_bundle_files(folder)
    for name in ("good.mp4", "bad.mp4"):
        (folder / name).write_bytes(name.encode("ascii"))
        (folder / Path(name).with_suffix(".txt")).write_text("caption", encoding="utf-8")
    manifest = _video_manifest("good.mp4", "bad.mp4")
    monkeypatch.setattr(training_bundle, "build_dataset_manifest", lambda *args, **kwargs: manifest)
    monkeypatch.setattr(training_bundle, "to_wsl_path", _fake_wsl)

    def fake_capture(source, destination, target_fps, source_fps):
        del target_fps, source_fps
        if source.name == "bad.mp4":
            return {"action": None, "error": "copy failed"}
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(source.read_bytes())
        return {"action": "copied"}

    monkeypatch.setattr(training_bundle, "_copy_or_convert_bundle_video", fake_capture)

    bundle = materialize_training_bundle(
        folder, group, "minimax_h3", "normal", "h3", ["good.mp4", "bad.mp4"],
        output_dirs={"h3": "/runs/h3"},
    )

    assert bundle["capturedItemCount"] == 1
    assert [row["file"] for row in bundle["manifest"]["videos"]] == ["good.mp4"]
    assert bundle["manifest"]["skipped"] == [{
        "file": "bad.mp4", "reason": "bundle_video_capture_failed", "error": "copy failed",
    }]
    assert (bundle["path"] / "media" / "square" / "good.mp4").is_file()
    assert not (bundle["path"] / "media" / "square" / "bad.mp4").exists()
    captured_dataset = bundle["artifacts"]["h3Dataset"].read_text(encoding="utf-8")
    direct_dir = bundle["path"] / "media" / "square"
    assert _fake_wsl(direct_dir) in captured_dataset
    assert "size_buckets = [[352, 352, 68]]" in captured_dataset
    assert (direct_dir / "good.mp4").is_file()


def test_h3_bundle_materializes_only_marked_detail_subset(tmp_path, monkeypatch):
    media_root = tmp_path / "media"
    source_dir = media_root / "square"
    source_dir.mkdir(parents=True)
    rows = [
        ("long_high.mp4", 768, 768, 80),
        ("long_low.mp4", 320, 320, 80),
        ("short_high.mp4", 768, 768, 20),
    ]
    videos = []
    for name, width, height, frames in rows:
        (source_dir / name).write_bytes(name.encode("ascii"))
        (source_dir / Path(name).with_suffix(".txt")).write_text("caption", encoding="utf-8")
        videos.append({
            "file": name, "prepared_path": "square/" + name,
            "width": width, "height": height, "fps": 24,
            "frames": frames, "duration": frames / 24.0,
        })
    text = (
        '[[directory]]\npath = "__WEBCAP_DATASET_ROOT__/square"\nnum_repeats = 2\ngroup = "videos"\nsize_buckets = [[352, 352, 68]]\n\n'
        '[[directory]]\npath = "__WEBCAP_DATASET_ROOT__/square"\nnum_repeats = 1\ngroup = "videos"\n# webcap_detail_subset = true\nsize_buckets = [[768, 768, 17]]\n'
    )
    manifest = {"images": [], "videos": videos}
    monkeypatch.setattr(training_bundle, "to_wsl_path", _fake_wsl)

    rendered = training_bundle._materialize_dataset_config(
        text, media_root, "", manifest, "h3", profile_id="minimax_h3", mode="normal",
    )

    assert "size_buckets = [[352, 352, 68]]" in rendered
    assert "size_buckets = [[768, 768, 17]]" in rendered
    detail = media_root / "video_detail" / "square__768x768x17"
    assert {path.name for path in detail.glob("*.mp4")} == {"long_high.mp4", "short_high.mp4"}
    assignments = {row["file"]: row.get("videoDetailAssignments", {}).get("h3") for row in manifest["videos"]}
    assert assignments["long_high.mp4"] == {"bucket": [768, 768, 17], "directory": "video_detail/square__768x768x17"}
    assert assignments["long_low.mp4"] is None
    assert assignments["short_high.mp4"] == {"bucket": [768, 768, 17], "directory": "video_detail/square__768x768x17"}


def test_unmarked_manual_video_stanzas_remain_direct(tmp_path, monkeypatch):
    media_root = tmp_path / "media"
    source_dir = media_root / "square"
    source_dir.mkdir(parents=True)
    (source_dir / "clip.mp4").write_bytes(b"video")
    (source_dir / "clip.txt").write_text("caption", encoding="utf-8")
    text = (
        '[[directory]]\npath = "__WEBCAP_DATASET_ROOT__/square"\ngroup = "videos"\nsize_buckets = [[352, 352, 68]]\n\n'
        '[[directory]]\npath = "__WEBCAP_DATASET_ROOT__/square"\ngroup = "videos"\nsize_buckets = [[352, 352, 68]]\n'
    )
    manifest = {"images": [], "videos": [{
        "file": "clip.mp4", "prepared_path": "square/clip.mp4", "width": 512, "height": 512,
        "fps": 24, "frames": 80, "duration": 80 / 24.0,
    }]}
    monkeypatch.setattr(training_bundle, "to_wsl_path", _fake_wsl)

    rendered = training_bundle._materialize_dataset_config(
        text, media_root, "", manifest, "h3", profile_id="minimax_h3", mode="quality",
    )
    assert rendered.count(_fake_wsl(source_dir)) == 2


def test_empty_marked_detail_stanza_is_omitted_without_blocking_capture(tmp_path, monkeypatch):
    media_root = tmp_path / "media"
    source_dir = media_root / "square"
    source_dir.mkdir(parents=True)
    (source_dir / "clip.mp4").write_bytes(b"video")
    (source_dir / "clip.txt").write_text("caption", encoding="utf-8")
    text = (
        '[[directory]]\npath = "__WEBCAP_DATASET_ROOT__/square"\ngroup = "videos"\n# webcap_detail_subset = true\nsize_buckets = [[768, 768, 17]]\n'
    )
    manifest = {"images": [], "videos": [{
        "file": "clip.mp4", "prepared_path": "square/clip.mp4", "width": 320, "height": 320,
        "fps": 24, "frames": 10, "duration": 10 / 24.0,
    }]}
    monkeypatch.setattr(training_bundle, "to_wsl_path", _fake_wsl)

    rendered = training_bundle._materialize_dataset_config(
        text, media_root, "", manifest, "h3", profile_id="minimax_h3", mode="normal",
    )
    assert rendered.strip() == ""


def test_bundle_fails_when_video_capture_leaves_no_media(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    group = tmp_path / "output" / "runs" / "001-set"
    folder.mkdir(parents=True)
    group.mkdir(parents=True)
    _video_bundle_files(folder)
    (folder / "bad.mp4").write_bytes(b"video")
    (folder / "bad.txt").write_text("caption", encoding="utf-8")
    monkeypatch.setattr(training_bundle, "build_dataset_manifest", lambda *args, **kwargs: _video_manifest("bad.mp4"))
    monkeypatch.setattr(training_bundle, "_copy_or_convert_bundle_video", lambda *args, **kwargs: {"action": None, "error": "copy failed"})

    with pytest.raises(RuntimeError, match="No media could be captured"):
        materialize_training_bundle(
            folder, group, "minimax_h3", "normal", "h3", ["bad.mp4"],
            output_dirs={"h3": "/runs/h3"},
        )


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
        "config.h3.poc.toml": 8e-5,
        "config.h3.normal.toml": 6e-5,
        "config.h3.quality.toml": 4e-5,
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


def test_bundle_preserves_manual_image_buckets_as_direct_stanzas(tmp_path, monkeypatch, capsys):
    folder = tmp_path / "set"
    group = tmp_path / "output" / "runs" / "001-set"
    folder.mkdir(parents=True)
    group.mkdir(parents=True)
    _image(folder, "slight.png", size=(448, 448))
    _image(folder, "mid.png", size=(512, 512))
    _image(folder, "high.png", size=(768, 768))
    ensure_training_setup(folder, "minimax_h3", "normal", selected_media=["slight.png", "mid.png", "high.png"])
    dataset = folder / "dataset.h3.normal.toml"
    dataset.write_text(
        "[[directory]]\n"
        'path = "__WEBCAP_DATASET_ROOT__/square_img"\n'
        "num_repeats = 7\n"
        'group = "images"\n'
        'custom_value = "keep me"\n'
        "size_buckets = [[512, 512, 1], [768, 768, 1]]\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(training_bundle, "to_wsl_path", _fake_wsl)

    bundle = materialize_training_bundle(
        folder, group, "minimax_h3", "normal", "h3", ["slight.png", "mid.png", "high.png"],
        output_dirs={"h3": "/runs/h3"},
    )

    captured = bundle["artifacts"]["h3Dataset"].read_text(encoding="utf-8")
    assert "size_buckets = [[512, 512, 1], [768, 768, 1]]" in captured
    assert _fake_wsl(bundle["path"] / "media" / "square_img") in captured
    assert not (bundle["path"] / "media" / "image_classes").exists()
    assert "bucket 768x768x1 may upscale: mid.png, slight.png" in capsys.readouterr().out


def test_bundle_honors_unsafe_manual_image_resolution_without_blocking(tmp_path, monkeypatch, capsys):
    folder = tmp_path / "set"
    group = tmp_path / "output" / "runs" / "001-set"
    folder.mkdir(parents=True)
    group.mkdir(parents=True)
    _image(folder, "one.png", size=(512, 512))
    ensure_training_setup(folder, "krea2_raw", "normal", selected_media=["one.png"])
    dataset = folder / "dataset.krea2.normal.toml"
    dataset.write_text(
        "[[directory]]\n"
        'path = "__WEBCAP_DATASET_ROOT__/square_img"\n'
        'group = "images"\n'
        "size_buckets = [[544, 544, 1]]\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(training_bundle, "to_wsl_path", _fake_wsl)

    bundle = materialize_training_bundle(
        folder, group, "krea2_raw", "normal", "krea2", ["one.png"], output_dirs={"krea2": "/runs/krea2"},
    )
    captured = tomllib.loads(bundle["artifacts"]["krea2Dataset"].read_text(encoding="utf-8"))
    assert captured["directory"][0]["size_buckets"] == [[544, 544, 1]]

    dataset.write_text(
        "[[directory]]\n"
        'path = "__WEBCAP_DATASET_ROOT__/square_img"\n'
        'group = "images"\n'
        "size_buckets = [[640, 640, 1]]\n",
        encoding="utf-8",
    )
    bundle = materialize_training_bundle(
        folder, group, "krea2_raw", "normal", "krea2", ["one.png"], output_dirs={"krea2": "/runs/krea2"},
    )
    captured = tomllib.loads(bundle["artifacts"]["krea2Dataset"].read_text(encoding="utf-8"))
    assert captured["directory"][0]["size_buckets"] == [[640, 640, 1]]
    assert "may upscale: one.png" in capsys.readouterr().out


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
