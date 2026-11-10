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
  '(function (setScanState, scopeCount, rescanBtn, forceBtn, badRetry, vocabularyBtn, coverageIsUsable, itemsCountNeedingAttention) {\n' +
  source.slice(start, end) +
  '\nreturn { shouldRetry, shouldScan, canContinue };\n})'
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
  const rescan = button(), force = button(), retry = button(), vocabulary = button();
  const state = {
    running, hasRun: known, coverage: { known, openCurrent: current, total },
    sightItems: Array.from({ length: attention }, (_, i) => ({ file: String(i), issue: 'Retry' }))
  };
  const decision = decide(state, scope, rescan, force, retry, vocabulary,
    () => known && current > 0, items => items.length);
  return { decision, rescan, retry, vocabulary, force };
}

test('fresh Set offers one Run action', () => {
  const s = scenario();
  assert.equal(s.decision.shouldScan, true);
  assert.equal(s.rescan.textContent, 'Run Set Intelligence');
  assert.equal(s.rescan.classes.has('set-scan-primary'), true);
  assert.equal(s.retry.classes.has('hidden'), true);
  assert.equal(s.vocabulary.classes.has('hidden'), true);
});

test('partial Sight prioritizes Resume and keeps Vocabulary secondary', () => {
  const s = scenario({ known: true, current: 4 });
  assert.equal(s.rescan.textContent, 'Resume 6 Sight');
  assert.equal(s.rescan.classes.has('set-scan-primary'), true);
  assert.equal(s.vocabulary.classes.has('set-scan-secondary'), true);
});

test('recorded issues take precedence over Resume without hiding Vocabulary', () => {
  const s = scenario({ known: true, current: 4, attention: 2 });
  assert.equal(s.retry.textContent, 'Retry 2 needing attention');
  assert.equal(s.retry.classes.has('set-scan-primary'), true);
  assert.equal(s.rescan.classes.has('hidden'), true);
  assert.equal(s.vocabulary.classes.has('set-scan-secondary'), true);
});

test('fully current Sight recommends Discover Vocabulary', () => {
  const s = scenario({ known: true, current: 10 });
  assert.equal(s.rescan.classes.has('hidden'), true);
  assert.equal(s.retry.classes.has('hidden'), true);
  assert.equal(s.vocabulary.classes.has('set-scan-primary'), true);
});

test('running scan hides launch actions; Stop is rendered separately', () => {
  const s = scenario({ known: true, current: 2, running: true, attention: 1 });
  assert.equal(s.rescan.classes.has('hidden'), true);
  assert.equal(s.retry.classes.has('hidden'), true);
  assert.equal(s.vocabulary.classes.has('hidden'), true);
  assert.equal(s.force.disabled, true);
});
