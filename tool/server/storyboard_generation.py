import copy
import io
import json
import logging
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
from . import inference_runtime
from .inference_models import get_inference_model
from .execution_queue import (
    cancel_queued as execution_cancel_queued,
    claim_next as execution_claim_next,
    enqueue as execution_enqueue,
    finish_job as execution_finish_job,
    get_job as execution_get_job,
    lane_snapshot as execution_lane_snapshot,
    mark_running as execution_mark_running,
    request_stop as execution_request_stop,
    recover_lane as execution_recover_lane,
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
EXECUTION_LANE = "inference"
LEGACY_EXECUTION_LANE = "storyboard-takes"
_reconcile_lock = threading.Lock()
_startup_reconciled = False
_logger = logging.getLogger(__name__)


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
        "comfyJobId": details.get("providerJobId"),
        "comfyStatus": str(details.get("providerStatus") or ""),
        "takeId": result.get("takeId"),
        "requestedAction": str(job.get("requestedAction") or ""),
        "error": str(job.get("error") or ""),
    }


def _storyboard_request(settings):
    source_prompt = str(settings.get("sourcePrompt") or settings.get("prompt") or "").strip()
    prompt = str(settings.get("prompt") or "").strip()
    if settings.get("wildcardsEnabled"):
        prompt = inference_runtime.resolve_wildcard_prompt(source_prompt, settings["seed"])

    references = {}
    for reference in settings.get("references") or []:
        if not isinstance(reference, dict):
            continue
        role = str(reference.get("role") or "").strip()
        if role == "guide_frame":
            raise RuntimeError("Guide-frame references are stored but are not yet supported by the H3 Storyboard generator.")
        if role not in ("first_frame", "last_frame"):
            continue
        references[role] = str(reference.get("mediaPath") or "").strip()

    return {
        "modelId": "minimax_h3",
        "mediaKind": "video",
        "sourcePrompt": source_prompt,
        "prompt": prompt,
        "settings": {
            "aspectRatio": settings["aspectRatio"],
            "megapixels": settings["megapixels"],
            "duration": settings["duration"],
            "seed": settings["seed"],
        },
        "loras": copy.deepcopy(settings.get("loras") or []),
        "references": references,
        "wildcardsEnabled": bool(settings.get("wildcardsEnabled")),
        "workflowFile": "minimax_h3_storyboard_api.json",
        "entryState": str(settings.get("entryState") or ""),
        "exitState": str(settings.get("exitState") or ""),
        "seedMode": str(settings.get("seedMode") or ""),
    }


def execute_inference(job_id, request, context):
    story_id = str(context.get("storyId") or "").strip()
    scene_id = str(context.get("sceneId") or "").strip()
    if not story_id or not scene_id:
        raise RuntimeError("Storyboard inference is missing its Story or Scene context.")

    model = get_inference_model(request.get("modelId"))
    template = model.load_template()
    uploaded = {}
    for role, relative_path in (request.get("references") or {}).items():
        source = _resolve_story_reference_path(story_id, relative_path)
        uploaded[role] = inference_runtime.upload_image(
            source,
            "webcap-storyboard/" + story_id + "/" + scene_id + "/" + str(job_id) + "/references",
            filename=source.name,
        )

    filename_prefix = "webcap-storyboard/" + story_id + "/" + scene_id + "/" + str(job_id) + "/render"
    workflow = model.build_workflow(
        template,
        request["prompt"],
        copy.deepcopy(request["settings"]),
        copy.deepcopy(request.get("loras") or []),
        uploaded,
        filename_prefix,
        inference_runtime.available_names,
        inference_runtime.resolve_name,
    )
    provider_job_id = inference_runtime.queue_workflow(workflow)
    execution_update_job(job_id, details={"providerJobId": provider_job_id, "providerStatus": "pending"})
    output_ref = inference_runtime.wait_for_output(provider_job_id, job_id, model.find_output_ref)
    media = inference_runtime.download_output(output_ref)

    _story, take = add_take_upload(
        story_id,
        scene_id,
        output_ref.get("filename") or "render.mp4",
        io.BytesIO(media),
        effective_loras=request.get("loras") or [],
    )
    _story, take = finalize_generated_take(
        story_id,
        scene_id,
        take["id"],
        {
            "prompt": request["prompt"],
            "entryState": str(context.get("entryState") or ""),
            "exitState": str(context.get("exitState") or ""),
            "sourcePrompt": request.get("sourcePrompt") or request["prompt"],
            "wildcardsEnabled": bool(request.get("wildcardsEnabled")),
            "durationSeconds": request["settings"]["duration"],
            "seed": request["settings"]["seed"],
            "seedMode": str(context.get("seedMode") or ""),
            "aspectRatio": request["settings"]["aspectRatio"],
            "megapixels": request["settings"]["megapixels"],
            "loras": request.get("loras") or [],
            "references": [
                {"role": role, "mediaPath": path}
                for role, path in (request.get("references") or {}).items()
            ],
            "workflowProfile": "minimax_h3_storyboard_v1",
            "providerJobId": provider_job_id,
        },
    )
    execution_update_job(job_id, details={"providerStatus": "completed"})
    return {"takeId": take["id"]}


