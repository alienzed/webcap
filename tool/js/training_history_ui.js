// Recent runs, resume discovery, and output access.
function formatTrainingHistoryTime(value) {
  var seconds = Number(value || 0);
  if (!seconds) return '';
  return new Date(seconds * 1000).toLocaleString([], {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}


function trainingHistoryTimestampKind(job) {
  if (Number(job && job.finishedAt || 0)) return 'Finished';
  if (Number(job && job.startedAt || 0)) return 'Started';
  return 'Queued';
}

function renderTrainingHistory() {
  var els = getTrainingWorkspaceEls();
  renderTrainingModelTrainedStatus();
  if (!els.historySummary || !els.historyList || !els.checkpointSelect) return;
  var history = trainingWorkspaceState.history || {};
  var searchText = String((els.historySearch && els.historySearch.value) || '').trim().toLowerCase();
  var jobs = (history.jobs || []).filter(function (job) {
    if (!searchText) return true;
    var model = job.model && typeof job.model === 'object' ? job.model : {};
    var haystack = [
      job.folder, job.datasetTarget, job.profileId, job.mode, job.stages, job.status, job.modelLabel, model.label, model.source
    ].join(' ').toLowerCase();
    return haystack.indexOf(searchText) !== -1;
  }).sort(function (a, b) {
    return Number(b.finishedAt || b.startedAt || b.createdAt || 0) - Number(a.finishedAt || a.startedAt || a.createdAt || 0);
  });
  var runs = Array.isArray(history.runs) ? history.runs : [];
  var latest = jobs.length ? jobs[0] : null;
  if (els.historyContent) els.historyContent.classList.toggle('hidden', trainingWorkspaceState.historyCollapsed);
  if (els.historyTools) els.historyTools.classList.toggle('hidden', trainingWorkspaceState.historyCollapsed);
  if (els.historyCollapseBtn) {
    els.historyCollapseBtn.textContent = 'Recent Runs' + (jobs.length ? ' · ' + jobs.length : '');
    els.historyCollapseBtn.setAttribute('aria-expanded', trainingWorkspaceState.historyCollapsed ? 'false' : 'true');
  }
  if (els.historyClearBtn) els.historyClearBtn.textContent = 'Clear history';
  els.historySummary.classList.toggle('hidden', !!latest);
  els.historySummary.textContent = latest ? '' : 'No completed or actionable training outcomes yet.';
  var visibleJobs = trainingWorkspaceState.historyExpanded ? jobs : jobs.slice(0, 2);
  els.historyList.innerHTML = visibleJobs.map(function (job) {
    var progress = job.progress && typeof job.progress === 'object' ? job.progress : {};
    var modelLabel = trainingModelLabel(job);
    if (job.model && typeof job.model === 'object') job.model.label = modelLabel;
    else job.modelLabel = modelLabel;
    var finalStep = Number(progress.step);
    var hasStarted = Number(job.startedAt || 0) > 0;
    var hasFinished = Number(job.finishedAt || 0) > 0;
    var estimatedTrainingSeconds = Number(progress.estimatedTrainingSeconds);
    var details = [];
    var duration = isFinite(estimatedTrainingSeconds) && estimatedTrainingSeconds > 0
      ? '~' + formatTrainingRunnerDuration(estimatedTrainingSeconds) + ' training'
      : '';
    var timingError = hasFinished && !hasStarted ? 'Timing invariant error: terminal job has no start time.' : '';
    var timestamp = job.finishedAt || job.startedAt || job.createdAt;
    var timestampKind = trainingHistoryTimestampKind(job);
    if (isFinite(finalStep) && finalStep >= 0) details.push('Final step ' + Math.round(finalStep).toLocaleString());
    var resumePath = String(job.outputRunPath || job.resumeCheckpoint || '');
    var resumeStage = String(job.resumeStage || job.stages || '');
    var canResume = job.status !== 'cancelled' && job.outputAvailable !== false && !!resumePath && ['hi', 'lo', 'krea2', 'wan21', 'h3'].indexOf(resumeStage) !== -1;
    var unavailable = [];
    if (job.sourceAvailable === false) unavailable.push('set');
    if (job.outputAvailable === false) unavailable.push('output');
    if (job.logAvailable === false) unavailable.push('log');
    var status = String(job.status || 'unknown');
    return '<div class="training-history-item" data-training-history-job="' + escapeHtml(job.id || '') + '">' +
      '<div class="training-history-primary"><div class="training-history-outcome"><strong class="training-history-status training-history-status--' + escapeHtml(status) + '">' + escapeHtml(trainingRunnerStatusLabel(status)) + '</strong><span class="training-history-stage">' + escapeHtml(trainingStageLabel(job.stages || 'both')) + '</span></div>' +
        '<span class="training-history-time" title="' + escapeHtml(timestampKind + ' time') + '">' + escapeHtml(formatTrainingHistoryTime(timestamp)) + '</span></div>' +
      '<div class="training-history-context"><div class="training-history-model">' + escapeHtml((job.model && job.model.label) || job.modelLabel || 'Training model') + ' · ' + escapeHtml(normalizeTrainingWorkspaceMode(job.mode || job.datasetTarget || 'normal').toUpperCase()) + ' · ' + escapeHtml(trainingStageLabel(job.stages || 'both')) + '</div>' +
        '<div class="training-history-set"><button type="button" class="training-history-folder" data-training-open-folder="' + escapeHtml(job.folder || '') + '" title="Open set: ' + escapeHtml(job.folder || '') + '">' + escapeHtml(job.folder || '') + '</button></div></div>' +
      '<div class="training-history-details">' +
        (details.length || duration ? '<div>' +
          (details.length ? escapeHtml(details.join(' · ')) : '') +
          (details.length && duration ? ' · ' : '') +
          (duration ? '<span title="Estimated training time from global step and recent average iteration time">' + escapeHtml(duration) + '</span>' : '') +
          '</div>' : '') +
        (trainingOutputIdentity(job) ? '<div title="' + escapeHtml(job.effectiveOutputDir || job.outputRoot || '') + '">Output: ' + escapeHtml(trainingOutputIdentity(job)) + '</div>' : '') +
        (Number(job.capturedItemCount || 0) ? '<div>Captured items: ' + escapeHtml(String(job.capturedItemCount)) + '</div>' : '') +
        (timingError ? '<div class="training-runner-detail is-error">' + escapeHtml(timingError) + '</div>' : '') +
        (job.error ? '<div class="training-runner-detail is-error">' + escapeHtml(job.error) + '</div>' : '') +
        buildTrainingFailureDetailsHtml(job) +
        (job.completionNote ? '<div class="training-runner-detail is-warning">' + escapeHtml(job.completionNote) + '</div>' : '') +
        (unavailable.length ? '<div class="training-runner-detail is-warning">Unavailable: ' + escapeHtml(unavailable.join(', ')) + '</div>' : '') +
      '</div>' +
      '<div class="training-history-actions">' +
       (job.folder && job.outputRoot && job.outputAvailable !== false ? '<button type="button" class="training-history-action" data-training-history-output="' + escapeHtml(job.id || '') + '" title="Open effective output folder" aria-label="Open effective output folder">&#128193;</button>' : '') +
       (job.bundleAvailable !== false && job.bundlePath ? '<button type="button" class="training-history-action" data-training-history-bundle="' + escapeHtml(job.id || '') + '" title="Open captured files" aria-label="Open captured files">&#128451;</button>' : '') +
       (job.logAvailable !== false ? '<button type="button" class="training-history-action" data-training-history-log="' + escapeHtml(job.id || '') + '" title="Show log" aria-label="Show log">&#9998;</button>' : '') +
       (canResume ? '<button type="button" class="training-history-action" data-training-history-resume="' + escapeHtml(job.id || '') + '" title="Resume this run" aria-label="Resume this run">&#9654;</button>' : '') +
       '<button type="button" class="training-history-action training-history-action--clear" data-training-history-clear="' + escapeHtml(job.id || '') + '" title="Remove this entry from Recent Runs; logs and artifacts remain." aria-label="Remove from Recent Runs">&#215;</button>' +
       '</div></div>';
  }).join('');
  if (els.historyShowAllBtn) {
    els.historyShowAllBtn.classList.toggle('hidden', jobs.length <= 2);
    els.historyShowAllBtn.textContent = trainingWorkspaceState.historyExpanded ? 'Show less' : 'Show all (' + jobs.length + ')';
  }
  var selectedCheckpoint = String(els.checkpointSelect.value || '');
  var resumeStage = trainingWorkspaceState.runStages === 'both'
    ? String((document.getElementById('training-run-resume-stage-select') || {}).value || 'lo')
    : String(trainingWorkspaceState.runStages || '');
  runs = runs.filter(function (run) { return String(run.candidateFor || run.stage || '') === resumeStage; });
  els.checkpointSelect.innerHTML = '<option value="">Start a new run</option>' + runs.map(function (run) {
    var details = [];
    if (run.epoch && run.expectedEpochs) details.push('epoch ' + run.epoch + ' / ' + run.expectedEpochs);
    var setName = String(run.setName || '').trim();
    var matchLabel = run.matchType === 'exact' ? 'Exact' : 'Compatible';
    return '<option value="' + escapeHtml(run.path || '') + '">' +
      escapeHtml(matchLabel + ' / ' + String(run.modelLabel || trainingStageLabel(run.stage)) +
        (setName ? ' / ' + setName : '') + ' / ' + (run.name || run.path || 'run') +
        (details.length ? ' / ' + details.join(' / ') : '')) + '</option>';
  }).join('');
  if (selectedCheckpoint && runs.some(function (run) { return String(run.path || '') === selectedCheckpoint; })) {
    els.checkpointSelect.value = selectedCheckpoint;
  }
  syncManagedTrainingResumeUi();
}

function renderTrainingModelTrainedStatus() {
  var els = getTrainingWorkspaceEls();
  if (!els.modelTrainedStatus) return;
  var profile = getSelectedTrainingModelProfile();
  var modelIds = (profile && profile.configs || []).map(function (config) { return String(config.id || ''); });
  var seen = {};
  var runs = ((trainingWorkspaceState.history || {}).runs || []).filter(function (run) {
    var modelId = String(run.candidateFor || run.stage || '');
    if (modelIds.indexOf(modelId) === -1 || seen[modelId]) return false;
    seen[modelId] = true;
    return true;
  });
  els.modelTrainedStatus.classList.toggle('hidden', !runs.length);
  els.modelTrainedStatus.innerHTML = runs.map(function (run) {
    var progress = run.epoch && run.expectedEpochs ? 'epoch ' + run.epoch + ' / ' + run.expectedEpochs : '';
    var details = [run.modelLabel || trainingStageLabel(run.stage), run.name || 'run', progress].filter(Boolean).join(' · ');
    return '<div class="training-model-trained-row" title="' + escapeHtml(run.path || '') + '">' +
      '<span class="training-model-trained-badge">Already trained</span>' +
      '<span class="training-model-trained-detail">' + escapeHtml(details) + '</span>' +
      '<button type="button" class="training-history-action" data-training-trained-output="' + escapeHtml(run.path || '') + '" data-training-trained-model="' + escapeHtml(run.candidateFor || run.stage || '') + '" title="Open run directory" aria-label="Open trained run directory">&#128193;</button>' +
    '</div>';
  }).join('');
}

function clearTrainingHistory() {
  if (!window.confirm('Clear all Recent Runs history? Output files, logs, and checkpoints will remain.')) return;
  trainingRunnerRequest('/fs/training_history/clear', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
  }).then(function () { refreshTrainingHistory(true); }).catch(function (err) { setStatus('Could not clear training history: ' + String(err.message || err)); });
}

function clearTrainingHistoryJob(jobId) {
  var jobs = trainingWorkspaceState.history && Array.isArray(trainingWorkspaceState.history.jobs)
    ? trainingWorkspaceState.history.jobs : [];
  var job = jobs.filter(function (item) { return item.id === jobId; })[0];
  if (!job || !job.folder) throw new Error('Training history entry does not identify its set folder.');
  trainingRunnerRequest('/fs/training_history/job/clear', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: job.folder, jobId: jobId })
  }).then(function (payload) {
    if (!payload.cleared) throw new Error('Training history entry was not found.');
    setStatus('Removed the run from Recent Runs. Logs and artifacts were kept.');
    refreshTrainingHistory(true);
  }).catch(function (err) { setStatus('Could not clear training history entry: ' + String(err.message || err)); });
}

