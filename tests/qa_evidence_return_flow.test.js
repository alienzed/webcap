// Run with: node tests/qa_evidence_return_flow.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../tool/js/qa_workbench.js'), 'utf8');
function section(begin, end) {
  const a = source.indexOf(begin);
  const b = source.indexOf(end, a + begin.length);
  assert.ok(a !== -1 && b > a, 'Expected QA function section: ' + begin);
  return source.slice(a, b);
}
const scopeFunction = section('function qaGetTrainingFileNames() {', 'function qaGetTrainingItems() {');
function selection(focus, parent, saved) {
  const context = {
    state: { focusSet: focus },
    qaWorkbenchState: { parentFocusSet: parent, returnTrainingFiles: saved },
    getVisibleMediaSelectionForTraining: () => ['temporary.jpg']
  };
  vm.runInNewContext(scopeFunction + '\nthis.readSelection = qaGetTrainingFileNames;', context);
  return Array.from(context.readSelection());
}
assert.deepEqual(selection(null, undefined, null), ['temporary.jpg']);
assert.deepEqual(selection({ reportType: 'qa' }, null, ['a.jpg', 'b.jpg']), ['a.jpg', 'b.jpg'],
  'QA evidence focus must not replace the review scope');
assert.deepEqual(selection({ reportType: 'review' }, null, ['a.jpg']), ['temporary.jpg'],
  'Non-QA focus sets retain their normal selection behavior');
assert.deepEqual(selection({ reportType: 'qa' }, undefined, ['a.jpg']), ['temporary.jpg'],
  'No saved QA return context means a genuine QA scope change');

const handleSource = section('function qaHandleAction(action, value) {', 'function wireQaWorkbench()');
const review = [{ id: 'first', files: ['a.jpg'] }, { id: 'second', files: ['b.jpg'] }];
const visited = [];
const context = {
  qaWorkbenchState: { browseIndex: 1, view: 'browse', dispositions: {} },
  qaGetRecommendations: () => review,
  qaSelectFiles: (...args) => visited.push(args)
};
vm.runInNewContext(handleSource + '\nthis.handle = qaHandleAction;', context);
context.handle('inspect-file', 'b.jpg');
assert.deepEqual(Array.from(visited[0]), [['b.jpg'], 'QA · Evidence', 'second'],
  'Evidence preview must remember its originating recommendation');
console.log('qa_evidence_return_flow: all assertions passed');
