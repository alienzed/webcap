"""External Media Explorer: transient recursive discovery with source-local metadata.

External media can be explicitly moved or trashed. Technical facts use Prep's existing synchronized
media_metadata.json writer; no Set state, database, VL, or inference.
"""
import json
import os
import shutil
import subprocess
import threading
from datetime import datetime, timedelta, timezone
from collections import deque
from pathlib import Path
from . import config as app_config
from urllib.parse import quote

from flask import jsonify, request, send_file

from .media import merge_technical_media_metadata
from .media_quality import analyze_media_quality, current_quality

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"}
VIDEO_EXTS = {".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v", ".ogg", ".wmv", ".mpg", ".mpeg"}
MEDIA_EXTS = IMAGE_EXTS | VIDEO_EXTS
_LOCK = threading.RLock()
_index = None
_metadata_job = None



_VIEW_FIELDS = {
    "source", "role", "search", "tag", "rating", "kind", "model", "folder",
    "date", "sort", "direction", "full", "recursive", "externalPath",
    "externalDirectory", "min-side", "min-mp", "min-duration", "max-duration",
    "storyboardType", "quality",
}


def _views_file():
    return app_config.app_state_root() / "media_explorer_views.json"


def list_saved_views():
    path = _views_file()
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    if (not isinstance(data, list) or len(data) > 60 or
            any(not isinstance(entry, dict) or not isinstance(entry.get("name"), str)
                or not isinstance(entry.get("filters"), dict) for entry in data)):
        raise ValueError("Saved Media Explorer views are invalid.")
    return data


def save_media_view(data):
    name = str(data.get("name") or "").strip()
    filters = data.get("filters")
    if not name or len(name) > 80 or not isinstance(filters, dict):
        raise ValueError("A name and valid view filters are required.")
    if any(key not in _VIEW_FIELDS or not isinstance(value, (str, bool))
           or (isinstance(value, str) and len(value) > 1024)
           for key, value in filters.items()):
        raise ValueError("Unsupported saved-view filter.")
    with _LOCK:
        views = list_saved_views()
        match = next((i for i, entry in enumerate(views)
                      if entry["name"].casefold() == name.casefold()), -1)
        record = {"name": name, "filters": filters}
        if match < 0:
            if len(views) >= 60:
                raise ValueError("Maximum number of saved views reached.")
            views.append(record)
        else:
            views[match] = record
        _write_views(views)
        return sorted(views, key=lambda entry: entry["name"].casefold())


def rename_media_view(data):
    """Rename the saved view without changing any source-media tags or filters."""
    old = str(data.get("name") or "").strip()
    next_name = str(data.get("newName") or "").strip()
    if not old or not next_name or len(next_name) > 80:
        raise ValueError("Provide existing and new saved-view names.")
    with _LOCK:
        views = list_saved_views()
        match = next((entry for entry in views if entry["name"].casefold() == old.casefold()), None)
        if match is None:
            raise ValueError("Saved view does not exist.")
        if any(entry is not match and entry["name"].casefold() == next_name.casefold()
               for entry in views):
            raise ValueError("A saved view already uses that name.")
        match["name"] = next_name
        _write_views(views)
        return sorted(views, key=lambda entry: entry["name"].casefold())



def delete_media_view(name):
    key = str(name or "").strip().casefold()
    if not key:
        raise ValueError("Choose a saved view to delete.")
    with _LOCK:
        views = list_saved_views()
        remaining = [entry for entry in views if entry["name"].casefold() != key]
        if len(remaining) == len(views):
            raise ValueError("Saved view does not exist.")
        _write_views(remaining)
        return sorted(remaining, key=lambda entry: entry["name"].casefold())


def _write_views(views):
    from .media import write_media_metadata_file
    path = _views_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    # This shared atomic JSON writer accepts a JSON list as well as a dict.
    write_media_metadata_file(path, views)


def _recent_paths_file():
    return app_config.app_state_root() / "media_explorer_folders.json"


