"""Reviewed multi-Scene creative edits are scoped, atomic and Take-preserving."""

import copy

import pytest

from tool.server import storyboard_store


@pytest.fixture
def story(tmp_path, monkeypatch):
    monkeypatch.setattr(storyboard_store.app_config, "output_root", lambda: tmp_path / "output")
    result = storyboard_store.create_story({"title": "Multiple Scenes", "concept": "Unchanged Project"})
    for label in ("A", "B", "C"):
        result, _ = storyboard_store.add_scene(result["id"], {
            "title": label, "summary": label + " original", "prompt": label + " prompt",
            "entryState": "Legacy entry", "exitState": "Legacy exit",
        })
    return result


def test_atomic_two_scene_revision_preserves_unselected_scene_and_prompts(story):
    ids = story["sceneOrder"]
    revisions = [
        {"sceneId": ids[0], "expected": {"summary": "A original"}, "changes": {"summary": "A revised"}},
        {"sceneId": ids[1], "expected": {"summary": "B original"}, "changes": {"summary": "B revised"}},
    ]
    changed, saved = storyboard_store.apply_studio_scene_fields_batch(story["id"], revisions)
    assert saved == {ids[0]: {"summary": "A revised"}, ids[1]: {"summary": "B revised"}}
    assert changed["scenes"][ids[0]]["summary"] == "A revised"
    assert changed["scenes"][ids[1]]["summary"] == "B revised"
    assert changed["scenes"][ids[2]] == story["scenes"][ids[2]]
    for scene_id in ids:
        assert changed["scenes"][scene_id]["prompt"] == story["scenes"][scene_id]["prompt"]
        assert changed["scenes"][scene_id]["entryState"] == "Legacy entry"
        assert changed["scenes"][scene_id]["exitState"] == "Legacy exit"
        assert changed["scenes"][scene_id]["takes"] == story["scenes"][scene_id]["takes"]
    assert changed["concept"] == story["concept"]
    assert changed["sceneOrder"] == ids


def test_stale_or_invalid_second_scene_does_not_modify_first(story):
    ids = story["sceneOrder"]
    before = copy.deepcopy(story)
    revisions = [
        {"sceneId": ids[0], "expected": {"summary": "A original"}, "changes": {"summary": "A revised"}},
        {"sceneId": ids[1], "expected": {"summary": "stale"}, "changes": {"summary": "B revised"}},
    ]
    with pytest.raises(RuntimeError, match="changed since review"):
        storyboard_store.apply_studio_scene_fields_batch(story["id"], revisions)
    assert storyboard_store.load_story(story["id"]) == before


def test_reject_duplicate_scene_targets_and_unsupported_fields(story):
    scene_id = story["sceneOrder"][0]
    entry = {"sceneId":scene_id,"expected":{"summary":"A original"},"changes":{"summary":"A new"}}
    with pytest.raises(ValueError, match="only once"):
        storyboard_store.apply_studio_scene_fields_batch(story["id"], [entry, entry])
    with pytest.raises(ValueError, match="supported"):
        storyboard_store.apply_studio_scene_fields_batch(story["id"], [{
            "sceneId":scene_id,"expected":{"entryState":"Legacy entry"},"changes":{"entryState":"Legacy"},
        }])
    assert storyboard_store.load_story(story["id"])["scenes"][scene_id]["summary"] == "A original"
