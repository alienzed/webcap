'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {test} = require('node:test');

const css = fs.readFileSync('tool/css/generate.css', 'utf8');

function declaration(selector) {
  const start = css.indexOf(selector + ' {');
  assert.ok(start >= 0, 'Missing selector: ' + selector);
  const end = css.indexOf('}', start);
  assert.ok(end > start, 'Missing CSS block end: ' + selector);
  return css.slice(start, end);
}

test('Generations preview grid can shrink to the available width', () => {
  const frame = declaration('.generate-active-preview');
  assert.match(frame, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(frame, /grid-template-rows:\s*minmax\(0,\s*1fr\) auto/);
  assert.match(frame, /overflow:\s*hidden/);
});

test('Large image and video previews stay within the media cell without cropping', () => {
  const media = declaration('.generate-stage-media');
  const fit = declaration('.generate-stage-media img,\n.generate-stage-media video');
  assert.match(media, /min-width:\s*0/);
  assert.match(media, /min-height:\s*0/);
  assert.match(media, /overflow:\s*hidden/);
  assert.match(fit, /width:\s*100%/);
  assert.match(fit, /height:\s*100%/);
  assert.match(fit, /object-fit:\s*contain/);
});
