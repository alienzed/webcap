// Active training jobs, queue controls, progress, console output, and polling.
function getTrainingRunnerSelectedJob() {
  var jobs = trainingWorkspaceState.runnerJobs || [];
  for (var activeIndex = 0; activeIndex < jobs.length; activeIndex++) {
    if (jobs[activeIndex].id === trainingWorkspaceState.runnerActiveJobId) return jobs[activeIndex];
  }
  var selectedId = trainingWorkspaceState.runnerSelectedJobId;
  for (var i = 0; i < jobs.length; i++) {
    if (jobs[i].id === selectedId && jobs[i].status === 'queued') return jobs[i];
  }
  for (var queuedIndex = 0; queuedIndex < jobs.length; queuedIndex++) {
    if (jobs[queuedIndex].status === 'queued') return jobs[queuedIndex];
  }
  return null;
}

function getTrainingRunnerConsoleTargetJob() {
  return getTrainingRunnerActiveJob();
}

function getTrainingRunnerActiveJob() {
  var jobs = trainingWorkspaceState.runnerJobs || [];
  for (var i = 0; i < jobs.length; i++) {
    if (jobs[i].id === trainingWorkspaceState.runnerActiveJobId &&
        (jobs[i].status === 'starting' || jobs[i].status === 'running' || jobs[i].status === 'stopping')) return jobs[i];
  }
  for (var j = 0; j < jobs.length; j++) {
    if (jobs[j].status === 'starting' || jobs[j].status === 'running' || jobs[j].status === 'stopping') return jobs[j];
  }
  return null;
}

function syncUtilityTrainingActivity() {
  var utilityTrainingBtn = document.getElementById('utility-training-btn');
  var utilityTrainingProgress = document.getElementById('utility-training-progress');
  if (!utilityTrainingBtn) return;
  var running = (trainingWorkspaceState.runnerJobs || []).some(function (job) {
    return job.status === 'running';
  });
  utilityTrainingBtn.classList.toggle('training-running', running);
  utilityTrainingBtn.title = running ? 'Open Training (training in progress)' : 'Open Training';
  utilityTrainingBtn.setAttribute('aria-label', running ? 'Open Training (training in progress)' : 'Open Training');
  utilityTrainingProgress.hidden = !running;
  if (running && !utilityTrainingTurtleTimer) {
    utilityTrainingTurtleAtLeft = true;
    utilityTrainingProgress.style.transform = 'translateX(-3px)';
    utilityTrainingTurtleTimer = window.setInterval(function () {
      utilityTrainingTurtleAtLeft = !utilityTrainingTurtleAtLeft;
      utilityTrainingProgress.style.transform = utilityTrainingTurtleAtLeft ? 'translateX(-3px)' : 'translateX(3px)';
    }, 1000);
  } else if (!running && utilityTrainingTurtleTimer) {
    window.clearInterval(utilityTrainingTurtleTimer);
    utilityTrainingTurtleTimer = 0;
    utilityTrainingProgress.style.transform = '';
  }
}

function isTrainingRunnerConsoleVisible() {
  var els = getTrainingWorkspaceEls();
  return !!(els.runnerConsole && !els.runnerConsole.classList.contains('hidden'));
}

function appendToTrainingRunnerConsole(text) {
  var els = getTrainingWorkspaceEls();
  if (!els.runnerConsoleLog) return;
  els.runnerConsoleLog.textContent += String(text || '').replace(/\r\n?/g, '\n');
  if (els.runnerConsoleLog.textContent.length > 200000) {
    els.runnerConsoleLog.textContent = els.runnerConsoleLog.textContent.slice(-160000);
  }
  els.runnerConsoleLog.scrollTop = els.runnerConsoleLog.scrollHeight;
}

function hideTrainingRunnerConsole() {
  var els = getTrainingWorkspaceEls();
  trainingWorkspaceState.runnerConsoleRequestVersion++;
  if (els.runnerConsole) els.runnerConsole.classList.add('hidden');
  if (isTrainingWorkspaceActive()) setTrainingDetailTab('items', { keepLogVisible: true });
  syncTrainingConsoleUi();
}


function toggleTrainingRunnerConsole() {
  if (isTrainingRunnerConsoleVisible()) {
    hideTrainingRunnerConsole();
    return;
  }
  showTrainingRunnerConsole();
}


function showTrainingRunnerConsole(job, options) {
  var opts = options || {};
  var followsActiveJob = !job || !!opts.followActiveJob;
  var target = job || getTrainingRunnerConsoleTargetJob();
  if (!target || !target.id) {
    setStatus('No training run is active to show output for.');
    return;
  }
  var configFile = state.currentConfigFile;
  if (!opts.configClosed && isTrainingWorkspaceActive() && configFile && configFile.folder === state.folder && configFile.file) {
    cancelEditorAutosaveForConfig(configFile.folder, configFile.file);
    Promise.resolve(saveCurrentEditorContent())
      .then(function () {
        setTrainingDetailTab('run-log', { keepLogVisible: true });
        showTrainingRunnerConsole(target, { followActiveJob: followsActiveJob, configClosed: true });
      })
      .catch(function (err) {
        setStatus('Could not save config before opening output: ' + String(err && err.message ? err.message : err));
      });
    return;
  }
  var els = getTrainingWorkspaceEls();
  if (!els.runnerConsole || !els.runnerConsoleLog) return;
  var changedJob = trainingWorkspaceState.runnerConsoleJobId !== target.id;
  var wasHidden = els.runnerConsole.classList.contains('hidden');
  trainingWorkspaceState.runnerConsoleJobId = target.id;
  trainingWorkspaceState.runnerConsoleFollowsActiveJob = followsActiveJob;
  var resetLog = changedJob || wasHidden;
  if (resetLog) {
    trainingWorkspaceState.runnerConsoleRequestVersion++;
    els.runnerConsoleLog.textContent = '';
    trainingWorkspaceState.runnerLogOffsets[target.id] = 0;
  }
  if (els.runnerConsoleRevealBtn) els.runnerConsoleRevealBtn.disabled = false;
  setTrainingDetailTab('run-log', { keepLogVisible: true });
  els.runnerConsoleTitle.textContent = 'Run Log · ' + trainingFolderName(target.folder);
  els.runnerConsole.classList.remove('hidden');
  syncTrainingConsoleUi();
  fetchTrainingRunnerLog(target, resetLog);
}

function fetchTrainingRunnerLog(job, reset) {
  if (!job || !job.id) return;
  var offset = reset ? 0 : Number(trainingWorkspaceState.runnerLogOffsets[job.id] || 0);
  var requestVersion = trainingWorkspaceState.runnerConsoleRequestVersion;
  if (trainingWorkspaceState.runnerConsoleLogRequestVersion === requestVersion) return;
  trainingWorkspaceState.runnerConsoleLogRequestVersion = requestVersion;
  fetch('/fs/training_runner/log?jobId=' + encodeURIComponent(job.id) + '&folder=' + encodeURIComponent(job.folder || '') + '&offset=' + encodeURIComponent(offset) + (reset ? '&tail=1' : ''))
    .then(function (response) { return response.json(); })
    .then(function (payload) {
      if (!payload || !payload.ok) throw new Error((payload && payload.error) || 'Could not load training output.');
      if (trainingWorkspaceState.runnerConsoleJobId !== job.id ||
          requestVersion !== trainingWorkspaceState.runnerConsoleRequestVersion ||
          !isTrainingRunnerConsoleVisible()) return;
      var nextOffset = Number(payload.nextOffset || 0);
      if (!reset && nextOffset < offset) {
        var els = getTrainingWorkspaceEls();
        if (els.runnerConsoleLog) els.runnerConsoleLog.textContent = '';
        trainingWorkspaceState.runnerLogOffsets[job.id] = 0;
        trainingWorkspaceState.runnerConsoleRequestVersion++;
        fetchTrainingRunnerLog(job, true);
        return;
      }
      trainingWorkspaceState.runnerLogOffsets[job.id] = nextOffset;
      if (payload.truncated) {
        appendToTrainingRunnerConsole('[webcap] Showing the latest log output. Earlier output is available in the log file.\n\n');
      }
      if (payload.text) appendToTrainingRunnerConsole(payload.text);
      if (!payload.text && offset === 0 && payload.job && payload.job.error) {
        appendToTrainingRunnerConsole('[webcap] ' + payload.job.error + '\n');
      }
      if (payload.job) {
        var jobs = trainingWorkspaceState.runnerJobs;
        for (var i = 0; i < jobs.length; i++) {
          if (jobs[i].id === payload.job.id) jobs[i] = payload.job;
        }
        renderTrainingRunner();
      }
    })
    .catch(function (err) {
      if (trainingWorkspaceState.runnerConsoleJobId !== job.id ||
          requestVersion !== trainingWorkspaceState.runnerConsoleRequestVersion) return;
      if (window.console && console.error) console.error('[Training runner] Log refresh failed:', err);
      setStatus('Could not load training output: ' + String(err && err.message ? err.message : err));
    })
    .then(function () {
      if (trainingWorkspaceState.runnerConsoleLogRequestVersion === requestVersion) {
        trainingWorkspaceState.runnerConsoleLogRequestVersion = 0;
      }
    });
}

