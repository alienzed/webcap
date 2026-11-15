'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const chat = fs.readFileSync(path.join(__dirname, '../tool/js/director_chat.js'), 'utf8');
const workbench = fs.readFileSync(path.join(__dirname, '../tool/js/studio_director_workbench.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../tool/tool.html'), 'utf8');
const backend = fs.readFileSync(path.join(__dirname, '../tool/server/app.py'), 'utf8');
function part(source, begin, end) {
  const first = source.indexOf(begin), last = source.indexOf(end, first + begin.length);
  assert.ok(first >= 0 && last > first, 'Missing production function: ' + begin);
  return source.slice(first, last);
}
const parse = new Function(part(chat, '  function parseStudioChatResponse(raw) {',
  '  function storyboardRequestMessages(') + 'return parseStudioChatResponse;')();
const requestedDuration = new Function(part(chat, '  function studioRequestedDuration(instruction) {',
  '  window.studioDirectorBridge = {') + 'return studioRequestedDuration;')();
const sceneTargets = new Function(part(workbench, '  function sceneIdsFromRequest(instruction, story, selectedScene) {',
  '  function presentAction(') + 'return sceneIdsFromRequest;')();

test('retired Director assessment and guideline artifacts are absent without losing I/O or write controls', () => {
  assert.doesNotMatch(html,/id="studio-dw-assessment-dialog"|class="studio-dw-readiness hidden"/);
  assert.doesNotMatch(html,/id="studio-director-io-review"|id="director-chat-story-prepare"/);
  assert.doesNotMatch(chat,/parseStoryGuidelineProposal|prepareStoryChanges\(|reviewGeneratedCapture|studio-director-io-review/);
  assert.doesNotMatch(workbench,/reviewGeneratedCapture|studio-dw-assessment-dialog|setReadinessFreshness/);
  assert.doesNotMatch(backend,/"storyboard_story_guidelines"/);
  assert.match(html,/id="studio-director-io-raw"/);
  assert.match(html,/id="studio-dw-write-panel"/);
  assert.match(html,/id="studio-scenes-review"/);
});

test('shared Studio guidance treats review as optional and saved state as WebCap-owned', () => {
  const request = part(chat,'  function studioDirectorRequestMessages(', '  function studioDirectorChatRequestMessages(');
  assert.match(request,/direct-save or review policy/);
  assert.match(request,/WebCap confirms an actual save/);
  assert.doesNotMatch(request,/WebCap confirms Apply|scoped reviewed Write/);
});

test('Read is plain prose; an absent or malformed optional action does not discard its reply', () => {
  assert.deepEqual(parse('The saved title is Rainy Bookshop.'), {
    reply: 'The saved title is Rainy Bookshop.', action: null, changes: null
  });
  const structured = parse(JSON.stringify({reply: 'Saved details are consistent.', action: null}));
  assert.equal(structured.reply, 'Saved details are consistent.');
  assert.equal(structured.action, null);
  const invalid = parse(JSON.stringify({reply: 'Useful answer.', action: {kind:'edit_everything'}}));
  assert.equal(invalid.reply, 'Useful answer.');
  assert.equal(invalid.action, null);
  assert.equal(parse('{"reply":unfinished').reply, '{"reply":unfinished');
  assert.throws(() => parse('  '), /no answer/);
});

test('Structured Studio fields survive a missing optional conversational reply', () => {
  const changes = {scene:{prompt:'Complete replacement prompt',durationSeconds:12}};
  const response = parse(JSON.stringify({changes}));
  assert.equal(response.reply, JSON.stringify({changes}));
  assert.deepEqual(response.changes,changes);
  assert.equal(response.action,null);
  const mixed = parse(JSON.stringify({reply:'Useful answer.',changes,
    action:{kind:'unsupported_operation',instruction:'Change things'}}));
  assert.equal(mixed.reply,'Useful answer.');
  assert.deepEqual(mixed.changes,changes);
  assert.equal(mixed.action,null);
});

test('Only a small, optional action accompanies conversation', () => {
  const result = parse(JSON.stringify({reply:'I can make that quieter.', action:{
    kind:'write_scenes', instruction:'Make the ending quieter.', fields:['prompt']
  }}));
  assert.equal(result.action.kind, 'write_scenes');
  assert.equal(result.action.instruction, 'Make the ending quieter.');
  assert.match(chat, /studioDirectorWorkbench\.presentAction/);
  assert.doesNotMatch(part(chat, '  function parseStudioChatResponse(raw) {',
    '  function storyboardRequestMessages('), /readiness|capture/i);
});

test('plain Read questions with editing words do not invent a write action', () => {
  const action = new Function(part(chat,
    '  function studioActionFromExplicitRequest(request, selectedScene) {',
    '  function storyboardRequestMessages(') + 'return studioActionFromExplicitRequest;')();
  const selected = {projectId:'p1',sceneId:'one'};
  assert.equal(action('What is the saved title and duration? Answer briefly; make no changes.', selected), null);
  assert.equal(action('Explain how you would revise this Scene.', selected), null);
  assert.equal(action('Can you describe the Project? Leave it unchanged.', selected), null);
  assert.equal(action('Make the ending quieter.', selected).kind, 'write_scenes');
  assert.equal(action('Please revise this Project overview.', selected).kind, 'write_project');
  assert.equal(action("Let's add a new Scene.", selected).kind, 'create_scene');
});

test('WebCap resolves finite saved Scene IDs, with explicit numbers ahead of selection', () => {
  const story = {id:'p1',sceneOrder:['one','two','three']};
  const selected = {projectId:'p1',sceneId:'two'};
  assert.deepEqual(sceneTargets('Revise scenes 1 and 3', story, selected), ['one','three']);
  assert.deepEqual(sceneTargets('Revise Scene 3', story, selected), ['three']);
  assert.deepEqual(sceneTargets('Make the ending quieter', story, selected), ['two']);
  assert.deepEqual(sceneTargets('Revise scenes', story, selected), []);
  assert.deepEqual(sceneTargets('Revise Scene 7', story, selected), []);
  assert.deepEqual(sceneTargets('Make the ending quieter', story, {projectId:'other',sceneId:'two'}), []);
});

test('Explicit duration is a WebCap parameter, not optional LLM metadata', () => {
  assert.equal(requestedDuration('Make this a 12-second Scene'), 12);
  assert.equal(requestedDuration('Use 14s'), 14);
  assert.equal(requestedDuration('No duration mentioned'), null);
  assert.equal(requestedDuration('Use 30 seconds'), null);
  assert.doesNotMatch(chat, /draft\.scenes\[0\]\.durationSeconds = requestedDuration/);
});

function harness() {
  const suggestions = {children:[],replaceChildren(){this.children=[];},
    appendChild(value){this.children.push(value);}};
  const controls = new Map([['studio-dw-suggestions',suggestions]]);
  function el(id) {
    if (!controls.has(id)) controls.set(id,{value:'',disabled:false});
    return controls.get(id);
  }
  const document = {createElement() {return {type:'',dataset:{},textContent:'',disabled:false};}};
  const requests = [],statuses = [],finishes = [];
  const story = {id:'p1', title:'Rainy Bookshop',
    sceneOrder:['one','two','three'], scenes:{
      one:{title:'Opening'},two:{title:'Middle'},three:{title:'Ending'}
    }};
  const bridge = {
    isReady:()=>true, readinessMessage:()=>'',placeSuggestedAction:()=>{},
    finishWriteAction:action=>finishes.push(action),
    prepareWrite:(...args)=>{requests.push(['project',...args]);return Promise.resolve();},
    writeSelectedScene:async action=>{requests.push(['scene',action]);return {};},
    writeNewScene:async action=>{requests.push(['new-scene',action]);return {};},
  };
  const window = {studioDirectorBridge:bridge};
  const source = part(workbench, '  function sceneIdsFromRequest(instruction, story, selectedScene) {',
    '  window.studioDirectorWorkbench = {');
  const creator = new Function('el','document','window','refreshProjects','loadStory',
    'storyName','projectFields','status','openWriteForCapture','showConversationWrite',
    source + 'return {presentAction,sceneIdsFromRequest};');
  let opened = 0;
  const functions = creator(el,document,window,
    async()=>[{id:'p1',title:'Rainy Bookshop'}],async id=>{
      assert.equal(id,'p1');return story;
    },
    value=>value.title, ['title','concept','style','invariants'],
    (...args)=>statuses.push(args),()=>{opened++;},()=>{});
  return {functions,bridge,requests,statuses,finishes,suggestions,story,opened:()=>opened};
}
async function flush() {
  for (let i=0;i<5;i++) await new Promise(setImmediate);
}

test('a suggested multi-Scene revision runs one existing writer per real Scene', async () => {
  const h = harness();
  h.functions.presentAction({kind:'write_scenes',instruction:'Make the rooms darker.',fields:['prompt']},
    {projectId:'p1',sceneId:'two',sceneNumber:2},
    {projectId:'p1'}, 'Revise scenes 1 and 3');
  assert.equal(h.suggestions.children.length,1);
  h.suggestions.children[0].onclick();
  await flush();
  assert.deepEqual(h.requests.map(row=>row[1].sceneId),['one','three']);
  assert.ok(h.statuses.some(row=>/Saved 2/.test(row[0])));
  assert.equal(h.finishes.length,1,'completion occurs after both Scene attempts');
});

test('the selected Scene is used when no explicit number overrides it', async () => {
  const h = harness();
  h.functions.presentAction({kind:'write_scenes',instruction:'Quiet the ending.'},
    {projectId:'p1',sceneId:'two',sceneNumber:2},{projectId:'p1'},'Make the ending quieter');
  h.suggestions.children[0].onclick();
  await flush();
  assert.deepEqual(h.requests.map(row=>row[1].sceneId),['two']);
});

test('new Scene and Project actions use existing writers with frozen destinations', async () => {
  const h = harness();
  h.functions.presentAction({kind:'create_scene',instruction:'Create a 12-second closing Scene.'},
    null,{projectId:'p1'},'Create a 12-second closing Scene.');
  h.suggestions.children[0].onclick();
  await flush();
  assert.equal(h.requests[0][0],'new-scene');
  assert.equal(h.requests[0][1].projectId,'p1');
  assert.equal(h.requests[0][1].directSave,false);
  h.functions.presentAction({kind:'create_project',instruction:'Create a bookshop Project.'},
    null,null,'Create a Project');
  h.suggestions.children[0].onclick();
  await flush();
  assert.equal(h.requests[1][0],'project');
  assert.equal(h.requests[1][1],'new-project');
});

test('new multiple Scenes use one authoring call and review actual returned records',async()=>{
  const h=harness();
  h.bridge.writeNewScene=async launch=>{
    h.requests.push(['new-scene',launch]);
    return {review:true,count:2};
  };
  h.functions.presentAction({kind:'create_scene',instruction:'Create three different bookshop Scenes.'},
    null,{projectId:'p1'},'Create 3 Scenes');
  h.suggestions.children[0].onclick();
  await flush();
  assert.equal(h.requests.length,1,'one request, irrespective of requested count');
  assert.equal(h.requests[0][1].projectId,'p1');
  assert.equal(h.requests[0][1].directSave,false);
  assert.ok(h.statuses.some(row=>/Review the authored Scenes/.test(row[0])));
  assert.equal(h.finishes.length,0,'review is not evidence of a save');
});

test('partial Scene results remain available for review without a failed-save claim',async()=>{
  const h=harness();
  h.bridge.writeNewScene=async launch=>{
    h.requests.push(['new-scene',launch]);
    return {review:true,count:1};
  };
  h.functions.presentAction({kind:'create_scene',instruction:'Create a 12-second closing Scene.'},
    null,{projectId:'p1'},'Create a 12-second closing Scene.');
  h.suggestions.children[0].onclick();
  await flush();
  assert.equal(h.requests.length,1);
  assert.ok(!h.statuses.some(row=>/Failed 1/.test(row[0])));
  assert.equal(h.finishes.length,0);
});

test('a Scene authoring failure remains visible at its single failed operation',async()=>{
  const h=harness();
  h.bridge.writeNewScene=async launch=>{
    h.requests.push(['new-scene',launch]);
    throw new Error('Model authoring failed');
  };
  h.functions.presentAction({kind:'create_scene',instruction:'Create three different bookshop Scenes.'},
    null,{projectId:'p1'},'Create 3 Scenes');
  h.suggestions.children[0].onclick();
  await flush();
  assert.equal(h.requests.length,1,'no invented replacement attempts');
  assert.ok(h.statuses.some(row=>/Director action failed: Model authoring failed/.test(row[0])));
  assert.equal(h.finishes.length,0);
});

test('structured Director changes merge by complete field, without overwriting unrelated drafts', () => {
  const state={studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{},sourceRequest:''},
    sessionDirty:{storyboard:false}};
  const source=part(chat,'  // A Studio conversation owns unsaved sparse field replacements.',
    '  function parseStudioChatResponse(raw) {');
  const merge=new Function('state',source+'return studioMergeWorkingChanges;')(state);
  assert.equal(merge({project:{concept:'First concept',style:'Warm light'}},
    {projectId:'p1'}, {kind:'write_project'},'Describe the Project'),true);
  assert.equal(merge({project:{concept:'Second concept'}},
    {projectId:'p1'}, {kind:'write_project'},'Change the premise'),true);
  assert.deepEqual(state.studioWorkingDraft.projects.p1,
    {concept:'Second concept',style:'Warm light'});
  assert.equal(merge({scene:{title:'Quiet Ending',prompt:'Complete H3 Prompt'}},
    {projectId:'p1',sceneId:'s2'}, {kind:'write_scenes'},'Revise Scene 2'),true);
  assert.equal(merge({scene:{durationSeconds:12}},
    {projectId:'p1',sceneId:'s2'}, {kind:'write_scenes'},'Make it twelve seconds'),true);
  assert.deepEqual(state.studioWorkingDraft.scenes.s2,
    {title:'Quiet Ending',prompt:'Complete H3 Prompt',durationSeconds:12});
  assert.equal(state.studioWorkingDraft.projects.p1.style,'Warm light');
  assert.equal(state.studioWorkingDraft.sourceRequest,'Make it twelve seconds');
  assert.equal(state.sessionDirty.storyboard,true);
});

