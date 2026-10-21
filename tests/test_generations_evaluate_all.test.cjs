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
    showLiveReferencePair: (file, value) => shownPairs.push({ file, value }),
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


test('Training Reference viewer shows the exact A/B media and restores latest saved evidence', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<div id="test-generations-reference-pair"></div><div id="test-generations-reference-results"></div>');
  const readStart = script.indexOf('  var referenceCompare = ');
  const readEnd = script.indexOf('  function openReferenceDialog() {', readStart);
  assert.ok(readStart >= 0 && readEnd > readStart);
  const saved = {references:{byMedia:{
    'render.png':{
      'rvn|Shape|rear':{method:'rvn',group:'Shape',option:'rear',reference:'ref.png',
        verdict:'UNCLEAR',response:'OPTION: 1\nVERDICT: UNCLEAR\nREASON: Rear detail is not visible.',
        at:10},
      'dino|Shape|rear':{method:'dino',group:'Shape',option:'rear',reference:'ref.png',
        similarity:0.78,at:20}
    }
  }}};
  const sandbox = {
    document:dom.window.document,
    el:id=>dom.window.document.getElementById(id),
    captionAssistRequestJson:async()=>saved,
    escapeHtml:value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'),
    showError:error=>{throw error}
  };
  vm.runInNewContext(script.slice(readStart, readEnd) +
    '\nthis.referenceCompare = referenceCompare;this.showReferencePair = showReferencePair;' +
    '\nthis.showLiveReferencePair = showLiveReferencePair;this.drawReferenceResults = drawReferenceResults;',sandbox);
  const compare = sandbox.referenceCompare;
  compare.folder = 'set1'; compare.session = 'session1'; compare.resultMethod = 'all';
  sandbox.showReferencePair('render.png', {reference:'ref.png',group:'Shape',option:'rear',
    method:'rvn',previewOnly:true});
  const pair = dom.window.document.getElementById('test-generations-reference-pair');
  assert.match(pair.textContent, /Preview only/);
  const images = Array.from(pair.querySelectorAll('img'));
  assert.equal(images.length, 2);
  assert.equal(images[0].getAttribute('src'), '/caption/media?folder=set1&media=ref.png');
  assert.equal(images[1].getAttribute('src'),
    '/fs/test_generations/media?folder=set1&session=session1&media=render.png');
  sandbox.drawReferenceResults();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(compare.rows.length, 2);
  assert.match(pair.textContent, /DINO cosine 0\.780/);
  assert.ok(!pair.textContent.includes('Comparing…'));
  sandbox.showReferencePair('render.png', compare.rows.find(row=>row.value.method==='rvn').value);
  assert.match(pair.textContent, /Rear detail is not visible/);
  compare.pinned = true;
  sandbox.showLiveReferencePair('render2.png', {reference:'ref2.png',group:'Shape',option:'front',method:'rvn'});
  assert.match(pair.textContent, /Rear detail is not visible/);
  assert.equal(compare.livePair.file,'render2.png');
});
