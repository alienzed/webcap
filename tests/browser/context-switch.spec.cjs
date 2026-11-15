'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,queueModel,openDirector,say,story,seedProject,openProject}=require('./helpers.cjs');

test('Flow 5 — moving the Studio editor does not change a conversation-bound Project write',async({page,request})=>{
  await resetModel(request);
  const a=await seedProject(page,'Project A '+Date.now(),{style:'Cool morning light.'});
  const b=await seedProject(page,'Project B '+Date.now(),{style:'Distant red neon.'});
  await openDirector(page);
  await openProject(page,a.id);
  await page.locator('#director-studio-attach-current').click();
  await expect(page.locator('#director-chat-title')).toContainText('Project A');
  await openProject(page,b.id);
  // The open editor is now B, while Director's attached conversation is A.
  await expect(page.locator('#storyboard-library-list [data-story-id="'+b.id+'"]')).toHaveClass(/active/);
  await expect(page.locator('#director-chat-title')).toContainText('Project A');
  await queueModel(request,{
    reply:'I can adjust Project A atmosphere.',
    changes:{project:{style:'Silver moonlight.'}},
    action:{kind:'write_project',instruction:'Update this Project atmosphere.',fields:['style']}
  });
  await say(page,'Revise the attached Project atmosphere to silver moonlight.');
  const action=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  await expect(action).toContainText('Revise Project');
  await action.click();
  await expect(page.locator('#studio-brief-review')).toBeVisible();
  await expect(page.locator('#studio-brief-target')).toContainText('Project A');
  await page.locator('#studio-brief-apply').click();
  await expect.poll(async()=> (await story(page,a.id)).style).toBe('Silver moonlight.');
  expect((await story(page,b.id)).style).toBe('Distant red neon.');
  await page.reload();
  expect((await story(page,a.id)).style).toBe('Silver moonlight.');
  expect((await story(page,b.id)).style).toBe('Distant red neon.');
});
