"""Reviewed Scene split preserves the source's Prompt/Takes and is atomic."""

import copy

import pytest

from tool.server import storyboard_store


@pytest.fixture
def scene(tmp_path, monkeypatch):
    monkeypatch.setattr(storyboard_store.app_config, "output_root", lambda: tmp_path / "output")
    story = storyboard_store.create_story({"title": "Short film", "concept": "Overloaded Scene"})
    story, first = storyboard_store.add_scene(story["id"], {
        "title": "Arrival", "summary": "Actor enters, fights, then escapes.",
        "prompt": "Saved detailed generation prompt", "entryState": "Historical condition",
    })
    story, second = storyboard_store.add_scene(story["id"], {
        "title": "Epilogue", "summary": "A quieter moment.",
    })
    return story, first, second


def test_split_commits_two_intents_without_touching_existing_prompt_or_takes(scene):
    story, first, second = scene
    changed, created = storyboard_store.apply_studio_scene_split(
        story["id"], first["id"], story["sceneOrder"], first["summary"],
        "Actor enters and confronts a guard.",
        {"title": "Escape", "summary": "Actor escapes through the alley."},
    )
    assert changed["sceneOrder"] == [first["id"], created["id"], second["id"]]
    assert changed["scenes"][first["id"]]["summary"] == "Actor enters and confronts a guard."
    assert changed["scenes"][first["id"]]["prompt"] == first["prompt"]
    assert changed["scenes"][first["id"]]["entryState"] == first["entryState"]
    assert changed["scenes"][first["id"]]["takes"] == first["takes"]
    assert created["prompt"] == ""
    assert created["takes"] == {}
    assert created["takeOrder"] == []
    assert changed["scenes"][second["id"]] == second


def test_split_rejects_stale_order_and_source_without_partial_change(scene):
    story, first, second = scene
    before = copy.deepcopy(story)
    with pytest.raises(RuntimeError, match="Intent changed"):
        storyboard_store.apply_studio_scene_split(
            story["id"], first["id"], story["sceneOrder"], "Stale original",
            "Actor enters.", {"title": "Escape", "summary": "Actor exits."},
        )
    assert storyboard_store.load_story(story["id"]) == before
    with pytest.raises(RuntimeError, match="Scene order changed"):
        storyboard_store.apply_studio_scene_split(
            story["id"], first["id"], [second["id"], first["id"]], first["summary"],
            "Actor enters.", {"title": "Escape", "summary": "Actor exits."},
        )
    assert storyboard_store.load_story(story["id"]) == before


def test_split_rejects_empty_or_unchanged_intent(scene):
    story, first, _second = scene
    with pytest.raises(ValueError, match="reduced action"):
        storyboard_store.apply_studio_scene_split(
            story["id"], first["id"], story["sceneOrder"], first["summary"],
            first["summary"], {"title": "Escape", "summary": "Actor escapes."},
        )
    with pytest.raises(ValueError, match="second Scene"):
        storyboard_store.apply_studio_scene_split(
            story["id"], first["id"], story["sceneOrder"], first["summary"],
            "Actor enters.", {"title": "Escape", "summary": ""},
        )
    assert len(storyboard_store.load_story(story["id"])["sceneOrder"]) == 2
