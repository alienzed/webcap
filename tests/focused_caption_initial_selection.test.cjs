'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('tool/js/focused_caption.js', 'utf8');
const begin = source.indexOf('function syncFocusedCaptionControls() {');
const end = source.indexOf('function syncFocusedCaptionAfterAssist(', begin);
assert.ok(begin >= 0 && end > begin, 'Focused review control function exists');
const code = source.slice(begin, end) +
  '\nthis.syncFocusedCaptionControls = syncFocusedCaptionControls;';

function button() {
  return {
    classList: { add() {}, remove() {}, toggle() {} },
    querySelector() { return { textContent: '' }; },
    setAttribute() {},
    disabled: false,
    textContent: '',
    title: ''
  };
}

function fixture({ pending = true, folder = 'set', selected = null } = {}) {
  const start = button();
  const review = button();
  const skip = button();
  const dismiss = button();
  const controls = {
    'preview-open-focus-review-btn': review,
    'preview-focus-caption-dismiss-qa-btn': dismiss
  };
  const stopped = [];
  const focus = {
    open: true, mode: 'qa', folder: 'set', selectingFirstItem: pending,
    itemIndex: 0, itemKeys: ['a.jpg'], itemKey: 'a.jpg'
  };
  const sandbox = {
    focusedCaptionState: focus,
    state: { folder, currentItem: selected },
    ui: { previewFocusCaptionBtnEl: start, previewFocusCaptionSkipBtnEl: skip },
    document: { getElementById(id) { return controls[id] || null; } },
    isFocusedAnnotationOpen() { return false; },
    isFocusedCaptionReviewMode() { return true; },
    isFocusedQaReviewMode() { return true; },
    focusedCaptionModeLabel() { return 'QA Focus Review'; },
    stopFocusedCaption(message) { stopped.push(message); focus.open = false; return true; }
  };
  vm.runInNewContext(code, sandbox);
  return { sandbox, focus, stopped };
}

test('QA Focus Review may open before any Single Item is selected', () => {
  const { sandbox, focus, stopped } = fixture();
  sandbox.syncFocusedCaptionControls();
  assert.equal(focus.open, true);
  assert.deepEqual(stopped, []);
});

test('missing selection after initial item selection still ends the review', () => {
  const { sandbox, stopped } = fixture({ pending: false });
  sandbox.syncFocusedCaptionControls();
  assert.equal(stopped.length, 1);
  assert.match(stopped[0], /Single Item context changed/);
});

test('real Set change ends the review even while initial selection is pending', () => {
  const { sandbox, stopped } = fixture({ folder: 'other-set' });
  sandbox.syncFocusedCaptionControls();
  assert.equal(stopped.length, 1);
});

test('initial-selection exception is established before rendering and cleared after selection', () => {
  const start = source.slice(source.indexOf('function startFocusedCaption('),
    source.indexOf('function startFocusedQaReview(', source.indexOf('function startFocusedCaption(')));
  const select = source.slice(source.indexOf('function syncFocusedCaptionSelection('),
    source.indexOf('function finishFocusedCaption(', source.indexOf('function syncFocusedCaptionSelection(')));
  const stop = source.slice(source.indexOf('function stopFocusedCaption('),
    source.indexOf('function prepareFocusedCaptionCurrentItem(', source.indexOf('function stopFocusedCaption(')));
  assert.ok(start.indexOf('focusedCaptionState.selectingFirstItem = !(') >= 0);
  assert.ok(start.indexOf('focusedCaptionState.selectingFirstItem = !(') < start.indexOf('syncFocusedCaptionControls();'));
  assert.match(select, /focusedCaptionState\.selectingFirstItem = false;/);
  assert.match(stop, /focusedCaptionState\.selectingFirstItem = false;/);
});
