
// Caption requirements checklist logic (classic JS, robust, codebase-consistent)
var checklistPanelEl = null;
var checklistItems = DEFAULT_CHECKLIST_ITEMS.slice(); // Current folder's requirements
var checklistCheckedByMedia = {}; // { mediaKey: { item: true/false, ... } }
var debouncedChecklistSave = debounceCreate(400); // Debounce saves for checkbox changes
var checklistKeywordsByItem = {}; // { requirement: "keyword1, keyword2, ..." }

function checklistSort(a, b) {
  return String(a || '').toLowerCase().localeCompare(String(b || '').toLowerCase());
}

function requirementKeywordsMatch(requirementLabel, captionText) {
  var keywords = checklistKeywordsByItem[requirementLabel];
  if (!keywords) return false;
  
  var keywordList = keywords.split(',').map(function(k) { return k.trim().toLowerCase(); }).filter(Boolean);
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
  for (var i = 0; i < checklistItems.length; i++) {
    if (!checkedMap[checklistItems[i]]) return false;
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
  var reviewed = checklistAllCheckedForMedia(mediaKey);
  if (reviewed) state.reviewedSet.add(mediaKey);
  else state.reviewedSet.delete(mediaKey);
  setReviewedRowClass(mediaKey, reviewed);
}

function syncReviewedFromChecklistAll() {
  if (!state || !Array.isArray(state.items)) return;
  for (var i = 0; i < state.items.length; i++) {
    var item = state.items[i];
    if (!item || !item.key) continue;
    syncReviewedFromChecklist(item.key);
  }
}

function renderChecklistPanel() {
  if (!checklistPanelEl) checklistPanelEl = document.getElementById('caption-checklist-panel');
  var itemsDiv = document.getElementById('checklist-items');
  if (!itemsDiv) return;
  // Only show if a media item is selected
  if (!state.currentItem) {
    setChecklistPanelVisible(false);
    return;
  }
  setChecklistPanelVisible(true);
  itemsDiv.innerHTML = '';
  checklistItems.sort(checklistSort);
  var checkedMap = checklistCheckedByMedia[state.currentItem.key] || {};
  for (var i = 0; i < checklistItems.length; i++) {
    var item = checklistItems[i];
    var row = document.createElement('div');
    row.className = 'row-inline';
    var label = document.createElement('label');
    label.style.flex = '1';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!checkedMap[item];
    (function(item) {
      cb.onchange = function() {
        if (!state.currentItem) return;
        var mediaKey = state.currentItem.key;
        if (!checklistCheckedByMedia[mediaKey]) checklistCheckedByMedia[mediaKey] = {};
        checklistCheckedByMedia[mediaKey][item] = this.checked;
        syncReviewedFromChecklist(mediaKey);
        debouncedChecklistSave(saveChecklistToFolderState);
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
    // Remove button
    var rmBtn = document.createElement('button');
    rmBtn.textContent = '×';
    (function(idx, item) {
      rmBtn.onclick = function() {
        checklistItems.splice(idx, 1);
        for (var k in checklistCheckedByMedia) {
          if (checklistCheckedByMedia[k]) delete checklistCheckedByMedia[k][item];
        }
        syncReviewedFromChecklistAll();
        saveChecklistToFolderState();
        renderChecklistPanel();
      };
    })(i, item);
    row.appendChild(rmBtn);
    itemsDiv.appendChild(row);
  }
  renderItemTagsPanel();
  renderItemMetadataPanel();
}

function saveChecklistToFolderState() {
  var snapshot = snapshotFolderStateFromDom();
  snapshot.caption_requirements = checklistItems.slice();
  snapshot.caption_requirements_checked = JSON.parse(JSON.stringify(checklistCheckedByMedia));
  snapshot.caption_requirement_keywords = JSON.parse(JSON.stringify(checklistKeywordsByItem));
  if (typeof updatePrimerMappingsSummary === 'function') {
    updatePrimerMappingsSummary();
  }
  writeFolderStateFile(state.folder, snapshot);
}

function loadChecklistFromFolderState(folderState) {
  if (folderState.caption_requirements && Object.prototype.toString.call(folderState.caption_requirements) === '[object Array]') {
    checklistItems = folderState.caption_requirements.slice();
  } else {
    checklistItems = DEFAULT_CHECKLIST_ITEMS.slice();
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

  checklistItems.sort(checklistSort);

  // Fill missing keyword values for default checklist items.
  for (var i = 0; i < checklistItems.length; i++) {
    var requirement = checklistItems[i];
    if (!checklistKeywordsByItem[requirement] && typeof DEFAULT_CHECKLIST_ITEM_KEYWORDS === 'object') {
      var defaultKeywords = String(DEFAULT_CHECKLIST_ITEM_KEYWORDS[requirement] || '').trim();
      if (defaultKeywords) {
        checklistKeywordsByItem[requirement] = defaultKeywords;
      }
    }
  }

  syncReviewedFromChecklistAll();
  if (typeof updatePrimerMappingsSummary === 'function') {
    updatePrimerMappingsSummary();
  }
  renderChecklistPanel();
}


// Temporary object for modal edits
var checklistKeywordsModalTemp = null;

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
  checklistItems.sort(checklistSort);
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

document.addEventListener('click', function(e) {
  if (e.target && e.target.dataset.closeModal === 'checklist-keywords-modal') {
    closeChecklistKeywordsModal();
  }
});

document.addEventListener('click', function(e) {
  if (e.target && e.target.id === 'modal-overlay') {
    closeChecklistKeywordsModal();
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
document.addEventListener('click', function(e) {
  if (e.target && (e.target.dataset.closeModal === 'checklist-keywords-modal' || e.target.id === 'modal-overlay')) {
    discardChecklistKeywordsModalTemp();
  }
});
