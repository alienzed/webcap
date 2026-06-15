// Caption helper annotate strip and panel toggles.

function parseAnnotateStripTerms(raw) {
  var seen = {};
  return String(raw || '')
    .split(',')
    .map(function (part) { return normalizeCatalogTerm(part); })
    .filter(function (term) {
      var low = term.toLowerCase();
      if (!term || seen[low]) return false;
      seen[low] = true;
      return true;
    });
}

function getAnnotateStripGroups() {
  var groups = [];
  var requirements = Array.isArray(checklistItems) ? checklistItems : [];
  for (var i = 0; i < requirements.length; i++) {
    var groupName = normalizeCatalogTerm(requirements[i]);
    if (!groupName) continue;
    var rawTerms = '';
    if (typeof getChecklistKeywordTermsForRequirement === 'function') {
      rawTerms = getChecklistKeywordTermsForRequirement(groupName);
    } else if (checklistKeywordsByItem && checklistKeywordsByItem[groupName]) {
      rawTerms = checklistKeywordsByItem[groupName];
    }
    var terms = parseAnnotateStripTerms(rawTerms);
    if (!terms.length) continue;
    groups.push({ name: groupName, requirement: groupName, terms: terms });
  }
  return groups;
}

function normalizeAnnotateUsageKey(text) {
  return normalizeCatalogTerm(text).toLowerCase();
}

var ANNOTATE_STRIP_CONTEXT_PERCENT = 0.08;
var ANNOTATE_STRIP_CONTEXT_FLOOR = 12;
var ANNOTATE_STRIP_CONTEXT_CEILING = 40;

function annotateStripItemHasCaptionOrTags(item) {
  if (!item || !item.key) return false;
  if (String(item.caption || '').trim()) return true;
  if (typeof getTagsForMediaKey !== 'function') return false;
  return getTagsForMediaKey(item.key).length > 0;
}

function getAnnotateStripContextWindowSize(totalAnnotatedSiblings) {
  var total = Number(totalAnnotatedSiblings) || 0;
  if (total <= 0) return 0;
  var scaled = Math.round(total * ANNOTATE_STRIP_CONTEXT_PERCENT);
  var bounded = Math.max(ANNOTATE_STRIP_CONTEXT_FLOOR, Math.min(ANNOTATE_STRIP_CONTEXT_CEILING, scaled));
  return Math.min(total, bounded);
}

function getAnnotateStripContextItems() {
  var allItems = Array.isArray(state.items) ? state.items : [];
  var currentKey = state.currentItem && state.currentItem.key;
  var currentIndex = -1;
  var totalAnnotatedSiblings = 0;

  for (var i = 0; i < allItems.length; i++) {
    var item = allItems[i];
    if (item && item.key === currentKey) {
      currentIndex = i;
      continue;
    }
    if (annotateStripItemHasCaptionOrTags(item)) {
      totalAnnotatedSiblings += 1;
    }
  }

  var targetSize = getAnnotateStripContextWindowSize(totalAnnotatedSiblings);
  if (!targetSize) {
    return {
      items: [],
      windowSize: 0,
      annotatedSiblingCount: totalAnnotatedSiblings
    };
  }

  var contextItems = [];
  if (currentIndex >= 0) {
    for (var offset = 1; offset < allItems.length && contextItems.length < targetSize; offset++) {
      var before = currentIndex - offset;
      if (before >= 0 && annotateStripItemHasCaptionOrTags(allItems[before])) {
        contextItems.push(allItems[before]);
      }
      if (contextItems.length >= targetSize) break;
      var after = currentIndex + offset;
      if (after < allItems.length && annotateStripItemHasCaptionOrTags(allItems[after])) {
        contextItems.push(allItems[after]);
      }
    }
  } else {
    for (var j = 0; j < allItems.length && contextItems.length < targetSize; j++) {
      if (annotateStripItemHasCaptionOrTags(allItems[j])) {
        contextItems.push(allItems[j]);
      }
    }
  }

  return {
    items: contextItems,
    windowSize: targetSize,
    annotatedSiblingCount: totalAnnotatedSiblings
  };
}

