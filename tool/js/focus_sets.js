var FOCUS_SET_PRESETS = [
  { key: 'prune_candidates', label: 'Prune Candidates', group: 'Selection', source: 'prune' },
  { key: 'suggested', label: 'Suggested', group: 'Selection', source: 'analysis' },
  { key: 'close', label: 'Close', group: 'Selection', source: 'analysis' },
  { key: 'medium', label: 'Medium', group: 'Selection', source: 'analysis' },
  { key: 'unknown', label: 'Unknown', group: 'Selection', source: 'analysis' },
  { key: 'aspect_square', label: '1:1', group: 'Aspect Ratio', aspectBucket: 'square' },
  { key: 'aspect_43', label: '4:3', group: 'Aspect Ratio', aspectBucket: '4:3' },
  { key: 'aspect_34', label: '3:4', group: 'Aspect Ratio', aspectBucket: '3:4' },
  { key: 'aspect_169', label: '16:9', group: 'Aspect Ratio', aspectBucket: '16:9' },
  { key: 'aspect_916', label: '9:16', group: 'Aspect Ratio', aspectBucket: '9:16' }
];

function getFocusSetAnalysisConfig() {
  var analysis = APP_CONFIG && APP_CONFIG.analysis ? APP_CONFIG.analysis : {};
  return {
    face: !!analysis.enableFaceAnalysis,
    pose: !!analysis.enableMediaPipeAnalysis
  };
}

function getFocusSetMetadataCacheKey(folder, config, fileNames) {
  return [
    String(folder || ''),
    config && config.face ? 'face' : '',
    config && config.pose ? 'pose' : '',
    (fileNames || []).join('\n')
  ].join('\u0001');
}

function getFocusSetMetadataCache() {
  if (!state.focusSetMetadataCache || typeof state.focusSetMetadataCache !== 'object') {
    state.focusSetMetadataCache = {};
  }
  return state.focusSetMetadataCache;
}

function getFocusSetCurrentFileNames() {
  return (state.items || []).map(function (item) { return item.fileName; }).filter(Boolean);
}

function getFocusSetMetadataByFile() {
  var byFile = {};
  (state.focusSetMetadata || []).forEach(function (row) {
    var fileName = String(row && row.file || '').trim();
    if (fileName) byFile[fileName] = row;
  });
  return byFile;
}

function getFocusSetBucket(row) {
  var focus = getFaceFocusFromMetadata(row);
  if (!focus) return 'unknown';
  return normalizeFaceFocusBucket(focus.bucket);
}

function getFocusSetSuggestedLookup(rows, fileNames) {
  var lookup = {};
  var suggestionRows = buildSuggestedSelectionRows(rows, fileNames);
  if (!suggestionRows || !suggestionRows.length || !Array.isArray(suggestionRows[0].files)) return lookup;
  suggestionRows[0].files.forEach(function (fileName) {
    lookup[String(fileName || '')] = true;
  });
  return lookup;
}

function getFocusSetPreset(presetKey) {
  return FOCUS_SET_PRESETS.find(function (preset) { return preset.key === presetKey; }) || null;
}

function isFocusSetPresetAvailable(preset) {
  if (!preset || preset.aspectBucket) return true;
  if (preset.source === 'prune') return state.pruneCandidatesStatus === 'ready';
  var config = getFocusSetAnalysisConfig();
  return config.face && config.pose && state.focusSetMetadataStatus === 'ready';
}

function getFocusSetPresetFiles() {
  var scopeItems = getFilteredMediaItems(true);
  var byFile = getFocusSetMetadataByFile();
  var rows = [];
  var analyzedFileNames = [];
  var fileNames = [];
  scopeItems.forEach(function (item) {
    var row = byFile[item.fileName];
    fileNames.push(item.fileName);
    if (!row) return;
    rows.push(row);
    analyzedFileNames.push(item.fileName);
  });
  var suggestedLookup = getFocusSetSuggestedLookup(rows, analyzedFileNames);
  var result = { all: fileNames };
  FOCUS_SET_PRESETS.forEach(function (preset) {
    if (preset.aspectBucket) {
      result[preset.key] = scopeItems.filter(function (item) {
        var metadata = item && (item.metadata || getMetadataForMedia(item.fileName));
        return mapAspectRatioToBucket(metadata && metadata.aspect) === preset.aspectBucket;
      }).map(function (item) { return item.fileName; });
      return;
    }
    if (!isFocusSetPresetAvailable(preset)) {
      result[preset.key] = [];
      return;
    }
    result[preset.key] = fileNames.filter(function (fileName) {
      var row = byFile[fileName];
      if (preset.key === 'prune_candidates') return isPruneCandidateFile(fileName);
      if (preset.key === 'suggested') return !!suggestedLookup[fileName];
      return getFocusSetBucket(row) === preset.key;
    });
  });
  return result;
}

