import json
import os
import shutil
import tempfile
import time
from pathlib import Path, PurePosixPath

from . import config as app_config
from .epoch_test_bench import delete_session
from .generate_store import MANIFEST_NAME
from .execution_queue import lane_snapshot as execution_lane_snapshot
from . import inference_runtime
from .inference_runner import stop_storyboard_jobs
from .storyboard_store import delete_story, list_stories, storyboard_root
from .training_action import managed_actions, read_action
from .training_test_paths import TEST_COPY_STAGE_LABELS, test_copy_destination


CACHE_VERSION = 1
CACHE_FILE = "storage_usage.json"
MEASURABLE_AREAS = {"training", "tests", "staged", "generate", "storyboard", "set", "runtime", "comfy"}
PURGEABLE_AREAS = {"training", "tests", "staged", "generate", "storyboard", "runtime", "comfy"}
ACTIVE_TEST_STATUSES = {"queued", "starting", "running", "stopping"}
ACTIVE_H3_PROBE_STATUSES = {"running", "stopping"}


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
    references = _training_queue_reference_map()
    for path, data in managed_actions():
        action_id = str(data.get("actionId") or "")
        refs = references.get(action_id, [])
        rows.append(_item(
            "training",
            action_id,
            data.get("runName") or path.name,
            path,
            kind=data.get("profileLabel") or data.get("profileId") or "Training run",
            status=("active / queued" if refs else "managed"),
            purgeable=not refs,
            protected_reason=(
                "Referenced by queued or active Training work: " + ", ".join(refs)
                if refs else ""
            ),
            meta={
                "folder": str(data.get("folder") or ""),
                "profileId": str(data.get("profileId") or ""),
                "createdAt": data.get("createdAt"),
            },
            cache=cache,
        ))
    return rows


def _active_generate_job_ids():
    active = set()
    snapshot = execution_lane_snapshot("inference", include_terminal=False)
    for job in snapshot.get("jobs") or []:
        if not isinstance(job, dict):
            continue
        metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
        if str(metadata.get("client") or "") == "generate":
            job_id = str(job.get("id") or "").strip()
            if job_id:
                active.add(job_id)
    return active


