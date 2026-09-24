from io import BytesIO

from tool.server import app as app_module


def test_storyboard_route_is_independent_of_current_set(tmp_path, monkeypatch):
    root = tmp_path / "root"
    root.mkdir()
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", str(root))

    client = app_module.app.test_client()

    created = client.post("/fs/storyboard", json={
        "operation": "create_story",
        "story": {
            "title": "Storm Hotel",
            "concept": "Arrival in a storm.",
            "tags": ["storm", "hotel"],
            "pinned": True,
        },
    })
    assert created.status_code == 200
    story = created.get_json()["story"]
    assert story["title"] == "Storm Hotel"

    listed = client.get("/fs/storyboard")
    assert listed.status_code == 200
    assert listed.get_json()["stories"][0]["id"] == story["id"]

    loaded = client.get("/fs/storyboard", query_string={"story": story["id"]})
    assert loaded.status_code == 200
    assert loaded.get_json()["story"]["concept"] == "Arrival in a storm."

    scene_added = client.post("/fs/storyboard", json={
        "operation": "add_scene",
        "storyId": story["id"],
        "scene": {
            "title": "Arrival",
            "prompt": "A car arrives at night.",
            "durationSeconds": 8,
        },
    })
    assert scene_added.status_code == 200
    scene = scene_added.get_json()["scene"]

    uploaded = client.post("/fs/storyboard/take_upload", data={
        "storyId": story["id"],
        "sceneId": scene["id"],
        "file": (BytesIO(b"fake-image"), "take.png"),
    }, content_type="multipart/form-data")
    assert uploaded.status_code == 200
    take = uploaded.get_json()["take"]
    assert take["sourceFilename"] == "take.png"

    rated = client.post("/fs/storyboard", json={
        "operation": "rate_take",
        "storyId": story["id"],
        "sceneId": scene["id"],
        "takeId": take["id"],
        "rating": 5,
    })
    assert rated.status_code == 200
    assert rated.get_json()["take"]["rating"] == 5

    selected = client.post("/fs/storyboard", json={
        "operation": "select_take",
        "storyId": story["id"],
        "sceneId": scene["id"],
        "takeId": take["id"],
    })
    assert selected.status_code == 200
    assert selected.get_json()["story"]["scenes"][scene["id"]]["selectedTakeId"] == take["id"]

    take_removed = client.post("/fs/storyboard", json={
        "operation": "remove_take",
        "storyId": story["id"],
        "sceneId": scene["id"],
        "takeId": take["id"],
    })
    assert take_removed.status_code == 200
    assert take["id"] in take_removed.get_json()["story"]["scenes"][scene["id"]]["removedTakes"]

    take_restored = client.post("/fs/storyboard", json={
        "operation": "restore_take",
        "storyId": story["id"],
        "sceneId": scene["id"],
        "takeId": take["id"],
    })
    assert take_restored.status_code == 200

    second_added = client.post("/fs/storyboard", json={
        "operation": "add_scene",
        "storyId": story["id"],
        "scene": {"title": "Second"},
    })
    second = second_added.get_json()["scene"]
    reference = client.post("/fs/storyboard", json={
        "operation": "set_scene_reference_from_take",
        "storyId": story["id"],
        "sceneId": second["id"],
        "role": "first_frame",
        "sourceSceneId": scene["id"],
        "sourceTakeId": take["id"],
        "frame": "last",
    })
    assert reference.status_code == 200
    assert reference.get_json()["reference"]["role"] == "first_frame"
    assert reference.get_json()["reference"]["mediaPath"] == take["mediaPath"]

    removed = client.post("/fs/storyboard", json={
        "operation": "delete_scene",
        "storyId": story["id"],
        "sceneId": scene["id"],
    })
    assert removed.status_code == 200
    assert scene["id"] in removed.get_json()["story"]["removedScenes"]

    restored = client.post("/fs/storyboard", json={
        "operation": "restore_scene",
        "storyId": story["id"],
        "sceneId": scene["id"],
    })
    assert restored.status_code == 200
    assert scene["id"] in restored.get_json()["story"]["scenes"]

    story_path = root / "output" / "storyboards" / story["id"] / "story.json"
    assert story_path.is_file()


