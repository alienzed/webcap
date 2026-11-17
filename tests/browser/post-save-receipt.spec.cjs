'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {test,expect}=require('./test.cjs');
const {resetModel,queueModel,observedModels,openDirector,openProject,openWrite,seedProject,story}=require('./helpers.cjs');
const {ensureAttachedProject}=require('./helpers.cjs');

// An actual filesystem permission failure AFTER Scene persistence. This does
// not intercept/mimic WebCap routes, fabricate a save receipt or mock app code.
test('Flow 7 variation — Scene persists when subsequent conversation receipt cannot be saved',async({page,request})=>{
  test.skip(process.platform==='win32','POSIX chmod fault injection is unavailable on Windows; this acceptance condition remains unverified there.');
  await resetModel(request);
  const project=await seedProject(page,'Post-save receipt fault '+Date.now());
  await openDirector(page);
  await openProject(page,project.id);
  await ensureAttachedProject(page,project.title);
  await queueModel(request,{scenes:[{
    title:'Night Window',prompt:'A lamp glows behind the rain-streaked glass.',durationSeconds:8
  }]});
  await openWrite(page,{projectId:project.id,operation:'scene-write',
    sceneMode:'create',instruction:'Create Night Window.'});

  const root=fs.readFileSync(path.join(__dirname,'../../test-results/studio-temp-root.txt'),'utf8').trim();
  let chatId='';
  await expect.poll(async()=>{
    const response=await page.request.get('/fs/director/chats');
    const body=await response.json();
    chatId=body.activeByMode?.storyboard||'';
    return chatId.length>0;
  }).toBeTruthy();
  const chatDirectory=path.join(root,'data','state','director_chats',chatId);
  await expect.poll(()=>fs.existsSync(chatDirectory)).toBeTruthy();

  try{
    fs.chmodSync(chatDirectory,0o500);
    await page.locator('#studio-dw-write-prepare').click();
    await expect.poll(async()=> (await story(page,project.id)).sceneOrder.length).toBe(1);
    await expect(page.locator('#director-studio-action-status')).toContainText(
      /saved, but recording or refreshing failed/i
    );
  }finally{
    fs.chmodSync(chatDirectory,0o700);
  }
  const persisted=await story(page,project.id);
  expect(persisted.sceneOrder).toHaveLength(1);
  expect(persisted.scenes[persisted.sceneOrder[0]].prompt)
    .toBe('A lamp glows behind the rain-streaked glass.');
  expect((await observedModels(request)).calls).toHaveLength(1);
  await page.reload();
  expect((await story(page,project.id)).sceneOrder).toHaveLength(1);
});
