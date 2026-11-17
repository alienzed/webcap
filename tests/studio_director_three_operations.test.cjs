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
const sceneTargets = new Function(part(workbench, '  function selectedSceneIds(story, selectedScene) {',
  '  function presentAction(') + 'return selectedSceneIds;')();

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


test('shared Studio creative guidance leaves save and review mechanics to WebCap',()=>{
  const request = part(chat,'  function studioDirectorRequestMessages(', '  function studioDirectorChatRequestMessages(');
  assert.match(request,/payload.system/);
  assert.match(request,/H3 PROMPT AUTHORING REFERENCE/);
  assert.doesNotMatch(request,/CURRENT WEBCAP CAPABILITIES|STUDIO WORKBENCH STATE|CURRENT PROJECT NAVIGATION/);
  assert.doesNotMatch(request,/direct-save or review policy|Only WebCap determines review/);
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

test('ordinary prose never manufactures a Studio write action', () => {
  assert.doesNotMatch(chat,/function studioActionFromExplicitRequest/);
  assert.match(chat,/var nextAction = null/);
  assert.match(workbench,/Do not offer a creative Review based on an LLM action promise/);
});

test('WebCap binds review to the selected existing Scene without parsing request prose', () => {
  const story={id:'p1',sceneOrder:['one','two','three']};
  const selected={projectId:'p1',sceneId:'two'};
  assert.deepEqual(sceneTargets(story,selected),['two']);
  assert.deepEqual(sceneTargets(story,{projectId:'other',sceneId:'two'}),[]);
  assert.deepEqual(sceneTargets(story,null),[]);
});


test('explicit Scene writes rely on authored duration values rather than guessing from prose',()=>{
  assert.doesNotMatch(chat,/function studioRequestedDuration\(|function studioMentionedDuration\(/);
  assert.match(chat,/Number\.isInteger\(proposed\.durationSeconds\)/);
  assert.match(chat,/missingDuration/);
  assert.doesNotMatch(chat,/draft\.scenes\[0\]\.durationSeconds = requestedDuration/);
});
test('manual multi-Scene Write delegates title and duration choices to actual authored fields',async()=>{
  const source=part(workbench,'  function prepareBatchScenes(storyId) {',
    '  function renderBatchReview() {');
  assert.doesNotMatch(source,/\.test\(instruction\)|\.match\(instruction\)/,
    'WebCap must not inspect natural-language instructions to choose fields');
  const story={id:'p1',title:'Film',sceneOrder:['s1'],scenes:{s1:{
    id:'s1',title:'Platform',prompt:'A porter waits.',durationSeconds:8
  }}};
  const launches=[],statuses=[],prepare={disabled:false};
  const el=id=>id==='studio-dw-batch-scenes'
    ? {querySelectorAll:()=>[{value:'s1'}]}
    : id==='studio-dw-write-prepare' ? prepare : null;
  const bridge={
    selectWriteProject(id){assert.equal(id,'p1');},
    async writeSelectedScene(launch){launches.push(launch);return {story};}
  };
  const revise=new Function('el','manualSceneInstruction','status','window',
    'loadStory','storyName', 'Promise',
    source+'return prepareBatchScenes;')(
      el,()=> 'Give the Platform Scene a quieter title and make it fourteen seconds.',
      (message)=>statuses.push(message),
      {flushStudioDirectorStoryEdits:async()=>{},studioDirectorBridge:bridge},
      async()=>story,story=>story.title,Promise);
  const result=await revise('p1');
  assert.equal(launches.length,1);
  assert.deepEqual(launches[0].fields,['prompt']);
  assert.equal(launches[0].allowCreativeFieldChanges,true);
  assert.equal(launches[0].sceneId,'s1');
  assert.equal(launches[0].instruction,'Give the Platform Scene a quieter title and make it fourteen seconds.');
  assert.equal(result.saved.length,1);
  assert.equal(prepare.disabled,false);
  assert.ok(statuses.some(message=>/Saved 1/.test(message)));
});

function harness() {
  const suggestions = {children:[],replaceChildren(){this.children=[];},
    appendChild(value){this.children.push(value);}};
  const controls = new Map([['studio-dw-suggestions',suggestions]]);
  function el(id) {
    if (!controls.has(id)) controls.set(id,{value:'',disabled:false});
    return controls.get(id);
  }
  const document = {createElement() {return {type:'',dataset:{},textContent:'',disabled:false,value:'',
    children:[],setAttribute(){},appendChild(node){this.children.push(node);}};}};
  const requests = [],statuses = [],finishes = [],reviews = [];
  const story = {id:'p1', title:'Rainy Bookshop',
    sceneOrder:['one','two','three'], scenes:{
      one:{title:'Opening',prompt:'Old opening'},two:{title:'Middle',prompt:'Old middle'},three:{title:'Ending',prompt:'Old ending'}
    }};
  const bridge = {
    isReady:()=>true, canReview:()=>true, readinessMessage:()=>'',placeSuggestedAction:()=>{},
    finishWriteAction:action=>finishes.push(action),
    prepareWrite:(...args)=>{requests.push(['project',...args]);return Promise.resolve();},
    writeSelectedScene:async action=>{requests.push(['scene',action]);return {};},
    writeNewScene:async action=>{requests.push(['new-scene',action]);return {};},
    reviewAuthoredScenes:async action=>{requests.push(['review-authored',action]);return {review:true,count:action.scenes.length};},
    reviewPendingScenes:async projectId=>{requests.push(['reopen-review',projectId]);return {review:true};},
  };
  const window = {studioDirectorBridge:bridge};
  const source = part(workbench, '  function selectedSceneIds(story, selectedScene) {',
    '  window.studioDirectorWorkbench = {');
  const creator = new Function('el','document','window','refreshProjects','loadStory',
    'storyName','projectFields','status','openWriteForCapture','showConversationWrite','showSceneReview',
    source + 'return {presentAction,selectedSceneIds};');
  let opened = 0;
  const functions = creator(el,document,window,
    async()=>[{id:'p1',title:'Rainy Bookshop'}],async id=>{
      assert.equal(id,'p1');return story;
    },
    value=>value.title, ['title','concept','style','invariants'],
    (...args)=>statuses.push(args),()=>{opened++;},()=>{},(...args)=>reviews.push(args));
  return {functions,bridge,requests,statuses,finishes,reviews,suggestions,story,opened:()=>opened};
}
async function flush() {
  for (let i=0;i<5;i++) await new Promise(setImmediate);
}

test('an action promise alone never presents a review or launches a model call', async () => {
  const h=harness();
  assert.equal(h.functions.presentAction({kind:'write_scenes',instruction:'Rewrite Scene 2'},
    {projectId:'p1',sceneId:'two',sceneNumber:2},{projectId:'p1'},'Rewrite Scene 2'),undefined);
  assert.equal(h.suggestions.children.length,0);
  assert.equal(h.requests.length,0);
});

test('received existing Scene fields open the existing Review without regenerating', async () => {
  const h=harness();
  h.functions.presentAction({kind:'write_scenes',instruction:'Rewrite Scene 2',
    authoredFields:{prompt:'Complete authored replacement',durationSeconds:12}},
    {projectId:'p1',sceneId:'two',sceneNumber:2},{projectId:'p1'},'Rewrite Scene 2');
  h.suggestions.children.find(node=>node.type==='button').onclick();
  await flush();
  assert.equal(h.requests.length,0,'review has no model call');
  assert.equal(h.reviews.length,1);
  assert.deepEqual(h.reviews[0][2],['prompt','durationSeconds']);
  assert.equal(h.reviews[0][3].prompt,'Complete authored replacement');
});

test('authored conversation Scene records open Review directly and remain reopenable',async()=>{
  const h=harness();
  h.functions.presentAction({kind:'create_scene',instruction:'Two eight-second Scenes',
    scenes:[{title:'Only authored Scene',prompt:'Complete H3 Prompt',durationSeconds:8}]},
    null,{projectId:'p1'},'Two eight-second Scenes');
  assert.match(h.suggestions.children.find(node=>node.type==='button').textContent,/Review authored Scene/);
  h.suggestions.children.find(node=>node.type==='button').onclick();
  await flush();
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0][0],'review-authored');
  assert.equal(h.requests[0][1].scenes.length,1);
  assert.equal(h.requests[0][1].scenes[0].durationSeconds,8);
  assert.equal(h.finishes.length,0,'review does not claim a completed save');
  h.suggestions.children.find(node=>node.type==='button').onclick();
  await flush();
  assert.deepEqual(h.requests.map(row=>row[0]),['review-authored','reopen-review']);
  assert.equal(h.requests[1][1],'p1');
});

test('Project drafts retain separate origins and reject stale saved baselines',async()=>{
  const source=part(chat,'  function prepareStudioBrief(options) {','  function applyStudioBrief() {');
  const projectFields=new Function(part(chat,
    '  function studioWorkingFieldChanges(source, names) {',
    '  function studioMergeWorkingChanges(changes, target, action, request) {')+
    'return studioWorkingFieldChanges;')();
  const projects={
    p1:{id:'p1',title:'First',concept:'Quiet arrival',style:'Blue dusk',invariants:[]},
    p2:{id:'p2',title:'Second',concept:'Busy market',style:'Warm noon',invariants:[]}
  };
  const state={
    pending:false,jobId:'',modelId:'model',activeMode:'storyboard',sessionReady:true,
    modeMessages:{storyboard:[{role:'user',content:'Improve the atmosphere'}]},
    studioBriefProposal:null,
    studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{}}
  };
  let modelCalls=0,reviews=0;
  const seenBaselines=[];
  const prepare=new Function('state','window','studioAttachedStoryId','studioActionStatus',
    'startProgress','syncControls','requestJson','studioDirectorRequestMessages',
    'waitForJob','trackTransientLlmJob','parseStudioBriefDraft','studioWorkingFieldChanges',
    'scheduleSessionSave','finishProgress','showStudioBriefReview','Promise',
    source+'return prepareStudioBrief;')(
      state,{flushStudioDirectorStoryEdits:async()=>{},
        studioDirectorWorkbench:{showSentWriteContext(){}},
        reportConsoleError:(_name,error)=>assert.fail(error.message)},
      ()=>'',
      ()=>{},()=>{},()=>{},
      async(url,options)=>{
        if(url.startsWith('/fs/storyboard?story='))return {story:projects[url.split('=')[1]]};
        if(url==='/fs/director/chat'){
          modelCalls++;
          const payload=JSON.parse(JSON.parse(options.body).messages[0].content);
          seenBaselines.push(payload.project.style);
          return {job:{jobId:'job'+modelCalls}};
        }
        throw new Error('Unexpected URL '+url);
      },
      async messages=>messages,
      async ()=>({result:{text:JSON.stringify({style:'Improved atmosphere '+modelCalls})}}),
      ()=>{},raw=>JSON.parse(raw),projectFields,()=>{},()=>{},()=>{reviews++;},Promise);
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  prepare({storyId:'p1',instruction:'Improve the atmosphere'});
  await tick();
  assert.equal(modelCalls,1);
  assert.equal(state.studioWorkingDraft.draftOrigins.projects.p1.request,'Improve the atmosphere');
  state.studioBriefProposal=null;
  prepare({storyId:'p2',instruction:'Improve the atmosphere'});
  await tick();
  assert.equal(modelCalls,2,'identical wording for a different Project must author separately');
  assert.deepEqual(Object.keys(state.studioWorkingDraft.draftOrigins.projects).sort(),['p1','p2']);
  state.studioBriefProposal=null;
  prepare({storyId:'p1',instruction:'Improve the atmosphere'});
  await tick();
  assert.equal(modelCalls,2,'an intervening different Project must not evict a reusable first draft');
  assert.equal(state.studioBriefProposal.draft.style,'Improved atmosphere 1');
  projects.p1.style='New authoritative moonlight';
  state.studioBriefProposal=null;
  prepare({storyId:'p1',instruction:'Improve the atmosphere'});
  await tick();
  assert.equal(modelCalls,3,'a changed authoritative Project baseline invalidates retained material');
  assert.deepEqual(seenBaselines,['Blue dusk','Warm noon','New authoritative moonlight']);
  assert.equal(state.studioBriefProposal.expected.style,'New authoritative moonlight');
  assert.equal(reviews,4);
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


test('draft reuse is based on exact authored provenance, not linguistic heuristics',()=>{
  assert.doesNotMatch(chat,/function studioRequestAppliesPreparedMaterial\(/);
  assert.match(chat,/draftOrigin\.projectId === storyId/);
  assert.match(chat,/draftOrigin\.baseline === baseline/);
  assert.match(chat,/draftOrigins\.newScene/);
  assert.match(chat,/sourceMessageIndex/);
  assert.doesNotMatch(workbench,/literalTitleOnly/);
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


test('unsupported Scene timing remains editable and cannot silently become a saved default',()=>{
  const write=part(chat,'    writeSelectedScene: function (launch) {','    makeProposal: function');
  assert.match(write,/Scene timing is missing or unsupported/);
  assert.match(write,/return \{review:true\}/);
  const create=part(chat,'    writeNewScene: function (launch) {','    writeSelectedScene: function');
  assert.match(create,/missingDuration/);
  assert.match(create,/Scene duration needs review/);
  assert.doesNotMatch(create,/durationSeconds:6/);
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
  const state={pending:false,activeMode:'storyboard',sessionReady:true,
    modelId:'',studioProjectProposal:null,
    studioWorkingDraft:{projects:{},scenes:{},
      newProject:{title:'Rainy Bookshop',concept:'Late-night reading',
        style:'Amber lamps',invariants:[]},newScene:{},sourceRequest:'Describe it'}};
  let reviewed=0;
  const prepare=new Function('state',
    'parseStudioProjectDraft','showStudioProjectReview','studioActionStatus',
    'studioWorkingFieldChanges',part(chat,
    '  function prepareStudioProject(options) {',
    '  // The reviewed Project is saved before any Scene authoring.')+
    'return prepareStudioProject;')(
    state,parseProject,()=>{reviewed++;},()=>{},projectFields);
  prepare();
  assert.equal(reviewed,1);
  assert.equal(state.studioProjectProposal.title,'Rainy Bookshop');
  assert.equal(state.studioProjectProposal.concept,'Late-night reading');
  assert.equal(state.pending,false);
});
