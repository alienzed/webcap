from pathlib import Path

import pytest

from tool.server import config as app_config
from tool.server import execution_queue


@pytest.fixture
def queue_root(tmp_path, monkeypatch):
    monkeypatch.setattr(app_config, "FS_ROOT", Path(tmp_path))
    execution_queue._resource_owner = ""
    execution_queue.clear_transient_receipts()
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


def test_execution_queue_cancel_and_stop_transitions(queue_root):
    first = execution_queue.enqueue("takes", {"n": 1})
    second = execution_queue.enqueue("takes", {"n": 2})

    cancelled = execution_queue.cancel_queued(second["id"])
    assert cancelled["status"] == "cancelled"

    claimed = execution_queue.claim_next("takes")
    execution_queue.mark_running(claimed["id"])
    stopping = execution_queue.request_stop(first["id"])
    assert stopping["status"] == "stopping"
    assert stopping["requestedAction"] == "stop"

    stopped = execution_queue.finish_job(first["id"], status="stopped")
    assert stopped["status"] == "stopped"


def test_execution_queue_stop_request_survives_late_running_transition(queue_root):
    job = execution_queue.enqueue("takes", {"n": 1})
    execution_queue.claim_next("takes")
    execution_queue.request_stop(job["id"])

    running = execution_queue.mark_running(job["id"], details={"phase": "late-start"})

    assert running["status"] == "stopping"
    assert running["requestedAction"] == "stop"
    stopped = execution_queue.finish_job(job["id"], status="stopped")
    assert stopped["status"] == "stopped"


def test_execution_queue_terminal_receipt_is_removed_when_consumed(queue_root):
    job = execution_queue.enqueue("inference", {"n": 1})
    execution_queue.claim_next("inference")
    execution_queue.finish_job(job["id"], status="completed", result={"ok": True})

    consumed = execution_queue.consume_terminal_job(job["id"])

    assert consumed["status"] == "completed"
    assert consumed["result"] == {"ok": True}
    with pytest.raises(FileNotFoundError):
        execution_queue.get_job(job["id"])


def test_execution_queue_keeps_bounded_recent_receipt_after_terminal_delivery_is_consumed(queue_root):
    job = execution_queue.enqueue("inference", {"n": 1}, metadata={"client": "generate"})
    execution_queue.claim_next("inference")
    execution_queue.finish_job(job["id"], status="completed", result={"ok": True})
    execution_queue.consume_terminal_job(job["id"])

    recent = execution_queue.recent_snapshot("inference", limit=5)

    assert len(recent) == 1
    assert recent[0]["id"] == job["id"]
    assert recent[0]["status"] == "completed"
    assert recent[0]["metadata"]["client"] == "generate"


def test_execution_queue_transient_finish_removes_durable_job_without_recent_history(queue_root):
    job = execution_queue.enqueue("inference", {"n": 1}, metadata={"client": "generate"})
    execution_queue.claim_next("inference")

    finished = execution_queue.finish_job_transient(
        job["id"],
        status="completed",
        result={"mediaPath": "output/clip.mp4"},
    )

    assert finished["status"] == "completed"
    with pytest.raises(FileNotFoundError):
        execution_queue.get_job(job["id"])
    assert execution_queue.recent_snapshot("inference") == []
    receipt = execution_queue.transient_receipt(job["id"], consume=True)
    assert receipt["result"] == {"mediaPath": "output/clip.mp4"}
    with pytest.raises(FileNotFoundError):
        execution_queue.transient_receipt(job["id"])


def test_execution_queue_can_resolve_committed_backlog_without_durable_history(queue_root):
    job = execution_queue.enqueue(
        "inference",
        {"request": {"prompt": "already done"}},
        metadata={"client": "generate"},
        initial_status="backlog",
    )

    resolved = execution_queue.resolve_job_transient(
        job["id"],
        status="completed",
        result={"mediaPath": "output/result.png"},
    )

    assert resolved["status"] == "completed"
    with pytest.raises(FileNotFoundError):
        execution_queue.get_job(job["id"])
    assert execution_queue.recent_snapshot("inference") == []
    assert execution_queue.transient_receipt(job["id"])["result"]["mediaPath"] == "output/result.png"


