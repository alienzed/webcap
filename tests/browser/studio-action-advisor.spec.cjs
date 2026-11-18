'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,queueModel,observedModels,openDirector,say,seedProject,story,openProject}=require('./helpers.cjs');

test('Action Advisor is opt-in and cannot independently issue a Write',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'Advisor opt out '+Date.now(),{
    concept:'A quiet workshop.',style:'Blue twilight.'
  });
  await openDirector(page);
  await openProject(page,project.id);
  await expect(page.locator('#studio-action-advisor-enabled')).not.toBeChecked();
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
  await page.locator('#studio-action-advisor-enabled').check();
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
