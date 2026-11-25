"""Studio Director implicit knowledge and bootstrap API contracts."""

import pytest

from tool.server import config as app_config
from tool.server.studio_director import guidance, ACTIONS
from tool.server.llm_guidance import text_for as llm_guidance_text


def test_creative_role_is_concise_and_separate_from_technical_h3_reference(monkeypatch):
    monkeypatch.setattr(app_config, "config", {
        "generation_model_guidance": {"minimax_h3": "Empirical observation about lip sync."}
    })
    result = guidance(profile="current")
    system, reference = result["system"], result["promptContract"]
    assert system.startswith("STUDIO DIRECTOR | CREATIVE PARTNER")
    assert "understand the author's vision" in system.lower()
    assert "Concept / overview" in system
    assert "Visual / atmosphere" in system
    assert "Invariants" in system
    assert "complete generation Prompt" in system
    assert "WebCap saves Project and Scene fields" in system
    assert "MiniMax H3" in system
    assert "Empirical observation about lip sync." not in system
    assert "Empirical observation about lip sync." in reference
    assert "integrated_multimodal_description:" in reference
    assert "[Shot 1]" in reference
    assert len(system) < 4000


@pytest.mark.parametrize("profile", ["classic", "current", "imaginative", "render"])
def test_all_profiles_share_core_expertise_without_automatic_event_bias(profile):
    system = guidance(profile=profile)["system"]
    for phrase in ("composition", "stillness", "dialogue", "montages",
                   "independent clips", "recurring consistency matters",
                   "author's vision", "Talk naturally and proportionately",
                   "rapid 1–2-second montage", "synchronized audio",
                   "consequential visible details"):
        assert phrase.casefold() in system.casefold()
    assert "worthwhile event" not in system
    assert "clear physical changes" not in system
    assert "choose durations to suit" not in system
    assert "intended progression" not in system
    assert "durationSeconds" not in system
    assert "H3 PROMPT AUTHORING REFERENCE" not in system
    assert "integrated_multimodal_description:" not in system
    assert "studio_scenes_draft" not in system
    assert len(system) < 4000


def test_profiles_have_distinct_stances_but_same_project_scope():
    from tool.server.studio_director import PROFILES
    assert [item["id"] for item in PROFILES] == [
        "classic", "current", "imaginative", "render"
    ]
    roles = {item["id"]: guidance(profile=item["id"])["system"] for item in PROFILES}
    assert len(set(roles.values())) == 4
    for role in roles.values():
        assert "Concept expresses the premise" in role
        assert "Invariants describe deliberately stable recurring subjects" in role
        assert "individual Scenes carry their own actions" in role
    assert "versatile creative partner" in roles["classic"]
    assert "active editorial role" in roles["current"]
    assert "bold, distinctive interpretations" in roles["imaginative"]
    assert "particularly attentive production judgment" in roles["render"]


def test_chat_can_discuss_and_show_creative_drafts_without_saving():
    system = guidance(profile="current")["system"]
    assert "substantial requests merit developed ideas or complete drafts" in system
    assert "Talk naturally and proportionately" in system
    assert "Ask a focused question" in system
    assert "Conversation can explore or draft creative content" in system
    assert "through the author's explicit Write actions" in system


def test_h3_toolkit_is_capability_knowledge_not_fixed_shot_structure():
    toolkit = llm_guidance_text("h3.toolkit")
    for phrase in ("up to 15 seconds", "rapid 1–2-second montage",
                   "continuous fixed or moving shot", "dialogue-led coverage",
                   "visually rich tableaux", "the exact spoken words",
                   "speaker", "language", "vocal identity", "emotional delivery",
                   "ambience", "music", "silence", "unambiguously",
                   "continuity where an unintended variation"):
        assert phrase.casefold() in toolkit.casefold()
    for phrase in ("worthwhile event", "strong physical changes",
                   "mandatory progression", "never", "avoid", "do not"):
        assert phrase not in toolkit.casefold()


