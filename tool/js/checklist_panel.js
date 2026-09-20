var checklistDragSourceIndex = null;

function clearChecklistDropIndicators() {
  var rows = document.querySelectorAll('#checklist-items .checklist-row-block');
  for (var i = 0; i < rows.length; i++) {
    rows[i].classList.remove('checklist-drop-before', 'checklist-drop-after');
    rows[i].removeAttribute('data-checklist-drop-after');
  }
}

function clearChecklistDragState() {
  clearChecklistDropIndicators();
  var rows = document.querySelectorAll('#checklist-items .checklist-row-block');
  for (var i = 0; i < rows.length; i++) {
    rows[i].classList.remove('is-dragging');
  }
  checklistDragSourceIndex = null;
}

function positionChecklistRowOverflowMenu(summaryEl, menuEl) {
  var triggerRect = summaryEl.getBoundingClientRect();
  var menuWidth = menuEl.offsetWidth;
  var menuHeight = menuEl.offsetHeight;
  var viewportWidth = document.documentElement.clientWidth;
  var viewportHeight = document.documentElement.clientHeight;
  var gap = 4;
  var edge = 6;

  var left = triggerRect.right - menuWidth;
  left = Math.max(edge, Math.min(left, viewportWidth - menuWidth - edge));

  var top = triggerRect.bottom + gap;
  if (top + menuHeight > viewportHeight - edge) {
    top = triggerRect.top - menuHeight - gap;
  }
  top = Math.max(edge, Math.min(top, viewportHeight - menuHeight - edge));

  menuEl.style.left = Math.round(left) + 'px';
  menuEl.style.top = Math.round(top) + 'px';
}

