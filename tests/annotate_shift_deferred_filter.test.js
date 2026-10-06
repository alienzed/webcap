// Regression coverage for Shift-deferred filter refresh in the normal annotation strip.
// Run with: node tests/annotate_shift_deferred_filter.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function readScript(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'tool', 'js', name), 'utf8');
}

const listeners = {};
const sandbox = {
  console,
  document: {
    getElementById() { return null; },
    querySelector() { return null; }
  },
  window: {
    addEventListener(type, handler) {
      listeners[type] = handler;
    }
  },
  state: {
    folder: 'set-a',
    currentItem: { key: 'item-1' }
  },
  checklistItems: [],
  checklistKeywordsByItem: {},
  annotateStripVisible: true,
  captionHelperPanelCollapsed: false,
  normalizeCatalogTerm(value) {
    return String(value || '').trim();
  },
  normalizeChecklistRequirementKey(value) {
    return String(value || '').trim();
  },
  hasChecklistAssignedTagForMediaKey() {
    return false;
  },
  assignCalls: [],
  assignChecklistTagToMediaKey(mediaKey, requirement, term, options) {
    sandbox.assignCalls.push({ mediaKey, requirement, term, options });
    return true;
  },
  unassignChecklistTagFromMediaKey() {
    throw new Error('unexpected unassign');
  },
  renderAnnotateStripCalls: 0,
  renderAnnotateStrip() {
    sandbox.renderAnnotateStripCalls += 1;
  },
  refreshCalls: [],
  refreshTagDrivenPanelsForMediaKey(mediaKey) {
    sandbox.refreshCalls.push(mediaKey);
  },
  renderFileListCalls: 0,
  renderFileList() {
    sandbox.renderFileListCalls += 1;
  },
  setStatus() {},
  hasAnyActiveMediaFilter() {
    return true;
  }
};

vm.runInNewContext(readScript('caption_helpers_annotate.js'), sandbox, {
  filename: 'caption_helpers_annotate.js'
});

assert.strictEqual(typeof sandbox.toggleAnnotateTag, 'function');
assert.strictEqual(typeof sandbox.flushAnnotateStripDeferredFilterRefresh, 'function');
assert.strictEqual(typeof sandbox.shouldDeferAnnotateStripFilterRefresh, 'function');

sandbox.renderAnnotateStrip = function () {
  sandbox.renderAnnotateStripCalls += 1;
};

assert.strictEqual(sandbox.shouldDeferAnnotateStripFilterRefresh({ shiftKey: true }), true);
assert.strictEqual(sandbox.shouldDeferAnnotateStripFilterRefresh({ shiftKey: false }), false);
sandbox.hasAnyActiveMediaFilter = function () { return false; };
assert.strictEqual(sandbox.shouldDeferAnnotateStripFilterRefresh({ shiftKey: true }), false);
sandbox.hasAnyActiveMediaFilter = function () { return true; };

sandbox.toggleAnnotateTag('BT', 'ring', true);
assert.strictEqual(sandbox.assignCalls.length, 1);
assert.strictEqual(sandbox.assignCalls[0].options.skipRefresh, true);
assert.strictEqual(sandbox.refreshCalls.length, 0);
assert.strictEqual(sandbox.renderAnnotateStripCalls, 1);

sandbox.toggleAnnotateTag('BB', 'ring', true);
assert.strictEqual(sandbox.assignCalls.length, 2);
assert.strictEqual(sandbox.assignCalls[1].options.skipRefresh, true);
assert.strictEqual(sandbox.refreshCalls.length, 0);

assert.ok(listeners.keyup, 'Shift keyup handler should be registered');
listeners.keyup({ key: 'Shift' });
assert.deepStrictEqual(Array.from(sandbox.refreshCalls), ['item-1']);

listeners.keyup({ key: 'Shift' });
assert.deepStrictEqual(Array.from(sandbox.refreshCalls), ['item-1']);

sandbox.toggleAnnotateTag('BT', 'ring', false);
assert.strictEqual(sandbox.assignCalls.length, 3);
assert.strictEqual(sandbox.assignCalls[2].options, undefined);

sandbox.toggleAnnotateTag('BT', 'ring', true);
sandbox.state.folder = 'set-b';
listeners.blur();
assert.deepStrictEqual(Array.from(sandbox.refreshCalls), ['item-1']);

console.log('annotate_shift_deferred_filter: all assertions passed');
