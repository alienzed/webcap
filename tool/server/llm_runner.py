import copy
import json
import logging
import threading
import time

from .execution_queue import (
    discard_persisted_lane as execution_discard_persisted_lane,
    ephemeral_lane as execution_ephemeral_lane,
    resource_owner as execution_resource_owner,
    transient_receipt as execution_transient_receipt,
)


EXECUTION_LANE = "llm"
GPU_RESERVATION_OWNER = EXECUTION_LANE
_execution_queue = execution_ephemeral_lane(EXECUTION_LANE)

def _require_llm_lane(lane_name):
    if str(lane_name or "").strip() != EXECUTION_LANE:
        raise ValueError("LLM execution lane is required.")


execution_cancel_pending_transient = _execution_queue.cancel_pending_transient
execution_clear_lane = _execution_queue.clear
execution_consume_terminal_job = _execution_queue.consume_terminal_job


def execution_claim_next(lane_name, runnable_backlog_ids=None, expected_job_id=""):
    _require_llm_lane(lane_name)
    if runnable_backlog_ids:
        raise ValueError("LLM execution does not support a backlog.")
    return _execution_queue.claim_next(expected_job_id=expected_job_id)


def execution_enqueue(lane_name, payload, metadata=None, job_id=None, initial_status="queued"):
    _require_llm_lane(lane_name)
    return _execution_queue.enqueue(
        payload,
        metadata=metadata,
        job_id=job_id,
        initial_status=initial_status,
    )


execution_finish_job_transient = _execution_queue.finish_job_transient
execution_get_job = _execution_queue.get_job


def execution_lane_snapshot(lane_name, include_terminal=True):
    _require_llm_lane(lane_name)
    return _execution_queue.lane_snapshot(include_terminal=include_terminal)


execution_mark_running = _execution_queue.mark_running


def execution_pause_lane(lane_name, reason="Queue paused by the user."):
    _require_llm_lane(lane_name)
    return _execution_queue.pause_lane(reason=reason)


execution_reorder_job = _execution_queue.reorder_job
execution_request_stop = _execution_queue.request_stop


def execution_resume_lane(lane_name):
    _require_llm_lane(lane_name)
    return _execution_queue.resume_lane()

_dispatch_lock = threading.Lock()
_enqueue_lock = threading.Lock()
_reconcile_lock = threading.Lock()
_startup_reconciled = False
_monitor_lock = threading.Lock()
_monitor_thread = None
_local_gpu_drain_until = 0.0
LOCAL_GPU_DRAIN_GRACE_SECONDS = 3.0
_logger = logging.getLogger(__name__)


def _reserve_gpu():
    from .training_runner import reserve_gpu_for_external_work
    return reserve_gpu_for_external_work(GPU_RESERVATION_OWNER)


def _release_gpu():
    from .training_runner import release_gpu_for_external_work
    release_gpu_for_external_work(GPU_RESERVATION_OWNER)


def _arm_local_gpu_drain_grace():
    global _local_gpu_drain_until
    _local_gpu_drain_until = time.monotonic() + LOCAL_GPU_DRAIN_GRACE_SECONDS


def local_gpu_drain_pending():
    return time.monotonic() < _local_gpu_drain_until


def _job_model_id(job):
    if not isinstance(job, dict):
        return ""
    metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
    return str(metadata.get("modelId") or job.get("modelId") or "").strip()


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
        # LLM requests are session work, not durable history or restartable
        # backlog. Successfully applied Story/prompt state already lives in its
        # real store; everything else is intentionally forgotten on restart.
        execution_discard_persisted_lane(EXECUTION_LANE)
        execution_clear_lane()
        _startup_reconciled = True


def reconcile_startup():
    _ensure_execution_reconciled()
    _ensure_monitor_started()


def _assert_storyboard_contract_current(context, frozen_contract):
    if "sourceInstruction" not in context:
        return

    from .storyboard_llm_contract import build_request
    from .storyboard_store import load_story

    story_id = str(context.get("storyId") or "").strip()
    scene_id = str(context.get("sceneId") or "").strip()
    operation = str(context.get("operation") or "").strip()
    current_story = load_story(story_id)
    current_contract = build_request(
        current_story,
        scene_id,
        operation,
        instruction=str(context.get("sourceInstruction") or ""),
    )
    if current_contract != frozen_contract:
        raise RuntimeError(
            "Storyboard Director inputs changed while the request was running. "
            "The stale result was not applied; run the Director action again against the current Story state."
        )


