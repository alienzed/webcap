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
  calibrationReports: [],
  assessmentRuns: [],
  advertisedCapabilities: [],
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

function directorModelTestRenderModelChoices(hostId, dataAttribute) {
  var host = directorModelTestEl(hostId);
  if (!host) throw new Error('Director model choice markup is missing: ' + hostId);
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
          '<input type="checkbox" ' + dataAttribute + '="' + escapeHtml(String(model.id || '')) + '" checked>' +
          '<span>' + escapeHtml(formatDirectorModelLabel(model)) + '</span>' +
          '</label>';
      }).join('') +
      '</div>';
  }).join('');
}

function directorModelTestRenderModels() {
  directorModelTestRenderModelChoices('director-model-assessment-models', 'data-director-model-assessment-model');
  directorModelTestRenderModelChoices('director-model-test-models', 'data-director-model-test-model');
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
  if (directorModelTestState.running && directorModelTestState.mode === 'calibration') {
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
  var benchmarkHost = directorModelTestEl('director-model-test-activity');
  var assessmentHost = directorModelTestEl('director-model-assessment-activity');
  if (!benchmarkHost || !assessmentHost) throw new Error('Director diagnostic activity markup is incomplete.');

  [benchmarkHost, assessmentHost].forEach(function (host) {
    host.innerHTML = '';
    host.classList.add('hidden');
  });
  if (!directorModelTestState.running) return;

  var host = directorModelTestState.mode === 'calibration' ? assessmentHost : benchmarkHost;
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
        '<strong>' + (directorModelTestState.mode === 'calibration' ? 'Director Model Assessment' : 'Director Benchmark') + '</strong>' +
        '<span>' + escapeHtml(detail) + '</span>' +
        '<small>' + escapeHtml(meta) + '</small>' +
        '<div class="activity-monitor-progress"><span style="width:' + progress.toFixed(1) + '%"></span></div>' +
      '</div>' +
    '</article>';
}

function directorModelTestSetStatus(text, state, summaryText) {
  var summaryId = directorModelTestState.mode === 'calibration'
    ? 'director-model-assessment-summary-status'
    : 'director-model-test-summary-status';
  var summary = directorModelTestEl(summaryId);
  if (!summary) throw new Error('Director diagnostic summary markup is missing: ' + summaryId);
  summary.textContent = summaryText || 'Ready';
  summary.dataset.state = state || 'ready';
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
      directorModelTestSize(run.sizeBytes),
      run.finishReason ? 'finish=' + run.finishReason : ''
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
  var assess = directorModelTestEl('director-model-assessment-run');
  var clearCalibration = directorModelTestEl('director-model-test-clear-calibration');
  var benchmarkStop = directorModelTestEl('director-model-test-stop');
  var assessmentStop = directorModelTestEl('director-model-assessment-stop');
  var benchmarkRefresh = directorModelTestEl('director-model-test-refresh');
  var assessmentRefresh = directorModelTestEl('director-model-assessment-refresh');

  if (!run || !assess || !clearCalibration || !benchmarkStop || !assessmentStop || !benchmarkRefresh || !assessmentRefresh) {
    throw new Error('Director diagnostic controls are incomplete.');
  }

  run.disabled = directorModelTestState.running || !directorModelTestState.models.length;
  assess.disabled = directorModelTestState.running || !directorModelTestState.models.length;
  clearCalibration.disabled = directorModelTestState.running || (!directorModelTestState.calibrationProfiles.length && !directorModelTestState.calibrationReports.length);
  benchmarkRefresh.disabled = directorModelTestState.running;
  assessmentRefresh.disabled = directorModelTestState.running;

  benchmarkStop.classList.toggle('hidden', !directorModelTestState.running || directorModelTestState.mode !== 'test');
  benchmarkStop.disabled = !directorModelTestState.running || directorModelTestState.mode !== 'test';
  assessmentStop.classList.toggle('hidden', !directorModelTestState.running || directorModelTestState.mode !== 'calibration');
  assessmentStop.disabled = !directorModelTestState.running || directorModelTestState.mode !== 'calibration';
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
    directorModelTestState.calibrationReports = Array.isArray(meta.calibrationReports) ? meta.calibrationReports : [];
    directorModelTestState.assessmentRuns = Array.isArray(meta.assessmentRuns) ? meta.assessmentRuns : [];
    directorModelTestState.advertisedCapabilities = Array.isArray(meta.advertisedCapabilities) ? meta.advertisedCapabilities : [];
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
    directorModelAssessmentRenderHistory();
    directorModelTestRenderSession();
    directorModelTestSyncControls();
  }).catch(function (error) {
    reportConsoleError('Director Model Test', error);
    directorModelTestSetStatus('Could not load model test data. See Console.', 'failed', 'Failed');
    throw error;
  });
}

