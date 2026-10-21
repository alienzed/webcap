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
