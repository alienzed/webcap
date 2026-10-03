import json
from pathlib import Path

import pytest

from tool.server import config as app_config
from tool.server import execution_queue
from tool.server import gpu_prep
from tool.server import llm_runner
from tool.server import storyboard_llm_runtime
from tool.server import storyboard_store


@pytest.fixture
def llm_root(tmp_path, monkeypatch):
    monkeypatch.setattr(app_config, "FS_ROOT", Path(tmp_path))
    monkeypatch.setattr(app_config, "output_root", lambda: Path(tmp_path) / "output")
    execution_queue._resource_owner = ""
    execution_queue.clear_transient_receipts()
    execution_queue.ephemeral_lane("llm").clear()
    llm_runner._startup_reconciled = True
    llm_runner._monitor_thread = None
    llm_runner._local_gpu_drain_until = 0.0
    storyboard_llm_runtime.clear_stop_request()
    monkeypatch.setattr(llm_runner, "_ensure_monitor_started", lambda: None)
    monkeypatch.setattr(gpu_prep, "prepare_gpu_for", lambda _owner: True)
    return tmp_path


def test_local_gpu_work_runnable_uses_real_ephemeral_fifo_head(llm_root, monkeypatch):
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda model_id: model_id == "local")
    remote = llm_runner.enqueue(
        "chat",
        "remote",
        {"operation": "freeform_chat", "prompt": "Remote.", "output": "text"},
    )
    llm_runner.enqueue(
        "storyboard",
        "local",
        {"operation": "write_prompt", "prompt": "Local.", "output": "text"},
    )

    assert llm_runner.local_gpu_work_runnable() is False

    llm_runner.execution_cancel_pending_transient(remote["jobId"])
    assert llm_runner.local_gpu_work_runnable() is True


def test_llm_test_job_returns_structured_analysis_without_side_effects(llm_root, monkeypatch):
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: False)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda *_args, **_kwargs: {
            "text": '{"wildcard":"subject {standing|sitting}","stableTerms":["subject"],"variationGroups":[{"label":"pose","options":["standing","sitting"]}]}',
            "data": {
                "wildcard": "subject {standing|sitting}",
                "stableTerms": ["subject"],
                "variationGroups": [{"label": "pose", "options": ["standing", "sitting"]}],
            },
            "model": "qwen",
            "usage": None,
            "timings": None,
        },
    )

    job = llm_runner.enqueue(
        "test",
        "qwen",
        {"operation": "analyze_caption_wildcard", "prompt": "Analyze.", "output": "json"},
        label="Test wildcard",
    )
    llm_runner._advance_queue()

    finished = llm_runner.job_status(job["jobId"])
    assert finished["status"] == "completed"
    assert finished["result"]["analysis"]["wildcard"] == "subject {standing|sitting}"


def test_llm_test_client_rejects_unowned_operations(llm_root, monkeypatch):
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: False)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda *_args, **_kwargs: {
            "text": '{"wildcard":"subject {a|b}","stableTerms":[],"variationGroups":[]}',
            "data": {"wildcard": "subject {a|b}", "stableTerms": [], "variationGroups": []},
            "model": "qwen",
            "usage": None,
            "timings": None,
        },
    )

    job = llm_runner.enqueue(
        "test",
        "qwen",
        {"operation": "write_prompt", "prompt": "Analyze.", "output": "json"},
        label="Test wildcard",
    )
    llm_runner._advance_queue()

    finished = llm_runner.job_status(job["jobId"])
    assert finished["status"] == "failed"
    assert "Unsupported Test Generations LLM operation" in finished["error"]


def test_llm_snapshot_uses_ephemeral_queue_signature(llm_root):
    snapshot = llm_runner.snapshot(include_terminal=False)

    assert snapshot["jobs"] == []
    assert snapshot["queueDepth"] == 0


def test_llm_queue_payload_never_reaches_execution_state_file(llm_root, monkeypatch):
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: False)

    job = llm_runner.enqueue(
        "chat",
        "qwen",
        {"operation": "freeform_chat", "messages": [{"role": "user", "content": "secret"}]},
        label="Director Chat",
    )

    state_path = app_config.execution_queue_state_path()
    assert not state_path.exists()
    assert llm_runner.job_status(job["jobId"])["status"] == "queued"


def test_llm_chat_job_runs_through_shared_lane_without_persisting_conversation(llm_root, monkeypatch):
    calls = []
    captured = {}
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: True)
    monkeypatch.setattr(
        llm_runner,
        "_reserve_gpu",
        lambda: calls.append("reserve") or execution_queue.reserve_resource("llm"),
    )
    monkeypatch.setattr(
        llm_runner,
        "_release_gpu",
        lambda: calls.append("release") or execution_queue.release_resource("llm"),
    )
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_freeform_chat",
        lambda model_id, messages, gpu_reserved=False: captured.update({
            "model": model_id,
            "messages": messages,
            "gpu_reserved": gpu_reserved,
        }) or {
            "text": "Hello there.",
            "model": model_id,
            "usage": {"total_tokens": 7},
            "timings": {"predicted_ms": 5},
        },
    )

    messages = [{"role": "user", "content": "Hello"}]
    job = llm_runner.enqueue(
        "chat",
        "qwen",
        {"operation": "freeform_chat", "messages": messages},
        label="Director Chat",
    )
    llm_runner._advance_queue()

    finished = llm_runner.job_status(job["jobId"])
    assert finished["status"] == "completed"
    assert finished["client"] == "chat"
    assert finished["operation"] == "freeform_chat"
    assert finished["result"]["text"] == "Hello there."
    assert captured == {"model": "qwen", "messages": messages, "gpu_reserved": True}
    assert calls == ["reserve"]
    assert execution_queue.resource_owner() == "llm"
    llm_runner._local_gpu_drain_until = 0.0
    llm_runner._advance_queue()
    assert calls == ["reserve", "release"]
    assert execution_queue.resource_owner() == ""


def test_llm_generate_job_runs_through_shared_lane(llm_root, monkeypatch):
    calls = []
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: True)
    monkeypatch.setattr(
        llm_runner,
        "_reserve_gpu",
        lambda: calls.append("reserve") or execution_queue.reserve_resource("llm"),
    )
    monkeypatch.setattr(
        llm_runner,
        "_release_gpu",
        lambda: calls.append("release") or execution_queue.release_resource("llm"),
    )
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda model_id, contract, gpu_reserved=False: {
            "text": "Expanded prompt",
            "model": model_id,
            "usage": {"total_tokens": 12},
            "timings": {"prompt_ms": 3},
            "gpu_reserved": gpu_reserved,
        },
    )

    job = llm_runner.enqueue(
        "generate",
        "qwen",
        {"operation": "write_prompt", "prompt": "Expand.", "output": "text"},
        label="Prompt Assistant",
    )

    llm_runner._advance_queue()

    finished = llm_runner.job_status(job["jobId"])
    assert finished["status"] == "completed"
    assert finished["result"]["result"] == "Expanded prompt"
    assert finished["result"]["model"] == "qwen"
    assert calls == ["reserve"]
    assert execution_queue.resource_owner() == "llm"
    llm_runner._local_gpu_drain_until = 0.0
    llm_runner._advance_queue()
    assert calls == ["reserve", "release"]
    assert execution_queue.resource_owner() == ""



