const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness() {
  const controls = Object.fromEntries(
    ['single-item-tag-assist-suggest', 'single-item-tag-assist-apply', 'single-item-tag-assist-discard',
     'single-item-tag-assist-toolbar']
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
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../tool/js/single_item_tag_assist.js'), 'utf8'), ctx);
  return ctx;
}

test('tag suggestions stay in session draft and never assign automatically', () => {
  const c = harness();
  const item = { key: 'a.jpg', fileName: 'a.jpg', caption: '', metadata: {} };
  c.state.currentItem = item; c.state.items = [item];
  c.getChecklistKeywordTermsForRequirement = () => ['triangle'];
  c.singleItemTagAssistPublishCandidates({ items: [{ file: 'a.jpg', candidates: [{
    group: 'BT Shape', term: 'triangle', existing: true, confidence: 'high', why: 'visual evidence'
  }] }] }, 'set');
  assert.equal(c.singleItemTagAssistCurrentDraft().candidates[0].selected, true);
  c.singleItemTagAssistDiscardProposals();
  assert.equal(c.singleItemTagAssistCurrentDraft(), null);
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
  c.singleItemTagAssistPublishCandidates({ items: [{ file: 'a.jpg', candidates: [{
    group: 'Shape', term: 'triangle', existing: true, confidence: 'high'
  }] }] }, 'set');
  assert.equal(await c.singleItemTagAssistApplyProposals(), false);
  assert.equal(c.checklistAssignmentsByMedia[item.key], undefined);
  assert.equal(c.singleItemTagAssistCurrentDraft().candidates[0].selected, true);
  c.saveMediaAnnotationState = async () => true;
  assert.equal(await c.singleItemTagAssistApplyProposals(), true);
  assert.equal(c.singleItemTagAssistCurrentDraft(), null);
});

test('changing Sets drops draft proposals and invalidates pending suggestion requests', () => {
  const c = harness();
  const item = { key: 'a.jpg', fileName: 'a.jpg', caption: '', metadata: {} };
  c.state.currentItem = item; c.state.items = [item];
  c.getChecklistKeywordTermsForRequirement = () => ['triangle'];
  c.singleItemTagAssistPublishCandidates({ items: [{ file: 'a.jpg', candidates: [{
    group: 'Shape', term: 'triangle', existing: true, confidence: 'high'
  }] }] }, 'set');
  const token = c.singleItemTagAssistRequestToken;
  c.singleItemTagAssistRequestPending = true;
  c.singleItemTagAssistReset();
  assert.equal(c.singleItemTagAssistCurrentDraft(), null);
  assert.equal(c.singleItemTagAssistRequestPending, false);
  assert.equal(c.singleItemTagAssistRequestToken, token + 1);
});