def test_storyboard_route_rejects_unknown_operation(tmp_path, monkeypatch):
    root = tmp_path / "root"
    root.mkdir()
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", str(root))
    client = app_module.app.test_client()

    response = client.post("/fs/storyboard", json={"operation": "nope"})

    assert response.status_code == 400
    assert response.get_json() == {"ok": False, "error": "Unknown Storyboard operation."}


def test_storyboard_generation_route_starts_and_reads_job(monkeypatch):
    monkeypatch.setattr(app_module, "storyboard_start_generation", lambda story_id, scene_id: {
        "jobId": "job-1",
        "storyId": story_id,
        "sceneId": scene_id,
        "status": "running",
    })
    monkeypatch.setattr(app_module, "storyboard_generation_status", lambda job_id: {
        "jobId": job_id,
        "status": "completed",
        "takeId": "take-1",
    })
    client = app_module.app.test_client()

    started = client.post("/fs/storyboard/generation", json={
        "storyId": "story-1",
        "sceneId": "scene-1",
    })
    assert started.status_code == 200
    assert started.get_json()["job"]["status"] == "running"

    status = client.get("/fs/storyboard/generation", query_string={"job": "job-1"})
    assert status.status_code == 200
    assert status.get_json()["job"]["takeId"] == "take-1"



def test_storyboard_assembly_route_exports_and_reads_current_export(monkeypatch):
    monkeypatch.setattr(app_module, "storyboard_export_selected_sequence", lambda story_id: {
        "storyId": story_id,
        "folder": "output/storyboards/" + story_id + "/exports",
        "media": "selected-sequence.mp4",
        "itemCount": 1,
        "selection": [{"sceneId": "scene-1", "takeId": "take-1"}],
        "current": True,
    })
    monkeypatch.setattr(app_module, "storyboard_current_export", lambda story_id: {
        "storyId": story_id,
        "folder": "output/storyboards/" + story_id + "/exports",
        "media": "selected-sequence.mp4",
        "itemCount": 1,
        "selection": [{"sceneId": "scene-1", "takeId": "take-1"}],
        "current": True,
    })
    client = app_module.app.test_client()

    exported = client.post("/fs/storyboard/assembly", json={"storyId": "story-1"})
    assert exported.status_code == 200
    assert exported.get_json()["export"]["media"] == "selected-sequence.mp4"

    current = client.get("/fs/storyboard/assembly", query_string={"story": "story-1"})
    assert current.status_code == 200
    assert current.get_json()["export"]["current"] is True


def test_storyboard_generation_capabilities_route(monkeypatch):
    monkeypatch.setattr(app_module, "storyboard_generation_capabilities", lambda: {
        "loras": ["characters/alice.safetensors"],
        "baseLoras": ["mh3/turbo.safetensors"],
    })
    client = app_module.app.test_client()

    response = client.get("/fs/storyboard/generation/capabilities")

    assert response.status_code == 200
    assert response.get_json()["loras"] == ["characters/alice.safetensors"]
    assert response.get_json()["baseLoras"] == ["mh3/turbo.safetensors"]


def test_storyboard_director_develop_request_queues_frozen_story_target(monkeypatch):
    story = {"id": "story-1", "concept": "A rise and fall story.", "sceneOrder": [], "scenes": {}}
    captured = {}

    monkeypatch.setattr(app_module, "storyboard_load_story", lambda story_id: story)
    monkeypatch.setattr(
        app_module,
        "storyboard_build_llm_request",
        lambda loaded, scene_id, operation, instruction="": {
            "operation": operation,
            "output": "json",
            "prompt": "develop",
            "response_schema": {},
        },
    )
    monkeypatch.setattr(
        app_module,
        "enqueue_llm",
        lambda client, model, contract, context=None, label="": captured.update({
            "client": client,
            "model": model,
            "contract": contract,
            "context": context,
            "label": label,
        }) or {
            "jobId": "job-1",
            "client": client,
            "operation": contract["operation"],
            "modelId": model,
            "storyId": context["storyId"],
            "sceneId": context["sceneId"],
            "status": "queued",
            "queuePosition": 1,
        },
    )

    response = app_module.app.test_client().post("/fs/storyboard/director", json={
        "storyId": "story-1",
        "operation": "develop_story",
        "model": "director.gguf",
    })

    assert response.status_code == 202
    assert response.get_json()["job"]["storyId"] == "story-1"
    assert captured["client"] == "storyboard"
    assert captured["context"] == {
        "storyId": "story-1",
        "sceneId": "",
        "operation": "develop_story",
        "replaceExisting": False,
    }


