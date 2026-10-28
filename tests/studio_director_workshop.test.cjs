const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'tool/js/director_chat.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'tool/tool.html'), 'utf8');

function slice(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start + ' was not found');
  return source.slice(a, b);
}

test('Studio has visible creative starters and spacious, independent UX', () => {
  assert.match(html, /id="director-studio-starters"/);
  assert.match(html, /data-studio-starter="hook"/);
  assert.match(html, /id="director-studio-retry"/);
  assert.match(html, /Production Playbook/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'tool/css/workspace_shell.css'), 'utf8');
  assert.match(css, /\.director-chat-drawer\.studio-director/);
  assert.match(css, /font-size: 18px/);
  assert.match(source, /studioDirectorRequestMessages/);
});

test('Studio first question is an actual model request, not a fabricated user history entry', async () => {
  const state = {
    open: true, activeMode: 'storyboard', sessionReady: true,
    modelsLoaded: true, pending: false, studioIntroPending: false,
    modelId: 'local-llm', sessionByMode: { storyboard: { id: 'chat-1' } },
    modeMessages: { storyboard: [] },
    modeElapsedByAssistantIndex: { storyboard: {} },
    modeMetricsByAssistantIndex: { storyboard: {} },
    jobId: '', requestDiagnostic: null
  };
  const requests = [];
  let persistCount = 0;
  const nodes = {
    'director-chat-empty-description': { textContent: '' }
  };
  const context = vm.createContext({
    state, Promise, performance: { now: () => 1234 },
    currentMessages: () => state.modeMessages.storyboard,
    syncModeUi: () => {}, startProgress: () => {}, finishProgress: () => {},
    studioDirectorRequestMessages: async messages => [{ role: 'system', content: 'Production rules' }, ...messages],
    requestJson: async (url, options) => {
      requests.push([url, JSON.parse(options.body)]);
      return { job: { jobId: 'job-1', request: { messages: [] } } };
    },
    trackTransientLlmJob: () => {}, waitForJob: async () => ({
      result: { text: 'What makes this idea worth watching?' }
    }),
    completedResponseMetrics: () => ({ generatedTokens: 7 }),
    renderMessages: () => {},
    persistSession: async () => { persistCount++; },
    el: id => nodes[id],
    window: { reportConsoleError: (name, error) => { throw error; } }
  });
  const start = vm.runInContext('(' + slice('  function startStudioWorkshop() {', '  function maybeOpenNewStudioConversation() {').trim() + ')', context);
  start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], '/fs/director/chat');
  assert.match(requests[0][1].messages.at(-1).content, /Let's develop an idea together/);
  assert.deepEqual(Array.from(state.modeMessages.storyboard, item => item.role), ['assistant']);
  assert.match(state.modeMessages.storyboard[0].content, /What makes this idea worth watching/);
  assert.equal(persistCount, 1);
  assert.equal(state.pending, false);
});

test('Studio combines server-owned production guidance with opted-in reference snapshots', async () => {
  const state = {
    workshop: null,
    storyboardAttachments: {
      'story:1': { label: 'Story: Example', content: '{"concept":"Something joyful"}' }
    }
  };
  const context = vm.createContext({
    state, Promise,
    STORYBOARD_WORKSHOP_PRIMER: 'Existing conversation primer',
    requestJson: async () => ({ system: 'Actual H3 production instructions' })
  });
  vm.runInContext(
    slice('  function storyboardRequestMessages(messages, includePrimer) {', '  function attachStoryboardContext(kind) {'),
    context
  );
  vm.runInContext(
    slice('  function studioDirectorRequestMessages(messages) {', '  function storyboardRequestMessages(messages, includePrimer) {'),
    context
  );
  const request = await vm.runInContext(
    'studioDirectorRequestMessages([{role:"user",content:"Tell me about Scene 1"}])',
    context
  );
  assert.match(request[0].content, /Actual H3 production instructions/);
  assert.match(request[1].content, /Something joyful/);
  assert.match(request[1].content, /Tell me about Scene 1/);
  assert.match(request[0].content, /STUDIO WORKBENCH STATE/);
  assert.doesNotMatch(request[0].content, /Existing conversation primer/);
});

