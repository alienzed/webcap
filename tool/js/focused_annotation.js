var focusedAnnotationState = {
  open: false,
  itemKeys: [],
  itemIndex: 0,
  groupIndex: 0,
  history: [],
  sourceLabel: ''
};

function getFocusedAnnotationEls() {
  return {
    modal: document.getElementById('focused-annotation-modal'),
    previewMedia: document.getElementById('focused-annotation-preview-media'),
    itemProgress: document.getElementById('focused-annotation-item-progress'),
    groupProgress: document.getElementById('focused-annotation-group-progress'),
    groupName: document.getElementById('focused-annotation-group-name'),
    groupStatus: document.getElementById('focused-annotation-group-status'),
    termList: document.getElementById('focused-annotation-term-list'),
    editTermsBtn: document.getElementById('focused-annotation-edit-terms-btn'),
    closeBtn: document.getElementById('focused-annotation-close-btn'),
    backBtn: document.getElementById('focused-annotation-back-btn'),
    skipBtn: document.getElementById('focused-annotation-skip-btn'),
    naBtn: document.getElementById('focused-annotation-na-btn'),
    doneBtn: document.getElementById('focused-annotation-done-btn')
  };
}

function isFocusedAnnotationOpen() {
  return !!focusedAnnotationState.open;
}

function isFocusedAnnotationNestedModalOpen() {
  var ids = [
    'checklist-group-terms-modal',
    'checklist-term-affixes-modal',
    'checklist-keywords-modal',
    'review-rules-modal',
    'primer-mappings-modal'
  ];
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById(ids[i]);
    if (el && !el.classList.contains('hidden')) {
      return true;
    }
  }
  return false;
}

function findFocusedAnnotationMediaItemByKey(mediaKey) {
  var key = String(mediaKey || '').trim();
  if (!key || !state || !Array.isArray(state.items)) return null;
  for (var i = 0; i < state.items.length; i++) {
    var item = state.items[i];
    if (item && item.key === key) return item;
  }
  return null;
}

function focusedAnnotationAnyFilterActive() {
  if (!ui) return false;
  if (ui.filterEl && String(ui.filterEl.value || '').trim()) return true;
  if (ui.advancedFilterMissingCaptionsEl && ui.advancedFilterMissingCaptionsEl.checked) return true;
  if (ui.advancedFilterReviewedEl && ui.advancedFilterReviewedEl.checked) return true;
  if (ui.advancedFilterUnreviewedEl && ui.advancedFilterUnreviewedEl.checked) return true;
  if (ui.advancedFilterUntaggedEl && ui.advancedFilterUntaggedEl.checked) return true;
  if (ui.advancedFilterIncompleteEl && ui.advancedFilterIncompleteEl.checked) return true;
  if (ui.advancedFilterInvalidArEl && ui.advancedFilterInvalidArEl.checked) return true;
  if (ui.advancedFilterSupersetEl && ui.advancedFilterSupersetEl.checked) return true;
  if (ui.advancedFilterStarsEl) {
    if (ui.advancedFilterStarsEl.querySelector('input[type="checkbox"]:checked')) return true;
  }
  if (ui.advancedFilterFlagEl) {
    if (ui.advancedFilterFlagEl.querySelector('input[type="checkbox"]:checked')) return true;
  }
  return false;
}

function getFocusedAnnotationSequence() {
  var items = [];
  if (typeof getFilteredMediaItems === 'function') {
    items = getFilteredMediaItems(false);
  } else if (state && Array.isArray(state.items)) {
    items = state.items.slice();
  }
  var deduped = [];
  var seen = {};
  (Array.isArray(items) ? items : []).forEach(function (item) {
    if (!item || !item.key || seen[item.key]) return;
    seen[item.key] = true;
    deduped.push(item);
  });
  var sourceLabel = 'Current Folder';
  if (state && state.focusSet && state.focusSet.keys && state.focusSet.keys.length) {
    sourceLabel = String(state.focusSet.source || 'Focus Set');
  } else if (focusedAnnotationAnyFilterActive()) {
    sourceLabel = 'Filtered View';
  }
  return {
    items: deduped,
    sourceLabel: sourceLabel
  };
}

