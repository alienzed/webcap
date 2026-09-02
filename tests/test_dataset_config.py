from pathlib import Path

import json
import tomllib

from PIL import Image
import pytest

import tool.server.app as app_module
import tool.server.dataset_config as dataset_config_module
import tool.server.run_ops as run_ops_module
from tool.server.dataset_config import (
    H3_VIDEO_MODE_CEILINGS,
    H3_VIDEO_MFP_LIMIT,
    build_video_blocks,
    coerce_frames,
    choose_image_bucket,
    choose_image_resolution_classes,
    generate_candidates,
    generate_image_candidates,
    generate_dataset_configs,
    normalize_training_generate_mode,
    read_epochs_from_training_config,
    repeat_targets_for_mode,
    video_bucket_ladder,
    video_role_ceiling,
    mfp,
)
from tool.server.training_profiles import KREA2_PROFILE_ID, MINIMAX_H3_PROFILE_ID


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
    assert "  [512, 512, 13]," in hi_text
    assert hi_text.count('group = "images"') == 1
    assert "  [288, 288, 1]," in hi_text
    assert "  [288, 288, 1]," in hi_text
    assert "  [288, 288, 1]," in lo_text
    assert "  [288, 288, 1]," in lo_text
    assert "  [768, 768, 1]," not in hi_text
    assert "num_repeats =" in hi_text
    assert "num_repeats =" in lo_text
    assert "[INFO] Built 1 video directory block(s)." in report
    assert "[INFO] Training generate mode: normal" in report
    assert "[INFO] square_img: selected HI image bucket: 288x288" in report
    assert "[INFO] square_img: selected LO image bucket: 288x288" in report
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


def test_h3_uses_balanced_temporal_and_detail_roles_then_one_poc_role(tmp_path):
    set_folder = tmp_path / "set"
    _write_h3_video_manifest(set_folder, 136, include_image=True)
    (set_folder / "config.h3.toml").write_text("epochs = 100\n", encoding="utf-8")

    report = generate_dataset_configs(set_folder, mode="normal", profile_id=MINIMAX_H3_PROFILE_ID)
    text = (set_folder / "dataset.train.toml").read_text(encoding="utf-8")

    assert "[320, 320, 68]" in text
    assert "[544, 544, 34]" in text
    assert "[704, 704, 17]" in text
    assert "[512, 512, 1]" in text
    assert all(f", {frames}]" not in text for frames in (13, 136))
    assert text.count('group = "videos"') == 3
    assert '# webcap_dataset_role = balanced' in text
    assert '# webcap_dataset_role = temporal' in text
    assert '# webcap_dataset_role = detail' in text
    video_blocks = [block for block in text.split("[[directory]]") if 'group = "videos"' in block]
    video_repeats = [int(block.split("num_repeats = ", 1)[1].splitlines()[0]) for block in video_blocks]
    assert video_repeats[0] >= 1
    assert "square: temporal 320x320 @ 68" in report
    assert "square: balanced 544x544 @ 34" in report
    assert "square: detail 704x704 @ 17" in report
    plan = json.loads((set_folder / "auto_dataset" / "training_plan.json").read_text(encoding="utf-8"))
    assert set(plan["stages"]) == {"h3"}
    assert plan["stages"]["h3"]["estimatedSteps"] > 0

    generate_dataset_configs(set_folder, mode="poc", profile_id=MINIMAX_H3_PROFILE_ID)
    poc_text = (set_folder / "dataset.train.toml").read_text(encoding="utf-8")
    assert "[384, 384, 34]" in poc_text
    assert ", 68]" not in poc_text

def test_h3_dataset_warns_when_a_short_clip_is_excluded_from_a_usable_set(tmp_path):
    set_folder = tmp_path / "set"
    _write_h3_video_manifest(set_folder, 33, include_image=True)

    report = generate_dataset_configs(set_folder, mode="normal", profile_id=MINIMAX_H3_PROFILE_ID)
    text = (set_folder / "dataset.train.toml").read_text(encoding="utf-8")

    assert "square: detail 704x704 @ 17" in report
    assert 'group = "videos"' in text
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


