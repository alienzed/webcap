'use strict';
const {test,expect}=require('../browser/test.cjs');
const {openLiveDirector,sendLive,story,seedProject,openProject,reopenDirectorIfClosed}=require('./helpers.cjs');

test('LIVE — conversation attachment survives a different write destination and navigation',async({page},testInfo)=>{
  const a=await seedProject(page,'Attached A '+Date.now(),{concept:'A maritime museum.',style:'Cold blue hall light.'});
  const b=await seedProject(page,'Destination B '+Date.now(),{concept:'A painter in a greenhouse.',style:'Soft green daylight.'});
  const model=await openLiveDirector(page);
  await openProject(page,a.id);
  await reopenDirectorIfClosed(page);
  const requests=[];
  page.on('request',req=>{
    if(req.method()==='POST'&&new URL(req.url()).pathname==='/fs/director/chat')
      requests.push(req.postDataJSON());
  });
  await sendLive(page,'Discuss the greenhouse painting as a creative idea, without changing any saved Project.');
  expect(requests).toHaveLength(1);
  expect(JSON.stringify(requests[0].messages)).not.toContain('A maritime museum.');
  // Attachment controls live in the Read / Write sidebar.
  await page.locator('#studio-dw-open-tools').click();
  await expect(page.locator('#director-studio-attach-current')).toBeVisible();
  // The header may suggest the open Project even without an attachment.
  // The saved conversation, not that label, owns the association.
  const sessions=await page.request.get('/fs/director/chats').then(response=>response.json());
  const chatId=sessions.activeByMode.storyboard;
  const attachment=async()=>{
    const result=await page.request.get('/fs/director/chats/'+chatId+'?inspect=1')
      .then(response=>response.json());
    return result.chat.storyAccess?.storyId || null;
  };
  expect(await attachment()).toBeNull();
  await page.locator('#director-studio-attach-current').click();
  await expect(page.locator('#director-chat-title')).toContainText(a.title);
  await expect.poll(attachment).toBe(a.id);
  await openProject(page,b.id);
  await reopenDirectorIfClosed(page);
  await expect(page.locator('#director-chat-title')).toContainText(a.title);

  const responses=[];
  page.on('response',async res=>{
    if(res.ok()&&new URL(res.url()).pathname==='/fs/director/job'){
      try{
        const job=(await res.json()).job;
        if(job?.status==='completed'&&job.result?.text) responses.push(job.result.text);
      }catch{}
    }
  });
  await sendLive(page,'Author a complete replacement Project visual atmosphere: warm bright amber sunlight in a greenhouse. Return changes.project.style for review.');
  const raw=responses.at(-1);
  expect(raw,'Real Director completed without a structured response').toBeTruthy();
  const authored=JSON.parse(raw);
  expect(typeof authored.changes?.project?.style).toBe('string');
  const desired=authored.changes.project.style;
  expect(desired.trim().length).toBeGreaterThan(10);
  const destination=page.locator('#studio-dw-suggestions select[aria-label="Project material destination"]');
  await expect(destination).toBeVisible();
  await destination.selectOption(b.id);
  await page.locator('#studio-dw-suggestions .studio-dw-suggestion-action').click();
  await expect(page.locator('#studio-brief-target')).toContainText(b.title);
  await expect(page.locator('#studio-brief-style')).toHaveValue(desired);
  await page.locator('#studio-brief-apply').click();
  await expect.poll(async()=>(await story(page,b.id)).style).toBe(desired);
  expect((await story(page,a.id)).style).toBe('Cold blue hall light.');
  await expect(page.locator('#director-chat-title')).toContainText(a.title);
  await sendLive(page,'Discuss another staging possibility, without editing saved material.');
  await expect(page.locator('#director-chat-title')).toContainText(a.title);
  expect(await attachment()).toBe(a.id);
  await testInfo.attach('independent-live-destinations',{body:Buffer.from(JSON.stringify({
    model,attached:a.id,destination:b.id,requests,raw,style:desired
  },null,2)),contentType:'application/json'});
});
