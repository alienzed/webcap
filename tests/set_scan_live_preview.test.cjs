'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('tool/js/set_scan.js', 'utf8');

function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'Missing Set Intelligence code section: ' + start);
  return source.slice(from, to);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function until(predicate) {
  for (let i = 0; i < 20; i++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('Expected asynchronous Sight transition did not complete.');
}

test('Live preview follows the last saved Sight, not an in-flight image or an invalid attempt', async () => {
  const requests = [];
  const saves = [];
  const failures = [];
  const rendered = [];
  const setScanState = {
    stopRequested: false,
    previewFileName: '',
    rawResponses: [],
    rawResponseIndex: -1,
    currentRawResponse: null,
    completed: 0,
    coverage: { total: 3, openCurrent: 0 }
  };
  const context = vm.createContext({
    setScanState,
    state: { folder: '/sample' },
    setSetIntelligenceStatus() {},
    renderSetIntelligence() {
      const latest = setScanState.rawResponses.find(row => row.media === setScanState.previewFileName);
      rendered.push({ media: setScanState.previewFileName, description: latest && latest.description });
    },
    requestSight(folder, model, media) {
      const request = deferred();
      requests.push({ media, ...request });
      return request.promise;
    },
    saveSight(folder, model, media) {
      const save = deferred();
      saves.push({ media, ...save });
      return save.promise;
    },
    saveSightAttempt() { return Promise.resolve({ ok: true }); },
    recordSetIntelligenceFailure(stage, media, issue) { failures.push({ media, issue }); },
    reportConsoleError(label, error) { assert.fail(label + ': ' + String(error)); },
    reportConsoleInfo() {},
    publishSetIntelligenceActivity() {}
  });
  vm.runInContext(
    section('  function showRawResponse(fileName, passLabel, text, sight) {',
      '  function viewSelectedSightResponse() {') +
    section('  function scanNext(pending, index, folder, model, groups) {',
      '  function scanVision(folder, files, model, force, groups, explicitFiles) {') +
    '\nthis.run = scanNext;',
    context
  );

  const scan = context.run(['first.jpg', 'second.jpg', 'third.jpg'], 0, '/sample', 'model', []);
  assert.equal(requests[0].media, 'first.jpg');
  assert.equal(setScanState.previewFileName, '', 'First pending item has no finished Sight');

  requests[0].resolve({ sight: { description: 'First saved observation.' }, text: 'raw first', warning: '' });
  await until(() => saves.length === 1);
  assert.equal(setScanState.previewFileName, '', 'Model output is not inspectable until saving finishes');
  assert.equal(setScanState.rawResponses.length, 1, 'Raw model output remains available');

  saves[0].resolve({ ok: true });
  await until(() => requests.length === 2);
  assert.equal(requests[1].media, 'second.jpg');
  assert.equal(setScanState.previewFileName, 'first.jpg', 'Next processing item does not replace finished preview');
  assert.equal(rendered.at(-1).description, 'First saved observation.');

  requests[1].resolve({ sight: null, text: 'Invalid structured response', warning: 'Parse error' });
  await until(() => requests.length === 3);
  assert.equal(setScanState.previewFileName, 'first.jpg', 'Invalid output does not displace completed Sight');
  assert.equal(setScanState.rawResponses.length, 2, 'Invalid output remains available in the raw report');
  assert.equal(failures.length, 1);

  requests[2].resolve({ sight: { description: 'Third saved observation.' }, text: 'raw third', warning: '' });
  await until(() => saves.length === 2);
  assert.equal(setScanState.previewFileName, 'first.jpg', 'Next output waits for persistence');
  saves[1].resolve({ ok: true });
  assert.equal(await scan, true);
  assert.equal(setScanState.previewFileName, 'third.jpg');
  assert.equal(rendered.at(-1).description, 'Third saved observation.');
  assert.equal(setScanState.completed, 3);
});

test('Inspection UI waits for the first completion and displays matching media plus description', () => {
  const block = section('    var responses = Array.isArray(setScanState.rawResponses)',
    '  function updateSightPreviewMedia(image, video, folder, file) {').replace(/\n  }\s*$/, '');
  const nodes = {};
  function node() {
    return {
      textContent: '', disabled: false, value: '', children: [], innerHTML: '',
      classList: { toggle() {} },
      appendChild(child) { this.children.push(child); }
    };
  }
  const ids = [
    'set-scan-preview-name', 'set-scan-preview-review', 'set-scan-preview-image',
    'set-scan-preview-video', 'set-scan-preview-text'
  ];
  ids.forEach(id => { nodes[id] = node(); });
  const files = [];
  const setScanState = {
    running: true,
    folder: '/sample',
    previewFileName: '',
    rawResponses: [],
    rawResponseIndex: -1,
    inspectionMissingFile: ''
  };
  const context = vm.createContext({
    setScanState, el: id => nodes[id],
    document: { createElement: () => node() },
    details: node(), reportCount: node(), responseSelect: node(), output: node(),
    updateSightPreviewMedia(_image, _video, _folder, file) { files.push(file); }
  });
  const renderPreview = vm.runInContext('(function (itemSelect, items) {\n' + block + '\n})', context);
  const itemSelect = { value: 'first.jpg' };
  const items = [{ file: 'first.jpg', sight: { description: 'Cached first observation' } }];

  renderPreview(itemSelect, items);
  assert.equal(nodes['set-scan-preview-name'].textContent, 'Waiting for completed Sight');
  assert.equal(nodes['set-scan-preview-review'].disabled, true);
  assert.match(nodes['set-scan-preview-text'].textContent, /first completed Sight/);
  assert.equal(files.at(-1), '', 'Do not preview pending media');

  setScanState.previewFileName = 'first.jpg';
  setScanState.rawResponses.push({
    media: 'first.jpg', file: 'first.jpg · Sight', description: 'First finished caption.', text: 'raw first'
  });
  setScanState.rawResponseIndex = 0;
  renderPreview(itemSelect, items);
  assert.equal(files.at(-1), 'first.jpg');
  assert.equal(nodes['set-scan-preview-text'].textContent, 'First finished caption.');
  assert.equal(nodes['set-scan-preview-review'].disabled, false);

  // A newer raw attempt can be logged without hijacking the completed preview.
  setScanState.rawResponses.push({ media: 'second.jpg', file: 'second.jpg · invalid', text: 'bad result' });
  setScanState.rawResponseIndex = 1;
  renderPreview(itemSelect, items);
  assert.equal(files.at(-1), 'first.jpg');
  assert.equal(nodes['set-scan-preview-text'].textContent, 'First finished caption.');

  setScanState.running = false;
  setScanState.previewFileName = '';
  renderPreview(itemSelect, items);
  assert.equal(files.at(-1), 'first.jpg', 'Non-running manual selection still works');
  assert.equal(nodes['set-scan-preview-text'].textContent, 'First finished caption.');
});

test('New scanning sessions reset their preview and a failed restart preserves the prior selection', () => {
  assert.match(source, /previewFileName: setScanState.previewFileName,\s+coverage: Object\.assign/);
  assert.match(source, /setScanState\.previewFileName = '';\s+setScanState\.visionModel = '';/);
  assert.match(source, /setScanState\.previewFileName = previousReport\.previewFileName;/);
});
