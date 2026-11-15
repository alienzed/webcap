'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,queueModel,observedModels}=require('./helpers.cjs');

test('Flow 8 — Studio Block is saved, restored and explicitly inserted into a Director draft', async ({page,request}) => {
  await resetModel(request);
  const browserErrors=[];
  page.on('pageerror',error=>browserErrors.push(error.message));
  await page.goto('/');
  await page.locator('#activity-storyboard-btn').click();
  await expect(page.locator('#studio-blocks-open')).toBeVisible();
  await page.locator('#studio-blocks-open').click();
  await expect(page.locator('#studio-blocks-dialog')).toBeVisible();
  await page.locator('#studio-blocks-new').click();
  await page.locator('#studio-blocks-title').fill('Rainy Library Detail');
  await page.locator('#studio-blocks-content').fill('Amber light reflects on wet cobblestones.');
  await page.locator('#studio-blocks-save').click();
  await expect(page.locator('#studio-blocks-status')).toHaveText('Saved.');
  await page.locator('#studio-blocks-close').click();
  await page.locator('#studio-blocks-open').click();
  await page.locator('#studio-blocks-list').getByRole('button',{name:/Rainy Library Detail/}).click();
  await expect(page.locator('#studio-blocks-content')).toHaveValue('Amber light reflects on wet cobblestones.');
  const saved=await page.request.get('/fs/studio-blocks');
  expect(saved.ok()).toBeTruthy();
  expect((await saved.json()).blocks).toEqual(expect.arrayContaining([
    expect.objectContaining({title:'Rainy Library Detail',content:'Amber light reflects on wet cobblestones.'})
  ]));
  await page.locator('#studio-blocks-close').click();
  await page.locator('#director-chat-rail-btn').click();
  await page.locator('[data-assistant-mode="storyboard"]').click();
  const composer=page.locator('#director-chat-input');
  await expect(composer).toBeVisible();
  await composer.fill('Before /Rainy After');
  // Inserting a Block cannot itself send a message or mutate the Project.
  await composer.evaluate(node=>{const pos=node.value.indexOf(' After');node.setSelectionRange(pos,pos);node.dispatchEvent(new Event('input',{bubbles:true}));});
  await expect(page.locator('#studio-blocks-slash')).toBeVisible();
  await page.locator('#studio-blocks-slash').getByRole('option',{name:/Rainy Library Detail/}).click();
  await expect(composer).toHaveValue('Before Amber light reflects on wet cobblestones. After');
  await expect(page.locator('#studio-blocks-slash')).toBeHidden();
  const model=page.locator('#app-header-director-model');
  await expect(model.locator('option[value="acceptance::acceptance-model"]')).toHaveCount(1);
  await model.selectOption('acceptance::acceptance-model');
  await queueModel(request,'I have read the inserted instruction.');
  await page.locator('#director-chat-send').click();
  await expect(page.locator('#director-chat-messages')).toContainText('I have read the inserted instruction.');
  const calls=(await observedModels(request)).calls;
  expect(calls).toHaveLength(1);
  expect(calls[0].messages.some(item=>item.role==='user' &&
    String(item.content).includes('Before Amber light reflects on wet cobblestones. After'))).toBeTruthy();
  expect(browserErrors).toEqual([]);
});
