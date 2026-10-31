const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync('tool/js/qa_curation.js', 'utf8');

function harness(savedDraft = null) {
  const dom = new JSDOM('<div id="qa-workbench"></div>');
  const document = dom.window.document, root = document.getElementById('qa-workbench');
  const calls = { submitted: [], training: [], opened: [], errors: [], saved: [], changedFocus: 0, draft: savedDraft };
  const ctx = {
    document, window: dom.window,
    state: { folder: 'sets/demo', focusSet: null, items: entries().map(item => ({fileName:item.fileName})) },
    getDirectorModelPreference: () => 'director-test',
    qaCurrentCurationSignature: () => 'same-scope',
    isPreviewVideoFileName: name => name.endsWith('.mp4'),
    mediaGridMediaUrl: row => '/test/' + row.fileName,
    buildSourceMediaRelPath: name => 'sets/demo/' + name,
    qaUseCuratedSelectionForTraining: (items, source) => calls.training.push({items, source}),
    selectByFileName: name => calls.opened.push(name),
    fetch: async (url, options) => {
      if (url.startsWith('/fs/qa/curate/draft?')) {
        return {ok: true, json: async () => ({ok: true, draft: calls.draft})};
      }
      if (url === '/fs/qa/curate/draft') {
        calls.draft = JSON.parse(options.body).draft;
        calls.saved.push(calls.draft);
        return {ok: true, json: async () => ({ok: true})};
      }
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
  dom.window.qaCurrentCurationEvidence = files => entries().filter(item => files.includes(item.fileName));
  dom.window.qaUseCuratedSelectionForTraining = ctx.qaUseCuratedSelectionForTraining;
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

test('Curate Review shows the exact filename and opens included and excluded images in Single Item', async () => {
  const h = harness();
  h.ctx.window.startQaCuration(entries(), 'construction', 'same-scope');
  await new Promise(resolve => setTimeout(resolve, 55));
  const initialCount = Number(h.root.querySelector('[data-curation-selected]').textContent);
  const focusSet = h.ctx.state.focusSet;

  function openGroup(label) {
    const button = Array.from(h.root.querySelectorAll('button'))
      .find(item => item.textContent.startsWith(label));
    assert.ok(button, 'Missing Curate Review entry: ' + label);
    button.click();
    const overlay = h.ctx.document.querySelector('.qa-curation-review');
    assert.ok(overlay, 'Curate Review must open');
    const filename = overlay.querySelector('.qa-curation-review-filename');
    const open = overlay.querySelector('button.qa-curation-review-open-item');
    assert.ok(filename && filename.textContent, 'Exact filename should be visible');
    assert.equal(filename.title, filename.textContent);
    assert.equal(open.textContent, 'Open in Single Item');
    const before = Number(h.root.querySelector('[data-curation-selected]').textContent);
    open.focus();
    open.dispatchEvent(new h.ctx.window.KeyboardEvent('keydown', {key:'Enter',bubbles:true}));
    assert.equal(Number(h.root.querySelector('[data-curation-selected]').textContent), before,
      'Enter on secondary action must not toggle Include/Remove');
    open.click();
    assert.equal(h.ctx.document.querySelector('.qa-curation-review'), null,
      'Navigation must dismiss the fullscreen overlay');
    assert.equal(h.calls.opened.at(-1), filename.textContent,
      'Navigation must use the reviewed item rather than the first visible media row');
    assert.equal(h.ctx.state.focusSet, focusSet,
      'Curate Review must not mutate the QA/Training Focus Set');
  }

  openGroup('Review included');
  openGroup('Review excluded');
  assert.equal(Number(h.root.querySelector('[data-curation-selected]').textContent), initialCount,
    'Opening Single Item should not change shortlist choices');
  assert.equal(h.calls.opened.length, 2);
});

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

  h.root.querySelector('[data-curation-train]').click();
  assert.equal(h.calls.training.length, 1);
  assert.equal(h.calls.training[0].items.length, chosenBefore - 1);
  assert.ok(h.calls.training[0].items.every(x => x.endsWith('.png')));
  assert.match(h.calls.training[0].source, /QA Curate/);
  assert.ok(h.ctx.state.focusSet === null);
});

test('a changed view does not block saved Curate training selections', async () => {
  const h = harness();
  h.ctx.qaCurrentCurationSignature = () => 'first-scope';
  h.ctx.window.startQaCuration(entries(), 'training', 'first-scope');
  await new Promise(resolve => setTimeout(resolve, 45));
  h.ctx.qaCurrentCurationSignature = () => 'new-scope';
  h.ctx.window.renderQaCuration(h.root, 'new-scope');
  assert.match(h.root.textContent, /current view or QA settings differ/i);
  assert.ok(h.root.querySelector('[data-curation-train]'));
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
    if (url.startsWith('/fs/qa/curate/draft?')) {
      return Promise.resolve({ok: true, json: async () => ({ok: true, draft: null})});
    }
    if (url === '/fs/qa/curate') return new Promise(resolve => { finishEnqueue = resolve; });
    if (url === '/fs/director/job') {
      cancelled.push(JSON.parse(opts.body));
      return Promise.resolve({ok: true, json: async () => ({ok: true})});
    }
    throw new Error('Unexpected Director call after stop: ' + url);
  };
  h.ctx.window.startQaCuration(entries().slice(0, 3), 'construction', 'same-scope');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(typeof finishEnqueue, 'function');
  h.ctx.window.stopQaCuration();
  finishEnqueue({ok: true, json: async () => ({
    ok: true, job: {jobId: 'late-queued-job', status: 'queued'}
  })});
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(cancelled, [{operation: 'cancel_job', jobId: 'late-queued-job'}]);
  assert.equal(h.calls.errors.length, 0);
  assert.equal(h.root.querySelector('[data-curation-train]'), null);
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


test('user can change group balancing without another Director call', async () => {
  const h = harness();
  h.ctx.window.startQaCuration(entries(), 'geometry', 'same-scope');
  await new Promise(resolve => setTimeout(resolve, 45));
  assert.equal(h.calls.errors.length, 0, h.calls.errors.join('; '));
  const control = group => h.root.querySelector('[data-curation-balance-group="' + group + '"]');
  assert.equal(control('Shape').checked, true, 'Director CORE group is suggested');
  assert.equal(control('View').checked, false, 'Director SUPPORTING group is not balanced');
  assert.equal(h.root.querySelectorAll('[data-curation-concept]').length, 2);
  const previous = Number(h.root.querySelector('[data-curation-selected]').textContent);
  const view = control('View');
  view.checked = true;
  view.dispatchEvent(new h.ctx.window.Event('change', {bubbles:true}));
  assert.equal(control('View').checked, true);
  assert.equal(h.root.querySelectorAll('[data-curation-concept]').length, 4,
    'manually promoted group must affect core evidence meters');
  assert.equal(h.calls.submitted.length, 1, 'changing categories must not invoke Director again');
  assert.ok(Number(h.root.querySelector('[data-curation-selected]').textContent) > 0);
  assert.ok(previous > 0);
  const shape = control('Shape');
  shape.checked = false;
  shape.dispatchEvent(new h.ctx.window.Event('change', {bubbles:true}));
  assert.equal(control('Shape').checked, false);
  assert.equal(h.root.querySelectorAll('[data-curation-concept]').length, 2,
    'deselected group no longer drives core balancing');
});

test('balancing priorities never discard manual thumbnail choices', async () => {
  const h = harness();
  h.ctx.window.startQaCuration(entries(), 'geometry', 'same-scope');
  await new Promise(resolve => setTimeout(resolve, 45));
  const initial = h.root.querySelector('.qa-curation-card input[type=checkbox]');
  initial.checked = false;
  initial.dispatchEvent(new h.ctx.window.Event('change', {bubbles:true}));
  const chosen = Number(h.root.querySelector('[data-curation-selected]').textContent);
  const view = h.root.querySelector('[data-curation-balance-group="View"]');
  view.checked = true;
  view.dispatchEvent(new h.ctx.window.Event('change', {bubbles:true}));
  assert.equal(Number(h.root.querySelector('[data-curation-selected]').textContent), chosen,
    'manual media selections must survive balance-priority edits');
  assert.match(h.root.textContent, /Manual image selections are preserved/);
  assert.equal(h.calls.submitted.length, 1);
  const balanced = Array.from(h.root.querySelectorAll('.qa-curation-controls button'))
    .find(button => button.textContent.startsWith('Balanced'));
  balanced.click();
  assert.doesNotMatch(h.root.textContent, /Manual image selections are preserved/);
});

test('manually selected group adds concepts even when Director omitted the entire group', async () => {
  const h = harness();
  const originalFetch = h.ctx.fetch;
  h.ctx.fetch = (url, options) => {
    if (url.startsWith('/fs/director/job?')) {
      const concepts = h.calls.submitted[0].concepts;
      return Promise.resolve({ok:true,json:async()=>({ok:true,job:{
        status:'completed', result:{analysis:{
          summary:'Only Shape mattered',coreIds:concepts.filter(c=>c.group==='Shape').map(c=>c.id),
          supportingIds:[]
        }}
      }})});
    }
    return originalFetch(url,options);
  };
  h.ctx.window.startQaCuration(entries(), 'geometry', 'same-scope');
  await new Promise(resolve => setTimeout(resolve, 45));
  assert.equal(h.calls.errors.length, 0, h.calls.errors.join('; '));
  assert.equal(h.root.querySelectorAll('[data-curation-concept]').length, 2);
  const view = h.root.querySelector('[data-curation-balance-group="View"]');
  view.checked = true;
  view.dispatchEvent(new h.ctx.window.Event('change', {bubbles:true}));
  assert.equal(h.root.querySelectorAll('[data-curation-concept]').length, 4,
    'group override must not be constrained by omitted LLM concept IDs');
  assert.equal(h.calls.submitted.length, 1);
});

test('untouched Director concepts keep their original core/supporting roles', async () => {
  const h = harness();
  const originalFetch = h.ctx.fetch;
  h.ctx.fetch = (url, options) => {
    if (url.startsWith('/fs/director/job?')) {
      const concepts = h.calls.submitted[0].concepts;
      const shapes = concepts.filter(c => c.group === 'Shape');
      return Promise.resolve({ok:true,json:async()=>({ok:true,job:{
        status:'completed',result:{analysis:{
          summary:'Mixed Shape importance',coreIds:[shapes[0].id],
          supportingIds:[shapes[1].id]
        }}
      }})});
    }
    return originalFetch(url,options);
  };
  h.ctx.window.startQaCuration(entries(), 'shape', 'same-scope');
  await new Promise(resolve => setTimeout(resolve, 45));
  assert.equal(h.calls.errors.length, 0, h.calls.errors.join('; '));
  assert.equal(h.root.querySelector('[data-curation-balance-group="Shape"]').checked, true);
  assert.equal(h.root.querySelectorAll('[data-curation-concept]').length, 1,
    'initial proposal must honor the per-concept Director result');
  let shape = h.root.querySelector('[data-curation-balance-group="Shape"]');
  shape.checked = false;
  shape.dispatchEvent(new h.ctx.window.Event('change', {bubbles:true}));
  shape = h.root.querySelector('[data-curation-balance-group="Shape"]');
  shape.checked = true;
  shape.dispatchEvent(new h.ctx.window.Event('change', {bubbles:true}));
  assert.equal(h.root.querySelectorAll('[data-curation-concept]').length, 2,
    'explicit group override promotes all available terms');
});

test('core-weighted group priority changes deterministic ranking', () => {
  const h = harness();
  const rows = [
    {fileName:'shape-a.png',ids:['shape'],analysis:{}},
    {fileName:'shape-b.png',ids:['shape'],analysis:{}},
    {fileName:'color-a.png',ids:['color'],analysis:{}}
  ];
  const shapeFirst = [{id:'shape',role:'core',weight:1,count:2},
    {id:'color',role:'supporting',weight:0.28,count:1}];
  const colorFirst = [{id:'shape',role:'supporting',weight:0.28,count:2},
    {id:'color',role:'core',weight:1,count:1}];
  assert.equal(h.ctx.window.qaCurationRank(rows,shapeFirst).order[0],'shape-a.png');
  assert.equal(h.ctx.window.qaCurationRank(rows,colorFirst).order[0],'color-a.png');
});

test('Curate saves compact signatures and persists individual concept changes', async () => {
  const h = harness();
  h.ctx.window.startQaCuration(entries(), 'geometry', 'same-scope');
  await new Promise(resolve => setTimeout(resolve, 55));
  assert.ok(h.calls.saved.length);
  assert.match(h.calls.draft.signature, /^v2:/);
  const initialSaves = h.calls.saved.length;
  const select = h.root.querySelector('.qa-curation-concept-choice select');
  select.value = 'ignore';
  select.dispatchEvent(new h.ctx.window.Event('change', {bubbles: true}));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(h.calls.saved.length > initialSaves);
  assert.ok(h.calls.draft.conceptRoles.some(([id, role]) => role === 'ignore'));
});

test('Curate v2 restores ranking and choices without a Director call after signature drift', async () => {
  const first = harness();
  first.ctx.window.startQaCuration(entries(), 'geometry', 'same-scope');
  await new Promise(resolve => setTimeout(resolve, 55));
  const draft = structuredClone(first.calls.draft);
  assert.equal(draft.version, 2);
  assert.ok(draft.snapshot.rows.length > 0);
  const second = harness(draft);
  second.ctx.qaCurrentCurationSignature = () => 'new-scope';
  second.ctx.window.startQaCuration(entries(), 'geometry', 'new-scope');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(second.calls.submitted.length, 0);
  assert.ok(second.root.querySelector('[data-curation-train]'));
  assert.equal(Number(second.root.querySelector('[data-curation-selected]').textContent), draft.choices.length);
  assert.equal(second.calls.draft.signature, draft.signature);
});

test('restoring current Curate draft skips Director and retains saved roles', async () => {
  const first = harness();
  first.ctx.window.startQaCuration(entries(), 'geometry', 'same-scope');
  await new Promise(resolve => setTimeout(resolve, 55));
  const select = first.root.querySelector('.qa-curation-concept-choice select');
  select.value = 'ignore';
  select.dispatchEvent(new first.ctx.window.Event('change', {bubbles: true}));
  await new Promise(resolve => setTimeout(resolve, 20));
  const second = harness(structuredClone(first.calls.draft));
  second.ctx.window.startQaCuration(entries(), 'geometry', 'same-scope');
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(second.calls.submitted.length, 0);
  assert.equal(second.root.querySelector('.qa-curation-concept-choice select').value, 'ignore');
});

test('Curate review keeps Previous / decision / Next in a stable footer', async () => {
  const h = harness();
  h.ctx.window.startQaCuration(entries(), 'shape construction', 'same-scope');
  await new Promise(resolve => setTimeout(resolve, 40));
  const open = Array.from(h.root.querySelectorAll('button'))
    .find(button => button.textContent.includes('Review included'));
  assert.ok(open);
  open.click();
  const panel = h.ctx.document.querySelector('.qa-curation-review-panel');
  assert.ok(panel);
  const nav = panel.querySelector('.qa-curation-review-actions');
  assert.equal(nav.parentNode, panel, 'navigation must not be inside changing evidence');
  assert.deepEqual(Array.from(nav.querySelectorAll('button'), el => el.textContent),
    ['← Previous', 'Remove', 'Next →']);
  assert.equal(nav.querySelector('button').disabled, true);
  nav.querySelectorAll('button')[2].click();
  const following = h.ctx.document.querySelector('.qa-curation-review-panel');
  const navNext = following.querySelector('.qa-curation-review-actions');
  assert.equal(navNext.parentNode, following);
  assert.equal(navNext.querySelector('button').disabled, false);
  assert.equal(following.querySelector('.qa-curation-review-counter').textContent.includes('2 /'), true);
  following.querySelector('.qa-curation-review-top button').click();
});

test('Curate review CSS reserves a desktop footer row below both columns', () => {
  const css = fs.readFileSync('tool/css/qa_workbench.css', 'utf8');
  assert.match(css, /grid-template-rows:auto auto minmax\(0,1fr\) auto/);
  assert.match(css, /\.qa-curation-review-actions \{ grid-column:1 \/ -1; grid-row:4; \}/);
});

test('near-equivalent 768 source outranks 384 source, but rare core evidence remains eligible', () => {
  const h = harness();
  const concepts = [{id:'unique',role:'core',weight:1,count:1}, {id:'common',role:'core',weight:1,count:3}];
  const rows = [
    {fileName:'small.png',ids:['common'],resolution:'384x384',analysis:{}},
    {fileName:'large.png',ids:['common'],resolution:'768x768',analysis:{}},
    {fileName:'unique.png',ids:['unique'],resolution:'384x384',analysis:{}},
  ];
  const ranked = h.ctx.window.qaCurationRank(rows, concepts).order;
  assert.ok(ranked.indexOf('large.png') < ranked.indexOf('small.png'));
  assert.ok(ranked.indexOf('unique.png') < ranked.indexOf('small.png'));
});

test('Curate review shows source tags, resolution and preserves a review resume point', async () => {
  const h = harness();
  const source = entries();
  source[0].resolution = '768x768';
  h.ctx.window.qaCurrentCurationEvidence = files => source.filter(item => files.includes(item.fileName));
  h.ctx.window.startQaCuration(source,'geometry','same-scope');
  await new Promise(resolve => setTimeout(resolve,45));
  const button = Array.from(h.root.querySelectorAll('button')).find(el => el.textContent.startsWith('Review included'));
  button.click();
  const overlay = h.ctx.document.querySelector('.qa-curation-review');
  assert.match(overlay.textContent, /Current tags:/);
  assert.match(overlay.textContent, /Resolution/);
  overlay.querySelector('.qa-curation-review-open-item').click();
  assert.equal(h.calls.opened.length,1);
  assert.ok(Array.from(h.root.querySelectorAll('button')).some(el => el.textContent === 'Resume review'));
});

test('changed evidence displays a nonblocking notice and does not discard manual selections', async () => {
  const h = harness();
  const original = entries();
  let live = original.map(row=>structuredClone(row));
  h.ctx.window.qaCurrentCurationEvidence = files => live.filter(row => files.includes(row.fileName));
  h.ctx.window.startQaCuration(original,'geometry','same-scope');
  await new Promise(resolve => setTimeout(resolve,45));
  const count = Number(h.root.querySelector('[data-curation-selected]').textContent);
  live[0].caption = 'edited caption';
  h.ctx.window.renderQaCuration(h.root,'same-scope');
  assert.match(h.root.textContent,/changed supporting evidence/);
  assert.equal(Number(h.root.querySelector('[data-curation-selected]').textContent),count);
  assert.ok(h.root.querySelector('[data-curation-train]'));
});
