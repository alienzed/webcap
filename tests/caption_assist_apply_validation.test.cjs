'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('tool/js/primer_settings.js', 'utf8');
const from = source.indexOf('function useCaptionAssistCandidate() {');
const to = source.indexOf('\nfunction cancelCaptionAssistGeneration() {', from);
assert.ok(from >= 0 && to > from, 'Caption Assist Apply path is missing.');
const applySource = source.slice(from, to) + '\nthis.apply = useCaptionAssistCandidate;';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function tick() { await new Promise(resolve => setImmediate(resolve)); }

function fixture({ focused = true, qa = false, caption = 'Old caption', candidate = 'Accepted caption' } = {}) {
  const item = { key: 'photo.jpg', fileName: 'photo.jpg', caption, metadata: {} };
  const entries = [];
  const context = vm.createContext({
    state: { folder: 'set', items: [item], currentItem: item },
    ui: { editorEl: { value: caption, focus() { entries.push('focus'); } } },
    captionAssistCandidate: { mediaKey: 'photo.jpg', text: candidate },
    captionAssistApplyPending: false,
    getPrimerResetCurrentMediaItem() { return item; },
    cancelCaptionAssistEnrichment() {},
    cancelCurrentCaptionVision() { entries.push('stop-vision'); return Promise.resolve(); },
    isFocusedCaptionOpen() { return focused; },
    isFocusedQaReviewMode() { return qa; },
    qaFocusReviewFindings() { return []; },
    qaFocusReviewRefreshAfterApply() { return false; },
    resolveFocusedQaReviewItem() { entries.push('qa-resolve'); return Promise.resolve(true); },
    cancelEditorAutosaveForCaption(folder, file) { entries.push('cancel-autosave:' + file); },
    syncCaptionAssistCandidateUi() {},
    saveCaptionDirect(folder, file, text, key, options) {
      assert.equal(options.skipRenderFileList, true);
      entries.push('caption-saved:' + text);
      item.caption = text;
      return Promise.resolve();
    },
    aiValidationRecordAcceptedCaption(media, text, folder) {
      assert.equal(media, item);
      assert.equal(text, candidate);
      assert.equal(folder, 'set');
      entries.push('validation-saved');
      return Promise.resolve(true);
    },
    forgetCaptionAssistCandidate(key) { entries.push('draft-forgotten:' + key); },
    closeCaptionAssistPresentation() { entries.push('presentation-closed'); },
    applyEditorTextAndTriggerInput(text) { context.ui.editorEl.value = text; entries.push('editor:' + text); },
    advanceFocusedCaption() { entries.push('advance'); return Promise.resolve(true); },
    renderFileList() { entries.push('render'); },
    setStatus(msg) { entries.push('status:' + msg); },
    reportConsoleError(label, err) { entries.push('error:' + label + ': ' + err.message); }
  });
  vm.runInContext(applySource, context);
  return { context, entries, item };
}

test('Focus Caption Apply writes validation before refreshing the filtered list or advancing', async () => {
  const { context: c, entries } = fixture();
  const awaiting = deferred();
  c.aiValidationRecordAcceptedCaption = () => { entries.push('validation-start'); return awaiting.promise; };

  const operation = c.apply();
  await tick();
  assert.ok(entries.includes('caption-saved:Accepted caption'));
  assert.ok(entries.includes('validation-start'));
  assert.equal(entries.includes('advance'), false);
  assert.equal(entries.includes('render'), false);
  assert.equal(c.captionAssistApplyPending, true);
  assert.equal(await c.apply(), false, 'Double clicks cannot start another acceptance');

  awaiting.resolve(true);
  assert.equal(await operation, true);
  assert.ok(entries.indexOf('render') > entries.indexOf('validation-start'));
  assert.ok(entries.indexOf('advance') > entries.indexOf('render'));
  assert.equal(c.captionAssistCandidate, null);
  assert.equal(c.captionAssistApplyPending, false);
  assert.ok(entries.some(x => x.includes('AI Validated.')));
});

test('Accept & Next validates unchanged but explicitly accepted captions without resaving', async () => {
  const { context: c, entries } = fixture({ caption: 'Already saved', candidate: 'Already saved' });
  c.saveCaptionDirect = () => { throw Error('unchanged acceptance should not rewrite caption'); };
  assert.equal(await c.apply(), true);
  assert.ok(entries.includes('validation-saved'));
  assert.ok(entries.includes('advance'));
});

test('Standalone Apply saves, validates and then refreshes the Needs AI Validation filter', async () => {
  const { context: c, entries, item } = fixture({ focused: false });
  assert.equal(await c.apply(), true);
  assert.equal(item.caption, 'Accepted caption');
  assert.equal(c.ui.editorEl.value, 'Accepted caption');
  assert.ok(entries.indexOf('caption-saved:Accepted caption') < entries.indexOf('validation-saved'));
  assert.ok(entries.indexOf('validation-saved') < entries.indexOf('render'));
  assert.equal(entries.includes('advance'), false);
  assert.ok(entries.includes('presentation-closed'));
  assert.ok(entries.includes('focus'));
});

test('Failed caption save or failed receipt keeps the candidate and never advances', async () => {
  const first = fixture();
  first.context.saveCaptionDirect = () => Promise.reject(new Error('disk full'));
  assert.equal(await first.context.apply(), false);
  assert.equal(first.context.captionAssistCandidate.text, 'Accepted caption');
  assert.equal(first.entries.includes('advance'), false);
  assert.equal(first.entries.includes('validation-saved'), false);
  assert.ok(first.entries.some(x => x.includes('Could not save AI caption candidate: disk full')));
  assert.ok(first.entries.some(x => x.includes('error:Caption Assist · Apply Caption: disk full')));

  const second = fixture();
  second.context.aiValidationRecordAcceptedCaption = () => Promise.reject(new Error('receipt write failed'));
  assert.equal(await second.context.apply(), false);
  assert.equal(second.context.captionAssistCandidate.text, 'Accepted caption');
  assert.equal(second.entries.includes('advance'), false);
  assert.equal(second.entries.includes('render'), false);
  assert.ok(second.entries.some(x => x.includes('Caption saved, but AI validation failed: receipt write failed')));
  assert.equal(second.context.captionAssistApplyPending, false);
});

test('QA Focus Review retains its own review lifecycle instead of validating incomplete QA', async () => {
  const { context: c, entries } = fixture({ focused: true, qa: true });
  c.aiValidationRecordAcceptedCaption = () => { throw Error('QA acceptance should not issue AI-validation receipt'); };
  assert.equal(await c.apply(), true);
  assert.ok(entries.includes('qa-resolve'));
  assert.equal(entries.includes('advance'), false);
});

test('Only Caption Assist acceptance calls the receipt path; ordinary editor Apply is unaffected', () => {
  const editorApply = source.slice(source.indexOf("  if (applyCaptionBtn && !applyCaptionBtn.__captionApplyBound)"),
    source.indexOf("  updatePrimerCaptionResetUi();\n}", source.indexOf("  if (applyCaptionBtn && !applyCaptionBtn.__captionApplyBound)")));
  assert.doesNotMatch(editorApply, /aiValidationRecordAcceptedCaption/);
  assert.match(source, /useBtn\.disabled = !!pending \|\| captionAssistApplyPending;/);
  assert.match(source, /Apply & Validate/);
});
