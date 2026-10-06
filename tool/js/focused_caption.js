var focusedCaptionState = {
  open: false,
  folder: '',
  itemKeys: [],
  itemIndex: 0,
  itemKey: '',
  requestToken: 0,
  useArmed: false,
  useArmedText: ''
};

var focusedCaptionPrefetch = null; // one-deep speculative caption + optional vision assessment

function isFocusedCaptionOpen() {
  return !!focusedCaptionState.open;
}

function resetFocusedCaptionUseArm() {
  focusedCaptionState.useArmed = false;
  focusedCaptionState.useArmedText = '';
}

function beginFocusedCaptionRequest(mediaKey) {
  focusedCaptionState.requestToken += 1;
  resetFocusedCaptionUseArm();
  return {
    token: focusedCaptionState.requestToken,
    mediaKey: String(mediaKey || '')
  };
}

function isFocusedCaptionRequestCurrent(mediaKey, requestToken) {
  return !!(
    focusedCaptionState.open &&
    focusedCaptionState.requestToken === Number(requestToken || 0) &&
    String(focusedCaptionState.itemKey || '') === String(mediaKey || '')
  );
}

function invalidateFocusedCaptionRequest() {
  focusedCaptionState.requestToken += 1;
  resetFocusedCaptionUseArm();
}

function isFocusedCaptionUseArmedForCandidate(candidate) {
  return !!(
    focusedCaptionState.open &&
    focusedCaptionState.useArmed &&
    candidate &&
    String(candidate.text || '') === String(focusedCaptionState.useArmedText || '')
  );
}

function getFocusedCaptionProgressText() {
  if (!focusedCaptionState.open) return '';
  return 'Item ' + (focusedCaptionState.itemIndex + 1) + ' / ' + focusedCaptionState.itemKeys.length;
}

function canNavigateFocusedCaption(delta) {
  if (!focusedCaptionState.open) return false;
  var nextIndex = focusedCaptionState.itemIndex + (delta < 0 ? -1 : 1);
  return nextIndex >= 0 && nextIndex < focusedCaptionState.itemKeys.length;
}

function syncFocusedCaptionPanelGeometry() {
  var panel = document.getElementById('editor-caption-candidate');
  if (!panel) return;
  if (!focusedCaptionState.open) {
    panel.style.removeProperty('--focus-caption-left');
    panel.style.removeProperty('--focus-caption-top');
    panel.style.removeProperty('--focus-caption-width');
    panel.style.removeProperty('--focus-caption-height');
    return;
  }
  var workbench = ui && ui.appEl ? ui.appEl.querySelector('.workbench-panel') : null;
  if (!workbench) throw new Error('Focus Caption requires the Single Item workbench pane.');
  var rect = workbench.getBoundingClientRect();
  panel.style.setProperty('--focus-caption-left', rect.left + 'px');
  panel.style.setProperty('--focus-caption-top', rect.top + 'px');
  panel.style.setProperty('--focus-caption-width', rect.width + 'px');
  panel.style.setProperty('--focus-caption-height', rect.height + 'px');
}

