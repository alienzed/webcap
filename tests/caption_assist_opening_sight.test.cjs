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

test('subsequent sync retains expanded Sight and independently collapsed assigned tags',()=>{
  const h=harness();
  h.ctx.getChecklistAssignmentEntriesForMediaKey=()=>[{requirement:'BT Shape',term:'ring connectors'}];
  h.ctx.sync();
  const detail=h.row.querySelector('[data-sight-suggestions]');
  detail.open=true;
  detail.dispatchEvent(new h.dom.window.Event('toggle'));
  h.ctx.sync();
  assert.equal(h.row.querySelector('[data-sight-suggestions]').open,true);
  assert.equal(h.row.querySelector('.caption-assist-assigned-tags').open,false,
    'assigned tag disclosure must not inherit the Sight disclosure state');
  assert.ok(h.row.querySelector('[data-sight-suggestions] button'));
  assert.ok(h.getSightCalls()>=2);
});

test('no recorded Sight retains previous empty suggestions behavior',()=>{
  const h=harness();
  h.ctx.state.currentItem.metadata={};
  h.ctx.sync();
  assert.equal(h.getSightCalls(),0);
  assert.equal(h.row.querySelector('[data-sight-suggestions]'),null);
  assert.match(h.row.textContent,/No tag suggestions/);
});
