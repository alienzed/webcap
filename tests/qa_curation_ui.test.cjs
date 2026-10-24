const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync('tool/js/qa_curation.js', 'utf8');

function harness() {
  const dom = new JSDOM('<div id="qa-workbench"></div>');
  const document = dom.window.document, root = document.getElementById('qa-workbench');
  const calls = { submitted: [], copied: [], errors: [], changedFocus: 0 };
  const ctx = {
    document, window: dom.window,
    state: { folder: 'sets/demo', focusSet: null },
    getDirectorModelPreference: () => 'director-test',
    qaCurrentCurationSignature: () => 'same-scope',
    isPreviewVideoFileName: name => name.endsWith('.mp4'),
    mediaGridMediaUrl: row => '/test/' + row.fileName,
    buildSourceMediaRelPath: name => 'sets/demo/' + name,
    runCreateSetFromResultsFlow: items => calls.copied.push(items),
    fetch: async (url, options) => {
      if (url === '/fs/qa/curate') {
        calls.submitted.push(JSON.parse(options.body));
        return {ok: true, json: async () => ({ok: true, job: {jobId: 'job1'}})};
      }
      if (url.startsWith('/fs/director/job?')) {
        const original = calls.submitted[0].concepts;
        return {ok: true, json: async () => ({
          ok: true,
          job: {status: 'completed', result: {analysis: {
            summary: 'Prioritize shape, preserve some rear perspectives',
            coreIds: original.filter(c => c.group === 'Shape').map(c => c.id),
            supportingIds: original.filter(c => c.group === 'View').map(c => c.id),
          }}}
        })};
      }
      throw new Error('Unexpected network request ' + url);
    },
    setTimeout,
  };
  dom.window.qaShowCuration = () => {};
  dom.window.qaShowOverviewFromCuration = () => {};
  dom.window.reportConsoleError = (name, error) => calls.errors.push(String(error.message || error));
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return {ctx, root, calls};
}

function entries() {
  const output = [];
  for (let i = 0; i < 95; i++) {
    const common = i < 80;
    output.push({
      fileName: 'image-' + String(i).padStart(3, '0') + '.png',
      caption: common ? 'front, common bikini construction' : 'rear, uncommon construction',
      groupedTags: [
        {group: 'Shape', term: common ? 'common' : 'rare'},
        {group: 'View', term: common ? 'front' : 'rear'},
      ],
      analysis: {sceneComplexity: {score: common ? 0.45 : 0.25}},
    });
  }
  return output;
}

test('curation inventory is based on real grouped concepts and never free-word frequency', () => {
  const h = harness();
  const inventory = h.ctx.window.qaCurationInventory(entries());
  assert.equal(inventory.rows.length, 95);
  assert.equal(inventory.concepts.length, 4);
  assert.deepEqual(Array.from(inventory.concepts.filter(c => c.group === 'Shape')
    .map(c => c.count)).sort((a,b)=>a-b), [15,80]);
  assert.ok(inventory.concepts.every(c => c.term !== 'the'));
});

test('unattended Director curation creates a real checklist without equal quotas or Focus Set mutation', async () => {
  const h = harness(), rows = entries();
  h.ctx.window.startQaCuration(rows, 'shape construction', 'same-scope');
  await new Promise(resolve => setTimeout(resolve, 40));

  assert.equal(h.calls.errors.length, 0, h.calls.errors.join('; '));
  assert.equal(h.calls.submitted.length, 1);
  assert.equal(h.calls.submitted[0].files.length, 95);
  assert.equal(h.calls.submitted[0].concepts.length, 4);
  assert.equal(h.root.querySelectorAll('.qa-curation-card').length > 0, true);
  assert.match(h.root.textContent, /Evidence coverage/);
  assert.ok(h.ctx.state.focusSet === null);

  const chosenBefore = Number(h.root.querySelector('[data-curation-selected]').textContent);
  assert.ok(chosenBefore > 0 && chosenBefore < 95);
  const coreMeters = () => Array.from(h.root.querySelectorAll('[data-curation-concept] progress'))
    .map(el => Number(el.value));
  const metersBefore = coreMeters();
  const initial = h.root.querySelector('.qa-curation-card input[type=checkbox]');
  initial.checked = false;
  initial.dispatchEvent(new h.ctx.window.Event('change', {bubbles: true}));
  assert.equal(Number(h.root.querySelector('[data-curation-selected]').textContent), chosenBefore - 1);
  assert.ok(coreMeters().some((value,i) => value < metersBefore[i]),
    'removing an image changes the relevant visual concept meter');

  h.root.querySelector('[data-curation-create]').click();
  assert.equal(h.calls.copied.length, 1);
  assert.equal(h.calls.copied[0].length, chosenBefore - 1);
  assert.ok(h.calls.copied[0].every(x => x.source_media_rel.startsWith('sets/demo/')));
  assert.ok(h.ctx.state.focusSet === null);
});

