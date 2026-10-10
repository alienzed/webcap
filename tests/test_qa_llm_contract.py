import pytest

from tool.server.qa_llm_contract import build_request, normalize_result


def _items():
    return [
        {
            "fileName": "one.jpg",
            "caption": "subject wearing a red triangle bikini top",
            "groupedTags": [
                {"group": "BT Shape", "term": "triangle"},
                {"group": "Color", "term": "red"},
            ],
            "tags": ["triangle", "red"],
            "analysis": {
                "faceFocus": {"bucket": "medium", "faceCount": 1, "largestHeightPct": 18.0},
                "selectionPose": {"faceDirection": "front", "expression": "neutral", "bodyOrientation": "front", "poseClass": "standing", "armPosition": "down"},
                "sceneComplexity": {"bucket": "simple", "score": 0.2},
                "visionSight": {
                    "model": "vl",
                    "description": "Front standing view of a red triangle top.",
                    "inventory": {"viewpoint": ["front"], "position": ["standing"]},
                },
            },
        },
        {
            "fileName": "two.jpg",
            "caption": "subject wearing a crimson triangle top",
            "groupedTags": [
                {"group": "BT Shape", "term": "triangle"},
                {"group": "Color", "term": "red"},
            ],
            "tags": ["triangle", "red"],
        },
    ]


def test_qa_deep_scan_contract_is_structured_semantic_and_scope_grounded():
    contract = build_request(
        _items(),
        training_focus="Teach bikini design details consistently.",
        deterministic_findings=[{
            "category": "consistency",
            "title": "triangle almost always appears with red",
            "summary": "2 of 2 triangle examples are red.",
            "files": ["one.jpg", "two.jpg"],
        }],
    )

    assert contract["operation"] == "qa_deep_scan"
    assert contract["output"] == "json"
    assert contract["source_files"] == ["one.jpg", "two.jpg"]
    assert contract["response_schema"]["properties"]["findings"]["maxItems"] == 8
    assert "Silence is better than weak advice" in contract["prompt"]
    assert "You cannot see the media" in contract["prompt"]
    assert "Teach bikini design details consistently." in contract["prompt"]
    assert "BT Shape: triangle" in contract["prompt"]
    assert "NORMALIZED VISUAL ANALYSIS" in contract["prompt"]
    assert "Face Focus" in contract["prompt"]
    assert "Vision Sight" in contract["prompt"]
    assert "DETERMINISTIC QA FINDINGS" in contract["prompt"]
    assert "Treat unverified statistical associations as investigation hints" in contract["prompt"]
    assert "QA is about annotation accuracy, not dataset balance" in contract["prompt"]
    assert "If the exception is a legitimate variation, return no finding." in contract["prompt"]


def test_qa_deep_scan_normalizer_rejects_invented_files():
    with pytest.raises(ValueError, match="invented a filename"):
        normalize_result(
            {
                "summary": "One terminology issue.",
                "findings": [{
                    "category": "captioning",
                    "priority": "normal",
                    "confidence": "high",
                    "title": "Color terminology drifts",
                    "summary": "Red and crimson describe the same configured color.",
                    "why": "Splitting one concept across wording may weaken consistency.",
                    "files": ["invented.jpg"],
                    "evidence": ["red / crimson"],
                    "patches": [],
                }],
            },
            allowed_files=["one.jpg", "two.jpg"],
        )


def test_qa_deep_scan_normalizer_validates_exact_caption_patches():
    result = normalize_result(
        {
            "summary": "One exact caption correction.",
            "findings": [{
                "category": "captioning",
                "priority": "normal",
                "confidence": "high",
                "title": "Color wording conflicts",
                "summary": "The caption uses the wrong configured color.",
                "why": "Cached visual evidence and annotations agree on red.",
                "files": ["one.jpg"],
                "evidence": ["Color: red"],
                "patches": [{
                    "file": "one.jpg",
                    "action": "replace",
                    "sourceText": "red",
                    "replacementText": "crimson",
                    "anchorText": "",
                }],
            }],
        },
        allowed_files=["one.jpg"],
        captions_by_file={"one.jpg": "subject wearing a red triangle bikini top"},
    )

    assert result["findings"][0]["patches"][0]["sourceText"] == "red"


def test_qa_deep_scan_schema_keeps_batched_director_out_of_representation_categories():
    contract = build_request(_items())
    category = contract["response_schema"]["properties"]["findings"]["items"]["properties"]["category"]
    assert category["enum"] == ["consistency", "captioning"]


def test_qa_deep_scan_allows_clean_set_with_zero_findings():
    result = normalize_result(
        {"summary": "No useful semantic issues found.", "findings": []},
        allowed_files=["one.jpg", "two.jpg"],
    )

    assert result == {
        "summary": "No useful semantic issues found.",
        "findings": [],
    }

def test_qa_prompt_explains_group_alias_but_preserves_label():
    items = _items()
    items[0]["groupedTags"][0]["alias"] = "Bikini Top Shape"
    contract = build_request(items)
    assert "BT Shape (Bikini Top Shape): triangle" in contract["prompt"]


def test_qa_caption_quality_compares_real_alternative_and_scores_clean_items():
    items = _items()[:1]
    items[0]["candidateCaption"] = "Subject in a red triangle bikini top with metal ring connectors."
    contract = build_request(items, training_focus="Bikini construction details")
    assert "ALTERNATIVE CAPTION: Subject in a red triangle" in contract["prompt"]
    assert "captionQuality" in contract["response_schema"]["required"]
    result = normalize_result(
        {
            "summary": "Caption already covers all important facts.",
            "findings": [],
            "captionQuality": [{
                "file": "one.jpg", "rating": "high", "confidence": "medium",
                "reason": "Distinctive details largely covered."
            }],
        },
        allowed_files=["one.jpg"],
    )
    assert result["findings"] == []
    assert result["captionQuality"][0]["rating"] == "high"
    assert result["captionQuality"][0]["confidence"] == "medium"
