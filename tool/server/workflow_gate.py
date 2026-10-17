"""FIFO admission of coordinated workflows, above existing inference/LLM queues.

This is NOT an execution queue. It serializes submission from Epoch Finder,
Batch Test and First Cut; underlying queues keep their own FIFO/resource rules.
No auto-resume on restart. Tickets are process-local, with bounded stale cleanup.
"""
import threading
import time

_LOCK = threading.RLock()
_TICKETS = []
_STALE_SECONDS = 180
_KINDS = {"epoch", "batch", "firstcut"}


def _prune(now):
    _TICKETS[:] = [entry for entry in _TICKETS
                  if now - entry["touched"] < _STALE_SECONDS]


def register(kind, key):
    kind, key = str(kind or "").strip(), str(key or "").strip()
    if kind not in _KINDS or not key or len(key) > 180:
        raise ValueError("Invalid workflow identity.")
    now = time.monotonic()
    with _LOCK:
        _prune(now)
        for entry in _TICKETS:
            if entry["kind"] == kind and entry["key"] == key:
                entry["touched"] = now
                return _view(entry)
        ticket = {"kind": kind, "key": key, "touched": now}
        _TICKETS.append(ticket)
        return _view(ticket)


def _view(ticket):
    try:
        index = _TICKETS.index(ticket)
    except ValueError:
        return {"state": "missing", "position": 0}
    return {"state": "active" if index == 0 else "queued",
            "position": index + 1,
            "kind": ticket["kind"], "key": ticket["key"]}


def heartbeat(kind, key):
    now = time.monotonic()
    with _LOCK:
        _prune(now)
        for entry in _TICKETS:
            if entry["kind"] == kind and entry["key"] == key:
                entry["touched"] = now
                return _view(entry)
    return {"state": "missing", "position": 0}


def release(kind, key):
    with _LOCK:
        before = len(_TICKETS)
        _TICKETS[:] = [entry for entry in _TICKETS
                      if entry["kind"] != kind or entry["key"] != key]
        return {"released": before != len(_TICKETS)}


def wait_for_epoch(key, control):
    """Epoch Finder alone waits on the backend; never auto-resume paused work."""
    register("epoch", key)
    while True:
        if control["pause"].is_set() or control["stop"].is_set():
            release("epoch", key)
            return False
        view = heartbeat("epoch", key)
        if view["state"] == "missing":
            raise RuntimeError("Workflow admission ticket expired.")
        if view["state"] == "active":
            return True
        time.sleep(1)
