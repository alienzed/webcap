from pathlib import Path

import pytest

from tool.server import config as app_config
from tool.server import execution_queue
from tool.server import llm_runner
from tool.server import storyboard_llm_runtime
from tool.server import storyboard_store


@pytest.fixture
def llm_root(tmp_path, monkeypatch):
    monkeypatch.setattr(app_config, "FS_ROOT", Path(tmp_path))
    monkeypatch.setattr(app_config, "output_root", lambda: Path(tmp_path) / "output")
    execution_queue._resource_owner = ""
    execution_queue.clear_transient_receipts()
    llm_runner._startup_reconciled = True
    llm_runner._monitor_thread = None
    storyboard_llm_runtime.clear_stop_request()
    monkeypatch.setattr(llm_runner, "_ensure_monitor_started", lambda: None)
    return tmp_path


def test_llm_generate_job_runs_through_shared_lane(llm_root, monkeypatch):
    calls = []
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda: True)
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
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda: True)
    execution_queue._resource_owner = "training"

    job = llm_runner.enqueue(
        "generate",
        "qwen",
        {"operation": "write_prompt", "prompt": "Expand.", "output": "text"},
    )

    assert llm_runner._advance_queue() is None
    assert llm_runner.job_status(job["jobId"])["status"] == "queued"
    assert execution_queue.resource_owner() == "training"


def test_llm_remote_job_does_not_claim_shared_gpu(llm_root, monkeypatch):
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda: False)
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
        "remote-model",
        {"operation": "refine_prompt", "prompt": "Refine.", "output": "text"},
    )
    llm_runner._advance_queue()

    assert llm_runner.job_status(job["jobId"])["status"] == "completed"
    assert captured == {"model": "remote-model", "gpu_reserved": False}


def test_storyboard_llm_job_rejects_inconsistent_frozen_identity(llm_root, monkeypatch):
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda: False)
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


def test_storyboard_llm_job_applies_expanded_concept_before_completion(llm_root, monkeypatch):
    story = storyboard_store.create_story({"title": "Story", "concept": "Short concept."})
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda: False)
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
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda: False)
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
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda: False)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda *_args, **_kwargs: {
            "text": "New first prompt.",
            "model": "qwen",
            "usage": None,
            "timings": None,
        },
    )

    job = llm_runner.enqueue(
        "storyboard",
        "qwen",
        {"operation": "write_prompt", "prompt": "Write.", "output": "text"},
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
    assert stored["scenes"][first["id"]]["promptDirectorJobId"] == job["jobId"]
    assert stored["scenes"][second["id"]]["prompt"] == "Second prompt stays untouched."


def test_storyboard_director_target_conflicts_are_backend_authoritative(llm_root):
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

    assert first["status"] == "queued"
    assert second["status"] == "queued"
    assert llm_runner.storyboard_target_busy(story_a["id"], "scene-prompt", scene_a1["id"]) is True
    assert llm_runner.storyboard_target_busy(story_a["id"], "concept") is False

    with pytest.raises(ValueError, match="target already has pending work"):
        llm_runner.enqueue(
            "storyboard",
            "qwen",
            {"operation": "refine_prompt", "prompt": "Refine.", "output": "text"},
            context={"storyId": story_a["id"], "sceneId": scene_a1["id"], "operation": "refine_prompt"},
        )

    with pytest.raises(ValueError, match="target already has pending work"):
        llm_runner.enqueue(
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
    assert other_story["status"] == "queued"



def test_storyboard_ingest_failure_is_distinguished_from_model_failure(llm_root, monkeypatch):
    story = storyboard_store.create_story({
        "title": "Story",
        "concept": "A woman crosses a lobby.",
        "targetSceneCount": 1,
    })
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda: False)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda *_args, **_kwargs: {
            "data": {
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
                    "suggestedDurationSeconds": 20,
                    "continuity": {"continuesPreviousScene": False, "carryForward": []},
                }],
            },
            "text": "{\"scenes\":[{\"title\":\"Lobby\"}]}",
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
    assert finished["error"].startswith(
        "WebCap ingest failed after a successful model response:"
    )
    assert "duration must be between 4 and 15 seconds" in finished["error"]


