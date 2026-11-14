// Run with: node --test tests/studio_director_model_readiness.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../tool/js/director_chat.js'), 'utf8');
const workbench = fs.readFileSync(path.join(__dirname, '../tool/js/studio_director_workbench.js'), 'utf8');

function directorFixture() {
  const env = {
    window: {},
    getDirectorModelPreference: () => '',
    document: {
      getElementById: () => ({}),
      createElement: () => ({})
    }
  };
  // Both immediate and DOMContentLoaded binding are valid bootstrap strategies.
  // Isolate the bridge without depending on which startup order Studio uses.
  const bootstrap = /  (?:bind\(\);|if \(document\.readyState === 'loading'\) document\.addEventListener\('DOMContentLoaded', bind\);\n  else bind\(\);)\n\}\)\(\);\s*$/;
  assert.match(source, bootstrap, 'expected Director bootstrap');
  const instrumented = source.replace(bootstrap, [
    '  syncControls = function () {};',
    '  window.__directorTest = { state: state, loadModels: loadModels };',
    '})();'
  ].join('\n'));
  vm.runInNewContext(instrumented, env, { filename: 'director_chat.js' });
  return { env, state: env.window.__directorTest.state, loadModels: env.window.__directorTest.loadModels,
    bridge: env.window.studioDirectorBridge };
}

test('a selected Director model is ready, without an extra manual choice', () => {
  const { state, bridge } = directorFixture();
  state.open = true;
  state.activeMode = 'storyboard';
  state.modelsLoaded = true;
  state.sessionReady = true;
  state.modelId = 'local::selected';
  assert.equal(bridge.isReady(), true);
  assert.equal(bridge.readinessMessage(), '');
  state.pending = true;
  assert.equal(bridge.isReady(), false);
  assert.match(bridge.readinessMessage(), /current Director request/);
  assert.doesNotMatch(bridge.readinessMessage(), /choose.*model/i);
});

test('a missing conversation or async model list is not misdiagnosed as a missing choice', () => {
  const { state, bridge } = directorFixture();
  state.open = true;
  state.activeMode = 'storyboard';
  state.sessionReady = false;
  state.modelId = 'local::selected';
  assert.match(bridge.readinessMessage(), /conversation is loading/);
  state.sessionReady = true;
  state.modelsLoaded = false;
  state.modelId = '';
  assert.match(bridge.readinessMessage(), /models are loading/);
  state.modelsLoaded = true;
  state.modelId = '';
  assert.match(bridge.readinessMessage(), /No Director model is available/);
  state.modelId = 'local::selected';
  state.attachmentPending = true;
  assert.match(bridge.readinessMessage(), /current Director request/);
  state.attachmentPending = false;
  state.open = false;
  assert.match(bridge.readinessMessage(), /Open Studio Director/);
});

test('Director model discovery picks the available model automatically', async () => {
  const { state, bridge, env, loadModels } = directorFixture();
  const select = {
    value: '', disabled: false, innerHTML: '',
    appendChild(option) { this.value = option.value; }
  };
  env.document.getElementById = id => id === 'director-chat-model' ? select : {};
  env.renderDirectorModelOptions = (element, models, selectedId) => {
    const chosen = models.find(model => model.id === selectedId) || models[0];
    element.value = chosen.id;
    return element.value;
  };
  const saved = [];
  env.setDirectorModelPreference = (_key, modelId) => saved.push(modelId);
  env.fetch = async () => ({ok: true, json: async () => ({
    available: true, models: [{id: 'local::one'}, {id: 'remote::two'}]
  })});
  state.open = true;
  state.activeMode = 'storyboard';
  state.sessionReady = true;
  await loadModels();
  assert.equal(state.modelId, 'local::one');
  assert.deepEqual(saved, ['local::one']);
  assert.equal(bridge.isReady(), true);
});

test('workbench uses the actual bridge readiness reason, not a guessed model prompt', () => {
  assert.doesNotMatch(workbench, /Choose a Director model first/);
  assert.doesNotMatch(workbench, /Open Director and choose a model first/);
  assert.match(workbench, /bridge\.readinessMessage\(\)/);
  assert.match(workbench, /window\.studioDirectorBridge\.readinessMessage\(\)/);
});
