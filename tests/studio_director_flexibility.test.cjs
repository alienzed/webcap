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
  assert.match(body, /approved/);
  assert.match(body, /No saved Project or Scene reference was supplied/);
  assert.doesNotMatch(body, /studioActionFromExplicitRequest/);
});

test('approved Read scope sends material from multiple Projects, not the open editor', async () => {
  const body = section(chat, '  function studioApprovedReadSources() {',
    '  // Retain available conversational work across ordinary follow-up questions.');
  const saved = {
    a:{id:'a',title:'Reference A',concept:'An archived pacing reference',scenes:{},sceneOrder:[]},
    b:{id:'b',title:'Reference B',concept:'A character reference',scenes:{},sceneOrder:[]},
    c:{id:'c',title:'Current open editor',concept:'PRIVATE OPEN PROJECT',scenes:{},sceneOrder:[]}
  };
  const requested=[];
  const state={
    studioApprovedRead:{sources:[
      {projectId:'a',keys:['project.concept'],label:'Reference A · Overview'},
      {projectId:'b',keys:['project.concept'],label:'Reference B · Overview'}
    ]},
    studioWorkingDraft:{newProject:{},newScene:{}}
  };
  const scope=vm.createContext({
    state,Promise,JSON,Object,String,encodeURIComponent,
    window:{
      getStudioDirectorNavigation:()=>({projectId:'c'}),
      studioDirectorWorkbench:{approvedReadPayload:(story,keys)=>({
        projectId:story.id,projectTitle:story.title,
        fields:keys.map(key=>({id:key,value:story[key.slice(8)]}))
      })}
    },
    studioAttachedStoryId:()=>'',requestJson:async url=>{
      requested.push(url);
      return {story:saved[url.split('=')[1]]};
    },
    studioDirectorRequestMessages:async messages=>[
      {role:'system',content:'Creative guidance'},...messages
    ],
    parseStudioChatResponse:raw=>JSON.parse(raw)
  });
  vm.runInContext(body,scope);
  const bound={};
  const result=await scope.studioDirectorChatRequestMessages(
    [{role:'user',content:'Use A for pacing and B for character, write elsewhere.'}],
    null,{projectId:'c'},bound);
  assert.equal(bound.projectId,'c','the selected editor is a potential destination only');
  assert.deepEqual(requested,['/fs/storyboard?story=a','/fs/storyboard?story=b']);
  assert.match(result[0].content,/An archived pacing reference/);
  assert.match(result[0].content,/A character reference/);
  assert.doesNotMatch(result[0].content,/PRIVATE OPEN PROJECT/);
  assert.match(result[0].content,/independent sources/);
  assert.match(workbench,/approveRead\(story\.id, keys\)/);
  assert.match(html,/id="studio-dw-approved-sources"/);
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

test('existing authored response fields are a session asset, not assigned to the open Project', () => {
  const source = section(chat, '  function studioWorkingFieldChanges(source, names) {',
    '  function parseStudioChatResponse(raw) {');
  const state = {
    studioWorkingDraft: {projects:{},scenes:{},newProject:{},newScene:{},sourceRequest:''},
    sessionDirty: {storyboard:false}
  };
  const merge = new Function('state', source + 'return studioMergeWorkingChanges;')(state);
  merge({project:{style:'A new idea from a reference, not an edit to the open Project'}},
    {projectId:'project-a'}, null, 'Make the mood warmer');
  assert.deepEqual(state.studioWorkingDraft.projects, {},
    'creative material must not acquire a Project owner solely from navigation');
  assert.deepEqual(state.studioWorkingDraft.scenes, {},
    'creative material must not acquire a Scene owner solely from navigation');
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

test('multiple distinct scene records are retained as actual response material', () => {
  const parsed = section(chat, '  function parseStudioChatResponse(raw) {',
    '  function storyboardRequestMessages(');
  const parse = new Function(parsed + 'return parseStudioChatResponse;')();
  const result = parse(JSON.stringify({reply:'Authored actual records',scenes:[
    {title:'First',prompt:'Complete first scene prompt',durationSeconds:8},
    {title:'Second',prompt:'Complete second scene prompt',durationSeconds:12}
  ]}));
  assert.equal(result.scenes.length, 2);
  assert.equal(result.scenes[1].durationSeconds,12);
  assert.deepEqual(result.scenes.map(scene=>scene.title),['First','Second']);
});
