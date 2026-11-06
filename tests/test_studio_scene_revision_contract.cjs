// Run with: node --test tests/test_studio_scene_revision_contract.cjs
// Exercises the real browser-side validator without starting WebCap or an LLM.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const file = path.join(__dirname, '../tool/js/studio_director_workbench.js');
const source = fs.readFileSync(file, 'utf8');
const marker = '})();';
assert.ok(source.trimEnd().endsWith(marker), 'Expected workbench IIFE');
const instrumented = source.slice(0, source.lastIndexOf(marker)) +
  'globalThis.validateForTest = validateSceneRevisionDraft;\n' + marker;
const context = {window: {}, document: {readyState: 'loading', addEventListener() {}}};
vm.runInNewContext(instrumented, context, {filename: file});
const validate = context.validateForTest;

const one = [{sceneId:'scene-1', title:'Before', summary:'Old intent', prompt:'Old prompt'}];
const two = [...one, {sceneId:'scene-2', title:'Next', summary:'Next intent', prompt:'Next prompt'}];
const own = x => JSON.parse(JSON.stringify(x));
const draft = (scenes, ids = ['scene-1'], saved = one) =>
  own(validate({scenes}, ids, saved, JSON.stringify({scenes})));

test('one Scene, one changed field; untouched fields remain absent from changes', () => {
  const rows = draft([{sceneId:'scene-1', summary:'New intent'}]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].draft, {sceneId:'scene-1', summary:'New intent'});
  assert.equal(rows[0].before.prompt, 'Old prompt');
  assert.equal(rows[0].before.title, 'Before');
});
test('one Scene, several changed fields', () => {
  assert.deepEqual(draft([{sceneId:'scene-1', summary:'New intent', prompt:'New prompt'}])[0].draft,
    {sceneId:'scene-1', summary:'New intent', prompt:'New prompt'});
});
test('multi-Scene batch with distinct changed fields', () => {
  const rows = draft([{sceneId:'scene-1', prompt:'New prompt'},
    {sceneId:'scene-2', title:'Better title'}], ['scene-1','scene-2'], two);
  assert.deepEqual(rows.map(x=>x.draft),
    [{sceneId:'scene-1', prompt:'New prompt'}, {sceneId:'scene-2', title:'Better title'}]);
});
test('identical values and no-op Scenes generate no proposed edits', () => {
  assert.deepEqual(draft([{sceneId:'scene-1', summary:'Old intent'}]), []);
  assert.deepEqual(draft([{sceneId:'scene-1'}]), []);
  assert.deepEqual(draft([{sceneId:'scene-1'}, {sceneId:'scene-2', prompt:'Different'}],
    ['scene-1','scene-2'], two).map(x=>x.sceneId), ['scene-2']);
});
test('rejects missing, extra, duplicate, and unknown Scene IDs', () => {
  assert.throws(() => draft([], ['scene-1'], one), /expected 1/);
  assert.throws(() => draft([{sceneId:'scene-1'}, {sceneId:'scene-1'}], ['scene-1','scene-2'], two),
    /duplicate, or unknown Scene ID/);
  assert.throws(() => draft([{sceneId:'unknown'}]), /unknown Scene ID/);
  assert.throws(() => draft([{sceneId:'scene-1'}, {sceneId:'scene-2'}]), /expected 1/);
});
test('rejects unsupported keys and invalid values with raw diagnostics', () => {
  for (const value of [null, 12, '', '  ']) {
    assert.throws(() => draft([{sceneId:'scene-1', summary:value}]), /invalid Scene field "summary"/);
  }
  assert.throws(() => draft([{sceneId:'scene-1', intent:'Wrong key'}]), /invalid Scene field "intent"/);
  assert.throws(() => draft([null]), /not an object/);
  assert.throws(() => draft([{sceneId:'scene-1', prompt:null}]), /Raw Director response:/);
});
