import pytest

from tool.server.review_assistant_contract import build_request, normalize_result, render_report


def test_review_dataset_contract_is_read_only_and_evidence_grounded():
    request = build_request([
        {"fileName": "one.jpg", "caption": "subject standing in a kitchen, front view"},
        {"fileName": "two.jpg", "caption": "subject standing in a kitchen, front view"},
        {"fileName": "three.jpg", "caption": "subject sitting outside, side view"},
        {"fileName": "four.jpg", "caption": ""},
    ])

    assert request["operation"] == "analyze_caption_set"
    assert request["output"] == "json"
    assert request["scope"]["total"] == 4
    assert request["scope"]["captioned"] == 3
    assert request["scope"]["missing"] == 1
    assert "[count=2] [files=one.jpg | two.jpg] subject standing in a kitchen" in request["prompt"]
    assert "- four.jpg" in request["prompt"]
    assert "You cannot see the underlying images or videos" in request["prompt"]
    assert "Do not rewrite captions" in request["prompt"]
    assert "focusSets may contain only filenames" in request["prompt"]


def test_review_dataset_contract_allows_missing_caption_only_scope():
    request = build_request([
        {"fileName": "one.jpg", "caption": ""},
        {"fileName": "two.jpg", "caption": "   "},
    ])

    assert request["scope"]["captioned"] == 0
    assert request["scope"]["missing"] == 2
    assert "(no non-empty captions)" in request["prompt"]


def test_review_dataset_result_rejects_invented_focus_set_files():
    with pytest.raises(ValueError, match="invented a focus-set filename"):
        normalize_result({
            "summary": "Mostly consistent.",
            "strengths": [],
            "findings": [],
            "focusSets": [{
                "label": "Inspect",
                "reason": "Check this group.",
                "files": ["not-in-set.jpg"],
            }],
            "conclusion": "Check the flagged group.",
        }, allowed_files=["one.jpg"])


def test_review_dataset_report_renders_normalized_analysis():
    analysis = normalize_result({
        "summary": "The corpus is mostly consistent.",
        "strengths": ["Identity terminology is stable."],
        "findings": [{
            "category": "balance",
            "priority": "medium",
            "title": "Front views dominate",
            "detail": "Side views are much less common.",
            "evidence": ["one.jpg: front view", "two.jpg: front view"],
        }],
        "focusSets": [{
            "label": "View balance",
            "reason": "Inspect the uncommon view captions together.",
            "files": ["three.jpg"],
        }],
        "conclusion": "Review the sparse view examples.",
    }, allowed_files=["one.jpg", "two.jpg", "three.jpg"])

    report = render_report(analysis, scope={
        "total": 3,
        "captioned": 3,
        "missing": 0,
        "uniqueCaptions": 3,
        "minWords": 5,
        "medianWords": 7,
        "maxWords": 9,
    })

    assert "DATASET CAPTION REVIEW" in report
    assert "WHAT LOOKS SOLID" in report
    assert "[MEDIUM] Front views dominate — balance" in report
    assert "POSSIBLE FOCUS SETS" in report
    assert "BOTTOM LINE" in report
