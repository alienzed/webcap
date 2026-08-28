from pathlib import Path

import json

from PIL import Image
import pytest

import tool.server.app as app_module
import tool.server.config as config_module
import tool.server.run_ops as run_ops_module
from tool.server.dataset_config import (
    H3_VIDEO_MODE_CEILINGS,
    H3_VIDEO_MFP_LIMIT,
    choose_video_detail_bucket,
    coerce_frames,
    choose_image_resolution_classes,
    generate_candidates,
    generate_image_candidates,
    generate_dataset_configs,
    h3_calibration_bucket_comment,
    h3_video_mode_ceilings,
    image_alternatives,
    assign_images_to_resolution_classes,
    normalize_training_generate_mode,
    pick_image_buckets,
    read_epochs_from_training_config,
    repeat_targets_for_mode,
    video_alternatives,
    video_resolution_cap,
    mfp,
)
from tool.server.training_profiles import KREA2_PROFILE_ID, MINIMAX_H3_PROFILE_ID, WAN21_PROFILE_ID, WAN22_PROFILE_ID


def write_image(path: Path, size):
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", size, color=(120, 80, 200))
    img.save(path)


def test_generate_dataset_configs_copies_video_and_replaces_images(tmp_path):
    set_folder = tmp_path / "set"
    auto_dataset = set_folder / "auto_dataset"
    square = auto_dataset / "square"
    square_img = auto_dataset / "square_img"
    square.mkdir(parents=True)
    square_img.mkdir(parents=True)

    (square / "clip.mp4").write_bytes(b"video")
    (square / "clip.txt").write_text("video caption", encoding="utf-8")

    write_image(square_img / "high_a.png", (768, 768))
    write_image(square_img / "high_b.png", (768, 768))
    write_image(square_img / "mid_a.png", (512, 512))
    write_image(square_img / "mid_b.png", (512, 512))
    write_image(square_img / "low.png", (256, 256))
    (square_img / "high_a.txt").write_text("high a", encoding="utf-8")
    (square_img / "high_b.txt").write_text("high b", encoding="utf-8")
    (square_img / "mid_a.txt").write_text("mid a", encoding="utf-8")
    (square_img / "mid_b.txt").write_text("mid b", encoding="utf-8")
    (square_img / "low.txt").write_text("low", encoding="utf-8")

    (auto_dataset / "prep_manifest.json").write_text(
        """
{
  "version": 1,
  "target_fps": 16,
  "videos": [
    {
      "file": "clip.mp4",
      "ar": "square",
      "width": 512,
      "height": 512,
      "fps": 16,
      "frames": 33,
      "duration": 2.0625,
      "prepared_path": "square/clip.mp4",
      "caption": true,
      "action": "copied"
    }
  ],
  "images": [
    {"file": "high_a.png", "ar": "square", "width": 768, "height": 768, "prepared_path": "square_img/high_a.png", "caption": true},
    {"file": "high_b.png", "ar": "square", "width": 768, "height": 768, "prepared_path": "square_img/high_b.png", "caption": true},
    {"file": "mid_a.png", "ar": "square", "width": 512, "height": 512, "prepared_path": "square_img/mid_a.png", "caption": true},
    {"file": "mid_b.png", "ar": "square", "width": 512, "height": 512, "prepared_path": "square_img/mid_b.png", "caption": true},
    {"file": "low.png", "ar": "square", "width": 256, "height": 256, "prepared_path": "square_img/low.png", "caption": true}
  ],
  "skipped": [],
  "selection": {
    "mode": "all",
    "selected_files": ["clip.mp4", "high_a.png", "high_b.png", "mid_a.png", "mid_b.png", "low.png"],
    "selected_count": 6,
    "total_count": 6,
    "criteria": {"source_folder": "set"}
  }
}
        """.strip(),
        encoding="utf-8",
    )

    report = generate_dataset_configs(set_folder, mode="normal")

    hi_text = (set_folder / "dataset.hi.toml").read_text(encoding="utf-8")
    lo_text = (set_folder / "dataset.lo.toml").read_text(encoding="utf-8")

    assert hi_text != lo_text
    assert 'group = "videos"' in hi_text
    assert "  [512, 512, 33]," in hi_text
    assert hi_text.count('group = "images"') == 1
    assert "  [288, 288, 1]," in hi_text
    assert "  [480, 480, 1]," in hi_text
    assert "  [288, 288, 1]," in lo_text
    assert "  [512, 512, 1]," in lo_text
    assert "  [768, 768, 1]," not in hi_text
    assert "num_repeats = 17" in hi_text
    assert "num_repeats = 38" in lo_text
    assert "[INFO] Built 1 video directory block(s)." in report
    assert "[INFO] Training generate mode: normal" in report
    assert "[INFO] square_img: selected HI image bucket(s): 288x288, 480x480" in report
    assert "[INFO] square_img: selected LO image bucket(s): 288x288, 512x512" in report
    assert "[INFO] Repeat targeting HI: target=5000" in report
    assert "[INFO] Repeat targeting LO: target=20000" in report
    assert (auto_dataset / "webcap_dataset_metadata.json").exists()
    training_plan = json.loads((auto_dataset / "training_plan.json").read_text(encoding="utf-8"))
    assert training_plan["stages"]["hi"]["estimatedSteps"] > 0
    assert training_plan["stages"]["lo"]["estimatedSteps"] > 0

    krea_report = generate_dataset_configs(set_folder, mode="normal", profile_id=KREA2_PROFILE_ID)
    krea_text = (set_folder / "dataset.train.toml").read_text(encoding="utf-8")
    assert 'group = "videos"' not in krea_text
    assert 'group = "images"' in krea_text
    assert "Krea2 Raw: excluded 1 prepared video(s)." in krea_report
    krea_plan = json.loads((auto_dataset / "training_plan.json").read_text(encoding="utf-8"))
    assert krea_plan["stages"]["krea2"]["estimatedSteps"] > 0