test('an incomplete optional field does not erase valid authored material', () => {
  const state={studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{},sourceRequest:''},
    sessionDirty:{storyboard:false}};
  const source=part(chat,'  // A Studio conversation owns unsaved sparse field replacements.',
    '  function parseStudioChatResponse(raw) {');
  const merge=new Function('state',source+'return studioMergeWorkingChanges;')(state);
  const response=parse(JSON.stringify({
    reply:'I revised the Scene.',
    changes:{scene:{prompt:'Complete H3 Prompt',title:null,durationSeconds:'invalid'}},
    action:{kind:'write_scenes',instruction:'Quiet ending'}
  }));
  assert.equal(response.reply,'I revised the Scene.');
  assert.equal(merge(response.changes,{projectId:'p1',sceneId:'s1'},response.action,
    'Quiet ending'),true);
  assert.deepEqual(state.studioWorkingDraft.scenes.s1,{prompt:'Complete H3 Prompt'});
  assert.equal(merge({scene:{title:null}},{projectId:'p1',sceneId:'s1'},response.action,'Again'),false);
  assert.equal(state.studioWorkingDraft.scenes.s1.prompt,'Complete H3 Prompt');
});

test('Project revision accepts one full field replacement and preserves unrelated saved values', () => {
  const helper=part(chat,'  // A Studio conversation owns unsaved sparse field replacements.',
    '  function parseStudioChatResponse(raw) {');
  const workingFields=new Function(helper+'return studioWorkingFieldChanges;')();
  const source=part(chat,'  function parseStudioBriefDraft(raw) {',
    '  // A bounded, editable-review-only word comparison.');
  const parseBrief=new Function('studioWorkingFieldChanges',source+
    'return parseStudioBriefDraft;')(workingFields);
  const parsed=parseBrief('{"concept":"Quiet rain inside the bookshop"}');
  assert.equal(parsed.concept,'Quiet rain inside the bookshop');
  assert.ok(!Object.hasOwn(parsed,'title'));
  assert.ok(!Object.hasOwn(parsed,'style'));
  assert.ok(!Object.hasOwn(parsed,'invariants'));
  const baseline={title:'Rainy Bookshop',concept:'Old premise',style:'Amber lamps',
    invariants:[{kind:'location',title:'Door',text:'Green door'}]};
  const merged=Object.assign({},baseline,parsed);
  assert.equal(merged.concept,'Quiet rain inside the bookshop');
  assert.equal(merged.style,'Amber lamps');
  assert.deepEqual(merged.invariants,baseline.invariants);
  const partial=parseBrief('{"style":"Cool light","invariants":[{"kind":"location"}]}');
  assert.equal(partial.style,'Cool light');
  assert.ok(!Object.hasOwn(partial,'invariants'),
    'one malformed optional list must not erase saved Invariants');
});

