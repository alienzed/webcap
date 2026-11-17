// Focused Studio Scene revisions: one explicit operation, exact target fields,
// authoritative save and recoverable History. No Review or semantic validator.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,
  '../tool/js/studio_director_workbench.js'),'utf8');

function method(start,end) {
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'Missing direct write method');
  return source.slice(a,b).trim().replace(/,\s*$/,'');
}

function harness() {
  const saved={id:'p1',title:'Project',sceneOrder:['s1','s2'],scenes:{
    s1:{id:'s1',title:'Opening',prompt:'Original prompt',durationSeconds:8,
      notes:'Preserve notes'},
    s2:{id:'s2',title:'Second',prompt:'Other prompt',durationSeconds:9}
  }};
  const events=[],versions=[];
  const scope=vm.createContext({
    api:async(url,options)=>{
      assert.equal(url,'/fs/studio/director/scene-fields');
      const payload=JSON.parse(options.body);
      events.push(['save',payload]);
      const scene=saved.scenes[payload.sceneId];
      Object.assign(scene,payload.changes);
      return {story:saved,scene};
    },
    window:{
      flushStudioDirectorStoryEdits:async id=>events.push(['flush',id]),
      refreshStudioDirectorStoryIfOpen:async id=>events.push(['refresh',id]),
      studioDirectorBridge:{recordApplied:async(kind,story,receipt)=>{
        events.push(['receipt',kind,receipt]);}},
      webcapTextareaRevisions:{recordFieldChange:(...args)=>versions.push(args)}
    },
    Promise,Object,String,Error,JSON
  });
  const body=method('    applyScenePrompt: function (story, sceneId, prompt, extraChanges) {',
    '    setStatus:status,');
  const apply=vm.runInContext('({'+body+'})',scope).applyScenePrompt;
  return {saved,events,versions,apply};
}

test('focused Prompt Write targets one exact Scene and checkpoints History',async()=>{
  const h=harness();
  await h.apply(h.saved,'s1','Replacement H3 prompt',{});
  const payload=h.events.find(x=>x[0]==='save')[1];
  assert.equal(payload.storyId,'p1');
  assert.equal(payload.sceneId,'s1');
  assert.deepEqual(JSON.parse(JSON.stringify(payload.changes)),{prompt:'Replacement H3 prompt'});
  assert.equal(h.saved.scenes.s1.prompt,'Replacement H3 prompt');
  assert.equal(h.saved.scenes.s2.prompt,'Other prompt');
  assert.equal(h.saved.scenes.s1.notes,'Preserve notes');
  assert.deepEqual(h.versions,[['project:p1:scene:s1:field:prompt',
    'Original prompt','Replacement H3 prompt']]);
  assert.equal(h.events.find(x=>x[0]==='receipt')[1],'scene.director.revision');
});

test('title and duration Write never rewrites an unselected Prompt',async()=>{
  const h=harness();
  await h.apply(h.saved,'s1',null,{title:'Revised title',durationSeconds:12});
  const payload=h.events.find(x=>x[0]==='save')[1];
  assert.deepEqual(JSON.parse(JSON.stringify(payload.changes)),{
    title:'Revised title',durationSeconds:12});
  assert.equal(h.saved.scenes.s1.prompt,'Original prompt');
  assert.deepEqual(h.versions,[
    ['project:p1:scene:s1:field:title','Opening','Revised title'],
    ['project:p1:scene:s1:field:durationSeconds',8,12]
  ]);
});

test('a write to an unavailable target fails without saving another Scene',async()=>{
  const h=harness();
  await assert.rejects(()=>h.apply(h.saved,'missing','Unrelated content',{}),
    /selected Scene no longer exists/);
  assert.equal(h.events.length,0);
});

test('a save failure has no false success receipt or History checkpoint',async()=>{
  const h=harness();
  const failureScope=vm.createContext({
    api:async()=>{throw new Error('Backend rejected save');},
    window:{
      flushStudioDirectorStoryEdits:async()=>{},
      refreshStudioDirectorStoryIfOpen:async()=>{throw Error('not reached')},
      studioDirectorBridge:{recordApplied:async()=>{throw Error('not reached')}},
      webcapTextareaRevisions:{recordFieldChange:()=>{throw Error('not reached')}}
    },Promise,Object,String,Error,JSON
  });
  const apply=vm.runInContext('({'+method(
    '    applyScenePrompt: function (story, sceneId, prompt, extraChanges) {',
    '    setStatus:status,')+'})',failureScope).applyScenePrompt;
  await assert.rejects(()=>apply(h.saved,'s1','New prompt',{}),/Backend rejected save/);
});