def test_generate_dataset_configs_fails_without_prep_manifest(tmp_path):
    set_folder = tmp_path / "set"
    (set_folder / "auto_dataset").mkdir(parents=True)

    try:
        generate_dataset_configs(set_folder)
    except FileNotFoundError as exc:
        assert "prep_manifest.json" in str(exc)
    else:
        raise AssertionError("generate_dataset_configs should fail without prep_manifest.json")


def _write_h3_video_manifest(set_folder, frames, include_image=False, fps=24, duration=None, ar="square", size=(768, 768)):
    auto_dataset = set_folder / "auto_dataset"
    video_dir = auto_dataset / ar
    video_dir.mkdir(parents=True)
    (video_dir / "clip.mp4").write_bytes(b"video")
    video = {
        "file": "clip.mp4", "ar": ar, "width": size[0], "height": size[1],
        "fps": fps, "frames": frames, "prepared_path": ar + "/clip.mp4", "caption": True,
    }
    if duration is not None:
        video["duration"] = duration
    videos = [video]
    images = []
    selected = ["clip.mp4"]
    if include_image:
        image_dir = auto_dataset / "square_img"
        write_image(image_dir / "still.png", (768, 768))
        images.append({
            "file": "still.png", "ar": "square", "width": 768, "height": 768,
            "prepared_path": "square_img/still.png", "caption": True,
        })
        selected.append("still.png")
    (auto_dataset / "prep_manifest.json").write_text(json.dumps({
        "version": 1,
        "videos": videos,
        "images": images,
        "skipped": [],
        "selection": {
            "mode": "all", "selected_files": selected, "selected_count": len(selected),
            "total_count": len(selected), "criteria": {"source_folder": "set"},
        },
    }), encoding="utf-8")


def test_h3_dataset_uses_its_frame_grid_for_mixed_media_and_poc(tmp_path):
    set_folder = tmp_path / "set"
    _write_h3_video_manifest(set_folder, 136, include_image=True)
    (set_folder / "config.h3.toml").write_text("epochs = 100\n", encoding="utf-8")

    report = generate_dataset_configs(set_folder, mode="normal", profile_id=MINIMAX_H3_PROFILE_ID)
    text = (set_folder / "dataset.train.toml").read_text(encoding="utf-8")

    assert "[352, 352, 68]" in text
    assert "[512, 512, 34]" in text
    assert "[512, 512, 1]" in text
    assert all(f", {frames}]" not in text for frames in (13, 17, 136))
    assert "# Calibrated long-motion alternative: [352, 352, 102]" in text
    assert "\n  [352, 352, 102]," not in text
    assert text.count('group = "videos"') == 2
    video_blocks = [block for block in text.split("[[directory]]") if 'group = "videos"' in block]
    video_repeats = [int(block.split("num_repeats = ", 1)[1].splitlines()[0]) for block in video_blocks]
    assert video_repeats[0] == video_repeats[1] * 2
    assert "MiniMax H3 temporal bucket 352x352 @ 68" in report
    assert "MiniMax H3 hybrid bucket 512x512 @ 34" in report
    plan = json.loads((set_folder / "auto_dataset" / "training_plan.json").read_text(encoding="utf-8"))
    assert set(plan["stages"]) == {"h3"}
    assert plan["stages"]["h3"]["estimatedSteps"] > 0

    generate_dataset_configs(set_folder, mode="poc", profile_id=MINIMAX_H3_PROFILE_ID)
    poc_text = (set_folder / "dataset.train.toml").read_text(encoding="utf-8")
    assert "[384, 384, 34]" in poc_text
    assert ", 68]" not in poc_text


