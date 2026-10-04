import copy
import json
import logging
import os
import secrets
import tempfile
import threading
import time
from pathlib import Path

from . import config as app_config


STATE_VERSION = 1
_logger = logging.getLogger(__name__)


class ExecutionQueueStateError(RuntimeError):
    pass


QUEUE_STATUSES = {"queued"}
BACKLOG_STATUSES = {"backlog"}
PENDING_STATUSES = QUEUE_STATUSES | BACKLOG_STATUSES
ACTIVE_STATUSES = {"starting", "running", "stopping"}
TERMINAL_STATUSES = {"completed", "failed", "cancelled", "stopped", "interrupted"}

_lock = threading.RLock()
RESOURCE_OWNERS = {"training", "llm", "inference"}
_resource_owner = ""
_transient_receipts = {}
_TRANSIENT_RECEIPT_LIMIT = 200


def _state_path():
    return app_config.execution_queue_state_path()


def _default_state():
    return {"version": STATE_VERSION, "lanes": {}}


def _default_lane():
    return {
        "paused": False,
        "pauseReason": "",
        "activeJobId": "",
        "jobs": [],
        "recent": [],
        "guards": {},
    }


def _read_state():
    path = _state_path()
    try:
        path.stat()
    except FileNotFoundError:
        return _default_state()
    except OSError as exc:
        raise ExecutionQueueStateError("Execution queue state cannot be inspected: " + str(exc)) from exc
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ExecutionQueueStateError("Execution queue state is unreadable: " + str(exc)) from exc
    if not isinstance(raw, dict) or raw.get("version") != STATE_VERSION:
        raise ExecutionQueueStateError("Execution queue state has an unsupported format.")
    if not isinstance(raw.get("lanes"), dict):
        raise ExecutionQueueStateError("Execution queue lanes are invalid.")
    return raw


def recover_invalid_startup_state():
    """Move aside malformed runtime queue bookkeeping before workers start."""
    path = _state_path()
    try:
        path.stat()
    except FileNotFoundError:
        return False
    except OSError as exc:
        raise ExecutionQueueStateError(
            "Execution queue state cannot be inspected: " + str(exc)
        ) from exc

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        reason = "unreadable JSON: " + str(exc)
    except OSError as exc:
        raise ExecutionQueueStateError(
            "Execution queue state cannot be read: " + str(exc)
        ) from exc
    else:
        reason = ""
        if not isinstance(raw, dict) or raw.get("version") != STATE_VERSION:
            reason = "unsupported format"
        elif not isinstance(raw.get("lanes"), dict):
            reason = "invalid lanes"
        else:
            try:
                for lane_name in raw.get("lanes", {}):
                    _lane(raw, lane_name, create=False)
            except ExecutionQueueStateError as exc:
                reason = str(exc)
            if not reason:
                return False

    backup = path.with_name(
        "execution_queue.invalid-" + str(int(time.time() * 1000)) + ".json"
    )
    try:
        os.replace(path, backup)
    except OSError as exc:
        raise ExecutionQueueStateError(
            "Execution queue state is invalid and could not be moved aside: " + str(exc)
        ) from exc
    _logger.error(
        "Execution queue runtime state was invalid at startup and has been moved aside to %s: %s",
        backup,
        reason,
    )
    return True


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
        raise ExecutionQueueStateError("Execution queue lane is invalid: " + lane_name)
    recent = lane.get("recent")
    if recent is None:
        lane["recent"] = []
    elif not isinstance(recent, list):
        raise ExecutionQueueStateError("Execution queue lane recent receipts are invalid: " + lane_name)
    guards = lane.get("guards")
    if guards is None:
        lane["guards"] = {}
    elif not isinstance(guards, dict):
        raise ExecutionQueueStateError("Execution queue lane guards are invalid: " + lane_name)
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


def _remember_transient_receipt(receipt):
    if not isinstance(receipt, dict):
        return
    job_id = str(receipt.get("id") or "").strip()
    if not job_id:
        return
    _transient_receipts[job_id] = copy.deepcopy(receipt)
    while len(_transient_receipts) > _TRANSIENT_RECEIPT_LIMIT:
        _transient_receipts.pop(next(iter(_transient_receipts)))