function buildAnnotateStripUsageStats(groups) {
  var preparedGroups = [];
  var countsByGroupTerm = {};
  var folderCountsByGroupTerm = {};
  var maxCountByGroup = {};
  var context = getAnnotateStripContextItems();
  var folderAnnotatedTotal = 0;

  (groups || []).forEach(function (group) {
    var groupKey = String(group && (group.requirement || group.name) || '').trim().toLowerCase();
    var terms = Array.isArray(group && group.terms) ? group.terms : [];
    if (!groupKey || !terms.length) return;
    var preparedTerms = [];
    terms.forEach(function (term) {
      var termKey = normalizeAnnotateUsageKey(term);
      if (!termKey) return;
      preparedTerms.push({ text: term, key: termKey });
      countsByGroupTerm[groupKey + '::' + termKey] = 0;
      folderCountsByGroupTerm[groupKey + '::' + termKey] = 0;
    });
    if (!preparedTerms.length) return;
    maxCountByGroup[groupKey] = 0;
    preparedGroups.push({
      key: groupKey,
      terms: preparedTerms
    });
  });

  function countItem(item, targetCountsByGroupTerm, updateMax) {
    if (!item || !item.key || typeof getTagsForMediaKey !== 'function') return;
    var tags = getTagsForMediaKey(item.key);
    if (!tags.length) return;
    var tagSet = {};
    tags.forEach(function (tag) {
      var tagKey = normalizeAnnotateUsageKey(tag);
      if (tagKey) tagSet[tagKey] = true;
    });
    preparedGroups.forEach(function (group) {
      group.terms.forEach(function (term) {
        if (!tagSet[term.key]) return;
        var countKey = group.key + '::' + term.key;
        targetCountsByGroupTerm[countKey] = (targetCountsByGroupTerm[countKey] || 0) + 1;
        if (updateMax && targetCountsByGroupTerm[countKey] > maxCountByGroup[group.key]) {
          maxCountByGroup[group.key] = targetCountsByGroupTerm[countKey];
        }
      });
    });
  }

  (Array.isArray(state.items) ? state.items : []).forEach(function (item) {
    if (!item || (state.currentItem && item.key === state.currentItem.key)) return;
    if (!annotateStripItemHasCaptionOrTags(item)) return;
    folderAnnotatedTotal += 1;
    countItem(item, folderCountsByGroupTerm, false);
  });

  context.items.forEach(function (item) {
    countItem(item, countsByGroupTerm, true);
  });

  return {
    countsByGroupTerm: countsByGroupTerm,
    folderCountsByGroupTerm: folderCountsByGroupTerm,
    maxCountByGroup: maxCountByGroup,
    contextCount: context.items.length,
    contextWindowSize: context.windowSize,
    annotatedSiblingCount: folderAnnotatedTotal
  };
}

function getAnnotateChipHeatLevel(count, maxCount) {
  var usageCount = Number(count) || 0;
  var maxUsage = Number(maxCount) || 0;
  if (usageCount <= 0 || maxUsage <= 0) return 0;
  var ratio = usageCount / maxUsage;
  var weightedRatio = Math.sqrt(Math.max(0, Math.min(1, ratio)));
  return Math.max(1, Math.min(3, Math.round(weightedRatio * 3)));
}

function isAnnotateChipGapHint(count, contextCount, heatLevel) {
  var usageCount = Number(count) || 0;
  var nearbyTotal = Number(contextCount) || 0;
  var heat = Number(heatLevel) || 0;
  if (usageCount <= 0 || nearbyTotal <= 0) return false;
  if (heat >= 3) return true;
  if (usageCount >= 3) return true;
  return nearbyTotal >= 6 && (usageCount / nearbyTotal) >= 0.35;
}

function formatAnnotateChipUsageTitle(contextCount, contextTotal, folderCount, folderTotal) {
  var nearbyCount = Number(contextCount) || 0;
  var nearbyTotal = Number(contextTotal) || 0;
  var setCount = Number(folderCount) || 0;
  var setTotal = Number(folderTotal) || 0;
  var parts = [];
  if (nearbyTotal > 0) {
    parts.push('nearby ' + nearbyCount + '/' + nearbyTotal);
  }
  if (setTotal > 0) {
    parts.push('folder ' + setCount + '/' + setTotal);
  }
  if (!parts.length) return 'Toggle tag';
  return 'Toggle tag - ' + parts.join(', ');
}

function updateAnnotateStripToggleUi() {
  var toggleIds = ['annotate-strip-toggle-btn', 'annotate-strip-toggle-inline-btn'];
  for (var i = 0; i < toggleIds.length; i++) {
    var toggleBtn = document.getElementById(toggleIds[i]);
    if (!toggleBtn) continue;
    toggleBtn.setAttribute('aria-expanded', annotateStripVisible ? 'true' : 'false');
    toggleBtn.innerHTML = 'Annotate ' + (annotateStripVisible ? '&#9660;' : '&#9650;');
  }
}

