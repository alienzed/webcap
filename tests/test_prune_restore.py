import json
from pathlib import Path

import pytest

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
