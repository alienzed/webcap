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

test('Director overlays Projects as a resizable drawer with an optional manual workbench', () => {
  for (const id of [
    'director-chat-drawer', 'director-chat-messages', 'director-chat-input',
    'studio-director-workbench', 'studio-dw-read', 'studio-dw-write',
    'studio-dw-read-project', 'studio-dw-write-project', 'studio-dw-scene-fields',
    'studio-dw-read-send', 'studio-dw-write-prepare',
    'studio-dw-write-context-json', 'studio-dw-scene-review', 'studio-dw-batch-review'
  ]) assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(html, /class="director-chat-layout"/);
  assert.match(html, /class="director-chat-sidebar"/);
  assert.match(html, /static\/js\/studio_director_workbench\.js/);
  assert.match(css,/studio-director/);
  assert.match(css, /studio-dw-actions/);
  assert.match(css, /font-size:16px/);
  assert.match(css,/studio-director/);
  assert.match(css,/\.app-frame\.director-chat-pinned\.studio-director-active \{grid-template-columns:42px minmax\(0,1fr\)/);
  assert.doesNotMatch(css,/\.studio-director-active > \.storyboard-workspace \{visibility:hidden;/);
  assert.match(html,/aria-label="Resize Director"/);
  assert.match(html,/id="storyboard-open-director"/);
  assert.match(html,/id="studio-dw-open-tools"/);
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
    state, Object, String, Promise, window:{getStudioDirectorNavigation:()=>({})},
    requestJson: async () => ({
      chatSystem:'Authoritative expertise',system:'Focused Writer',
      actions: [{name: 'context.read', status: 'available',
        description: 'Explicitly delivered fields only'}]
    })
  });
  vm.runInContext(part('  function studioConversationMessages(messages) {',
    '  function studioDirectorChatRequestMessages(messages) {'), context);
  const result = await vm.runInContext(
    'studioDirectorRequestMessages([{role:"user",content:"Develop the idea"}])', context);
  assert.equal(result.length, 2);
  assert.match(result[0].content, /Authoritative expertise/);
  assert.doesNotMatch(result[0].content, /CURRENT WEBCAP CAPABILITIES/);
  assert.doesNotMatch(result[0].content, /STUDIO WORKBENCH STATE/);
  assert.doesNotMatch(result[0].content, /CURRENT PROJECT NAVIGATION/);
  assert.doesNotMatch(result[0].content, /Historical secret/);
  assert.equal(result[1].content, 'Develop the idea');
});

test('Studio conversation does not silently inject the selected Project as creative context', async()=>{
  const scope=vm.createContext({
    state:{studioStoryAccess:null,studioApprovedRead:null,storyboardAttachments:{},
      studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{}}},
    Object,String,Promise,
    window:{getStudioDirectorNavigation:()=>({projectId:'p1',sceneOrder:[]})},
    studioAttachedStoryId:()=>'',requestJson:async url=>
      url.startsWith('/fs/studio/director/guidance')
        ? {chatSystem:'Conversation',system:'Focused Writer',actions:[],promptContract:'H3 template'}
        : {story:{id:'p1',concept:'Private Project',sceneOrder:[]}}
  });
  vm.runInContext(part('  function studioConversationMessages(messages) {',
    '  // Retain available conversational work across ordinary follow-up questions.'),scope);
  const out=await vm.runInContext(
    "studioDirectorChatRequestMessages([{role:'user',content:'Create a new Project'}])",scope);
  assert.match(out[0].content,/No saved Project or Scene reference was supplied/);
  assert.doesNotMatch(out[0].content,/Private Project/);
  assert.equal(out[1].content,'Create a new Project');
});
test('explicit Writes stay task-scoped without duplicating application instructions',async()=>{
  const context=vm.createContext({
    state:{studioStoryAccess:null,storyboardAttachments:{},
      studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{}}},
    Object,String,Promise,window:{getStudioDirectorNavigation:()=>({})},
    requestJson:async()=>({chatSystem:'Studio conversation',system:'Studio producer expertise',actions:[],
      promptContract:'H3 production reference'})
  });
  vm.runInContext(part('  function studioConversationMessages(messages) {',
    '  function studioDirectorChatRequestMessages(messages) {'),context);
  const conversational=await vm.runInContext(
    "studioDirectorRequestMessages([{role:'user',content:'Discuss Scene'}],false)",context);
  const writing=await vm.runInContext(
    "studioDirectorRequestMessages([{role:'user',content:'Revise Scene'}],true,true)",context);
  assert.equal(conversational[0].content,'Studio conversation');
  assert.match(writing[0].content,/H3 production reference/);
  assert.doesNotMatch(writing[0].content,/CURRENT PROJECT NAVIGATION|CURRENT WEBCAP CAPABILITIES|STUDIO WORKBENCH STATE/);
  assert.equal(writing[1].content,'Revise Scene','the specific authoring task stays in the current user request');
  assert.match(source,/studioDirectorRequestMessages\(\[\{role:'user',content:instruction\}\], includePromptContract, true, navigationSnapshot\)/);
});

