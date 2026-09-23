import copy

import pytest

from tool.server import execution_queue
from tool.server import storyboard_generation
from tool.server import storyboard_store


@pytest.fixture
def storyboard_fs(tmp_path, monkeypatch):
    monkeypatch.setattr(storyboard_store.app_config, "FS_ROOT", str(tmp_path))
    monkeypatch.setattr(storyboard_generation.app_config, "FS_ROOT", str(tmp_path))
    execution_queue._resource_owner = ""
    storyboard_generation._startup_reconciled = False
    return tmp_path


def test_scene_settings_preserve_manual_prompt_and_render_controls(storyboard_fs, monkeypatch):
    monkeypatch.setattr(storyboard_generation.secrets, "randbelow", lambda _limit: 4242)
    scene = {
        "prompt": "A quiet hallway.",
        "entryState": "The hall is empty.",
        "exitState": "A door at the far end opens.",
        "durationSeconds": 8,
        "aspectRatio": "16:9 (Widescreen)",
        "megapixels": 0.4,
        "seedMode": "random",
        "wildcardsEnabled": False,
    }

    settings = storyboard_generation._scene_settings(scene)

    assert settings == {
        "prompt": "A quiet hallway.",
        "sourcePrompt": "A quiet hallway.",
        "entryState": "The hall is empty.",
        "exitState": "A door at the far end opens.",
        "wildcardsEnabled": False,
        "aspectRatio": "16:9 (Widescreen)",
        "megapixels": 0.4,
        "duration": 8.0,
        "seed": 4242,
        "seedMode": "random",
        "references": [],
        "loras": [],
    }


def test_build_workflow_changes_only_storyboard_generation_inputs(monkeypatch):
    template = {
        "115": {"inputs": {"aspect_ratio": "4:3 (Standard)", "megapixels": 0.2}},
        "119": {"inputs": {"vae_name": "video.safetensors"}},
        "120": {"inputs": {"vae_name": "audio.safetensors"}},
        "127": {"inputs": {"unet_name": "model.safetensors"}},
        "128": {"inputs": {"clip_name": "clip.safetensors"}},
        "129": {"inputs": {"noise_seed": 1}},
        "133": {"inputs": {"value": 7}},
        "138": {"inputs": {"model": ["148", 0], "clip": ["148", 1], "lora_1": {"on": True, "lora": "turbo.safetensors"}}},
        "141": {"inputs": {"filename_prefix": "old"}},
        "146": {"inputs": {"wildcard_text": "old", "populated_text": "old", "mode": "populate", "seed": 1}},
        "148": {"inputs": {"lora_name": "candidate.safetensors"}},
        "161": {"inputs": {"model": ["127", 0]}},
    }
    original = copy.deepcopy(template)
    monkeypatch.setattr(storyboard_generation, "_resolve_template_assets", lambda value: copy.deepcopy(value))
    settings = {
        "prompt": "Manual prompt.",
        "sourcePrompt": "Manual prompt.",
        "wildcardsEnabled": False,
        "aspectRatio": "16:9 (Widescreen)",
        "megapixels": 0.4,
        "duration": 8,
        "seed": 123,
        "seedMode": "fixed",
    }

    workflow = storyboard_generation._build_workflow(
        template,
        settings,
        "webcap-storyboard/story/scene/job/render",
        uploaded_references={"first_frame": "webcap-storyboard/story/job/first.png"},
    )

    assert template == original
    assert workflow["146"]["inputs"]["wildcard_text"] == "Manual prompt."
    assert workflow["146"]["inputs"]["populated_text"] == "Manual prompt."
    assert workflow["146"]["inputs"]["mode"] == "fixed"
    assert workflow["115"]["inputs"]["aspect_ratio"] == "16:9 (Widescreen)"
    assert workflow["115"]["inputs"]["megapixels"] == 0.4
    assert workflow["133"]["inputs"]["value"] == 8
    assert workflow["129"]["inputs"]["noise_seed"] == 123
    assert workflow["141"]["inputs"]["filename_prefix"].startswith("webcap-storyboard/")
    assert "148" not in workflow
    assert workflow["138"]["inputs"]["model"] == ["161", 0]
    assert workflow["138"]["inputs"]["clip"] == ["128", 0]
    assert workflow["190"]["class_type"] == "LoadImage"
    assert workflow["190"]["inputs"]["image"].endswith("/first.png")
    assert workflow["131"]["inputs"]["first_frame"] == ["190", 0]


