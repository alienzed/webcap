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
    assert "Ask one focused question when a consequential creative decision is missing" in text
    assert "4–15 seconds" in text
    assert "FIELD DEVELOPMENT" in text
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
    assert set(actions) == {"context.read", "project.create", "project.revise", "scenes.write"}
    assert "explicitly selected" in actions["context.read"]
    assert "optional initial Scenes" in actions["project.create"]
    assert "Invariants" in actions["project.revise"]
    assert "one or more Scenes" in actions["scenes.write"]
    assert len(result["system"]) < 6000
    assert "normally 1-3 sentences" in result["system"]
    assert "No recaps of what you did" in result["system"]


def test_director_role_combines_webcap_workflow_expertise_with_creative_judgment():
    system = guidance("minimax_h3")["system"]
    assert "MiniMax H3 production expert, and WebCap Studio workflow guide" in system
    assert "Choose the smallest relevant Read, reviewed Write, or author-operated Studio step" in system
    assert "Readiness is advisory, never a gate" in system
    assert "Acknowledge only the exact saved fields actually supplied" in system
    assert "Conversation never edits Project records" in system
    assert len(system) < 6000


def test_action_catalog_excludes_low_value_studio_director_operations():
    by_name = {action["name"]: action for action in ACTIONS}
    assert set(by_name) == {"context.read", "project.create", "project.revise", "scenes.write"}
    assert all(action["status"] == "available" for action in ACTIONS)
    for retired in ("scene.move", "scene.duplicate", "scene.split", "scene.invariants",
                    "playbook.propose", "scene.sequence.draft", "scene.batch.revise"):
        assert retired not in by_name


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
    assert "Use supplied Project Concept, Visual / atmosphere, relevant Invariants, and Scene Intent" in prompt
    assert "legacy Story Guidelines only when explicitly supplied" in prompt
    assert "integrated_multimodal_description:" in prompt


def test_freeform_workshop_does_not_claim_hidden_context_or_mutations():
    text = guidance("minimax_h3")["system"]
    assert "Acknowledge only the exact saved fields actually supplied" in text
    assert "Read and Write are explicit author-driven operations" in text
    assert "Conversation never edits Project records" in text
    assert "strengthen the idea, do not replace it" in text



def test_five_field_contract_has_explicit_ownership_and_review_boundary():
    text = guidance("minimax_h3")["system"]
    for phrase in (
        "story.concept", "story.style", "story.invariants",
        "scene.summary", "scene.prompt", "MH3 Take generation",
        "Legacy Directing Guidelines",
    ):
        assert phrase.casefold() in text.casefold()
    assert "not new Studio Director destinations" in text
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
    ("studio_project_draft", {"title", "concept", "style", "invariants", "firstScenes", "rationale"}),
    ("studio_scene_draft", {"title", "summary", "rationale"}),
    ("studio_scene_sequence_draft", {"scenes", "rationale"}),
    ("studio_scene_field_draft", {"title", "summary", "prompt"}),
    ("studio_scene_batch_draft", {"scenes"}),
    ("studio_scene_split_draft", {"firstSummary", "secondTitle", "secondSummary", "rationale"}),
    ("studio_playbook_draft", {"guidance"}),
    ("storyboard_workshop_shots", {"summary", "shots"}),
    ("storyboard_story_guidelines", {"summary", "guidelines"}),
    ("freeform_chat", None),
    ("studio_chat", {"reply", "readiness"}),
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
            assert captured["schema"]["required"] == ["title", "concept", "style", "invariants", "rationale"]
            assert captured["schema"]["properties"]["invariants"]["items"]["required"] == ["kind", "title", "text"]


def test_studio_chat_schema_constrains_recommendations_to_the_selected_operation():
    from tool.server.studio_director import chat_response_schema

    schema = chat_response_schema()
    assert schema["required"] == ["reply", "readiness"]
    assert schema["properties"]["reply"]["minLength"] == 1
    variants = schema["properties"]["readiness"]["anyOf"]
    for variant in variants:
        assert variant["additionalProperties"] is False
        assert set(variant["required"]) == {"checks", "readHints", "writeHint", "writeFields", "sceneId"}
        fields = variant["properties"]["writeFields"]
        for operation in variant["properties"]["writeHint"]["enum"]:
            if operation == "project":
                assert set(fields["items"]["enum"]) == {"title", "concept", "style", "invariants"}
            elif operation in {"scene-edit", "scenes-batch"}:
                assert set(fields["items"]["enum"]) == {"title", "summary", "prompt"}
            else:
                assert fields["maxItems"] == 0
        assert fields["uniqueItems"] is True
        assert "project, style, invariants" not in variant["properties"]["writeHint"]["enum"]
        check = variant["properties"]["checks"]["items"]
        assert check["additionalProperties"] is False
        assert set(check["required"]) == {"name", "scope", "ready", "content"}


def test_studio_chat_schema_keeps_creative_captures_optional_and_compatible_with_saved_readiness():
    from tool.server.studio_director import chat_response_schema
    from tool.server.director_chat_history import _validate_readiness

    for variant in chat_response_schema()["properties"]["readiness"]["anyOf"]:
        assert "capture" not in variant["required"]
        captures = variant["properties"]["capture"]["anyOf"]
        for schema in captures:
            assert schema["additionalProperties"] is False
            assert set(schema["required"]) == set(schema["properties"])
            for field in schema["properties"]["field"]["enum"]:
                capture = {"field": field, "content": "Complete developed creative material.",
                           "sceneId": "scene-1" if field in {"summary", "prompt"} else ""}
                if field == "scene":
                    capture["title"] = "A quiet reply"
                if field == "invariant":
                    capture.update(kind="character", title="Mara", beforeKind="", beforeTitle="")
                readiness = {"checks": [], "readHints": [], "writeHint": "", "writeFields": [],
                             "sceneId": "", "capture": capture}
                assert _validate_readiness(readiness)["capture"] == capture
