var workspaceUiState = {
  viewMode: 'single',
  workflowMode: 'annotate'
};
var workspaceState = {
  surface: 'default',
  previousSurface: 'default',
  sidebarHidden: false
};
var WORKSPACE_SPLIT_STORAGE_KEY = 'webcap.workspace.previewSplit';
var workspaceSplitState = {
  ratio: 0.46,
  dragging: false,
  wired: false,
  moveHandler: null,
  upHandler: null,
  observer: null
};

function clampWorkspaceSplitRatio(ratio, availableWidth, minPreviewWidth, minWorkbenchWidth) {
  var total = Math.max(1, Number(availableWidth) || 1);
  var minPreview = Math.max(240, Number(minPreviewWidth) || 0);
  var minWorkbench = Math.max(320, Number(minWorkbenchWidth) || 0);
  var minRatio = Math.min(0.8, Math.max(0.2, minPreview / total));
  var maxRatio = Math.max(minRatio, Math.min(0.8, 1 - (minWorkbench / total)));
  var nextRatio = Number(ratio);
  if (!isFinite(nextRatio)) nextRatio = 0.46;
  if (nextRatio < minRatio) nextRatio = minRatio;
  if (nextRatio > maxRatio) nextRatio = maxRatio;
  return nextRatio;
}

function getStoredWorkspaceSplitRatio() {
  try {
    return clampWorkspaceSplitRatio(localStorage.getItem(WORKSPACE_SPLIT_STORAGE_KEY), 1000, 320, 420);
  } catch (e) {}
  return 0.46;
}

function storeWorkspaceSplitRatio(ratio) {
  try {
    localStorage.setItem(WORKSPACE_SPLIT_STORAGE_KEY, String(ratio));
  } catch (e) {}
}

function getWorkspaceHeaderEl() {
  return null;
}

function getWorkspaceSplitResizerEl() {
  return document.getElementById('workspace-main-resizer');
}

function isWorkspaceSplitDesktopLayout() {
  return !!(ui && ui.appEl && window.innerWidth > 1180);
}

function getWorkspaceSidebarWidth() {
  if (!ui || !ui.appEl) return 0;
  if (ui.appEl.classList.contains('left-rail-collapsed')) return 0;
  return 292;
}

function getWorkspaceSplitBounds(availableWidth) {
  var annotateMode = !!(ui && ui.appEl && ui.appEl.classList.contains('workflow-annotate'));
  var available = Math.max(640, Number(availableWidth) || 0);
  var preferredPreview = annotateMode ? 320 : 300;
  var preferredWorkbench = annotateMode ? 420 : 380;
  var minPreview = preferredPreview;
  var minWorkbench = preferredWorkbench;
  if (available < (preferredPreview + preferredWorkbench)) {
    minWorkbench = annotateMode ? 360 : 340;
    minPreview = Math.max(260, available - minWorkbench);
    if (minPreview < 260) {
      minPreview = 260;
      minWorkbench = Math.max(320, available - minPreview);
    }
  }
  return {
    minPreview: minPreview,
    minWorkbench: minWorkbench
  };
}

function clearWorkspaceSplitLayout() {
  var resizerEl = getWorkspaceSplitResizerEl();
  if (resizerEl) {
    resizerEl.classList.add('hidden');
  }
}

function updateWorkspaceSplitResizerPosition() {
  var resizerEl = getWorkspaceSplitResizerEl();
  if (!resizerEl || !ui || !ui.appEl) return;
  var previewPanel = ui.appEl.querySelector('.preview-panel');
  var workbenchPanel = ui.appEl.querySelector('.workbench-panel');
  if (!previewPanel || !workbenchPanel || !isWorkspaceSplitDesktopLayout()) {
    resizerEl.classList.add('hidden');
    return;
  }
  if (ui.appEl.classList.contains('workspace-view-grid') || ui.appEl.classList.contains('workspace-view-focus')) {
    resizerEl.classList.add('hidden');
    return;
  }
  if (resizerEl.parentNode !== previewPanel) {
    previewPanel.appendChild(resizerEl);
  }
  resizerEl.classList.remove('hidden');
}

function updateWorkspaceSplitLayout() {
  clearWorkspaceSplitLayout();
}

