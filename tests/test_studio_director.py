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
    assert "Ask one useful focused question at a time" in text
    assert "4–15 seconds" in text
    assert "T2VA" in text and "I2VA" in text and "L2VA" in text and "FL2VA" in text
    assert "guide-frame references and Ref2VA are not supported" in text
    assert "Prepare Scenes" in text and "reviewed" in text.lower()
    assert "Keep risky hand-to-hand interactions simple." in text
    assert "Conversation alone does not create" in text
    assert "integrated_multimodal_description" in result["promptContract"]
    assert "TECHNICAL H3 PRODUCTION PROMPT CONTRACT" not in text
    assert "[Shot 1]" not in text
    assert len(text) < 4300


def test_action_catalog_marks_future_mutations_as_planned():
    by_name = {action["name"]: action for action in ACTIONS}
    assert by_name["conversation.discuss"]["status"] == "available"
    assert by_name["scene.draft"]["status"] == "available"
    assert by_name["project.create"]["status"] == "available"
    assert by_name["scene.sequence.draft"]["status"] == "available"
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
