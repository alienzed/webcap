"""Reviewed Prompt revisions preserve legacy summary and unrelated Scene state."""
import copy
import pytest
from tool.server import storyboard_store

@pytest.fixture
def story(tmp_path, monkeypatch):
    monkeypatch.setattr(storyboard_store.app_config, "output_root", lambda: tmp_path / "output")
    result = storyboard_store.create_story({"title": "Multiple Scenes", "concept": "Unchanged Project"})
    for label in ("A", "B", "C"):
        result, _ = storyboard_store.add_scene(result["id"], {
            "title": label, "summary": label + " legacy outline",
            "prompt": label + " prompt", "entryState": "Legacy entry", "exitState": "Legacy exit",
        })
    return result

def test_atomic_prompt_revisions_preserve_legacy_summary_and_other_scenes(story):
    ids = story["sceneOrder"]
    revisions = [
        {"sceneId": ids[0], "expected": {"prompt": "A prompt"}, "changes": {"prompt": "A revised"}},
        {"sceneId": ids[1], "expected": {"prompt": "B prompt"}, "changes": {"prompt": "B revised"}},
    ]
    changed, saved = storyboard_store.apply_studio_scene_fields_batch(story["id"], revisions)
    assert saved == {ids[0]: {"prompt": "A revised"}, ids[1]: {"prompt": "B revised"}}
    assert changed["scenes"][ids[0]]["prompt"] == "A revised"
    assert changed["scenes"][ids[1]]["prompt"] == "B revised"
    assert changed["scenes"][ids[2]] == story["scenes"][ids[2]]
    for sid in ids:
        assert changed["scenes"][sid]["summary"] == story["scenes"][sid]["summary"]
        assert changed["scenes"][sid]["entryState"] == "Legacy entry"
        assert changed["scenes"][sid]["exitState"] == "Legacy exit"
        assert changed["scenes"][sid]["takes"] == story["scenes"][sid]["takes"]
    assert changed["concept"] == story["concept"]
    assert changed["sceneOrder"] == ids

def test_conflict_does_not_partially_write(story):
    ids = story["sceneOrder"]
    before = copy.deepcopy(story)
    revisions = [
        {"sceneId": ids[0], "expected": {"prompt": "A prompt"}, "changes": {"prompt": "A revised"}},
        {"sceneId": ids[1], "expected": {"prompt": "stale"}, "changes": {"prompt": "B revised"}},
    ]
    with pytest.raises(RuntimeError, match="changed since review"):
        storyboard_store.apply_studio_scene_fields_batch(story["id"], revisions)
    assert storyboard_store.load_story(story["id"]) == before

def test_intent_only_revision_is_rejected(story):
    sid = story["sceneOrder"][0]
    entry = {"sceneId": sid, "expected": {"summary": "A legacy outline"}, "changes": {"summary": "New Intent"}}
    with pytest.raises(ValueError, match="supported"):
        storyboard_store.apply_studio_scene_fields_batch(story["id"], [entry])
    assert storyboard_store.load_story(story["id"])["scenes"][sid]["summary"] == "A legacy outline"

def test_duplicate_targets_are_rejected(story):
    sid = story["sceneOrder"][0]
    entry = {"sceneId": sid, "expected": {"prompt": "A prompt"}, "changes": {"prompt": "New"}}
    with pytest.raises(ValueError, match="only once"):
        storyboard_store.apply_studio_scene_fields_batch(story["id"], [entry, entry])
