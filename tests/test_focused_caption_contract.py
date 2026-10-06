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
    assert "return moveFocusedCaption(1);" in focus
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
    assert "stopFocusedCaption('Focus Caption ended.');" in dismiss_candidate
    assert "renderFileList();" in dismiss_candidate
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
    assert "if (key === 'Escape')" in focus
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
    assert "left: var(--focus-caption-left);" in focus_css
    assert "width: var(--focus-caption-width);" in focus_css
    assert "height: var(--focus-caption-height);" in focus_css
    assert "overflow: auto;" in text_css
    assert "panel.classList.toggle('is-focus-caption'" in primer

    assert "if (event.target !== candidatePanel) return;" in primer
    assert "if (isFocusedCaptionOpen()) {" in primer
    assert "dismissCaptionAssistCandidate();" in primer
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
    assert "Revising caption for " in vision
    assert "visionTask" in focus
    assert "createCaptionVisionTask" in focus
    assert "cancelCaptionVisionTask" in focus
    assert "beginFocusedCaptionPrefetchVision" in focus
    assert "adoptCaptionVisionPrefetch" in focus
    assert "loadCaptionVisionCapabilities();" in focus
    assert "maybeRunCaptionVisionForCandidate(candidate)" in primer


def test_caption_vision_preference_is_config_backed_not_browser_persistent():
    html = _read("tool/tool.html")
    vision = _read("tool/js/caption_vision.js")
    common = _read("tool/js/common.js")
    settings = _read("tool/js/app_settings.js")
    app = _read("tool/server/app.py")

    assert "localStorage" not in vision
    assert "sessionStorage" not in vision
    assert 'id="app-header-vision-model"' in html
    assert 'id="app-settings-vision-model"' in html
    assert "getVisionModelPreference()" in vision
    assert "APP_CONFIG.vision_model" in common
    assert "'/app/config/vision_model'" in common
    assert "out.vision_model = String(out.vision_model || '').trim();" in settings
    assert '@app.route("/app/config/vision_model", methods=["POST"])' in app


def test_caption_vision_lifecycle_is_request_scoped_and_transition_safe():
    vision = _read("tool/js/caption_vision.js")
    focus = _read("tool/js/focused_caption.js")
    primer = _read("tool/js/primer_settings.js")

    assert "var captionVisionActiveTask = null;" in vision
    assert "var captionVisionTaskSequence = 0;" in vision
    assert "task.cancelled = true;" in vision
    assert "captionVisionActiveTask !== task" in vision
    assert "if (task.cancelled) return cancelCaptionAssistJob(task.jobId)" not in vision
    assert "if (!task.cancelled) return null;" in vision
    assert "prefetch.visionTask" in focus
    assert "cancelCaptionVisionTask(prefetch.visionTask, 'Focus Caption Vision')" in focus
    assert "return cancelCurrentCaptionVision().then(function ()" in primer
    assert "candidateRegenerateBtn.addEventListener('click', function () {" in primer


def test_caption_vision_only_sends_selected_or_unreviewed_groups():
    vision = _read("tool/js/caption_vision.js")

    assert "reviewed: isChecklistRequirementCheckedForMediaKey(mediaKey, group)" in vision
    assert "return entry.selected.length > 0 || !entry.reviewed;" in vision


def test_global_vision_selector_is_separate_from_focus_enable_toggle():
    html = _read("tool/tool.html")
    shell = _read("tool/js/workspace_shell.js")
    vision = _read("tool/js/caption_vision.js")

    assert html.index('id="app-header-director-control"') < html.index('id="app-header-vision-control"')
    assert 'id="editor-caption-vision-toggle"' in html
    assert "refreshApplicationVisionModels" in shell
    assert "setVisionModelPreference(String(this.value || ''))" in shell
    assert "webcap:vision-model-changed" in vision
    assert "cancelFocusedCaptionPrefetch()" in vision
    assert "runCaptionVisionForCandidate(captionAssistCandidate)" in vision


def test_caption_omissions_and_vision_share_explicit_fix_path():
    primer = _read("tool/js/primer_settings.js")
    vision = _read("tool/js/caption_vision.js")
    css = _read("tool/css/styles.css")

    assert "function getCaptionAssistOmittedCorrections" in primer
    assert "function repairCaptionAssistCandidate(corrections)" in primer
    assert "request.draft = String(candidate.text || '').trim();" in primer
    assert "request.corrections = cleanCorrections;" in primer
    assert "fixOmissionsBtn.textContent = 'Fix';" in primer
    assert "repairCaptionAssistCandidate(candidate.omittedCorrections || [])" in primer
    assert ".caption-assist-fix-btn {" in css

    assert "function isCaptionVisionKnownTagSelected" in vision
    assert "button.textContent = selected ? 'Fix caption' : 'Apply + fix';" in vision
    assert "assignChecklistTagToMediaKey(mediaKey, group, term);" in vision
    assert "repairCaptionAssistCandidate([{" in vision
    assert "runCaptionAssist();" not in vision.split("function applyCaptionVisionKnownTag", 1)[1].split("function renderCaptionVisionFinding", 1)[0]


