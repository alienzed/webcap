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
  state.studioApprovedRead={projectId:'lighthouse',keys:['project.style','scene:s1:title']};
  const launch={projectId:'lighthouse',instruction:brief,authorRequest:brief};
  const scope=vm.createContext({
    state, studioWorkingFieldChanges, syncControls(){},scheduleSessionSave(){}, studioActionStatus(){}, showStudioScenesReview(){reviewed++;},
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
          assert.equal(payload.authorDirection,brief);
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
    state,studioWorkingFieldChanges,syncControls(){},scheduleSessionSave(){},studioActionStatus(){},
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
  state.studioApprovedRead={projectId:'p1',keys:['scene:s1:prompt','scene:s1:title']};
  const story={id:'p1',title:'Project',concept:'An evening story',style:'Quiet light',
    invariants:[],sceneOrder:['s1'],scenes:{s1:{title:'Opening',prompt:'SAVED FIRST SCENE',durationSeconds:8}}};
  let requests=0,reviewed=0;
  const scope=vm.createContext({
    state,studioWorkingFieldChanges,
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
    state,studioWorkingFieldChanges,syncControls(){},
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

test('missing authored Scene duration is reviewable rather than silently defaulted',async()=>{
  const state={pending:false,jobId:'',studioScenesProposal:null,
    studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{},sourceRequest:''}};
  let saves=0,reviews=0;
  const scope=vm.createContext({
    state,studioWorkingFieldChanges,syncControls(){},scheduleSessionSave(){},
    studioActionStatus(){},showStudioScenesReview(){reviews++;},
    window:{flushStudioDirectorStoryEdits:async()=>{},reportConsoleError:()=>assert.fail('Partial work is usable'),
      studioDirectorBridge:{isReady:()=>true,readinessMessage:()=>'',makeProposal:async()=>JSON.stringify({
        title:'Arrival',prompt:'Complete H3 generation prompt for arrival'
      })}},
    requestJson:async url=>{
      if(url!=='/fs/storyboard?story=p1')saves++;
      return {story:{id:'p1',title:'Project',sceneOrder:[],scenes:{}}};
    },
    Promise,JSON,Number,String,Error,encodeURIComponent
  });
  const writer=vm.runInContext('({' + method + '})',scope).writeNewScene;
  const result=await writer.call(scope.window.studioDirectorBridge,
    {projectId:'p1',instruction:'Write an eight-second arrival.',directSave:true});
  assert.equal(result.review,true);
  assert.equal(reviews,1);
  assert.equal(saves,0);
  assert.equal(state.studioScenesProposal.drafts[0].durationSeconds,undefined);
  assert.match(state.studioScenesProposal.drafts[0].prompt,/Complete H3/);
});

test('new Scene draft reauthors from fresh Project context when the baseline changed',async()=>{
  const story={id:'p1',title:'Bookshop',concept:'An evening opening',style:'Warm lamps',
    invariants:[],sceneOrder:[],scenes:{}};
  const state={pending:false,jobId:'',studioScenesProposal:null,
    studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{}}};
  let calls=0;
  const scope=vm.createContext({
    state,studioWorkingFieldChanges,syncControls(){},scheduleSessionSave(){},
    studioActionStatus(){},showStudioScenesReview(){},
    window:{flushStudioDirectorStoryEdits:async()=>{},
      reportConsoleError:()=>assert.fail('A complete Scene draft should be reviewable'),
      studioDirectorBridge:{isReady:()=>true,readinessMessage:()=>'',makeProposal:async instruction=>{
        calls++;
        const payload=JSON.parse(instruction);
        assert.equal(payload.project.concept,story.concept);
        return JSON.stringify({
          title:'Opening',prompt:calls===1?'First authored opening':'Updated authored opening',
          durationSeconds:8
        });
      }}
    },
    requestJson:async()=>({story}),Promise,JSON,Number,String,Error,encodeURIComponent
  });
  const writer=vm.runInContext('({' + method + '})',scope).writeNewScene;
  const launch={projectId:'p1',instruction:'Author an opening Scene',authorRequest:'Author an opening Scene'};
  await writer.call(scope.window.studioDirectorBridge,launch);
  assert.equal(calls,1);
  assert.equal(state.studioWorkingDraft.newScene.prompt,'First authored opening');
  assert.ok(state.studioWorkingDraft.draftOrigins.newScene.baseline);
  state.studioScenesProposal=null; // Prior review closed; retained editable draft remains.
  story.concept='The bookshop is under siege instead';
  await writer.call(scope.window.studioDirectorBridge,launch);
  assert.equal(calls,2,'a changed Project baseline cannot reuse the original Scene draft');
  assert.equal(state.studioScenesProposal.drafts[0].prompt,'Updated authored opening');
});

test('manual new Scene launch authors again even when the Project and request are unchanged',async()=>{
  const story={id:'p1',title:'Bookshop',concept:'An opening',style:'Warm lamps',
    invariants:[],sceneOrder:[],scenes:{}};
  const state={pending:false,jobId:'',studioScenesProposal:null,
    studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{}}};
  let calls=0;
  const scope=vm.createContext({
    state,studioWorkingFieldChanges,syncControls(){},scheduleSessionSave(){},
    studioActionStatus(){},showStudioScenesReview(){},
    window:{flushStudioDirectorStoryEdits:async()=>{},
      reportConsoleError:()=>assert.fail('Both results are valid authored Scenes'),
      studioDirectorBridge:{isReady:()=>true,readinessMessage:()=>'',makeProposal:async()=>{
        calls++;
        return JSON.stringify({title:'Opening',prompt:'Fresh authored prompt '+calls,
          durationSeconds:8});
      }}
    },
    requestJson:async()=>({story}),Promise,JSON,Number,String,Error,encodeURIComponent
  });
  const writer=vm.runInContext('({' + method + '})',scope).writeNewScene;
  const launch={projectId:'p1',instruction:'Author the opening',forceAuthor:true};
  await writer.call(scope.window.studioDirectorBridge,launch);
  assert.equal(calls,1);
  state.studioScenesProposal=null;
  await writer.call(scope.window.studioDirectorBridge,launch);
  assert.equal(calls,2,'a second explicit authoring request is not a request to reuse cached output');
  assert.equal(state.studioScenesProposal.drafts[0].prompt,'Fresh authored prompt 2');
});

test('new Scene drafts cannot leak across Projects with identical author requests',async()=>{
  const first={id:'p1',title:'One',concept:'A library',style:'Amber',
    invariants:[],sceneOrder:[],scenes:{}};
  const second={id:'p2',title:'Two',concept:'An ocean crossing',style:'Cold blue',
    invariants:[],sceneOrder:[],scenes:{}};
  const state={pending:false,jobId:'',studioScenesProposal:null,
    studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{}}};
  let calls=0;
  const scope=vm.createContext({
    state,studioWorkingFieldChanges,syncControls(){},scheduleSessionSave(){},
    studioActionStatus(){},showStudioScenesReview(){},
    window:{flushStudioDirectorStoryEdits:async()=>{},
      reportConsoleError:()=>assert.fail('Each Project should receive an independent Scene'),
      studioDirectorBridge:{isReady:()=>true,readinessMessage:()=>'',makeProposal:async instruction=>{
        calls++;
        const payload=JSON.parse(instruction);
        assert.deepEqual(JSON.parse(JSON.stringify(payload.project.unsavedWorkingFields)),{},
          'unrelated Project draft is not part of the next authoring request');
        return JSON.stringify({title:'Arrival',prompt:'A usable Scene in '+payload.project.title,
          durationSeconds:8});
      }}
    },
    requestJson:async url=>({story:url.includes('p2')?second:first}),
    Promise,JSON,Number,String,Error,encodeURIComponent
  });
  const writer=vm.runInContext('({' + method + '})',scope).writeNewScene;
  const instruction='Write an arrival Scene';
  await writer.call(scope.window.studioDirectorBridge,{projectId:'p1',instruction});
  state.studioScenesProposal=null;
  await writer.call(scope.window.studioDirectorBridge,{projectId:'p2',instruction});
  assert.equal(calls,2,'same words across different Projects must not reuse an old draft');
  assert.equal(state.studioScenesProposal.drafts[0].prompt,'A usable Scene in Two');
  assert.equal(state.studioWorkingDraft.draftOrigins.newScene.projectId,'p2');
});

