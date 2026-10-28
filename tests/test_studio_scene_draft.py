"""Studio Scene draft extraction is bounded, reviewed and atomic on Apply."""

import pytest

from tool.server import config as app_config
from tool.server import storyboard_store
from tool.server.app import app


@pytest.fixture
def isolated_storyboard(tmp_path, monkeypatch):
    monkeypatch.setattr(app_config, "output_root", lambda: tmp_path)
    return app.test_client()


def _scene(client, story, summary, placement="end", relative=""):
    return client.post("/fs/studio/director/scene-draft", json={
        "storyId": story["id"],
        "expectedUpdatedAt": story["updatedAt"],
        "scene": {"title": "", "summary": summary},
        "placement": placement,
        "relativeSceneId": relative,
    })


def test_create_tentative_scene_without_prompt_or_ghosts(isolated_storyboard):
    client = isolated_storyboard
    project = storyboard_store.create_story({"title": "A simple gag"})
    assert project["sceneOrder"] == []
    response = _scene(client, project, "One character waits for a football to arrive.", "start")
    assert response.status_code == 200
    created = response.json["scene"]
    updated = response.json["story"]
    assert updated["sceneOrder"] == [created["id"]]
    assert created["title"] == ""
    assert created["summary"].startswith("One character")
    assert created["prompt"] == ""
    assert created["takes"] == {}
    assert storyboard_store.load_story(project["id"])["sceneOrder"] == [created["id"]]


def test_insert_before_and_after_using_stable_scene_ids(isolated_storyboard):
    client = isolated_storyboard
    project = storyboard_store.create_story({"title": "Placement"})
    a = _scene(client, project, "A") .json
    project = a["story"]
    b = _scene(client, project, "B").json
    project = b["story"]
    inserted = _scene(client, project, "Between", "after", a["scene"]["id"]).json
    assert inserted["story"]["sceneOrder"] == [
        a["scene"]["id"], inserted["scene"]["id"], b["scene"]["id"]
    ]
    before = _scene(client, inserted["story"], "First", "before", a["scene"]["id"]).json
    assert before["story"]["sceneOrder"][0] == before["scene"]["id"]


def test_reject_stale_apply_without_partial_write(isolated_storyboard):
    client = isolated_storyboard
    project = storyboard_store.create_story({"title": "Revision"})
    first = _scene(client, project, "A")
    assert first.status_code == 200
    stale = _scene(client, project, "B")
    assert stale.status_code == 400
    assert "changed during Scene review" in stale.json["error"]
    assert len(storyboard_store.load_story(project["id"])["sceneOrder"]) == 1


def test_reject_missing_placement_or_unexpected_fields(isolated_storyboard):
    client = isolated_storyboard
    project = storyboard_store.create_story({"title": "Validate"})
    invalid = _scene(client, project, "A", "after", "scene-nonexistent")
    assert invalid.status_code == 400
    assert storyboard_store.load_story(project["id"])["sceneOrder"] == []
    unexpected = client.post("/fs/studio/director/scene-draft", json={
        "storyId": project["id"],
        "expectedUpdatedAt": project["updatedAt"],
        "scene": {"title": "", "summary": "A", "prompt": "Sneaked in"},
        "placement": "end",
    })
    assert unexpected.status_code == 400
    assert storyboard_store.load_story(project["id"])["sceneOrder"] == []


def test_structured_scene_draft_request_has_one_scene_only(monkeypatch):
    from tool.server import app as application

    captured = {}

    def fake_enqueue(client, model, contract, context, label):
        captured.update(contract=contract, client=client, label=label)
        return {"jobId": "queued-test", "status": "queued"}

    monkeypatch.setattr(application, "enqueue_llm", fake_enqueue)
    result = app.test_client().post("/fs/director/chat", json={
        "model": "llm", "operation": "studio_scene_draft",
        "messages": [{"role": "user", "content": "A football gag"}],
    })
    assert result.status_code == 202
    schema = captured["contract"]["response_schema"]
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == {"title", "summary", "rationale"}
    assert "scenes" not in schema["properties"]