def test_h3_role_ceilings_stay_inside_the_conservative_cell_limit():
    frames_by_role = {"balanced": 34, "temporal": 68, "detail": 17}
    for by_aspect in H3_VIDEO_MODE_CEILINGS.values():
        for ceilings in by_aspect.values():
            for role, (width, height) in ceilings.items():
                assert mfp(width, height, frames_by_role[role]) <= H3_VIDEO_MFP_LIMIT


def test_h3_balanced_role_uses_conservative_ladder_without_calibration(monkeypatch):
    monkeypatch.setattr(dataset_config_module.app_config, "config", {"training": {}})

    for ar_label, ceiling, default in (
        ("square", (576, 576), (544, 544)),
        ("43", (672, 512), (640, 480)),
        ("34", (512, 672), (480, 640)),
        ("169", (800, 448), (736, 416)),
        ("916", (448, 800), (416, 736)),
    ):
        ladder = video_bucket_ladder(MINIMAX_H3_PROFILE_ID, "normal", ar_label, "balanced", 34)
        assert ladder["source"] == "baseline"
        assert ladder["ceiling"] == ceiling
        assert ladder["selectable"][0] == ceiling
        assert ladder["defaults"][0] == default


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
    assert ", 17]" in legacy_text
    assert all(f", {frames}]" not in legacy_text for frames in (102, 136))

    high_fps_folder = tmp_path / "high_fps"
    _write_h3_video_manifest(high_fps_folder, 120, fps=60, duration=2.0)
    generate_dataset_configs(high_fps_folder, mode="normal", profile_id=MINIMAX_H3_PROFILE_ID)
    high_fps_text = (high_fps_folder / "dataset.train.toml").read_text(encoding="utf-8")
    assert ", 17]" in high_fps_text
    assert ", 34]" in high_fps_text
    assert all(f", {frames}]" not in high_fps_text for frames in (68, 102, 136))


