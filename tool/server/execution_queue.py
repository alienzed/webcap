import copy
import json
import os
import secrets
import tempfile
import threading
import time
from pathlib import Path

from . import config as app_config


STATE_VERSION = 1
QUEUE_STATUSES = {"queued"}
BACKLOG_STATUSES = {"backlog"}
PENDING_STATUSES = QUEUE_STATUSES | BACKLOG_STATUSES
ACTIVE_STATUSES = {"starting", "running", "stopping"}
TERMINAL_STATUSES = {"completed", "failed", "cancelled", "stopped", "interrupted"}

_lock = threading.RLock()
_resource_owner = ""


def _state_path():
    return Path(app_config.FS_ROOT) / ".webcap" / "execution_queue.json"


def _default_state():
    return {"version": STATE_VERSION, "lanes": {}}


def _default_lane():
    return {
        "paused": False,
        "pauseReason": "",
        "activeJobId": "",
        "jobs": [],
        "recent": [],
    }


def _read_state():
    path = _state_path()
    if not path.is_file():
        return _default_state()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("Execution queue state is unreadable: " + str(exc)) from exc
    if not isinstance(raw, dict) or raw.get("version") != STATE_VERSION:
        raise RuntimeError("Execution queue state has an unsupported format.")
    if not isinstance(raw.get("lanes"), dict):
        raise RuntimeError("Execution queue lanes are invalid.")
    return raw


def _write_state(state):
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix="execution_queue.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(state, handle, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def _lane(state, lane_name, create=True):
    lane_name = str(lane_name or "").strip()
    if not lane_name:
        raise ValueError("Execution queue lane is required.")
    lanes = state.setdefault("lanes", {})
    lane = lanes.get(lane_name)
    if lane is None:
        if not create:
            return None
        lane = _default_lane()
        lanes[lane_name] = lane
    if not isinstance(lane, dict) or not isinstance(lane.get("jobs"), list):
        raise RuntimeError("Execution queue lane is invalid: " + lane_name)
    recent = lane.get("recent")
    if recent is None:
        lane["recent"] = []
    elif not isinstance(recent, list):
        raise RuntimeError("Execution queue lane recent receipts are invalid: " + lane_name)
    lane.setdefault("paused", False)
    lane.setdefault("pauseReason", "")
    lane.setdefault("activeJobId", "")
    return lane


def _find_job(state, job_id):
    wanted = str(job_id or "").strip()
    if not wanted:
        return None, None
    for lane_name, lane in state.get("lanes", {}).items():
        for job in lane.get("jobs", []):
            if str(job.get("id") or "") == wanted:
                return lane_name, job
    return None, None


def _refresh_positions(lane):
    position = 0
    for job in lane.get("jobs", []):
        if job.get("status") == "queued":
            position += 1
            job["queuePosition"] = position
        else:
            job["queuePosition"] = 0


def _prune_terminal(lane, keep=200):
    terminal = [job for job in lane.get("jobs", []) if job.get("status") in TERMINAL_STATUSES]
    if len(terminal) <= keep:
        return
    remove_ids = {job.get("id") for job in terminal[:-keep]}
    lane["jobs"] = [job for job in lane.get("jobs", []) if job.get("id") not in remove_ids]


def _record_recent(lane, job, keep=80):
    receipt = _public_job(job)
    if not isinstance(receipt, dict):
        return
    recent = lane.setdefault("recent", [])
    recent.append(receipt)
    if len(recent) > keep:
        del recent[:-keep]


def recent_snapshot(lane_name, limit=30):
    try:
        limit = max(1, min(int(limit), 80))
    except (TypeError, ValueError):
        limit = 30
    with _lock:
        state = _read_state()
        lane = _lane(state, lane_name, create=False) or _default_lane()
        recent = lane.get("recent") if isinstance(lane.get("recent"), list) else []
        return [copy.deepcopy(item) for item in reversed(recent[-limit:]) if isinstance(item, dict)]


def _public_job(job):
    if not isinstance(job, dict):
        return None
    result = {}
    for key, value in job.items():
        if key == "payload":
            continue
        result[key] = copy.deepcopy(value)
    return result


def reserve_resource(owner):
    owner = str(owner or "").strip()
    if not owner:
        raise ValueError("Execution resource owner is required.")
    global _resource_owner
    with _lock:
        if _resource_owner:
            return False
        _resource_owner = owner
        return True


def release_resource(owner):
    owner = str(owner or "").strip()
    global _resource_owner
    with _lock:
        if _resource_owner == owner:
            _resource_owner = ""


def resource_owner():
    with _lock:
        return _resource_owner


