import json
from pathlib import Path

import pytest
from PIL import Image

import tool.server.app as app_module
import tool.server.file_ops as file_ops_module
import tool.server.face_focus as face_focus_module
import tool.server.media as media_module


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
    monkeypatch.setattr(file_ops_module, "safe_join_fs_root", _safe_join)
    monkeypatch.setattr(media_module, "safe_join_fs_root", _safe_join)
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
    assert not (set_folder / "originals" / "pruned_test1.mp4").exists()
    assert not (set_folder / "originals" / "pruned_test1.txt").exists()

    r = client.post("/media/restore", json={"folder": set_folder_rel, "fileName": "pruned_test1.mp4"})
    assert r.status_code == 404

    r = client.post("/media/restore", json={"folder": set_folder_rel, "fileName": "pruned_test1-1.mp4"})
    assert r.status_code == 200
    assert (set_folder / "test1-1.mp4").exists()
    assert (set_folder / "test1-1.txt").exists()
    assert not (set_folder / "originals" / "pruned_test1-1.mp4").exists()
    assert not (set_folder / "originals" / "pruned_test1-1.txt").exists()

    (set_folder / "test2.txt").unlink()
    r = client.post("/media/prune", json={"folder": set_folder_rel, "media": "test2.mp4"})
    assert r.status_code == 200
    assert (set_folder / "originals" / "pruned_test2.mp4").exists()
    assert not (set_folder / "originals" / "pruned_test2.txt").exists()

    r = client.post("/media/restore", json={"folder": set_folder_rel, "fileName": "pruned_test2.mp4"})
    assert r.status_code == 200
    assert (set_folder / "test2.mp4").exists()
    assert not (set_folder / "test2.txt").exists()
    assert not (set_folder / "originals" / "pruned_test2.mp4").exists()


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


def test_media_metadata_adds_image_face_focus(monkeypatch, tmp_path):
    folder = tmp_path / "set_face_focus"
    folder.mkdir()
    Image.new("RGB", (100, 100), "blue").save(folder / "photo.jpg")

    class FakeProc:
        stdout = json.dumps({"streams": [{"width": 100, "height": 100}]})

    detector = object()
    monkeypatch.setattr(media_module.subprocess, "run", lambda *args, **kwargs: FakeProc())
    monkeypatch.setattr(media_module, "get_face_focus_detector", lambda: detector)
    monkeypatch.setattr(
        media_module,
        "analyze_image_face_focus",
        lambda file_path, face_detector: {
            "bucket": "close",
            "face_count": 1,
            "largest_height_pct": 34.0,
            "largest_area_pct": 8.0,
            "largest_score": 0.91,
        },
    )

    metadata = media_module.update_media_metadata(folder, include_face_focus=True)

    assert metadata["photo.jpg"]["face_focus"]["bucket"] == "close"
    assert metadata["photo.jpg"]["face_focus"]["largest_height_pct"] == 34.0


def test_face_focus_filters_tiny_false_positive_boxes(monkeypatch, tmp_path):
    image_path = tmp_path / "noisy.jpg"
    Image.new("RGB", (100, 100), "blue").save(image_path)

    class FakeDetector:
        def __call__(self, frame, threshold):
            return (
                [
                    [1, 1, 2, 2, 0.99],
                    [5, 5, 6, 6, 0.99],
                    [10, 10, 50, 50, 0.85],
                ],
                [],
            )

    result = face_focus_module.analyze_image_face_focus(image_path, FakeDetector())

    assert result["face_count"] == 1
    assert result["raw_face_count"] == 3
    assert result["bucket"] == "close"
    assert result["version"] == face_focus_module.FACE_FOCUS_VERSION
    assert result["detector_input_size"] == [640, 640]


def test_media_metadata_skips_face_focus_by_default(monkeypatch, tmp_path):
    folder = tmp_path / "set_face_focus_default"
    folder.mkdir()
    Image.new("RGB", (100, 100), "blue").save(folder / "photo.jpg")

    class FakeProc:
        stdout = json.dumps({"streams": [{"width": 100, "height": 100}]})

    monkeypatch.setattr(media_module.subprocess, "run", lambda *args, **kwargs: FakeProc())
    monkeypatch.setattr(
        media_module,
        "get_face_focus_detector",
        lambda: (_ for _ in ()).throw(AssertionError("detector should not load")),
    )

    metadata = media_module.update_media_metadata(folder)

    assert "face_focus" not in metadata["photo.jpg"]


def test_media_metadata_response_flattens_face_focus(client, isolated_fs_root, monkeypatch):
    set_folder_rel = "set_face_focus_response"
    set_folder = isolated_fs_root / set_folder_rel
    set_folder.mkdir(parents=True)
    Image.new("RGB", (100, 100), "blue").save(set_folder / "photo.jpg")

    monkeypatch.setattr(
        media_module,
        "update_media_metadata",
        lambda folder_path, include_face_focus=False: {
            "photo.jpg": {
                "size": 100,
                "mtime": 123,
                "resolution": "100x100",
                "aspect_ratio": "1:1",
                "face_focus": {
                    "bucket": "medium",
                    "face_count": 1,
                    "largest_height_pct": 20.0,
                    "largest_area_pct": 4.0,
                    "largest_score": 0.82,
                },
            }
        },
    )

    response = client.get(f"/fs/media_metadata?folder={set_folder_rel}")

    assert response.status_code == 200
    payload = response.get_json()
    assert payload[0]["face_focus_bucket"] == "medium"
    assert payload[0]["largest_face_height_pct"] == 20.0
    assert payload[0]["largest_face_score"] == 0.82


