const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../tool/js/studio_director_workbench.js'), 'utf8');
function part(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
}
const fieldsCode = part('  function recommendedWriteFields(operation) {', '  function refreshRead() {');
const labelCode = part('  function writeActionLabel() {', '  function renderReadiness(list) {');

test('Scene default uses a valid recommendation or the current Scene, while manual choices prevail', () => {
  const host={children:[],querySelectorAll(){return this.children.flatMap(n=>n.children).filter(n=>n.checked);},
    replaceChildren(){this.children=[];},appendChild(n){this.children.push(n);}};
  const scope=vm.createContext({writeStory:null,recommendations:{sceneId:'scene:a'},
    activeTarget:()=>({sceneId:'a'}),el:()=>host,showWriteContext(){},updateScope(){},
    document:{createElement:()=>({children:[],append(...nodes){this.children.push(...nodes);}}),createTextNode:text=>({text})}});
  vm.runInContext(part('  function renderWriteStory(story) {','  function recommendedWriteFields(operation) {'),scope);
  const story={sceneOrder:['a','b'],scenes:{a:{title:'A'},b:{title:'B'}}};
  scope.renderWriteStory(story);
  assert.deepEqual(host.querySelectorAll().map(n=>n.value),['a']);
  host.children[0].children[0].checked=false;
  host.children[1].children[0].checked=true;
  scope.recommendations.sceneId='a';
  scope.renderWriteStory(story);
  assert.deepEqual(host.querySelectorAll().map(n=>n.value),['b']);
  host.replaceChildren();
  scope.recommendations.sceneId='b';
  scope.renderWriteStory(story);
  assert.deepEqual(host.querySelectorAll().map(n=>n.value),['b']);
});

test('suggestions name creative units regardless of advisory field hints', () => {
  const scope = vm.createContext({readinessStale:false,
    projectFields:['title','concept','style','invariants'],sceneFields:['title','summary','prompt'],
    labels:{summary:'Intent',prompt:'H3 Prompt',title:'Title',style:'Visual / atmosphere',invariants:'Invariants'},
    recommendations:{writeHint:'scenes',writeFields:['summary'],sceneId:'scene-a'}});
  vm.runInContext(fieldsCode + labelCode,scope);
  for (const hint of ['scenes','scene-edit','scenes-batch']) {
    scope.recommendations.writeHint = hint;
    assert.equal(scope.writeActionLabel(),'Revise Scene');
  }
  scope.recommendations.writeFields=['prompt'];
  assert.equal(scope.writeActionLabel(),'Revise Scene');
  scope.recommendations={writeHint:'project',writeFields:['concept'],sceneId:''};
  assert.equal(scope.writeActionLabel(),'Revise Project Overview');
  vm.runInContext(part('  function captureActionLabel(capture) {','  function writeActionLabel() {'),scope);
  assert.equal(scope.captureActionLabel({field:'summary'}),'Review Scene');
  assert.equal(scope.captureActionLabel({field:'style'}),'Review Project Overview');
  scope.readinessStale=true;
  assert.deepEqual(Array.from(scope.recommendedWriteFields('project')),[]);
});

for (const hidden of [true,false]) test('suggestion prepares Review after destination setup, panel hidden='+hidden, async () => {
  const mode={}, operation={options:[{value:'scene-write'}]}, calls=[];
  const scope=vm.createContext({recommendations:{writeHint:'scenes',sceneId:'scene-a'},writeOperationChosen:false,
    el:id=>({'studio-dw-write-operation':operation,'studio-dw-scene-mode':mode,
      'studio-dw-write-panel':{classList:{contains:()=>hidden}}})[id],
    toggle:async which=>{assert.equal(which,'write');calls.push('setup');return true;},
    refreshWrite:async()=>{calls.push('setup');return true;},
    writePrepare:(...args)=>{assert.equal(args.length,0);calls.push('prepare');},
    status:message=>assert.fail(message)});
  vm.runInContext(part('  function openRecommendedWrite() {','  function captureActionLabel(capture) {'),scope);
  await scope.openRecommendedWrite();
  assert.deepEqual(calls,['setup','prepare']);
  assert.equal(mode.value,'revise');
  assert.equal(operation.value,'scene-write');
});

test('failed destination setup reports its failure without starting a proposal', async () => {
  let prepared=false;
  const scope=vm.createContext({recommendations:{writeHint:'project'},
    el:id=>id==='studio-dw-write-operation' ? {options:[{value:'project'}]} : {classList:{contains:()=>false}},
    refreshWrite:async()=>false,writePrepare:()=>{prepared=true;},status:message=>assert.fail(message)});
  vm.runInContext(part('  function openRecommendedWrite() {','  function captureActionLabel(capture) {'),scope);
  await scope.openRecommendedWrite();
  assert.equal(prepared,false);
});

