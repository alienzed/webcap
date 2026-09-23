import copy
import hashlib
import json
import logging
import os
import re
import secrets
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path

from . import config as app_config
from .folder_state_store import read_folder_state
from .test_models import get_test_model, supported_models as registered_test_models, supported_profile_ids
from .training_test_paths import test_copy_path
from .execution_queue import (
    cancel_queued as execution_cancel_queued,
    claim_next as execution_claim_next,
    enqueue as execution_enqueue,
    finish_job as execution_finish_job,
    get_job as execution_get_job,
    lane_snapshot as execution_lane_snapshot,
    mark_running as execution_mark_running,
    recover_lane as execution_recover_lane,
    request_stop as execution_request_stop,
    resource_owner as execution_resource_owner,
    update_job as execution_update_job,
)

COMFY_BASE_URL = "http://127.0.0.1:8188"
TEMPLATE_PATH = get_test_model().TEMPLATE_PATH
TEST_RESULTS_DIR = "test-generations"
GENERATION_TIMEOUT_SECONDS = 45 * 60
COMFY_JOB_MISSING_GRACE_SECONDS = 10
EXECUTION_LANE = "test-generations"
GPU_RESERVATION_OWNER = EXECUTION_LANE
TEST_ASPECT_RATIO_OPTIONS = tuple(getattr(get_test_model(), "ASPECT_RATIO_OPTIONS", ()))
_lock = threading.Lock()
_status_lock = threading.Lock()
_dispatch_lock = threading.Lock()
_active_threads = {}
_active_sessions = {}
_stop_requests = set()
_recent_sets_cache = {"expires": 0.0, "items": []}
_reconcile_lock = threading.Lock()
_startup_reconciled = False
_monitor_lock = threading.Lock()
_monitor_thread = None
_logger = logging.getLogger(__name__)


def _execution_job_payload(job):
    if not isinstance(job, dict):
        return None
    metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
    return {
        "id": str(job.get("id") or ""),
        "folder": str(metadata.get("folder") or ""),
        "runName": str(metadata.get("runName") or ""),
        "modelId": str(metadata.get("modelId") or ""),
        "status": str(job.get("status") or ""),
        "testTotal": int(metadata.get("testTotal") or 0),
        "createdAt": float(job.get("createdAt") or 0),
        "queuePosition": int(job.get("queuePosition") or 0),
    }


def _ensure_execution_reconciled():
    global _startup_reconciled
    if _startup_reconciled:
        return
    with _reconcile_lock:
        if _startup_reconciled:
            return
        interrupted = execution_recover_lane(
            EXECUTION_LANE,
            reason="Test Generations execution was interrupted by a WebCap restart.",
        )
        for job in interrupted:
            metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
            details = job.get("details") if isinstance(job.get("details"), dict) else {}
            prompt_id = str(details.get("comfyJobId") or "").strip()
            if prompt_id:
                try:
                    _cancel_comfy_job(prompt_id)
                except Exception:
                    _logger.exception("Could not cancel interrupted Test Generations ComfyUI job %s.", prompt_id)
            folder = str(metadata.get("folder") or "").strip()
            session_name = str(details.get("session") or "").strip()
            if not folder or not session_name:
                continue
            try:
                session_directory = _session_directory(app_config.safe_join_fs_root(folder), session_name)
            except (FileNotFoundError, ValueError):
                continue
            with _status_lock:
                status = _read_status(session_directory) or {}
                if str(status.get("status") or "") in ("starting", "running", "stopping"):
                    status["status"] = "failed"
                    status["current"] = ""
                    status["error"] = "Test Generations execution was interrupted by a WebCap restart."
                    _atomic_write_json(_status_path(session_directory), status)
        _startup_reconciled = True


def _monitor_loop():
    while True:
        try:
            _advance_test_queue()
        except Exception:
            _logger.exception("Test Generations queue monitor failed.")
        time.sleep(2)


def _ensure_monitor_started():
    global _monitor_thread
    with _monitor_lock:
        if _monitor_thread and _monitor_thread.is_alive():
            return
        _monitor_thread = threading.Thread(
            target=_monitor_loop,
            name="webcap-test-generations-queue",
            daemon=True,
        )
        _monitor_thread.start()


def reconcile_startup():
    _ensure_execution_reconciled()


def start_observer():
    reconcile_startup()
    _ensure_monitor_started()


def _reserve_gpu_for_test_generations():
    from .training_runner import reserve_gpu_for_external_work
    return reserve_gpu_for_external_work(GPU_RESERVATION_OWNER)


def _release_gpu_for_test_generations():
    from .training_runner import release_gpu_for_external_work
    release_gpu_for_external_work(GPU_RESERVATION_OWNER)


def _windows_curl_path():
    is_wsl = bool(os.environ.get("WSL_INTEROP") or os.environ.get("WSL_DISTRO_NAME"))
    if not is_wsl:
        try:
            is_wsl = "microsoft" in Path("/proc/sys/kernel/osrelease").read_text(encoding="utf-8").lower()
        except OSError:
            is_wsl = False
    if not is_wsl:
        return None
    candidate = Path("/mnt/c/Windows/System32/curl.exe")
    return str(candidate) if candidate.is_file() else None


