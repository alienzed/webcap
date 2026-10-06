from tool.server.test_wildcard_contract import build_request, normalize_result


def test_caption_wildcard_contract_reports_stable_and_variable_content():
    request = build_request([
        "mikeperson standing in a kitchen, black shirt, soft lighting, front view",
        "mikeperson sitting on a couch, blue shirt, natural lighting, side view",
        "mikeperson standing in a kitchen, black shirt, soft lighting, front view",
    ])

    assert request["operation"] == "analyze_caption_wildcard"
    assert request["output"] == "json"
    assert request["response_schema"]["required"] == ["wildcard", "stableTerms", "variationGroups"]
    assert "[count=2] mikeperson standing in a kitchen" in request["prompt"]
    assert "frequency metadata" in request["prompt"]
    assert "Use only information present in the supplied captions" in request["prompt"]
    assert "Do not create a wildcard for something that is effectively constant" in request["prompt"]


def test_caption_wildcard_contract_requires_real_captions():
    import pytest

    with pytest.raises(ValueError, match="no captions"):
        build_request(["", "   "])


def test_caption_wildcard_contract_preserves_meaningful_line_structure():
    request = build_request(["subject standing\nblack shirt\nsoft lighting, front view"])

    assert "subject standing\nblack shirt\nsoft lighting, front view" in request["prompt"]


def test_caption_wildcard_result_is_normalized_before_ui():
    result = normalize_result({
        "wildcard": " subject {standing|sitting} ",
        "stableTerms": [" subject "],
        "variationGroups": [{"label": " pose ", "options": [" standing ", " sitting "]}],
    })

    assert result == {
        "wildcard": "subject {standing|sitting}",
        "stableTerms": ["subject"],
        "variationGroups": [{"label": "pose", "options": ["standing", "sitting"]}],
    }


def test_caption_wildcard_contract_prioritizes_primary_concept_without_dropping_secondary_dimensions():
    request = build_request(
        [
            "A woman poses wearing a black micro bikini with yellow trim, studio lighting, front view.",
            "A woman poses wearing a white ruched micro bikini with red trim, natural lighting, rear view.",
        ],
        set_name="micro_bikini_set",
        focus="bikini",
    )

    prompt = request["prompt"]
    assert "Set name: micro_bikini_set" in prompt
    assert "Explicit focus: bikini" in prompt
    assert "primary concept should receive the richest decomposition" in prompt
    assert "physical appearance, background, and lighting are valid and useful" in prompt
    assert "separate color, pattern, trim, top shape, and bottom shape" in prompt
    assert "Never emit category placeholders" in prompt


def test_caption_wildcard_result_rejects_generic_placeholder_options():
    import pytest

    with pytest.raises(ValueError, match="generic placeholder"):
        normalize_result({
            "wildcard": "wearing a {micro bikini|various bikini styles}",
            "stableTerms": ["wearing"],
            "variationGroups": [
                {"label": "style", "options": ["micro bikini", "various bikini styles"]},
            ],
        })


def test_caption_wildcard_result_allows_optional_empty_alternative():
    result = normalize_result({
        "wildcard": "wearing a {black|white} {ruched|} micro bikini",
        "stableTerms": ["micro bikini"],
        "variationGroups": [
            {"label": "color", "options": ["black", "white"]},
            {"label": "texture", "options": ["ruched", ""]},
        ],
    })

    assert result["variationGroups"][1]["options"] == ["ruched", ""]
