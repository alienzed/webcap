const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const director = fs.readFileSync('tool/js/director_chat.js','utf8');
const workbench = fs.readFileSync('tool/js/studio_director_workbench.js','utf8');
function section(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Missing executable section: '+start);
  return source.slice(a,b);
}

function sceneFixture(raw = '{"prompt":"Mara finishes quietly under a still camera."}') {
  const events=[], errors=[];
  const saved={
    id:'p1',title:'Moon crossing',concept:'A tense departure.',
    style:'Naturalistic moonlight.',invariants:[],updatedAt:'before',
    sceneOrder:['s1'],scenes:{s1:{
      id:'s1',title:'Opening',prompt:'Mara shouts at the rover.',
      durationSeconds:12,summary:'Dormant legacy Intent',
      notes:'Keep this.',takeOrder:['take1']
    }}
  };
  const state={pending:false,jobId:'',lastStudioIoRaw:'',lastStudioIoError:'',
    modeMessages:{storyboard:[]},sessionDirty:{storyboard:false}};
  const window={
    flushStudioDirectorStoryEdits:async()=>{events.push(['flush']);},
    refreshStudioDirectorStoryIfOpen:async()=>{events.push(['refresh']);},
    reportConsoleError:(label,error)=>errors.push(label+': '+error.message),
  };
  let modelResponse=raw;
  const context=vm.createContext({
    state, window, JSON, Object, String, Promise, Number, encodeURIComponent,
    projectFields:['title','concept','style','invariants'],storyName:s=>s.title,
    syncControls(){},renderMessages(){},studioActionStatus:(msg,failed)=>events.push(['status',msg,failed]),
    api:async(url, options)=>{
      assert.equal(url,'/fs/studio/director/scene-fields');
      const body=JSON.parse(options.body);
      events.push(['save',body]);
      const s=saved.scenes[body.sceneId];
      for(const field of Object.keys(body.changes)) {
        const baseline=field==='durationSeconds'?s[field]:String(s[field]||'');
        if(baseline!==body.expected[field]) throw new Error('Scene changed since review.');
      }
      Object.assign(s,body.changes);
      return {story:saved,scene:s};
    },
    requestJson:async url=>{
      assert.equal(url,'/fs/storyboard?story=p1');
      events.push(['fetch']);
      return {story:saved};
    }
  });
  const readPayload=section(workbench,'  function readPayload(story, keys) {',
    '  function updateReadSelection() {');
  const sceneRead=section(workbench,'    sceneRead: function (story, sceneId) {',
    '    applyScenePrompt: function').trim().replace(/,$/,'');
  const applyScenePrompt=section(workbench,'    applyScenePrompt: function (story, sceneId, prompt, extraChanges) {',
    '    setStatus:status,').trim().replace(/,$/,'');
  vm.runInContext(readPayload+
    'window.studioDirectorWorkbench={'+sceneRead+','+applyScenePrompt+'};',context);
  const method=section(director,'    writeSelectedScene: function (launch) {',
    '    makeProposal: function').trim().replace(/,$/,'');
  vm.runInContext('window.studioDirectorBridge={'+method+',isReady:()=>true,'+
    'readinessMessage:()=>"",makeProposal:async(...args)=>{return window.__model(...args);},'+
    'recordApplied:async(kind,story,receipt)=>{return window.__receipt(kind,story,receipt);}};',context);
  window.__model=async(...args)=>{events.push(['model',...args]);return modelResponse;};
  window.__receipt=async(...args)=>{events.push(['receipt',...args]);};
  const launch={projectId:'p1',sceneId:'s1',sceneNumber:1,
    instruction:'Make the ending quieter.',fields:['prompt']};
  return {context,state,window,events,errors,saved,launch,
    changeResponse:raw=>{modelResponse=raw;}};
}

