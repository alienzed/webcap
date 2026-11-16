'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,queueModel,observedModels,openDirector,say,story,stories,
  seedProject,seedScene,openProject,reopenDirectorIfClosed}=require('./helpers.cjs');

test('Pivot: authored new Overview never overwrites the selected Project',async({page,request})=>{
  await resetModel(request);
  const a=await seedProject(page,'Pivot Source '+Date.now(),{
    concept:'A totally unrelated lighthouse adventure.',style:'Blue storm light.'
  });
  await openDirector(page);
  await openProject(page,a.id);
  await reopenDirectorIfClosed(page);
  const name='New Pivot '+Date.now();
  await queueModel(request,{reply:'The different Project is drafted.',changes:{project:{
    title:name,concept:'A woodcarver creates a tiny automaton.',
    style:'Warm golden morning light.',invariants:[]}}});
  await say(page,'Develop this separate idea as a new Project.');
  const action=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  await expect(action).toBeVisible();
  const destination=page.locator('#studio-dw-suggestions select[aria-label="Project material destination"]');
  await expect(destination).toHaveValue('');
  await action.click();
  await expect(page.locator('#studio-project-review')).toBeVisible();
  await expect(page.locator('#studio-project-title')).toHaveValue(name);
  await page.locator('#studio-project-create').click();
  await expect.poll(async()=>(await stories(page)).some(item=>item.title===name)).toBeTruthy();
  const newProject=(await stories(page)).find(item=>item.title===name);
  expect((await story(page,newProject.id)).style).toBe('Warm golden morning light.');
  expect((await story(page,a.id)).style).toBe('Blue storm light.');
  expect((await observedModels(request)).calls).toHaveLength(1);
});

test('Cross-Project references: approved sources do not decide where material is applied',async({page,request})=>{
  await resetModel(request);
  const a=await seedProject(page,'Pacing Reference '+Date.now(),{
    concept:'A sequence of rapid linked actions.',style:'Documentary natural light.'
  });
  const b=await seedProject(page,'Destination '+Date.now(),{
    concept:'An unrelated workshop.',style:'Cold blue evening.'
  });
  const sourceScene=await seedScene(page,b.id,{
    title:'Reference Character',prompt:'A violin maker enters through a red doorway.',
    durationSeconds:8
  });
  await openDirector(page);
  await openProject(page,b.id);
  await reopenDirectorIfClosed(page);

  const share=page.locator('#director-chat-context-approve');
  await share.click();
  await page.locator('#studio-dw-read-project').selectOption(a.id);
  await expect(page.locator('#studio-dw-read-send')).toBeEnabled();
  await page.locator('#studio-dw-read-send').click();

  await share.click();
  await page.locator('#studio-dw-read-project').selectOption(b.id);
  await page.locator('#studio-dw-project-fields input[data-group-select]').uncheck();
  const sceneCheckbox=page.locator('#studio-dw-scene-fields input[data-group-select]');
  await expect(sceneCheckbox).toHaveCount(1);
  await sceneCheckbox.check();
  await page.locator('#studio-dw-read-send').click();
  await share.click();
  await expect(page.locator('#studio-dw-approved-sources .studio-dw-approved-source')).toHaveCount(2);

  await queueModel(request,{reply:'The revised visual atmosphere is ready.',
    changes:{project:{style:'Coordinated fast-paced split-screen action.'}}});
  await say(page,'Write a tighter atmosphere using the shared pacing reference.');
  const requestBody=(await observedModels(request)).calls[0];
  const text=JSON.stringify(requestBody.messages);
  expect(text).toContain('A sequence of rapid linked actions.');
  expect(text).toContain('A violin maker enters through a red doorway.');
  // The author chooses the destination in WebCap; references are not write IDs.
  const destination=page.locator('#studio-dw-suggestions select[aria-label="Project material destination"]');
  await destination.selectOption(b.id);
  await page.locator('#studio-dw-suggestions .studio-dw-suggestion-action').click();
  await expect(page.locator('#studio-brief-review')).toBeVisible();
  await expect(page.locator('#studio-brief-target')).toContainText(b.title);
  await expect(page.locator('#studio-brief-style')).toHaveValue('Coordinated fast-paced split-screen action.');
  await page.locator('#studio-brief-apply').click();
  await expect.poll(async()=>(await story(page,b.id)).style)
    .toBe('Coordinated fast-paced split-screen action.');
  expect((await story(page,a.id)).style).toBe('Documentary natural light.');
  expect((await story(page,b.id)).scenes[sourceScene.id].prompt)
    .toBe('A violin maker enters through a red doorway.');
  expect((await observedModels(request)).calls).toHaveLength(1);
});
