"""Deterministic reviewed Studio Scene operations preserve authored and generated state."""

import pytest

from tool.server import storyboard_store


@pytest.fixture
def scenes(tmp_path, monkeypatch):
    monkeypatch.setattr(storyboard_store.app_config, "output_root", lambda: tmp_path / "output")
    story = storyboard_store.create_story({"title": "Montage", "concept": "Three separate moments"})
    for name in ("One", "Two", "Three"):
        story, _ = storyboard_store.add_scene(story["id"], {
            "title": name, "summary": "Moment " + name, "prompt": "H3 " + name,
        })
    return story


def test_move_before_after_and_no_unrelated_field_changes(scenes):
    order = scenes["sceneOrder"]
    story, new_scene = storyboard_store.apply_studio_scene_structure(
        scenes["id"], "move", order[2], order, order[0], "before",
    )
    assert new_scene is None
    assert story["sceneOrder"] == [order[2], order[0], order[1]]
    for scene_id in order:
        assert story["scenes"][scene_id] == scenes["scenes"][scene_id]
    story2, _ = storyboard_store.apply_studio_scene_structure(
        story["id"], "move", order[2], story["sceneOrder"], order[1], "after",
    )
    assert story2["sceneOrder"] == [order[0], order[1], order[2]]


def test_move_conflicts_on_stale_order_and_invalid_targets(scenes):
    order = scenes["sceneOrder"]
    storyboard_store.apply_studio_scene_structure(
        scenes["id"], "move", order[2], order, order[0], "before",
    )
    with pytest.raises(RuntimeError, match="changed since review"):
        storyboard_store.apply_studio_scene_structure(
            scenes["id"], "move", order[1], order, order[0], "before",
        )
    saved = storyboard_store.load_story(scenes["id"])
    assert saved["sceneOrder"] == [order[2], order[0], order[1]]
    with pytest.raises(ValueError, match="different Scene"):
        storyboard_store.apply_studio_scene_structure(
            scenes["id"], "move", order[0], saved["sceneOrder"], order[0], "before",
        )
    assert storyboard_store.load_story(scenes["id"])["sceneOrder"] == saved["sceneOrder"]


def test_duplicate_preserves_original_and_does_not_copy_takes(scenes):
    order = scenes["sceneOrder"]
    original = scenes["scenes"][order[1]]
    story, copy = storyboard_store.apply_studio_scene_structure(
        scenes["id"], "duplicate", order[1], order,
        expected_source_updated_at=original["updatedAt"],
    )
    assert len(story["sceneOrder"]) == 4
    assert story["sceneOrder"][2] == copy["id"]
    assert copy["prompt"] == original["prompt"]
    assert copy["summary"] == original["summary"]
    assert copy["takes"] == {}
    assert copy["takeOrder"] == []
    assert story["scenes"][order[1]] == original
    with pytest.raises(RuntimeError, match="Scene order changed"):
        storyboard_store.apply_studio_scene_structure(
            scenes["id"], "duplicate", order[1], order,
            expected_source_updated_at=original["updatedAt"],
        )


def test_duplicate_stale_source_rejected_without_new_scene(scenes):
    order = scenes["sceneOrder"]
    original = scenes["scenes"][order[0]]
    storyboard_store.update_scene(scenes["id"], order[0], {"summary": "New direction"})
    with pytest.raises(RuntimeError, match="Source Scene changed"):
        storyboard_store.apply_studio_scene_structure(
            scenes["id"], "duplicate", order[0], order,
            expected_source_updated_at=original["updatedAt"],
        )
    assert len(storyboard_store.load_story(scenes["id"])["sceneOrder"]) == 3
