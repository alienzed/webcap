const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function ui() {
  class Element {
    constructor() {
      this.children = []; this.attrs = {}; this.textContent = ''; this.style = {};
      const classes = new Set();
      this.classList = {add: k => classes.add(k), remove: k => classes.delete(k), contains: k => classes.has(k),
        toggle: (k, yes) => yes ? classes.add(k) : classes.delete(k)};
    }
    setAttribute(k, v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k]; }
    removeAttribute(k) { delete this.attrs[k]; }
    appendChild(node) { this.children.push(node); return node; }
    replaceChildren(...nodes) { this.children = nodes; }
    querySelectorAll() { return []; }
    querySelector(selector) {
      const attr = selector.slice(1, -1);
      for (const child of this.children) {
        if (attr in child.attrs) return child;
        const found = child.querySelector(selector); if (found) return found;
      }
      return null;
    }
  }
  const nodes = Object.fromEntries(['diagnostics-modal', 'diagnostics-assessment-activity', 'diagnostics-assessment-run',
    'diagnostics-assessment-deep', 'diagnostics-assessment-selection', 'diagnostics-assessment-summary', 'diagnostics-assessment-results']
    .map(id => [id, new Element()]));
  const snapshots = [], timers = [], finished = [], requests = [];
  const ctx = {document: {getElementById: id => nodes[id], createElement: () => new Element()}, Date, Set,
    publishActivityProgress: s => snapshots.push(s), finishActivityProgress: (...args) => finished.push(args),
    setTimeout: fn => {timers.push(fn); return timers.length;}, clearTimeout() {}, reportConsoleError() {}, reportConsoleInfo() {}};
  ctx.window = ctx;
  for (const file of ['progress_card', 'diagnostics', 'model_lab']) {
    const source = fs.readFileSync('tool/js/' + file + '.js', 'utf8')
      .replace(/wireDiagnosticsUi\(\);\s*$/, '').replace(/initializeModelLab\(\);\s*$/, '');
    vm.runInNewContext(source, ctx);
  }
  ctx.diagnosticsActiveTab = 'assessment'; ctx.diagnosticsAssessmentRunId = 'live';
  ctx.refreshUnifiedModelAssessment = () => { requests.push('findings'); return Promise.resolve(); };
  return {ctx, nodes, snapshots, timers, finished, requests};
}
function run(status = 'running') {
  return {id: 'live', status, startedAt: '2026-10-18T12:00:00Z', summary: {completed: 3, failed: 1},
    progress: {phase: 'testing', currentModelRef: 'ollama::model', currentFile: 'portrait.jpg', currentKind: 'director_writing'},
    attempts: [{jobId: 'job-exact', status: 'running'}]};
}

test('assessment speed distinguishes request throughput from provider decode speed', () => {
  const {ctx} = ui();
  const attempt = {startedAt: '2026-10-18T12:00:00Z', finishedAt: '2026-10-18T12:01:00Z',
    result: {usage: {completion_tokens: 900}}};
  assert.equal(ctx.diagnosticsProbeMetrics(attempt).speed, 15);
  assert.match(ctx.diagnosticsProbeMetrics(attempt).hint, /queue wait/);
  attempt.result.requestSeconds = 30;
  assert.equal(ctx.diagnosticsProbeMetrics(attempt).speed, 30);
  assert.doesNotMatch(ctx.diagnosticsProbeMetrics(attempt).hint, /queue wait/);
  attempt.result.timings = {predicted_per_second: 45};
  assert.equal(ctx.diagnosticsProbeMetrics(attempt).speed, 45);
  assert.match(ctx.diagnosticsProbeMetrics(attempt).hint, /Runtime-reported/);
});

