import copy
import io
import logging
import secrets
import threading
import time
from pathlib import Path

from . import inference_runtime
from .execution_queue import (
    cancel_queued as execution_cancel_queued,
    consume_terminal_job as execution_consume_terminal_job,
    get_job as execution_get_job,
    lane_snapshot as execution_lane_snapshot,
    recover_lane as execution_recover_lane,
    update_job as execution_update_job,
)
from .inference_models import get_inference_model
from .storyboard_store import (
    add_take_upload,
    finalize_generated_take,
    load_story,
    resolve_scene_generation_defaults,
    resolve_scene_loras,
    resolve_scene_shared_context,
    storyboard_root,
)


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


def generation_capabilities():
    model = get_inference_model("minimax_h3")
    inference_runtime.system_stats()
    template = model.load_template()
    available = model.available_lora_names(inference_runtime.available_names)
    resolved = model.resolve_assets(
        template,
        inference_runtime.available_names,
        inference_runtime.resolve_name,
    )
    base_loras = model.base_loras(resolved)
    base_keys = {str(name).replace("\\", "/").casefold() for name in base_loras}
    selectable = [
        name
        for name in available
        if str(name).replace("\\", "/").casefold() not in base_keys
    ]
    selectable.sort(key=lambda value: value.casefold())
    return {"loras": selectable, "baseLoras": base_loras}


def _scene_settings(scene, story=None):
    source_prompt = str(scene.get("prompt") or "").strip()
    if not source_prompt:
        raise ValueError("Scene generation prompt is empty.")
    shared_context = resolve_scene_shared_context(story or {}, scene)
    prompt = source_prompt
    if shared_context:
        from .h3_prompt_contract import inject_shared_context_into_rendered_prompt
        prompt = inject_shared_context_into_rendered_prompt(source_prompt, shared_context)

    resolved_defaults = resolve_scene_generation_defaults(story or {}, scene)
    aspect_ratio = resolved_defaults["aspectRatio"]
    megapixels = resolved_defaults["megapixels"]
    try:
        duration = float(scene.get("durationSeconds", 6))
    except (TypeError, ValueError) as exc:
        raise ValueError("Storyboard duration must be numeric.") from exc
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
        "sourcePrompt": source_prompt,
        "sharedContext": shared_context,
        "aspectRatio": aspect_ratio,
        "megapixels": megapixels,
        "duration": duration,
        "seed": seed,
        "seedMode": seed_mode,
        "references": copy.deepcopy(scene.get("references") or []),
        "loras": resolve_scene_loras(story or {}, scene),
    }


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


def _storyboard_request(settings):
    source_prompt = str(settings.get("sourcePrompt") or settings.get("prompt") or "").strip()
    prompt = str(settings.get("prompt") or "").strip()

    references = {}
    for reference in settings.get("references") or []:
        if not isinstance(reference, dict):
            continue
        role = str(reference.get("role") or "").strip()
        if role == "guide_frame":
            raise RuntimeError(
                "Guide-frame references are stored but are not yet supported by the H3 Storyboard generator."
            )
        if role not in ("first_frame", "last_frame"):
            continue
        media_path = str(reference.get("mediaPath") or "").strip()
        if media_path:
            references[role] = media_path

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
        "referenceRecords": copy.deepcopy(settings.get("references") or []),
        "workflowFile": "minimax_h3_inference_api.json",
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
    started = time.monotonic()
    uploaded = {}
    output_ref = None
    try:
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
        effective_input = model.effective_input(workflow)
        provider_job_id = inference_runtime.queue_workflow(workflow)
        execution_update_job(
            job_id,
            details={"providerJobId": provider_job_id, "providerStatus": "pending"},
        )
        output_ref = inference_runtime.wait_for_output(
            provider_job_id,
            job_id,
            model.find_output_ref,
        )
        media = inference_runtime.download_output(output_ref)
        elapsed_ms = int((time.monotonic() - started) * 1000)

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
                "durationSeconds": request["settings"]["duration"],
                "seed": request["settings"]["seed"],
                "seedMode": str(context.get("seedMode") or ""),
                "aspectRatio": request["settings"]["aspectRatio"],
                "megapixels": request["settings"]["megapixels"],
                "loras": request.get("loras") or [],
                "references": copy.deepcopy(context.get("referenceRecords") or []),
                "workflowProfile": "minimax_h3_inference_v1",
                "providerJobId": provider_job_id,
                "elapsedMs": elapsed_ms,
                "effectiveInput": effective_input,
            },
        )
        execution_update_job(job_id, details={"providerStatus": "completed"})
        return {"takeId": take["id"]}
    finally:
        if output_ref is not None:
            try:
                inference_runtime.cleanup_uploaded_inputs(
                    uploaded.values(),
                    output_ref,
                    owned_prefix=(
                        "webcap-storyboard/" + story_id + "/" + scene_id + "/" +
                        str(job_id) + "/references"
                    ),
                )
            except OSError as exc:
                _logger.warning("Could not remove temporary Storyboard ComfyUI references: %s", exc)
            try:
                inference_runtime.cleanup_saved_output(output_ref)
            except OSError as exc:
                _logger.warning("Could not remove captured Storyboard ComfyUI output: %s", exc)

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


