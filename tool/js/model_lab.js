/* Single Model Assessment worker adapter. Historical specialist panels were retired. */
var modelLabState = {
  loaded: false, polling: 0, models: {visions: [], directors: []},
  runs: [], run: null, progressRunId: '', errorRunId: '', reportedErrors: new Set()
};

function modelLabRequest(url, options) {
  return fetch(url, options || {}).then(function (response) {
    return response.json().then(function (payload) {
      if (!response.ok || !payload || payload.ok === false) {
        throw new Error(payload && payload.error ? payload.error : 'Model Lab request failed.');
      }
      return payload;
    });
  });
}

function modelLabPost(payload) {
  return modelLabRequest('/app/model-lab', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
}

function modelLabCurrentFiles() {
  return (state && Array.isArray(state.items) ? state.items : []).map(function (item) {
    return String(item && (item.fileName || item.name) || '').trim();
  }).filter(Boolean);
}

function modelLabGroups() {
  return (Array.isArray(checklistItems) ? checklistItems : []).map(function (group) {
    return {
      group: String(group || '').trim(),
      terms: getChecklistKeywordTermsForRequirement(group)
    };
  }).filter(function (row) {
    return !!row.group;
  });
}

function modelLabAttemptLabel(kind) {
  var labels = {
    director_writing: 'Writing',
    vision_open: 'Open Vision',
    vision_group_aware: 'Group-aware Vision',
    language_synthesis: 'Language synthesis',
    language_challenge: 'Language challenge',
    set_vocabulary_synthesis: 'Set vocabulary synthesis',
    set_vocabulary_challenge: 'Set vocabulary challenge'
  };
  if (labels[kind]) return labels[kind];
  if (String(kind || '').indexOf('director_scene_plan_') === 0) return 'Storyboard JSON · ' + kind.split('_').pop() + ' tokens';
  if (String(kind || '').indexOf('vision:') === 0) {
    return String(kind).endsWith('_challenge') ? 'Vision vocabulary challenge' : 'Vision vocabulary synthesis';
  }
  return String(kind || '').replace(/_/g, ' ');
}

function modelLabRunProgress(run) {
  var work = run && run.work;
  if (work && Number(work.planned) > 0) {
    var bits = [
      Number(work.completed) + '/' + Number(work.planned) + ' completed',
      Number(work.remaining) + ' remaining'
    ];
    if (work.reused) bits.push(work.reused + ' reused');
    if (work.skipped) bits.push(work.skipped + ' skipped');
    if (work.deferred) bits.push(work.deferred + ' retry pending');
    if (work.failed) bits.push(work.failed + ' failed');
    return bits.join(' · ');
  }
  // Historical runs without a frozen assessment protocol have no provable total.
  var summary = run && run.summary || {};
  var bits = [Number(summary.completed || 0) + ' completed'];
  if (summary.failed) bits.push(summary.failed + ' failed');
  if (summary.skipped) bits.push(summary.skipped + ' skipped');
  if (summary.interrupted) bits.push(summary.interrupted + ' interrupted');
  return bits.join(' · ');
}

function modelLabProgressSnapshot(run) {
  var progress = run.progress || {};
  var attempts = Array.isArray(run.attempts) ? run.attempts : [];
  var current = attempts.find(function (attempt) { return attempt.status === 'running'; });
  var start = Date.parse(run.startedAt || '');
  var finish = Date.parse(run.finishedAt || '');
  var status = String(run.status || '');
  var models = (run.allVisionModels || []).concat(run.allDirectorModels || []);
  var currentRef = String(current && current.modelRef || progress.currentModelRef || '');
  var model = models.find(function (candidate) { return String(candidate.modelRef || '') === currentRef; });
  var modelName = model ? String(model.label || model.modelId || currentRef) : currentRef;
  var jobState = String(progress.executionStatus || '');
  var execution = {
    submitting: 'Submitting', queued: 'Queued', starting: 'Starting',
    running: 'Running', completed: 'Finishing', stopping: 'Stopping'
  }[jobState] || (jobState ? jobState.charAt(0).toUpperCase() + jobState.slice(1) : 'Running');
  var phase = '';
  if (status === 'running' && current) {
    phase = [
      progress.phase === 'retry' ? 'Retry' : (current.role === 'vision' ? 'Vision' : 'Director'),
      modelLabAttemptLabel(current.kind),
      execution
    ].join(' · ');
  } else if (status === 'running') {
    phase = progress.phase === 'retry' ? 'Preparing deferred retries' :
      progress.phase === 'starting' ? 'Preparing assessment' : 'Preparing next probe';
  } else {
    phase = status === 'completed' && run.work && run.work.remaining
      ? 'Finished · ' + run.work.remaining + ' probes unresolved'
      : status.charAt(0).toUpperCase() + status.slice(1);
  }
  var work = run.work;
  var planned = work && Number(work.planned);
  var resolved = work && Number(work.resolved);
  var determinate = work && planned > 0 && isFinite(resolved) && resolved >= 0 && resolved <= planned;
  return {
    id: 'model-lab:' + String(run.id), kind: 'model-lab', title: 'Model Assessment',
    status: status === 'error' ? 'failed' : status,
    phase: phase,
    detail: run.error || (current ? [modelName, current.file].filter(Boolean).join(' · ') : ''),
    progressLabel: modelLabRunProgress(run),
    progress: determinate ? {
      completed: resolved, total: planned,
      description: 'Resolved planned tests, including reused, skipped and final failed probes. Not a pass rate or ETA.'
    } : null,
    startedAt: isFinite(start) && start > 0 ? start / 1000 : 0,
    finishedAt: isFinite(finish) && finish > 0 ? finish / 1000 : 0,
    childJobId: String(current && current.jobId || '')
  };
}

// The server owns Model Lab; both local Diagnostics and Activity consume the
// same run snapshot, updated by the existing Model Lab polling cycle.

function modelLabPublishProgress(run) {
  if (run && Array.isArray(run.attempts) && !run.importedFrom) {
    if (modelLabState.errorRunId !== run.id) {
      modelLabState.errorRunId = run.id; modelLabState.reportedErrors = new Set();
    }
    run.attempts.forEach(function (attempt) {
      if (attempt.status !== 'failed' || modelLabState.reportedErrors.has(attempt.id)) return;
      modelLabState.reportedErrors.add(attempt.id);
      reportConsoleError('Model Assessment', new Error([attempt.modelRef, attempt.kind, attempt.file, attempt.error].filter(Boolean).join(' · ')));
    });
  }
  if (run) diagnosticsRenderAssessmentProgress(run);
  var id = run && run.id ? 'model-lab:' + String(run.id) : '';
  var status = String(run && run.status || '');
  // Browsing history must not stop the active run. When a *new* run is
  // started, however, retire a completed predecessor before following it.
  if (modelLabState.progressRunId && modelLabState.progressRunId !== id) {
    if (status !== 'running') return;
    var previousId = modelLabState.progressRunId.replace(/^model-lab:/, '');
    var previous = modelLabState.runs.find(function (row) {
      return String(row.id || '') === previousId;
    });
    if (previous && previous.active) return;
    var previousStatus = String(previous && previous.status || '');
    window.finishActivityProgress(modelLabState.progressRunId,
      previousStatus === 'error' ? 'failed' :
        (previousStatus === 'completed' ? 'completed' : 'stopped'));
    modelLabState.progressRunId = '';
  }
  if (modelLabState.progressRunId && status !== 'running') {
    window.finishActivityProgress(modelLabState.progressRunId,
      status === 'error' ? 'failed' : (status === 'completed' ? 'completed' : 'stopped'));
    modelLabState.progressRunId = '';
  }
  if (!id || status !== 'running') return;

  window.publishActivityProgress(modelLabProgressSnapshot(run));
  modelLabState.progressRunId = id;
}

function modelLabFetch(runId) {
  var url = '/app/model-lab' + (runId ? ('?run=' + encodeURIComponent(runId)) : '');
  return modelLabRequest(url).then(function (payload) {
    modelLabState.loaded = true;
    modelLabState.models = payload.models || { visions: [], directors: [] };
    modelLabState.runs = Array.isArray(payload.runs) ? payload.runs : [];
    if (payload.run) {
      modelLabState.run = payload.run;
    } else if (!modelLabState.run && modelLabState.runs.length) {
      var active = modelLabState.runs.find(function (row) { return row.active || row.status === 'running'; });
      if (active) return modelLabFetch(active.id);
    }
    if (payload.run) modelLabPublishProgress(payload.run);
    modelLabSchedulePoll();
    return payload;
  });
}

function modelLabSchedulePoll() {
  if (modelLabState.polling) {
    window.clearTimeout(modelLabState.polling);
    modelLabState.polling = 0;
  }
  var selected = modelLabState.run;
  var selectedActive = selected && selected.status === 'running';
  var activeId = modelLabState.progressRunId.replace(/^model-lab:/, '');
  if (!selectedActive && !activeId) return;
  modelLabState.polling = window.setTimeout(function () {
    modelLabState.polling = 0;
    // Keep the server-owned active run current without changing the selected
    // historical run or introducing another polling cycle.
    var request = selectedActive
      ? modelLabFetch(selected.id)
      : modelLabRequest('/app/model-lab?run=' + encodeURIComponent(activeId)).then(function (payload) {
          modelLabPublishProgress(payload.run);
          modelLabSchedulePoll();
        });
    request.catch(function (error) {
      reportConsoleError('Model Lab', error);
      diagnosticsAssessmentProgressError(selectedActive ? selected.id : activeId, error);
    });
  }, 1500);
}
