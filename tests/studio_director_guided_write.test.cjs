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
    sceneSelectionManual:false,sceneSelectionProject:'',recommendationProject:'p1',
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
  assert.deepEqual(checked(),[],'an unresolved recommendation must not silently target Scene 1');
  scope.readinessStale=true;
  scope.recommendations.sceneNumber=2;
  scope.renderWriteStory(story);
  assert.deepEqual(checked(),['a'],'stale recommendations are ignored');
  scope.readinessStale=false;
  scope.recommendations.sceneId='b';
  scope.recommendations.sceneNumber=1;
  scope.renderWriteStory(story);
  assert.deepEqual(checked(),[],'contradictory saved ID and Scene number must not select anything');
  scope.recommendations.sceneNumber=2;
  scope.renderWriteStory(story);
  assert.deepEqual(checked(),['b'],'matching ID and number identify the same saved Scene');
  scope.recommendations.sceneId='scene:b';
  scope.renderWriteStory(story);
  assert.deepEqual(checked(),['b'],'a Read identifier prefix resolves to the exact saved Scene');
  scope.recommendations.sceneId='scene:b:prompt';
  scope.renderWriteStory(story);
  assert.deepEqual(checked(),['b'],'a complete Read field path resolves to the same saved Scene');
  scope.recommendations.sceneNumber=1;
  scope.recommendations.sceneId='';
  scope.recommendationProject='other-project';
  scope.activeTarget=()=>({storyId:'other-project',sceneId:''});
  scope.renderWriteStory(story);
  assert.deepEqual(checked(),[],'a number from another Project must not be applied');
  scope.recommendationProject='p1';
  scope.activeTarget=()=>({storyId:'p1',sceneId:'a'});
  scope.renderWriteStory(story);
  assert.deepEqual(checked(),['a']);
  scope.renderWriteStory({id:'p2',sceneOrder:['x'],scenes:{x:{title:'X'}}});
  assert.deepEqual(checked(),[],'changing Project does not inherit the previous Scene selection');
});

test('suggestions name creative units regardless of advisory field hints', () => {
  const scope = vm.createContext({readinessStale:false,
    projectFields:['title','concept','style','invariants'],sceneFields:['title','prompt'],
    labels:{prompt:'H3 Prompt',title:'Title',style:'Visual / atmosphere',invariants:'Invariants'},
    recommendations:{writeHint:'scenes',writeFields:['prompt'],sceneId:'scene-a'}});
  vm.runInContext(fieldsCode + labelCode,scope);
  for (const hint of ['scenes','scene-edit','scenes-batch']) {
    scope.recommendations.writeHint = hint;
    assert.equal(scope.writeActionLabel(),'Draft Scene revisions');
  }
  scope.recommendations.writeFields=['prompt'];
  assert.equal(scope.writeActionLabel(),'Draft Scene revisions');
  scope.recommendations={writeHint:'scenes',writeFields:[],sceneId:'',sceneNumber:1};
  assert.equal(scope.writeActionLabel(),'Draft Scene 1');
  scope.recommendations={writeHint:'project',writeFields:['concept'],sceneId:''};
  assert.equal(scope.writeActionLabel(),'Revise Project Overview');
  scope.recommendations={writeHint:'scenes',writeFields:['title','prompt'],sceneId:''};
  assert.equal(scope.writeActionLabel(),'Draft Scenes');
  vm.runInContext(part('  function captureActionLabel(capture) {','  function writeActionLabel() {'),scope);
  assert.equal(scope.captureActionLabel({field:'prompt'}),'Review Scene');
  assert.equal(scope.captureActionLabel({field:'style'}),'Review Project Overview');
  scope.readinessStale=true;
  assert.deepEqual(Array.from(scope.recommendedWriteFields('project')),[]);
});