def test_h3_safe_video_bucket_table_covers_every_aspect_ratio(tmp_path):
    expected = {
        "square": (320, 320, 68),
        "43": (384, 288, 68),
        "34": (288, 384, 68),
        "169": (448, 256, 68),
        "916": (256, 448, 68),
    }
    for ar, buckets in expected.items():
        set_folder = tmp_path / ar
        _write_h3_video_manifest(set_folder, 136, ar=ar, size=(1024, 1024))

        generate_dataset_configs(set_folder, mode="normal", profile_id=MINIMAX_H3_PROFILE_ID)
        text = (set_folder / "dataset.train.toml").read_text(encoding="utf-8")

        width, height, frames = buckets
        assert f"[{width}, {height}, {frames}]" in text
        assert (width // 32) * (height // 32) * frames <= 11_900
        assert ", 34]" in text
        assert ", 17]" in text
        assert ", 136]" not in text


def test_h3_calibration_clamps_active_role_ceilings(monkeypatch):
    monkeypatch.setattr(dataset_config_module.app_config, "config", {
        "training": {
            "h3_calibration": {
                "version": 1,
                "campaign": "test-machine",
                "safe_shapes": {
                    "17": {"43": [800, 608]},
                    "34": {"square": [320, 320]},
                    "68": {"square": [320, 320], "169": [416, 256]},
                },
            },
        },
    })

    assert video_role_ceiling(MINIMAX_H3_PROFILE_ID, "normal", "square", "temporal") == (320, 320)
    assert video_role_ceiling(MINIMAX_H3_PROFILE_ID, "quality", "916", "temporal") == (256, 416)
    assert video_role_ceiling(MINIMAX_H3_PROFILE_ID, "normal", "34", "detail") == (608, 800)
    assert video_role_ceiling(MINIMAX_H3_PROFILE_ID, "poc", "square", "temporal") == (320, 320)


def test_h3_calibration_replaces_the_conservative_ceiling(monkeypatch):
    monkeypatch.setattr(dataset_config_module.app_config, "config", {
        "training": {
            "h3_calibration": {
                "version": 1,
                "campaign": "large-safe-shapes",
                "safe_shapes": {"68": {"square": [768, 768]}},
            },
        },
    })

    assert video_role_ceiling(MINIMAX_H3_PROFILE_ID, "normal", "square", "temporal") == (768, 768)


def test_h3_dataset_generation_applies_calibrated_ceiling(tmp_path, monkeypatch):
    monkeypatch.setattr(dataset_config_module.app_config, "config", {
        "training": {
            "h3_calibration": {
                "version": 1,
                "campaign": "small-square",
                "safe_shapes": {"68": {"square": [320, 320]}},
            },
        },
    })
    set_folder = tmp_path / "calibrated"
    _write_h3_video_manifest(set_folder, 136, size=(1024, 1024))

    generate_dataset_configs(set_folder, mode="normal", profile_id=MINIMAX_H3_PROFILE_ID)
    text = (set_folder / "dataset.train.toml").read_text(encoding="utf-8")

    assert "[288, 288, 68]" in text
    assert "[320, 320, 68]" not in text


def test_h3_sparse_calibration_uses_exact_entries_and_conservative_fallbacks(monkeypatch):
    monkeypatch.setattr(dataset_config_module.app_config, "config", {
        "training": {
            "h3_calibration": {
                "version": 1,
                "campaign": "h3-envelope-2026-08-27",
                "safe_shapes": {
                    "17": {"169": [1184, 672]},
                    "34": {"43": [800, 608], "169": [896, 512], "square": [704, 704]},
                    "68": {"43": [512, 384], "169": [576, 320], "square": [448, 448]},
                },
            },
        },
    })

    detail_square = video_bucket_ladder(MINIMAX_H3_PROFILE_ID, "normal", "square", "detail", 17)
    assert detail_square["source"] == "baseline"
    assert detail_square["ceiling"] == (736, 736)
    assert detail_square["selectable"][0] == (736, 736)
    assert detail_square["defaults"][0] == (704, 704)
    assert (768, 768) not in detail_square["selectable"]

    detail_wide = video_bucket_ladder(MINIMAX_H3_PROFILE_ID, "normal", "169", "detail", 17)
    assert detail_wide["source"] == "calibration"
    assert detail_wide["campaign"] == "h3-envelope-2026-08-27"
    assert detail_wide["selectable"][0] == (1184, 672)
    assert detail_wide["defaults"][0] == (1152, 640)

    detail_four_three = video_bucket_ladder(MINIMAX_H3_PROFILE_ID, "normal", "43", "detail", 17)
    assert detail_four_three["source"] == "baseline"
    assert detail_four_three["selectable"][0] == (896, 672)
    assert detail_four_three["defaults"][0] == (864, 640)

    balanced_square = video_bucket_ladder(MINIMAX_H3_PROFILE_ID, "normal", "square", "balanced", 34)
    assert balanced_square["source"] == "calibration"
    assert balanced_square["ceiling"] == (704, 704)
    assert balanced_square["selectable"][0] == (704, 704)
    assert balanced_square["defaults"][0] == (672, 672)

    balanced_four_three = video_bucket_ladder(MINIMAX_H3_PROFILE_ID, "normal", "43", "balanced", 34)
    assert balanced_four_three["source"] == "calibration"
    assert balanced_four_three["ceiling"] == (800, 608)
    assert video_bucket_ladder(MINIMAX_H3_PROFILE_ID, "normal", "34", "balanced", 34)["ceiling"] == (608, 800)

    balanced_portrait = video_bucket_ladder(MINIMAX_H3_PROFILE_ID, "normal", "916", "balanced", 34)
    assert balanced_portrait["source"] == "calibration"
    assert balanced_portrait["ceiling"] == (512, 896)

    for ar_label, ceiling, default in (
        ("square", (448, 448), (416, 416)),
        ("43", (512, 384), (480, 352)),
        ("169", (576, 320), (512, 288)),
        ("34", (384, 512), (352, 480)),
        ("916", (320, 576), (288, 512)),
    ):
        ladder = video_bucket_ladder(MINIMAX_H3_PROFILE_ID, "normal", ar_label, "temporal", 68)
        assert ladder["source"] == "calibration"
        assert ladder["selectable"][0] == ceiling
        assert ladder["defaults"][0] == default


def test_h3_calibration_can_lower_a_baseline_and_must_stay_inside_the_model_envelope(monkeypatch):
    monkeypatch.setattr(dataset_config_module.app_config, "config", {
        "training": {"h3_calibration": {"safe_shapes": {"17": {"square": [640, 640]}}}},
    })
    lowered = video_bucket_ladder(MINIMAX_H3_PROFILE_ID, "normal", "square", "detail", 17)
    assert lowered["source"] == "calibration"
    assert lowered["selectable"][0] == (640, 640)
    assert lowered["defaults"][0] == (608, 608)

    monkeypatch.setattr(dataset_config_module.app_config, "config", {
        "training": {"h3_calibration": {"safe_shapes": {"34": {"169": [1376, 768]}}}},
    })
    with pytest.raises(ValueError, match="model/probe envelope"):
        video_bucket_ladder(MINIMAX_H3_PROFILE_ID, "normal", "169", "balanced", 34)


def test_h3_bucket_selection_tolerates_small_upscale_and_falls_back_for_smaller_sources(tmp_path):
    tolerated = tmp_path / "tolerated"
    _write_h3_video_manifest(tolerated, 34, ar="169", size=(585, 334))
    generate_dataset_configs(tolerated, mode="normal", profile_id=MINIMAX_H3_PROFILE_ID)
    tolerated_text = (tolerated / "dataset.train.toml").read_text(encoding="utf-8")
    assert "[576, 320, 17]" in tolerated_text
    assert "[576, 320, 34]" in tolerated_text

    fallback = tmp_path / "fallback"
    _write_h3_video_manifest(fallback, 34, ar="169", size=(500, 280))
    generate_dataset_configs(fallback, mode="normal", profile_id=MINIMAX_H3_PROFILE_ID)
    fallback_text = (fallback / "dataset.train.toml").read_text(encoding="utf-8")
    assert "[448, 256, 17]" in fallback_text
    assert "[448, 256, 34]" in fallback_text
    assert "\n  [576, 320, 17]" not in fallback_text


def test_generate_dataset_configs_splits_video_temporal_and_detail_stanzas(tmp_path):
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
    assert "[736, 416, 13]" in hi_text
    assert "\n  [1184, 672, 13]," not in hi_text
    assert hi_text.count("num_repeats =") == 2
    assert lo_text.count("num_repeats =") == 2
    assert "[INFO] Built 2 video directory block(s)." in report
    assert "169: temporal 672x384 @ 37" in report

    quality_report = generate_dataset_configs(set_folder, mode="quality")
    quality_text = (set_folder / "dataset.hi.toml").read_text(encoding="utf-8")

    assert "  [1024, 576, 13]," in quality_text
    assert "\n  [1184, 672, 13]," not in quality_text
    assert "169: detail 1024x576 @ 13" in quality_report


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


def test_rectangle_image_candidates_allow_long_edge_above_768():
    candidates_916 = generate_candidates("916")
    candidates_34 = generate_candidates("34")
    candidates_169 = generate_candidates("169")
    candidates_square = generate_candidates("square")

    assert candidates_916[0][:2] == (704, 1248)
    assert candidates_34[0][:2] == (768, 1024)
    assert candidates_169[0][:2] == (1248, 704)
    assert candidates_square[0][:2] == (768, 768)


def test_selected_image_bucket_respects_image_mfp_limit():
    images = [
        ("portrait_a.png", 736, 1312),
        ("portrait_b.png", 736, 1312),
        ("portrait_c.png", 736, 1312),
    ]

    selection, unsupported = choose_image_bucket("916", images, mode="normal")

    assert unsupported == []
    assert selection["bucket"] == (416, 736)


def test_choose_image_bucket_prefers_full_coverage_then_detail():
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
    selection_916, unsupported_916 = choose_image_bucket("916", images_916, mode="normal")
    assert unsupported_916 == []
    assert selection_916["bucket"] == (416, 736)

    images_square = [
        ("003c.jpg", 544, 544),
        ("006.jpg", 734, 734),
        ("010.jpg", 768, 768),
        ("012.jpg", 766, 766),
        ("013.jpg", 768, 768),
        ("015.jpg", 648, 648),
        ("019.jpg", 768, 768),
    ]
    selection_square, unsupported_square = choose_image_bucket("square", images_square, mode="normal")
    assert unsupported_square == []
    assert selection_square["bucket"] == (512, 512)

    selection_square_poc, _ = choose_image_bucket("square", images_square, mode="poc")
    assert selection_square_poc["bucket"] == (384, 384)


def test_image_cohort_uses_one_bucket_and_allows_448_to_512():
    selection, unsupported = choose_image_bucket(
        "square",
        [("native.png", 768, 768), ("slight_upscale.png", 448, 448)],
        mode="normal",
        noise_profile="lo",
    )

    assert unsupported == []
    assert selection["bucket"] == (512, 512)
    assert selection["native_count"] == 1
    assert selection["upscaled_count"] == 1
    assert selection["limiting_files"] == ["slight_upscale.png"]


def test_image_cohort_lowers_bucket_for_a_larger_upscale_violation():
    selection, unsupported = choose_image_bucket(
        "square",
        [("native.png", 768, 768), ("small.png", 400, 400)],
        mode="normal",
        noise_profile="lo",
    )

    assert unsupported == []
    assert selection["bucket"] == (448, 448)


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

    normal_hi, unsupported_normal_hi = choose_image_bucket("square", images, mode="normal", noise_profile="hi")
    normal_lo, unsupported_normal_lo = choose_image_bucket("square", images, mode="normal", noise_profile="lo")
    quality_lo, unsupported_quality_lo = choose_image_bucket("square", images, mode="quality", noise_profile="lo")

    assert unsupported_normal_hi == []
    assert unsupported_normal_lo == []
    assert unsupported_quality_lo == []
    assert normal_hi["bucket"] == (480, 480)
    assert normal_lo["bucket"] == (512, 512)
    assert quality_lo["bucket"] == (768, 768)


def test_h3_quality_images_keep_up_to_three_independent_detail_tiers():
    images = [
        ("big.png", 2048, 1152),
        ("known_good.png", 1024, 576),
        ("small.png", 736, 416),
    ]

    classes, unsupported = choose_image_resolution_classes(
        "169", images, mode="quality", profile_id=MINIMAX_H3_PROFILE_ID,
    )

    assert unsupported == []
    assert len(classes) == 3
    by_name = {
        image[0]: item["bucket"]
        for item in classes
        for image in item["images"]
    }
    assert by_name["big.png"] == (1344, 768)
    assert by_name["known_good.png"][0] >= 1024
    assert by_name["known_good.png"][1] >= 576
    assert by_name["small.png"][0] < by_name["known_good.png"][0]
    assert all(value % 32 == 0 for bucket in by_name.values() for value in bucket)


def test_non_h3_quality_keeps_the_existing_single_image_cohort():
    images = [("big.png", 2048, 1152), ("small.png", 736, 416)]

    classes, unsupported = choose_image_resolution_classes(
        "169", images, mode="quality", profile_id=KREA2_PROFILE_ID,
    )

    assert unsupported == []
    assert len(classes) == 1


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


def test_poc_mode_selects_one_image_bucket():
    images = [
        ("high_a.png", 768, 768),
        ("high_b.png", 768, 768),
        ("low.png", 256, 256),
    ]
    selection, unsupported = choose_image_bucket("square", images, mode="poc")
    assert unsupported == []
    assert selection["bucket"] == (288, 288)


def test_repeat_targets_vary_by_mode():
    assert repeat_targets_for_mode("poc") == (5000, 20000)
    assert repeat_targets_for_mode("normal") == (5000, 20000)
    assert repeat_targets_for_mode("quality") == (5000, 20000)


def test_read_epochs_from_training_config_handles_non_utf8_bytes(tmp_path):
    config_path = tmp_path / "config.hi.toml"
    config_path.write_bytes(b"\xff\xfe\nepochs = 42\n")
    assert read_epochs_from_training_config(config_path, fallback=80) == 42
