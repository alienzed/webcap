'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,queueModel,observedModels,openDirector,say,seedProject,
  openProject,openWrite,story,stories}=require('./helpers.cjs');

const advice=page=>page.locator('#studio-action-advisor-actions');

test('enabled-by-default advisor sends a separate same-model request with conversation context, not unread Project data',async({page,request})=>{
  await resetModel(request);
  const privateConcept='An undisclosed turquoise submarine in the warehouse.';
  const project=await seedProject(page,'Advisor isolation '+Date.now(),{
    concept:privateConcept,style:'Blue twilight.'
  });
  await openDirector(page);
  await openProject(page,project.id);
  expect(await page.evaluate(()=>localStorage.getItem('webcap.studio.actionAdvisor.enabled'))).not.toBe('false');
  expect((await observedModels(request)).calls).toHaveLength(0);

  await queueModel(request,'An Overview check would be useful before a revision.');
  await queueModel(request,{actions:[{
    kind:'read',label:'Review saved Overview',projectId:project.id,fields:['overview']
  }]});
  await say(page,'What should we review next?');
  await expect(advice(page).locator('button')).toHaveCount(1,{timeout:30000});

  const calls=(await observedModels(request)).calls;
  expect(calls).toHaveLength(2);
  expect(calls[1].model).toBe(calls[0].model);
  expect(JSON.stringify(calls[1].messages)).toContain('Action Advisor');
  expect(JSON.stringify(calls[1].messages)).toContain('What should we review next?');
  expect(JSON.stringify(calls[1].messages)).toContain(project.id);
  expect(JSON.stringify(calls[1].messages)).not.toContain(privateConcept);
  expect((await story(page,project.id)).concept).toBe(privateConcept);
});

test('invalid targets and unsupported actions are omitted; only three applicable suggestions appear',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'Advisor filtering '+Date.now());
  await openDirector(page);
  await openProject(page,project.id);
  await queueModel(request,'We can refine the Project and plan its first Scene.');
  await queueModel(request,{actions:[
    {kind:'delete_project',label:'Delete everything',projectId:project.id,instruction:'Remove it'},
    {kind:'revise_project',label:'Wrong Project',projectId:'fabricated-project',
      fields:['style'],instruction:'Change an unrelated Project'},
    {kind:'revise_scenes',label:'Invented Scene',projectId:project.id,
      sceneIds:['fabricated-scene'],instruction:'Revise an unknown Scene'},
    {kind:'revise_project',label:'Scope the lighting',projectId:project.id,
      fields:['style','unknown-field'],instruction:'Warm the light'},
    {kind:'create_scene',label:'Prepare opening Scene',projectId:project.id,
      instruction:'Create a quiet opening Scene'},
    {kind:'read',label:'Inspect Overview',projectId:project.id,fields:['overview']},
    {kind:'create_project',label:'Fourth valid action',instruction:'Start a new Project'}
  ]});
  await say(page,'Suggest next actions.');

  const rows=advice(page).locator('.studio-action-advisor-item');
  await expect(rows).toHaveCount(3,{timeout:30000});
  await expect(advice(page)).toContainText('Scope the lighting');
  await expect(advice(page)).toContainText('Prepare opening Scene');
  await expect(advice(page)).toContainText('Inspect Overview');
  await expect(advice(page)).not.toContainText('Delete everything');
  await expect(advice(page)).not.toContainText('Wrong Project');
  await expect(advice(page)).not.toContainText('Invented Scene');
  await expect(advice(page)).not.toContainText('Fourth valid action');

  await rows.filter({hasText:'Prepare opening Scene'}).locator('button').click();
  await expect(page.locator('#studio-dw-write-panel')).toBeVisible();
  await expect(page.locator('#studio-dw-write-project')).toHaveValue(project.id);
  await expect(page.locator('#studio-dw-write-operation')).toHaveValue('scene-write');
  await expect(page.locator('#studio-dw-scene-mode')).toHaveValue('create');
  await expect(page.locator('#studio-dw-write-instruction')).toHaveValue('Create a quiet opening Scene');
  expect((await story(page,project.id)).sceneOrder).toHaveLength(0);
  expect((await observedModels(request)).calls).toHaveLength(2);
});

