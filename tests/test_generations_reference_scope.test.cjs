const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../tool/js/test_generations.js'), 'utf8');
const start = source.indexOf('  function openReferenceDialog() {');
const end = source.indexOf('  async function runReferenceComparison() {', start);
assert.ok(start !== -1 && end !== -1);
function plan(attributes, references) {
  const controls = {
    'test-generations-evaluator':{value:'rvn'},
    'test-generations-reference-dialog':{open:false,showModal() {this.open=true}},
    'test-generations-reference-title':{textContent:''},
    'test-generations-reference-status':{textContent:''},
    'test-generations-reference-run':{disabled:false},
    'test-generations-reference-pair':{innerHTML:'',dataset:{}},
  };
  const sandbox = {
    currentStatus:{session:'session-1',results:[{mediaFile:'generated.png'}],
      wildcardEvaluationGroups:attributes},
    referenceCompare:{},
    launchFolder:'set',
    el:id=>controls[id],
    owningSetFolder: x=>x,
    resultMediaFile:x=>x.mediaFile,
    window:{testReferencesSelections:()=>references},
    showReferencePair:()=>{},
    drawReferenceResults:()=>{},
  };
  vm.runInNewContext(source.slice(start,end)+'\nthis.openReferenceDialog = openReferenceDialog;',sandbox);
  sandbox.openReferenceDialog();
  return Array.from(sandbox.referenceCompare.plan, row=>({
    group:row.choice.group, attribute:row.attribute.id
  }));
}
test('identical text in separate scoped groups yields two distinct correct matches',()=>{
  const attributes=[
    {id:'G1',annotationGroup:'BT Back',options:['simple','dual ring']},
    {id:'G2',annotationGroup:'BB Back',options:['simple','micro']},
  ];
  const selected=[
    {group:'BT Back',term:'simple',media:'top.png'},
    {group:'BB Back',term:'simple',media:'bottom.png'},
  ];
  assert.deepEqual(plan(attributes,selected),[
    {group:'BT Back',attribute:'G1'},
    {group:'BB Back',attribute:'G2'},
  ]);
});
test('unbound custom dimensions remain useful where unambiguous',()=>{
  const references=[{group:'Custom',term:'red',media:'ref.png'}];
  assert.deepEqual(plan([{id:'G1',options:['red','blue']}],references),[
    {group:'Custom',attribute:'G1'},
  ]);
  assert.deepEqual(plan([
    {id:'G1',options:['red','blue']},{id:'G2',options:['red','green']}
  ],references),[]);
});
