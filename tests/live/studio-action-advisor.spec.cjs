'use strict';

const {test,expect}=require('../browser/test.cjs');
const {openLiveDirector,attachProject,sendLive,waitForLiveJob,
  seedProject,story}=require('./helpers.cjs');

// The general browser fixture disables optional advisor calls so unrelated
// mocked tests do not consume extra responses. These tests intentionally
// exercise the production default-on sidecar against a REAL configured model.
test.use({advisorEnabled:true});

const terminalStates=new Set(['completed','failed','cancelled','stopped','interrupted']);
const advice=page=>page.locator('#studio-action-advisor-actions');

function observeRealDirectorJobs(page) {
  const queued=new Map(), terminal=new Map(), requests=[];
  const pending=new Set(), observationErrors=[];
  page.on('request',request=>{
    if(request.method()!=='POST'||new URL(request.url()).pathname!=='/fs/director/chat')return;
    try {requests.push(request.postDataJSON());}
    catch(error){observationErrors.push('Request: '+String(error));}
  });
  page.on('response',response=>{
    const path=new URL(response.url()).pathname;
    if(path!=='/fs/director/chat'&&path!=='/fs/director/job')return;
    const task=response.json().then(body=>{
      const job=body?.job;
      if(!job?.jobId)return;
      if(path==='/fs/director/chat'&&response.request().method()==='POST')
        queued.set(job.jobId,response.request().postDataJSON());
      if(path==='/fs/director/job'&&terminalStates.has(job.status))
        terminal.set(job.jobId,job);
    }).catch(error=>observationErrors.push(path+': '+String(error)));
    pending.add(task);
    void task.finally(()=>pending.delete(task));
  });
  const flush=()=>Promise.allSettled([...pending]);
  return {
    requests,
    async finished(operation,index=0){
      let matches=[];
      await expect.poll(async()=>{
        await flush();
        matches=[...queued.entries()].filter(([,request])=>request.operation===operation);
        return matches.length;
      },{timeout:300000,intervals:[500,1000,2000]}).toBeGreaterThan(index);
      const [jobId,request]=matches[index];
      await expect.poll(async()=>{
        await flush();
        return terminal.has(jobId);
      },{timeout:300000,intervals:[500,1000,2000]}).toBe(true);
      const job=terminal.get(jobId);
      await test.info().attach('real-'+operation+'-'+jobId,{
        body:Buffer.from(JSON.stringify({request,job,observationErrors},null,2)),
        contentType:'application/json'
      });
      expect(job.status,'Real '+operation+' failed: '+String(job.error||'')).toBe('completed');
      return {request,job,raw:String(job.result?.text||'')};
    }
  };
}

function actionsFrom(receipt) {
  let parsed;
  try {parsed=JSON.parse(receipt.raw);}
  catch(error){
    throw new Error('Actual Action Advisor model response was not valid JSON: '+
      error.message+'\nRaw response:\n'+receipt.raw);
  }
  expect(Array.isArray(parsed.actions),
    'Actual Action Advisor model response has no actions array:\n'+receipt.raw).toBe(true);
  return parsed.actions;
}

async function chooseSuggestion(page,item,buttonText){
  expect(typeof item.label).toBe('string');
  expect(item.label.trim().length).toBeGreaterThan(0);
  const row=advice(page).locator('.studio-action-advisor-item')
    .filter({hasText:item.label}).first();
  await expect(row.locator('strong')).toHaveText(item.label,{timeout:30000});
  await expect(row.getByRole('button',{name:buttonText})).toBeVisible();
  await row.getByRole('button',{name:buttonText}).click();
}

