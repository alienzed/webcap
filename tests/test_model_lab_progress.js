// Model Assessment progress snapshot contract. No DOM or network required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const scope = vm.createContext({});
const source = fs.readFileSync('tool/js/model_lab.js', 'utf8');
assert.match(source, /initializeModelLab\(\);\s*$/);
// Exercise production functions without running browser-only event wiring.
vm.runInContext(source.replace(/initializeModelLab\(\);\s*$/, ''), scope);

const running = {
  id: 'assessment-1', status: 'running',
  startedAt: '2026-10-20T19:00:00Z', finishedAt: '',
  allDirectorModels: [{modelRef: 'local::director.gguf', label: 'Example Director'}],
  allVisionModels: [],
  progress: {
    phase: 'retry', currentModelRef: 'local::director.gguf',
    currentKind: 'director_scene_plan_2048', executionStatus: 'queued'
  },
  attempts: [{
    modelRef: 'local::director.gguf', role: 'director',
    kind: 'director_scene_plan_2048', status: 'running', file: '', jobId: 'job-1'
  }],
  work: {
    planned: 12, completed: 5, resolved: 7, remaining: 5,
    reused: 3, skipped: 2, deferred: 1, failed: 0, running: 1
  }
};

const snapshot = scope.modelLabProgressSnapshot(running);
assert.equal(snapshot.progress.completed, 7);
assert.equal(snapshot.progress.total, 12);
assert.match(snapshot.phase, /Retry.*Storyboard JSON.*Queued/);
assert.equal(snapshot.detail, 'Example Director');
assert.match(snapshot.progressLabel, /5\/12 completed/);
assert.match(snapshot.progressLabel, /5 remaining/);
assert.match(snapshot.progressLabel, /3 reused/);
assert.match(snapshot.progressLabel, /2 skipped/);
assert.match(snapshot.progressLabel, /1 retry pending/);
assert.equal(snapshot.childJobId, 'job-1');
assert.equal(snapshot.startedAt, Date.parse(running.startedAt) / 1000);

const terminal = scope.modelLabProgressSnapshot({
  ...running, status: 'completed', finishedAt: '2026-10-20T19:12:00Z',
  attempts: [], work: {...running.work, completed: 8, resolved: 12, remaining: 0,
    skipped: 2, failed: 2, deferred: 0, running: 0}
});
assert.equal(terminal.progress.completed, 12);
assert.equal(terminal.progress.total, 12);
assert.match(terminal.progressLabel, /8\/12 completed/);
assert.match(terminal.progressLabel, /2 failed/);

const historical = scope.modelLabProgressSnapshot({
  ...running, work: undefined, attempts: [], status: 'interrupted',
  progress: {}, summary: {completed: 3, interrupted: 1}
});
assert.equal(historical.progress, null);
assert.match(historical.progressLabel, /3 completed/);
assert.equal(historical.phase, 'Interrupted');