def test_local_llm_failure_terminalizes_without_uncertainty_pause(llm_root, monkeypatch):
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: True)
    monkeypatch.setattr(
        llm_runner,
        "_execute_claimed",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("model exploded")),
    )

    job = llm_runner.enqueue(
        "generate",
        "qwen",
        {"operation": "write_prompt", "prompt": "Expand.", "output": "text"},
    )

    llm_runner._advance_queue()

    failed = llm_runner.job_status(job["jobId"])
    assert failed["status"] == "failed"
    assert "model exploded" in failed["error"]
    assert llm_runner.snapshot()["paused"] is False
    assert execution_queue.resource_owner() == "llm"
    assert llm_runner.local_gpu_drain_pending() is True

    llm_runner._local_gpu_drain_until = 0.0
    llm_runner._advance_queue()

    assert execution_queue.resource_owner() == ""


def test_local_llm_uses_shared_gpu_prep_before_execution(llm_root, monkeypatch):
    calls = []
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: True)
    monkeypatch.setattr(
        gpu_prep,
        "prepare_gpu_for",
        lambda owner: calls.append(("prep", owner)) or True,
    )
    monkeypatch.setattr(
        llm_runner,
        "_execute_claimed",
        lambda job_id, gpu_reserved=False: (
            calls.append(("execute", gpu_reserved)),
            llm_runner.execution_finish_job_transient(job_id, status="completed"),
        ),
    )

    job = llm_runner.enqueue(
        "generate",
        "qwen",
        {"operation": "write_prompt", "prompt": "Prompt.", "output": "text"},
    )
    llm_runner._advance_queue()

    assert llm_runner.job_status(job["jobId"])["status"] == "completed"
    assert calls == [("prep", "llm"), ("execute", True)]


def test_local_llm_completion_opens_short_gpu_drain_window(llm_root, monkeypatch):
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: True)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda model_id, contract, gpu_reserved=False: {
            "text": "Done",
            "model": model_id,
        },
    )

    job = llm_runner.enqueue(
        "generate",
        "qwen",
        {"operation": "write_prompt", "prompt": "Expand.", "output": "text"},
    )
    llm_runner._advance_queue()

    assert llm_runner.job_status(job["jobId"])["status"] == "completed"
    assert llm_runner.local_gpu_drain_pending() is True
    assert execution_queue.resource_owner() == "llm"
    assert llm_runner._monitor_has_work() is True

    llm_runner._local_gpu_drain_until = 0.0
    llm_runner._advance_queue()

    assert execution_queue.resource_owner() == ""
    assert llm_runner._monitor_has_work() is False



def test_training_cannot_claim_gpu_during_retained_llm_grace(llm_root, monkeypatch):
    from tool.server import training_runner

    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: True)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda model_id, contract, gpu_reserved=False: {"text": "Done", "model": model_id},
    )

    job = llm_runner.enqueue(
        "generate",
        "qwen",
        {"operation": "write_prompt", "prompt": "Prompt.", "output": "text"},
    )
    llm_runner._advance_queue()

    assert llm_runner.job_status(job["jobId"])["status"] == "completed"
    assert execution_queue.resource_owner() == "llm"

    training_runner._write_state({
        "version": 3,
        "activeJobId": "",
        "queuePaused": False,
        "queuePauseReason": "",
        "jobs": [{"id": "train-next", "status": "queued"}],
    })

    assert execution_queue.reserve_resource("training") is False
    assert execution_queue.resource_owner() == "llm"

    llm_runner._local_gpu_drain_until = 0.0
    llm_runner._advance_queue()

    assert execution_queue.resource_owner() == ""


def test_local_llm_job_arriving_during_grace_reuses_retained_gpu(llm_root, monkeypatch):
    calls = []
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: True)
    monkeypatch.setattr(
        llm_runner,
        "_reserve_gpu",
        lambda: calls.append("reserve") or execution_queue.reserve_resource("llm"),
    )
    monkeypatch.setattr(
        llm_runner,
        "_release_gpu",
        lambda: calls.append("release") or execution_queue.release_resource("llm"),
    )
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda model_id, contract, gpu_reserved=False: {"text": "Done", "model": model_id},
    )

    first = llm_runner.enqueue(
        "generate",
        "qwen",
        {"operation": "write_prompt", "prompt": "First.", "output": "text"},
    )
    llm_runner._advance_queue()

    assert llm_runner.job_status(first["jobId"])["status"] == "completed"
    assert calls == ["reserve"]
    assert execution_queue.resource_owner() == "llm"

    second = llm_runner.enqueue(
        "generate",
        "qwen",
        {"operation": "write_prompt", "prompt": "Second.", "output": "text"},
    )
    llm_runner._advance_queue()

    assert llm_runner.job_status(second["jobId"])["status"] == "completed"
    assert calls == ["reserve"]
    assert execution_queue.resource_owner() == "llm"



def test_local_llm_queue_reuses_gpu_ownership_until_queued_work_is_drained(llm_root, monkeypatch):
    calls = []
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: True)
    monkeypatch.setattr(
        llm_runner,
        "_reserve_gpu",
        lambda: calls.append("reserve") or execution_queue.reserve_resource("llm"),
    )
    monkeypatch.setattr(
        llm_runner,
        "_release_gpu",
        lambda: calls.append("release") or execution_queue.release_resource("llm"),
    )
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda model_id, contract, gpu_reserved=False: {
            "text": "Done",
            "model": model_id,
        },
    )

    first = llm_runner.enqueue(
        "generate",
        "qwen",
        {"operation": "write_prompt", "prompt": "First.", "output": "text"},
    )
    second = llm_runner.enqueue(
        "generate",
        "qwen",
        {"operation": "write_prompt", "prompt": "Second.", "output": "text"},
    )

    llm_runner._advance_queue()

    assert llm_runner.job_status(first["jobId"])["status"] == "completed"
    assert llm_runner.job_status(second["jobId"])["status"] == "queued"
    assert calls == ["reserve"]
    assert execution_queue.resource_owner() == "llm"

    llm_runner._advance_queue()

    assert llm_runner.job_status(second["jobId"])["status"] == "completed"
    assert calls == ["reserve"]
    assert execution_queue.resource_owner() == "llm"
    llm_runner._local_gpu_drain_until = 0.0
    llm_runner._advance_queue()
    assert calls == ["reserve", "release"]
    assert execution_queue.resource_owner() == ""


