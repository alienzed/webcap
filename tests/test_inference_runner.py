from pathlib import Path

import pytest

from tool.server import config as app_config
from tool.server import epoch_test_bench
from tool.server import execution_queue
from tool.server import generate_generation
from tool.server import generate_store
from tool.server import inference_runner
from tool.server import inference_runtime
from tool.server import storyboard_generation
from tool.server import storyboard_llm_runtime
from tool.server import training_runner


@pytest.fixture
def inference_root(tmp_path, monkeypatch):
    monkeypatch.setattr(app_config, "FS_ROOT", Path(tmp_path))
    monkeypatch.setattr(app_config, "output_root", lambda: Path(tmp_path) / "output")
    execution_queue._resource_owner = ""
    execution_queue.clear_transient_receipts()
    inference_runner._startup_reconciled = True
    from tool.server import llm_runner
    llm_runner._local_gpu_drain_until = 0.0
    with inference_runner._provider_hold_lock:
        inference_runner._provider_cleanup_holds.clear()
        inference_runner._provider_cleanup_reason = ""
    with inference_runner._backlog_lock:
        inference_runner._backlog_wait_reason = ""
    inference_runner._backlog_drain_enabled.clear()
    monkeypatch.setattr(inference_runtime, "system_stats", lambda: {"ok": True})
    return tmp_path


def test_inference_enqueue_starts_worker_on_demand(inference_root, monkeypatch):
    started = []
    monkeypatch.setattr(
        inference_runner,
        "_start_worker_for_requested_inference",
        lambda: started.append(True),
    )

    queued = inference_runner.enqueue_generate(
        {"modelId": "krea2_raw", "mediaKind": "image", "prompt": "Prompt"}
    )

    assert queued["status"] == "queued"
    assert started == [True]


def test_inference_monitor_is_dormant_without_requested_work(inference_root):
    assert inference_runner._monitor_has_work() is False

    queued = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw"}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
    )
    assert inference_runner._monitor_has_work() is True

    execution_queue.pause_lane(inference_runner.EXECUTION_LANE)
    assert inference_runner._monitor_has_work() is False

    execution_queue.cancel_queued(queued["id"])
    execution_queue.resume_lane(inference_runner.EXECUTION_LANE)
    assert inference_runner._monitor_has_work() is False

    inference_runner.hold_provider_cleanup(
        "provider-stale",
        "Inference is waiting for stale provider cleanup.",
    )
    assert inference_runner._monitor_has_work() is True


def test_inference_clear_all_cancels_pending_but_not_active(inference_root, monkeypatch):
    monkeypatch.setattr(inference_runner, "_cleanup_generate_job_references", lambda _job_id: None)
    active = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw"}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
    )
    queued = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw"}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
    )
    backlog = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw"}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
        initial_status="backlog",
    )
    execution_queue.claim_next(inference_runner.EXECUTION_LANE)
    execution_queue.mark_running(active["id"])
    result = inference_runner.action("clear_all")

    assert result["cleared"] == 2
    assert execution_queue.get_job(active["id"])["status"] == "running"
    assert inference_runner.job_status(queued["id"])["status"] == "cancelled"
    assert inference_runner.job_status(backlog["id"])["status"] == "cancelled"
    with pytest.raises(FileNotFoundError):
        execution_queue.get_job(queued["id"])
    with pytest.raises(FileNotFoundError):
        execution_queue.get_job(backlog["id"])
def test_inference_cancel_does_not_cleanup_generate_inputs_if_dispatch_wins_race(inference_root, monkeypatch):
    queued = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {
            "request": {
                "modelId": "krea2_raw",
                "mediaKind": "image",
                "references": {"first_frame": "tmp/reference.png"},
            }
        },
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
    )
    cleaned = []
    real_cancel = inference_runner.execution_cancel_pending_transient

    def dispatch_then_cancel(job_id):
        execution_queue.claim_next(inference_runner.EXECUTION_LANE)
        return real_cancel(job_id)

    monkeypatch.setattr(inference_runner, "execution_cancel_pending_transient", dispatch_then_cancel)
    monkeypatch.setattr(
        inference_runner,
        "_cleanup_generate_references_from_job",
        lambda stored: cleaned.append(stored["id"]),
    )

    with pytest.raises(ValueError, match="pending"):
        inference_runner.action("cancel", job_id=queued["id"])

    assert cleaned == []
    assert execution_queue.get_job(queued["id"])["status"] == "starting"


def test_inference_clear_all_cleans_only_jobs_it_actually_cancelled(inference_root, monkeypatch):
    first = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw", "mediaKind": "image", "references": {"first_frame": "a.png"}}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
    )
    second = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw", "mediaKind": "image", "references": {"first_frame": "b.png"}}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
    )
    cleaned = []
    real_clear = inference_runner.execution_cancel_all_pending_transient

    def dispatch_then_clear(lane_name):
        execution_queue.claim_next(lane_name)
        return real_clear(lane_name)

    monkeypatch.setattr(inference_runner, "execution_cancel_all_pending_transient", dispatch_then_clear)
    monkeypatch.setattr(
        inference_runner,
        "_cleanup_generate_references_from_job",
        lambda stored: cleaned.append(stored["id"]) if stored else None,
    )

    result = inference_runner.action("clear_all")

    assert result["cleared"] == 1
    assert cleaned == [second["id"]]
    assert execution_queue.get_job(first["id"])["status"] == "starting"
    assert inference_runner.job_status(second["id"])["status"] == "cancelled"


def test_inference_snapshot_is_passive_and_does_not_reconcile_provider(inference_root, monkeypatch):
    inference_runner._startup_reconciled = False
    touched = []
    monkeypatch.setattr(
        inference_runtime,
        "cancel_job_and_wait_status",
        lambda provider_id: touched.append(provider_id) or "cancelled",
    )

    snapshot = inference_runner.snapshot(include_terminal=False)

    assert snapshot["activeJobId"] == ""
    assert touched == []
    assert inference_runner._startup_reconciled is False


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

    finished = inference_runner.job_status(queued["id"])
    assert finished["status"] == "completed"
    assert finished["result"]["modelId"] == "minimax_h3"


