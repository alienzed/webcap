'use strict';
const {test,expect}=require('../browser/test.cjs');
const {openLiveDirector,attachProject,sendLive,writeLive,observeLiveCalls,
  story,stories,seedProject,seedScene,openProject,reopenDirectorIfClosed}=require('./helpers.cjs');

async function evidence(info,name,value){
  await info.attach(name,{body:Buffer.from(JSON.stringify(value,null,2)),contentType:'application/json'});
}
function decoded(receipt,operation){
  try{return JSON.parse(receipt.raw);}catch(error){
    throw new Error(operation+' returned invalid structured JSON: '+error.message+
      '\nRaw response:\n'+receipt.raw);
  }
}

test('LIVE contract — explicitly requested Scene revision must return a full nonoptional prompt',async({page},testInfo)=>{
  const project=await seedProject(page,'Live required Prompt '+Date.now(),{
    concept:'A courier delivers a parcel at a foggy seaside lighthouse.',
    style:'Quiet overcast morning.'});
  const model=await openLiveDirector(page);
  const original='A courier walks through wet grass toward a white lighthouse carrying a sealed parcel.';
  const scene=await seedScene(page,project.id,{title:'Lighthouse Delivery',prompt:original,durationSeconds:8});
  const instruction='The courier should discover a brass compass in the grass while approaching the lighthouse. '+
    'Keep the sealed parcel, the foggy setting, and the original eight-second action. Rewrite this Scene.';
  // This isolates the existing scoped Write operation and its server schema.
  // The full in-app conversational revision is exercised separately below.
  const guidanceResponse=await page.request.get('/fs/studio/director/guidance?targetModel=minimax_h3');
  expect(guidanceResponse.ok()).toBeTruthy();
  const guidance=await guidanceResponse.json();
  expect(guidance.system).toBeTruthy();
  expect(guidance.promptContract).toBeTruthy();
  const outbound=[{
    role:'system',
    content:guidance.system+'\n\nH3 PROMPT AUTHORING REFERENCE:\n'+guidance.promptContract
  },{
    role:'user',
    content:JSON.stringify({
      task:'Revise the requested fields of this Scene in the author\'s direction. '+
        'When changing creative content, return the complete replacement H3 Prompt. '+
        'Preserve all unaffected details and the established timing. '+
        'Return the requested field values in one JSON object.',
      authorDirection:instruction,requestedFields:['prompt'],
      savedScene:{fields:[
        {id:'scene:'+scene.id+':title',value:scene.title},
        {id:'scene:'+scene.id+':prompt',value:scene.prompt},
        {id:'scene:'+scene.id+':durationSeconds',value:scene.durationSeconds}
      ]},
    })
  }];
  const response=await page.request.post('/fs/director/chat',{data:{
    model,operation:'studio_scene_field_draft',requiredFields:['prompt'],messages:outbound
  }});
  expect(response.ok(),'Real Director revision was not queued: '+await response.text()).toBeTruthy();
  const initial=(await response.json()).job;
  expect(initial?.jobId).toBeTruthy();
  const schema=initial.request?.responseSchema;
  expect(schema,'The real Director job did not expose its operation-specific schema').toBeTruthy();
  expect(schema.required,'WebCap sent prompt as optional on an explicitly requested Scene rewrite')
    .toContain('prompt');
  expect(schema.properties.prompt.minLength).toBe(1);
  let terminal;
  await expect.poll(async()=>{
    const poll=await page.request.get('/fs/director/job?job='+encodeURIComponent(initial.jobId));
    if(!poll.ok())throw new Error('Director job receipt unavailable: '+await poll.text());
    terminal=(await poll.json()).job;
    return ['completed','failed','stopped','cancelled','interrupted'].includes(terminal?.status);
  },{timeout:300000,intervals:[600,1400,2500]}).toBe(true);
  await evidence(testInfo,'actual-required-prompt-model-receipt',{model,instruction,job:terminal});
  expect(terminal.status,'The real model must complete the explicitly required prompt operation').toBe('completed');
  let authored;
  try{authored=JSON.parse(terminal.result?.text||'');}
  catch(error){throw new Error('Real model violated required Scene JSON schema: '+error.message+
    '\nActual response: '+String(terminal.result?.text||''));}
  expect(Object.prototype.hasOwnProperty.call(authored,'prompt'),
    'The real model response omitted the schema-required prompt field').toBe(true);
  expect(typeof authored.prompt).toBe('string');
  expect(authored.prompt.trim().length,'The real model must author a complete replacement prompt')
    .toBeGreaterThan(80);
  expect(authored.prompt).not.toBe(original);
  expect(authored.prompt).toMatch(/compass/i);
  const saved=await story(page,project.id);
  expect(saved.sceneOrder).toEqual([scene.id]);
  expect(saved.scenes[scene.id].prompt).toBe(original);
  expect(saved.scenes[scene.id].durationSeconds).toBe(8);
});


