var focusedCaptionState = {
  open: false,
  folder: '',
  itemKeys: [],
  itemIndex: 0,
  itemKey: ''
};

var focusedCaptionPrefetch = null; // one-deep speculative { itemKey, index, fingerprint, jobId, promise, candidate, discarded }

function isFocusedCaptionOpen() {
  return !!focusedCaptionState.open;
}

function findFocusedCaptionMediaItemByKey(mediaKey) {
  var key = String(mediaKey || '').trim();
  if (!key || !state || !Array.isArray(state.items)) return null;
  for (var i = 0; i < state.items.length; i += 1) {
    var item = state.items[i];
    if (item && item.key === key) return item;
  }
  return null;
}

function getNextFocusedCaptionTarget(fromIndex) {
  var start = Math.max(-1, Number(fromIndex) || 0);
  for (var index = start + 1; index < focusedCaptionState.itemKeys.length; index += 1) {
    var itemKey = focusedCaptionState.itemKeys[index];
    var item = findFocusedCaptionMediaItemByKey(itemKey);
    if (item) return { index: index, itemKey: itemKey, item: item };
  }
  return null;
}

function cancelFocusedCaptionPrefetch() {
  var prefetch = focusedCaptionPrefetch;
  if (!prefetch) return Promise.resolve(false);
  focusedCaptionPrefetch = null;
  prefetch.discarded = true;
  if (
    captionAssistPendingJobId === prefetch.jobId ||
    (captionAssistPendingJobId === 'prefetch' && !prefetch.jobId)
  ) {
    captionAssistPendingJobId = '';
    updatePrimerCaptionResetUi();
  }
  if (!prefetch.jobId || prefetch.candidate) return Promise.resolve(true);
  return cancelCaptionAssistJob(prefetch.jobId).catch(function (err) {
    console.warn('[Focus Caption] Could not cancel speculative Caption Assist job:', err);
    return false;
  });
}

function startFocusedCaptionPrefetch(sourceMediaKey) {
  if (!focusedCaptionState.open) return Promise.resolve(false);
  if (String(focusedCaptionState.itemKey || '') !== String(sourceMediaKey || '')) return Promise.resolve(false);

  var target = getNextFocusedCaptionTarget(focusedCaptionState.itemIndex);
  if (!target) return cancelFocusedCaptionPrefetch();

  var request = buildCaptionAssistRequest(target.item);
  if (!request.model) return Promise.resolve(false);
  var fingerprint = captionAssistRequestFingerprint(target.item, request);
  if (
    focusedCaptionPrefetch &&
    focusedCaptionPrefetch.itemKey === target.itemKey &&
    focusedCaptionPrefetch.fingerprint === fingerprint
  ) {
    return focusedCaptionPrefetch.promise || Promise.resolve(!!focusedCaptionPrefetch.candidate);
  }

  return cancelFocusedCaptionPrefetch().then(function () {
    if (!focusedCaptionState.open || String(focusedCaptionState.itemKey || '') !== String(sourceMediaKey || '')) {
      return false;
    }
    var prefetch = {
      itemKey: target.itemKey,
      index: target.index,
      fingerprint: fingerprint,
      jobId: '',
      promise: null,
      candidate: null,
      discarded: false
    };
    focusedCaptionPrefetch = prefetch;
    prefetch.promise = requestCaptionAssistCandidate(target.item, request, {
      onJob: function (job) {
        prefetch.jobId = String(job.jobId || '');
        if (prefetch.discarded) return cancelCaptionAssistJob(prefetch.jobId);
        return null;
      }
    }).then(function (candidate) {
      if (prefetch.discarded || focusedCaptionPrefetch !== prefetch) return null;
      prefetch.candidate = candidate;
      return candidate;
    }).catch(function (err) {
      if (!prefetch.discarded && focusedCaptionPrefetch === prefetch) {
        focusedCaptionPrefetch = null;
        console.warn('[Focus Caption] Caption Assist prefetch failed:', err);
      }
      return null;
    });
    return prefetch.promise;
  });
}

