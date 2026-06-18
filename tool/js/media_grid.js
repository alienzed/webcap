var mediaGridState = {
  open: false,
  items: [],
  selectedKeys: new Set(),
  lastSelectedKey: '',
  status: ''
};

function mediaGridGetEls() {
  return {
    modal: document.getElementById('media-grid-modal'),
    meta: document.getElementById('media-grid-meta'),
    status: document.getElementById('media-grid-status'),
    canvas: document.getElementById('media-grid-canvas'),
    sidebar: document.getElementById('media-grid-sidebar'),
    selectAllBtn: document.getElementById('media-grid-select-all-btn'),
    clearBtn: document.getElementById('media-grid-clear-btn'),
    closeBtn: document.getElementById('media-grid-close-btn')
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
  return '/caption/media?folder=' + encodeURIComponent(state.folder || '') +
    '&media=' + encodeURIComponent(mediaItem.fileName) +
    '&t=' + Date.now();
}

function mediaGridCreateEntryButton() {
  var strip = document.querySelector('.sidebar-action-strip');
  if (!strip) throw new Error('Media Grid entry target is missing.');
  if (document.getElementById('media-grid-open-btn')) return;
  var btn = document.createElement('button');
  btn.id = 'media-grid-open-btn';
  btn.type = 'button';
  btn.className = 'review-captions-btn';
  btn.title = 'Open Media Grid for the current visible items';
  btn.innerHTML = '<span class="btn-glyph" aria-hidden="true">#</span><span>Grid</span>';
  btn.onclick = openMediaGridModal;
  strip.insertBefore(btn, strip.firstChild);
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
        '<div class="media-grid-header-actions">' +
          '<div id="media-grid-status" class="media-grid-status"></div>' +
          '<button id="media-grid-select-all-btn" type="button" class="media-grid-btn">Select All</button>' +
          '<button id="media-grid-clear-btn" type="button" class="media-grid-btn">Clear</button>' +
          '<div class="media-grid-rating-controls" aria-label="Apply rating to selected items">' +
            '<button type="button" class="media-grid-btn media-grid-rating-btn" data-rating="0">0</button>' +
            '<button type="button" class="media-grid-btn media-grid-rating-btn" data-rating="1">1</button>' +
            '<button type="button" class="media-grid-btn media-grid-rating-btn" data-rating="2">2</button>' +
            '<button type="button" class="media-grid-btn media-grid-rating-btn" data-rating="3">3</button>' +
            '<button type="button" class="media-grid-btn media-grid-rating-btn" data-rating="4">4</button>' +
            '<button type="button" class="media-grid-btn media-grid-rating-btn" data-rating="5">5</button>' +
          '</div>' +
          '<button id="media-grid-close-btn" type="button" class="media-grid-btn media-grid-close-btn" aria-label="Close Media Grid">x</button>' +
        '</div>' +
      '</div>' +
      '<div class="media-grid-body">' +
        '<main id="media-grid-canvas" class="media-grid-canvas" aria-label="Media thumbnails"></main>' +
        '<aside id="media-grid-sidebar" class="media-grid-sidebar" aria-label="Grouped tags"></aside>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  mediaGridWireModal();
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
  var ratingBtns = els.modal.querySelectorAll('[data-rating]');
  for (var i = 0; i < ratingBtns.length; i++) {
    ratingBtns[i].onclick = function () {
      mediaGridApplyRating(Number(this.getAttribute('data-rating')));
    };
  }
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
  els.modal.classList.add('hidden');
  els.modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('media-grid-open');
  mediaGridState.open = false;
  mediaGridState.items = [];
  mediaGridState.selectedKeys = new Set();
  mediaGridState.lastSelectedKey = '';
  mediaGridState.status = '';
}

function renderMediaGridModal() {
  if (!mediaGridState.open) return;
  renderMediaGridHeader();
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

function renderMediaGridCanvas() {
  var els = mediaGridGetEls();
  els.canvas.innerHTML = '';
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

  var rating = getRatingForMediaKey(mediaItem.key);
  if (rating > 0) {
    var ratingBadge = document.createElement('span');
    ratingBadge.className = 'media-grid-rating-badge';
    ratingBadge.textContent = String(rating);
    ratingBadge.title = rating + ' star rating';
    thumb.appendChild(ratingBadge);
  }
  if (!mediaItem.hasCaption) {
    var captionBadge = document.createElement('span');
    captionBadge.className = 'media-grid-caption-badge';
    captionBadge.textContent = 'No caption';
    thumb.appendChild(captionBadge);
  }
  if (selected) {
    var selectedBadge = document.createElement('span');
    selectedBadge.className = 'media-grid-selected-badge';
    selectedBadge.textContent = 'Selected';
    thumb.appendChild(selectedBadge);
  }

  var label = document.createElement('div');
  label.className = 'media-grid-tile-label';
  label.textContent = mediaItem.label || mediaItem.fileName;
  tile.appendChild(thumb);
  tile.appendChild(label);
  return tile;
}

function mediaGridHandleTileClick(itemKey, e) {
  var key = String(itemKey || '');
  if (!key) return;
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
  renderMediaGridModal();
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
  renderMediaGridModal();
}

function mediaGridClearSelection() {
  mediaGridState.selectedKeys = new Set();
  mediaGridState.lastSelectedKey = '';
  mediaGridSetStatus('Selection cleared.');
  renderMediaGridModal();
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
  renderMediaGridModal();
}

function renderMediaGridSidebar() {
  var els = mediaGridGetEls();
  els.sidebar.innerHTML = '';
  var title = document.createElement('div');
  title.className = 'media-grid-sidebar-title';
  title.textContent = 'Tags';
  els.sidebar.appendChild(title);

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
    group.className = 'media-grid-tag-group';
    group.open = true;
    var summary = document.createElement('summary');
    summary.textContent = requirementLabel;
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

function mediaGridBuildTagChip(term) {
  var stateName = mediaGridGetTagSelectionState(term);
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'media-grid-tag-chip' + (stateName === 'all' ? ' all' : '') + (stateName === 'mixed' ? ' mixed' : '');
  btn.textContent = term;
  btn.title = mediaGridBuildTagTitle(term, stateName);
  btn.onclick = function () {
    mediaGridToggleTagForSelection(term, stateName);
  };
  return btn;
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
  renderMediaGridModal();
}

function mediaGridHandleKeydown(e) {
  if (!mediaGridState.open) return;
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
  if (/^[0-5]$/.test(e.key)) {
    e.preventDefault();
    mediaGridApplyRating(Number(e.key));
  }
}

function initMediaGrid() {
  mediaGridCreateEntryButton();
  mediaGridCreateModal();
  document.addEventListener('keydown', mediaGridHandleKeydown);
}

initMediaGrid();

window.openMediaGridModal = openMediaGridModal;
