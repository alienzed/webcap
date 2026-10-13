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
assert.deepEqual([Array.from(visited[0][0]), visited[0][1], visited[0][2]], [['b.jpg'], 'QA · Evidence', 'second'],
  'Evidence preview must remember its originating recommendation');

// Returning to QA must restore the previous focus and the browse view.
const returnSource = section('function returnToQaWorkbenchFromFocusSet() {', 'function qaHandleAction(action, value) {');
let renderCount = 0;
let currentFocus = { keys: ['temporary.jpg'], reportType: 'qa' };
const returnState = {
  parentFocusSet: { keys: ['prior.jpg'], source: 'Prior Focus', reportType: 'review' },
  returnTrainingFiles: ['prior.jpg'],
  returnFindingId: 'second',
  view: 'overview'
};
const returnContext = {
  qaWorkbenchState: returnState,
  state: { focusSet: currentFocus },
  qaCloneFocusSet: focus => focus ? { ...focus, keys: focus.keys.slice() } : null,
  updateFocusSetUi: () => {},
  renderFileList: () => {},
  ui: { filterEl: { value: '' } },
  pruneCandidatesScopeChanged: () => {},
  duplicateCandidatesScopeChanged: () => {},
  setWorkspaceWorkflowMode: () => {},
  setWorkspaceSurface: () => {},
  renderQaWorkbench: () => { renderCount += 1; }
};
vm.runInNewContext(returnSource + '\nthis.returnToQA = returnToQaWorkbenchFromFocusSet;', returnContext);
returnContext.returnToQA();
assert.deepEqual(Array.from(returnContext.state.focusSet.keys), ['prior.jpg']);
assert.equal(returnState.view, 'browse');
assert.equal(returnState.returnFindingId, 'second');
assert.equal(returnState.returnTrainingFiles, null);
assert.equal(renderCount, 1);

const renderSource = section('function qaRenderBrowse(container, items) {', 'function qaRenderReportFinding(container, finding) {');
assert.ok(renderSource.includes("hasNext ? 'Next recommendation' : 'Back to QA'"),
  'The last recommendation must have a useful primary exit action');
assert.ok(renderSource.includes("active.verdict === 'dismissed'"));
assert.ok(renderSource.includes("active.verdict === 'supported'"));
assert.ok(renderSource.includes("qaCreateButton('Dismiss & next', 'qa-primary', 'dispose', 'keep')"));
assert.ok(renderSource.includes("details.appendChild(why)"),
  'Explanations must remain available after the compact layout');
console.log('qa_evidence_return_flow: all assertions passed');