test('live probe metrics update existing cells without replacing interactive model rows', () => {
  const {ctx, nodes} = ui();
  const row = ctx.document.createElement('div'); row.dataset = {assessmentModel: 'vision:local::vl'};
  const speed = ctx.document.createElement('strong'); speed.setAttribute('data-assessment-speed', '');
  const output = ctx.document.createElement('strong'); output.setAttribute('data-assessment-output', '');
  row.appendChild(speed); row.appendChild(output);
  for (const name of ['primary', 'state', 'provenance', 'capabilities']) {
    const cell = ctx.document.createElement('span'); cell.setAttribute('data-assessment-' + name, ''); row.appendChild(cell);
  }
  nodes['diagnostics-assessment-results'].querySelectorAll = () => [row];
  ctx.diagnosticsUpdateAssessmentMetrics({id: 'new-run', status: 'running', attempts: [{role: 'vision', kind: 'vision_open', status: 'completed', modelRef: 'local::vl', finishedAt: 'now',
    result: {usage: {completion_tokens: 100}, requestSeconds: 5}}]});
  assert.equal(speed.textContent, '20.0 tok/s'); assert.equal(output.textContent, '100 tokens');
  assert.equal(row.children[0], speed);
  assert.equal(row.querySelector('[data-assessment-primary]').textContent, 'Response received');
  assert.match(row.querySelector('[data-assessment-provenance]').textContent, /new-run/);
});

test('stale browser running state cannot block admission, and an immediate server failure is not called running', async () => {
  for (const status of ['running', 'error']) {
    const {ctx, nodes} = ui();
    ctx.state = {folder: 'set'};
    ctx.modelLabCurrentFiles = () => ['a.jpg', 'b.jpg']; ctx.modelLabGroups = () => [];
    ctx.diagnosticsAssessmentCatalog.directors = [{id: 'local::model', modelId: 'model'}];
    ctx.diagnosticsAssessmentSelected.director.add('local::model');
    ctx.modelLabState.run = {id: 'stale-browser-preview', status: 'running'};
    let admitted = 0;
    ctx.modelLabPost = async () => { admitted++; return {run: {...run(status), error: status === 'error' ? 'Journal denied' : ''}}; };
    ctx.modelLabRender = () => ctx.modelLabPublishProgress(ctx.modelLabState.run);
    ctx.modelLabSchedulePoll = () => {};
    if (status === 'error') {
      await assert.rejects(ctx.runUnifiedModelAssessment(), /Journal denied/);
      assert.match(nodes['diagnostics-assessment-selection'].textContent, /could not complete.*Journal denied/);
      assert.equal(nodes['diagnostics-assessment-run'].disabled, false);
    } else {
      await ctx.runUnifiedModelAssessment();
      assert.match(nodes['diagnostics-assessment-selection'].textContent, /Assessment running/);
      assert.equal(nodes['diagnostics-assessment-run'].disabled, true);
    }
    assert.equal(admitted, 1, 'the server must decide whether work can start');
  }
});

test('Diagnostics and Activity share one snapshot and retain the live card through updates', () => {
  const {ctx, nodes, snapshots} = ui();
  ctx.modelLabPublishProgress(run());
  const card = nodes['diagnostics-assessment-activity'].children[0];
  assert.equal(card.getAttribute('data-progress-card-id'), snapshots[0].id);
  assert.equal(card.querySelector('[data-progress-title]').textContent, 'Model Assessment');
  assert.match(card.querySelector('[data-progress-phase]').textContent, /testing · Writing/);
  assert.match(card.querySelector('[data-progress-detail]').textContent, /ollama::model.*portrait.jpg/);
  assert.match(card.querySelector('[data-progress-counts]').textContent, /3 completed.*1 failed/);
  assert.equal(snapshots[0].progress, null);
  assert.equal(card.querySelector('[data-progress-track]').getAttribute('aria-valuenow'), undefined);
  assert.equal(snapshots[0].childJobId, 'job-exact');
  assert.equal(nodes['diagnostics-assessment-run'].disabled, true);
  ctx.modelLabPublishProgress({...run(), summary: {completed: 4}});
  assert.equal(nodes['diagnostics-assessment-activity'].children[0], card);
  assert.match(card.querySelector('[data-progress-counts]').textContent, /4 completed/);
});

