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


def test_studio_can_create_unbound_project_with_optional_first_scene(isolated_storyboard):
    client = isolated_storyboard
    response = client.post("/fs/studio/director/project-create", json={
        "proposal": {
            "title": "", "concept": "A deliberately simple sight gag. Core Appeal: anticipation.",
            "style": "", "invariants": [{"kind": "character", "title": "Coach", "text": "Blue jacket"}],
            "firstScene": {"title": "", "summary": "A coach waits for the ball."},
        },
    })
    assert response.status_code == 201, response.json
    story = response.json["story"]
    assert story["title"] == ""
    assert story["targetSceneCount"] is None
    assert len(story["sceneOrder"]) == 1
    scene = story["scenes"][story["sceneOrder"][0]]
    assert scene["prompt"] == ""
    assert scene["takeOrder"] == []
    assert storyboard_store.load_story(story["id"]) == story
    folder = storyboard_store.storyboard_root() / story["id"]
    assert (folder / "takes" / scene["id"]).is_dir()


def test_studio_project_can_start_with_no_scene_and_no_title(isolated_storyboard):
    response = isolated_storyboard.post("/fs/studio/director/project-create", json={
        "proposal": {"title": "", "concept": "A weather event.", "style": "", "invariants": []},
    })
    assert response.status_code == 201
    assert response.json["story"]["sceneOrder"] == []
    assert response.json["story"]["targetSceneCount"] is None


def test_studio_project_validation_and_atomic_pre_publish_failure(isolated_storyboard, monkeypatch):
    client = isolated_storyboard
    before = {story["id"] for story in storyboard_store.list_stories()}
    for invalid in (
        {"title": "", "concept": "", "style": "", "invariants": []},
        {"concept": "Idea", "prompt": "Not allowed"},
        {"concept": "Idea", "firstScene": {"title": "", "summary": ""}},
    ):
        response = client.post("/fs/studio/director/project-create", json={"proposal": invalid})
        assert response.status_code == 400
    assert {story["id"] for story in storyboard_store.list_stories()} == before

    def failing_write(path, data):
        raise OSError("simulated disk failure")

    monkeypatch.setattr(storyboard_store, "_write_json_atomic", failing_write)
    response = client.post("/fs/studio/director/project-create", json={
        "proposal": {"concept": "A simple visual gag"}
    })
    assert response.status_code == 400
    assert "simulated disk failure" in response.json["error"]
    assert {story["id"] for story in storyboard_store.list_stories()} == before
    assert not list(storyboard_store.storyboard_root().glob(".studio-create-*"))


def test_studio_project_extraction_schema_is_bounded(monkeypatch):
    from tool.server import app as application
    captured = {}

    def fake_enqueue(client, model, contract, context, label):
        captured["contract"] = contract
        return {"jobId": "project-job", "status": "queued"}

    monkeypatch.setattr(application, "enqueue_llm", fake_enqueue)
    result = app.test_client().post("/fs/director/chat", json={
        "model": "local-test", "operation": "studio_project_draft",
        "messages": [{"role": "user", "content": "A funny idea"}],
    })
    assert result.status_code == 202
    schema = captured["contract"]["response_schema"]
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == {"title", "concept", "style", "invariants", "rationale"}
    assert schema["properties"]["invariants"]["maxItems"] == 30
    assert "firstScenes" in schema["properties"]
    assert schema["properties"]["firstScenes"]["maxItems"] == 32


def test_multi_scene_insert_at_start_between_and_end(isolated_storyboard):
    client = isolated_storyboard
    story = storyboard_store.create_story({"title": "Story", "concept": "A sequence"})
    one = storyboard_store.add_scene(story["id"], {"summary": "Existing A", "prompt": "Preserve me"})[0]
    second = storyboard_store.add_scene(story["id"], {"summary": "Existing B"})[0]
    original_order = second["sceneOrder"][:]
    def apply(current, placement, relative=""):
        return client.post("/fs/studio/director/scenes-draft", json={
            "storyId": current["id"], "expectedSceneOrder": current["sceneOrder"],
            "scenes": [{"title": "", "summary": "Proposed A"}, {"title": "B", "summary": "Proposed B"}],
            "placement": placement, "relativeSceneId": relative,
        })
    middle = apply(second, "after", original_order[0])
    assert middle.status_code == 200, middle.json
    middle_story = middle.json["story"]
    middle_ids = [scene["id"] for scene in middle.json["scenes"]]
    assert middle_story["sceneOrder"] == [original_order[0], *middle_ids, original_order[1]]
    assert middle_story["scenes"][original_order[0]]["prompt"] == "Preserve me"
    assert all(middle_story["scenes"][id]["prompt"] == "" for id in middle_ids)
    begin = apply(middle_story, "start")
    assert begin.status_code == 200
    end = apply(begin.json["story"], "end")
    assert end.status_code == 200
    assert end.json["story"]["sceneOrder"][-2:] == [s["id"] for s in end.json["scenes"]]


