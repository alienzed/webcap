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

test('suggestions name supported fields from current and historical Scene hints', () => {
  const scope = vm.createContext({readinessStale:false,
    projectFields:['title','concept','style','invariants'],sceneFields:['title','summary','prompt'],
    labels:{summary:'Intent',prompt:'H3 Prompt',title:'Title',style:'Visual / atmosphere',invariants:'Invariants'},
    recommendations:{writeHint:'scenes',writeFields:['summary'],sceneId:'scene-a'}});
  vm.runInContext(fieldsCode + labelCode,scope);
  for (const hint of ['scenes','scene-edit','scenes-batch']) {
    scope.recommendations.writeHint = hint;
    assert.equal(scope.writeActionLabel(),'Write Scene Intent');
  }
  scope.recommendations.writeFields=['prompt'];
  assert.equal(scope.writeActionLabel(),'Write Scene H3 Prompt');
  scope.recommendations={writeHint:'project',writeFields:['concept'],sceneId:''};
  assert.equal(scope.writeActionLabel(),'Write Project Concept');
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
    recommendedWriteFields:op=>{assert.equal(op,'scene-write');return ['summary'];},
    writePrepare:fields=>{assert.deepEqual(Array.from(fields),['summary']);calls.push('prepare');},
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

test('guided Review includes additional proposed fields visibly but selects only requested changes', () => {
  const created=[];
  const node=()=>({dataset:{},children:[],appendChild(child){this.children.push(child);},
    append(...children){this.children.push(...children);},addEventListener(event,fn){this[event]=fn;}});
  const scope=vm.createContext({proposedBatch:{fields:['summary'],scenes:[{sceneId:'scene-a',
    before:{position:1,title:'Lamp',summary:'Old intent',prompt:'Old prompt'},
    draft:{sceneId:'scene-a',summary:'New intent',prompt:'Extra prompt proposal'}}]},
    document:{createElement:()=>{const n=node();created.push(n);return n;}},
    el:id=>id==='studio-dw-batch-editors' ? {...node(),replaceChildren(){}} : {showModal(){}},
    labels:{summary:'Intent',prompt:'H3 Prompt'},status(){}});
  vm.runInContext(part('  function renderBatchReview() {','  function applyBatchScenes() {'),scope);
  scope.renderBatchReview();
  const checks=created.filter(n=>n.type==='checkbox');
  assert.deepEqual(checks.map(n=>n.checked),[true,false]);
  const editors=created.filter(n=>n.dataset.field);
  assert.deepEqual(editors.map(n=>n.value),['New intent','Extra prompt proposal']);
  editors[1].input();
  assert.equal(checks[1].checked,true,'author can deliberately include or edit another field');
});
