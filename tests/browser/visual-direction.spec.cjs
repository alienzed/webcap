'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,queueModel,observedModels,openDirector,seedProject,seedScene,openProject,story}=require('./helpers.cjs');

test('Visual Direction defaults to all Scenes and submits only explicitly selected Scenes',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'Visual Direction selection '+Date.now(),{
    concept:'A fashion film presents three distinct complete looks.',
    style:'Contemporary fashion editorial.',
    invariants:[{kind:'character',title:'Model',text:'The same adult model appears throughout.'}]
  });
  await openDirector(page);
  const first=await seedScene(page,project.id,{
    title:'First look',prompt:'The model wears a red jacket.',durationSeconds:8
  });
  const selected=await seedScene(page,project.id,{
    title:'Selected look',summary:'A complete relaxed denim look.',
    prompt:'The model walks toward camera in blue jeans.',durationSeconds:8
  });
  const third=await seedScene(page,project.id,{
    title:'Third look',prompt:'The model wears a silver evening dress.',durationSeconds:8
  });
  await openProject(page,project.id);

  await page.locator('#storyboard-director-tools-btn').click();
  const modal=page.locator('#storyboard-director-tools-modal');
  await expect(modal).toBeVisible();
  const selection=modal.locator('#storyboard-director-tools-scene-selection');
  const all=selection.locator('[data-revise-scene-all]');
  const sceneChecks=selection.locator('[data-revise-scene]');
  await expect(sceneChecks).toHaveCount(3);
  await expect(all).toBeChecked();
  for(let index=0;index<3;index++) await expect(sceneChecks.nth(index)).toBeChecked();

  await sceneChecks.nth(0).uncheck();
  await sceneChecks.nth(2).uncheck();
  await expect(all).not.toBeChecked();
  expect(await all.evaluate(node=>node.indeterminate)).toBe(true);
  await expect(sceneChecks.nth(1)).toBeChecked();

  await modal.locator('#storyboard-director-tools-preset').selectOption('visual_direction');
  await expect(modal.locator('#storyboard-director-tools-instruction')).toHaveValue('');
  await queueModel(request,{
    changed:true,
    prompt:'The model walks toward camera in a complete relaxed denim outfit, wearing a fitted cream knit top, blue jeans and white sneakers.'
  });
  await modal.locator('#storyboard-director-tools-run').click();

  await expect.poll(async()=> (await story(page,project.id)).scenes[selected.id].prompt)
    .toBe('The model walks toward camera in a complete relaxed denim outfit, wearing a fitted cream knit top, blue jeans and white sneakers.');
  const saved=await story(page,project.id);
  expect(saved.scenes[first.id].prompt).toBe('The model wears a red jacket.');
  expect(saved.scenes[third.id].prompt).toBe('The model wears a silver evening dress.');

  const calls=(await observedModels(request)).calls;
  expect(calls).toHaveLength(1);
  expect(calls[0].messages[0].role).toBe('system');
  expect(calls[0].messages[0].content).toContain('text-to-video model');
  expect(calls[0].messages[1].content).toContain('Selected look');
  expect(calls[0].messages[1].content).toContain('The model walks toward camera in blue jeans.');
  expect(calls[0].messages[1].content).not.toContain('First look');
  expect(calls[0].messages[1].content).not.toContain('Third look');
});
