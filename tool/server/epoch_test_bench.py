import copy
import hashlib
import json
import logging
import math
import os
import re
import secrets
import shutil
import threading
import time
from datetime import datetime
from pathlib import Path, PurePosixPath

from . import config as app_config
from .folder_state_store import read_folder_state, set_media_rating, set_test_vision_assessment
from .test_models import get_test_model, get_test_model_for_staging_key, supported_models as registered_test_models, supported_profile_ids
from .training_test_paths import browse_test_source, test_copy_path
from .training_runner import candidate_run_snapshot_from_provenance, candidate_selected_epoch_from_provenance
from .execution_queue import (
    cancel_queued as execution_cancel_queued,
    consume_terminal_job as execution_consume_terminal_job,
    promote_backlog as execution_promote_backlog,
    discard_terminal_and_recent as execution_discard_terminal_and_recent,
    get_job as execution_get_job,
    lane_snapshot as execution_lane_snapshot,
    recover_lane as execution_recover_lane,
    request_stop as execution_request_stop,
    transient_receipt as execution_transient_receipt,
    update_job as execution_update_job,
)

TEMPLATE_PATH = get_test_model().TEMPLATE_PATH
TEST_RESULTS_DIR = "test-generations"
TEST_WORKSPACES_DIR = "sets"
TEST_WORKSPACE_STATE_FILE = "workspace.json"
TEST_WORKSPACE_SESSIONS_DIR = "sessions"
TEST_WORKSPACE_VERSION = 1
LEGACY_EXECUTION_LANE = "test-generations"
TEST_ASPECT_RATIO_OPTIONS = tuple(getattr(get_test_model(), "ASPECT_RATIO_OPTIONS", ()))
_status_lock = threading.RLock()
_workspace_lock = threading.RLock()
_recent_sets_cache = {"expires": 0.0, "items": []}
_recent_prompts_cache = {"expires": 0.0, "items": [], "root": None}
_reconcile_lock = threading.Lock()
_startup_reconciled = False
_logger = logging.getLogger(__name__)


def _owning_set_directory(folder_path):
    path = Path(folder_path).resolve()
    for candidate in (path, *path.parents):
        if candidate.name == TEST_RESULTS_DIR:
            return candidate.parent
    return path


def _test_directory(folder_path, model, source=None):
    return test_copy_path(model.STAGING_KEY, _relative_set_folder(folder_path))


def _owner_folder_available(owner_folder):
    owner = str(owner_folder or "").strip().replace("\\", "/").strip("/")
    if not owner:
        return False
    relative = PurePosixPath(owner)
    if relative.is_absolute() or any(part in ("", ".", "..") for part in relative.parts):
        return False
    try:
        path = app_config.safe_join_fs_root(relative.as_posix())
    except (OSError, ValueError):
        return False
    return path.is_dir() and not path.is_symlink()


def browse_keep_lora_destination(stage, source=""):
    model = get_test_model_for_staging_key(stage)
    payload = browse_test_source(model.STAGING_KEY, str(source or ""))
    payload.update({
        "operation": "keep_lora_destination_browse",
        "modelId": model.PROFILE_ID,
        "modelLabel": str(model.profile["label"]),
    })
    return payload


def _lora_files(test_directory):
    if not test_directory.is_dir():
        raise FileNotFoundError("Test staging folder does not exist: " + str(test_directory))
    return sorted(
        [path for path in test_directory.iterdir() if path.is_file() and path.suffix.lower() == ".safetensors"],
        key=lambda path: path.name.lower(),
    )


def _relative_set_folder(folder_path):
    value = _relative_to_fs_root(_owning_set_directory(folder_path))
    return "" if value == "." else value


def test_presence(folder_path):
    set_folder = _owning_set_directory(folder_path)
    staged_count = 0
    for profile_id in supported_profile_ids():
        model = get_test_model(profile_id)
        try:
            staged_count += len(_staged_loras_for_set(set_folder, model))
        except (OSError, ValueError):
            continue
    sessions = list_sessions(set_folder)
    return {
        "folder": _relative_set_folder(set_folder),
        "stagedCount": staged_count,
        "sessionCount": len(sessions),
        "hasTestData": bool(staged_count or sessions),
    }

def recent_test_sets(limit=8):
    """Return recent Test Sets from the bounded central session directory."""
    now = time.monotonic()
    cached_items = _recent_sets_cache.get("items") if isinstance(_recent_sets_cache.get("items"), list) else []
    if now < float(_recent_sets_cache.get("expires") or 0):
        recent = [dict(item) for item in cached_items[:max(1, int(limit or 8))]]
        for item in recent:
            item["ownerAvailable"] = _owner_folder_available(item.get("folder"))
        return recent

    recent_by_key = {}
    seen_sessions = set()
    for central_root in _recent_session_roots():
        if not central_root.is_dir() or central_root.is_symlink():
            continue
        for session in central_root.iterdir():
            if session.is_symlink() or not session.is_dir() or not (session / "test.json").is_file():
                continue
            payload = _read_status(session) or {}
            model_id = str(payload.get("modelId") or payload.get("model") or "").strip()
            owner_folder = str(payload.get("ownerFolder") or "").strip()
            session_key = (owner_folder, session.name)
            if session_key in seen_sessions:
                continue
            seen_sessions.add(session_key)
            key = (owner_folder, model_id)
            try:
                modified = (session / "test.json").stat().st_mtime
            except OSError:
                modified = 0
            item = recent_by_key.setdefault(key, {
                "folder": owner_folder,
                "modelId": model_id,
                "sessionCount": 0,
                "latestSession": "",
                "modified": 0,
            })
            item["sessionCount"] += 1
            if modified >= float(item.get("modified") or 0):
                item["modified"] = modified
                item["latestSession"] = session.name
                item["folder"] = owner_folder

    recent = sorted(
        recent_by_key.values(),
        key=lambda item: (float(item.get("modified") or 0), str(item.get("latestSession") or "")),
        reverse=True,
    )
    _recent_sets_cache["items"] = [dict(item) for item in recent]
    _recent_sets_cache["expires"] = time.monotonic() + 10.0
    result = [dict(item) for item in recent[:max(1, int(limit or 8))]]
    for item in result:
        item["ownerAvailable"] = _owner_folder_available(item.get("folder"))
    return result


def recent_test_prompts(limit=8):
    """Return recent distinct source prompts from Test sessions."""
    now = time.monotonic()
    root_key = tuple(str(path) for path in _recent_session_roots())
    cached_items = _recent_prompts_cache.get("items") if isinstance(_recent_prompts_cache.get("items"), list) else []
    if _recent_prompts_cache.get("root") == root_key and now < float(_recent_prompts_cache.get("expires") or 0):
        return [dict(item) for item in cached_items[:max(1, int(limit or 8))]]

    items = []
    seen_prompts = set()
    sessions = []
    seen_sessions = set()
    for central_root in _recent_session_roots():
        if not central_root.is_dir() or central_root.is_symlink():
            continue
        for session in central_root.iterdir():
            if session.is_symlink() or not session.is_dir() or not (session / "test.json").is_file():
                continue
            payload = _read_status(session) or {}
            owner_folder = str(payload.get("ownerFolder") or "").strip()
            session_key = (owner_folder, session.name)
            if session_key in seen_sessions:
                continue
            seen_sessions.add(session_key)
            try:
                modified = (session / "test.json").stat().st_mtime
            except OSError:
                modified = 0
            sessions.append((modified, session))
    sessions.sort(key=lambda item: item[0], reverse=True)

    for modified, session in sessions:
        payload = _read_status(session) or {}
        prompt = str(payload.get("sourcePrompt") or "").strip()
        if not prompt or prompt in seen_prompts:
            continue
        seen_prompts.add(prompt)
        items.append({
            "prompt": prompt,
            "folder": str(payload.get("ownerFolder") or "").strip(),
            "modelId": str(payload.get("modelId") or payload.get("model") or "").strip(),
            "session": session.name,
            "modified": modified,
        })
        if len(items) >= max(1, int(limit or 8)):
            break
    _recent_prompts_cache["items"] = [dict(item) for item in items]
    _recent_prompts_cache["root"] = root_key
    _recent_prompts_cache["expires"] = time.monotonic() + 10.0
    return items



def remove_candidate(folder_path, file_name, session_name=None, model_id=None):
    name = str(file_name or "").strip()
    if (
        not name
        or name in (".", "..")
        or "/" in name
        or "\\" in name
        or not name.lower().endswith(".safetensors")
    ):
        raise ValueError("A staged .safetensors filename is required.")

    resolved_model_id = str(model_id or "").strip()
    if session_name:
        session = _session_directory(folder_path, session_name)
        session_status = _read_status(session) or {}
        resolved_model_id = str(
            session_status.get("modelId")
            or session_status.get("model")
            or resolved_model_id
            or get_test_model().PROFILE_ID
        )

    model = get_test_model(resolved_model_id or get_test_model().PROFILE_ID)
    test_directory = _test_directory(folder_path, model)
    candidate = test_directory / name
    sidecar = candidate.with_suffix(".webcap.json")
    available = {path.name: path for path in _staged_loras_for_set(folder_path, model)}

    if candidate.exists() or candidate.is_symlink():
        if name not in available:
            raise ValueError("Staged Test candidate does not belong to the current Set: " + name)
        if candidate.is_symlink() or not candidate.is_file():
            raise RuntimeError("Staged Test candidate is not a regular file: " + name)
    if sidecar.is_symlink() or (sidecar.exists() and not sidecar.is_file()):
        raise RuntimeError("Staged Test candidate sidecar is not a regular file: " + sidecar.name)

    session_status = _remove_candidate_from_session(folder_path, session_name, name) if session_name else None

    if candidate.is_file():
        candidate.unlink()
    if sidecar.is_file():
        sidecar.unlink()

    remaining = _staged_loras_for_set(folder_path, model)
    return {
        "operation": "test_remove_candidate",
        "modelId": model.PROFILE_ID,
        "removed": name,
        "count": len(remaining),
        "files": [path.name for path in remaining],
        "sessionStatus": session_status,
        "candidateVisionScores": _candidate_vision_scores(folder_path, model.PROFILE_ID),
    }

def _safe_output_component(value):
    text = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value or "")).strip("._-")
    return (text[:80] or "candidate")


def _candidate_output_prefix(session_directory, index, candidate):
    session_name = _safe_output_component(Path(session_directory).name)
    label = "base" if candidate.get("kind") == "base" else Path(str(candidate.get("label") or "candidate")).stem
    candidate_name = f"{int(index):03d}-{_safe_output_component(label)}"
    return f"webcap-tests/{session_name}/{candidate_name}/render"


def _cleanup_owned_comfy_directory(directory, filename_prefix):
    directory = Path(directory)
    parts = [part for part in str(filename_prefix or "").replace("\\", "/").split("/") if part]
    if len(parts) < 4 or parts[0] != "webcap-tests":
        raise ValueError("Refusing to clean an unscoped ComfyUI output directory.")
    expected_parent = parts[-2]
    expected_session = parts[-3]
    if directory.is_symlink():
        raise ValueError("Refusing to clean a symlinked ComfyUI output directory.")
    if directory.name != expected_parent or directory.parent.name != expected_session or directory.parent.parent.name != "webcap-tests":
        raise ValueError("ComfyUI output directory does not match the Test Bench prefix.")
    shutil.rmtree(directory)
    for parent in (directory.parent, directory.parent.parent):
        try:
            parent.rmdir()
        except OSError:
            break


def _move_saved_output(output_ref, destination, filename_prefix=None, download_bytes=None):
    if str(output_ref.get("type") or "") != "output":
        raise RuntimeError("ComfyUI Test output was not saved to the output directory.")
    target = Path(destination)
    if target.exists():
        raise FileExistsError("Test result already exists: " + str(target))

    raw_path = str(output_ref.get("fullpath") or "").strip()
    source = None
    if raw_path:
        from . import inference_runtime
        source = inference_runtime.local_saved_output_path(output_ref)
    if source is not None and source.is_file():
        source_directory = source.parent
        shutil.move(str(source), str(target))
        if filename_prefix:
            try:
                _cleanup_owned_comfy_directory(source_directory, filename_prefix)
            except (OSError, ValueError) as exc:
                app_config.debug_print("[test-generations] Could not clean owned ComfyUI output directory:", exc)
    else:
        if download_bytes is None:
            raise RuntimeError("Test output requires the shared inference downloader.")
        target.write_bytes(download_bytes(output_ref))

    if not target.is_file():
        raise RuntimeError("Saved ComfyUI Test output was not materialized into the Test session.")
    return target

def _atomic_write_json(path, payload):
    tmp = path.with_name("." + path.name + "." + str(os.getpid()) + ".tmp")
    try:
        tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)
    finally:
        try:
            tmp.unlink()
        except FileNotFoundError:
            pass


def _relative_to_fs_root(path):
    return Path(path).resolve().relative_to(Path(app_config.FS_ROOT).resolve()).as_posix()


def _session_result_folder(session_directory):
    try:
        return _relative_to_fs_root(session_directory)
    except ValueError:
        return ""


def _session_root(folder_path):
    """Legacy per-set Test Session root."""
    return _owning_set_directory(folder_path) / TEST_RESULTS_DIR


def _central_session_root():
    root = app_config.output_root() / TEST_RESULTS_DIR
    if root.is_symlink():
        raise RuntimeError("Central Test Session storage cannot be symlinked.")
    return root


def _workspace_sets_root():
    root = _central_session_root() / TEST_WORKSPACES_DIR
    if root.is_symlink():
        raise RuntimeError("Test Generations workspace root cannot be symlinked.")
    if root.exists() and not root.is_dir():
        raise RuntimeError("Test Generations workspace root is not a directory.")
    return root


def _workspace_name(folder_path):
    owner = _owning_set_directory(folder_path)
    relative = _relative_set_folder(owner)
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", owner.name.lower()).strip(".-_")[:48].strip(".-_") or "set"
    digest = hashlib.sha256(relative.encode("utf-8")).hexdigest()[:12]
    return slug + "--" + digest


def _workspace_root(folder_path):
    root = _workspace_sets_root() / _workspace_name(folder_path)
    if root.is_symlink():
        raise RuntimeError("Test Generations Set workspace cannot be symlinked.")
    if root.exists() and not root.is_dir():
        raise RuntimeError("Test Generations Set workspace is not a directory.")
    return root


def _workspace_sessions_root(folder_path):
    root = _workspace_root(folder_path) / TEST_WORKSPACE_SESSIONS_DIR
    if root.is_symlink():
        raise RuntimeError("Test Generations session workspace cannot be symlinked.")
    if root.exists() and not root.is_dir():
        raise RuntimeError("Test Generations session workspace is not a directory.")
    return root


def _workspace_state_path(folder_path):
    return _workspace_root(folder_path) / TEST_WORKSPACE_STATE_FILE


def _empty_workspace_state(folder_path):
    return {
        "version": TEST_WORKSPACE_VERSION,
        "ownerFolder": _relative_set_folder(folder_path),
        "promptByModel": {},
    }


def _read_workspace_state(folder_path):
    path = _workspace_state_path(folder_path)
    if not path.exists():
        return _empty_workspace_state(folder_path)
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("Test Generations workspace state is not a regular file.")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("Test Generations workspace state is unreadable.") from exc
    if not isinstance(payload, dict) or payload.get("version") != TEST_WORKSPACE_VERSION:
        raise RuntimeError("Test Generations workspace state has an unsupported format.")
    expected_owner = _relative_set_folder(folder_path)
    if str(payload.get("ownerFolder") or "") != expected_owner:
        raise RuntimeError("Test Generations workspace state belongs to a different Set.")
    prompts = payload.get("promptByModel")
    if not isinstance(prompts, dict):
        raise RuntimeError("Test Generations workspace prompt state is invalid.")
    payload["promptByModel"] = {str(key): str(value) for key, value in prompts.items()}
    return payload