function revealTrainingRunnerLog() {
  var job = getTrainingRunnerJobById(trainingWorkspaceState.runnerConsoleJobId);
  if (!job || !job.id) {
    setStatus('No training log is selected.');
    return;
  }
  trainingRunnerRequest('/fs/training_runner/open_log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: job.id, folder: job.folder || '' })
  }).then(function () {
    setStatus('Revealed training log file.');
  }).catch(function (err) {
    setStatus('Could not reveal training log: ' + String(err && err.message ? err.message : err));
  });
}

function scheduleTrainingRunnerPoll() {
  if (trainingWorkspaceState.runnerPollTimer) clearTimeout(trainingWorkspaceState.runnerPollTimer);
  if (!isTrainingWorkspaceActive()) return;
  var activeStatus = (trainingWorkspaceState.runnerJobs || []).map(function (job) { return job.status; });
  var hasActiveJob = activeStatus.some(function (status) {
    return status === 'starting' || status === 'running' || status === 'stopping';
  });
  if (!hasActiveJob) return;
  var transitioning = activeStatus.some(function (status) { return status === 'starting' || status === 'stopping'; });
  var delay = transitioning ? 5000 : (isTrainingRunnerConsoleVisible() ? 3000 : 30000);
  trainingWorkspaceState.runnerPollTimer = setTimeout(function () {
    refreshTrainingRunnerStatus();
  }, delay);
}

function scheduleTrainingTensorboardPoll() {
  if (trainingWorkspaceState.tensorboardPollTimer) clearTimeout(trainingWorkspaceState.tensorboardPollTimer);
  if (!isTrainingWorkspaceActive()) return;
  trainingWorkspaceState.tensorboardPollTimer = setTimeout(function () {
    trainingWorkspaceState.tensorboardPollTimer = 0;
    refreshTrainingTensorboardStatus();
  }, 20000);
}

function refreshTrainingRunnerStatus() {
  if (!isTrainingWorkspaceActive() || trainingWorkspaceState.runnerStatusPending) return;
  trainingWorkspaceState.runnerStatusPending = true;
  trainingRunnerRequest('/fs/training_runner/status', { allowNotOk: true })
    .then(function (payload) {
      if (!payload.ok) {
        var stateError = !!payload.stateError;
        trainingWorkspaceState.runnerRecoveryAvailable = stateError && !!payload.recoveryAvailable;
        trainingWorkspaceState.runnerStatusError = 'Training queue status unavailable: ' + String(payload.error || 'Unknown queue error.');
        renderTrainingRunner();
        return;
      }
      trainingWorkspaceState.runnerStatusError = '';
      trainingWorkspaceState.runnerRecoveryAvailable = false;
      var priorJobsById = {};
      (trainingWorkspaceState.runnerJobs || []).forEach(function (job) { priorJobsById[job.id] = job.status; });
      trainingWorkspaceState.runnerJobs = Array.isArray(payload.jobs) ? payload.jobs : [];
      trainingWorkspaceState.runnerActiveJobId = String(payload.activeJobId || '');
      trainingWorkspaceState.runnerQueuePaused = !!payload.queuePaused;
      trainingWorkspaceState.runnerQueuePauseReason = String(payload.queuePauseReason || '');
      trainingWorkspaceState.runnerNotice = String(payload.runnerNotice || '');
      renderTrainingRunner();
      var terminalOutcome = trainingWorkspaceState.runnerJobs.some(function (job) {
        return (job.status === 'completed' || job.status === 'finished_early' || job.status === 'failed' || job.status === 'stopped' || job.status === 'cancelled') &&
          priorJobsById[job.id] !== job.status;
      });
      var currentJobsById = {};
      trainingWorkspaceState.runnerJobs.forEach(function (job) { currentJobsById[job.id] = true; });
      var retiredOutcome = Object.keys(priorJobsById).some(function (jobId) {
        var prior = priorJobsById[jobId];
        return !currentJobsById[jobId] && prior !== 'queued';
      });
      var recoveredOutcome = trainingWorkspaceState.runnerJobs.some(function (job) {
        var prior = priorJobsById[job.id];
        var active = job.status === 'starting' || job.status === 'running' || job.status === 'stopping';
        return active && (prior === 'interrupted' || prior === 'failed' || prior === 'stopped');
      });
      if (terminalOutcome || retiredOutcome || recoveredOutcome) {
        trainingWorkspaceState.historyCollapsed = false;
        refreshTrainingHistory(true);
      }
      var hasActiveJob = trainingWorkspaceState.runnerJobs.some(function (job) {
        return job.status === 'starting' || job.status === 'running' || job.status === 'stopping';
      });
      var now = Date.now();
      var activeStateChanged = trainingWorkspaceState.gpuForActiveJob !== hasActiveJob;
      trainingWorkspaceState.gpuForActiveJob = hasActiveJob;
      if (activeStateChanged || !trainingWorkspaceState.gpuLastFetchedAt || now - trainingWorkspaceState.gpuLastFetchedAt >= 20000) {
        refreshTrainingGpuStatus();
      }
      if (!trainingWorkspaceState.tensorboardLastFetchedAt || now - trainingWorkspaceState.tensorboardLastFetchedAt >= 20000) {
        refreshTrainingTensorboardStatus();
      }
      if (isTrainingRunnerConsoleVisible()) {
        var activeJob = getTrainingRunnerActiveJob();
        if (trainingWorkspaceState.runnerConsoleFollowsActiveJob && activeJob && activeJob.id !== trainingWorkspaceState.runnerConsoleJobId) {
          showTrainingRunnerConsole(activeJob, { followActiveJob: true });
        } else if (trainingWorkspaceState.runnerConsoleFollowsActiveJob && !activeJob && trainingWorkspaceState.runnerConsoleJobId) {
          var consoleEls = getTrainingWorkspaceEls();
          trainingWorkspaceState.runnerConsoleRequestVersion++;
          trainingWorkspaceState.runnerConsoleJobId = '';
          if (consoleEls.runnerConsoleLog) consoleEls.runnerConsoleLog.textContent = '';
          if (consoleEls.runnerConsoleTitle) consoleEls.runnerConsoleTitle.textContent = 'Run Log · waiting for the next run';
        } else {
          var consoleJob = getTrainingRunnerJobById(trainingWorkspaceState.runnerConsoleJobId);
          if (consoleJob) fetchTrainingRunnerLog(consoleJob);
        }
      }
    })
    .catch(function (err) {
      trainingWorkspaceState.runnerRecoveryAvailable = false;
      trainingWorkspaceState.runnerStatusError = 'Training queue status unavailable: ' + String(err && err.message ? err.message : err);
      renderTrainingRunner();
      setStatus(trainingWorkspaceState.runnerStatusError);
      if (window.console && console.error) console.error('[Training runner] Status refresh failed:', err);
    })
    .then(function () {
      trainingWorkspaceState.runnerStatusPending = false;
      scheduleTrainingRunnerPoll();
    });
}

