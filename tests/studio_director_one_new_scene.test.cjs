const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const director = fs.readFileSync(path.join(__dirname, '../tool/js/director_chat.js'), 'utf8');
const workbench = fs.readFileSync(path.join(__dirname, '../tool/js/studio_director_workbench.js'), 'utf8');

function slice(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Missing method: ' + start);
  return source.slice(a, b);
}

const method = slice(director,
  '    writeNewScene: function (launch) {', '    writeSelectedScene: function (launch) {');
const studioRequestedDuration = new Function(slice(director,
  '  function studioRequestedDuration(instruction) {',
  '  window.studioDirectorBridge = {') + 'return studioRequestedDuration;')();
const studioMentionedDuration = new Function(slice(director,
  '  function studioRequestedDuration(instruction) {',
  '  window.studioDirectorBridge = {') + 'return studioMentionedDuration;')();
const studioRequestAppliesPreparedMaterial = new Function(slice(director,
  '  function studioRequestAppliesPreparedMaterial(request) {',
  '  function studioWorkingFieldChanges(source, names) {')+
  'return studioRequestAppliesPreparedMaterial;')();
const studioWorkingFieldChanges = new Function(slice(director,
  '  function studioWorkingFieldChanges(source, names) {',
  '  function studioMergeWorkingChanges(changes, target, action, request) {')+
  'return studioWorkingFieldChanges;')();

test('one new Scene keeps the selected Project and complete brief through a single authoring call, then REVIEW only', async () => {
  const story = {id:'lighthouse',title:'Last Light',concept:'A final watch',
    style:'Blue twilight and warm lantern light',invariants:[{kind:'character',title:'Mara',text:'Keeper'}],
    sceneOrder:['s1'],scenes:{s1:{title:'Old opening',prompt:'Existing saved text'}}};
  const brief='Add a twelve-second Scene titled Closing the Logbook. Mara calmly closes the lighthouse logbook at the oak desk, using this Project’s visual direction.';
  let requested = 0, authored = 0, reviewed = 0, saved = 0;
  const state={pending:false,jobId:'',studioScenesProposal:null,studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{},sourceRequest:''}};
  const launch={projectId:'lighthouse',instruction:brief,authorRequest:brief};
  const scope=vm.createContext({
    state, studioRequestedDuration, studioMentionedDuration, studioRequestAppliesPreparedMaterial, studioWorkingFieldChanges, syncControls(){},scheduleSessionSave(){}, studioActionStatus(){}, showStudioScenesReview(){reviewed++;},
    window:{
      flushStudioDirectorStoryEdits:async id=>{assert.equal(id,'lighthouse');},
      reportConsoleError:()=>{assert.fail('No error expected')},
      studioDirectorBridge:{
        isReady:()=>true,readinessMessage:()=> '',
        makeProposal:async (instruction,operation,includePromptContract)=>{
          authored++;
          assert.equal(operation,'studio_scenes_draft');
          assert.equal(includePromptContract,true);
          const payload=JSON.parse(instruction);
          assert.equal(payload.instruction,brief);
          assert.equal(payload.authorRequest,brief);
          assert.equal(payload.project.style,story.style);
          assert.equal(payload.project.existingSceneTitles[0],'Old opening');
          assert.doesNotMatch(instruction,/["']summary["']|["']intent["']/i);
          return JSON.stringify({
            title:'Closing the Logbook',durationSeconds:12,
            prompt:'integrated_multimodal_description: [Shot 1] Mara calmly closes the logbook at the oak desk.'
          });
        }
      }
    },
    requestJson:async url=>{
      requested++;
      assert.equal(url,'/fs/storyboard?story=lighthouse');
      return {story};
    },
    parseStudioScenesDraft:raw=>JSON.parse(raw),
    console, Promise, JSON, Number, String, Error, encodeURIComponent
  });
  const writer=vm.runInContext('({' + method + '})',scope).writeNewScene;
  await writer.call(scope.window.studioDirectorBridge,launch);
  assert.equal(requested,1);
  assert.equal(authored,1);
  assert.equal(reviewed,1);
  assert.equal(saved,0,'review is not save');
  assert.equal(state.studioScenesProposal.storyId,'lighthouse');
  assert.equal(state.studioScenesProposal.sceneOrder.length,1);
  assert.equal(state.studioScenesProposal.drafts.length,1);
  assert.equal(state.studioScenesProposal.drafts[0].title,'Closing the Logbook');
  assert.equal(state.studioScenesProposal.drafts[0].durationSeconds,12);
  assert.equal(story.scenes.s1.prompt,'Existing saved text');
});

test('malformed model duration remains visible in review instead of becoming invented metadata', async () => {
  const state={pending:false,jobId:'',studioScenesProposal:null,studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{},sourceRequest:''}};
  let reviewed=0;
  const scope=vm.createContext({
    state,studioRequestedDuration,studioMentionedDuration,studioRequestAppliesPreparedMaterial,studioWorkingFieldChanges,syncControls(){},scheduleSessionSave(){},studioActionStatus(){},
    showStudioScenesReview(){reviewed++;},
    window:{
      flushStudioDirectorStoryEdits:async()=>{},
      reportConsoleError:()=>{assert.fail('An editable duration is not a writer failure');},
      studioDirectorBridge:{
        isReady:()=>true,readinessMessage:()=> '',
        makeProposal:async()=>JSON.stringify({
          title:'Closing the Logbook',prompt:'Complete H3 prompt for a quiet ending',
          durationSeconds:'twelve'
        })
      }
    },
    requestJson:async()=>({story:{id:'p1',title:'Project',sceneOrder:[],scenes:{}}}),
    parseStudioScenesDraft:raw=>JSON.parse(raw),
    Promise,JSON,Number,String,Error,encodeURIComponent
  });
  const writer=vm.runInContext('({' + method + '})',scope).writeNewScene;
  await writer.call(scope.window.studioDirectorBridge,
    {projectId:'p1',instruction:'Add a twelve-second closing Scene'});
  assert.equal(reviewed,1);
  assert.equal(state.studioScenesProposal.drafts[0].prompt,'Complete H3 prompt for a quiet ending');
  assert.equal(state.studioScenesProposal.drafts[0].durationSeconds,'twelve',
    'review preserves the actual model field; the author can correct it');
});

