var trainingWorkspaceState = {
  manifest: null,
  configFiles: [],
  runnerJobs: [],
  runnerActiveJobId: '',
  runnerSelectedJobId: '',
  runnerLogOffsets: {},
  runnerConsoleJobId: '',
  runnerPollTimer: 0,
  runnerStatusPending: false,
  runnerPreflight: null,
  runStages: 'both',
  resumeParentJobId: '',
  runnerQueuePaused: false,
  runnerQueuePauseReason: '',
  runnerAttention: null,
  entryMode: 'global',
  gpu: null,
  gpuStatusPending: false,
  gpuForActiveJob: false,
  history: null,
  historyExpanded: false,
  itemOverviewHidden: false,
  tensorboard: null
};

function isTrainingWorkspaceActive() {
  return normalizeWorkspaceSurface(workspaceState.surface) === 'training';
}

function setTrainingWorkspaceEntryMode(mode) {
  trainingWorkspaceState.entryMode = mode === 'set' ? 'set' : 'global';
}

function getTrainingWorkspaceEls() {
  return {
    navigator: document.getElementById('training-navigator'),
    navigatorTitle: document.getElementById('training-navigator-title'),
    folder: document.getElementById('training-navigator-folder'),
    globalContext: document.getElementById('training-global-context'),
    setWorkflow: document.getElementById('training-set-workflow'),
    runSetup: document.getElementById('training-run-setup'),
    readiness: document.getElementById('training-readiness'),
    configList: document.getElementById('training-workspace-config-list'),
    commandStatus: document.getElementById('training-command-status'),
    commandText: document.getElementById('training-command-text'),
    copyCommandBtn: document.getElementById('training-copy-command-btn'),
    itemOverview: document.getElementById('training-item-overview'),
    itemOverviewSummary: document.getElementById('training-item-overview-summary'),
    itemOverviewToggleBtn: document.getElementById('training-item-overview-toggle-btn'),
    runnerSummary: document.getElementById('training-runner-summary'),
    runnerQueue: document.getElementById('training-runner-queue'),
    runnerActions: document.getElementById('training-runner-actions'),
    runnerFinishBtn: document.getElementById('training-runner-finish-btn'),
    runnerPauseBtn: document.getElementById('training-runner-pause-btn'),
    runnerResumeQueueBtn: document.getElementById('training-runner-resume-queue-btn'),
    runnerConsoleBtn: document.getElementById('training-runner-console-btn'),
    runnerConsole: document.getElementById('training-runner-console'),
    runnerConsoleTitle: document.getElementById('training-runner-console-title'),
    runnerConsoleLog: document.getElementById('training-runner-console-log'),
    runnerConsoleCloseBtn: document.getElementById('training-runner-console-close-btn'),
    runnerPreflight: document.getElementById('training-runner-preflight'),
    gpuStatus: document.getElementById('training-gpu-status'),
    attentionCard: document.getElementById('training-attention-card'),
    attentionTitle: document.getElementById('training-attention-title'),
    attentionSummary: document.getElementById('training-attention-summary'),
    attentionActions: document.getElementById('training-attention-actions'),
    historySummary: document.getElementById('training-history-summary'),
    historyList: document.getElementById('training-history-list'),
    historyShowAllBtn: document.getElementById('training-history-show-all-btn'),
    checkpointSelect: document.getElementById('training-run-checkpoint-select'),
    tensorboardSummary: document.getElementById('training-tensorboard-summary'),
    tensorboardStartBtn: document.getElementById('training-tensorboard-start-btn'),
    tensorboardStopBtn: document.getElementById('training-tensorboard-stop-btn'),
    tensorboardOpenLink: document.getElementById('training-tensorboard-open-link')
  };
}

function trainingRunnerRequest(path, options) {
  var allowNotOk = !!(options && options.allowNotOk);
  return fetch(path, options || {}).then(function (response) {
    return response.json().catch(function () { return {}; }).then(function (payload) {
      if ((!response.ok && !allowNotOk) || (!payload.ok && !allowNotOk)) {
        throw new Error(payload.error || 'Training runner request failed.');
      }
      return payload;
    });
  });
}

function getTrainingRunnerSelectedJob() {
  var jobs = trainingWorkspaceState.runnerJobs || [];
  for (var activeIndex = 0; activeIndex < jobs.length; activeIndex++) {
    if (jobs[activeIndex].id === trainingWorkspaceState.runnerActiveJobId) return jobs[activeIndex];
  }
  var selectedId = trainingWorkspaceState.runnerSelectedJobId;
  for (var i = 0; i < jobs.length; i++) {
    if (jobs[i].id === selectedId && (jobs[i].status === 'queued' || jobs[i].status === 'paused' || jobs[i].status === 'interrupted')) return jobs[i];
  }
  for (var queuedIndex = 0; queuedIndex < jobs.length; queuedIndex++) {
    if (jobs[queuedIndex].status === 'queued' || jobs[queuedIndex].status === 'paused' || jobs[queuedIndex].status === 'interrupted') return jobs[queuedIndex];
  }
  return null;
}

function getTrainingRunnerActiveJob() {
  var jobs = trainingWorkspaceState.runnerJobs || [];
  for (var i = 0; i < jobs.length; i++) {
    if (jobs[i].id === trainingWorkspaceState.runnerActiveJobId) return jobs[i];
  }
  for (var j = 0; j < jobs.length; j++) {
    if (jobs[j].status === 'starting' || jobs[j].status === 'running' || jobs[j].status === 'stopping') return jobs[j];
  }
  return null;
}

