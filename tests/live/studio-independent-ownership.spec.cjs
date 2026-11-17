'use strict';
const {test,expect}=require('../browser/test.cjs');
const {openLiveDirector,sendLive,writeLive,observeLiveCalls,story,seedProject,openProject,reopenDirectorIfClosed}=require('./helpers.cjs');

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

  const observed=observeLiveCalls(page);
  const direction='Revise the explicitly selected Project B visual atmosphere to bright amber sunlight in a greenhouse. Preserve all other fields.';
  await writeLive(page,{projectId:b.id,operation:'project',instruction:direction});
  await expect.poll(async()=>(await story(page,b.id)).style,{timeout:60000})
    .not.toBe('Soft green daylight.');
  const saved=await story(page,b.id);
  const raw=observed.jobs.at(-1)?.raw||'';
  expect(raw,'The model returned no Project revision response').toBeTruthy();
  const authored=JSON.parse(raw);
  expect(typeof authored.style).toBe('string');
  expect(saved.style).toBe(authored.style);
  expect((await story(page,a.id)).style).toBe('Cold blue hall light.');
  await expect(page.locator('#director-chat-title')).toContainText(a.title);
  await sendLive(page,'Discuss another staging possibility, without editing saved material.');
  await expect(page.locator('#director-chat-title')).toContainText(a.title);
  expect(await attachment()).toBe(a.id);
  await testInfo.attach('independent-live-destinations',{body:Buffer.from(JSON.stringify({
    model,attached:a.id,destination:b.id,requests,raw,style:saved.style
  },null,2)),contentType:'application/json'});
});
