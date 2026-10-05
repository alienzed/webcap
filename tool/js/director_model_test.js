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

function directorModelAssessmentSyncGroupSelectors() {
  Array.prototype.forEach.call(document.querySelectorAll('[data-director-assessment-group]'), function (group) {
    var selector = group.querySelector('[data-director-assessment-group-select]');
    if (!selector) return;
    var rows = Array.prototype.slice.call(group.querySelectorAll('[data-director-model-assessment-model]'));
    var selected = rows.filter(function (input) { return input.checked; }).length;
    selector.checked = rows.length > 0 && selected === rows.length;
    selector.indeterminate = selected > 0 && selected < rows.length;
  });
}

function directorModelAssessmentRenderSelectionSummary() {
  var progress = directorModelTestEl('director-model-assessment-progress');
  var selection = directorModelTestEl('director-model-assessment-selection-summary');
  var assess = directorModelTestEl('director-model-assessment-run');
  if (!progress || !selection || !assess) throw new Error('Director model assessment summary markup is missing.');

  var counts = { needs: 0, incomplete: 0, assessed: 0 };
  var selectedCount = 0;
  directorModelTestState.models.forEach(function (model) {
    var report = directorModelAssessmentReportForModel(model.id);
    var profile = directorModelAssessmentProfileForModel(model.id);
    var state = directorModelAssessmentModelState(report, profile);
    counts[state] += 1;
  });
  Array.prototype.forEach.call(
    document.querySelectorAll('[data-director-model-assessment-model]:checked'),
    function () { selectedCount += 1; }
  );

  var needsWork = counts.needs + counts.incomplete;
  progress.textContent = String(counts.assessed) + ' assessed · ' + String(needsWork) + ' need assessment';
  selection.textContent =
    String(counts.needs) + ' new · ' +
    String(counts.incomplete) + ' retry · ' +
    String(selectedCount) + ' selected';
  assess.textContent = selectedCount ? 'Assess ' + String(selectedCount) : 'Assess Selected';
  directorModelAssessmentSyncGroupSelectors();
}

