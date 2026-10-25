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

test('Required validation failures remain genuine technical failures',()=>{
  const r=evaluate({director_scene_plan_2048:failed('Invalid JSON'),language_synthesis:passed,language_challenge:passed});
  assert.equal(r.state,'Failed');
  assert.match(r.labels[1],/Invalid JSON/);
});
test('Deep stress-only failures yield Limited instead of Failed',()=>{
  const r=evaluate({director_scene_plan_2048:passed,language_synthesis:passed,language_challenge:passed,
    director_scene_plan_16384:failed('Token budget exhausted')});
  assert.equal(r.state,'Limited');
  assert.match(r.labels[1],/16384/);
  assert.match(r.labels[1],/Token budget exhausted/);
});
test('Valid but count-short scene output has an explicit limitation',()=>{
  const r=evaluate({director_scene_plan_2048:{
    counts:{completed:1},scenePlanAssessment:{countMatched:false,actualScenes:5,requestedScenes:8,validScenes:5,detailedScenes:5}
  },language_synthesis:passed,language_challenge:passed});
  assert.equal(r.state,'Limited');
  assert.match(r.labels[1],/5\/8 scenes/);
});
test('Missing and interrupted required probes are Not established, not Failed',()=>{
  const r=evaluate({director_scene_plan_2048:passed,language_synthesis:{counts:{interrupted:1}},
    director_scene_plan_8192:failed('Long-form timeout')});
  assert.equal(r.state,'Not established');
  assert.match(r.labels[1],/language_synthesis/);
});
test('Vision-only models are not limited by unrelated historic Storyboard evidence',()=>{
  const r=evaluate({vision_open:passed, director_scene_plan_8192:failed('Long-form truncation')},
    {role:'vision'});
  assert.equal(r.state,'Passed');
});
test('Historical v2 scene-count-only failure is not proven invalid JSON',()=>{
  const r=evaluate({director_scene_plan_2048:{counts:{failed:1},
    error:'Storyboard structured-output validation failed: Wrong number of Storyboard Scenes.',
    _runProtocol:'webcap-model-assessment-structured-v2'},
    language_synthesis:passed,language_challenge:passed});
  assert.equal(r.state,'Not established');
  assert.match(r.labels[1],/legacy scene-count mismatch/);
});
test('A valid required set and no known limitations reports Passed',()=>{
  const r=evaluate({director_scene_plan_2048:passed,language_synthesis:passed,language_challenge:passed});
  assert.equal(r.state,'Passed');
  assert.equal(r.reason,null);
});
test('Set vocabulary requires BOTH synthesis and challenge',()=>{
  const r=evaluate({director_scene_plan_2048:passed,set_vocabulary_synthesis:passed},
    {setVocabulary:true});
  assert.equal(r.state,'Not established');
  assert.match(r.labels[1],/set_vocabulary_challenge/);
});
test('Combined Director and Vision role requires Vision as well',()=>{
  const r=evaluate({director_scene_plan_2048:passed,language_synthesis:passed,language_challenge:passed,
    vision_open:passed,vision_group_aware:failed('Image decode failed')},
    {role:'both',groupAware:true});
  assert.equal(r.state,'Failed');
  assert.match(r.labels[1],/Image decode failed/);
});
test('LLM quality-review operation errors are labeled Judge error, not model quality failure',()=>{
  const a=source.indexOf('function diagnosticsAssessmentReviewLabel(');
  const b=source.indexOf('function diagnosticsAssessmentJudge(',a);
  assert.ok(a>=0&&b>a);
  vm.runInContext(source.slice(a,b),ctx);
  assert.equal(ctx.diagnosticsAssessmentReviewLabel({status:'failed',error:'Exceeded maxTokens'}),'Judge error');
  assert.equal(ctx.diagnosticsAssessmentReviewLabel({status:'running'}),'Judging…');
  assert.match(source,/qualityCell\.textContent = qualityReview\.status === 'failed' \? 'Judge error'/);
  assert.match(source,/diagnosticsAssessmentShowReason\(qualityCell, qualityReview\.error, qualityReview\.error\)/);
});
