var focusedAnnotationState = {
  open: false,
  itemKeys: [],
  itemIndex: 0,
  groupIndex: 0,
  traversalMode: 'group-first',
  history: [],
  sourceLabel: ''
};

function getFocusedAnnotationEls() {
  return {
    modal: document.getElementById('focused-annotation-modal'),
    previewMedia: document.getElementById('focused-annotation-preview-media'),
    itemProgress: document.getElementById('focused-annotation-item-progress'),
    itemPrevBtn: document.getElementById('focused-annotation-item-prev-btn'),
    itemNextBtn: document.getElementById('focused-annotation-item-next-btn'),
    modeGroupBtn: document.getElementById('focused-annotation-mode-group-btn'),
    modeItemBtn: document.getElementById('focused-annotation-mode-item-btn'),
    groupProgress: document.getElementById('focused-annotation-group-progress'),
    groupPrevBtn: document.getElementById('focused-annotation-group-prev-btn'),
    groupNextBtn: document.getElementById('focused-annotation-group-next-btn'),
    groupName: document.getElementById('focused-annotation-group-name'),
    groupStatus: document.getElementById('focused-annotation-group-status'),
    termList: document.getElementById('focused-annotation-term-list'),
    quickPicks: document.getElementById('focused-annotation-quick-picks'),
    rating: document.getElementById('focused-annotation-rating'),
    editTermsBtn: document.getElementById('focused-annotation-edit-terms-btn'),
    closeBtn: document.getElementById('focused-annotation-close-btn'),
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

function getFocusedAnnotationTraversalMode() {
  return focusedAnnotationState.traversalMode === 'item-first' ? 'item-first' : 'group-first';
}

function setFocusedAnnotationTraversalMode(mode, options) {
  var nextMode = String(mode || '').trim().toLowerCase() === 'item-first' ? 'item-first' : 'group-first';
  var opts = options || {};
  focusedAnnotationState.traversalMode = nextMode;
  if (!opts.skipRender) {
    renderFocusedAnnotationModal();
  }
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
  var requirements = Array.isArray(checklistItems) ? checklistItems : [];
  var steps = [];
  if (!itemKeys.length || !requirements.length) return steps;
  var mode = getFocusedAnnotationTraversalMode();
  if (mode === 'item-first') {
    for (var itemIndex = 0; itemIndex < itemKeys.length; itemIndex++) {
      for (var groupIndex = 0; groupIndex < requirements.length; groupIndex++) {
        steps.push({ itemIndex: itemIndex, groupIndex: groupIndex });
      }
    }
    return steps;
  }
  for (var nextGroupIndex = 0; nextGroupIndex < requirements.length; nextGroupIndex++) {
    for (var nextItemIndex = 0; nextItemIndex < itemKeys.length; nextItemIndex++) {
      steps.push({ itemIndex: nextItemIndex, groupIndex: nextGroupIndex });
    }
  }
  return steps;
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

function getFocusedAnnotationTraversalStepsForKeys(itemKeys, traversalMode) {
  var keys = Array.isArray(itemKeys) ? itemKeys : [];
  var requirements = Array.isArray(checklistItems) ? checklistItems : [];
  var steps = [];
  if (!keys.length || !requirements.length) return steps;
  var mode = String(traversalMode || getFocusedAnnotationTraversalMode()).trim().toLowerCase() === 'item-first'
    ? 'item-first'
    : 'group-first';
  if (mode === 'item-first') {
    for (var itemIndex = 0; itemIndex < keys.length; itemIndex++) {
      for (var groupIndex = 0; groupIndex < requirements.length; groupIndex++) {
        steps.push({ itemIndex: itemIndex, groupIndex: groupIndex });
      }
    }
    return steps;
  }
  for (var nextGroupIndex = 0; nextGroupIndex < requirements.length; nextGroupIndex++) {
    for (var nextItemIndex = 0; nextItemIndex < keys.length; nextItemIndex++) {
      steps.push({ itemIndex: nextItemIndex, groupIndex: nextGroupIndex });
    }
  }
  return steps;
}

function isFocusedAnnotationStepComplete(mediaKey, requirementLabel) {
  return (typeof isChecklistRequirementCheckedForMediaKey === 'function' &&
    isChecklistRequirementCheckedForMediaKey(mediaKey, requirementLabel)) ||
    (typeof isChecklistRequirementNaForMediaKey === 'function' &&
    isChecklistRequirementNaForMediaKey(mediaKey, requirementLabel));
}

function getFocusedAnnotationResumeStep(itemKeys, preferredMediaKey) {
  var keys = Array.isArray(itemKeys) ? itemKeys : [];
  var requirements = Array.isArray(checklistItems) ? checklistItems : [];
  if (!keys.length || !requirements.length) return null;

  var steps = getFocusedAnnotationTraversalStepsForKeys(keys, getFocusedAnnotationTraversalMode());
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
    renderFocusedAnnotationRating('');
    return;
  }
  if (els.previewMedia.getAttribute('data-media-key') === mediaKey && els.previewMedia.firstChild) {
    renderFocusedAnnotationRating(mediaKey);
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
    return;
  }
  var img = document.createElement('img');
  img.src = url;
  img.alt = mediaItem.fileName;
  img.className = 'focused-annotation-preview-image';
  els.previewMedia.appendChild(img);
  renderFocusedAnnotationRating(mediaKey);
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
        setRatingForMediaKey(mediaKey, value);
        renderFocusedAnnotationRating(mediaKey);
      };
      els.rating.appendChild(btn);
    })(s);
  }
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
  if (!entriesList.length) {
    var empty = document.createElement('div');
    empty.className = 'focused-annotation-quick-picks-empty';
    empty.textContent = 'No strong quick picks for this group yet.';
    picksEl.appendChild(empty);
    renderFocusedAnnotationCurrentTags(picksEl);
    return;
  }
  var list = document.createElement('div');
  list.className = 'focused-annotation-quick-pick-list';
  entriesList.forEach(function (entry) {
    var row = document.createElement('div');
    row.className = 'focused-annotation-quick-pick-row';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn focused-annotation-quick-pick-btn';
    if (entry.kinds.active) btn.classList.add('active');
    if (entry.kinds.matched) btn.classList.add('matched');
    if (entry.kinds.suggested) btn.classList.add('suggested');
    btn.textContent = entry.term;
    btn.title = (entry.kinds.active ? 'Remove "' : 'Add "') + entry.term + '" on the current item';
    btn.onclick = function () {
      toggleFocusedAnnotationTerm(requirementLabel, entry.term);
    };
    row.appendChild(btn);
    if (entry.reasons.length) {
      var meta = document.createElement('div');
      meta.className = 'focused-annotation-quick-pick-meta';
      meta.textContent = entry.reasons.join(' | ');
      row.appendChild(meta);
    }
    list.appendChild(row);
  });
  picksEl.appendChild(list);
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
    btn.title = hasTagForMediaKey(mediaKey, term)
      ? ('Remove "' + term + '" from the current item')
      : ('Add "' + term + '" to the current item');
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
  if (els.modeGroupBtn) {
    var isGroupFirst = getFocusedAnnotationTraversalMode() === 'group-first';
    els.modeGroupBtn.classList.toggle('active', isGroupFirst);
    els.modeGroupBtn.setAttribute('aria-pressed', isGroupFirst ? 'true' : 'false');
  }
  if (els.modeItemBtn) {
    var isItemFirst = getFocusedAnnotationTraversalMode() === 'item-first';
    els.modeItemBtn.classList.toggle('active', isItemFirst);
    els.modeItemBtn.setAttribute('aria-pressed', isItemFirst ? 'true' : 'false');
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
  if (getFocusedAnnotationTraversalMode() !== 'group-first') return;
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
    return;
  }
  if (getFocusedAnnotationTraversalMode() !== 'item-first') return;
  var nextItemIndex = currentItemIndex + (delta < 0 ? -1 : 1);
  if (nextItemIndex < 0 || nextItemIndex >= itemKeys.length) return;
  navigateFocusedAnnotation(nextItemIndex, delta < 0 ? requirements.length - 1 : 0);
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
  var previousPending = getFocusedAnnotationPreviousPendingStep(
    focusedAnnotationState.itemIndex,
    focusedAnnotationState.groupIndex
  );
  if (previousPending) {
    navigateFocusedAnnotation(previousPending.itemIndex, previousPending.groupIndex);
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
  if (els.modeGroupBtn) {
    els.modeGroupBtn.addEventListener('click', function () {
      setFocusedAnnotationTraversalMode('group-first');
    });
  }
  if (els.modeItemBtn) {
    els.modeItemBtn.addEventListener('click', function () {
      setFocusedAnnotationTraversalMode('item-first');
    });
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
  if (els.naBtn) {
    els.naBtn.addEventListener('click', function () {
      flashFocusedAnnotationButton(els.naBtn);
      markFocusedAnnotationGroupNa();
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
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      flashFocusedAnnotationButton(els.naBtn);
      markFocusedAnnotationGroupNa();
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
