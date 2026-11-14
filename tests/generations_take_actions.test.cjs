// Run with: node --test tests/generations_take_actions.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Minimal DOM: exercises the real keyed pending-card renderer, not a replacement implementation.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.parent = null;
    this.dataset = {};
    this.className = '';
    this.attributes = {};
    this.textContent = '';
    this.disabled = false;
  }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() {
    if (!this.parent) return null;
    return this.parent.children[this.parent.children.indexOf(this) + 1] || null;
  }
  get classList() {
    return {
      contains: name => this.className.split(' ').includes(name),
      toggle: (name, active) => {
        const names = new Set(this.className.split(' ').filter(Boolean));
        if (active) names.add(name); else names.delete(name);
        this.className = [...names].join(' ');
      }
    };
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) {
    delete this.attributes[name];
    if (name.startsWith('data-')) delete this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())];
  }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, before) {
    child.remove();
    child.parent = this;
    const index = before ? this.children.indexOf(before) : this.children.length;
    this.children.splice(index, 0, child);
    return child;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = null;
  }
  set innerHTML(value) { this.children = []; this.html = value; }
  get innerHTML() { return this.html || ''; }
  querySelectorAll(selector) {
    const cls = selector.match(/\.([a-zA-Z0-9_-]+)/);
    const attr = selector.match(/\[data-([a-zA-Z0-9_-]+)\]/);
    const dataName = attr ? attr[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()) : '';
    const matches = node => (!cls || node.classList.contains(cls[1])) &&
      (!attr || Object.hasOwn(node.dataset, dataName));
    const found = [];
    for (const child of this.children) {
      if (matches(child)) found.push(child);
      found.push(...child.querySelectorAll(selector));
    }
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function setup() {
  const nodes = {}, calls = [], errors = [];
  const env = {
    console,
    Uint32Array,
    Date,
    document: {
      getElementById: id => nodes[id] || (nodes[id] = new Element()),
      createElement: tag => new Element(tag)
    },
    window: {
      APP_CONFIG: {},
      reportConsoleError: (...args) => errors.push(args),
      refreshInferenceQueue: async () => {}
    },
    formatInferenceJobStatus: job => String(job.status || ''),
    fetch: async (url, options) => {
      const payload = JSON.parse(options.body);
      calls.push({ url, ...payload });
      return { ok: true, json: async () => ({
        job: { jobId: payload.jobId, modelId: 'h3',
          status: payload.operation === 'cancel' ? 'cancelled' : 'stopping' }
      }) };
    }
  };
  let source = fs.readFileSync(path.join(__dirname, '..', 'tool/js/generate.js'), 'utf8');
  assert.ok(source.includes('  bindUi();'), 'expected Generations entrypoint');
  source = source.replace('  bindUi();', `
    window.takeTestApi = {
      state: generateState,
      syncPreview: syncGenerationPreviewCard,
      requestAction: requestGenerationJobAction,
      handleAction: handleGenerationJobAction
    };
  `);
  // The standalone renderer fixture does not initialize the full form/dropzones.
  source = source.replace('  resetGeneratePromptScratch();', '');
  vm.createContext(env);
  vm.runInContext(source, env, { filename: 'generate.js' });
  return { env, nodes, calls, errors, api: env.window.takeTestApi };
}

test('queued, backlogged and running Takes expose the correct independent actions', async () => {
  const { api, nodes, calls } = setup();
  api.syncPreview({ jobId: 'queued', modelId: 'h3', status: 'queued' }, true);
  const takes = nodes['generate-takes'];
  const queuedEntry = takes.querySelector('.generate-take-pending-entry[data-generation-job-id]');
  const queuedButton = queuedEntry.querySelector('[data-generate-job-action]');
  assert.equal(queuedButton.textContent, 'Cancel');
  assert.equal(queuedButton.dataset.generateJobAction, 'cancel');

  api.syncPreview({ jobId: 'backlog', modelId: 'h3', status: 'backlog' });
  const backlogEntry = takes.children[0];
  assert.equal(backlogEntry.querySelector('[data-generate-job-action]').textContent, 'Cancel');

  api.syncPreview({ jobId: 'running', modelId: 'h3', status: 'running' }, true);
  const runningEntry = takes.children[0];
  const runningButton = runningEntry.querySelector('[data-generate-job-action]');
  const stageButton = nodes['generate-active-preview'].querySelector('[data-generate-job-action]');
  assert.equal(runningButton.textContent, 'Stop');
  assert.equal(stageButton.textContent, 'Stop');
  assert.equal(stageButton.dataset.jobId, 'running');
  assert.equal(runningEntry.children[0].tagName, 'button');
  assert.equal(runningEntry.children[1].tagName, 'button', 'action is a sibling, not nested inside the Take button');

  await api.requestAction('cancel', 'queued');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { url: '/fs/inference', operation: 'cancel', jobId: 'queued' });
  assert.equal(queuedEntry.parent, null, 'only the cancelled Take should disappear');
  assert.equal(runningEntry.parent, takes);
  assert.equal(backlogEntry.parent, takes);

  const stopRequest = api.requestAction('stop', 'running');
  assert.equal(runningButton.disabled, true, 'prevent duplicate stop requests');
  assert.equal(stageButton.disabled, true, 'preview reflects the same in-flight request');
  await stopRequest;
  assert.deepEqual(calls[1], { url: '/fs/inference', operation: 'stop', jobId: 'running' });
  assert.equal(takes.children[0], runningEntry, 'polling and status changes preserve the Take DOM');
  assert.equal(runningButton.textContent, 'Stopping…');
  assert.equal(runningButton.disabled, true);
  assert.equal(stageButton.textContent, 'Stopping…');

  api.syncPreview({ jobId: 'running', modelId: 'h3', status: 'stopped' });
  assert.equal(runningEntry.parent, null);
  assert.equal(api.state.activePendingJobId, '');
  assert.equal(backlogEntry.parent, takes, 'stopping does not cancel the rest of the queue');
});

test('a failed stop remains visible and its controls recover', async () => {
  const { env, nodes, errors, api } = setup();
  api.syncPreview({ jobId: 'running', modelId: 'h3', status: 'running' }, true);
  const button = nodes['generate-active-preview'].querySelector('[data-generate-job-action]');
  env.fetch = async () => { throw new Error('provider temporarily unreachable'); };
  await api.requestAction('stop', 'running');
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Stop');
  assert.equal(api.state.pendingJobsById.running.status, 'running');
  assert.ok(errors.some(args => String(args[1]).includes('provider temporarily unreachable')),
    'operational failure should reach the global console');
});
