var trainingWorkspaceState = {
  manifest: null,
  configFiles: []
};

function classifyTrainingConfigFile(fileName) {
  var lower = String(fileName || '').toLowerCase();
  if (/(^|[._-])hi([._-]|$)/.test(lower)) return 'hi';
  if (/(^|[._-])lo([._-]|$)/.test(lower)) return 'lo';
  var hasHi = lower.indexOf('hi') !== -1;
  var hasLo = lower.indexOf('lo') !== -1;
  if (hasHi && !hasLo) return 'hi';
  return 'lo';
}

function isTrainingWorkspaceActive() {
  return normalizeWorkspaceSurface(workspaceState.surface) === 'training';
}

function getTrainingWorkspaceEls() {
  return {
    navigator: document.getElementById('training-navigator'),
    folder: document.getElementById('training-navigator-folder'),
    readiness: document.getElementById('training-readiness'),
    configList: document.getElementById('training-workspace-config-list'),
    commandStatus: document.getElementById('training-command-status'),
    commandText: document.getElementById('training-command-text'),
    copyCommandBtn: document.getElementById('training-copy-command-btn')
  };
}

function fetchTrainingWorkspaceManifest(folder) {
  var path = String(folder || '').replace(/[\\/]+$/, '') + '/auto_dataset/prep_manifest.json';
  return fetch('/fs/read?path=' + encodeURIComponent(path)).then(function (response) {
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Could not read the dataset manifest.');
    return response.text().then(function (text) {
      return JSON.parse(text);
    });
  });
}

function fetchTrainingWorkspaceConfigFiles(folder) {
  return fetch('/fs/list_config?folder=' + encodeURIComponent(folder)).then(function (response) {
    if (!response.ok) throw new Error('Could not list training config files.');
    return response.json();
  }).then(function (data) {
    return Array.isArray(data.files) ? data.files.slice().sort(function (a, b) {
      return String(a || '').toLowerCase().localeCompare(String(b || '').toLowerCase());
    }) : [];
  });
}

function buildTrainingReadinessHtml(manifest, configFiles) {
  if (!manifest) {
    return '<div class="training-readiness-state"><strong>Dataset not prepared</strong><span>Prepare the current visible media set to create the dataset manifest.</span></div>';
  }
  var selection = manifest.selection && typeof manifest.selection === 'object' ? manifest.selection : {};
  var preparedCount = (manifest.images || []).length + (manifest.videos || []).length;
  var selectedCount = Number(selection.selected_count || 0);
  var totalCount = Number(selection.total_count || selectedCount);
  var skippedCount = (manifest.skipped || []).length;
  var configLabel = configFiles.length ? (configFiles.length + ' config files ready') : 'Configs not generated';
  return '' +
    '<div class="training-readiness-state"><strong>Dataset prepared</strong><span>' + selectedCount + ' of ' + totalCount + ' selected, ' + preparedCount + ' prepared.</span></div>' +
    '<div class="training-readiness-metrics">' +
    '<span>Prepared <b>' + preparedCount + '</b></span>' +
    '<span>Skipped <b>' + skippedCount + '</b></span>' +
    '<span>' + configLabel + '</span>' +
    '</div>';
}

function buildTrainingWorkspaceConfigColumn(title, files) {
  var buttons = files.map(function (fileName) {
    var active = !!(state.currentConfigFile && state.currentConfigFile.folder === state.folder && state.currentConfigFile.file === fileName);
    return '<button type="button" class="training-config-link' + (active ? ' active' : '') + '" data-training-config="' + encodeURIComponent(fileName) + '">' + escapeHtml(fileName) + '</button>';
  }).join('');
  return '<div class="training-config-col"><div class="training-config-col-title">' + title + '</div>' + (buttons || '<div class="training-config-empty">No files</div>') + '</div>';
}

function renderTrainingWorkspaceConfigList(files) {
  var els = getTrainingWorkspaceEls();
  if (!els.configList) return;
  if (!files.length) {
    els.configList.textContent = 'Generate configs to inspect and edit them here.';
    return;
  }
  var hiFiles = [];
  var loFiles = [];
  files.forEach(function (fileName) {
    if (classifyTrainingConfigFile(fileName) === 'hi') hiFiles.push(fileName);
    else loFiles.push(fileName);
  });
  els.configList.innerHTML = '<div class="training-config-grid">' +
    buildTrainingWorkspaceConfigColumn('High Noise', hiFiles) +
    buildTrainingWorkspaceConfigColumn('Low Noise', loFiles) +
    '</div>';
  Array.prototype.forEach.call(els.configList.querySelectorAll('[data-training-config]'), function (button) {
    button.onclick = function () {
      loadConfigFileToEditor(decodeURIComponent(button.getAttribute('data-training-config') || ''));
    };
  });
}

