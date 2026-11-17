'use strict';
// Historical combined Chat/Review expectations are retired by the focused
// Chat -> explicit Write contract. Independent Read/Block flows remain active.
const {test,expect}=require('../browser/test.cjs');
const {waitForLiveJob,openLiveDirector,attachProject,approveOverview,sendLive,addEvidence,latestSceneReview,
       story,stories,seedProject,seedScene,openProject}=require('./helpers.cjs');

test.skip('Live Flow 1 — real Director authors a reviewed Project and persisted Overview',async({page},testInfo)=>{
  const model=await openLiveDirector(page);
  const name='Real Model Project '+Date.now();
  const instruction='Create a new Studio Project called "'+name+
    '". Concept: A bookseller opens a shop in a rainy city. Visual atmosphere: amber light and blue rain. '+
    'Add a recurring invariant: the bookseller wears a red scarf. Supply the Project title, concept, visual style and invariant as structured Project material.';
  // Inspect the actual completed provider record before Review; the final saved
  // list alone cannot distinguish missing model material from a lost UI field.
  const providerJob=page.waitForResponse(async response=>{
    if(!response.url().includes('/fs/director/job?')) return false;
    try{
      const body=await response.json();
      return body.job?.status==='completed';
    }catch{return false;}
  },{timeout:300000});
  await sendLive(page,instruction);
  const job=(await (await providerJob).json()).job;
  const raw=String(job.result?.text||'');
  let authored;
  try{authored=JSON.parse(raw);}catch(error){
    await testInfo.attach('flow1-raw-director-output',{body:Buffer.from(raw),contentType:'text/plain'});
    throw new Error('Flow 1: completed Director response is not structured JSON: '+error.message);
  }
  await testInfo.attach('flow1-project-authoring-boundary',{
    body:Buffer.from(JSON.stringify({model,request:instruction,raw:authored},null,2)),
    contentType:'application/json'
  });
  const authoredInvariants=authored?.changes?.project?.invariants;
  expect(Array.isArray(authoredInvariants) && authoredInvariants.some(item=>typeof item?.text==='string' && item.text.trim()),
    'Flow 1 authoring: Director did not return a structured invariant despite the explicit recurring-invariant request in changes.project.invariants').toBe(true);
  const action=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  await expect(action).toContainText(/Review authored Project/i);
  await action.click();
  const dialog=page.locator('#studio-project-review');
  await expect(dialog).toBeVisible();
  const reviewInvariants=await page.locator('#studio-project-invariants .studio-project-invariant textarea')
    .evaluateAll(fields=>fields.map(field=>field.value));
  expect(reviewInvariants.some(value=>value.trim()),
    'Flow 1 Review: authored invariant did not reach the editable Project review').toBe(true);
  const title=await page.locator('#studio-project-title').inputValue();
  const concept=await page.locator('#studio-project-concept').inputValue();
  const style=await page.locator('#studio-project-style').inputValue();
  expect(title.trim()).toBeTruthy();
  expect(concept.trim()).toBeTruthy();
  expect(style.trim()).toBeTruthy();
  const editedConcept=concept+' The bell rings when the door opens.';
  await page.locator('#studio-project-concept').fill(editedConcept);
  await page.locator('#studio-project-create').click();
  await expect(dialog).toBeHidden();
  const all=await stories(page);
  const created=all.find(x=>x.title===title);
  expect(created,'Reviewed Project was not saved').toBeTruthy();
  const actual=await story(page,created.id);
  expect(actual.concept).toBe(editedConcept);
  expect(actual.style).toBe(style);
  expect(actual.invariants.length,'Real model Project output should include a reusable invariant').toBeGreaterThan(0);
  await page.reload();
  const restored=await story(page,created.id);
  expect(restored.concept).toBe(editedConcept);
  expect(restored.invariants).toEqual(actual.invariants);
  await addEvidence(testInfo,page,model,instruction,{projectId:created.id,title,concept,style,persisted:restored});
});

test.skip('Live Flow 2 — real authored Scenes reach the review surface and persist without re-authoring',async({page},testInfo)=>{
  const project=await seedProject(page,'Live Scenes '+Date.now());
  const model=await openLiveDirector(page);
  await attachProject(page,project);
  const instruction='Create two distinct short Scenes for this Project, one about entering a bookshop and one about discovering a glowing map. '+
    'Author complete Scene prompts, titles, and distinct durations of eight and twelve seconds as Scene records for review.';
  await sendLive(page,instruction);
  const rows=await latestSceneReview(page);
  const count=await rows.count();
  expect(count,'Model returned no usable authored Scene records').toBeGreaterThan(0);
  const returned=[];
  for(let i=0;i<count;i++){
    const row=rows.nth(i);
    const title=await row.locator('[data-field="title"]').inputValue();
    const prompt=await row.locator('[data-field="prompt"]').inputValue();
    const duration=await row.locator('[data-field="durationSeconds"]').inputValue();
    expect(prompt.trim(),'Returned Scene must have a usable Prompt').toBeTruthy();
    returned.push({title,prompt,duration});
  }
  // Edit one actual returned record; do not assert the model obeyed exact prose.
  const altered=returned[0].prompt+' The shot ends on a close-up of the doorway.';
  await rows.first().locator('[data-field="prompt"]').fill(altered);
  await page.locator('#studio-scenes-apply').click();
  await expect.poll(async()=> (await story(page,project.id)).sceneOrder.length,{timeout:30000}).toBe(count);
  const saved=await story(page,project.id);
  const persisted=saved.sceneOrder.map(id=>saved.scenes[id]);
  expect(persisted.map(x=>x.prompt)).toEqual(returned.map((item,index)=>index===0?altered:item.prompt));
  await page.reload();
  const reloaded=await story(page,project.id);
  expect(reloaded.sceneOrder).toEqual(saved.sceneOrder);
  expect(reloaded.scenes[reloaded.sceneOrder[0]].prompt).toBe(altered);
  await addEvidence(testInfo,page,model,instruction,{returned,savedSceneIds:saved.sceneOrder,persisted});
});

