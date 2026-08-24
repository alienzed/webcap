function normalizeTrainingWorkspaceMode(mode) {
  var value = String(mode || '').trim().toLowerCase();
  return ['poc', 'normal', 'quality'].indexOf(value) !== -1 ? value : 'normal';
}

function syncTrainingWorkspaceProfile() {
  var els = getTrainingWorkspaceEls();
  if (els.profileSelect) els.profileSelect.value = normalizeTrainingWorkspaceMode(trainingWorkspaceState.selectedMode);
}

function getTrainingWorkspaceSelectedProfile(folder) {
  var els = getTrainingWorkspaceEls();
  return normalizeTrainingWorkspaceMode(els.profileSelect ? els.profileSelect.value : trainingWorkspaceState.selectedMode);
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

function trainingProfileStorageKey(folder) {
  return 'webcap.trainingProfile.' + String(folder || '');
}

function trainingModeStorageKey(folder) {
  return 'webcap.trainingMode.' + String(folder || '');
}

function getSelectedTrainingModelProfile() {
  var profiles = trainingWorkspaceState.profiles || [];
  for (var i = 0; i < profiles.length; i++) {
    if (profiles[i].id === trainingWorkspaceState.selectedProfileId) return profiles[i];
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
    var runStage = run.stages && run.stages.length === 1 ? run.stages[0] : 'both';
    if (runStage === stage) return run;
  }
  return null;
}

function syncTrainingModelProfileSelect(folder) {
  var select = getTrainingWorkspaceEls().modelProfileSelect;
  if (!select) return;
  select.disabled = false;
  var stored = '';
  var storedMode = '';
  try { stored = localStorage.getItem(trainingProfileStorageKey(folder)) || ''; } catch (err) {}
  try { storedMode = localStorage.getItem(trainingModeStorageKey(folder)) || ''; } catch (err) {}
  var profiles = trainingWorkspaceState.profiles || [];
  var storedIsAvailable = stored && profiles.some(function (profile) { return profile.id === stored; });
  var selectedIsAvailable = profiles.some(function (profile) { return profile.id === trainingWorkspaceState.selectedProfileId; });
  if (storedIsAvailable) trainingWorkspaceState.selectedProfileId = stored;
  else if (!selectedIsAvailable) trainingWorkspaceState.selectedProfileId = profiles[0].id;
  trainingWorkspaceState.selectedMode = normalizeTrainingWorkspaceMode(storedMode || trainingWorkspaceState.selectedMode);
  select.innerHTML = profiles.map(function (profile) {
    return '<option value="' + escapeHtml(profile.id) + '">' + escapeHtml(profile.label) + '</option>';
  }).join('');
  select.value = trainingWorkspaceState.selectedProfileId;
  try { localStorage.setItem(trainingProfileStorageKey(folder), trainingWorkspaceState.selectedProfileId); } catch (err) {}
  syncTrainingWorkspaceProfile();
  setManagedTrainingStages(trainingWorkspaceState.runStages);
}

function setSelectedTrainingModelProfile(profileId) {
  trainingWorkspaceState.selectedProfileId = String(profileId || 'wan22_t2v');
  try { localStorage.setItem(trainingProfileStorageKey(state.folder), trainingWorkspaceState.selectedProfileId); } catch (err) {}
  setManagedTrainingStages(trainingWorkspaceState.runStages);
  renderTrainingModelTrainedStatus();
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
      profileId: trainingWorkspaceState.selectedProfileId,
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
  if (els.configStepNumber) els.configStepNumber.classList.toggle('is-waiting', !configsReady);
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

function renderTrainingWorkspaceConfigList(files) {
  var els = getTrainingWorkspaceEls();
  if (!els.configList) return;
  var setup = getSelectedTrainingSetup();
  var expected = setup && Array.isArray(setup.configs)
    ? setup.configs.map(function (item) { return item.file; }).concat(setup.datasetFiles || [])
    : [];
  var available = {};
  (files || []).forEach(function (fileName) { available[fileName] = true; });
  var visibleFiles = expected.filter(function (fileName) { return !!available[fileName]; });
  if (!visibleFiles.length) {
    els.configList.textContent = 'No setup files are available.';
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
      setTrainingDetailTab('config');
      loadConfigFileToEditor(decodeURIComponent(button.getAttribute('data-training-config') || ''), {
        preserveTrainingWorkspace: true
      });
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
      ensureSelectedTrainingSetup(fileName).then(function () {
        if (state.currentConfigFile && state.currentConfigFile.file === fileName) loadConfigFileToEditor(fileName, { preserveTrainingWorkspace: true });
        refreshTrainingWorkspace();
      }).catch(function (err) { setStatus('Could not reset file: ' + String(err.message || err)); });
    };
  });
}

