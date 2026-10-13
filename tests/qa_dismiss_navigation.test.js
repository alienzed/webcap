// Run with: node tests/qa_dismiss_navigation.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../tool/js/qa_workbench.js'), 'utf8');
const start = source.indexOf('  function qaHandleAction(action, value) {');
const end = source.indexOf('\n  function wireQaWorkbench()', start);
assert.ok(start !== -1 && end > start, 'QA action handler must exist');

function dismiss(ids, currentIndex, alreadyDismissed = {}) {
  const recommendations = ids.map(id => ({ id }));
  const qaWorkbenchState = {
    browseIndex: currentIndex,
    view: 'browse',
    dispositions: { ...alreadyDismissed },
    statusMessage: 'Old status',
  };
  let saves = 0;
  let renders = 0;
  const context = {
    qaWorkbenchState,
    qaGetRecommendations: () => recommendations,
    qaGetUndisposedRecommendationIndexes: () => recommendations
      .map((finding, index) => qaWorkbenchState.dispositions[finding.id] ? -1 : index)
      .filter(index => index !== -1),
    qaSaveReview: () => { saves++; },
    renderQaWorkbench: () => { renders++; },
  };
  vm.runInNewContext(source.slice(start, end) + '\nthis.handle = qaHandleAction;', context);
  context.handle('dispose', 'keep');
  assert.equal(saves, 1, 'Disposition is saved');
  assert.equal(renders, 1, 'Exactly one render');
  assert.equal(qaWorkbenchState.dispositions[ids[currentIndex]], 'keep');
  assert.equal(qaWorkbenchState.statusMessage, '');
  return qaWorkbenchState;
}

let state = dismiss(['a', 'b', 'c'], 0);
assert.equal(state.browseIndex, 1);
assert.equal(state.view, 'browse');

state = dismiss(['a', 'b', 'c', 'd'], 0, { b: 'keep' });
assert.equal(state.browseIndex, 2, 'Skip previously dismissed recommendations');

state = dismiss(['a', 'b', 'c'], 2, { b: 'keep' });
assert.equal(state.browseIndex, 0, 'Wrap to an earlier undismissed recommendation');

state = dismiss(['a', 'b', 'c'], 2, { a: 'keep', b: 'keep' });
assert.equal(state.view, 'overview', 'Last dismissal completes review');

console.log('qa_dismiss_navigation: all assertions passed');
