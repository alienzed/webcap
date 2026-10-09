"""Regression boundaries for reusable Caption Assist evidence and drafts."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def source(path):
    return (ROOT / path).read_text(encoding="utf-8")


def test_caption_assist_reuses_existing_context_sight():
    scan = source("tool/js/set_scan.js")
    primer = source("tool/js/primer_settings.js")
    focus = source("tool/js/focused_caption.js")
    assert "opts.context === 'missing'" in scan
    assert "context = !row.cached;" in scan
    assert "context: 'missing'" in primer
    assert "context: 'missing'" in focus
    assert "refreshSetIntelligenceItem(batchItems[0], { open: 'missing', context: 'missing', silent: true })" in source("tool/js/qa_workbench.js")


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


def test_refresh_and_regenerate_still_explicitly_invoke_director():
    primer = source("tool/js/primer_settings.js")
    focus = source("tool/js/focused_caption.js")
    refresh = primer.split("function refreshCaptionAssistFromUi()", 1)[1].split("function wirePrimerCaptionResetUi", 1)[0]
    assert "runCaptionAssistAfterSight(draft)" in refresh
    regen = focus.split("function regenerateFocusedCaption()", 1)[1].split("function startFocusedCaption(", 1)[0]
    assert "refreshCaptionAssistFromUi()" in regen
    assert "runCaptionAssistAfterSight()" in regen
    assert "if (captionAssistCandidate) persistCaptionAssistCandidate(captionAssistCandidate, false);" in focus