function updateCaptionHelperCollapseUi() {
  var panelEl = document.getElementById('caption-checklist-panel');
  var editorPanelEl = panelEl ? panelEl.closest('.editor-panel') : null;
  if (panelEl) {
    if (captionHelperPanelCollapsed) panelEl.classList.add('helper-panel-collapsed');
    else panelEl.classList.remove('helper-panel-collapsed');
  }
  if (editorPanelEl) {
    if (captionHelperPanelCollapsed) editorPanelEl.classList.add('helper-panel-collapsed');
    else editorPanelEl.classList.remove('helper-panel-collapsed');
  }
  var toggleIds = ['caption-helper-collapse-btn', 'caption-helper-collapse-inline-btn'];
  for (var i = 0; i < toggleIds.length; i++) {
    var toggleBtn = document.getElementById(toggleIds[i]);
    if (!toggleBtn) continue;
    toggleBtn.setAttribute('aria-expanded', captionHelperPanelCollapsed ? 'false' : 'true');
    toggleBtn.setAttribute('title', captionHelperPanelCollapsed ? 'Expand helper panel' : 'Collapse helper panel');
    toggleBtn.innerHTML = captionHelperPanelCollapsed ? '&#9654;' : '&#9660;';
  }
}

function setCaptionHelperPanelCollapsed(nextCollapsed, persistNow) {
  captionHelperPanelCollapsed = !!nextCollapsed;
  updateCaptionHelperCollapseUi();
  renderAnnotateStrip();
  if (persistNow) {
    saveCaptionHelpersToFolderState();
  }
}

function setAnnotateStripVisible(nextVisible, persistNow) {
  annotateStripVisible = !!nextVisible;
  updateAnnotateStripToggleUi();
  renderAnnotateStrip();
  if (persistNow) {
    saveCaptionHelpersToFolderState();
  }
}

function toggleAnnotateTag(term) {
  var text = normalizeCatalogTerm(term);
  if (!text) return;
  if (!state.currentItem || !state.currentItem.key) {
    setStatus('Select a media item to annotate.');
    return;
  }
  var mediaKey = state.currentItem.key;
  if (hasTagForMediaKey(mediaKey, text)) {
    if (typeof removeTagFromCurrentMedia === 'function') {
      removeTagFromCurrentMedia(text);
    }
    renderAnnotateStrip();
    return;
  }
  addTagToCurrentMedia(text);
  renderAnnotateStrip();
}

function toggleAnnotateGroupNa(requirementLabel) {
  if (!state.currentItem || !state.currentItem.key) {
    setStatus('Select a media item to annotate.');
    return;
  }
  if (typeof isChecklistRequirementNaForMediaKey !== 'function' || typeof setChecklistRequirementNaForMediaKey !== 'function') {
    setStatus('n/a toggle is unavailable.');
    return;
  }
  var mediaKey = state.currentItem.key;
  var isNa = isChecklistRequirementNaForMediaKey(mediaKey, requirementLabel);
  setChecklistRequirementNaForMediaKey(mediaKey, requirementLabel, !isNa);
  setStatus(!isNa ? ('Marked n/a: ' + requirementLabel) : ('Cleared n/a: ' + requirementLabel));
  renderAnnotateStrip();
}

function toggleAnnotateGroupReviewed(mediaKey, requirementLabel) {
  if (typeof toggleChecklistRequirementCheckedForMediaKey !== 'function') {
    setStatus('Reviewed toggle is unavailable.');
    return false;
  }
  return toggleChecklistRequirementCheckedForMediaKey(mediaKey, requirementLabel);
}

