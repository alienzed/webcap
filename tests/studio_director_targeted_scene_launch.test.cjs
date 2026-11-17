// Studio focused selected-Scene Write: single operation with authoritative target.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const chat=fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
const workbench=fs.readFileSync(path.join(__dirname,'../tool/js/studio_director_workbench.js'),'utf8');
function section(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'Missing source method '+start);
  return source.slice(a,b).trim().replace(/,\s*$/,'');
}
function setup(response){
  const project={id:'p1',title:'Landing',concept:'An arrival',style:'Moonlight',
    sceneOrder:['s1'],invariants:[],scenes:{
      s1:{id:'s1',title:'Opening',prompt:'Original H3 prompt',durationSeconds:8}
    }};
  const events=[],state={pending:false,jobId:'',lastStudioIoRaw:'',lastStudioIoError:''};
  const window={
    flushStudioDirectorStoryEdits:async()=>{},
    reportConsoleError:(...x)=>events.push(['error',...x])
  };
  window.studioDirectorWorkbench={
    sceneRead:(story,id)=>({payload:{
      projectId:story.id,projectTitle:story.title,
      fields:[
        {id:'project.concept',value:story.concept},
        {id:'project.style',value:story.style},
        {id:'scene:'+id+':prompt',value:story.scenes[id].prompt},
        {id:'scene:'+id+':durationSeconds',value:story.scenes[id].durationSeconds}
      ]
    }}),
    applyScenePrompt:async(story,id,prompt,extras)=>{
      events.push(['apply',id,prompt,extras]);
      if(prompt!==null)story.scenes[id].prompt=prompt;
      Object.assign(story.scenes[id],extras);
      return {story,scene:story.scenes[id]};
    }
  };
  window.studioDirectorBridge={
    isReady:()=>true,readinessMessage:()=>'',makeProposal:async(task,operation,h3,target,fields)=>{
      events.push(['model',JSON.parse(task),operation,h3,target,fields]);
      return response;
    }
  };
  const context=vm.createContext({state,window,JSON,Object,String,Promise,Array,Error,
    encodeURIComponent,
    el:()=>({dataset:{}}),syncControls(){},studioActionStatus(){},
    requestJson:async(url)=>{
      events.push(['get',url]);
      assert.equal(url,'/fs/storyboard?story=p1');
      return {story:project};
    }
  });
  const run=vm.runInContext('({'+section(chat,
    '    writeSelectedScene: function (launch) {',
    '    makeProposal: function (instruction, operation, includePromptContract')+'})',
    context).writeSelectedScene;
  return {run,window,project,events,state};
}

test('selected prompt revision reads saved target and writes only its prompt',async()=>{
  const h=setup(JSON.stringify({prompt:'Mara leaves the rover under a silent sky.'}));
  await h.run.call(h.window.studioDirectorBridge,{
    projectId:'p1',sceneId:'s1',instruction:'Make the ending quieter.',fields:['prompt']});
  assert.equal(h.events.filter(x=>x[0]==='model').length,1);
  const model=h.events.find(x=>x[0]==='model');
  assert.equal(model[2],'studio_scene_field_draft');
  assert.equal(model[3],true);
  assert.equal(model[1].savedScene.projectId,'p1');
  assert.deepEqual(JSON.parse(JSON.stringify(model[5])),['prompt']);
  assert.equal(h.project.scenes.s1.prompt,'Mara leaves the rover under a silent sky.');
  assert.equal(h.project.scenes.s1.title,'Opening');
});

test('title and duration change are scoped and do not require a prompt rewrite',async()=>{
  const h=setup(JSON.stringify({title:'After the landing',durationSeconds:12}));
  await h.run.call(h.window.studioDirectorBridge,{
    projectId:'p1',sceneId:'s1',instruction:'Retitle and retime the clip.',
    fields:['title','durationSeconds']});
  const model=h.events.find(x=>x[0]==='model');
  assert.equal(model[3],false);
  assert.deepEqual(JSON.parse(JSON.stringify(model[5])),['title','durationSeconds']);
  const apply=h.events.find(x=>x[0]==='apply');
  assert.equal(apply[2],null);
  assert.equal(h.project.scenes.s1.prompt,'Original H3 prompt');
  assert.equal(h.project.scenes.s1.durationSeconds,12);
});

test('the selected saved scene cannot be replaced by a model-invented ID',async()=>{
  const h=setup(JSON.stringify({prompt:'New prompt',sceneId:'imagined'}));
  await h.run.call(h.window.studioDirectorBridge,{
    projectId:'p1',sceneId:'s1',instruction:'Rewrite prompt.',fields:['prompt']});
  assert.equal(h.events.find(x=>x[0]==='apply')[1],'s1');
});

test('unparseable response remains visible and does not call apply',async()=>{
  const h=setup('broken structured output');
  await assert.rejects(()=>h.run.call(h.window.studioDirectorBridge,{
    projectId:'p1',sceneId:'s1',instruction:'Rewrite prompt.',fields:['prompt']}),
    /JSON failed to parse/);
  assert.equal(h.state.lastStudioIoRaw,'broken structured output');
  assert.equal(h.events.filter(x=>x[0]==='apply').length,0);
});