def _windows_curl_request(curl_path, url, method="GET", payload=None, timeout=10):
    command = [
        curl_path,
        "--silent",
        "--show-error",
        "--fail-with-body",
        "--max-time",
        str(timeout),
        "--request",
        method,
    ]
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        command.extend(["--header", "Content-Type: application/json", "--data-binary", "@-"])
    command.append(url)
    try:
        result = subprocess.run(
            command,
            input=data,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout + 5,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ConnectionError(str(exc)) from exc
    if result.returncode != 0:
        stderr_detail = result.stderr.decode("utf-8", errors="replace").strip()
        body_detail = result.stdout.decode("utf-8", errors="replace").strip()
        detail = body_detail or stderr_detail
        if result.returncode in (5, 6, 7, 28):
            raise ConnectionError(detail or "curl.exe could not reach ComfyUI.")
        raise RuntimeError(
            "ComfyUI request failed: "
            + (detail or "curl.exe exited with code " + str(result.returncode) + ".")
        )
    return result.stdout


def _read_json_response(url, method="GET", payload=None, timeout=10):
    curl_path = _windows_curl_path()
    if curl_path:
        try:
            body = _windows_curl_request(curl_path, url, method=method, payload=payload, timeout=timeout)
        except ConnectionError as exc:
            raise RuntimeError("Could not connect to ComfyUI at " + COMFY_BASE_URL + ".") from exc
    else:
        data = None
        headers = {}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                body = response.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace").strip()
            raise RuntimeError("ComfyUI request failed (" + str(exc.code) + "): " + (detail or str(exc))) from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise RuntimeError("Could not connect to ComfyUI at " + COMFY_BASE_URL + ".") from exc
    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("ComfyUI returned invalid JSON.") from exc


def _read_bytes(url, timeout=30):
    curl_path = _windows_curl_path()
    if curl_path:
        try:
            return _windows_curl_request(curl_path, url, timeout=timeout)
        except (ConnectionError, RuntimeError) as exc:
            raise RuntimeError("Could not retrieve the ComfyUI output.") from exc
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.read()
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
        raise RuntimeError("Could not retrieve the ComfyUI output.") from exc


def _cancel_comfy_job(prompt_id):
    job_id = str(prompt_id or "").strip()
    if not job_id:
        return False
    response = _read_json_response(
        COMFY_BASE_URL + "/api/jobs/" + urllib.parse.quote(job_id, safe="") + "/cancel",
        method="POST",
        timeout=5,
    )
    return bool(response.get("cancelled")) if isinstance(response, dict) else False


def _load_template():
    return get_test_model().load_template()

def _default_prompt(workflow=None):
    return get_test_model().default_prompt(workflow or _load_template())

def _template_test_settings(workflow=None):
    return get_test_model().template_settings(workflow or _load_template())

def _normalized_test_settings(template, aspect_ratio=None, megapixels=None, duration=None, seed=None):
    return get_test_model().normalize_settings(
        template,
        _new_session_seed,
        {
            "aspectRatio": aspect_ratio,
            "megapixels": megapixels,
            "duration": duration,
            "seed": seed,
        },
    )

def _owning_set_directory(folder_path):
    path = Path(folder_path).resolve()
    for candidate in (path, *path.parents):
        if candidate.name == TEST_RESULTS_DIR:
            return candidate.parent
    return path


def _folder_key(folder_path):
    return str(_owning_set_directory(folder_path))


def _test_directory(folder_path, model):
    return test_copy_path(model.STAGING_KEY, _owning_set_directory(folder_path).name)


def _h3_test_directory(folder_path):
    return _test_directory(folder_path, get_test_model())


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
    sessions = list_sessions(set_folder)
    return {
        "folder": _relative_set_folder(set_folder),
        "stagedCount": staged_count,
        "sessionCount": len(sessions),
        "hasTestData": bool(staged_count or sessions),
    }

def recent_test_sets(limit=8):
    now = time.monotonic()
    cached_items = _recent_sets_cache.get("items") if isinstance(_recent_sets_cache.get("items"), list) else []
    if now < float(_recent_sets_cache.get("expires") or 0):
        return [dict(item) for item in cached_items[:max(1, int(limit or 8))]]

    fs_root = Path(app_config.FS_ROOT).resolve()
    recent = []
    if not fs_root.is_dir():
        return recent

    for dir_path, dir_names, _file_names in os.walk(fs_root):
        if TEST_RESULTS_DIR not in dir_names:
            continue
        dir_names.remove(TEST_RESULTS_DIR)
        set_folder = Path(dir_path).resolve()
        session_root = set_folder / TEST_RESULTS_DIR
        sessions = list_sessions(set_folder)
        if not sessions:
            continue
        latest = sessions[0]
        latest_name = str(latest.get("session") or "")
        latest_status_path = session_root / latest_name / "test.json"
        try:
            modified = latest_status_path.stat().st_mtime
        except OSError:
            modified = 0
        recent.append({
            "folder": _relative_set_folder(set_folder),
            "sessionCount": len(sessions),
            "latestSession": latest_name,
            "modified": modified,
        })

    recent.sort(key=lambda item: (float(item.get("modified") or 0), str(item.get("latestSession") or "")), reverse=True)
    _recent_sets_cache["items"] = [dict(item) for item in recent]
    _recent_sets_cache["expires"] = time.monotonic() + 10.0
    return recent[:max(1, int(limit or 8))]


def activity_snapshot(folder_path=None):
    active = []
    with _lock:
        dead_keys = []
        for folder_key, thread in list(_active_threads.items()):
            if not thread or not thread.is_alive():
                dead_keys.append(folder_key)
                continue
            session_directory = _active_sessions.get(folder_key)
            status = _session_status(session_directory) if session_directory else None
            active.append({
                "folder": _relative_set_folder(Path(folder_key)),
                "session": str((status or {}).get("session") or (Path(session_directory).name if session_directory else "")),
                "status": str((status or {}).get("status") or "running"),
                "completed": int((status or {}).get("completed") or 0),
                "total": int((status or {}).get("total") or 0),
            })
        for folder_key in dead_keys:
            _active_threads.pop(folder_key, None)
            _active_sessions.pop(folder_key, None)
            _stop_requests.discard(folder_key)
    current = test_presence(folder_path) if folder_path is not None else None
    return {"active": active, "current": current, "recent": recent_test_sets()}


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

def _normalize_lora_name(value):
    return "/".join(segment for segment in re.split(r"[\\/]+", str(value or "")) if segment).casefold()


def _available_comfy_names(node_type, input_name, label):
    payload = _read_json_response(
        COMFY_BASE_URL + "/object_info/" + urllib.parse.quote(node_type, safe=""),
        timeout=5,
    )
    node = payload.get(node_type) if isinstance(payload, dict) else None
    inputs = node.get("input") if isinstance(node, dict) and isinstance(node.get("input"), dict) else {}
    required = inputs.get("required") if isinstance(inputs.get("required"), dict) else {}
    optional = inputs.get("optional") if isinstance(inputs.get("optional"), dict) else {}
    spec = required.get(input_name)
    if spec is None:
        spec = optional.get(input_name)
    choices = spec[0] if isinstance(spec, (list, tuple)) and spec else None
    if not isinstance(choices, (list, tuple)):
        raise RuntimeError("ComfyUI did not expose the available " + label + " names for " + node_type + ".")
    names = [str(name) for name in choices if str(name).strip()]
    if not names:
        raise RuntimeError("ComfyUI reports no " + label + " files available to " + node_type + ".")
    return names


def _resolve_comfy_name(configured_name, available, label):
    configured = str(configured_name or "").strip()
    normalized = _normalize_lora_name(configured)
    records = [
        (name, _normalize_lora_name(name), Path(str(name).replace("\\", "/")).name.casefold())
        for name in available
    ]
    suffix_matches = [
        name
        for name, available_normalized, _ in records
        if normalized == available_normalized or normalized.endswith("/" + available_normalized)
    ]
    if len(suffix_matches) == 1:
        return suffix_matches[0]

    basename = Path(configured.replace("\\", "/")).name.casefold()
    basename_matches = [name for name, _, record_basename in records if record_basename == basename]
    if len(basename_matches) == 1:
        return basename_matches[0]
    display_name = Path(configured.replace("\\", "/")).name or configured
    if not basename_matches:
        raise RuntimeError("ComfyUI cannot see " + label + ": " + display_name)
    raise RuntimeError("ComfyUI " + label + " name is ambiguous: " + display_name)


def _available_comfy_lora_names():
    return get_test_model().available_lora_names(_available_comfy_names)

def _resolve_comfy_template_assets(template):
    return get_test_model().resolve_assets(template, _available_comfy_names, _resolve_comfy_name)

def _resolve_wildcard_prompt(prompt, seed):
    response = _read_json_response(
        COMFY_BASE_URL + "/impact/wildcards",
        method="POST",
        payload={"text": str(prompt or ""), "seed": int(seed)},
        timeout=10,
    )
    resolved = str(response.get("text") or "").strip() if isinstance(response, dict) else ""
    if not resolved:
        raise RuntimeError("Impact Pack did not return a resolved Test prompt.")
    return resolved


def _workflow_for_lora(
    template,
    prompt,
    comfy_lora_name,
    settings=None,
    strength_model=0.9,
    strength_clip=1,
    filename_prefix=None,
):
    return get_test_model().build_workflow(
        template,
        prompt,
        comfy_lora_name,
        settings=settings,
        strength_model=strength_model,
        strength_clip=strength_clip,
        filename_prefix=filename_prefix,
    )

def _find_video_ref(value):
    return get_test_model().find_output_ref(value)

def _queue_workflow(workflow):
    prompt_id = str(uuid.uuid4())
    response = _read_json_response(
        COMFY_BASE_URL + "/prompt",
        method="POST",
        payload={"prompt": workflow, "prompt_id": prompt_id},
    )
    returned_id = str(response.get("prompt_id") or "").strip() if isinstance(response, dict) else ""
    if returned_id != prompt_id:
        raise RuntimeError("ComfyUI did not accept the requested Test job ID.")
    return prompt_id


def _read_comfy_job(prompt_id):
    url = COMFY_BASE_URL + "/api/jobs/" + urllib.parse.quote(str(prompt_id or ""), safe="")
    try:
        payload = _read_json_response(url)
    except RuntimeError as exc:
        if "404" in str(exc):
            return None
        raise
    if not isinstance(payload, dict):
        raise RuntimeError("ComfyUI returned invalid Test job status.")
    return payload


def _format_comfy_job_error(job):
    error = job.get("execution_error") if isinstance(job, dict) and isinstance(job.get("execution_error"), dict) else {}
    message = str(error.get("exception_message") or "").strip()
    node_id = str(error.get("node_id") or "").strip()
    node_type = str(error.get("node_type") or "").strip()
    detail = message or "ComfyUI reported an execution error."
    node = " / ".join(value for value in (node_id, node_type) if value)
    return detail + ((" (" + node + ")") if node else "")


def _update_live_comfy_status(session_directory, **fields):
    with _status_lock:
        status = _read_status(session_directory) or {}
        status.update(fields)
        _atomic_write_json(_status_path(session_directory), status)
        return status


def _wait_for_output(
    model,
    prompt_id,
    timeout=GENERATION_TIMEOUT_SECONDS,
    session_directory=None,
    folder_key=None,
):
    deadline = time.monotonic() + timeout
    missing_since = None
    while True:
        if time.monotonic() >= deadline:
            raise RuntimeError("Timed out waiting for ComfyUI to finish this generation.")
        if folder_key and _stop_requested(folder_key):
            _cancel_comfy_job(prompt_id)
            raise RuntimeError("Test run stopped.")

        job = _read_comfy_job(prompt_id)
        now_ms = int(time.time() * 1000)
        if job is None:
            if missing_since is None:
                missing_since = time.monotonic()
            if session_directory is not None:
                _update_live_comfy_status(
                    session_directory,
                    comfyJobId=prompt_id,
                    comfyStatus="missing",
                    comfyLastContactAt=now_ms,
                )
            if time.monotonic() - missing_since >= COMFY_JOB_MISSING_GRACE_SECONDS:
                raise RuntimeError(
                    "ComfyUI lost Test job " + str(prompt_id) + "; ComfyUI may have restarted."
                )
            time.sleep(2)
            continue

        missing_since = None
        job_status = str(job.get("status") or "").strip().lower()
        if session_directory is not None:
            _update_live_comfy_status(
                session_directory,
                comfyJobId=prompt_id,
                comfyStatus=job_status,
                comfyLastContactAt=now_ms,
            )

        if job_status in ("pending", "in_progress"):
            time.sleep(2)
            continue
        if job_status == "failed":
            raise RuntimeError(_format_comfy_job_error(job))
        if job_status == "cancelled":
            raise RuntimeError("ComfyUI cancelled this Test generation.")
        if job_status == "completed":
            output_ref = model.find_output_ref(job.get("outputs") or {})
            if output_ref:
                return output_ref
            raise RuntimeError(
                "ComfyUI completed the workflow without returning a "
                + str(model.MEDIA_KIND or "media")
                + " output."
            )
        raise RuntimeError("ComfyUI returned unknown Test job status: " + (job_status or "empty") + ".")


def _wait_for_video(
    prompt_id,
    timeout=GENERATION_TIMEOUT_SECONDS,
    session_directory=None,
    folder_key=None,
):
    return _wait_for_output(
        get_test_model(),
        prompt_id,
        timeout=timeout,
        session_directory=session_directory,
        folder_key=folder_key,
    )

def _comfy_saved_output_path(output_ref):
    if str(output_ref.get("type") or "") != "output":
        raise RuntimeError("ComfyUI Test output was not saved to the output directory.")
    raw_path = str(output_ref.get("fullpath") or "").strip()
    if not raw_path:
        raise RuntimeError("ComfyUI did not expose the saved Test output path.")
    path = Path(raw_path)
    if path.is_file():
        return path
    if _windows_curl_path() and re.match(r"^[A-Za-z]:[\\/]", raw_path):
        try:
            converted = subprocess.run(
                ["wslpath", "-u", raw_path],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise RuntimeError("Could not resolve the saved ComfyUI output path.") from exc
        converted_path = (converted.stdout or "").strip()
        if converted.returncode == 0 and converted_path:
            path = Path(converted_path)
    if not path.is_file():
        raise FileNotFoundError("Saved ComfyUI Test output does not exist: " + raw_path)
    return path

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


def _download_output(output_ref):
    query = urllib.parse.urlencode({
        "filename": output_ref["filename"],
        "subfolder": output_ref.get("subfolder") or "",
        "type": output_ref.get("type") or "output",
    })
    return _read_bytes(COMFY_BASE_URL + "/view?" + query)


def _download_video(video_ref):
    return _download_output(video_ref)

def _move_saved_output(output_ref, destination, filename_prefix=None):
    if str(output_ref.get("type") or "") != "output":
        raise RuntimeError("ComfyUI Test output was not saved to the output directory.")
    target = Path(destination)
    if target.exists():
        raise FileExistsError("Test result already exists: " + str(target))

    raw_path = str(output_ref.get("fullpath") or "").strip()
    if not raw_path:
        target.write_bytes(_download_output(output_ref))
        if not target.is_file():
            raise RuntimeError("Saved ComfyUI Test output was not copied into the Test session.")
        return target

    source = _comfy_saved_output_path(output_ref)
    source_directory = source.parent
    shutil.move(str(source), str(target))
    if not target.is_file():
        raise RuntimeError("Saved ComfyUI Test output was not moved into the Test session.")
    if filename_prefix:
        try:
            _cleanup_owned_comfy_directory(source_directory, filename_prefix)
        except (OSError, ValueError) as exc:
            app_config.debug_print("[test-generations] Could not clean owned ComfyUI output directory:", exc)
    return target


def _move_saved_video(video_ref, destination, filename_prefix=None):
    return _move_saved_output(video_ref, destination, filename_prefix=filename_prefix)

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
    return _owning_set_directory(folder_path) / TEST_RESULTS_DIR


def _session_directory(folder_path, session_name):
    name = str(session_name or "").strip()
    if not name or name in (".", "..") or "/" in name or "\\" in name:
        raise ValueError("A valid Test session name is required.")
    root = _session_root(folder_path).resolve()
    session = (root / name).resolve()
    if session.parent != root:
        raise ValueError("Test session path escaped the current set.")
    if not session.is_dir() or not (session / "test.json").is_file():
        raise FileNotFoundError("Test session does not exist: " + name)
    return session


def _new_session_directory(folder_path, model=None):
    selected_model = model or get_test_model()
    root = _session_root(folder_path)
    root.mkdir(parents=True, exist_ok=True)
    base = datetime.now().strftime("%Y-%m-%d_%H%M-") + selected_model.SESSION_SLUG
    candidate = root / base
    suffix = 2
    while candidate.exists():
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


def _result_media_kind(result):
    if not isinstance(result, dict):
        return ""
    kind = str(result.get("mediaKind") or "").strip().lower()
    if kind:
        return kind
    name = _result_media_file(result).lower()
    if name.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif")):
        return "image"
    if name:
        return "video"
    return ""


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


def _candidate_rating_scores(folder_path, model_id=None):
    root = _session_root(folder_path)
    if not root.is_dir():
        return {}
    selected_model_id = str(model_id or "").strip()
    default_model_id = get_test_model().PROFILE_ID
    totals = {}
    for session in root.iterdir():
        if not session.is_dir() or not (session / "test.json").is_file():
            continue
        payload = _read_status(session) or {}
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

def _mark_session_interrupted(session_directory, message):
    status = _read_status(session_directory) or {}
    if status.get("status") not in ("running", "stopping"):
        return _session_status(session_directory)
    status["status"] = "interrupted"
    status["current"] = ""
    status["error"] = str(message or "Test run was interrupted.")
    _atomic_write_json(_status_path(session_directory), status)
    return _session_status(session_directory)


def _visible_session_status(folder_path, session_directory):
    payload = _session_status(session_directory)
    if not payload or payload.get("status") not in ("running", "stopping"):
        return payload

    folder_key = _folder_key(folder_path)
    with _lock:
        thread = _active_threads.get(folder_key)
        active_session = _active_sessions.get(folder_key)
        live = bool(
            thread
            and thread.is_alive()
            and active_session
            and Path(active_session).resolve() == Path(session_directory).resolve()
        )
        if live:
            return payload
        if not thread or not thread.is_alive():
            _active_threads.pop(folder_key, None)
            _active_sessions.pop(folder_key, None)
            _stop_requests.discard(folder_key)

    return _mark_session_interrupted(
        session_directory,
        "Test run was interrupted because its worker is no longer active.",
    )


def list_sessions(folder_path):
    root = _session_root(folder_path)
    if not root.is_dir():
        return []
    sessions = []
    for session in sorted(
        [path for path in root.iterdir() if path.is_dir() and (path / "test.json").is_file()],
        key=lambda path: path.name.lower(),
        reverse=True,
    ):
        payload = _visible_session_status(folder_path, session)
        if not payload:
            continue
        results = payload.get("results") if isinstance(payload.get("results"), list) else []
        ratings = _session_rating_map(session)
        unrated = sum(
            1
            for result in results
            if isinstance(result, dict)
            and _result_media_file(result)
            and _result_media_file(result) not in ratings
        )
        sessions.append({
            "session": session.name,
            "name": str(payload.get("name") or ""),
            "modelId": str(payload.get("modelId") or payload.get("model") or ""),
            "status": str(payload.get("status") or ""),
            "startedAt": int(payload.get("startedAt") or 0),
            "candidateStartedAt": int(payload.get("candidateStartedAt") or 0),
            "completed": int(payload.get("completed") or 0),
            "failed": int(payload.get("failed") or 0),
            "total": int(payload.get("total") or 0),
            "unrated": unrated,
            "resultFolder": str(payload.get("resultFolder") or ""),
        })
    return sessions


def open_session(folder_path, session_name):
    session = _session_directory(folder_path, session_name)
    return _with_session_ratings(session, _visible_session_status(folder_path, session))


def delete_session(folder_path, session_name):
    session = _session_directory(folder_path, session_name)
    session_status = _read_status(session) or {}
    model_id = str(
        session_status.get("modelId")
        or session_status.get("model")
        or get_test_model().PROFILE_ID
    )
    folder_key = _folder_key(folder_path)
    with _lock:
        thread = _active_threads.get(folder_key)
        active_session = _active_sessions.get(folder_key)
        if thread and thread.is_alive() and active_session and Path(active_session).resolve() == session.resolve():
            raise RuntimeError("Cannot delete the active Test Generations session. Stop it first.")
    shutil.rmtree(session)
    return {
        "operation": "test_delete_session",
        "deleted": session.name,
        "modelId": model_id,
        "sessions": list_sessions(folder_path),
        "latest": _latest_status(folder_path, model_id=model_id),
    }


def rating_summary(folder_path, model_id=None):
    return {
        "operation": "test_rating_summary",
        "candidateScores": _candidate_rating_scores(folder_path, model_id),
        "sessions": list_sessions(folder_path),
    }

def _session_result_path(session_directory, file_name):
    name = str(file_name or "").strip()
    if not name or name in (".", "..") or "/" in name or "\\" in name:
        raise ValueError("Test result filename is invalid.")
    path = Path(session_directory) / name
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise RuntimeError("Test result is not a regular file: " + name)
    return path


def _remove_candidate_from_session(folder_path, session_name, candidate_name):
    session = _session_directory(folder_path, session_name)
    folder_key = _folder_key(folder_path)
    with _lock:
        thread = _active_threads.get(folder_key)
        active_session = _active_sessions.get(folder_key)
        if thread and thread.is_alive() and active_session and Path(active_session).resolve() == session.resolve():
            raise RuntimeError("Cannot remove results from the active Test Generations session. Stop it first.")

    status = _read_status(session) or {}
    results = status.get("results") if isinstance(status.get("results"), list) else []
    failures = status.get("failures") if isinstance(status.get("failures"), list) else []

    removed_results = [
        result for result in results
        if isinstance(result, dict)
        and str(result.get("candidateFile") or result.get("sourceLoRA") or "") == candidate_name
    ]
    removed_failures = [
        failure for failure in failures
        if isinstance(failure, dict) and str(failure.get("sourceLoRA") or "") == candidate_name
    ]

    paths = []
    for result in removed_results:
        output_name = _result_media_file(result)
        if output_name:
            media_path = _session_result_path(session, output_name)
            caption_path = _session_result_path(session, Path(output_name).with_suffix(".txt").name)
            if media_path.is_file():
                paths.append(media_path)
            if caption_path.is_file():
                paths.append(caption_path)

    for path in paths:
        path.unlink()

    if removed_results or removed_failures:
        status["results"] = [result for result in results if result not in removed_results]
        status["failures"] = [failure for failure in failures if failure not in removed_failures]
        status["completed"] = max(0, int(status.get("completed") or 0) - len(removed_results))
        status["failed"] = max(0, int(status.get("failed") or 0) - len(removed_failures))
        status["total"] = max(
            0,
            int(status.get("total") or 0) - len(removed_results) - len(removed_failures),
        )
        _atomic_write_json(_status_path(session), status)

    return _session_status(session)


def _latest_status(folder_path, model_id=None):
    root = _session_root(folder_path)
    if not root.is_dir():
        return {"status": "idle"}
    selected_model_id = str(model_id or "").strip()
    default_model_id = get_test_model().PROFILE_ID
    sessions = sorted(
        [path for path in root.iterdir() if path.is_dir() and (path / "test.json").is_file()],
        key=lambda path: path.name.lower(),
        reverse=True,
    )
    for session in sessions:
        payload = _session_status(session)
        if not payload:
            continue
        session_model_id = str(payload.get("modelId") or payload.get("model") or default_model_id)
        if selected_model_id and session_model_id != selected_model_id:
            continue
        return payload
    return {"status": "idle"}

def _visible_status(folder_path, model_id=None):
    payload = _latest_status(folder_path, model_id=model_id)
    if payload.get("status") not in ("running", "stopping"):
        return payload
    session_name = str(payload.get("session") or "").strip()
    if not session_name:
        return payload
    session_directory = _session_directory(folder_path, session_name)
    return _visible_session_status(folder_path, session_directory)

def _staged_lora_provenance(lora_file):
    sidecar = Path(lora_file).with_suffix(".webcap.json")
    try:
        payload = json.loads(sidecar.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _workflow_seed(workflow):
    return get_test_model().workflow_seed(workflow)

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

def _stop_requested(folder_key):
    with _lock:
        return folder_key in _stop_requests


def _mark_stopped(session_directory):
    with _status_lock:
        status = _read_status(session_directory) or {}
        status["status"] = "stopped"
        status["current"] = ""
        status["error"] = ""
        status["comfyStatus"] = "cancelled"
        _atomic_write_json(_status_path(session_directory), status)
        return status


def _candidate_elapsed_ms(started_at):
    return max(0, int(round((time.monotonic() - started_at) * 1000)))


def _run_batch(
    folder_key,
    session_directory,
    loras,
    prompt,
    settings=None,
    template=None,
    include_base=True,
    model=None,
    execution_job_id=None,
):
    selected_model = model or get_test_model()
    status_file = _status_path(session_directory)
    try:
        template = copy.deepcopy(template) if template is not None else selected_model.load_template()
        candidates = []
        if include_base:
            candidates.append({"label": "Base", "file": None, "kind": "base"})
        for lora_file in loras:
            candidates.append({"label": lora_file.name, "file": lora_file, "kind": "lora"})

        for candidate_index, candidate in enumerate(candidates, start=1):
            if _stop_requested(folder_key):
                _mark_stopped(session_directory)
                return

            candidate_started_at = time.monotonic()
            lora_file = candidate["file"]
            output_prefix = _candidate_output_prefix(session_directory, candidate_index, candidate)
            media_path = None
            caption_path = None
            with _status_lock:
                status = _read_status(session_directory) or {}
                status["current"] = candidate["label"]
                status["candidateStartedAt"] = int(time.time() * 1000)
                status["comfyJobId"] = ""
                status["comfyStatus"] = ""
                status["comfyLastContactAt"] = None
                _atomic_write_json(status_file, status)
            try:
                comfy_lora_name = None
                if candidate["kind"] == "lora":
                    comfy_lora_name = _resolve_comfy_name(
                        lora_file,
                        selected_model.available_lora_names(_available_comfy_names),
                        "staged LoRA",
                    )
                workflow = selected_model.build_workflow(
                    template,
                    prompt,
                    comfy_lora_name,
                    settings=settings,
                    filename_prefix=output_prefix,
                )
                prompt_id = _queue_workflow(workflow)
                if execution_job_id:
                    execution_update_job(
                        execution_job_id,
                        details={"comfyJobId": prompt_id, "comfyStatus": "pending"},
                    )
                _update_live_comfy_status(
                    session_directory,
                    comfyJobId=prompt_id,
                    comfyStatus="pending",
                    comfyLastContactAt=int(time.time() * 1000),
                )
                output_ref = _wait_for_output(
                    selected_model,
                    prompt_id,
                    session_directory=session_directory,
                    folder_key=folder_key,
                )
                output_extension = Path(str(output_ref.get("filename") or "")).suffix
                if not output_extension:
                    raise RuntimeError("ComfyUI Test output has no file extension.")
                media_path, caption_path = _result_paths(
                    session_directory,
                    lora_file,
                    stem_override="base" if candidate["kind"] == "base" else None,
                    extension=output_extension,
                )
                _move_saved_output(output_ref, media_path, filename_prefix=output_prefix)
                caption_path.write_text(prompt, encoding="utf-8")
                with _status_lock:
                    status = _read_status(session_directory) or {}
                    results = status.get("results") if isinstance(status.get("results"), list) else []
                    result = {
                        "kind": candidate["kind"],
                        "sourceLoRA": candidate["label"],
                        "mediaFile": media_path.name,
                        "mediaKind": selected_model.MEDIA_KIND,
                        "prompt": prompt,
                        "seed": selected_model.workflow_seed(workflow),
                        "elapsedMs": _candidate_elapsed_ms(candidate_started_at),
                    }
                    if candidate["kind"] == "lora":
                        result["candidateFile"] = lora_file.name
                        provenance = _staged_lora_provenance(lora_file)
                        if provenance:
                            result["provenance"] = provenance
                    results.append(result)
                    status["results"] = results
                    status["completed"] = int(status.get("completed") or 0) + 1
                    status["current"] = ""
                    status["comfyStatus"] = "completed"
                    _atomic_write_json(status_file, status)
                if execution_job_id:
                    execution_update_job(execution_job_id, details={"comfyStatus": "completed"})
            except Exception as exc:
                for owned_path in (caption_path, media_path):
                    if owned_path and Path(owned_path).is_file():
                        Path(owned_path).unlink()
                if _stop_requested(folder_key):
                    _mark_stopped(session_directory)
                    return
                _logger.exception("Test generation candidate failed: %s", candidate["label"])
                with _status_lock:
                    status = _read_status(session_directory) or {}
                    failures = status.get("failures") if isinstance(status.get("failures"), list) else []
                    failure = {
                        "sourceLoRA": candidate["label"],
                        "error": str(exc),
                        "elapsedMs": _candidate_elapsed_ms(candidate_started_at),
                    }
                    if candidate["kind"] == "lora":
                        failure["candidateFile"] = lora_file.name
                    failures.append(failure)
                    status["failures"] = failures
                    status["failed"] = int(status.get("failed") or 0) + 1
                    status["current"] = ""
                    status["error"] = ""
                    status["comfyStatus"] = "failed"
                    _atomic_write_json(status_file, status)
                if execution_job_id:
                    execution_update_job(execution_job_id, details={"comfyStatus": "failed"})

        with _status_lock:
            status = _read_status(session_directory) or {}
            status["status"] = "stopped" if _stop_requested(folder_key) else "complete"
            status["current"] = ""
            _atomic_write_json(status_file, status)
    except Exception as exc:
        _logger.exception("Test generation batch failed.")
        with _status_lock:
            status = _read_status(session_directory) or {}
            status["status"] = "failed"
            status["current"] = ""
            status["error"] = str(exc)
            _atomic_write_json(status_file, status)
    finally:
        final_status = _read_status(session_directory) or {}
        if execution_job_id:
            status_value = str(final_status.get("status") or "")
            if status_value == "complete":
                execution_finish_job(
                    execution_job_id,
                    status="completed",
                    result={"session": Path(session_directory).name},
                )
            elif status_value == "stopped":
                execution_finish_job(
                    execution_job_id,
                    status="stopped",
                    result={"session": Path(session_directory).name},
                )
            else:
                execution_finish_job(
                    execution_job_id,
                    status="failed",
                    result={"session": Path(session_directory).name},
                    error=str(final_status.get("error") or "Test Generations batch failed."),
                )
        with _lock:
            _active_threads.pop(folder_key, None)
            _active_sessions.pop(folder_key, None)
            _stop_requests.discard(folder_key)
        _advance_test_queue()

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


def _build_queued_request(
    folder_path,
    prompt,
    settings=None,
    seed=None,
    name=None,
    selected_files=None,
    include_base=True,
    model_id=None,
    aspect_ratio=None,
    megapixels=None,
    duration=None,
):
    model = get_test_model(model_id)
    prompt = str(prompt or "").strip()
    if not prompt:
        raise ValueError("A test prompt is required.")
    test_directory = _test_directory(folder_path, model)
    loras = _selected_lora_files(test_directory, selected_files=selected_files)
    if not loras:
        raise ValueError("The Test folder contains no .safetensors files.")
    session_name = str(name or "").strip()
    if len(session_name) > 120:
        raise ValueError("Test session name must be 120 characters or fewer.")

    requested_settings = dict(settings) if isinstance(settings, dict) else {}
    # Legacy H3 request fields remain accepted while the UI moves to the generic settings object.
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
    resolved_prompt = _resolve_wildcard_prompt(prompt, normalized_settings["seed"])
    include_base = include_base is not False
    request = {
        "modelId": model.PROFILE_ID,
        "name": session_name,
        "sourcePrompt": prompt,
        "resolvedPrompt": resolved_prompt,
        "selectedFiles": [path.name for path in loras],
        "includeBase": include_base,
        "settings": dict(normalized_settings),
        "workflow": copy.deepcopy(template),
        "total": len(loras) + (1 if include_base else 0),
    }
    request.update(_workflow_evidence(model, template))
    request.update(normalized_settings)
    return request

def _queue_job_payload(job, position=0):
    payload = _execution_job_payload(job)
    if payload is None:
        return None
    payload["status"] = "queued"
    if position:
        payload["queuePosition"] = int(position)
    return payload


def _prune_dead_test_workers_locked():
    dead_keys = [key for key, thread in _active_threads.items() if not thread or not thread.is_alive()]
    for key in dead_keys:
        _active_threads.pop(key, None)
        _active_sessions.pop(key, None)
        _stop_requests.discard(key)


def _advance_test_queue():
    _ensure_execution_reconciled()
    with _dispatch_lock:
        while True:
            with _lock:
                _prune_dead_test_workers_locked()
                if any(thread and thread.is_alive() for thread in _active_threads.values()):
                    return None

            snapshot = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
            if snapshot.get("paused") or snapshot.get("activeJobId"):
                return None
            queued = [job for job in snapshot.get("jobs", []) if job.get("status") == "queued"]
            if not queued:
                if execution_resource_owner() == GPU_RESERVATION_OWNER:
                    _release_gpu_for_test_generations()
                return None

            owner = execution_resource_owner()
            if owner and owner != GPU_RESERVATION_OWNER:
                return None
            reserved_here = False
            if not owner:
                if not _reserve_gpu_for_test_generations():
                    return None
                reserved_here = True

            claimed = execution_claim_next(EXECUTION_LANE)
            if claimed is None:
                if reserved_here:
                    _release_gpu_for_test_generations()
                return None

            job_id = str(claimed.get("id") or "")
            stored = execution_get_job(job_id, include_payload=True)
            metadata = stored.get("metadata") if isinstance(stored.get("metadata"), dict) else {}
            request = stored.get("payload") if isinstance(stored.get("payload"), dict) else {}
            folder = str(metadata.get("folder") or "").strip()
            try:
                folder_path = app_config.safe_join_fs_root(folder)
                payload = start_queued(folder_path, request, execution_job_id=job_id)
            except Exception as exc:
                execution_finish_job(job_id, status="failed", error=str(exc))
                _logger.exception("Queued Test Generations job could not start.")
                continue

            status_value = str((payload or {}).get("status") or "")
            if status_value in ("starting", "running"):
                return payload
            if status_value == "skipped":
                execution_finish_job(
                    job_id,
                    status="completed",
                    result={"status": "skipped"},
                )
                continue

            execution_finish_job(
                job_id,
                status="failed",
                error=str((payload or {}).get("error") or "Test Generations could not start."),
            )


def cancel_queued(folder_path, job_id):
    _ensure_execution_reconciled()
    folder = _relative_set_folder(folder_path)
    job_id = str(job_id or "").strip()
    if not job_id:
        raise ValueError("Queued Test job ID is required.")
    job = execution_get_job(job_id)
    metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
    if str(metadata.get("folder") or "") != folder:
        raise FileNotFoundError("Queued Test session was not found.")
    execution_cancel_queued(job_id)
    _advance_test_queue()
    return {"operation": "test_queue_cancel", "removed": job_id, "jobs": queued_jobs(folder_path)["jobs"]}


def clear_queued(folder_path):
    _ensure_execution_reconciled()
    folder = _relative_set_folder(folder_path)
    snapshot = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
    matching = [
        job for job in snapshot.get("jobs", [])
        if job.get("status") == "queued"
        and str((job.get("metadata") or {}).get("folder") or "") == folder
    ]
    for job in matching:
        execution_cancel_queued(job.get("id"))
    _advance_test_queue()
    return {"operation": "test_queue_clear", "removed": len(matching), "jobs": queued_jobs(folder_path)["jobs"]}


def enqueue(
    folder_path,
    prompt,
    settings=None,
    seed=None,
    name=None,
    selected_files=None,
    include_base=True,
    model_id=None,
    aspect_ratio=None,
    megapixels=None,
    duration=None,
):
    _ensure_execution_reconciled()
    request = _build_queued_request(
        folder_path,
        prompt,
        settings=settings,
        seed=seed,
        name=name,
        selected_files=selected_files,
        include_base=include_base,
        model_id=model_id,
        aspect_ratio=aspect_ratio,
        megapixels=megapixels,
        duration=duration,
    )
    folder = _relative_set_folder(folder_path)
    job = execution_enqueue(
        EXECUTION_LANE,
        request,
        metadata={
            "kind": "test-generation-session",
            "folder": folder,
            "runName": str(request.get("name") or ""),
            "modelId": str(request.get("modelId") or ""),
            "testTotal": int(request.get("total") or 0),
        },
    )

    latest = _advance_test_queue()
    current = execution_get_job(job["id"])
    if current.get("status") == "failed":
        raise RuntimeError(str(current.get("error") or "Test Generations could not start."))
    visible = _execution_job_payload(current)
    return {
        "operation": "test_enqueue",
        "job": visible,
        "queued": current.get("status") == "queued",
        "latest": latest if current.get("status") != "queued" else None,
    }


def queued_jobs(folder_path):
    _ensure_execution_reconciled()
    folder = _relative_set_folder(folder_path)
    snapshot = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
    jobs = []
    for job in snapshot.get("jobs", []):
        if job.get("status") != "queued":
            continue
        metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
        if str(metadata.get("folder") or "") != folder:
            continue
        jobs.append(_queue_job_payload(job, job.get("queuePosition") or 0))
    return {"operation": "test_queue", "jobs": jobs}


def start_queued(folder_path, request, execution_job_id=None):
    request = dict(request or {})
    model = get_test_model(request.get("modelId") or request.get("model"))
    prompt = str(request.get("resolvedPrompt") or "").strip()
    source_prompt = str(request.get("sourcePrompt") or prompt).strip()
    if not prompt:
        raise ValueError("Queued Test Generations job has no resolved prompt.")
    session_name = str(request.get("name") or "").strip()
    folder_key = _folder_key(folder_path)
    test_directory = _test_directory(folder_path, model)
    selected_loras = _selected_lora_files(test_directory, selected_files=request.get("selectedFiles"))
    loras = [path for path in selected_loras if path.is_file()]
    missing = [path.name for path in selected_loras if not path.is_file()]
    if missing:
        _logger.warning("Queued Test skipped removed staged LoRA(s): %s", ", ".join(missing))
    include_base = request.get("includeBase") is not False
    if not loras and not include_base:
        _logger.warning("Queued Test skipped because no selected staged LoRAs remain.")
        return {"status": "skipped"}

    requested_settings = request.get("settings") if isinstance(request.get("settings"), dict) else {
        key: request.get(key) for key in model.settings
    }
    frozen_template = request.get("workflow")
    if not isinstance(frozen_template, dict):
        raise ValueError("Queued Test Generations job has no frozen workflow.")
    workflow_evidence = _workflow_evidence(model, frozen_template)
    expected_workflow_file = str(request.get("workflowFile") or "")
    expected_workflow_sha256 = str(request.get("workflowSha256") or "")
    if expected_workflow_file and expected_workflow_file != workflow_evidence["workflowFile"]:
        raise ValueError("Queued Test Generations workflow identity does not match the selected model.")
    if expected_workflow_sha256 and expected_workflow_sha256 != workflow_evidence["workflowSha256"]:
        raise ValueError("Queued Test Generations workflow fingerprint is invalid.")

    with _lock:
        _prune_dead_test_workers_locked()
        active = _active_threads.get(folder_key)
        if active and active.is_alive():
            raise RuntimeError("This set already has an active Test Generations batch.")
        session_directory = _new_session_directory(folder_path, model=model)
        payload = {
            "status": "starting",
            "modelId": model.PROFILE_ID,
            "mediaKind": model.MEDIA_KIND,
            "session": session_directory.name,
            "name": session_name,
            "sourcePrompt": source_prompt,
            "resolvedPrompt": prompt,
            "prompt": prompt,
            "total": int(request.get("total") or 0),
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
            "settings": dict(requested_settings),
            "workflowFile": workflow_evidence["workflowFile"],
            "workflowSha256": workflow_evidence["workflowSha256"],
            "includeBase": include_base,
            "results": [],
            "resultFolder": _relative_to_fs_root(session_directory),
        }
        payload.update(requested_settings)
        _atomic_write_json(_status_path(session_directory), payload)

    try:
        _read_json_response(COMFY_BASE_URL + "/system_stats", timeout=3)
        template = model.resolve_assets(copy.deepcopy(frozen_template), _available_comfy_names, _resolve_comfy_name)
        normalized_settings = model.normalize_settings(template, _new_session_seed, requested_settings)
        payload["settings"] = dict(normalized_settings)
        payload.update(normalized_settings)
        payload["includeBase"] = include_base
        payload["total"] = len(loras) + (1 if include_base else 0)
        if execution_job_id:
            execution_mark_running(
                execution_job_id,
                details={
                    "session": session_directory.name,
                    "resultFolder": _relative_to_fs_root(session_directory),
                },
            )
        thread = threading.Thread(
            target=_run_batch,
            args=(folder_key, session_directory, loras, prompt, normalized_settings, template, include_base, model, execution_job_id),
            name="webcap-test-generations-" + model.SESSION_SLUG,
            daemon=True,
        )
        with _lock:
            _stop_requests.discard(folder_key)
            _active_sessions[folder_key] = session_directory
            _active_threads[folder_key] = thread
            thread.start()
        with _status_lock:
            live_status = _read_status(session_directory) or {}
            if str(live_status.get("status") or "") == "starting":
                live_status["status"] = "running"
                _atomic_write_json(_status_path(session_directory), live_status)
            payload = live_status or payload
        return payload
    except Exception as exc:
        payload["status"] = "failed"
        payload["error"] = str(exc)
        payload["current"] = ""
        _atomic_write_json(_status_path(session_directory), payload)
        return payload

def supported_models():
    return {
        "operation": "test_models",
        "models": registered_test_models(),
    }


def prepare(folder_path, model_id=None):
    model = get_test_model(model_id)
    template = model.load_template()
    try:
        test_directory = _test_directory(folder_path, model)
        loras = _lora_files(test_directory) if test_directory.is_dir() else []
    except ValueError:
        loras = []
    defaults = model.template_settings(template)
    defaults["seed"] = _new_session_seed()
    setting_options = {}
    prepare_warnings = []
    try:
        setting_options = model.setting_options(template, _available_comfy_names)
    except (ConnectionError, RuntimeError) as exc:
        prepare_warnings.append(
            "Could not load optional Test setting choices from ComfyUI: " + str(exc)
        )
    return {
        "operation": "test_prepare",
        "modelId": model.PROFILE_ID,
        "modelLabel": str(model.profile["label"]),
        "mediaKind": model.MEDIA_KIND,
        "settings": list(model.settings),
        "settingOptions": setting_options,
        "warnings": prepare_warnings,
        "defaultPrompt": model.default_prompt(template),
        "defaults": defaults,
        "aspectRatioOptions": list(getattr(model, "ASPECT_RATIO_OPTIONS", ())),
        "count": len(loras),
        "files": [path.name for path in loras],
        "candidateScores": _candidate_rating_scores(folder_path, model.PROFILE_ID),
        "sessions": list_sessions(folder_path),
        "latest": status(folder_path, model_id=model.PROFILE_ID),
    }

def status(folder_path, model_id=None):
    payload = _visible_status(folder_path, model_id=model_id)
    session_name = str(payload.get("session") or "").strip() if isinstance(payload, dict) else ""
    if not session_name:
        return payload
    return _with_session_ratings(_session_directory(folder_path, session_name), payload)

def stop(folder_path):
    _ensure_execution_reconciled()
    folder_key = _folder_key(folder_path)
    folder = _relative_set_folder(folder_path)
    with _lock:
        thread = _active_threads.get(folder_key)
        session_directory = _active_sessions.get(folder_key)
        if not thread or not thread.is_alive() or not session_directory:
            raise RuntimeError("No active Test Generations batch to stop.")
        _stop_requests.add(folder_key)

    snapshot = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
    active_id = str(snapshot.get("activeJobId") or "")
    active_job = execution_get_job(active_id) if active_id else None
    metadata = active_job.get("metadata") if isinstance(active_job, dict) and isinstance(active_job.get("metadata"), dict) else {}
    if not active_job or str(metadata.get("folder") or "") != folder:
        raise RuntimeError("Active Test Generations execution job is missing.")
    execution_request_stop(active_id)

    with _status_lock:
        status = _read_status(session_directory) or {}
        status["status"] = "stopping"
        _atomic_write_json(_status_path(session_directory), status)
    prompt_id = str(status.get("comfyJobId") or "").strip()
    if prompt_id:
        _cancel_comfy_job(prompt_id)
    return status


def handle_request(folder_path, mode, selection_criteria=None):
    operation = str(mode or "").strip().lower()
    if operation == "test_prepare":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return prepare(folder_path, model_id=criteria.get("modelId"))
    if operation == "test_status":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return status(folder_path, model_id=criteria.get("modelId"))
    if operation == "test_sessions":
        return {"operation": "test_sessions", "sessions": list_sessions(folder_path)}
    if operation == "test_queue":
        return queued_jobs(folder_path)
    if operation == "test_queue_cancel":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return cancel_queued(folder_path, criteria.get("jobId"))
    if operation == "test_queue_clear":
        return clear_queued(folder_path)
    if operation == "test_open_session":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return open_session(folder_path, criteria.get("session"))
    if operation == "test_delete_session":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return delete_session(folder_path, criteria.get("session"))
    if operation == "test_rating_summary":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return rating_summary(folder_path, model_id=criteria.get("modelId"))
    if operation == "test_stop":
        return stop(folder_path)
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
        )
    raise ValueError("Unsupported Test Generations operation: " + operation)

# Shared inference migration -------------------------------------------------

_legacy_visible_session_status = _visible_session_status
_legacy_activity_snapshot = activity_snapshot
_legacy_stop = stop
_legacy_delete_session = delete_session
_legacy_remove_candidate_from_session = _remove_candidate_from_session

LEGACY_EXECUTION_LANE = EXECUTION_LANE
SHARED_EXECUTION_LANE = "inference"


def _new_inference_request(folder_path, prompt, settings=None, seed=None, name=None,
                           selected_files=None, include_base=True, model_id=None,
                           aspect_ratio=None, megapixels=None, duration=None):
    from . import inference_runtime

    model = get_test_model(model_id)
    prompt = str(prompt or "").strip()
    if not prompt:
        raise ValueError("A test prompt is required.")
    test_directory = _test_directory(folder_path, model)
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
    return [execution_get_job(str(job_id)) for job_id in job_ids if str(job_id or "").strip()]


def _job_candidate_identity(job):
    metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
    kind = str(metadata.get("candidateKind") or "")
    candidate_file = str(metadata.get("candidateFile") or "")
    label = str(metadata.get("label") or "")
    return kind, candidate_file, label


def _session_has_nonterminal_jobs(session_directory):
    status = _read_status(session_directory) or {}
    if not status.get("inferenceJobs"):
        return False
    return any(
        str(job.get("status") or "") in {"queued", "starting", "running", "stopping"}
        for job in _session_job_records(status)
    )


def _sync_inference_session(session_directory):
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
        if job_status in {"failed", "interrupted"} and job_id not in failure_job_ids:
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
    queued = [job for job in jobs if str(job.get("status") or "") == "queued"]
    completed = len(status.get("results") if isinstance(status.get("results"), list) else [])
    failed = len(status.get("failures") if isinstance(status.get("failures"), list) else [])
    visible = dict(status)
    visible["completed"] = completed
    visible["failed"] = failed
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
    elif queued:
        terminal_status = "running" if (completed or failed) else "queued"
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
    candidate_label = str(context.get("candidateLabel") or "").strip() or (
        "Base" if candidate_kind == "base" else candidate_file
    )
    if not folder or not session_id or candidate_kind not in {"base", "lora"}:
        raise RuntimeError("Test inference is missing its Session candidate context.")

    folder_path = app_config.safe_join_fs_root(folder)
    session_directory = _session_directory(folder_path, session_id)
    model = get_test_model(request.get("modelId"))
    lora_file = None
    if candidate_kind == "lora":
        lora_file = _test_directory(folder_path, model) / candidate_file
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
        settings = dict(request.get("settings") or {})
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
        media_path.write_bytes(inference_runtime.download_output(output_ref))
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
    _atomic_write_json(_status_path(session_directory), payload)

    queued_ids = []
    try:
        for index, candidate in enumerate(candidates, start=1):
            label_root = str(request.get("name") or "").strip() or session_directory.name
            label = label_root + " · " + candidate["label"]
            job = enqueue_test(
                request,
                {
                    "folder": folder,
                    "sessionId": session_directory.name,
                    "candidateKind": candidate["kind"],
                    "candidateFile": candidate["file"],
                    "candidateLabel": candidate["label"],
                    "candidateIndex": index,
                },
                label=label,
            )
            queued_ids.append(job["jobId"])
            payload["inferenceJobs"] = list(queued_ids)
            _atomic_write_json(_status_path(session_directory), payload)
        payload["migrationComplete"] = True
        _atomic_write_json(_status_path(session_directory), payload)
    except Exception:
        for job_id in queued_ids:
            try:
                execution_cancel_queued(job_id)
            except Exception:
                _logger.exception("Could not roll back partially queued Test rendition %s.", job_id)
        shutil.rmtree(session_directory, ignore_errors=True)
        raise
    return _sync_inference_session(session_directory)


def _find_legacy_migration_session(folder_path, legacy_job_id):
    root = _session_root(folder_path)
    if not root.is_dir():
        return None
    for session in root.iterdir():
        if not session.is_dir():
            continue
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
                    inference_runtime.cancel_job(prompt_id)
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
                        for child_id in existing_status.get("inferenceJobs") or []:
                            try:
                                execution_cancel_queued(str(child_id))
                            except Exception:
                                pass
                        shutil.rmtree(session_directory, ignore_errors=True)
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


def start_observer():
    reconcile_startup()


def enqueue(folder_path, prompt, settings=None, seed=None, name=None, selected_files=None,
            include_base=True, model_id=None, aspect_ratio=None, megapixels=None, duration=None):
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


def queued_jobs(folder_path):
    reconcile_startup()
    root = _session_root(folder_path)
    if not root.is_dir():
        return {"operation": "test_queue", "jobs": []}
    jobs = []
    for session_directory in sorted(
        [path for path in root.iterdir() if path.is_dir() and (path / "test.json").is_file()],
        key=lambda path: path.name.lower(),
    ):
        visible = _sync_inference_session(session_directory)
        if not visible or visible.get("status") != "queued":
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
        if str(child.get("status") or "") == "queued":
            execution_cancel_queued(str(child.get("id") or ""))
    shutil.rmtree(session_directory)
    return {"operation": "test_queue_cancel", "removed": str(job_id), "jobs": queued_jobs(folder_path)["jobs"]}


def clear_queued(folder_path):
    removed = 0
    for job in list(queued_jobs(folder_path)["jobs"]):
        cancel_queued(folder_path, job["id"])
        removed += 1
    return {"operation": "test_queue_clear", "removed": removed, "jobs": queued_jobs(folder_path)["jobs"]}


def _visible_session_status(folder_path, session_directory):
    status_payload = _read_status(session_directory) or {}
    if isinstance(status_payload.get("inferenceJobs"), list):
        return _sync_inference_session(session_directory)
    return _legacy_visible_session_status(folder_path, session_directory)


def list_sessions(folder_path):
    root = _session_root(folder_path)
    if not root.is_dir():
        return []
    sessions = []
    for session in sorted(
        [path for path in root.iterdir() if path.is_dir() and (path / "test.json").is_file()],
        key=lambda path: path.name.lower(),
        reverse=True,
    ):
        payload = _visible_session_status(folder_path, session)
        if not payload or payload.get("status") == "queued":
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
            "status": str(payload.get("status") or ""),
            "startedAt": int(payload.get("startedAt") or 0),
            "candidateStartedAt": int(payload.get("candidateStartedAt") or 0),
            "completed": int(payload.get("completed") or 0),
            "failed": int(payload.get("failed") or 0),
            "total": int(payload.get("total") or 0),
            "unrated": unrated,
            "resultFolder": str(payload.get("resultFolder") or ""),
        })
    return sessions


