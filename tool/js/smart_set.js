function buildSourceMediaRelPath(mediaKey) {
  var name = String(mediaKey || '').replace(/\\/g, '/').replace(/^\/+/, '');
  var folder = String(state.folder || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!folder) return name;
  return folder + '/' + name;
}

function normalizeRelativeFolderPath(pathValue) {
  var normalized = String(pathValue || '').trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  return normalized;
}

function isSuperSetActive() {
  return !!(state && state.supersetActive);
}

function buildSuperSetCriteriaFromDom() {
  var starsValue = (typeof getAdvancedStarFilterValue === 'function') ? getAdvancedStarFilterValue() : '';
  var flagValue = (typeof getAdvancedFlagFilterValue === 'function') ? getAdvancedFlagFilterValue() : '';
  return {
    source_folder: String(state.folder || ''),
    filter_text: String((ui.filterEl && ui.filterEl.value) || '').trim(),
    missing_captions_only: !!(ui.advancedFilterMissingCaptionsEl && ui.advancedFilterMissingCaptionsEl.checked),
    reviewed_only: !!(ui.advancedFilterReviewedEl && ui.advancedFilterReviewedEl.checked),
    unreviewed_only: !!(ui.advancedFilterUnreviewedEl && ui.advancedFilterUnreviewedEl.checked),
    incomplete_only: !!(ui.advancedFilterIncompleteEl && ui.advancedFilterIncompleteEl.checked),
    untagged_only: !!(ui.advancedFilterUntaggedEl && ui.advancedFilterUntaggedEl.checked),
    text_match_mode: 'all',
    invalid_ar_only: !!(ui.advancedFilterInvalidArEl && ui.advancedFilterInvalidArEl.checked),
    star_filter: String(starsValue || ''),
    flag_filter: String(flagValue || '')
  };
}

function updateSuperSetControls() {
  var armed = !!(ui.advancedFilterSupersetEl && ui.advancedFilterSupersetEl.checked);
  state.supersetArmed = armed;
  var row = ui.advancedFilterSupersetEl ? ui.advancedFilterSupersetEl.closest('.advanced-filter-superset-row') : null;
  if (row) {
    row.classList.toggle('is-armed', armed);
  }
  if (ui.supersetSearchBtn) {
    ui.supersetSearchBtn.classList.toggle('hidden', !armed);
    ui.supersetSearchBtn.disabled = !armed || (state.supersetActive && !state.supersetSearchDirty);
  }
  if (ui.supersetResultsEl) {
    ui.supersetResultsEl.classList.toggle('hidden', !state.supersetActive);
  }
  if (ui.supersetExitBtn) {
    ui.supersetExitBtn.classList.toggle('hidden', !state.supersetActive);
  }
  if (ui.mediaListEl) {
    ui.mediaListEl.classList.toggle('hidden', !!state.supersetActive);
  }
  var mediaListHeader = document.getElementById('media-list-header');
  if (mediaListHeader) {
    mediaListHeader.classList.toggle('hidden', !!state.supersetActive);
  }
  if (ui.upBtn) {
    ui.upBtn.classList.toggle('hidden', !!state.supersetActive || !(state.dirStack && state.dirStack.length > 1));
  }
  if (ui.createSetFromResultsBtn && state.supersetActive) {
    ui.createSetFromResultsBtn.classList.toggle('hidden', !(state.supersetResults && state.supersetResults.length));
    ui.createSetFromResultsBtn.title = 'Create a new set from all SuperSet results';
  } else if (ui.createSetFromResultsBtn) {
    ui.createSetFromResultsBtn.title = 'Create a new set with the current filter results';
  }
}

function markSuperSetSearchDirty() {
  if (!state || !state.supersetArmed) return;
  state.supersetSearchDirty = true;
  updateSuperSetControls();
}

function clearSuperSetResultDetails() {
  var listEl = document.getElementById('item-metadata-list');
  if (listEl) {
    listEl.textContent = 'Select a SuperSet result.';
  }
}

function renderSuperSetResultDetails(result) {
  var listEl = document.getElementById('item-metadata-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  if (!result) {
    listEl.textContent = 'Select a SuperSet result.';
    return;
  }
  function appendRow(label, value) {
    var row = document.createElement('div');
    row.className = 'item-metadata-row';
    row.innerHTML = '<span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong>';
    listEl.appendChild(row);
  }
  appendRow('Folder', result.source_folder || '/');
  appendRow('File', result.media_name || '');
  appendRow('Reviewed', result.reviewed ? 'Yes' : 'No');
  appendRow('Rating', result.rating ? String(result.rating) : '-');
  appendRow('Flag', result.flag || '-');
  var tags = Array.isArray(result.tags) ? result.tags.join(', ') : '';
  appendRow('Tags', tags || '-');
  var metadata = result.metadata && typeof result.metadata === 'object' ? result.metadata : {};
  Object.keys(metadata).sort().forEach(function (key) {
    var value = metadata[key];
    if (value === null || typeof value === 'undefined' || typeof value === 'object') return;
    appendRow(key, String(value));
  });
}

