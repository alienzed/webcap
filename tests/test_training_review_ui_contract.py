from pathlib import Path


def test_bucket_modal_edits_are_draft_only_until_done():
    root = Path(__file__).parents[1]
    script = (root / "tool" / "js" / "training_review.js").read_text(encoding="utf-8")
    state = (root / "tool" / "js" / "training_workspace_state.js").read_text(encoding="utf-8")

    assert "reviewDraft: null" in state
    assert "reviewDraftDirty: false" in state
    assert "reviewSaveQueue" not in state

    open_modal = script[script.index("function openTrainingReviewModal"):script.index("function saveTrainingReviewDraft")]
    close_modal = script[script.index("function closeTrainingReviewModal"):script.index("function openTrainingReviewModal")]
    bindings = script[script.index("function bindTrainingReviewModal"):script.index("function reviewTrainButtonState")]
    save_draft = script[script.index("function saveTrainingReviewDraft"):script.index("function bindTrainingReviewModal")]

    assert "JSON.parse(JSON.stringify(trainingWorkspaceState.review))" in open_modal
    assert "trainingWorkspaceState.reviewDraft = null" in close_modal
    assert "trainingWorkspaceState.reviewDraftDirty = false" in close_modal
    assert bindings.count("updateTrainingReviewDraft") == 4
    assert "trainingReviewRequest" not in bindings
    assert "saveTrainingReview" not in bindings
    assert "trainingReviewRequest('/fs/training_review/update', request)" in save_draft
    assert "request.plan = JSON.parse(JSON.stringify(draft.plan))" in save_draft


def test_modal_renders_draft_while_summary_renders_canonical_review():
    root = Path(__file__).parents[1]
    script = (root / "tool" / "js" / "training_review.js").read_text(encoding="utf-8")
    render = script[script.index("function renderTrainingReview"):script.index("function renderTrainingReviewSaveStatus")]

    assert "trainingReviewSummaryHtml(canonicalPayload)" in render
    assert "trainingWorkspaceState.reviewModalOpen && trainingWorkspaceState.reviewDraft" in render
    assert "reviewModalHtml(modalPayload)" in render
