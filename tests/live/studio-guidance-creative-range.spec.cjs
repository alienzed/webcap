'use strict';
const {test,expect}=require('../browser/test.cjs');
const {openLiveDirector,sendLive,observeLiveCalls}=require('./helpers.cjs');

async function capture(info,model,question,requests,receipt){
  await info.attach('actual-main-chat-guidance-evidence',{
    body:Buffer.from(JSON.stringify({
      model,question,request:requests.at(-1),reply:receipt.raw
    },null,2)),contentType:'application/json'
  });
  expect(requests.at(-1).operation).toBe('studio_chat');
  expect(requests.at(-1).messages[0].role).toBe('system');
  expect(requests.at(-1).messages[0].content).toContain('STUDIO DIRECTOR | CREATIVE PARTNER');
  expect(requests.at(-1).messages[0].content).not.toContain('H3 PROMPT AUTHORING REFERENCE');
  expect(requests.at(-1).messages[0].content).not.toContain('integrated_multimodal_description:');
  expect(receipt.raw.trim().length).toBeGreaterThan(70);
}

test('LIVE Studio Chat — cinematic substance without prescribed action or a story arc',async({page},info)=>{
  const model=await openLiveDirector(page);
  await page.locator('#director-studio-profile').selectOption('classic');
  const observed=observeLiveCalls(page);
  const question='I want an arresting 15-second, single-camera tableau: a rain-streaked window, '+
    'a half-full glass of water, and distant city lights. The glass stays perfectly still. '+
    'Give me two concrete ways to make the image visually and sonically substantial, '+
    'and recommend one briefly.';
  await sendLive(page,question);
  const result=await observed.last();
  await capture(info,model,question,observed.requests,result);
  // Evidence supports qualitative review of whether the Director adds an
  // unnecessary physical event rather than simply checking for a banned word.
});

test('LIVE Studio Chat — dialogue remains explicit across montage or sustained-shot options',async({page},info)=>{
  const model=await openLiveDirector(page);
  await page.locator('#director-studio-profile').selectOption('current');
  const observed=observeLiveCalls(page);
  const question='A 15-second Scene shows two people in a train doorway. The older person says '+
    '"We were here before." The younger says "Then we know the way." '+
    'Compare a fast 1–2-second-cut montage with a sustained shot. '+
    'Keep the exact dialogue and suggest performance, sound, and camera details '+
    'that make each interpretation distinctive. Be concise.';
  await sendLive(page,question);
  const result=await observed.last();
  await capture(info,model,question,observed.requests,result);
  expect(result.raw).toContain('We were here before');
  expect(result.raw).toContain('Then we know the way');
});