function showFocusedCaptionToast(message) {
  var existing = document.getElementById('focused-caption-toast');
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  var toast = document.createElement('div');
  toast.id = 'focused-caption-toast';
  toast.className = 'focused-caption-toast';
  toast.textContent = String(message || 'Focus Caption complete.');
  document.body.appendChild(toast);
  setTimeout(function () {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 2200);
}

function cancelFocusedCaptionCurrentRequest() {
  if (!focusedCaptionState.open && !captionAssistPendingJobId) return Promise.resolve(false);
  invalidateFocusedCaptionRequest();
  var pendingJobId = String(captionAssistPendingJobId || '');
  captionAssistPendingJobId = '';
  updatePrimerCaptionResetUi();

  if (
    focusedCaptionPrefetch &&
    (pendingJobId === 'prefetch' || pendingJobId === String(focusedCaptionPrefetch.jobId || ''))
  ) {
    return cancelFocusedCaptionPrefetch();
  }
  if (!pendingJobId || pendingJobId === 'submitting') return Promise.resolve(!!pendingJobId);
  return cancelCaptionAssistJob(pendingJobId).catch(function (err) {
    reportConsoleWarning('Focus Caption', 'Could not cancel active Caption Assist job: ' + String(err && err.message ? err.message : err));
    return false;
  });
}

function armOrUseFocusedCaptionCandidate() {
  if (!focusedCaptionState.open) return Promise.resolve(false);
  var candidate = captionAssistCandidate;
  if (!candidate || !state.currentItem || candidate.mediaKey !== state.currentItem.key) {
    setStatus(isCaptionAssistRunning() ? 'Focus Caption is still generating.' : 'No caption candidate is ready yet.');
    return Promise.resolve(false);
  }
  if (isFocusedCaptionUseArmedForCandidate(candidate)) {
    resetFocusedCaptionUseArm();
    syncCaptionAssistCandidateUi();
    return useCaptionAssistCandidate();
  }
  focusedCaptionState.useArmed = true;
  focusedCaptionState.useArmedText = String(candidate.text || '');
  syncCaptionAssistCandidateUi();
  setStatus('Press Enter again to use this caption.');
  return Promise.resolve(true);
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
    captionAssistPendingJobId === 'prefetch'
  ) {
    captionAssistPendingJobId = '';
    updatePrimerCaptionResetUi();
  }
  var cancellations = [];
  if (prefetch.jobId && !prefetch.candidate) {
    cancellations.push(cancelCaptionAssistJob(prefetch.jobId).catch(function (err) {
      reportConsoleWarning('Focus Caption', 'Could not cancel speculative Caption Assist job: ' + String(err && err.message ? err.message : err));
      return false;
    }));
  }
  if (prefetch.visionTask && !prefetch.visionTask.result) {
    cancellations.push(cancelCaptionVisionTask(prefetch.visionTask, 'Focus Caption Vision'));
  }
  if (!cancellations.length) return Promise.resolve(true);
  return Promise.all(cancellations).then(function () { return true; });
}

function beginFocusedCaptionPrefetchVision(prefetch, mediaItem, candidate) {
  if (!captionVisionEnabled || !prefetch || !mediaItem || !candidate) return Promise.resolve(false);
  if (!isCaptionVisionSupportedMedia(mediaItem.fileName)) return Promise.resolve(false);
  if (prefetch.visionTask) return prefetch.visionTask.promise;

  var task = createCaptionVisionTask(mediaItem, candidate.text);
  prefetch.visionTask = task;
  task.promise.catch(function (err) {
    if (!task.cancelled && !prefetch.discarded && focusedCaptionPrefetch === prefetch && captionVisionEnabled) {
      reportConsoleError('Focus Caption Vision', err);
    }
    return null;
  });
  return task.promise;
}

