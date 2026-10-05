from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def test_focus_caption_reuses_single_item_ui_and_existing_caption_assist():
    html = _read("tool/tool.html")
    focus = _read("tool/js/focused_caption.js")
    primer = _read("tool/js/primer_settings.js")

    assert 'id="preview-open-focus-caption-btn"' in html
    assert 'id="preview-focus-caption-skip-btn"' in html
    assert 'src="/static/js/focused_caption.js"' in html
    assert html.index('src="/static/js/primer_settings.js"') < html.index('src="/static/js/focused_caption.js"')
    assert "runCaptionAssist();" in focus
    assert "/caption/assist" not in focus
    assert "saveCaptionDirect(state.folder, mediaItem.fileName, nextCaption, mediaItem.key" in primer


def test_focus_caption_snapshots_current_visible_scope_once():
    focus = _read("tool/js/focused_caption.js")

    assert "getFilteredMediaItems(false)" in focus
    assert "focusedCaptionState.itemKeys = itemKeys;" in focus
    assert "focusedCaptionState.itemKey = itemKeys[0];" in focus
    assert "return navigateFocusedCaptionToIndex(focusedCaptionState.itemIndex + 1);" in focus
    assert "getFilteredMediaItems(false)" not in focus.split("function advanceFocusedCaption()", 1)[1]


def test_focus_caption_accept_is_safe_with_captionless_filter():
    primer = _read("tool/js/primer_settings.js")
    media = _read("tool/js/media.js")

    start = primer.index("function useCaptionAssistCandidate()")
    end = primer.index("function dismissCaptionAssistCandidate()", start)
    use_candidate = primer[start:end]

    assert "if (!isFocusedCaptionOpen())" in use_candidate
    assert "skipRenderFileList: true" in use_candidate
    assert "return advanceFocusedCaption();" in use_candidate
    assert "if (isFocusedCaptionOpen())" in media
    assert "syncFocusedCaptionSelection(mediaItem.key);" in media


def test_focus_caption_candidate_actions_preserve_normal_editor_behavior():
    primer = _read("tool/js/primer_settings.js")

    start = primer.index("function useCaptionAssistCandidate()")
    end = primer.index("function dismissCaptionAssistCandidate()", start)
    use_candidate = primer[start:end]

    assert "applyEditorTextAndTriggerInput(nextCaption);" in use_candidate
    assert "AI caption candidate moved into the editor." in use_candidate

    dismiss_start = primer.index("function dismissCaptionAssistCandidate()")
    dismiss_end = primer.index("function wireStatsPrimerAutoSave()", dismiss_start)
    dismiss_candidate = primer[dismiss_start:dismiss_end]
    assert "if (isFocusedCaptionOpen())" in dismiss_candidate
    assert "AI caption candidate dismissed." in dismiss_candidate


def test_focus_caption_and_focus_annotation_are_mutually_exclusive():
    focus_caption = _read("tool/js/focused_caption.js")
    focus_annotation = _read("tool/js/focused_annotation.js")

    assert "if (isFocusedAnnotationOpen())" in focus_caption
    assert "stopFocusedAnnotation();" in focus_caption
    assert "if (isFocusedCaptionOpen())" in focus_annotation
    assert "stopFocusedCaption('Focus Caption ended.');" in focus_annotation


def test_focus_caption_progress_is_visible_without_new_workspace_surface():
    css = _read("tool/css/workspace_shell.css")
    focus = _read("tool/js/focused_caption.js")

    assert "Caption ' + (focusedCaptionState.itemIndex + 1) + ' / ' + focusedCaptionState.itemKeys.length" in focus
    assert ".preview-workflow-actions .review-captions-btn.active" in css
    assert ".review-captions-btn.active .preview-header-btn-label" in css
    assert "setWorkspaceSurface(" not in focus
