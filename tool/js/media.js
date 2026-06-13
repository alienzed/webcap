// media.js
// Global functions: selectPathMedia, navigateUp, renderPathPreview, reselectCurrentMediaFromPreview

function scrollCurrentMediaRowIntoView() {
  if (!ui || !ui.mediaListEl || !state || !state.currentItem || !state.currentItem.key) {
    return;
  }
  var rows = ui.mediaListEl.querySelectorAll('.media-item[data-type="media"]');
  var target = null;
  for (var i = 0; i < rows.length; i += 1) {
    if (rows[i].getAttribute('data-key') === state.currentItem.key) {
      target = rows[i];
      break;
    }
  }
  if (!target) {
    return;
  }
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function isPreviewVideoFileName(fileName) {
  var name = String(fileName || '');
  var dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  var ext = name.slice(dot).toLowerCase();
  return ['.mp4', '.webm', '.ogg', '.mov', '.mkv', '.avi', '.m4v'].indexOf(ext) !== -1;
}

function getPreviewPrimaryActionPlan(fileName) {
  if (isPreviewVideoFileName(fileName)) {
    return [
      { label: 'Clip', actionLabel: 'Clip...' },
      { label: 'Deface', actionLabel: 'Deface...' }
    ];
  }
  return [
    { label: 'Crop', actionLabel: 'Crop...' },
    { label: 'Deface', actionLabel: 'Deface...' }
  ];
}

function getPreviewContextActionsForCurrentItem() {
  if (!state || !state.currentItem || !state.currentItem.fileName) return [];
  if (typeof buildMediaContextMenuActions !== 'function') return [];
  var item = state.currentItem;
  var key = item.key || item.fileName;
  var actions = buildMediaContextMenuActions(item, key);
  return Array.isArray(actions) ? actions : [];
}

function findPreviewActionByLabel(actions, label) {
  for (var i = 0; i < actions.length; i++) {
    var action = actions[i];
    if (!action || action.separator) continue;
    if (String(action.label || '') !== String(label || '')) continue;
    return action;
  }
  return null;
}

function hasNonSeparatorActions(actions) {
  return (actions || []).some(function (action) {
    return !!(action && !action.separator);
  });
}

function filterPreviewSecondaryActions(allActions, usedByLabel) {
  var out = [];
  (allActions || []).forEach(function (action) {
    if (!action) return;
    if (action.separator) {
      out.push(action);
      return;
    }
    var label = String(action.label || '');
    if (usedByLabel[label]) return;
    out.push(action);
  });
  return out;
}

function runPreviewActionByLabel(label) {
  var actions = getPreviewContextActionsForCurrentItem();
  var action = findPreviewActionByLabel(actions, label);
  if (!action || typeof action.run !== 'function') {
    setStatus('Action unavailable: ' + label);
    return;
  }
  action.run();
}

function updatePreviewActionControls() {
  if (!ui || !ui.previewActionsEl || !ui.previewMutationIndicatorEl || !ui.previewPrimaryActionAEl || !ui.previewPrimaryActionBEl || !ui.previewMoreActionsEl) return;

  var hideAll = function () {
    ui.previewActionsEl.classList.add('hidden');
    ui.previewMutationIndicatorEl.classList.add('hidden');
    ui.previewMutationIndicatorEl.removeAttribute('data-action-label');
    ui.previewPrimaryActionAEl.classList.add('hidden');
    ui.previewPrimaryActionBEl.classList.add('hidden');
    ui.previewMoreActionsEl.classList.add('hidden');
    ui.previewPrimaryActionAEl.removeAttribute('data-action-label');
    ui.previewPrimaryActionBEl.removeAttribute('data-action-label');
  };

  if (!state || !state.currentItem || !state.currentItem.fileName) {
    hideAll();
    return;
  }

  var actions = getPreviewContextActionsForCurrentItem();
  if (!hasNonSeparatorActions(actions)) {
    hideAll();
    return;
  }
  // This element is a contextual "Reset" quick action (not a passive mutation badge).
  var mutationResetAction = findPreviewActionByLabel(actions, 'Reset');
  var showMutationReset = !!(isMediaMutated(state.currentItem.key) && mutationResetAction);
  ui.previewMutationIndicatorEl.classList.toggle('hidden', !showMutationReset);
  if (showMutationReset) {
    ui.previewMutationIndicatorEl.textContent = 'Reset';
    ui.previewMutationIndicatorEl.setAttribute('data-action-label', 'Reset');
  } else {
    ui.previewMutationIndicatorEl.removeAttribute('data-action-label');
  }

  var plan = getPreviewPrimaryActionPlan(state.currentItem.fileName);
  var primaryA = findPreviewActionByLabel(actions, plan[0].actionLabel);
  var primaryB = findPreviewActionByLabel(actions, plan[1].actionLabel);
  var used = {};

  if (primaryA) {
    used[plan[0].actionLabel] = true;
    ui.previewPrimaryActionAEl.textContent = plan[0].label;
    ui.previewPrimaryActionAEl.setAttribute('data-action-label', plan[0].actionLabel);
    ui.previewPrimaryActionAEl.classList.remove('hidden');
  } else {
    ui.previewPrimaryActionAEl.classList.add('hidden');
    ui.previewPrimaryActionAEl.removeAttribute('data-action-label');
  }

  if (primaryB) {
    used[plan[1].actionLabel] = true;
    ui.previewPrimaryActionBEl.textContent = plan[1].label;
    ui.previewPrimaryActionBEl.setAttribute('data-action-label', plan[1].actionLabel);
    ui.previewPrimaryActionBEl.classList.remove('hidden');
  } else {
    ui.previewPrimaryActionBEl.classList.add('hidden');
    ui.previewPrimaryActionBEl.removeAttribute('data-action-label');
  }

  var secondaryActions = filterPreviewSecondaryActions(actions, used);
  var hasMore = hasNonSeparatorActions(secondaryActions);
  ui.previewMoreActionsEl.classList.toggle('hidden', !hasMore);

  if (primaryA || primaryB || hasMore || showMutationReset) {
    ui.previewActionsEl.classList.remove('hidden');
  } else {
    ui.previewActionsEl.classList.add('hidden');
  }
}

function wirePreviewActionControls() {
  if (!ui || !ui.previewActionsEl || !ui.previewMutationIndicatorEl || !ui.previewPrimaryActionAEl || !ui.previewPrimaryActionBEl || !ui.previewMoreActionsEl) return;
  if (ui.previewActionsEl.__wired) return;
  ui.previewActionsEl.__wired = true;

  function bindPrimaryButton(btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var actionLabel = String(btn.getAttribute('data-action-label') || '');
      if (!actionLabel) return;
      runPreviewActionByLabel(actionLabel);
    });
  }

  bindPrimaryButton(ui.previewPrimaryActionAEl);
  bindPrimaryButton(ui.previewPrimaryActionBEl);
  bindPrimaryButton(ui.previewMutationIndicatorEl);

  ui.previewMoreActionsEl.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    var actions = getPreviewContextActionsForCurrentItem();
    var used = {};
    var aLabel = String(ui.previewPrimaryActionAEl.getAttribute('data-action-label') || '');
    var bLabel = String(ui.previewPrimaryActionBEl.getAttribute('data-action-label') || '');
    if (aLabel) used[aLabel] = true;
    if (bLabel) used[bLabel] = true;
    var secondaryActions = filterPreviewSecondaryActions(actions, used);
    if (!hasNonSeparatorActions(secondaryActions)) return;
    var rect = ui.previewMoreActionsEl.getBoundingClientRect();
    showContextMenu(rect.left, rect.bottom + 6, secondaryActions);
  });
}


