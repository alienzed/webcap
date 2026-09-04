from pathlib import Path
import subprocess


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


def test_done_button_recovers_after_a_failed_save_and_a_new_modal_session():
    root = Path(__file__).parents[1]
    script_path = root / "tool" / "js" / "training_review.js"
    harness = r'''
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(process.argv[1], 'utf8');
const els = {
  reviewModal: { classList: { add() {}, remove() {} }, setAttribute() {} },
  reviewModalClose: { focus() {} },
  reviewModalDone: { disabled: false },
  review: { querySelector() { return { focus() {} }; } }
};
const context = {
  JSON, Promise, console,
  document: { addEventListener() {} },
  state: { folder: 'set' },
  trainingWorkspaceState: {
    review: { plan: { version: 'saved' } }, reviewDraft: null, reviewDraftDirty: false,
    reviewModalOpen: false, reviewSavePending: 0, reviewSaveStatus: 'saved'
  }
};
vm.createContext(context);
vm.runInContext(source, context);
context.getTrainingWorkspaceEls = () => els;
context.renderTrainingReview = () => {};
context.renderTrainingReviewSaveStatus = () => {};
context.trainingReviewPayload = () => ({ folder: 'set' });
context.isTrainingWorkspaceActive = () => true;
context.setStatus = () => {};
function assert(value, message) { if (!value) throw new Error(message); }
(async () => {
  context.openTrainingReviewModal();
  assert(els.reviewModalDone.disabled === false, 'opening must enable Done');
  const failedDraft = context.trainingWorkspaceState.reviewDraft;
  failedDraft.plan.version = 'draft';
  context.trainingWorkspaceState.reviewDraftDirty = true;
  context.trainingReviewRequest = () => Promise.reject(new Error('save failed'));
  await context.saveTrainingReviewDraft();
  assert(context.trainingWorkspaceState.reviewModalOpen, 'failed save must leave the modal open');
  assert(context.trainingWorkspaceState.reviewDraft === failedDraft, 'failed save must retain the draft');
  assert(context.trainingWorkspaceState.review.plan.version === 'saved', 'failed save must not alter canonical review');
  assert(els.reviewModalDone.disabled === false, 'failed save must re-enable Done');
  context.trainingReviewRequest = () => Promise.resolve({ plan: { version: 'saved-new' } });
  await context.saveTrainingReviewDraft();
  assert(context.trainingWorkspaceState.reviewModalOpen === false, 'successful save must close the modal');
  context.openTrainingReviewModal();
  assert(els.reviewModalDone.disabled === false, 'reopened modal must enable Done');
})().catch((error) => { console.error(error.stack); process.exit(1); });
'''
    result = subprocess.run(
        ["node", "-e", harness, str(script_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
