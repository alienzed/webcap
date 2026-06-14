
// Caption requirements checklist logic (classic JS, robust, codebase-consistent)
var checklistPanelEl = null;
var checklistItems = getDefaultRequirementItems().slice(); // Current folder's requirements
var checklistCheckedByMedia = {}; // { mediaKey: { item: true/false, ... } }
var debouncedChecklistSave = debounceCreate(400); // Debounce saves for checkbox changes
var checklistKeywordsByItem = {}; // { requirement: "keyword1, keyword2, ..." }
var checklistRequirementsNaByMedia = {}; // { mediaKey: { requirement: true } }
var checklistTermAffixesByKey = {}; // { termLower: { prefix: "", suffix: "" } }

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

function sanitizeChecklistTermAffixesMap(rawMap) {
  var src = (rawMap && typeof rawMap === 'object') ? rawMap : {};
  var out = {};
  Object.keys(src).forEach(function (rawKey) {
    var key = normalizeChecklistTermAffixKey(rawKey);
    var entry = src[rawKey];
    if (!key || !entry || typeof entry !== 'object') return;
    var prefix = normalizeChecklistAffixValue(entry.prefix);
    var suffix = normalizeChecklistAffixValue(entry.suffix);
    if (!prefix && !suffix) return;
    out[key] = { prefix: prefix, suffix: suffix };
  });
  return out;
}

function getChecklistTermAffixes(termText) {
  var key = normalizeChecklistTermAffixKey(termText);
  if (!key) return { prefix: '', suffix: '' };
  var entry = checklistTermAffixesByKey[key];
  if (!entry || typeof entry !== 'object') return { prefix: '', suffix: '' };
  return {
    prefix: normalizeChecklistAffixValue(entry.prefix),
    suffix: normalizeChecklistAffixValue(entry.suffix),
  };
}

