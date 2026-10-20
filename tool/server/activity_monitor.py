import logging
import time

from .execution_queue import ExecutionQueueStateError, recent_snapshot as execution_recent_snapshot, resource_owner as execution_resource_owner
from .inference_runner import snapshot as inference_snapshot
from .model_lab import list_runs as model_lab_runs
from .llm_runner import recent_snapshot as llm_recent_snapshot, snapshot as llm_snapshot
from .storage_manager import scan_status as storage_scan_status
from .storyboard_first_cut import snapshot as first_cut_snapshot
from .training_history import recent_jobs as training_recent_jobs
from .training_runner import passive_status_snapshot as training_status_snapshot


_ACTIVE_STATUSES = {"starting", "running", "stopping"}
_TERMINAL_STATUSES = {"completed", "finished_early", "failed", "stopped", "interrupted", "cancelled"}
_logger = logging.getLogger(__name__)


def _usage_token_count(usage, *keys):
    if not isinstance(usage, dict):
        return 0
    for key in keys:
        try:
            value = int(usage.get(key) or 0)
        except (TypeError, ValueError):
            value = 0
        if value > 0:
            return value
    return 0


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
    result = job.get("result") if isinstance(job.get("result"), dict) else {}
    usage = result.get("usage") if isinstance(result.get("usage"), dict) else {}
    return {
        "id": str(job.get("jobId") or job.get("id") or ""),
        "kind": kind,
        "lane": lane,
        "client": client,
        "status": status,
        "label": label,
        "modelId": str(job.get("modelId") or metadata.get("modelId") or ""),
        "modelLabel": str(job.get("modelLabel") or metadata.get("modelLabel") or ""),
        "storyId": str(job.get("storyId") or metadata.get("storyId") or ""),
        "storyTitle": str(job.get("storyTitle") or metadata.get("storyTitle") or ""),
        "sceneId": str(job.get("sceneId") or metadata.get("sceneId") or ""),
        "sceneNumber": int(job.get("sceneNumber") or metadata.get("sceneNumber") or 0),
        "sceneTitle": str(job.get("sceneTitle") or metadata.get("sceneTitle") or ""),
        "folder": str(job.get("folder") or metadata.get("folder") or ""),
        "sessionId": str(job.get("sessionId") or metadata.get("sessionId") or ""),
        "source": str(job.get("source") or metadata.get("source") or ""),
        "operation": str(job.get("operation") or metadata.get("operation") or ""),
        "revisionProgress": job.get("revisionProgress") if isinstance(job.get("revisionProgress"), dict) else {},
        "finishReason": str(result.get("finishReason") or ""),
        "promptTokens": _usage_token_count(usage, "prompt_tokens", "promptTokens", "input_tokens", "inputTokens"),
        "outputTokens": _usage_token_count(usage, "completion_tokens", "completionTokens", "output_tokens", "outputTokens", "eval_count"),
        # Already recorded by the inference runtime; presentation-only projection.
        "progress": job.get("progress") if lane == "inference" and isinstance(job.get("progress"), dict) else {},
        "queuePosition": int(job.get("queuePosition") or 0),
        "createdAt": job.get("createdAt"),
        "startedAt": job.get("startedAt"),
        "finishedAt": job.get("finishedAt"),
        "updatedAt": job.get("updatedAt"),
        "error": str(job.get("error") or ""),
    }


def _training_active_and_queue():
    payload, status_code = training_status_snapshot()
    if status_code != 200 or not payload.get("ok"):
        return [], {
            "queued": 0,
            "paused": False,
            "pauseReason": "",
            "unavailable": True,
            "error": str(payload.get("error") or "Training state is unavailable."),
        }
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


def _training_recent(limit, since=0.0):
    items = []
    for job in training_recent_jobs():
        status = str(job.get("status") or "")
        if status not in _TERMINAL_STATUSES or _finished_at(job) < since:
            continue
        items.append({
            "id": str(job.get("id") or ""),
            "kind": "training",
            "lane": "training",
            "status": status,
            "label": str(job.get("runName") or job.get("profileLabel") or job.get("stages") or "Training"),
            "folder": str(job.get("folder") or ""),
            "stage": str(job.get("stage") or job.get("stages") or ""),
            "startedAt": job.get("startedAt"),
            "finishedAt": job.get("finishedAt"),
            "updatedAt": job.get("updatedAt"),
            "error": str(job.get("error") or ""),
            "completionNote": str(job.get("completionNote") or ""),
        })
    items.sort(key=_finished_at, reverse=True)
    return items[:limit]


def _execution_recent(lane, limit, since=0.0):
    items = []
    recent = llm_recent_snapshot(limit=limit) if lane == "llm" else execution_recent_snapshot(lane, limit=limit)
    for job in recent:
        status = str(job.get("status") or "")
        if status not in _TERMINAL_STATUSES or _finished_at(job) < since:
            continue
        items.append(_execution_item(lane, job))
    return items