def transient_receipt(job_id, consume=False):
    job_id = str(job_id or "").strip()
    with _lock:
        receipt = _transient_receipts.get(job_id)
        if receipt is None:
            raise FileNotFoundError("Execution queue job does not exist.")
        result = copy.deepcopy(receipt)
        if consume:
            _transient_receipts.pop(job_id, None)
        return result


def clear_transient_receipts(lane_name=""):
    lane_name = str(lane_name or "").strip()
    with _lock:
        if not lane_name:
            _transient_receipts.clear()
            return
        remove_ids = [
            job_id for job_id, receipt in _transient_receipts.items()
            if str(receipt.get("lane") or "") == lane_name
        ]
        for job_id in remove_ids:
            _transient_receipts.pop(job_id, None)


def lane_guard(lane_name, name, default=None):
    name = str(name or "").strip()
    if not name:
        raise ValueError("Execution queue lane guard name is required.")
    with _lock:
        state = _read_state()
        lane = _lane(state, lane_name, create=False) or _default_lane()
        guards = lane.get("guards") if isinstance(lane.get("guards"), dict) else {}
        return copy.deepcopy(guards.get(name, default))


def set_lane_guard(lane_name, name, value):
    name = str(name or "").strip()
    if not name:
        raise ValueError("Execution queue lane guard name is required.")
    with _lock:
        state = _read_state()
        lane = _lane(state, lane_name)
        guards = lane.setdefault("guards", {})
        if value is None:
            guards.pop(name, None)
        else:
            guards[name] = copy.deepcopy(value)
        _write_state(state)
        return copy.deepcopy(guards.get(name))


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


