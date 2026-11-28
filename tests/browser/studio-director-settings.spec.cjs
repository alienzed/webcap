'use strict';
const {test,expect}=require('./test.cjs');
const {openDirector}=require('./helpers.cjs');

test('Studio Director settings reveal its creative profile without restoring drawer model controls',async({page})=>{
  await openDirector(page);
  const button=page.locator('#director-studio-settings-toggle');
  const panel=page.locator('#director-studio-settings-panel');
  const profile=page.locator('#director-studio-profile');
  await expect(button).toBeVisible();
  await expect(page.locator('.director-chat-model-tools')).toBeHidden();
  await expect(panel).toBeHidden();
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded','true');
  await expect(panel).toBeVisible();
  await expect(profile).toBeVisible();
  await profile.selectOption('imaginative');
  expect(await page.evaluate(()=>localStorage.getItem('webcap.studioDirector.profile'))).toBe('imaginative');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(button).toHaveAttribute('aria-expanded','false');
  await expect(button).toBeFocused();
  await button.click();
  await expect(profile).toHaveValue('imaginative');
  await page.locator('#director-chat-input').click();
  await expect(panel).toBeHidden();
  await button.click();
  await page.locator('#director-chat-close').click();
  await expect(panel).toBeHidden();
  await expect(button).toHaveAttribute('aria-expanded','false');
});

test('Director settings open the single Chat guidance module independently of the existing Write selection',async({page})=>{
  await openDirector(page);
  const button=page.locator('#director-studio-settings-toggle');
  await button.click();
  await page.locator('#director-studio-profile').selectOption('render');
  await page.locator('#director-studio-settings-guidance').click();
  const modal=page.locator('#app-settings-modal');
  await expect(modal).toBeVisible();
  await expect(page.locator('#app-settings-tab-guidance')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#app-settings-guidance-module')).toHaveValue('studio.chat');
  await expect(page.locator('#app-settings-guidance-text')).not.toHaveValue('');
  await expect(page.locator('#director-studio-settings-panel')).toBeHidden();
  await page.locator('#app-settings-close-btn').click();
  await button.click();
  await page.locator('#director-studio-settings-app').click();
  await expect(modal).toBeVisible();
  await expect(page.locator('#app-settings-tab-director')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#app-settings-studio-action-advisor')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(button).toBeVisible();
});

test('Director settings are not presented in ordinary Assistant mode',async({page})=>{
  await openDirector(page);
  await page.evaluate(()=>window.setDirectorChatOpen(true,'chat'));
  await expect(page.locator('#director-studio-settings-toggle')).toBeHidden();
  await expect(page.locator('#director-studio-settings-panel')).toBeHidden();
});
