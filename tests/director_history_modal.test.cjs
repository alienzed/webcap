const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
function part(start,end) {
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,start);return source.slice(a,b);
}

test('automatic conversation titles use human requests and leave renamed titles intact',()=>{
  const scope=vm.createContext({});
  vm.runInContext(part('  function conversationTitle(messages) {','  function upsertSessionSummary(chat) {'),scope);
  const read={role:'user',content:'Read the selected saved context and acknowledge receipt.\n[WEBCAP EXPLICIT READ]\n{"projectId":"p1"}'};
  const messages=[read,{role:'assistant',content:'Context received.'},{role:'user',content:'Give Scene 1 a warmer mood.'}];
  assert.equal(scope.conversationTitle(messages),'Give Scene 1 a warmer mood.');
  assert.equal(scope.conversationTitle([read]),'New chat');
  assert.equal(scope.conversationTitle([{role:'user',content:'Review Scene 2.\n[WEBCAP EXPLICIT READ]\n{}'}]),'Review Scene 2.');
  const renamed={title:'My deliberately named conversation',projectTitle:'Project One'};
  assert.equal(scope.historyDisplayTitle(renamed),renamed.title);
  const legacy={title:'Read the selected saved context and acknowledge receipt. [WEBCAP EXPLICI',projectTitle:'Project One'};
  assert.equal(scope.historyDisplayTitle(legacy),'Project One · context');
  assert.ok(legacy.title.includes('[WEBCAP'),'presentation cleanup does not rewrite saved titles');
  const saved={title:'Saved: Scene changes. Reviewed values are now authoritative. [WEBCAP APP',projectTitle:'Film'};
  assert.equal(scope.historyDisplayTitle(saved),'Film · saved changes');
  assert.ok(saved.title.includes('[WEBCAP'),'legacy titles are formatted without changing storage');
});

for(const failure of [false,true]) test('History selection closes only after successful loading, failure='+failure,async()=>{
  const state={sessionReady:true,pending:false,attachmentPending:false,activeMode:'storyboard'};
  const dialog={open:true,close(){this.open=false;}};
  const errors=[];let restored,done;
  const finished=new Promise(resolve=>{done=resolve;});
  const scope=vm.createContext({state,el:()=>dialog,flushSessionSave:async()=>{},
    requestJson:async()=>{if(failure)throw Error('Exact history failure');return{chat:{id:'chosen',mode:'storyboard'}};},
    restoreSession:chat=>{restored=chat.id;},studioWorkspaceVisible:()=>true,finishProgress(){},syncModeUi(){},
    showSessionFailure:e=>errors.push(e.message),syncControls(){if(!state.pending)done();}});
  vm.runInContext(part('  function selectSession(chatId) {','  function renameSession(chatId, title) {'),scope);
  scope.selectSession('chosen');await finished;
  assert.equal(dialog.open,failure);
  assert.equal(restored,failure?undefined:'chosen');
  assert.deepEqual(errors,failure?['Exact history failure']:[]);
});

test('I/O retains complete structured responses and legacy plain replies',()=>{
  const legacy='RECEIVED: project.title, scene:scene-a:prompt';
  const complete=JSON.stringify({reply:'Complete authored text.\n'.repeat(2000),readiness:{checks:[]}});
  const nodes={};
  function node(){return{children:[],dataset:{},classList:{toggle(){}},replaceChildren(){this.children=[];},appendChild(n){this.children.push(n);},showModal(){this.open=true;}};}
  const scope=vm.createContext({state:{requestDiagnostic:null},
    el:id=>nodes[id] ||= node(),document:{createElement:node},
    currentMessages:()=>[{role:'assistant',content:legacy},{role:'assistant',content:'Short display reply',rawResponse:complete}]});
  vm.runInContext(part('  function studioDirectorOpenIo() {','  function bind() {'),scope);
  scope.studioDirectorOpenIo();
  assert.equal(nodes['studio-director-io-dialog'].open,true);
  assert.equal(nodes['studio-director-io-raw'].textContent,complete);
  const chooser=nodes['studio-director-io-exchange'];chooser.value='0';chooser.onchange();
  assert.equal(nodes['studio-director-io-raw'].textContent,legacy);
  assert.equal(nodes['studio-director-io-parsed'].textContent,legacy);
});


