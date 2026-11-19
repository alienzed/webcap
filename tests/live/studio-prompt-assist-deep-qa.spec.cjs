'use strict';
const {test,expect}=require('../browser/test.cjs');
const {openLiveDirector,seedProject,seedScene,story,openProject}=require('./helpers.cjs');

async function attachEvidence(info,name,value){
  await info.attach(name,{
    body:Buffer.from(JSON.stringify(value,null,2)),
    contentType:'application/json'
  });
}
async function waitForDirectorJob(page,jobId){
  let terminal;
  await expect.poll(async()=>{
    const response=await page.request.get('/fs/director/job?job='+encodeURIComponent(jobId));
    if(!response.ok())throw new Error('Director job poll failed: '+await response.text());
    terminal=(await response.json()).job;
    return ['completed','failed','cancelled','stopped','interrupted'].includes(String(terminal?.status||''));
  },{timeout:300000,intervals:[600,1200,2500]}).toBe(true);
  if(terminal.status!=='completed')
    throw new Error('Live Studio job '+terminal.status+': '+String(terminal.error||'No diagnostic'));
  return terminal;
}

test('LIVE Project Deep QA -> Prompt Assist: whole-project findings feed focused, composable Scene corrections',async({page},info)=>{
  test.setTimeout(600000);
  const model=await openLiveDirector(page);
  const project=await seedProject(page,'Live Prompt Assist Deep QA '+Date.now(),{
    concept:'A woman practices baseball batting in a quiet neighborhood park. The sequence follows one continuous practice session.',
    style:'Natural late-afternoon light, grounded observational camera.'
  });
  const first=await seedScene(page,project.id,{
    title:'The Practice',
    durationSeconds:10,
    prompt:'[00:00-00:03] A woman stands at home plate wearing a red baseball jacket, white shirt, blue jeans and white sneakers. She grips a wooden bat. The camera slowly moves closer.\n\n[00:03-00:07] She changes into a blue jacket and swings at the ball. The camera zooms tightly onto her hands and the bat.\n\n[00:07-00:10] She finishes the swing and resets. She is again wearing the red jacket. The ball is not clearly shown.'
  });
  const second=await seedScene(page,project.id,{
    title:'The Walk Away',
    durationSeconds:8,
    prompt:'[00:00-00:04] The same woman leaves the batting area wearing a red baseball jacket, white shirt, blue jeans and white sneakers. She carries the wooden bat over her shoulder.\n\n[00:04-00:08] She reaches the park gate and looks back toward the field. Keep her outfit and the bat unchanged.'
  });

  await openProject(page,project.id);
  await expect(page.locator('#storyboard-project-deep-qa-btn')).toBeVisible();
  await page.locator('#storyboard-project-deep-qa-btn').click();
  await expect(page.locator('#storyboard-project-deep-qa-modal')).toBeVisible({timeout:300000});
  const deepQa=await page.request.get('/fs/storyboard/deep-qa?storyId='+encodeURIComponent(project.id));
  expect(deepQa.ok()).toBeTruthy();
  const cached=await deepQa.json();
  expect(cached.current).toBe(true);
  expect(Array.isArray(cached.findings)).toBe(true);
  expect(cached.record.sourceSignature).toBeTruthy();
  for(const finding of cached.findings){
    expect([first.id,second.id]).toContain(finding.sceneId);
    expect(finding.problem).toBeTruthy();
    expect(finding.suggestedFix).toBeTruthy();
  }
  await attachEvidence(info,'live-project-deep-qa',{model,projectId:project.id,cache:cached});
  await page.locator('#storyboard-project-deep-qa-close').click();

  // Prompt Assist is a distinct one-Scene action. It may use current Deep QA
  // findings, but it also works independently of Deep QA.
  const assistButton=page.locator('.storyboard-scene[data-scene-id="'+first.id+'"] [data-prompt-assist-open]');
  await expect(assistButton).toBeVisible();
  await assistButton.click();
  await expect(page.locator('#storyboard-prompt-assist-modal')).toBeVisible({timeout:300000});
  const source=await page.locator('#storyboard-prompt-assist-source').textContent();
  expect(source).toContain('red baseball jacket');
  const cards=page.locator('#storyboard-prompt-assist-findings .storyboard-assist-finding');
  const count=await cards.count();
  const savedBefore=await story(page,project.id);
  expect(savedBefore.scenes[first.id].prompt).toBe(source);

  if(count){
    const card=cards.first();
    const target=await card.locator('textarea').nth(0).inputValue();
    const replacement=await card.locator('[data-assist-replacement]').inputValue();
    expect(target).toBeTruthy();
    expect(replacement).toBeTruthy();
    expect(source.split(target)).toHaveLength(2);
    await card.getByRole('button',{name:'Apply correction'}).click();
    await expect(card.getByRole('button',{name:'Applied'})).toBeDisabled({timeout:30000});
    const savedAfter=await story(page,project.id);
    expect(savedAfter.scenes[first.id].prompt).toContain(replacement);
    expect(savedAfter.scenes[first.id].previousPrompt).toBe(source);
    expect(savedAfter.scenes[second.id].prompt).toBe(savedBefore.scenes[second.id].prompt);
    const stale=await page.request.get('/fs/storyboard/deep-qa?storyId='+encodeURIComponent(project.id));
    expect((await stale.json()).current).toBe(false);
  } else {
    // A model may correctly find no actionable patch; that must remain a
    // successful no-op and must never mutate the saved prompt.
    expect((await story(page,project.id)).scenes[first.id].prompt).toBe(source);
  }

  await attachEvidence(info,'live-prompt-assist',{
    model,projectId:project.id,sceneId:first.id,sourcePrompt:source,
    suggestionCount:count,
    suggestions:await cards.allTextContents(),
    saved:(await story(page,project.id)).scenes[first.id]
  });
});