test('one click runs one Scene writer with fresh saved context, saves a full prompt, and uses existing refresh/receipt',async()=>{
  const h=sceneFixture();
  await h.window.studioDirectorBridge.writeSelectedScene(h.launch);
  const model=h.events.filter(row=>row[0]==='model');
  assert.equal(model.length,1);
  assert.equal(model[0][2],'studio_scene_field_draft');
  assert.equal(model[0][3],true);
  const request=JSON.parse(model[0][1]);
  assert.equal(request.sceneId,'s1');
  assert.equal(request.instruction,'Make the ending quieter.');
  assert.equal(request.savedContext.fields.find(row=>row.id==='scene:s1:prompt').value,
    'Mara shouts at the rover.');
  assert.equal(request.savedContext.fields.find(row=>row.id==='scene:s1:durationSeconds').value,12);
  assert.doesNotMatch(JSON.stringify(request),/Dormant legacy Intent/);
  assert.equal(h.events.filter(row=>row[0]==='save').length,1);
  const save=h.events.find(row=>row[0]==='save')[1];
  assert.deepEqual(JSON.parse(JSON.stringify(save)),{
    storyId:'p1',sceneId:'s1',
    expected:{prompt:'Mara shouts at the rover.'},
    changes:{prompt:'Mara finishes quietly under a still camera.'}
  });
  assert.equal(h.saved.scenes.s1.title,'Opening');
  assert.equal(h.saved.scenes.s1.durationSeconds,12);
  assert.equal(h.saved.scenes.s1.summary,'Dormant legacy Intent');
  assert.deepEqual(h.saved.scenes.s1.takeOrder,['take1']);
  assert.ok(h.events.some(row=>row[0]==='refresh'));
  assert.ok(h.events.some(row=>row[0]==='receipt'));
  assert.ok(h.state.modeMessages.storyboard.at(-1).rawResponse.includes('prompt'));
  assert.deepEqual(h.errors,[]);
});

test('second revision reads updated saved prompt, not the earlier conversation baseline',async()=>{
  const h=sceneFixture();
  await h.window.studioDirectorBridge.writeSelectedScene(h.launch);
  h.changeResponse('{"prompt":"The rover stops; the silence hangs."}');
  await h.window.studioDirectorBridge.writeSelectedScene({...h.launch,
    instruction:'Let the silence hang at the end.'});
  const models=h.events.filter(row=>row[0]==='model');
  assert.equal(models.length,2);
  const second=JSON.parse(models[1][1]);
  assert.equal(second.instruction,'Let the silence hang at the end.');
  assert.equal(second.savedContext.fields.find(row=>row.id==='scene:s1:prompt').value,
    'Mara finishes quietly under a still camera.');
  assert.equal(h.saved.scenes.s1.prompt,'The rover stops; the silence hangs.');
});

test('requested title and duration changes are scoped into the same Scene save',async()=>{
  const h=sceneFixture('{"prompt":"The last line is whispered.","title":"Quiet ending","durationSeconds":14}');
  await h.window.studioDirectorBridge.writeSelectedScene({
    ...h.launch,fields:['prompt','title','durationSeconds']
  });
  const save=h.events.find(row=>row[0]==='save')[1];
  assert.deepEqual(JSON.parse(JSON.stringify(save.changes)),
    {prompt:'The last line is whispered.',title:'Quiet ending',durationSeconds:14});
  assert.deepEqual(JSON.parse(JSON.stringify(save.expected)),
    {prompt:'Mara shouts at the rover.',title:'Opening',durationSeconds:12});
  assert.equal(h.saved.scenes.s1.summary,'Dormant legacy Intent');
  assert.equal(h.saved.scenes.s1.durationSeconds,14);
});

test('invalid or incomplete model output cannot initiate any save or report success',async()=>{
  for(const raw of ['{"summary":"A quiet ending"}','{"prompt":"New","title":"Unrequested"}',
    '{"prompt":"New","durationSeconds":17}', '{"prompt":""}', 'not JSON']) {
    const h=sceneFixture(raw);
    await assert.rejects(h.window.studioDirectorBridge.writeSelectedScene(h.launch));
    assert.equal(h.events.filter(row=>row[0]==='save').length,0,raw);
    assert.equal(h.events.filter(row=>row[0]==='receipt').length,0,raw);
    assert.equal(h.saved.scenes.s1.prompt,'Mara shouts at the rover.');
    assert.ok(h.errors.length,raw);
    assert.match(h.state.lastStudioIoRaw, /./);
    assert.ok(!h.events.some(row=>row[0]==='status' && /saved/i.test(row[1])),raw);
  }
});

