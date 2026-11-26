'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('tool/js/set_scan.js', 'utf8');

const start = source.indexOf('    var coverage = setScanState.coverage;', source.indexOf('  function renderSetIntelligence()'));
const end = source.indexOf('    qualitySummary.innerHTML', start);
assert.ok(start >= 0 && end > start, 'Sight action decision block exists');

// Exercise the real action selection rather than a reimplementation of its rules.
const decide = vm.runInNewContext(
  '(function (setScanState, scopeCount, rescanBtn, forceBtn, badRetry, stopBtn, itemsCountNeedingAttention) {\n' +
  source.slice(start, end) +
  '\nreturn { shouldRetry, shouldScan };\n})'
);

function button() {
  const classes = new Set();
  return {
    disabled: false, textContent: '', classes,
    classList: {
      toggle(name, active) { active ? classes.add(name) : classes.delete(name); }
    }
  };
}

function scenario({ known = false, current = 0, total = 10, attention = 0, running = false, scope = 10, phase = 'idle' } = {}) {
  const rescan = button(), force = button(), retry = button(), actions = button();
  const stop = { parentElement: actions };
  const state = {
    running, phase, hasRun: known, coverage: { known, openCurrent: current, total },
    sightItems: Array.from({ length: attention }, (_, i) => ({ file: String(i), issue: 'Retry' }))
  };
  const decision = decide(state, scope, rescan, force, retry, stop, items => items.length);
  return { decision, rescan, retry, actions, force };
}

test('fresh Set offers one Run action', () => {
  const s = scenario();
  assert.equal(s.decision.shouldScan, true);
  assert.equal(s.rescan.textContent, 'Run Set Intelligence');
  assert.equal(s.rescan.classes.has('set-scan-primary'), true);
  assert.equal(s.retry.classes.has('hidden'), true);
});

test('partial Sight prioritizes Resume', () => {
  const s = scenario({ known: true, current: 4 });
  assert.equal(s.rescan.textContent, 'Resume 6 Sight');
  assert.equal(s.rescan.classes.has('set-scan-primary'), true);
});

test('recorded issues take precedence over Resume', () => {
  const s = scenario({ known: true, current: 4, attention: 2 });
  assert.equal(s.retry.textContent, 'Retry 2 needing attention');
  assert.equal(s.retry.classes.has('set-scan-primary'), true);
  assert.equal(s.rescan.classes.has('hidden'), true);
});

test('fully current Sight collapses the empty scan action row', () => {
  const s = scenario({ known: true, current: 10 });
  assert.equal(s.rescan.classes.has('hidden'), true);
  assert.equal(s.retry.classes.has('hidden'), true);
  assert.equal(s.actions.classes.has('hidden'), true);
});

test('running scan hides launch actions; Stop is rendered separately', () => {
  const s = scenario({ known: true, current: 2, running: true, attention: 1 });
  assert.equal(s.rescan.classes.has('hidden'), true);
  assert.equal(s.retry.classes.has('hidden'), true);
  assert.equal(s.force.disabled, true);
  assert.equal(s.actions.classes.has('hidden'), false);
});

test('successful completion hides redundant status while errors and live status stay visible', () => {
  const from = source.indexOf('  function setSetIntelligenceStatus(');
  const to = source.indexOf('  function showRawResponse(', from);
  assert.ok(from >= 0 && to > from);
  const summary = button(), stage = { parentElement: summary }, status = {};
  const context = {
    el: id => id === 'set-scan-stage' ? stage : status,
    renderSetIntelligence() {}, publishSetIntelligenceActivity() {}
  };
  const update = vm.runInNewContext(source.slice(from, to) + '\nsetSetIntelligenceStatus', context);
  update('Set understood', 'Cached Sight is available.', true);
  assert.equal(summary.classes.has('hidden'), true);
  update('Sight', 'Checking item 1');
  assert.equal(summary.classes.has('hidden'), false);
  update('Set Intelligence refresh failed', 'Previous report preserved.');
  assert.equal(summary.classes.has('hidden'), false);
  assert.equal(status.textContent, 'Previous report preserved.');
});

test('pending cached coverage never flashes the Run action before the result', () => {
  const pending = scenario({ phase: 'checking-cache' });
  assert.equal(pending.rescan.classes.has('hidden'), true);
  assert.equal(pending.actions.classes.has('hidden'), true);

  const complete = scenario({ known: true, current: 10, phase: 'complete' });
  assert.equal(complete.actions.classes.has('hidden'), true);

  const missing = scenario({ known: true, current: 0 });
  assert.equal(missing.rescan.classes.has('hidden'), false);
  assert.equal(missing.actions.classes.has('hidden'), false);

  // A failed cache lookup can still offer the explicit scan action.
  const unavailable = scenario();
  assert.equal(unavailable.rescan.classes.has('hidden'), false);
});

test('opening Sight hides stale status and actions before the first render', async () => {
  const from = source.indexOf('  function openSetIntelligence()');
  const to = source.indexOf('  function closeSetIntelligence()', from);
  const statusFrom = source.indexOf('  function setSetIntelligenceStatus(');
  const statusTo = source.indexOf('  function showRawResponse(', statusFrom);
  assert.ok(from >= 0 && to > from && statusFrom >= 0 && statusTo > statusFrom);
  const summary = button(), stage = { parentElement: summary }, status = {};
  const renders = [];
  let resolveCached;
  const cache = new Promise(resolve => { resolveCached = resolve; });
  const setScanState = {
    running: false, open: false, folder: '/set', scopeRequestToken: 0,
    phase: 'complete', coverage: { known: true, total: 1, openCurrent: 1 }
  };
  const context = {
    setScanState, state: { folder: '/set', items: [{}] },
    window: { setStatus() {} },
    isSetFolderContext: () => true,
    getSetIntelligenceScopeFiles: () => ['one.jpg'],
    el: id => id === 'set-scan-stage' ? stage : status,
    publishSetIntelligenceActivity() {},
    reportConsoleError(label, error) { assert.fail(label + ': ' + error); },
    renderSetIntelligence() {
      const view = scenario({ phase: setScanState.phase, known: setScanState.coverage.known,
        current: setScanState.coverage.openCurrent, total: setScanState.coverage.total });
      renders.push({ statusHidden: summary.classes.has('hidden'), actionsHidden: view.actions.classes.has('hidden') });
    },
    restoreCachedIntelligence() {
      return cache.then(() => {
        setScanState.coverage = { known: true, total: 1, openCurrent: 1 };
        setScanState.phase = 'complete';
        context.update('Set understood', 'Cached Sight is available.', true);
        return true;
      });
    }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(statusFrom, statusTo) + source.slice(from, to) +
    '\nthis.openSight = openSetIntelligence; this.update = setSetIntelligenceStatus;', context);
  context.openSight();
  assert.deepEqual(renders, [{ statusHidden: true, actionsHidden: true }]);
  resolveCached();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(renders, [
    { statusHidden: true, actionsHidden: true },
    { statusHidden: true, actionsHidden: true }
  ]);
});
