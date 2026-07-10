var mediaGridState = {
  open: false,
  presentation: '',
  items: [],
  baseItems: [],
  focusSets: [],
  focusSetKey: 'all',
  railCollapsed: false,
  pruning: false,
  selectedKeys: new Set(),
  lastSelectedKey: '',
  status: '',
  viewerKey: '',
  previousWorkspaceState: null
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

function mediaGridIsModalMode() {
  return mediaGridState.open && mediaGridState.presentation === 'modal';
}

function mediaGridIsSurfaceMode() {
  return mediaGridState.open && mediaGridState.presentation === 'surface';
}

function mediaGridGetActiveCanvasEl() {
  if (mediaGridIsSurfaceMode()) {
    return mediaGridGetSurfaceEls().canvas;
  }
  return mediaGridGetEls().canvas;
}

function mediaGridBuildMetaText() {
  var activeSet = mediaGridGetActiveFocusSet();
  var selectedCount = mediaGridState.selectedKeys.size;
  var totalCount = mediaGridState.items.length;
  var bits = [mediaGridGetSourceLabel()];
  if (activeSet && activeSet.key !== 'all') {
    bits.push(activeSet.label);
  }
  bits.push(totalCount + ' item' + (totalCount === 1 ? '' : 's'));
  bits.push(selectedCount + ' selected');
  return bits.join(' - ');
}

function mediaGridBuildSurfaceMetaText() {
  var activeSet = mediaGridGetActiveFocusSet();
  var selectedCount = mediaGridState.selectedKeys.size;
  var totalCount = mediaGridState.items.length;
  var bits = [];
  if (activeSet && activeSet.key !== 'all') {
    bits.push(activeSet.label);
  }
  bits.push(totalCount + ' item' + (totalCount === 1 ? '' : 's'));
  bits.push(selectedCount + ' selected');
  return bits.join(' - ');
}

function mediaGridResetSessionState() {
  mediaGridState.open = false;
  mediaGridState.presentation = '';
  mediaGridState.items = [];
  mediaGridState.baseItems = [];
  mediaGridState.focusSets = [];
  mediaGridState.focusSetKey = 'all';
  mediaGridState.pruning = false;
  mediaGridState.selectedKeys = new Set();
  mediaGridState.lastSelectedKey = '';
  mediaGridState.status = '';
  mediaGridState.viewerKey = '';
  mediaGridState.previousWorkspaceState = null;
}

function mediaGridBeginSession(presentation) {
  mediaGridState.open = true;
  mediaGridState.presentation = presentation;
  mediaGridState.focusSetKey = 'all';
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

function mediaGridHideModalShell() {
  var els = mediaGridGetEls();
  if (els.modal) {
    els.modal.classList.add('hidden');
    els.modal.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('media-grid-open');
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
  if (mediaGridIsSurfaceMode()) {
    closeMediaGridSurface();
    return true;
  }
  if (mediaGridIsModalMode()) {
    closeMediaGridModal();
    return true;
  }
  return false;
}

function mediaGridSetStatus(text) {
  mediaGridState.status = String(text || '');
  var els = mediaGridGetEls();
  if (els.status) {
    els.status.textContent = mediaGridState.status;
  }
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

