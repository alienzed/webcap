// Per-item tags and metadata loading
var captionItemTagsByMedia = {};
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
  var defaultsByItem = getDefaultRequirementKeywordsByItem();
  var completed = 0;
  var total = 0;
  var missing = [];
  for (var i = 0; i < requirements.length; i++) {
    var requirementLabel = String(requirements[i] || '').trim();
    if (!requirementLabel) continue;
    var rawTerms = '';
    if (checklistKeywordsByItem && typeof checklistKeywordsByItem === 'object') {
      rawTerms = String(checklistKeywordsByItem[requirementLabel] || '').trim();
    }
    if (!rawTerms) {
      rawTerms = String(defaultsByItem[requirementLabel] || '').trim();
    }
    var terms = parseRequirementProgressTerms(rawTerms);
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
    if (captionContainsTagWithAllowances(captionText, tag)) {
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
  appendFaceFocusMetadataRows(listEl, row);
  appendSelectionPoseMetadataRows(listEl, row);
  appendProgressRows();
}

function saveItemTagsToFolderState() {
  var snapshot = snapshotFolderStateFromDom();
  snapshot.caption_tags_by_media = JSON.parse(JSON.stringify(captionItemTagsByMedia || {}));
  writeFolderStateFile(state.folder, snapshot);
}

function shouldLiveSyncEditorToTemplateForMediaKey(mediaKey) {
  if (!state.currentItem || !state.currentItem.key || state.currentItem.key !== mediaKey) return false;
  if (state.currentItem.hasCaption) return false;
  if (!ui || !ui.editorEl || ui.editorEl.readOnly) return false;
  var currentPrimer = buildAutoPrimer(state.currentItem.fileName, state.currentItem.key);
  var currentEditorText = String(ui.editorEl.value || '');
  return currentEditorText.trim() === String(currentPrimer || '').trim();
}

function syncEditorToCurrentTemplatePreview() {
  if (!state.currentItem || !ui || !ui.editorEl || ui.editorEl.readOnly) return;
  var nextPrimer = buildAutoPrimer(state.currentItem.fileName, state.currentItem.key) || '';
  if (ui.editorEl.value === nextPrimer) return;
  ui.editorEl.value = nextPrimer;
  ui.editorEl.dispatchEvent(new Event('input', { bubbles: true }));
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
  ensureCaptionHelperPhraseInCatalog(tag, true);
  debouncedItemTagsSave(saveItemTagsToFolderState);
  renderItemTagsPanel();
  renderItemMetadataPanel();
  renderFileList();
  updateBalanceDistributionWheel();
  if (typeof renderAnnotateStrip === 'function') {
    renderAnnotateStrip();
  }
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
  if (typeof recordUndoOperation === 'function') {
    recordUndoOperation({
      type: 'tag',
      mediaKey: key,
      tagText: normalizeItemTag(removedTag),
      previousValue: true,
      nextValue: false
    });
  }
  if (next.length) captionItemTagsByMedia[key] = next;
  else delete captionItemTagsByMedia[key];
  saveItemTagsToFolderState();
  renderItemTagsPanel();
  renderItemMetadataPanel();
  renderFileList();
  updateBalanceDistributionWheel();
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
  if (typeof renderAnnotateStrip === 'function') {
    renderAnnotateStrip();
  }
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
    listEl.textContent = 'Select a media item.';
    return;
  }
  var key = state.currentItem.key;
  var tags = getTagsForMediaKey(key);
  var row = getMetadataForMedia(state.currentItem.fileName);
  var suggestedTags = (typeof getSelectionPoseSuggestedTags === 'function')
    ? getSelectionPoseSuggestedTags(row, tags)
    : [];

  if (tags.length) {
    tags.sort(function (a, b) {
      var aText = String(a || '');
      var bText = String(b || '');
      var aPresent = tagAppearsInCurrentCaption(aText);
      var bPresent = tagAppearsInCurrentCaption(bText);
      if (aPresent !== bPresent) return aPresent ? 1 : -1;
      return aText.toLowerCase().localeCompare(bText.toLowerCase());
    });

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
        if (typeof toggleCaptionPhraseAtCursor === 'function') {
          toggleCaptionPhraseAtCursor(tag);
        }
        renderItemTagsPanel();
      };

      var rmBtn = document.createElement('button');
      rmBtn.type = 'button';
      rmBtn.textContent = 'x';
      rmBtn.onclick = function () {
        removeTagFromMediaKey(key, tag);
        if (typeof renderAnnotateStrip === 'function') {
          renderAnnotateStrip();
        }
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
      if (state.currentItem && typeof buildSelectedMediaStatus === 'function') {
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
