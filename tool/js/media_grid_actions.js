function mediaGridCreateEntryButton() {
  var btn = document.getElementById('media-grid-open-btn');
  if (!btn) throw new Error('Media Grid entry target is missing.');
  btn.onclick = openMediaGridSurface;
  if (ui.focusSetGridBtn) {
    ui.focusSetGridBtn.onclick = openMediaGridSurface;
  }
  mediaGridUpdateEntryVisibility();
}

function mediaGridUpdateEntryVisibility() {
  var btn = document.getElementById('media-grid-open-btn');
  var focusBtn = document.getElementById('focus-set-grid-btn');
  var hasVisibleMedia = mediaGridGetVisibleItems().length > 0;
  var hasFocusSet = !!(state && state.focusSet && state.focusSet.keys && state.focusSet.keys.length);
  if (btn) {
    btn.classList.toggle('hidden', !hasVisibleMedia || hasFocusSet);
  }
  if (focusBtn) {
    focusBtn.classList.toggle('hidden', !(hasVisibleMedia && hasFocusSet));
  }
  if (typeof renderPreviewHeaderMeta === 'function') {
    renderPreviewHeaderMeta();
  }
}

function mediaGridCreateSurface() {
  if (!document.getElementById('media-grid-surface')) {
    throw new Error('Media Grid surface is missing from tool.html.');
  }
  mediaGridWireSurface();
}

function mediaGridWireSurface() {
  var els = mediaGridGetSurfaceEls();
  if (!els.surface) throw new Error('Media Grid surface is missing.');
  if (els.surface.__wired) return;
  els.surface.__wired = true;
  if (!els.selectAllBtn || !els.clearBtn || !els.closeBtn) {
    throw new Error('Media Grid surface controls are missing.');
  }
  els.selectAllBtn.onclick = mediaGridSelectAll;
  els.clearBtn.onclick = mediaGridClearSelection;
  els.closeBtn.onclick = closeMediaGridSurface;
}


function openMediaGridSurface() {
  var items = mediaGridGetVisibleItems();
  if (!items.length) {
    setStatus('No visible media items for Grid.');
    return;
  }
  var surfaceEls = mediaGridGetSurfaceEls();
  if (!surfaceEls.surface || !surfaceEls.canvas) {
    throw new Error('Media Grid surface is missing its required controls.');
  }
  closeMediaGridViewer();
  mediaGridCaptureWorkspaceState();
  mediaGridBeginSession();
  mediaGridSyncItemsToCurrentView();
  mediaGridSeedSelectionFromCurrentItem();
  mediaGridEnsureMainWorkbenchVisible();
  surfaceEls.surface.classList.remove('hidden');
  surfaceEls.surface.setAttribute('aria-hidden', 'false');
  if (typeof setWorkspaceViewMode === 'function') {
    setWorkspaceViewMode('grid');
  }
  if (typeof setWorkspaceSurface === 'function') {
    setWorkspaceSurface('grid', { sidebarHidden: true });
  }
  if (typeof setWorkspaceWorkflowMode === 'function') {
    setWorkspaceWorkflowMode('select');
  }
  if (typeof renderPreviewHeaderMeta === 'function') {
    renderPreviewHeaderMeta();
  }
  renderMediaGridSurface();
}

function closeMediaGridSurface() {
  closeMediaGridViewer();
  mediaGridHideSurfaceShell();
  var previousWorkspaceState = mediaGridState.previousWorkspaceState;
  mediaGridResetSessionState();
  mediaGridRestoreItemWorkspace(previousWorkspaceState);
}

function renderMediaGridSurface() {
  mediaGridSyncItemsToCurrentView();
  mediaGridEnsureMainWorkbenchVisible();
  renderMediaGridSurfaceHeader();
  renderMediaGridCanvas();
  mediaGridRenderSharedWorkbench();
}

function renderMediaGridSurfaceHeader() {
  var els = mediaGridGetSurfaceEls();
  var selectedCount = mediaGridState.selectedKeys.size;
  var totalCount = mediaGridState.items.length;
  if (!els.meta || !els.status || !els.selectAllBtn || !els.clearBtn) return;
  els.meta.textContent = mediaGridBuildSurfaceMetaText();
  els.meta.title = String(state.folder || 'Root');
  els.status.textContent = mediaGridState.status;
  els.status.classList.toggle('hidden', !mediaGridState.status);
  els.clearBtn.disabled = selectedCount <= 0;
  els.selectAllBtn.disabled = totalCount <= 0 || selectedCount === totalCount;
  mediaGridSyncSurfaceFilterControls();
}


function mediaGridSelectRange(fromKey, toKey) {
  var start = -1;
  var end = -1;
  for (var i = 0; i < mediaGridState.items.length; i++) {
    var key = mediaGridState.items[i].key;
    if (key === fromKey) start = i;
    if (key === toKey) end = i;
  }
  if (start < 0 || end < 0) {
    mediaGridState.selectedKeys.add(toKey);
    return;
  }
  var min = Math.min(start, end);
  var max = Math.max(start, end);
  for (var j = min; j <= max; j++) {
    mediaGridState.selectedKeys.add(mediaGridState.items[j].key);
  }
}

