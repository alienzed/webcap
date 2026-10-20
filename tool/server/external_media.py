"""External Media Explorer source: transient discovery and owner-local technical metadata.

No Set state, database, thumbnail generation, VL or source-media mutation.
"""
import json
import os
import subprocess
import threading
from pathlib import Path
from urllib.parse import quote

from flask import jsonify, request, send_file

from .folder_state_store import write_folder_state_atomic

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"}
VIDEO_EXTS = {".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v", ".ogg", ".wmv", ".mpg", ".mpeg"}
_LOCK = threading.RLock()
_index = None
_metadata_job = None


def _root(raw):
    value = str(raw or "").strip()
    if not value:
        raise ValueError("Enter an external folder path.")
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise ValueError("External folder path must be absolute.")
    path = path.resolve()
    if not path.is_dir():
        raise ValueError("External folder does not exist: " + str(path))
    return path


def _source_file(root, relative):
    relative = str(relative or "").replace("\\", "/")
    if not relative or Path(relative).is_absolute() or ".." in Path(relative).parts:
        raise ValueError("Invalid external media path.")
    path = (root / relative).resolve()
    if not path.is_relative_to(root) or not path.is_file() or path.suffix.lower() not in IMAGE_EXTS | VIDEO_EXTS:
        raise ValueError("External media file is unavailable: " + relative)
    return path


