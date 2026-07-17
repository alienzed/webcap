function createFlagAction(itemKey) {
  function flagRowRenderer(color) {
    markFlag(itemKey, color);
  }

  return {
    label: 'Flag',
    render: flagRowRenderer
  };
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

function runTrainingActionRequest(url, body) {
  function getOutputErrorMessage(outputText) {
    var lines = String(outputText || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i += 1) {
      var line = String(lines[i] || '').trim();
      if (line.indexOf('[ERROR]') === 0) {
        return line.replace(/^\[ERROR\]\s*/, '') || line;
      }
    }
    return '';
  }

  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function (response) {
    return response.text().then(function (outputText) {
      if (!response.ok) {
        throw new Error(outputText || response.statusText || 'Request failed');
      }
      var errorMessage = getOutputErrorMessage(outputText);
      if (errorMessage) {
        throw new Error(errorMessage);
      }
      return String(outputText || '');
    });
  });
}

function formatTrainingActionErrorMessage(err) {
  return String(err && err.message ? err.message : err).replace(/^\[ERROR\]\s*/, '').trim();
}

function buildCurrentFolderRelativePath(pathSuffix) {
  var folder = String(state.folder || '').replace(/[\\/]+$/, '');
  var suffix = String(pathSuffix || '').replace(/^[\\/]+/, '');
  if (!folder) return suffix;
  if (!suffix) return folder;
  return folder + '/' + suffix;
}

function fetchPathExistsForCurrentFolder(pathSuffix) {
  return fetch('/fs/path_exists?path=' + encodeURIComponent(buildCurrentFolderRelativePath(pathSuffix)))
    .then(function (resp) {
      return resp.json().then(function (data) {
        return { status: resp.status, data: data };
      });
    })
    .then(function (res) {
      if (res.status !== 200 || !res.data || !res.data.ok) {
        throw new Error((res.data && res.data.error) ? res.data.error : 'Path existence check failed');
      }
      return !!res.data.exists;
    });
}

function getVisibleMediaSelectionForPrepare() {
  var visibleRows = Array.prototype.slice.call(
    ui.mediaListEl ? ui.mediaListEl.querySelectorAll('.media-item[data-type="media"]') : []
  );
  return visibleRows
    .map(function (row) { return String(row.getAttribute('data-key') || '').trim(); })
    .filter(Boolean);
}

function buildPrepareFallbackCaptions(selectedMedia) {
  var selectedKeys = Array.isArray(selectedMedia) ? selectedMedia : [];
  var byKey = {};
  var fallbackCaptions = {};
  var fallbackCount = 0;
  (state.items || []).forEach(function (item) {
    if (item && item.key) byKey[item.key] = item;
  });
  selectedKeys.forEach(function (key) {
    var item = byKey[key];
    if (!item || !item.fileName) return;
    var hasCaption = !!(item.hasCaption || String(item.caption || '').trim().length);
    if (hasCaption) return;
    var primerText = String(buildAutoPrimer(item.fileName, item.key) || '').trim();
    if (!primerText) return;
    fallbackCaptions[item.fileName] = primerText;
    fallbackCount += 1;
  });
  return {
    fallbackCaptions: fallbackCaptions,
    fallbackCount: fallbackCount
  };
}

function buildPrepareSelectionCriteria() {
  var starsValue = (typeof getAdvancedStarFilterValue === 'function') ? getAdvancedStarFilterValue() : '';
  var flagValue = (typeof getAdvancedFlagFilterValue === 'function') ? getAdvancedFlagFilterValue() : '';
  return {
    source_folder: String(state.folder || ''),
    filter_text: String((ui.filterEl && ui.filterEl.value) || '').trim(),
    missing_captions_only: !!(ui.advancedFilterMissingCaptionsEl && ui.advancedFilterMissingCaptionsEl.checked),
    reviewed_only: !!(ui.advancedFilterReviewedEl && ui.advancedFilterReviewedEl.checked),
    unreviewed_only: !!(ui.advancedFilterUnreviewedEl && ui.advancedFilterUnreviewedEl.checked),
    incomplete_only: !!(ui.advancedFilterIncompleteEl && ui.advancedFilterIncompleteEl.checked),
    tag_mismatch_only: !!(ui.advancedFilterUntaggedEl && ui.advancedFilterUntaggedEl.checked),
    text_match_mode: 'all',
    invalid_ar_only: !!(ui.advancedFilterInvalidArEl && ui.advancedFilterInvalidArEl.checked),
    min_stars_gt: '',
    star_filter: String(starsValue || ''),
    flag_filter: String(flagValue || ''),
    focus_set_active: !!(state.focusSet && state.focusSet.keys && state.focusSet.keys.length),
    focus_set_source: String((state.focusSet && state.focusSet.source) || ''),
  };
}

