"""External Media Explorer: transient recursive discovery with source-local metadata.

External media is read-only. Technical facts use Prep's existing synchronized
media_metadata.json writer; no Set state, database, VL, or inference.
"""
import json
import os
import subprocess
import threading
from collections import deque
from pathlib import Path
from urllib.parse import quote

from flask import jsonify, request, send_file

from .media import merge_technical_media_metadata

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"}
VIDEO_EXTS = {".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v", ".ogg", ".wmv", ".mpg", ".mpeg"}
MEDIA_EXTS = IMAGE_EXTS | VIDEO_EXTS
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
    if not path.is_relative_to(root) or not path.is_file() or path.suffix.lower() not in MEDIA_EXTS:
        raise ValueError("External media file is unavailable: " + relative)
    return path


def _read_cache(directory):
    path = directory / "media_metadata.json"
    if path.is_symlink():
        raise ValueError("Refusing symlinked metadata sidecar: " + str(path))
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("media_metadata.json is not a JSON object: " + str(path))
    return payload


def _fresh(entry, meta):
    return (isinstance(meta, dict)
            and meta.get("size") == entry["fileSize"]
            and meta.get("mtime") == entry["mtime"]
            and _dimensions(meta.get("resolution")) is not None
            and not meta.get("error"))


def _dimensions(value):
    try:
        width, height = (int(value) for value in str(value or "").lower().split("x"))
        return (width, height) if width > 0 and height > 0 else None
    except (TypeError, ValueError):
        return None


def _warning(snapshot, message):
    with _LOCK:
        snapshot["warnings"] += 1
        snapshot["lastWarning"] = str(message)


def _publish(snapshot, entries):
    if not entries:
        return
    with _LOCK:
        if _index is not snapshot or snapshot["cancel"].is_set():
            return
        snapshot["items"].extend(entries)
        snapshot["by_path"].update((item["relativePath"], item) for item in entries)
        snapshot["analyzed"] += sum(bool(item.get("metadata")) for item in entries)
        snapshot["revision"] += 1


def _discover(snapshot):
    root = snapshot["root"]
    try:
        def walk_error(error):
            _warning(snapshot, "Could not read directory: " + str(error))

        for folder, directories, names in os.walk(root, followlinks=False, onerror=walk_error):
            if snapshot["cancel"].is_set():
                break
            directory = Path(folder)
            directories[:] = sorted(d for d in directories if not (directory / d).is_symlink())
            try:
                cache = _read_cache(directory)
            except (OSError, ValueError) as exc:
                _warning(snapshot, "Could not read " + str(directory / "media_metadata.json") + ": " + str(exc))
                cache = {}
            batch = []
            for name in names:
                if snapshot["cancel"].is_set():
                    break
                file_path = directory / name
                if file_path.suffix.lower() not in MEDIA_EXTS or file_path.is_symlink():
                    continue
                try:
                    stat = file_path.stat()
                    if not file_path.is_file():
                        continue
                except OSError as exc:
                    _warning(snapshot, "Could not inspect " + str(file_path) + ": " + str(exc))
                    continue
                relative = file_path.relative_to(root).as_posix()
                entry = {
                    "id": "external:" + relative, "source": "external", "role": "source",
                    "mediaKind": "video" if file_path.suffix.lower() in VIDEO_EXTS else "image",
                    "fileName": name, "relativePath": relative,
                    "fileSize": stat.st_size, "mtime": int(stat.st_mtime),
                    "createdAt": int(stat.st_mtime * 1000), "rating": None,
                }
                previous = cache.get(name)
                if _fresh(entry, previous):
                    entry["metadata"] = previous
                    entry["metadataCached"] = True
                batch.append(entry)
                if len(batch) >= 64:
                    _publish(snapshot, batch)
                    batch = []
            _publish(snapshot, batch)
            with _LOCK:
                if _index is snapshot:
                    snapshot["directories"] += 1
    except Exception as exc:
        with _LOCK:
            snapshot["error"] = str(exc)
    finally:
        with _LOCK:
            snapshot["complete"] = True
            snapshot["revision"] += 1


def _ensure_index(raw_path, *, refresh=False):
    global _index, _metadata_job
    root = _root(raw_path)
    with _LOCK:
        if not refresh and _index and _index["root"] == root:
            return _index
        if _index:
            _index["cancel"].set()
        if _metadata_job:
            _metadata_job["cancel"].set()
        snapshot = {"root": root, "items": [], "by_path": {}, "directories": 0,
                    "complete": False, "analyzed": 0, "revision": 0,
                    "warnings": 0, "lastWarning": "", "error": "",
                    "cancel": threading.Event()}
        _index = snapshot
        _metadata_job = None
        threading.Thread(target=_discover, args=(snapshot,), daemon=True,
                         name="external-media-discovery").start()
        return snapshot


