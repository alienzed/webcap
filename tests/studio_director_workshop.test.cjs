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
  vm.runInContext(part('  function studioDirectorRequestMessages(messages, includePromptContract) {',
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
  assert.match(workbench, /studio-dw-assessment-item/);
  assert.match(workbench, /button\.type = 'button'/);
  assert.match(workbench, /studio-dw-assessment-content'\)\.textContent = item\.content/);
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


test('Read offers whole Project, entire Scene, and compact multi-Scene overviews without media fields', () => {
  assert.match(workbench, /Entire Project brief/);
  assert.match(workbench, /Entire Scene/);
  assert.match(workbench, /All Scene overviews \(without H3 prompts\)/);
  assert.match(workbench, /input\[data-group-select\]/);
  const read = workbench.split('  function renderReadStory(story) {', 2)[1].split('  function updateReadSelection() {', 2)[0];
  assert.doesNotMatch(read, /'references'/);
});

test('reviewed Scene move and duplicate use deterministic WebCap operations, not extra LLM calls', () => {
  assert.match(html, /value="scene-move">Move Scene/);
  assert.match(html, /value="scene-duplicate">Duplicate Scene/);
  assert.match(html, /id="studio-dw-structure-review"/);
  const prepare = workbench.split('  function prepareStructure(operation, storyId) {')[1]
    .split('  function applyStructure() {')[0];
  assert.match(prepare, /flushStudioDirectorStoryEdits/);
  assert.match(prepare, /expectedSceneOrder:order/);
  assert.match(prepare, /expectedSourceUpdatedAt:scene.updatedAt/);
  assert.doesNotMatch(prepare, /makeProposal|\/fs\/director\/chat/);
  const apply = workbench.split('  function applyStructure() {')[1]
    .split('  function preparePlaybook() {')[0];
  assert.match(apply, /\/fs\/studio\/director\/scene-structure/);
  assert.match(apply, /recordApplied/);
  assert.match(apply, /saved, but conversation recording or refresh failed/);
});

test('multi-Scene review drafts together and applies selected fields in one atomic request', () => {
  assert.match(html, /value="scenes-batch">Revise several Scenes/);
  assert.match(html, /id="studio-dw-batch-review"/);
  assert.match(workbench, /makeProposal\(request, 'studio_scene_batch_draft', fields\.indexOf\('prompt'\) !== -1\)/);
  assert.match(workbench, /'scenes-batch'\) \{/);
  assert.match(workbench, /function renderBatchReview\(\)/);
  const applied = workbench.split('  function applyBatchScenes() {')[1]
    .split('  function prepareStructure(operation, storyId) {')[0];
  assert.match(applied, /\/fs\/studio\/director\/scene-fields-batch/);
  assert.match(applied, /flushStudioDirectorStoryEdits/);
  assert.match(applied, /savedFieldsByScene/);
  assert.match(applied, /recordApplied/);
});

test('Scene split reviews both Intent changes and saves one atomic operation', () => {
  assert.match(html, /value="scene-split">Split Scene/);
  assert.match(html, /id="studio-dw-split-review"/);
  assert.match(workbench, /makeProposal\(request,'studio_scene_split_draft'\)/);
  const apply = workbench.split('  function applySplitScene() {')[1]
    .split('  function prepareBatchScenes(storyId) {')[0];
  assert.match(apply, /\/fs\/studio\/director\/scene-split/);
  assert.match(apply, /flushStudioDirectorStoryEdits/);
  assert.match(apply, /recordApplied\('scene.split'/);
  assert.match(apply, /Review the original H3 Prompt/);
});


test('existing Scene Prompt Write includes saved duration and linked Invariant IDs', () => {
  const single = workbench.split('  function editScene(story, sceneId, fields) {')[1]
    .split('  function showSceneReview(')[0];
  const batch = workbench.split('  function prepareBatchScenes(storyId) {')[1]
    .split('  function renderBatchReview() {')[0];
  const preview = workbench.split('  function showWriteContext() {')[1]
    .split('  function updateScope() {')[0];
  assert.match(single,/durationSeconds:scene\.durationSeconds,invariantRefs:scene\.invariantRefs/);
  assert.match(single,/selected Scene durationSeconds/);
  assert.match(batch,/durationSeconds:scene\.durationSeconds, invariantRefs:scene\.invariantRefs/);
  assert.match(batch,/each selected Scene to its own durationSeconds/);
  assert.match(preview,/durationSeconds:scene\.durationSeconds,invariantRefs:scene\.invariantRefs/);
  assert.doesNotMatch(single,/durationSeconds.*selected keys/);
});

test('H3 detailed authoring contract is sent only for an explicit Prompt-field draft', async () => {
  const state = {studioStoryAccess:null,storyboardAttachments:{},workshop:null};
  const context = vm.createContext({
    state,Object,String,Promise,
    requestJson:async () => ({
      system:'Small creative guidance',actions:[],
      promptContract:'[Shot 1] Full H3 authoring contract'
    })
  });
  vm.runInContext(part('  function studioDirectorRequestMessages(messages, includePromptContract) {',
    '  function studioDirectorChatRequestMessages(messages) {'),context);
  const ordinary = await vm.runInContext(
    "studioDirectorRequestMessages([{role:'user',content:'Discuss scene'}])",context);
  const detailed = await vm.runInContext(
    "studioDirectorRequestMessages([{role:'user',content:'Draft H3 Prompt'}],true)",context);
  assert.doesNotMatch(ordinary[0].content,/Full H3 authoring contract/);
  assert.match(detailed[0].content,/Full H3 authoring contract/);
  assert.match(workbench,/fields\.indexOf\('prompt'\) !== -1/);
});

test('Studio conversation receives the canonical H3 template as reference without an automatic Write', async () => {
  const template = fs.readFileSync(path.join(__dirname, '..', 'docs/mmh3-prompt-runtime-context.txt'), 'utf8').trim();
  const state = {studioStoryAccess:null,storyboardAttachments:{},workshop:null};
  const context = vm.createContext({
    state,Object,String,Promise,
    requestJson:async () => ({system:'Studio guidance',actions:[],promptContract:template})
  });
  vm.runInContext(part('  function studioDirectorRequestMessages(messages, includePromptContract) {',
    '  // The creative assessment is advisory.'),context);
  const result = await vm.runInContext(
    "studioDirectorChatRequestMessages([{role:'user',content:'How should an H3 prompt be structured?'}])",context);
  assert.equal(result.length,2);
  assert.match(result[0].content,/H3 PRODUCTION PROMPT REFERENCE/);
  assert.match(result[0].content,/integrated_multimodal_description:/);
  assert.match(result[0].content,/overall_soundscape:/);
  assert.match(result[0].content,/non_diegetic_music:/);
  assert.match(result[0].content,/not when authoring Scene Intent/);
  assert.equal(result[1].content,'How should an H3 prompt be structured?');
  assert.doesNotMatch(result[0].content,/\[WEBCAP EXPLICIT READ\]/);
});

test('large explicit Read selections report their true size and refuse silent truncation', () => {
  assert.match(workbench,/JSON\.stringify\(payload\)\.length/);
  assert.match(workbench,/length > 48000/);
  assert.match(workbench,/Narrow the selection to a Project overview/);
});

test('Character and Location associations use reviewed deterministic multi-Scene edits', () => {
  assert.match(html,/value="scene-invariants">Use Invariant in Scenes/);
  assert.match(html,/id="studio-dw-invariant-review"/);
  assert.match(workbench,/function prepareInvariantLinks\(storyId\)/);
  assert.match(workbench,/function applyInvariantLinks\(\)/);
  const prepare = workbench.split('  function prepareInvariantLinks(storyId) {')[1]
    .split('  function applyInvariantLinks() {')[0];
  assert.doesNotMatch(prepare,/makeProposal|\/fs\/director\/chat/);
  const apply = workbench.split('  function applyInvariantLinks() {')[1]
    .split('  function prepareSplitScene(storyId) {')[0];
  assert.match(apply,/\/fs\/studio\/director\/scene-invariants/);
  assert.match(apply,/recordApplied/);
});

test('multi-Scene review preserves actual Project positions and distinguishes a saved Scene from receipt failure', () => {
  assert.match(workbench, /position:\(story\.sceneOrder \|\| \[\]\)\.indexOf\(id\) \+ 1/);
  assert.match(workbench, /heading\.textContent = 'Scene ' \+ entry\.before\.position/);
  const apply = workbench.split('  function applyScene() {')[1]
    .split('  function setReadinessFreshness(stale) {')[0];
  assert.match(apply, /applied = true/);
  assert.match(apply, /Scene saved, but conversation recording or refresh failed/);
});
