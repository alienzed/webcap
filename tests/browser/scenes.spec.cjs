'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,queueModel,observedModels,openDirector,say,stories,story,
  seedProject,openProject,runWrite}=require('./helpers.cjs');

test('explicit new-Scene Write persists actual returned count without a Review stage',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'Two Scenes '+Date.now());
  await openDirector(page);
  await openProject(page,project.id);
  const authored=[
    {title:'Approach',prompt:'A woman approaches an old bookshop beneath amber lamps.',durationSeconds:8},
    {title:'Entering',prompt:'She enters the bookshop through a wooden door.',durationSeconds:12}
  ];
  await queueModel(request,{scenes:authored});
  await runWrite(page,{projectId:project.id,operation:'scene-write',sceneMode:'create',
    instruction:'Create three independently generatable Scenes with different durations.'});
  await expect.poll(async()=> (await story(page,project.id)).sceneOrder.length).toBe(2);
  const saved=await story(page,project.id);
  const actual=saved.sceneOrder.map(id=>saved.scenes[id]);
  expect(actual.map(scene=>scene.title)).toEqual(['Approach','Entering']);
  expect(actual.map(scene=>scene.durationSeconds)).toEqual([8,12]);
  expect(actual.map(scene=>scene.prompt)).toEqual(authored.map(scene=>scene.prompt));
  const calls=(await observedModels(request)).calls;
  expect(calls).toHaveLength(1);
  const schema=calls[0].response_format.json_schema.schema.properties.scenes.items;
  expect(schema.required).toEqual(['title','prompt','durationSeconds']);
  expect(JSON.stringify(calls[0].messages)).toContain('H3 PROMPT AUTHORING REFERENCE');
  await expect(page.locator('#studio-scenes-review')).not.toBeVisible();
  await page.reload();
  expect((await story(page,project.id)).sceneOrder).toEqual(saved.sceneOrder);
});

test('repeated explicit Scene Writes each author a fresh record in the same Project',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'Repeated Scenes '+Date.now());
  await openDirector(page);
  await openProject(page,project.id);
  await queueModel(request,'The first Scene should establish the space.');
  await say(page,'I want a quiet bookshop arrival.');
  await expect.poll(async()=> (await observedModels(request)).calls.length).toBe(1);
  await queueModel(request,{scenes:[
    {title:'First',prompt:'First unique Scene prompt.',durationSeconds:8}
  ]});
  await runWrite(page,{projectId:project.id,operation:'scene-write',sceneMode:'create'});
  await expect.poll(async()=> (await story(page,project.id)).sceneOrder.length).toBe(1);
  await queueModel(request,{scenes:[
    {title:'Second',prompt:'Second unique Scene prompt.',durationSeconds:10}
  ]});
  await runWrite(page,{projectId:project.id,operation:'scene-write',sceneMode:'create'});
  await expect.poll(async()=> (await story(page,project.id)).sceneOrder.length).toBe(2);
  const saved=await story(page,project.id);
  expect(saved.sceneOrder.map(id=>saved.scenes[id].prompt))
    .toEqual(['First unique Scene prompt.','Second unique Scene prompt.']);
  const calls=(await observedModels(request)).calls;
  expect(calls).toHaveLength(3);
  expect(JSON.stringify(calls[2].messages)).toContain('I want a quiet bookshop arrival.');
  await expect(page.locator('#studio-scenes-review')).not.toBeVisible();
});

test('usable returned Scene survives invalid sibling without inventing a repair',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'Partial Scene Batch '+Date.now());
  await openDirector(page);
  await openProject(page,project.id);
  await queueModel(request,{scenes:[
    {title:'Complete',prompt:'A complete scene by the window.',durationSeconds:8},
    {title:'Incomplete',prompt:'',durationSeconds:99}
  ]});
  await runWrite(page,{projectId:project.id,operation:'scene-write',sceneMode:'create',
    instruction:'Write the usable Scenes.'});
  await expect.poll(async()=> (await story(page,project.id)).sceneOrder.length).toBe(1);
  const saved=await story(page,project.id);
  expect(saved.scenes[saved.sceneOrder[0]].title).toBe('Complete');
  expect((await observedModels(request)).calls).toHaveLength(1);
  await expect(page.locator('#studio-dw-status')).toContainText('1 returned record');
});

test('unusable Scene result is exposed but does not create default titles or durations',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'Invalid Scene '+Date.now());
  await openDirector(page);
  await openProject(page,project.id);
  await queueModel(request,{scenes:[
    {title:'Invalid',prompt:'',durationSeconds:99}
  ]});
  await runWrite(page,{projectId:project.id,operation:'scene-write',sceneMode:'create',
    instruction:'Write the invalid Scene only if it has persistable fields.'});
  await expect(page.locator('#studio-dw-status')).toContainText('no Scene records with persistable fields');
  expect((await story(page,project.id)).sceneOrder).toHaveLength(0);
  expect((await observedModels(request)).calls).toHaveLength(1);
});

test('ordinary chat action hints never write Scenes; an explicit Scene Write does',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'Hints Are Inert '+Date.now());
  await openDirector(page);
  await openProject(page,project.id);
  await queueModel(request,{
    reply:'Draft ready',action:{kind:'create_scene',instruction:'Create a Scene'},
    scenes:[{title:'Unexpected',prompt:'A figure crosses a bridge.',durationSeconds:8}]
  });
  await say(page,'Tell me what a stone-bridge Scene could be.');
  await expect.poll(async()=> (await observedModels(request)).calls.length).toBe(1);
  expect((await story(page,project.id)).sceneOrder).toHaveLength(0);
  await expect(page.locator('#studio-dw-suggestions .studio-dw-suggestion-action')).toHaveCount(0);
  await queueModel(request,{scenes:[
    {title:'Crossing',prompt:'A figure crosses a stone bridge.',durationSeconds:12}
  ]});
  await runWrite(page,{projectId:project.id,operation:'scene-write',sceneMode:'create'});
  await expect.poll(async()=> (await story(page,project.id)).sceneOrder.length).toBe(1);
  expect((await observedModels(request)).calls).toHaveLength(2);
});