def test_llm_terminal_receipt_is_removed_when_consumed(llm_root):
    job = execution_queue.enqueue(
        llm_runner.EXECUTION_LANE,
        {"contract": {"operation": "write_prompt"}, "clientContext": {}},
        metadata={"client": "generate", "modelId": "qwen"},
    )
    execution_queue.claim_next(llm_runner.EXECUTION_LANE)
    execution_queue.finish_job_transient(job["id"], status="completed", result={"result": "done"})

    delivered = llm_runner.job_status(job["id"], consume=True)

    assert delivered["status"] == "completed"
    assert delivered["result"]["result"] == "done"
    with pytest.raises(FileNotFoundError):
        execution_queue.get_job(job["id"])


def test_llm_local_job_waits_while_shared_gpu_is_owned(llm_root, monkeypatch):
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: True)
    execution_queue._resource_owner = "training"

    job = llm_runner.enqueue(
        "generate",
        "qwen",
        {"operation": "write_prompt", "prompt": "Expand.", "output": "text"},
    )

    assert llm_runner._advance_queue() is None
    assert llm_runner.job_status(job["jobId"])["status"] == "queued"
    assert execution_queue.resource_owner() == "training"


def test_llm_wait_state_uses_queued_model_runtime(llm_root, monkeypatch):
    execution_queue._resource_owner = "training"
    seen = []
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "uses_local_gpu",
        lambda model_ref=None: seen.append(model_ref) or str(model_ref or "").startswith("local::"),
    )

    remote_state = llm_runner._queue_wait_state({
        "activeJobId": "",
        "paused": False,
        "jobs": [{"status": "queued", "modelId": "macbook::qwen3:8b"}],
    })
    assert remote_state["waitOwner"] == ""
    assert seen[-1] == "macbook::qwen3:8b"

    local_state = llm_runner._queue_wait_state({
        "activeJobId": "",
        "paused": False,
        "jobs": [{"status": "queued", "modelId": "local::qwen3:8b"}],
    })
    assert local_state["waitOwner"] == "training"
    assert seen[-1] == "local::qwen3:8b"


def test_llm_remote_job_does_not_claim_shared_gpu(llm_root, monkeypatch):
    monkeypatch.setattr(
        llm_runner,
        "_reserve_gpu",
        lambda: pytest.fail("Remote LLM work must not reserve the local GPU."),
    )
    monkeypatch.setattr(
        llm_runner,
        "_release_gpu",
        lambda: pytest.fail("Remote LLM work must not release the local GPU."),
    )
    captured = {}
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda model_id, contract, gpu_reserved=False: captured.update({
            "model": model_id,
            "gpu_reserved": gpu_reserved,
        }) or {"text": "Remote result", "model": model_id},
    )

    job = llm_runner.enqueue(
        "generate",
        "macbook::remote-model",
        {"operation": "refine_prompt", "prompt": "Refine.", "output": "text"},
    )
    llm_runner._advance_queue()

    assert llm_runner.job_status(job["jobId"])["status"] == "completed"
    assert captured == {"model": "macbook::remote-model", "gpu_reserved": False}


def test_remote_llm_job_releases_retained_local_gpu_hold_before_running(llm_root, monkeypatch):
    execution_queue._resource_owner = "llm"
    calls = []

    monkeypatch.setattr(
        llm_runner,
        "_release_gpu",
        lambda: calls.append("release") or execution_queue.release_resource("llm"),
    )
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda model_id, contract, gpu_reserved=False: {
            "text": "Remote result",
            "model": model_id,
        },
    )

    job = llm_runner.enqueue(
        "generate",
        "macbook::qwen",
        {"operation": "write_prompt", "prompt": "Prompt.", "output": "text"},
    )
    llm_runner._advance_queue()

    assert llm_runner.job_status(job["jobId"])["status"] == "completed"
    assert calls == ["release"]
    assert execution_queue.resource_owner() == ""


def test_storyboard_llm_job_rejects_inconsistent_frozen_identity(llm_root, monkeypatch):
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: False)
    job = execution_queue.enqueue(
        llm_runner.EXECUTION_LANE,
        {
            "contract": {"operation": "expand_concept", "prompt": "Expand.", "output": "text"},
            "clientContext": {
                "storyId": "story-b",
                "sceneId": "",
                "operation": "expand_concept",
            },
        },
        metadata={
            "client": "storyboard",
            "modelId": "qwen",
            "operation": "expand_concept",
            "storyId": "story-a",
            "sceneId": "",
        },
    )

    llm_runner._advance_queue()

    finished = llm_runner.job_status(job["id"])
    assert finished["status"] == "failed"
    assert "Story identity is inconsistent" in finished["error"]


def test_storyboard_llm_rejects_stale_contract_before_applying_result(llm_root, monkeypatch):
    story = storyboard_store.create_story({
        "title": "Story",
        "concept": "Original concept.",
        "style": "Original style.",
    })
    from tool.server.storyboard_llm_contract import build_request

    contract = build_request(story, "", "expand_concept")
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: False)

    def run_and_change_story(*_args, **_kwargs):
        storyboard_store.update_story(story["id"], {"style": "Changed while Director was running."})
        return {
            "text": "Stale expanded concept.",
            "model": "qwen",
            "usage": None,
            "timings": None,
        }

    monkeypatch.setattr(storyboard_llm_runtime, "run_contract", run_and_change_story)
    job = llm_runner.enqueue(
        "storyboard",
        "qwen",
        contract,
        context={
            "storyId": story["id"],
            "sceneId": "",
            "operation": "expand_concept",
            "sourceInstruction": "",
        },
    )

    llm_runner._advance_queue()

    finished = llm_runner.job_status(job["jobId"])
    stored = storyboard_store.load_story(story["id"])
    assert finished["status"] == "failed"
    assert "inputs changed while the request was running" in finished["error"]
    assert stored["concept"] == "Original concept."
    assert stored["style"] == "Changed while Director was running."


def test_storyboard_develop_rejects_changed_story_inputs_before_replacing_scenes(llm_root, monkeypatch):
    story = storyboard_store.create_story({
        "title": "Story",
        "concept": "Original concept.",
        "style": "Original style.",
        "targetSceneCount": 1,
    })
    story, original_scene = storyboard_store.add_scene(story["id"], {
        "title": "Original Scene",
        "summary": "Keep this if the Director result becomes stale.",
    })
    from tool.server.storyboard_llm_contract import build_request

    contract = build_request(story, "", "develop_story")
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: False)

    def run_and_change_story(*_args, **_kwargs):
        storyboard_store.update_story(story["id"], {"style": "Changed while Director was running."})
        return {
            "text": '{"scenes":[]}',
            "data": {"sharedContext": [], "scenes": []},
            "model": "qwen",
            "usage": None,
            "timings": None,
        }

    monkeypatch.setattr(storyboard_llm_runtime, "run_contract", run_and_change_story)
    job = llm_runner.enqueue(
        "storyboard",
        "qwen",
        contract,
        context={
            "storyId": story["id"],
            "sceneId": "",
            "operation": "develop_story",
            "replaceExisting": True,
            "sourceInstruction": "",
        },
    )

    llm_runner._advance_queue()

    finished = llm_runner.job_status(job["jobId"])
    stored = storyboard_store.load_story(story["id"])
    assert finished["status"] == "failed"
    assert "inputs changed while the request was running" in finished["error"]
    assert stored["sceneOrder"] == [original_scene["id"]]
    assert stored["scenes"][original_scene["id"]]["title"] == "Original Scene"



