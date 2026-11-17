'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,queueModel,observedModels,openDirector,say,story,stories,
  seedProject,seedScene,openProject,reopenDirectorIfClosed,runWrite}=require('./helpers.cjs');

test('Pivot: explicit new Project Write never overwrites the currently selected Project',async({page,request})=>{
  await resetModel(request);
  const original=await seedProject(page,'Pivot Source '+Date.now(),{
    concept:'An unrelated lighthouse adventure.',style:'Blue storm light.'
  });
  await openDirector(page);
  await openProject(page,original.id);
  const title='New Pivot '+Date.now();
  await queueModel(request,{title,concept:'A woodcarver creates a tiny automaton.',
    style:'Warm golden morning light.',invariants:[]});
  await runWrite(page,{operation:'new-project',instruction:'Create the woodcarver Project we discussed.'});
  await expect.poll(async()=> (await stories(page)).some(item=>item.title===title)).toBeTruthy();
  const created=(await stories(page)).find(item=>item.title===title);
  expect((await story(page,created.id)).style).toBe('Warm golden morning light.');
  expect((await story(page,original.id)).style).toBe('Blue storm light.');
  expect((await observedModels(request)).calls).toHaveLength(1);
});

test('Cross-Project Read sources inform explicit Write but never redirect its destination',async({page,request})=>{
  await resetModel(request);
  const a=await seedProject(page,'Pacing Reference '+Date.now(),{
    concept:'A sequence of rapid linked actions.',style:'Documentary natural light.'
  });
  const b=await seedProject(page,'Destination '+Date.now(),{
    concept:'An unrelated workshop.',style:'Cold blue evening.'
  });
  const c=await seedProject(page,'Character Reference '+Date.now(),{
    concept:'A separate world not involved in this destination.',
    style:'Different unrelated lighting.',
    invariants:[{kind:'character',title:'Mara',text:'Mara has a silver hairpin.'}]
  });
  const sourceScene=await seedScene(page,b.id,{
    title:'Reference Character',prompt:'A violin maker enters through a red doorway.',durationSeconds:8
  });
  await openDirector(page);
  await openProject(page,b.id);
  await reopenDirectorIfClosed(page);
  const share=page.locator('#director-chat-context-approve');
  await share.click();
  await page.locator('#studio-dw-read-project').selectOption(a.id);
  await page.locator('#studio-dw-read-send').click();
  await share.click();
  await page.locator('#studio-dw-read-project').selectOption(b.id);
  await page.locator('#studio-dw-read-selection summary').click();
  await page.locator('#studio-dw-project-fields input[data-group-select]').first().uncheck();
  await page.locator('#studio-dw-scene-fields input[data-group-select]').first().check();
  await page.locator('#studio-dw-read-send').click();
  await share.click();
  await page.locator('#studio-dw-read-project').selectOption(c.id);
  await page.locator('#studio-dw-project-fields input[data-group-select]').first().uncheck();
  await page.locator('#studio-dw-project-fields input[data-group-select]').last().check();
  await page.locator('#studio-dw-read-send').click();

  await queueModel(request,'We can use the pacing and character details as references.');
  await say(page,'Discuss a tighter atmosphere using the shared sources.');
  await expect.poll(async()=> (await observedModels(request)).calls.length).toBe(1);
  const discussion=(await observedModels(request)).calls[0];
  expect(JSON.stringify(discussion.messages)).toContain('A sequence of rapid linked actions.');
  expect(JSON.stringify(discussion.messages)).toContain('A violin maker enters through a red doorway.');
  expect(JSON.stringify(discussion.messages)).toContain('Mara has a silver hairpin.');
  expect(JSON.stringify(discussion.messages)).not.toContain('A separate world not involved in this destination.');
  expect((await story(page,b.id)).style).toBe('Cold blue evening.');

  await queueModel(request,{style:'Coordinated fast-paced split-screen action.'});
  await runWrite(page,{projectId:b.id,operation:'project',
    instruction:'Apply the tighter atmosphere to the selected Project.'});
  await expect.poll(async()=> (await story(page,b.id)).style).toBe('Coordinated fast-paced split-screen action.');
  expect((await story(page,a.id)).style).toBe('Documentary natural light.');
  expect((await story(page,b.id)).scenes[sourceScene.id].prompt)
    .toBe('A violin maker enters through a red doorway.');
  expect((await observedModels(request)).calls).toHaveLength(2);
});

test('explicit new Scene Write uses the chosen Project, not the navigation suggestion',async({page,request})=>{
  await resetModel(request);
  const a=await seedProject(page,'Scene Source '+Date.now(),{style:'Evening light.'});
  const b=await seedProject(page,'Scene Destination '+Date.now(),{style:'Daylight.'});
  await openDirector(page);
  await openProject(page,a.id);
  const scenes=[
    {title:'Chase',prompt:'A courier crosses a crowded marketplace.',durationSeconds:8},
    {title:'Arrival',prompt:'The courier enters a quiet courtyard.',durationSeconds:12}
  ];
  await queueModel(request,{scenes});
  await runWrite(page,{operation:'scene-write',projectId:b.id,sceneMode:'create',
    instruction:'Create the two courier Scenes in this chosen destination.'});
  await expect.poll(async()=> (await story(page,b.id)).sceneOrder.length).toBe(2);
  const saved=await story(page,b.id);
  expect(saved.sceneOrder.map(id=>saved.scenes[id].prompt)).toEqual(scenes.map(scene=>scene.prompt));
  expect((await story(page,a.id)).sceneOrder).toHaveLength(0);
  expect((await observedModels(request)).calls).toHaveLength(1);
});
