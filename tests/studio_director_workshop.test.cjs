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
    'studio-dw-write-context-json', 'studio-dw-scene-review', 'studio-dw-batch-review'
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
  vm.runInContext(part('  function studioDirectorRequestMessages(messages, includePromptContract, explicitWrite) {',
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

test('Studio prompting selects the current goal rather than steering every task to Project edits', async () => {
  const context = vm.createContext({
    state: {studioStoryAccess:null,storyboardAttachments:{},workshop:null},
    Object, String, Promise,
    requestJson: async () => ({
      system: 'WebCap Studio Director role',
      actions: [
        {name:'context.read',status:'available',description:'Read chosen saved fields'},
        {name:'scene.revise',status:'available',description:'Revise Scene Intent or H3 Prompt'}
      ],
      promptContract:'integrated_multimodal_description: [Shot 1]'
    })
  });
  vm.runInContext(part('  function studioDirectorRequestMessages(messages, includePromptContract, explicitWrite) {',
    '  // The creative assessment is advisory.'),context);
  const assembled = await vm.runInContext(
    "studioDirectorChatRequestMessages([{role:'user',content:'Revise only the Scene action'}])",context);
  const system = assembled[0].content;
  assert.match(system,/For the current author goal, suggest at most one useful next step/);
  assert.match(system,/an explicit Read, an appropriately scoped reviewed Write, or an author-operated Studio action/);
  assert.doesNotMatch(system,/When choices are clear, offer to review Concept/);
  assert.match(system,/Keep readiness light: normally checks=\[\]/);
  assert.match(system,/If assessment is genuinely useful, provide at most two concise checks/);
  assert.match(system,/H3 PRODUCTION PROMPT REFERENCE/);
  assert.equal(assembled[1].content,'Revise only the Scene action');
  assert.equal(assembled.length,2, 'no extra request or hidden context event');
});

test('explicit Write guidance asks for the draft, not another conversational recommendation', async () => {
  const context = vm.createContext({
    state:{studioStoryAccess:null,storyboardAttachments:{}},
    Object,String,Promise,
    requestJson:async()=>({system:'Studio producer expertise',actions:[]})
  });
  vm.runInContext(part('  function studioDirectorRequestMessages(messages, includePromptContract, explicitWrite) {',
    '  function studioDirectorChatRequestMessages(messages) {'),context);
  const conversational = await vm.runInContext(
    "studioDirectorRequestMessages([{role:'user',content:'Discuss Scene'}],false)",context);
  const writing = await vm.runInContext(
    "studioDirectorRequestMessages([{role:'user',content:'Revise Scene'}],false,true)",context);
  assert.match(conversational[0].content,/suggest at most one useful next step/);
  assert.doesNotMatch(writing[0].content,/suggest at most one useful next step/);
  assert.match(writing[0].content,/EXPLICIT REVIEWED WRITE/);
  assert.match(writing[0].content,/Produce the requested complete editable proposal/);
  assert.equal(writing[1].content,'Revise Scene');
  assert.match(source,/studioDirectorRequestMessages\(\[\{role:'user',content:instruction\}\], includePromptContract, true\)/);
});

test('existing Project and Scene draft paths also use explicit Write guidance', () => {
  for (const operation of ['studio_project_draft', 'studio_brief_draft',
      'studio_scene_sequence_draft', 'studio_scene_draft']) {
    const marker = "showSentWriteContext('" + operation + "', messages)";
    const index = source.indexOf(marker);
    assert.ok(index !== -1, 'Missing draft operation: ' + operation);
    const before = source.slice(Math.max(0, index - 850), index);
    const plain = "studioDirectorRequestMessages([{ role: 'user', content: JSON.stringify(input) }], false, true)";
    const formatted = "studioDirectorRequestMessages([{ role: 'user', content: JSON.stringify(input, null, 2) }], false, true)";
    assert.ok(before.includes(plain) || before.includes(formatted),
      'Explicit Write guidance not used by ' + operation);
  }
});

test('single-Scene revision request uses its saved ID in the example, not a placeholder', () => {
  const batch = workbench.split('  function prepareBatchScenes(storyId) {')[1]
    .split('  function renderBatchReview() {')[0];
  assert.match(batch,/ids\.length === 1/);
  assert.match(batch,/JSON\.stringify\(\{scenes:\[\{sceneId:ids\[0\],summary:/);
  assert.doesNotMatch(batch,/ACTUAL_SELECTED_ID/);
  assert.match(batch,/summary \(Scene Intent\)/);
  assert.match(batch,/prompt \(H3 Prompt\)/);
  assert.match(batch,/validateSceneRevisionDraft\(result, ids, selected, raw\)/);
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
  assert.match(outgoing, /Address only any question explicitly asked above; otherwise stop after the receipt/);
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
  assert.match(source, /parseStudioChatResponse\(result.text\)/);
  assert.match(source, /operation: activeChatMode === 'storyboard' \? 'studio_chat' : 'freeform_chat'/);
  assert.doesNotMatch(source,/WEBCAP_READINESS/);
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
  assert.doesNotMatch(workbench, /\/fs\/studio\/director\/playbook/);
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


test('Read offers one Project Overview and per-Scene complete selections without media fields', () => {
  assert.match(workbench, /addUnit\('Project Overview', overview, fields/);
  assert.match(workbench, /addUnit\('Scene ' \+ \(index \+ 1\)/);
  assert.match(workbench, /\['title', 'summary', 'prompt', 'durationSeconds'\]/);
  assert.match(workbench, /input\[data-group-select\]:checked/);
  assert.match(html, /Scenes · select complete Scenes/);
  const read = workbench.split('  function renderReadStory(story) {', 2)[1].split('  function selectedPaths() {', 2)[0];
  assert.doesNotMatch(read, /'references'/);
  assert.doesNotMatch(read, /'generationSettings'/);
  assert.doesNotMatch(read, /addField\(/);
});

test('retired Director structural UI is absent', () => {
  assert.doesNotMatch(html, /id="studio-dw-structure-review"/);
  assert.doesNotMatch(workbench, /function prepareStructure\(/);
});

test('multi-Scene review drafts together and applies selected fields in one atomic request', () => {
  assert.match(html, /value="scene-write">Write Scenes/);
  assert.match(html, /id="studio-dw-scene-mode"/);
  assert.match(html, /id="studio-dw-batch-review"/);
  assert.match(workbench, /makeProposal\(request, 'studio_scene_batch_draft', true\)/);
  assert.match(workbench, /el\('studio-dw-scene-mode'\)\.value === 'revise'/);
  assert.match(workbench, /function renderBatchReview\(\)/);
  const applied = workbench.split('  function applyBatchScenes() {')[1]
    .split('  function applyScene() {')[0];
  assert.match(applied, /\/fs\/studio\/director\/scene-fields-batch/);
  assert.match(applied, /flushStudioDirectorStoryEdits/);
  assert.match(applied, /savedFieldsByScene/);
  assert.match(applied, /recordApplied/);
});

test('Scene splitting is not a Director Write operation', () => {
  assert.doesNotMatch(html, /id="studio-dw-split-review"/);
  assert.doesNotMatch(workbench, /function prepareSplitScene\(/);
});

test('batch Scene revisions include duration and linked Invariants', () => {
  const batch = workbench.split('  function prepareBatchScenes(storyId) {')[1]
    .split('  function renderBatchReview() {')[0];
  const preview = workbench.split('  function showWriteContext() {')[1]
    .split('  function updateScope() {')[0];
  assert.match(batch, /durationSeconds:scene\.durationSeconds, invariantRefs:scene\.invariantRefs/);
  assert.match(batch, /each Scene to its durationSeconds/);
  assert.match(preview, /durationSeconds:scene\.durationSeconds,invariantRefs:scene\.invariantRefs/);
});

test('H3 detailed authoring contract is included when Director may propose a Prompt revision', async () => {
  const state = {studioStoryAccess:null,storyboardAttachments:{},workshop:null};
  const context = vm.createContext({
    state,Object,String,Promise,
    requestJson:async () => ({
      system:'Small creative guidance',actions:[],
      promptContract:'[Shot 1] Full H3 authoring contract'
    })
  });
  vm.runInContext(part('  function studioDirectorRequestMessages(messages, includePromptContract, explicitWrite) {',
    '  function studioDirectorChatRequestMessages(messages) {'),context);
  const ordinary = await vm.runInContext(
    "studioDirectorRequestMessages([{role:'user',content:'Discuss scene'}])",context);
  const detailed = await vm.runInContext(
    "studioDirectorRequestMessages([{role:'user',content:'Draft H3 Prompt'}],true)",context);
  assert.doesNotMatch(ordinary[0].content,/Full H3 authoring contract/);
  assert.match(detailed[0].content,/Full H3 authoring contract/);
  assert.match(workbench, /makeProposal\(request, 'studio_scene_batch_draft', true\)/);
});

test('Studio conversation receives the canonical H3 template as reference without an automatic Write', async () => {
  const template = fs.readFileSync(path.join(__dirname, '..', 'docs/mmh3-prompt-runtime-context.txt'), 'utf8').trim();
  const state = {studioStoryAccess:null,storyboardAttachments:{},workshop:null};
  const context = vm.createContext({
    state,Object,String,Promise,
    requestJson:async () => ({system:'Studio guidance',actions:[],promptContract:template})
  });
  vm.runInContext(part('  function studioDirectorRequestMessages(messages, includePromptContract, explicitWrite) {',
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
  assert.match(workbench,/Select the Project Overview or fewer Scenes/);
});

test('standalone Invariant linking is not a Director Write operation', () => {
  assert.doesNotMatch(html, /id="studio-dw-invariant-review"/);
  assert.doesNotMatch(workbench, /function prepareInvariantLinks\(/);
  assert.doesNotMatch(workbench, /function applyInvariantLinks\(/);
});

test('multi-Scene review preserves actual Project positions and distinguishes a saved Scene from receipt failure', () => {
  assert.match(workbench, /position:\(story\.sceneOrder \|\| \[\]\)\.indexOf\(id\) \+ 1/);
  assert.match(workbench, /heading\.textContent = 'Scene ' \+ entry\.before\.position/);
  const apply = workbench.split('  function applyScene() {')[1]
    .split('  function setReadinessFreshness(stale) {')[0];
  assert.match(apply, /applied = true/);
  assert.match(apply, /Scene saved, but conversation recording or refresh failed/);
});

test('legacy Studio field Read remains a neutral context handoff by default', () => {
  const read = source.split('  function inspectStudioStoryScope() {')[1]
    .split('  function syncStudioFlow() {')[0];
  assert.match(read, /Acknowledge the saved context without assessing it or suggesting next steps/);
  assert.doesNotMatch(read, /give a concise substantive assessment/);
  assert.match(source, /state\.pendingReadAck = keys\.slice\(\)/);
  assert.match(source, /Address only any question explicitly asked above; otherwise stop after the receipt/);
});
