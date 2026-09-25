import copy
import json
import logging
import threading
import time

from .execution_queue import (
    cancel_queued as execution_cancel_queued,
    consume_terminal_job as execution_consume_terminal_job,
    claim_next as execution_claim_next,
    enqueue as execution_enqueue,
    finish_job as execution_finish_job,
    get_job as execution_get_job,
    lane_snapshot as execution_lane_snapshot,
    mark_running as execution_mark_running,
    pause_lane as execution_pause_lane,
    recover_lane as execution_recover_lane,
    reorder_job as execution_reorder_job,
    request_stop as execution_request_stop,
    resource_owner as execution_resource_owner,
    resume_lane as execution_resume_lane,
)


EXECUTION_LANE = "llm"
GPU_RESERVATION_OWNER = EXECUTION_LANE

_dispatch_lock = threading.Lock()
_enqueue_lock = threading.Lock()
_reconcile_lock = threading.Lock()
_startup_reconciled = False
_monitor_lock = threading.Lock()
_monitor_thread = None
_logger = logging.getLogger(__name__)


def _reserve_gpu():
    from .training_runner import reserve_gpu_for_external_work
    return reserve_gpu_for_external_work(GPU_RESERVATION_OWNER)


def _release_gpu():
    from .training_runner import release_gpu_for_external_work
    release_gpu_for_external_work(GPU_RESERVATION_OWNER)


def _job_view(job):
    if not isinstance(job, dict):
        return None
    metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
    result = job.get("result") if isinstance(job.get("result"), dict) else {}
    return {
        "jobId": str(job.get("id") or ""),
        "client": str(metadata.get("client") or ""),
        "label": str(metadata.get("label") or ""),
        "operation": str(metadata.get("operation") or ""),
        "modelId": str(metadata.get("modelId") or ""),
        "storyId": str(metadata.get("storyId") or ""),
        "sceneId": str(metadata.get("sceneId") or ""),
        "status": str(job.get("status") or ""),
        "queuePosition": int(job.get("queuePosition") or 0),
        "createdAt": job.get("createdAt"),
        "startedAt": job.get("startedAt"),
        "finishedAt": job.get("finishedAt"),
        "result": copy.deepcopy(result),
        "error": str(job.get("error") or ""),
    }


def _ensure_execution_reconciled():
    global _startup_reconciled
    if _startup_reconciled:
        return
    with _reconcile_lock:
        if _startup_reconciled:
            return
        execution_recover_lane(
            EXECUTION_LANE,
            reason="LLM execution was interrupted by a WebCap restart.",
        )
        _startup_reconciled = True


def reconcile_startup():
    _ensure_execution_reconciled()
    _ensure_monitor_started()