function recoverManagedTrainingQueue() {
  if (!window.confirm('Archive the damaged queue state and start an empty queue? Existing job files will be kept.')) return;
  trainingRunnerRequest('/fs/training_runner/recover', { method: 'POST' })
    .then(function () {
      trainingWorkspaceState.runnerJobs = [];
      trainingWorkspaceState.runnerActiveJobId = '';
      trainingWorkspaceState.runnerQueuePaused = false;
      trainingWorkspaceState.runnerQueuePauseReason = '';
      trainingWorkspaceState.runnerStatusError = '';
      trainingWorkspaceState.runnerRecoveryAvailable = false;
      setStatus('Training queue recovered. The damaged state was archived.');
      refreshTrainingRunnerStatus();
    })
    .catch(function (err) {
      setStatus('Could not recover training queue: ' + String(err && err.message ? err.message : err));
    });
}

function refreshTrainingGpuStatus() {
  if (!isTrainingWorkspaceActive() || trainingWorkspaceState.gpuStatusPending) return;
  trainingWorkspaceState.gpuStatusPending = true;
  renderTrainingRunner();
  trainingRunnerRequest('/fs/training_runner/gpu')
    .then(function (payload) {
      trainingWorkspaceState.gpu = payload.gpu || null;
    })
    .catch(function (err) {
      trainingWorkspaceState.gpu = { available: false, error: String(err && err.message ? err.message : err) };
    })
    .then(function () {
      trainingWorkspaceState.gpuLastFetchedAt = Date.now();
      trainingWorkspaceState.gpuStatusPending = false;
      renderTrainingRunner();
    });
}

function refreshTrainingTensorboardStatus() {
  if (!isTrainingWorkspaceActive() || trainingWorkspaceState.tensorboardStatusPending) return;
  trainingWorkspaceState.tensorboardStatusPending = true;
  renderTrainingRunner();
  trainingRunnerRequest('/fs/training_runner/tensorboard')
    .then(function (payload) {
      trainingWorkspaceState.tensorboard = payload.tensorboard || null;
    })
    .catch(function (err) {
      trainingWorkspaceState.tensorboard = {
        running: false,
        controlEnabled: false,
        diagnostic: String(err && err.message ? err.message : err)
      };
    })
    .then(function () {
      trainingWorkspaceState.tensorboardLastFetchedAt = Date.now();
      trainingWorkspaceState.tensorboardStatusPending = false;
      renderTrainingRunner();
      scheduleTrainingTensorboardPoll();
    });
}

function controlTrainingTensorboard(action) {
  if (trainingWorkspaceState.tensorboardStatusPending) return;
  trainingWorkspaceState.tensorboardStatusPending = true;
  renderTrainingRunner();
  trainingRunnerRequest('/fs/training_runner/tensorboard/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: action })
  }).then(function (payload) {
    trainingWorkspaceState.tensorboard = payload.tensorboard || trainingWorkspaceState.tensorboard;
    setStatus(action === 'restart' ? 'TensorBoard restarted.' : 'TensorBoard started.');
  }).catch(function (err) {
    setStatus('Could not ' + action + ' TensorBoard: ' + String(err && err.message ? err.message : err));
  }).then(function () {
    trainingWorkspaceState.tensorboardStatusPending = false;
    trainingWorkspaceState.tensorboardLastFetchedAt = 0;
    renderTrainingRunner();
    refreshTrainingTensorboardStatus();
  });
}

function validateTrainingRunner(options) {
  if (!state.folder) return Promise.reject(new Error('No folder selected for training validation.'));
  setStatus('Validating managed training runner...');
  return trainingRunnerRequest('/fs/training_runner/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folder: state.folder,
      stages: options && options.stages ? options.stages : '',
      profileId: options && options.profileId ? options.profileId : '',
      runId: options && options.runId ? options.runId : '',
      mode: options && options.mode ? options.mode : 'normal',
      resumeFromCheckpoint: options && options.resumeFromCheckpoint ? options.resumeFromCheckpoint : '',
      resumeStage: options && options.resumeStage ? options.resumeStage : '',
      resumeActionId: options && options.resumeActionId ? options.resumeActionId : '',
      resumeOutputId: options && options.resumeOutputId ? options.resumeOutputId : '',
      selected_media: getVisibleMediaSelectionForTraining(),
      fallback_captions: buildTrainingFallbackCaptions(getVisibleMediaSelectionForTraining()).fallbackCaptions,
      selection_criteria: buildTrainingSelectionCriteria(),
      total_media_count: Array.isArray(state.items) ? state.items.length : 0
    }),
    allowNotOk: true
  }).then(function (payload) {
    renderTrainingRunnerPreflight(payload);
    setStatus(payload.ok ? 'Training runner validation passed.' : 'Training runner validation found blockers.');
    return payload;
  });
}

function getManagedTrainingOptions() {
  var manualResumeEl = document.getElementById('training-run-resume-input');
  var checkpointEl = document.getElementById('training-run-checkpoint-select');
  var resumeStageEl = document.getElementById('training-run-resume-stage-select');
  var runNameEl = document.getElementById('training-run-name-input');
  var stages = String(trainingWorkspaceState.runStages || 'h3');
  if (stages !== 'hi' && stages !== 'lo' && stages !== 'krea2' && stages !== 'wan21' && stages !== 'h3') stages = 'h3';
  var selectedProfile = getSelectedTrainingModelProfile();
  var selectedRun = getTrainingProfileRunForStage(selectedProfile, stages);
  var startingPoint = String(trainingWorkspaceState.reviewStartingPoint || 'fresh');
  var initializer = (trainingWorkspaceState.reviewInitializers || []).filter(function (item) {
    return item && item.exportId === trainingWorkspaceState.reviewInitializerExportId;
  })[0] || null;
  var initializerCustomPath = String(trainingWorkspaceState.reviewInitializerCustomPath || '').trim();
  var usingInitializer = startingPoint === 'initializer' && (initializer || initializerCustomPath);
  var usingResume = startingPoint === 'resume';
  var selectedCheckpoint = checkpointEl && checkpointEl.selectedOptions && checkpointEl.selectedOptions[0]
    ? checkpointEl.selectedOptions[0] : null;
  var customResumePath = manualResumeEl ? String(manualResumeEl.value || '').trim() : '';
  var resumeActionId = usingResume && !customResumePath && selectedCheckpoint ? String(selectedCheckpoint.getAttribute('data-action-id') || '') : '';
  var resumeOutputId = usingResume && !customResumePath && selectedCheckpoint ? String(selectedCheckpoint.getAttribute('data-output-id') || '') : '';
  return {
    stages: stages,
    profileId: selectedProfile ? selectedProfile.id : '',
    runId: selectedRun ? selectedRun.id : '',
    mode: normalizeTrainingWorkspaceMode(trainingWorkspaceState.selectedMode),
    resumeFromCheckpoint: usingInitializer || !usingResume || resumeActionId ? '' : customResumePath,
    runName: runNameEl ? String(runNameEl.value || '').trim() : '',
    resumeOutputId: resumeOutputId,
    resumeActionId: resumeActionId,
    resumeStage: stages,
    parentJobId: '',
    initializerActionId: initializer ? String(initializer.actionId || '') : '',
    initializerExportId: initializer ? String(initializer.exportId || '') : '',
    initializerStage: usingInitializer ? String(trainingWorkspaceState.reviewInitializerStage || (initializer && initializer.stage) || stages) : '',
    initializerCustomPath: usingInitializer ? initializerCustomPath : '',
    forceConstantLr: usingInitializer ? String(trainingWorkspaceState.reviewForceConstantLr || '') : ''
  };
}