def _query_items(snapshot, args, *, ignore_metadata=False):
    items = list(snapshot["items"])
    kind = str(args.get("kind") or "")
    query = str(args.get("search") or "").casefold().split()
    if kind:
        if kind not in ("image", "video"):
            raise ValueError("Unknown media type filter.")
        items = [item for item in items if item["mediaKind"] == kind]
    if query:
        items = [item for item in items
                 if all(term in item["relativePath"].casefold() for term in query)]
    if not ignore_metadata:
        min_side = int(args.get("min_side") or 0)
        min_mp = float(args.get("min_mp") or 0)
        min_duration = float(args.get("min_duration") or 0)
        max_duration = float(args.get("max_duration") or 0)

        def matches_metadata(item):
            meta = item.get("metadata") or {}
            dimensions = _dimensions(meta.get("resolution"))
            if min_side or min_mp:
                if dimensions is None:
                    return False
                width, height = dimensions
                if min(width, height) < min_side or width * height / 1000000 < min_mp:
                    return False
            if min_duration or max_duration:
                try:
                    length = float(meta["duration"])
                except (KeyError, TypeError, ValueError):
                    return False
                if (min_duration and length < min_duration) or (max_duration and length > max_duration):
                    return False
            return True

        items = [item for item in items if matches_metadata(item)]
    sort = str(args.get("sort") or "newest")
    if sort == "name":
        items.sort(key=lambda item: (item["fileName"].casefold(), item["relativePath"]))
    elif sort == "path":
        items.sort(key=lambda item: item["relativePath"].casefold())
    elif sort == "type":
        items.sort(key=lambda item: (item["mediaKind"], item["relativePath"].casefold()))
    elif sort == "oldest":
        items.sort(key=lambda item: (item["createdAt"], item["id"]))
    elif sort in ("resolution", "megapixels", "duration"):
        def metric(item):
            meta = item.get("metadata") or {}
            if sort == "duration":
                return float(meta.get("duration") or 0)
            dimensions = _dimensions(meta.get("resolution"))
            if dimensions is None:
                return 0
            width, height = dimensions
            return min(width, height) if sort == "resolution" else width * height
        items.sort(key=lambda item: (-metric(item), item["relativePath"]))
    elif sort == "newest":
        items.sort(key=lambda item: (-item["createdAt"], item["id"]))
    else:
        raise ValueError("Unsupported external media sort: " + sort)
    return items


def _technical_probe(path):
    before = path.stat()
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
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise RuntimeError("Media changed during analysis: " + str(path))
    result = {"size": after.st_size, "mtime": int(after.st_mtime),
              "resolution": str(width) + "x" + str(height)}
    duration = (payload.get("format") or {}).get("duration")
    if path.suffix.lower() in VIDEO_EXTS and duration is not None:
        result["duration"] = float(duration)
    return result


def _job_status(job):
    return {key: job[key] for key in
            ("running", "completed", "total", "failed", "uncached", "current", "lastError", "canceled")}


def _metadata_worker(snapshot, job):
    root = snapshot["root"]
    batch_folder = None
    batch = {}

    def flush():
        nonlocal batch_folder, batch
        if not batch:
            return
        try:
            merge_technical_media_metadata(batch_folder, batch)
            with _LOCK:
                for name in batch:
                    relative = (batch_folder / name).relative_to(root).as_posix()
                    item = snapshot["by_path"].get(relative)
                    if item is not None:
                        item["metadataCached"] = True
        except Exception as exc:
            with _LOCK:
                job["uncached"] += len(batch)
                job["lastError"] = "Could not cache technical metadata in " + str(batch_folder) + ": " + str(exc)
        batch_folder = None
        batch = {}

    try:
        while True:
            with _LOCK:
                if _index is not snapshot or snapshot["cancel"].is_set() or job["cancel"].is_set():
                    break
                if not job["pending"]:
                    break
                relative = job["pending"].popleft()
                job["current"] = relative
            try:
                path = _source_file(root, relative)
                item = snapshot["by_path"].get(relative)
                if item is None:
                    raise ValueError("External media no longer indexed: " + relative)
                if item.get("metadataCached") and _fresh(item, item.get("metadata")):
                    continue
                details = item.get("metadata") if _fresh(item, item.get("metadata")) else _technical_probe(path)
                # Source may have changed between indexing and probing.
                stat = path.stat()
                if details["size"] != stat.st_size or details["mtime"] != int(stat.st_mtime):
                    raise RuntimeError("Source changed; refresh the external folder: " + relative)
                with _LOCK:
                    if not item.get("metadata"):
                        snapshot["analyzed"] += 1
                    item["metadata"] = details
                    snapshot["revision"] += 1
                if batch_folder is not None and path.parent != batch_folder:
                    flush()
                batch_folder = path.parent
                batch[path.name] = details
                if len(batch) >= 32:
                    flush()
            except Exception as exc:
                with _LOCK:
                    job["failed"] += 1
                    job["lastError"] = relative + ": " + str(exc)
            finally:
                with _LOCK:
                    job["completed"] += 1
                    job["current"] = ""
    finally:
        flush()
        with _LOCK:
            job["running"] = False
            job["canceled"] = job["cancel"].is_set()


