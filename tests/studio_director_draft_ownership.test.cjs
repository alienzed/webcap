'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const director=fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
const workbench=fs.readFileSync(path.join(__dirname,'../tool/js/studio_director_workbench.js'),'utf8');

function part(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'Production section absent: '+start);
  return source.slice(a,b);
}

test('Write receives persisted Read snapshots verbatim without changing explicit destination',async()=>{
  const segment=part(director,
    '  function studioDirectorRequestMessages(messages, includePromptContract, explicitWrite, navigationSnapshot) {',
    '  function studioDirectorChatRequestMessages(');
  const requests=[];
  const requestJson=async url=>{
    requests.push(url);
    assert.equal(url,'/fs/studio/director/guidance?targetModel=minimax_h3');
    return {system:'Creative partner',promptContract:'H3 writing reference'};
  };
  const request=new Function('requestJson',segment+'return studioDirectorRequestMessages;')(requestJson);
  const snapshot='[WEBCAP EXPLICIT READ] From Project source: Warm amber source';
  const input=[{role:'user',content:snapshot},
    {role:'user',content:JSON.stringify({task:'Write a Scene',destinationProjectId:'destination'})}];
  const output=await request(input,true,true);
  assert.match(output[0].content,/H3 PROMPT AUTHORING REFERENCE/);
  assert.doesNotMatch(output[0].content,/Warm amber source/);
  assert.equal(output[1].content,snapshot);
  assert.equal(output[2].content,input[1].content);
  assert.equal(JSON.parse(output[2].content).destinationProjectId,'destination');
  assert.equal(requests.length,1,'no source reread during Write');
});

test('ordinary conversation does not receive H3 guidance or implicit saved creative material',async()=>{
  const section=part(director,
    '  function studioDirectorRequestMessages(messages, includePromptContract, explicitWrite, navigationSnapshot) {',
    '  function studioDirectorChatRequestMessages(');
  const state={studioApprovedRead:null};
  const requestJson=async()=>({system:'Creative partner',promptContract:'H3 secret'});
  const window={};
  const build=new Function('state','requestJson','window',section+
    'return studioDirectorRequestMessages;')(state,requestJson,window);
  const messages=await build([{role:'user',content:'Discuss the mood.'}],false,false);
  assert.equal(messages[0].content,'Creative partner');
  assert.doesNotMatch(JSON.stringify(messages),/H3 secret/);
  assert.equal(messages[1].content,'Discuss the mood.');
});

test('actual saved field cleanup does not erase unrelated unsaved working values',()=>{
  const from=director.indexOf('  function forgetSavedStudioSceneFields(');
  const to=director.indexOf('\n  window.studioDirectorBridge = {',from);
  assert.ok(from>=0&&to>from);
  const state={studioWorkingDraft:{scenes:{
    scene1:{prompt:'Saved prompt',title:'Separate unsaved title'}
  }}};
  let writes=0;
  const clear=new Function('state','scheduleSessionSave',
    director.slice(from,to)+'return forgetSavedStudioSceneFields;')(
      state,()=>writes++);
  clear('project','scene1',{prompt:'Saved prompt',title:'Other title'});
  assert.deepEqual(state.studioWorkingDraft.scenes.scene1,{title:'Separate unsaved title'});
  clear('project','scene1',{title:'Separate unsaved title'});
  assert.equal(state.studioWorkingDraft.scenes.scene1,undefined);
  assert.equal(writes,2);
});

test('selected Scene batch is independently saved per Scene, not a single deferred Review',()=>{
  const batch=part(workbench,'  function prepareBatchScenes(storyId) {',
    '  function renderBatchReview() {');
  assert.match(batch,/studioDirectorBridge\.writeSelectedScene\(/);
  assert.match(batch,/outcome\.saved\.push/);
  assert.match(batch,/outcome\.failed\.push/);
  assert.match(batch,/outcome\.reportingErrors\.push/);
  assert.doesNotMatch(batch,/renderBatchReview\(/);
});

test('retired chat-to-Write action and draft-merge paths have no executable entry points',()=>{
  assert.doesNotMatch(director,/function studioAuthoredWriteActions\(/);
  assert.doesNotMatch(director,/function studioMergeWorkingChanges\(/);
  const send=part(director,'  function sendMessage() {','  function syncPinnedUi() {');
  assert.doesNotMatch(send,/presentAction\(|showStudioScenesReview\(|showStudioProjectReview\(/);
});
