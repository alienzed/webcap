var focusedAnnotationState = {
  open: false,
  itemKeys: [],
  itemIndex: 0,
  groupIndex: 0,
  history: [],
  sourceLabel: '',
  previousSurface: 'default',
  actionRefreshTimerFast: 0,
  actionRefreshTimerSlow: 0
};
var focusedAnnotationTagClipboard = [];
var focusedAnnotationTagClipboardSource = '';

function getFocusedAnnotationEls() {
  return {
    modal: document.getElementById('focused-annotation-modal'),
    previewMedia: document.getElementById('focused-annotation-preview-media'),
    itemProgress: document.getElementById('focused-annotation-item-progress'),
    itemPrevBtn: document.getElementById('focused-annotation-item-prev-btn'),
    itemNextBtn: document.getElementById('focused-annotation-item-next-btn'),
    groupProgress: document.getElementById('focused-annotation-group-progress'),
    groupPrevBtn: document.getElementById('focused-annotation-group-prev-btn'),
    groupNextBtn: document.getElementById('focused-annotation-group-next-btn'),
    groupName: document.getElementById('focused-annotation-group-name'),
    groupStatus: document.getElementById('focused-annotation-group-status'),
    termList: document.getElementById('focused-annotation-term-list'),
    quickPicks: document.getElementById('focused-annotation-quick-picks'),
    rating: document.getElementById('focused-annotation-rating'),
    previewActions: document.getElementById('focused-annotation-preview-actions'),
    copyTagsBtn: document.getElementById('focused-annotation-copy-tags-btn'),
    pasteTagsBtn: document.getElementById('focused-annotation-paste-tags-btn'),
    editTermsBtn: document.getElementById('focused-annotation-edit-terms-btn'),
    groupDeleteBtn: document.getElementById('focused-annotation-group-delete-btn'),
    closeBtn: document.getElementById('focused-annotation-close-btn'),
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
    'review-rules-modal'
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
    if (!isChecked) {
      return i;
    }
  }
  return -1;
}

function isFocusedAnnotationPendingStep(itemIndex, groupIndex) {
  var itemKeys = Array.isArray(focusedAnnotationState.itemKeys) ? focusedAnnotationState.itemKeys : [];
  var requirements = Array.isArray(checklistItems) ? checklistItems : [];
  if (!itemKeys.length || !requirements.length) return false;
  var boundedItemIndex = Math.max(0, Math.min(itemKeys.length - 1, Number(itemIndex) || 0));
  var boundedGroupIndex = Math.max(0, Math.min(requirements.length - 1, Number(groupIndex) || 0));
  var mediaKey = itemKeys[boundedItemIndex];
  var requirementLabel = String(requirements[boundedGroupIndex] || '');
  if (!mediaKey || !requirementLabel) return false;
  return getFocusedAnnotationFirstIncompleteGroupIndex(mediaKey, boundedGroupIndex) === boundedGroupIndex;
}

function getFocusedAnnotationTraversalSteps() {
  var itemKeys = Array.isArray(focusedAnnotationState.itemKeys) ? focusedAnnotationState.itemKeys : [];
  return getFocusedAnnotationTraversalStepsForKeys(itemKeys);
}

function getFocusedAnnotationNextPendingStep(itemIndex, groupIndex) {
  var steps = getFocusedAnnotationTraversalSteps();
  var currentItemIndex = Math.max(0, Number(itemIndex) || 0);
  var currentGroupIndex = Math.max(0, Number(groupIndex) || 0);
  for (var i = 0; i < steps.length; i++) {
    var step = steps[i];
    if (step.itemIndex !== currentItemIndex || step.groupIndex !== currentGroupIndex) continue;
    for (var nextIndex = i + 1; nextIndex < steps.length; nextIndex++) {
      if (isFocusedAnnotationPendingStep(steps[nextIndex].itemIndex, steps[nextIndex].groupIndex)) {
        return steps[nextIndex];
      }
    }
    return null;
  }
  return null;
}

function getFocusedAnnotationPreviousPendingStep(itemIndex, groupIndex) {
  var steps = getFocusedAnnotationTraversalSteps();
  var currentItemIndex = Math.max(0, Number(itemIndex) || 0);
  var currentGroupIndex = Math.max(0, Number(groupIndex) || 0);
  for (var i = 0; i < steps.length; i++) {
    var step = steps[i];
    if (step.itemIndex !== currentItemIndex || step.groupIndex !== currentGroupIndex) continue;
    for (var prevIndex = i - 1; prevIndex >= 0; prevIndex--) {
      if (isFocusedAnnotationPendingStep(steps[prevIndex].itemIndex, steps[prevIndex].groupIndex)) {
        return steps[prevIndex];
      }
    }
    return null;
  }
  return null;
}

function getFocusedAnnotationCurrentRequirement() {
  var requirements = Array.isArray(checklistItems) ? checklistItems : [];
  if (!requirements.length) return '';
  var idx = Math.max(0, Math.min(requirements.length - 1, Number(focusedAnnotationState.groupIndex) || 0));
  return String(requirements[idx] || '');
}

function getFocusedAnnotationTraversalStepsForKeys(itemKeys) {
  var keys = Array.isArray(itemKeys) ? itemKeys : [];
  var requirements = Array.isArray(checklistItems) ? checklistItems : [];
  var steps = [];
  if (!keys.length || !requirements.length) return steps;
  for (var nextGroupIndex = 0; nextGroupIndex < requirements.length; nextGroupIndex++) {
    for (var nextItemIndex = 0; nextItemIndex < keys.length; nextItemIndex++) {
      steps.push({ itemIndex: nextItemIndex, groupIndex: nextGroupIndex });
    }
  }
  return steps;
}

function isFocusedAnnotationStepComplete(mediaKey, requirementLabel) {
  return typeof isChecklistRequirementCheckedForMediaKey === 'function' &&
    isChecklistRequirementCheckedForMediaKey(mediaKey, requirementLabel);
}