def test_media_metadata_route_opts_into_face_focus(client, isolated_fs_root, monkeypatch):
    set_folder_rel = "set_face_focus_route"
    set_folder = isolated_fs_root / set_folder_rel
    set_folder.mkdir(parents=True)
    seen = []

    def fake_update_media_metadata(folder_path, include_face_focus=False):
        seen.append(include_face_focus)
        return {}

    monkeypatch.setattr(media_module, "update_media_metadata", fake_update_media_metadata)

    plain_response = client.get(f"/fs/media_metadata?folder={set_folder_rel}")
    focus_response = client.get(f"/fs/media_metadata?folder={set_folder_rel}&face_focus=1")

    assert plain_response.status_code == 200
    assert focus_response.status_code == 200
    assert seen == [False, True]


def test_media_metadata_backfills_cached_image_face_focus(monkeypatch, tmp_path):
    folder = tmp_path / "set_face_focus_backfill"
    folder.mkdir()
    image_path = folder / "photo.jpg"
    Image.new("RGB", (100, 100), "blue").save(image_path)
    stat = image_path.stat()
    write_text(
        folder / "media_metadata.json",
        json.dumps({
            "photo.jpg": {
                "size": stat.st_size,
                "mtime": int(stat.st_mtime),
                "resolution": "100x100",
                "aspect_ratio": "1:1",
            }
        }),
    )

    class FakeProc:
        stdout = json.dumps({"streams": [{"width": 100, "height": 100}]})

    monkeypatch.setattr(media_module.subprocess, "run", lambda *args, **kwargs: FakeProc())
    monkeypatch.setattr(media_module, "get_face_focus_detector", lambda: object())
    monkeypatch.setattr(
        media_module,
        "analyze_image_face_focus",
        lambda file_path, face_detector: {
            "bucket": "body",
            "face_count": 1,
            "largest_height_pct": 8.0,
        },
    )

    metadata = media_module.update_media_metadata(folder, include_face_focus=True)

    assert metadata["photo.jpg"]["face_focus"]["bucket"] == "body"


def test_media_metadata_flushes_face_focus_incrementally(monkeypatch, tmp_path):
    folder = tmp_path / "set_face_focus_flush"
    folder.mkdir()
    Image.new("RGB", (100, 100), "blue").save(folder / "one.jpg")
    Image.new("RGB", (100, 100), "green").save(folder / "two.jpg")

    class FakeProc:
        stdout = json.dumps({"streams": [{"width": 100, "height": 100}]})

    calls = []

    def fake_analyze_image_face_focus(file_path, face_detector):
        calls.append(Path(file_path).name)
        if len(calls) > 1:
            raise RuntimeError("stop after first flush")
        return {
            "bucket": "medium",
            "face_count": 1,
            "largest_height_pct": 20.0,
            "version": face_focus_module.FACE_FOCUS_VERSION,
        }

    monkeypatch.setattr(media_module.subprocess, "run", lambda *args, **kwargs: FakeProc())
    monkeypatch.setattr(media_module, "get_face_focus_detector", lambda: object())
    monkeypatch.setattr(media_module, "analyze_image_face_focus", fake_analyze_image_face_focus)

    media_module.update_media_metadata(folder, include_face_focus=True)
    cached = json.loads((folder / "media_metadata.json").read_text(encoding="utf-8"))

    assert cached["one.jpg"]["face_focus"]["bucket"] == "medium"


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


@pytest.mark.parametrize(
    "operation,transpose_mode",
    [
        ("rotate_left_90", Image.Transpose.ROTATE_90),
        ("rotate_right_90", Image.Transpose.ROTATE_270),
        ("flip_vertical", Image.Transpose.FLIP_TOP_BOTTOM),
        ("flip_horizontal", Image.Transpose.FLIP_LEFT_RIGHT),
    ],
)
def test_image_transform_overwrites_media_and_preserves_caption(
    client, isolated_fs_root, operation, transpose_mode
):
    set_folder_rel = "set_image_transform"
    set_folder = isolated_fs_root / set_folder_rel
    set_folder.mkdir(parents=True, exist_ok=True)

    src = Image.new("RGB", (3, 2))
    src.putdata(
        [
            (255, 0, 0),
            (0, 255, 0),
            (0, 0, 255),
            (255, 255, 0),
            (255, 0, 255),
            (0, 255, 255),
        ]
    )
    src.save(set_folder / "photo.png")
    write_text(set_folder / "photo.txt", "caption stays")

    expected = src.transpose(transpose_mode)
    r = client.post(
        "/media/image_transform",
        json={
            "folder": set_folder_rel,
            "fileName": "photo.png",
            "operation": operation,
        },
    )
    assert r.status_code == 200

    transformed = Image.open(set_folder / "photo.png").convert("RGB")
    original_copy = Image.open(set_folder / "originals" / "photo.png").convert("RGB")

    assert transformed.size == expected.size
    assert list(transformed.getdata()) == list(expected.getdata())
    assert original_copy.size == src.size
    assert list(original_copy.getdata()) == list(src.getdata())
    assert (set_folder / "photo.txt").read_text(encoding="utf-8") == "caption stays"


def test_image_transform_rejects_invalid_operation(client, isolated_fs_root):
    set_folder_rel = "set_image_transform_invalid"
    set_folder = isolated_fs_root / set_folder_rel
    set_folder.mkdir(parents=True)

    Image.new("RGB", (10, 10), "orange").save(set_folder / "photo.png")
    before = (set_folder / "photo.png").read_bytes()

    r = client.post(
        "/media/image_transform",
        json={
            "folder": set_folder_rel,
            "fileName": "photo.png",
            "operation": "spin_around",
        },
    )
    assert r.status_code == 400
    assert (set_folder / "photo.png").read_bytes() == before


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
