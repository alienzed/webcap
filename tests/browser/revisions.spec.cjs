'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,queueModel,observedModels,openDirector,say,runWrite,
  story,seedProject,seedScene,openProject}=require('./helpers.cjs');

test('Flow 3 — explicit Project revision updates only returned Project fields',async({page,request})=>{
  await resetModel(request);
  const original=await seedProject(page,'Revision scope '+Date.now(),{
    concept:'A bookshop is open late.',style:'Cold blue windows.'
  });
  const scene=await seedScene(page,original.id,{
    title:'Entrance',prompt:'A visitor opens a heavy red door.',durationSeconds:8
  });
  await openDirector(page);
  await openProject(page,original.id);
  await queueModel(request,{style:'Warm golden windows.'});
  await runWrite(page,{projectId:original.id,operation:'project',
    instruction:'Revise only the atmosphere to warmer golden light.'});
  await expect.poll(async()=> (await story(page,original.id)).style).toBe('Warm golden windows.');
  const saved=await story(page,original.id);
  expect(saved.concept).toBe('A bookshop is open late.');
  expect(saved.scenes[scene.id].prompt).toBe('A visitor opens a heavy red door.');
  expect(saved.scenes[scene.id].durationSeconds).toBe(8);
  expect((await observedModels(request)).calls).toHaveLength(1);
  await expect(page.locator('#studio-brief-review')).not.toBeVisible();
  await page.reload();
  expect((await story(page,original.id)).style).toBe('Warm golden windows.');
});

test('Flow 3 safety — action-only chat output cannot authorize Scene writes',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'No phantom batch '+Date.now());
  const first=await seedScene(page,project.id,{title:'First',prompt:'First saved prompt.',durationSeconds:8});
  const second=await seedScene(page,project.id,{title:'Second',prompt:'Second saved prompt.',durationSeconds:8});
  await openDirector(page);
  await openProject(page,project.id);
  await queueModel(request,{reply:'I can revise both Scenes.',
    action:{kind:'write_scenes',instruction:'Revise both Scenes.',fields:['prompt']}});
  await say(page,'Discuss warmer lighting for the two Scenes.');
  await expect(page.locator('#director-chat-messages')).toContainText('I can revise both Scenes.');
  await expect(page.locator('#studio-dw-suggestions .studio-dw-suggestion-action')).toHaveCount(0);
  const saved=await story(page,project.id);
  expect(saved.scenes[first.id].prompt).toBe('First saved prompt.');
  expect(saved.scenes[second.id].prompt).toBe('Second saved prompt.');
  expect((await observedModels(request)).calls).toHaveLength(1);
});