function getTrainingRunnerJobById(jobId) {
  var jobs = trainingWorkspaceState.runnerJobs || [];
  for (var i = 0; i < jobs.length; i++) {
    if (jobs[i].id === jobId) return jobs[i];
  }
  return null;
}

function formatTrainingRunnerElapsed(job) {
  var started = Number(job && job.startedAt || 0);
  if (!started) return '';
  var seconds = Math.max(0, Math.floor(Date.now() / 1000 - started));
  return formatTrainingRunnerDuration(seconds);
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
  var stages = String(job && job.stages || 'both');
  var names = stages === 'both' ? ['hi', 'lo'] : [stages];
  return names.reduce(function (total, name) {
    var stage = plan[name] && typeof plan[name] === 'object' ? plan[name] : {};
    var steps = Number(stage.estimatedSteps);
    return total + (isFinite(steps) && steps > 0 ? steps : 0);
  }, 0);
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
    positionLabel += ' · ~' + formatTrainingRunnerDuration(etaSeconds) + ' left';
  }
  var progressLabel = progress.source === 'steps'
    ? (job.stages === 'both'
      ? 'Step estimate: ' + Math.round(stagePercent) + '% this stage · ' + Math.round(boundedOverall) + '% overall'
      : 'Step estimate: ' + Math.round(stagePercent) + '% of ' + trainingStageLabel(progress.stage || job.stages || 'both'))
    : (job.stages === 'both'
      ? Math.round(stagePercent) + '% this stage · ' + Math.round(boundedOverall) + '% overall'
      : Math.round(stagePercent) + '% of ' + trainingStageLabel(progress.stage || job.stages || 'both'));
  return '<div class="training-runner-progress" aria-label="Estimated training progress">' +
    '<div class="training-runner-progress-copy"><span>' + escapeHtml(trainingStageLabel(progress.stage || job.stages || 'both')) +
      positionLabel + '</span>' +
      '<span>' + escapeHtml(progressLabel) + '</span></div>' +
    '<div class="training-runner-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(boundedOverall) + '">' +
      '<span style="width:' + boundedOverall.toFixed(1) + '%"></span></div>' +
    '</div>';
}

function formatTrainingGpuMemory(value) {
  var mib = Number(value);
  if (!isFinite(mib) || mib < 0) return '';
  var gib = mib / 1024;
  return (gib >= 10 ? gib.toFixed(0) : gib.toFixed(1)) + ' GB';
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
  return '<strong>' + escapeHtml(primarySummary) + '</strong>';
}

function trainingQueueHoldLabel() {
  return trainingWorkspaceState.runnerQueuePauseReason === 'Queue held after WebCap restarted.'
    ? 'Queue needs confirmation'
    : 'Queue paused';
}

function trainingFolderName(folder) {
  var parts = String(folder || '').split(/[\\/]/).filter(function (part) { return !!part; });
  return parts.length ? parts[parts.length - 1] : String(folder || 'this set');
}

function trainingQueueStartLabel() {
  return 'Resume Queue';
}

