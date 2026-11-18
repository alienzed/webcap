import json
import time

from tool.server import external_media


def _file(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"test-media")
    return path


def test_recursive_discovery_and_source_local_metadata(tmp_path):
    source = tmp_path / "another-disk"
    first = _file(source / "a" / "one.mp4")
    second = _file(source / "b" / "one.png")
    details = {"size": first.stat().st_size, "mtime": int(first.stat().st_mtime),
               "resolution": "1920x1080", "duration": 10.0}
    (first.parent / "media_metadata.json").write_text(json.dumps({"one.mp4": details}), encoding="utf-8")
    snapshot = external_media._ensure_index(str(source))
    for _ in range(200):
        if snapshot["complete"]:
            break
        time.sleep(0.01)
    assert snapshot["complete"] and not snapshot["error"]
    assert {i["relativePath"] for i in snapshot["items"]} == {"a/one.mp4", "b/one.png"}
    results = external_media._query_items(snapshot, {"sort": "path", "min_side": "1080"})
    assert [i["relativePath"] for i in results] == ["a/one.mp4"]
    assert second.read_bytes() == b"test-media"


def test_filters_ignore_unknown_metadata_and_support_paths(tmp_path):
    root = tmp_path / "nested"
    _file(root / "left" / "beach.png")
    _file(root / "right" / "beach.mp4")
    snapshot = external_media._ensure_index(str(root))
    for _ in range(200):
        if snapshot["complete"]:
            break
        time.sleep(0.01)
    assert len(external_media._query_items(snapshot, {"search": "left beach", "sort": "path"})) == 1
    assert not external_media._query_items(snapshot, {"min_mp": "1", "sort": "newest"})


def test_path_validation_rejects_escape(tmp_path):
    root = tmp_path / "source"
    _file(root / "safe.png")
    _file(tmp_path / "elsewhere.png")
    for candidate in ("../elsewhere.png", "/elsewhere.png", "missing.mp4"):
        try:
            external_media._source_file(root.resolve(), candidate)
        except ValueError:
            pass
        else:
            raise AssertionError("Path should be rejected: " + candidate)


def _finished_snapshot(root):
    snapshot = external_media._ensure_index(str(root), refresh=True)
    for _ in range(300):
        if snapshot["complete"]:
            break
        time.sleep(0.01)
    assert snapshot["complete"] and not snapshot["error"]
    return snapshot


def _job(snapshot, paths):
    import threading
    from collections import deque
    return {"snapshot": snapshot, "pending": deque(paths), "seen": set(paths),
            "total": len(paths), "completed": 0, "failed": 0, "uncached": 0,
            "running": True, "canceled": False, "current": "",
            "lastError": "", "cancel": threading.Event()}


def _probe(path):
    stat = path.stat()
    return {"size": stat.st_size, "mtime": int(stat.st_mtime),
            "resolution": "1920x1080",
            **({"duration": 12.5} if path.suffix == ".mp4" else {})}


def test_refresh_detects_media_added_and_removed(tmp_path):
    root = tmp_path / "refresh"
    first = _file(root / "first.png")
    snapshot = _finished_snapshot(root)
    assert [item["fileName"] for item in snapshot["items"]] == ["first.png"]
    first.unlink()
    _file(root / "second.mp4")
    assert external_media._ensure_index(str(root)) is snapshot
    refreshed = _finished_snapshot(root)
    assert refreshed is not snapshot
    assert [item["fileName"] for item in refreshed["items"]] == ["second.mp4"]


def test_malformed_cache_does_not_hide_media(tmp_path):
    root = tmp_path / "malformed"
    _file(root / "demo.png")
    (root / "media_metadata.json").write_text("{malformed", encoding="utf-8")
    snapshot = _finished_snapshot(root)
    assert [item["fileName"] for item in snapshot["items"]] == ["demo.png"]
    assert snapshot["warnings"] == 1 and "media_metadata" in snapshot["lastWarning"]


