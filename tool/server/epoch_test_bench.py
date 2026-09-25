import copy
import hashlib
import json
import logging
import os
import re
import secrets
import shutil
import threading
import time
from datetime import datetime
from pathlib import Path

from . import config as app_config
from .folder_state_store import read_folder_state
from .test_models import get_test_model, supported_models as registered_test_models, supported_profile_ids
from .training_test_paths import browse_test_source, test_copy_path, test_source_for_set, test_source_path
from .execution_queue import (
    cancel_pending as execution_cancel_pending,
    cancel_queued as execution_cancel_queued,
    consume_terminal_job as execution_consume_terminal_job,
    get_job as execution_get_job,
    lane_snapshot as execution_lane_snapshot,
    recover_lane as execution_recover_lane,
    request_stop as execution_request_stop,
    update_job as execution_update_job,
)

TEMPLATE_PATH = get_test_model().TEMPLATE_PATH
TEST_RESULTS_DIR = "test-generations"
LEGACY_EXECUTION_LANE = "test-generations"
TEST_ASPECT_RATIO_OPTIONS = tuple(getattr(get_test_model(), "ASPECT_RATIO_OPTIONS", ()))
_status_lock = threading.RLock()
_recent_sets_cache = {"expires": 0.0, "items": []}
_reconcile_lock = threading.Lock()
_startup_reconciled = False
_logger = logging.getLogger(__name__)


def _owning_set_directory(folder_path):
    path = Path(folder_path).resolve()
    for candidate in (path, *path.parents):
        if candidate.name == TEST_RESULTS_DIR:
            return candidate.parent
    return path


def _default_test_source(folder_path):
    return _owning_set_directory(folder_path).name


def _test_directory(folder_path, model, source=None):
    if source is not None:
        return test_source_path(model.STAGING_KEY, str(source or "").strip())
    return test_copy_path(model.STAGING_KEY, _owning_set_directory(folder_path).name)


def _resolved_test_directory(folder_path, model, source=None):
    return _test_directory(folder_path, model) if source is None else _test_directory(folder_path, model, source=source)


def browse_source(model_id=None, source=None, set_name=""):
    model = get_test_model(model_id)
    default_source = test_source_for_set(model.STAGING_KEY, set_name) if str(set_name or "").strip() else ""
    resolved_source = default_source if source is None and default_source else str(source or "")
    payload = browse_test_source(model.STAGING_KEY, resolved_source)
    payload.update({
        "operation": "test_source_browse",
        "modelId": model.PROFILE_ID,
        "modelLabel": str(model.profile["label"]),
        "defaultSource": default_source,
    })
    return payload


def _lora_files(test_directory):
    if not test_directory.is_dir():
        raise FileNotFoundError("Test staging folder does not exist: " + str(test_directory))
    return sorted(
        [path for path in test_directory.iterdir() if path.is_file() and path.suffix.lower() == ".safetensors"],
        key=lambda path: path.name.lower(),
    )