function useFocusedCaptionPrefetchForCurrentItem() {
  var mediaItem = state && state.currentItem;
  var prefetch = focusedCaptionPrefetch;
  if (!prefetch) return Promise.resolve(false);
  if (
    !mediaItem ||
    mediaItem.key !== focusedCaptionState.itemKey ||
    prefetch.itemKey !== mediaItem.key ||
    prefetch.index !== focusedCaptionState.itemIndex
  ) {
    return cancelFocusedCaptionPrefetch().then(function () { return false; });
  }

  var currentRequest = buildCaptionAssistRequest(mediaItem);
  var currentFingerprint = captionAssistRequestFingerprint(mediaItem, currentRequest);
  if (currentFingerprint !== prefetch.fingerprint) {
    return cancelFocusedCaptionPrefetch().then(function () { return false; });
  }

  function presentCandidate(candidate) {
    if (!candidate || !focusedCaptionState.open || !state.currentItem || state.currentItem.key !== prefetch.itemKey) {
      return false;
    }
    var latestRequest = buildCaptionAssistRequest(state.currentItem);
    if (captionAssistRequestFingerprint(state.currentItem, latestRequest) !== prefetch.fingerprint) {
      focusedCaptionPrefetch = null;
      return false;
    }
    focusedCaptionPrefetch = null;
    candidate.missingGroups = getCaptionAssistMissingGroups(candidate.mediaKey);
    captionAssistCandidate = candidate;
    syncCaptionAssistCandidateUi();
    setStatus(
      candidate.omittedAssignments.length
        ? 'Caption Assist candidate failed annotation validation.'
        : 'AI caption candidate ready.'
    );
    startFocusedCaptionPrefetch(candidate.mediaKey);
    return true;
  }

  if (prefetch.candidate) return Promise.resolve(presentCandidate(prefetch.candidate));

  captionAssistPendingJobId = prefetch.jobId || 'prefetch';
  updatePrimerCaptionResetUi();
  setStatus('Caption Assist preloaded candidate finishing...');
  return prefetch.promise.then(function (candidate) {
    if (captionAssistPendingJobId === prefetch.jobId || captionAssistPendingJobId === 'prefetch') {
      captionAssistPendingJobId = '';
      updatePrimerCaptionResetUi();
    }
    return presentCandidate(candidate);
  });
}

function getFocusedCaptionEntryKeys(targetMediaKey) {
  var items = getFilteredMediaItems(false).filter(function (item) {
    return !!(item && item.key);
  });
  var keys = items.map(function (item) { return item.key; });
  if (!keys.length) return [];
  var targetKey = String(targetMediaKey || '').trim();
  var targetIndex = keys.indexOf(targetKey);
  if (targetIndex <= 0) return keys;
  return keys.slice(targetIndex).concat(keys.slice(0, targetIndex));
}

function syncFocusedCaptionControls() {
  var startBtn = ui.previewFocusCaptionBtnEl;
  var skipBtn = ui.previewFocusCaptionSkipBtnEl;
  if (!startBtn || !skipBtn) {
    throw new Error('Focus Caption controls are missing.');
  }

  var labelEl = startBtn.querySelector('.preview-header-btn-label');
  var glyphEl = startBtn.querySelector('.btn-glyph');
  var hasItem = !!(state && state.currentItem && state.currentItem.fileName);
  var annotationOpen = isFocusedAnnotationOpen();

  if (
    focusedCaptionState.open &&
    (!hasItem || String(focusedCaptionState.folder || '') !== String((state && state.folder) || ''))
  ) {
    focusedCaptionState.open = false;
    focusedCaptionState.folder = '';
    focusedCaptionState.itemKeys = [];
    focusedCaptionState.itemIndex = 0;
    focusedCaptionState.itemKey = '';
    cancelFocusedCaptionPrefetch();
    clearCaptionAssistCandidate();
  }

  if (!focusedCaptionState.open) {
    startBtn.classList.toggle('hidden', !hasItem || annotationOpen);
    startBtn.classList.remove('active');
    startBtn.setAttribute('aria-pressed', 'false');
    startBtn.setAttribute('aria-label', 'Start Focus Caption');
    startBtn.title = 'Focus Caption: generate and review AI caption candidates across the current visible items';
    if (glyphEl) glyphEl.textContent = '\u2728';
    if (labelEl) labelEl.textContent = 'Focus Caption';
    skipBtn.classList.add('hidden');
    skipBtn.disabled = false;
    return;
  }

  startBtn.classList.remove('hidden');
  startBtn.classList.add('active');
  startBtn.setAttribute('aria-pressed', 'true');
  startBtn.setAttribute('aria-label', 'Exit Focus Caption');
  startBtn.title = 'Exit Focus Caption (Esc)';
  if (glyphEl) glyphEl.textContent = '\u00d7';
  if (labelEl) {
    labelEl.textContent = 'Exit \u00b7 ' + (focusedCaptionState.itemIndex + 1) + ' / ' + focusedCaptionState.itemKeys.length;
  }
  skipBtn.classList.remove('hidden');
  skipBtn.disabled = isCaptionAssistRunning();
}

