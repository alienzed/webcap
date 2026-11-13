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

test('Scene-number recommendation resolves to a saved ID; deliberate choices stay selected', () => {
  const host={children:[],querySelectorAll(selector){
    const controls=this.children.flatMap(n=>n.children).filter(n=>n.type==='checkbox');
    return selector === 'input:checked' ? controls.filter(n=>n.checked) : controls;
  }, replaceChildren(){this.children=[];},appendChild(n){this.children.push(n);}};
  const scope=vm.createContext({writeStory:null,readinessStale:false,
    sceneSelectionManual:false,sceneSelectionProject:'',
    recommendations:{writeHint:'scenes',sceneId:'',sceneNumber:2},
    activeTarget:()=>({storyId:'p1',sceneId:'a'}),
    window:{studioDirectorBridge:{workingStoryId:()=> 'p1'}},
    el:()=>host,showWriteContext(){},updateScope(){},
    document:{createElement:()=>({children:[],append(...nodes){this.children.push(...nodes);}}),
      createTextNode:text=>({text})}});
  vm.runInContext(part('  function recommendedSceneId(story) {','  function recommendedWriteFields(operation) {'),scope);
  const story={id:'p1',sceneOrder:['a','b'],scenes:{a:{title:'A'},b:{title:'B'}}};
  const checked=()=>host.querySelectorAll('input:checked').map(n=>n.value);
  scope.renderWriteStory(story);
  assert.deepEqual(checked(),['b'],'Director’s Scene 2 should override incidental Scene 1 focus');
  scope.recommendations.sceneNumber=1;
  scope.renderWriteStory(story);
  assert.deepEqual(checked(),['a'],'a fresh recommendation updates a default, not manual state');
  const inputs=host.querySelectorAll('input');
  inputs[0].checked=false;inputs[1].checked=true;inputs[1].onchange();
  scope.renderWriteStory(story);
  assert.deepEqual(checked(),['b'],'an explicit choice survives refresh');
  host.querySelectorAll('input')[1].checked=false;
  host.querySelectorAll('input')[1].onchange();
  scope.renderWriteStory(story);
  assert.deepEqual(checked(),[],'intentionally clearing the selection must not reselect Scene 1');
  scope.sceneSelectionManual=false;
  scope.recommendations.sceneNumber=5;
  scope.renderWriteStory(story);
  assert.deepEqual(checked(),['a'],'invalid recommendation falls back only to current Scene');
  scope.readinessStale=true;
  scope.recommendations.sceneNumber=2;
  scope.renderWriteStory(story);
  assert.deepEqual(checked(),['a'],'stale recommendations are ignored');
  scope.readinessStale=false;
  scope.recommendations.sceneId='b';
  scope.recommendations.sceneNumber=1;
  scope.renderWriteStory(story);
  assert.deepEqual(checked(),['b'],'an exact saved ID takes priority over a conflicting number');
  scope.recommendations.sceneId='';
  scope.window.studioDirectorBridge.workingStoryId=()=> 'other-project';
  scope.activeTarget=()=>({storyId:'other-project',sceneId:''});
  scope.renderWriteStory(story);
  assert.deepEqual(checked(),[],'a number from another Project must not be applied');
  scope.window.studioDirectorBridge.workingStoryId=()=> 'p1';
  scope.activeTarget=()=>({storyId:'p1',sceneId:'a'});
  scope.renderWriteStory(story);
  assert.deepEqual(checked(),['a']);
  scope.renderWriteStory({id:'p2',sceneOrder:['x'],scenes:{x:{title:'X'}}});
  assert.deepEqual(checked(),[],'changing Project does not inherit the previous Scene selection');
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

test('only one contextual action is presented, with completed capture taking priority', () => {
  const node=()=>({children:[],dataset:{},replaceChildren(){this.children=[];},appendChild(n){this.children.push(n);}});
  const actions=node(), assessment=node();
  const scope=vm.createContext({readinessStale:false,
    projectFields:['title','concept','style','invariants'],sceneFields:['title','summary','prompt'],
    el:id=>id==='studio-dw-suggestions'?actions:id==='studio-dw-suggestion-heading'?{classList:{toggle(){}}}:assessment,
    document:{createElement:node},reviewCreativeCapture(){},openRecommendedWrite(){},
    creativeCapture:{field:'summary',content:'Complete Intent',sceneId:'a'},
    recommendations:{writeHint:'scenes',writeFields:['summary','prompt'],sceneId:'a'}});
  vm.runInContext(fieldsCode + part('  function captureActionLabel(capture) {','  window.studioDirectorWorkbench = {'),scope);
  const kinds=()=>{scope.renderReadiness([]);return actions.children.map(n=>n.dataset.suggestionKind);};
  assert.deepEqual(kinds(),['capture'],'Intent capture is the one focused next step');
  scope.recommendations.writeFields=['summary'];
  assert.deepEqual(kinds(),['capture'],'complete single-field capture avoids redundant generation');
  scope.recommendations.sceneId='b';
  assert.deepEqual(kinds(),['capture'],'a different Scene operation remains available through Write');
  scope.recommendations={writeHint:'project',writeFields:['concept','style'],sceneId:''};
  scope.creativeCapture={field:'concept',content:'Complete Concept',sceneId:''};
  assert.deepEqual(kinds(),['capture'],'Concept capture is the next step; other fields remain in Write');
  scope.recommendations.writeFields=['concept'];
  assert.deepEqual(kinds(),['capture']);
  scope.recommendations.writeFields=[];
  assert.deepEqual(kinds(),['capture'],'even unspecified unit scope must not create competing suggestions');
  scope.creativeCapture={field:'scene',title:'New Scene',content:'Intent',sceneId:''};
  scope.recommendations={writeHint:'scenes',writeFields:['title','summary','prompt'],sceneId:''};
  assert.deepEqual(kinds(),['capture'],'new Scene capture remains the next step');
  scope.recommendations.writeFields=['title','summary'];
  assert.deepEqual(kinds(),['capture']);
  scope.creativeCapture = null;
  assert.deepEqual(kinds(),['write'],'Write suggestion remains accessible when there is no capture');
  scope.readinessStale = true;
  assert.deepEqual(kinds(),[],'outdated recommendations disappear');
});

test('Scene Write receives early decisions and complete long messages from the discussion', async () => {
  const early='Agreed early decision: retain the red scarf.';
  const long='H3 detail '.repeat(400)+' Final decision: keep the lamp unlit.';
  const messages=[{role:'system',content:'Internal message'},null,{role:'user',content:early},
    ...Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',content:'Discussion '+i})),
    {role:'user',content:long}];
  let request,complete;
  const finished=new Promise(resolve=>{complete=resolve;});
  const button={set disabled(value){if(!value) complete();}};
  const scope=vm.createContext({proposedBatch:null,
    el:id=>id==='studio-dw-batch-scenes'?{querySelectorAll:()=>[{value:'a'}]}:button,
    status:message=>{if(message.startsWith('Scene revision draft failed:')) assert.fail(message);},
    window:{flushStudioDirectorStoryEdits:async()=>{},studioDirectorBridge:{selectWriteProject(){},
      messages:()=>messages,makeProposal:async input=>{request=input;return '{}';}}},
    loadStory:async()=>({id:'p1',sceneOrder:['a'],scenes:{a:{title:'Lamp',summary:'Intent',prompt:'H3'}}}),
    storyName:()=> 'Project',parseProposal:JSON.parse,validateSceneRevisionDraft:()=>[],renderBatchReview(){}});
  vm.runInContext(part('  function prepareBatchScenes(storyId) {','  function renderBatchReview() {'),scope);
  scope.prepareBatchScenes('p1');
  await finished;
  const history=JSON.parse(request.split('Creative discussion: ')[1].split('\n')[0]);
  assert.equal(history.length,22);
  assert.equal(history[0].text,early);
  assert.equal(history.at(-1).text,long);
  assert.ok(history.every(message=>['user','assistant'].includes(message.role)));
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
    labels:{title:'Title',summary:'Intent',prompt:'H3 Prompt'},status(){},
    window:{studioDirectorRenderDiff:()=>{}}});
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
