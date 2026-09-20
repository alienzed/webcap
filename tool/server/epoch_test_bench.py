import copy
import json
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
from datetime import datetime
from pathlib import Path

from . import config as app_config
from .folder_state_store import read_folder_state
from .training_history import host_path_for_training_path

COMFY_BASE_URL = "http://127.0.0.1:8188"
TEMPLATE_PATH = Path(__file__).resolve().parents[1] / "templates" / "comfyui" / "minimax_h3_test_api.json"
TEST_RESULTS_DIR = "test-generations"
GENERATION_TIMEOUT_SECONDS = 45 * 60
TEST_ASPECT_RATIO_OPTIONS = (
    "1:1 (Square)",
    "2:3 (Portrait Photo)",
    "3:2 (Photo)",
    "3:4 (Portrait Standard)",
    "4:3 (Standard)",
    "9:16 (Portrait Widescreen)",
    "16:9 (Widescreen)",
    "21:9 (Ultrawide)",
)
_lock = threading.Lock()
_active_threads = {}
_active_sessions = {}
_stop_requests = set()
_recent_sets_cache = {"expires": 0.0, "items": []}


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
        "--fail",
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
        detail = result.stderr.decode("utf-8", errors="replace").strip()
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
            raise RuntimeError("ComfyUI request failed: " + (detail or str(exc))) from exc
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


def _interrupt_comfy():
    url = COMFY_BASE_URL + "/interrupt"
    curl_path = _windows_curl_path()
    if curl_path:
        try:
            _windows_curl_request(curl_path, url, method="POST", timeout=5)
            return
        except (ConnectionError, RuntimeError) as exc:
            raise RuntimeError("Could not interrupt the current ComfyUI generation.") from exc
    req = urllib.request.Request(url, data=b"", method="POST")
    try:
        with urllib.request.urlopen(req, timeout=5):
            return
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
        raise RuntimeError("Could not interrupt the current ComfyUI generation.") from exc