def _generate_items(cache):
    root = Path(app_config.FS_ROOT) / "output" / "generations"
    active_jobs = _active_generate_job_ids()
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
            active = directory.name in active_jobs
            rows.append(_item(
                "generate",
                item_id,
                payload.get("sourcePrompt") or payload.get("resolvedPrompt") or directory.name,
                directory,
                kind=payload.get("modelId") or "Generation",
                status=("finalizing" if active else "completed"),
                purgeable=not active,
                protected_reason=("Referenced by active Generate work." if active else ""),
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


def _read_test_session_manifest(session_path):
    manifest = Path(session_path) / "test.json"
    if manifest.is_symlink() or not manifest.is_file():
        raise FileNotFoundError("Test Session manifest is unavailable.")
    try:
        payload = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("Test Session manifest is unreadable; refusing Storage ownership decisions.") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("Test Session manifest is invalid; refusing Storage ownership decisions.")
    return payload


def _test_items(cache, folder):
    folder = str(folder or "").strip()
    if not folder:
        return []
    set_path = app_config.safe_join_fs_root(folder)
    if not set_path.is_dir():
        return []
    rows = []
    root = set_path / "test-generations"
    if not root.is_dir():
        return rows
    for path in sorted(root.iterdir(), key=lambda candidate: candidate.name.lower(), reverse=True):
        if not path.is_dir() or path.is_symlink():
            continue
        try:
            session = _read_test_session_manifest(path)
        except (FileNotFoundError, RuntimeError):
            continue
        session_id = path.name
        status = str(session.get("status") or "")
        active = status in ACTIVE_TEST_STATUSES
        rows.append(_item(
            "tests",
            session_id,
            session.get("name") or session_id,
            path,
            folder=folder,
            kind=session.get("modelId") or session.get("model") or "Test Session",
            status=status,
            purgeable=not active,
            protected_reason=("Active Test Session; stop it before deletion." if active else ""),
            meta={
                "completed": int(session.get("completed") or 0),
                "failed": int(session.get("failed") or 0),
                "total": int(session.get("total") or 0),
                "startedAt": session.get("startedAt"),
            },
            cache=cache,
        ))
    return rows


def _normalized_folder_key(value):
    return str(value or "").strip().replace("\\", "/").strip("/")


def _active_staged_test_candidates(folder):
    folder_key = _normalized_folder_key(folder)
    active = set()
    snapshot = execution_lane_snapshot("inference", include_terminal=False)
    for job in snapshot.get("jobs") or []:
        if not isinstance(job, dict):
            continue
        metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
        if str(metadata.get("client") or "") != "test":
            continue
        if _normalized_folder_key(metadata.get("folder")) != folder_key:
            continue
        if str(metadata.get("candidateKind") or "") != "lora":
            continue
        candidate = str(metadata.get("candidateFile") or "").strip()
        if candidate:
            active.add(candidate)
    return active


def _read_staged_provenance(candidate, stage, folder):
    path = Path(candidate)
    sidecar = path.with_suffix(".webcap.json")
    if path.is_symlink() or not path.is_file() or sidecar.is_symlink() or not sidecar.is_file():
        return None
    try:
        payload = json.loads(sidecar.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or payload.get("version") != 1:
        return None
    if str(payload.get("stage") or "").strip().lower() != str(stage or "").strip().lower():
        return None
    if _normalized_folder_key(payload.get("sourceFolder")) != _normalized_folder_key(folder):
        return None
    if not str(payload.get("sourceJobId") or "").strip():
        return None
    try:
        source_epoch = int(payload.get("sourceEpoch"))
    except (TypeError, ValueError):
        return None
    if source_epoch < 0 or not str(payload.get("sourceFileName") or "").strip():
        return None
    return payload


def _staged_items(cache, folder):
    folder = str(folder or "").strip()
    if not folder:
        return []
    set_path = app_config.safe_join_fs_root(folder)
    if not set_path.is_dir():
        return []

    active_candidates = _active_staged_test_candidates(folder)
    rows = []
    for stage, stage_label in TEST_COPY_STAGE_LABELS.items():
        try:
            root, parts = test_copy_destination(stage, set_path.name)
        except (FileNotFoundError, RuntimeError, ValueError):
            continue
        directory = root.joinpath(*parts)
        if directory.is_symlink() or not directory.is_dir():
            continue
        for candidate in sorted(directory.iterdir(), key=lambda path: path.name.lower()):
            if candidate.suffix.lower() != ".safetensors":
                continue
            provenance = _read_staged_provenance(candidate, stage, folder)
            if provenance is None:
                continue
            active = candidate.name in active_candidates
            rows.append(_item(
                "staged",
                stage + "/" + candidate.name,
                candidate.name,
                candidate,
                folder=folder,
                kind=stage_label + " staged Test LoRA",
                status=("in active Test queue" if active else "staged copy"),
                purgeable=not active,
                protected_reason=("Referenced by queued or active Test work." if active else ""),
                meta={
                    "stage": stage,
                    "sourceJobId": provenance.get("sourceJobId"),
                    "sourceEpoch": provenance.get("sourceEpoch"),
                    "sourceRunName": provenance.get("sourceRunName"),
                },
                cache=cache,
            ))
    return rows


def _set_items(cache, folder):
    folder = str(folder or "").strip()
    if not folder:
        return []
    set_path = app_config.safe_join_fs_root(folder)
    if not set_path.is_dir():
        return []
    rows = []
    known = (
        ("originals", "Originals", "Reversible source-media safety copies"),
        ("auto_dataset", "Prepared dataset", "Rebuildable Set preparation"),
        ("media_metadata.json", "Media metadata", "WebCap analysis cache"),
        (".webcap_state.json", "Set state", "WebCap authored Set state"),
    )
    for item_id, label, kind in known:
        path = set_path / item_id
        if not path.exists() or path.is_symlink():
            continue
        rows.append(_item(
            "set",
            item_id,
            label,
            path,
            folder=folder,
            kind=kind,
            status="protected",
            purgeable=False,
            protected_reason="Set-owned data is never deleted from Storage Manager.",
            cache=cache,
        ))
    return rows


def _read_h3_probe_state(probe_path):
    probe = Path(probe_path)
    seed_path = probe / "seed.json"
    if seed_path.is_symlink() or not seed_path.is_file():
        raise RuntimeError("H3 probe ownership seed is unavailable.")
    try:
        seed = json.loads(seed_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("H3 probe ownership seed is unreadable.") from exc
    if not isinstance(seed, dict) or str(seed.get("id") or "") != probe.name:
        raise RuntimeError("H3 probe ownership seed does not match its directory.")

    runtime_path = probe / "runtime.json"
    if runtime_path.is_symlink():
        raise RuntimeError("H3 probe runtime state is unsafe.")
    if not runtime_path.exists():
        return {
            "status": "prepared",
            "purgeable": True,
            "protectedReason": "",
            "createdAt": seed.get("createdAt"),
        }
    if not runtime_path.is_file():
        raise RuntimeError("H3 probe runtime state is unsafe.")
    try:
        runtime = json.loads(runtime_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("H3 probe runtime state is unreadable.") from exc
    if not isinstance(runtime, dict) or str(runtime.get("probeId") or "") != probe.name:
        raise RuntimeError("H3 probe runtime state does not match its directory.")

    status = str(runtime.get("status") or "").strip().lower()
    if not status:
        raise RuntimeError("H3 probe runtime state has no status.")
    active = status in ACTIVE_H3_PROBE_STATUSES
    return {
        "status": status,
        "purgeable": not active,
        "protectedReason": ("Active H3 probe; stop it before deletion." if active else ""),
        "createdAt": seed.get("createdAt"),
    }


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
            try:
                probe_state = _read_h3_probe_state(probe)
            except RuntimeError:
                continue
            rows.append(_item(
                "runtime", "h3-probe/" + probe.name, probe.name, probe,
                kind="H3 probe", status=probe_state["status"], purgeable=probe_state["purgeable"],
                protected_reason=probe_state["protectedReason"],
                meta={"createdAt": probe_state.get("createdAt")},
                cache=cache,
            ))
    return rows


def _safe_directories(path):
    root = Path(path)
    if root.is_symlink() or not root.is_dir():
        return []
    return [
        child for child in sorted(root.iterdir(), key=lambda candidate: candidate.name.lower())
        if child.is_dir() and not child.is_symlink()
    ]


def _comfy_active_identities():
    active = {
        "generate": set(),
        "storyboard": set(),
        "tests": set(),
    }
    snapshot = execution_lane_snapshot("inference", include_terminal=False)
    for job in snapshot.get("jobs") or []:
        if not isinstance(job, dict):
            continue
        job_id = str(job.get("id") or "").strip()
        metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
        client = str(metadata.get("client") or "").strip()
        if client == "generate" and job_id:
            active["generate"].add(job_id)
        elif client == "storyboard" and job_id:
            story_id = str(metadata.get("storyId") or "").strip()
            scene_id = str(metadata.get("sceneId") or "").strip()
            if story_id and scene_id:
                active["storyboard"].add((story_id, scene_id, job_id))
        elif client == "test":
            session_id = str(metadata.get("sessionId") or "").strip()
            if session_id:
                active["tests"].add(session_id)
    return active


def _comfy_items(cache):
    provider_root = inference_runtime.known_provider_root()
    if provider_root is None:
        return []

    active = _comfy_active_identities()
    rows = []
    for side in ("input", "output"):
        side_root = provider_root / side
        if side_root.is_symlink() or not side_root.is_dir():
            continue
        generate_root = side_root / "webcap-generate"
        for job_root in _safe_directories(generate_root):
            job_id = job_root.name
            is_active = job_id in active["generate"]
            rows.append(_item(
                "comfy",
                side + "/generate/" + job_id,
                "Generate " + job_id,
                job_root,
                kind="ComfyUI " + side + " scratch",
                status=("active provider work" if is_active else "residual scratch"),
                purgeable=not is_active,
                protected_reason=("Referenced by queued or active Generate work." if is_active else ""),
                cache=cache,
            ))

        storyboard_root_path = side_root / "webcap-storyboard"
        for story_root_path in _safe_directories(storyboard_root_path):
            for scene_root in _safe_directories(story_root_path):
                for job_root in _safe_directories(scene_root):
                    identity = (story_root_path.name, scene_root.name, job_root.name)
                    is_active = identity in active["storyboard"]
                    rows.append(_item(
                        "comfy",
                        side + "/storyboard/" + "/".join(identity),
                        "Storyboard " + story_root_path.name + " / " + scene_root.name + " / " + job_root.name,
                        job_root,
                        kind="ComfyUI " + side + " scratch",
                        status=("active provider work" if is_active else "residual scratch"),
                        purgeable=not is_active,
                        protected_reason=("Referenced by queued or active Storyboard work." if is_active else ""),
                        cache=cache,
                    ))

        tests_root = side_root / "webcap-tests"
        for session_root in _safe_directories(tests_root):
            for candidate_root in _safe_directories(session_root):
                is_active = session_root.name in active["tests"]
                rows.append(_item(
                    "comfy",
                    side + "/tests/" + session_root.name + "/" + candidate_root.name,
                    "Tests " + session_root.name + " / " + candidate_root.name,
                    candidate_root,
                    kind="ComfyUI " + side + " scratch",
                    status=("active provider work" if is_active else "residual scratch"),
                    purgeable=not is_active,
                    protected_reason=("Referenced by queued or active Test work." if is_active else ""),
                    cache=cache,
                ))
    return rows


def _resolve_comfy(item_id):
    provider_root = inference_runtime.known_provider_root()
    if provider_root is None:
        raise FileNotFoundError("ComfyUI provider root is not known yet.")

    parts = PurePosixPath(str(item_id or "")).parts
    if len(parts) < 3 or parts[0] not in {"input", "output"}:
        raise ValueError("ComfyUI storage ID is invalid.")
    side, family = parts[0], parts[1]
    names = parts[2:]
    expected = {
        "generate": (1, "webcap-generate"),
        "storyboard": (3, "webcap-storyboard"),
        "tests": (2, "webcap-tests"),
    }
    if family not in expected:
        raise ValueError("ComfyUI storage family is invalid.")
    count, prefix = expected[family]
    if len(names) != count or any(not name or Path(name).name != name for name in names):
        raise ValueError("ComfyUI storage identity is invalid.")

    raw_side_root = provider_root / side
    if raw_side_root.is_symlink() or not raw_side_root.is_dir():
        raise FileNotFoundError("ComfyUI " + side + " root is unavailable.")
    side_root = raw_side_root.resolve()
    raw_path = raw_side_root / prefix
    if raw_path.is_symlink():
        raise ValueError("ComfyUI storage path is symlinked.")
    for name in names:
        raw_path = raw_path / name
        if raw_path.is_symlink():
            raise ValueError("ComfyUI storage path is symlinked.")
    path = raw_path.resolve()
    if not path.is_dir() or side_root not in path.parents:
        raise FileNotFoundError("ComfyUI storage item is unavailable.")
    return path, family, tuple(names)


def _comfy_identity_active(family, names):
    active = _comfy_active_identities()
    if family == "generate":
        return names[0] in active["generate"]
    if family == "storyboard":
        return tuple(names) in active["storyboard"]
    if family == "tests":
        return names[0] in active["tests"]
    return True


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
        "staged": _staged_items(cache, folder),
        "generate": _generate_items(cache),
        "storyboard": _storyboard_items(cache),
        "set": _set_items(cache, folder),
        "runtime": _runtime_items(cache),
        "comfy": _comfy_items(cache),
    }
    categories = [
        _category("training", "Training", groups["training"]),
        _category(
            "tests", "Tests", groups["tests"], complete=False,
            note=("Showing the current Set only; WebCap does not perform a global Test Session crawl.")
        ),
        _category(
            "staged", "Staged Test LoRAs", groups["staged"], complete=False,
            note=("Showing WebCap-owned staged copies for the current Set in configured Test roots only.")
        ),
        _category("generate", "Generations", groups["generate"]),
        _category("storyboard", "Storyboard", groups["storyboard"]),
        _category("set", "Current Set (protected)", groups["set"], note="Visible for accounting only; Set-owned data is not purgeable here."),
        _category("runtime", "Runtime / Temporary", groups["runtime"]),
        _category(
            "comfy", "ComfyUI Scratch", groups["comfy"],
            note=("Exact WebCap-prefixed job trees only; the provider root is learned from a real ComfyUI output path.")
        ),
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
    raw_root = Path(app_config.FS_ROOT) / "output" / "generations"
    raw_day = raw_root / parts[0]
    raw_directory = raw_day / parts[1]
    if raw_root.is_symlink() or raw_day.is_symlink() or raw_directory.is_symlink():
        raise ValueError("Generation storage path is symlinked.")
    root = raw_root.resolve()
    directory = raw_directory.resolve()
    if directory.parent.parent != root:
        raise ValueError("Generation storage ID escaped the managed root.")
    manifest = directory / MANIFEST_NAME
    if not directory.is_dir() or manifest.is_symlink() or not manifest.is_file():
        raise FileNotFoundError("Generation result is unavailable.")
    payload = json.loads(manifest.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or str(payload.get("jobId") or "") != parts[1]:
        raise RuntimeError("Generation manifest does not own this directory.")
    return directory


def _resolve_test(folder, session_id):
    folder = str(folder or "").strip()
    if not folder:
        raise ValueError("Current Set is required for Test Session storage.")
    raw_set_path = app_config.safe_join_fs_root(folder)
    raw_root = raw_set_path / "test-generations"
    raw_session = raw_root / str(session_id or "")
    if raw_root.is_symlink() or raw_session.is_symlink():
        raise ValueError("Test Session storage path is symlinked.")
    set_path = raw_set_path.resolve()
    root = raw_root.resolve()
    session = raw_session.resolve()
    manifest = session / "test.json"
    if root.parent != set_path or session.parent != root or manifest.is_symlink() or not manifest.is_file():
        raise FileNotFoundError("Test Session is unavailable.")
    return session


def _resolve_h3_probe(item_id):
    value = str(item_id or "")
    if not value.startswith("h3-probe/"):
        raise ValueError("H3 probe storage ID is invalid.")
    name = value.split("/", 1)[1]
    if not name or Path(name).name != name:
        raise ValueError("H3 probe storage ID is invalid.")

    raw_root = Path(app_config.FS_ROOT) / ".webcap_training" / "h3-probes"
    raw_path = raw_root / name
    if raw_root.is_symlink() or raw_path.is_symlink():
        raise ValueError("H3 probe storage path is symlinked.")
    root = raw_root.resolve()
    path = raw_path.resolve()
    if path.parent != root or not path.is_dir():
        raise FileNotFoundError("H3 probe storage item is unavailable.")
    return path, _read_h3_probe_state(path)


def _resolve_staged(folder, item_id):
    folder = str(folder or "").strip()
    if not folder:
        raise ValueError("Current Set is required for staged Test storage.")
    parts = PurePosixPath(str(item_id or "")).parts
    if len(parts) != 2:
        raise ValueError("Staged Test storage ID is invalid.")
    stage, filename = parts
    if stage not in TEST_COPY_STAGE_LABELS:
        raise ValueError("Staged Test storage stage is invalid.")
    if not filename or Path(filename).name != filename or not filename.lower().endswith(".safetensors"):
        raise ValueError("Staged Test storage filename is invalid.")

    set_path = app_config.safe_join_fs_root(folder)
    if not set_path.is_dir():
        raise FileNotFoundError("Current Set is unavailable.")
    root, destination_parts = test_copy_destination(stage, set_path.name)
    directory = root.joinpath(*destination_parts)
    if directory.is_symlink() or not directory.is_dir():
        raise FileNotFoundError("Configured staged Test directory is unavailable.")
    candidate = directory / filename
    provenance = _read_staged_provenance(candidate, stage, folder)
    if provenance is None:
        raise RuntimeError("Staged Test artifact ownership could not be proven.")
    return candidate, candidate.with_suffix(".webcap.json"), provenance


def _resolve_runtime(item_id):
    root = Path(app_config.FS_ROOT).resolve()
    value = str(item_id or "")
    if value == "generate-references":
        path = root / ".webcap_runtime" / "generate-references"
        if path.is_symlink():
            raise ValueError("Generate reference storage path is symlinked.")
        return path
    if value.startswith("h3-probe/"):
        return _resolve_h3_probe(value)[0]
    raise ValueError("Runtime storage ID is invalid.")


def resolve_item(area, item_id, folder=""):
    area = str(area or "").strip()
    if area == "training":
        return read_action(item_id)[0]
    if area == "tests":
        return _resolve_test(folder, item_id)
    if area == "staged":
        return _resolve_staged(folder, item_id)[0]
    if area == "generate":
        return _resolve_generate(item_id)
    if area == "storyboard":
        story_id = str(item_id or "").strip()
        stories = {str(row.get("id") or "") for row in list_stories()}
        if story_id not in stories:
            raise FileNotFoundError("Story is unavailable.")
        root = storyboard_root().resolve()
        raw_path = storyboard_root() / story_id
        if raw_path.is_symlink():
            raise ValueError("Storyboard storage path is symlinked.")
        path = raw_path.resolve()
        if path.parent != root:
            raise ValueError("Storyboard storage path escaped the managed root.")
        return path
    if area == "set":
        folder = str(folder or "").strip()
        if not folder:
            raise ValueError("Current Set is required for Set storage.")
        allowed = {"originals", "auto_dataset", "media_metadata.json", ".webcap_state.json"}
        item_name = str(item_id or "").strip()
        if item_name not in allowed:
            raise ValueError("Unsupported Set storage item.")
        set_path = app_config.safe_join_fs_root(folder).resolve()
        raw_path = set_path / item_name
        if raw_path.is_symlink():
            raise ValueError("Set storage path is symlinked.")
        path = raw_path.resolve()
        if path.parent != set_path:
            raise ValueError("Set storage path escaped the current Set.")
        if not path.exists():
            raise FileNotFoundError("Set storage item is unavailable.")
        return path
    if area == "runtime":
        return _resolve_runtime(item_id)
    if area == "comfy":
        return _resolve_comfy(item_id)[0]
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


def _training_queue_reference_map():
    path = Path(app_config.FS_ROOT) / ".webcap_training" / "queue.json"
    if not path.is_file():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("Training queue state is unreadable; refusing Storage ownership decisions.") from exc
    jobs = payload.get("jobs") if isinstance(payload, dict) else None
    if not isinstance(jobs, list):
        raise RuntimeError("Training queue state is invalid; refusing Storage ownership decisions.")
    references = {}
    for job in jobs:
        if not isinstance(job, dict):
            continue
        status = str(job.get("status") or "")
        if status in {"completed", "finished_early", "failed", "stopped", "interrupted", "cancelled"}:
            continue
        job_id = str(job.get("id") or "unknown")
        for key in ("actionId", "resumeActionId"):
            action_id = str(job.get(key) or "").strip()
            if action_id:
                references.setdefault(action_id, [])
                if job_id not in references[action_id]:
                    references[action_id].append(job_id)
    return references


def _training_queue_references(action_id):
    return _training_queue_reference_map().get(str(action_id or ""), [])


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
        session = _resolve_test(folder, item_id)
        session_payload = _read_test_session_manifest(session)
        status = str(session_payload.get("status") or "").strip().lower()
        if status in ACTIVE_TEST_STATUSES:
            raise RuntimeError("Active Test Session; stop it before deletion.")
        set_path = app_config.safe_join_fs_root(folder)
        delete_session(set_path, item_id)
    elif area == "staged":
        candidate, sidecar, _provenance = _resolve_staged(folder, item_id)
        if candidate.name in _active_staged_test_candidates(folder):
            raise RuntimeError("Staged Test artifact is referenced by queued or active Test work.")
        candidate.unlink()
        try:
            sidecar.unlink()
        except FileNotFoundError:
            pass
    elif area == "generate":
        path = _resolve_generate(item_id)
        job_id = path.name
        if job_id in _active_generate_job_ids():
            raise RuntimeError("Generation result is still referenced by active Generate work.")
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
    elif area == "runtime":
        if not str(item_id or "").startswith("h3-probe/"):
            raise ValueError("This Runtime storage item is lifecycle-managed and cannot be purged manually.")
        path, probe_state = _resolve_h3_probe(item_id)
        if not probe_state.get("purgeable"):
            raise RuntimeError(probe_state.get("protectedReason") or "H3 probe is not safe to delete.")
        shutil.rmtree(path)
    elif area == "comfy":
        path, family, names = _resolve_comfy(item_id)
        if _comfy_identity_active(family, names):
            raise RuntimeError("ComfyUI scratch is referenced by queued or active inference work.")
        shutil.rmtree(path)

    cache = _read_cache()
    cache.get("items", {}).pop(_cache_key(area, item_id, folder), None)
    _write_cache(cache)
    return {"ok": True, "area": area, "id": item_id, "folder": folder}
