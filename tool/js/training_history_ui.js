// Recent runs, resume discovery, and output access.
function formatTrainingHistoryTime(value) {
  var seconds = Number(value || 0);
  if (!seconds) return '';
  return new Date(seconds * 1000).toLocaleString([], {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}

function formatTrainingHistoryClock(value) {
  var seconds = Number(value || 0);
  if (!seconds) return '';
  return new Date(seconds * 1000).toLocaleTimeString([], {
    hour: 'numeric', minute: '2-digit'
  });
}

function formatTrainingHistoryDay(value) {
  var seconds = Number(value || 0);
  if (!seconds) return '';
  return new Date(seconds * 1000).toLocaleDateString([], {
    year: 'numeric', month: 'short', day: 'numeric'
  });
}

function trainingHistoryMetric(label, value, title, buttonAttribute) {
  if (!value) return '';
  var valueHtml = buttonAttribute
    ? '<button type="button" class="training-history-metric-link" ' + buttonAttribute + (title ? ' title="' + escapeHtml(title) + '"' : '') + '>' + escapeHtml(value) + '</button>'
    : '<strong' + (title ? ' title="' + escapeHtml(title) + '"' : '') + '>' + escapeHtml(value) + '</strong>';
  return '<div class="training-history-metric"><span>' + escapeHtml(label) + '</span>' + valueHtml + '</div>';
}


function trainingHistoryTimestampKind(job) {
  if (Number(job && job.finishedAt || 0)) return 'Finished';
  if (Number(job && job.startedAt || 0)) return 'Started';
  return 'Queued';
}

function trainingHistoryFact(label, value, title) {
  if (!value) return '';
  return '<div class="training-history-fact"><span>' + escapeHtml(label) + '</span><strong' + (title ? ' title="' + escapeHtml(title) + '"' : '') + '>' + escapeHtml(value) + '</strong></div>';
}

function trainingHistoryCompactNumber(value) {
  var number = Number(value);
  if (!isFinite(number)) return '';
  if (number !== 0 && Math.abs(number) < .001) {
    return number.toExponential(1).replace('.0e', 'e').replace('e+', 'e');
  }
  return String(number);
}

function trainingHistoryRunSummary(job) {
  var summary = job && job.runSummary && typeof job.runSummary === 'object' ? job.runSummary : {};
  var parts = [];
  if (summary.lr !== undefined && summary.lr !== null) parts.push('LR ' + trainingHistoryCompactNumber(summary.lr));
  if (summary.dropout !== undefined && summary.dropout !== null) parts.push('dropout ' + trainingHistoryCompactNumber(summary.dropout));
  if (summary.shift !== undefined && summary.shift !== null) parts.push('shift ' + trainingHistoryCompactNumber(summary.shift));
  if (Number(summary.capturedItems || 0) > 0) parts.push(Math.round(Number(summary.capturedItems)).toLocaleString() + ' items');
  if (Number(summary.epochs || 0) > 0) parts.push(Math.round(Number(summary.epochs)).toLocaleString() + ' epochs');
  return parts.join(' · ');
}

function trainingHistoryRunDisplayName(job, profileLabel) {
  var name = String(job && job.runName || '').trim();
  if (name) return name;
  var sequence = String(job && job.sequence || '').trim();
  return sequence ? 'Run ' + sequence.replace(/^0+(?=\d)/, '') : profileLabel;
}

function trainingHistoryCheckpointLabel(artifact) {
  var parts = [];
  var tag = String(artifact && artifact.checkpointTag || '').trim();
  var epoch = Number(artifact && artifact.epoch);
  var steps = Number(artifact && artifact.steps);
  if (tag) parts.push(tag);
  if (isFinite(epoch) && epoch > 0) parts.push('epoch ' + Math.round(epoch).toLocaleString());
  if (isFinite(steps) && steps > 0) parts.push('step ' + Math.round(steps).toLocaleString());
  return parts.join(' · ');
}

function trainingHistoryActiveTimeLabel(job) {
  var metric = trainingWorkspaceState.historyMetrics[String(job && job.id || '')];
  var seconds = metric && Number(metric.activeTrainingSeconds);
  if (!isFinite(seconds) && job && job.activeTrainingTimingComplete === true) {
    seconds = Number(job.activeTrainingSeconds);
  }
  return isFinite(seconds) && seconds > 0 ? formatTrainingRunnerDuration(seconds) : '';
}

function trainingHistoryTimingEligible(job) {
  return ['completed', 'finished_early'].indexOf(String(job && job.status || '')) !== -1;
}

function loadTrainingHistoryMetrics(job) {
  var id = String(job && job.id || '');
  if (!id || !job.folder || !trainingHistoryTimingEligible(job) || trainingWorkspaceState.historyMetrics.hasOwnProperty(id) || trainingWorkspaceState.historyMetricRequests[id]) return;
  trainingWorkspaceState.historyMetricRequests[id] = true;
  fetch('/fs/training_history/job/metrics?folder=' + encodeURIComponent(job.folder) + '&jobId=' + encodeURIComponent(id))
    .then(function (response) { return response.json(); })
    .then(function (payload) {
      if (!payload.ok) throw new Error(payload.error || 'Could not load run metrics.');
      trainingWorkspaceState.historyMetrics[id] = payload.metrics || {};
      delete trainingWorkspaceState.historyMetricRequests[id];
      renderTrainingHistory();
    })
    .catch(function () {
      trainingWorkspaceState.historyMetrics[id] = {};
      delete trainingWorkspaceState.historyMetricRequests[id];
      renderTrainingHistory();
    });
}

function renderTrainingHistory() {
  var els = getTrainingWorkspaceEls();
  if (!els.historySummary || !els.historyList || !els.checkpointSelect) return;
  var history = trainingWorkspaceState.history || {};
  var archiveActive = trainingWorkspaceState.historyPrimaryTab === 'archive';
  if (els.historyTabs) Array.prototype.forEach.call(els.historyTabs.querySelectorAll('[data-training-history-tab]'), function (button) {
    var active = button.getAttribute('data-training-history-tab') === (archiveActive ? 'archive' : 'history');
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  if (els.historyList) els.historyList.classList.toggle('hidden', archiveActive);
  if (els.historySummary) els.historySummary.classList.toggle('hidden', archiveActive);
  if (els.archiveList) els.archiveList.classList.toggle('hidden', !archiveActive);
  if (els.archiveSummary) els.archiveSummary.classList.toggle('hidden', !archiveActive || !!(trainingWorkspaceState.archives || []).length);
  if (els.historyTools) els.historyTools.classList.toggle('hidden', archiveActive || trainingWorkspaceState.historyCollapsed);
  if (archiveActive) renderTrainingArchives();
  var searchText = String((els.historySearch && els.historySearch.value) || '').trim().toLowerCase();
  var scope = trainingWorkspaceState.historyViewScope === 'set' ? 'set' : 'all';
  var currentFolder = trainingWorkspaceState.entryMode === 'set' ? String(state.folder || '').trim() : '';
  if (!currentFolder) scope = 'all';
  if (els.historyScope) {
    els.historyScope.classList.toggle('hidden', !currentFolder);
    Array.prototype.forEach.call(els.historyScope.querySelectorAll('[data-training-history-scope]'), function (button) {
      var active = button.getAttribute('data-training-history-scope') === scope;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }
  var jobs = (history.jobs || []).filter(function (job) {
    if (scope === 'set' && String(job.folder || '') !== currentFolder) return false;
    if (!searchText) return true;
    var model = job.model && typeof job.model === 'object' ? job.model : {};
    var haystack = [
      job.folder, job.datasetTarget, job.profileId, job.mode, job.stages, job.status, job.modelLabel, model.label, model.source,
      job.runName, trainingHistoryRunSummary(job)
    ].join(' ').toLowerCase();
    return haystack.indexOf(searchText) !== -1;
  }).sort(function (a, b) {
    return Number(b.finishedAt || b.startedAt || b.createdAt || 0) - Number(a.finishedAt || a.startedAt || a.createdAt || 0);
  });
  var runs = Array.isArray(history.runs) ? history.runs : [];
  var latest = jobs.length ? jobs[0] : null;
  if (els.historyContent) els.historyContent.classList.toggle('hidden', trainingWorkspaceState.historyCollapsed);
  if (els.historyTools) els.historyTools.classList.toggle('hidden', archiveActive || trainingWorkspaceState.historyCollapsed);
  if (els.historyCollapseBtn) {
    els.historyCollapseBtn.textContent = 'Training' + (archiveActive ? ' · Archive' : (jobs.length ? ' · ' + jobs.length : ''));
    els.historyCollapseBtn.setAttribute('aria-expanded', trainingWorkspaceState.historyCollapsed ? 'false' : 'true');
  }
  els.historySummary.classList.toggle('hidden', archiveActive || !!latest);
  els.historySummary.textContent = latest ? '' : (scope === 'set'
    ? 'No completed or actionable training outcomes for this set yet.'
    : 'No completed or actionable training outcomes yet.');
  var visibleJobs = trainingWorkspaceState.historyExpanded ? jobs : jobs.slice(0, 2);
  visibleJobs.forEach(function (job) {
    loadTrainingHistoryMetrics(job);
  });
  els.historyList.innerHTML = visibleJobs.map(function (job) {
    var progress = job.progress && typeof job.progress === 'object' ? job.progress : {};
    var modelLabel = trainingModelLabel(job);
    if (job.model && typeof job.model === 'object') job.model.label = modelLabel;
    else job.modelLabel = modelLabel;
    var epoch = Number(progress.epoch);
    var epochs = Number(progress.epochs);
    var finalStep = Number(progress.step);
    var plannedSteps = Number(progress.plannedSteps);
    var learningRate = String(progress.lr || '').trim();
    var artifact = job.artifactSummary && typeof job.artifactSummary === 'object' ? job.artifactSummary : {};
    var hasStarted = Number(job.startedAt || 0) > 0;
    var hasFinished = Number(job.finishedAt || 0) > 0;
    var activeTime = trainingHistoryActiveTimeLabel(job);
    var timingError = hasFinished && !hasStarted ? 'Timing invariant error: terminal job has no start time.' : '';
    var timestamp = job.finishedAt || job.startedAt || job.createdAt;
    var timestampKind = trainingHistoryTimestampKind(job);
    var resumePath = String(job.outputRunPath || job.resumeCheckpoint || '');
    var resumeStage = String(job.resumeStage || job.stages || '');
    var canResume = job.status !== 'cancelled' && ['hi', 'lo', 'krea2', 'wan21', 'h3'].indexOf(resumeStage) !== -1 && !!(job.resumeFromCheckpoint || job.outputRunPath || job.outputRoot);
    var unavailable = [];
    if (job.sourceAvailable === false) unavailable.push('set');
    if (job.outputAvailable === false) unavailable.push('output');
    if (job.logAvailable === false) unavailable.push('log');
    var status = String(job.status || 'unknown');
    var metricPending = !!trainingWorkspaceState.historyMetricRequests[String(job.id || '')];
    var modelSourcePath = String(job.model && job.model.source || '');
    var modelSource = modelSourcePath.split(/[\\/]/).pop();
    var stageLabel = trainingStageLabel(job.stages || '');
    var profileLabel = modelLabel + (stageLabel && stageLabel.toLowerCase() !== modelLabel.toLowerCase() ? ' · ' + stageLabel : '');
    var runDisplayName = trainingHistoryRunDisplayName(job, profileLabel);
    var selectedEpoch = job.selectedEpoch && typeof job.selectedEpoch === 'object' ? job.selectedEpoch : null;
    var selectedEpochNumber = selectedEpoch ? Number(selectedEpoch.epoch) : NaN;
    var selectedEpochLabel = isFinite(selectedEpochNumber) && selectedEpochNumber > 0 ? 'Selected Epoch ' + Math.round(selectedEpochNumber).toLocaleString() : '';
    var checkpointLabel = trainingHistoryCheckpointLabel(artifact);
    var checkpointStage = String(job.stage || job.stages || '').toLowerCase();
    var canOpenCheckpointRun = !!(checkpointLabel && job.folder && job.outputRunPath && ['hi', 'lo', 'krea2', 'wan21', 'h3'].indexOf(checkpointStage) !== -1);
    var runDirectory = String(job.outputRunPath || '').trim();
    var runConfig = job.runSummary && typeof job.runSummary === 'object' ? job.runSummary : {};
    var capturedItems = Number(job.capturedItemCount || runConfig.capturedItems || 0);
    var startedAt = Number(job.startedAt || 0);
    var finishedAt = Number(job.finishedAt || 0);
    var startedDate = startedAt ? new Date(startedAt * 1000) : null;
    var finishedDate = finishedAt ? new Date(finishedAt * 1000) : null;
    var sameDay = !!(startedDate && finishedDate &&
      startedDate.getFullYear() === finishedDate.getFullYear() &&
      startedDate.getMonth() === finishedDate.getMonth() &&
      startedDate.getDate() === finishedDate.getDate());
    var timingLabel = '';
    if (startedAt && finishedAt) {
      timingLabel = sameDay
        ? formatTrainingHistoryDay(startedAt) + ' · ' + formatTrainingHistoryClock(startedAt) + ' → ' + formatTrainingHistoryClock(finishedAt)
        : formatTrainingHistoryTime(startedAt) + ' → ' + formatTrainingHistoryTime(finishedAt);
    } else if (startedAt) {
      timingLabel = 'Started ' + formatTrainingHistoryTime(startedAt);
    } else if (finishedAt) {
      timingLabel = 'Finished ' + formatTrainingHistoryTime(finishedAt);
    } else {
      timingLabel = formatTrainingHistoryTime(job.createdAt);
    }
    var timingTitle = [
      startedAt ? 'Started ' + formatTrainingHistoryTime(startedAt) : '',
      finishedAt ? 'Finished ' + formatTrainingHistoryTime(finishedAt) : ''
    ].filter(Boolean).join(' · ');
    var modelTitle = modelSource ? 'Base model: ' + modelSource : '';
    var metricHtml =
      trainingHistoryMetric('Epoch', isFinite(epoch) && epoch >= 0 ? Math.round(epoch).toLocaleString() + (isFinite(epochs) && epochs > 0 ? ' / ' + Math.round(epochs).toLocaleString() : '') : '') +
      trainingHistoryMetric('Step', isFinite(finalStep) && finalStep >= 0 ? Math.round(finalStep).toLocaleString() + (isFinite(plannedSteps) && plannedSteps > 0 ? ' / ' + Math.round(plannedSteps).toLocaleString() : '') : '') +
      trainingHistoryMetric('LR', learningRate) +
      trainingHistoryMetric('Shift', runConfig.shift !== undefined && runConfig.shift !== null ? trainingHistoryCompactNumber(runConfig.shift) : '') +
      trainingHistoryMetric('Dropout', runConfig.dropout !== undefined && runConfig.dropout !== null ? trainingHistoryCompactNumber(runConfig.dropout) : '') +
      trainingHistoryMetric('Selected epoch', selectedEpochLabel ? String(Math.round(selectedEpochNumber)) : '') +
      trainingHistoryMetric(
        'Latest checkpoint',
        checkpointLabel,
        canOpenCheckpointRun ? 'Open the run directory containing this checkpoint' : '',
        canOpenCheckpointRun ? 'data-training-history-run="' + escapeHtml(job.id || '') + '"' : ''
      );
    return '<div class="training-history-item training-history-run' + (selectedEpochLabel ? ' has-selected-epoch' : '') + '" data-training-history-job="' + escapeHtml(job.id || '') + '">' +
      '<div class="training-history-header">' +
        '<div class="training-history-identity">' +
          '<div class="training-history-title">' +
            (selectedEpochLabel ? '<span class="training-history-selected-mark" title="' + escapeHtml(selectedEpochLabel) + '" aria-label="' + escapeHtml(selectedEpochLabel) + '"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="6" r="3.5"></circle><path d="M5.5 9l-1 5 3.5-2 3.5 2-1-5"></path></svg></span>' : '') +
            '<strong class="training-history-run-name">' + escapeHtml(runDisplayName) + '</strong>' +
            '<span class="training-history-status training-history-status--' + escapeHtml(status) + '">' + escapeHtml(trainingRunnerStatusLabel(status)) + '</span>' +
            '<span class="training-history-stage"' + (modelTitle ? ' title="' + escapeHtml(modelTitle) + '"' : '') + '>' + escapeHtml(trainingStageLabel(job.stages || '')) + '</span>' +
          '</div>' +
          '<div class="training-history-meta">' +
            (timingLabel ? '<span class="training-history-timing"' + (timingTitle ? ' title="' + escapeHtml(timingTitle) + '"' : '') + '>' + escapeHtml(timingLabel) + '</span>' : '') +
            (activeTime ? '<span class="training-history-active-time" title="Active training time">' + escapeHtml(activeTime) + ' active</span>' : (metricPending ? '<span class="training-history-active-time">Loading active time…</span>' : '')) +
            (capturedItems > 0 ? '<span class="training-history-items" title="Captured training items">' + escapeHtml(capturedItems.toLocaleString()) + ' items</span>' : '') +
            (job.folder ? '<button type="button" class="training-history-folder" data-training-open-folder="' + escapeHtml(job.folder || '') + '" title="Open set: ' + escapeHtml(job.folder || '') + '">' + escapeHtml(job.folder || '') + '</button>' : '') +
          '</div>' +
        '</div>' +
        '<div class="training-history-actions">' +
          (selectedEpochLabel ? '<button type="button" class="training-btn training-history-finalize" data-training-history-finalize="' + escapeHtml(job.id || '') + '">Archive</button>' : '') +
          (job.logAvailable !== false ? '<button type="button" class="training-history-action" data-training-history-log="' + escapeHtml(job.id || '') + '" title="Show run log" aria-label="Show run log">&#128196;</button>' : '') +
          (job.candidateRunAvailable ? '<button type="button" class="training-history-action" data-training-history-candidates="' + escapeHtml(job.id || '') + '" title="Analyze LoRA candidates" aria-label="Analyze LoRA candidates">&#128200;</button>' : '') +
          (canResume ? '<button type="button" class="training-history-action" data-training-history-resume="' + escapeHtml(job.id || '') + '" title="Continue captured run" aria-label="Continue captured run">&#8635;</button>' : '') +
          '<details class="training-history-more"><summary class="training-history-action" title="More run actions" aria-label="More run actions">&#8230;</summary><div class="training-history-more-menu">' +
            (job.folder && job.outputRoot && job.outputAvailable !== false ? '<button type="button" data-training-history-output="' + escapeHtml(job.id || '') + '">&#128193; Open output</button>' : '') +
            (job.actionAvailable !== false && job.actionPath ? '<button type="button" data-training-history-action="' + escapeHtml(job.id || '') + '">&#128451; Open action folder</button>' : '') +
            '<button type="button" data-training-history-clear="' + escapeHtml(job.id || '') + '">Remove from Training History</button>' +
          '</div></details>' +
        '</div>' +
      '</div>' +
      (metricHtml ? '<div class="training-history-metrics">' + metricHtml + '</div>' : '') +
      (timingError ? '<div class="training-runner-detail is-error">' + escapeHtml(timingError) + '</div>' : '') +
      (job.error ? '<div class="training-runner-detail is-error">' + escapeHtml(job.error) + '</div>' : '') +
      buildTrainingFailureDetailsHtml(job) +
      (job.completionNote ? '<div class="training-runner-detail is-warning">' + escapeHtml(job.completionNote) + '</div>' : '') +
      (unavailable.length ? '<div class="training-runner-detail is-warning">Unavailable: ' + escapeHtml(unavailable.join(', ')) + '</div>' : '') +
      '</div>';
  }).join('');
  if (els.historyShowAllBtn) {
    els.historyShowAllBtn.classList.toggle('hidden', archiveActive || jobs.length <= 2);
    els.historyShowAllBtn.textContent = trainingWorkspaceState.historyExpanded ? 'Show less' : 'Show all (' + jobs.length + ')';
  }
  var selectedCheckpoint = String(els.checkpointSelect.value || '');
  var resumeStage = String(trainingWorkspaceState.runStages || '');
  runs = runs.filter(function (run) { return String(run.candidateFor || run.stage || '') === resumeStage; });
  var checkpointPrompt = trainingWorkspaceState.historyRunsLoading
    ? 'Loading current-set checkpoints…'
    : (runs.length ? 'Choose a managed checkpoint…' : 'No managed checkpoints for this set');
  var currentOptions = runs.map(function (run) {
    var details = [];
    if (run.epoch && run.expectedEpochs) details.push('epoch ' + run.epoch + ' / ' + run.expectedEpochs);
    var matchLabel = run.matchType === 'exact' ? 'exact' : 'compatible';
    var optionValue = String(run.resumeOutputId || run.runPath || '');
    return '<option value="' + escapeHtml(optionValue) + '" data-action-id="' + escapeHtml(run.resumeActionId || '') + '" data-output-id="' + escapeHtml(run.resumeOutputId || '') + '" data-run-path="' + escapeHtml(run.runPath || '') + '">' +
      escapeHtml(String(run.runName || run.logicalRun || run.name || 'run') + ' - ' + trainingStageLabel(run.stage) +
        (details.length ? ' - ' + details.join(' / ') : '') + ' - ' + matchLabel) + '</option>';
  }).join('');
  var previousOptions = [];
  runs.forEach(function (run) {
    (Array.isArray(run.resumePoints) ? run.resumePoints : []).forEach(function (point) {
      var optionValue = String(run.resumeOutputId || run.runPath || '') + '::' + String(point.tag || '');
      previousOptions.push(
        '<option value="' + escapeHtml(optionValue) + '" data-action-id="' + escapeHtml(run.resumeActionId || '') + '" data-output-id="' + escapeHtml(run.resumeOutputId || '') + '" data-run-path="' + escapeHtml(run.runPath || '') + '" data-checkpoint-tag="' + escapeHtml(point.tag || '') + '">' +
        escapeHtml(String(run.runName || run.logicalRun || run.name || 'run') + ' - ' + String(point.tag || '')) + '</option>'
      );
    });
  });
  els.checkpointSelect.innerHTML = '<option value="">' + checkpointPrompt + '</option>' +
    currentOptions +
    (previousOptions.length ? '<optgroup label="Previous saved resumable points">' + previousOptions.join('') + '</optgroup>' : '');
  if (selectedCheckpoint && Array.prototype.some.call(els.checkpointSelect.options, function (option) { return option.value === selectedCheckpoint; })) {
    els.checkpointSelect.value = selectedCheckpoint;
  }
  syncManagedTrainingResumeUi();
}

function trainingArchiveLossValue(value) {
  var number = Number(value);
  if (!isFinite(number)) return '';
  if (number !== 0 && Math.abs(number) < .0001) return number.toExponential(2);
  return number.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function trainingArchivePercent(value, signed) {
  var number = Number(value);
  if (!isFinite(number)) return '';
  if (Math.abs(number) < .05) number = 0;
  return (signed && number > 0 ? '+' : '') + number.toFixed(1) + '%';
}

function trainingArchiveDuration(value) {
  var seconds = Number(value);
  return isFinite(seconds) && seconds >= 0 ? formatTrainingRunnerDuration(Math.round(seconds)) : '';
}

function trainingArchiveMetricFact(label, value, title) {
  if (value === '' || value === null || value === undefined) return '';
  return '<div class="training-archive-metric"><span>' + escapeHtml(label) + '</span><strong' +
    (title ? ' title="' + escapeHtml(title) + '"' : '') + '>' + escapeHtml(String(value)) + '</strong></div>';
}

function trainingArchiveLossChart(metrics) {
  var points = (Array.isArray(metrics && metrics.epochLossPoints) ? metrics.epochLossPoints : []).map(function (point) {
    return { epoch: Number(point.epoch), loss: Number(point.loss) };
  }).filter(function (point) {
    return isFinite(point.epoch) && isFinite(point.loss);
  }).sort(function (a, b) {
    return a.epoch - b.epoch;
  });
  if (!points.length) return '';

  var width = 520;
  var top = 9;
  var bottom = 63;
  var left = 12;
  var right = width - 12;
  var minEpoch = points[0].epoch;
  var maxEpoch = points[points.length - 1].epoch;
  var losses = points.map(function (point) { return point.loss; });
  var minLoss = Math.min.apply(Math, losses);
  var maxLoss = Math.max.apply(Math, losses);
  var xFor = function (epoch) {
    return minEpoch === maxEpoch ? width / 2 : left + ((epoch - minEpoch) / (maxEpoch - minEpoch)) * (right - left);
  };
  var yFor = function (loss) {
    return minLoss === maxLoss ? (top + bottom) / 2 : top + ((maxLoss - loss) / (maxLoss - minLoss)) * (bottom - top);
  };
  var path = points.map(function (point, index) {
    return (index ? 'L' : 'M') + xFor(point.epoch).toFixed(2) + ' ' + yFor(point.loss).toFixed(2);
  }).join(' ');

  var selectedEpoch = Number(metrics.selectedEpoch);
  var saved = {};
  (Array.isArray(metrics.savedEpochs) ? metrics.savedEpochs : []).forEach(function (epoch) {
    var number = Number(epoch);
    if (isFinite(number)) saved[number] = true;
  });
  var markers = points.filter(function (point) {
    return saved[point.epoch];
  }).map(function (point) {
    var selected = point.epoch === selectedEpoch;
    var title = (selected ? 'Selected epoch ' : 'Retained epoch ') + point.epoch + ' · loss ' + trainingArchiveLossValue(point.loss);
    return '<circle class="training-archive-loss-marker' + (selected ? ' is-selected' : '') + '" cx="' +
      xFor(point.epoch).toFixed(2) + '" cy="' + yFor(point.loss).toFixed(2) + '" r="' + (selected ? '4' : '2.8') + '">' +
      '<title>' + escapeHtml(title) + '</title></circle>';
  }).join('');

  return '<div class="training-archive-loss-chart">' +
    '<div class="training-archive-loss-chart-title">Epoch loss curve</div>' +
    '<svg viewBox="0 0 ' + width + ' 72" role="img" aria-label="' +
      escapeHtml('Epoch loss curve with selected epoch ' + selectedEpoch + ' highlighted') + '">' +
      '<line class="training-archive-loss-guide" x1="' + left + '" y1="' + bottom + '" x2="' + right + '" y2="' + bottom + '"></line>' +
      '<path class="training-archive-loss-line" d="' + path + '"></path>' +
      markers +
    '</svg>' +
    '<div class="training-archive-loss-axis"><span>Epoch ' + escapeHtml(String(minEpoch)) + '</span>' +
      '<span>Selected ' + escapeHtml(String(selectedEpoch)) + '</span>' +
      '<span>Epoch ' + escapeHtml(String(maxEpoch)) + '</span></div>' +
  '</div>';
}

function trainingArchiveAnalysisHtml(metrics, pending) {
  if (pending && !metrics) {
    return '<div class="training-archive-analysis"><div class="training-history-summary">Loading TensorBoard metrics…</div></div>';
  }
  if (!metrics) return '';
  if (metrics.error) {
    return '<div class="training-archive-analysis"><div class="training-runner-detail is-error">' +
      escapeHtml(metrics.error) + '</div></div>';
  }

  var selectedEpoch = Number(metrics.selectedEpoch);
  var startingEpoch = Number(metrics.startingEpoch);
  var comparisonEpoch = Number(metrics.recentComparisonEpoch);
  var recentWindow = Number(metrics.recentWindowEpochs);
  var reductionTitle = isFinite(startingEpoch)
    ? 'Epoch ' + startingEpoch + ' loss ' + trainingArchiveLossValue(metrics.startingLoss) +
      ' → epoch ' + selectedEpoch + ' loss ' + trainingArchiveLossValue(metrics.epochLoss)
    : '';
  var recentTitle = isFinite(comparisonEpoch)
    ? 'Compared with epoch ' + comparisonEpoch + ' loss ' + trainingArchiveLossValue(metrics.recentComparisonLoss)
    : '';
  var facts =
    trainingArchiveMetricFact('Selected step', isFinite(Number(metrics.step)) ? Math.round(Number(metrics.step)).toLocaleString() : '') +
    trainingArchiveMetricFact('Epoch steps',
      isFinite(Number(metrics.stepStart)) && isFinite(Number(metrics.stepEnd))
        ? Math.round(Number(metrics.stepStart)).toLocaleString() + '–' + Math.round(Number(metrics.stepEnd)).toLocaleString()
        : '') +
    trainingArchiveMetricFact('Elapsed to selected', trainingArchiveDuration(metrics.trainingSecondsToSelected), 'TensorBoard wall time from the first recorded scalar to the selected epoch.') +
    trainingArchiveMetricFact('Epoch elapsed', trainingArchiveDuration(metrics.selectedEpochSeconds), 'TensorBoard wall time since the previous completed epoch.') +
    trainingArchiveMetricFact('Epoch loss', trainingArchiveLossValue(metrics.epochLoss)) +
    trainingArchiveMetricFact('Smoothed loss', trainingArchiveLossValue(metrics.smoothedLoss), 'Existing display smoothing over detailed train/loss samples near the selected epoch.') +
    trainingArchiveMetricFact('Loss reduction', trainingArchivePercent(metrics.lossReductionPercent, false), reductionTitle) +
    (isFinite(recentWindow) && recentWindow > 0
      ? trainingArchiveMetricFact(Math.round(recentWindow) + '-epoch change', trainingArchivePercent(metrics.recentLossChangePercent, true), recentTitle)
      : '');

  return '<div class="training-archive-analysis">' +
    '<div class="training-archive-metrics">' + facts + '</div>' +
    trainingArchiveLossChart(metrics) +
  '</div>';
}

function loadTrainingArchiveMetrics(archive) {
  var name = String(archive && archive.name || '').trim();
  if (!name) throw new Error('Archived training run has no archive name.');
  if (Object.prototype.hasOwnProperty.call(trainingWorkspaceState.archiveMetrics, name)) {
    return Promise.resolve(trainingWorkspaceState.archiveMetrics[name]);
  }
  if (trainingWorkspaceState.archiveMetricRequests[name]) return Promise.resolve(null);
  trainingWorkspaceState.archiveMetricRequests[name] = true;
  return trainingRunnerRequest('/fs/training_archive/metrics?name=' + encodeURIComponent(name))
    .then(function (payload) {
      trainingWorkspaceState.archiveMetrics[name] = payload.metrics || {};
      return trainingWorkspaceState.archiveMetrics[name];
    })
    .catch(function (err) {
      var message = String(err && err.message ? err.message : err);
      trainingWorkspaceState.archiveMetrics[name] = { error: message };
      reportConsoleError('Training Archive', message);
      return trainingWorkspaceState.archiveMetrics[name];
    })
    .then(function (metrics) {
      delete trainingWorkspaceState.archiveMetricRequests[name];
      renderTrainingArchives();
      return metrics;
    });
}

function loadTrainingArchives(force) {
  if (!force && trainingWorkspaceState.archivesLoaded) return Promise.resolve(trainingWorkspaceState.archives || []);
  return trainingRunnerRequest('/fs/training_archive').then(function (payload) {
    trainingWorkspaceState.archives = Array.isArray(payload.archives) ? payload.archives : [];
    trainingWorkspaceState.archivesLoaded = true;
    renderTrainingHistory();
    return trainingWorkspaceState.archives;
  });
}

function renderTrainingArchives() {
  var els = getTrainingWorkspaceEls();
  if (!els.archiveList) return;
  var rows = Array.isArray(trainingWorkspaceState.archives) ? trainingWorkspaceState.archives : [];
  if (els.archiveSummary) {
    els.archiveSummary.textContent = rows.length ? '' : 'No archived training runs yet.';
    els.archiveSummary.classList.toggle('hidden', !!rows.length || trainingWorkspaceState.historyPrimaryTab !== 'archive');
  }
  els.archiveList.innerHTML = rows.map(function (archive) {
    if (archive.invalid) {
      return '<div class="training-history-item is-error">' +
        '<div class="training-history-primary"><strong>Archive issue</strong></div>' +
        '<div class="training-history-context"><div class="training-history-model">' + escapeHtml(archive.name || 'Unknown archive') + '</div></div>' +
        '<div class="training-history-details"><div>' + escapeHtml(archive.error || 'Archive metadata is invalid.') + '</div></div>' +
      '</div>';
    }
    var summary = archive.runSummary && typeof archive.runSummary === 'object' ? archive.runSummary : {};
    var settings = [];
    if (summary.lr !== undefined) settings.push('LR ' + summary.lr);
    if (summary.dropout !== undefined) settings.push('dropout ' + summary.dropout);
    if (summary.shift !== undefined) settings.push('shift ' + summary.shift);
    var alternates = Array.isArray(archive.retainedAlternateEpochs) ? archive.retainedAlternateEpochs : [];
    var archiveName = String(archive.name || '');
    var detailsOpen = !!trainingWorkspaceState.archiveDetailOpen[archiveName];
    if (
      detailsOpen &&
      !Object.prototype.hasOwnProperty.call(trainingWorkspaceState.archiveMetrics, archiveName) &&
      !trainingWorkspaceState.archiveMetricRequests[archiveName]
    ) {
      loadTrainingArchiveMetrics(archive);
    }
    var metrics = Object.prototype.hasOwnProperty.call(trainingWorkspaceState.archiveMetrics, archiveName)
      ? trainingWorkspaceState.archiveMetrics[archiveName]
      : null;
    var metricPending = !!trainingWorkspaceState.archiveMetricRequests[archiveName];
    return '<div class="training-history-item has-selected-epoch">' +
      '<div class="training-history-primary"><strong>Archived</strong><span class="training-history-time">' + escapeHtml(formatTrainingHistoryTime(archive.archivedAt)) + '</span></div>' +
      '<div class="training-history-context"><div class="training-history-model">' + escapeHtml(archive.runName || archive.name) + '</div><div class="training-history-set">' + escapeHtml(archive.sourceFolder || '') + '</div></div>' +
      '<div class="training-history-details"><div>Selected Epoch ' + escapeHtml(String(archive.selectedEpoch || '')) +
        (alternates.length ? ' · backups ' + escapeHtml(alternates.join(', ')) : '') + '</div>' +
        (settings.length ? '<div>' + escapeHtml(settings.join(' · ')) + '</div>' : '') +
        '<div>' + escapeHtml(archive.productionFileName || '') + '</div>' +
        '<button type="button" class="training-history-details-toggle" data-training-archive-details="' + escapeHtml(archiveName) + '" title="' +
          (detailsOpen ? 'Hide selected epoch metrics' : 'Show selected epoch metrics') + '" aria-label="' +
          (detailsOpen ? 'Hide selected epoch metrics' : 'Show selected epoch metrics') + '" aria-expanded="' +
          (detailsOpen ? 'true' : 'false') + '">' + (detailsOpen ? '&#9652;' : '&#9662;') + '</button>' +
      '</div>' +
      (detailsOpen ? trainingArchiveAnalysisHtml(metrics, metricPending) : '') +
      '</div>';
  }).join('');
}

function closeTrainingArchiveModal() {
  var els = getTrainingWorkspaceEls();
  trainingWorkspaceState.archivePreview = null;
  trainingWorkspaceState.archiveJobId = '';
  els.archiveModal.classList.add('hidden');
  els.archiveModal.setAttribute('aria-hidden', 'true');
}

function openTrainingArchiveModal(jobContext) {
  var jobs = trainingWorkspaceState.history && Array.isArray(trainingWorkspaceState.history.jobs) ? trainingWorkspaceState.history.jobs : [];
  var job = jobContext && typeof jobContext === 'object'
    ? jobContext
    : jobs.filter(function (item) { return String(item.id || '') === String(jobContext || ''); })[0];
  var jobId = String(job && (job.id || job.jobId) || '');
  var stagedFileName = String(job && job.stagedFileName || '');
  var stage = String(job && job.stage || '');
  if (!job || !job.folder || (!jobId && !(stagedFileName && stage))) throw new Error('Training run does not identify its archive source.');
  var archiveQuery = '/fs/training_archive/preview?folder=' + encodeURIComponent(job.folder);
  archiveQuery += stagedFileName
    ? '&stage=' + encodeURIComponent(stage) + '&stagedFileName=' + encodeURIComponent(stagedFileName)
    : '&jobId=' + encodeURIComponent(jobId);
  trainingRunnerRequest(archiveQuery)
    .then(function (payload) {
      var preview = payload.preview;
      var els = getTrainingWorkspaceEls();
      trainingWorkspaceState.archivePreview = preview;
      trainingWorkspaceState.archiveJobId = String(preview.jobId || jobId || '');
      els.archiveName.value = String(preview.archiveName || '');
      els.archiveRecap.innerHTML =
        '<div><strong>Production keeper:</strong> Epoch ' + escapeHtml(String(preview.selectedEpoch && preview.selectedEpoch.epoch || '')) + ' · ' + escapeHtml(preview.productionFileName || '') + '</div>' +
        '<div><strong>Training cleanup:</strong> ' + escapeHtml(String(preview.epochCount || 0)) + ' epoch folders · ' + escapeHtml(String(preview.globalStepCount || 0)) + ' global-step folders</div>' +
        '<div><strong>Test cleanup:</strong> ' + escapeHtml(String(preview.stagedCandidateCount || 0)) + ' staged candidate(s) · ' + escapeHtml(String(preview.testSessionCount || 0)) + ' session(s) will be cleared.</div>' +
        '<div><strong>Related runs:</strong> ' + escapeHtml(String(preview.relatedRunCount || 0)) + (preview.siblingOutputCount ? ' · ' + escapeHtml(String(preview.siblingOutputCount)) + ' sibling output(s) remain' : ' · this is the last managed output') + '</div>';
      var alternateCandidates = Array.isArray(preview.availableAlternateCandidates) ? preview.availableAlternateCandidates : [];
      els.archiveAlternates.innerHTML = alternateCandidates.length
        ? alternateCandidates.map(function (candidate) {
            return '<label class="training-archive-alternate"><input type="checkbox" value="' + escapeHtml(String(candidate.epoch)) + '">' +
              '<span>Epoch ' + escapeHtml(String(candidate.epoch)) + '</span>' +
              '<small>' + escapeHtml(candidate.fileName || '') + '</small></label>';
          }).join('')
        : '<div class="training-history-summary">No staged candidate LoRAs available to retain.</div>';
      els.archiveModal.classList.remove('hidden');
      els.archiveModal.setAttribute('aria-hidden', 'false');
    })
    .catch(function (err) {
      setStatus('Could not prepare Finalize & Archive: ' + String(err.message || err));
      throw err;
    });
}

function finalizeTrainingArchive() {
  var els = getTrainingWorkspaceEls();
  var preview = trainingWorkspaceState.archivePreview;
  if (!preview) throw new Error('Archive preview is unavailable.');
  var retainEpochs = Array.prototype.map.call(els.archiveAlternates.querySelectorAll('input[type="checkbox"]:checked'), function (input) {
    return Number(input.value);
  });
  els.archiveModalConfirm.disabled = true;
  trainingRunnerRequest('/fs/training_archive/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({
      folder: preview.folder,
      archiveName: String(els.archiveName.value || '').trim(),
      retainEpochs: retainEpochs
    }, preview.stagedFileName ? {
      stage: preview.stage,
      stagedFileName: preview.stagedFileName
    } : {
      jobId: preview.jobId
    }))
  }).then(function (payload) {
    closeTrainingArchiveModal();
    trainingWorkspaceState.archivesLoaded = false;
    var archive = payload.archive || {};
    var archiveName = String(archive.archiveName || '');
    if (
      archive.lastTrainingArchive &&
      typeof state === 'object' &&
      state &&
      String(state.folder || '') === String(preview.folder || '')
    ) {
      state.lastTrainingArchive = JSON.parse(JSON.stringify(archive.lastTrainingArchive));
    }
    window.dispatchEvent(new CustomEvent('webcap:training-archived', {
      detail: {
        folder: String(preview.folder || ''),
        jobId: String(preview.jobId || ''),
        archive: archive
      }
    }));
    if (!archive.testCleanupWarning) {
      window.dispatchEvent(new CustomEvent('webcap:test-sessions-cleared', {
        detail: { folder: String(preview.folder || '') }
      }));
    }
    var notices = [];
    if (archive.testCleanupWarning) notices.push('Test sessions were not fully cleared: ' + String(archive.testCleanupWarning));
    setStatus(
      'Finalized and archived ' + archiveName + '.' +
      (notices.length ? ' ' + notices.join(' · ') : '')
    );
    return refreshTrainingHistory(true).then(function () {
      return loadTrainingArchives(true);
    }).catch(function (err) {
      setStatus('Finalized and archived, but Archive refresh failed: ' + String(err.message || err));
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Training Archive', String(err.message || err));
    });
  }, function (err) {
    els.archiveModalConfirm.disabled = false;
    setStatus('Finalize & Archive failed: ' + String(err.message || err));
    throw err;
  });
}

function clearTrainingHistory() {
  if (!window.confirm('Clear all Training History? Output files, logs, and checkpoints will remain.')) return;
  trainingRunnerRequest('/fs/training_history/clear', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
  }).then(function () {
    setStatus('Training History cleared. Training files were kept.');
    refreshTrainingHistory(true);
  }).catch(function (err) {
    setStatus('Could not clear Training History: ' + String(err.message || err));
  });
}

function clearTrainingHistoryJob(jobId) {
  var jobs = trainingWorkspaceState.history && Array.isArray(trainingWorkspaceState.history.jobs)
    ? trainingWorkspaceState.history.jobs : [];
  var job = jobs.filter(function (item) { return item.id === jobId; })[0];
  if (!job || !job.folder) throw new Error('Training History entry does not identify its set folder.');
  trainingRunnerRequest('/fs/training_history/job/clear', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: job.folder, jobId: jobId })
  }).then(function (payload) {
    if (!payload.cleared) throw new Error('Training History entry was not found.');
    setStatus('Removed the run from Training History. Training files were kept.');
    refreshTrainingHistory(true);
  }).catch(function (err) {
    setStatus('Could not remove Training History entry: ' + String(err.message || err));
  });
}

