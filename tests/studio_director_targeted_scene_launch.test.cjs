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
    modeMessages:{storyboard:[]},sessionDirty:{storyboard:false},studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{},sourceRequest:''}};
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
  vm.runInContext(section(director,'  function studioRequestAppliesPreparedMaterial(request) {',
    '  function studioWorkingFieldChanges(source, names) {')+
    section(director,'  function studioRequestedDuration(instruction) {',
    '  window.studioDirectorBridge = {'),context);
  context.scheduleSessionSave=()=>{events.push(['draft-scheduled']);};
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
  assert.equal(h.state.modeMessages.storyboard.length,0,
    'Writer results remain in structured state, not duplicated chat history');
  assert.equal(h.state.studioWorkingDraft.scenes.s1.prompt,
    'Mara finishes quietly under a still camera.');
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

test('writer ignores unrequested optional title and duration fields without changing them',async()=>{
  const h=sceneFixture('{"prompt":"The ending is quieter.","title":"Unexpected title","durationSeconds":14}');
  await h.window.studioDirectorBridge.writeSelectedScene(h.launch);
  assert.equal(h.saved.scenes.s1.prompt,'The ending is quieter.');
  assert.equal(h.saved.scenes.s1.title,'Opening');
  assert.equal(h.saved.scenes.s1.durationSeconds,12);
  assert.deepEqual(Object.keys(h.events.find(row=>row[0]==='save')[1].changes),['prompt']);
});

test('writer saves a complete prompt while ignoring unrequested model metadata and invented IDs',async()=>{
  const h=sceneFixture('{"prompt":"The ending is quiet.","rationale":"Preserves the arc","sceneId":"invented"}');
  await h.window.studioDirectorBridge.writeSelectedScene(h.launch);
  const saved=h.events.find(row=>row[0]==='save')[1];
  assert.equal(saved.storyId,'p1');
  assert.equal(saved.sceneId,'s1');
  assert.deepEqual(Object.keys(saved.changes),['prompt']);
  assert.equal(h.saved.scenes.s1.prompt,'The ending is quiet.');
  assert.ok(h.state.lastStudioIoRaw.includes('invented'),'full response remains inspectable');
  assert.deepEqual(h.errors,[]);
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
  for(const raw of ['{"summary":"A quiet ending"}', '{"prompt":""}', 'not JSON']) {
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


test('a quoted title-only revision saves the title without another model call or prompt overwrite',async()=>{
  const h=sceneFixture();
  const result=await h.window.studioDirectorBridge.writeSelectedScene({
    ...h.launch, instruction:'Rename Scene 1 to "Quiet Ending".',
    authorRequest:'Rename Scene 1 to "Quiet Ending".', fields:['title']
  });
  assert.equal(h.events.filter(row=>row[0]==='model').length,0);
  const save=h.events.find(row=>row[0]==='save')[1];
  assert.deepEqual(JSON.parse(JSON.stringify(save.changes)),{title:'Quiet Ending'});
  assert.deepEqual(JSON.parse(JSON.stringify(save.expected)),{title:'Opening'});
  assert.equal(h.saved.scenes.s1.title,'Quiet Ending');
  assert.equal(h.saved.scenes.s1.prompt,'Mara shouts at the rover.');
  assert.ok(result.story);
});

test('requested duration is taken from author words even when optional model action omits it',async()=>{
  const h=sceneFixture('{"prompt":"Twelve seconds of the keeper closing the book","durationSeconds":6}');
  await h.window.studioDirectorBridge.writeSelectedScene({
    ...h.launch, instruction:'Quieter ending',authorRequest:'Make this Scene 14 seconds, with a quieter ending.',
    fields:['prompt','durationSeconds']
  });
  const saved=h.events.find(row=>row[0]==='save')[1];
  assert.equal(saved.changes.durationSeconds,14);
  assert.equal(h.saved.scenes.s1.durationSeconds,14);
  const request=JSON.parse(h.events.find(row=>row[0]==='model')[1]);
  assert.equal(request.requestedDurationSeconds,14);
  assert.match(request.authorRequest,/14 seconds/);
});

test('unsupported explicit duration preserves a complete Scene draft without saving a mismatch',async()=>{
  const h=sceneFixture('{"prompt":"Twenty-second complete scene","durationSeconds":12}');
  const result=await h.window.studioDirectorBridge.writeSelectedScene({
    ...h.launch,instruction:'Quiet scene',authorRequest:'Make it 20 seconds.',
    fields:['prompt','durationSeconds']
  });
  assert.equal(result.review,true);
  assert.equal(h.events.filter(row=>row[0]==='save').length,0);
  assert.equal(h.saved.scenes.s1.prompt,'Mara shouts at the rover.');
  assert.equal(h.state.studioWorkingDraft.scenes.s1.prompt,'Twenty-second complete scene');
  assert.equal(h.state.modeMessages.storyboard.length,0,
    'complete writer prompts belong to the structured draft, not another chat turn');
  assert.ok(h.events.some(row=>row[0]==='status' && /nothing saved/.test(row[1])));
});

test('already authored structured Scene prompt applies with exact requested duration, no repeat model call',async()=>{
  const h=sceneFixture();
  const request='Make Scene 1 last 14 seconds with a quieter ending.';
  h.state.studioWorkingDraft.scenes.s1={prompt:'Complete quiet H3 replacement'};
  h.state.studioWorkingDraft.sourceRequest=request;
  await h.window.studioDirectorBridge.writeSelectedScene({
    ...h.launch,authorRequest:request,instruction:'Quieter ending',
    fields:['prompt','durationSeconds']
  });
  assert.equal(h.events.filter(row=>row[0]==='model').length,0);
  const save=h.events.find(row=>row[0]==='save')[1];
  assert.equal(save.changes.prompt,'Complete quiet H3 replacement');
  assert.equal(save.changes.durationSeconds,14);
  assert.equal(h.saved.scenes.s1.durationSeconds,14);
});

test('unsupported duration never saves a working prompt with contradictory timing',async()=>{
  const h=sceneFixture();
  const request='Make Scene 1 last 20 seconds.';
  h.state.studioWorkingDraft.scenes.s1={prompt:'Complete twenty-second H3 replacement'};
  h.state.studioWorkingDraft.sourceRequest=request;
  const result=await h.window.studioDirectorBridge.writeSelectedScene({
    ...h.launch,authorRequest:request,instruction:'Longer ending',
    fields:['prompt','durationSeconds']
  });
  assert.equal(result.review,true);
  assert.equal(h.events.filter(row=>row[0]==='model').length,0);
  assert.equal(h.events.filter(row=>row[0]==='save').length,0);
  assert.equal(h.saved.scenes.s1.prompt,'Mara shouts at the rover.');
});