def test_storyboard_scene_refine_rejects_changed_duration_instead_of_overwriting_it(llm_root, monkeypatch):
    story = storyboard_store.create_story({"title": "Story", "style": "Grounded."})
    story, scene = storyboard_store.add_scene(story["id"], {
        "title": "Scene",
        "summary": "A person crosses the room.",
        "prompt": "Original prompt.",
        "durationSeconds": 10,
    })
    from tool.server.storyboard_llm_contract import build_request

    contract = build_request(story, scene["id"], "refine_prompt", instruction="Make the movement slower.")
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: False)

    def run_and_change_duration(*_args, **_kwargs):
        storyboard_store.update_scene(story["id"], scene["id"], {"durationSeconds": 14})
        return {
            "text": '{"changed":true,"prompt":"Refined prompt.","durationSeconds":12}',
            "data": {"changed": True, "prompt": "Refined prompt.", "durationSeconds": 12},
            "model": "qwen",
            "usage": None,
            "timings": None,
        }

    monkeypatch.setattr(storyboard_llm_runtime, "run_contract", run_and_change_duration)
    job = llm_runner.enqueue(
        "storyboard",
        "qwen",
        contract,
        context={
            "storyId": story["id"],
            "sceneId": scene["id"],
            "operation": "refine_prompt",
            "sourceInstruction": "Make the movement slower.",
        },
    )

    llm_runner._advance_queue()

    finished = llm_runner.job_status(job["jobId"])
    stored_scene = storyboard_store.load_story(story["id"])["scenes"][scene["id"]]
    assert finished["status"] == "failed"
    assert "inputs changed while the request was running" in finished["error"]
    assert stored_scene["durationSeconds"] == 14
    assert stored_scene["prompt"] == "Original prompt."


def test_storyboard_scene_refine_no_change_does_not_mutate_scene(llm_root, monkeypatch):
    story = storyboard_store.create_story({
        "title": "Story",
        "concept": "A person crosses a quiet room.",
        "style": "Grounded naturalism.",
    })
    story, scene = storyboard_store.add_scene(story["id"], {
        "title": "Crossing",
        "summary": "A person crosses the room.",
        "entryState": "At the doorway.",
        "exitState": "At the window.",
        "prompt": "Original prompt stays exactly as written.",
        "durationSeconds": 10,
    })
    from tool.server.storyboard_llm_contract import build_request

    contract = build_request(
        story,
        scene["id"],
        "refine_prompt",
        instruction="Remove a barista if one appears in this Scene.",
    )
    before = storyboard_store.load_story(story["id"])["scenes"][scene["id"]]
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: False)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda *_args, **_kwargs: {
            "text": '{"changed":false,"prompt":"Original prompt stays exactly as written."}',
            "data": {"changed": False, "prompt": "Original prompt stays exactly as written."},
            "model": "qwen",
            "usage": None,
            "timings": None,
        },
    )

    job = llm_runner.enqueue(
        "storyboard",
        "qwen",
        contract,
        context={
            "storyId": story["id"],
            "sceneId": scene["id"],
            "operation": "refine_prompt",
            "sourceInstruction": "Remove a barista if one appears in this Scene.",
        },
    )
    llm_runner._advance_queue()

    finished = llm_runner.job_status(job["jobId"])
    after = storyboard_store.load_story(story["id"])["scenes"][scene["id"]]
    assert finished["status"] == "completed"
    assert after == before

def test_storyboard_llm_job_applies_expanded_concept_before_completion(llm_root, monkeypatch):
    story = storyboard_store.create_story({"title": "Story", "concept": "Short concept."})
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: False)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda *_args, **_kwargs: {
            "text": "Expanded concept.",
            "model": "qwen",
            "usage": None,
            "timings": None,
        },
    )

    job = llm_runner.enqueue(
        "storyboard",
        "qwen",
        {"operation": "expand_concept", "prompt": "Expand.", "output": "text"},
        context={
            "storyId": story["id"],
            "operation": "expand_concept",
        },
    )
    llm_runner._advance_queue()

    finished = llm_runner.job_status(job["jobId"])
    assert finished["status"] == "completed"
    assert finished["result"]["storyId"] == story["id"]
    assert finished["result"]["result"] == "Expanded concept."
    assert storyboard_store.load_story(story["id"])["concept"] == "Expanded concept."


def test_storyboard_define_invariants_appends_only_missing_character_and_location_items(llm_root, monkeypatch):
    story = storyboard_store.create_story({
        "title": "Story",
        "concept": "Elena grieves and later bonds with a dog.",
        "invariants": [
            {"kind": "character", "title": "Elena", "text": "Manual Elena definition stays authoritative."},
        ],
    })
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: False)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda *_args, **_kwargs: {
            "text": '{"invariants":[]}',
            "data": {
                "invariants": [
                    {"kind": "character", "title": "Elena", "text": "Duplicate model definition."},
                    {"kind": "location", "title": "Cemetery", "text": "Old hillside cemetery with weathered stone markers."},
                    {"kind": "world", "title": "Mood", "text": "This unsupported generated item is ignored."},
                    {"kind": "character", "title": "", "text": "Missing subject is ignored."},
                ]
            },
            "model": "qwen",
            "usage": None,
            "timings": None,
        },
    )

    job = llm_runner.enqueue(
        "storyboard",
        "qwen",
        {"operation": "define_invariants", "prompt": "Define.", "output": "json"},
        context={
            "storyId": story["id"],
            "operation": "define_invariants",
        },
    )
    llm_runner._advance_queue()

    finished = llm_runner.job_status(job["jobId"])
    assert finished["status"] == "completed"
    assert finished["result"]["addedCount"] == 1
    stored = storyboard_store.load_story(story["id"])
    assert stored["invariants"] == [
        {"kind": "character", "title": "Elena", "text": "Manual Elena definition stays authoritative."},
        {"kind": "location", "title": "Cemetery", "text": "Old hillside cemetery with weathered stone markers."},
    ]



