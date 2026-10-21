from pathlib import Path
from types import SimpleNamespace

import pytest

from tool.server import config as app_config
from tool.server import external_exports


def test_external_copy_preserves_source_and_avoids_collisions(tmp_path, monkeypatch):
    root = tmp_path / "sets"
    root.mkdir()
    monkeypatch.setattr(app_config, "FS_ROOT", root)
    src = tmp_path / "external"
    src.mkdir()
    (src / "image.jpg").write_bytes(b"original")
    (root / "set-one").mkdir()
    payload = {"path": str(src), "files": ["image.jpg"], "destination": "set-one"}
    first = external_exports.copy_media(payload)
    second = external_exports.copy_media(payload)
    assert [x["name"] for x in first["copied"]] == ["image.jpg"]
    assert [x["name"] for x in second["copied"]] == ["image-2.jpg"]
    assert (src / "image.jpg").read_bytes() == b"original"
    assert (root / "set-one" / "image.jpg").read_bytes() == b"original"
    assert (root / "set-one" / "image-2.jpg").read_bytes() == b"original"


def test_external_copy_creates_set(tmp_path, monkeypatch):
    root = tmp_path / "sets"
    root.mkdir()
    monkeypatch.setattr(app_config, "FS_ROOT", root)
    src = tmp_path / "outside"
    src.mkdir()
    (src / "photo.webp").write_bytes(b"photo")
    result = external_exports.copy_media({
        "path": str(src), "files": ["photo.webp"], "destination": "", "newSet": "new-set"
    })
    assert result["ok"]
    assert (root / "new-set" / "photo.webp").read_bytes() == b"photo"


@pytest.mark.parametrize("destination", ["../other", "/tmp", "set/../../other"])
def test_destinations_cannot_escape_root(tmp_path, monkeypatch, destination):
    monkeypatch.setattr(app_config, "FS_ROOT", tmp_path)
    with pytest.raises(ValueError):
        external_exports._safe_destination_dir(destination)


def test_clip_exports_to_set_without_touching_source(tmp_path, monkeypatch):
    root = tmp_path / "sets"
    root.mkdir()
    dest = root / "set-one"
    dest.mkdir()
    monkeypatch.setattr(app_config, "FS_ROOT", root)
    source = tmp_path / "outside"
    source.mkdir()
    (source / "video.mp4").write_bytes(b"source")
    def fake_run(cmd, **kwargs):
        Path(cmd[-1]).write_bytes(b"clip")
        return SimpleNamespace(returncode=0, stderr="", stdout="")
    monkeypatch.setattr(external_exports.subprocess, "run", fake_run)
    result = external_exports.export_clip({
        "path": str(source), "files": ["video.mp4"], "destination": "set-one",
        "start": 1, "duration": 2
    })
    assert result["clip"] == "video_clip.mp4"
    assert (dest / "video_clip.mp4").read_bytes() == b"clip"
    assert (source / "video.mp4").read_bytes() == b"source"
