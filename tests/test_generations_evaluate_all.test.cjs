const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const script = fs.readFileSync(path.join(__dirname, '../tool/js/test_generations.js'), 'utf8');
const start = script.indexOf('  async function runReferenceComparison() {');
const end = script.indexOf('  function runTestVlBatch() {', start);
assert.ok(start >= 0 && end > start, 'Reference evaluation function must exist');
const source = script.slice(start, end) + '\nthis.run = runReferenceComparison;';

function harness(failDino = false) {
  const requests = [], errors = [], payloads = [], shownPairs = [];
  const elements = {
    'test-generations-evaluator': { value: 'rvn', disabled: false },
    'test-generations-reference-run': { disabled: false },
    'test-generations-reference-status': { textContent: '' },
  };
  const references = {
    busy: false, runAll: true, folder: 'set1', session: 'session1',
    plan: [{ choice: { group: 'color', term: 'red', media: 'ref.png', runId: 'run-1' },
      attribute: { id: 'color', label: 'Color', options: ['red', 'blue'] } }],
  };
  const sandbox = {
    referenceCompare: references,
    el: id => elements[id],
    currentStatus: { session: 'session1', results: [{ mediaFile: 'media.png' }] },
    resultMediaFile: item => item.mediaFile,
    testReferenceRequest: async args => {
      payloads.push(args);
      requests.push(args.action + ':' + (args.method || 'save'));
      if (failDino && args.method === 'dino') throw Error('DINO failed');
      return args.action === 'evaluate' && args.method === 'rvn' ? { job: { jobId: 'llm1' } } : {};
    },
    trackTransientLlmJob: () => {},
    waitForCaptionAssistJob: async () => ({ result: { text: 'OPTION: 1\nVERDICT: MATCH' } }),
    getCaptionVisionModelId: () => 'vision-A',
    getRequirementGroupAlias: group => group === 'color' ? 'Garment color' : '',
    drawReferenceResults: () => {},
    showReferencePair: (file, value) => shownPairs.push({ file, value }),
    reportConsoleError: (...args) => errors.push(args),
    testVlRuns: {},
    testVlScope: () => 'key',
    runTestVlBatch: () => requests.push('queue:original'),
  };
  vm.runInNewContext(source, sandbox);
  return { run: sandbox.run, requests, errors, references, elements, payloads, shownPairs };
}

test('Evaluate All saves VL reference, runs DINO, then queues Original VL', async () => {
  const h = harness();
  await h.run();
  assert.deepEqual(h.requests, ['evaluate:rvn', 'save:save', 'evaluate:dino', 'queue:original']);
  assert.equal(h.payloads[0].groupAlias, 'Garment color');
  assert.equal(h.shownPairs.length, 3);
  assert.equal(h.shownPairs[0].file, 'media.png');
  assert.equal(h.shownPairs[0].value.reference, 'ref.png');
  assert.equal(h.shownPairs[1].value.verdict, 'MATCH');
  assert.equal(h.shownPairs[2].value.method, 'dino');
  assert.equal(h.references.busy, false);
  assert.equal(h.references.runAll, false);
});

test('Evaluate All stops on reference error before Original VL', async () => {
  const h = harness(true);
  await assert.rejects(h.run(), /DINO failed/);
  assert.deepEqual(h.requests, ['evaluate:rvn', 'save:save', 'evaluate:dino']);
  assert.equal(h.errors.length, 1);
  assert.equal(h.references.busy, false);
  assert.equal(h.references.runAll, false);
});

test('Evaluation control retains compare access while Original VL is running', () => {
  assert.ok(script.includes("button.textContent = 'Evaluate ▾';"));
  assert.ok(script.includes("testVl.running ? 'Stop Original VL' : 'Ask VL · Original'"));
  assert.ok(!script.includes("if (testVl.running) { try { stopTestVl(); }"));
});