def test_completed_generation_becomes_story_take_with_frozen_provenance(storyboard_fs, monkeypatch):
    story = storyboard_store.create_story({"title": "Story"})
    story, scene = storyboard_store.add_scene(story["id"], {
        "title": "Scene",
        "prompt": "A woman enters an empty studio.",
        "entryState": "The studio is empty and dark.",
        "exitState": "She stands just inside the doorway.",
        "durationSeconds": 6,
        "aspectRatio": "16:9 (Widescreen)",
        "megapixels": 0.3,
        "seedMode": "fixed",
        "seed": 77,
    })
    settings = storyboard_generation._scene_settings(scene)
    job_id = "job-1"
    storyboard_generation._jobs[job_id] = {
        "jobId": job_id,
        "storyId": story["id"],
        "sceneId": scene["id"],
        "status": "running",
        "startedAt": "now",
        "completedAt": None,
        "comfyJobId": None,
        "comfyStatus": "starting",
        "takeId": None,
        "error": "",
    }
    storyboard_generation._active_job_id = job_id

    monkeypatch.setattr(storyboard_generation, "_load_template", lambda: {})
    monkeypatch.setattr(storyboard_generation, "_upload_scene_references", lambda _story_id, _job_id, _refs: {})
    monkeypatch.setattr(storyboard_generation, "_build_workflow", lambda _template, _settings, _prefix, uploaded_references=None: {"workflow": True})
    monkeypatch.setattr(storyboard_generation, "_queue_workflow", lambda _workflow: "comfy-123")
    monkeypatch.setattr(storyboard_generation, "_wait_for_output", lambda _prompt_id, _job_id: {
        "filename": "render.mp4",
        "subfolder": "webcap-storyboard",
        "type": "output",
    })
    monkeypatch.setattr(storyboard_generation, "_download_output", lambda _ref: b"generated-video")

    storyboard_generation._run_generation(job_id, story["id"], scene["id"], settings)

    loaded = storyboard_store.load_story(story["id"])
    current = loaded["scenes"][scene["id"]]
    assert len(current["takeOrder"]) == 1
    take = current["takes"][current["takeOrder"][0]]
    assert take["generated"] is True
    assert take["prompt"] == "A woman enters an empty studio."
    assert take["entryState"] == "The studio is empty and dark."
    assert take["exitState"] == "She stands just inside the doorway."
    assert take["durationSeconds"] == 6.0
    assert take["seed"] == 77
    assert take["aspectRatio"] == "16:9 (Widescreen)"
    assert take["megapixels"] == 0.3
    assert take["references"] == []
    assert take["loras"] == []
    assert take["workflowProfile"] == "minimax_h3_storyboard_v1"
    assert take["providerJobId"] == "comfy-123"
    media_path = storyboard_fs / "output" / "storyboards" / story["id"] / take["mediaPath"]
    assert media_path.read_bytes() == b"generated-video"
    assert storyboard_generation.generation_status(job_id)["status"] == "completed"


def test_guide_frame_reference_fails_visibly_before_generation(tmp_path):
    image = tmp_path / "guide.png"
    image.write_bytes(b"image")
    with pytest.raises(RuntimeError, match="Guide-frame references"):
        storyboard_generation._upload_scene_references(
            "story-1",
            "job-1",
            [{"role": "guide_frame", "mediaPath": "references/guide.png"}],
        )


def test_scene_settings_reject_h3_duration_outside_supported_range(storyboard_fs):
    with pytest.raises(ValueError, match="between 4 and 15"):
        storyboard_generation._scene_settings({
            "prompt": "Prompt",
            "durationSeconds": 3,
            "aspectRatio": "4:3 (Standard)",
            "megapixels": 0.2,
            "seedMode": "random",
        })
    with pytest.raises(ValueError, match="between 4 and 15"):
        storyboard_generation._scene_settings({
            "prompt": "Prompt",
            "durationSeconds": 16,
            "aspectRatio": "4:3 (Standard)",
            "megapixels": 0.2,
            "seedMode": "random",
        })


