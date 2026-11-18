"""Read-only-source Media Explorer exports into Sets (separate from Prep state)."""
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from flask import jsonify, request

from . import config as app_config
from .external_media import _root, _source_file, VIDEO_EXTS
from .permissions import normalize_path_permissions


def _safe_destination_dir(relative):
    value = str(relative or "").replace("\\\\", "/").strip()
    path = Path(value)
    if path.is_absolute() or any(part == ".." for part in path.parts):
        raise ValueError("Destination must be within the WebCap root")
    root = app_config.FS_ROOT.resolve()
    result = (root / path).resolve()
    if not result.is_relative_to(root):
        raise ValueError("Destination must be within the WebCap root")
    return result


def _destination(data):
    parent = _safe_destination_dir(data.get("destination"))
    if not parent.is_dir():
        raise ValueError("Destination folder does not exist")
    name = str(data.get("newSet") or "").strip()
    if name:
        if name in (".", "..") or Path(name).name != name or "/" in name or "\\" in name:
            raise ValueError("New Set name must be one folder name")
        dest = parent / name
        if dest.exists():
            raise ValueError("New Set already exists")
        dest.mkdir()
        normalize_path_permissions(dest)
        return dest
    return parent


def _unique_path(folder, name):
    candidate = folder / name
    if not candidate.exists():
        return candidate
    path = Path(name)
    for num in range(2, 10001):
        candidate = folder / (path.stem + "-" + str(num) + path.suffix)
        if not candidate.exists():
            return candidate
    raise RuntimeError("Could not find an unused destination filename")


def _validated_sources(data):
    root = _root(data.get("path"))
    paths = data.get("files")
    if not isinstance(paths, list) or not paths:
        raise ValueError("Select one or more source files")
    return [(_source_file(root, relative), str(relative)) for relative in paths]


def copy_media(data):
    sources = _validated_sources(data)
    dest = _destination(data)
    created = []
    for source, relative in sources:
        target = _unique_path(dest, source.name)
        try:
            shutil.copy2(source, target)
            normalize_path_permissions(target)
        except OSError as exc:
            raise RuntimeError(
                f"Copied {len(created)} files into {dest} before failing on {relative}: {exc}"
            ) from exc
        created.append({"source": relative, "name": target.name})
    return {"ok": True, "destination": str(dest), "copied": created}


def copy_generated_media(data):
    """Copy owner-validated Generate results into a Set without moving originals."""
    from .generate_store import load_result, resolve_result_media
    storage_ids = data.get("storageIds")
    if not isinstance(storage_ids, list) or not storage_ids or len(storage_ids) != len(set(storage_ids)):
        raise ValueError("Select one or more unique generated results.")
    sources = []
    for storage_id in storage_ids:
        if not isinstance(storage_id, str) or not storage_id.strip():
            raise ValueError("Invalid generation identifier.")
        result = load_result(storage_id)
        source = resolve_result_media(result.get("mediaPath"))
        sources.append((source, storage_id))
    destination = _destination(data)
    copied = []
    for source, storage_id in sources:
        target = _unique_path(destination, source.name)
        shutil.copy2(source, target)
        normalize_path_permissions(target)
        copied.append({"source": storage_id, "name": target.name})
    return {"ok": True, "destination": str(destination), "copied": copied}


def copy_test_media(data):
    """Copy owner-validated Test session media into a Set, keeping originals."""
    from .epoch_test_bench import resolve_result_media
    files = data.get("results")
    if not isinstance(files, list) or not files or len(files) > 120:
        raise ValueError("Select 1–120 Test results.")
    sources = []
    seen = set()
    for record in files:
        if not isinstance(record, dict):
            raise ValueError("Invalid Test result.")
        folder = str(record.get("folder") or "")
        session = str(record.get("session") or "")
        name = str(record.get("mediaFile") or "")
        if not folder or not session or not name:
            raise ValueError("Test result requires a Set, session and filename.")
        key = (folder, session, name)
        if key in seen:
            continue
        seen.add(key)
        owner = app_config.safe_join_fs_root(folder)
        source = resolve_result_media(owner, session, name)
        sources.append((source, key))
    destination = _destination(data)
    copied = []
    for source, key in sources:
        target = _unique_path(destination, source.name)
        shutil.copy2(source, target)
        normalize_path_permissions(target)
        copied.append({"source": "/".join(key), "name": target.name})
    return {"ok": True, "destination": str(destination), "copied": copied}


def export_clip(data):
    sources = _validated_sources(data)
    if len(sources) != 1:
        raise ValueError("Select one video to export a clip")
    source, relative = sources[0]
    if source.suffix.lower() not in VIDEO_EXTS:
        raise ValueError("Clips require video sources")
    start = float(data.get("start") or 0)
    duration = float(data.get("duration") or 0)
    if not 0 <= start < 864000 or not 0 < duration <= 864000:
        raise ValueError("Enter a valid start and duration")
    dest = _destination(data)
    target = _unique_path(dest, source.stem + "_clip.mp4")
    fd, temp = tempfile.mkstemp(prefix=".explorer-clip-", suffix=".mp4", dir=dest)
    os.close(fd)
    try:
        process = subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
            "-ss", str(start), "-i", str(source), "-t", str(duration),
            "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-movflags", "+faststart", temp
        ], text=True, capture_output=True)
        if process.returncode:
            raise RuntimeError("ffmpeg: " + (process.stderr or process.stdout or "Clip export failed").strip())
        os.replace(temp, target)
        normalize_path_permissions(target)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)
    return {"ok": True, "destination": str(dest), "clip": target.name, "source": relative}


def register_routes(app):
    @app.post("/fs/media_explorer/test/copy")
    def explorer_test_copy():
        try:
            return jsonify(copy_test_media(request.get_json(silent=True) or {}))
        except (ValueError, OSError, RuntimeError, FileNotFoundError) as exc:
            app.logger.exception("EXPLORER TEST COPY FAILED")
            return jsonify({"ok": False, "error": str(exc)}), 400

    @app.post("/fs/media_explorer/generated/copy")
    def explorer_generated_copy():
        try:
            return jsonify(copy_generated_media(request.get_json(silent=True) or {}))
        except (ValueError, OSError, RuntimeError, FileNotFoundError) as exc:
            app.logger.exception("EXPLORER GENERATED COPY FAILED")
            return jsonify({"ok": False, "error": str(exc)}), 400

    @app.post("/fs/media_explorer/external/copy")
    def explorer_copy():
        try:
            return jsonify(copy_media(request.get_json(silent=True) or {}))
        except (ValueError, OSError, RuntimeError) as exc:
            app.logger.exception("EXPLORER COPY FAILED")
            return jsonify({"ok": False, "error": str(exc)}), 400

    @app.post("/fs/media_explorer/external/clip")
    def explorer_clip():
        try:
            return jsonify(export_clip(request.get_json(silent=True) or {}))
        except (ValueError, OSError, RuntimeError) as exc:
            app.logger.exception("EXPLORER CLIP FAILED")
            return jsonify({"ok": False, "error": str(exc)}), 400

    @app.get("/fs/media_explorer/external/destinations")
    def explorer_destinations():
        try:
            relative = str(request.args.get("destination") or "")
            folder = _safe_destination_dir(relative)
            if not folder.is_dir():
                raise ValueError("Destination directory not found")
            dirs = sorted((child.name for child in folder.iterdir()
                           if child.is_dir() and not child.is_symlink()), key=str.casefold)
            return jsonify({"ok": True, "parent": relative, "folders": dirs})
        except (ValueError, OSError) as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400