test('terminal status refreshes findings once; history and closed Diagnostics cannot replace the card', () => {
  const {ctx, nodes, requests, finished} = ui();
  const historical = {id: 'old', status: 'completed'};
  ctx.modelLabState.run = historical;
  ctx.modelLabPublishProgress(run()); ctx.modelLabPublishProgress(run('completed'));
  ctx.modelLabPublishProgress(run('completed'));
  assert.deepEqual(requests, ['findings']);
  assert.equal(finished[0][1], 'completed');
  assert.equal(ctx.modelLabState.run, historical, 'following progress must not replace the selected historical run');
  const card = nodes['diagnostics-assessment-activity'].children[0];
  assert.equal(card.querySelector('[data-progress-phase]').textContent, 'Completed');
  assert.equal(nodes['diagnostics-assessment-run'].disabled, false);
  ctx.modelLabPublishProgress({...run(), id: 'old', status: 'completed'});
  assert.equal(card.querySelector('[data-progress-phase]').textContent, 'Completed');
  nodes['diagnostics-modal'].classList.add('hidden');
  ctx.modelLabPublishProgress(run('error'));
  assert.equal(card.querySelector('[data-progress-phase]').textContent, 'Completed');
});

test('connection errors are visible without pretending that the server run failed', () => {
  const {ctx, nodes} = ui(); ctx.modelLabPublishProgress(run());
  ctx.diagnosticsAssessmentProgressError('live', new Error('Connection refused'));
  const card = nodes['diagnostics-assessment-activity'].children[0];
  assert.match(card.querySelector('[data-progress-phase]').textContent, /Progress unavailable/);
  assert.equal(card.querySelector('[data-progress-detail]').textContent, 'Connection refused');
  assert.equal(ctx.diagnosticsAssessmentRunStatus, 'running');
  ctx.modelLabPublishProgress({...run('error'), error: 'Probe runtime failed'});
  assert.match(card.className, /status-failed/);
  assert.equal(card.querySelector('[data-progress-detail]').textContent, 'Probe runtime failed');
});

test('terminal elapsed time uses the server finish time rather than continuing to grow', () => {
  const {ctx, nodes} = ui();
  ctx.modelLabPublishProgress({...run('completed'), finishedAt: '2026-10-18T12:01:05Z'});
  const card = nodes['diagnostics-assessment-activity'].children[0];
  assert.equal(card.querySelector('[data-progress-elapsed]').textContent, '1m 05s elapsed');
});

test('shared card removes a numeric percentage when progress becomes indeterminate', () => {
  const {ctx} = ui(); const card = ctx.ProgressCard.create();
  const snapshot = ctx.modelLabProgressSnapshot(run());
  ctx.ProgressCard.update(card, {...snapshot, progress: {completed: 2, total: 4}});
  const track = card.querySelector('[data-progress-track]');
  assert.equal(track.getAttribute('aria-valuenow'), '50');
  assert.equal(card.querySelector('[data-progress-fill]').style.width, '50.0%');
  ctx.ProgressCard.update(card, snapshot);
  assert.equal(track.getAttribute('aria-valuenow'), undefined);
  assert.equal(track.classList.contains('indeterminate'), true);
  assert.equal(card.querySelector('[data-progress-fill]').style.width, '');
});

test('the existing Model Lab timer follows the active run without changing selected history', async () => {
  const {ctx, timers, nodes} = ui();
  ctx.modelLabState.run = {id: 'old', status: 'completed'};
  ctx.modelLabPublishProgress(run());
  ctx.modelLabRequest = async url => { assert.match(url, /run=live/); return {run: {...run(), summary: {completed: 7}}}; };
  ctx.modelLabSchedulePoll(); assert.equal(timers.length, 1);
  timers[0](); await new Promise(resolve => setImmediate(resolve));
  assert.equal(ctx.modelLabState.run.id, 'old');
  assert.match(nodes['diagnostics-assessment-activity'].children[0].querySelector('[data-progress-counts]').textContent, /7 completed/);
  let opened;
  ctx.setDiagnosticsTab = (...args) => {opened = args;};
  nodes['diagnostics-assessment-activity'].children[0].querySelector('[data-progress-open]').onclick();
  assert.deepEqual(opened, ['model-lab', true, 'live']);
});
