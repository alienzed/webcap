"""Studio Director implicit knowledge and bootstrap API contracts."""

import pytest

from tool.server import config as app_config
from tool.server.studio_director import guidance, ACTIONS


def test_writer_workshop_uses_existing_h3_prompt_contract_and_user_playbook(monkeypatch):
    monkeypatch.setattr(
        app_config,
        "config",
        {"generation_model_guidance": {"minimax_h3": "Keep risky hand-to-hand interactions simple."}},
    )
    result = guidance("minimax_h3")
    text = result["system"]
    assert "STUDIO DIRECTOR | EXPERT CREATIVE PRODUCER" in text
    assert "core appeal" in text.lower()
    assert "ask one focused question; otherwise offer a specific idea" in text
    assert "4–15 seconds" in text
    assert "FIELD DEVELOPMENT" in text
    assert "Capture complete agreed material for immediate review" in text
    assert "Entry and exit state fields are retired" in text
    assert "These controls and media inspection are outside Studio Director" in text
    assert "Write Scenes" in text and "reviewed" in text.lower()
    assert "Keep risky hand-to-hand interactions simple." in text
    assert "Conversation alone does not create" in text or "Conversation never edits Project records" in text
    assert "integrated_multimodal_description" in result["promptContract"]
    assert "TECHNICAL H3 PRODUCTION PROMPT CONTRACT" not in text
    assert "[Shot 1]" not in text
    assert len(text) < 6000


def test_studio_guidance_teaches_only_focused_creative_workflows():
    result = guidance("minimax_h3")
    actions = {entry["name"]: entry["description"] for entry in result["actions"]}
    assert set(actions) == {"context.read", "project.write", "scenes.write"}
    assert "automatically supplies" in actions["context.read"]
    assert "preserving unrelated" in actions["project.write"]
    assert "Invariants" in actions["project.write"]
    assert "one or more Scenes" in actions["scenes.write"]
    assert len(result["system"]) < 6000
    assert "normally 1-3 sentences" in result["system"]
    assert "brief exchanges" in result["system"]


def test_director_role_combines_webcap_workflow_expertise_with_creative_judgment():
    system = guidance("minimax_h3")["system"]
    assert "MiniMax H3 production expert, and WebCap Studio workflow guide" in system
    assert "Answer supplied-context questions directly" in system
    assert "WebCap resolves the actual destination" in system
    assert "Use only saved creative material actually supplied" in system
    assert "Conversation never edits Project records" in system
    assert "Project Overview (Concept, Visual / atmosphere, Invariants)" in system
    assert "Scene (Title, H3 Prompt)" in system
    assert "scene.prompt) is its creative content" in system
    assert "preserving unaffected authored material" in system
    assert len(system) < 6000


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
    kinds = chat_response_schema()["properties"]["action"]["anyOf"][1]["properties"]["kind"]["enum"]
    assert "coherence-check" not in kinds, "Coherence remains a separate utility"


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
    text = result["system"]
    assert "core appeal" in text.lower()
    assert "Take" in text and "Scene" in text and "reference" in text
    assert "4–15 seconds" in text
    assert "[Shot 1]" not in text
    assert "USER'S H3 PRODUCTION PLAYBOOK" not in text
    assert "[Shot 1]" in result["promptContract"]


def test_h3_runtime_reference_uses_current_studio_fields_and_conditional_legacy_guidelines():
    prompt = guidance("minimax_h3")["promptContract"]
    assert "Use supplied Project Concept, Visual / atmosphere, relevant Invariants, and the saved Scene Prompt" in prompt
    assert "legacy Story Guidelines only when explicitly supplied" in prompt
    assert "integrated_multimodal_description:" in prompt


def test_freeform_workshop_does_not_claim_hidden_context_or_mutations():
    text = guidance("minimax_h3")["system"]
    assert "WebCap supplies the selected Scene\'s saved fields" in text
    assert "explicit Read remains available for other scopes" in text
    assert "Conversation never edits Project records" in text
    assert "strengthen the idea, do not replace it" in text
    assert "Enthusiastically elevate the author\'s vision" in text
    assert "compelling visual ideas, and expert prompting techniques" in text
    assert "subject, action, interaction or atmosphere" in text



def test_scene_prompt_is_the_only_active_creative_field():
    text = guidance("minimax_h3")["system"]
    for phrase in (
        "story.concept", "story.style", "story.invariants",
        "scene.prompt", "MH3 Take generation",
        "Legacy Directing Guidelines",
    ):
        assert phrase.casefold() in text.casefold()
    assert "not new Studio Director destinations" in text
    assert "Older saved summaries are dormant legacy data" in text
    assert "reviewed insertion" in text
    assert "conversation alone never edits them" in text


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


@pytest.mark.parametrize("operation, expected_fields", [
    ("studio_brief_draft", {"title", "concept", "style", "invariants", "rationale"}),
    ("studio_project_draft", {"title", "concept", "style", "invariants", "initialScenes", "rationale"}),
    ("studio_scene_draft", {"title", "prompt", "rationale"}),
    ("studio_scene_sequence_draft", {"scenes", "rationale"}),
    ("studio_scene_field_draft", {"title", "prompt", "durationSeconds"}),
    ("studio_scene_batch_draft", {"scenes"}),
    ("studio_playbook_draft", {"guidance"}),
    ("storyboard_workshop_shots", {"summary", "shots"}),
    ("storyboard_story_guidelines", {"summary", "guidelines"}),
    ("freeform_chat", None),
    ("studio_chat", {"reply", "action", "changes"}),
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
        if operation == "studio_brief_draft":
            assert "required" not in captured["schema"], "Unchanged Project fields are not model outputs"
            assert captured["schema"]["properties"]["invariants"]["items"]["required"] == ["kind", "title", "text"]


def test_studio_chat_schema_accepts_read_and_one_optional_authoring_action():
    from tool.server.studio_director import chat_response_schema

    schema = chat_response_schema()
    assert schema["required"] == ["reply"], "A useful Read must not require action metadata"
    assert schema["properties"]["reply"]["minLength"] == 1
    nullable, suggestion = schema["properties"]["action"]["anyOf"]
    assert nullable == {"type": "null"}
    assert suggestion["additionalProperties"] is False
    assert set(suggestion["required"]) == {"kind", "instruction"}
    assert set(suggestion["properties"]["kind"]["enum"]) == {
        "create_project", "write_project", "create_scene", "write_scenes"
    }
    assert "sceneId" not in suggestion["properties"]
    assert "sceneNumber" not in suggestion["properties"]
    assert "checks" not in schema["properties"]
    assert "capture" not in schema["properties"]
    assert set(suggestion["properties"]["fields"]["items"]["enum"]) == {
        "title", "concept", "style", "invariants", "prompt", "durationSeconds"
    }


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
