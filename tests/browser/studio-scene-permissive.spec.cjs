'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,queueModel,observedModels,openDirector,seedProject,story,runWrite}=require('./helpers.cjs');

test('Scene Write saves each usable Scene without duration, title-length or count quality gates',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'Permissive Studio Scene Write '+Date.now());
  await openDirector(page);
  const longTitle='Long scene title '.repeat(18);
  const returned={scenes:[
    {title:longTitle,prompt:'An uninterrupted camera move follows the performer.',durationSeconds:18.5,shotNotes:'Independent additional material'},
    {prompt:'A second performer enters from the corridor.',durationSeconds:12},
    {title:'Incomplete',prompt:'This complete prompt must remain available in raw I/O.'}
  ]};
  await queueModel(request,returned);
  await runWrite(page,{projectId:project.id,operation:'scene-write',sceneMode:'create',
    instruction:'Create the returned Scenes using the intended timing.'});
  await expect.poll(async()=> (await story(page,project.id)).sceneOrder.length).toBe(2);
  const saved=await story(page,project.id);
  const scenes=saved.sceneOrder.map(id=>saved.scenes[id]);
  expect(scenes[0].title).toBe(longTitle.trim());
  expect(scenes[0].durationSeconds).toBe(18.5);
  expect(scenes[1].title).toBe('');
  expect(scenes[1].prompt).toContain('second performer');
  expect((await observedModels(request)).calls).toHaveLength(1);
  await expect(page.locator('#director-studio-action-status')).toContainText('Scene 3: missing or unusable durationSeconds');

  // Raw Write result is diagnostic history, not invisible context or a second LLM call.
  await expect.poll(async()=>{
    const response=await page.request.get('/fs/director/chats');
    const listing=await response.json();
    const active=listing.activeByMode.storyboard;
    if(!active)return false;
    const savedChat=await page.request.get('/fs/director/chats/'+encodeURIComponent(active));
    const entry=(await savedChat.json()).chat.writeIo?.at(-1);
    return entry?.rawResponse===JSON.stringify(returned);
  }).toBeTruthy();
  await page.reload();
  const response=await page.request.get('/fs/director/chats');
  const active=(await response.json()).activeByMode.storyboard;
  const savedChat=await page.request.get('/fs/director/chats/'+encodeURIComponent(active));
  expect((await savedChat.json()).chat.writeIo.at(-1).rawResponse).toBe(JSON.stringify(returned));
});

test('Scene save route accepts more than 32 records with long titles and authored durations',async({page})=>{
  const project=await seedProject(page,'Long Scene Block '+Date.now());
  const drafts=Array.from({length:33},(_,index)=>({
    title:'Extended Scene '+index+' '.repeat(275),
    prompt:'A valid Scene Prompt '+index,
    durationSeconds:16.5
  }));
  const response=await page.request.post('/fs/studio/director/scenes-draft',{data:{
    storyId:project.id,expectedSceneOrder:[],scenes:drafts,placement:'end',relativeSceneId:''
  }});
  expect(response.ok(),await response.text()).toBeTruthy();
  const data=await response.json();
  expect(data.scenes).toHaveLength(33);
  expect(data.scenes[0].title).toBe(drafts[0].title.trim());
  expect(data.scenes[0].durationSeconds).toBe(16.5);
});
