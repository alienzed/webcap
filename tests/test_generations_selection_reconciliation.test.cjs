const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../tool/js/test_generations.js'), 'utf8');

test('Grid inclusion overlays share staged candidate selection without replacing previews', () => {
  const dom = new JSDOM('<div id="test-generations-results"></div>' +
    '<div id="test-generations-files"><input type="checkbox" data-candidate-select="epoch07.safetensors" checked></div>');
  const document = dom.window.document;
  const host = document.getElementById('test-generations-results');
  const selectedCandidates = new Set(['epoch07.safetensors']);
  const context = {
    document, Event: dom.window.Event, selectedCandidates,
    prepared: {files: ['epoch07.safetensors']},
    el: id => document.getElementById(id)
  };
  vm.createContext(context);
  vm.runInContext('selectedCandidates = new Set(["epoch07.safetensors"])', context);
  const start = source.indexOf('  function syncGridCandidateSelection()');
  const end = source.indexOf('  function syncMatrixCandidateSelection()', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), context);
  const staged = document.querySelector('[data-candidate-select]');
  staged.addEventListener('change', () => {
    if (staged.checked) context.selectedCandidates.add(staged.dataset.candidateSelect);
    else context.selectedCandidates.delete(staged.dataset.candidateSelect);
    context.syncGridCandidateSelection();
  });
  const delegateStart = source.indexOf("    el('test-generations-results').addEventListener('change'");
  const delegateEnd = source.indexOf("    el('test-generations-results').onclick", delegateStart);
  assert.ok(delegateStart >= 0 && delegateEnd > delegateStart);
  vm.runInContext(source.slice(delegateStart, delegateEnd), context);
  function card(key, file) {
    const node = document.createElement('article');
    node.className = 'test-generations-result-card';
    node.dataset.resultKey = key;
    node.dataset.testCandidateFile = file;
    const video = document.createElement('video');
    node.appendChild(video);
    host.appendChild(node);
    return {node, video};
  }
  const one = card('one', 'epoch07.safetensors');
  const two = card('two', 'epoch07.safetensors');
  const historical = card('old', 'unstaged.safetensors');

  context.syncGridCandidateSelection();
  assert.equal(host.querySelectorAll('[data-test-grid-select]').length, 2);
  assert.equal(one.node.querySelector('[data-test-grid-select]').checked, true);
  assert.equal(historical.node.querySelector('[data-test-grid-select]'), null);
  const toggle = one.node.querySelector('[data-test-grid-select]');
  toggle.checked = false;
  toggle.dispatchEvent(new dom.window.Event('change', {bubbles:true}));
  assert.equal(staged.checked, false);
  assert.equal(context.selectedCandidates.has('epoch07.safetensors'), false);
  assert.equal(two.node.querySelector('[data-test-grid-select]').checked, false);
  assert.equal(one.node.classList.contains('is-excluded'), true);
  assert.strictEqual(one.node.querySelector('video'), one.video);
  assert.strictEqual(two.node.querySelector('video'), two.video);
  toggle.checked = true;
  toggle.dispatchEvent(new dom.window.Event('change', {bubbles:true}));
  assert.equal(context.selectedCandidates.has('epoch07.safetensors'), true);
  assert.equal(two.node.querySelector('[data-test-grid-select]').checked, true);
  context.prepared.files = [];
  context.syncGridCandidateSelection();
  assert.equal(host.querySelectorAll('[data-test-grid-select]').length, 0);
  assert.strictEqual(one.node.querySelector('video'), one.video);
});

