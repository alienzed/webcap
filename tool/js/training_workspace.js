function normalizeTrainingWorkspaceMode(mode) {
  return 'normal';
}

function syncTrainingWorkspaceProfile() {
  trainingWorkspaceState.selectedMode = normalizeTrainingWorkspaceMode(trainingWorkspaceState.selectedMode);
}

function getTrainingWorkspaceSelectedProfile(folder) {
  return normalizeTrainingWorkspaceMode(trainingWorkspaceState.selectedMode);
}

function fetchTrainingProfiles() {
  if (trainingWorkspaceState.profiles.length) return Promise.resolve(trainingWorkspaceState.profiles);
  return fetch('/fs/training_profiles').then(function (response) {
    if (!response.ok) throw new Error('Could not load training profiles.');
    return response.json();
  }).then(function (payload) {
    trainingWorkspaceState.profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
    if (!trainingWorkspaceState.profiles.length) {
      throw new Error('No training models are enabled. Choose at least one in App Settings.');
    }
    return trainingWorkspaceState.profiles;
  });
}

function trainingModeStorageKey(folder) {
  return 'webcap.trainingMode.' + String(folder || '');
}

function getSelectedTrainingModelProfile() {
  var profiles = trainingWorkspaceState.profiles || [];
  var selectedProfileId = getWorkingModelProfileId();
  for (var i = 0; i < profiles.length; i++) {
    if (profiles[i].id === selectedProfileId) return profiles[i];
  }
  return profiles[0] || null;
}

function getSelectedTrainingSetup() {
  var profile = getSelectedTrainingModelProfile();
  var mode = normalizeTrainingWorkspaceMode(trainingWorkspaceState.selectedMode);
  if (!profile || !profile.setups || !profile.setups[mode]) return null;
  return profile.setups[mode];
}

function getTrainingProfileRunForStage(profile, stage) {
  if (!profile || !Array.isArray(profile.runs)) return null;
  for (var i = 0; i < profile.runs.length; i++) {
    var run = profile.runs[i];
    var runStage = run.stages && run.stages[0];
    if (runStage === stage) return run;
  }
  return null;
}

function getWorkingModelProfileSelect() {
  return document.getElementById('app-header-model-profile-select');
}

function syncWorkingModelProfileSelect(folder) {
  var select = getWorkingModelProfileSelect();
  if (!select) return;
  var profiles = trainingWorkspaceState.profiles || [];
  var selectedProfileId = syncWorkingModelProfileForFolder(folder, profiles);
  select.innerHTML = profiles.map(function (profile) {
    return '<option value="' + escapeHtml(profile.id) + '">' + escapeHtml(profile.label) + '</option>';
  }).join('');
  select.value = selectedProfileId;
  if (typeof window.syncApplicationShellContext === 'function') window.syncApplicationShellContext();
  if (isTrainingWorkspaceActive()) {
    var storedMode = '';
    try { storedMode = localStorage.getItem(trainingModeStorageKey(folder)) || ''; } catch (err) {}
    trainingWorkspaceState.selectedMode = normalizeTrainingWorkspaceMode(storedMode || trainingWorkspaceState.selectedMode);
    syncTrainingWorkspaceProfile();
    setManagedTrainingStages(trainingWorkspaceState.runStages);
  }
}

function setSelectedTrainingModelProfile(profileId) {
  setWorkingModelProfileId(profileId, state.folder);
  setManagedTrainingStages(trainingWorkspaceState.runStages);
}

function refreshWorkingModelSelector() {
  var folder = String(state && state.folder || '');
  return fetchTrainingProfiles().then(function () {
    syncWorkingModelProfileSelect(folder);
    return getWorkingModelProfileId();
  }).catch(function (err) {
    var select = getWorkingModelProfileSelect();
    if (select) {
      select.innerHTML = '';
      select.disabled = true;
      select.title = String(err && err.message ? err.message : err);
    }
    throw err;
  });
}

function buildCurrentTrainingSelectionPayload() {
  var selectedMedia = getVisibleMediaSelectionForTraining();
  return {
    selected_media: selectedMedia,
    total_media_count: Array.isArray(state.items) ? state.items.length : 0,
    selection_criteria: buildTrainingSelectionCriteria()
  };
}

function ensureSelectedTrainingSetup(resetFile) {
  var selection = buildCurrentTrainingSelectionPayload();
  if (!selection.selected_media.length) return Promise.reject(new Error('No visible media items are available for this training setup.'));
  return trainingRunnerRequest('/fs/training_setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folder: state.folder,
      profileId: getWorkingModelProfileId(),
      mode: normalizeTrainingWorkspaceMode(trainingWorkspaceState.selectedMode),
      selected_media: selection.selected_media,
      total_media_count: selection.total_media_count,
      selection_criteria: selection.selection_criteria,
      resetFile: resetFile || ''
    })
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

function buildTrainingReadinessHtml() {
  var selectedCount = getVisibleMediaSelectionForTraining().length;
  var totalCount = Array.isArray(state.items) ? state.items.length : selectedCount;
  return '<div class="training-readiness-state"><strong>' + selectedCount + ' visible media item' + (selectedCount === 1 ? '' : 's') +
    '</strong><span>Train captures this visible selection and the saved TOMLs. ' + selectedCount + ' of ' + totalCount + ' media items are currently visible.</span></div>';
}

