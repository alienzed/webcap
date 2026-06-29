
// Caption requirements checklist logic (classic JS, robust, codebase-consistent)
var checklistPanelEl = null;
var checklistItems = getDefaultRequirementItems().slice(); // Current folder's requirements
var checklistCheckedByMedia = {}; // { mediaKey: { item: true/false, ... } }
var debouncedChecklistSave = debounceCreate(400); // Debounce saves for checkbox changes
var checklistKeywordsByItem = {}; // { requirement: "keyword1, keyword2, ..." }
var checklistSessionHiddenTermsByRequirement = {}; // { requirement: { termLower: true } } session-only
var checklistRequirementsNaByMedia = {}; // { mediaKey: { requirement: true } }
var checklistTermWrappersByKey = {}; // { termLower: { prefix: "", suffix: "" } }
var checklistTermDescriptorDefaultsByKey = {}; // { termLower: { prefix: "", suffix: "" } }
var checklistTermDescriptorsByMedia = {}; // { mediaKey: { termLower: { prefix: "", suffix: "" } } }
var checklistTermAffixesByKey = {}; // Legacy mirror of wrappers for backward compatibility.
var checklistExpandedRequirements = {};

function checklistSort(a, b) {
  return String(a || '').toLowerCase().localeCompare(String(b || '').toLowerCase());
}

