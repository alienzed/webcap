// Exercise the real drag/drop controller with a small DOM fixture, not a text assertion.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../tool/js/job_queues.js'), 'utf8');
const begin = source.indexOf('  var drag = null;');
const end = source.indexOf("  drawer.addEventListener('click'", begin);
assert.ok(begin >= 0 && end > begin, 'Reorder event handlers must remain discoverable');

function fixture(lane, ids) {
  const handlers = {};
  const calls = [];
  const rows = ids.map((id) => ({
    dataset: { queueDragLane: lane, queueDragId: id },
    classList: { contains: (name) => name === 'status-queued' },
    removeAttribute(name) {
      if (name === 'data-queue-drop') delete this.dataset.queueDrop;
      if (name === 'data-queue-dragging') delete this.dataset.queueDragging;
    },
  }));
  const list = { querySelectorAll() { return rows; } };
  const drawer = {
    addEventListener(type, callback) { handlers[type] = callback; },
    querySelectorAll() { return rows.filter(row => row.dataset.queueDrop || row.dataset.queueDragging); },
    contains() { return true; },
  };
  const context = {
    drawer,
    document: {
      getElementById(id) {
        assert.equal(id, 'inference-queue-list');
        return list;
      },
      querySelector(selector) {
        assert.equal(selector, '#job-queue-panel-training [data-job-queue-list]');
        return list;
      },
    },
    window: {
      reorderInferenceQueueToPosition(id, position) {
        calls.push({ lane: 'inference', id, position });
        return Promise.resolve();
      },
      refreshTrainingRunnerStatus() {},
      reportConsoleError(context, error) { throw error; },
    },
    post(url, payload) {
      assert.equal(url, '/fs/training_runner/reorder');
      calls.push({ lane: 'training', id: payload.jobId, position: payload.position });
      return Promise.resolve();
    },
    refresh: () => Promise.resolve(),
    Promise,
  };
  vm.runInNewContext(source.slice(begin, end), context);
  function event(target, y) {
    return {
      target,
      clientY: y,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      dataTransfer: {
        effectAllowed: '',
        dropEffect: '',
        setData(type, value) {
          assert.equal(type, 'text/plain');
          assert.ok(value);
        },
      },
    };
  }
  function handle(row) {
    return { closest(selector) {
      return selector === '.job-queue-drag-handle' ? this :
        selector === '[data-queue-drag-lane]' ? row : null;
    } };
  }
  function target(row) {
    return Object.assign(row, { closest(selector) {
      return selector === '[data-queue-drag-lane]' ? row : null;
    } });
  }
  async function drag(from, to, y = 0) {
    const started = event(handle(rows[from]), y);
    handlers.dragstart(started);
    assert.equal(rows[from].dataset.queueDragging, 'true');
    const over = event(target(rows[to]), y);
    handlers.dragover(over);
    assert.equal(over.defaultPrevented, true, 'Target must accept a native drop');
    assert.equal(rows[to].dataset.queueDrop, 'target', 'Target must be highlighted');
    const dropped = event(rows[to], y);
    handlers.drop(dropped);
    assert.equal(dropped.defaultPrevented, true);
    await Promise.resolve();
    await Promise.resolve();
  }
  return { drag, calls };
}

for (const lane of ['inference', 'training']) {
  test(lane + ': dropping first on second moves it later even on upper half', async () => {
    const sample = fixture(lane, ['A', 'B', 'C']);
    await sample.drag(0, 1, 0);
    assert.deepEqual(sample.calls, [{ lane, id: 'A', position: 1 }]);
  });
  test(lane + ': dropping second on first moves it earlier even on lower half', async () => {
    const sample = fixture(lane, ['A', 'B', 'C']);
    await sample.drag(1, 0, 999);
    assert.deepEqual(sample.calls, [{ lane, id: 'B', position: 0 }]);
  });
  test(lane + ': dragging across several rows reaches exact target', async () => {
    const sample = fixture(lane, ['A', 'B', 'C', 'D']);
    await sample.drag(3, 1, 999);
    assert.deepEqual(sample.calls, [{ lane, id: 'D', position: 1 }]);
  });
  test(lane + ': dropping onto self is a no-op', async () => {
    const sample = fixture(lane, ['A', 'B']);
    await sample.drag(0, 0);
    assert.equal(sample.calls.length, 0);
  });
}