def test_multi_scene_conflict_is_order_only_and_single_commit(isolated_storyboard, monkeypatch):
    client = isolated_storyboard
    story = storyboard_store.create_story({"title": "Draft"})
    old_order = story["sceneOrder"][:]
    story = storyboard_store.update_story(story["id"], {"concept": "Unrelated concept change"})
    writes = []
    original_writer = storyboard_store._write_json_atomic
    def count_writes(path, data):
        writes.append(path)
        return original_writer(path, data)
    monkeypatch.setattr(storyboard_store, "_write_json_atomic", count_writes)
    request = {
        "storyId": story["id"], "expectedSceneOrder": old_order,
        "scenes": [{"title": "One", "summary": "First"}, {"title": "Two", "summary": "Second"}],
        "placement": "end", "relativeSceneId": "",
    }
    result = client.post("/fs/studio/director/scenes-draft", json=request)
    assert result.status_code == 200, result.json
    assert len(writes) == 1
    assert result.json["story"]["concept"] == "Unrelated concept change"
    conflict = client.post("/fs/studio/director/scenes-draft", json=request)
    assert conflict.status_code == 400
    assert "order changed" in conflict.json["error"]
    assert len(writes) == 1
    assert len(storyboard_store.load_story(story["id"])["sceneOrder"]) == 2


def test_multi_scene_invalid_proposals_and_atomic_failure(isolated_storyboard, monkeypatch):
    client = isolated_storyboard
    story = storyboard_store.create_story({"title": "Safety"})
    data = {
        "storyId": story["id"], "expectedSceneOrder": [],
        "scenes": [{"title": "", "summary": "A"}, {"title": "", "summary": "B"}],
        "placement": "start", "relativeSceneId": "",
    }
    for scenes in ([], [{"title": "", "summary": ""}], [{"title": "", "summary": "A", "prompt": "bad"}], data["scenes"] * 17):
        response = client.post("/fs/studio/director/scenes-draft", json={**data, "scenes": scenes})
        assert response.status_code == 400
    def broken_writer(path, data):
        raise OSError("simulated write failure")
    monkeypatch.setattr(storyboard_store, "_write_json_atomic", broken_writer)
    fail = client.post("/fs/studio/director/scenes-draft", json=data)
    assert fail.status_code == 400
    assert storyboard_store.load_story(story["id"])["sceneOrder"] == []
    assert not list((storyboard_store.storyboard_root() / story["id"] / "takes").iterdir())


def test_multi_scene_extract_schema_is_bounded(monkeypatch):
    from tool.server import app as application
    captured = {}
    def enqueue(client, model, contract, context, label):
        captured.update(contract=contract)
        return {"jobId": "sequence", "status": "queued"}
    monkeypatch.setattr(application, "enqueue_llm", enqueue)
    result = app.test_client().post("/fs/director/chat", json={
        "model": "local-test", "operation": "studio_scene_sequence_draft",
        "messages": [{"role": "user", "content": "Create three Scenes"}],
    })
    assert result.status_code == 202
    schema = captured["contract"]["response_schema"]
    assert schema["properties"]["scenes"]["maxItems"] == 32
    assert schema["properties"]["scenes"]["minItems"] == 1
    assert schema["additionalProperties"] is False


def test_studio_brief_apply_is_field_scoped_and_undoable(isolated_storyboard):
    client = isolated_storyboard
    story = storyboard_store.create_story({"title": "Brief", "concept": "Old", "style": "Original"})
    story, scene = storyboard_store.add_scene(story["id"], {"summary": "Keep", "prompt": "Untouched prompt"})
    before = {"concept": story["concept"], "style": story["style"]}
    # Unrelated Story edits do not invalidate field-scoped review.
    storyboard_store.update_story(story["id"], {"title": "Edited elsewhere"})
    response = client.post("/fs/studio/director/brief", json={
        "storyId": story["id"], "expected": before,
        "changes": {"concept": "New idea. Core Appeal: anticipation.", "style": "Warm sunlight."},
    })
    assert response.status_code == 200, response.json
    changed = response.json["story"]
    assert changed["title"] == "Edited elsewhere"
    assert changed["scenes"][scene["id"]]["prompt"] == "Untouched prompt"
    assert len(changed["studioRevisions"]) == 1
    # Normal editor saves do not destroy owner-local Undo.
    normal_save = storyboard_store.update_story(story["id"], {"title": "Later title"})
    assert len(normal_save["studioRevisions"]) == 1
    undone = client.post("/fs/studio/director/brief/undo", json={
        "storyId": story["id"], "revisionId": response.json["revisionId"],
    })
    assert undone.status_code == 200
    assert undone.json["story"]["concept"] == "Old"
    assert undone.json["story"]["style"] == "Original"
    assert undone.json["story"]["title"] == "Later title"
    assert undone.json["story"]["scenes"][scene["id"]]["prompt"] == "Untouched prompt"
    assert undone.json["story"]["studioRevisions"] == []