test('LIVE advisor — identifies an explicit saved-Overview Read and only reads after approval',
  async({page},info)=>{
    const project=await seedProject(page,'Live Advisor Read '+Date.now(),{
      concept:'A copper clockwork swallow guards a forgotten museum entrance.',
      style:'Muted blue daylight.'
    });
    const model=await openLiveDirector(page);
    await attachProject(page,project);
    const observed=observeRealDirectorJobs(page);
    const instruction='Before changing this Project, I need to inspect its saved Overview. '+
      'What should I do next? We are only discussing the next step right now.';
    await sendLive(page,instruction);
    const chat=await observed.finished('studio_chat');
    const advisor=await observed.finished('studio_action_advisor');
    const actions=actionsFrom(advisor);
    await info.attach('live-advisor-read-decision',{
      body:Buffer.from(JSON.stringify({model,instruction,chat:chat.raw,
        advisor:advisor.raw,actions},null,2)),contentType:'application/json'
    });

    expect(chat.request.model).toBe(model);
    expect(advisor.request.model).toBe(model);
    expect(JSON.stringify(advisor.request.messages)).toContain(instruction);
    expect(JSON.stringify(advisor.request.messages)).not.toContain(project.concept);
    expect(actions.length).toBeLessThanOrEqual(3);
    const item=actions.find(action=>action.kind==='read'&&
      action.projectId===project.id&&action.fields?.includes('overview'));
    expect(item,'Real model did not recommend reading the saved Project Overview: '+
      advisor.raw).toBeTruthy();

    const messages=page.locator('#director-chat-messages');
    await expect(messages).not.toContainText(project.concept);
    await chooseSuggestion(page,item,'Prepare Read');
    await expect(page.locator('#studio-dw-read-panel')).toBeVisible();
    await expect(page.locator('#studio-dw-read-project')).toHaveValue(project.id);
    await expect(page.locator('#studio-dw-project-fields input[data-group-select]').first())
      .toBeChecked();
    await expect(messages).not.toContainText(project.concept);
    expect((await story(page,project.id)).concept).toBe(project.concept);

    await page.locator('#studio-dw-read-send').click();
    await expect(messages).toContainText(project.concept);
    expect(observed.requests.map(request=>request.operation))
      .toEqual(['studio_chat','studio_action_advisor']);
    expect((await story(page,project.id)).concept).toBe(project.concept);
  });

test('LIVE advisor — scopes a suggested Overview revision and saves only after explicit Write',
  async({page},info)=>{
    const project=await seedProject(page,'Live Advisor Style '+Date.now(),{
      concept:'A violin maker works at a tiny night-time workshop.',
      style:'Cold cyan fluorescent light.',
      invariants:[{kind:'prop',title:'Violin',text:'A wooden violin stays on the workbench.'}]
    });
    const original=await story(page,project.id);
    const model=await openLiveDirector(page);
    await attachProject(page,project);
    const observed=observeRealDirectorJobs(page);
    const instruction='I want to change only this Project’s visual Style to warm amber golden-hour '+
      'light. Keep the Title, Concept, and Invariants untouched. Please propose the next '+
      'action without making changes yet.';
    await sendLive(page,instruction);
    await observed.finished('studio_chat');
    const advisor=await observed.finished('studio_action_advisor');
    const actions=actionsFrom(advisor);
    await info.attach('live-advisor-style-decision',{
      body:Buffer.from(JSON.stringify({model,instruction,raw:advisor.raw,actions},null,2)),
      contentType:'application/json'
    });
    expect(advisor.request.model).toBe(model);
    expect(actions.length).toBeLessThanOrEqual(3);
    const item=actions.find(action=>action.kind==='revise_project'&&
      action.projectId===project.id);
    expect(item,'Real advisor did not suggest revising this Project: '+advisor.raw).toBeTruthy();
    expect(item.fields,'Advisor must not broaden the explicitly requested Style-only revision')
      .toEqual(['style']);
    expect(item.instruction?.trim().length).toBeGreaterThan(15);

    await chooseSuggestion(page,item,'Prepare Write');
    await expect(page.locator('#studio-dw-write-panel')).toBeVisible();
    await expect(page.locator('#studio-dw-write-operation')).toHaveValue('project');
    await expect(page.locator('#studio-dw-write-project')).toHaveValue(project.id);
    await expect(page.locator('#studio-dw-write-project-fields input[value="style"]'))
      .toBeChecked();
    for(const field of ['title','concept','invariants'])
      await expect(page.locator('#studio-dw-write-project-fields input[value="'+field+'"]'))
        .not.toBeChecked();
    await expect(page.locator('#studio-dw-write-instruction')).toHaveValue(item.instruction);
    expect((await story(page,project.id)).style).toBe(original.style);

    await waitForLiveJob(page,()=>page.locator('#studio-dw-write-prepare').click());
    const write=await observed.finished('studio_brief_draft');
    await expect.poll(async()=>(await story(page,project.id)).style,
      {timeout:60000}).not.toBe(original.style);
    const saved=await story(page,project.id);
    await info.attach('live-advisor-style-saved',{
      body:Buffer.from(JSON.stringify({model,writeRequest:write.request,
        writeRaw:write.raw,original,saved},null,2)),contentType:'application/json'
    });
    expect(write.request.model).toBe(model);
    expect(saved.title).toBe(original.title);
    expect(saved.concept).toBe(original.concept);
    expect(saved.invariants).toEqual(original.invariants);
    expect(saved.style).toMatch(/amber|gold|warm/i);
    await page.reload();
    expect((await story(page,project.id)).style).toBe(saved.style);
  });

