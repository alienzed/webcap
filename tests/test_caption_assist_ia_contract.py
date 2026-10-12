"""Focused contract checks for the conservative caption review IA polish."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _source(path):
    return (ROOT / path).read_text(encoding="utf-8")


def test_caption_controls_have_single_owners():
    html = _source("tool/tool.html")
    for element_id in ("editor-caption-details", "editor-caption-evidence",
                       "editor-caption-candidate-regenerate", "editor-caption-candidate-text"):
        assert html.count('id="' + element_id + '"') == 1
    assert html.index('id="editor-caption-details"') < html.index('id="editor-caption-candidate-dismiss"')
    assert html.index('id="editor-caption-candidate-regenerate"') < html.index('id="editor-caption-candidate-text"')


def test_qa_tag_actions_use_the_same_suggestions_surface():
    js = _source("tool/js/primer_settings.js")
    assert "qaFocusReviewTagActions(mediaKey, captionAssistCandidate.text)" in js
    assert "combined.slice(0, qaCount)" in js
    assert "combined.slice(qaCount)" in js
    assert "Saved Sight suggestions (" in js
    assert "addSuggestion(suggestion, 'add')" in js
    assert "qaCaptionReasons" in js
    assert "return !/^(Add tag: |Remove tag: )/.test(reason)" in js


def test_caption_comparison_handles_movement_and_duplicate_counts():
    js = _source("tool/js/primer_settings.js")
    compare = js.split("function captionAssistCompareWords(", 1)[1].split(
        "function renderCaptionAssistComparison(", 1)[0]
    assert "oldBuckets" in compare
    assert "oldMatch[matches.shift()] = true" in compare
    assert "newMatch[index] = true" in compare
    assert "var table = Array.from" not in compare
    assert "return word.toLowerCase().replace(" in compare


def test_focus_review_navigation_keeps_existing_semantics():
    js = _source("tool/js/primer_settings.js")
    assert "moveFocusedCaption(-1)" in js
    assert "moveFocusedCaption(1)" in js
    assert "resolveFocusedQaReviewItem('dismissed')" in js
    assert "useCaptionAssistCandidate()" in js

def test_caption_assist_compact_controls_preserve_editor_and_actions():
    html = _source("tool/tool.html")
    js = _source("tool/js/primer_settings.js")
    css = _source("tool/css/styles.css")
    assert 'id="editor-caption-candidate-regenerate"' in html
    assert 'aria-label="Refresh Caption">↻</button>' in html
    assert "regenerateBtn.textContent = '↻';" in js
    assert "regenerateBtn.setAttribute('aria-busy', pending ? 'true' : 'false');" in js
    assert "insertFocusedCaptionVisionPhrase(phrase || entry.term)" in js
    assert "removeCaptionAssistAssignedTag(mediaKey, entry.group, entry.term)" in js
    assert ".caption-assist-reconcile-list {\n  display: flex;" in css
    assert ".caption-assist-reconcile-row {\n  display: inline-flex;" in css
    assert "padding: 12px 50px 12px 14px;" in css
    assert "padding: 16px 58px 16px 16px;" in css