def _client_result(client, context, llm_result, job_id="", frozen_contract=None):
    if client == "chat":
        return {
            "text": llm_result["text"],
            "model": llm_result["model"],
            "usage": llm_result.get("usage"),
            "timings": llm_result.get("timings"),
        }

    if client == "generate":
        return {
            "result": llm_result["text"],
            "model": llm_result["model"],
            "usage": llm_result.get("usage"),
            "timings": llm_result.get("timings"),
        }

    if client == "test":
        operation = str((frozen_contract or {}).get("operation") or "").strip()
        if operation != "analyze_caption_wildcard":
            raise RuntimeError("Unsupported Test Generations LLM operation: " + (operation or "empty"))
        from .test_wildcard_contract import normalize_result
        return {
            "analysis": normalize_result(llm_result.get("data")),
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
    if frozen_contract is None:
        raise RuntimeError("Storyboard LLM job is missing its frozen contract.")
    _assert_storyboard_contract_current(context, frozen_contract)

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
        from .storyboard_store import apply_scene_repairs

        repair_payload = copy.deepcopy(llm_result.get("data"))
        if not isinstance(repair_payload, dict) or not isinstance(repair_payload.get("changes"), list):
            raise ValueError("Storyboard Scene repair response must contain a changes array.")

        story, changed_scene_count, changed_field_count = apply_scene_repairs(
            story_id,
            repair_payload,
            context.get("repairBase"),
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
        from .storyboard_generation import generation_queue
        from .storyboard_store import apply_developed_plan
        active_generation = generation_queue(story_id)
        if active_generation.get("jobs"):
            raise RuntimeError(
                "Story has pending Take generation. Stop or finish it before applying developed Scenes."
            )
        plan = copy.deepcopy(llm_result.get("data"))
        if not isinstance(plan, dict):
            raise ValueError("Storyboard Director returned an invalid Scene plan.")
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

    if operation == "insert_scene":
        scene_id = str(context.get("sceneId") or "").strip()
        if not scene_id:
            raise RuntimeError("Storyboard Insert Scene job is missing its anchor Scene ID.")
        data = copy.deepcopy(llm_result.get("data"))
        if not isinstance(data, dict) or not isinstance(data.get("scene"), dict):
            raise ValueError("Storyboard Director Insert Scene response must contain a scene object.")
        from .storyboard_store import insert_director_scene_after
        story, scene = insert_director_scene_after(
            story_id,
            scene_id,
            data["scene"],
            model_id=llm_result["model"],
        )
        return {
            "storyId": story["id"],
            "sceneId": scene["id"],
            "insertedAfterSceneId": scene_id,
            "model": llm_result["model"],
            "usage": llm_result.get("usage"),
            "timings": llm_result.get("timings"),
        }

    if operation in {"write_prompt", "refine_prompt"}:
        scene_id = str(context.get("sceneId") or "").strip()
        if not scene_id:
            raise RuntimeError("Storyboard Scene Director job is missing its Scene ID.")

        data = llm_result.get("data")
        if not isinstance(data, dict):
            raise ValueError("Storyboard Director returned invalid structured Scene prompt data.")

        if operation == "refine_prompt" and data.get("changed") is False:
            from .storyboard_store import load_story
            story = load_story(story_id)
            scene = (story.get("scenes") or {}).get(scene_id)
            if not isinstance(scene, dict):
                raise FileNotFoundError("Scene does not exist.")
        else:
            prompt = str(data.get("prompt") or "").strip()
            if not prompt:
                raise ValueError("Storyboard Director returned an empty Scene prompt.")
            from .storyboard_store import apply_director_prompt
            scene_fields = {}
            if operation == "refine_prompt":
                for key in ("summary", "entryState", "exitState"):
                    if key in data:
                        scene_fields[key] = data[key]
            duration_override = data.get("durationSeconds") if operation == "refine_prompt" else None
            story, scene = apply_director_prompt(
                story_id,
                scene_id,
                prompt,
                model_id=llm_result["model"],
                job_id=job_id,
                operation=operation,
                duration_override=duration_override,
                scene_fields=scene_fields,
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
        execution_finish_job_transient(job_id, status="stopped", error="LLM request stopped before execution.")
        return

    from .storyboard_llm_runtime import run_contract, run_freeform_chat
    try:
        if client == "chat":
            llm_result = run_freeform_chat(
                model_id,
                contract.get("messages"),
                gpu_reserved=bool(gpu_reserved),
            )
        else:
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
        execution_finish_job_transient(job_id, status="stopped", error="LLM request stopped.")
        return

    try:
        result = _client_result(client, context, llm_result, job_id=job_id, frozen_contract=contract)
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

    execution_finish_job_transient(job_id, status="completed", result=result)


def _advance_queue():
    _ensure_execution_reconciled()
    with _dispatch_lock:
        snapshot = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
        if snapshot.get("activeJobId"):
            return None
        if snapshot.get("paused"):
            if execution_resource_owner() == GPU_RESERVATION_OWNER:
                _release_gpu()
            return None

        queued = [job for job in snapshot.get("jobs", []) if job.get("status") == "queued"]
        if not queued:
            if (
                execution_resource_owner() == GPU_RESERVATION_OWNER
                and not local_gpu_drain_pending()
            ):
                _release_gpu()
            return None

        from .storyboard_llm_runtime import uses_local_gpu
        next_job = queued[0]
        next_model_id = _job_model_id(next_job)
        local_gpu = uses_local_gpu(next_model_id)
        reserved_here = False
        owner = execution_resource_owner()
        if local_gpu:
            if owner and owner != GPU_RESERVATION_OWNER:
                return None
            if not owner:
                if not _reserve_gpu():
                    return None
                reserved_here = True
        elif owner == GPU_RESERVATION_OWNER:
            # Runtime mode may have changed while this lane retained ownership
            # for another queued local job. Remote work does not need the GPU.
            _release_gpu()

        from .storyboard_llm_runtime import clear_stop_request
        clear_stop_request()
        claimed = execution_claim_next(EXECUTION_LANE)
        if claimed is None:
            if local_gpu and execution_resource_owner() == GPU_RESERVATION_OWNER:
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
                execution_finish_job_transient(job_id, status="stopped", error="LLM request stopped.")
            elif current_status in {"starting", "running"}:
                execution_finish_job_transient(job_id, status="failed", error=str(exc))
            _logger.exception("Queued LLM job failed.")
        finally:
            if local_gpu:
                _arm_local_gpu_drain_grace()
                if release_gpu:
                    current = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
                    keep_gpu = (
                        not current.get("paused")
                        and (
                            any(
                                str(job.get("status") or "") == "queued"
                                and uses_local_gpu(_job_model_id(job))
                                for job in current.get("jobs", [])
                            )
                            or local_gpu_drain_pending()
                        )
                    )
                    if keep_gpu and execution_resource_owner() == GPU_RESERVATION_OWNER:
                        release_gpu = False
            if release_gpu:
                _release_gpu()

        return _job_view(execution_transient_receipt(job_id))


def _monitor_has_work():
    snapshot = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
    if snapshot.get("activeJobId"):
        return True
    if snapshot.get("paused"):
        return False
    if any(str(job.get("status") or "") == "queued" for job in snapshot.get("jobs", [])):
        return True
    return (
        execution_resource_owner() == GPU_RESERVATION_OWNER
        and local_gpu_drain_pending()
    )


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
    if operation in {"develop_story", "insert_scene"}:
        return {"kind": "scenes", "storyId": story_id, "sceneId": ""}
    if operation == "repair_scenes":
        return {"kind": "repair", "storyId": story_id, "sceneId": ""}
    if operation in {"write_prompt", "refine_prompt"} and scene_id:
        return {"kind": "scene-prompt", "storyId": story_id, "sceneId": scene_id}
    return None



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
    if client not in {"storyboard", "generate", "test", "chat"}:
        raise ValueError("Unsupported LLM client: " + (client or "empty"))
    if not model_id:
        raise ValueError("LLM model is required.")
    if not isinstance(contract, dict):
        raise ValueError("LLM contract must be an object.")

    context = copy.deepcopy(context) if isinstance(context, dict) else {}
    with _enqueue_lock:
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
    try:
        job = execution_get_job(job_id)
        if (
            consume
            and str(job.get("status") or "") in {"completed", "failed", "cancelled", "stopped", "interrupted"}
        ):
            job = execution_consume_terminal_job(job_id)
    except FileNotFoundError:
        job = execution_transient_receipt(job_id, consume=consume)
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
    next_model_id = _job_model_id(queued[0])
    if not uses_local_gpu(next_model_id):
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
    _ensure_execution_reconciled()
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
        return {"job": _job_view(execution_cancel_pending_transient(job_id))}
    if operation in {"stop", "stop_or_cancel"}:
        current = execution_get_job(job_id)
        status = str(current.get("status") or "")
        if operation == "stop_or_cancel" and status == "queued":
            return {"job": _job_view(execution_cancel_pending_transient(job_id))}
        if status not in {"starting", "running", "stopping"}:
            raise ValueError("Only queued or active LLM jobs can be stopped.")
        from .storyboard_llm_runtime import assert_stop_supported, stop_active_request
        assert_stop_supported()
        stopping = current if status == "stopping" else execution_request_stop(job_id)
        stop_active_request()
        # The worker may finish and remove the in-memory job while hard-stop is
        # synchronously shutting llama.cpp down. Return the stopping snapshot
        # captured before that race instead of re-reading a job that may already
        # be an in-memory terminal receipt.
        return {"job": _job_view(stopping)}
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
