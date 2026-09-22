import copy
import io
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
import uuid
from datetime import datetime, timezone
from pathlib import Path

from . import config as app_config
from .storyboard_store import add_take_upload, finalize_generated_take, load_story


COMFY_BASE_URL = "http://127.0.0.1:8188"
TEMPLATE_PATH = Path(__file__).resolve().parents[1] / "templates" / "comfyui" / "minimax_h3_storyboard_api.json"
GENERATION_TIMEOUT_SECONDS = 45 * 60
ASPECT_RATIO_OPTIONS = (
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
_jobs = {}
_active_job_id = None


def _utc_now():
    return datetime.now(timezone.utc).isoformat()


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
        detail = (
            result.stdout.decode("utf-8", errors="replace").strip()
            or result.stderr.decode("utf-8", errors="replace").strip()
        )
        if result.returncode in (5, 6, 7, 28):
            raise ConnectionError(detail or "curl.exe could not reach ComfyUI.")
        raise RuntimeError("ComfyUI request failed: " + (detail or "curl.exe exited with code " + str(result.returncode) + "."))
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


def _read_bytes(url, timeout=60):
    curl_path = _windows_curl_path()
    if curl_path:
        try:
            return _windows_curl_request(curl_path, url, timeout=timeout)
        except (ConnectionError, RuntimeError) as exc:
            raise RuntimeError("Could not retrieve the ComfyUI Storyboard output.") from exc
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.read()
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
        raise RuntimeError("Could not retrieve the ComfyUI Storyboard output.") from exc


def _load_template():
    try:
        payload = json.loads(TEMPLATE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("Could not read the Storyboard H3 workflow template.") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("Storyboard H3 workflow template must be a JSON object.")
    return payload


def _normalize_name(value):
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
        raise RuntimeError("ComfyUI did not expose available " + label + " names for " + node_type + ".")
    names = [str(name) for name in choices if str(name).strip()]
    if not names:
        raise RuntimeError("ComfyUI reports no " + label + " files available to " + node_type + ".")
    return names


def _resolve_comfy_name(configured_name, available, label):
    configured = str(configured_name or "").strip()
    normalized = _normalize_name(configured)
    records = [
        (name, _normalize_name(name), Path(str(name).replace("\\", "/")).name.casefold())
        for name in available
    ]
    suffix_matches = [
        name for name, available_normalized, _ in records
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


def _resolve_template_assets(template):
    workflow = copy.deepcopy(template)
    specs = (
        ("127", "UNETLoader", "unet_name", "diffusion model"),
        ("128", "CLIPLoader", "clip_name", "CLIP model"),
        ("119", "VAELoader", "vae_name", "video VAE"),
        ("120", "VAELoader", "vae_name", "audio VAE"),
    )
    available_cache = {}
    for node_id, node_type, input_name, label in specs:
        inputs = workflow[node_id]["inputs"]
        cache_key = (node_type, input_name)
        if cache_key not in available_cache:
            available_cache[cache_key] = _available_comfy_names(node_type, input_name, label)
        inputs[input_name] = _resolve_comfy_name(inputs[input_name], available_cache[cache_key], label)

    power_inputs = workflow["138"]["inputs"]
    enabled_power_loras = [
        value for value in power_inputs.values()
        if isinstance(value, dict) and value.get("on") is True and str(value.get("lora") or "").strip()
    ]
    if enabled_power_loras:
        lora_names = _available_comfy_names("LoraLoader", "lora_name", "LoRA")
        for entry in enabled_power_loras:
            entry["lora"] = _resolve_comfy_name(entry["lora"], lora_names, "LoRA")
    return workflow


def _scene_settings(scene):
    prompt = str(scene.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("Scene generation prompt is empty.")

    aspect_ratio = str(scene.get("aspectRatio") or "4:3 (Standard)").strip()
    if aspect_ratio not in ASPECT_RATIO_OPTIONS:
        raise ValueError("Unsupported Storyboard aspect ratio: " + aspect_ratio)
    try:
        megapixels = float(scene.get("megapixels", 0.2))
        duration = float(scene.get("durationSeconds", 6))
    except (TypeError, ValueError) as exc:
        raise ValueError("Storyboard resolution and duration must be numeric.") from exc
    if megapixels <= 0:
        raise ValueError("Storyboard resolution must be greater than zero megapixels.")
    if duration <= 0:
        raise ValueError("Storyboard duration must be greater than zero seconds.")

    seed_mode = str(scene.get("seedMode") or "random").strip().lower()
    if seed_mode == "fixed":
        if scene.get("seed") in (None, ""):
            raise ValueError("Fixed seed mode requires a seed.")
        seed = int(scene.get("seed"))
    else:
        seed = secrets.randbelow(2 ** 32)
    if seed < 0 or seed > (2 ** 32) - 1:
        raise ValueError("Storyboard seed must be between 0 and 4294967295.")

    return {
        "prompt": prompt,
        "aspectRatio": aspect_ratio,
        "megapixels": megapixels,
        "duration": duration,
        "seed": seed,
        "seedMode": seed_mode,
    }


def _build_workflow(template, settings, filename_prefix):
    workflow = _resolve_template_assets(template)
    prompt_inputs = workflow["146"]["inputs"]
    prompt_inputs["wildcard_text"] = settings["prompt"]
    prompt_inputs["populated_text"] = settings["prompt"]
    prompt_inputs["mode"] = "fixed"
    prompt_inputs["seed"] = settings["seed"]
    workflow["115"]["inputs"]["aspect_ratio"] = settings["aspectRatio"]
    workflow["115"]["inputs"]["megapixels"] = settings["megapixels"]
    workflow["133"]["inputs"]["value"] = settings["duration"]
    workflow["129"]["inputs"]["noise_seed"] = settings["seed"]
    workflow["141"]["inputs"]["filename_prefix"] = filename_prefix

    power_inputs = workflow["138"]["inputs"]
    power_inputs["model"] = ["161", 0]
    power_inputs["clip"] = ["128", 0]
    workflow.pop("148", None)
    return workflow


def _find_output_ref(value):
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
            found = _find_output_ref(child)
            if found:
                return found
    elif isinstance(value, list):
        for child in value:
            found = _find_output_ref(child)
            if found:
                return found
    return None


def _queue_workflow(workflow):
    prompt_id = str(uuid.uuid4())
    response = _read_json_response(
        COMFY_BASE_URL + "/prompt",
        method="POST",
        payload={"prompt": workflow, "prompt_id": prompt_id},
    )
    returned_id = str(response.get("prompt_id") or "").strip() if isinstance(response, dict) else ""
    if returned_id != prompt_id:
        raise RuntimeError("ComfyUI did not accept the requested Storyboard job ID.")
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
        raise RuntimeError("ComfyUI returned invalid Storyboard job status.")
    return payload


def _format_comfy_error(job):
    error = job.get("execution_error") if isinstance(job, dict) and isinstance(job.get("execution_error"), dict) else {}
    message = str(error.get("exception_message") or "").strip()
    node_id = str(error.get("node_id") or "").strip()
    node_type = str(error.get("node_type") or "").strip()
    detail = message or "ComfyUI reported an execution error."
    node = " / ".join(value for value in (node_id, node_type) if value)
    return detail + ((" (" + node + ")") if node else "")


def _wait_for_output(prompt_id, job_id):
    deadline = time.monotonic() + GENERATION_TIMEOUT_SECONDS
    missing_since = None
    while True:
        if time.monotonic() >= deadline:
            raise RuntimeError("Timed out waiting for ComfyUI to finish this Storyboard generation.")
        job = _read_comfy_job(prompt_id)
        if job is None:
            if missing_since is None:
                missing_since = time.monotonic()
            if time.monotonic() - missing_since >= 10:
                raise RuntimeError("ComfyUI lost Storyboard job " + prompt_id + "; ComfyUI may have restarted.")
            time.sleep(2)
            continue
        missing_since = None
        status = str(job.get("status") or "").strip().lower()
        _update_job(job_id, comfyStatus=status)
        if status in ("pending", "in_progress"):
            time.sleep(2)
            continue
        if status == "failed":
            raise RuntimeError(_format_comfy_error(job))
        if status == "cancelled":
            raise RuntimeError("ComfyUI cancelled this Storyboard generation.")
        if status == "completed":
            output = _find_output_ref(job.get("outputs") or {})
            if not output:
                raise RuntimeError("ComfyUI completed the Storyboard workflow without an MP4 output.")
            return output
        raise RuntimeError("ComfyUI returned unknown Storyboard job status: " + (status or "empty") + ".")


def _download_output(output_ref):
    query = urllib.parse.urlencode({
        "filename": output_ref["filename"],
        "subfolder": output_ref.get("subfolder") or "",
        "type": output_ref.get("type") or "output",
    })
    return _read_bytes(COMFY_BASE_URL + "/view?" + query)


def _public_job(job):
    return dict(job) if isinstance(job, dict) else None


def _update_job(job_id, **fields):
    with _lock:
        current = _jobs.get(job_id)
        if current is None:
            return
        current.update(fields)


def _run_generation(job_id, story_id, scene_id, settings):
    global _active_job_id
    try:
        filename_prefix = "webcap-storyboard/" + story_id + "/" + scene_id + "/" + job_id + "/render"
        workflow = _build_workflow(_load_template(), settings, filename_prefix)
        prompt_id = _queue_workflow(workflow)
        _update_job(job_id, comfyJobId=prompt_id, comfyStatus="pending")
        output_ref = _wait_for_output(prompt_id, job_id)
        media = _download_output(output_ref)

        story, take = add_take_upload(
            story_id,
            scene_id,
            output_ref.get("filename") or "render.mp4",
            io.BytesIO(media),
        )
        story, take = finalize_generated_take(
            story_id,
            scene_id,
            take["id"],
            {
                "prompt": settings["prompt"],
                "durationSeconds": settings["duration"],
                "seed": settings["seed"],
                "seedMode": settings["seedMode"],
                "aspectRatio": settings["aspectRatio"],
                "megapixels": settings["megapixels"],
                "workflowProfile": "minimax_h3_storyboard_v1",
                "providerJobId": prompt_id,
            },
        )
        _update_job(
            job_id,
            status="completed",
            completedAt=_utc_now(),
            takeId=take["id"],
            comfyStatus="completed",
        )
    except Exception as exc:
        app_config.debug_print("[storyboard-generation] ERROR:", exc)
        app_config.debug_traceback()
        _update_job(job_id, status="failed", completedAt=_utc_now(), error=str(exc))
    finally:
        with _lock:
            if _active_job_id == job_id:
                _active_job_id = None


def start_generation(story_id, scene_id):
    global _active_job_id
    story = load_story(story_id)
    scene = (story.get("scenes") or {}).get(str(scene_id or "").strip())
    if not isinstance(scene, dict):
        raise FileNotFoundError("Scene does not exist.")
    settings = _scene_settings(scene)

    with _lock:
        if _active_job_id:
            active = _jobs.get(_active_job_id)
            if active and active.get("status") in ("queued", "running"):
                raise RuntimeError("A Storyboard generation is already running.")
            _active_job_id = None
        job_id = str(uuid.uuid4())
        _jobs[job_id] = {
            "jobId": job_id,
            "storyId": story_id,
            "sceneId": scene_id,
            "status": "running",
            "startedAt": _utc_now(),
            "completedAt": None,
            "comfyJobId": None,
            "comfyStatus": "starting",
            "takeId": None,
            "error": "",
        }
        _active_job_id = job_id

    thread = threading.Thread(
        target=_run_generation,
        args=(job_id, story_id, scene_id, settings),
        daemon=True,
        name="storyboard-generation-" + job_id[:8],
    )
    thread.start()
    return _public_job(_jobs[job_id])


def generation_status(job_id):
    with _lock:
        job = _jobs.get(str(job_id or "").strip())
        if job is None:
            raise FileNotFoundError("Storyboard generation job does not exist.")
        return _public_job(job)
