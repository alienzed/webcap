var workspaceState = {
  surface: 'default',
  previousSurface: 'default',
  sidebarHidden: false
};

var shellNavigationState = {
  activity: 'prep',
  workspaceRoot: 'prep',
  contextKind: 'set',
  immersive: false
};

var initialShellLocationRoute = null;
var initialShellLocationRestored = false;
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

function getWorkspaceViewMode() {
  var surface = normalizeWorkspaceSurface(workspaceState.surface);
  if (surface === 'grid' || surface === 'focus') return surface;
  return 'single';
}

function getWorkbenchRailViewMode() {
  return getWorkspaceViewMode();
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
function syncWorkspaceHeaderUi() {
  if (!ui || !ui.appEl) return;
  var viewMode = getWorkspaceViewMode();
  ui.appEl.classList.remove('workspace-view-single', 'workspace-view-grid', 'workspace-view-focus');
  ui.appEl.classList.add('workspace-view-' + viewMode);
  var viewButtons = {
    focus: document.getElementById('preview-open-focused-btn')
  };
  Object.keys(viewButtons).forEach(function (key) {
    var btn = viewButtons[key];
    if (!btn) return;
    var active = key === viewMode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  syncWorkbenchRailUi();
}

function normalizeShellRouteWorkspace(value) {
  var workspace = String(value || '').trim().toLowerCase();
  if (workspace === 'training') return 'training';
  if (workspace === 'test') return 'test';
  if (workspace === 'review') return 'review';
  if (workspace === 'grid') return 'grid';
  return 'prep';
}

function parseShellLocationRoute() {
  var hash = String(window.location && window.location.hash || '');
  if (!hash || hash.indexOf('#/') !== 0) return null;
  var body = hash.slice(2);
  var queryIndex = body.indexOf('?');
  var workspace = normalizeShellRouteWorkspace(queryIndex >= 0 ? body.slice(0, queryIndex) : body);
  var params = new URLSearchParams(queryIndex >= 0 ? body.slice(queryIndex + 1) : '');
  var folder = String(params.get('folder') || '').replace(/^[/\\]+|[/\\]+$/g, '');
  var scope = params.get('scope') === 'global' ? 'global' : 'set';
  return { workspace: workspace, folder: folder, scope: scope };
}

function currentShellRouteWorkspace() {
  var navigation = deriveShellNavigationState();
  if (navigation.activity === 'test') return 'test';
  if (navigation.workspaceRoot === 'training') return 'training';
  if (navigation.workspaceRoot === 'review') return 'review';
  if (navigation.workspaceRoot === 'grid') return 'grid';
  return 'prep';
}

function syncShellLocationRoute() {
  if (!window.history || typeof window.history.replaceState !== 'function') return;
  if (initialShellLocationRoute && !initialShellLocationRestored) return;
  var workspace = currentShellRouteWorkspace();
  var params = new URLSearchParams();
  var folder = String(state && state.folder || '');
  if (folder) params.set('folder', folder);
  if (workspace === 'training' && getTrainingWorkspaceEntryKind() === 'global') params.set('scope', 'global');
  var nextHash = '#/' + workspace + (params.toString() ? '?' + params.toString() : '');
  if (window.location.hash === nextHash) return;
  window.history.replaceState(null, '', window.location.pathname + window.location.search + nextHash);
}

function applyInitialShellLocationRoute() {
  initialShellLocationRoute = parseShellLocationRoute();
  if (!initialShellLocationRoute) return null;
  if (initialShellLocationRoute.folder) {
    state.folder = initialShellLocationRoute.folder;
    state.dirStack = [{ name: '' }].concat(initialShellLocationRoute.folder.split('/').filter(Boolean).map(function (name) {
      return { name: name };
    }));
  }
  return initialShellLocationRoute;
}

function restoreInitialShellLocationRoute() {
  if (initialShellLocationRestored) return;
  initialShellLocationRestored = true;
  var route = initialShellLocationRoute;
  initialShellLocationRoute = null;
  if (!route) {
    syncShellLocationRoute();
    return;
  }
  if (route.workspace === 'training') {
    openTrainingSurface(route.scope === 'global' ? 'global' : 'set');
  } else if (route.workspace === 'review') {
    setWorkspaceSurface('reviewOutput');
  } else if (route.workspace === 'grid' && typeof openMediaGridSurface === 'function') {
    openMediaGridSurface();
  } else if (route.workspace === 'test' && typeof window.openTestBenchForCurrentFolder === 'function') {
    window.openTestBenchForCurrentFolder();
  } else {
    setWorkspaceSurface('default', { skipRemember: true });
  }
  syncShellLocationRoute();
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

function setShellImmersive(nextImmersive) {
  shellNavigationState.immersive = !!nextImmersive;
  var frame = document.getElementById('app-frame');
  var enterBtn = document.getElementById('shell-immersive-btn');
  var exitBtn = document.getElementById('shell-immersive-exit-btn');
  if (frame) frame.classList.toggle('shell-immersive', shellNavigationState.immersive);
  if (enterBtn) enterBtn.setAttribute('aria-pressed', shellNavigationState.immersive ? 'true' : 'false');
  if (exitBtn) exitBtn.classList.toggle('hidden', !shellNavigationState.immersive);
}

function toggleShellImmersive() {
  setShellImmersive(!shellNavigationState.immersive);
}

function deriveShellNavigationState() {
  var surface = normalizeWorkspaceSurface(workspaceState.surface);
  var testOpen = !!document.querySelector('.test-generations-pane:not(.hidden)');
  var activity = testOpen ? 'test' : (surface === 'training' ? 'training' : 'prep');
  var workspaceRoot = testOpen
    ? 'test'
    : (surface === 'training'
      ? 'training'
      : (surface === 'reviewOutput'
        ? 'review'
        : (surface === 'grid' ? 'grid' : (surface === 'focus' ? 'focus' : (surface === 'configEditor' ? 'config' : 'prep')))));
  var contextKind = activity === 'training' && getTrainingWorkspaceEntryKind() === 'global'
    ? 'global'
    : (state && state.folder ? 'set' : 'none');
  shellNavigationState.activity = activity;
  shellNavigationState.workspaceRoot = workspaceRoot;
  shellNavigationState.contextKind = contextKind;
  return shellNavigationState;
}

function syncApplicationShellContext() {
  var navigation = deriveShellNavigationState();
  var folderEl = document.getElementById('app-header-folder');
  if (folderEl) {
    var folder = String(state && state.folder || '');
    var label = folder || (typeof ROOT_FOLDER_LABEL === 'string' && ROOT_FOLDER_LABEL ? ROOT_FOLDER_LABEL : 'root');
    folderEl.textContent = label;
    folderEl.title = label;
  }

  var surface = normalizeWorkspaceSurface(workspaceState.surface);
  var workspaceTitle = document.getElementById('app-header-workspace-title');
  var workspaceContext = document.getElementById('app-header-workspace-context');
  var sidebarToggle = document.getElementById('sidebar-collapse-toggle-btn');
  var testOpen = navigation.activity === 'test';
  if (sidebarToggle) {
    var sidebarToggleVisible = !testOpen && (surface === 'default' || surface === 'training');
    sidebarToggle.classList.toggle('hidden', !sidebarToggleVisible);
    if (typeof updateSidebarCollapseUi === 'function') {
      updateSidebarCollapseUi(ui && ui.appEl ? ui.appEl.classList.contains('left-rail-collapsed') : false);
    }
  }
  if (workspaceTitle) {
    workspaceTitle.textContent = testOpen
      ? 'Test'
      : (surface === 'training'
        ? 'Training'
        : (surface === 'reviewOutput'
          ? 'Review Set'
          : (surface === 'grid' ? 'Grid' : (surface === 'focus' ? 'Focus' : ''))));
  }
  if (workspaceContext) {
    var workspaceContextText = '';
    if (testOpen) {
      workspaceContextText = 'Generations';
    } else if (surface === 'training') {
      var entryKind = getTrainingWorkspaceEntryKind();
      workspaceContextText = entryKind === 'global'
        ? 'Global'
        : (entryKind === 'set' ? '' : 'Select a set');
    } else if (surface === 'reviewOutput' && typeof getReviewWorkspaceShellContext === 'function') {
      workspaceContextText = getReviewWorkspaceShellContext();
    } else if (surface === 'grid') {
      workspaceContextText = mediaGridGetSourceLabel();
    }
    workspaceContext.textContent = workspaceContextText;
  }

  var prepBtn = document.getElementById('activity-prep-btn');
  var trainingBtn = document.getElementById('activity-training-btn');
  var testBtn = document.getElementById('activity-test-btn');

  if (prepBtn) {
    var prepActive = navigation.activity === 'prep';
    prepBtn.classList.toggle('active', prepActive);
    prepBtn.setAttribute('aria-pressed', prepActive ? 'true' : 'false');
    prepBtn.setAttribute('aria-current', prepActive ? 'page' : 'false');
  }
  if (trainingBtn) {
    var trainingActive = navigation.activity === 'training';
    trainingBtn.classList.toggle('active', trainingActive);
    trainingBtn.setAttribute('aria-pressed', trainingActive ? 'true' : 'false');
    trainingBtn.setAttribute('aria-current', trainingActive ? 'page' : 'false');
  }
  if (testBtn) {
    var testActive = navigation.activity === 'test';
    testBtn.classList.toggle('active', testActive);
    testBtn.setAttribute('aria-pressed', testActive ? 'true' : 'false');
    testBtn.setAttribute('aria-current', testActive ? 'page' : 'false');
  }
}

function openPrepActivity() {
  if (typeof window !== 'undefined' && typeof window.closeTestBenchActivity === 'function') window.closeTestBenchActivity();
  var surface = normalizeWorkspaceSurface(workspaceState.surface);
  if (surface === 'grid') {
    closeMediaGridSurface();
  } else if (surface === 'focus') {
    stopFocusedAnnotation();
  }
  setWorkspaceSurface('default');
}

function syncWorkspaceConfigEditorUi() {
  var surface = normalizeWorkspaceSurface(workspaceState.surface);
  if (surface === 'training') {
    if (typeof syncTrainingWorkspaceDetailUi === 'function') syncTrainingWorkspaceDetailUi();
    return;
  }

  var toolbar = document.getElementById('config-editor-toolbar');
  var backBtn = document.getElementById('config-editor-back-btn');
  var fileLabel = document.getElementById('config-editor-current-file');
  var saveBtn = document.getElementById('config-editor-save-btn');
  var editorWrapper = ui && ui.appEl ? ui.appEl.querySelector('.editor-wrapper') : null;
  var isConfigEditor = surface === 'configEditor';
  var hasConfigFile = !!(state && state.currentConfigFile && state.currentConfigFile.file);

  if (ui && ui.appEl) ui.appEl.classList.remove('training-config-selected');
  if (editorWrapper) editorWrapper.classList.remove('hidden');
  if (toolbar) toolbar.classList.toggle('hidden', !isConfigEditor || !hasConfigFile);
  if (backBtn) {
    backBtn.textContent = 'Back';
    backBtn.title = 'Return to the previous workspace.';
  }
  if (fileLabel) fileLabel.textContent = hasConfigFile ? state.currentConfigFile.file : 'No config selected.';
  if (saveBtn) saveBtn.disabled = !isConfigEditor || !hasConfigFile;
}

function syncWorkspaceSurfaceUi() {
  if (!ui || !ui.appEl) return;
  var surface = normalizeWorkspaceSurface(workspaceState.surface);
  var reviewOutputSurface = document.getElementById('review-output-surface');
  var reviewDetailSurface = document.getElementById('review-detail-surface');
  var reviewOutputBtn = document.getElementById('sidebar-open-review-output-btn');
  var trainingNavigator = document.getElementById('training-navigator');
  var reviewOutputBackBtn = document.getElementById('review-output-back-btn');
  var workbenchTop = ui.appEl.querySelector('.workbench-top');
  var workbenchBottom = ui.appEl.querySelector('.workbench-bottom');

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
  if (reviewOutputBtn) {
    var reviewOutputActive = surface === 'reviewOutput';
    reviewOutputBtn.classList.toggle('active', reviewOutputActive);
    reviewOutputBtn.setAttribute('aria-pressed', reviewOutputActive ? 'true' : 'false');
  }
  var hasReviewContext = isSetFolderContext(state.folder, state.items);
  if (reviewOutputBtn) reviewOutputBtn.classList.toggle('hidden', !hasReviewContext);
  syncTrainingEntryChrome();
  if (reviewOutputBackBtn) {
    reviewOutputBackBtn.classList.toggle('hidden', surface !== 'reviewOutput');
  }
  if (surface === 'reviewOutput' && typeof refreshReviewWorkspaceBaseline === 'function') {
    refreshReviewWorkspaceBaseline();
  }
  if (typeof updateSidebarCollapseUi === 'function') {
    updateSidebarCollapseUi(ui.appEl.classList.contains('left-rail-collapsed'));
  }
  renderFileList();
  syncWorkbenchRailUi();
  syncWorkspaceConfigEditorUi();
  syncTrainingWorkspaceUi();
  syncApplicationShellContext();
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
    setTrainingDetailTab(trainingWorkspaceState.entryMode === 'global' ? 'run-log' : 'items');
  }
  syncWorkspaceSurfaceUi();
  refreshWorkspaceWorkbenchSurface();
  syncShellLocationRoute();
}

function exitWorkspaceSurface(surfaceOverride) {
  var targetSurface = surfaceOverride ? normalizeWorkspaceSurface(surfaceOverride) : normalizeWorkspaceSurface(workspaceState.previousSurface);
  if (targetSurface === 'grid' || targetSurface === 'focus') {
    targetSurface = 'default';
  }
  setWorkspaceSurface(targetSurface || 'default', { skipRemember: true });
}

function openTrainingSurface(mode) {
  if (typeof window !== 'undefined' && typeof window.closeTestBenchActivity === 'function') window.closeTestBenchActivity();
  if (normalizeWorkspaceSurface(workspaceState.surface) === 'focus') {
    stopFocusedAnnotation();
  }
  var entryMode = mode === 'set' ? 'set' : 'global';
  var configFile = state.currentConfigFile;
  var shouldSaveConfig = isTrainingWorkspaceActive()
    && trainingWorkspaceState.entryMode === 'set'
    && getTrainingDetailTab() === 'config'
    && configFile
    && configFile.folder === state.folder
    && configFile.file;

  function enterTrainingSurface() {
    setTrainingWorkspaceEntryMode(entryMode, { resetDefaults: true });
    setWorkspaceSurface('training', { sidebarHidden: entryMode === 'global' });
    setTrainingDetailTab(entryMode === 'global' ? 'run-log' : 'items');
    syncTrainingEntryChrome();
  }

  if (!shouldSaveConfig) {
    enterTrainingSurface();
    return;
  }

  cancelEditorAutosaveForConfig(configFile.folder, configFile.file);
  Promise.resolve(saveCurrentEditorContent())
    .then(function () {
      enterTrainingSurface();
    })
    .catch(function (err) {
      setStatus('Could not save config: ' + String(err && err.message ? err.message : err));
    });
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

function initializeWorkspaceShell() {
  if (!ui || !ui.appEl || ui.appEl.__workspaceShellInitialized) return;
  var appEl = ui.appEl;
  appEl.__workspaceShellInitialized = true;
  appEl.classList.add('shell-revamp');
  syncWorkspaceSurfaceUi();
}

function isApplicationOverlayOpen() {
  var root = document.getElementById('app-overlay-root');
  if (!root) return false;
  for (var i = 0; i < root.children.length; i += 1) {
    var child = root.children[i];
    if (child && !child.classList.contains('hidden')) return true;
  }
  return false;
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
      openTrainingSurface('set');
    };
  }
  var prepActivityBtn = document.getElementById('activity-prep-btn');
  if (prepActivityBtn && !prepActivityBtn.__workspaceWired) {
    prepActivityBtn.__workspaceWired = true;
    prepActivityBtn.onclick = openPrepActivity;
  }
  var trainingActivityBtn = document.getElementById('activity-training-btn');
  if (trainingActivityBtn && !trainingActivityBtn.__workspaceWired) {
    trainingActivityBtn.__workspaceWired = true;
    trainingActivityBtn.onclick = function () {
      openTrainingSurface('global');
    };
  }
  var testActivityBtn = document.getElementById('activity-test-btn');
  if (testActivityBtn && !testActivityBtn.__workspaceWired) {
    testActivityBtn.__workspaceWired = true;
    testActivityBtn.onclick = function () {
      if (normalizeWorkspaceSurface(workspaceState.surface) === 'focus') {
        stopFocusedAnnotation();
      }
      if (typeof window.openTestBenchActivity !== 'function') throw new Error('Test Bench activity is not available.');
      window.openTestBenchActivity();
    };
  }
  var configEditorBackBtn = document.getElementById('config-editor-back-btn');
  if (configEditorBackBtn && !configEditorBackBtn.__workspaceWired) {
    configEditorBackBtn.__workspaceWired = true;
    configEditorBackBtn.onclick = function () {
      closeTrainingWorkspaceConfigEditor();
    };
  }
  var immersiveBtn = document.getElementById('shell-immersive-btn');
  if (immersiveBtn && !immersiveBtn.__workspaceWired) {
    immersiveBtn.__workspaceWired = true;
    immersiveBtn.onclick = toggleShellImmersive;
  }
  var immersiveExitBtn = document.getElementById('shell-immersive-exit-btn');
  if (immersiveExitBtn && !immersiveExitBtn.__workspaceWired) {
    immersiveExitBtn.__workspaceWired = true;
    immersiveExitBtn.onclick = function () { setShellImmersive(false); };
  }
  if (!window.__webcapShellEscapeBound) {
    window.__webcapShellEscapeBound = true;
    document.addEventListener('keydown', function (event) {
      if (!event || event.key !== 'Escape' || event.defaultPrevented) return;
      var openOverlay = document.querySelector('#app-overlay-root > :not(.hidden)[data-escape-close-id]');
      if (openOverlay) {
        var closeId = openOverlay.getAttribute('data-escape-close-id');
        var closeBtn = closeId ? document.getElementById(closeId) : null;
        if (closeBtn) {
          event.preventDefault();
          closeBtn.click();
          return;
        }
      }
      var genericModal = document.querySelector('#app-overlay-root > .modal:not(.hidden)');
      if (genericModal && genericModal.id) {
        var genericClose = genericModal.querySelector('[data-close-modal="' + genericModal.id + '"]');
        if (genericClose) {
          event.preventDefault();
          genericClose.click();
          return;
        }
      }
      if (typeof isFocusedAnnotationOpen === 'function' && isFocusedAnnotationOpen()) return;
      if (shellNavigationState.immersive) {
        event.preventDefault();
        setShellImmersive(false);
      }
    });
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

window.getWorkspaceViewMode = getWorkspaceViewMode;
window.setWorkspaceSurface = setWorkspaceSurface;
window.exitWorkspaceSurface = exitWorkspaceSurface;
window.syncWorkspaceConfigEditorUi = syncWorkspaceConfigEditorUi;
window.syncApplicationShellContext = syncApplicationShellContext;
window.deriveShellNavigationState = deriveShellNavigationState;
window.isApplicationOverlayOpen = isApplicationOverlayOpen;
window.setShellImmersive = setShellImmersive;
window.toggleShellImmersive = toggleShellImmersive;
window.parseShellLocationRoute = parseShellLocationRoute;
window.syncShellLocationRoute = syncShellLocationRoute;
window.applyInitialShellLocationRoute = applyInitialShellLocationRoute;
window.restoreInitialShellLocationRoute = restoreInitialShellLocationRoute;

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
  if (typeof setChecklistPanelVisible === 'function') {
    setChecklistPanelVisible(false);
  }
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

