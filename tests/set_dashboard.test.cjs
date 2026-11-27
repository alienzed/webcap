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
      closeSetIntelligence: () => { sightOpen = false; actions.push('hide-prepare'); },
      refreshSetIntelligenceScope: () => {}
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
  element('set-dashboard-definition').open = true;
  context.window.openSetDashboard();
  return {
    state, actions, elements, listeners, tabs, context,
    selected: () => names.find(name => elements['tab-' + name + ':aria-selected'] === 'true'),
    title: () => element('set-dashboard-action-title').textContent,
    primary: () => element('set-dashboard-primary'),
    secondary: () => element('set-dashboard-secondary')
  };
}


test('Dashboard is a native workspace; grouped work is independently accessible', () => {
  const app = dashboard({ phrase: 'subject', groups: ['Shape'], checked: true });
  assert.equal(app.elements['set-dashboard-definition-status'].textContent, 'Training focus missing');
  assert.equal(app.elements['set-dashboard-curate'].disabled, false);
  assert.deepEqual(app.actions, ['workspace', 'prepare']);
  app.elements['set-dashboard-tags-guided'].onclick();
  assert.deepEqual(app.actions, ['workspace', 'prepare', 'hide-prepare', 'workspace', 'guided']);
});
test('QA is opened explicitly and reports retain direct handoffs', () => {
  const app = dashboard();
  app.elements['set-dashboard-review'].open = true;
  app.listeners['set-dashboard-review:toggle']();
  assert.deepEqual(app.actions, ['workspace', 'prepare', 'embedded-qa']);
  app.elements['set-dashboard-review-report'].onclick();
  assert.deepEqual(app.actions, ['workspace', 'prepare', 'embedded-qa', 'hide-prepare', 'workspace', 'workspace', 'qa']);
});
test('authoritative fields and Sight remain unique; Dashboard lives in Prep', () => {
  const html = fs.readFileSync(path.join(__dirname, '../tool/tool.html'), 'utf8');
  for (const id of ['set-dashboard-modal','stats-required-phrase','stats-phrases','stats-phrases-items','primer-template','set-scan-modal','set-intelligence-primary-btn']) {
    assert.equal((html.match(new RegExp('id="' + id + '"','g')) || []).length,1,id);
  }
  assert.ok(html.indexOf('id="prep-workspace-root"') < html.indexOf('id="set-dashboard-modal"'));
  assert.ok(html.indexOf('id="set-dashboard-modal"') < html.indexOf('id="test-generations-workspace"'));
  assert.doesNotMatch(html, /id="set-dashboard-overview"/);
  assert.doesNotMatch(html, /id="set-dashboard-caption"/);
  assert.match(html, /id="set-dashboard-review" class="set-dashboard-section/);
});
test('annotation work counts actual incomplete group assignments', () => {
  const items = Array.from({ length: 201 }, (_, i) => ({ key: String(i), fileName: i + '.png' }));
  const app = dashboard({ groups: ['Shape'], items, checked: key => key !== '200' });
  assert.equal(app.elements['set-dashboard-tags-status'].textContent, '1 group assignment left to review');
});
test('scope is the current visible selection', () => {
  const a = {key:'a', fileName:'a.png', hasCaption:true};
  const b = {key:'b', fileName:'b.png', hasCaption:false};
  const app = dashboard({items:[a,b], visibleItems:[b], groups:['Shape'], checked:true});
  assert.equal(app.elements['set-dashboard-scope'].textContent, '1 of 2 media');
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

test('folder snapshots cannot overwrite later explicit Set edits or cancel another Set', async () => {
  const folderSource=fs.readFileSync(path.join(__dirname,'../tool/js/folder_state.js'),'utf8');
  const start=folderSource.indexOf('var folderStatePendingSaves = new Map();');
  const end=folderSource.indexOf('function captureCurrentFolderStateSave()',start);
  const saveStart=folderSource.indexOf('async function saveFolderStateForCurrentRoot()');
  const saveEnd=folderSource.indexOf('\n\nfunction renderMultilineTemplate',saveStart);
  const writes=[], timers=new Map();
  let seq=0, folder='Set A', snapshot={focus:'old'};
  const sandbox={
    captureCurrentFolderStateSave:()=>({folderPath:folder,snapshot:{...snapshot}}),
    writeCapturedFolderState:async saved=>{writes.push(saved);return true;},
    setTimeout:fn=>{timers.set(++seq,fn);return seq;},
    clearTimeout:id=>timers.delete(id)
  };
  vm.runInNewContext(folderSource.slice(start,end)+folderSource.slice(saveStart,saveEnd),sandbox);
  sandbox.scheduleFolderStateSnapshotSave();
  folder='Set B';snapshot={focus:'B'};
  sandbox.scheduleFolderStateSnapshotSave();
  folder='Set A';snapshot={focus:'new'};
  await sandbox.saveFolderStateForCurrentRoot();
  for(const fn of [...timers.values()])fn();
  assert.deepEqual(writes,[{folderPath:'Set A',snapshot:{focus:'new'}},{folderPath:'Set B',snapshot:{focus:'B'}}]);
});
