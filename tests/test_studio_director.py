"""Studio Director implicit knowledge and bootstrap API contracts."""

import pytest

from tool.server import config as app_config
from tool.server.studio_director import guidance, ACTIONS


def test_writer_workshop_keeps_creative_identity_separate_from_h3_playbook(monkeypatch):
    monkeypatch.setattr(
        app_config,
        "config",
        {"generation_model_guidance": {"minimax_h3": "Keep risky hand-to-hand interactions simple."}},
    )
    result = guidance("minimax_h3")
    system, reference = result["system"], result["promptContract"]
    assert "STUDIO DIRECTOR | CREATIVE PARTNER" in system
    assert "imaginative, capable creative director" in system
    assert "CREATIVE WORK: When asked to create or revise material" in system
    assert "If an essential creative decision is missing" in system
    assert "providing any independently useful work" in system
    assert "Concept (story.concept)" in system
    assert "Invariants (story.invariants)" in system
    assert "complete H3 Prompt (scene.prompt)" in system
    assert "4–15 seconds" in system
    assert "integrated_multimodal_description" in reference
    assert "Keep risky hand-to-hand interactions simple." in reference
    assert "Keep risky hand-to-hand interactions simple." not in system
    assert "[Shot 1]" not in system
    assert len(system) < 4000

def test_studio_guidance_teaches_only_focused_creative_workflows():
    result = guidance("minimax_h3")
    actions = {entry["name"]: entry["description"] for entry in result["actions"]}
    assert set(actions) == {"context.read", "project.write", "scenes.write"}
    assert "explicitly approved" in actions["context.read"]
    assert "preserving unrelated" in actions["project.write"]
    assert "Invariants" in actions["project.write"]
    assert "one or more Scenes" in actions["scenes.write"]
    assert "Respond naturally and concisely" in result["system"]
    assert "make a recommendation when you can" in result["system"]
    assert "CURRENT WEBCAP CAPABILITIES" not in result["system"]
    assert len(result["system"]) < 4000

def test_director_role_is_creative_partner_not_webcap_workflow_engine():
    system = guidance("minimax_h3")["system"]
    assert "elevate the author's" in system
    assert "meaningful ideas" in system
    assert "sound creative judgment" in system
    assert "producible results" in system
    assert "The author sets the direction" in system
    assert "deliver the actual usable" in system
    assert "Preserve established details outside the requested change" in system
    assert "only WebCap saves Project and Scene records" in system
    assert "WebCap Studio workflow guide" not in system
    assert "review policy" not in system
    assert "direct-save" not in system
    assert "queue" not in system.lower()

def test_action_catalog_excludes_low_value_studio_director_operations():
    by_name = {action["name"]: action for action in ACTIONS}
    assert set(by_name) == {"context.read", "project.write", "scenes.write"}
    assert all(action["status"] == "available" for action in ACTIONS)
    for retired in ("scene.move", "scene.duplicate", "scene.split", "scene.invariants",
                    "playbook.propose", "scene.sequence.draft", "scene.batch.revise"):
        assert retired not in by_name


def test_project_coherence_remains_explicit_but_not_advertised_as_creative_action():
    from tool.server.studio_director import chat_response_schema
    assert "project.coherence.check" not in {action["name"] for action in ACTIONS}
    assert "action" not in chat_response_schema()["properties"], (
        "Model output supplies material, not a suggested WebCap action"
    )


def test_studio_guidance_api_is_read_only():
    from tool.server.app import app
    response = app.test_client().get("/fs/studio/director/guidance")
    assert response.status_code == 200
    assert response.json["ok"] is True
    assert response.json["targetModel"] == "minimax_h3"
    assert response.json["actions"][0]["name"] == "context.read"


def test_unsupported_generation_model_fails_instead_of_misapplying_h3_guidance():
    from tool.server.app import app
    response = app.test_client().get("/fs/studio/director/guidance?targetModel=unknown")
    assert response.status_code == 400
    assert "currently supports MiniMax H3" in response.json["error"]


