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

test('Chat does not automatically read the selected Project',()=>{
  const body=section(chat,'  function studioDirectorChatRequestMessages(messages) {',
    '  function storyboardRequestMessages(messages, includePrimer) {');
  assert.match(body,/studioApprovedReadSources\(\)/);
  assert.match(body,/No saved Project or Scene reference was supplied/);
  assert.doesNotMatch(body,/getStudioDirectorNavigation/);
});

test('approved Read scope sends multiple selected sources, never an unrelated open editor',async()=>{
  const body=section(chat,'  function studioApprovedReadSources() {',
    '  function storyboardRequestMessages(messages, includePrimer) {');
  const stories={
    a:{id:'a',title:'Reference A',concept:'Pacing reference'},
    b:{id:'b',title:'Reference B',concept:'Character reference'},
    c:{id:'c',title:'Current editor',concept:'Private current Project'}
  };
  const calls=[];
  const scope=vm.createContext({
    state:{studioApprovedRead:{sources:[
      {projectId:'a',keys:['project.concept']},
      {projectId:'b',keys:['project.concept']}
    ]}},
    Promise,JSON,Object,String,encodeURIComponent,
    window:{studioDirectorWorkbench:{approvedReadPayload:(story,keys)=>({
      projectId:story.id,fields:keys.map(id=>({id,value:story.concept}))
    })}},
    requestJson:async url=>{
      calls.push(url);return {story:stories[url.split('=')[1]]};
    },
    studioDirectorRequestMessages:async messages=>[
      {role:'system',content:'Creative conversation'},...messages]
  });
  vm.runInContext(body,scope);
  const sent=await scope.studioDirectorChatRequestMessages([
    {role:'user',content:'Discuss references'}]);
  assert.deepEqual(calls,['/fs/storyboard?story=a','/fs/storyboard?story=b']);
  assert.match(sent[0].content,/Pacing reference/);
  assert.match(sent[0].content,/Character reference/);
  assert.doesNotMatch(sent[0].content,/Private current Project/);
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

test('one approved source can be removed without revoking unrelated sources',()=>{
  assert.match(chat,/removeApprovedRead: function \(projectId\)/);
  assert.match(chat,/item\.projectId !== projectId/);
  assert.match(workbench,/studioDirectorBridge\.removeApprovedRead\(source\.projectId\)/);
});

test('ordinary Chat owns no structured pending Project or Scene fields',()=>{
  assert.doesNotMatch(chat,/studioMergeWorkingChanges|studioWorkingDraft/);
  assert.doesNotMatch(chat,/studioAuthoredWriteActions/);
  assert.match(chat,/studioDirectorChatRequestMessages\(messages\)/);
});

test('saved Read sources cannot determine an explicit Write destination',()=>{
  const write=section(workbench,'  function writePrepare(options) {',
    '  function prepareProjectCoherence(storyId) {');
  assert.match(write,/var id = el\('studio-dw-write-project'\)\.value/);
  assert.doesNotMatch(write,/readStory\.id|approvedReadSources/);
  assert.match(write,/bridge\.prepareWrite/);
});

test('Write operation is selected by interface controls, not author prose',()=>{
  const write=section(workbench,'  function writePrepare(options) {',
    '  function prepareProjectCoherence(storyId) {');
  assert.match(write,/studio-dw-write-operation/);
  assert.match(write,/studio-dw-write-project/);
  assert.doesNotMatch(write,/parseStudioChatResponse|studioActionFromExplicitRequest/);
});

test('conversation stores Chat text and receipts, not structured Write actions',()=>{
  assert.match(chat,/function persistSession\(mode\)/);
  assert.doesNotMatch(chat,/stored\.writeAction|stored\.otherWriteActions/);
  assert.match(chat,/\[WEBCAP APPLIED FIELD VALUES\]/);
});

test('Scene Write maps actual returned records to its authoritative save route',()=>{
  const scene=section(chat,'    writeNewScene: function (launch) {',
    '    writeSelectedScene: function (launch) {');
  assert.match(scene,/authored\.scenes\.map/);
  assert.match(scene,/scenes:authored\.scenes\.map/);
  assert.match(scene,/\/fs\/studio\/director\/scenes-draft/);
  assert.doesNotMatch(scene,/parseStudioChatResponse|\.slice\(0,1\)/);
});