function getFocusedAnnotationResumeStep(itemKeys, preferredMediaKey) {
  var keys = Array.isArray(itemKeys) ? itemKeys : [];
  var requirements = Array.isArray(checklistItems) ? checklistItems : [];
  if (!keys.length || !requirements.length) return null;

  var steps = getFocusedAnnotationTraversalStepsForKeys(keys);
  if (!steps.length) return null;

  var lastCompletedIndex = -1;
  for (var i = 0; i < steps.length; i++) {
    var step = steps[i];
    var mediaKey = keys[step.itemIndex];
    var requirementLabel = String(requirements[step.groupIndex] || '');
    if (!mediaKey || !requirementLabel) continue;
    if (isFocusedAnnotationStepComplete(mediaKey, requirementLabel)) {
      lastCompletedIndex = i;
    }
  }

  function findFirstPending(startIndex, endIndex) {
    for (var idx = Math.max(0, startIndex); idx < Math.min(steps.length, endIndex); idx++) {
      var candidate = steps[idx];
      var candidateMediaKey = keys[candidate.itemIndex];
      var candidateRequirementLabel = String(requirements[candidate.groupIndex] || '');
      if (!candidateMediaKey || !candidateRequirementLabel) continue;
      if (!isFocusedAnnotationStepComplete(candidateMediaKey, candidateRequirementLabel)) {
        return candidate;
      }
    }
    return null;
  }

  if (lastCompletedIndex >= 0) {
    var nextPending = findFirstPending(lastCompletedIndex + 1, steps.length);
    if (nextPending) return nextPending;
    return findFirstPending(0, lastCompletedIndex);
  }

  var preferredKey = String(preferredMediaKey || '').trim();
  if (preferredKey) {
    for (var j = 0; j < steps.length; j++) {
      var preferredStep = steps[j];
      if (keys[preferredStep.itemIndex] !== preferredKey) continue;
      var preferredRequirement = String(requirements[preferredStep.groupIndex] || '');
      if (!preferredRequirement) continue;
      if (!isFocusedAnnotationStepComplete(preferredKey, preferredRequirement)) {
        return preferredStep;
      }
    }
  }

  return findFirstPending(0, steps.length);
}

var FOCUSED_ANNOTATION_SUGGESTION_STOP_WORDS = {
  a: true,
  an: true,
  her: true,
  on: true,
  the: true
};

var FOCUSED_ANNOTATION_SELECTION_POSE_ALIASES = {
  '3 4': ['three quarter'],
  'arms out': ['arms spread'],
  'arms spread': ['arms out'],
  'lying back': ['lying on her back', 'lying down', 'reclining'],
  'lying down': ['lying back', 'lying on her back', 'reclining'],
  'lying on her back': ['lying back', 'lying down', 'reclining'],
  neutral: ['neutral expression'],
  'neutral expression': ['neutral'],
  reclining: ['lying back', 'lying down', 'lying on her back'],
  seated: ['sitting'],
  sitting: ['seated'],
  'three quarter': ['3 4']
};

function canonicalizeFocusedAnnotationSuggestionText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildFocusedAnnotationSuggestionVariants(value) {
  var canonical = canonicalizeFocusedAnnotationSuggestionText(value);
  var variants = {};

  function pushVariant(text) {
    var next = canonicalizeFocusedAnnotationSuggestionText(text);
    if (!next) return;
    variants[next] = true;
  }

  pushVariant(canonical);
  if (FOCUSED_ANNOTATION_SELECTION_POSE_ALIASES[canonical]) {
    FOCUSED_ANNOTATION_SELECTION_POSE_ALIASES[canonical].forEach(pushVariant);
  }
  Object.keys(FOCUSED_ANNOTATION_SELECTION_POSE_ALIASES).forEach(function (key) {
    var aliases = FOCUSED_ANNOTATION_SELECTION_POSE_ALIASES[key];
    if (Array.isArray(aliases) && aliases.indexOf(canonical) !== -1) {
      pushVariant(key);
    }
  });
  return Object.keys(variants);
}

function tokenizeFocusedAnnotationSuggestion(value) {
  return canonicalizeFocusedAnnotationSuggestionText(value)
    .split(' ')
    .filter(function (token) {
      return !!token && !FOCUSED_ANNOTATION_SUGGESTION_STOP_WORDS[token];
    });
}

function resolveFocusedAnnotationSuggestedTerm(suggestedTag, terms) {
  var suggestedVariants = buildFocusedAnnotationSuggestionVariants(suggestedTag);
  var bestMatch = '';
  var bestScore = -1;

  (Array.isArray(terms) ? terms : []).forEach(function (term) {
    var termVariants = buildFocusedAnnotationSuggestionVariants(term);
    for (var i = 0; i < termVariants.length; i += 1) {
      if (suggestedVariants.indexOf(termVariants[i]) !== -1) {
        bestMatch = term;
        bestScore = 999;
        return;
      }
    }
    if (bestScore >= 999) return;

    var termTokens = tokenizeFocusedAnnotationSuggestion(term);
    var shared = 0;
    suggestedVariants.forEach(function (variant) {
      var suggestionTokens = tokenizeFocusedAnnotationSuggestion(variant);
      if (!suggestionTokens.length || !termTokens.length) return;
      var termLookup = {};
      termTokens.forEach(function (token) {
        termLookup[token] = true;
      });
      var overlap = 0;
      suggestionTokens.forEach(function (token) {
        if (termLookup[token]) overlap += 1;
      });
      if (!overlap) return;
      var required = suggestionTokens.length <= 1 ? 1 : Math.min(2, suggestionTokens.length);
      if (overlap < required) return;
      var score = (overlap * 10) - Math.abs(termTokens.length - suggestionTokens.length);
      if (score > shared) shared = score;
    });
    if (shared > bestScore) {
      bestScore = shared;
      bestMatch = term;
    }
  });

  return bestScore > 0 ? bestMatch : '';
}

