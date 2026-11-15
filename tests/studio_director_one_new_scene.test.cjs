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

test('one new Scene keeps the selected Project and complete brief through a single authoring call, then REVIEW only', async () => {
  const story = {id:'lighthouse',title:'Last Light',concept:'A final watch',
    style:'Blue twilight and warm lantern light',invariants:[{kind:'character',title:'Mara',text:'Keeper'}],
    sceneOrder:['s1'],scenes:{s1:{title:'Old opening',prompt:'Existing saved text'}}};
  const brief='Add a twelve-second Scene titled Closing the Logbook. Mara calmly closes the lighthouse logbook at the oak desk, using this Project’s visual direction.';
  let requested = 0, authored = 0, reviewed = 0, saved = 0;
  const state={pending:false,jobId:'',studioScenesProposal:null};
  const launch={projectId:'lighthouse',instruction:brief,authorRequest:brief};
  const scope=vm.createContext({
    state, studioRequestedDuration, syncControls(){}, studioActionStatus(){}, showStudioScenesReview(){reviewed++;},
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
  const state={pending:false,jobId:'',studioScenesProposal:null};
  let reviewed=0;
  const scope=vm.createContext({
    state,studioRequestedDuration,syncControls(){},studioActionStatus(){},
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
  const state={pending:false,jobId:'',studioScenesProposal:null};
  const failures=[];
  let reviewed=0;
  const scope=vm.createContext({
    state,studioRequestedDuration,syncControls(){},studioActionStatus:(m,error)=>{if(error)failures.push(m);},
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

