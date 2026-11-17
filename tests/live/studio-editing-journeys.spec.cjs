'use strict';
const {test,expect}=require('../browser/test.cjs');
const {openLiveDirector,attachProject,approveOverview,sendLive,story,seedProject,seedScene,
  openProject,reopenDirectorIfClosed}=require('./helpers.cjs');

// These journeys deliberately keep the real Project and Studio conversation
// across operations. The existing isolated live flows cover each operation;
// these catch stale context/selection after switching between tools.
async function reviseOverview(page,instruction,projectId) {
  const mode=page.locator('#director-studio-composer-mode-select');
  await mode.selectOption('conversation');
  await approveOverview(page,projectId);
  await sendLive(page,instruction);
  const action=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  await expect(action).toContainText(/Review authored Project/);
  await page.locator('#studio-dw-suggestions select[aria-label="Project material destination"]').selectOption(projectId);
  await action.click();
  const review=page.locator('#studio-brief-review');
  await expect(review).toBeVisible();
  const style=await page.locator('#studio-brief-style').inputValue();
  expect(style.trim(),'Director must return a useful Overview revision').toBeTruthy();
  await expect(page.locator('#studio-brief-title-selected')).not.toBeChecked();
  await expect(page.locator('#studio-brief-concept-selected')).not.toBeChecked();
  await expect(page.locator('#studio-brief-invariants-selected')).not.toBeChecked();
  await page.locator('#studio-brief-apply').click();
  await expect.poll(async()=>(await story(page,projectId)).style,{timeout:30000}).toBe(style);
  return style;
}
async function evidence(testInfo,label,data) {
  await testInfo.attach(label,{body:Buffer.from(JSON.stringify(data,null,2)),contentType:'application/json'});
}
async function chooseScene(page,sceneId) {
  if(await page.locator('#director-chat-drawer').isVisible())
    await page.locator('#director-chat-close').click();
  await page.locator('[data-scene-progress="'+sceneId+'"]').click();
  await expect(page.locator('.storyboard-scene-progress-card[data-scene-id="'+sceneId+'"]'))
    .toHaveClass(/active/);
}
async function reviseSelectedScene(page,sceneId,instruction,beforePrompt,projectId) {
  // The composer Revision mode deliberately targets ALL Scenes. Use the
  // contextual prompt-specific Revise control to exercise exactly one Scene.
  const editor=page.locator('[data-scene-id="'+sceneId+'"]').filter({
    has:page.locator('[data-director-correction]')
  }).first();
  await expect(editor.locator('[data-director-correction]')).toBeVisible();
  await editor.locator('[data-director-correction]').fill(instruction);
  await editor.locator('[data-director-refine]').click();
  await expect.poll(async()=>{
    const current=await story(page,projectId);
    return current.scenes[sceneId].prompt;
  },{timeout:300000,intervals:[1500,3000]}).not.toBe(beforePrompt);
  await expect(editor.locator('[data-director-status]')).toContainText(/Director completed|Refined/i,{timeout:30000});
}

test('Live journey — revise Overview, Develop Scenes button, revise a Scene, then revise Overview again',async({page},testInfo)=>{
  const project=await seedProject(page,'Live Mixed Workflow '+Date.now(),{
    concept:'A courier delivers a mysterious parcel to a lighthouse at dawn.',
    style:'Cool coastal mist.',targetSceneCount:3
  });
  const model=await openLiveDirector(page);
  await attachProject(page,project);
  const original=await story(page,project.id);
  const instructions=[
    'Revise only the Project visual atmosphere to dramatic silver morning light, while keeping its courier-and-lighthouse concept unchanged. Return the revised style for review.',
    'Revise only this selected Scene prompt to make a small brass compass clearly visible while preserving the Scene action, title and duration.',
    'Revise only the Project visual atmosphere again, to golden late-afternoon sunlight. Preserve the current Concept and all existing Scene prompts.'
  ];
  const style1=await reviseOverview(page,instructions[0],project.id);
  const afterOverview=await story(page,project.id);
  expect(style1).not.toBe(original.style);
  expect(afterOverview.concept).toBe(original.concept);
  expect(afterOverview.sceneOrder).toHaveLength(0);

  // Exercise the actual UI button, NOT /fs/storyboard/director called by the test.
  await page.locator('#director-chat-close').click();
  const develop=page.locator('#storyboard-develop-btn');
  await expect(develop).toBeVisible();
  await develop.click();
  await expect.poll(async()=> (await story(page,project.id)).sceneOrder.length,
    {timeout:300000,intervals:[1500,3000]}).toBeGreaterThan(0);
  await expect(page.locator('#storyboard-develop-status'))
    .toContainText(/Developed \d+ Scenes/,{timeout:300000});
  const developed=await story(page,project.id);
  expect(developed.style).toBe(style1);
  expect(developed.concept).toBe(original.concept);
  expect(developed.sceneOrder.length).toBeGreaterThan(0);
  for(const id of developed.sceneOrder)
    expect(developed.scenes[id].prompt.trim(),'Develop must save actual Scene prompts').toBeTruthy();

  const targetId=developed.sceneOrder[0];
  await chooseScene(page,targetId);
  await reviseSelectedScene(page,targetId,instructions[1],developed.scenes[targetId].prompt,project.id);
  const afterScene=await story(page,project.id);
  expect(afterScene.sceneOrder).toEqual(developed.sceneOrder);
  expect(afterScene.scenes[targetId].prompt).not.toBe(developed.scenes[targetId].prompt);
  expect(afterScene.scenes[targetId].title).toBe(developed.scenes[targetId].title);
  expect(afterScene.scenes[targetId].durationSeconds).toBe(developed.scenes[targetId].durationSeconds);
  for(const id of developed.sceneOrder.slice(1))
    expect(afterScene.scenes[id].prompt).toBe(developed.scenes[id].prompt);
  expect(afterScene.style).toBe(style1);

  await reopenDirectorIfClosed(page);
  const style2=await reviseOverview(page,instructions[2],project.id);
  expect(style2).not.toBe(style1);
  const final=await story(page,project.id);
  expect(final.style).toBe(style2);
  expect(final.concept).toBe(original.concept);
  expect(final.sceneOrder).toEqual(afterScene.sceneOrder);
  for(const id of final.sceneOrder)
    expect(final.scenes[id].prompt).toBe(afterScene.scenes[id].prompt);
  await page.reload();
  const restored=await story(page,project.id);
  expect(restored.style).toBe(style2);
  expect(restored.sceneOrder).toEqual(final.sceneOrder);
  for(const id of final.sceneOrder)
    expect(restored.scenes[id].prompt).toBe(final.scenes[id].prompt);
  await evidence(testInfo,'mixed-workflow-saved-checkpoints',{model,instructions,projectId:project.id,
    overviewBefore:original,afterOverview,developed,afterScene,final,restored});
});

