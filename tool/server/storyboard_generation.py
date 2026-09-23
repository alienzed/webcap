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
from pathlib import Path

from . import config as app_config
from .storyboard_store import add_take_upload, finalize_generated_take, load_story, resolve_scene_loras, storyboard_root
from .execution_queue import (
    cancel_queued as execution_cancel_queued,
    claim_next as execution_claim_next,
    enqueue as execution_enqueue,
    finish_job as execution_finish_job,
    get_job as execution_get_job,
    lane_snapshot as execution_lane_snapshot,
    mark_running as execution_mark_running,
    pause_lane as execution_pause_lane,
    request_action as execution_request_action,
    reorder_job as execution_reorder_job,
    resume_lane as execution_resume_lane,
    update_job as execution_update_job,
)


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
EXECUTION_LANE = "storyboard-takes"
GPU_RESERVATION_OWNER = EXECUTION_LANE


def _reserve_gpu():
    from .training_runner import reserve_gpu_for_external_work
    if not reserve_gpu_for_external_work(GPU_RESERVATION_OWNER):
        raise RuntimeError("GPU is busy with Training, Test Generations, or another Storyboard generation.")


def _release_gpu():
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


def _multipart_image_request(url, image_path, subfolder):
    image_path = Path(image_path)
    boundary = "----WebCapStoryboard" + uuid.uuid4().hex
    crlf = "\r\n"
    parts = []

    def field(name, value):
        parts.append(("--" + boundary + crlf).encode("utf-8"))
        parts.append(('Content-Disposition: form-data; name="' + name + '"' + crlf + crlf).encode("utf-8"))
        parts.append(str(value).encode("utf-8"))
        parts.append(crlf.encode("utf-8"))

    parts.append(("--" + boundary + crlf).encode("utf-8"))
    parts.append((
        'Content-Disposition: form-data; name="image"; filename="' + image_path.name.replace('"', "") + '"' + crlf
        + "Content-Type: application/octet-stream" + crlf + crlf
    ).encode("utf-8"))
    parts.append(image_path.read_bytes())
    parts.append(crlf.encode("utf-8"))
    field("overwrite", "true")
    field("type", "input")
    field("subfolder", subfolder)
    parts.append(("--" + boundary + "--" + crlf).encode("utf-8"))
    body = b"".join(parts)
    content_type = "multipart/form-data; boundary=" + boundary

    curl_path = _windows_curl_path()
    if curl_path:
        command = [
            curl_path,
            "--silent",
            "--show-error",
            "--fail-with-body",
            "--max-time",
            "60",
            "--request",
            "POST",
            "--header",
            "Content-Type: " + content_type,
            "--data-binary",
            "@-",
            url,
        ]
        try:
            result = subprocess.run(
                command,
                input=body,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=65,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise RuntimeError("Could not upload the Storyboard reference image to ComfyUI.") from exc
        if result.returncode != 0:
            detail = (
                result.stdout.decode("utf-8", errors="replace").strip()
                or result.stderr.decode("utf-8", errors="replace").strip()
            )
            raise RuntimeError("ComfyUI reference upload failed: " + (detail or "curl.exe failed."))
        response_body = result.stdout
    else:
        request = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": content_type},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                response_body = response.read()
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
            raise RuntimeError("Could not upload the Storyboard reference image to ComfyUI.") from exc

    try:
        payload = json.loads(response_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("ComfyUI returned invalid reference-upload JSON.") from exc
    name = str(payload.get("name") or "").strip() if isinstance(payload, dict) else ""
    returned_subfolder = str(payload.get("subfolder") or "").strip() if isinstance(payload, dict) else ""
    if not name:
        raise RuntimeError("ComfyUI did not return the uploaded reference image name.")
    return (returned_subfolder.rstrip("/\\") + "/" + name) if returned_subfolder else name


def _resolve_story_reference_path(story_id, media_path):
    raw = str(media_path or "").strip()
    relative = Path(raw)
    if not raw or relative.is_absolute() or ".." in relative.parts:
        raise RuntimeError("Storyboard reference media path is invalid.")
    story_dir = (storyboard_root() / str(story_id)).resolve()
    resolved = (story_dir / relative).resolve()
    if resolved != story_dir and story_dir not in resolved.parents:
        raise RuntimeError("Storyboard reference media path escapes its Story folder.")
    if not resolved.is_file():
        raise FileNotFoundError("Storyboard reference media file does not exist.")
    return resolved


def _upload_scene_references(story_id, job_id, references):
    mapped = {}
    for reference in references:
        if not isinstance(reference, dict):
            continue
        role = str(reference.get("role") or "").strip()
        if role == "guide_frame":
            raise RuntimeError("Guide-frame references are stored but are not yet supported by the H3 Storyboard generator.")
        if role not in ("first_frame", "last_frame"):
            continue
        media_path = _resolve_story_reference_path(story_id, reference.get("mediaPath"))
        subfolder = "webcap-storyboard/" + story_id + "/" + job_id
        mapped[role] = _multipart_image_request(COMFY_BASE_URL + "/upload/image", media_path, subfolder)
    return mapped


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


def generation_capabilities():
    template = _load_template()
    available = _available_comfy_names("LoraLoader", "lora_name", "LoRA")
    base_loras = []
    power_inputs = ((template.get("138") or {}).get("inputs") or {})
    for value in power_inputs.values():
        if not isinstance(value, dict) or value.get("on") is not True:
            continue
        configured = str(value.get("lora") or "").strip()
        if not configured:
            continue
        resolved = _resolve_comfy_name(configured, available, "LoRA")
        if resolved not in base_loras:
            base_loras.append(resolved)
    base_keys = {_normalize_name(name) for name in base_loras}
    selectable = [name for name in available if _normalize_name(name) not in base_keys]
    selectable.sort(key=lambda value: value.casefold())
    return {"loras": selectable, "baseLoras": base_loras}


def _scene_settings(scene, story=None):
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
    if duration < 4 or duration > 15:
        raise ValueError("MiniMax H3 Storyboard duration must be between 4 and 15 seconds.")

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
        "entryState": str(scene.get("entryState") or ""),
        "exitState": str(scene.get("exitState") or ""),
        "sourcePrompt": prompt,
        "wildcardsEnabled": bool(scene.get("wildcardsEnabled")),
        "aspectRatio": aspect_ratio,
        "megapixels": megapixels,
        "duration": duration,
        "seed": seed,
        "seedMode": seed_mode,
        "references": copy.deepcopy(scene.get("references") or []),
        "loras": resolve_scene_loras(story or {}, scene),
    }


def _resolve_wildcard_prompt(prompt, seed):
    response = _read_json_response(
        COMFY_BASE_URL + "/impact/wildcards",
        method="POST",
        payload={"text": str(prompt or ""), "seed": int(seed)},
        timeout=10,
    )
    resolved = str(response.get("text") or "").strip() if isinstance(response, dict) else ""
    if not resolved:
        raise RuntimeError("Impact Pack did not return a resolved Storyboard prompt.")
    return resolved


def _build_workflow(template, settings, filename_prefix, uploaded_references=None):
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

    selected_loras = settings.get("loras") or []
    if selected_loras:
        available_loras = _available_comfy_names("LoraLoader", "lora_name", "LoRA")
        existing = {
            _normalize_name(value.get("lora"))
            for value in power_inputs.values()
            if isinstance(value, dict) and value.get("on") is True and value.get("lora")
        }
        next_index = 2
        for item in selected_loras:
            resolved = _resolve_comfy_name(item.get("name"), available_loras, "LoRA")
            if _normalize_name(resolved) in existing:
                raise RuntimeError("Selected LoRA is already part of the base H3 workflow: " + resolved)
            while "lora_" + str(next_index) in power_inputs:
                next_index += 1
            power_inputs["lora_" + str(next_index)] = {
                "on": True,
                "lora": resolved,
                "strength": float(item.get("strength", 1.0)),
            }
            existing.add(_normalize_name(resolved))
            next_index += 1

    reference_nodes = {"first_frame": "190", "last_frame": "191"}
    for role, node_id in reference_nodes.items():
        image_name = str((uploaded_references or {}).get(role) or "").strip()
        if not image_name:
            continue
        workflow[node_id] = {
            "inputs": {"image": image_name},
            "class_type": "LoadImage",
            "_meta": {"title": "Storyboard " + role.replace("_", " ")},
        }
        workflow["131"]["inputs"][role] = [node_id, 0]
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


class StoryboardGenerationStopped(RuntimeError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


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


def _generation_job(job):
    if not isinstance(job, dict):
        return None
    metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
    details = job.get("details") if isinstance(job.get("details"), dict) else {}
    result = job.get("result") if isinstance(job.get("result"), dict) else {}
    return {
        "jobId": str(job.get("id") or ""),
        "storyId": str(metadata.get("storyId") or ""),
        "sceneId": str(metadata.get("sceneId") or ""),
        "status": str(job.get("status") or ""),
        "queuedAt": job.get("createdAt"),
        "startedAt": job.get("startedAt"),
        "completedAt": job.get("finishedAt"),
        "queuePosition": int(job.get("queuePosition") or 0),
        "comfyJobId": details.get("comfyJobId"),
        "comfyStatus": str(details.get("comfyStatus") or ""),
        "takeId": result.get("takeId"),
        "requestedAction": str(job.get("requestedAction") or ""),
        "error": str(job.get("error") or ""),
    }


def _wait_for_output(prompt_id, job_id):
    deadline = time.monotonic() + GENERATION_TIMEOUT_SECONDS
    missing_since = None
    while True:
        if time.monotonic() >= deadline:
            raise RuntimeError("Timed out waiting for ComfyUI to finish this Storyboard generation.")

        queue_job = execution_get_job(job_id)
        requested_action = str(queue_job.get("requestedAction") or "")
        if requested_action in ("stop", "cancel"):
            _cancel_comfy_job(prompt_id)
            status = "cancelled" if requested_action == "cancel" else "stopped"
            raise StoryboardGenerationStopped(status, "Storyboard Take generation " + status + ".")

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
        execution_update_job(job_id, details={"comfyStatus": status})
        if status in ("pending", "in_progress"):
            time.sleep(2)
            continue
        if status == "failed":
            raise RuntimeError(_format_comfy_error(job))
        if status == "cancelled":
            raise StoryboardGenerationStopped("cancelled", "ComfyUI cancelled this Storyboard generation.")
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


def _start_job_thread(job_id):
    job = execution_get_job(job_id, include_payload=True)
    payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}
    story_id = str(payload.get("storyId") or "")
    scene_id = str(payload.get("sceneId") or "")
    settings = copy.deepcopy(payload.get("settings") or {})
    if not story_id or not scene_id or not settings:
        raise RuntimeError("Storyboard execution job is missing its frozen generation payload.")

    thread = threading.Thread(
        target=_run_generation,
        args=(job_id, story_id, scene_id, settings),
        daemon=True,
        name="storyboard-generation-" + job_id[:8],
    )
    thread.start()


def _advance_queue():
    snapshot = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
    if snapshot.get("paused") or snapshot.get("activeJobId"):
        return None
    if not any(job.get("status") == "queued" for job in snapshot.get("jobs", [])):
        _release_gpu()
        return None

    try:
        _reserve_gpu()
    except RuntimeError:
        return None

    claimed = execution_claim_next(EXECUTION_LANE)
    if claimed is None:
        _release_gpu()
        return None

    job_id = str(claimed.get("id") or "")
    try:
        _start_job_thread(job_id)
    except Exception as exc:
        execution_finish_job(job_id, status="failed", error=str(exc))
        _release_gpu()
        app_config.debug_print("[storyboard-generation] COULD NOT START QUEUED JOB:", exc)
        app_config.debug_traceback()
        return _advance_queue()
    return _generation_job(execution_get_job(job_id))


def _run_generation(job_id, story_id, scene_id, settings):
    try:
        execution_mark_running(job_id, details={"comfyStatus": "starting"})
        filename_prefix = "webcap-storyboard/" + story_id + "/" + scene_id + "/" + job_id + "/render"
        if settings.get("wildcardsEnabled"):
            settings = dict(settings)
            settings["prompt"] = _resolve_wildcard_prompt(settings["prompt"], settings["seed"])
        uploaded_references = _upload_scene_references(story_id, job_id, settings.get("references") or [])
        workflow = _build_workflow(_load_template(), settings, filename_prefix, uploaded_references=uploaded_references)
        prompt_id = _queue_workflow(workflow)
        execution_update_job(job_id, details={"comfyJobId": prompt_id, "comfyStatus": "pending"})
        output_ref = _wait_for_output(prompt_id, job_id)
        media = _download_output(output_ref)

        story, take = add_take_upload(
            story_id,
            scene_id,
            output_ref.get("filename") or "render.mp4",
            io.BytesIO(media),
            effective_loras=settings.get("loras") or [],
        )
        story, take = finalize_generated_take(
            story_id,
            scene_id,
            take["id"],
            {
                "prompt": settings["prompt"],
                "entryState": settings["entryState"],
                "exitState": settings["exitState"],
                "sourcePrompt": settings["sourcePrompt"],
                "wildcardsEnabled": settings["wildcardsEnabled"],
                "durationSeconds": settings["duration"],
                "seed": settings["seed"],
                "seedMode": settings["seedMode"],
                "aspectRatio": settings["aspectRatio"],
                "megapixels": settings["megapixels"],
                "loras": settings.get("loras") or [],
                "references": settings.get("references") or [],
                "workflowProfile": "minimax_h3_storyboard_v1",
                "providerJobId": prompt_id,
            },
        )
        execution_finish_job(
            job_id,
            status="completed",
            result={"takeId": take["id"]},
        )
        execution_update_job(job_id, details={"comfyStatus": "completed"})
    except StoryboardGenerationStopped as exc:
        execution_finish_job(job_id, status=exc.status, error=str(exc))
    except Exception as exc:
        app_config.debug_print("[storyboard-generation] ERROR:", exc)
        app_config.debug_traceback()
        execution_finish_job(job_id, status="failed", error=str(exc))
    finally:
        _release_gpu()
        _advance_queue()


def start_generation(story_id, scene_id):
    story = load_story(story_id)
    scene_id = str(scene_id or "").strip()
    scene = (story.get("scenes") or {}).get(scene_id)
    if not isinstance(scene, dict):
        raise FileNotFoundError("Scene does not exist.")
    settings = _scene_settings(scene, story)

    job = execution_enqueue(
        EXECUTION_LANE,
        {
            "storyId": story_id,
            "sceneId": scene_id,
            "settings": settings,
        },
        metadata={
            "kind": "storyboard-take",
            "storyId": story_id,
            "sceneId": scene_id,
        },
    )
    _advance_queue()
    return _generation_job(execution_get_job(job["id"]))


def generation_status(job_id):
    _advance_queue()
    return _generation_job(execution_get_job(str(job_id or "").strip()))


def generation_queue(story_id=""):
    _advance_queue()
    story_id = str(story_id or "").strip()
    snapshot = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
    jobs = [_generation_job(job) for job in snapshot.get("jobs", [])]
    if story_id:
        jobs = [job for job in jobs if job.get("storyId") == story_id]
    return {
        "paused": bool(snapshot.get("paused")),
        "pauseReason": str(snapshot.get("pauseReason") or ""),
        "activeJobId": str(snapshot.get("activeJobId") or ""),
        "jobs": jobs,
    }


def generation_action(operation, job_id="", direction=""):
    operation = str(operation or "").strip()
    job_id = str(job_id or "").strip()
    if operation == "cancel":
        job = execution_cancel_queued(job_id)
        _advance_queue()
        return {"job": _generation_job(job)}
    if operation == "stop":
        job = execution_request_action(job_id, "stop")
        return {"job": _generation_job(job)}
    if operation == "pause_queue":
        snapshot = execution_pause_lane(EXECUTION_LANE)
        return {"queue": generation_queue(), "paused": bool(snapshot.get("paused"))}
    if operation == "resume_queue":
        execution_resume_lane(EXECUTION_LANE)
        _advance_queue()
        return {"queue": generation_queue()}
    if operation == "reorder":
        snapshot = execution_reorder_job(job_id, direction=direction)
        return {"queue": {
            "paused": bool(snapshot.get("paused")),
            "pauseReason": str(snapshot.get("pauseReason") or ""),
            "activeJobId": str(snapshot.get("activeJobId") or ""),
            "jobs": [_generation_job(job) for job in snapshot.get("jobs", []) if job.get("status") not in ("completed", "failed", "cancelled", "stopped", "interrupted")],
        }}
    raise ValueError("Unsupported Storyboard generation action: " + operation)
