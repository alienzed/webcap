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

var shellSystemStatusState = {
  pending: false,
  timer: 0,
  gpu: null,
  ram: null,
  disk: null,
  error: ''
};
var SHELL_SYSTEM_STATUS_INTERVAL_MS = 30000;

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
  if (workspace === 'generate') return 'generate';
  if (workspace === 'test') return 'test';
  if (workspace === 'storyboard') return 'storyboard';
  if (workspace === 'storage') return 'storage';
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
  if (navigation.activity === 'generate') return 'generate';
  if (navigation.activity === 'test') return 'test';
  if (navigation.activity === 'storyboard') return 'storyboard';
  if (navigation.activity === 'storage') return 'storage';
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
  if (folder && workspace !== 'storyboard' && workspace !== 'generate') params.set('folder', folder);
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
  } else if (route.workspace === 'generate' && typeof window.openGenerateActivity === 'function') {
    window.openGenerateActivity();
  } else if (route.workspace === 'test' && typeof window.openTestBenchForCurrentFolder === 'function') {
    window.openTestBenchForCurrentFolder();
  } else if (route.workspace === 'storyboard' && typeof window.openStoryboardActivity === 'function') {
    window.openStoryboardActivity();
  } else if (route.workspace === 'storage' && typeof window.openStorageActivity === 'function') {
    window.openStorageActivity();
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
  var generateOpen = !!document.querySelector('.generate-workspace:not(.hidden)');
  var testOpen = !!document.querySelector('.test-generations-pane:not(.hidden)');
  var storyboardOpen = !!document.querySelector('.storyboard-workspace:not(.hidden)');
  var storageOpen = !!document.querySelector('.storage-workspace:not(.hidden)');
  var activity = storageOpen ? 'storage' : (generateOpen ? 'generate' : (storyboardOpen ? 'storyboard' : (testOpen ? 'test' : (surface === 'training' ? 'training' : 'prep'))));
  var workspaceRoot = storageOpen
    ? 'storage'
    : (generateOpen
      ? 'generate'
      : (storyboardOpen
        ? 'storyboard'
        : (testOpen
          ? 'test'
          : (surface === 'training'
            ? 'training'
            : (surface === 'reviewOutput'
              ? 'review'
              : (surface === 'grid' ? 'grid' : (surface === 'focus' ? 'focus' : (surface === 'configEditor' ? 'config' : 'prep'))))))));
  var contextKind = activity === 'storyboard' || activity === 'generate' || activity === 'storage'
    ? 'none'
    : (activity === 'training' && getTrainingWorkspaceEntryKind() === 'global'
      ? 'global'
      : (state && state.folder ? 'set' : 'none'));
  shellNavigationState.activity = activity;
  shellNavigationState.workspaceRoot = workspaceRoot;
  shellNavigationState.contextKind = contextKind;
  return shellNavigationState;
}

function formatShellGpuMemory(value) {
  var mib = Number(value);
  if (!isFinite(mib) || mib < 0) return '';
  return (mib / 1024).toFixed(1) + ' GiB';
}

