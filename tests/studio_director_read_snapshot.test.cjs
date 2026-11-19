'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const director = fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
const workbench = fs.readFileSync(path.join(__dirname,'../tool/js/studio_director_workbench.js'),'utf8');
function section(source,start,end) {
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'Missing section '+start);
  return source.slice(a,b);
}
const snapshotSource=section(director,'    readConversationId: function () {','    selectWriteProject: function (');
const requestSource=section(director,
  '  function studioDirectorRequestMessages(messages, includePromptContract, explicitWrite, navigationSnapshot) {',
  '  // Retain available conversational work across ordinary follow-up questions.');
function makeBridge(state, persistSession, renderMessages=()=>{}, syncModeUi=()=>{}) {
  return new Function('state','persistSession','renderMessages','syncModeUi',
    'return ({'+snapshotSource+'});')(
      state,persistSession,renderMessages,syncModeUi);
}

test('Read groups only selected values by Scene in saved order with explicit duration units',()=>{
  const build=new Function('projectFields','storyName',
    section(workbench,'  function readPayload(story, keys) {','  function updateReadSelection() {')+
    'return readPayload;')(['title','concept','style','invariants'],story=>story.title);
  const story={id:'project-private-id',title:'Film',updatedAt:'saved',concept:'Unselected concept',
    sceneOrder:['scene-private-a','scene-private-b'],scenes:{
      'scene-private-a':{title:'Same title',prompt:'',durationSeconds:8},
      'scene-private-b':{title:'Same title',prompt:'Unselected prompt',durationSeconds:15}}};
  const before=structuredClone(story);
  const payload=build(story,['scene:scene-private-b:title','scene:scene-private-b:durationSeconds',
    'scene:scene-private-a:prompt','project.style']);
  assert.deepEqual(payload,{project:{title:'Film',style:null},savedAt:'saved',scenes:[
    {number:1,prompt:''},{number:2,title:'Same title',durationSeconds:15}]});
  assert.doesNotMatch(JSON.stringify(payload),/private-|Unselected|"fields"|"value"/);
  assert.deepEqual(story,before);
});

test('overlapping Overview and individual Invariant selections do not duplicate or mutate saved values',()=>{
  const build=new Function('projectFields','storyName',
    section(workbench,'  function readPayload(story, keys) {','  function updateReadSelection() {')+
    'return readPayload;')(['title','concept','style','invariants'],story=>story.title);
  const story={id:'p',title:'Film',invariants:[
    {kind:'character',title:'Mara',text:'Silver hairpin'},
    {kind:'location',title:'Studio',text:'White walls'}]};
  const before=structuredClone(story);
  for(const keys of [['project.invariants','invariant:character:Mara'],
                    ['invariant:character:Mara','project.invariants']]) {
    assert.deepEqual(build(story,keys).project.invariants,story.invariants);
    assert.deepEqual(story,before);
  }
  assert.deepEqual(build(story,['invariant:character:Mara']).project.invariants,[story.invariants[0]]);
});

