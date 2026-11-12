const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('tool/tool.html', 'utf8');
const css = fs.readFileSync('tool/css/epoch_finder.css', 'utf8');
const script = fs.readFileSync('tool/js/epoch_finder.js', 'utf8');
const start = html.indexOf('<div id="epoch-finder-active"');
const end = html.indexOf('<div class="epoch-finder-live-layout"', start);
assert.ok(start > -1 && end > start, 'Expected live Campaign/Screening header section');
const doc = new JSDOM(html.slice(start, end)).window.document;

test('Campaign header is two compact bands with live IDs intact', () => {
  const heading = doc.querySelector('.epoch-finder-heading');
  const title = heading.querySelector('.epoch-finder-title');
  assert.equal(title.querySelector('#epoch-finder-name').textContent, 'Campaign');
  assert.ok(title.querySelector('#epoch-finder-phase'));
  assert.ok(heading.querySelector('#epoch-finder-pause'));
  assert.ok(heading.querySelector('#epoch-finder-stop'));
  assert.ok(heading.querySelector('#epoch-finder-resume'));
  const metrics = doc.querySelector('#epoch-finder-metrics');
  assert.ok(metrics);
  assert.equal(metrics.querySelector('#epoch-finder-detail').parentElement, metrics);
  assert.ok(metrics.querySelector('.epoch-finder-frames-metric #epoch-finder-render-count'));
  assert.ok(metrics.querySelector('.epoch-finder-frames-metric #epoch-finder-render-bar'));
  assert.ok(metrics.querySelector('#epoch-finder-field-count'));
  assert.equal(doc.querySelectorAll('#epoch-finder-detail').length, 1);
  assert.equal(doc.querySelectorAll('#epoch-finder-render-count').length, 1);
});

test('campaign evaluation and optional comparison counters retain their elements and hidden defaults', () => {
  const metrics = doc.querySelector('#epoch-finder-metrics');
  for (const id of ['epoch-finder-vl-count', 'epoch-finder-vl-bar',
    'epoch-finder-rvn-count', 'epoch-finder-dino-count',
    'epoch-finder-reference-compare-error']) {
    assert.ok(metrics.querySelector('#' + id), id);
  }
  assert.ok(metrics.querySelector('#epoch-finder-rvn-progress').classList.contains('hidden'));
  assert.ok(metrics.querySelector('#epoch-finder-dino-progress').classList.contains('hidden'));
  assert.match(script, /els\('vl-count'\)\.parentElement\.classList\.remove\('hidden'\)/);
  assert.match(script, /els\('render-bar'\)\.style\.width/);
  assert.match(script, /els\('field-count'\)\.textContent/);
});

test('compact strip remains flexible, preserves hidden metrics and full status tooltip', () => {
  assert.match(css, /\.epoch-finder-metrics\{display:flex;flex-wrap:wrap/);
  assert.match(css, /\.epoch-finder-metrics>\.hidden,\.epoch-finder-metrics\.hidden\{display:none\}/);
  assert.match(css, /\.epoch-finder-frames-metric>\.epoch-finder-track/);
  assert.match(script, /els\('detail'\)\.title = campaign\.detail \|\| ''/);
});

test('unnamed Campaign runs use persisted sequence across labels', () => {
  const vm = require('node:vm');
  const start = script.indexOf('  function candidateLabel(campaign, candidate) {');
  const end = script.indexOf('  function runDetails(run) {', start);
  assert.ok(start >= 0 && end > start);
  const ctx = {Number, String};
  vm.createContext(ctx);
  vm.runInContext(script.slice(start, end) +
    '\nthis.identity = runIdentity; this.candidate = candidateLabel;', ctx);
  const run = {runName: 'Run train', runSequence: '012', jobId: 'job-12'};
  assert.equal(ctx.identity(run), 'Run 12');
  assert.equal(ctx.candidate({candidateMap: {'50': {...run, epoch: 50}}}, 50), 'Run 12 · Epoch 50');
  assert.equal(ctx.identity({...run, runName: 'Bikini details'}), 'Run 12 · Bikini details');
  assert.equal(ctx.identity({runName: 'Run train', jobId: 'job-12'}), 'Run job-12');
});

test('Campaigns terminology is visible while Media Explorer routes and source keys remain stable', () => {
  const explorer = fs.readFileSync('tool/js/media_explorer.js', 'utf8');
  const backend = fs.readFileSync('tool/server/media_explorer.py', 'utf8');
  assert.match(html, /data-test-workspace-mode="finder"[^>]*>Campaigns<\/button>/);
  assert.match(explorer, /epoch: 'Campaigns'/);
  assert.match(explorer, /text\(epoch, 'Open Campaign'\)/);
  assert.match(explorer, /label: 'Delete campaign', description: 'entire campaign and its generated results'/);
  assert.match(explorer, /url: '\/fs\/epoch_finder', data: \{folder: item.ownerFolder, operation: 'delete'/);
  assert.match(backend, /"source": "epoch", "storageId": campaign_id/);
  assert.match(backend, /"role": "Campaign", "source": "epoch"/);
  assert.match(backend, /"\/fs\/epoch_finder\/frame\?folder="/);
});

test('Storage Manager calls campaign artifacts by their current name without changing ownership keys', () => {
  const ui = fs.readFileSync('tool/js/storage_manager.js', 'utf8');
  const backend = fs.readFileSync('tool/server/storage_manager.py', 'utf8');
  assert.match(ui, /epoch_finder: 'Campaigns'/);
  assert.match(ui, /epoch_finder_staging: 'Campaign temporary checkpoints'/);
  assert.match(ui, /label = 'Campaign'/);
  assert.match(backend, /_category\("epoch_finder", "Campaigns"/);
  assert.match(backend, /_category\("epoch_finder_staging", "Campaign temporary checkpoints"/);
  assert.match(backend, /"Campaign " \+ campaign_id \+ " owns this session; delete the campaign instead\."/);
  assert.match(backend, /epoch_finder\.command\(app_config\.safe_join_fs_root\(folder\), "delete"/);
});

test('Campaign jobs and diagnostics use current names while internal contracts stay fixed', () => {
  const server = fs.readFileSync('tool/server/epoch_finder.py', 'utf8');
  const app = fs.readFileSync('tool/server/app.py', 'utf8');
  const plan = fs.readFileSync('tool/server/epoch_finder_plan.py', 'utf8');
  const readme = fs.readFileSync('README.md', 'utf8');
  const guide = fs.readFileSync('docs/run_analytics.md', 'utf8');
  assert.match(script, /'Evaluations request failed\.'/);
  assert.match(script, /reportConsoleError\('Evaluations', exc\)/);
  assert.match(server, /name="Campaign epoch " \+ str\(unit\["epoch"\]\)/);
  assert.match(server, /label="Campaign Ask VL"/);
  assert.match(server, /label="Campaign Reference VL"/);
  assert.match(app, /label="Campaign: design concept tests"/);
  assert.match(readme, /\*\*Use Campaigns\.\*\* Open \*\*Evaluations → Campaigns\*\*/);
  assert.match(guide, /Evaluations → Insights/);
  assert.match(app, /@app\.route\("\/fs\/epoch_finder", methods=\["POST"\]\)/);
  assert.match(server, /campaign_staging="epoch-finder-" \+ campaign\["id"\]/);
  assert.match(plan, /contract\["operation"\] = "propose_epoch_finder_plan"/);
  assert.match(plan, /\[EPOCH FINDER ADDITION\]/);
});