function renderChecklistTermWithAffixes(termText) {
  var term = normalizeChecklistTerm(termText);
  if (!term) return '';
  var affixes = getChecklistTermAffixes(term);
  var prefix = affixes.prefix;
  var suffix = affixes.suffix;
  var result = term;
  if (prefix) {
    result = prefix + (/[\s([{'"-]$/.test(prefix) ? '' : ' ') + result;
  }
  if (suffix) {
    result = result + (/^[\s)\]}:;,.!?'"-]/.test(suffix) ? '' : ' ') + suffix;
  }
  return result.replace(/\s+/g, ' ').trim();
}

function setChecklistTermAffixes(termText, prefix, suffix) {
  var key = normalizeChecklistTermAffixKey(termText);
  if (!key) return false;
  var cleanPrefix = normalizeChecklistAffixValue(prefix);
  var cleanSuffix = normalizeChecklistAffixValue(suffix);
  if (!cleanPrefix && !cleanSuffix) {
    if (!checklistTermAffixesByKey[key]) return false;
    delete checklistTermAffixesByKey[key];
    return true;
  }
  var prev = checklistTermAffixesByKey[key];
  if (
    prev &&
    normalizeChecklistAffixValue(prev.prefix) === cleanPrefix &&
    normalizeChecklistAffixValue(prev.suffix) === cleanSuffix
  ) {
    return false;
  }
  checklistTermAffixesByKey[key] = { prefix: cleanPrefix, suffix: cleanSuffix };
  return true;
}

function normalizeChecklistRequirementKey(requirementLabel) {
  return String(requirementLabel || '').trim();
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
  if (previous !== next && typeof recordUndoOperation === 'function') {
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
  if (!opts.skipRender && typeof renderItemMetadataPanel === 'function') {
    renderItemMetadataPanel();
  }
  if (!opts.skipRender && typeof renderAnnotateStrip === 'function') {
    renderAnnotateStrip();
  }
  if (!opts.skipRender && typeof renderFileList === 'function') {
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
  if (previous !== next && typeof recordUndoOperation === 'function') {
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
  if (typeof renderItemMetadataPanel === 'function') {
    renderItemMetadataPanel();
  }
  if (typeof renderAnnotateStrip === 'function') {
    renderAnnotateStrip();
  }
  if (typeof renderFileList === 'function') {
    renderFileList(ui && ui.filterEl ? ui.filterEl.value : '');
  }
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
  var keywords = checklistKeywordsByItem[requirementLabel];
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
  if (reviewed) {
    var currentFlag = String((state.flags && state.flags[mediaKey]) || '').trim().toLowerCase();
    if (!currentFlag && typeof setFlagValueForItem === 'function') {
      setFlagValueForItem(mediaKey, 'green', { skipUndo: true, skipSave: true });
      return true;
    }
  }
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

function renderChecklistPanel() {
  if (!checklistPanelEl) checklistPanelEl = document.getElementById('caption-checklist-panel');
  var itemsDiv = document.getElementById('checklist-items');
  if (!itemsDiv) return;
  // Only show if a media item is selected
  if (!state.currentItem) {
    setChecklistPanelVisible(false);
    if (typeof renderAnnotateStrip === 'function') {
      renderAnnotateStrip();
    }
    return;
  }
  setChecklistPanelVisible(true);
  itemsDiv.innerHTML = '';
  var checkedMap = checklistCheckedByMedia[state.currentItem.key] || {};
  var naMap = getChecklistNaMapForMediaKey(state.currentItem.key);
  for (var i = 0; i < checklistItems.length; i++) {
    var item = checklistItems[i];
    var isNa = !!naMap[normalizeChecklistRequirementKey(item)];
    var row = document.createElement('div');
    row.className = 'row-inline';
    if (isNa) row.classList.add('checklist-row-na');
    var label = document.createElement('label');
    label.style.flex = '1';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!checkedMap[item] || isNa;
    (function(item) {
      cb.onchange = function() {
        if (!state.currentItem) return;
        var mediaKey = state.currentItem.key;
        if (!checklistCheckedByMedia[mediaKey]) checklistCheckedByMedia[mediaKey] = {};
        if (this.checked && isChecklistRequirementNaForMediaKey(mediaKey, item)) {
          setChecklistRequirementNaForMediaKey(mediaKey, item, false, {
            skipSync: true,
            skipSave: true,
            skipRender: true
          });
        } else if (!this.checked && isChecklistRequirementNaForMediaKey(mediaKey, item)) {
          setChecklistRequirementNaForMediaKey(mediaKey, item, false, {
            skipSync: true,
            skipSave: true,
            skipRender: true
          });
          this.checked = true;
        }
        checklistCheckedByMedia[mediaKey][item] = this.checked;
        syncReviewedFromChecklist(mediaKey);
        debouncedChecklistSave(saveChecklistToFolderState);
        if (typeof renderItemMetadataPanel === 'function') {
          renderItemMetadataPanel();
        }
        if (typeof renderAnnotateStrip === 'function') {
          renderAnnotateStrip();
        }
      };
    })(item);
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + item));
    row.appendChild(label);
    // Use live editor text first so highlight updates while typing.
    var captionText = (ui && ui.editorEl && typeof ui.editorEl.value === 'string')
      ? ui.editorEl.value
      : (state.currentItem.caption || '');
    if (requirementKeywordsMatch(item, captionText)) {
      row.classList.add('checklist-item-matched');
    }
    var actions = document.createElement('div');
    actions.className = 'checklist-row-actions';
    var moveUpBtn = document.createElement('button');
    moveUpBtn.textContent = '\u2191';
    moveUpBtn.title = 'Move requirement up';
    moveUpBtn.className = 'checklist-row-action-btn checklist-row-action-move';
    moveUpBtn.disabled = (i === 0);
    (function(idx, label) {
      moveUpBtn.onclick = function() {
        var moved = moveChecklistItemByOffset(idx, -1);
        if (moved) {
          setStatus('Moved requirement up: ' + label);
        }
      };
    })(i, item);
    actions.appendChild(moveUpBtn);
    var editTermsBtn = document.createElement('button');
    editTermsBtn.textContent = '\u270e';
    editTermsBtn.title = 'Edit requirement terms';
    editTermsBtn.className = 'checklist-row-action-btn checklist-group-edit-btn';
    (function(requirementLabel) {
      editTermsBtn.onclick = function() {
        openChecklistGroupTermsModal(requirementLabel);
      };
    })(item);
    actions.appendChild(editTermsBtn);
    // Remove button
    var rmBtn = document.createElement('button');
    rmBtn.textContent = '\u00D7';
    rmBtn.title = 'Remove requirement';
    rmBtn.className = 'checklist-row-action-btn checklist-row-action-remove';
    (function(idx, item) {
      rmBtn.onclick = function() {
        checklistItems.splice(idx, 1);
        for (var k in checklistCheckedByMedia) {
          if (checklistCheckedByMedia[k]) delete checklistCheckedByMedia[k][item];
        }
        for (var mediaKey in checklistRequirementsNaByMedia) {
          if (checklistRequirementsNaByMedia[mediaKey]) {
            delete checklistRequirementsNaByMedia[mediaKey][item];
            if (!Object.keys(checklistRequirementsNaByMedia[mediaKey]).length) {
              delete checklistRequirementsNaByMedia[mediaKey];
            }
          }
        }
        syncReviewedFromChecklistAll();
        saveChecklistToFolderState();
        renderChecklistPanel();
      };
    })(i, item);
    actions.appendChild(rmBtn);
    row.appendChild(actions);
    itemsDiv.appendChild(row);
  }
  renderItemTagsPanel();
  renderItemMetadataPanel();
  if (typeof renderAnnotateStrip === 'function') {
    renderAnnotateStrip();
  }
}

function saveChecklistToFolderState() {
  var snapshot = snapshotFolderStateFromDom();
  snapshot.caption_requirements = checklistItems.slice();
  snapshot.caption_requirements_checked = JSON.parse(JSON.stringify(checklistCheckedByMedia));
  snapshot.caption_requirement_keywords = JSON.parse(JSON.stringify(checklistKeywordsByItem));
  snapshot.caption_requirements_na_by_media = JSON.parse(JSON.stringify(checklistRequirementsNaByMedia));
  snapshot.caption_term_affixes = JSON.parse(JSON.stringify(checklistTermAffixesByKey));
  if (typeof updatePrimerMappingsSummary === 'function') {
    updatePrimerMappingsSummary();
  }
  writeFolderStateFile(state.folder, snapshot);
}

function loadChecklistFromFolderState(folderState) {
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
  checklistTermAffixesByKey = sanitizeChecklistTermAffixesMap(folderState.caption_term_affixes);

  // Fill missing keyword values for default checklist items.
  var defaultsByItem = getDefaultRequirementKeywordsByItem();
  for (var i = 0; i < checklistItems.length; i++) {
    var requirement = checklistItems[i];
    if (!checklistKeywordsByItem[requirement]) {
      var defaultKeywords = String(defaultsByItem[requirement] || '').trim();
      if (defaultKeywords) {
        checklistKeywordsByItem[requirement] = defaultKeywords;
      }
    }
  }

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

  var autoFlaggedCompleteItems = syncReviewedFromChecklistAll();
  if (typeof updatePrimerMappingsSummary === 'function') {
    updatePrimerMappingsSummary();
  }
  if (autoFlaggedCompleteItems) {
    saveChecklistToFolderState();
  }
  renderChecklistPanel();
}


// Temporary object for modal edits
var checklistKeywordsModalTemp = null;
var checklistGroupTermsModalState = null;
var checklistTermAffixesModalState = null;

function getChecklistKeywordTermsForRequirement(requirementLabel) {
  var raw = checklistKeywordsByItem && checklistKeywordsByItem[requirementLabel];
  return parseChecklistKeywordTerms(raw || '');
}

function setChecklistKeywordTermsForRequirement(requirementLabel, terms) {
  if (!requirementLabel) return;
  var cleaned = normalizeChecklistTermsList(terms);
  checklistKeywordsByItem[requirementLabel] = cleaned.join(', ');
}

function getChecklistGroupTermsCatalog() {
  var seen = {};
  var out = [];
  function push(raw) {
    var term = normalizeChecklistTerm(raw);
    var key = term.toLowerCase();
    if (!term || seen[key]) return;
    seen[key] = true;
    out.push(term);
  }
  if (typeof getCaptionHelperCatalogTerms === 'function') {
    getCaptionHelperCatalogTerms().forEach(push);
  }
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
    renderChecklistGroupTermsModalItems();
    renderChecklistGroupTermsModalResults('');
    setStatus(shouldPin ? ('Pinned term to global config: ' + term) : ('Unpinned global term: ' + term));
  });
}

function closeChecklistGroupTermsModal() {
  var modal = document.getElementById('checklist-group-terms-modal');
  var overlay = document.getElementById('modal-overlay');
  var results = document.getElementById('checklist-group-terms-results');
  if (results) {
    results.innerHTML = '';
    results.classList.add('hidden');
  }
  if (modal) modal.classList.add('hidden');
  if (overlay) overlay.classList.add('hidden');
  checklistGroupTermsModalState = null;
}

function renderChecklistTermAffixesPreview() {
  var previewEl = document.getElementById('checklist-term-affixes-preview');
  var prefixEl = document.getElementById('checklist-term-affixes-prefix');
  var suffixEl = document.getElementById('checklist-term-affixes-suffix');
  if (!previewEl || !checklistTermAffixesModalState) return;
  var prefix = prefixEl ? prefixEl.value : '';
  var suffix = suffixEl ? suffixEl.value : '';
  var term = checklistTermAffixesModalState.term;
  var manualPreview = term;
  var cleanPrefix = normalizeChecklistAffixValue(prefix);
  var cleanSuffix = normalizeChecklistAffixValue(suffix);
  if (cleanPrefix) {
    manualPreview = cleanPrefix + (/[\s([{'"-]$/.test(cleanPrefix) ? '' : ' ') + manualPreview;
  }
  if (cleanSuffix) {
    manualPreview = manualPreview + (/^[\s)\]}:;,.!?'"-]/.test(cleanSuffix) ? '' : ' ') + cleanSuffix;
  }
  previewEl.textContent = manualPreview.replace(/\s+/g, ' ').trim() || term;
}

function closeChecklistTermAffixesModal() {
  var modal = document.getElementById('checklist-term-affixes-modal');
  var overlay = document.getElementById('modal-overlay');
  if (modal) modal.classList.add('hidden');
  if (overlay) overlay.classList.add('hidden');
  checklistTermAffixesModalState = null;
}

function saveChecklistTermAffixesModal() {
  if (!checklistTermAffixesModalState) return;
  var prefixEl = document.getElementById('checklist-term-affixes-prefix');
  var suffixEl = document.getElementById('checklist-term-affixes-suffix');
  var changed = setChecklistTermAffixes(
    checklistTermAffixesModalState.term,
    prefixEl ? prefixEl.value : '',
    suffixEl ? suffixEl.value : ''
  );
  if (changed) {
    saveChecklistToFolderState();
    if (typeof renderAnnotateStrip === 'function') renderAnnotateStrip();
    if (typeof renderItemTagsPanel === 'function') renderItemTagsPanel();
  }
  closeChecklistTermAffixesModal();
}

function clearChecklistTermAffixesModal() {
  if (!checklistTermAffixesModalState) return;
  var prefixEl = document.getElementById('checklist-term-affixes-prefix');
  var suffixEl = document.getElementById('checklist-term-affixes-suffix');
  if (prefixEl) prefixEl.value = '';
  if (suffixEl) suffixEl.value = '';
  renderChecklistTermAffixesPreview();
}

function openChecklistTermAffixesModal(termText) {
  var term = normalizeChecklistTerm(termText);
  if (!term) return;
  checklistTermAffixesModalState = { term: term };
  var titleEl = document.getElementById('checklist-term-affixes-modal-title');
  var prefixEl = document.getElementById('checklist-term-affixes-prefix');
  var suffixEl = document.getElementById('checklist-term-affixes-suffix');
  var modal = document.getElementById('checklist-term-affixes-modal');
  var overlay = document.getElementById('modal-overlay');
  var affixes = getChecklistTermAffixes(term);
  if (titleEl) titleEl.textContent = 'Edit Modifiers: ' + term;
  if (prefixEl) prefixEl.value = affixes.prefix;
  if (suffixEl) suffixEl.value = affixes.suffix;
  renderChecklistTermAffixesPreview();
  if (modal) modal.classList.remove('hidden');
  if (overlay) overlay.classList.remove('hidden');
}

function applyChecklistGroupTermsModalChanges() {
  if (!checklistGroupTermsModalState || !checklistGroupTermsModalState.requirement) return;
  setChecklistKeywordTermsForRequirement(
    checklistGroupTermsModalState.requirement,
    checklistGroupTermsModalState.terms
  );
  saveChecklistToFolderState();
  renderChecklistPanel();
  if (typeof renderItemMetadataPanel === 'function') {
    renderItemMetadataPanel();
  }
}

function addChecklistGroupModalTerm(rawTerm) {
  if (!checklistGroupTermsModalState) return false;
  var term = normalizeChecklistTerm(rawTerm);
  if (!term) return false;
  var next = checklistGroupTermsModalState.terms.slice();
  next.push(term);
  checklistGroupTermsModalState.terms = normalizeChecklistTermsList(next);
  applyChecklistGroupTermsModalChanges();
  renderChecklistGroupTermsModalItems();
  renderChecklistGroupTermsModalResults('');
  var input = document.getElementById('checklist-group-terms-input');
  if (input) input.value = '';
  return true;
}

function renderChecklistGroupTermsModalItems() {
  var listEl = document.getElementById('checklist-group-terms-items');
  if (!listEl || !checklistGroupTermsModalState) return;
  listEl.innerHTML = '';
  var terms = checklistGroupTermsModalState.terms || [];
  if (!terms.length) {
    var empty = document.createElement('div');
    empty.className = 'small';
    empty.textContent = 'No terms configured.';
    listEl.appendChild(empty);
    return;
  }
  terms.forEach(function (term, idx) {
    var row = document.createElement('div');
    row.className = 'row-inline stats-phrase-row checklist-group-term-row';
    var termBtn = document.createElement('span');
    termBtn.className = 'phrase-copy-item-btn checklist-group-term-label';
    termBtn.textContent = term;
    termBtn.title = term;
    var actions = document.createElement('div');
    actions.className = 'stats-phrase-actions';
    var pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className = 'stats-phrase-mini-btn checklist-pin-btn';
    var isPinned = isChecklistGroupTermPinnedGlobally(checklistGroupTermsModalState.requirement, term);
    pinBtn.textContent = '\uD83D\uDCCC';
    pinBtn.title = isPinned ? 'Unpin from global config terms' : 'Pin to global config terms';
    pinBtn.classList.toggle('active', isPinned);
    pinBtn.onclick = function () {
      saveChecklistGlobalTermPin(checklistGroupTermsModalState.requirement, term, !isPinned);
    };
    actions.appendChild(pinBtn);
    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'stats-phrase-mini-btn';
    removeBtn.title = 'Remove term';
    removeBtn.textContent = 'x';
    removeBtn.onclick = function () {
      checklistGroupTermsModalState.terms.splice(idx, 1);
      checklistGroupTermsModalState.terms = normalizeChecklistTermsList(checklistGroupTermsModalState.terms);
      applyChecklistGroupTermsModalChanges();
      renderChecklistGroupTermsModalItems();
    };
    actions.appendChild(removeBtn);
    row.appendChild(termBtn);
    row.appendChild(actions);
    listEl.appendChild(row);
  });
}

function renderChecklistGroupTermsModalResults(query) {
  var resultsEl = document.getElementById('checklist-group-terms-results');
  if (!resultsEl || !checklistGroupTermsModalState) return;
  var q = normalizeChecklistTerm(query).toLowerCase();
  if (!q) {
    resultsEl.innerHTML = '';
    resultsEl.classList.add('hidden');
    return;
  }
  var existing = {};
  checklistGroupTermsModalState.terms.forEach(function (term) {
    existing[String(term || '').toLowerCase()] = true;
  });
  var globalTermsLookup = {};
  getConfigRequirementKeywordCatalogTerms().forEach(function (term) {
    var clean = normalizeChecklistTerm(term);
    if (!clean) return;
    globalTermsLookup[clean.toLowerCase()] = true;
  });
  var catalog = getChecklistGroupTermsCatalog();
  var exact = [];
  var startsWith = [];
  var contains = [];
  catalog.forEach(function (term) {
    var clean = normalizeChecklistTerm(term);
    var low = clean.toLowerCase();
    if (!clean || existing[low]) return;
    if (low === q) {
      exact.push(clean);
      return;
    }
    if (low.indexOf(q) === 0) {
      startsWith.push(clean);
      return;
    }
    if (low.indexOf(q) !== -1) {
      contains.push(clean);
    }
  });
  var ranked = exact.concat(startsWith, contains).slice(0, 12);
  resultsEl.innerHTML = '';
  if (!ranked.length) {
    var createRow = document.createElement('div');
    createRow.className = 'caption-term-result-row';
    var createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'phrase-copy-item-btn caption-term-result-main';
    createBtn.textContent = 'Create "' + normalizeChecklistTerm(query) + '"';
    createBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    createBtn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      addChecklistGroupModalTerm(query);
    };
    createRow.appendChild(createBtn);
    resultsEl.appendChild(createRow);
    resultsEl.classList.remove('hidden');
    return;
  }
  ranked.forEach(function (term) {
    var row = document.createElement('div');
    row.className = 'caption-term-result-row';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'phrase-copy-item-btn caption-term-result-main';
    btn.textContent = term;
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      addChecklistGroupModalTerm(term);
    };
    row.appendChild(btn);
    if (globalTermsLookup[String(term || '').toLowerCase()]) {
      var badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'stats-phrase-mini-btn caption-term-result-quick checklist-global-badge';
      badge.textContent = 'G';
      badge.title = 'Global config term';
      badge.disabled = true;
      row.appendChild(badge);
    }
    resultsEl.appendChild(row);
  });
  resultsEl.classList.remove('hidden');
}

function renderChecklistGroupTermsModal() {
  var titleEl = document.getElementById('checklist-group-terms-modal-title');
  var inputEl = document.getElementById('checklist-group-terms-input');
  if (!checklistGroupTermsModalState) return;
  if (titleEl) {
    titleEl.textContent = 'Edit Terms: ' + checklistGroupTermsModalState.requirement;
  }
  if (inputEl) {
    inputEl.value = '';
  }
  renderChecklistGroupTermsModalItems();
  renderChecklistGroupTermsModalResults('');
}

function openChecklistGroupTermsModal(requirementLabel) {
  var requirement = String(requirementLabel || '').trim();
  if (!requirement) return;
  checklistGroupTermsModalState = {
    requirement: requirement,
    terms: getChecklistKeywordTermsForRequirement(requirement)
  };
  renderChecklistGroupTermsModal();
  var modal = document.getElementById('checklist-group-terms-modal');
  var overlay = document.getElementById('modal-overlay');
  if (modal) modal.classList.remove('hidden');
  if (overlay) overlay.classList.remove('hidden');
}

function saveChecklistKeywordsModalAndClose() {
  checklistKeywordsByItem = JSON.parse(JSON.stringify(checklistKeywordsModalTemp || {}));
  saveChecklistToFolderState();
  renderChecklistPanel();
  closeChecklistKeywordsModal();
  checklistKeywordsModalTemp = null;
}

function renderChecklistKeywordsModal() {
  var listDiv = document.getElementById('checklist-keywords-modal-body') || document.getElementById('checklist-keywords-list');
  if (!listDiv) return;
  listDiv.innerHTML = '';
  // Copy current keywords to temp object for editing
  checklistKeywordsModalTemp = JSON.parse(JSON.stringify(checklistKeywordsByItem));
  for (var i = 0; i < checklistItems.length; i++) {
    var requirement = checklistItems[i];
    var keywords = checklistKeywordsModalTemp[requirement] || '';
    var row = document.createElement('div');
    row.className = 'modal-body-row';
    var label = document.createElement('div');
    label.className = 'modal-body-row-label';
    label.textContent = requirement;
    row.appendChild(label);
    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'comma-separated keywords';
    input.value = keywords;
    input.dataset.requirement = requirement;
    input.oninput = function() {
      checklistKeywordsModalTemp[this.dataset.requirement] = this.value;
    };
    input.onchange = function() {
      checklistKeywordsModalTemp[this.dataset.requirement] = this.value;
    };
    input.onkeydown = function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        checklistKeywordsModalTemp[this.dataset.requirement] = this.value;
        saveChecklistKeywordsModalAndClose();
      }
    };
    row.appendChild(input);
    listDiv.appendChild(row);
  }
}

function openChecklistKeywordsModal() {
  renderChecklistKeywordsModal();
  var modal = document.getElementById('checklist-keywords-modal');
  var overlay = document.getElementById('modal-overlay');
  if (modal) modal.classList.remove('hidden');
  if (overlay) overlay.classList.remove('hidden');
}

function closeChecklistKeywordsModal() {
  var modal = document.getElementById('checklist-keywords-modal');
  var overlay = document.getElementById('modal-overlay');
  if (modal) modal.classList.add('hidden');
  if (overlay) overlay.classList.add('hidden');
}

// Wire up modal buttons
if (document.getElementById('checklist-settings-btn')) {
  document.getElementById('checklist-settings-btn').addEventListener('click', openChecklistKeywordsModal);
}

if (document.getElementById('checklist-group-terms-add-btn')) {
  document.getElementById('checklist-group-terms-add-btn').addEventListener('click', function () {
    var input = document.getElementById('checklist-group-terms-input');
    addChecklistGroupModalTerm(input ? input.value : '');
  });
}

if (document.getElementById('checklist-group-terms-input')) {
  document.getElementById('checklist-group-terms-input').addEventListener('input', function () {
    renderChecklistGroupTermsModalResults(this.value);
  });
  document.getElementById('checklist-group-terms-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addChecklistGroupModalTerm(this.value);
      return;
    }
    if (e.key === 'Escape') {
      renderChecklistGroupTermsModalResults('');
    }
  });
  document.getElementById('checklist-group-terms-input').addEventListener('blur', function () {
    setTimeout(function () {
      renderChecklistGroupTermsModalResults('');
    }, 150);
  });
}

if (document.getElementById('checklist-term-affixes-prefix')) {
  document.getElementById('checklist-term-affixes-prefix').addEventListener('input', renderChecklistTermAffixesPreview);
  document.getElementById('checklist-term-affixes-prefix').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveChecklistTermAffixesModal();
    }
  });
}

