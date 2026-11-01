"""Current Test Session contracts for atomic 100+ rendition submission."""
from pathlib import Path

import pytest

from tool.server import config as app_config
from tool.server import epoch_test_bench as bench
from tool.server import execution_queue
from tool.server import inference_runner


@pytest.fixture
def bulk_root(tmp_path, monkeypatch):
    monkeypatch.setattr(app_config, "FS_ROOT", Path(tmp_path))
    monkeypatch.setattr(app_config, "app_state_root", lambda: tmp_path / "app-state")
    monkeypatch.setattr(app_config, "output_root", lambda: tmp_path / "output")
    monkeypatch.setattr(bench, "_startup_reconciled", True)
    monkeypatch.setattr(inference_runner, "_startup_reconciled", True)
    monkeypatch.setattr(inference_runner, "start_observer", lambda: None)
    execution_queue.clear_transient_receipts()
    folder = tmp_path / "sets" / "demo"
    folder.mkdir(parents=True)
    return folder


def submit_bulk(folder, count=100, include_base=True, variations=None):
    model = bench.get_test_model()
    staged = folder / "staged"
    staged.mkdir(exist_ok=True)
    files = []
    for index in range(count):
        file = staged / ("epoch%03d.safetensors" % index)
        file.write_bytes(b"weights")
        files.append(file)
    request = {
        "modelId": model.PROFILE_ID,
        "mediaKind": model.MEDIA_KIND,
        "name": "Large Test",
        "sourcePrompt": "portrait",
        "prompt": "portrait",
        "settings": {"seed": 42},
        "workflow": {"nodes": [{"id": "frozen"}]},
        "workflowFile": "test.json",
        "workflowSha256": "sha",
    }
    if variations is not None:
        request["variationCases"] = variations
    result = bench._enqueue_frozen_test_request(folder, request, files, include_base)
    session = bench._session_directory(folder, result["session"])
    return request, session, result


def test_100_renditions_expand_only_when_session_is_dispatched(bulk_root, monkeypatch):
    other = execution_queue.enqueue(
        "inference", {"request": {"prompt": "generate"}},
        metadata={"client": "generate"}, initial_status="queued"
    )
    observed = []
    def inspect_start():
        session = bench._session_directories(bulk_root)[0]
        manifest = bench._read_status(session)
        assert manifest["migrationComplete"] is True
        assert manifest["inferenceJobs"] == []
        promised = execution_queue.get_job(manifest["deferredJobId"])
        assert promised["metadata"]["candidateKind"] == "session"
        observed.append(True)
    monkeypatch.setattr(inference_runner, "start_requested_inference", inspect_start)

    request, session, status = submit_bulk(bulk_root, count=100)
    assert observed == [True]
    manifest = bench._read_status(session)
    promise_id = manifest["deferredJobId"]
    assert status["total"] == manifest["total"] == 101
    assert manifest["inferenceJobs"] == []
    snapshot = execution_queue.lane_snapshot("inference", include_terminal=False)
    assert [job["id"] for job in snapshot["jobs"]] == [other["id"], promise_id]
    assert [job["queuePosition"] for job in snapshot["jobs"]] == [1, 2]

    frozen = execution_queue.get_job(promise_id, include_payload=True)
    assert frozen["payload"]["request"]["workflow"] == {"nodes": [{"id": "frozen"}]}
    request["workflow"]["nodes"][0]["id"] = "changed-after-submit"
    assert execution_queue.get_job(promise_id, include_payload=True)["payload"]["request"]["workflow"] == {
        "nodes": [{"id": "frozen"}]
    }

    expanded = bench.expand_queued_session(promise_id)
    assert len(expanded) == 101
    manifest = bench._read_status(session)
    assert manifest["deferredJobId"] == ""
    assert manifest["inferenceJobs"] == expanded
    snapshot = execution_queue.lane_snapshot("inference", include_terminal=False)
    assert [job["id"] for job in snapshot["jobs"]] == [other["id"], *expanded]
    assert [job["queuePosition"] for job in snapshot["jobs"]] == list(range(1, 103))
    assert [job["metadata"]["candidateKind"] for job in snapshot["jobs"][1:]] == [
        "base", *(["lora"] * 100)
    ]
    assert execution_queue.get_job(expanded[0], include_payload=True)["payload"]["request"]["workflow"] == {
        "nodes": [{"id": "frozen"}]
    }

    original_read = execution_queue._read_state
    calls = []
    def counted_read():
        calls.append(True)
        return original_read()
    monkeypatch.setattr(execution_queue, "_read_state", counted_read)
    assert len(bench._session_job_records(manifest)) == 101
    assert len(calls) == 1


