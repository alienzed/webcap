"""Permanent native Test workspace shell: focused parity and placement contracts."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_one_persistent_four_tab_control_outside_native_screens():
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    start = html.index('<nav id="test-workspace-main-tabs"')
    first_screen = html.index('<section id="epoch-finder-screen"')
    assert html.index('<section id="test-generations-pane"') < start < first_screen
    tabs = html[start:html.index("</nav>", start)]
    assert tabs.count('data-test-workspace-mode=') == 4
    for mode in ("tests", "finder", "references", "analytics"):
        assert f'data-test-workspace-mode="{mode}"' in tabs
    assert tabs.index('data-test-workspace-mode="tests"') < tabs.index('data-test-workspace-mode="finder"') < tabs.index('data-test-workspace-mode="references"') < tabs.index('data-test-workspace-mode="analytics"')


def test_original_left_and_right_owners_remain_intact():
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    for marker in ('id="test-generations-body"', 'class="test-generations-rail"',
                   'class="test-generations-results-section"',
                   'id="test-generations-inline-count"', 'id="test-generations-inline-auto-vl"',
                   'id="test-generations-master-select"', 'id="test-generations-sessions-list"',
                   'id="epoch-finder-run-choices"', 'id="epoch-finder-campaigns"',
                   'class="epoch-finder-dashboard"', 'id="epoch-finder-frames"',
                   'id="run-analytics-run-choices"', 'id="run-analytics-table"',
                   'id="test-references-gallery"'):
        assert marker in html, marker


def test_existing_mode_controller_owns_tabs_and_legacy_shell_is_not_default():
    finder = (ROOT / "tool/js/epoch_finder.js").read_text(encoding="utf-8")
    tests = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool/css/epoch_finder.css").read_text(encoding="utf-8")
    assert "document.querySelectorAll('#test-workspace-main-tabs [data-test-workspace-mode]')" in finder
    assert "window.epochFinderShowMode = showMode;" in finder
    assert "window.epochFinderShowMode('tests');" in tests
    assert "var active = button.dataset.testWorkspaceMode === next;" in finder
    assert "showMode(button.dataset.testWorkspaceMode);" in finder
    assert "#test-generations-pane > .epoch-finder-screen > .epoch-finder-layout" in css
    assert "grid-template-columns:var(--test-workspace-sidebar-width) minmax(0,1fr)" in css


def test_persistent_tabs_mask_scrolling_form_at_any_scroll_offset():
    """A transparent tab strip lets labels and inputs bleed through while scrolling."""
    import re
    css = (ROOT / "tool/css/epoch_finder.css").read_text(encoding="utf-8")
    theme = (ROOT / "tool/css/styles.css").read_text(encoding="utf-8")
    nav = re.search(r"#test-workspace-main-tabs\s*\{([^}]*)\}", css)
    assert nav, "Permanent Test tabs have no style block"
    assert "position:absolute" in nav.group(1)
    assert "z-index:6" in nav.group(1)
    assert "background:var(--panel);" in nav.group(1)
    assert "--panel: #ffffff" in theme
    assert "--panel: #151b24" in theme


def test_references_is_a_shared_tab_and_regular_form_starts_with_prompt():
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    test_js = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    nav = html.split('<nav id="test-workspace-main-tabs"', 1)[1].split('</nav>', 1)[0]
    form = html.split('<section class="test-generations-next-run"', 1)[1].split('</section>', 1)[0]
    assert 'data-test-workspace-mode="references"' in nav
    assert '<div class="training-run-option test-generations-prompt">' in form
    assert 'test-generations-form-heading' not in form
    for retired in ('test-generations-summary', 'test-generations-info-btn', 'test-generations-campaign-mode', 'test-workspace-back-to-campaigns', 'test-workspace-manage-references'):
        assert f'id="{retired}"' not in html
        assert f"el('{retired}')" not in test_js
    assert 'id="test-generations-files-count"' in html