def test_chat_can_skip_h3_authoring_load_and_empirical_playbook(monkeypatch):
    from tool.server import studio_director
    original = studio_director.llm_guidance_text
    seen = []

    def observe(module_id):
        seen.append(module_id)
        if module_id == "h3.authoring":
            raise AssertionError("Ordinary chat loaded the technical authoring contract")
        return original(module_id)

    monkeypatch.setattr(studio_director, "llm_guidance_text", observe)
    monkeypatch.setattr(app_config, "config", {})
    from pathlib import Path
    original_read = Path.read_text

    def forbid_prompt_reads(path, *args, **kwargs):
        if path.name in {"mmh3-prompt-runtime-context.txt", "storyboard-director-context.txt"}:
            raise AssertionError("Unrelated prompt document was read during Studio Chat")
        return original_read(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", forbid_prompt_reads)
    result = guidance(profile="classic", include_prompt_contract=False)
    assert result["system"]
    assert result["promptContract"] == ""
    assert seen == ["studio.classic", "h3.toolkit"]


def test_action_catalog_excludes_low_value_studio_director_operations():
    from tool.server.studio_director import ACTIONS
    by_name = {action["name"]: action for action in ACTIONS}
    assert set(by_name) == {"context.read", "project.write", "scenes.write"}
    assert all(action["status"] == "available" for action in ACTIONS)
    for retired in ("scene.move", "scene.duplicate", "scene.split", "scene.invariants",
                    "playbook.propose", "scene.sequence.draft", "scene.batch.revise"):
        assert retired not in by_name


def test_chat_and_write_response_contracts_are_distinct():
    from tool.server.studio_director import chat_response_schema
    schema = chat_response_schema()
    assert schema["required"] == ["reply"]
    assert set(schema["properties"]) == {"reply"}
    for field in ("changes", "scenes", "action"):
        assert field not in schema["properties"]


def test_studio_guidance_api_remains_read_only_and_scoped():
    from tool.server.app import app
    client = app.test_client()
    chat = client.get("/fs/studio/director/guidance?profile=classic&includePromptContract=0")
    assert chat.status_code == 200
    assert chat.json["system"]
    assert chat.json["promptContract"] == ""
    assert chat.json["actions"][0]["name"] == "context.read"
    scene_write = client.get("/fs/studio/director/guidance?profile=classic&includePromptContract=1")
    assert scene_write.status_code == 200
    assert "integrated_multimodal_description:" in scene_write.json["promptContract"]
    assert scene_write.json["system"] == chat.json["system"]
    assert scene_write.json["profile"] == chat.json["profile"]


def test_unsupported_generation_model_fails_instead_of_misapplying_h3_guidance():
    from tool.server.app import app
    response = app.test_client().get("/fs/studio/director/guidance?targetModel=unknown")
    assert response.status_code == 400
    assert "currently supports MiniMax H3" in response.json["error"]


def test_h3_runtime_reference_uses_current_studio_fields_and_conditional_legacy_guidelines():
    prompt = guidance(profile="current")["promptContract"]
    assert "Use supplied Project Concept, Visual / atmosphere, relevant Invariants, and the saved Scene Prompt" in prompt
    assert "legacy Story Guidelines only when explicitly supplied" in prompt
    assert "integrated_multimodal_description:" in prompt


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
    ("studio_brief_draft", {"title", "concept", "style", "invariants"}),
    ("studio_project_draft", {"title", "concept", "style", "invariants"}),
    ("studio_scene_field_draft", {"title", "prompt", "durationSeconds"}),
    ("studio_scenes_draft", {"scenes", "rationale"}),
    ("storyboard_workshop_shots", {"summary", "shots"}),
    ("freeform_chat", None),
    ("studio_chat", None),
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
        if operation not in {"studio_scene_field_draft", "studio_scenes_draft", "studio_project_draft", "studio_brief_draft"}:
            assert captured["schema"]["additionalProperties"] is False
        else:
            assert "additionalProperties" not in captured["schema"]
        if operation == "studio_scene_field_draft":
            assert captured["schema"]["required"] == ["prompt"]
            assert captured["schema"]["properties"]["prompt"]["type"] == "string"
            assert "title" not in captured["schema"]["required"]
            assert "durationSeconds" not in captured["schema"]["required"]
        if operation == "studio_scenes_draft":
            assert captured["schema"]["required"] == ["scenes"]
            assert "prompt" not in captured["schema"]["properties"]
            assert captured["schema"]["properties"]["scenes"]["items"]["properties"]["prompt"]["type"] == "string"
        if operation == "studio_scenes_draft":
            record = captured["schema"]["properties"]["scenes"]["items"]
            assert record["required"] == ["title", "prompt", "durationSeconds"]
            assert record["properties"]["prompt"]["type"] == "string"
            assert "maximum" not in record["properties"]["durationSeconds"]
        if operation in {"studio_project_draft", "studio_brief_draft"}:
            assert captured["schema"]["required"] == ["title", "concept", "style", "invariants"]
            for field in ("title", "concept", "style"):
                assert "maxLength" not in captured["schema"]["properties"][field]
            invariant_schema = captured["schema"]["properties"]["invariants"]
            assert "maxItems" not in invariant_schema
            assert invariant_schema["items"]["required"] == ["kind", "title", "text"]
            assert invariant_schema["items"]["properties"]["kind"]["enum"] == [
                "character", "location", "visual", "world", "sound", "custom"
            ]


@pytest.mark.parametrize("operation, required_fields, expected", [
    ("studio_brief_draft", ["style"], ["style"]),
    ("studio_brief_draft", ["style", "style"], ["style"]),
    ("studio_brief_draft", [], ["title", "concept", "style", "invariants"]),
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
    if operation == "studio_brief_draft":
        assert list(captured["response_schema"]["properties"]) == expected
    assert captured["response_schema"]["required"] == expected


def test_studio_chat_is_conversation_only_without_writing_schema():
    from tool.server.studio_director import chat_response_schema
    schema = chat_response_schema()
    assert schema["required"] == ["reply"]
    assert set(schema["properties"]) == {"reply"}
    assert "changes" not in schema["properties"]
    assert "scenes" not in schema["properties"]
    assert "action" not in schema["properties"]


def test_studio_guidance_keeps_project_and_h3_authoring_out_of_chat():
    system = guidance(profile="current")["system"]
    reference = guidance(profile="current")["promptContract"]
    assert "STUDIO DIRECTOR | CREATIVE PARTNER" in system
    assert "H3 PROMPT AUTHORING REFERENCE" not in system
    assert "integrated_multimodal_description:" in reference
    assert "When several pieces are requested" not in system


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
    assert "entryState" not in selected and "exitState" not in selected
    assert "durationSeconds" in selected


def test_studio_action_advisor_is_an_isolated_optional_llm_operation(monkeypatch):
    from tool.server import app as server
    captured = {}

    def enqueue(client, model, contract, context, label):
        captured.update({"client": client, "model": model, "contract": contract})
        return {"jobId": "sidecar-advisor-job", "status": "queued"}

    monkeypatch.setattr(server, "enqueue_llm", enqueue)
    response = server.app.test_client().post("/fs/director/chat", json={
        "model": "inexpensive-sidecar-model",
        "operation": "studio_action_advisor",
        "messages": [{"role": "user", "content": '{"conversation":[{"role":"assistant","content":"A quiet opening"}],"actionContext":{"projectId":"p1","sceneId":""}}'}],
    })
    assert response.status_code == 202
    assert response.get_json()["job"]["jobId"] == "sidecar-advisor-job"
    assert captured["client"] == "chat"
    assert captured["model"] == "inexpensive-sidecar-model"
    contract = captured["contract"]
    assert contract["operation"] == "studio_action_advisor"
    assert contract["messages"][0]["role"] == "system"
    assert "Action Advisor" in contract["messages"][0]["content"]
    assert "not commands" in contract["messages"][0]["content"]
    assert len(contract["messages"]) == 2
    assert contract["messages"][1]["role"] == "user"
    assert contract["response_schema"]["properties"]["actions"]["items"]["properties"]["kind"]["enum"] == [
        "create_project", "revise_project", "create_scene", "revise_scenes", "read"
    ]
    # The live Gemma failures returned syntactically valid but unusable actions
    # because all fields in the old response schema were optional.
    schema = contract["response_schema"]
    assert schema["required"] == ["actions"]
    assert schema["additionalProperties"] is False
    actions = schema["properties"]["actions"]
    assert actions["maxItems"] == 1
    assert "at most one" in contract["messages"][0]["content"]
    item = actions["items"]
    assert item["additionalProperties"] is False
    assert set(item["required"]) == {
        "kind", "label", "instruction", "projectId", "fields", "sceneIds"
    }
    assert item["properties"]["label"]["minLength"] == 1
    assert set(item["properties"]["fields"]["items"]["enum"]) == {
        "title", "concept", "style", "invariants", "overview", "scene"
    }
    prompt = contract["messages"][0]["content"]
    assert "Copy actionContext.projectId exactly" in prompt
    assert "all six keys" in prompt
    assert "props, and timing" in prompt
    assert "if none apply return" in prompt



def test_studio_creative_profiles_are_versioned_and_preserve_production_contract():
    from tool.server.studio_director import PROFILES
    assert [p["id"] for p in PROFILES] == ["classic", "current", "imaginative", "render"]
    assert all(p["version"] for p in PROFILES)
    payloads = [guidance(profile=p["id"]) for p in PROFILES]
    assert guidance()["profile"] == "classic"
    assert all(p["promptContract"] == payloads[0]["promptContract"] for p in payloads)
    assert all(p["actions"] == payloads[0]["actions"] for p in payloads)
    assert "reviewed Apply" not in payloads[0]["system"]
    assert "scene.summary" not in payloads[0]["system"]
    assert "workflows" not in payloads[0]["system"].lower()
    assert "Invariants" in payloads[0]["system"]
    assert payloads[1]["system"] != payloads[0]["system"]
    assert "PROFILE | IMAGINATIVE" in payloads[2]["system"]
    assert "PROFILE | RENDER-FOCUSED" in payloads[3]["system"]


def test_studio_creative_profile_endpoint_and_unknown_id():
    from tool.server.app import app
    client = app.test_client()
    default = client.get("/fs/studio/director/guidance")
    assert default.status_code == 200
    assert default.json["profile"] == "classic"
    selected = client.get("/fs/studio/director/guidance?profile=current")
    assert selected.status_code == 200
    assert selected.json["profile"] == "current"
    assert selected.json["system"] != default.json["system"]
    unknown = client.get("/fs/studio/director/guidance?profile=nonexistent")
    assert unknown.status_code == 400
    assert "Unknown Studio Director creative profile" in unknown.json["error"]