def test_build_workflow_adds_selected_scene_lora_after_base_lora(monkeypatch):
    template = {
        "115": {"inputs": {"aspect_ratio": "4:3 (Standard)", "megapixels": 0.2}},
        "119": {"inputs": {"vae_name": "video.safetensors"}},
        "120": {"inputs": {"vae_name": "audio.safetensors"}},
        "127": {"inputs": {"unet_name": "model.safetensors"}},
        "128": {"inputs": {"clip_name": "clip.safetensors"}},
        "129": {"inputs": {"noise_seed": 1}},
        "131": {"inputs": {}},
        "133": {"inputs": {"value": 7}},
        "138": {"inputs": {
            "model": ["148", 0],
            "clip": ["148", 1],
            "lora_1": {"on": True, "lora": "mh3/turbo.safetensors", "strength": 1},
        }},
        "141": {"inputs": {"filename_prefix": "old"}},
        "146": {"inputs": {"wildcard_text": "old", "populated_text": "old", "mode": "populate", "seed": 1}},
        "148": {"inputs": {"lora_name": "candidate.safetensors"}},
        "161": {"inputs": {"model": ["127", 0]}},
    }
    monkeypatch.setattr(storyboard_generation, "_resolve_template_assets", lambda value: copy.deepcopy(value))
    monkeypatch.setattr(
        storyboard_generation,
        "_available_comfy_names",
        lambda *_args: ["mh3/turbo.safetensors", "characters/alice.safetensors"],
    )
    settings = {
        "prompt": "Prompt",
        "sourcePrompt": "Prompt",
        "wildcardsEnabled": False,
        "aspectRatio": "4:3 (Standard)",
        "megapixels": 0.2,
        "duration": 6,
        "seed": 1,
        "seedMode": "fixed",
        "loras": [{"name": "characters/alice.safetensors", "strength": 0.75}],
    }

    workflow = storyboard_generation._build_workflow(template, settings, "story/render")

    assert workflow["138"]["inputs"]["lora_1"]["lora"] == "mh3/turbo.safetensors"
    assert workflow["138"]["inputs"]["lora_2"] == {
        "on": True,
        "lora": "characters/alice.safetensors",
        "strength": 0.75,
    }


def test_generation_capabilities_exclude_base_h3_lora(monkeypatch):
    monkeypatch.setattr(storyboard_generation, "_load_template", lambda: {
        "138": {"inputs": {
            "lora_1": {"on": True, "lora": "mh3/turbo.safetensors", "strength": 1},
        }}
    })
    monkeypatch.setattr(
        storyboard_generation,
        "_available_comfy_names",
        lambda *_args: ["characters/alice.safetensors", "mh3/turbo.safetensors"],
    )

    payload = storyboard_generation.generation_capabilities()

    assert payload == {
        "loras": ["characters/alice.safetensors"],
        "baseLoras": ["mh3/turbo.safetensors"],
    }


def test_storyboard_generation_queues_jobs_with_frozen_settings(storyboard_fs, monkeypatch):
    story = storyboard_store.create_story({"title": "Story"})
    story, first = storyboard_store.add_scene(story["id"], {
        "title": "First",
        "prompt": "First prompt.",
        "durationSeconds": 6,
        "aspectRatio": "16:9 (Widescreen)",
        "megapixels": 0.2,
        "seedMode": "fixed",
        "seed": 11,
    })
    story, second = storyboard_store.add_scene(story["id"], {
        "title": "Second",
        "prompt": "Second prompt.",
        "durationSeconds": 7,
        "aspectRatio": "16:9 (Widescreen)",
        "megapixels": 0.3,
        "seedMode": "fixed",
        "seed": 22,
    })

    monkeypatch.setattr(storyboard_generation, "_reserve_gpu", lambda: None)
    monkeypatch.setattr(storyboard_generation, "_release_gpu", lambda: None)
    monkeypatch.setattr(
        storyboard_generation,
        "_start_job_thread",
        lambda job_id: execution_queue.mark_running(job_id),
    )

    active = storyboard_generation.start_generation(story["id"], first["id"])
    queued = storyboard_generation.start_generation(story["id"], second["id"])

    assert active["status"] == "running"
    assert queued["status"] == "queued"
    assert queued["queuePosition"] == 1

    stored = execution_queue.get_job(queued["jobId"], include_payload=True)
    assert stored["payload"]["settings"]["prompt"] == "Second prompt."
    assert stored["payload"]["settings"]["duration"] == 7.0
    assert stored["payload"]["settings"]["seed"] == 22

    storyboard_store.update_scene(story["id"], second["id"], {"prompt": "Edited later."})
    stored_after_edit = execution_queue.get_job(queued["jobId"], include_payload=True)
    assert stored_after_edit["payload"]["settings"]["prompt"] == "Second prompt."


