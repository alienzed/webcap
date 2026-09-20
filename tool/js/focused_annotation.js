var focusedAnnotationState = {
  open: false,
  itemKeys: [],
  itemIndex: 0,
  groupIndex: 0,
  itemKey: '',
  groupKey: '',
  actionRefreshTimerFast: 0,
  actionRefreshTimerSlow: 0
};
var focusedAnnotationTagClipboard = [];
var focusedAnnotationTagClipboardSource = '';

function getFocusedAnnotationEls() {
  return {
    normalGroupsCard: document.querySelector('.workbench-main-stack > .groups-card'),
    workbench: document.getElementById('focused-annotation-workbench'),
    itemNav: document.getElementById('focused-annotation-item-nav'),
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
  return typeof isApplicationOverlayOpen === 'function' && isApplicationOverlayOpen();
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

function getFocusedAnnotationVisibleItems() {
  var items = [];
  if (typeof getFilteredMediaItems === 'function') {
    items = getFilteredMediaItems(false);
  } else if (state && Array.isArray(state.items)) {
    items = state.items.slice();
  }
  items = (Array.isArray(items) ? items : []).filter(function (item) {
    return !!(item && item.key);
  });
  return items;
}

function getFocusedAnnotationNavigationScope() {
  var itemKeys = getFocusedAnnotationVisibleItems().map(function (item) { return item.key; });
  var groupKeys = Array.isArray(checklistItems) ? checklistItems.slice() : [];
  var reviewedByItem = {};
  itemKeys.forEach(function (itemKey) {
    reviewedByItem[itemKey] = {};
    groupKeys.forEach(function (groupKey) {
      reviewedByItem[itemKey][groupKey] = isChecklistRequirementCheckedForMediaKey(itemKey, groupKey);
    });
  });
  return { itemKeys: itemKeys, groupKeys: groupKeys, reviewedByItem: reviewedByItem };
}

function applyFocusedAnnotationNavigationResult(next) {
  if (!next || next.outcome !== 'active') return next;
  focusedAnnotationState.itemIndex = next.itemIndex;
  focusedAnnotationState.groupIndex = next.groupIndex;
  focusedAnnotationState.itemKey = next.itemKey;
  focusedAnnotationState.groupKey = next.groupKey;
  focusedAnnotationState.itemKeys = getFocusedAnnotationNavigationScope().itemKeys;
  return next;
}

function getFocusedAnnotationCurrentRequirement() {
  return String(focusedAnnotationState.groupKey || '').trim();
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

function stopFocusedAnnotation() {
  var els = getFocusedAnnotationEls();
  if (els.normalGroupsCard) els.normalGroupsCard.classList.remove('hidden');
  if (els.workbench) els.workbench.classList.add('hidden');
  if (els.itemNav) els.itemNav.classList.add('hidden');
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
  focusedAnnotationState.itemKey = '';
  focusedAnnotationState.groupKey = '';
  exitWorkspaceSurface();
  renderPreviewHeaderMeta();
}

function showFocusedAnnotationSurface() {
  var requirements = Array.isArray(checklistItems) ? checklistItems : [];
  var requirementLabel = getFocusedAnnotationCurrentRequirement();
  var itemKey = String(focusedAnnotationState.itemKey || '').trim();
  if (!itemKey || !requirementLabel || requirements.indexOf(requirementLabel) < 0) {
    setStatus('Focused annotation could not open because no annotation group is selected.');
    return false;
  }
  var els = getFocusedAnnotationEls();
  if (els.normalGroupsCard) els.normalGroupsCard.classList.add('hidden');
  if (els.workbench) els.workbench.classList.remove('hidden');
  if (els.itemNav) els.itemNav.classList.remove('hidden');
  focusedAnnotationState.open = true;
  setWorkspaceSurface('focus', { sidebarHidden: true });
  setWorkspaceWorkflowMode('annotate');
  renderPreviewHeaderMeta();
  return true;
}

function syncFocusedAnnotationQueue(options) {
  var opts = options || {};
  var scope = getFocusedAnnotationNavigationScope();
  var cursor = {
    itemIndex: focusedAnnotationState.itemIndex,
    groupIndex: focusedAnnotationState.groupIndex,
    itemKey: String(opts.anchorMediaKey || focusedAnnotationState.itemKey || '').trim(),
    groupKey: focusedAnnotationState.groupKey
  };
  var next = FocusedAnnotationNavigation.reconcile(scope, cursor);
  if (next.outcome === 'unavailable') {
    stopFocusedAnnotation();
    setStatus('No items remain in the focused annotation filter.');
    return { open: false, retained: false, advanced: false };
  }
  if (next.outcome !== 'active') {
    stopFocusedAnnotation();
    setStatus(next.outcome === 'scope-complete' ? 'Focused annotation complete.' : 'Focused annotation pass complete.');
    return { open: false, retained: false, advanced: false };
  }
  var retained = next.itemKey === cursor.itemKey && next.groupKey === cursor.groupKey;
  applyFocusedAnnotationNavigationResult(next);
  if (retained) {
    if (opts.renderRetained !== false) renderFocusedAnnotationSurface();
    return { open: true, retained: true, advanced: false };
  }
  navigateFocusedAnnotation(next);
  return { open: true, retained: false, advanced: true };
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
    renderFocusedAnnotationSurface();
  }, 80);
  focusedAnnotationState.actionRefreshTimerSlow = setTimeout(function () {
    focusedAnnotationState.actionRefreshTimerSlow = 0;
    if (!focusedAnnotationState.open) return;
    renderFocusedAnnotationSurface();
  }, 900);
}

function runFocusedAnnotationSingleItemShortcut(actionKey) {
  var mediaItem = state.currentItem;
  if (!mediaItem || !mediaItem.fileName) return false;
  if (/^[0-5]$/.test(actionKey)) {
    var rating = Number(actionKey);
    setRatingForMediaKey(mediaItem.key, rating);
    setStatus(rating > 0 ? 'Rating set: ' + rating + ' stars' : 'Rating cleared');
    return true;
  }

  var actionLabel = '';
  if (actionKey === 'c' && isCroppableImageFile(mediaItem.fileName)) actionLabel = 'Crop...';
  if (actionKey === 'd') actionLabel = 'Deface';
  if (actionKey === 'r') actionLabel = 'Reset';
  if (!actionLabel) return false;

  runPreviewActionByLabel(actionLabel);
  return true;
}

function decorateFocusedAnnotationPreviewActions(actions, mediaItem) {
  return (Array.isArray(actions) ? actions : []).filter(function (action) {
    return !action || action.separator || String(action.label || '') !== 'Focused Annotate...';
  }).map(function (action) {
    if (!action || action.separator) return action;
    var mappedRender;
    if (typeof action.render === 'function') {
      mappedRender = function flagRowRenderer(value) {
        action.render(value);
        syncFocusedAnnotationQueue({ anchorMediaKey: mediaItem.key });
      };
    }
    return {
      label: action.label,
      render: mappedRender,
      run: function () {
        var operation = action.label === 'Prune'
          ? action.run({ selectReplacement: false })
          : action.run();
        if (action.label === 'Prune') {
          if (!operation || typeof operation.then !== 'function') {
            throw new Error('Prune action must return its completion promise.');
          }
          operation.then(function (succeeded) {
            if (succeeded && isFocusedAnnotationOpen()) syncFocusedAnnotationQueue({ anchorMediaKey: mediaItem.key });
          });
          return operation;
        }
        if (action.label === 'Paste Tags' && operation) {
          syncFocusedAnnotationQueue({ anchorMediaKey: mediaItem.key });
          return operation;
        }
        scheduleFocusedAnnotationActionRefresh();
        return operation;
      }
    };
  });
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
  return getChecklistAssignedTagsForMediaKey(mediaKey, requirementLabel);
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
  var added = 0;
  focusedAnnotationTagClipboard.forEach(function (term) {
    if (hasChecklistAssignedTagForMediaKey(mediaKey, requirementLabel, term)) return;
    if (assignChecklistTagToMediaKey(mediaKey, requirementLabel, term, {
      skipSave: true,
      skipRefresh: true,
      skipUndo: true
    })) added += 1;
  });
  if (!added) {
    showFocusedAnnotationGroupClipboardNotice('All copied tags are already selected.', 'focused-annotation-badge-reviewed');
    setStatus('All copied tags are already selected.');
    return false;
  }
  saveChecklistToFolderState();
  refreshTagDrivenPanelsForMediaKey(mediaKey);
  var syncResult = syncFocusedAnnotationQueue({ anchorMediaKey: mediaKey });
  if (syncResult.retained) {
    showFocusedAnnotationGroupClipboardNotice(
      'Selected ' + added + ' copied tag' + (added === 1 ? '' : 's') + '.',
      'focused-annotation-badge-reviewed'
    );
  }
  setStatus('Selected ' + added + ' copied tag' + (added === 1 ? '' : 's') + '.');
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
    if (hasChecklistAssignedTagForMediaKey(mediaKey, requirementLabel, term)) {
      addEntry(term, 'Selected', 100, 'active');
    }
    if (checklistGroupTermAppearsInCurrentCaption(requirementLabel, term, mediaKey)) {
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
  return buildGroupTagUsageEntries(requirementLabel, 6);
}

function appendFocusedAnnotationQuickPickRow(list, requirementLabel, term, metaText, classes) {
  var row = document.createElement('div');
  row.className = 'focused-annotation-quick-pick-row';
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn focused-annotation-quick-pick-btn';
  (classes || []).forEach(function (className) { btn.classList.add(className); });
  btn.textContent = term;
  var isActive = hasChecklistAssignedTagForMediaKey(state.currentItem.key, requirementLabel, term);
  var buttonTitle = (isActive ? 'Remove "' : 'Add "') + term + '" on the current item';
  btn.title = buttonTitle;
  btn.onclick = function () {
    toggleFocusedAnnotationTerm(requirementLabel, term);
  };
  bindFocusedAnnotationTermAffixContextMenu(btn, requirementLabel, term, buttonTitle);
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
        hasChecklistAssignedTagForMediaKey(state.currentItem.key, requirementLabel, entry.term) ? ['active'] : []
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

  var unscoped = getUnscopedTagsForMediaKey(state.currentItem.key);
  var assignments = getChecklistAssignmentEntriesForMediaKey(state.currentItem.key);
  if (!unscoped.length && !assignments.length) {
    var empty = document.createElement('div');
    empty.className = 'focused-annotation-current-tags-empty';
    empty.textContent = 'No tags on this item yet.';
    section.appendChild(empty);
    parentEl.appendChild(section);
    return;
  }

  var list = document.createElement('div');
  list.className = 'focused-annotation-current-tag-list';
  assignments.forEach(function (entry) {
    var chip = document.createElement('span');
    chip.className = 'focused-annotation-current-tag';
    chip.textContent = entry.term + ' · ' + entry.requirement;
    bindFocusedAnnotationTermAffixContextMenu(
      chip,
      entry.requirement,
      entry.term,
      'Current ' + entry.requirement + ' tag "' + entry.term + '"'
    );
    list.appendChild(chip);
  });
  unscoped.forEach(function (tag) {
    var chip = document.createElement('span');
    chip.className = 'focused-annotation-current-tag';
    chip.textContent = tag + ' · unscoped';
    chip.title = 'Unscoped tag "' + tag + '"';
    list.appendChild(chip);
  });
  section.appendChild(list);
  parentEl.appendChild(section);
}

function toggleFocusedAnnotationTerm(requirementLabel, termText) {
  if (!state.currentItem || !state.currentItem.key) return;
  var mediaKey = state.currentItem.key;
  var requirement = normalizeChecklistRequirementKey(requirementLabel);
  var term = normalizeChecklistTerm(termText);
  if (!requirement || !term) return;
  var changed = hasChecklistAssignedTagForMediaKey(mediaKey, requirement, term)
    ? unassignChecklistTagFromMediaKey(mediaKey, requirement, term)
    : assignChecklistTagToMediaKey(mediaKey, requirement, term);
  if (changed) syncFocusedAnnotationQueue({ anchorMediaKey: mediaKey });
}

function bindFocusedAnnotationTermAffixContextMenu(targetEl, requirementLabel, termText, titlePrefix) {
  if (!targetEl) return;
  var requirement = normalizeChecklistRequirementKey(requirementLabel);
  var term = normalizeChecklistTerm(termText);
  if (!requirement || !term) return;
  var baseTitle = String(titlePrefix || '').trim();
  targetEl.title = (baseTitle ? (baseTitle + ' - ') : '') + 'Right-click to edit prefix/suffix';
  targetEl.addEventListener('contextmenu', function (event) {
    event.preventDefault();
    event.stopPropagation();
    openChecklistTermAffixesModal(requirement, term);
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
    if (hasChecklistAssignedTagForMediaKey(mediaKey, requirementLabel, term)) btn.classList.add('active');
    if (checklistGroupTermAppearsInCurrentCaption(requirementLabel, term, mediaKey)) {
      btn.classList.add('matched');
    }
    var quickPickEntry = quickPickLookup[normalizeChecklistTerm(term).toLowerCase()];
    if (quickPickEntry && quickPickEntry.kinds && quickPickEntry.kinds.suggested) {
      btn.classList.add('suggested');
    }
    btn.textContent = term;
    var buttonTitle = hasChecklistAssignedTagForMediaKey(mediaKey, requirementLabel, term)
      ? ('Remove "' + term + '" from ' + requirementLabel)
      : ('Add "' + term + '" to ' + requirementLabel);
    btn.title = buttonTitle;
    btn.onclick = function () {
      toggleFocusedAnnotationTerm(requirementLabel, term);
    };
    bindFocusedAnnotationTermAffixContextMenu(btn, requirementLabel, term, buttonTitle);
    row.appendChild(btn);
    termEntries.push({
      term: term,
      row: row,
      isActive: hasChecklistAssignedTagForMediaKey(mediaKey, requirementLabel, term),
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

function renderFocusedAnnotationSurface() {
  if (!focusedAnnotationState.open) return;
  var els = getFocusedAnnotationEls();
  var itemKeys = Array.isArray(focusedAnnotationState.itemKeys) ? focusedAnnotationState.itemKeys : [];
  var requirements = Array.isArray(checklistItems) ? checklistItems : [];
  if (!els.workbench || !itemKeys.length) {
    stopFocusedAnnotation();
    return;
  }
  var targetItemKey = focusedAnnotationState.itemKey || itemKeys[Math.max(0, Math.min(itemKeys.length - 1, focusedAnnotationState.itemIndex))];
  if (!targetItemKey) {
    stopFocusedAnnotation();
    return;
  }
  if (!state.currentItem || state.currentItem.key !== targetItemKey) {
    var targetItem = findFocusedAnnotationMediaItemByKey(targetItemKey);
    if (!targetItem) {
      setStatus('Focused annotation queue is out of sync with the visible media list.');
      stopFocusedAnnotation();
      return;
    }
    selectPathMedia(targetItem).then(function () {
      renderFocusedAnnotationSurface();
    }).catch(function (err) {
      setStatus(String(err && err.message ? err.message : err));
      stopFocusedAnnotation();
    });
    return;
  }
  var mediaItem = state.currentItem;
  var groupIndex = requirements.indexOf(focusedAnnotationState.groupKey);
  if (groupIndex < 0) groupIndex = Math.max(0, Math.min(Math.max(0, requirements.length - 1), Number(focusedAnnotationState.groupIndex) || 0));
  focusedAnnotationState.groupIndex = groupIndex;
  var requirementLabel = requirements.length ? String(requirements[groupIndex] || '') : '';
  focusedAnnotationState.groupKey = requirementLabel;
  if (els.itemProgress) {
    els.itemProgress.textContent = 'Item ' + (focusedAnnotationState.itemIndex + 1) + ' / ' + itemKeys.length;
  }
  if (els.groupProgress) {
    els.groupProgress.textContent = requirements.length
      ? ('Group ' + (groupIndex + 1) + ' / ' + requirements.length)
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
  var next = FocusedAnnotationNavigation.moveItem(getFocusedAnnotationNavigationScope(), focusedAnnotationState, delta);
  if (next.outcome === 'active') navigateFocusedAnnotation(next);
}

function moveFocusedAnnotationByGroup(delta) {
  var next = FocusedAnnotationNavigation.moveGroup(getFocusedAnnotationNavigationScope(), focusedAnnotationState, delta);
  if (next.outcome === 'active') navigateFocusedAnnotation(next);
}

function navigateFocusedAnnotation(next) {
  if (!next || next.outcome !== 'active') return;
  applyFocusedAnnotationNavigationResult(next);
  var targetItem = findFocusedAnnotationMediaItemByKey(next.itemKey);
  if (!targetItem) {
    setStatus('Focused annotation queue is out of sync with the visible media list.');
    stopFocusedAnnotation();
    return;
  }
  if (state.currentItem && state.currentItem.key === targetItem.key) {
    renderFocusedAnnotationSurface();
    return;
  }
  selectPathMedia(targetItem).then(function () {
    renderFocusedAnnotationSurface();
  }).catch(function (err) {
    setStatus(String(err && err.message ? err.message : err));
    stopFocusedAnnotation();
  });
}

function advanceFocusedAnnotationStep() {
  var next = FocusedAnnotationNavigation.advance(getFocusedAnnotationNavigationScope(), focusedAnnotationState);
  if (next.outcome === 'active') {
    navigateFocusedAnnotation(next);
    return;
  }
  stopFocusedAnnotation();
  setStatus(next.outcome === 'scope-complete' ? 'Focused annotation complete.' : 'Focused annotation pass complete.');
}

function markFocusedAnnotationGroupDone() {
  if (!state.currentItem || !state.currentItem.key) return;
  var mediaKey = state.currentItem.key;
  var requirementLabel = getFocusedAnnotationCurrentRequirement();
  if (!requirementLabel) return;
  if (typeof setChecklistRequirementCheckedForMediaKey === 'function') {
    setChecklistRequirementCheckedForMediaKey(mediaKey, requirementLabel, true);
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
  var mediaKey = state.currentItem && state.currentItem.key;
  var groupIndex = checklistItems.indexOf(getFocusedAnnotationCurrentRequirement());
  if (groupIndex < 0) return;
  if (!deleteChecklistGroupByIndex(groupIndex)) return;
  focusedAnnotationState.groupIndex = Math.max(0, Math.min(checklistItems.length - 1, groupIndex));
  syncFocusedAnnotationQueue({ anchorMediaKey: mediaKey });
}

function startFocusedAnnotation(targetMediaKey) {
  var next = FocusedAnnotationNavigation.start(getFocusedAnnotationNavigationScope(), targetMediaKey);
  if (next.outcome !== 'active') {
    setStatus(next.outcome === 'scope-complete' ? 'Everything in this focused scope is already reviewed.' : 'No media or annotation groups are available for focused annotation.');
    return;
  }
  applyFocusedAnnotationNavigationResult(next);
  if (!showFocusedAnnotationSurface()) return;
  navigateFocusedAnnotation(next);
}

function startFocusedAnnotationForMediaItem(mediaItem) {
  if (!mediaItem || !mediaItem.key) {
    setStatus('Select a media item to annotate.');
    return;
  }
  var run = function () {
    startFocusedAnnotation(mediaItem.key);
  };
  if (state.currentItem && state.currentItem.key === mediaItem.key) {
    run();
    return;
  }
  selectPathMedia(mediaItem).then(run).catch(function (err) {
    setStatus(String(err && err.message ? err.message : err));
  });
}

function wireFocusedAnnotationSurface() {
  var els = getFocusedAnnotationEls();
  if (!els.workbench || els.workbench.__wired) return;
  els.workbench.__wired = true;
  if (els.closeBtn) {
    els.closeBtn.addEventListener('click', stopFocusedAnnotation);
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
  window.addEventListener('webcap:media-metadata-updated', function (event) {
    var detail = event && event.detail ? event.detail : {};
    if (!focusedAnnotationState.open || detail.folder !== state.folder) return;
    syncFocusedAnnotationQueue({
      anchorMediaKey: state.currentItem && state.currentItem.key
    });
  });
  document.addEventListener('keydown', function (e) {
    handleFocusedAnnotationKeydown(e);
  });
}

function handleFocusedAnnotationKeydown(e) {
  if (!isFocusedAnnotationOpen() || isFocusedAnnotationNestedModalOpen()) return false;
  if (typeof isEditableElement === 'function' && isEditableElement(document.activeElement)) return false;
  if (e.key === 'Escape') {
    e.preventDefault();
    stopFocusedAnnotation();
    return true;
  }
  if (!e.repeat && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    var actionKey = String(e.key || '').toLowerCase();
    if (runFocusedAnnotationSingleItemShortcut(actionKey)) {
      e.preventDefault();
      return true;
    }
  }
  var els = getFocusedAnnotationEls();
  if (e.key === 'Enter') {
    e.preventDefault();
    flashFocusedAnnotationButton(els.doneBtn);
    markFocusedAnnotationGroupDone();
    return true;
  }
  if (e.key === 's' || e.key === 'S') {
    e.preventDefault();
    skipFocusedAnnotationGroup();
    return true;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    flashFocusedAnnotationButton(els.itemPrevBtn);
    moveFocusedAnnotationByItem(-1);
    return true;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    flashFocusedAnnotationButton(els.itemNextBtn);
    moveFocusedAnnotationByItem(1);
    return true;
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    flashFocusedAnnotationButton(els.groupPrevBtn);
    moveFocusedAnnotationByGroup(-1);
    return true;
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    flashFocusedAnnotationButton(els.groupNextBtn);
    moveFocusedAnnotationByGroup(1);
    return true;
  }
  return false;
}

wireFocusedAnnotationSurface();

window.startFocusedAnnotation = startFocusedAnnotation;
window.startFocusedAnnotationForMediaItem = startFocusedAnnotationForMediaItem;
window.renderFocusedAnnotationSurface = renderFocusedAnnotationSurface;
