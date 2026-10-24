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

test('screening/campaign header is two compact bands with live IDs intact', () => {
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
  assert.match(script, /els\('vl-count'\)\.parentElement\.classList\.add\('hidden'\)/);
  assert.match(script, /els\('render-bar'\)\.style\.width/);
  assert.match(script, /els\('field-count'\)\.textContent/);
});

test('compact strip remains flexible, preserves hidden metrics and full status tooltip', () => {
  assert.match(css, /\.epoch-finder-metrics\{display:flex;flex-wrap:wrap/);
  assert.match(css, /\.epoch-finder-metrics>\.hidden,\.epoch-finder-metrics\.hidden\{display:none\}/);
  assert.match(css, /\.epoch-finder-frames-metric>\.epoch-finder-track/);
  assert.match(script, /els\('detail'\)\.title = campaign\.detail \|\| ''/);
});
