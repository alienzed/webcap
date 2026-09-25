import copy
import logging
import threading
import time

from .execution_queue import (
    cancel_pending as execution_cancel_pending,
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
    shelve_queued as execution_shelve_queued,
    update_job as execution_update_job,
    reserve_resource as execution_reserve_resource,
    resource_owner as execution_resource_owner,
    resume_lane as execution_resume_lane,
)


EXECUTION_LANE = "inference"
GPU_RESERVATION_OWNER = EXECUTION_LANE

_dispatch_lock = threading.Lock()
_reconcile_lock = threading.Lock()
_startup_reconciled = False
_monitor_lock = threading.Lock()
_monitor_thread = None
_provider_hold_lock = threading.Lock()
_provider_cleanup_holds = set()
_provider_cleanup_reason = ""
_backlog_lock = threading.Lock()
_armed_backlog_ids = set()
_backlog_wait_reason = ""
_logger = logging.getLogger(__name__)


def _reserve_gpu():
    from .training_runner import reserve_gpu_for_external_work
    return reserve_gpu_for_external_work(GPU_RESERVATION_OWNER)


def _release_gpu():
    from .training_runner import release_gpu_for_external_work
    release_gpu_for_external_work(GPU_RESERVATION_OWNER)


def _new_job_status():
    from .training_runner import external_gpu_work_block_reason
    return "backlog" if external_gpu_work_block_reason(GPU_RESERVATION_OWNER) else "queued"


def _arm_backlog(job_id):
    job_id = str(job_id or "").strip()
    if not job_id:
        return
    with _backlog_lock:
        _armed_backlog_ids.add(job_id)


def _disarm_backlog(job_id):
    job_id = str(job_id or "").strip()
    with _backlog_lock:
        _armed_backlog_ids.discard(job_id)


def _armed_backlog_snapshot():
    with _backlog_lock:
        return set(_armed_backlog_ids)


def _set_backlog_wait_reason(reason):
    global _backlog_wait_reason
    with _backlog_lock:
        _backlog_wait_reason = str(reason or "")


def prepare_startup_backlog():
    """Shelf persisted pending work and reconcile only interrupted active work."""
    with _backlog_lock:
        _armed_backlog_ids.clear()
    _set_backlog_wait_reason("")
    shelved = execution_shelve_queued(EXECUTION_LANE)
    _ensure_execution_reconciled()
    return shelved


def hold_provider_cleanup(provider_job_id, reason):
    global _provider_cleanup_reason
    provider_job_id = str(provider_job_id or "").strip()
    if not provider_job_id:
        return
    with _provider_hold_lock:
        _provider_cleanup_holds.add(provider_job_id)
        _provider_cleanup_reason = str(
            reason or "Inference is waiting for ComfyUI provider cleanup."
        )


def _clear_obsolete_persisted_provider_pause():
    """Migrate runtime-only provider pauses written by older versions."""
    current = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
    reason = str(current.get("pauseReason") or "")
    lowered = reason.lower()
    if (
        current.get("paused")
        and (
            "comfyui provider" in lowered
            or "provider cleanup" in lowered
        )
    ):
        execution_resume_lane(EXECUTION_LANE)


def _reconcile_provider_cleanup_holds():
    with _provider_hold_lock:
        pending = list(_provider_cleanup_holds)
    if not pending:
        return True

    from . import inference_runtime
    unresolved = []
    for provider_job_id in pending:
        try:
            job = inference_runtime.read_job(provider_job_id)
        except Exception:
            unresolved.append(provider_job_id)
            _logger.warning(
                "Could not verify held inference provider job %s; retaining the GPU hold.",
                provider_job_id,
                exc_info=True,
            )
            continue
        status = str(job.get("status") or "").strip().lower() if isinstance(job, dict) else ""
        if job is not None and status not in {"completed", "failed", "cancelled"}:
            unresolved.append(provider_job_id)

    global _provider_cleanup_reason
    with _provider_hold_lock:
        _provider_cleanup_holds.intersection_update(unresolved)
        remaining = bool(_provider_cleanup_holds)
        if not remaining:
            _provider_cleanup_reason = ""
    if remaining:
        owner = execution_resource_owner()
        if not owner:
            execution_reserve_resource(GPU_RESERVATION_OWNER)
        elif owner != GPU_RESERVATION_OWNER:
            _logger.error(
                "Inference provider cleanup is unresolved while the shared GPU is owned by %s.",
                owner,
            )
        return False

    if execution_resource_owner() == GPU_RESERVATION_OWNER:
        _release_gpu()
    return True


