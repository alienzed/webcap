const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const workbench = fs.readFileSync(path.join(root, 'tool/js/studio_director_workbench.js'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'tool/js/director_chat.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'tool/tool.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'tool/server/app.py'), 'utf8');
const runner = fs.readFileSync(path.join(root, 'tool/server/llm_runner.py'), 'utf8');

function section(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
}

test('coherence is an explicit Studio Director operation, not a separate automatic chat executor', () => {
  assert.match(html, /value="coherence-check">Check Project coherence/);
  assert.match(chat, /checkProjectCoherence: function \(storyId\)/);
  assert.match(chat, /operation:'check_coherence_sequence',model:state.modelId/);
  assert.match(chat, /For a user-requested Project-wide coherence check, suggest coherence-check/);
  assert.match(workbench, /if \(operation === 'coherence-check'\)/);
  assert.match(server, /if operation == "check_coherence_sequence":/);
  assert.match(runner, /context.get\("operation"\) == "check_coherence_sequence"/);
});

test('coherence results enter existing batch review and atomic saved-field Apply', () => {
  const code = section(workbench, '  function prepareProjectCoherence(storyId) {', '  function prepareBatchScenes(storyId) {');
  assert.match(code, /window.flushStudioDirectorStoryEdits\(storyId\)/);
  assert.match(code, /fresh.updatedAt !== originalStory.updatedAt/);
  assert.match(code, /result.scenes.length !== ids.length/);
  assert.match(code, /entry.originalPrompt !== originalStory.scenes\[entry.sceneId\].prompt/);
  assert.match(code, /fields:\['prompt'\]/);
  assert.match(code, /renderBatchReview\(\)/);
  assert.doesNotMatch(code, /apply_coherence|scene-fields-batch|generateFreshTakes/);
  const apply = section(workbench, '  function applyBatchScenes() {', '  function prepareStructure(operation, storyId) {');
  assert.match(apply, /\/fs\/studio\/director\/scene-fields-batch/);
  assert.match(apply, /expected:expected,changes:changes/);
  assert.match(apply, /recordApplied\('scene.batch.update'/);
});
