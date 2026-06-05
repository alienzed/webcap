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
    var rawTerms = (checklistKeywordsByItem && checklistKeywordsByItem[groupName]) || '';
    var terms = parseAnnotateStripTerms(rawTerms);
    if (!terms.length) continue;
    groups.push({ name: groupName, requirement: groupName, terms: terms });
  }
  return groups;
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

  groups.forEach(function (group) {
    var groupEl = document.createElement('div');
    groupEl.className = 'annotate-strip-group';

    var titleRowEl = document.createElement('div');
    titleRowEl.className = 'annotate-strip-group-title-row';

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
      if (typeof toggleChecklistRequirementCheckedForMediaKey !== 'function') {
        setStatus('Reviewed toggle is unavailable.');
        return;
      }
      toggleChecklistRequirementCheckedForMediaKey(mediaKey, group.requirement || group.name);
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

    var chipWrap = document.createElement('div');
    chipWrap.className = 'annotate-strip-chip-wrap';

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

    group.terms.forEach(function (term) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'annotate-strip-chip';
      if (hasTagForMediaKey(mediaKey, term)) {
        chip.classList.add('active');
        hasActiveTerm = true;
      }
      chip.textContent = term;
      chip.title = 'Toggle tag';
      chip.onclick = function () {
        if (groupIsNa && typeof setChecklistRequirementNaForMediaKey === 'function') {
          setChecklistRequirementNaForMediaKey(mediaKey, groupRequirementLabel, false);
        }
        toggleAnnotateTag(term);
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
