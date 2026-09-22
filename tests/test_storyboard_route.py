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
        "file": (BytesIO(b"fake-video"), "take.mp4"),
    }, content_type="multipart/form-data")
    assert uploaded.status_code == 200
    take = uploaded.get_json()["take"]
    assert take["sourceFilename"] == "take.mp4"

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
    assert reference.status_code == 400  # fake mp4 bytes cannot be frame-extracted

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
