const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'tool', 'tool.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'tool', 'js', 'storyboard.js'), 'utf8');

test('Studio Scene count uses one editable input and no Auto toggle', () => {
  assert.match(html, /id="storyboard-story-target-scenes"[^>]*placeholder="Auto"/);
  assert.doesNotMatch(html, /id="storyboard-scene-count-auto"/);
  assert.doesNotMatch(js, /storyboard-scene-count-auto/);
  assert.doesNotMatch(js, /targetScenesInput\.disabled\s*=\s*autoSceneCount/);
});

test('Studio serializes blank Scene count as Auto and an entered number as explicit', () => {
  const source = js.match(/targetSceneCount:\s*(targetScenesValue === '' \? null : targetScenesValue)/);
  assert.ok(source, 'Expected payload Scene count to depend directly on the input value');
  const fromInput = new Function('targetScenesValue', 'return ' + source[1] + ';');
  assert.equal(fromInput(''), null);
  assert.equal(fromInput('9'), '9');
  assert.match(js, /targetSceneCount == null \? '' : targetSceneCount/);
});
