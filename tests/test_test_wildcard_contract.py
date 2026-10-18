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
    assert "black hair can be tested even when the captions mention only brown and blonde hair" in request["prompt"]
    assert "Each wildcard group must vary exactly one attribute" in request["prompt"]


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


def test_wildcard_vocabulary_supplies_independent_dimensions_without_closing_options():
    request = build_request(
        ["A person with brown wavy hair in a red bikini."],
        vocabulary=[
            {"group": "Hair", "alias": "Hair colour and style", "terms": ["brown", "wavy"]},
            {"group": "BT Shape", "alias": "Bikini top shape", "terms": ["triangle", "teardrop"]},
        ],
    )
    prompt = request["prompt"]
    assert '"group": "BT Shape"' in prompt
    assert '"alias": "Bikini top shape"' in prompt
    assert '"terms": ["triangle", "teardrop"]' in prompt
    assert "not a closed list of test values" in prompt
    assert "{brown|black|blonde|ginger} hair" in prompt


def test_wildcard_proposal_observes_same_group_pairs_only():
    from tool.server.test_wildcard_contract import observed_group_combinations
    tagged = {
        "a.png": {"BT Shape": ["triangle"], "BT Back": ["dual-ring"]},
        "b.png": {"BT Shape": ["teardrop"], "BT Back": ["dual-ring"]},
        "c.png": {"BT Shape": ["triangle", "micro"], "BT Back": ["string"]},
    }
    combos = observed_group_combinations(tagged, ["a.png", "b.png", "c.png"])
    assert combos["BT Shape"] == [["micro", "triangle"], ["teardrop"], ["triangle"]]
    assert ["dual-ring", "triangle"] not in combos["BT Shape"]
    request = build_request(["a triangle bikini"], group_combinations=combos)
    assert "Observed same-group tag combinations:" in request["prompt"]
    assert "mutually exclusive" in request["prompt"]
    assert "cross-group recombination" in request["prompt"]


def test_within_group_unobserved_wildcard_pair_rejected():
    import pytest
    from tool.server.test_wildcard_contract import validate_group_compatibility
    observations = {"Shape": [["triangle"], ["teardrop"], ["triangle", "micro"]]}
    data = {"wildcard":"{triangle|teardrop} {micro|triangle}", "variationGroups": [
        {"label":"Shape", "annotationGroup":"Shape", "options":["triangle","teardrop"]},
        {"label":"Detail", "annotationGroup":"Shape", "options":["micro","triangle"]},
    ]}
    with pytest.raises(ValueError, match="Unobserved same-group"):
        validate_group_compatibility(data, observations)


def test_cross_group_recombination_is_allowed():
    from tool.server.test_wildcard_contract import validate_group_compatibility
    observations = {"Shape":[["triangle"],["teardrop"]], "Back":[["ring"],["string"]]}
    data = {"wildcard":"{triangle|teardrop} {ring|string}", "variationGroups":[
        {"label":"Shape", "annotationGroup":"Shape", "options":["triangle","teardrop"]},
        {"label":"Back", "annotationGroup":"Back", "options":["ring","string"]},
    ]}
    assert validate_group_compatibility(data, observations)


def test_tag_values_without_group_identity_are_rejected():
    import pytest
    from tool.server.test_wildcard_contract import validate_group_compatibility
    with pytest.raises(ValueError, match="annotationGroup"):
        validate_group_compatibility({"wildcard":"{triangle|teardrop}", "variationGroups":[
            {"label":"Shape", "options":["triangle","teardrop"]}
        ]}, {"Shape":[["triangle"],["teardrop"]]})
