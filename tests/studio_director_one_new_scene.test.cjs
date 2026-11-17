'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../tool/js/director_chat.js'), 'utf8');

function part(start,end) {
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0 && b>a,'Missing production function: '+start);
  return source.slice(a,b);
}
const writerSource=part('    writeNewScene: function (launch) {',
  '    writeSelectedScene: function (launch) {');
const studioWorkingFieldChanges=new Function(part(
  '  function studioWorkingFieldChanges(source, names) {',
  '  function parseStudioChatResponse(raw) {'
)+'return studioWorkingFieldChanges;')();

function harness(options={}) {
  const story=options.story || {id:'p1',title:'Project',concept:'Evening',style:'Warm light',
    invariants:[],sceneOrder:[],scenes:{}};
  const state={pending:false,jobId:'',studioScenesProposal:null,
    studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{},
      draftOrigins:{projects:{},scenes:{}}}};
  const saves=[],requests=[],proposals=[],statuses=[],receipts=[],operations=[],errors=[];
  let modelCalls=0;
  const bridge={
    isReady:()=>true,readinessMessage:()=>'',canReview:()=>false,
    makeProposal:async (instruction,operation,includePromptContract)=>{
      modelCalls++;
      proposals.push({instruction:JSON.parse(instruction),operation,includePromptContract});
      return typeof options.reply==='function' ? options.reply(story) :
        options.reply ?? JSON.stringify({title:'Last Light',prompt:'[Shot 1] The lantern goes dark.',
          durationSeconds:8});
    },
    recordApplied:async (kind,savedStory,values)=>{
      receipts.push({kind,story:savedStory,values});
      if(options.failReceipt) throw new Error('Receipt failed');
    }
  };
  const scope=vm.createContext({
    state,studioWorkingFieldChanges,syncControls(){},scheduleSessionSave(){},
    studioActionStatus:(message,error)=>statuses.push({message,error}),
    recordStudioOperation:(...args)=>operations.push(args),
    window:{flushStudioDirectorStoryEdits:async id=>assert.equal(id,story.id),
      refreshStudioDirectorStoryIfOpen:async()=>{},
      reportConsoleError:(_,error)=>errors.push(String(error.message || error)),
      studioDirectorBridge:bridge},
    requestJson:async (url,opts)=>{
      requests.push({url,opts});
      if(url==='/fs/storyboard?story='+encodeURIComponent(story.id))
        return {story};
      assert.equal(url,'/fs/studio/director/scenes-draft');
      const body=JSON.parse(opts.body);
      saves.push(body);
      if(options.failSave) throw new Error('Save failed');
      assert.equal(body.storyId,story.id);
      assert.deepEqual(body.expectedSceneOrder,story.sceneOrder);
      const created=body.scenes.map((scene,i)=>({id:'new-'+i,...scene}));
      return {story:{...story,sceneOrder:story.sceneOrder.concat(created.map(x=>x.id))},
        scenes:created};
    },
    Promise,JSON,Number,String,Error,Object,encodeURIComponent
  });
  const writer=vm.runInContext('({' + writerSource + '})',scope).writeNewScene;
  return {state,story,saves,requests,proposals,statuses,receipts,operations,errors,
    bridge,run:(launch={})=>writer.call(bridge,{projectId:story.id,
      instruction:'Write the next Scene',authorRequest:'Write the next Scene',...launch}),
    modelCalls:()=>modelCalls};
}

test('explicit new Scene invokes H3 writer once and saves directly without Review',async()=>{
  const h=harness();
  const result=await h.run();
  assert.equal(h.modelCalls(),1);
  assert.equal(h.proposals[0].operation,'studio_scenes_draft');
  assert.equal(h.proposals[0].includePromptContract,true);
  assert.equal(h.saves.length,1);
  assert.equal(h.saves[0].scenes.length,1);
  assert.equal(h.saves[0].scenes[0].prompt,'[Shot 1] The lantern goes dark.');
  assert.equal(h.receipts.length,1);
  assert.equal(h.receipts[0].kind,'scenes.create');
  assert.equal(result.scenes.length,1);
  assert.equal(h.state.studioScenesProposal,null);
});

test('one model response with multiple Scenes saves all actual returned records',async()=>{
  const h=harness({reply:JSON.stringify({scenes:[
    {title:'First',prompt:'[Shot 1] First action',durationSeconds:6},
    {title:'Second',prompt:'[Shot 1] Second action',durationSeconds:8}
  ]})});
  await h.run();
  assert.equal(h.modelCalls(),1);
  assert.equal(h.saves.length,1);
  assert.equal(h.saves[0].scenes.length,2);
  assert.deepEqual(h.saves[0].scenes.map(x=>x.title),['First','Second']);
  assert.equal(h.receipts[0].values.scenes.length,2);
});

test('new Scene receives the saved Project and prior Scene for continuity',async()=>{
  const story={id:'p1',title:'Lighthouse',concept:'Final watch',style:'Blue twilight',
    invariants:[{kind:'character',title:'Mara',text:'The keeper'}],
    sceneOrder:['s1'],scenes:{s1:{title:'Opening',prompt:'Saved original',durationSeconds:8}}};
  const h=harness({story});
  await h.run({instruction:'Mara closes the logbook.'});
  const payload=h.proposals[0].instruction;
  assert.equal(payload.project.previousScene.prompt,'Saved original');
  assert.equal(payload.project.existingSceneTitles[0],'Opening');
  assert.equal(payload.project.style,'Blue twilight');
  assert.equal(h.saves[0].storyId,'p1');
});

test('non-JSON response remains visible and never triggers an automatic repair call',async()=>{
  const h=harness({reply:'Unparseable model output'});
  await assert.rejects(h.run(),/invalid Scene JSON/);
  assert.equal(h.modelCalls(),1);
  assert.equal(h.saves.length,0);
  assert.equal(h.state.lastStudioIoRaw,'Unparseable model output');
  assert.match(h.state.lastStudioIoError,/Raw response/);
});

test('absent mechanically required Scene fields are reported, not silently invented',async()=>{
  const h=harness({reply:JSON.stringify({title:'Missing Prompt',durationSeconds:8})});
  await assert.rejects(h.run(),/no Scene records with persistable fields/i);
  assert.equal(h.saves.length,0);
  assert.equal(h.modelCalls(),1);
  assert.equal(h.state.studioScenesProposal,null);
  assert.match(h.state.lastStudioIoRaw,/Missing Prompt/);
});

test('independent valid Scene results save even if another record is unusable',async()=>{
  const h=harness({reply:JSON.stringify({scenes:[
    {title:'Valid',prompt:'[Shot 1] Complete action',durationSeconds:8},
    {title:'Missing prompt',durationSeconds:8}
  ]})});
  await h.run();
  assert.equal(h.saves[0].scenes.length,1);
  assert.equal(h.saves[0].scenes[0].title,'Valid');
  assert.match(h.statuses.at(-1).message,/1 returned record/);
  assert.equal(h.modelCalls(),1);
});

test('a real failed save is exposed and never reported as a completed write',async()=>{
  const h=harness({failSave:true});
  await assert.rejects(h.run(),/Save failed/);
  assert.equal(h.saves.length,1);
  assert.equal(h.receipts.length,0);
  assert.match(h.state.lastStudioIoError,/Save failed/);
});
