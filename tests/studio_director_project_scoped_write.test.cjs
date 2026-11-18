'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('tool/js/director_chat.js','utf8');
function section(a,b) {
  const start=source.indexOf(a),end=source.indexOf(b,start+a.length);
  assert.ok(start>=0&&end>start,'missing '+a);
  return source.slice(start,end);
}
const helpers=section('  function studioProjectFieldsFromModel(authored) {','  function prepareStudioProject(options) {');
const {usable,delta}=new Function(helpers+
  'return {usable:studioProjectFieldsFromModel,delta:studioProjectInvariantChanges};')();

test('partial Create accepts complete usable fields, does not invent missing values and keeps invalid pieces visible',()=>{
  const material=usable({concept:'',style:'A rich atmosphere',invariants:[
    {kind:'visual',title:'Coat',text:'Deep red wool'},
    {kind:'wrong',title:'Bad',text:'Ignored'},
    {kind:'character',title:'Mara'}
  ],unrecognized:'raw output remains in I/O'});
  assert.deepEqual(material.values,{concept:'',style:'A rich atmosphere',invariants:[
    {kind:'visual',title:'Coat',text:'Deep red wool'}
  ]});
  assert.equal(material.skipped.length,3); // Two invalid Invariants and one unsupported Project field.
  assert.equal(usable({style:'Useful atmosphere'}).values.style,'Useful atmosphere');
  assert.deepEqual(usable({invariants:[{kind:'sound',title:'',text:'A low hum'}]}).values.invariants,
    [{kind:'sound',title:'',text:'A low hum'}], 'Project creation preserves unnamed useful material');
  assert.deepEqual(delta([], [{kind:'sound',title:'',text:'A low hum'}]).operations,[],
    'Individual Revise cannot target an unnamed Invariant without inventing an identity');
});

test('Invariant delta preserves saved entries omitted from response, with exact add/update ops only',()=>{
  const existing=[{kind:'character',title:'Mara',text:'Copper hairpin'},
    {kind:'location',title:'Town',text:'Foggy river'}];
  const operations=delta(existing,[{kind:'character',title:'Mara',text:'Silver hairpin'},
    {kind:'sound',title:'Rain',text:'Distant patter'}]);
  assert.deepEqual(operations.operations,[
    {op:'update',before:existing[0],after:{kind:'character',title:'Mara',text:'Silver hairpin'}},
    {op:'add',after:{kind:'sound',title:'Rain',text:'Distant patter'}}
  ]);
  assert.equal(operations.operations.some(op=>op.op==='remove'),false);
  assert.deepEqual(delta(existing,[]).operations,[]);
  assert.deepEqual(delta(existing,[existing[0]]).operations,[]);
});

