// Hide checklist panel and clear current media selection
function clearEditorAndPreview() {
  if (ui && ui.editorEl) {
    ui.editorEl.value = '';
  }
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = '';
  }
  if (ui && ui.previewEl) {
    var doc = ui.previewEl.contentDocument || ui.previewEl.contentdocument;
    if (doc) {
      doc.open();
      doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:system-ui;padding:1rem;color:#666;">No media to preview.</body></html>');
      doc.close();
    }
  }
  var checklistPanelEl = document.getElementById('caption-checklist-panel');
  if (checklistPanelEl) checklistPanelEl.style.display = 'none';
  state.currentItem = null;
  updatePreviewActionControls();
}

function clearSelection() {
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = '';
  }
  state.currentItem = null;
  state.currentConfigFile = null;
  renderFileList(ui.filterEl.value);
}

function createFlagAction(itemKey) {
  function flagRowRenderer(color) {
    markFlag(itemKey, color);
  }

  return {
    label: 'Flag',
    render: flagRowRenderer
  };
}

function runAutosetForCurrentFolder() {
  if (!state.folder) {
    setStatus('No folder selected for autoset.');
    return;
  }
  setStatus('Running legacy autoset...');
  streamPreviewFromFetch(
    '/fs/autoset_run',
    { folder: state.folder },
    ui,
    function () {
      setStatus('Legacy autoset finished.');
    },
    function (err) {
      setStatus('Autoset failed: ' + err);
    }
  );
}

function ensureFolderSelected(missingStatus) {
  if (state.folder) return true;
  setStatus(missingStatus || 'No folder selected.');
  return false;
}

function resetSelectionForFolderAction() {
  state.currentConfigFile = null;
  state.currentItem = null;
  clearEditorAndPreview();
  renderChecklistPanel();
  renderFileList(ui.filterEl.value);
}

function runGenerateDatasetConfigsForCurrentFolder(onSuccess) {
  if (!ensureFolderSelected('No folder selected for config generation.')) {
    return;
  }
  resetSelectionForFolderAction();
  setStatus('Generating dataset configs...');
  streamPreviewFromFetch(
    '/fs/generate_dataset_config',
    { folder: state.folder },
    ui,
    function () {
      if (typeof onSuccess === 'function') {
        onSuccess();
        return;
      }
      setStatus('Dataset configs generated.');
    },
    function (err) {
      setStatus('Dataset config generation failed: ' + err);
    }
  );
}

function runPrepareDatasetForCurrentFolder() {
  if (!ensureFolderSelected('No folder selected for dataset preparation.')) {
    return;
  }
  var visibleRows = Array.prototype.slice.call(
    ui.mediaListEl ? ui.mediaListEl.querySelectorAll('.media-item[data-type="media"]') : []
  );
  var selectedMedia = visibleRows
    .map(function (row) { return String(row.getAttribute('data-key') || '').trim(); })
    .filter(Boolean);
  var totalMediaCount = Array.isArray(state.items) ? state.items.length : 0;
  if (!selectedMedia.length) {
    setStatus('No visible media items to prepare.');
    return;
  }
  if (totalMediaCount > 0 && selectedMedia.length < totalMediaCount) {
    var confirmText = 'Prepare visible subset only? (' + selectedMedia.length + ' of ' + totalMediaCount + ' media items)';
    if (!confirm(confirmText)) {
      setStatus('Dataset preparation cancelled.');
      return;
    }
  }
  var minStars = (typeof getAdvancedMinStarsThreshold === 'function') ? getAdvancedMinStarsThreshold() : null;
  var flagValue = (typeof getAdvancedFlagFilterValue === 'function') ? getAdvancedFlagFilterValue() : '';
  var criteria = {
    source_folder: String(state.folder || ''),
    filter_text: String((ui.filterEl && ui.filterEl.value) || '').trim(),
    missing_captions_only: !!(ui.advancedFilterMissingCaptionsEl && ui.advancedFilterMissingCaptionsEl.checked),
    reviewed_only: !!(ui.advancedFilterReviewedEl && ui.advancedFilterReviewedEl.checked),
    unrated_only: !!(ui.advancedFilterUnratedEl && ui.advancedFilterUnratedEl.checked),
    invalid_ar_only: !!(ui.advancedFilterInvalidArEl && ui.advancedFilterInvalidArEl.checked),
    min_stars_gt: minStars === null ? '' : String(minStars),
    flag_filter: String(flagValue || ''),
    focus_set_active: !!(state.focusSet && state.focusSet.keys && state.focusSet.keys.length),
    focus_set_source: String((state.focusSet && state.focusSet.source) || ''),
  };
  resetSelectionForFolderAction();
  setStatus('Preparing dataset...');
  streamPreviewFromFetch(
    '/fs/prepare_dataset',
    {
      folder: state.folder,
      selected_media: selectedMedia,
      total_media_count: totalMediaCount,
      selection_criteria: criteria
    },
    ui,
    function () {
      setStatus('Dataset preparation finished.');
      refreshTrainingConfigList();
    },
    function (err) {
      setStatus('Dataset preparation failed: ' + err);
    }
  );
}

