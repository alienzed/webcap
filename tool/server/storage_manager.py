import json
import os
import re
import shutil
import tempfile
import threading
import time
import uuid
from pathlib import Path, PurePosixPath

from . import config as app_config
from .epoch_test_bench import delete_session
from .generate_store import MANIFEST_NAME
from .execution_queue import get_job as execution_get_job, lane_snapshot as execution_lane_snapshot
from . import inference_runtime
from .storyboard_store import delete_take, list_stories, load_story, storyboard_root
from .training_action import managed_actions, read_action
from .training_test_paths import TEST_COPY_STAGE_LABELS, test_copy_destination


CACHE_VERSION = 1
CACHE_FILE = "storage_usage.json"
MEASURABLE_AREAS = {"training", "tests", "staged", "generate", "storyboard", "set", "runtime", "comfy"}
PURGEABLE_AREAS = {"training", "tests", "staged", "generate", "storyboard", "runtime", "comfy"}
ACTIVE_TEST_STATUSES = {"queued", "starting", "running", "stopping"}
ACTIVE_H3_PROBE_STATUSES = {"running", "stopping"}
GENERATE_REFERENCE_TOKEN_RE = re.compile(r"^[0-9]+-[0-9a-f]{12}$")
_CACHE_LOCK = threading.RLock()
_SCAN_LOCK = threading.Lock()
_SCAN_STATE = None
_SCAN_CANCEL = None


class _ScanCancelled(RuntimeError):
    pass


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
    result = {"bytes": size, "measuredAt": measured_at}
    try:
        file_count = int(row.get("fileCount"))
    except (TypeError, ValueError):
        file_count = None
    if file_count is not None and file_count >= 0:
        result["fileCount"] = file_count
    source = str(row.get("source") or "").strip()
    if source:
        result["source"] = source
    return result


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
        "fileCount": measurement.get("fileCount") if measurement else None,
        "measurementSource": measurement.get("source") if measurement else "",
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
    root = app_config.output_root() / "generations"
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


def _storyboard_take_is_referenced(story, take_id, media_path):
    take_id = str(take_id or "")
    media_path = str(media_path or "")
    for scene_map in (story.get("scenes"), story.get("removedScenes")):
        if not isinstance(scene_map, dict):
            continue
        for scene in scene_map.values():
            if not isinstance(scene, dict):
                continue
            for reference in scene.get("references") or []:
                if not isinstance(reference, dict):
                    continue
                if (
                    str(reference.get("sourceTakeId") or "") == take_id
                    and str(reference.get("mediaPath") or "") == media_path
                ):
                    return True
    return False