function formatShellDiskSpace(value) {
  var bytes = Number(value);
  if (!isFinite(bytes) || bytes < 0) return '';
  return (bytes / (1024 * 1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 * 1024 ? 0 : 1) + ' GiB';
}

var shellWorkloadState = {
  trainingActive: false,
  testingActive: false,
  generatingActive: false,
  inferenceActive: false
};

function getShellWorkloadStatus() {
  if (shellWorkloadState.trainingActive) {
    return { key: 'training', label: 'Training' };
  }
  if (shellWorkloadState.testingActive) {
    return { key: 'testing', label: 'Testing' };
  }
  if (shellWorkloadState.generatingActive || shellWorkloadState.inferenceActive) {
    return { key: 'generating', label: 'Generating' };
  }
  return { key: 'idle', label: 'Idle' };
}

function setShellTrainingActive(active) {
  shellWorkloadState.trainingActive = !!active;
  renderShellSystemStatus();
}

function setShellTestingActive(active) {
  shellWorkloadState.testingActive = !!active;
  renderShellSystemStatus();
}

function setShellGeneratingActive(active) {
  shellWorkloadState.generatingActive = !!active;
  renderShellSystemStatus();
}

function setShellInferenceActive(active) {
  shellWorkloadState.inferenceActive = !!active;
  renderShellSystemStatus();
}

function renderShellSystemStatus() {
  var host = document.getElementById('shell-gpu-status');
  if (!host) return;

  var parts = [];
  var workload = getShellWorkloadStatus();
  parts.push(
    '<span class="shell-workload-status is-' + workload.key + '" title="Current GPU workload state.">' +
    escapeHtml(workload.label) +
    '</span>'
  );
  var gpu = shellSystemStatusState.gpu;
  if (gpu && gpu.available) {
    var gpus = Array.isArray(gpu.gpus) ? gpu.gpus : [];
    if (gpus.length) {
      var primary = gpus[0];
      var utilization = Number(primary.utilization);
      var memoryUsed = formatShellGpuMemory(primary.memoryUsed);
      var memoryTotal = formatShellGpuMemory(primary.memoryTotal);
      var gpuSummary = '<span class="shell-system-label">GPU</span>' +
        (isFinite(utilization) ? '<strong>' + Math.round(utilization) + '%</strong>' : '') +
        (memoryUsed && memoryTotal
          ? '<span class="shell-system-divider" aria-hidden="true">·</span><span class="shell-system-label">VRAM</span><strong>' +
            escapeHtml(memoryUsed) + ' / ' + escapeHtml(memoryTotal) + '</strong>'
          : '');
      parts.push('<span class="shell-system-gpu" title="Live GPU utilization and VRAM use.">' + gpuSummary + '</span>');
    }
  } else if (gpu && !gpu.available) {
    parts.push('<span class="is-warning" title="' + escapeHtml(gpu.error || 'GPU status unavailable.') + '">GPU unavailable</span>');
  }

  var ram = shellSystemStatusState.ram;
  if (ram && ram.available) {
    var ramUsed = formatShellDiskSpace(ram.used);
    var ramTotal = formatShellDiskSpace(ram.total);
    var ramFree = formatShellDiskSpace(ram.free);
    var ramUsedBytes = Number(ram.used);
    var ramTotalBytes = Number(ram.total);
    var ramPercent = isFinite(ramUsedBytes) && isFinite(ramTotalBytes) && ramTotalBytes > 0
      ? Math.round(ramUsedBytes / ramTotalBytes * 100)
      : null;
    var ramTitle = 'Physical RAM in use' + (ramFree ? ' · ' + ramFree + ' available' : '');
    parts.push('<span class="shell-system-ram" title="' + escapeHtml(ramTitle) + '"><span class="shell-system-label">RAM</span> ' +
      '<strong>' + escapeHtml(ramUsed || '—') + ' / ' + escapeHtml(ramTotal || '—') +
      (ramPercent === null ? '' : ' (' + ramPercent + '%)') + '</strong></span>');
  } else if (ram && !ram.available) {
    parts.push('<span class="is-warning" title="' + escapeHtml(ram.error || 'RAM status unavailable.') + '">RAM unavailable</span>');
  }

  var disk = shellSystemStatusState.disk;
  if (disk && disk.available) {
    var freeText = formatShellDiskSpace(disk.free);
    var totalText = formatShellDiskSpace(disk.total);
    var free = Number(disk.free);
    var total = Number(disk.total);
    var low = isFinite(free) && isFinite(total) && total > 0 && (free / total) < 0.10;
    var diskTitle = 'Free space on ' + String(disk.path || 'WebCap filesystem') +
      (totalText ? ' · ' + totalText + ' total' : '');
    parts.push('<span class="shell-system-disk' + (low ? ' is-warning' : '') + '" title="' + escapeHtml(diskTitle) + '"><span class="shell-system-label">Disk</span> ' +
      '<strong class="shell-system-value">' + escapeHtml(freeText || '—') + ' free</strong></span>');
  } else if (disk && !disk.available) {
    parts.push('<span class="is-warning" title="' + escapeHtml(disk.error || 'Disk status unavailable.') + '">Disk unavailable</span>');
  }

  host.innerHTML = parts.join('<span class="shell-system-divider" aria-hidden="true">·</span>');
  host.classList.toggle('hidden', !parts.length);
}

function scheduleShellSystemStatusRefresh() {
  if (shellSystemStatusState.timer) clearTimeout(shellSystemStatusState.timer);
  shellSystemStatusState.timer = setTimeout(refreshShellSystemStatus, SHELL_SYSTEM_STATUS_INTERVAL_MS);
}

function refreshShellSystemStatus() {
  if (shellSystemStatusState.pending) return;
  shellSystemStatusState.pending = true;
  fetch('/fs/system_status')
    .then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || !payload.ok) {
          throw new Error((payload && payload.error) || 'System status unavailable.');
        }
        return payload;
      });
    })
    .then(function (payload) {
      shellSystemStatusState.gpu = payload.gpu || null;
      shellSystemStatusState.ram = payload.ram || null;
      shellSystemStatusState.disk = payload.disk || null;
      shellSystemStatusState.error = '';
      renderShellSystemStatus();
    })
    .catch(function (err) {
      shellSystemStatusState.error = String(err && err.message ? err.message : err);
      if (!shellSystemStatusState.gpu && !shellSystemStatusState.ram && !shellSystemStatusState.disk) {
        renderShellSystemStatus();
        var host = document.getElementById('shell-gpu-status');
        if (host) {
          host.innerHTML += '<span class="shell-system-divider" aria-hidden="true">·</span>' +
            '<span class="is-warning" title="' + escapeHtml(shellSystemStatusState.error) + '">System status unavailable</span>';
        }
      }
    })
    .then(function () {
      shellSystemStatusState.pending = false;
      scheduleShellSystemStatusRefresh();
    });
}