def test_h3_dataset_rejects_a_video_only_set_with_no_34_frame_clip(tmp_path):
    set_folder = tmp_path / "set"
    _write_h3_video_manifest(set_folder, 33)

    try:
        generate_dataset_configs(set_folder, mode="normal", profile_id=MINIMAX_H3_PROFILE_ID)
    except ValueError as exc:
        assert "at least 17 frames" in str(exc)
    else:
        raise AssertionError("MiniMax H3 generation should reject a set with no usable media.")


def test_h3_dataset_warns_when_a_short_clip_is_excluded_from_a_usable_set(tmp_path):
    set_folder = tmp_path / "set"
    _write_h3_video_manifest(set_folder, 33, include_image=True)

    report = generate_dataset_configs(set_folder, mode="normal", profile_id=MINIMAX_H3_PROFILE_ID)
    text = (set_folder / "dataset.train.toml").read_text(encoding="utf-8")

    assert "spatial tier omitted; requires 3 native clips" in report
    assert 'group = "videos"' not in text
    assert ", 1]" in text


def test_h3_dataset_accepts_an_image_only_set(tmp_path):
    set_folder = tmp_path / "set"
    auto_dataset = set_folder / "auto_dataset"
    image_dir = auto_dataset / "square_img"
    write_image(image_dir / "still.png", (1024, 1024))
    (auto_dataset / "prep_manifest.json").write_text(json.dumps({
        "version": 1,
        "videos": [],
        "images": [{
            "file": "still.png", "ar": "square", "width": 1024, "height": 1024,
            "prepared_path": "square_img/still.png", "caption": True,
        }],
        "skipped": [],
        "selection": {
            "mode": "all", "selected_files": ["still.png"], "selected_count": 1,
            "total_count": 1, "criteria": {},
        },
    }), encoding="utf-8")

    generate_dataset_configs(set_folder, mode="quality", profile_id=MINIMAX_H3_PROFILE_ID)
    text = (set_folder / "dataset.train.toml").read_text(encoding="utf-8")

    assert ", 1]" in text
    assert 'group = "videos"' not in text


def test_h3_quality_video_uses_the_normal_safe_bucket_table(tmp_path):
    set_folder = tmp_path / "set"
    _write_h3_video_manifest(set_folder, 136)

    generate_dataset_configs(set_folder, mode="quality", profile_id=MINIMAX_H3_PROFILE_ID)
    text = (set_folder / "dataset.train.toml").read_text(encoding="utf-8")

    assert "[352, 352, 68]" in text
    assert "[512, 512, 34]" in text
    assert all(f", {frames}]" not in text for frames in (13, 17, 136))
    assert "# Calibrated long-motion alternative: [352, 352, 102]" in text
    assert "\n  [352, 352, 102]," not in text


def test_h3_normal_adds_spatial_tier_for_three_native_high_resolution_clips(tmp_path):
    set_folder = tmp_path / "set"
    auto_dataset = set_folder / "auto_dataset"
    video_dir = auto_dataset / "square"
    video_dir.mkdir(parents=True)
    videos = []
    for index in range(3):
        name = f"clip_{index}.mp4"
        (video_dir / name).write_bytes(b"video")
        videos.append({
            "file": name, "ar": "square", "width": 1024, "height": 1024,
            "fps": 24, "frames": 136, "prepared_path": "square/" + name, "caption": True,
        })
    (auto_dataset / "prep_manifest.json").write_text(json.dumps({
        "version": 1, "videos": videos, "images": [], "skipped": [],
        "selection": {"mode": "all", "selected_files": [row["file"] for row in videos], "selected_count": 3, "total_count": 3, "criteria": {}},
    }), encoding="utf-8")
    (set_folder / "config.h3.normal.toml").write_text("epochs = 100\n", encoding="utf-8")

    report = generate_dataset_configs(set_folder, mode="normal", profile_id=MINIMAX_H3_PROFILE_ID)
    text = (set_folder / "dataset.train.toml").read_text(encoding="utf-8")

    assert "[352, 352, 68]" in text
    assert "[512, 512, 34]" in text
    assert "[768, 768, 17]" in text
    assert text.count('group = "videos"') == 3
    video_blocks = [block for block in text.split("[[directory]]") if 'group = "videos"' in block]
    repeats = [int(block.split("num_repeats = ", 1)[1].splitlines()[0]) for block in video_blocks]
    assert repeats == [40, 20, 10]
    assert "MiniMax H3 spatial bucket 768x768 @ 17" in report


