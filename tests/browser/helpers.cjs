'use strict';
const {expect}=require('@playwright/test');
const inference='http://127.0.0.1:4211';
async function resetModel(request) {
  const response=await request.post(inference+'/__acceptance/reset');
  expect(response.ok()).toBeTruthy();
}
async function queueModel(request,value) {
  const response=await request.post(inference+'/__acceptance/queue',{data:{value}});
  expect(response.ok()).toBeTruthy();
}
async function observedModels(request) {
  const response=await request.get(inference+'/__acceptance/calls');
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function freshDirectorSession(page) {
  // Real session-store API fixture: each test needs an independent conversation.
  // Creating test data via WebCap routes avoids claiming the header's responsive
  // New conversation control is the user-facing operation under test.
  const response=await page.request.post('/fs/director/chats',{data:{mode:'storyboard'}});
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).chat?.id).toBeTruthy();
}
async function openDirector(page) {
  await freshDirectorSession(page);
  await page.goto('/');
  await page.locator('#activity-storyboard-btn').click();
  await page.locator('#director-chat-rail-btn').click();
  const studio=page.locator('[data-assistant-mode="storyboard"]');
  if(await studio.isVisible()) await studio.click();
  await expect(page.locator('#director-chat-input')).toBeVisible();
  const model=page.locator('#app-header-director-model');
  await expect(model.locator('option[value="acceptance::acceptance-model"]')).toHaveCount(1);
  await model.selectOption('acceptance::acceptance-model');
}
async function say(page,text) {
  await page.locator('#director-chat-input').fill(text);
  await expect(page.locator('#director-chat-send')).toBeEnabled();
  await page.locator('#director-chat-send').click();
}
async function stories(page) {
  const response=await page.request.get('/fs/storyboard');
  expect(response.ok()).toBeTruthy();
  return (await response.json()).stories;
}
async function story(page,id) {
  const response=await page.request.get('/fs/storyboard?story='+encodeURIComponent(id));
  expect(response.ok()).toBeTruthy();
  return (await response.json()).story;
}
async function seedProject(page, name, overrides={}) {
  const response=await page.request.post('/fs/storyboard',{data:{
    operation:'create_story',story:{
      title:name,concept:'A night in a bookshop.',style:'Warm lamp light.',
      invariants:[],status:'active',targetSceneCount:4,...overrides
    }
  }});
  expect(response.ok()).toBeTruthy();
  return (await response.json()).story;
}
async function seedScene(page, projectId, scene) {
  const response=await page.request.post('/fs/storyboard',{data:{
    operation:'add_scene',storyId:projectId,scene
  }});
  expect(response.ok()).toBeTruthy();
  return (await response.json()).scene;
}
async function openProject(page, projectId) {
  const row=page.locator('#storyboard-library-list [data-story-id="'+projectId+'"]');
  await expect(row).toBeVisible();
  await row.locator('[data-story-open]').click();
}
async function ensureAttachedProject(page,expectedTitle) {
  // Opening a Scene can launch Director's contextual Revision mode. These
  // cases explicitly test conversation/Read and must choose that visible mode.
  const composerMode=page.locator('#director-studio-composer-mode-select');
  if(await composerMode.isVisible() && await composerMode.inputValue()!=='conversation')
    await composerMode.selectOption('conversation');
  const label=page.locator('#director-chat-title');
  const attach=page.locator('#director-studio-attach-current');
  if(await attach.isVisible()) await attach.click();
  await expect(label).toContainText(expectedTitle);
}
module.exports={freshDirectorSession,ensureAttachedProject,resetModel,queueModel,observedModels,openDirector,say,stories,story,seedProject,seedScene,openProject};