test('LIVE advisor — proposes an opening Scene and author approval launches a real Scene Write',
  async({page},info)=>{
    const project=await seedProject(page,'Live Advisor Opening '+Date.now(),{
      concept:'A railway courier begins an evening journey.',
      style:'Rainy dusk, cinematic realism.'
    });
    const model=await openLiveDirector(page);
    await attachProject(page,project);
    const observed=observeRealDirectorJobs(page);
    const instruction='For the first eight-second Scene, a railway courier raises a paper '+
      'lantern outside a rainy station entrance. I want this authored and saved as a '+
      'new Scene, but let me approve the next action first. What should we do?';
    await sendLive(page,instruction);
    await observed.finished('studio_chat');
    const advisor=await observed.finished('studio_action_advisor');
    const actions=actionsFrom(advisor);
    await info.attach('live-advisor-scene-decision',{
      body:Buffer.from(JSON.stringify({model,instruction,raw:advisor.raw,actions},null,2)),
      contentType:'application/json'
    });
    expect(advisor.request.model).toBe(model);
    expect(actions.length).toBeLessThanOrEqual(3);
    const item=actions.find(action=>action.kind==='create_scene'&&
      action.projectId===project.id);
    expect(item,'Real advisor did not propose creating the requested Scene: '+
      advisor.raw).toBeTruthy();
    expect(item.instruction?.trim().length).toBeGreaterThan(15);
    expect(item.instruction).toMatch(/lantern|courier|station/i);

    const before=await story(page,project.id);
    expect(before.sceneOrder).toHaveLength(0);
    await chooseSuggestion(page,item,'Prepare Write');
    await expect(page.locator('#studio-dw-write-panel')).toBeVisible();
    await expect(page.locator('#studio-dw-write-project')).toHaveValue(project.id);
    await expect(page.locator('#studio-dw-write-operation')).toHaveValue('scene-write');
    await expect(page.locator('#studio-dw-scene-mode')).toHaveValue('create');
    await expect(page.locator('#studio-dw-write-instruction')).toHaveValue(item.instruction);
    expect((await story(page,project.id)).sceneOrder).toHaveLength(0);

    await waitForLiveJob(page,()=>page.locator('#studio-dw-write-prepare').click());
    const write=await observed.finished('studio_scenes_draft');
    await expect.poll(async()=>(await story(page,project.id)).sceneOrder.length,
      {timeout:60000}).toBeGreaterThan(0);
    const saved=await story(page,project.id);
    const scenes=saved.sceneOrder.map(id=>saved.scenes[id]);
    await info.attach('live-advisor-scene-saved',{
      body:Buffer.from(JSON.stringify({model,writeRequest:write.request,
        writeRaw:write.raw,scenes},null,2)),contentType:'application/json'
    });
    expect(write.request.model).toBe(model);
    expect(scenes[0].prompt).toMatch(/lantern/i);
    expect(scenes[0].prompt.trim().length).toBeGreaterThan(70);
    expect(scenes[0].durationSeconds).toBe(8);
    await page.reload();
    expect((await story(page,project.id)).sceneOrder).toEqual(saved.sceneOrder);
  });
