'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('tool/js/primer_settings.js', 'utf8');
const start = source.indexOf('function refreshCaptionAssistCurrentCandidate() {');
const end = source.indexOf('// The editor and docked candidate use one geometry source', start);
assert.ok(start >= 0 && end > start, 'Caption Assist refresh has a stable implementation');

function harness(options = {}) {
  const calls = [];
  const item = {key: 'photo-1'};
  const candidate = options.candidate === false ? null :
    {mediaKey: options.mismatched ? 'photo-2' : item.key, text: 'Edited candidate'};
  const context = {
    window: {openOperationsDrawer(section) { calls.push('drawer:' + section); }},
    captionAssistCandidate: candidate,
    getPrimerResetCurrentMediaItem: () => item,
    cancelCaptionAssistEnrichment: () => calls.push('cancel-enrichment'),
    isCaptionAssistRunning: () => !!options.running,
    cancelFocusedCaptionPrefetch: () => { calls.push('cancel-prefetch'); return Promise.resolve(); },
    cancelCurrentCaptionVision: () => { calls.push('cancel-vision'); return Promise.resolve(); },
    runCaptionAssistAfterSight: draft => { calls.push('submit:' + draft); return Promise.resolve(true); }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  return {calls, refresh: context.refreshCaptionAssistCurrentCandidate};
}

test('manual Refresh reveals Activity immediately, before asynchronous request work', async () => {
  const h = harness();
  const pending = h.refresh();
  assert.deepEqual(h.calls, ['cancel-enrichment', 'drawer:activity', 'cancel-prefetch']);
  assert.equal(await pending, true);
  assert.deepEqual(h.calls, [
    'cancel-enrichment', 'drawer:activity', 'cancel-prefetch',
    'cancel-vision', 'submit:Edited candidate'
  ]);
});

test('Refresh does not open Activity for invalid or busy requests', async () => {
  const invalid = harness({mismatched:true});
  assert.throws(() => invalid.refresh(), /requires a current editable candidate/);
  assert.deepEqual(invalid.calls, ['cancel-enrichment']);
  const running = harness({running:true});
  assert.equal(await running.refresh(), false);
  assert.deepEqual(running.calls, ['cancel-enrichment']);
});
