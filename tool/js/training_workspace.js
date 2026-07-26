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

function fetchTrainingWorkspacePlan(folder) {
  var path = String(folder || '').replace(/[\\/]+$/, '') + '/auto_dataset/training_plan.json';
  return fetch('/fs/read?path=' + encodeURIComponent(path)).then(function (response) {
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Could not read the training plan.');
    return response.text().then(function (text) {
      return JSON.parse(text);
    });
  });
}

function trainingWorkspaceProfileForPlan(plan) {
  var profile = String(plan && plan.mode || '').trim().toLowerCase();
  return ['poc', 'normal', 'quality'].indexOf(profile) !== -1 ? profile : 'normal';
}

function syncTrainingWorkspaceProfile(plan) {
  var els = getTrainingWorkspaceEls();
  if (els.profileSelect) els.profileSelect.value = trainingWorkspaceProfileForPlan(plan);
}

function getTrainingWorkspaceSelectedProfile(folder) {
  if (!isTrainingWorkspaceActive() || trainingWorkspaceState.trainingPlanFolder !== String(folder || '')) {
    return 'normal';
  }
  var els = getTrainingWorkspaceEls();
  return trainingWorkspaceProfileForPlan({ mode: els.profileSelect ? els.profileSelect.value : '' });
}

function fetchTrainingProfiles() {
  if (trainingWorkspaceState.profiles.length) return Promise.resolve(trainingWorkspaceState.profiles);
  return fetch('/fs/training_profiles').then(function (response) {
    if (!response.ok) throw new Error('Could not load training profiles.');
    return response.json();
  }).then(function (payload) {
    trainingWorkspaceState.profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
    return trainingWorkspaceState.profiles;
  });
}

function trainingProfileStorageKey(folder) {
  return 'webcap.trainingProfile.' + String(folder || '');
}

function getSelectedTrainingModelProfile() {
  var profiles = trainingWorkspaceState.profiles || [];
  for (var i = 0; i < profiles.length; i++) {
    if (profiles[i].id === trainingWorkspaceState.selectedProfileId) return profiles[i];
  }
  return profiles[0] || null;
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
  try { stored = localStorage.getItem(trainingProfileStorageKey(folder)) || ''; } catch (err) {}
  if (stored && (trainingWorkspaceState.profiles || []).some(function (profile) { return profile.id === stored; })) {
    trainingWorkspaceState.selectedProfileId = stored;
  }
  select.innerHTML = (trainingWorkspaceState.profiles || []).map(function (profile) {
    return '<option value="' + escapeHtml(profile.id) + '">' + escapeHtml(profile.label) + '</option>';
  }).join('');
  select.value = trainingWorkspaceState.selectedProfileId;
  setManagedTrainingStages(trainingWorkspaceState.runStages);
}

