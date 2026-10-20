from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_storyboard_sequence_and_director_controls_are_visible_and_compact():
    script = (ROOT / "tool/js/storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool/css/storyboard.css").read_text(encoding="utf-8")
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    assert 'id="storyboard-scenes-sequence-btn"' in html
    assert 'id="storyboard-director-tools-btn"' in html
    assert "button.classList.toggle('hidden', item[1] === 'focus' && storyState.sceneViewMode === 'focus')" in script
    marker = "/* Scenes header: no clipped Sequence action or full-width Director Tools button. */"
    assert marker in css
    scoped = css.split(marker, 1)[1]
    assert "overflow: visible" in scoped
    assert ".storyboard-scenes-heading-actions > .review-captions-btn" in scoped
    assert "width: auto" in scoped
    assert "flex-wrap: wrap" in scoped


def test_storyboard_header_summary_and_library_toggle_layout():
    css = (ROOT / "tool/css/storyboard.css").read_text(encoding="utf-8")
    toggle = css.split(".storyboard-library-compact-toggle {", 1)[1].split("}", 1)[0]
    assert "justify-content: center;" in toggle
    assert "font-size: 22px;" in toggle
    summary = css.split(".storyboard-progress-summary {")[-1].split("}", 1)[0]
    assert "max-width: none;" in summary
    actions = css.split("/* Scenes header: no clipped Sequence action or full-width Director Tools button. */", 1)[1]
    assert "margin-left: auto;" in actions.split(".storyboard-scenes-heading-actions {", 1)[1].split("}", 1)[0]