test('Create Project suggestion prefills the ordinary Write form without creating a Project',async({page,request})=>{
  await resetModel(request);
  const original=await seedProject(page,'Unchanged Project '+Date.now(),{
    style:'Cool evening light.'
  });
  await openDirector(page);
  await openProject(page,original.id);
  const before=(await stories(page)).map(item=>item.id).sort();
  await queueModel(request,'The second idea deserves its own Project.');
  await queueModel(request,{actions:[{
    kind:'create_project',label:'Prepare a separate Project',
    instruction:'Create a Project about a clockmaker and a lighthouse.'
  }]});
  await say(page,'How should we pursue the clockmaker idea?');
  const button=advice(page).locator('button');
  await expect(button).toHaveCount(1,{timeout:30000});
  await button.click();

  await expect(page.locator('#studio-dw-write-panel')).toBeVisible();
  await expect(page.locator('#studio-dw-write-operation')).toHaveValue('new-project');
  await expect(page.locator('#studio-dw-write-project')).toBeDisabled();
  await expect(page.locator('#studio-dw-write-instruction'))
    .toHaveValue('Create a Project about a clockmaker and a lighthouse.');
  expect((await stories(page)).map(item=>item.id).sort()).toEqual(before);
  expect((await story(page,original.id)).style).toBe('Cool evening light.');
  expect((await observedModels(request)).calls).toHaveLength(2);
});

test('an inference-provider failure is local to advisor; existing manual Write remains available',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'Advisor provider error '+Date.now(),{
    style:'Original blue light.'
  });
  await openDirector(page);
  await openProject(page,project.id);
  await queueModel(request,'The scene could benefit from a more deliberate opening.');
  await queueModel(request,{httpError:503,message:'Controlled advisor unavailable'});
  await say(page,'Discuss the opening without changing saved content.');

  await expect(page.locator('#director-chat-messages'))
    .toContainText('The scene could benefit from a more deliberate opening.');
  await expect(page.locator('#studio-action-advisor-status'))
    .toContainText('Suggestions unavailable',{timeout:30000});
  await expect(advice(page)).toBeHidden();
  await expect(page.locator('#director-chat-input')).toBeEnabled();
  await openWrite(page,{projectId:project.id,operation:'project',
    instruction:'Manual changes still work.'});
  await expect(page.locator('#studio-dw-write-panel')).toBeVisible();
  expect((await story(page,project.id)).style).toBe('Original blue light.');
  expect((await observedModels(request)).calls).toHaveLength(2);
});

test('a late advisor result cannot replace suggestions from a newer Director chat turn',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'Advisor stale response '+Date.now(),{
    style:'Unchanged evening light.'
  });
  await openDirector(page);
  await openProject(page,project.id);

  let releaseFirst;
  const holdFirst=new Promise(resolve=>{releaseFirst=resolve;});
  let firstHeld=false;
  const intercept=async route=>{
    const body=route.request().postDataJSON();
    if(body.operation==='studio_action_advisor' && !firstHeld) {
      firstHeld=true;
      await holdFirst;
    }
    await route.continue();
  };
  await page.route('**/fs/director/chat',intercept);
  try {
    await queueModel(request,'First chat reply.');
    await say(page,'Discuss the original plan.');
    await expect(page.locator('#director-chat-messages')).toContainText('First chat reply.');
    await expect.poll(()=>firstHeld).toBe(true);
    await expect(page.locator('#director-chat-input')).toBeEnabled();

    await queueModel(request,'Second chat reply.');
    await queueModel(request,{actions:[{
      kind:'revise_project',label:'Current suggestion',projectId:project.id,
      fields:['style'],instruction:'Use a gentler light.'
    }]});
    await say(page,'Actually, consider a gentler light.');
    await expect(page.locator('#director-chat-messages')).toContainText('Second chat reply.');
    await expect(advice(page).locator('button')).toHaveCount(1,{timeout:30000});
    await expect(advice(page)).toContainText('Current suggestion');

    await queueModel(request,{actions:[{
      kind:'revise_project',label:'Outdated suggestion',projectId:project.id,
      fields:['style'],instruction:'Restore the original plan.'
    }]});
    const oldResponse=page.waitForResponse(async response=>{
      if(!response.url().includes('/fs/director/job?')) return false;
      try { return JSON.stringify(await response.json()).includes('Outdated suggestion'); }
      catch (_) { return false; }
    },{timeout:30000});
    releaseFirst();
    await oldResponse;

    await expect(advice(page)).toContainText('Current suggestion');
    await expect(advice(page)).not.toContainText('Outdated suggestion');
    await expect.poll(async()=> (await observedModels(request)).calls.length).toBe(4);
    expect((await story(page,project.id)).style).toBe('Unchanged evening light.');
  } finally {
    releaseFirst();
    await page.unroute('**/fs/director/chat',intercept);
  }
});
