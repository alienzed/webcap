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
test('ordinary Studio reply displays the exact raw text without interpretation',()=>{
  assert.equal(parse('The saved title is Rainy Bookshop.').reply,'The saved title is Rainy Bookshop.');
  const raw=JSON.stringify({reply:'A useful thought',action:{kind:'write_scenes'}});
  assert.equal(parse(raw).reply,raw);
  assert.equal(parse(raw).action,null);
  assert.equal(parse(raw).changes,null);
  assert.equal(parse(raw).scenes,null);
  assert.equal(parse('{"reply":unfinished').reply,'{"reply":unfinished');
  assert.throws(()=>parse('  '),/no answer/);
});

test('unexpected structured chat output is displayed verbatim rather than promoted into drafts',()=>{
  const raw=JSON.stringify({changes:{scene:{prompt:'A revision',durationSeconds:8}}});
  const response=parse(raw);
  assert.equal(response.reply,raw);
  assert.equal(response.changes,null);
  assert.equal(response.action,null);
  assert.doesNotMatch(response.reply,/Review the proposed material/);
});

test('even a model action hint has no authority to invoke WebCap Write',()=>{
  const raw=JSON.stringify({reply:'An idea',action:{kind:'write_scenes',instruction:'Change it'}});
  const response=parse(raw);
  assert.equal(response.reply,raw);
  assert.equal(response.action,null);
  assert.doesNotMatch(part(chat,'  function parseStudioChatResponse(raw) {',
    '  function storyboardRequestMessages('),/presentAction|write_scenes/);
});

