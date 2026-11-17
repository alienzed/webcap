'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const chat=fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'../tool/server/app.py'),'utf8');
const guidance=fs.readFileSync(path.join(__dirname,'../tool/server/studio_director.py'),'utf8');
const workbench=fs.readFileSync(path.join(__dirname,'../tool/js/studio_director_workbench.js'),'utf8');
function part(source,begin,end) {
  const a=source.indexOf(begin),b=source.indexOf(end,a+begin.length);
  assert.ok(a>=0&&b>a,'Missing source boundary: '+begin);
  return source.slice(a,b);
}
const createComposer=new Function('requestJson',
  part(chat,'  function studioConversationMessages(messages) {',
    '  function studioApprovedReadSources() {')+
  'return {studioConversationMessages,studioDirectorRequestMessages};');
const composer=()=>createComposer(async()=>({
  system:'Focused project and scene writer',chatSystem:'Creative conversation',
  promptContract:'H3 prompt instructions'
}));

test('Chat has a natural-language contract without structured output',()=>{
  const route=part(app,'@app.route("/fs/director/chat", methods=["POST"])',
    '@app.route("/fs/storyboard/director",');
  assert.ok(!route.includes('if operation == "studio_chat":\n            contract["response_schema"]'));
  assert.ok(guidance.includes('def chat_guidance():'));
  const send=part(chat,'  function sendMessage() {','  function syncPinnedUi() {');
  assert.ok(send.includes("operation: activeChatMode === 'storyboard' ? 'studio_chat'"));
  assert.ok(!send.includes('studioAuthoredWriteActions'));
  assert.ok(!send.includes('presentAction'));
});

test('all conversation turns preserve role, content and arbitrary message length',async()=>{
  const messages=Array.from({length:30},(_,i)=>({
    role:i%2?'assistant':'user',content:'Turn '+i+': '+('x'.repeat(5000))
  }));
  const c=composer();
  const chatSent=await c.studioDirectorRequestMessages(messages,false,false);
  const writeSent=await c.studioDirectorRequestMessages(messages,true,true);
  assert.equal(chatSent.length,31);
  assert.deepEqual(chatSent.slice(1),messages);
  assert.deepEqual(writeSent.slice(1),messages);
  assert.equal(chatSent[0].content,'Creative conversation');
  assert.ok(!chatSent[0].content.includes('H3 prompt instructions'));
  assert.ok(writeSent[0].content.includes('H3 prompt instructions'));
  assert.ok(!chat.includes('.slice(-8)'));
});

test('machine-generated save receipts do not impersonate human creative turns',()=>{
  const c=composer();
  const messages=[
    {role:'user',content:'An empty train station'},
    {role:'assistant',content:'Use restrained blue lighting.'},
    {role:'user',content:'[WEBCAP APPLIED FIELD VALUES] machine save'},
    {role:'user',content:'Let the courier find a red mitten.'}
  ];
  assert.deepEqual(c.studioConversationMessages(messages).map(x=>x.content),
    [messages[0].content,messages[1].content,messages[3].content]);
});

test('explicit Studio Write uses direct save, no old Review launchers',()=>{
  for(const name of ['commitFocusedStudioProject','commitFocusedStudioBrief',
    'writeNewScene: function','writeSelectedScene: function'])
    assert.ok(chat.includes(name));
  for(const name of ['showStudioProjectReview','showStudioBriefReview',
    'showStudioScenesReview','studioAuthoredWriteActions','studioMergeWorkingChanges'])
    assert.ok(!chat.includes(name),name);
  assert.ok(workbench.includes('forceAuthor:true, directSave:true'));
  assert.ok(!workbench.includes('pendingCreativeAction'));
  assert.ok(!workbench.includes('renderBatchReview'));
});

test('focused Overview Write saves only the requested field and records History',async()=>{
  const scope=part(chat,'  function commitFocusedStudioBrief(',
    '  function prepareStudioBrief(');
  const events=[];
  const commit=new Function('requestJson','recordStudioOperation','studioActionStatus',
    'window','state',scope+'return commitFocusedStudioBrief;')(
    async(url,opts)=>{
      events.push({url,payload:JSON.parse(opts.body)});
      return {story:{id:'p1',title:'Existing',concept:'Unchanged',style:'Blue dawn',
        invariants:[]},revisionId:'r1'};
    },()=>{},()=>{},{
      webcapTextareaRevisions:{recordFieldChange:(...a)=>events.push(a)},
      studioDirectorBridge:{recordApplied:async()=>{}},
      refreshStudioDirectorStoryIfOpen:async()=>{}
    },{}
  );
  await commit('p1',{title:'Existing',concept:'Unchanged',style:'Warm dusk',invariants:[]},
    {title:'Unrequested',style:'Blue dawn'},['style']);
  assert.equal(events[0].url,'/fs/studio/director/brief');
  assert.deepEqual(events[0].payload.changes,{style:'Blue dawn'});
  assert.equal(events[1][0],'project:p1:storyboard-story-style');
});

test('model-authored Project fields reach the backend without creative filtering',async()=>{
  const source=part(chat,'  function commitFocusedStudioProject(',
    '  function prepareStudioProject(');
  let payload;
  const commit=new Function('requestJson','recordStudioOperation','studioActionStatus',
    'window','state',source+'return commitFocusedStudioProject;')(
    async(url,opts)=>{payload=JSON.parse(opts.body);throw Error('Backend save failed');},
    ()=>{},()=>{},{
      webcapTextareaRevisions:{recordFieldChange:()=>{}},
      studioDirectorBridge:{recordApplied:async()=>{}},
      refreshStudioDirectorStoryIfOpen:async()=>{}
    },{}
  );
  await assert.rejects(()=>commit({title:'Incomplete',concept:'Only concept',style:'',invariants:[]}),
    /Backend save failed/);
  assert.equal(payload.proposal.style,'');
});