test('LIVE creative partnership — chat recommends staging, explicit Write authors and saves the chosen Scene',async({page},info)=>{
  const project=await seedProject(page,'Live Creative Partner '+Date.now(),{
    concept:'A night porter finds a paper crane caught in a railway station doorway.',
    style:'Rain-slick blue twilight, restrained and humane.'
  });
  const model=await openLiveDirector(page);
  await attachProject(page,project);
  const observed=observeLiveCalls(page);
  const discussion='An eight-second Scene about a night porter finding a paper crane in a station door feels flat. '+
    'Suggest two distinctly staged alternatives and recommend the stronger one with a short reason. '+
    'We are discussing it, not writing it yet.';
  await sendLive(page,discussion);
  const discussionReceipt=await observed.last();
  await evidence(info,'live-creative-discussion',{model,request:observed.requests[0],receipt:discussionReceipt});
  expect(observed.requests[0].operation).toBe('studio_chat');
  expect(observed.requests[0].messages[0].content).not.toContain('H3 PROMPT AUTHORING REFERENCE');
  expect(discussionReceipt.raw.trim().length).toBeGreaterThan(40);
  expect((await story(page,project.id)).sceneOrder).toHaveLength(0);

  const instruction='Write the complete eight-second Scene using the staging you recommended. '+
    'Preserve the night porter, paper crane, railway station doorway and rain-slick blue twilight.';
  await writeLive(page,{projectId:project.id,operation:'scene-write',sceneMode:'create',instruction});
  await expect.poll(async()=>(await story(page,project.id)).sceneOrder.length,{timeout:60000}).toBeGreaterThan(0);
  const saved=await story(page,project.id);
  const writeReceipt=observed.jobs.at(-1),writeRequest=observed.requests.at(-1);
  await evidence(info,'live-creative-scene-write',{model,instruction,request:writeRequest,
    receipt:writeReceipt,saved:saved.sceneOrder.map(id=>saved.scenes[id])});
  expect(observed.requests).toHaveLength(2);
  expect(writeRequest.operation).toBe('studio_scenes_draft');
  expect(JSON.stringify(writeRequest.messages)).toContain(discussion);
  expect(JSON.stringify(writeRequest.messages)).toContain(discussionReceipt.raw);
  expect(JSON.stringify(writeRequest.messages)).toContain('H3 PROMPT AUTHORING REFERENCE');
  const parsed=decoded(writeReceipt,'Scene Write');
  expect(Array.isArray(parsed.scenes)).toBe(true);
  const scene=saved.scenes[saved.sceneOrder[0]];
  expect(typeof scene.title).toBe('string');
  expect(scene.prompt.trim().length).toBeGreaterThan(40);
  expect(scene.durationSeconds).toBe(8);
  expect((await story(page,project.id)).sceneOrder.length).toBe(parsed.scenes.length);
});

