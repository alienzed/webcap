'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const director = fs.readFileSync(path.join(__dirname, '../tool/js/director_chat.js'), 'utf8');
const workbench = fs.readFileSync(path.join(__dirname, '../tool/js/studio_director_workbench.js'), 'utf8');

// Exercise the real classic-script methods without loading the browser or
// replacing them with rewritten copies of their decision logic.
function method(source, start, end, name, bindings) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'missing ' + name + ' method');
  const sourceMethod = source.slice(from, to);
  return new Function(...Object.keys(bindings),
    'return ({' + sourceMethod + '\n}).' + name + ';')(...Object.values(bindings));
}

function authoredFixture() {
  const state = {studioScenesProposal:null,studioScenesReviewsByResponse:{}};
  const shown = [];
  const bindings = {
    state,
    showStudioScenesReview: () => shown.push(state.studioScenesProposal.drafts.map(item => item.prompt)),
    rememberStudioScenesReview: () => {},
    window:{flushStudioDirectorStoryEdits: () => Promise.resolve()},
    requestJson: () => Promise.resolve({story:{id:'project',title:'Project',sceneOrder:[],scenes:{}}}),
    studioActionStatus: () => {}
  };
  const review = method(director,
    '    reviewAuthoredScenes: function (launch) {',
    '\n    writeNewScene: function', 'reviewAuthoredScenes', bindings);
  const pending = method(director,
    '    reviewPendingScenes: function (projectId, sourceMessageIndex) {',
    '\n    reviewAuthoredScenes: function', 'reviewPendingScenes', bindings);
  return {state,shown,review,pending};
}

test('authored review belongs to the clicked reply even within the same Project', async () => {
  const {state,shown,review,pending} = authoredFixture();
  const a = {projectId:'project',sourceMessageIndex:4,scenes:[{title:'First',prompt:'First prompt'}]};
  const b = {projectId:'project',sourceMessageIndex:6,scenes:[{title:'Second',prompt:'Second prompt'}]};
  await review(a);
  await review(b);
  assert.deepEqual(shown, [['First prompt'],['Second prompt']]);
  assert.equal(state.studioScenesReviewsByResponse[4].drafts[0].prompt,'First prompt');
  state.studioScenesProposal.drafts[0].prompt = 'Second prompt, edited';
  await review(a);
  await pending('project',6);
  assert.equal(state.studioScenesProposal.drafts[0].prompt,'Second prompt, edited');
  await assert.rejects(review({...b,scenes:[{title:'Second',prompt:'Different returned material'}]}),
    /no longer matches/);
  assert.equal(state.studioScenesProposal.drafts[0].prompt,'Second prompt, edited');
  await assert.rejects(pending('project',999), /no longer available/);
});

test('different Project and independent review do not overwrite existing work', async () => {
  const {state,review} = authoredFixture();
  state.studioScenesProposal = {storyId:'project',drafts:[{title:'Unrelated',prompt:'Keep me'}]};
  await assert.rejects(review({projectId:'project',sourceMessageIndex:10,
    scenes:[{prompt:'New reply'}]}), /independent Scene review/);
  assert.equal(state.studioScenesProposal.drafts[0].prompt,'Keep me');
});

test('saved field cleanup preserves unmatched unsaved fields', () => {
  const from = director.indexOf('  function forgetSavedStudioSceneFields(');
  const to = director.indexOf('\n  window.studioDirectorBridge = {',from);
  assert.ok(from >= 0 && to > from);
  const state = {studioWorkingDraft:{scenes:{scene1:{prompt:'Saved prompt',title:'Still unsaved'}}}};
  let recorded = 0;
  const clear = new Function('state','scheduleSessionSave',
    director.slice(from,to) + '\nreturn forgetSavedStudioSceneFields;')(state,()=>recorded++);
  clear('project','scene1',{prompt:'Saved prompt',title:'Old title'});
  assert.deepEqual(state.studioWorkingDraft.scenes.scene1,{title:'Still unsaved'});
  clear('project','scene1',{title:'Still unsaved'});
  assert.equal(state.studioWorkingDraft.scenes.scene1,undefined);
  assert.equal(recorded,2);
});

test('batch revisions distinguish saved, unsaved, unchanged and reporting failures', async () => {
  const from = workbench.indexOf('          function next(i) {',workbench.indexOf('function presentAction('));
  const to = workbench.indexOf('\n          return next(0);',from);
  assert.ok(from >= 0 && to > from);
  const code = workbench.slice(from,to) + '\nreturn next;';
  const ids = ['one','two','three'];
  const saved = [],unchanged = [],review = [],failed = [],notAttempted = [],reportingErrors = [];
  const reports = [],finished = [];
  const frozen = {instruction:'Revise',request:'Revise'};
  const values = [{scene:{},story:{}},{review:true},null];
  const next = new Function('window','ids','story','frozen','fields','projectId',
    'completed','unchanged','review','failed','notAttempted','reportingErrors',
    'status','showConversationWrite','finishSceneAction',code)(
    {studioDirectorBridge:{writeSelectedScene:()=>Promise.resolve(values.shift())}},
    ids,{id:'project',sceneOrder:ids},frozen,['prompt'],'project',
    saved,unchanged,review,failed,notAttempted,reportingErrors,
    message=>reports.push(message),()=>{},value=>finished.push(value));
  await next(0);
  assert.deepEqual(saved,['one']);
  assert.deepEqual(review,['two']);
  assert.deepEqual(unchanged,['three']);
  assert.deepEqual(failed,[]);
  assert.match(reports.at(-1),/Drafts needing review 1 \(Scene 2\)/);
  assert.deepEqual(finished,[false]);
});