def test_technical_scan_batches_writes_and_preserves_analysis(tmp_path, monkeypatch):
    from tool.server import media
    root = tmp_path / "batch"
    files = [_file(root / ("item-%02d.png" % index)) for index in range(7)]
    cached = {"size": files[0].stat().st_size,
              "mtime": int(files[0].stat().st_mtime),
              "scene_complexity": {"bucket": "high", "version": 2}}
    (root / "media_metadata.json").write_text(
        json.dumps({files[0].name: cached}), encoding="utf-8")
    snapshot = _finished_snapshot(root)
    monkeypatch.setattr(external_media, "_technical_probe", _probe)
    real_merge = media.merge_technical_media_metadata
    calls = []

    def counted(folder, entries):
        calls.append((folder, len(entries)))
        return real_merge(folder, entries)

    monkeypatch.setattr(external_media, "merge_technical_media_metadata", counted)
    job = _job(snapshot, [item["relativePath"] for item in snapshot["items"]])
    external_media._metadata_worker(snapshot, job)
    assert job["completed"] == 7 and job["failed"] == 0 and job["uncached"] == 0
    assert calls == [(root, 7)]
    metadata = json.loads((root / "media_metadata.json").read_text(encoding="utf-8"))
    assert len(metadata) == 7
    assert metadata[files[0].name]["scene_complexity"] == cached["scene_complexity"]
    assert all(p.read_bytes() == b"test-media" for p in files)
    assert all(item["metadataCached"] for item in snapshot["items"])


def test_failed_cache_write_retains_analyzed_results(tmp_path, monkeypatch):
    root = tmp_path / "readonly"
    _file(root / "movie.mp4")
    snapshot = _finished_snapshot(root)
    monkeypatch.setattr(external_media, "_technical_probe", _probe)

    def inaccessible(*args):
        raise PermissionError("read-only source")

    monkeypatch.setattr(external_media, "merge_technical_media_metadata", inaccessible)
    job = _job(snapshot, ["movie.mp4"])
    external_media._metadata_worker(snapshot, job)
    assert job["failed"] == 0 and job["uncached"] == 1
    assert "read-only source" in job["lastError"]
    assert snapshot["items"][0]["metadata"]["resolution"] == "1920x1080"
    assert not snapshot["items"][0].get("metadataCached")
    assert not (root / "media_metadata.json").exists()


def test_cancel_does_not_probe_unstarted_files(tmp_path, monkeypatch):
    root = tmp_path / "cancel"
    _file(root / "item.png")
    snapshot = _finished_snapshot(root)
    job = _job(snapshot, ["item.png"])
    job["cancel"].set()
    monkeypatch.setattr(external_media, "_technical_probe",
                        lambda p: (_ for _ in ()).throw(AssertionError("should not probe")))
    external_media._metadata_worker(snapshot, job)
    assert job["completed"] == 0 and job["canceled"] and not job["running"]


def test_invalid_cached_dimensions_excluded_not_fatal(tmp_path):
    root = tmp_path / "bad-dimensions"
    item = _file(root / "old.png")
    cached = {"size": item.stat().st_size,
              "mtime": int(item.stat().st_mtime), "resolution": "not dimensions"}
    (root / "media_metadata.json").write_text(json.dumps({"old.png": cached}))
    snapshot = _finished_snapshot(root)
    assert not external_media._query_items(snapshot, {"min_mp": "2.0"})
    assert external_media._query_items(snapshot, {"sort": "megapixels"})[0]["fileName"] == "old.png"


def test_symlinks_cannot_escape_source_root(tmp_path):
    root = tmp_path / "media-root"
    root.mkdir()
    outside = _file(tmp_path / "outside.png")
    link = root / "linked.png"
    try:
        link.symlink_to(outside)
    except (OSError, NotImplementedError):
        import pytest
        pytest.skip("Symlinks unavailable on this filesystem.")
    snapshot = _finished_snapshot(root)
    assert not snapshot["items"]
    try:
        external_media._source_file(root.resolve(), "linked.png")
    except ValueError:
        pass
    else:
        raise AssertionError("Symlink escaped external media source root.")


def test_external_item_ids_are_unique_across_roots(tmp_path):
    root_one = tmp_path / "one"
    root_two = tmp_path / "two"
    _file(root_one / "same.png")
    _file(root_two / "same.png")
    first = _finished_snapshot(root_one)["items"][0]
    second = _finished_snapshot(root_two)["items"][0]
    assert first["id"] != second["id"]


