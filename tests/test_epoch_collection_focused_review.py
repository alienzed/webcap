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


def test_checkpoint_gallery_projects_saved_dimension_ratings(tmp_path, monkeypatch):
    from tool.server import epoch_finder, epoch_test_bench as bench, run_analytics
    from tool.server.folder_state_store import set_media_rating, set_media_dimension_rating

    session = tmp_path / "session-a"
    session.mkdir()
    (session / "same-name.mp4").write_bytes(b"recorded")
    set_media_rating(session / ".webcap_state.json", "same-name.mp4", 5)
    set_media_dimension_rating(session / ".webcap_state.json", "same-name.mp4", "motion", 2)
    item = {
        "id": "test:session-a:same-name.mp4", "source": "test", "session": "session-a",
        "mediaFile": "same-name.mp4", "prompt": "A blue brush",
        "jobId": "run-1", "epoch": 6, "mediaAvailable": True,
    }
    monkeypatch.setattr(epoch_finder, "workspace_gallery", lambda *args, **kwargs: {
        "media": [dict(item)], "total": 1, "resultEpochs": [
            {"jobId": "run-1", "epoch": 6}], "warnings": []
    })
    monkeypatch.setattr(bench, "_session_directory", lambda *args: session)
    monkeypatch.setattr(bench, "_read_status", lambda *args: {
        "session": "session-a", "sourcePrompt": "A {red|blue} brush", "settings": {}
    })
    monkeypatch.setattr(bench, "_project_wildcard_fields", lambda state: state)
    monkeypatch.setattr(bench, "_resolved_wildcard_summary", lambda *args: [
        {"label": "Color", "value": "blue"}
    ])
    monkeypatch.setattr(run_analytics, "report", lambda *args: (_ for _ in ()).throw(ValueError("No run")))
    result = epoch_finder.checkpoint_workspace(tmp_path, "run-1", 6)
    assert result["media"][0]["rating"] == 5
    assert result["media"][0]["dimensionRatings"] == {"motion": 2}
    assert result["media"][0]["wildcards"] == [{"label": "Color", "value": "blue"}]
