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
test('Test preview footer shows the existing aggregate human rating beside epoch', () => {
  const card = fs.readFileSync(path.join(root, 'tool/js/test_preview_card.js'), 'utf8');
  assert.ok(card.includes('epochRating.dataset.testEpochAggregateRating = \'1\''));
  assert.ok(card.includes("node('span', 'test-generations-epoch-rating hidden')"));
  assert.ok(testJS.includes("card.querySelector('[data-test-epoch-aggregate-rating]')"));
  assert.ok(testJS.includes("'Aggregate human rating across '"));
  assert.ok(testJS.includes('prepared.candidateScores && prepared.candidateScores[candidate]'));
  assert.ok(testJS.includes('aggregateCount <= 0'));
});

test('original controls and generated evidence owners preserved', () => {
  for (const id of ['test-generations-run-btn','test-generations-inline-count',
      'test-generations-files','test-generations-sessions-list','epoch-finder-start',
      'epoch-finder-manual-matrix','test-references-gallery','run-analytics-director'])
    assert.ok(html.includes('id="'+id+'"'), id);
  assert.ok(html.indexOf('id="test-generations-body"') < html.indexOf('id="test-generations-run-btn"'));
});

test('Evaluation Matrix follows Screening rows and preserves playable preview cards on refresh', async () => {
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
  const writes = [];
  const asked = [];
  const context = {
    document, Event: dom.window.Event, window: {updateTestPreviewCardRating() {}},
    resultsView: 'matrix', selectedCandidates, matrixRatingPending: new Set(),
    previewSort:'original', testVl: {scope:'',entries:{}},
    testVlScope: status => 'test|' + status.session,
    testVlScore: comparison => comparison,
    prepared: {files: ['epoch07.safetensors', 'epoch08.safetensors']},
    currentStatus: {}, queuedTestJobs: [],
    currentTestModelId: () => 'h3',
    syncResultRatingButtons() {}, syncStagedCandidateScores() {}, syncTestVlCards() {},
    renderSessions() {}, showError(error) { throw error; },
    queueTestVlForSession(status, units) { asked.push(units.map(x => x.mediaFile)); },
    request: (name, values) => {
      if (name === 'test_rate_result') {
        writes.push(values.mediaFile);
        return Promise.resolve({rating: values.rating});
      }
      if (name === 'test_rating_summary') return Promise.resolve({candidateScores: {}});
      throw new Error('Unexpected request: ' + name);
    },
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
  context.currentStatus = status;
  context.renderMatrix(status);
  const host = document.getElementById('test-generations-matrix');
  assert.deepEqual(Array.from(host.querySelectorAll('.test-generations-matrix-prompt strong'),
    x => x.textContent), ['Red', 'Blue']);
  assert.deepEqual(Array.from(host.querySelectorAll('.test-generations-matrix-prompt strong'),
    x => x.title), ['A red jacket', 'A blue jacket']);
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
  assert.equal(row.querySelectorAll('[data-matrix-bulk-rating]').length, 5);
  row.querySelector('[data-matrix-ask-vl]').click();
  assert.deepEqual(asked, [['a.mp4', 'b.mp4']]);
  await context.rateMatrixRow('test-one', row.dataset.matrixKey, 3);
  assert.deepEqual(writes, ['a.mp4', 'b.mp4']);
  assert.equal(status.results[0].rating, 3);
  assert.equal(status.results[1].rating, 3);
  assert.equal(row.querySelectorAll('[data-matrix-bulk-rating][aria-pressed="true"]').length, 1);
  assert.equal(row.querySelectorAll('.test-generations-result-card').length, 2);
  assert.strictEqual(row.querySelector('.test-generations-result-card'), card);
  status.results.push({kind:'lora',candidateFile:'epoch08.safetensors',
    mediaFile:'c.mp4',variationIndex:0,rating:5});
  context.previewSort = 'rating';
  context.renderMatrix(status);
  assert.equal(host.querySelector('.test-generations-matrix-row').dataset.matrixKey,
    JSON.stringify(['lora','epoch08.safetensors','']));
  assert.strictEqual(row.querySelector('.test-generations-result-card'), card,
    'sorting checkpoint rows must not rebuild existing videos');
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
  assert.match(css, /--matrix-card-width:\s*500px/);
  assert.match(css, /grid-template-columns:\s*repeat\(var\(--matrix-columns\), var\(--matrix-card-width\)\)/);
  assert.match(css, /\.test-generations-matrix-scroll\s*\{[^}]*overflow:\s*auto/s);
  assert.match(css, /\.test-generations-matrix-labels\s*\{[^}]*position:\s*sticky/s);
  assert.match(css, /\.test-generations-matrix-scroll\s*\{[^}]*container-type:\s*inline-size/s);
  assert.match(css, /\.test-generations-matrix-row-head\s*\{[^}]*left:\s*0;[^}]*width:\s*100cqw/s);
  assert.match(css, /\.test-generations-matrix-row-primary \.test-generations-candidate-checkbox\s*\{[^}]*width:\s*20px/s);
});