function mediaGridSelectAll() {
  mediaGridState.items.forEach(function (item) {
    mediaGridState.selectedKeys.add(item.key);
  });
  mediaGridState.lastSelectedKey = mediaGridState.items.length ? mediaGridState.items[mediaGridState.items.length - 1].key : '';
  mediaGridSetStatus('Selected all visible Grid items.');
  mediaGridRenderSelectionState();
}

function mediaGridClearSelection() {
  mediaGridState.selectedKeys = new Set();
  mediaGridState.lastSelectedKey = '';
  mediaGridSetStatus('Selection cleared.');
  mediaGridRenderSelectionState();
}

async function mediaGridPruneSelected() {
  var items = mediaGridGetSelectedItems();
  if (!items.length || mediaGridState.pruning) {
    mediaGridSetStatus('Select items before pruning.');
    return;
  }

  var count = items.length;
  var confirmed = confirm(
    'Remove ' + count + ' selected media file' + (count === 1 ? '' : 's') + ' from the current set?\n\n' +
    'Each file can be restored later from originals.'
  );
  if (!confirmed) {
    mediaGridSetStatus('Batch prune cancelled.');
    return;
  }

  mediaGridState.pruning = true;
  mediaGridRenderSelectionState();
  var prunedKeys = {};
  var failedKeys = [];

  for (var i = 0; i < items.length; i += 1) {
    var item = items[i];
    mediaGridSetStatus('Pruning ' + (i + 1) + '/' + count + '...');
    try {
      var response = await fetch('/media/prune', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: state.folder, media: item.key })
      });
      if (!response.ok) {
        failedKeys.push(item.key);
        continue;
      }
      prunedKeys[item.key] = true;
    } catch (err) {
      failedKeys.push(item.key);
    }
  }

  mediaGridState.pruning = false;
  var prunedCount = Object.keys(prunedKeys).length;
  if (prunedCount) {
    var currentWasPruned = !!(state.currentItem && prunedKeys[state.currentItem.key || state.currentItem.fileName]);
    state.items = state.items.filter(function (item) {
      return !prunedKeys[item.key];
    });
    Object.keys(prunedKeys).forEach(function (key) {
      mediaGridState.selectedKeys.delete(key);
    });
    if (currentWasPruned) {
      clearEditorAndPreview();
      renderChecklistPanel();
    }
    renderFileList(ui.filterEl.value);
  }

  var summary = 'Pruned ' + prunedCount + ' of ' + count + ' selected item' + (count === 1 ? '' : 's') + '.';
  if (failedKeys.length) {
    summary += ' ' + failedKeys.length + ' failed and remain selected.';
  }
  mediaGridSetStatus(summary);
  setStatus(summary);
  mediaGridRefreshAfterMutation();
}

function mediaGridApplyRating(rating) {
  var items = mediaGridGetSelectedItems();
  if (!items.length) {
    mediaGridSetStatus('Select items before rating.');
    return;
  }
  items.forEach(function (item, index) {
    mediaGridSetStatus('Rating ' + (index + 1) + '/' + items.length + '...');
    setRatingForMediaKey(item.key, rating);
  });
  mediaGridSetStatus((rating > 0 ? 'Rated' : 'Cleared rating for') + ' ' + items.length + ' item' + (items.length === 1 ? '' : 's') + '.');
  mediaGridRefreshAfterMutation();
}

function mediaGridRefreshAfterMutation() {
  if (!mediaGridState.open) return;
  renderMediaGridSurface();
}

function mediaGridRefreshFromCurrentFilters() {
  if (!mediaGridState.open) return;
  renderMediaGridSurface();
}

function mediaGridHandleKeydown(e) {
  if (!mediaGridState.open) return;
  if (mediaGridState.viewerKey) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMediaGridViewer();
    }
    return;
  }
  if (isEditableElement(document.activeElement)) return;
  if (/^Arrow(?:Up|Down|Left|Right)$/.test(e.key) &&
      document.activeElement && document.activeElement.classList.contains('media-grid-tile')) {
    if (mediaGridMoveSingleSelectionByArrow(e.key)) e.preventDefault();
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    mediaGridCloseActivePresentation();
    return;
  }
  if (e.key === 'Delete') {
    e.preventDefault();
    mediaGridPruneSelected();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
    e.preventDefault();
    mediaGridSelectAll();
    return;
  }
  if (e.key === 'Enter') {
    var selected = mediaGridGetSelectedItems();
    if (selected.length === 1) {
      e.preventDefault();
      openMediaGridViewer(selected[0].key);
    }
    return;
  }
  if (/^[0-5]$/.test(e.key)) {
    e.preventDefault();
    mediaGridApplyRating(Number(e.key));
  }
}

function initMediaGrid() {
  mediaGridCreateEntryButton();
  mediaGridCreateSurface();
  mediaGridBuildSurfaceFilterControls();
  mediaGridCreateViewerModal();
  document.addEventListener('keydown', mediaGridHandleKeydown);
  window.addEventListener('webcap:context-menu-hidden', function () {
    if (!mediaGridState.open) return;
    mediaGridClearContextTarget();
  });
}

initMediaGrid();
