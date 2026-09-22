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


def test_storyboard_director_develops_story_and_applies_plan(monkeypatch):
    story = {"id": "story-1", "concept": "A rise and fall story.", "sceneOrder": [], "scenes": {}}
    plan = {
        "scenes": [
            {
                "title": "Rise",
                "summary": "He gains power.",
                "entryState": "He is unknown.",
                "exitState": "He controls the neighborhood.",
                "prompt": "prompt one",
                "suggestedDurationSeconds": 8,
                "continuity": {"continuesPreviousScene": False, "carryForward": []},
            },
            {
                "title": "Fall",
                "summary": "His empire collapses.",
                "entryState": "He controls the neighborhood.",
                "exitState": "He is alone.",
                "prompt": "prompt two",
                "suggestedDurationSeconds": 10,
                "continuity": {"continuesPreviousScene": True, "carryForward": []},
            },
        ]
    }
    applied = dict(story)
    applied["sceneOrder"] = ["scene-1", "scene-2"]

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
        "storyboard_run_llm_contract",
        lambda model, contract: {"model": model, "data": plan, "usage": None, "timings": None},
    )
    monkeypatch.setattr(
        app_module,
        "storyboard_apply_developed_plan",
        lambda story_id, received_plan, model_id="": applied
        if received_plan == plan and model_id == "director.gguf"
        else (_ for _ in ()).throw(AssertionError("wrong developed plan")),
    )

    client = app_module.app.test_client()
    response = client.post("/fs/storyboard/director", json={
        "storyId": "story-1",
        "operation": "develop_story",
        "model": "director.gguf",
    })

    assert response.status_code == 200
    assert response.get_json()["sceneCount"] == 2
    assert response.get_json()["story"]["sceneOrder"] == ["scene-1", "scene-2"]


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


def test_storyboard_director_expands_concept_with_recovery(tmp_path, monkeypatch):
    root = tmp_path / "root"
    root.mkdir()
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", str(root))
    client = app_module.app.test_client()

    created = client.post("/fs/storyboard", json={
        "operation": "create_story",
        "story": {"title": "Gangster", "concept": "Rise and fall of a New York gangster."},
    }).get_json()["story"]

    monkeypatch.setattr(
        app_module,
        "storyboard_build_llm_request",
        lambda story, scene_id, operation, instruction="": {
            "operation": operation,
            "output": "text",
            "prompt": "expand",
        },
    )
    monkeypatch.setattr(
        app_module,
        "storyboard_run_llm_contract",
        lambda model, contract: {
            "text": "A richer rise-and-fall crime story with a complete arc.",
            "model": model,
            "usage": None,
            "timings": None,
        },
    )

    expanded = client.post("/fs/storyboard/director", json={
        "storyId": created["id"],
        "operation": "expand_concept",
        "model": "director.gguf",
    })
    assert expanded.status_code == 200
    expanded_story = expanded.get_json()["story"]
    assert expanded_story["concept"].startswith("A richer")
    assert expanded_story["previousConcept"] == "Rise and fall of a New York gangster."

    restored = client.post("/fs/storyboard", json={
        "operation": "restore_previous_concept",
        "storyId": created["id"],
    })
    assert restored.status_code == 200
    assert restored.get_json()["story"]["concept"] == "Rise and fall of a New York gangster."
    assert restored.get_json()["story"]["previousConcept"] is None
