import json
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
        "tags": ["storm", "hotel", "Storm"],
        "pinned": True,
    })

    assert story["title"] == "Storm Hotel"
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
