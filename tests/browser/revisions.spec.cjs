'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,queueModel,observedModels,openDirector,say,story,seedProject,seedScene,openProject}=require('./helpers.cjs');
const {ensureAttachedProject}=require('./helpers.cjs');

test('Flow 3 — reviewed Overview revision changes only intended persisted fields',async({page,request})=>{
  await resetModel(request);
  const original=await seedProject(page,'Revision scope '+Date.now(),{
    concept:'A bookshop is open late.',style:'Cold blue windows.'
  });
  const scene=await seedScene(page,original.id,{
    title:'Entrance',prompt:'A visitor opens a heavy red door.',durationSeconds:8
  });
  await openDirector(page);
  await openProject(page,original.id);
  await ensureAttachedProject(page,original.title);
  await queueModel(request,{
    reply:'I can warm the Project atmosphere.',
    changes:{project:{style:'Soft amber light.'}},
    action:{kind:'write_project',instruction:'Revise only the atmosphere.',fields:['style']}
  });
  await say(page,'Revise the Project atmosphere to soft amber light.');
  const action=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  await expect(action).toContainText('Review authored Project');
  await page.locator('#studio-dw-suggestions select[aria-label="Project material destination"]').selectOption(original.id);
  await action.click();
  await expect(page.locator('#studio-brief-review')).toBeVisible();
  await expect(page.locator('#studio-brief-style')).toHaveValue('Soft amber light.');
  await page.locator('#studio-brief-style').fill('Warm golden windows.');
  await page.locator('#studio-brief-apply').click();
  await expect.poll(async()=> (await story(page,original.id)).style).toBe('Warm golden windows.');
  const saved=await story(page,original.id);
  expect(saved.concept).toBe('A bookshop is open late.');
  expect(saved.scenes[scene.id].prompt).toBe('A visitor opens a heavy red door.');
  expect(saved.scenes[scene.id].durationSeconds).toBe(8);
  expect((await observedModels(request)).calls).toHaveLength(1);
  await page.reload();
  expect((await story(page,original.id)).style).toBe('Warm golden windows.');
});

test('Flow 3 safety — action-only model claims cannot authorize a batch Scene write',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'No phantom batch '+Date.now());
  const first=await seedScene(page,project.id,{
    title:'First',prompt:'First saved prompt.',durationSeconds:8
  });
  const second=await seedScene(page,project.id,{
    title:'Second',prompt:'Second saved prompt.',durationSeconds:8
  });
  await openDirector(page);
  await openProject(page,project.id);
  await ensureAttachedProject(page,project.title);
  await queueModel(request,{
    reply:'I can revise both Scene prompts.',
    action:{kind:'write_scenes',instruction:'Revise both Scene prompts.',fields:['prompt']}
  });
  await say(page,'Discuss revising the two Scenes with warmer lighting.');
  await expect(page.locator('#director-chat-messages')).toContainText('I can revise both Scene prompts.');
  await expect(page.locator('#studio-dw-suggestions .studio-dw-suggestion-action')).toHaveCount(0);
  const persisted=await story(page,project.id);
  expect(persisted.scenes[first.id].prompt).toBe('First saved prompt.');
  expect(persisted.scenes[second.id].prompt).toBe('Second saved prompt.');
  expect((await observedModels(request)).calls).toHaveLength(1);
});