function stopWorkspaceSplitDrag() {
  if (!workspaceSplitState.dragging) return;
  workspaceSplitState.dragging = false;
  if (ui && ui.appEl) {
    ui.appEl.classList.remove('workspace-resizing');
  }
  if (workspaceSplitState.moveHandler) {
    window.removeEventListener('mousemove', workspaceSplitState.moveHandler);
  }
  if (workspaceSplitState.upHandler) {
    window.removeEventListener('mouseup', workspaceSplitState.upHandler);
  }
  storeWorkspaceSplitRatio(workspaceSplitState.ratio);
}

function beginWorkspaceSplitDrag(event) {
  if (!isWorkspaceSplitDesktopLayout() || event.button !== 0 || !ui || !ui.appEl) return;
  event.preventDefault();
  workspaceSplitState.dragging = true;
  ui.appEl.classList.add('workspace-resizing');
  workspaceSplitState.moveHandler = function (moveEvent) {
    if (!workspaceSplitState.dragging || !ui || !ui.appEl) return;
    var previewPanel = ui.appEl.querySelector('.preview-panel');
    var workbenchPanel = ui.appEl.querySelector('.workbench-panel');
    if (!previewPanel || !workbenchPanel) return;
    var previewRect = previewPanel.getBoundingClientRect();
    var workbenchRect = workbenchPanel.getBoundingClientRect();
    var gap = Math.max(0, workbenchRect.left - previewRect.right);
    var available = Math.max(0, previewRect.width + workbenchRect.width);
    var bounds = getWorkspaceSplitBounds(available);
    var rawPreviewWidth = moveEvent.clientX - previewRect.left - (gap / 2);
    workspaceSplitState.ratio = clampWorkspaceSplitRatio(
      rawPreviewWidth / Math.max(1, available),
      available,
      bounds.minPreview,
      bounds.minWorkbench
    );
    updateWorkspaceSplitLayout();
  };
  workspaceSplitState.upHandler = function () {
    stopWorkspaceSplitDrag();
  };
  window.addEventListener('mousemove', workspaceSplitState.moveHandler);
  window.addEventListener('mouseup', workspaceSplitState.upHandler);
}

function wireWorkspaceSplitUi() {
  clearWorkspaceSplitLayout();
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
    single: document.getElementById('workspace-view-single-btn'),
    grid: document.getElementById('sidebar-open-grid-btn'),
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
  if (value === 'configeditor') return 'configEditor';
  return 'default';
}

function syncWorkspaceConfigEditorUi() {
  var toolbar = document.getElementById('config-editor-toolbar');
  var fileLabel = document.getElementById('config-editor-current-file');
  var saveBtn = document.getElementById('config-editor-save-btn');
  var generateBtn = document.getElementById('config-editor-generate-btn');
  var trainBtn = document.getElementById('config-editor-train-btn');
  var consoleBtn = document.getElementById('config-editor-console-btn');
  var isConfigEditor = normalizeWorkspaceSurface(workspaceState.surface) === 'configEditor';
  var hasConfigFile = !!(state && state.currentConfigFile && state.currentConfigFile.file);
  var consoleVisible = !!(ui && ui.consolePanelEl && ui.consolePanelEl.style.display && ui.consolePanelEl.style.display !== 'none');
  if (toolbar) {
    toolbar.classList.toggle('hidden', !isConfigEditor);
  }
  if (fileLabel) {
    fileLabel.textContent = hasConfigFile
      ? state.currentConfigFile.file
      : 'No config selected.';
  }
  if (saveBtn) {
    saveBtn.disabled = !isConfigEditor || !hasConfigFile;
  }
  if (generateBtn) {
    generateBtn.disabled = !isConfigEditor || !hasConfigFile;
  }
  if (trainBtn) {
    trainBtn.disabled = !isConfigEditor || !hasConfigFile;
  }
  if (consoleBtn) {
    consoleBtn.disabled = !isConfigEditor;
    consoleBtn.classList.toggle('active', consoleVisible);
    consoleBtn.setAttribute('aria-pressed', consoleVisible ? 'true' : 'false');
  }
}

