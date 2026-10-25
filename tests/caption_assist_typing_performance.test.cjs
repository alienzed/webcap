'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');

const source = fs.readFileSync('tool/js/primer_settings.js', 'utf8');
const start = source.indexOf('function captionAssistCompareWords(');
const end = source.indexOf('function syncCaptionAssistCandidateUi(', start);
assert.ok(start >= 0 && end > start, 'Caption Assist comparison must have a stable owner');

function harness() {
  const dom = new JSDOM('<details id="comparison"></details>');
  const item = {key:'item1', caption:'A model wearing a striped bikini top'};
  const candidate = {mediaKey:'item1', text:'A model wearing a striped bikini top and skirt'};
  const sandbox = {document:dom.window.document, state:{currentItem:item},
    captionAssistCandidate:candidate};
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start,end)+
    '\nthis.renderCaptionAssistComparison = renderCaptionAssistComparison;', sandbox);
  return {render:sandbox.renderCaptionAssistComparison, dom, item, candidate,
    panel:dom.window.document.querySelector('#comparison')};
}

test('collapsed comparison does not allocate per-word DOM, but opens with actual differences',()=>{
  const h=harness();
  h.render(h.panel,h.item,h.candidate);
  assert.equal(h.panel.children.length,1, 'collapsed only needs its summary');
  assert.match(h.panel.textContent,/Changes vs saved caption/);
  h.panel.open=true;
  h.panel.dispatchEvent(new h.dom.window.Event('toggle'));
  assert.equal(h.panel.children.length,3, 'expanded comparison shows summary and two rows');
  assert.ok(h.panel.querySelectorAll('.caption-assist-comparison-text span').length>12);
  h.candidate.text+=' again';
  h.render(h.panel,h.item,h.candidate);
  assert.match(h.panel.textContent,/again/);
  h.panel.open=false;
  h.render(h.panel,h.item,h.candidate);
  assert.equal(h.panel.children.length,1);
});

test('unchanged comparisons remain hidden and previous item does not bleed through',()=>{
  const h=harness();
  h.render(h.panel,h.item,h.candidate);
  h.candidate.text=h.item.caption;
  h.render(h.panel,h.item,h.candidate);
  assert.equal(h.panel.classList.contains('hidden'),true);
  assert.equal(h.panel.children.length,0);
  h.item={key:'new-item',caption:'Different saved caption'};
  h.candidate={mediaKey:'item1',text:'Old proposed caption'};
  h.render(h.panel,h.item,h.candidate);
  assert.equal(h.panel.classList.contains('hidden'),true);
});

test('normal draft edits bypass costly Sight, but QA review retains live tag actions',()=>{
  const sync = source.slice(source.indexOf('function syncCaptionAssistCandidateUi('),
    source.indexOf('function wirePrimerCaptionResetUi('));
  assert.match(sync,/var draftEdit = !!\(options && options\.draftEdit\) && !isFocusedQaReviewMode\(\)/);
  assert.match(sync,/if \(!draftEdit\) syncFocusedCaptionVisionPhrasesUi\(\)/);
  assert.match(sync,/if \(editorDocked && !draftEdit\)/);
  const input = source.slice(source.indexOf('candidateTextEl.addEventListener(\'input\''),
    source.indexOf('if (!visionPhrasesBtn.__focusedCaptionPhrasesBound)'));
  assert.match(input,/syncCaptionAssistCandidateUi\(\{draftEdit: true\}\)/);
});