test('Live journey — edit A, move to B and edit B, then return to A in the same Director conversation',async({page},testInfo)=>{
  const a=await seedProject(page,'Live Return A '+Date.now(),{
    concept:'An archivist searches an abandoned railway station.',
    style:'Cool daylight.'
  });
  const b=await seedProject(page,'Live Return B '+Date.now(),{
    concept:'A violin maker opens a small workshop.',
    style:'Warm indoor light.'
  });
  const aScene=await seedScene(page,a.id,{title:'The platform',
    prompt:'The archivist walks toward a deserted platform.',durationSeconds:8});
  const bScene=await seedScene(page,b.id,{title:'The workbench',
    prompt:'The violin maker arranges tools on a wooden bench.',durationSeconds:8});
  const model=await openLiveDirector(page);
  await attachProject(page,a);
  const instructions=[
    'Revise only the attached Project A visual atmosphere to hazy blue moonlight; leave the Concept and existing Scene untouched.',
    'Revise only this attached Project B visual atmosphere to crisp white workshop light; leave the Concept and existing Scene untouched.',
    'Revise only the attached Project A visual atmosphere again to soft amber dawn light; preserve its existing Scene prompt and Concept.'
  ];
  const styleA1=await reviseOverview(page,instructions[0],a.id);
  expect(styleA1).not.toBe(a.style);
  expect((await story(page,b.id)).style).toBe(b.style);

  await openProject(page,b.id);
  await expect(page.locator('#director-chat-title')).toContainText(a.title);
  // Navigation alone must not silently switch Director's connected Project.
  const attach=page.locator('#director-studio-attach-current');
  const tools=page.locator('#studio-dw-open-tools');
  if(await tools.getAttribute('aria-expanded')!=='true') await tools.click();
  await expect(attach).toBeVisible();
  await attach.click();
  await expect(page.locator('#director-chat-title')).toContainText(b.title);
  const styleB=await reviseOverview(page,instructions[1],b.id);
  expect(styleB).not.toBe(b.style);
  const afterB=await story(page,b.id);
  expect(afterB.scenes[bScene.id].prompt).toBe(bScene.prompt);
  expect((await story(page,a.id)).style).toBe(styleA1);

  await openProject(page,a.id);
  await expect(page.locator('#director-chat-title')).toContainText(b.title);
  if(await tools.getAttribute('aria-expanded')!=='true') await tools.click();
  await expect(attach).toBeVisible();
  await attach.click();
  await expect(page.locator('#director-chat-title')).toContainText(a.title);
  const styleA2=await reviseOverview(page,instructions[2],a.id);
  expect(styleA2).not.toBe(styleA1);
  const savedA=await story(page,a.id), savedB=await story(page,b.id);
  expect(savedA.style).toBe(styleA2);
  expect(savedA.concept).toBe(a.concept);
  expect(savedA.scenes[aScene.id].prompt).toBe(aScene.prompt);
  expect(savedB.style).toBe(styleB);
  expect(savedB.concept).toBe(b.concept);
  expect(savedB.scenes[bScene.id].prompt).toBe(bScene.prompt);
  await page.reload();
  expect((await story(page,a.id)).style).toBe(styleA2);
  expect((await story(page,b.id)).style).toBe(styleB);
  await evidence(testInfo,'project-switching-saved-checkpoints',{model,instructions,
    aId:a.id,bId:b.id,styleA1,styleB,styleA2,savedA,savedB});
});
