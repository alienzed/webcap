import json
from pathlib import Path

import pytest
from PIL import Image

import tool.server.app as app_module


@pytest.fixture
def isolated_fs_root(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs_root"
    fs_root.mkdir()

    def _safe_join(rel_path):
        rel = str(rel_path or "").strip().replace("..", "").replace("\\", "/").replace("//", "/")
        if rel.startswith("/"):
            rel = rel[1:]
        return (fs_root / rel).resolve()

    monkeypatch.setattr(app_module, "safe_join_fs_root", _safe_join)
    monkeypatch.setattr(app_module, "_resolve_folder", _safe_join)
    return fs_root


@pytest.fixture
def client(isolated_fs_root):
    return app_module.app.test_client()


def write_bytes(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def write_text(path: Path, data: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(data, encoding="utf-8")


def test_prune_restore_collision_and_caption_behavior(client, isolated_fs_root):
    set_folder_rel = "set_a"
    set_folder = isolated_fs_root / set_folder_rel
    set_folder.mkdir(parents=True)

    write_bytes(set_folder / "test1.mp4", b"media1-data")
    write_text(set_folder / "test1.txt", "caption1-data")
    write_bytes(set_folder / "test2.mp4", b"media2-data")
    write_text(set_folder / "test2.txt", "caption2-data")

    r = client.post("/media/prune", json={"folder": set_folder_rel, "media": "test1.mp4"})
    assert r.status_code == 200
    assert (set_folder / "originals" / "pruned_test1.mp4").exists()
    assert (set_folder / "originals" / "pruned_test1.txt").exists()
    assert not (set_folder / "test1.mp4").exists()
    assert not (set_folder / "test1.txt").exists()

    r = client.post("/media/prune", json={"folder": set_folder_rel, "media": "test1.mp4"})
    assert r.status_code == 404

    write_bytes(set_folder / "test1.mp4", b"media1-data-v2")
    write_text(set_folder / "test1.txt", "caption1-data-v2")
    r = client.post("/media/prune", json={"folder": set_folder_rel, "media": "test1.mp4"})
    assert r.status_code == 200
    assert (set_folder / "originals" / "pruned_test1-1.mp4").exists()
    assert (set_folder / "originals" / "pruned_test1-1.txt").exists()

    r = client.post("/media/restore", json={"folder": set_folder_rel, "fileName": "pruned_test1.mp4"})
    assert r.status_code == 200
    assert (set_folder / "test1.mp4").exists()
    assert (set_folder / "test1.txt").exists()

    r = client.post("/media/restore", json={"folder": set_folder_rel, "fileName": "pruned_test1.mp4"})
    assert r.status_code == 409

    r = client.post("/media/restore", json={"folder": set_folder_rel, "fileName": "pruned_test1-1.mp4"})
    assert r.status_code == 200
    assert (set_folder / "test1-1.mp4").exists()
    assert (set_folder / "test1-1.txt").exists()

    (set_folder / "test2.txt").unlink()
    r = client.post("/media/prune", json={"folder": set_folder_rel, "media": "test2.mp4"})
    assert r.status_code == 200
    assert (set_folder / "originals" / "pruned_test2.mp4").exists()
    assert not (set_folder / "originals" / "pruned_test2.txt").exists()

    r = client.post("/media/restore", json={"folder": set_folder_rel, "fileName": "pruned_test2.mp4"})
    assert r.status_code == 200
    assert (set_folder / "test2.mp4").exists()
    assert not (set_folder / "test2.txt").exists()


def test_reset_overwrites_media_and_preserves_existing_caption(client, isolated_fs_root):
    set_folder_rel = "set_b"
    set_folder = isolated_fs_root / set_folder_rel
    originals = set_folder / "originals"
    originals.mkdir(parents=True)

    write_bytes(originals / "clip.mp4", b"original-bytes")
    write_text(originals / "clip.txt", "original-caption")
    write_bytes(set_folder / "clip.mp4", b"edited-bytes")
    write_text(set_folder / "clip.txt", "edited-caption")

    r = client.post("/media/reset", json={"folder": set_folder_rel, "fileName": "clip.mp4"})
    assert r.status_code == 200
    assert (set_folder / "clip.mp4").read_bytes() == b"original-bytes"
    assert (set_folder / "clip.txt").read_text(encoding="utf-8") == "edited-caption"

    r = client.post("/media/reset", json={"folder": set_folder_rel, "fileName": "missing.mp4"})
    assert r.status_code == 404


def test_rename_file_renames_sidecar_and_updates_reviewed_keys(client, isolated_fs_root):
    set_folder_rel = "set_c"
    set_folder = isolated_fs_root / set_folder_rel
    set_folder.mkdir(parents=True)

    write_bytes(set_folder / "old.mp4", b"media")
    write_text(set_folder / "old.txt", "caption")
    write_bytes(set_folder / "target.mp4", b"other")
    write_text(
        set_folder / ".webcap_state.json",
        json.dumps({"reviewedKeys": ["old.mp4", "other.mp4"]}, indent=2),
    )

    r = client.post(
        "/fs/rename",
        json={"folder": set_folder_rel, "oldFile": "old.mp4", "newFile": "new.mp4"},
    )
    assert r.status_code == 200
    assert not (set_folder / "old.mp4").exists()
    assert (set_folder / "new.mp4").exists()
    assert not (set_folder / "old.txt").exists()
    assert (set_folder / "new.txt").exists()

    state = json.loads((set_folder / ".webcap_state.json").read_text(encoding="utf-8"))
    assert "new.mp4" in state["reviewedKeys"]
    assert "old.mp4" not in state["reviewedKeys"]

    r = client.post(
        "/fs/rename",
        json={"folder": set_folder_rel, "oldFile": "new.mp4", "newFile": "target.mp4"},
    )
    assert r.status_code == 409

    r = client.post(
        "/fs/rename",
        json={"folder": set_folder_rel, "oldFile": "missing.mp4", "newFile": "another.mp4"},
    )
    assert r.status_code == 404


def test_rename_folder_and_reserved_name_guard(client, isolated_fs_root):
    set_folder_rel = "set_d"
    set_folder = isolated_fs_root / set_folder_rel
    set_folder.mkdir(parents=True)
    (set_folder / "old_folder").mkdir()

    r = client.post(
        "/fs/rename",
        json={"folder": set_folder_rel, "old_name": "old_folder", "new_name": "renamed_folder"},
    )
    assert r.status_code == 200
    assert not (set_folder / "old_folder").exists()
    assert (set_folder / "renamed_folder").exists()

    r = client.post(
        "/fs/rename",
        json={"folder": set_folder_rel, "old_name": "renamed_folder", "new_name": "originals"},
    )
    assert r.status_code == 400


def test_crop_image_replaces_media_and_preserves_caption(client, isolated_fs_root):
    set_folder_rel = "set_crop"
    set_folder = isolated_fs_root / set_folder_rel
    set_folder.mkdir(parents=True)

    Image.new("RGB", (100, 80), "blue").save(set_folder / "photo.jpg")
    write_text(set_folder / "photo.txt", "caption stays")

    r = client.post(
        "/media/crop",
        json={
            "folder": set_folder_rel,
            "fileName": "photo.jpg",
            "crop": {"x": 10, "y": 5, "width": 30, "height": 30},
        },
    )
    assert r.status_code == 200
    assert Image.open(set_folder / "photo.jpg").size == (30, 30)
    assert Image.open(set_folder / "originals" / "photo.jpg").size == (100, 80)
    assert (set_folder / "photo.txt").read_text(encoding="utf-8") == "caption stays"


def test_crop_rejects_out_of_bounds_without_changing_file(client, isolated_fs_root):
    set_folder_rel = "set_crop_invalid"
    set_folder = isolated_fs_root / set_folder_rel
    set_folder.mkdir(parents=True)

    Image.new("RGB", (40, 40), "red").save(set_folder / "photo.jpg")
    before = (set_folder / "photo.jpg").read_bytes()

    r = client.post(
        "/media/crop",
        json={
            "folder": set_folder_rel,
            "fileName": "photo.jpg",
            "crop": {"x": 20, "y": 20, "width": 30, "height": 30},
        },
    )
    assert r.status_code == 400
    assert (set_folder / "photo.jpg").read_bytes() == before


def test_crop_rejects_video_files(client, isolated_fs_root):
    set_folder_rel = "set_crop_video"
    set_folder = isolated_fs_root / set_folder_rel
    set_folder.mkdir(parents=True)
    write_bytes(set_folder / "clip.mp4", b"video")

    r = client.post(
        "/media/crop",
        json={
            "folder": set_folder_rel,
            "fileName": "clip.mp4",
            "crop": {"x": 0, "y": 0, "width": 10, "height": 10},
        },
    )
    assert r.status_code == 400


def test_baseline_only_backup_immutable_canonicals(client, isolated_fs_root):
    """Test that repeated directory loads do not replace canonical originals."""
    set_folder_rel = "set_baseline"
    set_folder = isolated_fs_root / set_folder_rel
    set_folder.mkdir(parents=True)

    # First directory load backs up original
    write_bytes(set_folder / "video.mp4", b"original-content")
    r = client.get(f"/fs/describe?path={set_folder_rel}")
    assert r.status_code == 200
    assert (set_folder / "originals" / "video.mp4").exists()
    original_hash = (set_folder / "originals" / "video.mp4").read_bytes()

    # Edit the working file
    write_bytes(set_folder / "video.mp4", b"edited-content-v1")

    # Second directory load should NOT replace canonical
    r = client.get(f"/fs/describe?path={set_folder_rel}")
    assert r.status_code == 200
    assert (set_folder / "originals" / "video.mp4").read_bytes() == original_hash
    # No suffix files should be created
    assert not (set_folder / "originals" / "video-1.mp4").exists()

    # Edit again
    write_bytes(set_folder / "video.mp4", b"edited-content-v2")

    # Third directory load should still keep canonical unchanged
    r = client.get(f"/fs/describe?path={set_folder_rel}")
    assert r.status_code == 200
    assert (set_folder / "originals" / "video.mp4").read_bytes() == original_hash
    assert not (set_folder / "originals" / "video-1.mp4").exists()


def test_rename_collision_in_originals_fails_safely(client, isolated_fs_root):
    """Test that renaming to a name that already exists in originals fails safely."""
    set_folder_rel = "set_rename_collision"
    set_folder = isolated_fs_root / set_folder_rel
    originals = set_folder / "originals"
    originals.mkdir(parents=True)

    # Set up: originals has photo-1.mp4 and photo.mp4 exists in set
    write_bytes(originals / "photo.mp4", b"original-photo")
    write_bytes(originals / "photo-1.mp4", b"old-version")
    write_bytes(set_folder / "clip.mp4", b"clip-data")

    # Try to rename clip.mp4 to photo.mp4 when originals/photo.mp4 already exists
    r = client.post(
        "/fs/rename",
        json={"folder": set_folder_rel, "oldFile": "clip.mp4", "newFile": "photo.mp4"},
    )
    # Should fail because originals/photo.mp4 would collide
    assert r.status_code == 409
    # Set file should not have been renamed
    assert (set_folder / "clip.mp4").exists()
    assert not (set_folder / "photo.mp4").exists()


def test_rename_with_originals_renames_both_media_and_caption(client, isolated_fs_root):
    """Test that renaming also renames the canonical original and its caption."""
    set_folder_rel = "set_rename_originals"
    set_folder = isolated_fs_root / set_folder_rel
    originals = set_folder / "originals"
    originals.mkdir(parents=True)

    # Set up original and set files
    write_bytes(originals / "old_video.mp4", b"original-video")
    write_text(originals / "old_video.txt", "original caption")
    write_bytes(set_folder / "old_video.mp4", b"edited-video")
    write_text(set_folder / "old_video.txt", "edited caption")

    # Rename
    r = client.post(
        "/fs/rename",
        json={"folder": set_folder_rel, "oldFile": "old_video.mp4", "newFile": "new_video.mp4"},
    )
    assert r.status_code == 200

    # Check set folder was renamed
    assert not (set_folder / "old_video.mp4").exists()
    assert (set_folder / "new_video.mp4").exists()
    assert not (set_folder / "old_video.txt").exists()
    assert (set_folder / "new_video.txt").exists()

    # Check originals folder was renamed
    assert not (originals / "old_video.mp4").exists()
    assert (originals / "new_video.mp4").exists()
    assert not (originals / "old_video.txt").exists()
    assert (originals / "new_video.txt").exists()

    # Verify reset still works after rename
    r = client.post("/media/reset", json={"folder": set_folder_rel, "fileName": "new_video.mp4"})
    assert r.status_code == 200
    assert (set_folder / "new_video.mp4").read_bytes() == b"original-video"
    # Existing caption in set should be preserved
    assert (set_folder / "new_video.txt").read_text(encoding="utf-8") == "edited caption"
