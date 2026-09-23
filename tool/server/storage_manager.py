import json
import os
import shutil
import tempfile
import time
from pathlib import Path, PurePosixPath

from . import config as app_config
from .epoch_test_bench import delete_session, list_sessions
from .generate_store import MANIFEST_NAME, generation_root
from .inference_runner import stop_storyboard_jobs
from .storyboard_store import delete_story, list_stories, storyboard_root
from .training_action import managed_actions, read_action


CACHE_VERSION = 1
CACHE_FILE = "storage_usage.json"
MEASURABLE_AREAS = {"training", "tests", "generate", "storyboard", "runtime"}
PURGEABLE_AREAS = {"training", "tests", "generate", "storyboard"}


def _cache_path():
    return Path(app_config.FS_ROOT) / ".webcap" / CACHE_FILE


def _read_cache():
    path = _cache_path()
    if not path.is_file():
        return {"version": CACHE_VERSION, "items": {}}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"version": CACHE_VERSION, "items": {}}
    if not isinstance(payload, dict) or payload.get("version") != CACHE_VERSION:
        return {"version": CACHE_VERSION, "items": {}}
    items = payload.get("items")
    if not isinstance(items, dict):
        payload["items"] = {}
    return payload


def _write_cache(payload):
    path = _cache_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=CACHE_FILE + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def _cache_key(area, item_id, folder=""):
    folder_key = str(folder or "").strip().replace("\\", "/").strip("/")
    return area + ":" + folder_key + ":" + str(item_id or "").strip()


def _cached_measurement(cache, area, item_id, folder=""):
    row = (cache.get("items") or {}).get(_cache_key(area, item_id, folder))
    if not isinstance(row, dict):
        return None
    try:
        size = int(row.get("bytes"))
        measured_at = float(row.get("measuredAt"))
    except (TypeError, ValueError):
        return None
    if size < 0 or measured_at <= 0:
        return None
    return {"bytes": size, "measuredAt": measured_at}


def _item(area, item_id, label, path, *, folder="", kind="", status="", purgeable=False, protected_reason="", meta=None, cache=None):
    measurement = _cached_measurement(cache or {}, area, item_id, folder)
    payload = {
        "area": area,
        "id": str(item_id),
        "label": str(label or item_id),
        "kind": str(kind or area),
        "folder": str(folder or ""),
        "status": str(status or ""),
        "purgeable": bool(purgeable),
        "protectedReason": str(protected_reason or ""),
        "measured": measurement is not None,
        "bytes": measurement["bytes"] if measurement else None,
        "measuredAt": measurement["measuredAt"] if measurement else None,
        "openable": Path(path).exists(),
    }
    if isinstance(meta, dict):
        payload["meta"] = meta
    return payload


def _training_items(cache):
    rows = []
    for path, data in managed_actions():
        action_id = str(data.get("actionId") or "")
        rows.append(_item(
            "training",
            action_id,
            data.get("runName") or path.name,
            path,
            kind=data.get("profileLabel") or data.get("profileId") or "Training run",
            status="managed",
            purgeable=True,
            meta={
                "folder": str(data.get("folder") or ""),
                "profileId": str(data.get("profileId") or ""),
                "createdAt": data.get("createdAt"),
            },
            cache=cache,
        ))
    return rows


