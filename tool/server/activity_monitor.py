import time

from .inference_runner import snapshot as inference_snapshot
from .llm_runner import snapshot as llm_snapshot
from .storage_manager import scan_status as storage_scan_status
from .training_history import recent_jobs as training_recent_jobs
from .training_runner import status_response as training_status_response


_ACTIVE_STATUSES = {"starting", "running", "stopping"}
_TERMINAL_STATUSES = {"completed", "finished_early", "failed", "stopped", "interrupted", "cancelled"}


def _finished_at(item):
    try:
        return float(item.get("finishedAt") or item.get("updatedAt") or 0)
    except (TypeError, ValueError):
        return 0.0


def _execution_item(lane, job):
    metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
    status = str(job.get("status") or "")
    client = str(job.get("client") or metadata.get("client") or "")
    label = str(job.get("label") or metadata.get("label") or "")
    if lane == "inference":
        kind = client if client in {"generate", "storyboard", "test"} else "generate"
    else:
        kind = "director"
    return {
        "id": str(job.get("jobId") or job.get("id") or ""),
        "kind": kind,
        "lane": lane,
        "client": client,
        "status": status,
        "label": label,
        "modelId": str(job.get("modelId") or metadata.get("modelId") or ""),
        "storyId": str(job.get("storyId") or metadata.get("storyId") or ""),
        "sceneId": str(job.get("sceneId") or metadata.get("sceneId") or ""),
        "folder": str(job.get("folder") or metadata.get("folder") or ""),
        "sessionId": str(job.get("sessionId") or metadata.get("sessionId") or ""),
        "operation": str(job.get("operation") or metadata.get("operation") or ""),
        "queuePosition": int(job.get("queuePosition") or 0),
        "createdAt": job.get("createdAt"),
        "startedAt": job.get("startedAt"),
        "finishedAt": job.get("finishedAt"),
        "updatedAt": job.get("updatedAt"),
        "error": str(job.get("error") or ""),
    }


def _training_active_and_queue():
    payload, status_code = training_status_response()
    if status_code != 200 or not payload.get("ok"):
        return [], {"queued": 0, "paused": False, "pauseReason": ""}
    jobs = payload.get("jobs") if isinstance(payload.get("jobs"), list) else []
    active = []
    for job in jobs:
        status = str(job.get("status") or "")
        if status not in _ACTIVE_STATUSES:
            continue
        active.append({
            "id": str(job.get("id") or ""),
            "kind": "training",
            "lane": "training",
            "status": status,
            "label": str(job.get("runName") or job.get("profileLabel") or job.get("stages") or "Training"),
            "folder": str(job.get("folder") or ""),
            "stage": str(job.get("stage") or job.get("stages") or ""),
            "startedAt": job.get("startedAt"),
            "updatedAt": job.get("updatedAt"),
            "progress": job.get("progress") if isinstance(job.get("progress"), dict) else {},
            "progressPlan": job.get("progressPlan") if isinstance(job.get("progressPlan"), dict) else {},
        })
    queued = sum(1 for job in jobs if str(job.get("status") or "") == "queued")
    return active, {
        "queued": queued,
        "paused": bool(payload.get("queuePaused")),
        "pauseReason": str(payload.get("queuePauseReason") or ""),
    }


def _training_recent(limit):
    items = []
    for job in training_recent_jobs():
        status = str(job.get("status") or "")
        if status not in _TERMINAL_STATUSES:
            continue
        items.append({
            "id": str(job.get("id") or ""),
            "kind": "training",
            "lane": "training",
            "status": status,
            "label": str(job.get("runName") or job.get("profileLabel") or job.get("stages") or "Training"),
            "folder": str(job.get("folder") or ""),
            "stage": str(job.get("stage") or job.get("stages") or ""),
            "finishedAt": job.get("finishedAt"),
            "updatedAt": job.get("updatedAt"),
            "error": str(job.get("error") or ""),
            "completionNote": str(job.get("completionNote") or ""),
        })
    items.sort(key=_finished_at, reverse=True)
    return items[:limit]


def activity_snapshot(limit=20):
    try:
        limit = max(1, min(int(limit), 50))
    except (TypeError, ValueError):
        limit = 20

    inference = inference_snapshot(include_terminal=False)
    llm = llm_snapshot(include_terminal=False)
    training_active, training_queue = _training_active_and_queue()

    active = []
    for job in inference.get("jobs", []):
        if str(job.get("status") or "") in _ACTIVE_STATUSES:
            active.append(_execution_item("inference", job))
    for job in llm.get("jobs", []):
        if str(job.get("status") or "") in _ACTIVE_STATUSES:
            active.append(_execution_item("llm", job))
    active.extend(training_active)

    scan_payload = storage_scan_status()
    scan = scan_payload.get("scan") if isinstance(scan_payload, dict) and isinstance(scan_payload.get("scan"), dict) else {}
    if str(scan.get("status") or "") in {"running", "cancelling"}:
        active.append({
            "id": str(scan.get("id") or "storage-scan"),
            "kind": "storage",
            "lane": "background",
            "status": str(scan.get("status") or ""),
            "label": "Storage scan",
            "folder": str(scan.get("folder") or ""),
            "startedAt": scan.get("startedAt"),
            "updatedAt": time.time(),
            "phase": str(scan.get("phase") or ""),
            "current": str(scan.get("current") or ""),
            "itemsMeasured": int(scan.get("itemsMeasured") or 0),
            "itemsTotal": int(scan.get("itemsTotal") or 0),
            "bytesScanned": int(scan.get("bytesScanned") or 0),
        })

    # Inference and LLM completion receipts are intentionally session-only.
    # Durable Recent history is reserved for workflows where history itself is
    # useful, such as Training (plus the current storage scan receipt below).
    recent = _training_recent(limit)

    if str(scan.get("status") or "") in {"completed", "failed", "cancelled"} and scan.get("finishedAt"):
        recent.append({
            "id": str(scan.get("id") or "storage-scan"),
            "kind": "storage",
            "lane": "background",
            "status": str(scan.get("status") or ""),
            "label": "Storage scan",
            "folder": str(scan.get("folder") or ""),
            "finishedAt": scan.get("finishedAt"),
            "updatedAt": scan.get("finishedAt"),
            "error": str(scan.get("error") or scan.get("lastError") or ""),
        })

    recent.sort(key=_finished_at, reverse=True)
    recent = recent[:limit]

    inference_jobs = inference.get("jobs") if isinstance(inference.get("jobs"), list) else []
    llm_jobs = llm.get("jobs") if isinstance(llm.get("jobs"), list) else []

    return {
        "ok": True,
        "active": active,
        "recent": recent,
        "queues": {
            "inference": {
                "running": sum(1 for job in inference_jobs if str(job.get("status") or "") in _ACTIVE_STATUSES),
                "queued": sum(1 for job in inference_jobs if str(job.get("status") or "") == "queued"),
                "backlog": int(inference.get("backlogCount") or 0),
                "paused": bool(inference.get("paused")),
                "pauseReason": str(inference.get("pauseReason") or ""),
            },
            "training": training_queue,
            "director": {
                "running": sum(1 for job in llm_jobs if str(job.get("status") or "") in _ACTIVE_STATUSES),
                "queued": sum(1 for job in llm_jobs if str(job.get("status") or "") == "queued"),
                "paused": bool(llm.get("paused")),
                "pauseReason": str(llm.get("pauseReason") or ""),
            },
        },
    }
