'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,queueModel,observedModels,openDirector,say,story,stories,
  seedProject,openProject,reopenDirectorIfClosed,ensureAttachedProject}=require('./helpers.cjs');

test('mixed Director response keeps both Project and Scene drafts independently reviewable',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'Mixed Review Source '+Date.now(),{
    concept:'The night watchman notices an empty train.',style:'Warm amber light.'
  });
  await openDirector(page);
  await openProject(page,project.id);
  await reopenDirectorIfClosed(page);
  await ensureAttachedProject(page,project.title);
  const futureTitle='Mixed Project Draft '+Date.now();
  const newScene={title:'Platform',
    prompt:'A night watchman walks toward the stationary midnight train in wide blue light.',
    durationSeconds:8};
  await queueModel(request,{
    reply:'The Project and the new Scene are ready for separate review.',
    changes:{project:{title:futureTitle,concept:'A watchman discovers a sealed train.',
      style:'Cool blue moonlight.',invariants:[]}},
    scenes:[newScene]
  });
  await say(page,'Develop a new Project direction and an opening Scene together.');
  const sceneAction=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  await expect(sceneAction).toContainText('Review authored Scene');
  const projectAction=page.locator('#director-chat-messages .studio-dw-suggestion-action')
    .filter({hasText:'Review authored Project'});
  await expect(projectAction).toHaveCount(1);
  await sceneAction.click();
  await expect(page.locator('#studio-scenes-review')).toBeVisible();
  await expect(page.locator('#studio-scenes-rows [data-field="prompt"]').first())
    .toHaveValue(newScene.prompt);
  await page.locator('#studio-scenes-apply').click();
  await expect.poll(async()=>(await story(page,project.id)).sceneOrder.length).toBe(1);
  const savedSource=await story(page,project.id);
  expect(savedSource.scenes[savedSource.sceneOrder[0]].prompt).toBe(newScene.prompt);
  expect(savedSource.style).toBe('Warm amber light.',
    'saving the Scene does not apply the separate Project draft');
  await expect(projectAction).toBeVisible();
  await projectAction.click();
  await expect(page.locator('#studio-project-review')).toBeVisible();
  await expect(page.locator('#studio-project-title')).toHaveValue(futureTitle);
  await expect(page.locator('#studio-project-style')).toHaveValue('Cool blue moonlight.');
  await page.locator('#studio-project-create').click();
  await expect.poll(async()=>(await stories(page)).some(p=>p.title===futureTitle)).toBe(true);
  const created=(await stories(page)).find(p=>p.title===futureTitle);
  expect(created.style).toBe('Cool blue moonlight.');
  expect((await story(page,project.id)).sceneOrder).toEqual(savedSource.sceneOrder);
  expect((await observedModels(request)).calls).toHaveLength(1,
    'review and saving two independent results never requires another model call');
});
