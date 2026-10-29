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


def submit_bulk(folder, count=100, include_base=True):
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
    result = bench._enqueue_frozen_test_request(folder, request, files, include_base)
    session = bench._session_directory(folder, result["session"])
    return request, session, result


def test_100_renditions_preserve_mixed_fifo_manifest_and_frozen_requests(bulk_root, monkeypatch):
    other = execution_queue.enqueue(
        "inference", {"request": {"prompt": "generate"}},
        metadata={"client": "generate"}, initial_status="queued"
    )
    observed = []
    def inspect_start():
        session = bench._session_directories(bulk_root)[0]
        manifest = bench._read_status(session)
        assert manifest["migrationComplete"] is True
        jobs = execution_queue.jobs_by_id(manifest["inferenceJobs"])
        assert len(jobs) == 101
        assert all(job["status"] == "queued" for job in jobs.values())
        observed.append(True)
    monkeypatch.setattr(inference_runner, "start_requested_inference", inspect_start)

    request, session, status = submit_bulk(bulk_root, count=100)
    assert observed == [True]
    manifest = bench._read_status(session)
    assert status["total"] == 101
    assert manifest["total"] == len(manifest["inferenceJobs"]) == 101
    snapshot = execution_queue.lane_snapshot("inference", include_terminal=False)
    assert [job["id"] for job in snapshot["jobs"]] == [
        other["id"], *manifest["inferenceJobs"]
    ]
    assert [job["queuePosition"] for job in snapshot["jobs"]] == list(range(1, 103))
    assert [job["metadata"]["candidateKind"] for job in snapshot["jobs"][1:]] == [
        "base", *(["lora"] * 100)
    ]

    first = execution_queue.get_job(manifest["inferenceJobs"][0], include_payload=True)
    assert first["payload"]["request"]["workflow"] == {"nodes": [{"id": "frozen"}]}
    request["workflow"]["nodes"][0]["id"] = "changed-after-submit"
    assert execution_queue.get_job(
        manifest["inferenceJobs"][0], include_payload=True
    )["payload"]["request"]["workflow"] == {"nodes": [{"id": "frozen"}]}

    original_read = execution_queue._read_state
    calls = []
    def counted_read():
        calls.append(True)
        return original_read()
    monkeypatch.setattr(execution_queue, "_read_state", counted_read)
    records = bench._session_job_records(manifest)
    assert len(records) == 101
    assert len(calls) == 1


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
