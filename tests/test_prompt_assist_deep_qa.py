import json
from pathlib import Path

from tool.server import app as app_module
from tool.server.storyboard_store import _write_json_atomic
from tool.server.prompt_assist import build_context, scene_source_fingerprint, source_fingerprint
from tool.server.storyboard_store import _write_json_atomic


def _story():
    first = (
        "Subject:\nA courier in a dark-blue raincoat.\n\n"
        "Scene Overview:\nThe courier arrives during a storm.\n\n"
        "integrated_multimodal_description:\n"
        "[Shot 1] The courier enters with a wet coat.\n"
        "[Shot 2] The courier removes the coat and hangs it on a hook.\n"
    )
    second = (
        "Subject:\nThe courier meets a colleague.\n\n"
        "Scene Overview:\nThe colleague receives a delivery bag.\n\n"
        "integrated_multimodal_description:\n"
        "[Shot 1] The colleague accepts the bag.\n"
    )
    return {
        "id": "project-deep-qa",
        "title": "Courier",
        "concept": "A courier arrives after a storm.",
        "style": "Grounded realism.",
        "invariants": [{"kind": "character", "title": "Courier", "text": "Carries a canvas delivery bag."}],
        "updatedAt": "rev-1",
        "sceneOrder": ["scene-1", "scene-2"],
        "scenes": {
            "scene-1": {"title": "Arrival", "durationSeconds": 8, "prompt": first},
            "scene-2": {"title": "Meeting", "durationSeconds": 6, "prompt": second},
        },
    }


def _scene_result(scene_id):
    shot_numbers = [1, 2] if scene_id == "scene-1" else [1]
    return {
        "sceneId": scene_id,
        "summary": "A courier arrives and completes the Scene action.",
        "purpose": "Establish the Scene's visual purpose.",
        "keyVisualMoments": ["Courier enters", "Courier completes the action"],
        "cuts": [{
            "shotNumber": number,
            "visualIntent": "Establish the action.",
            "focalElement": "Courier",
            "action": "Courier enters." if number == 1 else "Courier removes the coat.",
            "stateChanges": ["Courier enters the lobby."],
            "carryForward": ["Courier remains in the lobby."],
            "physicalInteractions": [],
            "concerns": [],
        } for number in shot_numbers],
    }


def _project_result():
    return {
        "summary": "The Project follows a courier through arrival and a later handoff.",
        "recurringElements": [{
            "element": "Courier and delivery bag",
            "scenes": ["scene-1", "scene-2"],
            "basis": "Both Scene prompts explicitly describe the courier and bag.",
        }],
        "sceneRelationships": [{
            "fromSceneId": "scene-1",
            "toSceneId": "scene-2",
            "relationship": "The second Scene follows the arrival.",
            "basis": "The ordered Scene descriptions establish arrival followed by a meeting.",
        }],
        "projectContinuityPrinciples": ["Do not assume independently rendered Scenes preserve exact clothing or appearance."],
        "concerns": [],
    }


def test_project_deep_qa_persists_scene_receipts_and_marks_project_index_fresh(tmp_path, monkeypatch):
    story = _story()
    project_dir = tmp_path / "project"
    project_dir.mkdir()
    monkeypatch.setattr(app_module, "storyboard_load_story", lambda story_id: story)
    monkeypatch.setattr("tool.server.storyboard_store._story_dir", lambda story_id: project_dir)

    client = app_module.app.test_client()
    for scene_id in story["sceneOrder"]:
        context = build_context(story, "scene", scene_id)
        response = client.post("/fs/storyboard/prompt-assist/deep-qa", json={
            "storyId": story["id"],
            "kind": "scene",
            "sceneId": scene_id,
            "sourceFingerprint": scene_source_fingerprint(context, scene_id),
            "result": _scene_result(scene_id),
        })
        assert response.status_code == 200
        assert response.get_json()["ok"] is True

    project_context = build_context(story, "project")
    response = client.post("/fs/storyboard/prompt-assist/deep-qa", json={
        "storyId": story["id"],
        "kind": "project",
        "sourceFingerprint": source_fingerprint(project_context),
        "result": _project_result(),
    })
    assert response.status_code == 200

    status = client.get("/fs/storyboard/prompt-assist/deep-qa", query_string={"storyId": story["id"]})
    payload = status.get_json()
    assert status.status_code == 200
    assert payload["preparedScenes"] == 2
    assert payload["totalScenes"] == 2
    assert payload["projectFresh"] is True
    assert payload["project"]["summary"].startswith("The Project follows")