class EphemeralExecutionQueue:
    """In-memory execution lane with the same job semantics as the durable queue."""

    def __init__(self, lane_name):
        lane_name = str(lane_name or "").strip()
        if lane_name != "llm":
            raise ValueError("Only the LLM lane is currently ephemeral.")
        self.lane_name = lane_name
        self._state = {"version": STATE_VERSION, "lanes": {lane_name: _default_lane()}}

    def _lane(self):
        return self._state["lanes"][self.lane_name]

    def enqueue(self, payload, metadata=None, job_id=None, initial_status="queued"):
        if initial_status not in QUEUE_STATUSES:
            raise ValueError("Ephemeral execution queue initial status must be queued.")
        now = time.time()
        with _lock:
            lane = self._lane()
            job = {
                "id": str(job_id or secrets.token_hex(12)),
                "lane": self.lane_name,
                "status": initial_status,
                "queuePosition": 0,
                "createdAt": now,
                "updatedAt": now,
                "startedAt": None,
                "finishedAt": None,
                "error": "",
                "metadata": copy.deepcopy(metadata if isinstance(metadata, dict) else {}),
                "details": {},
                "result": {},
                "requestedAction": "",
                "payload": copy.deepcopy(payload if isinstance(payload, dict) else {}),
            }
            if any(item.get("id") == job["id"] for item in lane.get("jobs", [])):
                raise ValueError("Execution queue job ID already exists.")
            lane["jobs"].append(job)
            _prune_terminal(lane)
            _refresh_positions(lane)
            return _public_job(job)

    def _find_job(self, job_id):
        wanted = str(job_id or "").strip()
        if not wanted:
            return None
        for job in self._lane().get("jobs", []):
            if str(job.get("id") or "") == wanted:
                return job
        return None

    def get_job(self, job_id, include_payload=False):
        with _lock:
            job = self._find_job(job_id)
            if job is None:
                raise FileNotFoundError("Execution queue job does not exist.")
            if include_payload:
                return copy.deepcopy(job)
            return _public_job(job)

    def consume_terminal_job(self, job_id):
        with _lock:
            job = self._find_job(job_id)
            if job is None:
                raise FileNotFoundError("Execution queue job does not exist.")
            if job.get("status") not in TERMINAL_STATUSES:
                raise ValueError("Only a terminal execution job can be consumed.")
            result = _public_job(job)
            lane = self._lane()
            lane["jobs"] = [item for item in lane.get("jobs", []) if item is not job]
            _refresh_positions(lane)
            return result

    def lane_snapshot(self, include_terminal=True):
        with _lock:
            lane = self._lane()
            jobs = lane.get("jobs", [])
            if not include_terminal:
                jobs = [job for job in jobs if job.get("status") not in TERMINAL_STATUSES]
            return {
                "lane": self.lane_name,
                "paused": bool(lane.get("paused")),
                "pauseReason": str(lane.get("pauseReason") or ""),
                "activeJobId": str(lane.get("activeJobId") or ""),
                "jobs": [_public_job(job) for job in jobs],
            }

    def pause_lane(self, reason="Queue paused by the user."):
        with _lock:
            lane = self._lane()
            lane["paused"] = True
            lane["pauseReason"] = str(reason or "Queue paused.")
            return self.lane_snapshot()

    def resume_lane(self):
        with _lock:
            lane = self._lane()
            lane["paused"] = False
            lane["pauseReason"] = ""
            return self.lane_snapshot()

    def claim_next(self, expected_job_id=""):
        now = time.time()
        expected_job_id = str(expected_job_id or "").strip()
        with _lock:
            lane = self._lane()
            if lane.get("paused") or lane.get("activeJobId"):
                return None
            job = next((item for item in lane.get("jobs", []) if item.get("status") == "queued"), None)
            if job is None:
                return None
            if expected_job_id and str(job.get("id") or "") != expected_job_id:
                return None
            job["status"] = "starting"
            job["startedAt"] = now
            job["updatedAt"] = now
            job["queuePosition"] = 0
            lane["activeJobId"] = job["id"]
            _refresh_positions(lane)
            return _public_job(job)

    def mark_running(self, job_id, details=None):
        now = time.time()
        with _lock:
            job = self._find_job(job_id)
            if job is None:
                raise FileNotFoundError("Execution queue job does not exist.")
            lane = self._lane()
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
            return _public_job(job)

    def update_job(self, job_id, details):
        if not isinstance(details, dict):
            raise ValueError("Execution queue job details must be an object.")
        now = time.time()
        with _lock:
            job = self._find_job(job_id)
            if job is None:
                raise FileNotFoundError("Execution queue job does not exist.")
            if job.get("status") in TERMINAL_STATUSES:
                raise ValueError("Execution queue job is already finished.")
            job.setdefault("details", {}).update(copy.deepcopy(details))
            job["updatedAt"] = now
            return _public_job(job)

    def finish_job_transient(self, job_id, status="completed", result=None, error=""):
        if status not in TERMINAL_STATUSES:
            raise ValueError("Execution queue finish status must be terminal.")
        now = time.time()
        with _lock:
            job = self._find_job(job_id)
            if job is None:
                raise FileNotFoundError("Execution queue job does not exist.")
            if job.get("status") not in ACTIVE_STATUSES:
                raise ValueError("Only an active execution job can be finished.")
            lane = self._lane()
            job["status"] = status
            job["finishedAt"] = now
            job["updatedAt"] = now
            job["error"] = str(error or "")
            if isinstance(result, dict):
                job.setdefault("result", {}).update(copy.deepcopy(result))
            receipt = _public_job(job)
            _record_recent(lane, job)
            lane["jobs"] = [item for item in lane.get("jobs", []) if item is not job]
            if lane.get("activeJobId") == job["id"]:
                lane["activeJobId"] = ""
            _refresh_positions(lane)
            _remember_transient_receipt(receipt)
            return receipt

    def reset_unfinished(self):
        """Stop the active job and cancel every queued job in this ephemeral lane."""
        now = time.time()
        with _lock:
            lane = self._lane()
            active_id = str(lane.get("activeJobId") or "")
            kept = []
            for job in lane.get("jobs", []):
                status = str(job.get("status") or "")
                if status in PENDING_STATUSES:
                    job["status"] = "cancelled"
                    job["finishedAt"] = now
                    job["updatedAt"] = now
                    job["requestedAction"] = ""
                    _record_recent(lane, job)
                    _remember_transient_receipt(_public_job(job))
                    continue
                if active_id and str(job.get("id") or "") == active_id and status in ACTIVE_STATUSES:
                    job["status"] = "stopping"
                    job["updatedAt"] = now
                    job["requestedAction"] = "stop"
                kept.append(job)
            lane["jobs"] = kept
            _refresh_positions(lane)
            return self.lane_snapshot(include_terminal=False)

    def reorder_job(self, job_id, direction=None, position=None):
        with _lock:
            job = self._find_job(job_id)
            if job is None:
                raise FileNotFoundError("Execution queue job does not exist.")
            if job.get("status") != "queued":
                raise ValueError("Only queued execution jobs can be reordered.")
            lane = self._lane()
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
                return self.lane_snapshot()
            other = queued[target]
            jobs = lane["jobs"]
            a = jobs.index(job)
            b = jobs.index(other)
            jobs[a], jobs[b] = jobs[b], jobs[a]
            now = time.time()
            job["updatedAt"] = now
            other["updatedAt"] = now
            _refresh_positions(lane)
            return self.lane_snapshot()

    def clear(self):
        with _lock:
            self._state = {"version": STATE_VERSION, "lanes": {self.lane_name: _default_lane()}}
            clear_transient_receipts(self.lane_name)

    def recent_snapshot(self, limit=30):
        try:
            limit = max(1, min(int(limit), 80))
        except (TypeError, ValueError):
            limit = 30
        with _lock:
            recent = self._lane().get("recent") if isinstance(self._lane().get("recent"), list) else []
            return [copy.deepcopy(item) for item in reversed(recent[-limit:]) if isinstance(item, dict)]


