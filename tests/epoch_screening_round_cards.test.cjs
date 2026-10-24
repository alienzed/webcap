const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');

const script = fs.readFileSync('tool/js/epoch_finder.js', 'utf8');
const css = fs.readFileSync('tool/css/epoch_finder.css', 'utf8');
const start = script.indexOf('  function screeningRoundState(');
const end = script.indexOf('  function screeningRunInfo(', start);
assert.ok(start >= 0 && end > start, 'Manual Screening round functions are present');

function fixture() {
  const dom = new JSDOM('<section id="manual-history" class="hidden"><div id="manual-round-list" class="epoch-finder-campaigns"></div></section>');
  const document = dom.window.document;
  const host = document.getElementById('manual-round-list');
  const campaign = {
    id: 'screening-test', status: 'running', round: 3,
    rounds: [
      {number: 2, status: 'stopped', epochs: Array.from({length:14}, (_,i)=>i+1), seeds: [1,2,3,4,5]},
      {number: 3, status: 'running', epochs: Array.from({length:13}, (_,i)=>i+1), seeds: [1,2,3,4]},
    ],
    units: [
      ...Array.from({length:20}, (_,i)=>({round:2, epoch:1, case:i, frame:'saved-'+i+'.png', error:''})),
      ...Array.from({length:6}, (_,i)=>({round:3, epoch:1, case:i, frame:'active-'+i+'.png', error:''})),
    ],
  };
  const context = {
    document, window:dom.window, manualSelectedRound:3,
    els: id => document.getElementById(id),
  };
  vm.createContext(context);
  vm.runInContext(script.slice(start,end)+'\nthis.drawRounds = screeningRoundList;', context);
  return {dom,document,host,campaign,draw:()=>context.drawRounds(campaign),context};
}

test('two full-width cards keep the correct per-round actions, state, and progress', () => {
  const h = fixture();
  h.draw();
  const rows = h.host.querySelectorAll('[data-screening-round-item]');
  assert.equal(rows.length,2);
  const stopped = rows[0], running = rows[1];
  assert.equal(stopped.querySelector('strong').textContent,'Round 2');
  assert.equal(stopped.querySelector('.epoch-screening-round-state').textContent,'stopped');
  assert.equal(stopped.querySelector('small').textContent,'14 epochs · 20/70 renders');
  assert.equal(stopped.querySelector('[data-screening-round-action]').textContent,'Delete');
  assert.equal(stopped.querySelector('[data-screening-round-action]').dataset.screeningRoundAction,'delete');
  assert.equal(stopped.querySelector('.epoch-screening-round-progress').getAttribute('aria-valuenow'),'20');
  assert.equal(stopped.querySelector('.epoch-screening-round-progress').getAttribute('aria-valuemax'),'70');
  assert.match(stopped.querySelector('.epoch-screening-round-progress i').style.width,/28\.5714/);
  assert.equal(running.querySelector('strong').textContent,'Round 3');
  assert.equal(running.querySelector('.epoch-screening-round-state').textContent,'running');
  assert.equal(running.querySelector('small').textContent,'13 epochs · 6/52 renders');
  assert.equal(running.querySelector('[data-screening-round-action]').textContent,'Stop queuing');
  assert.equal(running.querySelector('[data-screening-round-action]').dataset.screeningRoundAction,'stop');
  assert.equal(running.querySelector('[data-screening-round]').getAttribute('aria-pressed'),'true');
  assert.ok(running.classList.contains('active'));
  assert.equal(stopped.querySelector('[data-screening-round]').getAttribute('aria-pressed'),'false');
  assert.ok(!stopped.classList.contains('active'));
});

test('live progress reconciles in place without dropping focus or action control identity', () => {
  const h=fixture();
  h.draw();
  const round=h.host.querySelector('[data-screening-round-item="3"]');
  const action=round.querySelector('[data-screening-round-action]');
  const toggle=round.querySelector('[data-screening-round]');
  toggle.focus();
  h.campaign.units.push({round:3,epoch:2,case:0,frame:'next.png',error:''});
  h.draw();
  assert.equal(round,h.host.querySelector('[data-screening-round-item="3"]'));
  assert.equal(action,round.querySelector('[data-screening-round-action]'));
  assert.equal(h.document.activeElement,toggle);
  assert.equal(round.querySelector('small').textContent,'13 epochs · 7/52 renders');
  assert.equal(round.querySelector('.epoch-screening-round-progress').getAttribute('aria-valuenow'),'7');
});

test('round actions stay inside selectable cards, not detached neighboring buttons', () => {
  assert.match(css,/\.epoch-screening-round-item\s*\{\s*display:grid;/);
  assert.match(css,/grid-template-columns:minmax\(0,1fr\) auto;/);
  assert.match(css,/\.epoch-screening-round-progress\s*\{\s*grid-column:1 \/ -1;/);
  assert.match(css,/\.epoch-screening-round-item > \[data-screening-round-action\]/);
  assert.match(css,/grid-column:2;\s*grid-row:1;/,'round action must remain beside title, not below progress');
});