function ensurePrepManifestForCurrentFolder() {
  return fetchPathExistsForCurrentFolder('auto_dataset/prep_manifest.json')
    .then(function (exists) {
      if (exists) return '';
      return runPrepareDatasetForCurrentFolder();
    });
}

function ensureGeneratedTrainingArtifactsForCurrentFolder() {
  return Promise.all([
    fetchPathExistsForCurrentFolder('config.hi.toml'),
    fetchPathExistsForCurrentFolder('config.lo.toml'),
    fetchPathExistsForCurrentFolder('dataset.hi.toml'),
    fetchPathExistsForCurrentFolder('dataset.lo.toml')
  ]).then(function (results) {
    var ready = results.every(function (value) { return !!value; });
    if (ready) return '';
    return runGenerateDatasetConfigsForCurrentFolder();
  });
}

function runGenerateDatasetConfigsForCurrentFolder(onSuccess) {
  if (!ensureFolderSelected('No folder selected for config generation.')) {
    return Promise.reject(new Error('No folder selected for config generation.'));
  }
  return ensurePrepManifestForCurrentFolder()
    .then(function () {
      resetSelectionForFolderAction();
      setStatus('Generating dataset configs...');
       return runTrainingActionRequest('/fs/generate_dataset_config', {
         folder: state.folder,
         mode: getTrainingWorkspaceSelectedProfile(state.folder)
       });
    })
    .then(function (outputText) {
      if (typeof onSuccess === 'function') {
        onSuccess(outputText);
      } else {
        setStatus('Dataset configs generated.');
      }
      return outputText;
    })
    .catch(function (err) {
      var message = formatTrainingActionErrorMessage(err);
      setStatus('Dataset config generation failed: ' + message);
      throw err;
    });
}

function runPrepareDatasetForCurrentFolder() {
  if (!ensureFolderSelected('No folder selected for dataset preparation.')) {
    return Promise.reject(new Error('No folder selected for dataset preparation.'));
  }
  var selectedMedia = getVisibleMediaSelectionForPrepare();
  var totalMediaCount = Array.isArray(state.items) ? state.items.length : 0;
  if (!selectedMedia.length) {
    setStatus('No visible media items to prepare.');
    return Promise.reject(new Error('No visible media items to prepare.'));
  }
  var criteria = buildPrepareSelectionCriteria();
  var fallbackResult = buildPrepareFallbackCaptions(selectedMedia);
  resetSelectionForFolderAction();
  if (totalMediaCount > 0 && selectedMedia.length < totalMediaCount) {
    setStatus('Preparing visible subset: ' + selectedMedia.length + ' of ' + totalMediaCount + ' media items...');
  } else {
    setStatus('Preparing dataset...');
  }
  return runTrainingActionRequest('/fs/prepare_dataset', {
    folder: state.folder,
    selected_media: selectedMedia,
    total_media_count: totalMediaCount,
    selection_criteria: criteria,
    fallback_captions: fallbackResult.fallbackCaptions
  }).then(function (outputText) {
      if (fallbackResult.fallbackCount > 0) {
        setStatus('Dataset preparation finished. Primer fallbacks used: ' + fallbackResult.fallbackCount + '.');
      } else {
        setStatus('Dataset preparation finished.');
      }
      refreshTrainingWorkspace();
      return outputText;
    })
    .catch(function (err) {
      var message = formatTrainingActionErrorMessage(err);
      setStatus('Dataset preparation failed: ' + message);
      throw err;
    });
}

