'use strict';
const {test,expect}=require('./test.cjs');
const {seedProject,seedScene,story,openProject,openDirector}=require('./helpers.cjs');

test('Flow 9 optional checkpoint — discover Coherence via current Director Revise Scenes mode without changing or generating',async({page})=>{
  const project=await seedProject(page,'Specialist utility '+Date.now());
  const scene=await seedScene(page,project.id,{
    title:'Quiet entrance',prompt:'A woman waits outside a quiet bookshop.',durationSeconds:8
  });
  await openDirector(page);
  await openProject(page,project.id);
  const mode=page.locator('#director-studio-composer-mode-select');
  await expect(mode).toBeVisible();
  await mode.selectOption('revision');
  await expect(page.locator('#director-studio-revision-controls')).toBeVisible();
  await page.locator('#director-studio-revision-preset').selectOption('coherence');
  await expect(page.locator('#director-chat-send')).toHaveText('Check Coherence');
  await expect(page.locator('#director-studio-revision-fresh')).not.toBeChecked();
  await mode.selectOption('conversation');
  await expect(page.locator('#director-chat-input')).toBeVisible();
  const persisted=await story(page,project.id);
  expect(persisted.scenes[scene.id].prompt).toBe('A woman waits outside a quiet bookshop.');
  expect(Object.keys(persisted.scenes[scene.id].takes)).toHaveLength(0);
});
