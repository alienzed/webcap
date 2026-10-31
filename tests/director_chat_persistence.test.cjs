const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'tool', 'js', 'director_chat.js'), 'utf8');
const markup = fs.readFileSync(path.join(__dirname, '..', 'tool', 'tool.html'), 'utf8');

function block(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, 'Missing Assistant source block: ' + start);
  return source.slice(from, to);
}

test('Assistant displays history, new chat and save status', () => {
  assert.match(markup, /id="director-chat-history-toggle"/);
  assert.match(markup, /id="director-chat-history-panel"/);
  assert.match(markup, /id="director-chat-save-status"/);
  assert.match(source, /loadSessionHistory\(\);/);
  assert.match(source, /beforeunload/);
});

test('Saving serializes message snapshots and increments revisions before inference', async () => {
  const state = {
    activeMode: 'chat', sessionReady: true,
    sessionByMode: { chat: null, storyboard: null },
    sessionActiveByMode: {}, sessionList: [],
    sessionWrite: Promise.resolve(), sessionDirty: { chat: false, storyboard: false },
    messages: [{ role: 'user', content: 'Please fix Scene 3' }],
    modeMessages: {}, draftByMode: { chat: '', storyboard: '' },
    storyboardAttachments: {}
  };
  const written = [];
  let revision = 0;
  const context = vm.createContext({
    state, Promise, JSON,
    persistentMode: mode => mode === 'chat' || mode === 'storyboard',
    showSessionStatus: () => {},
    upsertSessionSummary: () => {},
    showSessionFailure: error => { throw error; },
    requestJson: async (url, options) => {
      if (url === '/fs/director/chats') {
        written.push('create');
        return { chat: { id: 'chat-1', title: 'New chat', revision: 0, mode: 'chat' } };
      }
      const payload = JSON.parse(options.body);
      assert.equal(payload.expectedRevision, revision);
      written.push(JSON.parse(options.body));
      revision++;
      return { chat: {
        id: 'chat-1', revision, mode: 'chat', title: payload.title,
        messages: payload.messages, draft: payload.draft,
        attachments: payload.attachments
      } };
    }
  });
  const persist = vm.runInContext('(' + block('  function persistSession(mode) {', '  function scheduleSessionSave() {').trim() + ')', context);
  const first = persist('chat');
  state.messages.push({ role: 'assistant', content: 'Done.' });
  const second = persist('chat');
  await Promise.all([first, second]);
  assert.equal(written[0], 'create');
  assert.equal(written[1].messages.length, 1);
  assert.equal(written[2].messages.length, 2);
  assert.equal(written[2].expectedRevision, 1);
  assert.equal(state.sessionByMode.chat.revision, 2);
  assert.equal(written[1].title, 'Please fix Scene 3');
});

test('Send commits the user message before enqueueing the LLM job', () => {
  const send = block('  function sendMessage() {', '  function syncPinnedUi() {');
  assert.match(send, /messages\.push\(\{ role: 'user', content: content \}\)/);
  assert.match(send, /persistentMode\(activeChatMode\) \? persistSession\(activeChatMode\)/);
  assert.ok(send.indexOf("persistSession(activeChatMode)") < send.indexOf("requestJson('/fs/director/chat'"));
  assert.match(send, /return persistSession\(activeChatMode\)/);
});

test('Draft autosave is queued and Storyboard navigation preserves discussion', () => {
  assert.match(source, /state\.draftByMode\[state\.activeMode\] = input\.value/);
  assert.match(source, /scheduleSessionSave\(\)/);
  const sync = block('  window.syncStoryboardAssistantStory = function', '  window.openStoryboardAssistant = function');
  assert.doesNotMatch(sync, /modeMessages\s*=|modeMessages\.storyboard\s*=|storyboardAttachments\s*=/);
  const workshop = block('  window.openStoryboardSceneWorkshop = function', '  window.registerAssistantMode');
  assert.doesNotMatch(workshop, /modeMessages\.storyboard\s*=\s*\[\]/);
});


test('global Assistant opens Chat, never stale Studio Director outside Studio', async () => {
  const state = {activeMode: 'storyboard', open: false, pending: false, pinned: false};
  const properties = {hidden: true, active: false};
  const drawer = {
    classList: {toggle(name, enabled) { if (name === 'hidden') properties.hidden = enabled; }},
    setAttribute: () => {}
  };
  const toggle = {
    classList: {toggle(name, enabled) { if (name === 'active') properties.active = enabled; }},
    setAttribute: () => {}
  };
  const context = vm.createContext({
    state, Promise,
    studioWorkspaceVisible: () => false,
    setMode: mode => {if (!state.pending) state.activeMode = mode;},
    el: id => ({'director-chat-drawer': drawer, 'director-chat-rail-btn': toggle,
      'director-chat-input': {focus() {}}})[id],
    syncPinnedUi: () => {}, syncModeUi: () => {},
    loadModels: async () => {}, maybeOpenNewStudioConversation: () => {
      throw Error('Studio startup must not happen outside Studio.');
    },
    window: {}
  });
  vm.runInContext(block('  function setOpen(open, modeId) {', '  function bind() {'), context);
  const setOpen = vm.runInContext('setOpen', context);
  setOpen(true); // global activity path has no mode argument
  assert.equal(state.activeMode, 'chat');
  assert.equal(state.open, true);
  assert.equal(properties.hidden, false);
  setOpen(false);

  // Switching is blocked during LLM requests; do not expose Studio instead.
  state.pending = true;
  state.activeMode = 'storyboard';
  setOpen(true, 'chat');
  assert.equal(state.open, false);
  assert.equal(state.activeMode, 'storyboard');
  assert.equal(properties.hidden, true);
});

test('Studio mode selection is unavailable outside its workspace', () => {
  const state = {
    activeMode: 'chat', pending: false, sessionReady: true,
    sessionDirty: {chat: false, storyboard: false},
    draftByMode: {chat: 'regular', storyboard: 'story'}
  };
  const input = {value: 'regular', focus: () => {}};
  const context = vm.createContext({
    state, String, document: {querySelector: () => null},
    el: id => id === 'director-chat-input' ? input : null,
    contextualModes: {}, persistentMode: () => true,
    finishProgress: () => {}, syncModeUi: () => {},
  });
  vm.runInContext(block('  function studioWorkspaceVisible() {', '  function registerContextMode(mode) {'), context);
  vm.runInContext('setMode("storyboard")', context);
  assert.equal(state.activeMode, 'chat');
  assert.equal(input.value, 'regular');
  context.document.querySelector = () => ({});
  vm.runInContext('setMode("storyboard")', context);
  assert.equal(state.activeMode, 'storyboard');
  assert.equal(input.value, 'story');
});
