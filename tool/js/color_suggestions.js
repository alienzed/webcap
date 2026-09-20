var colorSuggestionRequestState = {};

function isColorSuggestionRequirement(requirementLabel) {
  var label = normalizeChecklistRequirementKey(requirementLabel).toLowerCase();
  return label === 'color' || label === 'colour' || label === 'colors' || label === 'colours';
}

function isColorSuggestionImageName(fileName) {
  return /\.(jpe?g|png|gif|webp|bmp)$/i.test(String(fileName || ''));
}

function findStateItemByMediaKey(mediaKey) {
  var key = String(mediaKey || '').trim();
  if (!key || !state || !Array.isArray(state.items)) return null;
  for (var i = 0; i < state.items.length; i++) {
    if (state.items[i] && state.items[i].key === key) return state.items[i];
  }
  return null;
}

function getCachedColorSuggestionsForMediaKey(mediaKey) {
  var item = findStateItemByMediaKey(mediaKey);
  if (!item || !item.metadata || typeof item.metadata !== 'object') return null;
  var block = item.metadata.color_suggestions;
  return block && typeof block === 'object' ? block : null;
}

function cacheColorSuggestionsForMediaKey(mediaKey, payload) {
  var item = findStateItemByMediaKey(mediaKey);
  if (!item) return;
  if (!item.metadata || typeof item.metadata !== 'object') item.metadata = {};
  item.metadata.color_suggestions = payload;
}

function requestColorSuggestionsForMediaKey(mediaKey) {
  var item = findStateItemByMediaKey(mediaKey);
  if (!item || !state || !isColorSuggestionImageName(item.fileName)) return;
  if (getCachedColorSuggestionsForMediaKey(mediaKey)) return;

  var requestKey = String(state.folder) + '\n' + String(item.fileName || '');
  if (colorSuggestionRequestState[requestKey] === 'pending' || colorSuggestionRequestState[requestKey] === 'done') return;
  colorSuggestionRequestState[requestKey] = 'pending';

  var url = '/fs/color_suggestions?folder=' + encodeURIComponent(state.folder)
    + '&file=' + encodeURIComponent(item.fileName);
  HttpModule.get(url, function (status, responseText) {
    if (status !== 200) {
      colorSuggestionRequestState[requestKey] = 'error';
      console.error('[webcap] Color suggestions failed:', status, responseText);
      setStatus('Color suggestions failed for ' + item.fileName + '.');
      refreshGroupWorkbenchForCurrentItem();
      return;
    }
    var payload;
    try {
      payload = JSON.parse(responseText);
    } catch (err) {
      colorSuggestionRequestState[requestKey] = 'error';
      console.error('[webcap] Color suggestions returned malformed JSON:', err);
      setStatus('Color suggestions returned malformed data.');
      refreshGroupWorkbenchForCurrentItem();
      return;
    }
    colorSuggestionRequestState[requestKey] = 'done';
    cacheColorSuggestionsForMediaKey(mediaKey, payload);
    if (state.currentItem && state.currentItem.key === mediaKey) {
      refreshGroupWorkbenchForCurrentItem();
    }
  });
}

function colorSuggestionTermExists(requirementLabel, termText) {
  var target = normalizeChecklistTerm(termText).toLowerCase();
  return getChecklistKeywordTermsForRequirement(requirementLabel).some(function (term) {
    return normalizeChecklistTerm(term).toLowerCase() === target;
  });
}

function refreshAfterColorSuggestion(mediaKey) {
  refreshTagDrivenPanelsForMediaKey(mediaKey);
  renderFocusedAnnotationSurface();
}

