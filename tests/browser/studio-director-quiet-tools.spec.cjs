'use strict';
const {test,expect}=require('./test.cjs');
const {openDirector,seedProject}=require('./helpers.cjs');

test('Studio Director exposes its tools beside the composer instead of the header', async({page})=>{
  await openDirector(page);
  const drawer=page.locator('#director-chat-drawer');
  await expect(drawer).toHaveClass(/studio-director/);
  await expect(page.locator('#director-studio-actions-toggle')).toBeVisible();
  await expect(page.locator('#studio-dw-open-tools')).toBeHidden();
  await expect(page.locator('#director-chat-history-toggle')).toBeHidden();
  await expect(page.locator('#director-chat-clear')).toBeHidden();
  await expect(page.locator('#studio-dw-read-panel')).toBeHidden();

  const launcher=page.locator('#director-studio-actions-toggle');
  await launcher.click();
  await expect(launcher).toHaveAttribute('aria-expanded','true');
  const menu=page.locator('#director-studio-actions-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-studio-tool]')).toHaveCount(7);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(launcher).toBeFocused();
  await launcher.click();
  await page.locator('#director-chat-input').click();
  await expect(menu).toBeHidden();

  await launcher.click();
  await menu.locator('[data-studio-tool="read"]').click();
  await expect(page.locator('#studio-dw-read-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#director-chat-drawer')).not.toHaveClass(/studio-actions-open/);
  await expect(drawer).toBeVisible();
  await expect(launcher).toBeFocused();
});

test('explicit Read is discoverable and still appends a visible Project snapshot',async({page})=>{
  await openDirector(page);
  const project=await seedProject(page,'Quiet Toolbox Context '+Date.now(),{
    concept:'An unhurried yoga class.',
    style:'Natural light with restrained camera movement.'
  });
  await expect(page.locator('#director-studio-context-note')).toContainText('No Project snapshot');
  await page.locator('#director-studio-actions-toggle').click();
  await page.locator('[data-studio-tool="read"]').click();
  await expect(page.locator('#studio-dw-read-panel')).toBeVisible();
  await page.locator('#studio-dw-read-project').selectOption(project.id);
  await expect(page.locator('#studio-dw-read-send')).toBeEnabled();
  await page.locator('#studio-dw-read-send').click();
  await expect(page.locator('#director-studio-context-note')).toContainText('Project snapshot in conversation');
  await expect(page.locator('#director-chat-messages')).toContainText('WEBCAP EXPLICIT READ');
  await expect(page.locator('#director-chat-drawer')).not.toHaveClass(/studio-actions-open/);
});

test('Write Scene(s) and Write Project open scoped existing controls without a model request',async({page})=>{
  await openDirector(page);
  const project=await seedProject(page,'Quiet Toolbox Write '+Date.now(),{
    concept:'A quiet class.',style:'Observational.'
  });
  await page.locator('#director-studio-actions-toggle').click();
  await page.locator('[data-studio-tool="scene"]').click();
  await expect(page.locator('#studio-dw-write-panel')).toBeVisible();
  await expect(page.locator('#studio-dw-write-operation')).toHaveValue('scene-write');
  await expect(page.locator('#studio-dw-scene-mode')).toHaveValue('create');
  await page.locator('#studio-dw-write-project').selectOption(project.id);
  await page.locator('#studio-dw-write-instruction').fill('Build one quiet opening Scene.');
  await page.locator('#studio-dw-close-actions').click();
  await expect(page.locator('#studio-dw-write-panel')).toBeHidden();
  await page.locator('#director-studio-actions-toggle').click();
  await page.locator('[data-studio-tool="project"]').click();
  await expect(page.locator('#studio-dw-write-panel')).toBeVisible();
  await expect(page.locator('#studio-dw-write-operation')).toHaveValue('project');
  await expect(page.locator('#studio-dw-write-instruction')).toHaveValue('Build one quiet opening Scene.');
});

test('Composer grows with longer instructions before internal scrolling', async({page})=>{
  await openDirector(page);
  const composer=page.locator('#director-chat-input');
  const start=await composer.evaluate(node=>node.clientHeight);
  expect(start).toBeGreaterThanOrEqual(150);
  await composer.fill(Array.from({length:16},(_,i)=>'Describe camera beat '+(i+1)).join('\n'));
  const middle=await composer.evaluate(node=>node.clientHeight);
  expect(middle).toBeGreaterThan(start);
  await composer.fill(Array.from({length:80},(_,i)=>'Scene instruction '+(i+1)).join('\n'));
  const end=await composer.evaluate(node=>({
    height:node.clientHeight,scrollHeight:node.scrollHeight,
    overflow:getComputedStyle(node).overflowY
  }));
  expect(end.height).toBeGreaterThanOrEqual(middle);
  expect(end.height).toBeLessThanOrEqual(435);
  expect(end.scrollHeight).toBeGreaterThan(end.height);
  expect(end.overflow).toBe('auto');
});