test('LIVE Scene Write — explicitly chosen destination saves actual returned Scenes, not chat suggestions',async({page},info)=>{
  const source=await seedProject(page,'Live Reference '+Date.now(),{style:'Cool afternoon light.'});
  const target=await seedProject(page,'Live Destination '+Date.now(),{style:'Warm sunrise.'});
  const model=await openLiveDirector(page);
  await attachProject(page,source);
  const observed=observeLiveCalls(page);
  const direction='Two distinct eight-second Scenes about a courier arriving at a seaside lighthouse and discovering a parcel.';
  await sendLive(page,'Discuss the staging for '+direction);
  expect((await story(page,source.id)).sceneOrder).toHaveLength(0);
  await writeLive(page,{projectId:target.id,operation:'scene-write',sceneMode:'create',
    instruction:'Write '+direction+' Create two complete independent Scene prompts.'});
  await expect.poll(async()=>(await story(page,target.id)).sceneOrder.length,{timeout:60000}).toBeGreaterThan(0);
  const writeRequest=observed.requests.at(-1),receipt=observed.jobs.at(-1);
  const parsed=decoded(receipt,'Scene Write');
  const saved=await story(page,target.id);
  await evidence(info,'actual-scenes-and-destination',{model,writeRequest,receipt,
    saved:saved.sceneOrder.map(id=>saved.scenes[id])});
  expect(writeRequest.operation).toBe('studio_scenes_draft');
  expect((await story(page,source.id)).sceneOrder).toHaveLength(0);
  expect(saved.sceneOrder.length).toBe(parsed.scenes.length);
  for(const id of saved.sceneOrder){
    const scene=saved.scenes[id];
    expect(scene.title.trim()).toBeTruthy();
    expect(scene.prompt.trim()).toBeTruthy();
    expect(Number.isInteger(scene.durationSeconds)).toBe(true);
  }
});

test('LIVE Project pivot — explicit new Project Write never changes the open Project',async({page},info)=>{
  const original=await seedProject(page,'Live Existing '+Date.now(),{
    concept:'A coastguard searches a lighthouse.',style:'Dark storm light.'});
  const model=await openLiveDirector(page);
  await attachProject(page,original);
  const observed=observeLiveCalls(page);
  const title='Live Automaton '+Date.now();
  await sendLive(page,'Discuss a separate story about a woodcarver building a mechanical bird.');
  const direction='Create a NEW Project titled '+title+'. Concept: a woodcarver builds a tiny mechanical bird. '+
    'Visual atmosphere: warm golden workshop light. Include an Invariant: the bird has a copper beak.';
  await writeLive(page,{operation:'new-project',instruction:direction});
  await expect.poll(async()=>(await stories(page)).some(item=>item.title===title),{timeout:60000}).toBe(true);
  const created=(await stories(page)).find(item=>item.title===title);
  const saved=await story(page,created.id),untouched=await story(page,original.id);
  await evidence(info,'actual-project-pivot',{model,writeRequest:observed.requests.at(-1),
    receipt:observed.jobs.at(-1),saved,untouched});
  expect(observed.requests.at(-1).operation).toBe('studio_project_draft');
  expect(JSON.stringify(observed.requests.at(-1).messages)).not.toContain('H3 PROMPT AUTHORING REFERENCE');
  expect(saved.invariants.length).toBeGreaterThan(0);
  expect(untouched.concept).toBe(original.concept);
  expect(untouched.style).toBe(original.style);
});

