"""Results-only checkpoint discovery uses existing Test and Campaign records."""
from pathlib import Path

from tool.server import epoch_finder, epoch_test_bench


def test_results_only_epoch_index_reuses_gallery_and_preserves_legacy_payload(tmp_path, monkeypatch):
    session = tmp_path / "session-1"
    session.mkdir()
    campaign_root = tmp_path / "campaigns"
    campaign_root.mkdir()
    (campaign_root / "abcdef123456").mkdir()
    monkeypatch.setattr(epoch_test_bench, "_session_directories", lambda folder: [session])
    monkeypatch.setattr(epoch_test_bench, "_relative_set_folder", lambda folder: "set-one")
    monkeypatch.setattr(epoch_test_bench, "_read_status", lambda directory: {
        "modelId": "h3", "results": [
            {"mediaFile": "rendered.png", "provenance": {
                "sourceFolder": "set-one", "sourceJobId": "job-a", "sourceEpoch": 9}},
            {"mediaFile": "another.png", "provenance": {
                "sourceFolder": "set-one", "sourceJobId": "job-a", "sourceEpoch": 9}},
            {"mediaFile": "orphan.png", "provenance": {"sourceEpoch": 11}},
            {"mediaFile": "wrong-set.png", "provenance": {
                "sourceFolder": "another-set", "sourceJobId": "job-a", "sourceEpoch": 12}},
            {"error": "failed", "provenance": {
                "sourceFolder": "set-one", "sourceJobId": "job-a", "sourceEpoch": 13}},
        ],
    })
    monkeypatch.setattr(epoch_finder, "_root", lambda folder: campaign_root)
    monkeypatch.setattr(epoch_finder, "_runs", lambda folder: [])
    monkeypatch.setattr(epoch_finder, "_load", lambda folder, name: {
        "id": name, "modelId": "h3", "jobId": "other-job",
        "candidateMap": {
            "0": {"jobId": "job-a", "epoch": 9, "runName": "Run A"},
            "1": {"jobId": "job-a", "epoch": 10, "runName": "Run A"},
            "2": {"jobId": "job-b", "epoch": 2, "runName": "Run B"},
        },
        "units": [
            {"epoch": 0, "frame": "frame.png", "assessment": None},
            {"epoch": 1, "frame": "", "error": "not rendered"},
            {"epoch": 2, "frame": "gone.png", "framePruned": True},
        ],
    })
    original = epoch_finder.workspace_gallery(tmp_path, "h3", limit=1)
    assert "resultEpochs" not in original
    indexed = epoch_finder.workspace_gallery(tmp_path, "h3", limit=1, include_epoch_index=True)
    assert indexed["media"] == original["media"]
    assert indexed["total"] == original["total"]
    assert indexed["resultEpochs"] == [
        {"jobId": "job-a", "epoch": 9, "runName": "Run A",
         "count": 3, "testCount": 2, "campaignCount": 1},
        {"jobId": "job-b", "epoch": 2, "runName": "Run B",
         "count": 1, "testCount": 0, "campaignCount": 1},
    ]
    assert epoch_finder.workspace_gallery(
        tmp_path, "h3", checkpoints=["job-a:10"], include_epoch_index=True
    )["resultEpochs"] == []
    assert epoch_finder.command(tmp_path, "workspace_gallery", {
        "modelId": "h3", "limit": 1, "includeEpochIndex": True
    })["resultEpochs"] == indexed["resultEpochs"]


def test_analytics_epoch_navigator_is_additive():
    root = Path(__file__).resolve().parents[1]
    html = (root / "tool/tool.html").read_text(encoding="utf-8")
    script = (root / "tool/js/run_analytics.js").read_text(encoding="utf-8")
    assert 'id="run-analytics-result-epochs"' in html
    assert "includeEpochIndex:true" in script
    assert "discoverResultEpochs();" in script
    assert "window.runAnalyticsViewEpoch(button.dataset.resultEpochJob" in script
    assert "el('result-epochs').textContent='Open Analytics to discover results.'" in script
    assert "el('run-choices').onchange" in script
    assert "el('analyze').onclick=load;" in script
