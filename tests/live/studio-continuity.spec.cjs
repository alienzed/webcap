'use strict';
const {test,expect}=require('../browser/test.cjs');
const {waitForLiveJob,openLiveDirector,attachProject,sendLive,addEvidence,latestSceneReview,
       story,stories,seedProject,openProject,reopenDirectorIfClosed}=require('./helpers.cjs');

test('Live Flow 5 — Director Project attachment survives opening another Project',async({page},testInfo)=>{
  const a=await seedProject(page,'Director A '+Date.now(),{style:'Cool blue light.'});
  const b=await seedProject(page,'Director B '+Date.now(),{style:'Red neon light.'});
  const model=await openLiveDirector(page);
  await attachProject(page,a);
  await openProject(page,b.id);
  await expect(page.locator('#storyboard-story-title')).toHaveValue(b.title);
  await expect(page.locator('#director-chat-title')).toContainText(a.title);
  const instruction='Change only the attached Project visual atmosphere to soft silver moonlight; present the Project change for review.';
  await sendLive(page,instruction);
  const action=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  await expect(action).toContainText(/Review authored Project/i);
  await page.locator('#studio-dw-suggestions select[aria-label="Project material destination"]').selectOption(a.id);
  await action.click();
  await expect(page.locator('#studio-brief-review')).toBeVisible();
  const updated=await page.locator('#studio-brief-style').inputValue();
  expect(updated.trim()).toBeTruthy();
  await page.locator('#studio-brief-apply').click();
  await expect.poll(async()=> (await story(page,a.id)).style).toBe(updated);
  expect((await story(page,b.id)).style).toBe(b.style);
  await addEvidence(testInfo,page,model,instruction,
    {attachedProjectId:a.id,openEditorProjectId:b.id,savedA:await story(page,a.id),savedB:await story(page,b.id)});
});

test('Live Flow 6 — separate real authored replies retain distinct Scene review drafts',async({page},testInfo)=>{
  const project=await seedProject(page,'Live Separate Drafts '+Date.now());
  const model=await openLiveDirector(page);
  await attachProject(page,project);
  const firstInstruction='Author one new Scene for review: a bookseller lights a blue lantern, lasting eight seconds. Supply one complete Scene prompt and title.';
  await sendLive(page,firstInstruction);
  const firstAction=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  await expect(firstAction).toBeVisible({timeout:10000});
  await expect(firstAction).toContainText(/Review authored Scene|Create Scene\(s\) · Review/i,{timeout:1000});
  await firstAction.click();
  await expect(page.locator('#studio-scenes-review')).toBeVisible();
  const row=page.locator('#studio-scenes-rows .studio-scenes-row').first();
  const firstPrompt=await row.locator('[data-field="prompt"]').inputValue();
  expect(firstPrompt.trim()).toBeTruthy();
  const modified=firstPrompt+' The lantern flickers.';
  await row.locator('[data-field="prompt"]').fill(modified);
  await page.locator('#studio-scenes-close').click();
  const secondInstruction='Author one DIFFERENT new Scene for review: a visitor unfolds a green map, lasting ten seconds. Do not replace the previous Scene proposal.';
  await sendLive(page,secondInstruction);
  const secondAction=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  await expect(secondAction).toBeVisible({timeout:10000});
  await expect(secondAction).toContainText(/Review authored Scene|Create Scene\(s\) · Review/i,{timeout:1000});
  await secondAction.click();
  await expect(page.locator('#studio-scenes-review')).toBeVisible();
  const secondPrompt=await row.locator('[data-field="prompt"]').inputValue();
  expect(secondPrompt.trim()).toBeTruthy();
  expect(secondPrompt).not.toBe(modified);
  await page.locator('#studio-scenes-close').click();
  const firstReplyAction=page.locator('#director-chat-messages .studio-dw-suggestion-action').first();
  await expect(firstReplyAction).toBeVisible();
  await firstReplyAction.click();
  await expect(page.locator('#studio-scenes-review')).toBeVisible();
  await expect(row.locator('[data-field="prompt"]')).toHaveValue(modified);
  expect((await story(page,project.id)).sceneOrder).toHaveLength(0);
  await addEvidence(testInfo,page,model,[firstInstruction,secondInstruction],
    {projectId:project.id,firstPrompt,secondPrompt,editedUnsaved:modified});
});

