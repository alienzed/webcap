from pathlib import Path

from PIL import Image

import tool.server.app as app_module
import tool.server.file_ops as file_ops_module


def write_text(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def write_image(path: Path, size=(128, 128)):
    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", size, color=(30, 180, 90))
    image.save(path)


def test_duplicate_folder_route(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs_root"
    src = fs_root / "set_a"
    src.mkdir(parents=True)
    write_text(src / "note.txt", "hello")

    def safe_join(rel_path):
        rel = str(rel_path or "").strip().replace("..", "").replace("\\", "/").replace("//", "/")
        if rel.startswith("/"):
            rel = rel[1:]
        return (fs_root / rel).resolve()

    monkeypatch.setattr(file_ops_module, "safe_join_fs_root", safe_join)

    client = app_module.app.test_client()
    response = client.post("/fs/duplicate_folder", json={"src": "set_a"})

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["success"] is True
    copy_dir = fs_root / "set_a copy"
    assert copy_dir.exists() and copy_dir.is_dir()
    assert (copy_dir / "note.txt").read_text(encoding="utf-8") == "hello"


def test_duplicate_image_route_copies_caption(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs_root"
    set_dir = fs_root / "set_b"
    set_dir.mkdir(parents=True)
    write_image(set_dir / "photo.png")
    write_text(set_dir / "photo.txt", "caption text")

    def safe_join(rel_path):
        rel = str(rel_path or "").strip().replace("..", "").replace("\\", "/").replace("//", "/")
        if rel.startswith("/"):
            rel = rel[1:]
        return (fs_root / rel).resolve()

    monkeypatch.setattr(file_ops_module, "safe_join_fs_root", safe_join)

    client = app_module.app.test_client()
    response = client.post("/fs/duplicate_image", json={"src": "set_b/photo.png"})

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["success"] is True
    assert (set_dir / "photo copy.png").exists()
    assert (set_dir / "photo copy.txt").read_text(encoding="utf-8") == "caption text"


def test_duplicate_image_route_blocks_originals(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs_root"
    originals_dir = fs_root / "set_c" / "originals"
    originals_dir.mkdir(parents=True)
    write_image(originals_dir / "img.png")

    def safe_join(rel_path):
        rel = str(rel_path or "").strip().replace("..", "").replace("\\", "/").replace("//", "/")
        if rel.startswith("/"):
            rel = rel[1:]
        return (fs_root / rel).resolve()

    monkeypatch.setattr(file_ops_module, "safe_join_fs_root", safe_join)

    client = app_module.app.test_client()
    response = client.post("/fs/duplicate_image", json={"src": "set_c/originals/img.png"})

    assert response.status_code == 400
    payload = response.get_json()
    assert "not allowed in originals folder" in payload["error"]


def test_open_in_explorer_selects_windows_file_with_spaces(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs_root"
    media_path = fs_root / "set d" / "photo one.png"
    write_image(media_path)
    calls = []

    def safe_join(rel_path):
        rel = str(rel_path or "").strip().replace("..", "").replace("\\", "/").replace("//", "/")
        if rel.startswith("/"):
            rel = rel[1:]
        return (fs_root / rel).resolve()

    def fake_popen(args):
        calls.append(args)

    monkeypatch.setattr(file_ops_module, "safe_join_fs_root", safe_join)
    monkeypatch.setattr(file_ops_module.sys, "platform", "win32")
    monkeypatch.setattr(file_ops_module.subprocess, "Popen", fake_popen)
    monkeypatch.setenv("WINDIR", str(tmp_path / "missing_windows"))

    client = app_module.app.test_client()
    response = client.post("/fs/open_in_explorer", json={"path": "set d/photo one.png"})

    assert response.status_code == 200
    assert response.get_json()["ok"] is True
    assert calls == [["explorer.exe", f'/select,"{str(media_path.resolve()).replace("/", "\\")}"']]