function getFocusedAnnotationFirstIncompleteGroupIndex(mediaKey, startIndex) {
  var key = String(mediaKey || '').trim();
  var requirements = Array.isArray(checklistItems) ? checklistItems : [];
  var start = Math.max(0, Number(startIndex) || 0);
  if (!key || !requirements.length) return -1;
  for (var i = start; i < requirements.length; i++) {
    var requirement = requirements[i];
    var isChecked = (typeof isChecklistRequirementCheckedForMediaKey === 'function')
      ? isChecklistRequirementCheckedForMediaKey(key, requirement)
      : false;
    var isNa = (typeof isChecklistRequirementNaForMediaKey === 'function')
      ? isChecklistRequirementNaForMediaKey(key, requirement)
      : false;
    if (!isChecked && !isNa) {
      return i;
    }
  }
  return -1;
}

function getFocusedAnnotationNextPendingStep(itemIndex, groupIndex) {
  var itemKeys = Array.isArray(focusedAnnotationState.itemKeys) ? focusedAnnotationState.itemKeys : [];
  if (!itemKeys.length) return null;
  var currentItemIndex = Math.max(0, Number(itemIndex) || 0);
  var nextGroupIndex = Math.max(0, (Number(groupIndex) || 0) + 1);
  var currentKey = itemKeys[currentItemIndex];
  var currentPending = getFocusedAnnotationFirstIncompleteGroupIndex(currentKey, nextGroupIndex);
  if (currentPending >= 0) {
    return { itemIndex: currentItemIndex, groupIndex: currentPending };
  }
  for (var i = currentItemIndex + 1; i < itemKeys.length; i++) {
    var pendingIndex = getFocusedAnnotationFirstIncompleteGroupIndex(itemKeys[i], 0);
    if (pendingIndex >= 0) {
      return { itemIndex: i, groupIndex: pendingIndex };
    }
  }
  return null;
}

function getFocusedAnnotationFirstPendingStepFromItemIndex(itemIndex) {
  var itemKeys = Array.isArray(focusedAnnotationState.itemKeys) ? focusedAnnotationState.itemKeys : [];
  if (!itemKeys.length) return null;
  var startItemIndex = Math.max(0, Number(itemIndex) || 0);
  for (var i = startItemIndex; i < itemKeys.length; i++) {
    var pendingIndex = getFocusedAnnotationFirstIncompleteGroupIndex(itemKeys[i], 0);
    if (pendingIndex >= 0) {
      return { itemIndex: i, groupIndex: pendingIndex };
    }
  }
  return null;
}

function getFocusedAnnotationCurrentRequirement() {
  var requirements = Array.isArray(checklistItems) ? checklistItems : [];
  if (!requirements.length) return '';
  var idx = Math.max(0, Math.min(requirements.length - 1, Number(focusedAnnotationState.groupIndex) || 0));
  return String(requirements[idx] || '');
}

function closeFocusedAnnotationModal() {
  var els = getFocusedAnnotationEls();
  if (els.modal) els.modal.classList.add('hidden');
  document.body.classList.remove('focused-annotation-open');
  focusedAnnotationState.open = false;
  focusedAnnotationState.itemKeys = [];
  focusedAnnotationState.itemIndex = 0;
  focusedAnnotationState.groupIndex = 0;
  focusedAnnotationState.history = [];
  focusedAnnotationState.sourceLabel = '';
}

function showFocusedAnnotationModal() {
  var els = getFocusedAnnotationEls();
  if (els.modal) els.modal.classList.remove('hidden');
  document.body.classList.add('focused-annotation-open');
  focusedAnnotationState.open = true;
}

function getFocusedAnnotationMediaUrl(mediaItem) {
  if (!mediaItem || !mediaItem.fileName) return '';
  return '/caption/media?folder=' + encodeURIComponent(state.folder || '') +
    '&media=' + encodeURIComponent(mediaItem.fileName) +
    '&t=' + Date.now();
}