function setManagedTrainingStages(stages) {
  if (stages !== 'hi' && stages !== 'lo' && stages !== 'krea2' && stages !== 'wan21' && stages !== 'h3') stages = 'h3';
  var selectedProfile = getSelectedTrainingModelProfile();
  if (selectedProfile && !getTrainingProfileRunForStage(selectedProfile, stages)) {
    stages = String(selectedProfile.runs[0].stages[0] || 'h3');
  }
  trainingWorkspaceState.runStages = stages;
  var buttons = document.querySelectorAll('[data-training-stage]');
  buttons.forEach(function (button) {
    var active = button.getAttribute('data-training-stage') === stages;
    var valid = !selectedProfile || !!getTrainingProfileRunForStage(selectedProfile, button.getAttribute('data-training-stage'));
    button.classList.toggle('hidden', !valid);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  var stageOption = document.getElementById('training-run-stage-option');
  if (stageOption) {
    var availableRuns = selectedProfile && Array.isArray(selectedProfile.runs) ? selectedProfile.runs.length : 0;
    stageOption.classList.toggle('hidden', availableRuns <= 1);
  }
  syncManagedTrainingResumeUi();
  if (trainingWorkspaceState.history) renderTrainingHistory();
}

function syncManagedTrainingResumeUi() {
  var checkpointEl = document.getElementById('training-run-checkpoint-select');
  var resumeStageOption = document.getElementById('training-run-resume-stage-option');
  var checkpointPath = document.getElementById('training-run-checkpoint-path');
  var runNameInput = document.getElementById('training-run-name-input');
  if (!resumeStageOption) return;
  var hasResume = !!(checkpointEl && String(checkpointEl.value || '').trim());
  resumeStageOption.classList.add('hidden');
  if (runNameInput) runNameInput.disabled = hasResume;
  if (checkpointPath) checkpointPath.textContent = checkpointEl && checkpointEl.value ? String(checkpointEl.selectedOptions[0].textContent || '') : '';
}

function trainingStageLabel(stages) {
  return stages === 'hi' ? 'High Noise' : stages === 'lo' ? 'Low Noise' : stages === 'krea2' ? 'Krea2 Raw' : stages === 'wan21' ? 'Wan2.1 T2V' : stages === 'h3' ? 'MiniMax H3' : 'Unknown stage';
}

function trainingModelLabel(job) {
  var model = job && job.model && typeof job.model === 'object' ? job.model : {};
  var label = String(job && (job.modelLabel || model.label) || '').trim();
  return !label || label === 'Training model' || /^wan\s*2(?:\.2)?$/i.test(label) ? 'Wan2.2-T2V-A14B' : label;
}

function trainingJobLabel(job) {
  var runName = String(job && job.runName || '').trim();
  if (runName) return runName;
  if (job && job.stages === 'krea2') return 'Krea2 Raw';
  var profileLabel = String(job && job.profileLabel || '').trim();
  var modelLabel = profileLabel || trainingModelLabel(job);
  var stageLabel = trainingStageLabel(String(job && job.stages || ''));
  return stageLabel.toLowerCase() === modelLabel.toLowerCase() ? modelLabel : modelLabel + ' · ' + stageLabel;
}

function startManagedTraining() {
  if (!state.folder) {
    setStatus('No folder selected for managed training.');
    return;
  }
  var options = getManagedTrainingOptions();
  var trainButton = getTrainingWorkspaceEls().queueJobBtn;
  if (trainButton) trainButton.disabled = true;
  Promise.resolve(saveCurrentEditorContent())
    .then(function () {
      var selectedMedia = getVisibleMediaSelectionForTraining();
      if (!selectedMedia.length) throw new Error('No visible media items to train.');
      var fallbackResult = buildTrainingFallbackCaptions(selectedMedia);
      setStatus('Preparing self-contained training capture…');
      return trainingRunnerRequest('/fs/training_runner/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder: state.folder,
          queue: true,
          stages: options.stages,
          profileId: options.profileId,
          runId: options.runId,
          mode: options.mode,
          resumeFromCheckpoint: options.resumeFromCheckpoint,
           resumeStage: options.resumeStage,
           resumeActionId: options.resumeActionId,
           resumeOutputId: options.resumeOutputId,
           runName: options.runName,
          selected_media: selectedMedia,
          total_media_count: Array.isArray(state.items) ? state.items.length : 0,
           selection_criteria: buildTrainingSelectionCriteria(),
            fallback_captions: fallbackResult.fallbackCaptions,
           initializerActionId: options.initializerActionId,
            initializerExportId: options.initializerExportId,
            initializerStage: options.initializerStage,
            initializerCustomPath: options.initializerCustomPath,
            forceConstantLr: options.forceConstantLr
        })
      });
    })
    .then(function (payload) {
      if (!payload) return;
      trainingWorkspaceState.runnerSelectedJobId = payload.job.id;
      trainingWorkspaceState.runnerLogOffsets[payload.job.id] = 0;
      trainingWorkspaceState.runnerPreflight = null;
      renderTrainingRunnerPreflight(null);
      setStatus(payload.queued ? 'Training job queued.' : 'Managed training started.');
      refreshTrainingRunnerStatus();
    })
    .catch(function (err) {
      setStatus('Managed training did not start: ' + String(err && err.message ? err.message : err));
    }).finally(function () {
      if (trainButton) trainButton.disabled = false;
    });
}

function stopManagedTraining(cancel, pause, finish) {
  var job = getTrainingRunnerSelectedJob();
  if (!job || !job.id) return;
  var label = cancel ? 'Cancel this queued training job?' : pause
    ? 'Pause this run? Training will finish its current step, save a resumable checkpoint, then exit. This item will remain first and the queue will wait for Resume.'
    : finish
      ? 'Finish this run early? Training will finish its current step, save a resumable checkpoint, then exit. The run will be marked finished early and the queue will continue.'
      : 'Stop this job and continue to the next queued set?';
  if (!window.confirm(label)) return;
  trainingRunnerRequest('/fs/training_runner/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: job.id, cancel: !!cancel, pause: !!pause, finish: !!finish })
  }).then(function () {
    setStatus(cancel ? 'Queued training job cancelled.' : (pause ? 'Pause requested; waiting for the current step and checkpoint save.' : finish ? 'Finish requested; waiting for the current step and checkpoint save.' : 'Stop requested; waiting for the runner result.'));
    refreshTrainingRunnerStatus();
    refreshTrainingHistory(true);
  }).catch(function (err) {
    setStatus('Could not change training job: ' + String(err && err.message ? err.message : err));
  });
}


function scheduleManagedTrainingFinish(jobId) {
  var job = getTrainingRunnerJobById(jobId);
  if (!job || !job.id) return;
  var progress = job.progress && typeof job.progress === 'object' ? job.progress : {};
  var currentEpoch = Number(progress.epoch);
  var plannedEpochs = Number(progress.epochs);
  var saveEvery = Number(progress.saveEveryNEpochs);
  var scheduledEpoch = Number(job.finishAfterEpoch);
  var suggestedEpoch = isFinite(scheduledEpoch) && scheduledEpoch > 0
    ? Math.round(scheduledEpoch)
    : isFinite(currentEpoch) && currentEpoch > 0 && isFinite(saveEvery) && saveEvery > 0
      ? Math.ceil(currentEpoch / saveEvery) * saveEvery
      : '';
  var context = isFinite(currentEpoch) && currentEpoch > 0
    ? 'Current epoch: ' + Math.round(currentEpoch) + (isFinite(plannedEpochs) && plannedEpochs > 0 ? ' of ' + Math.round(plannedEpochs) + '.' : '.')
    : '';
  if (isFinite(saveEvery) && saveEvery > 0) context += ' Saves every ' + Math.round(saveEvery) + ' epoch' + (Math.round(saveEvery) === 1 ? '.' : 's.');
  var promptLabel = 'Finish after which saved epoch?\n' + context + (isFinite(scheduledEpoch) && scheduledEpoch > 0 ? '\nLeave blank to cancel the current schedule.' : '');
  var value = window.prompt(promptLabel, String(suggestedEpoch));
  if (value === null) return;
  value = String(value).trim();
  var cancel = !value && isFinite(scheduledEpoch) && scheduledEpoch > 0;
  if (!value && !cancel) return;
  trainingRunnerRequest('/fs/training_runner/finish_schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: job.id, epoch: value, cancel: cancel })
  }).then(function (payload) {
    setStatus(cancel ? 'Scheduled Finish cancelled.' : 'Finish scheduled after epoch ' + payload.job.finishAfterEpoch + ' saves.');
    refreshTrainingRunnerStatus();
  }).catch(function (err) {
    setStatus('Could not schedule Finish: ' + String(err && err.message ? err.message : err));
  });
}


