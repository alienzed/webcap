function renderMediaGridCanvas() {
  var canvas = mediaGridGetActiveCanvasEl();
  if (!canvas) return;
  canvas.innerHTML = '';
  if (!mediaGridState.items.length) {
    var empty = document.createElement('div');
    empty.className = 'media-grid-empty media-grid-empty-main';
    empty.textContent = 'No items remain in this Grid view.';
    canvas.appendChild(empty);
    return;
  }
  var grid = document.createElement('div');
  grid.className = 'media-grid-items';
  mediaGridState.items.forEach(function (item) {
    grid.appendChild(mediaGridBuildTile(item));
  });
  canvas.appendChild(grid);
}

function mediaGridOpenItemInMainWorkspace(mediaKey) {
  var item = mediaGridFindItemByKey(mediaKey);
  if (!item) {
    mediaGridSetStatus('Item is no longer visible in Grid.');
    return;
  }
  mediaGridCloseActivePresentation();
  selectByFileName(item.fileName, null, null, null, { preserveMediaFilters: true });
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
    mediaGridOpenItemInMainWorkspace(mediaItem.key);
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
  var canvas = mediaGridGetActiveCanvasEl();
  if (!canvas) return;
  var tiles = canvas.querySelectorAll('.media-grid-tile[data-key]');
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

function mediaGridGetSelectedKeysSnapshot() {
  return Array.from(mediaGridState.selectedKeys || []);
}

function mediaGridGetVisibleKeysSnapshot() {
  var keys = [];
  (Array.isArray(mediaGridState.items) ? mediaGridState.items : []).forEach(function (item) {
    if (item && item.key) keys.push(item.key);
  });
  return keys;
}

function mediaGridRenderSelectionState() {
  if (mediaGridIsSurfaceMode()) {
    renderMediaGridSurfaceHeader();
  } else {
    renderMediaGridHeader();
  }
  mediaGridSyncSelectionDisplay();
  if (mediaGridIsModalMode()) {
    renderMediaGridSidebar();
  }
  mediaGridRenderSharedWorkbench();
}

function mediaGridRenderSharedWorkbench() {
  var targetEl = mediaGridIsSurfaceMode()
    ? document.getElementById('group-workbench-list')
    : (document.getElementById('media-grid-group-workbench-list') || document.getElementById('group-workbench-list'));
  renderGroupWorkbench({
    mode: 'grid',
    targetEl: targetEl,
    mediaKeys: mediaGridGetSelectedKeysSnapshot(),
    getMediaKeys: mediaGridGetSelectedKeysSnapshot,
    contextMediaKeys: mediaGridGetVisibleKeysSnapshot(),
    getContextMediaKeys: mediaGridGetVisibleKeysSnapshot,
    onAfterMutation: function () {
      if (typeof mediaGridRefreshAfterMutation === 'function') mediaGridRefreshAfterMutation();
      else if (typeof mediaGridRenderSelectionState === 'function') mediaGridRenderSelectionState();
    }
  });
}

function mediaGridHandleTileContextMenu(mediaItem, e) {
  e.preventDefault();
  e.stopPropagation();
  mediaGridMarkContextTarget(mediaItem.key);
  var key = mediaItem.key || mediaItem.fileName;
  var actions = buildMediaContextMenuActions(mediaItem, key).map(function (action) {
    if (!action || action.separator) return action;
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
  var canvas = mediaGridGetActiveCanvasEl();
  if (!canvas) return;
  var tiles = canvas.querySelectorAll('.media-grid-tile.context-target');
  for (var i = 0; i < tiles.length; i++) {
    tiles[i].classList.remove('context-target');
  }
}

function mediaGridMarkContextTarget(mediaKey) {
  var canvas = mediaGridGetActiveCanvasEl();
  if (!canvas) return;
  mediaGridClearContextTarget();
  var key = String(mediaKey || '').replace(/"/g, '\\"');
  var target = canvas.querySelector('.media-grid-tile[data-key="' + key + '"]');
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

function mediaGridFindTileByKey(mediaKey) {
  var canvas = mediaGridGetActiveCanvasEl();
  if (!canvas) return null;
  var tiles = canvas.querySelectorAll('.media-grid-tile[data-key]');
  for (var i = 0; i < tiles.length; i++) {
    if (tiles[i].getAttribute('data-key') === mediaKey) return tiles[i];
  }
  return null;
}

function mediaGridFindArrowTarget(currentTile, key) {
  var canvas = mediaGridGetActiveCanvasEl();
  if (!canvas || !currentTile) return null;
  var current = currentTile.getBoundingClientRect();
  var currentX = current.left + current.width / 2;
  var currentY = current.top + current.height / 2;
  var tiles = canvas.querySelectorAll('.media-grid-tile[data-key]');
  var best = null;
  var bestScore = Infinity;
  for (var i = 0; i < tiles.length; i++) {
    var tile = tiles[i];
    if (tile === currentTile) continue;
    var rect = tile.getBoundingClientRect();
    var x = rect.left + rect.width / 2;
    var y = rect.top + rect.height / 2;
    var dx = x - currentX;
    var dy = y - currentY;
    var primary;
    var secondary;
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      if ((key === 'ArrowLeft' && dx >= 0) || (key === 'ArrowRight' && dx <= 0)) continue;
      if (Math.abs(dy) > current.height / 2) continue;
      primary = Math.abs(dx);
      secondary = Math.abs(dy);
    } else {
      if ((key === 'ArrowUp' && dy >= 0) || (key === 'ArrowDown' && dy <= 0)) continue;
      primary = Math.abs(dy);
      secondary = Math.abs(dx);
    }
    var score = primary * 10 + secondary;
    if (score < bestScore) {
      best = tile;
      bestScore = score;
    }
  }
  return best;
}

function mediaGridMoveSingleSelectionByArrow(key) {
  if (mediaGridState.selectedKeys.size !== 1) return false;
  var selectedKey = Array.from(mediaGridState.selectedKeys)[0];
  var currentTile = mediaGridFindTileByKey(selectedKey);
  var targetTile = mediaGridFindArrowTarget(currentTile, key);
  if (!targetTile) return true;
  var targetKey = targetTile.getAttribute('data-key');
  mediaGridState.selectedKeys = new Set([targetKey]);
  mediaGridState.lastSelectedKey = targetKey;
  mediaGridClearContextTarget();
  mediaGridRenderSelectionState();
  targetTile.focus();
  return true;
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