def _job_view(job):
    if not isinstance(job, dict):
        return None
    metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
    details = job.get("details") if isinstance(job.get("details"), dict) else {}
    result = job.get("result") if isinstance(job.get("result"), dict) else {}
    return {
        "jobId": str(job.get("id") or ""),
        "client": str(metadata.get("client") or ""),
        "label": str(metadata.get("label") or ""),
        "modelId": str(metadata.get("modelId") or ""),
        "mediaKind": str(metadata.get("mediaKind") or ""),
        "storyId": str(metadata.get("storyId") or ""),
        "sceneId": str(metadata.get("sceneId") or ""),
        "sessionId": str(metadata.get("sessionId") or ""),
        "folder": str(metadata.get("folder") or ""),
        "source": str(metadata.get("source") or ""),
        "candidateKind": str(metadata.get("candidateKind") or ""),
        "candidateFile": str(metadata.get("candidateFile") or ""),
        "status": str(job.get("status") or ""),
        "queuePosition": int(job.get("queuePosition") or 0),
        "armed": str(job.get("id") or "") in _armed_backlog_snapshot(),
        "createdAt": job.get("createdAt"),
        "startedAt": job.get("startedAt"),
        "finishedAt": job.get("finishedAt"),
        "requestedAction": str(job.get("requestedAction") or ""),
        "providerJobId": str(details.get("providerJobId") or ""),
        "providerStatus": str(details.get("providerStatus") or ""),
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

        _clear_obsolete_persisted_provider_pause()
        prior = execution_lane_snapshot(EXECUTION_LANE, include_terminal=True)
        prior_active = [
            job for job in prior.get("jobs", [])
            if str(job.get("status") or "") in {"starting", "running", "stopping"}
        ]
        # Reconcile provider state while active queue jobs are still mutable so
        # the confirmed terminal provider status is persisted before the WebCap
        # job itself is marked interrupted.
        for job in prior_active:
            details = job.get("details") if isinstance(job.get("details"), dict) else {}
            prompt_id = str(details.get("providerJobId") or "").strip()
            if not prompt_id:
                continue
            try:
                from .inference_runtime import cancel_job_and_wait_status
                terminal_status = cancel_job_and_wait_status(prompt_id)
                if terminal_status:
                    execution_update_job(
                        str(job.get("id") or ""),
                        details={"providerStatus": terminal_status},
                    )
                else:
                    hold_provider_cleanup(
                        prompt_id,
                        "Queue paused: interrupted ComfyUI provider work could not be confirmed stopped after restart.",
                    )
                    _logger.error(
                        "Interrupted inference provider job %s did not confirm cancellation.",
                        prompt_id,
                    )
            except Exception:
                hold_provider_cleanup(
                    prompt_id,
                    "Queue paused: interrupted ComfyUI provider work could not be confirmed stopped after restart.",
                )
                _logger.exception("Could not cancel interrupted inference provider job %s.", prompt_id)

        execution_recover_lane(
            EXECUTION_LANE,
            reason="Inference was interrupted by a WebCap restart.",
        )

        with _provider_hold_lock:
            cleanup_pending = bool(_provider_cleanup_holds)
        if cleanup_pending:
            owner = execution_resource_owner()
            if not owner:
                execution_reserve_resource(GPU_RESERVATION_OWNER)
            elif owner != GPU_RESERVATION_OWNER:
                _logger.error(
                    "Interrupted inference provider cleanup is unresolved while the shared GPU is owned by %s.",
                    owner,
                )

        _startup_reconciled = True


def reconcile_startup():
    _ensure_execution_reconciled()


def _execute_claimed(job_id):
    stored = execution_get_job(job_id, include_payload=True)
    metadata = stored.get("metadata") if isinstance(stored.get("metadata"), dict) else {}
    payload = stored.get("payload") if isinstance(stored.get("payload"), dict) else {}
    request = payload.get("request") if isinstance(payload.get("request"), dict) else None
    client = str(metadata.get("client") or "").strip()
    if request is None:
        raise RuntimeError("Inference job is missing its frozen request.")

    running = execution_mark_running(job_id, details={"providerStatus": "starting"})
    if str(running.get("status") or "") == "stopping":
        execution_finish_job(job_id, status="stopped", error="Inference stopped before provider launch.")
        _cleanup_generate_job_references(job_id)
        return

    if client == "generate":
        from .generate_generation import execute
        result = execute(job_id, request)
    elif client == "storyboard":
        from .storyboard_generation import execute_inference
        context = payload.get("clientContext") if isinstance(payload.get("clientContext"), dict) else {}
        result = execute_inference(job_id, request, context)
    elif client == "test":
        from .epoch_test_bench import execute_inference
        context = payload.get("clientContext") if isinstance(payload.get("clientContext"), dict) else {}
        result = execute_inference(job_id, request, context)
    else:
        raise RuntimeError("Unsupported inference client: " + (client or "empty"))

    execution_finish_job(job_id, status="completed", result=result)


def _cancel_failed_provider(job):
    details = job.get("details") if isinstance(job, dict) and isinstance(job.get("details"), dict) else {}
    provider_job_id = str(details.get("providerJobId") or "").strip()
    provider_status = str(details.get("providerStatus") or "").strip().lower()
    job_id = str(job.get("id") or "").strip() if isinstance(job, dict) else ""
    if not provider_job_id or provider_status in {"completed", "failed", "cancelled", "missing"}:
        return True
    try:
        from .inference_runtime import cancel_job_and_wait_status
        terminal_status = cancel_job_and_wait_status(provider_job_id)
        if terminal_status:
            if job_id:
                execution_update_job(job_id, details={"providerStatus": terminal_status})
            return True
        _logger.error(
            "Inference provider job %s did not confirm cancellation; retaining the GPU reservation.",
            provider_job_id,
        )
    except Exception:
        _logger.exception(
            "Could not confirm cancellation of failed inference provider job %s.",
            provider_job_id,
        )
    return False


def _advance_queue():
    _ensure_execution_reconciled()
    with _dispatch_lock:
        snapshot = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
        if snapshot.get("paused") or snapshot.get("activeJobId"):
            return None

        with _provider_hold_lock:
            cleanup_pending = bool(_provider_cleanup_holds)
        if cleanup_pending and not _reconcile_provider_cleanup_holds():
            return None

        jobs = snapshot.get("jobs", [])
        armed_ids = _armed_backlog_snapshot()
        next_runnable = next(
            (
                job for job in jobs
                if str(job.get("status") or "") == "queued"
                or (
                    str(job.get("status") or "") == "backlog"
                    and str(job.get("id") or "") in armed_ids
                )
            ),
            None,
        )
        if next_runnable is None:
            _set_backlog_wait_reason("")
            if execution_resource_owner() == GPU_RESERVATION_OWNER:
                _release_gpu()
            return None

        owner = execution_resource_owner()
        if owner and owner != GPU_RESERVATION_OWNER:
            _set_backlog_wait_reason("Waiting for " + owner + " to release the shared GPU.")
            return None

        reserved_here = False
        if not owner:
            if not _reserve_gpu():
                _set_backlog_wait_reason("Waiting for Training to release the shared GPU.")
                return None
            reserved_here = True

        try:
            from .storyboard_llm_runtime import DirectorRuntimeBusy, release_loaded_model_for_gpu_work
            release_loaded_model_for_gpu_work()
        except DirectorRuntimeBusy:
            _set_backlog_wait_reason("Waiting for Prompt Assistant / Director.")
            if execution_resource_owner() == GPU_RESERVATION_OWNER:
                _release_gpu()
            return None
        except Exception:
            _set_backlog_wait_reason("Waiting for Prompt Assistant / Director to release the shared GPU.")
            if execution_resource_owner() == GPU_RESERVATION_OWNER:
                _release_gpu()
            _logger.debug(
                "Inference is waiting for the retained Prompt Assistant / Director model to yield the GPU.",
                exc_info=True,
            )
            return None

        if str(next_runnable.get("status") or "") == "backlog":
            try:
                from . import inference_runtime
                inference_runtime.system_stats()
            except Exception:
                _set_backlog_wait_reason("ComfyUI unavailable.")
                if execution_resource_owner() == GPU_RESERVATION_OWNER:
                    _release_gpu()
                return None

        _set_backlog_wait_reason("")
        claimed = execution_claim_next(
            EXECUTION_LANE,
            runnable_backlog_ids=armed_ids,
        )
        if claimed is not None and str(claimed.get("id") or "") in armed_ids:
            _disarm_backlog(claimed.get("id"))
        if claimed is None:
            if reserved_here:
                _release_gpu()
            return None

        job_id = str(claimed.get("id") or "")
        release_gpu = True
        try:
            _execute_claimed(job_id)
        except Exception as exc:
            from .inference_runtime import InferenceStopped
            current = execution_get_job(job_id)
            status = str(current.get("status") or "")
            if isinstance(exc, InferenceStopped):
                if status in {"starting", "running", "stopping"}:
                    execution_finish_job(job_id, status=exc.status, error=str(exc))
            else:
                release_gpu = _cancel_failed_provider(current)
                if not release_gpu:
                    provider_job_id = str(
                        (current.get("details") or {}).get("providerJobId") or ""
                    )
                    hold_provider_cleanup(
                        provider_job_id,
                        (
                            "Queue paused: ComfyUI provider work could not be confirmed stopped after an inference failure. "
                            "Resolve the provider job before resuming."
                        ),
                    )
                if status in {"starting", "running", "stopping"}:
                    execution_finish_job(job_id, status="failed", error=str(exc))
                _logger.exception("Queued inference job failed.")
        finally:
            _cleanup_generate_job_references(job_id)
            if release_gpu and execution_resource_owner() == GPU_RESERVATION_OWNER:
                _release_gpu()
        return _job_view(execution_get_job(job_id))


def _monitor_has_work():
    snapshot = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
    if snapshot.get("activeJobId"):
        return True
    if snapshot.get("paused"):
        return False
    with _provider_hold_lock:
        if _provider_cleanup_holds:
            return True
    armed_ids = _armed_backlog_snapshot()
    return any(
        str(job.get("status") or "") == "queued"
        or (
            str(job.get("status") or "") == "backlog"
            and str(job.get("id") or "") in armed_ids
        )
        for job in snapshot.get("jobs", [])
    )


def _monitor_loop():
    global _monitor_thread
    while True:
        try:
            _advance_queue()
        except Exception:
            _logger.exception("Inference queue monitor failed.")

        with _monitor_lock:
            if not _monitor_has_work():
                _monitor_thread = None
                return
        time.sleep(2)


def _ensure_monitor_started():
    global _monitor_thread
    with _monitor_lock:
        if _monitor_thread and _monitor_thread.is_alive():
            return
        _monitor_thread = threading.Thread(
            target=_monitor_loop,
            name="webcap-inference-queue",
            daemon=True,
        )
        _monitor_thread.start()


def start_observer():
    reconcile_startup()
    _ensure_monitor_started()


def _start_worker_for_requested_inference():
    _ensure_monitor_started()


def enqueue_generate(request, label=""):
    _ensure_execution_reconciled()
    status = _new_job_status()
    job = execution_enqueue(
        EXECUTION_LANE,
        {"request": copy.deepcopy(request)},
        metadata={
            "client": "generate",
            "label": str(label or "Generate"),
            "modelId": str(request.get("modelId") or ""),
            "mediaKind": str(request.get("mediaKind") or ""),
        },
        initial_status=status,
    )
    if status == "backlog":
        _arm_backlog(job["id"])
    _start_worker_for_requested_inference()
    return _job_view(execution_get_job(job["id"]))


def enqueue_storyboard(request, story_id, scene_id, label="", migrated_from_job_id="", deferred=False):
    _ensure_execution_reconciled()
    story_id = str(story_id or "").strip()
    scene_id = str(scene_id or "").strip()
    if not story_id or not scene_id:
        raise ValueError("Storyboard inference requires Story and Scene IDs.")
    context = {
        "storyId": story_id,
        "sceneId": scene_id,
        "entryState": str(request.get("entryState") or ""),
        "exitState": str(request.get("exitState") or ""),
        "seedMode": str(request.get("seedMode") or ""),
        "referenceRecords": copy.deepcopy(request.get("referenceRecords") or []),
    }
    frozen_request = copy.deepcopy(request)
    for key in ("entryState", "exitState", "seedMode", "referenceRecords"):
        frozen_request.pop(key, None)
    status = "backlog" if deferred else _new_job_status()
    job = execution_enqueue(
        EXECUTION_LANE,
        {
            "request": frozen_request,
            "clientContext": context,
        },
        metadata={
            "client": "storyboard",
            "label": str(label or "Storyboard Take"),
            "modelId": str(request.get("modelId") or ""),
            "mediaKind": str(request.get("mediaKind") or ""),
            "storyId": story_id,
            "sceneId": scene_id,
            "migratedFromJobId": str(migrated_from_job_id or ""),
        },
        initial_status=status,
    )
    if status == "backlog" and not deferred:
        _arm_backlog(job["id"])
    if not deferred:
        _start_worker_for_requested_inference()
    return _job_view(execution_get_job(job["id"]))


def enqueue_test(request, context, label="", deferred=False):
    _ensure_execution_reconciled()
    context = copy.deepcopy(context) if isinstance(context, dict) else {}
    folder = str(context.get("folder") or "").strip()
    session_id = str(context.get("sessionId") or "").strip()
    candidate_kind = str(context.get("candidateKind") or "").strip()
    if not folder or not session_id or candidate_kind not in {"base", "lora"}:
        raise ValueError("Test inference requires folder, session, and candidate context.")
    status = "backlog" if deferred else _new_job_status()
    job = execution_enqueue(
        EXECUTION_LANE,
        {
            "request": copy.deepcopy(request),
            "clientContext": context,
        },
        metadata={
            "client": "test",
            "label": str(label or "Test"),
            "modelId": str(request.get("modelId") or ""),
            "mediaKind": str(request.get("mediaKind") or ""),
            "folder": folder,
            "source": str(context.get("source") or ""),
            "sessionId": session_id,
            "candidateKind": candidate_kind,
            "candidateFile": str(context.get("candidateFile") or ""),
        },
        initial_status=status,
    )
    if status == "backlog" and not deferred:
        _arm_backlog(job["id"])
    if not deferred:
        _start_worker_for_requested_inference()
    return _job_view(execution_get_job(job["id"]))


def snapshot(include_terminal=False):
    _clear_obsolete_persisted_provider_pause()
    current = execution_lane_snapshot(EXECUTION_LANE, include_terminal=include_terminal)
    with _provider_hold_lock:
        provider_paused = bool(_provider_cleanup_holds)
        provider_reason = str(_provider_cleanup_reason or "")
    with _backlog_lock:
        armed_ids = set(_armed_backlog_ids)
        wait_reason = str(_backlog_wait_reason or "")
    jobs = current.get("jobs", [])
    return {
        "paused": bool(current.get("paused")) or provider_paused,
        "pauseReason": (
            provider_reason
            if provider_paused
            else str(current.get("pauseReason") or "")
        ),
        "activeJobId": str(current.get("activeJobId") or ""),
        "backlogCount": sum(1 for job in jobs if str(job.get("status") or "") == "backlog"),
        "armedBacklogCount": sum(
            1 for job in jobs
            if str(job.get("status") or "") == "backlog"
            and str(job.get("id") or "") in armed_ids
        ),
        "waitReason": wait_reason,
        "jobs": [_job_view(job) for job in jobs],
    }


def job_status(job_id, consume=False):
    job_id = str(job_id or "").strip()
    job = execution_get_job(job_id)
    if consume and str(job.get("status") or "") in {"completed", "failed", "cancelled", "stopped", "interrupted"}:
        job = execution_consume_terminal_job(job_id)
    return _job_view(job)


def _cleanup_generate_job_references(job_id):
    try:
        stored = execution_get_job(str(job_id or "").strip(), include_payload=True)
    except FileNotFoundError:
        return
    metadata = stored.get("metadata") if isinstance(stored.get("metadata"), dict) else {}
    if metadata.get("client") != "generate":
        return
    payload = stored.get("payload") if isinstance(stored.get("payload"), dict) else {}
    request = payload.get("request") if isinstance(payload.get("request"), dict) else {}
    try:
        from .generate_store import cleanup_references
        cleanup_references(request.get("references") or {})
    except Exception:
        _logger.exception("Could not clean transient Generate references for job %s.", job_id)


def stop_storyboard_jobs(story_id, timeout=15):
    _ensure_execution_reconciled()
    story_id = str(story_id or "").strip()
    if not story_id:
        raise ValueError("Story ID is required.")

    relevant = [
        job
        for job in execution_lane_snapshot(EXECUTION_LANE, include_terminal=False).get("jobs", [])
        if isinstance(job.get("metadata"), dict)
        and job["metadata"].get("client") == "storyboard"
        and str(job["metadata"].get("storyId") or "") == story_id
    ]
    active_ids = []
    for job in relevant:
        job_id = str(job.get("id") or "")
        status = str(job.get("status") or "")
        if status in {"queued", "backlog"}:
            execution_cancel_pending(job_id)
            _disarm_backlog(job_id)
        elif status in {"starting", "running"}:
            execution_request_stop(job_id)
            active_ids.append(job_id)
        elif status == "stopping":
            active_ids.append(job_id)

    if not active_ids:
        return

    deadline = time.monotonic() + max(0.0, float(timeout or 0))
    pending = set(active_ids)
    while pending:
        for job_id in list(pending):
            status = str(execution_get_job(job_id).get("status") or "")
            if status in {"completed", "failed", "cancelled", "stopped", "interrupted"}:
                pending.remove(job_id)
        if not pending:
            return
        if time.monotonic() >= deadline:
            raise RuntimeError(
                "Storyboard inference did not stop in time; the Story was not deleted."
            )
        time.sleep(0.1)


def action(operation, job_id="", direction="", position=None):
    _ensure_execution_reconciled()
    operation = str(operation or "").strip()
    job_id = str(job_id or "").strip()
    if operation == "cancel":
        job = execution_cancel_pending(job_id)
        _disarm_backlog(job_id)
        _cleanup_generate_job_references(job_id)
        return {"job": _job_view(job)}
    if operation == "run_backlog":
        job = execution_get_job(job_id)
        if str(job.get("status") or "") != "backlog":
            raise ValueError("Only backlogged inference can be run.")
        _arm_backlog(job_id)
        _start_worker_for_requested_inference()
        return {"job": _job_view(execution_get_job(job_id)), "queue": snapshot()}
    if operation == "run_all_backlog":
        lane = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
        backlog_ids = [
            str(job.get("id") or "")
            for job in lane.get("jobs", [])
            if str(job.get("status") or "") == "backlog"
        ]
        for backlog_id in backlog_ids:
            _arm_backlog(backlog_id)
        if backlog_ids:
            _start_worker_for_requested_inference()
        return {"queue": snapshot(), "armed": len(backlog_ids)}
    if operation == "stop":
        return {"job": _job_view(execution_request_stop(job_id))}
    if operation == "pause_queue":
        execution_pause_lane(EXECUTION_LANE)
        return {"queue": snapshot()}
    if operation == "resume_queue":
        # Resuming scheduling is independent of immediate GPU availability.
        # The worker will wait safely while Training or LLM owns the shared
        # resource; only unresolved provider cleanup is a reason to keep this
        # lane deliberately paused.
        with _provider_hold_lock:
            cleanup_pending = bool(_provider_cleanup_holds)
        if cleanup_pending and not _reconcile_provider_cleanup_holds():
            queue = snapshot()
            return {
                "queue": queue,
                "resumeBlocked": True,
                "resumeBlockReason": str(
                    queue.get("pauseReason")
                    or "Inference queue is waiting for ComfyUI provider cleanup."
                ),
            }
        execution_resume_lane(EXECUTION_LANE)
        _start_worker_for_requested_inference()
        return {"queue": snapshot(), "resumed": True}
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
                    if job.get("status") not in {"completed", "failed", "cancelled", "stopped", "interrupted"}
                ],
            }
        }
    raise ValueError("Unsupported inference queue action: " + operation)
