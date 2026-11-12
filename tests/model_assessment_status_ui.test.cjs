'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('tool/js/diagnostics.js','utf8');
const start=source.indexOf('function diagnosticsAssessmentCounts(');
const end=source.indexOf('function diagnosticsAssessmentInspectResponse(',start);
assert.ok(start>=0&&end>start,'Qualification code must exist');
const ctx=vm.createContext({
  document:{createElement(){return {className:'',textContent:'',title:''};}},
  modelLabAttemptLabel:kind=>kind
});
vm.runInContext(source.slice(start,end),ctx);
function evaluate(tests,options={}) {
  const host={children:[],replaceChildren(){this.children=[];},appendChild(node){this.children.push(node);}};
  const row={dataset:{assessmentRole:options.role||'director'},assessmentSort:{},
    assessmentHasSetVocabulary:!!options.setVocabulary,assessmentNeedsGroupAware:!!options.groupAware,
    querySelector:sel=>sel==='[data-assessment-qualification]'?host:null};
  ctx.diagnosticsAssessmentCounts(row,tests);
  return {state:row.dataset.assessmentSanity,labels:host.children.map(x=>x.textContent),
    sorts:row.assessmentSort,reason:host.children[1]||null};
}
const passed={counts:{completed:1}};
const failed=(error)=>({counts:{failed:1},error});

test('Failed probes do not erase independently demonstrated capabilities',()=>{
  const r=evaluate({director_scene_plan_2048:failed('Invalid JSON'),language_synthesis:passed,language_challenge:passed});
  assert.equal(r.state,'Demonstrated');
  assert.deepEqual(r.labels,['Schema Assist · Vocabulary challenge']);
});
test('Deep stress-only failures do not erase the verified Storyboard tier',()=>{
  const r=evaluate({director_scene_plan_2048:passed,language_synthesis:passed,language_challenge:passed,
    director_scene_plan_16384:failed('Token budget exhausted')});
  assert.equal(r.state,'Demonstrated');
  assert.match(r.labels[1],/2K budget verified/);
});
test('Completed count-short scene output remains a demonstrated request budget',()=>{
  const r=evaluate({director_scene_plan_2048:{
    counts:{completed:1},scenePlanAssessment:{countMatched:false,actualScenes:5,requestedScenes:8,validScenes:5,detailedScenes:5}
  },language_synthesis:passed,language_challenge:passed});
  assert.equal(r.state,'Demonstrated');
  assert.match(r.labels[1],/2K budget verified/);
});
test('Missing and interrupted probes do not claim additional capabilities',()=>{
  const r=evaluate({director_scene_plan_2048:passed,language_synthesis:{counts:{interrupted:1}},
    director_scene_plan_8192:failed('Long-form timeout')});
  assert.equal(r.state,'Demonstrated');
  assert.equal(r.labels[0],'Storyboard');
  assert.match(r.labels[1],/2K budget verified/);
});
test('Vision-only models are not limited by unrelated historic Storyboard evidence',()=>{
  const r=evaluate({vision_open:passed, director_scene_plan_8192:failed('Long-form truncation')},
    {role:'vision'});
  assert.equal(r.state,'Demonstrated');
  assert.deepEqual(r.labels,['Sight']);
});
test('Historical v2 scene-count-only failure is not proven invalid JSON',()=>{
  const r=evaluate({director_scene_plan_2048:{counts:{failed:1},
    error:'Storyboard structured-output validation failed: Wrong number of Storyboard Scenes.',
    _runProtocol:'webcap-model-assessment-structured-v2'},
    language_synthesis:passed,language_challenge:passed});
  assert.equal(r.state,'Demonstrated');
  assert.deepEqual(r.labels,['Schema Assist · Vocabulary challenge']);
});
test('Completed probes name demonstrated capabilities and their verified budget',()=>{
  const r=evaluate({director_scene_plan_2048:passed,language_synthesis:passed,language_challenge:passed});
  assert.equal(r.state,'Demonstrated');
  assert.equal(r.labels[0],'Storyboard · Schema Assist · Vocabulary challenge');
  assert.match(r.labels[1],/2K budget verified/);
});
test('Set vocabulary synthesis does not claim an untested challenge capability',()=>{
  const r=evaluate({director_scene_plan_2048:passed,set_vocabulary_synthesis:passed},
    {setVocabulary:true});
  assert.equal(r.state,'Demonstrated');
  assert.equal(r.labels[0],'Storyboard · Schema Assist');
});
test('Combined roles name successful Sight independently of failed group-aware Sight',()=>{
  const r=evaluate({director_scene_plan_2048:passed,language_synthesis:passed,language_challenge:passed,
    vision_open:passed,vision_group_aware:failed('Image decode failed')},
    {role:'both',groupAware:true});
  assert.equal(r.state,'Demonstrated');
  assert.equal(r.labels[0],'Storyboard · Schema Assist · Vocabulary challenge · Sight');
});
test('Observed failures alone are assessed, and absent observations remain untested',()=>{
  const observed=evaluate({vision_open:failed('Image decode failed')},{role:'vision'});
  assert.equal(observed.state,'Assessed');
  assert.deepEqual(observed.labels,['Assessed']);
  const empty=evaluate({},{role:'vision'});
  assert.equal(empty.state,'Untested');
  assert.deepEqual(empty.labels,['Not assessed']);
});
test('LLM quality-review operation errors remain unmeasured',()=>{
  const a=source.indexOf('function diagnosticsAssessmentReviewLabel(');
  const b=source.indexOf('function diagnosticsAssessmentJudge(',a);
  assert.ok(a>=0&&b>a);
  vm.runInContext(source.slice(a,b),ctx);
  assert.equal(ctx.diagnosticsAssessmentReviewLabel({status:'failed',error:'Exceeded maxTokens'}),'Not measured');
  assert.equal(ctx.diagnosticsAssessmentReviewLabel({status:'running'}),'Judging…');
});