def workspace_prompt(folder_path, model_id=None):
    model = get_test_model(model_id)
    state = _read_workspace_state(folder_path)
    prompts = state["promptByModel"]
    return {
        "modelId": model.PROFILE_ID,
        "present": model.PROFILE_ID in prompts,
        "prompt": str(prompts.get(model.PROFILE_ID, "")),
    }


def save_workspace_prompt(folder_path, model_id, prompt):
    model = get_test_model(model_id)
    with _workspace_lock:
        state = _read_workspace_state(folder_path)
        state["promptByModel"][model.PROFILE_ID] = str(prompt if prompt is not None else "")
        root = _workspace_root(folder_path)
        root.mkdir(parents=True, exist_ok=True)
        _atomic_write_json(_workspace_state_path(folder_path), state)
    return {
        "modelId": model.PROFILE_ID,
        "prompt": state["promptByModel"][model.PROFILE_ID],
    }


def _recent_session_roots():
    roots = [_central_session_root()]
    sets_root = _workspace_sets_root()
    if sets_root.is_dir():
        for workspace in sets_root.iterdir():
            if workspace.is_symlink() or not workspace.is_dir():
                continue
            sessions = workspace / TEST_WORKSPACE_SESSIONS_DIR
            if sessions.is_symlink():
                raise RuntimeError("Test Generations session workspace cannot be symlinked.")
            if sessions.is_dir():
                roots.append(sessions)
    return roots


def _session_roots(folder_path):
    roots = [
        _workspace_sessions_root(folder_path),
        _central_session_root(),
        _session_root(folder_path),
    ]
    unique = []
    seen = set()
    for root in roots:
        key = str(Path(root).absolute())
        if key in seen:
            continue
        seen.add(key)
        unique.append(Path(root))
    return unique


def _session_belongs_to_folder(folder_path, session_directory, payload=None):
    session = Path(session_directory).resolve()
    status = payload if isinstance(payload, dict) else (_read_status(session) or {})
    owner_folder = str(status.get("ownerFolder") or "").replace("\\", "/").strip("/")
    expected_owner = str(_relative_set_folder(folder_path) or "").replace("\\", "/").strip("/")

    workspace_root = _workspace_sessions_root(folder_path).resolve()
    if session.parent == workspace_root:
        return "ownerFolder" in status and owner_folder == expected_owner

    legacy_root = _session_root(folder_path).resolve()
    if session.parent == legacy_root:
        return True

    central_roots = {
        _central_session_root().resolve(),
    }
    if session.parent not in central_roots:
        return False

    return "ownerFolder" in status and owner_folder == expected_owner


def _session_directories(folder_path):
    sessions = []
    seen_names = set()
    for root in _session_roots(folder_path):
        if not root.is_dir() or root.is_symlink():
            continue
        for session in root.iterdir():
            if (
                session.name in seen_names
                or session.is_symlink()
                or not session.is_dir()
                or not (session / "test.json").is_file()
            ):
                continue
            payload = _read_status(session) or {}
            if not _session_belongs_to_folder(folder_path, session, payload):
                continue
            seen_names.add(session.name)
            sessions.append(session)
    return sessions


def _session_directory(folder_path, session_name):
    name = str(session_name or "").strip()
    if not name or name in (".", "..") or "/" in name or "\\" in name:
        raise ValueError("A valid Test session name is required.")
    for raw_root in _session_roots(folder_path):
        if raw_root.is_symlink():
            continue
        root = raw_root.resolve()
        session = (root / name).resolve()
        if session.parent != root:
            continue
        if session.is_dir() and not session.is_symlink() and (session / "test.json").is_file():
            payload = _read_status(session) or {}
            if _session_belongs_to_folder(folder_path, session, payload):
                return session
    raise FileNotFoundError("Test session does not exist for this Set: " + name)


def _new_session_directory(folder_path, model=None):
    selected_model = model or get_test_model()
    root = _workspace_sessions_root(folder_path)
    root.mkdir(parents=True, exist_ok=True)
    base = datetime.now().strftime("%Y-%m-%d_%H%M-") + selected_model.SESSION_SLUG
    candidate = root / base
    suffix = 2
    existing_names = {path.name for path in _session_directories(folder_path)}
    while candidate.exists() or candidate.name in existing_names:
        candidate = root / (base + "-" + str(suffix))
        suffix += 1
    candidate.mkdir()
    return candidate

def _status_path(session_directory):
    return Path(session_directory) / "test.json"


def _read_status(session_directory):
    path = _status_path(session_directory)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _session_status(session_directory):
    payload = _read_status(session_directory)
    if not payload:
        return None
    visible = dict(payload)
    visible["session"] = Path(session_directory).name
    if not visible.get("modelId"):
        visible["modelId"] = str(visible.get("model") or get_test_model().PROFILE_ID)
    if not visible.get("resultFolder"):
        visible["resultFolder"] = _session_result_folder(session_directory)
    _project_wildcard_fields(visible)
    return visible


def _session_status_from_payload(session_directory, payload):
    if not payload:
        return None
    visible = dict(payload)
    visible["session"] = Path(session_directory).name
    if not visible.get("modelId"):
        visible["modelId"] = str(visible.get("model") or get_test_model().PROFILE_ID)
    if not visible.get("resultFolder"):
        visible["resultFolder"] = _session_result_folder(session_directory)
    _project_wildcard_fields(visible)
    return visible


def _session_rating_map(session_directory):
    state = read_folder_state(Path(session_directory) / ".webcap_state.json")
    raw = state.get("ratings_by_media") if isinstance(state, dict) else {}
    if not isinstance(raw, dict):
        return {}
    ratings = {}
    for media_key, value in raw.items():
        try:
            rating = int(round(float(value)))
        except (TypeError, ValueError):
            continue
        if 1 <= rating <= 5:
            ratings[str(media_key)] = rating
    return ratings


def _result_media_file(result):
    if not isinstance(result, dict):
        return ""
    return str(result.get("mediaFile") or result.get("outputVideo") or "").strip()


def _with_session_ratings(session_directory, payload):
    if not payload:
        return payload
    visible = dict(payload)
    ratings = _session_rating_map(session_directory)
    results = visible.get("results") if isinstance(visible.get("results"), list) else []
    enriched = []
    for result in results:
        if not isinstance(result, dict):
            enriched.append(result)
            continue
        item = dict(result)
        output_name = _result_media_file(item)
        if output_name in ratings:
            item["rating"] = ratings[output_name]
        enriched.append(item)
    visible["results"] = enriched
    return visible


def _session_vision_state(session_directory):
    state = read_folder_state(Path(session_directory) / ".webcap_state.json")
    vision = state.get("test_vision")
    return vision if isinstance(vision, dict) else {}


def _with_session_vision(session_directory, payload):
    if payload is None:
        return payload
    visible = dict(payload)
    visible["testVision"] = _session_vision_state(session_directory)
    return visible


def update_vision(folder_path, session_name, criteria):
    session = _session_directory(folder_path, session_name)
    media_name = criteria.get("mediaFile")
    assessment = criteria.get("assessment")
    ignored = criteria.get("ignoredGroups")
    disabled = criteria.get("disabledGroups")
    if media_name is None and disabled is None:
        raise ValueError("Test VL update needs a preview or session attribute selection.")
    if disabled is not None and (not isinstance(disabled, list) or any(not isinstance(v, str) for v in disabled)):
        raise ValueError("VL disabled groups must be an array of IDs.")
    if ignored is not None and (not isinstance(ignored, list) or any(not isinstance(v, str) for v in ignored)):
        raise ValueError("VL ignored groups must be an array of IDs.")
    if assessment is not None:
        if not isinstance(assessment, dict) or not isinstance(assessment.get("text"), str) or not isinstance(assessment.get("comparison"), list):
            raise ValueError("VL assessment requires response text and comparison rows.")
        if "modelId" in assessment and not isinstance(assessment["modelId"], str):
            raise ValueError("VL model ID must be text.")
        if any(not isinstance(row, dict) or not all(key in row for key in ("id", "result", "expectedText", "selectedText")) for row in assessment["comparison"]):
            raise ValueError("VL comparison has invalid rows.")
    if media_name is not None:
        media = resolve_result_media(folder_path, session_name, media_name)
        media_name = media.name
        results = (_read_status(session) or {}).get("results", [])
        if not any(_result_media_file(row) == media_name for row in results):
            raise ValueError("VL assessment media must belong to the Test session results.")
    if ignored is not None and assessment is None:
        previous = _session_vision_state(session).get("byMedia", {})
        if media_name not in previous:
            raise ValueError("Cannot update exclusions before a VL assessment exists.")
    vision = set_test_vision_assessment(
        session / ".webcap_state.json", media_key=media_name,
        assessment=assessment, ignored_groups=ignored, disabled_groups=disabled,
    )
    stored = _read_status(session) or {}
    model_id = str(stored.get("modelId") or stored.get("model") or get_test_model().PROFILE_ID)
    return {
        "operation": "test_vision_update",
        "session": session.name,
        "testVision": vision,
        "candidateVisionScores": _candidate_vision_scores(folder_path, model_id),
    }


def _test_auto_vl_question(groups):
    if not groups:
        return "Describe this image using only visible evidence, including distinctive details."
    prefix = ('Inspect the image and choose the best visible option for EVERY numbered attribute below. '
              'Respond with exactly one line per group, e.g. G1: 2. Use only the option number, '
              'or "unclear" if you cannot see it, or "none" if no option fits. '
              'If "(absent)" is an option, select its number when that attribute is absent. '
              'Do not assume any option is present; use only visible evidence.\n\n')
    return prefix + "\n".join(
        str(g["id"]) + " (" + str(g.get("label") or "") + "): " +
        "; ".join(str(i + 1) + "=" + str(option or "(absent)")
                  for i, option in enumerate(g.get("options") or []))
        for g in groups
    )


def _test_auto_vl_compare(answer, groups):
    lines = str(answer or "").splitlines()
    rows = []
    for group in groups:
        options = group.get("options") or []
        group_id = str(group["id"])
        matches = [re.sub(r"^\s*" + re.escape(group_id) + r"\s*[:=-]\s*", "", line, flags=re.I).strip()
                   for line in lines if re.match(r"^\s*" + re.escape(group_id) + r"\s*[:=-]\s*", line, flags=re.I)]
        observed = matches[0] if len(matches) == 1 else ""
        selected = int(observed) if observed.isdecimal() and 0 < int(observed) <= len(options) else None
        expected = group.get("expected")
        expected_text = "unresolved" if expected is None else (options[expected - 1] or "(absent)")
        selected_text = (options[selected - 1] or "(absent)") if selected is not None else (observed or "unclear")
        result = ("unclear" if expected is None else
                  ("match" if selected == expected else "mismatch") if selected is not None else
                  "mismatch" if re.fullmatch(r"none(?: of these)?", observed, flags=re.I) else "unclear")
        rows.append({"id": group_id, "label": group.get("label"), "expected": expected,
                     "selected": selected, "expectedText": expected_text,
                     "selectedText": selected_text, "result": result})
    return rows



def _queue_test_auto_vl(folder_path, session_name, media_file):
    """Enqueue VL in the existing LLM lane; each session owns its evidence."""
    from .llm_runner import enqueue as enqueue_llm

    session_dir = _session_directory(folder_path, session_name)
    status = _read_status(session_dir) or {}
    model = str(status.get("autoVlModel") or "")
    jobs = status.get("autoVlJobs") or {}
    if not model or media_file in jobs:
        return
    visible = open_session(folder_path, session_name)
    groups = visible.get("wildcardEvaluationGroups") or []
    question = _test_auto_vl_question(groups)
    try:
        resolve_result_media(folder_path, session_name, media_file)
        # Keep the queued contract small. The vision bytes are resolved only when the LLM runs.
        job = enqueue_llm(
            "caption", model, {
                "operation": "vision_question",
                "messages": [{"role": "user", "content": question}],
            }, context={
                "testAutoVl": True, "testFolder": _relative_set_folder(folder_path),
                "testSession": session_name, "testMedia": media_file,
                "testGroups": groups, "testQuestion": question, "testModel": model,
            }, label="Test Ask VL · " + session_name,
        )
        with _status_lock:
            latest = _read_status(session_dir) or {}
            registered = dict(latest.get("autoVlJobs") or {})
            registered[media_file] = str(job["jobId"])
            latest["autoVlJobs"] = registered
            _atomic_write_json(_status_path(session_dir), latest)
    except Exception as exc:
        _logger.exception("Automatic Test VL submission failed for Session %s, media %s", session_name, media_file)
        with _status_lock:
            latest = _read_status(session_dir) or {}
            errors = list(latest.get("autoVlErrors") or [])
            errors.append(media_file + ": " + str(exc))
            latest["autoVlErrors"] = errors
            _atomic_write_json(_status_path(session_dir), latest)


def complete_test_auto_vl(context, answer, elapsed_ms):
    """Apply an LLM receipt to existing session-owned test_vision evidence."""
    folder_path = app_config.safe_join_fs_root(str(context["testFolder"]))
    session = str(context["testSession"])
    media = str(context["testMedia"])
    current = _session_vision_state(_session_directory(folder_path, session))
    if media in (current.get("byMedia") or {}):
        return  # An explicit user assessment takes precedence over pending auto VL.
    update_vision(folder_path, session, {
        "mediaFile": media,
        "assessment": {
            "text": str(answer).strip() or "(empty response)",
            "question": str(context["testQuestion"]),
            "comparison": _test_auto_vl_compare(answer, context.get("testGroups") or []),
            "modelId": str(context["testModel"]),
            "elapsedMs": elapsed_ms,
        },
    })

def _saved_candidate_assessments(folder_path, model_id):
    model = get_test_model(model_id)
    totals = {}
    for candidate in _staged_loras_for_set(folder_path, model):
        payload = _staged_lora_provenance(candidate)
        assessment = payload.get("assessments")
        if isinstance(assessment, dict):
            totals[candidate.name] = assessment
    return totals


def _snapshot_session_assessments(folder_path, sessions):
    """Commit only aggregate contributions before discarding session files."""
    updates = {}
    for session in sessions:
        payload = _read_status(session) or {}
        model_id = str(payload.get("modelId") or payload.get("model") or get_test_model().PROFILE_ID)
        model = get_test_model(model_id)
        snapshot = [(session, payload)]
        ratings = _candidate_rating_scores(folder_path, model_id, session_snapshot=snapshot, include_saved=False)
        vision = _candidate_vision_scores(folder_path, model_id, session_snapshot=snapshot, include_saved=False)
        for name in set(ratings) | set(vision):
            staged = _test_directory(folder_path, model) / name
            if not staged.is_file() or staged.is_symlink():
                continue
            sidecar = staged.with_suffix(".webcap.json")
            if sidecar.is_symlink():
                raise RuntimeError("Candidate assessment sidecar is a symlink: " + sidecar.name)
            if not sidecar.is_file():
                _atomic_write_json(sidecar, {"version": 1, "assessments": {}})
            update = updates.setdefault(sidecar, {"manual": {"sum": 0, "count": 0}, "vision": {"matches": 0.0, "count": 0, "previews": 0}})
            if name in ratings:
                item = ratings[name]
                update["manual"]["sum"] += item["sum"]
                update["manual"]["count"] += item["count"]
            if name in vision:
                item = vision[name]
                for key in ("matches", "count", "previews"):
                    update["vision"][key] += item.get(key, 0)
    for sidecar, update in updates.items():
        payload = json.loads(sidecar.read_text(encoding="utf-8"))
        saved = payload.setdefault("assessments", {})
        for kind, contribution in update.items():
            existing = saved.setdefault(kind, {})
            for key, value in contribution.items():
                existing[key] = existing.get(key, 0) + value
        _atomic_write_json(sidecar, payload)