def test_caption_fix_is_user_initiated_not_automatic():
    primer = _read("tool/js/primer_settings.js")
    vision = _read("tool/js/caption_vision.js")

    request_start = primer.index("function requestCaptionAssistCandidate")
    request_end = primer.index("function repairCaptionAssistCandidate", request_start)
    assert "repairCaptionAssistCandidate(" not in primer[request_start:request_end]

    bind_start = vision.index("function bindCaptionVisionTaskToCandidate")
    bind_end = vision.index("function runCaptionVisionForCandidate", bind_start)
    assert "repairCaptionAssistCandidate(" not in vision[bind_start:bind_end]


def test_focus_caption_is_immediate_cancelable_keyboard_driven_and_focus_only():
    html = _read("tool/tool.html")
    focus = _read("tool/js/focused_caption.js")
    primer = _read("tool/js/primer_settings.js")
    shell = _read("tool/js/workspace_shell.js")
    css = _read("tool/css/styles.css")

    assert 'id="editor-caption-focus-loading"' in html
    assert 'id="editor-caption-focus-cancel"' in html
    assert 'id="editor-caption-focus-prev"' in html
    assert 'id="editor-caption-focus-next"' in html
    assert "syncCaptionAssistCandidateUi();\n  syncFocusedCaptionPanelGeometry();\n  navigateFocusedCaptionToIndex(0, 1);" in focus
    assert "key === 'ArrowLeft' || key === 'ArrowUp'" in focus
    assert "key === 'ArrowRight' || key === 'ArrowDown' || lower === 's'" in focus
    assert "lower === 'r'" in focus
    assert "armOrUseFocusedCaptionCandidate();" in focus
    assert "Press Enter again to use this caption." in focus
    assert "cancelFocusedCaptionCurrentRequest" in focus
    assert "showFocusedCaptionToast('Focus Caption complete" in focus
    assert "if (nextSurface !== 'default' && isFocusedCaptionOpen())" in shell
    assert "if (isFocusedCaptionOpen()) stopFocusedCaption('Focus Caption ended.');" in shell
    assert "--focus-caption-left" in css
    assert ".editor-caption-candidate.is-focus-caption .editor-caption-candidate-text" in css


def test_focus_caption_enhancements_do_not_change_normal_caption_assist_contract():
    primer = _read("tool/js/primer_settings.js")

    assert "var focusOpen = isFocusedCaptionOpen();" in primer
    assert "var focusVisible = !!(focusOpen && mediaKey);" in primer
    assert "titleEl.textContent = focusOpen ? 'Focus Caption' : 'Caption Assist';" in primer
    assert "dismissBtn.textContent = focusOpen ? 'Exit' : '\\u00d7';" in primer
    assert "if (!isFocusedCaptionOpen()) return runCaptionAssist();" in primer
    assert "if (isFocusedCaptionOpen()) {\n        regenerateFocusedCaption();" in primer
    assert "if (isFocusedCaptionOpen()) {\n        event.preventDefault();" in primer
    assert "applyEditorTextAndTriggerInput(nextCaption);" in primer


def test_focus_caption_outside_click_refreshes_list_without_double_handling_backdrop():
    focus = _read("tool/js/focused_caption.js")

    assert "var panel = document.getElementById('editor-caption-candidate');" in focus
    assert "if (panel && panel.contains(event.target)) return;" in focus
    outside_start = focus.index("if (!document.__focusedCaptionOutsideClickBound)")
    outside_end = focus.index("if (!window.__focusedCaptionResizeBound)", outside_start)
    outside = focus[outside_start:outside_end]
    assert "stopFocusedCaption('Focus Caption ended.');" in outside
    assert "renderFileList();" in outside


def test_caption_vision_enablement_is_runtime_sticky_and_shared_with_caption_assist():
    vision = _read("tool/js/caption_vision.js")
    focus = _read("tool/js/focused_caption.js")

    assert "var captionVisionEnabled = false;" in vision
    assert "captionVisionEnabled = false;" not in focus
    assert "captionAssistCandidate.mediaKey === mediaItem.key" in vision
    assert "captionAssistCandidate.mediaKey === mediaItem.key &&\n    isFocusedCaptionOpen()" not in vision

    run_start = vision.index("function runCaptionVisionForCandidate(candidate)")
    run_end = vision.index("function maybeRunCaptionVisionForCandidate(candidate)", run_start)
    run_vision = vision[run_start:run_end]
    assert "!candidate || !isFocusedCaptionOpen()" not in run_vision
    assert "!captionVisionEnabled || !candidate" in run_vision

    model_start = vision.index("function handleCaptionVisionModelChange()")
    model_end = vision.index("function wireCaptionVisionUi()", model_start)
    model_change = vision[model_start:model_end]
    assert "if (!captionVisionEnabled || !captionAssistCandidate) return false;" in model_change
    assert "if (!captionVisionEnabled || !captionAssistCandidate || !isFocusedCaptionOpen())" not in model_change