def enqueue(lane_name, payload, metadata=None, job_id=None, initial_status="queued"):
    initial_status = str(initial_status or "queued").strip()
    if initial_status not in PENDING_STATUSES:
        raise ValueError("Execution queue initial status must be queued or backlog.")
    now = time.time()
    frozen_payload = copy.deepcopy(payload if isinstance(payload, dict) else {})
    frozen_metadata = copy.deepcopy(metadata if isinstance(metadata, dict) else {})
    with _lock:
        state = _read_state()
        lane = _lane(state, lane_name)
        job = {
            "id": str(job_id or secrets.token_hex(12)),
            "lane": str(lane_name),
            "status": initial_status,
            "queuePosition": 0,
            "createdAt": now,
            "updatedAt": now,
            "startedAt": None,
            "finishedAt": None,
            "error": "",
            "metadata": frozen_metadata,
            "details": {},
            "result": {},
            "requestedAction": "",
            "payload": frozen_payload,
        }
        if _find_job(state, job["id"])[1] is not None:
            raise ValueError("Execution queue job ID already exists.")
        lane["jobs"].append(job)
        _prune_terminal(lane)
        _refresh_positions(lane)
        _write_state(state)
        return _public_job(job)


def get_job(job_id, include_payload=False):
    with _lock:
        state = _read_state()
        _lane_name, job = _find_job(state, job_id)
        if job is None:
            raise FileNotFoundError("Execution queue job does not exist.")
        if include_payload:
            return copy.deepcopy(job)
        return _public_job(job)


def consume_terminal_job(job_id):
    """Return and remove a terminal delivery receipt from the execution queue."""
    with _lock:
        state = _read_state()
        lane_name, job = _find_job(state, job_id)
        if job is None:
            raise FileNotFoundError("Execution queue job does not exist.")
        if job.get("status") not in TERMINAL_STATUSES:
            raise ValueError("Only a terminal execution job can be consumed.")
        lane = _lane(state, lane_name)
        result = _public_job(job)
        lane["jobs"] = [item for item in lane.get("jobs", []) if item is not job]
        _refresh_positions(lane)
        _write_state(state)
        return result


def lane_snapshot(lane_name, include_terminal=True):
    with _lock:
        state = _read_state()
        lane = _lane(state, lane_name, create=False) or _default_lane()
        jobs = lane.get("jobs", [])
        if not include_terminal:
            jobs = [job for job in jobs if job.get("status") not in TERMINAL_STATUSES]
        return {
            "lane": str(lane_name),
            "paused": bool(lane.get("paused")),
            "pauseReason": str(lane.get("pauseReason") or ""),
            "activeJobId": str(lane.get("activeJobId") or ""),
            "jobs": [_public_job(job) for job in jobs],
        }


def pause_lane(lane_name, reason="Queue paused by the user."):
    with _lock:
        state = _read_state()
        lane = _lane(state, lane_name)
        lane["paused"] = True
        lane["pauseReason"] = str(reason or "Queue paused.")
        _write_state(state)
        return lane_snapshot(lane_name)


def resume_lane(lane_name):
    with _lock:
        state = _read_state()
        lane = _lane(state, lane_name)
        lane["paused"] = False
        lane["pauseReason"] = ""
        _write_state(state)
        return lane_snapshot(lane_name)


def claim_next(lane_name):
    now = time.time()
    with _lock:
        state = _read_state()
        lane = _lane(state, lane_name)
        if lane.get("paused") or lane.get("activeJobId"):
            return None
        job = next((item for item in lane.get("jobs", []) if item.get("status") == "queued"), None)
        if job is None:
            return None
        job["status"] = "starting"
        job["startedAt"] = now
        job["updatedAt"] = now
        job["queuePosition"] = 0
        lane["activeJobId"] = job["id"]
        _refresh_positions(lane)
        _write_state(state)
        return _public_job(job)


def mark_running(job_id, details=None):
    now = time.time()
    with _lock:
        state = _read_state()
        lane_name, job = _find_job(state, job_id)
        if job is None:
            raise FileNotFoundError("Execution queue job does not exist.")
        lane = _lane(state, lane_name)
        if lane.get("activeJobId") != job["id"]:
            raise RuntimeError("Execution queue job is not the active job for its lane.")
        if job.get("status") == "stopping":
            return _public_job(job)
        if job.get("status") not in {"starting", "running"}:
            raise ValueError("Only a starting execution job can become running.")
        job["status"] = "running"
        if isinstance(details, dict):
            job.setdefault("details", {}).update(copy.deepcopy(details))
        job["updatedAt"] = now
        _write_state(state)
        return _public_job(job)


def update_job(job_id, details):
    if not isinstance(details, dict):
        raise ValueError("Execution queue job details must be an object.")
    now = time.time()
    with _lock:
        state = _read_state()
        _lane_name, job = _find_job(state, job_id)
        if job is None:
            raise FileNotFoundError("Execution queue job does not exist.")
        if job.get("status") in TERMINAL_STATUSES:
            raise ValueError("Execution queue job is already finished.")
        job.setdefault("details", {}).update(copy.deepcopy(details))
        job["updatedAt"] = now
        _write_state(state)
        return _public_job(job)


