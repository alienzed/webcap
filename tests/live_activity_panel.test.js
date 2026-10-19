const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../tool/js/activity_monitor.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../tool/tool.html'), 'utf8');
const monitor = fs.readFileSync(path.join(__dirname, '../tool/server/activity_monitor.py'), 'utf8');
const shell = fs.readFileSync(path.join(__dirname, '../tool/js/workspace_shell.js'), 'utf8');
const start = source.indexOf('  function activityJobKey(item) {');
const end = source.indexOf('  function updateSystemHistory(', start);
assert.ok(start >= 0 && end > start, 'Live activity selection helpers exist');

function harness(active, owner, local = []) {
  const opened = [];
  const sandbox = {
    state: {
      payload: { active, gpuOwner: owner },
      selectedJobKey: '',
      open: false,
    },
    isProgressChild: () => false,
    localItems: () => local,
    setOpen: (value) => { opened.push(value); sandbox.state.open = value; },
    el: () => null,
  };
  vm.runInNewContext(source.slice(start, end) +
    '\nthis.choose = currentPrimaryItem; this.featured = () => featuredActivityItems(currentActivityItems(), currentPrimaryItem());', sandbox);
  return { ...sandbox, opened };
}

test('local GPU owner wins primary placement over newer remote Director work', () => {
  const training = { id: 't1', kind: 'training', lane: 'training' };
  const remote = { id: 'd1', kind: 'director', lane: 'llm' };
  const h = harness([training, remote], 'training');
  assert.equal(h.choose().id, 't1');
});

test('concurrent local and remote activity both get full cards, even when remote is focused', () => {
  const active = [
    { id: 't1', kind: 'training', lane: 'training' },
    { id: 'd1', kind: 'director', lane: 'llm', modelId: 'ollama::model-7b', runtimeMode: 'remote' },
  ];
  const h = harness(active, 'training');
  assert.deepEqual(h.featured().map(item => item.id), ['t1', 'd1']);
  h.state.selectedJobKey = 'llm:d1';
  assert.deepEqual(h.featured().map(item => item.id), ['d1', 't1']);
});

test('remote First Cut qualifies, but a remote-only activity gets one card', () => {
  const remote = { id: 'first-cut:1', kind: 'first-cut', lane: 'background', modelId: 'ollama::model-7b' };
  assert.equal(harness([remote], 'none').featured().length, 1);
  const h = harness([remote, { id: 'i1', kind: 'generate', lane: 'inference' }], 'inference');
  assert.deepEqual(h.featured().map(item => item.id), ['i1', 'first-cut:1']);
});

test('Activity hardware graph is anchored to local GPU work, never remote', () => {
  assert.ok(source.includes('cards[localIndex].after(graph)'));
  assert.ok(source.includes("graph.classList.toggle('hidden', localIndex < 0)"));
  assert.ok(source.includes('directorJob && !isRemoteDirector(item) && Number.isFinite(generated)'));
  assert.ok(source.includes('renderFeaturedCards(primaryHost, featured)'));
  assert.ok(!source.includes('primaryHost.replaceChildren()'));
});

test('Activity audit keeps stable cards and correct disclosure and queue state', () => {
  assert.ok(source.includes("mounted.join('\\n') !== ordered.join('\\n')"));
  assert.ok(source.includes("detailsToggle.classList.toggle('hidden', !primary || otherCount === 0)"));
  assert.ok(source.includes("if (backlog) queueParts.push(String(backlog) + ' backlog')"));
  assert.ok(source.includes("className: isRemoteDirector(item) ? 'activity-remote-card' : ''"));
});

test('when GPU is idle, active non-GPU work may be primary', () => {
  const h = harness([{ id: 'd1', kind: 'director', lane: 'llm' }], 'none');
  assert.equal(h.choose().id, 'd1');
});

test('background activity updates never open the unified drawer', () => {
  assert.ok(!source.includes('maybeAutoOpen'));
  assert.ok(!source.includes('autoOpenSeen'));
  assert.ok(!source.includes('dismissedJobs'));
  assert.ok(source.includes('window.publishActivityProgress = publishProgress'));
  assert.ok(source.includes("window.addEventListener('webcap:inference-queue-changed', wake)"));
  assert.ok(source.includes("state.payload = payload;"));
});

test('explicit Activity navigation still opens the drawer', () => {
  assert.ok(source.includes("window.openOperationsDrawer('activity')"));
  assert.ok(source.includes("window.selectOperationsSection('activity')"));
  assert.ok(source.includes('window.focusActivityJob = function (jobId)'));
  assert.ok(source.includes('window.focusActivityByJob = function (jobId)'));
});