def test_storyboard_generation_allows_multiple_take_jobs_for_same_scene(storyboard_fs, monkeypatch):
    story = storyboard_store.create_story({"title": "Story"})
    story, scene = storyboard_store.add_scene(story["id"], {
        "title": "First",
        "prompt": "First prompt.",
        "durationSeconds": 6,
        "aspectRatio": "4:3 (Standard)",
        "megapixels": 0.2,
        "seedMode": "random",
    })

    monkeypatch.setattr(storyboard_generation, "_reserve_gpu", lambda: None)
    monkeypatch.setattr(storyboard_generation, "_release_gpu", lambda: None)
    monkeypatch.setattr(
        storyboard_generation,
        "_start_job_thread",
        lambda job_id: execution_queue.mark_running(job_id),
    )

    first = storyboard_generation.start_generation(story["id"], scene["id"])
    second = storyboard_generation.start_generation(story["id"], scene["id"])
    third = storyboard_generation.start_generation(story["id"], scene["id"])

    assert first["status"] == "running"
    assert second["status"] == "queued"
    assert second["queuePosition"] == 1
    assert third["status"] == "queued"
    assert third["queuePosition"] == 2

    first_payload = execution_queue.get_job(first["jobId"], include_payload=True)["payload"]
    second_payload = execution_queue.get_job(second["jobId"], include_payload=True)["payload"]
    third_payload = execution_queue.get_job(third["jobId"], include_payload=True)["payload"]
    assert len({first_payload["settings"]["seed"], second_payload["settings"]["seed"], third_payload["settings"]["seed"]}) == 3


def test_storyboard_generation_queue_exposes_pause_resume_cancel_and_reorder(storyboard_fs, monkeypatch):
    story = storyboard_store.create_story({"title": "Story"})
    story, scene = storyboard_store.add_scene(story["id"], {
        "prompt": "Prompt.",
        "durationSeconds": 6,
        "aspectRatio": "4:3 (Standard)",
        "megapixels": 0.2,
        "seedMode": "fixed",
        "seed": 1,
    })

    monkeypatch.setattr(storyboard_generation, "_reserve_gpu", lambda: (_ for _ in ()).throw(RuntimeError("busy")))
    monkeypatch.setattr(storyboard_generation, "_release_gpu", lambda: None)

    first = storyboard_generation.start_generation(story["id"], scene["id"])
    second = storyboard_generation.start_generation(story["id"], scene["id"])
    assert first["status"] == "queued"
    assert second["queuePosition"] == 2

    storyboard_generation.generation_action("reorder", second["jobId"], direction="up")
    queue = storyboard_generation.generation_queue(story["id"])
    assert [job["jobId"] for job in queue["jobs"]] == [second["jobId"], first["jobId"]]

    storyboard_generation.generation_action("cancel", first["jobId"])
    queue = storyboard_generation.generation_queue(story["id"])
    assert [job["jobId"] for job in queue["jobs"]] == [second["jobId"]]

    paused = storyboard_generation.generation_action("pause_queue")
    assert paused["paused"] is True
    resumed = storyboard_generation.generation_action("resume_queue")
    assert resumed["queue"]["paused"] is False


def test_scene_settings_resolve_story_loras_before_queueing(storyboard_fs):
    story = storyboard_store.create_story({
        "title": "Story",
        "loras": [
            {"name": "characters/alice.safetensors", "strength": 0.8},
            {"name": "styles/film.safetensors", "strength": 0.5},
        ],
    })
    story, scene = storyboard_store.add_scene(story["id"], {
        "prompt": "Prompt",
        "storyLoraOverrides": [
            {"name": "characters/alice.safetensors", "strength": 0.7},
            {"name": "styles/film.safetensors", "enabled": False},
        ],
        "loras": [{"name": "clothing/dress.safetensors", "strength": 0.6}],
    })

    settings = storyboard_generation._scene_settings(scene, story)

    assert settings["loras"] == [
        {"name": "characters/alice.safetensors", "strength": 0.7},
        {"name": "clothing/dress.safetensors", "strength": 0.6},
    ]
