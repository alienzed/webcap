from pathlib import Path

from PIL import Image

import tool.server.app as app_module
import tool.server.run_ops as run_ops_module
from tool.server.dataset_config import (
    generate_candidates,
    generate_image_candidates,
    generate_dataset_configs,
    image_alternatives,
    normalize_training_generate_mode,
    pick_image_buckets,
    read_epochs_from_training_config,
    repeat_targets_for_mode,
)


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
      "duration": 2.0,
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
    assert "  [256, 256, 1]," in hi_text
    assert "  [512, 512, 1]," in hi_text
    assert "  [768, 768, 1]," not in hi_text
    assert "num_repeats = 8" in hi_text
    assert "num_repeats = 10" in lo_text
    assert "[INFO] Built 1 video directory block(s)." in report
    assert "[INFO] Training generate mode: normal" in report
    assert "[INFO] square_img: selected image bucket(s): 256x256, 512x512" in report
    assert "[INFO] Repeat targeting HI: target=3800" in report
    assert "[INFO] Repeat targeting LO: target=6000" in report
    assert (auto_dataset / "webcap_dataset_metadata.json").exists()


def test_generate_dataset_configs_fails_without_prep_manifest(tmp_path):
    set_folder = tmp_path / "set"
    (set_folder / "auto_dataset").mkdir(parents=True)

    try:
        generate_dataset_configs(set_folder)
    except FileNotFoundError as exc:
        assert "prep_manifest.json" in str(exc)
    else:
        raise AssertionError("generate_dataset_configs should fail without prep_manifest.json")


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
      "width": 1024,
      "height": 576,
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
      "width": 1024,
      "height": 576,
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
    assert "  [640, 352, 49]," in hi_text
    assert "  [1024, 576, 13]," in hi_text
    assert "num_repeats = 19" in hi_text
    assert "num_repeats = 5" in hi_text
    assert "num_repeats = 24" in lo_text
    assert "num_repeats = 6" in lo_text
    assert "[INFO] Built 2 video directory block(s)." in report


def test_generate_dataset_config_route_writes_hi_lo(tmp_path, monkeypatch):
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

    assert response.status_code == 200
    assert "Wrote" in response.get_data(as_text=True)
    assert (set_folder / "dataset.hi.toml").exists()
    assert (set_folder / "dataset.lo.toml").exists()


def test_rectangle_image_candidates_allow_long_edge_above_768():
    candidates_916 = generate_candidates("916")
    candidates_169 = generate_candidates("169")
    candidates_square = generate_candidates("square")

    assert candidates_916[0][:2] == (704, 1248)
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
    assert buckets == [(576, 1024)]


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
    assert buckets_916 == [(480, 864), (576, 1024)]

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
    assert buckets_square == [(544, 544)]

    buckets_square_poc, _ = pick_image_buckets("square", images_square, mode="poc")
    assert buckets_square_poc == [(384, 384)]


def test_normalize_training_generate_mode_keeps_quality_mode():
    assert normalize_training_generate_mode("quality") == "quality"
    assert normalize_training_generate_mode("poc") == "poc"


def test_image_candidates_use_mode_caps():
    assert generate_image_candidates("169", mode="normal")[0][:2] == (1024, 576)
    assert generate_image_candidates("169", mode="poc")[0][:2] == (736, 416)
    assert generate_candidates("169")[0][:2] == (1248, 704)


def test_validate_config_payload_persists_training_mode():
    from tool.server.config import validate_config_payload

    normalized = validate_config_payload({
        "filesystem": {"root": "C:/sets", "models": ""},
        "training": {"mode": "poc"},
    })
    assert normalized["training"]["mode"] == "poc"

    normalized_quality = validate_config_payload({
        "filesystem": {"root": "C:/sets", "models": ""},
        "training": {"mode": "quality"},
    })
    assert normalized_quality["training"]["mode"] == "quality"


def test_poc_mode_never_emits_second_image_bucket():
    images = [
        ("high_a.png", 768, 768),
        ("high_b.png", 768, 768),
        ("low.png", 256, 256),
    ]
    buckets, unsupported = pick_image_buckets("square", images, mode="poc")
    assert unsupported == []
    assert buckets == [(256, 256)]


def test_repeat_targets_vary_by_mode():
    assert repeat_targets_for_mode("poc") == (2200, 3600)
    assert repeat_targets_for_mode("normal") == (3800, 6000)
    assert repeat_targets_for_mode("quality") == (5200, 8000)


def test_read_epochs_from_training_config_handles_non_utf8_bytes(tmp_path):
    config_path = tmp_path / "config.hi.toml"
    config_path.write_bytes(b"\xff\xfe\nepochs = 42\n")
    assert read_epochs_from_training_config(config_path, fallback=80) == 42
