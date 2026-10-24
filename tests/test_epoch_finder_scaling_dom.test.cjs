const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync('tool/js/epoch_finder.js', 'utf8');
function extract(start, end) {
  const a = source.indexOf('  function ' + start + '(');
  const b = source.indexOf('  function ' + end + '(', a);
  assert.ok(a >= 0 && b > a, 'Screening implementation must be present');
  return source.slice(a, b);
}

function harness(count, initiallyKept) {
  const dom = new JSDOM('<div id="manual-matrix"></div><select id="manual-sort"><option value="epoch">Epoch</option></select><button id="manual-vl-round"></button><button id="manual-launch"></button>');
  const document = dom.window.document;
  const epochs = Array.from({length: count}, (_, i) => i + 1);
  const campaign = {
    id: 'screening-large', mode: 'manual', status: 'running', round: 1,
    kept: epochs.slice(0, initiallyKept),
    candidateMap: Object.fromEntries(epochs.map(e => [e, {epoch: e, jobId: 'run-1'}])),
    rounds: [{
      number: 1, status: 'running', epochs, seeds: [1, 2, 3],
      columnLabels: ['Front', 'Side', 'Back'],
      caseSelections: [[], [], []],
    }],
    units: epochs.flatMap(epoch => [0, 1, 2].map(c => ({
      round: 1, epoch, case: c, frame: 'r1-e' + epoch + '-c' + c + '.png',
      error: '', rating: 0,
    }))),
  };
  let created = 0;
  dom.window.updateTestPreviewCardRating = () => {};
  const ctx = {
    document, window: dom.window, currentFolder: 'sets/demo', campaignState: campaign,
    manualSelectedRound: 1, manualSelectionCampaign: '', runEpochSelections: {},
    screeningTestStatus: {}, screeningCopyPending: new Set(),
    screeningRatingPending: new Set(), screeningSkipPending: new Set(), screeningExpandedExcluded: new Set(),
    screeningSkipEpoch: (_campaign, round, epoch) => {ctx.lastSkipped = {round, epoch};},
    screeningRoundList: () => {}, screeningRunInfo: () => {},
    screeningUpdateAverage: () => {}, stagedOrigin: () => true,
    candidateLabel: (_c, epoch) => 'Epoch ' + epoch,
    selectedCampaignCount: () => initiallyKept,
    createTestPreviewCard: opts => {
      created++;
      const card = document.createElement('article');
      card.className = opts.className || '';
      return card;
    },
    els: key => document.getElementById(key),
  };
  vm.createContext(ctx);
  vm.runInContext(extract('screeningMatrix', 'screeningRender') + '\nthis.runMatrix = screeningMatrix;', ctx);
  return {ctx, campaign, document, host: document.getElementById('manual-matrix'), get created() {return created;}};
}

test('100-epoch screening mounts only selected cards, and reuses them on polls', () => {
  const h = harness(100, 20);
  h.ctx.runMatrix(h.campaign);
  assert.equal(h.document.querySelectorAll('[data-screening-epoch]').length, 100);
  assert.equal(h.created, 60);
  assert.equal(h.document.querySelectorAll('.epoch-screening-cases .test-generations-result-card').length, 60);
  const kept = h.document.querySelector('[data-screening-epoch="1"] .test-generations-result-card');
  const excluded = h.document.querySelector('[data-screening-epoch="21"]');
  assert.ok(excluded.classList.contains('is-collapsed'));
  assert.equal(excluded.querySelector('.epoch-screening-cases').children.length, 0);

  h.ctx.runMatrix(h.campaign);
  assert.equal(h.created, 60);
  assert.equal(h.document.querySelector('[data-screening-epoch="1"] .test-generations-result-card'), kept);

  h.ctx.screeningExpandedExcluded.add('screening-large:1:21');
  h.host.dataset.signature = '';
  h.ctx.runMatrix(h.campaign);
  assert.equal(h.created, 63);
  assert.equal(excluded.querySelector('.epoch-screening-cases').children.length, 3);
  assert.equal(h.document.querySelector('[data-screening-epoch="1"] .test-generations-result-card'), kept);

  h.ctx.screeningExpandedExcluded.delete('screening-large:1:21');
  h.host.dataset.signature = '';
  h.ctx.runMatrix(h.campaign);
  assert.equal(excluded.querySelector('.epoch-screening-cases').children.length, 0);
  assert.equal(h.document.querySelectorAll('[data-screening-epoch]').length, 100);
});

