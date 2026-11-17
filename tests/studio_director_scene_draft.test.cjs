'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const chat=fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
const bench=fs.readFileSync(path.join(__dirname,'../tool/js/studio_director_workbench.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../tool/tool.html'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../tool/css/workspace_shell.css'),'utf8');
function part(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'Missing production section: '+start);
  return source.slice(a,b);
}

test('Studio Write panel exposes operation, destination, optional instruction and direct Save controls',()=>{
  for(const id of ['studio-dw-write-project','studio-dw-write-operation',
    'studio-dw-write-instruction','studio-dw-write-prepare'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(css,/\.director-chat-drawer\.studio-director #studio-dw-write-panel \{/);
  assert.doesNotMatch(css,/#studio-dw-write-panel > :not\(label\):not\(#studio-dw-batch-controls\) \{display:none/);
  const write=part(bench,'  function writePrepare(options) {',
    '  function prepareProjectCoherence(');
  assert.match(write,/bridge\.writeNewScene\(/);
  assert.match(write,/bridge\.prepareWrite\(/);
  assert.doesNotMatch(write,/showStudioProjectReview|showStudioScenesReview/);
});

test('New Scene Write freezes the selected destination and fresh saved Scene order',()=>{
  const body=part(chat,'    writeNewScene: function (launch) {',
    '    writeSelectedScene: function');
  assert.match(body,/var storyId = launch\.projectId/);
  assert.match(body,/requestJson\('\/fs\/storyboard\?story='/);
  assert.match(body,/var order = story\.sceneOrder\.slice\(\)/);
  assert.match(body,/expectedSceneOrder:order/);
  assert.match(body,/\/fs\/studio\/director\/scenes-draft/);
});

test('new Scene Write saves each actually usable record without invented titles or duration',()=>{
  const body=part(chat,'    writeNewScene: function (launch) {',
    '    writeSelectedScene: function');
  assert.match(body,/var valid = drafts\.filter/);
  assert.match(body,/item\.title\.trim\(\) && item\.prompt\.trim\(\)/);
  assert.match(body,/Number\.isInteger\(Number\(item\.durationSeconds\)\)/);
  assert.doesNotMatch(body,/Scene ' \+ \(order\.length\+index\+1\)/);
  assert.doesNotMatch(body,/durationSeconds:6/);
  assert.match(body,/var omitted = drafts\.length-valid\.length/);
});

test('a failed Scene write exposes raw model content without implicit recovery',()=>{
  const body=part(chat,'    writeNewScene: function (launch) {',
    '    writeSelectedScene: function');
  assert.match(body,/state\.lastStudioIoRaw = raw/);
  assert.match(body,/state\.lastStudioIoError =/);
  assert.match(body,/Raw response/);
  assert.doesNotMatch(body,/autoRepair|retryModel|showStudioScenesReview/);
});

test('explicit Project creation persists only Project fields and never silently authors initial Scenes',()=>{
  const body=part(chat,'  function prepareStudioProject(options) {',
    '  // The reviewed Project is saved before any Scene authoring.');
  assert.match(body,/\/fs\/studio\/director\/project-create/);
  assert.match(body,/title:proposal\.title,concept:proposal\.concept/);
  assert.match(body,/style:proposal\.style,invariants:proposal\.invariants/);
  assert.doesNotMatch(body,/initialScenes|writeInitialProjectScenes|showStudioProjectReview/);
});

test('existing Scene revision applies selected fields with saved-original conflict checks',()=>{
  const body=part(bench,'    applyScenePrompt: function (story, sceneId, prompt, extraChanges) {',
    '    setStatus:status,');
  assert.match(body,/expected\.prompt = scene\.prompt/);
  assert.match(body,/expected\[key\] = scene\[key\]/);
  assert.match(body,/\/fs\/studio\/director\/scene-fields/);
  assert.match(body,/recordApplied\('scene\.director\.revision'/);
});