test('Live Flow 7 — recover an edited unsaved real Scene after leaving and returning',async({page},testInfo)=>{
  const project=await seedProject(page,'Live Resume '+Date.now());
  const other=await seedProject(page,'Live Other '+Date.now());
  const model=await openLiveDirector(page);
  await attachProject(page,project);
  const instruction='Author one new Scene for review with a complete prompt about opening a small bookshop on a snowy morning; use eight seconds.';
  await sendLive(page,instruction);
  const rows=await latestSceneReview(page);
  expect(await rows.count()).toBeGreaterThan(0);
  const prompt=rows.first().locator('[data-field="prompt"]');
  const text=await prompt.inputValue();
  expect(text.trim()).toBeTruthy();
  const edited=text+' The shop bell rings twice.';
  await prompt.fill(edited);
  await page.locator('#studio-scenes-close').click();
  expect((await story(page,project.id)).sceneOrder).toHaveLength(0);
  await openProject(page,other.id);
  await openProject(page,project.id);
  const review=page.locator('#director-chat-messages .studio-dw-suggestion-action').last();
  await expect(review).toBeVisible();
  await review.click();
  await expect(page.locator('#studio-scenes-review')).toBeVisible();
  await expect(page.locator('#studio-scenes-rows .studio-scenes-row').first()
    .locator('[data-field="prompt"]')).toHaveValue(edited);
  await page.locator('#studio-scenes-apply').click();
  await expect.poll(async()=> (await story(page,project.id)).sceneOrder.length).toBeGreaterThan(0);
  const saved=await story(page,project.id);
  expect(saved.scenes[saved.sceneOrder[0]].prompt).toBe(edited);
  expect((await story(page,other.id)).sceneOrder).toHaveLength(0);
  await page.reload();
  expect((await story(page,project.id)).scenes[saved.sceneOrder[0]].prompt).toBe(edited);
  await addEvidence(testInfo,page,model,instruction,{projectId:project.id,sceneId:saved.sceneOrder[0],edited});
});

test('Live Flow 8 — slash-inserted Studio Block reaches the real Director model as edited text',async({page},testInfo)=>{
  const before=(await stories(page)).map(x=>x.id);
  const model=await openLiveDirector(page);
  await expect(page.locator('#studio-blocks-open')).toBeVisible();
  await page.locator('#studio-blocks-open').click();
  await page.locator('#studio-blocks-new').click();
  const name='Acceptance Lamp Block '+Date.now();
  await page.locator('#studio-blocks-title').fill(name);
  await page.locator('#studio-blocks-content').fill('One amber lamp illuminates a stone doorway.');
  await page.locator('#studio-blocks-save').click();
  await expect(page.locator('#studio-blocks-status')).toHaveText('Saved.');
  await page.locator('#studio-blocks-close').click();
  await reopenDirectorIfClosed(page);
  const composer=page.locator('#director-chat-input');
  await composer.fill('Discuss: /Acceptance  and mention how to frame the shot.');
  await composer.evaluate(node=>{
    const pos=node.value.indexOf('  and mention');node.setSelectionRange(pos,pos);
    node.dispatchEvent(new Event('input',{bubbles:true}));
  });
  const option=page.locator('#studio-blocks-slash').getByRole('option',{name:/Acceptance Lamp Block/});
  await expect(option).toBeVisible();
  await option.click();
  const sent=await composer.inputValue();
  expect(sent).toContain('One amber lamp illuminates a stone doorway.');
  expect(sent).toContain('and mention how to frame the shot.');
  await waitForLiveJob(page,()=>page.locator('#director-chat-send').click());
  await expect.poll(async()=> (await page.locator('#director-chat-messages').innerText()).length,
    {timeout:180000}).toBeGreaterThan(sent.length);
  expect((await stories(page)).map(x=>x.id).sort()).toEqual(before.sort());
  await addEvidence(testInfo,page,model,sent,{block:name,noProjectMutation:true});
});
