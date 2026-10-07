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
    assert "DETERMINISTIC QA FINDINGS" in contract["prompt"]


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
                }],
            },
            allowed_files=["one.jpg", "two.jpg"],
        )


def test_qa_deep_scan_allows_clean_set_with_zero_findings():
    result = normalize_result(
        {"summary": "No useful semantic issues found.", "findings": []},
        allowed_files=["one.jpg", "two.jpg"],
    )

    assert result == {
        "summary": "No useful semantic issues found.",
        "findings": [],
    }