function resumeTrainingHistoryJob(jobId) {
  var jobs = trainingWorkspaceState.history && Array.isArray(trainingWorkspaceState.history.jobs)
    ? trainingWorkspaceState.history.jobs : [];
  var job = jobs.filter(function (item) { return item.id === jobId; })[0];
  var resumePath = String(job && (job.outputRunPath || job.resumeCheckpoint) || '');
  var resumeStage = String(job && (job.resumeStage || job.stages) || '');
  if (!job || !job.folder || !resumePath || ['hi', 'lo', 'krea2', 'wan21', 'h3'].indexOf(resumeStage) === -1) {
    throw new Error('This historical run no longer has a resumable checkpoint.');
  }
  trainingRunnerRequest('/fs/training_runner/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folder: job.folder,
      queue: true,
      stages: resumeStage,
      resumeFromCheckpoint: resumePath,
      resumeStage: resumeStage,
      parentJobId: job.id,
      profileId: job.profileId || '',
      runId: job.runId || '',
      mode: job.mode || 'normal'
    })
  }).then(function (payload) {
    trainingWorkspaceState.runnerSelectedJobId = payload.job.id;
    trainingWorkspaceState.runnerLogOffsets[payload.job.id] = 0;
    setStatus(payload.queued ? 'Resume job queued.' : (payload.resumeFromCheckpoint ? 'Resume job started.' : 'No saved checkpoint found; starting a new run.'));
    refreshTrainingRunnerStatus();
    refreshTrainingHistory();
  }).catch(function (err) {
    setStatus('Could not queue resume: ' + String(err && err.message ? err.message : err));
  });
}

