from pathlib import Path

import pytest

from tool.server import config as app_config
from tool.server import epoch_test_bench
from tool.server import execution_queue
from tool.server import generate_generation
from tool.server import inference_runner
from tool.server import inference_runtime
from tool.server import storyboard_generation
from tool.server import storyboard_llm_runtime


@pytest.fixture
def inference_root(tmp_path, monkeypatch):
    monkeypatch.setattr(app_config, "FS_ROOT", Path(tmp_path))
    execution_queue._resource_owner = ""
    inference_runner._startup_reconciled = True
    with inference_runner._provider_hold_lock:
        inference_runner._provider_cleanup_holds.clear()
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


def test_inference_yields_retained_director_after_reserving_gpu(inference_root, monkeypatch):
    calls = []
    queued = inference_runner.enqueue_generate(
        {"modelId": "krea2_raw", "mediaKind": "image", "prompt": "Prompt"}
    )

    def reserve():
        calls.append("reserve")
        return execution_queue.reserve_resource(inference_runner.GPU_RESERVATION_OWNER)

    def release():
        calls.append("release")
        execution_queue.release_resource(inference_runner.GPU_RESERVATION_OWNER)

    def execute(job_id):
        calls.append("execute")
        execution_queue.finish_job(job_id, status="completed")

    monkeypatch.setattr(inference_runner, "_reserve_gpu", reserve)
    monkeypatch.setattr(inference_runner, "_release_gpu", release)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "release_loaded_model_for_gpu_work",
        lambda: calls.append("yield-director"),
    )
    monkeypatch.setattr(inference_runner, "_execute_claimed", execute)

    inference_runner._advance_queue()

    assert calls == ["reserve", "yield-director", "execute", "release"]
    assert execution_queue.get_job(queued["jobId"])["status"] == "completed"


def test_inference_defers_without_pausing_if_director_runtime_is_busy(inference_root, monkeypatch):
    queued = inference_runner.enqueue_generate(
        {"modelId": "krea2_raw", "mediaKind": "image", "prompt": "Prompt"}
    )

    monkeypatch.setattr(
        storyboard_llm_runtime,
        "release_loaded_model_for_gpu_work",
        lambda: (_ for _ in ()).throw(storyboard_llm_runtime.DirectorRuntimeBusy("busy")),
    )

    assert inference_runner._advance_queue() is None

    lane = execution_queue.lane_snapshot(inference_runner.EXECUTION_LANE, include_terminal=False)
    assert lane["paused"] is False
    assert execution_queue.get_job(queued["jobId"])["status"] == "queued"
    assert execution_queue.resource_owner() == ""


def test_inference_pauses_without_claiming_if_director_cannot_yield(inference_root, monkeypatch):
    queued = inference_runner.enqueue_generate(
        {"modelId": "krea2_raw", "mediaKind": "image", "prompt": "Prompt"}
    )

    monkeypatch.setattr(
        storyboard_llm_runtime,
        "release_loaded_model_for_gpu_work",
        lambda: (_ for _ in ()).throw(RuntimeError("unload failed")),
    )

    with pytest.raises(RuntimeError, match="unload failed"):
        inference_runner._advance_queue()

    lane = execution_queue.lane_snapshot(inference_runner.EXECUTION_LANE, include_terminal=False)
    assert lane["paused"] is True
    assert "could not be unloaded" in lane["pauseReason"]
    assert execution_queue.get_job(queued["jobId"])["status"] == "queued"
    assert execution_queue.resource_owner() == ""


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


def test_stop_storyboard_jobs_cancels_only_matching_queued_jobs(inference_root):
    matching = inference_runner.enqueue_storyboard(
        {
            "modelId": "minimax_h3",
            "mediaKind": "video",
            "prompt": "Prompt",
            "settings": {},
        },
        "story-delete",
        "scene-1",
    )
    other_story = inference_runner.enqueue_storyboard(
        {
            "modelId": "minimax_h3",
            "mediaKind": "video",
            "prompt": "Prompt",
            "settings": {},
        },
        "story-keep",
        "scene-2",
    )
    generate = inference_runner.enqueue_generate(
        {"modelId": "krea2_raw", "mediaKind": "image", "prompt": "Prompt"}
    )

    inference_runner.stop_storyboard_jobs("story-delete")

    assert execution_queue.get_job(matching["jobId"])["status"] == "cancelled"
    assert execution_queue.get_job(other_story["jobId"])["status"] == "queued"
    assert execution_queue.get_job(generate["jobId"])["status"] == "queued"


def test_stop_storyboard_jobs_requests_stop_for_matching_active_job(inference_root, monkeypatch):
    queued = inference_runner.enqueue_storyboard(
        {
            "modelId": "minimax_h3",
            "mediaKind": "video",
            "prompt": "Prompt",
            "settings": {},
        },
        "story-delete",
        "scene-1",
    )
    execution_queue.claim_next(inference_runner.EXECUTION_LANE)
    execution_queue.mark_running(queued["jobId"])

    real_get_job = inference_runner.execution_get_job
    calls = {"count": 0}

    def terminal_after_stop(job_id):
        job = real_get_job(job_id)
        if job.get("status") == "stopping":
            calls["count"] += 1
            if calls["count"] == 1:
                execution_queue.finish_job(job_id, status="stopped")
                job = real_get_job(job_id)
        return job

    monkeypatch.setattr(inference_runner, "execution_get_job", terminal_after_stop)

    inference_runner.stop_storyboard_jobs("story-delete", timeout=1)

    assert real_get_job(queued["jobId"])["status"] == "stopped"


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

    def fail_after_launch(job_id):
        execution_queue.mark_running(
            job_id,
            details={"providerJobId": "provider-123", "providerStatus": "in_progress"},
        )
        raise RuntimeError("provider polling exploded")

    monkeypatch.setattr(inference_runner, "_execute_claimed", fail_after_launch)
    cancelled = []
    monkeypatch.setattr(
        inference_runtime,
        "cancel_job_and_wait",
        lambda provider_id: cancelled.append(provider_id) or True,
    )
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

    def fail_after_provider_failure(job_id):
        execution_queue.mark_running(
            job_id,
            details={"providerJobId": "provider-123", "providerStatus": "failed"},
        )
        raise RuntimeError("provider failed")

    monkeypatch.setattr(inference_runner, "_execute_claimed", fail_after_provider_failure)
    cancelled = []
    monkeypatch.setattr(
        inference_runtime,
        "cancel_job_and_wait",
        lambda provider_id: cancelled.append(provider_id) or True,
    )
    monkeypatch.setattr(inference_runner, "_release_gpu", lambda: None)
    monkeypatch.setattr(inference_runner, "_reserve_gpu", lambda: True)

    inference_runner._advance_queue()

    assert execution_queue.get_job(queued["id"])["status"] == "failed"
    assert cancelled == []

