var FOCUS_SET_PRESETS = [
  { key: 'suggested', label: 'Suggested' },
  { key: 'close', label: 'Close' },
  { key: 'medium', label: 'Medium' },
  { key: 'unknown', label: 'Unknown' }
];

function getFocusSetAnalysisConfig() {
  var analysis = APP_CONFIG && APP_CONFIG.analysis ? APP_CONFIG.analysis : {};
  return {
    face: !!analysis.enableFaceAnalysis,
    pose: !!analysis.enableMediaPipeAnalysis
  };
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

function getFocusSetPresetFiles() {
  var scopeItems = getFilteredMediaItems(true);
  var byFile = getFocusSetMetadataByFile();
  var rows = [];
  var fileNames = [];
  scopeItems.forEach(function (item) {
    var row = byFile[item.fileName];
    if (!row) return;
    rows.push(row);
    fileNames.push(item.fileName);
  });
  var suggestedLookup = getFocusSetSuggestedLookup(rows, fileNames);
  var result = { all: fileNames };
  FOCUS_SET_PRESETS.forEach(function (preset) {
    result[preset.key] = fileNames.filter(function (fileName) {
      var row = byFile[fileName];
      if (preset.key === 'suggested') return !!suggestedLookup[fileName];
      return getFocusSetBucket(row) === preset.key;
    });
  });
  return result;
}

function getActiveFocusSetPresetKey() {
  var source = String(state.focusSet && state.focusSet.source || '');
  if (source.indexOf('Focus Set: ') !== 0) return 'all';
  return source.slice('Focus Set: '.length).toLowerCase();
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
  activateFocusSet(files, 'Focus Set: ' + key.charAt(0).toUpperCase() + key.slice(1), '');
}

function buildFocusSetPresetOptions(filesByPreset, activeKey) {
  var html = '<option value="all"' + (activeKey === 'all' ? ' selected' : '') + '>All \u00b7 ' + (filesByPreset.all || []).length + '</option>';
  FOCUS_SET_PRESETS.forEach(function (preset) {
    var count = (filesByPreset[preset.key] || []).length;
    html += '<option value="' + preset.key + '"' + (activeKey === preset.key ? ' selected' : '') + (count ? '' : ' disabled') + '>' + preset.label + ' \u00b7 ' + count + '</option>';
  });
  return html;
}

function buildFocusSetGridTabsHtml(filesByPreset, activeKey) {
  var html = '<div class="focus-set-tabstrip" aria-label="Focus Sets"><span class="focus-set-tabstrip-label">Focus Sets</span>';
  html += '<button type="button" class="focus-set-tab' + (activeKey === 'all' ? ' active' : '') + '" data-focus-set="all">All <span>' + (filesByPreset.all || []).length + '</span></button>';
  FOCUS_SET_PRESETS.forEach(function (preset) {
    var count = (filesByPreset[preset.key] || []).length;
    if (!count) return;
    html += '<button type="button" class="focus-set-tab' + (activeKey === preset.key ? ' active' : '') + '" data-focus-set="' + preset.key + '">' + preset.label + ' <span>' + count + '</span></button>';
  });
  return html + '</div>';
}

function buildFocusSetControlsHtml(container, isEnabled, status, filesByPreset) {
  if (!state.folder) return '';
  if (!isEnabled) {
    return '<div class="focus-set-controls-status">Selection sets need Face Focus and selection-pose analysis. <button type="button" class="focus-set-settings-btn">Settings</button></div>';
  }
  if (status === 'loading') {
    return '<div class="focus-set-controls-status">Analyzing selection sets...</div>';
  }
  if (status === 'error') {
    return '<div class="focus-set-controls-status">Selection set analysis failed. <button type="button" class="focus-set-retry-btn">Retry</button></div>';
  }
  var activeKey = getActiveFocusSetPresetKey();
  if (container.classList.contains('focus-set-controls--grid')) {
    return buildFocusSetGridTabsHtml(filesByPreset, activeKey);
  }
  return '<label class="focus-set-select-label" for="focus-set-sidebar-select">Focus set</label>' +
    '<select id="focus-set-sidebar-select" class="focus-set-select" data-focus-set-select>' +
    buildFocusSetPresetOptions(filesByPreset, activeKey) +
    '</select>';
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
    button.onclick = ensureFocusSetMetadataForCurrentFolder;
  });
}

function renderFocusSetControls() {
  var containers = [ui.focusSetFilterControlsEl, ui.focusSetGridControlsEl];
  var config = getFocusSetAnalysisConfig();
  var enabled = config.face && config.pose;
  var filesByPreset = enabled && state.focusSetMetadataStatus === 'ready'
    ? getFocusSetPresetFiles()
    : { all: [] };
  containers.forEach(function (container) {
    if (!container) return;
    container.innerHTML = buildFocusSetControlsHtml(container, enabled, state.focusSetMetadataStatus, filesByPreset);
    container.classList.toggle('hidden', !state.folder);
    wireFocusSetControls(container);
  });
}

function ensureFocusSetMetadataForCurrentFolder() {
  var folder = String(state.folder || '').trim();
  var config = getFocusSetAnalysisConfig();
  if (!folder || !config.face || !config.pose) {
    state.focusSetMetadata = [];
    state.focusSetMetadataFolder = folder;
    state.focusSetMetadataStatus = 'disabled';
    renderFocusSetControls();
    return;
  }
  var fileNames = (state.items || []).map(function (item) { return item.fileName; }).filter(Boolean);
  if (!fileNames.length) {
    state.focusSetMetadata = [];
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
      if (state.folder !== folder) return;
      if (!Array.isArray(rows)) throw new Error('Malformed selection metadata');
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
