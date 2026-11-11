const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../tool/js/epoch_info.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../tool/css/epoch_finder.css'), 'utf8');

function createInspector(run, lossPoints = []) {
  const dom = new JSDOM('<div id="test-generations-session-surface"></div><div id="test-generations-epoch-info" class="hidden"></div>');
  const document = dom.window.document;
  const payload = {
    ok: true, media: [], total: 0, summary: {count: 22, testCount: 22, campaignCount: 0},
    training: run ? {run, lossPoints, selectedEpoch: null} : null, warnings: []
  };
  const context = {
    document, window: {},
    fetch: async () => ({ok:true, json: async () => payload}),
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return {document, open: () => context.window.epochInfoOpen('tests','my-set','6dfa6011',24)};
}

test('Epoch inspector uses the existing navigation row for readable training settings', async () => {
  const {document,open} = createInspector({
    jobId:'6dfa6011', runSequence:'012', label:'Portrait Experiment', stage:'h3',
    runSummary: {
      trainingVariant:'Ostris', lr:0.00008, dropout:0.05,
      focusedH3Blocks:true, rank:32, shift:3, imageShift:1
    }
  });
  await open();
  const host = document.getElementById('test-generations-epoch-info');
  assert.equal(host.querySelector('.epoch-info-header h3').textContent, 'Epoch 24');
  assert.match(host.querySelector('.epoch-info-header-text p').textContent,
    /Run 12 · Portrait Experiment · All recorded Test and Campaign evidence/);
  const nav = host.querySelector('.epoch-info-nav');
  assert.ok(nav);
  assert.equal(nav.querySelector('.epoch-info-back').textContent, '← Back to Test results');
  const settings = nav.querySelector('.epoch-info-settings');
  assert.ok(settings, 'settings belong to the back navigation row, not a new header row');
  assert.match(settings.querySelector('summary').textContent,
    /Training settingsOstris · LR 8e-5 · Dropout 0.05 · Video shift 3/);
  settings.open = true;
  assert.deepEqual(Array.from(settings.querySelectorAll('dt'),x=>x.textContent),
    ['Training method','Learning rate','Dropout','LoRA rank','Focused blocks','Video shift','Image shift']);
  assert.deepEqual(Array.from(settings.querySelectorAll('dd'),x=>x.textContent),
    ['Ostris','8e-5','0.05','32','On','3','1']);
  assert.equal(host.querySelector('.epoch-info-training'), null,
    'no empty loss panel when training settings exist but loss measurements do not');
  const headerCss = css.slice(css.indexOf('.epoch-info-header{'),css.indexOf('.epoch-info-stats{'));
  assert.match(headerCss,/\.epoch-info-header p\{[^}]*font-size:16px/);
  assert.match(headerCss,/\.epoch-info-settings summary strong\{[^}]*font-size:18px/);
  assert.match(headerCss,/\.epoch-info-settings-summary\{font-size:16px/);
  assert.match(headerCss,/\.epoch-info-settings-list dt,\.epoch-info-settings-list dd\{[^}]*font-size:16px/);
});

test('Unknown training settings are explicit and never fabricated', async () => {
  const {document,open} = createInspector({
    jobId:'6dfa6011', label:'Legacy Experiment', runSummary:{}, stage:'h3'
  });
  await open();
  const nav = document.querySelector('.epoch-info-nav');
  assert.equal(nav.querySelector('.epoch-info-settings-unavailable').textContent,
    'Training settings unavailable');
  assert.equal(nav.querySelector('.epoch-info-settings'), null);
  assert.match(document.querySelector('.epoch-info-header-text p').textContent,
    /Run 6dfa6011 · Legacy Experiment/);
});

test('Recorded loss is still displayed without displacing the training settings row', async () => {
  const {document,open} = createInspector(
    {runSequence:'1', label:'Test', stage:'h3', runSummary:{lr:0.0001}},
    [{epoch:24,loss:0.1234}]
  );
  await open();
  assert.match(document.querySelector('.epoch-info-training').textContent,/Epoch loss 0\.1234/);
  assert.ok(document.querySelector('.epoch-info-nav .epoch-info-settings'));
});
