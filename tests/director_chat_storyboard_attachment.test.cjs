const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const chat = fs.readFileSync(path.join(__dirname, '..', 'tool', 'js', 'director_chat.js'), 'utf8');
const storyboard = fs.readFileSync(path.join(__dirname, '..', 'tool', 'js', 'storyboard.js'), 'utf8');

function part(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from !== -1 && to > from, 'missing source slice: ' + start);
  return source.slice(from, to);
}

test('Story attachment is inline in the current user request, not only in the system prompt', () => {
  const state = {
    workshop: null,
    storyboardAttachments: {
      'story:story-1': {
        label: 'Story: Escape',
        content: JSON.stringify({ concept: 'An astronaut searches for a lost rover', scenes: [{ title: 'Dawn', summary: 'Search begins' }] })
      }
    }
  };
  const context = vm.createContext({ state, STORYBOARD_WORKSHOP_PRIMER: 'Storyboard primer', JSON });
  const fn = vm.runInContext('(' + part(chat, '  function storyboardRequestMessages(messages) {', '  function attachStoryboardContext(kind) {').trim() + ')', context);
  const history = [{ role: 'user', content: 'What is the premise?' }, { role: 'assistant', content: 'A search.' }, { role: 'user', content: 'What happens in Scene 1?' }];
  const outbound = fn(history);
  assert.equal(outbound.length, 4);
  assert.equal(outbound[0].role, 'system');
  assert.equal(outbound[3].role, 'user');
  assert.match(outbound[3].content, /ATTACHED STORYBOARD REFERENCE/);
  assert.match(outbound[3].content, /An astronaut searches for a lost rover/);
  assert.match(outbound[3].content, /Search begins/);
  assert.match(outbound[3].content, /What happens in Scene 1\?/);
  assert.equal(outbound[2].content, 'A search.');
  assert.equal(history[2].content, 'What happens in Scene 1?');
});

test('Attach is visibly pending and completes only when the Story snapshot is available', async () => {
  let complete;
  const deferred = new Promise(resolve => { complete = resolve; });
  const state = { pending: false, attachmentPending: false, storyboardAttachments: {}, storyGuidelineProposal: {} };
  let refreshes = 0;
  const window = { getStoryboardAssistantContext: () => deferred };
  const context = vm.createContext({ state, window, Promise, syncModeUi: () => { refreshes++; } });
  const fn = vm.runInContext('(' + part(chat, '  function attachStoryboardContext(kind) {', '  function renderWorkshopDiff(').trim() + ')', context);
  const pending = fn('story');
  assert.equal(state.attachmentPending, true);
  assert.equal(state.storyboardAttachments['story:story-1'], undefined);
  complete({ key: 'story:story-1', label: 'Story: Escape', content: '{"concept":"Escape"}' });
  await pending;
  assert.equal(state.attachmentPending, false);
  assert.equal(state.storyboardAttachments['story:story-1'].label, 'Story: Escape');
  assert.equal(state.storyGuidelineProposal, null);
  assert.ok(refreshes >= 2);
});

test('Changing Stories clears a prior Story attachment and its discussion', () => {
  const state = {
    workshop: null,
    storyboardAttachments: { 'story:old-story': { label: 'Story: Old', content: '{}' } },
    storyGuidelineProposal: { text: 'pending' },
    modeMessages: { storyboard: [{ role: 'user', content: 'Discuss old story' }] },
    modeElapsedByAssistantIndex: { storyboard: { '1': 100 } },
    modeMetricsByAssistantIndex: { storyboard: { '1': {} } }
  };
  const window = {};
  const context = vm.createContext({
    state, window, el: () => ({ textContent: '' }), syncModeUi: () => {}
  });
  vm.runInContext(part(chat, '  window.syncStoryboardAssistantStory = function (storyId, sceneIds) {', '  window.openStoryboardAssistant = function'), context);
  window.syncStoryboardAssistantStory('old-story', []);
  assert.equal(Object.keys(state.storyboardAttachments).length, 1);
  window.syncStoryboardAssistantStory('new-story', []);
  assert.equal(Object.keys(state.storyboardAttachments).length, 0);
  assert.equal(state.modeMessages.storyboard.length, 0);
});

test('Story attachment flushes pending edits before constructing the snapshot', async () => {
  const storyState = {
    story: {
      id: 'story-1', title: 'Escape', concept: 'Original draft', style: '',
      guidelines: {}, invariants: [], sceneOrder: [], scenes: {}
    },
    activeSceneId: ''
  };
  let flushed = false;
  const window = {};
  const context = vm.createContext({
    storyState, window, flushPendingSaves: () => {
      flushed = true;
      storyState.story.concept = 'Freshly saved concept';
      return Promise.resolve();
    }
  });
  vm.runInContext(part(storyboard, '  window.getStoryboardAssistantContext = function (kind) {', '  window.openStoryboardActivity = openStoryboardActivity;'), context);
  const item = await window.getStoryboardAssistantContext('story');
  assert.equal(flushed, true);
  assert.equal(JSON.parse(item.content).concept, 'Freshly saved concept');
});
