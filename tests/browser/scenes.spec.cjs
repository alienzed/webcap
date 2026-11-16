'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,queueModel,observedModels,openDirector,say,stories,story}=require('./helpers.cjs');
const {ensureAttachedProject,freshDirectorSession}=require('./helpers.cjs');

async function newSelectedProject(page) {
  const previous=new Set((await stories(page)).map(item=>item.id));
  await page.locator('#storyboard-new-btn').click();
  await expect.poll(async()=> (await stories(page)).some(item=>!previous.has(item.id))).toBeTruthy();
  const candidate=(await stories(page)).find(item=>!previous.has(item.id));
  await expect(page.locator('#storyboard-library-list [data-story-id="'+candidate.id+'"]')).toBeVisible();
  return candidate;
}

test('Flow 2 — returned Scene count, editable review and persistent real records',async({page,request})=>{
  await resetModel(request);
  await freshDirectorSession(page);
  await page.goto('/');
  await page.locator('#activity-storyboard-btn').click();
  const project=await newSelectedProject(page);
  await page.locator('#director-chat-rail-btn').click();
  await page.locator('[data-assistant-mode="storyboard"]').click();
  await ensureAttachedProject(page,project.title);
  const model=page.locator('#app-header-director-model');
  await expect(model.locator('option[value="acceptance::acceptance-model"]')).toHaveCount(1);
  await model.selectOption('acceptance::acceptance-model');
  const authored=[
    {title:'Approach',prompt:'A woman approaches an old bookshop beneath amber lamps.',durationSeconds:8},
    {title:'Entering',prompt:'She enters the bookshop through a wooden door.',durationSeconds:12}
  ];
  await queueModel(request,{
    reply:'I drafted the Scenes for review.',
    scenes:authored,
    action:{kind:'create_scene',instruction:'Create three Scenes.'}
  });
  await say(page,'Create three Scenes with different durations.');
  const action=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  await expect(action).toContainText('Review authored Scene');
  await expect(page.locator('#director-chat-progress')).toBeHidden();
  await action.click();
  await expect(page.locator('#studio-scenes-review')).toBeVisible();
  const rows=page.locator('#studio-scenes-rows .studio-scenes-row');
  await expect(rows).toHaveCount(2); // Actual results, not the requested three.
  await expect(rows.nth(0).locator('[data-field="prompt"]')).toHaveValue(authored[0].prompt);
  await expect(rows.nth(1).locator('[data-field="durationSeconds"]')).toHaveValue('12');
  await rows.nth(1).locator('[data-field="prompt"]').fill(authored[1].prompt+' Interior is warmly lit.');
  const callsBefore=await observedModels(request);
  expect(callsBefore.calls).toHaveLength(1);
  await page.locator('#studio-scenes-apply').click();
  await expect.poll(async()=> (await story(page,project.id)).sceneOrder.length).toBe(2);
  const saved=await story(page,project.id);
  const actual=saved.sceneOrder.map(id=>saved.scenes[id]);
  expect(actual.map(x=>x.title)).toEqual(['Approach','Entering']);
  expect(actual.map(x=>x.durationSeconds)).toEqual([8,12]);
  expect(actual.map(x=>x.prompt)).toEqual([authored[0].prompt,authored[1].prompt+' Interior is warmly lit.']);
  expect((await observedModels(request)).calls).toHaveLength(1);
  await page.reload();
  const persisted=await story(page,project.id);
  expect(persisted.sceneOrder).toEqual(saved.sceneOrder);
  expect(persisted.scenes[persisted.sceneOrder[1]].prompt).toBe(actual[1].prompt);
});

test('Flow 6 — each conversation reply owns its own editable Scene review',async({page,request})=>{
  await resetModel(request);
  await freshDirectorSession(page);
  await page.goto('/');
  await page.locator('#activity-storyboard-btn').click();
  const project=await newSelectedProject(page);
  await page.locator('#director-chat-rail-btn').click();
  await page.locator('[data-assistant-mode="storyboard"]').click();
  await ensureAttachedProject(page,project.title);
  const model=page.locator('#app-header-director-model');
  await expect(model.locator('option[value="acceptance::acceptance-model"]')).toHaveCount(1);
  await model.selectOption('acceptance::acceptance-model');
  await queueModel(request,{
    reply:'First Scene is ready.',
    scenes:[{title:'First',prompt:'First unique scene prompt.',durationSeconds:8}]
  });
  await say(page,'Create a first Scene');
  let action=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  await expect(action).toBeVisible();
  await expect(page.locator('#director-chat-progress')).toBeHidden();
  await action.click();
  await expect(page.locator('#studio-scenes-review')).toBeVisible();
  const row=page.locator('#studio-scenes-rows .studio-scenes-row');
  await row.locator('[data-field="prompt"]').fill('First edited and unsaved.');
  await page.locator('#studio-scenes-close').click();

  await queueModel(request,{
    reply:'Second Scene is ready.',
    scenes:[{title:'Second',prompt:'Second unique scene prompt.',durationSeconds:10}]
  });
  await say(page,'Create a second Scene');
  action=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  await expect(action).toBeVisible();
  await expect(page.locator('#director-chat-progress')).toBeHidden();
  await action.click();
  await expect(page.locator('#studio-scenes-review')).toBeVisible();
  await expect(row.locator('[data-field="prompt"]')).toHaveValue('Second unique scene prompt.');
  await page.locator('#studio-scenes-close').click();

  // Reopen the first reply's action using the actual conversation UI.
  const earlier=page.locator('#director-chat-messages .studio-dw-suggestion-action').first();
  await expect(earlier).toBeVisible();
  await earlier.click();
  await expect(page.locator('#studio-scenes-review')).toBeVisible();
  await expect(row.locator('[data-field="prompt"]')).toHaveValue('First edited and unsaved.');
  await page.locator('#studio-scenes-close').click();
  expect((await story(page,project.id)).sceneOrder).toHaveLength(0);
  expect((await observedModels(request)).calls).toHaveLength(2);
});

