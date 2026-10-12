// Run with: node tests/caption_tag_match.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'tool/js/item_details.js'), 'utf8');
const start = script.indexOf('function canonicalizeMatchText(');
const end = script.indexOf('function tagAppearsInCurrentCaption(', start);
assert(start >= 0 && end > start, 'Caption tag matcher functions must remain available');
const sandbox = {};
vm.runInNewContext(script.slice(start, end), sandbox);

const matches = sandbox.captionContainsTagWithAllowances;
[
  ['Her face is censored and blurred.', 'face censored and blurred', true],
  ['The face was censored and blurred.', 'face censored and blurred', true],
  ['Their faces are censored and blurred.', 'faces censored and blurred', true],
  ['Face censored and blurred.', 'face censored and blurred', true],
  ['Face, censored and blurred!', 'face censored and blurred', true],
  ['Two hands are on hips.', 'hands on hips', true],
  ['Her face is not censored and blurred.', 'face censored and blurred', false],
  ['Her face is partially censored and blurred.', 'face censored and blurred', false],
  ['Her face is censored but blurred.', 'face censored and blurred', false],
  ['Her face is uncensored and blurred.', 'face censored and blurred', false],
  ['Her face is not blurred.', 'face blurred', false],
  ['A surface is censored and blurred.', 'face censored and blurred', false]
].forEach(function ([caption, tag, expected]) {
  assert.strictEqual(matches(caption, tag), expected, JSON.stringify({caption, tag}));
});
console.log('Caption tag linking-verb matches passed.');
