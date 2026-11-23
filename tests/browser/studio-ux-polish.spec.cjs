'use strict';
const {test,expect}=require('./test.cjs');
const {openDirector,seedProject,seedScene,resetModel,queueModel,observedModels,say}=require('./helpers.cjs');

test('Read cards preserve exact saved and outbound context, disclosures, and action feedback',async({page,request})=>{
  await resetModel(request);
  await openDirector(page);
  const project=await seedProject(page,'Lighthouse context',{concept:'A keeper watches for an amber signal.'});
  await page.locator('#director-chat-context-approve').click();
  await page.locator('#studio-dw-read-project').selectOption(project.id);
  await page.locator('#studio-dw-read-send').click();
  const card=page.locator('.director-chat-protocol-card').last();
  await expect(card).toContainText('Read Lighthouse context · Overview');
  const details=card.locator('details');
  await expect(details).not.toHaveAttribute('open','');
  await expect(card.locator('pre')).toBeHidden();
  await details.locator('summary').click();
  const exact=await card.locator('pre').textContent();
  expect(exact).toContain('[WEBCAP EXPLICIT READ — SAVED SNAPSHOT]');
  expect(exact).toContain(project.concept);
  const handle=await details.elementHandle();
  await page.evaluate(()=>window.refreshAssistantModes());
  expect(await handle.evaluate(node=>node.isConnected&&node.open)).toBe(true);
  await page.locator('#director-studio-actions-toggle').click();
  await page.locator('[data-studio-tool="scene"]').click();
  await expect(page.locator('#studio-dw-status')).toBeHidden();
  await page.locator('#studio-dw-close-actions').click();
  await queueModel(request,'The amber signal is a clear visual anchor.');
  await say(page,'Discuss the signal briefly.');
  await expect(page.locator('#director-chat-messages')).toContainText('The amber signal is a clear visual anchor.');
  const observed=await observedModels(request);
  expect(observed.calls.at(-1).messages.some(message=>message.content===exact)).toBe(true);
  const chats=await page.request.get('/fs/director/chats').then(r=>r.json());
  const saved=await page.request.get('/fs/director/chats/'+chats.activeByMode.storyboard).then(r=>r.json());
  expect(saved.chat.messages.some(message=>message.content===exact)).toBe(true);
  await details.locator('summary').click();
  await page.screenshot({path:'test-results/studio-ux-conversation.jpg'});
});

test('historical saves are compact and project mismatch stays explicit across composer modes',async({page})=>{
  const a=await seedProject(page,'Conversation Project');
  const b=await seedProject(page,'Open Project');
  await seedScene(page,b.id,{title:'Open Scene',prompt:'A complete prompt.',durationSeconds:8});
  const created=await page.request.post('/fs/director/chats',{data:{mode:'storyboard'}}).then(r=>r.json());
  const receipt='Saved: Scene changes. Reviewed values are now authoritative.\n[WEBCAP APPLIED FIELD VALUES]\n'+
    JSON.stringify({operation:'scene.update',projectId:a.id,fields:{prompt:'Original saved prompt'}})+'\n[END WEBCAP APPLY]';
  const saved=await page.request.put('/fs/director/chats/'+created.chat.id,{data:{
    expectedRevision:created.chat.revision,title:'Saved: Scene changes. Reviewed values are now authoritative. [WEBCAP APP',
    draft:'',messages:[{role:'user',content:receipt}],storyAccess:{storyId:a.id,label:a.title}
  }});
  expect(saved.ok()).toBeTruthy();
  await page.goto('/#/storyboard?story='+b.id);
  await page.locator('#director-chat-rail-btn').click();
  const studio=page.locator('[data-assistant-mode="storyboard"]');
  if(await studio.isVisible()) await studio.click();
  await expect(page.locator('#director-chat-title')).toHaveText(a.title);
  const mismatch=page.locator('#director-studio-flow-target');
  await expect(mismatch).toBeVisible();
  await expect(mismatch).toContainText('Conversation: Conversation Project · Open: Open Project');
  await expect(page.locator('#studio-dw-read-panel')).toBeHidden();
  await expect(page.locator('.director-chat-save-receipt .director-chat-protocol-summary')).toHaveText('Saved Scene changes');
  await expect(page.locator('.director-chat-save-receipt pre')).toBeHidden();
  await page.locator('.director-chat-save-receipt summary').click();
  await expect(page.locator('.director-chat-save-receipt pre')).toHaveText(receipt);
  await page.locator('#director-studio-actions-toggle').click();
  await page.locator('[data-studio-tool="revision"]').click();
  await expect(page.locator('#director-chat-title')).toHaveText('Revise Scenes');
  await page.locator('#director-studio-composer-mode-select').selectOption('conversation');
  await expect(page.locator('#director-chat-title')).toHaveText(a.title);
  await page.locator('#director-studio-attach-current').click();
  await expect(page.locator('#director-chat-title')).toHaveText(b.title);
  await expect(mismatch).toBeHidden();
  await expect(page.locator('#storyboard-story-title')).toHaveValue(b.title);
});

test('Project identity and tools fit desktop and medium layouts; saved comparisons use saved labels',async({page})=>{
  const project=await seedProject(page,'Lighthouse Signal — A Long Project Title');
  await seedScene(page,project.id,{title:'Signal Received',prompt:'A keeper watches the sea.',durationSeconds:8});
  for(const width of [1440,1100]) {
    await page.setViewportSize({width,height:1000});
    await page.goto('/#/storyboard?story='+project.id);
    const title=page.locator('#storyboard-story-title');
    await expect(title).toHaveValue(project.title);
    const titleBox=await title.boundingBox();
    const statusBox=await page.locator('#storyboard-story-status').boundingBox();
    expect(titleBox.width).toBeGreaterThan(240);
    expect(statusBox.y).toBeGreaterThan(titleBox.y);
    expect(await title.evaluate(node=>parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(24);
    const overflow=await page.locator('.storyboard-scene-workspace').evaluate(node=>node.scrollWidth-node.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
    const bar=page.locator('#storyboard-project-tool-bar');
    expect(await bar.evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(2);
    await page.screenshot({path:'test-results/studio-ux-layout-'+width+'.jpg'});
  }
  await page.evaluate(()=>window.openStoryboardPromptChanges('Old prompt','New prompt','Signal Received'));
  await expect(page.locator('#storyboard-workshop-diff-heading')).toHaveText('Prompt · saved changes');
  await expect(page.locator('#storyboard-workshop-review-apply')).toBeHidden();
});
