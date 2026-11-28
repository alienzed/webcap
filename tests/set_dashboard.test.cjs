const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../tool/js/set_dashboard.js'), 'utf8');
const folderSource = fs.readFileSync(path.join(__dirname, '../tool/js/folder_state.js'), 'utf8');
const coverageSource = folderSource.slice(folderSource.indexOf('function setVariableCoverage('),
  folderSource.indexOf('function scheduleSetDefinitionSave()'));

function dashboard(options = {}) {
  const elements = {};
  const listeners = {};
  function element(id) {
    if (elements[id]) return elements[id];
    const classes = new Set(id.startsWith('set-dashboard-') && !['set-dashboard-tags-guided', 'set-dashboard-tags-groups'].includes(id) ? ['hidden'] : []);
    return elements[id] = {
      id, textContent: '', value: '', isConnected: true, open: false, style: {}, children: [], replaceChildren() { this.children = []; }, appendChild(node) { this.children.push(node); },
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
    createElement: () => ({className:'', textContent:''}),
    getElementById: element,
    querySelectorAll(selector) { return selector === '[data-set-dashboard-tab]' ? tabs : []; },
    querySelector(selector) { return tabs.find(tab => selector.includes(tab.getAttribute('data-set-dashboard-tab'))); },
    addEventListener(name, callback) { listeners['document:' + name] = callback; }
  };
  element('stats-required-phrase').value = options.phrase || '';
  const folder = 'Sets/Test';
  const state = { folder, setTrainingFocus: '', setVariables: [], items: options.items || [{ key: 'a', fileName: 'a.png', hasCaption: false, caption: '', metadata: {} }] };
  const actions = [];
  let sightOpen = false;
  const context = {
    document, state,
    statsGetPrimerOptionsFromDom: () => ({ template: options.template || 'example template' }),
    getPrimerTemplatePlaceholderItems: () => (options.groups || []).map(label => ({label, placeholder:'{'+label.toLowerCase()+'}'})),
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
    renderChecklistGroupRows(target, options) { assert.equal(target.id, 'set-dashboard-group-list'); assert.equal(options.definition, true); },
    isChecklistRequirementHidden: () => false,
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
    setWorkspaceSurface: surface => {
      if (context.surface === 'dashboard' && surface !== 'dashboard') context.window.closeSetDashboard({keepSurface:true});
      context.surface = surface;
      actions.push('workspace');
    },
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
test('unused template placeholders insert into the draft, never the saved template', () => {
  const app = dashboard({ groups:['Viewpoint','Lighting'], template:'subject, {viewpoint}, ' });
  const draft = app.elements['set-dashboard-template-draft'];
  const host = app.elements['set-dashboard-template-placeholders'];
  assert.deepEqual(host.children.map(button => button.textContent),['Lighting']);
  draft.selectionStart = draft.selectionEnd = draft.value.length;
  draft.setRangeText = (text,start,end) => { draft.value = draft.value.slice(0,start)+text+draft.value.slice(end); };
  host.children[0].onclick();
  assert.equal(draft.value,'subject, {viewpoint}, {lighting}');
  assert.equal(host.children.length,0);
  app.context.window.refreshSetDashboard();
  assert.equal(draft.value,'subject, {viewpoint}, {lighting}');
  app.elements['set-dashboard-template-reset'].onclick();
  assert.equal(draft.value,'subject, {viewpoint}, ');
  assert.deepEqual(host.children.map(button => button.textContent),['Lighting']);
});
test('QA is opened explicitly and reports retain direct handoffs', () => {
  const app = dashboard();
  app.elements['set-dashboard-review'].open = true;
  app.listeners['set-dashboard-review:toggle']();
  assert.deepEqual(app.actions, ['workspace', 'prepare', 'embedded-qa']);
  app.elements['set-dashboard-review-report'].onclick();
  assert.deepEqual(app.actions, ['workspace', 'prepare', 'embedded-qa', 'hide-prepare', 'workspace', 'qa']);
});
test('authoritative fields and Sight remain unique; Dashboard lives in Prep', () => {
  const html = fs.readFileSync(path.join(__dirname, '../tool/tool.html'), 'utf8');
  for (const id of ['set-dashboard-modal','stats-required-phrase','primer-template','set-scan-modal','set-intelligence-primary-btn']) {
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
    setVariableAssignedTerms: (item, group) => new Set(assigned[item.key].map(term=>term.toLowerCase())),
    normalizeChecklistTerm: term => String(term).trim(),
    setVariableKey: row => row.group
  };
  vm.runInNewContext(coverageSource + source.slice(start,end) + '\nthis.coverage = variableCoverage; this.warnings = variableWarnings;',sandbox);
  const items = Object.keys(assigned).map(key=>({key,fileName:key+'.jpg'}));
  const variable = {group:'Position',terms:['kneeling','squatting'],exclusive:true,expected:true};
  const count = r => Array.from(r.rows, row=>row.files.length);
  assert.deepEqual(count(sandbox.coverage(variable,items)), [1,1,1,1]);
  assert.deepEqual(count(sandbox.coverage({...variable,exclusive:false},items)), [2,2,1]);
  assert.deepEqual(Array.from(sandbox.warnings([variable],items),row=>row.kind), ['multiple']);
  const missing = items.filter(item=>item.key!=='a');
  assert.deepEqual(Array.from(sandbox.warnings([variable],missing),row=>row.kind), ['multiple']);
});
test('Curate stays visible outside the preparation content, and Grid has an explicit return action', () => {
  const html = fs.readFileSync(path.join(__dirname, '../tool/tool.html'), 'utf8');
  const balance = html.indexOf('id="set-dashboard-balance-section"');
  assert.ok(balance < html.indexOf('id="set-dashboard-curate"'));
  assert.ok(html.indexOf('id="set-dashboard-curate"') < html.indexOf('id="set-dashboard-variables"'));
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

test('generic Back reopens the Dashboard instead of selecting an empty surface', () => {
  const shell = fs.readFileSync(path.join(__dirname,'../tool/js/workspace_shell.js'),'utf8');
  const start = shell.indexOf('function exitWorkspaceSurface(');
  const end = shell.indexOf('function openTrainingSurface(', start);
  assert.ok(start >= 0 && end > start);
  const actions = [];
  let isSet = true;
  const context = {
    state:{folder:'Sets/Test',items:[{}]},
    workspaceState:{previousSurface:'dashboard'},
    normalizeWorkspaceSurface: value => value,
    isSetFolderContext: () => isSet,
    window:{openSetDashboard: () => actions.push('open-dashboard')},
    setWorkspaceSurface: surface => actions.push(surface)
  };
  vm.runInNewContext(shell.slice(start,end)+'\nthis.back = exitWorkspaceSurface;',context);
  context.back();
  assert.deepEqual(actions,['open-dashboard']);
  isSet = false;
  context.back();
  assert.deepEqual(actions,['open-dashboard','default']);
});

test('native Dashboard has readable grouped definition, bounded priority grid and themed disabled counts', () => {
  const html = fs.readFileSync(path.join(__dirname,'../tool/tool.html'),'utf8');
  const css = fs.readFileSync(path.join(__dirname,'../tool/css/set_dashboard.css'),'utf8');
  assert.match(html, /class="set-dashboard-definition-fields"/);
  assert.match(html, /class="set-dashboard-qa-open-label"/);
  assert.ok(css.includes('calc((100% - 48px) / 4)'));
  assert.ok(css.includes('#set-dashboard-modal .set-dashboard-variable-row:disabled'));
  assert.doesNotMatch(css, /\.set-dashboard-review p\s*\{/);
});

function canonicalVariables() {
  const folderSource=fs.readFileSync(path.join(__dirname,'../tool/js/folder_state.js'),'utf8');
  const start=folderSource.indexOf('function setVariableKey(');
  const end=folderSource.indexOf('function scheduleSetDefinitionSave()',start);
  const context={state:{setVariables:[]}};
  vm.runInNewContext(folderSource.slice(start,end),context);
  return context;
}
test('legacy standalone variables disappear; grouped intent survives and writes remain scoped', () => {
  const c=canonicalVariables();
  const pose={group:'Pose',terms:['kneeling','squatting'],exclusive:true};
  const shape={group:'Shape',terms:['triangle'],exclusive:false};
  const old={group:'',terms:['front view'],exclusive:false,expected:true};
  const clean=c.normalizeSetVariables([{...pose,expected:true},old,{...shape,expected:false}]);
  assert.deepEqual(JSON.parse(JSON.stringify(clean)),[pose,shape]);
  const changed=c.replaceSetGroupVariable(clean,'Pose',{terms:['standing'],exclusive:true});
  assert.deepEqual(JSON.parse(JSON.stringify(changed)),[{group:'Pose',terms:['standing'],exclusive:true},shape]);
  assert.deepEqual(JSON.parse(JSON.stringify(c.replaceSetGroupVariable(changed,'Pose',{terms:[]}))),[shape]);
  const folder=fs.readFileSync(path.join(__dirname,'../tool/js/folder_state.js'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'../tool/tool.html'),'utf8');
  assert.match(folder,/set_variables: normalizeSetVariables\(src.set_variables\)/);
  assert.doesNotMatch(folder,/migrateSetVariables|stats\.phrases/);
  assert.doesNotMatch(html,/id="(?:stats-phrases|set-dashboard-variable-editor|set-dashboard-variable-term)(?:-|")/);
});
test('coverage does not count matching unscoped tags, caption text or other groups', () => {
  const c=canonicalVariables();
  const start=source.indexOf('  function variableCoverage(');
  const end=source.indexOf('  function distributionColor(',start);
  const assigned={a:{View:['rear']},b:{Position:['rear']},c:{}};
  const context={
    setVariableKey:c.setVariableKey,
    setVariableAssignedTerms:(item,group)=>new Set(assigned[item.key][group]||[]),
    normalizeChecklistTerm:term=>term
  };
  vm.runInNewContext(coverageSource + source.slice(start,end)+'\nthis.coverage=variableCoverage;this.warnings=variableWarnings;',context);
  const v={group:'View',terms:['rear'],expected:true,exclusive:false};
  const items=[{key:'a',fileName:'a',caption:'rear'},{key:'b',fileName:'b',caption:'rear'},{key:'c',fileName:'c',tags:['rear']}];
  assert.deepEqual(Array.from(context.coverage(v,items).rows,row=>row.files.length),[1,2]);
  assert.equal(context.warnings([v],items).length,0);
  assert.equal(context.coverage(v,items).rows.at(-1).color,'neutral');
});
test('Set Intelligence follows Set Definition; explicit Prepare Set reopens it', () => {
  const app=dashboard({phrase:'subject'});
  app.elements['set-dashboard-definition'].open=false;
  app.listeners['set-dashboard-definition:toggle']();
  assert.equal(app.context.window.isSetIntelligenceOpen(),false);
  assert.deepEqual(app.actions,['workspace','prepare','hide-prepare']);
  app.elements['set-dashboard-definition'].open=true;
  app.listeners['set-dashboard-definition:toggle']();
  assert.equal(app.context.window.isSetIntelligenceOpen(),true);
  app.elements['set-dashboard-definition'].open=false;
  app.listeners['set-dashboard-definition:toggle']();
  app.context.window.openSetDashboard('analyze');
  assert.equal(app.elements['set-dashboard-definition'].open,true);
  assert.equal(app.context.window.isSetIntelligenceOpen(),true);
});

test('Set Dashboard reuses Manage Groups rows in a workspace-width two-column layout', () => {
  const html=fs.readFileSync(path.join(__dirname,'../tool/tool.html'),'utf8');
  const css=fs.readFileSync(path.join(__dirname,'../tool/css/set_dashboard.css'),'utf8');
  const manager=fs.readFileSync(path.join(__dirname,'../tool/js/checklist_panel.js'),'utf8');
  assert.match(html,/id="set-dashboard-group-list" class="checklist-group-list"/);
  assert.doesNotMatch(html,/id="set-dashboard-group-workbench"/);
  assert.match(source,/renderChecklistGroupRows\(el\('set-dashboard-group-list'\)/);
  assert.match(manager,/renderChecklistGroupRows\(itemsDiv, \{mediaKey:state.currentItem.key\}\)/);
  assert.match(html,/id="set-dashboard-groups-panel" class="set-dashboard-tags-panel set-dashboard-section"/);
  assert.match(html,/class="set-dashboard-stack set-dashboard-balance-stack"/);
  assert.match(css,/#set-dashboard-analyze > \.set-dashboard-balance-stack \{ grid-column:1\/-1; \}/);
  assert.match(css,/repeat\(auto-fit,minmax\(min\(100%,max\(420px,calc\(\(100% - 20px\) \/ 2\)\)\),1fr\)\)/);
  assert.doesNotMatch(css,/max-width:1180px; margin:0 auto/);
  assert.doesNotMatch(css,/#set-dashboard-group-list[^\n]*max-height/);
});

test('shared Manage Groups renderer expands vocabulary and targets the clicked row menu', () => {
  function node() {
    return {
      children:[], className:'', textContent:'', open:false,
      classList:{add(){},toggle(){},remove(){}},
      setAttribute(){}, addEventListener(){},
      appendChild(child){this.children.push(child);},
      set innerHTML(value){this.children=[];}
    };
  }
  const host=node(), edits=[], moves=[], hidden=[], expanded=new Set();
  const context={
    document:{createElement:node, querySelectorAll:()=>[]}, window:{addEventListener(){}},
    checklistItems:['Viewpoint','Position'],
    getChecklistKeywordTermsForRequirement: group=>group==='Viewpoint'?['front','rear']:['standing'],
    isChecklistRequirementHidden:()=>false, setChecklistRequirementHidden:(group,value)=>{hidden.push([group,value]);return true;},
    openChecklistGroupTermsModal:group=>edits.push(group),
    moveChecklistItemByOffset:(index,offset)=>{moves.push([index,offset]);return true;},
    setStatus(){}, renderChecklistPanel(){}, deleteChecklistGroupByIndex(){},
  };
  const manager=fs.readFileSync(path.join(__dirname,'../tool/js/checklist_panel.js'),'utf8');
  vm.runInNewContext(manager,context);
  context.renderChecklistPanel=()=>{};
  context.renderChecklistGroupRows(host,{definition:true,expanded,
    renderDefinitionSummary(){},
    renderDefinitionEditor(group,host){host.textContent=context.getChecklistKeywordTermsForRequirement(group).join(' · ');}
  });
  const toggle=host.children[0].children[0].children[0].children[0];
  toggle.onclick();
  assert.equal(host.children[0].children[1].textContent,'front · rear');
  assert.equal(host.children[1].children.length,1);
  const first=host.children[0].children[0].children[1].children[1];
  const second=host.children[1].children[0].children[1].children[1];
  first.open=true;second.open=true;
  first.children[1].children[0].onclick();
  assert.deepEqual(edits,['Viewpoint']);
  assert.equal(first.open,false);assert.equal(second.open,true);
  second.children[1].children[1].onclick();
  assert.deepEqual(moves,[[1,-1]]);
  host.children[1].children[0].children[1].children[0].onclick();
  assert.deepEqual(hidden,[['Position',true]]);
});

test('group checkboxes save each scoped selection immediately and preserve other groups', () => {
  const c=canonicalVariables();
  function node(tag) {
    return {tag,children:[],textContent:'',checked:false,disabled:false,classList:{toggle(){}},
      append(...children){this.children.push(...children);},appendChild(child){this.children.push(child);}};
  }
  const initial={group:'View',terms:['front'],exclusive:true};
  const other={group:'Shape',terms:['triangle'],exclusive:false};
  const state={setVariables:[initial,other]};
  let saves=0,refreshes=0;
  const context={state,document:{createElement:node,createTextNode:text=>text},
    normalizeChecklistTerm:term=>term.trim(),
    normalizeSetVariables:c.normalizeSetVariables,replaceSetGroupVariable:c.replaceSetGroupVariable,
    getChecklistKeywordTermsForRequirement:()=>['front','rear'],
    scheduleSetDefinitionSave:()=>saves++,updateBalanceDistributionWheel(){},
    renderStage:()=>refreshes++,openChecklistGroupTermsModal(){}};
  const start=source.indexOf('  function variableForGroup('),end=source.indexOf('  function renderVocabulary(',start);
  vm.runInNewContext(source.slice(start,end),context);
  function editor() {
    const host=node('div');
    context.renderGroupVariableEditor('View',host);
    const [title,terms,options]=host.children;
    assert.equal(host.children.length,3);
    assert.equal(options.children.length,2);
    assert.equal(options.children[1].textContent,'Reset');
    return {front:terms.children[0].children[0],rear:terms.children[1].children[0],
      exclusive:options.children[0].children[0],reset:options.children[1]};
  }
  function change(input,value) { input.checked=value; input.onchange(); }
  change(editor().rear,true);
  assert.deepEqual(JSON.parse(JSON.stringify(state.setVariables)),[{group:'View',terms:['front','rear'],exclusive:true},other]);
  assert.equal(saves,1);
  change(editor().exclusive,false);
  assert.deepEqual(JSON.parse(JSON.stringify(state.setVariables)),[{group:'View',terms:['front','rear'],exclusive:false},other]);
  editor().reset.onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(state.setVariables)),[other]);
  assert.equal(editor().exclusive.disabled,true);
  assert.equal(editor().reset.disabled,true);
  assert.equal(saves,3);assert.equal(refreshes,3);
});

test('preview wheel retains aggregate coverage and expands into honest group distributions', () => {
  const wheelSource = fs.readFileSync(path.join(__dirname, '../tool/js/balance_distribution_wheel.js'), 'utf8');
  const items = ['a','b','c','d'].map(key => ({key,fileName:key+'.jpg'}));
  const tags = {
    a:{View:['front'],Style:['striped','blue']},
    b:{View:['rear'],Style:['blue']},
    c:{View:['front','rear'],Style:['striped']},
    d:{View:[],Style:[]},
    excluded:{View:['front'],Style:['blue']}
  };
  const variables = [
    {group:'View',terms:['front','rear'],exclusive:true},
    {group:'Style',terms:['striped','blue'],exclusive:false}
  ];
  const context = {
    state:{setVariables:variables,currentItem:items[2]},
    normalizeSetVariables:rows=>rows,
    normalizeChecklistTerm:term=>term.trim(),
    getFilteredMediaItems:ignore=>{assert.equal(ignore,false);return items;},
    setVariableAssignedTerms:(item,group)=>new Set(tags[item.key][group]),
    escapeHtml:value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  };
  vm.runInNewContext(coverageSource + wheelSource, context);
  const stats = context.getBalanceWheelStats();
  assert.equal(stats.total,4);
  assert.deepEqual(Array.from(stats.rows,row=>row.count),[2,2,2,2]);
  const [view,style] = stats.groups;
  assert.equal(view.partition,true);
  assert.deepEqual(Array.from(view.rows,row=>row.count),[1,1,1,1]);
  assert.deepEqual(Array.from(view.rows,row=>row.currentMatch),[false,false,true,false]);
  assert.equal(style.partition,false);
  assert.deepEqual(Array.from(style.rows,row=>row.count),[2,2,1]);
  assert.deepEqual(Array.from(style.rows,row=>row.currentMatch),[true,false,false]);
  assert.equal(style.rows[0].color,stats.rows[2].color);
  assert.match(context.renderBalanceWheelGroups(stats),/Share of media/);
  assert.match(context.renderBalanceWheelGroups(stats),/Independent coverage/);
  assert.match(context.renderBalanceWheelGroups(stats),/2\/4 \(50%\)/);
  assert.equal((context.renderBalanceWheelGroups(stats).match(/class="balance-wheel-group"/g)||[]).length,2);
  const full = {partition:true,total:4,rows:[{count:4,index:0,color:'#123456',currentMatch:true}]};
  assert.match(context.renderBalanceWheelSvg(full),/<circle[^>]+class="balance-wheel-slice is-current"/);
  assert.doesNotMatch(context.renderBalanceWheelSvg(full),/<path/);
  const css = fs.readFileSync(path.join(__dirname,'../tool/css/styles.css'),'utf8');
  assert.match(css,/\.balance-distribution-wheel:hover \.balance-wheel-groups/);
  assert.match(css,/\.balance-distribution-wheel:focus-visible \.balance-wheel-groups/);
  assert.doesNotMatch(wheelSource,/onclick|addEventListener\(['"]click/);
});


test('Dashboard separates classified distribution from overall scope, including overlap and zero matches', () => {
  function node(tag) {
    const classes = new Set();
    const n = {tag, children:[], dataset:{}, style:{}, textContent:'',
      classList:{toggle(k,v){if(v)classes.add(k);else classes.delete(k);},contains(k){return classes.has(k);}},
      setAttribute(){},
      appendChild(child){ if(child.parent)child.remove(); this.children.push(child); child.parent=this; },
      append(...children){children.forEach(c=>this.appendChild(c));},
      insertBefore(child,before){if(child===before)return; if(child.parent)child.remove(); const i=this.children.indexOf(before); this.children.splice(i<0?this.children.length:i,0,child); child.parent=this;},
      remove(){if(this.parent){this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}},
      querySelector(selector){return this.children.find(c=>selector[0]==='.'?c.className===selector.slice(1):c.tag===selector) || this.children.map(c=>c.querySelector(selector)).find(Boolean);},
      get firstElementChild(){return this.children[0];}
    };
    return n;
  }
  const host=node('div'), empty=node('div'), inspected=[];
  const assignments={a:['chain-link'],b:['rings'],c:['chain-link','rings'],d:[],e:[]};
  const items=Object.keys(assignments).map(key=>({key,fileName:key+'.jpg'}));
  const variable={group:'Shape',terms:['chain-link','rings'],exclusive:true};
  const context={
    document:{createElement:node}, state:{setVariables:[variable]},
    el:id=>id==='set-dashboard-variables'?host:empty,
    setHidden:(n,v)=>n.classList.toggle('hidden',v),
    setVariableAssignedTerms:item=>new Set(assignments[item.key]),
    normalizeChecklistTerm:t=>t, setVariableKey:v=>v.group,
    inspectDistribution:(files,label)=>inspected.push({files:Array.from(files),label})
  };
  const start=source.indexOf('  function variableCoverage(');
  const end=source.indexOf('  // One group, one scoped edit.',start);
  vm.runInNewContext(coverageSource+source.slice(start,end)+'\nthis.render=renderVariables;',context);
  const render=scope=>context.render({visibleItems:scope,visibleTotal:scope.length});
  const get=cls=>host.children[0].querySelector('.'+cls);
  render(items);
  const legend=get('set-dashboard-variable-rows'), first=legend.children[0];
  const stack=get('set-dashboard-variable-stack'), missing=get('set-dashboard-coverage-unmatched');
  assert.deepEqual(legend.children.map(n=>n.dataset.key),['term:0','term:1','multiple']);
  assert.equal(first.children[1].textContent,'1 / 3 · 33%');
  assert.equal(stack.children.length,3);
  assert.ok(Math.abs(stack.children.reduce((sum,n)=>sum+parseFloat(n.style.width),0)-100)<1e-6);
  assert.equal(get('set-dashboard-coverage-classified').textContent,'3 / 5 classified');
  assert.equal(get('set-dashboard-coverage-fill').style.width,'60%');
  assert.equal(missing.textContent,'2 without matching terms');
  missing.onclick(); assert.deepEqual(inspected[0],{files:['d.jpg','e.jpg'],label:'Shape · Without matching terms'});
  first.onclick(); assert.deepEqual(inspected[1].files,['a.jpg']);
  assert.equal(get('set-dashboard-variable-notice').textContent,'1 with multiple terms');
  render([items[0],items[3]]);
  assert.equal(legend.children[0],first);
  assert.equal(get('set-dashboard-coverage-unmatched'),missing);
  assert.equal(first.children[1].textContent,'1 / 1 · 100%');
  assert.equal(get('set-dashboard-coverage-classified').textContent,'1 / 2 classified');
  render([items[3]]);
  assert.equal(first.children[1].textContent,'0');
  assert.ok(stack.classList.contains('hidden'));
  assert.equal(get('set-dashboard-coverage-fill').style.width,'0%');
  assert.equal(missing.disabled,false);
  render([]);
  assert.equal(missing.disabled,true);
  assert.equal(get('set-dashboard-coverage-classified').textContent,'0 / 0 classified');
  variable.exclusive=false;
  render(items);
  assert.equal(first.children[1].textContent,'2 / 3 · 67%');
  assert.equal(legend.children.length,2);
  assert.equal(get('set-dashboard-coverage-classified').textContent,'3 / 5 classified');
  assert.equal(first.children[2].firstElementChild.style.width, (100*2/3)+'%');
  assert.ok(stack.classList.contains('hidden'));
  assert.ok(get('set-dashboard-variable-notice').classList.contains('hidden'));
});
