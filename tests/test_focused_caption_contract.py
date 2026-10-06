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


def test_caption_assist_surfaces_only_unreviewed_empty_groups_with_candidate():
    html = _read("tool/tool.html")
    primer = _read("tool/js/primer_settings.js")
    settings = _read("tool/js/app_settings.js")

    assert 'id="editor-caption-candidate-missing"' in html
    assert 'id="app-settings-caption-sequence"' in html
    assert 'id="app-settings-caption-sequence-groups"' in html
    assert "getCaptionAssistMissingGroups" in primer
    assert "isChecklistRequirementCheckedForMediaKey(mediaKey, label)" in primer
    assert "return !reviewed;" in primer
    assert "Still unreviewed: " in primer
    assert "Missing annotations: " not in primer
    assert "preferredCaptionSequence: getPreferredCaptionSequence()" in primer
    assert "renderAppSettingsCaptionSequenceGroups" in settings


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
    assert "return advanceFocusedCaption();" not in dismiss_candidate
    assert "Regenerate, edit, or Skip" in dismiss_candidate
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

    assert "'Exit \\u00b7 ' + (focusedCaptionState.itemIndex + 1) + ' / ' + focusedCaptionState.itemKeys.length" in focus
    assert "event.key !== 'Escape'" in focus
    assert ".preview-workflow-actions .review-captions-btn.active" in css
    assert ".review-captions-btn.active .preview-header-btn-label" in css
    assert "setWorkspaceSurface(" not in focus


def test_caption_assist_candidate_is_viewport_modal_and_owns_escape():
    html = _read("tool/tool.html")
    css = _read("tool/css/styles.css")
    primer = _read("tool/js/primer_settings.js")

    overlay_start = html.index('id="app-overlay-root"')
    scripts_start = html.index('<!-- JS load order:')
    candidate_position = html.index('id="editor-caption-candidate"')
    assert overlay_start < candidate_position < scripts_start
    assert 'class="editor-caption-candidate-dialog"' in html
    assert 'role="dialog"' in html
    assert 'aria-modal="true"' in html

    candidate_css = css.split(".editor-caption-candidate {", 1)[1].split("}", 1)[0]
    dialog_css = css.split(".editor-caption-candidate-dialog {", 1)[1].split("}", 1)[0]
    text_css = css.split(".editor-caption-candidate-text {", 1)[1].split("}", 1)[0]
    assert "position: fixed;" in candidate_css
    assert "inset: 0;" in candidate_css
    assert "max-height: calc(100vh - 32px);" in dialog_css
    assert "overflow: hidden;" in dialog_css
    assert "overflow: auto;" in text_css

    assert "if (event.target === candidatePanel) dismissCaptionAssistCandidate();" in primer
    assert "event.stopImmediatePropagation();" in primer
    assert "}, true);" in primer


def test_caption_assist_flags_selected_annotations_omitted_by_candidate():
    html = _read("tool/tool.html")
    css = _read("tool/css/styles.css")
    primer = _read("tool/js/primer_settings.js")

    assert 'id="editor-caption-candidate-omissions"' in html
    assert "function getCaptionAssistOmittedAssignments(mediaKey, captionText, assignments)" in primer
    assert "checklistGroupTermAppearsInCaptionText(group, term, mediaKey, captionText)" in primer
    assert "request.assignments" in primer
    assert "Candidate omitted selected annotations: " in primer
    assert "Caption Assist candidate failed annotation validation." in primer
    assert "useBtn.textContent = omittedAssignments.length ? 'Use anyway' : 'Use';" in primer
    assert "regenerateBtn.textContent = omittedAssignments.length ? 'Regenerate' : '\\u21bb';" in primer
    assert "regenerateBtn.classList.toggle('is-primary', !!omittedAssignments.length);" in primer
    assert ".editor-caption-candidate-omissions {" in css
    assert ".editor-caption-candidate-regenerate.is-primary {" in css
