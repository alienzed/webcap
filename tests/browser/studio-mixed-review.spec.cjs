'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,queueModel,observedModels,openDirector,say,story,stories,
  seedProject,seedScene,openProject,reopenDirectorIfClosed,ensureAttachedProject}=require('./helpers.cjs');

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


test('an edited existing-Scene review reopens with the author edits and leaves saved fields unchanged',async({page,request})=>{
  await resetModel(request);
  const project=await seedProject(page,'Review Draft '+Date.now(),{
    concept:'An evening arrival.',style:'Blue twilight.'
  });
  const scene=await seedScene(page,project.id,{
    title:'Station',prompt:'A watchman crosses the empty platform.',durationSeconds:8
  });
  await openDirector(page);
  await openProject(page,project.id);
  // Unpinned Director covers Scene navigation; explicitly select the saved Scene.
  await page.locator('#director-chat-close').click();
  await page.locator('[data-scene-progress="'+scene.id+'"]').click();
  await reopenDirectorIfClosed(page);
  await ensureAttachedProject(page,project.title);
  await queueModel(request,{
    reply:'The complete Scene revision is ready for review.',
    changes:{scene:{title:'Moonlit Station',
      prompt:'A watchman approaches the silent station doorway beneath blue moonlight.',
      durationSeconds:10}}
  });
  await say(page,'Revise the existing Station Scene with a more distinctive approach.');
  const action=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  await expect(action).toContainText('Review authored Scene');
  await action.click();
  await expect(page.locator('#studio-dw-scene-review')).toBeVisible();
  const prompt=page.locator('#studio-dw-scene-editors [data-field="prompt"]');
  const title=page.locator('#studio-dw-scene-editors [data-field="title"]');
  const duration=page.locator('#studio-dw-scene-editors [data-field="durationSeconds"]');
  const revised='My edited H3: the watchman pauses beside the doorway as rain falls.';
  await prompt.fill(revised);
  await title.fill('Author title');
  await duration.fill('12');
  await page.locator('#studio-dw-scene-close').click();
  expect((await story(page,project.id)).scenes[scene.id].prompt).toBe(scene.prompt);
  await action.click();
  await expect(page.locator('#studio-dw-scene-review')).toBeVisible();
  await expect(prompt).toHaveValue(revised);
  await expect(title).toHaveValue('Author title');
  await expect(duration).toHaveValue('12');
  await page.locator('#studio-dw-scene-close').click();
  expect((await observedModels(request)).calls).toHaveLength(1,
    'reopening a user-edited review should not ask the LLM to regenerate it');
  expect((await story(page,project.id)).scenes[scene.id].title).toBe('Station');
});
