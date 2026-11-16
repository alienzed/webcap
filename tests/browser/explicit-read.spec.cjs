'use strict';
const {test,expect}=require('./test.cjs');
const {openDirector,openProject,ensureAttachedProject,resetModel,queueModel,observedModels,story,seedProject,seedScene}=require('./helpers.cjs');

test('Flow 4 — explicit Read selects saved Project/Scene fields and refreshes real model context',async({page,request})=>{
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
  expect((await observedModels(request)).calls).toHaveLength(0); // Attachment alone is not a Read.

  await queueModel(request,'I received Project Concept, Style and Invariants.');
  await page.locator('#director-studio-access-field').selectOption('brief');
  await page.locator('#director-studio-access-read').click();
  await expect(page.locator('#director-studio-access-data')).toContainText('Fixed concept: a silver gate.');
  await expect(page.locator('#director-chat-messages')).toContainText('I received Project Concept');
  let calls=(await observedModels(request)).calls;
  expect(calls).toHaveLength(1);
  expect(JSON.stringify(calls[0].messages)).toContain('Fixed concept: a silver gate.');

  await queueModel(request,'I received the selected Scene prompt.');
  await page.locator('#director-studio-access-field').selectOption('prompt');
  await expect(page.locator('#director-studio-access-scene')).toBeVisible();
  await page.locator('#director-studio-access-scene').selectOption(scene.id);
  await page.locator('#director-studio-access-read').click();
  await expect(page.locator('#director-studio-access-data')).toContainText(
    'The woman opens a silver gate beneath blue dusk.'
  );
  await expect(page.locator('#director-chat-messages')).toContainText('I received the selected Scene prompt.');
  calls=(await observedModels(request)).calls;
  expect(calls).toHaveLength(2);
  expect(JSON.stringify(calls[1].messages)).toContain('The woman opens a silver gate beneath blue dusk.');

  // An actual application save changes the source of truth for a subsequent Read.
  const changed=await page.request.post('/fs/storyboard',{data:{
    operation:'update_scene',storyId:project.id,sceneId:scene.id,
    scene:{prompt:'The woman closes the silver gate under a new moon.'}
  }});
  expect(changed.ok()).toBeTruthy();
  await queueModel(request,'I received refreshed Scene values.');
  await page.locator('#director-studio-access-read').click();
  await expect(page.locator('#director-studio-access-data')).toContainText('new moon');
  await expect(page.locator('#director-chat-messages')).toContainText('I received refreshed Scene values.');
  calls=(await observedModels(request)).calls;
  expect(calls).toHaveLength(3);
  expect(JSON.stringify(calls[2].messages)).toContain('The woman closes the silver gate under a new moon.');
  expect((await story(page,project.id)).scenes[scene.id].prompt)
    .toBe('The woman closes the silver gate under a new moon.');
});