def _client_result(client, context, llm_result, job_id=""):
    if client == "generate":
        return {
            "result": llm_result["text"],
            "model": llm_result["model"],
            "usage": llm_result.get("usage"),
            "timings": llm_result.get("timings"),
        }

    if client != "storyboard":
        raise RuntimeError("Unsupported LLM client: " + (client or "empty"))

    story_id = str(context.get("storyId") or "").strip()
    operation = str(context.get("operation") or "").strip()
    if not story_id:
        raise RuntimeError("Storyboard LLM job is missing its Story ID.")

    if operation == "expand_concept":
        from .storyboard_store import apply_concept_expansion
        story = apply_concept_expansion(story_id, llm_result.get("text"))
        return {
            "storyId": story["id"],
            "result": story["concept"],
            "model": llm_result["model"],
            "usage": llm_result.get("usage"),
            "timings": llm_result.get("timings"),
        }

    if operation == "define_invariants":
        from .storyboard_store import apply_defined_invariants
        story, added_count = apply_defined_invariants(story_id, llm_result.get("data"))
        return {
            "storyId": story["id"],
            "addedCount": added_count,
            "model": llm_result["model"],
            "usage": llm_result.get("usage"),
            "timings": llm_result.get("timings"),
        }

    if operation == "repair_scenes":
        from .h3_prompt_contract import inject_shared_context_text, mode_from_reference_roles, render_base_prompt
        from .storyboard_store import (
            apply_scene_repairs,
            load_story,
            resolve_scene_invariant_context,
            resolve_scene_shared_context,
        )

        current_story = load_story(story_id)
        repair_payload = copy.deepcopy(llm_result.get("data"))
        if not isinstance(repair_payload, dict) or not isinstance(repair_payload.get("changes"), list):
            raise ValueError("Storyboard Scene repair response must contain a changes array.")
        repair_base = context.get("repairBase")
        base_order = repair_base.get("sceneOrder") if isinstance(repair_base, dict) else None
        if not isinstance(base_order, list):
            raise RuntimeError("Storyboard Scene repair is missing its frozen Scene order.")

        scenes = current_story.get("scenes") if isinstance(current_story.get("scenes"), dict) else {}
        for change in repair_payload["changes"]:
            if not isinstance(change, dict) or not isinstance(change.get("fields"), dict):
                continue
            fields = change["fields"]
            if "prompt" not in fields:
                continue
            prompt_data = fields.get("prompt")
            if not isinstance(prompt_data, dict):
                _logger.warning("Ignoring malformed optional Scene repair prompt patch; expected structured H3 content.")
                fields.pop("prompt", None)
                continue
            scene_number = change.get("sceneNumber")
            if isinstance(scene_number, bool) or not isinstance(scene_number, int):
                continue
            if scene_number < 1 or scene_number > len(base_order):
                continue
            scene_id = str(base_order[scene_number - 1] or "").strip()
            scene = scenes.get(scene_id)
            if not isinstance(scene, dict):
                raise RuntimeError("A Scene changed structurally while Check & Repair was running.")
            roles = [
                str(reference.get("role") or "").strip()
                for reference in scene.get("references") or []
                if isinstance(reference, dict)
            ]
            continuity = "\n".join(
                part
                for part in (
                    resolve_scene_invariant_context(current_story, scene),
                    resolve_scene_shared_context(current_story, scene),
                )
                if part
            )
            try:
                structured = inject_shared_context_text(prompt_data, continuity)
                fields["prompt"] = render_base_prompt(
                    structured,
                    mode=mode_from_reference_roles(roles),
                    duration=scene.get("durationSeconds"),
                )
            except (TypeError, ValueError) as exc:
                _logger.warning("Ignoring malformed optional Scene repair prompt patch: %s", exc)
                fields.pop("prompt", None)

        story, changed_scene_count, changed_field_count = apply_scene_repairs(
            story_id,
            repair_payload,
            repair_base,
            model_id=llm_result["model"],
            job_id=job_id,
        )
        return {
            "storyId": story["id"],
            "changedSceneCount": changed_scene_count,
            "changedFieldCount": changed_field_count,
            "model": llm_result["model"],
            "usage": llm_result.get("usage"),
            "timings": llm_result.get("timings"),
        }

    if operation == "develop_story":
        from .h3_prompt_contract import render_story_plan_prompts
        from .storyboard_generation import generation_queue
        from .storyboard_store import apply_developed_plan, load_story
        active_generation = generation_queue(story_id)
        if active_generation.get("jobs"):
            raise RuntimeError(
                "Story has pending Take generation. Stop or finish it before applying developed Scenes."
            )
        current_story = load_story(story_id)
        plan = render_story_plan_prompts(
            llm_result.get("data"),
            current_story.get("invariants"),
        )
        story = apply_developed_plan(
            story_id,
            plan,
            model_id=llm_result["model"],
        )
        return {
            "storyId": story["id"],
            "sceneCount": len(story.get("sceneOrder") or []),
            "model": llm_result["model"],
            "usage": llm_result.get("usage"),
            "timings": llm_result.get("timings"),
        }

    if operation in {"write_prompt", "refine_prompt"}:
        scene_id = str(context.get("sceneId") or "").strip()
        if not scene_id:
            raise RuntimeError("Storyboard Scene Director job is missing its Scene ID.")
        from .storyboard_store import apply_director_prompt
        story, scene = apply_director_prompt(
            story_id,
            scene_id,
            llm_result.get("text"),
            model_id=llm_result["model"],
            job_id=job_id,
            operation=operation,
            duration_override=llm_result.get("durationOverride"),
        )
        return {
            "storyId": story["id"],
            "sceneId": scene["id"],
            "result": scene["prompt"],
            "model": llm_result["model"],
            "usage": llm_result.get("usage"),
            "timings": llm_result.get("timings"),
        }

    raise RuntimeError("Unsupported Storyboard LLM operation: " + (operation or "empty"))