def test_inference_keeps_fresh_queued_job_pending_when_comfyui_is_unavailable(inference_root, monkeypatch):
    monkeypatch.setattr(inference_runner, "_start_worker_for_requested_inference", lambda: None)
    queued = inference_runner.enqueue_generate(
        {"modelId": "krea2_raw", "mediaKind": "image", "prompt": "Prompt"}
    )
    monkeypatch.setattr(
        inference_runtime,
        "system_stats",
        lambda: (_ for _ in ()).throw(ConnectionError("offline")),
    )
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "release_loaded_model_for_gpu_work",
        lambda: None,
    )

    result = inference_runner._advance_queue()

    assert result is None
    assert inference_runner.job_status(queued["jobId"])["status"] == "queued"
    snapshot = inference_runner.snapshot()
    assert snapshot["activeJobId"] == ""
    assert snapshot["waitReason"] == "ComfyUI unavailable."
    assert execution_queue.resource_owner() == ""



def test_inference_releases_retained_gpu_if_comfyui_disappears_between_jobs(
    inference_root, monkeypatch
):
    monkeypatch.setattr(inference_runner, "_start_worker_for_requested_inference", lambda: None)
    first = inference_runner.enqueue_generate(
        {"modelId": "krea2_raw", "mediaKind": "image", "prompt": "First"}
    )
    second = inference_runner.enqueue_generate(
        {"modelId": "krea2_raw", "mediaKind": "image", "prompt": "Second"}
    )
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "release_loaded_model_for_gpu_work",
        lambda: False,
    )
    monkeypatch.setattr(
        inference_runner,
        "_execute_claimed",
        lambda job_id: execution_queue.finish_job_transient(job_id, status="completed"),
    )

    inference_runner._advance_queue()

    assert inference_runner.job_status(first["jobId"])["status"] == "completed"
    assert inference_runner.job_status(second["jobId"])["status"] == "queued"
    assert execution_queue.resource_owner() == "inference"

    monkeypatch.setattr(
        inference_runtime,
        "system_stats",
        lambda: (_ for _ in ()).throw(ConnectionError("offline")),
    )

    assert inference_runner._advance_queue() is None
    assert inference_runner.job_status(second["jobId"])["status"] == "queued"
    assert execution_queue.resource_owner() == ""



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
        execution_queue.finish_job_transient(job_id, status="completed")

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
    assert inference_runner.job_status(queued["jobId"])["status"] == "completed"


def test_inference_yields_when_local_llm_work_is_already_queued(inference_root, monkeypatch):
    monkeypatch.setattr(inference_runner, "_start_worker_for_requested_inference", lambda: None)
    queued = inference_runner.enqueue_generate(
        {"modelId": "krea2_raw", "mediaKind": "image", "prompt": "Prompt"}
    )
    execution_queue.enqueue(
        "llm",
        {"contract": {}},
        metadata={"client": "storyboard"},
    )
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda: True)
    monkeypatch.setattr(
        inference_runner,
        "_reserve_gpu",
        lambda: (_ for _ in ()).throw(AssertionError("Inference must yield before reserving the shared GPU.")),
    )

    assert inference_runner._advance_queue() is None

    assert execution_queue.get_job(queued["jobId"])["status"] == "queued"
    assert execution_queue.resource_owner() == ""


def test_inference_yields_while_llm_retains_gpu_during_grace(inference_root, monkeypatch):
    monkeypatch.setattr(inference_runner, "_start_worker_for_requested_inference", lambda: None)
    queued = inference_runner.enqueue_generate(
        {"modelId": "krea2_raw", "mediaKind": "image", "prompt": "Prompt"}
    )
    execution_queue._resource_owner = "llm"
    monkeypatch.setattr(
        inference_runner,
        "_reserve_gpu",
        lambda: (_ for _ in ()).throw(AssertionError("Inference must not reserve an LLM-owned GPU.")),
    )

    assert inference_runner._advance_queue() is None
    assert execution_queue.get_job(queued["jobId"])["status"] == "queued"
    assert execution_queue.resource_owner() == "llm"


def test_inference_queue_reuses_gpu_ownership_until_foreground_queue_is_drained(
    inference_root, monkeypatch
):
    monkeypatch.setattr(inference_runner, "_start_worker_for_requested_inference", lambda: None)
    calls = []
    monkeypatch.setattr(
        inference_runner,
        "_reserve_gpu",
        lambda: calls.append("reserve") or execution_queue.reserve_resource("inference"),
    )
    monkeypatch.setattr(
        inference_runner,
        "_release_gpu",
        lambda: calls.append("release") or execution_queue.release_resource("inference"),
    )
    monkeypatch.setattr(inference_runtime, "system_stats", lambda: {"ok": True})
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "release_loaded_model_for_gpu_work",
        lambda: False,
    )

    first = inference_runner.enqueue_generate(
        {"modelId": "krea2_raw", "mediaKind": "image", "prompt": "First"}
    )
    second = inference_runner.enqueue_generate(
        {"modelId": "krea2_raw", "mediaKind": "image", "prompt": "Second"}
    )

    monkeypatch.setattr(
        inference_runner,
        "_execute_claimed",
        lambda job_id: execution_queue.finish_job_transient(job_id, status="completed"),
    )

    inference_runner._advance_queue()

    assert inference_runner.job_status(first["jobId"])["status"] == "completed"
    assert inference_runner.job_status(second["jobId"])["status"] == "queued"
    assert calls == ["reserve"]
    assert execution_queue.resource_owner() == "inference"

    execution_queue.enqueue(
        "llm",
        {"contract": {}},
        metadata={"client": "storyboard"},
    )
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda: True)

    inference_runner._advance_queue()

    assert inference_runner.job_status(second["jobId"])["status"] == "completed"
    assert calls == ["reserve", "release"]
    assert execution_queue.resource_owner() == ""


