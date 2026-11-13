"""Epoch collection Focused Review must preserve native Test rating identity."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_epoch_review_reuses_existing_activity_and_scopes_source():
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    explorer = (ROOT / "tool/js/run_analytics.js").read_text(encoding="utf-8")
    tests = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    assert 'id="run-analytics-epoch-media-focus"' in html
    assert 'id="test-generations-review"' in html
    assert "window.testGenerationsOpenEpochFocusedReview = openEpochReview" in tests
    assert "window.testGenerationsOpenEpochFocusedReview(folder,scope.jobId,scope.epoch" in explorer
    assert "operation:'checkpoint_workspace'" in tests
    assert "limit:96,offset:offset" in tests
    assert "next < Number(data.total || 0)" in tests
    assert "return reviewScope ? String(result && result.session || '') + '|' + file : file" in tests
    assert "session:savedSession,mediaFile:String(star.dataset.mediaFile || '')" in tests
    assert "advanceReviewToUnrated()" in tests
    assert "reviewRequest('test_rate_result'" in tests


def test_epoch_review_preserves_cross_session_choices_and_campaign_boundary():
    tests = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    server = (ROOT / "tool/server/epoch_finder.py").read_text(encoding="utf-8")
    explorer = (ROOT / "tool/js/run_analytics.js").read_text(encoding="utf-8")
    assert "if (item.source !== 'test') { scope.campaigns++; return; }" in tests
    assert "if (item.mediaAvailable === false) { scope.unavailable++; return; }" in tests
    assert "wildcardValues:item.wildcards || []" in tests
    assert "showAllWildcards: inReview" in tests
    assert "actions: failed || !session || !mediaFile || (inReview && reviewScope) ? []" in tests
    assert "item[\"dimensionRatings\"] = dimensions.get(name, {})" in server
    assert "test_bench._session_dimension_rating_map(directory)" in server
    assert "epochMediaLoad(false)" in explorer
    assert "if (reviewDialogHome) reviewDialogHome.appendChild(this)" in tests