def _legacy_job_request(job):
    payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}
    settings = payload.get("settings") if isinstance(payload.get("settings"), dict) else {}
    story_id = str(payload.get("storyId") or "").strip()
    scene_id = str(payload.get("sceneId") or "").strip()
    if not story_id or not scene_id or not settings:
        return None
    return story_id, scene_id, _storyboard_request(copy.deepcopy(settings))


def reconcile_startup():
    global _startup_reconciled
    if _startup_reconciled:
        return
    with _reconcile_lock:
        if _startup_reconciled:
            return

        interrupted = execution_recover_lane(
            LEGACY_EXECUTION_LANE,
            reason="Legacy Storyboard Take generation was interrupted by a WebCap restart.",
        )
        for job in interrupted:
            details = job.get("details") if isinstance(job.get("details"), dict) else {}
            prompt_id = str(details.get("comfyJobId") or details.get("providerJobId") or "").strip()
            if prompt_id:
                try:
                    inference_runtime.cancel_job(prompt_id)
                except Exception:
                    _logger.exception("Could not cancel interrupted legacy Storyboard provider job %s.", prompt_id)

        legacy = execution_lane_snapshot(LEGACY_EXECUTION_LANE, include_terminal=False)
        for job in legacy.get("jobs", []):
            if job.get("status") != "queued":
                continue
            migrated = _legacy_job_request(execution_get_job(job["id"], include_payload=True))
            if migrated is None:
                execution_cancel_queued(job["id"])
                continue
            story_id, scene_id, request = migrated
            from .inference_runner import enqueue_storyboard
            enqueue_storyboard(request, story_id, scene_id, label="Storyboard Take")
            execution_cancel_queued(job["id"])

        _startup_reconciled = True


def start_observer():
    reconcile_startup()


def start_generation(story_id, scene_id):
    reconcile_startup()
    story = load_story(story_id)
    scene_id = str(scene_id or "").strip()
    scene = (story.get("scenes") or {}).get(scene_id)
    if not isinstance(scene, dict):
        raise FileNotFoundError("Scene does not exist.")

    settings = _scene_settings(scene, story)
    request = _storyboard_request(settings)
    from .inference_runner import enqueue_storyboard
    job = enqueue_storyboard(
        request,
        story_id,
        scene_id,
        label=str(scene.get("title") or "Storyboard Take"),
    )
    return generation_status(job["jobId"])


def generation_status(job_id):
    reconcile_startup()
    job = execution_get_job(str(job_id or "").strip())
    return _generation_job(job)


def generation_queue(story_id=""):
    reconcile_startup()
    story_id = str(story_id or "").strip()
    snapshot = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
    jobs = [
        _generation_job(job)
        for job in snapshot.get("jobs", [])
        if isinstance(job.get("metadata"), dict)
        and job["metadata"].get("client") == "storyboard"
    ]
    if story_id:
        jobs = [job for job in jobs if job.get("storyId") == story_id]
    return {
        "paused": bool(snapshot.get("paused")),
        "pauseReason": str(snapshot.get("pauseReason") or ""),
        "activeJobId": str(snapshot.get("activeJobId") or ""),
        "jobs": jobs,
    }


def generation_action(operation, job_id="", direction=""):
    reconcile_startup()
    operation = str(operation or "").strip()
    if operation not in {"cancel", "stop"}:
        raise ValueError("Unsupported Storyboard generation action: " + operation)
    from .inference_runner import action
    payload = action(operation, job_id=str(job_id or "").strip(), direction=direction)
    return {"job": _generation_job(execution_get_job(payload["job"]["jobId"]))}
