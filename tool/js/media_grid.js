var mediaGridState = {
  open: false,
  items: [],
  selectedKeys: new Set(),
  lastSelectedKey: '',
  status: '',
  viewerKey: ''
};

function mediaGridGetEls() {
  return {
    modal: document.getElementById('media-grid-modal'),
    meta: document.getElementById('media-grid-meta'),
    status: document.getElementById('media-grid-status'),
    filters: document.getElementById('media-grid-filters'),
    canvas: document.getElementById('media-grid-canvas'),
    sidebar: document.getElementById('media-grid-sidebar'),
    selectAllBtn: document.getElementById('media-grid-select-all-btn'),
    clearBtn: document.getElementById('media-grid-clear-btn'),
    closeBtn: document.getElementById('media-grid-close-btn'),
    viewerModal: document.getElementById('media-grid-viewer-modal'),
    viewerTitle: document.getElementById('media-grid-viewer-title'),
    viewerStage: document.getElementById('media-grid-viewer-stage'),
    viewerCloseBtn: document.getElementById('media-grid-viewer-close-btn')
  };
}

function mediaGridSetStatus(text) {
  mediaGridState.status = String(text || '');
  var els = mediaGridGetEls();
  els.status.textContent = mediaGridState.status;
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

function mediaGridCreateEntryButton() {
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
  btn.onclick = openMediaGridModal;
  wrapper.insertBefore(btn, wrapper.firstChild);
  mediaGridUpdateEntryVisibility();
}

function mediaGridUpdateEntryVisibility() {
  var btn = document.getElementById('media-grid-open-btn');
  if (!btn) return;
  var hasVisibleMedia = mediaGridGetVisibleItems().length > 0;
  btn.classList.toggle('hidden', !hasVisibleMedia);
}

function mediaGridCreateModal() {
  if (document.getElementById('media-grid-modal')) return;
  var modal = document.createElement('div');
  modal.id = 'media-grid-modal';
  modal.className = 'media-grid-modal hidden';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML =
    '<div class="media-grid-dialog" role="dialog" aria-modal="true" aria-labelledby="media-grid-title">' +
      '<div class="media-grid-header">' +
        '<div class="media-grid-title-block">' +
          '<h2 id="media-grid-title" class="media-grid-title">Media Grid</h2>' +
          '<div id="media-grid-meta" class="media-grid-meta"></div>' +
        '</div>' +
        '<div id="media-grid-filters" class="media-grid-filters" aria-label="Grid filters"></div>' +
        '<div class="media-grid-header-actions">' +
          '<div id="media-grid-status" class="media-grid-status"></div>' +
          '<button id="media-grid-select-all-btn" type="button" class="media-grid-btn">Select All</button>' +
          '<button id="media-grid-clear-btn" type="button" class="media-grid-btn">Clear Selections</button>' +
          '<button id="media-grid-close-btn" type="button" class="media-grid-btn media-grid-close-btn" aria-label="Close Media Grid">&times;</button>' +
        '</div>' +
      '</div>' +
      '<div class="media-grid-body">' +
        '<main id="media-grid-canvas" class="media-grid-canvas" aria-label="Media thumbnails"></main>' +
        '<aside id="media-grid-sidebar" class="media-grid-sidebar" aria-label="Grouped tags"></aside>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  mediaGridWireModal();
  mediaGridCreateViewerModal();
}

function mediaGridWireModal() {
  var els = mediaGridGetEls();
  if (!els.modal) throw new Error('Media Grid modal is missing.');
  els.closeBtn.onclick = closeMediaGridModal;
  els.selectAllBtn.onclick = mediaGridSelectAll;
  els.clearBtn.onclick = mediaGridClearSelection;
  els.modal.addEventListener('click', function (e) {
    if (e.target === els.modal) closeMediaGridModal();
  });
  mediaGridBuildFilterControls();
}

function mediaGridCreateViewerModal() {
  if (document.getElementById('media-grid-viewer-modal')) return;
  var modal = document.createElement('div');
  modal.id = 'media-grid-viewer-modal';
  modal.className = 'media-grid-viewer-modal hidden';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML =
    '<div class="media-grid-viewer-dialog" role="dialog" aria-modal="true" aria-labelledby="media-grid-viewer-title">' +
      '<div class="media-grid-viewer-header">' +
        '<div id="media-grid-viewer-title" class="media-grid-viewer-title"></div>' +
        '<button id="media-grid-viewer-close-btn" type="button" class="media-grid-viewer-close-btn" aria-label="Close fullscreen viewer">&times;</button>' +
      '</div>' +
      '<div id="media-grid-viewer-stage" class="media-grid-viewer-stage"></div>' +
    '</div>';
  document.body.appendChild(modal);
  var els = mediaGridGetEls();
  if (!els.viewerModal || !els.viewerCloseBtn) throw new Error('Media Grid viewer is missing.');
  els.viewerCloseBtn.onclick = closeMediaGridViewer;
  els.viewerModal.addEventListener('click', function (e) {
    if (e.target === els.viewerModal) closeMediaGridViewer();
  });
}

function openMediaGridModal() {
  var items = mediaGridGetVisibleItems();
  if (!items.length) {
    setStatus('No visible media items for Grid.');
    return;
  }
  mediaGridState.open = true;
  mediaGridState.items = items;
  mediaGridState.selectedKeys = new Set();
  mediaGridState.lastSelectedKey = '';
  mediaGridState.status = '';
  var els = mediaGridGetEls();
  els.modal.classList.remove('hidden');
  els.modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('media-grid-open');
  renderMediaGridModal();
}

function closeMediaGridModal() {
  var els = mediaGridGetEls();
  closeMediaGridViewer();
  els.modal.classList.add('hidden');
  els.modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('media-grid-open');
  mediaGridState.open = false;
  mediaGridState.items = [];
  mediaGridState.selectedKeys = new Set();
  mediaGridState.lastSelectedKey = '';
  mediaGridState.status = '';
  mediaGridState.viewerKey = '';
}

function renderMediaGridModal() {
  if (!mediaGridState.open) return;
  renderMediaGridHeader();
  mediaGridSyncFilterControls();
  renderMediaGridCanvas();
  renderMediaGridSidebar();
}

function renderMediaGridHeader() {
  var els = mediaGridGetEls();
  var selectedCount = mediaGridState.selectedKeys.size;
  var totalCount = mediaGridState.items.length;
  els.meta.textContent = mediaGridGetSourceLabel() + ' - ' + totalCount + ' item' + (totalCount === 1 ? '' : 's') +
    ' - ' + selectedCount + ' selected';
  els.clearBtn.disabled = selectedCount <= 0;
  els.selectAllBtn.disabled = totalCount <= 0 || selectedCount === totalCount;
  els.status.textContent = mediaGridState.status;
}

function mediaGridBuildFilterControls() {
  var els = mediaGridGetEls();
  if (!els.filters) throw new Error('Media Grid filters target is missing.');
  els.filters.innerHTML =
    '<div class="media-grid-filter-bar" aria-label="Grid filters">' +
      '<span class="media-grid-filter-label">Filters</span>' +
      '<label class="media-grid-filter-toggle"><input id="media-grid-filter-invalid-ar" type="checkbox"><span>Invalid AR</span></label>' +
      '<div class="media-grid-filter-divider" aria-hidden="true"></div>' +
      '<div class="media-grid-filter-rating-block">' +
        '<span class="media-grid-filter-subtitle">Rating</span>' +
        '<div id="media-grid-filter-stars" class="media-grid-filter-stars" aria-label="Rating filters"></div>' +
      '</div>' +
      '<span id="media-grid-other-filters" class="media-grid-other-filters hidden">Other list filters active</span>' +
    '</div>';

  mediaGridBuildStarsFilter();
  document.getElementById('media-grid-filter-invalid-ar').addEventListener('change', function () {
    ui.advancedFilterInvalidArEl.checked = this.checked;
    mediaGridDispatchChange(ui.advancedFilterInvalidArEl);
  });
}

function mediaGridBuildStarsFilter() {
  var target = document.getElementById('media-grid-filter-stars');
  target.innerHTML = '';
  var values = ['no_star', '1', '2', '3', '4', '5'];
  values.forEach(function (value) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'media-grid-filter-chip media-grid-filter-star';
    btn.setAttribute('data-filter-value', value);
    btn.textContent = value === 'no_star' ? '-' : '\u2605' + value;
    btn.title = value === 'no_star' ? 'Show unrated items' : 'Show ' + value + ' star items';
    btn.onclick = function () {
      mediaGridToggleMirroredCheckbox(ui.advancedFilterStarsEl, value);
    };
    target.appendChild(btn);
  });
}

