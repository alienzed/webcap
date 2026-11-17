'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,queueModel,observedModels,openDirector,say,stories,story,seedProject,seedScene}=require('./helpers.cjs');

// The replacement for combined Chat/authoring tests: text first, then a
// separately invoked, schema-focused Write using the same conversation.
test('Studio Chat discusses an idea, then explicit Write creates a saved Project without Review',async({page,request})=>{
  await resetModel(request);
  await openDirector(page);
  await queueModel(request,'A quiet, locked-off opening makes the discovery more suspenseful.');
  await say(page,'A courier finds a red mitten at an empty railway station. What staging works?');
  const reply=page.locator('#director-chat-messages .director-chat-message-assistant').last()
    .locator('.director-chat-message-body');
  await expect(reply).toContainText('locked-off opening');
  await expect(reply).not.toContainText('"changes":');
  await expect(page.locator('#studio-dw-suggestions')).toHaveCount(0);
  const projectTitle='Focused Studio Project '+Date.now();
  await queueModel(request,{title:projectTitle,
    concept:'A courier discovers a misplaced red mitten at an empty station.',
    style:'Locked-off camera, restrained blue morning light.',
    invariants:[],initialScenes:[],rationale:'Developed from the conversation.'});
  await page.locator('#studio-dw-write').click();
  await page.locator('#studio-dw-write-operation').selectOption('new-project');
  await page.locator('#studio-dw-write-prepare').click();
  await expect.poll(async()=>(await stories(page)).some(p=>p.title===projectTitle),
    {timeout:30000}).toBe(true);
  await expect(page.locator('#studio-project-review')).toHaveCount(0);
  const created=(await stories(page)).find(p=>p.title===projectTitle);
  expect((await story(page,created.id)).style).toContain('Locked-off');
  const calls=(await observedModels(request)).calls;
  expect(calls).toHaveLength(2);
  expect(calls[0].response_schema||calls[0].responseSchema||null).toBeFalsy();
});

test('Studio conversation never promotes a model JSON claim into an authored change',async({page,request})=>{
  await resetModel(request);
  await openDirector(page);
  await queueModel(request,{reply:'Renamed the Scene.',changes:{scene:{title:'Left Behind'}}});
  await say(page,'What is a good name for this Scene?');
  await expect(page.locator('#studio-dw-suggestions .studio-dw-suggestion-action')).toHaveCount(0);
  await expect(page.locator('#director-chat-messages .director-chat-message-assistant').last())
    .toContainText('Renamed the Scene');
  // Chat output is never interpreted as a save or classified as an action.
  await expect(page.locator('#studio-dw-write-ready-launch')).toHaveCount(0);
});

test('Studio Chat -> Write Scene saves an H3 prompt directly and preserves conversation',async({page,request})=>{
  await resetModel(request);
  const project=await page.request.post('/fs/storyboard',{data:{operation:'create_story',story:{
    title:'Conversation to Scene '+Date.now(),
    concept:'A courier finds a lost red mitten at a station.',
    style:'Restrained blue dawn.',invariants:[],status:'active',targetSceneCount:2
  }}});
  expect(project.ok()).toBeTruthy();
  const id=(await project.json()).story.id;
  await openDirector(page);
  const opening='The courier notices a red mitten on an empty platform. Discuss the staging.';
  const answer='A static wide opening followed by a subtle hand gesture makes the moment intimate.';
  await queueModel(request,answer);
  await say(page,opening);
  await expect(page.locator('#director-chat-messages .director-chat-message-assistant').last())
    .toContainText('static wide opening');
  const prompt='Eight-second locked-off wide shot at an empty blue-dawn station. '+
    'A courier stops beside a single red mitten, reaches with the left hand, '+
    'and lifts the mitten into the palm. Only distant wind and cloth movement.';
  await queueModel(request,{scenes:[{title:'The Find',prompt,durationSeconds:8}]});
  await page.locator('#studio-dw-write').click();
  await page.locator('#studio-dw-write-operation').selectOption('scene-write');
  await page.locator('#studio-dw-write-project').selectOption(id);
  await page.locator('#studio-dw-scene-mode').selectOption('create');
  await page.locator('#studio-dw-write-instruction').fill('Write the Scene we discussed.');
  await page.locator('#studio-dw-write-prepare').click();
  await expect.poll(async()=> (await story(page,id)).sceneOrder.length,{timeout:30000}).toBe(1);
  const saved=await story(page,id);
  expect(saved.scenes[saved.sceneOrder[0]].prompt).toBe(prompt);
  await expect(page.locator('#studio-scenes-review')).toHaveCount(0);
  const calls=(await observedModels(request)).calls;
  expect(calls).toHaveLength(2);
  expect(JSON.stringify(calls[1])).toContain(opening);
  expect(JSON.stringify(calls[1])).toContain(answer);
});

test('explicit Overview Write changes the selected Project and records field History',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'Focused Overview '+Date.now(),{
    concept:'A quiet lighthouse story.',style:'Blue morning.'
  });
  await openDirector(page);
  await queueModel(request,{title:project.title,
    concept:'A quiet lighthouse story.',style:'Warm late afternoon.',invariants:[]});
  await page.locator('#studio-dw-write').click();
  await page.locator('#studio-dw-write-operation').selectOption('project');
  await page.locator('#studio-dw-write-project').selectOption(project.id);
  await page.locator('#studio-dw-write-prepare').click();
  await expect.poll(async()=>(await story(page,project.id)).style,
    {timeout:30000}).toBe('Warm late afternoon.');
  expect((await story(page,project.id)).concept).toBe('A quiet lighthouse story.');
  const revisions=await page.evaluate(id=>{
    const h=window.webcapTextareaRevisions.history(
      'project:'+id+':storyboard-story-style');
    return h&&h.versions;
  },project.id);
  expect(revisions).toContain('Blue morning.');
  expect(revisions).toContain('Warm late afternoon.');
  await expect(page.locator('#studio-brief-review')).toHaveCount(0);
});

test('explicit selected-Scene revision saves Prompt and retains raw Write I/O',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'Focused Revision '+Date.now());
  const original='An eight-second shot of a quiet bookshop at dusk.';
  const scene=await seedScene(page,project.id,{
    title:'Opening',prompt:original,durationSeconds:8
  });
  await openDirector(page);
  const updated='Eight-second locked-off shot of a quiet bookshop at dusk, then the bell sways.';
  await queueModel(request,{prompt:updated});
  await page.locator('#studio-dw-write').click();
  await page.locator('#studio-dw-write-operation').selectOption('scene-write');
  await page.locator('#studio-dw-write-project').selectOption(project.id);
  await page.locator('#studio-dw-scene-mode').selectOption('revise');
  await page.locator('#studio-dw-batch-scenes input[value="'+scene.id+'"]').check();
  await page.locator('#studio-dw-write-instruction').fill('Make the scene more suspenseful.');
  await page.locator('#studio-dw-write-prepare').click();
  await expect.poll(async()=>(await story(page,project.id)).scenes[scene.id].prompt,
    {timeout:30000}).toBe(updated);
  const history=await page.evaluate(({pid,sid})=>{
    const h=window.webcapTextareaRevisions.history(
      'project:'+pid+':scene:'+sid+':field:prompt');
    return h&&h.versions;
  },{pid:project.id,sid:scene.id});
  expect(history).toContain(original);
  expect(history).toContain(updated);
  await page.locator('#studio-director-inspect').click();
  await expect(page.locator('#studio-director-io-raw')).toContainText(updated);
  await expect(page.locator('#studio-scenes-review')).toHaveCount(0);
});