function cancelQueuedTrainingJob(jobId) {
  if (!window.confirm('Remove this training job from the queue?')) return;
  trainingRunnerRequest('/fs/training_runner/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: jobId, cancel: true })
  }).then(function () {
    setStatus('Training job removed from the queue.');
    refreshTrainingRunnerStatus();
    refreshTrainingHistory(true);
  }).catch(function (err) {
    setStatus('Could not cancel queued training job: ' + String(err && err.message ? err.message : err));
  });
}

function reorderManagedTraining(jobId, direction) {
  trainingRunnerRequest('/fs/training_runner/reorder', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: jobId, direction: direction })
  }).then(function (payload) {
    trainingWorkspaceState.runnerJobs = Array.isArray(payload.jobs) ? payload.jobs : trainingWorkspaceState.runnerJobs;
    renderTrainingRunner();
  }).catch(function (err) { setStatus('Could not reorder training queue: ' + String(err.message || err)); });
}

function resumeManagedTrainingQueue() {
  trainingRunnerRequest('/fs/training_runner/resume_queue', { method: 'POST' })
    .then(function (payload) {
      var activeId = String(payload.activeJobId || '');
      var active = (payload.jobs || []).filter(function (job) { return String(job.id || '') === activeId; })[0];
      setStatus(active && !active.resumeFromCheckpoint ? 'No saved checkpoint found; starting a new run.' : 'Training queue resumed.');
      refreshTrainingRunnerStatus();
    })
    .catch(function (err) { setStatus('Could not resume training queue: ' + String(err.message || err)); });
}


function getTrainingRunnerJobById(jobId) {
  var jobs = trainingWorkspaceState.runnerJobs || [];
  for (var i = 0; i < jobs.length; i++) {
    if (jobs[i].id === jobId) return jobs[i];
  }
  var historyJobs = trainingWorkspaceState.history && Array.isArray(trainingWorkspaceState.history.jobs)
    ? trainingWorkspaceState.history.jobs : [];
  for (var historyIndex = 0; historyIndex < historyJobs.length; historyIndex++) {
    if (historyJobs[historyIndex].id === jobId) return historyJobs[historyIndex];
  }
  return null;
}

function formatTrainingRunnerElapsed(job) {
  var progress = job && job.progress && typeof job.progress === 'object' ? job.progress : {};
  var seconds = Number(progress.estimatedTrainingSeconds);
  if (!isFinite(seconds) || seconds <= 0) return '';
  return '~' + formatTrainingRunnerDuration(seconds) + ' training';
}

function formatTrainingRunnerDuration(seconds) {
  seconds = Math.max(0, Math.floor(Number(seconds) || 0));
  var hours = Math.floor(seconds / 3600);
  var minutes = Math.floor((seconds % 3600) / 60);
  return hours ? hours + 'h ' + minutes + 'm' : minutes + 'm';
}

