
// Caption requirements checklist logic (classic JS, robust, codebase-consistent)
var checklistPanelEl = null;
var checklistItems = DEFAULT_CHECKLIST_ITEMS.slice(); // Current folder's requirements
var checklistCheckedByMedia = {}; // { mediaKey: { item: true/false, ... } }
var debouncedChecklistSave = debounceCreate(400); // Debounce saves for checkbox changes

function checklistSort(a, b) {
  return String(a || '').toLowerCase().localeCompare(String(b || '').toLowerCase());
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
  if (typeof renderItemTagsPanel === 'function') {
    renderItemTagsPanel();
  }
  if (typeof renderItemMetadataPanel === 'function') {
    renderItemMetadataPanel();
  }
}

function saveChecklistToFolderState() {
  var snapshot = snapshotFolderStateFromDom();
  snapshot.caption_requirements = checklistItems.slice();
  snapshot.caption_requirements_checked = JSON.parse(JSON.stringify(checklistCheckedByMedia));
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
  checklistItems.sort(checklistSort);
  syncReviewedFromChecklistAll();
  renderChecklistPanel();
}