def _load_template():
    try:
        workflow = json.loads(TEMPLATE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("Could not read the MiniMax H3 Test Bench workflow template.") from exc
    if not isinstance(workflow, dict):
        raise ValueError("MiniMax H3 Test Bench workflow template must be a JSON object.")
    return workflow


def _default_prompt(workflow=None):
    selected = workflow or _load_template()
    inputs = ((selected.get("146") or {}).get("inputs") or {})
    prompt = str(inputs.get("wildcard_text") or inputs.get("populated_text") or "").strip()
    if not prompt:
        raise ValueError("MiniMax H3 Test Bench workflow has no default prompt in node 146.")
    return prompt


def _template_test_settings(workflow=None):
    selected = workflow or _load_template()
    resolution = ((selected.get("115") or {}).get("inputs") or {})
    duration = ((selected.get("133") or {}).get("inputs") or {})
    return {
        "aspectRatio": str(resolution.get("aspect_ratio") or "").strip(),
        "megapixels": float(resolution.get("megapixels") or 0),
        "duration": float(duration.get("value") or 0),
    }


def _normalized_test_settings(template, aspect_ratio=None, megapixels=None, duration=None, seed=None):
    defaults = _template_test_settings(template)
    selected_aspect = str(aspect_ratio or defaults["aspectRatio"]).strip()
    if selected_aspect not in TEST_ASPECT_RATIO_OPTIONS:
        raise ValueError("Unsupported Test Generations aspect ratio: " + selected_aspect)
    try:
        selected_megapixels = float(defaults["megapixels"] if megapixels is None else megapixels)
        selected_duration = float(defaults["duration"] if duration is None else duration)
        selected_seed = _new_session_seed() if seed is None or str(seed).strip() == "" else int(seed)
    except (TypeError, ValueError) as exc:
        raise ValueError("Test resolution, duration, and seed must be numeric.") from exc
    if selected_megapixels <= 0:
        raise ValueError("Test resolution must be greater than zero megapixels.")
    if selected_duration <= 0:
        raise ValueError("Test duration must be greater than zero seconds.")
    if selected_seed < 0 or selected_seed >= 2 ** 63:
        raise ValueError("Test seed must be between 0 and 9223372036854775807.")
    return {
        "aspectRatio": selected_aspect,
        "megapixels": selected_megapixels,
        "duration": selected_duration,
        "seed": selected_seed,
    }


def _owning_set_directory(folder_path):
    path = Path(folder_path).resolve()
    for candidate in (path, *path.parents):
        if candidate.name == TEST_RESULTS_DIR:
            return candidate.parent
    return path


def _folder_key(folder_path):
    return str(_owning_set_directory(folder_path))


def _h3_test_directory(folder_path):
    saved_config = app_config.load_config_from_disk()
    training = saved_config.get("training") if isinstance(saved_config.get("training"), dict) else {}
    roots = training.get("test_copy_roots") if isinstance(training.get("test_copy_roots"), dict) else {}
    root_text = str(roots.get("h3") or "").strip()
    if not root_text:
        raise ValueError("Configure the Copy to Test H3 root in Training Settings.")
    root = Path(host_path_for_training_path(root_text))
    subfolder = str(training.get("test_copy_subfolder") or "").strip()
    set_name = _owning_set_directory(folder_path).name
    if not set_name or set_name in (".", ".."):
        raise ValueError("The current set has no usable folder name.")
    destination = root
    if subfolder:
        destination = destination / subfolder
    return destination / set_name


def _lora_files(test_directory):
    if not test_directory.is_dir():
        raise FileNotFoundError("H3 Test folder does not exist: " + str(test_directory))
    return sorted(
        [path for path in test_directory.iterdir() if path.is_file() and path.suffix.lower() == ".safetensors"],
        key=lambda path: path.name.lower(),
    )


def _selected_lora_files(test_directory, selected_files=None):
    available = _lora_files(test_directory)
    if selected_files is None:
        return available
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

    available_by_name = {path.name: path for path in available}
    missing = [name for name in requested if name not in available_by_name]
    if missing:
        raise FileNotFoundError("Selected staged Test candidate does not exist: " + missing[0])
    requested_set = set(requested)
    return [path for path in available if path.name in requested_set]


def _relative_set_folder(folder_path):
    value = _relative_to_fs_root(_owning_set_directory(folder_path))
    return "" if value == "." else value


def test_presence(folder_path):
    set_folder = _owning_set_directory(folder_path)
    staged_count = 0
    try:
        test_directory = _h3_test_directory(set_folder)
        if test_directory.is_dir():
            staged_count = len([
                path for path in test_directory.iterdir()
                if path.is_file() and path.suffix.lower() == ".safetensors"
            ])
    except ValueError:
        staged_count = 0
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
            "status": str(latest.get("status") or ""),
            "completed": int(latest.get("completed") or 0),
            "failed": int(latest.get("failed") or 0),
            "total": int(latest.get("total") or 0),
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


def remove_candidate(folder_path, file_name, session_name=None):
    folder_key = _folder_key(folder_path)
    with _lock:
        thread = _active_threads.get(folder_key)
        if thread and thread.is_alive():
            raise RuntimeError("Cannot remove Test candidates while this set has an active Test Generations batch. Stop it first.")

    name = str(file_name or "").strip()
    if (
        not name
        or name in (".", "..")
        or "/" in name
        or "\\" in name
        or not name.lower().endswith(".safetensors")
    ):
        raise ValueError("A staged .safetensors filename is required.")
    test_directory = _h3_test_directory(folder_path)
    candidate = test_directory / name
    if not candidate.is_file() or candidate.is_symlink():
        raise FileNotFoundError("Staged Test candidate does not exist: " + name)
    sidecar = candidate.with_suffix(".webcap.json")
    if sidecar.exists() and (not sidecar.is_file() or sidecar.is_symlink()):
        raise RuntimeError("Staged Test candidate sidecar is not a regular file: " + sidecar.name)
    session_status = _remove_candidate_from_session(folder_path, session_name, name) if session_name else None
    candidate.unlink()
    if sidecar.exists():
        sidecar.unlink()
    remaining = _lora_files(test_directory)
    return {
        "operation": "test_remove_candidate",
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
    spec = required.get(input_name)
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
    return _available_comfy_names("LoraLoader", "lora_name", "LoRA")


def _resolve_comfy_loras(loras):
    available = _available_comfy_lora_names()
    return [
        (path, _resolve_comfy_name(path, available, "staged LoRA"))
        for path in loras
    ]


def _resolve_comfy_template_assets(template):
    workflow = copy.deepcopy(template)
    specs = (
        ("127", "UNETLoader", "unet_name", "diffusion model"),
        ("128", "CLIPLoader", "clip_name", "CLIP model"),
        ("119", "VAELoader", "vae_name", "video VAE"),
        ("120", "VAELoader", "vae_name", "audio VAE"),
    )
    available_cache = {}
    try:
        for node_id, node_type, input_name, label in specs:
            inputs = workflow[node_id]["inputs"]
            configured = inputs[input_name]
            cache_key = (node_type, input_name)
            if cache_key not in available_cache:
                available_cache[cache_key] = _available_comfy_names(node_type, input_name, label)
            inputs[input_name] = _resolve_comfy_name(configured, available_cache[cache_key], label)

        power_inputs = workflow["138"]["inputs"]
        enabled_power_loras = [
            value
            for value in power_inputs.values()
            if isinstance(value, dict) and value.get("on") is True and str(value.get("lora") or "").strip()
        ]
        if enabled_power_loras:
            available_loras = _available_comfy_lora_names()
            for entry in enabled_power_loras:
                entry["lora"] = _resolve_comfy_name(entry["lora"], available_loras, "LoRA")
    except (KeyError, TypeError) as exc:
        raise ValueError("MiniMax H3 Test Bench workflow is missing required model inputs.") from exc
    return workflow


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
    workflow = copy.deepcopy(template)
    if settings is None:
        selected = _template_test_settings(template)
        selected["seed"] = _workflow_seed(template)
    else:
        selected = settings
    try:
        prompt_inputs = workflow["146"]["inputs"]
        prompt_inputs["wildcard_text"] = prompt
        prompt_inputs["populated_text"] = prompt
        prompt_inputs["mode"] = "fixed"
        lora_inputs = workflow["148"]["inputs"]
        lora_inputs["lora_name"] = comfy_lora_name
        lora_inputs["strength_model"] = strength_model
        lora_inputs["strength_clip"] = strength_clip
        workflow["115"]["inputs"]["aspect_ratio"] = selected["aspectRatio"]
        workflow["115"]["inputs"]["megapixels"] = selected["megapixels"]
        workflow["133"]["inputs"]["value"] = selected["duration"]
        workflow["129"]["inputs"]["noise_seed"] = selected["seed"]
        if filename_prefix:
            workflow["141"]["inputs"]["filename_prefix"] = str(filename_prefix)
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("MiniMax H3 Test Bench workflow is missing required test inputs.") from exc
    return workflow


def _find_video_ref(value):
    if isinstance(value, dict):
        filename = str(value.get("filename") or "")
        if filename.lower().endswith(".mp4"):
            return {
                "filename": filename,
                "subfolder": str(value.get("subfolder") or ""),
                "type": str(value.get("type") or "output"),
                "fullpath": str(value.get("fullpath") or ""),
            }
        for child in value.values():
            found = _find_video_ref(child)
            if found:
                return found
    elif isinstance(value, list):
        for child in value:
            found = _find_video_ref(child)
            if found:
                return found
    return None


def _queue_workflow(workflow):
    response = _read_json_response(COMFY_BASE_URL + "/prompt", method="POST", payload={"prompt": workflow})
    prompt_id = str(response.get("prompt_id") or "").strip() if isinstance(response, dict) else ""
    if not prompt_id:
        raise RuntimeError("ComfyUI did not return a prompt ID.")
    return prompt_id


def _wait_for_video(prompt_id, timeout=GENERATION_TIMEOUT_SECONDS):
    history_url = COMFY_BASE_URL + "/history/" + urllib.parse.quote(prompt_id, safe="")
    deadline = time.monotonic() + timeout
    while True:
        if time.monotonic() >= deadline:
            raise RuntimeError("Timed out waiting for ComfyUI to finish this generation.")
        history = _read_json_response(history_url)
        entry = history.get(prompt_id) if isinstance(history, dict) else None
        if isinstance(entry, dict):
            status = entry.get("status") if isinstance(entry.get("status"), dict) else {}
            status_text = str(status.get("status_str") or "").lower()
            if status_text == "error":
                raise RuntimeError("ComfyUI reported an execution error.")
            video_ref = _find_video_ref(entry.get("outputs") or {})
            if video_ref:
                return video_ref
            if status.get("completed") is True or status_text == "success":
                raise RuntimeError("ComfyUI completed the workflow without returning an MP4 output.")
        time.sleep(2)


def _comfy_saved_output_path(video_ref):
    if str(video_ref.get("type") or "") != "output":
        raise RuntimeError("ComfyUI Test output was not saved to the output directory.")
    raw_path = str(video_ref.get("fullpath") or "").strip()
    if not raw_path:
        raise RuntimeError("ComfyUI did not expose the saved Test video path.")
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
            raise RuntimeError("Could not resolve the saved ComfyUI video path.") from exc
        converted_path = (converted.stdout or "").strip()
        if converted.returncode == 0 and converted_path:
            path = Path(converted_path)
    if not path.is_file():
        raise FileNotFoundError("Saved ComfyUI Test video does not exist: " + raw_path)
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


def _download_video(video_ref):
    query = urllib.parse.urlencode({
        "filename": video_ref["filename"],
        "subfolder": video_ref.get("subfolder") or "",
        "type": video_ref.get("type") or "output",
    })
    return _read_bytes(COMFY_BASE_URL + "/view?" + query)


def _move_saved_video(video_ref, destination, filename_prefix=None):
    if str(video_ref.get("type") or "") != "output":
        raise RuntimeError("ComfyUI Test output was not saved to the output directory.")
    target = Path(destination)
    if target.exists():
        raise FileExistsError("Test result already exists: " + str(target))

    raw_path = str(video_ref.get("fullpath") or "").strip()
    if not raw_path:
        target.write_bytes(_download_video(video_ref))
        if not target.is_file():
            raise RuntimeError("Saved ComfyUI Test video was not copied into the Test session.")
        return target

    source = _comfy_saved_output_path(video_ref)
    source_directory = source.parent
    shutil.move(str(source), str(target))
    if not target.is_file():
        raise RuntimeError("Saved ComfyUI Test video was not moved into the Test session.")
    if filename_prefix:
        try:
            _cleanup_owned_comfy_directory(source_directory, filename_prefix)
        except (OSError, ValueError) as exc:
            app_config.debug_print("[test-generations] Could not clean owned ComfyUI output directory:", exc)
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


def _new_session_directory(folder_path):
    root = _session_root(folder_path)
    root.mkdir(parents=True, exist_ok=True)
    base = datetime.now().strftime("%Y-%m-%d_%H%M-h3")
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
        output_name = str(item.get("outputVideo") or "")
        if output_name in ratings:
            item["rating"] = ratings[output_name]
        enriched.append(item)
    visible["results"] = enriched
    return visible


def _candidate_rating_scores(folder_path):
    root = _session_root(folder_path)
    if not root.is_dir():
        return {}
    totals = {}
    for session in root.iterdir():
        if not session.is_dir() or not (session / "test.json").is_file():
            continue
        payload = _read_status(session) or {}
        results = payload.get("results") if isinstance(payload.get("results"), list) else []
        ratings = _session_rating_map(session)
        for result in results:
            if not isinstance(result, dict) or str(result.get("kind") or "") == "base":
                continue
            candidate_name = str(result.get("candidateFile") or result.get("sourceLoRA") or "").strip()
            output_name = str(result.get("outputVideo") or "").strip()
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
        sessions.append({
            "session": session.name,
            "name": str(payload.get("name") or ""),
            "status": str(payload.get("status") or ""),
            "completed": int(payload.get("completed") or 0),
            "failed": int(payload.get("failed") or 0),
            "total": int(payload.get("total") or 0),
            "resultFolder": str(payload.get("resultFolder") or ""),
        })
    return sessions


def open_session(folder_path, session_name):
    session = _session_directory(folder_path, session_name)
    return _with_session_ratings(session, _visible_session_status(folder_path, session))


def delete_session(folder_path, session_name):
    session = _session_directory(folder_path, session_name)
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
        "sessions": list_sessions(folder_path),
        "latest": _latest_status(folder_path),
    }


def _session_result_path(session_directory, file_name):
    name = str(file_name or "").strip()
    if not name or name in (".", "..") or "/" in name or "\\" in name:
        raise ValueError("Test result filename is invalid.")
    path = Path(session_directory) / name
    if path.exists() and (not path.is_file() or path.is_symlink()):
        raise RuntimeError("Test result is not a regular file: " + name)
    return path


def _remove_candidate_from_session(folder_path, session_name, candidate_name):
    session = _session_directory(folder_path, session_name)
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
        output_name = str(result.get("outputVideo") or "").strip()
        if output_name:
            video_path = _session_result_path(session, output_name)
            caption_path = _session_result_path(session, Path(output_name).with_suffix(".txt").name)
            if not video_path.is_file():
                raise FileNotFoundError("Test result video does not exist: " + output_name)
            if not caption_path.is_file():
                raise FileNotFoundError("Test result caption does not exist: " + caption_path.name)
            paths.extend([video_path, caption_path])

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


def _latest_status(folder_path):
    root = _session_root(folder_path)
    if not root.is_dir():
        return {"status": "idle"}
    sessions = sorted(
        [path for path in root.iterdir() if path.is_dir() and (path / "test.json").is_file()],
        key=lambda path: path.name.lower(),
        reverse=True,
    )
    for session in sessions:
        payload = _session_status(session)
        if payload:
            return payload
    return {"status": "idle"}


def _visible_status(folder_path):
    payload = _latest_status(folder_path)
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
    inputs = ((workflow.get("129") or {}).get("inputs") or {}) if isinstance(workflow, dict) else {}
    seed = inputs.get("noise_seed")
    try:
        return int(seed)
    except (TypeError, ValueError):
        return None


def _new_session_seed():
    return secrets.randbelow(2 ** 53)


def _result_paths(session_directory, lora_file, stem_override=None):
    raw_stem = str(stem_override or lora_file.stem)
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", raw_stem).strip("._") or "result"
    video = Path(session_directory) / (stem + ".mp4")
    caption = Path(session_directory) / (stem + ".txt")
    suffix = 2
    while video.exists() or caption.exists():
        video = Path(session_directory) / (stem + "-" + str(suffix) + ".mp4")
        caption = Path(session_directory) / (stem + "-" + str(suffix) + ".txt")
        suffix += 1
    return video, caption


def _stop_requested(folder_key):
    with _lock:
        return folder_key in _stop_requests


def _mark_stopped(session_directory):
    status = _read_status(session_directory) or {}
    status["status"] = "stopped"
    status["current"] = ""
    status["error"] = ""
    _atomic_write_json(_status_path(session_directory), status)
    return status


def _run_batch(folder_key, session_directory, loras, prompt, settings=None, template=None):
    status_file = _status_path(session_directory)
    try:
        template = copy.deepcopy(template) if template is not None else _load_template()
        candidates = []
        if loras:
            base_file, base_comfy_name = loras[0]
            candidates.append({
                "label": "Base",
                "file": base_file,
                "comfyName": base_comfy_name,
                "strengthModel": 0,
                "strengthClip": 0,
                "kind": "base",
            })
        for lora_file, comfy_lora_name in loras:
            candidates.append({
                "label": lora_file.name,
                "file": lora_file,
                "comfyName": comfy_lora_name,
                "strengthModel": 0.9,
                "strengthClip": 1,
                "kind": "lora",
            })

        for candidate_index, candidate in enumerate(candidates, start=1):
            if _stop_requested(folder_key):
                _mark_stopped(session_directory)
                return

            lora_file = candidate["file"]
            output_prefix = _candidate_output_prefix(session_directory, candidate_index, candidate)
            video_path = None
            caption_path = None
            status = _read_status(session_directory) or {}
            status["current"] = candidate["label"]
            _atomic_write_json(status_file, status)
            try:
                workflow = _workflow_for_lora(
                    template,
                    prompt,
                    candidate["comfyName"],
                    settings=settings,
                    strength_model=candidate["strengthModel"],
                    strength_clip=candidate["strengthClip"],
                    filename_prefix=output_prefix,
                )
                prompt_id = _queue_workflow(workflow)
                video_ref = _wait_for_video(prompt_id)
                video_path, caption_path = _result_paths(
                    session_directory,
                    lora_file,
                    stem_override="base" if candidate["kind"] == "base" else None,
                )
                _move_saved_video(video_ref, video_path, filename_prefix=output_prefix)
                caption_path.write_text(prompt, encoding="utf-8")
                status = _read_status(session_directory) or {}
                results = status.get("results") if isinstance(status.get("results"), list) else []
                result = {
                    "kind": candidate["kind"],
                    "sourceLoRA": candidate["label"],
                    "outputVideo": video_path.name,
                    "prompt": prompt,
                    "seed": _workflow_seed(workflow),
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
                _atomic_write_json(status_file, status)
            except Exception as exc:
                for owned_path in (caption_path, video_path):
                    if owned_path and Path(owned_path).is_file():
                        Path(owned_path).unlink()
                if _stop_requested(folder_key):
                    _mark_stopped(session_directory)
                    return
                status = _read_status(session_directory) or {}
                failures = status.get("failures") if isinstance(status.get("failures"), list) else []
                failures.append({"sourceLoRA": candidate["label"], "error": str(exc)})
                status["failures"] = failures
                status["failed"] = int(status.get("failed") or 0) + 1
                status["current"] = ""
                status["error"] = ""
                _atomic_write_json(status_file, status)

        status = _read_status(session_directory) or {}
        status["status"] = "stopped" if _stop_requested(folder_key) else "complete"
        status["current"] = ""
        _atomic_write_json(status_file, status)
    except Exception as exc:
        status = _read_status(session_directory) or {}
        status["status"] = "failed"
        status["current"] = ""
        status["error"] = str(exc)
        _atomic_write_json(status_file, status)
    finally:
        with _lock:
            _active_threads.pop(folder_key, None)
            _active_sessions.pop(folder_key, None)
            _stop_requests.discard(folder_key)



def queue_session_status(folder_path, session_name):
    return _visible_session_status(folder_path, _session_directory(folder_path, session_name))


def _build_queued_request(
    folder_path,
    prompt,
    aspect_ratio=None,
    megapixels=None,
    duration=None,
    seed=None,
    name=None,
    selected_files=None,
):
    prompt = str(prompt or "").strip()
    if not prompt:
        raise ValueError("A test prompt is required.")
    test_directory = _h3_test_directory(folder_path)
    loras = _selected_lora_files(test_directory, selected_files=selected_files)
    if not loras:
        raise ValueError("The H3 Test folder contains no .safetensors files.")
    session_name = str(name or "").strip()
    if len(session_name) > 120:
        raise ValueError("Test session name must be 120 characters or fewer.")
    template = _load_template()
    settings = _normalized_test_settings(
        template,
        aspect_ratio=aspect_ratio,
        megapixels=megapixels,
        duration=duration,
        seed=seed,
    )
    resolved_prompt = _resolve_wildcard_prompt(prompt, settings["seed"])
    return {
        "model": "h3",
        "name": session_name,
        "sourcePrompt": prompt,
        "resolvedPrompt": resolved_prompt,
        "selectedFiles": [path.name for path in loras],
        "seed": settings["seed"],
        "aspectRatio": settings["aspectRatio"],
        "megapixels": settings["megapixels"],
        "duration": settings["duration"],
        "total": len(loras) + 1,
    }


def enqueue(
    folder_path,
    prompt,
    aspect_ratio=None,
    megapixels=None,
    duration=None,
    seed=None,
    name=None,
    selected_files=None,
):
    request = _build_queued_request(
        folder_path,
        prompt,
        aspect_ratio=aspect_ratio,
        megapixels=megapixels,
        duration=duration,
        seed=seed,
        name=name,
        selected_files=selected_files,
    )
    from .training_runner import enqueue_test_response
    payload, status_code = enqueue_test_response(_relative_set_folder(folder_path), request)
    if status_code != 200 or not payload.get("ok"):
        raise RuntimeError(str(payload.get("error") or "Could not queue Test Generations."))
    return {
        "operation": "test_enqueue",
        "job": payload.get("job") or {},
        "queued": bool(payload.get("queued")),
        "latest": status(folder_path),
    }


def queued_jobs(folder_path):
    from .training_runner import queued_test_jobs_for_folder
    return {
        "operation": "test_queue",
        "jobs": queued_test_jobs_for_folder(_relative_set_folder(folder_path)),
    }


def start_queued(folder_path, request):
    request = dict(request or {})
    prompt = str(request.get("resolvedPrompt") or "").strip()
    source_prompt = str(request.get("sourcePrompt") or prompt).strip()
    if not prompt:
        raise ValueError("Queued Test Generations job has no resolved prompt.")
    session_name = str(request.get("name") or "").strip()
    folder_key = _folder_key(folder_path)

    with _lock:
        dead_keys = [key for key, thread in _active_threads.items() if not thread.is_alive()]
        for key in dead_keys:
            _active_threads.pop(key, None)
            _active_sessions.pop(key, None)
            _stop_requests.discard(key)
        active = _active_threads.get(folder_key)
        if active and active.is_alive():
            raise RuntimeError("This set already has an active Test Generations batch.")
        session_directory = _new_session_directory(folder_path)
        payload = {
            "status": "starting",
            "model": "h3",
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
            "seed": request.get("seed"),
            "aspectRatio": request.get("aspectRatio"),
            "megapixels": request.get("megapixels"),
            "duration": request.get("duration"),
            "results": [],
            "resultFolder": _relative_to_fs_root(session_directory),
        }
        _atomic_write_json(_status_path(session_directory), payload)

    try:
        test_directory = _h3_test_directory(folder_path)
        loras = _selected_lora_files(test_directory, selected_files=request.get("selectedFiles"))
        if not loras:
            raise ValueError("The H3 Test folder contains no queued .safetensors files.")
        _read_json_response(COMFY_BASE_URL + "/system_stats", timeout=3)
        resolved_loras = _resolve_comfy_loras(loras)
        template = _resolve_comfy_template_assets(_load_template())
        settings = _normalized_test_settings(
            template,
            aspect_ratio=request.get("aspectRatio"),
            megapixels=request.get("megapixels"),
            duration=request.get("duration"),
            seed=request.get("seed"),
        )
        payload["seed"] = settings["seed"]
        payload["aspectRatio"] = settings["aspectRatio"]
        payload["megapixels"] = settings["megapixels"]
        payload["duration"] = settings["duration"]
        payload["total"] = len(resolved_loras) + 1
        payload["status"] = "running"
        _atomic_write_json(_status_path(session_directory), payload)
        thread = threading.Thread(
            target=_run_batch,
            args=(folder_key, session_directory, resolved_loras, prompt, settings, template),
            name="webcap-h3-test-generations",
            daemon=True,
        )
        with _lock:
            _stop_requests.discard(folder_key)
            _active_sessions[folder_key] = session_directory
            _active_threads[folder_key] = thread
            thread.start()
        return payload
    except Exception as exc:
        payload["status"] = "failed"
        payload["error"] = str(exc)
        payload["current"] = ""
        _atomic_write_json(_status_path(session_directory), payload)
        return payload

def prepare(folder_path):
    template = _load_template()
    try:
        test_directory = _h3_test_directory(folder_path)
        loras = _lora_files(test_directory) if test_directory.is_dir() else []
    except ValueError:
        loras = []
    defaults = _template_test_settings(template)
    defaults["seed"] = _new_session_seed()
    aspect_options = list(TEST_ASPECT_RATIO_OPTIONS)
    return {
        "operation": "test_prepare",
        "model": "h3",
        "defaultPrompt": _default_prompt(template),
        "defaults": defaults,
        "aspectRatioOptions": aspect_options,
        "count": len(loras),
        "files": [path.name for path in loras],
        "candidateScores": _candidate_rating_scores(folder_path),
        "sessions": list_sessions(folder_path),
        "latest": status(folder_path),
    }


def status(folder_path):
    payload = _visible_status(folder_path)
    session_name = str(payload.get("session") or "").strip() if isinstance(payload, dict) else ""
    if not session_name:
        return payload
    return _with_session_ratings(_session_directory(folder_path, session_name), payload)


def stop(folder_path):
    folder_key = _folder_key(folder_path)
    with _lock:
        thread = _active_threads.get(folder_key)
        session_directory = _active_sessions.get(folder_key)
        if not thread or not thread.is_alive() or not session_directory:
            raise RuntimeError("No active Test Generations batch to stop.")
        _stop_requests.add(folder_key)
    status = _read_status(session_directory) or {}
    status["status"] = "stopping"
    _atomic_write_json(_status_path(session_directory), status)
    _interrupt_comfy()
    return status


def handle_request(folder_path, mode, selection_criteria=None):
    operation = str(mode or "").strip().lower()
    if operation == "test_prepare":
        return prepare(folder_path)
    if operation == "test_status":
        return status(folder_path)
    if operation == "test_sessions":
        return {"operation": "test_sessions", "sessions": list_sessions(folder_path)}
    if operation == "test_queue":
        return queued_jobs(folder_path)
    if operation == "test_open_session":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return open_session(folder_path, criteria.get("session"))
    if operation == "test_delete_session":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return delete_session(folder_path, criteria.get("session"))
    if operation == "test_stop":
        return stop(folder_path)
    if operation == "test_remove_candidate":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return remove_candidate(
            folder_path,
            criteria.get("fileName"),
            session_name=criteria.get("session"),
        )
    if operation == "test_enqueue":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return enqueue(
            folder_path,
            criteria.get("prompt"),
            aspect_ratio=criteria.get("aspectRatio"),
            megapixels=criteria.get("megapixels"),
            duration=criteria.get("duration"),
            seed=criteria.get("seed"),
            name=criteria.get("name"),
            selected_files=criteria.get("selectedFiles"),
        )
    raise ValueError("Unsupported Test Generations operation: " + operation)