def test_storyboard_scene_prompt_job_writes_only_its_target_on_backend(llm_root, monkeypatch):
    story = storyboard_store.create_story({"title": "Story"})
    story, first = storyboard_store.add_scene(story["id"], {
        "title": "First",
        "prompt": "Old first prompt.",
    })
    story, second = storyboard_store.add_scene(story["id"], {
        "title": "Second",
        "prompt": "Second prompt stays untouched.",
    })
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: False)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda *_args, **_kwargs: {
            "text": '{"prompt":"New first prompt."}',
            "data": {"prompt": "New first prompt."},
            "model": "qwen",
            "usage": None,
            "timings": None,
        },
    )

    job = llm_runner.enqueue(
        "storyboard",
        "qwen",
        {"operation": "write_prompt", "prompt": "Write.", "output": "json"},
        context={
            "storyId": story["id"],
            "sceneId": first["id"],
            "operation": "write_prompt",
        },
    )
    llm_runner._advance_queue()

    finished = llm_runner.job_status(job["jobId"])
    stored = storyboard_store.load_story(story["id"])
    assert finished["status"] == "completed"
    assert stored["scenes"][first["id"]]["prompt"] == "New first prompt."
    assert stored["scenes"][first["id"]]["previousPrompt"] == "Old first prompt."
    assert stored["scenes"][second["id"]]["prompt"] == "Second prompt stays untouched."

def test_storyboard_director_work_is_not_refused_at_enqueue(llm_root):
    story_a = storyboard_store.create_story({"title": "A"})
    story_a, scene_a1 = storyboard_store.add_scene(story_a["id"], {"prompt": "A1"})
    story_a, scene_a2 = storyboard_store.add_scene(story_a["id"], {"prompt": "A2"})
    story_b = storyboard_store.create_story({"title": "B", "concept": "B"})

    first = llm_runner.enqueue(
        "storyboard",
        "qwen",
        {"operation": "write_prompt", "prompt": "Write.", "output": "text"},
        context={"storyId": story_a["id"], "sceneId": scene_a1["id"], "operation": "write_prompt"},
    )
    second = llm_runner.enqueue(
        "storyboard",
        "qwen",
        {"operation": "write_prompt", "prompt": "Write.", "output": "text"},
        context={"storyId": story_a["id"], "sceneId": scene_a2["id"], "operation": "write_prompt"},
    )
    refine_same_scene = llm_runner.enqueue(
        "storyboard",
        "qwen",
        {"operation": "refine_prompt", "prompt": "Refine.", "output": "text"},
        context={"storyId": story_a["id"], "sceneId": scene_a1["id"], "operation": "refine_prompt"},
    )
    develop_same_story = llm_runner.enqueue(
        "storyboard",
        "qwen",
        {"operation": "develop_story", "prompt": "Develop.", "output": "json"},
        context={"storyId": story_a["id"], "operation": "develop_story"},
    )
    other_story = llm_runner.enqueue(
        "storyboard",
        "qwen",
        {"operation": "expand_concept", "prompt": "Expand.", "output": "text"},
        context={"storyId": story_b["id"], "operation": "expand_concept"},
    )

    assert first["status"] == "queued"
    assert second["status"] == "queued"
    assert refine_same_scene["status"] == "queued"
    assert develop_same_story["status"] == "queued"
    assert other_story["status"] == "queued"
    assert llm_runner.storyboard_target_busy(story_a["id"], "scene-prompt", scene_a1["id"]) is True
    assert llm_runner.storyboard_target_busy(story_a["id"], "concept") is False





def test_storyboard_insert_scene_applies_one_director_scene_at_anchor(llm_root, monkeypatch):
    story = storyboard_store.create_story({
        "title": "Story",
        "concept": "A set of related visual variations.",
    })
    story, first = storyboard_store.add_scene(story["id"], {
        "title": "First",
        "summary": "First variation.",
        "prompt": "First prompt.",
    })
    story, second = storyboard_store.add_scene(story["id"], {
        "title": "Second",
        "summary": "Second variation.",
        "prompt": "Second prompt.",
    })

    from tool.server.storyboard_llm_contract import build_request
    contract = build_request(story, first["id"], "insert_scene")
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: False)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda *_args, **_kwargs: {
            "data": {
                "scene": {
                    "title": "Inserted",
                    "summary": "Distinct middle variation.",
                    "prompt": "Three brisk visual beats form a distinct middle variation.",
                    "suggestedDurationSeconds": 10,
                }
            },
            "text": "{}",
            "model": "qwen",
            "usage": None,
            "timings": None,
        },
    )

    job = llm_runner.enqueue(
        "storyboard",
        "qwen",
        contract,
        context={
            "storyId": story["id"],
            "sceneId": first["id"],
            "operation": "insert_scene",
            "sourceInstruction": "",
        },
    )
    llm_runner._advance_queue()

    finished = llm_runner.job_status(job["jobId"])
    saved = storyboard_store.load_story(story["id"])
    assert finished["status"] == "completed"
    assert len(saved["sceneOrder"]) == 3
    inserted_id = saved["sceneOrder"][1]
    assert saved["sceneOrder"] == [first["id"], inserted_id, second["id"]]
    assert saved["scenes"][inserted_id]["title"] == "Inserted"
    assert saved["scenes"][inserted_id]["prompt"] == "Three brisk visual beats form a distinct middle variation."


def test_storyboard_ingest_failure_is_distinguished_from_model_failure(llm_root, monkeypatch):
    story = storyboard_store.create_story({
        "title": "Story",
        "concept": "A woman crosses a lobby.",
        "targetSceneCount": 1,
    })
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: False)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda *_args, **_kwargs: {
            "data": {
                "scenes": [{
                    "title": "Lobby",
                    "summary": "She crosses the lobby.",
                    "prompt": "She crosses the lobby in several quick cuts.",
                    "suggestedDurationSeconds": 20,
                }],
            },
            "text": "{}",
            "model": "qwen",
            "usage": None,
            "timings": None,
        },
    )

    job = llm_runner.enqueue(
        "storyboard",
        "qwen",
        {"operation": "develop_story", "prompt": "Develop.", "output": "json"},
        context={"storyId": story["id"], "operation": "develop_story"},
    )
    llm_runner._advance_queue()

    finished = llm_runner.job_status(job["jobId"])
    assert finished["status"] == "failed"
    assert finished["error"].startswith("WebCap ingest failed after a successful model response:")
    assert "duration must be between 6 and 15 seconds" in finished["error"]


