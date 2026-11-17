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
    studioApprovedRead:{projectId:'p1',keys:['project.title','project.concept','project.style','project.invariants',
      'scene:s1:title','scene:s1:prompt','scene:s1:durationSeconds']},
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
    'window.studioDirectorWorkbench={approvedReadPayload:readPayload,'+sceneRead+','+applyScenePrompt+'};',context);
  vm.runInContext(section(director,'  function studioApprovedReadSources() {',
    '  function studioDirectorChatRequestMessages('),context);
  vm.runInContext(section(director,'  function studioWorkingFieldChanges(source, names) {',
    '  function studioMergeWorkingChanges(changes, target, action, request) {')+
    section(director,'  // Only actual persisted field values clear a retained draft.',
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

function authoredSceneOrigin(h, request, fields=['prompt']) {
  const scene=h.saved.scenes.s1;
  h.state.studioWorkingDraft.draftOrigins={
    projects:{},scenes:{s1:{
      projectId:h.saved.id,request,
      baseline:JSON.stringify({
        title:scene.title,prompt:scene.prompt,durationSeconds:scene.durationSeconds
      }),fields
    }}
  };
}

test('one click runs one Scene writer with fresh saved context, saves a full prompt, and uses existing refresh/receipt',async()=>{
  const h=sceneFixture();
  await h.window.studioDirectorBridge.writeSelectedScene(h.launch);
  const model=h.events.filter(row=>row[0]==='model');
  assert.equal(model.length,1);
  assert.equal(model[0][2],'studio_scene_field_draft');
  assert.equal(model[0][3],true);
  const request=JSON.parse(model[0][1]);
  assert.equal(request.sceneId,undefined,'WebCap, not the model, owns the target ID');
  assert.equal(request.authorDirection,'Make the ending quieter.');
  assert.equal(request.savedScene.fields.find(row=>row.id==='scene:s1:prompt').value,
    'Mara shouts at the rover.');
  assert.equal(request.savedScene.fields.find(row=>row.id==='scene:s1:durationSeconds').value,12);
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
  assert.equal(h.state.studioWorkingDraft.scenes.s1,undefined,
    'authoritative saved fields must not remain as an unsaved working draft');
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
  assert.equal(second.authorDirection,'Let the silence hang at the end.');
  assert.equal(second.savedScene.fields.find(row=>row.id==='scene:s1:prompt').value,
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

test('a missing creative prompt reports failure and retains independently usable requested fields',async()=>{
  const h=sceneFixture('{"title":"Quiet ending","durationSeconds":10}');
  await assert.rejects(h.window.studioDirectorBridge.writeSelectedScene({
    ...h.launch,fields:['prompt','title','durationSeconds']
  }),/requested Scene prompt/);
  assert.equal(h.events.filter(row=>row[0]==='save').length,0);
  assert.equal(h.saved.scenes.s1.prompt,'Mara shouts at the rover.');
  assert.deepEqual(JSON.parse(JSON.stringify(h.state.studioWorkingDraft.scenes.s1)),
    {title:'Quiet ending',durationSeconds:10});
  assert.ok(h.errors.some(message=>message.includes('requested Scene prompt')));
});

test('a model-authored title-only change requests and saves only the title',async()=>{
  const h=sceneFixture('{"title":"Silent departure","prompt":"Unrequested rewrite"}');
  await h.window.studioDirectorBridge.writeSelectedScene({
    ...h.launch,instruction:'Give the Scene a quieter title.',fields:['title']
  });
  const call=h.events.find(row=>row[0]==='model');
  assert.deepEqual(JSON.parse(call[1]).requestedFields,['title']);
  assert.deepEqual(JSON.parse(JSON.stringify(call[5])),['title']);
  assert.equal(h.saved.scenes.s1.title,'Silent departure');
  assert.equal(h.saved.scenes.s1.prompt,'Mara shouts at the rover.');
});

test('an unchanged prompt does not conceal an omitted requested title',async()=>{
  const h=sceneFixture('{"prompt":"Mara shouts at the rover."}');
  await h.window.studioDirectorBridge.writeSelectedScene({...h.launch,fields:['prompt','title']});
  assert.equal(h.events.filter(row=>row[0]==='save').length,0);
  assert.ok(h.events.some(row=>row[0]==='status' && row[2] && /title not supplied/.test(row[1])));
  assert.equal(h.state.studioWorkingDraft.scenes.s1,undefined);
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


test('title-only revision takes the model-authored title without parsing user wording',async()=>{
  const h=sceneFixture('{"title":"Quiet Ending"}');
  const result=await h.window.studioDirectorBridge.writeSelectedScene({
    ...h.launch,instruction:'Rename Scene 1 to "Quiet Ending".',
    authorRequest:'Rename Scene 1 to "Quiet Ending".',fields:['title']
  });
  assert.equal(h.events.filter(row=>row[0]==='model').length,1);
  const call=h.events.find(row=>row[0]==='model');
  assert.deepEqual(JSON.parse(JSON.stringify(call[5])),['title']);
  const save=h.events.find(row=>row[0]==='save')[1];
  assert.deepEqual(JSON.parse(JSON.stringify(save.changes)),{title:'Quiet Ending'});
  assert.deepEqual(JSON.parse(JSON.stringify(save.expected)),{title:'Opening'});
  assert.equal(h.saved.scenes.s1.title,'Quiet Ending');
  assert.equal(h.saved.scenes.s1.prompt,'Mara shouts at the rover.');
  assert.ok(result.story);
});

test('requested Scene duration comes from actual model-authored fields, not parsed prose',async()=>{
  const h=sceneFixture('{"prompt":"Fourteen seconds of the keeper closing the book","durationSeconds":14}');
  await h.window.studioDirectorBridge.writeSelectedScene({
    ...h.launch,instruction:'Quieter ending',authorRequest:'Make this Scene 14 seconds, with a quieter ending.',
    fields:['prompt','durationSeconds']
  });
  const saved=h.events.find(row=>row[0]==='save')[1];
  assert.equal(saved.changes.durationSeconds,14);
  assert.equal(h.saved.scenes.s1.durationSeconds,14);
  const request=JSON.parse(h.events.find(row=>row[0]==='model')[1]);
  assert.equal(request.requestedDurationSeconds,undefined);
  assert.match(request.authorDirection,/14 seconds/);
});

test('unsupported explicit duration preserves a complete Scene draft without saving a mismatch',async()=>{
  const h=sceneFixture('{"prompt":"Twenty-second complete scene","durationSeconds":20}');
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
  h.state.studioWorkingDraft.scenes.s1={prompt:'Complete quiet H3 replacement',durationSeconds:14};
  authoredSceneOrigin(h,request,['prompt','durationSeconds']);
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
  authoredSceneOrigin(h,request,['prompt','durationSeconds']);
  const result=await h.window.studioDirectorBridge.writeSelectedScene({
    ...h.launch,authorRequest:request,instruction:'Longer ending',
    fields:['prompt','durationSeconds']
  });
  assert.equal(result.review,true);
  assert.equal(h.events.filter(row=>row[0]==='model').length,0);
  assert.equal(h.events.filter(row=>row[0]==='save').length,0);
  assert.equal(h.saved.scenes.s1.prompt,'Mara shouts at the rover.');
});

test('manual Scene revision accepts actual optional title and duration changes without wording parsing',async()=>{
  const h=sceneFixture('{"prompt":"Mara whispers near the rover.","title":"Quiet departure","durationSeconds":14}');
  await h.window.studioDirectorBridge.writeSelectedScene({
    ...h.launch,fields:['prompt'],allowCreativeFieldChanges:true,
    instruction:'Make this Scene longer and give it a quieter title.'
  });
  const requested=JSON.parse(h.events.find(row=>row[0]==='model')[1]);
  assert.deepEqual(JSON.parse(JSON.stringify(requested.requestedFields)),['prompt']);
  assert.deepEqual(JSON.parse(JSON.stringify(requested.optionalCreativeFields)),
    ['title','durationSeconds']);
  assert.deepEqual(JSON.parse(JSON.stringify(h.events.find(row=>row[0]==='save')[1].changes)),{
    prompt:'Mara whispers near the rover.',title:'Quiet departure',durationSeconds:14
  });
  assert.equal(h.saved.scenes.s1.durationSeconds,14);
  assert.equal(h.saved.scenes.s1.title,'Quiet departure');
});

test('manual creative revision leaves title and duration untouched when model omits them',async()=>{
  const h=sceneFixture('{"prompt":"A quiet shot of Mara near the rover."}');
  await h.window.studioDirectorBridge.writeSelectedScene({
    ...h.launch,fields:['prompt'],allowCreativeFieldChanges:true,
    instruction:'Make the Scene much quieter.'
  });
  const save=h.events.find(row=>row[0]==='save')[1];
  assert.deepEqual(Object.keys(save.changes),['prompt']);
  assert.equal(h.saved.scenes.s1.title,'Opening');
  assert.equal(h.saved.scenes.s1.durationSeconds,12);
});

test('manual creative revision retains a prompt for review if optional model timing is invalid',async()=>{
  const h=sceneFixture('{"prompt":"Mara waits beneath a midnight sky.","durationSeconds":20}');
  const result=await h.window.studioDirectorBridge.writeSelectedScene({
    ...h.launch,fields:['prompt'],allowCreativeFieldChanges:true,
    instruction:'Make the Scene much longer.'
  });
  assert.equal(result.review,true);
  assert.equal(h.events.filter(row=>row[0]==='save').length,0);
  assert.equal(h.state.studioWorkingDraft.scenes.s1.prompt,'Mara waits beneath a midnight sky.');
  assert.equal(h.saved.scenes.s1.prompt,'Mara shouts at the rover.');
});

test('saved Scene baseline changes invalidate a matching retained draft',async()=>{
  const h=sceneFixture('{"prompt":"First proposed rewrite.","durationSeconds":20}');
  const request='Make this Scene fourteen seconds with a quieter ending.';
  const first=await h.window.studioDirectorBridge.writeSelectedScene({
    ...h.launch,authorRequest:request,fields:['prompt','durationSeconds']
  });
  assert.equal(first.review,true);
  assert.equal(h.events.filter(row=>row[0]==='model').length,1);
  assert.equal(h.state.studioWorkingDraft.draftOrigins.scenes.s1.request,request);
  h.saved.scenes.s1.prompt='Someone else changed the saved Scene.';
  h.changeResponse('{"prompt":"A fresh rewrite of the externally edited Scene.","durationSeconds":14}');
  await h.window.studioDirectorBridge.writeSelectedScene({
    ...h.launch,authorRequest:request,fields:['prompt','durationSeconds']
  });
  assert.equal(h.events.filter(row=>row[0]==='model').length,2,
    'same request is not enough to reuse a draft from a different saved baseline');
  const saved=h.events.find(row=>row[0]==='save')[1];
  assert.equal(saved.expected.prompt,'Someone else changed the saved Scene.');
  assert.equal(h.saved.scenes.s1.prompt,'A fresh rewrite of the externally edited Scene.');
});

test('a different Scene draft does not evict provenance of the first Scene',async()=>{
  const h=sceneFixture('{"prompt":"First usable partial rewrite.","durationSeconds":20}');
  h.saved.sceneOrder.push('s2');
  h.saved.scenes.s2={id:'s2',title:'Second',prompt:'A second original.',durationSeconds:8};
  const firstRequest='Extend both Scenes.';
  await h.window.studioDirectorBridge.writeSelectedScene({
    ...h.launch,authorRequest:firstRequest,fields:['prompt','durationSeconds']
  });
  h.changeResponse('{"prompt":"Second usable partial rewrite.","durationSeconds":20}');
  await h.window.studioDirectorBridge.writeSelectedScene({
    ...h.launch,sceneId:'s2',authorRequest:firstRequest,fields:['prompt','durationSeconds']
  });
  assert.equal(h.events.filter(row=>row[0]==='model').length,2);
  assert.deepEqual(Object.keys(h.state.studioWorkingDraft.draftOrigins.scenes).sort(),['s1','s2']);
  const resumed=await h.window.studioDirectorBridge.writeSelectedScene({
    ...h.launch,authorRequest:firstRequest,fields:['prompt','durationSeconds']
  });
  assert.equal(resumed.review,true);
  assert.equal(h.events.filter(row=>row[0]==='model').length,2,
    'the retained first Scene draft is reusable despite an intervening Scene draft');
  assert.equal(h.events.filter(row=>row[0]==='save').length,0);
});

test('a subsequent Scene rewrite sees the unsaved working prompt, not just the older saved prompt',async()=>{
  const h=sceneFixture();
  h.state.studioWorkingDraft.scenes.s1={prompt:'The previous unsaved quiet H3 draft.'};
  h.state.studioWorkingDraft.sourceRequest='First quieter draft';
  await h.window.studioDirectorBridge.writeSelectedScene({
    ...h.launch,instruction:'Make it even quieter.',
    authorRequest:'Make it even quieter.',fields:['prompt']
  });
  const call=h.events.find(event=>event[0]==='model');
  assert.ok(call,'the distinct new change should still author once');
  const input=JSON.parse(call[1]);
  assert.equal(input.unsavedWorkingFields.prompt,'The previous unsaved quiet H3 draft.');
  assert.equal(input.savedScene.fields.find(field=>field.id==='scene:s1:prompt').value,
    'Mara shouts at the rover.');
});