function applyColorSuggestionToRequirement(requirementLabel, mediaKey, termText) {
  var requirement = normalizeChecklistRequirementKey(requirementLabel);
  var term = normalizeChecklistTerm(termText);
  var key = String(mediaKey || '').trim();
  if (!requirement || !term || !key) return;

  var alreadyInGroup = colorSuggestionTermExists(requirement, term);
  var alreadyTagged = hasTagForMediaKey(key, term);
  if (alreadyInGroup && alreadyTagged) {
    setStatus('Color already selected: ' + term);
    return;
  }

  var previousKeywords = JSON.parse(JSON.stringify(checklistKeywordsByItem || {}));
  var previousTags = JSON.parse(JSON.stringify(captionItemTagsByMedia || {}));
  var previousChecked = JSON.parse(JSON.stringify(checklistCheckedByMedia || {}));
  var previousDescriptors = JSON.parse(JSON.stringify(checklistTermDescriptorsByMedia || {}));
  var previousReviewed = new Set(state.reviewedSet || []);
  var previousPhrases = captionHelperPhrases.slice();

  if (!alreadyInGroup) {
    var localTerms = parseChecklistKeywordTerms(String(checklistKeywordsByItem[requirement] || ''));
    localTerms.push(term);
    setChecklistKeywordTermsForRequirement(requirement, localTerms);
  }

  if (!alreadyTagged) {
    addTagToMediaKey(key, term, {
      skipSave: true,
      skipRefresh: true,
      skipUndo: true,
      reviewRequirementLabel: requirement
    });
  }
  syncReviewedFromChecklistAll();

  var capturedSave = captureCurrentFolderStateSave();
  if (!capturedSave) {
    checklistKeywordsByItem = previousKeywords;
    captionItemTagsByMedia = previousTags;
    checklistCheckedByMedia = previousChecked;
    checklistTermDescriptorsByMedia = previousDescriptors;
    state.reviewedSet = previousReviewed;
    captionHelperPhrases = previousPhrases;
    refreshAfterColorSuggestion(key);
    return;
  }

  writeCapturedFolderState(capturedSave).then(function (ok) {
    if (!ok) {
      checklistKeywordsByItem = previousKeywords;
      captionItemTagsByMedia = previousTags;
      checklistCheckedByMedia = previousChecked;
      checklistTermDescriptorsByMedia = previousDescriptors;
      state.reviewedSet = previousReviewed;
      captionHelperPhrases = previousPhrases;
      refreshAfterColorSuggestion(key);
      setStatus('Color suggestion was not saved; changes were rolled back.');
      return;
    }
    refreshCurrentPrimerDerivedUi();
    refreshAfterColorSuggestion(key);
    setStatus(alreadyInGroup
      ? ('Applied color suggestion: ' + term)
      : ('Added color suggestion to ' + requirement + ': ' + term));
  });
}

function renderColorSuggestionsForGroup(groupEl, requirementLabel, mediaKey, existingTerms) {
  if (!groupEl || !isColorSuggestionRequirement(requirementLabel) || !mediaKey) return;
  var item = findStateItemByMediaKey(mediaKey);
  if (!item || !isColorSuggestionImageName(item.fileName)) return;

  var block = getCachedColorSuggestionsForMediaKey(mediaKey);
  var requestKey = String(state.folder || '') + '\n' + String(item.fileName || '');
  var wrap = document.createElement('div');
  wrap.className = 'group-workbench-color-suggestions';

  var label = document.createElement('span');
  label.className = 'group-workbench-color-suggestions-label';
  label.textContent = 'Suggested';
  wrap.appendChild(label);

  if (!block) {
    var status = document.createElement('span');
    status.className = 'group-workbench-color-suggestions-status';
    status.textContent = colorSuggestionRequestState[requestKey] === 'error' ? 'unavailable' : 'detecting...';
    wrap.appendChild(status);
    groupEl.appendChild(wrap);
    if (colorSuggestionRequestState[requestKey] !== 'error') requestColorSuggestionsForMediaKey(mediaKey);
    return;
  }

  var suggestions = Array.isArray(block.suggestions) ? block.suggestions.slice() : [];
  var existing = {};
  (Array.isArray(existingTerms) ? existingTerms : []).forEach(function (term) {
    existing[normalizeChecklistTerm(term).toLowerCase()] = true;
  });
  suggestions.sort(function (a, b) {
    var aExisting = existing[String(a && a.name || '').toLowerCase()] ? 1 : 0;
    var bExisting = existing[String(b && b.name || '').toLowerCase()] ? 1 : 0;
    if (aExisting !== bExisting) return bExisting - aExisting;
    return Number(b && b.share || 0) - Number(a && a.share || 0);
  });

  if (!suggestions.length) {
    var empty = document.createElement('span');
    empty.className = 'group-workbench-color-suggestions-status';
    empty.textContent = 'none';
    wrap.appendChild(empty);
    groupEl.appendChild(wrap);
    return;
  }

  suggestions.forEach(function (entry) {
    var term = normalizeChecklistTerm(entry && entry.name);
    if (!term) return;
    var inGroup = !!existing[term.toLowerCase()];
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'group-workbench-color-suggestion' + (inGroup ? ' existing' : ' novel');
    btn.title = inGroup
      ? ('Apply detected color: ' + term)
      : ('Add ' + term + ' to ' + requirementLabel + ' and apply it');
    btn.disabled = hasTagForMediaKey(mediaKey, term);

    var swatch = document.createElement('span');
    swatch.className = 'group-workbench-color-swatch';
    swatch.style.backgroundColor = String(entry.hex || term);
    btn.appendChild(swatch);

    var text = document.createElement('span');
    text.textContent = inGroup ? term : ('+ ' + term);
    btn.appendChild(text);

    btn.onclick = function () {
      applyColorSuggestionToRequirement(requirementLabel, mediaKey, term);
    };
    wrap.appendChild(btn);
  });
  groupEl.appendChild(wrap);
}
