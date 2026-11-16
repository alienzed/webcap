'use strict';
const {test,expect}=require('../browser/test.cjs');
const {openLiveDirector,attachProject,story,seedProject,seedScene,addEvidence}=require('./helpers.cjs');

async function reviseUsingRealModel(page,instruction) {
  const mode=page.locator('#director-studio-composer-mode-select');
  await expect(mode).toBeVisible();
  await mode.selectOption('revision');
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
  await addEvidence(testInfo,page,model,instruction,{projectId:project.id,sceneId:scene.id,before:scene.prompt,after:result.prompt});
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
  await addEvidence(testInfo,page,model,instruction,{projectId:project.id,
    before:[first.prompt,second.prompt],
    after:saved.sceneOrder.map(id=>saved.scenes[id].prompt)});
});