test('selected epoch cards update in place when a new render arrives', () => {
  const h = harness(4, 2);
  h.campaign.units.find(u => u.epoch === 1 && u.case === 2).frame = '';
  h.ctx.runMatrix(h.campaign);
  const row1 = h.document.querySelector('[data-screening-epoch="1"]');
  const firstCard = row1.querySelector('.epoch-screening-cases').children[0];
  const previousCreated = h.created;

  h.campaign.units.find(u => u.epoch === 1 && u.case === 2).frame = 'new-render.png';
  h.ctx.runMatrix(h.campaign);
  assert.equal(row1.querySelector('.epoch-screening-cases').children[0], firstCard);
  assert.equal(h.created, previousCreated + 1);
  assert.equal(h.document.querySelector('[data-screening-epoch="3"] .epoch-screening-cases').children.length, 0);
});


test('screening skip action appears only for incomplete live epochs and preserves mounted previews', () => {
  const h = harness(2, 2);
  const live = h.campaign.units.find(u => u.epoch === 1 && u.case === 1);
  live.frame = '';
  const pending = h.campaign.units.find(u => u.epoch === 1 && u.case === 2);
  pending.frame = '';
  h.ctx.runMatrix(h.campaign);
  const row = h.document.querySelector('[data-screening-epoch="1"]');
  const preserved = row.querySelector('.epoch-screening-cases').firstChild;
  const skip = row.querySelector('.epoch-screening-skip-btn');
  assert.ok(skip, 'active partially-rendered epoch offers Skip epoch');
  assert.equal(skip.textContent, 'Skip epoch');
  assert.equal(h.document.querySelector('[data-screening-epoch="2"] .epoch-screening-skip-btn'), null,
    'finished epochs do not show Skip epoch');
  skip.click();
  assert.equal(h.ctx.lastSkipped.round, 1);
  assert.equal(h.ctx.lastSkipped.epoch, 1);
  h.campaign.rounds[0].skippedEpochs = [1];
  h.host.dataset.signature = '';
  h.ctx.runMatrix(h.campaign);
  assert.ok(h.document.querySelector('[data-screening-epoch="1"] .epoch-screening-skip-state'));
  assert.equal(h.document.querySelector('[data-screening-epoch="1"] .epoch-screening-skip-btn'), null);
  assert.equal(h.document.querySelector('[data-screening-epoch="1"] .epoch-screening-cases').firstChild, preserved,
    'captured frame DOM survives skip reconciliation');
});

test('wildcard variation cards preserve full text and column alignment through screening polls', () => {
  const h = harness(4, 2);
  h.campaign.rounds[0].columnLabels = [
    'chain-link teardrop', 'teardrop with ring connectors',
    'multi-strap chain-link teardrop'
  ];
  h.ctx.runMatrix(h.campaign);

  const labels = h.document.querySelector('.epoch-screening-case-labels');
  assert.ok(labels.classList.contains('epoch-screening-cases'),
    'headers use the same grid columns as preview media');
  const cards = Array.from(labels.children);
  assert.equal(cards.length, h.campaign.rounds[0].seeds.length);
  assert.deepEqual(cards.map(card => card.querySelector('.epoch-screening-case-number').textContent),
    ['Variation 1', 'Variation 2', 'Variation 3']);
  assert.deepEqual(cards.map(card => card.querySelector('.epoch-screening-case-choice').textContent),
    h.campaign.rounds[0].columnLabels);
  assert.ok(cards.every(card => card.querySelector('strong').title === card.querySelector('strong').textContent));

  h.ctx.runMatrix(h.campaign);
  assert.equal(h.document.querySelector('.epoch-screening-case-labels'), labels,
    'progress polling keeps sticky headers mounted');
  assert.equal(labels.firstElementChild, cards[0]);

  h.campaign.rounds[0].columnLabels[1] = 'teardrop with a different connector';
  h.host.dataset.signature = '';
  h.ctx.runMatrix(h.campaign);
  assert.equal(h.document.querySelectorAll('.epoch-screening-case-label').length, 3);
  assert.equal(h.document.querySelectorAll('.epoch-screening-case-choice')[1].textContent,
    'teardrop with a different connector');
});

test('variation headers retain sticky positioning and legible choice typography', () => {
  const css = fs.readFileSync('tool/css/epoch_finder.css', 'utf8');
  assert.match(css, /\.epoch-screening-case-labels\s*\{[^}]*position:\s*sticky/);
  assert.match(css, /\.epoch-screening-case-choice\s*\{[^}]*font-size:\s*18px/);
  assert.match(css, /\.epoch-screening-case-choice\s*\{[^}]*overflow-wrap:\s*anywhere/);
});
