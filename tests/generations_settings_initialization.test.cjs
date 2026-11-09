'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('tool/js/generate.js', 'utf8');
const html = fs.readFileSync('tool/tool.html', 'utf8');

function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'Expected Generations section: ' + start);
  return source.slice(from, to);
}

const code = section('  function populateModelSelector() {', '  function fieldVisible(') +
  section('  function refreshCapabilities() {', '  function resetGeneratePromptScratch() {') +
  '\nthis.refreshCapabilities = refreshCapabilities;';

function fixture() {
  const fields = ['generate-prompt', 'generate-aspect', 'generate-dimensions',
    'generate-megapixels', 'generate-duration', 'generate-sampling-mode', 'generate-seed'];
  const nodes = Object.fromEntries(['generate-model', ...fields].map(id =>
    [id, { value: '', innerHTML: '', dataset: {} }]));
  const model = {
    id: 'h3', label: 'H3', default: true,
    defaultSettings: {aspectRatio:'16:9', megapixels:0.5, duration:6, samplingMode:'turbo'}
  };
  const state = {models:[], unavailableModels:[], modelId:'h3', editorMode:'working',
    formInitialized:false};
  const requests = [];
  const ctx = {
    generateState:state,
    el:id => nodes[id],
    escapeHtml:s => String(s),
    getGenerateModelPreference:() => 'h3',
    setGenerateModelPreference() {},
    renderModelForm() {
      nodes['generate-aspect'].value = model.defaultSettings.aspectRatio;
      nodes['generate-megapixels'].value = String(model.defaultSettings.megapixels);
      nodes['generate-duration'].value = String(model.defaultSettings.duration);
      nodes['generate-sampling-mode'].value = 'turbo';
    },
    captureGenerateEditorSnapshot() {
      return {modelId:state.modelId,
        fields:Object.fromEntries(fields.map(id=>[id,nodes[id].value]))};
    },
    applyGenerateEditorSnapshot(saved) {
      for (const [id,value] of Object.entries(saved.fields)) nodes[id].value = value;
    },
    requestJson() {
      return new Promise(resolve => requests.push(resolve));
    },
    setStatus() {},
    reportError(err) { throw err; },
    window:{}
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return {ctx, state, nodes, model, requests};
}

test('first capabilities load does not restore empty pre-initialization inputs', async () => {
  const f=fixture();
  const loading=f.ctx.refreshCapabilities();
  f.requests.shift()({models:[f.model], unavailableModels:[], available:true});
  await loading;
  assert.equal(f.state.formInitialized,true);
  assert.equal(f.nodes['generate-aspect'].value,'16:9');
  assert.equal(f.nodes['generate-megapixels'].value,'0.5');
  assert.equal(f.nodes['generate-duration'].value,'6');
});

test('subsequent capabilities refresh retains working editor values', async () => {
  const f=fixture();
  let loading=f.ctx.refreshCapabilities();
  f.requests.shift()({models:[f.model], available:true});
  await loading;
  f.nodes['generate-aspect'].value='9:16';
  f.nodes['generate-megapixels'].value='0.8';
  f.nodes['generate-duration'].value='9';
  loading=f.ctx.refreshCapabilities();
  f.requests.shift()({models:[f.model], available:true});
  await loading;
  assert.equal(f.nodes['generate-aspect'].value,'9:16');
  assert.equal(f.nodes['generate-megapixels'].value,'0.8');
  assert.equal(f.nodes['generate-duration'].value,'9');
});

test('Generations numeric stepper increments are MP 0.1 and duration 1 second', () => {
  assert.match(html, /id="generate-megapixels"[^>]*min="0\.1"[^>]*step="0\.1"/);
  assert.match(html, /id="generate-duration"[^>]*min="3"[^>]*max="15"[^>]*step="1"/);
});
