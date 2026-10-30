// Regression contract for the QA recommendation -> contextual Assistant bridge.
// Run with: node --test tests/qa_finding_chat.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (name) => fs.readFileSync(path.join(__dirname, '..', 'tool/js', name), 'utf8');

test('QA browse opens a contextual chat with actual current QA evidence', () => {
  const qa = read('qa_workbench.js');
  assert.match(qa, /qaCreateButton\('Ask QA', '', 'ask-finding', finding\.id\)/);
  assert.match(qa, /if \(action === 'ask-finding'\)/);
  assert.match(qa, /qaBuildDeepScanItems\(selected\.map/);
  assert.match(qa, /window\.openQaFindingAssistant\(/);
  assert.match(qa, /trainingFocus: qaWorkbenchState\.trainingFocus/);
  assert.match(qa, /captionPrimer: String\(statsGetPrimerOptionsFromDom\(\)\.template/);
  assert.match(qa, /window\.qaAskCurrentReviewItem = qaAskCurrentReviewItem/);
  assert.match(qa, /relatedFindings: findings/);
  const focus = fs.readFileSync(path.join(__dirname, '..', 'tool/js/focused_caption.js'), 'utf8');
  assert.match(focus, /qaAskCurrentReviewItem\(\)/);
  assert.match(focus, /askQaBtn\.classList\.toggle\('hidden', !isFocusedQaReviewMode\(\)\)/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'tool/tool.html'), 'utf8');
  assert.match(html, /id="preview-focus-caption-ask-qa-btn"/);
});

test('QA chat carries the evidence snapshot and the previous conversation turns', () => {
  const assistant = read('review_assistant.js');
  assert.match(assistant, /id: 'qa-finding'/);
  assert.match(assistant, /qaFindingContext\.prompt/);
  assert.match(assistant, /\.concat\(history\)/);
  assert.match(assistant, /cached Sight description is not a fresh visual inspection/);
  assert.match(assistant, /Existing media and annotations remain unchanged/);
  assert.match(assistant, /Current caption primer:/);
});

test('Assistant preserves contextual mode outside Studio and isolates finding conversations', () => {
  const assistant = read('director_chat.js');
  assert.match(assistant, /!modeId \|\| modeId === 'storyboard'\)\) modeId = 'chat'/);
  assert.match(assistant, /modeContextKeys\[modeId\] !== key/);
  assert.match(assistant, /state\.modeMessages\[modeId\] = \[\]/);
  assert.match(assistant, /messages: messages\.slice\(\)/);
});
