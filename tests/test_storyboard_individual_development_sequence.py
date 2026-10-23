"""Individual Scene development remains one Director job across all model calls."""
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_backend_owns_the_complete_sequence():
    app = (ROOT / "tool/server/app.py").read_text()
    runner = (ROOT / "tool/server/llm_runner.py").read_text()
    batch = runner.split('context.get("operation") == "develop_scenes_sequence":', 1)[1].split(
        'context.get("operation") == "check_coherence_sequence":', 1
    )[0]
    assert 'if operation == "develop_scenes_sequence":' in app
    assert '"sourceUpdatedAt": str(story.get("updatedAt") or "")' in app
    assert 'build_request(story, "", "develop_story_outline")' in batch
    assert '"develop_story_scene", development=' in batch
    assert '"previousScene": authored[-1] if authored else None' in batch
    assert batch.index('for index in range(total):') < batch.index('apply_developed_plan(')
    assert 'with _mutation_lock:' in batch
    assert 'check_stopped()' in batch
    assert 'source_revision' in batch
    assert '"phase": "Developing Scenes"' in batch
    assert '"phase": "Applying Scenes"' in batch


def test_browser_submits_one_job_and_uses_job_progress():
    js = (ROOT / "tool/js/storyboard.js").read_text()
    individual = js.split('function developStoryIndividually(', 1)[1].split(
        '\n  function suggestStoryboardLoras()', 1
    )[0]
    assert individual.count('directorRequest({') == 1
    assert "operation: 'develop_scenes_sequence'" in individual
    assert "operation: 'develop_story_scene'" not in individual
    assert "operation: 'apply_individual_development'" not in individual
    assert "operation === 'develop_scenes_sequence'" in js
    assert "var developing = operation === 'develop_scenes_sequence';" in js


import copy

import pytest

from tool.server import execution_queue, llm_runner, storyboard_generation, storyboard_llm_contract, storyboard_llm_runtime, storyboard_store


@pytest.fixture
def sequence_runtime(monkeypatch):
    lane = execution_queue.ephemeral_lane("llm")
    lane.clear()
    execution_queue.clear_transient_receipts()
    monkeypatch.setattr(llm_runner, "_startup_reconciled", True)
    monkeypatch.setattr(llm_runner, "_ensure_monitor_started", lambda: None)
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda _model: False)

    story = {"id": "story-1", "updatedAt": "rev-1", "sceneOrder": []}
    monkeypatch.setattr(storyboard_store, "load_story", lambda _id: copy.deepcopy(story))
    monkeypatch.setattr(storyboard_generation, "generation_queue", lambda _id: {"jobs": []})
    applied = []
    calls = []
    behavior = {"fail_at": None, "stop_after": None, "job_id": ""}

    def apply_plan(story_id, plan, model_id=""):
        applied.append(copy.deepcopy(plan))
        return {"id": story_id, "sceneOrder": ["first", "second"]}

    def build_request(story, scene_id, operation, **kwargs):
        return {"operation": operation, "development": kwargs.get("development")}

    def run_contract(model_id, contract, **kwargs):
        operation = contract["operation"]
        calls.append(operation)
        if operation == "develop_story_outline":
            return {"model": model_id, "data": {"scenes": [{"title": "First"}, {"title": "Second"}]}}
        context = contract["development"]
        index = context["sceneIndex"]
        if index:
            assert context["previousScene"]["title"] == "Authored 1"
        else:
            assert context["previousScene"] is None
        if behavior["fail_at"] == index:
            raise RuntimeError("simulated Scene model failure")
        if behavior["stop_after"] == index:
            lane.cancel_or_stop(behavior["job_id"])
        return {"model": model_id, "data": {"scene": {"title": "Authored " + str(index + 1)}}}

    monkeypatch.setattr(storyboard_store, "apply_developed_plan", apply_plan)
    monkeypatch.setattr(storyboard_llm_contract, "build_request", build_request)
    monkeypatch.setattr(storyboard_llm_runtime, "run_contract", run_contract)

    def execute():
        queued = llm_runner.enqueue(
            "storyboard", "test-model", {"operation": "develop_scenes_sequence"},
            context={"storyId": "story-1", "operation": "develop_scenes_sequence",
                     "sourceUpdatedAt": "rev-1", "replaceExisting": False},
        )
        behavior["job_id"] = queued["jobId"]
        assert len(llm_runner.snapshot()["jobs"]) == 1
        claimed = llm_runner.execution_claim_next("llm")
        assert claimed["id"] == queued["jobId"]
        return llm_runner._execute_claimed(queued["jobId"], gpu_reserved=False)

    yield execute, applied, calls, behavior
    lane.clear()
    execution_queue.clear_transient_receipts()


def test_all_scene_calls_complete_before_one_final_apply(sequence_runtime):
    execute, applied, calls, _ = sequence_runtime
    finished = execute()
    assert finished["status"] == "completed"
    assert calls == ["develop_story_outline", "develop_story_scene", "develop_story_scene"]
    assert len(applied) == 1
    assert [scene["title"] for scene in applied[0]["scenes"]] == ["Authored 1", "Authored 2"]


def test_scene_failure_leaves_existing_plan_untouched(sequence_runtime):
    execute, applied, calls, behavior = sequence_runtime
    behavior["fail_at"] = 1
    with pytest.raises(RuntimeError, match="failed after 1 of 2"):
        execute()
    assert len(calls) == 3
    assert applied == []


def test_stop_during_scene_generation_discards_staged_plan(sequence_runtime):
    execute, applied, calls, behavior = sequence_runtime
    behavior["stop_after"] = 0
    finished = execute()
    assert finished["status"] == "stopped"
    assert len(calls) == 2
    assert applied == []