_ephemeral_queues = {}


def ephemeral_lane(lane_name):
    lane_name = str(lane_name or "").strip()
    if lane_name != "llm":
        raise ValueError("Only the LLM lane is currently ephemeral.")
    with _lock:
        queue = _ephemeral_queues.get(lane_name)
        if queue is None:
            queue = EphemeralExecutionQueue(lane_name)
            _ephemeral_queues[lane_name] = queue
        return queue


def reserve_resource(owner):
    owner = str(owner or "").strip()
    if owner not in RESOURCE_OWNERS:
        raise ValueError("Execution resource owner must be training, llm, or inference.")
    global _resource_owner
    with _lock:
        if _resource_owner:
            return False
        _resource_owner = owner
        _logger.info("GPU resource owner: none -> %s", owner)
        return True


def release_resource(owner):
    owner = str(owner or "").strip()
    if owner not in RESOURCE_OWNERS:
        raise ValueError("Execution resource owner must be training, llm, or inference.")
    global _resource_owner
    with _lock:
        if _resource_owner == owner:
            _logger.info("GPU resource owner: %s -> none", owner)
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


def claim_next(lane_name, runnable_backlog_ids=None, expected_job_id=""):
    now = time.time()
    runnable_backlog_ids = {
        str(job_id or "").strip()
        for job_id in (runnable_backlog_ids or ())
        if str(job_id or "").strip()
    }
    expected_job_id = str(expected_job_id or "").strip()
    with _lock:
        state = _read_state()
        lane = _lane(state, lane_name)
        if lane.get("paused") or lane.get("activeJobId"):
            return None
        jobs = lane.get("jobs", [])
        job = next((item for item in jobs if item.get("status") == "queued"), None)
        if job is None:
            job = next(
                (
                    item
                    for item in jobs
                    if item.get("status") == "backlog"
                    and str(item.get("id") or "") in runnable_backlog_ids
                ),
                None,
            )
        if job is None:
            return None
        if expected_job_id and str(job.get("id") or "") != expected_job_id:
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


