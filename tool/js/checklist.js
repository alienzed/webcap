
// Caption requirements checklist logic (classic JS, robust, codebase-consistent)
var checklistPanelEl = null;
var checklistItems = getDefaultRequirementItems().slice(); // Current folder's requirements
var checklistCheckedByMedia = {}; // { mediaKey: { item: true/false, ... } }
var debouncedChecklistSave = debounceCreate(400); // Debounce saves for checkbox changes
var checklistKeywordsByItem = {}; // { requirement: "keyword1, keyword2, ..." }
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
  if (reviewed) {
    var currentFlag = String((state.flags && state.flags[mediaKey]) || '').trim().toLowerCase();
    if (!currentFlag) {
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
    renderAnnotateStrip();
    return;
  }
  setChecklistPanelVisible(true);
  itemsDiv.innerHTML = '';
  var checkedMap = checklistCheckedByMedia[state.currentItem.key] || {};
  var naMap = getChecklistNaMapForMediaKey(state.currentItem.key);
  var mediaKey = state.currentItem.key;
  for (var i = 0; i < checklistItems.length; i++) {
    var item = checklistItems[i];
    var isNa = !!naMap[normalizeChecklistRequirementKey(item)];
    var row = document.createElement('div');
    row.className = 'checklist-row-block';
    if (isNa) row.classList.add('checklist-row-na');
    var summaryRow = document.createElement('div');
    summaryRow.className = 'row-inline checklist-row-summary';
    if (!!checkedMap[item] || isNa) summaryRow.classList.add('checklist-row-reviewed');
    var label = document.createElement('div');
    label.className = 'checklist-row-label';
    var toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'checklist-row-toggle-btn';
    toggleBtn.textContent = isChecklistRequirementExpanded(item) ? '\u25BE' : '\u25B8';
    toggleBtn.title = isChecklistRequirementExpanded(item)
      ? 'Hide selected tags for primer order'
      : 'Show selected tags for primer order';
    (function (requirementLabel) {
      toggleBtn.onclick = function () {
        toggleChecklistRequirementExpanded(requirementLabel);
        renderChecklistPanel();
      };
    })(item);
    var labelText = document.createElement('span');
    labelText.className = 'checklist-row-label-text';
    labelText.textContent = item;
    label.appendChild(toggleBtn);
    label.appendChild(labelText);
    summaryRow.appendChild(label);
    // Use live editor text first so highlight updates while typing.
    var captionText = (ui && ui.editorEl && typeof ui.editorEl.value === 'string')
      ? ui.editorEl.value
      : (state.currentItem.caption || '');
    if (requirementKeywordsMatch(item, captionText)) {
      summaryRow.classList.add('checklist-item-matched');
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
    summaryRow.appendChild(actions);
    row.appendChild(summaryRow);
    if (isChecklistRequirementExpanded(item)) {
      var selectedTags = getChecklistSelectedTagsForRequirementForMediaKey(mediaKey, item);
      var selectedTagsEl = document.createElement('div');
      selectedTagsEl.className = 'checklist-selected-tags';
      if (selectedTags.length) {
        selectedTags.forEach(function (tag, idx) {
          var tagRow = document.createElement('div');
          tagRow.className = 'checklist-selected-tag-row';
          var tagLabel = document.createElement('span');
          tagLabel.className = 'checklist-selected-tag-label';
          tagLabel.textContent = tag;
          var tagActions = document.createElement('div');
          tagActions.className = 'checklist-selected-tag-actions';

          var tagUpBtn = document.createElement('button');
          tagUpBtn.type = 'button';
          tagUpBtn.className = 'checklist-row-action-btn checklist-row-action-move';
          tagUpBtn.textContent = '\u2191';
          tagUpBtn.title = 'Move tag earlier in primer order for this group';
          tagUpBtn.disabled = idx === 0;
          (function (requirementLabel, tagText) {
            tagUpBtn.onclick = function () {
              var moved = moveChecklistSelectedTagForRequirement(mediaKey, requirementLabel, tagText, -1);
              if (moved) {
                setStatus('Moved tag up in ' + requirementLabel + ': ' + tagText);
              }
            };
          })(item, tag);

          var tagDownBtn = document.createElement('button');
          tagDownBtn.type = 'button';
          tagDownBtn.className = 'checklist-row-action-btn checklist-row-action-move';
          tagDownBtn.textContent = '\u2193';
          tagDownBtn.title = 'Move tag later in primer order for this group';
          tagDownBtn.disabled = idx === selectedTags.length - 1;
          (function (requirementLabel, tagText) {
            tagDownBtn.onclick = function () {
              var moved = moveChecklistSelectedTagForRequirement(mediaKey, requirementLabel, tagText, 1);
              if (moved) {
                setStatus('Moved tag down in ' + requirementLabel + ': ' + tagText);
              }
            };
          })(item, tag);

          tagActions.appendChild(tagUpBtn);
          tagActions.appendChild(tagDownBtn);
          tagRow.appendChild(tagLabel);
          tagRow.appendChild(tagActions);
          selectedTagsEl.appendChild(tagRow);
        });
      } else {
        var emptySelectedTags = document.createElement('div');
        emptySelectedTags.className = 'checklist-selected-tags-empty';
        emptySelectedTags.textContent = 'No selected tags in this group.';
        selectedTagsEl.appendChild(emptySelectedTags);
      }
      row.appendChild(selectedTagsEl);
    }
    itemsDiv.appendChild(row);
  }
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
  updatePrimerMappingsSummary();
  writeFolderStateFile(state.folder, snapshot);
}

function loadChecklistFromFolderState(folderState) {
  checklistExpandedRequirements = {};
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

  var autoFlaggedCompleteItems = syncReviewedFromChecklistAll();
  updatePrimerMappingsSummary();
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
  var requirement = normalizeChecklistRequirementKey(requirementLabel);
  if (!requirement) return [];
  var localRaw = checklistKeywordsByItem && checklistKeywordsByItem[requirement];
  var localTerms = parseChecklistKeywordTerms(localRaw || '');
  var globalMap = getConfigRequirementKeywordsByItemMap();
  var globalTerms = Array.isArray(globalMap[requirement]) ? globalMap[requirement] : [];
  return normalizeChecklistTermsList(localTerms.concat(globalTerms));
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
  var wrapperPrefixEl = document.getElementById('checklist-term-wrapper-prefix');
  var wrapperSuffixEl = document.getElementById('checklist-term-wrapper-suffix');
  var descriptorPrefixEl = document.getElementById('checklist-term-descriptor-prefix');
  var descriptorSuffixEl = document.getElementById('checklist-term-descriptor-suffix');
  if (!previewEl || !checklistTermAffixesModalState) return;
  var term = checklistTermAffixesModalState.term;
  var descriptorPrefix = descriptorPrefixEl ? descriptorPrefixEl.value : '';
  var descriptorSuffix = descriptorSuffixEl ? descriptorSuffixEl.value : '';
  var wrapperPrefix = wrapperPrefixEl ? wrapperPrefixEl.value : '';
  var wrapperSuffix = wrapperSuffixEl ? wrapperSuffixEl.value : '';
  previewEl.textContent = applyChecklistAffixPair(
    applyChecklistAffixPair(term, descriptorPrefix, descriptorSuffix),
    wrapperPrefix,
    wrapperSuffix
  ) || term;
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
  var wrapperPrefixEl = document.getElementById('checklist-term-wrapper-prefix');
  var wrapperSuffixEl = document.getElementById('checklist-term-wrapper-suffix');
  var descriptorPrefixEl = document.getElementById('checklist-term-descriptor-prefix');
  var descriptorSuffixEl = document.getElementById('checklist-term-descriptor-suffix');
  var term = checklistTermAffixesModalState.term;
  var mediaKey = checklistTermAffixesModalState.mediaKey;
  var hasTag = !!checklistTermAffixesModalState.hasTagOnCurrentItem;
  var changed = false;
  if (setChecklistTermWrapper(
    term,
    wrapperPrefixEl ? wrapperPrefixEl.value : '',
    wrapperSuffixEl ? wrapperSuffixEl.value : ''
  )) {
    changed = true;
  }
  var descriptorPrefix = descriptorPrefixEl ? descriptorPrefixEl.value : '';
  var descriptorSuffix = descriptorSuffixEl ? descriptorSuffixEl.value : '';
  if (setChecklistTermDescriptorDefault(term, descriptorPrefix, descriptorSuffix)) {
    changed = true;
  }
  if (hasTag && mediaKey) {
    if (setChecklistTermDescriptorForMediaKey(mediaKey, term, descriptorPrefix, descriptorSuffix)) {
      changed = true;
    }
  }
  if (changed) {
    saveChecklistToFolderState();
    refreshCurrentPrimerDerivedUi();
    renderAnnotateStrip();
    renderItemTagsPanel();
    renderItemMetadataPanel();
  }
  closeChecklistTermAffixesModal();
}

function clearChecklistTermAffixesModal() {
  if (!checklistTermAffixesModalState) return;
  var fieldIds = [
    'checklist-term-wrapper-prefix',
    'checklist-term-wrapper-suffix',
    'checklist-term-descriptor-prefix',
    'checklist-term-descriptor-suffix'
  ];
  fieldIds.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  renderChecklistTermAffixesPreview();
}

function openChecklistTermAffixesModal(termText) {
  var term = normalizeChecklistTerm(termText);
  if (!term) return;
  var mediaKey = resolveChecklistTermMediaKey();
  var hasTag = checklistMediaHasTag(mediaKey, term);
  checklistTermAffixesModalState = {
    term: term,
    mediaKey: mediaKey,
    hasTagOnCurrentItem: hasTag
  };
  var titleEl = document.getElementById('checklist-term-affixes-modal-title');
  var wrapperPrefixEl = document.getElementById('checklist-term-wrapper-prefix');
  var wrapperSuffixEl = document.getElementById('checklist-term-wrapper-suffix');
  var descriptorPrefixEl = document.getElementById('checklist-term-descriptor-prefix');
  var descriptorSuffixEl = document.getElementById('checklist-term-descriptor-suffix');
  var modal = document.getElementById('checklist-term-affixes-modal');
  var overlay = document.getElementById('modal-overlay');
  var wrapper = getChecklistTermWrapper(term);
  var descriptor = hasTag
    ? getChecklistEffectiveTermDescriptor(term, mediaKey)
    : getChecklistTermDescriptorDefault(term);
  if (titleEl) titleEl.textContent = 'Edit Term Styling: ' + term;
  if (wrapperPrefixEl) wrapperPrefixEl.value = wrapper.prefix;
  if (wrapperSuffixEl) wrapperSuffixEl.value = wrapper.suffix;
  if (descriptorPrefixEl) descriptorPrefixEl.value = descriptor.prefix;
  if (descriptorSuffixEl) descriptorSuffixEl.value = descriptor.suffix;
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
  refreshCurrentPrimerDerivedUi();
  renderChecklistPanel();
  renderItemMetadataPanel();
  renderAnnotateStrip();
  renderItemTagsPanel();
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
  refreshCurrentPrimerDerivedUi();
  renderChecklistPanel();
  renderItemMetadataPanel();
  renderAnnotateStrip();
  renderItemTagsPanel();
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

[
  'checklist-term-wrapper-prefix',
  'checklist-term-wrapper-suffix',
  'checklist-term-descriptor-prefix',
  'checklist-term-descriptor-suffix'
].forEach(function (id) {
  var el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', renderChecklistTermAffixesPreview);
  el.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveChecklistTermAffixesModal();
    }
  });
});

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
window.getChecklistTermWrapper = getChecklistTermWrapper;
window.getChecklistTermDescriptorDefault = getChecklistTermDescriptorDefault;
window.getChecklistTermDescriptorForMediaKey = getChecklistTermDescriptorForMediaKey;
window.commitChecklistDescriptorSnapshotForMediaKey = commitChecklistDescriptorSnapshotForMediaKey;
window.openChecklistTermAffixesModal = openChecklistTermAffixesModal;
window.renderChecklistTermWithAffixes = renderChecklistTermWithAffixes;
window.setChecklistRequirementNaForMediaKey = setChecklistRequirementNaForMediaKey;
window.checklistTermWrappersByKey = checklistTermWrappersByKey;
window.checklistTermDescriptorDefaultsByKey = checklistTermDescriptorDefaultsByKey;
window.checklistTermDescriptorsByMedia = checklistTermDescriptorsByMedia;
window.checklistTermAffixesByKey = checklistTermAffixesByKey;
