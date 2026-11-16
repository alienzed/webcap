'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,queueModel,observedModels,openDirector,say,story,seedProject,seedScene,openProject}=require('./helpers.cjs');
const {ensureAttachedProject}=require('./helpers.cjs');

test('Flow 3 — reviewed Overview revision changes only intended persisted fields',async({page,request})=>{
  await resetModel(request);
  const original=await seedProject(page,'Revision scope '+Date.now(),{
    concept:'A bookshop is open late.',style:'Cold blue windows.'
  });
  const scene=await seedScene(page,original.id,{
    title:'Entrance',prompt:'A visitor opens a heavy red door.',durationSeconds:8
  });
  await openDirector(page);
  await openProject(page,original.id);
  await ensureAttachedProject(page,original.title);
  await queueModel(request,{
    reply:'I can warm the Project atmosphere.',
    changes:{project:{style:'Soft amber light.'}},
    action:{kind:'write_project',instruction:'Revise only the atmosphere.',fields:['style']}
  });
  await say(page,'Revise the Project atmosphere to soft amber light.');
  const action=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  await expect(action).toContainText('Review authored Project');
  await page.locator('#studio-dw-suggestions select[aria-label="Project material destination"]').selectOption(original.id);
  await action.click();
  await expect(page.locator('#studio-brief-review')).toBeVisible();
  await expect(page.locator('#studio-brief-style')).toHaveValue('Soft amber light.');
  await page.locator('#studio-brief-style').fill('Warm golden windows.');
  await page.locator('#studio-brief-apply').click();
  await expect.poll(async()=> (await story(page,original.id)).style).toBe('Warm golden windows.');
  const saved=await story(page,original.id);
  expect(saved.concept).toBe('A bookshop is open late.');
  expect(saved.scenes[scene.id].prompt).toBe('A visitor opens a heavy red door.');
  expect(saved.scenes[scene.id].durationSeconds).toBe(8);
  expect((await observedModels(request)).calls).toHaveLength(1);
  await page.reload();
  expect((await story(page,original.id)).style).toBe('Warm golden windows.');
});

test('Flow 3 batch — partial Scene save followed by model failure reports and retains real saved work',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'Batch partial '+Date.now());
  const first=await seedScene(page,project.id,{title:'First',prompt:'First saved prompt.',durationSeconds:8});
  const second=await seedScene(page,project.id,{title:'Second',prompt:'Second saved prompt.',durationSeconds:8});
  await openDirector(page);
  await openProject(page,project.id);
  await ensureAttachedProject(page,project.title);
  // Explicit selected-Scene Write is the proper entry point for batch authoring.
  // A conversational action promise cannot launch a write without authored content.
  await page.locator('#studio-dw-open-tools').click();
  await page.locator('#studio-dw-write').click();
  const pane=page.locator('#studio-dw-write-panel');
  await expect(pane).toBeVisible();
  await page.locator('#studio-dw-write-project').selectOption(project.id);
  await page.locator('#studio-dw-write-operation').selectOption('scene-write');
  await page.locator('#studio-dw-scene-mode').selectOption('revise');
  await page.locator('#studio-dw-write-instruction').fill('Revise both selected Scene prompts with warmer lighting.');
  for (const id of [first.id, second.id]) {
    const box=pane.locator('input[type="checkbox"][value="'+id+'"]');
    await expect(box).toBeVisible();
    await box.check();
  }
  // Queue one valid external model reply and one injected external failure.
  await queueModel(request,{prompt:'First revision, warm amber lamps.'});
  await request.post('http://127.0.0.1:4211/__acceptance/queue',{
    data:{httpError:503,message:'Acceptance inference unavailable'}
  });
  await page.locator('#studio-dw-write-prepare').click();
  await expect(page.locator('#studio-dw-status')).toContainText(/Saved 1|Failed 1/);
  const persisted=await story(page,project.id);
  expect(persisted.scenes[first.id].prompt).toBe('First revision, warm amber lamps.');
  expect(persisted.scenes[second.id].prompt).toBe('Second saved prompt.');
  expect((await observedModels(request)).calls.length).toBe(2);
});