function renderFocusedAnnotationPreview(mediaItem) {
  var els = getFocusedAnnotationEls();
  if (!els.previewMedia) return;
  var mediaKey = String((mediaItem && mediaItem.key) || '').trim();
  if (!mediaItem || !mediaItem.fileName) {
    els.previewMedia.innerHTML = '';
    els.previewMedia.removeAttribute('data-media-key');
    els.previewMedia.textContent = 'No media selected.';
    return;
  }
  if (els.previewMedia.getAttribute('data-media-key') === mediaKey && els.previewMedia.firstChild) {
    return;
  }
  els.previewMedia.innerHTML = '';
  els.previewMedia.setAttribute('data-media-key', mediaKey);
  var url = getFocusedAnnotationMediaUrl(mediaItem);
  if (isPreviewVideoFileName(mediaItem.fileName)) {
    var video = document.createElement('video');
    video.controls = true;
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = url;
    video.className = 'focused-annotation-preview-video';
    els.previewMedia.appendChild(video);
    return;
  }
  var img = document.createElement('img');
  img.src = url;
  img.alt = mediaItem.fileName;
  img.className = 'focused-annotation-preview-image';
  els.previewMedia.appendChild(img);
}

function buildFocusedAnnotationBadge(text, kind) {
  var badge = document.createElement('span');
  badge.className = 'focused-annotation-badge';
  if (kind) badge.classList.add(kind);
  badge.textContent = text;
  return badge;
}

function renderFocusedAnnotationStatus(mediaKey, requirementLabel) {
  var els = getFocusedAnnotationEls();
  if (!els.groupStatus) return;
  els.groupStatus.innerHTML = '';
  var isChecked = (typeof isChecklistRequirementCheckedForMediaKey === 'function')
    ? isChecklistRequirementCheckedForMediaKey(mediaKey, requirementLabel)
    : false;
  var isNa = (typeof isChecklistRequirementNaForMediaKey === 'function')
    ? isChecklistRequirementNaForMediaKey(mediaKey, requirementLabel)
    : false;
  if (isChecked) {
    els.groupStatus.appendChild(buildFocusedAnnotationBadge('Reviewed', 'focused-annotation-badge-reviewed'));
  }
  if (isNa) {
    els.groupStatus.appendChild(buildFocusedAnnotationBadge('N/A', 'focused-annotation-badge-na'));
  }
}

function toggleFocusedAnnotationTerm(requirementLabel, termText) {
  if (!state.currentItem || !state.currentItem.key) return;
  var mediaKey = state.currentItem.key;
  var term = normalizeChecklistTerm(termText);
  if (!term) return;
  if (!hasTagForMediaKey(mediaKey, term)) {
    if (typeof isChecklistRequirementNaForMediaKey === 'function' &&
        typeof setChecklistRequirementNaForMediaKey === 'function' &&
        isChecklistRequirementNaForMediaKey(mediaKey, requirementLabel)) {
      setChecklistRequirementNaForMediaKey(mediaKey, requirementLabel, false, { skipRender: true });
    }
    addTagToCurrentMedia(term);
  } else {
    removeTagFromCurrentMedia(term);
  }
  renderFocusedAnnotationModal();
}

function renderFocusedAnnotationTerms(mediaKey, requirementLabel) {
  var els = getFocusedAnnotationEls();
  if (!els.termList) return;
  els.termList.innerHTML = '';
  var terms = typeof getChecklistKeywordTermsForRequirement === 'function'
    ? getChecklistKeywordTermsForRequirement(requirementLabel)
    : [];
  if (!terms.length) {
    var empty = document.createElement('div');
    empty.className = 'focused-annotation-empty';
    empty.textContent = 'No terms configured for this group yet.';
    els.termList.appendChild(empty);
    return;
  }
  terms.forEach(function (term) {
    var row = document.createElement('div');
    row.className = 'focused-annotation-term-row';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'focused-annotation-term-btn';
    if (hasTagForMediaKey(mediaKey, term)) btn.classList.add('active');
    if (typeof tagAppearsInCurrentCaption === 'function' && tagAppearsInCurrentCaption(term)) {
      btn.classList.add('matched');
    }
    btn.textContent = term;
    btn.onclick = function () {
      toggleFocusedAnnotationTerm(requirementLabel, term);
    };
    row.appendChild(btn);
    els.termList.appendChild(row);
  });
}