test('only one contextual action is presented, with completed capture taking priority', () => {
  const node=()=>({children:[],dataset:{},replaceChildren(){this.children=[];},appendChild(n){this.children.push(n);}});
  const actions=node(), assessment=node();
  const scope=vm.createContext({readinessStale:false,
    projectFields:['title','concept','style','invariants'],sceneFields:['title','prompt'],
    el:id=>id==='studio-dw-suggestions'?actions:id==='studio-dw-suggestion-heading'?{classList:{toggle(){}}}:assessment,
    document:{createElement:node},reviewCreativeCapture(){},openRecommendedWrite(){},
    window:{studioDirectorBridge:{workingStoryId:()=> 'p1',placeSuggestedAction(node){assert.equal(node,actions);}}},
    creativeCapture:{field:'prompt',content:'Complete Prompt',sceneId:'a'},preparedSceneWrite:null,preparedNewSceneWrite:null,
    recommendations:{readHints:[],writeHint:'scenes',writeFields:['prompt'],sceneId:'a'}});
  vm.runInContext(fieldsCode + part('  function captureActionLabel(capture) {','  window.studioDirectorWorkbench = {'),scope);
  const kinds=()=>{scope.renderReadiness([]);return actions.children.map(n=>n.dataset.suggestionKind);};
  assert.deepEqual(kinds(),['capture'],'Prompt capture is the one focused next step');
  scope.recommendations.writeFields=['prompt'];
  assert.deepEqual(kinds(),['capture'],'complete single-field capture avoids redundant generation');
  scope.recommendations.sceneId='b';
  assert.deepEqual(kinds(),['capture'],'a different Scene operation remains available through Write');
  scope.recommendations={readHints:[],writeHint:'project',writeFields:['concept','style'],sceneId:''};
  scope.creativeCapture={field:'concept',content:'Complete Concept',sceneId:''};
  assert.deepEqual(kinds(),['capture'],'Concept capture is the next step; other fields remain in Write');
  scope.recommendations.writeFields=['concept'];
  assert.deepEqual(kinds(),['capture']);
  scope.recommendations.writeFields=[];
  assert.deepEqual(kinds(),['capture'],'even unspecified unit scope must not create competing suggestions');
  scope.creativeCapture={field:'scene',title:'New Scene',content:'Full H3 Prompt',sceneId:''};
  scope.recommendations={readHints:[],writeHint:'scenes',writeFields:['title','prompt'],sceneId:''};
  assert.deepEqual(kinds(),['capture'],'new Scene capture remains the next step');
  scope.recommendations.writeFields=['title','prompt'];
  assert.deepEqual(kinds(),['capture']);
  scope.creativeCapture = null;
  assert.deepEqual(kinds(),['write'],'Write suggestion remains accessible when there is no capture');
  scope.recommendations.readHints=['project.concept'];
  assert.deepEqual(kinds(),['read'],'requested saved context is supplied before drafting');
  scope.creativeCapture={field:'prompt',content:'Complete prompt',sceneId:'a'};
  assert.deepEqual(kinds(),['capture'],'completed material can be reviewed directly');
  scope.readinessStale = true;
  assert.deepEqual(kinds(),[],'outdated recommendations disappear');
});