def _latest_status(folder_path, model_id=None):
    root = _session_root(folder_path)
    if not root.is_dir():
        return {"status": "idle"}
    selected_model = str(model_id or "").strip()
    sessions = sorted(
        [path for path in root.iterdir() if path.is_dir() and (path / "test.json").is_file()],
        key=lambda path: path.name.lower(),
        reverse=True,
    )
    payloads = []
    for session in sessions:
        payload = _visible_session_status(folder_path, session)
        if not payload:
            continue
        if selected_model and str(payload.get("modelId") or payload.get("model") or "") != selected_model:
            continue
        payloads.append(payload)
    for payload in payloads:
        if payload.get("status") in {"running", "stopping"}:
            return payload
    return payloads[0] if payloads else {"status": "idle"}


def _visible_status(folder_path, model_id=None):
    return _latest_status(folder_path, model_id=model_id)


def status(folder_path, model_id=None):
    payload = _visible_status(folder_path, model_id=model_id)
    session_name = str(payload.get("session") or "").strip() if isinstance(payload, dict) else ""
    if not session_name:
        return payload
    return _with_session_ratings(_session_directory(folder_path, session_name), payload)


def stop(folder_path):
    reconcile_startup()
    payload = _latest_status(folder_path)
    session_id = str(payload.get("session") or "").strip()
    if not session_id or payload.get("status") not in {"running", "stopping"}:
        raise RuntimeError("No active Test Generations session to stop.")
    session_directory = _session_directory(folder_path, session_id)
    status_payload = _read_status(session_directory) or {}
    if not isinstance(status_payload.get("inferenceJobs"), list):
        return _legacy_stop(folder_path)
    status_payload["status"] = "stopping"
    _atomic_write_json(_status_path(session_directory), status_payload)

    for job in _session_job_records(status_payload):
        job_status = str(job.get("status") or "")
        job_id = str(job.get("id") or "")
        if job_status == "queued":
            execution_cancel_queued(job_id)
        elif job_status in {"starting", "running"}:
            execution_request_stop(job_id)
    return _sync_inference_session(session_directory)


