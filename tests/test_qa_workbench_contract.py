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

    assert "✦ Deep QA Scan" in qa
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
    assert "qaWorkbenchState.deterministicFindings.concat(ai)" in qa
    assert "currentSignature !== signature" in qa
    assert "inputsChanged" in qa
    assert "qaWorkbenchState.deepScanInputSignature !== inputSignature" in qa
    assert "sourceLabel: 'AI · '" in qa
    assert '@app.route("/fs/qa/deep-scan"' in app
    assert 'enqueue_llm(\n            "qa",' in app
    assert 'if client == "qa":' in runner
    assert '"operation": "qa_deep_scan"' in contract
    assert '"response_schema": _response_schema()' in contract
    assert "window.openAssistant({ mode: 'review-dataset' })" not in qa


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