def test_skip_checkpoint_test_batch_only_cancels_its_queued_variations(bulk_root, monkeypatch):
    monkeypatch.setattr(inference_runner, "start_requested_inference", lambda: None)
    _, session, _ = submit_bulk(
        bulk_root, count=2, include_base=False,
        variations=[
            {"label": "A", "prompt": "portrait A"},
            {"label": "B", "prompt": "portrait B"},
        ],
    )
    promise_id = bench._read_status(session)["deferredJobId"]
    ids = bench.expand_queued_session(promise_id)
    assert len(ids) == 4

    before = bench._visible_session_status(bulk_root, session)
    assert before["total"] == 4
    assert before["pendingCandidates"] == [
        {"kind": "lora", "fileName": "epoch000.safetensors", "strength": None},
        {"kind": "lora", "fileName": "epoch001.safetensors", "strength": None},
    ]

    after = bench.skip_candidate(bulk_root, session.name, "lora", "epoch000.safetensors")
    assert after["total"] == 2
    assert after["skippedCandidates"] == [
        {"kind": "lora", "fileName": "epoch000.safetensors", "strength": None},
    ]
    assert after["pendingCandidates"] == [
        {"kind": "lora", "fileName": "epoch001.safetensors", "strength": None},
    ]
    assert [execution_queue.get_job(job_id)["status"] for job_id in ids] == [
        "cancelled", "cancelled", "queued", "queued"
    ]
    # A second skip is idempotent, and the other checkpoint is unaffected.
    again = bench.skip_candidate(bulk_root, session.name, "lora", "epoch000.safetensors")
    assert again["total"] == 2
    assert [execution_queue.get_job(job_id)["status"] for job_id in ids[2:]] == [
        "queued", "queued"
    ]


def test_cancel_pending_test_batch_does_not_materialize_renditions(bulk_root, monkeypatch):
    monkeypatch.setattr(inference_runner, "start_requested_inference", lambda: None)
    sessions = [submit_bulk(bulk_root, count=3)[1] for _ in range(4)]
    queued = execution_queue.lane_snapshot("inference", include_terminal=False)["jobs"]
    assert len(queued) == 4
    assert all(job["metadata"]["candidateKind"] == "session" for job in queued)
    assert all(bench._read_status(session)["inferenceJobs"] == [] for session in sessions)

    removed = bench.cancel_queued(bulk_root, sessions[1].name)
    assert removed["removed"] == sessions[1].name
    assert not sessions[1].exists()
    remaining = execution_queue.lane_snapshot("inference", include_terminal=False)["jobs"]
    assert [job["metadata"]["sessionId"] for job in remaining] == [
        sessions[index].name for index in (0, 2, 3)
    ]
    assert all(job["metadata"]["candidateKind"] == "session" for job in remaining)


def test_test_batch_recovers_atomic_expansion_after_session_write_failure(bulk_root, monkeypatch):
    monkeypatch.setattr(inference_runner, "start_requested_inference", lambda: None)
    _request, session, _status = submit_bulk(bulk_root, count=3)
    promise_id = bench._read_status(session)["deferredJobId"]
    original_write = bench._atomic_write_json
    failed = []

    def crash_before_session_commit(path, payload):
        if (Path(path) == session / "test.json"
                and payload.get("inferenceJobs") and not failed):
            failed.append(True)
            raise OSError("simulated crash after atomic queue swap")
        return original_write(path, payload)

    monkeypatch.setattr(bench, "_atomic_write_json", crash_before_session_commit)
    with pytest.raises(OSError, match="simulated crash"):
        bench.expand_queued_session(promise_id)
    assert failed == [True]
    manifest = bench._read_status(session)
    assert manifest["deferredJobId"] == promise_id
    assert manifest["inferenceJobs"] == []

    visible = bench._sync_inference_session(session)
    manifest = bench._read_status(session)
    assert len(manifest["inferenceJobs"]) == 4
    assert manifest["deferredJobId"] == ""
    assert visible["status"] == "queued"


def test_failed_bulk_promotion_rolls_back_only_its_session(bulk_root, monkeypatch):
    other = execution_queue.enqueue(
        "inference", {"request": {"prompt": "other"}},
        metadata={"client": "storyboard"}, initial_status="queued"
    )
    def failed_promote(_lane, _ids):
        raise RuntimeError("promotion failed")
    monkeypatch.setattr(bench, "execution_promote_backlog_many", failed_promote)

    with pytest.raises(RuntimeError, match="promotion failed"):
        submit_bulk(bulk_root, count=3)
    assert bench._session_directories(bulk_root) == []
    snapshot = execution_queue.lane_snapshot("inference", include_terminal=False)
    assert [job["id"] for job in snapshot["jobs"]] == [other["id"]]
    assert snapshot["jobs"][0]["status"] == "queued"


def test_session_lookup_preserves_transient_terminal_receipt(bulk_root):
    queued = execution_queue.enqueue_many(
        "inference",
        [{"payload": {"request": {"prompt": "test"}},
          "metadata": {"client": "test", "candidateKind": "lora", "candidateFile": "epoch.safetensors"}}],
        initial_status="backlog",
    )[0]
    receipt = execution_queue.cancel_pending_transient(queued["id"])
    records = bench._session_job_records({"inferenceJobs": [queued["id"]], "results": [], "failures": []})
    assert len(records) == 1
    assert records[0]["status"] == receipt["status"] == "cancelled"
