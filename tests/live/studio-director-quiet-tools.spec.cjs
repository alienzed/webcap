'use strict';
const {test,expect}=require('../browser/test.cjs');
const {
  openLiveDirector,seedProject,openProject,reopenDirectorIfClosed,
  waitForLiveJob,sendLive,story
}=require('./helpers.cjs');

// This scenario uses the configured real Director model and WebCap's actual
// Read/Write routes. No response mocking or synthetic model outputs.
test('LIVE Studio toolbox: explicit Read, then one scoped Scene Write from the new launcher',async({page},info)=>{
  test.setTimeout(600000);
  const model=await openLiveDirector(page);
  const project=await seedProject(page,'Live Quiet Director '+Date.now(),{
    concept:'A quiet yoga session begins in a small neighborhood studio.',
    style:'Natural light, human-scale observation, no advertising aesthetic.'
  });
  await openProject(page,project.id);
  await reopenDirectorIfClosed(page);
  const mode=page.locator('#director-studio-composer-mode-select');
  if(await mode.isVisible() && await mode.inputValue()!=='conversation')
    await mode.selectOption('conversation');

  await page.locator('#director-studio-actions-toggle').click();
  await page.locator('[data-studio-tool="read"]').click();
  await expect(page.locator('#studio-dw-read-panel')).toBeVisible();
  await page.locator('#studio-dw-read-project').selectOption(project.id);
  await page.locator('#studio-dw-read-send').click();
  await expect(page.locator('#director-studio-context-note'))
    .toContainText('Project snapshot in conversation');
  await expect(page.locator('#director-chat-messages')).toContainText('WEBCAP EXPLICIT READ');

  await page.locator('#director-studio-actions-toggle').click();
  await page.locator('[data-studio-tool="scene"]').click();
  await expect(page.locator('#studio-dw-write-operation')).toHaveValue('scene-write');
  await expect(page.locator('#studio-dw-scene-mode')).toHaveValue('create');
  await page.locator('#studio-dw-write-project').selectOption(project.id);
  await page.locator('#studio-dw-write-instruction').fill(
    'Create one complete, approximately 8-second Scene for this yoga Project. '+
    'Begin with the room settling, then follow a participant through a gentle movement. '+
    'Write a concrete, usable H3 scene prompt with timed visual beats.'
  );
  await waitForLiveJob(page,()=>page.locator('#studio-dw-write-prepare').click());
  const saved=await story(page,project.id);
  expect(saved.sceneOrder.length).toBeGreaterThanOrEqual(1);
  const created=saved.sceneOrder.map(id=>saved.scenes[id]);
  expect(created.some(scene=>typeof scene.prompt==='string' && scene.prompt.trim())).toBe(true);
  await info.attach('studio-quiet-toolbox-live',{
    body:Buffer.from(JSON.stringify({model,projectId:project.id,sceneCount:created.length,
      scenes:created.map(s=>({title:s.title,prompt:s.prompt}))},null,2)),
    contentType:'application/json'
  });
});

test('LIVE Studio toolbox: model conversation, I/O, History and New conversation remain accessible',async({page},info)=>{
  test.setTimeout(600000);
  const model=await openLiveDirector(page);
  const message='For a brief movie of a yoga class, how would you portray quiet concentration without a commercial look?';
  await expect(page.locator('#director-studio-context-note')).toContainText('No Project snapshot');
  await sendLive(page,message);
  await expect(page.locator('#director-chat-messages')).toContainText(message);
  await expect(page.locator('#director-chat-messages .director-chat-message-assistant')).not.toHaveCount(0);
  // A regular chat never reads saved Project fields, even when tools are present.
  await expect(page.locator('#director-studio-context-note')).toContainText('No Project snapshot');

  const toggle=page.locator('#director-studio-actions-toggle');
  await toggle.click();
  await page.locator('[data-studio-tool="io"]').click();
  const io=page.locator('#studio-director-io-dialog');
  await expect(io).toBeVisible();
  await expect(page.locator('#studio-director-io-raw')).not.toBeEmpty();
  await page.locator('#studio-director-io-close').click();

  await toggle.click();
  await page.locator('[data-studio-tool="new-chat"]').click();
  await expect(page.locator('#director-chat-messages')).toBeEmpty({timeout:20000});
  await expect(page.locator('#director-studio-context-note')).toContainText('No Project snapshot');

  await toggle.click();
  await page.locator('[data-studio-tool="history"]').click();
  const history=page.locator('#director-chat-history-panel');
  await expect(history).toBeVisible();
  await history.locator('.director-chat-history-item button').filter({hasText:message.slice(0,40)}).first().click();
  await expect(history).toBeHidden();
  await expect(page.locator('#director-chat-messages')).toContainText(message);
  await info.attach('quiet-director-live-utilities',{
    body:Buffer.from(JSON.stringify({model,originalMessage:message,
      restoredConversation:await page.locator('#director-chat-messages').innerText()},null,2)),
    contentType:'application/json'
  });
});