function renderFocusedAnnotationModal() {
  if (!focusedAnnotationState.open) return;
  var els = getFocusedAnnotationEls();
  var itemKeys = Array.isArray(focusedAnnotationState.itemKeys) ? focusedAnnotationState.itemKeys : [];
  var requirements = Array.isArray(checklistItems) ? checklistItems : [];
  if (!els.modal || !itemKeys.length) {
    closeFocusedAnnotationModal();
    return;
  }
  var targetItemKey = itemKeys[Math.max(0, Math.min(itemKeys.length - 1, focusedAnnotationState.itemIndex))];
  if (!targetItemKey) {
    closeFocusedAnnotationModal();
    return;
  }
  if (!state.currentItem || state.currentItem.key !== targetItemKey) {
    var targetItem = findFocusedAnnotationMediaItemByKey(targetItemKey);
    if (!targetItem || typeof selectPathMedia !== 'function') {
      closeFocusedAnnotationModal();
      return;
    }
    selectPathMedia(targetItem).then(function () {
      renderFocusedAnnotationModal();
    }).catch(function (err) {
      setStatus(String(err && err.message ? err.message : err));
      closeFocusedAnnotationModal();
    });
    return;
  }
  var mediaItem = state.currentItem;
  var groupIndex = Math.max(0, Math.min(Math.max(0, requirements.length - 1), Number(focusedAnnotationState.groupIndex) || 0));
  focusedAnnotationState.groupIndex = groupIndex;
  var requirementLabel = requirements.length ? String(requirements[groupIndex] || '') : '';
  if (els.itemProgress) {
    els.itemProgress.textContent = 'Item ' + (focusedAnnotationState.itemIndex + 1) + '/' + itemKeys.length;
  }
  if (els.groupProgress) {
    els.groupProgress.textContent = requirements.length
      ? ('Group ' + (groupIndex + 1) + '/' + requirements.length)
      : 'No Groups';
  }
  if (els.groupName) {
    els.groupName.textContent = requirementLabel || 'No requirement groups configured';
  }
  if (els.editTermsBtn) {
    els.editTermsBtn.disabled = !requirementLabel;
  }
  if (els.backBtn) {
    els.backBtn.disabled = !(focusedAnnotationState.history.length || groupIndex > 0 || focusedAnnotationState.itemIndex > 0);
  }
  if (els.skipBtn) {
    els.skipBtn.disabled = !requirementLabel;
  }
  if (els.naBtn) {
    els.naBtn.disabled = !requirementLabel;
  }
  if (els.doneBtn) {
    els.doneBtn.disabled = !requirementLabel;
  }
  renderFocusedAnnotationPreview(mediaItem);
  if (!requirementLabel) {
    if (els.groupStatus) els.groupStatus.innerHTML = '';
    if (els.termList) {
      els.termList.innerHTML = '';
      var empty = document.createElement('div');
      empty.className = 'focused-annotation-empty';
      empty.textContent = 'No requirement groups configured.';
      els.termList.appendChild(empty);
    }
    return;
  }
  renderFocusedAnnotationStatus(mediaItem.key, requirementLabel);
  renderFocusedAnnotationTerms(mediaItem.key, requirementLabel);
}

