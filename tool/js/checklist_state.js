
// Caption requirements checklist logic (classic JS, robust, codebase-consistent)
var checklistPanelEl = null;
var checklistItems = getDefaultRequirementItems().slice(); // Current folder's requirements
var checklistCheckedByMedia = {}; // { mediaKey: { item: true/false, ... } }
var debouncedChecklistSave = debounceCreate(400); // Debounce saves for checkbox changes
var checklistKeywordsByItem = {}; // { requirement: "keyword1, keyword2, ..." }
var checklistGroupTermsClipboard = [];
var checklistSessionHiddenTermsByRequirement = {}; // { requirement: { termLower: true } } session-only
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

function getChecklistGroupTermsClipboard() {
  return Array.isArray(checklistGroupTermsClipboard) ? checklistGroupTermsClipboard.slice() : [];
}

function hasChecklistGroupTermsClipboard() {
  return getChecklistGroupTermsClipboard().length > 0;
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

function mediaKeyHasSavedCaption(mediaKey) {
  var key = String(mediaKey || '').trim();
  if (!key || !state) return false;
  if (state.currentItem && state.currentItem.key === key) {
    return !!state.currentItem.hasCaption;
  }
  if (!Array.isArray(state.items)) return false;
  for (var i = 0; i < state.items.length; i++) {
    var item = state.items[i];
    if (!item || item.key !== key) continue;
    return !!item.hasCaption;
  }
  return false;
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
  var localPrefix = '';
  var localSuffix = '';
  if (entry && typeof entry === 'object') {
    localPrefix = normalizeChecklistAffixValue(entry.prefix);
    localSuffix = normalizeChecklistAffixValue(entry.suffix);
  }
  var globalWrapper = getChecklistGlobalWrapper(termText);
  return {
    prefix: globalWrapper.prefix || localPrefix,
    suffix: globalWrapper.suffix || localSuffix,
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
  var resolvedMediaKey = resolveChecklistTermMediaKey(mediaKey);
  if (resolvedMediaKey && mediaKeyHasSavedCaption(resolvedMediaKey)) {
    var mediaDescriptor = getChecklistTermDescriptorForMediaKey(resolvedMediaKey, termText);
    if (mediaDescriptor) return mediaDescriptor;
  }
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

function commitChecklistDescriptorSnapshotsForMediaKey(mediaKey, termList) {
  var resolvedMediaKey = resolveChecklistTermMediaKey(mediaKey);
  var terms = Array.isArray(termList) ? termList : [];
  if (!resolvedMediaKey || !terms.length) return false;
  var changed = false;
  terms.forEach(function (termText) {
    if (commitChecklistDescriptorSnapshotForMediaKey(resolvedMediaKey, termText)) {
      changed = true;
    }
  });
  return changed;
}

function clearChecklistDescriptorSnapshotsForMediaKey(mediaKey) {
  var resolvedMediaKey = resolveChecklistTermMediaKey(mediaKey);
  if (!resolvedMediaKey || !checklistTermDescriptorsByMedia[resolvedMediaKey]) return false;
  delete checklistTermDescriptorsByMedia[resolvedMediaKey];
  return true;
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

function setChecklistRequirementCheckedForMediaKey(mediaKey, requirementLabel, isChecked, options) {
  if (typeof requirementLabel === 'undefined') {
    requirementLabel = mediaKey;
    mediaKey = (state && state.currentItem && state.currentItem.key) ? state.currentItem.key : '';
  }
  var opts = options || {};
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
  if (!opts.skipSync) syncReviewedFromChecklist(key);
  if (!opts.skipSave) saveChecklistToFolderState();
  if (!opts.skipRender) renderChecklistPanel();
  if (!opts.skipRender) renderItemMetadataPanel();
  if (!opts.skipRender) renderAnnotateStrip();
  if (!opts.skipRender) renderFileList(ui && ui.filterEl ? ui.filterEl.value : '');
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

function requirementKeywordsMatch(requirementLabel, captionText, mediaKey) {
  var keywords = getChecklistKeywordTermsForRequirement(requirementLabel);
  if (!keywords) return false;

  var captionValue = String(captionText || '');
  var keywordList = parseChecklistKeywordTerms(keywords);
  if (!keywordList.length) return false;

  for (var i = 0; i < keywordList.length; i++) {
    var keyword = keywordList[i];
    var renderedKeyword = renderChecklistTermWithAffixes(keyword, mediaKey);
    if (renderedKeyword && renderedKeyword !== keyword && typeof captionContainsPhrase === 'function' && captionContainsPhrase(captionValue, renderedKeyword)) {
      return true;
    }
    if (typeof captionContainsPhrase === 'function' && captionContainsPhrase(captionValue, keyword)) {
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
  var requirementCount = 0;
  for (var i = 0; i < checklistItems.length; i++) {
    var requirementKey = normalizeChecklistRequirementKey(checklistItems[i]);
    if (!requirementKey) continue;
    requirementCount += 1;
    if (!checkedMap[requirementKey]) return false;
  }
  return requirementCount > 0;
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


function saveChecklistToFolderState() {
  var snapshot = snapshotFolderStateFromDom();
  snapshot.caption_requirements = checklistItems.slice();
  snapshot.caption_requirements_checked = JSON.parse(JSON.stringify(checklistCheckedByMedia));
  snapshot.caption_requirement_keywords = JSON.parse(JSON.stringify(checklistKeywordsByItem));
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
  checklistTermWrappersByKey = sanitizeChecklistTermAffixesMap(
    folderState.caption_term_wrappers || folderState.caption_term_affixes
  );
  checklistTermDescriptorDefaultsByKey = sanitizeChecklistTermAffixesMap(folderState.caption_term_descriptor_defaults);
  checklistTermDescriptorsByMedia = sanitizeChecklistTermDescriptorsByMedia(folderState.caption_term_descriptors_by_media);
  syncChecklistLegacyAffixesMirror();

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

function applyChecklistKeywordTermsForRequirement(requirementLabel, terms) {
  var requirement = normalizeChecklistRequirementKey(requirementLabel);
  if (!requirement) return false;
  var changed = setChecklistKeywordTermsForRequirement(requirement, terms);
  if (!changed) return false;
  if (typeof syncReviewedFromChecklistAll === 'function') {
    syncReviewedFromChecklistAll();
  }
  saveChecklistToFolderState();
  refreshCurrentPrimerDerivedUi();
  renderChecklistPanel();
  renderItemMetadataPanel();
  renderAnnotateStrip();
  renderItemTagsPanel();
  if (typeof renderFileList === 'function') {
    renderFileList(ui && ui.filterEl ? ui.filterEl.value : '');
  }
  if (typeof renderFocusedAnnotationModal === 'function') {
    renderFocusedAnnotationModal();
  }
  return true;
}

function copyChecklistGroupTermsToClipboard(requirementLabel) {
  var requirement = normalizeChecklistRequirementKey(requirementLabel);
  if (!requirement) {
    setStatus('Select a group to copy tags from.');
    return false;
  }
  var terms = getChecklistKeywordTermsForRequirement(requirement);
  if (!terms.length) {
    setStatus('No group tags to copy.');
    return false;
  }
  checklistGroupTermsClipboard = normalizeChecklistTermsList(terms);
  if (typeof updateFocusedAnnotationGroupClipboardUi === 'function') {
    updateFocusedAnnotationGroupClipboardUi();
  }
  setStatus('Copied ' + checklistGroupTermsClipboard.length + ' group tag' + (checklistGroupTermsClipboard.length === 1 ? '' : 's') + '.');
  return true;
}

function pasteChecklistGroupTermsToRequirement(requirementLabel) {
  var requirement = normalizeChecklistRequirementKey(requirementLabel);
  if (!requirement) {
    setStatus('Select a group to paste tags into.');
    return false;
  }
  var clipboard = getChecklistGroupTermsClipboard();
  if (!clipboard.length) {
    setStatus('No copied group tags to paste.');
    return false;
  }
  var current = getChecklistKeywordTermsForRequirement(requirement);
  var merged = normalizeChecklistTermsList(current.concat(clipboard));
  if (String(current.join(', ')) === String(merged.join(', '))) {
    setStatus('No new tags to paste.');
    return false;
  }
  checklistKeywordsByItem[requirement] = merged.join(', ');
  if (typeof syncReviewedFromChecklistAll === 'function') {
    syncReviewedFromChecklistAll();
  }
  saveChecklistToFolderState();
  refreshCurrentPrimerDerivedUi();
  renderChecklistPanel();
  renderItemMetadataPanel();
  renderAnnotateStrip();
  renderItemTagsPanel();
  if (typeof renderFileList === 'function') {
    renderFileList(ui && ui.filterEl ? ui.filterEl.value : '');
  }
  if (typeof renderFocusedAnnotationModal === 'function') {
    renderFocusedAnnotationModal();
  }
  if (typeof updateFocusedAnnotationGroupClipboardUi === 'function') {
    updateFocusedAnnotationGroupClipboardUi();
  }
  setStatus('Pasted ' + clipboard.length + ' group tag' + (clipboard.length === 1 ? '' : 's') + '.');
  return true;
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

function getConfigRequirementTermWrappersByTerm(requirements) {
  var out = {};
  var req = (requirements && typeof requirements === 'object')
    ? requirements
    : ((window && window.APP_CONFIG && window.APP_CONFIG.requirements && typeof window.APP_CONFIG.requirements === 'object')
      ? window.APP_CONFIG.requirements
      : null);
  var legacyPrefixes = (req && req.termWrapperPrefixesByTerm && typeof req.termWrapperPrefixesByTerm === 'object')
    ? req.termWrapperPrefixesByTerm
    : {};
  Object.keys(legacyPrefixes).forEach(function (key) {
    var termKey = normalizeChecklistTermAffixKey(key);
    var prefix = normalizeChecklistAffixValue(legacyPrefixes[key]);
    if (!termKey || !prefix) return;
    out[termKey] = { prefix: prefix, suffix: '' };
  });
  var src = (req && req.termWrappersByTerm && typeof req.termWrappersByTerm === 'object')
    ? req.termWrappersByTerm
    : {};
  Object.keys(src).forEach(function (key) {
    var termKey = normalizeChecklistTermAffixKey(key);
    var entry = sanitizeChecklistAffixEntry(src[key], false);
    if (!termKey || !entry) return;
    out[termKey] = entry;
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

function isChecklistTermPinnedGloballyAnywhere(termText) {
  var term = normalizeChecklistTerm(termText).toLowerCase();
  if (!term) return false;
  var byItem = getConfigRequirementKeywordsByItemMap();
  var requirements = Object.keys(byItem);
  for (var i = 0; i < requirements.length; i++) {
    var terms = Array.isArray(byItem[requirements[i]]) ? byItem[requirements[i]] : [];
    for (var j = 0; j < terms.length; j++) {
      if (String(terms[j] || '').toLowerCase() === term) return true;
    }
  }
  return false;
}

function getChecklistGlobalWrapper(termText) {
  var key = normalizeChecklistTermAffixKey(termText);
  if (!key || !isChecklistTermPinnedGloballyAnywhere(termText)) return { prefix: '', suffix: '' };
  var byTerm = getConfigRequirementTermWrappersByTerm();
  var entry = byTerm[key];
  if (!entry || typeof entry !== 'object') return { prefix: '', suffix: '' };
  return {
    prefix: normalizeChecklistAffixValue(entry.prefix),
    suffix: normalizeChecklistAffixValue(entry.suffix),
  };
}

function getChecklistGlobalWrapperPrefix(termText) {
  return getChecklistGlobalWrapper(termText).prefix;
}

function getChecklistGlobalWrapperSuffix(termText) {
  return getChecklistGlobalWrapper(termText).suffix;
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

function refreshChecklistConfigDrivenUi() {
  refreshCurrentPrimerDerivedUi();
  renderAnnotateStrip();
  renderChecklistPanel();
  renderItemMetadataPanel();
  renderItemTagsPanel();
  if (typeof renderFocusedAnnotationModal === 'function') {
    renderFocusedAnnotationModal();
  }
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
    refreshChecklistConfigDrivenUi();
    renderChecklistGroupTermsModalItems();
    renderChecklistGroupTermsModalResults('');
    setStatus(shouldPin ? ('Pinned term to global config: ' + term) : ('Unpinned global term: ' + term));
  });
}

function saveChecklistGlobalWrapper(termText, prefix, suffix, onDone) {
  var term = normalizeChecklistTerm(termText);
  var nextPrefix = normalizeChecklistAffixValue(prefix);
  var nextSuffix = normalizeChecklistAffixValue(suffix);
  var callback = typeof onDone === 'function' ? onDone : function () {};
  if (!term) {
    callback(false, 'Missing term for global wrapper save.');
    return;
  }
  var cfg = (window && window.APP_CONFIG && typeof window.APP_CONFIG === 'object') ? window.APP_CONFIG : {};
  var nextCfg = JSON.parse(JSON.stringify(cfg));
  if (!nextCfg.requirements || typeof nextCfg.requirements !== 'object') nextCfg.requirements = {};
  var req = nextCfg.requirements;
  var byTerm = getConfigRequirementTermWrappersByTerm(req);
  var key = normalizeChecklistTermAffixKey(term);
  var previousEntry = byTerm[key] && typeof byTerm[key] === 'object' ? byTerm[key] : {};
  var previousPrefix = normalizeChecklistAffixValue(previousEntry.prefix);
  var previousSuffix = normalizeChecklistAffixValue(previousEntry.suffix);
  if (previousPrefix === nextPrefix && previousSuffix === nextSuffix) {
    callback(true, nextCfg);
    return;
  }
  if (nextPrefix || nextSuffix) byTerm[key] = { prefix: nextPrefix, suffix: nextSuffix };
  else delete byTerm[key];
  req.termWrappersByTerm = byTerm;
  delete req.termWrapperPrefixesByTerm;
  HttpModule.postJson('/app/config', nextCfg, function (status, responseText) {
    if (status !== 200) {
      callback(false, getErrorMessage(responseText, 'Failed to update global wrapper in config.'));
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
    callback(true, saved);
  });
}

