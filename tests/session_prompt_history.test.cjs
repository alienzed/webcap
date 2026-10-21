const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Input {
  constructor(tagName = 'INPUT', value = '') {
    this.tagName = tagName;
    this.value = value;
    this.listeners = {};
    this.selectionStart = value.length;
    this.selectionEnd = value.length;
    this.disabled = false;
    this.readOnly = false;
    this.inputEvents = 0;
  }
  addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }
  dispatchEvent(event) {
    event.target = this;
    if (event.type === 'input') this.inputEvents++;
    for (const listener of this.listeners[event.type] || []) listener(event);
  }
  type(value) {
    this.value = value;
    this.selectionStart = value.length;
    this.selectionEnd = value.length;
    this.dispatchEvent({type: 'input'});
  }
  key(key, extras = {}) {
    const event = {type: 'keydown', target: this, key, defaultPrevented: false,
      preventDefault() {this.defaultPrevented = true;}, ...extras};
    this.dispatchEvent(event);
    return event.defaultPrevented;
  }
}
function history() {
  const window = {};
  class FakeEvent {
    constructor(type, options = {}) {this.type = type; this.bubbles = options.bubbles;}
  }
  vm.runInNewContext(fs.readFileSync('tool/js/session_prompt_history.js', 'utf8'),
    {window, WeakMap, Event: FakeEvent});
  return window.createSessionPromptHistory();
}

test('records submitted instructions, walks backward, and restores unsubmitted draft', () => {
  const h = history(), input = new Input();
  h.bind(input);
  input.type('First');
  assert.equal(input.key('ArrowUp'), false, 'typing is not submitting');
  h.remember(input.value, input);
  input.type('Second');
  h.remember(input.value, input);
  input.type('new draft');
  assert.equal(input.key('ArrowUp'), true);
  assert.equal(input.value, 'Second');
  assert.equal(input.key('ArrowUp'), true);
  assert.equal(input.value, 'First');
  assert.equal(input.key('ArrowUp'), false, 'oldest entry');
  assert.equal(input.key('ArrowDown'), true);
  assert.equal(input.value, 'Second');
  assert.equal(input.key('ArrowDown'), true);
  assert.equal(input.value, 'new draft');
  assert.equal(input.key('ArrowDown'), false, 'returned to draft');
  assert.equal(input.inputEvents, 7, 'three edits plus four recalled entries dispatch input events');
});

test('editing recalled content exits history until the next Up', () => {
  const h = history(), input = new Input();
  h.bind(input); h.remember('Earlier');
  input.type('work in progress');
  input.key('ArrowUp');
  input.type('edited recalled text');
  assert.equal(input.key('ArrowDown'), false);
  assert.equal(input.key('ArrowUp'), true);
  assert.equal(input.value, 'Earlier');
  assert.equal(input.key('ArrowDown'), true);
  assert.equal(input.value, 'edited recalled text');
});

test('multiline fields preserve normal caret movement except at first and last lines', () => {
  const h = history(), input = new Input('TEXTAREA', 'top\nsecond\nlast');
  h.bind(input); h.remember('Previous revision');
  input.selectionStart = 5; input.selectionEnd = 5;
  assert.equal(input.key('ArrowUp'), false);
  input.selectionStart = 0; input.selectionEnd = 0;
  assert.equal(input.key('ArrowUp'), true);
  assert.equal(input.value, 'Previous revision');
  assert.equal(input.key('ArrowDown'), true);
  assert.equal(input.value, 'top\nsecond\nlast');
  input.selectionStart = 0; input.selectionEnd = 0;
  assert.equal(input.key('ArrowDown'), false, 'Down inside a multiline draft stays native');
});

test('history is separate by workflow and lost with the instance', () => {
  const refine = history(), revise = history(), input = new Input();
  refine.bind(input);
  refine.remember('Refine this Scene');
  revise.remember('Revise all Scenes');
  assert.equal(input.key('ArrowUp'), true);
  assert.equal(input.value, 'Refine this Scene');
  const fresh = history(), another = new Input();
  fresh.bind(another);
  assert.equal(another.key('ArrowUp'), false);
});

test('blank and consecutive duplicate submissions do not clutter history', () => {
  const h = history(), input = new Input(); h.bind(input);
  h.remember('  ');
  h.remember(' First ', input);
  h.remember('First', input);
  h.remember('Second', input);
  input.type('draft');
  input.key('ArrowUp'); assert.equal(input.value, 'Second');
  input.key('ArrowUp'); assert.equal(input.value, 'First');
  assert.equal(input.key('ArrowUp'), false);
});

test('programmatic modal resets retain entries but discard stale cursor', () => {
  const h = history(), input = new Input();
  h.bind(input); h.remember('insert scene'); h.remember('extend story');
  input.key('ArrowUp');
  input.value = '';
  h.reset(input);
  assert.equal(input.key('ArrowUp'), true);
  assert.equal(input.value, 'extend story');
  input.key('ArrowDown');
  assert.equal(input.value, '');
});

test('modified arrows, readonly input, and composing keystrokes remain native', () => {
  const h = history(), input = new Input();
  h.bind(input); h.remember('submitted');
  assert.equal(input.key('ArrowUp', {ctrlKey:true}), false);
  assert.equal(input.key('ArrowUp', {isComposing:true}), false);
  input.readOnly = true;
  assert.equal(input.key('ArrowUp'), false);
  input.readOnly = false;
  assert.equal(input.key('ArrowUp'), true);
});

test('helper is loaded before Generate and Storyboard and wired only to instruction inputs', () => {
  const html = fs.readFileSync('tool/tool.html', 'utf8');
  const script = 'session_prompt_history.js';
  assert.ok(html.indexOf(script) !== -1);
  assert.ok(html.indexOf(script) < html.indexOf('src="/static/js/generate.js"'));
  assert.ok(html.indexOf(script) < html.indexOf('src="/static/js/storyboard.js"'));
  const generate = fs.readFileSync('tool/js/generate.js', 'utf8');
  const storyboard = fs.readFileSync('tool/js/storyboard.js', 'utf8');
  assert.match(generate, /promptAssistantInstructionHistory\.bind\(el\('generate-director-instruction'\)\)/);
  assert.match(storyboard, /sceneRefineHistory\.handleKeydown\(event\)/);
  assert.match(storyboard, /sceneRevisionHistory\.bind\(el\('storyboard-director-tools-instruction'\)\)/);
  assert.match(storyboard, /sceneCreationHistory\.bind\(el\('storyboard-scene-creation-instruction'\)\)/);
});
