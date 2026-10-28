"""Studio Director implicit knowledge and bootstrap API contracts."""

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
    assert "STUDIO DIRECTOR | WRITER'S WORKSHOP" in text
    assert "core appeal" in text.lower()
    assert "Ask exactly one useful focused question at a time" in text
    assert "integrated_multimodal_description" in text
    assert "Keep risky hand-to-hand interactions simple." in text
    assert "TECHNICAL H3 PRODUCTION PROMPT CONTRACT" in text
    assert "No Studio changes are made by conversation alone" in text


def test_action_catalog_marks_future_mutations_as_planned():
    by_name = {action["name"]: action for action in ACTIONS}
    assert by_name["conversation.discuss"]["status"] == "available"
    assert by_name["scene.draft"]["status"] == "available"
    assert by_name["project.brief.propose"]["status"] == "planned"


def test_studio_guidance_api_is_read_only():
    from tool.server.app import app
    response = app.test_client().get("/fs/studio/director/guidance")
    assert response.status_code == 200
    assert response.json["ok"] is True
    assert response.json["targetModel"] == "minimax_h3"
    assert response.json["actions"][0]["name"] == "conversation.discuss"


def test_unsupported_generation_model_fails_instead_of_misapplying_h3_guidance():
    from tool.server.app import app
    response = app.test_client().get("/fs/studio/director/guidance?targetModel=unknown")
    assert response.status_code == 400
    assert "currently supports MiniMax H3" in response.json["error"]