function directorModelSelectedModels(attributeName) {
  var selected = {};
  Array.prototype.forEach.call(
    document.querySelectorAll('[' + attributeName + ']:checked'),
    function (input) { selected[String(input.getAttribute(attributeName) || '')] = true; }
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

function directorModelTestSelectedModels() {
  return directorModelSelectedModels('data-director-model-test-model');
}

function directorModelAssessmentSelectedModels() {
  return directorModelSelectedModels('data-director-model-assessment-model');
}

function directorModelTestFormatCapacity(value) {
  var count = Number(value);
  if (!isFinite(count) || count <= 0) return 'runtime-managed';
  if (count >= 1024 && count % 1024 === 0) return String(count / 1024) + 'k';
  return String(Math.round(count));
}

function directorModelTestAdvertisedCapability(modelRef) {
  var items = Array.isArray(directorModelTestState.advertisedCapabilities) ? directorModelTestState.advertisedCapabilities : [];
  var model = directorModelTestState.models.find(function (item) {
    return String(item.id || '') === String(modelRef || '');
  }) || {};
  var haystack = [
    modelRef,
    model.modelId,
    model.label
  ].map(function (value) { return String(value || '').toLowerCase(); }).join(' ');
  return items.find(function (entry) {
    var matches = Array.isArray(entry.match) ? entry.match : [];
    return matches.some(function (token) {
      return haystack.indexOf(String(token || '').toLowerCase()) !== -1;
    });
  }) || null;
}

function directorModelTestHealthLabel(value) {
  value = String(value || '');
  if (value === 'healthy') return 'Healthy';
  if (value === 'limited') return 'Healthy · limit found';
  if (value === 'warning') return 'Warning · usable range found';
  if (value === 'likely-unusable') return 'Likely unusable';
  if (value === 'calibration-failed') return 'Calibration failed';
  if (value === 'stopped') return 'Stopped';
  return 'Incomplete';
}

function directorModelTestRenderCalibrationProfiles() {
  var host = directorModelTestEl('director-model-test-calibration-profiles');
  if (!host) return;
  var profiles = Array.isArray(directorModelTestState.calibrationProfiles) ? directorModelTestState.calibrationProfiles : [];
  var reports = Array.isArray(directorModelTestState.calibrationReports) ? directorModelTestState.calibrationReports : [];
  if (!profiles.length && !reports.length) {
    host.innerHTML = '<p class="app-settings-help">No calibration findings yet.</p>';
    return;
  }

  var profileByRef = {};
  profiles.forEach(function (profile) { profileByRef[String(profile.modelRef || '')] = profile; });
  var seen = {};
  var rows = reports.map(function (report) {
    var modelRef = String(report.modelRef || '');
    seen[modelRef] = true;
    var profile = profileByRef[modelRef] || null;
    var abilities = report.abilities && typeof report.abilities === 'object' ? report.abilities : {};
    var advertised = directorModelTestAdvertisedCapability(modelRef);
    var coherentOutput = Number(abilities.coherentOutputTokens || 0);
    var findings = [
      Number(abilities.contextTokens || 0) > 0 ? directorModelTestFormatCapacity(abilities.contextTokens) + ' context proven' : '',
      Number(abilities.structuredOutputTokens || 0) > 0 ? directorModelTestFormatCapacity(abilities.structuredOutputTokens) + ' structured output' : '',
      coherentOutput > 0 ? directorModelTestFormatCapacity(coherentOutput) + ' coherent output' : ''
    ].filter(Boolean);
    if (!findings.length) findings.push('No successful capability tier yet');
    if (coherentOutput >= 8192) findings.push('full-story output proven');
    else if (coherentOutput > 0) findings.push('individual scenes recommended');
    var pathologies = Array.isArray(report.pathologies) ? report.pathologies : [];
    if (pathologies.length) findings.push('warning: ' + pathologies.join(', '));
    var advertisedText = '';
    if (advertised) {
      advertisedText = advertised.contextLabel ? 'Advertised ' + advertised.contextLabel + ' context' : '';
      if (Number(advertised.recommendedOutputTokens || 0) > 0) {
        advertisedText += (advertisedText ? ' · ' : '') + directorModelTestFormatCapacity(advertised.recommendedOutputTokens) + ' recommended output';
      }
    }
    var failures = Array.isArray(report.attempts) ? report.attempts.filter(function (attempt) { return attempt.status === 'failed'; }) : [];
    var lastFailure = failures.length ? failures[failures.length - 1] : null;
    var failureText = lastFailure
      ? ' · stopped at ' + lastFailure.kind + ' ' + directorModelTestFormatCapacity(lastFailure.target) +
        (lastFailure.failureKind ? ' (' + lastFailure.failureKind + ')' : '')
      : '';
    var profileText = profile ? ' · Auto profile saved' : '';
    return '<div class="director-model-calibration-profile">' +
      '<div><strong>' + escapeHtml(report.label || report.modelId || report.modelRef || '') + '</strong>' +
      '<span>' + escapeHtml(report.runtimeName || report.runtimeId || '') + '</span></div>' +
      '<div class="app-settings-help"><strong>' + escapeHtml(directorModelTestHealthLabel(report.health)) + '</strong> · ' +
      escapeHtml(findings.join(' · ') + failureText + profileText) + '</div>' +
      (advertisedText ? '<div class="app-settings-help">' + escapeHtml(advertisedText) + '</div>' : '') +
      (report.error ? '<div class="app-settings-help">' + escapeHtml(report.error) + '</div>' : '') +
      '</div>';
  });

  profiles.forEach(function (profile) {
    var modelRef = String(profile.modelRef || '');
    if (seen[modelRef]) return;
    rows.push('<div class="director-model-calibration-profile">' +
      '<div><strong>' + escapeHtml(profile.label || profile.modelId || profile.modelRef || '') + '</strong>' +
      '<span>' + escapeHtml(profile.runtimeName || profile.runtimeId || '') + '</span></div>' +
      '<div class="app-settings-help">Validated profile · ' +
      escapeHtml(directorModelTestFormatCapacity(profile.contextSize) + ' context · ' +
        directorModelTestFormatCapacity(profile.maxTokens) + ' output') + '</div>' +
      '</div>');
  });
  host.innerHTML = rows.join('');
}

function directorModelTestLooksRepetitive(text) {
  var lines = String(text || '').split(/\n+/).map(function (line) {
    return line.trim().replace(/^\s*(?:Section\s+)?\d+[\.:\)]\s*/i, '');
  }).filter(function (line) { return line.length >= 80; });
  if (lines.length < 3) return false;
  var counts = {};
  for (var index = 0; index < lines.length; index += 1) {
    var key = lines[index];
    counts[key] = Number(counts[key] || 0) + 1;
    if (counts[key] >= 3) return true;
  }
  return false;
}

function directorModelTestLooksLeaky(text) {
  var value = String(text || '');
  return /<\/?(?:think|analysis|reasoning)>/i.test(value) ||
    /<\|(?:system|user|assistant|im_start|im_end|endoftext)[^>]*\|>/i.test(value) ||
    /\[\/?(?:INST|SYSTEM)\]/.test(value);
}

function directorModelTestLooksGarbled(text) {
  var value = String(text || '');
  if (!value) return false;
  var replacements = (value.match(/\uFFFD/g) || []).length;
  if (replacements >= 3) return true;
  var controls = 0;
  for (var index = 0; index < value.length; index += 1) {
    var code = value.charCodeAt(index);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) controls += 1;
  }
  return controls >= 3;
}

