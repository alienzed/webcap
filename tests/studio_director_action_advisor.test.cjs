'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const chat = fs.readFileSync('tool/js/director_chat.js','utf8');
const bench = fs.readFileSync('tool/js/studio_director_workbench.js','utf8');

function part(source,start,end) {
  const at=source.indexOf(start), stop=source.indexOf(end,at+start.length);
  assert.ok(at>=0 && stop>at, 'Missing source section: '+start);
  return source.slice(at,stop);
}

test('sidecar job uses an isolated model operation and job-poll path',async()=>{
  const calls=[];
  const api=async(url, options)=>{
    calls.push({url,body:options && JSON.parse(options.body)});
    if(url==='/fs/director/chat')return {job:{jobId:'advisor-1',status:'queued'}};
    if(url.startsWith('/fs/director/job?'))return {job:{jobId:'advisor-1',status:'completed',result:{text:'{"actions":[]}'}}};
    throw new Error('Unexpected '+url);
  };
  const fn=new Function('api','setTimeout',part(bench,'  function runSidecar(operation, model, message) {','  var advisorTurn = 0;')+
    'return runSidecar;')(api,(callback)=>callback());
  const raw=await fn('studio_action_advisor','cheap-model',{conversation:[{role:'assistant',content:'Hello'}]});
  assert.equal(raw,'{"actions":[]}');
  assert.equal(calls.length,2);
  assert.equal(calls[0].url,'/fs/director/chat');
  assert.equal(calls[0].body.operation,'studio_action_advisor');
  assert.equal(calls[0].body.model,'cheap-model');
  assert.equal(calls[0].body.messages.length,1);
  assert.equal(JSON.parse(calls[0].body.messages[0].content).conversation[0].content,'Hello');
  assert.match(calls[1].url,/consume=1/);
});

const candidates=new Function('allowedAdvisorKinds','projectFields',
  part(bench,'  function advisorCandidates(raw,scope) {','  function revealAdvisorPanel(which) {')+
  'return advisorCandidates;')(
    ['create_project','revise_project','create_scene','revise_scenes','read'],
    ['title','concept','style','invariants']
  );
test('Advisor only offers applicable existing actions, exact IDs and explicit Project fields',()=>{
  const scope={projectId:'project-one',sceneId:'scene-one'};
  assert.deepEqual(candidates(JSON.stringify({actions:[
    {kind:'revise_project',label:'Change the lighting',instruction:'Cool dusk',projectId:'project-one',fields:['style','made-up']},
    {kind:'revise_project',label:'Wrong project',instruction:'Change',projectId:'other',fields:['style']},
    {kind:'revise_scenes',label:'Scene cut',instruction:'Shorten movement',projectId:'project-one',sceneIds:['scene-one','other-scene']},
    {kind:'read',label:'Read overview',projectId:'project-one',fields:['overview']},
    {kind:'create_scene',label:'Fourth unreturned card',projectId:'project-one',instruction:'Create'}
  ]}),scope).map(x=>({kind:x.kind,fields:x.fields,sceneIds:x.sceneIds})),[
    {kind:'revise_project',fields:['style'],sceneIds:[]},
    {kind:'revise_scenes',fields:[],sceneIds:['scene-one']},
    {kind:'read',fields:['overview'],sceneIds:[]}
  ]);
  assert.deepEqual(candidates('{"actions":[{"kind":"revise_project","label":"Change","projectId":"project-one","instruction":"Do it","fields":[]}] }',scope),[]);
  assert.deepEqual(candidates('{"actions":[]}',scope),[]);
  assert.throws(()=>candidates('broken',scope),SyntaxError);
});

test('Prepare Write preloads existing operation, target, field scope and instruction without saving',async()=>{
  const fields=['title','concept','style','invariants'].map(value=>({value,checked:true}));
  const node=()=>({value:'',dataset:{},setAttribute(){},classList:{add(){},contains(){return false;}}});
  const elements={
    'director-chat-drawer':node(),'studio-dw-open-tools':node(),
    'studio-dw-write-panel':Object.assign(node(),{classList:{contains:()=>true}}),
    'studio-dw-write-project':Object.assign(node(),{options:[{value:'project-one'}]}),
    'studio-dw-write-operation':node(),'studio-dw-scene-mode':node(),
    'studio-dw-write-project-fields':{querySelectorAll:()=>fields},
    'studio-dw-write-instruction':node()
  };
  const calls={toggle:[],refresh:0,operation:0,save:0,status:[]};
  const functions=part(bench,'  function revealAdvisorPanel(which) {','  function offerActionAdvice(scope) {');
  const prepare=new Function('el','window','toggle','refreshWrite','setOperation','advisorStatus','loadStory',
    'readChoices','renderReadStory','projectFields','sceneSelectionManual',
    functions+'return prepareAdvisorAction;')(
      id=>elements[id],{studioDirectorBridge:{
        isCurrentConversation:id=>id==='chat-one',isReady:()=>true},
        reportConsoleError:()=>assert.fail('Should not log an error')},
      which=>{calls.toggle.push(which);return Promise.resolve();},
      async()=>{calls.refresh++;return true;},
      ()=>calls.operation++,msg=>calls.status.push(msg),
      async()=>assert.fail('Write preload must not fetch a Read snapshot'),
      {},()=>{},['title','concept','style','invariants'],false
    );
  await prepare({kind:'revise_project',projectId:'project-one',fields:['style'],
    instruction:'Make the light warmer'},{conversationId:'chat-one'});
  assert.deepEqual(calls.toggle,['write']);
  assert.equal(calls.refresh,1);
  assert.equal(elements['studio-dw-write-operation'].value,'project');
  assert.equal(elements['studio-dw-write-project'].value,'project-one');
  assert.deepEqual(fields.map(x=>x.checked),[false,false,true,false]);
  assert.equal(elements['studio-dw-write-instruction'].value,'Make the light warmer');
  assert.equal(calls.save,0);
  assert.ok(calls.status.some(s=>s.includes('Write prepared')));
});

test('Director chat invokes sidecar after successful conversation save, not in its own request chain',()=>{
  const send=part(chat,'  function sendMessage() {','  function syncPinnedUi() {');
  const bridge=part(chat,'  window.studioDirectorBridge = {','    readConversationId: function () {');
  assert.match(send,/requestPromise\.catch/);
  assert.match(send,/if \(!requestError && activeChatMode === 'storyboard'/);
  assert.match(send,/Promise\.resolve\(\)\.then\(function \(\) \{\s*window\.studioDirectorWorkbench\.offerActionAdvice\(scope\)/);
  assert.match(send,/clearActionAdvice\(\)/);
  assert.match(bridge,/isCurrentConversation/);
  assert.doesNotMatch(send,/operation:\s*'studio_action_advisor'/);
});