test('ordinary chat never offers implicit Project or Scene writes, even with structured response fields',()=>{
  const send=part(chat,'  function sendMessage() {','  function syncPinnedUi() {');
  assert.doesNotMatch(send,/var actions = studioAuthoredWriteActions\(/);
  assert.doesNotMatch(send,/studioDirectorWorkbench\.presentAction\(/);
  assert.match(chat,/studioDirectorChatRequestMessages\(messages/);
  assert.match(workbench,/function writePrepare\(options\)/);
});

test('ordinary chat does not reinterpret a returned Scene object',()=>{
  const raw=JSON.stringify({changes:{scene:{title:'Moment',prompt:'Full prompt',durationSeconds:99}}});
  assert.equal(parse(raw).reply,raw);
  assert.equal(parse(raw).changes,null);
});

test('completing the Scene action leaves the same response Project action available',()=>{
  const sceneAction={kind:'create_scene',actionKey:'primary',
    instruction:'Author the work',request:'Author the work',completed:false};
  const projectAction={kind:'create_project',actionKey:'alternate-0',
    instruction:'Author the work',request:'Author the work',completed:false};
  const state={studioActionIndex:0,studioActionKey:'primary',modeMessages:{
    storyboard:[{role:'assistant',content:'Here are both results.',
      writeAction:sceneAction,otherWriteActions:[projectAction]}]
  }};
  const actionHelpers=new Function('state',part(chat,
    '  function studioStoredActions(entry) {',
    '  function studioRestoreAuthoredAction(action, rawResponse) {')+
    'return {studioStoredActions,studioActiveStoredAction};')(state);
  let saved=0;
  const src=part(chat,
    '    finishWriteAction:function (action) {',
    '    canReview: function () {').trim().replace(/,$/,'');
  const finish=new Function('state','studioActiveStoredAction','scheduleSessionSave',
    'return ({'+src+'}).finishWriteAction;')(
    state,actionHelpers.studioActiveStoredAction,()=>saved++);
  finish(sceneAction);
  assert.equal(sceneAction.completed,true);
  assert.equal(projectAction.completed,false,
    'one completed Scene cannot consume a separate Project deliverable');
  state.studioActionKey='alternate-0';
  assert.equal(actionHelpers.studioActiveStoredAction(state.modeMessages.storyboard[0]),projectAction);
  finish(projectAction);
  assert.equal(projectAction.completed,true);
  assert.equal(saved,2);
});

test('ordinary chat cannot classify any saved Project or Scene destination',()=>{
  const raw=JSON.stringify({changes:{project:{concept:'A new idea'},scene:{prompt:'A prompt'}}});
  const response=parse(raw);
  assert.equal(response.reply,raw);
  assert.equal(response.changes,null);
  assert.equal(response.action,null);
});

test('ordinary prose and model action hints never launch a Write',()=>{
  const send=part(chat,'  function sendMessage() {','  function syncPinnedUi() {');
  assert.doesNotMatch(send,/studioAuthoredWriteActions\(studioResponse/);
  assert.doesNotMatch(send,/studioDirectorWorkbench\.presentAction\(/);
  assert.doesNotMatch(chat,/function studioActionFromExplicitRequest/);
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
test('manual multi-Scene Prompt Write does not classify the author request with prose regexes',async()=>{
  const source=part(workbench,'  function prepareBatchScenes(storyId) {',
    '  function renderBatchReview() {');
  assert.doesNotMatch(source,/\.test\(instruction\)|\.match\(instruction\)/,
    'WebCap must not inspect creative prose to choose fields');
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
    'loadStory','storyName','Promise',source+'return prepareBatchScenes;')(
      el,()=> 'Make the ending quieter, without changing other Scene details.',
      message=>statuses.push(message),
      {flushStudioDirectorStoryEdits:async()=>{},studioDirectorBridge:bridge},
      async()=>story,story=>story.title,Promise);
  const result=await revise('p1');
  assert.equal(launches.length,1);
  assert.deepEqual(launches[0].fields,['prompt'],
    'the batch operation has one known creative target: the H3 Prompt');
  assert.equal(launches[0].forceAuthor,true,'repeated manual Write should author fresh material');
  assert.equal(launches[0].sceneId,'s1');
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

test('Project Write loads a fresh explicit target and saves changed fields without a proposal',()=>{
  const project=part(chat,'  function prepareStudioBrief(options) {','  function applyStudioBrief() {');
  assert.match(project,/studioAttachedStoryId\(\)/);
  assert.match(project,/requestJson\('\/fs\/storyboard\?story='/);
  assert.match(project,/\/fs\/studio\/director\/brief/);
  assert.match(project,/expected:expected,changes:changes/);
  assert.doesNotMatch(project,/showStudioBriefReview\(\)/);
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

test('ordinary chat retains unexpected content verbatim and does not merge any fields',()=>{
  const raw=JSON.stringify({reply:'A discussion',changes:{scene:{
    prompt:'Unexpected prompt',title:null,durationSeconds:'invalid'}}});
  const answer=parse(raw);
  assert.equal(answer.reply,raw);
  assert.equal(answer.changes,null);
  assert.equal(answer.action,null);
  assert.doesNotMatch(part(chat,'  function parseStudioChatResponse(raw) {',
    '  function storyboardRequestMessages('),/studioMergeWorkingChanges/);
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
  assert.deepEqual(partial.invariants,[{kind:'location'}],
    'WebCap must expose model material rather than silently sanitizing it');
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


test('an explicit Write always authors anew without previous draft-cache shortcuts',()=>{
  const create=part(chat,'    writeNewScene: function (launch) {','    writeSelectedScene: function');
  const revise=part(chat,'    writeSelectedScene: function (launch) {','    makeProposal: function');
  assert.match(create,/studioDirectorBridge\.makeProposal\(/);
  assert.match(revise,/studioDirectorBridge\.makeProposal\(/);
  assert.doesNotMatch(create,/draftOrigin\.baseline === baseline|var reuse =/);
  assert.doesNotMatch(revise,/applyExisting|completeDraft/);
});

test('Studio request transmits all original history without trimming or excerpts',async()=>{
  const request=new Function('state','window','requestJson',part(chat,
    '  function studioDirectorRequestMessages(messages, includePromptContract, explicitWrite, navigationSnapshot) {',
    '  function studioDirectorChatRequestMessages(')+
    'return studioDirectorRequestMessages;')(
      {},{},async()=>({system:'Creative partner',promptContract:'H3 reference'}));
  const conversation=Array.from({length:20},(_,i)=>({
    role:i%2?'assistant':'user',content:'Turn '+i+' '+('Z'.repeat(4100))
  }));
  const result=await request(conversation,false,false);
  assert.equal(result.length,21);
  conversation.forEach((item,i)=>assert.equal(result[i+1].content,item.content));
  assert.doesNotMatch(result[0].content,/H3 reference/);
});

test('unsupported Scene timing cannot silently become a saved default',()=>{
  const create=part(chat,'    writeNewScene: function (launch) {','    writeSelectedScene: function');
  assert.match(create,/Number\.isInteger\(Number\(item\.durationSeconds\)\)/);
  assert.match(create,/no Scene records with persistable fields/);
  assert.doesNotMatch(create,/durationSeconds:6/);
  assert.doesNotMatch(create,/showStudioScenesReview\(\)/);
});

test('manual Project Write invokes fresh authoring and saves instead of reopening Review',()=>{
  const create=part(chat,'  function prepareStudioProject(options) {','  // The reviewed Project is saved before any Scene authoring.');
  assert.match(create,/studioDirectorRequestMessages/);
  assert.match(create,/studio_project_draft/);
  assert.match(create,/\/fs\/studio\/director\/project-create/);
  assert.doesNotMatch(create,/showStudioProjectReview\(\)/);
});

