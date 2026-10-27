"""Regression boundaries for reusable Caption Assist evidence and drafts."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def source(path):
    return (ROOT / path).read_text(encoding="utf-8")


def test_caption_assist_only_requests_unified_sight():
    scan = source("tool/js/set_scan.js")
    primer = source("tool/js/primer_settings.js")
    focus = source("tool/js/focused_caption.js")
    assert "scan_vocabulary_sight" not in scan
    assert "save_vocabulary_sight" not in scan
    assert "context: false" in primer
    assert "context: false" in focus
    assert "refreshSetIntelligenceItem(item, {" in source("tool/js/qa_workbench.js")
    assert "open: 'missing', context: false, silent: true, allowOpenFailure: true" in source("tool/js/qa_workbench.js")


def test_unfinished_candidates_round_trip_through_existing_set_state():
    folder = source("tool/js/folder_state.js")
    primer = source("tool/js/primer_settings.js")
    focus = source("tool/js/focused_caption.js")
    assert folder.count("caption_assist_candidates") >= 3
    assert "captionAssistSavedCandidatesByMedia = Object.assign({}, clean.caption_assist_candidates);" in folder
    assert "persistCaptionAssistCandidate(candidate, false);" in primer
    assert "forgetCaptionAssistCandidate(mediaItem.key);" in primer
    assert "return Promise.resolve(restoreCaptionAssistCandidate(item));" in primer
    assert "if (captionAssistSavedCandidatesByMedia[state.currentItem.key])" in focus


def test_saved_candidate_is_restored_before_starting_any_new_sight_task():
    primer = source("tool/js/primer_settings.js")
    run = primer.split("function runCaptionAssist()", 1)[1].split("function runCaptionAssistAfterSight(", 1)[0]
    assert run.index("if (captionAssistSavedCandidatesByMedia[sourceKey])") < run.index("if (captionAssistSightPreparation)")
    assert run.index("return Promise.resolve(restoreCaptionAssistCandidate(item));") < run.index("refreshSetIntelligenceItem(item, {")


def test_restoring_focus_draft_resumes_one_deep_prefetch_without_regenerating_saved_next_item():
    focus = source("tool/js/focused_caption.js")
    prepare = focus.split("function prepareFocusedCaptionCurrentItem()", 1)[1].split("function syncFocusedCaptionSelection(", 1)[0]
    restore = prepare.split("if (captionAssistSavedCandidatesByMedia[state.currentItem.key])", 1)[1].split("if (isFocusedQaReviewMode())", 1)[0]
    assert "restoreCaptionAssistCandidate(state.currentItem)" in restore
    assert "cancelFocusedCaptionPrefetch().then(function () {" in restore
    assert "startFocusedCaptionPrefetch(restoredKey);" in prepare
    prefetch = focus.split("function startFocusedCaptionPrefetch(sourceMediaKey)", 1)[1].split("function useFocusedCaptionPrefetchForCurrentItem()", 1)[0]
    assert "if (!target || captionAssistSavedCandidatesByMedia[target.itemKey]) return Promise.resolve(false);" in prefetch
    assert prefetch.index("captionAssistSavedCandidatesByMedia[target.itemKey]") < prefetch.index("requestCaptionAssistCandidate(target.item, request")


def test_qa_handoff_reuses_current_caption_alternatives_without_overwriting_saved_drafts():
    qa = source("tool/js/qa_workbench.js")
    saved = qa.split("function qaSavedCaptionAlternative(item)", 1)[1].split("function qaFocusReviewAlternative(", 1)[0]
    assert "qaWorkbenchState.qaAlternatives[item.fileName]" in saved
    assert "qaWorkbenchState.aiItemSignatures[item.fileName] === current[item.fileName]" in saved
    handoff = qa.split("function qaReviewCaptionFiles(files, source, findingId)", 1)[1].split("function qaInspectFinding(", 1)[0]
    assert "var existing = qaSavedCaptionAlternative(target);" in handoff
    assert "if (existing && !captionAssistSavedCandidatesByMedia[target.key])" in handoff
    assert "persistCaptionAssistCandidate({" in handoff
    assert "startFocusedReview(target.key);" in handoff


def test_caption_window_labels_saved_and_preloaded_results_without_new_ui():
    primer = source("tool/js/primer_settings.js")
    focus = source("tool/js/focused_caption.js")
    assert "restoredFromSaved: true," in primer
    assert "candidate.restoredFromSaved ? ' · Saved draft'" in primer
    assert "candidate.prefetched ? ' · Preloaded'" in primer
    assert "candidate.prefetched = true;" in focus


def test_refresh_and_regenerate_still_explicitly_invoke_director():
    primer = source("tool/js/primer_settings.js")
    focus = source("tool/js/focused_caption.js")
    refresh = primer.split("function refreshCaptionAssistFromUi()", 1)[1].split("function wirePrimerCaptionResetUi", 1)[0]
    assert "runCaptionAssistAfterSight(draft)" in refresh
    regen = focus.split("function regenerateFocusedCaption()", 1)[1].split("function startFocusedCaption(", 1)[0]
    assert "refreshCaptionAssistFromUi()" in regen
    assert "runCaptionAssistAfterSight()" in regen
    assert "if (captionAssistCandidate) persistCaptionAssistCandidate(captionAssistCandidate, false);" in focus


def test_saved_candidate_reports_changed_visual_evidence_without_discarding_text():
    primer = source("tool/js/primer_settings.js")
    assert "function captionAssistSightFingerprint(sight)" in primer
    assert "sightFingerprint: String(candidate.sightFingerprint || '')" in primer
    assert "saved.sightFingerprint !== captionAssistSightFingerprint(request.openSight)" in primer
    assert "'Saved caption candidate restored; inputs changed. Refresh Caption if needed.'" in primer
