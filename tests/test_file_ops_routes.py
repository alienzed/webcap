import json
from pathlib import Path

from PIL import Image

import tool.server.app as app_module
import tool.server.file_ops as file_ops_module
import tool.server.run_ops as run_ops_module
import tool.server.smart_set as smart_set_module


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


def test_fs_path_exists_reports_directory_and_file(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs_root"
    folder = fs_root / "sets" / "a"
    folder.mkdir(parents=True)
    write_text(folder / "note.txt", "hello")

    def safe_join(rel_path):
        rel = str(rel_path or "").strip().replace("..", "").replace("\\", "/").replace("//", "/")
        if rel.startswith("/"):
            rel = rel[1:]
        return (fs_root / rel).resolve()

    monkeypatch.setattr(app_module, "safe_join_fs_root", safe_join)

    client = app_module.app.test_client()

    folder_resp = client.get("/fs/path_exists?path=sets/a")
    assert folder_resp.status_code == 200
    folder_payload = folder_resp.get_json()
    assert folder_payload["ok"] is True
    assert folder_payload["exists"] is True
    assert folder_payload["is_dir"] is True
    assert folder_payload["is_file"] is False

    file_resp = client.get("/fs/path_exists?path=sets/a/note.txt")
    assert file_resp.status_code == 200
    file_payload = file_resp.get_json()
    assert file_payload["ok"] is True
    assert file_payload["exists"] is True
    assert file_payload["is_dir"] is False
    assert file_payload["is_file"] is True


def test_app_config_get_prefers_disk_config(monkeypatch):
    disk_cfg = {
        "filesystem": {"root": "C:/disk-root", "models": "/mnt/w/models"},
        "debug": False,
        "training": {},
    }
    runtime_cfg = {
        "filesystem": {"root": "C:/runtime-root", "models": ""},
        "debug": True,
        "training": {},
    }
    monkeypatch.setattr(app_module.app_config, "load_config_from_disk", lambda: disk_cfg)
    monkeypatch.setattr(app_module.app_config, "get_config_snapshot", lambda: runtime_cfg)

    client = app_module.app.test_client()
    response = client.get("/app/config")

    assert response.status_code == 200
    assert response.get_json()["filesystem"]["root"] == "C:/disk-root"


def test_app_config_save_persists_snapshot_comment_flag(tmp_path, monkeypatch):
    config_path = tmp_path / "config.json"
    monkeypatch.setattr(app_module.app_config, "CONFIG_PATH", config_path)

    client = app_module.app.test_client()
    response = client.post(
        "/app/config",
        json={
            "filesystem": {"root": "C:/train-root", "models": "C:/models"},
            "debug": False,
            "training": {
                "diffusion_pipe_wsl": "/home/user/diffusion-pipe",
                "activate_script": "dp-clean/bin/activate",
                "mode": "normal",
                "write_selection_snapshot_comments": True,
            },
        },
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["config"]["training"]["write_selection_snapshot_comments"] is True
    saved = json.loads(config_path.read_text(encoding="utf-8"))
    assert saved["training"]["write_selection_snapshot_comments"] is True


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
    popen_calls = []

    def safe_join(rel_path):
        rel = str(rel_path or "").strip().replace("..", "").replace("\\", "/").replace("//", "/")
        if rel.startswith("/"):
            rel = rel[1:]
        return (fs_root / rel).resolve()

    def fake_popen(args):
        popen_calls.append(args)

    monkeypatch.setattr(file_ops_module, "safe_join_fs_root", safe_join)
    monkeypatch.setattr(file_ops_module, "_is_wsl_runtime", lambda: False)
    monkeypatch.setattr(file_ops_module.sys, "platform", "win32")
    monkeypatch.setattr(file_ops_module.subprocess, "Popen", fake_popen)
    monkeypatch.setenv("WINDIR", str(tmp_path / "missing_windows"))

    client = app_module.app.test_client()
    response = client.post("/fs/open_in_explorer", json={"path": "set d/photo one.png"})

    assert response.status_code == 200
    assert response.get_json()["ok"] is True
    assert popen_calls == [["explorer.exe", "/select,", str(media_path.resolve())]]


def test_open_in_explorer_wsl_uses_select_comma_path(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs_root"
    media_path = fs_root / "set" / "photo.png"
    write_image(media_path)
    popen_calls = []

    def safe_join(rel_path):
        rel = str(rel_path or "").strip().replace("..", "").replace("\\", "/").replace("//", "/")
        if rel.startswith("/"):
            rel = rel[1:]
        return (fs_root / rel).resolve()

    def fake_popen(args):
        popen_calls.append(args)

    monkeypatch.setattr(file_ops_module, "safe_join_fs_root", safe_join)
    monkeypatch.setattr(file_ops_module, "_is_wsl_runtime", lambda: True)
    monkeypatch.setattr(file_ops_module.sys, "platform", "linux")
    monkeypatch.setattr(file_ops_module, "_to_windows_path", lambda path: "C:\\set\\photo.png")
    monkeypatch.setattr(file_ops_module, "_windows_explorer_exe", lambda: "C:\\Windows\\explorer.exe")
    monkeypatch.setattr(file_ops_module.subprocess, "Popen", fake_popen)

    client = app_module.app.test_client()
    response = client.post("/fs/open_in_explorer", json={"path": "set/photo.png"})

    assert response.status_code == 200
    assert popen_calls == [["C:\\Windows\\explorer.exe", "/select,C:\\set\\photo.png"]]


def test_open_in_vscode_opens_current_folder(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs_root"
    set_dir = fs_root / "set g"
    set_dir.mkdir(parents=True)
    calls = []

    def safe_join(rel_path):
        rel = str(rel_path or "").strip().replace("..", "").replace("\\", "/").replace("//", "/")
        if rel.startswith("/"):
            rel = rel[1:]
        return (fs_root / rel).resolve()

    def fake_popen(args):
        calls.append(args)

    monkeypatch.setattr(file_ops_module, "safe_join_fs_root", safe_join)
    monkeypatch.setattr(file_ops_module.shutil, "which", lambda name: "C:/bin/code.cmd" if name == "code" else None)
    monkeypatch.setattr(file_ops_module.subprocess, "Popen", fake_popen)

    client = app_module.app.test_client()
    response = client.post("/fs/open_in_vscode", json={"path": "set g"})

    assert response.status_code == 200
    assert response.get_json()["ok"] is True
    assert calls == [["C:/bin/code.cmd", str(set_dir.resolve())]]


def test_fs_describe_does_not_auto_create_config_files(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs_root"
    set_dir = fs_root / "set_e"
    set_dir.mkdir(parents=True)
    write_image(set_dir / "clip.png")

    def safe_join(rel_path):
        rel = str(rel_path or "").strip().replace("..", "").replace("\\", "/").replace("//", "/")
        if rel.startswith("/"):
            rel = rel[1:]
        return (fs_root / rel).resolve()

    monkeypatch.setattr(app_module, "safe_join_fs_root", safe_join)
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", fs_root)

    client = app_module.app.test_client()
    response = client.get("/fs/describe?path=set_e")

    assert response.status_code == 200
    assert not (set_dir / "config.hi.toml").exists()
    assert not (set_dir / "config.lo.toml").exists()
    assert not (set_dir / "dataset.hi.toml").exists()
    assert not (set_dir / "dataset.lo.toml").exists()


def test_generate_dataset_config_creates_missing_config_templates(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs_root"
    set_dir = fs_root / "set_f"
    auto_dataset = set_dir / "auto_dataset"
    set_dir.mkdir(parents=True)
    auto_dataset.mkdir(parents=True)
    write_image(set_dir / "clip.png")
    prepared_img_dir = auto_dataset / "square_img"
    prepared_img_dir.mkdir(parents=True)
    write_image(prepared_img_dir / "clip.png")
    write_text(prepared_img_dir / "clip.txt", "prepared caption")
    (auto_dataset / "prep_manifest.json").write_text(
        json.dumps(
            {
                "version": 1,
                "target_fps": 16,
                "videos": [],
                "images": [
                    {
                        "file": "clip.png",
                        "ar": "square",
                        "width": 512,
                        "height": 512,
                        "prepared_path": "square_img/clip.png",
                        "caption": True,
                    }
                ],
                "skipped": [],
                "selection": {
                    "mode": "all",
                    "selected_files": ["clip.png"],
                    "selected_count": 1,
                    "total_count": 1,
                    "criteria": {},
                },
            }
        ),
        encoding="utf-8",
    )

    def safe_join(rel_path):
        rel = str(rel_path or "").strip().replace("..", "").replace("\\", "/").replace("//", "/")
        if rel.startswith("/"):
            rel = rel[1:]
        return (fs_root / rel).resolve()

    monkeypatch.setattr(app_module, "safe_join_fs_root", safe_join)
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", fs_root)

    client = app_module.app.test_client()
    response = client.post("/fs/generate_dataset_config", json={"folder": "set_f"})

    assert response.status_code == 200
    assert (set_dir / "config.hi.toml").exists()
    assert (set_dir / "config.lo.toml").exists()


def test_generate_dataset_config_overwrites_existing_config_templates(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs_root"
    set_dir = fs_root / "set_g"
    auto_dataset = set_dir / "auto_dataset"
    set_dir.mkdir(parents=True)
    auto_dataset.mkdir(parents=True)
    write_image(set_dir / "clip.png")
    prepared_img_dir = auto_dataset / "square_img"
    prepared_img_dir.mkdir(parents=True)
    write_image(prepared_img_dir / "clip.png")
    write_text(prepared_img_dir / "clip.txt", "prepared caption")
    write_text(set_dir / "config.lo.toml", "corrupted config")
    write_text(set_dir / "config.hi.toml", "corrupted config")
    (auto_dataset / "prep_manifest.json").write_text(
        json.dumps(
            {
                "version": 1,
                "target_fps": 16,
                "videos": [],
                "images": [
                    {
                        "file": "clip.png",
                        "ar": "square",
                        "width": 512,
                        "height": 512,
                        "prepared_path": "square_img/clip.png",
                        "caption": True,
                    }
                ],
                "skipped": [],
                "selection": {
                    "mode": "all",
                    "selected_files": ["clip.png"],
                    "selected_count": 1,
                    "total_count": 1,
                    "criteria": {},
                },
            }
        ),
        encoding="utf-8",
    )

    def safe_join(rel_path):
        rel = str(rel_path or "").strip().replace("..", "").replace("\\", "/").replace("//", "/")
        if rel.startswith("/"):
            rel = rel[1:]
        return (fs_root / rel).resolve()

    monkeypatch.setattr(app_module, "safe_join_fs_root", safe_join)
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", fs_root)

    client = app_module.app.test_client()
    response = client.post("/fs/generate_dataset_config", json={"folder": "set_g"})

    assert response.status_code == 200
    hi_text = (set_dir / "config.hi.toml").read_text(encoding="utf-8")
    lo_text = (set_dir / "config.lo.toml").read_text(encoding="utf-8")
    assert "corrupted config" not in hi_text
    assert "corrupted config" not in lo_text
    assert 'output_dir = "' in hi_text
    assert 'output_dir = "' in lo_text


def test_generate_dataset_config_can_write_snapshot_comments_when_enabled(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs_root"
    set_dir = fs_root / "set_h"
    auto_dataset = set_dir / "auto_dataset"
    set_dir.mkdir(parents=True)
    auto_dataset.mkdir(parents=True)
    write_image(set_dir / "clip.png")
    prepared_img_dir = auto_dataset / "square_img"
    prepared_img_dir.mkdir(parents=True)
    write_image(prepared_img_dir / "clip.png")
    write_text(prepared_img_dir / "clip.txt", "prepared caption")
    (auto_dataset / "prep_manifest.json").write_text(
        json.dumps(
            {
                "version": 1,
                "target_fps": 16,
                "videos": [],
                "images": [
                    {
                        "file": "clip.png",
                        "ar": "square",
                        "width": 512,
                        "height": 512,
                        "prepared_path": "square_img/clip.png",
                        "caption": True,
                    }
                ],
                "skipped": [],
                "selection": {
                    "mode": "all",
                    "selected_files": ["clip.png"],
                    "selected_count": 1,
                    "total_count": 1,
                    "criteria": {},
                },
            }
        ),
        encoding="utf-8",
    )

    def safe_join(rel_path):
        rel = str(rel_path or "").strip().replace("..", "").replace("\\", "/").replace("//", "/")
        if rel.startswith("/"):
            rel = rel[1:]
        return (fs_root / rel).resolve()

    monkeypatch.setattr(app_module, "safe_join_fs_root", safe_join)
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", fs_root)
    monkeypatch.setattr(
        app_module.app_config,
        "config",
        {
            "training": {
                "mode": "normal",
                "write_selection_snapshot_comments": True,
            }
        },
    )

    client = app_module.app.test_client()
    response = client.post("/fs/generate_dataset_config", json={"folder": "set_h"})

    assert response.status_code == 200
    lo_text = (set_dir / "dataset.lo.toml").read_text(encoding="utf-8")
    assert "# --- webcap selection snapshot v1 ---" in lo_text
    assert "# snapshot.prepared_mode: all" in lo_text
    assert "# file: clip.png" in lo_text
    assert "enable_ar_bucket = true" in lo_text


def test_train_run_auto_generates_missing_configs(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs_root"
    set_dir = fs_root / "set_train"
    auto_dataset = set_dir / "auto_dataset"
    set_dir.mkdir(parents=True)
    auto_dataset.mkdir(parents=True)
    write_image(set_dir / "clip.png")
    prepared_img_dir = auto_dataset / "square_img"
    prepared_img_dir.mkdir(parents=True)
    write_image(prepared_img_dir / "clip.png")
    write_text(prepared_img_dir / "clip.txt", "prepared caption")
    (auto_dataset / "prep_manifest.json").write_text(
        json.dumps(
            {
                "version": 1,
                "target_fps": 16,
                "videos": [],
                "images": [
                    {
                        "file": "clip.png",
                        "ar": "square",
                        "width": 512,
                        "height": 512,
                        "prepared_path": "square_img/clip.png",
                        "caption": True,
                    }
                ],
                "skipped": [],
                "selection": {
                    "mode": "all",
                    "selected_files": ["clip.png"],
                    "selected_count": 1,
                    "total_count": 1,
                    "criteria": {},
                },
            }
        ),
        encoding="utf-8",
    )

    def safe_join(rel_path):
        rel = str(rel_path or "").strip().replace("..", "").replace("\\", "/").replace("//", "/")
        if rel.startswith("/"):
            rel = rel[1:]
        return (fs_root / rel).resolve()

    monkeypatch.setattr(run_ops_module.app_config, "safe_join_fs_root", safe_join)
    monkeypatch.setattr(run_ops_module.app_config, "FS_ROOT", fs_root)
    monkeypatch.setattr(run_ops_module.app_config, "config", {"training": {"mode": "normal"}})

    client = app_module.app.test_client()
    response = client.post("/fs/train_run", json={"folder": "set_train"})

    assert response.status_code == 200
    body = response.get_data(as_text=True)
    assert "[INFO] Training commands (copy/paste):" in body
    assert " ; " in body
    assert "pkill -f 'config\\.hi\\.toml'" in body
    assert (set_dir / "config.hi.toml").exists()
    assert (set_dir / "config.lo.toml").exists()
    assert (set_dir / "dataset.hi.toml").exists()
    assert (set_dir / "dataset.lo.toml").exists()


def test_smart_set_materialize_copies_media_originals_and_item_metadata(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs_root"
    set_a = fs_root / "set_a"
    set_b = fs_root / "set_b"
    set_a.mkdir(parents=True)
    set_b.mkdir(parents=True)

    write_image(set_a / "shared.png")
    write_text(set_a / "shared.txt", "a calm dragon pose")
    (set_a / "originals").mkdir(parents=True)
    write_image(set_a / "originals" / "shared.png")
    write_text(
        set_a / ".webcap_state.json",
        json.dumps(
            {
                "reviewedKeys": ["shared.png"],
                "flags": {"shared.png": "green"},
                "caption_tags_by_media": {"shared.png": ["dragon", "profile"]},
                "ratings_by_media": {"shared.png": 4},
                "caption_phrases": ["legacy phrase"],
                "caption_requirements": ["legacy requirement"],
            }
        ),
    )

    write_image(set_b / "shared.png")
    write_text(set_b / "shared.txt", "dragon from another set")
    (set_b / "originals").mkdir(parents=True)
    write_image(set_b / "originals" / "shared.png")
    write_text(
        set_b / ".webcap_state.json",
        json.dumps(
            {
                "reviewedKeys": ["shared.png"],
                "flags": {"shared.png": "red"},
                "caption_tags_by_media": {"shared.png": ["dragon", "alt"]},
                "ratings_by_media": {"shared.png": 5},
            }
        ),
    )

    monkeypatch.setattr(smart_set_module.app_config, "FS_ROOT", fs_root)

    client = app_module.app.test_client()
    dry_run = client.post("/fs/smart_set_materialize", json={"term": "dragon", "dry_run": True})
    assert dry_run.status_code == 200
    dry_payload = dry_run.get_json()
    assert dry_payload["match_count"] == 2
    assert dry_payload["suggested_set_name"].startswith("smart-dragon")

    response = client.post(
        "/fs/smart_set_materialize",
        json={"term": "dragon", "set_name": "dragon-mix", "dry_run": False},
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["copied_count"] == 2
    assert payload["originals_copied_count"] == 2

    out_dir = fs_root / payload["folder"]
    assert out_dir.exists() and out_dir.is_dir()
    assert len(payload["created_items"]) == 2
    dest_names = [item["dest_media_name"] for item in payload["created_items"]]
    assert len(dest_names) == len(set(dest_names))

    for dest_name in dest_names:
        assert (out_dir / dest_name).exists()
        assert (out_dir / f"{Path(dest_name).stem}.txt").exists()
        assert (out_dir / "originals" / dest_name).exists()

    out_state = json.loads((out_dir / ".webcap_state.json").read_text(encoding="utf-8"))
    assert sorted(out_state["reviewedKeys"]) == sorted(dest_names)
    assert sorted(out_state["flags"].keys()) == sorted(dest_names)
    assert sorted(out_state["caption_tags_by_media"].keys()) == sorted(dest_names)
    assert sorted(out_state["ratings_by_media"].keys()) == sorted(dest_names)
    assert out_state["stats"]["phrases"] == ""
    assert "caption_phrases" not in out_state


def test_create_set_from_results_copies_media_captions_and_originals(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs_root"
    source_dir = fs_root / "sets" / "a"
    source_dir.mkdir(parents=True)
    write_image(source_dir / "one.png")
    write_text(source_dir / "one.txt", "caption one")
    (source_dir / "originals").mkdir(parents=True)
    write_image(source_dir / "originals" / "one.png")
    write_text(
        source_dir / ".webcap_state.json",
        json.dumps(
            {
                "primer": {
                    "template": "{subject}\n{view}\n{lighting}",
                    "mappings": [{"scope": "tag", "token": "front", "key": "view", "value": "front view", "enabled": True}],
                },
                "reviewedKeys": ["one.png"],
                "flags": {"one.png": "blue"},
                "caption_tags_by_media": {"one.png": ["tag-a", "tag-b"]},
                "ratings_by_media": {"one.png": 5},
            }
        ),
    )
    write_text(
        source_dir / "media_metadata.json",
        json.dumps(
            {
                "one.png": {
                    "size": 123,
                    "mtime": 456,
                    "resolution": "128x128",
                    "aspect_ratio": "1:1",
                }
            }
        ),
    )

    monkeypatch.setattr(smart_set_module.app_config, "FS_ROOT", fs_root)
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", fs_root)

    client = app_module.app.test_client()
    response = client.post(
        "/fs/create_set_from_results",
        json={
            "destination_parent": "sets",
            "set_name": "result_set",
            "items": [{"source_media_rel": "sets/a/one.png"}],
        },
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["copied_count"] == 1
    assert payload["originals_copied_count"] == 1
    assert payload["folder"] == "sets/result_set"

    out_dir = fs_root / "sets" / "result_set"
    assert (out_dir / "one.png").exists()
    assert (out_dir / "one.txt").exists()
    assert (out_dir / "originals" / "one.png").exists()
    out_state = json.loads((out_dir / ".webcap_state.json").read_text(encoding="utf-8"))
    assert out_state["primer"]["template"] == "{subject}\n{view}\n{lighting}"
    assert out_state["primer"]["mappings"][0]["key"] == "view"
    assert out_state["reviewedKeys"] == ["one.png"]
    assert out_state["flags"] == {"one.png": "blue"}
    assert out_state["caption_tags_by_media"] == {"one.png": ["tag-a", "tag-b"]}
    assert out_state["ratings_by_media"] == {"one.png": 5}
    out_metadata = json.loads((out_dir / "media_metadata.json").read_text(encoding="utf-8"))
    assert out_metadata["one.png"]["resolution"] == "128x128"


def test_create_set_from_results_renames_on_filename_collision(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs_root"
    set_a = fs_root / "set_a"
    set_b = fs_root / "set_b"
    set_a.mkdir(parents=True)
    set_b.mkdir(parents=True)
    write_image(set_a / "shared.png")
    write_text(set_a / "shared.txt", "from a")
    write_image(set_b / "shared.png")
    write_text(set_b / "shared.txt", "from b")
    write_text(
        set_a / ".webcap_state.json",
        json.dumps(
            {
                "reviewedKeys": ["shared.png"],
                "flags": {"shared.png": "green"},
                "caption_tags_by_media": {"shared.png": ["from-a"]},
                "ratings_by_media": {"shared.png": 3},
            }
        ),
    )
    write_text(
        set_b / ".webcap_state.json",
        json.dumps(
            {
                "reviewedKeys": ["shared.png"],
                "flags": {"shared.png": "red"},
                "caption_tags_by_media": {"shared.png": ["from-b"]},
                "ratings_by_media": {"shared.png": 4},
            }
        ),
    )
    write_text(
        set_a / "media_metadata.json",
        json.dumps({"shared.png": {"resolution": "128x128", "codec": "a"}}),
    )
    write_text(
        set_b / "media_metadata.json",
        json.dumps({"shared.png": {"resolution": "128x128", "codec": "b"}}),
    )

    monkeypatch.setattr(smart_set_module.app_config, "FS_ROOT", fs_root)
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", fs_root)

    client = app_module.app.test_client()
    response = client.post(
        "/fs/create_set_from_results",
        json={
            "destination_parent": "/",
            "set_name": "result_set",
            "items": [
                {"source_media_rel": "set_a/shared.png"},
                {"source_media_rel": "set_b/shared.png"},
            ],
        },
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["copied_count"] == 2
    out_dir = fs_root / "result_set"
    assert (out_dir / "shared.png").exists()
    assert (out_dir / "shared_2.png").exists()
    assert (out_dir / "shared.txt").exists()
    assert (out_dir / "shared_2.txt").exists()
    out_state = json.loads((out_dir / ".webcap_state.json").read_text(encoding="utf-8"))
    assert sorted(out_state["reviewedKeys"]) == ["shared.png", "shared_2.png"]
    assert out_state["flags"] == {"shared.png": "green", "shared_2.png": "red"}
    assert out_state["caption_tags_by_media"] == {"shared.png": ["from-a"], "shared_2.png": ["from-b"]}
    assert out_state["ratings_by_media"] == {"shared.png": 3, "shared_2.png": 4}
    out_metadata = json.loads((out_dir / "media_metadata.json").read_text(encoding="utf-8"))
    assert out_metadata["shared.png"]["codec"] == "a"
    assert out_metadata["shared_2.png"]["codec"] == "b"


def test_create_set_from_results_blocks_existing_destination(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs_root"
    source_dir = fs_root / "sets" / "a"
    source_dir.mkdir(parents=True)
    write_image(source_dir / "one.png")
    (fs_root / "sets" / "result_set").mkdir(parents=True)

    monkeypatch.setattr(smart_set_module.app_config, "FS_ROOT", fs_root)
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", fs_root)

    client = app_module.app.test_client()
    response = client.post(
        "/fs/create_set_from_results",
        json={
            "destination_parent": "sets",
            "set_name": "result_set",
            "items": [{"source_media_rel": "sets/a/one.png"}],
        },
    )
    assert response.status_code == 409