function closeFocusedAnnotationModal() {
  var els = getFocusedAnnotationEls();
  if (els.modal) els.modal.classList.add('hidden');
  document.body.classList.remove('focused-annotation-open');
  if (focusedAnnotationState.actionRefreshTimerFast) {
    clearTimeout(focusedAnnotationState.actionRefreshTimerFast);
    focusedAnnotationState.actionRefreshTimerFast = 0;
  }
  if (focusedAnnotationState.actionRefreshTimerSlow) {
    clearTimeout(focusedAnnotationState.actionRefreshTimerSlow);
    focusedAnnotationState.actionRefreshTimerSlow = 0;
  }
  focusedAnnotationState.open = false;
  focusedAnnotationState.itemKeys = [];
  focusedAnnotationState.itemIndex = 0;
  focusedAnnotationState.groupIndex = 0;
  focusedAnnotationState.history = [];
  focusedAnnotationState.sourceLabel = '';
  focusedAnnotationState.previousSurface = 'default';
  if (typeof setWorkspaceViewMode === 'function') {
    setWorkspaceViewMode('single');
  }
  if (typeof exitWorkspaceSurface === 'function') {
    exitWorkspaceSurface();
  }
  if (typeof renderFileList === 'function') {
    renderFileList(ui && ui.filterEl ? ui.filterEl.value : '');
  }
}

function showFocusedAnnotationModal() {
  var els = getFocusedAnnotationEls();
  var overlayHost = document.getElementById('workspace-overlays');
  if (overlayHost && els.modal && els.modal.parentNode !== overlayHost) {
    overlayHost.appendChild(els.modal);
  }
  if (els.modal) els.modal.classList.remove('hidden');
  document.body.classList.add('focused-annotation-open');
  focusedAnnotationState.open = true;
  if (typeof setWorkspaceViewMode === 'function') {
    setWorkspaceViewMode('focus');
  }
  if (typeof setWorkspaceSurface === 'function') {
    setWorkspaceSurface('focus', { sidebarHidden: true });
  }
  if (typeof setWorkspaceWorkflowMode === 'function') {
    setWorkspaceWorkflowMode('annotate');
  }
}

function moveFocusedAnnotationToAvailableItem(direction) {
  var itemKeys = Array.isArray(focusedAnnotationState.itemKeys) ? focusedAnnotationState.itemKeys : [];
  if (!itemKeys.length) return false;
  var startIndex = Math.max(0, Math.min(itemKeys.length - 1, Number(focusedAnnotationState.itemIndex) || 0));
  var step = direction < 0 ? -1 : 1;
  for (var offset = 1; offset <= itemKeys.length; offset += 1) {
    var candidateIndex = startIndex + (offset * step);
    if (candidateIndex < 0 || candidateIndex >= itemKeys.length) continue;
    if (!findFocusedAnnotationMediaItemByKey(itemKeys[candidateIndex])) continue;
    focusedAnnotationState.itemIndex = candidateIndex;
    renderFocusedAnnotationModal();
    return true;
  }
  for (var i = 0; i < itemKeys.length; i += 1) {
    if (!findFocusedAnnotationMediaItemByKey(itemKeys[i])) continue;
    focusedAnnotationState.itemIndex = i;
    renderFocusedAnnotationModal();
    return true;
  }
  return false;
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
    renderFocusedAnnotationRating('');
    renderFocusedAnnotationPreviewActions(null);
    return;
  }
  if (els.previewMedia.getAttribute('data-media-key') === mediaKey && els.previewMedia.firstChild) {
    renderFocusedAnnotationRating(mediaKey);
    renderFocusedAnnotationPreviewActions(mediaItem);
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
    renderFocusedAnnotationRating(mediaKey);
    renderFocusedAnnotationPreviewActions(mediaItem);
    return;
  }
  var img = document.createElement('img');
  img.src = url;
  img.alt = mediaItem.fileName;
  img.className = 'focused-annotation-preview-image';
  els.previewMedia.appendChild(img);
  renderFocusedAnnotationRating(mediaKey);
  renderFocusedAnnotationPreviewActions(mediaItem);
}

function renderFocusedAnnotationRating(mediaKey) {
  var els = getFocusedAnnotationEls();
  if (!els.rating) return;
  els.rating.innerHTML = '';
  if (!mediaKey) return;

  var currentRating = getRatingForMediaKey(mediaKey);
  for (var s = 1; s <= 5; s++) {
    (function (value) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'focused-annotation-rating-star' + (value <= currentRating ? ' active' : '');
      btn.textContent = value <= currentRating ? '\u2605' : '\u2606';
      btn.title = 'Set rating to ' + value + ' star' + (value === 1 ? '' : 's');
      btn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        var previousKeys = focusedAnnotationState.itemKeys.slice();
        var previousIndex = focusedAnnotationState.itemIndex;
        setRatingForMediaKey(mediaKey, value);
        refreshFocusedAnnotationSequenceAfterRating(mediaKey, previousKeys, previousIndex);
      };
      els.rating.appendChild(btn);
    })(s);
  }
}

function refreshFocusedAnnotationSequenceAfterRating(mediaKey, previousKeys, previousIndex) {
  var priorKeys = Array.isArray(previousKeys) ? previousKeys : [];
  var filteredItems = getFilteredMediaItems(false);
  var nextKeys = (Array.isArray(filteredItems) ? filteredItems : [])
    .filter(function (item) { return !!(item && item.key); })
    .map(function (item) { return item.key; });

  focusedAnnotationState.history = (focusedAnnotationState.history || []).map(function (entry) {
    var historyKey = priorKeys[Number(entry && entry.itemIndex) || 0];
    var nextIndex = nextKeys.indexOf(historyKey);
    if (nextIndex < 0) return null;
    return {
      itemIndex: nextIndex,
      groupIndex: Number(entry && entry.groupIndex) || 0
    };
  }).filter(Boolean);
  focusedAnnotationState.itemKeys = nextKeys;

  if (!nextKeys.length) {
    closeFocusedAnnotationModal();
    setStatus('No items remain in the focused annotation filter.');
    return;
  }

  var retainedIndex = nextKeys.indexOf(mediaKey);
  if (retainedIndex >= 0) {
    focusedAnnotationState.itemIndex = retainedIndex;
    renderFocusedAnnotationModal();
    return;
  }

  var requirements = Array.isArray(checklistItems) ? checklistItems : [];
  var currentGroupIndex = Math.max(0, Math.min(requirements.length - 1, Number(focusedAnnotationState.groupIndex) || 0));
  var startItemIndex = Math.max(0, Number(previousIndex) || 0);
  for (var groupIndex = currentGroupIndex; groupIndex < requirements.length; groupIndex++) {
    var itemStart = groupIndex === currentGroupIndex ? startItemIndex : 0;
    for (var itemIndex = itemStart; itemIndex < nextKeys.length; itemIndex++) {
      if (!isFocusedAnnotationPendingStep(itemIndex, groupIndex)) continue;
      navigateFocusedAnnotation(itemIndex, groupIndex);
      return;
    }
  }

  closeFocusedAnnotationModal();
  setStatus('Focused annotation complete.');
}

