function resolveGroupWorkbenchOptions(options) {
  var opts = options || {};
  var mode = opts.mode || 'item';
  var currentMediaKey = String(opts.currentMediaKey || '').trim();
  if (!currentMediaKey && mode === 'item' && state && state.currentItem && state.currentItem.key) {
    currentMediaKey = state.currentItem.key;
  }
  function collectMediaKeys(source) {
    var seen = {};
    var keys = [];
    (Array.isArray(source) ? source : []).forEach(function (rawKey) {
      var key = String(rawKey || '').trim();
      if (!key || seen[key]) return;
      seen[key] = true;
      keys.push(key);
    });
    return keys;
  }
  var sourceMediaKeys = typeof opts.getMediaKeys === 'function'
    ? opts.getMediaKeys()
    : (typeof opts.mediaKeys === 'function' ? opts.mediaKeys() : opts.mediaKeys);
  var mediaKeys = collectMediaKeys(sourceMediaKeys);
  var sourceContextMediaKeys = typeof opts.getContextMediaKeys === 'function'
    ? opts.getContextMediaKeys()
    : (typeof opts.contextMediaKeys === 'function' ? opts.contextMediaKeys() : opts.contextMediaKeys);
  var contextMediaKeys = collectMediaKeys(sourceContextMediaKeys);
  if (mode === 'item') {
    mediaKeys = currentMediaKey ? [currentMediaKey] : [];
    contextMediaKeys = mediaKeys.slice();
  } else if (!contextMediaKeys.length) {
    contextMediaKeys = mediaKeys.slice();
  }
  return {
    mode: mode,
    targetEl: opts.targetEl || document.getElementById('group-workbench-list'),
    mediaKeys: mediaKeys,
    getMediaKeys: function () {
      var freshSource = typeof opts.getMediaKeys === 'function'
        ? opts.getMediaKeys()
        : (typeof opts.mediaKeys === 'function' ? opts.mediaKeys() : mediaKeys);
      var freshKeys = collectMediaKeys(freshSource);
      return mode === 'item'
        ? (currentMediaKey ? [currentMediaKey] : [])
        : freshKeys;
    },
    contextMediaKeys: contextMediaKeys,
    getContextMediaKeys: function () {
      var freshSource = typeof opts.getContextMediaKeys === 'function'
        ? opts.getContextMediaKeys()
        : (typeof opts.contextMediaKeys === 'function' ? opts.contextMediaKeys() : contextMediaKeys);
      var freshKeys = collectMediaKeys(freshSource);
      if (mode === 'item') return currentMediaKey ? [currentMediaKey] : [];
      return freshKeys.length ? freshKeys : mediaKeys.slice();
    },
    currentMediaKey: currentMediaKey,
    onAfterMutation: opts.onAfterMutation
  };
}

function renderGroupWorkbenchEmpty(targetEl, message) {
  targetEl.innerHTML = '';
  if (targetEl._groupWorkbenchTermScaleFrame) {
    window.cancelAnimationFrame(targetEl._groupWorkbenchTermScaleFrame);
    targetEl._groupWorkbenchTermScaleFrame = 0;
  }
  targetEl.classList.remove('group-workbench-list--roomy-terms');
  targetEl._groupWorkbenchGroupCount = 0;
  targetEl._groupWorkbenchLayoutColumnCount = 1;
  targetEl.setAttribute('data-columns', '1');
  var emptyEl = document.createElement('div');
  emptyEl.className = 'group-workbench-empty';
  emptyEl.textContent = message;
  targetEl.appendChild(emptyEl);
}

function groupWorkbenchCanUseRoomyTerms(targetEl, mode) {
  return mode === 'item'
    && targetEl && targetEl.id === 'group-workbench-list'
    && (!workspaceState || workspaceState.surface === 'default');
}

