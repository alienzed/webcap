from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def test_qa_is_default_review_surface_and_legacy_artifacts_remain_available():
    html = _read("tool/tool.html")
    review = _read("tool/js/review_output.js")
    shell = _read("tool/js/workspace_shell.js")

    assert 'id="qa-workbench"' in html
    assert 'data-review-detail-tab="qa"' in html
    assert 'data-review-detail-tab="captions"' in html
    assert 'id="caption-sheet-text"' in html
    assert 'id="review-media-metadata-panel"' in html
    assert 'id="review-report"' in html
    assert 'id="prune-candidates-pane"' in html
    assert 'id="duplicate-candidates-pane"' in html
    assert "detailTab: 'qa'" in review
    assert "setReviewDetailTab('qa');" in shell


def test_qa_reuses_exact_training_selection_and_keeps_session_state_ephemeral():
    qa = _read("tool/js/qa_workbench.js")

    assert "return getVisibleMediaSelectionForTraining();" in qa
    assert "var qaWorkbenchState = {" in qa
    assert "dispositions: {}" in qa
    assert "trainingFocus: ''" in qa
    assert "folderKey: ''" in qa
    assert "scopeChanged" in qa
    assert "qaWorkbenchState.dispositions = {};" in qa
    assert "qaWorkbenchState.trainingFocus = '';" in qa
    assert "localStorage" not in qa
    assert "sessionStorage" not in qa


def test_qa_focus_inspection_reuses_existing_focus_set_round_trip():
    qa = _read("tool/js/qa_workbench.js")
    review = _read("tool/js/review_output.js")

    assert "qaWorkbenchState.parentFocusSet = qaCloneFocusSet(state.focusSet);" in qa
    assert "selectByFileName(clean[0], clean, source || 'Quality Assurance', 'qa'" in qa
    assert "function returnToQaWorkbenchFromFocusSet()" in qa
    assert "state.focusSet = parent ? qaCloneFocusSet(parent) : null;" in qa
    return_block = qa.split("function returnToQaWorkbenchFromFocusSet()", 1)[1].split("function qaHandleAction", 1)[0]
    assert return_block.index("qaWorkbenchState.view = returnToFinding ? 'browse' : 'overview';") < return_block.index("setWorkspaceSurface('reviewOutput');")
    assert "if (reportType === 'qa')" in review
    assert "returnToQaWorkbenchFromFocusSet();" in review
    assert "if (reportType === 'duplicateCandidates')" in review


def test_qa_deep_scan_is_native_structured_and_merges_into_current_scope():
    qa = _read("tool/js/qa_workbench.js")
    app = _read("tool/server/app.py")
    runner = _read("tool/server/llm_runner.py")
    contract = _read("tool/server/qa_llm_contract.py")

    assert "Start QA & Review" in qa
    assert "qaRunDeepScan();" in qa
    assert "qaStartFocusReview();" in qa
    assert "Run scan only" in qa
    assert "'deep-scan'" in qa
    assert "'/fs/qa/deep-scan'" in qa
    assert "qaBuildDeepScanItems" in qa
    assert "getChecklistAssignmentEntriesForMediaKey" in qa
    assert "getTagsForMediaKey" in qa
    assert "qaBuildCompactAnalysis" in qa
    assert "metadata.face_focus" in qa
    assert "metadata.selection_pose" in qa
    assert "metadata.vision_sight" in qa
    assert "metadata.vision_vocabulary_sight" in qa
    assert "out.contextSight" in qa
    assert "qaBuildVisualAgreementFindings" in qa
    assert "qaPrimeDeterministicSources" in qa
    assert "ensurePruneCandidatesForCurrentFolder(false, scopeFiles)" in qa
    assert "ensureDuplicateCandidatesForCurrentFolder(false, scopeFiles)" in qa
    assert "getSelectionPoseSuggestedTags" in qa
    assert "qaSightSupportsTerm" in qa
    assert "qaWorkbenchState.deterministicFindings.concat(qaWorkbenchState.aiFindings)" in qa
    # Statistical associations can prioritize and inform Deep QA, not become direct recommendations.
    assert "statisticalCandidates: []" in qa
    assert "qaWorkbenchState.deterministicFindings.concat(qaWorkbenchState.statisticalCandidates).forEach" in qa
    assert "qaWorkbenchState.deterministicFindings.concat(qaWorkbenchState.statisticalCandidates).filter" in qa
    assert "files: exceptionFiles.slice()" in qa
    computed = qa.split("function qaComputeFindings(items)", 1)[1].split("function qaGetRecommendations()", 1)[0]
    assert "statisticalCandidates: statisticalCandidates" in computed
    assert ".concat(qaBuildAssociationFindings(items))" not in computed
    assert ".concat(qaBuildUnderrepresentedFindings(items, groups))" not in computed
    assert ".concat(qaBuildOverrepresentedFindings(items, groups))" not in computed
    assert "representationObservations" in computed
    assert "deepScanSessionToken" in qa
    assert "qaCurrentItemSignatureMap" in qa
    assert "qaPendingDeepScanItems" in qa
    assert "qaReconcileAiFindingsToCurrentInputs" in qa
    assert "inputsChanged" in qa
    assert "qaWorkbenchState.deepScanInputSignature !== inputSignature" in qa
    assert "sourceLabel: 'AI · '" in qa
    assert '@app.route("/fs/qa/deep-scan"' in app
    assert 'enqueue_llm(\n            "qa",' in app
    assert 'if client == "qa":' in runner
    assert '"operation": "qa_deep_scan"' in contract
    assert '"response_schema": _response_schema()' in contract
    assert "window.openAssistant({ mode: 'review-dataset' })" not in qa