test('an unbound Scene revision never becomes a new-Scene creation draft', () => {
  const state={studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{},sourceRequest:''},
    sessionDirty:{storyboard:false}};
  const source=part(chat,'  // A Studio conversation owns unsaved sparse field replacements.',
    '  function parseStudioChatResponse(raw) {');
  const merge=new Function('state',source+'return studioMergeWorkingChanges;')(state);
  assert.equal(merge({scene:{prompt:'Complete H3 rewrite'}},{projectId:'p1'},
    {kind:'write_scenes'},'Revise Scenes 1 and 3'),false);
  assert.deepEqual(state.studioWorkingDraft.newScene,{});
  assert.equal(state.sessionDirty.storyboard,false);
});

test('prepared material is reused only for an explicit apply, not a fresh creative instruction',()=>{
  const apply=new Function(part(chat,
    '  function studioRequestAppliesPreparedMaterial(request) {',
    '  function studioWorkingFieldChanges(source, names) {')+
    'return studioRequestAppliesPreparedMaterial;')();
  assert.equal(apply('Save that prompt to Scene 2.'),true);
  assert.equal(apply('Apply this Project draft.'),true);
  assert.equal(apply('Use the previous concept.'),true);
  assert.equal(apply('Use warmer lighting in Scene 2.'),false);
  assert.equal(apply('Apply new blue lighting to Scene 2.'),false);
  assert.equal(apply('Save this prompt but make it darker.'),false);
});

