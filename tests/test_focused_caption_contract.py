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


def test_focus_review_reuses_focus_caption_shell_without_a_full_scan_or_backend_route():
    html = _read("tool/tool.html")
    focus = _read("tool/js/focused_caption.js")
    primer = _read("tool/js/primer_settings.js")

    assert 'id="preview-open-focus-review-btn"' in html
    assert "function startFocusedReview(targetMediaKey)" in focus
    assert "startFocusedCaption(targetMediaKey, 'review');" in focus
    assert "function buildFocusedReviewCandidate(mediaItem)" in focus
    assert "var captionText = String(mediaItem.caption || '').trim();" in focus
    assert "requestCaptionAssistCandidate(target.item, request" in focus
    review_prefetch = focus.split("if (isFocusedCaptionReviewMode()) {", 1)[1].split("if (!request.model)", 1)[0]
    assert "buildFocusedReviewCandidate(target.item)" in review_prefetch
    assert "requestCaptionAssistCandidate" not in review_prefetch
    assert "/caption/" not in focus
    assert "operation:" not in focus
    assert "isFocusedCaptionReviewMode()" in primer


def test_focus_review_scope_is_existing_saved_captions_only_and_session_ephemeral():
    focus = _read("tool/js/focused_caption.js")

    keys = focus.split("function getFocusedCaptionEntryKeys", 1)[1].split("function syncFocusedCaptionControls", 1)[0]
    assert "if (!reviewMode) return true;" in keys
    assert "return !!String(item.caption || '').trim();" in keys
    assert "No saved captions are available in the current visible scope." in focus
    assert "focusedCaptionState.mode = 'caption';" in focus
    assert "reviewed" not in focus.split("var focusedCaptionState = {", 1)[1].split("};", 1)[0].lower()


def test_focus_review_uses_local_checks_and_optional_item_scoped_vision():
    focus = _read("tool/js/focused_caption.js")

    builder = focus.split("function buildFocusedReviewCandidate", 1)[1].split("function presentFocusedReviewCandidate", 1)[0]
    assert "getCaptionAssistMissingGroups(mediaItem.key)" in builder
    assert "getCaptionAssistOmittedAssignments(" in builder
    assert "getCaptionAssistOmittedCorrections(" in builder

    presenter = focus.split("function presentFocusedReviewCandidate", 1)[1].split("function getNextFocusedCaptionTarget", 1)[0]
    assert "maybeRunCaptionVisionForCandidate(candidate);" in presenter
    assert "loadFocusedCaptionVisionPhrases();" in presenter
    assert "startFocusedCaptionPrefetch(candidate.mediaKey);" in presenter


def test_focus_review_keep_does_not_rewrite_unchanged_caption_and_save_advances_changed_caption():
    primer = _read("tool/js/primer_settings.js")

    use_start = primer.index("function useCaptionAssistCandidate()")
    use_end = primer.index("function cancelCaptionAssistGeneration()", use_start)
    use = primer[use_start:use_end]

    assert "var unchangedReview = isFocusedCaptionReviewMode()" in use
    assert "if (unchangedReview) return true;" in use
    assert "saveCaptionDirect(state.folder, mediaItem.fileName, nextCaption, mediaItem.key" in use
    assert "setStatus(unchangedReview ? 'Caption accepted.' : 'Caption saved.');" in use
    assert "return advanceFocusedCaption();" in use


def test_focus_review_director_rewrite_is_explicit_and_non_destructive_without_model():
    focus = _read("tool/js/focused_caption.js")

    regenerate = focus.split("function regenerateFocusedCaption()", 1)[1].split("function startFocusedCaption", 1)[0]
    assert "if (isFocusedCaptionReviewMode())" in regenerate
    assert "Select a Director model before generating a rewritten review caption." in regenerate
    assert "return runCaptionAssist();" in regenerate
    assert regenerate.index("if (!reviewRequest || !reviewRequest.model)") < regenerate.index("clearCaptionAssistCandidate();")


def test_focus_review_and_focus_caption_share_navigation_but_show_distinct_mode_controls():
    html = _read("tool/tool.html")
    focus = _read("tool/js/focused_caption.js")

    assert 'id="preview-open-focus-caption-btn"' in html
    assert 'id="preview-open-focus-review-btn"' in html
    assert 'id="preview-focus-caption-skip-btn"' in html
    assert "var reviewMode = isFocusedCaptionReviewMode();" in focus
    assert "reviewBtn.classList.toggle('active', focusedCaptionState.open && reviewMode);" in focus
    assert "startBtn.classList.toggle('active', focusedCaptionState.open && !reviewMode);" in focus
    assert "skipBtn.title = reviewMode" in focus
    assert "'Skip this review item without saving edits'" in focus
    assert "skipLabel.textContent = reviewMode ? 'Skip' : 'Next';" in focus
    assert "#preview-open-focus-review-btn" in focus