def test_list_items_only_expose_technical_metadata(tmp_path):
    root = tmp_path / "cached"
    image = _file(root / "portrait.jpg")
    metadata = {
        "size": image.stat().st_size,
        "mtime": int(image.stat().st_mtime),
        "resolution": "1920x1080",
        "vision_sight": {"raw": "x" * 50000},
        "scene_complexity": {"bucket": "high"},
    }
    (root / "media_metadata.json").write_text(json.dumps({"portrait.jpg": metadata}))
    indexed = _finished_snapshot(root)["items"][0]
    assert indexed["metadata"]["resolution"] == "1920x1080"
    assert not any(key in indexed["metadata"] for key in ("vision_sight", "scene_complexity"))


def test_directory_scope_recursion_and_sorting(tmp_path):
    root = tmp_path / "library"
    _file(root / "root.jpg")
    _file(root / "nested" / "child.jpg")
    _file(root / "nested" / "deeper" / "grandchild.jpg")
    snapshot = _finished_snapshot(root)
    assert external_media._child_directories(snapshot, "") == ["nested"]
    assert external_media._child_directories(snapshot, "nested") == ["deeper"]
    assert [i["fileName"] for i in external_media._query_items(
        snapshot, {"directory": "", "sort": "name"})] == ["root.jpg"]
    assert [i["fileName"] for i in external_media._query_items(
        snapshot, {"directory": "nested", "sort": "name"})] == ["child.jpg"]
    assert len(external_media._query_items(
        snapshot, {"directory": "", "recursive": "1"})) == 3
    assert len(external_media._query_items(snapshot, {})) == 3
    assert [i["fileName"] for i in external_media._query_items(
        snapshot, {"directory": "", "recursive": "1", "sort": "size"})] == [
        "child.jpg", "grandchild.jpg", "root.jpg"]
    assert [i["fileName"] for i in external_media._query_items(
        snapshot, {"directory": "", "recursive": "1", "sort": "name", "direction": "asc"})] == [
        "root.jpg", "grandchild.jpg", "child.jpg"]


def test_external_directory_does_not_escape_root(tmp_path):
    root = tmp_path / "root"
    _file(root / "safe.jpg")
    snapshot = _finished_snapshot(root)
    for value in ("../", "../../outside", "/../../", "nested/../"):
        try:
            external_media._child_directories(snapshot, value)
        except ValueError:
            pass
        else:
            raise AssertionError("Directory escaped root or accepted traversal: " + value)


def test_external_endpoint_lists_immediate_folders_even_with_zero_files(tmp_path):
    from flask import Flask

    root = tmp_path / "browse"
    _file(root / "top.jpg")
    _file(root / "subfolder" / "child.jpg")
    (root / "empty").mkdir()
    _finished_snapshot(root)
    app = Flask(__name__)
    external_media.register_routes(app)
    response = app.test_client().get("/fs/media_explorer/external", query_string={
        "path": str(root), "directory": "", "sort": "name"
    })
    assert response.status_code == 200
    data = response.get_json()
    assert data["folders"] == ["empty", "subfolder"]
    assert [item["fileName"] for item in data["items"]] == ["top.jpg"]
    response = app.test_client().get("/fs/media_explorer/external", query_string={
        "path": str(root), "directory": "subfolder"
    })
    assert response.status_code == 200
    assert [item["relativePath"] for item in response.get_json()["items"]] == ["subfolder/child.jpg"]


def test_external_file_move_stays_under_root_and_refuses_collisions(tmp_path):
    root = tmp_path / "source"
    source = _file(root / "one.png")
    (root / "other").mkdir()
    result = external_media.move_external_files({
        "path": str(root), "files": ["one.png"], "destination": "other"
    })
    assert result["moved"] == ["one.png"]
    assert not source.exists()
    assert (root / "other" / "one.png").exists()
    import pytest
    with pytest.raises(ValueError, match="already contains"):
        external_media.move_external_files({
            "path": str(root), "files": ["other/one.png"], "destination": "other"
        })
    with pytest.raises(ValueError, match="inside the external root"):
        external_media.move_external_files({
            "path": str(root), "files": ["other/one.png"], "destination": "../outside"
        })