def test_inference_releases_gpu_at_queue_to_backlog_boundary(inference_root, monkeypatch):
    monkeypatch.setattr(inference_runner, "_start_worker_for_requested_inference", lambda: None)
    calls = []
    monkeypatch.setattr(
        inference_runner,
        "_reserve_gpu",
        lambda: calls.append("reserve") or execution_queue.reserve_resource("inference"),
    )
    monkeypatch.setattr(
        inference_runner,
        "_release_gpu",
        lambda: calls.append("release") or execution_queue.release_resource("inference"),
    )
    monkeypatch.setattr(inference_runtime, "system_stats", lambda: {"ok": True})
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "release_loaded_model_for_gpu_work",
        lambda: False,
    )

    queued = inference_runner.enqueue_generate(
        {"modelId": "krea2_raw", "mediaKind": "image", "prompt": "Foreground"}
    )
    backlog = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw"}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
        initial_status="backlog",
    )
    inference_runner._backlog_drain_enabled.set()
    monkeypatch.setattr(
        inference_runner,
        "_execute_claimed",
        lambda job_id: execution_queue.finish_job_transient(job_id, status="completed"),
    )

    inference_runner._advance_queue()

    assert inference_runner.job_status(queued["jobId"])["status"] == "completed"
    assert execution_queue.get_job(backlog["id"])["status"] == "backlog"
    assert calls == ["reserve", "release"]
    assert execution_queue.resource_owner() == ""



def test_inference_drains_foreground_then_yields_backlog_to_training(
    inference_root, monkeypatch
):
    monkeypatch.setattr(inference_runner, "_start_worker_for_requested_inference", lambda: None)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "release_loaded_model_for_gpu_work",
        lambda: False,
    )

    first = inference_runner.enqueue_generate(
        {"modelId": "krea2_raw", "mediaKind": "image", "prompt": "First"}
    )
    second = inference_runner.enqueue_generate(
        {"modelId": "krea2_raw", "mediaKind": "image", "prompt": "Second"}
    )
    backlog = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw"}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
        initial_status="backlog",
    )
    inference_runner._backlog_drain_enabled.set()
    monkeypatch.setattr(
        inference_runner,
        "_execute_claimed",
        lambda job_id: execution_queue.finish_job_transient(job_id, status="completed"),
    )

    inference_runner._advance_queue()

    assert inference_runner.job_status(first["jobId"])["status"] == "completed"
    assert inference_runner.job_status(second["jobId"])["status"] == "queued"
    assert execution_queue.resource_owner() == "inference"

    training_state = training_runner._default_state()
    training_state["jobs"] = [{"id": "train-next", "status": "queued"}]
    training_state["queuePaused"] = False
    training_runner._ensure_runtime_dirs()
    training_runner._write_state(training_state)

    inference_runner._advance_queue()

    assert inference_runner.job_status(second["jobId"])["status"] == "completed"
    assert execution_queue.get_job(backlog["id"])["status"] == "backlog"
    assert execution_queue.resource_owner() == ""

    assert inference_runner._advance_queue() is None
    assert execution_queue.get_job(backlog["id"])["status"] == "backlog"
    assert execution_queue.resource_owner() == ""


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



def test_inference_releases_existing_idle_reservation_if_director_runtime_is_busy(inference_root, monkeypatch):
    queued = inference_runner.enqueue_generate(
        {"modelId": "krea2_raw", "mediaKind": "image", "prompt": "Prompt"}
    )
    execution_queue._resource_owner = inference_runner.GPU_RESERVATION_OWNER

    monkeypatch.setattr(
        storyboard_llm_runtime,
        "release_loaded_model_for_gpu_work",
        lambda: (_ for _ in ()).throw(storyboard_llm_runtime.DirectorRuntimeBusy("busy")),
    )

    assert inference_runner._advance_queue() is None

    assert execution_queue.get_job(queued["jobId"])["status"] == "queued"
    assert execution_queue.resource_owner() == ""



def test_inference_retries_if_retained_director_cannot_yield_yet(inference_root, monkeypatch):
    monkeypatch.setattr(inference_runner, "_start_worker_for_requested_inference", lambda: None)
    queued = inference_runner.enqueue_generate(
        {"modelId": "krea2_raw", "mediaKind": "image", "prompt": "Prompt"}
    )
    attempts = []

    def yield_director():
        attempts.append(True)
        if len(attempts) == 1:
            raise RuntimeError("unload failed")

    def execute(job_id):
        execution_queue.finish_job_transient(job_id, status="completed")

    monkeypatch.setattr(
        storyboard_llm_runtime,
        "release_loaded_model_for_gpu_work",
        yield_director,
    )
    monkeypatch.setattr(inference_runner, "_execute_claimed", execute)

    assert inference_runner._advance_queue() is None

    lane = execution_queue.lane_snapshot(inference_runner.EXECUTION_LANE, include_terminal=False)
    assert lane["paused"] is False
    assert execution_queue.get_job(queued["jobId"])["status"] == "queued"
    assert execution_queue.resource_owner() == ""

    finished = inference_runner._advance_queue()

    assert finished["status"] == "completed"
    assert attempts == [True, True]
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

    assert inference_runner.job_status(matching["jobId"])["status"] == "cancelled"
    with pytest.raises(FileNotFoundError):
        execution_queue.get_job(matching["jobId"])
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

    finished = inference_runner.job_status(queued["id"])
    assert finished["status"] == "stopped"
    assert called == []

