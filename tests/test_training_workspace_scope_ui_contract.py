from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def test_training_scope_entry_contract_with_mocked_frontend_dependencies():
    node_test = r'''
const fs = require('fs');
const vm = require('vm');
const root = process.argv[1];
const shell = fs.readFileSync(root + '/tool/js/workspace_shell.js', 'utf8');
const workspace = fs.readFileSync(root + '/tool/js/training_workspace.js', 'utf8');
const runner = fs.readFileSync(root + '/tool/js/training_runner_ui.js', 'utf8');
const html = fs.readFileSync(root + '/tool/tool.html', 'utf8');
if (!html.includes('training-launch-status') || !html.includes('training-launch-status-global-btn')) throw new Error('missing set launch status');
function section(source, start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}
function element() {
  const values = new Set();
  return { classList: { add: name => values.add(name), toggle: (name, on) => on ? values.add(name) : values.delete(name), contains: name => values.has(name) },
    attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, textContent: '', title: '' };
}
const nodes = {};
['sidebar-open-training-btn', 'utility-training-btn', 'training-detail-tabs',
 'training-sidebar-collapse-toggle-btn'].forEach(id => nodes[id] = element());
const itemTab = element(), configTab = element(), runLogTab = element();
const context = {
  workspaceState: { surface: 'training', sidebarHidden: true },
  trainingWorkspaceState: { entryMode: 'global', detailTab: 'items', workspaceRequestVersion: 0, runSetupFolder: 'draft', configFiles: ['draft.toml'] },
  state: { folder: 'set-a', currentConfigFile: { folder: 'set-a', file: 'draft.toml' } },
  ui: { appEl: element() },
  isSetFolderPath: folder => !!folder && folder !== 'root',
  normalizeWorkspaceSurface: value => value,
  document: { getElementById: id => nodes[id] || null,
    querySelector: selector => selector.indexOf('items') !== -1 ? itemTab : selector.indexOf('config') !== -1 ? configTab : runLogTab },
  console, Promise
};
vm.createContext(context);
vm.runInContext(section(shell, 'function getTrainingWorkspaceEntryKind()', 'function syncWorkspaceConfigEditorUi()'), context);
context.syncTrainingEntryChrome();
if (runLogTab.classList.contains('hidden') || !itemTab.classList.contains('hidden') || !context.ui.appEl.classList.contains('sidebar-hidden') || nodes['training-sidebar-collapse-toggle-btn'].classList.contains('hidden')) throw new Error('global chrome');
context.trainingWorkspaceState.entryMode = 'set';
context.workspaceState.sidebarHidden = false;
context.syncTrainingEntryChrome();
if (itemTab.classList.contains('hidden') || configTab.classList.contains('hidden') || !runLogTab.classList.contains('hidden') || context.ui.appEl.classList.contains('sidebar-hidden')) throw new Error('set chrome');

let globalHistory = 0, profileCalls = 0, modelSync = 0, pendingProfileResolve;
const refreshContext = Object.assign({}, context, {
  getTrainingWorkspaceEls: () => ({ navigatorTitle: element(), folder: element(), globalContext: element(), setWorkflow: element(), runSetup: element(), readiness: element() }),
  isTrainingWorkspaceActive: () => true,
  refreshTrainingHistory: () => { globalHistory++; return Promise.resolve(); },
  fetchTrainingProfiles: () => { profileCalls++; return new Promise(resolve => { pendingProfileResolve = resolve; }); },
  syncTrainingModelProfileSelect: () => { modelSync++; }, syncTrainingWorkspaceProfile: () => {},
  getVisibleMediaSelectionForTraining: () => [], ensureSelectedTrainingSetup: () => Promise.resolve(),
  fetchTrainingWorkspaceConfigFiles: () => Promise.resolve([]), refreshTrainingReview: () => Promise.resolve(),
  resetTrainingRunSetupForFolder: () => {}, syncTrainingWorkflowReadiness: () => {}, buildTrainingReadinessHtml: () => '',
  renderTrainingItemOverview: () => {}, renderTrainingWorkspaceConfigList: () => {}, renderTrainingCommandHandoff: () => {}, syncWorkspaceConfigEditorUi: () => {}
});
vm.createContext(refreshContext);
vm.runInContext(section(workspace, 'function isTrainingSetRefreshCurrent(', 'function runTrainingWorkspaceAction('), refreshContext);
refreshContext.trainingWorkspaceState.entryMode = 'global';
refreshContext.refreshTrainingWorkspace();
if (profileCalls || globalHistory !== 1 || refreshContext.trainingWorkspaceState.runSetupFolder !== 'draft' || refreshContext.trainingWorkspaceState.configFiles[0] !== 'draft.toml') throw new Error('global refresh leaked set work');
refreshContext.trainingWorkspaceState.entryMode = 'set';
refreshContext.refreshTrainingWorkspace();
if (profileCalls !== 1) throw new Error('valid set did not initialize');
refreshContext.trainingWorkspaceState.entryMode = 'global';
refreshContext.refreshTrainingWorkspace();
pendingProfileResolve();
Promise.resolve().then(() => Promise.resolve()).then(() => {
  if (modelSync) throw new Error('global refresh did not invalidate set continuation');
  let transitions = [], statuses = [], rejectSave = false;
  const entryContext = Object.assign({}, context, {
    trainingWorkspaceState: { entryMode: 'set' },
    isTrainingWorkspaceActive: () => true, getTrainingDetailTab: () => 'config',
    cancelEditorAutosaveForConfig: () => transitions.push('cancel'),
    saveCurrentEditorContent: () => rejectSave ? Promise.reject(new Error('save failed')) : Promise.resolve(),
    setTrainingWorkspaceEntryMode: mode => transitions.push('mode:' + mode),
    setWorkspaceSurface: (surface, opts) => transitions.push('surface:' + surface + ':' + opts.sidebarHidden),
    setTrainingDetailTab: tab => transitions.push('tab:' + tab), syncTrainingEntryChrome: () => transitions.push('chrome'),
    setStatus: text => statuses.push(text)
  });
  vm.createContext(entryContext);
  vm.runInContext(section(shell, 'function openTrainingSurface(', 'function ensureWorkspaceOverlayHost('), entryContext);
  entryContext.openTrainingSurface('global');
  return Promise.resolve().then(() => {
    if (transitions.join('|') !== 'cancel|mode:global|surface:training:true|tab:run-log|chrome') throw new Error('save success transition');
    transitions = []; rejectSave = true;
    entryContext.openTrainingSurface('global');
    return Promise.resolve().then(() => Promise.resolve()).then(() => {
      if (transitions.join('|') !== 'cancel' || !statuses[0].includes('Could not save config')) throw new Error('save failure transition');
      const runnerContext = { trainingWorkspaceState: { entryMode: 'global', runnerConsoleRequestVersion: 0 },
        getTrainingWorkspaceEls: () => ({ runnerConsole: element() }), isTrainingWorkspaceActive: () => true,
        setTrainingDetailTab: tab => { if (tab !== 'run-log') throw new Error('global close switched to items'); }, syncTrainingConsoleUi: () => {} };
      vm.createContext(runnerContext);
      vm.runInContext(section(runner, 'function hideTrainingRunnerConsole()', 'function toggleTrainingRunnerConsole()'), runnerContext);
      runnerContext.hideTrainingRunnerConsole();
    });
  });
}).catch(err => { console.error(err); process.exit(1); });
'''
    result = subprocess.run(
        ["node", "-e", node_test, str(ROOT)],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr or result.stdout


def test_training_scope_source_contracts_remain_explicit():
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    workspace = (ROOT / "tool" / "js" / "training_workspace.js").read_text(encoding="utf-8")
    history = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")
    runner = (ROOT / "tool" / "js" / "training_runner_ui.js").read_text(encoding="utf-8")

    assert 'sidebar-open-training-btn' in shell
    assert 'utility-training-btn' in shell
    assert "function openTrainingSurface(mode)" in shell
    assert "workspaceRequestVersion" in workspace
    assert "isTrainingSetRefreshCurrent" in workspace
    assert "training-global-context--after-set" not in workspace
    assert "trainingWorkspaceState.entryMode === 'set' ? String(state.folder || '').trim() : ''" in history
    assert "trainingWorkspaceState.historyViewScope === 'set'" in history
    assert "data-training-history-scope" in history
    assert "els.globalContext.classList.toggle('hidden', false)" in workspace
    assert "entryKind === 'unavailable'" in shell
    assert "workspaceState.sidebarHidden = !workspaceState.sidebarHidden;" in workspace
    assert "trainingWorkspaceState.launchedJobId = payload.job.id;" in runner
    assert "function renderTrainingLaunchStatus()" in runner
    source_navigation = workspace[workspace.index('function openTrainingWorkspaceFolder('):workspace.index('function switchTrainingSetup(')]
    assert "workspaceState.sidebarHidden = false;" in source_navigation
    assert source_navigation.index("renderTrainingItemOverview(null, 'Loading training set...')") < source_navigation.index('refreshCurrentDirectory();')


def test_training_set_keeps_global_activity_and_explicit_recent_run_scope():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    state = (ROOT / "tool" / "js" / "training_workspace_state.js").read_text(encoding="utf-8")
    workspace = (ROOT / "tool" / "js" / "training_workspace.js").read_text(encoding="utf-8")
    history = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")

    assert 'id="training-global-context"' in html
    assert 'data-training-history-scope="set"' in html
    assert 'data-training-history-scope="all"' in html
    assert "historyViewScope: 'all'" in state
    assert "nextMode === 'set' ? 'set' : 'all'" in state
    assert "els.globalContext.classList.toggle('hidden', false)" in workspace
    assert "trainingWorkspaceState.historyViewScope = scope === 'set' ? 'set' : 'all';" in workspace
    assert "scope === 'set' && String(job.folder || '') !== currentFolder" in history
    assert "searchEl.value = folder" not in history