def test_move_keeps_caption_backup_and_analysis_with_media(tmp_path):
    root = tmp_path / "external"
    image = _file(root / "input" / "photo.png")
    (root / "input" / "photo.txt").write_text("caption")
    _file(root / "input" / "originals" / "photo.png")
    (root / "input" / "originals" / "photo.txt").write_text("original caption")
    (root / "input" / "media_metadata.json").write_text(
        json.dumps({"photo.png": {"analysis": {"scene": "retained"}}}))
    (root / "output").mkdir(parents=True)
    (root / "output" / "media_metadata.json").write_text(
        json.dumps({"untouched.png": {"custom": True}}))
    moved = external_media.move_external_files({
        "path": str(root), "files": ["input/photo.png"], "destination": "output"
    })
    assert moved == {"ok": True, "moved": ["input/photo.png"]}
    assert not image.exists()
    assert not (root / "input" / "photo.txt").exists()
    assert not (root / "input" / "originals" / "photo.png").exists()
    assert (root / "output" / "photo.png").exists()
    assert (root / "output" / "photo.txt").read_text() == "caption"
    assert (root / "output" / "originals" / "photo.png").exists()
    assert (root / "output" / "originals" / "photo.txt").read_text() == "original caption"
    old_cache = json.loads((root / "input" / "media_metadata.json").read_text())
    new_cache = json.loads((root / "output" / "media_metadata.json").read_text())
    assert "photo.png" not in old_cache
    assert new_cache["photo.png"]["analysis"]["scene"] == "retained"
    assert new_cache["untouched.png"]["custom"] is True


def test_move_companion_collision_is_preflighted_without_partial_mutation(tmp_path):
    import pytest
    root = tmp_path / "source"
    image = _file(root / "input" / "photo.png")
    (root / "input" / "photo.txt").write_text("retain me")
    (root / "target").mkdir()
    (root / "target" / "photo.txt").write_text("existing")
    with pytest.raises(ValueError, match="already contains"):
        external_media.move_external_files({
            "path": str(root), "files": ["input/photo.png"], "destination": "target"
        })
    assert image.exists()
    assert (root / "input" / "photo.txt").read_text() == "retain me"
    assert (root / "target" / "photo.txt").read_text() == "existing"
    assert not (root / "target" / "photo.png").exists()


def test_external_rename_preserves_media_and_metadata_and_refuses_collision(tmp_path):
    import pytest
    root = tmp_path / "external"
    original = _file(root / "shots" / "old.png")
    existing = _file(root / "shots" / "taken.png")
    caption = (root / "shots" / "old.txt")
    caption.write_text("original caption")
    originals = root / "shots" / "originals"
    originals.mkdir()
    (originals / "old.png").write_bytes(b"backup")
    cache = original.parent / "media_metadata.json"
    cache.write_text(json.dumps({"old.png": {"resolution": "640x480",
                            "analysis": {"caption": "keep"}}, "taken.png": {"resolution": "12x12"}}))
    result = external_media.rename_external_file({
        "path": str(root), "file": "shots/old.png", "newName": "new.png"
    })
    assert result == {"ok": True, "oldPath": "shots/old.png", "newPath": "shots/new.png"}
    assert not original.exists() and (root / "shots" / "new.png").read_bytes() == b"test-media"
    assert not caption.exists() and (root / "shots" / "new.txt").read_text() == "original caption"
    assert not (originals / "old.png").exists() and (originals / "new.png").read_bytes() == b"backup"
    updated = json.loads(cache.read_text())
    assert "old.png" not in updated and updated["new.png"]["analysis"]["caption"] == "keep"
    assert existing.exists()
    with pytest.raises(ValueError, match="already exists"):
        external_media.rename_external_file({
            "path": str(root), "file": "shots/new.png", "newName": "taken.png"})
    for target in ("../escape.png", "nested/nope.png", "wrong.jpg"):
        with pytest.raises(ValueError, match="filename"):
            external_media.rename_external_file({
                "path": str(root), "file": "shots/new.png", "newName": target})
    assert (root / "shots" / "new.png").exists()


