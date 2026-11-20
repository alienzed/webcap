'use strict';
const {test,expect}=require('../browser/test.cjs');
const {openLiveDirector,attachProject,addEvidence,story,seedProject,seedScene,reopenDirectorIfClosed}=require('./helpers.cjs');

test('Live optional Flow 9 — real Coherence review proposes changes without silently saving or generating Takes',async({page},testInfo)=>{
  const project=await seedProject(page,'Live Coherence '+Date.now());
  const first=await seedScene(page,project.id,{
    title:'First street',prompt:'An explorer approaches a library at dawn.',durationSeconds:8
  });
  const second=await seedScene(page,project.id,{
    title:'Second street',prompt:'The same explorer walks through the library at dusk.',durationSeconds:8
  });
  const model=await openLiveDirector(page);
  await attachProject(page,project);
  await page.locator('#director-studio-actions-toggle').click();
  await page.locator('[data-studio-tool="revision"]').click();
  await expect(page.locator('#director-studio-composer-mode-select')).toHaveValue('revision');
  await page.locator('#director-studio-revision-preset').selectOption('coherence');
  await expect(page.locator('#director-studio-revision-fresh')).not.toBeChecked();
  await expect(page.locator('#director-chat-send')).toHaveText('Check Coherence');
  await page.locator('#director-chat-send').click();
  const results=page.getByRole('dialog',{name:'Check Coherence results'});
  await expect(results).toBeVisible({timeout:180000});
  await expect(results).toContainText(/Scenes reviewed/);
  expect(await results.locator('textarea').count(),'Coherence must expose at least one actual reviewed Scene').toBeGreaterThan(0);
  const beforeApply=await story(page,project.id);
  expect(beforeApply.scenes[first.id].prompt).toBe('An explorer approaches a library at dawn.');
  expect(beforeApply.scenes[second.id].prompt).toBe('The same explorer walks through the library at dusk.');
  expect(Object.keys(beforeApply.scenes[first.id].takes)).toHaveLength(0);
  expect(Object.keys(beforeApply.scenes[second.id].takes)).toHaveLength(0);
  await addEvidence(testInfo,page,model,'Check Coherence via the existing revision composer',
    {coherenceReview:await results.innerText(),projectId:project.id});
  await results.getByRole('button',{name:'Close / Discard'}).click();
  const unchanged=await story(page,project.id);
  expect(unchanged.scenes[first.id].prompt).toBe(beforeApply.scenes[first.id].prompt);
  expect(unchanged.scenes[second.id].prompt).toBe(beforeApply.scenes[second.id].prompt);
});

for(const [name,dismissDirector] of [
  ['Project coherence replaces setup and Apply returns to chat',false],
  ['Project coherence stays dismissed and can be reviewed when Director reopens',true]
]){
  test('LIVE Write tools — '+name,async({page})=>{
    test.setTimeout(360000);
    const project=await seedProject(page,'Live Coherence Handoff '+Date.now(),{
      concept:'One continuous indoor shot with a hard cut as Mara, wearing the same red coat, opens a door.'
    });
    await seedScene(page,project.id,{
      title:'Before the cut',prompt:'Mara, wearing a red coat, reaches for a library door in bright morning light.',durationSeconds:8
    });
    await seedScene(page,project.id,{
      title:'After the cut',prompt:'At the same instant Mara opens the same door, her coat is blue and the hall is dark.',durationSeconds:8
    });
    await openLiveDirector(page);
    await attachProject(page,project);
    await page.locator('#director-studio-actions-toggle').click();
    await page.locator('[data-studio-tool="project"]').click();
    await page.locator('#studio-dw-write-project').selectOption(project.id);
    const setup=page.locator('#director-chat-sidebar');
    await setup.getByText('Project tools',{exact:true}).click();
    const check=page.locator('#studio-dw-coherence-check');
    const review=page.locator('#studio-dw-batch-review');
    if(dismissDirector){
      const endpoint='**/fs/storyboard/director';
      let resumeRequest;
      const waitForDismissal=new Promise(resolve=>{resumeRequest=resolve;});
      await page.route(endpoint,async route=>{
        if(route.request().method()==='POST') await waitForDismissal;
        await route.continue();
      });
      try{
        const queued=page.waitForRequest(request=>
          request.method()==='POST' &&
          new URL(request.url()).pathname==='/fs/storyboard/director' &&
          request.postDataJSON().operation==='check_coherence_sequence');
        await check.click();
        await queued;
        await page.locator('#director-chat-close').click();
        await expect(page.locator('#director-chat-drawer')).toBeHidden();
      } finally {
        resumeRequest();
      }
      await expect(check).toBeEnabled({timeout:300000});
      await expect(page.locator('#studio-dw-batch-review[open]')).toHaveCount(0);
      await reopenDirectorIfClosed(page);
      await expect(setup).toBeHidden();
      await page.getByRole('button',{name:'Review coherence changes'}).click();
    }else{
      await check.click();
    }
    await expect(review).toBeVisible({timeout:300000});
    await expect(setup).toBeHidden();
    await expect(page.locator('dialog[open]')).toHaveCount(1);
    await page.locator('#studio-dw-batch-apply').click();
    await expect(review).toBeHidden();
    await expect(setup).toBeHidden();
    await expect(page.locator('#director-chat-messages')).toContainText('Saved '+project.title);
  });
}