def test_h3_allows_three_short_native_spatial_clips_without_hybrid_or_temporal(tmp_path):
    set_folder = tmp_path / "set"
    auto_dataset = set_folder / "auto_dataset"
    video_dir = auto_dataset / "square"
    video_dir.mkdir(parents=True)
    videos = []
    for index in range(3):
        name = f"clip_{index}.mp4"
        (video_dir / name).write_bytes(b"video")
        videos.append({
            "file": name, "ar": "square", "width": 768, "height": 768,
            "fps": 24, "frames": 20, "prepared_path": "square/" + name, "caption": True,
        })
    (auto_dataset / "prep_manifest.json").write_text(json.dumps({
        "version": 1, "videos": videos, "images": [], "skipped": [],
        "selection": {"mode": "all", "selected_files": [row["file"] for row in videos], "selected_count": 3, "total_count": 3, "criteria": {}},
    }), encoding="utf-8")

    report = generate_dataset_configs(set_folder, mode="quality", profile_id=MINIMAX_H3_PROFILE_ID)
    text = (set_folder / "dataset.train.toml").read_text(encoding="utf-8")

    assert text.count('group = "videos"') == 1
    assert "[768, 768, 17]" in text
    assert ", 34]" not in text
    assert ", 68]" not in text
    assert "spatial bucket 768x768 @ 17" in report


def test_h3_initial_mode_ceilings_stay_inside_the_conservative_cell_limit():
    frames_by_role = {"temporal": 68, "hybrid": 34, "spatial": 17}
    for by_aspect in H3_VIDEO_MODE_CEILINGS.values():
        for ceilings in by_aspect.values():
            for role, (width, height) in ceilings.items():
                assert mfp(width, height, frames_by_role[role]) <= H3_VIDEO_MFP_LIMIT


def test_video_alternatives_include_manual_choices_above_automatic_ceiling():
    assert (512, 288, 68) in video_alternatives(448, 256, 68)


def test_h3_calibration_overrides_quality_only_and_derives_portrait(monkeypatch):
    monkeypatch.setattr(config_module, "config", {
        "training": {
            "h3_calibration": {
                "version": 1,
                "campaign": "h3-calibrated",
                "safe_shapes": {
                    "34": {"169": [896, 512]},
                    "68": {"169": [576, 320]},
                },
            },
        },
    })
    normal, _campaign = h3_video_mode_ceilings("normal")
    quality, campaign = h3_video_mode_ceilings("quality")
    poc, poc_campaign = h3_video_mode_ceilings("poc")

    assert campaign == "h3-calibrated"
    assert (poc, poc_campaign) == ({}, "")
    assert normal["169"]["hybrid"] == (800, 448)
    assert quality["169"]["hybrid"] == (896, 512)
    assert quality["916"]["hybrid"] == (512, 896)
    assert quality["169"]["temporal"] == (576, 320)
    assert quality["square"]["hybrid"] == H3_VIDEO_MODE_CEILINGS["quality"]["square"]["hybrid"]


def test_h3_calibration_comment_distinguishes_cap_from_source_limit(monkeypatch):
    monkeypatch.setattr(config_module, "config", {
        "training": {"h3_calibration": {"campaign": "h3-test", "safe_shapes": {"68": {"square": [416, 416]}}}}
    })
    at_cap = h3_calibration_bucket_comment(
        "quality", "h3-test", "square", "temporal",
        {"width": 416, "height": 416, "support": 4, "total": 4}, (416, 416),
    )
    source_limited = h3_calibration_bucket_comment(
        "quality", "h3-test", "square", "temporal",
        {"width": 384, "height": 384, "support": 3, "total": 4}, (416, 416),
    )
    assert "at calibrated cap 416x416" in at_cap
    assert "avoid other GPU-heavy" in at_cap
    assert "Source-limited" in source_limited
    assert "3/4 supporting clips" in source_limited


def test_h3_calibration_comment_uses_explicit_shape_even_when_it_matches_default(monkeypatch):
    monkeypatch.setattr(config_module, "config", {
        "training": {"h3_calibration": {"campaign": "h3-test", "safe_shapes": {"68": {"square": [352, 352]}}}}
    })
    assert "at calibrated cap 352x352" in h3_calibration_bucket_comment(
        "quality", "h3-test", "square", "temporal",
        {"width": 352, "height": 352, "support": 4, "total": 4}, (352, 352),
    )
    assert not h3_calibration_bucket_comment(
        "quality", "h3-test", "169", "temporal",
        {"width": 448, "height": 256, "support": 4, "total": 4}, (448, 256),
    )


