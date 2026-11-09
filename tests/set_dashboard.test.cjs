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
    const classes = new Set(id.startsWith('set-dashboard-') ? ['hidden'] : []);
    return elements[id] = {
      id, textContent: '', value: '', isConnected: true, open: false,
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
  const names = ['guidance', 'understand', 'annotate', 'caption', 'review'];
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
  element('stats-phrases').value = options.balances || '';
  const folder = 'Sets/Test';
  const state = { folder, items: options.items || [{ key: 'a', fileName: 'a.png', hasCaption: false, caption: '', metadata: {} }] };
  const actions = [];
  const context = {
    document, state,
    window: { addEventListener() {} },
    checklistItems: options.groups || [],
    getChecklistKeywordTermsForRequirement: () => ['tag'],
    isChecklistRequirementCheckedForMediaKey: () => !!options.checked,
    getTrainingRunnerActiveJob: () => options.training ? { status: 'running' } : null,
    shellWorkloadState: { trainingActive: !!options.training },
    getShellWorkloadStatus: () => ({ key: options.training ? 'active' : 'idle', lane: options.training ? 'training' : 'idle' }),
    getInferenceQueueSnapshot: () => ({ jobs: [] }),
    isSetFolderPath: () => true,
    getFilteredMediaItems: () => state.items,
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

test('fresh Set prioritizes required phrase without background jobs', () => {
  const app = dashboard();
  assert.equal(app.selected(), 'guidance');
  assert.equal(app.title(), 'Required key phrase');
  assert.equal(app.primary().textContent, 'Set key phrase');
  assert.deepEqual(app.actions, []);
  assert.equal(app.secondary().classList.contains('hidden'), true);
});

test('missing balance terms is its own action and remains optional', () => {
  const app = dashboard({ phrase: 'subject' });
  assert.equal(app.selected(), 'guidance');
  assert.equal(app.title(), 'Balance terms');
  app.listeners['tab-review:click']();
  assert.equal(app.selected(), 'review');
  assert.deepEqual(app.actions, []);
});

test('unprepared Set opens Understand; click delegates to existing Prepare Set', () => {
  const app = dashboard({ phrase: 'subject', balances: 'front' });
  assert.equal(app.selected(), 'understand');
  assert.deepEqual(app.actions, []);
  app.primary().onclick();
  assert.deepEqual(app.actions, ['prepare']);
});

test('Training blocks scan recommendation, favors manual group work', () => {
  const app = dashboard({ phrase: 'subject', balances: 'front', training: true });
  assert.equal(app.selected(), 'annotate');
  assert.equal(app.primary().textContent, 'Manage Groups');
  app.primary().onclick();
  assert.deepEqual(app.actions, ['groups']);
});

test('pending annotation before incomplete captions', () => {
  const app = dashboard({
    phrase: 'subject', balances: 'front', groups: ['Shape'],
    items: [{ key: 'a', fileName: 'a.png', caption: '', hasCaption: false, metadata: { vision_sight: { description: 'observed', inventory: {} } } }]
  });
  assert.equal(app.selected(), 'annotate');
  assert.equal(app.primary().textContent, 'Focused Annotation');
});

test('mature Set opens Review with only one secondary action', () => {
  const app = dashboard({
    phrase: 'subject', balances: 'front', groups: ['Shape'], checked: true,
    items: [{ key: 'a', fileName: 'a.png', caption: 'subject, front', hasCaption: true, metadata: { vision_sight: { description: 'observed', inventory: {} } } }]
  });
  assert.equal(app.selected(), 'review');
  assert.equal(app.primary().textContent, 'Open Quality Assurance');
  assert.equal(app.secondary().textContent, 'Caption Report');
});

test('manual stage selection stays fixed until reopen', () => {
  const app = dashboard();
  app.listeners['tab-caption:click']();
  assert.equal(app.selected(), 'caption');
  app.context.window.closeSetDashboard();
  app.context.window.openSetDashboard();
  assert.equal(app.selected(), 'guidance');
  assert.deepEqual(app.actions, []);
});

test('markup retains single authoritative guidance controls and original template editor', () => {
  const html = fs.readFileSync(path.join(__dirname, '../tool/tool.html'), 'utf8');
  for (const id of ['set-dashboard-modal', 'stats-required-phrase', 'stats-phrases', 'stats-phrases-items', 'primer-template']) {
    const count = (html.match(new RegExp('id="' + id + '"', 'g')) || []).length;
    assert.equal(count, 1, id + ' must have one owner');
  }
  assert.ok(html.indexOf('id="stats-required-phrase"') > html.indexOf('id="set-dashboard-modal"'));
  assert.ok(html.indexOf('id="primer-template-section"') < html.indexOf('id="set-dashboard-modal"'));
  assert.match(html, /static\/js\/set_dashboard\.js/);
  assert.match(html, /static\/css\/set_dashboard\.css/);
});
