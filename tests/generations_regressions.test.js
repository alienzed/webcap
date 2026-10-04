// Run with: node tests/generations_regressions.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Small DOM fixture: enough to exercise the actual keyed card reconciliation.
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.dataset = {}; this.className = ''; this.attributes = {}; this.textContent = ''; }
  get childNodes() { return this.children; }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() {
    if (!this.parent) return null;
    const index = this.parent.children.indexOf(this);
    return index === -1 ? null : (this.parent.children[index + 1] || null);
  }
  get classList() {
    return { contains: name => this.className.split(' ').includes(name),
      toggle: (name, active) => {
        const names = new Set(this.className.split(' ').filter(Boolean));
        if (active) names.add(name); else names.delete(name);
        this.className = [...names].join(' ');
      }, add: name => this.classList.toggle(name, true), remove: name => this.classList.toggle(name, false) };
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; if (name.startsWith('data-')) delete this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]; }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, before) {
    child.remove(); child.parent = this;
    this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, child);
    return child;
  }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  set innerHTML(value) { this.children = []; this.html = value; }
  get innerHTML() { return this.html || ''; }
  querySelectorAll(selector) {
    const [positive, negative] = selector.split(':not(');
    const matches = element => {
      const classMatch = positive.match(/\.([a-zA-Z0-9_-]+)/);
      const attrMatch = positive.match(/\[data-([a-zA-Z0-9_-]+)\]/);
      const classOk = !classMatch || element.classList.contains(classMatch[1]);
      const dataKey = attrMatch ? attrMatch[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()) : '';
      const attrOk = !attrMatch || Object.prototype.hasOwnProperty.call(element.dataset, dataKey);
      return classOk && attrOk &&
        (!negative || !element.classList.contains(negative.slice(1, -1)));
    };
    const found = [];
    for (const child of this.children) { if (matches(child)) found.push(child); found.push(...child.querySelectorAll(selector)); }
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function environment() {
  const nodes = {}, storage = new Map(), timers = new Map();
  let nextTimer = 1;
  return { nodes, timers, console, Uint32Array,
    Date: { now: () => 100000 },
    document: { getElementById: id => nodes[id] || (nodes[id] = new Element()), createElement: tag => new Element(tag) },
    window: { localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) }, crypto: { getRandomValues: values => { values[0] = 42; } } },
    setTimeout: callback => { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    debounceCreate: () => () => {},
    escapeHtml: value => String(value),
    plain: value => JSON.parse(JSON.stringify(value))
  };
}
function load(script, env, exports) {
  let source = fs.readFileSync(path.join(__dirname, '..', 'tool/js', script), 'utf8');
  source = source.replace('  bindUi();', exports);
  vm.createContext(env);
  vm.runInContext(source, env, { filename: script });
}
async function sweepTests() {
  const env = environment(), requests = [];
  env.fetch = async (url, options) => {
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) {
      // Editing after submission must not alter any later member of this batch.
      env.api.state.lorasByModel.image[0].strength = 1.5;
      env.api.state.lorasByModel.image.push({ name: 'later.safetensors', strength: 1 });
      env.nodes['generate-prompt'].value = 'later prompt';
      env.nodes['generate-sweep-strength'].value = '1.7';
    }
    return { ok: true, json: async () => ({ job: { jobId: 'job-' + requests.length, status: 'queued' } }) };
  };
  load('generate.js', env, `
    captureReferenceFiles = function () { return {}; };
    uploadReferenceFiles = function () { return Promise.resolve({}); };
    syncGenerationPreviewCard = function () {};
    window.api = { state: generateState, runGenerateSweep: runGenerateSweep, capture: captureSweepSubmission, setMode: setLoraMode };
  `);
  env.api = env.window.api;
  const state = env.api.state;
  state.modelId = 'image';
  state.models = [{ id: 'image', settings: ['seed'], loras: ['fixed/one.safetensors', 'fixed/two.safetensors', 'sweep/a.safetensors', 'sweep/b.safetensors'] }];
  state.lorasByModel.image = [{ name: 'fixed/one.safetensors', strength: 0.4 }, { name: 'fixed/two.safetensors', strength: 0.8 }];
  env.document.getElementById('generate-prompt').value = 'original prompt';
  env.document.getElementById('generate-seed').value = '-1';
  env.document.getElementById('generate-sweep-base').checked = true;
  env.document.getElementById('generate-sweep-strength').value = '0.9';
  for (const id of ['generate-lora-selected-tab', 'generate-lora-sweep-tab', 'generate-lora-selected-panel', 'generate-lora-sweep-panel', 'generate-sweep-folder', 'generate-sweep-summary', 'generate-sweep-list', 'generate-sweep-filter', 'generate-sweep-all', 'generate-sweep-none', 'generate-run-btn']) env.document.getElementById(id);
  env.api.setMode('sweep');
  assert.equal(env.nodes['generate-lora-selected-panel'].classList.contains('hidden'), false);
  assert.equal(env.nodes['generate-lora-sweep-panel'].classList.contains('hidden'), false);
  assert.equal(env.nodes['generate-lora-sweep-tab'].attributes['aria-pressed'], 'true');
  assert.equal(env.nodes['generate-sweep-summary'].textContent, '2 of 2 selected · sweep');
  await env.api.runGenerateSweep();
  assert.equal(requests.length, 3);
  const fixed = [{ name: 'fixed/one.safetensors', strength: 0.4 }, { name: 'fixed/two.safetensors', strength: 0.8 }];
  assert.deepEqual(requests.map(request => request.loras), [fixed, [...fixed, { name: 'sweep/a.safetensors', strength: 0.9 }], [...fixed, { name: 'sweep/b.safetensors', strength: 0.9 }]]);
  assert.ok(requests.every(request => request.settings.seed === '42' && request.prompt === 'original prompt'));
  env.api.setMode('selected');
  assert.equal(env.nodes['generate-lora-selected-panel'].classList.contains('hidden'), false);
  assert.equal(env.nodes['generate-lora-sweep-panel'].classList.contains('hidden'), true);
  state.lorasByModel.image = [];
  env.nodes['generate-sweep-base'].checked = false;
  assert.deepEqual(env.plain(env.api.capture().fixedLoras), []);
  const noFixedStart = requests.length;
  await env.api.runGenerateSweep();
  assert.deepEqual(requests.slice(noFixedStart).map(request => request.loras), [
    [{ name: 'sweep/a.safetensors', strength: 1.7 }], [{ name: 'sweep/b.safetensors', strength: 1.7 }]
  ]);
  state.sweepSelections['image|sweep'] = {};
  env.nodes['generate-sweep-base'].checked = true;
  const baselineStart = requests.length;
  await env.api.runGenerateSweep();
  assert.deepEqual(requests.slice(baselineStart).map(request => request.loras), [[]]);
}