test('Matrix individual preview stars persist ratings and refresh checkpoint summary', async () => {
  const {JSDOM} = require('jsdom');
  const vm = require('node:vm');
  const dom = new JSDOM('<div id="test-generations-matrix"><div class="test-generations-result-rating">' +
    '<button data-test-rating="4" data-media-file="clip.mp4" data-test-session="session-x">☆</button>' +
    '</div></div>');
  const document = dom.window.document;
  const writes = [];
  const status = {session:'session-x',results:[{mediaFile:'clip.mp4',rating:0}]};
  let refreshed = 0;
  const ctx = {
    document, currentStatus: status, resultsView: 'matrix', previewSort: 'original',
    prepared: null, queuedTestJobs: [], currentTestModelId: () => 'h3',
    resultMediaFile: item => item.mediaFile,
    renderMatrix: () => { refreshed++; },
    refreshTestPreviewOrder: () => { throw new Error('unexpected sort'); },
    syncStagedCandidateScores() {}, syncTestVlCards() {}, renderSessions() {},
    showError: error => { throw error; },
    request: (name, params) => {
      if (name === 'test_rate_result') {
        writes.push(params);
        return Promise.resolve({rating:params.rating});
      }
      if (name === 'test_rating_summary') return Promise.resolve({candidateScores:{}});
      throw Error(name);
    },
    window: {}
  };
  vm.createContext(ctx);
  const handlers = testJS.slice(testJS.indexOf('  function syncResultRatingButtons('),
    testJS.indexOf('  function buildResultRemoveButton('));
  vm.runInContext(handlers, ctx);
  const start = testJS.indexOf("    el('test-generations-matrix').onclick = function (event) {");
  const end = testJS.indexOf("    el('test-generations-prompt').addEventListener('input'", start);
  assert.ok(start > 0 && end > start, 'Matrix card actions must be delegated');
  ctx.el = id => document.getElementById(id);
  vm.runInContext(testJS.slice(start,end),ctx);
  const star = document.querySelector('[data-test-rating]');
  star.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes.length, 1);
  assert.deepEqual({...writes[0]}, {session:'session-x',mediaFile:'clip.mp4',rating:4});
  assert.equal(status.results[0].rating, 4);
  assert.equal(star.textContent, '★');
  assert.equal(refreshed, 1);
});

test('Matrix uses Screening wildcard choices and keeps full prompts in session details', () => {
  assert.ok(testJS.includes("heading.textContent = choice;"));
  assert.ok(testJS.includes("heading.title = prompt;"));
  assert.ok(testJS.includes('<summary>Variation prompts</summary>'));
  assert.ok(testJS.includes("['test-generations-results','test-generations-compare','test-generations-matrix']"));
  const sort = testJS.split('function refreshTestPreviewOrder()',2)[1]
    .split('function comparePairs(status)',1)[0];
  assert.ok(sort.includes("if (resultsView === 'grid') sortTestPreviewCards(currentStatus);"));
  assert.ok(sort.includes("else if (resultsView === 'matrix') renderMatrix(currentStatus);"));
});