def requeue_active_and_pause(job_id, reason):
    """Return one active job to pending state and pause its lane atomically."""
    now = time.time()
    with _lock:
        state = _read_state()
        lane_name, job = _find_job(state, job_id)
        if job is None:
            raise FileNotFoundError("Execution queue job does not exist.")
        if job.get("status") not in ACTIVE_STATUSES:
            raise ValueError("Only active execution work can be returned to the queue.")
        lane = _lane(state, lane_name)
        job["status"] = "queued"
        job["startedAt"] = None
        job["finishedAt"] = None
        job["error"] = ""
        job["requestedAction"] = ""
        job["details"] = {}
        job["result"] = {}
        job["updatedAt"] = now
        lane["activeJobId"] = ""
        lane["paused"] = True
        lane["pauseReason"] = str(reason or "Queue paused after an execution error.")
        _refresh_positions(lane)
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


def finish_job_transient(job_id, status="completed", result=None, error=""):
    """Finish an active job and remove it from durable queue state in one write."""
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
        receipt = _public_job(job)
        _record_recent(lane, job)
        lane["jobs"] = [item for item in lane.get("jobs", []) if item is not job]
        if lane.get("activeJobId") == job["id"]:
            lane["activeJobId"] = ""
        _refresh_positions(lane)
        _write_state(state)
        _remember_transient_receipt(receipt)
        return receipt


def resolve_job_transient(job_id, status="completed", result=None, error=""):
    """Resolve pending or active work without creating durable terminal history."""
    if status not in TERMINAL_STATUSES:
        raise ValueError("Execution queue resolve status must be terminal.")
    now = time.time()
    with _lock:
        state = _read_state()
        lane_name, job = _find_job(state, job_id)
        if job is None:
            raise FileNotFoundError("Execution queue job does not exist.")
        if job.get("status") not in (PENDING_STATUSES | ACTIVE_STATUSES):
            raise ValueError("Only pending or active execution work can be resolved.")
        lane = _lane(state, lane_name)
        job["status"] = status
        job["finishedAt"] = now
        job["updatedAt"] = now
        job["error"] = str(error or "")
        job["requestedAction"] = ""
        if isinstance(result, dict):
            job.setdefault("result", {}).update(copy.deepcopy(result))
        receipt = _public_job(job)
        _record_recent(lane, job)
        lane["jobs"] = [item for item in lane.get("jobs", []) if item is not job]
        if lane.get("activeJobId") == job["id"]:
            lane["activeJobId"] = ""
        _refresh_positions(lane)
        _write_state(state)
        _remember_transient_receipt(receipt)
        return receipt


def cancel_pending_transient(job_id):
    """Cancel pending work without creating durable terminal history."""
    now = time.time()
    with _lock:
        state = _read_state()
        lane_name, job = _find_job(state, job_id)
        if job is None:
            raise FileNotFoundError("Execution queue job does not exist.")
        if job.get("status") not in PENDING_STATUSES:
            raise ValueError("Only pending execution jobs can be cancelled.")
        lane = _lane(state, lane_name)
        job["status"] = "cancelled"
        job["finishedAt"] = now
        job["updatedAt"] = now
        job["requestedAction"] = ""
        receipt = _public_job(job)
        lane["jobs"] = [item for item in lane.get("jobs", []) if item is not job]
        _refresh_positions(lane)
        _write_state(state)
        _remember_transient_receipt(receipt)
        return receipt


def cancel_all_pending_transient(lane_name):
    """Cancel all pending work without creating durable terminal history."""
    now = time.time()
    with _lock:
        state = _read_state()
        lane = _lane(state, lane_name)
        cancelled = []
        kept = []
        for job in lane.get("jobs", []):
            if job.get("status") not in PENDING_STATUSES:
                kept.append(job)
                continue
            job["status"] = "cancelled"
            job["finishedAt"] = now
            job["updatedAt"] = now
            job["requestedAction"] = ""
            receipt = _public_job(job)
            cancelled.append(receipt)
        lane["jobs"] = kept
        _refresh_positions(lane)
        _write_state(state)
        for receipt in cancelled:
            _remember_transient_receipt(receipt)
        return cancelled