def test_storyboard_develop_accepts_minimal_scene_without_continuity_metadata(llm_root, monkeypatch):
    story = storyboard_store.create_story({
        "title": "Story",
        "concept": "Elena enters a lobby.",
        "targetSceneCount": 1,
    })
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: False)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda *_args, **_kwargs: {
            "data": {
                "scenes": [{
                    "title": "Lobby",
                    "summary": "Elena crosses the lobby.",
                    "prompt": "Elena crosses the lobby in a dense three-shot sequence.",
                    "suggestedDurationSeconds": 10,
                }],
            },
            "text": "{}",
            "model": "qwen",
            "usage": None,
            "timings": None,
        },
    )

    job = llm_runner.enqueue(
        "storyboard",
        "qwen",
        {"operation": "develop_story", "prompt": "Develop.", "output": "json"},
        context={"storyId": story["id"], "operation": "develop_story"},
    )
    llm_runner._advance_queue()

    finished = llm_runner.job_status(job["jobId"])
    saved = storyboard_store.load_story(story["id"])
    scene = saved["scenes"][saved["sceneOrder"][0]]
    assert finished["status"] == "completed"
    assert scene["prompt"] == "Elena crosses the lobby in a dense three-shot sequence."
    assert scene["entryState"] == ""
    assert scene["exitState"] == ""

def test_storyboard_develop_result_refuses_to_replace_scene_with_active_take(llm_root, monkeypatch):
    story = storyboard_store.create_story({
        "title": "Story",
        "concept": "A woman crosses a lobby.",
        "targetSceneCount": 1,
    })
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: False)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda *_args, **_kwargs: {
            "data": {
                "sharedContext": {
                    "subjects": [],
                    "wardrobes": [],
                    "locations": [],
                    "persistentFacts": [],
                },
                "scenes": [{
                    "title": "Lobby",
                    "summary": "She crosses the lobby.",
                    "entryState": "At the door.",
                    "exitState": "At the desk.",
                    "prompt": {
                        "integrated_multimodal_description": "She crosses the lobby.",
                        "overall_soundscape": "Footsteps.",
                        "non_diegetic_music": "N/A",
                    },
                    "sharedContextRefs": [],
                    "suggestedDurationSeconds": 6,
                    "continuity": {"continuesPreviousScene": False, "carryForward": []},
                }],
            },
            "text": "{}",
            "model": "qwen",
            "usage": None,
            "timings": None,
        },
    )
    from tool.server import storyboard_generation
    monkeypatch.setattr(
        storyboard_generation,
        "generation_queue",
        lambda story_id="": {"jobs": [{"jobId": "take-job"}]},
    )

    job = llm_runner.enqueue(
        "storyboard",
        "qwen",
        {"operation": "develop_story", "prompt": "Develop.", "output": "json"},
        context={"storyId": story["id"], "operation": "develop_story"},
    )
    llm_runner._advance_queue()

    finished = llm_runner.job_status(job["jobId"])
    assert finished["status"] == "failed"
    assert "pending Take generation" in finished["error"]
    assert storyboard_store.load_story(story["id"])["sceneOrder"] == []



def test_storyboard_develop_stores_director_prompt_without_rendering(llm_root, monkeypatch):
    story = storyboard_store.create_story({
        "title": "Story",
        "concept": "Elena crosses a silent lobby.",
        "targetSceneCount": 1,
        "invariants": [
            {"kind": "character", "title": "Elena", "text": "Stable Elena description."},
        ],
    })
    authored = "Wide entrance, hard cut to profile tracking, then a low angle as Elena reaches the desk."
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: False)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda *_args, **_kwargs: {
            "data": {
                "scenes": [{
                    "title": "Lobby",
                    "summary": "She crosses the lobby.",
                    "prompt": authored,
                    "suggestedDurationSeconds": 10,
                }]
            },
            "text": "{}",
            "model": "qwen",
            "usage": None,
            "timings": None,
        },
    )

    job = llm_runner.enqueue(
        "storyboard",
        "qwen",
        {"operation": "develop_story", "prompt": "Develop.", "output": "json"},
        context={"storyId": story["id"], "operation": "develop_story"},
    )
    llm_runner._advance_queue()

    finished = llm_runner.job_status(job["jobId"])
    stored = storyboard_store.load_story(story["id"])
    scene = stored["scenes"][stored["sceneOrder"][0]]

    assert finished["status"] == "completed"
    assert scene["prompt"] == authored
    assert scene["invariantRefs"] == []

def test_llm_restart_discards_all_outstanding_execution_state(llm_root):
    active = execution_queue.enqueue(
        llm_runner.EXECUTION_LANE,
        {"contract": {"prompt": "Active"}},
        metadata={"client": "generate", "modelId": "qwen"},
    )
    queued = execution_queue.enqueue(
        llm_runner.EXECUTION_LANE,
        {"contract": {"prompt": "Queued"}},
        metadata={"client": "generate", "modelId": "qwen"},
    )
    execution_queue.claim_next(llm_runner.EXECUTION_LANE)
    execution_queue.mark_running(active["id"])

    llm_runner._startup_reconciled = False
    llm_runner.reconcile_startup()

    assert execution_queue.lane_snapshot(llm_runner.EXECUTION_LANE)["jobs"] == []
    assert execution_queue.recent_snapshot(llm_runner.EXECUTION_LANE) == []
    with pytest.raises(FileNotFoundError):
        llm_runner.job_status(active["id"])
    with pytest.raises(FileNotFoundError):
        llm_runner.job_status(queued["id"])



def test_storyboard_scene_repair_stores_returned_prompt_without_rendering(llm_root, monkeypatch):
    story = storyboard_store.create_story({
        "title": "Story",
        "concept": "Elena attends a funeral.",
        "invariants": [{"kind": "character", "title": "Elena", "text": "Stable Elena description."}],
    })
    story, scene = storyboard_store.add_scene(story["id"], {
        "title": "Funeral",
        "summary": "Elena stands by the grave.",
        "prompt": "OLD PROMPT",
        "durationSeconds": 10,
    })
    base = {
        "storyContext": {
            "title": story["title"],
            "concept": story["concept"],
            "style": story["style"],
            "invariants": story["invariants"],
        },
        "sceneOrder": [scene["id"]],
        "scenes": {
            scene["id"]: {
                "title": scene["title"],
                "summary": scene["summary"],
                "entryState": scene["entryState"],
                "exitState": scene["exitState"],
                "prompt": scene["prompt"],
                "durationSeconds": scene["durationSeconds"],
                "referenceRoles": [],
                "invariantRefs": [],
            }
        },
    }
    authored = "Wide observational shot, cut to hands at the flowers, then pull back as mourners leave."
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: False)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda *_args, **_kwargs: {
            "data": {"changes": [{"sceneNumber": 1, "fields": {"prompt": authored}}]},
            "text": "{}",
            "model": "qwen",
            "usage": None,
            "timings": None,
        },
    )

    job = llm_runner.enqueue(
        "storyboard",
        "qwen",
        {"operation": "repair_scenes", "prompt": "Heal.", "output": "json"},
        context={"storyId": story["id"], "operation": "repair_scenes", "repairBase": base},
    )
    llm_runner._advance_queue()

    finished = llm_runner.job_status(job["jobId"])
    repaired = storyboard_store.load_story(story["id"])["scenes"][scene["id"]]

    assert finished["status"] == "completed"
    assert repaired["prompt"] == authored
    assert repaired["previousPrompt"] == "OLD PROMPT"