function mediaGridToggleMirroredCheckbox(sourceEl, value) {
  var input = sourceEl.querySelector('input[value="' + String(value).replace(/"/g, '\\"') + '"]');
  if (!input) throw new Error('Media Grid filter source is missing: ' + value);
  input.checked = !input.checked;
  mediaGridDispatchChange(input);
}

function mediaGridDispatchInput(el) {
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function mediaGridDispatchChange(el) {
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function mediaGridSyncFilterControls() {
  var invalidAr = document.getElementById('media-grid-filter-invalid-ar');
  if (!invalidAr) return;
  document.getElementById('media-grid-filter-invalid-ar').checked = !!ui.advancedFilterInvalidArEl.checked;
  mediaGridSyncFilterToggle('media-grid-filter-invalid-ar');
  mediaGridSyncFilterChipGroup('media-grid-filter-stars', getAdvancedStarFilterValues());
  var hiddenFiltersActive = !!(
    String(ui.filterEl.value || '').trim() ||
    ui.advancedFilterMissingCaptionsEl.checked ||
    ui.advancedFilterReviewedEl.checked ||
    ui.advancedFilterUnreviewedEl.checked ||
    ui.advancedFilterIncompleteEl.checked ||
    ui.advancedFilterUntaggedEl.checked ||
    ui.advancedFilterSupersetEl.checked ||
    getAdvancedFlagFilterValues().length
  );
  document.getElementById('media-grid-other-filters').classList.toggle('hidden', !hiddenFiltersActive);
}

function mediaGridSyncFilterToggle(inputId) {
  var input = document.getElementById(inputId);
  var label = input ? input.closest('.media-grid-filter-toggle') : null;
  if (label) label.classList.toggle('active', !!input.checked);
}

function mediaGridSyncFilterChipGroup(containerId, activeValues) {
  var active = {};
  activeValues.forEach(function (value) {
    active[String(value)] = true;
  });
  var buttons = document.getElementById(containerId).querySelectorAll('[data-filter-value]');
  for (var i = 0; i < buttons.length; i++) {
    var value = buttons[i].getAttribute('data-filter-value');
    buttons[i].classList.toggle('active', !!active[value]);
  }
}

function renderMediaGridCanvas() {
  var els = mediaGridGetEls();
  els.canvas.innerHTML = '';
  if (!mediaGridState.items.length) {
    var empty = document.createElement('div');
    empty.className = 'media-grid-empty media-grid-empty-main';
    empty.textContent = 'No items remain in this Grid view.';
    els.canvas.appendChild(empty);
    return;
  }
  var grid = document.createElement('div');
  grid.className = 'media-grid-items';
  mediaGridState.items.forEach(function (item) {
    grid.appendChild(mediaGridBuildTile(item));
  });
  els.canvas.appendChild(grid);
}

function mediaGridBuildTile(mediaItem) {
  var selected = mediaGridState.selectedKeys.has(mediaItem.key);
  var tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'media-grid-tile' + (selected ? ' selected' : '');
  tile.setAttribute('data-key', mediaItem.key);
  tile.title = mediaItem.fileName;
  tile.onclick = function (e) {
    mediaGridHandleTileClick(mediaItem.key, e);
  };
  tile.ondblclick = function (e) {
    e.preventDefault();
    e.stopPropagation();
    toggleMediaGridViewer(mediaItem.key);
  };
  tile.oncontextmenu = function (e) {
    mediaGridHandleTileContextMenu(mediaItem, e);
  };

  var thumb = document.createElement('div');
  thumb.className = 'media-grid-thumb-wrap';
  var url = mediaGridMediaUrl(mediaItem);
  if (mediaGridIsVideoFile(mediaItem.fileName)) {
    var video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = url;
    thumb.appendChild(video);
  } else {
    var img = document.createElement('img');
    img.loading = 'lazy';
    img.src = url;
    img.alt = mediaItem.label || mediaItem.fileName;
    thumb.appendChild(img);
  }

  mediaGridAppendTileBadges(thumb, mediaItem);
  if (selected) {
    var selectedBadge = document.createElement('span');
    selectedBadge.className = 'media-grid-selected-badge';
    selectedBadge.textContent = 'Selected';
    thumb.appendChild(selectedBadge);
  }

  var zoomHint = document.createElement('span');
  zoomHint.className = 'media-grid-zoom-hint';
  zoomHint.innerHTML = '&#128269;';
  zoomHint.setAttribute('aria-hidden', 'true');
  thumb.appendChild(zoomHint);

  tile.appendChild(thumb);
  return tile;
}

function mediaGridAppendTileBadges(thumb, mediaItem) {
  var badges = document.createElement('div');
  badges.className = 'media-grid-badges';

  var rating = getRatingForMediaKey(mediaItem.key);
  if (rating > 0) {
    var ratingBadge = document.createElement('span');
    ratingBadge.className = 'media-grid-badge media-grid-badge-rating';
    ratingBadge.textContent = '\u2605 ' + rating;
    ratingBadge.title = rating + ' star rating';
    badges.appendChild(ratingBadge);
  }

  var aspect = String((mediaItem && mediaItem.metadata && mediaItem.metadata.aspect) || '').trim();
  if (aspect && !hasSupportedAspectBucket(aspect)) {
    var arBadge = document.createElement('span');
    arBadge.className = 'media-grid-badge media-grid-badge-warning';
    arBadge.textContent = 'Invalid AR';
    arBadge.title = 'Aspect ratio is outside supported buckets.';
    badges.appendChild(arBadge);
  }

  if (badges.childNodes.length) {
    thumb.appendChild(badges);
  }
}

function mediaGridSyncSelectionDisplay() {
  var els = mediaGridGetEls();
  var tiles = els.canvas.querySelectorAll('.media-grid-tile[data-key]');
  for (var i = 0; i < tiles.length; i++) {
    var tile = tiles[i];
    var key = tile.getAttribute('data-key');
    var selected = mediaGridState.selectedKeys.has(key);
    tile.classList.toggle('selected', selected);
    var thumb = tile.querySelector('.media-grid-thumb-wrap');
    var badge = tile.querySelector('.media-grid-selected-badge');
    if (selected && !badge && thumb) {
      badge = document.createElement('span');
      badge.className = 'media-grid-selected-badge';
      badge.textContent = 'Selected';
      thumb.appendChild(badge);
    } else if (!selected && badge) {
      badge.parentNode.removeChild(badge);
    }
  }
}

function mediaGridRenderSelectionState() {
  renderMediaGridHeader();
  mediaGridSyncSelectionDisplay();
  renderMediaGridSidebar();
}

function mediaGridHandleTileContextMenu(mediaItem, e) {
  e.preventDefault();
  e.stopPropagation();
  mediaGridMarkContextTarget(mediaItem.key);
  var key = mediaItem.key || mediaItem.fileName;
  var actions = buildMediaContextMenuActions(mediaItem, key).map(function (action) {
    if (!action || action.separator || typeof action.run !== 'function') return action;
    return {
      label: action.label,
      render: action.render,
      run: function () {
        action.run();
        mediaGridRefreshAfterMutation();
      }
    };
  });
  showContextMenu(e.clientX, e.clientY, actions);
}

function mediaGridClearContextTarget() {
  var els = mediaGridGetEls();
  var tiles = els.canvas.querySelectorAll('.media-grid-tile.context-target');
  for (var i = 0; i < tiles.length; i++) {
    tiles[i].classList.remove('context-target');
  }
}

function mediaGridMarkContextTarget(mediaKey) {
  var els = mediaGridGetEls();
  mediaGridClearContextTarget();
  var key = String(mediaKey || '').replace(/"/g, '\\"');
  var target = els.canvas.querySelector('.media-grid-tile[data-key="' + key + '"]');
  if (target) target.classList.add('context-target');
}

function mediaGridHandleTileClick(itemKey, e) {
  var key = String(itemKey || '');
  if (!key) return;
  mediaGridClearContextTarget();
  if (e.shiftKey && mediaGridState.lastSelectedKey) {
    mediaGridSelectRange(mediaGridState.lastSelectedKey, key);
  } else {
    if (mediaGridState.selectedKeys.has(key)) {
      mediaGridState.selectedKeys.delete(key);
    } else {
      mediaGridState.selectedKeys.add(key);
    }
  }
  mediaGridState.lastSelectedKey = key;
  mediaGridRenderSelectionState();
}

function mediaGridFindItemByKey(mediaKey) {
  var key = String(mediaKey || '').trim();
  if (!key) return null;
  for (var i = 0; i < mediaGridState.items.length; i++) {
    var item = mediaGridState.items[i];
    if (item && item.key === key) return item;
  }
  return null;
}

function mediaGridBuildViewerTitleText(mediaItem) {
  var fileName = String((mediaItem && mediaItem.fileName) || (mediaItem && mediaItem.label) || '').trim();
  var caption = String((mediaItem && mediaItem.caption) || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!caption) return fileName;
  return fileName + ' | ' + caption;
}

function openMediaGridViewer(mediaKey) {
  var item = mediaGridFindItemByKey(mediaKey);
  if (!item) {
    mediaGridSetStatus('Item is no longer visible in Grid.');
    return;
  }
  var els = mediaGridGetEls();
  if (!els.viewerModal || !els.viewerStage || !els.viewerTitle) throw new Error('Media Grid viewer is missing.');
  mediaGridState.viewerKey = item.key;
  els.viewerTitle.textContent = mediaGridBuildViewerTitleText(item);
  els.viewerTitle.title = String((item && item.fileName) || '');
  els.viewerStage.innerHTML = '';
  els.viewerStage.ondblclick = function (e) {
    e.preventDefault();
    e.stopPropagation();
    closeMediaGridViewer();
  };

  var url = mediaGridMediaUrl(item);
  if (mediaGridIsVideoFile(item.fileName)) {
    var video = document.createElement('video');
    video.className = 'media-grid-viewer-media';
    video.controls = true;
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = url;
    els.viewerStage.appendChild(video);
    var playPromise = video.play();
    if (playPromise && playPromise.catch) playPromise.catch(function () {});
  } else {
    var img = document.createElement('img');
    img.className = 'media-grid-viewer-media';
    img.loading = 'eager';
    img.src = url;
    img.alt = item.label || item.fileName;
    els.viewerStage.appendChild(img);
  }

  els.viewerModal.classList.remove('hidden');
  els.viewerModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('media-grid-viewer-open');
}

function toggleMediaGridViewer(mediaKey) {
  var key = String(mediaKey || '').trim();
  if (!key) return;
  if (mediaGridState.viewerKey === key) {
    closeMediaGridViewer();
    return;
  }
  openMediaGridViewer(key);
}

function closeMediaGridViewer() {
  var els = mediaGridGetEls();
  if (!els.viewerModal || !els.viewerStage) return;
  els.viewerModal.classList.add('hidden');
  els.viewerModal.setAttribute('aria-hidden', 'true');
  els.viewerStage.innerHTML = '';
  document.body.classList.remove('media-grid-viewer-open');
  mediaGridState.viewerKey = '';
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
  mediaGridPruneAgainstCurrentVisibleSet();
  if (mediaGridState.viewerKey && !mediaGridFindItemByKey(mediaGridState.viewerKey)) {
    closeMediaGridViewer();
  }
  renderMediaGridHeader();
  if (!mediaGridState.items.length) {
    renderMediaGridCanvas();
    renderMediaGridSidebar();
    return;
  }
  mediaGridSyncCanvasAfterMutation();
  mediaGridSyncSelectionDisplay();
  renderMediaGridSidebar();
}

function mediaGridRefreshFromCurrentFilters() {
  if (!mediaGridState.open) return;
  var nextItems = mediaGridGetVisibleItems();
  var keep = {};
  nextItems.forEach(function (item) {
    keep[item.key] = true;
  });
  Array.from(mediaGridState.selectedKeys).forEach(function (key) {
    if (!keep[key]) mediaGridState.selectedKeys.delete(key);
  });
  if (mediaGridState.lastSelectedKey && !keep[mediaGridState.lastSelectedKey]) {
    mediaGridState.lastSelectedKey = '';
  }
  mediaGridState.items = nextItems;
  if (mediaGridState.viewerKey && !keep[mediaGridState.viewerKey]) {
    closeMediaGridViewer();
  }
  renderMediaGridModal();
}

function mediaGridPruneAgainstCurrentVisibleSet() {
  var visible = mediaGridGetVisibleItems();
  var keep = {};
  visible.forEach(function (item) {
    keep[item.key] = true;
  });
  var nextItems = [];
  mediaGridState.items.forEach(function (item) {
    if (keep[item.key]) {
      nextItems.push(item);
      return;
    }
    mediaGridState.selectedKeys.delete(item.key);
    if (mediaGridState.lastSelectedKey === item.key) {
      mediaGridState.lastSelectedKey = '';
    }
  });
  mediaGridState.items = nextItems;
}

function mediaGridSyncCanvasAfterMutation() {
  var els = mediaGridGetEls();
  var itemsByKey = {};
  mediaGridState.items.forEach(function (item) {
    itemsByKey[item.key] = item;
  });
  var tiles = els.canvas.querySelectorAll('.media-grid-tile[data-key]');
  for (var i = 0; i < tiles.length; i++) {
    var tile = tiles[i];
    var key = tile.getAttribute('data-key');
    var item = itemsByKey[key];
    if (!item) {
      tile.parentNode.removeChild(tile);
      continue;
    }
    var thumb = tile.querySelector('.media-grid-thumb-wrap');
    if (!thumb) continue;
    var oldBadges = thumb.querySelector('.media-grid-badges');
    if (oldBadges) oldBadges.parentNode.removeChild(oldBadges);
    mediaGridAppendTileBadges(thumb, item);
  }
}

function renderMediaGridSidebar() {
  var els = mediaGridGetEls();
  els.sidebar.innerHTML = '';
  els.sidebar.appendChild(mediaGridBuildSidebarHeader());

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

function mediaGridBuildSidebarHeader() {
  var wrap = document.createElement('div');
  wrap.className = 'media-grid-sidebar-header';

  var titleWrap = document.createElement('div');
  titleWrap.className = 'media-grid-sidebar-title-wrap';
  wrap.appendChild(titleWrap);

  var title = document.createElement('div');
  title.className = 'media-grid-sidebar-title';
  title.textContent = 'Tags';
  titleWrap.appendChild(title);

  var hint = document.createElement('div');
  hint.className = 'media-grid-sidebar-hint';
  hint.textContent = 'Select items, then click tags to add or remove them.';
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
    closeMediaGridModal();
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
  mediaGridCreateModal();
  document.addEventListener('keydown', mediaGridHandleKeydown);
  window.addEventListener('webcap:context-menu-hidden', function () {
    if (!mediaGridState.open) return;
    mediaGridClearContextTarget();
  });
  window.addEventListener('webcap:media-metadata-updated', function () {
    if (!mediaGridState.open) return;
    mediaGridRefreshAfterMutation();
  });
}

initMediaGrid();

window.openMediaGridModal = openMediaGridModal;
window.mediaGridUpdateEntryVisibility = mediaGridUpdateEntryVisibility;
window.mediaGridRefreshFromCurrentFilters = mediaGridRefreshFromCurrentFilters;
