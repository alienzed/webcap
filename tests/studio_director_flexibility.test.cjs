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
  assert.match(body, /NO SAVED PROJECT\/SCENE CONTEXT APPROVED/);
  assert.doesNotMatch(body, /studioActionFromExplicitRequest/);
});

test('approved Read scope supports multiple unrelated Project sources without changing destination', () => {
  assert.match(chat, /studioApprovedReads/);
  assert.match(chat, /AUTHOR-APPROVED SAVED CONTEXT/);
  assert.match(workbench, /approveRead\(story\.id, keys\)/);
  assert.match(html, /id="studio-dw-read-project"/);
  assert.match(html, /id="studio-dw-read-clear"/);
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