test('Studio request sends bounded discussion, current full words, and no saved-field receipts',async()=>{
  const request=new Function('state','window','requestJson',part(chat,
    '  function studioDirectorRequestMessages(messages, includePromptContract, explicitWrite, navigationSnapshot) {',
    '  function studioDirectorChatRequestMessages(')+
    'return studioDirectorRequestMessages;')(
      {studioStoryAccess:null,storyboardAttachments:{}},
      {getStudioDirectorNavigation:()=>({projectId:'p1',projectTitle:'A Project',sceneOrder:[]})},
      async()=>({system:'Small Director guidance',actions:[],promptContract:'H3'}));
  const fullUser='Please revise the Story with these details: '+('Z'.repeat(3900));
  const discussion=Array.from({length:12},(_,i)=>({
    role:i%2?'assistant':'user',content:i===10?'A'.repeat(4500):'Turn '+i
  }));
  discussion.push({role:'user',content:'[WEBCAP APPLIED FIELD VALUES] large saved receipt'});
  discussion.push({role:'user',content:fullUser});
  const result=await request(discussion,false,false,
    {projectId:'p1',projectTitle:'A Project',sceneOrder:[]});
  assert.ok(result.length<=9,'only a short tail is model discussion');
  assert.equal(result.at(-1).content,fullUser,'never truncate the active request');
  assert.doesNotMatch(JSON.stringify(result),/large saved receipt/);
  assert.ok(result.some(x=>x.content.includes('[Earlier long message abbreviated]')),
    'historical huge turns should not be re-sent verbatim');
});