def test_project_deep_qa_rejects_stale_scene_receipt(tmp_path, monkeypatch):
    story = _story()
    project_dir = tmp_path / "project"
    project_dir.mkdir()
    monkeypatch.setattr(app_module, "storyboard_load_story", lambda story_id: story)
    monkeypatch.setattr("tool.server.storyboard_store._story_dir", lambda story_id: project_dir)

    context = build_context(story, "scene", "scene-1")
    response = app_module.app.test_client().post("/fs/storyboard/prompt-assist/deep-qa", json={
        "storyId": story["id"],
        "kind": "scene",
        "sceneId": "scene-1",
        "sourceFingerprint": "stale-fingerprint",
        "result": _scene_result("scene-1"),
    })
    assert response.status_code == 400
    assert "Scene changed" in response.get_json()["error"]


def test_project_deep_qa_status_marks_changed_scene_stale(tmp_path, monkeypatch):
    story = _story()
    project_dir = tmp_path / "project"
    project_dir.mkdir()
    monkeypatch.setattr(app_module, "storyboard_load_story", lambda story_id: story)
    monkeypatch.setattr("tool.server.storyboard_store._story_dir", lambda story_id: project_dir)
    context = build_context(story, "scene", "scene-1")
    fingerprint = scene_source_fingerprint(context, "scene-1")
    _write_json_atomic(project_dir / ".prompt_assist_deep_qa.json", {
        "version": 1,
        "scenes": {
            "scene-1": {
                "sourceFingerprint": fingerprint,
                "preparedAt": "2026-11-19T12:00:00Z",
                "result": _scene_result("scene-1"),
            }
        },
        "project": None,
    })

    story["scenes"]["scene-1"]["prompt"] += "\n[Shot 3] The courier opens the door."
    response = app_module.app.test_client().get(
        "/fs/storyboard/prompt-assist/deep-qa", query_string={"storyId": story["id"]}
    )
    payload = response.get_json()
    assert response.status_code == 200
    assert payload["sceneStatus"]["scene-1"]["fresh"] is False
    assert payload["preparedScenes"] == 0
    assert payload["projectFresh"] is False



def test_prompt_assist_deep_qa_scene_uses_existing_director_chat_queue(monkeypatch):
    story = _story()
    monkeypatch.setattr(app_module, "storyboard_load_story", lambda story_id: story)
    received = {}

    def fake_enqueue(client, model, contract, context=None, label=""):
        received.update(client=client, model=model, contract=contract, context=context, label=label)
        return {"jobId": "deep-qa-scene-job", "status": "queued"}

    monkeypatch.setattr(app_module, "enqueue_llm", fake_enqueue)
    response = app_module.app.test_client().post("/fs/storyboard/prompt-assist", json={
        "storyId": story["id"],
        "sceneId": "scene-1",
        "scope": "scene",
        "model": "local::director-test",
        "operation": "deep_qa_scene",
        "expectedUpdatedAt": "rev-1",
    })
    payload = response.get_json()
    assert response.status_code == 202
    assert payload["job"]["jobId"] == "deep-qa-scene-job"
    assert payload["sourceFingerprint"]
    assert received["client"] == "chat"
    assert received["model"] == "local::director-test"
    assert received["contract"]["operation"] == "prompt_assist_deep_qa_scene"
    assert "removes the coat" in received["contract"]["messages"][1]["content"]