def test_inference_runner_pauses_and_retains_gpu_when_provider_cleanup_is_unconfirmed(inference_root, monkeypatch):
    queued = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "minimax_h3", "mediaKind": "video", "prompt": "Prompt"}},
        metadata={"client": "generate", "modelId": "minimax_h3", "mediaKind": "video"},
    )
    waiting = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw", "mediaKind": "image", "prompt": "Waiting"}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
    )
    execution_queue._resource_owner = inference_runner.GPU_RESERVATION_OWNER

    def fail_after_launch(job_id):
        execution_queue.mark_running(
            job_id,
            details={"providerJobId": "provider-123", "providerStatus": "in_progress"},
        )
        raise RuntimeError("provider polling exploded")

    monkeypatch.setattr(inference_runner, "_execute_claimed", fail_after_launch)
    monkeypatch.setattr(inference_runtime, "cancel_job_and_wait", lambda _provider_id: False)
    monkeypatch.setattr(inference_runtime, "read_job", lambda _provider_id: {"status": "in_progress"})

    inference_runner._advance_queue()

    finished = execution_queue.get_job(queued["id"])
    snapshot = execution_queue.lane_snapshot(inference_runner.EXECUTION_LANE)
    assert finished["status"] == "failed"
    assert snapshot["paused"] is True
    assert "could not be confirmed stopped" in snapshot["pauseReason"]
    assert execution_queue.resource_owner() == inference_runner.GPU_RESERVATION_OWNER

    execution_queue.resume_lane(inference_runner.EXECUTION_LANE)
    inference_runner._advance_queue()

    assert execution_queue.get_job(waiting["id"])["status"] == "queued"
    assert execution_queue.resource_owner() == inference_runner.GPU_RESERVATION_OWNER


def test_cancel_job_and_wait_requires_terminal_provider_state(monkeypatch):
    states = iter([
        {"status": "in_progress"},
        {"status": "cancelled"},
    ])
    monkeypatch.setattr(inference_runtime, "cancel_job", lambda _provider_id: True)
    monkeypatch.setattr(inference_runtime, "read_job", lambda _provider_id: next(states))
    monkeypatch.setattr(inference_runtime.time, "sleep", lambda _seconds: None)

    assert inference_runtime.cancel_job_and_wait("provider-123", timeout=1) is True

def test_inference_restart_records_unresolved_provider_without_contacting_comfyui(inference_root, monkeypatch):
    queued = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "minimax_h3", "mediaKind": "video", "prompt": "Prompt"}},
        metadata={"client": "generate", "modelId": "minimax_h3", "mediaKind": "video"},
    )
    execution_queue.claim_next(inference_runner.EXECUTION_LANE)
    execution_queue.mark_running(
        queued["id"],
        details={"providerJobId": "provider-still-running", "providerStatus": "in_progress"},
    )
    execution_queue.finish_job(queued["id"], status="failed", error="polling failed")

    inference_runner._startup_reconciled = False
    calls = []
    monkeypatch.setattr(
        inference_runtime,
        "cancel_job_and_wait",
        lambda provider_id: calls.append(provider_id) or False,
    )

    inference_runner.reconcile_startup()

    snapshot = execution_queue.lane_snapshot(inference_runner.EXECUTION_LANE)
    assert snapshot["paused"] is True
    assert calls == []
    assert execution_queue.resource_owner() == ""
    with inference_runner._provider_hold_lock:
        assert "provider-still-running" in inference_runner._provider_cleanup_holds


def test_inference_monitor_does_not_poll_comfyui_for_pending_cleanup(inference_root, monkeypatch):
    inference_runner.hold_provider_cleanup(
        "provider-stale",
        "Queue paused: stale provider cleanup is pending.",
    )
    calls = []
    monkeypatch.setattr(
        inference_runtime,
        "read_job",
        lambda provider_id: calls.append(provider_id) or {"status": "in_progress"},
    )

    inference_runner._advance_queue()
    inference_runner._advance_queue()

    assert calls == []
    assert execution_queue.resource_owner() == ""


def test_inference_resume_checks_pending_cleanup_once(inference_root, monkeypatch):
    inference_runner.hold_provider_cleanup(
        "provider-stale",
        "Queue paused: stale provider cleanup is pending.",
    )
    calls = []
    monkeypatch.setattr(
        inference_runtime,
        "read_job",
        lambda provider_id: calls.append(provider_id) or {"status": "in_progress"},
    )

    result = inference_runner.action("resume_queue")

    assert calls == ["provider-stale"]
    assert result["queue"]["paused"] is True
    assert execution_queue.resource_owner() == ""
