import copy
import json
import os
import re
import secrets
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

from . import config as app_config
from .training_history import host_path_for_training_path

COMFY_BASE_URL = "http://127.0.0.1:8188"
TEMPLATE_PATH = Path(__file__).resolve().parents[1] / "templates" / "comfyui" / "minimax_h3_test_api.json"
TEST_RESULTS_DIR = "test-generations"
GENERATION_TIMEOUT_SECONDS = 45 * 60
GPU_RESERVATION_OWNER = "test-generations"
_lock = threading.Lock()
_active_threads = {}


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
    prompt = str(inputs.get("populated_text") or inputs.get("wildcard_text") or "").strip()
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


def _resolution_aspect_ratio_options():
    try:
        payload = _read_json_response(COMFY_BASE_URL + "/object_info/ResolutionSelector", timeout=3)
        node = payload.get("ResolutionSelector") if isinstance(payload, dict) else None
        inputs = node.get("input") if isinstance(node, dict) and isinstance(node.get("input"), dict) else {}
        required = inputs.get("required") if isinstance(inputs.get("required"), dict) else {}
        spec = required.get("aspect_ratio")
        choices = spec[0] if isinstance(spec, (list, tuple)) and spec else None
        if isinstance(choices, (list, tuple)):
            return [str(value) for value in choices if str(value).strip()]
    except RuntimeError:
        pass
    return []


def _normalized_test_settings(template, aspect_ratio=None, megapixels=None, duration=None, seed=None):
    defaults = _template_test_settings(template)
    selected_aspect = str(aspect_ratio or defaults["aspectRatio"]).strip()
    if not selected_aspect:
        raise ValueError("A test aspect ratio is required.")
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


def _h3_test_directory(folder_path):
    saved_config = app_config.load_config_from_disk()
    training = saved_config.get("training") if isinstance(saved_config.get("training"), dict) else {}
    roots = training.get("test_copy_roots") if isinstance(training.get("test_copy_roots"), dict) else {}
    root_text = str(roots.get("h3") or "").strip()
    if not root_text:
        raise ValueError("Configure the Copy to Test H3 root in Training Settings.")
    root = Path(host_path_for_training_path(root_text))
    subfolder = str(training.get("test_copy_subfolder") or "").strip()
    set_name = Path(folder_path).name
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


def _workflow_for_lora(template, prompt, comfy_lora_name, settings=None):
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
        lora_inputs["strength_model"] = 0.9
        lora_inputs["strength_clip"] = 1
        workflow["115"]["inputs"]["aspect_ratio"] = selected["aspectRatio"]
        workflow["115"]["inputs"]["megapixels"] = selected["megapixels"]
        workflow["133"]["inputs"]["value"] = selected["duration"]
        workflow["129"]["inputs"]["noise_seed"] = selected["seed"]
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("MiniMax H3 Test Bench workflow is missing required test inputs.") from exc
    return workflow


def _find_video_ref(value):
    if isinstance(value, dict):
        filename = str(value.get("filename") or "")
        if filename.lower().endswith(".mp4"):
            return {"filename": filename, "subfolder": str(value.get("subfolder") or ""), "type": str(value.get("type") or "output")}
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


def _download_video(video_ref):
    query = urllib.parse.urlencode({
        "filename": video_ref["filename"],
        "subfolder": video_ref.get("subfolder") or "",
        "type": video_ref.get("type") or "output",
    })
    return _read_bytes(COMFY_BASE_URL + "/view?" + query)


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


def _new_session_directory(folder_path):
    root = Path(folder_path) / TEST_RESULTS_DIR
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


def _latest_status(folder_path):
    root = Path(folder_path) / TEST_RESULTS_DIR
    if not root.is_dir():
        return {"status": "idle"}
    sessions = sorted(
        [path for path in root.iterdir() if path.is_dir() and (path / "test.json").is_file()],
        key=lambda path: path.name.lower(), reverse=True,
    )
    for session in sessions:
        payload = _read_status(session)
        if payload:
            return payload
    return {"status": "idle"}


def _visible_status(folder_path):
    payload = _latest_status(folder_path)
    if payload.get("status") != "running":
        return payload
    folder_key = str(Path(folder_path).resolve())
    with _lock:
        thread = _active_threads.get(folder_key)
        if thread and thread.is_alive():
            return payload
        _active_threads.pop(folder_key, None)
    interrupted = dict(payload)
    interrupted["status"] = "interrupted"
    interrupted["current"] = ""
    interrupted["error"] = "Test run was interrupted because WebCap restarted."
    return interrupted


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


def _result_paths(session_directory, lora_file):
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", lora_file.stem).strip("._") or "result"
    video = Path(session_directory) / (stem + ".mp4")
    caption = Path(session_directory) / (stem + ".txt")
    suffix = 2
    while video.exists() or caption.exists():
        video = Path(session_directory) / (stem + "-" + str(suffix) + ".mp4")
        caption = Path(session_directory) / (stem + "-" + str(suffix) + ".txt")
        suffix += 1
    return video, caption