def test_inference_stop_remains_stopped_when_execution_raises(inference_root, monkeypatch):
    queued = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "minimax_h3", "mediaKind": "video", "prompt": "Prompt"}},
        metadata={"client": "generate", "modelId": "minimax_h3", "mediaKind": "video"},
    )
    monkeypatch.setattr(inference_runner, "_reserve_gpu", lambda: True)
    monkeypatch.setattr(inference_runner, "_release_gpu", lambda: None)

    def stop_then_fail(job_id):
        execution_queue.mark_running(
            job_id,
            details={"providerJobId": "provider-stop", "providerStatus": "in_progress"},
        )
        execution_queue.request_stop(job_id)
        raise RuntimeError("provider poll failed while stopping")

    monkeypatch.setattr(inference_runner, "_execute_claimed", stop_then_fail)
    monkeypatch.setattr(
        inference_runtime,
        "cancel_job_and_wait_status",
        lambda _provider_id: "cancelled",
    )

    result = inference_runner._advance_queue()

    assert result["status"] == "stopped"
    assert inference_runner.job_status(queued["id"])["status"] == "stopped"
    assert inference_runner.snapshot()["paused"] is False


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

    finished = inference_runner.job_status(queued["jobId"])
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

    finished = inference_runner.job_status(queued["jobId"])
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
            "wildcardValues": ["red dress", "rooftop", "side"],
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
    assert job["wildcardValues"] == ["red dress", "rooftop", "side"]
    assert job["label"] == "Comparison · Base"

def test_inference_runner_pauses_without_consuming_queue_when_comfyui_is_unavailable(inference_root, monkeypatch):
    first = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "minimax_h3", "mediaKind": "video", "prompt": "First"}},
        metadata={"client": "generate", "modelId": "minimax_h3", "mediaKind": "video"},
    )
    second = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw", "mediaKind": "image", "prompt": "Second"}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
    )

    def unavailable(job_id):
        execution_queue.mark_running(job_id, details={"providerStatus": "starting"})
        raise RuntimeError("ComfyUI unavailable")

    monkeypatch.setattr(inference_runner, "_execute_claimed", unavailable)
    monkeypatch.setattr(inference_runner, "_release_gpu", lambda: None)
    monkeypatch.setattr(inference_runner, "_reserve_gpu", lambda: True)

    inference_runner._advance_queue()

    snapshot = inference_runner.snapshot()
    assert snapshot["paused"] is True
    assert "ComfyUI unavailable" in snapshot["pauseReason"]
    assert [job["jobId"] for job in snapshot["jobs"]] == [first["id"], second["id"]]
    assert [job["status"] for job in snapshot["jobs"]] == ["queued", "queued"]
    assert [job["queuePosition"] for job in snapshot["jobs"]] == [1, 2]

    inference_runner._advance_queue()
    unchanged = inference_runner.snapshot()
    assert [job["jobId"] for job in unchanged["jobs"]] == [first["id"], second["id"]]
    assert [job["queuePosition"] for job in unchanged["jobs"]] == [1, 2]


def test_inference_resume_retries_preserved_head_before_later_work(inference_root, monkeypatch):
    first = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw", "mediaKind": "image", "prompt": "First"}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
    )
    second = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw", "mediaKind": "image", "prompt": "Second"}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
    )
    attempts = []

    def execute(job_id):
        attempts.append(job_id)
        execution_queue.mark_running(job_id)
        if len(attempts) == 1:
            raise RuntimeError("first attempt failed")
        execution_queue.finish_job_transient(job_id, status="completed")

    monkeypatch.setattr(inference_runner, "_execute_claimed", execute)
    monkeypatch.setattr(inference_runner, "_release_gpu", lambda: None)
    monkeypatch.setattr(inference_runner, "_reserve_gpu", lambda: True)
    monkeypatch.setattr(inference_runner, "_start_worker_for_requested_inference", lambda: None)

    inference_runner._advance_queue()
    assert attempts == [first["id"]]
    assert inference_runner.snapshot()["paused"] is True

    result = inference_runner.action("resume_queue")
    assert result["resumed"] is True
    inference_runner._advance_queue()

    assert attempts == [first["id"], first["id"]]
    assert execution_queue.get_job(second["id"])["status"] == "queued"


def test_inference_runner_pauses_and_preserves_head_job_after_unexpected_post_launch_failure(inference_root, monkeypatch):
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
        "cancel_job_and_wait_status",
        lambda provider_id: cancelled.append(provider_id) or "cancelled",
    )
    monkeypatch.setattr(inference_runner, "_release_gpu", lambda: None)
    monkeypatch.setattr(inference_runner, "_reserve_gpu", lambda: True)

    result = inference_runner._advance_queue()

    snapshot = inference_runner.snapshot()
    assert result["jobId"] == queued["id"]
    assert result["status"] == "queued"
    assert snapshot["paused"] is True
    assert "provider polling exploded" in snapshot["pauseReason"]
    assert [job["jobId"] for job in snapshot["jobs"]] == [queued["id"], waiting["id"]]
    assert [job["queuePosition"] for job in snapshot["jobs"]] == [1, 2]
    assert cancelled == ["provider-123"]


def test_inference_runner_preserves_job_when_provider_already_terminal(inference_root, monkeypatch):
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
        "cancel_job_and_wait_status",
        lambda provider_id: cancelled.append(provider_id) or "cancelled",
    )
    monkeypatch.setattr(inference_runner, "_release_gpu", lambda: None)
    monkeypatch.setattr(inference_runner, "_reserve_gpu", lambda: True)

    inference_runner._advance_queue()

    assert inference_runner.job_status(queued["id"])["status"] == "queued"
    assert inference_runner.snapshot()["paused"] is True
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
    monkeypatch.setattr(inference_runtime, "cancel_job_and_wait_status", lambda _provider_id: "")
    monkeypatch.setattr(inference_runtime, "read_job", lambda _provider_id: {"status": "in_progress"})

    inference_runner._advance_queue()

    finished = inference_runner.job_status(queued["id"])
    snapshot = inference_runner.snapshot()
    assert finished["status"] == "queued"
    assert snapshot["paused"] is True
    assert "provider polling exploded" in snapshot["pauseReason"]
    assert "could not be confirmed stopped" in snapshot["waitReason"]
    persisted = execution_queue.lane_snapshot(inference_runner.EXECUTION_LANE)
    assert persisted["paused"] is True
    assert persisted["activeJobId"] == ""
    assert [job["id"] for job in persisted["jobs"]] == [queued["id"], waiting["id"]]
    assert execution_queue.resource_owner() == inference_runner.GPU_RESERVATION_OWNER

    result = inference_runner.action("resume_queue")

    assert result["resumeBlocked"] is True
    assert execution_queue.get_job(queued["id"])["status"] == "queued"
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

