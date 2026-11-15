// Run with: node --test tests/studio_scene_revision_contract.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const file = path.join(__dirname, '../tool/js/studio_director_workbench.js');
const source = fs.readFileSync(file, 'utf8');
const marker = '})();';
assert.ok(source.trimEnd().endsWith(marker));
const instrumented = source.slice(0, source.lastIndexOf(marker)) +
  'globalThis.validateForTest = validateSceneRevisionDraft;\n' + marker;
const context = {window: {}, document: {readyState: 'loading', addEventListener() {}}};
vm.runInNewContext(instrumented, context, {filename: file});
const validate = context.validateForTest;
const one = [{sceneId:'scene-1',title:'Before',prompt:'Old prompt'}];
const two = [...one,{sceneId:'scene-2',title:'Next',prompt:'Next prompt'}];
const own = x => JSON.parse(JSON.stringify(x));
const draft = (scenes,ids=['scene-1'],saved=one) =>
  own(validate({scenes},ids,saved,JSON.stringify({scenes})));

test('prompt-only revision is a complete Scene-writing outcome',()=>{
  const rows=draft([{sceneId:'scene-1',prompt:'Full replacement H3 prompt'}]);
  assert.deepEqual(rows[0].draft,{sceneId:'scene-1',prompt:'Full replacement H3 prompt'});
  assert.equal(rows[0].before.title,'Before');
});
test('title and prompt may change together',()=>{
  assert.deepEqual(draft([{sceneId:'scene-1',title:'New title',prompt:'New prompt'}])[0].draft,
    {sceneId:'scene-1',title:'New title',prompt:'New prompt'});
});
test('multiple Scenes produce only actual changed fields',()=>{
  const rows=draft([{sceneId:'scene-1',prompt:'New prompt'},{sceneId:'scene-2',title:'Better title'}],
    ['scene-1','scene-2'],two);
  assert.deepEqual(rows.map(x=>x.draft),
    [{sceneId:'scene-1',prompt:'New prompt'},{sceneId:'scene-2',title:'Better title'}]);
});
test('unchanged values produce no proposal',()=>{
  assert.deepEqual(draft([{sceneId:'scene-1',prompt:'Old prompt'}]),[]);
  assert.deepEqual(draft([{sceneId:'scene-1'}]),[]);
});
test('unsupported fields never become applied changes',()=>{
  assert.deepEqual(draft([{sceneId:'scene-1',summary:'An updated outline'}]),[]);
  assert.deepEqual(draft([{sceneId:'scene-1',intent:'An updated intent'}]),[]);
});
test('invalid fields do not discard independent valid Scene changes',()=>{
  for(const value of [null,12,'','  '])
    assert.deepEqual(draft([{sceneId:'scene-1',prompt:value}]),[]);
  assert.deepEqual(draft([]),[]);
  assert.deepEqual(draft([{sceneId:'unknown'}]),[]);
  assert.deepEqual(draft([{sceneId:'scene-1'},{sceneId:'scene-1'}],['scene-1','scene-2'],two),[]);
  assert.deepEqual(draft([null]),[]);
  const rows=draft([
    {sceneId:'scene-1',prompt:'A complete new prompt',intent:'unsupported'},
    {sceneId:'scene-2',title:'Next',prompt:''},
    {sceneId:'unknown',prompt:'Ignored'},
    null
  ],['scene-1','scene-2'],two);
  assert.deepEqual(rows.map(x=>x.draft),[{sceneId:'scene-1',prompt:'A complete new prompt'}]);
  assert.throws(()=>validate({},['scene-1'],one,'raw'),/no Scene revisions/);
});
