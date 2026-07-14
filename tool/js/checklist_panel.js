function renderChecklistPanel() {
  if (!checklistPanelEl) checklistPanelEl = document.getElementById('caption-checklist-panel');
  var itemsDiv = document.getElementById('checklist-items');
  var groupWorkbenchList = document.getElementById('group-workbench-list');
  if (!itemsDiv && !groupWorkbenchList) return;
  if (typeof workspaceState !== 'undefined'
      && workspaceState
      && workspaceState.surface === 'grid'
      && typeof isMediaGridSurfaceOpen === 'function'
      && isMediaGridSurfaceOpen()
      && typeof mediaGridRenderSharedWorkbench === 'function') {
    setChecklistPanelVisible(true);
    if (itemsDiv) itemsDiv.innerHTML = '';
    mediaGridRenderSharedWorkbench();
    return;
  }
  if (typeof renderPrimerTemplatePlaceholderButtons === 'function') {
    renderPrimerTemplatePlaceholderButtons();
  }
  if (!state.currentItem) {
    if (itemsDiv) itemsDiv.innerHTML = '';
    if (groupWorkbenchList) {
      renderGroupWorkbench({
        mode: 'item',
        targetEl: groupWorkbenchList,
        mediaKeys: []
      });
    }
    setChecklistPanelVisible(true);
    renderItemTagsPanel();
    renderItemMetadataPanel();
    renderAnnotateStrip();
    return;
  }
  setChecklistPanelVisible(true);
  if (groupWorkbenchList) {
    renderGroupWorkbench({
      mode: 'item',
      targetEl: groupWorkbenchList,
      mediaKeys: [state.currentItem.key],
      currentMediaKey: state.currentItem.key
    });
  }
  if (!itemsDiv) return;
  itemsDiv.innerHTML = '';
  var checkedMap = checklistCheckedByMedia[state.currentItem.key] || {};
  var mediaKey = state.currentItem.key;
  for (var i = 0; i < checklistItems.length; i++) {
    var item = checklistItems[i];
    var row = document.createElement('div');
    row.className = 'checklist-row-block';

    var summaryRow = document.createElement('div');
    summaryRow.className = 'row-inline checklist-row-summary';
    if (!!checkedMap[item]) summaryRow.classList.add('checklist-row-reviewed');

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

    var captionText = (ui && ui.editorEl && typeof ui.editorEl.value === 'string')
      ? ui.editorEl.value
      : (state.currentItem.caption || '');
    if (requirementKeywordsMatch(item, captionText, mediaKey)) {
      summaryRow.classList.add('checklist-item-matched');
    }

    var actions = document.createElement('div');
    actions.className = 'checklist-row-actions';

    var moveUpBtn = document.createElement('button');
    moveUpBtn.textContent = '\u2191';
    moveUpBtn.title = 'Move requirement up';
    moveUpBtn.className = 'checklist-row-action-btn checklist-row-action-move';
    moveUpBtn.disabled = (i === 0);
    (function (idx, label) {
      moveUpBtn.onclick = function () {
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
    (function (requirementLabel) {
      editTermsBtn.onclick = function () {
        openChecklistGroupTermsModal(requirementLabel);
      };
    })(item);
    actions.appendChild(editTermsBtn);

    var rmBtn = document.createElement('button');
    rmBtn.textContent = '\u00D7';
    rmBtn.title = 'Remove requirement';
    rmBtn.className = 'checklist-row-action-btn checklist-row-action-remove';
    (function (idx, requirementLabel) {
      rmBtn.onclick = function () {
        checklistItems.splice(idx, 1);
        for (var k in checklistCheckedByMedia) {
          if (checklistCheckedByMedia[k]) delete checklistCheckedByMedia[k][requirementLabel];
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
