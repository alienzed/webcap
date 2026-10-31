"""Reviewed Scene-to-Invariant associations must preserve unrelated creative state."""

import copy
import pytest

from tool.server import storyboard_store


@pytest.fixture
def project(tmp_path, monkeypatch):
    monkeypatch.setattr(storyboard_store.app_config, "output_root", lambda: tmp_path)
    story = storyboard_store.create_story({
        "title": "Continuity",
        "invariants": [
            {"kind": "character", "title": "Alice", "text": "Short black hair."},
            {"kind": "location", "title": "Station", "text": "Red brick platform."},
        ],
    })
    for title in ["Opening", "Arrival", "Finale"]:
        story, _ = storyboard_store.add_scene(story["id"], {
            "title": title, "summary": "Action in " + title,
            "prompt": "An H3 prompt for " + title,
            "entryState": "Historical state.",
        })
    return story


def test_link_existing_character_to_selected_scenes_atomically(project):
    ids = project["sceneOrder"]
    before = copy.deepcopy(project)
    changes = [{"sceneId": sid, "expectedRefs": [], "linked": True}
               for sid in (ids[0], ids[2])]
    story, saved = storyboard_store.apply_studio_scene_invariant_links(
        project["id"], "character", "Alice", changes)
    assert set(saved) == {ids[0], ids[2]}
    for scene_id in ids:
        current, original = story["scenes"][scene_id], before["scenes"][scene_id]
        expected = [{"kind": "character", "title": "Alice"}] if scene_id in saved else []
        assert current["invariantRefs"] == expected
        assert current["prompt"] == original["prompt"]
        assert current["summary"] == original["summary"]
        assert current["takes"] == original["takes"]
        assert current["entryState"] == original["entryState"]
    assert story["sceneOrder"] == before["sceneOrder"]
    assert story["invariants"] == before["invariants"]


def test_unlink_does_not_remove_other_scene_invariant(project):
    first = project["sceneOrder"][0]
    base, _scene = storyboard_store.update_scene(project["id"], first, {
        "invariantRefs": [
            {"kind": "character", "title": "Alice"},
            {"kind": "location", "title": "Station"},
        ]
    })
    original_refs = base["scenes"][first]["invariantRefs"]
    updated, saved = storyboard_store.apply_studio_scene_invariant_links(
        project["id"], "character", "Alice", [
            {"sceneId": first, "expectedRefs": original_refs, "linked": False}
        ])
    assert saved[first]["before"] == original_refs
    assert updated["scenes"][first]["invariantRefs"] == [
        {"kind": "location", "title": "Station"}
    ]


def test_stale_second_scene_keeps_first_unchanged(project):
    first, second = project["sceneOrder"][:2]
    before = copy.deepcopy(project)
    with pytest.raises(RuntimeError, match="changed since review"):
        storyboard_store.apply_studio_scene_invariant_links(
            project["id"], "character", "Alice", [
                {"sceneId": first, "expectedRefs": [], "linked": True},
                {"sceneId": second, "expectedRefs": [{"kind": "location", "title": "Station"}],
                 "linked": True},
            ])
    assert storyboard_store.load_story(project["id"]) == before


def test_missing_invariant_and_repeated_scene_fail_visibly(project):
    first = project["sceneOrder"][0]
    item = {"sceneId": first, "expectedRefs": [], "linked": True}
    with pytest.raises(RuntimeError, match="not uniquely defined"):
        storyboard_store.apply_studio_scene_invariant_links(
            project["id"], "character", "Unknown", [item])
    with pytest.raises(ValueError, match="only once"):
        storyboard_store.apply_studio_scene_invariant_links(
            project["id"], "character", "Alice", [item, item])
    assert storyboard_store.load_story(project["id"])["scenes"][first]["invariantRefs"] == []
