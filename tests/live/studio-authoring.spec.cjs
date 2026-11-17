'use strict';
const {test,expect}=require('../browser/test.cjs');
const {openLiveDirector,attachProject,approveOverview,sendLive,writeLive,observeLiveCalls,
  addEvidence,story,stories,seedProject,seedScene}=require('./helpers.cjs');

test('Live Flow 1 — real Project Write persists the authored Overview directly',async({page},info)=>{
  const model=await openLiveDirector(page),observed=observeLiveCalls(page);
  const title='Real Model Project '+Date.now();
  const direction='Create a Project titled '+title+'. Concept: a bookseller opens a shop in a rainy city. '+
    'Visual atmosphere: amber light and blue rain. Include an Invariant: the bookseller wears a red scarf.';
  await sendLive(page,'Discuss a visually distinctive rainy-city bookshop with a recurring red scarf.');
  await writeLive(page,{operation:'new-project',instruction:direction});
  await expect.poll(async()=>(await stories(page)).some(p=>p.title===title),{timeout:60000}).toBe(true);
  const created=(await stories(page)).find(p=>p.title===title);
  const saved=await story(page,created.id);
  const request=observed.requests.at(-1),receipt=observed.jobs.at(-1);
  expect(request.operation).toBe('studio_project_draft');
  expect(JSON.stringify(request.messages)).not.toContain('H3 PROMPT AUTHORING REFERENCE');
  expect(saved.title).toBe(title);
  expect(saved.concept.trim()).toBeTruthy();
  expect(saved.style.trim()).toBeTruthy();
  expect(saved.invariants.some(item=>typeof item.text==='string' && item.text.trim())).toBe(true);
  expect(saved.sceneOrder).toHaveLength(0);
  await page.reload();
  expect((await story(page,created.id)).invariants).toEqual(saved.invariants);
  await addEvidence(info,page,model,direction,{request,receipt,saved});
});

test('Live Flow 2 — real explicit Scene Write saves actual complete Scene records',async({page},info)=>{
  const project=await seedProject(page,'Live Scenes '+Date.now());
  const model=await openLiveDirector(page);
  await attachProject(page,project);
  const observed=observeLiveCalls(page);
  const direction='Create two distinct Scenes for the same bookshop story, entering the shop and discovering a glowing map. '+
    'Use complete H3 prompts, titles, and durations of eight and twelve seconds.';
  await writeLive(page,{projectId:project.id,operation:'scene-write',sceneMode:'create',instruction:direction});
  await expect.poll(async()=>(await story(page,project.id)).sceneOrder.length,{timeout:60000}).toBeGreaterThan(0);
  const saved=await story(page,project.id),request=observed.requests.at(-1),receipt=observed.jobs.at(-1);
  expect(request.operation).toBe('studio_scenes_draft');
  expect(JSON.stringify(request.messages)).toContain('H3 PROMPT AUTHORING REFERENCE');
  const scenes=saved.sceneOrder.map(id=>saved.scenes[id]);
  for(const scene of scenes){
    expect(scene.title.trim()).toBeTruthy();
    expect(scene.prompt.trim()).toBeTruthy();
    expect(Number.isInteger(scene.durationSeconds)).toBe(true);
  }
  await page.reload();
  expect((await story(page,project.id)).sceneOrder).toEqual(saved.sceneOrder);
  await addEvidence(info,page,model,direction,{request,receipt,scenes});
});

test('Live Flow 4 — approved Overview and Scene references reach real chat but do not authorize saving',async({page},info)=>{
  const project=await seedProject(page,'Live Read '+Date.now(),{
    concept:'A silver gate stands in a blue courtyard.',style:'Soft dusk.'
  });
  const scene=await seedScene(page,project.id,{
    title:'Courtyard Gate',prompt:'A visitor opens a silver gate.',durationSeconds:8
  });
  const model=await openLiveDirector(page);
  await attachProject(page,project);
  const observed=observeLiveCalls(page);
  await approveOverview(page,project.id);
  await sendLive(page,'Discuss the approved setting briefly. Do not write or save.');
  expect(JSON.stringify(observed.requests[0].messages)).toContain(project.concept);
  expect(JSON.stringify(observed.requests[0].messages)).not.toContain(scene.prompt);
  await page.locator('#director-chat-context-approve').click();
  await page.locator('#studio-dw-read-project').selectOption(project.id);
  const selection=page.locator('#studio-dw-read-selection');
  if(await selection.getAttribute('open')===null) await selection.locator('summary').click();
  await page.locator('#studio-dw-scene-fields input[data-group-select]').first().check();
  await page.locator('#studio-dw-read-send').click();
  await sendLive(page,'Discuss the physical action in the approved Scene without changing it.');
  const messages=JSON.stringify(observed.requests.at(-1).messages);
  expect(messages).toContain(project.concept);
  expect(messages).toContain(scene.prompt);
  const actual=await story(page,project.id);
  expect(actual.concept).toBe(project.concept);
  expect(actual.scenes[scene.id].prompt).toBe(scene.prompt);
  await addEvidence(info,page,model,'Approved Read context',{outbound:observed.requests,saved:actual});
});

test('Live Flow 3 — real Project revision saves only returned fields without modifying unrelated Scenes',async({page},info)=>{
  const project=await seedProject(page,'Live Revision '+Date.now(),{
    concept:'A quiet library on a winter night.',style:'Cold blue window light.'
  });
  const scene=await seedScene(page,project.id,{
    title:'First visitor',prompt:'A visitor walks through the main door.',durationSeconds:8
  });
  const model=await openLiveDirector(page);
  await attachProject(page,project);
  const observed=observeLiveCalls(page);
  await approveOverview(page,project.id);
  const direction='Revise only the Project visual atmosphere to a warm amber-lit interior. '+
    'Preserve Project concept, Scene prompts, and durations.';
  await writeLive(page,{projectId:project.id,operation:'project',instruction:direction});
  await expect.poll(async()=>(await story(page,project.id)).style,
    {timeout:60000}).not.toBe(project.style);
  const saved=await story(page,project.id);
  expect(saved.concept).toBe(project.concept);
  expect(saved.scenes[scene.id].prompt).toBe(scene.prompt);
  expect(saved.scenes[scene.id].durationSeconds).toBe(8);
  expect(observed.requests.at(-1).operation).toBe('studio_brief_draft');
  await page.reload();
  expect((await story(page,project.id)).style).toBe(saved.style);
  await addEvidence(info,page,model,direction,{request:observed.requests.at(-1),
    receipt:observed.jobs.at(-1),saved});
});
