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
test('attachment changes only on explicit attach, detach or explicit continue after Project creation',()=>{
  for(const section of [
    part('  function sendMessage() {','  function '),
    part('    selectWriteProject: function (','    prepareWrite: function ('),
    part('    reviewCapture: function (','    reviewSceneCapture: function ('),
    part('    reviewSceneCapture: function (','    checkProjectCoherence: function ('),
    part('  window.openStudioDirectorScene = function (','  window.closeStudioDirectorOnExit')
  ]) assert.doesNotMatch(section,/state\.studioStoryAccess\s*=/,
    'A navigation, material review or target selection must not reattach conversation');
  assert.match(spec,/Four independent identities/);
});
test('targeted Project Review consumes its passed destination instead of requiring attachment',()=>{
  const body=part('  function prepareStudioBrief(options) {','  function applyStudioBrief() {');
  assert.match(body,/options\.storyId/);
  assert.match(body,/proposal\.storyId === storyId/);
  assert.match(director,/prepareStudioBrief\(Object\.assign/);
});

test('saving a Project never revokes previously approved cross-Project Read sources',()=>{
  const body=part('  function applyStudioProject() {','  function showStudioBriefReview() {');
  assert.doesNotMatch(body,/state\.studioApprovedRead\s*=\s*null/,
    'Approved sources are session references, not inherited from the saved destination');
});
