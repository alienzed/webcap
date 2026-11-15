const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'tool/js/director_chat.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'tool/tool.html'), 'utf8');

function part(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Missing Studio code: ' + start);
  return source.slice(a, b);
}

test('Studio scene reviewer has editable Prompt, placement and approval controls', () => {
  for (const name of [
    'studio-scene-draft-review',
    'studio-scene-draft-title', 'studio-scene-draft-prompt',
    'studio-scene-draft-placement', 'studio-scene-draft-apply'
  ]) assert.match(html, new RegExp('id="' + name + '"'));
  assert.match(html, /Nothing is created until you approve/);
  assert.doesNotMatch(source, /operation: 'studio_scene_draft'/);
  assert.match(source, /\/fs\/studio\/director\/scene-draft/);
});

test('complete Scene capture has an editable Prompt and one reviewed Apply saves all fields', async () => {
  const prompt='integrated_multimodal_description: [Shot 1] A crimson kite rises.';
  const proposal={
    storyId:'project-1',storyTitle:'Kite Project',expectedUpdatedAt:'before',
    sceneOrder:[],scenes:{},title:'Kite flight',
    prompt,rationale:'Authored together in chat.',placement:'end'
  };
  const nodes=new Map();
  const el=id=>{
    if (!nodes.has(id)) nodes.set(id,{
      value:'',textContent:'',disabled:false,open:false,
      classList:{hidden:false,toggle(name,on){if(name==='hidden')this.hidden=on;}},
      appendChild(item){this.options.push(item);},replaceChildren(){this.options=[];},
      options:[],showModal(){this.open=true;},close(){this.open=false;}
    });
    return nodes.get(id);
  };
  const calls=[];
  let completed;
  const done=new Promise(resolve=>{completed=resolve;});
  const scope=vm.createContext({
    state:{studioSceneProposal:proposal,pending:false},el,
    document:{createElement:()=>({value:'',textContent:''})},
    window:{
      flushStudioDirectorStoryEdits:async()=>{calls.push('flush');},
      studioDirectorBridge:{recordApplied:async (_kind,_story,changes)=>{
        calls.push('receipt');assert.equal(changes.scenes[0].prompt,prompt);
      }},
      refreshStudioDirectorStoryIfOpen:async()=>{calls.push('refresh');completed();}
    },
    syncControls(){},studioActionStatus(){},recordStudioOperation(){},
    requestJson:async(url,args)=>{
      calls.push('apply');assert.equal(url,'/fs/studio/director/scene-draft');
      const payload=JSON.parse(args.body);
      assert.deepEqual(payload.scene,{title:'Kite flight',prompt});
      assert.equal(payload.expectedUpdatedAt,'before');
      return {story:{id:'project-1',sceneOrder:['scene-1']},
        scene:{id:'scene-1',...payload.scene}};
    },
  });
  vm.runInContext(
    part('  function showStudioSceneDraftReview() {','  function applyStudioSceneDraft() {')+
    part('  function applyStudioSceneDraft() {','  function startStudioWorkshop() {'),scope);
  scope.showStudioSceneDraftReview();
  assert.equal(el('studio-scene-draft-prompt-row').classList.hidden,false);
  assert.equal(el('studio-scene-draft-prompt').value,prompt);
  scope.applyStudioSceneDraft();
  await done;
  assert.deepEqual(calls,['flush','apply','receipt','refresh']);
  assert.equal(scope.state.studioSceneProposal,null);

});

test('Only explicitly attached Story ID qualifies as a Scene target', () => {
  const state = { storyboardAttachments: {} };
  const context = vm.createContext({ state, Object });
  const target = vm.runInContext('(' + part('  function studioAttachedStoryId() {', '  function studioWorkingStoryLabel() {').trim() + ')', context);
  assert.equal(target(), '');
  state.storyboardAttachments['scene:other:scene-a'] = { label: 'Scene' };
  assert.equal(target(), '');
  state.storyboardAttachments['story:studio-a'] = { label: 'Story A' };
  assert.equal(target(), 'studio-a');
  state.storyboardAttachments['story:studio-b'] = { label: 'Story B' };
  assert.equal(target(), '');
});

