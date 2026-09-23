from pathlib import Path

import pytest

from tool.server import config as app_config
from tool.server import execution_queue
from tool.server import generate_generation
from tool.server import inference_runner


@pytest.fixture
def inference_root(tmp_path, monkeypatch):
    monkeypatch.setattr(app_config, "FS_ROOT", Path(tmp_path))
    execution_queue._resource_owner = ""
    inference_runner._startup_reconciled = True
    return tmp_path


def test_inference_runner_executes_claimed_generate_job(inference_root, monkeypatch):
    queued = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "minimax_h3", "mediaKind": "video", "prompt": "Prompt"}},
        metadata={
            "client": "generate",
            "label": "Prompt",
            "modelId": "minimax_h3",
            "mediaKind": "video",
        },
    )
    claimed = execution_queue.claim_next(inference_runner.EXECUTION_LANE)
    assert claimed["id"] == queued["id"]

    monkeypatch.setattr(
        generate_generation,
        "execute",
        lambda job_id, request: {
            "jobId": job_id,
            "modelId": request["modelId"],
            "mediaPath": "output/generations/result.mp4",
        },
    )

    inference_runner._execute_claimed(queued["id"])

    finished = execution_queue.get_job(queued["id"])
    assert finished["status"] == "completed"
    assert finished["result"]["modelId"] == "minimax_h3"


def test_inference_runner_projects_lane_state_without_dispatch_side_effects(inference_root):
    first = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "minimax_h3"}},
        metadata={"client": "generate", "label": "First", "modelId": "minimax_h3", "mediaKind": "video"},
    )
    second = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw"}},
        metadata={"client": "generate", "label": "Second", "modelId": "krea2_raw", "mediaKind": "image"},
    )

    snapshot = inference_runner.snapshot(include_terminal=False)

    assert [job["jobId"] for job in snapshot["jobs"]] == [first["id"], second["id"]]
    assert [job["queuePosition"] for job in snapshot["jobs"]] == [1, 2]
    assert execution_queue.get_job(first["id"])["status"] == "queued"


def test_inference_runner_honors_stop_requested_during_start(inference_root, monkeypatch):
    queued = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "minimax_h3", "mediaKind": "video", "prompt": "Prompt"}},
        metadata={"client": "generate", "modelId": "minimax_h3", "mediaKind": "video"},
    )
    execution_queue.claim_next(inference_runner.EXECUTION_LANE)
    execution_queue.request_stop(queued["id"])

    called = []
    monkeypatch.setattr(generate_generation, "execute", lambda *_args: called.append(True))

    inference_runner._execute_claimed(queued["id"])

    finished = execution_queue.get_job(queued["id"])
    assert finished["status"] == "stopped"
    assert called == []
