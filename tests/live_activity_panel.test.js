const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../tool/js/activity_monitor.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../tool/tool.html'), 'utf8');
const monitor = fs.readFileSync(path.join(__dirname, '../tool/server/activity_monitor.py'), 'utf8');
const shell = fs.readFileSync(path.join(__dirname, '../tool/js/workspace_shell.js'), 'utf8');
const start = source.indexOf('  function currentActivityItems() {');
const end = source.indexOf('  function updateSystemHistory(', start);
assert.ok(start >= 0 && end > start, 'Live activity selection helpers exist');

function harness(active, owner, local = []) {
  const opened = [];
  const sandbox = {
    state: {
      payload: { active, gpuOwner: owner },
      dismissedJobs: Object.create(null),
      selectedJobKey: '',
      autoOpenSeen: Object.create(null),
      open: false,
    },
    isProgressChild: () => false,
    localItems: () => local,
    setOpen: (value) => { opened.push(value); sandbox.state.open = value; },
    el: () => null,
  };
  vm.runInNewContext(source.slice(start, end) +
    '\nthis.choose = currentPrimaryItem; this.autoOpen = maybeAutoOpen;', sandbox);
  return { ...sandbox, opened };
}

test('local GPU owner wins primary placement over newer remote Director work', () => {
  const training = { id: 't1', kind: 'training', lane: 'training' };
  const remote = { id: 'd1', kind: 'director', lane: 'llm' };
  const h = harness([training, remote], 'training');
  assert.equal(h.choose().id, 't1');
});

test('when GPU is idle, active non-GPU work may be primary', () => {
  const h = harness([{ id: 'd1', kind: 'director', lane: 'llm' }], 'none');
  assert.equal(h.choose().id, 'd1');
});

test('short Director work opens automatically; Training and Inference do not', () => {
  const h = harness([
    { id: 't1', lane: 'training', kind: 'training' },
    { id: 'i1', lane: 'inference', kind: 'generate' },
  ], 'training');
  h.autoOpen();
  assert.equal(h.opened.length, 0);
  h.state.payload.active.push({ id: 'd1', lane: 'llm', kind: 'director' });
  h.autoOpen();
  assert.deepEqual(h.opened, [true]);
});

test('dismissing one Director job prevents reopening for that job', () => {
  const h = harness([{ id: 'd1', lane: 'llm', kind: 'director' }], 'none');
  h.state.dismissedJobs['llm:d1'] = true;
  h.autoOpen();
  assert.equal(h.opened.length, 0);
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

test('automatic Activity opening never dismisses an already visible Director drawer', () => {
  const h = harness([{ id: 'd1', lane: 'llm', kind: 'director' }], 'none');
  h.el = (id) => id === 'director-chat-drawer' ? { classList: { contains: () => false } } : null;
  // The extracted helper captures sandbox.el, so update the sandbox used by a fresh run.
  assert.ok(source.includes("!competingDrawer && shortInteractive"));
  assert.ok(source.includes("event.target.closest('.shell-workload-indicator')"));
});

test('short job notifications wake Activity through the shared tracker', () => {
  const common = fs.readFileSync(path.join(__dirname, '../tool/js/common.js'), 'utf8');
  assert.ok(common.includes('entry.activityWakeSent = true'));
  assert.ok(common.includes('window.refreshActivityMonitor()'));
});


test('manual Activity dismissal is scoped to a job, not the whole LLM lane', () => {
  assert.ok(source.includes('state.dismissedJobs[activityJobKey(item)] = true'));
  assert.ok(!source.includes('silencedLanes'));
  assert.ok(source.includes('state.selectedJobKey = activityJobKey(item); render();'));
});


test('Activity only receives job-scoped live Director telemetry', () => {
  assert.ok(monitor.includes('item["id"] == active_llm_id'));
  assert.ok(monitor.includes('runtime_started >= job_started - 2'));
  assert.ok(monitor.includes('item["liveTokens"] = slot.get("generatedTokens")'));
  assert.ok(source.includes("data-director-live-stats"));
  assert.ok(source.includes("snapshot.liveTokens != null"));
});