/**
 * Return the array of media items after applying the current UI filters.
 * If ignoreFocusSet is true, the focus set will be ignored and filters applied to full folder.
 */
function parseMediaFilterQuery(raw) {
  var text = String(raw || '').toLowerCase().trim();
  var out = { positive: [], negative: [] };
  if (!text) return out;
  var hasStructuredSeparators = /[,;\n]/.test(text);
  var parts = hasStructuredSeparators ? text.split(/[,;\n]+/) : [text];
  var seen = {};
  for (var i = 0; i < parts.length; i += 1) {
    var term = String(parts[i] || '').trim();
    if (!term) continue;
    var isNegative = false;
    if (term.charAt(0) === '-' || term.charAt(0) === '!') {
      isNegative = true;
      term = term.slice(1).trim();
    }
    if (!term) continue;
    var key = (isNegative ? '!' : '+') + term;
    if (seen[key]) continue;
    seen[key] = true;
    if (isNegative) out.negative.push(term);
    else out.positive.push(term);
  }
  return out;
}

function mediaItemMatchesFilterQuery(item, query, mode) {
  var label = String(item && item.label || '').toLowerCase();
  var fileName = String(item && item.fileName || '').toLowerCase();
  var caption = String(item && item.caption || '').toLowerCase();
  var tags = getTagsForMediaKey(item && item.key).join(' ').toLowerCase();
  var haystack = label + '\n' + fileName + '\n' + caption + '\n' + tags;
  var termMatches = function (term) {
    return haystack.indexOf(term) !== -1;
  };
  for (var i = 0; i < query.negative.length; i += 1) {
    if (termMatches(query.negative[i])) return false;
  }
  if (!query.positive.length) return true;
  if (mode === 'all') {
    return query.positive.every(termMatches);
  }
  return query.positive.some(termMatches);
}

