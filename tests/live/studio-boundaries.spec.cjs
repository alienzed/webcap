'use strict';
const {test,expect}=require('../browser/test.cjs');
const {openLiveDirector,attachProject,story,seedProject,seedScene,openProject}=require('./helpers.cjs');

const terminalStatuses=new Set(['completed','failed','cancelled','stopped','interrupted']);

async function startRealRevision(page,projectId,model,instruction) {
  const response=await page.request.post('/fs/storyboard/director',{data:{
    storyId:projectId,operation:'revise_scenes_sequence',model,instruction,
    generateFreshTakes:false
  }});
  expect(response.ok(),'Real Scene revision was not accepted: '+await response.text()).toBeTruthy();
  const job=(await response.json()).job;
  expect(job?.jobId).toBeTruthy();
  return job.jobId;
}
async function jobStatus(page,id) {
  const response=await page.request.get('/fs/director/job?job='+encodeURIComponent(id));
  expect(response.ok()).toBeTruthy();
  return (await response.json()).job;
}
// Poll using ordinary Playwright assertions; never infer completion from elapsed time.
async function finishJob(page,id) {
  let last;
  await expect.poll(async()=>{
    last=await jobStatus(page,id);
    return terminalStatuses.has(String(last.status||''));
  },{timeout:300000,intervals:[400,900,1600]}).toBe(true);
  return last;
}
async function record(testInfo,name,content) {
  await testInfo.attach(name,{body:Buffer.from(JSON.stringify(content,null,2)),contentType:'application/json'});
}
async function threeSceneProject(page,name) {
  const project=await seedProject(page,name+' '+Date.now());
  const originals=[];
  for(const [title,prompt] of [
    ['Arrival','A bookseller unlocks a wooden door at dusk.'],
    ['Discovery','The bookseller finds an old map on a counter.'],
    ['Departure','The bookseller closes the shop as rain begins.']
  ]) originals.push(await seedScene(page,project.id,{title,prompt,durationSeconds:8}));
  return {project,originals};
}

test('Live boundary — cancellation after a saved Scene preserves only confirmed writes',async({page},testInfo)=>{
  const {project,originals}=await threeSceneProject(page,'Live Cancel Batch');
  const model=await openLiveDirector(page);
  await attachProject(page,project);
  const instruction='Revise each Scene with a distinctly visible antique brass lantern, keeping its existing action, location, title and duration.';
  const id=await startRealRevision(page,project.id,model,instruction);
  let reachedFirst=false,earlyEnd=null;
  try {
    await expect.poll(async()=>{
      const saved=await story(page,project.id);
      const firstSaved=saved.scenes[originals[0].id].prompt!==originals[0].prompt;
      const running=await jobStatus(page,id);
      if(terminalStatuses.has(running.status) && !firstSaved) {
        earlyEnd=running;
        throw new Error('Revision reached '+running.status+' before any Scene save: '+String(running.error||''));
      }
      reachedFirst=firstSaved;
      return firstSaved;
    },{timeout:300000,intervals:[300,600,1000]}).toBe(true);
  } catch(error) {
    const stillRunning=await jobStatus(page,id);
    if(!terminalStatuses.has(stillRunning.status))
      await page.request.post('/fs/director/job',{data:{operation:'cancel_job',jobId:id}});
    await record(testInfo,'cancel-before-first-save',{jobId:id,earlyEnd,project:await story(page,project.id)});
    throw error;
  }
  expect(reachedFirst).toBe(true);
  const beforeCancel=await jobStatus(page,id);
  // A very fast model may already have completed all Scenes. Report the real
  // timing as an unexercised cancellation boundary, not as a passing test.
  if(terminalStatuses.has(beforeCancel.status)) {
    await record(testInfo,'cancel-window-missed',{jobId:id,job:beforeCancel,project:await story(page,project.id)});
    test.skip(true,'Real model finished the batch before cancellation could be issued.');
  }
  const stopped=await page.request.post('/fs/director/job',{data:{operation:'cancel_job',jobId:id}});
  expect(stopped.ok(),await stopped.text()).toBeTruthy();
  const receipt=await finishJob(page,id);
  expect(['stopped','cancelled'].includes(receipt.status),'Cancellation did not stop the revision: '+JSON.stringify(receipt)).toBe(true);
  const saved=await story(page,project.id);
  expect(saved.sceneOrder).toEqual(originals.map(x=>x.id));
  expect(saved.scenes[originals[0].id].prompt).not.toBe(originals[0].prompt);
  const prompts=saved.sceneOrder.map(sceneId=>saved.scenes[sceneId].prompt);
  const changed=originals.map((scene,index)=>prompts[index]!==scene.prompt);
  const completedPrefix=changed.findIndex(value=>!value);
  // A cancelled sequence may have more than one completed save, but cannot
  // skip a target or silently continue saving subsequent targets.
  if(completedPrefix!==-1)
    expect(changed.slice(completedPrefix)).toEqual(changed.slice(completedPrefix).map(()=>false));
  const reportedCount=/stopped after (\\d+) Scenes/i.exec(String(receipt.error||''));
  if(reportedCount)
    expect(changed.filter(Boolean).length).toBe(Number(reportedCount[1]));
  if(changed.every(Boolean)) {
    await record(testInfo,'cancel-window-missed-after-save',{jobId:id,receipt,changed,project:saved});
    test.skip(true,'All Scenes were saved before cancellation became effective.');
  }
  await page.reload();
  const restored=await story(page,project.id);
  expect(restored.sceneOrder).toEqual(saved.sceneOrder);
  expect(restored.sceneOrder.map(sceneId=>restored.scenes[sceneId].prompt)).toEqual(prompts);
  for(const original of originals) {
    expect(restored.scenes[original.id].title).toBe(original.title);
    expect(restored.scenes[original.id].durationSeconds).toBe(original.durationSeconds);
  }
  await record(testInfo,'live-cancel-evidence',{model,instruction,jobId:id,beforeCancel,receipt,
    originalPrompts:originals.map(x=>x.prompt),persistedPrompts:prompts,changed});
});