function makeRevisionHarness(raw,requestedFields) {
  const baseline={id:'project-A',title:'Original title',concept:'Original concept',
    style:'Warm amber',invariants:[{kind:'character',title:'Mara',text:'Copper hairpin'},
      {kind:'location',title:'Town',text:'Foggy river'}]};
  const saves=[],posts=[],statuses=[];
  const state={pending:false,activeMode:'storyboard',sessionReady:true,modelId:'model',
    modeMessages:{storyboard:[]},studioWorkingDraft:{projects:{},scenes:{}}};
  let current=baseline;
  async function requestJson(url,opts) {
    if(url.startsWith('/fs/storyboard?story='))return {story:baseline};
    if(url==='/fs/director/chat'){
      posts.push(JSON.parse(opts.body));
      return {job:{jobId:'test'}};
    }
    if(url==='/fs/studio/director/brief'){
      const body=JSON.parse(opts.body);
      saves.push(body);
      const updated={...baseline,...body.changes};
      if(body.changes.invariantOps) updated.invariants=baseline.invariants.concat(
        body.changes.invariantOps.filter(op=>op.op==='add').map(op=>op.after));
      current=updated;
      return {story:updated,revisionId:'rev-1'};
    }
    throw Error('unexpected '+url);
  }
  const window={flushStudioDirectorStoryEdits:async()=>{},
    studioDirectorWorkbench:{showSentWriteContext(){}},
    studioDirectorBridge:{recordApplied:async()=>{}},
    refreshStudioDirectorStoryIfOpen:async()=>{},reportConsoleError:()=>{}};
  const body=section('  function prepareStudioBrief(options) {','  function applyStudioBrief() {');
  const prepare=new Function('state','window','requestJson','studioAttachedStoryId',
    'studioDirectorRequestMessages','startProgress','syncControls','studioActionStatus',
    'trackTransientLlmJob','waitForJob','parseStudioBriefDraft','studioProjectFieldsFromModel',
    'studioProjectInvariantChanges','recordStudioOperation','finishProgress',body+
    'return prepareStudioBrief;')(state,window,requestJson,()=> 'project-A',
      async messages=>messages,()=>{},()=>{},(message)=>statuses.push(message),
      ()=>{},async()=>({result:{text:JSON.stringify(raw)}}),JSON.parse,usable,delta,()=>{},()=>{});
  return {prepare,requestedFields,saves,posts,statuses,baseline,get current(){return current;}};
}
test('Project Revise with only style requested never saves model-authored title, Concept or Invariants',async()=>{
  const h=makeRevisionHarness({title:'Unrequested replacement',concept:'Unrequested premise',
    style:'Blue daylight',invariants:[]},['style']);
  await h.prepare({storyId:'project-A',instruction:'Only change light',requestedFields:h.requestedFields});
  assert.equal(h.posts.length,1);
  assert.deepEqual(h.posts[0].requiredFields,['style']);
  assert.equal(h.saves.length,1);
  assert.deepEqual(h.saves[0].changes,{style:'Blue daylight'});
  assert.deepEqual(h.saves[0].expected,{style:'Warm amber'});
  assert.deepEqual(h.current.invariants,h.baseline.invariants);
  assert.ok(h.statuses.some(s=>s.includes('Ignored:')));
});
test('Invariant-only Revise uses add/update ops without full-list replacement or omission deletion',async()=>{
  const h=makeRevisionHarness({invariants:[
    {kind:'character',title:'Mara',text:'Silver hairpin'},
    {kind:'sound',title:'Rain',text:'Soft patter'}
  ],style:'Unexpected style'},['invariants']);
  await h.prepare({storyId:'project-A',instruction:'Revise Mara and add rain',
    requestedFields:h.requestedFields});
  assert.equal(h.saves.length,1);
  assert.deepEqual(h.saves[0].expected,{});
  assert.equal('invariants' in h.saves[0].changes,false);
  assert.deepEqual(h.saves[0].changes.invariantOps.map(op=>op.op),['update','add']);
  assert.equal(h.saves[0].changes.invariantOps.some(op=>op.op==='remove'),false);
  assert.equal(h.current.style,'Warm amber');
});
test('Missing or unusable scoped response does not write or change unrelated material',async()=>{
  const h=makeRevisionHarness({title:'Off scope',style:42},['style']);
  await h.prepare({storyId:'project-A',instruction:'Style only',requestedFields:h.requestedFields});
  assert.equal(h.saves.length,0);
  assert.ok(h.statuses.some(s=>s.includes('no usable changes')));
});

test('partially returned explicitly requested Project fields save usable values and report omissions',async()=>{
  const h=makeRevisionHarness({style:'Cool twilight'},['style','concept']);
  await h.prepare({storyId:'project-A',instruction:'Revise atmosphere and Concept',requestedFields:h.requestedFields});
  assert.equal(h.saves.length,1);
  assert.deepEqual(h.saves[0].changes,{style:'Cool twilight'});
  assert.deepEqual(h.saves[0].expected,{style:'Warm amber'});
  assert.ok(h.statuses.some(s=>s.includes('concept (not returned)')));
});
