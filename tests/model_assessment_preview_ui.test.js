const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function view() {
  const nodes = new Map();
  for (const id of ['diagnostics-assessment-selection', 'diagnostics-assessment-run', 'diagnostics-assessment-deep']) {
    nodes.set(id, {textContent: '', disabled: false, checked: false});
  }
  const labels = [{dataset: {assessmentWork: 'local::director.gguf'}, hidden: true, textContent: '', title: ''}];
  const ctx = vm.createContext({
    document: {
      getElementById: id => nodes.get(id),
      querySelectorAll: query => query.includes('[data-assessment-work]') ? labels : []
    },
    state: {folder: 'set'},
    modelLabCurrentFiles: () => ['a.jpg', 'b.jpg'],
    modelLabGroups: () => [{group: 'Viewpoint', terms: ['front']}],
    reportConsoleError() {}
  });
  const source = fs.readFileSync('tool/js/diagnostics.js', 'utf8')
    .replace(/wireDiagnosticsUi\(\);\s*$/, '');
  vm.runInContext(source, ctx);
  ctx.diagnosticsAssessmentCatalog.directors = [{
    id: 'local::director.gguf', modelId: 'director.gguf', runtimeId: 'local',
    runtimeName: 'Local', label: 'Director'
  }];
  ctx.diagnosticsAssessmentSelected.director.add('local::director.gguf');
  return {ctx, nodes, labels};
}

test('planned work is visible before starting without queuing any jobs', async () => {
  const {ctx, nodes, labels} = view();
  const calls = [];
  ctx.modelLabPost = async request => {
    calls.push(request);
    return {plan: {missing: 3, retry: 1, total: 4}, reused: 2,
      models: {'local::director.gguf': {planned: 6, complete: 2, missing: 3, retry: 1}}};
  };
  ctx.diagnosticsRefreshSelectionPlan();
  assert.equal(nodes.get('diagnostics-assessment-run').disabled, true);
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'preview');
  assert.equal(calls[0].config.depth, 'quick');
  assert.equal(calls[0].config.directorModels[0].modelRef, 'local::director.gguf');
  assert.equal(nodes.get('diagnostics-assessment-run').textContent, 'Complete 4 Tests');
  assert.equal(nodes.get('diagnostics-assessment-run').disabled, false);
  assert.match(nodes.get('diagnostics-assessment-selection').textContent, /2 already complete · 3 missing · 1 retry/);
  assert.equal(labels[0].textContent, '3 missing · 1 retry');
  ctx.diagnosticsRefreshSelectionPlan();
  assert.equal(calls.length, 1, 'no duplicate preview for unchanged selection');
});

test('all tests complete disables the action and changing depth replans', async () => {
  const {ctx, nodes, labels} = view();
  let calls = 0;
  ctx.modelLabPost = async () => {
    calls += 1;
    return {plan: {missing: 0, retry: 0, total: 0}, reused: 4,
      models: {'local::director.gguf': {planned: 4, complete: 4, missing: 0, retry: 0}}};
  };
  ctx.diagnosticsRefreshSelectionPlan();
  await Promise.resolve();
  assert.equal(nodes.get('diagnostics-assessment-run').textContent, 'Already Complete');
  assert.equal(nodes.get('diagnostics-assessment-run').disabled, true);
  assert.equal(labels[0].textContent, 'Tests complete');
  nodes.get('diagnostics-assessment-deep').checked = true;
  ctx.diagnosticsRefreshSelectionPlan();
  await Promise.resolve();
  assert.equal(calls, 2);
  ctx.diagnosticsAssessmentSelected.director.clear();
  ctx.diagnosticsRefreshSelectionPlan();
  assert.equal(calls, 2);
  assert.equal(labels[0].hidden, true);
});

test('late responses cannot overwrite a newer selection', async () => {
  const {ctx, nodes} = view();
  const responders = [];
  ctx.modelLabPost = () => new Promise(resolve => responders.push(resolve));
  ctx.diagnosticsRefreshSelectionPlan();
  nodes.get('diagnostics-assessment-deep').checked = true;
  ctx.diagnosticsRefreshSelectionPlan();
  responders[1]({plan: {missing: 1, retry: 0, total: 1}, reused: 0, models: {}});
  await Promise.resolve();
  responders[0]({plan: {missing: 0, retry: 0, total: 0}, reused: 4, models: {}});
  await Promise.resolve();
  assert.equal(nodes.get('diagnostics-assessment-run').textContent, 'Complete 1 Test');
  assert.equal(nodes.get('diagnostics-assessment-run').disabled, false);
});

test('server no-work response stays disabled after the start callback finishes', async () => {
  const {ctx, nodes} = view();
  ctx.modelLabPost = async () => ({noWork: true, run: {status: 'completed'}});
  ctx.refreshUnifiedModelAssessment = async () => {};
  await ctx.runUnifiedModelAssessment();
  assert.equal(nodes.get('diagnostics-assessment-run').textContent, 'Already Complete');
  assert.equal(nodes.get('diagnostics-assessment-run').disabled, true);
  assert.match(nodes.get('diagnostics-assessment-selection').textContent, /0 tests needed/);
});