function getFocusedAnnotationPreviewContextActions(mediaItem) {
  if (!mediaItem || !mediaItem.fileName) return [];
  var key = mediaItem.key || mediaItem.fileName;
  var actions = buildMediaContextMenuActions(mediaItem, key);
  return (Array.isArray(actions) ? actions : []).filter(function (action) {
    return !action || action.separator || String(action.label || '') !== 'Focused Annotate...';
  });
}

function scheduleFocusedAnnotationActionRefresh() {
  if (!focusedAnnotationState.open) return;
  if (focusedAnnotationState.actionRefreshTimerFast) {
    clearTimeout(focusedAnnotationState.actionRefreshTimerFast);
  }
  if (focusedAnnotationState.actionRefreshTimerSlow) {
    clearTimeout(focusedAnnotationState.actionRefreshTimerSlow);
  }
  focusedAnnotationState.actionRefreshTimerFast = setTimeout(function () {
    focusedAnnotationState.actionRefreshTimerFast = 0;
    if (!focusedAnnotationState.open) return;
    renderFocusedAnnotationModal();
  }, 80);
  focusedAnnotationState.actionRefreshTimerSlow = setTimeout(function () {
    focusedAnnotationState.actionRefreshTimerSlow = 0;
    if (!focusedAnnotationState.open) return;
    renderFocusedAnnotationModal();
  }, 900);
}

function renderFocusedAnnotationPreviewActions(mediaItem) {
  var els = getFocusedAnnotationEls();
  if (!els.previewActions) return;
  els.previewActions.innerHTML = '';
  if (!mediaItem || !mediaItem.fileName) {
    els.previewActions.classList.add('hidden');
    return;
  }
  var actions = getFocusedAnnotationPreviewContextActions(mediaItem);
  if (!hasNonSeparatorActions(actions)) {
    els.previewActions.classList.add('hidden');
    return;
  }

  var key = mediaItem.key || mediaItem.fileName;
  var mutationResetAction = findPreviewActionByLabel(actions, 'Reset');
  var showMutationReset = !!(isMediaMutated(key) && mutationResetAction);
  var plan = getPreviewPrimaryActionPlan(mediaItem.fileName);
  var primaryA = findPreviewActionByLabel(actions, plan[0].actionLabel);
  var primaryB = findPreviewActionByLabel(actions, plan[1].actionLabel);
  var used = {};
  if (primaryA) used[plan[0].actionLabel] = true;
  if (primaryB) used[plan[1].actionLabel] = true;
  var secondaryActions = filterPreviewSecondaryActions(actions, used);
  var hasMore = hasNonSeparatorActions(secondaryActions);

  function appendActionButton(label, onClick, extraClass) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn focused-annotation-secondary-action-btn focused-annotation-preview-action-btn';
    if (extraClass) btn.classList.add(extraClass);
    btn.textContent = label;
    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      onClick(e);
    };
    els.previewActions.appendChild(btn);
  }

  if (showMutationReset) {
    appendActionButton('Reset', function () {
      mutationResetAction.run();
      scheduleFocusedAnnotationActionRefresh();
    }, 'focused-annotation-preview-reset-btn');
  }
  if (primaryA) {
    appendActionButton(plan[0].label, function () {
      primaryA.run();
      scheduleFocusedAnnotationActionRefresh();
    });
  }
  if (primaryB) {
    appendActionButton(plan[1].label, function () {
      primaryB.run();
      scheduleFocusedAnnotationActionRefresh();
    });
  }
  if (hasMore) {
    appendActionButton('More', function (event) {
      var rect = event.currentTarget.getBoundingClientRect();
      var menuActions = secondaryActions.map(function (action) {
        if (!action || action.separator || typeof action.run !== 'function') return action;
        return {
          label: action.label,
          render: action.render,
          run: function () {
            action.run();
            scheduleFocusedAnnotationActionRefresh();
          }
        };
      });
      showContextMenu(rect.left, rect.bottom + 6, menuActions);
    });
  }

  els.previewActions.classList.toggle('hidden', !els.previewActions.childNodes.length);
}

function updateFocusedAnnotationGroupClipboardUi() {
  var els = getFocusedAnnotationEls();
  if (!els.copyTagsBtn || !els.pasteTagsBtn) return;
  var requirementLabel = getFocusedAnnotationCurrentRequirement();
  var hasCurrentItem = !!(state.currentItem && state.currentItem.key);
  var clipboardCount = focusedAnnotationTagClipboard.length;
  var canPaste = hasCurrentItem && !!requirementLabel && clipboardCount > 0 && focusedAnnotationTagClipboardSource === requirementLabel;
  els.copyTagsBtn.disabled = !hasCurrentItem || !requirementLabel;
  els.copyTagsBtn.textContent = clipboardCount > 0 && focusedAnnotationTagClipboardSource === requirementLabel
    ? 'Tags Copied (' + clipboardCount + ')'
    : 'Copy Tags';
  els.copyTagsBtn.title = hasCurrentItem && requirementLabel
    ? 'Copy selected tags from this group'
    : 'Select a media item and group to copy tags from';
  els.pasteTagsBtn.textContent = clipboardCount > 0
    ? 'Paste Tags (' + clipboardCount + ')'
    : 'Paste Tags';
  els.pasteTagsBtn.disabled = !canPaste;
  if (!clipboardCount) {
    els.pasteTagsBtn.title = 'Copy selected tags from this group first';
  } else if (!hasCurrentItem || !requirementLabel) {
    els.pasteTagsBtn.title = 'Select a group to paste tags into';
  } else if (!canPaste) {
    els.pasteTagsBtn.title = 'These tags were copied from "' + focusedAnnotationTagClipboardSource + '". Return to that group to paste them.';
  } else {
    els.pasteTagsBtn.title = 'Select ' + clipboardCount + ' copied tag' + (clipboardCount === 1 ? '' : 's') + ' on this media item';
  }
}