function renderApplicationHeaderBreadcrumb(navigation) {
  var host = document.getElementById('app-header-breadcrumb');
  var separator = document.getElementById('app-header-context-separator');
  if (!host || !separator) return;

  var entries = state && Array.isArray(state.dirStack) ? state.dirStack : [];
  var showPath = navigation.contextKind === 'set' && entries.length > 0;
  host.innerHTML = '';
  host.classList.toggle('hidden', !showPath);
  separator.classList.toggle('hidden', !showPath);
  if (!showPath) return;

  entries.forEach(function (entry, index) {
    if (index > 0) {
      var divider = document.createElement('span');
      divider.className = 'app-header-breadcrumb-separator';
      divider.setAttribute('aria-hidden', 'true');
      divider.textContent = '›';
      host.appendChild(divider);
    }

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-header-breadcrumb-item';
    button.setAttribute('data-dir-index', String(index));
    var label = String(entry && entry.name || '').trim();
    if (!label && index === 0 && typeof ROOT_FOLDER_LABEL === 'string') label = ROOT_FOLDER_LABEL;
    if (!label) label = index === 0 ? 'root' : 'folder';
    button.textContent = label;
    button.title = index === entries.length - 1
      ? 'Open this set in Prep'
      : 'Open ' + label + ' in Prep';
    if (index === entries.length - 1) {
      button.classList.add('is-current');
      button.setAttribute('aria-current', 'location');
    }
    host.appendChild(button);
  });
}

function handleApplicationHeaderBreadcrumbClick(event) {
  var button = event && event.target ? event.target.closest('.app-header-breadcrumb-item') : null;
  if (!button) return;
  var index = Number(button.getAttribute('data-dir-index'));
  if (!isFinite(index) || !state || !Array.isArray(state.dirStack) || !state.dirStack.length) return;
  var lastIndex = state.dirStack.length - 1;

  if (index === lastIndex) {
    if (deriveShellNavigationState().activity !== 'prep') openPrepActivity();
    return;
  }

  if (deriveShellNavigationState().activity !== 'prep') openPrepActivity();
  navigateToDirStackIndex(index);
}