def test_execution_queue_shelves_active_work_back_to_clean_backlog(queue_root):
    active = execution_queue.enqueue("inference", {"request": {"prompt": "again"}})
    queued = execution_queue.enqueue("inference", {"request": {"prompt": "later"}})
    execution_queue.claim_next("inference")
    execution_queue.mark_running(
        active["id"],
        details={"providerJobId": "old-provider", "providerStatus": "in_progress"},
    )

    changed = execution_queue.shelve_unfinished("inference")

    assert {job["id"] for job in changed} == {active["id"], queued["id"]}
    snapshot = execution_queue.lane_snapshot("inference", include_terminal=False)
    assert snapshot["activeJobId"] == ""
    assert [job["status"] for job in snapshot["jobs"]] == ["backlog", "backlog"]
    restored = execution_queue.get_job(active["id"], include_payload=True)
    assert restored["payload"]["request"]["prompt"] == "again"
    assert restored["details"] == {}
    assert restored["startedAt"] is None


def test_execution_queue_terminal_jobs_reject_runtime_updates(queue_root):
    job = execution_queue.enqueue("takes", {"n": 1})
    execution_queue.claim_next("takes")
    execution_queue.finish_job(job["id"], status="completed")

    with pytest.raises(ValueError, match="already finished"):
        execution_queue.update_job(job["id"], {"phase": "too-late"})


def test_server_startup_shelves_inference_without_starting_it():
    app_source = (Path(__file__).parents[1] / "tool" / "server" / "app.py").read_text(encoding="utf-8")
    startup = app_source.split('if __name__ == "__main__":', 1)[1]

    assert "prepare_inference_startup_backlog()" in startup
    assert "start_training_runner_observer()" in startup
    assert "start_inference_observer()" not in startup
    assert "reconcile_llm_startup()" in startup


def test_execution_queue_resource_claim_is_exclusive(queue_root):
    assert execution_queue.reserve_resource("takes") is True
    assert execution_queue.reserve_resource("tests") is False
    assert execution_queue.reserve_resource("takes") is False
    execution_queue.release_resource("takes")
    assert execution_queue.reserve_resource("tests") is True


def test_execution_queue_orders_mixed_inference_client_metadata_in_one_lane(queue_root):
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


def test_execution_queue_reorders_mixed_inference_client_jobs(queue_root):
    first = execution_queue.enqueue("inference", {"n": 1}, metadata={"client": "generate"})
    second = execution_queue.enqueue("inference", {"n": 2}, metadata={"client": "storyboard"})
    third = execution_queue.enqueue("inference", {"n": 3}, metadata={"client": "test"})

    execution_queue.reorder_job(third["id"], position=0)
    snapshot = execution_queue.lane_snapshot("inference", include_terminal=False)

    assert [job["id"] for job in snapshot["jobs"]] == [third["id"], second["id"], first["id"]]
    assert [job["queuePosition"] for job in snapshot["jobs"]] == [1, 2, 3]


def test_execution_queue_backlog_is_claimable_only_when_explicitly_runnable(queue_root):
    backlog = execution_queue.enqueue(
        "inference",
        {"request": {"prompt": "later"}},
        metadata={"client": "generate"},
        initial_status="backlog",
    )
    snapshot = execution_queue.lane_snapshot("inference", include_terminal=False)

    assert backlog["status"] == "backlog"
    assert snapshot["jobs"][0]["queuePosition"] == 0
    assert execution_queue.claim_next("inference") is None

    claimed = execution_queue.claim_next(
        "inference",
        runnable_backlog_ids={backlog["id"]},
    )
    assert claimed["id"] == backlog["id"]
    assert claimed["status"] == "starting"



def test_execution_queue_prioritizes_queued_work_before_runnable_backlog(queue_root):
    first = execution_queue.enqueue("inference", {"n": 1}, initial_status="backlog")
    second = execution_queue.enqueue("inference", {"n": 2}, initial_status="backlog")
    queued = execution_queue.enqueue("inference", {"n": 3})

    claimed = execution_queue.claim_next(
        "inference",
        runnable_backlog_ids={first["id"], second["id"]},
    )
    assert claimed["id"] == queued["id"]
    execution_queue.finish_job(queued["id"], status="completed")

    claimed = execution_queue.claim_next(
        "inference",
        runnable_backlog_ids={first["id"], second["id"]},
    )
    assert claimed["id"] == first["id"]
    execution_queue.finish_job(first["id"], status="completed")

    claimed = execution_queue.claim_next(
        "inference",
        runnable_backlog_ids={second["id"]},
    )
    assert claimed["id"] == second["id"]