def test_storyboard_optional_shared_context_cannot_block_scene_ingest(llm_root, monkeypatch):
    story = storyboard_store.create_story({
        "title": "Story",
        "concept": "Elena enters a lobby.",
        "targetSceneCount": 1,
    })
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda: False)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda *_args, **_kwargs: {
            "data": {
                "sharedContext": {
                    "subjects": [
                        {"id": "character:elena", "label": "Elena", "description": "Dark shoulder-length hair."},
                        {"id": "elena", "label": "Elena duplicate", "description": "Same woman."},
                    ],
                    "wardrobes": [
                        {"id": "elena", "label": "Elena wardrobe", "description": "Black wool coat."},
                    ],
                    "locations": [],
                    "persistentFacts": [],
                },
                "scenes": [{
                    "title": "Lobby",
                    "summary": "Elena crosses the lobby.",
                    "entryState": "At the door.",
                    "exitState": "At the desk.",
                    "prompt": {
                        "integrated_multimodal_description": "Elena crosses the lobby.",
                        "overall_soundscape": "Footsteps.",
                        "non_diegetic_music": "N/A",
                    },
                    "sharedContextRefs": ["character:elena", "elena"],
                    "suggestedDurationSeconds": 6,
                    "continuity": {"continuesPreviousScene": False, "carryForward": []},
                }],
            },
            "text": "{\"sharedContext\":{},\"scenes\":[{\"title\":\"Lobby\"}]}",
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
    assert finished["status"] == "completed"
    assert finished["result"]["sceneCount"] == 1
    saved = storyboard_store.load_story(story["id"])
    scene = saved["scenes"][saved["sceneOrder"][0]]
    assert scene["title"] == "Lobby"
    assert scene["sharedContextRefs"] == []


def test_storyboard_develop_result_refuses_to_replace_scene_with_active_take(llm_root, monkeypatch):
    story = storyboard_store.create_story({
        "title": "Story",
        "concept": "A woman crosses a lobby.",
        "targetSceneCount": 1,
    })
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda: False)
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


