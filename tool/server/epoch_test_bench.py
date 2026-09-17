import copy
import json
import os
import re
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
_lock = threading.Lock()
_active_threads = {}


def _read_json_response(url, method="GET", payload=None, timeout=10):
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


def _relative_comfy_lora_name(path):
    segments = [segment for segment in re.split(r"[\\/]+", str(path)) if segment]
    lower = [segment.lower() for segment in segments]
    indices = [index for index, segment in enumerate(lower) if segment == "loras"]
    if not indices:
        raise ValueError("The configured H3 Test folder must be inside a ComfyUI models/loras directory.")
    relative = segments[indices[-1] + 1 :]
    if not relative:
        raise ValueError("Could not derive the ComfyUI LoRA name from the configured H3 Test folder.")
    return "/".join(relative)


def _workflow_for_lora(template, prompt, lora_path):
    workflow = copy.deepcopy(template)
    try:
        prompt_inputs = workflow["146"]["inputs"]
        prompt_inputs["wildcard_text"] = prompt
        prompt_inputs["populated_text"] = prompt
        prompt_inputs["mode"] = "fixed"
        lora_inputs = workflow["148"]["inputs"]
        lora_inputs["lora_name"] = _relative_comfy_lora_name(lora_path)
        lora_inputs["strength_model"] = 0.9
        lora_inputs["strength_clip"] = 1
    except (KeyError, TypeError) as exc:
        raise ValueError("MiniMax H3 Test Bench workflow is missing node 146 or node 148 inputs.") from exc
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


def _wait_for_video(prompt_id):
    history_url = COMFY_BASE_URL + "/history/" + urllib.parse.quote(prompt_id, safe="")
    while True:
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


def _run_batch(folder_key, session_directory, loras, prompt):
    status_file = _status_path(session_directory)
    template = _load_template()
    try:
        for lora_file in loras:
            status = _read_status(session_directory) or {}
            status["current"] = lora_file.name
            _atomic_write_json(status_file, status)
            workflow = _workflow_for_lora(template, prompt, lora_file)
            prompt_id = _queue_workflow(workflow)
            video_ref = _wait_for_video(prompt_id)
            video_bytes = _download_video(video_ref)
            video_path, caption_path = _result_paths(session_directory, lora_file)
            video_path.write_bytes(video_bytes)
            caption_path.write_text(prompt, encoding="utf-8")
            status = _read_status(session_directory) or {}
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


def prepare(folder_path):
    template = _load_template()
    test_directory = _h3_test_directory(folder_path)
    loras = _lora_files(test_directory)
    return {
        "operation": "test_prepare",
        "model": "h3",
        "defaultPrompt": _default_prompt(template),
        "count": len(loras),
        "files": [path.name for path in loras],
        "latest": _latest_status(folder_path),
    }


def status(folder_path):
    return _latest_status(folder_path)


def start(folder_path, prompt):
    prompt = str(prompt or "").strip()
    if not prompt:
        raise ValueError("A test prompt is required.")
    test_directory = _h3_test_directory(folder_path)
    loras = _lora_files(test_directory)
    if not loras:
        raise ValueError("The H3 Test folder contains no .safetensors files.")
    _read_json_response(COMFY_BASE_URL + "/system_stats", timeout=3)
    folder_key = str(Path(folder_path).resolve())
    with _lock:
        active = _active_threads.get(folder_key)
        if active and active.is_alive():
            return _latest_status(folder_path)
        session_directory = _new_session_directory(folder_path)
        payload = {
            "status": "running",
            "model": "h3",
            "prompt": prompt,
            "total": len(loras),
            "completed": 0,
            "failed": 0,
            "current": "",
            "error": "",
            "resultFolder": _relative_to_fs_root(session_directory),
        }
        _atomic_write_json(_status_path(session_directory), payload)
        thread = threading.Thread(
            target=_run_batch,
            args=(folder_key, session_directory, loras, prompt),
            name="webcap-h3-test-generations",
            daemon=True,
        )
        _active_threads[folder_key] = thread
        thread.start()
    return payload


def handle_request(folder_path, mode, selection_criteria=None):
    operation = str(mode or "").strip().lower()
    if operation == "test_prepare":
        return prepare(folder_path)
    if operation == "test_status":
        return status(folder_path)
    if operation == "test_start":
        criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
        return start(folder_path, criteria.get("prompt"))
    raise ValueError("Unsupported Test Generations operation: " + operation)