def _read_cache(folder):
    cache = folder / "media_metadata.json"
    if not cache.exists():
        return {}
    payload = json.loads(cache.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Invalid media_metadata.json: " + str(cache))
    return payload


def _fresh(entry, metadata):
    return (isinstance(metadata, dict)
            and metadata.get("size") == entry["fileSize"]
            and metadata.get("mtime") == entry["mtime"]
            and bool(metadata.get("resolution"))
            and not metadata.get("error"))


def _discover(snapshot):
    root = snapshot["root"]
    try:
        for folder, dirs, names in os.walk(root, followlinks=False):
            if snapshot["cancel"].is_set():
                return
            dirs[:] = sorted(d for d in dirs if not (Path(folder) / d).is_symlink())
            directory = Path(folder)
            cache = _read_cache(directory)
            incoming = []
            for name in sorted(names):
                path = directory / name
                suffix = path.suffix.lower()
                if suffix not in IMAGE_EXTS | VIDEO_EXTS or path.is_symlink():
                    continue
                stat = path.stat()
                relative = path.relative_to(root).as_posix()
                entry = {
                    "id": "external:" + relative,
                    "source": "external",
                    "role": "source",
                    "mediaKind": "video" if suffix in VIDEO_EXTS else "image",
                    "fileName": name,
                    "mediaPath": relative,
                    "relativePath": relative,
                    "mediaUrl": "/fs/media_explorer/external/media?path=" + quote(str(root), safe="")
                                + "&file=" + quote(relative, safe=""),
                    "fileSize": stat.st_size,
                    "mtime": int(stat.st_mtime),
                    "createdAt": int(stat.st_mtime * 1000),
                    "rating": None,
                }
                cached = cache.get(name)
                if _fresh(entry, cached):
                    entry["metadata"] = cached
                incoming.append(entry)
            with _LOCK:
                if _index is not snapshot:
                    return
                snapshot["items"].extend(incoming)
                snapshot["directories"] += 1
    except Exception as exc:
        with _LOCK:
            snapshot["error"] = str(exc)
    finally:
        with _LOCK:
            snapshot["complete"] = True


def _ensure_index(path):
    global _index, _metadata_job
    root = _root(path)
    with _LOCK:
        if _index and _index["root"] == root:
            return _index
        if _index:
            _index["cancel"].set()
        _index = {"root": root, "items": [], "directories": 0, "complete": False,
                  "error": "", "cancel": threading.Event()}
        _metadata_job = None
        snapshot = _index
        threading.Thread(target=_discover, args=(snapshot,), daemon=True, name="external-media-discovery").start()
        return snapshot


def _query_items(snapshot, args, *, ignore_metadata=False):
    items = list(snapshot["items"])
    kind = str(args.get("kind") or "")
    search = str(args.get("search") or "").casefold().strip()
    if kind:
        items = [item for item in items if item["mediaKind"] == kind]
    if search:
        terms = search.split()
        items = [item for item in items if all(term in item["relativePath"].casefold() for term in terms)]
    if not ignore_metadata:
        min_side = int(args.get("min_side") or 0)
        min_mp = float(args.get("min_mp") or 0)
        min_duration = float(args.get("min_duration") or 0)
        max_duration = float(args.get("max_duration") or 0)
        def qualifies(item):
            meta = item.get("metadata") or {}
            dimensions = str(meta.get("resolution") or "").lower().split("x")
            if min_side or min_mp:
                if len(dimensions) != 2:
                    return False
                width, height = int(dimensions[0]), int(dimensions[1])
                if min(width, height) < min_side or width * height / 1000000 < min_mp:
                    return False
            if min_duration or max_duration:
                duration = meta.get("duration")
                if duration is None or (min_duration and duration < min_duration) or (max_duration and duration > max_duration):
                    return False
            return True
        items = [item for item in items if qualifies(item)]
    sort = str(args.get("sort") or "newest")
    if sort == "name":
        items.sort(key=lambda item: (item["fileName"].casefold(), item["relativePath"]))
    elif sort == "path":
        items.sort(key=lambda item: item["relativePath"].casefold())
    elif sort == "oldest":
        items.sort(key=lambda item: (item["createdAt"], item["id"]))
    elif sort in ("resolution", "megapixels", "duration"):
        def sort_metric(item):
            meta = item.get("metadata") or {}
            if sort == "duration":
                return float(meta.get("duration") or 0)
            dimensions = str(meta.get("resolution") or "").lower().split("x")
            if len(dimensions) != 2:
                return 0
            w, h = int(dimensions[0]), int(dimensions[1])
            return min(w, h) if sort == "resolution" else w * h
        items.sort(key=lambda item: (-sort_metric(item), item["relativePath"]))
    elif sort == "newest":
        items.sort(key=lambda item: (-item["createdAt"], item["id"]))
    else:
        raise ValueError("Unsupported external media sort: " + sort)
    return items


def _technical_probe(path):
    command = ["ffprobe", "-v", "error", "-select_streams", "v:0",
               "-show_entries", "stream=width,height:format=duration", "-of", "json", str(path)]
    probe = subprocess.run(command, capture_output=True, text=True, timeout=35)
    if probe.returncode:
        raise RuntimeError("ffprobe failed for " + str(path) + ": " + probe.stderr.strip())
    payload = json.loads(probe.stdout)
    streams = payload.get("streams") or []
    if not streams:
        raise RuntimeError("No video/image dimensions: " + str(path))
    width, height = int(streams[0]["width"]), int(streams[0]["height"])
    stat = path.stat()
    result = {"size": stat.st_size, "mtime": int(stat.st_mtime),
              "resolution": str(width) + "x" + str(height)}
    duration = (payload.get("format") or {}).get("duration")
    if path.suffix.lower() in VIDEO_EXTS and duration is not None:
        result["duration"] = float(duration)
    return result


def _metadata_worker(snapshot, job):
    root = snapshot["root"]
    while True:
        with _LOCK:
            if _index is not snapshot or snapshot["cancel"].is_set():
                return
            if not job["pending"]:
                job["running"] = False
                job["current"] = ""
                return
            relative = job["pending"].pop(0)
            job["current"] = relative
        try:
            path = _source_file(root, relative)
            stat = path.stat()
            entry = next((item for item in snapshot["items"] if item["relativePath"] == relative), None)
            if entry is None:
                raise ValueError("External media no longer indexed: " + relative)
            if _fresh(entry, entry.get("metadata")):
                pass
            else:
                details = _technical_probe(path)
                cache = _read_cache(path.parent)
                cache[path.name] = details
                write_folder_state_atomic(path.parent / "media_metadata.json", cache)
                with _LOCK:
                    entry["metadata"] = details
        except Exception as exc:
            with _LOCK:
                job["failed"] += 1
                job["lastError"] = relative + ": " + str(exc)
        finally:
            with _LOCK:
                job["completed"] += 1
                job["current"] = ""


def register_routes(app):
    @app.get("/fs/media_explorer/external")
    def external_list():
        try:
            snapshot = _ensure_index(request.args.get("path"))
            with _LOCK:
                items = _query_items(snapshot, request.args)
                limit = max(1, min(int(request.args.get("limit") or 60), 120))
                offset = max(0, int(request.args.get("offset") or 0))
                selected = [dict(item) for item in items[offset:offset + limit]]
                coverage = sum(bool(item.get("metadata")) for item in snapshot["items"])
                return jsonify({"ok": True, "items": selected, "total": len(items),
                    "offset": offset, "limit": limit, "complete": snapshot["complete"],
                    "discovered": len(snapshot["items"]), "directories": snapshot["directories"],
                    "analyzed": coverage, "error": snapshot["error"], "facets": {}})
        except Exception as exc:
            app.logger.exception("EXTERNAL MEDIA DISCOVERY FAILED")
            return jsonify({"ok": False, "error": str(exc)}), 400

    @app.get("/fs/media_explorer/external/media")
    def external_file():
        try:
            root = _root(request.args.get("path"))
            with _LOCK:
                if not _index or _index["root"] != root:
                    raise ValueError("External source is not active.")
            return send_file(_source_file(root, request.args.get("file")), conditional=True)
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 404

    @app.post("/fs/media_explorer/external/metadata")
    def external_metadata():
        global _metadata_job
        try:
            data = request.get_json(silent=True) or {}
            snapshot = _ensure_index(data.get("path"))
            scope = data.get("scope")
            with _LOCK:
                if scope == "loaded":
                    target = set(str(p) for p in data.get("files") or [])
                    source_items = [item for item in snapshot["items"] if item["relativePath"] in target]
                elif scope == "filtered":
                    source_items = _query_items(snapshot, data, ignore_metadata=True)
                else:
                    raise ValueError("Unknown metadata scope.")
                paths = [item["relativePath"] for item in source_items if not _fresh(item, item.get("metadata"))]
                if _metadata_job and _metadata_job["snapshot"] is snapshot and _metadata_job["running"]:
                    job = _metadata_job
                    additions = [path for path in paths if path not in job["seen"]]
                    job["pending"].extend(additions)
                    job["seen"].update(additions)
                    job["total"] += len(additions)
                else:
                    job = {"snapshot": snapshot, "running": bool(paths), "pending": paths,
                           "seen": set(paths), "total": len(paths), "completed": 0,
                           "failed": 0, "current": "", "lastError": ""}
                    _metadata_job = job
                    if paths:
                        threading.Thread(target=_metadata_worker, args=(snapshot, job),
                                         daemon=True, name="external-media-metadata").start()
                return jsonify({"ok": True, **_job_status(job)})
        except Exception as exc:
            app.logger.exception("EXTERNAL MEDIA METADATA REQUEST FAILED")
            return jsonify({"ok": False, "error": str(exc)}), 400

    @app.get("/fs/media_explorer/external/metadata/status")
    def external_metadata_status():
        with _LOCK:
            if not _metadata_job or not _index or _metadata_job["snapshot"] is not _index:
                return jsonify({"ok": True, "running": False, "completed": 0, "total": 0, "failed": 0})
            return jsonify({"ok": True, **_job_status(_metadata_job)})


def _job_status(job):
    return {name: job[name] for name in ("running", "completed", "total", "failed", "current", "lastError")}
