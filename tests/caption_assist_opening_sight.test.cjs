'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');

const source = fs.readFileSync('tool/js/primer_settings.js', 'utf8');
const begin = source.indexOf('function syncFocusedCaptionVisionPhrasesUi() {');
const end = source.indexOf('function applyQaCaptionPatch(', begin);
assert.ok(begin > 0 && end > begin, 'Caption Assist Sight owner must exist');

function harness() {
  const dom = new JSDOM('<div id="editor-caption-vision-phrases"></div><button id="editor-caption-vision-phrases-btn"></button>');
  const item = {key:'one',fileName:'one.jpg',metadata:{vision_sight:{inventory:{details:['triangle cups']}}}};
  const candidate = {mediaKey:'one',text:'Proposed caption'};
  let sightCalls = 0;
  const ctx = {
    document:dom.window.document,
    state:{currentItem:item},
    captionAssistCandidate:candidate,
    isFocusedQaReviewMode:()=>false,
    getMetadataForMedia:()=>({}),
    getCaptionAssistTagSuggestions:()=>{sightCalls++; return [{group:'BT Shape',term:'triangle cups',kind:'tag'}];},
    getChecklistAssignmentEntriesForMediaKey:()=>[],
    getUnscopedTagsForMediaKey:()=>[],
    qaFocusReviewTagActions:()=>[],
    insertFocusedCaptionVisionPhrase:()=>true,
    acceptCaptionAssistTagSuggestion:()=>true,
    removeCaptionAssistAssignedTag:()=>true
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(begin,end)+'\nthis.sync=syncFocusedCaptionVisionPhrasesUi;',ctx);
  const row=dom.window.document.getElementById('editor-caption-vision-phrases');
  return {ctx,dom,row,getSightCalls:()=>sightCalls};
}

test('opening Caption Assist does not scan Group vocabulary or construct hidden suggestion chips',()=>{
  const h=harness();
  h.ctx.sync();
  assert.equal(h.getSightCalls(),0);
  const details=h.row.querySelector('details[data-sight-suggestions]');
  assert.ok(details,'collapsed Saved Sight control remains reachable');
  assert.equal(details.open,false);
  assert.equal(details.querySelectorAll('button').length,0);
  assert.match(details.querySelector('summary').textContent,/Saved Sight suggestions/);
  details.open=true;
  details.dispatchEvent(new h.dom.window.Event('toggle'));
  assert.equal(h.getSightCalls(),1);
  assert.equal(details.querySelectorAll('button').length,2,'tag actions are available after expanding');
  assert.match(details.querySelector('summary').textContent,/\(1\)/);
  details.dispatchEvent(new h.dom.window.Event('toggle'));
  assert.equal(h.getSightCalls(),1,'toggle cannot duplicate work on the same panel');
});

test('subsequent sync retains expanded Sight without duplicating assigned tags',()=>{
  const h=harness();
  h.ctx.getChecklistAssignmentEntriesForMediaKey=()=>[{requirement:'BT Shape',term:'ring connectors'}];
  h.ctx.sync();
  const detail=h.row.querySelector('[data-sight-suggestions]');
  detail.open=true;
  detail.dispatchEvent(new h.dom.window.Event('toggle'));
  h.ctx.sync();
  assert.equal(h.row.querySelector('[data-sight-suggestions]').open,true);
  assert.equal(h.row.querySelector('.caption-assist-assigned-tags'),null);
  assert.doesNotMatch(h.row.textContent,/Assigned tags/i);
  assert.ok(h.row.querySelector('[data-sight-suggestions] button'));
  assert.ok(h.getSightCalls()>=2);
});

test('QA remove actions remain available without the duplicate tag list',()=>{
  const h=harness();
  const removals=[];
  h.ctx.isFocusedQaReviewMode=()=>true;
  h.ctx.qaFocusReviewTagActions=()=>[{action:'remove',group:'Framing',term:'front view'}];
  h.ctx.removeCaptionAssistAssignedTag=(key,group,term)=>removals.push([key,group,term]);
  h.ctx.sync();
  assert.equal(h.row.querySelector('.caption-assist-assigned-tags'),null);
  const action=h.row.querySelector('.caption-assist-qa-suggestions .caption-assist-suggestion-tag');
  assert.ok(action,'QA removal should still be reachable');
  action.click();
  assert.deepEqual(removals,[['one','Framing','front view']]);
});