test('Inspect fields submits the direct preview while keeping storage identity in application arguments',async()=>{
  const body=section(director,'  function inspectStudioStoryScope() {','  function syncStudioFlow() {');
  const nodes=new Map();
  const el=id=>{
    if(!nodes.has(id))nodes.set(id,{value:id==='director-studio-access-field'?'prompt':'scene-private',
      textContent:'',classList:{add(){},remove(){}}});
    return nodes.get(id);
  };
  const state={studioStoryAccess:{storyId:'project-private',label:'Film'},
    studioAccessIndex:[{id:'scene-private',position:2,title:'Arrival'}]};
  let sent;
  const bridge={readConversationId:()=> 'chat',assertReadConversation:id=>assert.equal(id,'chat'),
    appendReadSnapshot:async(payload,owner,projectId)=>{
      assert.equal(owner,'chat');assert.equal(projectId,'project-private');sent=payload;
    }};
  const inspect=new Function('state','el','loadStudioAccessIndex','readStudioStoryScope','window',body+
    'return inspectStudioStoryScope;')(state,el,async()=>{},async(field,id)=>{
      assert.equal(field,'prompt');assert.equal(id,'scene-private');
      return {storyId:'project-private',sceneId:id,storyUpdatedAt:'saved',
        data:{id,prompt:'Full saved prompt',durationSeconds:15}};
    },{studioDirectorBridge:bridge,reportConsoleError:(_source,error)=>{throw error;}});
  await inspect();
  assert.deepEqual(sent,{project:{title:'Film'},savedAt:'saved',scenes:[
    {number:2,title:'Arrival',prompt:'Full saved prompt',durationSeconds:15}]});
  assert.equal(el('director-studio-access-data').textContent,JSON.stringify(sent,null,2));
  assert.doesNotMatch(JSON.stringify(sent),/private/);
});
test('each explicit Read appends an exact visible persisted message without calling any model',async()=>{
  const state={activeMode:'storyboard',sessionReady:true,pending:false,
    attachmentPending:false,sessionByMode:{storyboard:{id:'A'}},modeMessages:{storyboard:[]},sessionDirty:{storyboard:false}};
  const saved=[];
  const bridge=makeBridge(state,async mode=>{
    assert.equal(mode,'storyboard');
    saved.push(structuredClone(state.modeMessages.storyboard));
  });
  const a={project:{title:'Film A',concept:'Before edit'}};
  await bridge.appendReadSnapshot(a,bridge.readConversationId(),'A');
  const first=state.modeMessages.storyboard[0];
  assert.equal(first.role,'user');
  assert.match(first.content,/Before edit/);
  assert.equal(first.content,'[WEBCAP EXPLICIT READ — SAVED SNAPSHOT]\n'+
    JSON.stringify(a,null,2)+'\n[END WEBCAP READ]');
  a.project.concept='After edit';
  assert.match(first.content,/Before edit/,'snapshot must not retain a mutable source reference');
  assert.doesNotMatch(first.content,/After edit/);
  await bridge.appendReadSnapshot({project:{title:'Film B',style:'Cold dawn'}},bridge.readConversationId(),'B');
  assert.equal(saved.length,2);
  assert.equal(saved[1][0].content,first.content);
  assert.match(saved[1][1].content,/Cold dawn/);
  const reloaded=JSON.parse(JSON.stringify(saved[1]));
  assert.equal(reloaded[0].content,first.content);
});
test('ordinary chat and explicit Write pass exact Read message text in full history with no reread',async()=>{
  const requests=[];
  const requestJson=async url=>{
    requests.push(url);
    assert.equal(url,'/fs/studio/director/guidance?targetModel=minimax_h3');
    return {system:'Creative partner',promptContract:'H3 Scene guidance'};
  };
  const maker=new Function('requestJson','studioAttachedStoryId',requestSource+
    'return {base:studioDirectorRequestMessages,chat:studioDirectorChatRequestMessages};')(requestJson,()=> '');
  const visible='[WEBCAP EXPLICIT READ — SAVED SNAPSHOT]\\n'+
    JSON.stringify({projectId:'A',fields:[{id:'project.style',value:'Old version'}]},null,2)+
    '\\n[END WEBCAP READ]';
  const direct='[WEBCAP EXPLICIT READ — SAVED SNAPSHOT]\n'+
    JSON.stringify({project:{title:'Film B'},scenes:[{number:2,durationSeconds:15,prompt:'Full prompt'}]},null,2)+
    '\n[END WEBCAP READ]';
  const history=[{role:'user',content:'Discuss A'}, {role:'assistant',content:'Sure.'},
    {role:'user',content:visible},{role:'user',content:direct},{role:'user',content:'Compare to B'}];
  const chat=await maker.chat(history,null,{projectId:'B'}, {});
  const write=await maker.base(history,true,true);
  for(const outbound of [chat,write]) {
    assert.equal(outbound.length,history.length+1);
    history.forEach((entry,i)=>assert.deepEqual(outbound[i+1],entry));
    assert.equal(outbound[3].content,visible);
    assert.doesNotMatch(outbound[0].content,/Old version|AUTHOR-APPROVED SAVED CONTEXT/);
  }
  assert.equal(requests.length,2,'only guidance lookup; never re-fetch saved Projects');
  assert.doesNotMatch(chat[0].content,/H3 Scene guidance/);
  assert.match(write[0].content,/H3 Scene guidance/);
});
test('Read UI serializes the fetched saved snapshot once and delegates persistence; no approval state',async()=>{
  const body=section(workbench,'  function readSend(instruction) {','  function showWriteContext() {');
  const els=new Map();
  const el=id=>{
    if(!els.has(id)) els.set(id,{
      value:id==='studio-dw-read-project'?'A':'',
      disabled:false, textContent:'', dataset:{},
      classList:{add(){},remove(){},contains(){return false}},
      setAttribute(){}
    });
    return els.get(id);
  };
  const calls=[];
  const story={id:'A',title:'Film A',updatedAt:'t1',concept:'Unchanged'};
  const bridge={readConversationId:()=> 'session-A',assertReadConversation:owner=>assert.equal(owner,'session-A'),
    appendReadSnapshot:async (payload,owner,projectId)=>{assert.equal(owner,'session-A');assert.equal(projectId,'A');calls.push(structuredClone(payload));}};
  const fn=new Function('el','selectedPaths','status','loadStory','readPayload','updateReadSelection',
    'updateScope','window',body+'return readSend;')(
      el,()=>['project.concept'],()=>{},async()=>story,
      saved=>({project:{title:saved.title,concept:saved.concept},savedAt:saved.updatedAt}),()=>{},()=>{},
      {studioDirectorWorkbench:{setReadStatus(){}},studioDirectorBridge:bridge});
  fn();
  await new Promise(setImmediate);
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].project,{title:'Film A',concept:'Unchanged'});
  assert.equal(els.get('studio-dw-read-preview-data').textContent,JSON.stringify(calls[0],null,2));
  assert.doesNotMatch(body,/approveRead|sendMessage|\/fs\/director\/chat/);
});
test('Read persistence rejects a completion from conversation A after switching to B',async()=>{
  const state={activeMode:'storyboard',sessionReady:true,pending:false,attachmentPending:false,
    sessionByMode:{storyboard:{id:'session-A'}},modeMessages:{storyboard:[{role:'user',content:'A'}]},
    sessionDirty:{storyboard:false}};
  const persisted=[];
  const bridge=makeBridge(state,async()=>{persisted.push(state.sessionByMode.storyboard.id);});
  const captured=bridge.readConversationId();
  state.sessionByMode.storyboard={id:'session-B'};
  state.modeMessages.storyboard=[{role:'user',content:'B'}];
  await assert.rejects(async()=>bridge.appendReadSnapshot({projectId:'project-A',fields:[]},captured),/Conversation changed/);
  assert.deepEqual(state.modeMessages.storyboard,[{role:'user',content:'B'}]);
  assert.equal(persisted.length,0);
  // A normal new Read in B still works.
  await bridge.appendReadSnapshot({project:{title:'Project B'}},bridge.readConversationId(),'project-B');
  assert.equal(state.modeMessages.storyboard.length,2);
  assert.deepEqual(persisted,['session-B']);
});