function getSuperSetFolderBreakLabel(folderPath) {
  var folder = String(folderPath || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!folder || folder === '/') return 'root';
  var parts = folder.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : folder;
}

function selectSuperSetResult(index) {
  var idx = Number(index);
  if (!isFinite(idx) || idx < 0 || !state.supersetResults || idx >= state.supersetResults.length) return;
  var result = state.supersetResults[idx];
  state.supersetCurrentResult = result;
  state.currentItem = null;
  state.currentConfigFile = null;
  if (ui.editorEl) {
    ui.editorEl.removeAttribute('readonly');
    ui.editorEl.value = String(result.caption || '');
  }
  renderPathPreview(String(result.source_folder || ''), String(result.media_name || ''));
  renderSuperSetResultDetails(result);
  if (typeof renderChecklistPanel === 'function') renderChecklistPanel();
  if (typeof renderPhraseCopyPanel === 'function') renderPhraseCopyPanel();
  if (typeof updatePrimerCaptionResetUi === 'function') updatePrimerCaptionResetUi();
  if (typeof updatePreviewActionControls === 'function') updatePreviewActionControls();
  renderSuperSetResults();
  setStatus('SuperSet preview: ' + (result.source_media_rel || result.media_name || 'result'));
}

function renderSuperSetResults() {
  if (!ui.supersetResultsEl) return;
  ui.supersetResultsEl.innerHTML = '';
  var results = Array.isArray(state.supersetResults) ? state.supersetResults : [];
  var batchSize = 300;
  if (!state.supersetRenderedCount || state.supersetRenderedCount < 0) {
    state.supersetRenderedCount = Math.min(batchSize, results.length);
  }
  var renderCount = Math.min(state.supersetRenderedCount, results.length);
  if (!results.length) {
    ui.supersetResultsEl.textContent = 'No SuperSet results.';
    updateSuperSetControls();
    return;
  }
  var lastFolder = null;
  results.slice(0, renderCount).forEach(function (result, index) {
    var folderPath = String(result.source_folder || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
    var folderKey = folderPath || '';
    if (folderKey !== lastFolder) {
      var folderHeader = document.createElement('div');
      folderHeader.className = 'superset-folder-header';
      folderHeader.textContent = getSuperSetFolderBreakLabel(folderPath || '/');
      folderHeader.title = folderPath || '/';
      ui.supersetResultsEl.appendChild(folderHeader);
      lastFolder = folderKey;
    }
    var row = document.createElement('div');
    var active = state.supersetCurrentResult === result;
    row.className = 'media-item' + (active ? ' active' : '') + (result.reviewed ? ' reviewed' : '');
    row.setAttribute('data-type', 'superset-result');
    row.setAttribute('data-index', String(index));
    row.innerHTML =
      '<div class="media-item-main">' +
        '<span class="media-item-main-label">&#128196;&nbsp;' + escapeHtml(result.media_name || '') + '</span>' +
      '</div>';
    row.title = (result.source_media_rel || result.media_name || '') + (folderPath ? (' • ' + folderPath) : '');
    row.onclick = function () {
      selectSuperSetResult(index);
    };
    ui.supersetResultsEl.appendChild(row);
  });
  if (renderCount < results.length) {
    var loadMore = document.createElement('button');
    loadMore.type = 'button';
    loadMore.className = 'media-item superset-load-more';
    loadMore.textContent = 'Load more (' + renderCount + '/' + results.length + ')';
    loadMore.onclick = function () {
      state.supersetRenderedCount = Math.min(results.length, renderCount + batchSize);
      renderSuperSetResults();
    };
    ui.supersetResultsEl.appendChild(loadMore);
  }
  updateSuperSetControls();
}

function exitSuperSetSearch(options) {
  state.supersetActive = false;
  state.supersetResults = [];
  state.supersetRenderedCount = 0;
  state.supersetCurrentResult = null;
  state.supersetSearchDirty = false;
  state.supersetSourceFolder = '';
  if (options && options.uncheck && ui.advancedFilterSupersetEl) {
    ui.advancedFilterSupersetEl.checked = false;
    state.supersetArmed = false;
  }
  updateSuperSetControls();
  if (!(options && options.skipRefresh)) {
    refreshCurrentDirectory();
  }
}

function runSuperSetSearch() {
  if (!ui.advancedFilterSupersetEl || !ui.advancedFilterSupersetEl.checked) return;
  if (!state.folder && state.folder !== '') {
    setStatus('No folder selected for SuperSet search.');
    return;
  }
  var criteria = buildSuperSetCriteriaFromDom();
  var sourceFolder = String(criteria.source_folder || '');
  state.supersetSourceFolder = sourceFolder;
  if (ui.supersetSearchBtn) ui.supersetSearchBtn.disabled = true;
  setStatus('Searching SuperSet...');
  HttpModule.postJson('/fs/superset_search', { criteria: criteria }, function (status, responseText) {
    if (status !== 200) {
      setStatus(getErrorMessage(responseText, 'SuperSet search failed'));
      state.supersetSearchDirty = true;
      updateSuperSetControls();
      return;
    }
    var data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      setStatus('SuperSet search failed: invalid response.');
      state.supersetSearchDirty = true;
      updateSuperSetControls();
      return;
    }
    var results = Array.isArray(data.results) ? data.results : [];
    state.currentItem = null;
    state.currentConfigFile = null;
    state.childFolders = [];
    state.items = [];
    state.supersetActive = true;
    state.supersetSearchDirty = false;
    state.supersetResults = results;
    state.supersetRenderedCount = Math.min(300, results.length);
    state.supersetCurrentResult = null;
    clearEditorAndPreview();
    clearSuperSetResultDetails();
    if (typeof renderChecklistPanel === 'function') renderChecklistPanel();
    if (typeof renderPhraseCopyPanel === 'function') renderPhraseCopyPanel();
    if (typeof updateSetFolderScopedUi === 'function') updateSetFolderScopedUi();
    if (typeof updateReviewButtonAvailability === 'function') updateReviewButtonAvailability();
    renderFileList();
    renderSuperSetResults();
    setStatus('SuperSet results: ' + results.length + ' match' + (results.length === 1 ? '' : 'es') + '.');
  });
}

