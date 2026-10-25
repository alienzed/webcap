'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('tool/js/generate.js', 'utf8');
const begin = source.indexOf('  function renderResults(results) {');
const end = source.indexOf('  function startNewGeneration()', begin);
assert.ok(begin > -1 && end > begin, 'Result rendering and explicit Take selection are present');
const code = source.slice(begin, end) + '\nthis.renderResults = renderResults; this.selectGenerationResult = selectGenerationResult;';

function fixture(initial = {}) {
  const calls = [];
  const editor = { prompt: 'My in-progress prompt', loras: ['working-lora'], duration: '7' };
  const state = Object.assign({
    results: [], activeResultKey: '', activePendingJobId: '',
    inspectedResult: null, freshDraft: false
  }, initial);
  const host = {
    firstChild: null,
    querySelectorAll() { return []; },
    querySelector() { return null; },
    insertBefore() {},
    appendChild() {}
  };
  const summary = { textContent: '' };
  const context = {
    generateState: state,
    el(id) {
      if (id === 'generate-results') return host;
      if (id === 'generate-library-summary') return summary;
      throw new Error('Unexpected element: ' + id);
    },
    resultKey(result) { return result && result.jobId || ''; },
    buildResultCard(result) { return { result }; },
    renderTakes(items) { calls.push(['takes', items.map(x => x.jobId)]); },
    renderActiveResult(result) {
      calls.push(['preview', result.jobId]);
      state.activeResultKey = result.jobId;
      state.activePendingJobId = '';
      state.inspectedResult = result;
      state.freshDraft = false;
    },
    renderStageEmpty() { calls.push(['empty']); },
    syncPromptAssistantDependencies() {},
    restoreResultConfiguration(result) {
      calls.push(['restore', result.jobId]);
      editor.prompt = result.sourcePrompt;
      editor.loras = result.loras;
      editor.duration = result.duration;
    },
    document: { createElement() { return {className: '', textContent: ''}; } }
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return { render: context.renderResults, select: context.selectGenerationResult, editor, state, calls };
}
const take = (id) => ({
  jobId:id, sourcePrompt:'Prompt from ' + id,
  loras:['old-take-lora'], duration:'3'
});

test('pending generation completion changes the preview, never the working form', () => {
  const f = fixture({activePendingJobId:'job-1'});
  f.render([take('job-1')]);
  assert.equal(f.state.activeResultKey, 'job-1');
  assert.equal(f.state.activePendingJobId, '');
  assert.deepEqual(f.editor, {
    prompt:'My in-progress prompt',loras:['working-lora'],duration:'7'
  });
  assert.ok(f.calls.some(x=>x[0]==='preview' && x[1]==='job-1'));
  assert.ok(!f.calls.some(x=>x[0]==='restore'));
  // Clicking the Take remains an intentional full configuration restore.
  f.select(take('job-1'));
  assert.equal(f.editor.prompt, 'Prompt from job-1');
  assert.deepEqual(f.editor.loras, ['old-take-lora']);
});

test('background result refresh and initial result preview never restore settings', () => {
  const f = fixture();
  f.render([take('job-2'), take('job-1')]);
  assert.equal(f.editor.prompt,'My in-progress prompt');
  assert.equal(f.state.activeResultKey,'job-2');
  f.render([take('job-3'), take('job-2'), take('job-1')]);
  assert.equal(f.state.activeResultKey,'job-2');
  assert.equal(f.editor.prompt,'My in-progress prompt');
  assert.ok(!f.calls.some(x=>x[0]==='restore'));
});

test('a removed Take changes only preview and never clears a working draft', () => {
  const f = fixture({activeResultKey:'job-deleted'});
  f.render([take('job-remaining')]);
  assert.equal(f.state.activeResultKey,'job-remaining');
  assert.equal(f.editor.prompt,'My in-progress prompt');
  // Deleting a selected Take clears the inspected result before refresh.
  f.state.inspectedResult = null;
  f.render([]);
  assert.equal(f.state.activeResultKey,'');
  assert.equal(f.editor.prompt,'My in-progress prompt');
  assert.ok(!f.calls.some(x=>x[0]==='restore'));
});

test('New Generation fresh draft remains protected from background auto-selection', () => {
  const f = fixture({freshDraft:true});
  f.render([take('job-1')]);
  assert.equal(f.state.activeResultKey,'');
  assert.equal(f.editor.prompt,'My in-progress prompt');
});

test('reopening Generations restores configuration only for explicit target selection', () => {
  const open = source.slice(source.indexOf('  function openGenerateActivity(target) {'),
    source.indexOf('  function closeGenerateActivity()', source.indexOf('  function openGenerateActivity(target) {')));
  assert.match(open,/if \(selected\) renderActiveResult\(selected\)/);
  assert.match(open,/selectGenerationResult\(payload\.result\)/);
  assert.doesNotMatch(open,/if \(selected\) selectGenerationResult\(selected\)/);
});