test('active Project draft paths use explicit Write guidance', () => {
  for (const operation of ['studio_project_draft', 'studio_brief_draft']) {
    const marker = "showSentWriteContext('" + operation + "', messages)";
    const index = source.indexOf(marker);
    assert.ok(index !== -1, 'Missing draft operation: ' + operation);
    const before = source.slice(Math.max(0, index - 1400), index);
    assert.match(before,/studioDirectorRequestMessages\(/,
      'Explicit Write guidance not used by ' + operation);
  }
});


test('old single and sequence authoring machinery is disconnected; current Draft panel uses canonical writers',()=>{
  assert.doesNotMatch(source,/function prepareStudioScenes\(|function prepareStudioSceneDraft\(|studio_scene_sequence_draft|studio_scene_draft/);
  assert.doesNotMatch(source,/director-studio-prepare-scenes|director-studio-prepare-scene/);
  assert.doesNotMatch(html,/id="director-studio-prepare-scenes"|id="director-studio-prepare-scene"|id="director-studio-more"/);
  assert.match(workbench,/writeNewScene\(\{/);
  assert.match(workbench,/function prepareBatchScenes\(storyId\)/);
  assert.match(workbench,/writeSelectedScene\(\{/);
  assert.match(source,/writeNewScene: function \(launch\)/);
  assert.match(source,/writeSelectedScene: function \(launch\)/);
  assert.match(html,/id="studio-scenes-review"/);
});

test('selected Scene revisions use bounded direct-save calls against real Scene IDs',()=>{
  const batch=workbench.split('  function prepareBatchScenes(storyId) {')[1]
    .split('  function renderBatchReview() {')[0];
  assert.match(batch,/writeSelectedScene\(\{/);
  assert.match(batch,/projectId:storyId,sceneId:id,instruction:instruction/);
  assert.match(batch,/saved\.push\(label\)/);
  assert.match(batch,/notAttempted/);
  assert.doesNotMatch(batch,/makeProposal\(/,'no giant multi-Scene LLM response');
});

test('selected list binds destination before issuing each per-Scene write',()=>{
  const batch=workbench.split('  function prepareBatchScenes(storyId) {')[1]
    .split('  function renderBatchReview() {')[0];
  assert.match(batch,/selectWriteProject\(story\.id,storyName\(story\)\)/);
  assert.match(batch,/sceneOrder\.includes\(id\)/);
  assert.match(batch,/flushStudioDirectorStoryEdits\(storyId\)/);
});

test('Context approval only records chosen source; it does not send a model request',()=>{
  assert.match(workbench,/studioDirectorBridge\.approveRead\(story\.id, keys\)/);
  assert.doesNotMatch(workbench,/sendRead\(payload, keys, typeof instruction/);
  assert.match(html,/id="studio-dw-read-send"[^>]*>Approve context/);
});
test('Ordinary Studio conversation has no model-requested hidden Read or capture token', () => {
  const send = part('  function sendMessage() {', '  function syncPinnedUi() {');
  assert.match(send, /studioDirectorChatRequestMessages\(messages\)/);
  assert.match(send, /: Promise\.resolve\(messages\)/);
  assert.doesNotMatch(source, /parseStudioReadRequest|resumeStudioAfterRead|parseStudioCaptureRequest/);
  assert.doesNotMatch(send, /pendingCapture/);
});

test('Studio conversation no longer routes through model readiness or capture',()=>{
  assert.doesNotMatch(source,/parseStudioChatResponse\(result.text\)/);
  assert.match(source,/studioDirectorWorkbench\.presentAction/); // legacy review compatibility only
  assert.doesNotMatch(source,/studioDirectorWorkbench\.updateReadiness\(studioResponse/);
  assert.doesNotMatch(workbench,/recommendations\.writeHint|recommendations\.readHints/);
  assert.doesNotMatch(workbench,/studio-dw-assessment-item/);
  assert.doesNotMatch(source,/function studioActionFromExplicitRequest/);
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


test('Context selects Overview and full Scenes without media fields', () => {
  assert.match(workbench, /addUnit\('Overview', overview, fields/);
  assert.match(workbench, /addUnit\('Scene ' \+ \(index \+ 1\)/);
  assert.match(workbench, /\['title', 'prompt', 'durationSeconds'\]/);
  assert.match(workbench, /input\[data-group-select\]:checked/);
  assert.match(html, /id="studio-dw-read-selection-summary">Overview \+ selected Scene<\/summary>/);
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
  assert.match(html, /value="scene-write">Scenes/);
  assert.match(html, /id="studio-dw-scene-mode"/);
  assert.match(html, /id="studio-dw-batch-review"/);
  assert.match(workbench, /writeSelectedScene\(\{/);
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

test('bounded Scene writer receives saved duration and linked constraints',()=>{
  const writer=source.split('    writeSelectedScene: function (launch) {')[1]
    .split('    makeProposal: function (')[0];
  const preview=workbench.split('  function showWriteContext() {')[1]
    .split('  function updateScope() {')[0];
  assert.match(writer,/sceneRead\(story,sceneId\)/);
  assert.match(writer,/durationSeconds/);
  assert.match(preview,/durationSeconds:scene\.durationSeconds,invariantRefs:scene\.invariantRefs/);
});

test('H3 detailed authoring contract is included when Director may propose a Prompt revision', async () => {
  const state = {studioStoryAccess:null,storyboardAttachments:{},workshop:null,studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{}}};
  const context = vm.createContext({
    state,Object,String,Promise,window:{getStudioDirectorNavigation:()=>({})},
    requestJson:async () => ({
      chatSystem:'Small conversation guidance',system:'Focused Writer',actions:[],
      promptContract:'[Shot 1] Full H3 authoring contract'
    })
  });
  vm.runInContext(part('  function studioConversationMessages(messages) {',
    '  function studioDirectorChatRequestMessages(messages) {'),context);
  const ordinary = await vm.runInContext(
    "studioDirectorRequestMessages([{role:'user',content:'Discuss scene'}])",context);
  const detailed = await vm.runInContext(
    "studioDirectorRequestMessages([{role:'user',content:'Draft H3 Prompt'}],true,true)",context);
  assert.doesNotMatch(ordinary[0].content,/Full H3 authoring contract/);
  assert.match(detailed[0].content,/Full H3 authoring contract/);
  assert.match(workbench, /writeSelectedScene\(\{/);
});

test('Studio conversation excludes H3 template; explicit Scene Write includes the canonical reference', async () => {
  const template = fs.readFileSync(path.join(__dirname, '..', 'docs/mmh3-prompt-runtime-context.txt'), 'utf8').trim();
  const state = {studioStoryAccess:null,storyboardAttachments:{},workshop:null,studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{}}};
  const context = vm.createContext({
    state,Object,String,Promise,window:{getStudioDirectorNavigation:()=>({})},
    studioAttachedStoryId:()=>'', 
    requestJson:async url => url==='/fs/storyboard'?{stories:[]}:{chatSystem:'Conversational guidance',system:'Focused Writer',actions:[],promptContract:template}
  });
  vm.runInContext(part('  function studioConversationMessages(messages) {',
    '  // Retain available conversational work across ordinary follow-up questions.'),context);
  const result = await vm.runInContext(
    "studioDirectorChatRequestMessages([{role:'user',content:'How should an H3 prompt be structured?'}])",context);
  assert.equal(result.length,2);
  assert.doesNotMatch(result[0].content,/H3 PROMPT AUTHORING REFERENCE|integrated_multimodal_description:|overall_soundscape:/);
  const authored=await vm.runInContext(
    "studioDirectorRequestMessages([{role:'user',content:'Write H3 prompt'}],true,true)",context);
  assert.match(authored[0].content,/H3 PROMPT AUTHORING REFERENCE/);
  assert.match(authored[0].content,/integrated_multimodal_description:|overall_soundscape:/);
  assert.doesNotMatch(result[0].content,/CURRENT WEBCAP CAPABILITIES|CURRENT PROJECT NAVIGATION/);
  assert.equal(result[1].content,'How should an H3 prompt be structured?');
  assert.doesNotMatch(result[0].content,/\[WEBCAP EXPLICIT READ\]/);
  const ordinary=await vm.runInContext(
    "studioDirectorChatRequestMessages([{role:'user',content:'What is the saved title?'}])",context);
  assert.doesNotMatch(ordinary[0].content,/H3 PROMPT AUTHORING REFERENCE/,
    'ordinary Studio conversation no longer authors Scenes');
});

test('large explicit Read selections are sent intact, with no arbitrary client character cap', async () => {
  const start=workbench.indexOf('  function readPayload(story, keys) {');
  const middle=workbench.indexOf('  function updateReadSelection() {',start);
  const sendStart=workbench.indexOf('  function readSend(instruction) {',middle);
  const end=workbench.indexOf('  function showWriteContext() {',sendStart);
  assert.ok(start>=0 && middle>start && sendStart>middle && end>sendStart,
    'Read serialization and action must remain available');
  const prompt='A richly detailed scene. '.repeat(3600);
  const story={id:'project-1',title:'Long Project',updatedAt:'saved',
    sceneOrder:['scene-a'],scenes:{'scene-a':{prompt}}};
  let sent=null,readStatus='',updates=0;
  const nodes=new Map();
  const el=id=>{
    if(!nodes.has(id))nodes.set(id,{
      value:id==='studio-dw-read-project'?'project-1':'',
      textContent:'',disabled:false,
      classList:{add(){},contains:()=>false},
      setAttribute(){},click(){}
    });
    return nodes.get(id);
  };
  const scope=vm.createContext({
    el,Promise,JSON,String,Array,
    projectFields:['title','concept','style','invariants'],
    storyName:value=>value.title,
    selectedPaths:()=>['scene:scene-a:prompt'],
    loadStory:async()=>story,
    status:()=>{},
    updateScope:()=>{},
    updateReadSelection:()=>{updates++;},renderApprovedSources(){},
    window:{
      studioDirectorBridge:{approveRead:(projectId,keys)=>{sent={projectId,keys};}},
      studioDirectorWorkbench:{setReadStatus:(_state,message)=>{readStatus=message;}}
    }
  });
  vm.runInContext(workbench.slice(start,middle) + workbench.slice(sendStart,end),scope);
  scope.readSend();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(sent,'the selected saved fields must reach Director');
  assert.deepEqual(sent.keys,['scene:scene-a:prompt']);
  assert.ok(el('studio-dw-read-preview-data').textContent.length>48000,
    'the preview retains the entire saved field payload');
  assert.equal(JSON.parse(el('studio-dw-read-preview-data').textContent).fields[0].value,prompt,
    'no approved Read field is truncated');
  assert.ok(readStatus.includes('Preparing saved context selection'));
  assert.ok(updates>0,'existing selection UI still refreshes');
  assert.match(workbench,/bytes.toLocaleString\(\)/,'the actual payload size stays visible');
});

test('standalone Invariant linking is not a Director Write operation', () => {
  assert.doesNotMatch(html, /id="studio-dw-invariant-review"/);
  assert.doesNotMatch(workbench, /function prepareInvariantLinks\(/);
  assert.doesNotMatch(workbench, /function applyInvariantLinks\(/);
});

test('multi-Scene review preserves actual Project positions and distinguishes a saved Scene from receipt failure', () => {
  assert.match(workbench, /position = story\.sceneOrder\.indexOf\(id\) \+ 1/);
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
  assert.match(source, /For a context-only Read, stop after a brief confirmation/);
});

test('legacy Workshop request context never treats stored Scene Intent as a creative brief', () => {
  const scope = vm.createContext({
    state: {
      workshop: {
        storyTitle:'Short film', concept:'Story premise', guidelines:{},
        sceneTitle:'Arrival', sceneSummary:'PRIVATE_LEGACY_INTENT',
        durationSeconds:8, shots:'[Shot 1] (0s-8s) A complete action.'
      },
      storyboardAttachments:{}, studioStoryAccess:null
    },
    STORYBOARD_WORKSHOP_PRIMER:'Scene Prompt is the creative content.',
    Object, String
  });
  vm.runInContext(part('  function storyboardRequestMessages(messages, includePrimer) {',
    '  function attachStoryboardContext(kind) {'),scope);
  const outbound = vm.runInContext(
    'storyboardRequestMessages([{role:"user",content:"Revise the shots"}], true)',scope);
  const serialized = JSON.stringify(outbound);
  assert.match(serialized, /timedShots/);
  assert.match(serialized, /sceneTitle/);
  assert.doesNotMatch(serialized, /PRIVATE_LEGACY_INTENT|sceneIntent|sceneSummary/);
  assert.doesNotMatch(source, /Use the outline to develop Scenes that have no prompt yet/);
  assert.match(source, /Author a complete usable H3 Prompt when writing a new Scene/);
  const workshopDraft = part('  function prepareWorkshopRevision() {', '  function applyWorkshopRevision() {');
  assert.doesNotMatch(workshopDraft, /sceneIntent|sceneSummary/);
});