def test_studio_brief_conflict_does_not_clobber_later_edits(isolated_storyboard):
    client = isolated_storyboard
    story = storyboard_store.create_story({"concept": "First", "style": "Original"})
    storyboard_store.update_story(story["id"], {"style": "Changed by editor"})
    response = client.post("/fs/studio/director/brief", json={
        "storyId": story["id"], "expected": {"style": "Original"},
        "changes": {"style": "Director style"},
    })
    assert response.status_code == 400
    assert "changed since review" in response.json["error"]
    assert storyboard_store.load_story(story["id"])["style"] == "Changed by editor"


def test_studio_brief_preserves_referenced_invariants_and_undo_safety(isolated_storyboard):
    client = isolated_storyboard
    invariant = {"kind": "character", "title": "Coach", "text": "Blue jacket"}
    story = storyboard_store.create_story({"concept": "A gag", "invariants": [invariant]})
    story, scene = storyboard_store.add_scene(story["id"], {
        "summary": "First", "invariantRefs": [{"kind": "character", "title": "Coach"}]
    })
    rename = client.post("/fs/studio/director/brief", json={
        "storyId": story["id"], "expected": {"invariants": [invariant]},
        "changes": {"invariants": [{"kind": "character", "title": "Trainer", "text": "Blue jacket"}]},
    })
    assert rename.status_code == 400
    assert "referenced by Scene" in rename.json["error"]
    revised = client.post("/fs/studio/director/brief", json={
        "storyId": story["id"], "expected": {"invariants": [invariant]},
        "changes": {"invariants": [{**invariant, "text": "Blue jacket and white hat"}]},
    })
    assert revised.status_code == 200
    rev = revised.json["revisionId"]
    storyboard_store.update_story(story["id"], {"concept": "New concept"})
    undone = client.post("/fs/studio/director/brief/undo", json={
        "storyId": story["id"], "revisionId": rev
    })
    assert undone.status_code == 200
    assert undone.json["story"]["invariants"] == [invariant]
    assert undone.json["story"]["concept"] == "New concept"
    # A later edit to the affected field blocks an obsolete Undo.
    updated = client.post("/fs/studio/director/brief", json={
        "storyId": story["id"], "expected": {"style": ""},
        "changes": {"style": "Another style"},
    }).json
    storyboard_store.update_story(story["id"], {"style": "Changed again"})
    denied = client.post("/fs/studio/director/brief/undo", json={
        "storyId": story["id"], "revisionId": updated["revisionId"],
    })
    assert denied.status_code == 400
    assert storyboard_store.load_story(story["id"])["style"] == "Changed again"


def test_studio_brief_extraction_schema(monkeypatch):
    from tool.server import app as application
    result = {}
    def fake_enqueue(client, model, contract, context, label):
        result["contract"] = contract
        return {"jobId": "brief", "status": "queued"}
    monkeypatch.setattr(application, "enqueue_llm", fake_enqueue)
    response = app.test_client().post("/fs/director/chat", json={
        "model": "local-test", "operation": "studio_brief_draft",
        "messages": [{"role": "user", "content": "Refine the Concept"}],
    })
    assert response.status_code == 202
    schema = result["contract"]["response_schema"]
    assert schema["additionalProperties"] is False
    assert schema["properties"]["invariants"]["maxItems"] == 30


def test_studio_read_access_is_explicit_and_scoped(isolated_storyboard):
    client = isolated_storyboard
    story = storyboard_store.create_story({
        "title": "Example", "concept": "A visual gag", "style": "Handheld",
        "invariants": [{"kind": "character", "title": "Hero", "text": "Red coat"}],
    })
    story, scene = storyboard_store.add_scene(story["id"], {
        "title": "One", "summary": "A character waits",
        "prompt": "Generation prompt", "notes": "Keep the gag simple",
    })
    c = client.post("/fs/director/chats", json={"mode": "storyboard"})
    chat = c.json["chat"]
    base = f"/fs/studio/director/story-read?chatId={chat['id']}"
    denied = client.get(base + "&field=brief")
    assert denied.status_code == 400
    grant = client.put("/fs/director/chats/" + chat["id"], json={
        "expectedRevision": 0, "title": "Access test", "draft": "",
        "messages": [], "attachments": {},
        "storyAccess": {"storyId": story["id"], "label": "Example"},
    })
    assert grant.status_code == 200, grant.json
    brief = client.get(base + "&field=brief")
    assert brief.status_code == 200, brief.json
    assert brief.json["data"]["concept"] == "A visual gag"
    assert brief.json["data"]["style"] == "Handheld"
    assert "scenes" not in brief.json["data"]
    index = client.get(base + "&field=index")
    assert index.status_code == 200
    assert index.json["data"][0]["id"] == scene["id"]
    details = client.get(base + "&field=scene&sceneId=" + scene["id"])
    assert details.status_code == 200
    assert details.json["data"]["summary"] == "A character waits"
    assert "prompt" not in details.json["data"]
    prompt = client.get(base + "&field=prompt&sceneId=" + scene["id"])
    assert prompt.status_code == 200
    assert prompt.json["data"]["prompt"] == "Generation prompt"
    assert client.get(base + "&field=scene&sceneId=not-a-scene").status_code == 400
    assert client.get(base + "&field=everything").status_code == 400
    assert storyboard_store.load_story(story["id"])["concept"] == "A visual gag"
