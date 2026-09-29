var directorModelTestState = {
  loaded: false,
  running: false,
  stopRequested: false,
  currentJobId: '',
  protocol: null,
  models: [],
  sessions: [],
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

function directorModelTestRenderSessions() {
  var host = directorModelTestEl('director-model-test-sessions');
  if (!host) return;
  if (!directorModelTestState.sessions.length) {
    host.innerHTML = '<p class="app-settings-help">No saved model tests yet.</p>';
    return;
  }

  host.innerHTML = directorModelTestState.sessions.map(function (session) {
    var date = session.startedAt ? new Date(session.startedAt).toLocaleString() : session.id;
    var counts = String(session.runCount || 0) + '/' + String(session.modelCount || 0) + ' runs';
    if (session.failedCount) counts += ' · ' + String(session.failedCount) + ' failed';
    return '<div class="app-settings-environment-group-header">' +
      '<span><strong>' + escapeHtml(date) + '</strong> · ' + escapeHtml(session.protocolId || '') + ' · ' + escapeHtml(counts) + '</span>' +
      '<span>' +
        '<button type="button" class="review-captions-btn" data-director-model-test-view="' + escapeHtml(session.id) + '">View</button> ' +
        '<button type="button" class="review-captions-btn" data-director-model-test-delete="' + escapeHtml(session.id) + '">Delete</button>' +
      '</span>' +
      '</div>';
  }).join('');
}

function directorModelTestStatusText(session) {
  if (!session) return 'Ready.';
  var done = Array.isArray(session.runs) ? session.runs.length : 0;
  var total = Array.isArray(session.models) ? session.models.length : 0;
  if (session.status === 'running') return 'Running · ' + String(done) + ' / ' + String(total);
  return String(session.status || 'complete') + ' · ' + String(done) + ' / ' + String(total);
}

function directorModelTestRenderSession() {
  var session = directorModelTestState.session;
  var status = directorModelTestEl('director-model-test-status');
  var results = directorModelTestEl('director-model-test-results');
  var exportButton = directorModelTestEl('director-model-test-export');
  if (status) status.textContent = directorModelTestStatusText(session);
  if (exportButton) exportButton.disabled = !session;

  if (!results) return;
  if (!session || !Array.isArray(session.runs) || !session.runs.length) {
    results.innerHTML = '<p class="app-settings-help">No results yet.</p>';
    return;
  }

  var rows = session.runs.map(function (run) {
    var statusText = run.status === 'completed' ? 'OK' : (run.status || 'failed');
    return '<tr>' +
      '<td>' + escapeHtml(run.label || run.modelId || run.modelRef || '') + '</td>' +
      '<td>' + escapeHtml(run.runtimeName || run.runtimeId || '') + '</td>' +
      '<td>' + escapeHtml(statusText) + '</td>' +
      '<td>' + escapeHtml(directorModelTestSeconds(run.totalSeconds)) + '</td>' +
      '<td>' + escapeHtml(directorModelTestSeconds(run.queueSeconds)) + '</td>' +
      '<td>' + escapeHtml(directorModelTestSeconds(run.preparingSeconds)) + '</td>' +
      '<td>' + escapeHtml(directorModelTestSeconds(run.loadingSeconds)) + '</td>' +
      '<td>' + escapeHtml(directorModelTestSeconds(run.generatingSeconds)) + '</td>' +
      '<td>' + escapeHtml(directorModelTestTokenCount(run.promptTokens)) + ' / ' + escapeHtml(directorModelTestTokenCount(run.completionTokens)) + '</td>' +
      '<td>' + escapeHtml(directorModelTestRate(run.tokensPerSecond)) + '</td>' +
      '<td>' + escapeHtml(directorModelTestSize(run.sizeBytes)) + '</td>' +
      '</tr>';
  }).join('');

  var outputs = session.runs.map(function (run) {
    var body = run.text || run.error || 'No output.';
    return '<details class="app-settings-advanced">' +
      '<summary>' + escapeHtml(run.label || run.modelId || run.modelRef || '') + ' output</summary>' +
      '<div class="app-settings-disclosure-body"><pre class="app-settings-json">' + escapeHtml(body) + '</pre></div>' +
      '</details>';
  }).join('');

  results.innerHTML =
    '<div class="table-responsive"><table class="table table-sm">' +
      '<thead><tr><th>Model</th><th>Runtime</th><th>Status</th><th>Total</th><th>Queue</th><th>Prep</th><th>Load</th><th>Generate</th><th>In / Out</th><th>tok/s</th><th>Size</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table></div>' +
    outputs;
}

function directorModelTestSyncControls() {
  var run = directorModelTestEl('director-model-test-run');
  var stop = directorModelTestEl('director-model-test-stop');
  var refresh = directorModelTestEl('director-model-test-refresh');
  if (run) run.disabled = directorModelTestState.running || !directorModelTestState.models.length;
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
    directorModelTestState.sessions = Array.isArray(meta.sessions) ? meta.sessions : [];
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
    directorModelTestRenderSessions();
    directorModelTestRenderSession();
    directorModelTestSyncControls();
  }).catch(function (error) {
    reportConsoleError('Director Model Test', error);
    var status = directorModelTestEl('director-model-test-status');
    if (status) status.textContent = 'Could not load model test data. See Console.';
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
  var phase = String(activity.phase || '');
  if (!phase || phase === 'queued' || phase === 'complete' || phase === 'error' || phase === 'stopped') return;
  var now = Date.now() / 1000;
  if (tracker.phase === phase) return;
  if (tracker.phase && tracker.phaseStartedAt) {
    tracker.phases[tracker.phase] = Number(tracker.phases[tracker.phase] || 0) + Math.max(0, now - tracker.phaseStartedAt);
  }
  tracker.phase = phase;
  tracker.phaseStartedAt = now;
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

function directorModelTestRunOne(model) {
  var tracker = { phase: '', phaseStartedAt: 0, phases: {} };
  var localStartedAt = Date.now() / 1000;
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
  });
}