def test_external_image_edit_reuses_originals_and_keeps_video_source_untouched(tmp_path):
    import base64
    from io import BytesIO
    from PIL import Image
    import pytest
    root = tmp_path / "gallery"
    root.mkdir()
    image = root / "photo.png"
    Image.new("RGB", (18, 12), "red").save(image)
    result = external_media.edit_external_image({
        "path": str(root), "file": "photo.png", "operation": "rotate_right_90"
    })
    assert result["ok"] and result["width"] == 12 and result["height"] == 18
    assert Image.open(image).size == (12, 18)
    assert list((root / "originals").iterdir()), "Prep's original backup must be retained"
    crop = BytesIO()
    Image.new("RGB", (8, 6), "blue").save(crop, format="PNG")
    result = external_media.edit_external_image({
        "path": str(root), "file": "photo.png", "operation": "crop",
        "imageDataUrl": "data:image/png;base64," + base64.b64encode(crop.getvalue()).decode()
    })
    assert result["ok"] and Image.open(image).size == (8, 6)
    video = _file(root / "clip.mp4")
    with pytest.raises(ValueError, match="cannot be edited"):
        external_media.edit_external_image({
            "path": str(root), "file": "clip.mp4", "operation": "crop",
            "imageDataUrl": "data:image/png;base64," + base64.b64encode(crop.getvalue()).decode()
        })
    assert video.read_bytes() == b"test-media"


def test_external_media_rename_and_edit_routes(tmp_path):
    from flask import Flask
    root = tmp_path / "source"
    _file(root / "first.jpg")
    app = Flask(__name__)
    external_media.register_routes(app)
    client = app.test_client()
    renamed = client.post("/fs/media_explorer/external/rename", json={
        "path": str(root), "file": "first.jpg", "newName": "second.jpg"
    })
    assert renamed.status_code == 200 and renamed.json["newPath"] == "second.jpg"
    denied = client.post("/fs/media_explorer/external/image-edit", json={
        "path": str(root), "file": "../outside.jpg", "operation": "flip_horizontal"
    })
    assert denied.status_code == 400 and not denied.json["ok"]


def test_external_trash_uses_system_trash_not_permanent_delete(tmp_path, monkeypatch):
    root = tmp_path / "source"
    _file(root / "one.png")
    snapshot = _finished_snapshot(root)
    old_entry = snapshot["items"][0]
    before_revision = snapshot["revision"]
    trash = tmp_path / "recycle"
    trash.mkdir()
    calls = []
    def fake_send2trash(path):
        from pathlib import Path
        calls.append(path)
        Path(path).rename(trash / Path(path).name)
    import send2trash
    monkeypatch.setattr(send2trash, "send2trash", fake_send2trash)
    result = external_media.trash_external_files({"path": str(root), "files": ["one.png"]})
    assert result["trashed"] == ["one.png"]
    assert result["revision"] > before_revision
    assert len(calls) == 1 and (trash / "one.png").exists()
    assert not (root / "one.png").exists()
    assert snapshot["items"] == [] and snapshot["by_path"] == {}
    # Discovery may already have collected this file before it was trashed.
    external_media._publish(snapshot, [old_entry])
    assert snapshot["items"] == [], "late discovery must not resurrect trashed media"


def test_recent_external_folders_survive_restart_and_support_forget(tmp_path, monkeypatch):
    monkeypatch.setattr(external_media.app_config, "app_state_root", lambda: tmp_path / "state")
    first = tmp_path / "first"
    second = tmp_path / "second"
    first.mkdir()
    second.mkdir()
    assert external_media._recent_paths() == []
    assert external_media.remember_external_path(str(first)) == [str(first)]
    assert external_media.remember_external_path(str(second)) == [str(second), str(first)]
    assert external_media.remember_external_path(str(first)) == [str(first), str(second)]
    assert external_media._recent_paths() == [str(first), str(second)]
    assert external_media.remove_external_path(str(first)) == [str(second)]
    assert external_media._recent_paths() == [str(second)]
    assert external_media._index is None or "items" in external_media._index
    assert external_media._recent_paths_file().parent == tmp_path / "state"


def test_recent_external_folders_do_not_save_invalid_paths(tmp_path, monkeypatch):
    monkeypatch.setattr(external_media.app_config, "app_state_root", lambda: tmp_path / "state")
    try:
        external_media.remember_external_path(str(tmp_path / "missing"))
    except ValueError:
        pass
    else:
        raise AssertionError("Missing directory must fail without saving it")
    assert external_media._recent_paths() == []


def test_create_folder_inside_external_root(tmp_path):
    root = tmp_path / "library"
    (root / "existing").mkdir(parents=True)
    result = external_media.create_external_folder({
        "path": str(root), "directory": "existing", "name": "Curated"})
    assert result == {"ok": True, "folder": "existing/Curated"}
    assert (root / "existing" / "Curated").is_dir()