def test_unconfigured_h3_studio_still_has_production_expertise(monkeypatch):
    monkeypatch.setattr(app_config, "config", {"generation_model_guidance": {}})
    result = guidance("minimax_h3")
    system, reference = result["system"], result["promptContract"]
    assert "short generative-video Projects and Scenes" in system
    assert "4–15 seconds" in system
    assert "complete standalone H3 Prompt" in system
    assert "USER'S H3 PRODUCTION PLAYBOOK" not in system
    assert "USER'S H3 PRODUCTION PLAYBOOK" not in reference
    assert "[Shot 1]" not in system
    assert "[Shot 1]" in reference

def test_h3_runtime_reference_uses_current_studio_fields_and_conditional_legacy_guidelines():
    prompt = guidance("minimax_h3")["promptContract"]
    assert "Use supplied Project Concept, Visual / atmosphere, relevant Invariants, and the saved Scene Prompt" in prompt
    assert "legacy Story Guidelines only when explicitly supplied" in prompt
    assert "integrated_multimodal_description:" in prompt


def test_freeform_workshop_does_not_claim_hidden_context_or_mutations():
    system = guidance("minimax_h3")["system"]
    assert "saved Project and Scene facts actually supplied" in system
    assert "treat earlier unsaved ideas as proposals" in system
    assert "only WebCap saves Project and Scene records" in system
    assert "elevate the author's" in system
    assert "a promise to work later" in system
    assert "CURRENT PROJECT NAVIGATION" not in system
    assert "WebCap resolved Project" not in system

def test_studio_guidance_describes_actual_project_and_scene_fields():
    system = guidance("minimax_h3")["system"]
    for phrase in (
        "story.concept", "story.style", "story.invariants",
        "scene.prompt", "durationSeconds",
    ):
        assert phrase.casefold() in system.casefold()
    assert "complete standalone H3 Prompt" in system
    assert "unaffected titles, durations" in system
    assert "Invariants when stable recurring facts matter" in system
    assert "Legacy Directing Guidelines" not in system

def test_h3_playbook_review_uses_existing_config_and_checks_conflicts(monkeypatch):
    import copy
    from tool.server.app import app
    saved = {"generation_model_guidance": {"minimax_h3": "Original guidance."}}
    writes = []

    monkeypatch.setattr(app_config, "load_config_from_disk", lambda: copy.deepcopy(saved))

    def save(value):
        saved.clear()
        saved.update(copy.deepcopy(value))
        writes.append(copy.deepcopy(value))
        return value

    monkeypatch.setattr(app_config, "save_config_to_disk", save)
    monkeypatch.setattr(app_config, "reload_runtime_config", lambda: None)
    client = app.test_client()
    before = client.get("/fs/studio/director/playbook")
    assert before.status_code == 200
    assert before.json["guidance"] == "Original guidance."

    update = client.post("/fs/studio/director/playbook", json={
        "expected": "Original guidance.", "guidance": "Keep actions physically clear."
    })
    assert update.status_code == 200
    assert saved["generation_model_guidance"]["minimax_h3"] == "Keep actions physically clear."
    assert len(writes) == 1

    conflict = client.post("/fs/studio/director/playbook", json={
        "expected": "Original guidance.", "guidance": "Overwrite concurrent changes."
    })
    assert conflict.status_code == 400
    assert "changed since review" in conflict.json["error"]
    assert len(writes) == 1


@pytest.mark.parametrize("operation", [
    "studio_scene_draft", "studio_scene_sequence_draft",
    "studio_scene_batch_draft", "studio_playbook_draft",
])
def test_retired_director_model_operations_are_not_queued(monkeypatch, operation):
    from tool.server import app as server
    def fail_enqueue(*args, **kwargs):
        raise AssertionError("A retired Studio operation must not launch a model call")
    monkeypatch.setattr(server, "enqueue_llm", fail_enqueue)
    response = server.app.test_client().post("/fs/director/chat", json={
        "model": "test", "operation": operation,
        "messages": [{"role": "user", "content": "Create a Scene"}],
    })
    assert response.status_code == 400
    assert "Unsupported Director Chat operation" in response.get_json()["error"]