def test_execution_queue_inert_backlog_does_not_block_new_queued_work(queue_root):
    backlog = execution_queue.enqueue("inference", {"n": 1}, initial_status="backlog")
    queued = execution_queue.enqueue("inference", {"n": 2})

    claimed = execution_queue.claim_next("inference")

    assert claimed["id"] == queued["id"]
    assert execution_queue.get_job(backlog["id"])["status"] == "backlog"


def test_execution_queue_cancelled_backlog_cannot_be_claimed_from_stale_runnable_set(queue_root):
    backlog = execution_queue.enqueue("inference", {"n": 1}, initial_status="backlog")
    queued = execution_queue.enqueue("inference", {"n": 2})
    execution_queue.cancel_pending(backlog["id"])

    claimed = execution_queue.claim_next(
        "inference",
        runnable_backlog_ids={backlog["id"]},
    )

    assert claimed["id"] == queued["id"]


def test_execution_queue_shelves_only_queued_work(queue_root):
    queued = execution_queue.enqueue("inference", {"n": 1})
    backlog = execution_queue.enqueue("inference", {"n": 2}, initial_status="backlog")

    changed = execution_queue.shelve_queued("inference")
    snapshot = execution_queue.lane_snapshot("inference", include_terminal=False)

    assert [job["id"] for job in changed] == [queued["id"]]
    assert changed[0]["queuePosition"] == 0
    assert [job["status"] for job in snapshot["jobs"]] == ["backlog", "backlog"]
    assert snapshot["jobs"][0]["queuePosition"] == 0
    assert snapshot["jobs"][1]["id"] == backlog["id"]


def test_execution_queue_promotes_backlog_to_end_of_queue(queue_root):
    queued = execution_queue.enqueue("inference", {"n": 1})
    backlog = execution_queue.enqueue("inference", {"n": 2}, initial_status="backlog")
    another = execution_queue.enqueue("inference", {"n": 3})

    promoted = execution_queue.promote_backlog(backlog["id"])
    snapshot = execution_queue.lane_snapshot("inference", include_terminal=False)

    assert promoted["status"] == "queued"
    assert [job["id"] for job in snapshot["jobs"]] == [
        queued["id"],
        another["id"],
        backlog["id"],
    ]
    assert [job["queuePosition"] for job in snapshot["jobs"]] == [1, 2, 3]



def test_execution_queue_cancel_pending_accepts_backlog(queue_root):
    backlog = execution_queue.enqueue("inference", {"n": 1}, initial_status="backlog")

    cancelled = execution_queue.cancel_pending(backlog["id"])

    assert cancelled["status"] == "cancelled"


def test_execution_queue_cancel_all_pending_leaves_active_job_alone(queue_root):
    active = execution_queue.enqueue("inference", {"n": 1})
    queued = execution_queue.enqueue("inference", {"n": 2})
    backlog = execution_queue.enqueue("inference", {"n": 3}, initial_status="backlog")
    execution_queue.claim_next("inference")
    execution_queue.mark_running(active["id"])

    cancelled = execution_queue.cancel_all_pending("inference")

    assert {job["id"] for job in cancelled} == {queued["id"], backlog["id"]}
    assert execution_queue.get_job(active["id"])["status"] == "running"
    assert execution_queue.get_job(queued["id"])["status"] == "cancelled"
    assert execution_queue.get_job(backlog["id"])["status"] == "cancelled"




def test_execution_queue_expected_claim_uses_queue_priority(queue_root):
    backlog = execution_queue.enqueue("inference", {"n": 1}, initial_status="backlog")
    queued = execution_queue.enqueue("inference", {"n": 2})

    claimed = execution_queue.claim_next(
        "inference",
        runnable_backlog_ids={backlog["id"]},
        expected_job_id=queued["id"],
    )

    assert claimed["id"] == queued["id"]
    assert execution_queue.get_job(backlog["id"])["status"] == "backlog"


def test_execution_queue_lane_guard_is_durable_and_explicitly_clearable(queue_root):
    payload = {"providerJobIds": ["provider-1"], "reason": "cleanup pending"}

    stored = execution_queue.set_lane_guard("inference", "providerCleanup", payload)

    assert stored == payload
    assert execution_queue.lane_guard("inference", "providerCleanup") == payload

    payload["providerJobIds"].append("mutated-outside")
    assert execution_queue.lane_guard("inference", "providerCleanup") == {
        "providerJobIds": ["provider-1"],
        "reason": "cleanup pending",
    }

    assert execution_queue.set_lane_guard("inference", "providerCleanup", None) is None
    assert execution_queue.lane_guard("inference", "providerCleanup") is None
