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
async function openDirector(page) {
  await page.goto('/');
  await page.locator('#activity-storyboard-btn').click();
  await page.locator('#director-chat-rail-btn').click();
  const studio=page.locator('[data-assistant-mode="storyboard"]');
  if(await studio.isVisible()) await studio.click();
  await expect(page.locator('#director-chat-input')).toBeVisible();
  const model=page.locator('#director-chat-model');
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
module.exports={resetModel,queueModel,observedModels,openDirector,say,stories,story};