function directorModelTestCalibrationFailureKind(kind, terminalStatus, text, finishReason, passed) {
  if (passed) return '';
  if (terminalStatus && terminalStatus !== 'completed') return 'runtime';
  if (!String(text || '').trim()) return 'empty';
  if (directorModelTestLooksLeaky(text)) return 'leakage';
  if (directorModelTestLooksGarbled(text)) return 'garbled';
  if (directorModelTestLooksRepetitive(text)) return 'looping';
  if (finishReason === 'length' || finishReason === 'max_tokens') return 'capacity';
  if (kind === 'context') return 'malformed';
  return 'contract';
}

function directorModelTestStartAssessment(model) {
  return directorModelTestPost({
    action: 'start_assessment',
    model: model
  }).then(function (payload) {
    directorModelTestState.assessmentRuns = Array.isArray(payload.assessmentRuns) ? payload.assessmentRuns : [];
    return payload.assessment || null;
  });
}

function directorModelTestUpdateAssessment(assessmentId, attempts, summary, status, error, final) {
  if (!assessmentId) throw new Error('Director assessment ID is required.');
  return directorModelTestPost({
    action: 'update_assessment',
    assessmentId: assessmentId,
    attempts: attempts.slice(),
    summary: summary || {},
    status: status || '',
    error: error || '',
    final: !!final
  }).then(function (payload) {
    directorModelTestState.assessmentRuns = Array.isArray(payload.assessmentRuns) ? payload.assessmentRuns : [];
    return payload.assessment || null;
  });
}