function syncGroupWorkbenchTermScale(targetEl, mode) {
  if (!targetEl) return;
  if (targetEl._groupWorkbenchTermScaleFrame) {
    window.cancelAnimationFrame(targetEl._groupWorkbenchTermScaleFrame);
  }
  targetEl._groupWorkbenchTermScaleMode = mode;
  if (!groupWorkbenchCanUseRoomyTerms(targetEl, mode)) {
    targetEl.classList.remove('group-workbench-list--roomy-terms');
    return;
  }

  targetEl.classList.remove('group-workbench-list--roomy-terms');
  targetEl._groupWorkbenchTermScaleFrame = window.requestAnimationFrame(function () {
    targetEl._groupWorkbenchTermScaleFrame = 0;
    if (!groupWorkbenchCanUseRoomyTerms(targetEl, targetEl._groupWorkbenchTermScaleMode)) return;
    if (targetEl.scrollHeight > targetEl.clientHeight + 1) return;
    targetEl.classList.add('group-workbench-list--roomy-terms');
    targetEl._groupWorkbenchTermScaleFrame = window.requestAnimationFrame(function () {
      targetEl._groupWorkbenchTermScaleFrame = 0;
      if (targetEl.scrollHeight > targetEl.clientHeight + 1) {
        targetEl.classList.remove('group-workbench-list--roomy-terms');
      }
    });
  });
}

function appendGroupWorkbenchNotice(targetEl, message) {
  if (!message) return;
  var noticeEl = document.createElement('div');
  noticeEl.className = 'group-workbench-notice';
  noticeEl.textContent = message;
  targetEl.appendChild(noticeEl);
}

function createGroupWorkbenchActionButton(className, text, title, ariaLabel) {
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'group-workbench-action-btn ' + className;
  btn.textContent = text;
  btn.title = title;
  btn.setAttribute('aria-label', ariaLabel || title);
  return btn;
}

function bindGroupWorkbenchHeaderButton(btn, handler) {
  if (!btn || typeof handler !== 'function') return;
  btn.onclick = function (event) {
    event.preventDefault();
    event.stopPropagation();
    handler();
  };
}

function refreshGroupWorkbenchForCurrentItem() {
  if (!state || !state.currentItem || !state.currentItem.key) {
    renderGroupWorkbench({ mode: 'item' });
    return;
  }
  renderGroupWorkbench({
    mode: 'item',
    targetEl: document.getElementById('group-workbench-list') || document.getElementById('checklist-items'),
    mediaKeys: [state.currentItem.key],
    currentMediaKey: state.currentItem.key
  });
}

function getDistinctGroupWorkbenchMediaKeys(mediaKeys) {
  var seen = {};
  var keys = [];
  (Array.isArray(mediaKeys) ? mediaKeys : []).forEach(function (rawKey) {
    var key = String(rawKey || '').trim();
    if (!key || seen[key]) return;
    seen[key] = true;
    keys.push(key);
  });
  return keys;
}

function getChecklistRequirementBatchState(mediaKeys, requirementLabel) {
  var keys = getDistinctGroupWorkbenchMediaKeys(mediaKeys);
  var reviewedCount = 0;
  keys.forEach(function (key) {
    if (isChecklistRequirementCheckedForMediaKey(key, requirementLabel)) reviewedCount += 1;
  });
  return {
    keys: keys,
    total: keys.length,
    reviewedCount: reviewedCount,
    allReviewed: keys.length > 0 && reviewedCount === keys.length,
    someReviewed: reviewedCount > 0
  };
}

function finalizeChecklistBatchMutation(keys, requirementLabel, mutationLabel, changedCount, options) {
  var opts = options || {};
  keys.forEach(function (key) {
    syncReviewedFromChecklist(key);
  });
  saveChecklistToFolderState();
  renderChecklistPanel();
  renderItemMetadataPanel();
  renderAnnotateStrip();
  renderFileList(ui && ui.filterEl ? ui.filterEl.value : '');
  if (typeof setStatus === 'function' && mutationLabel) {
    setStatus(mutationLabel + ' "' + requirementLabel + '" on ' + changedCount + ' Grid item' + (changedCount === 1 ? '' : 's') + '.');
  }
  if (typeof opts.onAfterMutation === 'function') {
    opts.onAfterMutation();
    return;
  }
  renderGroupWorkbench({
    mode: 'grid',
    targetEl: opts.targetEl,
    mediaKeys: keys,
    contextMediaKeys: opts.contextMediaKeys,
    getContextMediaKeys: opts.getContextMediaKeys,
    onAfterMutation: opts.onAfterMutation
  });
}

