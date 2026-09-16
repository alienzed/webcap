from pathlib import Path

import pytest

import tool.server.originals as originals_module


def test_ensure_canonical_exists_copies_new_original(tmp_path):
    source = tmp_path / "clip.mp4"
    originals_dir = tmp_path / "originals"
    source.write_bytes(b"source-media")
    originals_dir.mkdir()

    canonical = originals_module.ensure_canonical_exists(source, originals_dir)

    assert canonical == originals_dir / "clip.mp4"
    assert canonical.read_bytes() == b"source-media"


def test_ensure_canonical_exists_cleans_partial_destination_and_reraises(tmp_path, monkeypatch):
    source = tmp_path / "clip.mp4"
    originals_dir = tmp_path / "originals"
    source.write_bytes(b"source-media")
    originals_dir.mkdir()
    canonical = originals_dir / source.name

    def partial_copy(_source, destination, *args, **kwargs):
        Path(destination).write_bytes(b"")
        raise OSError("No space left on device")

    monkeypatch.setattr(originals_module.shutil, "copy2", partial_copy)

    with pytest.raises(OSError, match="No space left on device"):
        originals_module.ensure_canonical_exists(source, originals_dir)

    assert not canonical.exists()


def test_ensure_canonical_exists_can_retry_after_failed_copy(tmp_path, monkeypatch):
    source = tmp_path / "clip.mp4"
    originals_dir = tmp_path / "originals"
    source.write_bytes(b"source-media")
    originals_dir.mkdir()
    canonical = originals_dir / source.name
    real_copy2 = originals_module.shutil.copy2
    attempts = {"count": 0}

    def fail_once(_source, destination, *args, **kwargs):
        attempts["count"] += 1
        if attempts["count"] == 1:
            Path(destination).write_bytes(b"")
            raise OSError("No space left on device")
        return real_copy2(_source, destination, *args, **kwargs)

    monkeypatch.setattr(originals_module.shutil, "copy2", fail_once)

    with pytest.raises(OSError, match="No space left on device"):
        originals_module.ensure_canonical_exists(source, originals_dir)
    assert not canonical.exists()

    assert originals_module.ensure_canonical_exists(source, originals_dir) == canonical
    assert canonical.read_bytes() == b"source-media"


def test_ensure_canonical_exists_keeps_valid_existing_baseline(tmp_path):
    source = tmp_path / "clip.mp4"
    originals_dir = tmp_path / "originals"
    source.write_bytes(b"working-media")
    originals_dir.mkdir()
    canonical = originals_dir / source.name
    canonical.write_bytes(b"immutable-baseline")

    assert originals_module.ensure_canonical_exists(source, originals_dir) == canonical
    assert canonical.read_bytes() == b"immutable-baseline"


def test_ensure_canonical_exists_rejects_empty_existing_baseline_without_repair(tmp_path):
    source = tmp_path / "clip.mp4"
    originals_dir = tmp_path / "originals"
    source.write_bytes(b"working-media")
    originals_dir.mkdir()
    canonical = originals_dir / source.name
    canonical.write_bytes(b"")

    with pytest.raises(ValueError, match="Original backup is empty"):
        originals_module.ensure_canonical_exists(source, originals_dir)

    assert canonical.read_bytes() == b""


def test_ensure_canonical_exists_rejects_non_file_existing_baseline(tmp_path):
    source = tmp_path / "clip.mp4"
    originals_dir = tmp_path / "originals"
    source.write_bytes(b"working-media")
    originals_dir.mkdir()
    canonical = originals_dir / source.name
    canonical.mkdir()

    with pytest.raises(ValueError, match="not a regular file"):
        originals_module.ensure_canonical_exists(source, originals_dir)

    assert canonical.is_dir()