def _storyboard_items(cache):
    rows = []
    root = storyboard_root()
    for summary in list_stories():
        story_id = str(summary.get("id") or "")
        try:
            story = load_story(story_id)
        except (FileNotFoundError, RuntimeError, ValueError):
            continue
        story_root = root / story_id
        if story_root.is_symlink() or not story_root.is_dir():
            continue
        scenes = story.get("scenes") if isinstance(story.get("scenes"), dict) else {}
        removed_scenes = story.get("removedScenes") if isinstance(story.get("removedScenes"), dict) else {}
        for scene_source, scene_map in (("active", scenes), ("removed", removed_scenes)):
            for scene_id, scene in scene_map.items():
                if not isinstance(scene, dict):
                    continue
                take_maps = (
                    ("active", scene.get("takes") if isinstance(scene.get("takes"), dict) else {}),
                    ("removed", scene.get("removedTakes") if isinstance(scene.get("removedTakes"), dict) else {}),
                )
                for take_state, takes in take_maps:
                    for take_id, take in takes.items():
                        if not isinstance(take, dict):
                            continue
                        media_path = str(take.get("mediaPath") or "").strip()
                        relative = Path(media_path)
                        if (
                            not media_path
                            or relative.is_absolute()
                            or ".." in relative.parts
                        ):
                            continue
                        raw_path = story_root
                        unsafe_path = False
                        for part in relative.parts:
                            raw_path = raw_path / part
                            if raw_path.is_symlink():
                                unsafe_path = True
                                break
                        if unsafe_path or not raw_path.is_file():
                            continue
                        referenced = _storyboard_take_is_referenced(story, take_id, media_path)
                        item_id = story_id + "/" + str(scene_id) + "/" + str(take_id)
                        label = str(take.get("label") or "").strip() or (
                            str(summary.get("title") or story_id) + " / " +
                            str(scene.get("title") or scene_id) + " / " + str(take_id)
                        )
                        status_parts = []
                        if scene_source == "removed":
                            status_parts.append("removed Scene")
                        if take_state == "removed":
                            status_parts.append("removed Take")
                        else:
                            status_parts.append("Take")
                        if referenced:
                            status_parts.append("used as reference")
                        removed_scene = scene_source == "removed"
                        protected_reason = ""
                        if referenced:
                            protected_reason = (
                                "Take media is still used as a Scene reference. Clear that reference before deletion."
                            )
                        elif removed_scene:
                            protected_reason = (
                                "This Take belongs to a removed Scene. Restore the Scene before permanently deleting its Takes."
                            )
                        rows.append(_item(
                            "storyboard",
                            item_id,
                            label,
                            raw_path,
                            kind="Generated Take",
                            status=" · ".join(status_parts),
                            purgeable=not referenced and not removed_scene,
                            protected_reason=protected_reason,
                            meta={
                                "storyId": story_id,
                                "storyTitle": str(summary.get("title") or story_id),
                                "sceneId": str(scene_id),
                                "sceneTitle": str(scene.get("title") or ""),
                                "takeId": str(take_id),
                                "takeState": take_state,
                                "sceneState": scene_source,
                                "createdAt": take.get("createdAt"),
                                "rating": take.get("rating"),
                                "selected": str(scene.get("selectedTakeId") or "") == str(take_id),
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



def _discovered_set_folders(cache, current_folder=""):
    folders = []
    seen = set()

    def add(value):
        normalized = _normalized_folder_key(value)
        if normalized and normalized not in seen:
            seen.add(normalized)
            folders.append(normalized)

    add(current_folder)
    discoveries = cache.get("discoveries") if isinstance(cache, dict) else {}
    if isinstance(discoveries, dict):
        for value in discoveries.get("sets") or []:
            add(value)
        for row in discoveries.get("tests") or []:
            if isinstance(row, dict):
                add(row.get("folder"))
    return folders


def _test_items_for_folder(cache, folder, qualify_label=False):
    set_path = app_config.safe_join_fs_root(folder)
    if not set_path.is_dir():
        return []
    rows = []
    root = set_path / "test-generations"
    if root.is_symlink() or not root.is_dir():
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
        label = str(session.get("name") or session_id)
        if qualify_label:
            label += " · " + folder
        rows.append(_item(
            "tests",
            session_id,
            label,
            path,
            folder=folder,
            kind=session.get("modelId") or session.get("model") or "Test Session",
            status=status,
            purgeable=not active,
            protected_reason=("Active Test Session; stop it before deletion." if active else ""),
            meta={
                "set": folder,
                "completed": int(session.get("completed") or 0),
                "failed": int(session.get("failed") or 0),
                "total": int(session.get("total") or 0),
                "startedAt": session.get("startedAt"),
            },
            cache=cache,
        ))
    return rows


def _central_test_items(cache):
    root = _central_test_root()
    if not root.is_dir():
        return []
    rows = []
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
        source = str(session.get("source") or "")
        owner_folder = str(session.get("ownerFolder") or "")
        label = str(session.get("name") or "").strip() or session_id
        if source:
            label += " · " + source
        rows.append(_item(
            "tests",
            session_id,
            label,
            path,
            folder="",
            kind=session.get("modelId") or session.get("model") or "Test Session",
            status=status,
            purgeable=not active,
            protected_reason=("Active Test Session; stop it before deletion." if active else ""),
            meta={
                "source": source,
                "ownerFolder": owner_folder,
                "completed": int(session.get("completed") or 0),
                "failed": int(session.get("failed") or 0),
                "total": int(session.get("total") or 0),
                "startedAt": session.get("startedAt"),
            },
            cache=cache,
        ))
    return rows


def _test_items(cache, folder):
    folders = _discovered_set_folders(cache, folder)
    qualify = len(folders) > 1
    rows = _central_test_items(cache)
    for set_folder in folders:
        try:
            rows.extend(_test_items_for_folder(cache, set_folder, qualify_label=qualify))
        except (FileNotFoundError, RuntimeError, ValueError):
            continue
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
    folders = _discovered_set_folders(cache, folder)
    rows = []
    qualify = len(folders) > 1
    known = (
        ("originals", "Originals", "Reversible source-media safety copies"),
        ("auto_dataset", "Prepared dataset", "Rebuildable Set preparation"),
        ("media_metadata.json", "Media metadata", "WebCap analysis cache"),
        (".webcap_state.json", "Set state", "WebCap authored Set state"),
    )
    for set_folder in folders:
        try:
            set_path = app_config.safe_join_fs_root(set_folder)
        except ValueError:
            continue
        if not set_path.is_dir():
            continue
        for item_id, label, kind in known:
            path = set_path / item_id
            if not path.exists() or path.is_symlink():
                continue
            rows.append(_item(
                "set",
                item_id,
                ((set_path.name + " / " + label) if qualify else label),
                path,
                folder=set_folder,
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


def _active_generate_reference_tokens():
    active = set()
    snapshot = execution_lane_snapshot("inference", include_terminal=False)
    for job in snapshot.get("jobs") or []:
        if not isinstance(job, dict):
            continue
        metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
        if str(metadata.get("client") or "") != "generate":
            continue
        job_id = str(job.get("id") or "").strip()
        if not job_id:
            continue
        try:
            stored = execution_get_job(job_id, include_payload=True)
        except FileNotFoundError:
            continue
        payload = stored.get("payload") if isinstance(stored.get("payload"), dict) else {}
        request = payload.get("request") if isinstance(payload.get("request"), dict) else {}
        references = request.get("references") if isinstance(request.get("references"), dict) else {}
        for raw_path in references.values():
            parts = PurePosixPath(str(raw_path or "").replace("\\", "/")).parts
            if (
                len(parts) >= 4
                and parts[0] == ".webcap_runtime"
                and parts[1] == "generate-references"
                and GENERATE_REFERENCE_TOKEN_RE.fullmatch(parts[2])
            ):
                active.add(parts[2])
    return active


def _runtime_items(cache):
    rows = []
    root = Path(app_config.FS_ROOT)
    reference_root = root / ".webcap_runtime" / "generate-references"
    active_reference_tokens = _active_generate_reference_tokens()
    if reference_root.is_dir() and not reference_root.is_symlink():
        for reference in sorted(reference_root.iterdir(), key=lambda path: path.name, reverse=True):
            if (
                not reference.is_dir()
                or reference.is_symlink()
                or not GENERATE_REFERENCE_TOKEN_RE.fullmatch(reference.name)
            ):
                continue
            active = reference.name in active_reference_tokens
            rows.append(_item(
                "runtime", "generate-reference/" + reference.name, reference.name, reference,
                kind="Generate reference bundle",
                status=("queued / active" if active else "draft / residual"),
                purgeable=not active,
                protected_reason=("Referenced by queued or active Generate work." if active else ""),
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



def _scan_cache_complete(cache):
    last_scan = cache.get("lastScan") if isinstance(cache, dict) else {}
    return bool(isinstance(last_scan, dict) and float(last_scan.get("completedAt") or 0) > 0)


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
    scan_complete = _scan_cache_complete(cache)
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
            "tests", "Tests", groups["tests"], complete=scan_complete,
            note=(
                "Workspace Test inventory from the last completed scan."
                if scan_complete else
                "Current/discovered Tests only; Start scan for a workspace-wide Test inventory."
            )
        ),
        _category(
            "staged", "Staged Test LoRAs", groups["staged"], complete=False,
            note=("Showing WebCap-owned staged copies for the current Set in configured Test roots only.")
        ),
        _category("generate", "Generations", groups["generate"]),
        _category("storyboard", "Storyboard Takes", groups["storyboard"]),
        _category(
            "set", ("Set Data (protected)" if scan_complete else "Current Set (protected)"),
            groups["set"], complete=scan_complete,
            note="Visible for accounting only; Set-owned data is not purgeable here."
        ),
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
        "lastScan": cache.get("lastScan") if isinstance(cache.get("lastScan"), dict) else None,
        "categories": categories,
        "items": groups,
    }


def _safe_recursive_stats(path, cancel_check=None, progress=None):
    root = Path(path)
    if not root.exists():
        raise FileNotFoundError("Storage item no longer exists.")
    if root.is_symlink():
        raise RuntimeError("Storage Manager will not measure symlinked roots.")
    cancel_check = cancel_check or (lambda: False)
    progress = progress or (lambda event: None)
    if cancel_check():
        raise _ScanCancelled("Storage scan cancelled.")
    if root.is_file():
        size = int(root.stat().st_size)
        progress({"filesDelta": 1, "bytesDelta": size})
        return size, 1, 0

    total = 0
    file_count = 0
    directory_count = 0
    stack = [root]
    while stack:
        if cancel_check():
            raise _ScanCancelled("Storage scan cancelled.")
        directory = stack.pop()
        local_files = 0
        local_bytes = 0
        directory_count += 1
        with os.scandir(directory) as entries:
            for entry in entries:
                if cancel_check():
                    raise _ScanCancelled("Storage scan cancelled.")
                if entry.is_symlink():
                    continue
                if entry.is_file(follow_symlinks=False):
                    size = int(entry.stat(follow_symlinks=False).st_size)
                    total += size
                    file_count += 1
                    local_files += 1
                    local_bytes += size
                elif entry.is_dir(follow_symlinks=False):
                    stack.append(Path(entry.path))
        progress({"directoriesDelta": 1, "filesDelta": local_files, "bytesDelta": local_bytes})
    return total, file_count, directory_count


def _safe_recursive_size(path):
    return _safe_recursive_stats(path)[0]

def _resolve_generate(item_id):
    parts = PurePosixPath(str(item_id or "")).parts
    if len(parts) != 2 or any(part in {"", ".", ".."} for part in parts):
        raise ValueError("Generation storage ID is invalid.")
    raw_root = app_config.output_root() / "generations"
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


def _central_test_root():
    root = Path(app_config.FS_ROOT) / ".webcap" / "test-generations"
    if root.is_symlink():
        raise ValueError("Central Test Session storage path is symlinked.")
    return root


def _resolve_test(folder, session_id):
    name = str(session_id or "").strip()
    if not name or name in (".", "..") or "/" in name or "\\" in name:
        raise ValueError("Test Session storage ID is invalid.")

    central_root = _central_test_root()
    central_session = central_root / name
    if central_session.is_symlink():
        raise ValueError("Test Session storage path is symlinked.")
    if central_session.is_dir() and (central_session / "test.json").is_file():
        return central_session.resolve()

    folder = str(folder or "").strip()
    if not folder:
        raise FileNotFoundError("Test Session is unavailable.")
    raw_set_path = app_config.safe_join_fs_root(folder)
    raw_root = raw_set_path / "test-generations"
    raw_session = raw_root / name
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


def _resolve_generate_reference(item_id):
    value = str(item_id or "")
    if not value.startswith("generate-reference/"):
        raise ValueError("Generate reference storage ID is invalid.")
    token = value.split("/", 1)[1]
    if not GENERATE_REFERENCE_TOKEN_RE.fullmatch(token):
        raise ValueError("Generate reference storage ID is invalid.")

    raw_root = Path(app_config.FS_ROOT) / ".webcap_runtime" / "generate-references"
    raw_path = raw_root / token
    if raw_root.is_symlink() or raw_path.is_symlink():
        raise ValueError("Generate reference storage path is symlinked.")
    root = raw_root.resolve()
    path = raw_path.resolve()
    if path.parent != root or not path.is_dir():
        raise FileNotFoundError("Generate reference bundle is unavailable.")
    return path, token


def _resolve_runtime(item_id):
    root = Path(app_config.FS_ROOT).resolve()
    value = str(item_id or "")
    if value.startswith("generate-reference/"):
        return _resolve_generate_reference(value)[0]
    if value.startswith("h3-probe/"):
        return _resolve_h3_probe(value)[0]
    raise ValueError("Runtime storage ID is invalid.")


def _resolve_storyboard_take(item_id):
    parts = PurePosixPath(str(item_id or "")).parts
    if len(parts) != 3 or any(not part or Path(part).name != part for part in parts):
        raise ValueError("Storyboard Take storage ID is invalid.")
    story_id, scene_id, take_id = parts
    story = load_story(story_id)
    scene = None
    for scene_map in (story.get("scenes"), story.get("removedScenes")):
        if isinstance(scene_map, dict) and isinstance(scene_map.get(scene_id), dict):
            scene = scene_map[scene_id]
            break
    if scene is None:
        raise FileNotFoundError("Storyboard Scene is unavailable.")

    take = None
    for take_map in (
        scene.get("takes") if isinstance(scene.get("takes"), dict) else {},
        scene.get("removedTakes") if isinstance(scene.get("removedTakes"), dict) else {},
    ):
        if isinstance(take_map.get(take_id), dict):
            take = take_map[take_id]
            break
    if take is None:
        raise FileNotFoundError("Storyboard Take is unavailable.")

    media_path = str(take.get("mediaPath") or "").strip()
    relative = Path(media_path)
    if not media_path or relative.is_absolute() or ".." in relative.parts:
        raise RuntimeError("Storyboard Take media path is invalid.")

    raw_story_root = storyboard_root() / story_id
    if raw_story_root.is_symlink():
        raise ValueError("Storyboard Take storage path is symlinked.")
    raw_path = raw_story_root
    for part in relative.parts:
        raw_path = raw_path / part
        if raw_path.is_symlink():
            raise ValueError("Storyboard Take storage path is symlinked.")
    story_root = raw_story_root.resolve()
    path = raw_path.resolve()
    if path == story_root or story_root not in path.parents or not path.is_file():
        raise FileNotFoundError("Storyboard Take media is unavailable.")
    return path, story, scene, take


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
        return _resolve_storyboard_take(item_id)[0]
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



def register_usage(area, item_id, folder="", bytes_used=0, file_count=0, source="producer", measured_at=None):
    area = str(area or "").strip()
    if area not in MEASURABLE_AREAS:
        raise ValueError("Unsupported Storage measurement area.")
    try:
        size = int(bytes_used)
        count = int(file_count)
    except (TypeError, ValueError) as exc:
        raise ValueError("Storage usage must use whole-number byte and file counts.") from exc
    if size < 0 or count < 0:
        raise ValueError("Storage usage cannot be negative.")
    source = str(source or "producer").strip() or "producer"
    if source not in {"producer", "manual", "scan"}:
        raise ValueError("Storage usage source is invalid.")
    timestamp = float(measured_at if measured_at is not None else time.time())
    if timestamp <= 0:
        raise ValueError("Storage usage timestamp is invalid.")

    with _CACHE_LOCK:
        cache = _read_cache()
        cache.setdefault("items", {})[_cache_key(area, item_id, folder)] = {
            "bytes": size,
            "fileCount": count,
            "measuredAt": timestamp,
            "source": source,
        }
        _write_cache(cache)
    return {
        "ok": True,
        "area": area,
        "id": item_id,
        "folder": folder,
        "bytes": size,
        "fileCount": count,
        "measuredAt": timestamp,
        "source": source,
    }


def measure(area, item_id, folder=""):
    if area not in MEASURABLE_AREAS:
        raise ValueError("Unsupported Storage measurement area.")
    path = resolve_item(area, item_id, folder)
    size, file_count, _directory_count = _safe_recursive_stats(path)
    return register_usage(
        area,
        item_id,
        folder,
        bytes_used=size,
        file_count=file_count,
        source="manual",
    )


def _scan_cancelled(cancel_check):
    if cancel_check and cancel_check():
        raise _ScanCancelled("Storage scan cancelled.")


def _discover_workspace_sets(cancel_check=None, progress=None):
    cancel_check = cancel_check or (lambda: False)
    progress = progress or (lambda event: None)
    root = Path(app_config.FS_ROOT)
    if not root.is_dir():
        raise FileNotFoundError("Storage root is unavailable.")
    if root.is_symlink():
        raise RuntimeError("Storage Manager will not scan a symlinked filesystem root.")

    sets = set()
    tests = set()
    stack = [root]
    root_pruned = {"output", ".webcap", ".webcap_training", ".webcap_runtime"}
    generated_children = {"test-generations", "originals", "auto_dataset"}

    while stack:
        _scan_cancelled(cancel_check)
        directory = stack.pop()
        try:
            entries = list(os.scandir(directory))
        except OSError as exc:
            progress({"errorsDelta": 1, "current": "Unreadable folder: " + directory.name, "lastError": str(exc)})
            continue

        progress({"directoriesDelta": 1, "current": "Inspecting " + str(directory)})
        by_name = {entry.name: entry for entry in entries}
        if directory != root:
            relative = directory.relative_to(root).as_posix()
            test_entry = by_name.get("test-generations")
            is_set = (
                ".webcap_state.json" in by_name
                or "media_metadata.json" in by_name
                or (
                    test_entry is not None
                    and not test_entry.is_symlink()
                    and test_entry.is_dir(follow_symlinks=False)
                )
            )
            if is_set:
                sets.add(relative)

            if test_entry is not None and not test_entry.is_symlink() and test_entry.is_dir(follow_symlinks=False):
                try:
                    with os.scandir(test_entry.path) as sessions:
                        for session_entry in sessions:
                            _scan_cancelled(cancel_check)
                            if session_entry.is_symlink() or not session_entry.is_dir(follow_symlinks=False):
                                continue
                            manifest = Path(session_entry.path) / "test.json"
                            if manifest.is_symlink() or not manifest.is_file():
                                continue
                            try:
                                payload = json.loads(manifest.read_text(encoding="utf-8"))
                            except (OSError, json.JSONDecodeError):
                                progress({"errorsDelta": 1, "lastError": "Unreadable Test Session manifest."})
                                continue
                            if isinstance(payload, dict):
                                tests.add((relative, session_entry.name))
                except OSError as exc:
                    progress({"errorsDelta": 1, "lastError": str(exc)})

        for entry in entries:
            if entry.is_symlink() or not entry.is_dir(follow_symlinks=False):
                continue
            if directory == root and entry.name in root_pruned:
                continue
            if entry.name in generated_children:
                continue
            stack.append(Path(entry.path))

    progress({
        "setsDiscovered": len(sets),
        "testsDiscovered": len(tests),
        "current": "Discovered " + str(len(sets)) + " Set(s) and " + str(len(tests)) + " Test Session(s).",
    })
    return sorted(sets), sorted(tests)


def _persist_scan_discoveries(sets, tests):
    with _CACHE_LOCK:
        cache = _read_cache()
        cache["discoveries"] = {
            "sets": list(sets),
            "tests": [{"folder": folder, "id": session_id} for folder, session_id in tests],
        }
        _write_cache(cache)


def _scan_workspace(folder="", cancel_check=None, progress=None):
    cancel_check = cancel_check or (lambda: False)
    progress = progress or (lambda event: None)
    progress({"phase": "discovering", "current": "Discovering WebCap Sets and historical Test Sessions…"})
    sets, tests = _discover_workspace_sets(cancel_check=cancel_check, progress=progress)
    _scan_cancelled(cancel_check)
    _persist_scan_discoveries(sets, tests)

    payload = overview(folder)
    items = []
    seen = set()
    for area_rows in payload.get("items", {}).values():
        for item in area_rows or []:
            key = (str(item.get("area") or ""), str(item.get("folder") or ""), str(item.get("id") or ""))
            if key in seen:
                continue
            seen.add(key)
            items.append(item)

    progress({"phase": "measuring", "itemsTotal": len(items), "current": "Measuring managed artifacts…"})
    measured = 0
    scan_errors = 0
    for item in items:
        _scan_cancelled(cancel_check)
        area = str(item.get("area") or "")
        item_id = str(item.get("id") or "")
        item_folder = str(item.get("folder") or "")
        progress({"current": str(item.get("label") or item_id)})
        try:
            path = resolve_item(area, item_id, item_folder)
            size, file_count, _directory_count = _safe_recursive_stats(
                path,
                cancel_check=cancel_check,
                progress=progress,
            )
            register_usage(area, item_id, item_folder, bytes_used=size, file_count=file_count, source="scan")
            measured += 1
            progress({"itemsMeasured": measured})
        except _ScanCancelled:
            raise
        except (FileNotFoundError, OSError, RuntimeError, ValueError) as exc:
            scan_errors += 1
            progress({"errorsDelta": 1, "lastError": str(exc)})

    summary = {
        "completedAt": time.time(),
        "setsDiscovered": len(sets),
        "testsDiscovered": len(tests),
        "itemsMeasured": measured,
        "itemsTotal": len(items),
        "errors": scan_errors,
    }
    with _CACHE_LOCK:
        cache = _read_cache()
        cache["lastScan"] = summary
        _write_cache(cache)
    return summary


def _scan_state_update(scan_id, event):
    global _SCAN_STATE
    event = event if isinstance(event, dict) else {}
    with _SCAN_LOCK:
        if not isinstance(_SCAN_STATE, dict) or _SCAN_STATE.get("id") != scan_id:
            return
        for source_key, target_key in (
            ("directoriesDelta", "directoriesScanned"),
            ("filesDelta", "filesScanned"),
            ("bytesDelta", "bytesScanned"),
            ("errorsDelta", "errors"),
        ):
            if source_key in event:
                _SCAN_STATE[target_key] = int(_SCAN_STATE.get(target_key) or 0) + int(event.get(source_key) or 0)
        for key in (
            "phase", "current", "itemsMeasured", "itemsTotal", "setsDiscovered",
            "testsDiscovered", "lastError",
        ):
            if key in event:
                _SCAN_STATE[key] = event[key]


def _scan_worker(scan_id, folder, cancel_event):
    global _SCAN_STATE
    try:
        summary = _scan_workspace(
            folder,
            cancel_check=cancel_event.is_set,
            progress=lambda event: _scan_state_update(scan_id, event),
        )
        with _SCAN_LOCK:
            if isinstance(_SCAN_STATE, dict) and _SCAN_STATE.get("id") == scan_id:
                _SCAN_STATE.update(summary)
                _SCAN_STATE["status"] = "completed"
                _SCAN_STATE["phase"] = "complete"
                _SCAN_STATE["current"] = ""
                _SCAN_STATE["finishedAt"] = time.time()
    except _ScanCancelled:
        with _SCAN_LOCK:
            if isinstance(_SCAN_STATE, dict) and _SCAN_STATE.get("id") == scan_id:
                _SCAN_STATE["status"] = "cancelled"
                _SCAN_STATE["phase"] = "cancelled"
                _SCAN_STATE["current"] = ""
                _SCAN_STATE["finishedAt"] = time.time()
    except Exception as exc:
        with _SCAN_LOCK:
            if isinstance(_SCAN_STATE, dict) and _SCAN_STATE.get("id") == scan_id:
                _SCAN_STATE["status"] = "failed"
                _SCAN_STATE["phase"] = "failed"
                _SCAN_STATE["error"] = str(exc)
                _SCAN_STATE["finishedAt"] = time.time()


def scan_status():
    with _SCAN_LOCK:
        state = dict(_SCAN_STATE) if isinstance(_SCAN_STATE, dict) else None
    if state is None:
        cache = _read_cache()
        return {"ok": True, "scan": {"status": "idle", "lastScan": cache.get("lastScan")}}
    return {"ok": True, "scan": state}


def start_scan(folder=""):
    global _SCAN_STATE, _SCAN_CANCEL
    with _SCAN_LOCK:
        if isinstance(_SCAN_STATE, dict) and _SCAN_STATE.get("status") in {"running", "cancelling"}:
            return {"ok": True, "scan": dict(_SCAN_STATE)}
        scan_id = uuid.uuid4().hex
        cancel_event = threading.Event()
        _SCAN_CANCEL = cancel_event
        _SCAN_STATE = {
            "id": scan_id,
            "status": "running",
            "phase": "starting",
            "folder": str(folder or ""),
            "startedAt": time.time(),
            "finishedAt": None,
            "current": "",
            "directoriesScanned": 0,
            "filesScanned": 0,
            "bytesScanned": 0,
            "itemsMeasured": 0,
            "itemsTotal": 0,
            "setsDiscovered": 0,
            "testsDiscovered": 0,
            "errors": 0,
            "lastError": "",
            "error": "",
        }
        state = dict(_SCAN_STATE)
    threading.Thread(
        target=_scan_worker,
        args=(scan_id, str(folder or ""), cancel_event),
        name="webcap-storage-scan",
        daemon=True,
    ).start()
    return {"ok": True, "scan": state}


def cancel_scan():
    global _SCAN_STATE
    with _SCAN_LOCK:
        active = isinstance(_SCAN_STATE, dict) and _SCAN_STATE.get("status") in {"running", "cancelling"}
        if active:
            if _SCAN_CANCEL is not None:
                _SCAN_CANCEL.set()
            _SCAN_STATE["status"] = "cancelling"
            _SCAN_STATE["phase"] = "cancelling"
            state = dict(_SCAN_STATE)
        else:
            state = dict(_SCAN_STATE) if isinstance(_SCAN_STATE, dict) else None
    if state is not None:
        return {"ok": True, "scan": state}
    cache = _read_cache()
    return {"ok": True, "scan": {"status": "idle", "lastScan": cache.get("lastScan")}}


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
        owner_folder = str(session_payload.get("ownerFolder") or folder or "").strip()
        owner_path = app_config.safe_join_fs_root(owner_folder) if owner_folder else Path(app_config.FS_ROOT).resolve()
        delete_session(owner_path, item_id)
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
        parts = PurePosixPath(str(item_id or "")).parts
        path, story, _scene, take = _resolve_storyboard_take(item_id)
        story_id, scene_id, take_id = parts
        removed_scenes = story.get("removedScenes") if isinstance(story.get("removedScenes"), dict) else {}
        if scene_id in removed_scenes:
            raise RuntimeError(
                "This Take belongs to a removed Scene. Restore the Scene before permanently deleting its Takes."
            )
        if _storyboard_take_is_referenced(story, take_id, take.get("mediaPath")):
            raise RuntimeError(
                "Take cannot be deleted while its media is used as a Scene reference. Clear that reference first."
            )
        delete_take(story_id, scene_id, take_id)
    elif area == "runtime":
        value = str(item_id or "")
        if value.startswith("generate-reference/"):
            path, token = _resolve_generate_reference(value)
            if token in _active_generate_reference_tokens():
                raise RuntimeError("Generate reference bundle is referenced by queued or active Generate work.")
            shutil.rmtree(path)
        elif value.startswith("h3-probe/"):
            path, probe_state = _resolve_h3_probe(value)
            if not probe_state.get("purgeable"):
                raise RuntimeError(probe_state.get("protectedReason") or "H3 probe is not safe to delete.")
            shutil.rmtree(path)
        else:
            raise ValueError("This Runtime storage item cannot be purged manually.")
    elif area == "comfy":
        path, family, names = _resolve_comfy(item_id)
        if _comfy_identity_active(family, names):
            raise RuntimeError("ComfyUI scratch is referenced by queued or active inference work.")
        shutil.rmtree(path)

    with _CACHE_LOCK:
        cache = _read_cache()
        cache.get("items", {}).pop(_cache_key(area, item_id, folder), None)
        _write_cache(cache)
    return {"ok": True, "area": area, "id": item_id, "folder": folder}
