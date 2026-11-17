'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const director=fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
const spec=fs.readFileSync(path.join(__dirname,'../docs/studio-director-contract.md'),'utf8');
function part(a,b){
  const start=director.indexOf(a),end=director.indexOf(b,start+a.length);
  assert.ok(start>=0&&end>start,'Missing real function boundaries: '+a);
  return director.slice(start,end);
}
test('Chat and selected Write destinations never silently change conversation attachment',()=>{
  for(const section of [
    part('  function sendMessage() {','  function syncPinnedUi() {'),
    part('    selectWriteProject: function (','    prepareWrite: function ('),
    part('  window.openStudioDirectorScene = function (','  window.closeStudioDirectorOnExit')
  ]) assert.doesNotMatch(section,/state\.studioStoryAccess\s*=/);
  assert.match(spec,/Navigation, deliberate conversation attachment/);
});

test('focused Overview Write uses the explicitly supplied destination ID',()=>{
  const body=part('  function prepareStudioBrief(options) {',
    '  function startStudioWorkshop() {');
  assert.match(body,/options && options\.storyId/);
  assert.match(body,/encodeURIComponent\(storyId\)/);
  assert.doesNotMatch(body,/studioBriefProposal|showStudioBriefReview/);
});

test('creating a Project does not replace approved Read sources',()=>{
  const body=part('  function commitFocusedStudioProject(proposal) {',
    '  function prepareStudioProject(options) {');
  assert.doesNotMatch(body,/state\.studioApprovedRead\s*=/);
  assert.match(body,/recordApplied\('project.create'/);
});

test('explicit Scene entry can target B while Director remains attached to A',()=>{
  const section=part('  function studioDirectorSelectedScene(', '  function ');
  const state={studioStoryAccess:{storyId:'A'},sceneRead:null};
  const window={getStudioDirectorNavigation:()=>({projectId:'B',sceneId:'scene-b',sceneNumber:2})};
  const selected=new Function('state','window',section+'return studioDirectorSelectedScene;')(state,window);
  assert.equal(selected(window.getStudioDirectorNavigation(),'write a scene',false),null,
    'Passive navigation must not override the explicit A attachment');
  state.sceneRead={projectId:'B',sceneId:'scene-b',sceneNumber:2,label:'Scene 2'};
  assert.equal(selected(window.getStudioDirectorNavigation(),'write a scene',false).sceneId,'scene-b',
    'An explicitly opened Scene B must be usable without reattaching Director');
  assert.equal(state.studioStoryAccess.storyId,'A');
});

test('New versus existing Project is chosen by the Write operation UI',()=>{
  const rail=fs.readFileSync(path.join(__dirname,'../tool/js/studio_director_workbench.js'),'utf8');
  assert.match(rail,/if \(operation !== 'new-project' && operation !== 'project'\)/);
  assert.match(rail,/bridge\.prepareWrite\(operation,\s*id/);
  assert.doesNotMatch(rail,/function presentAction\(/);
});

test('a fresh Project Write performs a new focused model request without cached drafts',()=>{
  const body=part('  function prepareStudioProject(options) {',
    '  function parseStudioBriefDraft(raw) {');
  assert.match(body,/operation:'studio_project_draft'/);
  assert.doesNotMatch(body,/studioWorkingDraft|state\.studioProjectProposal/);
  assert.match(body,/commitFocusedStudioProject\(proposal\)/);
});