def test_focus_review_navigation_protects_unsaved_edits_but_explicit_skip_discards():
    focus = _read("tool/js/focused_caption.js")

    assert "function hasFocusedReviewUnsavedChanges()" in focus
    move = focus.split("function moveFocusedCaption(delta, options)", 1)[1].split("function advanceFocusedCaption()", 1)[0]
    assert "hasFocusedReviewUnsavedChanges() && !opts.discardReviewEdits" in move
    assert "Use Save → Next, or Skip to discard them." in move
    assert "return moveFocusedCaption(1, { discardReviewEdits: true });" in focus

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
    assert "var missingGroups = visible ? getCaptionAssistMissingGroups(mediaKey) : [];" in primer
    assert "renderCaptionAssistMissingGroups(missingEl, mediaKey, missingGroups);" in primer
    assert "label.textContent = 'Still unreviewed:';" in primer
    assert "button.textContent = 'N/A';" in primer
    assert "Missing annotations: " not in primer
    assert "preferredCaptionSequence: getPreferredCaptionSequence()" in primer
    assert "renderAppSettingsCaptionSequenceGroups" in settings


def test_caption_assist_unreviewed_na_uses_existing_review_state_without_regeneration():
    primer = _read("tool/js/primer_settings.js")
    css = _read("tool/css/styles.css")

    start = primer.index("function markCaptionAssistGroupNotApplicable")
    end = primer.index("function renderCaptionAssistMissingGroups", start)
    action = primer[start:end]

    assert "setChecklistRequirementCheckedForMediaKey(key, label, true);" in action
    assert "captionAssistCandidate.missingGroups = getCaptionAssistMissingGroups(key);" in action
    assert "syncCaptionAssistCandidateUi();" in action
    assert "runCaptionAssist();" not in action
    assert ".caption-assist-na-btn" in css


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


def test_caption_assist_and_focus_caption_share_the_same_large_modal_presentation():
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
    dialog_css = css.split(".editor-caption-candidate-dialog {", 1)[1].split("}", 1)[0]
    focus_css = css.split(".editor-caption-candidate.is-focus-caption {", 1)[1].split("}", 1)[0]
    header_css = css.split(".editor-caption-candidate-header {", 1)[1].split("}", 1)[0]
    text_css = css.split(".editor-caption-candidate-text {", 1)[1].split("}", 1)[0]
    actions_css = css.split(".editor-caption-candidate-actions button {", 1)[1].split("}", 1)[0]
    assert "position: fixed;" in candidate_css
    assert "width: min(860px, calc(100vw - 32px));" in dialog_css
    assert "min-height: 54px;" in header_css
    assert "font-size: 19px;" in header_css
    assert "font-size: 18px;" in text_css
    assert "line-height: 1.6;" in text_css
    assert "min-height: 37px;" in actions_css
    assert "font-size: 14px;" in actions_css
    assert "left: var(--focus-caption-left);" in focus_css
    assert "width: var(--focus-caption-width);" in focus_css
    assert "height: var(--focus-caption-height);" in focus_css
    assert "overflow: auto;" in text_css
    assert ".editor-caption-candidate.is-focus-caption .editor-caption-candidate-text" not in css
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
    assert "useBtn.textContent = reviewMode" in primer
    assert "'Save → Next'" in primer
    assert "'Keep → Next'" in primer
    assert "regenerateBtn.textContent = '\\u21bb';" in primer
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


def test_caption_vision_supports_video_first_frame_and_keeps_focus_toggle_visible_without_models():
    vision = _read("tool/js/caption_vision.js")

    assert "mp4|webm|ogg|mov|mkv|avi|m4v|wmv|mpg|mpeg" in vision
    assert "function isCaptionVisionVideo(fileName)" in vision
    assert "toggleWrap.classList.toggle('hidden', !candidateVisible || !mediaSupported);" in vision
    assert "toggle.disabled = !modelAvailable;" in vision
    assert "Vision checking first video frame" in vision
    assert "checks run automatically for each caption candidate" in vision
    assert "Vision enabled · no Vision model is currently available." in vision
    assert "Vision enabled · loading Vision models" in vision


