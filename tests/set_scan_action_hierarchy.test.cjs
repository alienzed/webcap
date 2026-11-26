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

function scenario({ known = false, current = 0, total = 10, attention = 0, running = false, scope = 10 } = {}) {
  const rescan = button(), force = button(), retry = button(), actions = button();
  const stop = { parentElement: actions };
  const state = {
    running, hasRun: known, coverage: { known, openCurrent: current, total },
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
