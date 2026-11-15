'use strict';
const {test,expect}=require('../browser/test.cjs');

test('Opt-in smoke: a real Director model answers a plain user question',async({page})=>{
  await page.goto('/');
  await page.locator('#activity-storyboard-btn').click();
  await page.locator('#director-chat-rail-btn').click();
  await page.locator('[data-assistant-mode="storyboard"]').click();
  const selected='acceptance-live::'+process.env.WEBCAP_TEST_REMOTE_MODEL;
  const model=page.locator('#app-header-director-model');
  await expect(model.locator('option')).toContainText(process.env.WEBCAP_TEST_REMOTE_MODEL);
  await model.selectOption(selected);
  await page.locator('#director-chat-input').fill('Name one colour. Reply with a single short sentence and do not change anything.');
  await page.locator('#director-chat-send').click();
  await expect(page.locator('#director-chat-messages')).toContainText(/\w{3,}/);
  await expect(page.locator('#director-chat-send')).toBeEnabled();
  // This proves the real inference path returns a visible answer, not creative
  // quality or reliable adherence to a complex authoring contract.
});
