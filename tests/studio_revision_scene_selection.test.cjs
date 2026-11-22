'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const markup = fs.readFileSync(path.join(root, 'tool/tool.html'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'tool/js/director_chat.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'tool/css/workspace_shell.css'), 'utf8');

test('Revise Scenes targets use compact explicit All/None controls', () => {
  assert.match(markup, /id="director-studio-revision-select-all"/);
  assert.match(markup, /id="director-studio-revision-select-none"/);
  assert.match(markup, /id="director-studio-revision-selection-count"/);
  assert.doesNotMatch(markup, /id="director-studio-revision-all"/);
  assert.match(chat, /'director-studio-revision-select-' \+ choice/);
  assert.match(chat, /box.checked = choice === 'all'/);
});

test('Scene targets remain native keyboard-accessible checkboxes with stable IDs', () => {
  assert.match(chat, /checkbox.type = 'checkbox'/);
  assert.match(chat, /checkbox.value = sceneId/);
  assert.match(chat, /checkbox.className = 'director-studio-revision-scene'/);
  assert.match(chat, /sameProject = list.dataset.projectId/);
  assert.match(chat, /previousSelected.has\(sceneId\)/);
  assert.match(chat, /previousAll \|\| previousSelected/);
  assert.match(chat, /selected \+ ' of ' \+ boxes.length/);
  assert.match(css, /scene-chip:focus-within/);
  assert.match(css, /scene-chip:has\(input:checked\)/);
});

test('Empty selection still blocks revision and active jobs lock the picker', () => {
  assert.match(chat, /revisionPreset.value !== 'coherence' && !syncRevisionSceneSelection\(\).length/);
  assert.match(chat, /revisionBoxes.forEach\(function \(checkbox\) \{ checkbox.disabled = studioRevisionRunning; \}\)/);
  assert.match(chat, /studioRevisionRunning \|\| revisionSelected === 0/);
});