function generateTakeIdentityTests() {
  const env = environment();
  env.reportConsoleError = () => {};
  load('generate.js', env, `
    window.api = { state: generateState, renderResults: renderResults };
  `);
  const api = env.window.api;
  const result = {
    jobId: 'video-job',
    storageId: 'video-storage',
    modelId: 'h3',
    mediaKind: 'video',
    mediaPath: 'video.mp4',
    sourcePrompt: 'prompt',
    resolvedPrompt: 'prompt',
    settings: { duration: 5 },
    seed: 7
  };
  api.renderResults([result]);
  const takes = env.document.getElementById('generate-takes');
  const firstCard = takes.children[0];
  const firstMedia = firstCard.children[0].children[0];
  api.renderResults([Object.assign({}, result)]);
  assert.equal(takes.children[0], firstCard, 'refresh must preserve the existing Take card DOM node');
  assert.equal(takes.children[0].children[0].children[0], firstMedia, 'refresh must preserve the existing video DOM node');
}

function generationPreviewExecutionFocusTests() {
  const env = environment();
  env.reportConsoleError = () => {};
  env.formatInferenceJobStatus = job => String(job.status || '');
  load('generate.js', env, `
    window.api = { state: generateState, syncPreview: syncGenerationPreviewCard };
  `);
  const api = env.window.api;

  api.syncPreview({ jobId: 'running-job', modelId: 'h3', status: 'running' }, true);
  assert.equal(api.state.activePendingJobId, 'running-job');

  api.syncPreview({ jobId: 'later-queued-job', modelId: 'h3', status: 'queued' }, true);
  assert.equal(
    api.state.activePendingJobId,
    'running-job',
    'a later queued submission must not displace the executing generation'
  );

  api.syncPreview({ jobId: 'later-queued-job', modelId: 'h3', status: 'running' });
  assert.equal(
    api.state.activePendingJobId,
    'later-queued-job',
    'the preview must follow a tracked generation once it begins executing'
  );
}