def _selected_lora_files(test_directory, selected_files=None):
    if selected_files is None:
        return _lora_files(test_directory)
    if not isinstance(selected_files, (list, tuple)):
        raise ValueError("Selected Test candidates must be a list of staged filenames.")

    requested = []
    seen = set()
    for value in selected_files:
        name = str(value or "").strip()
        if (
            not name
            or name in (".", "..")
            or "/" in name
            or "\\" in name
            or not name.lower().endswith(".safetensors")
        ):
            raise ValueError("Selected Test candidates must be staged .safetensors filenames.")
        if name in seen:
            continue
        seen.add(name)
        requested.append(name)

    if not requested:
        raise ValueError("Select at least one staged LoRA to test.")

    return sorted(
        [Path(test_directory) / name for name in requested],
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
            test_directory = _test_directory(set_folder, model)
            if test_directory.is_dir():
                staged_count += len([
                    path for path in test_directory.iterdir()
                    if path.is_file() and path.suffix.lower() == ".safetensors"
                ])
        except (OSError, ValueError):
            continue
    sessions = list_sessions(set_folder, source=set_folder.name)
    return {
        "folder": _relative_set_folder(set_folder),
        "stagedCount": staged_count,
        "sessionCount": len(sessions),
        "hasTestData": bool(staged_count or sessions),
    }

def recent_test_sets(limit=8):
    """Return recent Test Sources from the bounded central session directory."""
    now = time.monotonic()
    cached_items = _recent_sets_cache.get("items") if isinstance(_recent_sets_cache.get("items"), list) else []
    if now < float(_recent_sets_cache.get("expires") or 0):
        return [dict(item) for item in cached_items[:max(1, int(limit or 8))]]

    recent_by_key = {}
    central_root = _central_session_root()
    if central_root.is_dir() and not central_root.is_symlink():
        for session in central_root.iterdir():
            if session.is_symlink() or not session.is_dir() or not (session / "test.json").is_file():
                continue
            payload = _read_status(session) or {}
            source = str(payload.get("source") or "").strip()
            model_id = str(payload.get("modelId") or payload.get("model") or "").strip()
            owner_folder = str(payload.get("ownerFolder") or "").strip()
            key = (owner_folder, model_id, source)
            try:
                modified = (session / "test.json").stat().st_mtime
            except OSError:
                modified = 0
            item = recent_by_key.setdefault(key, {
                "folder": owner_folder,
                "source": source,
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
    return recent[:max(1, int(limit or 8))]


def remove_candidate(folder_path, file_name, session_name=None, model_id=None, source=None):
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
    resolved_source = None if source is None else str(source or "").strip()
    if session_name:
        session = _session_directory(folder_path, session_name)
        session_status = _read_status(session) or {}
        resolved_model_id = str(
            session_status.get("modelId")
            or session_status.get("model")
            or resolved_model_id
            or get_test_model().PROFILE_ID
        )
        if "source" in session_status:
            resolved_source = str(session_status.get("source") or "").strip()
    model = get_test_model(resolved_model_id or get_test_model().PROFILE_ID)
    test_directory = _resolved_test_directory(folder_path, model, source=resolved_source)
    candidate = test_directory / name
    sidecar = candidate.with_suffix(".webcap.json")

    if resolved_source is not None and candidate.is_file() and not _is_webcap_staged_lora(candidate, model):
        raise ValueError("Only WebCap-staged Test candidates can be removed from Test Generations.")
    if candidate.is_symlink() or (candidate.exists() and not candidate.is_file()):
        raise RuntimeError("Staged Test candidate is not a regular file: " + name)
    if sidecar.is_symlink() or (sidecar.exists() and not sidecar.is_file()):
        raise RuntimeError("Staged Test candidate sidecar is not a regular file: " + sidecar.name)

    session_status = _remove_candidate_from_session(folder_path, session_name, name) if session_name else None

    if candidate.is_file():
        candidate.unlink()
    if sidecar.is_file():
        sidecar.unlink()

    remaining = _lora_files(test_directory) if test_directory.is_dir() else []
    return {
        "operation": "test_remove_candidate",
        "modelId": model.PROFILE_ID,
        "removed": name,
        "count": len(remaining),
        "files": [path.name for path in remaining],
        "sessionStatus": session_status,
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


def _session_root(folder_path):
    """Legacy per-set Test Session root."""
    return _owning_set_directory(folder_path) / TEST_RESULTS_DIR


def _central_session_root():
    root = Path(app_config.FS_ROOT) / ".webcap" / TEST_RESULTS_DIR
    if root.is_symlink():
        raise RuntimeError("Central Test Session storage cannot be symlinked.")
    return root


def _session_roots(folder_path):
    roots = [_central_session_root(), _session_root(folder_path)]
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
    legacy_root = _session_root(folder_path).resolve()
    if session.parent == legacy_root:
        return True

    central_root = _central_session_root().resolve()
    if session.parent != central_root:
        return False

    status = payload if isinstance(payload, dict) else (_read_status(session) or {})
    owner_folder = str(status.get("ownerFolder") or "").replace("\\", "/").strip("/")
    expected_owner = str(_relative_set_folder(folder_path) or "").replace("\\", "/").strip("/")
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
    root = _central_session_root()
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
        visible["resultFolder"] = _relative_to_fs_root(session_directory)
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


def _session_source(payload, folder_path):
    if isinstance(payload, dict) and "source" in payload:
        return str(payload.get("source") or "").strip()
    return _default_test_source(folder_path)


def _session_matches_source(payload, folder_path, source):
    if source is None:
        return True
    return _session_source(payload, folder_path) == str(source or "").strip()


def _candidate_rating_scores(folder_path, model_id=None, source=None):
    selected_model_id = str(model_id or "").strip()
    default_model_id = get_test_model().PROFILE_ID
    totals = {}
    for session in _session_directories(folder_path):
        payload = _read_status(session) or {}
        if not _session_matches_source(payload, folder_path, source):
            continue
        session_model_id = str(payload.get("modelId") or payload.get("model") or default_model_id)
        if selected_model_id and session_model_id != selected_model_id:
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
    return {
        name: {
            "average": round(values["sum"] / values["count"], 2),
            "count": values["count"],
        }
        for name, values in totals.items()
        if values["count"]
    }

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
    return _with_session_ratings(session, _visible_session_status(folder_path, session))


def rating_summary(folder_path, model_id=None, source=None):
    return {
        "operation": "test_rating_summary",
        "candidateScores": _candidate_rating_scores(folder_path, model_id, source=source),
        "sessions": list_sessions(folder_path, source=source, model_id=model_id),
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


def _is_webcap_staged_lora(lora_file, model):
    payload = _staged_lora_provenance(lora_file)
    if payload.get("version") != 1:
        return False
    if str(payload.get("stage") or "").strip().lower() != str(model.STAGING_KEY or "").strip().lower():
        return False
    if not str(payload.get("sourceJobId") or "").strip():
        return False
    if not str(payload.get("sourceFolder") or "").strip():
        return False
    if not str(payload.get("sourceFileName") or "").strip():
        return False
    try:
        return int(payload.get("sourceEpoch")) >= 0
    except (TypeError, ValueError):
        return False


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


def prepare(folder_path, model_id=None, source=None):
    model = get_test_model(model_id)
    template = model.load_template()
    selected_source = None if source is None else str(source or "").strip()
    try:
        test_directory = _resolved_test_directory(folder_path, model, source=selected_source)
        loras = _lora_files(test_directory) if test_directory.is_dir() else []
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
    return {
        "operation": "test_prepare",
        "modelId": model.PROFILE_ID,
        "modelLabel": str(model.profile["label"]),
        "mediaKind": model.MEDIA_KIND,
        "source": _default_test_source(folder_path) if selected_source is None else selected_source,
        "settings": list(model.settings),
        "settingOptions": setting_options,
        "warnings": prepare_warnings,
        "defaultPrompt": model.default_prompt(template),
        "defaults": defaults,
        "aspectRatioOptions": list(getattr(model, "ASPECT_RATIO_OPTIONS", ())),
        "count": len(loras),
        "files": [path.name for path in loras],
        "removableFiles": [
            path.name for path in loras
            if _is_webcap_staged_lora(path, model)
        ],
        "candidateScores": _candidate_rating_scores(folder_path, model.PROFILE_ID, source=selected_source),
        "sessions": list_sessions(folder_path, source=selected_source, model_id=model.PROFILE_ID),
        "latest": status(folder_path, model_id=model.PROFILE_ID, source=selected_source),
    }

def handle_request(folder_path, mode, selection_criteria=None):
    operation = str(mode or "").strip().lower()
    if operation == "test_prepare":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return prepare(folder_path, model_id=criteria.get("modelId"), source=criteria.get("source"))
    if operation == "test_status":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return status(folder_path, model_id=criteria.get("modelId"), source=criteria.get("source"))
    if operation == "test_sessions":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return {"operation": "test_sessions", "sessions": list_sessions(folder_path, source=criteria.get("source"), model_id=criteria.get("modelId"))}
    if operation == "test_queue":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return queued_jobs(folder_path, source=criteria.get("source"), model_id=criteria.get("modelId"))
    if operation == "test_queue_cancel":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return cancel_queued(folder_path, criteria.get("jobId"))
    if operation == "test_queue_clear":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return clear_queued(folder_path, source=criteria.get("source"), model_id=criteria.get("modelId"))
    if operation == "test_open_session":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return open_session(folder_path, criteria.get("session"))
    if operation == "test_delete_session":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return delete_session(folder_path, criteria.get("session"))
    if operation == "test_rating_summary":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return rating_summary(folder_path, model_id=criteria.get("modelId"), source=criteria.get("source"))
    if operation == "test_stop":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return stop(folder_path, session_name=criteria.get("session"), source=criteria.get("source"))
    if operation == "test_remove_candidate":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return remove_candidate(
            folder_path,
            criteria.get("fileName"),
            session_name=criteria.get("session"),
            model_id=criteria.get("modelId"),
            source=criteria.get("source"),
        )
    if operation == "test_enqueue":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
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
            include_base=criteria.get("includeBase"),
            model_id=criteria.get("modelId"),
            source=criteria.get("source"),
        )
    raise ValueError("Unsupported Test Generations operation: " + operation)

# Shared inference migration -------------------------------------------------


SHARED_EXECUTION_LANE = "inference"


def _new_inference_request(folder_path, prompt, settings=None, seed=None, name=None,
                           selected_files=None, include_base=True, model_id=None, source=None,
                           aspect_ratio=None, megapixels=None, duration=None):
    from . import inference_runtime

    model = get_test_model(model_id)
    prompt = str(prompt or "").strip()
    if not prompt:
        raise ValueError("A test prompt is required.")
    selected_source = None if source is None else str(source or "").strip()
    test_directory = _resolved_test_directory(folder_path, model, source=selected_source)
    loras = _selected_lora_files(test_directory, selected_files=selected_files)
    if not loras:
        raise ValueError("The Test folder contains no .safetensors files.")
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
    resolved_prompt = inference_runtime.resolve_wildcard_prompt(prompt, normalized_settings["seed"])
    request = {
        "modelId": model.PROFILE_ID,
        "mediaKind": model.MEDIA_KIND,
        "source": _default_test_source(folder_path) if selected_source is None else selected_source,
        "name": session_name,
        "sourcePrompt": prompt,
        "prompt": resolved_prompt,
        "settings": dict(normalized_settings),
        "workflow": copy.deepcopy(template),
    }
    request.update(_workflow_evidence(model, template))
    return request, loras, include_base is not False


def _session_job_records(status):
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
    session_terminal = str(status.get("status") or "") in {
        "complete", "stopped", "interrupted", "failed"
    }

    jobs = []
    for raw_job_id in job_ids:
        job_id = str(raw_job_id or "").strip()
        if not job_id:
            continue
        try:
            jobs.append(execution_get_job(job_id))
        except FileNotFoundError as exc:
            if job_id in terminal_job_ids or session_terminal:
                continue
            raise RuntimeError(
                "Test Session references a missing active inference job: " + job_id
            ) from exc
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


def _sync_inference_session(session_directory):
    with _status_lock:
        status = _read_status(session_directory) or {}
        if not isinstance(status.get("inferenceJobs"), list):
            return _session_status(session_directory)

        jobs = _session_job_records(status)
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
                failures.append({
                    "jobId": job_id,
                    "sourceLoRA": label or candidate_file or "Generation",
                    "candidateFile": candidate_file,
                    "error": str(job.get("error") or "Test generation failed."),
                    "elapsedMs": 0,
                })
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
        visible["resultFolder"] = visible.get("resultFolder") or _relative_to_fs_root(session_directory)

        if active is not None:
            metadata = active.get("metadata") if isinstance(active.get("metadata"), dict) else {}
            details = active.get("details") if isinstance(active.get("details"), dict) else {}
            visible["status"] = "stopping" if stopping_session or str(active.get("status") or "") == "stopping" else "running"
            visible["current"] = str(metadata.get("label") or metadata.get("candidateFile") or "Generation")
            started_at = float(active.get("startedAt") or 0)
            visible["candidateStartedAt"] = int(started_at * 1000) if started_at else None
            visible["comfyJobId"] = str(details.get("providerJobId") or "")
            visible["comfyStatus"] = str(details.get("providerStatus") or "")
            return visible

        visible["current"] = ""
        visible["comfyJobId"] = ""
        visible["comfyStatus"] = ""
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
                try:
                    execution_consume_terminal_job(str(job.get("id") or ""))
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


def _record_failed_inference(session_directory, job_id, candidate_label, candidate_file, exc, elapsed_ms):
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
    source = str(context.get("source") or request.get("source") or "").strip()
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
        lora_file = _test_directory(folder_path, model, source=source) / candidate_file
        if not lora_file.is_file():
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
        if not prompt:
            raise ValueError("Test inference job has no resolved prompt.")

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
            filename_prefix=output_prefix,
        )
        provider_job_id = inference_runtime.queue_workflow(workflow)
        execution_update_job(
            str(job_id),
            details={
                "providerJobId": provider_job_id,
                "providerStatus": "pending",
                "session": session_id,
                "resultFolder": _relative_to_fs_root(session_directory),
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
        media_path, caption_path = _result_paths(
            session_directory,
            lora_file,
            stem_override="base" if candidate_kind == "base" else None,
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
        )
        raise


def _enqueue_frozen_test_request(folder_path, request, loras, include_base, legacy_job_id=""):
    from .inference_runner import enqueue_test

    model = get_test_model(request.get("modelId"))
    session_directory = _new_session_directory(folder_path, model=model)
    folder = _relative_set_folder(folder_path)
    candidates = []
    if include_base:
        candidates.append({"kind": "base", "label": "Base", "file": ""})
    candidates.extend(
        {"kind": "lora", "label": path.name, "file": path.name}
        for path in loras
    )
    payload = {
        "status": "queued",
        "modelId": model.PROFILE_ID,
        "mediaKind": model.MEDIA_KIND,
        "source": str(request.get("source") or ""),
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
        "results": [],
        "resultFolder": _relative_to_fs_root(session_directory),
        "inferenceJobs": [],
        "legacyJobId": str(legacy_job_id or ""),
        "migrationComplete": False,
    }
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
                "source": str(request.get("source") or ""),
            }
            if legacy_job_id:
                job = enqueue_test(request, context, label=label, deferred=True)
            else:
                job = enqueue_test(request, context, label=label)
            queued_ids.append(job["jobId"])
            with _status_lock:
                current_status = _read_status(session_directory) or {}
                current_status["inferenceJobs"] = list(queued_ids)
                _atomic_write_json(_status_path(session_directory), current_status)
        with _status_lock:
            current_status = _read_status(session_directory) or {}
            current_status["inferenceJobs"] = list(queued_ids)
            current_status["migrationComplete"] = True
            _atomic_write_json(_status_path(session_directory), current_status)
    except Exception as exc:
        rollback_errors = []
        rollback_pending = False
        for job_id in queued_ids:
            try:
                queued_job = execution_get_job(job_id)
                job_status = str(queued_job.get("status") or "")
                if job_status in {"backlog", "queued"}:
                    execution_cancel_pending(job_id)
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
                    if not inference_runtime.cancel_job_and_wait(prompt_id):
                        from .inference_runner import hold_provider_cleanup
                        hold_provider_cleanup(
                            prompt_id,
                            (
                                "Queue paused: interrupted legacy Test provider work "
                                "could not be confirmed stopped after restart."
                            ),
                        )
                        _logger.error(
                            "Interrupted legacy Test provider job %s did not confirm cancellation.",
                            prompt_id,
                        )
                except Exception:
                    from .inference_runner import hold_provider_cleanup
                    hold_provider_cleanup(
                        prompt_id,
                        (
                            "Queue paused: interrupted legacy Test provider work "
                            "could not be confirmed stopped after restart."
                        ),
                    )
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
                                    execution_cancel_pending(str(child_id))
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
                selected = _selected_lora_files(
                    _test_directory(folder_path, model),
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
        _startup_reconciled = True


def enqueue(folder_path, prompt, settings=None, seed=None, name=None, selected_files=None,
            include_base=True, model_id=None, source=None, aspect_ratio=None, megapixels=None, duration=None):
    reconcile_startup()
    request, loras, include_base = _new_inference_request(
        folder_path,
        prompt,
        settings=settings,
        seed=seed,
        name=name,
        selected_files=selected_files,
        include_base=include_base,
        model_id=model_id,
        source=source,
        aspect_ratio=aspect_ratio,
        megapixels=megapixels,
        duration=duration,
    )
    latest = _enqueue_frozen_test_request(folder_path, request, loras, include_base)
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


def queued_jobs(folder_path, source=None, model_id=None):
    reconcile_startup()
    jobs = []
    selected_model_id = str(model_id or "").strip()
    for session_directory in sorted(
        _session_directories(folder_path),
        key=lambda path: path.name.lower(),
    ):
        visible = _sync_inference_session(session_directory)
        if not visible or not _session_matches_source(visible, folder_path, source) or visible.get("status") != "queued":
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
    source = _session_source(visible, folder_path)
    status_payload = _read_status(session_directory) or {}
    for child in _session_job_records(status_payload):
        if str(child.get("status") or "") in {"backlog", "queued"}:
            execution_cancel_pending(str(child.get("id") or ""))
    shutil.rmtree(session_directory)
    return {
        "operation": "test_queue_cancel",
        "removed": str(job_id),
        "source": source,
        "jobs": queued_jobs(
            folder_path,
            source=source,
            model_id=str(visible.get("modelId") or visible.get("model") or ""),
        )["jobs"],
    }


def clear_queued(folder_path, source=None, model_id=None):
    removed = 0
    for job in list(queued_jobs(folder_path, source=source, model_id=model_id)["jobs"]):
        cancel_queued(folder_path, job["id"])
        removed += 1
    return {"operation": "test_queue_clear", "removed": removed, "jobs": queued_jobs(folder_path, source=source, model_id=model_id)["jobs"]}


def _visible_session_status(folder_path, session_directory):
    status_payload = _read_status(session_directory) or {}
    if isinstance(status_payload.get("inferenceJobs"), list):
        return _sync_inference_session(session_directory)
    payload = _session_status(session_directory)
    if payload and str(payload.get("status") or "") in {"starting", "running", "stopping"}:
        _mark_session_interrupted(session_directory)
        payload = _session_status(session_directory)
    return payload


def list_sessions(folder_path, source=None, model_id=None):
    sessions = []
    selected_model_id = str(model_id or "").strip()
    default_model_id = get_test_model().PROFILE_ID
    for session in sorted(
        _session_directories(folder_path),
        key=lambda path: path.name.lower(),
        reverse=True,
    ):
        payload = _visible_session_status(folder_path, session)
        if not payload or not _session_matches_source(payload, folder_path, source) or payload.get("status") == "queued":
            continue
        session_model_id = str(payload.get("modelId") or payload.get("model") or default_model_id)
        if selected_model_id and session_model_id != selected_model_id:
            continue
        results = payload.get("results") if isinstance(payload.get("results"), list) else []
        ratings = _session_rating_map(session)
        unrated = sum(
            1 for result in results
            if isinstance(result, dict) and _result_media_file(result)
            and _result_media_file(result) not in ratings
        )
        sessions.append({
            "session": session.name,
            "name": str(payload.get("name") or ""),
            "modelId": str(payload.get("modelId") or payload.get("model") or ""),
            "source": _session_source(payload, folder_path),
            "ownerFolder": str(payload.get("ownerFolder") or _relative_set_folder(folder_path)),
            "status": str(payload.get("status") or ""),
            "startedAt": int(payload.get("startedAt") or 0),
            "candidateStartedAt": int(payload.get("candidateStartedAt") or 0),
            "completed": int(payload.get("completed") or 0),
            "failed": int(payload.get("failed") or 0),
            "total": int(payload.get("total") or 0),
            "queued": int(payload.get("queued") or 0),
            "running": int(payload.get("running") or 0),
            "unrated": unrated,
            "resultFolder": str(payload.get("resultFolder") or ""),
        })
    return sessions


def _latest_status(folder_path, model_id=None, source=None):
    selected_model = str(model_id or "").strip()
    sessions = sorted(
        _session_directories(folder_path),
        key=lambda path: path.name.lower(),
        reverse=True,
    )
    payloads = []
    for session in sessions:
        payload = _visible_session_status(folder_path, session)
        if not payload:
            continue
        if not _session_matches_source(payload, folder_path, source):
            continue
        if selected_model and str(payload.get("modelId") or payload.get("model") or "") != selected_model:
            continue
        payloads.append(payload)
    for payload in payloads:
        if payload.get("status") in {"running", "stopping"}:
            return payload
    return payloads[0] if payloads else {"status": "idle"}


def _visible_status(folder_path, model_id=None, source=None):
    return _latest_status(folder_path, model_id=model_id, source=source)


def status(folder_path, model_id=None, source=None):
    payload = _visible_status(folder_path, model_id=model_id, source=source)
    session_name = str(payload.get("session") or "").strip() if isinstance(payload, dict) else ""
    if not session_name:
        return payload
    return _with_session_ratings(_session_directory(folder_path, session_name), payload)


def stop(folder_path, session_name=None, source=None):
    reconcile_startup()
    session_id = str(session_name or "").strip()
    if session_id:
        session_directory = _session_directory(folder_path, session_id)
        payload = _visible_session_status(folder_path, session_directory)
    else:
        payload = _latest_status(folder_path, source=source)
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
            execution_cancel_pending(job_id)
        elif job_status in {"starting", "running"}:
            execution_request_stop(job_id)
    return _sync_inference_session(session_directory)


def delete_session(folder_path, session_name):
    session = _session_directory(folder_path, session_name)
    session_payload = _read_status(session) or {}
    source = _session_source(session_payload, folder_path)
    model_id = str(session_payload.get("modelId") or session_payload.get("model") or get_test_model().PROFILE_ID)
    if isinstance(session_payload.get("inferenceJobs"), list) and _session_has_nonterminal_jobs(session):
        raise RuntimeError("Cannot delete an active Test Generations session. Stop it first.")
    shutil.rmtree(session)
    return {
        "operation": "test_delete_session",
        "deleted": Path(session_name).name,
        "modelId": model_id,
        "source": source,
        "sessions": list_sessions(folder_path, source=source, model_id=model_id),
        "latest": _latest_status(folder_path, model_id=model_id, source=source),
    }


def _remove_candidate_from_session(folder_path, session_name, candidate_name):
    session = _session_directory(folder_path, session_name)
    session_payload = _read_status(session) or {}
    status_payload = session_payload
    if _session_has_nonterminal_jobs(session):
        raise RuntimeError("Cannot remove results from an active Test Generations session. Stop it first.")

    status_payload = status_payload or _read_status(session) or {}
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
    snapshot = execution_lane_snapshot(SHARED_EXECUTION_LANE, include_terminal=False)
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
        active.append({
            "folder": str(visible.get("ownerFolder") or key[0]),
            "source": _session_source(visible, set_folder),
            "modelId": str(visible.get("modelId") or visible.get("model") or ""),
            "session": key[1],
            "status": str(visible.get("status") or "running"),
            "completed": int(visible.get("completed") or 0),
            "total": int(visible.get("total") or 0),
        })
    current = test_presence(folder_path) if folder_path is not None else None
    return {"active": active, "current": current, "recent": recent_test_sets()}

