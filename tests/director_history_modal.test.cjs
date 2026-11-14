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
});

for(const failure of [false,true]) test('History selection closes only after successful loading, failure='+failure,async()=>{
  const state={sessionReady:true,pending:false,attachmentPending:false,activeMode:'storyboard'};
  const dialog={open:true,close(){this.open=false;}};
  const errors=[];let restored,done;
  const finished=new Promise(resolve=>{done=resolve;});
  const scope=vm.createContext({state,el:()=>dialog,flushSessionSave:async()=>{},
    requestJson:async()=>{if(failure)throw Error('Exact history failure');return{chat:{id:'chosen',mode:'storyboard'}};},
    restoreSession:chat=>{restored=chat.id;},finishProgress(){},syncModeUi(){},
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