function getFocusedAnnotationSelectedGroupTags(mediaKey, requirementLabel) {
  var groupTermsByKey = {};
  getFocusedAnnotationTermsForRequirement(requirementLabel).forEach(function (term) {
    var key = normalizeChecklistTerm(term).toLowerCase();
    if (key) groupTermsByKey[key] = term;
  });
  return getTagsForMediaKey(mediaKey).map(function (tag) {
    return groupTermsByKey[normalizeChecklistTerm(tag).toLowerCase()] || '';
  }).filter(Boolean);
}

function copyFocusedAnnotationSelectedGroupTags() {
  var requirementLabel = getFocusedAnnotationCurrentRequirement();
  var mediaKey = state.currentItem && state.currentItem.key;
  if (!requirementLabel || !mediaKey) return false;
  focusedAnnotationTagClipboard = normalizeChecklistTermsList(getFocusedAnnotationSelectedGroupTags(mediaKey, requirementLabel));
  focusedAnnotationTagClipboardSource = requirementLabel;
  updateFocusedAnnotationGroupClipboardUi();
  if (!focusedAnnotationTagClipboard.length) {
    showFocusedAnnotationGroupClipboardNotice('No selected tags in this group to copy.', 'focused-annotation-badge-reviewed');
    setStatus('No selected tags in this group to copy.');
    return false;
  }
  showFocusedAnnotationGroupClipboardNotice(
    'Copied ' + focusedAnnotationTagClipboard.length + ' selected tag' + (focusedAnnotationTagClipboard.length === 1 ? '' : 's') + '.',
    'focused-annotation-badge-reviewed'
  );
  setStatus('Copied ' + focusedAnnotationTagClipboard.length + ' selected tag' + (focusedAnnotationTagClipboard.length === 1 ? '' : 's') + '.');
  return true;
}

function pasteFocusedAnnotationSelectedGroupTags() {
  var requirementLabel = getFocusedAnnotationCurrentRequirement();
  var mediaKey = state.currentItem && state.currentItem.key;
  if (!requirementLabel || !mediaKey || focusedAnnotationTagClipboardSource !== requirementLabel || !focusedAnnotationTagClipboard.length) return false;
  var result = mergeTagsIntoMediaKey(mediaKey, focusedAnnotationTagClipboard);
  renderFocusedAnnotationModal();
  if (!result.added) {
    showFocusedAnnotationGroupClipboardNotice('All copied tags are already selected.', 'focused-annotation-badge-reviewed');
    setStatus('All copied tags are already selected.');
    return false;
  }
  showFocusedAnnotationGroupClipboardNotice(
    'Selected ' + result.added + ' copied tag' + (result.added === 1 ? '' : 's') + '.',
    'focused-annotation-badge-reviewed'
  );
  setStatus('Selected ' + result.added + ' copied tag' + (result.added === 1 ? '' : 's') + '.');
  return true;
}

function showFocusedAnnotationGroupClipboardNotice(text, kind) {
  var els = getFocusedAnnotationEls();
  if (!els.groupStatus) return;
  var existing = els.groupStatus.querySelector('.focused-annotation-group-clipboard-notice');
  if (existing) existing.remove();
  var notice = buildFocusedAnnotationBadge(text, kind || 'focused-annotation-badge-reviewed');
  notice.classList.add('focused-annotation-group-clipboard-notice');
  els.groupStatus.appendChild(notice);
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
  if (isChecked) {
    els.groupStatus.appendChild(buildFocusedAnnotationBadge('Reviewed', 'focused-annotation-badge-reviewed'));
  }
}

function flashFocusedAnnotationButton(btn) {
  if (!btn) return;
  btn.classList.remove('focused-annotation-btn-flash');
  void btn.offsetWidth;
  btn.classList.add('focused-annotation-btn-flash');
  setTimeout(function () {
    btn.classList.remove('focused-annotation-btn-flash');
  }, 220);
}

function getFocusedAnnotationTermsForRequirement(requirementLabel) {
  return typeof getChecklistKeywordTermsForRequirement === 'function'
    ? getChecklistKeywordTermsForRequirement(requirementLabel)
    : [];
}

