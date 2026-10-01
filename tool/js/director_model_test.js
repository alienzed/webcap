var directorModelTestState = {
  loaded: false,
  running: false,
  stopRequested: false,
  currentJobId: '',
  currentModelLabel: '',
  currentModelNumber: 0,
  currentPhase: '',
  currentRuntimeName: '',
  startedAt: 0,
  activityTimer: 0,
  protocol: null,
  calibrationProtocol: null,
  calibrationProfiles: [],
  calibrationTotal: 0,
  mode: '',
  models: [],
  session: null
};

function directorModelTestEl(id) {
  return document.getElementById(id);
}

function directorModelTestSleep(ms) {
  return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
}

function directorModelTestRequest(url, options) {
  return fetch(url, options || {}).then(function (response) {
    return response.json().then(function (payload) {
      if (!response.ok || !payload || payload.ok === false) {
        throw new Error(payload && payload.error ? payload.error : 'Director model test request failed.');
      }
      return payload;
    });
  });
}

function directorModelTestPost(payload) {
  return directorModelTestRequest('/app/director-model-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
}

function directorModelTestSeconds(value) {
  var seconds = Number(value);
  if (!isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 10) return seconds.toFixed(1) + 's';
  return Math.round(seconds) + 's';
}

function directorModelTestTokenCount(value) {
  var count = Number(value);
  if (!isFinite(count) || count <= 0) return '—';
  return String(Math.round(count));
}

function directorModelTestRate(value) {
  var rate = Number(value);
  if (!isFinite(rate) || rate <= 0) return '—';
  return rate.toFixed(1);
}

function directorModelTestSize(bytes) {
  var value = Number(bytes);
  if (!isFinite(value) || value <= 0) return '—';
  return (value / (1024 * 1024 * 1024)).toFixed(1) + ' GiB';
}

function directorModelTestIsoFromEpoch(seconds) {
  var value = Number(seconds);
  if (!isFinite(value) || value <= 0) return '';
  return new Date(value * 1000).toISOString();
}

function directorModelTestRenderModels() {
  var host = directorModelTestEl('director-model-test-models');
  if (!host) return;
  if (!directorModelTestState.models.length) {
    host.innerHTML = '<p class="app-settings-help">No Director models are currently available.</p>';
    return;
  }

  var groups = [];
  directorModelTestState.models.forEach(function (model) {
    var runtimeId = String(model.runtimeId || 'local');
    var group = groups.find(function (item) { return item.id === runtimeId; });
    if (!group) {
      group = {
        id: runtimeId,
        name: String(model.runtimeName || (runtimeId === 'local' ? 'Local' : runtimeId)),
        models: []
      };
      groups.push(group);
    }
    group.models.push(model);
  });

  host.innerHTML = groups.map(function (group) {
    return '<div class="app-settings-runtime-scope">' +
      '<div class="app-settings-section-title">' + escapeHtml(group.name) + '</div>' +
      group.models.map(function (model) {
        return '<label class="app-settings-toggle">' +
          '<input type="checkbox" data-director-model-test-model="' + escapeHtml(String(model.id || '')) + '" checked>' +
          '<span>' + escapeHtml(formatDirectorModelLabel(model)) + '</span>' +
          '</label>';
      }).join('') +
      '</div>';
  }).join('');
}

function directorModelTestPhaseText(phase) {
  if (phase === 'queued') return 'Queued';
  if (phase === 'preparing' || phase === 'freeing_comfy') return 'Preparing';
  if (phase === 'loading_model') return 'Loading model';
  if (phase === 'generating') return 'Generating';
  if (phase === 'completed') return 'Completed';
  if (phase === 'failed') return 'Failed';
  if (phase === 'stopped' || phase === 'cancelled' || phase === 'interrupted') return 'Stopped';
  return 'Testing';
}

function directorModelTestStatusState(session) {
  if (directorModelTestState.running) return directorModelTestState.stopRequested ? 'stopping' : 'running';
  var status = String(session && session.status || '');
  if (status === 'completed') return 'complete';
  if (status === 'failed') return 'failed';
  if (status === 'stopped') return 'stopped';
  if (status === 'running') return 'running';
  return 'ready';
}

function directorModelTestStatusText(session) {
  if (!session && directorModelTestState.running && directorModelTestState.mode === 'calibration') {
    return directorModelTestPhaseText(directorModelTestState.currentPhase || 'queued') +
      (directorModelTestState.currentModelLabel ? ' · ' + directorModelTestState.currentModelLabel : '') +
      (directorModelTestState.calibrationTotal > 0 ? ' · ' + String(directorModelTestState.currentModelNumber) + ' / ' + String(directorModelTestState.calibrationTotal) : '');
  }
  if (!session) return directorModelTestState.running ? 'Starting test…' : 'Ready to run a Director model test.';
  var done = Array.isArray(session.runs) ? session.runs.length : 0;
  var total = Array.isArray(session.models) ? session.models.length : 0;
  var failed = Array.isArray(session.runs) ? session.runs.filter(function (run) { return run.status === 'failed'; }).length : 0;

  if (directorModelTestState.running && directorModelTestState.stopRequested) {
    return 'Stopping' + (directorModelTestState.currentModelLabel ? ' · ' + directorModelTestState.currentModelLabel : '') +
      ' · ' + String(done) + ' / ' + String(total) + ' complete';
  }
  if (directorModelTestState.running && directorModelTestState.currentModelLabel) {
    return directorModelTestPhaseText(directorModelTestState.currentPhase) + ' · ' +
      directorModelTestState.currentModelLabel + ' · ' +
      String(directorModelTestState.currentModelNumber) + ' / ' + String(total);
  }
  if (session.status === 'running') return 'Running · ' + String(done) + ' / ' + String(total) + ' complete';

  var text = String(session.status || 'completed') + ' · ' + String(done) + ' / ' + String(total);
  if (session.status === 'completed') text = 'Completed · ' + String(done) + ' / ' + String(total);
  if (session.status === 'stopped') text = 'Stopped · ' + String(done) + ' / ' + String(total);
  if (session.status === 'failed') text = 'Failed · ' + String(done) + ' / ' + String(total) + ' · see Console';
  if (failed) text += ' · ' + String(failed) + ' failed';
  return text;
}

function directorModelTestFormatElapsed(startedAt) {
  var started = Number(startedAt);
  if (!isFinite(started) || started <= 0) return '';
  var seconds = Math.max(0, Math.floor(Date.now() / 1000 - started));
  if (seconds < 60) return String(seconds) + 's elapsed';
  var minutes = Math.floor(seconds / 60);
  var remainder = seconds % 60;
  if (minutes < 60) return String(minutes) + 'm ' + String(remainder).padStart(2, '0') + 's elapsed';
  var hours = Math.floor(minutes / 60);
  return String(hours) + 'h ' + String(minutes % 60).padStart(2, '0') + 'm elapsed';
}

function directorModelTestRenderActivity() {
  var host = directorModelTestEl('director-model-test-activity');
  if (!host) return;
  if (!directorModelTestState.running) {
    host.innerHTML = '';
    host.classList.add('hidden');
    return;
  }

  var session = directorModelTestState.session;
  var total = directorModelTestState.mode === 'calibration'
    ? Number(directorModelTestState.calibrationTotal || 0)
    : (Array.isArray(session && session.models) ? session.models.length : 0);
  var number = Number(directorModelTestState.currentModelNumber || 0);
  var model = directorModelTestState.currentModelLabel || 'Preparing next model…';
  var runtime = directorModelTestState.currentRuntimeName || '';
  var phase = directorModelTestPhaseText(directorModelTestState.currentPhase || 'queued');
  var progress = total > 0 && number > 0 ? Math.max(0, Math.min(100, number / total * 100)) : 0;
  var detail = [model, runtime].filter(Boolean).join(' · ');
  var meta = [phase, number > 0 && total > 0 ? String(number) + ' / ' + String(total) : '', directorModelTestFormatElapsed(directorModelTestState.startedAt)].filter(Boolean).join(' · ');

  host.classList.remove('hidden');
  host.innerHTML =
    '<article class="activity-monitor-card status-running director-model-test-activity-card">' +
      '<span class="activity-monitor-dot active"></span>' +
      '<div class="activity-monitor-copy">' +
        '<strong>' + (directorModelTestState.mode === 'calibration' ? 'Director Model Calibration' : 'Director Model Test') + '</strong>' +
        '<span>' + escapeHtml(detail) + '</span>' +
        '<small>' + escapeHtml(meta) + '</small>' +
        '<div class="activity-monitor-progress"><span style="width:' + progress.toFixed(1) + '%"></span></div>' +
      '</div>' +
    '</article>';
}

function directorModelTestSetStatus(text, state, summaryText) {
  var summary = directorModelTestEl('director-model-test-summary-status');
  if (summary) {
    summary.textContent = summaryText || 'Ready';
    summary.dataset.state = state || 'ready';
  }
  directorModelTestRenderActivity();
}

function directorModelTestRenderStatus() {
  var session = directorModelTestState.session;
  var state = directorModelTestStatusState(session);
  var summary = 'Ready';
  if (state === 'running') summary = 'Running';
  if (state === 'stopping') summary = 'Stopping';
  if (state === 'complete') summary = 'Complete';
  if (state === 'stopped') summary = 'Stopped';
  if (state === 'failed') summary = 'Failed';
  directorModelTestSetStatus(directorModelTestStatusText(session), state, summary);
}

function directorModelTestRenderSession() {
  var session = directorModelTestState.session;
  var results = directorModelTestEl('director-model-test-results');
  var exportButton = directorModelTestEl('director-model-test-export');
  directorModelTestRenderStatus();
  if (exportButton) exportButton.disabled = !session;

  if (!results) return;
  if (!session || !Array.isArray(session.runs) || !session.runs.length) {
    results.innerHTML = '<p class="app-settings-help">No results yet.</p>';
    return;
  }

  results.innerHTML = session.runs.map(function (run, index) {
    var statusText = run.status === 'completed' ? 'Completed' : (run.status || 'Failed');
    var body = run.text || run.error || 'No output.';
    var metrics = [
      directorModelTestSeconds(run.totalSeconds),
      directorModelTestRate(run.tokensPerSecond) === '—' ? '' : directorModelTestRate(run.tokensPerSecond) + ' tok/s',
      directorModelTestTokenCount(run.promptTokens) + ' → ' + directorModelTestTokenCount(run.completionTokens) + ' tokens',
      directorModelTestSize(run.sizeBytes)
    ].filter(Boolean).join(' · ');
    return '<details class="app-settings-advanced director-model-test-result"' + (index === 0 ? ' open' : '') + '>' +
      '<summary>' +
        '<span><strong>' + escapeHtml(run.label || run.modelId || run.modelRef || '') + '</strong> · ' +
        escapeHtml(run.runtimeName || run.runtimeId || '') + ' · ' + escapeHtml(statusText) + '</span>' +
        '<span class="app-settings-help">' + escapeHtml(metrics) + '</span>' +
      '</summary>' +
      '<div class="app-settings-disclosure-body">' +
        '<div class="app-settings-help">Queue ' + escapeHtml(directorModelTestSeconds(run.queueSeconds)) +
        ' · Prep ' + escapeHtml(directorModelTestSeconds(run.preparingSeconds)) +
        ' · Load ' + escapeHtml(directorModelTestSeconds(run.loadingSeconds)) +
        ' · Generate ' + escapeHtml(directorModelTestSeconds(run.generatingSeconds)) + '</div>' +
        '<pre class="app-settings-json director-model-test-output">' + escapeHtml(body) + '</pre>' +
      '</div>' +
    '</details>';
  }).join('');
}
function directorModelTestSyncControls() {
  var run = directorModelTestEl('director-model-test-run');
  var calibrate = directorModelTestEl('director-model-test-calibrate');
  var clearCalibration = directorModelTestEl('director-model-test-clear-calibration');
  var stop = directorModelTestEl('director-model-test-stop');
  var refresh = directorModelTestEl('director-model-test-refresh');
  if (run) run.disabled = directorModelTestState.running || !directorModelTestState.models.length;
  if (calibrate) calibrate.disabled = directorModelTestState.running || !directorModelTestState.models.length;
  if (clearCalibration) clearCalibration.disabled = directorModelTestState.running || !directorModelTestState.calibrationProfiles.length;
  if (refresh) refresh.disabled = directorModelTestState.running;
  if (stop) {
    stop.classList.toggle('hidden', !directorModelTestState.running);
    stop.disabled = !directorModelTestState.running;
  }
}

function directorModelTestRefresh() {
  return Promise.all([
    directorModelTestRequest('/app/director-model-test'),
    directorModelTestRequest('/fs/storyboard/director')
  ]).then(function (responses) {
    var meta = responses[0];
    var models = responses[1];
    directorModelTestState.protocol = meta.protocol || null;
    directorModelTestState.calibrationProtocol = meta.calibrationProtocol || null;
    directorModelTestState.calibrationProfiles = Array.isArray(meta.calibrationProfiles) ? meta.calibrationProfiles : [];
    directorModelTestState.session = meta.session || null;
    directorModelTestState.models = Array.isArray(models.models) ? models.models : [];
    directorModelTestState.loaded = true;

    var protocol = directorModelTestEl('director-model-test-protocol');
    if (protocol && directorModelTestState.protocol) {
      protocol.textContent =
        directorModelTestState.protocol.id + ' · ' +
        directorModelTestState.protocol.description;
    }
    var prompt = directorModelTestEl('director-model-test-prompt');
    if (prompt && directorModelTestState.protocol && !prompt.value) {
      prompt.value = String(directorModelTestState.protocol.defaultPrompt || '');
    }
    directorModelTestRenderModels();
    directorModelTestRenderCalibrationProfiles();
    directorModelTestRenderSession();
    directorModelTestSyncControls();
  }).catch(function (error) {
    reportConsoleError('Director Model Test', error);
    directorModelTestSetStatus('Could not load model test data. See Console.', 'failed', 'Failed');
    throw error;
  });
}

function directorModelTestSelectedModels() {
  var selected = {};
  Array.prototype.forEach.call(
    document.querySelectorAll('[data-director-model-test-model]:checked'),
    function (input) { selected[String(input.getAttribute('data-director-model-test-model') || '')] = true; }
  );
  return directorModelTestState.models.filter(function (model) {
    return !!selected[String(model.id || '')];
  }).map(function (model) {
    return {
      modelRef: String(model.id || ''),
      runtimeId: String(model.runtimeId || ''),
      runtimeName: String(model.runtimeName || ''),
      modelId: String(model.modelId || ''),
      label: String(model.label || model.modelId || model.id || ''),
      sizeBytes: Number(model.sizeBytes || 0)
    };
  });
}

function directorModelTestObservePhase(tracker, activity, jobId) {
  if (!activity || !activity.queue || String(activity.queue.activeJobId || '') !== String(jobId || '')) return;
  var observedContext = Number(activity.contextSize || (activity.slot && activity.slot.contextSize) || 0);
  if (isFinite(observedContext) && observedContext > 0) {
    tracker.observedContextSize = Math.max(Number(tracker.observedContextSize || 0), observedContext);
  }
  var phase = String(activity.phase || '');
  if (!phase || phase === 'queued' || phase === 'complete' || phase === 'error' || phase === 'stopped') return;
  var now = Date.now() / 1000;
  if (tracker.phase === phase) return;
  if (tracker.phase && tracker.phaseStartedAt) {
    tracker.phases[tracker.phase] = Number(tracker.phases[tracker.phase] || 0) + Math.max(0, now - tracker.phaseStartedAt);
  }
  tracker.phase = phase;
  tracker.phaseStartedAt = now;
  directorModelTestState.currentPhase = phase;
  directorModelTestRenderStatus();
}

function directorModelTestClosePhase(tracker) {
  if (!tracker.phase || !tracker.phaseStartedAt) return;
  var now = Date.now() / 1000;
  tracker.phases[tracker.phase] = Number(tracker.phases[tracker.phase] || 0) + Math.max(0, now - tracker.phaseStartedAt);
  tracker.phase = '';
  tracker.phaseStartedAt = 0;
}

function directorModelTestMetric(source, primary, fallback) {
  var value = Number(source && source[primary]);
  if (!isFinite(value) && fallback) value = Number(source && source[fallback]);
  return isFinite(value) && value >= 0 ? value : 0;
}

function directorModelTestBuildRun(model, job, tracker, localStartedAt) {
  directorModelTestClosePhase(tracker);
  job = job || {};
  var result = job.result && typeof job.result === 'object' ? job.result : {};
  var usage = result.usage && typeof result.usage === 'object' ? result.usage : {};
  var timings = result.timings && typeof result.timings === 'object' ? result.timings : {};
  var createdAt = Number(job.createdAt) || localStartedAt;
  var startedAt = Number(job.startedAt) || createdAt;
  var finishedAt = Number(job.finishedAt) || (Date.now() / 1000);
  var queueSeconds = Math.max(0, startedAt - createdAt);
  var runtimeSeconds = Math.max(0, finishedAt - startedAt);
  var totalSeconds = Math.max(0, finishedAt - createdAt);
  var promptTokens = directorModelTestMetric(usage, 'prompt_tokens') || directorModelTestMetric(timings, 'prompt_n');
  var completionTokens = directorModelTestMetric(usage, 'completion_tokens') || directorModelTestMetric(timings, 'predicted_n');
  var totalTokens = directorModelTestMetric(usage, 'total_tokens') || (promptTokens + completionTokens);
  var preparingSeconds = Number(tracker.phases.preparing || 0) + Number(tracker.phases.freeing_comfy || 0);
  var loadingSeconds = Number(tracker.phases.loading_model || 0);
  var generatingSeconds = Number(tracker.phases.generating || 0);
  if (!generatingSeconds) {
    var promptMs = directorModelTestMetric(timings, 'prompt_ms');
    var predictedMs = directorModelTestMetric(timings, 'predicted_ms');
    if (promptMs || predictedMs) generatingSeconds = (promptMs + predictedMs) / 1000;
  }
  var tokensPerSecond = directorModelTestMetric(timings, 'predicted_per_second');
  if (!tokensPerSecond && completionTokens > 0 && generatingSeconds > 0) {
    tokensPerSecond = completionTokens / generatingSeconds;
  }

  var text = String(result.text || '');
  var words = text.trim() ? text.trim().split(/\s+/).length : 0;
  var terminalStatus = String(job.status || '');
  var status = terminalStatus === 'completed' ? 'completed' : (terminalStatus === 'stopped' || terminalStatus === 'cancelled' ? 'stopped' : 'failed');

  return {
    modelRef: model.modelRef,
    status: status,
    startedAt: directorModelTestIsoFromEpoch(startedAt),
    finishedAt: directorModelTestIsoFromEpoch(finishedAt),
    queueSeconds: queueSeconds,
    runtimeSeconds: runtimeSeconds,
    preparingSeconds: preparingSeconds,
    loadingSeconds: loadingSeconds,
    generatingSeconds: generatingSeconds,
    totalSeconds: totalSeconds,
    promptTokens: promptTokens,
    completionTokens: completionTokens,
    totalTokens: totalTokens,
    tokensPerSecond: tokensPerSecond,
    outputWords: words,
    outputChars: text.length,
    usage: usage,
    backendTimings: timings,
    finishReason: String(result.finishReason || ''),
    contextSize: Number(result.contextSize || tracker.observedContextSize || 0),
    text: text,
    error: String(job.error || '')
  };
}

function directorModelTestWaitForJob(jobId, tracker) {
  return new Promise(function (resolve, reject) {
    function poll() {
      Promise.all([
        directorModelTestRequest('/fs/director/job?job=' + encodeURIComponent(jobId)),
        directorModelTestRequest('/fs/director/activity')
      ]).then(function (responses) {
        var job = responses[0].job || {};
        directorModelTestObservePhase(tracker, responses[1], jobId);
        var status = String(job.status || '');
        if (['completed', 'failed', 'cancelled', 'stopped', 'interrupted'].indexOf(status) !== -1) {
          resolve(job);
          return;
        }
        directorModelTestSleep(750).then(poll);
      }).catch(reject);
    }
    poll();
  });
}

function directorModelTestConsumeJob(jobId) {
  return directorModelTestRequest('/fs/director/job?job=' + encodeURIComponent(jobId) + '&consume=1').catch(function (error) {
    reportConsoleWarning('Director Model Test', 'Could not consume completed job ' + jobId + ': ' + (error.message || String(error)));
  });
}

function directorModelTestRunOne(model, modelNumber) {
  var tracker = { phase: '', phaseStartedAt: 0, phases: {} };
  var localStartedAt = Date.now() / 1000;
  directorModelTestState.currentModelLabel = String(model.label || model.modelId || model.modelRef || 'Model');
  directorModelTestState.currentModelNumber = modelNumber;
  directorModelTestState.currentPhase = 'queued';
  directorModelTestState.currentRuntimeName = String(model.runtimeName || model.runtimeId || 'runtime');
  directorModelTestRenderStatus();
  return directorModelTestPost({
    action: 'enqueue',
    sessionId: directorModelTestState.session.id,
    modelRef: model.modelRef
  }).then(function (payload) {
    directorModelTestState.currentJobId = String(payload.job && payload.job.jobId || '');
    if (!directorModelTestState.currentJobId) throw new Error('Director model test did not receive a job ID.');
    reportConsoleInfo('Director Model Test', 'Testing ' + (model.label || model.modelId || model.modelRef) + ' on ' + (model.runtimeName || model.runtimeId || 'runtime') + '.');
    return directorModelTestWaitForJob(directorModelTestState.currentJobId, tracker);
  }).then(function (job) {
    var run = directorModelTestBuildRun(model, job, tracker, localStartedAt);
    directorModelTestState.currentPhase = run.status;
    directorModelTestRenderStatus();
    return directorModelTestPost({
      action: 'save_run',
      sessionId: directorModelTestState.session.id,
      run: run
    }).then(function (payload) {
      directorModelTestState.session = payload.session;
      directorModelTestRenderSession();
      return directorModelTestConsumeJob(directorModelTestState.currentJobId).then(function () { return run; });
    });
  }).finally(function () {
    directorModelTestState.currentJobId = '';
    directorModelTestState.currentPhase = directorModelTestState.stopRequested ? 'stopped' : 'completed';
    directorModelTestRenderStatus();
  });
}

function directorModelTestStart() {
  if (directorModelTestState.running) return;
  var models = directorModelTestSelectedModels();
  if (!models.length) {
    directorModelTestSetStatus('Choose at least one model.', 'ready', 'Ready');
    return;
  }

  var prompt = String((directorModelTestEl('director-model-test-prompt') || {}).value || '').trim();
  if (!prompt) {
    directorModelTestSetStatus('Enter a benchmark prompt.', 'ready', 'Ready');
    return;
  }

  directorModelTestState.running = true;
  directorModelTestState.stopRequested = false;
  directorModelTestState.startedAt = Date.now() / 1000;
  if (directorModelTestState.activityTimer) window.clearInterval(directorModelTestState.activityTimer);
  directorModelTestState.activityTimer = window.setInterval(function () {
    if (directorModelTestState.running) directorModelTestRenderActivity();
  }, 1000);
  directorModelTestState.session = null;
  directorModelTestState.currentModelLabel = '';
  directorModelTestState.currentModelNumber = 0;
  directorModelTestState.currentPhase = '';
  directorModelTestSyncControls();
  directorModelTestSetStatus(
    'Starting test · ' + String(models.length) + ' model' + (models.length === 1 ? '' : 's') + ' selected',
    'running',
    'Running'
  );
  reportConsoleInfo('Director Model Test', 'Starting ' + String(models.length) + '-model ' + String((directorModelTestState.protocol || {}).id || 'benchmark') + '.');

  directorModelTestPost({ action: 'start', models: models, prompt: prompt }).then(function (payload) {
    directorModelTestState.session = payload.session;
    directorModelTestRenderSession();

    var chain = Promise.resolve();
    models.forEach(function (model, index) {
      chain = chain.then(function () {
        if (directorModelTestState.stopRequested) return;
        return directorModelTestRunOne(model, index + 1).catch(function (error) {
          if (directorModelTestState.stopRequested) return;
          reportConsoleError('Director Model Test', error);
          var failedRun = {
            modelRef: model.modelRef,
            status: 'failed',
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            error: error.message || String(error)
          };
          return directorModelTestPost({
            action: 'save_run',
            sessionId: directorModelTestState.session.id,
            run: failedRun
          }).then(function (saved) {
            directorModelTestState.session = saved.session;
            directorModelTestRenderSession();
          });
        });
      });
    });
    return chain;
  }).then(function () {
    if (!directorModelTestState.session) return;
    return directorModelTestPost({
      action: 'finish',
      sessionId: directorModelTestState.session.id,
      status: directorModelTestState.stopRequested ? 'stopped' : 'completed'
    }).then(function (payload) {
      directorModelTestState.session = payload.session;
      directorModelTestRenderSession();
      reportConsoleInfo('Director Model Test', directorModelTestState.stopRequested ? 'Model test stopped.' : 'Model test completed.');
    });
  }).catch(function (error) {
    reportConsoleError('Director Model Test', error);
    if (directorModelTestState.session) {
      return directorModelTestPost({
        action: 'finish',
        sessionId: directorModelTestState.session.id,
        status: 'failed'
      }).then(function (payload) {
        directorModelTestState.session = payload.session;
        directorModelTestRenderSession();
      }).catch(function (finishError) {
        reportConsoleError('Director Model Test', finishError);
      });
    }
  }).finally(function () {
    directorModelTestState.running = false;
    directorModelTestState.currentJobId = '';
    directorModelTestState.currentModelLabel = '';
    directorModelTestState.currentModelNumber = 0;
    directorModelTestState.currentPhase = '';
    directorModelTestState.currentRuntimeName = '';
    directorModelTestState.startedAt = 0;
    if (directorModelTestState.activityTimer) {
      window.clearInterval(directorModelTestState.activityTimer);
      directorModelTestState.activityTimer = 0;
    }
    directorModelTestSyncControls();
    directorModelTestRenderStatus();
    directorModelTestRefresh().catch(function () {});
  });
}

function directorModelTestStop() {
  if (!directorModelTestState.running) return;
  directorModelTestState.stopRequested = true;
  directorModelTestRenderStatus();
  var button = directorModelTestEl('director-model-test-stop');
  if (button) button.disabled = true;
  if (!directorModelTestState.currentJobId) return;
  directorModelTestRequest('/fs/director/job', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operation: 'stop_or_cancel',
      jobId: directorModelTestState.currentJobId
    })
  }).catch(function (error) {
    reportConsoleError('Director Model Test', error);
  });
}

