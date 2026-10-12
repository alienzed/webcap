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