function buildFocusedAnnotationQuickPickEntries(mediaKey, requirementLabel) {
  var terms = getFocusedAnnotationTermsForRequirement(requirementLabel);
  var termLookup = {};
  var entriesByKey = {};
  var currentTags = getTagsForMediaKey(mediaKey);
  terms.forEach(function (term) {
    var normalized = normalizeChecklistTerm(term).toLowerCase();
    if (!normalized || termLookup[normalized]) return;
    termLookup[normalized] = term;
  });

  function addEntry(term, reason, priority, kind) {
    var normalized = normalizeChecklistTerm(term).toLowerCase();
    if (!normalized || !termLookup[normalized]) return;
    var existing = entriesByKey[normalized];
    if (!existing) {
      existing = {
        term: termLookup[normalized],
        reasons: [],
        priority: Number(priority) || 0,
        kinds: {}
      };
      entriesByKey[normalized] = existing;
    }
    if (reason && existing.reasons.indexOf(reason) === -1) {
      existing.reasons.push(reason);
    }
    existing.priority = Math.max(existing.priority, Number(priority) || 0);
    if (kind) existing.kinds[kind] = true;
  }

  terms.forEach(function (term) {
    if (hasTagForMediaKey(mediaKey, term)) {
      addEntry(term, 'Selected', 100, 'active');
    }
    if (typeof tagAppearsInCurrentCaption === 'function' && tagAppearsInCurrentCaption(term)) {
      addEntry(term, 'Caption match', 80, 'matched');
    }
  });

  var mediaItem = findFocusedAnnotationMediaItemByKey(mediaKey);
  var metadataRow = mediaItem ? (mediaItem.metadata || getMetadataForMedia(mediaItem.fileName)) : null;
  var selectionPoseSuggestions = getSelectionPoseSuggestedTags(metadataRow, currentTags);
  selectionPoseSuggestions.forEach(function (suggestedTag) {
    var resolvedTerm = resolveFocusedAnnotationSuggestedTerm(suggestedTag, terms);
    if (!resolvedTerm) return;
    addEntry(resolvedTerm, 'Selection pose', 74, 'suggested');
  });

  if (typeof buildQaTagNeighborRows === 'function') {
    var summary = buildQaTagNeighborRows(mediaKey);
    var qaCurrentTags = summary && Array.isArray(summary.currentTags) ? summary.currentTags : [];
    var neighbors = summary && Array.isArray(summary.rows) ? summary.rows.filter(function (row) {
      return row.sharedCount >= 2 && row.overlapCurrent >= 0.5;
    }).slice(0, 6) : [];
    if (qaCurrentTags.length >= 2 && neighbors.length >= 2) {
      var currentLookup = {};
      qaCurrentTags.forEach(function (tag) {
        currentLookup[String(tag || '').toLowerCase()] = true;
      });
      var counts = {};
      neighbors.forEach(function (row) {
        row.otherTags.forEach(function (tag) {
          var normalized = normalizeChecklistTerm(tag).toLowerCase();
          if (!normalized || currentLookup[normalized] || !termLookup[normalized]) return;
          counts[normalized] = (counts[normalized] || 0) + 1;
        });
      });
      Object.keys(counts)
        .sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); })
        .slice(0, 6)
        .forEach(function (normalized) {
          addEntry(
            termLookup[normalized],
            'Similar items ' + counts[normalized] + '/' + neighbors.length,
            60 + counts[normalized],
            'suggested'
          );
        });
    }
  }

  return Object.keys(entriesByKey)
    .map(function (key) { return entriesByKey[key]; })
    .sort(function (a, b) {
      return b.priority - a.priority || a.term.localeCompare(b.term);
    })
    .slice(0, 8);
}

function buildFocusedAnnotationSetUsageEntries(requirementLabel) {
  return buildSetTagUsageEntries(getFocusedAnnotationTermsForRequirement(requirementLabel), 6);
}

function appendFocusedAnnotationQuickPickRow(list, requirementLabel, term, metaText, classes) {
  var row = document.createElement('div');
  row.className = 'focused-annotation-quick-pick-row';
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn focused-annotation-quick-pick-btn';
  (classes || []).forEach(function (className) { btn.classList.add(className); });
  btn.textContent = term;
  var isActive = hasTagForMediaKey(state.currentItem.key, term);
  var buttonTitle = (isActive ? 'Remove "' : 'Add "') + term + '" on the current item';
  btn.title = buttonTitle;
  btn.onclick = function () {
    toggleFocusedAnnotationTerm(requirementLabel, term);
  };
  bindFocusedAnnotationTermAffixContextMenu(btn, term, buttonTitle);
  row.appendChild(btn);
  if (metaText) {
    var meta = document.createElement('div');
    meta.className = 'focused-annotation-quick-pick-meta';
    meta.textContent = metaText;
    row.appendChild(meta);
  }
  list.appendChild(row);
}

function renderFocusedAnnotationQuickPicks(requirementLabel, entries) {
  var els = getFocusedAnnotationEls();
  if (!els.quickPicks) return;
  var picksEl = els.quickPicks;
  picksEl.innerHTML = '';
  var entriesList = Array.isArray(entries) ? entries : [];
  if (!requirementLabel) {
    picksEl.classList.add('hidden');
    return;
  }
  picksEl.classList.remove('hidden');
  var title = document.createElement('div');
  title.className = 'focused-annotation-quick-picks-title';
  title.textContent = 'Quick Picks';
  picksEl.appendChild(title);
  if (entriesList.length) {
    var list = document.createElement('div');
    list.className = 'focused-annotation-quick-pick-list';
    entriesList.forEach(function (entry) {
      var classes = [];
      if (entry.kinds.active) classes.push('active');
      if (entry.kinds.matched) classes.push('matched');
      if (entry.kinds.suggested) classes.push('suggested');
      appendFocusedAnnotationQuickPickRow(list, requirementLabel, entry.term, entry.reasons.join(' | '), classes);
    });
    picksEl.appendChild(list);
  } else {
    var empty = document.createElement('div');
    empty.className = 'focused-annotation-quick-picks-empty';
    empty.textContent = 'No strong quick picks for this group yet.';
    picksEl.appendChild(empty);
  }
  var usageEntries = buildFocusedAnnotationSetUsageEntries(requirementLabel);
  if (usageEntries.length) {
    var usageSection = document.createElement('div');
    usageSection.className = 'focused-annotation-set-usage';
    var usageTitle = document.createElement('div');
    usageTitle.className = 'focused-annotation-set-usage-title';
    usageTitle.textContent = 'Used in this set';
    usageSection.appendChild(usageTitle);
    var usageList = document.createElement('div');
    usageList.className = 'focused-annotation-set-usage-list';
    usageEntries.forEach(function (entry) {
      appendFocusedAnnotationQuickPickRow(
        usageList,
        requirementLabel,
        entry.term,
        entry.count + ' item' + (entry.count === 1 ? '' : 's'),
        hasTagForMediaKey(state.currentItem.key, entry.term) ? ['active'] : []
      );
    });
    usageSection.appendChild(usageList);
    picksEl.appendChild(usageSection);
  }
  renderFocusedAnnotationCurrentTags(picksEl);
}

function renderFocusedAnnotationCurrentTags(parentEl) {
  if (!parentEl || !state.currentItem || !state.currentItem.key) return;
  var section = document.createElement('div');
  section.className = 'focused-annotation-current-tags';

  var title = document.createElement('div');
  title.className = 'focused-annotation-current-tags-title';
  title.textContent = 'Current Tags';
  section.appendChild(title);

  var tags = (typeof getTagsForMediaKey === 'function')
    ? getTagsForMediaKey(state.currentItem.key)
    : [];
  if (!tags.length) {
    var empty = document.createElement('div');
    empty.className = 'focused-annotation-current-tags-empty';
    empty.textContent = 'No tags on this item yet.';
    section.appendChild(empty);
    parentEl.appendChild(section);
    return;
  }

  var list = document.createElement('div');
  list.className = 'focused-annotation-current-tag-list';
  tags.forEach(function (tag) {
    var chip = document.createElement('span');
    chip.className = 'focused-annotation-current-tag';
    chip.textContent = tag;
    bindFocusedAnnotationTermAffixContextMenu(chip, tag, 'Current tag "' + tag + '"');
    list.appendChild(chip);
  });
  section.appendChild(list);
  parentEl.appendChild(section);
}

