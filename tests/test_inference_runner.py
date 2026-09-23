from pathlib import Path

import pytest

from tool.server import config as app_config
from tool.server import execution_queue
from tool.server import generate_generation
from tool.server import inference_runner
from tool.server import inference_runtime
from tool.server import storyboard_generation


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

def test_inference_runner_executes_claimed_storyboard_job(inference_root, monkeypatch):
    queued = inference_runner.enqueue_storyboard(
        {
            "modelId": "minimax_h3",
            "mediaKind": "video",
            "prompt": "Prompt",
            "sourcePrompt": "Prompt",
            "settings": {"aspectRatio": "4:3 (Standard)", "megapixels": 0.2, "duration": 6, "seed": 7},
            "loras": [],
            "references": {"first_frame": "references/first.png"},
            "referenceRecords": [{
                "role": "first_frame",
                "mediaPath": "references/first.png",
                "source": "take",
                "sourceTakeId": "take-previous",
                "frame": "last",
            }],
            "wildcardsEnabled": False,
            "entryState": "Before",
            "exitState": "After",
            "seedMode": "fixed",
        },
        "story-1",
        "scene-1",
        label="Scene 1",
    )
    execution_queue.claim_next(inference_runner.EXECUTION_LANE)

    captured = {}
    monkeypatch.setattr(
        storyboard_generation,
        "execute_inference",
        lambda job_id, request, context: captured.update({
            "jobId": job_id,
            "request": request,
            "context": context,
        }) or {"takeId": "take-1"},
    )

    inference_runner._execute_claimed(queued["jobId"])

    finished = execution_queue.get_job(queued["jobId"])
    assert finished["status"] == "completed"
    assert finished["result"]["takeId"] == "take-1"
    assert captured["context"]["storyId"] == "story-1"
    assert captured["context"]["sceneId"] == "scene-1"
    assert captured["context"]["entryState"] == "Before"
    assert captured["context"]["referenceRecords"][0]["sourceTakeId"] == "take-previous"
    assert "referenceRecords" not in captured["request"]
    assert captured["request"]["references"] == {"first_frame": "references/first.png"}
    assert captured["request"]["prompt"] == "Prompt"


def test_inference_snapshot_projects_storyboard_context(inference_root):
    queued = inference_runner.enqueue_storyboard(
        {
            "modelId": "minimax_h3",
            "mediaKind": "video",
            "prompt": "Prompt",
            "sourcePrompt": "Prompt",
            "settings": {"aspectRatio": "4:3 (Standard)", "megapixels": 0.2, "duration": 6, "seed": 7},
            "loras": [],
            "references": {},
            "wildcardsEnabled": False,
            "entryState": "",
            "exitState": "",
            "seedMode": "fixed",
        },
        "story-1",
        "scene-1",
        label="Scene 1",
    )

    snapshot = inference_runner.snapshot()

    job = next(item for item in snapshot["jobs"] if item["jobId"] == queued["jobId"])
    assert job["client"] == "storyboard"
    assert job["storyId"] == "story-1"
    assert job["sceneId"] == "scene-1"
    assert job["label"] == "Scene 1"

def test_inference_runner_executes_claimed_test_rendition(inference_root, monkeypatch):
    queued = inference_runner.enqueue_test(
        {
            "modelId": "minimax_h3",
            "mediaKind": "video",
            "prompt": "Prompt",
            "settings": {"seed": 7},
        },
        {
            "folder": "sets/subject",
            "sessionId": "session-1",
            "candidateKind": "lora",
            "candidateFile": "epoch20.safetensors",
            "candidateLabel": "epoch20.safetensors",
            "candidateIndex": 2,
        },
        label="Clothing · epoch20.safetensors",
    )
    execution_queue.claim_next(inference_runner.EXECUTION_LANE)

    captured = {}
    monkeypatch.setattr(
        epoch_test_bench,
        "execute_inference",
        lambda job_id, request, context: captured.update({
            "jobId": job_id,
            "request": request,
            "context": context,
        }) or {"status": "completed", "session": "session-1", "mediaFile": "epoch20.mp4"},
    )

    inference_runner._execute_claimed(queued["jobId"])

    finished = execution_queue.get_job(queued["jobId"])
    assert finished["status"] == "completed"
    assert finished["result"]["session"] == "session-1"
    assert captured["context"]["candidateFile"] == "epoch20.safetensors"
    assert captured["request"]["prompt"] == "Prompt"


def test_inference_snapshot_projects_test_rendition_context(inference_root):
    queued = inference_runner.enqueue_test(
        {
            "modelId": "krea2_raw",
            "mediaKind": "image",
            "prompt": "Prompt",
        },
        {
            "folder": "sets/subject",
            "sessionId": "session-1",
            "candidateKind": "base",
            "candidateFile": "",
            "candidateLabel": "Base",
            "candidateIndex": 1,
        },
        label="Comparison · Base",
    )

    job = next(
        item for item in inference_runner.snapshot()["jobs"]
        if item["jobId"] == queued["jobId"]
    )
    assert job["client"] == "test"
    assert job["sessionId"] == "session-1"
    assert job["folder"] == "sets/subject"
    assert job["candidateKind"] == "base"
    assert job["label"] == "Comparison · Base"

def test_inference_runner_cancels_provider_after_unexpected_post_launch_failure(inference_root, monkeypatch):
    queued = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "minimax_h3", "mediaKind": "video", "prompt": "Prompt"}},
        metadata={"client": "generate", "modelId": "minimax_h3", "mediaKind": "video"},
    )
    execution_queue.claim_next(inference_runner.EXECUTION_LANE)
    execution_queue.mark_running(
        queued["id"],
        details={"providerJobId": "provider-123", "providerStatus": "in_progress"},
    )

    monkeypatch.setattr(
        generate_generation,
        "execute",
        lambda *_args: (_ for _ in ()).throw(RuntimeError("provider polling exploded")),
    )
    cancelled = []
    monkeypatch.setattr(inference_runtime, "cancel_job", lambda provider_id: cancelled.append(provider_id) or True)
    monkeypatch.setattr(inference_runner, "_release_gpu", lambda: None)
    monkeypatch.setattr(inference_runner, "_reserve_gpu", lambda: True)

    inference_runner._advance_queue()

    finished = execution_queue.get_job(queued["id"])
    assert finished["status"] == "failed"
    assert cancelled == ["provider-123"]


def test_inference_runner_does_not_cancel_provider_already_terminal(inference_root, monkeypatch):
    queued = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "minimax_h3", "mediaKind": "video", "prompt": "Prompt"}},
        metadata={"client": "generate", "modelId": "minimax_h3", "mediaKind": "video"},
    )
    execution_queue.claim_next(inference_runner.EXECUTION_LANE)
    execution_queue.mark_running(
        queued["id"],
        details={"providerJobId": "provider-123", "providerStatus": "failed"},
    )

    monkeypatch.setattr(
        generate_generation,
        "execute",
        lambda *_args: (_ for _ in ()).throw(RuntimeError("provider failed")),
    )
    cancelled = []
    monkeypatch.setattr(inference_runtime, "cancel_job", lambda provider_id: cancelled.append(provider_id) or True)
    monkeypatch.setattr(inference_runner, "_release_gpu", lambda: None)
    monkeypatch.setattr(inference_runner, "_reserve_gpu", lambda: True)

    inference_runner._advance_queue()

    assert execution_queue.get_job(queued["id"])["status"] == "failed"
    assert cancelled == []