def test_standalone_vision_caption_is_preview_adjacent_and_requires_explicit_editor_use():
    html = _read("tool/tool.html")
    vision = _read("tool/js/caption_vision.js")
    runner = _read("tool/server/llm_runner.py")

    focus_annotate = html.index('id="preview-open-focused-btn"')
    focus_caption = html.index('id="preview-open-focus-caption-btn"')
    focus_next = html.index('id="preview-focus-caption-skip-btn"')
    vision_caption = html.index('id="preview-vision-caption-btn"')
    rating = html.index('id="preview-action-rating"')
    assert focus_annotate < focus_caption < focus_next < vision_caption < rating

    assert 'class="btn-glyph vision-caption-binoculars"' in html
    assert 'id="vision-image-caption-modal"' in html
    assert '>Copy</button>' in html
    assert '>Use in Editor</button>' in html
    assert "'/caption/vision-caption'" in vision
    assert "function requestVisionImageCaptionDescription(mediaItem, options)" in vision
    assert "window.requestVisionImageCaptionDescription = requestVisionImageCaptionDescription;" in vision
    run_start = vision.index("function runVisionImageCaption()")
    run_end = vision.index("function copyVisionImageCaption()", run_start)
    assert "assignChecklistTagToMediaKey" not in vision[run_start:run_end]
    assert "applyEditorTextAndTriggerInput(text);" in vision
    assert "function syncVisionImageCaptionSelection(mediaKey)" in vision
    media = _read("tool/js/media.js")
    shell = _read("tool/js/workspace_shell.js")
    assert "syncVisionImageCaptionSelection(mediaItem.key);" in media
    assert "syncVisionImageCaptionSelection('');" in shell
    assert '"vision_caption_extras"' in runner
    assert 'caption_operation in {"caption_vision_validate", "vision_image_caption", "vision_caption_extras", "vision_schema_sight", "vision_vocabulary_sight"}' in runner


def test_focus_caption_orders_warnings_then_editable_caption_then_vision_sight():
    html = _read("tool/tool.html")
    focus = _read("tool/js/focused_caption.js")
    primer = _read("tool/js/primer_settings.js")

    findings = html.index('id="editor-caption-vision-findings"')
    candidate = html.index('id="editor-caption-candidate-text"')
    sight = html.index('id="editor-caption-vision-phrases"')
    assert findings < candidate < sight
    assert "requestVisionCaptionExtras(mediaItem, task.captionText" in focus
    assert "Vision extras" in primer
    assert "fullDescription" not in primer
    assert "insertFocusedCaptionVisionPhrase(phrase)" in primer
    assert "blendFocusedCaptionVisionPhrase(phrase)" in primer


def test_focus_caption_vision_phrases_are_ephemeral_editable_and_one_deep_prefetched():
    html = _read("tool/tool.html")
    focus = _read("tool/js/focused_caption.js")
    primer = _read("tool/js/primer_settings.js")
    css = _read("tool/css/styles.css")

    assert 'id="editor-caption-vision-phrases"' in html
    assert 'id="editor-caption-vision-phrases-btn"' in html
    assert "var focusedCaptionVisionPhrases = {" in focus
    assert "function extractFocusedCaptionVisionPhrases(text)" not in focus
    assert "function createFocusedCaptionVisionPhraseTask(mediaItem, captionText)" in focus
    assert "requestVisionCaptionExtras(mediaItem, task.captionText" in focus
    assert "function loadFocusedCaptionVisionPhrases()" in focus
    assert "phraseTask: null" in focus
    assert "beginFocusedCaptionPrefetchPhrases(prefetch, target.item)" in focus
    assert "cancelFocusedCaptionVisionPhraseTask(prefetch.phraseTask" in focus
    assert "focusedCaptionVisionPhrases.enabled = !!captionVisionEnabled;" in focus
    assert "localStorage" not in focus
    assert "sessionStorage" not in focus

    assert "textEl.setAttribute('contenteditable', visible ? 'true' : 'false');" in primer
    assert "candidateTextEl.__captionAssistEditBound" in primer
    assert "captionAssistCandidate.text = String(candidateTextEl.textContent || '');" in primer
    assert "clearCaptionVisionResult();" in primer
    assert "function insertFocusedCaptionVisionPhrase(phrase)" in primer
    assert "captionAssistCandidate.text = next;" in primer
    assert "insertBtn.addEventListener('pointerdown'" in primer
    assert "loadFocusedCaptionVisionPhrases();" in primer
    assert "isCaptionVisionSupportedMedia(state.currentItem.fileName)" in primer
    assert "Vision extras failed: " in focus
    assert ".caption-vision-phrase-insert" in css