function syncWorkspaceSurfaceUi() {
  if (!ui || !ui.appEl) return;
  var surface = normalizeWorkspaceSurface(workspaceState.surface);
  var reviewOutputSurface = document.getElementById('review-output-surface');
  var reviewOutputBtn = document.getElementById('sidebar-open-review-output-btn');
  var reviewOutputBackBtn = document.getElementById('review-output-back-btn');
  var workbenchTop = ui.appEl.querySelector('.workbench-top');
  var workbenchBottom = ui.appEl.querySelector('.workbench-bottom');
  var sidebarWorkspace = document.getElementById('sidebar-workspace');

  ui.appEl.classList.remove(
    'workspace-surface-default',
    'workspace-surface-grid',
    'workspace-surface-focus',
    'workspace-surface-review-output',
    'workspace-surface-config-editor'
  );
  ui.appEl.classList.add('workspace-surface-' + surface.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); }));
  ui.appEl.classList.toggle('sidebar-hidden', !!workspaceState.sidebarHidden);

  if (reviewOutputSurface) {
    reviewOutputSurface.classList.toggle('hidden', surface !== 'reviewOutput');
  }
  if (workbenchTop) {
    workbenchTop.classList.toggle('hidden', surface === 'reviewOutput' || surface === 'configEditor');
  }
  if (workbenchBottom) {
    workbenchBottom.classList.toggle('workspace-bottom-config-editor', surface === 'configEditor');
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
  if (reviewOutputBackBtn) {
    reviewOutputBackBtn.classList.toggle('hidden', surface !== 'reviewOutput');
  }
  syncWorkspaceConfigEditorUi();
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
  if (nextSurface === 'grid') {
    setWorkspaceViewMode('grid');
  } else if (nextSurface === 'focus') {
    setWorkspaceViewMode('focus');
  } else {
    setWorkspaceViewMode('single');
  }
  syncWorkspaceSurfaceUi();
}

function exitWorkspaceSurface(surfaceOverride) {
  var targetSurface = surfaceOverride ? normalizeWorkspaceSurface(surfaceOverride) : normalizeWorkspaceSurface(workspaceState.previousSurface);
  if (targetSurface === 'grid' || targetSurface === 'focus') {
    targetSurface = 'default';
  }
  setWorkspaceSurface(targetSurface || 'default', { skipRemember: true });
}