def test_h3_calibration_comment_derives_portrait_and_skips_poc(monkeypatch):
    monkeypatch.setattr(config_module, "config", {
        "training": {"h3_calibration": {"campaign": "h3-test", "safe_shapes": {"34": {"43": [640, 480]}}}}
    })
    selected = {"width": 480, "height": 640, "support": 2, "total": 2}
    assert "at calibrated cap 480x640" in h3_calibration_bucket_comment(
        "quality", "h3-test", "34", "hybrid", selected, (480, 640),
    )
    assert not h3_calibration_bucket_comment("poc", "h3-test", "34", "hybrid", selected, (480, 640))


def test_h3_calibration_rejects_a_malformed_explicit_shape(monkeypatch):
    monkeypatch.setattr(config_module, "config", {
        "training": {"h3_calibration": {"campaign": "h3-test", "safe_shapes": {"68": {"square": [352]}}}}
    })
    with pytest.raises(ValueError, match="two-item positive-integer"):
        h3_video_mode_ceilings("quality")


def test_h3_long_motion_suggestion_keeps_its_102f_ceiling_when_quality_68f_is_larger(tmp_path, monkeypatch):
    monkeypatch.setattr(config_module, "config", {
        "training": {
            "h3_calibration": {
                "version": 1,
                "campaign": "h3-calibrated",
                "safe_shapes": {"68": {"169": [576, 320]}},
            },
        },
    })
    set_folder = tmp_path / "set"
    _write_h3_video_manifest(set_folder, 136, ar="169", size=(1024, 576))

    generate_dataset_configs(set_folder, mode="quality", profile_id=MINIMAX_H3_PROFILE_ID)
    text = (set_folder / "dataset.train.toml").read_text(encoding="utf-8")

    assert "  [576, 320, 68]," in text
    assert "# Calibrated long-motion alternative: [448, 256, 102]" in text
    assert "[576, 320, 102]" not in text


def test_model_native_frame_estimates_prefer_duration_then_source_rate_then_raw_frames():
    assert coerce_frames({"duration": 3.0, "fps": 16, "frames": 48}, 24) == 72
    assert coerce_frames({"fps": 16, "frames": 48}, 24) == 72
    assert coerce_frames({"frames": 48}, 24) == 48
    assert coerce_frames({"duration": 3.0, "fps": 60, "frames": 180}, 16) == 48
    assert coerce_frames({"duration": 33.99 / 24, "fps": 60, "frames": 85}, 24) == 33


def test_h3_bucket_timing_uses_24fps_for_legacy_and_high_fps_sources(tmp_path):
    legacy_folder = tmp_path / "legacy"
    _write_h3_video_manifest(legacy_folder, 48, fps=16, duration=3.0)
    generate_dataset_configs(legacy_folder, mode="normal", profile_id=MINIMAX_H3_PROFILE_ID)
    legacy_text = (legacy_folder / "dataset.train.toml").read_text(encoding="utf-8")
    assert ", 68]" in legacy_text
    assert ", 34]" in legacy_text
    assert all(f", {frames}]" not in legacy_text for frames in (17, 102, 136))

    high_fps_folder = tmp_path / "high_fps"
    _write_h3_video_manifest(high_fps_folder, 120, fps=60, duration=2.0)
    generate_dataset_configs(high_fps_folder, mode="normal", profile_id=MINIMAX_H3_PROFILE_ID)
    high_fps_text = (high_fps_folder / "dataset.train.toml").read_text(encoding="utf-8")
    assert ", 34]" in high_fps_text
    assert all(f", {frames}]" not in high_fps_text for frames in (17, 68, 102, 136))


