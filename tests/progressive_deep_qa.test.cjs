'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const qa = fs.readFileSync('tool/js/qa_workbench.js', 'utf8');
function functionSource(name, nextName) {
  const start = qa.indexOf('  function ' + name + '(');
  const end = qa.indexOf('  function ' + nextName + '(', start);
  assert.ok(start >= 0 && end > start, 'Expected adjacent QA functions: ' + name + ' / ' + nextName);
  return qa.slice(start, end);
}
function fixture(currentSignature = 's1') {
  const item = { key: 'a', fileName: 'a.jpg', caption: 'A red shirt.' };
  const state = {
    qaWorkbenchState: {
      aiFindings: [], aiItemSignatures: {}, deepScanSkipped: {},
      captionQuality: {}, deepScanScopeFiles: ['a.jpg'],
      qaReviewMode: 'progressive-v1'
    },
    state: { folder: 'set', items: [item] },
    qaDeepScanScopeItems: () => [item],
    qaCurrentItemSignatureMap: () => ({ 'a.jpg': currentSignature }),
    qaNormalizeAiFindings: analysis => analysis.findings,
    qaFocusReviewHasAction: (_key, file, _caption, finding) =>
      finding.patches.some(patch => patch.file === file) ||
      finding.tagActions.some(action => action.file === file),
    qaMergeAiBatch(findings) { state.qaWorkbenchState.aiFindings.push(...findings); },
    qaRefreshAiCoverage() { state.coverage = true; },
    qaMergeFindings() { state.merged = true; },
    qaSyncFocusReview() { state.queued = true; },
    reportConsoleWarning(_source, _message) { state.warned = true; }
  };
  vm.createContext(state);
  vm.runInContext(
    functionSource('qaDeepScanAcceptBatch', 'qaDeepScanNextItemBatch') +
    '\nthis.accept = qaDeepScanAcceptBatch;',
    state
  );
  const scan = {
    model: 'local::test', vocabulary: [{ group: 'Clothing', terms: ['shirt'] }],
    files: ['a.jpg'], signatures: { 'a.jpg': 's1' }, attempted: {}
  };
  const batch = [{ fileName: 'a.jpg' }];
  const corrective = {
    id: 'qa-a', category: 'captioning', confidence: 'high',
    trainingValue: 'high', files: ['a.jpg'], patches: [{
      file: 'a.jpg', action: 'add', sourceText: '', replacementText: 'A brass fastener.', anchorText: ''
    }],
    tagActions: [
      { file: 'a.jpg', action: 'add', group: 'Clothing', term: 'invented clothing term' },
      { file: 'a.jpg', action: 'add', group: 'Clothing', term: 'shirt' }
    ]
  };
  const analysis = {
    findings: [corrective],
    captionQuality: [{ file: 'a.jpg', rating: 'neutral', confidence: 'high', reason: 'Missing a fastener.' }]
  };
  return { state, scan, batch, analysis };
}

test('item review emits concrete patches and only known-vocabulary tag additions', () => {
  const f = fixture();
  f.state.accept(f.scan, f.batch, f.analysis, 'local::test');
  assert.equal(f.state.qaWorkbenchState.aiFindings.length, 1);
  const action = f.state.qaWorkbenchState.aiFindings[0];
  assert.equal(action.patches.length, 1);
  assert.deepEqual(Array.from(action.tagActions, row => row.term), ['shirt']);
  assert.equal(f.state.qaWorkbenchState.aiItemSignatures['a.jpg'], 's1');
  assert.equal(f.scan.attempted['a.jpg'], true);
  assert.equal(f.state.queued, true);
});

test('a caption or Sight edit during inference never certifies the old input', () => {
  const f = fixture('changed-after-start');
  f.state.accept(f.scan, f.batch, f.analysis, 'local::test');
  assert.equal(f.state.qaWorkbenchState.aiFindings.length, 0);
  assert.equal(f.state.qaWorkbenchState.aiItemSignatures['a.jpg'], undefined);
  assert.equal(f.scan.attempted['a.jpg'], true);
});

test('weak or unactionable observations do not enter the corrections queue', () => {
  const f = fixture();
  f.analysis.findings[0].confidence = 'low';
  f.state.accept(f.scan, f.batch, f.analysis, 'local::test');
  assert.equal(f.state.qaWorkbenchState.aiFindings.length, 0);
  assert.equal(f.state.qaWorkbenchState.aiItemSignatures['a.jpg'], 's1');
});

