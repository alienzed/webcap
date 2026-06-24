var mediaGridState = {
  open: false,
  items: [],
  baseItems: [],
  focusSets: [],
  focusSetKey: 'all',
  railCollapsed: false,
  selectedKeys: new Set(),
  lastSelectedKey: '',
  status: '',
  viewerKey: ''
};

var MEDIA_GRID_FOCUS_SET_DEFS = [
  {
    key: 'all',
    label: 'All',
    why: 'Keep the current working scope intact.',
    signals: 'Uses the current visible Grid scope after shared list filters and any active app focus set.',
    bias: 'Not a precision subset. Includes everything currently in scope.'
  },
  {
    key: 'suggested',
    label: 'Suggested',
    why: 'Start with the conservative keepers the app already trusts most.',
    signals: 'Existing Suggested Candidates blend of face focus, pose coverage, expression, and scene simplicity.',
    bias: 'Precision-first. May omit strong but unusual frames.'
  },
  {
    key: 'face_close',
    label: 'Face Close',
    why: 'Close face crops are often the quickest quality/readability pass.',
    signals: 'Face focus bucket close with one plausible detected face.',
    bias: 'Misses medium/body shots and any image where the face detector stayed unknown.'
  },
  {
    key: 'front_keepers',
    label: 'Front Keepers',
    why: 'Front-facing portraits are usually high-utility anchor shots.',
    signals: 'Face direction front, body orientation front or three_quarter, single-face usable focus bucket.',
    bias: 'May miss good profile, rear, or multi-person shots.'
  },
  {
    key: 'three_quarter_keepers',
    label: '3/4 Keepers',
    why: 'Three-quarter portraits often read well while keeping some shape and depth.',
    signals: 'Face direction three_quarter_left or three_quarter_right, body orientation front or three_quarter, single-face usable focus bucket.',
    bias: 'Can miss strong side views or looser portraits.'
  },
  {
    key: 'hands_near_face',
    label: 'Hands Near Face',
    why: 'Hands near the face often create expressive or useful gesture variants.',
    signals: 'Selection pose arm position hands_near_face.',
    bias: 'Only as good as the pose analyzer on the current framing.'
  },
  {
    key: 'arms_up_gesture',
    label: 'Arms Up / Gesture',
    why: 'Raised or spread arms tend to produce distinct action silhouettes.',
    signals: 'Selection pose arm position both_up, one_up, or arms_out.',
    bias: 'May miss subtler gestures or mislabeled arm positions.'
  },
  {
    key: 'simple_background_portraits',
    label: 'Simple Background Portraits',
    why: 'Cleaner portrait backgrounds are often faster to review and more reusable.',
    signals: 'Scene complexity simple plus single-face close or medium face focus.',
    bias: 'Will skip useful shots with intentionally busy environments.'
  },
  {
    key: 'standing',
    label: 'Standing',
    why: 'Standing shots are a common full-pose curation slice.',
    signals: 'Selection pose class standing.',
    bias: 'Misses standing images when pose metadata is unknown.'
  },
  {
    key: 'seated',
    label: 'Seated',
    why: 'Seated shots often cluster into a distinct composition family.',
    signals: 'Selection pose class seated.',
    bias: 'Misses borderline or mixed seated poses.'
  },
  {
    key: 'kneeling_crouched',
    label: 'Kneeling / Crouched',
    why: 'Compressed poses are easy to miss without an explicit slice.',
    signals: 'Selection pose class kneeling_crouched.',
    bias: 'Depends on pose metadata being confident enough to separate from standing or seated.'
  },
  {
    key: 'reclining',
    label: 'Reclining',
    why: 'Reclining shots are compositionally distinct and worth isolating.',
    signals: 'Selection pose class reclining.',
    bias: 'Misses reclining images when the pose model falls back to unknown.'
  }
];

