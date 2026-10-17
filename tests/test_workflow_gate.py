"""Workflow admission must be FIFO without altering lower-level queue behavior."""
import pytest

from tool.server import workflow_gate


@pytest.fixture(autouse=True)
def clean_gate():
    with workflow_gate._LOCK:
        workflow_gate._TICKETS.clear()
    yield
    with workflow_gate._LOCK:
        workflow_gate._TICKETS.clear()


def test_fifo_across_epoch_batch_and_firstcut():
    assert workflow_gate.register("epoch", "one") == {
        "state": "active", "position": 1, "kind": "epoch", "key": "one"}
    assert workflow_gate.register("batch", "two")["position"] == 2
    assert workflow_gate.register("firstcut", "three")["position"] == 3
    assert workflow_gate.heartbeat("firstcut", "three")["state"] == "queued"
    assert workflow_gate.register("batch", "two")["position"] == 2
    assert workflow_gate.release("epoch", "one")["released"]
    assert workflow_gate.heartbeat("batch", "two")["state"] == "active"
    workflow_gate.release("batch", "two")
    assert workflow_gate.heartbeat("firstcut", "three")["state"] == "active"


def test_cancel_queued_work_does_not_preempt_running_work():
    workflow_gate.register("epoch", "one")
    workflow_gate.register("firstcut", "two")
    workflow_gate.release("firstcut", "two")
    assert workflow_gate.heartbeat("epoch", "one")["state"] == "active"
    assert workflow_gate.heartbeat("firstcut", "two")["state"] == "missing"


def test_stale_tickets_are_removed_without_restarting_work(monkeypatch):
    workflow_gate.register("batch", "old")
    with workflow_gate._LOCK:
        workflow_gate._TICKETS[0]["touched"] -= workflow_gate._STALE_SECONDS + 1
    assert workflow_gate.register("epoch", "new")["state"] == "active"
    assert workflow_gate.heartbeat("batch", "old")["state"] == "missing"


@pytest.mark.parametrize("kind,key", [("unknown","id"), ("epoch",""), ("batch","x"*181)])
def test_invalid_ticket_identity(kind, key):
    with pytest.raises(ValueError):
        workflow_gate.register(kind, key)
