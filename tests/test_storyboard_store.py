import json
from io import BytesIO
from pathlib import Path

import pytest

from tool.server import storyboard_store


@pytest.fixture
def storyboard_fs(tmp_path, monkeypatch):
    monkeypatch.setattr(storyboard_store.app_config, "FS_ROOT", str(tmp_path))
    return tmp_path


def test_story_create_list_and_reload(storyboard_fs):
    story = storyboard_store.create_story({
        "title": "Storm Hotel",
        "concept": "Arrival during a storm.",
        "style": "Rain-soaked neo-noir horror.",
        "tags": ["storm", "hotel", "Storm"],
        "pinned": True,
    })

    assert story["title"] == "Storm Hotel"
    assert story["style"] == "Rain-soaked neo-noir horror."
    assert story["tags"] == ["storm", "hotel"]
    assert story["status"] == "active"

    path = storyboard_fs / "output" / "storyboards" / story["id"] / "story.json"
    assert path.is_file()
    assert (path.parent / "takes").is_dir()

    loaded = storyboard_store.load_story(story["id"])
    assert loaded["id"] == story["id"]
    assert storyboard_store.list_stories()[0]["title"] == "Storm Hotel"


def test_story_scene_lifecycle(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    story, first = storyboard_store.add_scene(story["id"], {
        "title": "Arrival",
        "prompt": "A car arrives.",
        "durationSeconds": 8,
        "seedMode": "fixed",
        "seed": 42,
    })
    story, second = storyboard_store.add_scene(story["id"], {"title": "Lobby"})

    assert story["sceneOrder"] == [first["id"], second["id"]]
    assert first["seed"] == 42
    assert first["durationSeconds"] == 8

    story, updated = storyboard_store.update_scene(
        story["id"],
        first["id"],
        {"prompt": "A car arrives in heavy rain.", "durationSeconds": 10},
    )
    assert updated["prompt"].endswith("heavy rain.")
    assert updated["seed"] == 42
    assert updated["durationSeconds"] == 10

    story, duplicate = storyboard_store.duplicate_scene(story["id"], first["id"])
    assert story["sceneOrder"][1] == duplicate["id"]
    assert duplicate["prompt"] == updated["prompt"]
    assert duplicate["takes"] == {}
    assert duplicate["takeOrder"] == []

    reordered = storyboard_store.reorder_scenes(
        story["id"],
        [second["id"], duplicate["id"], first["id"]],
    )
    assert reordered["sceneOrder"][0] == second["id"]

    removed = storyboard_store.delete_scene(story["id"], duplicate["id"])
    assert duplicate["id"] not in removed["scenes"]
    assert duplicate["id"] in removed["removedScenes"]
    assert "removedAt" in removed["removedScenes"][duplicate["id"]]

    restored = storyboard_store.restore_scene(story["id"], duplicate["id"])
    assert duplicate["id"] in restored["scenes"]
    assert duplicate["id"] not in restored["removedScenes"]
    assert restored["sceneOrder"][-1] == duplicate["id"]


def test_reorder_requires_every_scene_exactly_once(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    story, first = storyboard_store.add_scene(story["id"], {})
    story, second = storyboard_store.add_scene(story["id"], {})

    with pytest.raises(ValueError):
        storyboard_store.reorder_scenes(story["id"], [first["id"]])

    with pytest.raises(ValueError):
        storyboard_store.reorder_scenes(story["id"], [first["id"], first["id"]])


def test_invalid_story_id_does_not_escape_root(storyboard_fs):
    with pytest.raises(ValueError):
        storyboard_store.load_story("../outside")


def test_story_json_is_human_readable(storyboard_fs):
    story = storyboard_store.create_story({"title": "Readable"})
    path = storyboard_fs / "output" / "storyboards" / story["id"] / "story.json"
    text = path.read_text(encoding="utf-8")
    assert "\n  \"title\": \"Readable\"" in text
    assert json.loads(text)["title"] == "Readable"


def test_take_upload_freezes_scene_provenance_and_can_be_rated_and_selected(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story", "style": "1980s exercise-video horror."})
    story, scene = storyboard_store.add_scene(story["id"], {
        "title": "Studio",
        "prompt": "A woman enters an empty aerobics studio.",
        "durationSeconds": 8,
        "seedMode": "fixed",
        "seed": 123,
        "wildcardsEnabled": True,
    })

    story, take = storyboard_store.add_take_upload(
        story["id"],
        scene["id"],
        "render.mp4",
        BytesIO(b"not-a-real-video"),
    )

    take_path = storyboard_fs / "output" / "storyboards" / story["id"] / take["mediaPath"]
    assert take_path.read_bytes() == b"not-a-real-video"
    assert take["sourceFilename"] == "render.mp4"
    assert take["prompt"] == "A woman enters an empty aerobics studio."
    assert take["durationSeconds"] == 8
    assert take["seed"] == 123
    assert take["wildcardsEnabled"] is True
    assert story["scenes"][scene["id"]]["takeOrder"] == [take["id"]]

    story, rated = storyboard_store.rate_take(story["id"], scene["id"], take["id"], 4)
    assert rated["rating"] == 4
    story = storyboard_store.select_take(story["id"], scene["id"], take["id"])
    assert story["scenes"][scene["id"]]["selectedTakeId"] == take["id"]


def test_take_removal_is_reversible_without_deleting_media(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    story, scene = storyboard_store.add_scene(story["id"], {"title": "Scene"})
    story, take = storyboard_store.add_take_upload(
        story["id"], scene["id"], "still.png", BytesIO(b"png-bytes")
    )
    media_path = storyboard_fs / "output" / "storyboards" / story["id"] / take["mediaPath"]

    story = storyboard_store.select_take(story["id"], scene["id"], take["id"])
    story = storyboard_store.remove_take(story["id"], scene["id"], take["id"])
    current = story["scenes"][scene["id"]]
    assert take["id"] not in current["takes"]
    assert take["id"] in current["removedTakes"]
    assert current["selectedTakeId"] is None
    assert media_path.read_bytes() == b"png-bytes"

    story = storyboard_store.restore_take(story["id"], scene["id"], take["id"])
    current = story["scenes"][scene["id"]]
    assert take["id"] in current["takes"]
    assert take["id"] not in current["removedTakes"]
    assert current["takeOrder"] == [take["id"]]


def test_scene_reference_from_image_take_is_semantic_and_clearable(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    story, source = storyboard_store.add_scene(story["id"], {"title": "Source"})
    story, target = storyboard_store.add_scene(story["id"], {"title": "Target"})
    story, take = storyboard_store.add_take_upload(
        story["id"], source["id"], "still.png", BytesIO(b"png-bytes")
    )

    story, reference = storyboard_store.set_scene_reference_from_take(
        story["id"], target["id"], "first_frame", source["id"], take["id"], "last"
    )
    assert reference == {
        "role": "first_frame",
        "source": "take",
        "sourceSceneId": source["id"],
        "sourceTakeId": take["id"],
        "frame": "last",
        "mediaPath": take["mediaPath"],
    }
    assert story["scenes"][target["id"]]["references"] == [reference]

    story = storyboard_store.clear_scene_reference(story["id"], target["id"], "first_frame")
    assert story["scenes"][target["id"]]["references"] == []
