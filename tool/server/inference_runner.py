import copy
import logging
import threading
import time

from .execution_queue import (
    cancel_queued as execution_cancel_queued,
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


EXECUTION_LANE = "inference"
GPU_RESERVATION_OWNER = EXECUTION_LANE

_dispatch_lock = threading.Lock()
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
        "candidateKind": str(metadata.get("candidateKind") or ""),
        "candidateFile": str(metadata.get("candidateFile") or ""),
        "status": str(job.get("status") or ""),
        "queuePosition": int(job.get("queuePosition") or 0),
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
        interrupted = execution_recover_lane(
            EXECUTION_LANE,
            reason="Inference was interrupted by a WebCap restart.",
        )
        for job in interrupted:
            details = job.get("details") if isinstance(job.get("details"), dict) else {}
            prompt_id = str(details.get("providerJobId") or "").strip()
            if not prompt_id:
                continue
            try:
                from .inference_runtime import cancel_job
                cancel_job(prompt_id)
            except Exception:
                _logger.exception("Could not cancel interrupted inference provider job %s.", prompt_id)
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


def _advance_queue():
    _ensure_execution_reconciled()
    with _dispatch_lock:
        snapshot = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
        if snapshot.get("paused") or snapshot.get("activeJobId"):
            return None

        queued = [job for job in snapshot.get("jobs", []) if job.get("status") == "queued"]
        if not queued:
            if execution_resource_owner() == GPU_RESERVATION_OWNER:
                _release_gpu()
            return None

        owner = execution_resource_owner()
        if owner and owner != GPU_RESERVATION_OWNER:
            return None

        reserved_here = False
        if not owner:
            if not _reserve_gpu():
                return None
            reserved_here = True

        claimed = execution_claim_next(EXECUTION_LANE)
        if claimed is None:
            if reserved_here:
                _release_gpu()
            return None

        job_id = str(claimed.get("id") or "")
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
                if status in {"starting", "running", "stopping"}:
                    execution_finish_job(job_id, status="failed", error=str(exc))
                _logger.exception("Queued inference job failed.")
        finally:
            if execution_resource_owner() == GPU_RESERVATION_OWNER:
                _release_gpu()
        return _job_view(execution_get_job(job_id))


def _monitor_loop():
    while True:
        try:
            _advance_queue()
        except Exception:
            _logger.exception("Inference queue monitor failed.")
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


def enqueue_generate(request, label=""):
    _ensure_execution_reconciled()
    job = execution_enqueue(
        EXECUTION_LANE,
        {"request": copy.deepcopy(request)},
        metadata={
            "client": "generate",
            "label": str(label or "Generate"),
            "modelId": str(request.get("modelId") or ""),
            "mediaKind": str(request.get("mediaKind") or ""),
        },
    )
    return _job_view(execution_get_job(job["id"]))


def enqueue_storyboard(request, story_id, scene_id, label="", migrated_from_job_id=""):
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
    )
    return _job_view(execution_get_job(job["id"]))


def enqueue_test(request, context, label=""):
    _ensure_execution_reconciled()
    context = copy.deepcopy(context) if isinstance(context, dict) else {}
    folder = str(context.get("folder") or "").strip()
    session_id = str(context.get("sessionId") or "").strip()
    candidate_kind = str(context.get("candidateKind") or "").strip()
    if not folder or not session_id or candidate_kind not in {"base", "lora"}:
        raise ValueError("Test inference requires folder, session, and candidate context.")
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
            "sessionId": session_id,
            "candidateKind": candidate_kind,
            "candidateFile": str(context.get("candidateFile") or ""),
        },
    )
    return _job_view(execution_get_job(job["id"]))


def snapshot(include_terminal=False):
    current = execution_lane_snapshot(EXECUTION_LANE, include_terminal=include_terminal)
    return {
        "paused": bool(current.get("paused")),
        "pauseReason": str(current.get("pauseReason") or ""),
        "activeJobId": str(current.get("activeJobId") or ""),
        "jobs": [_job_view(job) for job in current.get("jobs", [])],
    }


def job_status(job_id):
    return _job_view(execution_get_job(str(job_id or "").strip()))


def action(operation, job_id="", direction="", position=None):
    _ensure_execution_reconciled()
    operation = str(operation or "").strip()
    job_id = str(job_id or "").strip()
    if operation == "cancel":
        job = execution_cancel_queued(job_id)
        return {"job": _job_view(job)}
    if operation == "stop":
        return {"job": _job_view(execution_request_stop(job_id))}
    if operation == "pause_queue":
        execution_pause_lane(EXECUTION_LANE)
        return {"queue": snapshot()}
    if operation == "resume_queue":
        execution_resume_lane(EXECUTION_LANE)
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
                    if job.get("status") not in {"completed", "failed", "cancelled", "stopped", "interrupted"}
                ],
            }
        }
    raise ValueError("Unsupported inference queue action: " + operation)
