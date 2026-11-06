"""Bounded, file-grounded statistical discovery remains advisory in Deep QA."""
from tool.server.qa_llm_contract import build_set_review_request


def _request(candidates, sight=None):
    return build_set_review_request(
        [
            {"fileName": "a.jpg", "groupedTags": [{"group": "View", "term": "rear"}]},
            {"fileName": "b.jpg", "groupedTags": [{"group": "View", "term": "front"}]},
        ],
        statistical_candidates=candidates,
        sight_records=sight or [],
    )


def test_statistical_hypotheses_are_bounded_to_real_exception_files():
    candidates = [
        {"title": "Strong pair", "summary": "69/70", "files": ["a.jpg", "missing.jpg", "b.jpg"]},
        {"title": "Another pair", "summary": "28/29", "files": ["b.jpg"]},
        {"title": "Third pair", "summary": "10/11", "files": ["a.jpg"]},
        {"title": "Fourth pair", "summary": "8/9", "files": ["b.jpg"]},
    ]
    prompt = _request(candidates)["prompt"]
    assert '"pattern":"Strong pair"' in prompt
    assert '"pattern":"Fourth pair"' not in prompt
    assert '"file":"missing.jpg"' not in prompt
    assert prompt.count('"savedSight":') == 4
    assert "Find up to FIVE of the most important omissions or inconsistencies" in prompt


def test_sight_is_bound_to_exact_file_and_does_not_verify_other_files():
    prompt = _request(
        [{"title": "View pattern", "summary": "29/30", "files": ["a.jpg", "b.jpg"]}],
        [
            {"file": "a.jpg", "description": "Rear view; face is not visible."},
            {"file": "elsewhere.jpg", "description": "Unrelated description."},
        ],
    )["prompt"]
    assert '"file":"a.jpg","savedSight":"Rear view; face is not visible."' in prompt
    assert '"file":"b.jpg","savedSight":""' in prompt
    assert "Unrelated description." not in prompt
    assert "Correlation" in prompt or "Correlations" in prompt
    assert "never infer or apply tag corrections" in prompt


def test_empty_hypotheses_keep_existing_discovery_schema():
    contract = _request([])
    assert '"statisticalHypotheses":[]' in contract["prompt"]
    assert contract["response_schema"]["properties"]["findings"]["maxItems"] == 5
    assert contract["operation"] == "qa_set_review"