test('Matrix removes and adds candidate rows without resetting neighboring media or scroll', () => {
  const dom = new JSDOM('<div id="test-generations-matrix"></div>' +
    '<div id="test-generations-files"></div>' +
    '<input type="checkbox" id="test-generations-base-include" checked>');
  const document = dom.window.document;
  const files = ['epoch07.safetensors','epoch08.safetensors','epoch09.safetensors'];
  const selectedCandidates = new Set(files);
  const staged = document.getElementById('test-generations-files');
  files.forEach(file => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.candidateSelect = file;
    staged.appendChild(input);
  });
  let created = 0;
  const context = {
    document, Event: dom.window.Event, window: {updateTestPreviewCardRating() {}},
    resultsView: 'matrix', selectedCandidates, matrixRatingPending: new Set(),
    previewSort: 'original', testVl: {scope:'', entries:{}},
    testVlScope: status => 'test|' + status.session,
    testVlScore: comparison => comparison,
    prepared: {files: files.slice()}, currentStatus: {},
    el: id => document.getElementById(id),
    candidateIdentity: item => ({primary: String(item.candidateFile || ''), secondary:''}),
    candidateFileForResult: item => String(item.candidateFile || ''),
    resultMediaFile: item => String(item.mediaFile || ''),
    testVlCandidateScores: () => ({}),
    renderTestVlCard() {},
    sharedTestCard: () => {
      created++;
      const card = document.createElement('article');
      card.className = 'test-generations-result-card';
      card.appendChild(document.createElement('video'));
      return card;
    }
  };
  vm.createContext(context);
  const begin = source.indexOf('  function matrixCandidateKey(');
  const end = source.indexOf('  function setResultsView(mode)', begin);
  assert.ok(begin >= 0 && end > begin);
  vm.runInContext(source.slice(begin,end), context);
  const status = {session:'session-one', results:[], failures:[],
    variationCases:[{label:'Red',prompt:'A red shirt'},{label:'Blue',prompt:'A blue shirt'}],
    candidates:files.map((file,i) => ({kind:'lora',fileName:file,provenance:{sourceEpoch:i+7}}))};
  status.results = files.map((file,i) => ({
    kind:'lora', candidateFile:file, mediaFile:'sample-'+i+'.mp4', variationIndex:0, rating:0
  }));
  context.currentStatus = status;
  context.renderMatrix(status);
  const host = document.getElementById('test-generations-matrix');
  const scroller = host.querySelector('.test-generations-matrix-scroll');
  const rows = Array.from(host.querySelectorAll('.test-generations-matrix-row'));
  const videos = rows.map(row => row.querySelector('video'));
  assert.equal(created, 3);
  scroller.scrollLeft = 90;
  scroller.scrollTop = 35;

  status.candidates.splice(1,1);
  status.results.splice(1,1);
  context.prepared.files.splice(1,1);
  selectedCandidates.delete(files[1]);
  context.renderMatrix(status);
  const remaining = Array.from(host.querySelectorAll('.test-generations-matrix-row'));
  assert.equal(remaining.length, 2);
  assert.strictEqual(host.querySelector('.test-generations-matrix-scroll'), scroller);
  assert.strictEqual(remaining[0], rows[0]);
  assert.strictEqual(remaining[1], rows[2]);
  assert.strictEqual(remaining[0].querySelector('video'), videos[0]);
  assert.strictEqual(remaining[1].querySelector('video'), videos[2]);
  assert.equal(scroller.scrollLeft, 90);
  assert.equal(scroller.scrollTop, 35);
  assert.equal(created, 3, 'unchanged candidate media must not be recreated');

  const additional = 'epoch10.safetensors';
  context.prepared.files.push(additional);
  selectedCandidates.add(additional);
  status.candidates.push({kind:'lora',fileName:additional});
  status.results.push({kind:'lora',candidateFile:additional,mediaFile:'sample-10.mp4',variationIndex:0,rating:0});
  context.renderMatrix(status);
  assert.equal(host.querySelectorAll('.test-generations-matrix-row').length, 3);
  assert.strictEqual(rows[0].querySelector('video'), videos[0]);
  assert.strictEqual(rows[2].querySelector('video'), videos[2]);
  assert.equal(created, 4, 'only the new candidate receives a preview');

  status.variationCases.push({label:'Green',prompt:'A green shirt'});
  context.renderMatrix(status);
  assert.notStrictEqual(host.querySelector('.test-generations-matrix-scroll'), scroller,
    'genuine column structure changes may rebuild Matrix');
});