function syncTrainingQueueResumeButton(els, queuedJobs) {
  if (!els.runnerResumeQueueBtn) return;
  var nextJob = queuedJobs[0];
  els.runnerResumeQueueBtn.textContent = trainingQueueStartLabel();
  els.runnerResumeQueueBtn.title = nextJob
    ? 'Resume the queue from its first item.'
    : 'Allow queued training jobs to run.';
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

function renderTrainingAttention() {
  var els = getTrainingWorkspaceEls();
  var attention = trainingWorkspaceState.runnerAttention;
  if (!els.attentionCard || !els.attentionSummary || !els.attentionActions) return;
  if (!attention) {
    els.attentionCard.classList.add('hidden');
    return;
  }
  var kind = String(attention.kind || 'queue_held');
  var queuedJobs = (trainingWorkspaceState.runnerJobs || []).filter(function (job) {
    return job.status === 'queued' || job.status === 'paused' || job.status === 'interrupted';
  });
  var nextJob = queuedJobs[0];
  var title = kind === 'queue_held' ? 'Queue is held' : 'Training needs attention';
  var detail = attention.details
    ? '<div class="training-attention-detail">' + escapeHtml(attention.details) + '</div>'
    : '';
  var actions = '';
  if (nextJob) {
    actions += '<button type="button" class="review-captions-btn" data-training-attention-action="continue">' + escapeHtml(trainingQueueStartLabel()) + '</button>';
  }
  if (attention.folder) {
    actions += '<button type="button" class="review-captions-btn" data-training-attention-action="open" data-training-folder="' + escapeHtml(attention.folder) + '">Open set</button>';
  }
  els.attentionTitle.textContent = title;
  els.attentionSummary.innerHTML = escapeHtml(attention.message || 'Training requires a decision.') + detail;
  els.attentionActions.innerHTML = actions;
  els.attentionCard.classList.remove('hidden');
}

function renderTrainingRunner() {
  var els = getTrainingWorkspaceEls();
  if (!els.runnerSummary || !els.runnerActions) return;
  var jobs = trainingWorkspaceState.runnerJobs || [];
  renderTrainingAttention();
  var activeCount = jobs.filter(function (job) { return job.status === 'starting' || job.status === 'running' || job.status === 'stopping'; }).length;
  var queuedJobs = jobs.filter(function (job) { return job.status === 'queued' || job.status === 'paused' || job.status === 'interrupted'; });
  var queuedCount = queuedJobs.length;
  var job = getTrainingRunnerActiveJob();
  if (els.gpuStatus) els.gpuStatus.innerHTML = buildTrainingGpuStatusHtml();
  syncTrainingQueueResumeButton(els, queuedJobs);
  if (els.runnerQueue) {
    if (!queuedJobs.length) {
      els.runnerQueue.innerHTML = '';
      els.runnerQueue.classList.add('hidden');
    } else {
      els.runnerQueue.innerHTML = '<div class="training-runner-queue-title">Queue (' + queuedJobs.length + ')' + (trainingWorkspaceState.runnerQueuePaused ? ' · paused' : '') + '</div>' +
        queuedJobs.map(function (queuedJob, index) {
          var stage = trainingJobLabel(queuedJob);
          var plannedSteps = trainingPlannedStepCount(queuedJob);
          var workload = plannedSteps ? ' · ~' + Math.round(plannedSteps).toLocaleString() + ' planned steps' : '';
          var status = String(queuedJob.status || 'queued');
          var error = queuedJob.error ? '<div class="training-runner-queue-resume">' + escapeHtml(queuedJob.error) + '</div>' : '';
          var resume = queuedJob.resumeFromCheckpoint
            ? '<div class="training-runner-queue-resume">Resume ' + escapeHtml(trainingStageLabel(queuedJob.resumeStage || queuedJob.stages || 'both')) + ': ' + escapeHtml(queuedJob.resumeFromCheckpoint) + '</div>'
            : '';
          var selected = queuedJob.id === trainingWorkspaceState.runnerSelectedJobId;
          return '<div class="training-runner-queue-item' + (selected ? ' active' : '') + '" data-training-queue-job="' + escapeHtml(queuedJob.id) + '">' +
            '<div class="training-runner-queue-copy">' +
              '<div><span class="training-runner-status training-runner-status--' + escapeHtml(status) + '">' + escapeHtml(trainingRunnerStatusLabel(status)) + '</span> <strong>' + (index + 1) + '.</strong> ' + escapeHtml(stage + workload) + '</div>' +
              '<button type="button" class="training-runner-queue-folder" data-training-open-folder="' + escapeHtml(queuedJob.folder || '') + '" title="Open set: ' + escapeHtml(queuedJob.folder || '') + '">' + escapeHtml(queuedJob.folder || '') + '</button>' +
              resume +
              error +
            '</div>' +
            '<div class="training-runner-queue-controls">' +
              '<button type="button" class="training-runner-queue-control" data-training-queue-action="up" data-training-job-id="' + escapeHtml(queuedJob.id) + '" title="Move up" aria-label="Move up"' + (index === 0 ? ' disabled' : '') + '>&#8593;</button>' +
              '<button type="button" class="training-runner-queue-control" data-training-queue-action="down" data-training-job-id="' + escapeHtml(queuedJob.id) + '" title="Move down" aria-label="Move down"' + (index === queuedJobs.length - 1 ? ' disabled' : '') + '>&#8595;</button>' +
              '<button type="button" class="training-runner-queue-control training-runner-queue-cancel" data-training-queue-action="cancel" data-training-job-id="' + escapeHtml(queuedJob.id) + '" title="Remove from queue" aria-label="Remove from queue">&#215;</button>' +
            '</div>' +
            '</div>';
        }).join('');
      els.runnerQueue.classList.remove('hidden');
    }
  }
  if (!job) {
    var noJobMessage = trainingWorkspaceState.runnerQueuePaused
      ? trainingQueueHoldLabel()
      : queuedCount ? 'No active training job.' : 'No managed training jobs.';
    els.runnerSummary.innerHTML = '<div>' + escapeHtml(noJobMessage) + '</div>';
    els.runnerActions.classList.toggle('hidden', !trainingWorkspaceState.runnerQueuePaused);
    if (els.runnerFinishBtn) els.runnerFinishBtn.classList.add('hidden');
    if (els.runnerPauseBtn) els.runnerPauseBtn.classList.add('hidden');
    if (els.runnerResumeQueueBtn) els.runnerResumeQueueBtn.classList.toggle('hidden', !trainingWorkspaceState.runnerQueuePaused);
    return;
  }
  trainingWorkspaceState.runnerSelectedJobId = job.id;
  var elapsed = formatTrainingRunnerElapsed(job);
  var status = String(job.status || 'unknown');
  var statusLabel = trainingRunnerStatusLabel(status);
  var running = status === 'starting' || status === 'running' || status === 'stopping';
  var queued = status === 'queued' || status === 'paused' || status === 'interrupted';
  var lastLogAt = Number(job.lastLogAt || 0);
  var quietSeconds = lastLogAt ? Math.max(0, Math.floor(Date.now() / 1000 - lastLogAt)) : 0;
  var quietNote = running && quietSeconds >= 120
    ? '<div class="training-runner-detail is-warning">Runner process is alive, but no output for ' + escapeHtml(formatTrainingRunnerDuration(quietSeconds)) + '. GPU activity may be idle; view output to investigate.</div>'
    : '';
  var queueState = trainingWorkspaceState.runnerQueuePaused
    ? '<span class="training-runner-queue-state" title="' + escapeHtml(trainingWorkspaceState.runnerQueuePauseReason || 'Queue is paused.') + '">' + escapeHtml(trainingQueueHoldLabel()) + ' — no job will start automatically</span>'
    : '';
  var selectedQueuePosition = queued ? queuedJobs.indexOf(job) + 1 : 0;
  var queuePosition = selectedQueuePosition
    ? '<span class="training-runner-queued-count">' + (selectedQueuePosition === 1 ? 'Next to start' : 'Queue position ' + selectedQueuePosition + ' of ' + queuedCount) + '</span>'
    : '';
  els.runnerSummary.innerHTML = '<div class="training-runner-active-row">' +
    '<div class="training-runner-state">' +
      '<span class="training-runner-status training-runner-status--' + escapeHtml(status) + '">' + escapeHtml(statusLabel) + '</span>' +
      '<span>' + escapeHtml(trainingJobLabel(job)) + (elapsed ? ' · ' + escapeHtml(elapsed) : '') + '</span>' +
    '</div>' +
    '<button type="button" class="training-runner-folder" data-training-open-folder="' + escapeHtml(job.folder || '') + '" title="Open set: ' + escapeHtml(job.folder || '') + '">' + escapeHtml(job.folder || '') + '</button>' +
    queuePosition +
    queueState +
    '</div>' +
    (job.error ? '<div class="training-runner-detail is-error">' + escapeHtml(job.error) + '</div>' : '') +
    (job.completionNote ? '<div class="training-runner-detail is-warning">' + escapeHtml(job.completionNote) + '</div>' : '') +
    quietNote +
    buildTrainingRunnerProgressHtml(job);
  els.runnerActions.classList.remove('hidden');
  if (els.runnerFinishBtn) els.runnerFinishBtn.classList.toggle('hidden', !running);
  if (els.runnerPauseBtn) els.runnerPauseBtn.classList.toggle('hidden', !running);
  if (els.runnerResumeQueueBtn) els.runnerResumeQueueBtn.classList.toggle('hidden', !trainingWorkspaceState.runnerQueuePaused);
  if (!activeCount && !queuedCount && !trainingWorkspaceState.runnerQueuePaused && status !== 'failed' && status !== 'completed' && status !== 'finished_early' && status !== 'stopped') {
    els.runnerActions.classList.add('hidden');
  }
}

function formatTrainingHistoryTime(value) {
  var seconds = Number(value || 0);
  if (!seconds) return '';
  return new Date(seconds * 1000).toLocaleString();
}

function renderTrainingHistory() {
  var els = getTrainingWorkspaceEls();
  if (!els.historySummary || !els.historyList || !els.checkpointSelect) return;
  var history = trainingWorkspaceState.history || {};
  var jobs = (trainingWorkspaceState.runnerJobs || []).filter(function (job) {
    return job.status === 'completed' || job.status === 'finished_early' || job.status === 'failed' || job.status === 'stopped' || job.status === 'cancelled';
  }).slice().sort(function (a, b) {
    return Number(b.finishedAt || b.startedAt || b.createdAt || 0) - Number(a.finishedAt || a.startedAt || a.createdAt || 0);
  });
  var runs = Array.isArray(history.runs) ? history.runs : [];
  var latest = jobs.length ? jobs[0] : null;
  els.historySummary.classList.toggle('hidden', !!latest);
  els.historySummary.textContent = latest ? '' : 'No completed or actionable training outcomes yet.';
  var visibleJobs = trainingWorkspaceState.historyExpanded ? jobs : jobs.slice(0, 2);
  els.historyList.innerHTML = visibleJobs.map(function (job) {
    var progress = job.progress && typeof job.progress === 'object' ? job.progress : {};
    var finalStep = Number(progress.step);
    var elapsedSeconds = Number(job.finishedAt || 0) - Number(job.startedAt || 0);
    var details = [];
    if (isFinite(finalStep) && finalStep >= 0) details.push('Final step ' + Math.round(finalStep).toLocaleString());
    if (elapsedSeconds > 0) details.push(formatTrainingRunnerDuration(elapsedSeconds));
    return '<div class="training-history-item" data-training-history-job="' + escapeHtml(job.id || '') + '">' +
      '<div class="training-history-primary"><strong>' + escapeHtml(trainingRunnerStatusLabel(job.status)) + '</strong> · ' + escapeHtml(trainingStageLabel(job.stages || 'both')) +
        '<span class="training-history-time">' + escapeHtml(formatTrainingHistoryTime(job.finishedAt || job.startedAt || job.createdAt)) + '</span></div>' +
      '<div class="training-history-set"><button type="button" class="training-history-folder" data-training-open-folder="' + escapeHtml(job.folder || '') + '" title="Open set: ' + escapeHtml(job.folder || '') + '">' + escapeHtml(job.folder || '') + '</button></div>' +
      '<div class="training-history-details">' +
        (details.length ? '<div>' + escapeHtml(details.join(' · ')) + '</div>' : '') +
        (job.completionNote ? '<div class="training-runner-detail is-warning">' + escapeHtml(job.completionNote) + '</div>' : '') +
      '</div>' +
      '<div class="training-history-actions">' +
      '<button type="button" data-training-history-log="' + escapeHtml(job.id || '') + '">Output</button>' +
      '</div></div>';
  }).join('');
  if (els.historyShowAllBtn) {
    els.historyShowAllBtn.classList.toggle('hidden', jobs.length <= 2);
    els.historyShowAllBtn.textContent = trainingWorkspaceState.historyExpanded ? 'Show less' : 'Show all (' + jobs.length + ')';
  }
  var selectedCheckpoint = String(els.checkpointSelect.value || '');
  els.checkpointSelect.innerHTML = '<option value="">Start a new run</option>' + runs.map(function (run) {
    var unavailable = !run.checkpointAvailable;
    var details = [];
    if (run.epoch && run.expectedEpochs) details.push('epoch ' + run.epoch + ' / ' + run.expectedEpochs);
    if (run.steps) details.push('step ' + Number(run.steps).toLocaleString());
    if (run.completed) details.push('complete');
    var setName = String(run.setName || '').trim();
    return '<option value="' + escapeHtml(run.path || '') + '"' + (unavailable ? ' disabled' : '') + '>' +
      escapeHtml((run.stage ? trainingStageLabel(run.stage) + ' · ' : '') + (setName ? setName + ' · ' : '') + (run.name || run.path || 'run') +
        (details.length ? ' · ' + details.join(' · ') : '') + (unavailable && !run.completed ? ' (no checkpoint found)' : '')) + '</option>';
  }).join('');
  if (selectedCheckpoint) els.checkpointSelect.value = selectedCheckpoint;
}

function renderTensorboard() {
  var els = getTrainingWorkspaceEls();
  if (!els.tensorboardSummary) return;
  var board = trainingWorkspaceState.tensorboard || {};
  var running = board.status === 'running';
  els.tensorboardSummary.textContent = running
    ? 'Running at ' + (board.url || 'local URL') + ' · logs: ' + (board.setLogRoot || board.logRoot || '')
    : (board.error || 'Not running. Logs will be grouped by set.');
  if (els.tensorboardStartBtn) els.tensorboardStartBtn.classList.toggle('hidden', running);
  if (els.tensorboardStopBtn) els.tensorboardStopBtn.classList.toggle('hidden', !running);
  if (els.tensorboardOpenLink) {
    els.tensorboardOpenLink.classList.toggle('hidden', !running || !board.url);
    els.tensorboardOpenLink.href = board.url || '#';
  }
}

function appendTrainingRunnerValidationToAppConsole(payload) {
  var checks = Array.isArray(payload.checks) ? payload.checks : [];
  var lines = ['[training-runner] Validation results:'];
  checks.forEach(function (check) {
    lines.push((check.ok ? '[OK] ' : '[FAIL] ') + (check.message || check.id));
    if (check.details) lines.push(String(check.details));
  });
  if (payload.runnerScript) lines.push('[training-runner] Generated runner script:\n' + payload.runnerScript);
  appendToConsolePanel(lines.join('\n') + '\n');
}

function isTrainingRunnerConsoleVisible() {
  var els = getTrainingWorkspaceEls();
  return !!(els.runnerConsole && !els.runnerConsole.classList.contains('hidden'));
}

function appendToTrainingRunnerConsole(text) {
  var els = getTrainingWorkspaceEls();
  if (!els.runnerConsoleLog) return;
  els.runnerConsoleLog.textContent += String(text || '');
  if (els.runnerConsoleLog.textContent.length > 200000) {
    els.runnerConsoleLog.textContent = els.runnerConsoleLog.textContent.slice(-160000);
  }
  els.runnerConsoleLog.scrollTop = els.runnerConsoleLog.scrollHeight;
}

function hideTrainingRunnerConsole() {
  var els = getTrainingWorkspaceEls();
  if (els.runnerConsole) els.runnerConsole.classList.add('hidden');
  syncTrainingConsoleUi();
}

function showTrainingRunnerConsole(job) {
  var target = job || getTrainingRunnerSelectedJob();
  if (!target || !target.id) {
    setStatus('Select a training job to view its output.');
    return;
  }
  var els = getTrainingWorkspaceEls();
  if (!els.runnerConsole || !els.runnerConsoleLog) return;
  var changedJob = trainingWorkspaceState.runnerConsoleJobId !== target.id;
  trainingWorkspaceState.runnerConsoleJobId = target.id;
  if (changedJob) {
    els.runnerConsoleLog.textContent = '';
    trainingWorkspaceState.runnerLogOffsets[target.id] = 0;
  }
  els.runnerConsoleTitle.textContent = 'Training output · ' + trainingFolderName(target.folder);
  els.runnerConsole.classList.remove('hidden');
  syncTrainingConsoleUi();
  fetchTrainingRunnerLog(target, changedJob);
}

function fetchTrainingRunnerLog(job, reset) {
  if (!job || !job.id) return;
  var offset = reset ? 0 : Number(trainingWorkspaceState.runnerLogOffsets[job.id] || 0);
  fetch('/fs/training_runner/log?jobId=' + encodeURIComponent(job.id) + '&offset=' + encodeURIComponent(offset))
    .then(function (response) { return response.json(); })
    .then(function (payload) {
      if (!payload || !payload.ok) throw new Error((payload && payload.error) || 'Could not load training output.');
      trainingWorkspaceState.runnerLogOffsets[job.id] = Number(payload.nextOffset || offset);
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
      if (window.console && console.error) console.error('[Training runner] Log refresh failed:', err);
      setStatus('Could not load training output: ' + String(err && err.message ? err.message : err));
    });
}

function scheduleTrainingRunnerPoll() {
  if (trainingWorkspaceState.runnerPollTimer) clearTimeout(trainingWorkspaceState.runnerPollTimer);
  if (!isTrainingWorkspaceActive()) return;
  var hasPendingJob = (trainingWorkspaceState.runnerJobs || []).some(function (job) {
    return job.status === 'starting' || job.status === 'running' || job.status === 'stopping' || job.status === 'queued' || job.status === 'paused' || job.status === 'interrupted';
  });
  if (!hasPendingJob) return;
  var delay = isTrainingRunnerConsoleVisible() ? 1500 : 5000;
  trainingWorkspaceState.runnerPollTimer = setTimeout(function () {
    refreshTrainingRunnerStatus();
  }, delay);
}

function refreshTrainingRunnerStatus() {
  if (!isTrainingWorkspaceActive() || trainingWorkspaceState.runnerStatusPending) return;
  trainingWorkspaceState.runnerStatusPending = true;
  trainingRunnerRequest('/fs/training_runner/status')
    .then(function (payload) {
      trainingWorkspaceState.runnerJobs = Array.isArray(payload.jobs) ? payload.jobs : [];
      trainingWorkspaceState.runnerActiveJobId = String(payload.activeJobId || '');
      trainingWorkspaceState.runnerQueuePaused = !!payload.queuePaused;
      trainingWorkspaceState.runnerQueuePauseReason = String(payload.queuePauseReason || '');
      trainingWorkspaceState.runnerAttention = payload.attention || null;
      renderTrainingRunner();
      renderTrainingHistory();
      refreshTrainingHistory();
      var selected = getTrainingRunnerSelectedJob();
      var hasActiveJob = trainingWorkspaceState.runnerJobs.some(function (job) {
        return job.status === 'starting' || job.status === 'running' || job.status === 'stopping';
      });
      if (hasActiveJob) {
        trainingWorkspaceState.gpuForActiveJob = true;
        refreshTrainingGpuStatus();
      } else if (trainingWorkspaceState.gpuForActiveJob || !trainingWorkspaceState.gpu) {
        trainingWorkspaceState.gpuForActiveJob = false;
        refreshTrainingGpuStatus();
      }
      if (isTrainingRunnerConsoleVisible() && selected && selected.id === trainingWorkspaceState.runnerConsoleJobId) {
        fetchTrainingRunnerLog(selected);
      }
    })
    .catch(function (err) {
      if (window.console && console.error) console.error('[Training runner] Status refresh failed:', err);
    })
    .then(function () {
      trainingWorkspaceState.runnerStatusPending = false;
      scheduleTrainingRunnerPoll();
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
      trainingWorkspaceState.gpuStatusPending = false;
      renderTrainingRunner();
    });
}

function validateTrainingRunner(options) {
  if (!state.folder) return Promise.reject(new Error('No folder selected for training validation.'));
  setStatus('Validating managed training runner...');
  showConsolePanel();
  return trainingRunnerRequest('/fs/training_runner/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folder: state.folder,
      stages: options && options.stages ? options.stages : 'both',
      resumeFromCheckpoint: options && options.resumeFromCheckpoint ? options.resumeFromCheckpoint : '',
      resumeStage: options && options.resumeStage ? options.resumeStage : ''
    }),
    allowNotOk: true
  }).then(function (payload) {
    renderTrainingRunnerPreflight(payload);
    appendTrainingRunnerValidationToAppConsole(payload);
    setStatus(payload.ok ? 'Training runner validation passed.' : 'Training runner validation found blockers.');
    return payload;
  });
}

