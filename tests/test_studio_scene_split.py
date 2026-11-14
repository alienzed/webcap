"""The retired Intent-only Scene Split cannot mutate existing Projects."""
import copy

import pytest

from tool.server.app import app
from tool.server import storyboard_store


@pytest.fixture
def scene(tmp_path, monkeypatch):
    monkeypatch.setattr(storyboard_store.app_config, "output_root", lambda: tmp_path / "output")
    story = storyboard_store.create_story({"title": "Short film", "concept": "Overloaded Scene"})
    story, first = storyboard_store.add_scene(story["id"], {
        "title": "Arrival",
        "summary": "Historical Scene Intent must remain intact.",
        "prompt": "Complete saved generation prompt",
    })
    return story, first


def test_retired_intent_split_endpoint_is_unavailable_and_preserves_project(scene):
    story, first = scene
    before = copy.deepcopy(story)
    response = app.test_client().post("/fs/studio/director/scene-split", json={
        "storyId": story["id"],
        "sceneId": first["id"],
        "expectedSceneOrder": story["sceneOrder"],
        "expectedSummary": first["summary"],
        "firstSummary": "Old Intent changed",
        "secondScene": {"title": "Escape", "summary": "Second Intent"},
    })
    assert response.status_code == 404
    assert storyboard_store.load_story(story["id"]) == before


def test_retired_intent_split_model_operation_is_not_supported(scene):
    story, _first = scene
    before = copy.deepcopy(story)
    response = app.test_client().post("/fs/director/chat", json={
        "model": "unused",
        "operation": "studio_scene_split_draft",
        "messages": [{"role": "user", "content": "Split this Scene into two"}],
    })
    assert response.status_code == 400
    assert "Unsupported Director Chat operation" in response.get_json()["error"]
    assert storyboard_store.load_story(story["id"]) == before