def test_storyboard_develop_job_renders_structured_h3_prompts_before_store(llm_root, monkeypatch):
    story = storyboard_store.create_story({
        "title": "Story",
        "concept": "Elena crosses a silent lobby.",
        "targetSceneCount": 1,
        "invariants": [
            {"kind": "character", "title": "Elena", "text": "White woman in her early 30s with fair skin, hazel eyes, and shoulder-length dark brown wavy hair."},
        ],
    })
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda: False)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda *_args, **_kwargs: {
            "data": {
                "scenes": [{
                    "title": "Lobby",
                    "summary": "She crosses the lobby.",
                    "entryState": "She stands at the door.",
                    "exitState": "She reaches the desk.",
                    "prompt": {
                        "integrated_multimodal_description": "Elena crosses the lobby toward the desk.",
                        "overall_soundscape": "Soft footsteps and distant rain.",
                        "non_diegetic_music": "N/A",
                    },
                    "invariantRefs": [
                        {"kind": "character", "title": "Elena"},
                    ],
                    "suggestedDurationSeconds": 6,
                    "continuity": {"continuesPreviousScene": False, "carryForward": []},
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
        context={
            "storyId": story["id"],
            "operation": "develop_story",
        },
    )
    llm_runner._advance_queue()

    finished = llm_runner.job_status(job["jobId"])
    stored = storyboard_store.load_story(story["id"])
    prompt = stored["scenes"][stored["sceneOrder"][0]]["prompt"]

    assert finished["status"] == "completed"
    assert prompt == (
        "integrated_multimodal_description: [Shot 1] Continuity anchors — "
        "Character Elena: White woman in her early 30s with fair skin, hazel eyes, and shoulder-length dark brown wavy hair. "
        "Elena crosses the lobby toward the desk.\n\n"
        "overall_soundscape: Soft footsteps and distant rain.\n\n"
        "non_diegetic_music: N/A"
    )
    scene = stored["scenes"][stored["sceneOrder"][0]]
    assert scene["invariantRefs"] == [{"kind": "character", "title": "Elena"}]


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


def test_storyboard_scene_repair_renders_prompt_and_patches_only_returned_fields(llm_root, monkeypatch):
    story = storyboard_store.create_story({
        "title": "Story",
        "concept": "Elena attends a funeral.",
        "invariants": [
            {"kind": "character", "title": "Elena", "text": "White woman in her early 30s with hazel eyes and dark brown hair."},
        ],
    })
    story, scene = storyboard_store.add_scene(story["id"], {
        "title": "Funeral",
        "summary": "Elena stands by the grave.",
        "entryState": "At the cemetery.",
        "exitState": "She remains after the mourners leave.",
        "prompt": "OLD PROMPT",
        "invariantRefs": [{"kind": "character", "title": "Elena"}],
        "durationSeconds": 6,
    })
    base = {
        "storyContext": {
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
                "invariantRefs": scene["invariantRefs"],
            }
        },
    }
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda: False)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda *_args, **_kwargs: {
            "data": {
                "changes": [{
                    "sceneNumber": 1,
                    "fields": {
                        "prompt": {
                            "integrated_multimodal_description": "A wide observational view keeps Elena small beside the grave.",
                            "overall_soundscape": "Wind in trees and distant footsteps.",
                            "non_diegetic_music": "N/A",
                        }
                    },
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
        {"operation": "repair_scenes", "prompt": "Heal.", "output": "json"},
        context={
            "storyId": story["id"],
            "operation": "repair_scenes",
            "repairBase": base,
        },
    )
    llm_runner._advance_queue()

    finished = llm_runner.job_status(job["jobId"])
    stored = storyboard_store.load_story(story["id"])
    repaired = stored["scenes"][scene["id"]]

    assert finished["status"] == "completed"
    assert finished["result"]["changedSceneCount"] == 1
    assert repaired["title"] == "Funeral"
    assert repaired["summary"] == "Elena stands by the grave."
    assert "Continuity anchors — Character Elena:" in repaired["prompt"]
    assert "wide observational view" in repaired["prompt"]
    assert repaired["previousPrompt"] == "OLD PROMPT"


def test_storyboard_scene_repair_conflicts_with_other_director_work(llm_root):
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
    assert repair["status"] == "queued"
    assert llm_runner.storyboard_target_busy(story["id"], "repair") is True

    with pytest.raises(ValueError, match="target already has pending work"):
        llm_runner.enqueue(
            "storyboard",
            "qwen",
            {"operation": "write_prompt", "prompt": "Write.", "output": "text"},
            context={"storyId": story["id"], "sceneId": scene["id"], "operation": "write_prompt"},
        )


def test_storyboard_scene_repair_discards_malformed_optional_prompt_patch(llm_root, monkeypatch):
    story = storyboard_store.create_story({"title": "Story"})
    story, scene = storyboard_store.add_scene(story["id"], {"summary": "Original.", "prompt": "Original prompt."})
    base = {
        "storyContext": {"concept": "", "style": "", "invariants": []},
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
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda: False)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "run_contract",
        lambda *_args, **_kwargs: {
            "data": {
                "changes": [{
                    "sceneNumber": 1,
                    "fields": {
                        "summary": "Valid summary repair.",
                        "prompt": "MALFORMED RAW PROMPT MUST NOT BE APPLIED",
                    },
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
        {"operation": "repair_scenes", "prompt": "Heal.", "output": "json"},
        context={"storyId": story["id"], "operation": "repair_scenes", "repairBase": base},
    )
    llm_runner._advance_queue()

    finished = llm_runner.job_status(job["jobId"])
    stored = storyboard_store.load_story(story["id"])
    assert finished["status"] == "completed"
    assert stored["scenes"][scene["id"]]["summary"] == "Valid summary repair."
    assert stored["scenes"][scene["id"]]["prompt"] == "Original prompt."


def test_llm_snapshot_explains_inference_gpu_blocker(llm_root, monkeypatch):
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda: True)
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

    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda: True)
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


def test_llm_stop_or_cancel_cancels_queued_job_without_touching_runtime(llm_root, monkeypatch):
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "stop_owned_server",
        lambda: pytest.fail("Queued LLM work must cancel without killing llama.cpp."),
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
    monkeypatch.setattr(storyboard_llm_runtime, "assert_hard_stop_supported", lambda: calls.append("assert"))
    monkeypatch.setattr(storyboard_llm_runtime, "stop_owned_server", lambda: calls.append("stop") or True)

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
    monkeypatch.setattr(storyboard_llm_runtime, "assert_hard_stop_supported", lambda: None)

    def finish_during_stop():
        execution_queue.finish_job_transient(
            job["id"],
            status="stopped",
            error="LLM request stopped.",
        )
        return True

    monkeypatch.setattr(storyboard_llm_runtime, "stop_owned_server", finish_during_stop)

    result = llm_runner.action("stop_or_cancel", job_id=job["id"])

    assert result["job"]["status"] == "stopping"
    assert llm_runner.job_status(job["id"])["status"] == "stopped"


def test_llm_stopping_after_model_return_skips_client_ingest(llm_root, monkeypatch):
    monkeypatch.setattr(storyboard_llm_runtime, "uses_local_gpu", lambda: False)
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