def test_focus_caption_vision_phrase_blend_reuses_caption_assist_without_tag_mutation():
    primer = _read("tool/js/primer_settings.js")

    start = primer.index("function blendFocusedCaptionVisionPhrase(phrase)")
    end = primer.index("function runCaptionAssist()", start)
    blend = primer[start:end]
    assert "request.draft = currentDraft" in blend
    assert "requestCaptionAssistCandidate(mediaItem, request" in blend
    assert "assignChecklistTagToMediaKey" not in blend
    assert "cancelFocusedCaptionPrefetch()" in blend
    assert "startFocusedCaptionPrefetch(sourceMediaKey)" in blend


def test_caption_assist_runs_vision_qa_when_enabled_outside_focus_mode():
    primer = _read("tool/js/primer_settings.js")

    start = primer.index("function runCaptionAssist()")
    end = primer.index("window.repairCaptionAssistCandidate", start)
    run = primer[start:end]
    vision_call = run.index("maybeRunCaptionVisionForCandidate(candidate);")
    focus_branch = run.index("if (isFocusedCaptionOpen()) {")

    assert "if (captionVisionEnabled) {" in run[:focus_branch]
    assert vision_call < focus_branch


def test_focus_vision_checkbox_runs_qa_and_sight_together():
    vision = _read("tool/js/caption_vision.js")
    focus = _read("tool/js/focused_caption.js")
    primer = _read("tool/js/primer_settings.js")

    start = vision.index("function setCaptionVisionEnabled(enabled)")
    end = vision.index("function syncCaptionVisionCapabilitiesFromPayload", start)
    toggle = vision[start:end]
    assert "setFocusedCaptionVisionSightEnabled(true)" in toggle
    assert "loadFocusedCaptionVisionPhrases()" in toggle
    assert "runCaptionVisionForCandidate(captionAssistCandidate)" in toggle
    assert "setFocusedCaptionVisionSightEnabled(false)" in toggle
    assert "focusedCaptionVisionPhrases.enabled = !!captionVisionEnabled;" in focus
    assert "setFocusedCaptionVisionSightEnabled(true);" in primer
    assert "loadFocusedCaptionVisionPhrases();" in primer


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


def test_vision_model_change_refreshes_focus_phrases_and_rebuilds_prefetch_without_qa_toggle():
    vision = _read("tool/js/caption_vision.js")
    focus = _read("tool/js/focused_caption.js")

    start = vision.index("function handleCaptionVisionModelChange()")
    end = vision.index("function wireCaptionVisionUi()", start)
    handler = vision[start:end]
    assert "isFocusedCaptionVisionPhrasesEnabled()" in handler
    assert "clearFocusedCaptionVisionPhrases({ keepEnabled: true });" in handler
    assert "return cancelFocusedCaptionPrefetch();" in handler
    assert "return startFocusedCaptionPrefetch(state.currentItem.key)" in handler
    assert "loadFocusedCaptionVisionPhrases();" in handler
    assert "captionVisionEnabled &&\n      isFocusedCaptionOpen()" not in handler
    assert "window.isFocusedCaptionVisionPhrasesEnabled = isFocusedCaptionVisionPhrasesEnabled;" in focus


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
    assert "showFocusedCaptionToast(label + ' complete" in focus
    assert "if (nextSurface !== 'default' && isFocusedCaptionOpen())" in shell
    assert "if (isFocusedCaptionOpen()) stopFocusedCaption('Focus Caption ended.');" in shell
    assert "--focus-caption-left" in css
    assert ".editor-caption-candidate-text {" in css
    assert ".editor-caption-candidate.is-focus-caption .editor-caption-candidate-text" not in css


def test_focus_caption_enhancements_do_not_change_normal_caption_assist_contract():
    primer = _read("tool/js/primer_settings.js")

    assert "var focusOpen = isFocusedCaptionOpen();" in primer
    assert "var focusVisible = !!(focusOpen && mediaKey);" in primer
    assert "titleEl.textContent = reviewMode ? 'Focus Review' : (focusOpen ? 'Focus Caption' : 'Caption Assist');" in primer
    assert "dismissBtn.textContent = '\\u00d7';" in primer
    assert "if (!isFocusedCaptionOpen()) return runCaptionAssist();" in primer
    assert "if (isFocusedCaptionOpen()) {\n        regenerateFocusedCaption();" in primer
    assert "if (isFocusedCaptionOpen()) {\n        event.preventDefault();" in primer
    assert "applyEditorTextAndTriggerInput(nextCaption);" in primer


