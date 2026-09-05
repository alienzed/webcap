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


def test_detail_draft_recomputes_native_fit_and_chart_state_locally():
    root = Path(__file__).parents[1]
    script_path = root / "tool" / "js" / "training_review.js"
    styles = (root / "tool" / "css" / "styles.css").read_text(encoding="utf-8")
    harness = r'''
const fs = require('fs');
const vm = require('vm');
const context = { JSON, Promise, document: { addEventListener() {} } };
vm.createContext(context);
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), context);
function assert(value, message) { if (!value) throw new Error(message); }
const source = { file: 'clip.mp4', width: 640, height: 640, frames: 80, nativeShortEdge: 640, edge: 640, eligible: false };
const prior = { frames: 17 };
let group = context.reviewDistributionGroup([source], [[704, 704]], 'detail', prior);
assert(group.eligibleCount === 0 && group.native[0].assignedTarget.length === 0, '704-only Detail must exclude 640 source');
assert(group.native[0].eligibilityReason.indexOf('Detail does not upscale') !== -1, 'excluded Detail source needs a clear reason');
group = context.reviewDistributionGroup([source], [[704, 704], [512, 512]], 'detail', prior);
assert(group.eligibleCount === 1 && group.native[0].assignedTarget.join(',') === '512,512', 'adding 512 must immediately admit the source');
group = context.reviewDistributionGroup([source], [[704, 704]], 'detail', prior);
assert(group.eligibleCount === 0 && group.native[0].assignedTarget.length === 0, 'removing 512 must immediately exclude the source again');
assert(context.reviewProjectedTarget('temporal', source, [[704, 704]]).join(',') === '704,704', 'non-Detail video fallback must remain');
'''
    result = subprocess.run(
        ["node", "-e", harness, str(script_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "training-review-detail-floor" in (root / "tool" / "js" / "training_review.js").read_text(encoding="utf-8")
    assert ".detail-resolution-ineligible" in styles


def test_bucket_workbench_keeps_category_ratios_nested_and_rung_actions_semantic():
    root = Path(__file__).parents[1]
    script_path = root / "tool" / "js" / "training_review.js"
    script = script_path.read_text(encoding="utf-8")
    styles = (root / "tool" / "css" / "styles.css").read_text(encoding="utf-8")
    harness = r'''
const fs = require('fs');
const vm = require('vm');
const context = { JSON, Promise, document: { addEventListener() {} } };
vm.createContext(context);
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), context);
context.escapeHtml = (value) => String(value);
function assert(value, message) { if (!value) throw new Error(message); }
const ladders = { images: { square: [[736, 416], [672, 384], [608, 352]] }, videos: {} };
let plan = { stages: { h3: { imageBuckets: { square: [[672, 384]] } } }, videoRoles: [] };
assert(context.stepReviewBucket(plan, ladders, 'images', 'square', [672, 384], 1), 'smaller rung must be available');
assert(plan.stages.h3.imageBuckets.square[0].join(',') === '608,352', '+1 must move to the smaller descending-ladder rung');
plan = { stages: { h3: { imageBuckets: { square: [[672, 384]] } } }, videoRoles: [] };
assert(context.stepReviewBucket(plan, ladders, 'images', 'square', [672, 384], -1), 'larger rung must be available');
assert(plan.stages.h3.imageBuckets.square[0].join(',') === '736,416', '-1 must move to the larger descending-ladder rung');
const payload = {
  plan: { stages: { h3: { imageBuckets: { square: [[672, 384]] } } }, videoRoles: [] },
  ladders: ladders,
  distribution: { images: { square: { native: [{ width: 672, height: 384, nativeShortEdge: 384, edge: 384, eligible: true }] } }, videos: {} }
};
const html = context.reviewTargetsHtml(payload, 'images', 'square');
assert(html.includes('aria-label="Decrease one rung"') && html.includes('data-review-step="1"'), 'minus control must decrease to the smaller rung');
assert(html.includes('aria-label="Increase one rung"') && html.includes('data-review-step="-1"'), 'plus control must increase to the larger rung');
assert(!html.includes('Other supported sizes'), 'Add target must not expose the rest of the ladder');
assert((html.match(/training-review-target-chip neutral/g) || []).length <= 4, 'Add target must expose at most four alternatives');
assert(html.indexOf('>736 × 416</button>') < html.indexOf('>608 × 352</button>'), 'Add target must retain canonical descending ladder order');
'''
    result = subprocess.run(
        ["node", "-e", harness, str(script_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "training-review-cohort-row" in script
    assert "training-review-scope-separator" not in script
    assert "Choose up to three. +/− moves a selected target one rung." in script
    assert "reviewCanStepBucket(payload, view, aspect, commonTarget, 1)" in script
    assert "data-review-lower-upscale-target" in script
    assert "stepReviewBucket(plan, payload.ladders || {}, view, aspect, target, 1)" in script
    assert ".training-review-tabs > .training-review-role-pill" in styles
    assert ".training-review-cohort-row" in styles


def test_cohorts_can_skip_targets_and_notices_and_control_tones_are_semantic():
    root = Path(__file__).parents[1]
    script_path = root / "tool" / "js" / "training_review.js"
    styles = (root / "tool" / "css" / "styles.css").read_text(encoding="utf-8")
    harness = r'''
const fs = require('fs');
const vm = require('vm');
const context = { JSON, Promise, document: { addEventListener() {} }, trainingWorkspaceState: { reviewMediaView: 'detail', reviewAspect: '169' } };
vm.createContext(context);
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), context);
context.escapeHtml = (value) => String(value);
context.setStatus = () => {};
function assert(value, message) { if (!value) throw new Error(message); }
let plan = { stages: { h3: { imageBuckets: { square: [[512, 512]] } } }, videoRoles: [] };
assert(context.setReviewBucket(plan, 'images', 'square', [512, 512], false), 'the final target must be removable');
assert(plan.stages.h3.imageBuckets.square.length === 0, 'an AR must retain its existing empty bucket array');
assert(context.setReviewBucket(plan, 'images', 'square', [512, 512], true), 'a target must be addable after skipping the cohort');
const imageSource = { file: 'still.jpg', width: 512, height: 512, nativeShortEdge: 512, edge: 512, eligible: true };
const skippedImage = context.reviewDistributionGroup([imageSource], [], 'images', {});
assert(skippedImage.eligibleCount === 0 && skippedImage.targets.length === 0 && skippedImage.native[0].assignedTarget.length === 0, 'a skipped cohort must have no local assignments or target markers');
assert(skippedImage.native[0].eligibilityReason === 'No enabled bucket for this cohort.', 'skipped images must use the no-enabled-bucket reason');
const restoredImage = context.reviewDistributionGroup(skippedImage.native, [[512, 512]], 'images', skippedImage);
assert(restoredImage.eligibleCount === 1 && restoredImage.native[0].assignedTarget.join(',') === '512,512', 'adding a target back must restore local image assignments');
const skippedChart = context.reviewChartHtml({ plan: { stages: { h3: { imageBuckets: { square: [] } } }, videoRoles: [] }, ladders: { images: { square: [[512, 512]] }, videos: {} }, distribution: { images: { square: skippedImage }, videos: {} } }, 'images', skippedImage, [], 'square');
assert(!skippedChart.includes('training-review-chart-marker') && !skippedChart.includes('training-review-target-zone'), 'a skipped cohort must render no target markers or zones');
const detailSource = { file: 'detail.mp4', width: 1024, height: 576, frames: 40, nativeShortEdge: 576, edge: 576, eligible: true };
const skippedDetail = context.reviewDistributionGroup([detailSource], [], 'detail', { frames: 17 });
assert(skippedDetail.eligibleCount === 0 && skippedDetail.native[0].assignedTarget.length === 0, 'skipped Detail must have no local assignments');
assert(skippedDetail.native[0].eligibilityReason.indexOf('No enabled bucket') !== -1 && skippedDetail.native[0].eligibilityReason.indexOf('lowest selected Detail') === -1, 'skipped Detail must not be described as below its floor');
assert(context.reviewAssignmentWarnings({ images: { square: skippedImage }, videos: { detail: { '169': skippedDetail } } }, []).length === 0, 'skipped cohorts must not create assignment warnings');
const payload = {
  plan: { stages: { h3: { imageBuckets: { square: [[512, 512]] } } }, videoRoles: [{ id: 'detail', enabled: true, frames: 17, buckets: { '169': [[1024, 576], [896, 504], [768, 432]] } }] },
  ladders: { images: { square: [[512, 512]] }, videos: { detail: { '169': [[1024, 576], [896, 504], [768, 432]] } } },
  videoLimits: { detail: { '169': { effectiveCeiling: [1024, 576] } } },
  distribution: { images: { square: { native: [imageSource], targets: [{ shape: [512, 512], assignedCount: 3 }] } }, videos: { detail: { '169': {
    native: [{ file: 'upscale.mp4', width: 700, height: 400, frames: 40, eligible: true, impactBand: 'up20', assignedTarget: [1024, 576] }],
    targets: [{ shape: [1024, 576], assignedCount: 1 }, { shape: [896, 504], assignedCount: 2 }, { shape: [768, 432], assignedCount: 0 }]
  } } } }, warnings: []
};
const notices = context.reviewRailNotices(payload);
assert(notices.some((notice) => notice.type === 'large-upscale'), 'large upscale must remain actionable');
assert(notices.some((notice) => notice.type === 'at-tested-limit'), 'only exact tested limits must remain actionable');
assert(notices.filter((notice) => notice.type === 'lightly-used-target').length === 2, 'one and two assignments must be lightly used');
assert(notices.some((notice) => notice.type === 'unused-target'), 'zero assignments must be unused');
const rail = context.reviewRailHtml(payload);
assert(rail.includes('Large upscale · 1') && rail.includes('At tested limit · 1') && rail.includes('Lightly used targets · 2') && rail.includes('Unused targets · 1'), 'repeated actionable notices must render in compact groups');
assert(!rail.includes('Near tested limit') && !rail.includes('Detail sources excluded') && !rail.includes('Very low Detail target'), 'normal behavior must not appear in Worth noticing');
let targetHtml = context.reviewTargetsHtml(payload, 'detail', '169');
assert(targetHtml.includes('control-pressure-high') && targetHtml.includes('control-pressure-medium'), 'selected controls must expose pressure semantics');
const imageHtml = context.reviewTargetsHtml(payload, 'images', 'square');
assert(imageHtml.includes('control-normal') && !imageHtml.includes('training-review-selected-target target-'), 'normal selected controls must be semantic rather than selection-order colored');
'''
    result = subprocess.run(
        ["node", "-e", harness, str(script_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert ".training-review-selected-target { --review-control: #4f9bdf;" in styles
    assert ".training-review-selected-target.control-pressure-medium { --review-control: #d9a441; }" in styles
    assert ".training-review-selected-target.control-pressure-high { --review-control: #cf5b5b; }" in styles
    assert ".training-review-chart-dot.target-1 { background: #a671e5; }" in styles
    assert ".training-review-chart-marker.target-2 { background: #d96e55; }" in styles


def test_review_rail_uses_the_draft_and_dot_inspection_stays_local():
    root = Path(__file__).parents[1]
    script_path = root / "tool" / "js" / "training_review.js"
    script = script_path.read_text(encoding="utf-8")
    styles = (root / "tool" / "css" / "styles.css").read_text(encoding="utf-8")
    harness = r'''
const fs = require('fs');
const vm = require('vm');
const context = {
  JSON, Promise,
  document: { addEventListener() {} },
  trainingWorkspaceState: { reviewMediaView: 'detail', reviewAspect: '916', reviewInspectedSource: null },
  state: { folder: 'set', items: [], ratings: {} },
  IMAGE_EXTENSIONS: {}
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), context);
context.escapeHtml = (value) => String(value);
context.getRatingForMediaKey = (key) => context.state.ratings[key] || 0;
context.getFileExtension = (name) => '.' + String(name).split('.').pop();
function assert(value, message) { if (!value) throw new Error(message); }
const canonical = {
  plan: { stages: { h3: { imageBuckets: {} } }, videoRoles: [{ id: 'detail', enabled: true, frames: 17, buckets: { '916': [[384, 672]] } }] },
  ladders: { images: {}, videos: { detail: { '916': [[416, 736], [384, 672], [256, 448]] } } },
  videoLimits: { detail: { '916': { effectiveCeiling: [416, 736], automaticDefaultCeiling: [384, 672] } } },
  distribution: { images: {}, videos: { detail: { '916': { frames: 17, native: [{ file: 'clip.mp4', width: 300, height: 400, frames: 20, nativeShortEdge: 300, edge: 300, eligible: false, eligibilityReason: 'Native resolution is below the selected Detail target.' }] } } } },
  warnings: []
};
const draft = JSON.parse(JSON.stringify(canonical));
draft.plan.videoRoles[0].buckets['916'] = [[256, 448]];
const rail = context.reviewRailHtml(draft);
assert(rail.includes('256'), 'rail must render the current draft target');
assert(!rail.includes('384 × 672'), 'rail must not render the stale canonical target');
const modalHtml = context.reviewModalHtml(draft);
assert(modalHtml.includes('training-review-layout') && modalHtml.includes('training-review-rail'), 'modal must render the rail beside the workbench');
assert(!modalHtml.includes('training-review-warnings'), 'warning content must not remain below the main workbench');
let renderCalls = 0;
let saveCalls = 0;
let closeCalls = 0;
const railButton = { getAttribute(name) { return name === 'data-review-rail-view' ? 'detail' : '916'; } };
const modal = { querySelectorAll(selector) { return selector === '[data-review-rail-view]' ? [railButton] : []; } };
context.getTrainingWorkspaceEls = () => ({ reviewModal: {}, reviewModalContent: modal });
context.renderTrainingReview = () => { renderCalls += 1; };
context.trainingReviewRequest = () => { saveCalls += 1; };
context.closeTrainingReviewModal = () => { closeCalls += 1; };
context.bindTrainingReviewModal(draft);
context.trainingWorkspaceState.reviewMediaView = 'images';
context.trainingWorkspaceState.reviewAspect = 'square';
railButton.onclick();
assert(context.trainingWorkspaceState.reviewMediaView === 'detail' && context.trainingWorkspaceState.reviewAspect === '916', 'rail Review and plan rows must navigate to their cohort');
assert(renderCalls === 1 && saveCalls === 0 && closeCalls === 0, 'rail navigation must remain draft-only');
  draft.distribution.videos.detail['916'].native[0].eligible = true;
  draft.distribution.videos.detail['916'].native[0].target = [256, 448];
  draft.distribution.videos.detail['916'].native[0].assignedTarget = [256, 448];
  context.state.items = [{ key: 'clip.mp4', fileName: 'clip.mp4', caption: 'Keep the movement clean.' }];
  context.trainingWorkspaceState.reviewInspectedSource = { view: 'detail', aspect: '916', file: 'clip.mp4' };
  const inspectedRail = context.reviewRailHtml(draft);
  assert(inspectedRail.includes('Source inspector') && inspectedRail.includes('clip.mp4') && inspectedRail.includes('Target'), 'selected dot facts must render in the source inspector');
  assert(inspectedRail.includes('/caption/media?folder=set&media=clip.mp4') && inspectedRail.includes('<video controls playsinline preload="metadata"'), 'video source inspection must reuse the normal media route with native controls');
  assert(inspectedRail.includes('Keep the movement clean.'), 'source inspection must show an existing caption read-only');
  assert(saveCalls === 0 && closeCalls === 0, 'dot inspection must not save, close, or navigate');
'''
    result = subprocess.run(
        ["node", "-e", harness, str(script_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    bindings = script[script.index("function bindTrainingReviewModal"):script.index("function reviewTrainButtonState")]
    dot_bindings = bindings[bindings.index("[data-review-dot-index]"):bindings.index("[data-review-open-dataset]")]
    assert "data-review-rail-view" in bindings
    assert "trainingReviewRequest" not in dot_bindings
    assert "closeTrainingReviewModal" not in dot_bindings
    assert "selectByFileName" not in dot_bindings
    assert "training-review-dot-popover" not in script
    assert "trainingWorkspaceState.reviewInspectedSource" in bindings
    assert "setRatingForMediaKey" in bindings
    assert "pruneMedia(source.mediaItem, { selectReplacement: false })" in bindings
    assert "data-review-close-source" in bindings
    assert "event.key === 'Escape'" in script
    assert "@media (max-width: 980px)" in styles
    assert ".training-review-layout { grid-template-columns: 1fr; }" in styles
    modal_styles = styles[styles.index(".training-review-modal {"):styles.index(".training-review-modal.hidden")]
    assert "align-items: flex-start" in modal_styles
    assert "width: min(1620px, calc(100vw - 36px));" in styles
    assert "grid-template-columns: minmax(0, 1fr) minmax(320px, 400px)" in styles
    assert "removeDisabled" not in script


def test_scale_impact_scope_chart_floor_and_source_refresh_keep_the_draft():
    root = Path(__file__).parents[1]
    script_path = root / "tool" / "js" / "training_review.js"
    harness = r'''
const fs = require('fs');
const vm = require('vm');
const context = {
  JSON, Promise,
  document: { addEventListener() {} },
  trainingWorkspaceState: { reviewMediaView: 'temporal', reviewAspect: '916', reviewImpactScope: 'aspect', reviewInspectedSource: null },
  state: { items: [], ratings: {} }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), context);
context.escapeHtml = (value) => String(value);
function assert(value, message) { if (!value) throw new Error(message); }
const group = {
  impact: { down20: 0, down: 0, near: 1, up: 0, up20: 0 },
  native: [{ file: 'floor.mp4', width: 256, height: 455, nativeShortEdge: 256, edge: 256, eligible: true, assignedTarget: [256, 455] }],
  targets: [{ shape: [256, 455], assignedCount: 1 }]
};
const payload = {
  plan: { stages: { h3: { imageBuckets: {} } }, videoRoles: [{ id: 'temporal', enabled: true, frames: 17, buckets: { '916': [[256, 455]] } }] },
  ladders: { images: {}, videos: { temporal: { '916': [[512, 910], [384, 682], [256, 455]] } } },
  videoLimits: { temporal: { '916': { effectiveCeiling: [512, 910], automaticDefaultCeiling: [384, 682] } } },
  distribution: { images: {}, videos: { temporal: { '916': group } }, impact: { videos: { temporal: { down20: 0, down: 0, near: 3, up: 1, up20: 0 } } } },
  warnings: []
};
let impactHtml = context.reviewImpactHtml(payload, 'temporal', '916');
assert(impactHtml.includes('data-review-impact-scope="aspect"') && impactHtml.includes('>1</b>'), 'impact defaults to the active aspect group');
const emptyImpact = JSON.parse(JSON.stringify(payload));
emptyImpact.distribution.videos.temporal['916'].impact = { down20: 0, down: 0, near: 0, up: 0, up20: 0 };
assert(context.reviewImpactHtml(emptyImpact, 'temporal', '916').includes('No eligible items in this scope.'), 'empty aspect impact must retain its scope control');
context.trainingWorkspaceState.reviewImpactScope = 'all';
impactHtml = context.reviewImpactHtml(payload, 'temporal', '916');
assert(impactHtml.includes('All ratios') && impactHtml.includes('>3</b>'), 'all ratios uses the role aggregate');
const chart = context.reviewChartHtml(payload, 'temporal', group, [[256, 455]], '916');
assert(chart.includes('>256</span>'), 'the first labelled video tick is the floor');
assert(!chart.includes('>192</span>'), 'no artificial pre-floor tick is added when no source is below the floor');
assert(chart.includes('training-review-hist-count') && chart.includes('>1</span>'), 'each populated histogram bar must expose its exact count');
const draft = JSON.parse(JSON.stringify(payload));
draft.plan.videoRoles[0].buckets['916'] = [[384, 682]];
context.trainingWorkspaceState.reviewModalOpen = true;
context.trainingWorkspaceState.reviewDraft = draft;
context.trainingWorkspaceState.reviewDraftDirty = true;
context.trainingWorkspaceState.reviewInspectedSource = { view: 'temporal', aspect: '916', file: 'floor.mp4' };
const refreshed = JSON.parse(JSON.stringify(payload));
refreshed.distribution.videos.temporal['916'].native = [];
context.refreshTrainingReview = () => Promise.resolve(refreshed);
context.recomputeTrainingReviewDistribution = (next) => { next.recomputed = true; };
context.renderTrainingReview = () => {};
(async () => {
  await context.refreshTrainingReviewFactsKeepingDraft();
  assert(context.trainingWorkspaceState.reviewDraft.plan.videoRoles[0].buckets['916'][0].join(',') === '384,682', 'source refresh must preserve the current draft plan');
  assert(context.trainingWorkspaceState.reviewDraft.recomputed, 'source refresh must recompute draft facts');
  assert(context.trainingWorkspaceState.reviewDraftDirty, 'source refresh must preserve unsaved draft state');
  assert(!context.reviewRailHtml(context.trainingWorkspaceState.reviewDraft).includes('Source inspector'), 'a filtered-away source must disappear after refresh');
  assert(context.trainingWorkspaceState.reviewInspectedSource === null, 'a filtered-away source selection must clear');
})().catch((error) => { console.error(error.stack); process.exit(1); });
'''
    result = subprocess.run(
        ["node", "-e", harness, str(script_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def test_source_inspector_uses_image_markup_for_images():
    root = Path(__file__).parents[1]
    script_path = root / "tool" / "js" / "training_review.js"
    harness = r'''
const fs = require('fs');
const vm = require('vm');
const context = {
  JSON, Promise,
  document: { addEventListener() {} },
  trainingWorkspaceState: { reviewInspectedSource: { view: 'images', aspect: '43', file: 'still.jpg' } },
  state: { folder: 'set folder', items: [{ key: 'still.jpg', fileName: 'still.jpg' }], ratings: {} },
  IMAGE_EXTENSIONS: { '.jpg': true }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), context);
context.escapeHtml = (value) => String(value);
context.getRatingForMediaKey = () => 0;
context.getFileExtension = (name) => '.' + String(name).split('.').pop();
const payload = {
  plan: { stages: { h3: { imageBuckets: { '43': [[512, 384]] } } }, videoRoles: [] },
  distribution: { images: { '43': { native: [{ file: 'still.jpg', width: 512, height: 384, eligible: true, assignedTarget: [512, 384] }] } }, videos: {} }
};
const html = context.reviewSourceRailHtml(payload);
if (!html.includes('<img src="/caption/media?folder=set%20folder&media=still.jpg') || html.includes('<video controls')) throw new Error('image source inspection must use image markup and the existing media route');
'''
    result = subprocess.run(
        ["node", "-e", harness, str(script_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
