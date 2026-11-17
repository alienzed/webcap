'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,queueModel,observedModels,openDirector,say,stories,story}=require('./helpers.cjs');

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
  await expect(page.locator('#studio-dw-suggestions .studio-dw-suggestion-action')).toHaveCount(0);
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
  await expect(page.locator('#studio-project-review')).not.toBeVisible();
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
  await expect(page.locator('#director-chat-progress-detail')).toContainText(/structured data|conversation/i);
});
