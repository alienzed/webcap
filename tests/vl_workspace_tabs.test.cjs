'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('tool/js/set_scan.js', 'utf8');
const begin = source.indexOf('  function selectVlWorkspaceTab(tab) {');
const end = source.indexOf('  function renderSightReview()', begin);
assert.ok(begin > 0 && end > begin, 'VL tab owner should be present');

function fixture() {
  const nodes = {};
  const names = ['saved-intelligence-modal', 'saved-intelligence-status',
    'vl-workspace-sight', 'sight-review-activate', 'vl-workspace-describe-run',
    'vl-workspace-tab-sight', 'vl-workspace-tab-ask', 'vl-workspace-tab-describe'];
  names.forEach(name => {
    const classes = new Set();
    nodes[name] = {
      dataset: {}, disabled: false, attributes: {},
      classList: {
        toggle(name, condition) { if (condition) classes.add(name); else classes.delete(name); },
        contains(name) {return classes.has(name);}
      },
      setAttribute(name, value) { this.attributes[name] = value; },
      closest() { return nodes['vl-workspace-sight']; }
    };
  });
  const calls = [];
  const state = {reviewMediaItem:{key:'sample',fileName:'sample.jpg'}};
  const vision = {open:false,mediaKey:'',pending:false,text:'',model:''};
  const sandbox = {
    setScanState:state,
    visionImageCaptionState:vision,
    el(id) { if (!nodes[id]) throw Error('missing UI node '+id); return nodes[id]; },
    openAskVisionQuestion(item) {calls.push(['ask',item.key]);},
    closeVisionImageCaption() {calls.push(['close-desc']); vision.open=false;},
    getCaptionVisionModelId() {return 'vl-A';},
    syncAskVisionUi() {calls.push(['sync-ask']);},
    syncVisionImageCaptionModal() {calls.push(['sync-desc']);}
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(begin,end)+'\nthis.chooseTab=selectVlWorkspaceTab;',sandbox);
  return {choose:sandbox.chooseTab, nodes,calls,state,vision};
}

test('VL Workspace can switch views without starting inference',()=>{
  const f=fixture();
  f.choose('sight');
  assert.equal(f.nodes['saved-intelligence-modal'].dataset.vlTab,'sight');
  assert.equal(f.nodes['vl-workspace-tab-sight'].attributes['aria-pressed'],'true');
  assert.equal(f.calls.filter(row => row[0]==='ask').length,0);
  f.choose('ask');
  assert.equal(f.nodes['vl-workspace-tab-ask'].attributes['aria-pressed'],'true');
  assert.equal(f.calls.filter(row => row[0]==='ask').length,1);
  assert.equal(f.calls.find(row => row[0]==='ask')[1],'sample');
  f.choose('describe');
  assert.equal(f.vision.open,true);
  assert.equal(f.vision.mediaKey,'sample');
  assert.equal(f.vision.model,'vl-A');
  assert.equal(f.nodes['vl-workspace-describe-run'].classList.contains('hidden'),false);
  assert.ok(!f.calls.some(row => row[0]==='request-caption'));
});

test('Describe button is disabled while a request is already pending',()=>{
  const f=fixture();
  f.vision.mediaKey='sample';
  f.vision.pending=true;
  f.choose('describe');
  assert.equal(f.nodes['vl-workspace-describe-run'].disabled,true);
});

test('Unknown VL workspace tabs fail loudly',()=>{
  assert.throws(()=>fixture().choose('invalid'),/Unknown VL Workspace tab/);
});