test('later new Scene sees prior saved Scene for continuity, not leftover working draft', async () => {
  const state={pending:false,jobId:'',studioScenesProposal:null,
    studioWorkingDraft:{projects:{},scenes:{},newProject:{title:'Old Draft',prompt:'OLD SCENE PROMPT'},
      sourceRequest:'Create Scene 1'}};
  const story={id:'p1',title:'Project',concept:'An evening story',style:'Quiet light',
    invariants:[],sceneOrder:['s1'],scenes:{s1:{title:'Opening',prompt:'SAVED FIRST SCENE',durationSeconds:8}}};
  let requests=0,reviewed=0;
  const scope=vm.createContext({
    state,studioRequestedDuration,studioMentionedDuration,
    studioRequestAppliesPreparedMaterial,studioWorkingFieldChanges,
    syncControls(){},scheduleSessionSave(){},studioActionStatus(){},
    showStudioScenesReview(){reviewed++;},
    window:{
      flushStudioDirectorStoryEdits:async()=>{},
      reportConsoleError:()=>assert.fail('Valid next Scene should not fail'),
      studioDirectorBridge:{
        isReady:()=>true,readinessMessage:()=> '',
        makeProposal:async instruction=>{
          requests++;
          const payload=JSON.parse(instruction);
          assert.equal(payload.project.previousScene.prompt,'SAVED FIRST SCENE');
          assert.equal(payload.project.previousScene.title,'Opening');
          assert.deepEqual(JSON.parse(JSON.stringify(payload.project.unsavedWorkingFields)),{});
          assert.doesNotMatch(instruction,/OLD SCENE PROMPT/);
          return JSON.stringify({title:'Second Scene',prompt:'New independent complete H3 prompt'});
        }
      }
    },
    requestJson:async()=>({story}),
    Promise,JSON,Number,String,Error,encodeURIComponent
  });
  const writer=vm.runInContext('({' + method + '})',scope).writeNewScene;
  const result=await writer.call(scope.window.studioDirectorBridge,{
    projectId:'p1',instruction:'Create the second Scene',sequenceIndex:1,directSave:false
  });
  assert.equal(requests,1);
  assert.equal(reviewed,1);
  assert.equal(result.review,true);
  assert.equal(state.studioScenesProposal.drafts[0].title,'Second Scene');
});