function directorModelTestExport() {
  var session = directorModelTestState.session;
  if (!session) return;
  var blob = new Blob([JSON.stringify(session, null, 2) + '\n'], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'director-model-test-' + session.id + '.json';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function initializeDirectorModelTest() {
  var details = directorModelTestEl('director-model-test-settings');
  if (!details) throw new Error('Director model test Diagnostics markup is missing.');

  directorModelTestEl('director-model-test-refresh').addEventListener('click', function () {
    directorModelTestRefresh();
  });
  directorModelTestEl('director-model-test-select-all').addEventListener('click', function () {
    Array.prototype.forEach.call(document.querySelectorAll('[data-director-model-test-model]'), function (input) { input.checked = true; });
  });
  directorModelTestEl('director-model-test-select-none').addEventListener('click', function () {
    Array.prototype.forEach.call(document.querySelectorAll('[data-director-model-test-model]'), function (input) { input.checked = false; });
  });
  directorModelTestEl('director-model-test-run').addEventListener('click', directorModelTestStart);
  directorModelTestEl('director-model-test-stop').addEventListener('click', directorModelTestStop);
  directorModelTestEl('director-model-test-export').addEventListener('click', directorModelTestExport);

  directorModelTestRenderSession();
  directorModelTestSyncControls();
}

initializeDirectorModelTest();
