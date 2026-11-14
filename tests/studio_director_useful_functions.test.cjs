const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'tool/tool.html'), 'utf8');
const rail = fs.readFileSync(path.join(root, 'tool/js/studio_director_workbench.js'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'tool/js/director_chat.js'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'tool/server/studio_director.py'), 'utf8');

test('Write exposes exactly three creative workflows', () => {
  const choices = html.split('id="studio-dw-write-operation">')[1].split('</select>')[0];
  assert.deepEqual([...choices.matchAll(/<option value="([^"]+)"/g)].map(x => x[1]),
    ['new-project', 'project', 'scene-write']);
  assert.match(html, /id="studio-dw-scene-mode"/);
  assert.match(html, /value="create">Add one or more Scenes/);
  assert.match(html, /value="revise">Revise one or more existing Scenes/);
  assert.doesNotMatch(choices, /scene-split|scene-move|scene-duplicate|scene-invariants|playbook/);
});

test('one Scenes entrypoint delegates to existing reviewed one-or-many operations', () => {
  assert.match(rail, /if \(operation === 'scene-write'\) \{/);
  assert.match(rail, /el\('studio-dw-scene-mode'\)\.value === 'revise'\) return prepareBatchScenes\(id\)/);
  assert.match(rail, /bridge\.prepareWrite\('scenes', id, selected && storyName\(selected\)\)/);
  assert.match(rail, /function prepareBatchScenes\(storyId\)/);
  assert.match(rail, /function applyBatchScenes\(\)/);
  assert.match(chat, /if \(kind === 'scenes'\) return prepareStudioScenes\(\)/);
});

test('Read and the optional coherence utility stay separate from creative Write', () => {
  assert.match(html, /id="studio-dw-read-panel"/);
  assert.match(html, /id="studio-dw-coherence-check"/);
  assert.doesNotMatch(html, /id="studio-dw-playbook-open"/);
  assert.match(rail, /el\('studio-dw-coherence-check'\)\.onclick/);
  assert.match(backend, /\(\["scenes"\], \["title", "summary", "prompt"\]\)/);
  assert.doesNotMatch(chat, /suggest coherence-check/);
});

test('ordinary replies prioritize short exchanges rather than full assessments', () => {
  assert.match(chat, /Usually checks=\[\], readHints=\[\]/);
  assert.match(chat, /Use null for discussion, questions, outlines/);
  assert.match(backend, /normally 1-3 sentences in one short paragraph/);
});