function syncTrainingWorkspaceConfigSelection() {
  if (!isTrainingWorkspaceActive()) return;
  var els = getTrainingWorkspaceEls();
  if (!els.configList) return;
  var currentFile = state.currentConfigFile && state.currentConfigFile.folder === state.folder
    ? state.currentConfigFile.file
    : '';
  Array.prototype.forEach.call(els.configList.querySelectorAll('[data-training-config]'), function (button) {
    var fileName = decodeURIComponent(button.getAttribute('data-training-config') || '');
    button.classList.toggle('active', fileName === currentFile);
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
    ? 'Manual command generated and copied to the clipboard.'
    : 'Print and copy a manual WSL command when you need one.';
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
  var isSetEntry = !!folder;
  if (els.navigatorTitle) els.navigatorTitle.textContent = isSetEntry ? 'Train' : 'Training';
  if (els.folder) els.folder.textContent = isSetEntry ? folder : 'Global training status';
  if (els.globalContext) els.globalContext.classList.toggle('training-global-context--after-set', isSetEntry);
  if (els.globalContext) els.globalContext.classList.toggle('training-global-context--global', !isSetEntry);
  if (els.setWorkflow) els.setWorkflow.classList.toggle('hidden', !isSetEntry);
  if (els.runSetup) els.runSetup.classList.toggle('hidden', !isSetEntry);
  if (!isSetEntry) {
    trainingWorkspaceState.configFiles = [];
    if (els.readiness) els.readiness.textContent = 'Select a set folder to configure training.';
    renderTrainingItemOverview(null);
    renderTrainingWorkspaceConfigList([]);
    refreshTrainingHistory();
    renderTrainingCommandHandoff();
    return;
  }
  if (els.readiness) els.readiness.textContent = 'Loading training setup...';
  fetchTrainingProfiles()
    .then(function () {
      if (state.folder !== folder || !isTrainingWorkspaceActive()) return null;
      syncTrainingModelProfileSelect(folder);
      return ensureSelectedTrainingSetup();
    })
    .then(function () {
      if (state.folder !== folder || !isTrainingWorkspaceActive()) return [];
      return Promise.all([fetchTrainingWorkspaceConfigFiles(folder), refreshTrainingHistory()]);
    })
    .then(function (results) {
      if (state.folder !== folder || !isTrainingWorkspaceActive()) return;
      trainingWorkspaceState.configFiles = results[0];
      syncTrainingWorkflowReadiness(null, results[0]);
      if (els.readiness) els.readiness.innerHTML = buildTrainingReadinessHtml();
      renderTrainingItemOverview(null);
      renderTrainingWorkspaceConfigList(results[0]);
      renderTrainingCommandHandoff();
      syncWorkspaceConfigEditorUi();
    })
    .catch(function (err) {
      if (state.folder !== folder || !isTrainingWorkspaceActive()) return;
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
    syncTrainingModelProfileSelect(state.folder);
  });
}

function wireTrainingWorkspace() {
  var backBtn = document.getElementById('training-workspace-back-btn');
  var sidebarCollapseBtn = document.getElementById('training-sidebar-collapse-toggle-btn');
  var modelProfileSelect = document.getElementById('training-model-profile-select');
  var modeSelect = document.getElementById('training-workspace-profile-select');
  var modelTrainedStatus = document.getElementById('training-model-trained-status');
  var stageButtons = document.querySelectorAll('[data-training-stage]');
  var resumeInput = document.getElementById('training-run-resume-input');
  var checkpointSelect = document.getElementById('training-run-checkpoint-select');
  var resumeStageSelect = document.getElementById('training-run-resume-stage-select');
  var itemOverviewToggleBtn = document.getElementById('training-item-overview-toggle-btn');
  var previewCommandBtn = document.getElementById('training-preview-command-btn');
  var validateRunnerBtn = document.getElementById('training-validate-runner-btn');
  var runInAppBtn = document.getElementById('training-run-in-app-btn');
  var queueJobBtn = document.getElementById('training-queue-job-btn');
  var copyCommandBtn = document.getElementById('training-copy-command-btn');
  var consoleBtn = document.getElementById('training-console-btn');
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
  var historyClearBtn = document.getElementById('training-history-clear-btn');
  backBtn.onclick = function () { exitWorkspaceSurface(); };
  sidebarCollapseBtn.onclick = function () { toggleSidebarCollapsed(); };
  itemOverviewToggleBtn.onclick = function () {
    trainingWorkspaceState.itemOverviewHidden = !trainingWorkspaceState.itemOverviewHidden;
    renderTrainingItemOverview(null);
  };
  if (modelProfileSelect) modelProfileSelect.onchange = function () { switchTrainingSetup(modelProfileSelect.value, ''); };
  if (modeSelect) modeSelect.onchange = function () { switchTrainingSetup('', modeSelect.value); };
  if (modelTrainedStatus) modelTrainedStatus.onclick = function (event) {
    var button = event.target.closest('[data-training-trained-output]');
    if (!button) return;
    openDiscoveredTrainingRun(button.getAttribute('data-training-trained-model'), button.getAttribute('data-training-trained-output'));
  };
  stageButtons.forEach(function (button) {
    button.onclick = function () {
      setManagedTrainingStages(button.getAttribute('data-training-stage'));
    };
  });
  setManagedTrainingStages(trainingWorkspaceState.runStages);
  if (resumeInput) resumeInput.oninput = function () {
    trainingWorkspaceState.resumeParentJobId = '';
    syncManagedTrainingResumeUi();
  };
  if (checkpointSelect) checkpointSelect.onchange = function () {
    trainingWorkspaceState.resumeSelectionTouched = true;
    trainingWorkspaceState.resumeParentJobId = '';
    var selectedRun = (trainingWorkspaceState.history && trainingWorkspaceState.history.runs || []).filter(function (run) {
      return String(run.path || '') === String(checkpointSelect.value || '');
    })[0];
    if (selectedRun && (selectedRun.stage === 'hi' || selectedRun.stage === 'lo') && resumeStageSelect) {
      resumeStageSelect.value = selectedRun.stage;
    }
    syncManagedTrainingResumeUi();
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
  if (runInAppBtn) runInAppBtn.onclick = function () {
    startManagedTraining();
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
  consoleBtn.onclick = function () {
    toggleTrainingRunnerConsole();
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
    var outputId = event.target.getAttribute('data-training-job-output');
    if (outputId) openTrainingJobOutput(outputId);
    var bundleId = event.target.getAttribute('data-training-job-bundle');
    if (bundleId) openTrainingJobBundle(bundleId);
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
    var bundleId = event.target.getAttribute('data-training-job-bundle');
    if (bundleId) {
      openTrainingJobBundle(bundleId);
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
    var folderButton = event.target.closest('[data-training-open-folder]');
    var folder = folderButton && folderButton.getAttribute('data-training-open-folder');
    if (folder) {
      openTrainingWorkspaceFolder(folder);
      return;
    }
    var logId = event.target.getAttribute('data-training-history-log');
    var outputJobId = event.target.getAttribute('data-training-history-output');
    var bundleJobId = event.target.getAttribute('data-training-history-bundle');
    var clearId = event.target.getAttribute('data-training-history-clear');
    if (outputJobId) {
      var outputJob = (trainingWorkspaceState.history.jobs || []).filter(function (item) { return item.id === outputJobId; })[0];
      openTrainingHistoryOutput(outputJob && outputJob.folder, outputJobId);
      return;
    }
    if (bundleJobId) {
      var bundleJob = (trainingWorkspaceState.history.jobs || []).filter(function (item) { return item.id === bundleJobId; })[0];
      openTrainingJobBundle(bundleJobId, bundleJob && bundleJob.folder);
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
  if (historySearch) historySearch.oninput = renderTrainingHistory;
  if (historyClearBtn) historyClearBtn.onclick = clearTrainingHistory;
}

function syncTrainingConsoleUi() {
  var consoleBtn = document.getElementById('training-console-btn');
  var runnerConsoleBtn = document.getElementById('training-runner-console-btn');
  var visible = isTrainingRunnerConsoleVisible();
  [consoleBtn, runnerConsoleBtn].forEach(function (button) {
    if (!button) return;
    button.classList.toggle('active', visible);
    button.setAttribute('aria-pressed', visible ? 'true' : 'false');
    button.textContent = visible ? 'Hide Run Log' : 'Show Run Log';
    button.title = visible ? 'Hide the active training run log.' : 'Show the active training run log.';
  });
  syncWorkspaceConfigEditorUi();
}

function syncTrainingWorkspaceUi() {
  if (!isTrainingWorkspaceActive()) return;
  syncTrainingConsoleUi();
  refreshTrainingWorkspace();
  refreshTrainingRunnerStatus();
}

wireTrainingWorkspace();