function syncFocusedCaptionAfterAssist(sourceMediaKey) {
  if (!focusedCaptionState.open || isCaptionAssistRunning()) return;
  if (!state.currentItem || state.currentItem.key !== focusedCaptionState.itemKey) return;
  if (state.currentItem.key === String(sourceMediaKey || '')) return;
  prepareFocusedCaptionCurrentItem();
}

function stopFocusedCaption(message) {
  if (!focusedCaptionState.open) return;
  focusedCaptionState.open = false;
  focusedCaptionState.folder = '';
  focusedCaptionState.itemKeys = [];
  focusedCaptionState.itemIndex = 0;
  focusedCaptionState.itemKey = '';
  cancelFocusedCaptionPrefetch();
  clearCaptionAssistCandidate();
  syncFocusedCaptionControls();
  renderPreviewHeaderMeta();
  if (message) setStatus(message);
}

function prepareFocusedCaptionCurrentItem() {
  if (!focusedCaptionState.open) return Promise.resolve(false);
  if (!state.currentItem || !state.currentItem.key) {
    stopFocusedCaption('Focus Caption stopped because there is no selected media item.');
    return Promise.resolve(false);
  }
  if (state.currentItem.key !== focusedCaptionState.itemKey) {
    return Promise.resolve(false);
  }

  clearCaptionAssistCandidate();
  syncFocusedCaptionControls();
  if (isCaptionAssistRunning()) {
    setStatus('Caption Assist is already running for this Focus Caption item.');
    return Promise.resolve(false);
  }
  return useFocusedCaptionPrefetchForCurrentItem().then(function (usedPrefetch) {
    if (usedPrefetch) return true;
    return runCaptionAssist();
  });
}

function syncFocusedCaptionSelection(mediaKey) {
  if (!focusedCaptionState.open) return;
  var key = String(mediaKey || '').trim();
  var index = focusedCaptionState.itemKeys.indexOf(key);
  if (index === -1) {
    stopFocusedCaption('Focus Caption ended because selection moved outside its captured scope.');
    return;
  }
  focusedCaptionState.itemIndex = index;
  focusedCaptionState.itemKey = key;
  prepareFocusedCaptionCurrentItem();
}

function navigateFocusedCaptionToIndex(index) {
  if (!focusedCaptionState.open) return Promise.resolve(false);
  if (index < 0 || index >= focusedCaptionState.itemKeys.length) {
    stopFocusedCaption('Focus Caption complete.');
    renderFileList();
    return Promise.resolve(false);
  }

  focusedCaptionState.itemIndex = index;
  focusedCaptionState.itemKey = focusedCaptionState.itemKeys[index];
  var targetItem = findFocusedCaptionMediaItemByKey(focusedCaptionState.itemKey);
  if (!targetItem) {
    return navigateFocusedCaptionToIndex(index + 1);
  }

  if (state.currentItem && state.currentItem.key === targetItem.key) {
    return prepareFocusedCaptionCurrentItem();
  }

  return selectPathMedia(targetItem).then(function () {
    return true;
  }).catch(function (err) {
    stopFocusedCaption('Focus Caption stopped: ' + String(err && err.message ? err.message : err));
    return false;
  });
}