def finish_job(job_id, status="completed", result=None, error=""):
    if status not in TERMINAL_STATUSES:
        raise ValueError("Execution queue finish status must be terminal.")
    now = time.time()
    with _lock:
        state = _read_state()
        lane_name, job = _find_job(state, job_id)
        if job is None:
            raise FileNotFoundError("Execution queue job does not exist.")
        if job.get("status") not in ACTIVE_STATUSES:
            raise ValueError("Only an active execution job can be finished.")
        lane = _lane(state, lane_name)
        job["status"] = status
        job["finishedAt"] = now
        job["updatedAt"] = now
        job["error"] = str(error or "")
        if isinstance(result, dict):
            job.setdefault("result", {}).update(copy.deepcopy(result))
        if lane.get("activeJobId") == job["id"]:
            lane["activeJobId"] = ""
        _record_recent(lane, job)
        _prune_terminal(lane)
        _refresh_positions(lane)
        _write_state(state)
        return _public_job(job)


def request_stop(job_id):
    now = time.time()
    with _lock:
        state = _read_state()
        lane_name, job = _find_job(state, job_id)
        if job is None:
            raise FileNotFoundError("Execution queue job does not exist.")
        if job.get("status") not in ACTIVE_STATUSES:
            raise ValueError("Only active execution jobs can be stopped.")
        job["requestedAction"] = "stop"
        job["status"] = "stopping"
        job["updatedAt"] = now
        lane = _lane(state, lane_name)
        _refresh_positions(lane)
        _write_state(state)
        return _public_job(job)


def _cancel_pending(job_id, allowed_statuses):
    now = time.time()
    with _lock:
        state = _read_state()
        lane_name, job = _find_job(state, job_id)
        if job is None:
            raise FileNotFoundError("Execution queue job does not exist.")
        if job.get("status") not in allowed_statuses:
            raise ValueError("Only pending execution jobs can be cancelled.")
        lane = _lane(state, lane_name)
        job["status"] = "cancelled"
        job["finishedAt"] = now
        job["updatedAt"] = now
        job["requestedAction"] = ""
        _record_recent(lane, job)
        _refresh_positions(lane)
        _write_state(state)
        return _public_job(job)


def cancel_queued(job_id):
    return _cancel_pending(job_id, QUEUE_STATUSES)


def cancel_pending(job_id):
    return _cancel_pending(job_id, PENDING_STATUSES)


def promote_backlog(job_id):
    now = time.time()
    with _lock:
        state = _read_state()
        lane_name, job = _find_job(state, job_id)
        if job is None:
            raise FileNotFoundError("Execution queue job does not exist.")
        if job.get("status") != "backlog":
            raise ValueError("Only backlogged execution jobs can be queued.")
        lane = _lane(state, lane_name)
        job["status"] = "queued"
        job["updatedAt"] = now
        _refresh_positions(lane)
        _write_state(state)
        return _public_job(job)


def shelve_queued(lane_name):
    now = time.time()
    with _lock:
        state = _read_state()
        lane = _lane(state, lane_name)
        changed = []
        for job in lane.get("jobs", []):
            if job.get("status") != "queued":
                continue
            job["status"] = "backlog"
            job["queuePosition"] = 0
            job["updatedAt"] = now
            changed.append(_public_job(job))
        _refresh_positions(lane)
        _write_state(state)
        return changed


def reorder_job(job_id, direction=None, position=None):
    with _lock:
        state = _read_state()
        lane_name, job = _find_job(state, job_id)
        if job is None:
            raise FileNotFoundError("Execution queue job does not exist.")
        if job.get("status") != "queued":
            raise ValueError("Only queued execution jobs can be reordered.")
        lane = _lane(state, lane_name)
        queued = [item for item in lane.get("jobs", []) if item.get("status") == "queued"]
        current = queued.index(job)
        if position is not None:
            target = max(0, min(len(queued) - 1, int(position)))
        elif direction == "up":
            target = current - 1
        elif direction == "down":
            target = current + 1
        else:
            raise ValueError("Queue reorder requires up, down, or a target position.")
        if target < 0 or target >= len(queued):
            raise ValueError("Execution queue job cannot move further.")
        if target == current:
            return lane_snapshot(lane_name)
        other = queued[target]
        jobs = lane["jobs"]
        a = jobs.index(job)
        b = jobs.index(other)
        jobs[a], jobs[b] = jobs[b], jobs[a]
        now = time.time()
        job["updatedAt"] = now
        other["updatedAt"] = now
        _refresh_positions(lane)
        _write_state(state)
        return lane_snapshot(lane_name)


def recover_lane(lane_name, reason="Execution was interrupted by a WebCap restart."):
    now = time.time()
    with _lock:
        state = _read_state()
        lane = _lane(state, lane_name)
        changed = []
        for job in lane.get("jobs", []):
            if job.get("status") in ACTIVE_STATUSES:
                job["status"] = "interrupted"
                job["finishedAt"] = now
                job["updatedAt"] = now
                job["error"] = str(reason)
                changed.append(_public_job(job))
        lane["activeJobId"] = ""
        _refresh_positions(lane)
        _write_state(state)
    release_resource(lane_name)
    return changed