function syncApplicationShellContext() {
  var navigation = deriveShellNavigationState();
  var surface = normalizeWorkspaceSurface(workspaceState.surface);
  var folder = String(state && state.folder || '');
  var workspaceTitle = document.getElementById('app-header-workspace-title');
  var workspaceContext = document.getElementById('app-header-workspace-context');
  var modelControl = document.getElementById('app-header-model-control');
  var modelSelect = document.getElementById('app-header-model-profile-select');
  var previewHeader = document.getElementById('preview-header');
  var annotationActions = document.getElementById('workbench-annotation-actions');
  var sidebarToggle = document.getElementById('sidebar-collapse-toggle-btn');
  var generateOpen = navigation.activity === 'generate';
  var testOpen = navigation.activity === 'test';
  var storyboardOpen = navigation.activity === 'storyboard';
  var storageOpen = navigation.activity === 'storage';
  if (typeof window.syncInferenceQueueSurface === 'function') {
    window.syncInferenceQueueSurface(navigation.activity);
  }
  var contextText = '';

  if (generateOpen || storyboardOpen || storageOpen) {
    contextText = '';
  } else if (testOpen) {
    contextText = folder ? '' : 'Select a set';
  } else if (surface === 'training') {
    contextText = getTrainingWorkspaceEntryKind() === 'global'
      ? 'Global'
      : (folder ? '' : 'Select a set');
  } else if (!folder && navigation.contextKind !== 'set') {
    contextText = typeof ROOT_FOLDER_LABEL === 'string' && ROOT_FOLDER_LABEL ? ROOT_FOLDER_LABEL : 'root';
  }

  if (workspaceTitle) {
    if (storageOpen) workspaceTitle.textContent = 'Storage';
    else if (generateOpen) workspaceTitle.textContent = 'Generate';
    else if (storyboardOpen) workspaceTitle.textContent = 'Storyboard';
    else if (testOpen) workspaceTitle.textContent = 'Test Generations';
    else if (surface === 'training') workspaceTitle.textContent = 'Training';
    else if (surface === 'reviewOutput') workspaceTitle.textContent = 'Review Set';
    else if (surface === 'grid') workspaceTitle.textContent = 'Grid';
    else if (surface === 'focus') workspaceTitle.textContent = 'Focus';
    else workspaceTitle.textContent = 'Prep';
  }

  renderApplicationHeaderBreadcrumb(navigation);

  if (workspaceContext) {
    workspaceContext.textContent = contextText;
  }

  var previewContextRelevant = !generateOpen && !testOpen && !storyboardOpen && !storageOpen && (surface === 'default' || surface === 'focus');
  previewHeader.classList.toggle('shell-context-hidden', !previewContextRelevant);
  annotationActions.classList.toggle('shell-context-hidden', generateOpen || testOpen || storyboardOpen || storageOpen || surface !== 'default');

  var modelRelevant = navigation.activity === 'training' || navigation.activity === 'test';
  if (modelControl) modelControl.classList.toggle('hidden', !modelRelevant);
  if (modelSelect && !modelSelect.disabled) {
    modelSelect.title = navigation.activity === 'test'
      ? 'Select the Base Model for Test Generations. Active and queued tests keep their captured model.'
      : '';
  }

  if (sidebarToggle) {
    var sidebarToggleVisible = !generateOpen && !testOpen && !storyboardOpen && !storageOpen && (surface === 'default' || surface === 'training');
    sidebarToggle.classList.toggle('hidden', !sidebarToggleVisible);
    if (typeof updateSidebarCollapseUi === 'function') {
      updateSidebarCollapseUi(ui && ui.appEl ? ui.appEl.classList.contains('left-rail-collapsed') : false);
    }
  }

  var prepBtn = document.getElementById('activity-prep-btn');
  var generateBtn = document.getElementById('activity-generate-btn');
  var trainingBtn = document.getElementById('activity-training-btn');
  var testBtn = document.getElementById('activity-test-btn');
  var storyboardBtn = document.getElementById('activity-storyboard-btn');
  var storageBtn = document.getElementById('activity-storage-btn');

  if (prepBtn) {
    var prepActive = navigation.activity === 'prep';
    prepBtn.classList.toggle('active', prepActive);
    prepBtn.setAttribute('aria-pressed', prepActive ? 'true' : 'false');
    prepBtn.setAttribute('aria-current', prepActive ? 'page' : 'false');
  }
  if (generateBtn) {
    var generateActive = navigation.activity === 'generate';
    generateBtn.classList.toggle('active', generateActive);
    generateBtn.setAttribute('aria-pressed', generateActive ? 'true' : 'false');
    generateBtn.setAttribute('aria-current', generateActive ? 'page' : 'false');
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
  if (storyboardBtn) {
    var storyboardActive = navigation.activity === 'storyboard';
    storyboardBtn.classList.toggle('active', storyboardActive);
    storyboardBtn.setAttribute('aria-pressed', storyboardActive ? 'true' : 'false');
    storyboardBtn.setAttribute('aria-current', storyboardActive ? 'page' : 'false');
  }
  if (storageBtn) {
    var storageActive = navigation.activity === 'storage';
    storageBtn.classList.toggle('active', storageActive);
    storageBtn.setAttribute('aria-pressed', storageActive ? 'true' : 'false');
    storageBtn.setAttribute('aria-current', storageActive ? 'page' : 'false');
  }
}

function openPrepActivity() {
  if (typeof window !== 'undefined' && typeof window.closeGenerateActivity === 'function') window.closeGenerateActivity();
  if (typeof window !== 'undefined' && typeof window.closeTestBenchActivity === 'function') window.closeTestBenchActivity();
  if (typeof window !== 'undefined' && typeof window.closeStoryboardActivity === 'function') window.closeStoryboardActivity();
  if (typeof window !== 'undefined' && typeof window.closeStorageActivity === 'function') window.closeStorageActivity();
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
  if (typeof window !== 'undefined' && typeof window.closeGenerateActivity === 'function') window.closeGenerateActivity();
  if (typeof window !== 'undefined' && typeof window.closeTestBenchActivity === 'function') window.closeTestBenchActivity();
  if (typeof window !== 'undefined' && typeof window.closeStoryboardActivity === 'function') window.closeStoryboardActivity();
  if (typeof window !== 'undefined' && typeof window.closeStorageActivity === 'function') window.closeStorageActivity();
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
  renderShellSystemStatus();
  refreshShellSystemStatus();
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
  var breadcrumb = document.getElementById('app-header-breadcrumb');
  if (breadcrumb && !breadcrumb.__workspaceWired) {
    breadcrumb.__workspaceWired = true;
    breadcrumb.onclick = handleApplicationHeaderBreadcrumbClick;
  }
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
  var generateActivityBtn = document.getElementById('activity-generate-btn');
  if (generateActivityBtn && !generateActivityBtn.__workspaceWired) {
    generateActivityBtn.__workspaceWired = true;
    generateActivityBtn.onclick = function () {
      if (normalizeWorkspaceSurface(workspaceState.surface) === 'focus') stopFocusedAnnotation();
      if (typeof window.closeStorageActivity === 'function') window.closeStorageActivity();
      if (typeof window.openGenerateActivity !== 'function') throw new Error('Generate activity is not available.');
      window.openGenerateActivity();
    };
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
      if (typeof window.closeGenerateActivity === 'function') window.closeGenerateActivity();
      if (typeof window.closeStoryboardActivity === 'function') window.closeStoryboardActivity();
      if (typeof window.closeStorageActivity === 'function') window.closeStorageActivity();
      if (typeof window.openTestBenchActivity !== 'function') throw new Error('Test Bench activity is not available.');
      window.openTestBenchActivity();
    };
  }
  var storyboardActivityBtn = document.getElementById('activity-storyboard-btn');
  if (storyboardActivityBtn && !storyboardActivityBtn.__workspaceWired) {
    storyboardActivityBtn.__workspaceWired = true;
    storyboardActivityBtn.onclick = function () {
      if (normalizeWorkspaceSurface(workspaceState.surface) === 'focus') {
        stopFocusedAnnotation();
      }
      if (typeof window.closeGenerateActivity === 'function') window.closeGenerateActivity();
      if (typeof window.closeStorageActivity === 'function') window.closeStorageActivity();
      if (typeof window.openStoryboardActivity !== 'function') throw new Error('Storyboard activity is not available.');
      window.openStoryboardActivity();
    };
  }
  var storageActivityBtn = document.getElementById('activity-storage-btn');
  if (storageActivityBtn && !storageActivityBtn.__workspaceWired) {
    storageActivityBtn.__workspaceWired = true;
    storageActivityBtn.onclick = function () {
      if (normalizeWorkspaceSurface(workspaceState.surface) === 'focus') stopFocusedAnnotation();
      if (typeof window.openStorageActivity !== 'function') throw new Error('Storage activity is not available.');
      window.openStorageActivity();
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


window.setShellTrainingActive = setShellTrainingActive;
window.setShellTestingActive = setShellTestingActive;
window.setShellGeneratingActive = setShellGeneratingActive;
window.setShellInferenceActive = setShellInferenceActive;