def test_prompt_assist_review_includes_only_fresh_deep_qa_intelligence(tmp_path, monkeypatch):
    from tool.server.prompt_assist import scene_source_fingerprint

    story = _story()
    project_dir = tmp_path / "project"
    project_dir.mkdir()
    monkeypatch.setattr(app_module, "storyboard_load_story", lambda story_id: story)
    monkeypatch.setattr("tool.server.storyboard_store._story_dir", lambda story_id: project_dir)
    context = build_context(story, "scene", "scene-1")
    scene_result = _scene_result("scene-1")
    _write_json_atomic(project_dir / ".prompt_assist_deep_qa.json", {
        "version": 1,
        "scenes": {
            "scene-1": {
                "sourceFingerprint": scene_source_fingerprint(context, "scene-1"),
                "preparedAt": "2026-11-19T12:00:00Z",
                "result": scene_result,
            }
        },
        "project": None,
    })
    received = {}

    def fake_enqueue(client, model, contract, context=None, label=""):
        received.update(client=client, model=model, contract=contract, context=context, label=label)
        return {"jobId": "prompt-review-job", "status": "queued"}

    monkeypatch.setattr(app_module, "enqueue_llm", fake_enqueue)
    response = app_module.app.test_client().post("/fs/storyboard/prompt-assist", json={
        "storyId": story["id"], "sceneId": "scene-1", "scope": "scene",
        "model": "local::director-test", "operation": "review", "role": "continuity",
        "expectedUpdatedAt": "rev-1",
    })
    assert response.status_code == 202
    assert "CURRENT PROJECT DEEP QA SCENE INTELLIGENCE" in received["contract"]["messages"][1]["content"]
    assert "raincoat" in received["contract"]["messages"][1]["content"]

    story["scenes"]["scene-1"]["prompt"] += "\n[Shot 3] A new detail."
    received.clear()
    response = app_module.app.test_client().post("/fs/storyboard/prompt-assist", json={
        "storyId": story["id"], "sceneId": "scene-1", "scope": "scene",
        "model": "local::director-test", "operation": "review", "role": "continuity",
        "expectedUpdatedAt": "rev-1",
    })
    assert response.status_code == 202
    assert "CURRENT PROJECT DEEP QA SCENE INTELLIGENCE" not in received["contract"]["messages"][1]["content"]



def test_project_deep_qa_index_uses_only_current_saved_scene_receipts(tmp_path, monkeypatch):
    from tool.server.prompt_assist import build_context, scene_source_fingerprint

    story = _story()
    project_dir = tmp_path / "project"
    project_dir.mkdir()
    monkeypatch.setattr(app_module, "storyboard_load_story", lambda story_id: story)
    monkeypatch.setattr("tool.server.storyboard_store._story_dir", lambda story_id: project_dir)
    receipts = {}
    for scene_id in story["sceneOrder"]:
        context = build_context(story, "scene", scene_id)
        receipts[scene_id] = {
            "sourceFingerprint": scene_source_fingerprint(context, scene_id),
            "preparedAt": "2026-11-19T12:00:00Z",
            "result": _scene_result(scene_id),
        }
    _write_json_atomic(project_dir / ".prompt_assist_deep_qa.json", {
        "version": 1, "scenes": receipts, "project": None,
    })
    received = {}

    def fake_enqueue(client, model, contract, context=None, label=""):
        received.update(client=client, model=model, contract=contract, label=label)
        return {"jobId": "deep-qa-project-job", "status": "queued"}

    monkeypatch.setattr(app_module, "enqueue_llm", fake_enqueue)
    response = app_module.app.test_client().post("/fs/storyboard/prompt-assist", json={
        "storyId": story["id"], "scope": "project", "model": "local::director-test",
        "operation": "deep_qa_project", "expectedUpdatedAt": "rev-1",
    })
    assert response.status_code == 202
    assert received["client"] == "chat"
    assert received["contract"]["operation"] == "prompt_assist_deep_qa_project"
    assert "scene-1" in received["contract"]["messages"][1]["content"]
    assert "scene-2" in received["contract"]["messages"][1]["content"]