test('Studio project proposals remain separate from conversation and must be reviewed', () => {
  for (const name of [
    'director-studio-capture', 'studio-project-review', 'studio-project-concept',
    'studio-project-style', 'studio-project-invariants', 'studio-project-include-scene',
    'studio-project-create'
  ]) assert.match(html, new RegExp('id="' + name + '"'));
  const prep = part('  function prepareStudioProject(options) {', '  function applyStudioProject() {');
  assert.match(prep, /operation: 'studio_project_draft'/);
  assert.match(prep, /showStudioProjectReview\(\)/);
  assert.doesNotMatch(prep, /\/fs\/studio\/director\/project-create/);
  const apply = part('  function applyStudioProject() {', '  function parseStudioBriefDraft(raw) {');
  assert.match(apply, /\/fs\/studio\/director\/project-create/);
  assert.match(apply, /studioDirectorBridge\.recordApplied\(/);
  assert.match(apply, /refreshStudioDirectorStoryIfOpen/);
  assert.doesNotMatch(apply, /state\.storyboardAttachments\s*=/);
});

test('Unbound Project parser accepts zero Scenes and refuses invented or invalid structure', () => {
  const context = vm.createContext({ JSON, String, Error, Array });
  const parse = vm.runInContext('(' + part('  function parseStudioProjectDraft(raw) {', '  function addStudioProjectInvariant(').trim() + ')', context);
  const project = parse(JSON.stringify({
    title: '', concept: 'A single simple idea', style: 'Blue twilight.', rationale: '',
    invariants: []
  }));
  assert.equal(project.firstScene, undefined);
  assert.equal(project.title, '');
  assert.throws(() => parse('{}'), /no usable Project material/);
  assert.throws(() => parse(JSON.stringify({
    title: '', concept: '', style: '', rationale: '', invariants: []
  })), /no usable Project material/);
});


test('Retained multi-Scene review supports arbitrary placement without legacy model authoring', () => {
  for (const id of [
    'studio-scenes-review', 'studio-scenes-rows',
    'studio-scenes-placement', 'studio-scenes-apply', 'studio-scenes-add'
  ]) assert.match(html, new RegExp('id="' + id + '"'));
  assert.doesNotMatch(source, /function prepareStudioScenes\(\)|studio_scene_sequence_draft/);
  const apply = part('  function applyStudioScenes() {', '  function showStudioSceneDraftReview() {');
  assert.match(apply, /expectedSceneOrder: proposal\.sceneOrder/);
  assert.match(apply, /\/fs\/studio\/director\/scenes-draft/);
  assert.match(apply, /studioDirectorBridge\.recordApplied\(/);
  assert.match(source, /option\('before\|' \+ id/);
  assert.match(source, /option\('after\|' \+ id/);
});

test('Scene review retains prompts and flags durations for author correction', () => {
  function node(tag) {
    return {tag,children:[],style:{},dataset:{},textContent:'',
      append(...items){this.children.push(...items);},
      appendChild(item){this.children.push(item);},
      setAttribute(){},remove(){}};
  }
  const host=node('host');
  const scope=vm.createContext({document:{createElement:node},el:()=>host,Number,String});
  vm.runInContext(part('  function addStudioScenesRow(item) {',
    '  function showStudioScenesReview() {'),scope);
  scope.addStudioScenesRow({title:'A',prompt:'Useful first Prompt',durationSeconds:'twelve'});
  scope.addStudioScenesRow({title:'B',prompt:'Useful second Prompt'});
  scope.addStudioScenesRow({title:'C',prompt:'',durationSeconds:12.5});
  const find=(item,pred)=>pred(item)?item:item.children.map(child=>find(child,pred)).find(Boolean);
  const messages=item=>[item.textContent,...item.children.flatMap(messages)].filter(Boolean).join(' ');
  assert.equal(host.children.length,3);
  assert.equal(find(host.children[0],item=>item.dataset.field==='prompt').value,'Useful first Prompt');
  assert.equal(find(host.children[0],item=>item.dataset.field==='durationSeconds').value,6);
  assert.match(messages(host.children[0]),/using 6s/);
  assert.equal(find(host.children[1],item=>item.dataset.field==='prompt').value,'Useful second Prompt');
  assert.equal(find(host.children[1],item=>item.dataset.field==='durationSeconds').value,6);
  assert.match(messages(host.children[1]),/6s default/);
  assert.equal(String(find(host.children[2],item=>item.dataset.field==='durationSeconds').value),'12.5');
  assert.match(messages(host.children[2]),/No Prompt supplied/);
  assert.doesNotMatch(messages(host.children[2]),/not supported/,'fractional seconds are not automatically invalid');
});

test('new Scene Apply sends the edited prompt and duration and records the authoritative saved values',async()=>{
  let payload,receipt,finish;
  const done=new Promise(resolve=>{finish=resolve;});
  const values={title:'Edited title',prompt:'Edited full prompt',durationSeconds:'8'};
  const row={querySelector:selector=>({value:values[selector.match(/data-field="([^"]+)"/)[1]]})};
  const scope=vm.createContext({state:{pending:false,studioScenesProposal:{storyId:'p1',sceneOrder:['old']}},
    el:id=>id==='studio-scenes-rows'?{querySelectorAll:()=>[row]}:
      id==='studio-scenes-placement'?{value:'after|old'}:{textContent:'',close(){}},
    syncControls(){},recordStudioOperation(){},studioActionStatus:message=>{if(message.includes('failed'))assert.fail(message);},
    window:{flushStudioDirectorStoryEdits:async()=>{},studioDirectorBridge:{recordApplied:async(_kind,_story,fields)=>{receipt=fields;}},
      refreshStudioDirectorStoryIfOpen:async()=>finish()},
    requestJson:async(_url,options)=>{
      payload=JSON.parse(options.body);
      return{story:{id:'p1'},scenes:[{id:'new',...payload.scenes[0]}]};
    }
  });
  vm.runInContext(part('  function applyStudioScenes() {','  function showStudioSceneDraftReview() {'),scope);
  scope.applyStudioScenes();await done;
  assert.deepEqual(payload,{storyId:'p1',expectedSceneOrder:['old'],placement:'after',relativeSceneId:'old',
    scenes:[{...values,durationSeconds:8}]});
  assert.equal(receipt.scenes[0].prompt,values.prompt);
  assert.equal(receipt.scenes[0].durationSeconds,8);
});


test('Apply saves usable Scenes and retains incomplete rows for later Apply', async () => {
  const node=(title,prompt,duration)=>({
    fields:{title:{value:title},prompt:{value:prompt},durationSeconds:{value:duration}},
    removed:false,
    querySelector(selector){return this.fields[selector.match(/data-field="([^"]+)"/)[1]];},
    remove(){this.removed=true;}
  });
  const first=node('Opening','Complete H3 Prompt A','twelve');
  const incomplete=node('Unfinished','','10');
  const last=node('Ending','Complete H3 Prompt C','12.5');
  const rows=[first,incomplete,last], requests=[], receipts=[], errors=[], statuses=[];
  let dialogClosed=0;
  let currentStory={id:'p1',title:'Project',sceneOrder:['old'],scenes:{}};
  const proposal={storyId:'p1',storyTitle:'Project',sceneOrder:['old'],scenes:{},
    drafts:[{title:'Opening',prompt:'Complete H3 Prompt A'},{title:'Unfinished',prompt:''},
      {title:'Ending',prompt:'Complete H3 Prompt C'}]};
  const status={textContent:''};
  const state={pending:false,studioScenesProposal:proposal};
  const scope=vm.createContext({
    state,Number,String,Array,Promise,JSON,
    el:id=>id==='studio-scenes-rows'?{querySelectorAll:()=>rows.filter(row=>!row.removed)}:
      id==='studio-scenes-placement'?{value:'end'}:
      id==='studio-scenes-error'?status:
      id==='studio-scenes-review'?{close(){dialogClosed++;}}:{},
    syncControls(){},recordStudioOperation(){},studioActionStatus:message=>statuses.push(message),
    window:{flushStudioDirectorStoryEdits:async()=>{},
      studioDirectorBridge:{recordApplied:async(_kind,_story,fields)=>{receipts.push(fields);}},
      refreshStudioDirectorStoryIfOpen:async()=>{},
      reportConsoleError:(_label,error)=>errors.push(error)},
    requestJson:async(url,options)=>{
      assert.equal(url,'/fs/studio/director/scenes-draft');
      const payload=JSON.parse(options.body);
      requests.push(payload);
      assert.deepEqual(payload.expectedSceneOrder,currentStory.sceneOrder);
      const created=payload.scenes.map((item,i)=>({...item,id:'created-'+requests.length+'-'+i}));
      currentStory={...currentStory,sceneOrder:[...currentStory.sceneOrder,...created.map(x=>x.id)],
        scenes:{...currentStory.scenes,...Object.fromEntries(created.map(x=>[x.id,x]))}};
      return{story:currentStory,scenes:created};
    }
  });
  vm.runInContext(part('  function applyStudioScenes() {',
    '  function showStudioSceneDraftReview() {'),scope);
  const run=()=>scope.applyStudioScenes();
  await run();
  assert.deepEqual(errors,[]);
  assert.equal(requests.length,1);
  assert.deepEqual(requests[0].scenes.map(x=>x.prompt),['Complete H3 Prompt A','Complete H3 Prompt C']);
  assert.deepEqual(requests[0].scenes.map(x=>x.durationSeconds),[6,12.5]);
  assert.equal(first.removed,true);
  assert.equal(last.removed,true);
  assert.equal(incomplete.removed,false);
  assert.equal(dialogClosed,0);
  assert.equal(state.studioScenesProposal,proposal);
  assert.deepEqual(Array.from(proposal.sceneOrder),currentStory.sceneOrder);
  assert.equal(proposal.drafts.length,1);
  assert.equal(proposal.drafts[0].title,'Unfinished');
  assert.match(status.textContent,/2 Scenes saved/);
  assert.match(status.textContent,/still need a Prompt/);
  assert.match(statuses.at(-1),/1 duration defaulted to 6s/);
  incomplete.fields.prompt.value='Completed H3 Prompt B';
  await run();
  assert.deepEqual(errors,[]);
  assert.equal(requests.length,2);
  assert.equal(requests[1].scenes[0].prompt,'Completed H3 Prompt B');
  assert.equal(requests[1].scenes[0].durationSeconds,10);
  assert.equal(state.studioScenesProposal,null);
  assert.equal(dialogClosed,1);
  assert.equal(receipts.length,2);
});

test('Apply with only empty prompts leaves the review intact without a save request', () => {
  const row={querySelector:selector=>({value:selector.includes('prompt')?'':'Incomplete'})};
  const status={textContent:''},proposal={storyId:'p1',sceneOrder:[]};
  const scope=vm.createContext({
    state:{pending:false,studioScenesProposal:proposal},Array,Number,String,
    el:id=>id==='studio-scenes-rows'?{querySelectorAll:()=>[row]}:status,
    requestJson:()=>assert.fail('No write is possible without a Prompt')
  });
  vm.runInContext(part('  function applyStudioScenes() {',
    '  function showStudioSceneDraftReview() {'),scope);
  scope.applyStudioScenes();
  assert.match(status.textContent,/No complete H3 Prompts to save/);
});

test('Studio brief review limits Apply to explicitly checked Story fields', () => {
  for (const id of [
    'director-studio-capture', 'studio-brief-review',
    'studio-brief-concept-selected', 'studio-brief-style-selected',
    'studio-brief-invariants-selected', 'studio-brief-apply',
    'studio-dw-undo-button'
  ]) assert.match(html, new RegExp('id="' + id + '"'));
  const prep = part('  function prepareStudioBrief(', '  function applyStudioBrief() {');
  assert.match(prep, /studioAttachedStoryId\(\)/);
  assert.match(prep, /window\.flushStudioDirectorStoryEdits\(storyId\)/);
  assert.match(prep, /operation: 'studio_brief_draft'/);
  assert.doesNotMatch(prep, /\/fs\/studio\/director\/brief'/);
  const apply = part('  function applyStudioBrief() {', '  function undoStudioBrief() {');
  assert.match(apply, /studio-brief-concept-selected/);
  assert.match(apply, /studio-brief-style-selected/);
  assert.match(apply, /studio-brief-invariants-selected/);
  assert.match(apply, /expected: expected, changes: changes/);
  assert.match(apply, /\/fs\/studio\/director\/brief'/);
  assert.match(source, /\/fs\/studio\/director\/brief\/undo/);
  assert.doesNotMatch(html, /id="director-studio-undo-brief"/,
    'legacy direct Undo shortcut must not bypass reviewed confirmation');
});


test('Review Create Project persists explicit continuation without touching unbound conversations', async () => {
  const code = part('  function applyStudioProject() {', '  function parseStudioBriefDraft(raw) {');
  async function create(continueChecked) {
    let persisted, refreshed, receipt, message;
    const state = {
      studioProjectProposal: {concept: 'A comic train station scene'},
      studioStoryAccess: null, studioAccessIndex: [],
      studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{},sourceRequest:''},
      pending: false,
    };
    const nodes = {
      'studio-project-title': {value: 'The Station'},
      'studio-project-concept': {value: 'A comic train station scene'},
      'studio-project-style': {value: 'Muted pastel palette'},
      'studio-project-invariants': {querySelectorAll: () => []},
      'studio-project-include-scene': {checked: false},
      'studio-project-extra-scenes': {querySelectorAll: () => []},
      'studio-project-continue': {checked: continueChecked},
      'studio-project-error': {textContent: ''},
      'studio-project-review': {close() {this.closed = true;}},
      'director-studio-access-status': {textContent: ''},
      'director-studio-access-data': {classList: {add() {}}},
    };
    const context = vm.createContext({
      state, Promise, JSON, String, Error,
      el: id => {
        if (!nodes[id]) throw Error('Unexpected Studio control: ' + id);
        return nodes[id];
      },
      syncControls() {}, syncModeUi() {}, scheduleSessionSave() {},
      writeInitialProjectScenes:async()=>({saved:[],failed:[],notAttempted:[]}),
      requestJson: async (url, opts) => {
        assert.equal(url, '/fs/studio/director/project-create');
        const payload = JSON.parse(opts.body);
        assert.equal(payload.proposal.concept, 'A comic train station scene');
        return {story: {id: 'story-created', title: 'The Station', concept: 'A comic train station scene', style: 'Muted pastel palette', invariants: [], sceneOrder: [], scenes: {}}};
      },
      recordStudioOperation: (kind, label, storyId) => {
        receipt = {kind, label, storyId};
      },
      studioActionStatus: text => {message = text;},
      persistSession: async mode => {
        assert.equal(mode, 'storyboard');
        persisted = state.studioStoryAccess && {...state.studioStoryAccess};
      },
      window: {
        refreshStudioDirectorStoryIfOpen: async id => {refreshed = id;},
        studioDirectorBridge: {recordApplied: async (kind, story, fields) => {
          assert.equal(kind, 'project.create');
          assert.equal(story.id, 'story-created');
          assert.equal(fields.concept, 'A comic train station scene');
          persisted = state.studioStoryAccess && {...state.studioStoryAccess};
        }}
      },
    });
    vm.runInContext(code, context);
    vm.runInContext('applyStudioProject()', context);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.pending, false);
    assert.equal(nodes['studio-project-review'].closed, true);
    assert.equal(receipt.kind, 'project.create');
    assert.equal(receipt.storyId, 'story-created');
    assert.equal(refreshed, 'story-created');
    assert.match(message, /Project saved/);
    return persisted;
  }
  const attached = await create(true);
  assert.equal(attached.storyId, 'story-created');
  assert.equal(attached.label, 'The Station');
  assert.equal(await create(false), null);
});
