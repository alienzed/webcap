'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,observedModels,openDirector,seedProject,seedScene,openProject,story}=require('./helpers.cjs');

// The old Visual Direction modal was retired. The Studio toolbar now enters
// the Director's revision mode for the current Project. Verify that actual
// user path, rather than clicking controls in a hidden legacy modal.
test('Studio Scene Revision toolbar opens the current Director controls without editing Scenes',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'Revision entry '+Date.now(),{
    concept:'A fashion film features three distinctly styled looks.',
    style:'Contemporary fashion editorial.'
  });
  const originals=[
    await seedScene(page,project.id,{
      title:'First look',prompt:'The performer wears a red jacket.',durationSeconds:8
    }),
    await seedScene(page,project.id,{
      title:'Second look',prompt:'The performer walks in blue jeans.',durationSeconds:8
    }),
    await seedScene(page,project.id,{
      title:'Third look',prompt:'The performer wears a silver dress.',durationSeconds:8
    })
  ];
  await openDirector(page);
  await openProject(page,project.id);
  // The unpinned drawer overlays the Studio toolbar when open.
  await page.locator('#director-chat-close').click();
  const launch=page.locator('#storyboard-director-tools-btn');
  await expect(launch).toBeEnabled();
  await launch.click();
  await expect(page.locator('#director-chat-drawer')).toBeVisible();
  await expect(page.locator('#director-studio-composer-mode-select')).toHaveValue('revision');
  await expect(page.locator('#director-studio-revision-controls')).toBeVisible();
  await expect(page.locator('#director-studio-revision-target')).toContainText('all 3 Scenes');
  await expect(page.locator('#director-studio-revision-preset')).toHaveValue('');
  await expect(page.locator('#director-studio-revision-fresh')).not.toBeChecked();

  const instruction='Preserve the first and third outfits, but revise the second.';
  await page.locator('#director-studio-revision-input').fill(instruction);
  await expect(page.locator('#director-studio-revision-input')).toHaveValue(instruction);
  // Selecting the revision mode and editing instructions cannot run a model
  // or modify saved Scenes without the explicit author action.
  expect((await observedModels(request)).calls).toHaveLength(0);
  const saved=await story(page,project.id);
  expect(saved.sceneOrder).toEqual(originals.map(scene=>scene.id));
  for(const scene of originals) expect(saved.scenes[scene.id].prompt).toBe(scene.prompt);
});
