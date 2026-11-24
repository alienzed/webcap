const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'tool', 'js', 'director_chat.js'), 'utf8');

function setup(initialDraft = 'my unsent\ndraft') {
  const listeners = {};
  const state = {activeMode: 'storyboard', draftByMode: {storyboard: initialDraft},
    sessionReady: true};
  const input = {
    value: initialDraft, selectionStart: 0, selectionEnd: 0,
    addEventListener(name, callback) { listeners[name] = callback; },
    dispatchEvent(event) { listeners[event.type](event); },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  };
  let saves = 0;
  const context = vm.createContext({
    input, state, inputHistory: ['first sent', 'second sent'],
    inputHistoryIndex: 2, inputHistoryDraft: initialDraft,
    applyingHistoryValue: false, Event: class { constructor(type) { this.type = type; } },
    persistentMode: () => true, scheduleSessionSave: () => { saves++; },
    syncControls: () => {}, sendMessage: () => {}
  });
  const inputStart = source.indexOf("    input.addEventListener('input', function () {");
  const keyStart = source.indexOf("    input.addEventListener('keydown', function (event) {", inputStart);
  const end = source.indexOf("    document.addEventListener('pointerdown'", keyStart);
  assert.ok(inputStart >= 0 && keyStart > inputStart && end > keyStart);
  vm.runInContext(source.slice(inputStart, end), context);
  function key(name, position, extra = {}) {
    input.setSelectionRange(position, position);
    const event = {key: name, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
      isComposing: false, prevented: false, preventDefault() {this.prevented = true;}, ...extra};
    listeners.keydown(event);
    return event.prevented;
  }
  return {input, state, context, key, saves: () => saves, listeners};
}

test('Up in the first line preserves draft and native caret movement', () => {
  const t = setup('first line\nsecond line');
  assert.equal(t.key('ArrowUp', 4), false);
  assert.equal(t.input.value, 'first line\nsecond line');
  assert.equal(t.context.inputHistoryIndex, 2);
  assert.equal(t.saves(), 0);
});

test('only a collapsed selection at absolute start can recall history', () => {
  const t = setup('hello');
  t.input.setSelectionRange(0, 3);
  const event = {key:'ArrowUp', shiftKey:false, ctrlKey:false, metaKey:false,
    altKey:false, isComposing:false, preventDefault() {this.prevented = true;}};
  t.listeners.keydown(event);
  assert.equal(event.prevented, undefined);
  assert.equal(t.key('ArrowUp', 0, {shiftKey:true}), false);
  assert.equal(t.key('ArrowUp', 0, {ctrlKey:true}), false);
  assert.equal(t.key('ArrowUp', 0, {isComposing:true}), false);
  assert.equal(t.key('ArrowUp', 0), true);
  assert.equal(t.input.value, 'second sent');
  assert.equal(t.context.inputHistoryIndex, 1);
});

test('Up/Down browse sent history and restore the exact unsent draft', () => {
  const t = setup('draft\nremains');
  assert.equal(t.key('ArrowUp', 0), true);
  assert.equal(t.key('ArrowUp', 0), true);
  assert.equal(t.input.value, 'first sent');
  assert.equal(t.key('ArrowUp', 0), false);
  assert.equal(t.key('ArrowDown', 0), true);
  assert.equal(t.input.value, 'second sent');
  assert.equal(t.key('ArrowDown', 0), true);
  assert.equal(t.input.value, 'draft\nremains');
  assert.equal(t.state.draftByMode.storyboard, 'draft\nremains');
  assert.equal(t.input.selectionStart, t.input.value.length);
  assert.equal(t.saves(), 1, 'only restoring the draft schedules persistence');
  assert.equal(t.key('ArrowDown', t.input.value.length), false);
});

test('Down does not browse history from a live draft and edits leave originals unchanged', () => {
  const t = setup('active draft');
  assert.equal(t.key('ArrowDown', t.input.value.length), false);
  assert.equal(t.key('ArrowUp', 0), true);
  t.input.value = 'edited recalled message';
  t.listeners.input({type: 'input'});
  assert.equal(t.context.inputHistoryIndex, 2);
  assert.equal(t.state.draftByMode.storyboard, 'edited recalled message');
  assert.equal(t.context.inputHistory[1], 'second sent');
  assert.equal(t.key('ArrowUp', 0), true);
  assert.equal(t.key('ArrowDown', 0), true);
  assert.equal(t.input.value, 'edited recalled message');
});

test('Down at the end of recalled multi-line entry restores draft', () => {
  const t = setup('text I was writing');
  t.context.inputHistory[1] = 'previous\nmultiline';
  t.key('ArrowUp', 0);
  assert.equal(t.key('ArrowDown', 4), false);
  assert.equal(t.key('ArrowDown', t.input.value.length), true);
  assert.equal(t.input.value, 'text I was writing');
});

test('changing the visible conversation starts history from its draft slot', () => {
  const restore = source.slice(source.indexOf('  function restoreSession(chat) {'),
    source.indexOf('  function loadSessionHistory() {'));
  assert.match(restore, /inputHistoryIndex = inputHistory.length;/);
  assert.match(restore, /inputHistoryDraft = state.draftByMode\[chat.mode\];/);
  const create = source.slice(source.indexOf('  function newChat(options) {'),
    source.indexOf('  function jobRequest(jobId) {'));
  assert.match(create, /inputHistoryIndex = inputHistory.length;/);
  const remove = source.slice(source.indexOf('  function deleteSession(chatId) {'),
    source.indexOf('  function formatElapsed(ms) {'));
  assert.match(remove, /inputHistoryIndex = inputHistory.length;/);
});
