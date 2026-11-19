'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,queueModel,observedModels,openDirector,say,seedProject,story,stories,openProject,runWrite}=require('./helpers.cjs');

test.use({advisorEnabled:true});

test('Action Advisor is opt-in and cannot independently issue a Write',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'Advisor opt out '+Date.now(),{
    concept:'A quiet workshop.',style:'Blue twilight.'
  });
  await openDirector(page);
  await openProject(page,project.id);
  await page.evaluate(()=>localStorage.setItem('webcap.studio.actionAdvisor.enabled','false'));
  await queueModel(request,'We could make the lighting warmer.');
  await say(page,'Discuss the lighting for this Project.');
  await expect(page.locator('#director-chat-messages')).toContainText('We could make the lighting warmer.');
  await expect.poll(async()=> (await observedModels(request)).calls.length).toBe(1);
  await expect(page.locator('#studio-action-advisor-actions')).toBeHidden();
  expect((await story(page,project.id)).style).toBe('Blue twilight.');
});

test('Advisor prepares a field-scoped Project Write but only the normal Write button saves it',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'Advisor scoped action '+Date.now(),{
    title:'Untouched title',concept:'A lamp maker works through the night.',style:'Blue twilight.'
  });
  await openDirector(page);
  await openProject(page,project.id);
  await page.evaluate(()=>localStorage.setItem('webcap.studio.actionAdvisor.enabled','true'));
  await queueModel(request,'I recommend warmer lighting for the opening.');
  await queueModel(request,{actions:[{
    kind:'revise_project',label:'Revise the lighting',
    instruction:'Shift only the visual atmosphere toward soft golden light.',
    projectId:project.id,fields:['style']
  }]});
  await say(page,'Could we make the opening more inviting?');
  const advisor=page.locator('#studio-action-advisor-actions');
  await expect(advisor.locator('button')).toHaveCount(1,{timeout:30000});
  await expect(advisor).toContainText('Revise the lighting');
  expect((await story(page,project.id)).style).toBe('Blue twilight.');
  await advisor.locator('button').click();
  await expect(page.locator('#studio-dw-write-panel')).toBeVisible();
  await expect(page.locator('#studio-dw-write-project')).toHaveValue(project.id);
  await expect(page.locator('#studio-dw-write-operation')).toHaveValue('project');
  await expect(page.locator('#studio-dw-write-project-fields input[value="style"]')).toBeChecked();
  await expect(page.locator('#studio-dw-write-project-fields input[value="concept"]')).not.toBeChecked();
  await expect(page.locator('#studio-dw-write-project-fields input[value="title"]')).not.toBeChecked();
  await expect(page.locator('#studio-dw-write-project-fields input[value="invariants"]')).not.toBeChecked();
  await expect(page.locator('#studio-dw-write-instruction')).toHaveValue(
    'Shift only the visual atmosphere toward soft golden light.');
  expect((await story(page,project.id)).style).toBe('Blue twilight.');
  await expect.poll(async()=> (await observedModels(request)).calls.length).toBe(2);
  await queueModel(request,{title:'Model drift must not save',style:'Soft golden light.'});
  await page.locator('#studio-dw-write-prepare').click();
  await expect.poll(async()=> (await story(page,project.id)).style).toBe('Soft golden light.');
  const saved=await story(page,project.id);
  expect(saved.title).toBe('Untouched title');
  expect(saved.concept).toBe('A lamp maker works through the night.');
  await expect.poll(async()=> (await observedModels(request)).calls.length).toBe(3);
  const calls=(await observedModels(request)).calls;
  expect(JSON.stringify(calls[1].messages)).toContain('Action Advisor');
  expect(JSON.stringify(calls[2].messages)).not.toContain('You are WebCap');
});

test('A failed optional advisor does not interrupt Director chat or a subsequent manual Write',async({page,request})=>{
  await resetModel(request);
  await openDirector(page);
  await page.evaluate(()=>localStorage.setItem('webcap.studio.actionAdvisor.enabled','true'));
  await queueModel(request,'The lantern in the doorway would make a good opening image.');
  await queueModel(request,'not a JSON action response');
  await say(page,'Explore a lantern-lit opening.');
  await expect(page.locator('#director-chat-messages')).toContainText('The lantern in the doorway');
  await expect(page.locator('#studio-action-advisor-status')).toContainText('Suggestions unavailable',{timeout:30000});
  const title='Manual after advisor failure '+Date.now();
  await queueModel(request,{title,concept:'A lantern lights the doorway.',
    style:'Warm amber lighting.',invariants:[]});
  await runWrite(page,{operation:'new-project',instruction:'Create a lantern-lit Project.'});
  await expect.poll(async()=> (await stories(page)).some(p=>p.title===title)).toBe(true);
  expect((await observedModels(request)).calls).toHaveLength(3);
});

test('Advisor Read suggestion selects the existing Overview without reading until the author clicks Read',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'Advisor Read '+Date.now(),{
    concept:'The compass points toward a red tower.',style:'Overcast daylight.'
  });
  await openDirector(page);
  await openProject(page,project.id);
  await page.evaluate(()=>localStorage.setItem('webcap.studio.actionAdvisor.enabled','true'));
  await queueModel(request,'We should check the saved Project Overview next.');
  await queueModel(request,{actions:[{
    kind:'read',label:'Read saved Overview',
    projectId:project.id,fields:['overview']
  }]});
  await say(page,'What should we confirm before revising the Project?');
  const advice=page.locator('#studio-action-advisor-actions');
  await expect(advice.locator('button')).toHaveCount(1,{timeout:30000});
  await advice.locator('button').click();
  await expect(page.locator('#studio-dw-read-panel')).toBeVisible();
  await expect(page.locator('#studio-dw-read-project')).toHaveValue(project.id);
  await expect(page.locator('#studio-dw-project-fields input[data-group-select]').first()).toBeChecked();
  await expect(page.locator('#director-chat-messages')).not.toContainText('The compass points toward a red tower.');
  await expect.poll(async()=> (await observedModels(request)).calls.length).toBe(2);
  await page.locator('#studio-dw-read-send').click();
  await expect(page.locator('#director-chat-messages')).toContainText('The compass points toward a red tower.');
  expect((await observedModels(request)).calls).toHaveLength(2);
});


test('Advisor setting is global and the model selector is absent',async({page,request})=>{
  await resetModel(request);
  await openDirector(page);
  await expect(page.locator('#studio-action-advisor-model, #studio-action-advisor-enabled')).toHaveCount(0);
  await page.locator('#director-chat-close').click();
  await page.locator('#shell-more-btn').click();
  await expect(page.locator('#shell-settings-btn')).toBeVisible();
  await page.locator('#shell-settings-btn').click();
  await page.locator('#app-settings-tab-director').click();
  await expect(page.locator('#app-settings-studio-action-advisor')).toBeChecked();
  await page.locator('#app-settings-studio-action-advisor').uncheck();
  await page.locator('#app-settings-save-btn').click();
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('webcap.studio.actionAdvisor.enabled'))).toBe('false');
});
