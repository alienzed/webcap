'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const captionSource = fs.readFileSync('tool/js/focused_caption.js', 'utf8');
const cropSource = fs.readFileSync('tool/js/crop.js', 'utf8');
const keyboardStart = captionSource.indexOf("document.addEventListener('keydown', function (event) {", captionSource.indexOf("if (!document.__focusedCaptionKeyboardBound)"));
const keyboardEnd = captionSource.indexOf("    }, true);", keyboardStart);
assert.ok(keyboardStart !== -1 && keyboardEnd > keyboardStart, 'Caption Assist capture handler exists');
const keyboardBinding = captionSource.slice(keyboardStart, keyboardEnd + "    }, true);".length);

test('Caption Assist yields Enter to an open Crop modal and resumes after closing', () => {
  let handler;
  let armed = 0;
  let cropOpen = true;
  const context = {
    focusedCaptionState: {open:true},
    captionAssistCandidate: null,
    document: {
      activeElement: null,
      addEventListener(_name, callback) { handler = callback; },
      getElementById(id) { return id === 'crop-modal' ? {classList:{contains(name) { return name === 'hidden' && !cropOpen; }}} : null; }
    },
    window: {},
    isEditableElement: () => false,
    captionAssistEnrichmentReviewActive: () => false,
    armOrUseFocusedCaptionCandidate: () => { armed++; }
  };
  vm.createContext(context);
  const cropStart = cropSource.indexOf('function isCropModalOpen() {');
  const cropEnd = cropSource.indexOf('window.isCropModalOpen = isCropModalOpen;', cropStart);
  assert.ok(cropStart !== -1 && cropEnd > cropStart, 'Crop exposes modal state');
  vm.runInContext(cropSource.slice(cropStart,cropEnd), context);
  vm.runInContext(keyboardBinding, context);
  function key() {
    const event = {key:'Enter', defaultPrevented:false, repeat:false,
      preventDefault(){this.defaultPrevented=true;}, stopImmediatePropagation(){this.stopped=true;}};
    handler(event);
    return event;
  }
  let event = key();
  assert.equal(armed, 0);
  assert.equal(event.defaultPrevented, false);
  assert.equal(event.stopped, undefined);
  cropOpen = false;
  event = key();
  assert.equal(armed, 1);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.stopped, true);
});