function trainingConfigFilesAreReady(configFiles) {
  var files = Array.isArray(configFiles) ? configFiles : [];
  var available = {};
  files.forEach(function (fileName) { available[String(fileName || '').toLowerCase()] = true; });
  var setup = getSelectedTrainingSetup();
  var needed = setup && Array.isArray(setup.configs) ? setup.configs.map(function (config) { return config.file; }).concat(setup.datasetFiles || []) : [];
  return needed.every(function (fileName) {
    return !!available[fileName];
  });
}

function syncTrainingWorkflowReadiness(manifest, configFiles) {
  var els = getTrainingWorkspaceEls();
  var configsReady = trainingConfigFilesAreReady(configFiles);
  var hasVisibleMedia = getVisibleMediaSelectionForTraining().length > 0;
  if (els.runStepNumber) els.runStepNumber.classList.toggle('is-waiting', !configsReady || !hasVisibleMedia);
  if (els.queueJobBtn) {
    els.queueJobBtn.title = 'Capture the visible media and saved TOMLs, then add this run to the training queue.';
  }
}

function renderTrainingItemOverview(manifest, errorMessage) {
  var els = getTrainingWorkspaceEls();
  if (!els.itemOverview || !els.itemOverviewSummary || !els.itemOverviewToggleBtn) return;
  els.itemOverview.replaceChildren();

  function syncVisibility(hasItems) {
    var hidden = !!trainingWorkspaceState.itemOverviewHidden;
    els.itemOverview.classList.toggle('hidden', hidden);
    els.itemOverviewToggleBtn.classList.toggle('hidden', !hasItems);
    els.itemOverviewToggleBtn.innerHTML = hidden ? '&#9654;' : '&#9660;';
    els.itemOverviewToggleBtn.title = hidden ? 'Show training items' : 'Collapse training items';
    els.itemOverviewToggleBtn.setAttribute('aria-label', hidden ? 'Show training items' : 'Collapse training items');
    els.itemOverviewToggleBtn.setAttribute('aria-expanded', hidden ? 'false' : 'true');
  }

  if (errorMessage) {
    els.itemOverviewSummary.textContent = errorMessage;
    syncVisibility(false);
    return;
  }

  var visibleNames = getVisibleMediaSelectionForTraining();
  var visibleLookup = {};
  visibleNames.forEach(function (name) { visibleLookup[String(name)] = true; });
  var items = (state.items || []).filter(function (item) {
    return item && visibleLookup[String(item.fileName || item.key || '')];
  }).map(function (item) {
    var fileName = String(item.fileName || item.key || '');
    return {
      fileName: fileName,
      kind: /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(fileName) ? 'video' : 'image',
      aspect: ''
    };
  });

  var imageCount = 0;
  var videoCount = 0;
  items.forEach(function (item) {
    if (item.kind === 'video') videoCount++;
    else imageCount++;
  });
  els.itemOverviewSummary.textContent = items.length + ' visible item' + (items.length === 1 ? '' : 's') +
    ' · ' + imageCount + ' image' + (imageCount === 1 ? '' : 's') +
    ' · ' + videoCount + ' video' + (videoCount === 1 ? '' : 's');

  if (!items.length) {
    els.itemOverviewSummary.textContent = 'No visible media items will be captured.';
    syncVisibility(false);
    return;
  }

  syncVisibility(true);
  if (trainingWorkspaceState.itemOverviewHidden) return;

  var grid = document.createElement('div');
  grid.className = 'training-item-grid';
  items.forEach(function (item) {
    var tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'training-item-tile';
    tile.title = item.fileName;
    tile.setAttribute('aria-label', 'Open ' + item.fileName + ' in Annotation');
    tile.onclick = function () {
      setWorkspaceSurface('default');
      selectByFileName(item.fileName);
    };

    var thumb = document.createElement('div');
    thumb.className = 'training-item-thumb';
    var fallback = document.createElement('span');
    fallback.className = 'training-item-fallback';
    fallback.textContent = 'Preview unavailable';
    fallback.hidden = true;

    var media;
    if (item.kind === 'video') {
      media = document.createElement('video');
      media.muted = true;
      media.playsInline = true;
      media.preload = 'metadata';
    } else {
      media = document.createElement('img');
      media.loading = 'lazy';
      media.alt = '';
    }
    media.src = '/caption/media?folder=' + encodeURIComponent(state.folder || '') +
      '&media=' + encodeURIComponent(item.fileName);
    media.onerror = function () {
      media.hidden = true;
      fallback.hidden = false;
    };
    thumb.appendChild(media);
    thumb.appendChild(fallback);

    var badges = document.createElement('div');
    badges.className = 'training-item-badges';
    var typeBadge = document.createElement('span');
    typeBadge.textContent = item.kind;
    badges.appendChild(typeBadge);
    if (item.aspect) {
      var aspectBadge = document.createElement('span');
      aspectBadge.textContent = item.aspect;
      badges.appendChild(aspectBadge);
    }
    thumb.appendChild(badges);
    tile.appendChild(thumb);
    grid.appendChild(tile);
  });
  els.itemOverview.appendChild(grid);
}

function getTrainingWorkspaceVisibleConfigFiles(files) {
  var setup = getSelectedTrainingSetup();
  var expected = setup && Array.isArray(setup.configs)
    ? setup.configs.map(function (item) { return item.file; }).concat(setup.datasetFiles || [])
    : [];
  var available = {};
  (files || []).forEach(function (fileName) { available[fileName] = true; });
  return expected.filter(function (fileName) { return !!available[fileName]; });
}

