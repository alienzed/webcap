// Run with: node tests/test_vl_color_near_match.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'tool/js/test_generations.js'), 'utf8');
const start = script.indexOf('function testVlNearColorMatch(');
const end = script.indexOf('function testVlCreditText(', start);
assert(start >= 0 && end > start, 'VL near-color matching and scoring must remain available');

const sandbox = { testVl: { disabledGroups: new Set() } };
vm.runInNewContext(script.slice(start, end), sandbox);

[
  ['peach', 'coral', true],
  ['coral', 'peach', true],
  ['blue', 'cyan', true],
  ['cyan', 'blue', true],
  ['cyan', 'teal', true],
  ['purple', 'violet', true],
  ['peach', 'blue', false],
  ['blue', 'red', false],
  ['blue', 'blue', false],
  ['blue swimsuit', 'cyan swimsuit', false],
  ['absent', 'cyan', false]
].forEach(function ([expected, observed, near]) {
  assert.strictEqual(sandbox.testVlNearColorMatch(expected, observed), near,
    JSON.stringify({ expected, observed }));
});

const comparison = [
  { id: 'G1', expectedText: 'peach', selectedText: 'coral', result: 'mismatch' },
  { id: 'G2', expectedText: 'blue', selectedText: 'cyan', result: 'mismatch' },
  { id: 'G3', expectedText: 'green', selectedText: 'red', result: 'mismatch' },
  { id: 'G4', expectedText: 'black', selectedText: 'black', result: 'match' },
  { id: 'G5', expectedText: 'absent', selectedText: 'red', result: 'mismatch' }
];
const score = sandbox.testVlScore(comparison);
assert.strictEqual(score.matches, 1, 'two related colors plus one exact color yield one weighted credit');
assert.strictEqual(score.mismatches, 1.5, 'all color differences have reduced weight');
assert.strictEqual(score.count, 2.5);
assert.strictEqual(comparison[0].result, 'mismatch', 'VL observations remain unchanged');
sandbox.testVl.disabledGroups.add('G1');
assert.strictEqual(sandbox.testVlScore(comparison).matches, 0.75,
  'session exclusion still applies to color near-matches');

assert(script.includes('<strong>Related colors · partial credit</strong>'),
  'near color rows must be identified separately from full differences');
console.log('Test VL near-color agreement checks passed.');