function mediaGridGetEls() {
  return {
    modal: document.getElementById('media-grid-modal'),
    meta: document.getElementById('media-grid-meta'),
    status: document.getElementById('media-grid-status'),
    filters: document.getElementById('media-grid-filters'),
    rail: document.getElementById('media-grid-left-rail'),
    railHint: document.getElementById('media-grid-rail-hint'),
    railCollapseBtn: document.getElementById('media-grid-rail-collapse-btn'),
    focusMeta: document.getElementById('media-grid-focus-meta'),
    focusLoading: document.getElementById('media-grid-focus-loading'),
    focusList: document.getElementById('media-grid-focus-list'),
    activeSet: document.getElementById('media-grid-active-set'),
    canvas: document.getElementById('media-grid-canvas'),
    sidebar: document.getElementById('media-grid-sidebar'),
    selectAllBtn: document.getElementById('media-grid-select-all-btn'),
    clearBtn: document.getElementById('media-grid-clear-btn'),
    closeBtn: document.getElementById('media-grid-close-btn'),
    viewerModal: document.getElementById('media-grid-viewer-modal'),
    viewerTitle: document.getElementById('media-grid-viewer-title'),
    viewerTitleName: document.getElementById('media-grid-viewer-title-name'),
    viewerTitleCaption: document.getElementById('media-grid-viewer-title-caption'),
    viewerStage: document.getElementById('media-grid-viewer-stage'),
    viewerCloseBtn: document.getElementById('media-grid-viewer-close-btn')
  };
}

