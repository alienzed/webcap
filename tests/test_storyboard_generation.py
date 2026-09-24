import pytest

from tool.server import execution_queue
from tool.server import inference_runner
from tool.server import storyboard_generation
from tool.server import storyboard_store


@pytest.fixture
def storyboard_fs(tmp_path, monkeypatch):
    monkeypatch.setattr(storyboard_store.app_config, "FS_ROOT", str(tmp_path))
    execution_queue._resource_owner = ""
    storyboard_generation._startup_reconciled = False
    inference_runner._startup_reconciled = True
    return tmp_path


def test_storyboard_terminal_generation_receipt_is_removed_when_consumed(storyboard_fs):
    storyboard_generation._startup_reconciled = True
    queued = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "minimax_h3"}},
        metadata={
            "client": "storyboard",
            "storyId": "story-1",
            "sceneId": "scene-1",
            "label": "Scene 1",
            "modelId": "minimax_h3",
            "mediaKind": "video",
        },
    )
    execution_queue.claim_next(inference_runner.EXECUTION_LANE)
    execution_queue.finish_job(queued["id"], status="completed", result={"takeId": "take-1"})

    delivered = storyboard_generation.generation_status(queued["id"], consume=True)

    assert delivered["status"] == "completed"
    assert delivered["takeId"] == "take-1"
    with pytest.raises(FileNotFoundError):
        execution_queue.get_job(queued["id"])


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


