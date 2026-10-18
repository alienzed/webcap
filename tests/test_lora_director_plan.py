import pytest
from tool.server import lora_director_plan


@pytest.fixture
def options():
    return [
        {"code": "A", "name": "identity.safetensors",
         "trainedWords": ["identity-key"], "promptOptions": {}},
        {"code": "B", "name": "progress.safetensors",
         "trainedWords": [], "promptOptions": {"stage": ["early", "late"]}}
    ]


def test_codes_and_grounded_progression(options):
    result = lora_director_plan.validate_plan({
        "reason": "continuity",
        "storyWide": [{"code": "A", "strength": 0.8, "phrases": ["identity-key"]}],
        "scenes": [{"sceneId": "s1", "assign": [
            {"code": "B", "strength": 0.6, "phrases": ["early"]}
        ]}]
    }, options, [{"id": "s1"}])
    assert result["storyWide"][0]["name"] == "identity.safetensors"
    assert result["scenes"][0]["assign"][0]["phrases"] == ["early"]


def test_unknown_code_rejected(options):
    with pytest.raises(ValueError, match="Unknown LoRA code"):
        lora_director_plan.validate_plan({
            "storyWide": [{"code": "Z", "strength": 1, "phrases": []}]
        }, options)


def test_undocumented_phrase_rejected(options):
    with pytest.raises(ValueError, match="undocumented keyphrase"):
        lora_director_plan.validate_plan({
            "storyWide": [{"code": "A", "strength": 1, "phrases": ["guess"]}]
        }, options)


def test_no_selection_is_valid(options):
    assert lora_director_plan.validate_plan(
        {"reason": "nothing relevant", "storyWide": [], "scenes": []}, options
    )["storyWide"] == []


def test_catalogue_codes_are_request_local(monkeypatch):
    monkeypatch.setattr(lora_director_plan, "catalogue", lambda: [
        {"stage": "h3", "name": "a.safetensors", "enriched": True,
         "enrichment": {"description": "character A", "trainedWords": ["a-key"]}},
        {"stage": "h3", "name": "b.safetensors", "enriched": True,
         "enrichment": {"description": "character B", "trainedWords": ["b-key"]}}
    ])
    options = lora_director_plan.shortlist("h3", "character A", max_chars=10000)
    assert [x["code"] for x in options] == ["A", "B"]
    assert options[0]["name"] == "a.safetensors"