def test_normal_caption_assist_has_persistent_generating_presentation():
    primer = _read("tool/js/primer_settings.js")

    assert "var captionAssistPresentationMediaKey = '';" in primer
    assert "function isCaptionAssistPresentationOpenFor(mediaKey)" in primer
    assert "var assistVisible = !!(!focusOpen && mediaKey && isCaptionAssistPresentationOpenFor(mediaKey));" in primer
    assert "var panelVisible = focusVisible || assistVisible;" in primer
    assert "var pending = panelVisible && isCaptionAssistRunning();" in primer
    assert "var loadingVisible = !visible && (focusOpen || pending);" in primer
    assert "loadingEl.classList.toggle('hidden', !loadingVisible);" in primer
    assert "loadingTextEl.textContent = pending ? 'Generating caption…' : 'Preparing caption…';" in primer
    assert "textEl.classList.toggle('hidden', !visible);" in primer
    assert "useBtn.classList.toggle('hidden', !visible);" in primer
    assert "regenerateBtn.classList.toggle('hidden', !visible);" in primer


def test_normal_caption_assist_regenerate_stays_open_and_can_cancel():
    primer = _read("tool/js/primer_settings.js")

    run_start = primer.index("function runCaptionAssist()")
    run_end = primer.index("window.repairCaptionAssistCandidate", run_start)
    run = primer[run_start:run_end]
    assert "if (!focusRequest) captionAssistPresentationMediaKey = sourceMediaKey;" in run
    assert "captionAssistPendingJobId = 'submitting';" in run
    assert "(!focusRequest && !isCaptionAssistPresentationOpenFor(sourceMediaKey))" in run

    wire_start = primer.index("function wirePrimerCaptionResetUi()")
    wire = primer[wire_start:]
    regenerate_start = wire.index("candidateRegenerateBtn.addEventListener")
    regenerate_end = wire.index("if (!focusPrevBtn.__captionAssistBound)", regenerate_start)
    regenerate = wire[regenerate_start:regenerate_end]
    assert "captionAssistCandidate = null;" in regenerate
    assert "syncCaptionAssistCandidateUi();" not in regenerate
    assert "return runCaptionAssistFromUi();" in regenerate

    assert "function cancelCaptionAssistGeneration()" in primer
    assert "if (!isFocusedCaptionOpen()) {\n        cancelCaptionAssistGeneration();" in wire
    assert "if (isCaptionAssistRunning()) return cancelCaptionAssistGeneration();" in primer
    assert "if (!captionAssistCandidate && !isCaptionAssistPresentationOpenFor(mediaKey)) return;" in wire


def test_focus_caption_outside_click_refreshes_list_without_double_handling_backdrop():
    focus = _read("tool/js/focused_caption.js")

    assert "var panel = document.getElementById('editor-caption-candidate');" in focus
    assert "if (panel && panel.contains(event.target)) return;" in focus
    outside_start = focus.index("if (!document.__focusedCaptionOutsideClickBound)")
    outside_end = focus.index("if (!window.__focusedCaptionResizeBound)", outside_start)
    outside = focus[outside_start:outside_end]
    assert "stopFocusedCaption(focusedCaptionModeLabel() + ' ended.');" in outside
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


def test_focus_caption_visual_pass_is_theme_aware_and_compact():
    html = _read("tool/tool.html")
    css = _read("tool/css/styles.css")
    primer = _read("tool/js/primer_settings.js")

    assert 'id="editor-caption-focus-shortcuts"' not in html
    assert 'class="editor-caption-candidate-close"' in html
    assert html.index('id="editor-caption-candidate-dismiss"') < html.index('id="editor-caption-candidate-text"')
    assert 'class="editor-caption-candidate-actions-left"' in html
    assert 'class="editor-caption-candidate-actions-right"' in html
    assert '<span>Vision</span>' in html
    assert 'Enable Vision' not in html
    assert '>Apply Caption</button>' in html

    assert "background: color-mix(in srgb, var(--panel) 98%, transparent);" in css
    assert ".editor-caption-candidate-close {" in css
    assert "min-height: 37px;" in css
    assert ".editor-caption-focus-shortcuts {" not in css
    assert 'html[data-theme="dark"] .editor-caption-candidate-missing' in css

    assert "useBtn.textContent = reviewMode" in primer
    assert "'Save → Next'" in primer
    assert "'Keep → Next'" in primer
    assert "Regenerate caption and recheck Vision" in primer


