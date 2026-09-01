var mediaGridState = {
  open: false,
  items: [],
  baseItems: [],
  pruning: false,
  selectedKeys: new Set(),
  lastSelectedKey: '',
  status: '',
  viewerKey: '',
  previousWorkspaceState: null
};

function mediaGridGetViewerEls() {
  return {
    viewerModal: document.getElementById('media-grid-viewer-modal'),
    viewerTitle: document.getElementById('media-grid-viewer-title'),
    viewerTitleName: document.getElementById('media-grid-viewer-title-name'),
    viewerTitleCaption: document.getElementById('media-grid-viewer-title-caption'),
    viewerStage: document.getElementById('media-grid-viewer-stage'),
    viewerCloseBtn: document.getElementById('media-grid-viewer-close-btn')
  };
}

function mediaGridGetSurfaceEls() {
  return {
    surface: document.getElementById('media-grid-surface'),
    header: document.getElementById('media-grid-surface-header'),
    meta: document.getElementById('media-grid-surface-meta'),
    status: document.getElementById('media-grid-surface-status'),
    canvas: document.getElementById('media-grid-surface-canvas'),
    selectAllBtn: document.getElementById('media-grid-surface-select-all-btn'),
    clearBtn: document.getElementById('media-grid-surface-clear-btn'),
    closeBtn: document.getElementById('media-grid-surface-close-btn')
  };
}

function mediaGridGetActiveCanvasEl() {
  return mediaGridGetSurfaceEls().canvas;
}

function mediaGridBuildSurfaceMetaText() {
  var selectedCount = mediaGridState.selectedKeys.size;
  var totalCount = mediaGridState.items.length;
  var sourceLabel = mediaGridGetSourceLabel();
  var bits = [mediaGridGetFolderName()];
  if (sourceLabel !== 'Current Folder') {
    bits.push(sourceLabel);
  }
  bits.push(totalCount + ' item' + (totalCount === 1 ? '' : 's'));
  bits.push(selectedCount + ' selected');
  return bits.join(' - ');
}

function mediaGridResetSessionState() {
  mediaGridState.open = false;
  mediaGridState.items = [];
  mediaGridState.baseItems = [];
  mediaGridState.pruning = false;
  mediaGridState.selectedKeys = new Set();
  mediaGridState.lastSelectedKey = '';
  mediaGridState.status = '';
  mediaGridState.viewerKey = '';
  mediaGridState.previousWorkspaceState = null;
}

function mediaGridBeginSession() {
  mediaGridState.open = true;
  mediaGridState.pruning = false;
  mediaGridState.selectedKeys = new Set();
  mediaGridState.lastSelectedKey = '';
  mediaGridState.status = '';
}

function mediaGridHideSurfaceShell() {
  var surfaceEls = mediaGridGetSurfaceEls();
  if (surfaceEls.surface) {
    surfaceEls.surface.classList.add('hidden');
    surfaceEls.surface.setAttribute('aria-hidden', 'true');
  }
}

function mediaGridCaptureWorkspaceState() {
  if (mediaGridState.previousWorkspaceState) return;
  mediaGridState.previousWorkspaceState = {
    surface: typeof workspaceState !== 'undefined' && workspaceState ? workspaceState.surface : 'default',
    workflowMode: typeof workspaceUiState !== 'undefined' && workspaceUiState ? workspaceUiState.workflowMode : 'annotate',
    sidebarCollapsed: !!(ui && ui.appEl && ui.appEl.classList.contains('left-rail-collapsed'))
  };
}

function mediaGridRestoreItemWorkspace(previousWorkspaceState) {
  var restoreState = previousWorkspaceState || mediaGridState.previousWorkspaceState || {};
  var restoreSurface = restoreState.surface || 'default';
  if (restoreSurface === 'grid') restoreSurface = 'default';
  if (typeof setWorkspaceSurface === 'function') {
    setWorkspaceSurface(restoreSurface, { skipRemember: true, sidebarHidden: restoreSurface === 'focus' });
  } else if (typeof setWorkspaceViewMode === 'function') {
    setWorkspaceViewMode('single');
  }
  if (typeof setSidebarCollapsed === 'function') {
    setSidebarCollapsed(!!restoreState.sidebarCollapsed);
  }
  if (typeof setWorkspaceWorkflowMode === 'function') {
    setWorkspaceWorkflowMode(restoreState.workflowMode || 'annotate');
  }
  if (typeof requestWorkspaceWorkbenchRefresh === 'function') {
    requestWorkspaceWorkbenchRefresh();
  } else if (typeof renderChecklistPanel === 'function') {
    renderChecklistPanel();
  }
  if (typeof renderPreviewHeaderMeta === 'function') {
    renderPreviewHeaderMeta();
  }
}