test('Studio exposes Concept, Style and Invariants as one contextual capture, not a composer toolbar', () => {
  for (const id of [
    'director-studio-flow', 'director-studio-capture', 'director-studio-flow-target',
    'director-studio-attach-current', 'director-studio-more'
  ]) assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(html, /Concept \/ overview · Visual \/ atmosphere · Invariants/);
  assert.match(html, />Review new Story<\/button>/);
  assert.match(html, /Concept \/ overview <small>\(including Core Appeal\)<\/small>/);
  assert.match(html, /Visual \/ atmosphere <small>\(optional\)<\/small>/);
  const composer = sliceHtml('<div class="director-chat-composer">', '<textarea id="director-chat-input"');
  assert.doesNotMatch(composer, /director-studio-prepare|director-studio-starters/);
  assert.match(source, /captureStudioCreativeBrief/);
  assert.match(source, /if \(studioAttachedStoryId\(\)\) prepareStudioBrief\(\)/);
});

function sliceHtml(start, end) {
  const i = html.indexOf(start);
  const j = html.indexOf(end, i + start.length);
  assert.ok(i >= 0 && j > i);
  return html.slice(i, j);
}

test('Studio field capture keeps existing Project targets explicit', () => {
  const state = {
    activeMode: 'storyboard', modeMessages: {storyboard: [{role: 'user', content: 'A visual gag'}]},
    storyboardAttachments: {}, pending: false, attachmentPending: false,
    sessionReady: true, modelId: 'local'
  };
  const nodes = {};
  function node(id) {
    if (!nodes[id]) nodes[id] = {
      classList: { hidden: false, toggle(name, value) { if (name === 'hidden') this.hidden = value; } }
    };
    return nodes[id];
  }
  const context = vm.createContext({
    state, el: node, String, Object,
    window: { getStoryboardRouteTarget: () => ({storyId: 'story-1'}) }
  });
  vm.runInContext(slice('  function studioAttachedStoryId() {', '  function studioActionStatus('), context);
  const update = vm.runInContext('(' + slice('  function syncStudioFlow() {', '  function captureStudioCreativeBrief() {').trim() + ')', context);
  update();
  assert.equal(node('director-studio-capture').textContent, 'Review new Story');
  assert.equal(node('director-studio-flow-title').textContent, 'Working with: New Story');
  assert.equal(node('director-studio-flow-target').classList.hidden, false);
  state.storyboardAttachments['story:story-1'] = {label: 'Story', content: '{}'};
  update();
  assert.equal(node('director-studio-flow-target').classList.hidden, true);
  assert.equal(node('director-studio-capture').textContent, 'Review Story changes');
  assert.equal(node('director-studio-flow-title').textContent, 'Working with: Story');
  assert.equal(node('director-studio-flow').classList.hidden, false);
});

test('General Chat retains its own model request path', () => {
  const send = slice('  function sendMessage() {', '  function syncPinnedUi() {');
  assert.match(send, /activeChatMode === 'storyboard'\s*\? studioDirectorChatRequestMessages\(messages\)/);
  assert.match(send, /: Promise\.resolve\(messages\)/);
});

test('Studio is a label change, not a storage migration', () => {
  const shell = fs.readFileSync(path.join(__dirname, '..', 'tool/js/workspace_shell.js'), 'utf8');
  assert.match(shell, /workspaceTitle\.textContent = 'Studio'/);
  assert.match(shell, /closeStudioDirectorOnExit/);
  assert.match(html, /id="storyboard-workspace"/);
});


