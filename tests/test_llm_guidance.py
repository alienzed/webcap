"""Behavioral coverage for configurable, scoped LLM guidance."""
import json
from pathlib import Path

import pytest

from tool.server import config as app_config
from tool.server import llm_guidance
from tool.server.studio_director import guidance
from tool.server.storyboard_llm_contract import build_request as storyboard_request
from tool.server.generation_director_contract import build_request as generate_request


def test_guidance_catalog_has_unique_named_sources_and_the_four_studio_presets(monkeypatch):
    monkeypatch.setattr(app_config, "load_config_from_disk", lambda: {"llm_guidance": {}})
    rows = llm_guidance.catalog()
    keys = [row["id"] for row in rows]
    assert len(keys) == len(set(keys))
    assert set(keys) == llm_guidance.MODULE_IDS
    assert {"studio.classic", "studio.current", "studio.imaginative", "studio.render"} <= set(keys)
    assert all(row["default"].strip() and not row["overridden"] for row in rows)
    assert "overall_soundscape:" in llm_guidance.default_texts()["h3.authoring"]


def test_overrides_replace_named_defaults_and_reset_by_absence(monkeypatch):
    monkeypatch.setattr(app_config, "config", {
        "llm_guidance": {
            "studio.classic": "Custom creative role.",
            "h3.toolkit": "Custom medium expertise.",
            "h3.authoring": "Custom technical prompt reference.",
        },
        "generation_model_guidance": {},
    })
    system = guidance(profile="classic")["system"]
    assert system == "Custom creative role.\n\nCustom medium expertise."
    assert guidance(profile="classic")["promptContract"] == "Custom technical prompt reference."
    assert "CLASSIC CREATIVE PRODUCER" not in system
    monkeypatch.setattr(app_config, "config", {"llm_guidance": {}, "generation_model_guidance": {}})
    assert "CLASSIC CREATIVE PRODUCER" in guidance(profile="classic")["system"]


def _scene_story():
    return {
        "id": "p1", "title": "Demo", "concept": "A lively market.",
        "style": "Warm, cinematic", "invariants": {},
        "sceneOrder": ["s1"],
        "scenes": {"s1": {
            "id": "s1", "title": "Market", "durationSeconds": 12,
            "prompt": "Subject: vendor.\nintegrated_multimodal_description:\n[Shot 1] (0s-12s) The vendor speaks.",
        }},
    }


def test_specialists_use_selected_roles_and_shared_h3_authoring(monkeypatch):
    monkeypatch.setattr(app_config, "config", {
        "llm_guidance": {
            "task.prompt_assist": "Only these text-assistance instructions.",
            "task.visual_direction": "Only these visual-direction instructions.",
            "task.project_deep_qa": "Only these Project QA instructions.",
            "h3.authoring": "Editable H3 authoring instructions.",
            "h3.toolkit": "Editable creative toolkit.",
            "storyboard.director": "Editable Storyboard director context.",
            "task.generate": "Editable Generate director role.",
        },
        "generation_model_guidance": {},
    })
    story = _scene_story()
    assert storyboard_request(story, "s1", "prompt_assist")["system_prompt"] == "Only these text-assistance instructions."
    assert storyboard_request(story, "s1", "visual_direction")["system_prompt"] == "Only these visual-direction instructions."
    assert storyboard_request(story, "", "project_deep_qa")["system_prompt"] == "Only these Project QA instructions."
    expanded = storyboard_request(story, "", "expand_concept")["prompt"]
    assert "Editable Storyboard director context." in expanded
    scene = storyboard_request(story, "s1", "write_prompt")["prompt"]
    assert "Editable H3 authoring instructions." in scene
    assert "Editable creative toolkit." in scene
    generated = generate_request("minimax_h3", "write_prompt", prompt="A market.")["prompt"]
    assert "Editable Generate director role." in generated
    assert "Editable H3 authoring instructions." in generated
    assert "Editable creative toolkit." in generated


def test_config_rejects_unknown_guidance_keys_and_does_not_persist_blank_overrides():
    sample_path = Path(__file__).resolve().parents[1] / "tool" / "config.example.json"
    payload = json.loads(sample_path.read_text(encoding="utf-8"))
    payload["llm_guidance"] = {"h3.toolkit": "My approach.", "studio.classic": "  "}
    parsed = app_config.validate_config_payload(payload)
    assert parsed["llm_guidance"] == {"h3.toolkit": "My approach."}
    payload["llm_guidance"] = {"unknown.operation": "Hidden instructions"}
    with pytest.raises(ValueError, match="supported guidance modules"):
        app_config.validate_config_payload(payload)
    payload["llm_guidance"] = ["an array"]
    with pytest.raises(ValueError, match="Config.llm_guidance"):
        app_config.validate_config_payload(payload)


def test_catalog_api_shows_exact_defaults_and_source_status(monkeypatch):
    from tool.server.app import app
    monkeypatch.setattr(app_config, "load_config_from_disk", lambda: {"llm_guidance": {"h3.toolkit": "A custom replacement."}})
    response = app.test_client().get("/fs/llm/guidance/catalog")
    assert response.status_code == 200
    rows = {row["id"]: row for row in response.json["modules"]}
    assert response.json["ok"]
    assert rows["h3.toolkit"]["overridden"] is True
    assert rows["studio.classic"]["overridden"] is False
    assert rows["studio.classic"]["default"] == llm_guidance.default_texts()["studio.classic"]