test('an incomplete structured answer pauses rather than falsely counting an item checked', () => {
  const f = fixture();
  f.analysis.captionQuality = [];
  assert.throws(() => f.state.accept(f.scan, f.batch, f.analysis, 'local::test'), /did not assess caption quality/);
  assert.equal(f.state.qaWorkbenchState.aiItemSignatures['a.jpg'], undefined);
});

test('live scan scope ignores temporary Media List selection', () => {
  const state = {
    qaWorkbenchState: { qaReviewMode: 'progressive-v1', deepScanScopeFiles: ['a.jpg', 'b.jpg'] },
    state: { items: [{ fileName: 'a.jpg', key: 'a' }, { fileName: 'b.jpg', key: 'b' }] },
    qaGetTrainingItems: () => [{ fileName: 'b.jpg', key: 'b' }]
  };
  vm.createContext(state);
  vm.runInContext(
    functionSource('qaDeepScanScopeItems', 'qaDeepScanCurrent') +
    '\nthis.scopeItems = qaDeepScanScopeItems;',
    state
  );
  assert.deepEqual(Array.from(state.scopeItems(), item => item.fileName), ['a.jpg', 'b.jpg']);
});

test('the review queue is independent from filters and can receive new findings', () => {
  const records = [{ key: 'a', fileName: 'a.jpg' }, { key: 'b', fileName: 'b.jpg' }];
  const available = { a: true };
  const added = [];
  const state = {
    qaFocusReviewState: {
      active: true, folder: 'set', scopeKey: 'captured-set', items: records,
      queued: {}, handled: {}, reviewFindings: {}, autoOpen: false, opening: false
    },
    qaFocusReviewCurrent: () => true,
    qaFocusReviewCandidateFindings: item => available[item.key] ? [{ id: item.key }] : [],
    qaFocusReviewHasAction: () => true,
    qaFocusReviewIsDismissed: () => false,
    qaCurrentItemSignatureMap: () => ({ 'a.jpg': 's1', 'b.jpg': 's1' }),
    qaOrderFocusReviewKeys: keys => keys,
    isFocusedQaReviewMode: () => true,
    focusedCaptionState: { itemKey: 'a' },
    pruneFocusedQaReviewItems: () => {},
    appendFocusedQaReviewItems: keys => added.push(...keys),
    qaSyncFocusReviewButton: () => {},
    qaWorkbenchState: {},
    state: { folder: 'set' }
  };
  vm.createContext(state);
  vm.runInContext(
    functionSource('qaSyncFocusReview', 'qaStartFocusReview') +
    '\nthis.sync = qaSyncFocusReview;',
    state
  );
  state.sync();
  assert.deepEqual(added, ['a']);
  available.b = true;
  state.sync();
  assert.deepEqual(added, ['a', 'b']);
  assert.equal(state.qaFocusReviewState.queued.b, true);
});

test('progressive scan never uses fresh Sight or automatically edits captions', () => {
  const run = qa.split('function qaRunNextDeepScanBatch()', 2)[1].split('function qaConceptCoverageCounts()', 1)[0];
  assert.ok(run.includes('setReview: true'));
  assert.ok(run.includes('preflight: true'));
  assert.ok(run.includes('qaDeepScanNextItemBatch(scan, token)'));
  assert.ok(!run.includes('refreshSetIntelligenceItem'));
  assert.ok(!run.includes('useCaptionAssistCandidate'));
  const request = qa.split('function qaDeepScanNextItemBatch(', 2)[1].split('function qaRunNextDeepScanBatch()', 1)[0];
  assert.ok(request.includes('itemReview: true'));
  assert.ok(request.includes('items: batch'));
  assert.ok(request.includes('qaSaveReview(true)'));
});

