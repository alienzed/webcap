'use strict';
const {test,expect}=require('../browser/test.cjs');
const {openLiveDirector,sendLive,addEvidence}=require('./helpers.cjs');

test('Live smoke — WebCap shows a real configured model reply',async({page},testInfo)=>{
  const model=await openLiveDirector(page);
  const instruction='Answer with a short sentence identifying one ordinary colour. This is a discussion; create or save no Project.';
  await sendLive(page,instruction);
  await expect.poll(async()=>{
    const all=await page.locator('#director-chat-messages').innerText();
    return all.trim().length;
  },{timeout:180000}).toBeGreaterThan(instruction.length);
  await addEvidence(testInfo,page,model,instruction);
});
