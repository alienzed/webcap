'use strict';
const {test,expect}=require('../browser/test.cjs');
const {openLiveDirector,seedProject,seedScene,story,openProject}=require('./helpers.cjs');

async function attachEvidence(info,name,value){
  await info.attach(name,{
    body:Buffer.from(JSON.stringify(value,null,2)),
    contentType:'application/json'
  });
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
    prompt:'[00:00-00:04] The same woman leaves the batting area wearing a bright blue leather jacket, white shirt, blue jeans and white sneakers. She carries the wooden bat over her shoulder.\n\n[00:04-00:08] She reaches the park gate and looks back toward the field. Keep her outfit and the bat unchanged.'
  });

  await openProject(page,project.id);
  await expect(page.locator('#storyboard-project-deep-qa-btn')).toBeVisible();
  await page.locator('#storyboard-project-deep-qa-btn').click();
  await expect(page.locator('#storyboard-project-deep-qa-modal')).toBeVisible({timeout:300000});
  await expect.poll(async()=>{
    const response=await page.request.get('/fs/storyboard/deep-qa?storyId='+encodeURIComponent(project.id));
    const body=await response.json();
    return !!body.current;
  },{timeout:300000,intervals:[600,1200,2500]}).toBe(true);
  const deepQa=await page.request.get('/fs/storyboard/deep-qa?storyId='+encodeURIComponent(project.id));
  expect(deepQa.ok()).toBeTruthy();
  const cached=await deepQa.json();
  expect(cached.current).toBe(true);
  expect(Array.isArray(cached.findings)).toBe(true);
  expect(cached.findings.length).toBeGreaterThan(0);
  expect(cached.findings.some(item=>item.sceneId===first.id)).toBe(true);
  expect(cached.findings.some(item=>item.sceneId===second.id)).toBe(true);
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
  await expect(cards).toHaveCount(1);
  const position=page.locator('#storyboard-prompt-assist-position');
  await expect(position).toContainText('Finding 1 of');
  const total=Number((await position.innerText()).match(/Finding 1 of (\d+)/)?.[1] || 0);
  expect(total).toBeGreaterThan(0);
  const details=page.locator('#storyboard-prompt-assist-source-details');
  await expect(details).not.toHaveAttribute('open', '');
  await details.locator('summary').click();
  await expect(page.locator('#storyboard-prompt-assist-source')).toBeVisible();
  await details.locator('summary').click();
  const savedBefore=await story(page,project.id);
  expect(savedBefore.scenes[first.id].prompt).toBe(source);

  const card=cards.first();
  const target=await card.locator('textarea').nth(0).inputValue();
  const replacement=await card.locator('[data-assist-replacement]').inputValue();
  const originalFinding=await card.innerText();
  expect(target).toBeTruthy();
  expect(replacement).toBeTruthy();
  expect(source.split(target)).toHaveLength(2);
  if (total > 1) {
    await card.locator('[data-assist-replacement]').fill(replacement + ' [temporary draft]');
    await page.locator('#storyboard-prompt-assist-next').click();
    await expect(position).toContainText('Finding 2 of '+total);
    await expect(cards).toHaveCount(1);
    await page.locator('#storyboard-prompt-assist-prev').click();
    await expect(card.locator('[data-assist-replacement]')).toHaveValue(replacement + ' [temporary draft]');
    await card.locator('[data-assist-replacement]').fill(replacement);
    expect((await story(page,project.id)).scenes[first.id].prompt).toBe(source);
  }
  await card.getByRole('button',{name:'Apply correction'}).click();
  await expect(page.locator('#storyboard-prompt-assist-count'))
    .toContainText('1 of '+total+' applied',{timeout:30000});
  if (total > 1) {
    await expect(position).toContainText('Finding 2 of '+total);
    await page.locator('#storyboard-prompt-assist-prev').click();
    await expect(card.getByRole('button',{name:'Applied'})).toBeDisabled();
    await page.locator('#storyboard-prompt-assist-next').click();
  } else {
    await expect(card.getByRole('button',{name:'Applied'})).toBeDisabled();
  }
  const savedAfter=await story(page,project.id);
  expect(savedAfter.scenes[first.id].prompt).toContain(replacement);
  expect(savedAfter.scenes[first.id].previousPrompt).toBe(source);
  expect(savedAfter.scenes[second.id].prompt).toBe(savedBefore.scenes[second.id].prompt);
  const stale=await page.request.get('/fs/storyboard/deep-qa?storyId='+encodeURIComponent(project.id));
  expect((await stale.json()).current).toBe(false);

  await attachEvidence(info,'live-prompt-assist',{
    model,projectId:project.id,sceneId:first.id,sourcePrompt:source,
    suggestionCount:total,
    firstSuggestion:originalFinding,
    currentVisibleFinding:await cards.allTextContents(),
    saved:(await story(page,project.id)).scenes[first.id]
  });
});