def _model_lab_item(run):
    from datetime import datetime
    def timestamp(value):
        if not value:
            return 0.0
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()

    summary = run.get("summary") or {}
    progress = run.get("progress") or {}
    return {
        "id": str(run["id"]),
        "kind": "model-lab",
        "lane": "background",
        "status": str(run.get("status") or ""),
        "label": "Model Assessment",
        "folder": str(run.get("folder") or ""),
        "startedAt": timestamp(run.get("startedAt")),
        "finishedAt": timestamp(run.get("finishedAt")),
        "updatedAt": timestamp(run.get("finishedAt")),
        "error": str(run.get("error") or ""),
        "attemptCount": int(run.get("attemptCount") or 0),
        "modelCount": int(run.get("modelCount") or 0),
        "currentModelRef": str(progress.get("currentModelRef") or ""),
        "currentKind": str(progress.get("currentKind") or ""),
        "phase": str(progress.get("phase") or ""),
        "completed": int(summary.get("completed") or 0),
        "failed": int(summary.get("failed") or 0),
        "skipped": int(summary.get("skipped") or 0),
        "interrupted": int(summary.get("interrupted") or 0),
    }


def activity_snapshot(limit=20, since=0):
    try:
        limit = max(1, min(int(limit), 50))
    except (TypeError, ValueError):
        limit = 20
    try:
        since = max(0.0, float(since or 0))
    except (TypeError, ValueError):
        since = 0.0

    errors = []
    try:
        inference = inference_snapshot(include_terminal=False)
    except ExecutionQueueStateError as exc:
        _logger.exception("Inference activity state is unavailable.")
        errors.append({"area": "inference", "error": str(exc)})
        inference = {"jobs": [], "paused": False, "pauseReason": "", "backlogCount": 0, "unavailable": True}

    try:
        llm = llm_snapshot(include_terminal=False)
    except ExecutionQueueStateError as exc:
        _logger.exception("Director activity state is unavailable.")
        errors.append({"area": "director", "error": str(exc)})
        llm = {"jobs": [], "paused": False, "pauseReason": "", "unavailable": True}

    training_active, training_queue = _training_active_and_queue()
    if training_queue.get("unavailable"):
        errors.append({"area": "training", "error": str(training_queue.get("error") or "Training state is unavailable.")})

    active = []
    for job in inference.get("jobs", []):
        if str(job.get("status") or "") in _ACTIVE_STATUSES:
            active.append(_execution_item("inference", job))
    active_llm_id = str(llm.get("activeJobId") or "")
    for job in llm.get("jobs", []):
        if str(job.get("status") or "") not in _ACTIVE_STATUSES:
            continue
        item = _execution_item("llm", job)
        # The queue owns identity. Runtime telemetry is only a live projection
        # for the matching active job, never for another queued Director request.
        if active_llm_id and item["id"] == active_llm_id:
            from .storyboard_llm_runtime import activity_status
            runtime = activity_status()
            job_started = float(job.get("startedAt") or 0)
            runtime_started = float(runtime.get("startedAt") or 0)
            if (runtime.get("active") and runtime_started >= job_started - 2
                    and str(runtime.get("model") or "") == item["modelId"]):
                slot = runtime.get("slot")
                if isinstance(slot, dict):
                    item["liveTokens"] = slot.get("generatedTokens")
                    item["promptTokensLive"] = slot.get("promptTokens")
                    item["promptProcessed"] = slot.get("promptProcessed")
                    item["contextSize"] = slot.get("contextSize") or runtime.get("contextSize")
                    item["outputLimit"] = slot.get("maxTokens")
                item["runtimePhase"] = str(runtime.get("phase") or "")
                item["runtimeMode"] = str(runtime.get("runtimeMode") or "")
        active.append(item)
    # First Cut is a server-owned batch, not a collection of unrelated LLM jobs.
    # Project the parent and hide its active child from duplicate Activity cards.
    first_cut_batches = first_cut_snapshot().get("batches", [])
    child_ids = {str(batch.get("llmJobId") or "") for batch in first_cut_batches
                 if batch.get("status") in {"queued", "running", "stopping"}}
    child_telemetry = {item["id"]: item for item in active
                       if item.get("lane") == "llm" and item.get("id") in child_ids}
    active = [item for item in active if not (item.get("lane") == "llm" and item.get("id") in child_ids)]
    for batch in first_cut_batches:
        status = str(batch.get("status") or "")
        if status not in {"queued", "running", "stopping"}:
            continue
        phase = str(batch.get("phase") or "")
        detail = str(batch.get("detail") or "")
        total = int(batch.get("sceneCount") or 0)
        completed = 0
        if phase in {"Refining Scenes", "Queuing First Takes"} and "/" in detail:
            try:
                completed = max(0, int(detail.split("/", 1)[0].strip()) - 1)
            except ValueError:
                completed = 0
        stages = ["Expanding Concept", "Defining Continuity", "Developing Scenes",
                  "Refining Scenes", "Queuing First Takes"]
        stage_index = stages.index(phase) if phase in stages else -1
        child = child_telemetry.get(str(batch.get("llmJobId") or ""), {})
        active.append({
            "liveTokens": child.get("liveTokens"), "promptTokensLive": child.get("promptTokensLive"),
            "promptProcessed": child.get("promptProcessed"), "contextSize": child.get("contextSize"),
            "outputLimit": child.get("outputLimit"), "runtimePhase": child.get("runtimePhase"),
            "id": "first-cut:" + str(batch["id"]), "batchId": str(batch["id"]),
            "kind": "first-cut", "lane": "background", "status": status,
            "label": "Storyboard First Cut", "storyId": batch.get("storyId"),
            "modelId": batch.get("modelId"), "phase": phase, "detail": detail,
            "stageIndex": stage_index, "stageCount": len(stages),
            "sceneCount": total, "sceneCompleted": completed,
            "startedAt": batch.get("startedAt") or batch.get("queuedAt"),
            "llmJobId": batch.get("llmJobId"),
        })
    active.extend(training_active)

    # Model Lab is server-owned, not a queued lane. Project its existing
    # persisted receipts; never create competing Activity state.
    try:
        assessments = [_model_lab_item(row) for row in model_lab_runs()]
    except (OSError, ValueError, TypeError) as exc:
        _logger.exception("Model Assessment activity is unavailable.")
        errors.append({"area": "model assessment", "error": str(exc)})
        assessments = []
    active.extend(item for item in assessments if item["status"] == "running")

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

    # Recent receipts are bounded by their owners. Activity does not persist history.
    inference_recent = []
    if not inference.get("unavailable"):
        try:
            inference_recent = _execution_recent("inference", limit, since)
        except ExecutionQueueStateError as exc:
            _logger.exception("Inference recent activity is unavailable.")
            errors.append({"area": "inference", "error": str(exc)})

    llm_recent = []
    if not llm.get("unavailable"):
        try:
            llm_recent = _execution_recent("llm", limit, since)
        except ExecutionQueueStateError as exc:
            _logger.exception("Director recent activity is unavailable.")
            errors.append({"area": "director", "error": str(exc)})

    training_recent = []
    try:
        training_recent = _training_recent(limit, since)
    except ValueError as exc:
        _logger.exception("Training recent activity is unavailable.")
        if not any(item.get("area") == "training" for item in errors):
            errors.append({"area": "training", "error": str(exc)})

    # Keep one completed First Cut parent card; its child Director receipts
    # remain queue-owned but should not flood the session Activity history.
    all_cut_children = {str(job_id) for batch in first_cut_batches
                        for job_id in batch.get("llmJobIds", [])}
    recent = inference_recent + [item for item in llm_recent if item["id"] not in all_cut_children] + training_recent
    for batch in first_cut_batches:
        if batch.get("status") not in {"complete", "failed", "stopped"}:
            continue
        finished = float(batch.get("finishedAt") or 0)
        if finished <= 0 or finished < since:
            continue
        recent.append({
            "id": "first-cut:" + str(batch["id"]), "batchId": str(batch["id"]),
            "kind": "first-cut", "lane": "background",
            "status": {"complete": "completed"}.get(batch["status"], batch["status"]),
            "label": "Storyboard First Cut", "storyId": batch.get("storyId"),
            "modelId": batch.get("modelId"), "phase": batch.get("phase"),
            "detail": batch.get("detail"), "sceneCount": batch.get("sceneCount"),
            "stageCount": 5, "stageIndex": 4,
            "startedAt": batch.get("startedAt") or batch.get("queuedAt"),
            "finishedAt": finished,
        })
    recent.extend(item for item in assessments
                  if item["status"] in _TERMINAL_STATUSES and item["finishedAt"] >= since and item["finishedAt"] > 0)

    if (
        str(scan.get("status") or "") in {"completed", "failed", "cancelled"}
        and scan.get("finishedAt")
        and _finished_at(scan) >= since
    ):
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
        "gpuOwner": execution_resource_owner(),
        "active": active,
        "recent": recent,
        "errors": errors,
        "queues": {
            "inference": {
                "running": sum(1 for job in inference_jobs if str(job.get("status") or "") in _ACTIVE_STATUSES),
                "queued": sum(1 for job in inference_jobs if str(job.get("status") or "") == "queued"),
                "backlog": int(inference.get("backlogCount") or 0),
                "paused": bool(inference.get("paused")),
                "pauseReason": str(inference.get("pauseReason") or ""),
                "unavailable": bool(inference.get("unavailable")),
                "jobs": [
                    _execution_item("inference", job)
                    for job in inference_jobs
                    if str(job.get("status") or "") == "queued"
                ],
            },
            "training": training_queue,
            "director": {
                "running": sum(1 for job in llm_jobs if str(job.get("status") or "") in _ACTIVE_STATUSES),
                "queued": sum(1 for job in llm_jobs if str(job.get("status") or "") == "queued"),
                "paused": bool(llm.get("paused")),
                "pauseReason": str(llm.get("pauseReason") or ""),
                "unavailable": bool(llm.get("unavailable")),
                "jobs": [
                    _execution_item("llm", job)
                    for job in llm_jobs
                    if str(job.get("status") or "") == "queued" and str(job.get("jobId") or "") not in child_ids
                ],
            },
        },
    }