test('selected Scene list uses one bounded call per Scene, preserving successes after failures', async () => {
  const ids=['a','b','c'],calls=[],statuses=[];
  const scope=vm.createContext({
    readinessStale:false,recommendations:{writeHint:'scenes',writeInstruction:'Keep the lamp unlit.',writeFields:['prompt']},
    recommendedWriteFields:()=>['prompt'],
    el:id=>id==='studio-dw-batch-scenes'?{querySelectorAll:()=>ids.map(value=>({value}))}:{disabled:false},
    status:(...args)=>statuses.push(args),window:{flushStudioDirectorStoryEdits:async()=>{},studioDirectorBridge:{
      messages:()=>[{role:'user',content:'Agreed early: retain the red scarf.'}],selectWriteProject:()=>{},
      writeSelectedScene:async launch=>{
        calls.push(launch);
        if(launch.sceneId==='b') throw new Error('Invalid Scene-specific model output');
        if(launch.sceneId==='c') return null;
      }
    }},
    loadStory:async()=>({id:'p1',title:'Beacon',sceneOrder:ids,
      scenes:{a:{title:'First'},b:{title:'Second'},c:{title:'Third'}}}),storyName:x=>x.title
  });
  vm.runInContext(part('  function prepareBatchScenes(storyId) {','  function renderBatchReview() {'),scope);
  const outcome=await scope.prepareBatchScenes('p1');
  assert.deepEqual(calls.map(x=>x.sceneId),ids);
  assert.equal(calls[0].instruction,'Keep the lamp unlit.');
  assert.deepEqual(Array.from(calls[0].fields),['prompt']);
  assert.equal(outcome.saved.length,1);
  assert.equal(outcome.failed.length,1);
  assert.equal(outcome.unchanged.length,1);
  assert.equal(outcome.notAttempted.length,0);
  const final = statuses.at(-1);
  assert.equal(final[2],true,'successful per-Scene outcomes must remain visible');
  assert.match(final[0],/Saved 1: Scene 1 · First/);
  assert.match(final[0],/Unchanged 1: Scene 3 · Third/);
  assert.match(final[0],/Failed 1: Scene 2 · Second/);
});

