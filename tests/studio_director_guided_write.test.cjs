// Explicit Write selects saved Scene IDs and persists each actual result.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const workbench=fs.readFileSync(path.join(__dirname,'../tool/js/studio_director_workbench.js'),'utf8');
function fixture(fail) {
  const a=workbench.indexOf('  function prepareBatchScenes(storyId) {'),
    b=workbench.indexOf('  window.studioDirectorWorkbench = {',a);
  assert.ok(a>=0&&b>a);
  const story={id:'p1',title:'Project',sceneOrder:['s1','s2','s3'],scenes:{
    s1:{title:'Beginning'},s2:{title:'Middle'},s3:{title:'End'}
  }};
  const selected=['s1','s2','s3'],results=[],statuses=[];
  const button={disabled:false};
  const el=id=>id==='studio-dw-batch-scenes'
    ? {querySelectorAll:()=>selected.map(value=>({value}))}
    : id==='studio-dw-write-prepare' ? button : {};
  const window={
    flushStudioDirectorStoryEdits:async()=>{},
    studioDirectorBridge:{
      selectWriteProject:()=>{},
      writeSelectedScene:async launch=>{
        results.push(launch);
        if(fail) await fail(launch);
        return {story,scene:story.scenes[launch.sceneId]};
      }
    }
  };
  const scope=vm.createContext({window,el,Promise,Array,String,Error,
    manualSceneInstruction:()=> 'Make each Scene quieter.',
    status:(...args)=>statuses.push(args),
    loadStory:async()=>story,storyName:x=>x.title});
  const write=vm.runInContext(workbench.slice(a,b)+'\nprepareBatchScenes',scope);
  return {write,story,results,statuses,button,selected};
}
test('selected Scene list writes each exact ID once with focused requested fields',async()=>{
  const h=fixture();
  const outcome=await h.write('p1');
  assert.deepEqual(h.results.map(x=>x.sceneId),['s1','s2','s3']);
  assert.deepEqual(h.results.map(x=>x.fields),[['prompt'],['prompt'],['prompt']]);
  assert.ok(h.results.every(x=>x.forceAuthor===true&&x.projectId==='p1'));
  assert.equal(outcome.saved.length,3);
  assert.equal(outcome.failed.length,0);
  assert.equal(h.button.disabled,false);
});
test('item-specific failure preserves other successful Scene writes',async()=>{
  const h=fixture(async launch=>{
    if(launch.sceneId==='s2')throw Error('Scene-specific provider error');
  });
  const outcome=await h.write('p1');
  assert.deepEqual(h.results.map(x=>x.sceneId),['s1','s2','s3']);
  assert.equal(outcome.saved.length,2);
  assert.equal(outcome.failed.length,1);
  assert.equal(outcome.notAttempted.length,0);
});
test('shared runtime failure stops further selected Scenes and reports them',async()=>{
  const h=fixture(async launch=>{
    if(launch.sceneId==='s2')throw Error('runtime unavailable');
  });
  const outcome=await h.write('p1');
  assert.deepEqual(h.results.map(x=>x.sceneId),['s1','s2']);
  assert.equal(outcome.saved.length,1);
  assert.equal(outcome.failed.length,1);
  assert.equal(outcome.notAttempted.length,1);
});
test('no legacy batch Review controls remain in the direct Write surface',()=>{
  for(const word of ['renderBatchReview','applyBatchScenes','pendingCreativeAction',
    'showConversationWrite','studio-dw-batch-review'])
    assert.ok(!workbench.includes(word),word);
});
