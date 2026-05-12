from pathlib import Path

from PIL import Image

import tool.server.app as app_module
import tool.server.run_ops as run_ops_module
from tool.server.dataset_config import generate_candidates, generate_dataset_configs, image_alternatives, pick_image_buckets


def write_image(path: Path, size):
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", size, color=(120, 80, 200))
    img.save(path)


def test_generate_dataset_configs_copies_video_and_replaces_images(tmp_path):
    set_folder = tmp_path / "set"
    auto_dataset = set_folder / "auto_dataset"
    square_img = auto_dataset / "square_img"
    square_img.mkdir(parents=True)

    (auto_dataset / "dataset.auto.toml").write_text(
        "\n".join([
            "enable_ar_bucket = true",
            "",
            "[[directory]]",
            f'path = "{(auto_dataset / "square").as_posix()}"',
            "num_repeats = 2",
            'group = "videos"',
            "size_buckets = [",
            "  [512, 512, 33],",
            "]",
            "",
            "[[directory]]",
            f'path = "{square_img.as_posix()}"',
            "num_repeats = 1",
            'group = "images"',
            "size_buckets = [",
            "  [256, 256, 1],",
            "]",
        ]),
        encoding="utf-8",
    )

    write_image(square_img / "high_a.png", (768, 768))
    write_image(square_img / "high_b.png", (768, 768))
    write_image(square_img / "mid_a.png", (512, 512))
    write_image(square_img / "mid_b.png", (512, 512))
    write_image(square_img / "low.png", (256, 256))

    report = generate_dataset_configs(set_folder)

    hi_text = (set_folder / "dataset.hi.toml").read_text(encoding="utf-8")
    lo_text = (set_folder / "dataset.lo.toml").read_text(encoding="utf-8")

    assert hi_text == lo_text
    assert 'group = "videos"' in hi_text
    assert "  [512, 512, 33]," in hi_text
    assert hi_text.count('group = "images"') == 1
    assert "  [512, 512, 1]," in hi_text
    assert "  [768, 768, 1]," in hi_text
    assert "  [256, 256, 1]," not in hi_text
    assert "Copied 1 video directory block" in report
    assert "selected image bucket(s): 512x512, 768x768" in report
    assert (auto_dataset / "webcap_dataset_metadata.json").exists()


def test_generate_dataset_configs_fails_without_autoset_toml(tmp_path):
    set_folder = tmp_path / "set"
    (set_folder / "auto_dataset").mkdir(parents=True)

    try:
        generate_dataset_configs(set_folder)
    except FileNotFoundError as exc:
        assert "dataset.auto.toml" in str(exc)
    else:
        raise AssertionError("generate_dataset_configs should fail without dataset.auto.toml")


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
    monkeypatch.setattr(run_ops_module, "safe_join_fs_root", safe_join)

    (auto_dataset / "dataset.auto.toml").write_text(
        "\n".join([
            "enable_ar_bucket = true",
            "",
            "[[directory]]",
            f'path = "{(auto_dataset / "169").as_posix()}"',
            "num_repeats = 2",
            'group = "videos"',
            "size_buckets = [",
            "  [640, 352, 33],",
            "]",
        ]),
        encoding="utf-8",
    )
    write_image(square_img / "img.png", (512, 512))

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


def test_image_alternatives_include_larger_exploration_buckets():
    assert image_alternatives("square", 768, 768) == [
        (704, 704),
        (736, 736),
        (800, 800),
        (832, 832),
    ]
    assert image_alternatives("916", 704, 1248) == [
        (640, 1152),
        (672, 1184),
        (736, 1312),
        (768, 1376),
    ]


def test_selected_image_buckets_respect_image_mfp_limit():
    images = [
        ("portrait_a.png", 736, 1312),
        ("portrait_b.png", 736, 1312),
        ("portrait_c.png", 736, 1312),
    ]

    buckets, unsupported = pick_image_buckets("916", images)

    assert unsupported == []
    assert buckets == [(640, 1152)]


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
    buckets_916, unsupported_916 = pick_image_buckets("916", images_916)
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
    buckets_square, unsupported_square = pick_image_buckets("square", images_square)
    assert unsupported_square == []
    assert buckets_square == [(544, 544), (768, 768)]