def test_progressive_qa_freezes_batch_identity_and_invalidates_context_changes():
    qa = _read("tool/js/qa_workbench.js")

    assert "var sessionToken = qaWorkbenchState.deepScanSessionToken;" in qa
    assert "var sessionFolder = String(state.folder || '');" in qa
    assert "var sessionScopeKey = qaBuildScopeKey(qaGetTrainingItems());" in qa
    assert "qaInvalidateDeepScanSession('Deep QA stopped because its review context changed.');" in qa
    assert "qaInvalidateDeepScanSession('Deep QA stopped because the review scope changed.');" in qa
    assert "qaWorkbenchState.deepScanStatus = 'Deep QA stopped.';" in qa
    assert "qaWorkbenchState.deepScanJobId = '';" in qa


def test_qa_isolated_styles_keep_large_editorial_typography():
    html = _read("tool/tool.html")
    css = _read("tool/css/qa_workbench.css")

    assert '/static/css/qa_workbench.css' in html
    assert ".qa-workbench {" in css
    assert "font-size: 17px;" in css
    assert ".qa-page-title {" in css
    assert "font-size: clamp(30px, 3vw, 38px);" in css
    assert ".qa-section-title" in css
    assert ".qa-evidence-strip" in css
    assert "overflow-x: auto;" in css


def test_qa_only_consumes_prune_and_duplicate_results_for_exact_current_scope():
    qa = _read("tool/js/qa_workbench.js")

    assert "state.pruneCandidatesScopeKey !== pruneCandidateScopeKey(scopeFiles)" in qa
    assert "state.duplicateCandidatesScopeKey !== duplicateCandidateScopeKey(scopeFiles)" in qa
    assert "state.pruneCandidatesFolder !== String(state.folder || '')" in qa
    assert "state.duplicateCandidatesFolder !== String(state.folder || '')" in qa


def test_focus_review_only_promotes_current_exact_actions_without_implicit_scan():
    qa = _read("tool/js/qa_workbench.js")
    primer = _read("tool/js/primer_settings.js")
    focused = _read("tool/js/focused_caption.js")

    assert "qaFocusReviewHasAction(mediaKey, item.fileName, caption, finding)" in qa
    assert "captionVisionValidatePatch(captionText, patch)" in qa
    assert "qaFocusReviewTagActionsForFinding" in qa
    assert "tagActions: row.files.map(" in qa
    assert "qaFocusReviewActionableFindings(mediaKey, candidate.text)" in primer
    assert "qaFocusReviewPatches(mediaKey, candidate.text)" in primer
    assert "qaFocusReviewTagActions(mediaKey, captionAssistCandidate.text)" in primer
    assert "if (isFocusedQaReviewMode()) return presentFocusedReviewCandidate(state.currentItem);" in focused
    start = qa.split("function qaStartFocusReview()", 1)[1].split("function renderQaWorkbench(", 1)[0]
    assert "qaRunDeepScan();" not in start
    sync = qa.split("function qaSyncFocusReview()", 1)[1].split("function qaStartFocusReview()", 1)[0]
    assert "qaQueueFocusCandidatePreparation(item);" not in sync


def test_qa_omission_fixes_use_local_tag_and_draft_editing():
    primer = _read("tool/js/primer_settings.js")
    omissions = primer.split("if (omittedAssignments.length) {", 1)[1].split("renderCaptionAssistMissingGroups", 1)[0]
    assert "insertFocusedCaptionVisionPhrase(phrase || entry.term)" in omissions
    assert "removeCaptionAssistAssignedTag(mediaKey, entry.group, entry.term)" in omissions
    assert "repairCaptionAssistCandidate(" not in omissions
    assert "var missingGroups = visible && !isFocusedQaReviewMode()" in primer
    assert "Replace " in _read("tool/js/qa_workbench.js")
