'use strict';
const {test,expect}=require('./test.cjs');
const {openDirector,openProject,reopenDirectorIfClosed,ensureAttachedProject,resetModel,queueModel,observedModels,story,seedProject,seedScene}=require('./helpers.cjs');

test('Flow 4 — explicit Read persists immutable visible Project snapshots and never calls the model',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'Read Scope Project '+Date.now(),{
    concept:'Fixed concept: a silver gate.',style:'Blue dusk.'
  });
  const scene=await seedScene(page,project.id,{
    title:'Silver Gate',prompt:'The woman opens a silver gate beneath blue dusk.',durationSeconds:8
  });
  await openDirector(page);
  await openProject(page,project.id);
  await ensureAttachedProject(page,project.title);
  await expect(page.locator('#director-studio-access')).toBeVisible();
  const details=page.locator('#director-studio-access-details');
  await details.locator('summary').click();
  await expect(page.locator('#director-studio-access-field')).toBeVisible();
  expect((await observedModels(request)).calls).toHaveLength(0);

  await page.locator('#director-studio-access-field').selectOption('brief');
  await page.locator('#director-studio-access-read').click();
  await expect(page.locator('#director-studio-access-data')).toContainText('Fixed concept: a silver gate.');
  await expect(page.locator('#director-chat-messages')).toContainText('Fixed concept: a silver gate.');
  expect((await observedModels(request)).calls).toHaveLength(0);

  await page.locator('#director-studio-access-field').selectOption('prompt');
  await expect(page.locator('#director-studio-access-scene')).toBeVisible();
  await page.locator('#director-studio-access-scene').selectOption(scene.id);
  await page.locator('#director-studio-access-read').click();
  await expect(page.locator('#director-chat-messages')).toContainText(
    'The woman opens a silver gate beneath blue dusk.'
  );
  const snapshots=await page.locator('#director-chat-messages .director-chat-message-user .director-chat-message-body').allTextContents();
  expect(snapshots).toHaveLength(2);
  expect((await observedModels(request)).calls).toHaveLength(0);

  const changed=await page.request.post('/fs/storyboard',{data:{
    operation:'update_scene',storyId:project.id,sceneId:scene.id,
    scene:{prompt:'The woman closes the silver gate under a new moon.'}
  }});
  expect(changed.ok()).toBeTruthy();
  await page.reload();
  await reopenDirectorIfClosed(page);
  await expect(page.locator('#director-chat-messages')).toContainText('The woman opens a silver gate beneath blue dusk.');
  const persisted=await page.locator('#director-chat-messages .director-chat-message-user .director-chat-message-body').allTextContents();
  expect(persisted).toEqual(snapshots);
  expect((await observedModels(request)).calls).toHaveLength(0);

  await queueModel(request,'The saved earlier snapshot depicts an open gate.');
  await page.locator('#director-chat-input').fill('Discuss the snapshots already shared.');
  await page.locator('#director-chat-send').click();
  await expect(page.locator('#director-chat-messages')).toContainText('The saved earlier snapshot depicts an open gate.');
  let calls=(await observedModels(request)).calls;
  expect(calls).toHaveLength(1);
  snapshots.forEach(snapshot=>expect(calls[0].messages.some(message=>message.role==='user' && message.content===snapshot)).toBe(true));
  expect(JSON.stringify(calls[0].messages)).not.toContain('new moon');

  await page.locator('#director-chat-context-approve').click();
  await page.locator('#studio-dw-read-project').selectOption(project.id);
  const selection=page.locator('#studio-dw-read-selection');
  if(await selection.getAttribute('open')===null) await selection.locator('summary').click();
  await page.locator('#studio-dw-project-fields input[data-group-select]').first().uncheck();
  await page.locator('#studio-dw-scene-fields input[data-group-select]').first().check();
  await page.locator('#studio-dw-read-send').click();
  await expect(page.locator('#director-chat-messages')).toContainText('The woman closes the silver gate under a new moon.');
  expect((await observedModels(request)).calls).toHaveLength(1);
  expect((await story(page,project.id)).scenes[scene.id].prompt)
    .toBe('The woman closes the silver gate under a new moon.');
});
