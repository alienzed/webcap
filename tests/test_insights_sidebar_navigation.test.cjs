const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const analytics = fs.readFileSync(path.join(__dirname, '../tool/js/run_analytics.js'), 'utf8');
const inspector = fs.readFileSync(path.join(__dirname, '../tool/js/epoch_info.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../tool/tool.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../tool/css/epoch_finder.css'), 'utf8');
// The shared inspector is loaded after the legacy analytics dialog and replaces
// window.runAnalyticsViewEpoch. Exercise the implementation actually used in WebCap.
assert.ok(html.indexOf('src="/static/js/epoch_info.js"') >
  html.indexOf('src="/static/js/run_analytics.js"'));
const start = inspector.indexOf('  window.epochInfoOpen=function(');
const end = inspector.lastIndexOf('\n})();');
assert.ok(start >= 0 && end > start, 'Shared epoch inspector navigation must exist');

function harness(screenHidden, reportHidden) {
  const elements = new Map();
  let modeCalls = 0;
  const node = id => {
    if (!elements.has(id)) {
      const flags = new Set();
      if (id === 'run-analytics-screen' && screenHidden) flags.add('hidden');
      if (id === 'run-analytics-report-surface' && reportHidden) flags.add('hidden');
      if (id === 'run-analytics-epoch-info' || id === 'test-generations-epoch-info') flags.add('hidden');
      elements.set(id, {
        classList: {
          add(x) { flags.add(x); },
          remove(x) { flags.delete(x); },
          contains(x) { return flags.has(x); },
          toggle(x, force) {
            if (force === undefined ? !flags.has(x) : force) flags.add(x);
            else flags.delete(x);
          },
        },
      });
    }
    return elements.get(id);
  };
  const window = {
    runAnalyticsFolder: () => 'some-set',
    epochFinderShowMode: mode => {
      assert.equal(mode, 'analytics');
      modeCalls++;
      node('run-analytics-screen').classList.remove('hidden');
    },
  };
  const state = { tests: null, analytics: null };
  vm.runInNewContext(inspector.slice(start, end), {
    window, document: { getElementById: node },
    state, load: () => Promise.resolve(),
  });
  return {window, state, node, modeCalls: () => modeCalls};
}

test('real Epoch inspector preserves Insights state and returns to the overview', async () => {
  const h = harness(false, true);
  await h.window.runAnalyticsViewEpoch('training-run-123', 47);
  assert.equal(h.modeCalls(), 0, 'Opening a preview from Insights must not reload Insights');
  assert.equal(h.state.analytics.epoch, 47);
  assert.equal(h.node('run-analytics-epoch-info').classList.contains('hidden'), false);
  h.window.epochInfoShowAnalytics();
  assert.equal(h.state.analytics, null);
  assert.equal(h.node('run-analytics-epoch-info').classList.contains('hidden'), true);
  assert.equal(h.node('run-analytics-report-surface').classList.contains('hidden'), true,
    'Returning to Insights must not reveal previously hidden detailed analytics');
});

test('return to Insights preserves an already-visible comparison report', async () => {
  const h = harness(false, false);
  await h.window.runAnalyticsViewEpoch('training-run-123', 47);
  h.window.epochInfoShowAnalytics();
  assert.equal(h.node('run-analytics-report-surface').classList.contains('hidden'), false);
});

test('opening another epoch from the rail preserves original report visibility', async () => {
  const h = harness(false, false);
  await h.window.runAnalyticsViewEpoch('training-run-123', 47);
  await h.window.runAnalyticsViewEpoch('training-run-123', 50);
  h.window.epochInfoShowAnalytics();
  assert.equal(h.node('run-analytics-report-surface').classList.contains('hidden'), false);
  assert.equal(h.modeCalls(), 0);
});

test('cross-workspace Epoch inspector uses existing navigation and Test mode stays intact', async () => {
  const h = harness(true, true);
  await h.window.runAnalyticsViewEpoch('training-run-123', 47);
  assert.equal(h.modeCalls(), 1);
  h.window.epochInfoShowAnalytics();
  await h.window.runAnalyticsViewEpoch('training-run-123', 48, 'tests');
  assert.equal(h.modeCalls(), 1);
  assert.equal(h.state.tests.epoch, 48);
  h.window.epochInfoShowSession();
  assert.equal(h.node('test-generations-epoch-info').classList.contains('hidden'), true);
});

test('Back to Insights is available during load, on success, and on errors', () => {
  assert.match(inspector, /function backToInsights\(\)/);
  assert.match(inspector, /back\.onclick=window\.epochInfoShowAnalytics/);
  assert.match(inspector, /header\.appendChild\(backToInsights\(\)\)/);
  assert.match(inspector, /host\.prepend\(backToInsights\(\)\)/);
  assert.match(css, /#run-analytics-epoch-info \.epoch-info-back\{[^}]*font-size:18px/);
});

test('Insights sidebar is browse-first with readable epochs and optional tools', () => {
  const from = html.indexOf('id="run-analytics-screen"');
  const section = html.slice(from, html.indexOf('id="run-lab-review-dialog"', from));
  assert.match(section, /class="run-insights-rail-intro"/);
  assert.match(section, /class="epoch-finder-panel run-insights-rail-primary"><details open>/);
  assert.match(section, /Browse epochs/);
  assert.match(section, /Compare runs/);
  assert.match(section, /Evidence filters/);
  assert.match(analytics, /window\.runAnalyticsOpen=function\(\)\{labLoad\(\);labEnsureDetailIndex\(\);\}/);
  assert.match(css, /run-insights-rail-summary-title\{font-size:19px/);
  assert.match(css, /run-analytics-result-epochs button strong\{font-size:17px/);
});