function directorModelTestRenderModels() {
  directorModelAssessmentRenderModels();
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
  var clearRaw = directorModelTestEl('director-model-assessment-clear-raw');
  var benchmarkStop = directorModelTestEl('director-model-test-stop');
  var assessmentStop = directorModelTestEl('director-model-assessment-stop');
  var benchmarkRefresh = directorModelTestEl('director-model-test-refresh');
  var assessmentRefresh = directorModelTestEl('director-model-assessment-refresh');

  if (!run || !assess || !clearCalibration || !clearRaw || !benchmarkStop || !assessmentStop || !benchmarkRefresh || !assessmentRefresh) {
    throw new Error('Director diagnostic controls are incomplete.');
  }

  run.disabled = directorModelTestState.running || !directorModelTestState.models.length;
  assess.disabled = directorModelTestState.running || !directorModelAssessmentSelectedModels().length;
  clearCalibration.disabled = directorModelTestState.running || (!directorModelTestState.calibrationProfiles.length && !directorModelTestState.calibrationReports.length);
  clearRaw.disabled = directorModelTestState.running || !directorModelTestState.assessmentRuns.length;
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

function directorModelTestHealthLabel(value, status) {
  value = String(value || '');
  if (value === 'healthy') return 'Assessment complete';
  if (value === 'limited') return 'Usable · output limit found';
  if (value === 'warning') return 'Usable · quality warning';
  if (value === 'likely-unusable') return 'Not recommended';
  if (value === 'assessment-incomplete') return status === 'complete'
    ? 'Usable range found · some checks inconclusive'
    : 'Assessment incomplete · usable range found';
  if (value === 'assessment-failed' || value === 'calibration-failed') return 'Assessment interrupted';
  if (value === 'stopped') return 'Stopped';
  return 'Incomplete';
}

function directorModelAssessmentFailureLabel(value) {
  value = String(value || '');
  if (value === 'runtime') return 'runtime failed';
  if (value === 'capacity') return 'output limit reached';
  if (value === 'contract') return 'test instructions not followed';
  if (value === 'malformed') return 'unexpected response format';
  if (value === 'looping') return 'repetitive / looping output';
  if (value === 'leakage') return 'internal / control text leaked';
  if (value === 'garbled') return 'garbled output';
  if (value === 'empty') return 'empty response';
  if (value === 'stopped') return 'stopped';
  return value;
}

function directorModelAssessmentLatestRun(modelRef, report) {
  var runs = Array.isArray(directorModelTestState.assessmentRuns) ? directorModelTestState.assessmentRuns : [];
  return runs.find(function (run) {
    var model = run && run.model && typeof run.model === 'object' ? run.model : {};
    return String(model.modelRef || '') === String(modelRef || '') &&
      run.summary && run.summary.updatedAt === report.updatedAt;
  }) || null;
}

function directorModelAssessmentFailureShortLabel(value) {
  value = String(value || '');
  if (value === 'runtime') return 'runtime failed';
  if (value === 'capacity') return 'output limit reached';
  if (value === 'contract') return 'instructions not followed';
  if (value === 'malformed') return 'unexpected response format';
  if (value === 'looping') return 'repetitive / looping output';
  if (value === 'leakage') return 'control text leaked';
  if (value === 'garbled') return 'garbled output';
  if (value === 'empty') return 'empty response';
  if (value === 'stopped') return 'stopped';
  return value || 'failed';
}

function directorModelAssessmentAttemptShortLabel(kind) {
  if (kind === 'context') return 'Context';
  if (kind === 'output') return 'Structured response';
  if (kind === 'prose') return 'Long-form writing';
  return String(kind || 'Probe');
}

function directorModelAssessmentReportForModel(modelRef) {
  var reports = Array.isArray(directorModelTestState.calibrationReports) ? directorModelTestState.calibrationReports : [];
  return reports.find(function (report) {
    return String(report.modelRef || '') === String(modelRef || '');
  }) || null;
}

function directorModelAssessmentProfileForModel(modelRef) {
  var profiles = Array.isArray(directorModelTestState.calibrationProfiles) ? directorModelTestState.calibrationProfiles : [];
  return profiles.find(function (profile) {
    return String(profile.modelRef || '') === String(modelRef || '');
  }) || null;
}

function directorModelAssessmentModelState(report, profile) {
  if (!report) return profile ? 'assessed' : 'needs';
  var health = String(report.health || '');
  if (health === 'likely-unusable') return 'assessed';
  var abilities = report.abilities && typeof report.abilities === 'object' ? report.abilities : {};
  var coherentOutput = Number(abilities.coherentOutputTokens || 0);
  if (String(report.status || '') === 'complete' && coherentOutput > 0 &&
      ['healthy', 'limited', 'warning'].indexOf(health) !== -1) return 'assessed';
  return 'incomplete';
}

function directorModelAssessmentRetryReason(report) {
  if (!report) return 'Retry to establish a dependable WebCap usage profile.';
  if (String(report.status || '') === 'stopped' || String(report.health || '') === 'stopped') {
    return 'Previous assessment was stopped.';
  }
  var attempts = Array.isArray(report.attempts) ? report.attempts : [];
  var failed = attempts.slice().reverse().find(function (attempt) {
    return attempt.status === 'failed';
  }) || null;
  if (failed) {
    return directorModelAssessmentAttemptShortLabel(failed.kind) + ' test: ' +
      directorModelAssessmentFailureShortLabel(failed.failureKind || 'failed') + '.';
  }
  if (String(report.error || '').trim()) return 'Previous assessment hit a runtime error.';
  return 'Previous assessment did not establish a dependable usage profile.';
}

function directorModelAssessmentCapability(report, profile) {
  if (!report && !profile) {
    return { label: '', tone: 'neutral', copy: '' };
  }

  if (!report && profile) {
    var savedOutput = Number(profile.maxTokens || 0);
    return savedOutput >= 8192
      ? { label: 'Full-story Director', tone: 'good', copy: 'First Cut + full-story development.' }
      : { label: 'Scene-by-scene Director', tone: 'good', copy: 'Scene development + revisions.' };
  }

  var health = String(report.health || '');
  var status = String(report.status || '');
  var abilities = report.abilities && typeof report.abilities === 'object' ? report.abilities : {};
  var coherentOutput = Number(abilities.coherentOutputTokens || 0);

  if (health === 'likely-unusable') {
    return {
      label: 'Not recommended',
      tone: 'bad',
      copy: 'Assessment found model-output problems.'
    };
  }
  if (status !== 'complete' || ['assessment-failed', 'calibration-failed', 'assessment-incomplete', 'stopped'].indexOf(health) !== -1) {
    return {
      label: 'Needs retry',
      tone: 'limited',
      copy: directorModelAssessmentRetryReason(report)
    };
  }
  if (coherentOutput >= 8192) {
    return {
      label: 'Full-story Director',
      tone: health === 'warning' ? 'limited' : 'good',
      copy: 'First Cut + full-story development.' + (health === 'warning' ? ' Quality warning recorded.' : '')
    };
  }
  if (coherentOutput > 0) {
    return {
      label: 'Scene-by-scene Director',
      tone: health === 'warning' ? 'limited' : 'good',
      copy: 'Scene development + revisions.' + (health === 'warning' ? ' Quality warning recorded.' : '')
    };
  }
  return {
    label: 'Needs retry',
    tone: 'limited',
    copy: directorModelAssessmentRetryReason(report)
  };
}

function directorModelAssessmentAttemptRows(report) {
  var attempts = report && Array.isArray(report.attempts) ? report.attempts : [];
  if (!attempts.length) return '<p class="app-settings-help">No assessment tests recorded yet.</p>';

  return '<div class="director-model-assessment-tests">' +
    '<div class="director-model-assessment-detail-title">Assessment tests</div>' +
    attempts.map(function (attempt) {
      var passed = attempt.status === 'passed';
      var stopped = attempt.status === 'stopped';
      var statusClass = passed ? 'passed' : (stopped ? 'stopped' : 'failed');
      var result = passed
        ? 'Passed'
        : (stopped ? 'Stopped' : directorModelAssessmentFailureShortLabel(attempt.failureKind || 'failed'));
      var note = String(attempt.note || '').trim();
      return '<div class="director-model-assessment-test ' + statusClass + '">' +
        '<span class="director-model-assessment-test-mark">' + (passed ? '✓' : (stopped ? '■' : '×')) + '</span>' +
        '<span class="director-model-assessment-test-name">' + escapeHtml(directorModelAssessmentAttemptShortLabel(attempt.kind)) + '</span>' +
        '<span class="director-model-assessment-test-target">' + escapeHtml(directorModelTestFormatCapacity(attempt.target)) + '</span>' +
        '<span class="director-model-assessment-test-result">' + escapeHtml(result) + '</span>' +
        (note ? '<span class="director-model-assessment-test-note">' + escapeHtml(note) + '</span>' : '') +
      '</div>';
    }).join('') +
  '</div>';
}

function directorModelAssessmentDetailSummary(report, profile, modelRef) {
  if (!report) {
    return profile
      ? '<p class="app-settings-help">A saved Auto profile exists, but the detailed assessment report is not available.</p>'
      : '<p class="app-settings-help">This model has not been assessed yet.</p>';
  }

  var abilities = report.abilities && typeof report.abilities === 'object' ? report.abilities : {};
  var limits = [
    Number(abilities.contextTokens || 0) > 0
      ? 'Context: ' + directorModelTestFormatCapacity(abilities.contextTokens)
      : '',
    Number(abilities.structuredOutputTokens || 0) > 0
      ? 'Structured: ' + directorModelTestFormatCapacity(abilities.structuredOutputTokens)
      : '',
    Number(abilities.coherentOutputTokens || 0) > 0
      ? 'Long-form: ' + directorModelTestFormatCapacity(abilities.coherentOutputTokens)
      : ''
  ].filter(Boolean);

  var advertised = directorModelTestAdvertisedCapability(modelRef);
  var advertisedText = '';
  if (advertised) {
    advertisedText = advertised.contextLabel ? 'Published spec: ' + advertised.contextLabel + ' context' : 'Published spec';
    if (Number(advertised.recommendedOutputTokens || 0) > 0) {
      advertisedText += ' · ' + directorModelTestFormatCapacity(advertised.recommendedOutputTokens) + ' output';
    }
  }

  var pathologies = Array.isArray(report.pathologies) ? report.pathologies : [];
  var reportError = String(report.error || '');
  return '<div class="director-model-assessment-detail-summary">' +
    (limits.length ? '<div class="app-settings-help"><strong>Proven limits:</strong> ' + escapeHtml(limits.join(' · ')) + '</div>' : '') +
    (profile ? '<div class="app-settings-help">Auto profile saved.</div>' : '') +
    (advertisedText ? '<div class="app-settings-help">' + escapeHtml(advertisedText) + '</div>' : '') +
    (pathologies.length ? '<div class="app-settings-help director-model-finding-error">Model warning: ' +
      escapeHtml(pathologies.map(directorModelAssessmentFailureLabel).join(', ')) + '</div>' : '') +
    (reportError ? '<div class="app-settings-help director-model-finding-error">Assessment error: ' + escapeHtml(reportError) + '</div>' : '') +
  '</div>';
}

function directorModelAssessmentModelRow(model, report, profile, previousSelection, previousOpen) {
  var modelRef = String(model.id || '');
  var state = directorModelAssessmentModelState(report, profile);
  var capability = directorModelAssessmentCapability(report, profile);
  var previous = previousSelection[modelRef] || null;
  var checked = previous ? !!previous.checked : false;
  if (previous && previous.state !== 'assessed' && state === 'assessed') checked = false;

  var latestRun = report ? directorModelAssessmentLatestRun(modelRef, report) : null;
  var runtime = String(model.runtimeName || model.runtimeId || (String(model.runtimeId || '') === 'local' ? 'Local' : ''));
  var size = directorModelTestSize(model.sizeBytes);
  var meta = [runtime, size !== '—' ? size : ''].filter(Boolean).join(' · ');
  var runtimeTitle = String(model.runtimeId || '') === 'local'
    ? 'Local assessment uses the shared GPU and waits while Training or Inference owns it.'
    : 'Remote assessment does not require the local GPU.';
  var label = String(model.label || model.modelId || model.id || '');
  var open = !!previousOpen[modelRef];

  var details =
    directorModelAssessmentDetailSummary(report, profile, modelRef) +
    directorModelAssessmentAttemptRows(report);

  if (latestRun && latestRun.id) {
    details += '<div class="director-model-assessment-evidence" data-director-assessment-evidence-host>' +
      '<p class="app-settings-help">Full prompts and model outputs load when this model is expanded.</p>' +
    '</div>';
  } else if (report || profile) {
    details += '<p class="app-settings-help director-model-finding-unavailable">Raw evidence for this learned result is no longer available.</p>';
  }

  return '<details class="director-model-assessment-model" data-director-model-ref="' + escapeHtml(modelRef) + '" ' +
      'data-director-model-state="' + escapeHtml(state) + '"' +
      (latestRun && latestRun.id ? ' data-director-assessment-evidence-id="' + escapeHtml(String(latestRun.id)) + '"' : '') +
      (open ? ' open' : '') + '>' +
    '<summary>' +
      '<span class="director-model-assessment-check">' +
        '<input type="checkbox" data-director-model-assessment-model="' + escapeHtml(modelRef) + '" ' +
          'data-director-model-state="' + escapeHtml(state) + '"' + (checked ? ' checked' : '') + ' aria-label="Select ' + escapeHtml(label) + ' for assessment">' +
      '</span>' +
      '<span class="director-model-assessment-model-identity" title="' + escapeHtml(label) + '">' +
        '<strong>' + escapeHtml(label) + '</strong>' +
        '<span title="' + escapeHtml(runtimeTitle) + '">' + escapeHtml(meta) + '</span>' +
      '</span>' +
      (capability.label || capability.copy
        ? '<span class="director-model-assessment-capability">' +
            (capability.label ? '<span class="director-model-verdict director-model-verdict-' + escapeHtml(capability.tone) + '">' + escapeHtml(capability.label) + '</span>' : '') +
            (capability.copy ? '<span class="director-model-assessment-capability-copy">' + escapeHtml(capability.copy) + '</span>' : '') +
          '</span>'
        : '<span class="director-model-assessment-capability director-model-assessment-capability-empty"></span>') +
    '</summary>' +
    '<div class="app-settings-disclosure-body director-model-assessment-model-details">' + details + '</div>' +
  '</details>';
}

function directorModelAssessmentRenderGroup(key, title, copy, models, reportByRef, profileByRef, previousSelection, previousOpen, previousGroups) {
  if (!models.length) return '';
  var open = Object.prototype.hasOwnProperty.call(previousGroups, key)
    ? previousGroups[key]
    : key !== 'assessed';
  return '<details class="director-model-assessment-group director-model-assessment-group-' + escapeHtml(key) + '" ' +
      'data-director-assessment-group="' + escapeHtml(key) + '"' + (open ? ' open' : '') + '>' +
    '<summary>' +
      '<span class="director-model-assessment-group-heading">' +
        '<input type="checkbox" data-director-assessment-group-select="' + escapeHtml(key) + '" aria-label="Select all models in ' + escapeHtml(title) + '">' +
        '<strong>' + escapeHtml(title) + '</strong>' +
        '<span class="director-model-assessment-group-count">' + String(models.length) + '</span>' +
      '</span>' +
      '<span class="app-settings-help">' + escapeHtml(copy) + '</span>' +
    '</summary>' +
    '<div class="director-model-assessment-group-body">' +
      models.map(function (model) {
        var modelRef = String(model.id || '');
        return directorModelAssessmentModelRow(
          model,
          reportByRef[modelRef] || null,
          profileByRef[modelRef] || null,
          previousSelection,
          previousOpen
        );
      }).join('') +
    '</div>' +
  '</details>';
}

function directorModelAssessmentRenderModels() {
  var host = directorModelTestEl('director-model-assessment-models');
  if (!host) throw new Error('Director model assessment list is missing.');

  var previousSelection = {};
  Array.prototype.forEach.call(host.querySelectorAll('[data-director-model-assessment-model]'), function (input) {
    previousSelection[String(input.getAttribute('data-director-model-assessment-model') || '')] = {
      checked: !!input.checked,
      state: String(input.getAttribute('data-director-model-state') || '')
    };
  });
  var previousOpen = {};
  Array.prototype.forEach.call(host.querySelectorAll('[data-director-model-ref]'), function (row) {
    previousOpen[String(row.getAttribute('data-director-model-ref') || '')] = !!row.open;
  });
  var previousGroups = {};
  Array.prototype.forEach.call(host.querySelectorAll('[data-director-assessment-group]'), function (group) {
    previousGroups[String(group.getAttribute('data-director-assessment-group') || '')] = !!group.open;
  });

  if (!directorModelTestState.models.length) {
    host.innerHTML = '<p class="app-settings-help">No Director models are currently available.</p>';
    directorModelAssessmentRenderSelectionSummary();
    return;
  }

  var reportByRef = {};
  var profileByRef = {};
  directorModelTestState.calibrationReports.forEach(function (report) {
    reportByRef[String(report.modelRef || '')] = report;
  });
  directorModelTestState.calibrationProfiles.forEach(function (profile) {
    profileByRef[String(profile.modelRef || '')] = profile;
  });

  var groups = { needs: [], incomplete: [], assessed: [] };
  directorModelTestState.models.forEach(function (model) {
    var modelRef = String(model.id || '');
    var state = directorModelAssessmentModelState(reportByRef[modelRef] || null, profileByRef[modelRef] || null);
    groups[state].push(model);
  });

  host.innerHTML =
    directorModelAssessmentRenderGroup(
      'needs',
      'Needs assessment',
      'Not tested yet.',
      groups.needs,
      reportByRef,
      profileByRef,
      previousSelection,
      previousOpen,
      previousGroups
    ) +
    directorModelAssessmentRenderGroup(
      'incomplete',
      'Needs retry',
      'Previous assessment did not establish a dependable WebCap profile.',
      groups.incomplete,
      reportByRef,
      profileByRef,
      previousSelection,
      previousOpen,
      previousGroups
    ) +
    directorModelAssessmentRenderGroup(
      'assessed',
      'Assessed',
      'WebCap already has a usable Director profile.',
      groups.assessed,
      reportByRef,
      profileByRef,
      previousSelection,
      previousOpen,
      previousGroups
    );

  directorModelAssessmentWireEvidenceToggles(host);
  Array.prototype.forEach.call(host.querySelectorAll('details[data-director-assessment-evidence-id][open]'), function (details) {
    if (typeof details.ontoggle === 'function') details.ontoggle();
  });
  directorModelAssessmentRenderSelectionSummary();
}

function directorModelTestRenderCalibrationProfiles() {
  directorModelAssessmentRenderModels();
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
  if (!String(text || '').trim() && (finishReason === 'length' || finishReason === 'max_tokens')) return 'capacity';
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
    directorModelTestRenderCalibrationProfiles();
    directorModelAssessmentRenderHistory();
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
    directorModelTestRenderCalibrationProfiles();
    directorModelAssessmentRenderHistory();
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

function directorModelAssessmentAttemptLabel(kind) {
  if (kind === 'context') return 'Context';
  if (kind === 'output') return 'Structured output';
  if (kind === 'prose') return 'Long-form prose';
  return String(kind || 'Probe');
}

function directorModelAssessmentRenderEvidence(assessment) {
  assessment = assessment && typeof assessment === 'object' ? assessment : {};
  var attempts = Array.isArray(assessment.attempts) ? assessment.attempts : [];
  var model = assessment.model && typeof assessment.model === 'object' ? assessment.model : {};
  var started = assessment.startedAt ? new Date(assessment.startedAt).toLocaleString() : '';
  var meta = [
    assessment.status || 'unknown',
    String(attempts.length) + ' probe' + (attempts.length === 1 ? '' : 's'),
    started
  ].filter(Boolean).join(' · ');

  var probes = attempts.map(function (attempt) {
    var failed = attempt.status === 'failed';
    var probeOutcome = failed && ['capacity', 'contract', 'malformed'].indexOf(attempt.failureKind) !== -1;
    var target = directorModelTestFormatCapacity(attempt.target);
    var targetLabel = attempt.kind === 'context' ? target + ' context' : target + ' output budget';
    var statusText = attempt.status === 'stopped' ? 'Stopped' : (failed
      ? (attempt.failureKind === 'capacity' ? 'Hit output limit' :
        (attempt.failureKind === 'contract' ? 'Did not follow test format' :
          (attempt.failureKind === 'runtime' ? 'Runtime failed' : (probeOutcome ? 'Not completed' : 'Quality warning'))))
      : 'Passed');
    var failureText = failed && attempt.failureKind ? directorModelAssessmentFailureLabel(attempt.failureKind) : '';
    var probeMeta = [
      attempt.finishReason ? 'finish=' + attempt.finishReason : '',
      Number(attempt.promptTokens || 0) > 0 ? 'prompt ' + directorModelTestTokenCount(attempt.promptTokens) + ' tok' : '',
      Number(attempt.completionTokens || 0) > 0 ? 'output ' + directorModelTestTokenCount(attempt.completionTokens) + ' tok' : '',
      Number(attempt.observedContextSize || 0) > 0 ? 'context ' + directorModelTestFormatCapacity(attempt.observedContextSize) : '',
      Number(attempt.totalSeconds || 0) > 0 ? directorModelTestSeconds(attempt.totalSeconds) : '',
      Number(attempt.tokensPerSecond || 0) > 0 ? directorModelTestRate(attempt.tokensPerSecond) + ' tok/s' : ''
    ].filter(Boolean).join(' · ');
    var prompt = String(attempt.prompt || '');
    var output = String(attempt.text || '');

    return '<details class="app-settings-advanced director-model-assessment-probe" data-director-probe-key="' +
      escapeHtml(attempt.kind + '-' + attempt.target) + '"' + (failed ? ' open' : '') + '>' +
      '<summary><strong>' + escapeHtml(directorModelAssessmentAttemptLabel(attempt.kind) + ' · ' + targetLabel + ' · ' + statusText) + '</strong>' +
        (failureText ? '<span class="app-settings-help">' + escapeHtml(failureText) + '</span>' : '') +
      '</summary>' +
      '<div class="app-settings-disclosure-body">' +
        (probeMeta ? '<div class="app-settings-help director-model-assessment-probe-meta">' + escapeHtml(probeMeta) + '</div>' : '') +
        (attempt.note ? '<div class="app-settings-help">Note: ' + escapeHtml(String(attempt.note)) + '</div>' : '') +
        (attempt.error ? '<div class="app-settings-help' + (probeOutcome ? '' : ' director-model-finding-error') + '">' +
          (probeOutcome ? 'Result: ' : 'Error: ') + escapeHtml(String(attempt.error)) + '</div>' : '') +
        '<div class="director-model-assessment-evidence-block"><strong>Prompt</strong>' +
          (prompt ? '<pre class="app-settings-json director-model-test-output">' + escapeHtml(prompt) + '</pre>' :
            '<p class="app-settings-help">Prompt was not captured because the probe failed before submission completed.</p>') +
        '</div>' +
        '<div class="director-model-assessment-evidence-block"><strong>Model output</strong>' +
          (output ? '<pre class="app-settings-json director-model-test-output">' + escapeHtml(output) + '</pre>' :
            '<p class="app-settings-help">No model output was captured.</p>') +
        '</div>' +
        (attempt.reasoning ? '<div class="director-model-assessment-evidence-block"><strong>Provider reasoning</strong>' +
          '<pre class="app-settings-json director-model-test-output">' + escapeHtml(String(attempt.reasoning)) + '</pre></div>' : '') +
      '</div>' +
    '</details>';
  }).join('');

  return '<div class="director-model-assessment-evidence-header">' +
      '<strong>' + escapeHtml(model.label || model.modelId || assessment.id || 'Assessment') + '</strong>' +
      '<span class="app-settings-help">' + escapeHtml(meta) + '</span>' +
    '</div>' +
    (assessment.error ? '<div class="app-settings-help director-model-finding-error">Assessment error: ' + escapeHtml(String(assessment.error)) + '</div>' : '') +
    (probes || '<p class="app-settings-help">This assessment did not record any probes.</p>');
}

function directorModelAssessmentLoadEvidence(assessmentId, host) {
  if (!host) throw new Error('Director assessment evidence host is missing.');
  return directorModelTestPost({
    action: 'get_assessment',
    assessmentId: assessmentId
  }).then(function (payload) {
    var rendered = document.createElement('div');
    rendered.innerHTML = directorModelAssessmentRenderEvidence(payload.assessment || {});
    var previous = Array.from(host.children);
    var rows = Array.from(rendered.children).map(function (row) {
      var key = row.getAttribute('data-director-probe-key');
      return previous.find(function (item) {
        return key && item.getAttribute('data-director-probe-key') === key && item.textContent === row.textContent;
      }) || row;
    });
    rows.forEach(function (row, index) {
      if (host.children[index] !== row) host.insertBefore(row, host.children[index] || null);
    });
    previous.forEach(function (row) { if (rows.indexOf(row) === -1) row.remove(); });
  });
}

function directorModelAssessmentWireEvidenceToggles(root) {
  Array.prototype.forEach.call(root.querySelectorAll('details[data-director-assessment-evidence-id]'), function (details) {
    details.ontoggle = function () {
      if (!details.open) return;
      var state = String(details.getAttribute('data-director-assessment-evidence-state') || '');
      if (state === 'loading' || state === 'loaded') return;
      var assessmentId = String(details.getAttribute('data-director-assessment-evidence-id') || '');
      var host = details.querySelector('[data-director-assessment-evidence-host]');
      if (!assessmentId || !host) throw new Error('Director assessment evidence disclosure is incomplete.');
      details.setAttribute('data-director-assessment-evidence-state', 'loading');
      host.innerHTML = '<p class="app-settings-help">Loading full probe evidence…</p>';
      directorModelAssessmentLoadEvidence(assessmentId, host).then(function () {
        details.setAttribute('data-director-assessment-evidence-state', 'loaded');
      }).catch(function (error) {
        details.setAttribute('data-director-assessment-evidence-state', 'error');
        host.innerHTML = '<p class="app-settings-help">Could not load raw evidence. See Console.</p>';
        reportConsoleError('Director Model Assessment', error);
      });
    };
  });
}

function directorModelAssessmentRenderHistory() {
  var host = directorModelTestEl('director-model-assessment-history');
  if (!host) throw new Error('Director assessment history markup is missing.');
  var runs = Array.isArray(directorModelTestState.assessmentRuns) ? directorModelTestState.assessmentRuns : [];
  if (!runs.length) {
    host.innerHTML = '<p class="app-settings-help">No raw assessment runs are available.</p>';
    return;
  }
  var rendered = document.createElement('div');
  rendered.innerHTML = runs.map(function (run) {
    var model = run.model && typeof run.model === 'object' ? run.model : {};
    var date = run.startedAt ? new Date(run.startedAt).toLocaleString() : '';
    var meta = [
      run.status || 'unknown',
      String(Number(run.attemptCount || 0)) + ' probes',
      directorModelAssessmentSize(run.bytes),
      date
    ].filter(Boolean).join(' · ');
    return '<details class="app-settings-advanced director-model-assessment-run" ' +
        'data-assessment-id="' + escapeHtml(run.id || '') + '" ' +
        'data-director-assessment-evidence-id="' + escapeHtml(run.id || '') + '">' +
      '<summary><span><strong>' + escapeHtml(model.label || model.modelId || run.id || '') + '</strong></span>' +
        '<span class="app-settings-help">' + escapeHtml(meta) + '</span></summary>' +
      '<div class="app-settings-disclosure-body">' +
        '<div class="app-settings-actions app-settings-actions-inline">' +
          '<button type="button" class="review-captions-btn" data-director-assessment-delete="' + escapeHtml(run.id || '') + '"' +
            (run.active ? ' disabled' : '') + '>Delete Raw Evidence</button>' +
        '</div>' +
        '<div class="director-model-assessment-evidence" data-director-assessment-evidence-host>' +
          '<p class="app-settings-help">Expand this run to load its full prompts and model outputs.</p>' +
        '</div>' +
      '</div>' +
    '</details>';
  }).join('');
  var previous = Array.from(host.children);
  Array.from(rendered.children).forEach(function (row, index) {
    var existing = previous.find(function (item) {
      return item.getAttribute('data-assessment-id') === row.getAttribute('data-assessment-id');
    });
    if (existing) {
      var summary = existing.querySelector('summary');
      var changed = summary.innerHTML !== row.querySelector('summary').innerHTML;
      summary.innerHTML = row.querySelector('summary').innerHTML;
      existing.querySelector('[data-director-assessment-delete]').disabled = row.querySelector('[data-director-assessment-delete]').disabled;
      if (host.children[index] !== existing) host.insertBefore(existing, host.children[index] || null);
      if (changed && existing.open) {
        directorModelAssessmentLoadEvidence(existing.getAttribute('data-assessment-id'),
          existing.querySelector('[data-director-assessment-evidence-host]')).catch(function (error) {
            reportConsoleError('Director Model Assessment', error);
          });
      }
    } else host.insertBefore(row, host.children[index] || null);
  });
  previous.forEach(function (row) {
    if (!runs.some(function (run) { return run.id === row.getAttribute('data-assessment-id'); })) row.remove();
  });
  directorModelAssessmentWireEvidenceToggles(host);
}

function directorModelAssessmentDeleteEvidence(assessmentId) {
  return directorModelTestPost({
    action: 'delete_assessment',
    assessmentId: assessmentId
  }).then(function (payload) {
    directorModelTestState.assessmentRuns = Array.isArray(payload.assessmentRuns) ? payload.assessmentRuns : [];
    directorModelAssessmentRenderHistory();
    directorModelTestRenderCalibrationProfiles();
    directorModelTestSyncControls();
    reportConsoleInfo('Director Model Assessment', 'Deleted raw assessment evidence; learned model results were preserved.');
  });
}


function directorModelAssessmentClearEvidence() {
  if (directorModelTestState.running || !directorModelTestState.assessmentRuns.length) return Promise.resolve();
  return directorModelTestPost({
    action: 'clear_assessments'
  }).then(function (payload) {
    directorModelTestState.assessmentRuns = Array.isArray(payload.assessmentRuns) ? payload.assessmentRuns : [];
    directorModelAssessmentRenderHistory();
    directorModelTestRenderCalibrationProfiles();
    directorModelTestSyncControls();
    reportConsoleInfo(
      'Director Model Assessment',
      'Cleared ' + Number(payload.deleted || 0) + ' raw assessment run(s); learned model results were preserved.'
    );
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
    if (terminalStatus === 'stopped' || terminalStatus === 'cancelled') {
      directorModelTestState.stopRequested = true;
      return {
        kind: kind,
        target: Number(target),
        status: 'stopped',
        finishReason: finishReason,
        error: '',
        failureKind: 'stopped',
        prompt: prompt,
        text: text,
        reasoning: String(result.reasoning || ''),
        promptTokens: promptTokens,
        completionTokens: completionTokens,
        observedContextSize: isFinite(observedContext) && observedContext > 0 ? observedContext : 0,
        totalSeconds: totalSeconds,
        tokensPerSecond: tokensPerSecond
      };
    }
    if (terminalStatus === 'failed') reportConsoleError('Director Model Assessment', String(job.error || 'Director probe failed.'));
    var passed = terminalStatus === 'completed';
    var completionMarkerMissing = false;

    if (kind === 'context') {
      passed = passed && observedContext >= Number(target) && text.trim() === 'CONTEXT_OK';
    } else {
      var calibrationProtocol = directorModelTestState.calibrationProtocol || {};
      passed = passed && ['length', 'max_tokens'].indexOf(finishReason) === -1;
      if (kind === 'prose') {
        var expectedSections = Number((calibrationProtocol.proseSectionCounts || {})[String(target)] || 0);
        var sections = text.match(/(^|\n)\s*Section\s+\d+\s*:/gmi) || [];
        var proseWords = text.replace(/Section\s+\d+\s*:/gi, '')
          .replace(String(calibrationProtocol.proseMarker), '').trim().split(/\s+/).length;
        passed = passed &&
          sections.length === expectedSections && sections.every(function (heading, index) {
            return Number(heading.match(/\d+/)[0]) === index + 1;
          }) && proseWords >= expectedSections * 80;
        completionMarkerMissing = passed &&
          text.indexOf(String(calibrationProtocol.proseMarker || 'WEB_CAP_LONGFORM_COMPLETE')) === -1;
      } else {
        var expectedItems = Number((calibrationProtocol.outputItemCounts || {})[String(target)] || 0);
        var items = text.match(/(^|\n)\s*\d+[\.\)]\s+/gm) || [];
        passed = passed &&
          items.length === expectedItems && items.every(function (heading, index) {
            return parseInt(heading, 10) === index + 1;
          });
        completionMarkerMissing = passed &&
          text.indexOf(String(calibrationProtocol.marker || 'WEB_CAP_CALIBRATION_COMPLETE')) === -1;
      }
    }

    var obviousPathology = directorModelTestLooksLeaky(text) ||
      directorModelTestLooksGarbled(text) ||
      directorModelTestLooksRepetitive(text);
    if (obviousPathology) passed = false;
    var failureKind = directorModelTestCalibrationFailureKind(kind, terminalStatus, text, finishReason, passed);
    var probeError = passed ? '' : directorModelAssessmentFailureLabel(failureKind);
    var probeNote = passed && completionMarkerMissing
      ? 'Completion marker omitted; the response otherwise completed the test.'
      : '';
    if (failureKind === 'contract' && kind === 'prose') {
      probeError = 'Expected ' + expectedSections + ' consecutive sections and at least ' + (expectedSections * 80) +
        ' prose words plus the completion marker; received ' + sections.length + ' sections and ' + proseWords +
        ' prose words. Completion marker ' +
        (text.indexOf(String(calibrationProtocol.proseMarker)) !== -1 ? 'present.' : 'missing.');
    } else if (failureKind === 'contract' && kind === 'output') {
      probeError = 'Expected ' + expectedItems + ' consecutive numbered items and the completion marker; received ' + items.length +
        ' numbered items. Completion marker ' +
        (text.indexOf(String(calibrationProtocol.marker)) !== -1 ? 'present.' : 'missing.');
    }

    return {
      kind: kind,
      target: Number(target),
      status: passed ? 'passed' : 'failed',
      finishReason: finishReason,
      error: String(job.error || probeError),
      failureKind: failureKind,
      note: probeNote,
      prompt: prompt,
      text: text,
      reasoning: String(result.reasoning || ''),
      promptTokens: promptTokens,
      completionTokens: completionTokens,
      observedContextSize: isFinite(observedContext) && observedContext > 0 ? observedContext : 0,
      totalSeconds: totalSeconds,
      tokensPerSecond: tokensPerSecond
    };
  }).catch(function (error) {
    if (error && typeof error === 'object') error.directorCalibrationPrompt = prompt;
    throw error;
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
    ).catch(function (error) {
      reportConsoleError('Director Model Assessment', error);
      return {
        kind: kind,
        target: Number(target),
        status: 'failed',
        finishReason: '',
        error: error.message || String(error),
        failureKind: 'runtime',
        prompt: String(error && error.directorCalibrationPrompt || ''),
        text: '',
        promptTokens: 0,
        completionTokens: 0,
        observedContextSize: 0,
        totalSeconds: 0,
        tokensPerSecond: 0
      };
    }).then(function (attempt) {
      attempts.push(attempt);
      if (kind === 'context' && attempt.status === 'passed') contextSize = Number(target);
      if (contextMode === 'runtime' && attempt.observedContextSize > contextSize) {
        contextSize = attempt.observedContextSize;
      }
      if (kind === 'prose' && attempt.status === 'passed') maxTokens = Number(target);
      var runtimeFailure = attempt.failureKind === 'runtime';
      return record(runtimeFailure ? 'error' : 'incomplete', runtimeFailure ? attempt.error : '', false)
        .then(function () { return attempt; });
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
      if (previousCapacity.length && previousCapacity[previousCapacity.length - 1].failureKind === 'capacity') return;
      return runAttempt('output', target).then(function (attempt) {
        if (!attempt || attempt.status === 'stopped' || attempt.failureKind === 'capacity' || directorModelTestState.stopRequested) return;
        return runAttempt('prose', target);
      });
    });
  });

  return chain.then(function () {
    if (directorModelTestState.stopRequested) {
      return record('stopped', '', true).then(function () { return null; });
    }

    var runtimeFailure = attempts.slice().reverse().find(function (attempt) {
      return attempt.status === 'failed' && attempt.failureKind === 'runtime';
    }) || null;
    var reportStatus = maxTokens > 0 ? 'complete' : (runtimeFailure ? 'error' : 'incomplete');
    var reportError = maxTokens > 0 ? '' : (runtimeFailure ? String(runtimeFailure.error || '') : '');
    return record(reportStatus, reportError, true).then(function () {
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
  var sharedGpuBusy = shellWorkloadState.trainingActive ||
    shellWorkloadState.testingActive ||
    shellWorkloadState.generatingActive ||
    shellWorkloadState.inferenceActive;
  if (!sharedGpuBusy) return models;

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
  var assessmentFailed = false;
  models.forEach(function (model, index) {
    chain = chain.then(function () {
      if (directorModelTestState.stopRequested) return;
      return directorModelTestCalibrateOne(model, index + 1);
    });
  });

  chain.catch(function (error) {
    if (directorModelTestState.stopRequested) return;
    assessmentFailed = true;
    reportConsoleError('Director Model Calibration', error);
  }).finally(function () {
    var assessmentSummary = directorModelTestEl('director-model-assessment-summary-status');
    assessmentSummary.textContent = assessmentFailed ? 'Failed' : (directorModelTestState.stopRequested ? 'Stopped' : 'Complete');
    assessmentSummary.dataset.state = assessmentFailed ? 'error' : (directorModelTestState.stopRequested ? 'stopped' : 'complete');
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
          if (status === 'cancelled' || status === 'stopped') directorModelTestState.stopRequested = true;
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
        (run.status === 'stopped' ? 'Stopped ' : 'Completed ') + (model.label || model.modelId || model.modelRef) +
          (run.status === 'stopped'
            ? '.'
            : ' · finish_reason=' + (run.finishReason || 'unknown') +
              ' · completion_tokens=' + String(Math.round(run.completionTokens || 0)))
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
  resetLlmExecution().catch(function (error) {
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
  directorModelTestEl('director-model-assessment-models').addEventListener('click', function (event) {
    if (event.target.matches('[data-director-model-assessment-model], [data-director-assessment-group-select]')) {
      event.stopPropagation();
    }
  });
  directorModelTestEl('director-model-assessment-models').addEventListener('change', function (event) {
    if (event.target.matches('[data-director-assessment-group-select]')) {
      var group = event.target.closest('[data-director-assessment-group]');
      if (!group) throw new Error('Director assessment group selector is detached from its group.');
      Array.prototype.forEach.call(group.querySelectorAll('[data-director-model-assessment-model]'), function (input) {
        input.checked = event.target.checked;
      });
      directorModelAssessmentRenderSelectionSummary();
      directorModelTestSyncControls();
      return;
    }
    if (event.target.matches('[data-director-model-assessment-model]')) {
      directorModelAssessmentRenderSelectionSummary();
      directorModelTestSyncControls();
    }
  });

  directorModelTestEl('director-model-test-run').addEventListener('click', directorModelTestStart);
  directorModelTestEl('director-model-assessment-run').addEventListener('click', directorModelTestStartCalibration);
  directorModelTestEl('director-model-test-clear-calibration').addEventListener('click', directorModelTestClearCalibration);
  directorModelTestEl('director-model-assessment-clear-raw').addEventListener('click', function () {
    directorModelAssessmentClearEvidence().catch(function (error) {
      reportConsoleError('Director Model Assessment', error);
    });
  });
  directorModelTestEl('director-model-test-stop').addEventListener('click', directorModelTestStop);
  directorModelTestEl('director-model-assessment-stop').addEventListener('click', directorModelTestStop);
  directorModelTestEl('director-model-test-export').addEventListener('click', directorModelTestExport);
  directorModelTestEl('director-model-assessment-history').addEventListener('click', function (event) {
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