function renderAnnotateStrip() {
  var stripEl = document.getElementById('annotate-strip');
  if (!stripEl) return;
  var panelEl = document.getElementById('caption-checklist-panel');
  var editorPanelEl = panelEl ? panelEl.closest('.editor-panel') : null;
  var panelVisible = !!(panelEl && panelEl.style.display !== 'none');
  var canShow = !!(annotateStripVisible && panelVisible && state.currentItem && state.currentItem.key);

  if (!canShow) {
    stripEl.classList.add('hidden');
    stripEl.innerHTML = '';
    if (editorPanelEl) editorPanelEl.classList.remove('annotate-strip-visible');
    return;
  }

  if (editorPanelEl) editorPanelEl.classList.add('annotate-strip-visible');
  stripEl.classList.remove('hidden');
  var panelHeight = panelEl ? panelEl.offsetHeight : 0;
  stripEl.style.bottom = String(panelHeight + 30) + 'px';

  var groups = getAnnotateStripGroups();
  stripEl.innerHTML = '';

  if (!groups.length) {
    var empty = document.createElement('div');
    empty.className = 'annotate-strip-empty';
    empty.textContent = 'No annotation groups configured. Add requirement keywords to define group items.';
    stripEl.appendChild(empty);
    return;
  }

  var groupsWrap = document.createElement('div');
  groupsWrap.className = 'annotate-strip-groups';
  var mediaKey = state.currentItem.key;
  var usageStats = buildAnnotateStripUsageStats(groups);

  groups.forEach(function (group) {
    var groupEl = document.createElement('div');
    groupEl.className = 'annotate-strip-group';

    var titleRowEl = document.createElement('div');
    titleRowEl.className = 'annotate-strip-group-title-row';
    titleRowEl.title = 'Double-click to toggle reviewed';

    var titleEl = document.createElement('div');
    titleEl.className = 'annotate-strip-group-title';
    titleEl.textContent = group.name;
    titleRowEl.appendChild(titleEl);

    var isComplete = false;
    var controlsEl = document.createElement('div');
    controlsEl.className = 'annotate-strip-group-controls';

    var editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'annotate-strip-group-edit-btn';
    editBtn.textContent = '\u270e';
    editBtn.title = 'Edit requirement terms';
    editBtn.onclick = function () {
      openChecklistGroupTermsModal(group.requirement || group.name);
    };
    controlsEl.appendChild(editBtn);

    var reviewed = (typeof isChecklistRequirementCheckedForMediaKey === 'function')
      ? isChecklistRequirementCheckedForMediaKey(mediaKey, group.requirement || group.name)
      : false;
    var reviewedBtn = document.createElement('button');
    reviewedBtn.type = 'button';
    reviewedBtn.className = 'annotate-strip-group-reviewed-btn';
    if (reviewed) {
      reviewedBtn.classList.add('active');
    }
    reviewedBtn.textContent = '\u2713';
    reviewedBtn.setAttribute('aria-label', reviewed ? 'Clear reviewed mark' : 'Mark requirement reviewed');
    reviewedBtn.setAttribute('aria-pressed', reviewed ? 'true' : 'false');
    reviewedBtn.title = reviewed ? 'Clear reviewed mark' : 'Mark requirement reviewed';
    reviewedBtn.onclick = function () {
      toggleAnnotateGroupReviewed(mediaKey, group.requirement || group.name);
    };
    controlsEl.appendChild(reviewedBtn);

    var groupRequirementLabel = group.requirement || group.name;
    var groupIsNa = (typeof isChecklistRequirementNaForMediaKey === 'function')
      ? isChecklistRequirementNaForMediaKey(mediaKey, groupRequirementLabel)
      : false;
    var reviewedState = !!reviewed;
    if (!reviewedState && !groupIsNa) {
      var statusEl = document.createElement('span');
      statusEl.className = 'annotate-strip-group-status-pill';
      statusEl.textContent = 'Not reviewed';
      titleRowEl.appendChild(statusEl);
    }
    var hasActiveTerm = false;
    group.terms.forEach(function (term) {
      if (hasTagForMediaKey(mediaKey, term)) {
        hasActiveTerm = true;
      }
    });
    isComplete = !!(groupIsNa || hasActiveTerm);
    if (reviewedState) {
      groupEl.classList.add('annotate-strip-group-reviewed');
      titleEl.classList.add('annotate-strip-group-title-reviewed');
    } else if (!isComplete) {
      groupEl.classList.add('annotate-strip-group-incomplete');
    } else if (groupIsNa) {
      groupEl.classList.add('annotate-strip-group-na');
    } else {
      groupEl.classList.add('annotate-strip-group-complete');
    }

    titleRowEl.appendChild(controlsEl);
    groupEl.appendChild(titleRowEl);
    groupEl.addEventListener('dblclick', function (e) {
      var target = e.target;
      if (target && target.closest && target.closest('button, a, input, textarea, select, label')) return;
      e.preventDefault();
      toggleAnnotateGroupReviewed(mediaKey, group.requirement || group.name);
    });

    var chipWrap = document.createElement('div');
    chipWrap.className = 'annotate-strip-chip-wrap';

    var activeTermsByKey = {};
    var activeTermCount = 0;
    group.terms.forEach(function (term) {
      if (!hasTagForMediaKey(mediaKey, term)) return;
      var activeTermKey = normalizeAnnotateUsageKey(term);
      if (!activeTermKey || activeTermsByKey[activeTermKey]) return;
      activeTermsByKey[activeTermKey] = true;
      activeTermCount += 1;
    });

    if (activeTermCount <= 0) {
      var naChip = document.createElement('button');
      naChip.type = 'button';
      naChip.className = 'annotate-strip-chip annotate-strip-chip-na';
      if (groupIsNa) {
        naChip.classList.add('active');
      }
      naChip.textContent = 'n/a';
      naChip.title = groupIsNa ? 'Clear n/a override' : 'Mark this group n/a for current item';
      naChip.onclick = function () {
        toggleAnnotateGroupNa(group.requirement || group.name);
      };
      chipWrap.appendChild(naChip);
    }

    group.terms.forEach(function (term) {
      var chip = document.createElement('button');
      var groupKey = String(group.requirement || group.name || '').trim().toLowerCase();
      var termKey = normalizeAnnotateUsageKey(term);
      var usageCount = usageStats.countsByGroupTerm[groupKey + '::' + termKey] || 0;
      var folderUsageCount = usageStats.folderCountsByGroupTerm[groupKey + '::' + termKey] || 0;
      var usageMax = usageStats.maxCountByGroup[groupKey] || 0;
      var heatLevel = getAnnotateChipHeatLevel(usageCount, usageMax);
      chip.type = 'button';
      chip.className = 'annotate-strip-chip';
      chip.setAttribute('data-heat-level', String(heatLevel));
      var isActiveTerm = !!activeTermsByKey[termKey];
      var isInCaption = typeof tagAppearsInCurrentCaption === 'function'
        ? tagAppearsInCurrentCaption(term)
        : false;
      if (isActiveTerm) {
        chip.classList.add('active');
        hasActiveTerm = true;
        if (!isInCaption) {
          chip.classList.add('annotate-strip-chip-missing-caption');
          groupEl.classList.add('annotate-strip-group-tag-mismatch');
        }
      }
      var isGapHint = !isActiveTerm && isAnnotateChipGapHint(usageCount, usageStats.contextCount, heatLevel);
      if (isGapHint) {
        chip.classList.add('annotate-strip-chip-gap-hint');
        groupEl.classList.add('annotate-strip-group-gap-hints');
      } else if (!isActiveTerm && activeTermCount > 0) {
        chip.classList.add('annotate-strip-chip-compatible-muted');
      }
      if (!isActiveTerm && usageStats.contextCount > 0 && usageCount <= 0) {
        chip.classList.add('annotate-strip-chip-novel');
      }
      chip.textContent = term;
      var chipTitle = formatAnnotateChipUsageTitle(
        usageCount,
        usageStats.contextCount,
        folderUsageCount,
        usageStats.annotatedSiblingCount
      );
      if (isActiveTerm && !isInCaption) {
        chipTitle += ' - tag missing from caption';
      } else if (isGapHint) {
        chipTitle += ' - common nearby but missing on this item';
      } else if (!isActiveTerm && activeTermCount > 0) {
        chipTitle += ' - not selected on this item';
      }
      if (!isActiveTerm && usageStats.contextCount > 0 && usageCount <= 0) {
        chipTitle += ' - not used nearby';
      }
      chipTitle += ' - right-click to edit prefix/suffix';
      chip.title = chipTitle;
      chip.onclick = function () {
        if (groupIsNa && typeof setChecklistRequirementNaForMediaKey === 'function') {
          setChecklistRequirementNaForMediaKey(mediaKey, groupRequirementLabel, false);
        }
        toggleAnnotateTag(term);
      };
      chip.oncontextmenu = function (e) {
        e.preventDefault();
        openChecklistTermAffixesModal(term);
      };
      chipWrap.appendChild(chip);
    });
    if (!reviewedState) {
      if (groupIsNa) titleEl.classList.add('annotate-strip-group-title-na');
      else titleEl.classList.add(isComplete ? 'annotate-strip-group-title-complete' : 'annotate-strip-group-title-incomplete');
    }

    groupEl.appendChild(chipWrap);
    groupsWrap.appendChild(groupEl);
  });

  stripEl.appendChild(groupsWrap);
}

window.renderAnnotateStrip = renderAnnotateStrip;
window.setAnnotateStripVisible = setAnnotateStripVisible;
window.setCaptionHelperPanelCollapsed = setCaptionHelperPanelCollapsed;
window.updateAnnotateStripToggleUi = updateAnnotateStripToggleUi;
window.updateCaptionHelperCollapseUi = updateCaptionHelperCollapseUi;
