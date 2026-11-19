from tool.server import app as app_module
from tool.server.storyboard_store import _write_json_atomic
from tool.server.prompt_assist import (
    build_context,
    project_deep_qa_fingerprint,
    scene_source_fingerprint,
)


MODEL = "local::director-test"


def _story():
    first = (
        "Subject:\nA courier in a dark-blue raincoat.\n\n"
        "Scene Overview:\nThe courier arrives during a storm.\n\n"
        "integrated_multimodal_description:\n"
        "[Shot 1] The courier enters an apartment lobby during a storm.\n"
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
    if scene_id == "scene-1":
        cuts = [
            {
                "shotNumber": 1,
                "visualIntent": "Establish the courier entering the lobby.",
                "focalElement": "Courier",
                "action": "Courier enters the lobby.",
                "sourceEvidence": ["[Shot 1] The courier enters an apartment lobby during a storm."],
                "stateChanges": ["Courier enters the lobby."],
                "inferences": [],
                "carryForward": ["Courier remains in the lobby."],
                "physicalInteractions": [],
                "concerns": [],
            },
            {
                "shotNumber": 2,
                "visualIntent": "Show the courier removing the wet coat.",
                "focalElement": "Raincoat and hook",
                "action": "Courier removes the coat and hangs it on the hook.",
                "sourceEvidence": ["[Shot 2] The courier removes the coat and hangs it on a hook."],
                "stateChanges": ["Raincoat is no longer being worn."],
                "inferences": [],
                "carryForward": ["Raincoat remains on the hook in subsequent cuts."],
                "physicalInteractions": ["Courier places the coat on the hook."],
                "concerns": [],
            },
        ]
    else:
        cuts = [{
            "shotNumber": 1,
            "visualIntent": "Show the handoff.",
            "focalElement": "Delivery bag",
            "action": "The colleague accepts the bag.",
            "sourceEvidence": ["[Shot 1] The colleague accepts the bag."],
            "stateChanges": ["The bag changes hands."],
            "inferences": [],
            "carryForward": ["The colleague now holds the bag."],
            "physicalInteractions": ["Courier hands the bag to the colleague."],
            "concerns": [],
        }]
    return {
        "sceneId": scene_id,
        "summary": "A courier arrives and completes the Scene action.",
        "purpose": "Establish the Scene's visual purpose.",
        "keyVisualMoments": ["Courier enters", "Courier completes the action"],
        "cuts": cuts,
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


def _receipt(story, scene_id):
    context = build_context(story, "scene", scene_id)
    return {
        "version": 1,
        "modelId": MODEL,
        "sourceFingerprint": scene_source_fingerprint(context, scene_id, MODEL),
        "preparedAt": "2026-11-19T12:00:00Z",
        "result": _scene_result(scene_id),
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
            "model": MODEL,
            "sourceFingerprint": scene_source_fingerprint(context, scene_id, MODEL),
            "result": _scene_result(scene_id),
        })
        assert response.status_code == 200
        assert response.get_json()["ok"] is True

    project_context = build_context(story, "project")
    response = client.post("/fs/storyboard/prompt-assist/deep-qa", json={
        "storyId": story["id"],
        "kind": "project",
        "model": MODEL,
        "sourceFingerprint": project_deep_qa_fingerprint(project_context, MODEL),
        "result": _project_result(),
    })
    assert response.status_code == 200

    status = client.get("/fs/storyboard/prompt-assist/deep-qa", query_string={
        "storyId": story["id"], "model": MODEL,
    })
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

    response = app_module.app.test_client().post("/fs/storyboard/prompt-assist/deep-qa", json={
        "storyId": story["id"],
        "kind": "scene",
        "sceneId": "scene-1",
        "model": MODEL,
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
    _write_json_atomic(project_dir / ".prompt_assist_deep_qa.json", {
        "version": 1,
        "scenes": {"scene-1": _receipt(story, "scene-1")},
        "project": None,
    })

    story["scenes"]["scene-1"]["prompt"] += "\n[Shot 3] The courier opens the door."
    response = app_module.app.test_client().get(
        "/fs/storyboard/prompt-assist/deep-qa",
        query_string={"storyId": story["id"], "model": MODEL},
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
        "model": MODEL,
        "operation": "deep_qa_scene",
        "expectedUpdatedAt": "rev-1",
    })
    payload = response.get_json()
    assert response.status_code == 202
    assert payload["job"]["jobId"] == "deep-qa-scene-job"
    assert payload["sourceFingerprint"] == scene_source_fingerprint(
        build_context(story, "scene", "scene-1"), "scene-1", MODEL
    )
    assert received["client"] == "chat"
    assert received["model"] == MODEL
    assert received["contract"]["operation"] == "prompt_assist_deep_qa_scene"
    assert "removes the coat" in received["contract"]["messages"][1]["content"]


def test_prompt_assist_review_includes_only_fresh_deep_qa_intelligence(tmp_path, monkeypatch):
    story = _story()
    project_dir = tmp_path / "project"
    project_dir.mkdir()
    monkeypatch.setattr(app_module, "storyboard_load_story", lambda story_id: story)
    monkeypatch.setattr("tool.server.storyboard_store._story_dir", lambda story_id: project_dir)
    _write_json_atomic(project_dir / ".prompt_assist_deep_qa.json", {
        "version": 1,
        "scenes": {"scene-1": _receipt(story, "scene-1")},
        "project": None,
    })
    received = {}

    def fake_enqueue(client, model, contract, context=None, label=""):
        received.update(client=client, model=model, contract=contract, context=context, label=label)
        return {"jobId": "prompt-review-job", "status": "queued"}

    monkeypatch.setattr(app_module, "enqueue_llm", fake_enqueue)
    response = app_module.app.test_client().post("/fs/storyboard/prompt-assist", json={
        "storyId": story["id"], "sceneId": "scene-1", "scope": "scene",
        "model": MODEL, "operation": "review", "role": "continuity",
        "expectedUpdatedAt": "rev-1",
    })
    assert response.status_code == 202
    assert "CURRENT PROJECT DEEP QA SCENE INTELLIGENCE" in received["contract"]["messages"][1]["content"]
    assert "raincoat" in received["contract"]["messages"][1]["content"]

    story["scenes"]["scene-1"]["prompt"] += "\n[Shot 3] A new detail."
    received.clear()
    response = app_module.app.test_client().post("/fs/storyboard/prompt-assist", json={
        "storyId": story["id"], "sceneId": "scene-1", "scope": "scene",
        "model": MODEL, "operation": "review", "role": "continuity",
        "expectedUpdatedAt": "rev-1",
    })
    assert response.status_code == 202
    assert "CURRENT PROJECT DEEP QA SCENE INTELLIGENCE" not in received["contract"]["messages"][1]["content"]


def test_project_deep_qa_index_uses_only_current_saved_scene_receipts(tmp_path, monkeypatch):
    story = _story()
    project_dir = tmp_path / "project"
    project_dir.mkdir()
    monkeypatch.setattr(app_module, "storyboard_load_story", lambda story_id: story)
    monkeypatch.setattr("tool.server.storyboard_store._story_dir", lambda story_id: project_dir)
    receipts = {scene_id: _receipt(story, scene_id) for scene_id in story["sceneOrder"]}
    _write_json_atomic(project_dir / ".prompt_assist_deep_qa.json", {
        "version": 1, "scenes": receipts, "project": None,
    })
    received = {}

    def fake_enqueue(client, model, contract, context=None, label=""):
        received.update(client=client, model=model, contract=contract, label=label)
        return {"jobId": "deep-qa-project-job", "status": "queued"}

    monkeypatch.setattr(app_module, "enqueue_llm", fake_enqueue)
    response = app_module.app.test_client().post("/fs/storyboard/prompt-assist", json={
        "storyId": story["id"], "scope": "project", "model": MODEL,
        "operation": "deep_qa_project", "expectedUpdatedAt": "rev-1",
    })
    assert response.status_code == 202
    assert received["client"] == "chat"
    assert received["contract"]["operation"] == "prompt_assist_deep_qa_project"
    assert "scene-1" in received["contract"]["messages"][1]["content"]
    assert "scene-2" in received["contract"]["messages"][1]["content"]



def test_prompt_assist_review_fingerprint_drops_stale_project_index(tmp_path, monkeypatch):
    story = _story()
    project_dir = tmp_path / "project"
    project_dir.mkdir()
    monkeypatch.setattr("tool.server.storyboard_store._story_dir", lambda story_id: project_dir)
    project_context = build_context(story, "project")
    _write_json_atomic(project_dir / ".prompt_assist_deep_qa.json", {
        "version": 1,
        "scenes": {"scene-1": _receipt(story, "scene-1")},
        "project": {
            "version": 1,
            "modelId": MODEL,
            "sourceFingerprint": project_deep_qa_fingerprint(project_context, MODEL),
            "preparedAt": "2026-11-19T12:05:00Z",
            "result": _project_result(),
        },
    })
    scene_context = build_context(story, "scene", "scene-1")
    before, scene_entry, project_entry = app_module._prompt_assist_review_inputs(
        story["id"], story, scene_context, "scene-1", MODEL
    )
    assert scene_entry is not None
    assert project_entry is not None

    story["scenes"]["scene-2"]["prompt"] += "\n[Shot 2] The colleague waves."
    after, scene_entry_after, project_entry_after = app_module._prompt_assist_review_inputs(
        story["id"], story, build_context(story, "scene", "scene-1"), "scene-1", MODEL
    )
    assert scene_entry_after is not None
    assert project_entry_after is None
    assert after != before



def test_prompt_assist_apply_rejects_stale_project_deep_qa_evidence(tmp_path, monkeypatch):
    story = _story()
    project_dir = tmp_path / "project"
    project_dir.mkdir()
    monkeypatch.setattr(app_module, "storyboard_load_story", lambda story_id: story)
    monkeypatch.setattr("tool.server.storyboard_store._story_dir", lambda story_id: project_dir)
    project_context = build_context(story, "project")
    _write_json_atomic(project_dir / ".prompt_assist_deep_qa.json", {
        "version": 1,
        "scenes": {"scene-1": _receipt(story, "scene-1")},
        "project": {
            "version": 1,
            "modelId": MODEL,
            "sourceFingerprint": project_deep_qa_fingerprint(project_context, MODEL),
            "preparedAt": "2026-11-19T12:05:00Z",
            "result": _project_result(),
        },
    })
    scene_context = build_context(story, "scene", "scene-1")
    expected_fingerprint, _, project_entry = app_module._prompt_assist_review_inputs(
        story["id"], story, scene_context, "scene-1", MODEL
    )
    assert project_entry is not None

    story["scenes"]["scene-2"]["prompt"] += "\n[Shot 2] The colleague waves."
    applied = {"called": False}

    def fake_apply(*args, **kwargs):
        applied["called"] = True
        raise AssertionError("Apply must not run with stale Project Deep QA evidence.")

    monkeypatch.setattr(app_module, "storyboard_apply_studio_scene_fields_batch", fake_apply)
    monkeypatch.setattr(app_module, "llm_storyboard_target_busy", lambda *args: False)
    response = app_module.app.test_client().post("/fs/storyboard/prompt-assist/apply", json={
        "storyId": story["id"],
        "scope": "scene",
        "sceneId": "scene-1",
        "model": MODEL,
        "expectedSourceFingerprint": expected_fingerprint,
        "revisions": [{
            "sceneId": "scene-1",
            "expectedPrompt": story["scenes"]["scene-1"]["prompt"],
            "prompt": story["scenes"]["scene-1"]["prompt"] + "\nAn approved addition.",
        }],
    })
    assert response.status_code == 400
    assert "Deep QA context changed" in response.get_json()["error"]
    assert applied["called"] is False