test('WebCap respects written-out timing and does not silently default unsupported timing',()=>{
  assert.equal(requestedDuration('Create a twelve-second Scene'),12);
  assert.equal(requestedDuration('Make it fourteen seconds'),14);
  assert.equal(requestedDuration('Create a 9-second Scene'),9);
  assert.equal(requestedDuration('Create a twenty-second Scene'),null);
});

test('manual Project review reuses durable authored fields without a model request',()=>{
  const projectFields=new Function(part(chat,
    '  function studioWorkingFieldChanges(source, names) {',
    '  function studioMergeWorkingChanges(changes, target, action, request) {')+
    'return studioWorkingFieldChanges;')();
  const parseProject=new Function(part(chat,
    '  function parseStudioProjectDraft(raw) {',
    '  function addStudioProjectInvariant(')+
    'return parseStudioProjectDraft;')();
  const applies=new Function(part(chat,
    '  function studioRequestAppliesPreparedMaterial(request) {',
    '  function studioWorkingFieldChanges(source, names) {')+
    'return studioRequestAppliesPreparedMaterial;')();
  const state={pending:false,activeMode:'storyboard',sessionReady:true,
    modelId:'',studioProjectProposal:null,
    studioWorkingDraft:{projects:{},scenes:{},
      newProject:{title:'Rainy Bookshop',concept:'Late-night reading',
        style:'Amber lamps',invariants:[]},newScene:{},sourceRequest:'Describe it'}};
  let reviewed=0;
  const prepare=new Function('state','studioRequestAppliesPreparedMaterial',
    'parseStudioProjectDraft','showStudioProjectReview','studioActionStatus',
    'studioWorkingFieldChanges',part(chat,
    '  function prepareStudioProject(options) {',
    '  // The reviewed Project is saved before any Scene authoring.')+
    'return prepareStudioProject;')(
    state,applies,parseProject,()=>{reviewed++;},()=>{},projectFields);
  prepare();
  assert.equal(reviewed,1);
  assert.equal(state.studioProjectProposal.title,'Rainy Bookshop');
  assert.equal(state.studioProjectProposal.concept,'Late-night reading');
  assert.equal(state.pending,false);
});
