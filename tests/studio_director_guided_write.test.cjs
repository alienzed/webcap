const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../tool/js/studio_director_workbench.js'), 'utf8');
const projectSource = fs.readFileSync(path.join(__dirname, '../tool/js/director_chat.js'), 'utf8');
function projectPart(start, end) {
  const first=projectSource.indexOf(start),last=projectSource.indexOf(end,first+start.length);
  assert.ok(first>=0 && last>first,'Missing Project writer source: '+start);
  return projectSource.slice(first,last);
}
function part(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
}

test('selected Scene list uses one bounded call per Scene, preserving successes after failures', async () => {
  const ids=['a','b','c','d'],calls=[],statuses=[];
  const scope=vm.createContext({
    readinessStale:false,recommendations:{writeHint:'scenes',writeInstruction:'Keep the lamp unlit.',writeFields:['prompt']},
    recommendedWriteFields:()=>['prompt'],manualSceneInstruction:()=> 'Keep the lamp unlit.',
    el:id=>id==='studio-dw-batch-scenes'?{querySelectorAll:()=>ids.map(value=>({value}))}:
      id==='studio-dw-batch-fields'?{querySelectorAll:()=>[{value:'prompt'}]}:{disabled:false},
    status:(...args)=>statuses.push(args),window:{flushStudioDirectorStoryEdits:async()=>{},studioDirectorBridge:{
      messages:()=>[{role:'user',content:'Keep the lamp unlit.'}],selectWriteProject:()=>{},
      writeSelectedScene:async launch=>{
        calls.push(launch);
        if(launch.sceneId==='b') throw new Error('Invalid Scene-specific model output');
        if(launch.sceneId==='c') return null;
        if(launch.sceneId==='d') return {story:{id:'p1'},scene:{id:'d'}};
      }
    }},
    loadStory:async()=>({id:'p1',title:'Beacon',sceneOrder:ids,
      scenes:{a:{title:'First'},b:{title:'Second'},c:{title:'Third'},d:{title:'Fourth'}}}),storyName:x=>x.title
  });
  vm.runInContext(part('  function prepareBatchScenes(storyId) {','  function renderBatchReview() {'),scope);
  const outcome=await scope.prepareBatchScenes('p1');
  assert.deepEqual(calls.map(x=>x.sceneId),ids);
  assert.equal(calls[0].instruction,'Keep the lamp unlit.');
  assert.deepEqual(Array.from(calls[0].fields),['prompt']);
  assert.equal(outcome.saved.length,2);
  assert.equal(outcome.failed.length,1);
  assert.equal(outcome.unchanged.length,1);
  assert.equal(Object.hasOwn(outcome,'review'),false);
  assert.equal(outcome.notAttempted.length,0);
  const final = statuses.at(-1);
  assert.equal(final[2],true,'successful per-Scene outcomes must remain visible');
  assert.match(final[0],/Saved 2: Scene 1 · First, Scene 4 · Fourth/);
  assert.match(final[0],/Unchanged 1: Scene 3 · Third/);
  assert.match(final[0],/Failed 1: Scene 2 · Second/);
  assert.doesNotMatch(final[0],/Needs review/);
});

test('selected Scene list stops on a shared runtime failure',async()=>{
  const ids=['a','b'],calls=[];
  const scope=vm.createContext({
    readinessStale:false,recommendations:{writeHint:'scenes',writeInstruction:'Quiet the ending.',writeFields:[]},
    recommendedWriteFields:()=>[],manualSceneInstruction:()=> 'Quiet the ending.',
    el:id=>id==='studio-dw-batch-scenes'?{querySelectorAll:()=>ids.map(value=>({value}))}:
      id==='studio-dw-batch-fields'?{querySelectorAll:()=>[{value:'prompt'}]}:{disabled:false},
    status:()=>{},window:{flushStudioDirectorStoryEdits:async()=>{},studioDirectorBridge:{
      messages:()=>[{role:'user',content:'Quiet the ending.'}],selectWriteProject:()=>{},
      writeSelectedScene:async launch=>{calls.push(launch.sceneId);throw new Error('Failed to fetch');}
    }},
    loadStory:async()=>({id:'p1',title:'Beacon',sceneOrder:ids,
      scenes:{a:{title:'First'},b:{title:'Second'}}}),storyName:x=>x.title
  });
  vm.runInContext(part('  function prepareBatchScenes(storyId) {','  function renderBatchReview() {'),scope);
  const outcome=await scope.prepareBatchScenes('p1');
  assert.deepEqual(calls,['a']);
  assert.equal(outcome.failed.length,1);
  assert.equal(outcome.notAttempted.length,1);
});

test('Write controls route directly to explicit Scene and Project operations',()=>{
  const body=part('  function writePrepare(options) {','  function prepareProjectCoherence(');
  assert.match(body,/bridge\.writeNewScene\(/);
  assert.match(body,/prepareBatchScenes\(id\)/);
  assert.match(body,/bridge\.prepareWrite\(/);
  assert.doesNotMatch(body,/showSceneReview|renderBatchReview|showStudioProjectReview/);
});

test('Project Create model response persists directly without a Review intermediary',()=>{
  const body=projectPart('  function prepareStudioProject(options) {',
    '  // The reviewed Project is saved before any Scene authoring.');
  assert.match(body,/operation:'studio_project_draft'/);
  assert.match(body,/\/fs\/studio\/director\/project-create/);
  assert.match(body,/recordApplied\('project.create'/);
  assert.doesNotMatch(body,/showStudioProjectReview|initialScenes|parseStudioProjectDraft/);
});

test('Project revision uses original saved fields and a direct field-scoped save',()=>{
  const body=projectPart('  function prepareStudioBrief(options) {',
    '  function applyStudioBrief() {');
  assert.match(body,/\/fs\/studio\/director\/brief/);
  assert.match(body,/expected:expected,changes:changes/);
  assert.match(body,/recordApplied\('brief.apply'/);
  assert.doesNotMatch(body,/showStudioBriefReview/);
});

test('New Scene creation stores actual usable model records rather than reviewing guessed initial Scenes',()=>{
  const body=projectPart('    writeNewScene: function (launch) {',
    '    writeSelectedScene: function (launch) {');
  assert.match(body,/studio_scenes_draft/);
  assert.match(body,/\/fs\/studio\/director\/scenes-draft/);
  assert.match(body,/state\.lastStudioIoRaw/);
  assert.doesNotMatch(body,/writeInitialProjectScenes\(|showStudioScenesReview\(/);
});

test('Batch authoring never launches Review merely because a Scene model result is incomplete',()=>{
  const body=part('  function prepareBatchScenes(storyId) {',
    '  function renderBatchReview() {');
  assert.match(body,/writeSelectedScene\(/);
  assert.match(body,/outcome\.failed\.push/);
  assert.match(body,/outcome\.saved\.push/);
  assert.doesNotMatch(body,/renderBatchReview\(/);
});