function ensureWorkspaceHeaderButton(id, label) {
  var existing = document.getElementById(id);
  if (existing) return existing;
  var btn = document.createElement('button');
  btn.id = id;
  btn.type = 'button';
  btn.className = 'app-header-segment-btn';
  btn.textContent = label;
  return btn;
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

function buildSidebarDrawer(title, className) {
  var details = document.createElement('details');
  details.className = 'sidebar-drawer ' + className;
  var summary = document.createElement('summary');
  summary.className = 'sidebar-drawer-summary';
  summary.textContent = title;
  details.appendChild(summary);
  var body = document.createElement('div');
  body.className = 'sidebar-drawer-body';
  details.appendChild(body);
  details._body = body;
  return details;
}

function moveChildren(sourceEl, targetEl) {
  while (sourceEl && sourceEl.firstChild) {
    targetEl.appendChild(sourceEl.firstChild);
  }
}

function rebuildUnifiedWorkspaceShell() {
  if (!ui || !ui.appEl || ui.appEl.__workspaceRevampBuilt) return;
  var appEl = ui.appEl;
  var utilityThemeBtn = document.getElementById('utility-theme-btn');
  appEl.__workspaceRevampBuilt = true;
  appEl.classList.add('shell-revamp');
  if (utilityThemeBtn) {
    utilityThemeBtn.classList.add('hidden');
    utilityThemeBtn.tabIndex = -1;
  }

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
  var singleBtn = document.getElementById('workspace-view-single-btn');
  if (singleBtn && !singleBtn.__workspaceWired) {
    singleBtn.__workspaceWired = true;
    singleBtn.onclick = function () {
      if (typeof isFocusedAnnotationOpen === 'function' && isFocusedAnnotationOpen()) {
        closeFocusedAnnotationModal();
      }
      if (typeof closeMediaGridModal === 'function' && typeof mediaGridState !== 'undefined' && mediaGridState.open) {
        closeMediaGridModal();
      }
      setWorkspaceViewMode('single');
    };
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
  var configEditorBackBtn = document.getElementById('config-editor-back-btn');
  if (configEditorBackBtn && !configEditorBackBtn.__workspaceWired) {
    configEditorBackBtn.__workspaceWired = true;
    configEditorBackBtn.onclick = function () {
      exitWorkspaceSurface();
    };
  }
  var configEditorSaveBtn = document.getElementById('config-editor-save-btn');
  if (configEditorSaveBtn && !configEditorSaveBtn.__workspaceWired) {
    configEditorSaveBtn.__workspaceWired = true;
    configEditorSaveBtn.onclick = function () {
      saveCurrentEditorContent();
    };
  }
  var configEditorConsoleBtn = document.getElementById('config-editor-console-btn');
  if (configEditorConsoleBtn && !configEditorConsoleBtn.__workspaceWired) {
    configEditorConsoleBtn.__workspaceWired = true;
    configEditorConsoleBtn.onclick = function () {
      if (typeof toggleConsolePanel === 'function') {
        toggleConsolePanel();
      }
      syncWorkspaceConfigEditorUi();
    };
  }
  var configEditorGenerateBtn = document.getElementById('config-editor-generate-btn');
  if (configEditorGenerateBtn && !configEditorGenerateBtn.__workspaceWired) {
    configEditorGenerateBtn.__workspaceWired = true;
    configEditorGenerateBtn.onclick = function () {
      if (!(state && state.currentConfigFile && state.currentConfigFile.file)) {
        setStatus('No config selected.');
        return;
      }
      var currentFile = state.currentConfigFile.file;
      Promise.resolve(saveCurrentEditorContent())
        .then(function () {
          return runGenerateDatasetConfigsForCurrentFolder(function () {
            refreshTrainingConfigList();
            setStatus('Dataset configs generated. Reloading ' + currentFile + '...');
          });
        })
        .then(function () {
          if (typeof loadConfigFileToEditor === 'function') {
            loadConfigFileToEditor(currentFile);
          }
        })
        .catch(function (err) {
          if (window.console && console.error) {
            console.error('[Config Editor] Generate failed:', err);
          }
        });
    };
  }
  var configEditorTrainBtn = document.getElementById('config-editor-train-btn');
  if (configEditorTrainBtn && !configEditorTrainBtn.__workspaceWired) {
    configEditorTrainBtn.__workspaceWired = true;
    configEditorTrainBtn.onclick = function () {
      if (!(state && state.currentConfigFile && state.currentConfigFile.file)) {
        setStatus('No config selected.');
        return;
      }
      Promise.resolve(saveCurrentEditorContent())
        .then(function () {
          if (typeof showConsolePanel === 'function') {
            showConsolePanel();
          }
          syncWorkspaceConfigEditorUi();
          return runTrainCommandPreviewForCurrentFolder();
        })
        .catch(function (err) {
          if (window.console && console.error) {
            console.error('[Config Editor] Train preview failed:', err);
          }
        });
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
      doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:system-ui;padding:1rem;color:#666;">No media to preview.</body></html>');
      doc.close();
    }
  }
  var checklistPanelEl = document.getElementById('caption-checklist-panel');
  if (checklistPanelEl) checklistPanelEl.style.display = 'none';
  state.currentItem = null;
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

function createFlagAction(itemKey) {
  function flagRowRenderer(color) {
    markFlag(itemKey, color);
  }

  return {
    label: 'Flag',
    render: flagRowRenderer
  };
}

function ensureFolderSelected(missingStatus) {
  if (state.folder) return true;
  setStatus(missingStatus || 'No folder selected.');
  return false;
}

function resetSelectionForFolderAction() {
  state.currentConfigFile = null;
  state.currentItem = null;
  clearEditorAndPreview();
  renderChecklistPanel();
  renderFileList(ui.filterEl.value);
}

function runTrainingActionRequest(url, body, options) {
  function getOutputErrorMessage(outputText) {
    var lines = String(outputText || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i += 1) {
      var line = String(lines[i] || '').trim();
      if (line.indexOf('[ERROR]') === 0) {
        return line.replace(/^\[ERROR\]\s*/, '') || line;
      }
    }
    return '';
  }

  return new Promise(function (resolve, reject) {
    var runner = options && options.fetchText ? fetchPreviewText : streamPreviewFromFetch;
    runner(
      url,
      body,
      ui,
      function (outputText) {
        var errorMessage = getOutputErrorMessage(outputText);
        if (errorMessage) {
          reject(new Error(errorMessage));
          return;
        }
        resolve(String(outputText || ''));
      },
      function (err) {
        reject(err instanceof Error ? err : new Error(String(err || 'Request failed')));
      }
    );
  });
}

function formatTrainingActionErrorMessage(err) {
  return String(err && err.message ? err.message : err).replace(/^\[ERROR\]\s*/, '').trim();
}

function buildCurrentFolderRelativePath(pathSuffix) {
  var folder = String(state.folder || '').replace(/[\\/]+$/, '');
  var suffix = String(pathSuffix || '').replace(/^[\\/]+/, '');
  if (!folder) return suffix;
  if (!suffix) return folder;
  return folder + '/' + suffix;
}

function fetchPathExistsForCurrentFolder(pathSuffix) {
  return fetch('/fs/path_exists?path=' + encodeURIComponent(buildCurrentFolderRelativePath(pathSuffix)))
    .then(function (resp) {
      return resp.json().then(function (data) {
        return { status: resp.status, data: data };
      });
    })
    .then(function (res) {
      if (res.status !== 200 || !res.data || !res.data.ok) {
        throw new Error((res.data && res.data.error) ? res.data.error : 'Path existence check failed');
      }
      return !!res.data.exists;
    });
}

function getVisibleMediaSelectionForPrepare() {
  var visibleRows = Array.prototype.slice.call(
    ui.mediaListEl ? ui.mediaListEl.querySelectorAll('.media-item[data-type="media"]') : []
  );
  return visibleRows
    .map(function (row) { return String(row.getAttribute('data-key') || '').trim(); })
    .filter(Boolean);
}

function buildPrepareFallbackCaptions(selectedMedia) {
  var selectedKeys = Array.isArray(selectedMedia) ? selectedMedia : [];
  var byKey = {};
  var fallbackCaptions = {};
  var fallbackCount = 0;
  (state.items || []).forEach(function (item) {
    if (item && item.key) byKey[item.key] = item;
  });
  selectedKeys.forEach(function (key) {
    var item = byKey[key];
    if (!item || !item.fileName) return;
    var hasCaption = !!(item.hasCaption || String(item.caption || '').trim().length);
    if (hasCaption) return;
    var primerText = String(buildAutoPrimer(item.fileName, item.key) || '').trim();
    if (!primerText) return;
    fallbackCaptions[item.fileName] = primerText;
    fallbackCount += 1;
  });
  return {
    fallbackCaptions: fallbackCaptions,
    fallbackCount: fallbackCount
  };
}

function buildPrepareSelectionCriteria() {
  var starsValue = (typeof getAdvancedStarFilterValue === 'function') ? getAdvancedStarFilterValue() : '';
  var flagValue = (typeof getAdvancedFlagFilterValue === 'function') ? getAdvancedFlagFilterValue() : '';
  return {
    source_folder: String(state.folder || ''),
    filter_text: String((ui.filterEl && ui.filterEl.value) || '').trim(),
    missing_captions_only: !!(ui.advancedFilterMissingCaptionsEl && ui.advancedFilterMissingCaptionsEl.checked),
    reviewed_only: !!(ui.advancedFilterReviewedEl && ui.advancedFilterReviewedEl.checked),
    unreviewed_only: !!(ui.advancedFilterUnreviewedEl && ui.advancedFilterUnreviewedEl.checked),
    incomplete_only: !!(ui.advancedFilterIncompleteEl && ui.advancedFilterIncompleteEl.checked),
    tag_mismatch_only: !!(ui.advancedFilterUntaggedEl && ui.advancedFilterUntaggedEl.checked),
    text_match_mode: 'all',
    invalid_ar_only: !!(ui.advancedFilterInvalidArEl && ui.advancedFilterInvalidArEl.checked),
    min_stars_gt: '',
    star_filter: String(starsValue || ''),
    flag_filter: String(flagValue || ''),
    focus_set_active: !!(state.focusSet && state.focusSet.keys && state.focusSet.keys.length),
    focus_set_source: String((state.focusSet && state.focusSet.source) || ''),
  };
}

function ensurePrepManifestForCurrentFolder() {
  return fetchPathExistsForCurrentFolder('auto_dataset/prep_manifest.json')
    .then(function (exists) {
      if (exists) return '';
      return runPrepareDatasetForCurrentFolder();
    });
}

function ensureGeneratedTrainingArtifactsForCurrentFolder() {
  return Promise.all([
    fetchPathExistsForCurrentFolder('config.hi.toml'),
    fetchPathExistsForCurrentFolder('config.lo.toml'),
    fetchPathExistsForCurrentFolder('dataset.hi.toml'),
    fetchPathExistsForCurrentFolder('dataset.lo.toml')
  ]).then(function (results) {
    var ready = results.every(function (value) { return !!value; });
    if (ready) return '';
    return runGenerateDatasetConfigsForCurrentFolder();
  });
}

function runGenerateDatasetConfigsForCurrentFolder(onSuccess) {
  if (!ensureFolderSelected('No folder selected for config generation.')) {
    return Promise.reject(new Error('No folder selected for config generation.'));
  }
  return ensurePrepManifestForCurrentFolder()
    .then(function () {
      resetSelectionForFolderAction();
      setStatus('Generating dataset configs...');
      return runTrainingActionRequest('/fs/generate_dataset_config', { folder: state.folder });
    })
    .then(function (outputText) {
      if (typeof onSuccess === 'function') {
        onSuccess(outputText);
      } else {
        setStatus('Dataset configs generated.');
      }
      return outputText;
    })
    .catch(function (err) {
      var message = formatTrainingActionErrorMessage(err);
      setStatus('Dataset config generation failed: ' + message);
      throw err;
    });
}

function runPrepareDatasetForCurrentFolder() {
  if (!ensureFolderSelected('No folder selected for dataset preparation.')) {
    return Promise.reject(new Error('No folder selected for dataset preparation.'));
  }
  var selectedMedia = getVisibleMediaSelectionForPrepare();
  var totalMediaCount = Array.isArray(state.items) ? state.items.length : 0;
  if (!selectedMedia.length) {
    setStatus('No visible media items to prepare.');
    return Promise.reject(new Error('No visible media items to prepare.'));
  }
  var criteria = buildPrepareSelectionCriteria();
  var fallbackResult = buildPrepareFallbackCaptions(selectedMedia);
  resetSelectionForFolderAction();
  if (totalMediaCount > 0 && selectedMedia.length < totalMediaCount) {
    setStatus('Preparing visible subset: ' + selectedMedia.length + ' of ' + totalMediaCount + ' media items...');
  } else {
    setStatus('Preparing dataset...');
  }
  return runTrainingActionRequest('/fs/prepare_dataset', {
    folder: state.folder,
    selected_media: selectedMedia,
    total_media_count: totalMediaCount,
    selection_criteria: criteria,
    fallback_captions: fallbackResult.fallbackCaptions
  }).then(function (outputText) {
      if (fallbackResult.fallbackCount > 0) {
        setStatus('Dataset preparation finished. Primer fallbacks used: ' + fallbackResult.fallbackCount + '.');
      } else {
        setStatus('Dataset preparation finished.');
      }
      refreshTrainingConfigList();
      return outputText;
    })
    .catch(function (err) {
      var message = formatTrainingActionErrorMessage(err);
      setStatus('Dataset preparation failed: ' + message);
      throw err;
    });
}

function runTrainCommandPreviewForCurrentFolder() {
  if (!ensureFolderSelected('No folder selected for training.')) {
    return Promise.reject(new Error('No folder selected for training.'));
  }
  return ensureGeneratedTrainingArtifactsForCurrentFolder()
    .then(function () {
      setStatus('Printing training commands...');
      return runTrainingActionRequest('/fs/train_run', { folder: state.folder }, { fetchText: true });
    })
    .then(function (outputText) {
      var chainCmd = extractTrainingChainCommand(outputText);
      if (!chainCmd) {
        setStatus('Training command preview finished.');
        return outputText;
      }
      return new Promise(function (resolve, reject) {
        copyTextToClipboard(
          chainCmd,
          function () {
            setStatus('Training command preview finished. Chained HI;LO command copied to clipboard.');
            resolve(outputText);
          },
          function () {
            setStatus('Training command preview finished. Auto-copy failed; copy command from console.');
            resolve(outputText);
          }
        );
      });
    })
    .catch(function (err) {
      var message = formatTrainingActionErrorMessage(err);
      setStatus('Training command preview failed: ' + message);
      throw err;
    });
}

function isEditableElement(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  var tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

function moveSelectedMediaByOffset(offset) {
  if (!offset || !state.currentItem || !state.currentItem.fileName || !ui.mediaListEl) {
    return false;
  }
  var rows = Array.prototype.slice.call(
    ui.mediaListEl.querySelectorAll('.media-item[data-type="media"]')
  );
  if (!rows.length) {
    return false;
  }
  var currentKey = state.currentItem.key;
  var idx = rows.findIndex(function (row) {
    return row.getAttribute('data-key') === currentKey;
  });
  if (idx === -1) {
    return false;
  }
  var nextIdx = idx + offset;
  if (nextIdx < 0 || nextIdx >= rows.length) {
    return false;
  }
  var nextKey = rows[nextIdx].getAttribute('data-key');
  if (!nextKey || nextKey === currentKey) {
    return false;
  }
  var nextItem = state.items.find(function (item) {
    return item && item.key === nextKey;
  });
  if (!nextItem) {
    return false;
  }

  var goNext = function () {
    selectPathMedia(nextItem).catch(function (err) {
      setStatus(String(err && err.message ? err.message : err));
    });
  };
  if (state.currentItem && state.currentItem.fileName) {
    savePathCaption().then(goNext).catch(function (err) {
      setStatus(String(err && err.message ? err.message : err));
    });
  } else {
    goNext();
  }
  return true;
}

var sidebarActiveTab = 'review';

function setSidebarTab(tabName) {
  var sidebarWorkspace = document.getElementById('sidebar-workspace');
  if (sidebarWorkspace && sidebarWorkspace.getAttribute('data-legacy-tabs-disabled') === 'true') {
    return;
  }
  var tabs = {
    review: { buttonId: 'sidebar-tab-review-btn', paneId: 'cation-review' },
    train: { buttonId: 'sidebar-tab-train-btn', paneId: 'training-details' }
  };
  var activeName = tabs[tabName] ? tabName : 'review';
  sidebarActiveTab = activeName;

  Object.keys(tabs).forEach(function (name) {
    var tab = tabs[name];
    var btn = document.getElementById(tab.buttonId);
    var pane = document.getElementById(tab.paneId);
    var active = name === activeName;
    if (btn) {
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
    }
    if (pane) {
      pane.classList.toggle('hidden', !active);
      pane.setAttribute('aria-hidden', active ? 'false' : 'true');
    }
  });
}

function wireSidebarTabs() {
  var sidebarWorkspace = document.getElementById('sidebar-workspace');
  if (sidebarWorkspace && sidebarWorkspace.getAttribute('data-legacy-tabs-disabled') === 'true') {
    return;
  }
  var buttons = document.querySelectorAll('[data-sidebar-tab]');
  if (!buttons.length) return;
  Array.prototype.forEach.call(buttons, function (btn) {
    btn.onclick = function () {
      setSidebarTab(btn.getAttribute('data-sidebar-tab'));
    };
  });
  setSidebarTab(sidebarActiveTab);
}

function wireAllUi() {
  // Autosaving of primer/stats changes (debounced)
  wireStatsPrimerAutoSave();
  if (typeof wirePrimerCaptionResetUi === 'function') {
    wirePrimerCaptionResetUi();
  }
  if (typeof wireStatsBalancePhraseUi === 'function') {
    wireStatsBalancePhraseUi();
  }

  // Wire up review actions (if stats.js is loaded)
  wireReviewActions();
  
  // Wire up CTRL+S/CMD+S to new save logic
  ui.editorEl.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      saveCurrentEditorContent();
    }
  });

  checklistPanelEl = document.getElementById('caption-checklist-panel');
  setChecklistPanelVisible(false);
  wireCaptionHelpersUi();
  wireItemDetailsUi();
  if (typeof wirePreviewActionControls === 'function') {
    wirePreviewActionControls();
  }
  if (typeof updatePreviewActionControls === 'function') {
    updatePreviewActionControls();
  }
  wireSidebarTabs();
  if (typeof wireAppSettingsUi === 'function') {
    wireAppSettingsUi();
  }
  var addInput = document.getElementById('checklist-add-input');
  var addBtn = document.getElementById('checklist-add-btn');
  if (addBtn && addInput) {
    addBtn.onclick = function() {
      var val = addInput.value.trim();
      if (!val || checklistItems.indexOf(val) !== -1) return;
      checklistItems.push(val);
      for (var k in checklistCheckedByMedia) {
        if (checklistCheckedByMedia[k]) checklistCheckedByMedia[k][val] = false;
      }
      syncReviewedFromChecklistAll();
      saveChecklistToFolderState();
      renderChecklistPanel();
      addInput.value = '';
    };
    addInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') addBtn.onclick();
    });
  }

  function closeChecklistPanel() {
    if (typeof setChecklistPanelVisible === 'function') {
      setChecklistPanelVisible(false);
    } else if (checklistPanelEl) {
      checklistPanelEl.style.display = 'none';
    }
    if (typeof renderAnnotateStrip === 'function') {
      renderAnnotateStrip();
    }
  }

  var closeBtn = document.getElementById('checklist-close-btn');
  if (closeBtn) {
    closeBtn.onclick = function() {
      closeChecklistPanel();
    };
  }
  var closeInlineBtn = document.getElementById('checklist-close-inline-btn');
  if (closeInlineBtn) {
    closeInlineBtn.onclick = function() {
      closeChecklistPanel();
    };
  }

  ui.editorEl.addEventListener('input', handleEditorInputAutosave);

  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.altKey || e.shiftKey) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    if (String(e.key || '').toLowerCase() !== 'z') return;
    if (isEditableElement(document.activeElement)) return;
    if (typeof undoLastOperation !== 'function') return;
    e.preventDefault();
    undoLastOperation();
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'F2' && document.activeElement !== ui.editorEl && state.currentItem) {
      var inOriginals = state.folder && state.folder.split(/[\/]/).pop() === 'originals';
      if (!inOriginals) {
        e.preventDefault();
        promptRenameMedia(state.currentItem);
      }
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (!state.currentItem || !state.currentItem.fileName) return;
    if (isEditableElement(document.activeElement)) return;
    var handled = moveSelectedMediaByOffset(e.key === 'ArrowUp' ? -1 : 1);
    if (handled) {
      e.preventDefault();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'Delete') return;
    if (!state.currentItem || !state.currentItem.fileName) return;
    if (isEditableElement(document.activeElement)) return;
    var inOriginals = state.folder && state.folder.split(/[\/]/).pop() === 'originals';
    if (inOriginals) return;
    e.preventDefault();
    pruneMedia(state.currentItem).catch(function (err) {
      setStatus(String(err && err.message ? err.message : err));
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (!state.currentItem || !state.currentItem.fileName) return;
    if (isEditableElement(document.activeElement)) return;
    if (!/^[0-5]$/.test(e.key)) return;
    if (typeof setRatingForMediaKey !== 'function') return;
    e.preventDefault();
    var rating = Number(e.key);
    setRatingForMediaKey(state.currentItem.key, rating);
    if (rating <= 0) {
      setStatus('Rating cleared');
      return;
    }
    setStatus('Rating set: ' + rating + ' stars');
  });
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (!state.currentItem || !state.currentItem.fileName) return;
    if (isEditableElement(document.activeElement)) return;
    if (typeof markFlag !== 'function') return;
    var key = String(e.key || '').toLowerCase();
    var colorByKey = {
      g: 'green',
      y: 'yellow',
      o: 'orange',
      b: 'blue',
      r: 'red'
    };
    var color = colorByKey[key];
    if (!color) return;
    e.preventDefault();
    markFlag(state.currentItem.key, color);
    setStatus('Flag set: ' + color);
  });

  if (ui.advancedFilterToggleBtn && ui.advancedFilterPanel) {
    ui.advancedFilterToggleBtn.onclick = function () {
      var isHidden = ui.advancedFilterPanel.classList.contains('hidden');
      ui.advancedFilterPanel.classList.toggle('hidden', !isHidden);
      ui.advancedFilterToggleBtn.classList.toggle('expanded', isHidden);
      ui.advancedFilterToggleBtn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
      saveFolderStateForCurrentRoot();
    };
  }

  if (typeof wireMainUiEvents === 'function') {
    wireMainUiEvents();
  }

}

addEventListener('DOMContentLoaded', function () {
  console.log('[webcap] initializing');
  rebuildUnifiedWorkspaceShell();
  wireWorkspaceHeaderUi();
  refreshCurrentDirectory();
  wireAllUi();
});