def test_caption_vision_discards_known_tag_omissions_already_expressed_in_caption():
    vision = _read("tool/js/caption_vision.js")

    assert "function filterCaptionVisionFindings(mediaItem, captionText, findings)" in vision
    assert "String(finding.type || '').toLowerCase() !== 'omitted'" in vision
    assert "checklistGroupTermAppearsInCaptionText(group, term, mediaKey, text)" in vision
    assert "findings: filterCaptionVisionFindings(mediaItem, captionText, vision.findings)" in vision


def test_caption_assist_modal_close_is_header_right_and_vision_is_footer_left():
    html = _read("tool/tool.html")

    header = html.index('class="editor-caption-candidate-header"')
    close = html.index('id="editor-caption-candidate-dismiss"', header)
    body = html.index('id="editor-caption-candidate-text"', header)
    actions = html.index('class="editor-caption-candidate-actions"', body)
    left = html.index('class="editor-caption-candidate-actions-left"', actions)
    vision = html.index('id="editor-caption-vision-toggle-wrap"', left)
    right = html.index('class="editor-caption-candidate-actions-right"', left)

    assert header < close < body
    assert actions < left < vision < right


def test_caption_assist_candidate_is_manually_editable_in_normal_and_focus_modes():
    primer = _read("tool/js/primer_settings.js")
    css = _read("tool/css/styles.css")

    assert "textEl.setAttribute('contenteditable', visible ? 'true' : 'false');" in primer
    assert "textEl.setAttribute('role', visible ? 'textbox' : 'document');" in primer
    assert "captionAssistCandidate.text = String(candidateTextEl.textContent || '');" in primer
    assert "getCaptionAssistOmittedAssignments(" in primer.split("candidateTextEl.addEventListener('input'", 1)[1]
    assert "clearCaptionVisionResult();" in primer.split("candidateTextEl.addEventListener('input'", 1)[1]
    edit_block = primer.split("candidateTextEl.addEventListener('input'", 1)[1].split("if (!visionPhrasesBtn.__focusedCaptionPhrasesBound)", 1)[0]
    assert "clearFocusedCaptionVisionPhrases({ keepEnabled: true });" not in edit_block
    assert '.editor-caption-candidate-text[contenteditable="true"]' in css


def test_focus_caption_vision_extras_use_current_edited_candidate_and_no_prose_dump():
    focus = _read("tool/js/focused_caption.js")
    primer = _read("tool/js/primer_settings.js")
    vision = _read("tool/js/caption_vision.js")

    assert "requestVisionCaptionExtras(mediaItem, task.captionText" in focus
    assert "createFocusedCaptionVisionPhraseTask(mediaItem, captionAssistCandidate.text)" in focus
    assert "prefetch.candidate ? prefetch.candidate.text : ''" in focus
    assert "extractFocusedCaptionVisionPhrases" not in focus
    assert "Vision extras" in primer
    assert "Refresh extras" in primer
    assert "caption-vision-description" not in primer.split("function syncFocusedCaptionVisionPhrasesUi()", 1)[1].split("function syncCaptionAssistCandidateUi()", 1)[0]
    assert "'/caption/vision-extras'" in vision
    assert "window.requestVisionCaptionExtras = requestVisionCaptionExtras;" in vision


def test_inserting_one_vision_extra_keeps_the_remaining_extras_visible():
    primer = _read("tool/js/primer_settings.js")

    start = primer.index("function insertFocusedCaptionVisionPhrase(phrase)")
    end = primer.index("function syncFocusedCaptionVisionPhrasesUi()", start)
    insert = primer[start:end]

    assert "focusedCaptionVisionPhrases.phrases = focusedCaptionVisionPhrases.phrases.filter" in insert
    assert "String(extra || '').trim().toLowerCase() !== value.toLowerCase()" in insert
    assert "clearFocusedCaptionVisionPhrases" not in insert
    assert "syncCaptionAssistCandidateUi();" in insert
    assert "getCaptionAssistOmittedAssignments(" in insert
    assert "clearCaptionVisionResult();" in insert
