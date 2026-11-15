const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const scene = fs.readFileSync('tool/js/storyboard.js','utf8');
const director = fs.readFileSync('tool/js/director_chat.js','utf8');
const workbench = fs.readFileSync('tool/js/studio_director_workbench.js','utf8');
function section(source,start,end) {return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}

test('Scene Prompt no longer has separate mutating Undo/Redo controls',()=>{
  assert.doesNotMatch(scene,/data-prompt-undo|data-prompt-redo|moveScenePromptHistory|rememberScenePrompt/);
  assert.match(scene,/data-scene-field="prompt"/);
});

function directorHarness(raw='{"prompt":"Revised full prompt"}') {
  const calls=[], elements={};
  const state={pending:false,attachmentPending:false,sessionReady:true,modelsLoaded:true,
    modeMessages:{storyboard:[]},sessionLoadPromise:Promise.resolve()};
  const bridge={selectWriteProject:(...args)=>calls.push(['target',...args]),isReady:()=>true,
    writeSelectedScene:async args=>{calls.push(['writeScene',args]);}};
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
  const h=directorHarness();await h.scope.window.openStudioDirectorScene({id:'p',title:'Project',sceneOrder:['s']},'s','');
  assert.equal(h.state.sceneRead.projectId,'p');
  assert.equal(h.state.sceneRead.sceneId,'s');
  assert.equal(h.state.sceneRead.payload,undefined,'the opening snapshot is not authoritative');
  assert.equal(h.elements['director-chat-input'].value,'Unsent conversation draft');
  assert.equal(h.calls.filter(c=>c[0]==='model'||c[0]==='apply').length,0);
});
test('direct Scene Revise delegates to the one selected-Scene writer',async()=>{
  const h=directorHarness();
  await h.scope.window.openStudioDirectorScene(
    {id:'p',title:'Project',sceneOrder:['s']},'s','Quieter ending');
  const writes=h.calls.filter(c=>c[0]==='writeScene');
  assert.equal(writes.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0][1])),{
    projectId:'p',sceneId:'s',instruction:'Quieter ending',fields:['prompt']
  });
  assert.equal(h.calls.filter(c=>c[0]==='model'||c[0]==='apply').length,0,
    'the shortcut contains no competing authoring or save implementation');
});
test('quick Apply changes only prompt, retaining the original prompt as its conflict check',async()=>{
  let sent, receiptKind;
  const scope=vm.createContext({window:{studioDirectorWorkbench:{},flushStudioDirectorStoryEdits:async()=>{},
    refreshStudioDirectorStoryIfOpen:async()=>{},studioDirectorBridge:{recordApplied:async(kind)=>{receiptKind=kind;}}},
    api:async(url,options)=>{sent={url,body:JSON.parse(options.body)};return {story:{id:'p'},scene:{prompt:'After'}};}});
  const method=section(workbench,'    applyScenePrompt: function','    setStatus:status,').trim().replace(/,$/,'');
  vm.runInContext('window.studioDirectorWorkbench={'+method+'};',scope);
  await scope.window.studioDirectorWorkbench.applyScenePrompt({id:'p',sceneOrder:['s'],scenes:{s:{prompt:'Before'}}},'s','After');
  assert.deepEqual(sent,{url:'/fs/studio/director/scene-fields',body:{storyId:'p',sceneId:'s',
    expected:{prompt:'Before'},changes:{prompt:'After'}}});
  assert.equal(receiptKind,'scene.director.revision');
});

test('automatic Director revisions get a distinct persisted receipt; reviewed Apply stays reviewed', async()=>{
  const state={modeMessages:{storyboard:[]},sessionDirty:{storyboard:false},studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{},sourceRequest:''}};
  const scope=vm.createContext({state,window:{studioDirectorWorkbench:{markSavedFields(){},completeWriteAction(){return false;},updateWorkingWrite(){}}},
    markStudioReadinessOutdated(){},renderMessages(){},persistSession:async()=>{}});
  const method=section(director,'    recordApplied: function','    reviewCapture: function').trim().replace(/,$/,'');
  vm.runInContext('var recorder={'+method+'};',scope);
  const story={id:'p',title:'Project'},fields={sceneId:'s',savedFields:{prompt:'After'}};
  await scope.recorder.recordApplied('scene.director.revision',story,fields);
  await scope.recorder.recordApplied('scene.update',story,fields);
  assert.match(state.modeMessages.storyboard[0].content,/^Saved Project: H3 Prompt/);
  assert.match(state.modeMessages.storyboard[0].content,/"operation": "scene.director.revision"/);
  assert.match(state.modeMessages.storyboard[1].content,/^Saved Project: H3 Prompt/);
  assert.match(state.modeMessages.storyboard[1].content,/"operation": "scene.update"/);
  assert.match(director,/WebCap · Director revision/);
});

test('inline Scene Revise invokes the existing targeted refine_prompt operation',()=>{
  const calls=[];
  const scope=vm.createContext({runDirector:(...args)=>calls.push(args)});
  vm.runInContext(section(scene,'  function reviseSceneWithDirector(sceneId) {','  function handleSceneAction('),scope);
  scope.reviseSceneWithDirector('scene-two');
  assert.deepEqual(calls,[['scene-two','refine_prompt']]);
  assert.doesNotMatch(section(scene,'  function reviseSceneWithDirector(sceneId) {','  function handleSceneAction('),/openSceneDirector\(/);
});
