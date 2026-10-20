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
