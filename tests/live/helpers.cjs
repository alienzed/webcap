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
async function waitForLiveJob(page,trigger){
  // Follow the real WebCap inference job, not elapsed time, model prose,
  // or a suggestion left over from an earlier reply.
  const terminal=page.waitForResponse(async response=>{
    if(!response.url().includes('/fs/director/job?')) return false;
    try {
      const payload=await response.json();
      return ['completed','failed','cancelled','stopped','interrupted']
        .includes(String(payload.job?.status||''));
    } catch { return false; }
  },{timeout:300000});
  await trigger();
  const response=await terminal;
  const payload=await response.json();
  if(payload.job.status!=='completed')
    throw new Error('Real Director job '+payload.job.status+': '+String(payload.job.error||'No diagnostic provided'));
  await expect(page.locator('#director-chat-progress')).toBeHidden({timeout:20000});
}
async function sendLive(page,instruction){
  const composer=page.locator('#director-chat-input');
  await composer.fill(instruction);
  await expect(page.locator('#director-chat-send')).toBeEnabled();
  await waitForLiveJob(page,()=>page.locator('#director-chat-send').click());
}
async function actualReply(page){
  const texts=await page.locator('#director-chat-messages').textContent();
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
  await expect(action).toContainText(/Review authored Scene/i);
  await action.click();
  await expect(page.locator('#studio-scenes-review')).toBeVisible();
  return page.locator('#studio-scenes-rows .studio-scenes-row');
}
module.exports={waitForLiveJob,openLiveDirector,attachProject,sendLive,actualReply,addEvidence,latestSceneReview,story,stories,seedProject,seedScene,openProject,reopenDirectorIfClosed};