function selectTrainingWorkspaceConfigFile(fileName) {
  var currentFile = state.currentConfigFile && state.currentConfigFile.folder === state.folder
    ? state.currentConfigFile.file
    : '';
  if (fileName === currentFile) {
    setTrainingDetailTab('config');
    return;
  }
  var loadSelectedFile = function () {
    setTrainingDetailTab('config');
    loadConfigFileToEditor(fileName, { preserveTrainingWorkspace: true });
  };
  if (!currentFile) {
    loadSelectedFile();
    return;
  }
  setStatus('Saving config: ' + currentFile);
  saveCurrentEditorContent().then(loadSelectedFile).catch(function (err) {
    setStatus('Could not save config: ' + String(err && err.message ? err.message : err));
  });
}

function renderTrainingConfigEditorFileTabs() {
  var tabs = document.getElementById('config-editor-file-tabs');
  if (!tabs) return;
  var files = getTrainingWorkspaceVisibleConfigFiles(trainingWorkspaceState.configFiles);
  var currentFile = state.currentConfigFile && state.currentConfigFile.folder === state.folder
    ? state.currentConfigFile.file
    : '';
  tabs.innerHTML = files.map(function (fileName) {
    var active = fileName === currentFile;
    return '<button type="button" class="config-editor-file-tab' + (active ? ' active' : '') + '" data-training-editor-config="' + encodeURIComponent(fileName) + '" role="tab" aria-selected="' + (active ? 'true' : 'false') + '">' + escapeHtml(fileName) + '</button>';
  }).join('');
  tabs.classList.toggle('hidden', !files.length);
  Array.prototype.forEach.call(tabs.querySelectorAll('[data-training-editor-config]'), function (button) {
    button.onclick = function () {
      selectTrainingWorkspaceConfigFile(decodeURIComponent(button.getAttribute('data-training-editor-config') || ''));
    };
  });
}

function renderTrainingWorkspaceConfigList(files) {
  var els = getTrainingWorkspaceEls();
  if (!els.configList) return;
  var visibleFiles = getTrainingWorkspaceVisibleConfigFiles(files);
  if (!visibleFiles.length) {
    els.configList.textContent = 'No setup files are available.';
    renderTrainingConfigEditorFileTabs();
    return;
  }
  var profile = getSelectedTrainingModelProfile();
  var modeLabel = normalizeTrainingWorkspaceMode(trainingWorkspaceState.selectedMode).toUpperCase();
  els.configList.innerHTML = '<section class="training-config-group"><div class="training-config-group-heading"><strong>' + escapeHtml((profile ? profile.label : 'Training') + ' · ' + modeLabel) + '</strong><span>' + visibleFiles.length + ' files</span></div><div class="training-config-links">' + visibleFiles.map(function (fileName) {
      var active = !!(state.currentConfigFile && state.currentConfigFile.folder === state.folder && state.currentConfigFile.file === fileName);
      var reset = '<button type="button" class="training-config-reset" data-training-reset-config="' + encodeURIComponent(fileName) + '">Reset</button>';
      return '<div class="training-config-file"><button type="button" class="training-config-link' + (active ? ' active' : '') + '" data-training-config="' + encodeURIComponent(fileName) + '">' + escapeHtml(fileName) + '</button>' + reset + '</div>';
    }).join('') + '</div></section>';
  Array.prototype.forEach.call(els.configList.querySelectorAll('[data-training-config]'), function (button) {
    button.onclick = function () {
      selectTrainingWorkspaceConfigFile(decodeURIComponent(button.getAttribute('data-training-config') || ''));
    };
  });
  Array.prototype.forEach.call(els.configList.querySelectorAll('[data-training-reset-config]'), function (button) {
    button.onclick = function () {
      var fileName = decodeURIComponent(button.getAttribute('data-training-reset-config') || '');
      var resetSource = /^dataset\./.test(fileName) ? 'the currently visible media' : 'its setup default';
      if (!window.confirm('Reset ' + fileName + ' from ' + resetSource + '? Your edits to this file will be replaced.')) return;
      if (state.currentConfigFile && state.currentConfigFile.folder === state.folder && state.currentConfigFile.file === fileName) {
        cancelEditorAutosaveForConfig(state.folder, fileName);
      }
      var reset = /^dataset\./.test(fileName)
        ? resetTrainingReviewBuckets()
        : ensureSelectedTrainingSetup(fileName);
      reset.then(function () {
        if (state.currentConfigFile && state.currentConfigFile.file === fileName) loadConfigFileToEditor(fileName, { preserveTrainingWorkspace: true });
        refreshTrainingWorkspace();
      }).catch(function (err) { setStatus('Could not reset file: ' + String(err.message || err)); });
    };
  });
  renderTrainingConfigEditorFileTabs();
}

function syncTrainingWorkspaceConfigSelection() {
  if (!isTrainingWorkspaceActive()) return;
  var els = getTrainingWorkspaceEls();
  var currentFile = state.currentConfigFile && state.currentConfigFile.folder === state.folder
    ? state.currentConfigFile.file
    : '';
  if (els.configList) {
    Array.prototype.forEach.call(els.configList.querySelectorAll('[data-training-config]'), function (button) {
      var fileName = decodeURIComponent(button.getAttribute('data-training-config') || '');
      button.classList.toggle('active', fileName === currentFile);
    });
  }
  renderTrainingConfigEditorFileTabs();
}

