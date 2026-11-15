'use strict';
const {test,expect}=require('../browser/test.cjs');
const {openLiveDirector,attachProject,addEvidence,story,seedProject,seedScene}=require('./helpers.cjs');

test('Live optional Flow 9 — real Coherence review proposes changes without silently saving or generating Takes',async({page},testInfo)=>{
  const project=await seedProject(page,'Live Coherence '+Date.now());
  const first=await seedScene(page,project.id,{
    title:'First street',prompt:'An explorer approaches a library at dawn.',durationSeconds:8
  });
  const second=await seedScene(page,project.id,{
    title:'Second street',prompt:'The same explorer walks through the library at dusk.',durationSeconds:8
  });
  const model=await openLiveDirector(page);
  await attachProject(page,project);
  const mode=page.locator('#director-studio-composer-mode-select');
  await expect(mode).toBeVisible();
  await mode.selectOption('revision');
  await page.locator('#director-studio-revision-preset').selectOption('coherence');
  await expect(page.locator('#director-studio-revision-fresh')).not.toBeChecked();
  await expect(page.locator('#director-chat-send')).toHaveText('Check Coherence');
  await page.locator('#director-chat-send').click();
  const results=page.getByRole('dialog',{name:'Check Coherence results'});
  await expect(results).toBeVisible({timeout:180000});
  await expect(results).toContainText(/Scenes reviewed/);
  const beforeApply=await story(page,project.id);
  expect(beforeApply.scenes[first.id].prompt).toBe('An explorer approaches a library at dawn.');
  expect(beforeApply.scenes[second.id].prompt).toBe('The same explorer walks through the library at dusk.');
  expect(beforeApply.scenes[first.id].takes||[]).toHaveLength(0);
  expect(beforeApply.scenes[second.id].takes||[]).toHaveLength(0);
  await addEvidence(testInfo,page,model,'Check Coherence via the existing revision composer',
    {coherenceReview:await results.innerText(),projectId:project.id});
  await results.getByRole('button',{name:'Close / Discard'}).click();
  const unchanged=await story(page,project.id);
  expect(unchanged.scenes[first.id].prompt).toBe(beforeApply.scenes[first.id].prompt);
  expect(unchanged.scenes[second.id].prompt).toBe(beforeApply.scenes[second.id].prompt);
});
