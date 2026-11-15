'use strict';
const {test,expect}=require('./test.cjs');
const {openDirector,story}=require('./helpers.cjs');

test('Flow 4 — explicit Read chooses and shows actual saved Project/Scene scope before sharing',async({page})=>{
  // Fixture is written through WebCap's real application route, not a mocked
  // response. The user interaction being tested starts at Studio Director.
  const created=await page.request.post('/fs/storyboard',{data:{
    operation:'create_story',story:{
      title:'Read Scope Project',concept:'Fixed concept: a silver gate.',
      style:'Blue dusk.',invariants:[],status:'active',targetSceneCount:2
    }
  }});
  expect(created.ok()).toBeTruthy();
  const project=(await created.json()).story;
  const added=await page.request.post('/fs/storyboard',{data:{
    operation:'add_scene',storyId:project.id,scene:{
      title:'Silver Gate',prompt:'The woman opens a silver gate beneath blue dusk.',durationSeconds:8
    }
  }});
  expect(added.ok()).toBeTruthy();
  const scene=(await added.json()).scene;
  expect((await story(page,project.id)).scenes[scene.id].prompt).toContain('silver gate');
  await openDirector(page);
  // The flow contract requires independently discoverable explicit selection
  // and inspect-before-share. Do NOT silently substitute automatic attachment.
  const read=page.locator('#studio-dw-read');
  await expect(read,'Explicit Read is not discoverable to the Studio author').toBeVisible();
  await read.click();
  await expect(page.locator('#studio-dw-read-panel')).toBeVisible();
  await page.locator('#studio-dw-read-project').selectOption(project.id);
  await page.locator('#studio-dw-read-selection').locator('summary').click();
  await expect(page.locator('#studio-dw-project-fields')).toBeVisible();
  await expect(page.locator('#studio-dw-scene-fields')).toContainText('Silver Gate');
  await page.locator('#studio-dw-read-preview').locator('summary').click();
  await expect(page.locator('#studio-dw-read-preview-data')).toContainText('Fixed concept: a silver gate.');
  await page.locator('#studio-dw-read-send').click();
  await expect(page.locator('#studio-dw-status')).toContainText(/shared|context|read/i);
  expect((await story(page,project.id)).scenes[scene.id].prompt).toContain('silver gate');
});
