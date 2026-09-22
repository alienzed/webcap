import copy

import pytest

from tool.server import storyboard_generation
from tool.server import storyboard_store


@pytest.fixture
def storyboard_fs(tmp_path, monkeypatch):
    monkeypatch.setattr(storyboard_store.app_config, "FS_ROOT", str(tmp_path))
    monkeypatch.setattr(storyboard_generation.app_config, "FS_ROOT", str(tmp_path))
    return tmp_path


def test_scene_settings_preserve_manual_prompt_and_render_controls(storyboard_fs, monkeypatch):
    monkeypatch.setattr(storyboard_generation.secrets, "randbelow", lambda _limit: 4242)
    scene = {
        "prompt": "A quiet hallway.",
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
