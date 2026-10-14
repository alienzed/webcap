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
      silencedLanes: Object.create(null),
      autoOpenSeen: Object.create(null),
      open: false,
    },
    isProgressChild: () => false,
    localItems: () => local,
    setOpen: (value) => { opened.push(value); sandbox.state.open = value; },
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

test('silencing Director prevents subsequent automatic opening', () => {
  const h = harness([{ id: 'd1', lane: 'llm', kind: 'director' }], 'none');
  h.state.silencedLanes.llm = true;
  h.autoOpen();
  assert.equal(h.opened.length, 0);
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