function getActiveFocusSetPresetKey() {
  var source = String(state.focusSet && state.focusSet.source || '');
  if (source.indexOf('Focus Set: ') !== 0) return 'all';
  var label = source.slice('Focus Set: '.length);
  var preset = FOCUS_SET_PRESETS.find(function (entry) { return entry.label === label; });
  return preset ? preset.key : 'all';
}

function activateFocusSetPreset(key) {
  if (key === 'all') {
    clearFocusSet();
    return;
  }
  var files = getFocusSetPresetFiles()[key] || [];
  if (!files.length) {
    setStatus('No ' + key + ' items match the current filters.');
    return;
  }
  var preset = getFocusSetPreset(key);
  if (!preset) throw new Error('Unknown focus set preset: ' + key);
  activateFocusSet(files, 'Focus Set: ' + (preset ? preset.label : key), '');
}

function buildFocusSetPresetOptions(filesByPreset, activeKey) {
  var html = '<option value="all"' + (activeKey === 'all' ? ' selected' : '') + '>All \u00b7 ' + (filesByPreset.all || []).length + '</option>';
  ['Selection', 'Aspect Ratio'].forEach(function (group) {
    var options = FOCUS_SET_PRESETS.filter(function (preset) { return preset.group === group; });
    if (!options.length) return;
    html += '<optgroup label="' + group + '">';
    options.forEach(function (preset) {
      var count = (filesByPreset[preset.key] || []).length;
      var disabled = !isFocusSetPresetAvailable(preset) || !count;
      html += '<option value="' + preset.key + '"' + (activeKey === preset.key ? ' selected' : '') + (disabled ? ' disabled' : '') + '>' + preset.label + ' \u00b7 ' + count + '</option>';
    });
    html += '</optgroup>';
  });
  return html;
}

function getFocusSetControlsNotice() {
  var config = getFocusSetAnalysisConfig();
  if (!config.face || !config.pose) {
    return 'Selection sets need Face Focus and selection-pose analysis. <button type="button" class="focus-set-settings-btn">Settings</button>';
  }
  if (state.focusSetMetadataStatus === 'loading') return 'Analyzing selection sets...';
  if (state.focusSetMetadataStatus === 'error') return 'Selection set analysis failed. <button type="button" class="focus-set-retry-btn">Retry</button>';
  if (state.pruneCandidatesStatus === 'loading') return 'Updating prune candidates...';
  if (state.pruneCandidatesStatus === 'error') return 'Prune candidate analysis failed. <button type="button" class="focus-set-retry-btn">Retry</button>';
  return '';
}

function buildFocusSetControlsHtml(container, filesByPreset) {
  if (!state.folder) return '';
  var activeKey = getActiveFocusSetPresetKey();
  var isGrid = container.classList.contains('focus-set-controls--grid');
  var selectId = isGrid ? 'focus-set-grid-select' : 'focus-set-sidebar-select';
  var notice = getFocusSetControlsNotice();
  return '<label class="focus-set-select-label" for="' + selectId + '">Focus set</label>' +
    '<select id="' + selectId + '" class="focus-set-select" data-focus-set-select>' +
    buildFocusSetPresetOptions(filesByPreset, activeKey) +
    '</select>' +
    (notice ? '<div class="focus-set-controls-status">' + notice + '</div>' : '');
}

function wireFocusSetControls(container) {
  Array.prototype.forEach.call(container.querySelectorAll('[data-focus-set]'), function (button) {
    button.onclick = function () {
      activateFocusSetPreset(String(button.getAttribute('data-focus-set') || 'all'));
    };
  });
  Array.prototype.forEach.call(container.querySelectorAll('[data-focus-set-select]'), function (select) {
    select.onchange = function () {
      activateFocusSetPreset(String(select.value || 'all'));
    };
  });
  Array.prototype.forEach.call(container.querySelectorAll('.focus-set-settings-btn'), function (button) {
    button.onclick = openAppSettingsModal;
  });
  Array.prototype.forEach.call(container.querySelectorAll('.focus-set-retry-btn'), function (button) {
    button.onclick = function () {
      ensureFocusSetMetadataForCurrentFolder(true);
      ensurePruneCandidatesForCurrentFolder(true).catch(function () {});
    };
  });
}

