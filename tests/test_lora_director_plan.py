import pytest
from tool.server import lora_director_plan


@pytest.fixture
def models(monkeypatch):
    monkeypatch.setattr(lora_director_plan, "candidates_for_stage", lambda stage: [
        {"name": "identity.safetensors", "trainedWords": ["identity-key"], "promptOptions": {}, "guidance": ""},
        {"name": "progress.safetensors", "trainedWords": [], "promptOptions": {"stage": ["early", "late"]}, "guidance": ""}
    ])


def test_validate_scene_progression(models):
    plan = lora_director_plan.validate_plan({
        "reason": "continuity",
        "storyWide": [{"name": "identity.safetensors", "strength": 0.8, "phrases": ["identity-key"]}],
        "scenes": [{"sceneId": "s1", "assign": [{"name": "progress.safetensors", "strength": 0.6, "phrases": ["early"]}]}]
    }, "h3", [{"id": "s1"}])
    assert plan["storyWide"][0]["name"] == "identity.safetensors"
    assert plan["scenes"][0]["assign"][0]["phrases"] == ["early"]


def test_reject_invented_model(models):
    with pytest.raises(ValueError, match="outside the enriched catalogue"):
        lora_director_plan.validate_plan({
            "storyWide": [{"name": "invented.safetensors", "phrases": []}]
        }, "h3")


def test_reject_invented_phrase(models):
    with pytest.raises(ValueError, match="unsupported"):
        lora_director_plan.validate_plan({
            "storyWide": [{"name": "identity.safetensors", "phrases": ["guess"]}]
        }, "h3")
