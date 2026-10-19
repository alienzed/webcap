"""Permanent native Test workspace shell: focused parity and placement contracts."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_one_persistent_three_tab_control_outside_native_screens():
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    start = html.index('<nav id="test-workspace-main-tabs"')
    first_screen = html.index('<section id="epoch-finder-screen"')
    assert html.index('<section id="test-generations-pane"') < start < first_screen
    tabs = html[start:html.index("</nav>", start)]
    assert tabs.count('data-test-workspace-mode=') == 3
    for mode in ("tests", "finder", "analytics"):
        assert f'data-test-workspace-mode="{mode}"' in tabs
    assert 'data-test-workspace-mode="references"' not in tabs


def test_original_left_and_right_owners_remain_intact():
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    for marker in ('id="test-generations-body"', 'class="test-generations-rail"',
                   'class="test-generations-results-section"',
                   'id="test-generations-inline-count"', 'id="test-generations-inline-auto-vl"',
                   'id="test-generations-master-select"', 'id="test-generations-sessions-list"',
                   'id="epoch-finder-run-choices"', 'id="epoch-finder-campaigns"',
                   'class="epoch-finder-dashboard"', 'id="epoch-finder-frames"',
                   'id="run-analytics-run-choices"', 'id="run-analytics-table"',
                   'id="test-references-gallery"', 'id="test-workspace-manage-references"',
                   'id="test-workspace-back-to-campaigns"'):
        assert marker in html, marker


def test_existing_mode_controller_owns_tabs_and_legacy_shell_is_not_default():
    finder = (ROOT / "tool/js/epoch_finder.js").read_text(encoding="utf-8")
    tests = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool/css/epoch_finder.css").read_text(encoding="utf-8")
    assert "document.querySelectorAll('#test-workspace-main-tabs [data-test-workspace-mode]')" in finder
    assert "window.epochFinderShowMode = showMode;" in finder
    assert "window.epochFinderShowMode('tests');" in tests
    assert "window.epochFinderShowMode('finder');" in tests
    assert "#test-generations-pane > .epoch-finder-screen > .epoch-finder-layout" in css
    assert "grid-template-columns:var(--test-workspace-sidebar-width) minmax(0,1fr)" in css
