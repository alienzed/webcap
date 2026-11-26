const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../tool/js/set_dashboard.js'), 'utf8');

function dashboard(options = {}) {
  const elements = {};
  const listeners = {};
  function element(id) {
    if (elements[id]) return elements[id];
    const classes = new Set(id.startsWith('set-dashboard-') && !['set-dashboard-tags-guided', 'set-dashboard-tags-groups'].includes(id) ? ['hidden'] : []);
    return elements[id] = {
      id, textContent: '', value: '', isConnected: true, open: false, style: {}, children: [], replaceChildren() { this.children = []; },
      removeAttribute(name) { delete elements[id + ':' + name]; },
      classList: {
        toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
        contains(name) { return classes.has(name); },
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); }
      },
      focus() {},
      addEventListener(name, callback) { listeners[id + ':' + name] = callback; },
      setAttribute(name, value) { elements[id + ':' + name] = value; }
    };
  }
  const names = ['analyze', 'review', 'reports'];
  const tabs = names.map(name => {
    const tab = element('tab-' + name);
    tab.getAttribute = key => key === 'data-set-dashboard-tab' ? name : null;
    return tab;
  });
  const document = {
    readyState: 'complete',
    activeElement: element('previous-focus'),
    getElementById: element,
    querySelectorAll(selector) { return selector === '[data-set-dashboard-tab]' ? tabs : []; },
    querySelector(selector) { return tabs.find(tab => selector.includes(tab.getAttribute('data-set-dashboard-tab'))); },
    addEventListener(name, callback) { listeners['document:' + name] = callback; }
  };
  element('stats-required-phrase').value = options.phrase || '';
  element('stats-phrases').value = '';
  const folder = 'Sets/Test';
  const state = { folder, setTrainingFocus: '', setVariables: [], items: options.items || [{ key: 'a', fileName: 'a.png', hasCaption: false, caption: '', metadata: {} }] };
  const actions = [];
  let sightOpen = false;
  const context = {
    document, state,
    statsGetPrimerOptionsFromDom: () => ({ template: 'example template' }),
    window: {
      addEventListener() {},
      getQaTrainingFocus: () => state.setTrainingFocus,
      showQaInSetDashboard: () => actions.push('embedded-qa'),
      hideQaInSetDashboard: () => {},
      setQaTrainingFocus: value => { state.setTrainingFocus = value; },
      isSetIntelligenceOpen: () => sightOpen,
      openSetIntelligence: () => { sightOpen = true; actions.push('prepare'); },
      closeSetIntelligence: () => { sightOpen = false; actions.push('hide-prepare'); }
    },
    checklistItems: options.groups || [],
    getChecklistKeywordTermsForRequirement: () => ['tag'],
    isChecklistRequirementCheckedForMediaKey: (key, name) => typeof options.checked === 'function' ? options.checked(key, name) : !!options.checked,
    getTrainingRunnerActiveJob: () => options.training ? { status: 'running' } : null,
    shellWorkloadState: { trainingActive: !!options.training },
    getShellWorkloadStatus: () => ({
      key: options.training || options.shellLane ? 'active' : 'idle',
      lane: options.training ? 'training' : (options.shellLane || 'idle')
    }),
    getInferenceQueueSnapshot: () => ({ jobs: [] }),
    isSetFolderPath: () => true,
    getFilteredMediaItems: () => options.visibleItems || state.items,
    openSetIntelligence: () => actions.push('prepare'),
    openVisionSchemaAssist: () => actions.push('vocabulary'),
    openChecklistKeywordsModal: () => actions.push('groups'),
    startFocusedAnnotation: () => actions.push('annotation'),
    openGuidedTagPass: () => actions.push('guided'),
    startFocusedCaption: () => actions.push('caption'),
    setWorkspaceSurface: () => actions.push('workspace'),
    setReviewDetailTab: () => actions.push('qa')
  };
  vm.runInNewContext(source, context);
  context.window.openSetDashboard();
  return {
    state, actions, elements, listeners, tabs, context,
    selected: () => names.find(name => elements['tab-' + name + ':aria-selected'] === 'true'),
    title: () => element('set-dashboard-action-title').textContent,
    primary: () => element('set-dashboard-primary'),
    secondary: () => element('set-dashboard-secondary')
  };
}