def test_storyboard_director_can_preview_exact_contract_without_queueing(monkeypatch):
    story = {
        "id": "story-1",
        "concept": "A quiet hotel.",
        "sceneOrder": ["scene-1"],
        "scenes": {
            "scene-1": {
                "id": "scene-1",
                "summary": "A woman enters the lobby.",
                "durationSeconds": 6,
                "references": [],
            }
        },
    }
    contract = {
        "operation": "write_prompt",
        "output": "json",
        "prompt": "[DIRECTOR CONTEXT]\nExact request.",
        "response_schema": {"type": "object"},
        "result_renderer": {"type": "h3_base", "mode": "T2VA", "duration": 6},
    }

    monkeypatch.setattr(app_module, "storyboard_load_story", lambda story_id: story)
    monkeypatch.setattr(
        app_module,
        "storyboard_build_llm_request",
        lambda loaded, scene_id, operation, instruction="": contract,
    )
    monkeypatch.setattr(
        app_module,
        "enqueue_llm",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("preview must not queue")),
    )

    response = app_module.app.test_client().post("/fs/storyboard/director", json={
        "storyId": "story-1",
        "sceneId": "scene-1",
        "operation": "write_prompt",
        "model": "director.gguf",
        "previewOnly": True,
    })

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["contract"] == contract
    assert payload["model"] == "director.gguf"


def test_storyboard_director_develop_fails_while_story_take_generation_is_pending(monkeypatch):
    story = {
        "id": "story-1",
        "concept": "Existing story.",
        "sceneOrder": ["scene-1"],
        "scenes": {"scene-1": {"id": "scene-1"}},
    }
    monkeypatch.setattr(app_module, "storyboard_load_story", lambda story_id: story)
    monkeypatch.setattr(
        app_module,
        "storyboard_generation_queue",
        lambda story_id: {"jobs": [{"jobId": "take-job"}]},
    )

    response = app_module.app.test_client().post("/fs/storyboard/director", json={
        "storyId": "story-1",
        "operation": "develop_story",
        "model": "director.gguf",
        "replaceExisting": True,
    })

    assert response.status_code == 400
    assert "pending Take generation" in response.get_json()["error"]


def test_storyboard_generation_fails_loudly_while_develop_scenes_is_pending(monkeypatch):
    monkeypatch.setattr(
        app_module,
        "llm_storyboard_target_busy",
        lambda story_id, kind, scene_id="": kind == "scenes",
    )

    response = app_module.app.test_client().post("/fs/storyboard/generation", json={
        "storyId": "story-1",
        "sceneId": "scene-1",
    })

    assert response.status_code == 400
    assert "Story Scenes have pending Director work" in response.get_json()["error"]


def test_storyboard_take_metadata_is_not_blocked_by_pending_scene_plan(monkeypatch):
    monkeypatch.setattr(
        app_module,
        "llm_storyboard_target_busy",
        lambda story_id, kind, scene_id="": kind == "scenes",
    )
    monkeypatch.setattr(
        app_module,
        "storyboard_label_take",
        lambda story_id, scene_id, take_id, label: (
            {"id": story_id},
            {"id": take_id, "label": label},
        ),
    )

    response = app_module.app.test_client().post("/fs/storyboard", json={
        "operation": "label_take",
        "storyId": "story-1",
        "sceneId": "scene-1",
        "takeId": "take-1",
        "label": "Keeper",
    })

    assert response.status_code == 200
    assert response.get_json()["take"]["label"] == "Keeper"


def test_storyboard_director_requires_confirmation_before_replacing_existing_scenes(monkeypatch):
    monkeypatch.setattr(app_module, "storyboard_load_story", lambda story_id: {
        "id": story_id,
        "concept": "Existing story.",
        "sceneOrder": ["scene-1"],
        "scenes": {"scene-1": {"id": "scene-1"}},
    })
    client = app_module.app.test_client()

    response = client.post("/fs/storyboard/director", json={
        "storyId": "story-1",
        "operation": "develop_story",
        "model": "director.gguf",
    })

    assert response.status_code == 400
    assert "Confirm replacement" in response.get_json()["error"]