function parseSetDestinationPresetsFromConfig(cfg) {
  var setDestinations = cfg && cfg.set_destinations;
  var presets = setDestinations && setDestinations.presets;
  if (!Array.isArray(presets)) return [];
  var out = [];
  for (var i = 0; i < presets.length; i++) {
    var raw = presets[i];
    var path = '';
    var label = '';
    if (typeof raw === 'string') {
      path = normalizeRelativeFolderPath(raw);
      label = String(raw || '').trim();
    } else if (raw && typeof raw === 'object') {
      path = normalizeRelativeFolderPath(raw.path || raw.folder || raw.value || '');
      label = String(raw.label || raw.name || raw.path || '').trim();
    }
    if (!path && label === '/') path = '/';
    if (!path && label !== '/') continue;
    var normalizedPath = path || '/';
    if (!label) label = normalizedPath;
    out.push({
      label: label,
      path: normalizedPath
    });
  }
  return out;
}

function fetchAppConfigForCreateSet(callback) {
  HttpModule.get('/app/config', function (status, responseText) {
    if (status !== 200) {
      callback(null);
      return;
    }
    try {
      callback(JSON.parse(responseText));
    } catch (e) {
      callback(null);
    }
  });
}

function checkDestinationFolderExists(relPath, callback) {
  var normalized = normalizeRelativeFolderPath(relPath);
  var pathForApi = normalized || '';
  HttpModule.get('/fs/path_exists?path=' + encodeURIComponent(pathForApi), function (status, responseText) {
    if (status !== 200) {
      callback(false);
      return;
    }
    try {
      var data = JSON.parse(responseText);
      callback(!!(data && data.ok && data.exists && data.is_dir));
    } catch (e) {
      callback(false);
    }
  });
}

function filterExistingPresetDestinations(presets, callback) {
  if (!Array.isArray(presets) || !presets.length) {
    callback([]);
    return;
  }
  var pending = presets.length;
  var kept = [];
  presets.forEach(function (preset) {
    checkDestinationFolderExists(preset.path, function (exists) {
      if (exists) kept.push(preset);
      pending -= 1;
      if (pending === 0) callback(kept);
    });
  });
}

function buildCreateSetLocationOptions(currentFolder, presetDestinations) {
  var normalizedCurrent = normalizeRelativeFolderPath(currentFolder);
  var siblingParent = normalizedCurrent.indexOf('/') !== -1
    ? normalizedCurrent.slice(0, normalizedCurrent.lastIndexOf('/'))
    : '';
  var siblingPath = siblingParent || '/';
  var rootPath = '/';
  var options = [];
  var seen = {};

  function addOption(label, pathValue) {
    var normalizedPath = normalizeRelativeFolderPath(pathValue) || '/';
    var dedupeKey = normalizedPath.toLowerCase();
    if (seen[dedupeKey]) return;
    seen[dedupeKey] = true;
    options.push({ label: label, path: normalizedPath });
  }

  addOption('Sibling of Current Set (' + siblingPath + ')', siblingPath);
  addOption('Root (/)', rootPath);

  (presetDestinations || []).forEach(function (preset) {
    addOption('Preset: ' + preset.label + ' (' + preset.path + ')', preset.path);
  });

  return options;
}