function toggleFocusedAnnotationTerm(requirementLabel, termText) {
  if (!state.currentItem || !state.currentItem.key) return;
  var mediaKey = state.currentItem.key;
  var term = normalizeChecklistTerm(termText);
  if (!term) return;
  if (!hasTagForMediaKey(mediaKey, term)) {
    addTagToCurrentMedia(term, { reviewRequirementLabel: requirementLabel });
  } else {
    removeTagFromCurrentMedia(term);
  }
  renderFocusedAnnotationModal();
}

function bindFocusedAnnotationTermAffixContextMenu(targetEl, termText, titlePrefix) {
  if (!targetEl || typeof openChecklistTermAffixesModal !== 'function') return;
  var term = normalizeChecklistTerm(termText);
  if (!term) return;
  var baseTitle = String(titlePrefix || '').trim();
  targetEl.title = (baseTitle ? (baseTitle + ' - ') : '') + 'Right-click to edit prefix/suffix';
  targetEl.addEventListener('contextmenu', function (event) {
    event.preventDefault();
    event.stopPropagation();
    openChecklistTermAffixesModal(term);
  });
}

function renderFocusedAnnotationTerms(mediaKey, requirementLabel, quickPickEntries) {
  var els = getFocusedAnnotationEls();
  if (!els.termList) return;
  els.termList.innerHTML = '';
  var terms = getFocusedAnnotationTermsForRequirement(requirementLabel);
  var quickPickLookup = {};
  (Array.isArray(quickPickEntries) ? quickPickEntries : []).forEach(function (entry) {
    if (!entry || !entry.term) return;
    quickPickLookup[normalizeChecklistTerm(entry.term).toLowerCase()] = entry;
  });
  if (!terms.length) {
    var empty = document.createElement('div');
    empty.className = 'focused-annotation-empty';
    empty.textContent = 'No terms configured for this group yet.';
    els.termList.appendChild(empty);
    return;
  }
  var termEntries = [];
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
    var quickPickEntry = quickPickLookup[normalizeChecklistTerm(term).toLowerCase()];
    if (quickPickEntry && quickPickEntry.kinds && quickPickEntry.kinds.suggested) {
      btn.classList.add('suggested');
    }
    btn.textContent = term;
    var buttonTitle = hasTagForMediaKey(mediaKey, term)
      ? ('Remove "' + term + '" from the current item')
      : ('Add "' + term + '" to the current item');
    btn.title = buttonTitle;
    btn.onclick = function () {
      toggleFocusedAnnotationTerm(requirementLabel, term);
    };
    bindFocusedAnnotationTermAffixContextMenu(btn, term, buttonTitle);
    row.appendChild(btn);
    termEntries.push({
      term: term,
      row: row,
      isActive: hasTagForMediaKey(mediaKey, term),
      isMatched: btn.classList.contains('matched'),
      isSuggested: btn.classList.contains('suggested')
    });
  });
  renderTermFamilyEntries(els.termList, termEntries, {
    getText: function (entry) { return entry.term; },
    isBreakout: function (entry) { return entry.isActive; },
    getHint: function (entry) {
      if (entry.isSuggested) return { className: 'suggested', text: 'suggested' };
      if (entry.isMatched) return { className: 'matched', text: 'caption matches' };
      return null;
    },
    triggerClass: 'focused-annotation-term-btn',
    popoverClass: 'term-family-popover--focus',
    renderItem: function (entry) { return entry.row; }
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
      if (moveFocusedAnnotationToAvailableItem(1)) {
        return;
      }
      setStatus('Focused annotation queue no longer has any available items.');
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
  if (els.groupDeleteBtn) {
    els.groupDeleteBtn.disabled = !requirementLabel;
  }
  updateFocusedAnnotationGroupClipboardUi();
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
    renderFocusedAnnotationQuickPicks('', []);
    return;
  }
  renderFocusedAnnotationStatus(mediaItem.key, requirementLabel);
  var quickPickEntries = buildFocusedAnnotationQuickPickEntries(mediaItem.key, requirementLabel);
  renderFocusedAnnotationTerms(mediaItem.key, requirementLabel, quickPickEntries);
  renderFocusedAnnotationQuickPicks(requirementLabel, quickPickEntries);
}

function moveFocusedAnnotationByItem(delta) {
  var itemKeys = Array.isArray(focusedAnnotationState.itemKeys) ? focusedAnnotationState.itemKeys : [];
  var requirements = Array.isArray(checklistItems) ? checklistItems : [];
  if (!itemKeys.length || !requirements.length) return;
  var currentItemIndex = Math.max(0, Number(focusedAnnotationState.itemIndex) || 0);
  var currentGroupIndex = Math.max(0, Number(focusedAnnotationState.groupIndex) || 0);
  var nextItemIndex = currentItemIndex + (delta < 0 ? -1 : 1);
  if (nextItemIndex >= 0 && nextItemIndex < itemKeys.length) {
    navigateFocusedAnnotation(nextItemIndex, currentGroupIndex);
    return;
  }
  var nextGroupIndex = currentGroupIndex + (delta < 0 ? -1 : 1);
  if (nextGroupIndex < 0 || nextGroupIndex >= requirements.length) return;
  navigateFocusedAnnotation(delta < 0 ? itemKeys.length - 1 : 0, nextGroupIndex);
}

function moveFocusedAnnotationByGroup(delta) {
  var itemKeys = Array.isArray(focusedAnnotationState.itemKeys) ? focusedAnnotationState.itemKeys : [];
  var requirements = Array.isArray(checklistItems) ? checklistItems : [];
  if (!itemKeys.length || !requirements.length) return;
  var currentItemIndex = Math.max(0, Number(focusedAnnotationState.itemIndex) || 0);
  var currentGroupIndex = Math.max(0, Number(focusedAnnotationState.groupIndex) || 0);
  var nextGroupIndex = currentGroupIndex + (delta < 0 ? -1 : 1);
  if (nextGroupIndex >= 0 && nextGroupIndex < requirements.length) {
    navigateFocusedAnnotation(currentItemIndex, nextGroupIndex);
  }
}

