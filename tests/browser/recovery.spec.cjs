'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,queueModel,observedModels,openDirector,openProject,say,seedProject,story}=require('./helpers.cjs');
const {ensureAttachedProject}=require('./helpers.cjs');

test('Flow 7 — unsaved Scene work survives navigating away and back, then saves exactly once',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'Resume retained draft '+Date.now());
  const other=await seedProject(page,'Unrelated Project '+Date.now());
  await openDirector(page);
  await openProject(page,project.id);
  await ensureAttachedProject(page,project.title);
  await queueModel(request,{
    reply:'A Scene has been authored.',
    scenes:[{title:'Original Scene',prompt:'The door opens slowly.',durationSeconds:8}],
    action:{kind:'create_scene',instruction:'Create an opening Scene.'}
  });
  await say(page,'Create an opening Scene');
  const action=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  await expect(action).toBeVisible();
  await action.click();
  await expect(page.locator('#studio-scenes-review')).toBeVisible();
  const prompt=page.locator('#studio-scenes-rows [data-field="prompt"]');
  await prompt.fill('An edited draft: the door opens slowly in rain.');
  await page.locator('#studio-scenes-close').click();
  expect((await story(page,project.id)).sceneOrder).toHaveLength(0);
  await openProject(page,other.id);
  await openProject(page,project.id);
  await action.click();
  await expect(page.locator('#studio-scenes-review')).toBeVisible();
  await expect(prompt).toHaveValue('An edited draft: the door opens slowly in rain.');
  await page.locator('#studio-scenes-apply').click();
  await expect.poll(async()=> (await story(page,project.id)).sceneOrder.length).toBe(1);
  const saved=await story(page,project.id);
  expect(saved.scenes[saved.sceneOrder[0]].prompt).toBe('An edited draft: the door opens slowly in rain.');
  expect((await story(page,other.id)).sceneOrder).toHaveLength(0);
  expect((await observedModels(request)).calls).toHaveLength(1);
  await page.reload();
  expect((await story(page,project.id)).sceneOrder).toEqual(saved.sceneOrder);
});

test('Flow 7 failure checkpoint — external inference failure remains visible without false save',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'Visible failure '+Date.now());
  await openDirector(page);
  await openProject(page,project.id);
  await ensureAttachedProject(page,project.title);
  const queued=await request.post('http://127.0.0.1:4211/__acceptance/queue',{
    data:{httpError:503,message:'Controlled remote inference outage'}
  });
  expect(queued.ok()).toBeTruthy();
  await say(page,'Discuss this Project before revising it.');
  await expect(page.locator('#director-chat-progress')).toContainText(/outage|unavailable|failed|error/i);
  expect((await story(page,project.id)).sceneOrder).toHaveLength(0);
  expect((await observedModels(request)).calls).toHaveLength(1);
});
