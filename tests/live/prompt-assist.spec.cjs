'use strict';
const {test,expect}=require('../browser/test.cjs');
const {openLiveDirector,openProject,seedProject,seedScene,story}=require('./helpers.cjs');

const promptOne = [
  'Subject:',
  'A baseball batter in a white uniform, holding a wooden bat. A baseball rests on a tee.',
  '',
  'Scene Overview:',
  'A short sports highlight builds toward one decisive hit.',
  '',
  'Environment / Continuity Anchors:',
  'The batter, bat, baseball and tee remain in the same outdoor batting area.',
  '',
  'Style / Visual Treatment:',
  'Photorealistic sports cinematography, crisp daylight, deliberate slow motion at the moment of contact.',
  '',
  'integrated_multimodal_description:',
  '[Shot 1] Wide view. The batter stands ready beside the tee. The baseball is resting on the tee.',
  '[Shot 2] Slow-motion extreme close-up of the batter swinging. The camera stays tightly focused on the batter hands and wrists; the ball and the point where the bat meets it are mostly outside the frame.',
  '[Shot 3] The batter is back in the original ready stance. The baseball is resting on the tee again, as though the hit never happened.',
  '[Shot 4] An isolated close-up of a ceiling fan rotating above an empty room, with no transition or connection to the baseball sequence.'
].join('\n');

const promptTwo = [
  'Subject:',
  'The same batter prepares for another attempt.',
  '',
  'Scene Overview:',
  'A brief follow-up moment after the hit.',
  '',
  'Environment / Continuity Anchors:',
  'Outdoor batting area.',
  '',
  'Style / Visual Treatment:',
  'Photorealistic sports cinematography.',
  '',
  'integrated_multimodal_description:',
  '[Shot 1] The batter retrieves the baseball from beyond the tee and walks back into position.'
].join('\n');

async function chooseStoryboardModel(page,model) {
  const select=page.locator('#storyboard-director-model');
  await expect(select).toBeVisible();
  await expect.poll(async()=>select.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value).filter(Boolean)))
    .toContain(model);
  await select.selectOption(model);
}

test('LIVE Project Deep QA prepares reusable, source-versioned creative intelligence',async({page},testInfo)=>{
  const project=await seedProject(page,'Live Prompt Assist Deep QA '+Date.now(),{
    concept:'A short sports highlight built around one decisive baseball hit.',
    style:'Photorealistic sports cinematography with deliberate slow motion.'
  });
  const first=await seedScene(page,project.id,{title:'The Hit',prompt:promptOne,durationSeconds:8});
  const second=await seedScene(page,project.id,{title:'After the Hit',prompt:promptTwo,durationSeconds:6});

  const model=await openLiveDirector(page);
  await chooseStoryboardModel(page,model);
  await openProject(page,project.id);
  await page.locator('#storyboard-prompt-assist-btn').click();
  const dialog=page.locator('#prompt-assist-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#prompt-assist-scope').selectOption('project');
  await dialog.locator('#prompt-assist-deep-qa').click();

  await expect(dialog.locator('#prompt-assist-deep-qa-state'))
    .toHaveText('Project intelligence ready',{timeout:360000});
  const response=await page.request.get('/fs/storyboard/prompt-assist/deep-qa?storyId='+encodeURIComponent(project.id));
  expect(response.ok()).toBeTruthy();
  const saved=await response.json();
  expect(saved.available).toBe(true);
  expect(saved.fresh).toBe(true);
  expect(saved.deepQa.sourceFingerprint).toBeTruthy();
  expect(saved.deepQa.intelligence).toBeTruthy();
  expect(Array.isArray(saved.deepQa.intelligence.sceneBriefs)).toBe(true);
  expect(Array.isArray(saved.deepQa.intelligence.stateLedger)).toBe(true);
  expect(saved.deepQa.intelligence.sceneBriefs.some(item=>item.sceneId===first.id)).toBe(true);
  expect(saved.deepQa.intelligence.sceneBriefs.some(item=>item.sceneId===second.id)).toBe(true);

  await testInfo.attach('prompt-assist-project-deep-qa.json',{
    body:Buffer.from(JSON.stringify({model,projectId:project.id,deepQa:saved.deepQa},null,2)),
    contentType:'application/json'
  });
  const unchanged=await story(page,project.id);
  expect(unchanged.scenes[first.id].prompt).toBe(promptOne);
  expect(unchanged.scenes[second.id].prompt).toBe(promptTwo);
  await dialog.locator('#prompt-assist-done').click();
});

