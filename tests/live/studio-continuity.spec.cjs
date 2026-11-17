'use strict';
const {test,expect}=require('../browser/test.cjs');
const {waitForLiveJob,openLiveDirector,attachProject,sendLive,writeLive,observeLiveCalls,
  addEvidence,story,stories,seedProject,openProject,reopenDirectorIfClosed}=require('./helpers.cjs');

test('Live Flow 5 — attachment remains stable through navigation and an explicit Write elsewhere',async({page},info)=>{
  const a=await seedProject(page,'Director A '+Date.now(),{style:'Cool blue light.'});
  const b=await seedProject(page,'Director B '+Date.now(),{style:'Red neon light.'});
  const model=await openLiveDirector(page);
  await attachProject(page,a);
  await openProject(page,b.id);
  await expect(page.locator('#storyboard-story-title')).toHaveValue(b.title);
  await expect(page.locator('#director-chat-title')).toContainText(a.title);
  const observed=observeLiveCalls(page);
  const direction='Revise Project A visual atmosphere to soft silver moonlight. Preserve everything else.';
  await writeLive(page,{projectId:a.id,operation:'project',instruction:direction});
  await expect.poll(async()=>(await story(page,a.id)).style,{timeout:60000}).not.toBe(a.style);
  expect((await story(page,b.id)).style).toBe(b.style);
  await expect(page.locator('#director-chat-title')).toContainText(a.title);
  await addEvidence(info,page,model,direction,{
    request:observed.requests.at(-1),savedA:await story(page,a.id),savedB:await story(page,b.id)
  });
});

test('Live Flow 6 — repeated explicit Scene Writes use fresh models and preserve earlier results',async({page},info)=>{
  const project=await seedProject(page,'Live Separate Writes '+Date.now());
  const model=await openLiveDirector(page);
  await attachProject(page,project);
  const observed=observeLiveCalls(page);
  await sendLive(page,'Our story begins with a bookseller lighting a blue lantern.');
  const first='Write one eight-second Scene with a bookseller lighting a blue lantern.';
  await writeLive(page,{projectId:project.id,operation:'scene-write',sceneMode:'create',instruction:first});
  await expect.poll(async()=>(await story(page,project.id)).sceneOrder.length,{timeout:60000}).toBeGreaterThan(0);
  const intermediate=await story(page,project.id),count=intermediate.sceneOrder.length;
  const second='Write a DIFFERENT ten-second Scene where a visitor unfolds a green map.';
  await writeLive(page,{projectId:project.id,operation:'scene-write',sceneMode:'create',instruction:second});
  await expect.poll(async()=>(await story(page,project.id)).sceneOrder.length,{timeout:60000}).toBeGreaterThan(count);
  const saved=await story(page,project.id);
  for(const sceneId of intermediate.sceneOrder)
    expect(saved.scenes[sceneId].prompt).toBe(intermediate.scenes[sceneId].prompt);
  expect(observed.requests.filter(req=>req.operation==='studio_scenes_draft')).toHaveLength(2);
  await addEvidence(info,page,model,[first,second],{saved,requests:observed.requests});
});

test('Live Flow 7 — conversation survives switching Projects, then an explicit Scene Write saves once',async({page},info)=>{
  const project=await seedProject(page,'Live Return '+Date.now());
  const other=await seedProject(page,'Live Other '+Date.now());
  const model=await openLiveDirector(page);
  await attachProject(page,project);
  const observed=observeLiveCalls(page);
  const discussion='The opening is a small bookshop on a snowy morning; the shop bell rings twice.';
  await sendLive(page,discussion);
  expect((await story(page,project.id)).sceneOrder).toHaveLength(0);
  await openProject(page,other.id);
  await openProject(page,project.id);
  await writeLive(page,{projectId:project.id,operation:'scene-write',sceneMode:'create',
    instruction:'Write the opening eight-second bookshop Scene we discussed.'});
  await expect.poll(async()=>(await story(page,project.id)).sceneOrder.length,{timeout:60000}).toBeGreaterThan(0);
  const saved=await story(page,project.id);
  const request=observed.requests.at(-1);
  expect(JSON.stringify(request.messages)).toContain(discussion);
  expect((await story(page,other.id)).sceneOrder).toHaveLength(0);
  await page.reload();
  expect((await story(page,project.id)).sceneOrder).toEqual(saved.sceneOrder);
  await addEvidence(info,page,model,discussion,{request,saved});
});

test('Live Flow 8 — slash-inserted Studio Block reaches the real Director model as edited text',async({page},testInfo)=>{
  const before=(await stories(page)).map(x=>x.id);
  const model=await openLiveDirector(page);
  await expect(page.locator('#studio-blocks-open')).toBeVisible();
  await page.locator('#studio-blocks-open').click();
  await page.locator('#studio-blocks-new').click();
  const name='Acceptance Lamp Block '+Date.now();
  await page.locator('#studio-blocks-title').fill(name);
  await page.locator('#studio-blocks-content').fill('One amber lamp illuminates a stone doorway.');
  await page.locator('#studio-blocks-save').click();
  await expect(page.locator('#studio-blocks-status')).toHaveText('Saved.');
  await page.locator('#studio-blocks-close').click();
  await reopenDirectorIfClosed(page);
  const composer=page.locator('#director-chat-input');
  await composer.fill('Discuss: /Acceptance  and mention how to frame the shot.');
  await composer.evaluate(node=>{
    const pos=node.value.indexOf('  and mention');node.setSelectionRange(pos,pos);
    node.dispatchEvent(new Event('input',{bubbles:true}));
  });
  const option=page.locator('#studio-blocks-slash').getByRole('option',{name:/Acceptance Lamp Block/});
  await expect(option).toBeVisible();
  await option.click();
  const sent=await composer.inputValue();
  expect(sent).toContain('One amber lamp illuminates a stone doorway.');
  expect(sent).toContain('and mention how to frame the shot.');
  await waitForLiveJob(page,()=>page.locator('#director-chat-send').click());
  await expect.poll(async()=> (await page.locator('#director-chat-messages').innerText()).length,
    {timeout:180000}).toBeGreaterThan(sent.length);
  expect((await stories(page)).map(x=>x.id).sort()).toEqual(before.sort());
  await addEvidence(testInfo,page,model,sent,{block:name,noProjectMutation:true});
});
