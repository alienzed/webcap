'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,queueModel,openDirector,runWrite,story,seedProject,openProject,
  ensureAttachedProject}=require('./helpers.cjs');

test('Flow 5 — changing editor navigation cannot redirect the explicitly chosen Project Write',async({page,request})=>{
  await resetModel(request);
  const a=await seedProject(page,'Project A '+Date.now(),{style:'Cool morning light.'});
  const b=await seedProject(page,'Project B '+Date.now(),{style:'Distant red neon.'});
  await openDirector(page);
  await openProject(page,a.id);
  await ensureAttachedProject(page,a.title);
  await openProject(page,b.id);
  await expect(page.locator('#storyboard-story-title')).toHaveValue(b.title);
  await expect(page.locator('#director-chat-title')).toContainText('Project A');
  await queueModel(request,{style:'Silver moonlight.'});
  await runWrite(page,{projectId:a.id,operation:'project',
    instruction:'Update the explicitly selected Project A atmosphere.'});
  await expect.poll(async()=> (await story(page,a.id)).style).toBe('Silver moonlight.');
  expect((await story(page,b.id)).style).toBe('Distant red neon.');
  await page.reload();
  expect((await story(page,a.id)).style).toBe('Silver moonlight.');
  expect((await story(page,b.id)).style).toBe('Distant red neon.');
});