def shelve_unfinished(lane_name):
    """Return queued or formerly active work to inert backlog state."""
    now = time.time()
    with _lock:
        state = _read_state()
        lane = _lane(state, lane_name)
        changed = []
        for job in lane.get("jobs", []):
            if job.get("status") not in (PENDING_STATUSES | ACTIVE_STATUSES):
                continue
            if job.get("status") == "backlog":
                continue
            job["status"] = "backlog"
            job["queuePosition"] = 0
            job["startedAt"] = None
            job["finishedAt"] = None
            job["error"] = ""
            job["requestedAction"] = ""
            job["details"] = {}
            job["result"] = {}
            job["updatedAt"] = now
            changed.append(_public_job(job))
        lane["activeJobId"] = ""
        _refresh_positions(lane)
        _write_state(state)
    return changed


def discard_terminal_and_recent(lane_name):
    """Remove legacy terminal/history records while preserving unfinished work."""
    clear_transient_receipts(lane_name)
    with _lock:
        state = _read_state()
        lane = _lane(state, lane_name)
        lane["jobs"] = [
            job for job in lane.get("jobs", [])
            if job.get("status") not in TERMINAL_STATUSES
        ]
        lane["recent"] = []
        _refresh_positions(lane)
        _write_state(state)


def discard_persisted_lane(lane_name):
    """Discard only the durable state for a lane during a lifecycle migration."""
    lane_name = str(lane_name or "").strip()
    if not lane_name:
        raise ValueError("Execution queue lane is required.")
    with _lock:
        state = _read_state()
        removed = state.setdefault("lanes", {}).pop(lane_name, None) is not None
        if removed:
            _write_state(state)
        return removed


def clear_lane(lane_name):
    """Discard all durable state for an execution lane."""
    clear_transient_receipts(lane_name)
    with _lock:
        state = _read_state()
        state.setdefault("lanes", {}).pop(str(lane_name), None)
        _write_state(state)


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


def cancel_all_pending(lane_name):
    now = time.time()
    with _lock:
        state = _read_state()
        lane = _lane(state, lane_name)
        cancelled = []
        for job in lane.get("jobs", []):
            if job.get("status") not in PENDING_STATUSES:
                continue
            job["status"] = "cancelled"
            job["finishedAt"] = now
            job["updatedAt"] = now
            job["requestedAction"] = ""
            _record_recent(lane, job)
            cancelled.append(_public_job(job))
        _refresh_positions(lane)
        _write_state(state)
        return cancelled


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


def promote_all_backlog(lane_name):
    """Move every backlogged job to the end of the runnable queue, preserving FIFO order."""
    now = time.time()
    with _lock:
        state = _read_state()
        lane = _lane(state, lane_name)
        jobs = lane["jobs"]
        backlog = [job for job in jobs if job.get("status") == "backlog"]
        if not backlog:
            return []

        remaining = [job for job in jobs if job.get("status") != "backlog"]
        insert_at = 0
        for index, item in enumerate(remaining):
            if item.get("status") in ACTIVE_STATUSES or item.get("status") == "queued":
                insert_at = index + 1

        for job in backlog:
            job["status"] = "queued"
            job["updatedAt"] = now

        lane["jobs"] = remaining[:insert_at] + backlog + remaining[insert_at:]
        _refresh_positions(lane)
        _write_state(state)
        return [_public_job(job) for job in backlog]


def promote_backlog(job_id):
    """Move one backlogged job to the end of the runnable queue."""
    now = time.time()
    with _lock:
        state = _read_state()
        lane_name, job = _find_job(state, job_id)
        if job is None:
            raise FileNotFoundError("Execution queue job does not exist.")
        if job.get("status") != "backlog":
            raise ValueError("Only backlogged execution jobs can be added to the queue.")
        lane = _lane(state, lane_name)
        jobs = lane["jobs"]
        jobs.remove(job)
        insert_at = 0
        for index, item in enumerate(jobs):
            if item.get("status") in ACTIVE_STATUSES or item.get("status") == "queued":
                insert_at = index + 1
        job["status"] = "queued"
        job["updatedAt"] = now
        jobs.insert(insert_at, job)
        _refresh_positions(lane)
        _write_state(state)
        return _public_job(job)


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
    return changed
