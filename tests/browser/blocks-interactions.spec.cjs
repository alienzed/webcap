'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,observedModels}=require('./helpers.cjs');

test('Flow 8 — Block edit, copy, delete and keyboard insertion preserve author control',async({page,context,request})=>{
  await resetModel(request);
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.goto('/');
  await page.locator('#activity-storyboard-btn').click();
  await page.locator('#studio-blocks-open').click();
  await expect(page.locator('#studio-blocks-dialog')).toBeVisible();

  const title='Keyboard Block '+Date.now();
  await page.locator('#studio-blocks-new').click();
  await page.locator('#studio-blocks-title').fill(title);
  await page.locator('#studio-blocks-content').fill('Initial scene guidance.');
  await page.locator('#studio-blocks-save').click();
  await expect(page.locator('#studio-blocks-status')).toHaveText('Saved.');
  await page.locator('#studio-blocks-close').click();

  await page.locator('#studio-blocks-open').click();
  await page.locator('#studio-blocks-list').getByRole('button',{name:new RegExp(title)}).click();
  await expect(page.locator('#studio-blocks-content')).toHaveValue('Initial scene guidance.');
  const revised='Revised amber doorway detail.';
  await page.locator('#studio-blocks-content').fill(revised);
  await page.locator('#studio-blocks-save').click();
  await expect(page.locator('#studio-blocks-status')).toHaveText('Saved.');
  await page.locator('#studio-blocks-copy').click();
  await expect(page.locator('#studio-blocks-status')).toHaveText('Copied to clipboard.');
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(revised);
  await page.locator('#studio-blocks-close').click();

  await page.locator('#director-chat-rail-btn').click();
  const studio=page.locator('[data-assistant-mode="storyboard"]');
  if(await studio.isVisible()) await studio.click();
  const input=page.locator('#director-chat-input');
  await expect(input).toBeVisible();
  await input.fill('Before /Keyboard After');
  await input.evaluate(el=>{
    const caret=el.value.indexOf(' After');
    el.setSelectionRange(caret,caret);
    el.dispatchEvent(new Event('input',{bubbles:true}));
  });
  const picker=page.locator('#studio-blocks-slash');
  await expect(picker).toBeVisible();
  await input.press('Escape');
  await expect(picker).toBeHidden();
  await expect(input).toHaveValue('Before /Keyboard After');

  await input.evaluate(el=>el.dispatchEvent(new Event('input',{bubbles:true})));
  await expect(picker).toBeVisible();
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(picker).toBeHidden();
  await expect(input).toHaveValue('Before '+revised+' After');
  await expect(page.locator('#director-chat-messages')).not.toContainText('Before '+revised+' After');
  expect((await observedModels(request)).calls).toHaveLength(0);
  await input.fill('Author edited '+revised);

  await page.locator('#studio-blocks-open').click();
  await page.locator('#studio-blocks-list').getByRole('button',{name:new RegExp(title)}).click();
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#studio-blocks-delete').click();
  await expect(page.locator('#studio-blocks-list').getByRole('button',{name:new RegExp(title)})).toHaveCount(0);
  await page.locator('#studio-blocks-close').click();
  const saved=await page.request.get('/fs/studio-blocks');
  expect(saved.ok()).toBeTruthy();
  expect((await saved.json()).blocks.some(item=>item.title===title)).toBe(false);
  await expect(input).toHaveValue('Author edited '+revised);
  expect((await observedModels(request)).calls).toHaveLength(0);
});