function directorModelTestSaveCalibrationReport(model, contextMode, contextSize, maxTokens, attempts, status, error) {
  return directorModelTestPost({
    action: 'save_calibration_report',
    report: {
      modelRef: model.modelRef,
      runtimeId: model.runtimeId,
      runtimeName: model.runtimeName,
      modelId: model.modelId,
      label: model.label,
      contextMode: contextMode,
      contextSize: contextSize,
      maxTokens: maxTokens,
      status: status || 'incomplete',
      error: error || '',
      attempts: attempts.slice()
    }
  }).then(function (payload) {
    directorModelTestState.calibrationReports = Array.isArray(payload.calibrationReports) ? payload.calibrationReports : [];
    directorModelTestRenderCalibrationProfiles();
    return payload.report || null;
  });
}

function directorModelAssessmentSize(bytes) {
  var value = Number(bytes);
  if (!isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return Math.round(value) + ' B';
  if (value < 1024 * 1024) return (value / 1024).toFixed(value < 10240 ? 1 : 0) + ' KiB';
  return (value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0) + ' MiB';
}

function directorModelAssessmentRenderHistory() {
  var host = directorModelTestEl('director-model-assessment-history');
  if (!host) throw new Error('Director assessment history markup is missing.');
  var runs = Array.isArray(directorModelTestState.assessmentRuns) ? directorModelTestState.assessmentRuns : [];
  if (!runs.length) {
    host.innerHTML = '<p class="app-settings-help">No assessment runs yet.</p>';
    return;
  }
  host.innerHTML = runs.map(function (run) {
    var model = run.model && typeof run.model === 'object' ? run.model : {};
    var date = run.startedAt ? new Date(run.startedAt).toLocaleString() : '';
    var meta = [
      run.status || 'unknown',
      String(Number(run.attemptCount || 0)) + ' probes',
      directorModelAssessmentSize(run.bytes),
      date
    ].filter(Boolean).join(' · ');
    return '<details class="app-settings-advanced director-model-assessment-run" data-assessment-id="' + escapeHtml(run.id || '') + '">' +
      '<summary><span><strong>' + escapeHtml(model.label || model.modelId || run.id || '') + '</strong></span>' +
      '<span class="app-settings-help">' + escapeHtml(meta) + '</span></summary>' +
      '<div class="app-settings-disclosure-body">' +
        '<div class="app-settings-actions app-settings-actions-inline">' +
          '<button type="button" class="review-captions-btn" data-director-assessment-view="' + escapeHtml(run.id || '') + '">Load Full Evidence</button>' +
          '<button type="button" class="review-captions-btn" data-director-assessment-delete="' + escapeHtml(run.id || '') + '">Delete Raw Evidence</button>' +
        '</div>' +
        '<div class="director-model-assessment-evidence" data-director-assessment-evidence="' + escapeHtml(run.id || '') + '"></div>' +
      '</div>' +
    '</details>';
  }).join('');
}

function directorModelAssessmentLoadEvidence(assessmentId) {
  return directorModelTestPost({
    action: 'get_assessment',
    assessmentId: assessmentId
  }).then(function (payload) {
    var host = document.querySelector('[data-director-assessment-evidence="' + CSS.escape(String(assessmentId)) + '"]');
    if (!host) throw new Error('Director assessment evidence host is missing.');
    host.innerHTML = '<pre class="app-settings-json director-model-test-output">' +
      escapeHtml(JSON.stringify(payload.assessment || {}, null, 2)) +
      '</pre>';
  });
}

function directorModelAssessmentDeleteEvidence(assessmentId) {
  return directorModelTestPost({
    action: 'delete_assessment',
    assessmentId: assessmentId
  }).then(function (payload) {
    directorModelTestState.assessmentRuns = Array.isArray(payload.assessmentRuns) ? payload.assessmentRuns : [];
    directorModelAssessmentRenderHistory();
    reportConsoleInfo('Director Model Assessment', 'Deleted raw assessment evidence; learned model results were preserved.');
  });
}

function directorModelTestCalibrationAttempt(model, kind, target, contextSize) {
  var tracker = { phase: '', phaseStartedAt: 0, phases: {}, observedContextSize: 0 };
  var prompt = '';
  var localStartedAt = Date.now() / 1000;
  directorModelTestState.currentPhase = 'queued';
  directorModelTestRenderStatus();
  return directorModelTestPost({
    action: 'enqueue_calibration',
    modelRef: model.modelRef,
    kind: kind,
    target: target,
    contextSize: contextSize || null
  }).then(function (payload) {
    prompt = String(payload.prompt || '');
    directorModelTestState.currentJobId = String(payload.job && payload.job.jobId || '');
    if (!directorModelTestState.currentJobId) throw new Error('Director calibration did not receive a job ID.');
    reportConsoleInfo(
      'Director Model Calibration',
      (kind === 'context' ? 'Context ' : (kind === 'prose' ? 'Long-form ' : 'Output ')) + directorModelTestFormatCapacity(target) +
        ' · ' + (model.label || model.modelId || model.modelRef)
    );
    return directorModelTestWaitForJob(directorModelTestState.currentJobId, tracker);
  }).then(function (job) {
    directorModelTestClosePhase(tracker);
    job = job || {};
    var result = job.result && typeof job.result === 'object' ? job.result : {};
    var usage = result.usage && typeof result.usage === 'object' ? result.usage : {};
    var timings = result.timings && typeof result.timings === 'object' ? result.timings : {};
    var text = String(result.text || '');
    var finishReason = String(result.finishReason || '').toLowerCase();
    var promptTokens = directorModelTestMetric(usage, 'prompt_tokens') || directorModelTestMetric(timings, 'prompt_n');
    var completionTokens = directorModelTestMetric(usage, 'completion_tokens') || directorModelTestMetric(timings, 'predicted_n');
    var observedContext = Number(result.contextSize || tracker.observedContextSize || 0);
    var totalSeconds = Math.max(0, (Number(job.finishedAt) || Date.now() / 1000) - (Number(job.createdAt) || localStartedAt));
    var tokensPerSecond = directorModelTestMetric(timings, 'predicted_per_second');
    var terminalStatus = String(job.status || '');
    var passed = terminalStatus === 'completed';

    if (kind === 'context') {
      passed = passed && observedContext >= Number(target) && text.trim() === 'CONTEXT_OK';
    } else {
      var calibrationProtocol = directorModelTestState.calibrationProtocol || {};
      passed = passed && ['length', 'max_tokens'].indexOf(finishReason) === -1;
      if (kind === 'prose') {
        var expectedSections = Number((calibrationProtocol.proseSectionCounts || {})[String(target)] || 0);
        var finalSectionPattern = expectedSections > 0
          ? new RegExp('(^|\\n)\\s*Section\\s+' + String(expectedSections) + '\\s*:', 'mi')
          : null;
        passed = passed &&
          text.indexOf(String(calibrationProtocol.proseMarker || 'WEB_CAP_LONGFORM_COMPLETE')) !== -1 &&
          (!finalSectionPattern || finalSectionPattern.test(text));
      } else {
        var expectedItems = Number((calibrationProtocol.outputItemCounts || {})[String(target)] || 0);
        var finalItemPattern = expectedItems > 0
          ? new RegExp('(^|\\n)\\s*' + String(expectedItems) + '[\\.\\)]\\s+', 'm')
          : null;
        passed = passed &&
          text.indexOf(String(calibrationProtocol.marker || 'WEB_CAP_CALIBRATION_COMPLETE')) !== -1 &&
          (!finalItemPattern || finalItemPattern.test(text));
      }
    }

    var obviousPathology = directorModelTestLooksLeaky(text) ||
      directorModelTestLooksGarbled(text) ||
      directorModelTestLooksRepetitive(text);
    if (obviousPathology) passed = false;

    return {
      kind: kind,
      target: Number(target),
      status: passed ? 'passed' : 'failed',
      finishReason: finishReason,
      error: String(job.error || (passed ? '' : 'Calibration target did not complete cleanly.')),
      failureKind: directorModelTestCalibrationFailureKind(kind, terminalStatus, text, finishReason, passed),
      prompt: prompt,
      text: text,
      promptTokens: promptTokens,
      completionTokens: completionTokens,
      observedContextSize: isFinite(observedContext) && observedContext > 0 ? observedContext : 0,
      totalSeconds: totalSeconds,
      tokensPerSecond: tokensPerSecond
    };
  }).finally(function () {
    var jobId = directorModelTestState.currentJobId;
    directorModelTestState.currentJobId = '';
    return jobId ? directorModelTestConsumeJob(jobId) : null;
  });
}

function directorModelTestCalibrateOne(model, modelNumber) {
  var protocol = directorModelTestState.calibrationProtocol || {};
  var contextSteps = Array.isArray(protocol.contextSteps) ? protocol.contextSteps.slice() : [];
  var outputSteps = Array.isArray(protocol.outputSteps) ? protocol.outputSteps.slice() : [];
  var advertised = directorModelTestAdvertisedCapability(model.modelRef);
  var recommendedContextMax = Number(advertised && advertised.recommendedContextMax || 0);
  var recommendedOutputTokens = Number(advertised && advertised.recommendedOutputTokens || 0);
  if (isFinite(recommendedContextMax) && recommendedContextMax > 0) {
    contextSteps = contextSteps.filter(function (target) { return Number(target) <= recommendedContextMax; });
  }
  if (isFinite(recommendedOutputTokens) && recommendedOutputTokens > 0) {
    outputSteps = outputSteps.filter(function (target) { return Number(target) <= recommendedOutputTokens; });
  }
  var attempts = [];
  var contextMode = model.runtimeId === 'local' ? 'calibrated' : 'runtime';
  var contextSize = 0;
  var maxTokens = 0;
  var assessmentId = '';

  directorModelTestState.currentModelLabel = String(model.label || model.modelId || model.modelRef || 'Model');
  directorModelTestState.currentModelNumber = modelNumber;
  directorModelTestState.currentRuntimeName = String(model.runtimeName || model.runtimeId || 'runtime');

  if (isFinite(recommendedContextMax) && recommendedContextMax > 0) {
    reportConsoleInfo(
      'Director Model Assessment',
      model.label + ' · respecting published recommended context ceiling ' +
        directorModelTestFormatCapacity(recommendedContextMax) + '.'
    );
  }
  if (isFinite(recommendedOutputTokens) && recommendedOutputTokens > 0 &&
      outputSteps.length && Number(outputSteps[outputSteps.length - 1]) < Number((protocol.outputSteps || [])[protocol.outputSteps.length - 1] || 0)) {
    reportConsoleInfo(
      'Director Model Assessment',
      model.label + ' · respecting published recommended output ceiling ' +
        directorModelTestFormatCapacity(recommendedOutputTokens) + '.'
    );
  }

  function record(status, error, final) {
    return directorModelTestSaveCalibrationReport(
      model, contextMode, contextSize, maxTokens, attempts, status || 'incomplete', error || ''
    ).then(function (report) {
      return directorModelTestUpdateAssessment(
        assessmentId,
        attempts,
        report || {},
        status || 'incomplete',
        error || '',
        !!final
      ).then(function () { return report; });
    });
  }

  function runAttempt(kind, target) {
    return directorModelTestCalibrationAttempt(
      model,
      kind,
      target,
      contextMode === 'calibrated' && kind !== 'context' ? contextSize : null
    ).then(function (attempt) {
      attempts.push(attempt);
      if (kind === 'context' && attempt.status === 'passed') contextSize = Number(target);
      if (contextMode === 'runtime' && attempt.observedContextSize > contextSize) {
        contextSize = attempt.observedContextSize;
      }
      if (kind === 'prose' && attempt.status === 'passed') maxTokens = Number(target);
      return record('incomplete', '', false).then(function () { return attempt; });
    }).catch(function (error) {
      attempts.push({
        kind: kind,
        target: Number(target),
        status: 'failed',
        finishReason: '',
        error: error.message || String(error),
        failureKind: 'runtime',
        promptTokens: 0,
        completionTokens: 0,
        observedContextSize: 0,
        totalSeconds: 0,
        tokensPerSecond: 0
      });
      return record('error', error.message || String(error), false).then(function () { return attempts[attempts.length - 1]; });
    });
  }

  var chain = directorModelTestStartAssessment(model).then(function (assessment) {
    assessmentId = String(assessment && assessment.id || '');
    if (!assessmentId) throw new Error('Director assessment did not receive an assessment ID.');
    return directorModelTestPost({
      action: 'begin_calibration',
      modelRef: model.modelRef
    });
  }).then(function (payload) {
    directorModelTestState.calibrationProfiles = Array.isArray(payload.calibrationProfiles) ? payload.calibrationProfiles : [];
    directorModelTestState.calibrationReports = Array.isArray(payload.calibrationReports) ? payload.calibrationReports : [];
    directorModelTestRenderCalibrationProfiles();
  });
  if (model.runtimeId === 'local') {
    contextSteps.forEach(function (target) {
      chain = chain.then(function () {
        if (directorModelTestState.stopRequested) return;
        var previous = attempts.filter(function (attempt) { return attempt.kind === 'context'; });
        if (previous.length && previous[previous.length - 1].status === 'failed') return;
        return runAttempt('context', target);
      });
    });
  }

  outputSteps.forEach(function (target) {
    chain = chain.then(function () {
      if (directorModelTestState.stopRequested) return;
      if (contextMode === 'calibrated' && !contextSize) return;
      var previousCapacity = attempts.filter(function (attempt) {
        return attempt.kind === 'output' || attempt.kind === 'prose';
      });
      if (previousCapacity.length && previousCapacity[previousCapacity.length - 1].status === 'failed') return;
      return runAttempt('output', target).then(function (attempt) {
        if (!attempt || attempt.status !== 'passed' || directorModelTestState.stopRequested) return;
        return runAttempt('prose', target);
      });
    });
  });

  return chain.then(function () {
    if (directorModelTestState.stopRequested) {
      return record('stopped', '', true).then(function () { return null; });
    }

    var reportStatus = maxTokens > 0 ? 'complete' : 'incomplete';
    return record(reportStatus, '', true).then(function () {
      if (contextMode === 'calibrated' && !contextSize) {
        reportConsoleWarning('Director Model Calibration', 'No local context tier passed for ' + model.label + '; findings were saved but no Auto profile was created.');
        return null;
      }
      if (!maxTokens) {
        reportConsoleWarning('Director Model Calibration', 'No coherent output tier passed for ' + model.label + '; findings were saved but no Auto profile was created.');
        return null;
      }
      return directorModelTestPost({
        action: 'save_calibration_profile',
        profile: {
          modelRef: model.modelRef,
          runtimeId: model.runtimeId,
          runtimeName: model.runtimeName,
          modelId: model.modelId,
          label: model.label,
          contextMode: contextMode,
          contextSize: contextSize,
          maxTokens: maxTokens,
          attempts: attempts
        }
      }).then(function (payload) {
        directorModelTestState.calibrationProfiles = Array.isArray(payload.calibrationProfiles) ? payload.calibrationProfiles : [];
        directorModelTestState.calibrationReports = Array.isArray(payload.calibrationReports) ? payload.calibrationReports : directorModelTestState.calibrationReports;
        directorModelTestRenderCalibrationProfiles();
        reportConsoleInfo(
          'Director Model Calibration',
          'Saved ' + model.label + ' · ' +
            (contextMode === 'calibrated' ? directorModelTestFormatCapacity(contextSize) + ' context · ' : '') +
            directorModelTestFormatCapacity(maxTokens) + ' coherent output proven.'
        );
        return payload.profile || null;
      });
    });
  });
}

function directorModelAssessmentOrderModels(models) {
  if (!shellWorkloadState.trainingActive) return models;

  var remote = models.filter(function (model) { return model.runtimeId !== 'local'; });
  var local = models.filter(function (model) { return model.runtimeId === 'local'; });
  return remote.concat(local);
}

function directorModelTestStartCalibration() {
  if (directorModelTestState.running) return;
  var models = directorModelAssessmentOrderModels(directorModelAssessmentSelectedModels());
  if (!models.length) {
    directorModelTestSetStatus('Choose at least one model.', 'ready', 'Ready');
    return;
  }
  if (!directorModelTestState.calibrationProtocol) {
    throw new Error('Director model calibration protocol is missing.');
  }

  directorModelTestState.running = true;
  directorModelTestState.mode = 'calibration';
  directorModelTestState.stopRequested = false;
  directorModelTestState.calibrationTotal = models.length;
  directorModelTestState.startedAt = Date.now() / 1000;
  directorModelTestSyncControls();
  directorModelTestRenderStatus();
  reportConsoleInfo('Director Model Calibration', 'Starting progressive calibration for ' + String(models.length) + ' model' + (models.length === 1 ? '' : 's') + '.');

  var chain = Promise.resolve();
  models.forEach(function (model, index) {
    chain = chain.then(function () {
      if (directorModelTestState.stopRequested) return;
      return directorModelTestCalibrateOne(model, index + 1);
    });
  });

  chain.catch(function (error) {
    reportConsoleError('Director Model Calibration', error);
  }).finally(function () {
    var assessmentSummary = directorModelTestEl('director-model-assessment-summary-status');
    if (assessmentSummary) {
      assessmentSummary.textContent = directorModelTestState.stopRequested ? 'Stopped' : 'Complete';
      assessmentSummary.dataset.state = directorModelTestState.stopRequested ? 'stopped' : 'complete';
    }
    directorModelTestState.running = false;
    directorModelTestState.currentJobId = '';
    directorModelTestState.currentModelLabel = '';
    directorModelTestState.currentModelNumber = 0;
    directorModelTestState.currentPhase = '';
    directorModelTestState.currentRuntimeName = '';
    directorModelTestState.calibrationTotal = 0;
    directorModelTestState.startedAt = 0;
    directorModelTestState.mode = '';
    directorModelTestSyncControls();
    directorModelTestRenderStatus();
    directorModelTestRefresh().catch(function () {});
  });
}

function directorModelTestClearCalibration() {
  if (directorModelTestState.running) return;
  directorModelTestPost({ action: 'clear_calibration_profiles' }).then(function (payload) {
    directorModelTestState.calibrationProfiles = Array.isArray(payload.calibrationProfiles) ? payload.calibrationProfiles : [];
    directorModelTestState.calibrationReports = Array.isArray(payload.calibrationReports) ? payload.calibrationReports : [];
    directorModelTestRenderCalibrationProfiles();
    directorModelTestSyncControls();
    reportConsoleInfo('Director Model Calibration', 'Cleared saved calibration profiles and findings.');
  }).catch(function (error) {
    reportConsoleError('Director Model Calibration', error);
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
      reportConsoleInfo(
        'Director Model Test',
        'Completed ' + (model.label || model.modelId || model.modelRef) +
          ' · finish_reason=' + (run.finishReason || 'unknown') +
          ' · completion_tokens=' + String(Math.round(run.completionTokens || 0))
      );
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
  directorModelTestState.mode = 'test';
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
    directorModelTestState.mode = '';
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
  if (!directorModelTestEl('director-model-test-settings') || !directorModelTestEl('director-model-assessment-settings')) {
    throw new Error('Director diagnostic markup is missing.');
  }

  directorModelTestEl('director-model-test-refresh').addEventListener('click', directorModelTestRefresh);
  directorModelTestEl('director-model-assessment-refresh').addEventListener('click', directorModelTestRefresh);

  directorModelTestEl('director-model-test-select-all').addEventListener('click', function () {
    Array.prototype.forEach.call(document.querySelectorAll('[data-director-model-test-model]'), function (input) { input.checked = true; });
  });
  directorModelTestEl('director-model-test-select-none').addEventListener('click', function () {
    Array.prototype.forEach.call(document.querySelectorAll('[data-director-model-test-model]'), function (input) { input.checked = false; });
  });
  directorModelTestEl('director-model-assessment-select-all').addEventListener('click', function () {
    Array.prototype.forEach.call(document.querySelectorAll('[data-director-model-assessment-model]'), function (input) { input.checked = true; });
  });
  directorModelTestEl('director-model-assessment-select-none').addEventListener('click', function () {
    Array.prototype.forEach.call(document.querySelectorAll('[data-director-model-assessment-model]'), function (input) { input.checked = false; });
  });

  directorModelTestEl('director-model-test-run').addEventListener('click', directorModelTestStart);
  directorModelTestEl('director-model-assessment-run').addEventListener('click', directorModelTestStartCalibration);
  directorModelTestEl('director-model-test-clear-calibration').addEventListener('click', directorModelTestClearCalibration);
  directorModelTestEl('director-model-test-stop').addEventListener('click', directorModelTestStop);
  directorModelTestEl('director-model-assessment-stop').addEventListener('click', directorModelTestStop);
  directorModelTestEl('director-model-test-export').addEventListener('click', directorModelTestExport);
  directorModelTestEl('director-model-assessment-history').addEventListener('click', function (event) {
    var view = event.target.closest('[data-director-assessment-view]');
    if (view) {
      directorModelAssessmentLoadEvidence(view.getAttribute('data-director-assessment-view')).catch(function (error) {
        reportConsoleError('Director Model Assessment', error);
      });
      return;
    }
    var remove = event.target.closest('[data-director-assessment-delete]');
    if (remove) {
      directorModelAssessmentDeleteEvidence(remove.getAttribute('data-director-assessment-delete')).catch(function (error) {
        reportConsoleError('Director Model Assessment', error);
      });
    }
  });

  directorModelTestRenderSession();
  directorModelAssessmentRenderHistory();
  directorModelTestSyncControls();
}

initializeDirectorModelTest();