function mediaGridEnsureMainWorkbenchVisible() {
  var checklistPanel = document.getElementById('caption-checklist-panel');
  if (checklistPanel) {
    checklistPanel.style.display = 'flex';
  }
  var editorPanel = checklistPanel ? checklistPanel.closest('.editor-panel') : null;
  if (editorPanel) {
    editorPanel.classList.add('checklist-visible');
  }
}

function mediaGridCloseActivePresentation() {
  if (!mediaGridState.open) return false;
  closeMediaGridSurface();
  return true;
}

function mediaGridSetStatus(text) {
  mediaGridState.status = String(text || '');
  var surfaceEls = mediaGridGetSurfaceEls();
  if (surfaceEls.status) {
    surfaceEls.status.textContent = mediaGridState.status;
    surfaceEls.status.classList.toggle('hidden', !mediaGridState.status);
  }
}

function mediaGridGetVisibleItems() {
  return getFilteredMediaItems(false).filter(function (item) {
    return !!(item && item.key && item.fileName);
  });
}

function mediaGridGetSourceLabel() {
  if (state.focusSet && state.focusSet.keys && state.focusSet.keys.length) {
    return String(state.focusSet.source || 'Focus Set');
  }
  if (hasAnyActiveMediaFilter()) return 'Filtered View';
  return 'Current Folder';
}

function mediaGridGetFolderName() {
  var folder = String(state.folder || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!folder) return 'Root';
  return folder.split('/').pop();
}

function mediaGridGetSelectedItems() {
  return mediaGridState.items.filter(function (item) {
    return mediaGridState.selectedKeys.has(item.key);
  });
}

function mediaGridIsVideoFile(fileName) {
  var ext = String(fileName || '').split('.').pop().toLowerCase();
  return ['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi', 'm4v'].indexOf(ext) !== -1;
}

function mediaGridMediaUrl(mediaItem) {
  var url = '/caption/media?folder=' + encodeURIComponent(state.folder || '') +
    '&media=' + encodeURIComponent(mediaItem.fileName);
  var cacheBust = getMediaCacheBustToken(mediaItem.key || mediaItem.fileName);
  if (cacheBust) {
    url += '&t=' + encodeURIComponent(cacheBust);
  }
  return url;
}

function mediaGridPruneSelectionToItems(items) {
  var keep = {};
  (items || []).forEach(function (item) {
    keep[item.key] = true;
  });
  Array.from(mediaGridState.selectedKeys).forEach(function (key) {
    if (!keep[key]) mediaGridState.selectedKeys.delete(key);
  });
  if (mediaGridState.lastSelectedKey && !keep[mediaGridState.lastSelectedKey]) {
    mediaGridState.lastSelectedKey = '';
  }
  if (mediaGridState.viewerKey && !keep[mediaGridState.viewerKey]) {
    closeMediaGridViewer();
  }
}

function mediaGridSyncItemsToCurrentView() {
  var items = mediaGridGetVisibleItems();
  mediaGridState.baseItems = items;
  mediaGridPruneSelectionToItems(items);
  mediaGridState.items = items;
}

function mediaGridSeedSelectionFromCurrentItem() {
  var currentKey = state && state.currentItem && state.currentItem.key
    ? String(state.currentItem.key)
    : '';
  if (!currentKey) return;
  for (var i = 0; i < mediaGridState.items.length; i++) {
    if (mediaGridState.items[i] && mediaGridState.items[i].key === currentKey) {
      mediaGridState.selectedKeys = new Set([currentKey]);
      mediaGridState.lastSelectedKey = currentKey;
      return;
    }
  }
}
