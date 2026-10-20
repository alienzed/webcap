"""Shared Epoch Info reads native saved evidence without changing working state."""
from pathlib import Path

from tool.server import epoch_finder, epoch_test_bench, run_analytics


def test_checkpoint_workspace_reads_saved_test_ratings_and_wildcards(tmp_path, monkeypatch):
    result = {"id": "test:s:one.png", "source": "test", "session": "s",
              "mediaFile": "one.png", "jobId": "job-a", "epoch": 12}
    def gallery(*args, **kwargs):
        assert kwargs["checkpoints"] == ["job-a:12"]
        assert kwargs["generated_only"] is True
        return {"media": [dict(result)], "total": 1, "resultEpochs": [
            {"jobId": "job-a", "epoch": 12, "count": 1, "testCount": 1, "campaignCount": 0}],
            "warnings": []}
    monkeypatch.setattr(epoch_finder, "workspace_gallery", gallery)
    monkeypatch.setattr(epoch_test_bench, "_session_directory", lambda *args: tmp_path / "s")
    monkeypatch.setattr(epoch_test_bench, "_read_status", lambda *args: {
        "sourcePrompt": "Scene {red|blue}", "resolvedPrompt": "Scene blue",
        "settings": {"megapixels": 1.2}})
    monkeypatch.setattr(epoch_test_bench, "_session_rating_map", lambda *args: {"one.png": 4})
    monkeypatch.setattr(epoch_test_bench, "_session_vision_state", lambda *args: {
        "byMedia": {"one.png": {"comparison": [{"id": "G1", "result": "match"}]}}})
    monkeypatch.setattr(epoch_test_bench, "_project_wildcard_fields", lambda stored: {
        **stored, "wildcardSummary": ["blue"]})
    monkeypatch.setattr(run_analytics, "report", lambda *args: {
        "run": {"label": "Run A"}, "testPoints": [{"epoch": 12, "manual": 4,
        "manualCount": 1, "testVl": 1, "testVlCount": 1}],
        "campaigns": [], "lossPoints": [{"epoch": 12, "loss": .1}],
        "selectedEpoch": 12, "warnings": []})
    output = epoch_finder.checkpoint_workspace(tmp_path, "job-a", 12)
    assert output["media"][0]["rating"] == 4
    assert output["media"][0]["assessment"]["comparison"][0]["result"] == "match"
    assert output["media"][0]["wildcards"] == ["blue"]
    assert output["summary"]["manualAverage"] == 4
    assert output["training"]["lossPoints"] == [{"epoch": 12, "loss": .1}]


def test_shared_inspector_is_mounted_in_both_right_panes():
    root = Path(__file__).resolve().parents[1]
    html = (root / "tool/tool.html").read_text(encoding="utf-8")
    javascript = (root / "tool/js/epoch_info.js").read_text(encoding="utf-8")
    assert 'id="test-generations-epoch-info"' in html
    assert 'id="run-analytics-epoch-info"' in html
    assert 'src="/static/js/epoch_info.js"' in html
    assert "window.epochInfoOpen" in javascript
    assert "window.runAnalyticsViewEpoch" in javascript
    assert "window.epochInfoShowSession" in javascript
    assert "test_rate_result" in javascript