def _execute_claimed(job_id, gpu_reserved):
    stored = execution_get_job(job_id, include_payload=True)
    metadata = stored.get("metadata") if isinstance(stored.get("metadata"), dict) else {}
    payload = stored.get("payload") if isinstance(stored.get("payload"), dict) else {}
    contract = payload.get("contract") if isinstance(payload.get("contract"), dict) else None
    context = payload.get("clientContext") if isinstance(payload.get("clientContext"), dict) else {}
    model_id = str(metadata.get("modelId") or "").strip()
    client = str(metadata.get("client") or "").strip()
    if not model_id or contract is None:
        raise RuntimeError("LLM job is missing its frozen model or contract.")

    if client == "storyboard":
        metadata_story_id = str(metadata.get("storyId") or "").strip()
        context_story_id = str(context.get("storyId") or "").strip()
        metadata_scene_id = str(metadata.get("sceneId") or "").strip()
        context_scene_id = str(context.get("sceneId") or "").strip()
        metadata_operation = str(metadata.get("operation") or "").strip()
        context_operation = str(context.get("operation") or "").strip()
        contract_operation = str(contract.get("operation") or "").strip()
        if not context_story_id or metadata_story_id != context_story_id:
            raise RuntimeError("Storyboard LLM job Story identity is inconsistent.")
        if metadata_scene_id != context_scene_id:
            raise RuntimeError("Storyboard LLM job Scene identity is inconsistent.")
        if metadata_operation != context_operation or contract_operation != context_operation:
            raise RuntimeError("Storyboard LLM job operation identity is inconsistent.")

    running = execution_mark_running(job_id, details={"phase": "preparing"})
    if str(running.get("status") or "") == "stopping":
        execution_finish_job(job_id, status="stopped", error="LLM request stopped before execution.")
        return

    from .storyboard_llm_runtime import run_contract
    try:
        llm_result = run_contract(model_id, contract, gpu_reserved=bool(gpu_reserved))
    except Exception as exc:
        _logger.exception(
            "Director/model stage failed before WebCap ingest.\n"
            "--- FROZEN LLM CONTRACT ---\n%s",
            json.dumps(contract, indent=2, ensure_ascii=False),
        )
        raise RuntimeError(
            "Director/model stage failed before WebCap ingest: " + str(exc)
        ) from exc

    current = execution_get_job(job_id)
    if str(current.get("status") or "") == "stopping":
        execution_finish_job(job_id, status="stopped", error="LLM request stopped.")
        return

    try:
        result = _client_result(client, context, llm_result, job_id=job_id)
    except Exception as exc:
        _logger.exception(
            "WebCap ingest rejected a successful LLM response.\n"
            "--- FROZEN LLM CONTRACT ---\n%s\n"
            "--- CLIENT CONTEXT ---\n%s\n"
            "--- RAW MODEL RESPONSE ---\n%s",
            json.dumps(contract, indent=2, ensure_ascii=False),
            json.dumps(context, indent=2, ensure_ascii=False),
            str(llm_result.get("text") or ""),
        )
        raise RuntimeError(
            "WebCap ingest failed after a successful model response: " + str(exc)
        ) from exc

    execution_finish_job(job_id, status="completed", result=result)


def _advance_queue():
    _ensure_execution_reconciled()
    with _dispatch_lock:
        snapshot = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
        if snapshot.get("paused") or snapshot.get("activeJobId"):
            return None

        queued = [job for job in snapshot.get("jobs", []) if job.get("status") == "queued"]
        if not queued:
            return None

        from .storyboard_llm_runtime import uses_local_gpu
        local_gpu = uses_local_gpu()
        reserved_here = False
        if local_gpu:
            from .execution_queue import resource_owner
            if resource_owner():
                return None
            if not _reserve_gpu():
                return None
            reserved_here = True

        claimed = execution_claim_next(EXECUTION_LANE)
        if claimed is None:
            if reserved_here:
                _release_gpu()
            return None

        job_id = str(claimed.get("id") or "")
        release_gpu = local_gpu
        try:
            _execute_claimed(job_id, gpu_reserved=local_gpu)
        except Exception as exc:
            from .storyboard_llm_runtime import DirectorGpuHoldRequired
            if isinstance(exc, DirectorGpuHoldRequired):
                release_gpu = False
                execution_pause_lane(
                    EXECUTION_LANE,
                    reason="Queue paused: llama.cpp GPU state could not be confirmed safe after a failed LLM request.",
                )
            current = execution_get_job(job_id)
            current_status = str(current.get("status") or "")
            if current_status == "stopping":
                execution_finish_job(job_id, status="stopped", error="LLM request stopped.")
            elif current_status in {"starting", "running"}:
                execution_finish_job(job_id, status="failed", error=str(exc))
            _logger.exception("Queued LLM job failed.")
        finally:
            if release_gpu:
                _release_gpu()

        return _job_view(execution_get_job(job_id))


def _monitor_has_work():
    snapshot = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
    if snapshot.get("activeJobId"):
        return True
    if snapshot.get("paused"):
        return False
    return any(str(job.get("status") or "") == "queued" for job in snapshot.get("jobs", []))