def _generate_items(cache):
    root = generation_root()
    rows = []
    if not root.is_dir():
        return rows
    for day in sorted(root.iterdir(), key=lambda p: p.name, reverse=True):
        if not day.is_dir() or day.is_symlink():
            continue
        for directory in sorted(day.iterdir(), key=lambda p: p.name, reverse=True):
            if not directory.is_dir() or directory.is_symlink():
                continue
            manifest = directory / MANIFEST_NAME
            if not manifest.is_file():
                continue
            try:
                payload = json.loads(manifest.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(payload, dict) or str(payload.get("jobId") or "") != directory.name:
                continue
            item_id = day.name + "/" + directory.name
            rows.append(_item(
                "generate",
                item_id,
                payload.get("sourcePrompt") or payload.get("resolvedPrompt") or directory.name,
                directory,
                kind=payload.get("modelId") or "Generation",
                status="completed",
                purgeable=True,
                meta={
                    "jobId": directory.name,
                    "createdAt": payload.get("createdAt"),
                    "mediaKind": payload.get("mediaKind"),
                },
                cache=cache,
            ))
    return rows


def _storyboard_items(cache):
    rows = []
    root = storyboard_root()
    for story in list_stories():
        story_id = str(story.get("id") or "")
        path = root / story_id
        rows.append(_item(
            "storyboard",
            story_id,
            story.get("title") or story_id,
            path,
            kind="Story",
            status=story.get("status") or "",
            purgeable=True,
            meta={
                "sceneCount": int(story.get("sceneCount") or 0),
                "updatedAt": story.get("updatedAt"),
                "authored": True,
            },
            cache=cache,
        ))
    return rows


def _test_items(cache, folder):
    folder = str(folder or "").strip()
    if not folder:
        return []
    set_path = app_config.safe_join_fs_root(folder)
    if not set_path.is_dir():
        return []
    rows = []
    for session in list_sessions(set_path):
        session_id = str(session.get("session") or "")
        path = set_path / "test-generations" / session_id
        rows.append(_item(
            "tests",
            session_id,
            session.get("name") or session_id,
            path,
            folder=folder,
            kind=session.get("modelId") or "Test Session",
            status=session.get("status") or "",
            purgeable=str(session.get("status") or "") not in {"queued", "starting", "running", "stopping"},
            protected_reason=(
                "Active Test Session; stop it before deletion."
                if str(session.get("status") or "") in {"queued", "starting", "running", "stopping"} else ""
            ),
            meta={
                "completed": int(session.get("completed") or 0),
                "failed": int(session.get("failed") or 0),
                "total": int(session.get("total") or 0),
                "startedAt": session.get("startedAt"),
            },
            cache=cache,
        ))
    return rows


def _runtime_items(cache):
    rows = []
    root = Path(app_config.FS_ROOT)
    reference_root = root / ".webcap_runtime" / "generate-references"
    if reference_root.exists():
        rows.append(_item(
            "runtime", "generate-references", "Generate references", reference_root,
            kind="Transient references", status="runtime", purgeable=False,
            protected_reason="Transient references are lifecycle-managed, not manually purged here.",
            cache=cache,
        ))
    probes_root = root / ".webcap_training" / "h3-probes"
    if probes_root.is_dir():
        for probe in sorted(probes_root.iterdir(), key=lambda p: p.name, reverse=True):
            if not probe.is_dir() or probe.is_symlink():
                continue
            rows.append(_item(
                "runtime", "h3-probe/" + probe.name, probe.name, probe,
                kind="H3 probe", status="calibration", purgeable=False,
                protected_reason="Probe deletion is not enabled in the MVP.",
                cache=cache,
            ))
    return rows


def _category(area, label, items, complete=True, note=""):
    measured = [item for item in items if item.get("measured")]
    return {
        "area": area,
        "label": label,
        "count": len(items),
        "measuredCount": len(measured),
        "bytes": sum(int(item.get("bytes") or 0) for item in measured),
        "complete": bool(complete),
        "note": str(note or ""),
    }


def overview(folder=""):
    usage = shutil.disk_usage(app_config.FS_ROOT)
    cache = _read_cache()
    groups = {
        "training": _training_items(cache),
        "tests": _test_items(cache, folder),
        "generate": _generate_items(cache),
        "storyboard": _storyboard_items(cache),
        "runtime": _runtime_items(cache),
    }
    categories = [
        _category("training", "Training", groups["training"]),
        _category(
            "tests", "Tests", groups["tests"], complete=False,
            note=("Showing the current Set only; WebCap does not perform a global Test Session crawl.")
        ),
        _category("generate", "Generations", groups["generate"]),
        _category("storyboard", "Storyboard", groups["storyboard"]),
        _category("runtime", "Runtime / Temporary", groups["runtime"]),
    ]
    categories.sort(key=lambda row: (row["bytes"], row["count"]), reverse=True)
    return {
        "ok": True,
        "disk": {
            "path": str(app_config.FS_ROOT),
            "total": int(usage.total),
            "used": int(usage.used),
            "free": int(usage.free),
        },
        "folder": str(folder or ""),
        "categories": categories,
        "items": groups,
    }


def _safe_recursive_size(path):
    root = Path(path)
    if not root.exists():
        raise FileNotFoundError("Storage item no longer exists.")
    if root.is_symlink():
        raise RuntimeError("Storage Manager will not measure symlinked roots.")
    if root.is_file():
        return root.stat().st_size
    total = 0
    stack = [root]
    while stack:
        directory = stack.pop()
        with os.scandir(directory) as entries:
            for entry in entries:
                if entry.is_symlink():
                    continue
                if entry.is_file(follow_symlinks=False):
                    total += entry.stat(follow_symlinks=False).st_size
                elif entry.is_dir(follow_symlinks=False):
                    stack.append(Path(entry.path))
    return total


def _resolve_generate(item_id):
    parts = PurePosixPath(str(item_id or "")).parts
    if len(parts) != 2 or any(part in {"", ".", ".."} for part in parts):
        raise ValueError("Generation storage ID is invalid.")
    root = generation_root().resolve()
    directory = (root / parts[0] / parts[1]).resolve()
    if directory.parent.parent != root or directory.is_symlink():
        raise ValueError("Generation storage ID escaped the managed root.")
    manifest = directory / MANIFEST_NAME
    if not directory.is_dir() or not manifest.is_file():
        raise FileNotFoundError("Generation result is unavailable.")
    payload = json.loads(manifest.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or str(payload.get("jobId") or "") != parts[1]:
        raise RuntimeError("Generation manifest does not own this directory.")
    return directory


def _resolve_test(folder, session_id):
    folder = str(folder or "").strip()
    if not folder:
        raise ValueError("Current Set is required for Test Session storage.")
    set_path = app_config.safe_join_fs_root(folder).resolve()
    root = (set_path / "test-generations").resolve()
    session = (root / str(session_id or "")).resolve()
    if session.parent != root or session.is_symlink() or not (session / "test.json").is_file():
        raise FileNotFoundError("Test Session is unavailable.")
    return session


def _resolve_runtime(item_id):
    root = Path(app_config.FS_ROOT).resolve()
    value = str(item_id or "")
    if value == "generate-references":
        return root / ".webcap_runtime" / "generate-references"
    if value.startswith("h3-probe/"):
        name = value.split("/", 1)[1]
        if not name or Path(name).name != name:
            raise ValueError("H3 probe storage ID is invalid.")
        path = root / ".webcap_training" / "h3-probes" / name
        if path.is_symlink():
            raise ValueError("H3 probe storage path is symlinked.")
        return path
    raise ValueError("Runtime storage ID is invalid.")


def resolve_item(area, item_id, folder=""):
    area = str(area or "").strip()
    if area == "training":
        return read_action(item_id)[0]
    if area == "tests":
        return _resolve_test(folder, item_id)
    if area == "generate":
        return _resolve_generate(item_id)
    if area == "storyboard":
        story_id = str(item_id or "").strip()
        stories = {str(row.get("id") or "") for row in list_stories()}
        if story_id not in stories:
            raise FileNotFoundError("Story is unavailable.")
        path = (storyboard_root() / story_id).resolve()
        if path.is_symlink():
            raise ValueError("Storyboard storage path is symlinked.")
        return path
    if area == "runtime":
        return _resolve_runtime(item_id)
    raise ValueError("Unsupported Storage area.")


def measure(area, item_id, folder=""):
    if area not in MEASURABLE_AREAS:
        raise ValueError("Unsupported Storage measurement area.")
    path = resolve_item(area, item_id, folder)
    size = _safe_recursive_size(path)
    measured_at = time.time()
    cache = _read_cache()
    items = cache.setdefault("items", {})
    items[_cache_key(area, item_id, folder)] = {
        "bytes": int(size),
        "measuredAt": measured_at,
    }
    _write_cache(cache)
    return {"ok": True, "area": area, "id": item_id, "folder": folder, "bytes": int(size), "measuredAt": measured_at}


def open_path(area, item_id, folder=""):
    return resolve_item(area, item_id, folder)


def _training_queue_references(action_id):
    path = Path(app_config.FS_ROOT) / ".webcap_training" / "queue.json"
    if not path.is_file():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("Training queue state is unreadable; refusing Storage deletion.") from exc
    jobs = payload.get("jobs") if isinstance(payload, dict) else None
    if not isinstance(jobs, list):
        raise RuntimeError("Training queue state is invalid; refusing Storage deletion.")
    refs = []
    for job in jobs:
        if not isinstance(job, dict):
            continue
        status = str(job.get("status") or "")
        if status in {"completed", "finished_early", "failed", "stopped", "interrupted", "cancelled"}:
            continue
        if str(job.get("actionId") or "") == action_id or str(job.get("resumeActionId") or "") == action_id:
            refs.append(str(job.get("id") or "unknown"))
    return refs


def purge(area, item_id, folder=""):
    area = str(area or "").strip()
    if area not in PURGEABLE_AREAS:
        raise ValueError("This Storage area cannot be purged.")

    if area == "training":
        path, _manifest = read_action(item_id)
        refs = _training_queue_references(str(item_id))
        if refs:
            raise RuntimeError("Training action is referenced by queued or active work: " + ", ".join(refs))
        if path.is_symlink():
            raise RuntimeError("Training action folder is symlinked.")
        shutil.rmtree(path)
        try:
            path.parent.rmdir()
        except OSError:
            pass
    elif area == "tests":
        set_path = app_config.safe_join_fs_root(folder)
        delete_session(set_path, item_id)
    elif area == "generate":
        path = _resolve_generate(item_id)
        shutil.rmtree(path)
        try:
            path.parent.rmdir()
        except OSError:
            pass
    elif area == "storyboard":
        story_id = str(item_id or "").strip()
        resolve_item("storyboard", story_id)
        stop_storyboard_jobs(story_id)
        delete_story(story_id)

    cache = _read_cache()
    cache.get("items", {}).pop(_cache_key(area, item_id, folder), None)
    _write_cache(cache)
    return {"ok": True, "area": area, "id": item_id, "folder": folder}