test('missing Prompt retains title and duration as editable draft even on direct save', async () => {
  const state={pending:false,jobId:'',studioScenesProposal:null,
    studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{},sourceRequest:''}};
  const brief='Create a 12-second closing Scene';
  let authored=0,reviewed=0,saves=0,sessionSaves=0;
  const statuses=[];
  const scope=vm.createContext({
    state,studioRequestedDuration,studioMentionedDuration,
    studioRequestAppliesPreparedMaterial,studioWorkingFieldChanges,syncControls(){},
    scheduleSessionSave(){sessionSaves++;},
    studioActionStatus:(message,error)=>statuses.push({message,error}),
    showStudioScenesReview(){reviewed++;},
    window:{
      flushStudioDirectorStoryEdits:async()=>{},
      reportConsoleError:()=>assert.fail('Partial Scene is not a writer error'),
      studioDirectorBridge:{
        isReady:()=>true,readinessMessage:()=> '',
        makeProposal:async()=>{
          authored++;
          return JSON.stringify({title:'Closing the Logbook',durationSeconds:12});
        }
      }
    },
    requestJson:async url=>{
      if (url!=='/fs/storyboard?story=p1') saves++;
      return {story:{id:'p1',title:'Project',sceneOrder:[],scenes:{}}};
    },
    Promise,JSON,Number,String,Error,encodeURIComponent
  });
  const writer=vm.runInContext('({' + method + '})',scope).writeNewScene;
  const result=await writer.call(scope.window.studioDirectorBridge,{
    projectId:'p1',instruction:brief,authorRequest:brief,directSave:true
  });
  assert.equal(result.review,true);
  assert.equal(authored,1,'no repair LLM call');
  assert.equal(saves,0,'missing Prompt cannot silently save an empty Scene');
  assert.equal(reviewed,1);
  assert.equal(state.studioScenesProposal.drafts[0].title,'Closing the Logbook');
  assert.equal(state.studioScenesProposal.drafts[0].durationSeconds,12);
  assert.equal(state.studioScenesProposal.drafts[0].prompt,'');
  assert.equal(state.studioWorkingDraft.newScene.title,'Closing the Logbook');
  assert.equal(state.studioWorkingDraft.newScene.durationSeconds,12);
  assert.ok(sessionSaves>0,'retain partial values across conversation restoration');
  assert.match(statuses.at(-1).message,/Complete the missing H3 Prompt/);
  assert.equal(statuses.at(-1).error,false);
});

