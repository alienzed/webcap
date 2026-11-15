const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'tool', 'js', 'storyboard.js'), 'utf8');

function body(name, nextName) {
  const start = source.indexOf('  function ' + name + '(');
  const end = source.indexOf('  function ' + nextName + '(', start);
  assert.ok(start >= 0 && end > start, name + ' function boundary should remain available');
  return source.slice(start, end);
}

test('autosave reconciles Scene navigation only when membership or ordering changes', () => {
  const adopt = body('adoptAutosavedStory', 'saveStoryNow');
  assert.match(adopt, /previousOrder\.length !== nextOrder\.length/);
  assert.match(adopt, /sceneId !== nextOrder\[index\]/);
  assert.match(adopt, /if \(structureChanged\) \{\s*renderScenes\(\);\s*renderStoryReadiness\(\);/);
  assert.match(adopt, /else \{\s*nextOrder\.forEach\(syncSceneProgressionCard\)/);
  assert.match(body('saveStoryNow', 'scheduleStorySave'), /adoptAutosavedStory\(payload\.story\)/);
  assert.match(body('saveSceneNow', 'scheduleSceneSave'), /adoptAutosavedStory\(payload\.story\)/);
});

test('Take queue changes refresh visible cards, progression and readiness', () => {
  const sync = body('syncSceneTakeDom', 'applyTakeMutation');
  assert.match(sync, /syncSceneProgressionCard\(sceneId\)/);
  assert.match(sync, /renderStoryReadiness\(\)/);
  assert.ok(sync.indexOf('syncSceneProgressionCard(sceneId)') < sync.indexOf('if (!root) return'));
  const refresh = body('refreshGenerationQueue', 'generationAction');
  assert.match(refresh, /jobs\.forEach\(function \(job\) \{ syncSceneTakeDom\(job\.sceneId\); \}\)/);
  const cancel = body('cancelStoryTakes', 'regenerateArchivedTake');
  assert.match(cancel, /sceneOrder \|\| \[\]\)\.forEach\(syncSceneTakeDom\)/);
  assert.match(body('enqueueSceneGeneration', 'cancelStoryTakes'), /syncSceneTakeDom\(sceneId\)/);
});