def _recent_paths():
    path = _recent_paths_file()
    if not path.exists():
        return []
    saved = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(saved, list) or not all(isinstance(value, str) for value in saved):
        raise ValueError("Invalid saved external folders.")
    return saved


def _save_recent_paths(paths):
    path = _recent_paths_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    try:
        temporary.write_text(json.dumps(paths, indent=2), encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def remember_external_path(raw):
    root = str(_root(raw))
    with _LOCK:
        paths = [root] + [entry for entry in _recent_paths() if entry != root]
        _save_recent_paths(paths)
        return paths


def remove_external_path(raw):
    value = str(raw or "").strip()
    with _LOCK:
        paths = [entry for entry in _recent_paths() if entry != value]
        _save_recent_paths(paths)
        return paths


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
        entries = [item for item in entries if item["relativePath"] not in snapshot["removed"]]
        if not entries:
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
                    "id": "external:" + str(root) + "/" + relative, "source": "external", "role": "source",
                    "mediaKind": "video" if file_path.suffix.lower() in VIDEO_EXTS else "image",
                    "fileName": name, "relativePath": relative,
                    "fileSize": stat.st_size, "mtime": int(stat.st_mtime),
                    "createdAt": int(stat.st_mtime * 1000), "rating": None, "tags": [],
                }
                previous = cache.get(name)
                if isinstance(previous, dict):
                    entry["rating"] = previous.get("rating")
                    entry["tags"] = previous.get("tags") if isinstance(previous.get("tags"), list) else []
                if _fresh(entry, previous):
                    entry["metadata"] = {k: previous[k] for k in ("size", "mtime", "resolution", "duration", "quality") if k in previous and (k != "quality" or current_quality(previous))}
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
        snapshot = {"root": root, "items": [], "by_path": {}, "removed": set(), "directories": 0,
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
    # The discovery index is recursive, but navigation defaults to one directory.
    # Legacy/internal callers without a directory argument retain recursive queries.
    directory = args.get("directory")
    recursive = str(args.get("recursive") or "0") == "1"
    if directory is not None and not recursive:
        folder = str(directory or "").replace("\\", "/").strip("/")
        parts = Path(folder).parts
        if any(part in (".", "..") for part in parts):
            raise ValueError("Invalid directory")
        items = [item for item in items
                 if str(Path(item["relativePath"]).parent).replace("\\", "/") == (folder or ".")]
    kind = str(args.get("kind") or "")
    query = str(args.get("search") or "").casefold().split()
    if kind:
        if kind not in ("image", "video"):
            raise ValueError("Unknown media type filter.")
        items = [item for item in items if item["mediaKind"] == kind]
    if query:
        items = [item for item in items if all(
            term in (item["relativePath"] + " " + " ".join(item.get("tags") or [])).casefold()
            for term in query)]
    tag_filter = str(args.get("tag") or "").strip().casefold()
    if tag_filter:
        items = [item for item in items
                 if tag_filter in {tag.casefold() for tag in item.get("tags") or []}]
    rating = str(args.get("rating") or "")
    if rating:
        if rating == "unrated":
            items = [item for item in items if not item.get("rating")]
        elif rating in ("1", "2", "3", "4", "5"):
            items = [item for item in items if (item.get("rating") or 0) >= int(rating)]
        else:
            raise ValueError("Unknown media rating filter.")
    date = str(args.get("date") or "")
    if date:
        if date not in ("7", "30", "90"):
            raise ValueError("Unknown media date filter.")
        cutoff = (datetime.now(timezone.utc) - timedelta(days=int(date))).timestamp() * 1000
        items = [item for item in items if item["createdAt"] >= cutoff]
    if not ignore_metadata:
        quality = str(args.get("quality") or "")
        if quality:
            if quality not in ("measured", "unmeasurable", "unscanned", "incomplete"):
                raise ValueError("Unsupported detail analysis filter.")
            def matches_quality(item):
                meta = item.get("metadata") or {}
                known = current_quality(meta)
                block = meta.get("quality") or {}
                if quality == "unscanned":
                    return not known
                if not known:
                    return False
                if quality == "measured":
                    return block.get("detailSignal") is not None
                if quality == "unmeasurable":
                    return block.get("detailSignal") is None
                return block.get("failedSamples", 0) > 0
            items = [item for item in items if matches_quality(item)]
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
    elif sort == "detail":
        # Unknown/unmeasurable measurements always sort last, in either direction.
        items.sort(key=lambda item: (
            not current_quality(item.get("metadata") or {})
            or (item.get("metadata") or {}).get("quality", {}).get("detailSignal") is None,
            -((item.get("metadata") or {}).get("quality", {}).get("detailSignal") or 0),
            item["relativePath"]))
    elif sort == "rating":
        items.sort(key=lambda item: (-(item.get("rating") or 0), item["relativePath"]))
    elif sort == "size":
        items.sort(key=lambda item: (-item["fileSize"], item["relativePath"]))
    elif sort == "newest":
        items.sort(key=lambda item: (-item["createdAt"], item["id"]))
    else:
        raise ValueError("Unsupported external media sort: " + sort)
    if str(args.get("direction") or "desc") == "asc":
        if sort == "detail":
            measured = [item for item in items if current_quality(item.get("metadata") or {})
                        and (item.get("metadata") or {}).get("quality", {}).get("detailSignal") is not None]
            unknown = [item for item in items if item not in measured]
            items = list(reversed(measured)) + unknown
        else:
            items.reverse()
    return items


def _child_directories(snapshot, directory):
    """Immediate subfolders from the indexed source, including empty folders."""
    root = snapshot["root"]
    folder = str(directory or "").replace("\\", "/").strip("/")
    if Path(folder).is_absolute() or any(part in (".", "..") for part in Path(folder).parts):
        raise ValueError("Invalid directory")
    target = (root / folder).resolve()
    if not target.is_relative_to(root) or not target.is_dir():
        raise ValueError("Directory is outside the selected root")
    return sorted((child.name for child in target.iterdir()
                   if child.is_dir() and not child.is_symlink()), key=str.casefold)


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
                cached = item.get("metadata") or {}
                fresh = _fresh(item, cached)
                if job.get("mode") == "quality":
                    if fresh and current_quality(cached):
                        continue
                    details = dict(cached) if fresh else _technical_probe(path)
                    details["quality"] = analyze_media_quality(
                        path, details, cancel=job["cancel"])
                else:
                    if item.get("metadataCached") and fresh:
                        continue
                    details = cached if fresh else _technical_probe(path)
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
                if len(batch) >= 256:
                    flush()
            except InterruptedError:
                with _LOCK:
                    job["cancel"].set()
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



def _external_sources(data):
    root = _root(data.get("path"))
    names = data.get("files")
    if not isinstance(names, list) or not names:
        raise ValueError("Select one or more external media files.")
    if len(names) != len(set(names)):
        raise ValueError("Duplicate source files in request.")
    return root, [_source_file(root, name) for name in names]


def _external_target_folder(root, relative):
    relative = str(relative or "").strip().replace("\\", "/")
    folder = Path(relative)
    if folder.is_absolute() or ".." in folder.parts:
        raise ValueError("Destination must be a folder inside the external root.")
    target = (root / folder).resolve()
    if not target.is_relative_to(root) or not target.is_dir():
        raise ValueError("Destination folder does not exist inside the external root.")
    return target


def create_external_folder(data):
    """Create a folder beneath the explicitly opened external root."""
    root = _root(data.get("path"))
    parent = _external_target_folder(root, data.get("directory"))
    name = str(data.get("name") or "").strip()
    if (not name or name in {".", ".."} or "/" in name or "\\" in name
            or Path(name).name != name):
        raise ValueError("Enter a single folder name.")
    target = parent / name
    if target.exists() or target.is_symlink():
        raise ValueError("A folder or file with that name already exists.")
    target.mkdir()
    return {"ok": True, "folder": target.relative_to(root).as_posix()}


def rename_external_folder(data):
    """Rename an existing folder without touching media or companion paths."""
    root = _root(data.get("path"))
    relative = str(data.get("folder") or "").strip().replace("\\", "/")
    if not relative or Path(relative).is_absolute() or ".." in Path(relative).parts:
        raise ValueError("Select a folder beneath the external root.")
    source = (root / relative).resolve()
    if not source.is_relative_to(root) or source == root or not source.is_dir():
        raise ValueError("Folder does not exist inside the external root.")
    if (root / relative).is_symlink():
        raise ValueError("Cannot rename a linked folder.")
    name = str(data.get("name") or "").strip()
    if not name or name in {".", ".."} or "/" in name or "\\" in name or Path(name).name != name:
        raise ValueError("Enter a single folder name.")
    target = source.with_name(name)
    if source == target:
        return {"ok": True, "folder": relative}
    if target.exists() or target.is_symlink():
        raise ValueError("A file or folder already uses that name.")
    source.rename(target)
    return {"ok": True, "folder": target.relative_to(root).as_posix()}


def move_external_folder(data):
    """Move an external folder atomically while keeping its contents together."""
    root = _root(data.get("path"))
    relative = str(data.get("folder") or "").strip().replace("\\", "/")
    if not relative or Path(relative).is_absolute() or ".." in Path(relative).parts:
        raise ValueError("Select a folder beneath the external root.")
    raw_source = root / relative
    if raw_source.is_symlink():
        raise ValueError("Cannot move a linked folder.")
    source = raw_source.resolve()
    if not source.is_relative_to(root) or source == root or not source.is_dir():
        raise ValueError("Folder does not exist inside the external root.")
    destination = _external_target_folder(root, data.get("destination"))
    if destination == source or destination.is_relative_to(source):
        raise ValueError("Cannot move a folder inside itself.")
    target = destination / source.name
    if target.exists() or target.is_symlink():
        raise ValueError("Destination already contains a file or folder with that name.")
    source.rename(target)
    return {"ok": True, "folder": target.relative_to(root).as_posix()}


def trash_external_folder(data):
    """Move an entire chosen external subfolder to OS Trash, keeping its contents."""
    from send2trash import send2trash
    root = _root(data.get("path"))
    relative = str(data.get("folder") or "").strip().replace("\\", "/")
    if not relative or Path(relative).is_absolute() or ".." in Path(relative).parts:
        raise ValueError("Select a folder beneath the external root.")
    raw = root / relative
    if raw.is_symlink():
        raise ValueError("Cannot trash a linked folder.")
    source = raw.resolve()
    if source == root or not source.is_relative_to(root) or not source.is_dir():
        raise ValueError("External folder does not exist.")
    send2trash(str(source))
    with _LOCK:
        global _index
        if _index is not None and _index["root"] == root:
            # Invalidate the source snapshot: its folder and child paths moved.
            _index = None
    return {"ok": True, "folder": relative}



def move_external_files(data):
    """Move selected media and its adjacent authored/backup files together."""
    root, files = _external_sources(data)
    destination = _external_target_folder(root, data.get("destination"))
    targets = [destination / source.name for source in files]

    # Preflight every output, including captions and reversible edit backups,
    # before moving anything. Several selected media can share a caption.
    transfers = {}
    for source, target in zip(files, targets):
        companions = [
            (source.with_suffix(".txt"), target.with_suffix(".txt")),
            (source.parent / "originals" / source.name,
             destination / "originals" / source.name),
            (source.parent / "originals" / (source.stem + ".txt"),
             destination / "originals" / (source.stem + ".txt")),
        ]
        for old, new in [(source, target)] + companions:
            if old != source and not old.exists() and not old.is_symlink():
                continue
            if old in transfers:
                if transfers[old] != new:
                    raise ValueError("A selected companion has incompatible destinations.")
                continue
            if old == new or old.is_symlink() or new.exists() or new.is_symlink():
                raise ValueError("Destination already contains a file with that name.")
            if new.parent.name == "originals" and new.parent.is_symlink():
                raise ValueError("Destination originals folder cannot be a symlink.")
            transfers[old] = new
    if len(set(transfers.values())) != len(transfers):
        raise ValueError("Selected files would overwrite each other in the destination.")

    moved = []
    # Filesystem movement is authoritative. Metadata is additional context:
    # invalid caches are reported, rather than obstructing a valid file move.
    from .media import _media_metadata_lock, write_media_metadata_file
    warnings = []
    with _media_metadata_lock:
        source_directories = {source.parent for source in files}
        caches = {}
        for directory in source_directories | {destination}:
            try:
                caches[directory] = _read_cache(directory)
            except (OSError, ValueError, json.JSONDecodeError) as exc:
                caches[directory] = None
                warnings.append(f"Could not read metadata for {directory}: {exc}")
        try:
            for old, new in transfers.items():
                if new.parent.name == "originals":
                    new.parent.mkdir(exist_ok=True)
                shutil.move(str(old), str(new))
                moved.append((old, new))
        except Exception as exc:
            rollback_errors = []
            for old, new in reversed(moved):
                try:
                    shutil.move(str(new), str(old))
                except Exception as rollback_exc:
                    rollback_errors.append(str(rollback_exc))
            details = ("; rollback errors: " + "; ".join(rollback_errors)) if rollback_errors else ""
            raise RuntimeError(f"External move failed: {exc}{details}") from exc

        for source in files:
            origin_cache = caches[source.parent]
            destination_cache = caches[destination]
            if origin_cache is not None and destination_cache is not None:
                # The target file was absent. A previously orphaned cache entry
                # is stale and can be replaced by the moved file's actual data.
                metadata = origin_cache.pop(source.name, None)
                if metadata is not None:
                    destination_cache[source.name] = metadata
                else:
                    destination_cache.pop(source.name, None)
        for directory, cache in caches.items():
            if cache is None:
                continue
            try:
                if directory in source_directories or directory == destination:
                    write_media_metadata_file(directory / "media_metadata.json", cache)
            except (OSError, ValueError) as exc:
                warnings.append(f"Files moved, but metadata for {directory} could not be saved: {exc}")

    result = {"ok": True, "moved": [source.relative_to(root).as_posix() for source in files]}
    if warnings:
        result["warning"] = "; ".join(warnings)
    return result


def rename_external_file(data):
    """Rename one external media file without moving it or overwriting a sibling."""
    root = _root(data.get("path"))
    source = _source_file(root, data.get("file"))
    name = str(data.get("newName") or "").strip()
    if (not name or name in {".", ".."} or Path(name).name != name
            or "/" in name or "\\" in name or source.suffix.lower() != Path(name).suffix.lower()):
        raise ValueError("Enter a filename in the same folder, keeping its media extension.")
    target = source.with_name(name)
    if source == target:
        return {"ok": True, "oldPath": source.relative_to(root).as_posix(),
                "newPath": source.relative_to(root).as_posix()}
    if target.exists() or target.is_symlink():
        raise ValueError("A file with that name already exists.")
    # Keep paired captions and Prep's reversible originals in step with the
    # media name, rather than orphaning them after an image edit.
    originals = source.parent / "originals"
    companions = [
        (source.with_suffix(".txt"), target.with_suffix(".txt")),
        (originals / source.name, originals / name),
        (originals / (source.stem + ".txt"), originals / (target.stem + ".txt")),
    ]
    companions = [(old, new) for old, new in companions if old != new and old.exists()]
    for old, new in companions:
        if old.is_symlink() or new.exists() or new.is_symlink():
            raise ValueError("A companion caption or original backup already occupies the new name.")
    # Metadata is supplementary; a malformed cache must not block a normal
    # filesystem rename. Report cache failures while preserving useful work.
    from .media import _media_metadata_lock, write_media_metadata_file
    warning = ""
    with _media_metadata_lock:
        try:
            cache = _read_cache(source.parent)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            cache = None
            warning = "Could not read media metadata: " + str(exc)
        renamed = []
        try:
            for old, new in [(source, target)] + companions:
                old.rename(new)
                renamed.append((old, new))
        except Exception:
            for old, new in reversed(renamed):
                new.rename(old)
            raise
        if cache is not None and source.name in cache:
            cache[name] = cache.pop(source.name)
            try:
                write_media_metadata_file(source.parent / "media_metadata.json", cache)
            except (OSError, ValueError) as exc:
                warning = "File renamed, but media metadata could not be updated: " + str(exc)
    result = {"ok": True, "oldPath": source.relative_to(root).as_posix(),
              "newPath": target.relative_to(root).as_posix()}
    if warning:
        result["warning"] = warning
    return result


def curate_external_file(data):
    """Persist human-authored rating and tags beside source media."""
    root = _root(data.get("path"))
    source = _source_file(root, data.get("file"))
    rating = data.get("rating")
    tags = data.get("tags")
    if rating is not None and (type(rating) is not int or rating < 0 or rating > 5):
        raise ValueError("Rating must be an integer from 0 to 5.")
    if tags is not None:
        if (not isinstance(tags, list) or len(tags) > 40 or
                any(not isinstance(tag, str) or not tag.strip() or len(tag.strip()) > 64
                    for tag in tags)):
            raise ValueError("Tags must be a list of up to 40 labels (64 characters each).")
        tags = list(dict.fromkeys(tag.strip() for tag in tags))
    if rating is None and tags is None:
        raise ValueError("Provide a rating or tags.")
    from .media import _media_metadata_lock, write_media_metadata_file
    with _media_metadata_lock:
        cache = _read_cache(source.parent)
        previous = cache.get(source.name)
        entry = dict(previous) if isinstance(previous, dict) else {}
        stat = source.stat()
        if entry.get("size") != stat.st_size or entry.get("mtime") != int(stat.st_mtime):
            for key in ("resolution", "duration", "quality"):
                entry.pop(key, None)
        entry["size"] = stat.st_size
        entry["mtime"] = int(stat.st_mtime)
        if rating is not None:
            entry["rating"] = rating or None
        if tags is not None:
            entry["tags"] = tags
        cache[source.name] = entry
        write_media_metadata_file(source.parent / "media_metadata.json", cache)
    with _LOCK:
        if _index is not None and _index["root"] == root:
            live = _index["by_path"].get(source.relative_to(root).as_posix())
            if live:
                live["rating"] = entry.get("rating")
                live["tags"] = entry.get("tags") or []
                _index["revision"] += 1
    return {"ok": True, "rating": entry.get("rating"),
            "tags": entry.get("tags") or []}


def edit_external_image(data):
    """Apply Prep's reversible still-image crop/transform to external media."""
    root = _root(data.get("path"))
    source = _source_file(root, data.get("file"))
    from .crop_ops import CROPPABLE_IMAGE_EXTS, crop_image_data_url_in_place, transform_image_in_place
    if source.suffix.lower() not in CROPPABLE_IMAGE_EXTS:
        raise ValueError("This image format cannot be edited with the existing image tools.")
    operation = str(data.get("operation") or "")
    if operation == "crop":
        result = crop_image_data_url_in_place(source.parent, source.name, data.get("imageDataUrl"))
    else:
        result = transform_image_in_place(source.parent, source.name, operation)
    # A fresh Explorer discovery reads actual file bytes and technical facts.
    return {"ok": True, "file": source.relative_to(root).as_posix(), **result}


def trash_external_files(data):
    from send2trash import send2trash
    root, files = _external_sources(data)
    trashed = []
    for source in files:
        try:
            send2trash(str(source))
        except Exception as exc:
            raise RuntimeError(f"Trashed {len(trashed)} files before failing on {source.name}: {exc}") from exc
        relative = source.relative_to(root).as_posix()
        trashed.append(relative)
        # The user just removed this item. Update only that key in the live index;
        # avoid a full filesystem rescan and prevent in-flight discovery republishing it.
        with _LOCK:
            if _index is not None and _index["root"] == root:
                _index["removed"].add(relative)
                previous = _index["by_path"].pop(relative, None)
                if previous is not None:
                    _index["items"][:] = [entry for entry in _index["items"] if entry["relativePath"] != relative]
                    _index["analyzed"] = max(0, _index["analyzed"] - int(bool(previous.get("metadata"))))
                _index["revision"] += 1
    with _LOCK:
        revision = _index["revision"] if _index is not None and _index["root"] == root else None
    return {"ok": True, "trashed": trashed, "revision": revision}


def register_routes(app):
    from .external_exports import register_routes as register_export_routes
    register_export_routes(app)

    @app.post("/fs/media_explorer/external/reveal")
    def external_reveal():
        from .file_ops import open_path_in_explorer_response
        try:
            data = request.get_json(silent=True) or {}
            root = _root(data.get("path"))
            return open_path_in_explorer_response(_source_file(root, data.get("file")))
        except Exception as exc:
            app.logger.exception("EXTERNAL MEDIA REVEAL FAILED")
            return jsonify({"ok": False, "error": str(exc)}), 400

    @app.post("/fs/media_explorer/external/trash-folder")
    def external_trash_folder():
        try:
            return jsonify(trash_external_folder(request.get_json(silent=True) or {}))
        except Exception as exc:
            app.logger.exception("EXTERNAL FOLDER TRASH FAILED")
            return jsonify({"ok": False, "error": str(exc)}), 400

    @app.post("/fs/media_explorer/external/move-folder")
    def external_move_folder():
        try:
            return jsonify(move_external_folder(request.get_json(silent=True) or {}))
        except Exception as exc:
            app.logger.exception("EXTERNAL FOLDER MOVE FAILED")
            return jsonify({"ok": False, "error": str(exc)}), 400

    @app.post("/fs/media_explorer/external/rename-folder")
    def external_rename_folder():
        try:
            return jsonify(rename_external_folder(request.get_json(silent=True) or {}))
        except Exception as exc:
            app.logger.exception("EXTERNAL FOLDER RENAME FAILED")
            return jsonify({"ok": False, "error": str(exc)}), 400

    @app.post("/fs/media_explorer/external/create-folder")
    def external_create_folder():
        try:
            return jsonify(create_external_folder(request.get_json(silent=True) or {}))
        except Exception as exc:
            app.logger.exception("EXTERNAL FOLDER CREATE FAILED")
            return jsonify({"ok": False, "error": str(exc)}), 400

    @app.post("/fs/media_explorer/external/move")
    def external_move():
        try:
            return jsonify(move_external_files(request.get_json(silent=True) or {}))
        except Exception as exc:
            app.logger.exception("EXTERNAL MEDIA MOVE FAILED")
            return jsonify({"ok": False, "error": str(exc)}), 400

    @app.post("/fs/media_explorer/external/rename")
    def external_rename():
        try:
            return jsonify(rename_external_file(request.get_json(silent=True) or {}))
        except Exception as exc:
            app.logger.exception("EXTERNAL MEDIA RENAME FAILED")
            return jsonify({"ok": False, "error": str(exc)}), 400

    @app.post("/fs/media_explorer/external/curate")
    def external_curate():
        try:
            return jsonify(curate_external_file(request.get_json(silent=True) or {}))
        except Exception as exc:
            app.logger.exception("EXTERNAL MEDIA CURATION FAILED")
            return jsonify({"ok": False, "error": str(exc)}), 400

    @app.post("/fs/media_explorer/external/image-edit")
    def external_image_edit():
        try:
            return jsonify(edit_external_image(request.get_json(silent=True) or {}))
        except Exception as exc:
            app.logger.exception("EXTERNAL IMAGE EDIT FAILED")
            return jsonify({"ok": False, "error": str(exc)}), 400

    @app.post("/fs/media_explorer/external/trash")
    def external_trash():
        try:
            return jsonify(trash_external_files(request.get_json(silent=True) or {}))
        except Exception as exc:
            app.logger.exception("EXTERNAL MEDIA TRASH FAILED")
            return jsonify({"ok": False, "error": str(exc)}), 400

    @app.get("/fs/media_explorer/views")
    def media_saved_views():
        try:
            return jsonify({"ok": True, "views": list_saved_views()})
        except Exception as exc:
            app.logger.exception("MEDIA VIEWS LOAD FAILED")
            return jsonify({"ok": False, "error": str(exc)}), 500

    @app.post("/fs/media_explorer/views")
    def media_save_view():
        try:
            return jsonify({"ok": True, "views": save_media_view(request.get_json(silent=True) or {})})
        except (ValueError, OSError) as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400

    @app.post("/fs/media_explorer/views/rename")
    def media_rename_view():
        try:
            return jsonify({"ok": True, "views": rename_media_view(request.get_json(silent=True) or {})})
        except (ValueError, OSError) as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400

    @app.delete("/fs/media_explorer/views")
    def media_delete_view():
        try:
            return jsonify({"ok": True, "views": delete_media_view((request.get_json(silent=True) or {}).get("name"))})
        except (ValueError, OSError) as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400

    @app.get("/fs/media_explorer/external/folders")
    def external_saved_folders():
        try:
            return jsonify({"ok": True, "folders": _recent_paths()})
        except Exception as exc:
            app.logger.exception("EXTERNAL FOLDER HISTORY FAILED")
            return jsonify({"ok": False, "error": str(exc)}), 500

    @app.post("/fs/media_explorer/external/folders")
    def external_remember_folder():
        try:
            return jsonify({"ok": True, "folders": remember_external_path((request.get_json(silent=True) or {}).get("path"))})
        except Exception as exc:
            app.logger.exception("EXTERNAL FOLDER SAVE FAILED")
            return jsonify({"ok": False, "error": str(exc)}), 400

    @app.delete("/fs/media_explorer/external/folders")
    def external_remove_folder():
        try:
            return jsonify({"ok": True, "folders": remove_external_path((request.get_json(silent=True) or {}).get("path"))})
        except Exception as exc:
            app.logger.exception("EXTERNAL FOLDER REMOVE FAILED")
            return jsonify({"ok": False, "error": str(exc)}), 400

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
                # The browser requires child directories even when this page has
                # zero media files; the recursive index contains files, not folders.
                directory = request.args.get("directory")
                folders = _child_directories(snapshot, directory) if directory is not None else []
                return jsonify({**_snapshot_status(snapshot), "items": selected,
                                "folders": folders, "total": len(items),
                                "offset": offset, "limit": limit, "facets": {}})
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
                mode = str(data.get("mode") or "technical")
                if mode not in ("technical", "quality"):
                    raise ValueError("Unknown metadata analysis mode.")
                paths = sorted((item["relativePath"] for item in source
                               if not (_fresh(item, item.get("metadata"))
                                       and (current_quality(item.get("metadata"))
                                            if mode == "quality" else item.get("metadataCached")))),
                               key=lambda name: (str(Path(name).parent), name))
                if (_metadata_job and _metadata_job["running"] and
                        not _metadata_job["cancel"].is_set() and
                        _metadata_job["snapshot"] is snapshot and
                        _metadata_job.get("mode", "technical") == mode):
                    job = _metadata_job
                    additions = [name for name in paths if name not in job["seen"]]
                    job["pending"].extend(additions)
                    job["seen"].update(additions)
                    job["total"] += len(additions)
                else:
                    if (_metadata_job and _metadata_job["running"] and
                            not _metadata_job["cancel"].is_set()):
                        raise ValueError("Finish or stop the active metadata scan before starting a different scan.")
                    job = {"snapshot": snapshot, "mode": mode, "pending": deque(paths), "seen": set(paths),
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
