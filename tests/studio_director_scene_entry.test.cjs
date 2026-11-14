const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const scene = fs.readFileSync('tool/js/storyboard.js','utf8');
const director = fs.readFileSync('tool/js/director_chat.js','utf8');
const workbench = fs.readFileSync('tool/js/studio_director_workbench.js','utf8');
function section(source,start,end) {return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}

test('prompt recovery is bounded, supports redo and branches after a new edit', async()=>{
  const scope=vm.createContext({scenePromptHistory:{},storyState:{story:{id:'p',scenes:{s:{prompt:'v12'}}}},
    flushPendingSaves:async()=>{},syncScenePromptHistory(){},renderStory(){},setSaveState(){},
    reportError:error=>{throw error;},request:async body=>({story:{id:'p',scenes:{s:{prompt:body.scene.prompt}}}})});
  vm.runInContext(section(scene,'  function rememberScenePrompt(','  function syncScenePromptHistory(')+
    section(scene,'  function moveScenePromptHistory(','  var storyboardGuidelineReview'),scope);
  for(let i=1;i<=12;i++) scope.rememberScenePrompt('p','s','v'+(i-1),'v'+i);
  let h=scope.scenePromptHistory['p:s'];
  assert.equal(h.versions.length,11);assert.equal(h.versions[0],'v2');
  scope.moveScenePromptHistory('s',-1);await new Promise(setImmediate);
  assert.equal(scope.storyState.story.scenes.s.prompt,'v11');
  scope.moveScenePromptHistory('s',1);await new Promise(setImmediate);
  assert.equal(scope.storyState.story.scenes.s.prompt,'v12');
  scope.moveScenePromptHistory('s',-1);await new Promise(setImmediate);
  scope.rememberScenePrompt('p','s','v11','new direction');
  assert.equal(h.versions.at(-1),'new direction');assert.ok(!h.versions.includes('v12'));
  assert.equal(scope.scenePromptHistory['another:s'],undefined);
});

function directorHarness(raw='{"prompt":"Revised full prompt"}') {
  const calls=[], elements={};
  const state={pending:false,attachmentPending:false,sessionReady:true,modelsLoaded:true,
    modeMessages:{storyboard:[]},sessionLoadPromise:Promise.resolve()};
  const bridge={selectWriteProject:(...args)=>calls.push(['target',...args]),isReady:()=>true,
    makeProposal:async(...args)=>{calls.push(['model',...args]);return raw;}};
  const scope=vm.createContext({state,Promise,JSON,Object,Error,
    el:id=>elements[id] ||= {value:'Unsent conversation draft',classList:{add(){},remove(){}},focus(){}},
    setOpen:async()=>{},syncModeUi(){},syncControls(){},renderMessages(){},
    persistSession:async()=>calls.push(['persist']),studioActionStatus(){},
    window:{studioDirectorBridge:bridge,reportConsoleError(){},studioDirectorWorkbench:{
      sceneRead:(_story,id)=>({payload:{projectId:'p',fields:[{id:'scene:'+id+':prompt',value:'Original'}]},
        keys:['scene:'+id+':prompt'],label:'Scene 2'}),
      applyScenePrompt:async(...args)=>calls.push(['apply',...args])}}});
  vm.runInContext(section(director,'  window.openStudioDirectorScene = function','  window.closeStudioDirectorOnExit'),scope);
  return {scope,state,calls,elements};
}
test('opening Scene Director stages context without a model request or overwriting the composer',async()=>{
  const h=directorHarness();await h.scope.window.openStudioDirectorScene({id:'p',title:'Project'},'s','');
  assert.equal(h.state.sceneRead.payload.projectId,'p');
  assert.equal(h.elements['director-chat-input'].value,'Unsent conversation draft');
  assert.equal(h.calls.filter(c=>c[0]==='model'||c[0]==='apply').length,0);
});
test('a revision uses one existing model operation, shows the full result, and applies to the exact Scene',async()=>{
  const h=directorHarness();await h.scope.window.openStudioDirectorScene({id:'p',title:'Project'},'s','Quieter ending');
  const model=h.calls.filter(c=>c[0]==='model');assert.equal(model.length,1);
  assert.equal(model[0][2],'studio_scene_field_draft');assert.equal(model[0][3],true);
  assert.equal(JSON.parse(model[0][1]).instruction,'Quieter ending');
  assert.deepEqual(h.calls.find(c=>c[0]==='apply').slice(2),['s','Revised full prompt']);
  assert.equal(h.state.modeMessages.storyboard.at(-1).content,'Revised full prompt');
  assert.equal(h.state.pending,false);
});
test('an incomplete revision is visible in I/O and cannot change the Scene',async()=>{
  const h=directorHarness('{"summary":"Outline only"}');
  await assert.rejects(h.scope.window.openStudioDirectorScene({id:'p'},'s','Quieter ending'),/complete Scene prompt/);
  assert.equal(h.calls.filter(c=>c[0]==='apply').length,0);
  assert.match(h.state.lastStudioIoRaw,/Outline only/);assert.equal(h.state.pending,false);
});
test('quick Apply changes only prompt, retaining the original prompt as its conflict check',async()=>{
  let sent;
  const scope=vm.createContext({window:{studioDirectorWorkbench:{},flushStudioDirectorStoryEdits:async()=>{},
    refreshStudioDirectorStoryIfOpen:async()=>{},studioDirectorBridge:{recordApplied:async()=>{}}},
    api:async(url,options)=>{sent={url,body:JSON.parse(options.body)};return {story:{id:'p'},scene:{prompt:'After'}};}});
  const method=section(workbench,'    applyScenePrompt: function','    setStatus:status,').trim().replace(/,$/,'');
  vm.runInContext('window.studioDirectorWorkbench={'+method+'};',scope);
  await scope.window.studioDirectorWorkbench.applyScenePrompt({id:'p',scenes:{s:{prompt:'Before'}}},'s','After');
  assert.deepEqual(sent,{url:'/fs/studio/director/scene-fields',body:{storyId:'p',sceneId:'s',
    expected:{prompt:'Before'},changes:{prompt:'After'}}});
});