def _snapshot_status(snapshot):
    return {"ok": True, "complete": snapshot["complete"],
            "discovered": len(snapshot["items"]), "analyzed": snapshot["analyzed"],
            "directories": snapshot["directories"], "warnings": snapshot["warnings"],
            "lastWarning": snapshot["lastWarning"], "error": snapshot["error"],
            "revision": snapshot["revision"]}


def register_routes(app):
    @app.get("/fs/media_explorer/external")
    def external_list():
        try:
            snapshot = _ensure_index(request.args.get("path"), refresh=request.args.get("refresh") == "1")
            with _LOCK:
                items = _query_items(snapshot, request.args)
                limit = max(1, min(int(request.args.get("limit") or 60), 120))
                offset = max(0, int(request.args.get("offset") or 0))
                selected = []
                for item in items[offset:offset + limit]:
                    record = dict(item)
                    record["mediaUrl"] = ("/fs/media_explorer/external/media?path="
                                          + quote(str(snapshot["root"]), safe="")
                                          + "&file=" + quote(item["relativePath"], safe=""))
                    selected.append(record)
                return jsonify({**_snapshot_status(snapshot), "items": selected,
                                "total": len(items), "offset": offset, "limit": limit, "facets": {}})
        except Exception as exc:
            app.logger.exception("EXTERNAL MEDIA DISCOVERY FAILED")
            return jsonify({"ok": False, "error": str(exc)}), 400

    @app.get("/fs/media_explorer/external/status")
    def external_status():
        try:
            root = _root(request.args.get("path"))
            with _LOCK:
                if _index is None or _index["root"] != root:
                    raise ValueError("External folder is no longer active.")
                return jsonify(_snapshot_status(_index))
        except Exception as exc:
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
            path = _root(data.get("path"))
            with _LOCK:
                if _index is None or _index["root"] != path:
                    raise ValueError("External folder changed; select Browse before analyzing.")
                snapshot = _index
                if data.get("scope") == "loaded":
                    targets = set(str(name) for name in (data.get("files") or []))
                    source = [snapshot["by_path"][name] for name in targets if name in snapshot["by_path"]]
                elif data.get("scope") == "filtered":
                    source = _query_items(snapshot, data, ignore_metadata=True)
                else:
                    raise ValueError("Unknown metadata scan scope.")
                paths = sorted((item["relativePath"] for item in source
                               if not (item.get("metadataCached") and _fresh(item, item.get("metadata")))),
                               key=lambda name: (str(Path(name).parent), name))
                if (_metadata_job and _metadata_job["running"] and
                        not _metadata_job["cancel"].is_set() and _metadata_job["snapshot"] is snapshot):
                    job = _metadata_job
                    additions = [name for name in paths if name not in job["seen"]]
                    job["pending"].extend(additions)
                    job["seen"].update(additions)
                    job["total"] += len(additions)
                else:
                    job = {"snapshot": snapshot, "pending": deque(paths), "seen": set(paths),
                           "total": len(paths), "completed": 0, "failed": 0,
                           "uncached": 0, "running": bool(paths), "canceled": False,
                           "current": "", "lastError": "", "cancel": threading.Event()}
                    _metadata_job = job
                    if paths:
                        threading.Thread(target=_metadata_worker, args=(snapshot, job),
                                         daemon=True, name="external-media-metadata").start()
                return jsonify({"ok": True, **_job_status(job),
                                "discoveryComplete": snapshot["complete"]})
        except Exception as exc:
            app.logger.exception("EXTERNAL MEDIA METADATA REQUEST FAILED")
            return jsonify({"ok": False, "error": str(exc)}), 400

    @app.post("/fs/media_explorer/external/metadata/stop")
    def external_metadata_stop():
        with _LOCK:
            if _metadata_job and _metadata_job["running"]:
                _metadata_job["cancel"].set()
            return jsonify({"ok": True, **(_job_status(_metadata_job) if _metadata_job else
                          {"running": False, "completed": 0, "total": 0, "failed": 0,
                           "uncached": 0, "current": "", "lastError": "", "canceled": False})})

    @app.get("/fs/media_explorer/external/metadata/status")
    def external_metadata_status():
        with _LOCK:
            if not _metadata_job or not _index or _metadata_job["snapshot"] is not _index:
                return jsonify({"ok": True, "running": False, "completed": 0,
                                "total": 0, "failed": 0, "uncached": 0, "current": "",
                                "lastError": "", "canceled": False})
            return jsonify({"ok": True, **_job_status(_metadata_job)})
