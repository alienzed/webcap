import json
from pathlib import Path

from PIL import Image

import tool.server.app as app_module
import tool.server.media as media_module


def _write_webp(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGBA", (12, 8), color=(20, 40, 60, 128))
    image.save(path, format="WEBP", lossless=True)


def _safe_join_for(root):
    def safe_join(rel_path):
        rel = str(rel_path or "").strip().replace("\\", "/").strip("/")
        return (root / rel).resolve()
    return safe_join


def test_convert_webp_to_png_preserves_source_and_migrates_item_state(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs_root"
    folder = fs_root / "set_a"
    folder.mkdir(parents=True)
    source = folder / "sample.webp"
    _write_webp(source)
    source_bytes = source.read_bytes()
    (folder / "sample.txt").write_text("caption stays put", encoding="utf-8")
    (folder / ".webcap_state.json").write_text(
        json.dumps({
            "reviewedKeys": ["sample.webp"],
            "mutated_media_keys": ["sample.webp"],
            "flags": {"sample.webp": "green"},
            "caption_tags_by_media": {"sample.webp": ["tag-a"]},
            "ratings_by_media": {"sample.webp": 4},
        }),
        encoding="utf-8",
    )

    monkeypatch.setattr(media_module, "safe_join_fs_root", _safe_join_for(fs_root))

    response = app_module.app.test_client().post(
        "/media/convert_webp_png",
        json={"folder": "set_a", "fileName": "sample.webp"},
    )

    assert response.status_code == 200
    assert response.get_json()["fileName"] == "sample.png"
    assert not source.exists()
    assert (folder / "sample.png").exists()
    assert (folder / "sample.txt").read_text(encoding="utf-8") == "caption stays put"
    assert (folder / "originals" / "sample.webp").read_bytes() == source_bytes
    assert (folder / "originals" / "sample.png").exists()

    with Image.open(folder / "sample.png") as converted:
        converted.load()
        assert converted.size == (12, 8)
        assert converted.mode == "RGBA"

    state = json.loads((folder / ".webcap_state.json").read_text(encoding="utf-8"))
    assert state["reviewedKeys"] == ["sample.png"]
    assert state["mutated_media_keys"] == ["sample.png"]
    assert state["flags"] == {"sample.png": "green"}
    assert state["caption_tags_by_media"] == {"sample.png": ["tag-a"]}
    assert state["ratings_by_media"] == {"sample.png": 4}

    metadata = json.loads((folder / "media_metadata.json").read_text(encoding="utf-8"))
    assert "sample.webp" not in metadata
    assert "sample.png" in metadata


def test_convert_webp_to_png_refuses_existing_png(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs_root"
    folder = fs_root / "set_a"
    folder.mkdir(parents=True)
    _write_webp(folder / "sample.webp")
    Image.new("RGB", (4, 4)).save(folder / "sample.png")

    monkeypatch.setattr(media_module, "safe_join_fs_root", _safe_join_for(fs_root))

    response = app_module.app.test_client().post(
        "/media/convert_webp_png",
        json={"folder": "set_a", "fileName": "sample.webp"},
    )

    assert response.status_code == 409
    assert (folder / "sample.webp").exists()
    assert (folder / "sample.png").exists()


def test_convert_webp_to_png_rejects_non_webp(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs_root"
    folder = fs_root / "set_a"
    folder.mkdir(parents=True)
    Image.new("RGB", (4, 4)).save(folder / "sample.jpg")

    monkeypatch.setattr(media_module, "safe_join_fs_root", _safe_join_for(fs_root))

    response = app_module.app.test_client().post(
        "/media/convert_webp_png",
        json={"folder": "set_a", "fileName": "sample.jpg"},
    )

    assert response.status_code == 400
    assert "only available for WebP" in response.get_json()["error"]