test('LIVE standalone Prompt Assist: one focused suggestion, optional navigation, and explicit saved correction',async({page},info)=>{
  test.setTimeout(600000);
  const model=await openLiveDirector(page);
  const project=await seedProject(page,'Live Standalone Prompt Assist '+Date.now(),{
    concept:'An intimate yoga class in a small sunlit studio.',
    style:'Observational camera and natural light.'
  });
  const scene=await seedScene(page,project.id,{
    title:'Arriving on the mats',durationSeconds:12,
    prompt:'[00:00-00:04] Four yoga mats are already arranged neatly on the floor. Two students enter and place two new yoga mats directly on top of the existing mats. The camera observes the preparation.\n\n[00:04-00:08] The two students start a carefully balanced pose, but the camera frames only their faces and keeps their hands out of view.\n\n[00:08-00:12] The students remain in the studio. The mat arrangement suddenly returns to the original four mats with no explanation.'
  });
  await openProject(page,project.id);
  const before=(await story(page,project.id)).scenes[scene.id].prompt;
  const button=page.locator('.storyboard-scene[data-scene-id="'+scene.id+'"] [data-prompt-assist-open]');
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.locator('#storyboard-prompt-assist-modal')).toBeVisible({timeout:300000});
  const position=page.locator('#storyboard-prompt-assist-position');
  const cards=page.locator('#storyboard-prompt-assist-findings .storyboard-assist-finding');
  await expect(cards).toHaveCount(1);
  const total=Number((await position.innerText()).match(/Finding 1 of (\d+)/)?.[1] || 0);
  expect(total,'Real Prompt Assist produced no actionable exact-excerpt suggestions').toBeGreaterThan(0);
  await expect(page.locator('#storyboard-prompt-assist-source')).toHaveText(before);
  await expect(page.locator('#storyboard-prompt-assist-source-details')).not.toHaveAttribute('open','');

  const firstReplacement=await cards.locator('[data-assist-replacement]').inputValue();
  const exactExcerpt=await cards.locator('textarea').first().inputValue();
  expect(before.split(exactExcerpt)).toHaveLength(2);
  if(total>1){
    await page.locator('#storyboard-prompt-assist-next').click();
    await expect(cards).toHaveCount(1);
    await expect(position).toHaveText('Finding 2 of '+total);
    await page.locator('#storyboard-prompt-assist-prev').click();
    await expect(position).toHaveText('Finding 1 of '+total);
    expect((await story(page,project.id)).scenes[scene.id].prompt).toBe(before);
  }
  await cards.getByRole('button',{name:'Apply correction'}).click();
  await expect(page.locator('#storyboard-prompt-assist-count'))
    .toContainText('1 of '+total+' applied',{timeout:30000});
  const saved=(await story(page,project.id)).scenes[scene.id];
  expect(saved.prompt).toContain(firstReplacement);
  expect(saved.previousPrompt).toBe(before);
  if(total>1){
    await expect(position).toHaveText('Finding 2 of '+total);
    await page.locator('#storyboard-prompt-assist-prev').click();
  }
  await expect(cards.getByRole('button',{name:'Applied'})).toBeDisabled();
  await attachEvidence(info,'live-standalone-prompt-assist-focus',{
    model,projectId:project.id,sceneId:scene.id,before,after:saved.prompt,
    suggestionCount:total,firstTarget:exactExcerpt,firstReplacement
  });
});
