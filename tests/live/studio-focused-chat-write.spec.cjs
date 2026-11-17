'use strict';
const {test,expect}=require('../browser/test.cjs');
const {openLiveDirector,sendLive,waitForLiveJob,seedProject,story,stories}=require('./helpers.cjs');

// Real provider acceptance for the replacement contract: Chat never authors
// structured fields; only the explicit Write action does. These tests are
// independent of the historical mixed-response Review fixtures.
test('LIVE focused Director — natural Chat then explicit Scene Write uses the conversation',async({page},testInfo)=>{
  const project=await seedProject(page,'Focused Scene '+Date.now(),{
    concept:'A courier finds a red mitten on an empty railway platform.',
    style:'Blue dawn, a still camera, restrained sound.'
  });
  const model=await openLiveDirector(page);
  const requests=[];
  page.on('request',request=>{
    if(new URL(request.url()).pathname!=='/fs/director/chat' || request.method()!=='POST')return;
    try {requests.push(request.postDataJSON());}catch{}
  });
  const instruction='Discuss two ways to stage the courier finding a red mitten at an empty '+
    'railway station, and recommend the stronger approach.';
  await sendLive(page,instruction);
  expect(requests).toHaveLength(1);
  expect(requests[0].operation).toBe('studio_chat');
  expect(JSON.stringify(requests[0].messages)).not.toContain('H3 PROMPT AUTHORING REFERENCE');
  const reply=await page.locator('#director-chat-messages .director-chat-message-assistant').last().innerText();
  expect(reply.trim().length).toBeGreaterThan(25);
  expect((await story(page,project.id)).sceneOrder).toHaveLength(0);

  await page.locator('#studio-dw-write').click();
  await page.locator('#studio-dw-write-operation').selectOption('scene-write');
  await page.locator('#studio-dw-write-project').selectOption(project.id);
  await page.locator('#studio-dw-scene-mode').selectOption('create');
  await page.locator('#studio-dw-write-instruction').fill(
    'Write one eight-second Scene using the staging you recommended in our conversation.');
  await waitForLiveJob(page,()=>page.locator('#studio-dw-write-prepare').click());
  await expect.poll(async()=> (await story(page,project.id)).sceneOrder.length,
    {timeout:30000}).toBe(1);
  const saved=await story(page,project.id);
  const scene=saved.scenes[saved.sceneOrder[0]];
  expect(scene.prompt.trim().length).toBeGreaterThan(80);
  expect(scene.prompt).toMatch(/mitten/i);
  expect(requests.length).toBe(2);
  expect(requests[1].operation).toBe('studio_scenes_draft');
  const sent=JSON.stringify(requests[1].messages);
  expect(sent).toContain(instruction);
  expect(sent).toContain(reply.trim().slice(0,30));
  expect(sent).toContain('H3 PROMPT AUTHORING REFERENCE');
  await expect(page.locator('#studio-scenes-review')).not.toBeVisible();
  await testInfo.attach('focused-chat-scene-write-evidence',{
    body:Buffer.from(JSON.stringify({model,requests,savedScene:scene},null,2)),
    contentType:'application/json'
  });
});

test('LIVE focused Director — explicit Project Write saves without a Review modal',async({page},testInfo)=>{
  const model=await openLiveDirector(page);
  const title='Focused Live Project '+Date.now();
  await sendLive(page,'Explore a short film about an old lighthouse keeper discovering a '+
    'paper crane on a stormy beach. Discuss its mood and central premise.');
  const before=(await stories(page)).map(p=>p.id);
  await page.locator('#studio-dw-write').click();
  await page.locator('#studio-dw-write-operation').selectOption('new-project');
  await waitForLiveJob(page,()=>page.locator('#studio-dw-write-prepare').click());
  await expect.poll(async()=> (await stories(page)).some(p=>!before.includes(p.id)),
    {timeout:30000}).toBe(true);
  const created=(await stories(page)).find(p=>!before.includes(p.id));
  const saved=await story(page,created.id);
  expect(saved.concept.trim().length).toBeGreaterThan(15);
  expect(saved.style.trim().length).toBeGreaterThan(5);
  await expect(page.locator('#studio-project-review')).not.toBeVisible();
  await testInfo.attach('focused-project-write-evidence',{
    body:Buffer.from(JSON.stringify({model,title,saved},null,2)),
    contentType:'application/json'
  });
});