test('no recorded Sight retains previous empty suggestions behavior',()=>{
  const h=harness();
  h.ctx.state.currentItem.metadata={};
  h.ctx.sync();
  assert.equal(h.getSightCalls(),0);
  assert.equal(h.row.querySelector('[data-sight-suggestions]'),null);
  assert.match(h.row.textContent,/No tag suggestions/);
});

const omissionsStart = source.indexOf("  omissionsEl.classList.toggle('hidden', !omittedAssignments.length);");
const omissionsEnd = source.indexOf('  renderCaptionAssistMissingGroups(', omissionsStart);
assert.ok(omissionsStart > 0 && omissionsEnd > omissionsStart, 'Caption Assist reconciliation UI must exist');

test('reconciliation phrase inserts without changing tags; x removes the assigned tag', () => {
  const dom = new JSDOM('<div id="omissions" class="hidden"></div>');
  const el = dom.window.document.getElementById('omissions');
  const inserts = [];
  const removals = [];
  const ctx = {
    document: dom.window.document,
    renderChecklistGroupTermWithAffixes: (group, term, key) => group + ':' + term + ':' + key,
    renderChecklistTermWithAffixes: term => term,
    insertFocusedCaptionVisionPhrase: phrase => inserts.push(phrase),
    removeCaptionAssistAssignedTag: (key, group, term) => removals.push([key, group, term])
  };
  vm.createContext(ctx);
  vm.runInContext(
    'function renderOmissions(omissionsEl, omittedAssignments, candidate, mediaKey) {\n' +
    source.slice(omissionsStart, omissionsEnd) +
    '\n}\nthis.renderOmissions = renderOmissions;',
    ctx
  );
  const entry = {group: 'Framing', term: 'framed from knees to lower back'};
  const candidate = {omittedAssignments: [entry], omittedCorrections: [entry]};
  ctx.renderOmissions(el, candidate.omittedAssignments, candidate, 'one');

  assert.equal(el.classList.contains('hidden'), false);
  assert.equal(el.querySelector('.caption-assist-reconcile-label').textContent, 'Reconcile (1)');
  const phrase = el.querySelector('.caption-assist-reconcile-insert');
  const remove = el.querySelector('.caption-assist-reconcile-remove');
  assert.equal(el.querySelectorAll('button').length, 2);
  assert.equal(phrase.textContent, entry.term, 'group is not repeated as visible text');
  assert.match(phrase.title, /Framing/);
  assert.match(phrase.title, /insert/);
  assert.equal(remove.textContent, '×');
  assert.match(remove.getAttribute('aria-label'), /Remove tag/);

  const pointerdown = new dom.window.Event('pointerdown', {bubbles: true, cancelable: true});
  phrase.dispatchEvent(pointerdown);
  assert.equal(pointerdown.defaultPrevented, true, 'inserting preserves draft selection');
  phrase.click();
  assert.deepEqual(inserts, ['Framing:framed from knees to lower back:one']);
  assert.deepEqual(removals, [], 'inserting must not remove the assigned tag');
  remove.click();
  assert.deepEqual(removals, [['one', 'Framing', entry.term]]);
  assert.equal(inserts.length, 1, 'remove click must not insert');
});

test('reconciliation is hidden when no annotations are omitted', () => {
  const dom = new JSDOM('<div id="omissions"></div>');
  const el = dom.window.document.getElementById('omissions');
  const ctx = {document: dom.window.document};
  vm.createContext(ctx);
  vm.runInContext(
    'function renderOmissions(omissionsEl, omittedAssignments, candidate, mediaKey) {\n' +
    source.slice(omissionsStart, omissionsEnd) +
    '\n}\nthis.renderOmissions = renderOmissions;',
    ctx
  );
  ctx.renderOmissions(el, [], {omittedCorrections: []}, 'one');
  assert.equal(el.classList.contains('hidden'), true);
  assert.equal(el.children.length, 0);
});
