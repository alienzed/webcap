'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const chat = fs.readFileSync(path.join(__dirname, '../tool/js/director_chat.js'), 'utf8');
const workbench = fs.readFileSync(path.join(__dirname, '../tool/js/studio_director_workbench.js'), 'utf8');
function part(source, begin, end) {
  const first = source.indexOf(begin), last = source.indexOf(end, first + begin.length);
  assert.ok(first >= 0 && last > first, 'Missing production function: ' + begin);
  return source.slice(first, last);
}
const parse = new Function(part(chat, '  function parseStudioChatResponse(raw) {',
  '  function storyboardRequestMessages(') + 'return parseStudioChatResponse;')();
const requestedDuration = new Function(part(chat, '  function studioRequestedDuration(instruction) {',
  '  window.studioDirectorBridge = {') + 'return studioRequestedDuration;')();
const sceneTargets = new Function(part(workbench, '  function sceneIdsFromRequest(instruction, story, selectedScene) {',
  '  function presentAction(') + 'return sceneIdsFromRequest;')();

test('Read is plain prose; an absent or malformed optional action does not discard its reply', () => {
  assert.deepEqual(parse('The saved title is Rainy Bookshop.'), {
    reply: 'The saved title is Rainy Bookshop.', action: null, changes: null
  });
  const structured = parse(JSON.stringify({reply: 'Saved details are consistent.', action: null}));
  assert.equal(structured.reply, 'Saved details are consistent.');
  assert.equal(structured.action, null);
  const invalid = parse(JSON.stringify({reply: 'Useful answer.', action: {kind:'edit_everything'}}));
  assert.equal(invalid.reply, 'Useful answer.');
  assert.equal(invalid.action, null);
  assert.equal(parse('{"reply":unfinished').reply, '{"reply":unfinished');
  assert.throws(() => parse('  '), /no answer/);
});

test('Only a small, optional action accompanies conversation', () => {
  const result = parse(JSON.stringify({reply:'I can make that quieter.', action:{
    kind:'write_scenes', instruction:'Make the ending quieter.', fields:['prompt']
  }}));
  assert.equal(result.action.kind, 'write_scenes');
  assert.equal(result.action.instruction, 'Make the ending quieter.');
  assert.match(chat, /studioDirectorWorkbench\.presentAction/);
  assert.doesNotMatch(part(chat, '  function parseStudioChatResponse(raw) {',
    '  function storyboardRequestMessages('), /readiness|capture/i);
});

test('WebCap resolves finite saved Scene IDs, with explicit numbers ahead of selection', () => {
  const story = {id:'p1',sceneOrder:['one','two','three']};
  const selected = {projectId:'p1',sceneId:'two'};
  assert.deepEqual(sceneTargets('Revise scenes 1 and 3', story, selected), ['one','three']);
  assert.deepEqual(sceneTargets('Revise Scene 3', story, selected), ['three']);
  assert.deepEqual(sceneTargets('Make the ending quieter', story, selected), ['two']);
  assert.deepEqual(sceneTargets('Revise scenes', story, selected), []);
  assert.deepEqual(sceneTargets('Revise Scene 7', story, selected), []);
  assert.deepEqual(sceneTargets('Make the ending quieter', story, {projectId:'other',sceneId:'two'}), []);
});

test('Explicit duration is a WebCap parameter, not optional LLM metadata', () => {
  assert.equal(requestedDuration('Make this a 12-second Scene'), 12);
  assert.equal(requestedDuration('Use 14s'), 14);
  assert.equal(requestedDuration('No duration mentioned'), null);
  assert.equal(requestedDuration('Use 30 seconds'), null);
  assert.match(chat, /draft\.scenes\[0\]\.durationSeconds = requestedDuration/);
});