function navigateFocusedAnnotation(itemIndex, groupIndex, options) {
  var opts = options || {};
  var itemKeys = Array.isArray(focusedAnnotationState.itemKeys) ? focusedAnnotationState.itemKeys : [];
  if (!itemKeys.length) return;
  var nextItemIndex = Math.max(0, Math.min(itemKeys.length - 1, Number(itemIndex) || 0));
  var requirements = Array.isArray(checklistItems) ? checklistItems : [];
  var maxGroupIndex = Math.max(0, requirements.length - 1);
  var nextGroupIndex = Math.max(0, Math.min(maxGroupIndex, Number(groupIndex) || 0));
  if (opts.pushHistory) {
    focusedAnnotationState.history.push({
      itemIndex: focusedAnnotationState.itemIndex,
      groupIndex: focusedAnnotationState.groupIndex
    });
  }
  focusedAnnotationState.itemIndex = nextItemIndex;
  focusedAnnotationState.groupIndex = nextGroupIndex;
  var targetItem = findFocusedAnnotationMediaItemByKey(itemKeys[nextItemIndex]);
  if (!targetItem || typeof selectPathMedia !== 'function') {
    closeFocusedAnnotationModal();
    return;
  }
  selectPathMedia(targetItem).then(function () {
    renderFocusedAnnotationModal();
  }).catch(function (err) {
    setStatus(String(err && err.message ? err.message : err));
    closeFocusedAnnotationModal();
  });
}

function advanceFocusedAnnotationStep() {
  var requirements = Array.isArray(checklistItems) ? checklistItems : [];
  if (!requirements.length) {
    closeFocusedAnnotationModal();
    return;
  }
  var nextStep = getFocusedAnnotationNextPendingStep(
    focusedAnnotationState.itemIndex,
    focusedAnnotationState.groupIndex
  );
  if (nextStep) {
    navigateFocusedAnnotation(nextStep.itemIndex, nextStep.groupIndex, { pushHistory: true });
    return;
  }
  closeFocusedAnnotationModal();
  setStatus('Focused annotation complete.');
}

function moveFocusedAnnotationBack() {
  if (focusedAnnotationState.history.length) {
    var previous = focusedAnnotationState.history.pop();
    navigateFocusedAnnotation(previous.itemIndex, previous.groupIndex);
    return;
  }
  if (focusedAnnotationState.groupIndex > 0) {
    navigateFocusedAnnotation(focusedAnnotationState.itemIndex, focusedAnnotationState.groupIndex - 1);
    return;
  }
  if (focusedAnnotationState.itemIndex > 0) {
    navigateFocusedAnnotation(
      focusedAnnotationState.itemIndex - 1,
      Math.max(0, checklistItems.length - 1)
    );
  }
}

function markFocusedAnnotationGroupDone() {
  if (!state.currentItem || !state.currentItem.key) return;
  var requirementLabel = getFocusedAnnotationCurrentRequirement();
  if (!requirementLabel) return;
  if (typeof isChecklistRequirementNaForMediaKey === 'function' &&
      typeof setChecklistRequirementNaForMediaKey === 'function' &&
      isChecklistRequirementNaForMediaKey(state.currentItem.key, requirementLabel)) {
    setChecklistRequirementNaForMediaKey(state.currentItem.key, requirementLabel, false, { skipRender: true, skipSave: true });
  }
  if (typeof setChecklistRequirementCheckedForMediaKey === 'function') {
    setChecklistRequirementCheckedForMediaKey(state.currentItem.key, requirementLabel, true);
  }
  advanceFocusedAnnotationStep();
}

function markFocusedAnnotationGroupNa() {
  if (!state.currentItem || !state.currentItem.key) return;
  var requirementLabel = getFocusedAnnotationCurrentRequirement();
  if (!requirementLabel) return;
  if (typeof setChecklistRequirementNaForMediaKey === 'function') {
    setChecklistRequirementNaForMediaKey(state.currentItem.key, requirementLabel, true);
  }
  advanceFocusedAnnotationStep();
}

function skipFocusedAnnotationGroup() {
  advanceFocusedAnnotationStep();
}

function openFocusedAnnotationTermsEditor() {
  var requirementLabel = getFocusedAnnotationCurrentRequirement();
  if (!requirementLabel) return;
  if (typeof openChecklistGroupTermsModal === 'function') {
    openChecklistGroupTermsModal(requirementLabel);
  }
}