test('actual multi-Scene output is retained even when the request mentioned one', async () => {
  const state={pending:false,jobId:'',studioScenesProposal:null,studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{},sourceRequest:''}};
  const failures=[];
  let reviewed=0;
  const scope=vm.createContext({
    state,studioRequestedDuration,studioMentionedDuration,studioRequestAppliesPreparedMaterial,studioWorkingFieldChanges,syncControls(){},scheduleSessionSave(){},studioActionStatus:(m,error)=>{if(error)failures.push(m);},
    showStudioScenesReview(){reviewed++;},
    window:{
      flushStudioDirectorStoryEdits:async()=>{},
      reportConsoleError:()=>{},
      studioDirectorBridge:{
        isReady:()=>true,readinessMessage:()=> '',
        makeProposal:async()=>JSON.stringify({scenes:[
          {title:'One',durationSeconds:12,prompt:'A'},
          {title:'Two',durationSeconds:12,prompt:'B'}
        ]})
      }
    },
    requestJson:async()=>({story:{id:'p1',title:'P',sceneOrder:[],scenes:{}}}),
    parseStudioScenesDraft:raw=>JSON.parse(raw),
    Promise, JSON, Number, String, Error, encodeURIComponent
  });
  const writer=vm.runInContext('({' + method + '})',scope).writeNewScene;
  const result=await writer.call(scope.window.studioDirectorBridge,
    {projectId:'p1',instruction:'Add exactly one Scene'});
  assert.equal(result.review,true);
  assert.equal(state.studioScenesProposal.drafts.length,2);
  assert.equal(reviewed,1);
  assert.equal(failures.length,0);
});


test('invalid returned duration retains review and does not invent a successful save',async()=>{
  const story={id:'p1',title:'Bookshop',concept:'Evening rain',style:'Warm lamps',
    invariants:[],sceneOrder:['old'],scenes:{old:{title:'Opening',prompt:'Original'} }};
  const requests=[],receipts=[],refreshes=[];
  let reviewed=0;
  const state={pending:false,jobId:'',studioScenesProposal:null,studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{},sourceRequest:''}};
  const scope=vm.createContext({
    state,studioRequestedDuration,studioMentionedDuration,studioRequestAppliesPreparedMaterial,studioWorkingFieldChanges,syncControls(){},scheduleSessionSave(){},studioActionStatus(){},
    showStudioScenesReview(){reviewed++;},
    window:{
      flushStudioDirectorStoryEdits:async()=>{},
      refreshStudioDirectorStoryIfOpen:async id=>{refreshes.push(id);},
      reportConsoleError:(_label,err)=>assert.fail(err.message),
      studioDirectorBridge:{
        isReady:()=>true,readinessMessage:()=>'',recordApplied:async(kind,_story,fields)=>{
          receipts.push({kind,fields});
        },
        makeProposal:async()=>{
          return JSON.stringify({title:'Closing',prompt:'Full H3 prompt for 12s',
            durationSeconds:'garbled'});
        }
      }
    },
    requestJson:async(url,options)=>{
      requests.push(url);
      if(url==='/fs/storyboard?story=p1')return {story};
      assert.equal(url,'/fs/studio/director/scenes-draft');
      const data=JSON.parse(options.body);
      assert.equal(data.storyId,'p1');
      assert.deepEqual(Array.from(data.expectedSceneOrder),['old']);
      assert.equal(data.scenes.length,1);
      assert.equal(data.scenes[0].durationSeconds,12);
      assert.equal(data.scenes[0].prompt,'Full H3 prompt for 12s');
      const created={id:'new-id',...data.scenes[0]};
      story.sceneOrder.push(created.id);
      story.scenes[created.id]=created;
      return {story,scenes:[created]};
    },
    parseStudioScenesDraft:raw=>JSON.parse(raw),Promise,JSON,String,Number,Error,encodeURIComponent
  });
  const writer=vm.runInContext('({' + method + '})',scope).writeNewScene;
  const result=await writer.call(scope.window.studioDirectorBridge,{
    projectId:'p1',instruction:'Create a closing Scene lasting 12 seconds',
    authorRequest:'Create a 12-second closing Scene',directSave:true
  });
  assert.deepEqual(requests,['/fs/storyboard?story=p1']);
  assert.equal(result.review,true);
  assert.equal(reviewed,1);
  assert.equal(state.studioScenesProposal.drafts[0].durationSeconds,'garbled');
  assert.equal(receipts.length,0,'no save receipt without an actual save');
  assert.equal(refreshes.length,0,'no refresh claim without a save');
  assert.equal(story.scenes.old.prompt,'Original');
});