test('Live Flow 4 — approved Overview and Scene references reach the real model, not merely the UI',async({page},testInfo)=>{
  const project=await seedProject(page,'Live Read '+Date.now(),{
    concept:'A silver gate stands in a blue courtyard.',style:'Soft dusk.'
  });
  const scene=await seedScene(page,project.id,{
    title:'Courtyard Gate',prompt:'A visitor opens a silver gate.',durationSeconds:8
  });
  const model=await openLiveDirector(page);
  await attachProject(page,project);
  const outbound=[];
  page.on('request',request=>{
    if(new URL(request.url()).pathname==='/fs/director/chat' && request.method()==='POST'){
      try{outbound.push(request.postDataJSON());}catch{}
    }
  });
  const share=page.locator('#director-chat-context-approve');
  await share.click();
  await page.locator('#studio-dw-read-project').selectOption(project.id);
  const selection=page.locator('#studio-dw-read-selection');
  if(await selection.getAttribute('open')===null) await selection.locator('summary').click();
  await page.locator('#studio-dw-project-fields input[data-group-select]').first().check();
  // The selected Scene is suggested too; this first Read approves only Overview.
  await page.locator('#studio-dw-scene-fields input[data-group-select]').first().uncheck();
  await page.locator('#studio-dw-read-send').click();
  await sendLive(page,'Using the approved saved Overview, describe the setting in one sentence. Do not change it.');
  expect(outbound).toHaveLength(1);
  expect(JSON.stringify(outbound[0].messages)).toContain('A silver gate stands in a blue courtyard.');
  expect(JSON.stringify(outbound[0].messages)).not.toContain(scene.prompt);

  await share.click();
  await page.locator('#studio-dw-read-project').selectOption(project.id);
  if(await selection.getAttribute('open')===null) await selection.locator('summary').click();
  await page.locator('#studio-dw-project-fields input[data-group-select]').first().check();
  await page.locator('#studio-dw-scene-fields input[data-group-select]').first().check();
  await page.locator('#studio-dw-read-send').click();
  await sendLive(page,'Using the newly approved Scene as a reference, describe the physical action without changing the Project.');
  expect(outbound).toHaveLength(2);
  const secondRequest=JSON.stringify(outbound[1].messages);
  expect(secondRequest).toContain('A visitor opens a silver gate.');
  expect(secondRequest).toContain('A silver gate stands in a blue courtyard.');
  const actual=await story(page,project.id);
  expect(actual.concept).toBe('A silver gate stands in a blue courtyard.');
  expect(actual.scenes[scene.id].prompt).toBe('A visitor opens a silver gate.');
  await addEvidence(testInfo,page,model,'Approved Read: Overview, then Scene',{
    outboundRequests:outbound,sourceProjectId:project.id
  });
});

test.skip('Live Flow 3 — a real Project revision saves reviewed fields without changing an unrelated Scene',async({page},testInfo)=>{
  const project=await seedProject(page,'Live Revision '+Date.now(),{
    concept:'A quiet library on a winter night.',style:'Cold blue window light.'
  });
  const scene=await seedScene(page,project.id,{
    title:'First visitor',prompt:'A visitor walks through the main door.',durationSeconds:8
  });
  const model=await openLiveDirector(page);
  await attachProject(page,project);
  const instruction='Revise only the Project visual atmosphere to a warm amber-lit interior, leaving the Project concept, Scene prompts and durations untouched. Return a Project style revision for review.';
  // Conversation attachment identifies the subject; approve its saved baseline separately.
  await approveOverview(page,project.id);
  await sendLive(page,instruction);
  const action=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  await expect(action).toContainText(/Review authored Project/i);
  await page.locator('#studio-dw-suggestions select[aria-label="Project material destination"]').selectOption(project.id);
  await action.click();
  await expect(page.locator('#studio-brief-review')).toBeVisible();
  const revised=await page.locator('#studio-brief-style').inputValue();
  expect(revised.trim()).toBeTruthy();
  expect(revised).not.toBe('Cold blue window light.');
  await expect(page.locator('#studio-brief-title-selected'),
    'Style-only authoring must not propose a changed Project title').not.toBeChecked();
  await expect(page.locator('#studio-brief-concept-selected'),
    'Style-only authoring must not propose a changed Project concept').not.toBeChecked();
  await expect(page.locator('#studio-brief-invariants-selected'),
    'Style-only authoring must not propose changed Project invariants').not.toBeChecked();
  await page.locator('#studio-brief-apply').click();
  await expect.poll(async()=> (await story(page,project.id)).style).toBe(revised);
  const saved=await story(page,project.id);
  expect(saved.concept).toBe(project.concept);
  expect(saved.scenes[scene.id].prompt).toBe('A visitor walks through the main door.');
  expect(saved.scenes[scene.id].durationSeconds).toBe(8);
  await page.reload();
  expect((await story(page,project.id)).style).toBe(revised);
  await addEvidence(testInfo,page,model,instruction,{projectId:project.id,revised,saved});
});
