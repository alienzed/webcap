'use strict';

// Opt-in real-model contract test. The browser Playwright suite exercises UI
// launch and destinations; this file verifies the production backend API,
// operation-scoped schemas and actual persisted effects without old Review code.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');

const model=String(process.env.WEBCAP_LIVE_MODEL||'').trim();
const origin=String(process.env.WEBCAP_LIVE_URL||'http://127.0.0.1:4200').replace(/\/+$/,'');
const deadlineMs=Number(process.env.WEBCAP_LIVE_TIMEOUT_MS||900000);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function api(url,payload){
  const response=await fetch(origin+url,payload===undefined?undefined:{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
  });
  const body=await response.json();
  assert.ok(response.ok && body.ok,url+': '+(body.error||'HTTP '+response.status));
  return body;
}
async function ask(operation,messages,report,requiredFields=[]){
  const before=Date.now();
  const started=await api('/fs/director/chat',{model,operation,messages,requiredFields});
  const job=started.job,jobId=job?.jobId;
  assert.ok(jobId,operation+' did not queue a job');
  report.push({operation,jobId,messages,schema:job.request?.responseSchema});
  for(;;){
    const poll=(await api('/fs/director/job?job='+encodeURIComponent(jobId))).job;
    if(poll.status==='completed'){
      const raw=String(poll.result?.text||'');
      assert.ok(raw.trim(),operation+' returned empty model content');
      report.at(-1).raw=raw;
      report.at(-1).seconds=(Date.now()-before)/1000;
      return raw;
    }
    if(['failed','stopped','cancelled','interrupted'].includes(poll.status))
      throw new Error(operation+' '+poll.status+': '+String(poll.error||'No job detail'));
    assert.ok(Date.now()-before<deadlineMs,operation+' timed out');
    await sleep(2000);
  }
}
test('opt-in Studio Director: conversation, Project Write and Scene revision use actual contracts', {
  skip:model?false:'Set WEBCAP_LIVE_MODEL to an available WebCap model ID',
  timeout:Math.max(180000,deadlineMs*3+180000)
},async t=>{
  const created=[],report=[];
  const guidance=await api('/fs/studio/director/guidance?targetModel=minimax_h3');
  assert.ok(guidance.system);
  assert.ok(guidance.promptContract);
  assert.doesNotMatch(guidance.system,/H3 PROMPT AUTHORING REFERENCE/);
  const prefix='Studio Live '+crypto.randomUUID().slice(0,8);
  try{
    const seed=(await api('/fs/storyboard',{operation:'create_story',story:{
      title:prefix+' Bookshop',
      concept:'An antique bookshop with a green front door.',
      style:'Amber window light on a rainy evening.',
      invariants:[{kind:'character',title:'Clothing',text:'The bookseller wears a burgundy cardigan.'}]
    }})).story;
    created.push(seed.id);
    const initialPrompt='A bookseller wearing a burgundy cardigan closes a green door in evening rain.';
    const scene=(await api('/fs/storyboard',{operation:'add_scene',storyId:seed.id,scene:{
      title:'Closing',prompt:initialPrompt,durationSeconds:8
    }})).scene;
    await t.test('ordinary chat is freeform and does not change saved material',async()=>{
      const before=(await api('/fs/storyboard?story='+encodeURIComponent(seed.id))).story;
      const raw=await ask('studio_chat',[
        {role:'system',content:guidance.system},
        {role:'user',content:'Suggest a brief, imaginative bookshop opening. No writing or saving.'}
      ],report);
      assert.ok(raw.trim().length>10);
      assert.ok(report.at(-1).schema==null,'chat must not receive a structured authoring schema');
      const after=(await api('/fs/storyboard?story='+encodeURIComponent(seed.id))).story;
      assert.deepEqual(after,before);
    });
    await t.test('explicit Project creation returns actual fields and saves directly',async()=>{
      const raw=await ask('studio_project_draft',[
        {role:'system',content:guidance.system},
        {role:'user',content:JSON.stringify({
          task:'Create one Project. Return title, concept, style and invariants.',
          instruction:'New Project: Moonlit Bakery. A baker prepares bread before sunrise. Cool blue dawn light. No recurring invariants.'
        })}
      ],report);
      const project=JSON.parse(raw);
      for(const field of ['title','concept','style'])assert.ok(typeof project[field]==='string'&&project[field].trim());
      assert.ok(Array.isArray(project.invariants));
      const saved=(await api('/fs/studio/director/project-create',{proposal:{
        title:project.title,concept:project.concept,style:project.style,invariants:project.invariants
      }})).story;
      created.push(saved.id);
      assert.equal((await api('/fs/storyboard?story='+encodeURIComponent(saved.id))).story.concept,project.concept);
      assert.equal((await api('/fs/storyboard?story='+encodeURIComponent(seed.id))).story.style,seed.style);
    });
    await t.test('explicit Scene Write receives H3 context and changes selected prompt only',async()=>{
      const before=(await api('/fs/storyboard?story='+encodeURIComponent(seed.id))).story;
      const raw=await ask('studio_scene_field_draft',[
        {role:'system',content:guidance.system+'\n\nH3 PROMPT AUTHORING REFERENCE:\n'+guidance.promptContract},
        {role:'user',content:JSON.stringify({
          task:'Revise this existing Scene. Return a complete replacement prompt.',
          authorDirection:'A quiet ending with the bookseller noticing a brass compass before closing the green door.',
          requestedFields:['prompt'],savedScene:before.scenes[scene.id]
        })}
      ],report,['prompt']);
      const authored=JSON.parse(raw);
      assert.ok(typeof authored.prompt==='string'&&authored.prompt.trim());
      const updated=await api('/fs/studio/director/scene-fields',{
        storyId:seed.id,sceneId:scene.id,expected:{prompt:initialPrompt},
        changes:{prompt:authored.prompt}
      });
      assert.equal(updated.scene.prompt,authored.prompt);
      const saved=(await api('/fs/storyboard?story='+encodeURIComponent(seed.id))).story;
      assert.equal(saved.scenes[scene.id].prompt,authored.prompt);
      assert.equal(saved.scenes[scene.id].title,'Closing');
      assert.equal(saved.scenes[scene.id].durationSeconds,8);
    });
  }finally{
    if(process.env.WEBCAP_LIVE_REPORT){
      try{fs.writeFileSync(process.env.WEBCAP_LIVE_REPORT,
        JSON.stringify({model,origin,report},null,2)+'\n','utf8');}
      catch(error){t.diagnostic('Could not save live evidence: '+error.message);}
    }
    for(const storyId of created.reverse()){
      try{await api('/fs/storyboard',{operation:'delete_story',storyId});}
      catch(error){t.diagnostic('Manually clean up live test Project '+storyId+': '+error.message);}
    }
  }
});
