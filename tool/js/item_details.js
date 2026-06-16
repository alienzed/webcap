// Per-item tags and metadata loading
var captionItemTagsByMedia = {};
var itemTagsClipboard = [];
var mediaMetadataLoading = false;
var debouncedItemTagsSave = debounceCreate(300);
var debouncedItemRatingSave = debounceCreate(250);

function isMediaMetadataLoading() {
  return !!mediaMetadataLoading;
}

window.isMediaMetadataLoading = isMediaMetadataLoading;

function normalizeItemTag(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

function getTagsForMediaKey(mediaKey) {
  var tags = captionItemTagsByMedia[mediaKey];
  return Array.isArray(tags) ? tags.slice() : [];
}

function getTagClipboardTags() {
  return Array.isArray(itemTagsClipboard) ? itemTagsClipboard.slice() : [];
}

function hasTagClipboardTags() {
  return getTagClipboardTags().length > 0;
}

function updateTagClipboardUi() {
  var copyBtn = ui && ui.itemTagsCopyBtnEl;
  var pasteBtn = ui && ui.itemTagsPasteBtnEl;
  var hasSelection = !!(state && state.currentItem && state.currentItem.key);
  var clipboardTags = getTagClipboardTags();
  var clipboardCount = clipboardTags.length;
  if (copyBtn) {
    copyBtn.disabled = !hasSelection;
  }
  if (pasteBtn) {
    pasteBtn.classList.toggle('hidden', clipboardCount <= 0);
    pasteBtn.disabled = !hasSelection || clipboardCount <= 0;
    pasteBtn.title = clipboardCount > 0
      ? 'Paste ' + clipboardCount + ' copied tag' + (clipboardCount === 1 ? '' : 's')
      : 'Paste copied tags';
  }
}

function copyTagsForMediaKey(mediaKey) {
  var key = String(mediaKey || '').trim();
  if (!key) {
    setStatus('No media item selected to copy tags.');
    return false;
  }
  var tags = getTagsForMediaKey(key)
    .map(function (tag) { return normalizeItemTag(tag); })
    .filter(Boolean);
  if (!tags.length) {
    setStatus('No tags to copy.');
    return false;
  }
  itemTagsClipboard = tags.slice();
  updateTagClipboardUi();
  setStatus('Copied ' + tags.length + ' tag' + (tags.length === 1 ? '' : 's') + '.');
  return true;
}

function copyCurrentItemTagsToClipboard() {
  if (!state || !state.currentItem || !state.currentItem.key) {
    setStatus('Select a media item to copy tags.');
    return false;
  }
  return copyTagsForMediaKey(state.currentItem.key);
}

function mergeTagsIntoMediaKey(mediaKey, rawTags) {
  var key = String(mediaKey || '').trim();
  var incoming = Array.isArray(rawTags) ? rawTags : [];
  if (!key || !incoming.length) {
    return { added: 0, alreadyPresent: 0 };
  }
  var shouldSyncTemplate = shouldLiveSyncEditorToTemplateForMediaKey(key);
  var current = getTagsForMediaKey(key);
  var seen = {};
  current.forEach(function (tag) {
    var low = normalizeItemTag(tag).toLowerCase();
    if (low) seen[low] = true;
  });
  var next = current.slice();
  var added = 0;
  var alreadyPresent = 0;
  incoming.forEach(function (rawTag) {
    var tag = normalizeItemTag(rawTag);
    var low = tag.toLowerCase();
    if (!tag) return;
    if (seen[low]) {
      alreadyPresent += 1;
      return;
    }
    seen[low] = true;
    next.push(tag);
    if (typeof commitChecklistDescriptorSnapshotForMediaKey === 'function') {
      commitChecklistDescriptorSnapshotForMediaKey(key, tag);
    }
    ensureCaptionHelperPhraseInCatalog(tag, true);
    added += 1;
  });
  if (!added) {
    return { added: 0, alreadyPresent: alreadyPresent };
  }
  captionItemTagsByMedia[key] = next;
  saveItemTagsToFolderState();
  refreshTagDrivenPanelsForMediaKey(key);
  if (shouldSyncTemplate) {
    syncEditorToCurrentTemplatePreview();
  }
  return { added: added, alreadyPresent: alreadyPresent };
}

function pasteClipboardTagsToMediaKey(mediaKey) {
  var key = String(mediaKey || '').trim();
  var clipboardTags = getTagClipboardTags();
  if (!key) {
    setStatus('No media item selected to paste tags into.');
    return false;
  }
  if (!clipboardTags.length) {
    setStatus('No copied tags to paste.');
    return false;
  }
  if (!confirm('Merge ' + clipboardTags.length + ' copied tag' + (clipboardTags.length === 1 ? '' : 's') + ' into this item?')) {
    setStatus('Paste tags cancelled.');
    return false;
  }
  var result = mergeTagsIntoMediaKey(key, clipboardTags);
  updateTagClipboardUi();
  setStatus('Merged ' + result.added + ' tag' + (result.added === 1 ? '' : 's') + ' (' + result.alreadyPresent + ' already present).');
  return true;
}

function pasteClipboardTagsToCurrentItem() {
  if (!state || !state.currentItem || !state.currentItem.key) {
    setStatus('Select a media item to paste tags into.');
    return false;
  }
  return pasteClipboardTagsToMediaKey(state.currentItem.key);
}

function canonicalizeMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPluralTokenVariants(token) {
  var t = String(token || '').toLowerCase().trim();
  if (!t) return [];
  var out = [t];
  var seen = {};
  function push(v) {
    var key = String(v || '').trim();
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push(key);
  }
  seen[t] = true;

  // Plural -> singular
  if (t.length > 3 && t.slice(-3) === 'ies') push(t.slice(0, -3) + 'y');
  if (t.length > 2 && t.slice(-2) === 'es') push(t.slice(0, -2));
  if (t.length > 1 && t.slice(-1) === 's') push(t.slice(0, -1));

  // Singular -> plural
  if (t.length > 1 && t.slice(-1) === 'y') push(t.slice(0, -1) + 'ies');
  push(t + 's');
  push(t + 'es');

  return out;
}

function captionContainsTagWithAllowances(captionText, tagText) {
  var captionTokens = canonicalizeMatchText(captionText).split(' ').filter(Boolean);
  var tagTokens = canonicalizeMatchText(tagText).split(' ').filter(Boolean);
  if (!captionTokens.length || !tagTokens.length) return false;
  if (captionTokens.length < tagTokens.length) return false;

  var lastIdx = tagTokens.length - 1;
  var lastTokenVariants = {};
  buildPluralTokenVariants(tagTokens[lastIdx]).forEach(function (variant) {
    lastTokenVariants[variant] = true;
  });

  for (var i = 0; i <= captionTokens.length - tagTokens.length; i += 1) {
    var matched = true;
    for (var j = 0; j < tagTokens.length; j += 1) {
      var expected = tagTokens[j];
      var actual = captionTokens[i + j];
      if (j === lastIdx) {
        if (!lastTokenVariants[actual]) {
          matched = false;
          break;
        }
      } else if (actual !== expected) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

function tagAppearsInCurrentCaption(tagText) {
  var tag = normalizeItemTag(tagText);
  if (!tag) return false;
  var captionText = '';
  if (ui && ui.editorEl && typeof ui.editorEl.value === 'string') {
    captionText = ui.editorEl.value;
  } else if (state && state.currentItem && typeof state.currentItem.caption === 'string') {
    captionText = state.currentItem.caption;
  }
  var rendered = renderChecklistTermWithAffixes(tag, state && state.currentItem ? state.currentItem.key : '');
  if (rendered && rendered.toLowerCase() !== tag.toLowerCase() && captionContainsPhrase(captionText, rendered)) {
    return true;
  }
  return captionContainsTagWithAllowances(captionText, tag);
}

function hasTagForMediaKey(mediaKey, tagText) {
  var target = String(tagText || '').trim().toLowerCase();
  if (!mediaKey || !target) return false;
  var tags = getTagsForMediaKey(mediaKey);
  for (var i = 0; i < tags.length; i++) {
    if (String(tags[i] || '').trim().toLowerCase() === target) return true;
  }
  return false;
}

function getMediaItemByFileName(fileName) {
  var target = String(fileName || '');
  if (!target || typeof state === 'undefined' || !Array.isArray(state.items)) return null;
  for (var i = 0; i < state.items.length; i++) {
    var item = state.items[i];
    if (!item || item.fileName !== target) continue;
    return item;
  }
  return null;
}

function getMetadataForMedia(fileName) {
  var item = getMediaItemByFileName(fileName);
  if (!item || !item.metadata) return null;
  return item.metadata;
}

function getResolutionForMedia(fileName) {
  var row = getMetadataForMedia(fileName);
  if (!row || !row.resolution || row.resolution === '-') return '';
  return String(row.resolution);
}

function normalizeRatingValue(value) {
  var n = Number(value);
  if (!isFinite(n)) return 0;
  var rating = Math.round(n);
  if (rating < 0) rating = 0;
  if (rating > 5) rating = 5;
  return rating;
}

function getRatingForMediaKey(mediaKey) {
  if (!mediaKey || !state || typeof state.ratings !== 'object' || !state.ratings) return 0;
  return normalizeRatingValue(state.ratings[mediaKey]);
}

function parseRequirementProgressTerms(raw) {
  var seen = {};
  return String(raw || '')
    .split(',')
    .map(function (part) { return normalizeItemTag(part); })
    .filter(function (term) {
      var key = String(term || '').toLowerCase();
      if (!term || seen[key]) return false;
      seen[key] = true;
      return true;
    });
}

function computeRequirementProgressForMediaKey(mediaKey) {
  var requirements = Array.isArray(checklistItems) ? checklistItems : [];
  var completed = 0;
  var total = 0;
  var missing = [];
  for (var i = 0; i < requirements.length; i++) {
    var requirementLabel = String(requirements[i] || '').trim();
    if (!requirementLabel) continue;
    var terms = parseRequirementProgressTerms(getChecklistKeywordTermsForRequirement(requirementLabel).join(', '));
    if (!terms.length) continue;
    total += 1;
    var isNa = (typeof isChecklistRequirementNaForMediaKey === 'function')
      ? isChecklistRequirementNaForMediaKey(mediaKey, requirementLabel)
      : false;
    if (isNa) {
      completed += 1;
      continue;
    }
    var hasMatch = terms.some(function (term) {
      return hasTagForMediaKey(mediaKey, term);
    });
    if (hasMatch) {
      completed += 1;
    } else {
      missing.push(requirementLabel + ' (' + terms.join(', ') + ')');
    }
  }
  return { completed: completed, total: total, missing: missing };
}

function computeReviewedProgressForMediaKey(mediaKey) {
  var requirements = Array.isArray(checklistItems) ? checklistItems : [];
  var checkedMap = (typeof getChecklistCheckedMapForMediaKey === 'function')
    ? getChecklistCheckedMapForMediaKey(mediaKey)
    : {};
  var completed = 0;
  var total = 0;
  var missing = [];
  for (var requirementIdx = 0; requirementIdx < requirements.length; requirementIdx++) {
    var requirementLabel = String(requirements[requirementIdx] || '').trim();
    if (!requirementLabel) continue;
    total += 1;
    var isNa = (typeof isChecklistRequirementNaForMediaKey === 'function')
      ? isChecklistRequirementNaForMediaKey(mediaKey, requirementLabel)
      : false;
    if (checkedMap[requirementLabel] || isNa) {
      completed += 1;
    } else {
      missing.push(requirementLabel);
    }
  }
  return { completed: completed, total: total, missing: missing };
}

function getCurrentCaptionTextForMatch() {
  if (ui && ui.editorEl && typeof ui.editorEl.value === 'string') {
    return ui.editorEl.value;
  }
  if (state && state.currentItem && typeof state.currentItem.caption === 'string') {
    return state.currentItem.caption;
  }
  return '';
}

function getUniqueNormalizedTagsForMediaKey(mediaKey) {
  var seen = {};
  return getTagsForMediaKey(mediaKey).map(function (tag) {
    return normalizeItemTag(tag);
  }).filter(function (tag) {
    var key = tag.toLowerCase();
    if (!tag || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function computeTagMatchProgressForText(mediaKey, captionText) {
  var tags = getUniqueNormalizedTagsForMediaKey(mediaKey);
  var completed = 0;
  var missing = [];
  for (var tagIdx = 0; tagIdx < tags.length; tagIdx++) {
    var tag = tags[tagIdx];
    var rendered = (typeof renderChecklistTermWithAffixes === 'function')
      ? renderChecklistTermWithAffixes(tag, mediaKey)
      : tag;
    if (
      (rendered && captionContainsPhrase(captionText, rendered)) ||
      captionContainsTagWithAllowances(captionText, tag)
    ) {
      completed += 1;
    } else {
      missing.push(tag);
    }
  }
  return { completed: completed, total: tags.length, missing: missing };
}

function computeTagMatchProgressForMediaKey(mediaKey) {
  return computeTagMatchProgressForText(mediaKey, getCurrentCaptionTextForMatch());
}

function formatProgressTooltip(progress, emptyText, completeText, missingPrefix) {
  if (!progress || progress.total <= 0) return emptyText;
  if (!progress.missing || !progress.missing.length) return completeText;
  return missingPrefix + progress.missing.join(', ');
}

function appendMetadataProgressRow(listEl, label, progress, options) {
  var row = document.createElement('div');
  row.className = 'item-metadata-row';
  var labelEl = document.createElement('strong');
  labelEl.textContent = label;
  var valueEl = document.createElement('span');
  valueEl.textContent = String(progress.completed) + '/' + String(progress.total);
  valueEl.title = formatProgressTooltip(
    progress,
    options.emptyText,
    options.completeText,
    options.missingPrefix
  );
  if (progress.total > 0) {
    valueEl.classList.add(progress.completed >= progress.total ? 'item-metadata-value-ok' : 'item-metadata-value-error');
  } else if (options.emptyIsError) {
    valueEl.classList.add('item-metadata-value-error');
  }
  row.appendChild(labelEl);
  row.appendChild(valueEl);
  listEl.appendChild(row);
}

function saveItemRatingsToFolderState() {
  var snapshot = snapshotFolderStateFromDom();
  writeFolderStateFile(state.folder, snapshot);
}

function setRatingForMediaKey(mediaKey, rating) {
  if (!mediaKey) return;
  if (!state.ratings || typeof state.ratings !== 'object') {
    state.ratings = {};
  }
  var previous = getRatingForMediaKey(mediaKey);
  var next = normalizeRatingValue(rating);
  if (previous !== next && typeof recordUndoOperation === 'function') {
    recordUndoOperation({
      type: 'rating',
      mediaKey: mediaKey,
      previousRating: previous,
      nextRating: next
    });
  }
  if (next <= 0) {
    delete state.ratings[mediaKey];
  } else {
    state.ratings[mediaKey] = next;
  }
  debouncedItemRatingSave(saveItemRatingsToFolderState);
  renderItemMetadataPanel();
  renderFileList();
}

function renderItemMetadataPanel() {
  renderItemAnalysisPanel();
  var listEl = document.getElementById('item-metadata-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  if (!state.currentItem || !state.currentItem.fileName) {
    listEl.textContent = 'Select a media item.';
    return;
  }

  var currentMediaKey = state.currentItem.key || state.currentItem.fileName;
  var currentRating = getRatingForMediaKey(currentMediaKey);
  var starsRow = document.createElement('div');
  starsRow.className = 'item-metadata-stars-row';
  for (var s = 1; s <= 5; s++) {
    (function (value) {
      var starBtn = document.createElement('button');
      starBtn.type = 'button';
      starBtn.className = 'item-metadata-star-btn' + (value <= currentRating ? ' active' : '');
      starBtn.setAttribute('aria-label', 'Set rating to ' + value + ' stars');
      starBtn.title = 'Set rating to ' + value + ' stars';
      starBtn.textContent = value <= currentRating ? '\u2605' : '\u2606';
      starBtn.onclick = function () {
        setRatingForMediaKey(currentMediaKey, value);
      };
      starsRow.appendChild(starBtn);
    })(s);
  }
  listEl.appendChild(starsRow);

  var row = getMetadataForMedia(state.currentItem.fileName);
  var progress = computeRequirementProgressForMediaKey(currentMediaKey);
  var reviewedProgress = computeReviewedProgressForMediaKey(currentMediaKey);
  var tagMatchProgress = computeTagMatchProgressForMediaKey(currentMediaKey);
  var appendProgressRows = function () {
    appendMetadataProgressRow(listEl, 'Requirement Progress', progress, {
      emptyText: 'No requirement groups with configured terms.',
      completeText: 'All requirement groups completed.',
      missingPrefix: 'Missing requirement groups: '
    });
    appendMetadataProgressRow(listEl, 'Reviewed Progress', reviewedProgress, {
      emptyText: 'No review groups configured.',
      completeText: 'All review groups checked.',
      missingPrefix: 'Unchecked review groups: '
    });
    appendMetadataProgressRow(listEl, 'Tag Match', tagMatchProgress, {
      emptyText: 'No item tags.',
      completeText: 'All item tags are found in the caption.',
      missingPrefix: 'Tags not found in caption: ',
      emptyIsError: true
    });
  };

  if (!row) {
    var unavailable = document.createElement('div');
    unavailable.textContent = 'Metadata unavailable.';
    listEl.appendChild(unavailable);
    appendProgressRows();
    return;
  }
  var fieldOrder = [
    ['resolution', 'Resolution'],
    ['size', 'Size'],
    ['aspect', 'Aspect'],
    ['scene_complexity_label', 'Scene Complexity'],
    ['fps', 'FPS'],
    ['duration', 'Duration'],
    ['frames', 'Frames'],
    ['codec', 'Codec'],
    // ['bitrate', 'Bitrate'],
    // ['color', 'Color'],
  ];
  var hasAny = false;
  for (var i = 0; i < fieldOrder.length; i++) {
    var key = fieldOrder[i][0];
    var label = fieldOrder[i][1];
    var value = row[key];
    if (value === undefined || value === null) continue;
    var text = String(value).trim();
    if (!text || text === '-') continue;
    hasAny = true;
    var itemRow = document.createElement('div');
    itemRow.className = 'item-metadata-row';
    var labelEl = document.createElement('strong');
    labelEl.textContent = label;
    var valueEl = document.createElement('span');
    valueEl.textContent = text;
    if (key === 'aspect' && typeof hasSupportedAspectBucket === 'function' && !hasSupportedAspectBucket(text)) {
      valueEl.classList.add('item-metadata-value-error');
      valueEl.title = 'Aspect ratio is outside supported buckets (square, 4:3, 3:4, 16:9, 9:16).';
    } else if (key === 'scene_complexity_label') {
      var sceneComplexity = (typeof getSceneComplexityFromMetadata === 'function') ? getSceneComplexityFromMetadata(row) : null;
      if (sceneComplexity && sceneComplexity.error) {
        valueEl.classList.add('item-metadata-value-error');
        valueEl.title = String(sceneComplexity.error);
      }
    }
    itemRow.appendChild(labelEl);
    itemRow.appendChild(valueEl);
    listEl.appendChild(itemRow);
  }
  if (!hasAny) {
    var unavailable2 = document.createElement('div');
    unavailable2.textContent = 'Metadata unavailable.';
    listEl.appendChild(unavailable2);
  }
  appendProgressRows();
}

function appendItemPanelSectionTitle(listEl, title) {
  var heading = document.createElement('div');
  heading.className = 'item-panel-section-title';
  heading.textContent = title;
  listEl.appendChild(heading);
}

function appendItemPanelEmptyRow(listEl, text) {
  var empty = document.createElement('div');
  empty.className = 'item-panel-empty';
  empty.textContent = text;
  listEl.appendChild(empty);
}

function buildQaFileFocusList(fileNames) {
  var seen = {};
  var files = [];
  (Array.isArray(fileNames) ? fileNames : []).forEach(function (fileName) {
    var text = String(fileName || '').trim();
    if (!text || seen[text]) return;
    seen[text] = true;
    files.push(text);
  });
  return files;
}

function appendQaFileLinks(containerEl, fileNames, focusFiles, source) {
  var files = buildQaFileFocusList(fileNames);
  if (!files.length) return;
  var focus = buildQaFileFocusList(focusFiles && focusFiles.length ? focusFiles : files);
  var wrap = document.createElement('div');
  wrap.className = 'item-analysis-file-links';
  var labelEl = document.createElement('span');
  labelEl.className = 'item-analysis-file-links-label';
  labelEl.textContent = 'Files:';
  wrap.appendChild(labelEl);

  var maxShown = 4;
  files.slice(0, maxShown).forEach(function (fileName, index) {
    if (index > 0) {
      var separator = document.createElement('span');
      separator.className = 'item-analysis-file-links-separator';
      separator.textContent = ',';
      wrap.appendChild(separator);
    }
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'item-analysis-file-link';
    btn.textContent = fileName;
    btn.title = 'Open ' + fileName + (focus.length > 1 ? ' and focus the related files' : '');
    btn.addEventListener('mousedown', function (e) {
      e.preventDefault();
    });
    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      selectByFileName(fileName, focus, source || 'Quality Assurance');
      
    };
    wrap.appendChild(btn);
  });

  if (files.length > maxShown) {
    var more = document.createElement('span');
    more.className = 'item-analysis-file-links-more';
    more.textContent = ' +' + (files.length - maxShown) + ' more';
    wrap.appendChild(more);
  }

  containerEl.appendChild(wrap);
}

function appendQaTagSuggestions(containerEl, suggestions) {
  var tags = buildQaFileFocusList(suggestions);
  if (!tags.length) return;

  var wrap = document.createElement('div');
  wrap.className = 'item-analysis-tag-suggestions';

  var labelEl = document.createElement('span');
  labelEl.className = 'item-analysis-tag-suggestions-label';
  labelEl.textContent = 'Add:';
  wrap.appendChild(labelEl);

  tags.forEach(function (tag, index) {
    if (index > 0) {
      var separator = document.createElement('span');
      separator.className = 'item-analysis-tag-suggestions-separator';
      separator.textContent = ',';
      wrap.appendChild(separator);
    }

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'phrase-copy-item-btn item-tag-pill-suggested item-analysis-tag-suggestion';
    btn.textContent = tag;
    btn.title = 'Add suggested tag';
    btn.addEventListener('mousedown', function (e) {
      e.preventDefault();
    });
    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof addTagToCurrentMedia === 'function') {
        addTagToCurrentMedia(tag);
      }
    };
    wrap.appendChild(btn);
  });

  containerEl.appendChild(wrap);
}

function appendQaSignalRow(listEl, severity, label, text, isPositive, options) {
  var row = document.createElement('div');
  row.className = 'item-metadata-row' + (isPositive ? '' : ' item-analysis-warning-row');
  var labelEl = document.createElement('strong');
  labelEl.textContent = severity + ' - ' + label;
  var bodyEl = document.createElement('div');
  bodyEl.className = 'item-analysis-signal-body';
  var valueEl = document.createElement('span');
  valueEl.className = isPositive ? 'item-metadata-value-ok' : 'item-metadata-value-error';
  valueEl.textContent = text;
  bodyEl.appendChild(valueEl);
  if (options && options.fileNames && options.fileNames.length) {
    appendQaFileLinks(bodyEl, options.fileNames, options.focusFiles, options.focusSource);
  }
  if (options && options.suggestions && options.suggestions.length) {
    appendQaTagSuggestions(bodyEl, options.suggestions);
  }
  row.appendChild(labelEl);
  row.appendChild(bodyEl);
  listEl.appendChild(row);
}

function normalizeTagsForQa(tags) {
  var out = [];
  var seen = {};
  (Array.isArray(tags) ? tags : []).forEach(function (tag) {
    var clean = normalizeItemTag(tag).toLowerCase();
    if (!clean || seen[clean]) return;
    seen[clean] = true;
    out.push(clean);
  });
  return out;
}

function buildQaTagNeighborRows(mediaKey) {
  var currentTags = normalizeTagsForQa(getTagsForMediaKey(mediaKey));
  var rows = [];
  if (!currentTags.length || !state || !Array.isArray(state.items)) {
    return { currentTags: currentTags, rows: rows };
  }
  state.items.forEach(function (item) {
    if (!item || !item.key || item.key === mediaKey) return;
    var otherTags = normalizeTagsForQa(getTagsForMediaKey(item.key));
    if (!otherTags.length) return;
    var otherLookup = {};
    otherTags.forEach(function (tag) { otherLookup[tag] = true; });
    var shared = currentTags.filter(function (tag) { return !!otherLookup[tag]; });
    if (!shared.length) return;
    var unionLookup = {};
    currentTags.forEach(function (tag) { unionLookup[tag] = true; });
    otherTags.forEach(function (tag) { unionLookup[tag] = true; });
    var unionCount = Object.keys(unionLookup).length;
    rows.push({
      item: item,
      otherTags: otherTags,
      sharedTags: shared,
      sharedCount: shared.length,
      overlapCurrent: shared.length / currentTags.length,
      overlapOther: shared.length / otherTags.length,
      jaccard: unionCount ? (shared.length / unionCount) : 0
    });
  });
  rows.sort(function (a, b) {
    return (
      b.overlapCurrent - a.overlapCurrent ||
      b.sharedCount - a.sharedCount ||
      b.overlapOther - a.overlapOther ||
      a.item.fileName.localeCompare(b.item.fileName)
    );
  });
  return { currentTags: currentTags, rows: rows };
}

function computeQaSimilaritySignal(mediaKey) {
  var summary = buildQaTagNeighborRows(mediaKey);
  var currentTags = summary.currentTags;
  var neighbors = summary.rows;
  if (currentTags.length < 2) return null;
  var strong = neighbors.filter(function (row) {
    return row.sharedCount >= 2 && row.overlapCurrent >= 0.67 && row.overlapOther >= 0.67;
  });
  if (!strong.length) return null;
  var sharedCounts = {};
  strong.forEach(function (row) {
    row.sharedTags.forEach(function (tag) {
      sharedCounts[tag] = (sharedCounts[tag] || 0) + 1;
    });
  });
  var sharedSummary = Object.keys(sharedCounts)
    .sort(function (a, b) { return sharedCounts[b] - sharedCounts[a] || a.localeCompare(b); })
    .slice(0, 4);
  var fileNames = strong.slice(0, 3).map(function (row) { return row.item.fileName; });
  var focusFiles = strong.map(function (row) { return row.item.fileName; });
  return {
    severity: 'Check',
    label: strong.length > 1 ? 'Similar Cluster' : 'Very Similar Item',
    text:
      (strong.length > 1 ? 'Starting to look a lot like ' + strong.length + ' other items.' : 'Very similar tag set found in another item.') +
      ' Shared tags: ' + sharedSummary.join(', ') + '.',
    fileNames: fileNames,
    focusFiles: focusFiles,
    focusSource: 'Quality Assurance'
  };
}

function computeQaMissingTagSignal(mediaKey) {
  var summary = buildQaTagNeighborRows(mediaKey);
  var currentTags = summary.currentTags;
  var neighbors = summary.rows.filter(function (row) {
    return row.sharedCount >= 2 && row.overlapCurrent >= 0.5;
  }).slice(0, 6);
  if (currentTags.length < 2 || neighbors.length < 2) return null;
  var currentLookup = {};
  currentTags.forEach(function (tag) { currentLookup[tag] = true; });
  var counts = {};
  neighbors.forEach(function (row) {
    row.otherTags.forEach(function (tag) {
      if (currentLookup[tag]) return;
      counts[tag] = (counts[tag] || 0) + 1;
    });
  });
  var minSupport = Math.max(2, Math.ceil(neighbors.length * 0.75));
  var suggestions = Object.keys(counts)
    .filter(function (tag) { return counts[tag] >= minSupport; })
    .sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); })
    .slice(0, 4);
  if (!suggestions.length) return null;
  var summaryBits = suggestions.map(function (tag) {
    return tag + ' (' + counts[tag] + '/' + neighbors.length + ')';
  });
  var evidenceFiles = neighbors.slice(0, 4).map(function (row) { return row.item.fileName; });
  var focusFiles = neighbors.map(function (row) { return row.item.fileName; });
  return {
    severity: 'Info',
    label: suggestions.length === 1 ? 'Likely Missing Tag' : 'Likely Missing Tags',
    text: 'Similar items often also include: ' + summaryBits.join(', ') + '.',
    suggestions: suggestions,
    fileNames: evidenceFiles,
    focusFiles: focusFiles,
    focusSource: 'Quality Assurance'
  };
}

function renderItemAnalysisPanel() {
  var listEl = document.getElementById('item-analysis-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  if (!state.currentItem || !state.currentItem.fileName) {
    listEl.textContent = 'Select a media item.';
    return;
  }

  var mediaKey = state.currentItem.key || state.currentItem.fileName;
  var similaritySignal = computeQaSimilaritySignal(mediaKey);
  var missingTagSignal = computeQaMissingTagSignal(mediaKey);
  var currentTags = normalizeTagsForQa(getTagsForMediaKey(mediaKey));

  appendItemPanelSectionTitle(listEl, 'Similarity');
  if (similaritySignal) {
    appendQaSignalRow(
      listEl,
      similaritySignal.severity,
      similaritySignal.label,
      similaritySignal.text,
      false,
      similaritySignal
    );
  } else if (currentTags.length < 2) {
    appendItemPanelEmptyRow(listEl, 'Add at least 2 tags to compare this item against the set.');
  } else {
    appendItemPanelEmptyRow(listEl, 'No strong tag-similarity cluster detected.');
  }

  appendItemPanelSectionTitle(listEl, 'Suggestions');
  if (missingTagSignal) {
    appendQaSignalRow(
      listEl,
      missingTagSignal.severity,
      missingTagSignal.label,
      missingTagSignal.text,
      true,
      missingTagSignal
    );
  } else if (currentTags.length < 2) {
    appendItemPanelEmptyRow(listEl, 'Tag suggestions appear once this item has a clearer tag footprint.');
  } else {
    appendItemPanelEmptyRow(listEl, 'No likely missing tags inferred from similar items.');
  }
}

function saveItemTagsToFolderState() {
  var snapshot = snapshotFolderStateFromDom();
  snapshot.caption_tags_by_media = JSON.parse(JSON.stringify(captionItemTagsByMedia || {}));
  writeFolderStateFile(state.folder, snapshot);
}

function shouldLiveSyncEditorToTemplateForMediaKey(mediaKey) {
  return !!(
    state &&
    state.currentItem &&
    state.currentItem.key &&
    state.currentItem.key === mediaKey &&
    !state.currentItem.hasCaption &&
    ui &&
    ui.editorEl &&
    !ui.editorEl.readOnly
  );
}

function syncEditorToCurrentTemplatePreview() {
  refreshCurrentPrimerDerivedUi();
}

function refreshTagDrivenPanelsForMediaKey(mediaKey) {
  var key = String(mediaKey || '').trim();
  renderFileList();
  updateBalanceDistributionWheel();
  if (state && state.currentItem && state.currentItem.key === key && typeof renderChecklistPanel === 'function') {
    renderChecklistPanel();
    return;
  }
  renderItemTagsPanel();
  renderItemMetadataPanel();
  renderAnnotateStrip();
}

function updateTagOrderForMediaKey(mediaKey, nextTags) {
  var key = String(mediaKey || '').trim();
  var next = Array.isArray(nextTags) ? nextTags.slice() : [];
  if (!key || !next.length) return false;
  var shouldSyncTemplate = shouldLiveSyncEditorToTemplateForMediaKey(key);
  captionItemTagsByMedia[key] = next;
  saveItemTagsToFolderState();
  refreshTagDrivenPanelsForMediaKey(key);
  if (shouldSyncTemplate) {
    refreshCurrentPrimerDerivedUi();
  }
  return true;
}

function moveTagUpForMediaKey(mediaKey, tagText) {
  var key = String(mediaKey || '').trim();
  var target = normalizeItemTag(tagText).toLowerCase();
  if (!key || !target) return false;
  var current = getTagsForMediaKey(key);
  if (current.length < 2) return false;
  var idx = -1;
  for (var i = 0; i < current.length; i++) {
    if (normalizeItemTag(current[i]).toLowerCase() === target) {
      idx = i;
      break;
    }
  }
  if (idx <= 0) return false;
  var next = current.slice();
  var temp = next[idx - 1];
  next[idx - 1] = next[idx];
  next[idx] = temp;
  return updateTagOrderForMediaKey(key, next);
}

function moveTagDownForMediaKey(mediaKey, tagText) {
  var key = String(mediaKey || '').trim();
  var target = normalizeItemTag(tagText).toLowerCase();
  if (!key || !target) return false;
  var current = getTagsForMediaKey(key);
  if (current.length < 2) return false;
  var idx = -1;
  for (var i = 0; i < current.length; i++) {
    if (normalizeItemTag(current[i]).toLowerCase() === target) {
      idx = i;
      break;
    }
  }
  if (idx < 0 || idx >= current.length - 1) return false;
  var next = current.slice();
  var temp = next[idx + 1];
  next[idx + 1] = next[idx];
  next[idx] = temp;
  return updateTagOrderForMediaKey(key, next);
}

function swapTagOrderForMediaKey(mediaKey, firstTagText, secondTagText) {
  var key = String(mediaKey || '').trim();
  var firstTarget = normalizeItemTag(firstTagText).toLowerCase();
  var secondTarget = normalizeItemTag(secondTagText).toLowerCase();
  if (!key || !firstTarget || !secondTarget || firstTarget === secondTarget) return false;
  var current = getTagsForMediaKey(key);
  if (current.length < 2) return false;
  var firstIdx = -1;
  var secondIdx = -1;
  for (var i = 0; i < current.length; i++) {
    var currentTag = normalizeItemTag(current[i]).toLowerCase();
    if (currentTag === firstTarget && firstIdx < 0) firstIdx = i;
    if (currentTag === secondTarget && secondIdx < 0) secondIdx = i;
  }
  if (firstIdx < 0 || secondIdx < 0 || firstIdx === secondIdx) return false;
  var next = current.slice();
  var temp = next[firstIdx];
  next[firstIdx] = next[secondIdx];
  next[secondIdx] = temp;
  return updateTagOrderForMediaKey(key, next);
}

function addTagToMediaKey(mediaKey, tagText) {
  var key = String(mediaKey || '').trim();
  var tag = normalizeItemTag(tagText);
  if (!key || !tag) return false;
  var shouldSyncTemplate = shouldLiveSyncEditorToTemplateForMediaKey(key);
  var current = getTagsForMediaKey(key);
  var low = tag.toLowerCase();
  var exists = current.some(function (t) { return String(t).toLowerCase() === low; });
  if (exists) return false;
  if (typeof recordUndoOperation === 'function') {
    recordUndoOperation({
      type: 'tag',
      mediaKey: key,
      tagText: tag,
      previousValue: false,
      nextValue: true
    });
  }
  current.push(tag);
  captionItemTagsByMedia[key] = current;
  if (typeof commitChecklistDescriptorSnapshotForMediaKey === 'function') {
    commitChecklistDescriptorSnapshotForMediaKey(key, tag);
  }
  invalidateChecklistReviewedRequirementsForTagChange(key, tag, { skipRender: true });
  ensureCaptionHelperPhraseInCatalog(tag, true);
  debouncedItemTagsSave(saveItemTagsToFolderState);
  refreshTagDrivenPanelsForMediaKey(key);
  if (shouldSyncTemplate) {
    syncEditorToCurrentTemplatePreview();
  }
  return true;
}

function addTagToCurrentMedia(tagText) {
  if (!state.currentItem || !state.currentItem.key) {
    setStatus('Select a media item to add tags.');
    return false;
  }
  var added = addTagToMediaKey(state.currentItem.key, tagText);
  if (!added) {
    setStatus('Tag already assigned.');
    return false;
  }
  setStatus('Tag added: ' + normalizeItemTag(tagText));
  return true;
}

function removeTagFromMediaKey(mediaKey, tagText) {
  var key = String(mediaKey || '').trim();
  var target = normalizeItemTag(tagText).toLowerCase();
  if (!key || !target) return false;
  var shouldSyncTemplate = shouldLiveSyncEditorToTemplateForMediaKey(key);
  var current = getTagsForMediaKey(key);
  if (!current.length) return false;
  var next = current.filter(function (tag) {
    return normalizeItemTag(tag).toLowerCase() !== target;
  });
  if (next.length === current.length) return false;
  var removedTag = current.find(function (tag) {
    return normalizeItemTag(tag).toLowerCase() === target;
  }) || tagText;
  recordUndoOperation({
    type: 'tag',
    mediaKey: key,
    tagText: normalizeItemTag(removedTag),
    previousValue: true,
    nextValue: false
  });
  if (next.length) captionItemTagsByMedia[key] = next;
  else delete captionItemTagsByMedia[key];
  invalidateChecklistReviewedRequirementsForTagChange(key, removedTag, { skipRender: true });  
  saveItemTagsToFolderState();
  refreshTagDrivenPanelsForMediaKey(key);
  if (shouldSyncTemplate) {
    syncEditorToCurrentTemplatePreview();
  }
  return true;
}

function removeTagFromCurrentMedia(tagText) {
  if (!state.currentItem || !state.currentItem.key) {
    setStatus('Select a media item to remove tags.');
    return false;
  }
  var removed = removeTagFromMediaKey(state.currentItem.key, tagText);
  if (!removed) {
    setStatus('Tag not found.');
    return false;
  }
  setStatus('Tag removed: ' + normalizeItemTag(tagText));
  renderAnnotateStrip();
  
  return true;
}

function loadItemTagsFromFolderState(folderState) {
  var source = (folderState && typeof folderState.caption_tags_by_media === 'object' && folderState.caption_tags_by_media) || {};
  var next = {};
  Object.keys(source).forEach(function (mediaKey) {
    var list = Array.isArray(source[mediaKey]) ? source[mediaKey] : [];
    var seen = {};
    var clean = [];
    list.forEach(function (raw) {
      var tag = normalizeItemTag(raw);
      if (!tag) return;
      var low = tag.toLowerCase();
      if (seen[low]) return;
      seen[low] = true;
      clean.push(tag);
    });
    if (clean.length) {
      next[mediaKey] = clean;
    }
  });
  captionItemTagsByMedia = next;
  mergeCaptionHelperPhrasesFromTagsMap(captionItemTagsByMedia, false);
  renderItemTagsPanel();
}

function renderItemTagsPanel() {
  var listEl = document.getElementById('item-tags-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  if (!state.currentItem || !state.currentItem.key) {
    updateTagClipboardUi();
    listEl.textContent = 'Select a media item.';
    return;
  }
  updateTagClipboardUi();
  var key = state.currentItem.key;
  var tags = getTagsForMediaKey(key).slice().sort(function (a, b) {
    return String(a || '').toLowerCase().localeCompare(String(b || '').toLowerCase());
  });
  var row = getMetadataForMedia(state.currentItem.fileName);
  var suggestedTags = (typeof getSelectionPoseSuggestedTags === 'function')
    ? getSelectionPoseSuggestedTags(row, tags)
    : [];

  if (tags.length) {
    tags.forEach(function (tag) {
      var rowEl = document.createElement('div');
      rowEl.className = 'row-inline';

      var tagBtn = document.createElement('button');
      tagBtn.type = 'button';
      tagBtn.className = 'phrase-copy-item-btn';
      var inCaption = tagAppearsInCurrentCaption(tag);
      tagBtn.classList.add(inCaption ? 'item-tag-pill-present' : 'item-tag-pill-missing');
      tagBtn.textContent = tag;
      tagBtn.title = inCaption ? 'Remove from caption' : 'Insert at cursor';
      tagBtn.onclick = function () {
        toggleCaptionTagAtCursor(tag);        
        renderItemTagsPanel();
      };

      var rmBtn = document.createElement('button');
      rmBtn.type = 'button';
      rmBtn.className = 'stats-phrase-mini-btn';
      rmBtn.textContent = 'x';
      rmBtn.onclick = function () {
        removeTagFromMediaKey(key, tag);
        renderAnnotateStrip();        
      };

      rowEl.appendChild(tagBtn);
      rowEl.appendChild(rmBtn);
      listEl.appendChild(rowEl);
    });
  } else {
    var emptyEl = document.createElement('div');
    emptyEl.textContent = 'No tags.';
    listEl.appendChild(emptyEl);
  }

  if (suggestedTags.length) {
    var suggestedHeader = document.createElement('div');
    suggestedHeader.className = 'item-tags-suggested-header';
    suggestedHeader.textContent = 'Suggested';
    listEl.appendChild(suggestedHeader);

    suggestedTags.forEach(function (tag) {
      var suggestionRow = document.createElement('div');
      suggestionRow.className = 'row-inline';

      var suggestionBtn = document.createElement('button');
      suggestionBtn.type = 'button';
      suggestionBtn.className = 'phrase-copy-item-btn item-tag-pill-suggested';
      suggestionBtn.textContent = '+ ' + tag;
      suggestionBtn.title = 'Add suggested tag';
      suggestionBtn.onclick = function () {
        var added = addTagToMediaKey(key, tag);
        if (added) {
          setStatus('Suggested tag added: ' + tag);
        } else {
          setStatus('Tag already assigned.');
        }
      };

      suggestionRow.appendChild(suggestionBtn);
      listEl.appendChild(suggestionRow);
    });
  }
}

function refreshMediaResolutionCache() {
  function clearMetadataCache() {
    mediaMetadataLoading = false;
    if (Array.isArray(state.items)) {
      state.items.forEach(function (item) {
        if (!item) return;
        item.metadata = null;
      });
    }
  }

  if (!state.folder || !Array.isArray(state.items) || !state.items.length) {
    clearMetadataCache();
    return;
  }

  var requestFolder = state.folder;
  mediaMetadataLoading = true;
  setStatus('Generating metadata...');
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/fs/media_metadata?folder=' + encodeURIComponent(requestFolder));
  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) return;
    if (state.folder !== requestFolder) {
      mediaMetadataLoading = false;
      return;
    }
    if (xhr.status !== 200) {
      mediaMetadataLoading = false;
      clearMetadataCache();
      setStatus('Metadata failed (' + xhr.status + ').');
      return;
    }
    try {
      var rows = JSON.parse(xhr.responseText);
      var metadataByFile = {};
      (rows || []).forEach(function (row) {
        if (!row || !row.file) return;
        metadataByFile[row.file] = row;
      });
      if (Array.isArray(state.items)) {
        state.items.forEach(function (item) {
          if (!item || !item.fileName) return;
          var row = metadataByFile[item.fileName] || null;
          item.metadata = row;
        });
      }
      mediaMetadataLoading = false;
      if (state.currentItem) {
        setStatus(buildSelectedMediaStatus(state.currentItem));
        renderItemMetadataPanel();
        return;
      }
    } catch (e) {
      mediaMetadataLoading = false;
      clearMetadataCache();
      setStatus('Metadata parse failed.');
    }
  };
  xhr.send();
}

function wireItemDetailsUi() {
  var addInput = document.getElementById('item-tag-add-input');
  var addBtn = document.getElementById('item-tag-add-btn');
  if (!addInput || !addBtn || addBtn.__itemTagsBound) return;
  addBtn.__itemTagsBound = true;

  function addTag() {
    var tag = normalizeItemTag(addInput.value);
    if (!tag) return;
    var added = addTagToCurrentMedia(tag);
    addInput.value = '';
    if (!added) return;
  }

  addBtn.onclick = addTag;
  addInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    }
  });
}

window.addTagToCurrentMedia = addTagToCurrentMedia;
window.hasTagForMediaKey = hasTagForMediaKey;
window.removeTagFromCurrentMedia = removeTagFromCurrentMedia;
