'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('tool/js/training_runner_ui.js', 'utf8');
const css = fs.readFileSync('tool/css/workbench.css', 'utf8');
const start = source.indexOf('function buildTrainingQueueHtml(');
const end = source.indexOf('function buildTrainingRunnerProgressHtml(', start);
assert.ok(start >= 0 && end > start, 'Queued training renderer must exist');

test('queued epochs editor uses a compact clock and pencil while retaining its action and epoch count', () => {
  const context = {
    trainingWorkspaceState: {runnerQueueCollapsed: false, runnerSelectedJobId: ''},
    trainingJobLabel: () => 'H3',
    trainingH3ImageModelLabel: () => '',
    trainingPlannedStepCount: () => 0,
    trainingPlannedEpochCount: job => job.epochs,
    formatTrainingJobSettings: () => '',
    trainingOutputIdentity: () => '',
    buildQueuedResumePointHtml: () => '',
    trainingRunnerStatusLabel: status => status,
    escapeHtml: value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;'),
  };
  vm.runInNewContext(source.slice(start, end) + '\nthis.renderQueue = buildTrainingQueueHtml;', context);
  const html = context.renderQueue([{id: 'queue-1', status: 'queued', folder: 'sets/demo', epochs: 100}]);
  const button = html.match(/<button[^>]*data-training-edit-epochs="queue-1"[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(button, 'existing queued-epoch edit action remains wired');
  assert.match(button[0], /title="Change target epochs \(currently 100\) before this run starts"/);
  assert.match(button[0], /aria-label="Change target epochs \(currently 100\)"/);
  assert.equal((button[1].match(/<svg /g) || []).length, 2, 'one clock and one pencil');
  assert.match(button[1], /<circle cx="12" cy="12" r="9"/);
  assert.match(button[1], /<path d="M12 20h9"/);
  assert.doesNotMatch(button[1], /100 epochs/);
  assert.match(css, /\.training-runner-queue-epochs\s*\{[^}]*min-width:\s*44px/);
});