def reset_candidate_assessments(folder_path, model_id, candidate_name):
    model = get_test_model(model_id)
    name = Path(str(candidate_name or "")).name
    if name != candidate_name or not name.endswith(".safetensors"):
        raise ValueError("A staged Test candidate filename is required.")
    staged = {path.name: path for path in _staged_loras_for_set(folder_path, model)}
    if name not in staged:
        raise FileNotFoundError("Staged candidate not found.")
    sidecar = staged[name].with_suffix(".webcap.json")
    if not sidecar.is_file():
        raise FileNotFoundError("Candidate has no stored assessments.")
    payload = json.loads(sidecar.read_text(encoding="utf-8"))
    payload.pop("assessments", None)
    _atomic_write_json(sidecar, payload)
    return rating_summary(folder_path, model_id)


def _candidate_rating_scores(folder_path, model_id=None, session_snapshot=None, include_saved=True):
    selected_model_id = str(model_id or "").strip()
    default_model_id = get_test_model().PROFILE_ID
    totals = {}
    snapshots = session_snapshot if session_snapshot is not None else (
        (session, _read_status(session) or {}) for session in _session_directories(folder_path)
    )
    for session, payload in snapshots:
        session_model_id = str(payload.get("modelId") or payload.get("model") or default_model_id)
        if selected_model_id and session_model_id != selected_model_id:
            continue
        # A sweep rates LoRA/weight renditions, not the ordinary LoRA candidate.
        if payload.get("sweepWeights"):
            continue
        results = payload.get("results") if isinstance(payload.get("results"), list) else []
        ratings = _session_rating_map(session)
        for result in results:
            if not isinstance(result, dict) or str(result.get("kind") or "") == "base":
                continue
            candidate_name = str(result.get("candidateFile") or result.get("sourceLoRA") or "").strip()
            output_name = _result_media_file(result)
            rating = ratings.get(output_name)
            if not candidate_name or rating is None:
                continue
            aggregate = totals.setdefault(candidate_name, {"sum": 0, "count": 0})
            aggregate["sum"] += rating
            aggregate["count"] += 1
    if include_saved:
        for name, assessment in _saved_candidate_assessments(folder_path, model_id or default_model_id).items():
            saved = assessment.get("manual")
            if isinstance(saved, dict) and saved.get("count", 0) > 0:
                item = totals.setdefault(name, {"sum": 0, "count": 0})
                item["sum"] += saved["sum"]
                item["count"] += saved["count"]
    return {
        name: {
            "average": round(values["sum"] / values["count"], 2),
            "sum": values["sum"],
            "count": values["count"],
        }
        for name, values in totals.items()
        if values["count"]
    }

def _test_vl_partial_credit(expected, observed):
    """Only nested, contiguous word phrases earn partial credit."""
    import re

    a = re.findall(r"[a-z0-9]+", str(expected or "").lower())
    b = re.findall(r"[a-z0-9]+", str(observed or "").lower())
    if not a or not b or a == ["absent"] or b == ["absent"]:
        return 0.0
    if {"no", "not", "without"}.intersection(a + b):
        return 0.0
    shorter, longer = (a, b) if len(a) < len(b) else (b, a)
    if len(shorter) == len(longer):
        return 0.0
    if any(longer[i:i + len(shorter)] == shorter for i in range(len(longer) - len(shorter) + 1)):
        return len(shorter) / len(longer)
    return 0.0



_VL_COLOR_NAMES = frozenset(
    "black white gray grey silver red burgundy maroon orange yellow gold green olive lime "
    "blue cyan teal turquoise navy purple violet lavender magenta pink peach coral mauve "
    "brown tan beige cream".split()
).union({
    "light blue", "sky blue", "dark blue", "navy blue", "royal blue",
    "dark green", "forest green", "olive green", "lime green", "light pink", "hot pink",
})
_VL_NEAR_COLORS = (
    ("peach", "coral"), ("coral", "pink"), ("blue", "cyan"), ("cyan", "teal"),
    ("teal", "turquoise"), ("light blue", "sky blue"), ("light blue", "cyan"),
    ("purple", "violet"), ("purple", "mauve"), ("red", "burgundy"), ("burgundy", "maroon"),
)


def _test_vl_color_weight(expected, observed):
    return 0.5 if any(str(value or "").strip().lower() in _VL_COLOR_NAMES
                      for value in (expected, observed)) else 1.0


def _test_vl_near_color(expected, observed):
    a, b = str(expected or "").strip().lower(), str(observed or "").strip().lower()
    return a != b and any((a == left and b == right) or (a == right and b == left)
                          for left, right in _VL_NEAR_COLORS)


def _candidate_vision_scores(folder_path, model_id=None, session_snapshot=None, include_saved=True):
    """Aggregate saved VL agreements across sessions, like manual candidate ratings."""
    selected_model_id = str(model_id or "").strip()
    default_model_id = get_test_model().PROFILE_ID
    totals = {}
    snapshots = session_snapshot if session_snapshot is not None else (
        (session, _read_status(session) or {}) for session in _session_directories(folder_path)
    )
    for session, payload in snapshots:
        session_model_id = str(payload.get("modelId") or payload.get("model") or default_model_id)
        if selected_model_id and session_model_id != selected_model_id:
            continue
        # A weight sweep measures individual LoRA/weight renditions, not the staged candidate.
        if payload.get("sweepWeights"):
            continue
        vision = _session_vision_state(session)
        by_media = vision.get("byMedia") if isinstance(vision.get("byMedia"), dict) else {}
        disabled = set(vision.get("disabledGroups") or [])
        results = payload.get("results") if isinstance(payload.get("results"), list) else []
        for result in results:
            if not isinstance(result, dict) or str(result.get("kind") or "") == "base":
                continue
            candidate = str(result.get("candidateFile") or result.get("sourceLoRA") or "").strip()
            entry = by_media.get(_result_media_file(result))
            if not candidate or not isinstance(entry, dict):
                continue
            comparison = entry.get("comparison")
            if not isinstance(comparison, list):
                continue
            ignored = set(entry.get("ignoredGroups") or [])
            matches = 0
            counted = 0
            for group in comparison:
                if not isinstance(group, dict) or group.get("id") in disabled or group.get("id") in ignored:
                    continue
                if group.get("result") not in ("match", "mismatch"):
                    continue
                expected, observed = group.get("expectedText"), group.get("selectedText")
                weight = _test_vl_color_weight(expected, observed)
                counted += weight
                if group["result"] == "match":
                    matches += weight
                else:
                    credit = _test_vl_partial_credit(expected, observed)
                    if not credit and _test_vl_near_color(expected, observed):
                        credit = 0.5
                    matches += weight * credit
            if not counted:
                continue
            total = totals.setdefault(candidate, {"matches": 0, "count": 0, "previews": 0})
            total["matches"] += matches
            total["count"] += counted
            total["previews"] += 1
    if include_saved:
        for name, assessment in _saved_candidate_assessments(folder_path, model_id or default_model_id).items():
            saved = assessment.get("vision")
            if isinstance(saved, dict) and saved.get("count", 0) > 0:
                item = totals.setdefault(name, {"matches": 0.0, "count": 0, "previews": 0})
                for key in ("matches", "count", "previews"):
                    item[key] += saved.get(key, 0)
    return totals


def _mark_session_interrupted(session_directory, message="Test Generations session was interrupted by a WebCap restart."):
    status = _read_status(session_directory) or {}
    if status.get("status") not in ("running", "stopping"):
        return _session_status(session_directory)
    status["status"] = "interrupted"
    status["current"] = ""
    status["error"] = str(message or "Test run was interrupted.")
    _atomic_write_json(_status_path(session_directory), status)
    return _session_status(session_directory)


def open_session(folder_path, session_name):
    session = _session_directory(folder_path, session_name)
    return _with_session_vision(session, _with_session_ratings(session, _visible_session_status(folder_path, session)))


def resolve_result_media(folder_path, session_name, media_name):
    session = _session_directory(folder_path, session_name)
    name = str(media_name or "").strip()
    if not name or name in (".", "..") or Path(name).name != name:
        raise ValueError("A valid Test result media filename is required.")
    media = session / name
    if media.is_symlink() or not media.is_file():
        raise FileNotFoundError("Test result media does not exist: " + name)
    return media


def rate_result(folder_path, session_name, media_name, rating):
    session = _session_directory(folder_path, session_name)
    media = resolve_result_media(folder_path, session_name, media_name)
    value = set_media_rating(session / ".webcap_state.json", media.name, rating)
    return {
        "operation": "test_rate_result",
        "session": session.name,
        "mediaFile": media.name,
        "rating": value,
    }



def rating_summary(folder_path, model_id=None):
    return {
        "operation": "test_rating_summary",
        "candidateScores": _candidate_rating_scores(folder_path, model_id),
        "candidateVisionScores": _candidate_vision_scores(folder_path, model_id),
        "sessions": list_sessions(folder_path, model_id=model_id),
    }

def _session_result_path(session_directory, file_name):
    name = str(file_name or "").strip()
    if not name or name in (".", "..") or "/" in name or "\\" in name:
        raise ValueError("Test result filename is invalid.")
    path = Path(session_directory) / name
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise RuntimeError("Test result is not a regular file: " + name)
    return path