function setChecklistRequirementCheckedForMediaKeys(mediaKeys, requirementLabel, isChecked, options) {
  var opts = options || {};
  var keys = getDistinctGroupWorkbenchMediaKeys(mediaKeys);
  if (!keys.length) {
    if (typeof setStatus === 'function') setStatus('Select Grid thumbnails to update groups.');
    return false;
  }
  var nextChecked = !!isChecked;
  var changedCount = 0;
  keys.forEach(function (key) {
    var previous = isChecklistRequirementCheckedForMediaKey(key, requirementLabel);
    setChecklistRequirementCheckedForMediaKey(key, requirementLabel, nextChecked, {
      skipSync: true,
      skipSave: true,
      skipRender: true
    });
    if (previous !== nextChecked) changedCount += 1;
  });
  finalizeChecklistBatchMutation(keys, requirementLabel, nextChecked ? 'Marked reviewed for' : 'Cleared reviewed for', changedCount, opts);
  return true;
}

function toggleGroupWorkbenchTermForItem(mediaKey, requirementLabel, term) {
  if (!mediaKey || !term) return;
  if (typeof toggleAnnotateTag === 'function') {
    toggleAnnotateTag(term);
  } else if (typeof hasTagForMediaKey === 'function' && hasTagForMediaKey(mediaKey, term)) {
    if (typeof removeTagFromCurrentMedia === 'function') removeTagFromCurrentMedia(term);
    else if (typeof removeTagFromMediaKey === 'function') removeTagFromMediaKey(mediaKey, term);
  } else {
    if (typeof addTagToCurrentMedia === 'function') addTagToCurrentMedia(term);
    else if (typeof addTagToMediaKey === 'function') addTagToMediaKey(mediaKey, term);
  }
}

function toggleGroupWorkbenchTermForMediaKeys(mediaKeys, requirementLabel, term, options) {
  var opts = options || {};
  var keys = getDistinctGroupWorkbenchMediaKeys(mediaKeys);
  if (!keys.length) {
    if (typeof setStatus === 'function') setStatus('Select Grid thumbnails to tag them.');
    return false;
  }
  var allHaveTerm = typeof hasTagForMediaKey === 'function' && keys.every(function (key) {
    return hasTagForMediaKey(key, term);
  });
  var changed = 0;
  keys.forEach(function (key) {
    var ok = false;
    if (allHaveTerm) {
      if (typeof removeTagFromMediaKey === 'function') ok = removeTagFromMediaKey(key, term);
    } else {
      if (typeof addTagToMediaKey === 'function') ok = addTagToMediaKey(key, term);
    }
    if (ok) changed += 1;
  });
  if (typeof setStatus === 'function') {
    setStatus((allHaveTerm ? 'Removed' : 'Added') + ' "' + term + '" on ' + changed + ' Grid item' + (changed === 1 ? '' : 's') + '.');
  }
  if (typeof opts.onAfterMutation === 'function') {
    opts.onAfterMutation();
  } else {
    renderGroupWorkbench({
      mode: 'grid',
      targetEl: opts.targetEl,
      mediaKeys: keys,
      contextMediaKeys: opts.contextMediaKeys,
      getContextMediaKeys: opts.getContextMediaKeys,
      onAfterMutation: opts.onAfterMutation
    });
  }
  return true;
}

function getGroupWorkbenchGridUsageState(term, mediaKeys) {
  var total = Array.isArray(mediaKeys) ? mediaKeys.length : 0;
  if (total <= 0 || typeof hasTagForMediaKey !== 'function') return 'none';
  var count = 0;
  mediaKeys.forEach(function (key) {
    if (hasTagForMediaKey(key, term)) count += 1;
  });
  if (count <= 0) return 'none';
  var ratio = count / total;
  if (ratio >= 0.7) return 'most';
  if (ratio >= 0.35) return 'many';
  return 'some';
}

function getGroupWorkbenchColumnCount(targetEl) {
  if (!targetEl || !targetEl.isConnected) return 1;
  var width = Math.max(0, targetEl.clientWidth || targetEl.getBoundingClientRect().width || 0);
  if (!width) return 1;
  var minCardWidth = 210;
  var columnGap = 8;
  var isGridSurface = !!targetEl.closest && !!targetEl.closest('.workspace-surface-grid');
  var maxColumns = isGridSurface ? 2 : 4;
  return Math.max(1, Math.min(maxColumns, Math.floor((width + columnGap) / (minCardWidth + columnGap)) || 1));
}