test('Flow 2 variation — useful partial Scene survives invalid sibling metadata and can be saved first',async({page,request})=>{
  await resetModel(request);
  await freshDirectorSession(page);
  await page.goto('/');
  await page.locator('#activity-storyboard-btn').click();
  const project=await newSelectedProject(page);
  await page.locator('#director-chat-rail-btn').click();
  await page.locator('[data-assistant-mode="storyboard"]').click();
  await ensureAttachedProject(page,project.title);
  const model=page.locator('#app-header-director-model');
  await expect(model.locator('option[value="acceptance::acceptance-model"]')).toHaveCount(1);
  await model.selectOption('acceptance::acceptance-model');
  await queueModel(request,{
    reply:'Here are the available Scenes.',
    scenes:[
      {title:'Complete',prompt:'A complete usable scene by the window.',durationSeconds:8},
      {title:'Incomplete',prompt:'',durationSeconds:99}
    ],
    action:{kind:'create_scene',instruction:'Create three Scenes.'}
  });
  await say(page,'Create three Scenes with different durations');
  const action=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  await expect(action).toContainText('Review authored Scene');
  await expect(page.locator('#director-chat-progress')).toBeHidden();
  await action.click();
  const dialog=page.locator('#studio-scenes-review');
  await expect(dialog).toBeVisible();
  const rows=dialog.locator('.studio-scenes-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1).locator('[data-field="durationSeconds"]')).toHaveValue('99');
  await page.locator('#studio-scenes-apply').click();
  await expect(dialog).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(page.locator('#studio-scenes-error')).toContainText('1 still need');
  const savedOnce=await story(page,project.id);
  expect(savedOnce.sceneOrder).toHaveLength(1);
  expect(savedOnce.scenes[savedOnce.sceneOrder[0]].title).toBe('Complete');
  await rows.first().locator('[data-field="prompt"]').fill('The second usable scene opens the door.');
  await rows.first().locator('[data-field="durationSeconds"]').fill('10');
  await page.locator('#studio-scenes-apply').click();
  await expect(dialog).toBeHidden();
  await expect.poll(async()=> (await story(page,project.id)).sceneOrder.length).toBe(2);
  const completed=await story(page,project.id);
  expect(completed.scenes[completed.sceneOrder[1]].prompt).toBe('The second usable scene opens the door.');
  expect(completed.scenes[completed.sceneOrder[1]].durationSeconds).toBe(10);
  expect((await observedModels(request)).calls).toHaveLength(1);
});

test('Flow 2 — a single authored changes.scene record reaches review without an action hint',async({page,request})=>{
  await resetModel(request);
  await freshDirectorSession(page);
  await page.goto('/');
  await page.locator('#activity-storyboard-btn').click();
  const project=await newSelectedProject(page);
  await page.locator('#director-chat-rail-btn').click();
  await page.locator('[data-assistant-mode="storyboard"]').click();
  await ensureAttachedProject(page,project.title);
  await page.locator('#app-header-director-model').selectOption('acceptance::acceptance-model');
  const authored={title:'First Window',prompt:'A visitor stands beside a blue window.',durationSeconds:8};
  await queueModel(request,{changes:{scene:authored}}); // No reply or action.
  await say(page,'Author one new Scene about a window.');
  const action=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  await expect(action).toContainText('Review authored Scene');
  await expect(page.locator('#director-chat-progress')).toBeHidden();
  await action.click();
  await expect(page.locator('#studio-scenes-review')).toBeVisible();
  const row=page.locator('#studio-scenes-rows .studio-scenes-row');
  await expect(row).toHaveCount(1);
  await expect(row.first().locator('[data-field="prompt"]')).toHaveValue(authored.prompt);
  await page.locator('#studio-scenes-apply').click();
  await expect.poll(async()=> (await story(page,project.id)).sceneOrder.length).toBe(1);
  const saved=await story(page,project.id);
  expect(saved.scenes[saved.sceneOrder[0]].prompt).toBe(authored.prompt);
  expect((await observedModels(request)).calls).toHaveLength(1);
});

test('Flow 2 — wrong optional action hint does not discard actually authored Scene records',async({page,request})=>{
  await resetModel(request);
  await freshDirectorSession(page);
  await page.goto('/');
  await page.locator('#activity-storyboard-btn').click();
  const project=await newSelectedProject(page);
  await page.locator('#director-chat-rail-btn').click();
  await page.locator('[data-assistant-mode="storyboard"]').click();
  await ensureAttachedProject(page,project.title);
  await page.locator('#app-header-director-model').selectOption('acceptance::acceptance-model');
  await queueModel(request,{
    reply:'Draft ready',
    action:{kind:'write_project',instruction:'Revise the Project'},
    scenes:[{title:'Crossing',prompt:'A figure crosses a stone bridge.',durationSeconds:12}]
  });
  await say(page,'Create one new Scene about a stone bridge.');
  const action=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  await expect(action).toContainText('Review authored Scene');
  await expect(page.locator('#director-chat-progress')).toBeHidden();
  await action.click();
  await expect(page.locator('#studio-scenes-review')).toBeVisible();
  await expect(page.locator('#studio-scenes-rows .studio-scenes-row')).toHaveCount(1);
  expect((await observedModels(request)).calls).toHaveLength(1);
});
