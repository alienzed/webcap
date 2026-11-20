'use strict';
const {test,expect}=require('../browser/test.cjs');
const {openLiveDirector,attachProject,story,seedProject,seedScene}=require('./helpers.cjs');

async function reviseUsingRealModel(page,instruction) {
  await page.locator('#director-studio-actions-toggle').click();
  await page.locator('[data-studio-tool="revision"]').click();
  await expect(page.locator('#director-studio-composer-mode-select')).toHaveValue('revision');
  await expect(page.locator('#director-studio-revision-controls')).toBeVisible();
  await page.locator('#director-studio-revision-preset').selectOption('');
  await page.locator('#director-studio-revision-fresh').uncheck();
  await page.locator('#director-studio-revision-input').fill(instruction);
  await expect(page.locator('#director-chat-send')).toBeEnabled();
  await page.locator('#director-chat-send').click();
  // This path uses Storyboard's actual per-Scene execution/save machinery,
  // not a conversation promise or a prefilled review with no saved result.
  await expect(page.locator('#director-studio-revision-status'))
    .toContainText('Scene revision completed.',{timeout:300000});
}

test('Live Flow 3 — single existing Scene revision persists without changing title, duration or Takes',async({page},testInfo)=>{
  const project=await seedProject(page,'Live Single Revision '+Date.now(),{
    concept:'A solitary bookshop scene.',style:'Rainy evening.'
  });
  const scene=await seedScene(page,project.id,{
    title:'Arriving',prompt:'A visitor approaches a locked bookshop door at night.',
    durationSeconds:8
  });
  const model=await openLiveDirector(page);
  await attachProject(page,project);
  const instruction='Revise the existing Scene prompt so the visitor approaches the bookshop door beneath distinctly glowing amber lanterns. Keep the visitor, locked bookshop door, nighttime setting, title and duration.';
  await reviseUsingRealModel(page,instruction);
  const saved=await story(page,project.id);
  expect(saved.sceneOrder).toEqual([scene.id]);
  const result=saved.scenes[scene.id];
  expect(result.prompt.trim()).toBeTruthy();
  expect(result.prompt).not.toBe(scene.prompt);
  expect(result.title).toBe(scene.title);
  expect(result.durationSeconds).toBe(scene.durationSeconds);
  expect(Object.keys(result.takes||{})).toHaveLength(0);
  await page.reload();
  expect((await story(page,project.id)).scenes[scene.id].prompt).toBe(result.prompt);
  await testInfo.attach('studio-live-revision-evidence',{body:Buffer.from(JSON.stringify({model,instruction,projectId:project.id,sceneId:scene.id,before:scene.prompt,after:result.prompt},null,2)),contentType:'application/json'});
});

test('Live Flow 3 — multi-Scene revision saves each real result without rewriting unrelated fields',async({page},testInfo)=>{
  const project=await seedProject(page,'Live Batch Revision '+Date.now(),{
    concept:'A walk through an old library.',style:'Cool night.'
  });
  const first=await seedScene(page,project.id,{
    title:'Outside',prompt:'A woman stands outside the old library in rain.',durationSeconds:8
  });
  const second=await seedScene(page,project.id,{
    title:'Inside',prompt:'The woman walks past shelves in the old library.',durationSeconds:12
  });
  const model=await openLiveDirector(page);
  await attachProject(page,project);
  const instruction='Revise each existing Scene prompt to add a clearly visible small brass lantern casting warm amber light. Preserve the distinctive action and setting of each Scene; do not change titles or durations.';
  await reviseUsingRealModel(page,instruction);
  const saved=await story(page,project.id);
  expect(saved.sceneOrder).toEqual([first.id,second.id]);
  for(const scene of [first,second]) {
    const result=saved.scenes[scene.id];
    expect(result.prompt.trim()).toBeTruthy();
    expect(result.prompt).not.toBe(scene.prompt);
    expect(result.title).toBe(scene.title);
    expect(result.durationSeconds).toBe(scene.durationSeconds);
    expect(Object.keys(result.takes||{})).toHaveLength(0);
  }
  await page.reload();
  const restored=await story(page,project.id);
  for(const id of saved.sceneOrder)
    expect(restored.scenes[id].prompt).toBe(saved.scenes[id].prompt);
  await testInfo.attach('studio-live-revision-evidence',{body:Buffer.from(JSON.stringify({model,instruction,projectId:project.id,
    before:[first.prompt,second.prompt],
    after:saved.sceneOrder.map(id=>saved.scenes[id].prompt)},null,2)),contentType:'application/json'});
});