test('normal media selection remains filtered; explicit QA navigation can request a filtered-out item', async () => {
  const media = fs.readFileSync('tool/js/media.js', 'utf8');
  const start = media.indexOf('function selectPathMedia(mediaItem, options)');
  const end = media.indexOf('function selectNextCaptionlessMediaItem(', start);
  assert.ok(start >= 0 && end > start);
  const observed = [];
  const sandbox = {
    getFilteredMediaItems: () => [],
    state: { folder: 'set', items: [] },
    renderFileList() {},
    XMLHttpRequest: class {
      open() { observed.push('requested'); }
      send() { throw new Error('navigation started'); }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(media.slice(start, end) + '\nthis.select = selectPathMedia;', sandbox);
  await assert.rejects(sandbox.select({ key: 'hidden', fileName: 'hidden.jpg' }), /outside the current filtered list/);
  assert.equal(observed.length, 0);
  await assert.rejects(sandbox.select({ key: 'hidden', fileName: 'hidden.jpg' }, { allowOutsideFilter: true }), /navigation started/);
  assert.deepEqual(observed, ['requested']);
});

test('only QA guided navigation opts out of the live Media List filter', async () => {
  const focus = fs.readFileSync('tool/js/focused_caption.js', 'utf8');
  const start = focus.indexOf('function navigateFocusedCaptionToIndex(');
  const end = focus.indexOf('function hasFocusedReviewUnsavedChanges()', start);
  assert.ok(start >= 0 && end > start);
  const seen = [];
  let qa = true;
  const sandbox = {
    focusedCaptionState: { open: true, itemKeys: ['hidden'], itemIndex: 0, itemKey: 'hidden' },
    isFocusedQaReviewMode: () => qa,
    state: { currentItem: { key: 'another' } },
    resetFocusedCaptionUseArm() {},
    findFocusedCaptionMediaItemByKey: () => ({ key: 'hidden', fileName: 'hidden.jpg' }),
    syncFocusedCaptionControls() {},
    syncCaptionAssistCandidateUi() {},
    syncFocusedCaptionPanelGeometry() {},
    selectPathMedia(_media, options) { seen.push(options); return Promise.resolve(true); },
    stopFocusedCaption() { throw Error('Unexpected guided-review navigation failure'); }
  };
  vm.createContext(sandbox);
  vm.runInContext(focus.slice(start, end) + '\nthis.navigate = navigateFocusedCaptionToIndex;', sandbox);
  assert.equal(await sandbox.navigate(0, 1), true);
  assert.equal(seen[0].allowOutsideFilter, true);
  qa = false;
  assert.equal(await sandbox.navigate(0, 1), true);
  assert.equal(seen[1], undefined);
});

test('QA review opens its guided workflow before navigating to a hidden item', () => {
  const seen = [];
  const item = { key: 'a', fileName: 'a.jpg', caption: 'A shirt.' };
  const sandbox = {
    qaFocusReviewState: {
      active: true, folder: 'set', scopeKey: 'captured', items: [item],
      queued: {}, handled: {}, reviewFindings: {}, autoOpen: true, opening: false, token: 1
    },
    qaFocusReviewCurrent: () => true,
    qaFocusReviewCandidateFindings: () => [{ id: 'finding' }],
    qaFocusReviewHasAction: () => true,
    isFocusedQaReviewMode: () => false,
    qaOrderFocusReviewKeys: keys => keys,
    qaSyncFocusReviewButton() {},
    startFocusedQaReview(keys) { seen.push(...keys); return true; },
    state: { folder: 'set' }
  };
  vm.createContext(sandbox);
  vm.runInContext(functionSource('qaSyncFocusReview', 'qaStartFocusReview') + '\nthis.sync = qaSyncFocusReview;', sandbox);
  sandbox.sync();
  assert.deepEqual(seen, ['a']);
  assert.equal(sandbox.qaFocusReviewState.autoOpen, false);
});

test('dismissing an item persists its finding until meaningful input changes', () => {
  const item = { key: 'a', fileName: 'a.jpg', caption: 'A red shirt.' };
  const finding = { id: 'finding-a' };
  let signature = 's1';
  let saved = 0;
  const sandbox = {
    qaWorkbenchState: { dispositions: {} },
    qaFocusReviewState: {
      handled: {}, queued: { a: true }, reviewFindings: { a: [finding] }
    },
    qaFocusReviewCurrent: () => true,
    qaCurrentItemSignatureMap: () => ({ 'a.jpg': signature }),
    qaSaveReview() { saved += 1; },
    qaSyncFocusReviewButton() {},
    qaSyncFocusReview() {},
    state: { items: [item] }
  };
  vm.createContext(sandbox);
  vm.runInContext(
    functionSource('qaFocusReviewIsDismissed', 'qaFocusReviewCandidateFindings') +
    functionSource('qaFocusReviewMarkHandled', 'qaFocusReviewStopped') +
    '\nthis.dismissed = qaFocusReviewIsDismissed; this.handle = qaFocusReviewMarkHandled;',
    sandbox
  );
  sandbox.handle('a', 'dismissed');
  assert.equal(saved, 1);
  assert.equal(sandbox.qaWorkbenchState.dispositions['finding-a|a.jpg'].signature, 's1');
  assert.equal(sandbox.dismissed(finding, item, signature), true);
  signature = 's2';
  assert.equal(sandbox.dismissed(finding, item, signature), false);
});