def test_storyboard_route_restores_persisted_previous_prompt(tmp_path, monkeypatch):
    root = tmp_path / "root"
    root.mkdir()
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", str(root))
    client = app_module.app.test_client()

    story = client.post("/fs/storyboard", json={
        "operation": "create_story",
        "story": {"title": "Story"},
    }).get_json()["story"]
    scene = client.post("/fs/storyboard", json={
        "operation": "add_scene",
        "storyId": story["id"],
        "scene": {
            "prompt": "Director prompt.",
            "previousPrompt": "Original prompt.",
        },
    }).get_json()["scene"]

    restored = client.post("/fs/storyboard", json={
        "operation": "restore_previous_prompt",
        "storyId": story["id"],
        "sceneId": scene["id"],
    })

    assert restored.status_code == 200
    restored_scene = restored.get_json()["scene"]
    assert restored_scene["prompt"] == "Original prompt."
    assert restored_scene["previousPrompt"] == "Director prompt."


def test_storyboard_route_fails_loudly_when_manual_prompt_write_hits_pending_director(monkeypatch):
    monkeypatch.setattr(app_module, "llm_storyboard_target_busy", lambda story_id, kind, scene_id="": kind == "scene-prompt")
    client = app_module.app.test_client()

    response = client.post("/fs/storyboard", json={
        "operation": "update_scene",
        "storyId": "story-1",
        "sceneId": "scene-1",
        "scene": {"prompt": "Manual overwrite."},
    })

    assert response.status_code == 400
    assert "Scene prompt has pending Director work" in response.get_json()["error"]


def test_storyboard_route_can_permanently_delete_take(tmp_path, monkeypatch):
    root = tmp_path / "root"
    root.mkdir()
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", str(root))
    client = app_module.app.test_client()

    created = client.post("/fs/storyboard", json={
        "operation": "create_story",
        "story": {"title": "Delete Take"},
    })
    story = created.get_json()["story"]
    scene = client.post("/fs/storyboard", json={
        "operation": "add_scene",
        "storyId": story["id"],
        "scene": {"title": "Scene"},
    }).get_json()["scene"]
    take = client.post("/fs/storyboard/take_upload", data={
        "storyId": story["id"],
        "sceneId": scene["id"],
        "file": (BytesIO(b"image"), "take.png"),
    }, content_type="multipart/form-data").get_json()["take"]
    media_path = root / "output" / "storyboards" / story["id"] / take["mediaPath"]
    assert media_path.is_file()

    deleted = client.post("/fs/storyboard", json={
        "operation": "delete_take",
        "storyId": story["id"],
        "sceneId": scene["id"],
        "takeId": take["id"],
    })

    assert deleted.status_code == 200
    current = deleted.get_json()["story"]["scenes"][scene["id"]]
    assert take["id"] not in current["takes"]
    assert not media_path.exists()

def test_storyboard_route_can_upload_scene_reference(tmp_path, monkeypatch):
    root = tmp_path / "root"
    root.mkdir()
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", str(root))
    client = app_module.app.test_client()

    story = client.post("/fs/storyboard", json={
        "operation": "create_story",
        "story": {"title": "Reference Upload"},
    }).get_json()["story"]
    scene = client.post("/fs/storyboard", json={
        "operation": "add_scene",
        "storyId": story["id"],
        "scene": {"title": "Scene"},
    }).get_json()["scene"]

    response = client.post("/fs/storyboard/reference_upload", data={
        "storyId": story["id"],
        "sceneId": scene["id"],
        "role": "last_frame",
        "file": (BytesIO(b"image"), "ending.png"),
    }, content_type="multipart/form-data")

    assert response.status_code == 200
    payload = response.get_json()
    reference = payload["reference"]
    assert reference["role"] == "last_frame"
    assert reference["source"] == "upload"
    media = root / "output" / "storyboards" / story["id"] / reference["mediaPath"]
    assert media.read_bytes() == b"image"