@pytest.mark.parametrize("operation, expected_fields", [
    ("studio_brief_draft", {"title", "concept", "style", "invariants", "rationale"}),
    ("studio_project_draft", {"title", "concept", "style", "invariants", "initialScenes", "rationale"}),
    ("studio_scene_field_draft", {"title", "prompt", "durationSeconds"}),
    ("studio_scenes_draft", {"scenes", "rationale"}),
    ("storyboard_workshop_shots", {"summary", "shots"}),
    ("freeform_chat", None),
    ("studio_chat", {"reply", "changes", "scenes"}),
])
def test_director_chat_route_preserves_all_structured_schemas(monkeypatch, operation, expected_fields):
    import importlib

    server = importlib.import_module("tool.server.app")
    captured = {}

    def enqueue(client, model, contract, context, label):
        captured.update({"client": client, "operation": contract["operation"],
                         "schema": contract.get("response_schema")})
        return {"jobId": "test-director"}

    monkeypatch.setattr(server, "enqueue_llm", enqueue)
    response = server.app.test_client().post("/fs/director/chat", json={
        "model": "qwen", "operation": operation,
        "messages": [{"role": "user", "content": "Propose the requested draft."}],
    })
    assert response.status_code == 202
    assert captured["client"] == "chat"
    assert captured["operation"] == operation
    if expected_fields is None:
        assert captured["schema"] is None
    else:
        assert captured["schema"]["type"] == "object"
        assert set(captured["schema"]["properties"]) == expected_fields
        assert captured["schema"]["additionalProperties"] is False
        if operation == "studio_scene_field_draft":
            assert captured["schema"]["required"] == ["prompt"]
            assert captured["schema"]["properties"]["prompt"]["minLength"] == 1
            assert "title" not in captured["schema"]["required"]
            assert "durationSeconds" not in captured["schema"]["required"]
        if operation == "studio_scenes_draft":
            assert captured["schema"]["required"] == ["scenes"]
            assert "prompt" not in captured["schema"]["properties"]
            assert captured["schema"]["properties"]["scenes"]["items"]["properties"]["prompt"]["type"] == "string"
        if operation in {"studio_chat", "studio_scenes_draft"}:
            record = captured["schema"]["properties"]["scenes"]["items"]
            assert record["required"] == ["title", "prompt", "durationSeconds"]
            assert record["properties"]["prompt"]["minLength"] == 1
            if operation == "studio_chat":
                assert "required" not in captured["schema"]["properties"]["changes"]["properties"]["scene"]
        if operation == "studio_project_draft":
            assert captured["schema"]["required"] == ["title", "concept", "style", "invariants", "rationale"]
        if operation == "studio_brief_draft":
            assert captured["schema"]["required"] == [], "No unrequested Project field is required"
            assert captured["schema"]["properties"]["invariants"]["items"]["required"] == ["kind", "title", "text"]


@pytest.mark.parametrize("operation, required_fields, expected", [
    ("studio_brief_draft", ["style"], ["style"]),
    ("studio_brief_draft", ["concept", "invariants"], ["concept", "invariants"]),
    ("studio_scene_field_draft", ["prompt", "title"], ["prompt", "title"]),
    ("studio_scene_field_draft", ["prompt", "durationSeconds"], ["prompt", "durationSeconds"]),
    ("studio_scene_field_draft", ["title"], ["title"]),
    ("studio_scene_field_draft", ["durationSeconds"], ["durationSeconds"]),
])
def test_explicit_studio_authoring_requires_each_requested_field(
        monkeypatch, operation, required_fields, expected):
    from tool.server import app as server
    captured = {}

    def enqueue(client, model, contract, context, label):
        captured.update(contract)
        return {"jobId": "test-required-fields"}

    monkeypatch.setattr(server, "enqueue_llm", enqueue)
    response = server.app.test_client().post("/fs/director/chat", json={
        "model": "test", "operation": operation, "requiredFields": required_fields,
        "messages": [{"role": "user", "content": "Return complete requested fields."}],
    })
    assert response.status_code == 202
    assert captured["response_schema"]["required"] == expected