function mediaItemHasIncompleteRequirementGroups(item) {
  if (!item || !item.key) return false;
  if (typeof computeRequirementProgressForMediaKey !== 'function') return false;
  var progress = computeRequirementProgressForMediaKey(item.key);
  if (!progress || !isFinite(progress.total) || !isFinite(progress.completed)) return false;
  if (progress.total <= 0) return false;
  return progress.completed < progress.total;
}

function mediaItemHasTagMismatch(item) {
  if (!item || !item.key) return false;
  if (typeof getTagsForMediaKey !== 'function') return false;
  var tags = getTagsForMediaKey(item.key);
  if (!tags.length) return true;
  if (typeof computeTagMatchProgressForText !== 'function') return false;
  var progress = computeTagMatchProgressForText(item.key, item.caption || '');
  return !!(progress && progress.total > 0 && progress.completed < progress.total);
}

function getFilteredMediaItems(ignoreFocusSet) {
  var q = (ui.filterEl && ui.filterEl.value) ? String(ui.filterEl.value) : '';
  var queryTerms = parseMediaFilterQuery(q);
  var textMatchMode = 'all';
  var mediaItems = Array.isArray(state.items) ? state.items.slice() : [];
  var missingCaptionsOnly = !!(ui.advancedFilterMissingCaptionsEl && ui.advancedFilterMissingCaptionsEl.checked);
  var reviewedOnly = !!(ui.advancedFilterReviewedEl && ui.advancedFilterReviewedEl.checked);
  var unreviewedOnly = !!(ui.advancedFilterUnreviewedEl && ui.advancedFilterUnreviewedEl.checked);
  var incompleteOnly = !!(ui.advancedFilterIncompleteEl && ui.advancedFilterIncompleteEl.checked);
  var tagMismatchOnly = !!(ui.advancedFilterUntaggedEl && ui.advancedFilterUntaggedEl.checked);
  var starFilterState = getAdvancedStarFilterState();
  var flagFilterValues = getAdvancedFlagFilterValues();

  // Apply focus set only when not ignoring it
  if (!ignoreFocusSet && state.focusSet && state.focusSet.keys && state.focusSet.keys.length) {
    var allow = {};
    state.focusSet.keys.forEach(function (key) { allow[key] = true; });
    mediaItems = mediaItems.filter(function (item) { return !!allow[item.key]; });
  }

  // Filter logic (by label, fileName, or caption)
  if (String(q || '').trim()) {
    mediaItems = mediaItems.filter(function (item) {
      return mediaItemMatchesFilterQuery(item, queryTerms, textMatchMode);
    });
  }
  if (missingCaptionsOnly) {
    mediaItems = mediaItems.filter(function (item) { return !item.hasCaption; });
  }
  if (reviewedOnly) {
    mediaItems = mediaItems.filter(function (item) { return !!(state.reviewedSet && state.reviewedSet.has(item.key)); });
  }
  if (unreviewedOnly) {
    mediaItems = mediaItems.filter(function (item) { return !(state.reviewedSet && state.reviewedSet.has(item.key)); });
  }
  if (incompleteOnly) {
    mediaItems = mediaItems.filter(mediaItemHasIncompleteRequirementGroups);
  }
  if (starFilterState.values.length || starFilterState.includeNoStar) {
    mediaItems = mediaItems.filter(function (item) {
      var rating = (typeof getRatingForMediaKey === 'function') ? getRatingForMediaKey(item.key) : 0;
      if (rating <= 0) return starFilterState.includeNoStar;
      return starFilterState.values.indexOf(rating) !== -1;
    });
  }
  if (flagFilterValues.length) {
    mediaItems = mediaItems.filter(function (item) {
      var itemFlag = String((state.flags && state.flags[item.key]) || '').toLowerCase();
      var wantsNoFlag = flagFilterValues.indexOf('no_flag') !== -1;
      if (!itemFlag) return wantsNoFlag;
      return flagFilterValues.indexOf(itemFlag) !== -1;
    });
  }
  if (tagMismatchOnly) {
    mediaItems = mediaItems.filter(mediaItemHasTagMismatch);
  }
  var showInvalidArOnly = !!(ui.advancedFilterInvalidArEl && ui.advancedFilterInvalidArEl.checked);
  if (showInvalidArOnly) {
    mediaItems = mediaItems.filter(function (item) {
      var ar = String((item && item.metadata && item.metadata.aspect) || '').trim();
      if (!ar) return false;
      return !(typeof hasSupportedAspectBucket === 'function' && hasSupportedAspectBucket(ar));
    });
  }
  return mediaItems;
}