function getGroupWorkbenchColumnHeights(prefixSums, startIdx, endIdx, columnGap) {
  if (endIdx < startIdx) return 0;
  var height = prefixSums[endIdx + 1] - prefixSums[startIdx];
  var gapCount = Math.max(0, endIdx - startIdx);
  return height + (gapCount * columnGap);
}

function partitionGroupWorkbenchColumns(groupHeights, columnCount, columnGap) {
  var totalGroups = Array.isArray(groupHeights) ? groupHeights.length : 0;
  var effectiveColumnCount = Math.max(1, Math.min(columnCount || 1, totalGroups || 1));
  if (!totalGroups) return [];
  if (effectiveColumnCount <= 1) return [[0, totalGroups - 1]];

  var prefixSums = [0];
  for (var i = 0; i < totalGroups; i++) {
    prefixSums.push(prefixSums[prefixSums.length - 1] + Math.max(0, groupHeights[i] || 0));
  }

  var dp = [];
  var splitAt = [];
  for (var groupIdx = 0; groupIdx < totalGroups; groupIdx++) {
    dp[groupIdx] = [];
    splitAt[groupIdx] = [];
    dp[groupIdx][0] = getGroupWorkbenchColumnHeights(prefixSums, 0, groupIdx, columnGap);
    splitAt[groupIdx][0] = -1;
  }

  for (var partIdx = 1; partIdx < effectiveColumnCount; partIdx++) {
    for (var endIdx = 0; endIdx < totalGroups; endIdx++) {
      if (partIdx > endIdx) {
        dp[endIdx][partIdx] = 0;
        splitAt[endIdx][partIdx] = endIdx - 1;
        continue;
      }
      var bestCost = Number.POSITIVE_INFINITY;
      var bestSplit = partIdx - 1;
      for (var prevEnd = partIdx - 1; prevEnd < endIdx; prevEnd++) {
        var previousCost = dp[prevEnd][partIdx - 1];
        var nextCost = getGroupWorkbenchColumnHeights(prefixSums, prevEnd + 1, endIdx, columnGap);
        var candidateCost = Math.max(previousCost, nextCost);
        if (candidateCost < bestCost) {
          bestCost = candidateCost;
          bestSplit = prevEnd;
        }
      }
      dp[endIdx][partIdx] = bestCost;
      splitAt[endIdx][partIdx] = bestSplit;
    }
  }

  var partitions = new Array(effectiveColumnCount);
  var endCursor = totalGroups - 1;
  for (var columnIdx = effectiveColumnCount - 1; columnIdx >= 0; columnIdx--) {
    var startCursor = columnIdx === 0 ? 0 : (splitAt[endCursor][columnIdx] + 1);
    partitions[columnIdx] = [startCursor, endCursor];
    endCursor = startCursor - 1;
  }
  return partitions;
}

function measureGroupWorkbenchHeights(targetEl, groupElements, columnWidth) {
  var elements = Array.isArray(groupElements) ? groupElements : [];
  var widths = [];
  if (!targetEl || !targetEl.isConnected || !elements.length) return widths;

  var measureWrap = document.createElement('div');
  measureWrap.className = 'group-workbench-measure';
  measureWrap.style.width = Math.max(0, columnWidth || 0) + 'px';
  targetEl.appendChild(measureWrap);

  for (var i = 0; i < elements.length; i++) {
    var clone = elements[i].cloneNode(true);
    clone.style.width = '100%';
    measureWrap.appendChild(clone);
    widths.push(clone.getBoundingClientRect().height || clone.offsetHeight || 0);
  }

  measureWrap.remove();
  return widths;
}

