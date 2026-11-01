from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def source(name):
    return (ROOT / name).read_text(encoding="utf-8")


def test_qa_promotes_confirmed_media_problems_not_soft_signals():
    qa = source("tool/js/qa_workbench.js")
    findings = qa.split("function qaComputeFindings(items)", 1)[1].split("function qaGetRecommendations()", 1)[0]
    assert ".concat(qaBuildDuplicateFindings(items))" in findings
    assert ".concat(qaBuildVisualAgreementFindings(items))" in findings
    assert ".concat(qaBuildCaptionFindings(items))" not in findings
    assert ".concat(qaBuildCaptionFindings(items))" in qa
    assert ".concat(qaBuildPruneObservations(items))" in qa
    assert ".concat(qaBuildDuplicateObservations(items))" in qa
    assert "group.match_type === 'exact'" in qa
    assert "return reason.code === 'unsupported_aspect_ratio';" in qa


def test_qa_semantic_findings_require_current_editor_actions():
    qa = source("tool/js/qa_workbench.js")
    merge = qa.split("function qaMergeFindings()", 1)[1].split("function qaReconcileAiFindingsToCurrentInputs()", 1)[0]
    assert "qaFocusReviewHasAction(item.key, file, item.caption || '', finding)" in merge
    assert "qaGetReportObservations()" in qa


def test_qa_action_first_ui_and_compact_uncropped_group_evidence():
    qa = source("tool/js/qa_workbench.js")
    css = source("tool/css/qa_workbench.css")
    browse = qa.split("function qaRenderBrowse(container, items)", 1)[1].split("function qaRenderReportFinding(", 1)[0]
    assert "finding.files.slice(0, 6)" in browse
    assert "article.insertBefore(summary, actions);" in browse
    assert "details.className = 'qa-recommendation-details'" in browse
    assert "qaCreateButton('Dismiss', '', 'dispose', 'keep')" in browse
    assert "qaCreateButton('Skip for now'" not in browse
    assert "qaCreateButton('Keep intentionally'" not in browse
    assert "object-fit: contain;" in css
    assert "qa-optional-check" in css


def test_qa_optional_checks_preserve_existing_routes():
    qa = source("tool/js/qa_workbench.js")
    assert "conceptDetails.appendChild(conceptWrap);" in qa
    assert "'concept-run'" in qa
    assert "'deep-scan'" in qa
    assert "qaSelectFiles(files, source, findingId)" in qa
    assert "returnToQaWorkbenchFromFocusSet()" in qa



def test_deep_qa_corrections_are_action_first_and_caption_assist_remains_separate():
    qa = source("tool/js/qa_workbench.js")
    corrections = qa.split("function qaRenderCorrections(container, items)", 1)[1].split(
        "function qaApplyCorrectionsForItem(mediaKey)", 1
    )[0]
    apply = qa.split("function qaApplyCorrectionsForItem(mediaKey)", 1)[1].split(
        "function renderQaWorkbench(force)", 1
    )[0]
    assert "qaCorrectionItems()" in corrections
    assert "Current caption" in corrections and "Proposed caption" in corrections
    assert "Tag changes" in corrections
    assert "Apply proposed corrections" in corrections
    assert "Inspect in Single Item" in corrections
    assert "captionVisionValidatePatch(caption, patch)" in qa
    assert "captionVisionApplyPatchToText(caption, validated, -1)" in qa
    assert "saveCaptionDirect(folder, item.fileName, plan.captionAfter" in apply
    assert "assignChecklistTagToMediaKey(key, action.group, action.term)" in apply
    assert "unassignChecklistTagFromMediaKey(key, action.group, action.term)" in apply
    assert "qaSetView('corrections')" in qa
    assert "qaApplyCorrectionsForItem(value)" in qa
    assert "startFocusedQaReview(keys)" in qa
    focused = source("tool/js/focused_caption.js")
    assert "function presentFocusedReviewCandidate(mediaItem)" in focused
    assert "function prepareFocusedCaptionCurrentItem()" in focused


def test_deep_qa_correction_apply_uses_existing_freshness_and_reports_failures():
    qa = source("tool/js/qa_workbench.js")
    apply = qa.split("function qaApplyCorrectionsForItem(mediaKey)", 1)[1].split(
        "function renderQaWorkbench(force)", 1
    )[0]
    assert "qaFocusReviewCandidateFindings(item)" in apply
    assert "The Set changed while QA corrections were being applied." in apply
    assert "reportConsoleError('QA Corrections · Apply', err)" in apply
    assert "qaRefreshComputedState(true)" in apply
    assert "Nothing is saved until you apply it." in qa