function hasAnyActiveMediaFilter() {
  var q = (ui.filterEl && ui.filterEl.value) ? String(ui.filterEl.value).trim() : '';
  if (q) return true;
  if (ui.advancedFilterMissingCaptionsEl && ui.advancedFilterMissingCaptionsEl.checked) return true;
  if (ui.advancedFilterReviewedEl && ui.advancedFilterReviewedEl.checked) return true;
  if (ui.advancedFilterUnreviewedEl && ui.advancedFilterUnreviewedEl.checked) return true;
  if (ui.advancedFilterIncompleteEl && ui.advancedFilterIncompleteEl.checked) return true;
  if (ui.advancedFilterUntaggedEl && ui.advancedFilterUntaggedEl.checked) return true;
  if (ui.advancedFilterInvalidArEl && ui.advancedFilterInvalidArEl.checked) return true;
  if (ui.advancedFilterStarsEl && ui.advancedFilterStarsEl.querySelector('input[type="checkbox"]:checked')) return true;
  if (ui.advancedFilterFlagEl && ui.advancedFilterFlagEl.querySelector('input[type="checkbox"]:checked')) return true;
  return false;
}

function pickReplacementVisibleMediaItem(currentKey, visibleItems) {
  if (!Array.isArray(visibleItems) || !visibleItems.length) return null;
  var allItems = Array.isArray(state.items) ? state.items : [];
  var orderByKey = {};
  for (var i = 0; i < allItems.length; i++) {
    var it = allItems[i];
    if (it && it.key && orderByKey[it.key] === undefined) {
      orderByKey[it.key] = i;
    }
  }
  var currentIndex = (currentKey && orderByKey[currentKey] !== undefined) ? orderByKey[currentKey] : -1;
  if (currentIndex < 0) return visibleItems[0];

  var forward = null;
  var forwardIndex = Infinity;
  var backward = null;
  var backwardIndex = -1;
  for (var j = 0; j < visibleItems.length; j++) {
    var candidate = visibleItems[j];
    if (!candidate || !candidate.key || orderByKey[candidate.key] === undefined) continue;
    var idx = orderByKey[candidate.key];
    if (idx > currentIndex && idx < forwardIndex) {
      forward = candidate;
      forwardIndex = idx;
    }
    if (idx < currentIndex && idx > backwardIndex) {
      backward = candidate;
      backwardIndex = idx;
    }
  }
  return forward || backward || visibleItems[0];
}

function syncSelectionWithVisibleMedia(mediaItems) {
  if (!state || !state.currentItem || !state.currentItem.key) return;
  var currentKey = state.currentItem.key;
  var isVisible = Array.isArray(mediaItems) && mediaItems.some(function (item) {
    return item && item.key === currentKey;
  });
  if (isVisible) return;

  if (!Array.isArray(mediaItems) || !mediaItems.length) {
    if (typeof clearEditorAndPreview === 'function') clearEditorAndPreview();
    if (typeof renderChecklistPanel === 'function') renderChecklistPanel();
    if (typeof renderItemMetadataPanel === 'function') renderItemMetadataPanel();
    return;
  }

  var replacement = pickReplacementVisibleMediaItem(currentKey, mediaItems);
  if (!replacement) return;
  selectPathMedia(replacement).catch(function (err) {
    setStatus(String(err && err.message ? err.message : err));
  });
}


function buildSelectedMediaStatus(mediaItem) {
  var suffix = '';
  if (mediaItem && mediaItem.fileName) {
    var parts = mediaItem.fileName.split('.');
    suffix = parts.length > 1 ? parts.pop() : '';
  }
  var status = 'Selected: ' + mediaItem.label + (suffix ? ' (' + suffix + ')' : '');
  if (mediaItem && mediaItem.fileName) {
    var resolution = getResolutionForMedia(mediaItem.fileName);
    if (resolution) {
      status += ' | ' + resolution;
    }
  }
  return status;
}