def test_inference_snapshot_migrates_obsolete_persisted_provider_pause_without_provider_contact(inference_root, monkeypatch):
    execution_queue.pause_lane(
        inference_runner.EXECUTION_LANE,
        reason="Queue paused: prior ComfyUI provider work could not be confirmed stopped after restart.",
    )
    touched = []
    monkeypatch.setattr(
        inference_runtime,
        "read_job",
        lambda provider_id: touched.append(provider_id) or {"status": "in_progress"},
    )

    snapshot = inference_runner.snapshot(include_terminal=False)

    assert snapshot["paused"] is False
    assert snapshot["pauseReason"] == ""
    assert snapshot["jobs"] == []
    assert touched == []


def test_inference_snapshot_does_not_clear_execution_error_pause(inference_root):
    queued = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw"}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
    )
    execution_queue.pause_lane(
        inference_runner.EXECUTION_LANE,
        reason="Inference paused after an execution error: ComfyUI provider unavailable",
    )

    snapshot = inference_runner.snapshot(include_terminal=False)

    assert snapshot["paused"] is True
    assert snapshot["jobs"][0]["jobId"] == queued["id"]


def test_inference_startup_clears_exact_obsolete_historical_pause_when_lane_is_empty(inference_root):
    execution_queue.pause_lane(
        inference_runner.EXECUTION_LANE,
        reason="Queue paused: prior ComfyUI provider work could not be confirmed stopped after restart.",
    )
    inference_runner._startup_reconciled = False

    inference_runner.reconcile_startup()

    snapshot = execution_queue.lane_snapshot(inference_runner.EXECUTION_LANE, include_terminal=False)
    assert snapshot["paused"] is False
    assert snapshot["pauseReason"] == ""
    assert snapshot["jobs"] == []


def test_inference_restart_does_not_reanimate_historical_terminal_provider_hold(inference_root, monkeypatch):
    queued = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "minimax_h3"}},
        metadata={"client": "generate", "modelId": "minimax_h3", "mediaKind": "video"},
    )
    execution_queue.claim_next(inference_runner.EXECUTION_LANE)
    execution_queue.mark_running(
        queued["id"],
        details={"providerJobId": "provider-old", "providerStatus": "in_progress"},
    )
    execution_queue.finish_job(queued["id"], status="failed", error="old failure")

    inference_runner._startup_reconciled = False
    touched = []
    monkeypatch.setattr(
        inference_runtime,
        "cancel_job_and_wait_status",
        lambda provider_id: touched.append(provider_id) or "",
    )

    inference_runner.reconcile_startup()

    snapshot = execution_queue.lane_snapshot(inference_runner.EXECUTION_LANE)
    assert snapshot["paused"] is False
    assert snapshot["activeJobId"] == ""
    assert snapshot["jobs"] == []
    assert execution_queue.recent_snapshot(inference_runner.EXECUTION_LANE) == []
    with pytest.raises(FileNotFoundError):
        execution_queue.get_job(queued["id"])
    assert touched == []
    with inference_runner._provider_hold_lock:
        assert not inference_runner._provider_cleanup_holds


def test_inference_resume_clears_pause_even_while_other_gpu_owner_is_active(inference_root, monkeypatch):
    queued = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw"}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
    )
    execution_queue.pause_lane(inference_runner.EXECUTION_LANE)
    execution_queue._resource_owner = "training"
    started = []
    monkeypatch.setattr(
        inference_runner,
        "_start_worker_for_requested_inference",
        lambda: started.append(True),
    )

    result = inference_runner.action("resume_queue")

    assert result["resumed"] is True
    assert result["queue"]["paused"] is False
    assert execution_queue.get_job(queued["id"])["status"] == "queued"
    assert execution_queue.resource_owner() == "training"
    assert started == [True]


def test_inference_cleanup_hold_is_retained_when_provider_cannot_be_verified(inference_root, monkeypatch):
    inference_runner.hold_provider_cleanup(
        "provider-stale",
        "Inference is waiting: stale provider cleanup is pending.",
    )
    calls = []

    def unavailable(provider_id):
        calls.append(provider_id)
        raise RuntimeError("ComfyUI unavailable")

    monkeypatch.setattr(inference_runtime, "read_job", unavailable)

    result = inference_runner.action("resume_queue")

    assert calls == ["provider-stale"]
    assert result["resumeBlocked"] is True
    assert result["queue"]["paused"] is False
    assert "provider cleanup" in result["queue"]["waitReason"]
    assert execution_queue.resource_owner() == inference_runner.GPU_RESERVATION_OWNER
    assert inference_runner._monitor_has_work() is True
    with inference_runner._provider_hold_lock:
        assert inference_runner._provider_cleanup_holds == {"provider-stale"}


def test_provider_cleanup_does_not_activate_restart_backlog(inference_root, monkeypatch):
    backlog = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw"}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
        initial_status="backlog",
    )
    inference_runner.hold_provider_cleanup(
        "provider-stale",
        "Inference is waiting: stale provider cleanup is pending.",
    )
    monkeypatch.setattr(
        inference_runtime,
        "read_job",
        lambda _provider_id: {"status": "completed"},
    )
    monkeypatch.setattr(
        inference_runner,
        "_execute_claimed",
        lambda _job_id: pytest.fail("Restart backlog must stay dormant during cleanup."),
    )

    assert inference_runner._backlog_drain_enabled.is_set() is False
    assert inference_runner._advance_queue() is None
    assert execution_queue.get_job(backlog["id"])["status"] == "backlog"
    assert inference_runner._monitor_has_work() is False