function advanceFocusedCaption() {
  if (!focusedCaptionState.open) return Promise.resolve(false);
  return navigateFocusedCaptionToIndex(focusedCaptionState.itemIndex + 1);
}

function skipFocusedCaptionItem() {
  if (!focusedCaptionState.open) return Promise.resolve(false);
  if (isCaptionAssistRunning()) {
    setStatus('Caption Assist is still running; wait for this candidate before skipping.');
    return Promise.resolve(false);
  }
  clearCaptionAssistCandidate();
  return advanceFocusedCaption();
}

function startFocusedCaption(targetMediaKey) {
  if (isCaptionAssistRunning()) {
    setStatus('Finish the current Caption Assist request before starting Focus Caption.');
    return;
  }
  if (isFocusedAnnotationOpen()) {
    stopFocusedAnnotation();
  }

  var itemKeys = getFocusedCaptionEntryKeys(targetMediaKey);
  if (!itemKeys.length) {
    setStatus('No media items are available in the current visible scope.');
    return;
  }

  focusedCaptionState.open = true;
  focusedCaptionState.folder = String((state && state.folder) || '');
  focusedCaptionState.itemKeys = itemKeys;
  focusedCaptionState.itemIndex = 0;
  focusedCaptionState.itemKey = itemKeys[0];
  syncFocusedCaptionControls();
  renderPreviewHeaderMeta();
  navigateFocusedCaptionToIndex(0);
}

function startFocusedCaptionForMediaItem(mediaItem) {
  if (!mediaItem || !mediaItem.key) {
    setStatus('Select a media item to caption.');
    return;
  }
  if (state.currentItem && state.currentItem.key === mediaItem.key) {
    startFocusedCaption(mediaItem.key);
    return;
  }
  selectPathMedia(mediaItem).then(function () {
    startFocusedCaption(mediaItem.key);
  }).catch(function (err) {
    setStatus(String(err && err.message ? err.message : err));
  });
}

function wireFocusedCaption() {
  if (!ui.previewFocusCaptionBtnEl || !ui.previewFocusCaptionSkipBtnEl) {
    throw new Error('Focus Caption controls are missing.');
  }
  if (!ui.previewFocusCaptionBtnEl.__focusedCaptionBound) {
    ui.previewFocusCaptionBtnEl.__focusedCaptionBound = true;
    ui.previewFocusCaptionBtnEl.addEventListener('click', function () {
      if (focusedCaptionState.open) {
        stopFocusedCaption('Focus Caption ended.');
        renderFileList();
        return;
      }
      startFocusedCaption((state.currentItem && state.currentItem.key) || '');
    });
  }
  if (!ui.previewFocusCaptionSkipBtnEl.__focusedCaptionBound) {
    ui.previewFocusCaptionSkipBtnEl.__focusedCaptionBound = true;
    ui.previewFocusCaptionSkipBtnEl.addEventListener('click', function () {
      skipFocusedCaptionItem();
    });
  }
  if (!document.__focusedCaptionEscapeBound) {
    document.__focusedCaptionEscapeBound = true;
    document.addEventListener('keydown', function (event) {
      if (!focusedCaptionState.open || event.key !== 'Escape') return;
      event.preventDefault();
      stopFocusedCaption('Focus Caption ended.');
      renderFileList();
    });
  }
  syncFocusedCaptionControls();
}

wireFocusedCaption();

window.isFocusedCaptionOpen = isFocusedCaptionOpen;
window.startFocusedCaption = startFocusedCaption;
window.startFocusedCaptionForMediaItem = startFocusedCaptionForMediaItem;
window.stopFocusedCaption = stopFocusedCaption;
window.syncFocusedCaptionSelection = syncFocusedCaptionSelection;
window.syncFocusedCaptionControls = syncFocusedCaptionControls;
window.syncFocusedCaptionAfterAssist = syncFocusedCaptionAfterAssist;
window.advanceFocusedCaption = advanceFocusedCaption;
window.startFocusedCaptionPrefetch = startFocusedCaptionPrefetch;
window.cancelFocusedCaptionPrefetch = cancelFocusedCaptionPrefetch;