test('actual multi-Scene output is retained even when the request mentioned one', async () => {
  const state={pending:false,jobId:'',studioScenesProposal:null,studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{},sourceRequest:''}};
  const failures=[];
  let reviewed=0;
  const scope=vm.createContext({
    state,studioWorkingFieldChanges,syncControls(){},scheduleSessionSave(){},studioActionStatus:(m,error)=>{if(error)failures.push(m);},
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
    state,studioWorkingFieldChanges,syncControls(){},scheduleSessionSave(){},studioActionStatus(){},
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

test('two eight-second Scenes request retains one actually authored Scene without a replacement call',async()=>{
  const story={id:'p1',title:'Project',concept:'A quiet evening',style:'Amber light',
    invariants:[],sceneOrder:[],scenes:{}};
  const state={pending:false,jobId:'',studioScenesProposal:null,
    studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{},sourceRequest:''}};
  let calls=0,reviews=0,saves=0;
  const scope=vm.createContext({
    state,studioWorkingFieldChanges,
    syncControls(){},scheduleSessionSave(){},studioActionStatus(){},
    showStudioScenesReview(){reviews++;},
    window:{
      flushStudioDirectorStoryEdits:async()=>{},
      reportConsoleError:()=>assert.fail('Partial quantity is not an operation failure'),
      studioDirectorBridge:{
        isReady:()=>true,readinessMessage:()=>'',makeProposal:async()=>{
          calls++;
          return JSON.stringify({scenes:[{
            title:'One useful Scene',prompt:'Complete H3 prompt',durationSeconds:8
          }]});
        }
      }
    },
    requestJson:async url=>{
      if(url!=='/fs/storyboard?story=p1') saves++;
      return {story};
    },
    Promise,JSON,Number,String,Error,encodeURIComponent
  });
  const writer=vm.runInContext('({' + method + '})',scope).writeNewScene;
  const result=await writer.call(scope.window.studioDirectorBridge,{
    projectId:'p1',instruction:'Create two eight-second Scenes',
    authorRequest:'Create two eight-second Scenes',directSave:false
  });
  assert.equal(calls,1);
  assert.equal(reviews,1);
  assert.equal(saves,0);
  assert.equal(result.review,true);
  assert.equal(state.studioScenesProposal.drafts.length,1);
  assert.equal(state.studioScenesProposal.drafts[0].durationSeconds,8);
});