def test_inference_monitor_self_reconciles_confirmed_provider_hold(inference_root, monkeypatch):
    inference_runner.hold_provider_cleanup(
        "provider-active",
        "Inference is waiting: provider cleanup is pending.",
    )
    states = iter([
        {"status": "in_progress"},
        {"status": "completed"},
    ])
    monkeypatch.setattr(inference_runtime, "read_job", lambda _provider_id: next(states))
    monkeypatch.setattr(inference_runner, "_release_gpu", lambda: execution_queue.release_resource(inference_runner.GPU_RESERVATION_OWNER))

    assert inference_runner._monitor_has_work() is True
    assert inference_runner._advance_queue() is None
    assert inference_runner._monitor_has_work() is True
    assert inference_runner._advance_queue() is None
    assert inference_runner._monitor_has_work() is False


def test_inference_resume_protects_gpu_when_provider_is_confirmed_active(inference_root, monkeypatch):
    inference_runner.hold_provider_cleanup(
        "provider-active",
        "Inference is waiting: provider cleanup is pending.",
    )
    calls = []
    monkeypatch.setattr(
        inference_runtime,
        "read_job",
        lambda provider_id: calls.append(provider_id) or {"status": "in_progress"},
    )

    result = inference_runner.action("resume_queue")

    assert calls == ["provider-active"]
    assert result["queue"]["paused"] is False
    assert "provider cleanup" in result["queue"]["waitReason"]
    assert execution_queue.resource_owner() == inference_runner.GPU_RESERVATION_OWNER



def test_inference_enqueue_stays_queued_while_shared_gpu_is_busy(inference_root, monkeypatch):
    execution_queue._resource_owner = "training"
    started = []
    monkeypatch.setattr(
        inference_runner,
        "_start_worker_for_requested_inference",
        lambda: started.append(True),
    )

    job = inference_runner.enqueue_generate(
        {"modelId": "krea2_raw", "mediaKind": "image", "prompt": "Later"}
    )

    assert job["status"] == "queued"
    assert started == [True]
    assert inference_runner._monitor_has_work() is True




def test_inference_startup_shelves_persisted_queue_without_provider_contact(
    inference_root, monkeypatch
):
    inference_runner._startup_reconciled = False
    queued = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw"}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
    )
    inference_runner._backlog_drain_enabled.set()
    touched = []
    monitor_starts = []
    monkeypatch.setattr(
        inference_runtime,
        "cancel_job_and_wait_status",
        lambda provider_id: touched.append(provider_id),
    )
    monkeypatch.setattr(
        inference_runner,
        "_ensure_monitor_started",
        lambda: monitor_starts.append(True),
    )

    changed = inference_runner.prepare_startup_backlog()

    assert [job["id"] for job in changed] == [queued["id"]]
    assert execution_queue.get_job(queued["id"])["status"] == "backlog"
    assert touched == []
    assert monitor_starts == []
    assert inference_runner._backlog_drain_enabled.is_set() is False
    assert inference_runner._monitor_has_work() is False



def test_inference_backlog_runs_when_gpu_becomes_available(inference_root, monkeypatch):
    backlog = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw"}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
        initial_status="backlog",
    )
    inference_runner._backlog_drain_enabled.set()
    execution_queue._resource_owner = "training"

    assert inference_runner._advance_queue() is None
    assert execution_queue.get_job(backlog["id"])["status"] == "backlog"

    execution_queue._resource_owner = ""
    monkeypatch.setattr(inference_runtime, "system_stats", lambda: {"ok": True})
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "release_loaded_model_for_gpu_work",
        lambda: False,
    )
    monkeypatch.setattr(
        inference_runner,
        "_execute_claimed",
        lambda job_id: execution_queue.finish_job_transient(job_id, status="completed"),
    )

    inference_runner._advance_queue()

    assert inference_runner.job_status(backlog["id"])["status"] == "completed"



def test_inference_backlog_waits_if_comfyui_is_unavailable(inference_root, monkeypatch):
    backlog = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw"}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
        initial_status="backlog",
    )
    inference_runner._backlog_drain_enabled.set()
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "release_loaded_model_for_gpu_work",
        lambda: False,
    )

    def unavailable():
        raise ConnectionError("ComfyUI unavailable")

    monkeypatch.setattr(inference_runtime, "system_stats", unavailable)

    assert inference_runner._advance_queue() is None

    assert execution_queue.get_job(backlog["id"])["status"] == "backlog"
    assert inference_runner.snapshot()["waitReason"] == "ComfyUI unavailable."
    assert execution_queue.resource_owner() == ""


def test_inference_add_to_queue_promotes_backlog_and_starts_worker(inference_root, monkeypatch):
    backlog = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw"}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
        initial_status="backlog",
    )
    started = []
    monkeypatch.setattr(
        inference_runner,
        "_start_worker_for_requested_inference",
        lambda: started.append(True),
    )

    result = inference_runner.action("add_to_queue", job_id=backlog["id"])

    assert result["job"]["status"] == "queued"
    assert execution_queue.get_job(backlog["id"])["status"] == "queued"
    assert started == [True]



def test_inference_enqueue_stays_queued_behind_unpaused_training_queue(inference_root, monkeypatch):
    training_state = training_runner._default_state()
    training_state["jobs"] = [{"id": "train-next", "status": "queued"}]
    training_state["queuePaused"] = False
    training_runner._ensure_runtime_dirs()
    training_runner._write_state(training_state)
    monkeypatch.setattr(
        inference_runner,
        "_start_worker_for_requested_inference",
        lambda: None,
    )

    job = inference_runner.enqueue_generate(
        {"modelId": "krea2_raw", "mediaKind": "image", "prompt": "After training"}
    )

    assert job["status"] == "queued"
    assert training_runner.reserve_gpu_for_external_work("test-owner") is False

    training_state["queuePaused"] = True
    training_runner._write_state(training_state)
    assert training_runner.external_gpu_work_block_reason(inference_runner.GPU_RESERVATION_OWNER) == ""
    assert training_runner.reserve_gpu_for_external_work("test-owner") is True
    training_runner.release_gpu_for_external_work("test-owner")