function runTrainCommandPreviewForCurrentFolder(options) {
  if (!ensureFolderSelected('No folder selected for training.')) {
    return Promise.reject(new Error('No folder selected for training.'));
  }
  return ensureGeneratedTrainingArtifactsForCurrentFolder()
    .then(function () {
      setStatus('Generating manual training command...');
      return runTrainingActionRequest('/fs/train_run', {
        folder: state.folder,
        stages: options && options.stages ? options.stages : 'both',
        resumeFromCheckpoint: options && options.resumeFromCheckpoint ? options.resumeFromCheckpoint : '',
        resumeStage: options && options.resumeStage ? options.resumeStage : ''
      });
    })
    .then(function (outputText) {
      var command = extractTrainingPreviewCommand(outputText);
      if (!command) {
        setTrainingCommandHandoff('');
        setStatus('Manual command preview finished.');
        return outputText;
      }
      setTrainingCommandHandoff(command);
      return new Promise(function (resolve, reject) {
        copyTextToClipboard(
          command,
          function () {
            setStatus('Manual training command copied to clipboard.');
            resolve(outputText);
          },
          function () {
            setStatus('Manual command is ready. Auto-copy failed; use Copy Manual Command.');
            resolve(outputText);
          }
        );
      });
    })
    .catch(function (err) {
      var message = formatTrainingActionErrorMessage(err);
      setStatus('Manual command preview failed: ' + message);
      throw err;
    });
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

var sidebarActiveTab = 'review';

function setSidebarTab(tabName) {
  var sidebarWorkspace = document.getElementById('sidebar-workspace');
  if (sidebarWorkspace && sidebarWorkspace.getAttribute('data-legacy-tabs-disabled') === 'true') {
    return;
  }
  var tabs = {
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
  var sidebarWorkspace = document.getElementById('sidebar-workspace');
  if (sidebarWorkspace && sidebarWorkspace.getAttribute('data-legacy-tabs-disabled') === 'true') {
    return;
  }
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
  if (typeof wirePrimerCaptionResetUi === 'function') {
    wirePrimerCaptionResetUi();
  }
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
  if (!window.__webcapMetadataRefreshListBound) {
    window.__webcapMetadataRefreshListBound = true;
    window.addEventListener('webcap:media-metadata-updated', function (event) {
      var detail = event && event.detail ? event.detail : {};
      if (!state || detail.folder !== state.folder) return;
      renderFileList(ui && ui.filterEl ? ui.filterEl.value : '');
    });
  }
  var addInput = document.getElementById('checklist-add-input');
  var addBtn = document.getElementById('checklist-add-btn');
  if (addBtn && addInput) {
    addBtn.onclick = function() {
      var val = addInput.value.trim();
      if (!val || checklistItems.indexOf(val) !== -1) return;
      checklistItems.push(val);
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

  function closeChecklistPanel() {
    if (typeof setChecklistPanelVisible === 'function') {
      setChecklistPanelVisible(false);
    } else if (checklistPanelEl) {
      checklistPanelEl.style.display = 'none';
    }
    if (typeof renderAnnotateStrip === 'function') {
      renderAnnotateStrip();
    }
  }

  var closeBtn = document.getElementById('checklist-close-btn');
  if (closeBtn) {
    closeBtn.onclick = function() {
      closeChecklistPanel();
    };
  }
  var closeInlineBtn = document.getElementById('checklist-close-inline-btn');
  if (closeInlineBtn) {
    closeInlineBtn.onclick = function() {
      closeChecklistPanel();
    };
  }

  ui.editorEl.addEventListener('input', handleEditorInputAutosave);

  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.altKey || e.shiftKey) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    if (String(e.key || '').toLowerCase() !== 'z') return;
    if (isEditableElement(document.activeElement)) return;
    if (typeof undoLastOperation !== 'function') return;
    e.preventDefault();
    undoLastOperation();
  });

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
      saveFolderStateForCurrentRoot();
    };
  }

  if (typeof wireMainUiEvents === 'function') {
    wireMainUiEvents();
  }

}

addEventListener('DOMContentLoaded', function () {
  console.log('[webcap] initializing');
  rebuildUnifiedWorkspaceShell();
  wireWorkspaceHeaderUi();
  refreshCurrentDirectory();
  wireAllUi();
});