function trainingRunnerStatusLabel(status) {
  var value = String(status || 'unknown').replace(/_/g, ' ');
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function trainingPlannedStepCount(job) {
  var plan = job && job.progressPlan && typeof job.progressPlan === 'object' ? job.progressPlan : {};
  var names = [String(job && job.stages || '')];
  return names.reduce(function (total, name) {
    var stage = plan[name] && typeof plan[name] === 'object' ? plan[name] : {};
    var steps = Number(stage.estimatedSteps);
    return total + (isFinite(steps) && steps > 0 ? steps : 0);
  }, 0);
}

function trainingPlannedEpochCount(job) {
  var plan = job && job.progressPlan && typeof job.progressPlan === 'object' ? job.progressPlan : {};
  var names = [String(job && job.stages || '')];
  return names.reduce(function (total, name) {
    var stage = plan[name] && typeof plan[name] === 'object' ? plan[name] : {};
    var epochs = Number(stage.epochs);
    return total + (isFinite(epochs) && epochs > 0 ? epochs : 0);
  }, 0);
}

function trainingOutputIdentity(job) {
  var runPath = String(job && job.outputRunPath || '').trim();
  if (runPath) {
    var parts = runPath.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : runPath;
  }
  var group = String(job && job.actionId || '').trim();
  var slug = String(job && job.outputSlug || '').trim();
  return group ? group + (slug ? ' / ' + slug : '') : slug;
}

function buildQueuedResumePointHtml(job) {
  var point = job && job.resumePoint && typeof job.resumePoint === 'object' ? job.resumePoint : {};
  if (!job || !job.resumeFromCheckpoint) return '';
  if (job.resumePointError) return '<div class="training-runner-queue-resume is-error">Could not inspect resume progress: ' + escapeHtml(job.resumePointError) + '</div>';
  if (!Object.keys(point).length) return '';
  var step = Number(point.step);
  var epoch = Number(point.epoch);
  var expectedEpochs = Number(point.expectedEpochs);
  var plannedSteps = trainingPlannedStepCount(job);
  var percent = plannedSteps > 0 && step > 0 ? step / plannedSteps * 100 : expectedEpochs > 0 && epoch > 0 ? epoch / expectedEpochs * 100 : 0;
  percent = Math.max(0, Math.min(100, percent));
  var parts = [];
  if (point.checkpointTag) parts.push(point.checkpointTag);
  if (epoch > 0) parts.push('epoch ' + Math.round(epoch).toLocaleString() + (expectedEpochs > 0 ? ' / ' + Math.round(expectedEpochs).toLocaleString() : ''));
  if (step > 0) parts.push('step ' + Math.round(step).toLocaleString());
  var fallbackLabel = point.checkpointAvailable ? 'Checkpoint found' : 'No valid latest checkpoint marker found';
  return '<div class="training-runner-queue-resume-point"><span>' + escapeHtml(parts.join(' · ') || fallbackLabel) + '</span>' +
    (percent ? '<div class="training-runner-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(percent) + '"><span style="width:' + percent.toFixed(1) + '%"></span></div>' : '') + '</div>';
}

function buildTrainingFailureDetailsHtml(job) {
  if (!job || job.status !== 'failed') return '';
  var preflight = job.preflight && typeof job.preflight === 'object' ? job.preflight : {};
  var checks = Array.isArray(preflight.checks) ? preflight.checks.filter(function (check) { return !check.ok; }) : [];
  var rows = checks.map(function (check) {
    return '<div><strong>' + escapeHtml(check.message || check.id || 'Failed check') + '</strong>' +
      (check.details ? '<div>' + escapeHtml(check.details) + '</div>' : '') + '</div>';
  }).join('');
  var excerpt = String(job.failureExcerpt || '').trim();
  if (!rows && !excerpt) return '';
  return '<details class="training-failure-details"><summary>Failure details</summary>' + rows +
    (excerpt ? '<pre>' + escapeHtml(excerpt) + '</pre>' : '') + '</details>';
}

function buildTrainingQueueHtml(queuedJobs) {
  var collapsed = trainingWorkspaceState.runnerQueueCollapsed;
  var queueLabel = 'Queue &middot; ' + queuedJobs.length + ' waiting';
  return '<button type="button" class="training-runner-queue-title" data-training-queue-toggle aria-expanded="' + (!collapsed ? 'true' : 'false') + '">' +
    queueLabel + '<span class="training-section-caret" aria-hidden="true">' + (collapsed ? '&#9656;' : '&#9662;') + '</span></button>' +
    '<div class="training-runner-queue-body' + (collapsed ? ' hidden' : '') + '">' + queuedJobs.map(function (queuedJob, index) {
      var stage = trainingJobLabel(queuedJob);
      var plannedSteps = trainingPlannedStepCount(queuedJob);
      var plannedEpochs = trainingPlannedEpochCount(queuedJob);
      var workloadParts = [];
      if (plannedEpochs) workloadParts.push(Math.round(plannedEpochs).toLocaleString() + ' epochs');
      if (plannedSteps) workloadParts.push('~' + Math.round(plannedSteps).toLocaleString() + ' run steps');
      var workload = workloadParts.length ? '<span class="training-runner-queue-workload">' + escapeHtml(workloadParts.join(' · ')) + '</span>' : '';
      var status = String(queuedJob.status || 'queued');
      var error = queuedJob.error ? '<div class="training-runner-queue-resume">' + escapeHtml(queuedJob.error) + '</div>' : '';
      var sourceUnavailable = queuedJob.sourceUnavailable
        ? '<div class="training-runner-queue-resume is-error">' + escapeHtml(queuedJob.sourceUnavailable) + '</div>'
        : '';
      var resume = queuedJob.resumeFromCheckpoint
        ? '<div class="training-runner-queue-resume">Resume ' + escapeHtml(trainingStageLabel(queuedJob.resumeStage || queuedJob.stages || '')) + ': ' + escapeHtml(queuedJob.resumeFromCheckpoint) + '</div>'
        : '';
      var outputIdentity = trainingOutputIdentity(queuedJob);
      var output = outputIdentity ? '<div class="training-runner-queue-resume" title="' + escapeHtml(queuedJob.effectiveOutputDir || queuedJob.outputRoot || '') + '">Output: ' + escapeHtml(outputIdentity) + '</div>' : '';
      var captured = Number(queuedJob.capturedItemCount || 0) ? '<div class="training-runner-queue-resume">Captured items: ' + escapeHtml(String(queuedJob.capturedItemCount)) + '</div>' : '';
      var selected = queuedJob.id === trainingWorkspaceState.runnerSelectedJobId;
      var exceptionalStatus = status !== 'queued'
        ? '<span class="training-runner-status training-runner-status--' + escapeHtml(status) + '">' + escapeHtml(trainingRunnerStatusLabel(status)) + '</span>'
        : '';
      return '<div class="training-runner-queue-item' + (selected ? ' active' : '') + '" data-training-queue-job="' + escapeHtml(queuedJob.id) + '">' +
        '<div class="training-runner-queue-spine" aria-hidden="true"><span>' + (index + 1) + '</span></div>' +
        '<div class="training-runner-queue-copy">' +
          '<div class="training-runner-queue-main">' + exceptionalStatus + '<strong>' + escapeHtml(stage) + '</strong>' + workload + '</div>' +
          '<button type="button" class="training-runner-queue-folder" data-training-open-folder="' + escapeHtml(queuedJob.folder || '') + '" title="Open set: ' + escapeHtml(queuedJob.folder || '') + '">' + escapeHtml(queuedJob.folder || '') + '</button>' +
          resume + buildQueuedResumePointHtml(queuedJob) + output + captured + sourceUnavailable + error +
        '</div>' +
        '<div class="training-runner-queue-controls">' +
          '<button type="button" class="training-runner-queue-control" data-training-job-output="' + escapeHtml(queuedJob.id) + '" title="Open effective output folder" aria-label="Open effective output folder">&#128193;</button>' +
          (queuedJob.actionPath ? '<button type="button" class="training-runner-queue-control" data-training-job-action="' + escapeHtml(queuedJob.id) + '" title="Open action folder" aria-label="Open action folder">&#128451;</button>' : '') +
          '<button type="button" class="training-runner-queue-control" data-training-queue-action="up" data-training-job-id="' + escapeHtml(queuedJob.id) + '" title="Move up" aria-label="Move up"' + (index === 0 ? ' disabled' : '') + '>&#8593;</button>' +
          '<button type="button" class="training-runner-queue-control" data-training-queue-action="down" data-training-job-id="' + escapeHtml(queuedJob.id) + '" title="Move down" aria-label="Move down"' + (index === queuedJobs.length - 1 ? ' disabled' : '') + '>&#8595;</button>' +
          '<button type="button" class="training-runner-queue-control training-runner-queue-cancel" data-training-queue-action="cancel" data-training-job-id="' + escapeHtml(queuedJob.id) + '" title="Remove from queue" aria-label="Remove from queue">&#215;</button>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
}

function buildTrainingRunnerProgressHtml(job) {
  var progress = job && job.progress && typeof job.progress === 'object' ? job.progress : null;
  if (!progress || (job.status !== 'running' && job.status !== 'stopping')) return '';
  var stagePercent = Number(progress.stagePercent);
  var overallPercent = Number(progress.overallPercent);
  var epoch = Number(progress.epoch);
  var epochs = Number(progress.epochs);
  var hasEpoch = isFinite(epoch) && isFinite(epochs) && epochs >= 1;
  var plannedSteps = Number(progress.plannedSteps);
  var hasPlannedSteps = isFinite(plannedSteps) && plannedSteps > 0;
  if (!isFinite(stagePercent) || !isFinite(overallPercent) || !hasEpoch && !hasPlannedSteps) return '';
  var boundedOverall = Math.max(0, Math.min(100, overallPercent));
  var step = Number(progress.step);
  var stepLabel = isFinite(step) && step >= 0 ? ' · step ' + Math.round(step).toLocaleString() : '';
  if (isFinite(step) && step >= 0 && hasPlannedSteps) {
    stepLabel += ' / ~' + Math.round(plannedSteps).toLocaleString();
  }
  var positionLabel = hasEpoch
    ? ' · epoch ' + Math.round(epoch) + ' / ' + Math.round(epochs) + stepLabel
    : stepLabel.trim();
  var etaSeconds = Number(progress.etaSeconds);
  if (isFinite(etaSeconds) && etaSeconds >= 60 && etaSeconds < 30 * 24 * 3600) {
    positionLabel += ' · ~' + formatTrainingRunnerDuration(etaSeconds) + (progress.etaScope === 'completion' ? ' to completion' : ' left in this stage');
  }
  var progressLabel = progress.source === 'steps'
    ? 'Step estimate: ' + Math.round(stagePercent) + '% of ' + trainingStageLabel(progress.stage || job.stages || '')
    : Math.round(stagePercent) + '% of ' + trainingStageLabel(progress.stage || job.stages || '');
  var checkpointEpoch = Number(progress.nextCheckpointEpoch);
  var checkpointEvery = Number(progress.checkpointEveryNEpochs);
  var checkpointEta = Number(progress.checkpointEtaSeconds);
  var checkpointLabel = '';
  if (isFinite(checkpointEpoch) && checkpointEpoch > 0 && isFinite(checkpointEvery) && checkpointEvery > 0) {
    checkpointLabel = 'Next checkpoint: epoch ' + Math.round(checkpointEpoch);
    if (isFinite(checkpointEta) && checkpointEta > 0 && checkpointEta < 30 * 24 * 3600) {
      checkpointLabel += ' · ~' + formatTrainingRunnerDuration(checkpointEta);
    }
  }
  var progressTitle = 'Current model run, epoch, and progress. Estimates use recent iteration time.';
  if (checkpointLabel) progressTitle += ' Checkpoints are configured every ' + Math.round(checkpointEvery) + ' epochs.';
  return '<div class="training-runner-progress" aria-label="Estimated training progress">' +
    '<div class="training-runner-progress-copy"><span>' + escapeHtml(trainingStageLabel(progress.stage || job.stages || '')) +
      positionLabel + '</span>' +
      '<span title="' + escapeHtml(progressTitle) + '">' + escapeHtml(progressLabel) + '</span>' +
      (checkpointLabel ? '<span class="training-runner-checkpoint" title="Checkpoint saves are configured every ' + Math.round(checkpointEvery) + ' epochs. This estimate uses recent iteration time.">' + escapeHtml(checkpointLabel) + '</span>' : '') +
      '</div>' +
    '<div class="training-runner-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(boundedOverall) + '">' +
      '<span style="width:' + boundedOverall.toFixed(1) + '%"></span></div>' +
    '</div>';
}

function formatTrainingGpuMemory(value) {
  var mib = Number(value);
  if (!isFinite(mib) || mib < 0) return '';
  var gib = mib / 1024;
  return gib.toFixed(1) + ' GiB';
}

function buildTrainingGpuStatusHtml() {
  var gpu = trainingWorkspaceState.gpu;
  if (!gpu) {
    return trainingWorkspaceState.gpuStatusPending
      ? 'Checking GPU activity...'
      : '';
  }
  if (!gpu.available) {
    return '<span class="is-warning" title="' + escapeHtml(gpu.error || 'GPU status unavailable.') + '">GPU status unavailable</span>';
  }
  var gpus = Array.isArray(gpu.gpus) ? gpu.gpus : [];
  if (!gpus.length) return '<span class="is-warning">No NVIDIA GPU reported</span>';
  var primary = gpus[0];
  var utilization = Number(primary.utilization);
  var memoryUsed = formatTrainingGpuMemory(primary.memoryUsed);
  var memoryTotal = formatTrainingGpuMemory(primary.memoryTotal);
  var details = [];
  if (primary.temperature && primary.temperature !== '[N/A]') details.push(primary.temperature + '°C');
  if (primary.powerDraw && primary.powerDraw !== '[N/A]') details.push(primary.powerDraw + ' W');
  var primarySummary = 'GPU' + (primary.index !== '' ? ' ' + primary.index : '') +
    (isFinite(utilization) ? ' ' + Math.round(utilization) + '%' : '') +
    (memoryUsed && memoryTotal ? ' · VRAM ' + memoryUsed + ' / ' + memoryTotal : '') +
    (details.length ? ' · ' + details.join(' · ') : '');
  return '<strong title="Live GPU utilization, VRAM use, temperature, and power draw.">' + escapeHtml(primarySummary) + '</strong>';
}

function renderTrainingTensorboardLink() {
  var link = getTrainingWorkspaceEls().tensorboardLink;
  if (!link) return;
  var tensorboard = trainingWorkspaceState.tensorboard;
  var isRunning = !!(tensorboard && tensorboard.running);
  var diagnostic = String((tensorboard && tensorboard.diagnostic) || 'Checking whether TensorBoard is available.');
  var url = String((tensorboard && tensorboard.url) || '');
  link.textContent = 'TensorBoard ↗';
  link.title = isRunning ? 'Open TensorBoard in a new tab.' : ('TensorBoard is not running. ' + diagnostic);
  link.setAttribute('aria-label', isRunning ? 'Open TensorBoard in a new tab' : 'TensorBoard is not running');
  link.classList.toggle('is-unavailable', !!tensorboard && !isRunning);
  if (url) {
    link.href = url;
  } else {
    link.removeAttribute('href');
  }
}

function trainingQueueHoldLabel() {
  return trainingWorkspaceState.runnerQueuePauseReason === 'Queue waiting for manual start after WebCap restarted.'
    ? 'Queue waiting for manual start'
    : (trainingWorkspaceState.runnerQueuePauseReason || 'Queue paused');
}

function trainingFolderName(folder) {
  var parts = String(folder || '').split(/[\\/]/).filter(function (part) { return !!part; });
  return parts.length ? parts[parts.length - 1] : String(folder || 'this set');
}

function syncTrainingQueueResumeButton(els, queuedJobs) {
  if (!els.runnerResumeQueueBtn) return;
  els.runnerResumeQueueBtn.textContent = 'Resume';
  els.runnerResumeQueueBtn.title = queuedJobs.length
    ? 'Resume the queue and start the first queued item.'
    : 'Resume the queue.';
}

function renderTrainingRunnerPreflight(payload) {
  var els = getTrainingWorkspaceEls();
  if (!els.runnerPreflight) return;
  trainingWorkspaceState.runnerPreflight = payload || null;
  if (!payload) {
    els.runnerPreflight.innerHTML = '';
    els.runnerPreflight.classList.add('hidden');
    return;
  }
  var summary = payload.summary || {};
  var checks = Array.isArray(payload.checks) ? payload.checks : [];
  var rows = checks.map(function (check) {
    var ok = !!check.ok;
    var detail = check.details ? '<div>' + escapeHtml(check.details) + '</div>' : '';
    return '<div class="training-preflight-check ' + (ok ? 'ok' : 'failed') + '">' +
      '<span>' + (ok ? '&#10003;' : '!') + '</span><span><strong>' + escapeHtml(check.message || check.id) + '</strong>' + detail + '</span></div>';
  }).join('');
  var script = payload.runnerScript
    ? '<details><summary>Generated runner script</summary><pre class="training-runner-script">' + escapeHtml(payload.runnerScript) + '</pre></details>'
    : '';
  var scriptError = payload.scriptError
    ? '<div class="training-preflight-check failed"><span>!</span><span><strong>Could not build the runner script.</strong><div>' + escapeHtml(payload.scriptError) + '</div></span></div>'
    : '';
  els.runnerPreflight.innerHTML = '<div class="training-preflight-summary">' +
    (payload.ok ? 'Runner validation passed.' : 'Runner validation found ' + Number(summary.blockers || 0) + ' blocker(s).') +
    '</div>' + rows + scriptError + script;
  els.runnerPreflight.classList.remove('hidden');
}

function renderTrainingRunner() {
  var els = getTrainingWorkspaceEls();
  syncUtilityTrainingActivity();
  if (!els.runnerSummary || !els.runnerActions) return;
  if (trainingWorkspaceState.runnerStatusError) {
    els.runnerSummary.innerHTML = '<div class="training-runner-detail is-error">' + escapeHtml(trainingWorkspaceState.runnerStatusError) + '</div>' +
      (trainingWorkspaceState.runnerRecoveryAvailable
        ? '<button type="button" class="btn" data-training-runner-recover>Recover queue</button><div class="training-runner-detail">The damaged queue state will be archived before an empty queue is created.</div>'
        : '');
    els.runnerActions.classList.add('hidden');
    if (els.runnerQueue) els.runnerQueue.classList.add('hidden');
    if (els.gpuStatus) els.gpuStatus.innerHTML = buildTrainingGpuStatusHtml();
    renderTrainingTensorboardLink();
    return;
  }
  var jobs = trainingWorkspaceState.runnerJobs || [];
  var activeCount = jobs.filter(function (job) { return job.status === 'starting' || job.status === 'running' || job.status === 'stopping'; }).length;
  var queuedJobs = jobs.filter(function (job) { return job.status === 'queued'; });
  var queuedCount = queuedJobs.length;
  var job = getTrainingRunnerActiveJob();
  var followingQueuedJobs = queuedJobs;
  if (els.gpuStatus) els.gpuStatus.innerHTML = buildTrainingGpuStatusHtml();
  renderTrainingTensorboardLink();
  syncTrainingQueueResumeButton(els, queuedJobs);
  if (els.runnerQueue) {
    if (!followingQueuedJobs.length) {
      if (els.runnerQueue.dataset.queueSignature !== 'empty') {
        els.runnerQueue.innerHTML = '';
        els.runnerQueue.dataset.queueSignature = 'empty';
      }
      els.runnerQueue.classList.add('hidden');
    } else {
      var queueHtml = buildTrainingQueueHtml(followingQueuedJobs);
      if (els.runnerQueue.dataset.queueSignature !== queueHtml) {
        els.runnerQueue.innerHTML = queueHtml;
        els.runnerQueue.dataset.queueSignature = queueHtml;
      }
      els.runnerQueue.classList.remove('hidden');
    }
  }
  if (!job) {
    var noJobMessage = trainingWorkspaceState.runnerQueuePaused
      ? trainingQueueHoldLabel()
      : queuedCount ? 'No active training job.' : 'No managed training jobs.';
    els.runnerSummary.innerHTML = '<div>' + escapeHtml(noJobMessage) + '</div>' +
      (trainingWorkspaceState.runnerNotice
        ? '<div class="training-runner-detail is-warning">' + escapeHtml(trainingWorkspaceState.runnerNotice) + '</div>'
        : '');
    els.runnerActions.classList.toggle('hidden', !trainingWorkspaceState.runnerQueuePaused);
    if (els.runnerFinishBtn) els.runnerFinishBtn.classList.add('hidden');
    if (els.runnerPauseBtn) els.runnerPauseBtn.classList.add('hidden');
    if (els.runnerCancelBtn) els.runnerCancelBtn.classList.add('hidden');
    if (els.runnerResumeQueueBtn) els.runnerResumeQueueBtn.classList.toggle('hidden', !trainingWorkspaceState.runnerQueuePaused);
    return;
  }
  if (!getTrainingRunnerJobById(trainingWorkspaceState.runnerSelectedJobId)) {
    trainingWorkspaceState.runnerSelectedJobId = job.id;
  }
  var elapsed = formatTrainingRunnerElapsed(job);
  var status = String(job.status || 'unknown');
  var statusLabel = trainingRunnerStatusLabel(status);
  var statusTitle = status === 'running'
    ? 'Training is actively running.'
    : status === 'starting'
      ? 'The runner is launching training.'
      : status === 'stopping'
        ? 'The runner is stopping after the requested action.'
      : 'Training runner status: ' + statusLabel + '.';
  var running = status === 'starting' || status === 'running' || status === 'stopping';
  var finishProgress = job.progress && typeof job.progress === 'object' ? job.progress : {};
  var finishAfterEpoch = Number(job.finishAfterEpoch);
  var canScheduleFinish = (isFinite(finishAfterEpoch) && finishAfterEpoch > 0) || ((status === 'starting' || status === 'running') &&
    Number(finishProgress.epoch) > 0 &&
    Number(finishProgress.epochs) > 0 &&
    Number(finishProgress.saveEveryNEpochs) > 0 &&
    ['hi', 'lo', 'krea2', 'wan21', 'h3'].indexOf(String(finishProgress.stage || '')) !== -1);
  var queued = status === 'queued';
  var queueState = trainingWorkspaceState.runnerQueuePaused
    ? '<span class="training-runner-queue-state" title="' + escapeHtml(trainingWorkspaceState.runnerQueuePauseReason || 'Queue is paused.') + '">' + escapeHtml(trainingQueueHoldLabel()) + (activeCount ? ' — waiting for the current run to stop' : ' — Resume will start the first item') + '</span>'
    : '';
  var selectedQueuePosition = queued ? queuedJobs.indexOf(job) + 1 : 0;
  var runOutputPath = String(job.outputRunPath || '').trim();
  var finishScheduleTitle = isFinite(finishAfterEpoch) && finishAfterEpoch > 0
    ? 'Finish after epoch ' + Math.round(finishAfterEpoch) + ' saves. Click to change or cancel.'
    : 'Schedule Finish after a saved epoch';
  var finishScheduleButton = canScheduleFinish
    ? '<button type="button" class="training-runner-output-action training-runner-finish-schedule' + (isFinite(finishAfterEpoch) && finishAfterEpoch > 0 ? ' is-armed' : '') + '" data-training-finish-schedule="' + escapeHtml(job.id || '') + '" title="' + escapeHtml(finishScheduleTitle) + '" aria-label="' + escapeHtml(finishScheduleTitle) + '">&#9201;' + (isFinite(finishAfterEpoch) && finishAfterEpoch > 0 ? '<span>' + Math.round(finishAfterEpoch) + '</span>' : '') + '</button>'
    : '';
  var rowActions = finishScheduleButton || trainingOutputIdentity(job) || job.actionPath
    ? '<span class="training-runner-row-actions">' + finishScheduleButton +
      (trainingOutputIdentity(job) ? '<button type="button" class="training-runner-output-action" data-training-job-output="' + escapeHtml(job.id || '') + '" title="Open ' + (runOutputPath ? 'run output: ' + escapeHtml(runOutputPath) : 'output root: ' + escapeHtml(job.effectiveOutputDir || job.outputRoot || '')) + '" aria-label="Open training output folder">&#128193;</button>' : '') +
      (job.actionPath ? '<button type="button" class="training-runner-output-action" data-training-job-action="' + escapeHtml(job.id || '') + '" title="Open action folder" aria-label="Open action folder">&#128451;</button>' : '') +
      '</span>'
    : '';
  var queuePosition = selectedQueuePosition
    ? '<span class="training-runner-queued-count">' + (selectedQueuePosition === 1 ? 'Next to start' : 'Queue position ' + selectedQueuePosition + ' of ' + queuedCount) + '</span>'
    : '';
  els.runnerSummary.innerHTML = '<div class="training-runner-active-row">' +
    '<div class="training-runner-state" title="Active model and elapsed run time.">' +
      '<span class="training-runner-status training-runner-status--' + escapeHtml(status) + '" title="' + escapeHtml(statusTitle) + '">' + escapeHtml(statusLabel) + '</span>' +
      '<span>' + escapeHtml(trainingJobLabel(job)) + (elapsed ? ' · ' + escapeHtml(elapsed) : '') + '</span>' +
    '</div>' +
    '<button type="button" class="training-runner-folder" data-training-open-folder="' + escapeHtml(job.folder || '') + '" title="Open set: ' + escapeHtml(job.folder || '') + '">' + escapeHtml(job.folder || '') + '</button>' +
    queuePosition +
    queueState +
    rowActions +
    '</div>' +
    (job.error ? '<div class="training-runner-detail is-error">' + escapeHtml(job.error) + '</div>' : '') +
    buildTrainingFailureDetailsHtml(job) +
    (job.confirmationNote ? '<div class="training-runner-detail is-warning">' + escapeHtml(job.confirmationNote) + '</div>' : '') +
    (trainingWorkspaceState.runnerNotice ? '<div class="training-runner-detail is-warning">' + escapeHtml(trainingWorkspaceState.runnerNotice) + '</div>' : '') +
    (job.completionNote ? '<div class="training-runner-detail is-warning">' + escapeHtml(job.completionNote) + '</div>' : '') +
    (Number(job.capturedItemCount || 0) ? '<div class="training-runner-detail">Captured items: ' + escapeHtml(String(job.capturedItemCount)) + '</div>' : '') +
    buildTrainingRunnerProgressHtml(job);
  els.runnerActions.classList.remove('hidden');
  var checkpointedStopReady = running && ['hi', 'lo', 'krea2', 'wan21', 'h3'].indexOf(String(job.stage || '')) !== -1 && !job.actionRequested;
  if (els.runnerFinishBtn) els.runnerFinishBtn.classList.toggle('hidden', !checkpointedStopReady);
  if (els.runnerPauseBtn) els.runnerPauseBtn.classList.toggle('hidden', !checkpointedStopReady || trainingWorkspaceState.runnerQueuePaused);
  if (els.runnerCancelBtn) els.runnerCancelBtn.classList.toggle('hidden', !queued);
  if (els.runnerResumeQueueBtn) els.runnerResumeQueueBtn.classList.toggle('hidden', !trainingWorkspaceState.runnerQueuePaused || !!activeCount);
  if (!activeCount && !queuedCount && !trainingWorkspaceState.runnerQueuePaused && status !== 'failed' && status !== 'completed' && status !== 'finished_early' && status !== 'stopped') {
    els.runnerActions.classList.add('hidden');
  }
}
