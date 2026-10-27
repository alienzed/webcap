const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness() {
  const controls = Object.fromEntries(
    ['ai-validation-suggest', 'ai-validation-apply', 'ai-validation-discard',
     'ai-validation-complete', 'ai-validation-toolbar', 'ai-validation-status']
      .map(id => [id, { classList: { toggle() {} }, disabled: false, textContent: '', onclick: null }])
  );
  const ctx = {
    document: { getElementById: id => controls[id] || null },
    state: { folder: 'set', currentItem: null, items: [] },
    workspaceState: { surface: 'default' },
    ui: { editorEl: { value: '' } },
    getChecklistAssignmentEntriesForMediaKey: () => [],
    getUnscopedTagsForMediaKey: () => [],
    getMetadataForMedia: () => null,
    getChecklistKeywordTermsForRequirement: () => [],
    hasChecklistAssignedTagForMediaKey: () => false,
    refreshGroupWorkbenchForCurrentItem() {},
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../tool/js/ai_validation.js'), 'utf8'), ctx);
  return ctx;
}

test('validation requires matching saved caption, annotations and Sight', () => {
  const c = harness();
  const item = { key: 'a.jpg', fileName: 'a.jpg', caption: 'original',
    metadata: { vision_sight: { description: 'front view', inventory: { details: ['metal rings'] } } } };
  c.state.items = [item]; c.state.currentItem = item;
  assert.equal(c.isAiValidatedForItem(item), false);
  c.aiValidationReceiptsByMedia[item.key] = {
    version: 1, content: c.aiValidationCurrentInput(item), sight: c.aiValidationSightInput(item)
  };
  assert.equal(c.isAiValidatedForItem(item), true);
  item.caption = 'edited caption';
  assert.equal(c.isAiValidatedForItem(item), false);
  item.caption = 'original';
  item.metadata.vision_sight.inventory.details.push('gold jewel');
  assert.equal(c.isAiValidatedForItem(item), false);
});

test('vocabulary addition invalidates only cited media', () => {
  const c = harness();
  c.aiValidationReceiptsByMedia['a.jpg'] = { version: 1, content: 'a', sight: 'x' };
  c.aiValidationReceiptsByMedia['b.jpg'] = { version: 1, content: 'b', sight: 'y' };
  c.aiValidationVocabularyMutated(
    [{ group: 'BT Back', terms: ['jewel connector'] }],
    { groups: [{ targetGroup: 'BT Back', terms: [{ term: 'jewel connector', evidenceIds: ['e1'] }] }] },
    { evidence: [{ id: 'e1', media: ['a.jpg'] }] }
  );
  assert.equal(c.aiValidationReceiptsByMedia['a.jpg'], undefined);
  assert.equal(c.aiValidationReceiptsByMedia['b.jpg'].content, 'b');
});

test('tag suggestions stay in session draft and never assign automatically', () => {
  const c = harness();
  const item = { key: 'a.jpg', fileName: 'a.jpg', caption: '', metadata: {} };
  c.state.currentItem = item; c.state.items = [item];
  c.getChecklistKeywordTermsForRequirement = () => ['triangle'];
  c.aiValidationPublishCandidates({ items: [{ file: 'a.jpg', candidates: [{
    group: 'BT Shape', term: 'triangle', existing: true, confidence: 'high', why: 'visual evidence'
  }] }] }, 'set');
  assert.equal(c.aiValidationCurrentDraft().candidates[0].selected, true);
  c.aiValidationDiscardProposals();
  assert.equal(c.aiValidationCurrentDraft(), null);
});

test('failed proposal save rolls back tags and keeps selected proposals for retry', async () => {
  const c = harness();
  const item = { key: 'a.jpg', fileName: 'a.jpg', caption: 'caption',
    metadata: { vision_sight: { description: 'front', inventory: {} } } };
  c.state.items = [item]; c.state.currentItem = item;
  c.checklistAssignmentsByMedia = {};
  c.captionItemTagsByMedia = {};
  c.checklistCheckedByMedia = {};
  c.checklistTermDescriptorsByMedia = {};
  c.checklistTermDescriptorSnapshotMediaKeys = new Set();
  c.state.reviewedSet = new Set();
  c.state.undoStack = [];
  c.getChecklistKeywordTermsForRequirement = () => ['triangle'];
  c.getChecklistAssignmentEntriesForMediaKey = () =>
    (c.checklistAssignmentsByMedia[item.key]?.Shape || []).map(term => ({ requirement: 'Shape', term }));
  c.getUnscopedTagsForMediaKey = () => c.captionItemTagsByMedia[item.key] || [];
  c.hasChecklistAssignedTagForMediaKey = (_, group, term) =>
    !!c.checklistAssignmentsByMedia[item.key]?.[group]?.includes(term);
  c.assignChecklistTagToMediaKey = (key, group, term) => {
    c.checklistAssignmentsByMedia[key] = { [group]: [term] };
    return true;
  };
  c.invalidateChecklistRequirementProgress = () => {};
  c.refreshTagDrivenPanelsForMediaKey = () => {};
  c.reportConsoleError = () => {};
  c.setStatus = () => {};
  c.saveMediaAnnotationState = async () => false;
  c.aiValidationPublishCandidates({ items: [{ file: 'a.jpg', candidates: [{
    group: 'Shape', term: 'triangle', existing: true, confidence: 'high'
  }] }] }, 'set');
  assert.equal(await c.aiValidationApplyProposals(), false);
  assert.equal(c.checklistAssignmentsByMedia[item.key], undefined);
  assert.equal(c.aiValidationCurrentDraft().candidates[0].selected, true);
  let receiptWrites = 0;
  c.saveCaptionDirect = async () => { throw Error('must not save caption'); };
  c.saveFolderStateForCurrentRoot = async () => { receiptWrites++; return true; };
  assert.equal(await c.aiValidationCompleteCurrentItem(), undefined);
  assert.equal(receiptWrites, 0);
  c.saveMediaAnnotationState = async () => true;
  assert.equal(await c.aiValidationApplyProposals(), true);
  assert.equal(c.aiValidationCurrentDraft(), null);
});

test('Validate & Next cannot issue receipt when annotation save fails', async () => {
  const c = harness();
  const item = { key: 'a.jpg', fileName: 'a.jpg', caption: 'saved',
    metadata: { vision_sight: { description: 'front', inventory: {} } } };
  c.state.items = [item]; c.state.currentItem = item;
  c.ui.editorEl.value = 'accepted';
  c.getFilteredMediaItems = () => [item];
  c.cancelEditorAutosaveForCaption = () => {};
  c.saveMediaAnnotationState = async () => false;
  let captionWrites = 0, receiptWrites = 0;
  c.saveCaptionDirect = async () => { captionWrites++; };
  c.saveFolderStateForCurrentRoot = async () => { receiptWrites++; return true; };
  c.reportConsoleError = () => {};
  c.setStatus = () => {};
  assert.equal(await c.aiValidationCompleteCurrentItem(), false);
  assert.equal(captionWrites, 0);
  assert.equal(receiptWrites, 0);
  assert.equal(c.isAiValidatedForItem(item), false);
});


test('Accepted Caption Assist caption writes a durable validation receipt after annotations', async () => {
  const c = harness();
  const item = { key: 'accepted.jpg', fileName: 'accepted.jpg', caption: 'Edited human-approved caption',
    metadata: { vision_sight: { description: 'Saved observation', inventory: { scene: 'outdoors' } } } };
  c.state.items = [item]; c.state.currentItem = item;
  const saved = [];
  c.getChecklistAssignmentEntriesForMediaKey = () => [{ requirement: 'Framing', term: 'Portrait' }];
  c.saveMediaAnnotationState = async key => { saved.push('annotations:' + key); return true; };
  c.saveFolderStateForCurrentRoot = async () => {
    saved.push('receipt');
    assert.equal(c.aiValidationReceiptsByMedia[item.key].content, c.aiValidationCurrentInput(item));
    assert.equal(c.aiValidationReceiptsByMedia[item.key].sight, c.aiValidationSightInput(item));
    return true;
  };
  c.reportConsoleError = (_, error) => { throw error; };

  assert.equal(await c.aiValidationRecordAcceptedCaption(item, item.caption, 'set'), true);
  assert.deepEqual(saved, ['annotations:accepted.jpg', 'receipt']);
  assert.equal(c.isAiValidatedForItem(item), true, 'Needs AI Validation should no longer include this item');
  item.caption += ' changed after acceptance';
  assert.equal(c.isAiValidatedForItem(item), false, 'Further caption edits invalidate the receipt');
});

test('Explicit caption acceptance without saved Sight validates current inputs until new Sight arrives', async () => {
  const c = harness();
  const item = { key: 'fresh.jpg', fileName: 'fresh.jpg', caption: 'The caption was checked.', metadata: {} };
  c.state.items = [item]; c.state.currentItem = item;
  c.saveMediaAnnotationState = async () => true;
  c.saveFolderStateForCurrentRoot = async () => true;
  c.reportConsoleError = (_, error) => { throw error; };

  assert.equal(await c.aiValidationRecordAcceptedCaption(item, item.caption, 'set'), true);
  assert.equal(c.aiValidationReceiptsByMedia[item.key].sight, '');
  assert.equal(c.isAiValidatedForItem(item), true);
  item.metadata.vision_sight = { description: 'New Sight', inventory: { count: 2 } };
  assert.equal(c.isAiValidatedForItem(item), false, 'Fresh Sight requires new acceptance');
});

test('Failed annotation or receipt writes do not leave a falsely validated Caption Assist item', async () => {
  const c = harness();
  const item = { key: 'fail.jpg', fileName: 'fail.jpg', caption: 'Accepted caption', metadata: {} };
  c.state.items = [item]; c.state.currentItem = item;
  const errors = [];
  c.reportConsoleError = (_, error) => { errors.push(error.message); };
  let receiptWrites = 0;
  c.saveMediaAnnotationState = async () => false;
  c.saveFolderStateForCurrentRoot = async () => { receiptWrites += 1; return true; };
  await assert.rejects(c.aiValidationRecordAcceptedCaption(item, item.caption, 'set'), /persist the accepted caption annotations/);
  assert.equal(receiptWrites, 0);
  assert.equal(c.isAiValidatedForItem(item), false);

  c.saveMediaAnnotationState = async () => true;
  c.saveFolderStateForCurrentRoot = async () => { receiptWrites += 1; return false; };
  await assert.rejects(c.aiValidationRecordAcceptedCaption(item, item.caption, 'set'), /persist the Caption Assist AI validation receipt/);
  assert.equal(c.isAiValidatedForItem(item), false);
  assert.equal(c.aiValidationReceiptsByMedia[item.key], undefined);
  assert.equal(c.aiValidationSavePending, false);
  assert.equal(errors.length, 2);
});

test('Caption acceptance refuses unsaved text and item changes during async annotation writes', async () => {
  const c = harness();
  const item = { key: 'first.jpg', fileName: 'first.jpg', caption: 'Saved text', metadata: {} };
  const other = { key: 'next.jpg', fileName: 'next.jpg', caption: '', metadata: {} };
  c.state.items = [item, other]; c.state.currentItem = item;
  assert.throws(() => c.aiValidationRecordAcceptedCaption(item, 'Not yet saved', 'set'), /saved first/);
  assert.throws(() => c.aiValidationRecordAcceptedCaption(item, item.caption, 'wrong folder'), /selected Set or item changed/);

  let finishAnnotations;
  c.saveMediaAnnotationState = () => new Promise(resolve => { finishAnnotations = resolve; });
  let receiptWrites = 0;
  c.saveFolderStateForCurrentRoot = async () => { receiptWrites += 1; return true; };
  c.reportConsoleError = () => {};
  const pending = c.aiValidationRecordAcceptedCaption(item, item.caption, 'set');
  assert.equal(c.isAiValidatedForItem(item), false);
  c.state.currentItem = other;
  finishAnnotations(true);
  await assert.rejects(pending, /selected Set or item changed/);
  assert.equal(receiptWrites, 0);
  assert.equal(c.isAiValidatedForItem(item), false);
});
