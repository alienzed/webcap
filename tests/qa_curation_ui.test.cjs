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
  const initial = h.root.querySelector('.qa-curation-card input[type=checkbox]');
  initial.checked = false;
  initial.dispatchEvent(new h.ctx.window.Event('change', {bubbles: true}));
  assert.equal(Number(h.root.querySelector('[data-curation-selected]').textContent), chosenBefore - 1);

  h.root.querySelector('[data-curation-create]').click();
  assert.equal(h.calls.copied.length, 1);
  assert.equal(h.calls.copied[0].length, chosenBefore - 1);
  assert.ok(h.calls.copied[0].every(x => x.source_media_rel.startsWith('sets/demo/')));
  assert.ok(h.ctx.state.focusSet === null);
});

test('scope changes fail visibly instead of using a stale curated selection', async () => {
  const h = harness();
  h.ctx.window.startQaCuration(entries(), 'training', 'first-scope');
  await new Promise(resolve => setTimeout(resolve, 40));
  h.ctx.window.renderQaCuration(h.root, 'new-scope');
  assert.match(h.root.textContent, /selection changed/);
  assert.equal(h.root.querySelector('[data-curation-create]'), null);
});
