'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../tool/js/test_generations.js'), 'utf8');
const start = source.indexOf('  window.testGenerationsReceiveSetPrompt = function(');
const end = source.indexOf('  function savedTestModelState() {', start);
assert.ok(start >= 0 && end > start, 'Shared prompt API must remain identifiable');

test('Campaign and Manual edits update the native Tests draft and serialize saves', async () => {
  const promptControl = { value: 'old prompt' };
  const seenFinder = [];
  const requests = [];
  const resolvers = [];
  const ctx = {
    window: { epochFinderReceiveSetPrompt: (...args) => seenFinder.push(args) },
    state: { folder: 'my/set' },
    launchFolder: 'my/set',
    prepared: {},
    preparedContext: 'my/set|minimax_h3',
    wildcardIntent: null,
    debouncedWorkspacePromptSaves: Object.create(null),
    pendingWorkspacePromptWrites: Object.create(null),
    debounceCreate: () => (fn) => fn(),
    currentTestModelId: () => 'minimax_h3',
    owningSetFolder: (folder) => folder,
    el: (id) => id === 'test-generations-prompt' ? promptControl : null,
    requestForFolder: (_folder, _operation, criteria) => {
      requests.push(criteria.prompt);
      return new Promise((resolve) => { resolvers.push(resolve); });
    },
    showError: (error) => { throw error; },
    Promise
  };
  vm.runInNewContext(source.slice(start, end), ctx);
  const save = ctx.window.testGenerationsSaveSharedSetPrompt;
  save('first {red|green}');
  assert.equal(promptControl.value, 'first {red|green}');
  save('second {red|blue}');
  assert.equal(promptControl.value, 'second {red|blue}');
  assert.deepEqual(seenFinder.map((entry) => entry[2]),
    ['first {red|green}', 'second {red|blue}']);

  await Promise.resolve();
  assert.deepEqual(requests, ['first {red|green}'], 'Earlier write must finish before latest write starts');
  resolvers.shift()();
  for (let i = 0; i < 4; i++) await Promise.resolve();
  assert.deepEqual(requests, ['first {red|green}', 'second {red|blue}']);
  resolvers.shift()();
  for (let i = 0; i < 4; i++) await Promise.resolve();
});

test('An unsaved edit for one Set is not canceled by editing another Set', async () => {
  const requests = [];
  const ctx = {
    window: { epochFinderReceiveSetPrompt: () => {} },
    state: { folder: 'set-one' },
    launchFolder: 'set-one',
    wildcardIntent: null,
    debouncedWorkspacePromptSaves: Object.create(null),
    pendingWorkspacePromptWrites: Object.create(null),
    debounceCreate: () => (fn) => fn(),
    currentTestModelId: () => 'minimax_h3',
    owningSetFolder: (folder) => folder,
    el: () => ({ value: '' }),
    requestForFolder: (folder, _op, criteria) => {
      requests.push([folder, criteria.prompt]);
      return Promise.resolve({});
    },
    showError: (error) => { throw error; },
    Promise
  };
  vm.runInNewContext(source.slice(start, end), ctx);
  ctx.window.testGenerationsSaveSharedSetPrompt('prompt one');
  ctx.launchFolder = 'set-two';
  ctx.state.folder = 'set-two';
  ctx.window.testGenerationsSaveSharedSetPrompt('prompt two');
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.deepEqual(JSON.parse(JSON.stringify(requests)),
    [['set-one', 'prompt one'], ['set-two', 'prompt two']]);
});