function promptForDestinationOption(locationOptions) {
  if (!Array.isArray(locationOptions) || !locationOptions.length) return null;
  var lines = ['Where should the new set go?'];
  for (var i = 0; i < locationOptions.length; i++) {
    lines.push((i + 1) + ') ' + locationOptions[i].label);
  }
  lines.push('');
  lines.push('Enter 1-' + locationOptions.length + ':');
  var choiceInput = prompt(lines.join('\n'), '1');
  if (choiceInput === null) return null;
  var n = Number(String(choiceInput || '').trim());
  if (!isFinite(n)) return undefined;
  var idx = Math.floor(n) - 1;
  if (idx < 0 || idx >= locationOptions.length) return undefined;
  return locationOptions[idx];
}

function buildCreateSetItemsFromCurrentResults() {
  if (isSuperSetActive()) {
    var supersetResults = Array.isArray(state.supersetResults) ? state.supersetResults : [];
    return supersetResults
      .map(function (result) {
        var rel = String((result && result.source_media_rel) || '').trim();
        return rel ? { source_media_rel: rel } : null;
      })
      .filter(Boolean);
  }
  var visibleRows = Array.prototype.slice.call(
    ui.mediaListEl ? ui.mediaListEl.querySelectorAll('.media-item[data-type="media"]') : []
  );
  return visibleRows
    .map(function (row) { return String(row.getAttribute('data-key') || '').trim(); })
    .filter(Boolean)
    .map(function (key) {
      return { source_media_rel: buildSourceMediaRelPath(key) };
    });
}

function runCreateSetFromResultsFlow() {
  var items = buildCreateSetItemsFromCurrentResults();
  if (!items.length) {
    setStatus(isSuperSetActive() ? 'No SuperSet results to copy.' : 'No visible media items to copy.');
    return;
  }

  setStatus('Loading destination options...');
  fetchAppConfigForCreateSet(function (cfg) {
    var presetCandidates = parseSetDestinationPresetsFromConfig(cfg);
    filterExistingPresetDestinations(presetCandidates, function (existingPresets) {
      var currentFolder = String(state.folder || '/');
      var locationOptions = buildCreateSetLocationOptions(currentFolder, existingPresets);
      var selectedOption = promptForDestinationOption(locationOptions);
      if (selectedOption === null) {
        setStatus('Create Set cancelled.');
        return;
      }
      if (!selectedOption || !selectedOption.path) {
        setStatus('Create Set cancelled: invalid location choice.');
        return;
      }

      var defaultSetName = 'result_set';
      var setNameInput = prompt('New set folder name:', defaultSetName);
      if (setNameInput === null) {
        setStatus('Create Set cancelled.');
        return;
      }
      var setName = String(setNameInput || '').trim();
      if (!setName) {
        setStatus('Create Set cancelled: missing set folder name.');
        return;
      }

      var destinationParent = normalizeRelativeFolderPath(selectedOption.path) || '/';
      if (ui.createSetFromResultsBtn) {
        ui.createSetFromResultsBtn.disabled = true;
      }
      setStatus('Creating set from results...');
      HttpModule.postJson(
        '/fs/create_set_from_results',
        {
          destination_parent: destinationParent,
          set_name: setName,
          items: items
        },
        function (status, responseText) {
          if (ui.createSetFromResultsBtn) {
            ui.createSetFromResultsBtn.disabled = false;
          }
          if (status !== 200) {
            setStatus(getErrorMessage(responseText, 'Create Set failed'));
            return;
          }
          var data;
          try {
            data = JSON.parse(responseText);
          } catch (e) {
            setStatus('Create Set failed: invalid response.');
            return;
          }
          if (!data || !data.ok) {
            setStatus('Create Set failed.');
            return;
          }
          var createdFolder = String(data.folder || '').trim();
          if (!createdFolder) {
            setStatus('Create Set failed: missing destination folder.');
            return;
          }
          setStatus('Set created: ' + createdFolder + ' (' + Number(data.copied_count || 0) + ' files).');
          if (isSuperSetActive()) {
            state.supersetActive = false;
            state.supersetResults = [];
            state.supersetRenderedCount = 0;
            state.supersetCurrentResult = null;
            state.supersetSearchDirty = false;
            if (ui.advancedFilterSupersetEl) ui.advancedFilterSupersetEl.checked = false;
          }
          state.folder = createdFolder;
          state.currentItem = null;
          clearEditorAndPreview();
          refreshCurrentDirectory();
        }
      );
    });
  });
}
