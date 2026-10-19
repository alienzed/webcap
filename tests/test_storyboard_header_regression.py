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