function getAdvancedStarFilterValues() {
  if (!ui.advancedFilterStarsEl) return [];
  var inputs = ui.advancedFilterStarsEl.querySelectorAll('input[type="checkbox"]:checked');
  var values = Array.prototype.map.call(inputs, function (input) {
    return String(input.value || '').trim().toLowerCase();
  }).filter(Boolean);
  var seen = {};
  var out = [];
  values.forEach(function (key) {
    if (seen[key]) return;
    seen[key] = true;
    out.push(key);
  });
  return out;
}

function getAdvancedStarFilterState() {
  var raw = getAdvancedStarFilterValues();
  var includeNoStar = raw.indexOf('no_star') !== -1;
  var values = raw.map(function (entry) {
    var n = Number(entry);
    if (!isFinite(n)) return 0;
    return Math.max(1, Math.min(5, Math.round(n)));
  }).filter(function (n) {
    return n >= 1 && n <= 5;
  });
  var seen = {};
  var unique = [];
  values.forEach(function (n) {
    var key = String(n);
    if (seen[key]) return;
    seen[key] = true;
    unique.push(n);
  });
  return {
    includeNoStar: includeNoStar,
    values: unique
  };
}

function getAdvancedStarFilterValue() {
  return getAdvancedStarFilterValues().join(',');
}

function getAdvancedFlagFilterValue() {
  if (!ui.advancedFilterFlagEl) return '';
  return getAdvancedFlagFilterValues().join(',');
}

function getAdvancedFlagFilterValues() {
  if (!ui.advancedFilterFlagEl) return [];
  var inputs = ui.advancedFilterFlagEl.querySelectorAll('input[type="checkbox"]:checked');
  return Array.prototype.map.call(inputs, function (input) {
    return String(input.value || '').trim().toLowerCase();
  }).filter(Boolean);
}

function selectPathMedia(mediaItem) {
  return new Promise(function (resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/caption/load?folder=' + encodeURIComponent(state.folder) + '&media=' + encodeURIComponent(mediaItem.fileName), false);
    try {
      xhr.send(null);
    } catch (err) {
      renderFileList();
      reject(err);
      return;
    }

    var text = '';
    if (xhr.status !== 200) {
      renderFileList();
      reject(new Error('Failed to load caption for ' + mediaItem.fileName));
      return;
    }
    try {
      var data = JSON.parse(xhr.responseText);
      text = data.caption || '';
    } catch (e) {
      setStatus('Error parsing caption: ' + e);
      renderFileList();
      reject(e);
      return;
    }
    // Load before committing selection so the editor and save target change together.
    var nextEditorValue = text;
    if (!(text || '').trim()) {
      var primerText = buildAutoPrimer(mediaItem.fileName, mediaItem.key);
      nextEditorValue = primerText || '';
    }
    state.currentItem = mediaItem;
    state.currentConfigFile = null;
    ui.editorEl.removeAttribute('readonly');
    ui.editorEl.value = nextEditorValue;
    renderPathPreview(state.folder, mediaItem.fileName);
    setStatus(buildSelectedMediaStatus(mediaItem));
    updatePreviewActionControls();
    renderChecklistPanel();
    updatePrimerCaptionResetUi();
    // Re-render list to show selection
    renderFileList();
    scrollCurrentMediaRowIntoView();
    updateBalanceDistributionWheel();
    resolve(mediaItem);
  });
}