if (document.getElementById('checklist-term-affixes-suffix')) {
  document.getElementById('checklist-term-affixes-suffix').addEventListener('input', renderChecklistTermAffixesPreview);
  document.getElementById('checklist-term-affixes-suffix').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveChecklistTermAffixesModal();
    }
  });
}

if (document.getElementById('checklist-term-affixes-save-btn')) {
  document.getElementById('checklist-term-affixes-save-btn').addEventListener('click', saveChecklistTermAffixesModal);
}

if (document.getElementById('checklist-term-affixes-clear-btn')) {
  document.getElementById('checklist-term-affixes-clear-btn').addEventListener('click', clearChecklistTermAffixesModal);
}

document.addEventListener('click', function(e) {
  if (e.target && e.target.dataset.closeModal === 'checklist-keywords-modal') {
    closeChecklistKeywordsModal();
    discardChecklistKeywordsModalTemp();
    return;
  }
  if (e.target && e.target.dataset.closeModal === 'checklist-group-terms-modal') {
    closeChecklistGroupTermsModal();
    return;
  }
  if (e.target && e.target.dataset.closeModal === 'checklist-term-affixes-modal') {
    closeChecklistTermAffixesModal();
  }
});

document.addEventListener('click', function(e) {
  if (e.target && e.target.id === 'modal-overlay') {
    closeChecklistKeywordsModal();
    closeChecklistGroupTermsModal();
    closeChecklistTermAffixesModal();
    discardChecklistKeywordsModalTemp();
  }
});


document.addEventListener('click', function(e) {
  if (e.target && e.target.id === 'checklist-keywords-save-btn') {
    saveChecklistKeywordsModalAndClose();
  }
});

// Discard changes on cancel/close
function discardChecklistKeywordsModalTemp() {
  checklistKeywordsModalTemp = null;
}

window.isChecklistRequirementNaForMediaKey = isChecklistRequirementNaForMediaKey;
window.isChecklistRequirementNaForCurrentMedia = isChecklistRequirementNaForCurrentMedia;
window.getChecklistTermAffixes = getChecklistTermAffixes;
window.openChecklistTermAffixesModal = openChecklistTermAffixesModal;
window.renderChecklistTermWithAffixes = renderChecklistTermWithAffixes;
window.setChecklistRequirementNaForMediaKey = setChecklistRequirementNaForMediaKey;
