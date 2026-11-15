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
    el:id=>id==='studio-dw-batch-scenes'?{querySelectorAll:()=>ids.map(value=>({value}))}:{disabled:false},
    status:(...args)=>statuses.push(args),window:{flushStudioDirectorStoryEdits:async()=>{},studioDirectorBridge:{
      messages:()=>[{role:'user',content:'Keep the lamp unlit.'}],selectWriteProject:()=>{},
      writeSelectedScene:async launch=>{
        calls.push(launch);
        if(launch.sceneId==='b') throw new Error('Invalid Scene-specific model output');
        if(launch.sceneId==='c') return null;
        if(launch.sceneId==='d') return {review:true};
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
  assert.equal(outcome.saved.length,1);
  assert.equal(outcome.failed.length,1);
  assert.equal(outcome.unchanged.length,1);
  assert.equal(outcome.review.length,1);
  assert.equal(outcome.notAttempted.length,0);
  const final = statuses.at(-1);
  assert.equal(final[2],true,'successful per-Scene outcomes must remain visible');
  assert.match(final[0],/Saved 1: Scene 1 · First/);
  assert.match(final[0],/Unchanged 1: Scene 3 · Third/);
  assert.match(final[0],/Failed 1: Scene 2 · Second/);
  assert.match(final[0],/Needs review 1: Scene 4 · Fourth/);
});

test('selected Scene list stops on a shared runtime failure',async()=>{
  const ids=['a','b'],calls=[];
  const scope=vm.createContext({
    readinessStale:false,recommendations:{writeHint:'scenes',writeInstruction:'Quiet the ending.',writeFields:[]},
    recommendedWriteFields:()=>[],manualSceneInstruction:()=> 'Quiet the ending.',
    el:id=>id==='studio-dw-batch-scenes'?{querySelectorAll:()=>ids.map(value=>({value}))}:{disabled:false},
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
  const incomplete=scope.parseStudioProjectDraft(JSON.stringify({
    title:'Beacon',concept:'A watchful keeper',style:'',
    invariants:[],initialScenes:[{title:'A',brief:'Scene brief',durationSeconds:16}]
  }));
  assert.equal(incomplete.style,'','review can fill in missing creative context');
  assert.equal(incomplete.rationale,'','optional explanation is not a rejection reason');
  assert.equal(incomplete.initialScenes[0].durationSeconds,16,'review exposes the unsupported duration for correction');
  assert.equal(scope.parseStudioProjectDraft(JSON.stringify({
    concept:'Rainy bookshop',style:'Warm light',invariants:[{kind:'unknown',title:'Green door',text:'Keep'}]
  })).invariants[0].kind,'custom');
  assert.throws(()=>scope.parseStudioProjectDraft('{}'),/no usable Project material/);
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
      if(url==='/fs/director/chat'){
        assert.equal(JSON.parse(options.body).operation,'studio_scene_field_draft',
          'initial Project Scenes reuse the same single-Scene model contract');
        return {job:{jobId:'job-'+calls.length}};
      }
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
      return {result:{text:JSON.stringify(item.requestedTitle==='Two'
        ? {title:'Two'} : {title:item.requestedTitle,
          prompt:'Complete full H3 Prompt for '+item.instruction,
          durationSeconds:item.requestedTitle==='Three'?'twelve':item.durationSeconds})}};
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
    state:{studioProjectProposal:{title:story.title},pending:false,studioStoryAccess:null,
      studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{},sourceRequest:''}},
    el:id=>fields[id]||{},
    syncControls:()=>{},recordStudioOperation:()=>{},studioActionStatus:()=>{},scheduleSessionSave:()=>{},
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