function renderChecklistPanel(options) {
  var opts = options || {};
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
    if (!opts.skipItemDetailRefresh) {
      renderItemTagsPanel();
      renderItemMetadataPanel();
      renderAnnotateStrip();
    }
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
    row.setAttribute('data-checklist-index', String(i));
    (function (targetIndex, rowEl) {
      rowEl.ondragover = function (event) {
        if (checklistDragSourceIndex === null) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        clearChecklistDropIndicators();
        if (checklistDragSourceIndex === targetIndex) return;
        var rect = rowEl.getBoundingClientRect();
        var dropAfter = event.clientY > rect.top + (rect.height / 2);
        rowEl.classList.add(dropAfter ? 'checklist-drop-after' : 'checklist-drop-before');
        rowEl.setAttribute('data-checklist-drop-after', dropAfter ? 'true' : 'false');
      };
      rowEl.ondragleave = function (event) {
        if (event.relatedTarget && rowEl.contains(event.relatedTarget)) return;
        rowEl.classList.remove('checklist-drop-before', 'checklist-drop-after');
        rowEl.removeAttribute('data-checklist-drop-after');
      };
      rowEl.ondrop = function (event) {
        if (checklistDragSourceIndex === null) return;
        event.preventDefault();
        var fromIndex = checklistDragSourceIndex;
        var dropAfter = rowEl.getAttribute('data-checklist-drop-after') === 'true';
        clearChecklistDragState();
        if (fromIndex === targetIndex) return;
        var toIndex = targetIndex + (dropAfter ? 1 : 0);
        if (fromIndex < toIndex) toIndex -= 1;
        var movedLabel = checklistItems[fromIndex];
        if (moveChecklistItemToIndex(fromIndex, toIndex)) {
          setStatus('Moved requirement: ' + movedLabel);
        }
      };
    })(i, row);

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

    var dragHandle = document.createElement('span');
    dragHandle.className = 'checklist-row-drag-handle';
    dragHandle.textContent = '\u283f';
    dragHandle.title = 'Drag to reorder';
    dragHandle.draggable = true;
    dragHandle.setAttribute('aria-hidden', 'true');
    (function (sourceIndex, rowEl) {
      dragHandle.ondragstart = function (event) {
        checklistDragSourceIndex = sourceIndex;
        rowEl.classList.add('is-dragging');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', String(sourceIndex));
        }
      };
      dragHandle.ondragend = function () {
        clearChecklistDragState();
      };
    })(i, row);

    var labelText = document.createElement('span');
    labelText.className = 'checklist-row-label-text';
    labelText.textContent = item;
    label.appendChild(toggleBtn);
    label.appendChild(labelText);
    label.appendChild(dragHandle);
    summaryRow.appendChild(label);

    var captionText = (ui && ui.editorEl && typeof ui.editorEl.value === 'string')
      ? ui.editorEl.value
      : (state.currentItem.caption || '');
    if (requirementKeywordsMatch(item, captionText, mediaKey)) {
      summaryRow.classList.add('checklist-item-matched');
    }

    var actions = document.createElement('div');
    actions.className = 'checklist-row-actions';

    var visibilityBtn = document.createElement('button');
    visibilityBtn.type = 'button';
    visibilityBtn.textContent = '👁';
    visibilityBtn.className = 'checklist-row-action-btn checklist-group-visibility-btn';
    var isGroupHidden = isChecklistRequirementHidden(item);
    visibilityBtn.classList.toggle('is-hidden', isGroupHidden);
    visibilityBtn.title = isGroupHidden
      ? 'Show ' + item + ' in Annotation Groups'
      : 'Hide ' + item + ' from Annotation Groups';
    visibilityBtn.setAttribute('aria-label', visibilityBtn.title);
    visibilityBtn.setAttribute('aria-pressed', isGroupHidden ? 'false' : 'true');
    (function (requirementLabel, nextHidden) {
      visibilityBtn.onclick = function () {
        if (!setChecklistRequirementHidden(requirementLabel, nextHidden)) return;
        setStatus((nextHidden ? 'Hidden from' : 'Shown in') + ' Annotation Groups: ' + requirementLabel);
        renderChecklistPanel({ skipItemDetailRefresh: true });
      };
    })(item, !isGroupHidden);
    actions.appendChild(visibilityBtn);

    var editTermsBtn = document.createElement('button');
    editTermsBtn.type = 'button';
    editTermsBtn.textContent = 'Edit terms';
    editTermsBtn.className = 'checklist-row-menu-item';
    editTermsBtn.setAttribute('role', 'menuitem');
    (function (requirementLabel) {
      editTermsBtn.onclick = function () {
        menuDetails.open = false;
        openChecklistGroupTermsModal(requirementLabel);
      };
    })(item);

    var moveUpBtn = document.createElement('button');
    moveUpBtn.type = 'button';
    moveUpBtn.textContent = 'Move up';
    moveUpBtn.className = 'checklist-row-menu-item';
    moveUpBtn.setAttribute('role', 'menuitem');
    moveUpBtn.disabled = (i === 0);
    (function (idx, label) {
      moveUpBtn.onclick = function () {
        menuDetails.open = false;
        if (moveChecklistItemByOffset(idx, -1)) {
          setStatus('Moved requirement up: ' + label);
        }
      };
    })(i, item);

    var moveDownBtn = document.createElement('button');
    moveDownBtn.type = 'button';
    moveDownBtn.textContent = 'Move down';
    moveDownBtn.className = 'checklist-row-menu-item';
    moveDownBtn.setAttribute('role', 'menuitem');
    moveDownBtn.disabled = (i === checklistItems.length - 1);
    (function (idx, label) {
      moveDownBtn.onclick = function () {
        menuDetails.open = false;
        if (moveChecklistItemByOffset(idx, 1)) {
          setStatus('Moved requirement down: ' + label);
        }
      };
    })(i, item);

    var rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.textContent = 'Remove group';
    rmBtn.className = 'checklist-row-menu-item checklist-row-menu-item-danger';
    rmBtn.setAttribute('role', 'menuitem');
    (function (idx) {
      rmBtn.onclick = function () {
        menuDetails.open = false;
        deleteChecklistGroupByIndex(idx);
      };
    })(i);

    var menuDetails = document.createElement('details');
    menuDetails.className = 'checklist-row-overflow';
    menuDetails.ontoggle = function () {
      if (!menuDetails.open) return;
      var openMenus = document.querySelectorAll('#checklist-items .checklist-row-overflow[open]');
      for (var menuIndex = 0; menuIndex < openMenus.length; menuIndex++) {
        if (openMenus[menuIndex] !== menuDetails) openMenus[menuIndex].open = false;
      }
      requestAnimationFrame(function () {
        if (menuDetails.open) positionChecklistRowOverflowMenu(menuSummary, menu);
      });
    };
    menuDetails.onfocusout = function (event) {
      if (!menuDetails.contains(event.relatedTarget)) menuDetails.open = false;
    };

    var menuSummary = document.createElement('summary');
    menuSummary.className = 'checklist-row-overflow-btn';
    menuSummary.textContent = '\u22ee';
    menuSummary.title = 'More group actions';
    menuSummary.setAttribute('aria-label', 'More actions for ' + item);

    var menu = document.createElement('div');
    menu.className = 'checklist-row-menu';
    menu.setAttribute('role', 'menu');
    menu.appendChild(editTermsBtn);
    menu.appendChild(moveUpBtn);
    menu.appendChild(moveDownBtn);
    menu.appendChild(rmBtn);
    menuDetails.appendChild(menuSummary);
    menuDetails.appendChild(menu);

    actions.appendChild(menuDetails);

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
  if (!opts.skipItemDetailRefresh) {
    renderItemTagsPanel();
    renderItemMetadataPanel();
    renderAnnotateStrip();
  }
}