def test_inference_startup_reconciles_active_provider_before_training_can_claim_gpu(
    inference_root, monkeypatch
):
    queued = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "minimax_h3"}},
        metadata={"client": "generate", "modelId": "minimax_h3", "mediaKind": "video"},
    )
    execution_queue.claim_next(inference_runner.EXECUTION_LANE)
    execution_queue.mark_running(
        queued["id"],
        details={"providerJobId": "provider-live", "providerStatus": "in_progress"},
    )
    inference_runner._startup_reconciled = False
    monkeypatch.setattr(
        inference_runtime,
        "cancel_job_and_wait_status",
        lambda _provider_id: "",
    )
    monkeypatch.setattr(
        inference_runtime,
        "read_job",
        lambda _provider_id: {"status": "in_progress"},
    )
    monitor_starts = []
    monkeypatch.setattr(
        inference_runner,
        "_ensure_monitor_started",
        lambda: monitor_starts.append(True),
    )

    inference_runner.prepare_startup_backlog()

    restarted = execution_queue.get_job(queued["id"], include_payload=True)
    assert restarted["status"] == "backlog"
    assert restarted["details"] == {}
    assert restarted["startedAt"] is None
    assert execution_queue.resource_owner() == inference_runner.GPU_RESERVATION_OWNER
    with inference_runner._provider_hold_lock:
        assert inference_runner._provider_cleanup_holds == {"provider-live"}
    assert execution_queue.lane_guard(
        inference_runner.EXECUTION_LANE,
        inference_runner.PROVIDER_CLEANUP_GUARD,
    )["providerJobIds"] == ["provider-live"]
    assert monitor_starts == [True]
    assert training_runner.reserve_gpu_for_external_work("training") is False


def test_inference_restart_does_not_requeue_generate_job_whose_product_already_committed(
    inference_root, monkeypatch
):
    queued = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw", "references": {}}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
    )
    execution_queue.claim_next(inference_runner.EXECUTION_LANE)
    execution_queue.mark_running(
        queued["id"],
        details={"providerJobId": "provider-done", "providerStatus": "completed"},
    )
    monkeypatch.setattr(
        generate_store,
        "result_for_job",
        lambda job_id: {
            "jobId": job_id,
            "mediaPath": "generations/day/" + job_id + "/result.png",
            "manifestPath": "generations/day/" + job_id + "/manifest.json",
        },
    )
    monkeypatch.setattr(
        inference_runtime,
        "cancel_job_and_wait_status",
        lambda _provider_id: "completed",
    )
    inference_runner._startup_reconciled = False

    inference_runner.prepare_startup_backlog()

    with pytest.raises(FileNotFoundError):
        execution_queue.get_job(queued["id"])
    receipt = inference_runner.job_status(queued["id"])
    assert receipt["status"] == "completed"
    assert receipt["result"]["mediaPath"].endswith("/result.png")
    assert inference_runner.snapshot()["backlogCount"] == 0


def test_inference_restart_resolves_previously_shelved_job_if_product_already_exists(
    inference_root, monkeypatch
):
    queued = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw", "references": {}}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
        initial_status="backlog",
    )
    monkeypatch.setattr(
        generate_store,
        "result_for_job",
        lambda job_id: {
            "jobId": job_id,
            "mediaPath": "generations/day/" + job_id + "/result.png",
            "manifestPath": "generations/day/" + job_id + "/manifest.json",
        },
    )
    inference_runner._startup_reconciled = False

    inference_runner.prepare_startup_backlog()

    with pytest.raises(FileNotFoundError):
        execution_queue.get_job(queued["id"])
    assert inference_runner.job_status(queued["id"])["status"] == "completed"
    assert inference_runner.snapshot()["backlogCount"] == 0


def test_inference_restart_preserves_explicit_stop_instead_of_backlogging_it(
    inference_root, monkeypatch
):
    queued = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "minimax_h3"}},
        metadata={"client": "generate", "modelId": "minimax_h3", "mediaKind": "video"},
    )
    execution_queue.claim_next(inference_runner.EXECUTION_LANE)
    execution_queue.mark_running(
        queued["id"],
        details={"providerJobId": "provider-stop", "providerStatus": "in_progress"},
    )
    execution_queue.request_stop(queued["id"])
    monkeypatch.setattr(
        inference_runtime,
        "cancel_job_and_wait_status",
        lambda _provider_id: "cancelled",
    )
    inference_runner._startup_reconciled = False

    inference_runner.prepare_startup_backlog()

    with pytest.raises(FileNotFoundError):
        execution_queue.get_job(queued["id"])
    stopped = inference_runner.job_status(queued["id"])
    assert stopped["status"] == "stopped"
    assert inference_runner.snapshot()["backlogCount"] == 0




def test_inference_queue_runs_before_backlog_then_backlog_remains_fifo(
    inference_root, monkeypatch
):
    first = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw"}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
        initial_status="backlog",
    )
    second = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw"}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
        initial_status="backlog",
    )
    queued = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw"}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
    )
    inference_runner._backlog_drain_enabled.set()
    monkeypatch.setattr(inference_runtime, "system_stats", lambda: {"ok": True})
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "release_loaded_model_for_gpu_work",
        lambda: False,
    )
    completed = []

    def finish(job_id):
        completed.append(job_id)
        execution_queue.finish_job_transient(job_id, status="completed")

    monkeypatch.setattr(inference_runner, "_execute_claimed", finish)

    inference_runner._advance_queue()
    inference_runner._advance_queue()
    inference_runner._advance_queue()

    assert completed == [queued["id"], first["id"], second["id"]]