function renderTrainingCommandHandoff() {
  var els = getTrainingWorkspaceEls();
  if (!els.commandStatus || !els.commandText || !els.copyCommandBtn) return;
  var command = state.trainingCommandFolder === state.folder ? String(state.trainingCommand || '') : '';
  els.commandText.textContent = command;
  els.commandText.classList.toggle('hidden', !command);
  els.copyCommandBtn.classList.toggle('hidden', !command);
  els.commandStatus.textContent = command
    ? 'Command generated and copied to the clipboard.'
    : 'Run Train to generate and copy the command.';
}

function setTrainingCommandHandoff(command) {
  state.trainingCommand = String(command || '');
  state.trainingCommandFolder = state.trainingCommand ? String(state.folder || '') : '';
  renderTrainingCommandHandoff();
}

function refreshTrainingWorkspace() {
  if (!isTrainingWorkspaceActive()) return;
  var els = getTrainingWorkspaceEls();
  var folder = String(state.folder || '').trim();
  if (els.folder) els.folder.textContent = folder || 'No folder selected';
  if (!folder) {
    trainingWorkspaceState.manifest = null;
    trainingWorkspaceState.configFiles = [];
    if (els.readiness) els.readiness.textContent = 'Select a set folder to prepare a dataset.';
    renderTrainingWorkspaceConfigList([]);
    renderTrainingCommandHandoff();
    return;
  }
  if (els.readiness) els.readiness.textContent = 'Loading dataset readiness...';
  Promise.all([fetchTrainingWorkspaceManifest(folder), fetchTrainingWorkspaceConfigFiles(folder)])
    .then(function (results) {
      if (state.folder !== folder || !isTrainingWorkspaceActive()) return;
      trainingWorkspaceState.manifest = results[0];
      trainingWorkspaceState.configFiles = results[1];
      if (els.readiness) els.readiness.innerHTML = buildTrainingReadinessHtml(results[0], results[1]);
      renderTrainingWorkspaceConfigList(results[1]);
      renderTrainingCommandHandoff();
      syncWorkspaceConfigEditorUi();
    })
    .catch(function (err) {
      if (state.folder !== folder || !isTrainingWorkspaceActive()) return;
      if (els.readiness) els.readiness.textContent = String(err && err.message ? err.message : err);
    });
}

function runTrainingWorkspaceAction(action) {
  var runner = action === 'prepare'
    ? runPrepareDatasetForCurrentFolder
    : action === 'generate'
      ? runGenerateDatasetConfigsForCurrentFolder
      : runTrainCommandPreviewForCurrentFolder;
  var request = runner();
  syncWorkspaceConfigEditorUi();
  Promise.resolve(request)
    .then(function () {
      refreshTrainingWorkspace();
      syncWorkspaceConfigEditorUi();
    })
    .catch(function (err) {
      if (window.console && console.error) console.error('[Training workspace] ' + action + ' failed:', err);
    });
}

function wireTrainingWorkspace() {
  var backBtn = document.getElementById('training-workspace-back-btn');
  var prepareBtn = document.getElementById('training-workspace-prepare-btn');
  var generateBtn = document.getElementById('training-workspace-generate-btn');
  var trainBtn = document.getElementById('training-workspace-train-btn');
  var copyCommandBtn = document.getElementById('training-copy-command-btn');
  var consoleBtn = document.getElementById('training-console-btn');
  backBtn.onclick = function () { exitWorkspaceSurface(); };
  prepareBtn.onclick = function () { runTrainingWorkspaceAction('prepare'); };
  generateBtn.onclick = function () { runTrainingWorkspaceAction('generate'); };
  trainBtn.onclick = function () { runTrainingWorkspaceAction('train'); };
  copyCommandBtn.onclick = function () {
    var command = String(state.trainingCommand || '');
    if (!command) return;
    copyTextToClipboard(command, function () {
      setStatus('Training command copied to clipboard.');
      renderTrainingCommandHandoff();
    }, function () {
      setStatus('Could not copy the training command.');
    });
  };
  consoleBtn.onclick = function () {
    toggleConsolePanel();
    syncTrainingConsoleUi();
  };
}

function syncTrainingConsoleUi() {
  var consoleBtn = document.getElementById('training-console-btn');
  if (!consoleBtn) return;
  var visible = isConsolePanelVisible();
  consoleBtn.classList.toggle('active', visible);
  consoleBtn.setAttribute('aria-pressed', visible ? 'true' : 'false');
}

function syncTrainingWorkspaceUi() {
  if (!isTrainingWorkspaceActive()) return;
  syncTrainingConsoleUi();
  refreshTrainingWorkspace();
}

wireTrainingWorkspace();