def delete_session(folder_path, session_name):
    session = _session_directory(folder_path, session_name)
    session_payload = _read_status(session) or {}
    if not isinstance(session_payload.get("inferenceJobs"), list):
        return _legacy_delete_session(folder_path, session_name)
    if _session_has_nonterminal_jobs(session):
        raise RuntimeError("Cannot delete an active Test Generations session. Stop it first.")
    session_status = _read_status(session) or {}
    model_id = str(session_status.get("modelId") or session_status.get("model") or get_test_model().PROFILE_ID)
    shutil.rmtree(session)
    return {
        "operation": "test_delete_session",
        "deleted": session.name,
        "modelId": model_id,
        "sessions": list_sessions(folder_path),
        "latest": _latest_status(folder_path, model_id=model_id),
    }


def _remove_candidate_from_session(folder_path, session_name, candidate_name):
    session = _session_directory(folder_path, session_name)
    session_payload = _read_status(session) or {}
    if not isinstance(session_payload.get("inferenceJobs"), list):
        return _legacy_remove_candidate_from_session(folder_path, session_name, candidate_name)
    if _session_has_nonterminal_jobs(session):
        raise RuntimeError("Cannot remove results from an active Test Generations session. Stop it first.")

    status_payload = _read_status(session) or {}
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
    legacy = _legacy_activity_snapshot(folder_path)
    active = list(legacy.get("active") or [])
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
            "folder": key[0],
            "session": key[1],
            "status": str(visible.get("status") or "running"),
            "completed": int(visible.get("completed") or 0),
            "total": int(visible.get("total") or 0),
        })
    current = test_presence(folder_path) if folder_path is not None else None
    return {"active": active, "current": current, "recent": recent_test_sets()}

