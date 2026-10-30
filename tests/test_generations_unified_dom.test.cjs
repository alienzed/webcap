// Retired unified builder must not borrow native Evaluation DOM.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'tool/tool.html'), 'utf8');
const testJS = fs.readFileSync(path.join(root, 'tool/js/test_generations.js'), 'utf8');
const finder = fs.readFileSync(path.join(root, 'tool/js/epoch_finder.js'), 'utf8');

test('native Evaluation methods reachable and obsolete shells absent', () => {
  const nav = html.split('<nav id="test-workspace-main-tabs"', 2)[1].split('</nav>', 1)[0];
  for (const mode of ['tests','screening','finder','analytics','references'])
    assert.ok(nav.includes('data-test-workspace-mode="'+mode+'"'), mode);
  for (const obsolete of ['id="test-unified-workspace"', 'data-test-generations-perspective',
      'src="/static/js/test_generations_unified.js"',
      'src="/static/js/test_generations_perspective.js"'])
    assert.ok(!html.includes(obsolete), obsolete);
  assert.ok(!testJS.includes('testGenerationsUnifiedNativeRoute'));
  assert.match(finder, /window\.epochFinderShowMode = showMode/);
});
test('original controls and generated evidence owners preserved', () => {
  for (const id of ['test-generations-run-btn','test-generations-inline-count',
      'test-generations-files','test-generations-sessions-list','epoch-finder-start',
      'epoch-finder-manual-matrix','test-references-gallery','run-analytics-director'])
    assert.ok(html.includes('id="'+id+'"'), id);
  assert.ok(html.indexOf('id="test-generations-body"') < html.indexOf('id="test-generations-run-btn"'));
});

test('Evaluation Matrix follows Screening rows and preserves playable preview cards on refresh', () => {
  const {JSDOM} = require('jsdom');
  const vm = require('node:vm');
  const dom = new JSDOM(`<div id="test-generations-matrix"></div>
    <div id="test-generations-files"><input data-candidate-select="epoch07.safetensors" checked>
      <input data-candidate-select="epoch08.safetensors" checked></div>
    <input id="test-generations-base-include" type="checkbox" checked>`);
  const document = dom.window.document;
  const selectedCandidates = new Set(['epoch07.safetensors', 'epoch08.safetensors']);
  document.getElementById('test-generations-files').addEventListener('change', function (event) {
    const file = event.target.dataset.candidateSelect;
    if (event.target.checked) selectedCandidates.add(file);
    else selectedCandidates.delete(file);
  });
  const source = testJS.slice(testJS.indexOf('  function matrixCandidateKey('),
    testJS.indexOf('  function setResultsView(mode)'));
  assert.ok(source.includes('function renderMatrix(status)'), 'Matrix renderer not found');
  let created = 0;
  const context = {
    document, Event: dom.window.Event, window: {updateTestPreviewCardRating() {}},
    resultsView: 'matrix', selectedCandidates,
    prepared: {files: ['epoch07.safetensors', 'epoch08.safetensors']},
    el: id => document.getElementById(id),
    candidateIdentity: item => ({
      primary: item.kind === 'base' ? 'Base' : String(item.candidateFile || 'Epoch'),
      secondary: ''
    }),
    candidateFileForResult: item => String(item.candidateFile || ''),
    resultMediaFile: item => String(item.mediaFile || ''),
    testVlCandidateScores: () => ({}),
    renderTestVlCard() {},
    sharedTestCard: () => {
      created += 1;
      const card = document.createElement('article');
      card.className = 'test-generations-result-card';
      const video = document.createElement('video');
      video.preload = 'metadata';
      card.appendChild(video);
      return card;
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const status = {
    session: 'test-one', resolvedPrompt: 'A plain prompt', candidates: [
      {kind:'lora',fileName:'epoch07.safetensors',provenance:{sourceEpoch:7}},
      {kind:'lora',fileName:'epoch08.safetensors',provenance:{sourceEpoch:8}}
    ],
    variationCases: [
      {label:'Red',prompt:'A red jacket'},
      {label:'Blue',prompt:'A blue jacket'}
    ],
    results: [{kind:'lora',candidateFile:'epoch07.safetensors',
      mediaFile:'a.mp4',variationIndex:0,rating:4}], failures: []
  };
  context.renderMatrix(status);
  const host = document.getElementById('test-generations-matrix');
  assert.deepEqual(Array.from(host.querySelectorAll('.test-generations-matrix-prompt strong'),
    x => x.textContent), ['A red jacket', 'A blue jacket']);
  assert.equal(host.querySelectorAll('.test-generations-matrix-row').length, 2);
  assert.equal(host.querySelectorAll('.test-generations-matrix-cell').length, 4);
  const row = host.querySelector('.test-generations-matrix-row');
  const card = row.querySelector('.test-generations-result-card');
  assert.equal(card.querySelector('video').preload, 'metadata', 'Matrix must not disable video preloading');
  context.renderMatrix(status);
  assert.strictEqual(row.querySelector('.test-generations-result-card'), card);
  assert.equal(created, 1, 'polling must preserve the original video');
  status.results.push({kind:'lora',candidateFile:'epoch07.safetensors',
    mediaFile:'b.mp4',variationIndex:1,rating:5});
  context.renderMatrix(status);
  assert.strictEqual(row.querySelector('.test-generations-result-card'), card);
  assert.equal(row.querySelectorAll('.test-generations-result-card').length, 2);
  const checkbox = row.querySelector('[data-matrix-candidate]');
  checkbox.checked = false;
  checkbox.dispatchEvent(new dom.window.Event('change', {bubbles:true}));
  assert.equal(selectedCandidates.has('epoch07.safetensors'), false);
  assert.equal(row.classList.contains('is-collapsed'), true);
  row.querySelector('[data-matrix-collapse]').click();
  assert.equal(row.classList.contains('is-collapsed'), false);
  assert.equal(row.querySelector('[data-matrix-collapse]').getAttribute('aria-expanded'), 'true');
});

test('Evaluation Matrix uses regular Grid card width and horizontal scrolling', () => {
  const css = fs.readFileSync(path.join(root,'tool/css/styles.css'),'utf8');
  assert.match(css, /--matrix-card-width:\\s*500px/);
  assert.match(css, /grid-template-columns:\\s*repeat\\(var\\(--matrix-columns\\), var\\(--matrix-card-width\\)\\)/);
  assert.match(css, /\\.test-generations-matrix-scroll\\s*\\{[^}]*overflow:\\s*auto/s);
  assert.match(css, /\\.test-generations-matrix-labels\\s*\\{[^}]*position:\\s*sticky/s);
});
