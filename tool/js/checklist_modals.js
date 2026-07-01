var checklistKeywordsModalTemp = null;
var checklistGroupTermsModalState = null;
var checklistTermAffixesModalState = null;

function ensureChecklistWorkspaceOverlayNodes() {
  ensureWorkspaceOverlayChildren([
    'modal-overlay',
    'checklist-keywords-modal',
    'checklist-group-terms-modal',
    'checklist-term-affixes-modal'
  ]);
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
    if (typeof renderFocusedAnnotationModal === 'function') {
      renderFocusedAnnotationModal();
    }
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
  ensureChecklistWorkspaceOverlayNodes();
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
}

function removeChecklistGroupModalTerm(rawTerm) {
  if (!checklistGroupTermsModalState) return false;
  var requirement = normalizeChecklistRequirementKey(checklistGroupTermsModalState.requirement);
  var term = normalizeChecklistTerm(rawTerm);
  if (!requirement || !term) return false;
  if (isChecklistGroupTermPinnedGlobally(requirement, term)) {
    return setChecklistSessionHiddenTermForRequirement(requirement, term, true);
  }
  var target = term.toLowerCase();
  var previousLength = (checklistGroupTermsModalState.terms || []).length;
  checklistGroupTermsModalState.terms = normalizeChecklistTermsList((checklistGroupTermsModalState.terms || []).filter(function (current) {
    return normalizeChecklistTerm(current).toLowerCase() !== target;
  }));
  return checklistGroupTermsModalState.terms.length !== previousLength;
}

function addChecklistGroupModalTerm(rawTerm) {
  if (!checklistGroupTermsModalState) return false;
  var term = normalizeChecklistTerm(rawTerm);
  if (!term) return false;
  var requirement = normalizeChecklistRequirementKey(checklistGroupTermsModalState.requirement);
  if (isChecklistSessionHiddenTermForRequirement(requirement, term)) {
    setChecklistSessionHiddenTermForRequirement(requirement, term, false);
    checklistGroupTermsModalState.terms = getChecklistKeywordTermsForRequirement(requirement);
    renderChecklistPanel();
    renderChecklistGroupTermsModalItems();
    renderChecklistGroupTermsModalResults('');
    var hiddenInput = document.getElementById('checklist-group-terms-input');
    if (hiddenInput) hiddenInput.value = '';
    return true;
  }
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
  terms.forEach(function (term) {
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
    removeBtn.title = isPinned ? 'Hide pinned term until reload' : 'Remove term';
    removeBtn.textContent = 'x';
    removeBtn.onclick = function () {
      if (!removeChecklistGroupModalTerm(term)) return;
      if (isPinned) {
        checklistGroupTermsModalState.terms = getChecklistKeywordTermsForRequirement(checklistGroupTermsModalState.requirement);
        renderChecklistPanel();
      } else {
        applyChecklistGroupTermsModalChanges();
      }
      renderChecklistGroupTermsModalItems();
      renderChecklistGroupTermsModalResults('');
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
  var catalog = getChecklistGroupTermsCatalog(checklistGroupTermsModalState.requirement);
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
  ensureChecklistWorkspaceOverlayNodes();
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
  closeChecklistKeywordsModal();
  checklistKeywordsModalTemp = null;
}

function renderChecklistKeywordsModal() {
  var listDiv = document.getElementById('checklist-keywords-modal-body') || document.getElementById('checklist-keywords-list');
  if (!listDiv) return;
  listDiv.innerHTML = '';
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
    input.oninput = function () {
      checklistKeywordsModalTemp[this.dataset.requirement] = this.value;
    };
    input.onchange = function () {
      checklistKeywordsModalTemp[this.dataset.requirement] = this.value;
    };
    input.onkeydown = function (e) {
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
  ensureChecklistWorkspaceOverlayNodes();
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

function discardChecklistKeywordsModalTemp() {
  checklistKeywordsModalTemp = null;
}

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

document.addEventListener('click', function (e) {
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

document.addEventListener('click', function (e) {
  if (e.target && e.target.id === 'modal-overlay') {
    closeChecklistKeywordsModal();
    closeChecklistGroupTermsModal();
    closeChecklistTermAffixesModal();
    discardChecklistKeywordsModalTemp();
  }
});

document.addEventListener('click', function (e) {
  if (e.target && e.target.id === 'checklist-keywords-save-btn') {
    saveChecklistKeywordsModalAndClose();
  }
});

window.openChecklistGroupTermsModal = openChecklistGroupTermsModal;
window.openChecklistTermAffixesModal = openChecklistTermAffixesModal;