function timingTests() {
  const env = environment();
  env.reportConsoleError = () => {};
  load('test_generations.js', env, `
    isOpen = function () { return window.testOpen !== false; };
    refreshActivityButton = function () {};
    window.api = { render: function (status) { currentStatus = status; renderResults(status); }, close: closePane };
  `);
  const api = env.window.api, host = env.document.getElementById('test-generations-results');
  const status = { status: 'running', session: 'one', total: 2, current: 'Base', candidateStartedAt: 97000, results: [{ kind: 'base', sourceLoRA: 'Base', mediaKind: 'image', mediaFile: 'one.png' }] };
  api.render(status);
  const card = host.children[0], media = card.children[0];
  assert.equal(card.querySelector('.test-generations-result-elapsed'), null);
  const pending = host.querySelector('.is-pending');
  assert.equal(pending.querySelector('.test-generations-result-elapsed').textContent, '3s');
  assert.equal(env.timers.size, 1);
  env.Date.now = () => 102000;
  [...env.timers.values()][0]();
  assert.equal(pending.querySelector('.test-generations-result-elapsed').textContent, '5s');
  status.results[0].elapsedMs = 12000;
  api.render(status);
  assert.equal(host.children[0], card);
  assert.equal(card.children[0], media);
  assert.equal(card.querySelector('.test-generations-result-elapsed').textContent, '12s');
  status.status = 'stopping'; api.render(status);
  assert.equal(host.querySelector('.is-pending'), pending);
  assert.equal(pending.querySelector('.test-generations-preview-placeholder').textContent, 'Stopping…');
  status.candidateStartedAt = null; status.startedAt = 1000; api.render(status);
  assert.equal(pending.querySelector('.test-generations-result-elapsed').textContent, '');
  assert.equal(env.timers.size, 0, 'session age must not appear as candidate render time');
  status.status = 'complete'; api.render(status);
  assert.equal(host.querySelector('.is-pending'), null);
  const failed = { status: 'failed', session: 'two', total: 1, failures: [{ sourceLoRA: 'Base', error: 'error' }] };
  api.render(failed);
  const failure = host.children[0]; failed.failures[0].elapsedMs = 9000; api.render(failed);
  assert.equal(host.children[0], failure);
  assert.equal(failure.querySelector('.test-generations-result-elapsed').textContent, 'Failed after 9s');
  api.render(Object.assign({}, status, { status: 'running', candidateStartedAt: 101000 }));
  assert.equal(env.timers.size, 1);
  api.close(); assert.equal(env.timers.size, 0);
}
(async () => { await sweepTests(); generateTakeIdentityTests(); generationPreviewExecutionFocusTests(); timingTests(); console.log('Generations regression tests passed.'); })().catch(err => { console.error(err); process.exitCode = 1; });