test('LIVE Prompt Assist runs independent specialists, discusses findings, and applies only an approved revision',async({page},testInfo)=>{
  const project=await seedProject(page,'Live Prompt Assist Review '+Date.now(),{
    concept:'A concise sports highlight showing one decisive baseball hit and its immediate aftermath.',
    style:'Photorealistic sports cinematography; clear, purposeful framing.'
  });
  const first=await seedScene(page,project.id,{title:'The Hit',prompt:promptOne,durationSeconds:8});
  const second=await seedScene(page,project.id,{title:'After the Hit',prompt:promptTwo,durationSeconds:6});

  const model=await openLiveDirector(page);
  await chooseStoryboardModel(page,model);
  await openProject(page,project.id);
  await page.locator('.storyboard-scene-progress-card[data-scene-id="'+first.id+'"] [data-scene-progress]').click();
  await page.locator('#storyboard-prompt-assist-btn').click();
  const dialog=page.locator('#prompt-assist-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#prompt-assist-scope')).toHaveValue('scene');
  await dialog.locator('#prompt-assist-run').click();

  await expect(dialog.locator('#prompt-assist-status'))
    .toHaveText('All three independent reviews are complete.',{timeout:480000});
  const counts={};
  for(const role of ['visual','continuity','sequence']) {
    counts[role]=await dialog.locator('#prompt-assist-'+role+'-count').textContent();
    expect(counts[role]).not.toBe('Not run');
  }
  await dialog.locator('#prompt-assist-synthesize').click();
  await expect(dialog.locator('#prompt-assist-status'))
    .toHaveText('Recommendations are ready for your review.',{timeout:240000});
  const editorCount=await dialog.locator('#prompt-assist-editor-count').textContent();
  expect(editorCount).not.toBe('Waiting');
  const recommendationCount=Number((editorCount.match(/\d+/)||[])[0]||0);
  expect(recommendationCount,'The deliberately flawed baseball sequence should yield at least one actionable recommendation').toBeGreaterThan(0);

  await dialog.locator('#prompt-assist-ask-role').selectOption('continuity');
  await dialog.locator('#prompt-assist-question').fill(
    'Explain the most important state progression issue in the source cuts. Cite the exact cuts involved.'
  );
  await dialog.locator('#prompt-assist-ask').click();
  await expect(dialog.locator('#prompt-assist-chat .assistant').last())
    .not.toBeEmpty({timeout:240000});

  await dialog.locator('[data-pa-recommendation]').first().check();
  await dialog.locator('#prompt-assist-prepare-revision').click();
  await expect(dialog.locator('#prompt-assist-revisions')).toBeVisible({timeout:240000});
  const revised=dialog.locator('#prompt-assist-revision-list textarea').first();
  await expect(revised).toBeVisible();
  const proposedPrompt=await revised.inputValue();
  expect(proposedPrompt.trim().length).toBeGreaterThan(0);
  expect(proposedPrompt).not.toBe(promptOne);

  const beforeApply=await story(page,project.id);
  expect(beforeApply.scenes[first.id].prompt).toBe(promptOne);
  expect(beforeApply.scenes[second.id].prompt).toBe(promptTwo);
  await testInfo.attach('prompt-assist-live-review-and-proposal.json',{
    body:Buffer.from(JSON.stringify({
      model,projectId:project.id,sceneId:first.id,specialistCounts:counts,
      editorCount,discussion:await dialog.locator('#prompt-assist-chat').innerText(),
      proposedPrompt
    },null,2)),contentType:'application/json'
  });

  await dialog.locator('#prompt-assist-apply').click();
  await expect(dialog.locator('#prompt-assist-status'))
    .toContainText('Selected prompts applied',{timeout:120000});
  await expect.poll(async()=>(await story(page,project.id)).scenes[first.id].prompt,{timeout:120000})
    .toBe(proposedPrompt);
  const afterApply=await story(page,project.id);
  expect(afterApply.scenes[first.id].previousPrompt).toBe(promptOne);
  expect(afterApply.scenes[first.id].previousRevision.prompt).toBe(promptOne);
  expect(afterApply.scenes[first.id].takes).toEqual(beforeApply.scenes[first.id].takes);
  expect(afterApply.scenes[second.id].prompt).toBe(promptTwo);
  await dialog.locator('#prompt-assist-done').click();
});
