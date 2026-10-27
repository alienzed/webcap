'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('tool/js/qa_workbench.js', 'utf8');
const start = source.indexOf('  function qaBuildHealth(items) {');
const end = source.indexOf('  function qaFindingActionRank(', start);
assert.ok(start >= 0 && end > start, 'QA health logic must remain available');

test('removing the sidebar Incomplete filter keeps QA requirement-health detection', () => {
  const progress = {
    complete: {total: 2, completed: 2},
    missing: {total: 2, completed: 1},
    empty: {total: 0, completed: 0}
  };
  const called = [];
  const context = {
    state: {reviewedSet: new Set(['complete', 'missing'])},
    computeRequirementProgressForMediaKey: key => {
      called.push(key);
      return progress[key];
    },
    mediaItemHasTagMismatch: item => item.key === 'missing',
    hasSupportedAspectBucket: aspect => aspect !== '2:1'
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + '\nthis.buildHealth = qaBuildHealth;', context);

  const health = context.buildHealth([
    {key: 'complete', fileName: 'complete.jpg', hasCaption: true, metadata: {aspect: '1:1'}},
    {key: 'missing', fileName: 'missing.jpg', hasCaption: true, metadata: {aspect: '2:1'}},
    {key: 'empty', fileName: 'empty.jpg', hasCaption: false, metadata: {}}
  ]);
  assert.deepEqual(Array.from(health.incomplete), ['missing.jpg']);
  assert.deepEqual(Array.from(health.captionless), ['empty.jpg']);
  assert.deepEqual(Array.from(health.unreviewed), ['empty.jpg']);
  assert.deepEqual(Array.from(health.mismatch), ['missing.jpg']);
  assert.deepEqual(Array.from(health.invalidAr), ['missing.jpg']);
  assert.deepEqual(called, ['complete', 'missing', 'empty'],
    'QA computes its existing progress once per item without referencing the removed sidebar filter');
});