function normalizeChecklistTerm(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

function normalizeChecklistTermsList(terms) {
  var seen = {};
  var clean = (Array.isArray(terms) ? terms : [])
    .map(function (term) { return normalizeChecklistTerm(term); })
    .filter(function (term) {
      var key = term.toLowerCase();
      if (!term || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  clean.sort(checklistSort);
  return clean;
}

function parseChecklistKeywordTerms(raw) {
  return normalizeChecklistTermsList(String(raw || '').split(','));
}

function normalizeChecklistTermAffixKey(termText) {
  return normalizeChecklistTerm(termText).toLowerCase();
}

function normalizeChecklistAffixValue(value) {
  return String(value || '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeChecklistAffixEntry(entry, allowEmpty) {
  if (!entry || typeof entry !== 'object') return null;
  var prefix = normalizeChecklistAffixValue(entry.prefix);
  var suffix = normalizeChecklistAffixValue(entry.suffix);
  if (!allowEmpty && !prefix && !suffix) return null;
  return { prefix: prefix, suffix: suffix };
}

function sanitizeChecklistTermAffixesMap(rawMap, allowEmpty) {
  var src = (rawMap && typeof rawMap === 'object') ? rawMap : {};
  var out = {};
  Object.keys(src).forEach(function (rawKey) {
    var key = normalizeChecklistTermAffixKey(rawKey);
    var entry = sanitizeChecklistAffixEntry(src[rawKey], !!allowEmpty);
    if (!key || !entry) return;
    out[key] = entry;
  });
  return out;
}

function sanitizeChecklistTermDescriptorsByMedia(rawMap) {
  var src = (rawMap && typeof rawMap === 'object') ? rawMap : {};
  var out = {};
  Object.keys(src).forEach(function (rawMediaKey) {
    var mediaKey = String(rawMediaKey || '').trim();
    if (!mediaKey) return;
    var byTerm = sanitizeChecklistTermAffixesMap(src[rawMediaKey], true);
    if (!Object.keys(byTerm).length) return;
    out[mediaKey] = byTerm;
  });
  return out;
}

function syncChecklistLegacyAffixesMirror() {
  checklistTermAffixesByKey = JSON.parse(JSON.stringify(checklistTermWrappersByKey || {}));
}

function resolveChecklistTermMediaKey(mediaKey) {
  var key = String(mediaKey || '').trim();
  if (key) return key;
  if (state && state.currentItem && state.currentItem.key) {
    return String(state.currentItem.key || '').trim();
  }
  return '';
}

function checklistMediaHasTag(mediaKey, termText) {
  var key = String(mediaKey || '').trim();
  var term = normalizeChecklistTerm(termText);
  if (!key || !term || typeof getTagsForMediaKey !== 'function') return false;
  var target = term.toLowerCase();
  return getTagsForMediaKey(key).some(function (tag) {
    return normalizeChecklistTerm(tag).toLowerCase() === target;
  });
}

function isChecklistRequirementExpanded(requirementLabel) {
  var req = normalizeChecklistRequirementKey(requirementLabel);
  if (!req) return false;
  return !!checklistExpandedRequirements[req];
}

function setChecklistRequirementExpanded(requirementLabel, expanded) {
  var req = normalizeChecklistRequirementKey(requirementLabel);
  if (!req) return false;
  if (expanded) checklistExpandedRequirements[req] = true;
  else delete checklistExpandedRequirements[req];
  return true;
}

function toggleChecklistRequirementExpanded(requirementLabel) {
  var req = normalizeChecklistRequirementKey(requirementLabel);
  if (!req) return false;
  return setChecklistRequirementExpanded(req, !isChecklistRequirementExpanded(req));
}

function getChecklistTermWrapper(termText) {
  var key = normalizeChecklistTermAffixKey(termText);
  if (!key) return { prefix: '', suffix: '' };
  var entry = checklistTermWrappersByKey[key];
  if (!entry || typeof entry !== 'object') return { prefix: '', suffix: '' };
  return {
    prefix: normalizeChecklistAffixValue(entry.prefix),
    suffix: normalizeChecklistAffixValue(entry.suffix),
  };
}

function getChecklistTermDescriptorDefault(termText) {
  var key = normalizeChecklistTermAffixKey(termText);
  if (!key) return { prefix: '', suffix: '' };
  var entry = checklistTermDescriptorDefaultsByKey[key];
  if (!entry || typeof entry !== 'object') return { prefix: '', suffix: '' };
  return {
    prefix: normalizeChecklistAffixValue(entry.prefix),
    suffix: normalizeChecklistAffixValue(entry.suffix),
  };
}

function getChecklistTermDescriptorForMediaKey(mediaKey, termText) {
  var resolvedMediaKey = resolveChecklistTermMediaKey(mediaKey);
  var key = normalizeChecklistTermAffixKey(termText);
  if (!resolvedMediaKey || !key) return null;
  var mediaMap = checklistTermDescriptorsByMedia[resolvedMediaKey];
  if (!mediaMap || typeof mediaMap !== 'object') return null;
  var entry = mediaMap[key];
  if (!entry || typeof entry !== 'object') return null;
  return {
    prefix: normalizeChecklistAffixValue(entry.prefix),
    suffix: normalizeChecklistAffixValue(entry.suffix),
  };
}

function getChecklistEffectiveTermDescriptor(termText, mediaKey) {
  var mediaDescriptor = getChecklistTermDescriptorForMediaKey(mediaKey, termText);
  if (mediaDescriptor) return mediaDescriptor;
  return getChecklistTermDescriptorDefault(termText);
}

function getChecklistTermAffixes(termText, mediaKey) {
  var wrapper = getChecklistTermWrapper(termText);
  var descriptor = getChecklistEffectiveTermDescriptor(termText, mediaKey);
  return {
    prefix: [wrapper.prefix, descriptor.prefix].filter(Boolean).join(' ').trim(),
    suffix: [descriptor.suffix, wrapper.suffix].filter(Boolean).join(' ').trim(),
    wrapperPrefix: wrapper.prefix,
    wrapperSuffix: wrapper.suffix,
    descriptorPrefix: descriptor.prefix,
    descriptorSuffix: descriptor.suffix,
  };
}

function applyChecklistAffixPair(baseText, prefix, suffix) {
  var result = String(baseText || '');
  if (!result) return '';
  if (prefix) {
    result = prefix + (/[\s([{'"-]$/.test(prefix) ? '' : ' ') + result;
  }
  if (suffix) {
    result = result + (/^[\s)\]}:;,.!?'"-]/.test(suffix) ? '' : ' ') + suffix;
  }
  return result.replace(/\s+/g, ' ').trim();
}

function renderChecklistTermWithAffixes(termText, mediaKey) {
  var term = normalizeChecklistTerm(termText);
  if (!term) return '';
  var descriptor = getChecklistEffectiveTermDescriptor(term, mediaKey);
  var wrapper = getChecklistTermWrapper(term);
  return applyChecklistAffixPair(
    applyChecklistAffixPair(term, descriptor.prefix, descriptor.suffix),
    wrapper.prefix,
    wrapper.suffix
  );
}

function setChecklistTermAffixEntry(store, termText, prefix, suffix, options) {
  var opts = options || {};
  var key = normalizeChecklistTermAffixKey(termText);
  if (!key) return false;
  var cleanPrefix = normalizeChecklistAffixValue(prefix);
  var cleanSuffix = normalizeChecklistAffixValue(suffix);
  if (!opts.allowEmpty && !cleanPrefix && !cleanSuffix) {
    if (!store[key]) return false;
    delete store[key];
    return true;
  }
  var prev = store[key];
  if (
    prev &&
    normalizeChecklistAffixValue(prev.prefix) === cleanPrefix &&
    normalizeChecklistAffixValue(prev.suffix) === cleanSuffix
  ) {
    return false;
  }
  store[key] = { prefix: cleanPrefix, suffix: cleanSuffix };
  return true;
}

function setChecklistTermWrapper(termText, prefix, suffix) {
  var changed = setChecklistTermAffixEntry(checklistTermWrappersByKey, termText, prefix, suffix);
  if (changed) syncChecklistLegacyAffixesMirror();
  return changed;
}

function setChecklistTermDescriptorDefault(termText, prefix, suffix) {
  return setChecklistTermAffixEntry(checklistTermDescriptorDefaultsByKey, termText, prefix, suffix);
}

function setChecklistTermDescriptorForMediaKey(mediaKey, termText, prefix, suffix) {
  var resolvedMediaKey = resolveChecklistTermMediaKey(mediaKey);
  var key = normalizeChecklistTermAffixKey(termText);
  if (!resolvedMediaKey || !key) return false;
  var mediaMap = checklistTermDescriptorsByMedia[resolvedMediaKey];
  if (!mediaMap || typeof mediaMap !== 'object') {
    mediaMap = {};
    checklistTermDescriptorsByMedia[resolvedMediaKey] = mediaMap;
  }
  var changed = setChecklistTermAffixEntry(mediaMap, termText, prefix, suffix, { allowEmpty: true });
  if (!Object.keys(mediaMap).length) {
    delete checklistTermDescriptorsByMedia[resolvedMediaKey];
  }
  return changed;
}

function commitChecklistDescriptorSnapshotForMediaKey(mediaKey, termText, sourceDescriptor) {
  var resolvedMediaKey = resolveChecklistTermMediaKey(mediaKey);
  var term = normalizeChecklistTerm(termText);
  if (!resolvedMediaKey || !term) return false;
  var descriptor = sourceDescriptor || getChecklistTermDescriptorDefault(term);
  return setChecklistTermDescriptorForMediaKey(
    resolvedMediaKey,
    term,
    descriptor && typeof descriptor === 'object' ? descriptor.prefix : '',
    descriptor && typeof descriptor === 'object' ? descriptor.suffix : ''
  );
}

function normalizeChecklistRequirementKey(requirementLabel) {
  return String(requirementLabel || '').trim();
}

function getChecklistSessionHiddenTermsMapForRequirement(requirementLabel) {
  var requirement = normalizeChecklistRequirementKey(requirementLabel);
  if (!requirement) return {};
  var map = checklistSessionHiddenTermsByRequirement[requirement];
  return (map && typeof map === 'object') ? map : {};
}

function isChecklistSessionHiddenTermForRequirement(requirementLabel, termText) {
  var requirement = normalizeChecklistRequirementKey(requirementLabel);
  var termKey = normalizeChecklistTerm(termText).toLowerCase();
  if (!requirement || !termKey) return false;
  return !!getChecklistSessionHiddenTermsMapForRequirement(requirement)[termKey];
}

function setChecklistSessionHiddenTermForRequirement(requirementLabel, termText, shouldHide) {
  var requirement = normalizeChecklistRequirementKey(requirementLabel);
  var termKey = normalizeChecklistTerm(termText).toLowerCase();
  if (!requirement || !termKey) return false;
  var map = JSON.parse(JSON.stringify(getChecklistSessionHiddenTermsMapForRequirement(requirement)));
  var previous = !!map[termKey];
  var next = !!shouldHide;
  if (previous === next) return false;
  if (next) map[termKey] = true;
  else delete map[termKey];
  if (Object.keys(map).length) checklistSessionHiddenTermsByRequirement[requirement] = map;
  else delete checklistSessionHiddenTermsByRequirement[requirement];
  return true;
}

function getChecklistNaMapForMediaKey(mediaKey) {
  var key = String(mediaKey || '').trim();
  if (!key) return {};
  var map = checklistRequirementsNaByMedia[key];
  return (map && typeof map === 'object') ? map : {};
}

function getChecklistCheckedMapForMediaKey(mediaKey) {
  var key = String(mediaKey || '').trim();
  if (!key) return {};
  var map = checklistCheckedByMedia[key];
  return (map && typeof map === 'object') ? map : {};
}

function isChecklistRequirementCheckedForMediaKey(mediaKey, requirementLabel) {
  var req = normalizeChecklistRequirementKey(requirementLabel);
  if (!req) return false;
  var map = getChecklistCheckedMapForMediaKey(mediaKey);
  return !!map[req];
}

function isChecklistRequirementNaForMediaKey(mediaKey, requirementLabel) {
  var req = normalizeChecklistRequirementKey(requirementLabel);
  if (!req) return false;
  var map = getChecklistNaMapForMediaKey(mediaKey);
  return !!map[req];
}

function isChecklistRequirementNaForCurrentMedia(requirementLabel) {
  if (!state || !state.currentItem || !state.currentItem.key) return false;
  return isChecklistRequirementNaForMediaKey(state.currentItem.key, requirementLabel);
}

function setChecklistRequirementNaForMediaKey(mediaKey, requirementLabel, isNa, options) {
  var key = String(mediaKey || '').trim();
  var req = normalizeChecklistRequirementKey(requirementLabel);
  var opts = options || {};
  if (!key || !req) return false;
  var previous = isChecklistRequirementNaForMediaKey(key, requirementLabel);
  var next = !!isNa;
  if (previous !== next) {
    recordUndoOperation({
      type: 'checklist-na',
      mediaKey: key,
      requirementLabel: requirementLabel,
      previousValue: previous,
      nextValue: next,
      previousCheckedValue: isChecklistRequirementCheckedForMediaKey(key, requirementLabel)
    });
  }
  var map = JSON.parse(JSON.stringify(getChecklistNaMapForMediaKey(key)));
  if (isNa) {
    map[req] = true;
    checklistRequirementsNaByMedia[key] = map;
    var checkedMap = JSON.parse(JSON.stringify(getChecklistCheckedMapForMediaKey(key)));
    delete checkedMap[req];
    if (Object.keys(checkedMap).length) checklistCheckedByMedia[key] = checkedMap;
    else delete checklistCheckedByMedia[key];
  } else {
    delete map[req];
    if (Object.keys(map).length) checklistRequirementsNaByMedia[key] = map;
    else delete checklistRequirementsNaByMedia[key];
  }
  if (!opts.skipSync) syncReviewedFromChecklist(key);
  if (!opts.skipSave) saveChecklistToFolderState();
  if (!opts.skipRender) renderChecklistPanel();
  if (!opts.skipRender) {
    renderItemMetadataPanel();
  }
  if (!opts.skipRender) {
    renderAnnotateStrip();
  }
  if (!opts.skipRender) {
    renderFileList(ui && ui.filterEl ? ui.filterEl.value : '');
  }
  return true;
}

function setChecklistRequirementCheckedForMediaKey(mediaKey, requirementLabel, isChecked) {
  if (typeof requirementLabel === 'undefined') {
    requirementLabel = mediaKey;
    mediaKey = (state && state.currentItem && state.currentItem.key) ? state.currentItem.key : '';
  }
  var key = String(mediaKey || '').trim();
  var req = normalizeChecklistRequirementKey(requirementLabel);
  if (!key || !req) return false;
  var previous = isChecklistRequirementCheckedForMediaKey(key, requirementLabel);
  var next = !!isChecked;
  if (previous !== next) {
    recordUndoOperation({
      type: 'checklist-checked',
      mediaKey: key,
      requirementLabel: requirementLabel,
      previousValue: previous,
      nextValue: next
    });
  }
  var map = JSON.parse(JSON.stringify(getChecklistCheckedMapForMediaKey(key)));
  if (isChecked) {
    map[req] = true;
    checklistCheckedByMedia[key] = map;
  } else {
    delete map[req];
    if (Object.keys(map).length) checklistCheckedByMedia[key] = map;
    else delete checklistCheckedByMedia[key];
  }
  syncReviewedFromChecklist(key);
  saveChecklistToFolderState();
  renderChecklistPanel();
  renderItemMetadataPanel();
  renderAnnotateStrip();
  renderFileList(ui && ui.filterEl ? ui.filterEl.value : '');
  return true;
}

function toggleChecklistRequirementCheckedForMediaKey(mediaKey, requirementLabel) {
  if (typeof requirementLabel === 'undefined') {
    requirementLabel = mediaKey;
    mediaKey = (state && state.currentItem && state.currentItem.key) ? state.currentItem.key : '';
  }
  return setChecklistRequirementCheckedForMediaKey(
    mediaKey,
    requirementLabel,
    !isChecklistRequirementCheckedForMediaKey(mediaKey, requirementLabel)
  );
}

function moveChecklistItemByOffset(index, offset) {
  var idx = Number(index);
  var step = Number(offset);
  if (!isFinite(idx) || !isFinite(step)) return false;
  if (!Array.isArray(checklistItems) || !checklistItems.length) return false;
  if (idx < 0 || idx >= checklistItems.length) return false;
  var nextIdx = idx + step;
  if (nextIdx < 0 || nextIdx >= checklistItems.length) return false;
  var next = checklistItems.slice();
  var temp = next[idx];
  next[idx] = next[nextIdx];
  next[nextIdx] = temp;
  checklistItems = next;
  saveChecklistToFolderState();
  renderChecklistPanel();
  return true;
}

function requirementKeywordsMatch(requirementLabel, captionText) {
  var keywords = getChecklistKeywordTermsForRequirement(requirementLabel);
  if (!keywords) return false;

  var keywordList = parseChecklistKeywordTerms(keywords).map(function (k) { return String(k || '').toLowerCase(); });
  if (!keywordList.length) return false;

  var captionLower = String(captionText || '').toLowerCase();
  for (var i = 0; i < keywordList.length; i++) {
    if (captionLower.indexOf(keywordList[i]) !== -1) {
      return true;
    }
  }
  return false;
}

function getChecklistSelectedTagsForRequirementForMediaKey(mediaKey, requirementLabel) {
  var key = String(mediaKey || '').trim();
  var requirement = normalizeChecklistRequirementKey(requirementLabel);
  if (!key || !requirement || typeof getTagsForMediaKey !== 'function') return [];
  var terms = getChecklistKeywordTermsForRequirement(requirement);
  if (!Array.isArray(terms) || !terms.length) return [];
  var termSet = {};
  terms.forEach(function (term) {
    var clean = normalizeChecklistTerm(term).toLowerCase();
    if (clean) termSet[clean] = true;
  });
  return getTagsForMediaKey(key).filter(function (tag) {
    return !!termSet[normalizeChecklistTerm(tag).toLowerCase()];
  });
}

function moveChecklistSelectedTagForRequirement(mediaKey, requirementLabel, tagText, offset) {
  var tags = getChecklistSelectedTagsForRequirementForMediaKey(mediaKey, requirementLabel);
  if (!tags.length) return false;
  var target = normalizeChecklistTerm(tagText).toLowerCase();
  var idx = -1;
  for (var i = 0; i < tags.length; i++) {
    if (normalizeChecklistTerm(tags[i]).toLowerCase() === target) {
      idx = i;
      break;
    }
  }
  var nextIdx = idx + Number(offset || 0);
  if (idx < 0 || nextIdx < 0 || nextIdx >= tags.length) return false;
  if (typeof swapTagOrderForMediaKey !== 'function') return false;
  return swapTagOrderForMediaKey(mediaKey, tags[idx], tags[nextIdx]);
}

function setChecklistPanelVisible(visible) {
  if (!checklistPanelEl) checklistPanelEl = document.getElementById('caption-checklist-panel');
  if (!checklistPanelEl) return;
  checklistPanelEl.style.display = visible ? 'flex' : 'none';
  var editorPanel = checklistPanelEl.closest('.editor-panel');
  if (editorPanel) {
    if (visible) editorPanel.classList.add('checklist-visible');
    else editorPanel.classList.remove('checklist-visible');
  }
}

function checklistAllCheckedForMedia(mediaKey) {
  if (!mediaKey || !checklistItems || !checklistItems.length) return false;
  var checkedMap = checklistCheckedByMedia[mediaKey] || {};
  var naMap = getChecklistNaMapForMediaKey(mediaKey);
  for (var i = 0; i < checklistItems.length; i++) {
    var requirementLabel = checklistItems[i];
    if (!checkedMap[requirementLabel] && !naMap[normalizeChecklistRequirementKey(requirementLabel)]) return false;
  }
  return true;
}

function setReviewedRowClass(mediaKey, reviewed) {
  var mediaListEl = ui && ui.mediaListEl;
  if (!mediaListEl || !mediaKey) return;
  var row = mediaListEl.querySelector('[data-type="media"][data-key="' + mediaKey + '"]');
  if (!row) return;
  row.classList.toggle('reviewed', !!reviewed);
}

function syncReviewedFromChecklist(mediaKey) {
  if (!mediaKey) return;
  if (!state.reviewedSet || !(state.reviewedSet instanceof Set)) {
    state.reviewedSet = new Set();
  }
  var reviewed = checklistAllCheckedForMedia(mediaKey);
  if (reviewed) state.reviewedSet.add(mediaKey);
  else state.reviewedSet.delete(mediaKey);
  setReviewedRowClass(mediaKey, reviewed);
  return false;
}

function syncReviewedFromChecklistAll() {
  var changed = false;
  if (!state || !Array.isArray(state.items)) return changed;
  for (var i = 0; i < state.items.length; i++) {
    var item = state.items[i];
    if (!item || !item.key) continue;
    changed = syncReviewedFromChecklist(item.key) || changed;
  }
  return changed;
}

function resolveGroupWorkbenchOptions(options) {
  var opts = options || {};
  var mode = opts.mode || 'item';
  var currentMediaKey = String(opts.currentMediaKey || '').trim();
  if (!currentMediaKey && mode === 'item' && state && state.currentItem && state.currentItem.key) {
    currentMediaKey = state.currentItem.key;
  }
  var seenMediaKeys = {};
  var mediaKeys = [];
  (Array.isArray(opts.mediaKeys) ? opts.mediaKeys : []).forEach(function (rawKey) {
    var key = String(rawKey || '').trim();
    if (!key || seenMediaKeys[key]) return;
    seenMediaKeys[key] = true;
    mediaKeys.push(key);
  });
  if (mode === 'item') {
    mediaKeys = currentMediaKey ? [currentMediaKey] : [];
  }
  return {
    mode: mode,
    targetEl: opts.targetEl || document.getElementById('group-workbench-list'),
    mediaKeys: mediaKeys,
    currentMediaKey: currentMediaKey,
    onAfterMutation: opts.onAfterMutation
  };
}

function renderGroupWorkbenchEmpty(targetEl, message) {
  targetEl.innerHTML = '';
  var emptyEl = document.createElement('div');
  emptyEl.className = 'group-workbench-empty';
  emptyEl.textContent = message;
  targetEl.appendChild(emptyEl);
}

function createGroupWorkbenchActionButton(className, text, title) {
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'group-workbench-action-btn ' + className;
  btn.textContent = text;
  btn.title = title;
  return btn;
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

function toggleGroupWorkbenchTermForItem(mediaKey, requirementLabel, term) {
  if (!mediaKey || !term) return;
  if (isChecklistRequirementNaForMediaKey(mediaKey, requirementLabel)) {
    setChecklistRequirementNaForMediaKey(mediaKey, requirementLabel, false, { skipRender: true });
  }
  if (typeof toggleAnnotateTag === 'function') {
    toggleAnnotateTag(term);
  } else if (typeof hasTagForMediaKey === 'function' && hasTagForMediaKey(mediaKey, term)) {
    if (typeof removeTagFromCurrentMedia === 'function') removeTagFromCurrentMedia(term);
    else if (typeof removeTagFromMediaKey === 'function') removeTagFromMediaKey(mediaKey, term);
  } else {
    if (typeof addTagToCurrentMedia === 'function') addTagToCurrentMedia(term);
    else if (typeof addTagToMediaKey === 'function') addTagToMediaKey(mediaKey, term);
  }
  refreshGroupWorkbenchForCurrentItem();
}

function toggleGroupWorkbenchTermForMediaKeys(mediaKeys, requirementLabel, term, options) {
  var opts = options || {};
  var seen = {};
  var keys = [];
  (Array.isArray(mediaKeys) ? mediaKeys : []).forEach(function (rawKey) {
    var key = String(rawKey || '').trim();
    if (!key || seen[key]) return;
    seen[key] = true;
    keys.push(key);
  });
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
      if (isChecklistRequirementNaForMediaKey(key, requirementLabel)) {
        setChecklistRequirementNaForMediaKey(key, requirementLabel, false, { skipRender: true });
      }
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
      onAfterMutation: opts.onAfterMutation
    });
  }
  return true;
}

function renderGroupWorkbench(options) {
  var opts = resolveGroupWorkbenchOptions(options);
  var targetEl = opts.targetEl || document.getElementById('group-workbench-list');
  if (!targetEl) return;
  var isGridMode = opts.mode === 'grid';
  if (isGridMode && !opts.mediaKeys.length) {
    renderGroupWorkbenchEmpty(targetEl, 'Select Grid thumbnails to tag them.');
    return;
  }
  if (!isGridMode && (!opts.currentMediaKey || !state.currentItem)) {
    renderGroupWorkbenchEmpty(targetEl, 'Select an item to review groups.');
    return;
  }
  if (!Array.isArray(checklistItems) || !checklistItems.length) {
    renderGroupWorkbenchEmpty(targetEl, 'No groups configured.');
    return;
  }

  targetEl.innerHTML = '';
  var fragment = document.createDocumentFragment();
  var mediaKey = opts.currentMediaKey || opts.mediaKeys[0] || '';
  var mediaKeys = opts.mediaKeys;

  for (var i = 0; i < checklistItems.length; i++) {
    var requirementLabel = checklistItems[i];
    var isReviewed = !isGridMode && isChecklistRequirementCheckedForMediaKey(mediaKey, requirementLabel);
    var isNa = !isGridMode && isChecklistRequirementNaForMediaKey(mediaKey, requirementLabel);
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

    var groupEl = document.createElement('section');
    groupEl.className = 'group-workbench-group';
    groupEl.classList.toggle('is-reviewed', isReviewed);
    groupEl.classList.toggle('is-na', isNa);
    groupEl.classList.toggle('is-complete', isReviewed || isNa);
    groupEl.classList.toggle('is-incomplete', !isReviewed && !isNa);

    var headerEl = document.createElement('div');
    headerEl.className = 'group-workbench-group-header';

    var titleEl = document.createElement('div');
    titleEl.className = 'group-workbench-group-title';
    titleEl.textContent = requirementLabel;
    headerEl.appendChild(titleEl);

    var actionsEl = document.createElement('div');
    actionsEl.className = 'group-workbench-group-actions';

    var editBtn = createGroupWorkbenchActionButton('group-workbench-edit-btn', 'Edit', 'Edit group terms');
    (function (label) {
      editBtn.onclick = function () {
        openChecklistGroupTermsModal(label);
      };
    })(requirementLabel);
    actionsEl.appendChild(editBtn);

    if (!isGridMode) {
      var reviewedBtn = createGroupWorkbenchActionButton('group-workbench-reviewed-btn', 'Done', 'Toggle reviewed');
      reviewedBtn.setAttribute('aria-pressed', isReviewed ? 'true' : 'false');
      reviewedBtn.classList.toggle('active', isReviewed);
      reviewedBtn.disabled = isNa;
      (function (key, label) {
        reviewedBtn.onclick = function () {
          toggleChecklistRequirementCheckedForMediaKey(key, label);
          refreshGroupWorkbenchForCurrentItem();
        };
      })(mediaKey, requirementLabel);
      actionsEl.appendChild(reviewedBtn);

      var naBtn = createGroupWorkbenchActionButton('group-workbench-na-btn', 'N/A', 'Toggle not applicable');
      naBtn.setAttribute('aria-pressed', isNa ? 'true' : 'false');
      naBtn.classList.toggle('active', isNa);
      (function (key, label, nextIsNa) {
        naBtn.onclick = function () {
          setChecklistRequirementNaForMediaKey(key, label, !nextIsNa);
          refreshGroupWorkbenchForCurrentItem();
        };
      })(mediaKey, requirementLabel, isNa);
      actionsEl.appendChild(naBtn);
    }

    headerEl.appendChild(actionsEl);
    groupEl.appendChild(headerEl);

    if (terms.length) {
      var termListEl = document.createElement('div');
      termListEl.className = 'group-workbench-term-list';
      for (var t = 0; t < terms.length; t++) {
        var term = terms[t];
        var activeCount = 0;
        if (typeof hasTagForMediaKey === 'function') {
          if (isGridMode) {
            for (var mk = 0; mk < mediaKeys.length; mk++) {
              if (hasTagForMediaKey(mediaKeys[mk], term)) activeCount += 1;
            }
          } else if (hasTagForMediaKey(mediaKey, term)) {
            activeCount = 1;
          }
        }
        var isActive = isGridMode ? activeCount === mediaKeys.length : activeCount > 0;
        var isMixed = isGridMode && activeCount > 0 && activeCount < mediaKeys.length;
        var isMismatch = !isGridMode && isActive
          && typeof tagAppearsInCurrentCaption === 'function'
          && !tagAppearsInCurrentCaption(term);
        var renderedTerm = renderChecklistTermWithAffixes(term, mediaKey);
        var termRowEl = document.createElement('div');
        termRowEl.className = 'group-workbench-term-row';
        termRowEl.classList.toggle('is-active', isActive);
        termRowEl.classList.toggle('is-mixed', isMixed);
        termRowEl.classList.toggle('is-mismatch', isMismatch);

        var termBtn = document.createElement('button');
        termBtn.type = 'button';
        termBtn.className = 'group-workbench-term-btn';
        termBtn.textContent = term;
        termBtn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        termBtn.title = renderedTerm && renderedTerm !== term ? renderedTerm : term;
        termBtn.classList.toggle('active', isActive);
        termBtn.classList.toggle('mixed', isMixed);
        termBtn.classList.toggle('mismatch', isMismatch);
        (function (key, keys, label, termText, mode, afterMutation) {
          termBtn.onclick = function () {
            if (mode === 'grid') {
              toggleGroupWorkbenchTermForMediaKeys(keys, label, termText, {
                targetEl: targetEl,
                onAfterMutation: afterMutation
              });
              return;
            }
            toggleGroupWorkbenchTermForItem(key, label, termText);
          };
          termBtn.oncontextmenu = function (event) {
            event.preventDefault();
            if (typeof openChecklistTermAffixesModal === 'function') {
              openChecklistTermAffixesModal(termText);
            }
          };
        })(mediaKey, mediaKeys.slice(), requirementLabel, term, opts.mode, opts.onAfterMutation);
        termRowEl.appendChild(termBtn);
        termListEl.appendChild(termRowEl);
      }
      groupEl.appendChild(termListEl);
    }

    fragment.appendChild(groupEl);
  }
  targetEl.appendChild(fragment);
}

function renderChecklistPanel() {
  if (!checklistPanelEl) checklistPanelEl = document.getElementById('caption-checklist-panel');
  var itemsDiv = document.getElementById('checklist-items');
  var groupWorkbenchList = document.getElementById('group-workbench-list');
  var renderTarget = groupWorkbenchList || itemsDiv;
  if (!renderTarget) return;
  if (typeof renderPrimerTemplatePlaceholderButtons === 'function') {
    renderPrimerTemplatePlaceholderButtons();
  }
  // Only show if a media item is selected
  if (!state.currentItem) {
    renderGroupWorkbench({ mode: 'item', targetEl: renderTarget });
    setChecklistPanelVisible(false);
    renderAnnotateStrip();
    return;
  }
  setChecklistPanelVisible(true);
  if (itemsDiv && groupWorkbenchList) itemsDiv.innerHTML = '';
  renderGroupWorkbench({
    mode: 'item',
    targetEl: renderTarget,
    mediaKeys: [state.currentItem.key],
    currentMediaKey: state.currentItem.key
  });
  renderItemTagsPanel();
  renderItemMetadataPanel();
  renderAnnotateStrip();
}

function saveChecklistToFolderState() {
  var snapshot = snapshotFolderStateFromDom();
  snapshot.caption_requirements = checklistItems.slice();
  snapshot.caption_requirements_checked = JSON.parse(JSON.stringify(checklistCheckedByMedia));
  snapshot.caption_requirement_keywords = JSON.parse(JSON.stringify(checklistKeywordsByItem));
  snapshot.caption_requirements_na_by_media = JSON.parse(JSON.stringify(checklistRequirementsNaByMedia));
  snapshot.caption_term_wrappers = JSON.parse(JSON.stringify(checklistTermWrappersByKey));
  snapshot.caption_term_affixes = JSON.parse(JSON.stringify(checklistTermAffixesByKey));
  snapshot.caption_term_descriptor_defaults = JSON.parse(JSON.stringify(checklistTermDescriptorDefaultsByKey));
  snapshot.caption_term_descriptors_by_media = JSON.parse(JSON.stringify(checklistTermDescriptorsByMedia));
  writeFolderStateFile(state.folder, snapshot);
}

function loadChecklistFromFolderState(folderState) {
  checklistExpandedRequirements = {};
  checklistSessionHiddenTermsByRequirement = {};
  if (folderState.caption_requirements && Object.prototype.toString.call(folderState.caption_requirements) === '[object Array]') {
    checklistItems = folderState.caption_requirements.slice();
  } else {
    checklistItems = getDefaultRequirementItems().slice();
  }
  if (folderState.caption_requirements_checked && typeof folderState.caption_requirements_checked === 'object') {
    checklistCheckedByMedia = JSON.parse(JSON.stringify(folderState.caption_requirements_checked));
  } else {
    checklistCheckedByMedia = {};
  }
  if (folderState.caption_requirement_keywords && typeof folderState.caption_requirement_keywords === 'object') {
    checklistKeywordsByItem = JSON.parse(JSON.stringify(folderState.caption_requirement_keywords));
  } else {
    checklistKeywordsByItem = {};
  }
  if (folderState.caption_requirements_na_by_media && typeof folderState.caption_requirements_na_by_media === 'object') {
    checklistRequirementsNaByMedia = JSON.parse(JSON.stringify(folderState.caption_requirements_na_by_media));
  } else {
    checklistRequirementsNaByMedia = {};
  }
  checklistTermWrappersByKey = sanitizeChecklistTermAffixesMap(
    folderState.caption_term_wrappers || folderState.caption_term_affixes
  );
  checklistTermDescriptorDefaultsByKey = sanitizeChecklistTermAffixesMap(folderState.caption_term_descriptor_defaults);
  checklistTermDescriptorsByMedia = sanitizeChecklistTermDescriptorsByMedia(folderState.caption_term_descriptors_by_media);
  syncChecklistLegacyAffixesMirror();

  // Drop stale NA flags for requirement labels that no longer exist.
  var requirementSet = {};
  checklistItems.forEach(function (req) {
    var key = normalizeChecklistRequirementKey(req);
    if (key) requirementSet[key] = true;
  });
  Object.keys(checklistRequirementsNaByMedia).forEach(function (mediaKey) {
    var map = checklistRequirementsNaByMedia[mediaKey];
    if (!map || typeof map !== 'object') {
      delete checklistRequirementsNaByMedia[mediaKey];
      return;
    }
    Object.keys(map).forEach(function (req) {
      if (!requirementSet[normalizeChecklistRequirementKey(req)]) {
        delete map[req];
      }
    });
    if (!Object.keys(map).length) {
      delete checklistRequirementsNaByMedia[mediaKey];
    }
  });

  syncReviewedFromChecklistAll();
  renderChecklistPanel();
}


function getChecklistKeywordTermsForRequirement(requirementLabel) {
  var requirement = normalizeChecklistRequirementKey(requirementLabel);
  if (!requirement) return [];
  var hiddenTerms = getChecklistSessionHiddenTermsMapForRequirement(requirement);
  var seen = {};
  var out = [];
  function push(raw) {
    var term = normalizeChecklistTerm(raw);
    var key = term.toLowerCase();
    if (!term || seen[key] || hiddenTerms[key]) return;
    seen[key] = true;
    out.push(term);
  }
  var localRaw = checklistKeywordsByItem && checklistKeywordsByItem[requirement];
  parseChecklistKeywordTerms(localRaw || '').forEach(push);
  var globalMap = getConfigRequirementKeywordsByItemMap();
  var globalTerms = Array.isArray(globalMap[requirement]) ? globalMap[requirement] : [];
  globalTerms.forEach(push);
  out.sort(checklistSort);
  return out;
}

function getChecklistRequirementsForTag(tagText) {
  var target = normalizeChecklistTerm(tagText).toLowerCase();
  var matches = [];
  if (!target || !Array.isArray(checklistItems) || !checklistItems.length) return matches;
  checklistItems.forEach(function (requirementLabel) {
    var requirement = normalizeChecklistRequirementKey(requirementLabel);
    if (!requirement) return;
    var hasMatch = getChecklistKeywordTermsForRequirement(requirement).some(function (term) {
      return normalizeChecklistTerm(term).toLowerCase() === target;
    });
    if (hasMatch) {
      matches.push(requirement);
    }
  });
  return matches;
}

function clearChecklistReviewedRequirementsForMediaKey(mediaKey, requirementLabels, options) {
  var key = String(mediaKey || '').trim();
  var opts = options || {};
  if (!key) return [];
  var labels = normalizeRequirementLabelList(requirementLabels);
  if (!labels.length) return [];
  var checkedMap = JSON.parse(JSON.stringify(getChecklistCheckedMapForMediaKey(key)));
  var changed = [];
  labels.forEach(function (requirementLabel) {
    if (!checkedMap[requirementLabel]) return;
    delete checkedMap[requirementLabel];
    changed.push(requirementLabel);
  });
  if (!changed.length) return changed;
  if (Object.keys(checkedMap).length) checklistCheckedByMedia[key] = checkedMap;
  else delete checklistCheckedByMedia[key];
  if (!opts.skipSync) syncReviewedFromChecklist(key);
  if (!opts.skipSave) saveChecklistToFolderState();
  if (!opts.skipRender) renderChecklistPanel();
  if (!opts.skipRender) {
    renderItemMetadataPanel();
  }
  if (!opts.skipRender) {
    renderAnnotateStrip();
  }
  if (!opts.skipRender) {
    renderFileList(ui && ui.filterEl ? ui.filterEl.value : '');
  }
  return changed;
}

function invalidateChecklistReviewedRequirementsForTagChange(mediaKey, tagText, options) {
  return clearChecklistReviewedRequirementsForMediaKey(
    mediaKey,
    getChecklistRequirementsForTag(tagText),
    options
  );
}

function invalidateChecklistReviewedRequirementsForCurrentTagMismatch(options) {
  if (!state || !state.currentItem || !state.currentItem.key) return [];
  var mediaKey = state.currentItem.key;
  var changedRequirements = [];
  checklistItems.forEach(function (requirementLabel) {
    var requirement = normalizeChecklistRequirementKey(requirementLabel);
    if (!requirement || !isChecklistRequirementCheckedForMediaKey(mediaKey, requirement)) return;
    var hasMismatch = getChecklistKeywordTermsForRequirement(requirement).some(function (term) {
      if (typeof hasTagForMediaKey !== 'function' || !hasTagForMediaKey(mediaKey, term)) {
        return false;
      }
      if (typeof tagAppearsInCurrentCaption === 'function') {
        return !tagAppearsInCurrentCaption(term);
      }
      return false;
    });
    if (hasMismatch) {
      changedRequirements.push(requirement);
    }
  });
  return clearChecklistReviewedRequirementsForMediaKey(mediaKey, changedRequirements, options);
}

function setChecklistKeywordTermsForRequirement(requirementLabel, terms) {
  var requirement = normalizeChecklistRequirementKey(requirementLabel);
  if (!requirement) return false;
  var cleaned = normalizeChecklistTermsList(terms);
  var next = cleaned.join(', ');
  var previous = String(checklistKeywordsByItem[requirement] || '');
  if (next) checklistKeywordsByItem[requirement] = next;
  else delete checklistKeywordsByItem[requirement];
  return previous !== next;
}

function getChecklistGroupTermsCatalog(requirementLabel) {
  var seen = {};
  var out = [];
  var requirement = normalizeChecklistRequirementKey(requirementLabel);
  var hiddenTerms = requirement ? getChecklistSessionHiddenTermsMapForRequirement(requirement) : {};
  function push(raw) {
    var term = normalizeChecklistTerm(raw);
    var key = term.toLowerCase();
    if (!term || seen[key] || hiddenTerms[key]) return;
    seen[key] = true;
    out.push(term);
  }
  getCaptionHelperCatalogTerms().forEach(push);
  getConfigRequirementKeywordCatalogTerms().forEach(push);
  checklistItems.forEach(function (requirementLabel) {
    getChecklistKeywordTermsForRequirement(requirementLabel).forEach(push);
  });
  out.sort(checklistSort);
  return out;
}

function getConfigRequirementKeywordsByItemMap() {
  var out = {};
  var req = (window && window.APP_CONFIG && window.APP_CONFIG.requirements && typeof window.APP_CONFIG.requirements === 'object')
    ? window.APP_CONFIG.requirements
    : null;
  var src = (req && req.keywordsByItem && typeof req.keywordsByItem === 'object')
    ? req.keywordsByItem
    : {};
  Object.keys(src).forEach(function (key) {
    var requirement = normalizeChecklistRequirementKey(key);
    if (!requirement) return;
    out[requirement] = parseChecklistKeywordTerms(src[key]);
  });
  return out;
}

function getConfigRequirementKeywordCatalogTerms() {
  var out = [];
  var seen = {};
  var byItem = getConfigRequirementKeywordsByItemMap();
  Object.keys(byItem).forEach(function (requirement) {
    var terms = Array.isArray(byItem[requirement]) ? byItem[requirement] : [];
    terms.forEach(function (term) {
      var clean = normalizeChecklistTerm(term);
      var low = clean.toLowerCase();
      if (!clean || seen[low]) return;
      seen[low] = true;
      out.push(clean);
    });
  });
  out.sort(checklistSort);
  return out;
}

function isChecklistGroupTermPinnedGlobally(requirementLabel, termText) {
  var requirement = normalizeChecklistRequirementKey(requirementLabel);
  var term = normalizeChecklistTerm(termText).toLowerCase();
  if (!requirement || !term) return false;
  var byItem = getConfigRequirementKeywordsByItemMap();
  var terms = Array.isArray(byItem[requirement]) ? byItem[requirement] : [];
  for (var i = 0; i < terms.length; i++) {
    if (String(terms[i] || '').toLowerCase() === term) return true;
  }
  return false;
}

function normalizeRequirementLabelList(labels) {
  var seen = {};
  var out = [];
  (Array.isArray(labels) ? labels : []).forEach(function (raw) {
    var clean = normalizeChecklistRequirementKey(raw);
    var low = clean.toLowerCase();
    if (!clean || seen[low]) return;
    seen[low] = true;
    out.push(clean);
  });
  return out;
}

function saveChecklistGlobalTermPin(requirementLabel, termText, shouldPin) {
  var requirement = normalizeChecklistRequirementKey(requirementLabel);
  var term = normalizeChecklistTerm(termText);
  if (!requirement || !term) return;

  var cfg = (window && window.APP_CONFIG && typeof window.APP_CONFIG === 'object') ? window.APP_CONFIG : {};
  var nextCfg = JSON.parse(JSON.stringify(cfg));
  if (!nextCfg.requirements || typeof nextCfg.requirements !== 'object') nextCfg.requirements = {};

  var req = nextCfg.requirements;
  var items = normalizeRequirementLabelList(Array.isArray(req.items) ? req.items.slice() : getDefaultRequirementItems().slice());
  var keywordsByItem = (req.keywordsByItem && typeof req.keywordsByItem === 'object')
    ? JSON.parse(JSON.stringify(req.keywordsByItem))
    : {};

  var existingTerms = parseChecklistKeywordTerms(String(keywordsByItem[requirement] || ''));
  var nextTerms = existingTerms.slice();
  if (shouldPin) {
    nextTerms.push(term);
    nextTerms = normalizeChecklistTermsList(nextTerms);
    if (items.map(function (v) { return String(v || '').toLowerCase(); }).indexOf(requirement.toLowerCase()) === -1) {
      items.push(requirement);
    }
  } else {
    nextTerms = existingTerms.filter(function (current) {
      return String(current || '').toLowerCase() !== term.toLowerCase();
    });
    nextTerms = normalizeChecklistTermsList(nextTerms);
  }

  if (nextTerms.length) keywordsByItem[requirement] = nextTerms.join(', ');
  else delete keywordsByItem[requirement];

  req.items = normalizeRequirementLabelList(items);
  req.keywordsByItem = keywordsByItem;

  var prevReqJson = JSON.stringify(cfg && cfg.requirements ? cfg.requirements : {});
  var nextReqJson = JSON.stringify(nextCfg.requirements);
  if (prevReqJson === nextReqJson) return;

  HttpModule.postJson('/app/config', nextCfg, function (status, responseText) {
    if (status !== 200) {
      setStatus(getErrorMessage(responseText, 'Failed to update global requirement terms in config.'));
      renderChecklistGroupTermsModalItems();
      renderChecklistGroupTermsModalResults('');
      return;
    }
    var saved = nextCfg;
    try {
      var parsed = JSON.parse(responseText);
      if (parsed && parsed.config && typeof parsed.config === 'object') {
        saved = parsed.config;
      }
    } catch (_e) {}
    setRuntimeAppConfig(saved);
    refreshCurrentPrimerDerivedUi();
    renderAnnotateStrip();
    renderItemMetadataPanel();
    renderItemTagsPanel();
    if (typeof renderFocusedAnnotationModal === 'function') {
      renderFocusedAnnotationModal();
    }
    renderChecklistGroupTermsModalItems();
    renderChecklistGroupTermsModalResults('');
    setStatus(shouldPin ? ('Pinned term to global config: ' + term) : ('Unpinned global term: ' + term));
  });
}

window.isChecklistRequirementNaForMediaKey = isChecklistRequirementNaForMediaKey;
window.isChecklistRequirementNaForCurrentMedia = isChecklistRequirementNaForCurrentMedia;
window.getChecklistTermAffixes = getChecklistTermAffixes;
window.getChecklistTermWrapper = getChecklistTermWrapper;
window.getChecklistTermDescriptorDefault = getChecklistTermDescriptorDefault;
window.getChecklistTermDescriptorForMediaKey = getChecklistTermDescriptorForMediaKey;
window.commitChecklistDescriptorSnapshotForMediaKey = commitChecklistDescriptorSnapshotForMediaKey;
window.renderChecklistTermWithAffixes = renderChecklistTermWithAffixes;
window.renderGroupWorkbench = renderGroupWorkbench;
window.setChecklistRequirementNaForMediaKey = setChecklistRequirementNaForMediaKey;
window.checklistTermWrappersByKey = checklistTermWrappersByKey;
window.checklistTermDescriptorDefaultsByKey = checklistTermDescriptorDefaultsByKey;
window.checklistTermDescriptorsByMedia = checklistTermDescriptorsByMedia;
window.checklistTermAffixesByKey = checklistTermAffixesByKey;
