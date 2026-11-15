'use strict';
const {test,expect}=require('@playwright/test');
const {openDirector,say,resetModel,queueModel,observedModels,stories,story}=require('./helpers.cjs');

test('Flow 1 — create and review a Project Overview; verify actual persistence',async({page,request})=>{
  await resetModel(request);
  const name='Acceptance Bookshop '+Date.now();
  const concept='A bookseller welcomes a visitor into an old bookshop.';
  const style='Amber windows, blue rain outside.';
  await queueModel(request,{
    reply:'The Project is ready for your review.',
    changes:{project:{title:name,concept,style,invariants:[{
      kind:'character',title:'Bookseller',text:'The bookseller wears a red scarf.'
    }]}},
    action:{kind:'create_project',instruction:'Create the rainy bookshop Project.'}
  });
  await openDirector(page);
  await say(page,'Create a Project with a rainy bookshop, title '+name+' and a red-scarfed bookseller.');
  const suggestion=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  await expect(suggestion).toContainText('Create Project');
  await suggestion.click();
  await expect(page.locator('#studio-project-review')).toBeVisible();
  await expect(page.locator('#studio-project-title')).toHaveValue(name);
  await expect(page.locator('#studio-project-style')).toHaveValue(style);
  await expect(page.locator('#studio-project-concept')).toHaveValue(concept);
  await page.locator('#studio-project-concept').fill(concept+' The visitor opens a wooden door.');
  await page.locator('#studio-project-create').click();
  await expect(page.locator('#studio-project-review')).toBeHidden();
  await expect.poll(async()=> (await stories(page)).some(item=>item.title===name)).toBeTruthy();
  const saved=(await stories(page)).find(item=>item.title===name);
  const actual=await story(page,saved.id);
  expect(actual.title).toBe(name);
  expect(actual.style).toBe(style);
  expect(actual.concept).toBe(concept+' The visitor opens a wooden door.');
  expect(actual.invariants).toEqual(expect.arrayContaining([
    expect.objectContaining({kind:'character',title:'Bookseller',text:'The bookseller wears a red scarf.'})
  ]));
  expect(actual.sceneOrder).toHaveLength(0);
  expect((await observedModels(request)).calls).toHaveLength(1);
  await page.reload();
  const restored=await story(page,saved.id);
  expect(restored.concept).toBe(actual.concept);
  expect(restored.invariants).toEqual(actual.invariants);
});
