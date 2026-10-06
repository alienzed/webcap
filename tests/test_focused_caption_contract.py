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
    assert "typeof isChecklistRequirementCheckedForMediaKey" not in primer
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


def test_caption_assist_candidate_becomes_right_side_focus_panel_and_owns_escape():
    html = _read("tool/tool.html")
    css = _read("tool/css/styles.css")
    primer = _read("tool/js/primer_settings.js")

    overlay_start = html.index('id="app-overlay-root"')
    scripts_start = html.index('<!-- JS load order:')
    candidate_position = html.index('id="editor-caption-candidate"')
    assert overlay_start < candidate_position < scripts_start
    assert 'class="editor-caption-candidate-dialog"' in html
    assert 'id="editor-caption-vision-toggle"' in html
    assert 'id="editor-caption-vision-findings"' in html

    candidate_css = css.split(".editor-caption-candidate {", 1)[1].split("}", 1)[0]
    focus_css = css.split(".editor-caption-candidate.is-focus-caption {", 1)[1].split("}", 1)[0]
    text_css = css.split(".editor-caption-candidate-text {", 1)[1].split("}", 1)[0]
    assert "position: fixed;" in candidate_css
    assert "left: 50vw;" in focus_css
    assert "width: 50vw;" in focus_css
    assert "overflow: auto;" in text_css
    assert "panel.classList.toggle('is-focus-caption'" in primer

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


def test_caption_assist_offscreen_request_uses_target_item_draft():
    primer = _read("tool/js/primer_settings.js")
    media = _read("tool/js/media.js")

    assert "function getCaptionAssistDraftForMediaItem(mediaItem)" in primer
    assert "state.currentItem.key === mediaKey && ui && ui.editorEl" in primer
    assert "var savedCaption = String(mediaItem.caption || '');" in primer
    assert "buildAutoPrimer(mediaItem.fileName, mediaKey)" in primer
    assert "draft: getCaptionAssistDraftForMediaItem(mediaItem)" in primer
    assert "function captionAssistRequestFingerprint(mediaItem, request)" in primer
    assert "ui.editorEl.value = nextEditorValue;" in media


def test_caption_assist_submission_is_reusable_for_prefetch():
    primer = _read("tool/js/primer_settings.js")

    assert "function requestCaptionAssistCandidate(mediaItem, request, options)" in primer
    assert "function cancelCaptionAssistJob(jobId)" in primer
    assert "operation: 'cancel_job'" in primer
    assert "requestFingerprint: captionAssistRequestFingerprint(mediaItem, request)" in primer
    assert "function captionAssistRequestFingerprint(mediaItem, request)" in primer
    assert "mediaKey: String(mediaItem && mediaItem.key || '')" in primer
    assert "if (isFocusedCaptionOpen()) startFocusedCaptionPrefetch(sourceMediaKey);" in primer
    assert "function runCaptionAssistFromUi()" in primer
    assert "return cancelFocusedCaptionPrefetch().then(function ()" in primer


def test_focus_caption_prefetch_is_one_deep_request_validated_and_ephemeral():
    focus = _read("tool/js/focused_caption.js")

    assert "var focusedCaptionPrefetch = null;" in focus
    assert "function getNextFocusedCaptionTarget(fromIndex)" in focus
    assert "for (var index = start + 1; index < focusedCaptionState.itemKeys.length; index += 1)" in focus
    assert "function startFocusedCaptionPrefetch(sourceMediaKey)" in focus
    assert "function useFocusedCaptionPrefetchForCurrentItem()" in focus
    assert "requestCaptionAssistCandidate(target.item, request" in focus
    assert "captionAssistRequestFingerprint(target.item, request)" in focus
    assert "captionAssistRequestFingerprint(state.currentItem, latestRequest) !== prefetch.fingerprint" in focus
    assert "candidate.missingGroups = getCaptionAssistMissingGroups(candidate.mediaKey);" in focus
    assert "focusedCaptionPrefetch = null;" in focus
    assert "localStorage" not in focus
    assert "sessionStorage" not in focus


def test_focus_caption_prefetch_is_cancelled_at_lifecycle_boundaries():
    focus = _read("tool/js/focused_caption.js")

    assert "function cancelFocusedCaptionPrefetch()" in focus
    assert "return cancelCaptionAssistJob(prefetch.jobId)" in focus
    assert "prefetch.discarded = true;" in focus
    assert "captionAssistPendingJobId === 'prefetch'" in focus
    assert "if (prefetch.discarded) return cancelCaptionAssistJob(prefetch.jobId);" in focus
    assert focus.count("cancelFocusedCaptionPrefetch();") >= 2


def test_focus_caption_prefetch_failures_reach_global_console():
    focus = _read("tool/js/focused_caption.js")

    assert "reportConsoleWarning('Focus Caption', 'Could not cancel speculative Caption Assist job:" in focus
    assert "reportConsoleError('Focus Caption', err);" in focus
    assert "console.warn('[Focus Caption]" not in focus


def test_focus_caption_vision_is_opt_in_actionable_and_one_deep():
    html = _read("tool/tool.html")
    vision = _read("tool/js/caption_vision.js")
    focus = _read("tool/js/focused_caption.js")
    primer = _read("tool/js/primer_settings.js")

    assert 'id="editor-caption-vision-toggle"' in html
    assert "var captionVisionEnabled = false;" in vision
    assert "requestCaptionVisionCandidate" in vision
    assert "assignChecklistTagToMediaKey(mediaKey, group, term)" in vision
    assert "Refreshing caption suggestion" in vision
    assert "visionJobId" in focus
    assert "visionPromise" in focus
    assert "beginFocusedCaptionPrefetchVision" in focus
    assert "adoptCaptionVisionPrefetch" in focus
    assert "loadCaptionVisionCapabilities();" in focus
    assert "maybeRunCaptionVisionForCandidate(candidate)" in primer


def test_caption_vision_has_no_browser_persistence_or_new_setting():
    vision = _read("tool/js/caption_vision.js")
    settings = _read("tool/js/app_settings.js")

    assert "localStorage" not in vision
    assert "sessionStorage" not in vision
    assert "vision_model" not in settings
    assert "caption_vision" not in settings