function syncFocusedCaptionVisionPreference() {
  var prefetch = focusedCaptionPrefetch;
  if (!prefetch) return Promise.resolve(false);
  if (!captionVisionEnabled) {
    if (prefetch.visionTask) {
      var task = prefetch.visionTask;
      prefetch.visionTask = null;
      return cancelCaptionVisionTask(task, 'Focus Caption Vision');
    }
    return Promise.resolve(true);
  }
  if (!prefetch.candidate) return Promise.resolve(false);
  var mediaItem = findFocusedCaptionMediaItemByKey(prefetch.itemKey);
  return beginFocusedCaptionPrefetchVision(prefetch, mediaItem, prefetch.candidate);
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
      visionTask: null,
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
      if (captionVisionEnabled) beginFocusedCaptionPrefetchVision(prefetch, target.item, candidate);
      return candidate;
    }).catch(function (err) {
      if (!prefetch.discarded && focusedCaptionPrefetch === prefetch) {
        focusedCaptionPrefetch = null;
        reportConsoleError('Focus Caption', err);
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
    var adoptedPrefetch = prefetch;
    focusedCaptionPrefetch = null;
    candidate.missingGroups = getCaptionAssistMissingGroups(candidate.mediaKey);
    captionAssistCandidate = candidate;
    syncCaptionAssistCandidateUi();
    setStatus(
      candidate.omittedAssignments.length
        ? 'Caption Assist candidate failed annotation validation.'
        : 'AI caption candidate ready.'
    );
    if (captionVisionEnabled) {
      adoptCaptionVisionPrefetch(adoptedPrefetch, candidate).then(function () {
        if (isFocusedCaptionOpen() && state.currentItem && state.currentItem.key === candidate.mediaKey) {
          startFocusedCaptionPrefetch(candidate.mediaKey);
        }
      });
    } else {
      startFocusedCaptionPrefetch(candidate.mediaKey);
    }
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
    stopFocusedCaption('Focus Caption ended because the Single Item context changed.');
    return;
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
  skipBtn.disabled = false;
  skipBtn.title = 'Next Focus Caption item (Right/Down/S)';
  var skipLabel = skipBtn.querySelector('.preview-header-btn-label');
  if (skipLabel) skipLabel.textContent = 'Next';
}

function syncFocusedCaptionAfterAssist(sourceMediaKey) {
  if (!focusedCaptionState.open || isCaptionAssistRunning()) return;
  if (!state.currentItem || state.currentItem.key !== focusedCaptionState.itemKey) return;
  if (state.currentItem.key === String(sourceMediaKey || '')) return;
  prepareFocusedCaptionCurrentItem();
}

function stopFocusedCaption(message) {
  if (!focusedCaptionState.open) return;
  invalidateFocusedCaptionRequest();
  var pendingJobId = String(captionAssistPendingJobId || '');
  focusedCaptionState.open = false;
  focusedCaptionState.folder = '';
  focusedCaptionState.itemKeys = [];
  focusedCaptionState.itemIndex = 0;
  focusedCaptionState.itemKey = '';
  captionAssistPendingJobId = '';
  if (pendingJobId && pendingJobId !== 'submitting' && pendingJobId !== 'prefetch') {
    cancelCaptionAssistJob(pendingJobId).catch(function (err) {
      reportConsoleWarning('Focus Caption', 'Could not cancel active Caption Assist job while exiting: ' + String(err && err.message ? err.message : err));
      return false;
    });
  }
  cancelFocusedCaptionPrefetch();
  cancelCurrentCaptionVision();
  clearCaptionAssistCandidate();
  clearCaptionVisionResult();
  syncFocusedCaptionControls();
  syncFocusedCaptionPanelGeometry();
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

  resetFocusedCaptionUseArm();
  clearCaptionAssistCandidate();
  syncFocusedCaptionControls();
  syncCaptionAssistCandidateUi();
  syncFocusedCaptionPanelGeometry();
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

function finishFocusedCaption() {
  var completedCount = focusedCaptionState.itemKeys.length;
  stopFocusedCaption();
  renderFileList();
  showFocusedCaptionToast('Focus Caption complete · ' + completedCount + ' item' + (completedCount === 1 ? '' : 's'));
  setStatus('Focus Caption complete.');
  return Promise.resolve(false);
}

function navigateFocusedCaptionToIndex(index, direction) {
  if (!focusedCaptionState.open) return Promise.resolve(false);
  var step = direction < 0 ? -1 : 1;
  if (index < 0) {
    setStatus('Focus Caption is already at the first item.');
    return Promise.resolve(false);
  }
  if (index >= focusedCaptionState.itemKeys.length) {
    return finishFocusedCaption();
  }

  focusedCaptionState.itemIndex = index;
  focusedCaptionState.itemKey = focusedCaptionState.itemKeys[index];
  resetFocusedCaptionUseArm();
  var targetItem = findFocusedCaptionMediaItemByKey(focusedCaptionState.itemKey);
  if (!targetItem) {
    return navigateFocusedCaptionToIndex(index + step, step);
  }

  if (state.currentItem && state.currentItem.key === targetItem.key) {
    return prepareFocusedCaptionCurrentItem();
  }

  syncFocusedCaptionControls();
  syncCaptionAssistCandidateUi();
  syncFocusedCaptionPanelGeometry();
  return selectPathMedia(targetItem).then(function () {
    return true;
  }).catch(function (err) {
    var message = String(err && err.message ? err.message : err);
    if (message.indexOf('outside the current filtered list') !== -1) {
      return navigateFocusedCaptionToIndex(index + step, step);
    }
    stopFocusedCaption('Focus Caption stopped: ' + message);
    return false;
  });
}

function moveFocusedCaption(delta) {
  if (!focusedCaptionState.open) return Promise.resolve(false);
  var step = delta < 0 ? -1 : 1;
  return cancelFocusedCaptionCurrentRequest().then(function () {
    return cancelCurrentCaptionVision();
  }).then(function () {
    clearCaptionAssistCandidate();
    return navigateFocusedCaptionToIndex(focusedCaptionState.itemIndex + step, step);
  });
}

function advanceFocusedCaption() {
  return moveFocusedCaption(1);
}

function skipFocusedCaptionItem() {
  return moveFocusedCaption(1);
}

function regenerateFocusedCaption() {
  if (!focusedCaptionState.open) return Promise.resolve(false);
  var mediaKey = String(focusedCaptionState.itemKey || '');
  return cancelFocusedCaptionCurrentRequest().then(function () {
    return cancelFocusedCaptionPrefetch();
  }).then(function () {
    if (!focusedCaptionState.open || String(focusedCaptionState.itemKey || '') !== mediaKey) return false;
    clearCaptionAssistCandidate();
    return prepareFocusedCaptionCurrentItem();
  });
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
  loadCaptionVisionCapabilities();
  focusedCaptionState.itemKeys = itemKeys;
  focusedCaptionState.itemIndex = 0;
  focusedCaptionState.itemKey = itemKeys[0];
  resetFocusedCaptionUseArm();
  syncFocusedCaptionControls();
  renderPreviewHeaderMeta();
  syncCaptionAssistCandidateUi();
  syncFocusedCaptionPanelGeometry();
  navigateFocusedCaptionToIndex(0, 1);
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
  if (!document.__focusedCaptionKeyboardBound) {
    document.__focusedCaptionKeyboardBound = true;
    document.addEventListener('keydown', function (event) {
      if (!focusedCaptionState.open || !event || event.defaultPrevented || event.repeat) return;
      if (typeof isEditableElement === 'function' && isEditableElement(document.activeElement)) return;
      var key = String(event.key || '');
      var lower = key.toLowerCase();
      if (key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        stopFocusedCaption('Focus Caption ended.');
        renderFileList();
        return;
      }
      if (key === 'ArrowLeft' || key === 'ArrowUp') {
        event.preventDefault();
        event.stopImmediatePropagation();
        moveFocusedCaption(-1);
        return;
      }
      if (key === 'ArrowRight' || key === 'ArrowDown' || lower === 's') {
        event.preventDefault();
        event.stopImmediatePropagation();
        moveFocusedCaption(1);
        return;
      }
      if (lower === 'r') {
        event.preventDefault();
        event.stopImmediatePropagation();
        regenerateFocusedCaption();
        return;
      }
      if (key === 'Enter') {
        event.preventDefault();
        event.stopImmediatePropagation();
        armOrUseFocusedCaptionCandidate();
      }
    }, true);
  }
  if (!document.__focusedCaptionOutsideClickBound) {
    document.__focusedCaptionOutsideClickBound = true;
    document.addEventListener('pointerdown', function (event) {
      if (!focusedCaptionState.open || !event || !event.target) return;
      var panel = document.getElementById('editor-caption-candidate');
      if (panel && panel.contains(event.target)) return;
      if (event.target.closest && event.target.closest('#preview-open-focus-caption-btn, #preview-focus-caption-skip-btn')) return;
      stopFocusedCaption('Focus Caption ended.');
      renderFileList();
    }, true);
  }
  if (!window.__focusedCaptionResizeBound) {
    window.__focusedCaptionResizeBound = true;
    window.addEventListener('resize', function () {
      if (focusedCaptionState.open) syncFocusedCaptionPanelGeometry();
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
window.syncFocusedCaptionVisionPreference = syncFocusedCaptionVisionPreference;
window.beginFocusedCaptionRequest = beginFocusedCaptionRequest;
window.isFocusedCaptionRequestCurrent = isFocusedCaptionRequestCurrent;
window.isFocusedCaptionUseArmedForCandidate = isFocusedCaptionUseArmedForCandidate;
window.getFocusedCaptionProgressText = getFocusedCaptionProgressText;
window.canNavigateFocusedCaption = canNavigateFocusedCaption;
window.syncFocusedCaptionPanelGeometry = syncFocusedCaptionPanelGeometry;
window.cancelFocusedCaptionCurrentRequest = cancelFocusedCaptionCurrentRequest;
window.moveFocusedCaption = moveFocusedCaption;
window.regenerateFocusedCaption = regenerateFocusedCaption;
window.armOrUseFocusedCaptionCandidate = armOrUseFocusedCaptionCandidate;
window.resetFocusedCaptionUseArm = resetFocusedCaptionUseArm;