def test_deferred_storyboard_and_test_jobs_enter_backlog_without_starting_worker(
    inference_root, monkeypatch
):
    started = []
    monkeypatch.setattr(
        inference_runner,
        "_start_worker_for_requested_inference",
        lambda: started.append(True),
    )

    storyboard = inference_runner.enqueue_storyboard(
        {"modelId": "minimax_h3", "mediaKind": "video", "prompt": "Prompt"},
        "story-1",
        "scene-1",
        deferred=True,
    )
    test = inference_runner.enqueue_test(
        {"modelId": "krea2_raw", "mediaKind": "image", "prompt": "Prompt"},
        {
            "folder": "sets/subject",
            "sessionId": "session-1",
            "candidateKind": "base",
        },
        deferred=True,
    )

    assert storyboard["status"] == "backlog"
    assert test["status"] == "backlog"
    assert started == []



def test_inference_add_all_to_queue_promotes_backlog_and_starts_worker_once(inference_root, monkeypatch):
    first = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw"}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
        initial_status="backlog",
    )
    second = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw"}},
        metadata={"client": "test", "modelId": "krea2_raw", "mediaKind": "image"},
        initial_status="backlog",
    )
    started = []
    monkeypatch.setattr(
        inference_runner,
        "_start_worker_for_requested_inference",
        lambda: started.append(True),
    )

    result = inference_runner.action("add_all_to_queue")

    assert result["promoted"] == 2
    assert started == [True]
    jobs = execution_queue.lane_snapshot(
        inference_runner.EXECUTION_LANE,
        include_terminal=False,
    )["jobs"]
    assert [job["id"] for job in jobs] == [first["id"], second["id"]]
    assert [job["status"] for job in jobs] == ["queued", "queued"]
    assert [job["queuePosition"] for job in jobs] == [1, 2]


def test_inference_move_all_to_backlog_preserves_pending_work(inference_root, monkeypatch):
    first = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw"}},
        metadata={"client": "generate", "modelId": "krea2_raw", "mediaKind": "image"},
    )
    second = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw"}},
        metadata={"client": "test", "modelId": "krea2_raw", "mediaKind": "image"},
    )

    result = inference_runner.action("move_all_to_backlog")

    assert result["moved"] == 2
    jobs = execution_queue.lane_snapshot(
        inference_runner.EXECUTION_LANE,
        include_terminal=False,
    )["jobs"]
    assert [job["id"] for job in jobs] == [first["id"], second["id"]]
    assert [job["status"] for job in jobs] == ["backlog", "backlog"]


def test_inference_provider_cleanup_guard_survives_second_restart(
    inference_root, monkeypatch
):
    inference_runner.hold_provider_cleanup(
        "provider-live",
        "Inference is waiting: provider cleanup is pending.",
    )
    execution_queue._resource_owner = ""
    with inference_runner._provider_hold_lock:
        inference_runner._provider_cleanup_holds.clear()
        inference_runner._provider_cleanup_reason = ""
    inference_runner._startup_reconciled = False
    monkeypatch.setattr(
        inference_runtime,
        "read_job",
        lambda _provider_id: {"status": "in_progress"},
    )
    monitor_starts = []
    monkeypatch.setattr(
        inference_runner,
        "_ensure_monitor_started",
        lambda: monitor_starts.append(True),
    )

    inference_runner.prepare_startup_backlog()

    with inference_runner._provider_hold_lock:
        assert inference_runner._provider_cleanup_holds == {"provider-live"}
    assert execution_queue.resource_owner() == inference_runner.GPU_RESERVATION_OWNER
    assert monitor_starts == [True]

    monkeypatch.setattr(
        inference_runtime,
        "read_job",
        lambda _provider_id: {"status": "completed"},
    )
    assert inference_runner._reconcile_provider_cleanup_holds() is True
    assert execution_queue.resource_owner() == ""
    assert execution_queue.lane_guard(
        inference_runner.EXECUTION_LANE,
        inference_runner.PROVIDER_CLEANUP_GUARD,
    ) is None



def test_provider_cleanup_continues_while_inference_queue_is_user_paused(
    inference_root, monkeypatch
):
    execution_queue.pause_lane(inference_runner.EXECUTION_LANE)
    inference_runner.hold_provider_cleanup(
        "provider-live",
        "Inference is waiting: provider cleanup is pending.",
    )
    states = iter([
        {"status": "in_progress"},
        {"status": "completed"},
    ])
    monkeypatch.setattr(
        inference_runtime,
        "read_job",
        lambda _provider_id: next(states),
    )

    assert inference_runner._monitor_has_work() is True
    assert inference_runner._advance_queue() is None
    assert execution_queue.resource_owner() == inference_runner.GPU_RESERVATION_OWNER
    assert inference_runner._monitor_has_work() is True

    assert inference_runner._advance_queue() is None
    assert execution_queue.resource_owner() == ""
    assert inference_runner._monitor_has_work() is False
    assert execution_queue.lane_snapshot(inference_runner.EXECUTION_LANE)["paused"] is True


def test_read_job_treats_only_http_404_as_missing(monkeypatch):
    def missing(*_args, **_kwargs):
        raise inference_runtime.ComfyHttpError(404, '{"error":"Job not found"}')

    monkeypatch.setattr(inference_runtime, "_read_json_response", missing)
    assert inference_runtime.read_job("00000000-0000-0000-0000-000000000000") is None

    def failed(*_args, **_kwargs):
        raise inference_runtime.ComfyHttpError(500, '{"error":"boom"}')

    monkeypatch.setattr(inference_runtime, "_read_json_response", failed)
    with pytest.raises(inference_runtime.ComfyHttpError):
        inference_runtime.read_job("00000000-0000-0000-0000-000000000000")
