"""Phase 1 Test Generations perspective must be reversible and non-destructive."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def test_explore_perspective_preserves_existing_workspace():
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    js = (ROOT / "tool/js/test_generations_perspective.js").read_text(encoding="utf-8")
    css = (ROOT / "tool/css/styles.css").read_text(encoding="utf-8")
    assert 'data-test-generations-perspective="build"' in html
    assert 'data-test-generations-perspective="explore"' in html
    assert html.index('src="/static/js/epoch_finder.js"') < html.index('src="/static/js/test_generations_perspective.js"')
    assert "body.classList.toggle('test-generations-explore'" in js
    assert "select('build')" in js
    assert ".test-generations-explore .test-generations-next-run" in css
    assert ".test-generations-explore .test-generations-staged-panel" in css
    assert ".test-generations-explore .test-generations-sessions" not in css
    for old in ('id="test-generations-run-btn"', 'id="test-generations-inline-count"', 'id="test-generations-sessions-list"', 'id="epoch-finder-start"'):
        assert old in html
