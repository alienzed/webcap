import copy
import threading
import time

from . import config as app_config
from .execution_queue import (
    cancel_queued,
    claim_next,
    enqueue as execution_enqueue,
    finish_job,
    get_job,
    lane_snapshot,
    mark_running,
    pause_lane,
    recover_lane,
    reorder_job,
    request_action,
    resume_lane,
    update_job,
)
from .inference_runtime import InferenceStopped


EXECUTION_LANE = "inference"
GPU_RESERVATION_OWNER = EXECUTION_LANE
_dispatch_event = threading.Event()
_dispatch_thread = None
_dispatch_lock = threading.Lock()
_startup_reconciled = False


def _reserve_gpu():
    from .training_runner import reserve_gpu_for_external_work
    return reserve_gpu_for_external_work(GPU_RESERVATION_OWNER)


def _release_gpu():
    from .training_runner import release_gpu_for_external_work
    release_gpu_for_external_work(GPU_RESERVATION_OWNER)


def _ensure_startup_reconciled():
    global _startup_reconciled
    if _startup_reconciled:
        return
    with _dispatch_lock:
        if _startup_reconciled:
            return
        recover_lane(
            EXECUTION_LANE,
            reason="Inference was interrupted by a WebCap restart.",
        )
        _startup_reconciled = True


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


def _execute_claimed(job_id):
    job = get_job(job_id, include_payload=True)
    payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}
    client = str((job.get("metadata") or {}).get("client") or "")
    request = payload.get("request") if isinstance(payload.get("request"), dict) else None
    if request is None:
        raise RuntimeError("Inference job is missing its frozen request.")

    mark_running(job_id, details={"providerStatus": "starting"})
    if client == "generate":
        from .generate_generation import execute
        result = execute(job_id, request)
    else:
        raise RuntimeError("Unsupported inference client: " + (client or "empty"))
    finish_job(job_id, status="completed", result=result)


def _dispatch_once():
    snapshot = lane_snapshot(EXECUTION_LANE, include_terminal=False)
    if snapshot.get("paused") or snapshot.get("activeJobId"):
        return False
    if not any(job.get("status") == "queued" for job in snapshot.get("jobs", [])):
        return False
    if not _reserve_gpu():
        return False

    claimed = claim_next(EXECUTION_LANE)
    if claimed is None:
        _release_gpu()
        return False

    job_id = str(claimed.get("id") or "")
    try:
        _execute_claimed(job_id)
    except InferenceStopped as exc:
        finish_job(job_id, status=exc.status, error=str(exc))
    except Exception as exc:
        app_config.debug_print("[inference] ERROR:", exc)
        app_config.debug_traceback()
        finish_job(job_id, status="failed", error=str(exc))
    finally:
        _release_gpu()
    return True


def _dispatch_loop():
    while True:
        _dispatch_event.wait(timeout=2)
        _dispatch_event.clear()
        try:
            _ensure_startup_reconciled()
            while _dispatch_once():
                pass
        except Exception as exc:
            app_config.debug_print("[inference] DISPATCH ERROR:", exc)
            app_config.debug_traceback()
        snapshot = lane_snapshot(EXECUTION_LANE, include_terminal=False)
        if any(job.get("status") == "queued" for job in snapshot.get("jobs", [])):
            time.sleep(1)
            _dispatch_event.set()


def ensure_started():
    global _dispatch_thread
    _ensure_startup_reconciled()
    with _dispatch_lock:
        if _dispatch_thread is not None and _dispatch_thread.is_alive():
            return
        _dispatch_thread = threading.Thread(
            target=_dispatch_loop,
            daemon=True,
            name="webcap-inference-dispatch",
        )
        _dispatch_thread.start()
    _dispatch_event.set()


def enqueue_generate(request, label=""):
    ensure_started()
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
    _dispatch_event.set()
    return _job_view(job)


def snapshot(include_terminal=False):
    ensure_started()
    current = lane_snapshot(EXECUTION_LANE, include_terminal=include_terminal)
    return {
        "paused": bool(current.get("paused")),
        "pauseReason": str(current.get("pauseReason") or ""),
        "activeJobId": str(current.get("activeJobId") or ""),
        "jobs": [_job_view(job) for job in current.get("jobs", [])],
    }


def job_status(job_id):
    ensure_started()
    return _job_view(get_job(str(job_id or "").strip()))


def action(operation, job_id="", direction="", position=None):
    ensure_started()
    operation = str(operation or "").strip()
    job_id = str(job_id or "").strip()
    if operation == "cancel":
        result = cancel_queued(job_id)
        _dispatch_event.set()
        return {"job": _job_view(result)}
    if operation == "stop":
        result = request_action(job_id, "stop")
        return {"job": _job_view(result)}
    if operation == "pause_queue":
        pause_lane(EXECUTION_LANE)
        return {"queue": snapshot()}
    if operation == "resume_queue":
        resume_lane(EXECUTION_LANE)
        _dispatch_event.set()
        return {"queue": snapshot()}
    if operation == "reorder":
        current = reorder_job(
            job_id,
            direction=str(direction or "").strip() or None,
            position=position,
        )
        return {
            "queue": {
                "paused": bool(current.get("paused")),
                "pauseReason": str(current.get("pauseReason") or ""),
                "activeJobId": str(current.get("activeJobId") or ""),
                "jobs": [_job_view(job) for job in current.get("jobs", []) if job.get("status") not in {"completed", "failed", "cancelled", "stopped", "interrupted"}],
            }
        }
    raise ValueError("Unsupported inference queue action: " + operation)
