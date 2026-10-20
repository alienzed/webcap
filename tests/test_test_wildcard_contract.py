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
    assert "prioritize" in request["prompt"].lower()
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
    assert "Prioritize the trained subject\'s construction" in prompt
    assert "Pose, hair, setting, lighting and camera are context" in prompt
    assert "separate color, pattern, trim, top shape, and bottom shape" in prompt
    assert "Never emit category placeholders" in prompt


def test_caption_wildcard_result_remains_editable_for_generic_placeholder_options():
    import pytest

    draft = normalize_result({
        "wildcard": "wearing a {micro bikini|various bikini styles}",
        "stableTerms": ["wearing"],
        "variationGroups": [
            {"label": "style", "options": ["micro bikini", "various bikini styles"]},
        ],
    })
    assert "various bikini styles" in draft["wildcard"]


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
    assert "one-time group vocabulary" in prompt
    assert "{brown|black|blonde|ginger} hair" in prompt


def test_large_wildcard_corpus_is_sampled_without_losing_end_of_set():
    captions = ["caption number " + str(i).zfill(3) + " with a garment description."
                for i in range(220)]
    request = build_request(captions)
    prompt = request["prompt"]
    assert "150 representative examples from 220 distinct captions" in prompt
    assert "caption number 000" in prompt
    assert "caption number 219" in prompt
    caption_section = prompt.split("[SET CAPTIONS]\n", 1)[1].split("\n\n[OUTPUT]", 1)[0]
    assert caption_section.count("[count=") == 150
    assert "Observed same-group tag combinations:" not in prompt


def test_verbose_wildcard_corpus_uses_character_budget():
    captions = ["item " + str(i) + " " + ("distinct construction " * 12)
                for i in range(140)]
    request = build_request(captions)
    part = request["prompt"].split("[SET CAPTIONS]\n", 1)[1].split("\n\n[OUTPUT]", 1)[0]
    assert len(part) <= 24000
    assert "item 0 " in part
    assert "item 139 " in part


def test_generated_phrases_keep_optional_group_identity_without_gates():
    draft = normalize_result({
        "wildcard": "wearing {black|red} top, {standing upright|sitting down}",
        "stableTerms": ["top"],
        "variationGroups": [
            {"label": "Top color", "annotationGroup": "BT Color",
             "options": ["black", "red"]},
            {"label": "Position", "annotationGroup": "",
             "options": ["standing upright", "sitting down"]},
        ],
    })
    assert draft["variationGroups"][0]["annotationGroup"] == "BT Color"
    assert draft["variationGroups"][1]["annotationGroup"] == ""


def test_wildcard_schema_does_not_require_every_phrase_to_be_a_set_tag():
    schema = build_request(["A woman wearing a black bikini in a studio."])["response_schema"]
    fields = schema["properties"]["variationGroups"]["items"]
    assert "annotationGroup" in fields["properties"]
    assert "annotationGroup" not in fields["required"]