function mediaGridSetStatus(text) {
  mediaGridState.status = String(text || '');
  var els = mediaGridGetEls();
  if (els.status) {
    els.status.textContent = mediaGridState.status;
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

function mediaGridGetMetadataRow(mediaItem) {
  if (!mediaItem || !mediaItem.metadata || typeof mediaItem.metadata !== 'object') return null;
  return mediaItem.metadata;
}

function mediaGridGetFaceFocus(mediaItem) {
  var row = mediaGridGetMetadataRow(mediaItem);
  return (typeof getFaceFocusFromMetadata === 'function') ? getFaceFocusFromMetadata(row) : null;
}

function mediaGridGetSelectionPose(mediaItem) {
  var row = mediaGridGetMetadataRow(mediaItem);
  return (typeof getSelectionPoseFromMetadata === 'function') ? getSelectionPoseFromMetadata(row) : null;
}

function mediaGridGetSceneComplexity(mediaItem) {
  var row = mediaGridGetMetadataRow(mediaItem);
  return (typeof getSceneComplexityFromMetadata === 'function') ? getSceneComplexityFromMetadata(row) : null;
}

function mediaGridNormalizeValue(value) {
  return String(value || '').trim().toLowerCase();
}

function mediaGridGetFaceFocusBucket(mediaItem) {
  var focus = mediaGridGetFaceFocus(mediaItem);
  if (!focus) return 'unknown';
  if (typeof normalizeFaceFocusBucket === 'function') {
    return normalizeFaceFocusBucket(focus.bucket);
  }
  return mediaGridNormalizeValue(focus.bucket) || 'unknown';
}

function mediaGridHasUsableSingleFace(mediaItem) {
  var focus = mediaGridGetFaceFocus(mediaItem);
  var bucket = mediaGridGetFaceFocusBucket(mediaItem);
  var faceCount = focus ? Number(focus.face_count) : 0;
  return (bucket === 'close' || bucket === 'medium' || bucket === 'body') && faceCount === 1;
}

function mediaGridGetPoseValue(mediaItem, key) {
  var pose = mediaGridGetSelectionPose(mediaItem);
  return mediaGridNormalizeValue(pose && pose[key]);
}

function mediaGridGetSceneBucket(mediaItem) {
  var scene = mediaGridGetSceneComplexity(mediaItem);
  return mediaGridNormalizeValue(scene && scene.bucket);
}

function mediaGridBuildSuggestedLookup(baseItems) {
  var lookup = {};
  if (typeof buildSuggestedSelectionRows !== 'function') return lookup;
  var rows = [];
  var scopedFileNames = [];
  baseItems.forEach(function (item) {
    var row = mediaGridGetMetadataRow(item);
    if (!row || !item.fileName) return;
    rows.push(row);
    scopedFileNames.push(item.fileName);
  });
  var suggestionRows = buildSuggestedSelectionRows(rows, scopedFileNames);
  if (!suggestionRows || !suggestionRows.length || !Array.isArray(suggestionRows[0].files)) {
    return lookup;
  }
  suggestionRows[0].files.forEach(function (fileName) {
    lookup[String(fileName || '')] = true;
  });
  return lookup;
}

function mediaGridFocusSetMatches(def, mediaItem, context) {
  var faceBucket = mediaGridGetFaceFocusBucket(mediaItem);
  var faceDirection = mediaGridGetPoseValue(mediaItem, 'face_direction');
  var bodyOrientation = mediaGridGetPoseValue(mediaItem, 'body_orientation');
  var poseClass = mediaGridGetPoseValue(mediaItem, 'pose_class');
  var armPosition = mediaGridGetPoseValue(mediaItem, 'arm_position');
  var sceneBucket = mediaGridGetSceneBucket(mediaItem);
  var isSingleFaceUsable = mediaGridHasUsableSingleFace(mediaItem);

  if (def.key === 'all') return true;
  if (def.key === 'suggested') {
    return !!(context && context.suggestedLookup && context.suggestedLookup[String(mediaItem.fileName || '')]);
  }
  if (def.key === 'face_close') {
    return faceBucket === 'close' && isSingleFaceUsable;
  }
  if (def.key === 'front_keepers') {
    return isSingleFaceUsable &&
      faceDirection === 'front' &&
      (bodyOrientation === 'front' || bodyOrientation === 'three_quarter');
  }
  if (def.key === 'three_quarter_keepers') {
    return isSingleFaceUsable &&
      (faceDirection === 'three_quarter_left' || faceDirection === 'three_quarter_right') &&
      (bodyOrientation === 'front' || bodyOrientation === 'three_quarter');
  }
  if (def.key === 'hands_near_face') {
    return armPosition === 'hands_near_face';
  }
  if (def.key === 'arms_up_gesture') {
    return armPosition === 'both_up' || armPosition === 'one_up' || armPosition === 'arms_out';
  }
  if (def.key === 'simple_background_portraits') {
    return isSingleFaceUsable &&
      (faceBucket === 'close' || faceBucket === 'medium') &&
      sceneBucket === 'simple';
  }
  if (def.key === 'standing') return poseClass === 'standing';
  if (def.key === 'seated') return poseClass === 'seated';
  if (def.key === 'kneeling_crouched') return poseClass === 'kneeling_crouched';
  if (def.key === 'reclining') return poseClass === 'reclining';
  return false;
}

function mediaGridBuildFocusSetTooltip(entry) {
  return entry.label +
    '\nWhy: ' + entry.why +
    '\nSignals: ' + entry.signals +
    '\nBias: ' + entry.bias;
}

function mediaGridBuildFocusSets(baseItems) {
  var context = {
    suggestedLookup: mediaGridBuildSuggestedLookup(baseItems)
  };
  return MEDIA_GRID_FOCUS_SET_DEFS.map(function (def) {
    var matchedItems = baseItems.filter(function (item) {
      return mediaGridFocusSetMatches(def, item, context);
    });
    return {
      key: def.key,
      label: def.label,
      why: def.why,
      signals: def.signals,
      bias: def.bias,
      count: matchedItems.length,
      itemKeys: matchedItems.map(function (item) { return item.key; }),
      tooltip: mediaGridBuildFocusSetTooltip(def)
    };
  });
}

function mediaGridGetActiveFocusSet() {
  var focusSets = Array.isArray(mediaGridState.focusSets) ? mediaGridState.focusSets : [];
  for (var i = 0; i < focusSets.length; i++) {
    if (focusSets[i].key === mediaGridState.focusSetKey) return focusSets[i];
  }
  return focusSets[0] || null;
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
  var baseItems = mediaGridGetVisibleItems();
  var focusSets = mediaGridBuildFocusSets(baseItems);
  mediaGridState.baseItems = baseItems;
  mediaGridState.focusSets = focusSets;
  if (!mediaGridState.focusSetKey) {
    mediaGridState.focusSetKey = 'all';
  }
  var activeSet = mediaGridGetActiveFocusSet();
  if (!activeSet) {
    mediaGridState.focusSetKey = 'all';
    activeSet = mediaGridGetActiveFocusSet();
  }
  if (activeSet && activeSet.key !== 'all' && activeSet.count <= 0 && baseItems.length > 0) {
    mediaGridState.focusSetKey = 'all';
    activeSet = mediaGridGetActiveFocusSet();
  }
  var allowed = {};
  if (activeSet && Array.isArray(activeSet.itemKeys)) {
    activeSet.itemKeys.forEach(function (key) {
      allowed[key] = true;
    });
  }
  var nextItems = baseItems.filter(function (item) {
    return !!allowed[item.key];
  });
  mediaGridPruneSelectionToItems(nextItems);
  mediaGridState.items = nextItems;
}

function mediaGridCreateEntryButton() {
  if (ui && ui.sidebarGridBtnEl) {
    ui.sidebarGridBtnEl.onclick = openMediaGridModal;
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
  btn.onclick = openMediaGridModal;
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
    sidebarBtn.disabled = !hasVisibleMedia;
    sidebarBtn.title = hasFocusSet
      ? 'Open Media Grid for the current focus set'
      : 'Open Media Grid for the current visible items';
  }
  if (focusBtn) {
    focusBtn.classList.toggle('hidden', !(hasVisibleMedia && hasFocusSet));
  }
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
        '<aside id="media-grid-left-rail" class="media-grid-left-rail" aria-label="Focus sets">' +
          '<div class="media-grid-rail-panel">' +
            '<div class="media-grid-rail-header">' +
              '<div id="media-grid-rail-hint" class="media-grid-rail-hint"></div>' +
              '<button id="media-grid-rail-collapse-btn" type="button" class="media-grid-rail-collapse-btn" aria-label="Collapse left rail"></button>' +
            '</div>' +
            '<section class="media-grid-rail-section media-grid-focus-section">' +
              '<div class="media-grid-rail-section-head">' +
                '<div class="media-grid-rail-section-title">Focus Sets</div>' +
                '<div id="media-grid-focus-meta" class="media-grid-rail-section-meta"></div>' +
              '</div>' +
              '<div id="media-grid-focus-loading" class="media-grid-rail-section-note hidden"></div>' +
              '<div id="media-grid-focus-list" class="media-grid-focus-list"></div>' +
            '</section>' +
          '</div>' +
        '</aside>' +
        '<div class="media-grid-main-column">' +
          '<div id="media-grid-active-set" class="media-grid-active-set"></div>' +
          '<main id="media-grid-canvas" class="media-grid-canvas" aria-label="Media thumbnails"></main>' +
        '</div>' +
        '<aside id="media-grid-sidebar" class="media-grid-sidebar" aria-label="Selection actions and grouped tags"></aside>' +
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
  if (!els.railCollapseBtn) throw new Error('Media Grid rail controls are missing.');
  els.railCollapseBtn.addEventListener('click', function () {
    mediaGridSetRailCollapsed(!mediaGridState.railCollapsed);
  });
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
        '<div id="media-grid-viewer-title" class="media-grid-viewer-title">' +
          '<span id="media-grid-viewer-title-name" class="media-grid-viewer-title-name"></span>' +
          '<span id="media-grid-viewer-title-caption" class="media-grid-viewer-title-caption hidden"></span>' +
        '</div>' +
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
  mediaGridState.focusSetKey = 'all';
  mediaGridState.selectedKeys = new Set();
  mediaGridState.lastSelectedKey = '';
  mediaGridState.status = '';
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
  if (typeof setWorkspaceWorkflowMode === 'function') {
    setWorkspaceWorkflowMode('select');
  }
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
  mediaGridState.baseItems = [];
  mediaGridState.focusSets = [];
  mediaGridState.focusSetKey = 'all';
  mediaGridState.selectedKeys = new Set();
  mediaGridState.lastSelectedKey = '';
  mediaGridState.status = '';
  mediaGridState.viewerKey = '';
  if (typeof setWorkspaceViewMode === 'function') {
    setWorkspaceViewMode('single');
  }
}

function renderMediaGridModal() {
  if (!mediaGridState.open) return;
  mediaGridSyncItemsToCurrentView();
  renderMediaGridHeader();
  renderMediaGridLeftRail();
  renderMediaGridActiveScope();
  renderMediaGridCanvas();
  renderMediaGridSidebar();
}

function renderMediaGridHeader() {
  var els = mediaGridGetEls();
  var activeSet = mediaGridGetActiveFocusSet();
  var selectedCount = mediaGridState.selectedKeys.size;
  var totalCount = mediaGridState.items.length;
  var bits = [mediaGridGetSourceLabel()];
  if (activeSet && activeSet.key !== 'all') {
    bits.push(activeSet.label);
  }
  bits.push(totalCount + ' item' + (totalCount === 1 ? '' : 's'));
  bits.push(selectedCount + ' selected');
  els.meta.textContent = bits.join(' - ');
  els.clearBtn.disabled = selectedCount <= 0;
  els.selectAllBtn.disabled = totalCount <= 0 || selectedCount === totalCount;
  els.status.textContent = mediaGridState.status;
  mediaGridSyncFilterControls();
}

function mediaGridBuildFilterControls() {
  var els = mediaGridGetEls();
  if (!els.filters) throw new Error('Media Grid filters target is missing.');
  els.filters.innerHTML =
    '<div class="media-grid-filter-bar" aria-label="Grid filters">' +
      '<label class="media-grid-search-field media-grid-search-field-inline">' +
        '<span class="media-grid-filter-label">Search</span>' +
        '<input id="media-grid-filter-search" type="search" placeholder="filter (comma terms, -exclude)">' +
      '</label>' +
      '<label class="media-grid-filter-toggle"><input id="media-grid-filter-unreviewed" type="checkbox"><span>Unreviewed</span></label>' +
      '<label class="media-grid-filter-toggle"><input id="media-grid-filter-invalid-ar" type="checkbox"><span>Invalid AR</span></label>' +
      '<div class="media-grid-filter-divider" aria-hidden="true"></div>' +
      '<div class="media-grid-filter-rating-block">' +
        '<span class="media-grid-filter-subtitle">Stars</span>' +
        '<div id="media-grid-filter-stars" class="media-grid-filter-stars" aria-label="Rating filters"></div>' +
      '</div>' +
      '<div class="media-grid-filter-rating-block">' +
        '<span class="media-grid-filter-subtitle">Flags</span>' +
        '<div id="media-grid-filter-flags" class="media-grid-filter-stars" aria-label="Flag filters"></div>' +
      '</div>' +
      '<span id="media-grid-other-filters" class="media-grid-other-filters hidden">Other list filters active</span>' +
    '</div>';

  mediaGridBuildStarsFilter();
  mediaGridBuildFlagsFilter();

  var searchInput = document.getElementById('media-grid-filter-search');
  var unreviewedInput = document.getElementById('media-grid-filter-unreviewed');
  var invalidArInput = document.getElementById('media-grid-filter-invalid-ar');
  if (!searchInput || !unreviewedInput || !invalidArInput) {
    throw new Error('Media Grid mirrored filter controls are missing.');
  }

  searchInput.addEventListener('input', function () {
    ui.filterEl.value = this.value;
    mediaGridDispatchInput(ui.filterEl);
  });
  unreviewedInput.addEventListener('change', function () {
    ui.advancedFilterUnreviewedEl.checked = this.checked;
    mediaGridDispatchChange(ui.advancedFilterUnreviewedEl);
  });
  invalidArInput.addEventListener('change', function () {
    ui.advancedFilterInvalidArEl.checked = this.checked;
    mediaGridDispatchChange(ui.advancedFilterInvalidArEl);
  });
}

function mediaGridBuildStarsFilter() {
  var target = document.getElementById('media-grid-filter-stars');
  if (!target) return;
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

function mediaGridBuildFlagsFilter() {
  var target = document.getElementById('media-grid-filter-flags');
  if (!target) return;
  target.innerHTML = '';
  var defs = [
    { value: 'no_flag', title: 'Show items with no flag', text: '-' },
    { value: 'red', title: 'Show red-flagged items', dot: 'red' },
    { value: 'green', title: 'Show green-flagged items', dot: 'green' },
    { value: 'blue', title: 'Show blue-flagged items', dot: 'blue' },
    { value: 'yellow', title: 'Show yellow-flagged items', dot: 'yellow' },
    { value: 'orange', title: 'Show orange-flagged items', dot: 'orange' }
  ];
  defs.forEach(function (def) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'media-grid-filter-chip media-grid-filter-flag';
    btn.setAttribute('data-filter-value', def.value);
    btn.title = def.title;
    if (def.dot) {
      btn.innerHTML = '<span class="flag-dot flag-dot--' + def.dot + '"></span>';
    } else {
      btn.textContent = def.text;
    }
    btn.onclick = function () {
      mediaGridToggleMirroredCheckbox(ui.advancedFilterFlagEl, def.value);
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

function mediaGridGetMirroredFilterCount() {
  var count = 0;
  if (String(ui.filterEl.value || '').trim()) count += 1;
  if (ui.advancedFilterUnreviewedEl.checked) count += 1;
  if (ui.advancedFilterInvalidArEl.checked) count += 1;
  if (getAdvancedStarFilterValues().length) count += 1;
  if (getAdvancedFlagFilterValues().length) count += 1;
  return count;
}

function mediaGridSyncFilterControls() {
  var searchInput = document.getElementById('media-grid-filter-search');
  var unreviewedInput = document.getElementById('media-grid-filter-unreviewed');
  var invalidArInput = document.getElementById('media-grid-filter-invalid-ar');
  if (!searchInput || !unreviewedInput || !invalidArInput) return;
  searchInput.value = String(ui.filterEl.value || '');
  unreviewedInput.checked = !!ui.advancedFilterUnreviewedEl.checked;
  invalidArInput.checked = !!ui.advancedFilterInvalidArEl.checked;
  mediaGridSyncFilterToggle('media-grid-filter-unreviewed');
  mediaGridSyncFilterToggle('media-grid-filter-invalid-ar');
  mediaGridSyncFilterChipGroup('media-grid-filter-stars', getAdvancedStarFilterValues());
  mediaGridSyncFilterChipGroup('media-grid-filter-flags', getAdvancedFlagFilterValues());
  var hiddenFiltersActive = !!(
    ui.advancedFilterMissingCaptionsEl.checked ||
    ui.advancedFilterReviewedEl.checked ||
    ui.advancedFilterIncompleteEl.checked ||
    ui.advancedFilterUntaggedEl.checked ||
    ui.advancedFilterSupersetEl.checked
  );
  var otherFiltersHint = document.getElementById('media-grid-other-filters');
  if (otherFiltersHint) {
    otherFiltersHint.classList.toggle('hidden', !hiddenFiltersActive);
  }
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
  var container = document.getElementById(containerId);
  if (!container) return;
  var buttons = container.querySelectorAll('[data-filter-value]');
  for (var i = 0; i < buttons.length; i++) {
    var value = buttons[i].getAttribute('data-filter-value');
    buttons[i].classList.toggle('active', !!active[value]);
  }
}

function mediaGridSetRailCollapsed(collapsed) {
  mediaGridState.railCollapsed = !!collapsed;
  renderMediaGridLeftRail();
}

function mediaGridRenderFocusList() {
  var els = mediaGridGetEls();
  if (!els.focusList) return;
  els.focusList.innerHTML = '';
  var activeSet = mediaGridGetActiveFocusSet();
  (mediaGridState.focusSets || []).filter(function (entry) {
    return entry && entry.count > 0;
  }).forEach(function (entry) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'media-grid-focus-btn' + (activeSet && activeSet.key === entry.key ? ' active' : '');
    btn.title = entry.tooltip;
    btn.onclick = function () {
      mediaGridState.focusSetKey = entry.key;
      renderMediaGridModal();
    };

    var labelWrap = document.createElement('span');
    labelWrap.className = 'media-grid-focus-btn-main';
    var label = document.createElement('span');
    label.className = 'media-grid-focus-btn-label';
    label.textContent = entry.label;
    labelWrap.appendChild(label);
    btn.appendChild(labelWrap);

    var count = document.createElement('span');
    count.className = 'media-grid-focus-btn-count';
    count.textContent = String(entry.count);
    btn.appendChild(count);

    els.focusList.appendChild(btn);
  });
}

function renderMediaGridLeftRail() {
  var els = mediaGridGetEls();
  if (!els.rail || !els.railCollapseBtn) return;
  els.rail.classList.toggle('is-collapsed', !!mediaGridState.railCollapsed);
  els.railHint.textContent = mediaGridState.baseItems.length + ' visible in ' + mediaGridGetSourceLabel();
  els.railCollapseBtn.textContent = mediaGridState.railCollapsed ? '>' : '<';
  els.railCollapseBtn.title = mediaGridState.railCollapsed ? 'Expand left rail' : 'Collapse left rail';
  els.railCollapseBtn.setAttribute('aria-label', mediaGridState.railCollapsed ? 'Expand left rail' : 'Collapse left rail');
  els.focusMeta.textContent = mediaGridState.baseItems.length + ' visible';
  var loading = typeof isMediaMetadataLoading === 'function' && isMediaMetadataLoading();
  els.focusLoading.textContent = loading ? 'Metadata-driven sets will sharpen as analysis finishes.' : '';
  els.focusLoading.classList.toggle('hidden', !loading);
  mediaGridRenderFocusList();
}

function renderMediaGridActiveScope() {
  var els = mediaGridGetEls();
  if (!els.activeSet) return;
  els.activeSet.innerHTML = '';
  var activeSet = mediaGridGetActiveFocusSet();
  if (!activeSet) return;

  var titleWrap = document.createElement('div');
  titleWrap.className = 'media-grid-active-set-copy';

  var title = document.createElement('div');
  title.className = 'media-grid-active-set-title';
  title.textContent = activeSet.label;
  title.title = activeSet.tooltip;
  titleWrap.appendChild(title);

  var meta = document.createElement('div');
  meta.className = 'media-grid-active-set-meta';
  if (activeSet.key === 'all') {
    meta.textContent = mediaGridState.items.length + ' visible in the current working scope';
  } else {
    meta.textContent = mediaGridState.items.length + ' of ' + mediaGridState.baseItems.length + ' visible match this focus set';
  }
  titleWrap.appendChild(meta);
  els.activeSet.appendChild(titleWrap);

  var scopeBadge = document.createElement('div');
  scopeBadge.className = 'media-grid-active-set-badge';
  scopeBadge.textContent = mediaGridGetSourceLabel();
  els.activeSet.appendChild(scopeBadge);
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

function mediaGridOpenItemInMainWorkspace(mediaKey) {
  var item = mediaGridFindItemByKey(mediaKey);
  if (!item) {
    mediaGridSetStatus('Item is no longer visible in Grid.');
    return;
  }
  closeMediaGridModal();
  selectByFileName(item.fileName);
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

function mediaGridBuildViewerTitleParts(mediaItem) {
  var fileName = String((mediaItem && mediaItem.fileName) || (mediaItem && mediaItem.label) || '').trim();
  var caption = String((mediaItem && mediaItem.caption) || '')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    fileName: fileName,
    caption: caption
  };
}

function openMediaGridViewer(mediaKey) {
  var item = mediaGridFindItemByKey(mediaKey);
  if (!item) {
    mediaGridSetStatus('Item is no longer visible in Grid.');
    return;
  }
  var els = mediaGridGetEls();
  if (!els.viewerModal || !els.viewerStage || !els.viewerTitle || !els.viewerTitleName || !els.viewerTitleCaption) throw new Error('Media Grid viewer is missing.');
  mediaGridState.viewerKey = item.key;
  var titleParts = mediaGridBuildViewerTitleParts(item);
  els.viewerTitleName.textContent = titleParts.fileName;
  els.viewerTitleCaption.textContent = titleParts.caption ? '| ' + titleParts.caption : '';
  els.viewerTitleCaption.classList.toggle('hidden', !titleParts.caption);
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
  if (!mediaGridState.open) return;
  renderMediaGridModal();
}

function mediaGridRefreshFromCurrentFilters() {
  if (!mediaGridState.open) return;
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
  sectionTitle.textContent = 'Tags';
  els.sidebar.appendChild(sectionTitle);

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