function isEditableElement(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  var tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

function moveSelectedMediaByOffset(offset) {
  if (!offset || !state.currentItem || !state.currentItem.fileName || !ui.mediaListEl) {
    return false;
  }
  var rows = Array.prototype.slice.call(
    ui.mediaListEl.querySelectorAll('.media-item[data-type="media"]')
  );
  if (!rows.length) {
    return false;
  }
  var currentKey = state.currentItem.key;
  var idx = rows.findIndex(function (row) {
    return row.getAttribute('data-key') === currentKey;
  });
  if (idx === -1) {
    return false;
  }
  var nextIdx = idx + offset;
  if (nextIdx < 0 || nextIdx >= rows.length) {
    return false;
  }
  var nextKey = rows[nextIdx].getAttribute('data-key');
  if (!nextKey || nextKey === currentKey) {
    return false;
  }
  var nextItem = state.items.find(function (item) {
    return item && item.key === nextKey;
  });
  if (!nextItem) {
    return false;
  }

  var goNext = function () {
    selectPathMedia(nextItem).catch(function (err) {
      setStatus(String(err && err.message ? err.message : err));
    });
  };
  if (state.currentItem && state.currentItem.fileName) {
    savePathCaption().then(goNext).catch(function (err) {
      setStatus(String(err && err.message ? err.message : err));
    });
  } else {
    goNext();
  }
  return true;
}

var sidebarActiveTab = 'config';

function setSidebarTab(tabName) {
  var tabs = {
    config: { buttonId: 'sidebar-tab-config-btn', paneId: 'primer-details' },
    review: { buttonId: 'sidebar-tab-review-btn', paneId: 'cation-review' },
    train: { buttonId: 'sidebar-tab-train-btn', paneId: 'training-details' }
  };
  var activeName = tabs[tabName] ? tabName : 'review';
  sidebarActiveTab = activeName;

  Object.keys(tabs).forEach(function (name) {
    var tab = tabs[name];
    var btn = document.getElementById(tab.buttonId);
    var pane = document.getElementById(tab.paneId);
    var active = name === activeName;
    if (btn) {
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
    }
    if (pane) {
      pane.classList.toggle('hidden', !active);
      pane.setAttribute('aria-hidden', active ? 'false' : 'true');
    }
  });
}

function wireSidebarTabs() {
  var buttons = document.querySelectorAll('[data-sidebar-tab]');
  if (!buttons.length) return;
  Array.prototype.forEach.call(buttons, function (btn) {
    btn.onclick = function () {
      setSidebarTab(btn.getAttribute('data-sidebar-tab'));
    };
  });
  setSidebarTab(sidebarActiveTab);
}

function wireAllUi() {
  // Autosaving of primer/stats changes (debounced)
  wireStatsPrimerAutoSave();
  if (typeof wireStatsBalancePhraseUi === 'function') {
    wireStatsBalancePhraseUi();
  }

  // Wire up review actions (if stats.js is loaded)
  wireReviewActions();
  
  // Wire up CTRL+S/CMD+S to new save logic
  ui.editorEl.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      saveCurrentEditorContent();
    }
  });

  checklistPanelEl = document.getElementById('caption-checklist-panel');
  setChecklistPanelVisible(false);
  wireCaptionHelpersUi();
  wireItemDetailsUi();
  if (typeof wirePreviewActionControls === 'function') {
    wirePreviewActionControls();
  }
  if (typeof updatePreviewActionControls === 'function') {
    updatePreviewActionControls();
  }
  wireSidebarTabs();
  if (typeof wireAppSettingsUi === 'function') {
    wireAppSettingsUi();
  }
  var addInput = document.getElementById('checklist-add-input');
  var addBtn = document.getElementById('checklist-add-btn');
  if (addBtn && addInput) {
    addBtn.onclick = function() {
      var val = addInput.value.trim();
      if (!val || checklistItems.indexOf(val) !== -1) return;
      checklistItems.push(val);
      checklistItems.sort(checklistSort);
      for (var k in checklistCheckedByMedia) {
        if (checklistCheckedByMedia[k]) checklistCheckedByMedia[k][val] = false;
      }
      syncReviewedFromChecklistAll();
      saveChecklistToFolderState();
      renderChecklistPanel();
      addInput.value = '';
    };
    addInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') addBtn.onclick();
    });
  }

  var closeBtn = document.getElementById('checklist-close-btn');
  if (closeBtn) {
    closeBtn.onclick = function() {
      checklistPanelEl.style.display = 'none';
    };
  }

  ui.editorEl.addEventListener('input', handleEditorInputAutosave);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'F2' && document.activeElement !== ui.editorEl && state.currentItem) {
      var inOriginals = state.folder && state.folder.split(/[\/]/).pop() === 'originals';
      if (!inOriginals) {
        e.preventDefault();
        promptRenameMedia(state.currentItem);
      }
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (!state.currentItem || !state.currentItem.fileName) return;
    if (isEditableElement(document.activeElement)) return;
    var handled = moveSelectedMediaByOffset(e.key === 'ArrowUp' ? -1 : 1);
    if (handled) {
      e.preventDefault();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'Delete') return;
    if (!state.currentItem || !state.currentItem.fileName) return;
    if (isEditableElement(document.activeElement)) return;
    var inOriginals = state.folder && state.folder.split(/[\/]/).pop() === 'originals';
    if (inOriginals) return;
    e.preventDefault();
    pruneMedia(state.currentItem).catch(function (err) {
      setStatus(String(err && err.message ? err.message : err));
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || !e.shiftKey) return;
    var active = document.activeElement;
    var allowWhenReadonlyEditor = !!(active === ui.editorEl && ui.editorEl && ui.editorEl.readOnly);
    if (isEditableElement(active) && !allowWhenReadonlyEditor) return;
    if (!/^[1-9]$/.test(e.key)) return;
    if (typeof moveBalancePhraseByHotkeyNumber === 'function') {
      var moved = moveBalancePhraseByHotkeyNumber(Number(e.key));
      if (moved) {
        e.preventDefault();
        return;
      }
    }
    if (!state.currentItem || !state.currentItem.fileName) return;
    if (typeof getBalancePhraseByHotkeyNumber !== 'function') return;
    if (typeof addBalancePhraseTagToCurrentMedia !== 'function') return;
    var phrase = getBalancePhraseByHotkeyNumber(Number(e.key));
    if (!phrase) return;
    e.preventDefault();
    addBalancePhraseTagToCurrentMedia(phrase);
  });
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (!state.currentItem || !state.currentItem.fileName) return;
    if (isEditableElement(document.activeElement)) return;
    if (!/^[0-5]$/.test(e.key)) return;
    if (typeof setRatingForMediaKey !== 'function') return;
    e.preventDefault();
    var rating = Number(e.key);
    setRatingForMediaKey(state.currentItem.key, rating);
    if (rating <= 0) {
      setStatus('Rating cleared');
      return;
    }
    setStatus('Rating set: ' + rating + ' stars');
  });
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (!state.currentItem || !state.currentItem.fileName) return;
    if (isEditableElement(document.activeElement)) return;
    if (typeof markFlag !== 'function') return;
    var key = String(e.key || '').toLowerCase();
    var colorByKey = {
      g: 'green',
      y: 'yellow',
      o: 'orange',
      b: 'blue',
      r: 'red'
    };
    var color = colorByKey[key];
    if (!color) return;
    e.preventDefault();
    markFlag(state.currentItem.key, color);
    setStatus('Flag set: ' + color);
  });

  if (ui.advancedFilterToggleBtn && ui.advancedFilterPanel) {
    ui.advancedFilterToggleBtn.onclick = function () {
      var isHidden = ui.advancedFilterPanel.classList.contains('hidden');
      ui.advancedFilterPanel.classList.toggle('hidden', !isHidden);
      ui.advancedFilterToggleBtn.classList.toggle('expanded', isHidden);
      ui.advancedFilterToggleBtn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
    };
  }

  if (typeof wireMainUiEvents === 'function') {
    wireMainUiEvents();
  }

}

addEventListener('DOMContentLoaded', function () {
  console.log('[webcap] initializing');
  refreshCurrentDirectory();
  wireAllUi();
});
