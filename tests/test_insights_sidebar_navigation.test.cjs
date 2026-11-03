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
  assert.match(inspector, /header\.appendChild\(view\.mode==='analytics'\?backToInsights\(\):backToTestResults\(\)\)/);
  assert.match(inspector, /host\.prepend\(view\.mode==='analytics'\?backToInsights\(\):backToTestResults\(\)\)/);
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

function insightsFeaturedHarness(rows) {
  const start = analytics.indexOf('  function labLeaders(ranked){');
  const end = analytics.indexOf('  function labHistory(){', start);
  assert.ok(start >= 0 && end > start, 'Insights leadership functions must be present');
  const feature = {
    innerHTML: '',
    single: false,
    classList: {toggle(name, active) {
      assert.equal(name, 'is-single');
      feature.single = active;
    }},
  };
  const context = {
    folder: 'test-set',
    lab: id => {
      assert.equal(id, 'featured');
      return feature;
    },
    labEmpty: message => '<p>' + message + '</p>',
    esc: value => String(value),
  };
  const exposed = vm.runInNewContext('(function(){\n' +
    analytics.slice(start, end) + '\nreturn { labLeaders, labFeatured };\n})()', context);
  const candidates = rows.map(row => ({
    jobId: row[0], epoch: row[1], allManualAverage: row[2],
    ratedCount: row[3], testCount: row[3] + 1,
    runName: row[0], sessions: ['test-session'], ratingDistribution: {},
    topRenders: [],
  }));
  const leaders = exposed.labLeaders(candidates);
  exposed.labFeatured(candidates);
  return {leaders, feature};
}

test('Insights leads with highest average among checkpoints with at least five ratings', () => {
  const {leaders, feature} = insightsFeaturedHarness([
    ['run-a', 35, 5.0, 1], ['run-b', 48, 4.7, 12], ['run-c', 57, 4.5, 18],
  ]);
  assert.equal(leaders.primary.epoch, 48);
  assert.equal(leaders.highest.epoch, 35);
  assert.equal(leaders.alternate.epoch, 35);
  assert.equal(feature.single, false);
  assert.match(feature.innerHTML, /Best-supported contender/);
  assert.match(feature.innerHTML, /Highest average · provisional/);
  assert.ok(feature.innerHTML.indexOf('Epoch 48') < feature.innerHTML.indexOf('Epoch 35'));
  assert.match(feature.innerHTML, /12 of 13 Test renders rated/);
  assert.match(feature.innerHTML, /1 of 2 Test renders rated/);
});

test('Insights shows one wide card when highest-rated is also best-supported', () => {
  const {leaders, feature} = insightsFeaturedHarness([
    ['run-a', 35, 4.8, 6], ['run-b', 48, 4.8, 5], ['run-c', 57, 4.5, 18],
  ]);
  assert.equal(leaders.primary.epoch, 35, 'Tied average favors more ratings');
  assert.equal(leaders.highest.epoch, 35);
  assert.equal(feature.single, true);
  assert.match(feature.innerHTML, /Best-supported contender/);
  assert.doesNotMatch(feature.innerHTML, /Highest average · provisional/);
  assert.doesNotMatch(feature.innerHTML, /Epoch 48/);
});

test('Insights shows a provisional leader instead of inventing a supported winner', () => {
  const {leaders, feature} = insightsFeaturedHarness([
    ['run-a', 35, 5, 1], ['run-b', 48, 4.8, 4],
  ]);
  assert.equal(leaders.supported, null);
  assert.equal(leaders.primary.epoch, 35);
  assert.equal(feature.single, true);
  assert.match(feature.innerHTML, /Provisional leader/);
  assert.match(feature.innerHTML, /No epoch has 5 saved ratings yet/);
  assert.doesNotMatch(feature.innerHTML, /Best-supported contender/);
  assert.doesNotMatch(feature.innerHTML, /Epoch 48/);
});

test('Insights shows no fabricated contender when there are no ratings', () => {
  const {leaders, feature} = insightsFeaturedHarness([]);
  assert.equal(leaders.primary, null);
  assert.equal(feature.single, true);
  assert.match(feature.innerHTML, /No saved Test ratings yet/);
});

test('Insights challenge inspect actions follow the same leader definitions', () => {
  assert.match(analytics, /var leaders=labLeaders\(ranked\)/);
  assert.match(analytics, /var leaders=labLeaders\(labRanked\(\)\),p=action==='challenger'\?leaders\.alternate:\(leaders\.primary\|\|labPoints\(\)\[0\]\)/);
  assert.match(css, /#run-analytics-screen #run-lab-featured\.is-single\{grid-template-columns:minmax\(0,1fr\)\}/);
});