def test_h3_safe_video_bucket_table_covers_every_aspect_ratio(tmp_path):
    expected = {
        "square": ((352, 352, 68), (512, 512, 34)),
        "43": ((416, 320, 68), (608, 448, 34)),
        "34": ((320, 416, 68), (448, 608, 34)),
        "169": ((448, 256, 68), (800, 448, 34)),
        "916": ((256, 448, 68), (448, 800, 34)),
    }
    for ar, buckets in expected.items():
        set_folder = tmp_path / ar
        _write_h3_video_manifest(set_folder, 136, ar=ar, size=(1024, 1024))

        generate_dataset_configs(set_folder, mode="normal", profile_id=MINIMAX_H3_PROFILE_ID)
        text = (set_folder / "dataset.train.toml").read_text(encoding="utf-8")

        for width, height, frames in buckets:
            assert f"[{width}, {height}, {frames}]" in text
            assert (width // 32) * (height // 32) * frames <= 11_900
        temporal_width, temporal_height, _frames = buckets[0]
        assert f"# Calibrated long-motion alternative: [{temporal_width}, {temporal_height}, 102]" in text
        assert f"\n  [{temporal_width}, {temporal_height}, 102]," not in text
        assert all(f", {frames}]" not in text for frames in (17, 136))


def test_h3_bucket_selection_tolerates_small_upscale_and_falls_back_for_smaller_sources(tmp_path):
    tolerated = tmp_path / "tolerated"
    _write_h3_video_manifest(tolerated, 34, ar="169", size=(585, 334))
    generate_dataset_configs(tolerated, mode="normal", profile_id=MINIMAX_H3_PROFILE_ID)
    tolerated_text = (tolerated / "dataset.train.toml").read_text(encoding="utf-8")
    assert "[576, 320, 34]" in tolerated_text

    fallback = tmp_path / "fallback"
    _write_h3_video_manifest(fallback, 34, ar="169", size=(500, 280))
    generate_dataset_configs(fallback, mode="normal", profile_id=MINIMAX_H3_PROFILE_ID)
    fallback_text = (fallback / "dataset.train.toml").read_text(encoding="utf-8")
    assert "[448, 256, 34]" in fallback_text
    assert "\n  [576, 320, 34]" not in fallback_text


def test_generate_dataset_configs_splits_video_motion_and_detail_stanzas(tmp_path):
    set_folder = tmp_path / "set"
    auto_dataset = set_folder / "auto_dataset"
    ar_dir = auto_dataset / "169"
    ar_dir.mkdir(parents=True)

    (ar_dir / "clip_a.mp4").write_bytes(b"video-a")
    (ar_dir / "clip_b.mp4").write_bytes(b"video-b")
    (ar_dir / "clip_a.txt").write_text("clip a caption", encoding="utf-8")
    (ar_dir / "clip_b.txt").write_text("clip b caption", encoding="utf-8")

    (auto_dataset / "prep_manifest.json").write_text(
        """
{
  "version": 1,
  "target_fps": 16,
  "videos": [
    {
      "file": "clip_a.mp4",
      "ar": "169",
      "width": 1248,
      "height": 704,
      "fps": 16,
      "frames": 49,
      "duration": 3.0,
      "prepared_path": "169/clip_a.mp4",
      "caption": true,
      "action": "copied"
    },
    {
      "file": "clip_b.mp4",
      "ar": "169",
      "width": 1248,
      "height": 704,
      "fps": 16,
      "frames": 49,
      "duration": 3.0,
      "prepared_path": "169/clip_b.mp4",
      "caption": true,
      "action": "copied"
    }
  ],
  "images": [],
  "skipped": [],
  "selection": {
    "mode": "all",
    "selected_files": ["clip_a.mp4", "clip_b.mp4"],
    "selected_count": 2,
    "total_count": 2,
    "criteria": {"source_folder": "set"}
  }
}
        """.strip(),
        encoding="utf-8",
    )

    report = generate_dataset_configs(set_folder, mode="normal")
    hi_text = (set_folder / "dataset.hi.toml").read_text(encoding="utf-8")
    lo_text = (set_folder / "dataset.lo.toml").read_text(encoding="utf-8")

    assert hi_text.count('group = "videos"') == 2
    assert lo_text.count('group = "videos"') == 2
    assert "  [672, 384, 37]," in hi_text
    assert "  [736, 416, 13]," in hi_text
    assert "[800, 448, 13]" in hi_text
    assert "\n  [800, 448, 13]," not in hi_text
    assert "\n  [1184, 672, 13]," not in hi_text
    assert "num_repeats = 40" in hi_text
    assert "num_repeats = 10" in hi_text
    assert "num_repeats = 89" in lo_text
    assert "num_repeats = 23" in lo_text
    assert "[INFO] Built 2 video directory block(s)." in report
    assert "WAN normal video resolution cap 736x416" in report

    quality_report = generate_dataset_configs(set_folder, mode="quality")
    quality_text = (set_folder / "dataset.hi.toml").read_text(encoding="utf-8")

    assert "  [1024, 576, 13]," in quality_text
    assert "[1088, 608, 13]" in quality_text
    assert "\n  [1088, 608, 13]," not in quality_text
    assert "\n  [1184, 672, 13]," not in quality_text
    assert "detail bucket 1024x576 @ 13" in quality_report
    assert "WAN quality video resolution cap 1024x576" in quality_report


def test_removed_generate_dataset_config_route_is_not_available(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs_root"
    set_folder = fs_root / "set"
    auto_dataset = set_folder / "auto_dataset"
    square_img = auto_dataset / "square_img"
    square_img.mkdir(parents=True)

    def safe_join(rel_path):
        rel = str(rel_path or "").strip().replace("..", "").replace("\\", "/").replace("//", "/")
        if rel.startswith("/"):
            rel = rel[1:]
        return (fs_root / rel).resolve()

    monkeypatch.setattr(app_module, "safe_join_fs_root", safe_join)
    monkeypatch.setattr(app_module.app_config, "safe_join_fs_root", safe_join)
    monkeypatch.setattr(run_ops_module.app_config, "safe_join_fs_root", safe_join)
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", fs_root)

    (auto_dataset / "169").mkdir(parents=True, exist_ok=True)
    (auto_dataset / "169" / "clip.mp4").write_bytes(b"video")
    (auto_dataset / "169" / "clip.txt").write_text("video caption", encoding="utf-8")
    write_image(square_img / "img.png", (512, 512))
    (square_img / "img.txt").write_text("img caption", encoding="utf-8")
    (auto_dataset / "prep_manifest.json").write_text(
        """
{
  "version": 1,
  "target_fps": 16,
  "videos": [
    {
      "file": "clip.mp4",
      "ar": "169",
      "width": 640,
      "height": 352,
      "fps": 16,
      "frames": 33,
      "duration": 2.0,
      "prepared_path": "169/clip.mp4",
      "caption": true,
      "action": "copied"
    }
  ],
  "images": [
    {"file": "img.png", "ar": "square", "width": 512, "height": 512, "prepared_path": "square_img/img.png", "caption": true}
  ],
  "skipped": [],
  "selection": {
    "mode": "all",
    "selected_files": ["clip.mp4", "img.png"],
    "selected_count": 2,
    "total_count": 2,
    "criteria": {"source_folder": "set"}
  }
}
        """.strip(),
        encoding="utf-8",
    )

    client = app_module.app.test_client()
    response = client.post("/fs/generate_dataset_config", json={"folder": "set"})

    assert response.status_code == 404
    assert not (set_folder / "dataset.hi.toml").exists()


def test_choose_video_detail_bucket_respects_mfp_limit():
    clips = [
        {"width": 1248, "height": 704, "frames": 13},
        {"width": 1248, "height": 704, "frames": 13},
    ]

    detail = choose_video_detail_bucket("169", clips, 640, 352)

    assert detail is not None
    assert (detail["width"], detail["height"]) == (1184, 672)


def test_wan_video_resolution_caps_follow_mode_targets_without_capping_other_profiles():
    assert video_resolution_cap(WAN22_PROFILE_ID, "normal", "169") == (736, 416)
    assert video_resolution_cap(WAN21_PROFILE_ID, "quality", "916") == (576, 1024)
    assert video_resolution_cap("", "normal", "square") == (512, 512)
    assert video_resolution_cap(KREA2_PROFILE_ID, "normal", "169") is None


def test_rectangle_image_candidates_allow_long_edge_above_768():
    candidates_916 = generate_candidates("916")
    candidates_34 = generate_candidates("34")
    candidates_169 = generate_candidates("169")
    candidates_square = generate_candidates("square")

    assert candidates_916[0][:2] == (704, 1248)
    assert candidates_34[0][:2] == (768, 1024)
    assert candidates_169[0][:2] == (1248, 704)
    assert candidates_square[0][:2] == (768, 768)


def test_image_alternatives_include_three_lower_and_three_higher():
    assert image_alternatives("square", 768, 768) == [
        (736, 736),
        (704, 704),
        (672, 672),
        (800, 800),
        (832, 832),
        (864, 864),
    ]
    assert image_alternatives("916", 704, 1248) == [
        (672, 1184),
        (640, 1152),
        (608, 1088),
    ]


def test_selected_image_buckets_respect_image_mfp_limit():
    images = [
        ("portrait_a.png", 736, 1312),
        ("portrait_b.png", 736, 1312),
        ("portrait_c.png", 736, 1312),
    ]

    buckets, unsupported = pick_image_buckets("916", images, mode="normal")

    assert unsupported == []
    assert buckets == [(416, 736)]


def test_pick_image_buckets_prefers_full_coverage_then_detail():
    images_916 = [
        ("001.jpg", 609, 1082),
        ("002.jpg", 610, 1085),
        ("003.jpg", 612, 1088),
        ("004.jpg", 584, 1037),
        ("005.jpg", 505, 898),
        ("007.jpg", 583, 1037),
        ("008.jpg", 583, 1036),
        ("009.jpg", 615, 1094),
        ("011.jpg", 584, 1037),
        ("014.jpg", 616, 1094),
        ("016.jpg", 616, 1094),
        ("017.jpg", 552, 981),
        ("018.jpg", 614, 1091),
        ("020.jpg", 607, 1080),
    ]
    buckets_916, unsupported_916 = pick_image_buckets("916", images_916, mode="normal")
    assert unsupported_916 == []
    assert buckets_916 == [(416, 736)]

    images_square = [
        ("003c.jpg", 544, 544),
        ("006.jpg", 734, 734),
        ("010.jpg", 768, 768),
        ("012.jpg", 766, 766),
        ("013.jpg", 768, 768),
        ("015.jpg", 648, 648),
        ("019.jpg", 768, 768),
    ]
    buckets_square, unsupported_square = pick_image_buckets("square", images_square, mode="normal")
    assert unsupported_square == []
    assert buckets_square == [(512, 512)]

    buckets_square_poc, _ = pick_image_buckets("square", images_square, mode="poc")
    assert buckets_square_poc == [(384, 384)]


def test_image_resolution_classes_keep_a_healthy_high_minority_and_unique_membership():
    images = [
        *( (f"mid_{index}.png", 512, 512) for index in range(10) ),
        *( (f"high_{index}.png", 768, 768) for index in range(3) ),
        ("slight_upscale.png", 448, 448),
    ]

    classes, unsupported = choose_image_resolution_classes("square", images, mode="normal", noise_profile="lo")

    assert unsupported == []
    assert [item["bucket"] for item in classes] == [(512, 512), (768, 768)]
    assert [image[0] for image in classes[0]["images"]] == [
        *(f"mid_{index}.png" for index in range(10)),
        "slight_upscale.png",
    ]
    assert [image[0] for image in classes[1]["images"]] == [f"high_{index}.png" for index in range(3)]
    assert classes[0]["native_count"] == 10
    assert classes[0]["upscaled_count"] == 1


def test_image_resolution_classes_do_not_create_a_high_class_for_a_sparse_outlier():
    images = [
        *( (f"mid_{index}.png", 512, 512) for index in range(10) ),
        ("high.png", 768, 768),
    ]

    classes, unsupported = choose_image_resolution_classes("square", images, mode="normal", noise_profile="lo")

    assert unsupported == []
    assert [item["bucket"] for item in classes] == [(512, 512)]
    assert len(classes[0]["images"]) == 11


def test_image_assignment_never_promotes_the_known_916_upscale_regression():
    classes, unsupported = assign_images_to_resolution_classes(
        [("small.png", 438, 779)],
        [(352, 640), (576, 1024)],
    )

    assert unsupported == []
    assert [item["bucket"] for item in classes] == [(352, 640)]


def test_normalize_training_generate_mode_keeps_quality_mode():
    assert normalize_training_generate_mode("quality") == "quality"
    assert normalize_training_generate_mode("poc") == "poc"


def test_image_candidates_use_mode_caps():
    assert generate_image_candidates("169", mode="normal")[0][:2] == (1024, 576)
    assert generate_image_candidates("169", mode="poc")[0][:2] == (736, 416)
    assert generate_candidates("169")[0][:2] == (1248, 704)


def test_normal_and_quality_image_buckets_stay_separated():
    images = [
        ("a.png", 768, 768),
        ("b.png", 768, 768),
        ("c.png", 768, 768),
    ]

    normal_hi, unsupported_normal_hi = pick_image_buckets("square", images, mode="normal", noise_profile="hi")
    normal_lo, unsupported_normal_lo = pick_image_buckets("square", images, mode="normal", noise_profile="lo")
    quality_lo, unsupported_quality_lo = pick_image_buckets("square", images, mode="quality", noise_profile="lo")

    assert unsupported_normal_hi == []
    assert unsupported_normal_lo == []
    assert unsupported_quality_lo == []
    assert normal_hi == [(480, 480)]
    assert normal_lo == [(512, 512)]
    assert quality_lo == [(768, 768)]


def test_validate_config_payload_does_not_persist_a_global_training_mode():
    from tool.server.config import validate_config_payload

    normalized = validate_config_payload({
        "filesystem": {"root": "C:/sets", "models": ""},
        "training": {"mode": "poc"},
        "primer": {"template": "{subject}\n{view}"},
    })
    assert "mode" not in normalized["training"]
    assert normalized["primer"]["template"] == "{subject}\n{view}"

    normalized_quality = validate_config_payload({
        "filesystem": {"root": "C:/sets", "models": ""},
        "training": {"mode": "quality"},
    })
    assert "mode" not in normalized_quality["training"]


def test_poc_mode_never_emits_second_image_bucket():
    images = [
        ("high_a.png", 768, 768),
        ("high_b.png", 768, 768),
        ("low.png", 256, 256),
    ]
    buckets, unsupported = pick_image_buckets("square", images, mode="poc")
    assert unsupported == []
    assert buckets == [(288, 288)]


def test_repeat_targets_vary_by_mode():
    assert repeat_targets_for_mode("poc") == (5000, 20000)
    assert repeat_targets_for_mode("normal") == (5000, 20000)
    assert repeat_targets_for_mode("quality") == (5000, 20000)


def test_read_epochs_from_training_config_handles_non_utf8_bytes(tmp_path):
    config_path = tmp_path / "config.hi.toml"
    config_path.write_bytes(b"\xff\xfe\nepochs = 42\n")
    assert read_epochs_from_training_config(config_path, fallback=80) == 42
