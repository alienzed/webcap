"""Legacy Build/Explore perspective must not appear alongside native Evaluation methods."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_obsolete_perspective_is_not_loaded_or_exposed():
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    tests = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    for obsolete in (
        'data-test-generations-perspective="build"',
        'data-test-generations-perspective="explore"',
        'id="test-unified-workspace"',
        'src="/static/js/test_generations_perspective.js"',
        'src="/static/js/test_generations_unified.js"',
    ):
        assert obsolete not in html
    assert "window.testGenerationsUnifiedNativeRoute()" not in tests
    for preserved in ("test-generations-run-btn", "test-generations-inline-count",
                      "test-generations-sessions-list", "epoch-finder-start",
                      "test-references-gallery", "run-analytics-screen"):
        assert f'id="{preserved}"' in html