def _run_batch(folder_key, session_directory, loras, prompt, settings=None, template=None):
    status_file = _status_path(session_directory)
    try:
        template = copy.deepcopy(template) if template is not None else _load_template()
        for lora_file, comfy_lora_name in loras:
            status = _read_status(session_directory) or {}
            status["current"] = lora_file.name
            _atomic_write_json(status_file, status)
            workflow = _workflow_for_lora(template, prompt, comfy_lora_name, settings=settings)
            prompt_id = _queue_workflow(workflow)
            video_ref = _wait_for_video(prompt_id)
            video_bytes = _download_video(video_ref)
            video_path, caption_path = _result_paths(session_directory, lora_file)
            video_path.write_bytes(video_bytes)
            caption_path.write_text(prompt, encoding="utf-8")
            status = _read_status(session_directory) or {}
            provenance = _staged_lora_provenance(lora_file)
            results = status.get("results") if isinstance(status.get("results"), list) else []
            result = {
                "sourceLoRA": lora_file.name,
                "outputVideo": video_path.name,
                "prompt": prompt,
                "seed": _workflow_seed(workflow),
            }
            if provenance:
                result["provenance"] = provenance
            results.append(result)
            status["results"] = results
            status["completed"] = int(status.get("completed") or 0) + 1
            status["current"] = ""
            _atomic_write_json(status_file, status)
        status = _read_status(session_directory) or {}
        status["status"] = "complete"
        status["current"] = ""
        _atomic_write_json(status_file, status)
    except Exception as exc:
        status = _read_status(session_directory) or {}
        status["status"] = "failed"
        status["failed"] = 1
        status["error"] = str(exc)
        _atomic_write_json(status_file, status)
    finally:
        with _lock:
            _active_threads.pop(folder_key, None)
        _release_gpu_for_test_generations()


def prepare(folder_path):
    template = _load_template()
    test_directory = _h3_test_directory(folder_path)
    loras = _lora_files(test_directory)
    defaults = _template_test_settings(template)
    defaults["seed"] = _new_session_seed()
    aspect_options = _resolution_aspect_ratio_options()
    if defaults["aspectRatio"] and defaults["aspectRatio"] not in aspect_options:
        aspect_options.insert(0, defaults["aspectRatio"])
    return {
        "operation": "test_prepare",
        "model": "h3",
        "defaultPrompt": _default_prompt(template),
        "defaults": defaults,
        "aspectRatioOptions": aspect_options,
        "count": len(loras),
        "files": [path.name for path in loras],
        "latest": _visible_status(folder_path),
    }


def status(folder_path):
    return _visible_status(folder_path)


def start(folder_path, prompt, aspect_ratio=None, megapixels=None, duration=None, seed=None):
    prompt = str(prompt or "").strip()
    if not prompt:
        raise ValueError("A test prompt is required.")
    test_directory = _h3_test_directory(folder_path)
    loras = _lora_files(test_directory)
    if not loras:
        raise ValueError("The H3 Test folder contains no .safetensors files.")
    _read_json_response(COMFY_BASE_URL + "/system_stats", timeout=3)
    resolved_loras = _resolve_comfy_loras(loras)
    template = _resolve_comfy_template_assets(_load_template())
    settings = _normalized_test_settings(
        template,
        aspect_ratio=aspect_ratio,
        megapixels=megapixels,
        duration=duration,
        seed=seed,
    )
    folder_key = str(Path(folder_path).resolve())
    with _lock:
        dead_keys = [key for key, thread in _active_threads.items() if not thread.is_alive()]
        for key in dead_keys:
            _active_threads.pop(key, None)
        active = _active_threads.get(folder_key)
        if active and active.is_alive():
            return _latest_status(folder_path)
    if not _reserve_gpu_for_test_generations():
        raise RuntimeError("GPU is busy with managed training or another Test Generations batch.")
    try:
        with _lock:
            session_directory = _new_session_directory(folder_path)
            payload = {
                "status": "running",
                "model": "h3",
                "prompt": prompt,
                "total": len(resolved_loras),
                "completed": 0,
                "failed": 0,
                "current": "",
                "error": "",
                "seed": settings["seed"],
                "aspectRatio": settings["aspectRatio"],
                "megapixels": settings["megapixels"],
                "duration": settings["duration"],
                "results": [],
                "resultFolder": _relative_to_fs_root(session_directory),
            }
            _atomic_write_json(_status_path(session_directory), payload)
            thread = threading.Thread(
                target=_run_batch,
                args=(folder_key, session_directory, resolved_loras, prompt, settings, template),
                name="webcap-h3-test-generations",
                daemon=True,
            )
            _active_threads[folder_key] = thread
            thread.start()
    except Exception:
        _release_gpu_for_test_generations()
        raise
    return payload


def handle_request(folder_path, mode, selection_criteria=None):
    operation = str(mode or "").strip().lower()
    if operation == "test_prepare":
        return prepare(folder_path)
    if operation == "test_status":
        return status(folder_path)
    if operation == "test_start":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return start(
            folder_path,
            criteria.get("prompt"),
            aspect_ratio=criteria.get("aspectRatio"),
            megapixels=criteria.get("megapixels"),
            duration=criteria.get("duration"),
            seed=criteria.get("seed"),
        )
    raise ValueError("Unsupported Test Generations operation: " + operation)