test('preparation is the default and preserves direct specialist handoffs', () => {
  const app = dashboard({ phrase: 'subject', groups: ['Shape'], checked: true });
  assert.equal(app.selected(), 'analyze');
  assert.equal(app.elements['set-dashboard-tags-count'].textContent, '100%');
  assert.equal(app.elements['set-dashboard-primary'].disabled, false);
  assert.deepEqual(app.actions, ['prepare']);
  app.elements['set-dashboard-tags-guided'].onclick();
  assert.deepEqual(app.actions, ['prepare', 'hide-prepare', 'guided']);
});
test('missing guidance warns without blocking captioning or curation', () => {
  const app = dashboard();
  assert.equal(app.elements['set-dashboard-definition-status'].textContent, 'Training focus and Required key phrase missing');
  assert.equal(app.elements['set-dashboard-primary'].disabled, false);
  assert.equal(app.elements['set-dashboard-curate'].disabled, false);
});
test('QA and reports tabs do not launch inference', () => {
  const app = dashboard();
  app.listeners['tab-review:click']();
  assert.equal(app.selected(), 'review');
  assert.deepEqual(app.actions, ['prepare', 'hide-prepare', 'embedded-qa']);
  app.listeners['tab-reports:click']();
  assert.equal(app.selected(), 'reports');
  app.elements['set-dashboard-review-report'].onclick();
  assert.deepEqual(app.actions, ['prepare', 'hide-prepare', 'embedded-qa', 'workspace', 'qa']);
});
test('authoritative fields and Sight remain unique and footer follows scrolling content', () => {
  const html = fs.readFileSync(path.join(__dirname, '../tool/tool.html'), 'utf8');
  for (const id of ['set-dashboard-modal','stats-required-phrase','stats-phrases','stats-phrases-items','primer-template','set-scan-modal','set-intelligence-primary-btn']) {
    assert.equal((html.match(new RegExp('id="' + id + '"','g')) || []).length,1,id);
  }
  assert.ok(html.indexOf('id="set-dashboard-overview"') > html.indexOf('id="set-dashboard-stage"'));
  assert.match(html, /data-set-dashboard-tab="analyze"[^>]*>Set Preparation/);
});
test('partial annotation cannot round to complete', () => {
  const items = Array.from({ length: 201 }, (_, i) => ({ key: String(i), fileName: i + '.png' }));
  const app = dashboard({ groups: ['Shape'], items, checked: key => key !== '200' });
  assert.equal(app.elements['set-dashboard-tags-count'].textContent, '99%');
});

test('footer uses the same active selection for all coverage', () => {
  const a = {key:'a', fileName:'a.png', hasCaption:true, caption:'subject', metadata:{vision_sight:{description:'observed', inventory:{}}}};
  const b = {key:'b', fileName:'b.png', hasCaption:false, caption:'', metadata:{}};
  const app = dashboard({items:[a,b], visibleItems:[b], groups:['Shape'], checked:true});
  assert.equal(app.elements['set-dashboard-scope'].textContent, '1 of 2 media');
  assert.equal(app.elements['set-dashboard-sight-count'].textContent, '0 / 1');
  assert.equal(app.elements['set-dashboard-captions-count'].textContent, '0 / 1');
  assert.equal(app.elements['set-dashboard-tags-count'].textContent, '100%');
});
test('exclusive coverage partitions overlap; independent terms keep full membership', () => {
  const start = source.indexOf('  function variableCoverage(');
  const end = source.indexOf('  function distributionColor(', start);
  const assigned = {a:['Kneeling'], b:['squatting'], c:['kneeling','squatting'], d:[]};
  const sandbox = {
    getChecklistAssignedTagsForMediaKey: key => assigned[key],
    normalizeChecklistTerm: term => String(term).trim()
  };
  vm.runInNewContext(source.slice(start,end) + '\nthis.coverage = variableCoverage; this.warnings = variableWarnings;',sandbox);
  const items = Object.keys(assigned).map(key=>({key,fileName:key+'.jpg'}));
  const variable = {group:'Position',terms:['kneeling','squatting'],exclusive:true,expected:true};
  const count = r => Array.from(r.rows, row=>row.files.length);
  assert.deepEqual(count(sandbox.coverage(variable,items)), [1,1,1,1]);
  assert.deepEqual(count(sandbox.coverage({...variable,exclusive:false},items)), [2,2,1]);
  assert.deepEqual(Array.from(sandbox.warnings([variable],items),row=>row.kind), ['multiple']);
  const missing = items.filter(item=>item.key!=='a');
  assert.deepEqual(Array.from(sandbox.warnings([variable],missing),row=>row.kind), ['multiple','missing']);
});
test('Curate stays visible outside the preparation content, and Grid has an explicit return action', () => {
  const html = fs.readFileSync(path.join(__dirname, '../tool/tool.html'), 'utf8');
  assert.ok(html.indexOf('id="set-dashboard-curate"') < html.indexOf('id="set-dashboard-stage"'));
  assert.match(html, /id="media-grid-return-to-analysis-btn"/);
});
