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
test('each explicit Read appends an exact visible persisted message without calling any model',async()=>{
  const state={activeMode:'storyboard',sessionReady:true,pending:false,
    attachmentPending:false,sessionByMode:{storyboard:{id:'A'}},modeMessages:{storyboard:[]},sessionDirty:{storyboard:false}};
  const saved=[];
  const bridge=makeBridge(state,async mode=>{
    assert.equal(mode,'storyboard');
    saved.push(structuredClone(state.modeMessages.storyboard));
  });
  const a={projectId:'A',projectTitle:'Film A',fields:[{id:'project.concept',value:'Before edit'}]};
  await bridge.appendReadSnapshot(a,bridge.readConversationId());
  const first=state.modeMessages.storyboard[0];
  assert.equal(first.role,'user');
  assert.match(first.content,/Before edit/);
  a.fields[0].value='After edit';
  assert.match(first.content,/Before edit/,'snapshot must not retain a mutable source reference');
  assert.doesNotMatch(first.content,/After edit/);
  await bridge.appendReadSnapshot({projectId:'B',fields:[{id:'project.style',value:'Cold dawn'}]},bridge.readConversationId());
  assert.equal(saved.length,2);
  assert.equal(saved[1][0].content,first.content);
  assert.match(saved[1][1].content,/Cold dawn/);
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
  const history=[{role:'user',content:'Discuss A'}, {role:'assistant',content:'Sure.'},
    {role:'user',content:visible},{role:'user',content:'Compare to B'}];
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
    appendReadSnapshot:async (payload,owner)=>{assert.equal(owner,'session-A');calls.push(structuredClone(payload));}};
  const fn=new Function('el','selectedPaths','status','loadStory','readPayload','updateReadSelection',
    'updateScope','window',body+'return readSend;')(
      el,()=>['project.concept'],()=>{},async()=>story,
      (saved,keys)=>({projectId:saved.id,projectTitle:saved.title,savedAt:saved.updatedAt,
        fields:keys.map(id=>({id,value:saved.concept}))}),()=>{},()=>{},
      {studioDirectorWorkbench:{setReadStatus(){}},studioDirectorBridge:bridge});
  fn();
  await new Promise(setImmediate);
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].fields,[{id:'project.concept',value:'Unchanged'}]);
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
  await bridge.appendReadSnapshot({projectId:'project-B',fields:[]},bridge.readConversationId());
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