test('workbench Read captures conversation ownership before fetching, never saves A into B',async()=>{
  const body=section(workbench,'  function readSend(instruction) {','  function showWriteContext() {');
  const els=new Map();
  const el=id=>{
    if(!els.has(id)) els.set(id,{
      value:id==='studio-dw-read-project'?'project-A':'',disabled:false,textContent:'',dataset:{},
      classList:{add(){},remove(){},contains(){return false}},setAttribute(){}
    });
    return els.get(id);
  };
  let resolveStory,owner='session-A',appends=0,errors=[];
  const loading=new Promise(resolve=>{resolveStory=resolve;});
  const state={activeMode:'storyboard',sessionReady:true,pending:false,attachmentPending:false,
    sessionByMode:{storyboard:{id:'session-A'}},modeMessages:{storyboard:[{role:'user',content:'A'}]},
    sessionDirty:{storyboard:false}};
  const bridge=makeBridge(state,async()=>{appends++;});
  const fn=new Function('el','selectedPaths','status','loadStory','readPayload','updateReadSelection',
    'updateScope','window',body+'return readSend;')(
      el,()=>['project.concept'],(m,e)=>{if(e)errors.push(m);},()=>loading,
      story=>({projectId:story.id,fields:[{id:'project.concept',value:story.concept}]}),
      ()=>{},()=>{}, {studioDirectorWorkbench:{setReadStatus(){}},studioDirectorBridge:bridge});
  fn();
  state.sessionByMode.storyboard={id:'session-B'};
  state.modeMessages.storyboard=[{role:'user',content:'B'}];
  resolveStory({id:'project-A',concept:'Only A knows this'});
  await new Promise(setImmediate);
  assert.equal(appends,0);
  assert.deepEqual(state.modeMessages.storyboard,[{role:'user',content:'B'}]);
  assert.ok(errors.some(m=>m.includes('Conversation changed')));
});

test('legacy Project-field Read rejects a late result after switching conversations',async()=>{
  const body=section(director,'  function inspectStudioStoryScope() {','  function syncStudioFlow() {');
  let complete, appends=0;
  const loading=new Promise(resolve=>{complete=resolve;});
  const state={activeMode:'storyboard',sessionReady:true,pending:false,attachmentPending:false,
    sessionByMode:{storyboard:{id:'session-A'}},modeMessages:{storyboard:[]},
    sessionDirty:{storyboard:false},studioStoryAccess:{storyId:'project-A'}};
  const bridge=makeBridge(state,async()=>{appends++;});
  const nodes=new Map();
  const el=id=>{
    if(!nodes.has(id))nodes.set(id,{
      value:id==='director-studio-access-field'?'brief':'',
      textContent:'',classList:{add(){},remove(){}}
    });
    return nodes.get(id);
  };
  const inspect=new Function('state','el','loadStudioAccessIndex','readStudioStoryScope','window',body+
    'return inspectStudioStoryScope;')(state,el,()=>Promise.resolve(),()=>loading,
    {studioDirectorBridge:bridge,reportConsoleError(){}});
  const pending=inspect();
  state.sessionByMode.storyboard={id:'session-B'};
  state.modeMessages.storyboard=[{role:'user',content:'B'}];
  state.studioStoryAccess={storyId:'project-B'};
  complete({storyId:'project-A',data:{concept:'Only A'}});
  await pending;
  assert.equal(appends,0);
  assert.deepEqual(state.modeMessages.storyboard,[{role:'user',content:'B'}]);
  assert.match(el('director-studio-access-status').textContent,/Conversation changed/);
});

test('no standing Read approval remains in live Director code',()=>{
  assert.doesNotMatch(director,/studioApprovedRead|approvedReadSources|pendingReadAck/);
  assert.doesNotMatch(workbench,/approveRead\(|removeApprovedRead|clearApprovedRead/);
});
