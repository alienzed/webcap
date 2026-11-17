'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,queueModel,observedModels,openDirector,openProject,say,seedProject,story,runWrite}=require('./helpers.cjs');
const {ensureAttachedProject}=require('./helpers.cjs');

test('Flow 7 — navigation leaves unsaved conversation intact; explicit Scene Write saves once',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'Write recovery '+Date.now());
  const other=await seedProject(page,'Unrelated Project '+Date.now());
  await openDirector(page);
  await openProject(page,project.id);
  await ensureAttachedProject(page,project.title);
  await queueModel(request,'The opening should show a rain-streaked window.');
  await say(page,'Our opening Scene is a door opening slowly in rain.');
  await expect.poll(async()=> (await observedModels(request)).calls.length).toBe(1);
  await openProject(page,other.id);
  await openProject(page,project.id);
  await queueModel(request,{scenes:[
    {title:'Original Scene',prompt:'The door opens slowly in rain.',durationSeconds:8}
  ]});
  await runWrite(page,{projectId:project.id,operation:'scene-write',sceneMode:'create'});
  await expect.poll(async()=> (await story(page,project.id)).sceneOrder.length).toBe(1);
  const saved=await story(page,project.id);
  expect(saved.scenes[saved.sceneOrder[0]].prompt).toBe('The door opens slowly in rain.');
  expect((await story(page,other.id)).sceneOrder).toHaveLength(0);
  const calls=(await observedModels(request)).calls;
  expect(calls).toHaveLength(2);
  expect(JSON.stringify(calls[1].messages)).toContain('Our opening Scene is a door opening slowly in rain.');
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
