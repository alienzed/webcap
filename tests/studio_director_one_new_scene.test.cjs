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

test('one new Scene keeps the selected Project and complete brief through a single authoring call, then REVIEW only', async () => {
  const story = {id:'lighthouse',title:'Last Light',concept:'A final watch',
    style:'Blue twilight and warm lantern light',invariants:[{kind:'character',title:'Mara',text:'Keeper'}],
    sceneOrder:['s1'],scenes:{s1:{title:'Old opening',prompt:'Existing saved text'}}};
  const brief='Add a twelve-second Scene titled Closing the Logbook. Mara calmly closes the lighthouse logbook at the oak desk, using this Project’s visual direction.';
  let requested = 0, authored = 0, reviewed = 0, saved = 0;
  const state={pending:false,jobId:'',studioScenesProposal:null,studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{},sourceRequest:''}};
  const launch={projectId:'lighthouse',instruction:brief,authorRequest:brief};
  const scope=vm.createContext({
    state, studioRequestedDuration, studioMentionedDuration, studioRequestAppliesPreparedMaterial, syncControls(){}, studioActionStatus(){}, showStudioScenesReview(){reviewed++;},
    window:{
      flushStudioDirectorStoryEdits:async id=>{assert.equal(id,'lighthouse');},
      reportConsoleError:()=>{assert.fail('No error expected')},
      studioDirectorBridge:{
        isReady:()=>true,readinessMessage:()=> '',
        makeProposal:async (instruction,operation,includePromptContract)=>{
          authored++;
          assert.equal(operation,'studio_scene_sequence_draft');
          assert.equal(includePromptContract,true);
          const payload=JSON.parse(instruction);
          assert.equal(payload.instruction,brief);
          assert.equal(payload.authorRequest,brief);
          assert.equal(payload.project.style,story.style);
          assert.equal(payload.project.existingSceneTitles[0],'Old opening');
          assert.doesNotMatch(instruction,/["']summary["']|["']intent["']/i);
          return JSON.stringify({scenes:[{
            title:'Closing the Logbook',durationSeconds:12,
            prompt:'integrated_multimodal_description: [Shot 1] Mara calmly closes the logbook at the oak desk.'
          }],rationale:'Quiet conclusion'});
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

test('a malformed duration from Director leaves the full new Scene available for review', async () => {
  const state={pending:false,jobId:'',studioScenesProposal:null,studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{},sourceRequest:''}};
  let reviewed=0;
  const scope=vm.createContext({
    state,studioRequestedDuration,studioMentionedDuration,studioRequestAppliesPreparedMaterial,syncControls(){},studioActionStatus(){},
    showStudioScenesReview(){reviewed++;},
    window:{
      flushStudioDirectorStoryEdits:async()=>{},
      reportConsoleError:()=>{assert.fail('An editable duration is not a writer failure');},
      studioDirectorBridge:{
        isReady:()=>true,readinessMessage:()=> '',
        makeProposal:async()=>JSON.stringify({scenes:[{
          title:'Closing the Logbook',prompt:'Complete H3 prompt for a quiet ending',
          durationSeconds:'twelve'
        }],rationale:'Quiet ending'})
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
  assert.equal(state.studioScenesProposal.drafts[0].durationSeconds,'twelve');
});

test('invalid output prevents review or mutation and reports failure', async () => {
  const state={pending:false,jobId:'',studioScenesProposal:null,studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{},sourceRequest:''}};
  const failures=[];
  let reviewed=0;
  const scope=vm.createContext({
    state,studioRequestedDuration,studioMentionedDuration,studioRequestAppliesPreparedMaterial,syncControls(){},studioActionStatus:(m,error)=>{if(error)failures.push(m);},
    showStudioScenesReview(){reviewed++;},
    window:{
      flushStudioDirectorStoryEdits:async()=>{},
      reportConsoleError:()=>{},
      studioDirectorBridge:{
        isReady:()=>true,readinessMessage:()=> '',
        makeProposal:async()=>JSON.stringify({scenes:[
          {title:'One',durationSeconds:12,prompt:'A'},
          {title:'Two',durationSeconds:12,prompt:'B'}
        ],rationale:'Wrong count'})
      }
    },
    requestJson:async()=>({story:{id:'p1',title:'P',sceneOrder:[],scenes:{}}}),
    parseStudioScenesDraft:raw=>JSON.parse(raw),
    Promise, JSON, Number, String, Error, encodeURIComponent
  });
  const writer=vm.runInContext('({' + method + '})',scope).writeNewScene;
  await assert.rejects(writer.call(scope.window.studioDirectorBridge,
    {projectId:'p1',instruction:'Add exactly one Scene'}),/exactly one Scene/);
  assert.equal(state.studioScenesProposal,null);
  assert.equal(reviewed,0);
  assert.match(failures.at(-1),/New Scene draft failed/);
});


test('launched Scene creation saves through the existing insertion route, with a truthful receipt',async()=>{
  const story={id:'p1',title:'Bookshop',concept:'Evening rain',style:'Warm lamps',
    invariants:[],sceneOrder:['old'],scenes:{old:{title:'Opening',prompt:'Original'} }};
  const requests=[],receipts=[],refreshes=[];
  let reviewed=0;
  const state={pending:false,jobId:'',studioScenesProposal:null,studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{},sourceRequest:''}};
  const scope=vm.createContext({
    state,studioRequestedDuration,studioMentionedDuration,studioRequestAppliesPreparedMaterial,syncControls(){},studioActionStatus(){},
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
          return JSON.stringify({scenes:[{title:'Closing',prompt:'Full H3 prompt for 12s',
            durationSeconds:'garbled'}]});
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
  assert.deepEqual(requests,['/fs/storyboard?story=p1','/fs/studio/director/scenes-draft']);
  assert.equal(result.scenes[0].id,'new-id');
  assert.equal(result.scenes[0].durationSeconds,12);
  assert.deepEqual(refreshes,['p1']);
  assert.equal(receipts[0].kind,'scene.create');
  assert.equal(reviewed,0);
  assert.equal(state.studioScenesProposal,null);
  assert.equal(story.scenes.old.prompt,'Original');
});
