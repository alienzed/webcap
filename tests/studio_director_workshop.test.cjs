const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'tool/js/director_chat.js'), 'utf8');
const workbench = fs.readFileSync(path.join(__dirname, '..', 'tool/js/studio_director_workbench.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'tool/tool.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'tool/css/workspace_shell.css'), 'utf8');

function part(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Missing Director source block: ' + start);
  return source.slice(a, b);
}

test('Studio has a wide conversation and a real side-panel Read/Write workbench', () => {
  for (const id of [
    'director-chat-drawer', 'director-chat-messages', 'director-chat-input',
    'studio-director-workbench', 'studio-dw-read', 'studio-dw-write',
    'studio-dw-read-project', 'studio-dw-write-project', 'studio-dw-scene-fields',
    'studio-dw-read-send', 'studio-dw-write-prepare', 'studio-dw-readiness-list',
    'studio-dw-write-context-json', 'studio-dw-scene-review', 'studio-dw-playbook-review'
  ]) assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(html, /class="director-chat-layout"/);
  assert.match(html, /class="director-chat-sidebar"/);
  assert.match(html, /static\/js\/studio_director_workbench\.js/);
  assert.match(css, /\.director-chat-drawer\.studio-director #director-studio-flow \{ display: none !important; \}/);
  assert.match(css, /studio-dw-actions/);
  assert.match(css, /font-size:16px/);
});

test('New Director conversation is passive until the author explicitly sends', () => {
  const newChat = part('  function newChat(options) {', '  function jobRequest(jobId) {');
  assert.doesNotMatch(newChat, /startStudioWorkshop\(/);
  assert.match(newChat, /flushSessionSave/);
  assert.match(newChat, /state\.modeMessages\.storyboard = \[\]/);
  assert.match(source, /director-studio-retry'\)\.classList\.add\('hidden'\)/);
});

test('Only explicitly supplied conversation content is sent; legacy snapshots are not silently re-injected', async () => {
  const state = {
    studioStoryAccess: null,
    storyboardAttachments: {'story:1': {label: 'Legacy Story', content: '{"concept":"Historical secret"}'}},
    workshop: null
  };
  const context = vm.createContext({
    state, Object, String, Promise,
    requestJson: async () => ({
      system: 'Authoritative expertise',
      actions: [{name: 'context.read', status: 'available',
        description: 'Explicitly delivered fields only'}]
    })
  });
  vm.runInContext(part('  function studioDirectorRequestMessages(messages) {',
    '  function studioDirectorChatRequestMessages(messages) {'), context);
  const result = await vm.runInContext(
    'studioDirectorRequestMessages([{role:"user",content:"Develop the idea"}])', context);
  assert.equal(result.length, 2);
  assert.match(result[0].content, /Authoritative expertise/);
  assert.match(result[0].content, /CURRENT WEBCAP CAPABILITIES/);
  assert.match(result[0].content, /STUDIO WORKBENCH STATE/);
  assert.doesNotMatch(result[0].content, /Historical secret/);
  assert.equal(result[1].content, 'Develop the idea');
});

test('Read sends actual selected data as a visible conversation event and expects LLM receipt', () => {
  const state = {open: true, activeMode: 'storyboard', sessionReady: true,
    pending: false, attachmentPending: false, modelId: 'local-model'};
  const composer = {value: 'Please inspect this Project'};
  let outgoing = '';
  const context = vm.createContext({
    state, Promise, String, JSON,
    el: id => {
      assert.equal(id, 'director-chat-input');
      return composer;
    },
    studioAttachedStoryId: () => '',
    sendMessage: () => {outgoing = composer.value;},
    window: {}
  });
  vm.runInContext(part('  window.studioDirectorBridge = {',
    '  window.syncStoryboardAssistantStory = function'), context);
  const payload = {projectId: 'story-one', fields:[
    {id: 'project.concept', value: 'A meaningful conversation'},
    {id: 'scene:scene-two:summary', value: 'The question begins'}
  ]};
  context.window.studioDirectorBridge.sendRead(
    payload, ['project.concept', 'scene:scene-two:summary']);
  assert.match(outgoing, /Please inspect this Project/);
  assert.match(outgoing, /\[WEBCAP EXPLICIT READ\]/);
  assert.match(outgoing, /A meaningful conversation/);
  assert.match(outgoing, /RECEIVED: project\.concept, scene:scene-two:summary/);
  assert.equal(state.pendingReadAck.length, 2);
  assert.match(source, /Director acknowledgement mismatch/);
  assert.match(source, /reportConsoleError\('Studio Read acknowledgement'/);
  assert.match(source, /\[WEBCAP APPLIED FIELD VALUES\]/);
});

test('Ordinary Studio conversation has no model-requested hidden Read or capture token', () => {
  const send = part('  function sendMessage() {', '  function syncPinnedUi() {');
  assert.match(send, /studioDirectorChatRequestMessages\(messages\)/);
  assert.match(send, /: Promise\.resolve\(messages\)/);
  assert.doesNotMatch(source, /parseStudioReadRequest|resumeStudioAfterRead|parseStudioCaptureRequest/);
  assert.doesNotMatch(send, /pendingCapture/);
});

test('Readiness proposals are bounded, inspectable, read-only and do not block Write', () => {
  assert.match(source, /\[\[WEBCAP_READINESS\]\]/);
  assert.match(source, /window\.studioDirectorWorkbench\.updateReadiness/);
  assert.match(workbench, /checkbox\.type = 'checkbox'/);
  assert.match(workbench, /checkbox\.disabled = true/);
  assert.match(workbench, /content\.textContent = item\.content/);
  assert.match(workbench, /recommendations\.readHints/);
  assert.match(workbench, /recommendations\.writeHint/);
  assert.match(html, /id="studio-dw-readiness-list"/);
});

test('Write preserves reviewed Apply and carries final saved content into conversation', () => {
  for (const path of [
    '/fs/studio/director/brief',
    '/fs/studio/director/scene-draft',
    '/fs/studio/director/scenes-draft',
    '/fs/studio/director/project-create'
  ]) assert.ok(source.includes(path), path);
  assert.match(workbench, /\/fs\/studio\/director\/scene-fields/);
  assert.match(workbench, /\/fs\/studio\/director\/playbook/);
  assert.match(source, /recordApplied: function/);
  assert.match(source, /return persistSession\('storyboard'\)/);
  assert.match(source, /\[WEBCAP APPLIED FIELD VALUES\]/);
  assert.match(source, /window\.studioDirectorBridge\.recordApplied/);
  assert.match(workbench, /flushStudioDirectorStoryEdits/);
});

test('General Chat has a separate request path and Studio keeps native storage IDs', () => {
  const send = part('  function sendMessage() {', '  function syncPinnedUi() {');
  assert.match(send, /activeChatMode === 'storyboard'\s*\? studioDirectorChatRequestMessages\(messages\)/);
  assert.match(send, /: Promise\.resolve\(messages\)/);
  const shell = fs.readFileSync(path.join(__dirname, '..', 'tool/js/workspace_shell.js'), 'utf8');
  assert.match(shell, /workspaceTitle\.textContent = 'Studio'/);
  assert.match(html, /id="storyboard-workspace"/);
  assert.match(source, /state\.studioOperations = Array\.isArray\(chat\.operations\)/);
});
