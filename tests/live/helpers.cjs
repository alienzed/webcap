'use strict';
const {expect}=require('../browser/test.cjs');
const {freshDirectorSession,story,stories,seedProject,seedScene,openProject,reopenDirectorIfClosed}=require('../browser/helpers.cjs');

// Reuses the deterministic suite's browser/routes/data helpers. The only
// difference is that the real Director model, not the controlled endpoint,
// authors each response.
async function openLiveDirector(page){
  await freshDirectorSession(page);
  await page.goto('/');
  await page.locator('#activity-storyboard-btn').click();
  await page.locator('#director-chat-rail-btn').click();
  const studio=page.locator('[data-assistant-mode="storyboard"]');
  if(await studio.isVisible()) await studio.click();
  await expect(page.locator('#director-chat-input')).toBeVisible();
  const select=page.locator('#app-header-director-model');
  await expect.poll(async()=>{
    const options=await select.locator('option').evaluateAll(nodes=>nodes.map(node=>node.value).filter(Boolean));
    return options.length;
  },{message:'Real configured Director models are not available'}).toBeGreaterThan(0);
  const options=await select.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value).filter(Boolean));
  const wanted=process.env.WEBCAP_TEST_DIRECTOR_MODEL;
  if(wanted && !options.includes(wanted))
    throw new Error('Configured WEBCAP_TEST_DIRECTOR_MODEL not listed by WebCap: '+wanted+
      '; available IDs: '+options.join(', '));
  await select.selectOption(wanted||await select.inputValue()||options[0]);
  const selected=await select.inputValue();
  expect(selected).toBeTruthy();
  console.log('Live Studio Director model:',selected);
  return selected;
}
async function attachProject(page,project){
  await openProject(page,project.id);
  await reopenDirectorIfClosed(page);
  const mode=page.locator('#director-studio-composer-mode-select');
  if(await mode.isVisible() && await mode.inputValue()!=='conversation')
    await mode.selectOption('conversation');
  const attach=page.locator('#director-studio-attach-current');
  if(await attach.isVisible()) await attach.click();
  await expect(page.locator('#director-chat-title')).toContainText(project.title);
}
async function sendLive(page,instruction){
  await page.locator('#director-chat-input').fill(instruction);
  await expect(page.locator('#director-chat-send')).toBeEnabled();
  await page.locator('#director-chat-send').click();
  // Completion is authoritative browser evidence; don't depend on generated
  // wording or an arbitrary number of elapsed seconds.
  await expect(page.locator('#director-chat-progress')).toBeHidden({timeout:180000});
}
async function actualReply(page){
  const texts=await page.locator('#director-chat-messages').innerText();
  expect(texts.trim().length).toBeGreaterThan(0);
  return texts;
}
async function addEvidence(testInfo,page,model,request,additional={}){
  await testInfo.attach('studio-live-model-and-observed-reply',{
    body:Buffer.from(JSON.stringify({
      model,request,reply:await actualReply(page),...additional
    },null,2)),contentType:'application/json'
  });
}
async function latestSceneReview(page){
  const action=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  await expect(action).toBeVisible({timeout:180000});
  await action.click();
  await expect(page.locator('#studio-scenes-review')).toBeVisible();
  return page.locator('#studio-scenes-rows .studio-scenes-row');
}
module.exports={openLiveDirector,attachProject,sendLive,actualReply,addEvidence,latestSceneReview,story,stories,seedProject,seedScene,openProject,reopenDirectorIfClosed};
