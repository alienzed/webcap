'use strict';

const {test,expect}=require('../browser/test.cjs');
const {openLiveDirector,seedProject,seedScene,openProject,story}=require('./helpers.cjs');

async function evidence(info,name,value){
  await info.attach(name,{
    body:Buffer.from(JSON.stringify(value,null,2)),
    contentType:'application/json'
  });
}

async function waitForStoryboardJob(page,trigger){
  const terminal=page.waitForResponse(async response=>{
    if(!response.url().includes('/fs/director/job?')) return false;
    try{
      const payload=await response.json();
      return ['completed','failed','cancelled','stopped','interrupted']
        .includes(String(payload.job?.status||''));
    }catch{return false;}
  },{timeout:300000});
  await trigger();
  const response=await terminal;
  const payload=await response.json();
  await test.info().attach('studio-qa-job-'+payload.job.jobId,{
    body:Buffer.from(JSON.stringify(payload.job,null,2)),
    contentType:'application/json'
  });
  if(payload.job.status!=='completed')
    throw new Error('Studio QA job '+payload.job.status+': '+String(payload.job.error||'No diagnostic provided'));
  return payload.job;
}

test('LIVE Prompt Assist — standalone Scene text analysis proposes and applies one targeted correction',async({page},info)=>{
  const project=await seedProject(page,'Live Prompt Assist '+Date.now(),{
    concept:'A woman prepares for a formal event, changes clothes, and leaves her apartment.',
    style:'Naturalistic cinematic lighting.',
    invariants:[{
      kind:'character',title:'Mara',
      text:'Mara has a short dark bob, a small silver pendant, and a consistent recognizable appearance.'
    }]
  });
  const original=[
    '[Shot 1: 0-4s]',
    'Mara stands in front of the bedroom mirror wearing a blue denim jacket, white shirt, black trousers and brown boots.',
    '[Shot 2: 4-8s]',
    'Mara changes into a formal outfit, then turns away from the mirror.',
    '[Shot 3: 8-12s]',
    'Mara walks through the apartment doorway and closes it behind her.'
  ].join('\n');
  const scene=await seedScene(page,project.id,{
    title:'Getting Ready',prompt:original,durationSeconds:12
  });
  const model=await openLiveDirector(page);
  await openProject(page,project.id);
  const button=page.locator('.storyboard-scene[data-scene-id="'+scene.id+'"] [data-prompt-assist-open]');
  await expect(button).toBeVisible();
  await waitForStoryboardJob(page,()=>button.click());
  await expect(page.locator('#storyboard-prompt-assist-modal')).toBeVisible();
  const cards=page.locator('#storyboard-prompt-assist-findings .storyboard-assist-finding');
  await expect.poll(()=>cards.count(),{timeout:30000}).toBeGreaterThan(0);
  const first=cards.first();
  const target=await first.locator('textarea[readonly]').inputValue();
  const replacement=first.locator('[data-assist-replacement]');
  const proposed=await replacement.inputValue();
  expect(target.length).toBeGreaterThan(0);
  expect(original.split(target)).toHaveLength(2);
  expect(proposed.trim()).toBeTruthy();
  await evidence(info,'prompt-assist-live-result',{
    model,projectId:project.id,sceneId:scene.id,original,target,replacement:proposed,
    problem:await first.locator('.storyboard-assist-finding-main').innerText()
  });
  const appliedResponse=page.waitForResponse(response=>
    new URL(response.url()).pathname==='/fs/storyboard/prompt-assist/apply' && response.request().method()==='POST'
  );
  await first.locator('button').filter({hasText:'Apply correction'}).click();
  const applied=await appliedResponse;
  expect(applied.ok()).toBeTruthy();
  const saved=await story(page,project.id);
  const updated=saved.scenes[scene.id].prompt;
  expect(updated).toContain(proposed);
  expect(updated).not.toBe(original);
  expect(updated).toBe(original.replace(target,proposed));
  await evidence(info,'prompt-assist-applied-scene',{saved:saved.scenes[scene.id]});
});

test('LIVE Project Deep QA — scans Scene prompts and cross-Scene continuity, persists findings',async({page},info)=>{
  const project=await seedProject(page,'Live Project Deep QA '+Date.now(),{
    concept:'Mara crosses a quiet railway station at night.',
    style:'Wet blue evening, restrained cinematic realism.',
    invariants:[{
      kind:'character',title:'Mara',
      text:'Mara has a short dark bob and wears a distinctive red wool coat throughout the Project.'
    }]
  });
  const first=await seedScene(page,project.id,{
    title:'Platform Arrival',
    prompt:'[Shot 1: 0-5s] Mara, with her short dark bob, walks along the wet railway platform wearing her distinctive red wool coat.',
    durationSeconds:8
  });
  const second=await seedScene(page,project.id,{
    title:'Ticket Office',
    prompt:'[Shot 1: 0-5s] Mara approaches the ticket office wearing a bright blue leather jacket. Her hair is long and blonde.',
    durationSeconds:8
  });
  const model=await openLiveDirector(page);
  await openProject(page,project.id);
  const run=page.locator('#storyboard-project-deep-qa-btn');
  await expect(run).toBeVisible();
  await waitForStoryboardJob(page,()=>run.click());
  await expect(page.locator('#storyboard-project-deep-qa-modal')).toBeVisible();
  const cards=page.locator('#storyboard-project-deep-qa-findings .storyboard-assist-finding');
  await expect.poll(()=>cards.count(),{timeout:30000}).toBeGreaterThan(0);
  const continuityFinding=cards.filter({hasText:second.title}).first();
  await expect(continuityFinding).toBeVisible();
  const text=await continuityFinding.innerText();
  expect(text.toLowerCase()).toContain('red wool coat');
  const cache=await page.request.get('/fs/storyboard/deep-qa?storyId='+encodeURIComponent(project.id));
  expect(cache.ok()).toBeTruthy();
  const record=await cache.json();
  expect(record.current).toBe(true);
  expect(record.findings.some(item=>item.sceneId===second.id)).toBe(true);
  await evidence(info,'project-deep-qa-live-result',{
    model,projectId:project.id,sceneIds:[first.id,second.id],record
  });
});