test('Studio keeps model dialogue and reviewed operation receipts in separate data', () => {
  assert.match(html, /id="director-studio-operation-history"/);
  assert.match(html, /id="director-studio-operation-list"/);
  assert.match(source, /function recordStudioOperation\(/);
  assert.match(source, /operations: operations/);
  assert.match(source, /state\.studioOperations = Array\.isArray\(chat\.operations\)/);
  assert.match(source, /recordStudioOperation\('project\.create'/);
  assert.match(source, /recordStudioOperation\('brief\.apply'/);
  assert.match(source, /recordStudioOperation\('scenes\.create'/);
  assert.match(source, /recordStudioOperation\('scene\.create'/);
  assert.doesNotMatch(source, /modeMessages\.storyboard\.push\(\{ role: 'assistant', content: receipt \}\)/);
  const section = slice('  function renderStudioOperations() {', '  function syncStudioFlow() {');
  assert.doesNotMatch(section, /modeMessages/);
  assert.match(section, /createElement\('div'\)/);
});


test('Studio Story access is a reference grant, not inline Story text', () => {
  for (const id of [
    'director-studio-access', 'director-studio-access-summary',
    'director-studio-access-field', 'director-studio-access-scene',
    'director-studio-access-read', 'director-studio-access-clear'
  ]) assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(source, /storyAccess: storyAccess/);
  assert.match(source, /state\.studioStoryAccess = chat\.storyAccess \|\| null/);
  assert.match(source, /function grantStudioStoryAccess\(/);
  assert.match(source, /function readStudioStoryScope\(/);
  assert.match(source, /!state\.studioStoryAccess \|\| \(key\.indexOf\('story:'\) !== 0/);
  assert.match(source, /toolsRow\.classList\.toggle\('hidden', studio \|\| !presets\.length\)/);
});


test('Director can request exactly one scoped Story read without adding tool text to chat', async () => {
  const functions = slice('  function parseStudioReadRequest(text) {', '  function storyboardRequestMessages(messages, includePrimer) {');
  const view = {textContent: '', classList: {remove() {}}};
  const status = {textContent: ''};
  let outbound;
  const messages = [{role: 'user', content: 'What is the dialogue in Scene 2?'}];
  const context = vm.createContext({
    Promise, JSON, String, Number, Error,
    state: {studioStoryAccess: {storyId: 'story-1'}, modelId: 'model', jobId: ''},
    el: id => id === 'director-studio-access-data' ? view : status,
    readStudioStoryScope: (field, sceneId) => Promise.resolve(field === 'index'
      ? {data: [{id: 'scene-1'}, {id: 'scene-2'}]}
      : {storyId: 'story-1', storyUpdatedAt: 'now', field, sceneId,
         data: {id: sceneId, summary: 'The speaker asks a question.'}}),
    studioDirectorRequestMessages: m => Promise.resolve(m),
    requestJson: (url, options) => {
      outbound = JSON.parse(options.body).messages;
      return Promise.resolve({job: {jobId: 'job-next'}});
    },
    trackTransientLlmJob: () => {},
    waitForJob: () => Promise.resolve({result: {text: 'She should say, "Really?"'}})
  });
  vm.runInContext(functions, context);
  const parse = vm.runInContext('parseStudioReadRequest', context);
  const resume = vm.runInContext('resumeStudioAfterRead', context);
  assert.equal(parse('A normal conversational reply'), null);
  assert.equal(parse('[[WEBCAP_READ:brief]]').field, 'brief');
  assert.equal(parse('[[WEBCAP_READ:scene:2]]').position, 2);
  assert.throws(() => parse('[[WEBCAP_READ:scene]]'), /invalid Scene selection/);
  const result = await resume(messages, {field: 'scene', position: 2});
  assert.equal(result.text, 'She should say, "Really?"');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content, 'What is the dialogue in Scene 2?');
  assert.match(outbound[outbound.length - 1].content, /WEBCAP CURRENT STORY READ/);
  assert.match(view.textContent, /speaker asks a question/);
  assert.match(status.textContent, /Director read scene/);
});

test('Ordinary chat uses on-demand read only when Story access exists', () => {
  const send = slice('  function sendMessage() {', '  function syncPinnedUi() {');
  assert.match(send, /studioDirectorChatRequestMessages\(messages\)/);
  assert.match(send, /resumeStudioAfterRead\(messages, read\)/);
  const scoped = slice('  function studioDirectorChatRequestMessages(messages) {', '  function parseStudioReadRequest(text) {');
  assert.match(scoped, /if \(state\.studioStoryAccess\)/);
  assert.match(scoped, /\[\[WEBCAP_READ:brief\]\]/);
  assert.doesNotMatch(scoped, /state\.modeMessages\.storyboard\.push/);
});

test('Explicit conversation capture prepares separate review, never auto-applies Story data', () => {
  const code = slice('  function parseStudioCaptureRequest(text) {', '  function parseStudioReadRequest(text) {');
  const context = vm.createContext({String, Error});
  vm.runInContext(code, context);
  const parse = vm.runInContext('parseStudioCaptureRequest', context);
  assert.equal(parse('[[WEBCAP_PREPARE:fields]]'), true);
  assert.equal(parse('We could use a warmer visual atmosphere.'), false);
  assert.throws(() => parse('[[WEBCAP_PREPARE:unknown]]'), /invalid capture request/);
  const chat = slice('  function studioDirectorChatRequestMessages(messages) {',
    '  function parseStudioCaptureRequest(text) {');
  assert.match(chat, /author explicitly asks to set, save, or/);
  const send = slice('  function sendMessage() {', '  function syncPinnedUi() {');
  assert.match(send, /pendingCapture = true/);
  assert.match(send, /if \(studioAttachedStoryId\(\)\) prepareStudioBrief\(\)/);
  assert.match(send, /else prepareStudioProject\(\)/);
  assert.doesNotMatch(send, /\/fs\/studio\/director\/brief[^\w]/);
  assert.doesNotMatch(send, /\/fs\/studio\/director\/project-create/);
});

test('Story changes invalidate scoped read previews and legacy snapshots remain clearable', () => {
  assert.match(html, /id="director-chat-attachments-clear"/);
  const record = slice('  function recordStudioOperation(', '  function renderStudioStoryAccess() {');
  assert.match(record, /state\.studioAccessIndex = null/);
  assert.match(record, /Inspect fields again/);
  const controls = slice("    el('director-chat-attachments-copy-all').onclick", "    el('director-chat-story-prepare').onclick");
  assert.match(controls, /director-chat-attachments-clear/);
  assert.match(controls, /state\.storyboardAttachments = \{\}/);
  assert.match(controls, /scheduleSessionSave\(\)/);
  assert.doesNotMatch(controls, /modeMessages\.storyboard =/);
});

test('Studio owns a separate context workspace beside the conversation', () => {
  const layout = html.indexOf('class="director-chat-layout"');
  const conversation = html.indexOf('class="director-chat-conversation"', layout);
  const sidebar = html.indexOf('class="director-chat-sidebar"', conversation);
  const chat = html.indexOf('id="director-chat-messages"', conversation);
  const composer = html.indexOf('class="director-chat-composer"', chat);
  const flow = html.indexOf('id="director-studio-flow"', sidebar);
  const access = html.indexOf('id="director-studio-access"', flow);
  const changes = html.indexOf('id="director-studio-operation-history"', flow);
  assert.ok(layout > 0 && conversation > layout);
  assert.ok(chat > conversation && composer > chat && composer < sidebar);
  assert.ok(sidebar > composer && flow > sidebar && access > flow && changes > flow);
  const css = fs.readFileSync(path.join(__dirname, '..', 'tool/css/workspace_shell.css'), 'utf8');
  assert.match(css, /\.director-chat-drawer\.studio-director \.director-chat-layout \{\s*display: grid/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) minmax\(260px, 35%\)/);
  assert.match(css, /@container \(max-width: 820px\)/);
  assert.match(css, /\.director-chat-drawer\.studio-director \.director-chat-messages \{\s*min-height: 0/);
});

test('Disconnect revokes legacy Story context and failed index reads propagate', () => {
  const disconnect = slice('  function clearStudioStoryAccess() {', '  function readStudioStoryScope(');
  assert.match(disconnect, /state\.storyboardAttachments = \{\}/);
  const readIndex = slice('  function loadStudioAccessIndex() {', '  function inspectStudioStoryScope() {');
  assert.match(readIndex, /throw error;/);
  assert.match(readIndex, /state\.studioAccessIndex = result\.data/);
});


test('Studio target is taken from the explicit Story grant, never whichever Story is open', () => {
  const state = {
    activeMode: 'storyboard', modeMessages: {storyboard: [{role:'user',content:'A visual gag'}]},
    storyboardAttachments: {}, studioStoryAccess: {storyId:'story-one',label:'My Story'},
    pending:false, attachmentPending:false, sessionReady:true, modelId:'model'
  };
  const nodes = {};
  function node(id) {
    return nodes[id] || (nodes[id] = {
      classList: {toggle(name, value) {if(name==='hidden')this.hidden=value;}}
    });
  }
  const context = vm.createContext({
    state, el: node, String, Object,
    window: { getStoryboardRouteTarget: () => ({storyId:'story-two'}) }
  });
  vm.runInContext(slice('  function studioAttachedStoryId() {', '  function studioActionStatus('), context);
  const sync = vm.runInContext('(' + slice('  function syncStudioFlow() {', '  function captureStudioCreativeBrief() {').trim() + ')', context);
  sync();
  assert.equal(node('director-studio-flow-title').textContent, 'Working with: My Story');
  assert.equal(node('director-studio-capture').textContent, 'Review Story changes');
  assert.equal(node('director-studio-flow-target').classList.hidden, false);
  assert.match(node('director-studio-flow-target-label').textContent, /different Story/);
  state.studioStoryAccess = null;
  sync();
  assert.equal(node('director-studio-flow-title').textContent, 'Working with: New Story');
  assert.equal(node('director-studio-capture').textContent, 'Review new Story');
});
