'use strict';
const {test,expect}=require('../browser/test.cjs');
const {freshDirectorSession,story,stories,seedProject,seedScene,openProject,reopenDirectorIfClosed,openWrite}=require('../browser/helpers.cjs');

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
  const tools=page.locator('#studio-dw-open-tools');
  if(await tools.getAttribute('aria-expanded')!=='true') await tools.click();
  const attach=page.locator('#director-studio-attach-current');
  if(await attach.isVisible()) await attach.click();
  await expect(page.locator('#director-chat-title')).toContainText(project.title);
}
async function approveOverview(page,projectId){
  await page.locator('#director-chat-context-approve').click();
  await page.locator('#studio-dw-read-project').selectOption(projectId);
  const selection=page.locator('#studio-dw-read-selection');
  if(await selection.getAttribute('open')===null) await selection.locator('summary').click();
  await page.locator('#studio-dw-project-fields input[data-group-select]').first().check();
  for(const toggle of await page.locator('#studio-dw-scene-fields input[data-group-select]').all())
    await toggle.uncheck();
  await page.locator('#studio-dw-read-send').click();
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
  await test.info().attach('director-job-'+payload.job.jobId,{
    body:Buffer.from(JSON.stringify(payload.job,null,2)),contentType:'application/json'
  });
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
  await reopenDirectorIfClosed(page);
  await expect(page.locator('#director-chat-messages')).not.toBeEmpty();
  const texts=await page.locator('#director-chat-messages').textContent();
  expect(texts.trim().length).toBeGreaterThan(0);
  return texts;
}
async function addEvidence(testInfo,page,model,request,additional={}){
  await testInfo.attach('studio-live-model-and-observed-reply',{
    body:Buffer.from(JSON.stringify({
      model,request,reply:additional.coherenceReview || await actualReply(page),...additional
    },null,2)),contentType:'application/json'
  });
}

// A real explicit Write is separate from ordinary chat and starts one
// operation-scoped model request. This does not infer authoring from chat prose.
async function writeLive(page,options){
  await openWrite(page,options);
  await waitForLiveJob(page,()=>page.locator('#studio-dw-write-prepare').click());
}
function observeLiveCalls(page){
  const requests=[], jobs=[];
  page.on('request',request=>{
    if(request.method()!=='POST' || new URL(request.url()).pathname!=='/fs/director/chat')return;
    try{requests.push(request.postDataJSON());}catch{}
  });
  page.on('response',async response=>{
    if(!response.ok() || new URL(response.url()).pathname!=='/fs/director/job')return;
    try{
      const job=(await response.json()).job;
      if(job?.status==='completed' && job.result?.text)
        jobs.push({raw:job.result.text,finishReason:job.result.finishReason,jobId:job.jobId});
    }catch{}
  });
  return {requests,jobs,async last(){
    await expect.poll(()=>jobs.length,{timeout:60000}).toBeGreaterThan(0);
    return jobs.at(-1);
  }};
}
module.exports={writeLive,observeLiveCalls,waitForLiveJob,openLiveDirector,attachProject,approveOverview,sendLive,actualReply,addEvidence,story,stories,seedProject,seedScene,openProject,reopenDirectorIfClosed};