test('Live boundary — navigating to another Project cannot retarget an in-flight revision',async({page},testInfo)=>{
  const {project:a,originals}=await threeSceneProject(page,'Live Active Target A');
  const b=await seedProject(page,'Live Active Target B '+Date.now());
  const model=await openLiveDirector(page);
  await attachProject(page,a);
  const instruction='Revise every Scene prompt to include a small silver clock that remains visible; preserve each original Scene action and the title and duration.';
  const id=await startRealRevision(page,a.id,model,instruction);
  await openProject(page,b.id);
  await expect(page.locator('#storyboard-story-title')).toHaveValue(b.title);
  const receipt=await finishJob(page,id);
  expect(receipt.status,'Real revision must finish normally: '+JSON.stringify(receipt)).toBe('completed');
  const savedA=await story(page,a.id),savedB=await story(page,b.id);
  expect(savedA.sceneOrder).toEqual(originals.map(x=>x.id));
  expect(savedB.sceneOrder).toHaveLength(0);
  for(const item of originals) {
    expect(savedA.scenes[item.id].prompt.trim()).toBeTruthy();
    expect(savedA.scenes[item.id].prompt).not.toBe(item.prompt);
    expect(savedA.scenes[item.id].title).toBe(item.title);
    expect(savedA.scenes[item.id].durationSeconds).toBe(item.durationSeconds);
  }
  await page.reload();
  const restored=await story(page,a.id);
  for(const sceneId of savedA.sceneOrder)
    expect(restored.scenes[sceneId].prompt).toBe(savedA.scenes[sceneId].prompt);
  expect((await story(page,b.id)).sceneOrder).toHaveLength(0);
  await record(testInfo,'live-navigation-evidence',{model,instruction,jobId:id,receipt,
    sourceProjectId:a.id,visibleProjectId:b.id,savedSceneIds:savedA.sceneOrder,
    persistedPrompts:savedA.sceneOrder.map(sceneId=>savedA.scenes[sceneId].prompt)});
});

test('Live boundary — a provider token cutoff never claims unsaved Scene drafts are persisted',async({page},testInfo)=>{
  const project=await seedProject(page,'Live Truncation '+Date.now());
  const model=await openLiveDirector(page);
  await attachProject(page,project);
  const request='Author 30 distinct, fully detailed eight-second H3 Scenes as structured scenes records. '+
    'For every Scene include a complete standalone prompt with character, physical location, '+
    'shot-by-shot timing, camera, lighting, ambience and dialogue. Return all the authored records.';
  const response=await page.request.post('/fs/director/chat',{data:{
    model,operation:'studio_scenes_draft',messages:[{role:'user',content:request}]
  }});
  expect(response.ok(),await response.text()).toBeTruthy();
  const id=(await response.json()).job?.jobId;
  expect(id).toBeTruthy();
  const receipt=await finishJob(page,id);
  const source=await story(page,project.id);
  expect(source.sceneOrder,'No draft-only model result may silently save Scenes').toHaveLength(0);
  const result=receipt.result||{};
  const limitSignal=/truncat|token|context|finish_reason=length|max_tokens|exceed/i.test(
    [receipt.error,result.structureWarning,result.finishReason].filter(Boolean).join(' '));
  await record(testInfo,'live-token-boundary-evidence',{model,request,jobId:id,status:receipt.status,
    error:receipt.error,finishReason:result.finishReason,structureWarning:result.structureWarning,
    returnedText:result.text,sceneOrder:source.sceneOrder});
  if(!limitSignal)
    test.skip(true,'This provider did not report a token/context limit in the real response; no truncation pass is claimed.');
  expect(['failed','completed'].includes(receipt.status)).toBe(true);
  expect(result.finishReason==='length'||result.finishReason==='max_tokens'||
    /truncat|token|context|exceed/i.test(String(receipt.error||result.structureWarning||''))).toBe(true);
  await page.reload();
  expect((await story(page,project.id)).sceneOrder).toHaveLength(0);
});