def _storyboard_job(job_id, consume=False):
    job_id = str(job_id or "").strip()
    job = execution_get_job(job_id)
    metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
    if metadata.get("client") != "storyboard":
        raise ValueError("Inference job does not belong to Storyboard.")
    if consume and str(job.get("status") or "") in {"completed", "failed", "cancelled", "stopped", "interrupted"}:
        job = execution_consume_terminal_job(job_id)
    return job


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
            prompt_id = str(
                details.get("comfyJobId") or details.get("providerJobId") or ""
            ).strip()
            if prompt_id:
                try:
                    if not inference_runtime.cancel_job_and_wait(prompt_id):
                        from .inference_runner import hold_provider_cleanup
                        hold_provider_cleanup(
                            prompt_id,
                            (
                                "Queue paused: interrupted legacy Storyboard provider work "
                                "could not be confirmed stopped after restart."
                            ),
                        )
                        _logger.error(
                            "Interrupted legacy Storyboard provider job %s did not confirm cancellation.",
                            prompt_id,
                        )
                except Exception:
                    from .inference_runner import hold_provider_cleanup
                    hold_provider_cleanup(
                        prompt_id,
                        (
                            "Queue paused: interrupted legacy Storyboard provider work "
                            "could not be confirmed stopped after restart."
                        ),
                    )
                    _logger.exception(
                        "Could not cancel interrupted legacy Storyboard provider job %s.",
                        prompt_id,
                    )

        legacy = execution_lane_snapshot(LEGACY_EXECUTION_LANE, include_terminal=False)
        inference = execution_lane_snapshot(EXECUTION_LANE, include_terminal=True)
        migrated_legacy_ids = {
            str((item.get("metadata") or {}).get("migratedFromJobId") or "")
            for item in inference.get("jobs", [])
            if isinstance(item.get("metadata"), dict)
        }
        for job in legacy.get("jobs", []):
            if job.get("status") != "queued":
                continue
            legacy_job_id = str(job.get("id") or "")
            if legacy_job_id in migrated_legacy_ids:
                execution_cancel_queued(legacy_job_id)
                continue
            stored = execution_get_job(legacy_job_id, include_payload=True)
            try:
                migrated = _legacy_job_request(stored)
                if migrated is None:
                    raise RuntimeError("Legacy Storyboard queue job is missing its frozen generation payload.")
                story_id, scene_id, request = migrated
                from .inference_runner import enqueue_storyboard
                enqueue_storyboard(
                    request,
                    story_id,
                    scene_id,
                    label="Storyboard Take",
                    migrated_from_job_id=legacy_job_id,
                    deferred=True,
                )
            except Exception:
                _logger.exception(
                    "Could not migrate legacy Storyboard queue job %s; leaving it intact for manual recovery.",
                    legacy_job_id,
                )
                continue
            execution_cancel_queued(legacy_job_id)

        _startup_reconciled = True


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


def generation_status(job_id, consume=False):
    reconcile_startup()
    return _generation_job(_storyboard_job(job_id, consume=consume))


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

    job = _storyboard_job(job_id)
    from .inference_runner import action
    payload = action(
        operation,
        job_id=str(job.get("id") or ""),
        direction=direction,
    )
    return {"job": _generation_job(_storyboard_job(payload["job"]["jobId"]))}