function navigateFocusedAnnotation(itemIndex, groupIndex, options) {
  var opts = options || {};
  var itemKeys = Array.isArray(focusedAnnotationState.itemKeys) ? focusedAnnotationState.itemKeys : [];
  if (!itemKeys.length) return;
  var previousItemIndex = Math.max(0, Number(focusedAnnotationState.itemIndex) || 0);
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
    if (moveFocusedAnnotationToAvailableItem(nextItemIndex < previousItemIndex ? -1 : 1)) {
      return;
    }
    setStatus('Focused annotation queue no longer has any available items.');
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

function markFocusedAnnotationGroupDone() {
  if (!state.currentItem || !state.currentItem.key) return;
  var requirementLabel = getFocusedAnnotationCurrentRequirement();
  if (!requirementLabel) return;
  if (typeof setChecklistRequirementCheckedForMediaKey === 'function') {
    setChecklistRequirementCheckedForMediaKey(state.currentItem.key, requirementLabel, true);
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

function deleteFocusedAnnotationCurrentGroup() {
  var groupIndex = Math.max(0, Number(focusedAnnotationState.groupIndex) || 0);
  if (!deleteChecklistGroupByIndex(groupIndex)) return;
  focusedAnnotationState.groupIndex = Math.max(0, Math.min(checklistItems.length - 1, groupIndex));
  focusedAnnotationState.history = [];
  renderFocusedAnnotationModal();
}

function beginFocusedAnnotationRun(targetMediaKey) {
  var sequence = getFocusedAnnotationSequence();
  var items = Array.isArray(sequence.items) ? sequence.items.slice() : [];
  var targetKey = String(targetMediaKey || '').trim();
  items = items.filter(function (item) { return !!(item && item.key); });
  if (!items.length) {
    setStatus('No media available for focused annotation.');
    return;
  }
  var itemKeys = items.map(function (item) { return item.key; });
  focusedAnnotationState.itemKeys = itemKeys;
  var resumeStep = getFocusedAnnotationResumeStep(itemKeys, targetKey);
  if (!resumeStep) {
    setStatus('Everything in this focused scope is already reviewed.');
    return;
  }
  focusedAnnotationState.itemIndex = resumeStep.itemIndex;
  focusedAnnotationState.groupIndex = resumeStep.groupIndex;
  focusedAnnotationState.history = [];
  focusedAnnotationState.sourceLabel = String(sequence.sourceLabel || '');
  focusedAnnotationState.previousSurface = (typeof workspaceState !== 'undefined' && workspaceState && workspaceState.surface)
    ? String(workspaceState.surface)
    : 'default';
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
  beginFocusedAnnotationRun((state.currentItem && state.currentItem.key) || '');
}

function wireFocusedAnnotationModal() {
  var els = getFocusedAnnotationEls();
  if (!els.modal || els.modal.__wired) return;
  els.modal.__wired = true;
  if (els.closeBtn) {
    els.closeBtn.addEventListener('click', closeFocusedAnnotationModal);
  }
  if (els.itemPrevBtn) {
    els.itemPrevBtn.addEventListener('click', function () {
      flashFocusedAnnotationButton(els.itemPrevBtn);
      moveFocusedAnnotationByItem(-1);
    });
  }
  if (els.itemNextBtn) {
    els.itemNextBtn.addEventListener('click', function () {
      flashFocusedAnnotationButton(els.itemNextBtn);
      moveFocusedAnnotationByItem(1);
    });
  }
  if (els.groupPrevBtn) {
    els.groupPrevBtn.addEventListener('click', function () {
      flashFocusedAnnotationButton(els.groupPrevBtn);
      moveFocusedAnnotationByGroup(-1);
    });
  }
  if (els.groupNextBtn) {
    els.groupNextBtn.addEventListener('click', function () {
      flashFocusedAnnotationButton(els.groupNextBtn);
      moveFocusedAnnotationByGroup(1);
    });
  }
  if (els.editTermsBtn) {
    els.editTermsBtn.addEventListener('click', openFocusedAnnotationTermsEditor);
  }
  if (els.groupDeleteBtn) {
    els.groupDeleteBtn.addEventListener('click', deleteFocusedAnnotationCurrentGroup);
  }
  if (els.copyTagsBtn) {
    els.copyTagsBtn.addEventListener('click', function () {
      flashFocusedAnnotationButton(els.copyTagsBtn);
      copyFocusedAnnotationSelectedGroupTags();
    });
  }
  if (els.pasteTagsBtn) {
    els.pasteTagsBtn.addEventListener('click', function () {
      flashFocusedAnnotationButton(els.pasteTagsBtn);
      pasteFocusedAnnotationSelectedGroupTags();
    });
  }
  if (els.doneBtn) {
    els.doneBtn.addEventListener('click', function () {
      flashFocusedAnnotationButton(els.doneBtn);
      markFocusedAnnotationGroupDone();
    });
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
      flashFocusedAnnotationButton(els.doneBtn);
      markFocusedAnnotationGroupDone();
      return;
    }
    if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      skipFocusedAnnotationGroup();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      flashFocusedAnnotationButton(els.itemPrevBtn);
      moveFocusedAnnotationByItem(-1);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      flashFocusedAnnotationButton(els.itemNextBtn);
      moveFocusedAnnotationByItem(1);
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      flashFocusedAnnotationButton(els.groupPrevBtn);
      moveFocusedAnnotationByGroup(-1);
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      flashFocusedAnnotationButton(els.groupNextBtn);
      moveFocusedAnnotationByGroup(1);
    }
  });
}

wireFocusedAnnotationModal();

window.openFocusedAnnotationModal = openFocusedAnnotationModal;
window.openFocusedAnnotationForMediaItem = openFocusedAnnotationForMediaItem;
window.renderFocusedAnnotationModal = renderFocusedAnnotationModal;
