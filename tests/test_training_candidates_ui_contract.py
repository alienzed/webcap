from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_candidate_modal_is_loaded_and_available_from_running_and_recent_runs():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    runner = (ROOT / "tool" / "js" / "training_runner_ui.js").read_text(encoding="utf-8")
    history = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")
    workspace = (ROOT / "tool" / "js" / "training_workspace.js").read_text(encoding="utf-8")

    assert 'id="training-candidates-modal"' in html
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
    assert "training-candidates-smoothed" in script
    assert "training-candidates-detailed" in script
    assert "training-candidates-basin" in script
    assert "filter(function (basin) { return basin.confirmed; })" in script
    assert "detailedSmoothedPoints" in script
    assert "epochLossPoints" in script
    assert "setTimeout" not in script
    assert "training-candidates-modal" in css
