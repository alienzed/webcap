'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,queueModel,observedModels,openDirector,openProject,say,seedProject,story}=require('./helpers.cjs');
const {ensureAttachedProject}=require('./helpers.cjs');

test('Flow 7 — explicit Write destination remains independent from the currently open Project',async({page,request})=>{
  await resetModel(request);
  const target=await seedProject(page,'Chosen Write destination '+Date.now());
  const other=await seedProject(page,'Unrelated open Project '+Date.now());
  await openDirector(page);
  await openProject(page,other.id);
  await queueModel(request,{scenes:[{
    title:'Arrival',prompt:'Eight-second wide opening as the courier enters the station.',
    durationSeconds:8
  }]});
  await page.locator('#studio-dw-write').click();
  await page.locator('#studio-dw-write-operation').selectOption('scene-write');
  await page.locator('#studio-dw-write-project').selectOption(target.id);
  await page.locator('#studio-dw-scene-mode').selectOption('create');
  await page.locator('#studio-dw-write-instruction').fill('Create the agreed opening.');
  await page.locator('#studio-dw-write-prepare').click();
  await expect.poll(async()=>(await story(page,target.id)).sceneOrder.length,
    {timeout:30000}).toBe(1);
  expect((await story(page,other.id)).sceneOrder).toHaveLength(0);
  expect((await observedModels(request)).calls).toHaveLength(1);
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
