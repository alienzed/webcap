// Focused new-Scene authoring: one request, no Review, exact target.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
const start=source.indexOf('    writeNewScene: function (launch) {');
const end=source.indexOf('    writeSelectedScene: function (launch) {',start);
assert.ok(start>=0&&end>start);
const method=source.slice(start,end).trim().replace(/,\s*$/,'');
function make(response){
  const project={id:'p1',title:'Moon Crossing',concept:'A quiet landing',
    style:'Natural moonlight',invariants:[],sceneOrder:[],scenes:{}};
  const state={pending:false,jobId:'',lastStudioIoRaw:'',lastStudioIoError:''};
  const calls=[],versions=[],errors=[];
  const win={
    flushStudioDirectorStoryEdits:async()=>{},
    refreshStudioDirectorStoryIfOpen:async()=>{},
    reportConsoleError:(...xs)=>errors.push(xs),
    webcapTextareaRevisions:{recordFieldChange:(...xs)=>versions.push(xs)}
  };
  win.studioDirectorBridge={
    isReady:()=>true,readinessMessage:()=>'',makeProposal:async(task,op,h3)=>{
      calls.push(['author',JSON.parse(task),op,h3]);return response;
    },recordApplied:async()=>{}
  };
  const ctx=vm.createContext({
    state,window:win,el:()=>({dataset:{}}),syncControls(){},
    studioActionStatus(){},Promise,JSON,Object,Number,String,Error,
    encodeURIComponent,
    requestJson:async(url,options)=>{
      calls.push(['backend',url]);
      if(url==='/fs/storyboard?story=p1')return {story:project};
      assert.equal(url,'/fs/studio/director/scenes-draft');
      const req=JSON.parse(options.body);
      const scenes=req.scenes.map((x,i)=>({id:'s'+(i+1),...x}));
      for(const sc of scenes){project.sceneOrder.push(sc.id);project.scenes[sc.id]=sc;}
      return {story:project,scenes};
    }
  });
  return {write:vm.runInContext('({'+method+'})',ctx).writeNewScene,
    win,calls,project,state,versions,errors};
}
test('Scene Write requests a focused schema, then saves actual returned Scenes',async()=>{
  const h=make(JSON.stringify({scenes:[
    {title:'Arrival',prompt:'Full generatable H3 Prompt A',durationSeconds:8},
    {title:'Discovery',prompt:'Full generatable H3 Prompt B',durationSeconds:10}
  ]}));
  await h.write.call(h.win.studioDirectorBridge,{
    projectId:'p1',instruction:'Write the arrival and discovery'});
  const authored=h.calls.filter(x=>x[0]==='author');
  assert.equal(authored.length,1);
  assert.equal(authored[0][2],'studio_scenes_draft');
  assert.equal(authored[0][3],true);
  assert.equal(h.project.sceneOrder.length,2);
  assert.equal(h.versions.length,6);
  assert.equal(h.errors.length,0);
});
test('invalid structured response is visible in raw I/O without saving',async()=>{
  const h=make('unexpected provider response');
  await assert.rejects(()=>h.write.call(h.win.studioDirectorBridge,{
    projectId:'p1',instruction:'Write the arrival'}),/JSON failed to parse/);
  assert.equal(h.state.lastStudioIoRaw,'unexpected provider response');
  assert.equal(h.project.sceneOrder.length,0);
  assert.equal(h.calls.filter(x=>x[1]==='/fs/studio/director/scenes-draft').length,0);
});
