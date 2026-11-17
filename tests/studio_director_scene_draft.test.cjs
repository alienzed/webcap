// Studio Director: no Review/Apply stage. Focused Write owns its result
// and saves directly. Historical Review test cases were superseded.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../tool/tool.html'),'utf8');
const part=(from,to)=>{
  const a=source.indexOf(from),b=source.indexOf(to,a+from.length);
  assert.ok(a>=0&&b>a,'Missing direct Write function: '+from);
  return source.slice(a,b);
};
const plain=o=>JSON.parse(JSON.stringify(o));

test('Review dialogs and combined Chat action launchers are absent',()=>{
  for(const id of ['studio-project-review','studio-brief-review','studio-scenes-review',
    'studio-scene-draft-review','studio-dw-batch-review','studio-dw-scene-review',
    'studio-dw-suggestions','studio-dw-write-ready-launch'])
    assert.doesNotMatch(html,new RegExp('id="'+id+'"'));
  for(const name of ['showStudioProjectReview','showStudioBriefReview',
    'showStudioScenesReview','applyStudioProject','applyStudioBrief',
    'parseStudioReadiness','studioAuthoredWriteActions'])
    assert.doesNotMatch(source,new RegExp('function '+name+'\\('));
});

test('Create Project applies received structured fields through one direct save',async()=>{
  const events=[],versions=[];
  const story={id:'p1',title:'Lighthouse',concept:'A keeper sees a light',
    style:'Muted blue dawn',invariants:[],sceneOrder:[],scenes:{}};
  const scope=vm.createContext({
    requestJson:async(url,opts)=>{
      events.push(['request',url,JSON.parse(opts.body)]);
      return {story};
    },
    recordStudioOperation:(...args)=>events.push(['operation',...args]),
    studioActionStatus:(...args)=>events.push(['status',...args]),
    window:{
      webcapTextareaRevisions:{recordFieldChange:(...args)=>versions.push(args)},
      studioDirectorBridge:{recordApplied:async(...args)=>events.push(['receipt',...args])},
      refreshStudioDirectorStoryIfOpen:async id=>events.push(['refresh',id])
    },
    Promise,JSON,Object,String,Error
  });
  const fn=vm.runInContext(part('  function commitFocusedStudioProject(proposal) {',
    '  function prepareStudioProject(options) {')+';commitFocusedStudioProject',scope);
  await fn({title:story.title,concept:story.concept,style:story.style,invariants:[]});
  assert.equal(events.filter(e=>e[0]==='request').length,1);
  assert.equal(events.find(e=>e[0]==='request')[1],'/fs/studio/director/project-create');
  assert.equal(events.find(e=>e[0]==='receipt')[1],'project.create');
  assert.equal(versions.length,3);
  assert.deepEqual(plain(versions.map(v=>v[0])),[
    'project:p1:storyboard-story-title',
    'project:p1:storyboard-story-concept',
    'project:p1:storyboard-story-style']);
});

function sceneHarness(response) {
  const story={id:'p1',title:'Station',concept:'A lost mitten',
    style:'Blue dawn',invariants:[],sceneOrder:['s1'],scenes:{
      s1:{id:'s1',title:'Arrival',prompt:'Existing saved prompt',durationSeconds:8}
    }};
  let raw=response,requests=[],receipt=[],history=[],errors=[];
  const state={pending:false,jobId:'',lastStudioIoRaw:'',lastStudioIoError:''};
  const el=()=>({dataset:{}});
  const window={
    flushStudioDirectorStoryEdits:async()=>{},
    refreshStudioDirectorStoryIfOpen:async()=>{},
    webcapTextareaRevisions:{recordFieldChange:(...x)=>history.push(x)},
    reportConsoleError:(...x)=>errors.push(x)
  };
  window.studioDirectorBridge={
    isReady:()=>true,readinessMessage:()=>'',makeProposal:async()=>raw,
    recordApplied:async(...x)=>receipt.push(x)
  };
  const scope=vm.createContext({
    state,el,window,requestJson:async(url,options)=>{
      requests.push([url,options&&JSON.parse(options.body)]);
      if(url==='/fs/storyboard?story=p1')return {story};
      assert.equal(url,'/fs/studio/director/scenes-draft');
      const value=JSON.parse(options.body),created=value.scenes.map((item,index)=>({
        id:'new-'+index,...item
      }));
      for(const c of created){story.sceneOrder.push(c.id);story.scenes[c.id]=c;}
      return {story,scenes:created};
    },
    syncControls(){},studioActionStatus(){},Promise,JSON,Object,String,
    Number,Array,Error,encodeURIComponent
  });
  const body=part('    writeNewScene: function (launch) {',
    '    writeSelectedScene: function (launch) {').trim().replace(/,\s*$/,'');
  const write=vm.runInContext('({'+body+'})',scope).writeNewScene;
  return {write,window,state,story,requests,receipt,history,errors,
    setResponse:v=>{raw=v;}};
}

test('one focused Scene request saves actual returned records, not requested count',async()=>{
  const h=sceneHarness(JSON.stringify({scenes:[
    {title:'Find',prompt:'Full H3 prompt 1',durationSeconds:8},
    {title:'Departure',prompt:'Full H3 prompt 2',durationSeconds:10}
  ]}));
  await h.write.call(h.window.studioDirectorBridge,{
    projectId:'p1',instruction:'Write one Scene about the red mitten'});
  const saved=h.requests.filter(x=>x[0]==='/fs/studio/director/scenes-draft');
  assert.equal(saved.length,1);
  assert.equal(saved[0][1].scenes.length,2);
  assert.deepEqual(h.story.sceneOrder,['s1','new-0','new-1']);
  assert.equal(h.receipt.length,1);
  assert.equal(h.history.length,6,'History records each received field after confirmed save');
  assert.equal(h.errors.length,0);
});

test('an unparseable model response stays in raw I/O with no save',async()=>{
  const h=sceneHarness('not structured JSON');
  await assert.rejects(()=>h.write.call(h.window.studioDirectorBridge,{
    projectId:'p1',instruction:'Write the opening Scene'}),/JSON failed to parse/);
  assert.equal(h.requests.filter(x=>x[0]==='/fs/studio/director/scenes-draft').length,0);
  assert.equal(h.state.lastStudioIoRaw,'not structured JSON');
  assert.match(h.state.lastStudioIoError,/JSON failed to parse/);
  assert.equal(h.receipt.length,0);
  assert.equal(h.errors.length,1);
});