test('Scene Review includes the whole unit and selects all actual changes, irrespective of field hints', () => {
  const created=[];
  const node=()=>({dataset:{},children:[],setAttribute(){},appendChild(child){this.children.push(child);},
    append(...children){this.children.push(...children);},addEventListener(event,fn){this[event]=fn;}});
  const scope=vm.createContext({proposedBatch:{fields:['summary'],scenes:[{sceneId:'scene-a',
    before:{position:1,title:'Lamp',summary:'Old intent',prompt:'Old prompt'},
    draft:{sceneId:'scene-a',summary:'New intent',prompt:'Extra prompt proposal'}}]},
    document:{createElement:()=>{const n=node();created.push(n);return n;}},
    el:id=>id==='studio-dw-batch-editors' ? {...node(),replaceChildren(){}} : {showModal(){}},
    labels:{title:'Title',summary:'Intent',prompt:'H3 Prompt'},status(){}});
  vm.runInContext(part('  function renderBatchReview() {','  function applyBatchScenes() {'),scope);
  scope.renderBatchReview();
  const checks=created.filter(n=>n.type==='checkbox');
  assert.deepEqual(checks.map(n=>n.checked),[false,true,true]);
  const editors=created.filter(n=>n.dataset.field);
  assert.deepEqual(editors.map(n=>n.value),['Lamp','New intent','Extra prompt proposal']);
  const unchanged=created.find(n=>n.children.some(child=>child.textContent==='Other parts'));
  assert.equal(unchanged.children.length,2,'unchanged Title remains available within the Scene');
  editors[0].input();
  assert.equal(checks[0].checked,true,'author can deliberately revise an unchanged part');
});

test('completed Scene capture enters the same unit Review without generating another proposal', async () => {
  let complete;
  const finished=new Promise(resolve=>{complete=resolve;});
  const saved={id:'p1',sceneOrder:['a'],scenes:{a:{title:'Lamp',summary:'Old intent',prompt:'Saved H3'}}};
  const scope=vm.createContext({proposedBatch:null,
    el:id=>id==='studio-dw-write-project' ? {value:'p1'} : {},
    window:{studioDirectorBridge:{canReview:()=>true},flushStudioDirectorStoryEdits:async()=>{}},
    loadStory:async()=>saved,renderBatchReview:()=>complete(),status:message=>assert.fail(message)});
  vm.runInContext(part('  function reviewCreativeCapture(capture) {','  function openWriteForCapture() {'),scope);
  scope.reviewCreativeCapture({field:'summary',content:'New intent',sceneId:'a'});
  await finished;
  const entry=scope.proposedBatch.scenes[0];
  assert.equal(entry.sceneId,'a');
  assert.equal(entry.draft.summary,'New intent');
  assert.equal(entry.before.title,'Lamp');
  assert.equal(entry.before.prompt,'Saved H3');
});

test('unit Apply saves aligned changed parts atomically and leaves the unchanged Title outside the write', async () => {
  let payload,complete;
  const finished=new Promise(resolve=>{complete=resolve;});
  const values={summary:'New intent',prompt:'Aligned H3'};
  const section={dataset:{sceneId:'a'},
    querySelectorAll:()=>Object.keys(values).map(field=>({dataset:{selectField:field}})),
    querySelector:selector=>({value:values[selector.includes('summary')?'summary':'prompt']})};
  const scope=vm.createContext({proposedBatch:{storyId:'p1',scenes:[{
    sceneId:'a',before:{title:'Same title',summary:'Old intent',prompt:'Old H3'}}]},
    el:id=>id==='studio-dw-batch-editors' ? {querySelectorAll:()=>[section]} : {close(){}},
    api:async(url,options)=>{payload=JSON.parse(options.body);return {story:{id:'p1'},savedFieldsByScene:{}};},
    window:{flushStudioDirectorStoryEdits:async()=>{},studioDirectorBridge:{recordApplied:async()=>complete()}},
    status:message=>{if(message.startsWith('Multi-Scene Apply:')) assert.fail(message);}});
  vm.runInContext(part('  function applyBatchScenes() {','  function applyScene() {'),scope);
  scope.applyBatchScenes();
  await finished;
  assert.deepEqual(payload,{storyId:'p1',revisions:[{sceneId:'a',
    expected:{summary:'Old intent',prompt:'Old H3'},changes:{summary:'New intent',prompt:'Aligned H3'}}]});
});