def test_studio_chat_schema_accepts_prose_and_actual_creative_material_without_action():
    from tool.server.studio_director import chat_response_schema

    schema = chat_response_schema()
    assert schema["required"] == [], "Discussion and authored fields share an open-ended conversation"
    assert schema["minProperties"] == 1
    assert "action" not in schema["properties"], "The model cannot author an application action"
    assert schema["properties"]["reply"]["type"] == "string"
    assert schema["properties"]["scenes"]["items"]["required"] == [
        "title", "prompt", "durationSeconds"
    ]
    assert "sceneId" not in schema["properties"]["changes"]["properties"]["scene"]["properties"]
    project = schema["properties"]["changes"]["properties"]["project"]
    assert "required" not in project, "Partial Project revisions must not rewrite unrelated fields"
    invariant = project["properties"]["invariants"]["items"]
    assert invariant["required"] == ["kind", "title", "text"]
    assert invariant["additionalProperties"] is False
    assert "character" in invariant["properties"]["kind"]["enum"]
    assert "checks" not in schema["properties"]
    assert "capture" not in schema["properties"]


def test_studio_guidance_requests_relevant_invariants_not_ritual_fields():
    system = guidance()["system"]
    assert "Invariants when stable recurring facts matter" in system
    assert "requested Project fields" in system
    assert "When several pieces are requested, deliver all the useful pieces you can" in system

def test_historical_readiness_records_are_accepted_as_inert_saved_chat_data():
    from tool.server.director_chat_history import _validate_readiness

    legacy = {"checks": [], "readHints": [], "writeHint": "", "sceneId": ""}
    assert _validate_readiness(legacy)["writeHint"] == ""
    capture = {"field": "scene", "content": "Complete old prompt",
               "sceneId": "", "title": "Old Scene", "durationSeconds": 12}
    assert _validate_readiness({**legacy, "capture": capture})["capture"] == capture
    original = {**legacy, "writeHint": "scenes", "writeFields": ["prompt"],
                "sceneId": "saved-scene", "sceneNumber": 1,
                "writeInstruction": "Make the ending quieter."}
    assert _validate_readiness(original)["writeInstruction"] == "Make the ending quieter."
    assert _validate_readiness({**original, "sceneNumber": 5})["sceneNumber"] == 5
    for invalid in (True, -1, 10001, 1.5, "5"):
        with pytest.raises(ValueError, match="Scene number"):
            _validate_readiness({**original, "sceneNumber": invalid})


def test_director_scene_index_is_lightweight_and_selected_scene_reads_full_prompt():
    from tool.server.studio_director import read_story_scope

    long_prompt = "A" * 50000  # A saved field must not fail on the old arbitrary 32 KB cutoff.
    story = {"id": "project-1", "sceneOrder": ["scene-a", "scene-b"], "scenes": {
        "scene-a": {"title": "Arrival", "prompt": long_prompt, "summary": "Legacy Intent"},
        "scene-b": {"title": "Departure", "prompt": long_prompt, "summary": ""},
    }}
    assert read_story_scope(story, "index") == [
        {"id": "scene-a", "position": 1, "title": "Arrival"},
        {"id": "scene-b", "position": 2, "title": "Departure"},
    ]
    selected = read_story_scope(story, "scene", "scene-a")
    assert selected["prompt"] == long_prompt
    assert "summary" not in selected