function applyGroupWorkbenchColumnLayout(targetEl, groupElements) {
  if (!targetEl) return false;
  var elements = Array.isArray(groupElements) ? groupElements : [];
  var totalGroups = elements.length;
  var requestedColumnCount = getGroupWorkbenchColumnCount(targetEl);
  var effectiveColumnCount = Math.max(1, Math.min(requestedColumnCount, totalGroups || 1));
  var columnGap = 12;
  var targetWidth = Math.max(0, targetEl.clientWidth || targetEl.getBoundingClientRect().width || 0);
  var layoutWidth = Math.round(targetWidth);
  var canReuseLayout = targetEl._groupWorkbenchGroupCount === totalGroups
    && targetEl._groupWorkbenchLayoutColumnCount === effectiveColumnCount
    && targetEl._groupWorkbenchLayoutWidth === layoutWidth
    && Array.isArray(targetEl._groupWorkbenchLayoutPartitions);
  targetEl._groupWorkbenchGroupCount = totalGroups;
  targetEl._groupWorkbenchLayoutColumnCount = effectiveColumnCount;
  targetEl._groupWorkbenchLayoutWidth = layoutWidth;
  targetEl.setAttribute('data-columns', String(effectiveColumnCount));
  if (!totalGroups) {
    targetEl._groupWorkbenchLayoutPartitions = [];
    return !canReuseLayout;
  }

  targetEl.style.setProperty('--group-workbench-columns', String(effectiveColumnCount));
  if (effectiveColumnCount <= 1) {
    targetEl._groupWorkbenchLayoutPartitions = [[0, totalGroups - 1]];
    for (var groupIndex = 0; groupIndex < totalGroups; groupIndex++) {
      targetEl.appendChild(elements[groupIndex]);
    }
    return !canReuseLayout;
  }
  var columnWidth = Math.max(0, (targetWidth - (columnGap * (effectiveColumnCount - 1))) / effectiveColumnCount);
  var partitions = targetEl._groupWorkbenchLayoutPartitions;
  if (!canReuseLayout) {
    var groupHeights = measureGroupWorkbenchHeights(targetEl, elements, columnWidth);
    partitions = partitionGroupWorkbenchColumns(groupHeights, effectiveColumnCount, columnGap);
    targetEl._groupWorkbenchLayoutPartitions = partitions;
  }

  for (var columnIdx = 0; columnIdx < partitions.length; columnIdx++) {
    var partition = partitions[columnIdx];
    var columnEl = document.createElement('div');
    columnEl.className = 'group-workbench-column';
    columnEl.style.setProperty('--group-workbench-column-width', columnWidth + 'px');
    for (var groupIdx = partition[0]; groupIdx <= partition[1]; groupIdx++) {
      columnEl.appendChild(elements[groupIdx]);
    }
    targetEl.appendChild(columnEl);
  }
  return !canReuseLayout;
}