test('Model Assessment uses server-owned Activity receipts and an honest indeterminate progress card', () => {
  assert.ok(monitor.includes('from .model_lab import list_runs as model_lab_runs'));
  assert.ok(monitor.includes('active.extend(item for item in assessments'));
  assert.ok(monitor.includes('recent.extend(item for item in assessments'));
  assert.ok(source.includes("if (item.kind === 'model-lab') return 'Model Assessment'"));
  assert.ok(source.includes("window.openDiagnosticsModal('assessment')"));
  assert.ok(source.includes('Probe count is not a known total'));
});

test('unified shell has one overlay Activity surface and no old follower', () => {
  assert.equal((html.match(/id="activity-monitor-drawer"/g) || []).length, 1);
  assert.ok(html.indexOf('id="activity-monitor-drawer"') > html.indexOf('id="app-overlay-root"'));
  assert.ok(html.includes('id="activity-monitor-trend"'));
  assert.ok(html.includes('id="activity-monitor-primary-queue"'));
  assert.ok(!source.includes('renderProgressFollower'));
});

test('queued Inference jobs are navigation-only and telemetry is owned by the shell', () => {
  assert.ok(monitor.includes('"jobs": ['));
  assert.ok(monitor.includes('_execution_item("inference", job)'));
  assert.ok(source.includes('openItem(job)'));
  assert.ok(shell.includes('window.updateActivitySystemTelemetry(payload);'));
  assert.ok(!source.includes("fetch('/fs/system_status')"));
});

test('short job notifications wake Activity through the shared tracker', () => {
  const common = fs.readFileSync(path.join(__dirname, '../tool/js/common.js'), 'utf8');
  assert.ok(common.includes('entry.activityWakeSent = true'));
  assert.ok(common.includes('window.refreshActivityMonitor()'));
});


test('Activity only receives job-scoped live Director telemetry', () => {
  assert.ok(monitor.includes('item["id"] == active_llm_id'));
  assert.ok(monitor.includes('runtime_started >= job_started - 2'));
  assert.ok(monitor.includes('item["liveTokens"] = slot.get("generatedTokens")'));
  assert.ok(source.includes("data-director-live-stats"));
  assert.ok(source.includes("directorJob.liveTokens != null"));
});


test('First Cut is a parent Activity card with live operation controls', () => {
  assert.ok(monitor.includes('first_cut_batches = first_cut_snapshot()'));
  assert.ok(monitor.includes('child_telemetry.get'));
  assert.ok(source.includes('function firstCutProgressSnapshot(item)'));
  assert.ok(source.includes("item.kind === 'first-cut' || item.kind === 'director-diagnostics'"));
  assert.ok(source.includes("operation: 'cancel', batchId: item.batchId"));
  assert.ok(source.includes("operation: 'cancel_job', jobId: item.id"));
});


test('First Cut completion stays in Activity while child receipts are not duplicated', () => {
  assert.ok(monitor.includes('all_cut_children'));
  assert.ok(monitor.includes('item["id"] not in all_cut_children'));
  assert.ok(monitor.includes('"id": "first-cut:" + str(batch["id"])'));
  assert.ok(monitor.includes('"finishedAt": finished'));
});

test('Storyboard blocking card delegates detailed LLM progress to focused Activity', () => {
  const storyboard = fs.readFileSync(path.join(__dirname, '../tool/js/storyboard.js'), 'utf8');
  const monitor = fs.readFileSync(path.join(__dirname, '../tool/js/activity_monitor.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../tool/tool.html'), 'utf8');
  assert.ok(html.includes('id="storyboard-director-view-activity"'));
  assert.ok(storyboard.includes('window.focusActivityJob('));
  assert.ok(monitor.includes('window.focusActivityJob = function (jobId)'));
  assert.ok(monitor.includes('item.runtimePhase || item.status'));
  assert.ok(monitor.includes('directorJob.promptTokensLive || directorJob.promptTokens'));
  assert.ok(!storyboard.includes('    updateDirectorTrend(activity, system);'));
});


test('Model Assessment Activity counters never stringify missing fields', () => {
  assert.ok(source.includes("['attemptCount', 'completed', 'failed', 'skipped', 'interrupted'].map"));
  assert.ok(source.includes("Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0"));
  assert.ok(!source.includes("item.completed + ' completed'"));
});

test('Activity includes server-session history without replaying pre-refresh notifications', () => {
  assert.ok(source.includes("requestJson('/fs/activity?limit=50')"));
  const capture = source.slice(source.indexOf('  function captureRecent('), source.indexOf('  function publishProgress('));
  const notifications = source.slice(source.indexOf('  function notifyRecent('), source.indexOf('  function queueText('));
  assert.ok(!capture.includes("finishedAt(item) < sessionStartedAt"));
  assert.ok(notifications.includes("if (finishedAt(item) < sessionStartedAt) return;"));
  assert.ok(source.includes("var recent = sessionRecent();"));
  assert.ok(source.includes("recent.slice(0, 50)"));
  assert.ok(source.includes("function formatJobDuration(start, end)"));
  assert.ok(source.includes("Queued ' + wait"));
  assert.ok(source.includes("item.error ? 'Error: ' + item.error"));
});