test('scope changes fail visibly instead of using a stale curated selection', async () => {
  const h = harness();
  h.ctx.qaCurrentCurationSignature = () => 'first-scope';
  h.ctx.window.startQaCuration(entries(), 'training', 'first-scope');
  await new Promise(resolve => setTimeout(resolve, 40));
  h.ctx.window.renderQaCuration(h.root, 'new-scope');
  assert.match(h.root.textContent, /selection changed/);
  assert.equal(h.root.querySelector('[data-curation-create]'), null);
});

test('video candidates render metadata-only thumbnails and remain opt-in', async () => {
  const h = harness(), rows = entries().slice(0, 8);
  rows[0].fileName = 'clip.mp4';
  h.ctx.window.startQaCuration(rows, 'construction', 'same-scope');
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(h.calls.errors.length, 0, h.calls.errors.join('; '));
  const allImages = Array.from(h.root.querySelectorAll('.qa-curation-controls button'))
    .find(button => button.textContent === 'All images');
  allImages.click();
  const video = h.root.querySelector('video.qa-curation-thumb');
  assert.ok(video);
  assert.equal(video.preload, 'metadata');
  assert.ok(video.muted);
});


test('cancel while enqueue is in flight cancels the late queued Director job', async () => {
  const h = harness();
  let finishEnqueue;
  const cancelled = [];
  h.ctx.fetch = (url, opts) => {
    if (url === '/fs/qa/curate') return new Promise(resolve => { finishEnqueue = resolve; });
    if (url === '/fs/director/job') {
      cancelled.push(JSON.parse(opts.body));
      return Promise.resolve({ok: true, json: async () => ({ok: true})});
    }
    throw new Error('Unexpected Director call after stop: ' + url);
  };
  h.ctx.window.startQaCuration(entries().slice(0, 3), 'construction', 'same-scope');
  assert.equal(typeof finishEnqueue, 'function');
  h.ctx.window.stopQaCuration();
  finishEnqueue({ok: true, json: async () => ({
    ok: true, job: {jobId: 'late-queued-job', status: 'queued'}
  })});
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(cancelled, [{operation: 'cancel_job', jobId: 'late-queued-job'}]);
  assert.equal(h.calls.errors.length, 0);
  assert.equal(h.root.querySelector('[data-curation-create]'), null);
});

test('rare approved construction survives 120-concept budget alongside frequent Sight details', () => {
  const h = harness();
  const rows = [
    {fileName: 'a.png', caption: '', analysis: {}, groupedTags: []},
    {fileName: 'b.png', caption: '', analysis: {}, groupedTags: []},
    {fileName: 'rare.png', caption: '', analysis: {}, groupedTags: [
      {group:'Construction',term:'exceptional one-off connector'}
    ]},
  ];
  for (let i = 0; i < 100; i++) {
    const tag = {group:'Construction',term:'common-'+String(i).padStart(3,'0')};
    rows[0].groupedTags.push(tag);
    rows[1].groupedTags.push(tag);
  }
  rows[0].analysis.visionSight = {inventory: {
    details: Array.from({length: 12}, (_,i)=>'visual-'+i),
    things: Array.from({length: 32}, (_,i)=>({name:'thing-'+i,
      qualities: Array.from({length: 4}, (_,j)=>'detail-'+j)})),
  }};
  const inventory = h.ctx.window.qaCurationInventory(rows);
  assert.equal(inventory.concepts.length, 120);
  assert.ok(inventory.concepts.some(c => c.term === 'exceptional one-off connector'),
    'single-example approved construction must remain visible to the Director');
});
