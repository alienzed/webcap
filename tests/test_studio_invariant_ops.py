"""Reviewed, entity-scoped Studio Invariant editing remains safe and reversible."""

import pytest

from tool.server import storyboard_store


@pytest.fixture
def project(tmp_path, monkeypatch):
    monkeypatch.setattr(storyboard_store.app_config, "output_root", lambda: tmp_path)
    original = storyboard_store.create_story({
        "title": "Before",
        "concept": "An actor waits at a station.",
        "invariants": [
            {"kind": "character", "title": "Alice", "text": "Short black hair."},
            {"kind": "location", "title": "Station", "text": "Red brick platform."},
        ],
    })
    story, scene = storyboard_store.add_scene(original["id"], {
        "title": "Arrival",
        "summary": "Alice walks onto the platform.",
        "prompt": "A person walks onto a brick platform.",
        "invariantRefs": [{"kind": "character", "title": "Alice"}],
        "entryState": "Historically authored entry.",
        "exitState": "Historically authored exit.",
    })
    return story, scene


def test_scoped_invariants_and_project_title_update_and_undo_atomically(project):
    story, scene = project
    alice, station = story["invariants"]
    updated, revision = storyboard_store.apply_studio_brief(
        story["id"],
        {"title": story["title"]},
        {
            "title": "After",
            "invariantOps": [
                {"op": "update", "before": alice, "after": {
                    "kind": "character", "title": "Alicia", "text": "Short black hair and red scarf."
                }},
                {"op": "add", "after": {
                    "kind": "character", "title": "David", "text": "Tall with a silver jacket."
                }},
                {"op": "update", "before": station, "after": {
                    "kind": "location", "title": "Station", "text": "Red brick platform with arches."
                }},
            ],
        },
    )
    assert updated["title"] == "After"
    assert [item["title"] for item in updated["invariants"]] == ["Alicia", "Station", "David"]
    assert updated["scenes"][scene["id"]]["invariantRefs"] == [
        {"kind": "character", "title": "Alicia"}
    ]
    assert updated["scenes"][scene["id"]]["prompt"] == scene["prompt"]
    assert updated["scenes"][scene["id"]]["entryState"] == "Historically authored entry."
    assert updated["scenes"][scene["id"]]["exitState"] == "Historically authored exit."

    undone = storyboard_store.undo_studio_brief(story["id"], revision)
    assert undone["title"] == story["title"]
    assert undone["invariants"] == story["invariants"]
    assert undone["scenes"][scene["id"]]["invariantRefs"] == scene["invariantRefs"]
    assert undone["scenes"][scene["id"]]["prompt"] == scene["prompt"]


def test_unrelated_invariant_edit_does_not_block_scoped_change(project):
    story, _scene = project
    alice, station = story["invariants"]
    story = storyboard_store.update_story(story["id"], {
        "invariants": [alice, {**station, "text": "Brick platform with a clock."}]
    })
    updated, _revision = storyboard_store.apply_studio_brief(
        story["id"], {},
        {"invariantOps": [{"op": "update", "before": alice, "after": {
            **alice, "text": "Short black hair and red shoes."
        }}]},
    )
    assert updated["invariants"][0]["text"].endswith("red shoes.")
    assert updated["invariants"][1]["text"] == "Brick platform with a clock."


def test_stale_invariant_conflict_is_atomic(project):
    story, scene = project
    alice = story["invariants"][0]
    storyboard_store.update_story(story["id"], {
        "invariants": [{**alice, "text": "Changed elsewhere."}, story["invariants"][1]]
    })
    with pytest.raises(RuntimeError, match="changed since review"):
        storyboard_store.apply_studio_brief(story["id"], {}, {
            "invariantOps": [
                {"op": "add", "after": {
                    "kind": "sound", "title": "Hum", "text": "A low hum."
                }},
                {"op": "update", "before": alice, "after": {**alice, "text": "Stale edit."}},
            ]
        })
    saved = storyboard_store.load_story(story["id"])
    assert len(saved["invariants"]) == 2
    assert saved["invariants"][0]["text"] == "Changed elsewhere."
    assert saved["scenes"][scene["id"]]["invariantRefs"] == scene["invariantRefs"]


def test_cannot_delete_referenced_invariant_or_duplicate_identity(project):
    story, _scene = project
    alice = story["invariants"][0]
    with pytest.raises(RuntimeError, match="referenced by Scene"):
        storyboard_store.apply_studio_brief(story["id"], {}, {
            "invariantOps": [{"op": "remove", "before": alice}]
        })
    with pytest.raises(RuntimeError, match="already exists"):
        storyboard_store.apply_studio_brief(story["id"], {}, {
            "invariantOps": [{"op": "add", "after": {
                "kind": "character", "title": "ALICE", "text": "A duplicate."
            }}]
        })
    assert storyboard_store.load_story(story["id"])["invariants"] == story["invariants"]