function renderFocusSetControls() {
  var containers = [ui.focusSetFilterControlsEl, ui.focusSetGridControlsEl];
  var filesByPreset = getFocusSetPresetFiles();
  containers.forEach(function (container) {
    if (!container) return;
    container.innerHTML = buildFocusSetControlsHtml(container, filesByPreset);
    container.classList.toggle('hidden', !state.folder);
    wireFocusSetControls(container);
  });
}

function prepareFocusSetMetadataForCurrentFolder() {
  var folder = String(state.folder || '').trim();
  var config = getFocusSetAnalysisConfig();
  if (!folder || !config.face || !config.pose) {
    state.focusSetMetadata = [];
    state.focusSetMetadataFolder = folder;
    state.focusSetMetadataStatus = 'disabled';
    renderFocusSetControls();
    return;
  }
  state.focusSetMetadata = [];
  state.focusSetMetadataFolder = folder;
  state.focusSetMetadataStatus = 'loading';
  renderFocusSetControls();
}

function applyFocusSetMetadataRows(folder, rows) {
  var requestFolder = String(folder || '').trim();
  var config = getFocusSetAnalysisConfig();
  if (state.folder !== requestFolder || !config.face || !config.pose) return;
  var fileNames = getFocusSetCurrentFileNames();
  var byFile = {};
  (rows || []).forEach(function (row) {
    if (row && row.file) byFile[row.file] = row;
  });
  var scopedRows = fileNames.map(function (fileName) { return byFile[fileName]; }).filter(Boolean);
  var cacheKey = getFocusSetMetadataCacheKey(requestFolder, config, fileNames);
  getFocusSetMetadataCache()[cacheKey] = scopedRows;
  state.focusSetMetadata = scopedRows;
  state.focusSetMetadataFolder = requestFolder;
  state.focusSetMetadataStatus = 'ready';
  renderFocusSetControls();
}

function failFocusSetMetadataForCurrentFolder(folder) {
  if (state.folder !== String(folder || '').trim()) return;
  var config = getFocusSetAnalysisConfig();
  if (!config.face || !config.pose) return;
  state.focusSetMetadata = [];
  state.focusSetMetadataFolder = state.folder;
  state.focusSetMetadataStatus = 'error';
  renderFocusSetControls();
}

function ensureFocusSetMetadataForCurrentFolder(force) {
  var folder = String(state.folder || '').trim();
  var config = getFocusSetAnalysisConfig();
  if (!folder || !config.face || !config.pose) {
    state.focusSetMetadata = [];
    state.focusSetMetadataFolder = folder;
    state.focusSetMetadataStatus = 'disabled';
    renderFocusSetControls();
    return;
  }
  var fileNames = getFocusSetCurrentFileNames();
  if (!fileNames.length) {
    state.focusSetMetadata = [];
    state.focusSetMetadataFolder = folder;
    state.focusSetMetadataStatus = 'ready';
    renderFocusSetControls();
    return;
  }
  var cacheKey = getFocusSetMetadataCacheKey(folder, config, fileNames);
  var cache = getFocusSetMetadataCache();
  if (!force && Array.isArray(cache[cacheKey])) {
    state.focusSetMetadata = cache[cacheKey];
    state.focusSetMetadataFolder = folder;
    state.focusSetMetadataStatus = 'ready';
    renderFocusSetControls();
    return;
  }
  state.focusSetMetadataFolder = folder;
  state.focusSetMetadataStatus = 'loading';
  renderFocusSetControls();
  var url = '/fs/media_metadata?folder=' + encodeURIComponent(folder) +
    '&face_focus=1&selection_pose=1&files=' + encodeURIComponent(fileNames.join('\n'));
  fetch(url)
    .then(function (response) {
      if (!response.ok) throw new Error('Selection metadata request failed (' + response.status + ')');
      return response.json();
    })
    .then(function (rows) {
      if (state.folder !== folder || getFocusSetMetadataCacheKey(folder, getFocusSetAnalysisConfig(), getFocusSetCurrentFileNames()) !== cacheKey) return;
      if (!Array.isArray(rows)) throw new Error('Malformed selection metadata');
      cache[cacheKey] = rows;
      state.focusSetMetadata = rows;
      state.focusSetMetadataStatus = 'ready';
      renderFocusSetControls();
    })
    .catch(function (err) {
      if (state.folder !== folder) return;
      state.focusSetMetadata = [];
      state.focusSetMetadataStatus = 'error';
      setStatus(String(err && err.message ? err.message : err));
      renderFocusSetControls();
    });
}
