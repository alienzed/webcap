"""Revamp guardrails: existing Test/Batch/Finder/Analytics entry points stay wired until parity is proved."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_unified_revamp_keeps_existing_feature_entry_points():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    for marker in (
        'id="test-generations-run-btn"',
        'id="test-generations-batch-btn"',
        'id="test-generations-batch-auto-vl"',
        'id="test-generations-normal-mode"',
        'id="test-generations-sweep-mode"',
        'id="test-generations-master-select"',
        'id="test-generations-wildcard-btn"',
        'id="test-generations-view-grid-btn"',
        'id="test-generations-view-compare-btn"',
        'id="epoch-finder-run-choices"',
        'id="epoch-finder-epoch-picker"',
        'id="epoch-finder-reference-workspace"',
        'id="epoch-finder-start"',
        'id="epoch-finder-pause"',
        'id="epoch-finder-resume"',
        'id="epoch-finder-stop"',
        'id="run-analytics-screen"',
        'id="test-references-screen"',
    ):
        assert marker in html, f"Revamp lost existing feature entry point: {marker}"


def test_unified_revamp_preserves_server_execution_ownership():
    tests = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    finder = (ROOT / "tool" / "js" / "epoch_finder.js").read_text(encoding="utf-8")
    analytics = (ROOT / "tool" / "js" / "run_analytics.js").read_text(encoding="utf-8")
    assert "/fs/test_generations" in tests
    assert "test-generations-batch-start" in tests
    assert "/fs/epoch_finder" in finder
    assert "pause" in finder and "resume" in finder
    assert "/fs/run_analytics/interpret" in analytics
