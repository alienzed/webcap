'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,queueModel,observedModels,openDirector,say,story,stories,
  seedProject,seedScene,openProject,runWrite}=require('./helpers.cjs');

test('ordinary structured chat output is visible as text but never creates a Write action',async({page,request})=>{
  await resetModel(request);
  await openDirector(page);
  const raw={changes:{project:{title:'Kitten Chaos',
    concept:'Playful kitten mishaps.',style:'Soft natural light.',invariants:[]}}};
  await queueModel(request,raw);
  await say(page,"Let's discuss kittens doing silly things.");
  const reply=page.locator('#director-chat-messages .director-chat-message-assistant').last()
    .locator('.director-chat-message-body');
  await expect(reply).toContainText('Kitten Chaos');
  await expect(page.locator('#studio-dw-suggestions .studio-dw-suggestion-action')).toHaveCount(0);
  expect((await observedModels(request)).calls).toHaveLength(1);
});

test('Project and Scene Writes are separate explicit model requests and persistence operations',async({page,request})=>{
  await resetModel(request);
  const source=await seedProject(page,'Mixed Source '+Date.now(),{
    concept:'The night watchman notices an empty train.',style:'Warm amber light.'
  });
  await openDirector(page);
  await openProject(page,source.id);
  const newScene={title:'Platform',
    prompt:'A night watchman walks toward the stationary midnight train in wide blue light.',
    durationSeconds:8};
  await queueModel(request,{scenes:[newScene]});
  await runWrite(page,{projectId:source.id,operation:'scene-write',sceneMode:'create',
    instruction:'Write the platform opening Scene.'});
  await expect.poll(async()=> (await story(page,source.id)).sceneOrder.length).toBe(1);
  expect((await story(page,source.id)).style).toBe('Warm amber light.');

  const futureTitle='Another Project '+Date.now();
  await queueModel(request,{title:futureTitle,concept:'A watchman discovers a sealed train.',
    style:'Cool blue moonlight.',invariants:[]});
  await runWrite(page,{operation:'new-project',instruction:'Create the separate night-train Project.'});
  await expect.poll(async()=> (await stories(page)).some(p=>p.title===futureTitle)).toBe(true);
  const created=(await stories(page)).find(p=>p.title===futureTitle);
  expect((await story(page,created.id)).style).toBe('Cool blue moonlight.');
  const savedSource=await story(page,source.id);
  expect(savedSource.scenes[savedSource.sceneOrder[0]].prompt).toBe(newScene.prompt);
  expect(savedSource.style).toBe('Warm amber light.');
  expect((await observedModels(request)).calls).toHaveLength(2);
});

test('explicit existing-Scene revision saves directly without an editable Review stage',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'Direct Scene Revision '+Date.now(),{
    concept:'An evening arrival.',style:'Blue twilight.'
  });
  const scene=await seedScene(page,project.id,{
    title:'Station',prompt:'A watchman crosses the empty platform.',durationSeconds:8
  });
  await openDirector(page);
  await openProject(page,project.id);
  const prompt='A watchman approaches the silent station doorway beneath blue moonlight.';
  await queueModel(request,{prompt,title:'Unrequested title',durationSeconds:12});
  await runWrite(page,{projectId:project.id,operation:'scene-write',sceneMode:'revise',
    sceneIds:[scene.id],instruction:'Make the approach more distinctive.'});
  await expect.poll(async()=> (await story(page,project.id)).scenes[scene.id].prompt).toBe(prompt);
  const saved=(await story(page,project.id)).scenes[scene.id];
  expect(saved.title).toBe('Station');
  expect(saved.durationSeconds).toBe(8);
  await expect(page.locator('#studio-dw-scene-review')).not.toBeVisible();
  expect((await observedModels(request)).calls).toHaveLength(1);
});
