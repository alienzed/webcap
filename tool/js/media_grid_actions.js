function mediaGridCreateEntryButton() {
  if (ui && ui.sidebarGridBtnEl) {
    ui.sidebarGridBtnEl.onclick = openMediaGridSurface;
    if (ui.focusSetGridBtn) {
      ui.focusSetGridBtn.onclick = openMediaGridSurface;
    }
    mediaGridUpdateEntryVisibility();
    return;
  }
  var wrapper = document.getElementById('media-list-wrapper');
  if (!wrapper) throw new Error('Media Grid entry target is missing.');
  if (document.getElementById('media-grid-open-btn')) {
    mediaGridUpdateEntryVisibility();
    return;
  }
  var btn = document.createElement('button');
  btn.id = 'media-grid-open-btn';
  btn.type = 'button';
  btn.className = 'refresh-btn-square floating-grid';
  btn.title = 'Open Media Grid for the current visible items';
  btn.setAttribute('aria-label', 'Open Media Grid');
  btn.innerHTML =
    '<span class="media-grid-open-icon" aria-hidden="true">' +
      '<span></span><span></span><span></span><span></span>' +
    '</span>';
  btn.onclick = openMediaGridSurface;
  wrapper.insertBefore(btn, wrapper.firstChild);
  mediaGridUpdateEntryVisibility();
}

function mediaGridUpdateEntryVisibility() {
  var btn = document.getElementById('media-grid-open-btn');
  var focusBtn = document.getElementById('focus-set-grid-btn');
  var sidebarBtn = ui && ui.sidebarGridBtnEl ? ui.sidebarGridBtnEl : null;
  var hasVisibleMedia = mediaGridGetVisibleItems().length > 0;
  var hasFocusSet = !!(state && state.focusSet && state.focusSet.keys && state.focusSet.keys.length);
  if (btn) {
    btn.classList.toggle('hidden', !hasVisibleMedia || hasFocusSet);
  }
  if (sidebarBtn) {
    sidebarBtn.disabled = false;
    sidebarBtn.classList.toggle('hidden', !hasVisibleMedia);
    sidebarBtn.title = hasFocusSet
      ? 'Open Media Grid for the current focus set'
      : 'Open Media Grid for the current visible items';
  }
  if (focusBtn) {
    focusBtn.classList.toggle('hidden', !(hasVisibleMedia && hasFocusSet));
  }
  if (typeof renderPreviewHeaderMeta === 'function') {
    renderPreviewHeaderMeta();
  }
}

function mediaGridCreateModal() {
  if (!document.getElementById('media-grid-modal')) {
    throw new Error('Media Grid shell is missing from tool.html.');
  }
  mediaGridWireModal();
  mediaGridCreateViewerModal();
}

function mediaGridCreateSurface() {
  if (!document.getElementById('media-grid-surface')) {
    throw new Error('Media Grid surface is missing from tool.html.');
  }
  mediaGridWireSurface();
}

