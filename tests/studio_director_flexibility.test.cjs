'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const chat = fs.readFileSync(path.join(root, 'tool/js/director_chat.js'), 'utf8');
const workbench = fs.readFileSync(path.join(root, 'tool/js/studio_director_workbench.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'tool/tool.html'), 'utf8');

function section(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, 'Missing production section: ' + start);
  return source.slice(first, last);
}

test('a selected Studio Project cannot silently authorize saved Read material', () => {
  const body = section(chat, '  function studioDirectorChatRequestMessages(', '  // Retain available conversational work');
  assert.doesNotMatch(body, /\/fs\/storyboard|approvedPayloads|AUTHOR-APPROVED SAVED CONTEXT/);
  assert.match(body, /studioDirectorRequestMessages\(messages, false, false\)/);
});

test('cross-Project Reads are ordinary user messages, not auto-refreshed context',async()=>{
  const body=section(chat,
    '  function studioDirectorRequestMessages(messages, includePromptContract, explicitWrite, navigationSnapshot) {',
    '  // Retain available conversational work across ordinary follow-up questions.');
  const calls=[];
  const scope=vm.createContext({
    requestJson:async url=>{calls.push(url);return {system:'Director',promptContract:'H3'};},
    studioAttachedStoryId:()=>'',window:{getStudioDirectorNavigation:()=>({projectId:'c'})}
  });
  vm.runInContext(body,scope);
  const history=[
    {role:'user',content:'[WEBCAP READ] Project A: old pacing'},
    {role:'user',content:'[WEBCAP READ] Project B: blue coat'},
    {role:'user',content:'Discuss these references'}
  ];
  const result=await scope.studioDirectorChatRequestMessages(history,null,{projectId:'c'},{});
  history.forEach((entry,index)=>assert.equal(result[index+1].content,entry.content));
  assert.doesNotMatch(result[0].content,/old pacing|blue coat/);
  assert.deepEqual(calls,['/fs/studio/director/guidance?targetModel=minimax_h3']);
});

test('a single character Invariant can be supplied without the rest of its Overview',()=>{
  const source = section(workbench,'  function readPayload(story, keys) {',
    '  function updateReadSelection() {');
  const scope={projectFields:['title','concept','style','invariants'],
    storyName:story=>story.title};
  vm.createContext(scope);
  vm.runInContext(source,scope);
  const story={id:'c',title:'Reference C',concept:'Private unrelated narrative',
    style:'Private unrelated style',sceneOrder:[],scenes:{},invariants:[
      {kind:'character',title:'Mara',text:'Mara has a silver hairpin.'},
      {kind:'character',title:'Ari',text:'Ari wears a green jacket.'}
    ]};
  const fields=scope.readPayload(story,['invariant:character:Mara']).fields;
  assert.equal(fields.length,1);
  assert.equal(fields[0].value.text,'Mara has a silver hairpin.');
  assert.doesNotMatch(JSON.stringify(fields),/Private unrelated|Ari wears/);
  assert.throws(()=>scope.readPayload(story,['invariant:character:Missing']),
    /no longer in this Project/);
});

test('Read approvals and standing source controls have been removed',()=>{
  assert.doesNotMatch(chat,/removeApprovedRead|studioApprovedRead|approvedReadSources/);
  assert.doesNotMatch(workbench,/removeApprovedRead|approveRead\(/);
  assert.match(workbench,/appendReadSnapshot\(payload, readConversationId\)/);
});

test('ordinary chat never converts returned Project fields into pending writes',()=>{
  const parser=section(chat,'  function parseStudioChatResponse(raw) {','  function storyboardRequestMessages(');
  const parse=new Function(parser+'return parseStudioChatResponse;')();
  const raw=JSON.stringify({reply:'A creative idea',changes:{project:{style:'Warm daylight'}}});
  const parsed=parse(raw);
  assert.equal(parsed.reply,raw);
  assert.equal(parsed.changes,null);
  assert.equal(parsed.action,null);
  assert.doesNotMatch(chat,/function studioMergeWorkingChanges\(/);
});

test('source material never determines a write destination and review uses returned fields', () => {
  assert.match(workbench, /authoredFields/);
  assert.match(workbench, /Review authored Project/);
  assert.match(workbench, /Review authored Scene/);
  assert.match(workbench, /chosenProjectId/);
  assert.doesNotMatch(chat, /function studioActionFromExplicitRequest/);
});

test('a destination cannot be inferred by parsing the author request', () => {
  const body = section(workbench, '  function presentAction(action,', '  window.studioDirectorWorkbench = {');
  assert.doesNotMatch(body, /studioActionFromExplicitRequest/);
  assert.match(body, /sourceMessageIndex/);
  assert.match(body, /reviewAuthoredScenes/);
});

test('saved Project and independent conversation response are separate persistence owners', () => {
  assert.match(chat, /message\.rawResponse/);
  assert.match(chat, /studioRestoreAuthoredAction/);
  assert.match(chat, /sourceMessageIndex/);
  assert.match(chat, /stored\.writeAction = message\.writeAction/);
});

test('ordinary chat does not create actionable Scene records from structured model text',()=>{
  const parsed=section(chat,'  function parseStudioChatResponse(raw) {','  function storyboardRequestMessages(');
  const parse=new Function(parsed+'return parseStudioChatResponse;')();
  const raw=JSON.stringify({scenes:[{prompt:'Unrequested Scene 1'},{prompt:'Unrequested Scene 2'}]});
  assert.equal(parse(raw).reply,raw);
  assert.equal(parse(raw).scenes,null);
  assert.equal(parse(raw).action,null);
});
