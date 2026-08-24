var workspaceUiState = {
  viewMode: 'single',
  workflowMode: 'annotate'
};
var workspaceState = {
  surface: 'default',
  previousSurface: 'default',
  sidebarHidden: false
};
var WORKBENCH_RAIL_SESSION_KEY = 'webcap.workbenchRailCollapsedByView';
var workbenchRailCollapsedByView = loadWorkbenchRailSessionState();

function loadWorkbenchRailSessionState() {
  try {
    var saved = sessionStorage.getItem(WORKBENCH_RAIL_SESSION_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch (err) {
    console.warn('[Workspace] Could not restore workbench rail state:', err);
    return {};
  }
}

function getWorkbenchRailViewMode() {
  return normalizeWorkspaceViewMode(workspaceUiState.viewMode);
}

function isWorkbenchRailAvailable() {
  var surface = normalizeWorkspaceSurface(workspaceState.surface);
  return surface === 'default' || surface === 'focus';
}

function isWorkbenchRailCollapsed() {
  var viewMode = getWorkbenchRailViewMode();
  if (Object.prototype.hasOwnProperty.call(workbenchRailCollapsedByView, viewMode)) {
    return !!workbenchRailCollapsedByView[viewMode];
  }
  return viewMode === 'grid';
}

function setWorkbenchRailCollapsed(collapsed) {
  var viewMode = getWorkbenchRailViewMode();
  workbenchRailCollapsedByView[viewMode] = !!collapsed;
  try {
    sessionStorage.setItem(WORKBENCH_RAIL_SESSION_KEY, JSON.stringify(workbenchRailCollapsedByView));
  } catch (err) {
    console.warn('[Workspace] Could not persist workbench rail state:', err);
  }
  syncWorkbenchRailUi();
}

function syncWorkbenchRailUi() {
  if (!ui || !ui.appEl) return;
  var toggleBtn = document.getElementById('workbench-rail-toggle-btn');
  var available = isWorkbenchRailAvailable();
  var collapsed = available && isWorkbenchRailCollapsed();
  ui.appEl.classList.toggle('workbench-rail-collapsed', collapsed);
  if (!toggleBtn) return;
  toggleBtn.classList.toggle('hidden', !available);
  toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  toggleBtn.setAttribute('aria-label', collapsed ? 'Expand workbench rail' : 'Collapse workbench rail');
  toggleBtn.title = collapsed ? 'Expand workbench rail' : 'Collapse workbench rail';
  toggleBtn.innerHTML = collapsed ? '&#9664;' : '&#9654;';
}
function updateWorkspaceSplitLayout() {
}

function normalizeWorkspaceViewMode(mode) {
  var value = String(mode || '').trim().toLowerCase();
  if (value === 'grid' || value === 'focus') return value;
  return 'single';
}

function normalizeWorkspaceWorkflowMode(mode) {
  var value = String(mode || '').trim().toLowerCase();
  if (value === 'select' || value === 'review') return value;
  return 'annotate';
}

function syncWorkspaceHeaderUi() {
  if (!ui || !ui.appEl) return;
  var viewMode = normalizeWorkspaceViewMode(workspaceUiState.viewMode);
  var workflowMode = normalizeWorkspaceWorkflowMode(workspaceUiState.workflowMode);
  ui.appEl.classList.remove('workspace-view-single', 'workspace-view-grid', 'workspace-view-focus');
  ui.appEl.classList.add('workspace-view-' + viewMode);
  ui.appEl.classList.remove('workflow-select', 'workflow-annotate', 'workflow-review');
  ui.appEl.classList.add('workflow-' + workflowMode);

  var viewButtons = {
    focus: document.getElementById('sidebar-open-focused-btn')
  };
  Object.keys(viewButtons).forEach(function (key) {
    var btn = viewButtons[key];
    if (!btn) return;
    var active = key === viewMode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  var workflowButtons = {
    select: document.getElementById('workspace-workflow-select-btn'),
    annotate: document.getElementById('workspace-workflow-annotate-btn'),
    review: document.getElementById('workspace-workflow-review-btn')
  };
  Object.keys(workflowButtons).forEach(function (key) {
    var btn = workflowButtons[key];
    if (!btn) return;
    var active = key === workflowMode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  syncWorkbenchRailUi();
  updateWorkspaceSplitLayout();
}

function setWorkspaceViewMode(mode) {
  workspaceUiState.viewMode = normalizeWorkspaceViewMode(mode);
  syncWorkspaceHeaderUi();
}

function setWorkspaceWorkflowMode(mode) {
  workspaceUiState.workflowMode = normalizeWorkspaceWorkflowMode(mode);
  syncWorkspaceHeaderUi();
}

function normalizeWorkspaceSurface(surface) {
  var value = String(surface || '').trim().toLowerCase();
  if (value === 'grid') return 'grid';
  if (value === 'focus') return 'focus';
  if (value === 'reviewoutput') return 'reviewOutput';
  if (value === 'training') return 'training';
  if (value === 'configeditor') return 'configEditor';
  return 'default';
}

function syncWorkspaceConfigEditorUi() {
  var toolbar = document.getElementById('config-editor-toolbar');
  var backBtn = document.getElementById('config-editor-back-btn');
  var fileLabel = document.getElementById('config-editor-current-file');
  var saveBtn = document.getElementById('config-editor-save-btn');
  var surface = normalizeWorkspaceSurface(workspaceState.surface);
  var isConfigEditor = surface === 'configEditor';
  var isTraining = surface === 'training';
  var isConfigWorkspace = isConfigEditor || isTraining;
  var hasConfigFile = !!(state && state.currentConfigFile && state.currentConfigFile.file);
  var hasTrainingConfigFile = hasConfigFile && state.currentConfigFile.folder === state.folder;
  var hasConfigForSurface = isTraining ? hasTrainingConfigFile : hasConfigFile;
  var trainingOverview = document.getElementById('training-editor-empty');
  var trainingConfigEmpty = document.getElementById('training-config-empty');
  var trainingDetailTabs = document.getElementById('training-detail-tabs');
  var trainingOutputView = document.getElementById('training-runner-output-view');
  var trainingRunnerEmpty = document.getElementById('training-runner-empty');
  var editorWrapper = ui.appEl.querySelector('.editor-wrapper');
  var trainingDetailTab = isTraining && typeof getTrainingDetailTab === 'function' ? getTrainingDetailTab() : 'items';
  var trainingOutputVisible = isTraining && trainingDetailTab === 'run-log';
  if (toolbar) {
    toolbar.classList.toggle('hidden', !isConfigWorkspace || (isTraining && (trainingDetailTab !== 'config' || !hasConfigForSurface)) || (!isTraining && !hasConfigForSurface));
  }
  if (backBtn) {
    backBtn.textContent = isTraining && hasConfigForSurface ? 'Close' : 'Back';
    backBtn.title = isTraining && hasConfigForSurface
      ? 'Save this config and return to Training Items.'
      : 'Return to the previous workspace.';
  }
  ui.appEl.classList.toggle('training-config-selected', isTraining && trainingDetailTab === 'config' && hasConfigForSurface);
  if (trainingDetailTabs) trainingDetailTabs.classList.toggle('hidden', !isTraining);
  if (trainingOverview) {
    trainingOverview.classList.toggle('hidden', !isTraining || trainingDetailTab !== 'items');
  }
  if (trainingConfigEmpty) {
    trainingConfigEmpty.classList.toggle('hidden', !isTraining || trainingDetailTab !== 'config' || hasConfigForSurface);
  }
  if (trainingOutputView) {
    trainingOutputView.classList.toggle('hidden', !trainingOutputVisible);
  }
  if (trainingRunnerEmpty) {
    trainingRunnerEmpty.classList.toggle('hidden', !trainingOutputVisible || isTrainingRunnerConsoleVisible());
  }
  if (editorWrapper) {
    editorWrapper.classList.toggle('hidden', isTraining && (trainingDetailTab !== 'config' || !hasConfigForSurface));
  }
  if (fileLabel) {
    fileLabel.textContent = hasConfigFile
      ? state.currentConfigFile.file
      : 'No config selected.';
  }
  if (saveBtn) {
    saveBtn.disabled = !isConfigWorkspace || !hasConfigForSurface;
  }
}

function syncConsolePanelHost() {
  if (!ui || !ui.consolePanelEl) return;
  var surface = normalizeWorkspaceSurface(workspaceState.surface);
  var host = surface === 'configEditor'
    ? document.querySelector('.editor-surface')
    : document.querySelector('.preview-panel');
  if (host && ui.consolePanelEl.parentNode !== host) {
    host.appendChild(ui.consolePanelEl);
  }
}

function syncWorkspaceSurfaceUi() {
  if (!ui || !ui.appEl) return;
  var surface = normalizeWorkspaceSurface(workspaceState.surface);
  var reviewOutputSurface = document.getElementById('review-output-surface');
  var reviewDetailSurface = document.getElementById('review-detail-surface');
  var reviewOutputBtn = document.getElementById('sidebar-open-review-output-btn');
  var trainingBtn = document.getElementById('sidebar-open-training-btn');
  var utilityTrainingBtn = document.getElementById('utility-training-btn');
  var trainingNavigator = document.getElementById('training-navigator');
  var reviewOutputBackBtn = document.getElementById('review-output-back-btn');
  var workbenchTop = ui.appEl.querySelector('.workbench-top');
  var workbenchBottom = ui.appEl.querySelector('.workbench-bottom');
  var sidebarWorkspace = document.getElementById('sidebar-workspace');

  ui.appEl.classList.remove(
    'workspace-surface-default',
    'workspace-surface-grid',
    'workspace-surface-focus',
    'workspace-surface-review-output',
    'workspace-surface-training',
    'workspace-surface-config-editor'
  );
  ui.appEl.classList.add('workspace-surface-' + surface.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); }));
  ui.appEl.classList.toggle('sidebar-hidden', !!workspaceState.sidebarHidden);

  if (reviewOutputSurface) {
    reviewOutputSurface.classList.toggle('hidden', surface !== 'reviewOutput');
  }
  if (reviewDetailSurface) {
    reviewDetailSurface.classList.toggle('hidden', surface !== 'reviewOutput');
  }
  if (trainingNavigator) {
    trainingNavigator.classList.toggle('hidden', surface !== 'training');
  }
  if (workbenchTop) {
    workbenchTop.classList.toggle('hidden', surface === 'reviewOutput');
  }
  if (workbenchBottom) {
    workbenchBottom.classList.toggle('workspace-bottom-config-editor', surface === 'configEditor' || surface === 'training');
  }
  if (sidebarWorkspace) {
    sidebarWorkspace.classList.toggle('hidden', true);
    sidebarWorkspace.setAttribute('aria-hidden', 'true');
  }
  if (reviewOutputBtn) {
    var reviewOutputActive = surface === 'reviewOutput';
    reviewOutputBtn.classList.toggle('active', reviewOutputActive);
    reviewOutputBtn.setAttribute('aria-pressed', reviewOutputActive ? 'true' : 'false');
  }
  var hasSetPath = isSetFolderPath(state.folder);
  var hasReviewContext = isSetFolderContext(state.folder, state.items);
  if (reviewOutputBtn) reviewOutputBtn.classList.toggle('hidden', !hasReviewContext);
  if (trainingBtn) {
    var trainingActive = surface === 'training';
    trainingBtn.classList.toggle('active', trainingActive);
    trainingBtn.setAttribute('aria-pressed', trainingActive ? 'true' : 'false');
    trainingBtn.classList.toggle('hidden', !hasSetPath);
  }
  if (utilityTrainingBtn) {
    var utilityTrainingActive = surface === 'training' && trainingWorkspaceState.entryMode === 'global';
    utilityTrainingBtn.classList.toggle('active', utilityTrainingActive);
    utilityTrainingBtn.setAttribute('aria-pressed', utilityTrainingActive ? 'true' : 'false');
  }
  if (reviewOutputBackBtn) {
    reviewOutputBackBtn.classList.toggle('hidden', surface !== 'reviewOutput');
  }
  if (surface === 'reviewOutput' && typeof refreshReviewWorkspaceBaseline === 'function') {
    refreshReviewWorkspaceBaseline();
  }
  if (typeof updateSidebarCollapseUi === 'function') {
    updateSidebarCollapseUi(ui.appEl.classList.contains('left-rail-collapsed'));
  }
  syncConsolePanelHost();
  renderFileList();
  syncWorkbenchRailUi();
  syncWorkspaceConfigEditorUi();
  syncTrainingWorkspaceUi();
}

function refreshWorkspaceWorkbenchSurface() {
  var surface = normalizeWorkspaceSurface(workspaceState.surface);
  if (surface === 'grid'
      && typeof isMediaGridSurfaceOpen === 'function'
      && isMediaGridSurfaceOpen()
      && typeof mediaGridRenderSharedWorkbench === 'function') {
    mediaGridRenderSharedWorkbench();
    return;
  }
  if ((surface === 'default' || surface === 'focus' || surface === 'grid')
      && typeof renderChecklistPanel === 'function') {
    renderChecklistPanel();
  }
}

function setWorkspaceSurface(surface, options) {
  var nextSurface = normalizeWorkspaceSurface(surface);
  var currentSurface = normalizeWorkspaceSurface(workspaceState.surface);
  var opts = options || {};
  if (!opts.skipRemember && nextSurface !== currentSurface && nextSurface !== 'default') {
    workspaceState.previousSurface = currentSurface;
  }
  workspaceState.surface = nextSurface;
  workspaceState.sidebarHidden = !!opts.sidebarHidden || nextSurface === 'focus';
  if (nextSurface === 'reviewOutput' && currentSurface !== 'reviewOutput' && typeof setReviewDetailTab === 'function') {
    setReviewDetailTab('metadata');
  }
  if (nextSurface === 'training' && currentSurface !== 'training' && typeof setTrainingDetailTab === 'function') {
    setTrainingDetailTab('items');
  }
  if (nextSurface === 'grid') {
    setWorkspaceViewMode('grid');
  } else if (nextSurface === 'focus') {
    setWorkspaceViewMode('focus');
  } else {
    setWorkspaceViewMode('single');
  }
  syncWorkspaceSurfaceUi();
  refreshWorkspaceWorkbenchSurface();
}

function exitWorkspaceSurface(surfaceOverride) {
  var targetSurface = surfaceOverride ? normalizeWorkspaceSurface(surfaceOverride) : normalizeWorkspaceSurface(workspaceState.previousSurface);
  if (targetSurface === 'grid' || targetSurface === 'focus') {
    targetSurface = 'default';
  }
  setWorkspaceSurface(targetSurface || 'default', { skipRemember: true });
}

function closeTrainingWorkspaceConfigEditor() {
  var configFile = state && state.currentConfigFile;
  var isTrainingConfig = isTrainingWorkspaceActive() && configFile && configFile.folder === state.folder && configFile.file;
  if (!isTrainingConfig) {
    exitWorkspaceSurface();
    return;
  }
  cancelEditorAutosaveForConfig(configFile.folder, configFile.file);
  Promise.resolve(saveCurrentEditorContent())
    .then(function () {
      if (!state.currentConfigFile || state.currentConfigFile.folder !== configFile.folder || state.currentConfigFile.file !== configFile.file) return;
      state.currentConfigFile = null;
      clearEditorAndPreview();
      syncWorkspaceConfigEditorUi();
      syncTrainingWorkspaceConfigSelection();
      setStatus('Config saved. Back to Training Items.');
    })
    .catch(function (err) {
      setStatus('Could not save config: ' + String(err && err.message ? err.message : err));
    });
}

function ensureWorkspaceOverlayHost() {
  if (!ui || !ui.appEl) {
    throw new Error('Workspace overlay host requested before app UI initialized.');
  }
  var overlayHost = document.getElementById('workspace-overlays');
  if (!overlayHost) {
    overlayHost = document.createElement('div');
    overlayHost.id = 'workspace-overlays';
    overlayHost.className = 'workspace-overlays';
    ui.appEl.appendChild(overlayHost);
  }
  return overlayHost;
}

function ensureWorkspaceOverlayChildren(ids) {
  var overlayHost = ensureWorkspaceOverlayHost();
  (Array.isArray(ids) ? ids : []).forEach(function (id) {
    var node = document.getElementById(String(id || '').trim());
    if (!node || node.parentNode === overlayHost) return;
    overlayHost.appendChild(node);
  });
  return overlayHost;
}

function rebuildUnifiedWorkspaceShell() {
  if (!ui || !ui.appEl || ui.appEl.__workspaceRevampBuilt) return;
  var appEl = ui.appEl;
  appEl.__workspaceRevampBuilt = true;
  appEl.classList.add('shell-revamp');

  ensureWorkspaceOverlayChildren([
    'focused-annotation-modal',
    'media-grid-modal',
    'media-grid-viewer-modal',
    'advanced-modal-overlay',
    'review-rules-modal',
    'modal-overlay',
    'checklist-keywords-modal',
    'checklist-group-terms-modal',
    'checklist-term-affixes-modal'
  ]);

  setWorkspaceViewMode('single');
  syncWorkspaceSurfaceUi();
}

function wireWorkspaceHeaderUi() {
  var reviewOutputBtn = document.getElementById('sidebar-open-review-output-btn');
  if (reviewOutputBtn && !reviewOutputBtn.__workspaceWired) {
    reviewOutputBtn.__workspaceWired = true;
    reviewOutputBtn.onclick = function () {
      setWorkspaceSurface('reviewOutput');
    };
  }
  var reviewOutputBackBtn = document.getElementById('review-output-back-btn');
  if (reviewOutputBackBtn && !reviewOutputBackBtn.__workspaceWired) {
    reviewOutputBackBtn.__workspaceWired = true;
    reviewOutputBackBtn.onclick = function () {
      exitWorkspaceSurface();
    };
  }
  var workbenchRailToggleBtn = document.getElementById('workbench-rail-toggle-btn');
  if (workbenchRailToggleBtn && !workbenchRailToggleBtn.__workspaceWired) {
    workbenchRailToggleBtn.__workspaceWired = true;
    workbenchRailToggleBtn.onclick = function () {
      setWorkbenchRailCollapsed(!isWorkbenchRailCollapsed());
    };
  }
  var trainingBtn = document.getElementById('sidebar-open-training-btn');
  if (trainingBtn && !trainingBtn.__workspaceWired) {
    trainingBtn.__workspaceWired = true;
    trainingBtn.onclick = function () {
      setTrainingWorkspaceEntryMode('set');
      setWorkspaceSurface('training');
    };
  }
  var utilityTrainingBtn = document.getElementById('utility-training-btn');
  if (utilityTrainingBtn && !utilityTrainingBtn.__workspaceWired) {
    utilityTrainingBtn.__workspaceWired = true;
    utilityTrainingBtn.onclick = function () {
      setTrainingWorkspaceEntryMode('global');
      setWorkspaceSurface('training');
    };
  }
  var configEditorBackBtn = document.getElementById('config-editor-back-btn');
  if (configEditorBackBtn && !configEditorBackBtn.__workspaceWired) {
    configEditorBackBtn.__workspaceWired = true;
    configEditorBackBtn.onclick = function () {
      closeTrainingWorkspaceConfigEditor();
    };
  }
  var configEditorSaveBtn = document.getElementById('config-editor-save-btn');
  if (configEditorSaveBtn && !configEditorSaveBtn.__workspaceWired) {
    configEditorSaveBtn.__workspaceWired = true;
    configEditorSaveBtn.onclick = function () {
      saveCurrentEditorContent();
    };
  }
  syncWorkspaceHeaderUi();
  syncWorkspaceSurfaceUi();
}

window.setWorkspaceViewMode = setWorkspaceViewMode;
window.setWorkspaceWorkflowMode = setWorkspaceWorkflowMode;
window.setWorkspaceSurface = setWorkspaceSurface;
window.exitWorkspaceSurface = exitWorkspaceSurface;
window.ensureWorkspaceOverlayChildren = ensureWorkspaceOverlayChildren;
window.syncWorkspaceConfigEditorUi = syncWorkspaceConfigEditorUi;

function getThemedPreviewPlaceholderHtml(message) {
  var theme = typeof getCurrentAppTheme === 'function' ? getCurrentAppTheme() : 'light';
  var isDark = String(theme || '').toLowerCase() === 'dark';
  var bodyBg = isDark ? '#0f172a' : '#ffffff';
  var bodyColor = isDark ? '#cbd5e1' : '#666666';
  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<style>html,body{margin:0;height:100%;}body{display:flex;align-items:center;justify-content:center;font-family:system-ui;padding:1rem;background:' + bodyBg + ';color:' + bodyColor + ';transition:background 120ms ease,color 120ms ease;}</style>' +
    '</head><body><div id="preview-empty-message">' + String(message || 'No media to preview.') + '</div><script>(function(){function applyTheme(){try{var theme=(document.documentElement&&document.documentElement.getAttribute("data-theme"))||(window.parent&&window.parent.document&&window.parent.document.documentElement&&window.parent.document.documentElement.getAttribute("data-theme"))||"light";theme=String(theme).toLowerCase()==="dark"?"dark":"light";var dark=theme==="dark";document.documentElement.setAttribute("data-theme",theme);document.documentElement.style.colorScheme=theme;document.body.style.background=dark?"#0f172a":"#ffffff";document.body.style.color=dark?"#cbd5e1":"#666666";}catch(_err){}}applyTheme();try{var parentRoot=window.parent&&window.parent.document&&window.parent.document.documentElement;if(parentRoot&&window.MutationObserver){new MutationObserver(applyTheme).observe(parentRoot,{attributes:true,attributeFilter:["data-theme"]});}}catch(_err){};})();</script></body></html>';
}

// Hide checklist panel and clear current media selection
function clearEditorAndPreview() {
  if (ui && ui.editorEl) {
    ui.editorEl.value = '';
  }
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = '';
  }
  if (ui && ui.previewEl) {
    var doc = ui.previewEl.contentDocument || ui.previewEl.contentdocument;
    if (doc) {
      doc.open();
      doc.write(getThemedPreviewPlaceholderHtml('No media to preview.'));
      doc.close();
    }
  }
  var checklistPanelEl = document.getElementById('caption-checklist-panel');
  if (checklistPanelEl) checklistPanelEl.style.display = 'none';
  state.currentItem = null;
  state.currentConfigFile = null;
  state.configLoadToken = Number(state.configLoadToken || 0) + 1;
  if (typeof updatePrimerCaptionResetUi === 'function') {
    updatePrimerCaptionResetUi();
  }
  renderItemTagsPanel();
  renderItemMetadataPanel();
  updatePreviewActionControls();
  if (typeof updateSidebarSurfaceTools === 'function') {
    updateSidebarSurfaceTools();
  }
  updateBalanceDistributionWheel();
}

function clearSelection() {
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = '';
  }
  state.currentItem = null;
  state.currentConfigFile = null;
  if (typeof updatePrimerCaptionResetUi === 'function') {
    updatePrimerCaptionResetUi();
  }
  renderItemTagsPanel();
  renderItemMetadataPanel();
  renderFileList(ui.filterEl.value);
  if (typeof updateSidebarSurfaceTools === 'function') {
    updateSidebarSurfaceTools();
  }
}
