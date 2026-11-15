'use strict';
const {test,expect}=require('./test.cjs');
const {seedProject,seedScene,story,openProject}=require('./helpers.cjs');

test('Flow 9 optional checkpoint — discover Coherence / Revise & Generate without changing or generating',async({page})=>{
  const project=await seedProject(page,'Specialist utility '+Date.now());
  const scene=await seedScene(page,project.id,{
    title:'Quiet entrance',prompt:'A woman waits outside a quiet bookshop.',durationSeconds:8
  });
  await page.goto('/');
  await page.locator('#activity-storyboard-btn').click();
  await openProject(page,project.id);
  await page.locator('#storyboard-scene-progression [data-scene-id="'+scene.id+'"]').click();
  await expect(page.locator('#storyboard-director-tools-btn')).toBeVisible();
  await page.locator('#storyboard-director-tools-btn').click();
  await expect(page.locator('#storyboard-director-tools-modal')).toBeVisible();
  await expect(page.locator('#storyboard-director-tools-preset')).toBeVisible();
  await page.locator('#storyboard-director-tools-preset').selectOption('coherence');
  await expect(page.locator('#storyboard-director-tools-generate-takes')).not.toBeChecked();
  await expect(page.locator('#storyboard-director-tools-run')).toBeVisible();
  await page.locator('#storyboard-director-tools-cancel').click();
  await expect(page.locator('#storyboard-director-tools-modal')).toBeHidden();
  const persisted=await story(page,project.id);
  expect(persisted.scenes[scene.id].prompt).toBe('A woman waits outside a quiet bookshop.');
  expect(persisted.scenes[scene.id].takes||[]).toHaveLength(0);
});