def _monitor_loop():
    global _monitor_thread
    while True:
        try:
            _advance_queue()
        except Exception:
            _logger.exception("LLM queue monitor failed.")

        with _monitor_lock:
            if not _monitor_has_work():
                _monitor_thread = None
                return
        time.sleep(1)


def _ensure_monitor_started():
    global _monitor_thread
    with _monitor_lock:
        if _monitor_thread and _monitor_thread.is_alive():
            return
        _monitor_thread = threading.Thread(
            target=_monitor_loop,
            name="webcap-llm-queue",
            daemon=True,
        )
        _monitor_thread.start()


def _storyboard_target(context, operation):
    story_id = str((context or {}).get("storyId") or "").strip()
    scene_id = str((context or {}).get("sceneId") or "").strip()
    operation = str(operation or "").strip()
    if not story_id:
        return None
    if operation in {"expand_concept", "define_invariants"}:
        return {"kind": "concept", "storyId": story_id, "sceneId": ""}
    if operation == "develop_story":
        return {"kind": "scenes", "storyId": story_id, "sceneId": ""}
    if operation == "repair_scenes":
        return {"kind": "repair", "storyId": story_id, "sceneId": ""}
    if operation in {"write_prompt", "refine_prompt"} and scene_id:
        return {"kind": "scene-prompt", "storyId": story_id, "sceneId": scene_id}
    return None


def _storyboard_targets_conflict(a, b):
    if not a or not b or a["storyId"] != b["storyId"]:
        return False
    if a["kind"] == "scene-prompt" and b["kind"] == "scene-prompt":
        return a["sceneId"] == b["sceneId"]
    if a["kind"] == "repair" or b["kind"] == "repair":
        return True
    if a["kind"] == "scenes" or b["kind"] == "scenes":
        return True
    if a["kind"] == "concept" and b["kind"] == "concept":
        return True
    return False


def _assert_storyboard_target_available(context, operation):
    wanted = _storyboard_target(context, operation)
    if wanted is None:
        raise ValueError("Storyboard Director target is invalid.")
    current = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
    for job in current.get("jobs", []):
        metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
        if str(metadata.get("client") or "") != "storyboard":
            continue
        existing = _storyboard_target(
            {
                "storyId": metadata.get("storyId"),
                "sceneId": metadata.get("sceneId"),
            },
            metadata.get("operation"),
        )
        if _storyboard_targets_conflict(wanted, existing):
            raise ValueError("Storyboard Director target already has pending work.")


def storyboard_target_busy(story_id, kind, scene_id=""):
    wanted = {
        "kind": str(kind or "").strip(),
        "storyId": str(story_id or "").strip(),
        "sceneId": str(scene_id or "").strip(),
    }
    if not wanted["storyId"] or wanted["kind"] not in {"concept", "scenes", "repair", "scene-prompt"}:
        raise ValueError("Storyboard Director target is invalid.")
    current = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
    for job in current.get("jobs", []):
        metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
        if str(metadata.get("client") or "") != "storyboard":
            continue
        existing = _storyboard_target(
            {
                "storyId": metadata.get("storyId"),
                "sceneId": metadata.get("sceneId"),
            },
            metadata.get("operation"),
        )
        if not existing or existing["storyId"] != wanted["storyId"] or existing["kind"] != wanted["kind"]:
            continue
        if wanted["kind"] != "scene-prompt" or existing["sceneId"] == wanted["sceneId"]:
            return True
    return False


def storyboard_story_busy(story_id):
    story_id = str(story_id or "").strip()
    if not story_id:
        raise ValueError("Story ID is required.")
    current = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
    return any(
        str((job.get("metadata") or {}).get("client") or "") == "storyboard"
        and str((job.get("metadata") or {}).get("storyId") or "") == story_id
        for job in current.get("jobs", [])
    )


def enqueue(client, model_id, contract, context=None, label=""):
    _ensure_execution_reconciled()
    client = str(client or "").strip()
    model_id = str(model_id or "").strip()
    if client not in {"storyboard", "generate"}:
        raise ValueError("Unsupported LLM client: " + (client or "empty"))
    if not model_id:
        raise ValueError("LLM model is required.")
    if not isinstance(contract, dict):
        raise ValueError("LLM contract must be an object.")

    context = copy.deepcopy(context) if isinstance(context, dict) else {}
    with _enqueue_lock:
        if client == "storyboard":
            _assert_storyboard_target_available(context, contract.get("operation"))
        job = execution_enqueue(
            EXECUTION_LANE,
            {
                "contract": copy.deepcopy(contract),
                "clientContext": context,
            },
            metadata={
                "client": client,
                "label": str(label or "LLM"),
                "operation": str(contract.get("operation") or ""),
                "modelId": model_id,
                "storyId": str(context.get("storyId") or ""),
                "sceneId": str(context.get("sceneId") or ""),
            },
        )
    _ensure_monitor_started()
    return _job_view(execution_get_job(job["id"]))