test('Chat History renders Rename and Delete side by side without a More menu',()=>{
  const render=part('  function renderSessionHistory() {','  function showSessionFailure(error) {');
  assert.match(render,/actions\.className = 'director-chat-history-actions'/);
  assert.match(render,/actions\.appendChild\(rename\)/);
  assert.match(render,/actions\.appendChild\(remove\)/);
  assert.match(render,/item\.appendChild\(actions\)/);
  assert.doesNotMatch(render,/document\.createElement\('details'\)|textContent = 'More'/);
});

for (const scenario of ['single', 'all', 'partial']) test('History deletion: '+scenario, async()=>{
  const a={id:'a',mode:'chat',title:'First'}, b={id:'b',mode:'storyboard',title:'Second'};
  const state={sessionReady:true,pending:false,attachmentPending:false,activeMode:'storyboard',
    sessionList:[a,b],sessionByMode:{chat:a,storyboard:b},sessionActiveByMode:{chat:'a',storyboard:'b'},
    sessionDirty:{chat:false,storyboard:false},messages:[{content:'old'}],modeMessages:{storyboard:[{content:'old'}]},
    modeElapsedByAssistantIndex:{},modeMetricsByAssistantIndex:{},draftByMode:{chat:'draft',storyboard:'draft'},
    studioWriteIo:['old']};
  const calls=[],errors=[],nodes={};let resets=0;
  const scope=vm.createContext({state,window:{studioDirectorWorkbench:{resetConversation(){resets++;}}},
    el:id=>nodes[id] ||= {dataset:{},value:'draft'},
    inputHistory:['old'],inputHistoryIndex:1,inputHistoryDraft:'draft',
    syncControls(){},syncModeUi(){},renderSessionHistory(){},showSessionStatus(){},
    showSessionFailure:e=>errors.push(e.message),
    flushSessionSave:async()=>{calls.push('flush');},
    requestJson:async(url,options)=>{assert.equal(options.method,'DELETE');calls.push(url.split('/').pop());if(scenario==='partial'&&url.endsWith('/a'))throw Error('failed');}});
  vm.runInContext(part('  function removeDeletedSession(chat) {','  function formatElapsed(ms) {'),scope);
  if(scenario==='single') await scope.deleteSession('b'); else await scope.deleteAllSessions();
  assert.deepEqual(calls,scenario==='single'?['flush','b']:['flush','a','b']);
  assert.deepEqual(Array.from(state.sessionList,x=>x.id),scenario==='all'?[]:['a']);
  assert.equal(state.sessionByMode.storyboard,null);
  assert.equal(state.sessionActiveByMode.storyboard,null);
  assert.equal(state.modeMessages.storyboard.length,0);
  assert.equal(state.studioWriteIo.length,0);
  assert.equal(state.draftByMode.storyboard,'');
  assert.equal(resets,1);
  assert.equal(state.pending,false);
  assert.equal(errors.length,scenario==='partial'?1:0);
  if(scenario==='all') {
    assert.equal(state.sessionByMode.chat,null);
    assert.equal(state.messages.length,0);
    assert.equal(scope.inputHistory.length,0);
  }
});

test('History header exposes Delete All and binds it directly',()=>{
  const markup=fs.readFileSync(path.join(__dirname,'../tool/tool.html'),'utf8');
  assert.match(markup,/id="director-chat-history-delete-all"[^>]*>Delete All<\/button>/);
  assert.match(source,/el\('director-chat-history-delete-all'\)\.onclick = deleteAllSessions/);
});
