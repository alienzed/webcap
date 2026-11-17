'use strict';
const {test,expect}=require('../browser/test.cjs');
const {openLiveDirector,attachProject,sendLive,story,stories,seedProject,seedScene,
  openProject,reopenDirectorIfClosed}=require('./helpers.cjs');

// Real backend + actual configured LLM. Observe the raw provider result and
// outbound operation, not just the text on a review button.
function observeRealDirector(page) {
  const requests=[],receipts=[],schemas=[];
  page.on('request',request=>{
    if(new URL(request.url()).pathname!=='/fs/director/chat' || request.method()!=='POST')return;
    try{ requests.push(request.postDataJSON()); }catch{}
  });
  page.on('response',async response=>{
    const pathname=new URL(response.url()).pathname;
    if(!response.ok())return;
    try {
      if(pathname==='/fs/director/chat'){
        const result=(await response.json()).job;
        if(result?.request?.responseSchema) schemas.push(result.request.responseSchema);
        return;
      }
      if(pathname!=='/fs/director/job')return;
      const result=(await response.json()).job;
      if(result && result.status==='completed' && result.result?.text)
        receipts.push({jobId:result.jobId,raw:result.result.text,
          finishReason:result.result.finishReason,
          structureWarning:result.result.structureWarning});
    }catch{}
  });
  return {
    requests,receipts,schemas,
    async result(){
      await expect.poll(()=>receipts.length,{timeout:30000}).toBeGreaterThan(0);
      const receipt=receipts[receipts.length-1];
      let parsed;
      try {parsed=JSON.parse(receipt.raw);}
      catch(error){throw new Error('Real model did not return parseable structured content: '+error.message+
        '\nRaw model result:\n'+receipt.raw);}
      return {parsed,receipt};
    }
  };
}
async function evidence(testInfo,label,detail){
  await testInfo.attach(label,{
    body:Buffer.from(JSON.stringify(detail,null,2)),contentType:'application/json'
  });
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
      unsavedWorkingFields:{}
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

test('LIVE creative partner — discuss staging, make a recommendation, then author the chosen Scene',async({page},testInfo)=>{
  const project=await seedProject(page,'Live Creative Partner '+Date.now(),{
    concept:'A night porter notices a paper crane caught in a railway station doorway.',
    style:'Rain-slick blue twilight, restrained and humane.'
  });
  const model=await openLiveDirector(page);
  await attachProject(page,project);
  const observation=observeRealDirector(page);

  // No JSON field names or WebCap commands in the author's words.
  const discussion='An eight-second Scene about a night porter finding a paper crane '+
    'caught in the railway station door feels visually flat. Suggest two distinct ways '+
    'to stage the moment and recommend the stronger one, explaining why. '+
    'We are discussing the idea, not writing the Scene yet.';
  await sendLive(page,discussion);
  const first=await observation.result();
  await evidence(testInfo,'actual-creative-discussion',{model,discussion,
    outbound:observation.requests[0],raw:first.receipt.raw,parsed:first.parsed});
  expect(observation.requests).toHaveLength(1);
  expect(observation.requests[0].operation).toBe('studio_chat');
  expect(typeof first.parsed.reply,'Director did not discuss the creative decision').toBe('string');
  expect(first.parsed.reply.trim().length,'Creative recommendation was not substantive')
    .toBeGreaterThan(75);
  expect(first.parsed.reply).toMatch(/crane|paper|porter|station|door/i);
  expect((await story(page,project.id)).sceneOrder).toHaveLength(0);

  const writing='Use the approach you recommended and write the complete eight-second '+
    'Scene of the night porter discovering the trapped paper crane in the railway '+
    'station doorway. Include the observable action, staging, and timed progression.';
  await sendLive(page,writing);
  await expect.poll(()=>observation.receipts.length,{timeout:30000}).toBe(2);
  const second=observation.receipts[1];
  let authored;
  try {authored=JSON.parse(second.raw);}
  catch(error){throw new Error('Creative follow-up omitted structured Scene records: '+
    error.message+'\nRaw result:\n'+second.raw);}
  await evidence(testInfo,'actual-creative-followup',{model,writing,
    outbound:observation.requests[1],raw:second.raw,parsed:authored});
  expect(observation.requests).toHaveLength(2,'Each author turn should make one model request');
  expect(JSON.stringify(observation.requests[1].messages))
    .toContain(first.parsed.reply,'Director must retain the staging discussion across turns');
  expect(Array.isArray(authored.scenes),'Director answered with a plan instead of an authored Scene').toBe(true);
  expect(authored.scenes.length).toBeGreaterThan(0);
  const scene=authored.scenes[0];
  expect(typeof scene.title).toBe('string');
  expect(scene.title.trim()).toBeTruthy();
  expect(scene.durationSeconds).toBe(8);
  expect(typeof scene.prompt).toBe('string');
  expect(scene.prompt.trim().length).toBeGreaterThan(80);
  expect(scene.prompt).toMatch(/crane|paper bird/i);
  expect(scene.prompt).toMatch(/porter|station/i);

  // The model can author; only the author's explicit Apply can persist.
  expect((await story(page,project.id)).sceneOrder).toHaveLength(0);
  const destination=page.locator('#studio-dw-suggestions select[aria-label="Scene material destination"]');
  await destination.selectOption(project.id);
  await page.locator('#studio-dw-suggestions .studio-dw-suggestion-action').click();
  await expect(page.locator('#studio-scenes-review')).toBeVisible();
  const rows=page.locator('#studio-scenes-rows .studio-scenes-row');
  await expect(rows).toHaveCount(authored.scenes.length);
  await expect(rows.first().locator('[data-field="prompt"]')).toHaveValue(scene.prompt);
  await page.locator('#studio-scenes-apply').click();
  await expect.poll(async()=> (await story(page,project.id)).sceneOrder.length)
    .toBe(authored.scenes.length);
  const saved=await story(page,project.id);
  expect(saved.scenes[saved.sceneOrder[0]].prompt).toBe(scene.prompt);
  expect(observation.requests).toHaveLength(2,'Review and Apply must not re-author the Scene');
});

test('LIVE conversation — real Scene records have required title, duration and complete prompt before choosing Project',async({page},testInfo)=>{
  const a=await seedProject(page,'Live Reference '+Date.now(),{style:'Cool afternoon light.'});
  const b=await seedProject(page,'Live Scene Target '+Date.now(),{style:'Warm sunrise.'});
  const model=await openLiveDirector(page);
  await attachProject(page,a);
  const observation=observeRealDirector(page);
  const instruction='Author TWO distinct eight-second Scenes for a small story about a courier arriving '+
    'at a seaside lighthouse and discovering a sealed parcel. Return two actual scenes records '+
    'with title, durationSeconds and complete standalone H3 prompt for EACH, now. '+
    'Do not just promise to create them. I will choose their destination after you author them.';
  await sendLive(page,instruction);
  const {parsed,receipt}=await observation.result();
  await evidence(testInfo,'actual-conversation-scene-model-result',{model,instruction,
    operation:observation.requests.at(-1)?.operation,raw:receipt.raw,parsed});
  expect(observation.requests).toHaveLength(1);
  expect(observation.requests[0].operation).toBe('studio_chat');
  await expect.poll(()=>observation.schemas.length).toBe(1);
  expect(observation.schemas[0].properties.scenes.items.required)
    .toEqual(['title','prompt','durationSeconds']);
  expect(observation.schemas[0].properties.scenes.items.properties.prompt.minLength).toBe(1);
  expect(Array.isArray(parsed.scenes),'Real conversation returned no structured scenes array').toBe(true);
  expect(parsed.scenes.length,'The real model must return Scene records, not an action promise')
    .toBeGreaterThan(0);
  for(const [index,scene]of parsed.scenes.entries()){
    expect(typeof scene.title,'Scene '+index+' title missing').toBe('string');
    expect(scene.title.trim().length).toBeGreaterThan(0);
    expect(Number.isFinite(scene.durationSeconds),'Scene '+index+' duration missing').toBe(true);
    expect(typeof scene.prompt,'Scene '+index+' prompt missing').toBe('string');
    expect(scene.prompt.trim().length,'Scene '+index+' prompt incomplete').toBeGreaterThan(80);
  }
  const destination=page.locator('#studio-dw-suggestions select[aria-label="Scene material destination"]');
  await expect(destination).toHaveValue(a.id);
  await destination.selectOption(b.id);
  await page.locator('#studio-dw-suggestions .studio-dw-suggestion-action').click();
  const rows=page.locator('#studio-scenes-rows .studio-scenes-row');
  await expect(page.locator('#studio-scenes-review')).toBeVisible();
  await expect(rows).toHaveCount(parsed.scenes.length);
  for(let i=0;i<parsed.scenes.length;i++){
    await expect(rows.nth(i).locator('[data-field="prompt"]')).toHaveValue(parsed.scenes[i].prompt);
  }
  await page.locator('#studio-scenes-apply').click();
  await expect.poll(async()=> (await story(page,b.id)).sceneOrder.length).toBe(parsed.scenes.length);
  const saved=await story(page,b.id);
  expect(saved.sceneOrder.map(id=>saved.scenes[id].prompt)).toEqual(parsed.scenes.map(scene=>scene.prompt));
  expect((await story(page,a.id)).sceneOrder).toHaveLength(0);
  expect(observation.requests).toHaveLength(1);
  await page.reload();
  expect((await story(page,b.id)).sceneOrder).toEqual(saved.sceneOrder);
});

test('LIVE conversation — pivot into a new Project while an unrelated Project is open',async({page},testInfo)=>{
  const a=await seedProject(page,'Live Existing '+Date.now(),{
    concept:'A coastguard searches a lighthouse.',style:'Dark storm light.'});
  const model=await openLiveDirector(page);
  await attachProject(page,a);
  await openProject(page,a.id);
  await reopenDirectorIfClosed(page);
  const observation=observeRealDirector(page);
  const title='Live Automaton '+Date.now();
  const instruction='Let us pivot to a completely unrelated story. Create a NEW Project titled "'+
    title+'". Concept: a woodcarver builds a tiny mechanical bird. '+
    'Visual atmosphere: warm golden workshop light. Invariants: the bird has a copper beak. '+
    'Return actual title, concept, style, and invariants fields under changes.project. '+
    'This is not a revision of the lighthouse Project.';
  await sendLive(page,instruction);
  const {parsed,receipt}=await observation.result();
  await evidence(testInfo,'actual-new-project-pivot-result',{model,instruction,raw:receipt.raw,parsed});
  const fields=parsed.changes?.project;
  expect(fields,'Real model returned no Project fields').toBeTruthy();
  expect(fields.title).toBe(title);
  expect(typeof fields.concept).toBe('string');
  expect(fields.concept.trim().length).toBeGreaterThan(15);
  expect(typeof fields.style).toBe('string');
  expect(fields.style.trim()).toBeTruthy();
  expect(Array.isArray(fields.invariants),'Real model omitted requested invariants').toBe(true);
  expect(fields.invariants.length).toBeGreaterThan(0);
  const destination=page.locator('#studio-dw-suggestions select[aria-label="Project material destination"]');
  await expect(destination).toHaveValue('');
  await page.locator('#studio-dw-suggestions .studio-dw-suggestion-action').click();
  await expect(page.locator('#studio-project-review')).toBeVisible();
  await expect(page.locator('#studio-project-title')).toHaveValue(title);
  await page.locator('#studio-project-create').click();
  await expect.poll(async()=> (await stories(page)).some(item=>item.title===title)).toBe(true);
  const created=(await stories(page)).find(item=>item.title===title);
  expect((await story(page,created.id)).style).toBe(fields.style);
  const original=await story(page,a.id);
  expect(original.style).toBe('Dark storm light.');
  expect(original.concept).toBe('A coastguard searches a lighthouse.');
  expect(observation.requests).toHaveLength(1);
});

test('LIVE conversation — an existing Scene rewrite must contain changes.scene.prompt and apply only to its selected Scene',async({page},testInfo)=>{
  const project=await seedProject(page,'Live Chat Prompt Revision '+Date.now(),{
    concept:'A night watchman visits a railway station.',
    style:'Wet blue evening.'
  });
  const first=await seedScene(page,project.id,{
    title:'Platform',prompt:'A watchman walks through a railway station at night.',durationSeconds:8
  });
  const second=await seedScene(page,project.id,{
    title:'Ticket office',prompt:'A locked ticket office stands beneath a dim lamp.',durationSeconds:10
  });
  const model=await openLiveDirector(page);
  await attachProject(page,project);
  // Unpinned Director overlays the Scene strip; dismiss it before navigating.
  await page.locator('#director-chat-close').click();
  await page.locator('[data-scene-progress="'+first.id+'"]').click();
  await reopenDirectorIfClosed(page);
  // Author-approved Read shares the selected Scene's real saved baseline.
  await page.locator('#director-chat-context-approve').click();
  await page.locator('#studio-dw-read-project').selectOption(project.id);
  await page.locator('#studio-dw-read-selection summary').click();
  await page.locator('#studio-dw-project-fields input[data-group-select]').first().uncheck();
  const toggles=page.locator('#studio-dw-scene-fields input[data-group-select]');
  await expect(toggles).toHaveCount(2);
  await toggles.first().check();
  await page.locator('#studio-dw-read-send').click();
  const observation=observeRealDirector(page);
  const instruction='In the Platform Scene, have the watchman notice an antique silver whistle '+
    'beneath a bench and briefly hesitate before picking it up. Keep the wet blue station '+
    'atmosphere, the existing action, and the eight-second timing.';
  await sendLive(page,instruction);
  const {parsed,receipt}=await observation.result();
  await evidence(testInfo,'actual-conversation-existing-scene-result',{model,instruction,
    outbound:observation.requests[0],raw:receipt.raw,parsed});
  expect(observation.requests).toHaveLength(1);
  expect(observation.requests[0].operation).toBe('studio_chat');
  const firstContext=JSON.stringify(observation.requests[0].messages);
  expect(firstContext).toContain(first.prompt);
  expect(firstContext).not.toContain(second.prompt);
  await expect.poll(()=>observation.schemas.length).toBe(1);
  expect(observation.schemas[0].properties.changes.properties.scene.properties.prompt.type)
    .toBe('string');
  expect(observation.schemas[0].properties.changes.properties.scene.properties.prompt.minLength)
    .toBe(1);
  expect(typeof parsed.changes?.scene?.prompt,
    'Real-model Scene rewrite omitted changes.scene.prompt').toBe('string');
  const authored=parsed.changes.scene.prompt;
  expect(authored.trim().length,'A real Scene rewrite must contain a complete replacement prompt')
    .toBeGreaterThan(80);
  expect(authored).not.toBe(first.prompt);
  expect(authored).toMatch(/whistle/i);
  expect(authored).toMatch(/station|platform/i);
  expect((await story(page,project.id)).scenes[first.id].prompt).toBe(first.prompt);
  const action=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  await expect(action).toContainText('Review authored Scene');
  await action.click();
  await expect(page.locator('#studio-dw-scene-review')).toBeVisible();
  await expect(page.locator('#studio-dw-scene-editors [data-field="prompt"]')).toHaveValue(authored);
  await page.locator('#studio-dw-scene-apply').click();
  await expect.poll(async()=> (await story(page,project.id)).scenes[first.id].prompt).toBe(authored);
  const saved=await story(page,project.id);
  expect(saved.scenes[second.id].prompt).toBe(second.prompt);
  expect(saved.scenes[first.id].title).toBe(first.title);
  expect(saved.scenes[first.id].durationSeconds).toBe(8);
  expect(observation.requests).toHaveLength(1);

  // Continue as a creative collaboration. The next response must build on
  // the just-saved revision rather than the original eight-second draft.
  await reopenDirectorIfClosed(page);
  const followup='Keep the silver whistle discovery, but at the end let the watchman '+
    'glance toward an approaching train before pocketing it. Keep this the same '+
    'eight-second Platform Scene and leave the Ticket office untouched.';
  await sendLive(page,followup);
  await expect.poll(()=>observation.receipts.length,{timeout:30000}).toBe(2);
  const secondReceipt=observation.receipts[1];
  let secondResponse;
  try {secondResponse=JSON.parse(secondReceipt.raw);}
  catch(error){throw new Error('Follow-up Director reply is not structured JSON: '+
    error.message+'\nRaw result:\n'+secondReceipt.raw);}
  await evidence(testInfo,'actual-followup-scene-model-result',{
    model,instruction:followup,outbound:observation.requests[1],
    raw:secondReceipt.raw,parsed:secondResponse
  });
  expect(observation.requests).toHaveLength(2,'Follow-up must use one model call');
  expect(observation.requests[1].operation).toBe('studio_chat');
  const followupContext=JSON.stringify(observation.requests[1].messages);
  expect(followupContext,'Fresh approved Read must supply the last saved Scene revision')
    .toContain(authored);
  expect(followupContext).not.toContain(second.prompt);
  const followupPrompt=secondResponse.changes?.scene?.prompt;
  expect(typeof followupPrompt,'Follow-up Scene edit omitted changes.scene.prompt').toBe('string');
  expect(followupPrompt.trim().length,'Follow-up must return a complete replacement prompt')
    .toBeGreaterThan(80);
  expect(followupPrompt).toMatch(/whistle/i);
  expect(followupPrompt).toMatch(/train/i);
  expect(followupPrompt).not.toBe(authored);
  expect((await story(page,project.id)).scenes[first.id].prompt).toBe(authored);

  const followupAction=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  await expect(followupAction).toContainText('Review authored Scene');
  await followupAction.click();
  await expect(page.locator('#studio-dw-scene-review')).toBeVisible();
  await expect(page.locator('#studio-dw-scene-editors [data-field="prompt"]'))
    .toHaveValue(followupPrompt);
  await page.locator('#studio-dw-scene-apply').click();
  await expect.poll(async()=> (await story(page,project.id)).scenes[first.id].prompt)
    .toBe(followupPrompt);
  const finalSaved=await story(page,project.id);
  expect(finalSaved.scenes[second.id].prompt).toBe(second.prompt);
  expect(finalSaved.scenes[first.id].durationSeconds).toBe(8);
  expect(finalSaved.scenes[first.id].title).toBe(first.title);
  expect(observation.requests).toHaveLength(2,'Apply must not cause extra authoring');
  await page.reload();
  expect((await story(page,project.id)).scenes[first.id].prompt).toBe(followupPrompt);
});

test('LIVE cross-Project references — an unrelated Scene and character Invariant inform a new Scene saved elsewhere',async({page},testInfo)=>{
  const a=await seedProject(page,'Live Pace Source '+Date.now(),{
    concept:'A crowded market with a chase.',style:'Handheld documentary camera.'
  });
  const source=await seedScene(page,a.id,{
    title:'Fast Cut',prompt:'Three rapid connected moments: a courier runs, vaults a cart, then turns into an alley.',durationSeconds:8
  });
  const b=await seedProject(page,'Live Character Source '+Date.now(),{
    concept:'An unrelated world, not the destination.',
    invariants:[{kind:'character',title:'Mara',text:'Mara wears a copper hairpin and a dark green coat.'}]
  });
  const c=await seedProject(page,'Live Different Destination '+Date.now(),{
    concept:'An evening railway platform.',style:'Soft amber lamps.'
  });
  const model=await openLiveDirector(page);
  await attachProject(page,c);
  const share=page.locator('#director-chat-context-approve');
  const selection=page.locator('#studio-dw-read-selection');
  const reveal=async()=>{
    if((await selection.getAttribute('open'))===null)
      await selection.locator('summary').click();
  };
  await share.click();
  await page.locator('#studio-dw-read-project').selectOption(a.id);
  await reveal();
  await page.locator('#studio-dw-project-fields input[data-group-select]').first().uncheck();
  await page.locator('#studio-dw-scene-fields input[data-group-select]').first().check();
  await page.locator('#studio-dw-read-send').click();

  await share.click();
  await page.locator('#studio-dw-read-project').selectOption(b.id);
  await reveal();
  await page.locator('#studio-dw-project-fields input[data-group-select]').first().uncheck();
  await page.locator('#studio-dw-project-fields input[data-group-select]').last().check();
  await page.locator('#studio-dw-read-send').click();

  const observation=observeRealDirector(page);
  const instruction='Author ONE complete eight-second Scene for a railway station, using the approved '+
    'Fast Cut Scene from a completely different Project as the pacing reference and Mara '+
    'from the approved character Invariant. Explicitly show Mara with the copper hairpin. '+
    'Return an actual Scene record with title, prompt and durationSeconds in scenes. '+
    'Do not assume that either reference Project is the destination.';
  await sendLive(page,instruction);
  const {parsed,receipt}=await observation.result();
  const outbound=JSON.stringify(observation.requests[0]?.messages);
  await evidence(testInfo,'actual-independent-reference-model-request',{model,instruction,
    outbound,raw:receipt.raw,parsed});
  expect(observation.requests).toHaveLength(1);
  expect(outbound).toContain(source.prompt);
  expect(outbound).toContain('Mara wears a copper hairpin and a dark green coat.');
  expect(outbound).not.toContain('An unrelated world, not the destination.');
  expect(Array.isArray(parsed.scenes)).toBe(true);
  expect(parsed.scenes.length).toBeGreaterThan(0);
  for(const item of parsed.scenes){
    expect(typeof item.prompt,'Reference-based Scene omitted prompt').toBe('string');
    expect(item.prompt.trim().length).toBeGreaterThan(80);
    expect(item.prompt).toMatch(/Mara/i);
    expect(typeof item.title).toBe('string');
    expect(Number.isFinite(item.durationSeconds)).toBe(true);
  }
  const destination=page.locator('#studio-dw-suggestions select[aria-label="Scene material destination"]');
  await destination.selectOption(c.id);
  await page.locator('#studio-dw-suggestions .studio-dw-suggestion-action').click();
  await expect(page.locator('#studio-scenes-review')).toBeVisible();
  await page.locator('#studio-scenes-apply').click();
  await expect.poll(async()=> (await story(page,c.id)).sceneOrder.length)
    .toBe(parsed.scenes.length);
  expect((await story(page,a.id)).scenes[source.id].prompt).toBe(source.prompt);
  expect((await story(page,b.id)).sceneOrder).toHaveLength(0);
  expect(observation.requests).toHaveLength(1);
});