function getManagedTrainingOptions() {
  var resumeEl = document.getElementById('training-run-resume-input');
  var checkpointEl = document.getElementById('training-run-checkpoint-select');
  var resumeStageEl = document.getElementById('training-run-resume-stage-select');
  var stages = String(trainingWorkspaceState.runStages || 'both');
  if (stages !== 'hi' && stages !== 'lo' && stages !== 'both') stages = 'both';
  return {
    stages: stages,
    resumeFromCheckpoint: checkpointEl && checkpointEl.value ? String(checkpointEl.value).trim() : (resumeEl ? String(resumeEl.value || '').trim() : ''),
    resumeStage: stages === 'both' ? (resumeStageEl ? String(resumeStageEl.value || 'lo') : 'lo') : stages,
    parentJobId: String(trainingWorkspaceState.resumeParentJobId || '')
  };
}

function setManagedTrainingStages(stages) {
  if (stages !== 'hi' && stages !== 'lo' && stages !== 'both') stages = 'both';
  trainingWorkspaceState.runStages = stages;
  var buttons = document.querySelectorAll('[data-training-stage]');
  buttons.forEach(function (button) {
    var active = button.getAttribute('data-training-stage') === stages;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  syncManagedTrainingResumeUi();
}

function syncManagedTrainingResumeUi() {
  var resumeEl = document.getElementById('training-run-resume-input');
  var checkpointEl = document.getElementById('training-run-checkpoint-select');
  var resumeStageOption = document.getElementById('training-run-resume-stage-option');
  if (!resumeStageOption) return;
  var hasResume = !!((checkpointEl && String(checkpointEl.value || '').trim()) || (resumeEl && String(resumeEl.value || '').trim()));
  resumeStageOption.classList.toggle('hidden', trainingWorkspaceState.runStages !== 'both' || !hasResume);
}

function trainingStageLabel(stages) {
  return stages === 'hi' ? 'High Noise' : stages === 'lo' ? 'Low Noise' : 'High Noise to Low Noise';
}

function trainingJobLabel(job) {
  return String(job && job.modelLabel || 'WAN 2.2') + ' · ' + trainingStageLabel(String(job && job.stages || 'both'));
}

function startManagedTraining() {
  if (!state.folder) {
    setStatus('No folder selected for managed training.');
    return;
  }
  var options = getManagedTrainingOptions();
  ensureGeneratedTrainingArtifactsForCurrentFolder()
    .then(function () {
      setStatus('Adding training job...');
      return trainingRunnerRequest('/fs/training_runner/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder: state.folder,
          queue: true,
          stages: options.stages,
          resumeFromCheckpoint: options.resumeFromCheckpoint,
          resumeStage: options.resumeStage,
          parentJobId: options.parentJobId
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
    });
}

function stopManagedTraining(cancel, pause, finish) {
  var job = getTrainingRunnerSelectedJob();
  if (!job || !job.id) return;
  var label = cancel ? 'Cancel this queued training job?' : pause
    ? 'Pause this job? It will interrupt training, hold the queue, and free the GPU.'
    : finish
      ? 'Finish this run early? Its current output will be kept, the run will be marked finished early, and the queue will continue.'
      : 'Stop this job and continue to the next queued set?';
  if (!window.confirm(label)) return;
  trainingRunnerRequest('/fs/training_runner/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: job.id, cancel: !!cancel, pause: !!pause, finish: !!finish })
  }).then(function () {
    setStatus(cancel ? 'Queued training job cancelled.' : (pause ? 'Training paused; queue held.' : 'Stopping managed training...'));
    refreshTrainingRunnerStatus();
    refreshTrainingHistory();
  }).catch(function (err) {
    setStatus('Could not change training job: ' + String(err && err.message ? err.message : err));
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
    .then(function () { setStatus('Training queue resumed.'); refreshTrainingRunnerStatus(); })
    .catch(function (err) { setStatus('Could not resume training queue: ' + String(err.message || err)); });
}

function refreshTrainingHistory() {
  if (!state.folder || !isTrainingWorkspaceActive()) return Promise.resolve();
  return fetch('/fs/training_history?folder=' + encodeURIComponent(state.folder))
    .then(function (response) { return response.json(); })
    .then(function (payload) {
      if (!payload.ok) throw new Error(payload.error || 'Could not load training history.');
      trainingWorkspaceState.history = payload.history || {};
      renderTrainingHistory();
    })
    .catch(function (err) { setStatus('Could not load training history: ' + String(err.message || err)); });
}

function refreshTensorboardStatus() {
  if (!isTrainingWorkspaceActive()) return Promise.resolve();
  return fetch('/fs/tensorboard/status?folder=' + encodeURIComponent(state.folder || ''))
    .then(function (response) { return response.json(); })
    .then(function (payload) {
      if (!payload.ok) throw new Error(payload.error || 'Could not load TensorBoard status.');
      trainingWorkspaceState.tensorboard = payload.tensorboard || {};
      renderTensorboard();
    })
    .catch(function (err) { setStatus('Could not load TensorBoard status: ' + String(err.message || err)); });
}

function startTensorboard() {
  trainingRunnerRequest('/fs/tensorboard/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: state.folder || '' })
  }).then(function (payload) {
    trainingWorkspaceState.tensorboard = payload.tensorboard || {};
    renderTensorboard();
    setStatus('TensorBoard started.');
  }).catch(function (err) { setStatus('Could not start TensorBoard: ' + String(err.message || err)); });
}

function stopTensorboard() {
  trainingRunnerRequest('/fs/tensorboard/stop', { method: 'POST' })
    .then(function (payload) {
      trainingWorkspaceState.tensorboard = payload.tensorboard || {};
      renderTensorboard();
      setStatus('TensorBoard stopped.');
    })
    .catch(function (err) { setStatus('Could not stop TensorBoard: ' + String(err.message || err)); });
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
  els.configList.innerHTML = '<div class="training-config-links">' + files.map(function (fileName) {
    var active = !!(state.currentConfigFile && state.currentConfigFile.folder === state.folder && state.currentConfigFile.file === fileName);
    return '<button type="button" class="training-config-link' + (active ? ' active' : '') + '" data-training-config="' + encodeURIComponent(fileName) + '">' + escapeHtml(fileName) + '</button>';
  }).join('') + '</div>';
  Array.prototype.forEach.call(els.configList.querySelectorAll('[data-training-config]'), function (button) {
    button.onclick = function () {
      loadConfigFileToEditor(decodeURIComponent(button.getAttribute('data-training-config') || ''), {
        preserveTrainingWorkspace: true
      });
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
  if (els.setWorkflow) els.setWorkflow.classList.toggle('hidden', !isSetEntry);
  if (els.runSetup) els.runSetup.classList.toggle('hidden', !isSetEntry);
  if (!isSetEntry) {
    trainingWorkspaceState.manifest = null;
    trainingWorkspaceState.configFiles = [];
    if (els.readiness) els.readiness.textContent = 'Select a set folder to prepare a dataset.';
    renderTrainingItemOverview(null);
    renderTrainingWorkspaceConfigList([]);
    trainingWorkspaceState.history = null;
    renderTrainingHistory();
    renderTrainingCommandHandoff();
    return;
  }
  if (els.readiness) els.readiness.textContent = 'Loading dataset readiness...';
  Promise.all([fetchTrainingWorkspaceManifest(folder), fetchTrainingWorkspaceConfigFiles(folder), refreshTrainingHistory()])
    .then(function (results) {
      if (state.folder !== folder || !isTrainingWorkspaceActive()) return;
      trainingWorkspaceState.manifest = results[0];
      trainingWorkspaceState.configFiles = results[1];
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
  var stageButtons = document.querySelectorAll('[data-training-stage]');
  var resumeInput = document.getElementById('training-run-resume-input');
  var checkpointSelect = document.getElementById('training-run-checkpoint-select');
  var itemOverviewToggleBtn = document.getElementById('training-item-overview-toggle-btn');
  var previewCommandBtn = document.getElementById('training-preview-command-btn');
  var validateRunnerBtn = document.getElementById('training-validate-runner-btn');
  var runInAppBtn = document.getElementById('training-run-in-app-btn');
  var queueJobBtn = document.getElementById('training-queue-job-btn');
  var copyCommandBtn = document.getElementById('training-copy-command-btn');
  var consoleBtn = document.getElementById('training-console-btn');
  var runnerFinishBtn = document.getElementById('training-runner-finish-btn');
  var runnerPauseBtn = document.getElementById('training-runner-pause-btn');
  var runnerResumeQueueBtn = document.getElementById('training-runner-resume-queue-btn');
  var runnerConsoleBtn = document.getElementById('training-runner-console-btn');
  var runnerConsoleCloseBtn = document.getElementById('training-runner-console-close-btn');
  var runnerQueue = document.getElementById('training-runner-queue');
  var attentionActions = document.getElementById('training-attention-actions');
  var historyList = document.getElementById('training-history-list');
  var historyShowAllBtn = document.getElementById('training-history-show-all-btn');
  var tensorboardStartBtn = document.getElementById('training-tensorboard-start-btn');
  var tensorboardStopBtn = document.getElementById('training-tensorboard-stop-btn');
  backBtn.onclick = function () { exitWorkspaceSurface(); };
  sidebarCollapseBtn.onclick = function () { toggleSidebarCollapsed(); };
  itemOverviewToggleBtn.onclick = function () {
    trainingWorkspaceState.itemOverviewHidden = !trainingWorkspaceState.itemOverviewHidden;
    renderTrainingItemOverview(trainingWorkspaceState.manifest);
  };
  prepareBtn.onclick = function () { runTrainingWorkspaceAction('prepare'); };
  generateBtn.onclick = function () { runTrainingWorkspaceAction('generate'); };
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
    trainingWorkspaceState.resumeParentJobId = '';
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
    showTrainingRunnerConsole();
  };
  runnerFinishBtn.onclick = function () { stopManagedTraining(false, false, true); };
  runnerPauseBtn.onclick = function () { stopManagedTraining(false, true); };
  runnerResumeQueueBtn.onclick = resumeManagedTrainingQueue;
  runnerConsoleBtn.onclick = function () {
    showTrainingRunnerConsole();
  };
  runnerConsoleCloseBtn.onclick = hideTrainingRunnerConsole;
  runnerQueue.onclick = function (event) {
    var folderButton = event.target.closest('[data-training-open-folder]');
    var folder = folderButton && folderButton.getAttribute('data-training-open-folder');
    if (folder) {
      openTrainingWorkspaceFolder(folder);
      return;
    }
    var action = event.target.getAttribute('data-training-queue-action');
    var jobId = event.target.getAttribute('data-training-job-id');
    if (action && jobId) {
      event.stopPropagation();
      if (action === 'cancel') {
        trainingWorkspaceState.runnerSelectedJobId = jobId;
        stopManagedTraining(true, false);
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
  attentionActions.onclick = function (event) {
    var action = event.target.getAttribute('data-training-attention-action');
    if (!action) return;
    if (action === 'continue') {
      resumeManagedTrainingQueue();
    } else if (action === 'open') {
      openTrainingWorkspaceFolder(event.target.getAttribute('data-training-folder'));
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
    if (logId) {
      showTrainingRunnerConsole(getTrainingRunnerJobById(logId));
      return;
    }
    var checkpoint = event.target.getAttribute('data-training-history-resume');
    if (checkpoint && checkpointSelect) {
      checkpointSelect.value = checkpoint;
      trainingWorkspaceState.resumeParentJobId = event.target.parentNode.parentNode.getAttribute('data-training-history-job') || '';
      syncManagedTrainingResumeUi();
      setStatus('Checkpoint selected for the next training job.');
    }
  };
  historyShowAllBtn.onclick = function () {
    trainingWorkspaceState.historyExpanded = !trainingWorkspaceState.historyExpanded;
    renderTrainingHistory();
  };
  tensorboardStartBtn.onclick = startTensorboard;
  tensorboardStopBtn.onclick = stopTensorboard;
}

function syncTrainingConsoleUi() {
  var consoleBtn = document.getElementById('training-console-btn');
  var runnerConsoleBtn = document.getElementById('training-runner-console-btn');
  var visible = isTrainingRunnerConsoleVisible();
  [consoleBtn, runnerConsoleBtn].forEach(function (button) {
    if (!button) return;
    button.classList.toggle('active', visible);
    button.setAttribute('aria-pressed', visible ? 'true' : 'false');
  });
}

function syncTrainingWorkspaceUi() {
  if (!isTrainingWorkspaceActive()) return;
  syncTrainingConsoleUi();
  refreshTrainingWorkspace();
  refreshTrainingRunnerStatus();
}

wireTrainingWorkspace();
