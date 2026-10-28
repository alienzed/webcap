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
  const fn = vm.runInContext('(' + part(chat, '  function storyboardRequestMessages(messages, includePrimer) {', '  function attachStoryboardContext(kind) {').trim() + ')', context);
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
  const context = vm.createContext({
    state, window, Promise, syncModeUi: () => { refreshes++; },
    scheduleSessionSave: () => {},
    el: id => id === 'director-chat-attachments-toggle'
      ? { setAttribute: () => {} }
      : { textContent: '' }
  });
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

test('Navigating between Stories does not mutate Assistant context or conversation', () => {
  const state = {
    workshop: null,
    storyboardAttachments: { 'story:old-story': { label: 'Story: Old', content: '{}' } },
    storyGuidelineProposal: { text: 'pending' },
    modeMessages: { storyboard: [{ role: 'user', content: 'Discuss old story' }] }
  };
  const window = {};
  const context = vm.createContext({ state, window });
  vm.runInContext(part(chat, '  window.syncStoryboardAssistantStory = function', '  window.openStoryboardAssistant = function'), context);
  window.syncStoryboardAssistantStory('new-story', []);
  assert.equal(Object.keys(state.storyboardAttachments).length, 1);
  assert.equal(state.modeMessages.storyboard[0].content, 'Discuss old story');
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


function attachmentHelpersContext(state, extra = {}) {
  const context = vm.createContext({ state, JSON, Promise, ...extra });
  vm.runInContext(part(chat, "  var renderedStoryboardAttachmentSnapshot = '';", '  function syncModeUi() {'), context);
  return context;
}

test('Attached Story fields are individually readable and copyable without losing any reference data', () => {
  const story = {
    title: 'Moon crossing',
    concept: 'A rover approaches the crater.',
    style: 'Handheld moonlight.',
    guidelines: { visualFocus: 'Vehicle silhouette', pacing: 'Unhurried' },
    invariants: [{ kind: 'location', title: 'Crater', text: 'Fixed eastern ridge' }],
    scenes: [
      { number: 1, id: 'scene-a', title: 'Arrival', summary: 'First approach' },
      { number: 2, id: 'scene-b', title: 'Return', summary: 'Rover goes home' }
    ]
  };
  const state = {
    storyboardAttachments: {
      'story:one': { key: 'story:one', label: 'Story: Moon crossing', content: JSON.stringify(story, null, 2) },
      'scene:one:scene-a': { key: 'scene:one:scene-a', label: 'Scene 1', content: JSON.stringify({ prompt: 'Camera tracks the rover.', notes: 'Soft cuts.' }) },
      'section:Camera': { label: 'Camera', content: 'Pan slowly across the ridge.' }
    }
  };
  const context = attachmentHelpersContext(state);
  const fields = vm.runInContext('storyboardAttachmentFields(storyboardAttachmentItems()[0])', context);
  assert.equal(fields.find(field => field.label === 'Concept / Overview').text, story.concept);
  assert.equal(fields.find(field => field.label === 'Guidelines · Visual Focus').text, 'Vehicle silhouette');
  assert.equal(fields.find(field => field.label === 'Guidelines · Pacing / Rhythm').text, 'Unhurried');
  assert.match(fields.find(field => field.label === 'Invariant 1 · Crater').text, /Fixed eastern ridge/);
  assert.match(fields.find(field => field.label === 'Scene 1 · Arrival').text, /First approach/);
  assert.match(fields.find(field => field.label === 'Scene 2 · Return').text, /Rover goes home/);
  const sceneFields = vm.runInContext('storyboardAttachmentFields(storyboardAttachmentItems()[1])', context);
  assert.equal(sceneFields.find(field => field.label === 'Generation Prompt').text, 'Camera tracks the rover.');
  const rawFields = vm.runInContext('storyboardAttachmentFields(storyboardAttachmentItems()[2])', context);
  assert.equal(rawFields[0].text, 'Pan slowly across the ridge.');

  const all = vm.runInContext('storyboardAttachmentCopyAll()', context);
  assert.ok(all.includes('Story: Moon crossing:\n' + JSON.stringify(story, null, 2)));
  assert.ok(all.includes('Scene 1:\n'));
  assert.ok(all.includes('Camera:\nPan slowly across the ridge.'));
  const outbound = vm.runInContext(
    '(' + part(chat, '  function storyboardRequestMessages(messages, includePrimer) {', '  function attachStoryboardContext(kind) {').trim() + ')',
    vm.createContext({ state, STORYBOARD_WORKSHOP_PRIMER: 'Storyboard primer', JSON })
  )([{ role: 'user', content: 'What should the camera do?' }]);
  assert.ok(outbound[1].content.includes(all));
});

test('Attached context viewer shows the actual field values and copy actions', async () => {
  class FakeNode {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.attributes = {};
      this.scrollTop = 0;
      this.textContent = '';
      this.classes = new Set();
      this.classList = {
        add: name => this.classes.add(name),
        remove: name => this.classes.delete(name),
        toggle: (name, force) => {
          if (force === false || (force === undefined && this.classes.has(name))) this.classes.delete(name);
          else this.classes.add(name);
        },
        contains: name => this.classes.has(name)
      };
    }
    replaceChildren(...items) { this.children = items; }
    append(...items) { this.children.push(...items); }
    appendChild(item) { this.children.push(item); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
  }
  const nodes = Object.fromEntries([
    'director-chat-attachments', 'director-chat-attachments-toggle',
    'director-chat-attachments-body', 'director-chat-attachments-list',
    'director-chat-attachments-status'
  ].map(id => [id, new FakeNode('div')]));
  nodes['director-chat-attachments-toggle'].setAttribute('aria-expanded', 'true');
  const writes = [];
  const state = {
    activeMode: 'storyboard',
    storyboardAttachments: {
      'story:one': {
        label: 'Story: Test',
        content: JSON.stringify({ title: 'Test', concept: 'A clear reference', guidelines: { pacing: 'Slow' } })
      }
    }
  };
  const context = attachmentHelpersContext(state, {
    el: id => nodes[id],
    document: { createElement: tag => new FakeNode(tag) },
    navigator: { clipboard: { writeText: text => { writes.push(text); return Promise.resolve(); } } },
    window: { reportConsoleError: error => { throw error; } }
  });
  vm.runInContext('renderStoryboardAttachmentViewer()', context);
  assert.equal(nodes['director-chat-attachments'].classList.contains('hidden'), false);
  assert.match(nodes['director-chat-attachments-toggle'].textContent, /Hide attached context · 1/);
  const reference = nodes['director-chat-attachments-list'].children[0];
  assert.equal(reference.children[0].children[0].textContent, 'Story: Test');
  const concept = reference.children.find(row => row.className === 'director-chat-attachment-field'
    && row.children[0].children[0].textContent === 'Concept / Overview');
  assert.ok(concept);
  assert.equal(concept.children[1].textContent, 'A clear reference');
  concept.children[0].children[1].onclick();
  await Promise.resolve();
  assert.equal(writes.at(-1), 'A clear reference');
  assert.match(nodes['director-chat-attachments-status'].textContent, /Copied Concept \/ Overview/);
  reference.children[0].children[1].onclick();
  await Promise.resolve();
  assert.equal(writes.at(-1), 'Story: Test:\n' + state.storyboardAttachments['story:one'].content);

  // Re-render with an unchanged snapshot must preserve scroll and DOM identity.
  const original = nodes['director-chat-attachments-list'].children[0];
  vm.runInContext('renderStoryboardAttachmentViewer()', context);
  assert.equal(nodes['director-chat-attachments-list'].children[0], original);
});

test('Attachment copy failure stays visible and reaches the Console', async () => {
  const errors = [];
  const status = { textContent: '' };
  const context = attachmentHelpersContext({ storyboardAttachments: {} }, {
    el: id => { assert.equal(id, 'director-chat-attachments-status'); return status; },
    navigator: { clipboard: { writeText: () => Promise.reject(new Error('Clipboard denied')) } },
    window: { reportConsoleError: (name, error) => errors.push([name, error.message]) }
  });
  await vm.runInContext("copyStoryboardAttachment('text', 'Concept')", context);
  assert.match(status.textContent, /Copy failed: Clipboard denied/);
  assert.equal(errors[0][0], 'Storyboard context copy');
});

test('Attachment inspection controls exist and reviewed Story updates use the async attachment path', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'tool', 'tool.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'tool', 'css', 'workspace_shell.css'), 'utf8');
  assert.match(html, /id="director-chat-attachments-toggle"/);
  assert.match(html, /id="director-chat-attachments-copy-all"/);
  assert.match(html, /id="director-chat-attachments-list"/);
  assert.match(chat, /renderStoryboardAttachmentViewer\(\);/);
  assert.match(chat, /attachStoryboardContext\('story'\);/);
  assert.doesNotMatch(chat, /state\.storyboardAttachments\[attachedKey\] = window\.getStoryboardAssistantContext/);
  assert.match(css, /width: min\(760px, calc\(100% - 60px\)\)/);
});
