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
      id, textContent: '', value: '', isConnected: true, open: false, style: {},
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
  const names = ['analyze', 'caption', 'review'];
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
  let sightOpen = false;
  const context = {
    document, state,
    window: {
      addEventListener() {},
      isSetIntelligenceOpen: () => sightOpen,
      openSetIntelligence: () => { sightOpen = true; actions.push('prepare'); },
      closeSetIntelligence: () => { sightOpen = false; actions.push('hide-prepare'); }
    },
    checklistItems: options.groups || [],
    getChecklistKeywordTermsForRequirement: () => ['tag'],
    isChecklistRequirementCheckedForMediaKey: () => !!options.checked,
    getTrainingRunnerActiveJob: () => options.training ? { status: 'running' } : null,
    shellWorkloadState: { trainingActive: !!options.training },
    getShellWorkloadStatus: () => ({
      key: options.training || options.shellLane ? 'active' : 'idle',
      lane: options.training ? 'training' : (options.shellLane || 'idle')
    }),
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

test('fresh Set opens Caption with editable guidance and no background jobs', () => {
  const app = dashboard();
  assert.equal(app.selected(), 'caption');
  assert.equal(app.title(), 'Caption 1 remaining media item');
  assert.equal(app.primary().textContent, 'Continue captioning');
  assert.deepEqual(app.actions, []);
  assert.equal(app.elements['set-dashboard-secondary'].disabled, undefined);
});

test('missing balance terms are optional and do not gate Review', () => {
  const app = dashboard({ phrase: 'subject' });
  assert.equal(app.selected(), 'caption');
  assert.equal(app.title(), 'Caption 1 remaining media item');
  app.listeners['tab-review:click']();
  assert.equal(app.selected(), 'review');
  assert.deepEqual(app.actions, []);
});

test('unprepared Set opens Analyze with embedded Sight, without inference', () => {
  const app = dashboard({ phrase: 'subject', balances: 'front' });
  assert.equal(app.selected(), 'analyze');
  assert.deepEqual(app.actions, ['prepare']);
  assert.equal(app.elements['set-dashboard-tags-primary'].textContent, 'Manage Groups');
});

test('Training blocks scan recommendation, favors manual group work', () => {
  const app = dashboard({ phrase: 'subject', balances: 'front', training: true });
  assert.equal(app.selected(), 'analyze');
  assert.equal(app.elements['set-dashboard-tags-primary'].textContent, 'Manage Groups');
  app.elements['set-dashboard-tags-primary'].onclick();
  assert.deepEqual(app.actions, ['prepare', 'hide-prepare', 'groups']);
});

test('pending annotation before incomplete captions', () => {
  const app = dashboard({
    phrase: 'subject', balances: 'front', groups: ['Shape'],
    items: [{ key: 'a', fileName: 'a.png', caption: '', hasCaption: false, metadata: { vision_sight: { description: 'observed', inventory: {} } } }]
  });
  assert.equal(app.selected(), 'analyze');
  assert.equal(app.elements['set-dashboard-tags-primary'].textContent, 'Focused Annotation');
});

test('mature Set opens Review with QA and caption inspection actions', () => {
  const app = dashboard({
    phrase: 'subject', balances: 'front', groups: ['Shape'], checked: true,
    items: [{ key: 'a', fileName: 'a.png', caption: 'subject, front', hasCaption: true, metadata: { vision_sight: { description: 'observed', inventory: {} } } }]
  });
  assert.equal(app.selected(), 'review');
  assert.equal(typeof app.elements['set-dashboard-review-qa'].onclick, 'function');
  assert.equal(app.elements['set-dashboard-review-report'].disabled, false);
});

test('manual stage selection stays fixed until reopen', () => {
  const app = dashboard();
  app.listeners['tab-caption:click']();
  assert.equal(app.selected(), 'caption');
  app.context.window.closeSetDashboard();
  app.context.window.openSetDashboard();
  assert.equal(app.selected(), 'caption');
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

test('shared GPU activity leaves manual actions available', () => {
  const app = dashboard({ phrase: 'subject', balances: 'front', shellLane: 'inference' });
  assert.equal(app.selected(), 'analyze');
  assert.equal(app.elements['set-dashboard-tags-primary'].textContent, 'Manage Groups');
  assert.equal(app.elements['set-dashboard-tags-vocabulary'].classList.contains('hidden'), true);
});

test('outstanding annotation reviews take precedence even if captions exist', () => {
  const app = dashboard({
    phrase: 'subject', balances: 'front', groups: ['Shape'],
    items: [{
      key: 'a', fileName: 'a.png', caption: 'a full caption', hasCaption: true,
      metadata: { vision_sight: { description: 'observed', inventory: {} } }
    }]
  });
  assert.equal(app.selected(), 'analyze');
  assert.equal(app.elements['set-dashboard-tags-primary'].textContent, 'Focused Annotation');
});

test('tab changes hide embedded Sight without triggering a new scan', () => {
  const app = dashboard({ phrase: 'subject', balances: 'front' });
  assert.deepEqual(app.actions, ['prepare']);
  app.listeners['tab-review:click']();
  assert.equal(app.selected(), 'review');
  assert.deepEqual(app.actions, ['prepare', 'hide-prepare']);
  app.listeners['tab-analyze:click']();
  assert.deepEqual(app.actions, ['prepare', 'hide-prepare', 'prepare']);
});

test('closing and reopening retains earliest stage and closes embedded preparation', () => {
  const app = dashboard({ phrase: 'subject', balances: 'front' });
  app.context.window.closeSetDashboard();
  assert.deepEqual(app.actions, ['prepare', 'hide-prepare']);
  app.context.window.openSetDashboard();
  assert.equal(app.selected(), 'analyze');
  assert.deepEqual(app.actions, ['prepare', 'hide-prepare', 'prepare']);
});

test('Prepare Set is hosted once inside Dashboard, not in another fullscreen overlay', () => {
  const html = fs.readFileSync(path.join(__dirname, '../tool/tool.html'), 'utf8');
  const begin = html.indexOf('id="set-dashboard-modal"');
  const end = html.indexOf('id="saved-intelligence-modal"');
  const hosted = html.indexOf('id="set-scan-modal"');
  assert.ok(begin >= 0 && begin < hosted && hosted < end);
  assert.equal((html.match(/id="set-scan-modal"/g) || []).length, 1);
  assert.match(html, /id="set-scan-modal" class="set-scan-modal hidden" role="region"/);
});

test('three navigation tabs and progress strip use separate scope labels', () => {
  const app = dashboard({ phrase: 'subject', balances: 'front' });
  assert.equal(app.tabs.length, 3);
  assert.equal(app.elements['set-dashboard-sight-count'].textContent, '0 / 1');
  assert.equal(app.elements['set-dashboard-captions-count'].textContent, '0 / 1');
  assert.equal(app.elements['set-dashboard-tags-count'].textContent, '—');
  const html = fs.readFileSync(path.join(__dirname, '../tool/tool.html'), 'utf8');
  assert.match(html, /Group assignments reviewed/);
  assert.match(html, /Current filtered view/);
  assert.match(html, /id="set-dashboard-template-open"/);
  assert.equal((html.match(/id="stats-required-phrase"/g) || []).length, 1);
});

test('caption guidance stays directly accessible regardless of completeness', () => {
  const app = dashboard({ phrase: 'subject', balances: 'front' });
  app.listeners['tab-caption:click']();
  assert.equal(app.selected(), 'caption');
  assert.equal(app.elements['set-dashboard-caption'].classList.contains('hidden'), false);
  assert.equal(app.elements['set-dashboard-analyze'].classList.contains('hidden'), true);
  assert.equal(app.primary().textContent, 'Continue captioning');
});

test('review exposes inspection and QA without triggering inference', () => {
  const app = dashboard();
  app.listeners['tab-review:click']();
  assert.equal(app.actions.length, 0);
  assert.equal(app.elements['set-dashboard-review-report'].disabled, true);
  app.elements['set-dashboard-review-qa'].onclick();
  assert.deepEqual(app.actions, ['workspace', 'qa']);
});

test('fixed dashboard shell and tab content scroll independently', () => {
  const css = fs.readFileSync(path.join(__dirname, '../tool/css/set_dashboard.css'), 'utf8');
  assert.match(css, /\.set-dashboard-modal\s*\{\s*align-items: flex-start;/);
  assert.match(css, /#set-dashboard-stage\s*\{[^}]*overflow-y: auto;/);
  assert.match(css, /\.set-dashboard-dialog\s*\{[^}]*display: flex;/);
});