test('selected Scene list stops on a shared runtime failure',async()=>{
  const ids=['a','b'],calls=[];
  const scope=vm.createContext({
    readinessStale:false,recommendations:{writeHint:'scenes',writeInstruction:'Quiet the ending.',writeFields:[]},
    recommendedWriteFields:()=>[],
    el:id=>id==='studio-dw-batch-scenes'?{querySelectorAll:()=>ids.map(value=>({value}))}:{disabled:false},
    status:()=>{},window:{flushStudioDirectorStoryEdits:async()=>{},studioDirectorBridge:{
      messages:()=>[],selectWriteProject:()=>{},
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

for (const hidden of [true,false]) for (const target of [
  {sceneId:'scene-a',sceneNumber:0}, {sceneId:'',sceneNumber:1}, {sceneId:'',sceneNumber:0}
]) test('suggestion prepares the correct Scene operation, panel hidden='+hidden+', target='+JSON.stringify(target), async () => {
  const mode={}, operation={options:[{value:'scene-write'}]}, calls=[];
  const scope=vm.createContext({recommendations:{writeHint:'scenes',...target},writeOperationChosen:false,
    el:id=>({'studio-dw-write-operation':operation,'studio-dw-scene-mode':mode,
      'studio-dw-write-panel':{classList:{contains:()=>hidden}}})[id],
    toggle:async which=>{assert.equal(which,'write');calls.push('setup');return true;},
    refreshWrite:async()=>{calls.push('setup');return true;},
    writePrepare:(...args)=>{assert.equal(args.length,0);calls.push('prepare');},
    status:message=>assert.fail(message)});
  vm.runInContext(part('  function openRecommendedWrite() {','  function captureActionLabel(capture) {'),scope);
  await scope.openRecommendedWrite();
  assert.deepEqual(calls,['setup','prepare']);
  assert.equal(mode.value,target.sceneId || target.sceneNumber ? 'revise' : 'create');
  assert.equal(operation.value,'scene-write');
});

test('opening Write defaults to revising a numbered Scene and preserves deliberate mode choices',async()=>{
  const mode={},operation={},project={value:'p1'};
  const scope=vm.createContext({recommendations:{writeHint:'scenes',sceneId:'',sceneNumber:1},
    writeOperationChosen:false,projects:[{id:'p1'}],
    el:id=>({'studio-dw-write-operation':operation,'studio-dw-scene-mode':mode,'studio-dw-write-project':project})[id],
    refreshProjects:async()=>{},loadStory:async()=>({id:'p1'}),renderWriteStory(){},setOperation(){},
    status:message=>assert.fail(message)});
  vm.runInContext(part('  function refreshWrite() {','  function toggle(which) {'),scope);
  await scope.refreshWrite();
  assert.equal(operation.value,'scene-write');
  assert.equal(mode.value,'revise');
  scope.writeOperationChosen=true;mode.value='create';
  await scope.refreshWrite();
  assert.equal(mode.value,'create','explicit Add Scenes choice survives refresh');
});

test('failed destination setup reports its failure without starting a proposal', async () => {
  let prepared=false;
  const scope=vm.createContext({recommendations:{writeHint:'project'},
    el:id=>id==='studio-dw-write-operation' ? {options:[{value:'project'}]} : {classList:{contains:()=>false}},
    refreshWrite:async()=>false,writePrepare:()=>{prepared=true;},status:message=>assert.fail(message),
    window:{studioDirectorBridge:{workingStoryId:()=>''}},activeTarget:()=>({storyId:''})});
  vm.runInContext(part('  function openRecommendedWrite() {','  function captureActionLabel(capture) {'),scope);
  await scope.openRecommendedWrite();
  assert.equal(prepared,false);
});

test('Scene Review includes the whole unit and selects all actual changes, irrespective of field hints', () => {
  const created=[];
  const node=()=>({dataset:{},children:[],setAttribute(){},appendChild(child){this.children.push(child);},
    append(...children){this.children.push(...children);},addEventListener(event,fn){this[event]=fn;}});
  const scope=vm.createContext({proposedBatch:{fields:['prompt'],scenes:[{sceneId:'scene-a',
    before:{position:1,title:'Lamp',prompt:'Old prompt'},
    draft:{sceneId:'scene-a',prompt:'Extra prompt proposal'}}]},
    document:{createElement:()=>{const n=node();created.push(n);return n;}},
    el:id=>id==='studio-dw-batch-editors' ? {...node(),replaceChildren(){}} : {showModal(){}},
    labels:{title:'Title',prompt:'H3 Prompt'},status(){},
    window:{studioDirectorRenderDiff:()=>{}}});
  vm.runInContext(part('  function renderBatchReview() {','  function applyBatchScenes() {'),scope);
  scope.renderBatchReview();
  const checks=created.filter(n=>n.type==='checkbox');
  assert.deepEqual(checks.map(n=>n.checked),[false,true]);
  const editors=created.filter(n=>n.dataset.field);
  assert.deepEqual(editors.map(n=>n.value),['Lamp','Extra prompt proposal']);
  const unchanged=created.find(n=>n.children.some(child=>child.textContent==='Other parts'));
  assert.equal(unchanged.children.length,2,'unchanged Title remains available within the Scene');
  editors[0].input();
  assert.equal(checks[0].checked,true,'author can deliberately revise an unchanged part');
});

test('automatic new-Scene Write reuses a fresh capture and preserves explicit drafting', () => {
  const calls=[];
  const capture={field:'scene',sceneId:'',title:'Sunlit crossing',content:'The subject crosses the sunlit square.'};
  const select={value:'scene-write'};
  const mode={value:'create'};
  const project={value:'p1'};
  const scope=vm.createContext({
    readinessStale:false,writeOperationChosen:false,creativeCapture:capture,
    recommendations:{writeHint:'scenes',writeFields:['title','prompt'],sceneId:''},
    projects:[{id:'p1',title:'Project One'}],
    el:id=>({
      'studio-dw-write-operation':select,
      'studio-dw-scene-mode':mode,
      'studio-dw-write-project':project
    })[id],
    window:{studioDirectorBridge:{
      isReady:()=>true,
      prepareWrite:(...args)=>calls.push(['draft',...args])
    }},
    storyName:()=> 'Project One',
    reviewCreativeCapture:chosen=>calls.push(['review',chosen]),
    prepareBatchScenes:()=>calls.push(['batch']),
    status:message=>{if(message.includes('failed'))assert.fail(message);}
  });
  vm.runInContext(
    part('  function readyNewSceneCapture() {', '  function setOperation() {') +
    part('  function writePrepare(options) {','  function prepareProjectCoherence(storyId) {'),
    scope
  );
  scope.writePrepare();
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'review');
  assert.equal(calls[0][1],capture,'the complete authored content is reused verbatim');

  calls.length=0;
  scope.writeOperationChosen=true;
  scope.writePrepare();
  assert.equal(calls[0][0],'draft','explicit one-or-many drafting still calls Director');

  calls.length=0;
  scope.writeOperationChosen=false;
  scope.readinessStale=true;
  scope.writePrepare();
  assert.equal(calls[0][0],'draft','stale captures cannot be applied');

  calls.length=0;
  scope.readinessStale=false;
  scope.creativeCapture=null;
  scope.writePrepare();
  assert.equal(calls[0][0],'draft','missing captures fall back to drafting');

  calls.length=0;
  scope.creativeCapture=capture;
  mode.value='revise';
  scope.writePrepare();
  assert.equal(calls[0][0],'batch','existing Scene revisions keep their reviewed workflow');
});

test('completed new Scene with Title and H3 Prompt reviews directly without another Director request', async () => {
  const capture={field:'scene',sceneId:'',title:'Sunlit crossing',content:'integrated_multimodal_description: [Shot 1] Crossing the bright square.'};
  let complete;
  const finished=new Promise(resolve=>{complete=resolve;});
  const scope=vm.createContext({captureProjectId:'',
    el:id=>id==='studio-dw-write-project' ? {value:'p1'} : {},
    window:{studioDirectorBridge:{
      canReview:()=>true,
      reviewSceneCapture:(item,id)=>{
        assert.equal(id,'p1');
        assert.equal(item,capture);
        complete();
        return Promise.resolve();
      },
      makeProposal:()=>assert.fail('No second LLM request is needed')
    }},
    status:msg=>assert.fail('Unexpected status: '+msg)
  });
  vm.runInContext(part('  function reviewCreativeCapture(capture) {','  function openWriteForCapture() {'),scope);
  scope.reviewCreativeCapture(capture);
  await finished;
});

for (const sceneId of ['a','scene:a','scene:a:prompt']) test('completed Scene capture reviews the exact saved Scene without another proposal: '+sceneId, async () => {
  let complete;
  const finished=new Promise(resolve=>{complete=resolve;});
  const saved={id:'p1',sceneOrder:['a'],scenes:{a:{title:'Lamp',summary:'Old intent',prompt:'Saved H3'}}};
  const scope=vm.createContext({proposedBatch:null,captureProjectId:'',
    el:id=>id==='studio-dw-write-project' ? {value:'p1'} : {},
    window:{studioDirectorBridge:{canReview:()=>true},flushStudioDirectorStoryEdits:async()=>{}},
    loadStory:async()=>saved,renderBatchReview:()=>complete(),status:message=>assert.fail(message)});
  vm.runInContext(part('  function reviewCreativeCapture(capture) {','  function openWriteForCapture() {'),scope);
  scope.reviewCreativeCapture({field:'prompt',content:'New complete H3 prompt',sceneId});
  await finished;
  const entry=scope.proposedBatch.scenes[0];
  assert.equal(entry.sceneId,'a');
  assert.equal(entry.draft.prompt,'New complete H3 prompt');
  assert.equal(entry.before.title,'Lamp');
  assert.equal(entry.before.prompt,'Saved H3');
});

test('the inline Project Read targets the current destination and reuses explicit Read',async()=>{
  const select={value:'old-source'};
  let rendered,selected=0,sent=0;
  const scope=vm.createContext({
    window:{studioDirectorBridge:{workingStoryId:()=> 'current-project',messages:()=>[
      {role:'user',content:'Write Scene 1 with the agreed blink.'},
      {role:'assistant',content:'Read the Project first.'}]}},
    activeTarget:()=>({storyId:'other-project'}),el:()=>select,
    refreshProjects:async()=>{},loadStory:async id=>{assert.equal(id,'current-project');return{id};},
    renderReadStory:story=>{rendered=story.id;},selectEntireReadProject:()=>selected++,
    readSend:instruction=>{assert.equal(instruction,'Write Scene 1 with the agreed blink.');sent++;},status:message=>assert.fail(message)
  });
  vm.runInContext(part('  function readRecommendedProject() {','  function writeActionLabel() {'),scope);
  assert.equal(sent,0,'navigation alone sends no saved material');
  await scope.readRecommendedProject();
  assert.equal(select.value,'current-project');
  assert.equal(rendered,'current-project');
  assert.equal(selected,1);assert.equal(sent,1);
});

test('unit Apply saves aligned changed parts atomically and leaves the unchanged Title outside the write', async () => {
  let payload,complete;
  const finished=new Promise(resolve=>{complete=resolve;});
  const values={prompt:'Aligned H3'};
  const section={dataset:{sceneId:'a'},
    querySelectorAll:()=>Object.keys(values).map(field=>({dataset:{selectField:field}})),
    querySelector:selector=>({value:values.prompt})};
  const scope=vm.createContext({proposedBatch:{storyId:'p1',scenes:[{
    sceneId:'a',before:{title:'Same title',prompt:'Old H3'}}]},
    el:id=>id==='studio-dw-batch-editors' ? {querySelectorAll:()=>[section]} : {close(){}},
    api:async(url,options)=>{payload=JSON.parse(options.body);return {story:{id:'p1'},savedFieldsByScene:{}};},
    window:{flushStudioDirectorStoryEdits:async()=>{},studioDirectorBridge:{recordApplied:async()=>complete()}},
    status:message=>{if(message.startsWith('Multi-Scene Apply:')) assert.fail(message);}});
  vm.runInContext(part('  function applyBatchScenes() {','  function applyScene() {'),scope);
  scope.applyBatchScenes();
  await finished;
  assert.deepEqual(payload,{storyId:'p1',revisions:[{sceneId:'a',
    expected:{prompt:'Old H3'},changes:{prompt:'Aligned H3'}}]});
});

test('mismatched Scene targets require confirmation before any saved mutation', () => {
  let called=0, confirmed=0;
  const section={dataset:{sceneId:'a'},
    querySelectorAll:()=>[{dataset:{selectField:'prompt'}}],
    querySelector:()=>({value:'New prompt'})};
  const scope=vm.createContext({proposedBatch:{storyId:'p1',
    targetWarning:'Director suggested Scene 5, but Write targets Scene 1.',
    scenes:[{sceneId:'a',before:{title:'A',summary:'Old intent',prompt:'Old prompt'}}]},
    el:id=>id==='studio-dw-batch-editors' ? {querySelectorAll:()=>[section]} : {},
    window:{confirm:()=>{confirmed++;return false;},
      flushStudioDirectorStoryEdits:async()=>{}},
    api:async()=>{called++;return {};},status:()=>{}});
  vm.runInContext(part('  function applyBatchScenes() {','  function applyScene() {'),scope);
  scope.applyBatchScenes();
  assert.equal(confirmed,1);
  assert.equal(called,0,'declining a conflicting target must not call the mutation API');
});


const projectSource = fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
function projectPart(start,end) {
  const a=projectSource.indexOf(start),b=projectSource.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'Missing Project path: '+start);
  return projectSource.slice(a,b);
}

test('guided Project revision preserves existing target and selected overview fields',async()=>{
  const operation={value:'',options:[{value:'project'}]},project={value:'stale'};
  const calls=[],scope=vm.createContext({
    recommendations:{writeHint:'project',writeInstruction:'Make the fog subtler.',writeFields:['style']},
    writeOperationChosen:false,sceneSelectionManual:false,activeTarget:()=>({storyId:'other'}),
    window:{studioDirectorBridge:{workingStoryId:()=> 'chosen-project'}},
    el:id=>id==='studio-dw-write-operation'?operation:
      id==='studio-dw-write-project'?project:{classList:{contains:()=>false}},
    refreshWrite:async()=>true,writePrepare:options=>calls.push(options),
    status:msg=>assert.fail(msg)
  });
  vm.runInContext(part('  function openRecommendedWrite() {','  function captureActionLabel(capture) {'),scope);
  await scope.openRecommendedWrite();
  assert.equal(project.value,'chosen-project');
  assert.equal(operation.value,'project');
  assert.equal(calls[0].guided,true);
  const metadata=[],prep=vm.createContext({
    recommendations:{writeHint:'project',writeInstruction:'Make the fog subtler.',writeFields:['style']},
    readinessStale:false,projects:[{id:'chosen-project',title:'Beacon'}],
    el:id=>id==='studio-dw-write-operation'?operation:project,
    window:{studioDirectorBridge:{isReady:()=>true,
      prepareWrite:(...args)=>metadata.push(args)}},
    storyName:x=>x.title,recommendedWriteFields:()=>['style'],status:()=>{}
  });
  vm.runInContext(part('  function writePrepare(options) {','  function prepareProjectCoherence(storyId) {'),prep);
  prep.writePrepare({guided:true});
  assert.equal(metadata[0][1],'chosen-project');
  assert.equal(metadata[0][3].instruction,'Make the fog subtler.');
  assert.deepEqual(Array.from(metadata[0][3].requestedFields),['style']);
});

test('new Project writer accepts complete overview and brief-only initial Scenes',()=>{
  const scope=vm.createContext({});
  vm.runInContext(projectPart('  function parseStudioProjectDraft(raw) {',
    '  function addStudioProjectInvariant(item, destination, original) {'),scope);
  const accepted=scope.parseStudioProjectDraft(JSON.stringify({
    title:'Beacon',concept:'A watchful keeper',style:'Coastal dusk',rationale:'Agreed direction',
    invariants:[{kind:'location',title:'Tower',text:'Old stone stairs'}],
    initialScenes:[{title:'Closing the Logbook',brief:'Mara closes the logbook at an oak desk',
      durationSeconds:12}]
  }));
  assert.equal(accepted.initialScenes[0].durationSeconds,12);
  assert.equal(accepted.invariants[0].title,'Tower');
  assert.throws(()=>scope.parseStudioProjectDraft(JSON.stringify({
    title:'Beacon',concept:'A watchful keeper',style:'',rationale:'',
    invariants:[],initialScenes:[]})),/complete Concept and Visual/);
  assert.throws(()=>scope.parseStudioProjectDraft(JSON.stringify({
    title:'Beacon',concept:'A watchful keeper',style:'Coastal dusk',rationale:'',
    invariants:[],initialScenes:[{title:'A',brief:'Scene brief',durationSeconds:16}]
  })),/invalid Project/);
});

test('initial Scene briefs produce bounded independent saves; a failed item retains successes',async()=>{
  const calls=[],saves=[],errors=[],briefs=[
    {title:'One',brief:'First action',durationSeconds:8},
    {title:'Two',brief:'Second action',durationSeconds:10},
    {title:'Three',brief:'Third action',durationSeconds:12}
  ];
  const initial={id:'p1',title:'Beacon',concept:'Keep the light alive',style:'Cold twilight',
    invariants:[],sceneOrder:[],scenes:{}};
  let current=initial;
  const scope=vm.createContext({
    state:{modelId:'director-model',jobId:''},
    studioDirectorRequestMessages:async messages=>{
      calls.push(JSON.parse(messages[0].content));
      return messages;
    },
    requestJson:async (url,options)=>{
      if(url==='/fs/director/chat')return {job:{jobId:'job-'+calls.length}};
      if(url==='/fs/studio/director/scenes-draft') {
        const payload=JSON.parse(options.body),id='created-'+(saves.length+1);
        assert.deepEqual(Array.from(payload.expectedSceneOrder),current.sceneOrder);
        assert.equal(payload.scenes.length,1);
        assert.equal(payload.scenes[0].durationSeconds,calls.at(-1).durationSeconds,
          'approved Project review duration wins over malformed model metadata');
        saves.push(payload.scenes[0].title);
        current={...current,sceneOrder:[...current.sceneOrder,id]};
        return {story:current,scenes:[{...payload.scenes[0],id}]};
      }
      assert.fail('Unexpected route '+url);
    },
    trackTransientLlmJob:()=>{},
    waitForJob:async()=>{
      const item=calls.at(-1);
      return {result:{text:JSON.stringify({
        scenes:item.requestedTitle==='Two'?[]:[{title:item.requestedTitle,
          prompt:'Complete full H3 Prompt for '+item.instruction,
          durationSeconds:item.requestedTitle==='Three'?'twelve':item.durationSeconds}],rationale:''})}};
    },
    parseStudioScenesDraft:raw=>{
      const value=JSON.parse(raw);
      if(value.scenes.length!==1)throw new Error('Incomplete initial Scene');
      return value;
    },
    recordStudioOperation:()=>{},
    window:{studioDirectorWorkbench:{showSentWriteContext:()=>{}},
      reportConsoleError:(label,error)=>errors.push(label+': '+error.message),
      studioDirectorBridge:{recordApplied:async()=>{}}}
  });
  vm.runInContext(projectPart('  // The reviewed Project is saved before any Scene authoring.',
    '  function applyStudioProject() {'),scope);
  const outcome=await scope.writeInitialProjectScenes(initial,briefs);
  assert.deepEqual(calls.map(x=>x.instruction),['First action','Second action','Third action']);
  assert.deepEqual(saves,['One','Three']);
  assert.equal(outcome.saved.length,2);
  assert.equal(outcome.failed.length,1);
  assert.equal(outcome.notAttempted.length,0);
  assert.ok(errors.some(x=>x.includes('Two')));
});

test('new Project Apply persists only reviewed Project fields before Scene authoring',async()=>{
  const story={id:'project-created',title:'Beacon',concept:'Keeper',style:'Night',invariants:[],
    scenes:{},sceneOrder:[]};
  const fields={
    'studio-project-title':{value:story.title},'studio-project-concept':{value:story.concept},
    'studio-project-style':{value:story.style},
    'studio-project-invariants':{querySelectorAll:()=>[]},
    'studio-project-include-scene':{checked:true},
    'studio-project-scene-title':{value:'First Scene'},
    'studio-project-scene-prompt':{value:'Keep the beacon lit.'},
    'studio-project-scene-duration':{value:'8'},
    'studio-project-extra-scenes':{querySelectorAll:()=>[]},
    'studio-project-continue':{checked:false},
    'studio-project-review':{close:()=>{}},
    'studio-project-error':{textContent:''}
  };
  let projectSaved=false,sceneAuthoring=false,finish;
  const done=new Promise(resolve=>finish=resolve);
  const scope=vm.createContext({
    state:{studioProjectProposal:{title:story.title},pending:false,studioStoryAccess:null},
    el:id=>fields[id]||{},
    syncControls:()=>{},recordStudioOperation:()=>{},studioActionStatus:()=>{},
    window:{
      studioDirectorBridge:{recordApplied:async()=>{}},
      refreshStudioDirectorStoryIfOpen:async()=>finish(),
      reportConsoleError:(label,e)=>assert.fail(label+': '+e.message)
    },
    requestJson:async (url,options)=>{
      assert.equal(url,'/fs/studio/director/project-create');
      const payload=JSON.parse(options.body);
      assert.equal(payload.proposal.firstScenes,undefined);
      assert.equal(payload.proposal.initialScenes,undefined);
      assert.equal(payload.proposal.concept,story.concept);
      projectSaved=true;
      return {story};
    },
    writeInitialProjectScenes:async (_story,briefs)=>{
      assert.equal(projectSaved,true);
      assert.equal(_story.id,story.id);
      assert.equal(briefs[0].brief,'Keep the beacon lit.');
      assert.equal(briefs[0].durationSeconds,8);
      sceneAuthoring=true;
      return {saved:['scene-one'],failed:[],notAttempted:[],reportingErrors:[]};
    }
  });
  vm.runInContext(projectPart('  function applyStudioProject() {',
    '  function parseStudioBriefDraft(raw) {'),scope);
  scope.applyStudioProject();
  await done;
  assert.equal(sceneAuthoring,true);
});
