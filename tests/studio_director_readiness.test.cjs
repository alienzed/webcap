const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const director = fs.readFileSync(path.join(__dirname, '..', 'tool/js/director_chat.js'), 'utf8');
const workbench = fs.readFileSync(path.join(__dirname, '..', 'tool/js/studio_director_workbench.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'tool/tool.html'), 'utf8');
function part(start, end) {
  const i = director.indexOf(start), j = director.indexOf(end, i + start.length);
  assert.ok(i >= 0 && j > i, 'Missing Studio section ' + start);
  return director.slice(i, j);
}
const parse = new Function(part('  function parseStudioChatResponse(raw) {',
  '  function storyboardRequestMessages(messages, includePrimer) {') +
  '\nreturn parseStudioChatResponse;')();
const valid = {
  checks:[{name:'Concept',scope:'project',ready:true,content:'A scene with dialogue, and "quotation" marks'}],
  readHints:['project.concept'],writeHint:'project',writeFields:['concept'],sceneId:''
};
const envelope=(readiness=valid,reply='A concise suggestion.')=>JSON.stringify({reply,readiness});
function processResponse(text,accept=true,pendingReadAck=null,mode='storyboard') {
  const state={studioReadiness:{...valid,stale:true},pendingReadAck};
  const statuses=[],failures=[];
  const window={studioDirectorWorkbench:{
    updateReadiness:data=>{
      if(!accept||!data||!Array.isArray(data.checks))return false;
      state.studioReadiness={...data,stale:false};
      return true;
    },
    setReadinessFreshness:stale=>statuses.push('freshness:'+stale),
    setReadStatus:(state,detail)=>statuses.push('read:'+state+':'+detail),
    setStatus:msg=>statuses.push(msg)
  },reportConsoleError:(label,err)=>failures.push(label+': '+err.message)};
  const code=part("        var studioResponse = activeChatMode === 'storyboard' ? parseStudioChatResponse(result.text) : null;",
    "        messages.push({ role: 'assistant', content: assistantText });");
  const run=new Function('result','activeChatMode','state','window','studioActionStatus','parseStudioChatResponse','selectedScene',
    'var requestError=null,selectedProject=null,content="";'+code+'\nreturn {text:assistantText,error:requestError};');
  return {...run({text},mode,state,window,msg=>statuses.push(msg),parse,null),state,statuses,failures};
}

test('one structured response supplies the exact reply and readiness separately',()=>{
  const reply='A creative reply with "quotes".\n\n[[WEBCAP_READINESS]] is literal authored text here.';
  const response=processResponse(envelope(valid,reply));
  assert.equal(response.text,reply);
  assert.equal(response.state.studioReadiness.stale,false);
  assert.deepEqual(response.state.studioReadiness.checks,valid.checks);
  assert.deepEqual(response.failures,[]);
});

test('assessment without a reply fails loudly instead of inventing conversation',()=>{
  assert.throws(()=>parse(JSON.stringify({readiness:valid})),/requires a conversational reply/);
  assert.throws(()=>parse(envelope(valid,' ')),/requires a conversational reply/);
});

test('malformed JSON-shaped replies fail visibly rather than becoming authored actions',()=>{
  for(const raw of ['{"reply":"unfinished','{"reply":"Hi",}', '[{"reply":"Hi"}'])
    assert.throws(()=>parse(raw),error=>error.message.includes('Raw Director response:\n'+raw));
});

test('remote plain-text Read reaches the transcript with no action metadata or mutation',()=>{
  const reply='The saved Project is Rainy Bookshop. Its bookseller wears a burgundy cardigan and the shop has a green front door.';
  assert.equal(parse(reply),null);
  const response=processResponse(reply,true,['project.concept','project.invariants']);
  assert.equal(response.text,reply);
  assert.equal(response.error,null);
  assert.equal(response.state.studioReadiness.stale,true,'old actions remain stale');
  assert.equal(response.state.pendingReadAck,null);
  assert.deepEqual(response.failures,[]);
  assert.ok(response.statuses.includes('Director replied to Read · 2 saved fields supplied.'));
  assert.equal(parse('A plain answer with literal [[WEBCAP_READINESS]] text.'),null,
    'prose is never parsed for action delimiters');
});

test('unsupported readiness preserves the reply and marks the exchange failed',()=>{
  const raw=envelope({writeHint:'project, style',writeFields:{project:['style']}},'Hello!');
  const response=processResponse(raw,false);
  assert.equal(response.text,'Hello!');
  assert.equal(response.state.studioReadiness.stale,true);
  assert.ok(response.error);
  assert.ok(response.failures.some(message=>message.includes('Raw structured response:\n'+raw)));
  assert.ok(response.statuses.some(message=>message.includes('assessment failed')));
});

test('one complete prompt supplies both visible chat text and the unchanged review capture',()=>{
  const complete='Subject: Mara\n\nintegrated_multimodal_description: [Shot 1] A relieved blink.';
  const readiness={...valid,capture:{field:'prompt',sceneId:'scene-a',content:complete}};
  const accepted=processResponse(envelope(readiness,'Here is the full prompt.'));
  assert.equal(accepted.error,null);
  assert.equal(accepted.text,'Here is the full prompt.\n\n'+complete);
  assert.equal(accepted.state.studioReadiness.capture.content,complete);
  const legacy=processResponse(envelope(readiness,'Here is the full prompt:\n'+complete));
  assert.equal(legacy.text,'Here is the full prompt:\n'+complete,'older repeated material is shown once');
  const invalid=processResponse(envelope(readiness,'Original reply.'),false);
  assert.equal(invalid.text,'Original reply.','rejected metadata leaves the original reply available');
});

test('missing readiness preserves the last assessment without pretending it succeeded',()=>{
  const response=processResponse(JSON.stringify({reply:'A useful suggestion.'}));
  assert.equal(response.text,'A useful suggestion.');
  assert.deepEqual(response.state.studioReadiness.checks,valid.checks);
  assert.equal(response.state.studioReadiness.stale,true);
  assert.ok(response.error);
});

test('Read success is based on completed response, not exact model-produced field identifiers',()=>{
  for (const reply of [
    'RECEIVED: project.concept\\n\\nA strong visual premise.',
    'I have received the Project concept.',
    'RECEIVED: Concept, rather than project.concept'
  ]) {
    const response=processResponse(envelope(valid,reply),true,['project.concept']);
    assert.equal(response.state.pendingReadAck,null);
    assert.ok(response.statuses.includes('Director replied to Read · 1 saved fields supplied.'));
    assert.deepEqual(response.failures,[]);
  }
});

test('Read still fails on malformed structured JSON rather than inventing success',()=>{
  assert.throws(()=>processResponse('{"reply":"unfinished',true,['project.concept']),
    /Raw Director response/);
});

test('General Chat keeps free-form responses',()=>{
  const response=processResponse('A plain answer.',true,null,'chat');
  assert.equal(response.text,'A plain answer.');
  assert.deepEqual(response.failures,[]);
});

test('workbench exposes freshness and only accepted assessments are stored',()=>{
  assert.match(html,/id="studio-dw-readiness-freshness"/);
  assert.match(workbench,/setReadinessFreshness:setReadinessFreshness/);
  assert.match(workbench,/return false;/);
  assert.match(workbench,/stale:false/);
  assert.match(director,/markStudioReadinessOutdated\(\)/);
  assert.match(director,/state\.studioReadiness = Object\.assign\(\{\}, state\.studioReadiness, \{stale:true\}\)/);
});

test('the first accepted assessment is current immediately, rather than labelled not assessed',()=>{
  const start=workbench.indexOf('    updateReadiness:function (result, restoring, selectedScene, selectedProject, authorRequest) {');
  const end=workbench.indexOf('\n  };\n\n  function bind()',start);
  assert.ok(start>=0 && end>start);
  const scope=vm.createContext({readiness:[],projectFields:['title','concept','style','invariants'],
    sceneFields:['title','prompt'],status:message=>assert.fail(message),
    renderReadiness:list=>assert.equal(list.length,1),
    setReadinessFreshness:stale=>{
      assert.equal(stale,false);
      assert.equal(scope.readiness.length,1,'freshness must see the newly accepted checks');
    },activeTarget:()=>({storyId:'p1'}),window:{studioDirectorBridge:{workingStoryId:()=> 'p1',updateReadiness(){}}}});
  const receiver=vm.runInContext('({'+workbench.slice(start,end)+'})',scope);
  assert.equal(receiver.updateReadiness(valid),true);
});

test('capture is optional, bounded and remains editable authoring material, not an applied action', () => {
  const capture = {field:'concept', content:'A complete, original creative premise.', sceneId:''};
  const proposal = {...valid, capture};
  assert.deepEqual(parse(envelope(proposal)).readiness.capture, capture);
  const response = processResponse(envelope(proposal));
  assert.equal(response.text, 'A concise suggestion.');
  assert.deepEqual(response.state.studioReadiness.capture, capture);
  assert.match(director, /reviewCapture: function \(capture, storyId\)/);
  assert.match(director, /showStudioBriefReview\(\)/);
  assert.match(workbench, /creativeCapture = capture/);
  assert.ok(workbench.includes('function captureActionLabel(capture)'));
  assert.match(workbench, /proposedBatch = \{storyId:story\.id,scenes:\[\{sceneId:sceneTarget/);
  assert.match(workbench, /setReadinessFreshness/);
});

test('Invariant capture uses explicit saved identity rather than treating renames as additions', () => {
  const capture = {
    field:'invariant',content:'Short dark hair and a red scarf.',sceneId:'',
    kind:'character',title:'Alicia',beforeKind:'character',beforeTitle:'Alice'
  };
  assert.deepEqual(parse(envelope({...valid,capture})).readiness.capture,capture);
  assert.match(director, /var redirect = \(proposal\.renames \|\| \[\]\)/);
  assert.match(director, /capture\.beforeKind && capture\.beforeTitle/);
  assert.match(director, /proposed\.invariants\[index\] = after/);
  assert.match(director, /Review and edit before saving/);
  assert.match(workbench, /isInvariant = capture\.field === 'invariant'/);
  assert.match(workbench, /creativeCapture = capture/);
});

test('a complete Scene Prompt can open existing placement review with no duplicate LLM call', () => {
  const capture = {field:'scene',title:'Opening chase',content:'The actor reaches the gate.',sceneId:''};
  assert.deepEqual(parse(envelope({...valid,capture})).readiness.capture,capture);
  assert.match(director, /reviewSceneCapture: function \(capture, storyId, options\)/);
  const review = director.split('    reviewSceneCapture: function (capture, storyId, options) {')[1]
    .split('    updateReadiness: function (value) {')[0];
  assert.match(review, /showStudioScenesReview\(\)/);
  assert.match(review, /requiresDurationSelection:needsDuration/);
  assert.doesNotMatch(review, /showStudioSceneDraftReview|studioDirectorRequestMessages|makeProposal|\/fs\/director\/chat/);
  assert.match(workbench, /reviewSceneCapture\(capture,id,\{/);
});

test('Scene suggestions route to one focused Write Scenes workflow', () => {
  assert.match(workbench, /function openRecommendedWrite\(\)/);
  assert.match(workbench, /operation = \['scene', 'scenes', 'scene-edit', 'scenes-batch'\]/);
  assert.match(workbench, /'scene-write'/);
  assert.match(workbench, /run:openRecommendedWrite/);
  assert.match(workbench, /writeOperationChosen = true/);
  assert.match(director, /canReview: function \(\)/);
  assert.match(director, /this\.canReview\(\)/);
});

test('Director guidance presents at most one contextual action and keeps assessment details secondary', () => {
  assert.ok(workbench.includes('function captureActionLabel(capture)'));
  assert.match(workbench, /function writeActionLabel\(\)/);
  assert.match(workbench, /available\.slice\(0,1\)\.forEach/);
  assert.match(workbench, /button\.dataset\.suggestionKind = action\.kind/);
  assert.match(workbench, /dataset\.captureAction = 'true'/);
  assert.match(workbench, /dataset\.guidedWrite = 'true'/);
  assert.match(workbench, /studio-dw-suggestions/);
  assert.match(workbench, /reviewCreativeCapture\(creativeCapture\)/);
  assert.match(workbench, /openRecommendedWrite/);
  assert.match(html, /id="studio-dw-suggestions"/);
  assert.match(html, /<details class="studio-dw-assessment-details">/);
  assert.match(html, /<summary>Assessment<\/summary>/);
  assert.match(workbench, /'Draft Scene revisions'/);
});

test('Scene revision guidance keeps requested duration and title fields',()=>{
  const i=workbench.indexOf('  var sceneFields = ');
  const j=workbench.indexOf('  var labels = ',i);
  const from=workbench.indexOf('  function recommendedWriteFields(operation) {');
  const to=workbench.indexOf('  function refreshRead() {',from);
  assert.ok(i>=0&&j>i&&from>=0&&to>from);
  const scope=vm.createContext({readinessStale:false,recommendations:{
    writeFields:['durationSeconds','title','prompt']
  }});
  vm.runInContext(workbench.slice(i,j)+workbench.slice(from,to),scope);
  assert.deepEqual(Array.from(scope.recommendedWriteFields('scenes')),
    ['durationSeconds','title','prompt']);
});

test('Scene revisions select saved Scenes, leaving changed fields to Director', () => {
  assert.match(workbench, /function recommendedSceneId\(story\)/);
  assert.match(workbench, /story\.sceneOrder\.includes\(id\)/);
  assert.match(workbench, /writeSelectedScene\(\{/);
  assert.match(workbench, /validateSceneRevisionDraft\(result, ids, selected, raw\)/);
  assert.doesNotMatch(workbench, /applySuggestedWriteFields/);
  assert.doesNotMatch(html, /id="studio-dw-batch-fields"/);
});
test('Project overview review preserves unchecked fields while guided revision carries requested fields',()=>{
  assert.match(workbench,/bridge\.prepareWrite\(operation, id, item && storyName\(item\)\)/);
  assert.match(director,/if \(kind === 'project'\) return prepareStudioBrief\(options\)/);
  assert.doesNotMatch(director,/checkbox\.checked = checkbox\.checked && writeFields\.indexOf\(field\) !== -1/);
});


test('complete Studio model output is inspectable and its original capture reopens review', () => {
  const capture={field:'prompt',sceneId:'scene-1',content:'Full draft from earlier reply'};
  const raw=JSON.stringify({reply:"Here's the draft.",readiness:{
    checks:[],readHints:[],writeHint:'',writeFields:[],sceneId:'',capture
  }});
  const created=[];
  function node(tag) {
    const el={tagName:tag,children:[],className:'',classList:{toggle(){},add(){},remove(){}},before(){},
      appendChild(child){this.children.push(child);return child;},
      append(...children){this.children.push(...children);},
      replaceChildren(...children){this.children=children;},
      set textContent(value){this.value=value;this.children=[];},
      get textContent(){return this.value||'';}};
    created.push(el);
    return el;
  }
  const host=node('div'),empty=node('div'),calls=[];
  const context=vm.createContext({
    state:{activeMode:'storyboard'},
    el:id=>id==='director-chat-messages'?host:empty,
    document:{createElement:node},
    currentMessages:()=>[{role:'assistant',content:"Here's the draft.",rawResponse:raw}],
    currentElapsedMap:()=>({}),currentMetricsMap:()=>({}),
    window:{studioDirectorWorkbench:{reviewGeneratedCapture:result=>calls.push(result)}},
    Object,JSON,String
  });
  vm.runInContext(part('  function studioReplyText(content) {','  function renderStudioOperations() {'),context);
  vm.runInContext('renderMessages()',context);
  const details=created.find(n=>n.className==='director-chat-full-response');
  const action=created.find(n=>n.className==='director-chat-review-draft');
  assert.equal(details,undefined,'raw model output stays out of the creative conversation');
  assert.equal(action,undefined,'draft review no longer competes with the conversation');
  assert.match(director,/studioDirectorOpenIo\(\)/);
  assert.match(director,/studio-director-io-raw/);
  assert.match(director,/studio-director-io-review/);
  assert.match(director,/reviewGeneratedCapture\(chosenCapture\)/);
});

test('structured inspection metadata is not sent back with later Studio prompts', async () => {
  const context=vm.createContext({
    state:{studioStoryAccess:null,storyboardAttachments:{},workshop:null},
    Object,String,Promise,window:{getStudioDirectorNavigation:()=>({})},
    requestJson:async()=>({system:'Studio Director',actions:[]})
  });
  vm.runInContext(part('  function studioDirectorRequestMessages(messages, includePromptContract, explicitWrite, navigationSnapshot) {',
    '  function studioDirectorChatRequestMessages(messages, selectedScene, navigationSnapshot) {'),context);
  const outgoing=await vm.runInContext(
    'studioDirectorRequestMessages([{role:"assistant",content:"Ready.",rawResponse:"PRIVATE CAPTURE"}],false)',context);
  assert.equal(outgoing[1].content,'Ready.');
  assert.equal(Object.hasOwn(outgoing[1],'rawResponse'),false);
});


test('plain Read completes the real send/persist path with one chat call and no mutation',async()=>{
  const reply='The saved title is Rainy Bookshop. Fixed details: burgundy cardigan and green door.';
  const state={activeMode:'storyboard',pending:false,attachmentPending:false,sessionReady:true,
    modelId:'remote-model',modeMessages:{storyboard:[]},sessionDirty:{storyboard:false},
    draftByMode:{storyboard:''},sessionTimer:0,jobId:'',pendingReadAck:null};
  const input={value:'What are the saved title and fixed details?',focus(){}};
  const calls=[],snapshots=[],errors=[],seen=[];
  let complete;
  const done=new Promise(resolve=>{complete=resolve;});
  const el=id=>id==='director-chat-input'?input:{textContent:'',dataset:{newResult:'false'}};
  const ctx=vm.createContext({
    state,el,Promise,Object,String,JSON,Array,parseStudioChatResponse:parse,performance:{now:()=>1},
    inputHistory:[],inputHistoryIndex:0,inputHistoryDraft:'',
    persistentMode:mode=>mode==='storyboard',
    studioAttachedStoryId:()=> 'p1',
    studioDirectorSelectedScene:()=>null,
    currentMessages:()=>state.modeMessages.storyboard,
    currentElapsedMap:()=>({}),currentMetricsMap:()=>({}),
    activeContextMode:()=>null,markStudioReadinessOutdated:()=>{state.stale=true;},
    syncControls(){},startProgress(){},renderProgress(){},finishProgress(){},
    renderMessages(){seen.push(state.modeMessages.storyboard.map(m=>m.content));},
    completedResponseMetrics:()=>({}),trackTransientLlmJob(){},
    studioDirectorChatRequestMessages:async messages=>[
      {role:'system',content:'CURRENT SAVED PROJECT OVERVIEW: Rainy Bookshop'},...messages],
    requestJson:async (url,options)=>{
      calls.push({url,body:options&&options.body&&JSON.parse(options.body)});
      assert.equal(url,'/fs/director/chat','Read is never a Project or Scene save');
      assert.equal(calls[0].body.operation,'studio_chat');
      return{job:{jobId:'read-job',status:'queued',modelId:'remote-model'}};
    },
    waitForJob:async()=>({result:{text:reply}}),
    persistSession:async()=>{
      snapshots.push(JSON.parse(JSON.stringify(state.modeMessages.storyboard)));
      if(state.modeMessages.storyboard.at(-1)?.role==='assistant')complete();
    },
    studioActionStatus(){},
    window:{getStudioDirectorNavigation:()=>({projectId:'p1',projectTitle:'Rainy Bookshop',sceneOrder:[]}),
      reportConsoleError:(_label,error)=>errors.push(error)}
  });
  vm.runInContext(part('  function sendMessage() {','  function syncPinnedUi() {'),ctx);
  ctx.sendMessage();
  await done;
  await new Promise(setImmediate);
  assert.equal(calls.length,1);
  assert.equal(calls[0].body.messages[0].content.includes('Rainy Bookshop'),true);
  assert.deepEqual(state.modeMessages.storyboard.map(m=>m.role),['user','assistant']);
  assert.equal(state.modeMessages.storyboard[1].content,reply);
  assert.equal(snapshots.at(-1)[1].content,reply);
  assert.ok(seen.some(lines=>lines.includes(reply)));
  assert.deepEqual(errors,[]);
  assert.equal(state.pending,false);
});