function resumeTrainingHistoryJob(jobId) {
  var jobs = trainingWorkspaceState.history && Array.isArray(trainingWorkspaceState.history.jobs)
    ? trainingWorkspaceState.history.jobs : [];
  var job = jobs.filter(function (item) { return item.id === jobId; })[0];
  var resumeStage = String(job && (job.resumeStage || job.stages) || '');
  var resumePath = String(job && (job.resumeFromCheckpoint || job.outputRunPath || job.outputRoot) || '').trim();
  if (!job || !job.folder || !resumePath || ['hi', 'lo', 'krea2', 'wan21', 'h3'].indexOf(resumeStage) === -1) {
    throw new Error('This historical run no longer has a resumable checkpoint.');
  }
  if (!job.actionId || !job.inputPath) {
    throw new Error('This Training History run has no recorded capture. Use Resume from checkpoint in Run Setup if you want to create a new capture.');
  }
  trainingRunnerRequest('/fs/training_runner/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folder: job.folder,
      queue: true,
      stages: resumeStage,
      resumeStage: resumeStage,
      resumeFromCheckpoint: resumePath,
      profileId: job.profileId || '',
      runId: job.runId || '',
      mode: job.mode || 'normal',
      reuseCaptureActionId: job.actionId,
      reuseCapturePath: job.inputPath
    })
  }).then(function (payload) {
    trainingWorkspaceState.runnerSelectedJobId = payload.job.id;
    trainingWorkspaceState.runnerLogOffsets[payload.job.id] = 0;
    setStatus(payload.queued ? 'Captured run queued to continue.' : 'Captured run continuing.');
    refreshTrainingRunnerStatus();
    refreshTrainingHistory();
  }).catch(function (err) {
    setStatus('Could not continue captured run: ' + String(err && err.message ? err.message : err));
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

function openTrainingHistoryRun(folder, stage, path) {
  trainingRunnerRequest('/fs/training_history/open_run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: String(folder || ''), modelId: String(stage || ''), path: String(path || '') })
  }).then(function () {
    setStatus('Opened checkpoint run directory.');
  }).catch(function (err) {
    setStatus('Could not open checkpoint run directory: ' + String(err && err.message ? err.message : err));
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

function openTrainingJobAction(jobId, folder) {
  trainingRunnerRequest('/fs/training_runner/open_action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: String(jobId || ''), folder: String(folder || state.folder || '') })
  }).then(function () {
    setStatus('Opened training action folder.');
  }).catch(function (err) {
    setStatus('Could not open training action folder: ' + String(err && err.message ? err.message : err));
  });
}


function trainingHistoryScopeFolder() {
  return trainingWorkspaceState.entryMode === 'set' ? String(state.folder || '').trim() : '';
}

function syncTrainingHistorySearchScope() {
  var folder = trainingHistoryScopeFolder();
  var priorFolder = trainingWorkspaceState.historySearchScopeFolder;
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
      if (typeof window.syncApplicationRecentSetsFromJobs === 'function') {
        window.syncApplicationRecentSetsFromJobs(
          trainingWorkspaceState.history && Array.isArray(trainingWorkspaceState.history.jobs)
            ? trainingWorkspaceState.history.jobs
            : []
        );
      }
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
      trainingWorkspaceState.historyRunsLoading = true;
      renderTrainingHistory();
      return fetch('/fs/training_history?folder=' + encodeURIComponent(folder)).then(function (response) { return response.json(); }).then(function (setPayload) {
        if (!setPayload.ok) throw new Error(setPayload.error || 'Could not load resumable runs.');
        if (trainingWorkspaceState.history && trainingHistoryScopeFolder() === folder) {
          trainingWorkspaceState.history.runs = (setPayload.history || {}).runs || [];
          trainingWorkspaceState.history.resumeDefaults = (setPayload.history || {}).resumeDefaults || {};
          trainingWorkspaceState.historyRunsLoading = false;
          renderTrainingHistory();
        }
      });
    })
    .catch(function (err) {
      trainingWorkspaceState.historyRunsLoading = false;
      renderTrainingHistory();
      setStatus('Could not load training history: ' + String(err.message || err));
    });
}