def test_storyboard_scene_repair_does_not_refuse_other_director_enqueue(llm_root):
    story = storyboard_store.create_story({"title": "Story"})
    story, scene = storyboard_store.add_scene(story["id"], {"prompt": "Prompt."})

    repair = llm_runner.enqueue(
        "storyboard",
        "qwen",
        {"operation": "repair_scenes", "prompt": "Heal.", "output": "json"},
        context={
            "storyId": story["id"],
            "operation": "repair_scenes",
            "repairBase": {
                "storyContext": {"concept": "", "style": "", "invariants": []},
                "sceneOrder": [scene["id"]],
                "scenes": {scene["id"]: {
                    "title": scene["title"],
                    "summary": "",
                    "entryState": "",
                    "exitState": "",
                    "prompt": "Prompt.",
                    "durationSeconds": scene["durationSeconds"],
                    "referenceRoles": [],
                    "invariantRefs": [],
                }},
            },
        },
    )
    write_prompt = llm_runner.enqueue(
        "storyboard",
        "qwen",
        {"operation": "write_prompt", "prompt": "Write.", "output": "text"},
        context={"storyId": story["id"], "sceneId": scene["id"], "operation": "write_prompt"},
    )

    assert repair["status"] == "queued"
    assert write_prompt["status"] == "queued"
    assert llm_runner.storyboard_target_busy(story["id"], "repair") is True



def test_storyboard_scene_repair_fails_loudly_on_malformed_prompt_patch(llm_root, monkeypatch):
    story = storyboard_store.create_story({"title": "Story"})
    story, scene = storyboard_store.add_scene(story["id"], {"summary": "Original.", "prompt": "Original prompt."})
    base = {
        "storyContext": {
            "title": story["title"],
            "concept": story["concept"],
            "style": story["style"],
            "invariants": story["invariants"],
        },
        "sceneOrder": [scene["id"]],
        "scenes": {
            scene["id"]: {
                "title": scene["title"],
                "summary": scene["summary"],
                "entryState": scene["entryState"],
                "exitState": scene["exitState"],
                "prompt": scene["prompt"],
                "durationSeconds": scene["durationSeconds"],
                "referenceRoles": [],
                "invariantRefs": [],
            }
        },
    }
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: False)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda *_args, **_kwargs: {
            "data": {"changes": [{"sceneNumber": 1, "fields": {"prompt": {"bad": True}}}]},
            "text": "{}",
            "model": "qwen",
            "usage": None,
            "timings": None,
        },
    )

    job = llm_runner.enqueue(
        "storyboard",
        "qwen",
        {"operation": "repair_scenes", "prompt": "Heal.", "output": "json"},
        context={"storyId": story["id"], "operation": "repair_scenes", "repairBase": base},
    )
    llm_runner._advance_queue()

    finished = llm_runner.job_status(job["jobId"])
    stored = storyboard_store.load_story(story["id"])
    assert finished["status"] == "failed"
    assert "must be text" in finished["error"]
    assert stored["scenes"][scene["id"]]["prompt"] == "Original prompt."

def test_llm_snapshot_explains_inference_gpu_blocker(llm_root, monkeypatch):
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: True)
    execution_queue.reserve_resource("inference")
    try:
        job = llm_runner.enqueue(
            "generate",
            "qwen",
            {"operation": "write_prompt", "prompt": "Expand.", "output": "text"},
            label="Prompt Assistant",
        )
        snapshot = llm_runner.snapshot()
    finally:
        execution_queue.release_resource("inference")

    assert job["status"] == "queued"
    assert snapshot["queueDepth"] == 1
    assert snapshot["waitOwner"] == "inference"
    assert snapshot["waitReason"] == "Inference currently holds the shared GPU."


def test_llm_snapshot_explains_training_queue_priority(llm_root, monkeypatch):
    from tool.server import training_runner

    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: True)
    monkeypatch.setattr(
        training_runner,
        "gpu_reservation_block_reason",
        lambda _owner: "2 Training job(s) are queued and the Training queue is not paused.",
    )
    llm_runner.enqueue(
        "generate",
        "qwen",
        {"operation": "write_prompt", "prompt": "Expand.", "output": "text"},
        label="Prompt Assistant",
    )

    snapshot = llm_runner.snapshot()

    assert snapshot["queueDepth"] == 1
    assert snapshot["waitOwner"] == "training"
    assert snapshot["waitReason"].startswith("2 Training job(s) are queued")


def test_llm_snapshot_surfaces_gpu_blocker_inspection_failure(llm_root, monkeypatch):
    from tool.server import training_runner

    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: True)
    monkeypatch.setattr(
        training_runner,
        "gpu_reservation_block_reason",
        lambda _owner: (_ for _ in ()).throw(RuntimeError("training blocker inspection failed")),
    )
    llm_runner.enqueue(
        "generate",
        "qwen",
        {"operation": "write_prompt", "prompt": "Expand.", "output": "text"},
        label="Prompt Assistant",
    )

    with pytest.raises(RuntimeError, match="training blocker inspection failed"):
        llm_runner.snapshot()


def test_llm_queue_rejects_pause_resume_and_reorder_actions(llm_root):
    for operation in ("pause_queue", "resume_queue", "reorder"):
        with pytest.raises(ValueError, match="Unsupported LLM queue action"):
            llm_runner.action(operation)


def test_llm_stop_or_cancel_cancels_queued_job_without_touching_runtime(llm_root, monkeypatch):
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "stop_active_request",
        lambda: pytest.fail("Queued LLM work must cancel without touching the runtime."),
    )
    job = llm_runner.enqueue(
        "generate",
        "qwen",
        {"operation": "write_prompt", "prompt": "Expand.", "output": "text"},
    )

    result = llm_runner.action("stop_or_cancel", job_id=job["jobId"])

    assert result["job"]["status"] == "cancelled"


def test_llm_stop_or_cancel_hard_stops_active_local_job(llm_root, monkeypatch):
    calls = []
    job = execution_queue.enqueue(
        llm_runner.EXECUTION_LANE,
        {"contract": {"operation": "write_prompt", "prompt": "Expand."}, "clientContext": {}},
        metadata={"client": "generate", "modelId": "qwen"},
    )
    execution_queue.claim_next(llm_runner.EXECUTION_LANE)
    execution_queue.mark_running(job["id"])
    monkeypatch.setattr(storyboard_llm_runtime, "assert_stop_supported", lambda: calls.append("assert"))
    monkeypatch.setattr(storyboard_llm_runtime, "stop_active_request", lambda: calls.append("stop") or True)

    result = llm_runner.action("stop_or_cancel", job_id=job["id"])

    assert result["job"]["status"] == "stopping"
    assert calls == ["assert", "stop"]


