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
test('Intent-only model output is rejected, never reported as a successful revision',()=>{
  assert.throws(()=>draft([{sceneId:'scene-1',summary:'An updated outline'}]),/invalid Scene field "summary"/);
  assert.throws(()=>draft([{sceneId:'scene-1',intent:'An updated intent'}]),/invalid Scene field "intent"/);
});
test('invalid prompts and Scene identities fail with raw model diagnostics',()=>{
  for(const value of [null,12,'','  '])
    assert.throws(()=>draft([{sceneId:'scene-1',prompt:value}]),/invalid Scene field "prompt"/);
  assert.throws(()=>draft([]),/expected 1/);
  assert.throws(()=>draft([{sceneId:'unknown'}]),/unknown Scene ID/);
  assert.throws(()=>draft([{sceneId:'scene-1'},{sceneId:'scene-1'}],['scene-1','scene-2'],two),/duplicate, or unknown Scene ID/);
  assert.throws(()=>draft([null]),/not an object/);
});