function beginFocusedAnnotationRun(targetMediaKey) {
  var sequence = getFocusedAnnotationSequence();
  var items = Array.isArray(sequence.items) ? sequence.items.slice() : [];
  var targetKey = String(targetMediaKey || '').trim();
  if (!items.length && state.currentItem && state.currentItem.key) {
    items = [state.currentItem];
  }
  if (targetKey && !items.some(function (item) { return item && item.key === targetKey; })) {
    var fallbackItem = findFocusedAnnotationMediaItemByKey(targetKey);
    if (fallbackItem) {
      items.unshift(fallbackItem);
    }
  }
  items = items.filter(function (item) { return !!(item && item.key); });
  if (!items.length) {
    setStatus('No media available for focused annotation.');
    return;
  }
  var itemKeys = items.map(function (item) { return item.key; });
  var itemIndex = Math.max(0, itemKeys.indexOf(targetKey));
  if (itemIndex < 0) itemIndex = 0;
  focusedAnnotationState.itemKeys = itemKeys;
  var firstPendingStep = getFocusedAnnotationFirstPendingStepFromItemIndex(itemIndex);
  if (!firstPendingStep) {
    setStatus('Everything in this focused scope is already reviewed.');
    return;
  }
  focusedAnnotationState.itemIndex = firstPendingStep.itemIndex;
  focusedAnnotationState.groupIndex = firstPendingStep.groupIndex;
  focusedAnnotationState.history = [];
  focusedAnnotationState.sourceLabel = String(sequence.sourceLabel || '');
  showFocusedAnnotationModal();
  renderFocusedAnnotationModal();
}

function openFocusedAnnotationForMediaItem(mediaItem) {
  if (!mediaItem || !mediaItem.key) {
    setStatus('Select a media item to annotate.');
    return;
  }
  var run = function () {
    beginFocusedAnnotationRun(mediaItem.key);
  };
  if (state.currentItem && state.currentItem.key === mediaItem.key) {
    run();
    return;
  }
  if (typeof selectPathMedia !== 'function') {
    run();
    return;
  }
  selectPathMedia(mediaItem).then(run).catch(function (err) {
    setStatus(String(err && err.message ? err.message : err));
  });
}

function openFocusedAnnotationModal() {
  if (!state.currentItem || !state.currentItem.key) {
    setStatus('Select a media item to annotate.');
    return;
  }
  openFocusedAnnotationForMediaItem(state.currentItem);
}

function wireFocusedAnnotationModal() {
  var els = getFocusedAnnotationEls();
  if (!els.modal || els.modal.__wired) return;
  els.modal.__wired = true;
  if (els.closeBtn) {
    els.closeBtn.addEventListener('click', closeFocusedAnnotationModal);
  }
  if (els.editTermsBtn) {
    els.editTermsBtn.addEventListener('click', openFocusedAnnotationTermsEditor);
  }
  if (els.backBtn) {
    els.backBtn.addEventListener('click', moveFocusedAnnotationBack);
  }
  if (els.skipBtn) {
    els.skipBtn.addEventListener('click', skipFocusedAnnotationGroup);
  }
  if (els.naBtn) {
    els.naBtn.addEventListener('click', markFocusedAnnotationGroupNa);
  }
  if (els.doneBtn) {
    els.doneBtn.addEventListener('click', markFocusedAnnotationGroupDone);
  }
  els.modal.addEventListener('click', function (e) {
    if (e.target === els.modal) {
      closeFocusedAnnotationModal();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (!isFocusedAnnotationOpen() || isFocusedAnnotationNestedModalOpen()) return;
    if (typeof isEditableElement === 'function' && isEditableElement(document.activeElement)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeFocusedAnnotationModal();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      markFocusedAnnotationGroupDone();
      return;
    }
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      markFocusedAnnotationGroupNa();
      return;
    }
    if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      skipFocusedAnnotationGroup();
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      moveFocusedAnnotationBack();
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      advanceFocusedAnnotationStep();
    }
  });
}

wireFocusedAnnotationModal();

window.openFocusedAnnotationModal = openFocusedAnnotationModal;
window.openFocusedAnnotationForMediaItem = openFocusedAnnotationForMediaItem;
window.renderFocusedAnnotationModal = renderFocusedAnnotationModal;
