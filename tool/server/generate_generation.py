import copy
import logging
import re
import secrets
import time

from . import inference_runtime
from .generate_store import cleanup_references, persist_result, resolve_reference_path
from .execution_queue import update_job as execution_update_job
from .inference_models import get_inference_model, public_models

_logger = logging.getLogger(__name__)


def _new_seed():
    return secrets.randbelow(2 ** 32)


def _portable_name(value):
    return re.sub(r"[\\/]+", "/", str(value or ""))


def _public_model(model):
    template = model.load_template()
    available_loras = model.available_lora_names(inference_runtime.available_names)
    resolved = model.resolve_assets(template, inference_runtime.available_names, inference_runtime.resolve_name)
    base_loras = model.base_loras(resolved)
    base_keys = {_portable_name(value).casefold() for value in base_loras}
    selectable = [
        value for value in available_loras
        if _portable_name(value).casefold() not in base_keys
    ]
    selectable = [_portable_name(value) for value in selectable]
    base_loras = [_portable_name(value) for value in base_loras]
    selectable.sort(key=lambda value: value.casefold())
    options = model.setting_options(template, inference_runtime.available_names)
    return {
        "id": model.PROFILE_ID,
        "label": str(model.profile["label"]),
        "mediaKind": model.MEDIA_KIND,
        "settings": list(model.settings),
        "references": list(model.references),
        "default": bool(model.spec.get("default")),
        "defaultPrompt": "",
        "defaultSettings": model.normalize_settings(template, _new_seed, model.template_settings(template)),
        "settingOptions": options,
        "loras": selectable,
        "baseLoras": base_loras,
    }


def capabilities():
    models = []
    unavailable_models = []
    for item in public_models():
        model = get_inference_model(item["id"])
        try:
            models.append(_public_model(model))
        except Exception as exc:
            unavailable_models.append({
                "id": model.PROFILE_ID,
                "label": str(model.profile["label"]),
                "error": str(exc),
            })
    return {
        "models": models,
        "unavailableModels": unavailable_models,
    }


def prepare_request(data):
    if not isinstance(data, dict):
        raise ValueError("Generate request must be an object.")
    model = get_inference_model(data.get("modelId"))
    template = model.load_template()
    source_prompt = str(data.get("prompt") or "").strip()
    if not source_prompt:
        raise ValueError("Generate prompt is required.")

    settings = model.normalize_settings(
        template,
        _new_seed,
        data.get("settings") if isinstance(data.get("settings"), dict) else {},
    )
    loras = []
    for item in data.get("loras") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        try:
            strength = float(item.get("strength", 1.0))
        except (TypeError, ValueError) as exc:
            raise ValueError("LoRA strength must be numeric.") from exc
        loras.append({"name": name, "strength": strength})

    references = {}
    allowed_references = set(model.references)
    for role, relative_path in (data.get("references") or {}).items():
        role = str(role or "").strip()
        if role not in allowed_references:
            raise ValueError("Unsupported " + model.PROFILE_ID + " reference role: " + role)
        resolve_reference_path(relative_path)
        references[role] = str(relative_path)

    prompt = source_prompt
    wildcards_enabled = bool(data.get("wildcardsEnabled"))
    if wildcards_enabled:
        prompt = inference_runtime.resolve_wildcard_prompt(source_prompt, settings["seed"])

    return {
        "modelId": model.PROFILE_ID,
        "mediaKind": model.MEDIA_KIND,
        "sourcePrompt": source_prompt,
        "prompt": prompt,
        "settings": settings,
        "loras": loras,
        "references": references,
        "wildcardsEnabled": wildcards_enabled,
        "workflowFile": model.TEMPLATE_PATH.name,
    }


def execute(job_id, request):
    model = get_inference_model(request.get("modelId"))
    template = model.load_template()
    started = time.monotonic()
    uploaded = {}
    output_ref = None
    try:
        for role, relative_path in (request.get("references") or {}).items():
            source = resolve_reference_path(relative_path)
            uploaded[role] = inference_runtime.upload_image(
                source,
                "webcap-generate/" + str(job_id) + "/references",
                filename=source.name,
            )

        filename_prefix = "webcap-generate/" + str(job_id) + "/render"
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
        elapsed_ms = int((time.monotonic() - started) * 1000)
        return persist_result(
            job_id,
            request,
            output_ref,
            media,
            provider_job_id,
            elapsed_ms,
        )
    finally:
        try:
            cleanup_references(request.get("references") or {})
        except Exception:
            _logger.exception("Could not clean transient Generate reference uploads.")
        if output_ref is not None:
            try:
                inference_runtime.cleanup_saved_output(output_ref)
            except OSError as exc:
                _logger.warning("Could not remove captured Generate ComfyUI output: %s", exc)

