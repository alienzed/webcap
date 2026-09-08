from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_candidate_modal_is_loaded_and_available_from_running_and_recent_runs():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    runner = (ROOT / "tool" / "js" / "training_runner_ui.js").read_text(encoding="utf-8")
    history = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")
    workspace = (ROOT / "tool" / "js" / "training_workspace.js").read_text(encoding="utf-8")

    assert 'id="training-candidates-modal"' in html
    assert 'id="training-candidates-open-run"' in html
    assert '/static/js/training_candidates.js' in html
    assert 'data-training-candidates=' in runner
    assert 'data-training-history-candidates=' in history
    assert workspace.count('openTrainingCandidates(') >= 3


def test_candidate_ui_is_manual_read_only_charting():
    script = (ROOT / "tool" / "js" / "training_candidates.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert "function refreshTrainingCandidates()" in script
    assert "/fs/training_candidates?folder=" in script
    assert "training-candidates-raw" in script
    assert "training-candidates-step-loss" in script
    assert "training-candidates-step-loss-smoothed" in script
    assert "training-candidates-analysis" in script
    assert "training-candidates-basin" in script
    assert "analysisPoints" in script
    assert "savedArtifacts" in script
    assert "regions" in script
    assert "epochLossPoints" in script
    assert "stepLossPoints" in script
    assert "smoothedStepLossPoints" in script
    assert "detailedSmoothedPoints" not in script
    assert "training-candidates-hover-layer" in script
    assert "Step loss:" in script
    assert "Smoothed step loss:" in script
    assert "training-candidates-tooltip" in script
    assert "training-candidates-open-epoch" in script
    assert "training-candidates-region-summary" in script
    assert "training-candidates-region-coverage" in script
    assert "Saved in region:" in script
    assert "Open Folder" in script
    assert "No confirmed valleys" not in script
    assert "confidence" not in script.lower()
    assert "detector controls" not in script.lower()
    assert "setTimeout" not in script
    assert "training-candidates-modal" in css
    assert "width: min(95vw, 1800px)" in css
    assert '.training-candidates-chart text { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }' in css
    assert ".training-candidates-step-loss-smoothed" in css