test('LIVE Revise Scenes — non-adjacent selection saves only chosen Scenes',async({page},testInfo)=>{
  const project=await seedProject(page,'Live Scoped Revision '+Date.now(),{
    concept:'Three successive moments at a busy station.',style:'Naturalistic cinema.'
  });
  const first=await seedScene(page,project.id,{
    title:'Arrival',prompt:'A traveler enters the station carrying a navy suitcase.',durationSeconds:8
  });
  const middle=await seedScene(page,project.id,{
    title:'Waiting',prompt:'The traveler waits silently on a wooden bench.',durationSeconds:8
  });
  const last=await seedScene(page,project.id,{
    title:'Departure',prompt:'The traveler boards a departing train.',durationSeconds:8
  });
  const model=await openLiveDirector(page);
  await attachProject(page,project);
  await page.locator('#director-studio-actions-toggle').click();
  await page.locator('[data-studio-tool="revision"]').click();
  const controls=page.locator('#director-studio-revision-scenes');
  await expect(controls.locator('input')).toHaveCount(3);
  await expect(page.locator('#director-studio-revision-selection-count')).toContainText('3 of 3');
  await controls.locator('input').nth(1).uncheck();
  await expect(page.locator('#director-studio-revision-selection-count')).toContainText('2 of 3');
  await expect(page.locator('#director-studio-revision-all')).not.toBeChecked();
  await page.locator('#director-studio-revision-preset').selectOption('');
  await page.locator('#director-studio-revision-fresh').uncheck();
  const instruction='In each selected Scene, add a distinctive bright red station clock clearly visible above the traveler. Preserve all other subject actions, Scene titles and durations.';
  await page.locator('#director-studio-revision-input').fill(instruction);
  await expect(page.locator('#director-chat-send')).toBeEnabled();
  await page.locator('#director-chat-send').click();
  await expect(page.locator('#director-studio-revision-status'))
    .toContainText('Scene revision completed.',{timeout:300000});
  const saved=await story(page,project.id);
  expect(saved.scenes[first.id].prompt).not.toBe(first.prompt);
  expect(saved.scenes[middle.id].prompt).toBe(middle.prompt);
  expect(saved.scenes[last.id].prompt).not.toBe(last.prompt);
  for (const scene of [first,middle,last]) {
    expect(saved.scenes[scene.id].title).toBe(scene.title);
    expect(saved.scenes[scene.id].durationSeconds).toBe(scene.durationSeconds);
    expect(Object.keys(saved.scenes[scene.id].takes||{})).toHaveLength(0);
  }
  await page.reload();
  const restored=await story(page,project.id);
  for (const scene of [first,middle,last])
    expect(restored.scenes[scene.id].prompt).toBe(saved.scenes[scene.id].prompt);
  await testInfo.attach('studio-live-scoped-revision-evidence',{
    body:Buffer.from(JSON.stringify({model,projectId:project.id,
      selected:[first.id,last.id],excluded:middle.id,instruction,
      before:[first.prompt,middle.prompt,last.prompt],
      after:[saved.scenes[first.id].prompt,saved.scenes[middle.id].prompt,saved.scenes[last.id].prompt]},null,2)),
    contentType:'application/json'
  });
});
