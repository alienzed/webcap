// Regression contract for the QA recommendation -> contextual Assistant bridge.
// Run with: node --test tests/qa_finding_chat.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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

test('QA Advisor sends the evidence snapshot before all conversation turns', async () => {
  const assistant = read('review_assistant.js');
  const start = assistant.indexOf('  var qaFindingContext = null;');
  const end = assistant.indexOf('  function bindReviewAssistantButton() {', start);
  assert.ok(start >= 0 && end > start);
  let registered;
  let opened;
  let request;
  const context = vm.createContext({
    Promise, JSON, String,
    cancelReview: async () => {},
    requestJson: async (_url, opts) => {
      request = JSON.parse(opts.body);
      return {job: {jobId: 'qa-job'}};
    },
    waitForJob: async () => ({result: {text: 'Clarification'}}),
    window: {
      registerAssistantMode(mode) { registered = mode; },
      openAssistant(target) { opened = target; }
    }
  });
  vm.runInContext(assistant.slice(start, end), context);
  context.window.openQaFindingAssistant({
    folder: '/set', trainingFocus: 'Bikini fit',
    captionPrimer: 'Describe pose before clothing.',
    finding: {id: 'finding-1', title: 'Check the strap'},
    items: [{fileName: 'a.png', caption: 'One model', groupedTags: [], tags: []}],
    affectedCount: 1
  });
  assert.equal(opened.mode, 'qa-finding');
  assert.equal(typeof opened.contextKey, 'string');
  const result = await registered.execute({
    modelId: 'director-model',
    messages: [
      {role: 'user', content: 'Why?'},
      {role: 'assistant', content: 'The saved sight conflicts.'},
      {role: 'user', content: 'Could it be a reflection?'}
    ]
  });
  assert.equal(result.text, 'Clarification');
  assert.equal(request.model, 'director-model');
  assert.deepEqual(Array.from(request.messages.slice(1).map(m => m.role)),
    ['user', 'assistant', 'user']);
  assert.ok(request.messages[0].content.includes('Describe pose before clothing.'));
  assert.ok(request.messages[0].content.includes('a.png'));
  assert.equal(request.messages[3].content, 'Could it be a reflection?');
});

test('Opening a new finding resets only that contextual conversation, not ordinary chat', () => {
  const assistant = read('director_chat.js');
  const start = assistant.indexOf('  window.openAssistant = function (target) {');
  const end = assistant.indexOf('  window.setDirectorChatOpen = setOpen;', start);
  assert.ok(start >= 0 && end > start);
  const state = {
    pending: false,
    modeContextKeys: {'qa-finding': 'before'},
    modeMessages: {'qa-finding': [{role: 'user', content: 'old'}], chat: [{role: 'user', content: 'saved'}]},
    modeElapsedByAssistantIndex: {},
    modeMetricsByAssistantIndex: {}
  };
  const input = {value: 'old draft'};
  const calls = [];
  const context = vm.createContext({
    state,
    String,
    Error,
    el: () => input,
    setOpen: (open, mode) => { calls.push([open, mode]); },
    window: {}
  });
  vm.runInContext(assistant.slice(start, end), context);
  context.window.openAssistant({mode: 'qa-finding', contextKey: 'next'});
  assert.equal(state.modeMessages['qa-finding'].length, 0);
  assert.equal(state.modeMessages.chat.length, 1);
  assert.equal(input.value, '');
  assert.equal(calls[0][1], 'qa-finding');
  state.modeMessages['qa-finding'].push({role: 'user', content: 'current'});
  context.window.openAssistant({mode: 'qa-finding', contextKey: 'next'});
  assert.equal(state.modeMessages['qa-finding'].length, 1);
  state.pending = true;
  assert.throws(() => context.window.openAssistant({mode: 'qa-finding', contextKey: 'third'}), /Finish the current Assistant response/);
  assert.equal(state.modeContextKeys['qa-finding'], 'next');
});