function setSelectedTrainingModelProfile(profileId) {
  trainingWorkspaceState.selectedProfileId = String(profileId || 'wan22_t2v');
  try { localStorage.setItem(trainingProfileStorageKey(state.folder), trainingWorkspaceState.selectedProfileId); } catch (err) {}
  setManagedTrainingStages(trainingWorkspaceState.runStages);
  syncTrainingWorkflowReadiness(trainingWorkspaceState.manifest, trainingWorkspaceState.configFiles);
  renderTrainingWorkspaceConfigList(trainingWorkspaceState.configFiles);
  renderTrainingModelTrainedStatus();
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

function trainingConfigFilesAreReady(configFiles) {
  var files = Array.isArray(configFiles) ? configFiles : [];
  var available = {};
  files.forEach(function (fileName) { available[String(fileName || '').toLowerCase()] = true; });
  var profile = getSelectedTrainingModelProfile();
  var needed = profile && Array.isArray(profile.configs) ? profile.configs.map(function (config) { return config.file; }).concat(profile.datasetFiles || []) : ['config.hi.toml', 'config.lo.toml', 'dataset.hi.toml', 'dataset.lo.toml'];
  return needed.every(function (fileName) {
    return !!available[fileName];
  });
}

function syncTrainingWorkflowReadiness(manifest, configFiles) {
  var els = getTrainingWorkspaceEls();
  var datasetReady = !!manifest;
  var configsReady = trainingConfigFilesAreReady(configFiles);
  if (els.configStepNumber) els.configStepNumber.classList.toggle('is-waiting', !datasetReady);
  if (els.runStepNumber) els.runStepNumber.classList.toggle('is-waiting', !datasetReady || !configsReady);
  if (els.generateBtn) {
    els.generateBtn.title = datasetReady
      ? 'Generate configs for the prepared dataset.'
      : 'Generate configs. The current dataset will be prepared first.';
  }
  if (els.queueJobBtn) {
    els.queueJobBtn.title = configsReady
      ? 'Start this set when the runner is idle, or add it behind active work.'
      : (datasetReady
        ? 'Start this set. Configs will be generated first.'
        : 'Start this set. The dataset will be prepared and configs generated first.');
  }
}

function getTrainingManifestItems(manifest) {
  if (!manifest || typeof manifest !== 'object') return [];
  var items = [];
  ['images', 'videos'].forEach(function (kind) {
    var rows = Array.isArray(manifest[kind]) ? manifest[kind] : [];
    rows.forEach(function (row) {
      var fileName = String(row && row.file || '').trim();
      if (!fileName) return;
      items.push({
        fileName: fileName,
        kind: kind === 'videos' ? 'video' : 'image',
        aspect: String(row.ar || '').trim()
      });
    });
  });
  return items;
}

function renderTrainingItemOverview(manifest, errorMessage) {
  var els = getTrainingWorkspaceEls();
  if (!els.itemOverview || !els.itemOverviewSummary || !els.itemOverviewToggleBtn) return;
  els.itemOverview.replaceChildren();

  function syncVisibility(hasItems) {
    var hidden = !!trainingWorkspaceState.itemOverviewHidden;
    els.itemOverview.classList.toggle('hidden', hidden);
    els.itemOverviewToggleBtn.classList.toggle('hidden', !hasItems);
    els.itemOverviewToggleBtn.textContent = hidden ? 'Show items' : 'Hide items';
    els.itemOverviewToggleBtn.setAttribute('aria-expanded', hidden ? 'false' : 'true');
  }

  if (errorMessage) {
    els.itemOverviewSummary.textContent = errorMessage;
    syncVisibility(false);
    return;
  }

  var items = getTrainingManifestItems(manifest);
  if (!manifest) {
    els.itemOverviewSummary.textContent = 'Prepare the dataset to see its training items here.';
    syncVisibility(false);
    return;
  }

  var imageCount = 0;
  var videoCount = 0;
  items.forEach(function (item) {
    if (item.kind === 'video') videoCount++;
    else imageCount++;
  });
  els.itemOverviewSummary.textContent = items.length + ' prepared item' + (items.length === 1 ? '' : 's') +
    ' · ' + imageCount + ' image' + (imageCount === 1 ? '' : 's') +
    ' · ' + videoCount + ' video' + (videoCount === 1 ? '' : 's');

  if (!items.length) {
    els.itemOverviewSummary.textContent = 'The prepared dataset has no displayable media items.';
    syncVisibility(false);
    return;
  }

  syncVisibility(true);
  if (trainingWorkspaceState.itemOverviewHidden) return;

  var grid = document.createElement('div');
  grid.className = 'training-item-grid';
  items.forEach(function (item) {
    var tile = document.createElement('div');
    tile.className = 'training-item-tile';
    tile.title = item.fileName;

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
  if (!files.length) {
    els.configList.textContent = 'Generate configs to inspect and edit them here.';
    return;
  }
  var grouped = {};
  (trainingWorkspaceState.profiles || []).forEach(function (profile) { grouped[profile.id] = []; });
  files.forEach(function (fileName) {
    var owner = (trainingWorkspaceState.profiles || []).filter(function (profile) {
      return (profile.configs || []).some(function (config) { return config.file === fileName; }) || (profile.datasetFiles || []).indexOf(fileName) !== -1;
    })[0];
    (grouped[owner ? owner.id : 'other'] || (grouped.other = [])).push(fileName);
  });
  els.configList.innerHTML = Object.keys(grouped).filter(function (id) { return grouped[id].length; }).map(function (id) {
    var profile = (trainingWorkspaceState.profiles || []).filter(function (item) { return item.id === id; })[0];
    var label = profile ? profile.label : 'Other files';
    return '<section class="training-config-group"><div class="training-config-group-heading"><strong>' + escapeHtml(label) + '</strong><span>' + grouped[id].length + ' file' + (grouped[id].length === 1 ? '' : 's') + '</span></div><div class="training-config-links">' + grouped[id].map(function (fileName) {
      var active = !!(state.currentConfigFile && state.currentConfigFile.folder === state.folder && state.currentConfigFile.file === fileName);
      var reset = /^config\./.test(fileName) ? '<button type="button" class="training-config-reset" data-training-reset-config="' + encodeURIComponent(fileName) + '">Reset</button>' : '';
      return '<div class="training-config-file"><button type="button" class="training-config-link' + (active ? ' active' : '') + '" data-training-config="' + encodeURIComponent(fileName) + '">' + escapeHtml(fileName) + '</button>' + reset + '</div>';
    }).join('') + '</div></section>';
  }).join('');
  Array.prototype.forEach.call(els.configList.querySelectorAll('[data-training-config]'), function (button) {
    button.onclick = function () {
      loadConfigFileToEditor(decodeURIComponent(button.getAttribute('data-training-config') || ''), {
        preserveTrainingWorkspace: true
      });
    };
  });
  Array.prototype.forEach.call(els.configList.querySelectorAll('[data-training-reset-config]'), function (button) {
    button.onclick = function () {
      var fileName = decodeURIComponent(button.getAttribute('data-training-reset-config') || '');
      if (!window.confirm('Reset ' + fileName + ' from the app template? Your edits to this file will be replaced.')) return;
      trainingRunnerRequest('/fs/training_config/reset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: state.folder, file: fileName })
      }).then(function () { refreshTrainingWorkspace(); }).catch(function (err) { setStatus('Could not reset config: ' + String(err.message || err)); });
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
    trainingWorkspaceState.manifest = null;
    trainingWorkspaceState.trainingPlan = null;
    trainingWorkspaceState.trainingPlanFolder = '';
    trainingWorkspaceState.configFiles = [];
    syncTrainingWorkspaceProfile(null);
    if (els.readiness) els.readiness.textContent = 'Select a set folder to prepare a dataset.';
    renderTrainingItemOverview(null);
    renderTrainingWorkspaceConfigList([]);
    refreshTrainingHistory();
    renderTrainingCommandHandoff();
    return;
  }
  if (els.readiness) els.readiness.textContent = 'Loading dataset readiness...';
  trainingWorkspaceState.trainingPlanFolder = '';
  syncTrainingWorkspaceProfile(null);
  fetchTrainingProfiles().then(function () {
    if (state.folder !== folder || !isTrainingWorkspaceActive()) return;
    syncTrainingModelProfileSelect(folder);
  }).catch(function (err) {
    if (state.folder !== folder || !isTrainingWorkspaceActive()) return;
    if (els.modelProfileSelect) {
      els.modelProfileSelect.innerHTML = '<option value="">Profiles unavailable</option>';
      els.modelProfileSelect.disabled = true;
    }
    if (window.console && console.error) console.error('[Training workspace] Could not load profiles:', err);
  });
  Promise.all([fetchTrainingWorkspaceManifest(folder), fetchTrainingWorkspaceConfigFiles(folder), fetchTrainingWorkspacePlan(folder), refreshTrainingHistory()])
    .then(function (results) {
      if (state.folder !== folder || !isTrainingWorkspaceActive()) return;
      trainingWorkspaceState.manifest = results[0];
      trainingWorkspaceState.configFiles = results[1];
      trainingWorkspaceState.trainingPlan = results[2];
      trainingWorkspaceState.trainingPlanFolder = folder;
      syncTrainingWorkspaceProfile(results[2]);
      syncTrainingModelProfileSelect(folder);
      syncTrainingWorkflowReadiness(results[0], results[1]);
      if (els.readiness) els.readiness.innerHTML = buildTrainingReadinessHtml(results[0], results[1]);
      renderTrainingItemOverview(results[0]);
      renderTrainingWorkspaceConfigList(results[1]);
      renderTrainingCommandHandoff();
      syncWorkspaceConfigEditorUi();
    })
    .catch(function (err) {
      if (state.folder !== folder || !isTrainingWorkspaceActive()) return;
      if (els.readiness) els.readiness.textContent = String(err && err.message ? err.message : err);
      renderTrainingItemOverview(null, 'Could not load the prepared dataset overview.');
    });
}

function runTrainingWorkspaceAction(action, options) {
  var runner = action === 'prepare'
    ? runPrepareDatasetForCurrentFolder
    : action === 'generate'
      ? runGenerateDatasetConfigsForCurrentFolder
      : runTrainCommandPreviewForCurrentFolder;
  var request = action === 'train' ? runner(options) : runner();
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

function wireTrainingWorkspace() {
  var backBtn = document.getElementById('training-workspace-back-btn');
  var sidebarCollapseBtn = document.getElementById('training-sidebar-collapse-toggle-btn');
  var prepareBtn = document.getElementById('training-workspace-prepare-btn');
  var generateBtn = document.getElementById('training-workspace-generate-btn');
  var modelProfileSelect = document.getElementById('training-model-profile-select');
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
    renderTrainingItemOverview(trainingWorkspaceState.manifest);
  };
  prepareBtn.onclick = function () { runTrainingWorkspaceAction('prepare'); };
  generateBtn.onclick = function () { runTrainingWorkspaceAction('generate'); };
  if (modelProfileSelect) modelProfileSelect.onchange = function () { setSelectedTrainingModelProfile(modelProfileSelect.value); };
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
    runTrainingWorkspaceAction('train', getManagedTrainingOptions());
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
    var clearId = event.target.getAttribute('data-training-history-clear');
    if (outputJobId) {
      var outputJob = (trainingWorkspaceState.history.jobs || []).filter(function (item) { return item.id === outputJobId; })[0];
      openTrainingHistoryOutput(outputJob && outputJob.folder, outputJobId);
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
    button.textContent = visible ? 'Hide Output' : 'Show Output';
    button.title = visible ? 'Hide output from the active training run.' : 'Show output from the active training run.';
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