function renderGroupWorkbench(options) {
  var opts = resolveGroupWorkbenchOptions(options);
  var targetEl = opts.targetEl || document.getElementById('group-workbench-list');
  if (!targetEl) return;
  var previousScrollTop = targetEl.scrollTop || 0;
  targetEl._groupWorkbenchRenderOptions = {
    mode: opts.mode,
    targetEl: targetEl,
    mediaKeys: opts.mediaKeys.slice(),
    getMediaKeys: opts.getMediaKeys,
    contextMediaKeys: opts.contextMediaKeys.slice(),
    getContextMediaKeys: opts.getContextMediaKeys,
    currentMediaKey: opts.currentMediaKey,
    onAfterMutation: opts.onAfterMutation
  };
  var isGridMode = opts.mode === 'grid';
  var hasGridTargets = isGridMode && opts.mediaKeys.length > 0;
  var hasItemTarget = !isGridMode && !!opts.currentMediaKey;
  var hasActionTarget = isGridMode ? hasGridTargets : hasItemTarget;
  if (!Array.isArray(checklistItems) || !checklistItems.length) {
    renderGroupWorkbenchEmpty(targetEl, 'No groups configured.');
    return;
  }

  targetEl.innerHTML = '';
  if (!hasActionTarget) {
    appendGroupWorkbenchNotice(targetEl, isGridMode
      ? 'Select Grid thumbnails to tag them.'
      : 'Select an item to review groups.');
  }
  var groupElements = [];
  var mediaKey = opts.currentMediaKey || opts.mediaKeys[0] || '';
  var mediaKeys = opts.mediaKeys;
  var contextMediaKeys = opts.getContextMediaKeys();
  if (!isGridMode && (!Array.isArray(contextMediaKeys) || contextMediaKeys.length <= 1) && state && Array.isArray(state.items)) {
    contextMediaKeys = state.items.map(function (item) {
      return item && item.key;
    }).filter(Boolean);
  }
  var captionText = (!isGridMode && ui && ui.editorEl && typeof ui.editorEl.value === 'string')
    ? ui.editorEl.value
    : (state && state.currentItem ? (state.currentItem.caption || '') : '');

  for (var i = 0; i < checklistItems.length; i++) {
    var requirementLabel = checklistItems[i];
    var batchState = isGridMode ? getChecklistRequirementBatchState(mediaKeys, requirementLabel) : null;
    var isReviewed = isGridMode
      ? (hasGridTargets && batchState.allReviewed)
      : (hasItemTarget && isChecklistRequirementCheckedForMediaKey(mediaKey, requirementLabel));
    var isReviewedMixed = isGridMode && hasGridTargets && batchState.someReviewed && !batchState.allReviewed;
    var isCaptionMatched = !isGridMode && hasItemTarget && requirementKeywordsMatch(requirementLabel, captionText);
    var terms = getChecklistKeywordTermsForRequirement(requirementLabel)
      .map(normalizeChecklistTerm)
      .filter(function (term, idx, arr) {
        if (!term) return false;
        var key = term.toLowerCase();
        for (var j = 0; j < idx; j++) {
          if (String(arr[j] || '').toLowerCase() === key) return false;
        }
        return true;
      });
    terms.sort(checklistSort);

    var groupEl = document.createElement('div');
    groupEl.className = 'group-workbench-group';
    groupEl.classList.toggle('is-reviewed', isReviewed);
    groupEl.classList.toggle('is-complete', isReviewed);
    groupEl.classList.toggle('is-incomplete', !isReviewed);
    groupEl.classList.toggle('is-disabled', !hasActionTarget);
    groupEl.classList.toggle('is-caption-matched', isCaptionMatched);
    if (!isGridMode && hasItemTarget) {
      (function (key, label) {
        groupEl.ondblclick = function (event) {
          if (!event || !event.target) return;
          if (headerEl && headerEl.contains(event.target)) return;
          var tagName = String(event.target.tagName || '').toLowerCase();
          if (tagName === 'button' || tagName === 'input' || tagName === 'label') return;
          toggleChecklistRequirementCheckedForMediaKey(key, label);
          refreshGroupWorkbenchForCurrentItem();
        };
      })(mediaKey, requirementLabel);
    }

    var headerEl = document.createElement('div');
    headerEl.className = 'group-workbench-group-header';

    var headerRowEl = document.createElement('div');
    headerRowEl.className = 'group-workbench-group-header-row';

    var titleMainEl = document.createElement('div');
    titleMainEl.className = 'group-workbench-group-title-main';

    var titleEl = document.createElement('div');
    titleEl.className = 'group-workbench-group-title';
    titleEl.textContent = requirementLabel;

    var actionsEl = document.createElement('div');
    actionsEl.className = 'group-workbench-group-actions';

    var moveUpBtn = createGroupWorkbenchActionButton('group-workbench-move-up-btn', '\u2191', 'Move group up', 'Move ' + requirementLabel + ' up');
    moveUpBtn.disabled = i === 0;
    (function (index, label, afterMutation) {
      bindGroupWorkbenchHeaderButton(moveUpBtn, function () {
        if (!moveChecklistItemByOffset(index, -1)) return;
        setStatus('Moved group up: ' + label);
        if (afterMutation) afterMutation();
      });
    })(i, requirementLabel, opts.onAfterMutation);
    actionsEl.appendChild(moveUpBtn);

    var editBtn = createGroupWorkbenchActionButton('group-workbench-edit-btn', '\u270e', 'Edit group terms', 'Edit terms for ' + requirementLabel);
    (function (label) {
      bindGroupWorkbenchHeaderButton(editBtn, function () {
        openChecklistGroupTermsModal(label);
      });
    })(requirementLabel);
    actionsEl.appendChild(editBtn);

    var deleteBtn = createGroupWorkbenchActionButton('group-workbench-delete-btn', '\u00d7', 'Delete group', 'Delete ' + requirementLabel);
    (function (index, afterMutation) {
      bindGroupWorkbenchHeaderButton(deleteBtn, function () {
        if (!deleteChecklistGroupByIndex(index)) return;
        if (afterMutation) afterMutation();
      });
    })(i, opts.onAfterMutation);
    actionsEl.appendChild(deleteBtn);

    var reviewedBtn = createGroupWorkbenchActionButton('group-workbench-reviewed-btn', '\u2713', 'Toggle reviewed', 'Toggle reviewed for ' + requirementLabel);
    reviewedBtn.setAttribute('aria-pressed', isReviewed ? 'true' : 'false');
    reviewedBtn.classList.toggle('active', isReviewed);
    reviewedBtn.classList.toggle('mixed', isReviewedMixed);
    reviewedBtn.disabled = !hasActionTarget;
    if (isReviewedMixed) {
      reviewedBtn.title = 'Mixed reviewed state for ' + requirementLabel;
      reviewedBtn.setAttribute('aria-label', 'Mixed reviewed state for ' + requirementLabel);
    }
    (function (key, label, mode, getMediaKeys, afterMutation, getContextMediaKeys, nextIsReviewed) {
      bindGroupWorkbenchHeaderButton(reviewedBtn, function () {
        if (mode === 'grid') {
          setChecklistRequirementCheckedForMediaKeys(getMediaKeys(), label, !nextIsReviewed, {
            targetEl: targetEl,
            contextMediaKeys: getContextMediaKeys(),
            getContextMediaKeys: getContextMediaKeys,
            onAfterMutation: afterMutation
          });
          return;
        }
        if (!key) return;
        toggleChecklistRequirementCheckedForMediaKey(key, label);
        refreshGroupWorkbenchForCurrentItem();
      });
    })(mediaKey, requirementLabel, opts.mode, opts.getMediaKeys, opts.onAfterMutation, opts.getContextMediaKeys, isReviewed);
    actionsEl.appendChild(reviewedBtn);

    titleMainEl.appendChild(titleEl);
    headerRowEl.appendChild(titleMainEl);
    headerRowEl.appendChild(actionsEl);
    headerEl.appendChild(headerRowEl);
    groupEl.appendChild(headerEl);

    var termListEl = document.createElement('div');
    termListEl.className = 'group-workbench-term-list';
    var groupHasActiveTerm = false;
    var groupHasMixedTerm = false;
    var groupHasMismatchTerm = false;
    var selectedTermCount = 0;
    var mixedTermCount = 0;
    if (!terms.length) {
      var emptyTermsEl = document.createElement('div');
      emptyTermsEl.className = 'group-workbench-empty';
      emptyTermsEl.textContent = 'No terms configured.';
      termListEl.appendChild(emptyTermsEl);
    }
    var termEntries = [];
    for (var t = 0; t < terms.length; t++) {
      var term = terms[t];
      var activeCount = 0;
      if (hasActionTarget && typeof hasTagForMediaKey === 'function') {
        if (isGridMode) {
          for (var mk = 0; mk < mediaKeys.length; mk++) {
            if (hasTagForMediaKey(mediaKeys[mk], term)) activeCount += 1;
          }
        } else if (hasTagForMediaKey(mediaKey, term)) {
          activeCount = 1;
        }
      }
      var isActive = isGridMode
        ? (hasGridTargets && activeCount === mediaKeys.length)
        : (hasItemTarget && activeCount > 0);
      var isMixed = isGridMode && hasGridTargets && activeCount > 0 && activeCount < mediaKeys.length;
      var appearsInCaption = hasItemTarget && !isGridMode
        && typeof tagAppearsInCurrentCaption === 'function'
        && tagAppearsInCurrentCaption(term);
      var isMismatch = hasItemTarget && !isGridMode && isActive && !appearsInCaption;
      var isMatched = hasItemTarget && !isGridMode && !isActive && appearsInCaption;
      var renderedTerm = renderChecklistTermWithAffixes(term, mediaKey);
      var usageState = getGroupWorkbenchGridUsageState(term, contextMediaKeys);
      var termBtn = document.createElement('button');
      termBtn.type = 'button';
      termBtn.className = 'group-workbench-term-btn group-workbench-term-usage-' + usageState;
      termBtn.textContent = term;
      termBtn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      termBtn.title = renderedTerm && renderedTerm !== term ? renderedTerm : term;
      if (isMatched) termBtn.title += ' — found in caption, not selected';
      termBtn.classList.toggle('active', isActive);
      termBtn.classList.toggle('mixed', isMixed);
      termBtn.classList.toggle('matched', isMatched);
      termBtn.classList.toggle('mismatch', isMismatch);
      termBtn.disabled = !hasActionTarget;
      groupHasActiveTerm = groupHasActiveTerm || isActive;
      groupHasMixedTerm = groupHasMixedTerm || isMixed;
      groupHasMismatchTerm = groupHasMismatchTerm || isMismatch;
      if (isActive) selectedTermCount += 1;
      if (isMixed) mixedTermCount += 1;
      (function (btn, key, label, termText, mode, afterMutation, getMediaKeys, getContextMediaKeys) {
        btn.onclick = function () {
          if (btn.disabled) return;
          if (mode === 'grid') {
            toggleGroupWorkbenchTermForMediaKeys(getMediaKeys(), label, termText, {
              targetEl: targetEl,
              contextMediaKeys: getContextMediaKeys(),
              getContextMediaKeys: getContextMediaKeys,
              onAfterMutation: afterMutation
            });
            return;
          }
          toggleGroupWorkbenchTermForItem(key, label, termText);
        };
        btn.oncontextmenu = function (event) {
          event.preventDefault();
          if (typeof openChecklistTermAffixesModal === 'function') {
            openChecklistTermAffixesModal(termText);
          }
        };
      })(termBtn, mediaKey, requirementLabel, term, opts.mode, opts.onAfterMutation, opts.getMediaKeys, opts.getContextMediaKeys);
      termEntries.push({
        term: term,
        button: termBtn,
        isActive: isActive,
        isMixed: isMixed,
        isMatched: isMatched,
        usageState: usageState
      });
    }

    renderTermFamilyEntries(termListEl, termEntries, {
      getText: function (entry) { return entry.term; },
      isBreakout: function (entry) { return entry.isActive || entry.isMixed; },
      getHint: function (entry) {
        if (entry.isMatched) return { className: 'matched', text: 'caption matches' };
        if (entry.usageState === 'most') return { className: 'usage', text: 'frequently used' };
        return null;
      },
      triggerClass: 'group-workbench-term-btn',
      popoverClass: 'term-family-popover--workbench',
      renderItem: function (entry) { return entry.button; }
    });

    groupEl.classList.toggle('has-active-term', groupHasActiveTerm);
    groupEl.classList.toggle('has-mixed-term', groupHasMixedTerm);
    groupEl.classList.toggle('has-mismatch-term', groupHasMismatchTerm);
    groupEl.appendChild(termListEl);

    groupElements.push(groupEl);
  }
  if (!groupElements.length) {
    renderGroupWorkbenchEmpty(targetEl, 'No groups with terms configured.');
    targetEl.scrollTop = Math.max(0, previousScrollTop);
    return;
  }
  var layoutChanged = applyGroupWorkbenchColumnLayout(targetEl, groupElements);
  targetEl.scrollTop = Math.max(0, previousScrollTop);
  if (layoutChanged) syncGroupWorkbenchTermScale(targetEl, opts.mode);
}

var groupWorkbenchResizeFrame = 0;
window.addEventListener('resize', function () {
  if (groupWorkbenchResizeFrame) {
    window.cancelAnimationFrame(groupWorkbenchResizeFrame);
  }
  groupWorkbenchResizeFrame = window.requestAnimationFrame(function () {
    groupWorkbenchResizeFrame = 0;
    var lists = document.querySelectorAll('.group-workbench-list');
    for (var i = 0; i < lists.length; i++) {
      var listEl = lists[i];
      if (!listEl || !listEl.isConnected || !listEl._groupWorkbenchRenderOptions) continue;
      var groupCount = Math.max(0, Number(listEl._groupWorkbenchGroupCount) || 0);
      var nextWidth = Math.round(listEl.clientWidth || listEl.getBoundingClientRect().width || 0);
      var nextColumnCount = Math.max(1, Math.min(getGroupWorkbenchColumnCount(listEl), groupCount || 1));
      if (listEl._groupWorkbenchLayoutColumnCount === nextColumnCount
          && listEl._groupWorkbenchLayoutWidth === nextWidth) {
        continue;
      }
      renderGroupWorkbench(listEl._groupWorkbenchRenderOptions);
    }
  });
});