function reselectCurrentMediaFromPreview() {
  if (!state || !state.currentItem || !ui || !ui.mediaListEl) {
    return false;
  }
  var key = state.currentItem.key;
  if (!key) {
    return false;
  }
  var row = ui.mediaListEl.querySelector('.media-item[data-type="media"][data-key="' + key.replace(/"/g, '\\"') + '"]');
  if (!row) {
    return false;
  }
  // Move focus out of editor inputs and back into list context.
  var activeEl = document.activeElement;
  if (activeEl && typeof isEditableElement === 'function' && isEditableElement(activeEl)) {
    try { activeEl.blur(); } catch (_err) {}
  }
  if (!row.hasAttribute('tabindex')) row.setAttribute('tabindex', '-1');
  try { row.focus({ preventScroll: true }); } catch (_focusErr) { try { row.focus(); } catch (_focusErr2) {} }
  try { row.click(); } catch (_clickErr) {}
  return true;
}


function navigateToDirStackIndex(targetIndex) {
  if (!state.dirStack || !state.dirStack.length) {
    return;
  }
  var idx = Number(targetIndex);
  if (!isFinite(idx)) return;
  idx = Math.max(0, Math.min(state.dirStack.length - 1, Math.floor(idx)));
  if (typeof clearFocusSet === 'function' && state.focusSet && state.focusSet.keys && state.focusSet.keys.length) {
    clearFocusSet();
  }
  state.dirStack = state.dirStack.slice(0, idx + 1);
  state.folder = state.dirStack.slice(1).map(function (entry) { return entry.name; }).join('/');
  // Clear current selection and editor/preview
  state.currentItem = null;
  clearEditorAndPreview();
  if (typeof clearCaptionFilterInputs === 'function') {
    clearCaptionFilterInputs();
  }
  refreshCurrentDirectory();
}

// Backend-based navigation up
function navigateUp() {
  if (!state.dirStack || state.dirStack.length <= 1) {
    setStatus('Already at selected root folder');
    return;
  }
  navigateToDirStackIndex(state.dirStack.length - 2);
}

function renderPathPreview(folder, mediaName) {
  var ext = getFileExtension(mediaName);
  // Add cache-busting timestamp
  var ts = Date.now();
  var mediaUrl = '/caption/media?folder=' + encodeURIComponent(folder) + '&media=' + encodeURIComponent(mediaName) + '&t=' + ts;
  renderPreviewHtml(!!IMAGE_EXTENSIONS[ext], mediaUrl);
}

function renderPreviewHtml(isImage, src) {
  var tag = '';
  if (isImage) {
    tag = '<img src="' + src + '" alt="preview" style="max-width:100%;max-height:100%;object-fit:contain;">';
  } else {
    tag = '' +
      '<div id="video-wrap" style="max-width:100%;max-height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;">' +
      '  <video id="media-video" controls autoplay loop muted playsinline preload="metadata" style="max-width:100%;max-height:100%;">' +
      '    <source src="' + src + '">' +
      '  </video>' +
      '  <div id="video-error" style="display:none;color:#ddd;font:13px system-ui;text-align:center;max-width:420px;">' +
      '    Video failed to load in browser preview. The codec may be unsupported.' +
      '  </div>' +
      '</div>';
  }

  var doc = ui.previewEl.contentDocument || ui.previewEl.contentdocument;
  doc.open();
  doc.write(
    '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;display:flex;align-items:center;justify-content:center;background:#111;height:100vh;">' +
    tag +
    '<script>\n' +
    'function sendPreviewReselect(){\n' +
    '  try {\n' +
    '    if(window.parent && window.parent.postMessage){\n' +
    '      window.parent.postMessage({ type: "media-preview-reselect" }, "*");\n' +
    '    }\n' +
    '  } catch (_err) {}\n' +
    '}\n' +
    'document.addEventListener("click", sendPreviewReselect, true);\n' +
    'function sendPreviewWheelNavigate(deltaY){\n' +
    '  try {\n' +
    '    if(window.parent && window.parent.postMessage){\n' +
    '      window.parent.postMessage({ type: "media-preview-wheel-navigate", deltaY: Number(deltaY) || 0 }, "*");\n' +
    '    }\n' +
    '  } catch (_err) {}\n' +
    '}\n' +
    'document.addEventListener("wheel", function(evt){\n' +
    '  if (!evt) return;\n' +
    '  if (evt.ctrlKey || evt.metaKey || evt.altKey || evt.shiftKey) return;\n' +
    '  var deltaY = (typeof evt.deltaY === "number") ? evt.deltaY : 0;\n' +
    '  if (!deltaY) return;\n' +
    '  try { evt.preventDefault(); } catch (_err) {}\n' +
    '  sendPreviewWheelNavigate(deltaY);\n' +
    '}, { passive: false, capture: true });\n' +
    'var video=document.getElementById("media-video");\n' +
    'if(video){\n' +
    '  var error=document.getElementById("video-error");\n' +
    '  video.addEventListener("error",function(){ if(error){ error.style.display="block"; } });\n' +
    '  var source=video.querySelector("source");\n' +
    '  if(source){ source.addEventListener("error",function(){ if(error){ error.style.display="block"; } }); }\n' +
    '  var p=video.play(); if(p && p.catch){ p.catch(function(){}); }\n' +
    '}\n' +
    '<\/script></body></html>'
  );
  doc.close();
  // Fallback binding from parent context so reselect still works
  // even if iframe inline scripts are blocked or not executed.
  try {
    doc.addEventListener('click', function () {
      if (typeof reselectCurrentMediaFromPreview === 'function') {
        reselectCurrentMediaFromPreview();
      }
    }, true);
  } catch (_bindErr) {}
  try {
    doc.addEventListener('wheel', function (e) {
      if (!e) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      var deltaY = (typeof e.deltaY === 'number') ? e.deltaY : 0;
      if (!deltaY) return;
      if (typeof handlePreviewWheelNavigate === 'function') {
        var handled = handlePreviewWheelNavigate(deltaY);
        if (handled) {
          e.preventDefault();
        }
      }
    }, { passive: false, capture: true });
  } catch (_wheelBindErr) {}
}

async function renderFileList() {
  debugLog('[renderFileList] called. state.items:', state.items, 'state.childFolders:', state.childFolders, 'filterText:', ui.filterEl ? ui.filterEl.value : '');
  var renderSeq = ++state.listRenderSeq;
  ui.mediaListEl.innerHTML = '';
  var mediaItems = getFilteredMediaItems(false);
  var filtersActive = hasAnyActiveMediaFilter();
  if (ui.captionFilterClearAllBtn) {
    ui.captionFilterClearAllBtn.classList.toggle('is-active', filtersActive);
    ui.captionFilterClearAllBtn.setAttribute('aria-pressed', filtersActive ? 'true' : 'false');
  }
  if (ui.createSetFromResultsBtn) {
    var showCreateSetBtn = filtersActive && mediaItems.length > 0;
    ui.createSetFromResultsBtn.classList.toggle('hidden', !showCreateSetBtn);
  }
  // Show count of matching media items, or SuperSet results when that mode is active.
  var countValue = mediaItems.length;
  var countLabel = 'item matches the filter';
  if (state && state.supersetActive) {
    countValue = Array.isArray(state.supersetResults) ? state.supersetResults.length : 0;
    countLabel = countValue === 1 ? 'SuperSet result' : 'SuperSet results';
  } else if (mediaItems.length !== 1) {
    countLabel = 'items match the filter';
  }
  var countText = countValue + ' ' + countLabel;
  if (ui.captionFilterCountTextEl) {
    ui.captionFilterCountTextEl.textContent = countText;
  } else if (ui.captionFilterCount) {
    ui.captionFilterCount.textContent = countText;
  }
  var folderMediaItems = Array.isArray(state.items) ? state.items : [];
  var totalMediaCount = folderMediaItems.length;
  var ratedMediaCount = folderMediaItems.reduce(function (count, item) {
    var rating = (typeof getRatingForMediaKey === 'function') ? getRatingForMediaKey(item && item.key) : 0;
    return count + (rating > 0 ? 1 : 0);
  }, 0);
  var showRatedSummary = !!(ui.captionFilterRatedSummaryEl && state.folder && totalMediaCount > 0);
  if (ui.captionFilterCountSeparatorEl) {
    ui.captionFilterCountSeparatorEl.classList.toggle('hidden', !showRatedSummary);
  }
  if (ui.captionFilterRatedSummaryEl) {
    if (showRatedSummary) {
      ui.captionFilterRatedSummaryEl.textContent = 'Rated ' + ratedMediaCount + '/' + totalMediaCount;
    } else {
      ui.captionFilterRatedSummaryEl.textContent = '';
    }
    ui.captionFilterRatedSummaryEl.classList.toggle('hidden', !showRatedSummary);
  }


  var matchCount = 0;

  // Modern color palette for flags
  // Use centralized FLAG_COLOR_MAP from constants.js
  for (var i = 0; i < state.childFolders.length; ++i) {
    var folderItem = state.childFolders[i];
    var flagColor = state.flags && state.flags[folderItem.name];
    var colorDot = '';
    if (flagColor) {
      colorDot = '<span class="flag-dot flag-dot--' + flagColor + '" style="margin-left:8px;"></span>';
    }
    var label = '🗀 ' + folderItem.name;
    var row = document.createElement('div');
    row.className = 'media-item folder-item';
    row.setAttribute('data-type', 'folder');
    row.setAttribute('data-key', folderItem.name);
    row.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;width:100%"><span>' + label + '</span>' + colorDot + '</div>';
    ui.mediaListEl.appendChild(row);
    matchCount++;
  }

  // Render media items
  mediaItems.forEach(function (mediaItem) {
    var isActive = state.currentItem && state.currentItem.key === mediaItem.key;
    var reviewed = state.reviewedSet.has(mediaItem.key);
    var mutated = isMediaMutated(mediaItem.key);
    var className = 'media-item';
    if (isActive) className += ' active';
    if (reviewed) className += ' reviewed';
    if (mutated) className += ' mutated-media';
    if (!mediaItem.hasCaption) className += ' empty-caption';
    var icon = '';
    var ext = '';
    if (mediaItem.fileName) {
      var dot = mediaItem.fileName.lastIndexOf('.');
      if (dot !== -1) ext = mediaItem.fileName.slice(dot).toLowerCase();
    }
    if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].indexOf(ext) !== -1) {
      icon = '🖼️';
    } else if ([".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"].indexOf(ext) !== -1) {
      icon = '🎬';
    } else if ([".ogg"].indexOf(ext) !== -1) {
      icon = '🎵';
    } else {
      icon = '📄';
    }
    var flagColor = state.flags && state.flags[mediaItem.key];
    var colorDot = '';
    if (flagColor) {
      colorDot = '<span class="flag-dot flag-dot--' + flagColor + '" style="margin-left:8px;"></span>';
    }
    var displayText = mediaItem.label;
    var row = document.createElement('div');
    row.className = className;
    row.setAttribute('data-type', 'media');
    row.setAttribute('data-key', mediaItem.key);
    row.innerHTML =
      '<div class="media-item-main">' +
        '<span class="media-item-main-label">' + icon + '&nbsp;' + escapeHtml(displayText) + '</span>' +
        '<span class="media-item-main-right">' + colorDot + '</span>' +
      '</div>';
    ui.mediaListEl.appendChild(row);
    matchCount++;
  });

  syncSelectionWithVisibleMedia(mediaItems);
  updatePreviewActionControls();
  updateBalanceDistributionWheel();
  if (typeof updateFocusSetUi === 'function') {
    updateFocusSetUi();
  }
  if (typeof updateSuperSetControls === 'function') {
    updateSuperSetControls();
  }
}

