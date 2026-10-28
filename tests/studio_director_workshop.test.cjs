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
    slice('  function storyboardRequestMessages(messages) {', '  function attachStoryboardContext(kind) {'),
    context
  );
  vm.runInContext(
    slice('  function studioDirectorRequestMessages(messages) {', '  function storyboardRequestMessages(messages) {'),
    context
  );
  const request = await vm.runInContext(
    'studioDirectorRequestMessages([{role:"user",content:"Tell me about Scene 1"}])',
    context
  );
  assert.match(request[0].content, /Actual H3 production instructions/);
  assert.match(request[1].content, /Something joyful/);
  assert.match(request[1].content, /Tell me about Scene 1/);
});

test('General Chat retains its own model request path', () => {
  const send = slice('  function sendMessage() {', '  function syncPinnedUi() {');
  assert.match(send, /activeChatMode === 'storyboard'\s*\? studioDirectorRequestMessages\(messages\)/);
  assert.match(send, /: Promise\.resolve\(messages\)/);
});

test('Studio is a label change, not a storage migration', () => {
  const shell = fs.readFileSync(path.join(__dirname, '..', 'tool/js/workspace_shell.js'), 'utf8');
  assert.match(shell, /workspaceTitle\.textContent = 'Studio'/);
  assert.match(shell, /closeStudioDirectorOnExit/);
  assert.match(html, /id="storyboard-workspace"/);
});
