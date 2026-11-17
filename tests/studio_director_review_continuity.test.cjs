'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const chat=fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
const workbench=fs.readFileSync(path.join(__dirname,'../tool/js/studio_director_workbench.js'),'utf8');

function part(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'Missing production section: '+start);
  return source.slice(a,b);
}

test('historical chat action metadata cannot reopen retired Project or Scene Review',()=>{
  const operations=part(chat,'  function renderStudioOperations() {',
    '  function recordStudioOperation(');
  assert.doesNotMatch(operations,/presentAction\(|showStudioProjectReview\(|showStudioBriefReview\(|showStudioScenesReview\(/);
  const send=part(chat,'  function sendMessage() {','  function syncPinnedUi() {');
  assert.doesNotMatch(send,/presentAction\(|studioAuthoredWriteActions\(/);
});

test('explicit Project creation and revision never defer a successful Write to Review',()=>{
  const create=part(chat,'  function prepareStudioProject(options) {',
    '  // The reviewed Project is saved before any Scene authoring.');
  const revise=part(chat,'  function prepareStudioBrief(options) {',
    '  function applyStudioBrief() {');
  assert.match(create,/\/fs\/studio\/director\/project-create/);
  assert.match(revise,/\/fs\/studio\/director\/brief/);
  assert.doesNotMatch(create,/showStudioProjectReview\(|showStudioBriefReview\(/);
  assert.doesNotMatch(revise,/showStudioBriefReview\(/);
  assert.match(create,/recordApplied\('project.create'/);
  assert.match(revise,/recordApplied\('brief.apply'/);
});

test('a Scene Write uses fresh saved values, direct Save and an inspectable raw model response',()=>{
  const writer=part(chat,'    writeSelectedScene: function (launch) {',
    '    makeProposal: function');
  assert.match(writer,/requestJson\('\/fs\/storyboard\?story='/);
  assert.match(writer,/state\.lastStudioIoRaw = raw/);
  assert.match(writer,/applyScenePrompt\(story, sceneId, prompt, extras\)/);
  assert.match(writer,/state\.lastStudioIoError/);
  assert.doesNotMatch(writer,/showSceneReview|showStudioScenesReview/);
  assert.match(workbench,/applyScenePrompt: function \(story, sceneId, prompt, extraChanges\)/);
});
