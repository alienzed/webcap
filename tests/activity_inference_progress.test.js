const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Exercise the production adapter without starting the Activity monitor poller
// or changing the owning inference workflows.
const script = fs.readFileSync(path.join(__dirname, '../tool/js/activity_monitor.js'), 'utf8');
const start = script.indexOf('  function managedProgressSnapshot(item) {');
const end = script.indexOf('\n  function openItem(item)', start);
assert.ok(start >= 0 && end > start, 'Shared Activity progress adapter must exist');
const sandbox = {
  activityTitle: (item) => item.kind.toUpperCase() + ' · ' + (item.label || ''),
  activityDetail: (item) => item.modelId || '',
  bytesLabel: (value) => String(value) + ' B',
};
vm.runInNewContext(script.slice(start, end) + '\nthis.toProgress = managedProgressSnapshot;', sandbox);

function adapt(kind, progress, extras = {}) {
  const input = {
    id: kind + '-job-1',
    kind, lane: 'inference', label: 'Sample', modelId: 'Model A',
    status: 'running', startedAt: 123,
    progress,
    ...extras,
  };
  return { input, output: sandbox.toProgress(input) };
}

for (const kind of ['generate', 'test', 'storyboard']) {
  test(kind + ' displays its existing inference steps and percent, preserves source job', () => {
    const { input, output } = adapt(kind, { step: 3, steps: 12, percent: 25 });
    assert.equal(output.id, 'managed:' + kind + ':' + input.id);
    assert.equal(output.progress.completed, 3);
    assert.equal(output.progress.total, 12);
    assert.match(output.progressLabel, /3 \/ 12 steps/);
    assert.match(output.progressLabel, /25%/);
    assert.equal(output.original, input);
    assert.equal(output.phase, 'Generating');
    assert.equal(output.detail, 'Model A');
  });
}

test('percent-only provider progress stays determinate', () => {
  const { output } = adapt('storyboard', { percent: 65 });
  assert.equal(output.progress.completed, 65);
  assert.equal(output.progress.total, 100);
  assert.equal(output.progressLabel, '65%');
});

test('absent progress is indeterminate, not a fictitious zero percent', () => {
  const { output } = adapt('generate', {});
  assert.equal(output.progress, null);
  assert.equal(output.progressLabel, '');
});

test('out-of-range step count uses valid provider percent instead', () => {
  const { output } = adapt('test', { step: 25, steps: 12, percent: 80 });
  assert.equal(output.progress.completed, 80);
  assert.equal(output.progress.total, 100);
});

test('unknown provider progress stays indeterminate', () => {
  const { output } = adapt('generate', { step: 20, steps: 10, percent: 150 });
  assert.equal(output.progress, null);
});

test('non-inference lanes remain on their existing cards', () => {
  const { output } = adapt('storyboard', { percent: 50 }, { lane: 'llm' });
  assert.equal(output, null);
});

test('starting and stopping states are reflected without changing job status', () => {
  const starting = adapt('generate', {}, { status: 'starting' });
  const stopping = adapt('test', {}, { status: 'stopping' });
  assert.equal(starting.output.phase, 'Starting');
  assert.equal(stopping.output.phase, 'Stopping');
  assert.equal(starting.input.status, 'starting');
  assert.equal(stopping.input.status, 'stopping');
});

test('training startup shows model loading without fabricated completion', () => {
  const loading = adapt('training', {}, { lane: 'training', status: 'starting', stage: 'h3' });
  assert.equal(loading.output.phase, 'Loading model · h3');
  assert.equal(loading.output.progress, null);
  assert.equal(loading.output.progressLabel, 'Waiting for first training step');

  const launch = adapt('training', {}, { lane: 'training', status: 'starting', stage: 'launch' });
  assert.equal(launch.output.phase, 'Starting');
  assert.equal(launch.output.progress, null);

  const caching = adapt('training', {}, { lane: 'training', status: 'starting', stage: 'caching' });
  assert.equal(caching.output.phase, 'Caching');
  assert.equal(caching.output.progress, null);

  const starting = adapt('training', {}, { lane: 'training', status: 'starting', stage: 'starting' });
  assert.equal(starting.output.phase, 'Loading model');
  assert.equal(starting.output.progress, null);

  const running = adapt('training', { step: 1, steps: 100, overallPercent: 1 }, {
    lane: 'training', status: 'running', stage: 'h3',
  });
  assert.equal(running.output.phase, 'Training · h3');
  assert.equal(running.output.progress.completed, 1);
  assert.equal(running.output.progress.total, 100);
});