test('save failure never produces a saved receipt; post-save refresh failure reports saved truth',async()=>{
  const h=sceneFixture();
  h.context.api=async()=>{throw new Error('Save rejected: stale prompt');};
  await assert.rejects(h.window.studioDirectorBridge.writeSelectedScene(h.launch),/Save rejected/);
  assert.equal(h.events.filter(row=>row[0]==='receipt').length,0);
  assert.equal(h.saved.scenes.s1.prompt,'Mara shouts at the rover.');
  assert.ok(h.errors.some(x=>x.includes('Save rejected')));
  const after=sceneFixture();
  after.window.refreshStudioDirectorStoryIfOpen=async()=>{throw new Error('Refresh unavailable');};
  await assert.rejects(after.window.studioDirectorBridge.writeSelectedScene(after.launch),
    error=>error.saved===true);
  assert.equal(after.saved.scenes.s1.prompt,'Mara finishes quietly under a still camera.');
  assert.ok(after.events.some(row=>row[0]==='status' && /Scene saved, but/.test(row[1])));
});

test('structured Scene suggestion binds the actual selected ID and instruction to one direct action',async()=>{
  const actions={children:[],replaceChildren(){this.children=[];},appendChild(n){this.children.push(n);}};
  const assessment={children:[],replaceChildren(){this.children=[];},appendChild(n){this.children.push(n);}};
  const executed=[];
  const createElement=()=>({dataset:{},children:[],appendChild(n){this.children.push(n);},
    set textContent(v){this._text=v;},get textContent(){return this._text;}});
  const scope=vm.createContext({
    window:{studioDirectorBridge:{workingStoryId:()=> 'p1',placeSuggestedAction(){},
      updateReadiness(){},writeSelectedScene:async launch=>executed.push(launch)}},
    document:{createElement},readiness:[],recommendations:{},readinessStale:false,
    creativeCapture:null,preparedSceneWrite:null,
    projectFields:['title','concept','style','invariants'],sceneFields:['title','prompt'],
    recommendationProject:'',status:(msg)=>assert.fail(msg),
    el:id=>id==='studio-dw-suggestions'?actions:
      id==='studio-dw-readiness-list'?assessment:
      id==='studio-dw-suggestion-heading'?{classList:{toggle(){}}}:assessment,
    activeTarget:()=>({storyId:'p1'}),setReadinessFreshness(stale){
      scope.readinessStale=stale;scope.renderReadiness(scope.readiness);
    },
    recommendedWriteFields:()=>[],writeActionLabel:()=> 'Draft Scene revisions',
    captureActionLabel:()=> 'Review Scene',reviewCreativeCapture(){},
    openRecommendedWrite(){},readRecommendedProject(){},
  });
  vm.runInContext(section(workbench,'  function renderReadiness(list) {',
    '  window.studioDirectorWorkbench = {'),scope);
  const begin=workbench.indexOf('    updateReadiness:function (result, restoring, selectedScene) {');
  const end=workbench.indexOf('\n  };\n\n  function bind()',begin);
  assert.ok(begin>0 && end>begin);
  const receiver=vm.runInContext('({'+workbench.slice(begin,end)+'})',scope);
  const proposal={checks:[],readHints:[],writeHint:'scenes',writeInstruction:'Make the ending quieter.',
    writeFields:['prompt'],sceneId:'s1',sceneNumber:1,capture:null};
  assert.equal(receiver.updateReadiness(proposal,false,
    {projectId:'p1',sceneId:'s1',sceneNumber:1}),true);
  assert.equal(actions.children.length,1);
  assert.equal(actions.children[0].textContent,'Revise Scene 1 · Save');
  await actions.children[0].onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(executed)),[{
    projectId:'p1',sceneId:'s1',sceneNumber:1,instruction:'Make the ending quieter.',fields:['prompt']
  }]);
  assert.equal(receiver.updateReadiness({...proposal,sceneId:'invented'},false,
    {projectId:'p1',sceneId:'s1',sceneNumber:1}),true);
  assert.notEqual(actions.children[0].textContent,'Revise Scene 1 · Save',
    'mismatched model ID cannot authorize direct saving');
});
