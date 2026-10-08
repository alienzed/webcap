var focusedCaptionState = {
  open: false,
  folder: '',
  itemKeys: [],
  itemIndex: 0,
  itemKey: '',
  mode: 'caption',
  discrepanciesByMediaKey: {},
  discrepancySourceLabel: '',
  requestToken: 0,
  useArmed: false,
  useArmedText: ''
};

var focusedCaptionPrefetch = null; // one-deep speculative caption + optional shared Caption Vision assessment
var focusedCaptionVisionPhrases = {
  enabled: false,
  mediaKey: '',
  description: '',
  phrases: [],
  model: '',
  pending: false,
  error: '',
  task: null
};

function isFocusedCaptionOpen() {
  return !!focusedCaptionState.open;
}

function isFocusedCaptionReviewMode() {
  return !!(focusedCaptionState.open && focusedCaptionState.mode === 'review');
}

function focusedCaptionModeLabel() {
  return 'Caption Assist';
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
  if (isFocusedCaptionReviewMode()) {
    resetFocusedCaptionUseArm();
    syncCaptionAssistCandidateUi();
    return useCaptionAssistCandidate();
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

function createFocusedCaptionVisionPhraseTask(mediaItem, captionText) {
  var task = {
    mediaKey: String(mediaItem && mediaItem.key || ''),
    captionText: String(captionText || ''),
    jobId: '',
    cancelled: false,
    result: null,
    promise: null
  };
  task.promise = requestVisionCaptionExtras(mediaItem, task.captionText, {
    onJob: function (job) {
      task.jobId = String(job && job.jobId || '');
      if (!task.cancelled) return null;
      return cancelCaptionAssistJob(task.jobId);
    }
  }).then(function (result) {
    if (task.cancelled || !result) return null;
    task.result = {
      mediaKey: String(result.mediaKey || task.mediaKey),
      description: '',
      phrases: Array.isArray(result.extras) ? result.extras.slice() : [],
      model: String(result.model || '')
    };
    return task.result;
  });
  return task;
}

function cancelFocusedCaptionVisionPhraseTask(task, label) {
  if (!task) return Promise.resolve(false);
  task.cancelled = true;
  var jobId = String(task.jobId || '');
  if (!jobId || task.result) return Promise.resolve(true);
  return cancelCaptionAssistJob(jobId).catch(function (err) {
    reportConsoleWarning(
      label || 'Focus Caption Vision extras',
      'Could not cancel Vision extras job: ' + String(err && err.message ? err.message : err)
    );
    return false;
  });
}

function isFocusedCaptionVisionPhrasesEnabled() {
  return !!focusedCaptionVisionPhrases.enabled;
}

function setFocusedCaptionVisionSightEnabled(enabled) {
  focusedCaptionVisionPhrases.enabled = !!enabled;
  if (focusedCaptionVisionPhrases.enabled) {
    syncFocusedCaptionVisionPhrasesUi();
    return true;
  }

  clearFocusedCaptionVisionPhrases();
  var prefetch = focusedCaptionPrefetch;
  if (prefetch && prefetch.phraseTask) {
    var task = prefetch.phraseTask;
    prefetch.phraseTask = null;
    cancelFocusedCaptionVisionPhraseTask(task, 'Focus Caption Vision extras');
  }
  return false;
}

function clearFocusedCaptionVisionPhrases(options) {
  var opts = options || {};
  var task = focusedCaptionVisionPhrases.task;
  if (task && !task.result) cancelFocusedCaptionVisionPhraseTask(task);
  focusedCaptionVisionPhrases.mediaKey = '';
  focusedCaptionVisionPhrases.description = '';
  focusedCaptionVisionPhrases.phrases = [];
  focusedCaptionVisionPhrases.model = '';
  focusedCaptionVisionPhrases.pending = false;
  focusedCaptionVisionPhrases.error = '';
  focusedCaptionVisionPhrases.task = null;
  if (!opts.keepEnabled) focusedCaptionVisionPhrases.enabled = false;
  syncFocusedCaptionVisionPhrasesUi();
}

function setFocusedCaptionVisionPhraseResult(result) {
  result = result && typeof result === 'object' ? result : {};
  focusedCaptionVisionPhrases.mediaKey = String(result.mediaKey || '');
  focusedCaptionVisionPhrases.description = String(result.description || '');
  focusedCaptionVisionPhrases.phrases = Array.isArray(result.phrases) ? result.phrases.slice() : [];
  focusedCaptionVisionPhrases.model = String(result.model || '');
  focusedCaptionVisionPhrases.pending = false;
  focusedCaptionVisionPhrases.error = '';
  focusedCaptionVisionPhrases.task = null;
  syncFocusedCaptionVisionPhrasesUi();
}

function syncFocusedCaptionVisionPhrasePrefetch() {
  if (!focusedCaptionVisionPhrases.enabled || !focusedCaptionPrefetch) return Promise.resolve(false);
  var mediaItem = findFocusedCaptionMediaItemByKey(focusedCaptionPrefetch.itemKey);
  return beginFocusedCaptionPrefetchPhrases(focusedCaptionPrefetch, mediaItem);
}

function loadFocusedCaptionVisionPhrases() {
  if (!focusedCaptionState.open || !state.currentItem || !captionAssistCandidate) return Promise.resolve(false);
  var mediaItem = state.currentItem;
  if (captionAssistCandidate.mediaKey !== mediaItem.key) return Promise.resolve(false);

  focusedCaptionVisionPhrases.enabled = true;
  if (
    focusedCaptionVisionPhrases.task &&
    focusedCaptionVisionPhrases.task.mediaKey === mediaItem.key
  ) {
    return focusedCaptionVisionPhrases.task.promise;
  }

  clearFocusedCaptionVisionPhrases({ keepEnabled: true });
  var task = createFocusedCaptionVisionPhraseTask(mediaItem, captionAssistCandidate.text);
  focusedCaptionVisionPhrases.mediaKey = mediaItem.key;
  focusedCaptionVisionPhrases.pending = true;
  focusedCaptionVisionPhrases.task = task;
  syncFocusedCaptionVisionPhrasesUi();

  return task.promise.then(function (result) {
    if (!result || !focusedCaptionState.open || !state.currentItem || state.currentItem.key !== mediaItem.key) return false;
    setFocusedCaptionVisionPhraseResult(result);
    // Extras are explicitly requested for this item, not the next item.
    return true;
  }).catch(function (err) {
    if (!task.cancelled && focusedCaptionState.open && state.currentItem && state.currentItem.key === mediaItem.key) {
      focusedCaptionVisionPhrases.pending = false;
      focusedCaptionVisionPhrases.task = null;
      focusedCaptionVisionPhrases.error = String(err && err.message ? err.message : err);
      syncFocusedCaptionVisionPhrasesUi();
      setStatus('Vision extras failed: ' + focusedCaptionVisionPhrases.error);
      reportConsoleError('Focus Caption Vision extras', err);
    }
    return false;
  });
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

function buildFocusedReviewCandidate(mediaItem) {
  if (!mediaItem || !mediaItem.key) throw new Error('Focus Review requires a media item.');
  var request = buildCaptionAssistRequest(mediaItem);
  var captionText = String(mediaItem.caption || '');
  if (
    state && state.currentItem &&
    state.currentItem.key === mediaItem.key &&
    ui && ui.editorEl
  ) {
    captionText = String(ui.editorEl.value || '');
  }
  return {
    mediaKey: String(mediaItem.key || ''),
    text: captionText,
    missingGroups: getCaptionAssistMissingGroups(mediaItem.key),
    omittedAssignments: getCaptionAssistOmittedAssignments(
      mediaItem.key,
      captionText,
      request.assignments
    ),
    omittedCorrections: getCaptionAssistOmittedCorrections(
      mediaItem.key,
      captionText,
      request.assignments
    ),
    requestFingerprint: captionAssistRequestFingerprint(mediaItem, request),
    reviewSeed: true
  };
}

function presentFocusedReviewCandidate(mediaItem) {
  if (!isFocusedCaptionReviewMode() || !mediaItem || !state.currentItem || state.currentItem.key !== mediaItem.key) {
    return Promise.resolve(false);
  }
  var candidate = buildFocusedReviewCandidate(mediaItem);
  captionAssistCandidate = candidate;
  syncCaptionAssistCandidateUi();
  setStatus(
    candidate.omittedAssignments.length
      ? 'Focus Review found selected annotations missing from this caption.'
      : 'Caption ready to review.'
  );

  var suppliedFindings = focusedCaptionState.discrepanciesByMediaKey[candidate.mediaKey] || [];
  if (suppliedFindings.length) {
    setCaptionDiscrepancyFindingsForCandidate(
      candidate,
      suppliedFindings,
      focusedCaptionState.discrepancySourceLabel || 'QA'
    );
  }
  // QA suggestions and the fresh item-level visual check are complementary.
  if (captionVisionEnabled) maybeRunCaptionVisionForCandidate(candidate);
  startFocusedCaptionPrefetch(candidate.mediaKey);
  return Promise.resolve(true);
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

function beginFocusedCaptionPrefetchPhrases(prefetch, mediaItem) {
  if (!focusedCaptionVisionPhrases.enabled || !prefetch || !mediaItem) return Promise.resolve(false);
  if (!isCaptionVisionSupportedMedia(mediaItem.fileName)) return Promise.resolve(false);
  if (prefetch.phraseTask) return prefetch.phraseTask.promise;
  var task = createFocusedCaptionVisionPhraseTask(mediaItem, prefetch.candidate ? prefetch.candidate.text : '');
  prefetch.phraseTask = task;
  task.promise.catch(function (err) {
    if (!task.cancelled && !prefetch.discarded && focusedCaptionPrefetch === prefetch) {
      reportConsoleError('Focus Caption Vision extras', err);
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

function startFocusedCaptionPrefetch() {
  // Sight must be prepared before the Director, so speculative candidates are invalid.
  return cancelFocusedCaptionPrefetch();
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
      isFocusedCaptionReviewMode()
        ? (candidate.omittedAssignments.length
          ? 'Focus Review found selected annotations missing from this caption.'
          : 'Caption ready to review.')
        : (candidate.omittedAssignments.length
          ? 'Caption Assist candidate failed annotation validation.'
          : 'AI caption candidate ready.')
    );
    var suppliedFindings = isFocusedCaptionReviewMode()
      ? (focusedCaptionState.discrepanciesByMediaKey[candidate.mediaKey] || [])
      : [];
    if (suppliedFindings.length) {
      setCaptionDiscrepancyFindingsForCandidate(
        candidate,
        suppliedFindings,
        focusedCaptionState.discrepancySourceLabel || 'QA'
      );
    }
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

function getFocusedCaptionEntryKeys(targetMediaKey, mode) {
  var reviewMode = false;
  var allItems = getFilteredMediaItems(false).filter(function (item) {
    return !!(item && item.key);
  });
  if (!allItems.length) return [];

  var targetKey = String(targetMediaKey || '').trim();
  var targetIndex = allItems.findIndex(function (item) { return item.key === targetKey; });
  var ordered = targetIndex > 0
    ? allItems.slice(targetIndex).concat(allItems.slice(0, targetIndex))
    : allItems;

  return ordered.filter(function (item) {
    return !reviewMode || !!String(item.caption || '').trim();
  }).map(function (item) {
    return item.key;
  });
}

function syncFocusedCaptionControls() {
  var startBtn = ui.previewFocusCaptionBtnEl;
  var reviewBtn = document.getElementById('preview-open-focus-review-btn');
  var skipBtn = ui.previewFocusCaptionSkipBtnEl;
  if (!startBtn || !reviewBtn || !skipBtn) {
    throw new Error('Focus Caption controls are missing.');
  }

  var startLabelEl = startBtn.querySelector('.preview-header-btn-label');
  var startGlyphEl = startBtn.querySelector('.btn-glyph');
  var reviewLabelEl = reviewBtn.querySelector('.preview-header-btn-label');
  var reviewGlyphEl = reviewBtn.querySelector('.btn-glyph');
  var hasItem = !!(state && state.currentItem && state.currentItem.fileName);
  var annotationOpen = isFocusedAnnotationOpen();
  var reviewMode = isFocusedCaptionReviewMode();

  if (
    focusedCaptionState.open &&
    (!hasItem || String(focusedCaptionState.folder || '') !== String((state && state.folder) || ''))
  ) {
    stopFocusedCaption(focusedCaptionModeLabel() + ' ended because the Single Item context changed.');
    return;
  }

  // One progressive Caption Assist entry point. Keep the legacy review
  // control wired for existing callers, but do not show a competing button.
  startBtn.classList.toggle('hidden', !hasItem || annotationOpen);
  reviewBtn.classList.add('hidden');

  startBtn.classList.toggle('active', focusedCaptionState.open && !reviewMode);
  reviewBtn.classList.toggle('active', focusedCaptionState.open && reviewMode);
  startBtn.setAttribute('aria-pressed', focusedCaptionState.open && !reviewMode ? 'true' : 'false');
  reviewBtn.setAttribute('aria-pressed', focusedCaptionState.open && reviewMode ? 'true' : 'false');

  if (!focusedCaptionState.open) {
    startBtn.setAttribute('aria-label', 'Start Caption Assist');
    startBtn.title = 'Caption Assist: use Open Sight, fresh Context Sight, and the Director for each item';
    if (startGlyphEl) startGlyphEl.textContent = '\u2728';
    if (startLabelEl) startLabelEl.textContent = 'Caption Assist';

    reviewBtn.setAttribute('aria-label', 'Start Caption Assist review');
    reviewBtn.title = 'Caption Assist · Review: check saved captions progressively, including QA findings';
    if (reviewGlyphEl) reviewGlyphEl.textContent = '\u2713';
    if (reviewLabelEl) reviewLabelEl.textContent = 'Review Captions';

    skipBtn.classList.add('hidden');
    skipBtn.disabled = false;
    return;
  }

  var activeBtn = startBtn;
  var activeLabel = startLabelEl;
  var activeGlyph = startGlyphEl;
  activeBtn.classList.remove('hidden');
  activeBtn.setAttribute('aria-label', 'Exit ' + focusedCaptionModeLabel());
  activeBtn.title = 'Exit ' + focusedCaptionModeLabel() + ' (Esc)';
  if (activeGlyph) activeGlyph.textContent = '\u00d7';
  if (activeLabel) {
    activeLabel.textContent = 'Exit \u00b7 ' + (focusedCaptionState.itemIndex + 1) + ' / ' + focusedCaptionState.itemKeys.length;
  }

  skipBtn.classList.remove('hidden');
  skipBtn.disabled = false;
  skipBtn.title = reviewMode
    ? 'Skip this review item without saving edits'
    : 'Next Focus Caption item (Right/Down/S)';
  var skipLabel = skipBtn.querySelector('.preview-header-btn-label');
  if (skipLabel) skipLabel.textContent = reviewMode ? 'Skip' : 'Next';
}

function syncFocusedCaptionAfterAssist(sourceMediaKey) {
  if (!focusedCaptionState.open || isCaptionAssistRunning()) return;
  if (!state.currentItem || state.currentItem.key !== focusedCaptionState.itemKey) return;
  if (state.currentItem.key === String(sourceMediaKey || '')) return;
  prepareFocusedCaptionCurrentItem();
}

function stopFocusedCaption(message, options) {
  if (!focusedCaptionState.open) return true;
  var opts = options || {};
  if (hasFocusedReviewUnsavedChanges() && !opts.discardReviewEdits) {
    setStatus('This review caption has unsaved edits. Use Save → Next, or Skip before exiting.');
    return false;
  }
  var stoppingLabel = focusedCaptionModeLabel();
  if (stoppingLabel === 'Focus Review' && String(message || '') === 'Focus Caption ended.') {
    message = 'Focus Review ended.';
  }
  invalidateFocusedCaptionRequest();
  var pendingJobId = String(captionAssistPendingJobId || '');
  focusedCaptionState.open = false;
  focusedCaptionState.folder = '';
  focusedCaptionState.itemKeys = [];
  focusedCaptionState.itemIndex = 0;
  focusedCaptionState.itemKey = '';
  focusedCaptionState.mode = 'caption';
  focusedCaptionState.discrepanciesByMediaKey = {};
  focusedCaptionState.discrepancySourceLabel = '';
  captionAssistPendingJobId = '';
  if (pendingJobId && pendingJobId !== 'submitting' && pendingJobId !== 'prefetch') {
    cancelCaptionAssistJob(pendingJobId).catch(function (err) {
      reportConsoleWarning('Focus Caption', 'Could not cancel active Caption Assist job while exiting: ' + String(err && err.message ? err.message : err));
      return false;
    });
  }
  cancelFocusedCaptionPrefetch();
  cancelCurrentCaptionVision();
  clearFocusedCaptionVisionPhrases();
  clearCaptionAssistCandidate();
  clearCaptionVisionResult();
  syncFocusedCaptionControls();
  syncFocusedCaptionPanelGeometry();
  renderPreviewHeaderMeta();
  if (message) setStatus(message);
  return true;
}

function prepareFocusedCaptionCurrentItem() {
  if (!focusedCaptionState.open) return Promise.resolve(false);
  if (!state.currentItem || !state.currentItem.key) {
    stopFocusedCaption(focusedCaptionModeLabel() + ' stopped because there is no selected media item.');
    return Promise.resolve(false);
  }
  if (state.currentItem.key !== focusedCaptionState.itemKey) {
    return Promise.resolve(false);
  }

  resetFocusedCaptionUseArm();
  clearFocusedCaptionVisionPhrases({ keepEnabled: true });
  clearCaptionAssistCandidate();
  syncFocusedCaptionControls();
  syncCaptionAssistCandidateUi();
  syncFocusedCaptionPanelGeometry();
  if (isCaptionAssistRunning()) {
    setStatus('Caption Assist is already running for this ' + focusedCaptionModeLabel() + ' item.');
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
    stopFocusedCaption(focusedCaptionModeLabel() + ' ended because selection moved outside its captured scope.');
    return;
  }
  focusedCaptionState.itemIndex = index;
  focusedCaptionState.itemKey = key;
  prepareFocusedCaptionCurrentItem();
}

function finishFocusedCaption() {
  var completedCount = focusedCaptionState.itemKeys.length;
  var label = focusedCaptionModeLabel();
  stopFocusedCaption();
  renderFileList();
  showFocusedCaptionToast(label + ' complete · ' + completedCount + ' item' + (completedCount === 1 ? '' : 's'));
  setStatus(label + ' complete.');
  return Promise.resolve(false);
}

function navigateFocusedCaptionToIndex(index, direction) {
  if (!focusedCaptionState.open) return Promise.resolve(false);
  var step = direction < 0 ? -1 : 1;
  if (index < 0) {
    setStatus(focusedCaptionModeLabel() + ' is already at the first item.');
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
    stopFocusedCaption(focusedCaptionModeLabel() + ' stopped: ' + message);
    return false;
  });
}

function hasFocusedReviewUnsavedChanges() {
  return !!(
    isFocusedCaptionReviewMode() &&
    captionAssistCandidate &&
    state && state.currentItem &&
    captionAssistCandidate.mediaKey === state.currentItem.key &&
    String(captionAssistCandidate.text || '') !== String(state.currentItem.caption || '')
  );
}

function moveFocusedCaption(delta, options) {
  if (!focusedCaptionState.open) return Promise.resolve(false);
  var opts = options || {};
  if (hasFocusedReviewUnsavedChanges() && !opts.discardReviewEdits) {
    setStatus('This review caption has unsaved edits. Use Save → Next, or Skip to discard them.');
    return Promise.resolve(false);
  }
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
  return moveFocusedCaption(1, { discardReviewEdits: true });
}

function regenerateFocusedCaption() {
  if (!focusedCaptionState.open) return Promise.resolve(false);
  if (isFocusedCaptionReviewMode()) {
    var reviewItem = state && state.currentItem;
    var reviewRequest = reviewItem ? buildCaptionAssistRequest(reviewItem) : null;
    if (!reviewRequest || !reviewRequest.model) {
      setStatus('Select a Director model before generating a rewritten review caption.');
      return Promise.resolve(false);
    }
  }
  var mediaKey = String(focusedCaptionState.itemKey || '');
  return cancelFocusedCaptionCurrentRequest().then(function () {
    return cancelFocusedCaptionPrefetch();
  }).then(function () {
    if (!focusedCaptionState.open || String(focusedCaptionState.itemKey || '') !== mediaKey) return false;
    clearCaptionAssistCandidate();
    if (isFocusedCaptionReviewMode()) {
      setStatus('Generating a rewritten caption for this review item…');
      return runCaptionAssist();
    }
    return prepareFocusedCaptionCurrentItem();
  });
}

function startFocusedCaption(targetMediaKey, mode, options) {
  var opts = options || {};
  if (isCaptionAssistRunning()) {
    setStatus('Finish the current Caption Assist request before starting another focused caption workflow.');
    return;
  }
  if (isFocusedAnnotationOpen()) {
    stopFocusedAnnotation();
  }

  var nextMode = 'caption';
  var itemKeys = getFocusedCaptionEntryKeys(targetMediaKey, nextMode);
  if (!itemKeys.length) {
    setStatus(nextMode === 'review'
      ? 'No saved captions are available in the current visible scope.'
      : 'No media items are available in the current visible scope.');
    return;
  }

  focusedCaptionState.open = true;
  focusedCaptionState.mode = nextMode;
  focusedCaptionState.discrepanciesByMediaKey = nextMode === 'review' && opts.discrepanciesByMediaKey
    ? opts.discrepanciesByMediaKey
    : {};
  focusedCaptionState.discrepancySourceLabel = nextMode === 'review'
    ? String(opts.sourceLabel || '')
    : '';
  focusedCaptionVisionPhrases.enabled = false;
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

function startFocusedReview(targetMediaKey) {
  // QA hands off the item, not historical findings; Caption Assist starts fresh.
  startFocusedCaption(targetMediaKey, 'caption');
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
  var reviewBtn = document.getElementById('preview-open-focus-review-btn');
  if (!ui.previewFocusCaptionBtnEl || !reviewBtn || !ui.previewFocusCaptionSkipBtnEl) {
    throw new Error('Focus Caption controls are missing.');
  }
  if (!ui.previewFocusCaptionBtnEl.__focusedCaptionBound) {
    ui.previewFocusCaptionBtnEl.__focusedCaptionBound = true;
    ui.previewFocusCaptionBtnEl.addEventListener('click', function () {
      if (focusedCaptionState.open) {
        if (!stopFocusedCaption(focusedCaptionModeLabel() + ' ended.')) return;
        renderFileList();
        return;
      }
      startFocusedCaption((state.currentItem && state.currentItem.key) || '');
    });
  }
  if (!reviewBtn.__focusedCaptionReviewBound) {
    reviewBtn.__focusedCaptionReviewBound = true;
    reviewBtn.addEventListener('click', function () {
      if (isFocusedCaptionReviewMode()) {
        if (!stopFocusedCaption('Focus Review ended.')) return;
        renderFileList();
        return;
      }
      startFocusedReview((state.currentItem && state.currentItem.key) || '');
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
      if (isEditableElement(document.activeElement)) return;
      var key = String(event.key || '');
      var lower = key.toLowerCase();
      if (key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!stopFocusedCaption(focusedCaptionModeLabel() + ' ended.')) return;
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
      if (event.target.closest && event.target.closest('#preview-open-focus-caption-btn, #preview-open-focus-review-btn, #preview-focus-caption-skip-btn')) return;
      if (!stopFocusedCaption(focusedCaptionModeLabel() + ' ended.')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
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
window.isFocusedCaptionReviewMode = isFocusedCaptionReviewMode;
window.startFocusedCaption = startFocusedCaption;
window.startFocusedReview = startFocusedReview;
window.startFocusedCaptionForMediaItem = startFocusedCaptionForMediaItem;
window.stopFocusedCaption = stopFocusedCaption;
window.syncFocusedCaptionSelection = syncFocusedCaptionSelection;
window.syncFocusedCaptionControls = syncFocusedCaptionControls;
window.syncFocusedCaptionAfterAssist = syncFocusedCaptionAfterAssist;
window.advanceFocusedCaption = advanceFocusedCaption;
window.startFocusedCaptionPrefetch = startFocusedCaptionPrefetch;
window.cancelFocusedCaptionPrefetch = cancelFocusedCaptionPrefetch;
window.syncFocusedCaptionVisionPreference = syncFocusedCaptionVisionPreference;
window.loadFocusedCaptionVisionPhrases = loadFocusedCaptionVisionPhrases;
window.isFocusedCaptionVisionPhrasesEnabled = isFocusedCaptionVisionPhrasesEnabled;
window.setFocusedCaptionVisionSightEnabled = setFocusedCaptionVisionSightEnabled;
window.clearFocusedCaptionVisionPhrases = clearFocusedCaptionVisionPhrases;
window.focusedCaptionVisionPhrases = focusedCaptionVisionPhrases;
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