def job_status(job_id, consume=False):
    job_id = str(job_id or "").strip()
    job = execution_get_job(job_id)
    if consume and str(job.get("status") or "") in {"completed", "failed", "cancelled", "stopped", "interrupted"}:
        job = execution_consume_terminal_job(job_id)
    return _job_view(job)


def _queue_wait_state(current):
    queued = [job for job in current.get("jobs", []) if str(job.get("status") or "") == "queued"]
    if not queued:
        return {"queueDepth": 0, "waitOwner": "", "waitReason": ""}

    if current.get("paused"):
        return {
            "queueDepth": len(queued),
            "waitOwner": "paused",
            "waitReason": str(current.get("pauseReason") or "Director queue is paused."),
        }

    active_id = str(current.get("activeJobId") or "")
    if active_id:
        return {
            "queueDepth": len(queued),
            "waitOwner": "llm",
            "waitReason": "Another Director / Prompt Assistant request is running.",
        }

    from .storyboard_llm_runtime import uses_local_gpu
    if not uses_local_gpu():
        return {"queueDepth": len(queued), "waitOwner": "", "waitReason": ""}

    owner = str(execution_resource_owner() or "")
    if owner:
        labels = {"inference": "Inference", "training": "Training", "llm": "Director"}
        label = labels.get(owner, owner)
        return {
            "queueDepth": len(queued),
            "waitOwner": owner,
            "waitReason": label + " currently holds the shared GPU.",
        }

    try:
        from .training_runner import gpu_reservation_block_reason
        reason = str(gpu_reservation_block_reason(GPU_RESERVATION_OWNER) or "")
    except Exception:
        _logger.exception("Could not inspect the shared GPU blocker for queued LLM work.")
        return {
            "queueDepth": len(queued),
            "waitOwner": "unknown",
            "waitReason": "Shared GPU availability could not be determined.",
        }

    if reason.startswith("Training "):
        return {
            "queueDepth": len(queued),
            "waitOwner": "training",
            "waitReason": reason,
        }
    return {"queueDepth": len(queued), "waitOwner": "", "waitReason": ""}


def snapshot(include_terminal=False):
    current = execution_lane_snapshot(EXECUTION_LANE, include_terminal=include_terminal)
    return {
        "paused": bool(current.get("paused")),
        "pauseReason": str(current.get("pauseReason") or ""),
        "activeJobId": str(current.get("activeJobId") or ""),
        **_queue_wait_state(current),
        "jobs": [_job_view(job) for job in current.get("jobs", [])],
    }


def action(operation, job_id="", direction="", position=None):
    _ensure_execution_reconciled()
    operation = str(operation or "").strip()
    job_id = str(job_id or "").strip()
    if operation == "cancel":
        return {"job": _job_view(execution_cancel_queued(job_id))}
    if operation == "stop":
        current = execution_get_job(job_id)
        if str(current.get("status") or "") not in {"starting", "running", "stopping"}:
            raise ValueError("Only active LLM jobs can be stopped.")
        from .storyboard_llm_runtime import assert_hard_stop_supported, stop_owned_server
        assert_hard_stop_supported()
        if str(current.get("status") or "") != "stopping":
            execution_request_stop(job_id)
        stop_owned_server()
        return {"job": _job_view(execution_get_job(job_id))}
    if operation == "pause_queue":
        execution_pause_lane(EXECUTION_LANE)
        return {"queue": snapshot()}
    if operation == "resume_queue":
        execution_resume_lane(EXECUTION_LANE)
        _ensure_monitor_started()
        return {"queue": snapshot()}
    if operation == "reorder":
        lane = execution_reorder_job(
            job_id,
            direction=str(direction or "").strip() or None,
            position=position,
        )
        return {
            "queue": {
                "paused": bool(lane.get("paused")),
                "pauseReason": str(lane.get("pauseReason") or ""),
                "activeJobId": str(lane.get("activeJobId") or ""),
                "jobs": [
                    _job_view(job)
                    for job in lane.get("jobs", [])
                    if str(job.get("status") or "") not in {"completed", "failed", "cancelled", "stopped", "interrupted"}
                ],
            }
        }
    raise ValueError("Unsupported LLM queue action: " + operation)