function mediaGridWireModal() {
  var els = mediaGridGetEls();
  if (!els.modal) throw new Error('Media Grid shell is missing.');
  if (els.modal.__wired) return;
  els.modal.__wired = true;
  els.closeBtn.onclick = closeMediaGridModal;
  els.selectAllBtn.onclick = mediaGridSelectAll;
  els.clearBtn.onclick = mediaGridClearSelection;
  els.modal.addEventListener('click', function (e) {
    if (e.target === els.modal) closeMediaGridModal();
  });
  mediaGridBuildFilterControls();
  if (!els.railCollapseBtn) throw new Error('Media Grid rail controls are missing.');
  els.railCollapseBtn.addEventListener('click', function () {
    mediaGridSetRailCollapsed(!mediaGridState.railCollapsed);
  });
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


function openMediaGridModal() {
  var items = mediaGridGetVisibleItems();
  if (!items.length) {
    setStatus('No visible media items for Grid.');
    return;
  }
  closeMediaGridViewer();
  mediaGridHideSurfaceShell();
  mediaGridCaptureWorkspaceState();
  mediaGridBeginSession('modal');
  var els = mediaGridGetEls();
  var overlayHost = document.getElementById('workspace-overlays');
  if (overlayHost && els.modal && els.modal.parentNode !== overlayHost) {
    overlayHost.appendChild(els.modal);
  }
  els.modal.classList.remove('hidden');
  els.modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('media-grid-open');
  if (typeof setWorkspaceViewMode === 'function') {
    setWorkspaceViewMode('grid');
  }
  if (typeof setWorkspaceSurface === 'function') {
    setWorkspaceSurface('grid');
  }
  if (typeof setWorkspaceWorkflowMode === 'function') {
    setWorkspaceWorkflowMode('select');
  }
  if (typeof renderPreviewHeaderMeta === 'function') {
    renderPreviewHeaderMeta();
  }
  renderMediaGridModal();
  focusFirstModalTextField(els.modal);
}

function closeMediaGridModal() {
  closeMediaGridViewer();
  mediaGridHideModalShell();
  var previousWorkspaceState = mediaGridState.previousWorkspaceState;
  mediaGridResetSessionState();
  mediaGridRestoreItemWorkspace(previousWorkspaceState);
}

function openMediaGridSurface() {
  var items = mediaGridGetVisibleItems();
  if (!items.length) {
    setStatus('No visible media items for Grid.');
    return;
  }
  var surfaceEls = mediaGridGetSurfaceEls();
  if (!surfaceEls.surface || !surfaceEls.canvas) {
    openMediaGridModal();
    return;
  }
  closeMediaGridViewer();
  mediaGridHideModalShell();
  mediaGridCaptureWorkspaceState();
  mediaGridBeginSession('surface');
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

function renderMediaGridModal() {
  if (!mediaGridIsModalMode()) return;
  mediaGridSyncItemsToCurrentView();
  renderMediaGridHeader();
  renderMediaGridLeftRail();
  renderMediaGridActiveScope();
  renderMediaGridCanvas();
  renderMediaGridSidebar();
  mediaGridRenderSharedWorkbench();
}

function renderMediaGridSurface() {
  if (!mediaGridIsSurfaceMode()) return;
  mediaGridSyncItemsToCurrentView();
  mediaGridEnsureMainWorkbenchVisible();
  renderMediaGridSurfaceHeader();
  renderMediaGridCanvas();
  mediaGridRenderSharedWorkbench();
}

function renderMediaGridHeader() {
  var els = mediaGridGetEls();
  var selectedCount = mediaGridState.selectedKeys.size;
  var totalCount = mediaGridState.items.length;
  els.meta.textContent = mediaGridBuildMetaText();
  els.clearBtn.disabled = selectedCount <= 0;
  els.selectAllBtn.disabled = totalCount <= 0 || selectedCount === totalCount;
  els.status.textContent = mediaGridState.status;
  mediaGridSyncFilterControls();
}

function renderMediaGridSurfaceHeader() {
  var els = mediaGridGetSurfaceEls();
  var selectedCount = mediaGridState.selectedKeys.size;
  var totalCount = mediaGridState.items.length;
  if (!els.meta || !els.status || !els.selectAllBtn || !els.clearBtn) return;
  els.meta.textContent = mediaGridBuildSurfaceMetaText();
  els.status.textContent = mediaGridState.status;
  els.status.classList.toggle('hidden', !mediaGridState.status);
  els.clearBtn.disabled = selectedCount <= 0;
  els.selectAllBtn.disabled = totalCount <= 0 || selectedCount === totalCount;
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

function mediaGridPasteTagsToSelected() {
  var items = mediaGridGetSelectedItems();
  var tags = getTagClipboardTags();
  if (!items.length || !tags.length) {
    renderMediaGridHeader();
    return;
  }
  var changedItems = 0;
  items.forEach(function (item, index) {
    mediaGridSetStatus('Pasting tags ' + (index + 1) + '/' + items.length + '...');
    var result = mergeTagsIntoMediaKey(item.key, tags);
    if (result && result.added > 0) changedItems += 1;
  });
  mediaGridSetStatus('Pasted tags onto ' + changedItems + ' item' + (changedItems === 1 ? '' : 's') + '.');
  mediaGridRefreshAfterMutation();
}

function mediaGridRefreshAfterMutation() {
  if (!mediaGridState.open) return;
  if (mediaGridIsSurfaceMode()) {
    renderMediaGridSurface();
    return;
  }
  renderMediaGridModal();
}

function mediaGridRefreshFromCurrentFilters() {
  if (!mediaGridState.open) return;
  if (mediaGridIsSurfaceMode()) {
    renderMediaGridSurface();
    return;
  }
  renderMediaGridModal();
}

function mediaGridBuildSidebarHeader() {
  var wrap = document.createElement('div');
  wrap.className = 'media-grid-sidebar-header';

  var titleWrap = document.createElement('div');
  titleWrap.className = 'media-grid-sidebar-title-wrap';
  wrap.appendChild(titleWrap);

  var title = document.createElement('div');
  title.className = 'media-grid-sidebar-title';
  title.textContent = 'Actions';
  titleWrap.appendChild(title);

  var hint = document.createElement('div');
  hint.className = 'media-grid-sidebar-hint';
  hint.textContent = 'Select items, then rate or tag them from this rail.';
  titleWrap.appendChild(hint);

  var pasteBtn = document.createElement('button');
  pasteBtn.type = 'button';
  pasteBtn.className = 'media-grid-btn media-grid-sidebar-action';
  pasteBtn.textContent = 'Paste Tags';
  var canPaste = mediaGridState.selectedKeys.size > 0 && hasTagClipboardTags();
  pasteBtn.classList.toggle('hidden', !canPaste);
  pasteBtn.disabled = !canPaste;
  pasteBtn.onclick = mediaGridPasteTagsToSelected;
  wrap.appendChild(pasteBtn);

  return wrap;
}

function mediaGridBuildSelectionPanel() {
  var selectedCount = mediaGridState.selectedKeys.size;
  var wrap = document.createElement('div');
  wrap.className = 'media-grid-selection-panel';

  var summary = document.createElement('div');
  summary.className = 'media-grid-selection-summary';
  summary.textContent = selectedCount > 0
    ? (selectedCount + ' selected')
    : 'No items selected';
  wrap.appendChild(summary);

  var ratingRow = document.createElement('div');
  ratingRow.className = 'media-grid-rating-controls';
  var values = [0, 1, 2, 3, 4, 5];
  values.forEach(function (rating) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'media-grid-btn media-grid-rating-btn';
    btn.disabled = selectedCount <= 0;
    btn.textContent = rating <= 0 ? '0' : '\u2605' + rating;
    btn.title = rating <= 0 ? 'Clear rating on selected items' : ('Set ' + rating + ' star rating on selected items');
    btn.onclick = function () {
      mediaGridApplyRating(rating);
    };
    ratingRow.appendChild(btn);
  });
  wrap.appendChild(ratingRow);

  return wrap;
}

function mediaGridBuildTagGroupHeader(requirementLabel) {
  var wrap = document.createElement('div');
  wrap.className = 'media-grid-tag-group-header';

  var label = document.createElement('span');
  label.className = 'media-grid-tag-group-title';
  label.textContent = requirementLabel;
  wrap.appendChild(label);

  var editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'media-grid-tag-group-edit';
  editBtn.title = 'Edit terms for ' + requirementLabel;
  editBtn.setAttribute('aria-label', 'Edit terms for ' + requirementLabel);
  editBtn.innerHTML = '&#9998;';
  editBtn.onclick = function (e) {
    e.preventDefault();
    e.stopPropagation();
    openChecklistGroupTermsModal(requirementLabel);
  };
  wrap.appendChild(editBtn);

  return wrap;
}

function mediaGridGetTagGroupState(terms) {
  var sawAll = false;
  var sawMixed = false;
  (terms || []).forEach(function (term) {
    var stateName = mediaGridGetTagSelectionState(term);
    if (stateName === 'mixed') sawMixed = true;
    if (stateName === 'all') sawAll = true;
  });
  if (sawMixed) return 'mixed';
  if (sawAll) return 'all';
  return 'none';
}

function mediaGridBuildTagChip(term) {
  var stateName = mediaGridGetTagSelectionState(term);
  var usageState = mediaGridGetTagUsageState(term);
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'media-grid-tag-chip media-grid-tag-chip--' + usageState +
    (stateName === 'all' ? ' all' : '') +
    (stateName === 'mixed' ? ' mixed' : '');
  btn.textContent = term;
  btn.title = mediaGridBuildTagTitle(term, stateName);
  btn.onclick = function () {
    mediaGridToggleTagForSelection(term, stateName);
  };
  return btn;
}

function mediaGridGetTagUsageState(term) {
  var total = mediaGridState.items.length;
  if (total <= 0) return 'none';
  var count = 0;
  mediaGridState.items.forEach(function (item) {
    if (hasTagForMediaKey(item.key, term)) count += 1;
  });
  if (count <= 0) return 'none';
  var ratio = count / total;
  if (ratio >= 0.7) return 'most';
  if (ratio >= 0.35) return 'many';
  return 'some';
}

function mediaGridGetTagSelectionState(term) {
  var selected = mediaGridGetSelectedItems();
  if (!selected.length) return 'none';
  var count = 0;
  selected.forEach(function (item) {
    if (hasTagForMediaKey(item.key, term)) count += 1;
  });
  if (count <= 0) return 'none';
  if (count >= selected.length) return 'all';
  return 'mixed';
}

function mediaGridBuildTagTitle(term, stateName) {
  if (!mediaGridState.selectedKeys.size) return 'Select items before applying "' + term + '"';
  if (stateName === 'all') return 'Remove "' + term + '" from selected items';
  if (stateName === 'mixed') return 'Add "' + term + '" to all selected items';
  return 'Add "' + term + '" to selected items';
}

function mediaGridToggleTagForSelection(term, stateName) {
  var selected = mediaGridGetSelectedItems();
  if (!selected.length) {
    mediaGridSetStatus('Select items before tagging.');
    return;
  }
  var remove = stateName === 'all';
  var changed = 0;
  selected.forEach(function (item, index) {
    mediaGridSetStatus((remove ? 'Removing' : 'Adding') + ' tag ' + (index + 1) + '/' + selected.length + '...');
    var ok = remove ? removeTagFromMediaKey(item.key, term) : addTagToMediaKey(item.key, term);
    if (ok) changed += 1;
  });
  mediaGridSetStatus((remove ? 'Removed' : 'Added') + ' "' + term + '" on ' + changed + ' item' + (changed === 1 ? '' : 's') + '.');
  mediaGridRefreshAfterMutation();
}

function renderMediaGridSidebar() {
  var els = mediaGridGetEls();
  els.sidebar.innerHTML = '';
  els.sidebar.appendChild(mediaGridBuildSidebarHeader());
  els.sidebar.appendChild(mediaGridBuildSelectionPanel());

  var sectionTitle = document.createElement('div');
  sectionTitle.className = 'media-grid-sidebar-title media-grid-sidebar-section-title';
  sectionTitle.textContent = 'Groups';
  els.sidebar.appendChild(sectionTitle);

  if (typeof renderGroupWorkbench === 'function') {
    var workbenchWrap = document.createElement('section');
    workbenchWrap.id = 'media-grid-group-workbench';
    workbenchWrap.className = 'media-grid-group-workbench group-workbench';
    workbenchWrap.setAttribute('aria-label', 'Grid Groups');

    var workbenchList = document.createElement('div');
    workbenchList.id = 'media-grid-group-workbench-list';
    workbenchList.className = 'group-workbench-list';

    workbenchWrap.appendChild(workbenchList);
    els.sidebar.appendChild(workbenchWrap);
    return;
  }

  var requirements = Array.isArray(checklistItems) ? checklistItems : [];
  if (!requirements.length) {
    var empty = document.createElement('div');
    empty.className = 'media-grid-empty';
    empty.textContent = 'No tag groups configured.';
    els.sidebar.appendChild(empty);
    return;
  }

  requirements.forEach(function (requirementLabel) {
    var terms = getChecklistKeywordTermsForRequirement(requirementLabel);
    var group = document.createElement('details');
    group.className = 'media-grid-tag-group media-grid-tag-group--' + mediaGridGetTagGroupState(terms);
    group.open = true;
    var summary = document.createElement('summary');
    summary.className = 'media-grid-tag-group-summary';
    summary.appendChild(mediaGridBuildTagGroupHeader(requirementLabel));
    group.appendChild(summary);

    var list = document.createElement('div');
    list.className = 'media-grid-tag-list';
    if (!terms.length) {
      var emptyTerms = document.createElement('div');
      emptyTerms.className = 'media-grid-empty';
      emptyTerms.textContent = 'No tags in this group.';
      list.appendChild(emptyTerms);
    } else {
      terms.forEach(function (term) {
        list.appendChild(mediaGridBuildTagChip(term));
      });
    }
    group.appendChild(list);
    els.sidebar.appendChild(group);
  });
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
  mediaGridCreateModal();
  document.addEventListener('keydown', mediaGridHandleKeydown);
  window.addEventListener('webcap:context-menu-hidden', function () {
    if (!mediaGridState.open) return;
    mediaGridClearContextTarget();
  });
}

initMediaGrid();