def test_scene_settings_resolve_story_loras_before_queueing(storyboard_fs):
    story = storyboard_store.create_story({
        "title": "Story",
        "loras": [
            {"name": "characters/alice.safetensors", "strength": 0.8},
            {"name": "styles/film.safetensors", "strength": 0.5},
            {"name": "styles/noir.safetensors", "strength": 0.9, "enabled": False},
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


def test_storyboard_request_preserves_full_reference_provenance(storyboard_fs):
    reference = {
        "role": "first_frame",
        "mediaPath": "references/first.png",
        "source": "take",
        "sourceTakeId": "take-previous",
        "frame": "last",
    }
    request = storyboard_generation._storyboard_request({
        "prompt": "Prompt",
        "sourcePrompt": "Prompt",
        "wildcardsEnabled": False,
        "aspectRatio": "4:3 (Standard)",
        "megapixels": 0.2,
        "duration": 6,
        "seed": 1,
        "seedMode": "fixed",
        "entryState": "",
        "exitState": "",
        "loras": [],
        "references": [reference],
    })

    assert request["references"] == {"first_frame": "references/first.png"}
    assert request["referenceRecords"] == [reference]


def test_storyboard_request_rejects_unsupported_guide_frame(storyboard_fs):
    settings = {
        "prompt": "Prompt",
        "sourcePrompt": "Prompt",
        "wildcardsEnabled": False,
        "aspectRatio": "4:3 (Standard)",
        "megapixels": 0.2,
        "duration": 6,
        "seed": 1,
        "seedMode": "fixed",
        "entryState": "",
        "exitState": "",
        "loras": [],
        "references": [{"role": "guide_frame", "mediaPath": "references/guide.png"}],
    }

    with pytest.raises(RuntimeError, match="Guide-frame references"):
        storyboard_generation._storyboard_request(settings)


def test_generation_capabilities_reuse_shared_h3_model(monkeypatch):
    class FakeModel:
        def load_template(self):
            return {"template": True}

        def available_lora_names(self, _available_names):
            return ["characters/alice.safetensors", "mh3/turbo.safetensors"]

        def resolve_assets(self, template, _available_names, _resolve_name):
            assert template == {"template": True}
            return {"resolved": True}

        def base_loras(self, _resolved):
            return ["mh3/turbo.safetensors"]

    monkeypatch.setattr(storyboard_generation, "get_inference_model", lambda _model_id: FakeModel())
    monkeypatch.setattr(storyboard_generation.inference_runtime, "system_stats", lambda: {})

    payload = storyboard_generation.generation_capabilities()

    assert payload == {
        "loras": ["characters/alice.safetensors"],
        "baseLoras": ["mh3/turbo.safetensors"],
    }


def test_storyboard_generation_queues_frozen_request_on_global_lane(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    story, scene = storyboard_store.add_scene(story["id"], {
        "title": "Second",
        "prompt": "Second prompt.",
        "durationSeconds": 7,
        "aspectRatio": "16:9 (Widescreen)",
        "megapixels": 0.3,
        "seedMode": "fixed",
        "seed": 22,
    })

    queued = storyboard_generation.start_generation(story["id"], scene["id"])

    assert queued["status"] == "queued"
    assert queued["queuePosition"] == 1
    stored = execution_queue.get_job(queued["jobId"], include_payload=True)
    assert stored["lane"] == inference_runner.EXECUTION_LANE
    assert stored["metadata"]["client"] == "storyboard"
    assert stored["payload"]["request"]["prompt"] == "Second prompt."
    assert stored["payload"]["request"]["settings"]["duration"] == 7.0
    assert stored["payload"]["request"]["settings"]["seed"] == 22

    storyboard_store.update_scene(story["id"], scene["id"], {"prompt": "Edited later."})
    stored_after_edit = execution_queue.get_job(queued["jobId"], include_payload=True)
    assert stored_after_edit["payload"]["request"]["prompt"] == "Second prompt."


def test_storyboard_generation_uses_global_inference_queue_positions(storyboard_fs):
    generate = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw"}},
        metadata={
            "client": "generate",
            "label": "Generate",
            "modelId": "krea2_raw",
            "mediaKind": "image",
        },
    )
    story = storyboard_store.create_story({"title": "Story"})
    story, scene = storyboard_store.add_scene(story["id"], {
        "title": "First",
        "prompt": "First prompt.",
        "durationSeconds": 6,
        "aspectRatio": "4:3 (Standard)",
        "megapixels": 0.2,
        "seedMode": "fixed",
        "seed": 1,
    })

    take = storyboard_generation.start_generation(story["id"], scene["id"])

    assert execution_queue.get_job(generate["id"])["queuePosition"] == 1
    assert take["queuePosition"] == 2
    projected = storyboard_generation.generation_queue(story["id"])
    assert [job["jobId"] for job in projected["jobs"]] == [take["jobId"]]
    assert projected["jobs"][0]["queuePosition"] == 2


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

    seeds = iter([101, 202, 303])
    monkeypatch.setattr(storyboard_generation.secrets, "randbelow", lambda _limit: next(seeds))

    jobs = [
        storyboard_generation.start_generation(story["id"], scene["id"])
        for _ in range(3)
    ]

    assert [job["queuePosition"] for job in jobs] == [1, 2, 3]
    payloads = [
        execution_queue.get_job(job["jobId"], include_payload=True)["payload"]["request"]
        for job in jobs
    ]
    assert len({payload["settings"]["seed"] for payload in payloads}) == 3


def test_storyboard_generation_exposes_only_cancel_and_stop(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    story, scene = storyboard_store.add_scene(story["id"], {
        "prompt": "Prompt.",
        "durationSeconds": 6,
        "aspectRatio": "4:3 (Standard)",
        "megapixels": 0.2,
        "seedMode": "fixed",
        "seed": 1,
    })

    active = storyboard_generation.start_generation(story["id"], scene["id"])
    queued = storyboard_generation.start_generation(story["id"], scene["id"])
    execution_queue.claim_next(inference_runner.EXECUTION_LANE)
    execution_queue.mark_running(active["jobId"])

    stopped = storyboard_generation.generation_action("stop", active["jobId"])
    assert stopped["job"]["status"] == "stopping"
    assert stopped["job"]["requestedAction"] == "stop"

    cancelled = storyboard_generation.generation_action("cancel", queued["jobId"])
    assert cancelled["job"]["status"] == "cancelled"

    with pytest.raises(ValueError, match="Unsupported Storyboard generation action"):
        storyboard_generation.generation_action("pause_queue")


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

    class FakeModel:
        def load_template(self):
            return {}

        def build_workflow(
            self,
            template,
            prompt,
            settings,
            loras,
            uploaded,
            prefix,
            available_names,
            resolve_name,
        ):
            assert prompt == "A woman enters an empty studio."
            assert settings["duration"] == 6.0
            assert prefix.startswith("webcap-storyboard/")
            return {"workflow": True}

        def find_output_ref(self, outputs):
            return outputs

    monkeypatch.setattr(storyboard_generation, "get_inference_model", lambda _model_id: FakeModel())
    monkeypatch.setattr(
        storyboard_generation.inference_runtime,
        "queue_workflow",
        lambda _workflow: "comfy-123",
    )
    monkeypatch.setattr(
        storyboard_generation.inference_runtime,
        "wait_for_output",
        lambda _prompt_id, _job_id, _finder: {
            "filename": "render.mp4",
            "subfolder": "webcap-storyboard",
            "type": "output",
        },
    )
    monkeypatch.setattr(
        storyboard_generation.inference_runtime,
        "download_output",
        lambda _ref: b"generated-video",
    )

    queued = storyboard_generation.start_generation(story["id"], scene["id"])
    execution_queue.claim_next(inference_runner.EXECUTION_LANE)
    inference_runner._execute_claimed(queued["jobId"])

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
    assert storyboard_generation.generation_status(queued["jobId"])["status"] == "completed"

def test_legacy_storyboard_queue_migration_is_restart_idempotent(storyboard_fs):
    legacy = execution_queue.enqueue(
        storyboard_generation.LEGACY_EXECUTION_LANE,
        {
            "storyId": "story-1",
            "sceneId": "scene-1",
            "settings": {
                "prompt": "Prompt",
                "sourcePrompt": "Prompt",
                "entryState": "",
                "exitState": "",
                "wildcardsEnabled": False,
                "aspectRatio": "4:3 (Standard)",
                "megapixels": 0.2,
                "duration": 6,
                "seed": 1,
                "seedMode": "fixed",
                "references": [],
                "loras": [],
            },
        },
        metadata={"storyId": "story-1", "sceneId": "scene-1"},
        job_id="legacy-storyboard-job",
    )
    inference_runner.enqueue_storyboard(
        {
            "modelId": "minimax_h3",
            "mediaKind": "video",
            "prompt": "Prompt",
            "sourcePrompt": "Prompt",
            "settings": {
                "aspectRatio": "4:3 (Standard)",
                "megapixels": 0.2,
                "duration": 6,
                "seed": 1,
            },
            "loras": [],
            "references": {},
            "referenceRecords": [],
            "wildcardsEnabled": False,
            "entryState": "",
            "exitState": "",
            "seedMode": "fixed",
        },
        "story-1",
        "scene-1",
        migrated_from_job_id=legacy["id"],
    )

    storyboard_generation.reconcile_startup()

    old = execution_queue.get_job(legacy["id"])
    assert old["status"] == "cancelled"
    current = execution_queue.lane_snapshot(inference_runner.EXECUTION_LANE)
    migrated = [
        job for job in current["jobs"]
        if (job.get("metadata") or {}).get("migratedFromJobId") == legacy["id"]
    ]
    assert len(migrated) == 1

def test_storyboard_generation_cleans_owned_comfy_reference_inputs_after_capture(storyboard_fs, monkeypatch):
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
    story, reference = storyboard_store.set_scene_reference_upload(
        story["id"], scene["id"], "first_frame", "first.png", __import__("io").BytesIO(b"image")
    )

    class FakeModel:
        def load_template(self):
            return {}

        def build_workflow(
            self,
            template,
            prompt,
            settings,
            loras,
            uploaded,
            prefix,
            available_names,
            resolve_name,
        ):
            assert uploaded["first_frame"].endswith(".png")
            return {"workflow": True}

        def find_output_ref(self, outputs):
            return outputs

    monkeypatch.setattr(storyboard_generation, "get_inference_model", lambda _model_id: FakeModel())
    monkeypatch.setattr(storyboard_generation.inference_runtime, "upload_image", lambda _path, subfolder, filename=None: subfolder + "/" + str(filename))
    monkeypatch.setattr(storyboard_generation.inference_runtime, "available_names", lambda *_args: [])
    monkeypatch.setattr(storyboard_generation.inference_runtime, "resolve_name", lambda value, *_args: value)
    monkeypatch.setattr(storyboard_generation.inference_runtime, "queue_workflow", lambda _workflow: "comfy-123")
    output_ref = {"filename": "render.mp4", "subfolder": "webcap-storyboard", "type": "output"}
    monkeypatch.setattr(storyboard_generation.inference_runtime, "wait_for_output", lambda *_args: output_ref)
    monkeypatch.setattr(storyboard_generation.inference_runtime, "download_output", lambda _ref: b"video")
    cleaned = []
    monkeypatch.setattr(
        storyboard_generation.inference_runtime,
        "cleanup_uploaded_inputs",
        lambda uploaded, output, owned_prefix="": cleaned.append((list(uploaded), output, owned_prefix)) or 1,
    )
    monkeypatch.setattr(storyboard_generation.inference_runtime, "cleanup_saved_output", lambda _ref: True)

    queued = storyboard_generation.start_generation(story["id"], scene["id"])
    execution_queue.claim_next(inference_runner.EXECUTION_LANE)
    inference_runner._execute_claimed(queued["jobId"])

    assert len(cleaned) == 1
    uploaded, captured_output, owned_prefix = cleaned[0]
    assert uploaded[0].endswith(".png")
    assert captured_output == output_ref
    assert owned_prefix == (
        "webcap-storyboard/" + story["id"] + "/" + scene["id"] + "/" +
        queued["jobId"] + "/references"
    )

def test_owned_comfy_reference_cleanup_is_scoped_to_job_prefix(tmp_path, monkeypatch):
    comfy = tmp_path / "ComfyUI"
    output = comfy / "output" / "webcap-storyboard" / "story" / "scene" / "job" / "render.mp4"
    owned = comfy / "input" / "webcap-storyboard" / "story" / "scene" / "job" / "references" / "first.png"
    other = comfy / "input" / "webcap-storyboard" / "story" / "scene" / "other" / "references" / "first.png"
    output.parent.mkdir(parents=True)
    owned.parent.mkdir(parents=True)
    other.parent.mkdir(parents=True)
    output.write_bytes(b"video")
    owned.write_bytes(b"owned")
    other.write_bytes(b"other")

    monkeypatch.setattr(
        storyboard_generation.inference_runtime,
        "local_saved_output_path",
        lambda _ref: output,
    )

    removed = storyboard_generation.inference_runtime.cleanup_uploaded_inputs(
        [
            "webcap-storyboard/story/scene/job/references/first.png",
            "webcap-storyboard/story/scene/other/references/first.png",
        ],
        {"filename": "render.mp4", "type": "output"},
        owned_prefix="webcap-storyboard/story/scene/job/references",
    )

    assert removed == 1
    assert not owned.exists()
    assert other.read_bytes() == b"other"

