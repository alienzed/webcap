const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const js = fs.readFileSync(path.join(__dirname, '../tool/js/run_analytics.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../tool/tool.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../tool/css/epoch_finder.css'), 'utf8');
const start = js.indexOf('  window.runAnalyticsViewEpoch=function(');
const end = js.indexOf("  el('epoch-media-close').onclick", start);
assert.ok(start >= 0 && end > start, 'Epoch inspector entry point must exist');
const excerpt = js.slice(start, end);

function harness(hidden) {
  let modeChanges = 0;
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      classList: {add() {}, contains() {return !!hidden;}},
      replaceChildren() {}, showModal() {},
      textContent: '',
    });
    return nodes.get(id);
  };
  const sandbox = {
    window: {epochFinderShowMode() {modeChanges++;}},
    document: {getElementById: node},
    el: node,
    epochMediaSerial: 0,
    epochMediaReturnMode: 'analytics',
    epochMediaLoading: false,
    epochMediaScope: null,
    epochMediaOffset: 0,
    epochMediaLoad() {},
  };
  vm.runInNewContext(excerpt, sandbox);
  return {sandbox, node, modeChanges: () => modeChanges};
}

test('opening an epoch from Insights preserves the active Insights workspace', () => {
  const h = harness(false);
  h.sandbox.window.runAnalyticsViewEpoch('job-123', 15);
  assert.equal(h.modeChanges(), 0, 'Must not reload Insights while it is already visible');
  assert.equal(h.node('epoch-media-close').textContent, '← Back to Insights');
  assert.equal(h.node('epoch-media-back-bottom').textContent, '← Back to Insights');
  assert.equal(h.node('epoch-media-title').textContent, 'Epoch 15 · combined generated results');
});

test('inspector opened from Tests still restores the original workspace', () => {
  const h = harness(true);
  h.sandbox.window.runAnalyticsViewEpoch('job-123', 15, 'tests');
  assert.equal(h.modeChanges(), 1);
  assert.equal(h.node('epoch-media-close').textContent, '← Back to Test results');
  assert.equal(h.node('epoch-media-back-bottom').textContent, '← Back to Test results');
});

test('Insights rail exposes readable browse-first navigation and explicit return', () => {
  const start = html.indexOf('id="run-analytics-screen"');
  const end = html.indexOf('id="run-lab-review-dialog"', start);
  const section = html.slice(start, end);
  assert.match(section, /class="run-insights-rail-intro"/);
  assert.match(section, /class="epoch-finder-panel run-insights-rail-primary"><details open>/);
  assert.match(section, /Browse epochs/);
  assert.match(section, /Compare runs/);
  assert.match(section, /Evidence filters/);
  assert.match(section, /id="run-analytics-epoch-media-back-bottom"/);
  assert.match(js, /el\('epoch-media-back-bottom'\)\.onclick=epochMediaClose/);
  assert.match(js, /window\.runAnalyticsOpen=function\(\)\{labLoad\(\);labEnsureDetailIndex\(\);\}/);
  assert.match(css, /run-insights-rail-summary-title\{font-size:19px/);
  assert.match(css, /run-analytics-result-epochs button strong\{font-size:17px/);
});