function harness() {
  const suggestions = {children:[],replaceChildren(){this.children=[];},
    appendChild(value){this.children.push(value);}};
  const controls = new Map([['studio-dw-suggestions',suggestions]]);
  function el(id) {
    if (!controls.has(id)) controls.set(id,{value:'',disabled:false});
    return controls.get(id);
  }
  const document = {createElement() {return {type:'',dataset:{},textContent:'',disabled:false};}};
  const requests = [],statuses = [];
  const story = {id:'p1', title:'Rainy Bookshop',
    sceneOrder:['one','two','three'], scenes:{
      one:{title:'Opening'},two:{title:'Middle'},three:{title:'Ending'}
    }};
  const bridge = {
    isReady:()=>true, readinessMessage:()=>'',placeSuggestedAction:()=>{},
    prepareWrite:(...args)=>{requests.push(['project',...args]);return Promise.resolve();},
    writeSelectedScene:async action=>{requests.push(['scene',action]);return {};},
    writeNewScene:async action=>{requests.push(['new-scene',action]);return {};},
  };
  const window = {studioDirectorBridge:bridge};
  const source = part(workbench, '  function sceneIdsFromRequest(instruction, story, selectedScene) {',
    '  window.studioDirectorWorkbench = {');
  const creator = new Function('el','document','window','refreshProjects','loadStory',
    'storyName','projectFields','status','openWriteForCapture',
    source + 'return {presentAction,sceneIdsFromRequest};');
  let opened = 0;
  const functions = creator(el,document,window,
    async()=>[{id:'p1',title:'Rainy Bookshop'}],async id=>{
      assert.equal(id,'p1');return story;
    },
    value=>value.title, ['title','concept','style','invariants'],
    (...args)=>statuses.push(args),()=>{opened++;});
  return {functions,bridge,requests,statuses,suggestions,story,opened:()=>opened};
}
async function flush() {
  for (let i=0;i<5;i++) await new Promise(setImmediate);
}

test('a suggested multi-Scene revision runs one existing writer per real Scene', async () => {
  const h = harness();
  h.functions.presentAction({kind:'write_scenes',instruction:'Make the rooms darker.',fields:['prompt']},
    {projectId:'p1',sceneId:'two',sceneNumber:2},
    {projectId:'p1'}, 'Revise scenes 1 and 3');
  assert.equal(h.suggestions.children.length,1);
  h.suggestions.children[0].onclick();
  await flush();
  assert.deepEqual(h.requests.map(row=>row[1].sceneId),['one','three']);
  assert.ok(h.statuses.some(row=>/Saved 2/.test(row[0])));
});

test('the selected Scene is used when no explicit number overrides it', async () => {
  const h = harness();
  h.functions.presentAction({kind:'write_scenes',instruction:'Quiet the ending.'},
    {projectId:'p1',sceneId:'two',sceneNumber:2},{projectId:'p1'},'Make the ending quieter');
  h.suggestions.children[0].onclick();
  await flush();
  assert.deepEqual(h.requests.map(row=>row[1].sceneId),['two']);
});

test('new Scene and Project actions use existing writers with frozen destinations', async () => {
  const h = harness();
  h.functions.presentAction({kind:'create_scene',instruction:'Create a 12-second closing Scene.'},
    null,{projectId:'p1'},'Create a 12-second closing Scene.');
  h.suggestions.children[0].onclick();
  await flush();
  assert.equal(h.requests[0][0],'new-scene');
  assert.equal(h.requests[0][1].projectId,'p1');
  assert.equal(h.requests[0][1].directSave,true);
  h.functions.presentAction({kind:'create_project',instruction:'Create a bookshop Project.'},
    null,null,'Create a Project');
  h.suggestions.children[0].onclick();
  await flush();
  assert.equal(h.requests[1][0],'project');
  assert.equal(h.requests[1][1],'new-project');
});

test('new multiple Scenes run one canonical writer per item with independently saved results',async()=>{
  const h=harness();
  h.bridge.writeNewScene=async launch=>{
    h.requests.push(['new-scene',launch]);
    return {scenes:[{id:'created-'+h.requests.length}]};
  };
  h.functions.presentAction({kind:'create_scene',instruction:'Create three different bookshop Scenes.'},
    null,{projectId:'p1'},'Create 3 Scenes');
  h.suggestions.children[0].onclick();
  await flush();
  assert.equal(h.requests.length,3);
  assert.equal(h.requests[0][1].projectId,'p1');
  assert.ok(h.requests.every(item=>item[1].directSave===true));
  assert.match(h.requests[1][1].instruction,/Scene 2 of 3/);
  assert.ok(h.statuses.some(row=>/Saved 3 · Failed 0/.test(row[0])));
});

test('new multiple Scenes retain successes when one item fails',async()=>{
  const h=harness();
  let index=0;
  h.bridge.writeNewScene=async launch=>{
    h.requests.push(['new-scene',launch]);
    index++;
    if(index===2) throw new Error('Scene two could not be authored.');
    return {scenes:[{id:'created-'+index}]};
  };
  h.functions.presentAction({kind:'create_scene',instruction:'Create three different bookshop Scenes.'},
    null,{projectId:'p1'},'Create 3 Scenes');
  h.suggestions.children[0].onclick();
  await flush();
  assert.equal(h.requests.length,3);
  assert.ok(h.statuses.some(row=>/Saved 2 · Failed 1/.test(row[0])));
});