function openTrainingHistoryOutput(folder, jobId) {
  trainingRunnerRequest('/fs/training_history/open_output', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: String(folder || ''), jobId: String(jobId || '') })
  }).then(function () {
    setStatus('Opened training output folder.');
  }).catch(function (err) {
    setStatus('Could not open training output folder: ' + String(err && err.message ? err.message : err));
  });
}

function openDiscoveredTrainingRun(modelId, path) {
  trainingRunnerRequest('/fs/training_history/open_run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: String(state.folder || ''), modelId: String(modelId || ''), path: String(path || '') })
  }).then(function () {
    setStatus('Opened trained run directory.');
  }).catch(function (err) {
    setStatus('Could not open trained run directory: ' + String(err && err.message ? err.message : err));
  });
}

function openTrainingJobOutput(jobId) {
  trainingRunnerRequest('/fs/training_runner/open_output', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: String(jobId || '') })
  }).then(function () {
    setStatus('Opened effective training output folder.');
  }).catch(function (err) {
    setStatus('Could not open training output folder: ' + String(err && err.message ? err.message : err));
  });
}

function openTrainingJobBundle(jobId, folder) {
  trainingRunnerRequest('/fs/training_runner/open_bundle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: String(jobId || ''), folder: String(folder || state.folder || '') })
  }).then(function () {
    setStatus('Opened captured training files.');
  }).catch(function (err) {
    setStatus('Could not open captured training files: ' + String(err && err.message ? err.message : err));
  });
}