function directorModelTestStart() {
  if (directorModelTestState.running) return;
  var models = directorModelTestSelectedModels();
  if (!models.length) {
    var status = directorModelTestEl('director-model-test-status');
    if (status) status.textContent = 'Choose at least one model.';
    return;
  }

  var prompt = String((directorModelTestEl('director-model-test-prompt') || {}).value || '').trim();
  if (!prompt) {
    var status = directorModelTestEl('director-model-test-status');
    if (status) status.textContent = 'Enter a benchmark prompt.';
    return;
  }

  directorModelTestState.running = true;
  directorModelTestState.stopRequested = false;
  directorModelTestState.session = null;
  directorModelTestSyncControls();
  reportConsoleInfo('Director Model Test', 'Starting ' + String(models.length) + '-model ' + String((directorModelTestState.protocol || {}).id || 'benchmark') + '.');

  directorModelTestPost({ action: 'start', models: models, prompt: prompt }).then(function (payload) {
    directorModelTestState.session = payload.session;
    directorModelTestRenderSession();

    var chain = Promise.resolve();
    models.forEach(function (model) {
      chain = chain.then(function () {
        if (directorModelTestState.stopRequested) return;
        return directorModelTestRunOne(model).catch(function (error) {
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
    directorModelTestSyncControls();
    directorModelTestRefresh().catch(function () {});
  });
}

function directorModelTestStop() {
  if (!directorModelTestState.running) return;
  directorModelTestState.stopRequested = true;
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

function directorModelTestLoadSession(sessionId) {
  return directorModelTestRequest('/app/director-model-test?id=' + encodeURIComponent(sessionId)).then(function (payload) {
    directorModelTestState.session = payload.session;
    directorModelTestRenderSession();
  }).catch(function (error) {
    reportConsoleError('Director Model Test', error);
  });
}

function directorModelTestDeleteSession(sessionId) {
  return directorModelTestRequest('/app/director-model-test?id=' + encodeURIComponent(sessionId), {
    method: 'DELETE'
  }).then(function () {
    if (directorModelTestState.session && directorModelTestState.session.id === sessionId) {
      directorModelTestState.session = null;
      directorModelTestRenderSession();
    }
    return directorModelTestRefresh();
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
  if (!details) throw new Error('Director model test Settings markup is missing.');

  details.addEventListener('toggle', function () {
    if (details.open && !directorModelTestState.loaded) {
      directorModelTestRefresh();
    }
  });

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

  directorModelTestEl('director-model-test-sessions').addEventListener('click', function (event) {
    var view = event.target.closest('[data-director-model-test-view]');
    if (view) {
      directorModelTestLoadSession(String(view.getAttribute('data-director-model-test-view') || ''));
      return;
    }
    var remove = event.target.closest('[data-director-model-test-delete]');
    if (remove) {
      directorModelTestDeleteSession(String(remove.getAttribute('data-director-model-test-delete') || ''));
    }
  });

  directorModelTestRenderSession();
  directorModelTestSyncControls();
}

initializeDirectorModelTest();