def test_create_folder_rejects_escape_collisions_and_missing_parent(tmp_path):
    import pytest
    root = tmp_path / "library"
    root.mkdir()
    (root / "taken").mkdir()
    for directory, name in [
        ("", "../outside"), ("", "/absolute"), ("", "taken"),
        ("missing", "new"), ("../", "outside"), ("", "."),
        ("", "nested/child"), ("", "nested\\\\child"),
    ]:
        with pytest.raises(ValueError):
            external_media.create_external_folder({
                "path": str(root), "directory": directory, "name": name})
    assert not (tmp_path / "outside").exists()


def test_external_curation_persists_and_filters_after_move_and_rename(tmp_path):
    root = tmp_path / "library"
    source = _file(root / "incoming" / "frame.png")
    (root / "selected").mkdir()
    saved = external_media.curate_external_file({
        "path": str(root), "file": "incoming/frame.png",
        "rating": 4, "tags": ["portrait", "favorite"]})
    assert saved == {"ok": True, "rating": 4, "tags": ["portrait", "favorite"]}
    snapshot = _finished_snapshot(root)
    result = external_media._query_items(snapshot, {
        "recursive": "1", "tag": "portrait", "rating": "4"})
    assert [item["relativePath"] for item in result] == ["incoming/frame.png"]
    assert len(external_media._query_items(snapshot, {
        "recursive": "1", "search": "favorite"})) == 1
    external_media.move_external_files({
        "path": str(root), "files": ["incoming/frame.png"], "destination": "selected"})
    external_media.rename_external_file({
        "path": str(root), "file": "selected/frame.png", "newName": "frame2.png"})
    cache = json.loads((root / "selected" / "media_metadata.json").read_text())
    assert cache["frame2.png"]["rating"] == 4
    assert cache["frame2.png"]["tags"] == ["portrait", "favorite"]
    assert source.exists() is False


def test_external_curation_rejects_invalid_rating_and_tags(tmp_path):
    import pytest
    root = tmp_path / "library"
    _file(root / "frame.png")
    for payload in [{"rating": 6}, {"rating": True}, {"tags": [""]},
                    {"tags": ["x" * 65]}, {"tags": "portrait"}]:
        with pytest.raises(ValueError):
            external_media.curate_external_file({
                "path": str(root), "file": "frame.png", **payload})


def test_folder_rename_retains_media_and_authored_metadata(tmp_path):
    root = tmp_path / "library"
    _file(root / "portraits" / "face.png")
    external_media.curate_external_file({
        "path": str(root), "file": "portraits/face.png",
        "rating": 5, "tags": ["keeper"]})
    response = external_media.rename_external_folder({
        "path": str(root), "folder": "portraits", "name": "favorites"})
    assert response == {"ok": True, "folder": "favorites"}
    assert (root / "favorites" / "face.png").exists()
    cache = json.loads((root / "favorites" / "media_metadata.json").read_text())
    assert cache["face.png"]["tags"] == ["keeper"]
    assert cache["face.png"]["rating"] == 5


def test_folder_rename_rejects_escape_collision_and_symlinks(tmp_path):
    import pytest
    root = tmp_path / "library"
    (root / "first").mkdir(parents=True)
    (root / "taken").mkdir()
    for folder, name in [
        ("", "new"), ("../library", "new"), ("first", "../escape"),
        ("first", "taken"), ("first", "/absolute")
    ]:
        with pytest.raises(ValueError):
            external_media.rename_external_folder({
                "path": str(root), "folder": folder, "name": name})
    (root / "linked").symlink_to(root / "first", target_is_directory=True)
    with pytest.raises(ValueError):
        external_media.rename_external_folder({
            "path": str(root), "folder": "linked", "name": "other"})


