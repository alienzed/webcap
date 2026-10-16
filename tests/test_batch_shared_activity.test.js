const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'tool/tool.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'tool/css/styles.css'), 'utf8');
const batch = fs.readFileSync(path.join(root, 'tool/js/test_generations.js'), 'utf8');
const activity = fs.readFileSync(path.join(root, 'tool/js/activity_monitor.js'), 'utf8');

test('one Activity overlay; Batch Test has no competing fixed overlay', () => {
  assert.equal((html.match(/id="activity-monitor-drawer"/g) || []).length, 1);
  assert.ok(!html.includes('id="test-generations-batch-card"'));
  assert.ok(!css.includes('.test-generations-batch-card'));
  assert.ok(html.includes('id="test-generations-batch-summary"'));
});

test('Batch Test owns Stop, score table, and dismissal in Test workspace', () => {
  assert.ok(html.includes('id="test-generations-batch-stop"'));
  assert.ok(html.includes('id="test-generations-batch-results"'));
  assert.ok(html.includes('id="test-generations-batch-dismiss"'));
  assert.ok(html.indexOf('id="test-generations-batch-summary"') < html.indexOf('id="test-generations-workspace"') + 20000);
  assert.ok(batch.includes("el('test-generations-batch-stop').onclick = stopTestBatch;"));
  assert.ok(batch.includes('testBatchSort'));
  assert.ok(batch.includes('Accepted Test sessions continue in the backend.'));
});

test('Batch coordinator publishes and finishes shared Activity without queue ownership', () => {
  assert.ok(batch.includes('window.publishActivityProgress({'));
  assert.ok(batch.includes("kind: 'test-batch', lane: 'background'"));
  assert.ok(batch.includes("window.finishActivityProgress(batch.activityId"));
  assert.ok(batch.includes('window.recordActivityCompletion({'));
  assert.ok(!batch.includes("el('test-generations-batch-card')"));
});

test('Activity navigation returns to correct Test Set', () => {
  assert.ok(activity.includes("if (item.kind === 'test-batch')"));
  assert.ok(activity.includes('window.openTestBenchActivity({ folder: item.folder, modelId: item.modelId });'));
  assert.ok(batch.includes("function openTestBenchActivity(target)"));
  assert.ok(batch.includes("openTestBenchSet(String(target.folder || ''), String(target.modelId || ''));"));
});

test('closing Activity never invokes Batch cancellation', () => {
  const close = activity.slice(activity.indexOf('  function setOpen('), activity.indexOf('  function bind()'));
  assert.ok(!close.includes('stopTestBatch'));
  assert.ok(!close.includes('cancelCaptionAssistJob'));
  assert.ok(batch.includes('function stopTestBatch()'));
});
