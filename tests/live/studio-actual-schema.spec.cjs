'use strict';
const {test,expect}=require('../browser/test.cjs');
const {openLiveDirector,attachProject,sendLive,story,stories,seedProject,seedScene,
  openProject,reopenDirectorIfClosed}=require('./helpers.cjs');

// Real backend + actual configured LLM. Observe the raw provider result and
// outbound operation, not just the text on a review button.
function observeRealDirector(page) {
  const requests=[],receipts=[];
  page.on('request',request=>{
    if(new URL(request.url()).pathname!=='/fs/director/chat' || request.method()!=='POST')return;
    try{ requests.push(request.postDataJSON()); }catch{}
  });
  page.on('response',async response=>{
    if(new URL(response.url()).pathname!=='/fs/director/job'||!response.ok())return;
    try {
      const result=(await response.json()).job;
      if(result && result.status==='completed' && result.result?.text)
        receipts.push({jobId:result.jobId,raw:result.result.text,
          finishReason:result.result.finishReason,
          structureWarning:result.result.structureWarning});
    }catch{}
  });
  return {
    requests,receipts,
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
  const instruction='Revise this existing eight-second H3 Scene with a clearly visible brass compass. '+
    'Keep the courier, the lighthouse, parcel, duration, and core action. '+
    'Return the complete replacement prompt in the required prompt field, not an explanation or plan.';
  const outbound=[{
    role:'system',
    content:'You are Director authoring one replacement video Scene prompt. '+
      'Return one JSON object with a complete standalone H3 video prompt in the prompt string field. '+
      'Do not return an action, plan, summary, or empty prompt. Include concrete visible action, camera, atmosphere and timing.'
  },{
    role:'user',
    content:JSON.stringify({project:{concept:project.concept,style:project.style},
      originalPrompt:original,durationSeconds:8,instruction})
  }];
  const response=await page.request.post('/fs/director/chat',{data:{
    model,operation:'studio_scene_field_draft',requiredFields:['prompt'],messages:outbound
  }});
  expect(response.ok(),'Real Director revision was not queued: '+await response.text()).toBeTruthy();
  const initial=(await response.json()).job;
  expect(initial?.jobId).toBeTruthy();
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
  expect((await story(page,project.id)).sceneOrder).toHaveLength(0);
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
  const instruction='Revise the selected existing Platform Scene prompt to show the watchman '+
    'discovering an antique silver whistle, preserving the same station and eight-second duration. '+
    'Return the COMPLETE replacement H3 prompt in changes.scene.prompt, not a summary, '+
    'an action intention, or a new Scene. Do not revise the Ticket office Scene.';
  await sendLive(page,instruction);
  const {parsed,receipt}=await observation.result();
  await evidence(testInfo,'actual-conversation-existing-scene-result',{model,instruction,raw:receipt.raw,parsed});
  expect(observation.requests).toHaveLength(1);
  expect(observation.requests[0].operation).toBe('studio_chat');
  expect(typeof parsed.changes?.scene?.prompt,
    'Real-model Scene rewrite omitted changes.scene.prompt').toBe('string');
  const authored=parsed.changes.scene.prompt;
  expect(authored.trim().length,'A real Scene rewrite must contain a complete replacement prompt')
    .toBeGreaterThan(80);
  expect(authored).not.toBe(first.prompt);
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
  await page.reload();
  expect((await story(page,project.id)).scenes[first.id].prompt).toBe(authored);
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