function renderTrainingCommandHandoff() {
  var els = getTrainingWorkspaceEls();
  if (!els.commandStatus || !els.commandText || !els.copyCommandBtn) return;
  var command = state.trainingCommandFolder === state.folder ? String(state.trainingCommand || '') : '';
  els.commandText.textContent = command;
  els.commandText.classList.toggle('hidden', !command);
  els.copyCommandBtn.classList.toggle('hidden', !command);
  els.commandStatus.textContent = command
    ? 'Manual command generated and copied to the clipboard.'
    : 'Print and copy a manual WSL command when you need one.';
}

function setTrainingCommandHandoff(command) {
  state.trainingCommand = String(command || '');
  state.trainingCommandFolder = state.trainingCommand ? String(state.folder || '') : '';
  renderTrainingCommandHandoff();
}

function resetTrainingRunSetupForFolder(folder) {
  if (trainingWorkspaceState.runSetupFolder === folder) return;
  trainingWorkspaceState.runSetupFolder = folder;
  var runName = document.getElementById('training-run-name-input');
  var startingPoint = document.getElementById('training-run-starting-point-select');
  var checkpoint = document.getElementById('training-run-checkpoint-select');
  var checkpointPath = document.getElementById('training-run-checkpoint-path');
  var resumeStage = document.getElementById('training-run-resume-stage-select');
  var customResume = document.getElementById('training-run-resume-input');
  if (runName) runName.value = '';
  if (startingPoint) startingPoint.value = 'fresh';
  if (checkpoint) checkpoint.value = '';
  if (checkpointPath) checkpointPath.textContent = '';
  if (resumeStage) resumeStage.selectedIndex = 0;
  if (customResume) customResume.value = '';
  // Starting-point selections are just as set-specific as the name. A resume
  // or initializer selected for another set must never carry into this one.
  trainingWorkspaceState.runStages = 'h3';
  trainingWorkspaceState.resumeParentJobId = '';
  trainingWorkspaceState.resumeSelectionTouched = false;
  trainingWorkspaceState.reviewStartingPoint = 'fresh';
  trainingWorkspaceState.reviewInitializerStage = '';
  trainingWorkspaceState.reviewInitializers = [];
  trainingWorkspaceState.reviewInitializerExportId = '';
  trainingWorkspaceState.reviewInitializerCustomPath = '';
  trainingWorkspaceState.reviewForceConstantLr = '';
  trainingWorkspaceState.reviewMediaView = 'images';
  trainingWorkspaceState.reviewAspect = '';
  trainingWorkspaceState.review = null;
  trainingWorkspaceState.reviewError = '';
  trainingWorkspaceState.reviewModalOpen = false;
  var modal = document.getElementById('training-review-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }
}

function isTrainingSetRefreshCurrent(folder, requestVersion) {
  return isTrainingWorkspaceActive()
    && trainingWorkspaceState.entryMode === 'set'
    && isSetFolderPath(state.folder)
    && state.folder === folder
    && trainingWorkspaceState.workspaceRequestVersion === requestVersion;
}

function refreshTrainingWorkspace() {
  if (!isTrainingWorkspaceActive()) return;
  var els = getTrainingWorkspaceEls();
  var folder = String(state.folder || '').trim();
  var requestVersion = ++trainingWorkspaceState.workspaceRequestVersion;
  var isGlobalEntry = trainingWorkspaceState.entryMode !== 'set';
  var isSetEntry = !isGlobalEntry && isSetFolderPath(folder);
  var isUnavailableSetEntry = !isGlobalEntry && !isSetEntry;

  if (els.globalContext) {
    els.globalContext.classList.toggle('hidden', false);
    els.globalContext.classList.toggle('training-global-context--global', isGlobalEntry);
  }
  if (els.runSetup) els.runSetup.classList.toggle('hidden', !isSetEntry);
  if (els.testsStage) els.testsStage.classList.toggle('hidden', !isSetEntry);

  if (isGlobalEntry) {
    refreshTrainingHistory();
    return;
  }

  if (isUnavailableSetEntry) {
    if (els.readiness) els.readiness.textContent = 'Select a set folder to configure training.';
    renderTrainingItemOverview(null, 'Select a set folder to configure training.');
    syncWorkspaceConfigEditorUi();
    return;
  }

  resetTrainingRunSetupForFolder(folder);
  if (els.readiness) els.readiness.textContent = 'Loading training setup...';
  fetchTrainingProfiles()
    .then(function () {
      if (!isTrainingSetRefreshCurrent(folder, requestVersion)) return null;
      syncWorkingModelProfileSelect(folder);
      trainingWorkspaceState.selectedMode = 'normal';
      syncTrainingWorkspaceProfile();
      if (!isTrainingSetRefreshCurrent(folder, requestVersion)) return null;
      return getVisibleMediaSelectionForTraining().length ? ensureSelectedTrainingSetup() : Promise.resolve(null);
    })
    .then(function () {
      if (!isTrainingSetRefreshCurrent(folder, requestVersion)) return [];
      return Promise.all([fetchTrainingWorkspaceConfigFiles(folder), refreshTrainingHistory(), refreshTrainingReview()]);
    })
    .then(function (results) {
      if (!isTrainingSetRefreshCurrent(folder, requestVersion)) return;
      trainingWorkspaceState.configFiles = results[0];
      syncTrainingWorkflowReadiness(null, results[0]);
      if (els.readiness) els.readiness.innerHTML = buildTrainingReadinessHtml();
      renderTrainingItemOverview(null);
      renderTrainingWorkspaceConfigList(results[0]);
      renderTrainingCommandHandoff();
      syncWorkspaceConfigEditorUi();
    })
    .catch(function (err) {
      if (!isTrainingSetRefreshCurrent(folder, requestVersion)) return;
      if (els.readiness) els.readiness.textContent = String(err && err.message ? err.message : err);
      renderTrainingItemOverview(null, 'Could not load the visible training items.');
    });
}

function runTrainingWorkspaceAction(options) {
  var request = runTrainCommandPreviewForCurrentFolder(options);
  syncWorkspaceConfigEditorUi();
  Promise.resolve(request)
    .then(function () {
      refreshTrainingWorkspace();
      syncWorkspaceConfigEditorUi();
    })
    .catch(function (err) {
      if (window.console && console.error) console.error('[Training workspace] Manual command failed:', err);
    });
}

function openTrainingWorkspaceFolder(folder) {
  var targetFolder = String(folder || '').replace(/^[/\\]+|[/\\]+$/g, '');
  if (!targetFolder) throw new Error('Training job does not identify a set folder.');
  if (!state.dirStack || !state.dirStack.length) {
    setStatus('Select a library root before opening a training set.');
    return;
  }
  if (typeof clearFocusSet === 'function' && state.focusSet && state.focusSet.keys && state.focusSet.keys.length) {
    clearFocusSet();
  }
  setTrainingWorkspaceEntryMode('set');
  state.dirStack = [state.dirStack[0]].concat(targetFolder.split('/').filter(Boolean).map(function (name) {
    return { name: name };
  }));
  state.folder = targetFolder;
  state.currentItem = null;
  clearEditorAndPreview();
  clearCaptionFilterInputs();
  workspaceState.sidebarHidden = false;
  setTrainingDetailTab('items');
  renderTrainingItemOverview(null, 'Loading training set...');
  syncTrainingEntryChrome();
  refreshCurrentDirectory();
}

function switchTrainingSetup(profileId, mode) {
  var priorConfig = state.currentConfigFile;
  var savePromise = priorConfig && priorConfig.folder === state.folder
    ? Promise.resolve(saveCurrentEditorContent())
    : Promise.resolve();
  savePromise.then(function () {
    if (profileId) setSelectedTrainingModelProfile(profileId);
    if (mode) trainingWorkspaceState.selectedMode = normalizeTrainingWorkspaceMode(mode);
    try { localStorage.setItem(trainingModeStorageKey(state.folder), trainingWorkspaceState.selectedMode); } catch (err) {}
    if (priorConfig && state.currentConfigFile === priorConfig) clearEditorAndPreview();
    refreshTrainingWorkspace();
  }).catch(function (err) {
    setStatus('Could not save the open TOML before switching setup: ' + String(err && err.message ? err.message : err));
    syncWorkingModelProfileSelect(state.folder);
  });
}

function wireTrainingWorkspace() {
  var modelProfileSelect = getWorkingModelProfileSelect();
  var stageButtons = document.querySelectorAll('[data-training-stage]');
  var resumeInput = document.getElementById('training-run-resume-input');
  var checkpointSelect = document.getElementById('training-run-checkpoint-select');
  var resumeStageSelect = document.getElementById('training-run-resume-stage-select');
  var itemOverviewToggleBtn = document.getElementById('training-item-overview-toggle-btn');
  var previewCommandBtn = document.getElementById('training-preview-command-btn');
  var validateRunnerBtn = document.getElementById('training-validate-runner-btn');
  var queueJobBtn = document.getElementById('training-queue-job-btn');
  var copyCommandBtn = document.getElementById('training-copy-command-btn');
  var runnerFinishBtn = document.getElementById('training-runner-finish-btn');
  var runnerPauseBtn = document.getElementById('training-runner-pause-btn');
  var runnerCancelBtn = document.getElementById('training-runner-cancel-btn');
  var runnerResumeQueueBtn = document.getElementById('training-runner-resume-queue-btn');
  var runnerConsoleBtn = document.getElementById('training-runner-console-btn');
  var runnerConsoleRevealBtn = document.getElementById('training-runner-console-reveal-btn');
  var runnerConsoleCloseBtn = document.getElementById('training-runner-console-close-btn');
  Array.prototype.forEach.call(document.querySelectorAll('[data-training-detail-tab]'), function (button) {
    button.onclick = function () {
      requestTrainingDetailTab(button.getAttribute('data-training-detail-tab'));
    };
  });
  var runnerQueue = document.getElementById('training-runner-queue');
  var historyList = document.getElementById('training-history-list');
  var historyCollapseBtn = document.getElementById('training-history-collapse-btn');
  var historyShowAllBtn = document.getElementById('training-history-show-all-btn');
  var historySearch = document.getElementById('training-history-search');
  var historyScope = document.getElementById('training-history-scope');
  var historyClearBtn = document.getElementById('training-history-clear-btn');
  itemOverviewToggleBtn.onclick = function () {
    trainingWorkspaceState.itemOverviewHidden = !trainingWorkspaceState.itemOverviewHidden;
    renderTrainingItemOverview(null);
  };
  if (modelProfileSelect) modelProfileSelect.onchange = function () {
    if (isTrainingWorkspaceActive()) {
      switchTrainingSetup(modelProfileSelect.value, '');
      return;
    }
    setWorkingModelProfileId(modelProfileSelect.value, state.folder);
  };
  stageButtons.forEach(function (button) {
    button.onclick = function () {
      setManagedTrainingStages(button.getAttribute('data-training-stage'));
      trainingWorkspaceState.reviewInitializerStage = '';
      trainingWorkspaceState.reviewInitializerExportId = '';
      refreshTrainingReview().catch(function (err) {
        setStatus('Could not refresh Training Review: ' + String(err && err.message ? err.message : err));
      });
    };
  });
  setManagedTrainingStages(trainingWorkspaceState.runStages);
  if (checkpointSelect) checkpointSelect.onchange = function () {
    trainingWorkspaceState.resumeSelectionTouched = true;
    trainingWorkspaceState.resumeParentJobId = '';
    var selectedRun = (trainingWorkspaceState.history && trainingWorkspaceState.history.runs || []).filter(function (run) {
      return String(run.resumeOutputId || run.runPath || '') === String(checkpointSelect.value || '');
    })[0];
    if (selectedRun && (selectedRun.stage === 'hi' || selectedRun.stage === 'lo') && resumeStageSelect) {
      resumeStageSelect.value = selectedRun.stage;
    }
    trainingWorkspaceState.reviewStartingPoint = 'resume';
    if (checkpointSelect.value && resumeInput) resumeInput.value = '';
    syncManagedTrainingResumeUi();
    refreshTrainingReview().catch(function (err) {
      setStatus('Could not load the selected run review: ' + String(err && err.message ? err.message : err));
    });
  };
  if (resumeInput) resumeInput.oninput = function () {
    if (!resumeInput.value.trim()) return;
    if (checkpointSelect) checkpointSelect.value = '';
    trainingWorkspaceState.resumeSelectionTouched = true;
    trainingWorkspaceState.resumeParentJobId = '';
    trainingWorkspaceState.reviewStartingPoint = 'resume';
    syncManagedTrainingResumeUi();
    renderTrainingReview();
  };
  if (resumeStageSelect) resumeStageSelect.onchange = function () {
    renderTrainingHistory();
    syncManagedTrainingResumeUi();
  };
  previewCommandBtn.onclick = function () {
    runTrainingWorkspaceAction(getManagedTrainingOptions());
  };
  validateRunnerBtn.onclick = function () {
    validateTrainingRunner(getManagedTrainingOptions()).catch(function (err) {
      setStatus('Training runner validation failed: ' + String(err && err.message ? err.message : err));
    });
  };
  queueJobBtn.onclick = function () {
    startManagedTraining();
  };
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
  runnerFinishBtn.onclick = function () { stopManagedTraining(false, false, true); };
  runnerPauseBtn.onclick = function () { stopManagedTraining(false, true); };
  runnerCancelBtn.onclick = function () { stopManagedTraining(true); };
  runnerResumeQueueBtn.onclick = resumeManagedTrainingQueue;
  getTrainingWorkspaceEls().runnerSummary.onclick = function (event) {
    var folderButton = event.target.closest('[data-training-open-folder]');
    var folder = folderButton && folderButton.getAttribute('data-training-open-folder');
    if (folder) {
      openTrainingWorkspaceFolder(folder);
      return;
    }
    var finishScheduleButton = event.target.closest('[data-training-finish-schedule]');
    if (finishScheduleButton) {
      scheduleManagedTrainingFinish(finishScheduleButton.getAttribute('data-training-finish-schedule'));
      return;
    }
    var candidateButton = event.target.closest('[data-training-candidates]');
    if (candidateButton) {
      openTrainingCandidates(getTrainingRunnerJobById(candidateButton.getAttribute('data-training-candidates')));
      return;
    }
    var outputId = event.target.getAttribute('data-training-job-output');
    if (outputId) openTrainingJobOutput(outputId);
    var actionId = event.target.getAttribute('data-training-job-action');
    if (actionId) openTrainingJobAction(actionId);
    if (event.target.closest('[data-training-runner-recover]')) recoverManagedTrainingQueue();
  };
  runnerConsoleBtn.onclick = function () {
    toggleTrainingRunnerConsole();
  };
  runnerConsoleRevealBtn.onclick = revealTrainingRunnerLog;
  runnerConsoleCloseBtn.onclick = hideTrainingRunnerConsole;
  runnerQueue.onclick = function (event) {
    var queueToggle = event.target.closest('[data-training-queue-toggle]');
    if (queueToggle) {
      trainingWorkspaceState.runnerQueueCollapsed = !trainingWorkspaceState.runnerQueueCollapsed;
      renderTrainingRunner();
      return;
    }
    var folderButton = event.target.closest('[data-training-open-folder]');
    var folder = folderButton && folderButton.getAttribute('data-training-open-folder');
    if (folder) {
      openTrainingWorkspaceFolder(folder);
      return;
    }
    var outputId = event.target.getAttribute('data-training-job-output');
    if (outputId) {
      openTrainingJobOutput(outputId);
      return;
    }
    var candidateButton = event.target.closest('[data-training-candidates]');
    if (candidateButton) {
      openTrainingCandidates(getTrainingRunnerJobById(candidateButton.getAttribute('data-training-candidates')));
      return;
    }
    var actionId = event.target.getAttribute('data-training-job-action');
    if (actionId) {
      openTrainingJobAction(actionId);
      return;
    }
    var action = event.target.getAttribute('data-training-queue-action');
    var jobId = event.target.getAttribute('data-training-job-id');
    if (action && jobId) {
      event.stopPropagation();
      if (action === 'cancel') {
        cancelQueuedTrainingJob(jobId);
      } else {
        reorderManagedTraining(jobId, action);
      }
      return;
    }
    var row = event.target.closest('[data-training-queue-job]');
    if (row) {
      trainingWorkspaceState.runnerSelectedJobId = row.getAttribute('data-training-queue-job');
      renderTrainingRunner();
    }
  };
  historyList.onclick = function (event) {
    var detailsButton = event.target.closest('[data-training-history-details]');
    if (detailsButton) {
      var detailsId = detailsButton.getAttribute('data-training-history-details');
      trainingWorkspaceState.historyDetailOpen[detailsId] = !trainingWorkspaceState.historyDetailOpen[detailsId];
      renderTrainingHistory();
      if (trainingWorkspaceState.historyDetailOpen[detailsId]) {
        var detailsJob = (trainingWorkspaceState.history.jobs || []).filter(function (item) { return item.id === detailsId; })[0];
        if (detailsJob) loadTrainingHistoryMetrics(detailsJob);
      }
      return;
    }
    var folderButton = event.target.closest('[data-training-open-folder]');
    var folder = folderButton && folderButton.getAttribute('data-training-open-folder');
    if (folder) {
      openTrainingWorkspaceFolder(folder);
      return;
    }
    var historyMoreMenu = event.target.closest('.training-history-more');
    if (historyMoreMenu && event.target.closest('[data-training-history-output], [data-training-history-action], [data-training-history-clear]')) {
      historyMoreMenu.removeAttribute('open');
    }
    var logId = event.target.getAttribute('data-training-history-log');
    var candidateId = event.target.getAttribute('data-training-history-candidates');
    var outputJobId = event.target.getAttribute('data-training-history-output');
    var runJobId = event.target.getAttribute('data-training-history-run');
    var actionJobId = event.target.getAttribute('data-training-history-action');
    var clearId = event.target.getAttribute('data-training-history-clear');
    if (candidateId) {
      openTrainingCandidates(getTrainingRunnerJobById(candidateId));
      return;
    }
    if (outputJobId) {
      var outputJob = (trainingWorkspaceState.history.jobs || []).filter(function (item) { return item.id === outputJobId; })[0];
      openTrainingHistoryOutput(outputJob && outputJob.folder, outputJobId);
      return;
    }
    if (runJobId) {
      var runJob = (trainingWorkspaceState.history.jobs || []).filter(function (item) { return item.id === runJobId; })[0];
      openTrainingHistoryRun(runJob && runJob.folder, runJob && (runJob.stage || runJob.stages), runJob && runJob.outputRunPath);
      return;
    }
    if (actionJobId) {
      var actionJob = (trainingWorkspaceState.history.jobs || []).filter(function (item) { return item.id === actionJobId; })[0];
      openTrainingJobAction(actionJobId, actionJob && actionJob.folder);
      return;
    }
    if (clearId) {
      clearTrainingHistoryJob(clearId);
      return;
    }
    if (logId) {
      showTrainingRunnerConsole(getTrainingRunnerJobById(logId));
      return;
    }
    var resumeId = event.target.getAttribute('data-training-history-resume');
    if (resumeId) {
      resumeTrainingHistoryJob(resumeId);
    }
  };
  historyCollapseBtn.onclick = function () {
    trainingWorkspaceState.historyCollapsed = !trainingWorkspaceState.historyCollapsed;
    renderTrainingHistory();
  };
  historyShowAllBtn.onclick = function () {
    trainingWorkspaceState.historyExpanded = !trainingWorkspaceState.historyExpanded;
    renderTrainingHistory();
  };
  if (historyScope) historyScope.onclick = function (event) {
    var button = event.target.closest('[data-training-history-scope]');
    if (!button) return;
    var scope = button.getAttribute('data-training-history-scope');
    trainingWorkspaceState.historyViewScope = scope === 'set' ? 'set' : 'all';
    trainingWorkspaceState.historyExpanded = false;
    renderTrainingHistory();
  };
  if (historySearch) historySearch.oninput = renderTrainingHistory;
  if (historyClearBtn) historyClearBtn.onclick = clearTrainingHistory;
}

function syncTrainingConsoleUi() {
  var runnerConsoleBtn = document.getElementById('training-runner-console-btn');
  var runnerConsoleCloseBtn = document.getElementById('training-runner-console-close-btn');
  var visible = isTrainingRunnerConsoleVisible();
  var isGlobalEntry = trainingWorkspaceState.entryMode === 'global';
  [runnerConsoleBtn].forEach(function (button) {
    if (!button) return;
    button.classList.toggle('active', visible);
    button.setAttribute('aria-pressed', visible ? 'true' : 'false');
    button.textContent = visible ? 'Hide Run Log' : 'Show Run Log';
    button.title = visible ? 'Hide the active training run log.' : 'Show the active training run log.';
  });
  if (runnerConsoleCloseBtn) {
    runnerConsoleCloseBtn.textContent = isGlobalEntry ? 'Close' : 'Items';
    runnerConsoleCloseBtn.title = isGlobalEntry ? 'Close the run log.' : 'Return to Training Items.';
    runnerConsoleCloseBtn.setAttribute('aria-label', runnerConsoleCloseBtn.title);
  }
  syncWorkspaceConfigEditorUi();
}

function getTrainingWorkspaceEntryKind() {
  var mode = trainingWorkspaceState.entryMode === 'set' ? 'set' : 'global';
  if (mode === 'global') return 'global';
  return isSetFolderPath(state.folder) ? 'set' : 'unavailable';
}

function syncTrainingEntryChrome() {
  var isTraining = typeof isTrainingWorkspaceActive === 'function' && isTrainingWorkspaceActive();
  var entryKind = getTrainingWorkspaceEntryKind();
  var isSetMode = isTraining && trainingWorkspaceState.entryMode === 'set';
  var isSetEntry = isTraining && entryKind === 'set';
  var isGlobalEntry = isTraining && entryKind === 'global';
  var trainingBtn = document.getElementById('sidebar-open-training-btn');
  var detailTabs = document.getElementById('training-detail-tabs');
  var itemTab = document.querySelector('[data-training-detail-tab="items"]');
  var configTab = document.querySelector('[data-training-detail-tab="config"]');
  var runLogTab = document.querySelector('[data-training-detail-tab="run-log"]');

  if (isTraining && ui && ui.appEl) {
    ui.appEl.classList.toggle('sidebar-hidden', !!workspaceState.sidebarHidden);
  }
  if (trainingBtn) {
    trainingBtn.classList.toggle('active', isSetMode);
    trainingBtn.setAttribute('aria-pressed', isSetMode ? 'true' : 'false');
    trainingBtn.classList.toggle('hidden', !isSetFolderPath(state.folder));
  }
  if (detailTabs) detailTabs.classList.toggle('hidden', !isTraining || entryKind === 'unavailable');
  if (itemTab) itemTab.classList.toggle('hidden', !isSetEntry);
  if (configTab) configTab.classList.toggle('hidden', !isSetEntry);
  if (runLogTab) runLogTab.classList.toggle('hidden', !isGlobalEntry);
}

function syncTrainingWorkspaceDetailUi() {
  var active = isTrainingWorkspaceActive();
  var entryKind = active ? getTrainingWorkspaceEntryKind() : '';
  var isSetTraining = entryKind === 'set';
  var isGlobalTraining = entryKind === 'global';
  var isUnavailableSetTraining = entryKind === 'unavailable';
  var detailTab = active && typeof getTrainingDetailTab === 'function' ? getTrainingDetailTab() : 'items';
  if (isGlobalTraining) detailTab = 'run-log';
  if (isUnavailableSetTraining) detailTab = 'items';

  var toolbar = document.getElementById('config-editor-toolbar');
  var backBtn = document.getElementById('config-editor-back-btn');
  var fileLabel = document.getElementById('config-editor-current-file');
  var saveBtn = document.getElementById('config-editor-save-btn');
  var trainingOverview = document.getElementById('training-editor-empty');
  var trainingConfigEmpty = document.getElementById('training-config-empty');
  var trainingDetailTabs = document.getElementById('training-detail-tabs');
  var configFileTabs = document.getElementById('config-editor-file-tabs');
  var trainingOutputView = document.getElementById('training-runner-output-view');
  var trainingRunnerEmpty = document.getElementById('training-runner-empty');
  var editorWrapper = ui && ui.appEl ? ui.appEl.querySelector('.editor-wrapper') : null;
  var hasConfigFile = !!(state && state.currentConfigFile && state.currentConfigFile.file);
  var hasTrainingConfigFile = isSetTraining && hasConfigFile && state.currentConfigFile.folder === state.folder;
  var trainingOutputVisible = active && !isUnavailableSetTraining && detailTab === 'run-log';

  if (toolbar) toolbar.classList.toggle('hidden', !active || detailTab !== 'config' || !hasTrainingConfigFile);
  if (backBtn && active) {
    backBtn.textContent = hasTrainingConfigFile ? 'Close' : 'Back';
    backBtn.title = hasTrainingConfigFile
      ? 'Save this config and return to Training Items.'
      : 'Return to the previous workspace.';
  }
  if (ui && ui.appEl) {
    ui.appEl.classList.toggle('training-config-selected', isSetTraining && detailTab === 'config' && hasTrainingConfigFile);
  }
  if (trainingDetailTabs) trainingDetailTabs.classList.toggle('hidden', !active || isUnavailableSetTraining);
  if (configFileTabs) configFileTabs.classList.toggle('hidden', !isSetTraining || detailTab !== 'config' || !hasTrainingConfigFile);
  if (trainingOverview) trainingOverview.classList.toggle('hidden', !(isSetTraining || isUnavailableSetTraining) || detailTab !== 'items');
  if (trainingConfigEmpty) trainingConfigEmpty.classList.toggle('hidden', !isSetTraining || detailTab !== 'config' || hasTrainingConfigFile);
  if (trainingOutputView) trainingOutputView.classList.toggle('hidden', !trainingOutputVisible);
  if (trainingRunnerEmpty) trainingRunnerEmpty.classList.toggle('hidden', !trainingOutputVisible || isTrainingRunnerConsoleVisible());
  if (editorWrapper) editorWrapper.classList.toggle('hidden', active && (!isSetTraining || detailTab !== 'config' || !hasTrainingConfigFile));
  if (fileLabel && active) fileLabel.textContent = hasConfigFile ? state.currentConfigFile.file : 'No config selected.';
  if (saveBtn && active) saveBtn.disabled = !hasTrainingConfigFile;
}

function syncTrainingWorkspaceUi() {
  if (!isTrainingWorkspaceActive()) return;
  syncTrainingWorkspaceDetailUi();
  syncTrainingConsoleUi();
  refreshTrainingWorkspace();
  refreshTrainingRunnerStatus();
}

window.getTrainingWorkspaceEntryKind = getTrainingWorkspaceEntryKind;
window.syncTrainingEntryChrome = syncTrainingEntryChrome;
window.syncTrainingWorkspaceDetailUi = syncTrainingWorkspaceDetailUi;

window.refreshWorkingModelSelector = refreshWorkingModelSelector;

wireTrainingWorkspace();