function updateFlagDotForItem(itemKey, color) {
  var sel = '[data-key="' + itemKey.replace(/"/g, '\"') + '"]';
  var itemEls = Array.prototype.slice.call(document.querySelectorAll('.media-item' + sel));
  if (!itemEls.length) {
    itemEls = Array.prototype.slice.call(document.querySelectorAll('.folder-item' + sel));
  }
  itemEls.forEach(function(row) {
    var dots = row.querySelectorAll('.flag-dot');
    dots.forEach(function(dot) { dot.parentNode.removeChild(dot); });
    if (color) {
      var dot = document.createElement('span');
      dot.className = 'flag-dot flag-dot--' + color;
      row.querySelector('div').appendChild(dot);
    }
  });
}

function setFlagValueForItem(itemKey, color, options) {
  var opts = options || {};
  debugLog('[setFlagValueForItem] itemKey:', itemKey, 'color:', color, 'options:', opts, 'state.folder:', state.folder);
  if (!state.flags || typeof state.flags !== 'object') {
    state.flags = {};
  }
  var previous = String((state.flags && state.flags[itemKey]) || '').trim();
  var next = String(color || '').trim();
  if (!opts.skipUndo && previous !== next && typeof recordUndoOperation === 'function') {
    recordUndoOperation({
      type: 'flag',
      itemKey: itemKey,
      previousFlag: previous,
      nextFlag: next
    });
  }
  if (color) {
    state.flags[itemKey] = color;
  } else {
    delete state.flags[itemKey];
  }
  if (!opts.skipSave) {
    saveFlags();
  }
  updateFlagDotForItem(itemKey, color);
  // Do NOT refresh the directory or clear selection
}

// File/Folder Flags
function markFlag(itemKey, color) {
  setFlagValueForItem(itemKey, color, { skipUndo: false, skipSave: false });
}

function saveFlags() {
  // Save the full folder state (including flags, reviewedKeys, stats, primer, etc.)
  var folderPath = state.folder || '';
  var snapshot = snapshotFolderStateFromDom();
  debugLog('[saveFlags] folderPath:', folderPath, 'snapshot:', snapshot);
  writeFolderStateFile(folderPath, snapshot);
}
