from pathlib import Path

import pytest

from tool.server import config as app_config
from tool.server import execution_queue


@pytest.fixture
def queue_root(tmp_path, monkeypatch):
    monkeypatch.setattr(app_config, "FS_ROOT", Path(tmp_path))
    execution_queue._resource_owner = ""
    return tmp_path


def test_execution_queue_preserves_fifo_and_snapshots_payload(queue_root):
    payload = {"prompt": "one", "nested": {"value": 1}}
    first = execution_queue.enqueue("takes", payload, metadata={"sceneId": "scene-1"})
    payload["prompt"] = "changed"
    payload["nested"]["value"] = 9
    second = execution_queue.enqueue("takes", {"prompt": "two"}, metadata={"sceneId": "scene-1"})

    queued = execution_queue.lane_snapshot("takes", include_terminal=False)
    assert [job["id"] for job in queued["jobs"]] == [first["id"], second["id"]]
    assert [job["queuePosition"] for job in queued["jobs"]] == [1, 2]

    stored = execution_queue.get_job(first["id"], include_payload=True)
    assert stored["payload"] == {"prompt": "one", "nested": {"value": 1}}


def test_execution_queue_pause_resume_claim_and_reorder(queue_root):
    first = execution_queue.enqueue("takes", {"n": 1})
    second = execution_queue.enqueue("takes", {"n": 2})
    third = execution_queue.enqueue("takes", {"n": 3})

    execution_queue.reorder_job(third["id"], direction="up")
    snapshot = execution_queue.lane_snapshot("takes", include_terminal=False)
    assert [job["id"] for job in snapshot["jobs"]] == [first["id"], third["id"], second["id"]]
    assert [job["queuePosition"] for job in snapshot["jobs"]] == [1, 2, 3]

    execution_queue.pause_lane("takes")
    assert execution_queue.claim_next("takes") is None

    execution_queue.resume_lane("takes")
    claimed = execution_queue.claim_next("takes")
    assert claimed["id"] == first["id"]
    assert claimed["status"] == "starting"

    execution_queue.mark_running(first["id"])
    execution_queue.finish_job(first["id"], result={"takeId": "take-1"})
    next_job = execution_queue.claim_next("takes")
    assert next_job["id"] == third["id"]


def test_execution_queue_cancel_stop_request_and_requeue(queue_root):
    first = execution_queue.enqueue("takes", {"n": 1})
    second = execution_queue.enqueue("takes", {"n": 2})

    cancelled = execution_queue.cancel_queued(second["id"])
    assert cancelled["status"] == "cancelled"

    claimed = execution_queue.claim_next("takes")
    execution_queue.mark_running(claimed["id"])
    stopping = execution_queue.request_action(first["id"], "stop")
    assert stopping["status"] == "stopping"
    assert stopping["requestedAction"] == "stop"

    execution_queue.finish_job(first["id"], status="stopped")
    requeued = execution_queue.requeue_job(first["id"], front=True)
    assert requeued["status"] == "queued"
    assert requeued["requestedAction"] == ""


def test_execution_queue_resource_claim_is_exclusive(queue_root):
    assert execution_queue.reserve_resource("takes") is True
    assert execution_queue.reserve_resource("tests") is False
    assert execution_queue.reserve_resource("takes") is False
    execution_queue.release_resource("takes")
    assert execution_queue.reserve_resource("tests") is True


def test_execution_queue_orders_mixed_inference_clients_in_one_lane(queue_root):
    first = execution_queue.enqueue(
        "inference",
        {"request": {"prompt": "portrait"}},
        metadata={"client": "generate", "label": "Portrait"},
    )
    second = execution_queue.enqueue(
        "inference",
        {"request": {"prompt": "scene"}},
        metadata={"client": "storyboard", "sceneId": "scene-2"},
    )
    third = execution_queue.enqueue(
        "inference",
        {"request": {"prompt": "test"}},
        metadata={"client": "test", "candidate": "epoch-44"},
    )

    snapshot = execution_queue.lane_snapshot("inference", include_terminal=False)

    assert [job["id"] for job in snapshot["jobs"]] == [first["id"], second["id"], third["id"]]
    assert [job["metadata"]["client"] for job in snapshot["jobs"]] == [
        "generate",
        "storyboard",
        "test",
    ]
    assert [job["queuePosition"] for job in snapshot["jobs"]] == [1, 2, 3]


def test_execution_queue_reorders_across_inference_clients(queue_root):
    first = execution_queue.enqueue("inference", {"n": 1}, metadata={"client": "generate"})
    second = execution_queue.enqueue("inference", {"n": 2}, metadata={"client": "storyboard"})
    third = execution_queue.enqueue("inference", {"n": 3}, metadata={"client": "test"})

    execution_queue.reorder_job(third["id"], position=0)
    snapshot = execution_queue.lane_snapshot("inference", include_terminal=False)

    assert [job["id"] for job in snapshot["jobs"]] == [third["id"], second["id"], first["id"]]
    assert [job["queuePosition"] for job in snapshot["jobs"]] == [1, 2, 3]
