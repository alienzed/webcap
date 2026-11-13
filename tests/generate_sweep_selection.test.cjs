'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('tool/js/generate.js', 'utf8');
const begin = source.indexOf('  function loraFolder(name) {');
const end = source.indexOf('  function setLoraMode(mode) {', begin);
assert.ok(begin >= 0 && end > begin, 'Sweep selection functions are present');
const code = source.slice(begin, end) + '\nthis.api = {selectedSweepLoras, setSweepSelection, addSweepFolder, clearSweepSelections, renderSweep, sweepFolders};';

function fixture() {
  const models = {
    a: { id: 'a', loras: ['root.safetensors', 'characters/one.safetensors', 'characters/two.safetensors', 'styles/three.safetensors'] },
    b: { id: 'b', loras: ['misc/four.safetensors'] }
  };
  const fixed = { a: [{name: 'characters/two.safetensors'}], b: [] };
  const state = {sweepSelections: {}, loraMode: 'sweep', director: {busy: false}};
  const nodes = {
    'generate-sweep-folder': {innerHTML: '', value: '', disabled: false},
    'generate-sweep-list': {innerHTML: ''},
    'generate-sweep-summary': {textContent: ''},
    'generate-sweep-clear': {disabled: true},
    'generate-sweep-base': {checked: false},
    'generate-run-btn': {textContent: '', disabled: false, dataset: {}}
  };
  let active = 'a';
  const context = {
    generateState: state,
    selectedLoras: id => fixed[id] || [],
    currentModel: () => models[active],
    el: id => {
      if (!nodes[id]) throw new Error('Missing fixture element: ' + id);
      return nodes[id];
    },
    escapeHtml: value => String(value)
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return {models, fixed, state, nodes, api: context.api, setModel: id => { active = id; }};
}

function names(api, model) { return Array.from(api.selectedSweepLoras(model)); }

test('Sweep starts empty and accumulates candidates across unrelated folders', () => {
  const f = fixture();
  const a = f.models.a;
  assert.deepEqual(names(f.api, a), []);
  f.api.setSweepSelection(a, 'root.safetensors', true);
  f.api.setSweepSelection(a, 'styles/three.safetensors', true);
  f.api.addSweepFolder(a, 'characters');
  assert.deepEqual(names(f.api, a), ['root.safetensors', 'characters/one.safetensors', 'styles/three.safetensors']);
  f.api.addSweepFolder(a, 'characters');
  assert.equal(names(f.api, a).length, 3, 'bulk add is idempotent');
  assert.ok(!names(f.api, a).includes('characters/two.safetensors'), 'fixed LoRAs are excluded');
  assert.equal(f.nodes['generate-run-btn'].textContent, 'Generate Sweep (3)');
  assert.match(f.nodes['generate-sweep-list'].innerHTML, /styles\/three\.safetensors/);
});

test('Selections are independent per Base Model, not per folder', () => {
  const f = fixture();
  f.api.setSweepSelection(f.models.a, 'styles/three.safetensors', true);
  f.setModel('b');
  assert.deepEqual(names(f.api, f.models.b), []);
  f.api.addSweepFolder(f.models.b, 'misc');
  assert.deepEqual(names(f.api, f.models.b), ['misc/four.safetensors']);
  f.setModel('a');
  assert.deepEqual(names(f.api, f.models.a), ['styles/three.safetensors']);
  f.api.clearSweepSelections();
  assert.deepEqual(names(f.api, f.models.a), []);
  assert.deepEqual(names(f.api, f.models.b), ['misc/four.safetensors']);
});

test('Empty selection disables Sweep unless fixed-only baseline is enabled', () => {
  const f = fixture();
  f.api.renderSweep();
  assert.equal(f.nodes['generate-run-btn'].disabled, true);
  assert.equal(f.nodes['generate-sweep-clear'].disabled, true);
  f.nodes['generate-sweep-base'].checked = true;
  f.api.renderSweep();
  assert.equal(f.nodes['generate-run-btn'].disabled, false);
  assert.equal(f.nodes['generate-run-btn'].textContent, 'Generate Sweep (1)');
  f.api.setSweepSelection(f.models.a, 'root.safetensors', true);
  f.api.renderSweep();
  assert.equal(f.nodes['generate-run-btn'].textContent, 'Generate Sweep (2)');
  assert.equal(f.nodes['generate-sweep-clear'].disabled, false);
});