def test_llm_hard_stop_response_survives_worker_finishing_during_server_shutdown(llm_root, monkeypatch):
    job = execution_queue.enqueue(
        llm_runner.EXECUTION_LANE,
        {"contract": {"operation": "write_prompt", "prompt": "Expand."}, "clientContext": {}},
        metadata={"client": "generate", "modelId": "qwen"},
    )
    execution_queue.claim_next(llm_runner.EXECUTION_LANE)
    execution_queue.mark_running(job["id"])
    monkeypatch.setattr(storyboard_llm_runtime, "assert_stop_supported", lambda: None)

    def finish_during_stop():
        execution_queue.finish_job_transient(
            job["id"],
            status="stopped",
            error="LLM request stopped.",
        )
        return True

    monkeypatch.setattr(storyboard_llm_runtime, "stop_active_request", finish_during_stop)

    result = llm_runner.action("stop_or_cancel", job_id=job["id"])

    assert result["job"]["status"] == "stopping"
    assert llm_runner.job_status(job["id"])["status"] == "stopped"


def test_llm_stop_active_remote_uses_runtime_specific_cancel(llm_root, monkeypatch):
    calls = []
    job = execution_queue.enqueue(
        llm_runner.EXECUTION_LANE,
        {"contract": {"operation": "write_prompt", "prompt": "Expand."}, "clientContext": {}},
        metadata={"client": "generate", "modelId": "remote-model"},
    )
    execution_queue.claim_next(llm_runner.EXECUTION_LANE)
    execution_queue.mark_running(job["id"])
    monkeypatch.setattr(storyboard_llm_runtime, "assert_stop_supported", lambda: calls.append("assert"))
    monkeypatch.setattr(storyboard_llm_runtime, "stop_active_request", lambda: calls.append("cancel") or True)

    result = llm_runner.action("stop_or_cancel", job_id=job["id"])

    assert result["job"]["status"] == "stopping"
    assert calls == ["assert", "cancel"]


def test_llm_stopping_after_model_return_skips_client_ingest(llm_root, monkeypatch):
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: False)
    job = execution_queue.enqueue(
        llm_runner.EXECUTION_LANE,
        {"contract": {"operation": "write_prompt", "prompt": "Expand."}, "clientContext": {}},
        metadata={"client": "generate", "modelId": "qwen"},
    )
    execution_queue.claim_next(llm_runner.EXECUTION_LANE)

    def stopped_result(*_args, **_kwargs):
        execution_queue.request_stop(job["id"])
        return {"text": "Do not ingest", "model": "qwen"}

    monkeypatch.setattr(storyboard_llm_runtime, "run_contract", stopped_result)
    monkeypatch.setattr(
        llm_runner,
        "_client_result",
        lambda *_args, **_kwargs: pytest.fail("Stopped LLM output must not be ingested."),
    )

    llm_runner._execute_claimed(job["id"], gpu_reserved=False)

    assert llm_runner.job_status(job["id"])["status"] == "stopped"


def test_llm_snapshot_retries_startup_reconciliation_when_needed(llm_root):
    execution_queue.enqueue(
        llm_runner.EXECUTION_LANE,
        {"contract": {"messages": []}},
        metadata={"client": "storyboard", "operation": "expand_concept"},
    )
    llm_runner._startup_reconciled = False

    snapshot = llm_runner.snapshot(include_terminal=False)

    assert llm_runner._startup_reconciled is True
    assert snapshot["jobs"] == []



@pytest.mark.parametrize("assessment_evidence", [False, True])
def test_chat_runtime_overrides_are_validated_and_forwarded(llm_root, monkeypatch, assessment_evidence):
    captured = {}
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: False)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_freeform_chat",
        lambda model_id, messages, gpu_reserved=False, max_tokens=None, context_size=None, assessment_evidence=False: captured.update({
            "model": model_id,
            "maxTokens": max_tokens,
            "contextSize": context_size,
            "assessmentEvidence": assessment_evidence,
        }) or {
            "text": "CONTEXT_OK",
            "model": model_id,
            "finishReason": "stop",
            "contextSize": context_size,
        },
    )

    job = llm_runner.enqueue(
        "chat",
        "local::director.gguf",
        {"operation": "freeform_chat", "messages": [{"role": "user", "content": "probe"}]},
        context={"runtimeOverrides": {"maxTokens": 64, "contextSize": 16384}, "assessmentEvidence": assessment_evidence},
        label="Director Context Calibration",
    )
    llm_runner._advance_queue()

    finished = llm_runner.job_status(job["jobId"])
    assert finished["status"] == "completed"
    assert captured == {
        "model": "local::director.gguf",
        "maxTokens": 64,
        "contextSize": 16384,
        "assessmentEvidence": assessment_evidence,
    }
    assert finished["result"]["contextSize"] == 16384


def test_runtime_overrides_are_rejected_outside_chat(llm_root):
    with pytest.raises(ValueError, match="only for chat jobs"):
        llm_runner.enqueue(
            "storyboard",
            "qwen",
            {"operation": "write_prompt", "prompt": "Write."},
            context={"runtimeOverrides": {"maxTokens": 2048}},
        )


def test_runtime_override_rejects_unknown_fields(llm_root):
    with pytest.raises(ValueError, match="Unsupported LLM runtime override"):
        llm_runner.enqueue(
            "chat",
            "qwen",
            {"operation": "freeform_chat", "messages": [{"role": "user", "content": "probe"}]},
            context={"runtimeOverrides": {"magic": 123}},
        )



def test_individual_story_development_jobs_do_not_mutate_story_before_final_apply(llm_root, monkeypatch):
    story = storyboard_store.create_story({
        "title": "Story",
        "concept": "A woman crosses an empty station.",
        "targetSceneCount": 2,
    })
    original_updated_at = story["updatedAt"]
    from tool.server.storyboard_llm_contract import build_request

    outline_contract = build_request(story, "", "develop_story_outline")
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda *_args: False)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda *_args, **_kwargs: {
            "data": {
                "scenes": [
                    {
                        "title": "Arrival",
                        "summary": "She enters the station.",
                        "suggestedDurationSeconds": 10,
                    },
                    {
                        "title": "Platform",
                        "summary": "She reaches the platform.",
                        "suggestedDurationSeconds": 10,
                    },
                ]
            },
            "text": "{}",
            "model": "qwen",
            "usage": None,
            "timings": None,
        },
    )

    job = llm_runner.enqueue(
        "storyboard",
        "qwen",
        outline_contract,
        context={
            "storyId": story["id"],
            "sceneId": "",
            "operation": "develop_story_outline",
            "deferredApply": True,
        },
    )
    llm_runner._advance_queue()

    finished = llm_runner.job_status(job["jobId"])
    stored = storyboard_store.load_story(story["id"])

    assert finished["status"] == "completed"
    assert len(finished["result"]["outline"]["scenes"]) == 2
    assert stored["sceneOrder"] == []
    assert stored["updatedAt"] == original_updated_at