def test_move_folder_keeps_companions_and_rejects_recursive_target(tmp_path):
    import pytest
    root = tmp_path / "library"
    _file(root / "source" / "clip.mp4")
    _file(root / "source" / "originals" / "clip.mp4")
    (root / "destination").mkdir(parents=True)
    external_media.curate_external_file({
        "path": str(root), "file": "source/clip.mp4",
        "tags": ["training"], "rating": 3})
    with pytest.raises(ValueError):
        external_media.move_external_folder({
            "path": str(root), "folder": "source", "destination": "source/originals"})
    response = external_media.move_external_folder({
        "path": str(root), "folder": "source", "destination": "destination"})
    assert response["folder"] == "destination/source"
    assert (root / "destination" / "source" / "clip.mp4").exists()
    assert (root / "destination" / "source" / "originals" / "clip.mp4").exists()
    metadata = json.loads((root / "destination" / "source" / "media_metadata.json").read_text())
    assert metadata["clip.mp4"]["tags"] == ["training"]
    with pytest.raises(ValueError):
        external_media.move_external_folder({
            "path": str(root), "folder": "destination/source", "destination": "destination"})


def test_named_saved_views_persist_without_mutating_media(tmp_path, monkeypatch):
    monkeypatch.setattr(external_media.app_config, "app_state_root",
                        lambda: tmp_path / "state")
    first = external_media.save_media_view({
        "name": "Best clips",
        "filters": {"source": "external", "tag": "keeper", "rating": "4",
                    "search": "clip", "recursive": True}})
    assert [item["name"] for item in first] == ["Best clips"]
    assert external_media.list_saved_views()[0]["filters"]["rating"] == "4"
    external_media.save_media_view({
        "name": "best clips", "filters": {"source": "generate", "rating": "5"}})
    assert len(external_media.list_saved_views()) == 1
    assert external_media.list_saved_views()[0]["filters"]["source"] == "generate"
    assert external_media.delete_media_view("BEST CLIPS") == []
    assert external_media.list_saved_views() == []


def test_named_saved_views_validate_names_filters_and_delete(tmp_path, monkeypatch):
    import pytest
    monkeypatch.setattr(external_media.app_config, "app_state_root",
                        lambda: tmp_path / "state")
    for payload in [
        {"name": "", "filters": {}},
        {"name": "bad", "filters": {"unexpected": "value"}},
        {"name": "bad", "filters": {"search": 42}},
        {"name": "bad", "filters": {"tag": "a" * 1025}},
    ]:
        with pytest.raises(ValueError):
            external_media.save_media_view(payload)
    with pytest.raises(ValueError):
        external_media.delete_media_view("unknown")


def test_trash_subfolder_uses_system_trash_and_preserves_contents(tmp_path, monkeypatch):
    import send2trash
    root = tmp_path / "library"
    _file(root / "nested" / "image.png")
    _file(root / "nested" / "originals" / "image.png")
    recycle = tmp_path / "recycle"
    recycle.mkdir()
    monkeypatch.setattr(send2trash, "send2trash",
                        lambda path: __import__("pathlib").Path(path).rename(recycle / "nested"))
    result = external_media.trash_external_folder({
        "path": str(root), "folder": "nested"})
    assert result == {"ok": True, "folder": "nested"}
    assert (recycle / "nested" / "image.png").is_file()
    assert (recycle / "nested" / "originals" / "image.png").is_file()
    assert root.exists() and not (root / "nested").exists()


def test_trash_subfolder_rejects_root_escape_and_symlink(tmp_path, monkeypatch):
    import pytest
    root = tmp_path / "library"
    (root / "sub").mkdir(parents=True)
    (root / "linked").symlink_to(root / "sub", target_is_directory=True)
    for folder in ("", ".", "..", "../elsewhere", "linked", "missing"):
        with pytest.raises(ValueError):
            external_media.trash_external_folder({"path": str(root), "folder": folder})
    assert (root / "sub").exists()


def test_saved_view_rename_preserves_tag_identity_and_filters(tmp_path, monkeypatch):
    import pytest
    monkeypatch.setattr(external_media.app_config, "app_state_root", lambda: tmp_path / "state")
    external_media.save_media_view({"name": "Collection: Old",
                                   "filters": {"tag": "Collection · Old", "source": ""}})
    external_media.save_media_view({"name": "Other", "filters": {"search": "abc"}})
    entries = external_media.rename_media_view({
        "name": "Collection: Old", "newName": "Collection: New"})
    assert [entry["name"] for entry in entries] == ["Collection: New", "Other"]
    assert entries[0]["filters"]["tag"] == "Collection · Old"
    with pytest.raises(ValueError):
        external_media.rename_media_view({"name": "Collection: New", "newName": "Other"})
    with pytest.raises(ValueError):
        external_media.rename_media_view({"name": "Missing", "newName": "New"})