def _staged_lora_provenance(lora_file):
    sidecar = Path(lora_file).with_suffix(".webcap.json")
    try:
        payload = json.loads(sidecar.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _has_webcap_staged_provenance(lora_file, model, provenance=None):
    payload = provenance if provenance is not None else _staged_lora_provenance(lora_file)
    if payload.get("version") != 1:
        return False
    if str(payload.get("stage") or "").strip().lower() != str(model.STAGING_KEY or "").strip().lower():
        return False
    has_run_identity = bool(
        str(payload.get("sourceRunPath") or "").strip()
        and str(payload.get("sourceActionId") or "").strip()
    )
    if not has_run_identity and not str(payload.get("sourceJobId") or "").strip():
        return False
    if not str(payload.get("sourceFolder") or "").strip():
        return False
    if not str(payload.get("sourceFileName") or "").strip():
        return False
    try:
        return int(payload.get("sourceEpoch")) >= 0
    except (TypeError, ValueError):
        return False



def _staged_loras_for_set(folder_path, model):
    directory = _test_directory(folder_path, model)
    if not directory.is_dir():
        return []
    # The deterministic Test folder owns candidate membership. Provenance only
    # enriches run-aware metadata and actions; it is not an admission gate.
    return _lora_files(directory)


def _selected_lora_files_for_set(folder_path, model, selected_files=None, campaign_staging=""):
    available = {path.name: path for path in _staged_loras_for_set(folder_path, model)}
    if campaign_staging:
        if not re.fullmatch(r"epoch-finder-[a-f0-9]{12}", campaign_staging):
            raise ValueError("Invalid campaign staging directory.")
        directory = _test_directory(folder_path, model) / campaign_staging
        if directory.is_symlink() or not directory.is_dir():
            raise FileNotFoundError("Campaign staging directory is unavailable.")
        available = {campaign_staging + "/" + path.name: path for path in _lora_files(directory)}
    if selected_files is None:
        return sorted(available.values(), key=lambda path: path.name.lower())
    if not isinstance(selected_files, (list, tuple)):
        raise ValueError("Selected Test candidates must be a list of staged filenames.")

    selected = []
    seen = set()
    for value in selected_files:
        name = str(value or "").strip()
        if (
            not name
            or name in (".", "..")
            or ("\\" in name)
            or ("/" in name and (not campaign_staging or not name.startswith(campaign_staging + "/") or name.count("/") != 1))
            or not name.lower().endswith(".safetensors")
        ):
            raise ValueError("Selected Test candidates must be staged .safetensors filenames.")
        if name in seen:
            continue
        seen.add(name)
        if name not in available:
            raise ValueError("Selected Test candidate does not belong to the current Set: " + name)
        selected.append(available[name])

    if not selected:
        raise ValueError("Select at least one staged LoRA to test.")
    return sorted(selected, key=lambda path: path.name.lower())

def _staged_candidate_catalog(lora_files, model):
    """Build both Test candidate views using one sidecar read per LoRA.

    Training run lookup and selected-epoch lookup are reused per run, not
    repeated for every staged epoch. This cache exists only for this request.
    """
    runs = {}
    metadata = {}
    resolved_by_identity = {}
    selected_by_run = {}
    for lora_file in lora_files:
        provenance = _staged_lora_provenance(lora_file)
        if not _has_webcap_staged_provenance(lora_file, model, provenance):
            continue

        folder = str(provenance.get("sourceFolder") or "").strip()
        source_job_id = str(provenance.get("sourceJobId") or "").strip()
        epoch = int(provenance.get("sourceEpoch"))
        stage = str(provenance.get("stage") or "").strip().lower()
        run_name = str(provenance.get("sourceRunName") or "").strip()
        run_sequence = str(provenance.get("sourceRunSequence") or "").strip()
        run_summary = provenance.get("runSummary") if isinstance(provenance.get("runSummary"), dict) else {}
        # Include every field used by current and legacy run lookup so that
        # different training runs are never collapsed into one cached result.
        identity = (
            folder, stage, str(provenance.get("sourceRunPath") or "").strip(),
            str(provenance.get("sourceActionId") or "").strip(),
            source_job_id, run_name, run_sequence,
        )
        if identity not in resolved_by_identity:
            try:
                run_dir, resolved_run = candidate_run_snapshot_from_provenance(provenance)
                resolved_by_identity[identity] = (str(run_dir), resolved_run)
            except (LookupError, FileNotFoundError, RuntimeError, ValueError, OSError):
                resolved_by_identity[identity] = None

        resolved = resolved_by_identity[identity]
        if resolved is None:
            job_id = source_job_id
            metadata_run_key = (folder, source_job_id)
            runs_key = source_job_id
        else:
            run_dir, resolved_run = resolved
            job_id = str(resolved_run.get("id") or source_job_id)
            metadata_run_key = run_dir
            runs_key = run_dir
            run_name = str(resolved_run.get("runName") or run_name)
            run_sequence = str(resolved_run.get("sequence") or run_sequence)
            run_summary = resolved_run.get("runSummary") if isinstance(resolved_run.get("runSummary"), dict) else run_summary

        if job_id:
            runs[runs_key] = {
                "jobId": job_id,
                "sourceJobId": source_job_id,
                "folder": folder,
                "runName": run_name,
                "runSequence": run_sequence,
                "runSummary": run_summary,
            }

        if metadata_run_key not in selected_by_run:
            try:
                selected_by_run[metadata_run_key] = candidate_selected_epoch_from_provenance(provenance)
            except (LookupError, FileNotFoundError, RuntimeError, ValueError, OSError):
                selected_by_run[metadata_run_key] = None
        selected = selected_by_run[metadata_run_key]
        metadata[lora_file.name] = {
            "jobId": job_id,
            "sourceJobId": source_job_id,
            "folder": folder,
            "epoch": epoch,
            "stage": stage,
            "sourceFileName": str(provenance.get("sourceFileName") or "").strip(),
            "trainingVariant": str(run_summary.get("trainingVariant") or "") if stage == "h3" else "",
            "selected": bool(selected and int(selected.get("epoch") or 0) == epoch),
            "selectedEpoch": selected,
            "modelProfile": provenance.get("modelProfile") if isinstance(provenance.get("modelProfile"), dict) else None,
        }
    return list(runs.values()), metadata


def _new_session_seed():
    return secrets.randbelow(2 ** 32)


def _result_paths(session_directory, lora_file, stem_override=None, extension=".mp4"):
    raw_stem = str(stem_override or lora_file.stem)
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", raw_stem).strip("._") or "result"
    suffix_text = str(extension or "").strip()
    if not suffix_text.startswith("."):
        suffix_text = "." + suffix_text
    media = Path(session_directory) / (stem + suffix_text)
    caption = Path(session_directory) / (stem + ".txt")
    suffix = 2
    while media.exists() or caption.exists():
        media = Path(session_directory) / (stem + "-" + str(suffix) + suffix_text)
        caption = Path(session_directory) / (stem + "-" + str(suffix) + ".txt")
        suffix += 1
    return media, caption

def _candidate_elapsed_ms(started_at):
    return max(0, int(round((time.monotonic() - started_at) * 1000)))


def _workflow_evidence(model, template):
    canonical = json.dumps(
        template,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return {
        "workflowFile": model.TEMPLATE_PATH.name,
        "workflowSha256": hashlib.sha256(canonical).hexdigest(),
    }


def supported_models():
    return {
        "operation": "test_models",
        "models": registered_test_models(),
    }



def prepare(folder_path, model_id=None):
    model = get_test_model(model_id)
    template = model.load_template()
    prompt_state = workspace_prompt(folder_path, model.PROFILE_ID)
    try:
        loras = _staged_loras_for_set(folder_path, model)
    except ValueError:
        loras = []
    defaults = model.template_settings(template)
    defaults["seed"] = _new_session_seed()
    setting_options = {}
    prepare_warnings = []
    try:
        from . import inference_runtime
        setting_options = model.setting_options(template, inference_runtime.available_names)
    except (ConnectionError, RuntimeError) as exc:
        prepare_warnings.append(
            "Could not load optional Test setting choices from ComfyUI: " + str(exc)
        )
    candidate_runs, candidate_metadata = _staged_candidate_catalog(loras, model)
    from .checkpoint_ratings import by_checkpoint
    # One filesystem discovery/read pass serves rating scores, history and
    # latest-status selection. Live sessions still use authoritative sync.
    session_snapshot = [
        (session, _read_status(session) or {})
        for session in _session_directories(folder_path)
    ]
    visible_sessions = [
        (session, _visible_session_status(folder_path, session, stored=stored))
        for session, stored in session_snapshot
    ]
    return {
        "operation": "test_prepare",
        "modelId": model.PROFILE_ID,
        "modelLabel": str(model.profile["label"]),
        "mediaKind": model.MEDIA_KIND,
        "settings": list(model.settings),
        "settingOptions": setting_options,
        "warnings": prepare_warnings,
        "workspacePromptPresent": bool(prompt_state["present"]),
        "workspacePrompt": str(prompt_state["prompt"]),
        "defaultPrompt": model.default_prompt(template),
        "defaults": defaults,
        "defaultStrength": float(defaults.get("strength", 1)),
        "aspectRatioOptions": list(getattr(model, "ASPECT_RATIO_OPTIONS", ())),
        "count": len(loras),
        "files": [path.name for path in loras],
        "removableFiles": [path.name for path in loras],
        "candidateRuns": candidate_runs,
        "candidateMetadata": candidate_metadata,
        "checkpointHumanRatings": by_checkpoint(candidate_metadata, _candidate_rating_scores(folder_path, model.PROFILE_ID, session_snapshot=session_snapshot)),
        "candidateScores": _candidate_rating_scores(folder_path, model.PROFILE_ID, session_snapshot=session_snapshot),
        "candidateVisionScores": _candidate_vision_scores(folder_path, model.PROFILE_ID, session_snapshot=session_snapshot),
        "sessions": list_sessions(folder_path, model_id=model.PROFILE_ID, visible_snapshot=visible_sessions),
        "latest": status(folder_path, model_id=model.PROFILE_ID, visible_snapshot=visible_sessions),
    }

def handle_request(folder_path, mode, selection_criteria=None):
    operation = str(mode or "").strip().lower()
    if operation == "test_prepare":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return prepare(folder_path, model_id=criteria.get("modelId"))
    if operation == "test_save_workspace_prompt":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        saved = save_workspace_prompt(folder_path, criteria.get("modelId"), criteria.get("prompt"))
        return {
            "operation": "test_save_workspace_prompt",
            **saved,
        }
    if operation == "test_status":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return status(folder_path, model_id=criteria.get("modelId"))
    if operation == "test_sessions":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return {"operation": "test_sessions", "sessions": list_sessions(folder_path, model_id=criteria.get("modelId"))}
    if operation == "test_queue":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return queued_jobs(folder_path, model_id=criteria.get("modelId"))
    if operation == "test_queue_cancel":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return cancel_queued(folder_path, criteria.get("jobId"))
    if operation == "test_queue_clear":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return clear_queued(folder_path, model_id=criteria.get("modelId"))
    if operation == "test_open_session":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return open_session(folder_path, criteria.get("session"))
    if operation == "test_delete_session":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return delete_session(folder_path, criteria.get("session"))
    if operation == "test_clear_sessions":
        deleted = clear_sessions(folder_path)
        return {
            "operation": "test_clear_sessions",
            "deleted": deleted,
            "sessions": [],
            "latest": _latest_status(folder_path),
        }
    if operation == "test_reset_candidate_assessments":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return reset_candidate_assessments(folder_path, criteria.get("modelId"), criteria.get("candidateFile"))
    if operation == "test_rating_summary":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return rating_summary(folder_path, model_id=criteria.get("modelId"))
    if operation == "test_vision_update":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return update_vision(folder_path, criteria.get("session"), criteria)
    if operation == "test_rate_result":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return rate_result(
            folder_path,
            criteria.get("session"),
            criteria.get("mediaFile"),
            criteria.get("rating"),
        )
    if operation == "test_stop":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return stop(folder_path, session_name=criteria.get("session"))
    if operation == "test_remove_candidate":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return remove_candidate(
            folder_path,
            criteria.get("fileName"),
            session_name=criteria.get("session"),
            model_id=criteria.get("modelId"),
        )
    if operation == "test_enqueue":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        save_workspace_prompt(folder_path, criteria.get("modelId"), criteria.get("prompt"))
        if int(criteria.get("repeat") or 1) != 1 or criteria.get("autoVl"):
            return enqueue_repeated(folder_path, criteria)
        return enqueue(
            folder_path,
            criteria.get("prompt"),
            settings=criteria.get("settings"),
            aspect_ratio=criteria.get("aspectRatio"),
            megapixels=criteria.get("megapixels"),
            duration=criteria.get("duration"),
            seed=criteria.get("seed"),
            name=criteria.get("name"),
            selected_files=criteria.get("selectedFiles"),
            candidate_strengths=criteria.get("candidateStrengths"),
            sweep_weights=criteria.get("sweepWeights"),
            include_base=criteria.get("includeBase"),
            model_id=criteria.get("modelId"),
        )
    raise ValueError("Unsupported Test Generations operation: " + operation)

# Shared inference migration -------------------------------------------------


SHARED_EXECUTION_LANE = "inference"


def _normalize_wildcard_text(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _consume_wildcard_fragment(text, position, fragment):
    fragment = _normalize_wildcard_text(fragment)
    while position < len(text) and text[position].isspace():
        position += 1
    if fragment:
        if not text.startswith(fragment, position):
            return None
        position += len(fragment)
    while position < len(text) and text[position].isspace():
        position += 1
    return position


def _parse_wildcard_nodes(source):
    text = str(source or "")

    def parse_sequence(position, stop_chars=None):
        stop_chars = stop_chars or set()
        nodes = []
        literal_start = position

        while position < len(text):
            char = text[position]
            if char in stop_chars:
                if literal_start < position:
                    nodes.append(("literal", text[literal_start:position]))
                return nodes, position

            if char == "{":
                try:
                    options, next_position = parse_group(position)
                except ValueError:
                    # An unmatched opening brace is literal text. A later valid
                    # group can still contribute to the session summary.
                    position += 1
                    continue
                if literal_start < position:
                    nodes.append(("literal", text[literal_start:position]))
                nodes.append(("group", options))
                position = next_position
                literal_start = position
                continue

            # Stray closing braces are literal too: summary extraction must
            # not discard unrelated valid wildcard groups.

            position += 1

        if literal_start < position:
            nodes.append(("literal", text[literal_start:position]))
        return nodes, position

    def parse_group(position):
        position += 1
        options = []
        while True:
            nodes, position = parse_sequence(position, {"|", "}"})
            options.append(nodes)
            if position >= len(text):
                raise ValueError("Unclosed wildcard group.")
            if text[position] == "|":
                position += 1
                continue
            return options, position + 1

    nodes, position = parse_sequence(0)
    if position != len(text):
        raise ValueError("Wildcard prompt could not be parsed.")
    return nodes


def _wildcard_nodes_have_group(nodes):
    return any(kind == "group" for kind, _value in nodes)


def _singleton_wildcard_literal(options):
    if len(options) != 1 or any(kind != "literal" for kind, _value in options[0]):
        return ""
    return "{" + "".join(value for _kind, value in options[0]) + "}"


def _match_wildcard_nodes(nodes, resolved, node_index=0, position=0):
    if node_index >= len(nodes):
        return position, []

    kind, value = nodes[node_index]
    if kind == "literal":
        next_position = _consume_wildcard_fragment(resolved, position, value)
        if next_position is None:
            return None
        return _match_wildcard_nodes(nodes, resolved, node_index + 1, next_position)

    for option in value:
        option_match = _match_wildcard_nodes(option, resolved, 0, position)
        if option_match is None:
            continue
        option_position, nested_values = option_match
        tail_match = _match_wildcard_nodes(nodes, resolved, node_index + 1, option_position)
        if tail_match is None:
            continue

        tail_position, tail_values = tail_match
        selected_text = _normalize_wildcard_text(resolved[position:option_position])
        if _wildcard_nodes_have_group(option) and nested_values:
            selected_values = nested_values
        else:
            selected_values = [selected_text] if selected_text else []
        return tail_position, selected_values + tail_values

    singleton = _singleton_wildcard_literal(value)
    if singleton:
        # Impact Wildcards can leave one-choice braces verbatim. They are not
        # a resolved selection, but must not invalidate surrounding choices.
        end = _consume_wildcard_fragment(resolved, position, singleton)
        if end is not None:
            tail = _match_wildcard_nodes(nodes, resolved, node_index + 1, end)
            if tail is not None:
                return tail
    return None


def _strip_wildcard_comments(text):
    text = re.sub(r"(?m)^[ \t]*#[^\r\n]*(?:\r?\n|$)", " ", text)
    return re.sub(
        r"(?<!\S)#[^\r\n]*?(?:\.(?=\s+[A-Z])|(?=\r?\n)|$)",
        "",
        text,
    )


def _match_wildcard_source(source, resolved, matcher):
    # Treat comments as non-prompt content even if the resolver echoes them.
    # Try a cleaned resolved prompt as well as one where Impact removed them.
    candidate = _strip_wildcard_comments(source)
    resolved_candidates = [resolved]
    uncommented_resolved = _normalize_wildcard_text(_strip_wildcard_comments(resolved))
    if uncommented_resolved != resolved:
        resolved_candidates.insert(0, uncommented_resolved)
    nodes = _parse_wildcard_nodes(candidate)
    for text in resolved_candidates:
        matched = matcher(nodes, text)
        if matched is not None and matched[0] == len(text):
            return candidate, nodes, matched[1]
    return None


def _resolved_wildcard_values(source_prompt, resolved_prompt):
    source = str(source_prompt or "")
    resolved = _normalize_wildcard_text(resolved_prompt)
    if "{" not in source:
        return []

    matched = _match_wildcard_source(source, resolved, _match_wildcard_nodes)
    if matched is not None:
        return matched[2]
    return [selection for selection in _recover_wildcard_selections(source, resolved)[2] if selection]


_WILDCARD_SUMMARY_LOW_TERMS = {
    "view", "shot", "camera", "angle", "perspective", "lighting",
    "background", "setting", "scene", "breast", "breasts", "body",
    "physique", "music", "beat", "audio", "sound", "woman", "man",
    "person", "people",
}
_WILDCARD_SUMMARY_MID_TERMS = {
    "hair", "skin", "eye", "eyes", "face", "smile", "freckles",
    "glasses", "clothing", "outfit", "shirt", "dress", "skirt",
    "pants", "trousers", "jacket", "coat", "top", "bottom", "trim",
    "bikini", "swimsuit", "shoe", "shoes",
}
_WILDCARD_SUMMARY_PLACE_TERMS = {
    "bedroom", "beach", "pool", "apartment", "studio", "room", "street",
    "forest", "city", "park", "kitchen", "bathroom", "office", "outdoors",
    "outdoor", "indoors", "indoor",
}
_WILDCARD_SUMMARY_ACTION_PREFIXES = (
    "standing", "sitting", "kneeling", "walking", "running", "rotating",
    "stretching", "holding", "looking", "posing", "lying", "dancing",
    "turning", "leaning", "arching", "slowly", "raising", "lowering",
)
_WILDCARD_SUMMARY_GENERIC_SET_TERMS = {
    "set", "dataset", "training", "train", "images", "image",
    "videos", "video", "data", "test",
}


def _match_top_level_wildcard_selections(nodes, resolved, node_index=0, position=0):
    if node_index >= len(nodes):
        return position, []

    kind, value = nodes[node_index]
    if kind == "literal":
        next_position = _consume_wildcard_fragment(resolved, position, value)
        if next_position is None:
            return None
        return _match_top_level_wildcard_selections(
            nodes,
            resolved,
            node_index + 1,
            next_position,
        )

    for option in value:
        option_match = _match_wildcard_nodes(option, resolved, 0, position)
        if option_match is None:
            continue
        option_position, _nested_values = option_match
        tail_match = _match_top_level_wildcard_selections(
            nodes,
            resolved,
            node_index + 1,
            option_position,
        )
        if tail_match is None:
            continue
        tail_position, tail_values = tail_match
        selected_text = _normalize_wildcard_text(resolved[position:option_position])
        return tail_position, [selected_text] + tail_values

    singleton = _singleton_wildcard_literal(value)
    if singleton:
        end = _consume_wildcard_fragment(resolved, position, singleton)
        if end is not None:
            tail = _match_top_level_wildcard_selections(nodes, resolved, node_index + 1, end)
            if tail is not None:
                return tail[0], [""] + tail[1]
    return None


def _top_level_wildcard_spans(source):
    starts = []
    spans = []
    for index, char in enumerate(str(source or "")):
        if char == "{":
            starts.append(index)
        elif char == "}" and starts:
            spans.append((starts.pop(), index + 1))
    # Ignore unmatched braces; prefer complete outer groups over nested ones.
    top_level = []
    for span in sorted(spans):
        if not top_level or span[0] >= top_level[-1][1]:
            top_level.append(span)
    return top_level


def _wildcard_neighbor_literal(nodes, node_index, direction):
    index = node_index + direction
    while 0 <= index < len(nodes):
        kind, value = nodes[index]
        if kind == "literal":
            text = _normalize_wildcard_text(value)
            if text:
                return text
        index += direction
    return ""


def _recover_wildcard_selections(source, resolved):
    """Recover only choices unambiguously anchored in the resolved prompt.

    The normal whole-prompt matcher takes precedence. This local fallback never
    guesses a value for an empty, nested or ambiguous group.
    """
    source = _strip_wildcard_comments(str(source or ""))
    resolved = _normalize_wildcard_text(_strip_wildcard_comments(resolved))
    nodes = _parse_wildcard_nodes(source)
    selections = []
    for index, (kind, options) in enumerate(nodes):
        if kind != "group":
            continue
        before = " ".join(_wildcard_neighbor_literal(nodes, index, -1).split()[-2:])
        after = " ".join(_wildcard_neighbor_literal(nodes, index, 1).split()[:2])
        matches = []
        for option in options:
            if any(option_kind != "literal" for option_kind, _ in option):
                continue
            choice = _normalize_wildcard_text("".join(value for _, value in option))
            if not choice:
                continue
            token = r"(?<!\w)" + re.escape(choice) + r"(?!\w)"
            # Prefer the source's left context. Finding an option elsewhere
            # beside the right context is not proof it was selected here.
            if before:
                prefix = re.escape(before) + r"\s*" + token
                if after and re.search(prefix + r"\s*" + re.escape(after), resolved):
                    matches.append((3, choice))
                elif re.search(prefix, resolved):
                    matches.append((2, choice))
            elif after:
                # With no left context, the first group must match the start.
                if re.search(r"^" + token + r"\s*" + re.escape(after), resolved):
                    matches.append((1, choice))
            elif resolved == choice:
                matches.append((1, choice))
        if matches:
            strongest = max(score for score, _choice in matches)
            choices = {choice for score, choice in matches if score == strongest}
            selections.append(next(iter(choices)) if len(choices) == 1 else "")
        else:
            selections.append("")
    return source, nodes, selections


def _wildcard_summary_suffix(after_literal):
    raw = str(after_literal or "").lstrip()
    if not raw or raw[0] in ",;:":
        return ""
    text = _normalize_wildcard_text(raw)
    candidate = re.split(
        r"[,.;:!?]|\b(?:and|with|while|who|which|that|she|he|they|is|are|was|were)\b",
        text,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    words = _normalize_wildcard_text(candidate).split()
    return " ".join(words[:4])


def _clean_wildcard_summary_selection(value):
    text = _normalize_wildcard_text(value).strip(" ,.;:")
    text = re.sub(r"^(?:with|in|on|at)\s+", "", text, flags=re.IGNORECASE)
    text = re.sub(r"^(?:a|an|the)\s+", "", text, flags=re.IGNORECASE)
    return text


def _wildcard_set_concept(owner_folder):
    name = Path(str(owner_folder or "").replace("\\", "/")).name
    name = re.sub(r"[_-]+", " ", name).casefold()
    terms = [
        term for term in re.findall(r"[a-z0-9]+", name)
        if len(term) > 2 and term not in _WILDCARD_SUMMARY_GENERIC_SET_TERMS
    ]
    return " ".join(terms), terms


def _wildcard_summary_semantic_base(item):
    before_words = _normalize_wildcard_text(item.get("before")).split()
    after_words = _normalize_wildcard_text(item.get("after")).split()
    context = " ".join([
        str(item.get("phrase") or ""),
        " ".join(before_words[-3:]),
        " ".join(after_words[:4]),
        str(item.get("groupSource") or ""),
    ]).casefold()
    words = set(re.findall(r"[a-z-]+", context))

    if words.intersection(_WILDCARD_SUMMARY_LOW_TERMS):
        score = 0
    elif words.intersection(_WILDCARD_SUMMARY_MID_TERMS):
        score = 30
    else:
        score = 50

    raw = _normalize_wildcard_text(item.get("raw")).casefold()
    if words.intersection(_WILDCARD_SUMMARY_PLACE_TERMS):
        score = min(score, 0)
    if raw.startswith(_WILDCARD_SUMMARY_ACTION_PREFIXES):
        score = min(score, 0)
    return score


def _wildcard_summary_score(item, source_prompt, owner_folder):
    score = _wildcard_summary_semantic_base(item)
    concept, concept_terms = _wildcard_set_concept(owner_folder)
    source = str(source_prompt or "").casefold()
    concept_positions = []

    if concept:
        position = source.find(concept)
        if position >= 0:
            concept_positions.append(position)
    if not concept_positions:
        for term in concept_terms:
            position = source.find(term)
            if position >= 0:
                concept_positions.append(position)

    bonus = 0
    if concept_positions:
        start, end = item.get("span") or (0, 0)
        distance = min(
            0 if start <= position <= end else min(abs(start - position), abs(end - position))
            for position in concept_positions
        )
        if distance <= 80:
            bonus = 70
        elif distance <= 160:
            bonus = 55
        elif distance <= 260:
            bonus = 35
        elif distance <= 400:
            bonus = 15

    phrase = str(item.get("phrase") or "").casefold()
    if concept and concept in phrase:
        bonus = max(bonus, 80)
    elif concept_terms:
        matched_terms = sum(1 for term in concept_terms if term in phrase)
        required_terms = max(1, min(2, len(concept_terms)))
        if matched_terms >= required_terms:
            bonus = max(bonus, 70)

    return score + bonus


def _wildcard_summary_items(source_prompt, resolved_prompt):
    source = str(source_prompt or "")
    resolved = _normalize_wildcard_text(resolved_prompt)
    if "{" not in source:
        return []

    matched = _match_wildcard_source(source, resolved, _match_top_level_wildcard_selections)
    source, nodes, selections = (
        matched if matched is not None else _recover_wildcard_selections(source, resolved)
    )

    spans = _top_level_wildcard_spans(source)
    group_nodes = [
        (node_index, value)
        for node_index, (kind, value) in enumerate(nodes)
        if kind == "group"
    ]
    if len(spans) != len(group_nodes) or len(selections) != len(group_nodes):
        return []

    items = []
    for group_index, ((node_index, _group), selected) in enumerate(zip(group_nodes, selections)):
        if not selected:
            continue
        before = _wildcard_neighbor_literal(nodes, node_index, -1)
        after = _wildcard_neighbor_literal(nodes, node_index, 1)
        suffix = _wildcard_summary_suffix(after)
        phrase = _clean_wildcard_summary_selection(selected)
        if phrase and suffix and suffix.casefold() not in phrase.casefold():
            phrase = phrase + " " + suffix
        if not phrase:
            continue

        anchor = suffix or phrase.split()[-1]
        start, end = spans[group_index]
        items.append({
            "index": group_index,
            "raw": selected,
            "phrase": phrase,
            "anchor": anchor,
            "before": before,
            "after": after,
            "span": (start, end),
            "groupSource": source[start:end],
        })
    return items


def _resolved_wildcard_summary(source_prompt, resolved_prompt, owner_folder=""):
    items = _wildcard_summary_items(source_prompt, resolved_prompt)
    if not items:
        return []

    aggregates = []
    by_anchor = {}
    for item in items:
        anchor = str(item.get("anchor") or "").strip()
        key = anchor.casefold() if anchor else "group-" + str(item.get("index"))
        score = _wildcard_summary_score(item, source_prompt, owner_folder)
        aggregate = by_anchor.get(key)
        if aggregate is None:
            aggregate = {
                "anchor": anchor,
                "items": [],
                "score": score,
                "index": int(item.get("index") or 0),
            }
            by_anchor[key] = aggregate
            aggregates.append(aggregate)
        aggregate["items"].append(item)
        aggregate["score"] = max(int(aggregate.get("score") or 0), score)

    for aggregate in aggregates:
        group_items = aggregate["items"]
        anchor = str(aggregate.get("anchor") or "").strip()
        if len(group_items) == 1:
            aggregate["phrase"] = str(group_items[0].get("phrase") or "")
            continue

        components = []
        anchor_folded = anchor.casefold()
        for item in group_items:
            phrase = str(item.get("phrase") or "").strip()
            phrase_folded = phrase.casefold()
            suffix = " " + anchor_folded if anchor_folded else ""
            if anchor_folded and phrase_folded.endswith(suffix):
                component = phrase[:-(len(anchor) + 1)].strip()
            elif phrase_folded == anchor_folded:
                component = ""
            else:
                component = phrase
            if component and component.casefold() not in {value.casefold() for value in components}:
                components.append(component)
        aggregate["phrase"] = " ".join(components + ([anchor] if anchor else [])).strip()

    ranked = sorted(
        aggregates,
        key=lambda item: (-int(item.get("score") or 0), int(item.get("index") or 0)),
    )
    return [
        str(item.get("phrase") or "").strip()
        for item in ranked
        if str(item.get("phrase") or "").strip()
    ]


def _expand_wildcard_option(nodes):
    """Expand nested alternatives into visible choices for one top-level group."""
    phrases = [""]
    for kind, value in nodes:
        if kind == "literal":
            pieces = [value]
        else:
            pieces = [
                phrase
                for option in value
                for phrase in _expand_wildcard_option(option)
            ]
        phrases = [prefix + piece for prefix in phrases for piece in pieces]
    return phrases


def _wildcard_evaluation_groups(source_prompt, resolved_prompt):
    """Produce all choices, with the expected selection kept separate for local comparison."""
    source = _strip_wildcard_comments(str(source_prompt or ""))
    resolved = _normalize_wildcard_text(str(resolved_prompt or ""))
    if not source or "{" not in source:
        return []

    matched = _match_wildcard_source(source, resolved, _match_top_level_wildcard_selections)
    if matched is not None:
        source, nodes, selections = matched
    else:
        source, nodes, selections = _recover_wildcard_selections(source, resolved)

    groups = []
    for node_index, (kind, alternatives) in enumerate(nodes):
        if kind != "group":
            continue
        options = []
        for alternative in alternatives:
            for text in _expand_wildcard_option(alternative):
                choice = _normalize_wildcard_text(text)
                if choice not in options:
                    options.append(choice)
        selected = selections[len(groups)] if len(selections) > len(groups) else ""
        # The recovery matcher cannot prove that an empty alternative was chosen.
        expected = options.index(selected) + 1 if selected in options and (selected or matched is not None) else None
        following = _wildcard_neighbor_literal(nodes, node_index, 1)
        label = _wildcard_summary_suffix(following)
        if not label:
            preceding = _wildcard_neighbor_literal(nodes, node_index, -1)
            label = " ".join(preceding.split()[-4:]).strip(" ,.;:")
        groups.append({
            "id": "G" + str(len(groups) + 1),
            "label": label or "attribute",
            "options": options,
            "expected": expected,
        })
    return groups


def _project_wildcard_fields(payload):
    visible = payload
    source = visible.get("sourcePrompt")
    resolved = visible.get("resolvedPrompt") or visible.get("prompt")
    visible["wildcardValues"] = _resolved_wildcard_values(source, resolved)
    visible["wildcardEvaluationGroups"] = _wildcard_evaluation_groups(source, resolved)
    visible["wildcardSummary"] = _resolved_wildcard_summary(
        source, resolved, visible.get("ownerFolder"),
    )
    return visible


def _new_inference_request(folder_path, prompt, settings=None, seed=None, name=None,
                           selected_files=None, candidate_strengths=None, include_base=True, model_id=None,
                           aspect_ratio=None, megapixels=None, duration=None, sweep_weights=None, campaign_staging=""):
    from . import inference_runtime

    model = get_test_model(model_id)
    prompt = str(prompt or "").strip()
    if not prompt:
        raise ValueError("A test prompt is required.")
    loras = _selected_lora_files_for_set(folder_path, model, selected_files=selected_files, campaign_staging=campaign_staging)
    strength_by_file = {}
    if candidate_strengths is not None:
        if not isinstance(candidate_strengths, dict):
            raise ValueError("Test candidate strengths must be an object keyed by staged filename.")
        for path in loras:
            raw_strength = candidate_strengths.get(path.name)
            if raw_strength is None:
                continue
            try:
                strength = float(raw_strength)
            except (TypeError, ValueError) as exc:
                raise ValueError("Test candidate strength must be numeric.") from exc
            if strength < -2 or strength > 2:
                raise ValueError("Test candidate strength must be between -2 and 2.")
            strength_by_file[path.name] = strength
    weights = None
    if sweep_weights is not None:
        if not isinstance(sweep_weights, list) or not sweep_weights:
            raise ValueError("Weight sweep requires a nonempty list of weights.")
        weights = []
        for item in sweep_weights:
            if isinstance(item, bool):
                raise ValueError("Sweep weights must be numeric.")
            try:
                value = float(item)
            except (TypeError, ValueError) as exc:
                raise ValueError("Sweep weights must be numeric.") from exc
            if not math.isfinite(value) or value < -2 or value > 2:
                raise ValueError("Sweep weights must be between -2 and 2.")
            if value in weights:
                raise ValueError("Weight sweep cannot contain duplicate weights.")
            weights.append(value)
        weights.sort()
    session_name = str(name or "").strip()
    if len(session_name) > 120:
        raise ValueError("Test session name must be 120 characters or fewer.")

    requested_settings = dict(settings) if isinstance(settings, dict) else {}
    legacy = {
        "aspectRatio": aspect_ratio,
        "megapixels": megapixels,
        "duration": duration,
        "seed": seed,
    }
    for key, value in legacy.items():
        if key not in requested_settings and value is not None:
            requested_settings[key] = value

    template = model.load_template()
    normalized_settings = model.normalize_settings(template, _new_session_seed, requested_settings)

    prompt_needs_resolve = False
    try:
        resolved_prompt = inference_runtime.resolve_wildcard_prompt(
            prompt,
            normalized_settings["seed"],
        )
    except (ConnectionError, TimeoutError):
        resolved_prompt = prompt
        prompt_needs_resolve = True
    request = {
        "modelId": model.PROFILE_ID,
        "mediaKind": model.MEDIA_KIND,
        "name": session_name,
        "sourcePrompt": prompt,
        "prompt": resolved_prompt,
        "promptNeedsResolve": prompt_needs_resolve,
        "settings": dict(normalized_settings),
        "workflow": copy.deepcopy(template),
        "candidateStrengths": strength_by_file,
        "campaignStaging": campaign_staging,
    }
    if weights is not None:
        request["sweepWeights"] = weights
    request.update(_workflow_evidence(model, template))
    return request, loras, include_base is not False

def committed_inference_outcome(job):
    metadata = job.get("metadata") if isinstance(job, dict) and isinstance(job.get("metadata"), dict) else {}
    job_id = str(job.get("id") or "").strip() if isinstance(job, dict) else ""
    folder = str(metadata.get("folder") or "").strip()
    session_id = str(metadata.get("sessionId") or "").strip()
    if not job_id or not session_id:
        return None
    folder_path = app_config.safe_join_fs_root(folder) if folder else Path(app_config.FS_ROOT).resolve()
    try:
        session_directory = _session_directory(folder_path, session_id)
    except FileNotFoundError:
        return None
    status = _read_status(session_directory) or {}

    for result in status.get("results") if isinstance(status.get("results"), list) else []:
        if not isinstance(result, dict) or str(result.get("jobId") or "") != job_id:
            continue
        media_file = str(result.get("mediaFile") or "").strip()
        try:
            committed_media = _session_result_path(session_directory, media_file)
        except (ValueError, RuntimeError):
            committed_media = None
        if committed_media is None or not committed_media.is_file():
            continue
        return {
            "status": "completed",
            "result": {
                "status": "completed",
                "session": session_id,
                "mediaFile": media_file,
            },
            "error": "",
        }

    if job_id in {str(value) for value in (status.get("skippedJobIds") or [])}:
        return {
            "status": "completed",
            "result": {"status": "skipped", "session": session_id},
            "error": "",
        }

    if job_id in {str(value) for value in (status.get("cancelledJobIds") or [])}:
        return {
            "status": "cancelled",
            "result": {},
            "error": "",
        }

    for failure in status.get("failures") if isinstance(status.get("failures"), list) else []:
        if isinstance(failure, dict) and str(failure.get("jobId") or "") == job_id:
            return {
                "status": "failed",
                "result": {},
                "error": str(failure.get("error") or "Test generation failed."),
            }
    return None


def _set_session_cancel_marker(session_directory, job_id, present, reduce_total=False):
    if session_directory is None:
        return False
    job_id = str(job_id or "").strip()
    if not job_id:
        return False
    with _status_lock:
        status = _read_status(session_directory) or {}
        cancelled = set(str(value) for value in (status.get("cancelledJobIds") or []))
        changed = False
        if present and job_id not in cancelled:
            cancelled.add(job_id)
            if reduce_total:
                status["total"] = max(0, int(status.get("total") or 0) - 1)
            changed = True
        elif not present and job_id in cancelled:
            cancelled.remove(job_id)
            if reduce_total:
                status["total"] = int(status.get("total") or 0) + 1
            changed = True
        if changed:
            status["cancelledJobIds"] = sorted(cancelled)
            _atomic_write_json(_status_path(session_directory), status)
        return changed


def _cancel_shared_pending_job(job_id, session_directory=None, reduce_total=False):
    from .inference_runner import action as inference_action
    marked = _set_session_cancel_marker(
        session_directory,
        job_id,
        True,
        reduce_total=reduce_total,
    )
    try:
        return inference_action("cancel", job_id=str(job_id or "").strip())["job"]
    except Exception:
        if marked:
            _set_session_cancel_marker(
                session_directory,
                job_id,
                False,
                reduce_total=reduce_total,
            )
        raise


def _session_job_records(status, missing_job_ids=None):
    job_ids = status.get("inferenceJobs") if isinstance(status.get("inferenceJobs"), list) else []
    results = status.get("results") if isinstance(status.get("results"), list) else []
    failures = status.get("failures") if isinstance(status.get("failures"), list) else []
    terminal_job_ids = {
        str(item.get("jobId") or "")
        for item in results + failures
        if isinstance(item, dict) and str(item.get("jobId") or "").strip()
    }
    terminal_job_ids.update(
        str(value)
        for key in ("skippedJobIds", "cancelledJobIds")
        for value in (status.get(key) or [])
        if str(value or "").strip()
    )

    jobs = []
    for raw_job_id in job_ids:
        job_id = str(raw_job_id or "").strip()
        if not job_id:
            continue
        try:
            jobs.append(execution_get_job(job_id))
        except FileNotFoundError:
            try:
                jobs.append(execution_transient_receipt(job_id))
                continue
            except FileNotFoundError:
                pass
            if job_id not in terminal_job_ids and missing_job_ids is not None:
                missing_job_ids.append(job_id)
    return jobs


def _job_candidate_identity(job):
    metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
    kind = str(metadata.get("candidateKind") or "")
    candidate_file = str(metadata.get("candidateFile") or "")
    label = "Base" if kind == "base" else (candidate_file or str(metadata.get("label") or ""))
    return kind, candidate_file, label


def _session_has_nonterminal_jobs(session_directory):
    status = _read_status(session_directory) or {}
    if not status.get("inferenceJobs"):
        return False
    return any(
        str(job.get("status") or "") in {"backlog", "queued", "starting", "running", "stopping"}
        for job in _session_job_records(status)
    )


def _session_candidate_has_nonterminal_job(status, candidate_name):
    for job in _session_job_records(status):
        job_status = str(job.get("status") or "")
        if job_status not in {"backlog", "queued", "starting", "running", "stopping"}:
            continue
        _kind, candidate_file, _label = _job_candidate_identity(job)
        if candidate_file == candidate_name:
            return True
    return False


def _sync_inference_session(session_directory):
    with _status_lock:
        status = _read_status(session_directory) or {}
        if not isinstance(status.get("inferenceJobs"), list):
            return _session_status(session_directory)

        missing_job_ids = []
        jobs = _session_job_records(status, missing_job_ids=missing_job_ids)
        results = status.get("results") if isinstance(status.get("results"), list) else []
        failures = status.get("failures") if isinstance(status.get("failures"), list) else []
        result_job_ids = {
            str(item.get("jobId") or "") for item in results if isinstance(item, dict)
        }
        failure_job_ids = {
            str(item.get("jobId") or "") for item in failures if isinstance(item, dict)
        }
        skipped_job_ids = set(str(value) for value in (status.get("skippedJobIds") or []))
        cancelled_job_ids = set(str(value) for value in (status.get("cancelledJobIds") or []))
        changed = False

        if missing_job_ids:
            missing = set(missing_job_ids)
            status["inferenceJobs"] = [
                str(job_id)
                for job_id in (status.get("inferenceJobs") or [])
                if str(job_id or "").strip() and str(job_id or "").strip() not in missing
            ]
            status["total"] = max(
                len(results) + len(failures),
                int(status.get("total") or 0) - len(missing),
            )
            changed = True
            _logger.warning(
                "Dropped %d stale Test inference job reference(s) from Session %s: %s",
                len(missing),
                Path(session_directory).name,
                ", ".join(sorted(missing)),
            )

        stopping_session = str(status.get("status") or "") in {"stopping", "stopped"}
        for job in jobs:
            job_id = str(job.get("id") or "")
            job_status = str(job.get("status") or "")
            if (
                job_status in {"failed", "interrupted"}
                and job_id not in result_job_ids
                and job_id not in failure_job_ids
            ):
                _kind, candidate_file, label = _job_candidate_identity(job)
                failure = {
                    "jobId": job_id,
                    "sourceLoRA": label or candidate_file or "Generation",
                    "candidateFile": candidate_file,
                    "error": str(job.get("error") or "Test generation failed."),
                    "elapsedMs": 0,
                }
                metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
                if status.get("sweepWeights") and metadata.get("candidateStrength") is not None:
                    failure["strength"] = float(metadata["candidateStrength"])
                failures.append(failure)
                failure_job_ids.add(job_id)
                changed = True
            if (
                job_status in {"cancelled", "stopped"}
                and not stopping_session
                and job_id not in cancelled_job_ids
            ):
                cancelled_job_ids.add(job_id)
                status["total"] = max(0, int(status.get("total") or 0) - 1)
                changed = True

        if changed:
            status["failures"] = failures
            status["failed"] = len(failures)
            status["cancelledJobIds"] = sorted(cancelled_job_ids)
            status["skippedJobIds"] = sorted(skipped_job_ids)
            _atomic_write_json(_status_path(session_directory), status)

        active = next(
            (
                job for job in jobs
                if str(job.get("status") or "") in {"starting", "running", "stopping"}
            ),
            None,
        )
        pending = [job for job in jobs if str(job.get("status") or "") in {"backlog", "queued"}]
        queued = [job for job in pending if str(job.get("status") or "") == "queued"]
        completed = len(status.get("results") if isinstance(status.get("results"), list) else [])
        failed = len(status.get("failures") if isinstance(status.get("failures"), list) else [])
        visible = dict(status)
        visible["completed"] = completed
        visible["failed"] = failed
        visible["queued"] = len(pending)
        visible["running"] = 1 if active is not None else 0
        visible["session"] = Path(session_directory).name
        visible["resultFolder"] = visible.get("resultFolder") or _session_result_folder(session_directory)
        _project_wildcard_fields(visible)

        if active is not None:
            metadata = active.get("metadata") if isinstance(active.get("metadata"), dict) else {}
            details = active.get("details") if isinstance(active.get("details"), dict) else {}
            visible["status"] = "stopping" if stopping_session or str(active.get("status") or "") == "stopping" else "running"
            visible["current"] = str(metadata.get("label") or metadata.get("candidateFile") or "Generation")
            started_at = float(active.get("startedAt") or 0)
            visible["candidateStartedAt"] = int(started_at * 1000) if started_at else None
            visible["comfyJobId"] = str(details.get("providerJobId") or "")
            visible["comfyStatus"] = str(details.get("providerStatus") or "")
            visible["progress"] = copy.deepcopy(details.get("providerProgress") or {})
            return visible

        visible["current"] = ""
        visible["comfyJobId"] = ""
        visible["comfyStatus"] = ""
        visible["progress"] = {}
        visible["candidateStartedAt"] = None

        if stopping_session:
            terminal_status = "stopped"
        elif pending:
            # Backlog has no active provider work. A partially completed session
            # with only backlogged children must not masquerade as running after
            # restart or while it is waiting behind Training.
            terminal_status = "running" if queued and (completed or failed) else "queued"
        else:
            terminal_status = "complete"

        visible["status"] = terminal_status
        if terminal_status in {"complete", "stopped"} and str(status.get("status") or "") != terminal_status:
            status["status"] = terminal_status
            status["current"] = ""
            status["completed"] = completed
            status["failed"] = failed
            status["comfyJobId"] = ""
            status["comfyStatus"] = ""
            _atomic_write_json(_status_path(session_directory), status)

        if terminal_status in {"complete", "stopped"}:
            for job in jobs:
                if str(job.get("status") or "") not in {"completed", "failed", "cancelled", "stopped", "interrupted"}:
                    continue
                job_id = str(job.get("id") or "")
                try:
                    execution_consume_terminal_job(job_id)
                except FileNotFoundError:
                    try:
                        execution_transient_receipt(job_id, consume=True)
                    except FileNotFoundError:
                        pass
        return visible

def _record_skipped_inference(session_directory, job_id):
    with _status_lock:
        status = _read_status(session_directory) or {}
        skipped = set(str(value) for value in (status.get("skippedJobIds") or []))
        if job_id not in skipped:
            skipped.add(job_id)
            status["skippedJobIds"] = sorted(skipped)
            status["total"] = max(0, int(status.get("total") or 0) - 1)
            _atomic_write_json(_status_path(session_directory), status)


def _record_failed_inference(session_directory, job_id, candidate_label, candidate_file, exc, elapsed_ms, strength=None):
    with _status_lock:
        status = _read_status(session_directory) or {}
        failures = status.get("failures") if isinstance(status.get("failures"), list) else []
        if any(str(item.get("jobId") or "") == job_id for item in failures if isinstance(item, dict)):
            return
        failure = {
            "jobId": job_id,
            "sourceLoRA": candidate_label,
            "error": str(exc),
            "elapsedMs": int(elapsed_ms or 0),
        }
        if candidate_file:
            failure["candidateFile"] = candidate_file
        if strength is not None:
            failure["strength"] = float(strength)
        failures.append(failure)
        status["failures"] = failures
        status["failed"] = len(failures)
        status["current"] = ""
        status["error"] = ""
        _atomic_write_json(_status_path(session_directory), status)


def execute_inference(job_id, request, context):
    from . import inference_runtime

    folder = str(context.get("folder") or "").strip()
    session_id = str(context.get("sessionId") or "").strip()
    candidate_kind = str(context.get("candidateKind") or "").strip()
    candidate_file = str(context.get("candidateFile") or "").strip()
    candidate_label = str(context.get("candidateLabel") or "").strip() or (
        "Base" if candidate_kind == "base" else candidate_file
    )
    if not session_id or candidate_kind not in {"base", "lora"}:
        raise RuntimeError("Test inference is missing its Session candidate context.")

    folder_path = app_config.safe_join_fs_root(folder) if folder else Path(app_config.FS_ROOT).resolve()
    session_directory = _session_directory(folder_path, session_id)
    model = get_test_model(request.get("modelId"))
    lora_file = None
    if candidate_kind == "lora":
        staging = str(context.get("campaignStaging") or "")
        if staging:
            files = _selected_lora_files_for_set(folder_path, model, selected_files=[candidate_file], campaign_staging=staging)
            lora_file = files[0]
        else:
            available = {path.name: path for path in _staged_loras_for_set(folder_path, model)}
            lora_file = available.get(candidate_file)
        if lora_file is None or not lora_file.is_file():
            _logger.warning("Queued Test skipped removed staged LoRA: %s", candidate_file)
            _record_skipped_inference(session_directory, str(job_id))
            return {"status": "skipped", "session": session_id, "candidateFile": candidate_file}

    started = time.monotonic()
    media_path = None
    caption_path = None
    try:
        frozen_template = request.get("workflow")
        if not isinstance(frozen_template, dict):
            raise ValueError("Test inference job has no frozen workflow.")
        evidence = _workflow_evidence(model, frozen_template)
        if str(request.get("workflowFile") or "") != evidence["workflowFile"]:
            raise ValueError("Test inference workflow identity does not match the selected model.")
        if str(request.get("workflowSha256") or "") != evidence["workflowSha256"]:
            raise ValueError("Test inference workflow fingerprint is invalid.")

        inference_runtime.system_stats()
        template = model.resolve_assets(
            copy.deepcopy(frozen_template),
            inference_runtime.available_names,
            inference_runtime.resolve_name,
        )
        settings = model.normalize_settings(
            template,
            _new_session_seed,
            dict(request.get("settings") or {}),
        )
        prompt = str(request.get("prompt") or "").strip()
        if request.get("promptNeedsResolve"):
            with _status_lock:
                status_payload = _read_status(session_directory) or {}
                session_prompt = str(status_payload.get("resolvedPrompt") or "").strip()
                if session_prompt and session_prompt != str(request.get("sourcePrompt") or "").strip():
                    prompt = session_prompt
                else:
                    prompt = inference_runtime.resolve_wildcard_prompt(
                        str(request.get("sourcePrompt") or prompt),
                        settings["seed"],
                    )
                    status_payload["resolvedPrompt"] = prompt
                    status_payload["prompt"] = prompt
                    _atomic_write_json(_status_path(session_directory), status_payload)
        if not prompt:
            raise ValueError("Test inference job has no resolved prompt.")

        wildcard_values = _resolved_wildcard_values(
            request.get("sourcePrompt"),
            prompt,
        )
        execution_update_job(
            str(job_id),
            details={"wildcardValues": list(wildcard_values)},
        )
        with _status_lock:
            status_payload = _read_status(session_directory) or {}
            status_payload["resolvedPrompt"] = prompt
            status_payload["prompt"] = prompt
            _atomic_write_json(_status_path(session_directory), status_payload)

        comfy_lora_name = None
        if lora_file is not None:
            comfy_lora_name = inference_runtime.resolve_name(
                str(lora_file),
                model.available_lora_names(inference_runtime.available_names),
                "staged LoRA",
            )

        output_prefix = _candidate_output_prefix(
            session_directory,
            int(context.get("candidateIndex") or 1),
            {"kind": candidate_kind, "label": candidate_label},
        )
        workflow = model.build_workflow(
            template,
            prompt,
            comfy_lora_name,
            settings=settings,
            strength_model=float(context.get("candidateStrength")) if candidate_kind == "lora" else 1,
            filename_prefix=output_prefix,
        )
        provider_job_id = inference_runtime.queue_managed_workflow(str(job_id), workflow)
        execution_update_job(
            str(job_id),
            details={
                "session": session_id,
                "resultFolder": _session_result_folder(session_directory),
            },
        )
        with _status_lock:
            status_payload = _read_status(session_directory) or {}
            if str(status_payload.get("status") or "") not in {"stopping", "stopped"}:
                status_payload["status"] = "running"
                status_payload["current"] = candidate_label
            status_payload["candidateStartedAt"] = int(time.time() * 1000)
            status_payload["comfyJobId"] = provider_job_id
            status_payload["comfyStatus"] = "pending"
            _atomic_write_json(_status_path(session_directory), status_payload)

        output_ref = inference_runtime.wait_for_output(
            provider_job_id,
            str(job_id),
            model.find_output_ref,
        )
        output_extension = Path(str(output_ref.get("filename") or "")).suffix
        if not output_extension:
            raise RuntimeError("ComfyUI Test output has no file extension.")
        sweep = bool(request.get("sweepWeights"))
        media_path, caption_path = _result_paths(
            session_directory,
            lora_file,
            stem_override=(
                "base" if candidate_kind == "base" else
                (lora_file.stem + "-w" + str(context["candidateStrength"]) if sweep else None)
            ),
            extension=output_extension,
        )
        _move_saved_output(
            output_ref,
            media_path,
            filename_prefix=output_prefix,
            download_bytes=inference_runtime.download_output,
        )
        caption_path.write_text(prompt, encoding="utf-8")

        result = {
            "jobId": str(job_id),
            "kind": candidate_kind,
            "sourceLoRA": candidate_label,
            "mediaFile": media_path.name,
            "mediaKind": model.MEDIA_KIND,
            "prompt": prompt,
            "seed": model.workflow_seed(workflow),
            "elapsedMs": _candidate_elapsed_ms(started),
        }
        if candidate_kind == "lora":
            result["candidateFile"] = candidate_file
            if sweep:
                result["strength"] = float(context["candidateStrength"])
            provenance = _staged_lora_provenance(lora_file)
            if provenance:
                result["provenance"] = provenance

        with _status_lock:
            status_payload = _read_status(session_directory) or {}
            results = status_payload.get("results") if isinstance(status_payload.get("results"), list) else []
            if not any(str(item.get("jobId") or "") == str(job_id) for item in results if isinstance(item, dict)):
                results.append(result)
            status_payload["results"] = results
            status_payload["completed"] = len(results)
            status_payload["current"] = ""
            status_payload["comfyStatus"] = "completed"
            _atomic_write_json(_status_path(session_directory), status_payload)
        _queue_test_auto_vl(folder_path, session_id, media_path.name)
        return {"status": "completed", "session": session_id, "mediaFile": media_path.name}
    except inference_runtime.InferenceStopped:
        raise
    except Exception as exc:
        for owned_path in (caption_path, media_path):
            if owned_path and Path(owned_path).is_file():
                Path(owned_path).unlink()
        _record_failed_inference(
            session_directory,
            str(job_id),
            candidate_label,
            candidate_file,
            exc,
            _candidate_elapsed_ms(started),
            strength=context.get("candidateStrength") if request.get("sweepWeights") and candidate_kind == "lora" else None,
        )
        raise


def _enqueue_frozen_test_request(folder_path, request, loras, include_base, legacy_job_id="", auto_vl_model=""):
    from .inference_runner import enqueue_test

    model = get_test_model(request.get("modelId"))
    session_directory = _new_session_directory(folder_path, model=model)
    folder = _relative_set_folder(folder_path)
    candidates = []
    if include_base:
        candidates.append({"kind": "base", "label": "Base", "file": ""})
    sweep_weights = request.get("sweepWeights")
    if sweep_weights is not None:
        for path in loras:
            provenance = _staged_lora_provenance(path)
            for weight in sweep_weights:
                candidates.append({
                    "kind": "lora",
                    "label": path.name + " · Weight " + str(weight),
                    "file": path.name,
                    "provenance": provenance,
                    "strength": weight,
                })
    else:
        candidates.extend(
            {
                "kind": "lora",
                "label": path.name,
                "file": (str(request.get("campaignStaging") or "") + "/" + path.name) if request.get("campaignStaging") else path.name,
                "provenance": _staged_lora_provenance(path),
                "strength": float((request.get("candidateStrengths") or {}).get(path.name, (request.get("settings") or {}).get("strength", 1))),
            }
            for path in loras
        )
    payload = {
        "status": "queued",
        "modelId": model.PROFILE_ID,
        "mediaKind": model.MEDIA_KIND,
        "ownerFolder": folder,
        "session": session_directory.name,
        "name": str(request.get("name") or ""),
        "sourcePrompt": str(request.get("sourcePrompt") or ""),
        "resolvedPrompt": str(request.get("prompt") or ""),
        "prompt": str(request.get("prompt") or ""),
        "total": len(candidates),
        "completed": 0,
        "failed": 0,
        "failures": [],
        "current": "",
        "error": "",
        "startedAt": int(time.time() * 1000),
        "candidateStartedAt": None,
        "comfyJobId": "",
        "comfyStatus": "",
        "comfyLastContactAt": None,
        "settings": dict(request.get("settings") or {}),
        "workflowFile": str(request.get("workflowFile") or ""),
        "workflowSha256": str(request.get("workflowSha256") or ""),
        "includeBase": bool(include_base),
        "candidates": [
            {
                "kind": candidate["kind"],
                "fileName": candidate["file"],
                "label": candidate["label"],
                "provenance": dict(candidate.get("provenance") or {}),
                "strength": candidate.get("strength") if candidate["kind"] == "lora" else None,
            }
            for candidate in candidates
        ],
        "results": [],
        "resultFolder": _session_result_folder(session_directory),
        "inferenceJobs": [],
        "legacyJobId": str(legacy_job_id or ""),
        "migrationComplete": False,
        "autoVlModel": str(auto_vl_model or ""),
        "autoVlJobs": {},
        "campaignStaging": str(request.get("campaignStaging") or ""),
    }
    if sweep_weights is not None:
        payload["sweepWeights"] = list(sweep_weights)
    payload.update(payload["settings"])
    with _status_lock:
        _atomic_write_json(_status_path(session_directory), payload)

    queued_ids = []
    try:
        for index, candidate in enumerate(candidates, start=1):
            label_root = str(request.get("name") or "").strip() or session_directory.name
            label = label_root + " · " + candidate["label"]
            context = {
                "folder": folder,
                "sessionId": session_directory.name,
                "candidateKind": candidate["kind"],
                "candidateFile": candidate["file"],
                "candidateLabel": candidate["label"],
                "candidateIndex": index,
                "candidateProvenance": dict(candidate.get("provenance") or {}),
                "candidateStrength": candidate.get("strength"),
                "campaignStaging": str(request.get("campaignStaging") or ""),
            }
            job = enqueue_test(request, context, label=label, deferred=True)
            queued_ids.append(job["jobId"])

        with _status_lock:
            current_status = _read_status(session_directory) or {}
            current_status["inferenceJobs"] = list(queued_ids)
            current_status["migrationComplete"] = True
            _atomic_write_json(_status_path(session_directory), current_status)

        if not legacy_job_id:
            for job_id in queued_ids:
                execution_promote_backlog(job_id)
            from .inference_runner import start_observer
            start_observer()
    except Exception as exc:
        rollback_errors = []
        rollback_pending = False
        for job_id in queued_ids:
            try:
                queued_job = execution_get_job(job_id)
                job_status = str(queued_job.get("status") or "")
                if job_status in {"backlog", "queued"}:
                    _cancel_shared_pending_job(
                        job_id,
                        session_directory=session_directory,
                        reduce_total=True,
                    )
                elif job_status in {"starting", "running"}:
                    execution_request_stop(job_id)
                    rollback_pending = True
                elif job_status == "stopping":
                    rollback_pending = True
            except Exception as rollback_exc:
                rollback_errors.append((job_id, rollback_exc))
                _logger.exception("Could not roll back partially queued Test rendition %s.", job_id)
        if rollback_errors or rollback_pending:
            with _status_lock:
                current_status = _read_status(session_directory) or {}
                current_status["migrationComplete"] = False
                current_status["status"] = "stopping" if rollback_pending else str(current_status.get("status") or "queued")
                current_status["error"] = (
                    "Test Session enqueue failed and active or unresolved rendition work remains. "
                    "The Session was preserved for recovery."
                )
                _atomic_write_json(_status_path(session_directory), current_status)
            raise RuntimeError(current_status["error"]) from exc
        shutil.rmtree(session_directory)
        raise
    return _sync_inference_session(session_directory)


def _find_legacy_migration_session(folder_path, legacy_job_id):
    for session in _session_directories(folder_path):
        status_payload = _read_status(session) or {}
        if str(status_payload.get("legacyJobId") or "") == str(legacy_job_id or ""):
            return session, status_payload
    return None


def reconcile_startup():
    global _startup_reconciled
    if _startup_reconciled:
        return
    with _reconcile_lock:
        if _startup_reconciled:
            return

        interrupted = execution_recover_lane(
            LEGACY_EXECUTION_LANE,
            reason="Legacy Test Generations execution was interrupted by a WebCap restart.",
        )
        for job in interrupted:
            metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
            details = job.get("details") if isinstance(job.get("details"), dict) else {}
            prompt_id = str(details.get("comfyJobId") or details.get("providerJobId") or "").strip()
            if prompt_id:
                try:
                    from . import inference_runtime
                    terminal_status = inference_runtime.cancel_job_and_wait_status(prompt_id)
                    if not terminal_status:
                        _logger.error(
                            "Interrupted legacy Test provider job %s did not confirm cancellation.",
                            prompt_id,
                        )
                except Exception:
                    _logger.exception("Could not cancel interrupted legacy Test provider job %s.", prompt_id)
            folder = str(metadata.get("folder") or "").strip()
            session_name = str(details.get("session") or "").strip()
            if folder and session_name:
                try:
                    session_directory = _session_directory(app_config.safe_join_fs_root(folder), session_name)
                    with _status_lock:
                        legacy_status = _read_status(session_directory) or {}
                        legacy_status["status"] = "failed"
                        legacy_status["current"] = ""
                        legacy_status["error"] = "Test Generations execution was interrupted by a WebCap restart."
                        _atomic_write_json(_status_path(session_directory), legacy_status)
                except (FileNotFoundError, ValueError):
                    pass

        legacy = execution_lane_snapshot(LEGACY_EXECUTION_LANE, include_terminal=False)
        for job in legacy.get("jobs", []):
            if str(job.get("status") or "") != "queued":
                continue
            legacy_job_id = str(job.get("id") or "")
            stored = execution_get_job(legacy_job_id, include_payload=True)
            metadata = stored.get("metadata") if isinstance(stored.get("metadata"), dict) else {}
            request = stored.get("payload") if isinstance(stored.get("payload"), dict) else {}
            folder = str(metadata.get("folder") or "").strip()
            if not folder or not request:
                _logger.error("Legacy Test queue job %s is missing its frozen request.", legacy_job_id)
                continue
            try:
                folder_path = app_config.safe_join_fs_root(folder)
                existing = _find_legacy_migration_session(folder_path, legacy_job_id)
                if existing:
                    session_directory, existing_status = existing
                    if not existing_status.get("migrationComplete"):
                        cleanup_failed = False
                        cleanup_pending = False
                        for child_id in existing_status.get("inferenceJobs") or []:
                            try:
                                child_job = execution_get_job(str(child_id))
                                child_status = str(child_job.get("status") or "")
                                if child_status in {"backlog", "queued"}:
                                    _cancel_shared_pending_job(
                                        str(child_id),
                                        session_directory=session_directory,
                                        reduce_total=True,
                                    )
                                elif child_status in {"starting", "running"}:
                                    execution_request_stop(str(child_id))
                                    cleanup_pending = True
                                elif child_status == "stopping":
                                    cleanup_pending = True
                            except FileNotFoundError:
                                continue
                            except Exception:
                                cleanup_failed = True
                                _logger.exception(
                                    "Could not stop partially migrated Test rendition %s; preserving Session %s.",
                                    child_id,
                                    session_directory.name,
                                )
                        if cleanup_failed or cleanup_pending:
                            _logger.error(
                                "Legacy Test migration recovery for %s remains incomplete; Session %s was left intact.",
                                legacy_job_id,
                                session_directory.name,
                            )
                            continue
                        shutil.rmtree(session_directory)
                    else:
                        execution_cancel_queued(legacy_job_id)
                        continue

                model = get_test_model(request.get("modelId") or request.get("model"))
                selected = _selected_lora_files_for_set(
                    folder_path,
                    model,
                    selected_files=request.get("selectedFiles"),
                )
                _enqueue_frozen_test_request(
                    folder_path,
                    {
                        "modelId": model.PROFILE_ID,
                        "mediaKind": model.MEDIA_KIND,
                        "name": str(request.get("name") or ""),
                        "sourcePrompt": str(request.get("sourcePrompt") or ""),
                        "prompt": str(request.get("resolvedPrompt") or ""),
                        "settings": dict(request.get("settings") or {}),
                        "workflow": copy.deepcopy(request.get("workflow") or {}),
                        "workflowFile": str(request.get("workflowFile") or ""),
                        "workflowSha256": str(request.get("workflowSha256") or ""),
                    },
                    [path for path in selected if path.is_file()],
                    request.get("includeBase") is not False,
                    legacy_job_id=legacy_job_id,
                )
                execution_cancel_queued(legacy_job_id)
            except Exception:
                _logger.exception(
                    "Could not migrate legacy Test queue job %s; leaving it intact for manual recovery.",
                    legacy_job_id,
                )
        execution_discard_terminal_and_recent(LEGACY_EXECUTION_LANE)
        _startup_reconciled = True


def enqueue(folder_path, prompt, settings=None, seed=None, name=None, selected_files=None,
            candidate_strengths=None, include_base=True, model_id=None, aspect_ratio=None, megapixels=None, duration=None,
            sweep_weights=None, campaign_staging="", auto_vl_model=""):
    reconcile_startup()
    request, loras, include_base = _new_inference_request(
        folder_path,
        prompt,
        settings=settings,
        seed=seed,
        name=name,
        selected_files=selected_files,
        candidate_strengths=candidate_strengths,
        sweep_weights=sweep_weights,
        include_base=include_base,
        model_id=model_id,
        aspect_ratio=aspect_ratio,
        megapixels=megapixels,
        duration=duration,
        campaign_staging=campaign_staging,
    )
    latest = _enqueue_frozen_test_request(folder_path, request, loras, include_base, auto_vl_model=auto_vl_model)
    return {
        "operation": "test_enqueue",
        "job": {
            "id": latest["session"],
            "folder": _relative_set_folder(folder_path),
            "runName": str(latest.get("name") or ""),
            "modelId": str(latest.get("modelId") or ""),
            "status": str(latest.get("status") or ""),
            "testTotal": int(latest.get("total") or 0),
            "createdAt": float(latest.get("startedAt") or 0) / 1000,
            "queuePosition": min(
                [
                    int(job.get("queuePosition") or 0)
                    for job in _session_job_records(_read_status(_session_directory(folder_path, latest["session"])) or {})
                    if str(job.get("status") or "") == "queued"
                ] or [0]
            ),
        },
        "queued": latest.get("status") == "queued",
        "latest": latest,
    }




def enqueue_repeated(folder_path, criteria):
    """Repeat the normal Test Session submission; no batch state or coordinator."""
    from .storyboard_llm_runtime import list_vision_models

    count = criteria.get("repeat", 1)
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 20:
        raise ValueError("Repeat must be an integer between 1 and 20.")
    auto_vl = criteria.get("autoVl") is True
    vl_model = str(criteria.get("vlModel") or "") if auto_vl else ""
    if auto_vl:
        available = {str(item.get("id") or "") for item in list_vision_models()}
        if not vl_model or vl_model not in available:
            raise ValueError("Select an available Vision model.")

    accepted = []
    used_seeds = set()
    for index in range(count):
        settings = dict(criteria.get("settings") or {})
        if count > 1:
            seed = secrets.randbits(32)
            while seed in used_seeds:
                seed = secrets.randbits(32)
            used_seeds.add(seed)
            settings["seed"] = str(seed)
        try:
            submitted = enqueue(
                folder_path, criteria.get("prompt"), settings=settings,
                name=criteria.get("name"), seed=criteria.get("seed"),
                aspect_ratio=criteria.get("aspectRatio"),
                megapixels=criteria.get("megapixels"), duration=criteria.get("duration"),
                selected_files=criteria.get("selectedFiles"),
                candidate_strengths=criteria.get("candidateStrengths"),
                include_base=criteria.get("includeBase"),
                model_id=criteria.get("modelId"),
                sweep_weights=criteria.get("sweepWeights"),
                auto_vl_model=vl_model,
            )
        except Exception as exc:
            if not accepted:
                raise
            # Already accepted Sessions remain authoritative and must be shown.
            first = dict(accepted[0])
            first["sessions"] = [item["latest"] for item in accepted]
            first["errors"] = ["Repeat " + str(index + 1) + " could not enqueue: " + str(exc)]
            return first
        accepted.append(submitted)

    first = dict(accepted[0])
    first["sessions"] = [item["latest"] for item in accepted]
    return first


def queued_jobs(folder_path, model_id=None):
    reconcile_startup()
    jobs = []
    selected_model_id = str(model_id or "").strip()
    for session_directory in sorted(
        _session_directories(folder_path),
        key=lambda path: path.name.lower(),
    ):
        # Terminal history cannot be queued. Avoid loading its inference job
        # records merely to build the queued-session list.
        stored = _read_status(session_directory) or {}
        if str(stored.get("status") or "") in {"complete", "stopped", "failed", "interrupted"}:
            continue
        visible = _sync_inference_session(session_directory)
        if not visible or visible.get("status") != "queued":
            continue
        if selected_model_id and str(visible.get("modelId") or visible.get("model") or "") != selected_model_id:
            continue
        child_jobs = _session_job_records(_read_status(session_directory) or {})
        positions = [
            int(job.get("queuePosition") or 0)
            for job in child_jobs
            if str(job.get("status") or "") == "queued" and int(job.get("queuePosition") or 0) > 0
        ]
        jobs.append({
            "id": session_directory.name,
            "folder": _relative_set_folder(folder_path),
            "runName": str(visible.get("name") or ""),
            "modelId": str(visible.get("modelId") or ""),
            "status": "queued",
            "testTotal": int(visible.get("total") or 0),
            "createdAt": float(visible.get("startedAt") or 0) / 1000,
            "queuePosition": min(positions) if positions else 0,
        })
    jobs.sort(key=lambda item: (int(item.get("queuePosition") or 0) or 10 ** 9, item["createdAt"]))
    return {"operation": "test_queue", "jobs": jobs}

def cancel_queued(folder_path, job_id):
    reconcile_startup()
    session_directory = _session_directory(folder_path, str(job_id or "").strip())
    visible = _sync_inference_session(session_directory)
    if visible.get("status") != "queued":
        raise RuntimeError("Only a fully queued Test session can be cancelled here.")
    status_payload = _read_status(session_directory) or {}
    for child in _session_job_records(status_payload):
        if str(child.get("status") or "") in {"backlog", "queued"}:
            _cancel_shared_pending_job(
                str(child.get("id") or ""),
                session_directory=session_directory,
                reduce_total=True,
            )
    shutil.rmtree(session_directory)
    return {
        "operation": "test_queue_cancel",
        "removed": str(job_id),
        "jobs": queued_jobs(
            folder_path,
            model_id=str(visible.get("modelId") or visible.get("model") or ""),
        )["jobs"],
    }



def clear_queued(folder_path, model_id=None):
    removed = 0
    for job in list(queued_jobs(folder_path, model_id=model_id)["jobs"]):
        cancel_queued(folder_path, job["id"])
        removed += 1
    return {"operation": "test_queue_clear", "removed": removed, "jobs": queued_jobs(folder_path, model_id=model_id)["jobs"]}

def _visible_session_status(folder_path, session_directory, stored=None):
    status_payload = stored if stored is not None else (_read_status(session_directory) or {})
    if isinstance(status_payload.get("inferenceJobs"), list) and str(status_payload.get("status") or "") not in {"complete", "stopped", "failed", "interrupted"}:
        return _sync_inference_session(session_directory)
    if isinstance(status_payload.get("inferenceJobs"), list):
        return _session_status_from_payload(session_directory, status_payload)
    payload = _session_status_from_payload(session_directory, status_payload)
    if payload and str(payload.get("status") or "") in {"starting", "running", "stopping"}:
        _mark_session_interrupted(session_directory)
        payload = _session_status(session_directory)
    return payload



def list_sessions(folder_path, model_id=None, session_snapshot=None, visible_snapshot=None):
    sessions = []
    selected_model_id = str(model_id or "").strip()
    default_model_id = get_test_model().PROFILE_ID
    snapshots = session_snapshot if session_snapshot is not None else [
        (session, _read_status(session) or {}) for session in _session_directories(folder_path)
    ]
    visible = visible_snapshot if visible_snapshot is not None else [
        (session, _visible_session_status(folder_path, session, stored=stored))
        for session, stored in snapshots
    ]
    for session, payload in sorted(visible, key=lambda item: item[0].name.lower(), reverse=True):
        if not payload or payload.get("status") == "queued" or payload.get("campaignStaging"):
            continue
        session_model_id = str(payload.get("modelId") or payload.get("model") or default_model_id)
        if selected_model_id and session_model_id != selected_model_id:
            continue
        sessions.append({
            "session": session.name,
            "name": str(payload.get("name") or ""),
            "modelId": str(payload.get("modelId") or payload.get("model") or ""),
            "ownerFolder": str(payload.get("ownerFolder") or _relative_set_folder(folder_path)),
            "status": str(payload.get("status") or ""),
            "startedAt": int(payload.get("startedAt") or 0),
            "candidateStartedAt": int(payload.get("candidateStartedAt") or 0),
            "completed": int(payload.get("completed") or 0),
            "failed": int(payload.get("failed") or 0),
            "total": int(payload.get("total") or 0),
            "queued": int(payload.get("queued") or 0),
            "running": int(payload.get("running") or 0),
            "resultFolder": str(payload.get("resultFolder") or ""),
        })
    return sessions


def _latest_status(folder_path, model_id=None, session_snapshot=None, visible_snapshot=None):
    selected_model = str(model_id or "").strip()
    snapshots = session_snapshot if session_snapshot is not None else [
        (session, _read_status(session) or {}) for session in _session_directories(folder_path)
    ]
    visible = visible_snapshot if visible_snapshot is not None else [
        (session, _visible_session_status(folder_path, session, stored=stored))
        for session, stored in snapshots
    ]
    payloads = []
    for session, payload in sorted(visible, key=lambda item: item[0].name.lower(), reverse=True):
        if not payload or payload.get("campaignStaging"):
            continue
        if selected_model and str(payload.get("modelId") or payload.get("model") or "") != selected_model:
            continue
        payloads.append(payload)
    for payload in payloads:
        if payload.get("status") in {"running", "stopping"}:
            return payload
    return payloads[0] if payloads else {"status": "idle"}


def _visible_status(folder_path, model_id=None, session_snapshot=None, visible_snapshot=None):
    return _latest_status(folder_path, model_id=model_id, session_snapshot=session_snapshot, visible_snapshot=visible_snapshot)


def status(folder_path, model_id=None, session_snapshot=None, visible_snapshot=None):
    payload = _visible_status(folder_path, model_id=model_id, session_snapshot=session_snapshot, visible_snapshot=visible_snapshot)
    session_name = str(payload.get("session") or "").strip() if isinstance(payload, dict) else ""
    if not session_name:
        return payload
    session = _session_directory(folder_path, session_name)
    return _with_session_vision(session, _with_session_ratings(session, payload))


def stop(folder_path, session_name=None):
    reconcile_startup()
    session_id = str(session_name or "").strip()
    if session_id:
        session_directory = _session_directory(folder_path, session_id)
        payload = _visible_session_status(folder_path, session_directory)
    else:
        payload = _latest_status(folder_path)
        session_id = str(payload.get("session") or "").strip()
        session_directory = _session_directory(folder_path, session_id) if session_id else None
    if not session_id or session_directory is None or payload.get("status") not in {"running", "stopping"}:
        raise RuntimeError("No active Test Generations session to stop.")
    with _status_lock:
        status_payload = _read_status(session_directory) or {}
        if not isinstance(status_payload.get("inferenceJobs"), list):
            raise RuntimeError("This historical Test Session has no active shared inference work.")
        status_payload["status"] = "stopping"
        _atomic_write_json(_status_path(session_directory), status_payload)

    for job in _session_job_records(status_payload):
        job_status = str(job.get("status") or "")
        job_id = str(job.get("id") or "")
        if job_status in {"backlog", "queued"}:
            _cancel_shared_pending_job(job_id, session_directory=session_directory)
        elif job_status in {"starting", "running"}:
            execution_request_stop(job_id)
    return _sync_inference_session(session_directory)


def _invalidate_recent_session_caches():
    _recent_sets_cache["items"] = []
    _recent_sets_cache["expires"] = 0.0
    _recent_prompts_cache["items"] = []
    _recent_prompts_cache["root"] = None
    _recent_prompts_cache["expires"] = 0.0


def _all_owned_session_directories(folder_path):
    sessions = []
    seen_paths = set()
    for root in _session_roots(folder_path):
        if not root.is_dir() or root.is_symlink():
            continue
        for session in root.iterdir():
            if session.is_symlink() or not session.is_dir() or not (session / "test.json").is_file():
                continue
            key = str(session.resolve())
            if key in seen_paths:
                continue
            payload = _read_status(session) or {}
            if not _session_belongs_to_folder(folder_path, session, payload):
                continue
            seen_paths.add(key)
            sessions.append(session)
    return sessions


def session_cleanup_status(folder_path):
    sessions = _all_owned_session_directories(folder_path)
    active = sorted(
        session.name
        for session in sessions
        if _session_has_nonterminal_jobs(session)
    )
    return {
        "count": len(sessions),
        "active": active,
    }


def clear_sessions(folder_path):
    sessions = _all_owned_session_directories(folder_path)
    active = sorted(
        session.name
        for session in sessions
        if _session_has_nonterminal_jobs(session)
    )
    if active:
        raise RuntimeError(
            "Cannot clear Test Generations sessions while active work remains: " + ", ".join(active)
        )
    _snapshot_session_assessments(folder_path, sessions)
    for session in sessions:
        shutil.rmtree(session)

    workspace = _workspace_root(folder_path)
    workspace_removed = False
    if workspace.exists():
        if workspace.is_symlink() or not workspace.is_dir():
            raise RuntimeError("Test Generations Set workspace is invalid.")
        shutil.rmtree(workspace)
        workspace_removed = True

    if sessions or workspace_removed:
        _invalidate_recent_session_caches()
    return len(sessions)


def delete_session(folder_path, session_name):
    session = _session_directory(folder_path, session_name)
    session_payload = _read_status(session) or {}
    model_id = str(session_payload.get("modelId") or session_payload.get("model") or get_test_model().PROFILE_ID)
    if isinstance(session_payload.get("inferenceJobs"), list) and _session_has_nonterminal_jobs(session):
        raise RuntimeError("Cannot delete an active Test Generations session. Stop it first.")
    _snapshot_session_assessments(folder_path, [session])
    shutil.rmtree(session)
    _invalidate_recent_session_caches()
    return {
        "operation": "test_delete_session",
        "deleted": Path(session_name).name,
        "modelId": model_id,
        "candidateVisionScores": _candidate_vision_scores(folder_path, model_id),
        "sessions": list_sessions(folder_path, model_id=model_id),
        "latest": _latest_status(folder_path, model_id=model_id),
    }

def _remove_candidate_from_session(folder_path, session_name, candidate_name):
    session = _session_directory(folder_path, session_name)
    session_payload = _read_status(session) or {}
    status_payload = session_payload
    results = status_payload.get("results") if isinstance(status_payload.get("results"), list) else []
    failures = status_payload.get("failures") if isinstance(status_payload.get("failures"), list) else []
    removed_results = [
        result for result in results
        if isinstance(result, dict)
        and str(result.get("candidateFile") or result.get("sourceLoRA") or "") == candidate_name
    ]
    removed_failures = [
        failure for failure in failures
        if isinstance(failure, dict)
        and str(failure.get("candidateFile") or failure.get("sourceLoRA") or "") == candidate_name
    ]
    if _session_candidate_has_nonterminal_job(status_payload, candidate_name):
        raise RuntimeError("Cannot remove an active Test Generations candidate. Stop its generation first.")
    for result in removed_results:
        output_name = _result_media_file(result)
        if output_name:
            for path in (
                _session_result_path(session, output_name),
                _session_result_path(session, Path(output_name).with_suffix(".txt").name),
            ):
                if path.is_file():
                    path.unlink()
    if removed_results or removed_failures:
        status_payload["results"] = [item for item in results if item not in removed_results]
        status_payload["failures"] = [item for item in failures if item not in removed_failures]
        status_payload["completed"] = max(0, int(status_payload.get("completed") or 0) - len(removed_results))
        status_payload["failed"] = max(0, int(status_payload.get("failed") or 0) - len(removed_failures))
        status_payload["total"] = max(
            0,
            int(status_payload.get("total") or 0) - len(removed_results) - len(removed_failures),
        )
        _atomic_write_json(_status_path(session), status_payload)
    return _visible_session_status(folder_path, session)


def activity_snapshot(folder_path=None):
    active = []
    snapshot = execution_lane_snapshot("inference", include_terminal=False)
    seen = set()
    for job in snapshot.get("jobs", []):
        metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
        if metadata.get("client") != "test" or str(job.get("status") or "") not in {"starting", "running", "stopping"}:
            continue
        key = (str(metadata.get("folder") or ""), str(metadata.get("sessionId") or ""))
        if key in seen:
            continue
        seen.add(key)
        try:
            set_folder = app_config.safe_join_fs_root(key[0])
            session_directory = _session_directory(set_folder, key[1])
            visible = _sync_inference_session(session_directory)
        except Exception:
            continue
        owner_folder = str(visible.get("ownerFolder") or key[0])
        active.append({
            "folder": owner_folder,
            "modelId": str(visible.get("modelId") or visible.get("model") or ""),
            "session": key[1],
            "status": str(visible.get("status") or "running"),
            "completed": int(visible.get("completed") or 0),
            "total": int(visible.get("total") or 0),
            "ownerAvailable": _owner_folder_available(owner_folder),
        })
    current = test_presence(folder_path) if folder_path is not None else None
    return {
        "active": active,
        "current": current,
        "recent": recent_test_sets(),
        "recentPrompts": recent_test_prompts(),
    }

