// Regression coverage for Focus integration with shared preview actions and Undo.
// Run with: node tests/focused_annotation_integration.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function readScript(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'tool', 'js', name), 'utf8');
}

const focusSandbox = {
  document: {
    querySelector() { return null; },
    getElementById() { return null; }
  },
  window: {},
  setTimeout() { return 1; },
  clearTimeout() {}
};
vm.runInNewContext(readScript('focused_annotation.js'), focusSandbox, {
  filename: 'focused_annotation.js'
});

let renderedFlag = null;
let reconciledItem = null;
focusSandbox.syncFocusedAnnotationQueue = function (options) {
  reconciledItem = options.anchorMediaKey;
};
const decoratedActions = focusSandbox.decorateFocusedAnnotationPreviewActions([
  {
    label: 'Flag',
    render: function flagRowRenderer(value) {
      renderedFlag = value;
    }
  }
], { key: 'item-1' });

assert.strictEqual(decoratedActions.length, 1);
assert.strictEqual(decoratedActions[0].render.name, 'flagRowRenderer');
decoratedActions[0].render('green');
assert.strictEqual(renderedFlag, 'green');
assert.strictEqual(reconciledItem, 'item-1');

const undoSandbox = {
  APP_THEME_STORAGE_KEY: 'test-theme',
  DEBUG: false,
  XMLHttpRequest: function () {
    this.status = 0;
    this.open = function () {};
    this.send = function () {};
  },
  console,
  document: {
    documentElement: {
      style: {},
      getAttribute() { return ''; },
      setAttribute() {}
    },
    getElementById() { return null; }
  },
  localStorage: {
    getItem() { return null; },
    setItem() {}
  },
  setTimeout() { return 1; },
  clearTimeout() {},
  window: {},
  ui: {
    appEl: null,
    sidebarCollapseToggleBtn: null,
    statusEl: { textContent: '' },
    themeToggleBtn: null
  },
  state: {
    undoStack: [],
    undoSuppress: false
  },
  checklistItems: [],
  focusedAnnotationState: {
    open: true,
    groupIndex: 0,
    groupKey: ''
  },
  appendToConsolePanel() {},
  restoreDeletedChecklistGroup(operation) {
    undoSandbox.checklistItems.splice(operation.index, 0, operation.requirementLabel);
    return true;
  },
};
vm.runInNewContext(readScript('common.js'), undoSandbox, {
  filename: 'common.js'
});

function verifyActiveGroupRestore(groupsAfterDelete, deletedGroup, deletedIndex, replacementGroup) {
  undoSandbox.checklistItems = groupsAfterDelete.slice();
  undoSandbox.focusedAnnotationState.open = true;
  undoSandbox.focusedAnnotationState.groupIndex = Math.min(deletedIndex, Math.max(0, groupsAfterDelete.length - 1));
  undoSandbox.focusedAnnotationState.groupKey = replacementGroup;
  undoSandbox.state.undoStack = [{
    type: 'checklist-group-delete',
    index: deletedIndex,
    requirementLabel: deletedGroup
  }];
  assert.strictEqual(undoSandbox.undoLastOperation(), true);
  assert.strictEqual(undoSandbox.checklistItems[deletedIndex], deletedGroup);
  assert.strictEqual(undoSandbox.focusedAnnotationState.groupIndex, deletedIndex);
  assert.strictEqual(undoSandbox.focusedAnnotationState.groupKey, deletedGroup);
}

verifyActiveGroupRestore(['B', 'C'], 'A', 0, 'B');
verifyActiveGroupRestore(['A', 'C'], 'B', 1, 'C');
verifyActiveGroupRestore(['A', 'B'], 'C', 2, 'B');
verifyActiveGroupRestore([], 'A', 0, '');

undoSandbox.checklistItems = [];
undoSandbox.focusedAnnotationState.open = false;
undoSandbox.focusedAnnotationState.groupKey = '';
undoSandbox.state.undoStack = [{
  type: 'checklist-group-delete',
  index: 0,
  requirementLabel: 'A'
}];
assert.strictEqual(undoSandbox.undoLastOperation(), true);
assert.deepStrictEqual(Array.from(undoSandbox.checklistItems), ['A']);
assert.strictEqual(undoSandbox.focusedAnnotationState.open, false);
assert.strictEqual(undoSandbox.focusedAnnotationState.groupKey, '');

console.log('focused_annotation_integration: all assertions passed');
