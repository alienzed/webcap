const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../tool/js/director_chat.js'), 'utf8');

test('explicit Read defaults to neutral receipt rather than creative assessment', () => {
  assert.match(source, /Acknowledge receipt of this material and ask what I would like to do with it/);
  assert.match(source, /If no specific task was requested, simply acknowledge receipt and ask what I want to do next/);
  assert.match(source, /For a Read without a separate substantive user request, acknowledge the received fields/);
  assert.doesNotMatch(source, /Inspect this material and suggest the next useful development step/);
  assert.doesNotMatch(source, /a receipt alone is not an assessment/);
});

test('explicit Read retains field-identifier receipt validation', () => {
  assert.match(source, /state\.pendingReadAck = keys\.slice\(\)/);
  assert.match(source, /Begin the reply field with RECEIVED:/);
  assert.match(source, /using exactly those field identifiers/);
});
