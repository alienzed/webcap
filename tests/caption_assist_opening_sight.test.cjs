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

test('Sight phrase label stays compact while insertion and Tag actions remain distinct',()=>{
  const h=harness();
  const inserted=[];
  const tagged=[];
  h.ctx.getCaptionAssistTagSuggestions=()=>[{group:'Scene',term:'Bed or lounge area',kind:'phrase'}];
  h.ctx.insertFocusedCaptionVisionPhrase=term=>inserted.push(term);
  h.ctx.acceptCaptionAssistTagSuggestion=(key,suggestion)=>tagged.push([key,suggestion.term]);
  h.ctx.sync();
  const details=h.row.querySelector('[data-sight-suggestions]');
  details.open=true;
  details.dispatchEvent(new h.dom.window.Event('toggle'));
  const phrase=details.querySelector('.caption-assist-suggestion-tag');
  const addTag=details.querySelector('.caption-assist-suggestion-insert');
  assert.equal(phrase.textContent,'Bed or lounge area');
  assert.match(phrase.title,/Insert saved Sight phrase/);
  assert.equal(addTag.textContent,'+ Tag');
  phrase.click();
  assert.deepEqual(inserted,['Bed or lounge area']);
  assert.deepEqual(tagged,[]);
  addTag.click();
  assert.deepEqual(tagged,[['one','Bed or lounge area']]);
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

const detailsSource = fs.readFileSync('tool/js/item_details.js', 'utf8');
const liveSyncStart = source.indexOf('function syncCaptionAssistTagsForMediaKey(mediaKey) {');
const liveSyncEnd = source.indexOf('function refreshCaptionAssistAfterTagMutation(', liveSyncStart);
const tagPanelsStart = detailsSource.indexOf('function refreshTagDrivenPanelsForMediaKey(mediaKey) {');
const tagPanelsEnd = detailsSource.indexOf('function updateTagOrderForMediaKey(', tagPanelsStart);
const omittedStart = source.indexOf('function getCaptionAssistOmittedCorrections(');
const omittedEnd = source.indexOf('function getCaptionAssistDraftForMediaItem(', omittedStart);
assert.ok(liveSyncStart > 0 && liveSyncEnd > liveSyncStart, 'Caption Assist must expose a tag-only refresh');
assert.ok(tagPanelsStart > 0 && tagPanelsEnd > tagPanelsStart, 'Shared tag mutation refresh must remain available');
assert.ok(omittedStart > 0 && omittedEnd > omittedStart, 'Live sync must use the existing reconciliation rules');

test('external tag changes immediately reconcile the active draft without requesting a model', () => {
  const item = {key: 'one', fileName: 'one.jpg'};
  const candidate = {mediaKey: 'one', text: 'A red shirt.', omittedAssignments: [], omittedCorrections: []};
  const assignments = [{group: 'Clothing', term: 'red shirt'}];
  const tags = [];
  let uiSyncs = 0;
  let panelRefreshes = 0;
  const ctx = {
    state: {currentItem: item},
    captionAssistCandidate: candidate,
    buildCaptionAssistRequest() {
      return {assignments: assignments.slice(), tags: tags.slice()};
    },
    checklistGroupTermAppearsInCaptionText(group, term, key, caption) {
      return caption.toLowerCase().includes(term.toLowerCase());
    },
    captionAssistAnnotationAppearsInCaption(caption, term) {
      return caption.toLowerCase().includes(term.toLowerCase());
    },
    syncCaptionAssistCandidateUi() { uiSyncs += 1; },
    renderFileList() {},
    updateBalanceDistributionWheel() {},
    renderChecklistPanel() { panelRefreshes += 1; },
    renderItemTagsPanel() {},
    renderItemMetadataPanel() {},
    renderAnnotateStrip() {}
  };
  vm.createContext(ctx);
  vm.runInContext(
    source.slice(omittedStart, omittedEnd) +
    source.slice(liveSyncStart, liveSyncEnd) +
    detailsSource.slice(tagPanelsStart, tagPanelsEnd) +
    '\nthis.refreshTags = refreshTagDrivenPanelsForMediaKey;',
    ctx
  );
  function reconciledTerms() {
    return Array.from(candidate.omittedCorrections, row => row.term);
  }

  ctx.refreshTags('one');
  assert.deepEqual(reconciledTerms(), []);
  assignments.push({group: 'Clothing', term: 'blue tie'});
  ctx.refreshTags('one');
  assert.deepEqual(reconciledTerms(), ['blue tie']);
  tags.push('studio');
  ctx.refreshTags('one');
  assert.deepEqual(reconciledTerms(), ['blue tie', 'studio']);
  assignments.pop();
  ctx.refreshTags('one');
  assert.deepEqual(reconciledTerms(), ['studio']);
  tags.pop();
  ctx.refreshTags('one');
  assert.deepEqual(reconciledTerms(), []);
  assert.equal(candidate.text, 'A red shirt.', 'tag changes must preserve the existing draft');
  assert.equal(uiSyncs, 5, 'the active candidate must resync on every current-item tag change');
  assert.equal(panelRefreshes, 5, 'the existing checklist refresh must continue');

  ctx.refreshTags('other');
  assert.equal(uiSyncs, 5, 'changes to other media must not redraw the active candidate');
  ctx.state.currentItem = {key: 'two', fileName: 'two.jpg'};
  ctx.refreshTags('two');
  assert.equal(uiSyncs, 5, 'a different current item must not modify the old candidate');
});