function trainingHistoryScopeFolder() {
  return trainingWorkspaceState.entryMode === 'set' ? String(state.folder || '').trim() : '';
}

function syncTrainingHistorySearchScope() {
  var searchEl = document.getElementById('training-history-search');
  var folder = trainingHistoryScopeFolder();
  var priorFolder = trainingWorkspaceState.historySearchScopeFolder;
  if (folder !== priorFolder && trainingWorkspaceState.history) {
    trainingWorkspaceState.history.runs = [];
    trainingWorkspaceState.history.resumeDefaults = {};
  }
  if (searchEl && folder !== priorFolder) {
    if (folder) searchEl.value = folder;
    else if (searchEl.value === priorFolder) searchEl.value = '';
  }
  trainingWorkspaceState.historySearchScopeFolder = folder;
  if (folder !== priorFolder) {
    trainingWorkspaceState.resumeSelectionTouched = false;
    if (trainingWorkspaceState.history) {
      trainingWorkspaceState.history.runs = [];
      trainingWorkspaceState.history.resumeDefaults = {};
    }
  }
  return folder;
}

function loadTrainingHistoryIndex(force) {
  if (!force && trainingWorkspaceState.historyLoaded) return Promise.resolve(trainingWorkspaceState.history || {});
  if (!force && trainingWorkspaceState.historyLoadPromise) return trainingWorkspaceState.historyLoadPromise;
  var request = fetch('/fs/training_history/all')
    .then(function (response) { return response.json(); })
    .then(function (payload) {
      if (!payload.ok) throw new Error(payload.error || 'Could not load training history.');
      var previous = trainingWorkspaceState.history || {};
      trainingWorkspaceState.history = payload.history || {};
      trainingWorkspaceState.history.runs = previous.runs || [];
      trainingWorkspaceState.history.resumeDefaults = previous.resumeDefaults || {};
      trainingWorkspaceState.historyLoaded = true;
      return trainingWorkspaceState.history;
    });
  trainingWorkspaceState.historyLoadPromise = request;
  return request.then(function (history) {
    trainingWorkspaceState.historyLoadPromise = null;
    return history;
  }, function (err) {
    trainingWorkspaceState.historyLoadPromise = null;
    throw err;
  });
}

function refreshTrainingHistory(force) {
  if (!isTrainingWorkspaceActive()) return Promise.resolve();
  var folder = syncTrainingHistorySearchScope();
  return loadTrainingHistoryIndex(!!force)
    .then(function () {
      renderTrainingHistory();
      if (!folder) return null;
      return fetch('/fs/training_history?folder=' + encodeURIComponent(folder)).then(function (response) { return response.json(); }).then(function (setPayload) {
        if (!setPayload.ok) throw new Error(setPayload.error || 'Could not load resumable runs.');
        if (trainingWorkspaceState.history && trainingHistoryScopeFolder() === folder) {
          trainingWorkspaceState.history.runs = (setPayload.history || {}).runs || [];
          trainingWorkspaceState.history.resumeDefaults = (setPayload.history || {}).resumeDefaults || {};
          renderTrainingHistory();
        }
      });
    })
    .catch(function (err) { setStatus('Could not load training history: ' + String(err.message || err)); });
}