test('LIVE existing Scene revision — explicit selected target changes prompt and preserves sibling',async({page},info)=>{
  const project=await seedProject(page,'Live Scene Revision '+Date.now(),{
    concept:'A night watchman visits a railway station.',style:'Wet blue evening.'
  });
  const first=await seedScene(page,project.id,{
    title:'Platform',prompt:'A watchman walks through a railway station at night.',durationSeconds:8
  });
  const second=await seedScene(page,project.id,{
    title:'Ticket office',prompt:'A locked ticket office stands beneath a dim lamp.',durationSeconds:10
  });
  const model=await openLiveDirector(page);
  await attachProject(page,project);
  const observed=observeLiveCalls(page);
  const direction='Revise the Platform Scene so the watchman notices an antique silver whistle beneath a bench. '+
    'Preserve the wet blue station, full original action and eight-second timing.';
  await writeLive(page,{projectId:project.id,operation:'scene-write',sceneMode:'revise',
    sceneIds:[first.id],instruction:direction});
  await expect.poll(async()=>(await story(page,project.id)).scenes[first.id].prompt,
    {timeout:60000}).not.toBe(first.prompt);
  const saved=await story(page,project.id);
  await evidence(info,'actual-scene-revision',{model,request:observed.requests.at(-1),
    receipt:observed.jobs.at(-1),saved});
  expect(observed.requests.at(-1).operation).toBe('studio_scene_field_draft');
  expect(JSON.stringify(observed.requests.at(-1).messages)).toContain(first.prompt);
  expect(saved.scenes[second.id].prompt).toBe(second.prompt);
  expect(saved.scenes[first.id].durationSeconds).toBe(8);
  expect(saved.scenes[first.id].title).toBe(first.title);
});

test('LIVE cross-Project references — approved Read informs Write without redirecting the destination',async({page},info)=>{
  const pace=await seedProject(page,'Live Pace '+Date.now(),{
    concept:'A market chase.',style:'Handheld documentary camera.'
  });
  const source=await seedScene(page,pace.id,{
    title:'Fast Cut',prompt:'A courier runs, vaults a cart, then enters an alley.',durationSeconds:8
  });
  const character=await seedProject(page,'Live Character '+Date.now(),{
    concept:'Another world.',invariants:[
      {kind:'character',title:'Mara',text:'Mara has a copper hairpin and dark green coat.'}
    ]
  });
  const destination=await seedProject(page,'Live Destination '+Date.now(),{
    concept:'An evening railway platform.',style:'Soft amber lamps.'
  });
  const model=await openLiveDirector(page);
  await attachProject(page,destination);
  const observed=observeLiveCalls(page);
  const share=page.locator('#director-chat-context-approve');
  await share.click();
  await page.locator('#studio-dw-read-project').selectOption(pace.id);
  await page.locator('#studio-dw-read-selection summary').click();
  await page.locator('#studio-dw-project-fields input[data-group-select]').first().uncheck();
  await page.locator('#studio-dw-scene-fields input[data-group-select]').first().check();
  await page.locator('#studio-dw-read-send').click();
  await share.click();
  await page.locator('#studio-dw-read-project').selectOption(character.id);
  await page.locator('#studio-dw-project-fields input[data-group-select]').first().uncheck();
  await page.locator('#studio-dw-project-fields input[data-group-select]').last().check();
  await page.locator('#studio-dw-read-send').click();
  const direction='Write a new Scene on the selected railway platform with Mara and her copper hairpin. '+
    'Use the approved chase reference for the motion, not its setting.';
  await writeLive(page,{projectId:destination.id,operation:'scene-write',sceneMode:'create',
    instruction:direction});
  await expect.poll(async()=>(await story(page,destination.id)).sceneOrder.length,{timeout:60000}).toBeGreaterThan(0);
  const saved=await story(page,destination.id),request=observed.requests.at(-1);
  await evidence(info,'actual-cross-project-write',{model,request,receipt:observed.jobs.at(-1),saved});
  const outbound=JSON.stringify(request.messages);
  expect(outbound).toContain(source.prompt);
  expect(outbound).toContain('Mara has a copper hairpin');
  expect(request.operation).toBe('studio_scenes_draft');
  expect((await story(page,pace.id)).sceneOrder).toEqual([source.id]);
  expect((await story(page,character.id)).sceneOrder).toHaveLength(0);
});
