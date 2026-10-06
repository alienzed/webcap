(function () {
  var supportedTestModelIds = [];
  var supportedTestModels = {};
  var testModelsLoaded = false;
  var pollTimer = null;
  var pendingElapsedTimer = null;
  var lastActivityRefreshAt = 0;
  var lastSessionsRefreshAt = 0;
  var prepared = null;
  var launchFolder = '';
  var currentSession = '';
  var currentSessionFolder = '';
  var currentSessionModel = '';
  var currentStatus = {};
  var resultsView = 'grid';
  var compareIndex = 0;
  var pendingActivityFolder = '';
  var testActivity = {};
  var selectedCandidates = null;
  var candidateStrengths = null;
  var pendingActivitySession = '';
  var queuedTestJobs = [];
  var trackedTestInferenceSessions = Object.create(null);
  var pendingTestCompletionChecks = Object.create(null);
  var showSessionError = false;
  var missingWorkingModelContextReported = false;
  var reportedFailureKeys = new Set();
  var debouncedWorkspacePromptSave = debounceCreate(500);
  var debouncedTestBenchStateSave = debounceCreate(500);
  var wildcardDirector = {
    models: [],
    modelId: '',
    available: false,
    busy: false,
    jobId: '',
    requestDiagnostic: null,
    requestFolder: '',
    analysis: null,
    activityStartedAt: 0,
    activityTimer: 0,
    activityHistory: [],
    activityLastMemory: null,
    activityLoadBaseline: null,
    activityLoadModelId: ''
  };

  function el(id) { return document.getElementById(id); }

  function owningSetFolder(folder) {
    var value = String(folder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    var marker = '/test-generations/';
    var index = value.indexOf(marker);
    return index === -1 ? value : value.slice(0, index);
  }

  function setFolderName(folder) {
    var parts = String(owningSetFolder(folder) || '').split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }

  function request(operation, criteria) {
    var body = {
      folder: owningSetFolder(launchFolder || (state && state.folder) || ''),
      operation: operation
    };
    var resolvedCriteria = criteria ? Object.assign({}, criteria) : {};
    if (Object.keys(resolvedCriteria).length) body.criteria = resolvedCriteria;
    return fetch('/fs/test_generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.ok === false) {
          throw new Error(payload && payload.error ? payload.error : 'Test Generations request failed.');
        }
        return payload;
      });
    });
  }

  function requestForFolder(folder, operation, criteria) {
    var body = {
      folder: owningSetFolder(folder),
      operation: operation
    };
    var resolvedCriteria = criteria ? Object.assign({}, criteria) : {};
    if (Object.keys(resolvedCriteria).length) body.criteria = resolvedCriteria;
    return fetch('/fs/test_generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.ok === false) {
          throw new Error(payload && payload.error ? payload.error : 'Test Generations request failed.');
        }
        return payload;
      });
    });
  }

  function testInferenceSessionKey(folder, sessionId) {
    return String(owningSetFolder(folder) || '') + '|' + String(sessionId || '');
  }

  function syncTestInferenceSnapshot(queue) {
    if (!queue || !Array.isArray(queue.jobs)) return;
    var current = Object.create(null);

    queue.jobs.forEach(function (job) {
      if (String(job && job.client || '') !== 'test') return;
      var folder = String(job.folder || '').trim();
      var sessionId = String(job.sessionId || '').trim();
      if (!folder || !sessionId) return;
      var key = testInferenceSessionKey(folder, sessionId);
      current[key] = true;
      trackedTestInferenceSessions[key] = {
        folder: folder,
        sessionId: sessionId,
        modelId: String(job.modelId || ''),
        label: String(job.label || '')
      };
    });

    Object.keys(trackedTestInferenceSessions).forEach(function (key) {
      if (current[key] || pendingTestCompletionChecks[key]) return;
      var tracked = trackedTestInferenceSessions[key];
      pendingTestCompletionChecks[key] = true;
      requestForFolder(tracked.folder, 'test_open_session', { session: tracked.sessionId }).then(function (status) {
        var state = String(status && status.status || '');
        if (state === 'complete') {
          window.recordActivityCompletion({
            id: 'test-session:' + key,
            kind: 'test',
            lane: 'inference',
            status: 'completed',
            label: String(status.name || '').trim() || sessionLabel(tracked.sessionId),
            folder: tracked.folder,
            sessionId: tracked.sessionId,
            modelId: String(status.modelId || status.model || tracked.modelId || '')
          });
          delete trackedTestInferenceSessions[key];
          return;
        }
        if (['stopped', 'failed', 'interrupted'].indexOf(state) !== -1) {
          delete trackedTestInferenceSessions[key];
        }
      }).catch(function () {
        // Completion breadcrumbs are best-effort browser state. A Session may
        // legitimately disappear because the user cleared it or archived the Set.
        delete trackedTestInferenceSessions[key];
      }).then(function () {
        delete pendingTestCompletionChecks[key];
      });
    });
  }

  function wildcardRequestJson(url, options) {
    return fetch(url, options || {}).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.ok === false) {
          throw new Error(payload && payload.error ? payload.error : 'Wildcard generation failed.');
        }
        return payload;
      });
    });
  }

  function wildcardPostJson(url, payload) {
    return wildcardRequestJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
  }

  function renderWildcardDirector() {
    var select = el('test-generations-wildcard-model');
    var button = el('test-generations-wildcard-btn');
    var refresh = el('test-generations-wildcard-refresh');
    var status = el('test-generations-wildcard-status');
    if (!select || !button || !refresh || !status) throw new Error('Test wildcard controls are missing.');

    refresh.disabled = wildcardDirector.busy;

    if (!wildcardDirector.available) {
      select.innerHTML = '<option value="">Director unavailable</option>';
      select.disabled = true;
      button.disabled = true;
      return;
    }

    wildcardDirector.modelId = renderDirectorModelOptions(select, wildcardDirector.models, wildcardDirector.modelId);
    if (wildcardDirector.modelId) setDirectorModelPreference('webcap.testGenerations.directorModel', wildcardDirector.modelId);
    select.value = wildcardDirector.modelId;
    select.disabled = wildcardDirector.busy || !wildcardDirector.modelId;
    button.disabled = wildcardDirector.busy || !wildcardDirector.modelId;
    button.textContent = wildcardDirector.busy ? 'Analyzing…' : 'Generate Wildcard';
    button.title = 'Generate a wildcard prompt from this Set\'s captions';
  }

  function renderWildcardAnalysis(analysis) {
    var panel = el('test-generations-wildcard-analysis');
    var output = el('test-generations-wildcard-output');
    var stable = el('test-generations-wildcard-stable');
    var variations = el('test-generations-wildcard-variations');
    var use = el('test-generations-wildcard-use-btn');
    if (!panel || !output || !stable || !variations || !use) throw new Error('Test wildcard analysis markup is missing.');
    if (!analysis) {
      panel.classList.add('hidden');
      output.value = '';
      stable.textContent = '';
      variations.textContent = '';
      use.disabled = true;
      return;
    }
    var stableTerms = Array.isArray(analysis.stableTerms) ? analysis.stableTerms : [];
    var groups = Array.isArray(analysis.variationGroups) ? analysis.variationGroups : [];
    output.value = String(analysis.wildcard || '');
    stable.textContent = stableTerms.length ? stableTerms.join(' · ') : 'No strong stable terms identified.';
    variations.textContent = groups.length
      ? groups.map(function (group) {
          return String(group.label || 'Variation') + ': ' + (Array.isArray(group.options) ? group.options.join(' / ') : '');
        }).join(' · ')
      : 'No meaningful variation groups identified.';
    use.disabled = !output.value.trim();
    panel.classList.remove('hidden');
  }

  function useGeneratedWildcard() {
    var output = el('test-generations-wildcard-output');
    var prompt = el('test-generations-prompt');
    var value = String(output && output.value || '').trim();
    if (!value) throw new Error('No generated wildcard is available.');
    prompt.value = value;
    saveTestWorkspacePrompt(value);
    saveTestBenchState();
    el('test-generations-wildcard-status').textContent = 'Wildcard copied to Prompt.';
  }

  function refreshWildcardDirector() {
    wildcardDirector.modelId = getDirectorModelPreference('webcap.testGenerations.directorModel');
    return wildcardRequestJson('/fs/test_generations/wildcard').then(function (payload) {
      wildcardDirector.available = !!payload.available;
      wildcardDirector.models = Array.isArray(payload.models) ? payload.models : [];
      renderWildcardDirector();
      return payload;
    });
  }

  function wildcardDirectorPhaseLabel(phase) {
    var labels = {
      queued: 'Queued…',
      preparing: 'Preparing…',
      freeing_comfy: 'Preparing GPU…',
      loading_model: 'Loading model…',
      generating: 'Generating response…',
      complete: 'Complete',
      stopped: 'Stopped',
      error: 'Failed'
    };
    return labels[String(phase || '')] || 'Working…';
  }

  function wildcardDirectorMemoryGiB(mib) {
    var value = Number(mib);
    return isFinite(value) && value >= 0 ? (value / 1024).toFixed(1) + ' GiB' : '';
  }

  function wildcardDirectorBytesGiB(bytes) {
    var value = Number(bytes);
    return isFinite(value) && value >= 0 ? (value / (1024 * 1024 * 1024)).toFixed(1) + ' GiB' : '';
  }

  function wildcardDirectorMemorySample(system) {
    var gpu = system && system.gpu;
    var primary = gpu && gpu.available && Array.isArray(gpu.gpus) ? gpu.gpus[0] : null;
    var ram = system && system.ram;
    var ramBytes = ram && ram.available ? Number(ram.used) : NaN;
    var vramMiB = primary ? Number(primary.memoryUsed) : NaN;
    if (!isFinite(ramBytes) || !isFinite(vramMiB)) return null;
    return {
      ramBytes: ramBytes,
      vramBytes: vramMiB * 1024 * 1024
    };
  }

  function updateWildcardDirectorModelLoad(activity, system) {
    var meter = el('test-generations-director-model-load');
    var label = el('test-generations-director-model-load-label');
    var fill = el('test-generations-director-model-load-fill');
    if (!meter || !label || !fill) throw new Error('Test Generations Director model-load markup is missing.');

    var phase = String(activity && activity.phase || '');
    var sample = wildcardDirectorMemorySample(system);
    if (phase !== 'loading_model') {
      meter.classList.add('hidden');
      if (sample) wildcardDirector.activityLastMemory = sample;
      if (phase === 'preparing' || phase === 'queued' || phase === 'freeing_comfy') {
        wildcardDirector.activityLoadBaseline = null;
        wildcardDirector.activityLoadModelId = '';
      }
      return;
    }

    var modelId = String(activity && activity.model || '');
    if (wildcardDirector.activityLoadModelId !== modelId) {
      wildcardDirector.activityLoadModelId = modelId;
      wildcardDirector.activityLoadBaseline = wildcardDirector.activityLastMemory || sample;
    } else if (!wildcardDirector.activityLoadBaseline && sample) {
      wildcardDirector.activityLoadBaseline = wildcardDirector.activityLastMemory || sample;
    }

    var track = meter.querySelector('.director-model-load-track');
    var modelSizeBytes = Number(activity && activity.modelSizeBytes);
    var baseline = wildcardDirector.activityLoadBaseline;
    meter.classList.remove('hidden');

    if (!sample || !baseline) {
      label.textContent = 'Waiting for memory sample…';
      fill.style.width = '0%';
      if (track) track.removeAttribute('aria-valuenow');
      meter.title = 'Waiting for a RAM / VRAM sample before estimating Director model residency.';
      return;
    }
    if (!isFinite(modelSizeBytes) || modelSizeBytes <= 0) {
      label.textContent = 'Model size unavailable';
      fill.style.width = '0%';
      if (track) track.removeAttribute('aria-valuenow');
      meter.title = 'llama.cpp did not expose a usable size for the selected model.';
      return;
    }

    var residentBytes = Math.max(
      0,
      Math.max(0, sample.ramBytes - baseline.ramBytes) + Math.max(0, sample.vramBytes - baseline.vramBytes)
    );
    var displayBytes = Math.min(modelSizeBytes, residentBytes);
    var percent = Math.max(0, Math.min(100, residentBytes / modelSizeBytes * 100));
    label.textContent = '≈ ' + wildcardDirectorBytesGiB(displayBytes) + ' / ' + wildcardDirectorBytesGiB(modelSizeBytes) + ' · ~' + Math.round(percent) + '%';
    fill.style.width = percent.toFixed(1) + '%';
    if (track) track.setAttribute('aria-valuenow', String(Math.round(percent)));
    meter.title = 'Approximate model residency from RAM + VRAM growth since loading began.';
  }

  function wildcardDirectorTrendPath(history, key) {
    var path = '';
    var cutoff = Date.now() - 60000;
    history.forEach(function (sample) {
      var value = sample[key];
      if (!isFinite(value)) return;
      var x = Math.max(0, Math.min(120, (sample.time - cutoff) / 60000 * 120));
      var y = 28 - Math.max(0, Math.min(100, value)) * 0.26;
      path += (path ? ' L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    });
    return path;
  }

  function updateWildcardDirectorTrend(activity, system) {
    var graph = el('test-generations-director-activity-trend');
    if (!graph) throw new Error('Test Generations Director system history markup is missing.');
    var remote = String(activity && activity.runtimeMode || '') === 'remote';
    graph.classList.toggle('is-remote', remote);
    var legend = graph.querySelector('.director-activity-trend-legend');
    var plot = graph.querySelector('svg');
    if (legend) legend.classList.toggle('hidden', remote);
    if (plot) plot.classList.toggle('hidden', remote);
    if (remote) {
      wildcardDirector.activityHistory = [];
      graph.setAttribute('aria-label', 'Remote runtime telemetry');
      return;
    }
    var gpu = system && system.gpu;
    var primary = gpu && gpu.available && Array.isArray(gpu.gpus) ? gpu.gpus[0] : null;
    var ram = system && system.ram;
    var vramPercent = primary ? Number(primary.memoryUsed) / Number(primary.memoryTotal) * 100 : NaN;
    var ramPercent = ram && ram.available ? Number(ram.used) / Number(ram.total) * 100 : NaN;
    var gpuPercent = primary ? Number(primary.utilization) : NaN;
    var gpuTemperature = primary ? Number(primary.temperature) : NaN;

    if (isFinite(vramPercent) || isFinite(ramPercent) || isFinite(gpuPercent) || isFinite(gpuTemperature)) {
      wildcardDirector.activityHistory.push({
        time: Date.now(),
        ram: ramPercent,
        vram: vramPercent,
        gpu: gpuPercent,
        thermal: gpuTemperature
      });
      if (wildcardDirector.activityHistory.length > 40) wildcardDirector.activityHistory.shift();
    }
    var cutoff = Date.now() - 60000;
    while (wildcardDirector.activityHistory.length && wildcardDirector.activityHistory[0].time < cutoff) {
      wildcardDirector.activityHistory.shift();
    }
    var history = wildcardDirector.activityHistory;
    graph.querySelector('.director-activity-trend-ram-line').setAttribute('d', wildcardDirectorTrendPath(history, 'ram'));
    graph.querySelector('.director-activity-trend-vram-line').setAttribute('d', wildcardDirectorTrendPath(history, 'vram'));
    graph.querySelector('.director-activity-trend-gpu-line').setAttribute('d', wildcardDirectorTrendPath(history, 'gpu'));
    graph.querySelector('.director-activity-trend-thermal-line').setAttribute('d', wildcardDirectorTrendPath(history, 'thermal'));

    var latest = history[history.length - 1];
    var parts = [];
    if (latest) {
      if (isFinite(latest.ram)) parts.push('RAM ' + Math.round(latest.ram) + '%');
      if (isFinite(latest.vram)) parts.push('VRAM ' + Math.round(latest.vram) + '%');
      if (isFinite(latest.gpu)) parts.push('GPU ' + Math.round(latest.gpu) + '%');
      if (isFinite(latest.thermal)) parts.push('GPU temperature ' + Math.round(latest.thermal) + '°C');
    }
    graph.setAttribute('aria-label', parts.length
      ? 'System history for the last minute. Latest: ' + parts.join(', ') + '.'
      : 'System history, waiting for samples');
  }

  function wildcardDirectorActivityForCurrentJob(activity, queue) {
    var jobId = String(wildcardDirector.jobId || '');
    if (!jobId) {
      return {
        active: wildcardDirector.busy,
        phase: wildcardDirector.busy ? 'preparing' : 'complete',
        startedAt: wildcardDirector.activityStartedAt,
        runtimeMode: activity && activity.runtimeMode,
        runtimeProvider: activity && activity.runtimeProvider,
        jobId: '',
        jobStatus: ''
      };
    }

    var activityJobId = String(activity && activity.jobId || '');
    var matchingActivity = !activityJobId || activityJobId === jobId ? activity : null;
    var jobs = queue && Array.isArray(queue.jobs) ? queue.jobs : [];
    var job = jobs.find(function (candidate) {
      return String(candidate.jobId || '') === jobId;
    });

    if (!job) {
      return Object.assign({}, matchingActivity || {}, {
        active: wildcardDirector.busy,
        phase: matchingActivity && matchingActivity.phase ? matchingActivity.phase : 'preparing',
        startedAt: matchingActivity && matchingActivity.startedAt ? matchingActivity.startedAt : wildcardDirector.activityStartedAt,
        jobId: jobId,
        jobStatus: ''
      });
    }

    if (String(job.status || '') === 'queued' && String(queue.activeJobId || '') !== jobId) {
      return {
        active: true,
        phase: 'queued',
        model: job.modelId || '',
        operation: job.operation || '',
        startedAt: job.createdAt,
        runtimeMode: activity && activity.runtimeMode,
        runtimeProvider: activity && activity.runtimeProvider,
        jobId: jobId,
        jobStatus: 'queued'
      };
    }

    return Object.assign({}, matchingActivity || {}, {
      active: true,
      phase: matchingActivity && matchingActivity.phase ? matchingActivity.phase : 'preparing',
      startedAt: matchingActivity && matchingActivity.startedAt ? matchingActivity.startedAt : (job.startedAt || job.createdAt),
      jobId: jobId,
      jobStatus: String(job.status || '')
    });
  }

  function wildcardDirectorRequestDiagnosticLabel(request) {
    request = request && typeof request === 'object' ? request : null;
    if (!request) return '';
    var count = Number(request.messageCount) || 0;
    var chars = Number(request.contentChars) || 0;
    return 'Prompt sent · ' + (count === 1 ? '1 msg' : String(count) + ' msgs') + ' · ' + chars.toLocaleString() + ' chars · Copy';
  }

  function copyWildcardDirectorRequestDiagnostic(request) {
    if (!request || !Array.isArray(request.messages)) throw new Error('Wildcard Director request diagnostic is missing its messages.');
    return navigator.clipboard.writeText(JSON.stringify(request.messages, null, 2));
  }

  function renderWildcardDirectorActivity(activity, system) {
    var card = el('test-generations-director-activity');
    var phase = el('test-generations-director-activity-phase');
    var detail = el('test-generations-director-activity-detail');
    var stop = el('test-generations-director-stop');
    var copy = el('test-generations-director-prompt-copy');
    if (!card || !phase || !detail || !stop || !copy) throw new Error('Test Generations Director activity markup is missing.');

    var phaseName = String(activity && activity.phase || '');
    var terminal = activity && ['complete', 'error', 'stopped'].indexOf(phaseName) !== -1;
    var visible = wildcardDirector.busy || (activity && activity.active) || terminal;
    card.classList.toggle('hidden', !visible);

    var jobId = String(activity && activity.jobId || wildcardDirector.jobId || '');
    var jobStatus = String(activity && activity.jobStatus || '');
    var canStop = !!jobId && ['completed', 'failed', 'cancelled', 'stopped', 'interrupted'].indexOf(jobStatus) === -1;
    stop.classList.toggle('hidden', !canStop);
    stop.disabled = jobStatus === 'stopping';
    stop.textContent = jobStatus === 'stopping' ? 'Stopping…' : 'Stop';
    var requestLabel = wildcardDirectorRequestDiagnosticLabel(wildcardDirector.requestDiagnostic);
    copy.classList.toggle('hidden', !requestLabel);
    copy.textContent = requestLabel;
    copy.title = requestLabel ? 'Copy the exact messages WebCap sent to the LLM' : '';
    if (!visible) return;

    updateWildcardDirectorTrend(activity, system);
    updateWildcardDirectorModelLoad(activity, String(activity && activity.runtimeMode || '') === 'remote' ? null : system);
    phase.textContent = wildcardDirectorPhaseLabel(activity && activity.phase);

    var parts = [];
    var startedAt = Number(activity && activity.startedAt) || wildcardDirector.activityStartedAt;
    if (startedAt) parts.push(String(Math.max(0, Math.round(Date.now() / 1000 - startedAt))) + 's elapsed');

    var isRemote = String(activity && activity.runtimeMode || '') === 'remote';
    if (isRemote) {
      var provider = String(activity && activity.runtimeProvider || '').trim();
      parts.push(provider === 'ollama' ? 'Remote Ollama' : 'Remote');
      var showRemoteModelTelemetry = phaseName !== 'queued';
      var remoteModelSizeBytes = showRemoteModelTelemetry ? Number(activity && activity.modelSizeBytes) : NaN;
      if (isFinite(remoteModelSizeBytes) && remoteModelSizeBytes > 0) {
        parts.push('Model ' + wildcardDirectorBytesGiB(remoteModelSizeBytes));
      }
      var remoteVramBytes = showRemoteModelTelemetry ? Number(activity && activity.remoteModelVramBytes) : NaN;
      if (isFinite(remoteVramBytes) && remoteVramBytes > 0) {
        parts.push('GPU-resident ' + wildcardDirectorBytesGiB(remoteVramBytes));
      }
      var remoteContextSize = showRemoteModelTelemetry ? Number(activity && activity.contextSize) : NaN;
      if (isFinite(remoteContextSize) && remoteContextSize > 0) {
        parts.push((remoteContextSize >= 1000 ? (remoteContextSize / 1000).toFixed(remoteContextSize < 10000 ? 1 : 0).replace(/\.0$/, '') + 'k' : Math.round(remoteContextSize)) + ' ctx');
      }
    }

    var gpu = !isRemote && system && system.gpu;
    var primary = gpu && gpu.available && Array.isArray(gpu.gpus) ? gpu.gpus[0] : null;
    if (primary) {
      var utilization = Number(primary.utilization);
      if (isFinite(utilization)) parts.push('GPU ' + Math.round(utilization) + '%');
      var memoryUsed = Number(primary.memoryUsed);
      var memoryTotal = Number(primary.memoryTotal);
      if (isFinite(memoryTotal) && memoryTotal > 0) {
        parts.push('VRAM ' + Math.round(memoryUsed / memoryTotal * 100) + '%');
      }
    }
    var ram = !isRemote && system && system.ram;
    if (ram && ram.available) {
      var ramUsed = Number(ram.used);
      var ramTotal = Number(ram.total);
      if (isFinite(ramTotal) && ramTotal > 0) parts.push('RAM ' + Math.round(ramUsed / ramTotal * 100) + '%');
    }
    detail.textContent = parts.join(' · ');
  }

  function refreshWildcardDirectorActivity() {
    if (!wildcardDirector.busy) return Promise.resolve();
    return Promise.all([
      wildcardRequestJson('/fs/director/activity'),
      wildcardRequestJson('/fs/system_status').catch(function () { return null; })
    ]).then(function (values) {
      observeTransientLlmActivity(values[0]);
      renderWildcardDirectorActivity(
        wildcardDirectorActivityForCurrentJob(values[0], values[0] && values[0].queue),
        values[1]
      );
    }).catch(function () {
      renderWildcardDirectorActivity({ phase: 'preparing', active: true }, null);
    }).then(function () {
      if (!wildcardDirector.busy) return;
      if (wildcardDirector.activityTimer) clearTimeout(wildcardDirector.activityTimer);
      wildcardDirector.activityTimer = setTimeout(refreshWildcardDirectorActivity, 2500);
    });
  }

  function startWildcardDirectorActivity() {
    wildcardDirector.activityStartedAt = Date.now() / 1000;
    wildcardDirector.activityHistory = [];
    wildcardDirector.requestDiagnostic = null;
    renderWildcardDirectorActivity({
      phase: 'preparing',
      active: true,
      startedAt: wildcardDirector.activityStartedAt
    }, null);
    refreshWildcardDirectorActivity();
  }

  function finishWildcardDirectorActivity() {
    if (wildcardDirector.activityTimer) clearTimeout(wildcardDirector.activityTimer);
    wildcardDirector.activityTimer = 0;
    renderWildcardDirectorActivity({ phase: 'complete', active: false, jobId: '', jobStatus: 'completed' }, null);
    setTimeout(function () {
      if (!wildcardDirector.busy) el('test-generations-director-activity').classList.add('hidden');
    }, 800);
  }

  function stopWildcardDirectorJob() {
    var button = el('test-generations-director-stop');
    var jobId = String(wildcardDirector.jobId || '');
    if (!button || !jobId || button.disabled) return;
    button.disabled = true;
    button.textContent = 'Stopping…';
    resetLlmExecution().then(function () {
      return refreshWildcardDirectorActivity();
    }).catch(function (err) {
      button.disabled = false;
      button.textContent = 'Stop';
      showError(err);
    });
  }

  function waitForWildcardJob(job) {
    if (!job || !job.jobId) throw new Error('Wildcard analysis did not return a queued job.');
    trackTransientLlmJob(job);
    function poll(current) {
      var status = String(current.status || '');
      if (status === 'completed') {
        reportTransientLlmTiming(current);
        return Promise.resolve(current.result || {});
      }
      if (['failed', 'cancelled', 'stopped', 'interrupted'].indexOf(status) !== -1) {
        reportTransientLlmTiming(current);
        var err = new Error(current.error || ('Wildcard analysis ' + status + '.'));
        err.jobStatus = status;
        throw err;
      }
      return new Promise(function (resolve) { setTimeout(resolve, status === 'queued' ? 3000 : 1500); }).then(function () {
        return wildcardRequestJson('/fs/director/job?job=' + encodeURIComponent(current.jobId) + '&consume=1');
      }).then(function (payload) {
        if (!payload.job) throw new Error('Wildcard analysis job response is missing its job.');
        trackTransientLlmJob(payload.job);
        return poll(payload.job);
      });
    }
    return poll(job);
  }

  function generateWildcardFromSet() {
    if (wildcardDirector.busy) return;
    if (!wildcardDirector.modelId) throw new Error('Choose a Director model.');
    var requestFolder = owningSetFolder(launchFolder || (state && state.folder) || '');
    wildcardDirector.busy = true;
    wildcardDirector.requestFolder = requestFolder;
    wildcardDirector.analysis = null;
    el('test-generations-wildcard-status').textContent = 'Analyzing Set captions…';
    renderWildcardAnalysis(null);
    renderWildcardDirector();
    startWildcardDirectorActivity();

    return wildcardPostJson('/fs/test_generations/wildcard', {
      folder: requestFolder,
      directorModel: wildcardDirector.modelId
    }).then(function (payload) {
      wildcardDirector.jobId = String(payload.job && payload.job.jobId || '');
      wildcardDirector.requestDiagnostic = payload.job && payload.job.request || null;
      trackTransientLlmJob(payload.job);
      return waitForWildcardJob(payload.job);
    }).then(function (result) {
      var analysis = result && result.analysis;
      if (!analysis || !String(analysis.wildcard || '').trim()) {
        throw new Error('Wildcard analysis returned no wildcard caption.');
      }
      if (owningSetFolder(launchFolder || (state && state.folder) || '') !== requestFolder) {
        wildcardDirector.analysis = null;
        el('test-generations-wildcard-status').textContent = 'Wildcard finished for a different Set. Generate again here.';
        return;
      }
      wildcardDirector.analysis = analysis;
      renderWildcardAnalysis(analysis);
      el('test-generations-wildcard-status').textContent = 'Wildcard generated. Review it before using it.';
    }).catch(function (err) {
      if (err && ['stopped', 'cancelled'].indexOf(String(err.jobStatus || '')) !== -1) {
        el('test-generations-wildcard-status').textContent = 'Wildcard analysis stopped.';
      } else {
        el('test-generations-wildcard-status').textContent = 'Wildcard analysis failed.';
        showError(err);
      }
    }).then(function () {
      wildcardDirector.busy = false;
      wildcardDirector.jobId = '';
      wildcardDirector.requestFolder = '';
      renderWildcardDirector();
      finishWildcardDirectorActivity();
    });
  }

  function pane() { return el('test-generations-pane'); }

  function syncTestRailCollapseUi() {
    var body = el('test-generations-body');
    var toggle = el('test-generations-rail-toggle-btn');
    if (!body || !toggle) throw new Error('Test Generations requires its sidebar collapse controls.');
    var collapsed = body.classList.contains('test-generations-rail-collapsed');
    toggle.textContent = collapsed ? '>' : '<';
    toggle.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    toggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    toggle.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
  }

  function toggleTestRailCollapsed() {
    var body = el('test-generations-body');
    if (!body) throw new Error('Test Generations requires its sidebar container.');
    body.classList.toggle('test-generations-rail-collapsed');
    syncTestRailCollapseUi();
  }

  function currentTestModelId() {
    if (typeof window.getWorkingModelProfileId !== 'function') {
      if (!missingWorkingModelContextReported) {
        missingWorkingModelContextReported = true;
        console.error('[Test Generations] Shared working model context is unavailable; Test Generations is disabled until it loads.');
      }
      return '';
    }
    return String(window.getWorkingModelProfileId() || '');
  }

  function saveTestWorkspacePrompt(prompt) {
    var modelId = currentTestModelId();
    var folder = String(owningSetFolder(launchFolder || (state && state.folder) || ''));
    if (!modelId || !folder) return;
    var value = String(prompt == null ? '' : prompt);
    debouncedWorkspacePromptSave(function () {
      requestForFolder(folder, 'test_save_workspace_prompt', {
        modelId: modelId,
        prompt: value
      }).catch(showError);
    });
  }

  function savedTestModelState() {
    var modelId = currentTestModelId();
    var byModel = state && state.testGenerationByModel && typeof state.testGenerationByModel === 'object'
      ? state.testGenerationByModel
      : {};
    var saved = byModel[modelId];
    if (saved && typeof saved === 'object') {
      return {
        settings: saved.settings && typeof saved.settings === 'object'
          ? saved.settings
          : {}
      };
    }
    var model = supportedTestModels[modelId] || {};
    if (model.default === true) {
      return {
        settings: state && state.testGenerationSettings && typeof state.testGenerationSettings === 'object'
          ? state.testGenerationSettings
          : {}
      };
    }
    return { settings: {} };
  }

  function currentPersistedSettings() {
    return {
      aspectRatio: String(el('test-generations-aspect') && el('test-generations-aspect').value || '').trim(),
      megapixels: Number(el('test-generations-megapixels') && el('test-generations-megapixels').value || 0),
      duration: Number(el('test-generations-duration') && el('test-generations-duration').value || 0),
      dimensions: String(el('test-generations-dimensions') && el('test-generations-dimensions').value || ''),
      candidateStrengths: candidateStrengths && typeof candidateStrengths === 'object'
        ? Object.assign({}, candidateStrengths)
        : {},
      selectedFiles: selectedCandidateFiles(),
      includeBase: !el('test-generations-base-include') || el('test-generations-base-include').checked
    };
  }

  function captureTestBenchSave() {
    if (!state || String(state.folder || '') !== String(launchFolder || '')) return null;
    var modelId = currentTestModelId();
    var settings = currentPersistedSettings();
    if (!state.testGenerationByModel || typeof state.testGenerationByModel !== 'object') state.testGenerationByModel = {};
    var currentModel = supportedTestModels[modelId] || {};
    if (currentModel.default !== true) {
      Object.keys(supportedTestModels).some(function (supportedId) {
        var supported = supportedTestModels[supportedId] || {};
        if (supported.default !== true || state.testGenerationByModel[supportedId]) return false;
        state.testGenerationByModel[supportedId] = {
          settings: state.testGenerationSettings && typeof state.testGenerationSettings === 'object'
            ? JSON.parse(JSON.stringify(state.testGenerationSettings))
            : {}
        };
        return true;
      });
    }
    state.testGenerationByModel[modelId] = {
      settings: JSON.parse(JSON.stringify(settings))
    };
    if (currentModel.default === true) {
      state.testGenerationSettings = settings;
    }
    var capturedSave = captureCurrentFolderStateSave();
    if (!capturedSave) return null;
    capturedSave.snapshot.test_generation_settings = JSON.parse(JSON.stringify(state.testGenerationSettings));
    capturedSave.snapshot.test_generation_by_model = JSON.parse(JSON.stringify(state.testGenerationByModel));
    return capturedSave;
  }

  function saveTestBenchState() {
    var capturedSave = captureTestBenchSave();
    if (!capturedSave) return;
    debouncedTestBenchStateSave(function () {
      writeCapturedFolderState(capturedSave);
    });
  }

  function randomSeed() {
    var values = new Uint32Array(1);
    window.crypto.getRandomValues(values);
    return values[0];
  }

  function isOpen() {
    var node = pane();
    return !!(node && !node.classList.contains('hidden'));
  }

  function recentSetLabel(folder) {
    var parts = String(folder || '').split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : String(folder || '');
  }

  function openTestBenchSet(folder, modelId) {
    var targetFolder = String(folder || '');
    if (!targetFolder) return;
    if (modelId) setWorkingModelProfileId(String(modelId), targetFolder);
    openTestBenchFolder(targetFolder);
  }

  function buildTestActivityContextActions() {
    var actions = [];
    var seen = {};
    var active = Array.isArray(testActivity.active) ? testActivity.active : [];
    var recent = Array.isArray(testActivity.recent) ? testActivity.recent : [];

    active.forEach(function (item) {
      var folder = String(item && item.folder || '');
      var modelId = String(item && item.modelId || '');
      var key = folder + '|' + modelId;
      if (!folder || seen[key]) return;
      seen[key] = true;
      var completed = Number(item.completed || 0);
      var total = Number(item.total || 0);
      actions.push({
        label: 'Running · ' + recentSetLabel(folder) + (total ? ' · ' + completed + ' / ' + total : ''),
        run: function () { openTestBenchSet(folder, modelId); }
      });
    });

    var recentActions = [];
    recent.some(function (item) {
      var folder = String(item && item.folder || '');
      var modelId = String(item && item.modelId || '');
      var key = folder + '|' + modelId;
      if (!folder || seen[key]) return false;
      seen[key] = true;
      var sessionCount = Number(item.sessionCount || 0);
      recentActions.push({
        label: recentSetLabel(folder) + (sessionCount ? ' · ' + sessionCount + ' session' + (sessionCount === 1 ? '' : 's') : ''),
        run: function () { openTestBenchSet(folder, modelId); }
      });
      return recentActions.length >= 5;
    });

    if (actions.length && recentActions.length) actions.push({ separator: true });
    return actions.concat(recentActions);
  }

  function recentPromptLabel(item) {
    var folder = String(item && item.folder || '');
    var session = String(item && item.session || '');
    return recentSetLabel(folder) + (session ? ' · ' + sessionLabel(session) : '');
  }

  function applyRecentPrompt(item) {
    var prompt = String(item && item.prompt || '');
    if (!prompt) throw new Error('Recent Test prompt is empty.');
    var field = el('test-generations-prompt');
    field.value = prompt;
    saveTestWorkspacePrompt(prompt);
    saveTestBenchState();
    field.focus();
  }

  function openRecentPromptsMenu(button) {
    var prompts = Array.isArray(testActivity.recentPrompts) ? testActivity.recentPrompts : [];
    if (!prompts.length) {
      setStatus('No recent Test prompts yet.');
      return;
    }
    var rect = button.getBoundingClientRect();
    showContextMenu(rect.left, rect.bottom + 4, prompts.map(function (item) {
      return {
        label: recentPromptLabel(item),
        run: function () { applyRecentPrompt(item); }
      };
    }));
  }

  function syncActivityButton(payload) {
    testActivity = payload || {};
    var activityButton = el('activity-test-btn');
    if (!activityButton) return;
    var active = Array.isArray(testActivity.active) && testActivity.active.length ? testActivity.active[0] : null;
    activityButton.classList.remove('hidden');
    activityButton.classList.toggle('test-running', !!active);
    activityButton.classList.toggle('active', isOpen());
    setShellTestingActive(!!active);
    activityButton.setAttribute('aria-pressed', isOpen() ? 'true' : 'false');
    if (active) {
      var completed = Number(active.completed || 0);
      var total = Number(active.total || 0);
      activityButton.title = 'Test Generations · ' + String(active.status || 'running') + ' · ' + completed + ' / ' + total + ' · Right-click for Test Sets';
    } else {
      activityButton.title = 'Test Generations · Right-click for recent Test Sets';
    }
    if (typeof window.syncApplicationShellContext === 'function') window.syncApplicationShellContext();
    if (typeof window.syncShellLocationRoute === 'function') window.syncShellLocationRoute();
  }

  function refreshActivityButton() {
    lastActivityRefreshAt = Date.now();
    var folder = String(state && state.folder || '');
    var url = '/fs/test_generations/activity' + (folder ? ('?folder=' + encodeURIComponent(folder)) : '');
    return fetch(url).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.ok === false) throw new Error(payload && payload.error ? payload.error : 'Could not read Test Bench activity.');
        syncActivityButton(payload);
        return payload;
      });
    }).catch(function () {
      return null;
    });
  }

  function refreshActivityButtonIfDue(intervalMs) {
    if ((Date.now() - lastActivityRefreshAt) < Number(intervalMs || 0)) return Promise.resolve(testActivity);
    return refreshActivityButton();
  }

  function prepareTestBenchSetSwitch(folder) {
    var targetFolder = String(folder || '').replace(/^[/\\]+|[/\\]+$/g, '');
    if (!targetFolder) throw new Error('Test Generations Set switching requires a Set folder.');
    pendingActivityFolder = targetFolder;
  }

  function openTestBenchFolder(folder) {
    var targetFolder = String(folder || '');
    if (!targetFolder) return;
    if (String(state && state.folder || '') === targetFolder && state.folderStateWritable) {
      openPane();
      return;
    }
    pendingActivityFolder = targetFolder;
    if (typeof window.setApplicationSetContext !== 'function') throw new Error('Application Set switching is unavailable.');
    window.setApplicationSetContext(targetFolder);
  }

  function openTestBenchForSetFolder(folder) {
    openTestBenchFolder(folder);
  }

  function openTestBenchActivity(target) {
    target = target && typeof target === 'object' ? target : {};
    if (target.sessionId) pendingActivitySession = String(target.sessionId || '');
    if (target.folder || target.modelId) {
      openTestBenchSet(String(target.folder || ''), String(target.modelId || ''));
      return;
    }
    if (isOpen()) {
      if (pendingActivitySession) {
        var session = pendingActivitySession;
        pendingActivitySession = '';
        openSession(session);
      }
      return;
    }
    openPane();
  }

  function openTestBenchActivityMenu(event) {
    if (event) event.preventDefault();
    var actions = buildTestActivityContextActions();
    if (!actions.length) return;
    showContextMenu(event.clientX, event.clientY, actions);
  }

  function testGenerationsFolderLoaded() {
    syncLaunchVisibility();
    refreshActivityButton();
    if (!isOpen() && !pendingActivityFolder) return;
    if (pendingActivityFolder && String(state && state.folder || '') !== String(pendingActivityFolder)) return;
    pendingActivityFolder = '';
    openPane();
  }

  function isTestModelSupported() {
    return supportedTestModelIds.indexOf(currentTestModelId()) !== -1;
  }

  function refreshSupportedTestModels() {
    return fetch('/fs/test_generations/models').then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.ok === false) {
          throw new Error(payload && payload.error ? payload.error : 'Could not read supported Test models.');
        }
        supportedTestModels = {};
        supportedTestModelIds = Array.isArray(payload.models)
          ? payload.models.map(function (item) {
              var id = String(item && item.id || '');
              if (id) supportedTestModels[id] = item;
              return id;
            }).filter(Boolean)
          : [];
        testModelsLoaded = true;
        syncLaunchVisibility();
        syncActiveRunControls(currentStatus);
        return payload;
      });
    }).catch(function (err) {
      testModelsLoaded = true;
      supportedTestModelIds = [];
      supportedTestModels = {};
      syncLaunchVisibility();
      throw err;
    });
  }

  function syncLaunchVisibility() {
    var button = el('test-generations-open-btn');
    if (!button) return;
    var hasFolder = !!(state && state.folder);
    var supported = isTestModelSupported();
    button.classList.toggle('hidden', !hasFolder);
    button.disabled = hasFolder && (!testModelsLoaded || !supported);
    button.textContent = !testModelsLoaded ? 'Loading Test Bench…' : (supported ? 'Open Test Bench' : 'Testing unavailable');
    button.title = supported
      ? 'Compare staged training candidates with frozen generation settings.'
      : 'Test Generations is not available for the selected Base Model.';
  }

  function candidateRunLabel(run, index) {
    var name = String(run && run.runName || '').trim();
    var sequence = String(run && run.runSequence || '').trim();
    if (name && sequence) return name + ' · Run ' + sequence;
    if (name) return name;
    if (sequence) return 'Run ' + sequence;
    return 'Run ' + String(index + 1);
  }

  function openCandidatesForRun(run) {
    if (!run || !run.jobId || !run.folder) throw new Error('Training candidate run provenance is incomplete.');
    if (typeof openTrainingCandidates !== 'function') throw new Error('Training Candidates is unavailable.');
    openTrainingCandidates({ id: String(run.jobId), folder: String(run.folder) }, {
      onClose: function () {
        refreshStagedFilesAfterCandidates().catch(showError);
      }
    });
  }

  function syncCandidatesButton(payload) {
    var button = el('test-generations-candidates-btn');
    if (!button) return;
    var runs = payload && Array.isArray(payload.candidateRuns)
      ? payload.candidateRuns.filter(function (run) { return run && run.jobId && run.folder; })
      : [];
    button.classList.toggle('hidden', !runs.length);
    button.textContent = 'Candidates';
    button.title = runs.length > 1
      ? 'Choose which training run to open'
      : 'Open the training candidates for this Set';
  }

  function openCandidateRunMenu(button) {
    var runs = prepared && Array.isArray(prepared.candidateRuns)
      ? prepared.candidateRuns.filter(function (run) { return run && run.jobId && run.folder; })
      : [];
    if (!runs.length) throw new Error('This Test source has no linked training candidate runs.');
    if (runs.length === 1) {
      openCandidatesForRun(runs[0]);
      return;
    }
    var rect = button.getBoundingClientRect();
    showContextMenu(rect.left, rect.bottom + 4, runs.map(function (run, index) {
      return {
        label: candidateRunLabel(run, index),
        run: function () { openCandidatesForRun(run); }
      };
    }));
  }

  function refreshStagedFilesAfterCandidates() {
    return request('test_prepare', { modelId: currentTestModelId() }).then(function (payload) {
      prepared = payload;
      renderStagedFiles(payload);
      syncCandidatesButton(payload);
      syncActiveRunControls(currentStatus);
    });
  }

  function lastTrainingArchiveText() {
    var archive = state && state.lastTrainingArchive && typeof state.lastTrainingArchive === 'object'
      ? state.lastTrainingArchive
      : null;
    if (!archive) return '';
    var parts = ['Last archived'];
    var epoch = Number(archive.selectedEpoch || 0);
    if (epoch > 0) parts.push('Epoch ' + Math.round(epoch));
    var archivedAt = Number(archive.archivedAt || 0);
    if (archivedAt > 0) parts.push(new Date(archivedAt * 1000).toLocaleString());
    return parts.join(' · ');
  }

  function stagedFileParts(fileName) {
    var name = String(fileName || '');
    var match = name.match(/^(.*)__epoch(\d+)\.safetensors$/i);
    return match
      ? { label: 'Epoch ' + match[2], detail: match[1], fileName: name }
      : { label: name, detail: '', fileName: name };
  }

  function sessionLabel(sessionName) {
    var name = String(sessionName || '');
    var match = name.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})(?:-|$)/i);
    return match ? match[1] + ' · ' + match[2] + ':' + match[3] : name;
  }

  function syncSessionSelection() {
    var host = el('test-generations-sessions-list');
    if (!host) return;
    Array.prototype.forEach.call(host.querySelectorAll('[data-session-name]'), function (row) {
      row.classList.toggle('is-active', String(row.dataset.sessionName || '') === String(currentSession || ''));
    });
  }

  function selectedCandidateFiles() {
    if (!(selectedCandidates instanceof Set)) return [];
    return Array.from(selectedCandidates);
  }

  function syncCandidateMasterSelect(files) {
    var master = el('test-generations-master-select');
    if (!master) return;
    var available = Array.isArray(files) ? files : [];
    var selectedCount = available.reduce(function (count, fileName) {
      return count + (selectedCandidates instanceof Set && selectedCandidates.has(String(fileName || '')) ? 1 : 0);
    }, 0);
    master.disabled = !available.length;
    master.checked = !!available.length && selectedCount === available.length;
    master.indeterminate = selectedCount > 0 && selectedCount < available.length;
  }

  function renderStagedFiles(payload) {
    var count = Number(payload && payload.count || 0);
    var files = payload && Array.isArray(payload.files) ? payload.files : [];
    var scores = payload && payload.candidateScores && typeof payload.candidateScores === 'object'
      ? payload.candidateScores
      : {};
    var candidateMetadata = payload && payload.candidateMetadata && typeof payload.candidateMetadata === 'object'
      ? payload.candidateMetadata
      : {};
    if (!(selectedCandidates instanceof Set)) {
      var savedSettings = savedTestModelState().settings;
      var savedSelection = state
        && String(state.folder || '') === String(launchFolder || '')
        && Array.isArray(savedSettings.selectedFiles)
          ? savedSettings.selectedFiles
          : null;
      selectedCandidates = new Set(savedSelection === null ? files : savedSelection);
    }
    Array.from(selectedCandidates).forEach(function (fileName) {
      if (files.indexOf(fileName) === -1) selectedCandidates.delete(fileName);
    });
    if (!candidateStrengths || typeof candidateStrengths !== 'object') {
      candidateStrengths = Object.create(null);
      var savedStrengths = savedSettings.candidateStrengths && typeof savedSettings.candidateStrengths === 'object'
        ? savedSettings.candidateStrengths
        : {};
      var defaultStrength = Number(payload && payload.defaultStrength);
      if (!isFinite(defaultStrength)) defaultStrength = 1;
      files.forEach(function (fileName) {
        var savedStrength = Number(savedStrengths[fileName]);
        candidateStrengths[fileName] = isFinite(savedStrength) && savedStrength >= -2 && savedStrength <= 2
          ? savedStrength
          : defaultStrength;
      });
    }
    Object.keys(candidateStrengths).forEach(function (fileName) {
      if (files.indexOf(fileName) === -1) delete candidateStrengths[fileName];
    });
    var summary = el('test-generations-summary');
    var countEl = el('test-generations-files-count');
    var host = el('test-generations-files');
    if (summary) {
      var runCount = payload && Array.isArray(payload.candidateRuns) ? payload.candidateRuns.length : 0;
      summary.textContent = (String(payload && payload.modelLabel || '').trim() ? String(payload.modelLabel).trim() + ' · ' : '') +
        count + ' candidate' + (count === 1 ? '' : 's') +
        (runCount ? ' · ' + runCount + ' run' + (runCount === 1 ? '' : 's') : '');
    }
    if (countEl) countEl.textContent = String(count);
    if (!host) return;
    host.innerHTML = '';

    var archiveText = lastTrainingArchiveText();
    if (archiveText) {
      var archiveFact = document.createElement('div');
      archiveFact.className = 'test-generations-library-empty test-generations-archive-fact';
      archiveFact.textContent = archiveText;
      var archive = state && state.lastTrainingArchive && typeof state.lastTrainingArchive === 'object'
        ? state.lastTrainingArchive
        : {};
      if (archive.productionFileName) archiveFact.title = 'Production LoRA: ' + String(archive.productionFileName);
      host.appendChild(archiveFact);
    }

    var baseRow = document.createElement('div');
    baseRow.className = 'test-generations-staged-row test-generations-base-row';
    baseRow.title = 'Include a Base rendition for comparison in the next Test run';

    var baseInclude = document.createElement('input');
    var savedSettings = savedTestModelState().settings;
    var includeBase = !(state
      && String(state.folder || '') === String(launchFolder || '')
      && savedSettings.includeBase === false);
    baseInclude.type = 'checkbox';
    baseInclude.id = 'test-generations-base-include';
    baseInclude.className = 'test-generations-candidate-checkbox';
    baseInclude.checked = includeBase;
    baseInclude.title = 'Include the Base rendition in the next Test run';
    baseInclude.setAttribute('aria-label', 'Include Base rendition in next Test run');
    baseInclude.addEventListener('change', function () {
      saveTestBenchState();
    });

    var baseCopy = document.createElement('div');
    baseCopy.className = 'test-generations-staged-copy';
    var baseName = document.createElement('strong');
    baseName.textContent = 'Base';
    var baseDetail = document.createElement('span');
    baseDetail.textContent = 'Reference comparison';
    baseCopy.appendChild(baseName);
    baseCopy.appendChild(baseDetail);

    baseRow.appendChild(baseInclude);
    baseRow.appendChild(baseCopy);
    host.appendChild(baseRow);

    if (!files.length) {
      var emptyCandidates = document.createElement('div');
      emptyCandidates.className = 'test-generations-library-empty';
      emptyCandidates.textContent = 'No staged candidates for this Set.';
      host.appendChild(emptyCandidates);
      syncCandidateMasterSelect(files);
      return;
    }
    files.forEach(function (fileName) {
      var parts = stagedFileParts(fileName);
      var metadata = candidateMetadata[String(fileName || '')] || null;
      var row = document.createElement('div');
      row.className = 'test-generations-staged-row' + (metadata && metadata.selected ? ' is-selected' : '');
      row.title = parts.fileName;
      var include = document.createElement('input');
      include.type = 'checkbox';
      include.className = 'test-generations-candidate-checkbox';
      include.dataset.candidateSelect = String(fileName || '');
      include.checked = selectedCandidates.has(String(fileName || ''));
      include.title = 'Include this staged LoRA in the next Test run';
      include.setAttribute('aria-label', 'Include ' + String(fileName || 'candidate') + ' in next Test run');

      var copy = document.createElement('div');
      copy.className = 'test-generations-staged-copy';
      var name = document.createElement('strong');
      name.className = 'test-generations-staged-name';
      name.textContent = parts.label;
      if (metadata && metadata.selected) {
        var selectedMark = document.createElement('span');
        selectedMark.className = 'test-generations-selected-mark';
        selectedMark.title = 'Selected epoch';
        selectedMark.setAttribute('aria-label', 'Selected epoch');
        selectedMark.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="6" r="3.5"></circle><path d="M5.5 9l-1 5 3.5-2 3.5 2-1-5"></path></svg>';
        name.appendChild(selectedMark);
      }
      var detail = document.createElement('span');
      var score = scores[String(fileName || '')];
      var scoreText = score && Number(score.count || 0)
        ? ('★ ' + Number(score.average || 0).toFixed(1) + ' (' + Number(score.count || 0) + ')')
        : '';
      detail.textContent = [parts.detail, scoreText].filter(Boolean).join(' · ');
      copy.appendChild(name);
      if (detail.textContent) copy.appendChild(detail);

      var strength = document.createElement('input');
      strength.type = 'number';
      strength.className = 'test-generations-candidate-strength';
      strength.dataset.candidateStrength = String(fileName || '');
      strength.min = '-2';
      strength.max = '2';
      strength.step = '0.05';
      strength.title = 'Strength';
      strength.setAttribute('aria-label', 'Strength for ' + String(parts.label || fileName || 'candidate'));
      strength.value = String(candidateStrengths[fileName]);

      var actions = document.createElement('div');
      actions.className = 'test-generations-staged-actions';
      if (metadata && metadata.folder && metadata.stage && Number(metadata.epoch) > 0) {
        if (metadata.selected) {
          var archive = document.createElement('button');
          archive.type = 'button';
          archive.className = 'training-btn test-generations-archive-candidate';
          archive.dataset.archiveCandidate = String(fileName || '');
          archive.title = 'Archive this training run';
          archive.setAttribute('aria-label', 'Archive training run for selected epoch ' + String(metadata.epoch));
          archive.textContent = 'Archive';
          actions.appendChild(archive);
        } else if (!metadata.saved && metadata.jobId) {
          var save = document.createElement('button');
          save.type = 'button';
          save.className = 'test-generations-save-candidate';
          save.dataset.saveCandidate = String(fileName || '');
          save.title = 'Save this epoch';
          save.setAttribute('aria-label', 'Save epoch ' + String(metadata.epoch));
          save.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 2.5h9l2 2v9h-11z"></path><path d="M5 2.5v4h6v-4"></path><path d="M5 10h6v3.5H5z"></path></svg>';
          actions.appendChild(save);
        }
      }
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'test-generations-remove-candidate';
      remove.dataset.fileName = String(fileName || '');
      remove.title = 'Remove this Test candidate';
      remove.setAttribute('aria-label', 'Remove ' + String(fileName || 'candidate'));
      remove.textContent = '×';
      actions.appendChild(remove);
      row.appendChild(include);
      row.appendChild(copy);
      row.appendChild(strength);
      row.appendChild(actions);
      host.appendChild(row);
    });
    syncCandidateMasterSelect(files);
  }

  function sessionStatusText(session) {
    var completed = Number(session && session.completed || 0);
    var total = Number(session && session.total || 0);
    var failed = Number(session && session.failed || 0);
    var queued = Number(session && session.queued || 0);
    var running = Number(session && session.running || 0);
    var text = String(session && session.status || '') + ' · ' + completed + ' / ' + total + ' complete' +
      (running ? ' · ' + running + ' running' : '') +
      (queued ? ' · ' + queued + ' queued' : '') +
      (failed ? ' · ' + failed + ' failed' : '');
    var startedAt = Number(session && (session.candidateStartedAt || session.startedAt) || 0);
    if (startedAt && session && (session.status === 'running' || session.status === 'stopping')) {
      text += ' · ' + formatElapsedMs(Date.now() - startedAt);
    }
    if (
      session &&
      currentStatus &&
      String(currentStatus.session || '') === String(session.session || '') &&
      (session.status === 'running' || session.status === 'stopping')
    ) {
      text += liveStatusDetails(currentStatus);
    }
    return text;
  }

  function syncVisibleSessionProgress(status) {
    var sessionName = String(status && status.session || '');
    var host = el('test-generations-sessions-list');
    if (!sessionName || !host) return;
    var rows = host.querySelectorAll('.test-generations-session-row[data-session-name]');
    Array.prototype.some.call(rows, function (row) {
      if (String(row.dataset.sessionName || '') !== sessionName) return false;
      var meta = row.querySelector('.test-generations-session-copy > span');
      if (meta) meta.textContent = sessionStatusText(status);
      var progress = row.querySelector('.test-generations-session-progress');
      if (progress) {
        var completed = Number(status.completed || 0);
        var failed = Number(status.failed || 0);
        var total = Number(status.total || 0);
        var processed = Math.max(0, completed + failed);
        var percent = total > 0 ? Math.max(0, Math.min(100, processed / total * 100)) : 0;
        progress.setAttribute('aria-valuemax', String(total || 0));
        progress.setAttribute('aria-valuenow', String(processed));
        var fill = progress.querySelector('span');
        if (fill) fill.style.width = percent.toFixed(1) + '%';
      }
      return true;
    });
  }

  function renderSessions(sessions, queuedJobs) {
    var items = Array.isArray(sessions) ? sessions : [];
    var queued = Array.isArray(queuedJobs) ? queuedJobs : [];
    var countEl = el('test-generations-sessions-count');
    var host = el('test-generations-sessions-list');
    if (countEl) countEl.textContent = String(items.length + queued.length);
    var clearBtn = el('test-generations-clear-queue-btn');
    if (clearBtn) clearBtn.classList.toggle('hidden', !queued.length);
    var clearSessionsBtn = el('test-generations-clear-sessions-btn');
    if (clearSessionsBtn) {
      var hasActiveSession = queued.length > 0 || items.some(function (session) {
        return session && (session.status === 'running' || session.status === 'stopping' || session.status === 'starting');
      });
      clearSessionsBtn.classList.toggle('hidden', !items.length);
      clearSessionsBtn.disabled = hasActiveSession;
      clearSessionsBtn.title = hasActiveSession
        ? 'Stop or clear queued Test work before clearing history'
        : 'Delete all Test session history for this Set';
    }
    if (!host) return;

    var activeItems = items.filter(function (session) {
      return session && (session.status === 'running' || session.status === 'stopping' || session.status === 'starting');
    });
    var historyItems = items.filter(function (session) {
      return activeItems.indexOf(session) === -1;
    });

    var empty = host.querySelector('.test-generations-library-empty');
    if ((items.length || queued.length) && empty) empty.remove();

    function ensureGroup(key, label, count, className) {
      var group = host.querySelector('[data-session-group="' + key + '"]');
      if (!group) {
        group = document.createElement('section');
        group.dataset.sessionGroup = key;
        var heading = document.createElement('div');
        heading.className = 'test-generations-session-group-heading';
        var title = document.createElement('strong');
        title.dataset.sessionGroupTitle = '1';
        var badge = document.createElement('span');
        badge.dataset.sessionGroupCount = '1';
        heading.appendChild(title);
        heading.appendChild(badge);
        var body = document.createElement('div');
        body.className = 'test-generations-session-group-list';
        body.dataset.sessionGroupList = '1';
        group.appendChild(heading);
        group.appendChild(body);
        host.appendChild(group);
      }
      group.className = 'test-generations-session-group ' + className;
      group.querySelector('[data-session-group-title]').textContent = label;
      group.querySelector('[data-session-group-count]').textContent = String(count);

      var order = { running: 0, queued: 1, history: 2 };
      var groups = host.querySelectorAll('[data-session-group]');
      var expected = groups[order[key]] || null;
      if (expected !== group) host.insertBefore(group, expected);

      return group.querySelector('[data-session-group-list]');
    }

    function ensureRow(key) {
      var row = null;
      Array.prototype.some.call(host.querySelectorAll('[data-session-row-key]'), function (candidate) {
        if (String(candidate.dataset.sessionRowKey || '') !== key) return false;
        row = candidate;
        return true;
      });
      if (row) return row;

      row = document.createElement('div');
      row.className = 'test-generations-session-row';
      row.dataset.sessionRowKey = key;

      var stateBadge = document.createElement('span');
      stateBadge.className = 'test-generations-session-state';
      stateBadge.dataset.sessionRowState = '1';

      var copy = document.createElement('div');
      copy.className = 'test-generations-session-copy';
      var title = document.createElement('strong');
      title.dataset.sessionRowTitle = '1';
      var meta = document.createElement('span');
      meta.dataset.sessionRowMeta = '1';
      copy.appendChild(title);
      copy.appendChild(meta);

      var actions = document.createElement('div');
      actions.className = 'test-generations-session-actions';
      actions.dataset.sessionRowActions = '1';

      row.appendChild(stateBadge);
      row.appendChild(copy);
      row.appendChild(actions);
      return row;
    }

    function placeRow(target, row, index) {
      var current = target.children[index] || null;
      if (current !== row) target.insertBefore(row, current);
    }

    function ensureButton(actions, key, className, text) {
      var button = actions.querySelector('[data-session-control="' + key + '"]');
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.dataset.sessionControl = key;
        actions.appendChild(button);
      }
      button.className = className;
      button.textContent = text;
      return button;
    }

    function removeControl(actions, key) {
      var button = actions.querySelector('[data-session-control="' + key + '"]');
      if (button) button.remove();
    }

    function syncSessionRow(session, target, index) {
      var name = String(session.session || '');
      var row = ensureRow('session:' + name);
      row.className = 'test-generations-session-row';
      row.dataset.sessionName = name;
      row.title = name;

      row.querySelector('[data-session-row-title]').textContent =
        String(session.name || '').trim() || sessionLabel(name);
      row.querySelector('[data-session-row-meta]').textContent = sessionStatusText(session);
      var stateBadge = row.querySelector('[data-session-row-state]');
      var state = String(session.status || '').trim().toLowerCase() || 'complete';
      if (stateBadge) {
        stateBadge.className = 'test-generations-session-state status-' + state;
        stateBadge.textContent = state === 'complete'
          ? 'Complete'
          : (state === 'starting' ? 'Starting'
            : (state === 'running' ? 'Running'
              : (state === 'stopping' ? 'Stopping'
                : (state === 'stopped' ? 'Stopped'
                  : (state === 'failed' ? 'Failed' : state)))));
      }

      var copy = row.querySelector('.test-generations-session-copy');
      var active = session.status === 'running' || session.status === 'stopping' || session.status === 'starting';
      var progress = copy.querySelector('.test-generations-session-progress');
      if (active) {
        var completed = Number(session.completed || 0);
        var failed = Number(session.failed || 0);
        var total = Number(session.total || 0);
        var processed = Math.max(0, completed + failed);
        var percent = total > 0 ? Math.max(0, Math.min(100, processed / total * 100)) : 0;
        if (!progress) {
          progress = document.createElement('div');
          progress.className = 'test-generations-session-progress';
          progress.setAttribute('role', 'progressbar');
          var fill = document.createElement('span');
          progress.appendChild(fill);
          copy.appendChild(progress);
        }
        progress.setAttribute('aria-valuemin', '0');
        progress.setAttribute('aria-valuemax', String(total || 0));
        progress.setAttribute('aria-valuenow', String(processed));
        progress.querySelector('span').style.width = percent.toFixed(1) + '%';
      } else if (progress) {
        progress.remove();
      }

      var actions = row.querySelector('[data-session-row-actions]');
      var resultFolder = String(session.resultFolder || '');
      var open = ensureButton(actions, 'open', 'review-captions-btn', 'Open');
      open.dataset.sessionFolderOpen = resultFolder;
      open.dataset.sessionReveal = resultFolder ? '' : name;
      open.disabled = !resultFolder && !name;

      if (active) {
        removeControl(actions, 'delete');
        var stop = ensureButton(
          actions,
          'stop',
          'review-captions-btn test-generations-stop-btn',
          session.status === 'stopping' ? 'Stopping…' : 'Stop'
        );
        stop.dataset.sessionStop = name;
        stop.disabled = session.status === 'stopping';
      } else {
        removeControl(actions, 'stop');
        var remove = ensureButton(actions, 'delete', 'test-generations-remove-candidate', '×');
        remove.dataset.sessionDelete = name;
        remove.title = 'Delete this Test session';
        remove.setAttribute('aria-label', 'Delete Test session ' + name);
      }

      placeRow(target, row, index);
      return row;
    }

    function syncQueuedRow(job, target, index) {
      var jobId = String(job.id || '');
      var row = ensureRow('queue:' + jobId);
      row.className = 'test-generations-session-row';
      row.dataset.queueJobId = jobId;
      row.removeAttribute('data-session-name');
      row.querySelector('[data-session-row-title]').textContent =
        String(job.runName || '').trim() || 'Queued Test';
      var stateBadge = row.querySelector('[data-session-row-state]');
      if (stateBadge) {
        stateBadge.className = 'test-generations-session-state status-queued';
        stateBadge.textContent = 'Queued';
      }

      var total = Number(job.testTotal || 0);
      var position = Number(job.queuePosition || 0);
      var queuedModel = supportedTestModels[String(job.modelId || '')] || {};
      row.querySelector('[data-session-row-meta]').textContent =
        (String(queuedModel.label || '').trim() ? String(queuedModel.label).trim() + ' · ' : '') +
        'queued' + (position ? ' · Queue #' + position : '') + (total ? ' · ' + total + ' renders' : '');

      var copy = row.querySelector('.test-generations-session-copy');
      var progress = copy.querySelector('.test-generations-session-progress');
      if (progress) progress.remove();

      var actions = row.querySelector('[data-session-row-actions]');
      Array.prototype.forEach.call(actions.querySelectorAll('[data-session-control]'), function (button) {
        if (button.dataset.sessionControl !== 'queue-cancel') button.remove();
      });
      var remove = ensureButton(actions, 'queue-cancel', 'test-generations-remove-candidate', '×');
      remove.dataset.queueCancel = jobId;
      remove.title = 'Remove this queued Test session';
      remove.setAttribute(
        'aria-label',
        'Remove queued Test session ' + row.querySelector('[data-session-row-title]').textContent
      );

      placeRow(target, row, index);
      return row;
    }

    var validRows = {};
    var usedGroups = {};

    if (activeItems.length) {
      usedGroups.running = true;
      var runningList = ensureGroup('running', 'Running', activeItems.length, 'is-running');
      activeItems.forEach(function (session, index) {
        var row = syncSessionRow(session, runningList, index);
        validRows[String(row.dataset.sessionRowKey || '')] = true;
      });
    }

    if (queued.length) {
      usedGroups.queued = true;
      var queuedList = ensureGroup('queued', 'Queued', queued.length, 'is-queued');
      queued.forEach(function (job, index) {
        var row = syncQueuedRow(job, queuedList, index);
        validRows[String(row.dataset.sessionRowKey || '')] = true;
      });
    }

    if (historyItems.length) {
      usedGroups.history = true;
      var historyList = ensureGroup('history', 'History', historyItems.length, 'is-history');
      historyItems.forEach(function (session, index) {
        var row = syncSessionRow(session, historyList, index);
        validRows[String(row.dataset.sessionRowKey || '')] = true;
      });
    }

    Array.prototype.forEach.call(host.querySelectorAll('[data-session-row-key]'), function (row) {
      if (!validRows[String(row.dataset.sessionRowKey || '')]) row.remove();
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-session-group]'), function (group) {
      if (!usedGroups[String(group.dataset.sessionGroup || '')]) group.remove();
    });

    if (!items.length && !queued.length && !host.querySelector('.test-generations-library-empty')) {
      empty = document.createElement('div');
      empty.className = 'test-generations-library-empty';
      empty.textContent = 'No test sessions yet.';
      host.appendChild(empty);
    }

    syncSessionSelection();
  }

  function refreshSessions() {
    lastSessionsRefreshAt = Date.now();
    var modelId = currentTestModelId();
    return Promise.all([
      request('test_sessions', { modelId: modelId }),
      request('test_queue', { modelId: modelId })
    ]).then(function (payloads) {
      var sessionPayload = payloads[0] || {};
      var queuePayload = payloads[1] || {};
      queuedTestJobs = Array.isArray(queuePayload.jobs) ? queuePayload.jobs : [];
      renderSessions(sessionPayload.sessions, queuedTestJobs);
      return { sessions: sessionPayload.sessions || [], jobs: queuedTestJobs };
    });
  }

  function refreshSessionsIfDue(intervalMs) {
    if ((Date.now() - lastSessionsRefreshAt) < Number(intervalMs || 0)) {
      return Promise.resolve({ jobs: queuedTestJobs });
    }
    return refreshSessions();
  }

  function cancelQueuedTest(jobId) {
    var id = String(jobId || '').trim();
    if (!id) return Promise.resolve();
    return request('test_queue_cancel', { jobId: id }).then(function () { return refreshSessions(); });
  }

  function clearQueuedTests() {
    return request('test_queue_clear', { modelId: currentTestModelId() }).then(function () { return refreshSessions(); });
  }

  function forgetTrackedTestSessions(folder, sessionName) {
    var owner = String(owningSetFolder(folder) || '');
    var prefix = owner + '|';
    Object.keys(trackedTestInferenceSessions).forEach(function (key) {
      if (key.indexOf(prefix) !== 0) return;
      if (sessionName && key !== testInferenceSessionKey(owner, sessionName)) return;
      delete trackedTestInferenceSessions[key];
      delete pendingTestCompletionChecks[key];
    });
  }

  function clearTestSessions() {
    if (!window.confirm('Clear all Test session history for this Set? Generated session results will be deleted.')) {
      return Promise.resolve();
    }
    return request('test_clear_sessions', {}).then(function () {
      forgetTrackedTestSessions(launchFolder);
      currentSession = '';
      currentSessionFolder = '';
      currentSessionModel = '';
      showSessionError = false;
      renderStatus({ status: 'idle' });
      return refreshSessions();
    });
  }

  function formatElapsedMs(milliseconds) {
    var seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
    var minutes = Math.floor(seconds / 60);
    var hours = Math.floor(minutes / 60);
    seconds %= 60;
    minutes %= 60;
    if (hours) return hours + 'h ' + String(minutes).padStart(2, '0') + 'm';
    if (minutes) return minutes + 'm ' + String(seconds).padStart(2, '0') + 's';
    return seconds + 's';
  }

  function liveStatusDetails(status) {
    if (!status || (status.status !== 'running' && status.status !== 'stopping')) return '';
    var parts = [];
    var progress = formatInferenceProgress(status.progress);
    var comfyStatus = String(status.comfyStatus || '').trim();
    var jobId = String(status.comfyJobId || '').trim();
    var startedAt = Number(status.candidateStartedAt || status.startedAt || 0);
    var lastContactAt = Number(status.comfyLastContactAt || 0);
    if (progress) parts.push(progress);
    if (comfyStatus) parts.push('Comfy ' + comfyStatus);
    if (jobId) parts.push('Job ' + jobId.slice(0, 8));
    if (startedAt) parts.push('elapsed ' + formatElapsedMs(Date.now() - startedAt));
    if (lastContactAt) parts.push('contact ' + formatElapsedMs(Date.now() - lastContactAt) + ' ago');
    return parts.length ? ' · ' + parts.join(' · ') : '';
  }

  function statusText(status) {
    if (!status || status.status === 'idle') return '';
    var completed = Number(status.completed || 0);
    var total = Number(status.total || 0);
    var failed = Number(status.failed || 0);
    if (status.status === 'running') return 'Running ' + completed + ' / ' + total + (failed ? ' · ' + failed + ' failed' : '') + (status.current ? ' · ' + status.current : '') + liveStatusDetails(status);
    if (status.status === 'stopping') return 'Stopping · ' + completed + ' / ' + total + liveStatusDetails(status);
    if (status.status === 'stopped') return 'Stopped · ' + completed + ' / ' + total;
    if (status.status === 'complete') return 'Complete · ' + completed + ' / ' + total + (failed ? ' · ' + failed + ' failed' : '');
    if (status.status === 'failed') return 'Batch failed · ' + completed + ' / ' + total;
    return String(status.status || '');
  }

  function mediaUrl(sessionName, fileName) {
    return '/fs/test_generations/media?folder=' + encodeURIComponent(String(launchFolder || '')) +
      '&session=' + encodeURIComponent(String(sessionName || '')) +
      '&media=' + encodeURIComponent(String(fileName || ''));
  }

  function appendTestPreview(container, sessionName, result, options) {
    var fileName = resultMediaFile(result);
    var kind = resultMediaKind(result);
    if (!container || !sessionName || !fileName) return null;
    if (kind === 'image') {
      var image = document.createElement('img');
      image.src = mediaUrl(sessionName, fileName);
      image.alt = 'Test preview image';
      image.loading = 'lazy';
      container.appendChild(image);
      return image;
    }
    var video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = !!(options && options.muted);
    video.src = mediaUrl(sessionName, fileName);
    appendTestPreviewVideo(container, video);
    return video;
  }

  function candidateFileForResult(result) {
    var candidateFile = String(result && result.candidateFile || '');
    if (!candidateFile && String(result && result.kind || '') !== 'base' && /\.safetensors$/i.test(String(result && result.sourceLoRA || ''))) {
      candidateFile = String(result.sourceLoRA || '');
    }
    return candidateFile;
  }

  function candidateIdentity(result) {
    if (String(result && result.kind || '') === 'base' || String(result && result.sourceLoRA || '') === 'Base') {
      return { primary: 'Base', secondary: '' };
    }

    var sourceFile = candidateFileForResult(result) || String(result && result.sourceLoRA || '');
    var provenance = result && result.provenance && typeof result.provenance === 'object' ? result.provenance : {};
    var runSequence = String(provenance.sourceRunSequence || '').trim();
    var epoch = provenance.sourceEpoch;
    var match = sourceFile.match(/^(.*)__epoch(\d+)\.safetensors$/i);

    if (!runSequence && match) {
      var runMatch = String(match[1] || '').match(/(?:^|[-_])(?:run[-_]?)?(\d+)$/i);
      if (runMatch) runSequence = runMatch[1];
    }
    if ((epoch === undefined || epoch === null || epoch === '') && match) epoch = match[2];

    var identity = [];
    if (runSequence) identity.push('Run ' + String(runSequence).padStart(2, '0'));
    if (epoch !== undefined && epoch !== null && String(epoch).trim() !== '') identity.push('Epoch ' + String(epoch).trim());

    return {
      primary: identity.length ? identity.join(' · ') : (stagedFileParts(sourceFile).label || sourceFile || 'Result'),
      secondary: sourceFile
    };
  }

  function formatCandidateElapsed(milliseconds) {
    var value = Number(milliseconds);
    if (!isFinite(value) || value < 0) return '';
    var seconds = Math.floor(value / 1000);
    var hours = Math.floor(seconds / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);
    seconds %= 60;
    if (hours) return hours + 'h ' + minutes + 'm';
    if (minutes) return minutes + 'm ' + seconds + 's';
    return seconds + 's';
  }

  function resultMediaFile(result) {
    return String(result && (result.mediaFile || result.outputVideo) || '').trim();
  }

  function resultMediaKind(result) {
    var explicitKind = String(result && result.mediaKind || '').trim().toLowerCase();
    if (explicitKind) return explicitKind;
    var fileName = resultMediaFile(result).toLowerCase();
    return /\.(?:png|jpe?g|webp|gif|bmp|avif)$/.test(fileName) ? 'image' : (fileName ? 'video' : '');
  }

  function buildResultRating(result, sessionName) {
    var mediaFile = resultMediaFile(result);
    var session = String(sessionName || '').trim();
    if (!mediaFile || !session) return null;

    var currentRating = Math.max(0, Math.min(5, Number(result && result.rating || 0)));
    var stars = document.createElement('div');
    stars.className = 'test-generations-result-rating';
    stars.setAttribute('aria-label', 'Rate this Test result');

    for (var value = 1; value <= 5; value += 1) {
      var star = document.createElement('button');
      star.type = 'button';
      star.className = 'test-generations-result-star' + (value <= currentRating ? ' active' : '');
      star.dataset.testRating = String(value);
      star.dataset.mediaFile = mediaFile;
      star.dataset.testSession = session;
      star.title = 'Rate ' + value + ' star' + (value === 1 ? '' : 's');
      star.setAttribute('aria-label', star.title);
      star.textContent = value <= currentRating ? '★' : '☆';
      stars.appendChild(star);
    }
    return stars;
  }

  function syncResultRatingButtons(sessionName, mediaFile, rating) {
    var session = String(sessionName || '').trim();
    var name = String(mediaFile || '').trim();
    var value = Math.max(0, Math.min(5, Number(rating || 0)));
    if (!session || !name) return;
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-test-rating][data-media-file][data-test-session]'),
      function (star) {
        if (String(star.dataset.testSession || '') !== session || String(star.dataset.mediaFile || '') !== name) return;
        var starValue = Number(star.dataset.testRating || 0);
        var active = starValue <= value;
        star.classList.toggle('active', active);
        star.textContent = active ? '★' : '☆';
        star.disabled = false;
      }
    );
  }

  function rateTestResult(button) {
    var rating = Number(button && button.dataset.testRating || 0);
    var mediaFile = String(button && button.dataset.mediaFile || '').trim();
    var sessionName = String(button && button.dataset.testSession || '').trim();
    if (!mediaFile || !sessionName || rating < 1 || rating > 5) return;

    var row = button.closest('.test-generations-result-rating');
    if (row) {
      Array.prototype.forEach.call(row.querySelectorAll('[data-test-rating]'), function (star) {
        star.disabled = true;
      });
    }

    request('test_rate_result', {
      session: sessionName,
      mediaFile: mediaFile,
      rating: rating
    }).then(function (payload) {
      syncResultRatingButtons(sessionName, mediaFile, payload && payload.rating);
      if (currentStatus && String(currentStatus.session || '') === sessionName && Array.isArray(currentStatus.results)) {
        currentStatus.results.forEach(function (result) {
          if (resultMediaFile(result) === mediaFile) result.rating = payload.rating;
        });
      }
      return request('test_rating_summary', { modelId: currentTestModelId() });
    }).then(function (payload) {
      if (prepared && payload && payload.candidateScores) {
        prepared.candidateScores = payload.candidateScores;
        renderStagedFiles(prepared);
      }
      if (payload && payload.sessions) renderSessions(payload.sessions, queuedTestJobs);
    }).catch(function (err) {
      if (row) {
        Array.prototype.forEach.call(row.querySelectorAll('[data-test-rating]'), function (star) {
          star.disabled = false;
        });
      }
      showError(err);
    });
  }

  function buildResultRemoveButton(result) {
    var candidateFile = candidateFileForResult(result);
    if (!candidateFile) return null;

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'test-generations-result-remove';
    remove.dataset.removeCandidate = candidateFile;
    remove.title = 'Remove this staged candidate and its result from this session.';
    remove.setAttribute('aria-label', 'Remove staged candidate ' + candidateFile);
    remove.textContent = '×';
    return remove;
  }

  function buildResultFooter(result, options) {
    var opts = options || {};
    var footer = document.createElement('div');
    footer.className = 'test-generations-result-footer' + (opts.failed ? ' test-generations-failure-footer' : '');

    var copy = document.createElement('div');
    copy.className = opts.failed ? 'test-generations-failure-copy' : 'test-generations-result-copy';

    var identity = candidateIdentity(result);
    var primaryRow = document.createElement('div');
    primaryRow.className = 'test-generations-result-primary';

    var label = document.createElement('div');
    label.className = 'test-generations-result-name';
    label.textContent = identity.primary;
    primaryRow.appendChild(label);

    var elapsed = result && result.elapsedMs != null ? formatCandidateElapsed(result.elapsedMs) : '';
    if (elapsed) {
      var timing = document.createElement('span');
      timing.className = 'test-generations-result-elapsed';
      timing.textContent = opts.failed ? 'Failed after ' + elapsed : elapsed;
      primaryRow.appendChild(timing);
    }
    copy.appendChild(primaryRow);

    var secondaryRow = document.createElement('div');
    secondaryRow.className = 'test-generations-result-secondary';

    if (identity.secondary) {
      var source = document.createElement('div');
      source.className = 'test-generations-result-source';
      source.textContent = identity.secondary;
      source.title = identity.secondary;
      secondaryRow.appendChild(source);
    }

    if (!opts.failed) {
      var rating = buildResultRating(result, opts.sessionName);
      if (rating) secondaryRow.appendChild(rating);
    }

    if (secondaryRow.childNodes.length) copy.appendChild(secondaryRow);

    if (opts.failed) {
      var detail = document.createElement('div');
      detail.className = 'test-generations-result-error';
      detail.textContent = String(result && result.error || 'Generation failed.');
      copy.appendChild(detail);
    }

    footer.appendChild(copy);
    return footer;
  }

  function syncResultElapsed(card, result, failed) {
    var primary = card.querySelector('.test-generations-result-primary');
    var timing = primary.querySelector('.test-generations-result-elapsed');
    var elapsed = result && result.elapsedMs != null ? formatCandidateElapsed(result.elapsedMs) : '';
    if (!timing && elapsed) {
      timing = document.createElement('span');
      timing.className = 'test-generations-result-elapsed';
      primary.appendChild(timing);
    }
    if (timing) {
      timing.textContent = failed ? 'Failed after ' + elapsed : elapsed;
      timing.classList.toggle('hidden', !elapsed);
    }
  }

  function syncPendingElapsed(status) {
    if (pendingElapsedTimer) clearTimeout(pendingElapsedTimer);
    pendingElapsedTimer = null;
    var pending = el('test-generations-results').querySelector('.test-generations-result-card.is-pending');
    if (!pending) return;
    var timing = pending.querySelector('.test-generations-result-elapsed');
    var startedAt = Number(status && status.candidateStartedAt || 0);
    timing.textContent = startedAt ? formatElapsedMs(Date.now() - startedAt) : '';
    timing.classList.toggle('hidden', !startedAt);
    if (startedAt && isOpen()) {
      pendingElapsedTimer = setTimeout(function () { syncPendingElapsed(currentStatus); }, 1000);
    }
  }

  function formatTestVideoTime(value) {
    var seconds = Math.max(0, Number(value) || 0);
    var minutes = Math.floor(seconds / 60);
    var wholeSeconds = Math.floor(seconds % 60);
    return minutes + ':' + String(wholeSeconds).padStart(2, '0');
  }

  function appendTestPreviewVideo(container, video) {
    if (!container || !video) return;
    video.controls = false;
    video.playsInline = true;
    video.tabIndex = 0;
    video.setAttribute('aria-label', 'Test preview video. Click or press Space to play or pause.');

    var transport = document.createElement('div');
    transport.className = 'test-generations-video-transport';

    var play = document.createElement('button');
    play.type = 'button';
    play.className = 'test-generations-video-play';
    play.textContent = '▶';
    play.setAttribute('aria-label', 'Play preview');

    var scrubber = document.createElement('input');
    scrubber.type = 'range';
    scrubber.className = 'test-generations-video-scrubber';
    scrubber.min = '0';
    scrubber.max = '1000';
    scrubber.step = '1';
    scrubber.value = '0';
    scrubber.setAttribute('aria-label', 'Preview position');

    var time = document.createElement('span');
    time.className = 'test-generations-video-time';
    time.textContent = '0:00 / 0:00';

    function updateTransport() {
      var duration = Number(video.duration);
      var current = Number(video.currentTime);
      var validDuration = isFinite(duration) && duration > 0;
      scrubber.disabled = !validDuration;
      scrubber.value = validDuration ? String(Math.round((Math.max(0, current) / duration) * 1000)) : '0';
      time.textContent = formatTestVideoTime(current) + ' / ' + formatTestVideoTime(validDuration ? duration : 0);
      play.textContent = video.paused ? '▶' : '❚❚';
      play.setAttribute('aria-label', video.paused ? 'Play preview' : 'Pause preview');
    }

    function togglePlayback() {
      if (video.paused) {
        var promise = video.play();
        if (promise && typeof promise.catch === 'function') promise.catch(showError);
      } else {
        video.pause();
      }
    }

    play.onclick = function () { togglePlayback(); };
    scrubber.oninput = function () {
      var duration = Number(video.duration);
      if (!isFinite(duration) || duration <= 0) return;
      video.currentTime = duration * (Number(scrubber.value) / 1000);
    };
    video.onclick = function () { togglePlayback(); };
    video.onkeydown = function (event) {
      if (!event) return;
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        var direction = event.key === 'ArrowLeft' ? -1 : 1;
        video.currentTime = Math.max(0, Math.min(Number(video.duration) || 0, Number(video.currentTime || 0) + direction));
      }
    };
    ['loadedmetadata', 'durationchange', 'timeupdate', 'play', 'pause', 'ended', 'seeked'].forEach(function (eventName) {
      video.addEventListener(eventName, updateTransport);
    });

    container.appendChild(video);
    transport.appendChild(play);
    transport.appendChild(scrubber);
    transport.appendChild(time);
    container.appendChild(transport);
    updateTransport();
  }

  function setResultsView(mode) {
    resultsView = mode === 'compare' ? 'compare' : 'grid';
    var gridBtn = el('test-generations-view-grid-btn');
    var compareBtn = el('test-generations-view-compare-btn');
    var grid = el('test-generations-results');
    var compare = el('test-generations-compare');
    if (gridBtn) {
      gridBtn.classList.toggle('active', resultsView === 'grid');
      gridBtn.setAttribute('aria-selected', resultsView === 'grid' ? 'true' : 'false');
    }
    if (compareBtn) {
      compareBtn.classList.toggle('active', resultsView === 'compare');
      compareBtn.setAttribute('aria-selected', resultsView === 'compare' ? 'true' : 'false');
    }
    if (grid) grid.classList.toggle('hidden', resultsView !== 'grid');
    if (compare) compare.classList.toggle('hidden', resultsView !== 'compare');
    renderResults(currentStatus);
  }

  function syncCompareVideos(videos) {
    if (!videos || videos.length !== 2) return;
    var syncing = false;

    function mirror(source, target, action) {
      if (syncing) return;
      syncing = true;
      try {
        if (action === 'seek' && Math.abs(target.currentTime - source.currentTime) > 0.03) {
          target.currentTime = source.currentTime;
        }
        if (action === 'rate' && target.playbackRate !== source.playbackRate) {
          target.playbackRate = source.playbackRate;
        }
        if (action === 'play') {
          if (Math.abs(target.currentTime - source.currentTime) > 0.03) target.currentTime = source.currentTime;
          if (target.playbackRate !== source.playbackRate) target.playbackRate = source.playbackRate;
          if (target.paused) {
            var playPromise = target.play();
            if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(showError);
          }
        }
        if (action === 'pause') {
          if (Math.abs(target.currentTime - source.currentTime) > 0.03) target.currentTime = source.currentTime;
          if (!target.paused) target.pause();
        }
      } finally {
        syncing = false;
      }
    }

    videos.forEach(function (video, index) {
      var other = videos[index ? 0 : 1];
      video.addEventListener('play', function () { mirror(video, other, 'play'); });
      video.addEventListener('pause', function () { mirror(video, other, 'pause'); });
      video.addEventListener('seeked', function () { mirror(video, other, 'seek'); });
      video.addEventListener('ratechange', function () { mirror(video, other, 'rate'); });
    });
  }

  function renderCompare(status) {
    var host = el('test-generations-compare');
    if (!host) return;
    var results = status && Array.isArray(status.results) ? status.results : [];
    var resultFolder = String(status && status.resultFolder || '');
    var sessionName = String(status && status.session || '');

    if (results.length < 2) {
      host.dataset.compareKey = '';
      host.innerHTML = '<div class="test-generations-empty">At least two completed results are needed to compare.</div>';
      return;
    }

    compareIndex = Math.max(0, Math.min(compareIndex, results.length - 2));
    var pair = [results[compareIndex], results[compareIndex + 1]];
    var compareKey = sessionName + '|' + pair.map(function (result, index) {
      return String(resultMediaFile(result) || result.sourceLoRA || ('result-' + (compareIndex + index)));
    }).join('|');
    if (String(host.dataset.compareKey || '') === compareKey && host.querySelector('.test-generations-compare-stage')) {
      var existingPrevious = host.querySelector('[data-compare-previous]');
      var existingNext = host.querySelector('[data-compare-next]');
      var existingPosition = host.querySelector('[data-compare-position]');
      if (existingPrevious) existingPrevious.disabled = compareIndex <= 0;
      if (existingNext) existingNext.disabled = compareIndex >= results.length - 2;
      if (existingPosition) existingPosition.textContent = (compareIndex + 1) + ' / ' + (results.length - 1);
      return;
    }

    host.innerHTML = '';
    host.dataset.compareKey = compareKey;
    var stage = document.createElement('div');
    stage.className = 'test-generations-compare-stage';
    var videos = [];

    pair.forEach(function (result) {
      var item = document.createElement('article');
      item.className = 'test-generations-compare-item';

      var preview = appendTestPreview(item, sessionName, result, { muted: true });
      if (preview && preview.tagName === 'VIDEO') videos.push(preview);

      var remove = buildResultRemoveButton(result);
      if (remove) item.appendChild(remove);
      item.appendChild(buildResultFooter(result, { sessionName: sessionName }));
      stage.appendChild(item);
    });

    var controls = document.createElement('div');
    controls.className = 'test-generations-compare-controls';

    var previous = document.createElement('button');
    previous.type = 'button';
    previous.className = 'review-captions-btn';
    previous.dataset.comparePrevious = '1';
    previous.disabled = compareIndex <= 0;
    previous.textContent = 'Previous';

    var position = document.createElement('span');
    position.dataset.comparePosition = '1';
    position.textContent = (compareIndex + 1) + ' / ' + (results.length - 1);

    var next = document.createElement('button');
    next.type = 'button';
    next.className = 'review-captions-btn';
    next.dataset.compareNext = '1';
    next.disabled = compareIndex >= results.length - 2;
    next.textContent = 'Next';

    controls.appendChild(previous);
    controls.appendChild(position);
    controls.appendChild(next);
    host.appendChild(stage);
    host.appendChild(controls);
    if (videos.length === pair.length) syncCompareVideos(videos);
  }

  function renderResults(status) {
    var host = el('test-generations-results');
    if (!host) return;
    var results = status && Array.isArray(status.results) ? status.results : [];
    var failures = status && Array.isArray(status.failures) ? status.failures : [];
    var total = Number(status && status.total || (prepared && prepared.count) || 0);
    var resultFolder = String(status && status.resultFolder || '');
    var sessionName = String(status && status.session || '');
    var live = status && (status.status === 'running' || status.status === 'stopping');
    var resultScope = sessionName + '|' + resultFolder;
    var priorScope = String(host.dataset.resultScope || '');

    if (priorScope !== resultScope) {
      host.innerHTML = '';
      host.dataset.resultScope = resultScope;
    }

    var validKeys = results.map(function (result, index) {
      var mediaFile = resultMediaFile(result);
      return mediaFile || (String(result.sourceLoRA || 'result') + ':' + index);
    }).concat(failures.map(function (failure, index) {
      return 'failure:' + String(failure.sourceLoRA || 'result') + ':' + index;
    }));
    Array.prototype.forEach.call(
      host.querySelectorAll('.test-generations-result-card:not(.is-pending)'),
      function (card) {
        if (validKeys.indexOf(String(card.dataset.resultKey || '')) === -1) card.remove();
      }
    );

    var empty = host.querySelector('.test-generations-empty');
    if ((results.length || failures.length || live) && empty) empty.remove();

    results.forEach(function (result, index) {
      var mediaFile = resultMediaFile(result);
      var resultKey = mediaFile || (String(result.sourceLoRA || 'result') + ':' + index);
      var existing = Array.prototype.find.call(
        host.querySelectorAll('.test-generations-result-card:not(.is-pending)'),
        function (card) { return card.dataset.resultKey === resultKey; }
      );
      if (existing) {
        syncResultElapsed(existing, result, false);
        return;
      }

      var card = document.createElement('article');
      card.className = 'test-generations-result-card';
      card.dataset.resultKey = resultKey;

      if (sessionName && mediaFile) {
        appendTestPreview(card, sessionName, result);
      } else {
        var placeholder = document.createElement('div');
        placeholder.className = 'test-generations-preview-placeholder';
        placeholder.textContent = 'Preview unavailable';
        card.appendChild(placeholder);
      }

      var remove = buildResultRemoveButton(result);
      if (remove) card.appendChild(remove);
      card.appendChild(buildResultFooter(result, { sessionName: sessionName }));

      var pending = host.querySelector('.test-generations-result-card.is-pending');
      host.insertBefore(card, pending || null);
    });

    failures.forEach(function (failure, index) {
      var failureKey = 'failure:' + String(failure.sourceLoRA || 'result') + ':' + index;
      var diagnosticKey = String(status && status.session || '') + ':' + failureKey + ':' + String(failure.error || '');
      if (!reportedFailureKeys.has(diagnosticKey)) {
        reportedFailureKeys.add(diagnosticKey);
        reportConsoleError(
          'Test Generations',
          new Error(
            (String(failure.sourceLoRA || failure.candidateFile || 'Generation') + ': ') +
            String(failure.error || 'Generation failed.')
          )
        );
      }
      var existing = Array.prototype.find.call(
        host.querySelectorAll('.test-generations-result-card:not(.is-pending)'),
        function (card) { return card.dataset.resultKey === failureKey; }
      );
      if (existing) {
        syncResultElapsed(existing, failure, true);
        return;
      }

      var card = document.createElement('article');
      card.className = 'test-generations-result-card is-failed';
      card.dataset.resultKey = failureKey;

      var placeholder = document.createElement('div');
      placeholder.className = 'test-generations-preview-placeholder test-generations-failure-placeholder';
      placeholder.textContent = 'Generation failed';
      card.appendChild(placeholder);

      var remove = buildResultRemoveButton(failure);
      if (remove) card.appendChild(remove);
      card.appendChild(buildResultFooter(failure, { failed: true }));

      var pending = host.querySelector('.test-generations-result-card.is-pending');
      host.insertBefore(card, pending || null);
    });

    var pending = host.querySelector('.test-generations-result-card.is-pending');
    if (live && (results.length + failures.length) < total) {
      if (!pending) {
        pending = document.createElement('article');
        pending.className = 'test-generations-result-card is-pending';

        var pendingPlaceholder = document.createElement('div');
        pendingPlaceholder.className = 'test-generations-preview-placeholder';
        pendingPlaceholder.textContent = 'Generating…';
        pending.appendChild(pendingPlaceholder);

        var pendingFooter = document.createElement('div');
        pendingFooter.className = 'test-generations-result-footer';
        var pendingPrimary = document.createElement('div');
        pendingPrimary.className = 'test-generations-result-primary';
        var pendingLabel = document.createElement('div');
        pendingLabel.className = 'test-generations-result-name';
        pendingPrimary.appendChild(pendingLabel);
        var pendingTiming = document.createElement('span');
        pendingTiming.className = 'test-generations-result-elapsed';
        pendingPrimary.appendChild(pendingTiming);
        pendingFooter.appendChild(pendingPrimary);
        pending.appendChild(pendingFooter);

        host.appendChild(pending);
      }
      pending.querySelector('.test-generations-result-name').textContent = String(status.current || 'Next LoRA');
      pending.querySelector('.test-generations-preview-placeholder').textContent = status.status === 'stopping' ? 'Stopping…' : 'Generating…';
    } else if (pending) {
      pending.remove();
    }
    syncPendingElapsed(status);

    if (!results.length && !failures.length && !live && !host.querySelector('.test-generations-result-card')) {
      host.innerHTML = '<div class="test-generations-empty">Generated previews will appear here.</div>';
    }

    if (resultsView === 'compare') renderCompare(status || {});
  }

  function syncActiveRunControls(status) {
    var runBtn = el('test-generations-run-btn');
    if (runBtn) {
      var supported = isTestModelSupported();
      var selectedCount = selectedCandidateFiles().length;
      runBtn.disabled = !prepared || !prepared.count || !selectedCount || !supported;
      runBtn.title = !supported
        ? 'Test Generations is not available for the selected Base Model.'
        : !selectedCount
          ? 'Select at least one LoRA to run tests.'
          : 'Queue this frozen Test batch.';
    }
  }

  var TEST_PROMPT_COLOR_SWATCHES = {
    'black': '#111111',
    'white': '#f4f4f4',
    'gray': '#808080',
    'grey': '#808080',
    'silver': '#c0c0c0',
    'red': '#d13c3c',
    'dark red': '#8b0000',
    'burgundy': '#800020',
    'maroon': '#800000',
    'orange': '#e8892f',
    'yellow': '#e0c43b',
    'gold': '#d4af37',
    'green': '#3f8f5f',
    'dark green': '#1f5f3b',
    'forest green': '#228b22',
    'olive': '#808000',
    'olive green': '#6b7d2a',
    'lime': '#63b32e',
    'lime green': '#63b32e',
    'blue': '#3e73c7',
    'light blue': '#8ecae6',
    'sky blue': '#87ceeb',
    'dark blue': '#234f8a',
    'navy': '#000080',
    'navy blue': '#000080',
    'royal blue': '#4169e1',
    'teal': '#218a8a',
    'turquoise': '#40b8b3',
    'cyan': '#2ab7ca',
    'purple': '#7b4bb7',
    'violet': '#8f5cc7',
    'lavender': '#b8a1d9',
    'magenta': '#c33ca6',
    'pink': '#e979a6',
    'light pink': '#f1a7c3',
    'hot pink': '#e84a9b',
    'peach': '#f0b38f',
    'brown': '#8b5a3c',
    'tan': '#c49a6c',
    'beige': '#d8c7a5',
    'cream': '#eee1bd',
    'platinum blonde': '#e5dfc8',
    'strawberry blonde': '#c98262',
    'dirty blonde': '#b7a16b',
    'blonde': '#d8bd72',
    'blond': '#d8bd72',
    'auburn': '#8b4a2f',
    'brunette': '#5a3825',
    'skin-colored': '#c99a7a',
    'skin colored': '#c99a7a',
    'colorful': 'linear-gradient(90deg, #d13c3c, #e0c43b, #3f8f5f, #3e73c7, #7b4bb7)',
    'multicolored': 'linear-gradient(90deg, #d13c3c, #e0c43b, #3f8f5f, #3e73c7, #7b4bb7)',
    'multi-colored': 'linear-gradient(90deg, #d13c3c, #e0c43b, #3f8f5f, #3e73c7, #7b4bb7)'
  };
  var TEST_PROMPT_COLOR_TERMS = Object.keys(TEST_PROMPT_COLOR_SWATCHES).sort(function (a, b) {
    return b.length - a.length;
  });
  var TEST_PROMPT_COLOR_PATTERN = '\\b(?:' + TEST_PROMPT_COLOR_TERMS.map(function (value) {
    return value.replace(/\s+/g, '\\s+');
  }).join('|') + ')\\b';
  var TEST_PROMPT_HAIR_STYLES = [
    'shoulder-length', 'waist-length', 'chin-length', 'slicked back', 'tied back',
    'high ponytail', 'low ponytail', 'messy bun', 'pixie cut', 'ponytail',
    'pigtails', 'braided', 'braids', 'bangs', 'fringe', 'curly', 'straight',
    'wavy', 'long', 'short', 'bob', 'bun', 'loose'
  ];
  var TEST_PROMPT_ACCESSORIES = [
    'hoop earrings', 'bow tie', 'hair clip', 'sunglasses', 'eyeglasses', 'glasses',
    'earrings', 'necklace', 'choker', 'bracelet', 'wristwatch', 'headband', 'beanie',
    'handbag', 'backpack', 'gloves', 'scarf', 'belt', 'purse', 'brooch', 'rings',
    'ring', 'hat', 'cap'
  ];
  var TEST_PROMPT_SCENE_OBJECTS = [
    'curtains', 'curtain', 'blanket', 'bookshelf', 'bookshelves',
    'nightstand', 'countertop', 'television', 'paintings', 'painting', 'posters',
    'poster', 'pillows', 'pillow', 'cushions', 'cushion', 'windows', 'window',
    'doors', 'door', 'mirror', 'sofa', 'couch', 'chairs', 'chair', 'table',
    'desk', 'bed', 'lamps', 'lamp', 'rug', 'carpet', 'shelves', 'shelf',
    'plants', 'plant', 'dresser', 'wardrobe', 'stools', 'stool', 'tv'
  ];

  function promptColorMatches(text) {
    var matches = [];
    var pattern = new RegExp(TEST_PROMPT_COLOR_PATTERN, 'gi');
    var match;
    while ((match = pattern.exec(String(text || ''))) !== null) {
      matches.push({
        color: String(match[0] || '').toLowerCase(),
        index: match.index,
        end: match.index + match[0].length
      });
    }
    return matches;
  }

  function cleanPromptColorTarget(value, hasNextColor) {
    var target = String(value || '')
      .replace(/^[\s,:;()\[\]{}\u2013\u2014-]+/, '')
      .replace(/[\s,:;()\[\]{}\u2013\u2014-]+$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (hasNextColor) {
      target = target.replace(/\s+(?:with|and|or|plus|&)\s*$/i, '').trim();
      target = target.replace(/^(?:with|and|or|plus|&)$/i, '').trim();
    }
    target = target.replace(/^(?:a|an|the)\s+/i, '');
    target = target.replace(/\s+(?:who|that|which|while|where|when)\b.*$/i, '').trim();
    target = target.replace(/\s+(?:standing|sitting|walking|holding|wearing|creating)\b.*$/i, '').trim();
    var hasMatchingTarget = /\s+(?:and|with)\s+(?:(?:a|an|the)\s+)?matching\s+/i.test(target);
    if (!hasMatchingTarget) {
      target = target.replace(/\s+(?:with|in|on|at|near|beside|behind|under|over|against|inside|outside|by|from)\b.*$/i, '').trim();
      var words = target.split(/\s+/).filter(Boolean);
      if (words.length > 5) target = words.slice(0, 5).join(' ');
    }
    return target;
  }

  function expandMatchingPromptColorTargets(color, target, phrase) {
    var match = String(target || '').match(/^(.+?)\s+(?:and|with)\s+(?:(?:a|an|the)\s+)?matching\s+(.+)$/i);
    if (!match) return [{ color: color, target: target, phrase: phrase }];
    return [
      { color: color, target: cleanPromptColorTarget(match[1], false), phrase: phrase },
      { color: color, target: cleanPromptColorTarget(match[2], false), phrase: phrase }
    ];
  }

  function extractPromptColorTargets(prompt) {
    var targets = [];
    var seen = {};
    var clausePattern = /[^,;.!?\n:]+/g;
    var source = String(prompt || '');
    var clauseMatch;

    while ((clauseMatch = clausePattern.exec(source)) !== null) {
      var clause = String(clauseMatch[0] || '').trim();
      if (!clause) continue;
      var matches = promptColorMatches(clause);
      if (!matches.length) continue;

      var phrase = clause;
      var parsed = matches.map(function (match, index) {
        var next = matches[index + 1];
        return {
          color: match.color,
          target: cleanPromptColorTarget(
            clause.slice(match.end, next ? next.index : clause.length),
            !!next
          ),
          phrase: phrase,
          index: clauseMatch.index + match.index
        };
      });

      parsed.forEach(function (item, index) {
        if (item.target || index >= parsed.length - 1) return;
        var bridge = clause.slice(matches[index].end, matches[index + 1].index)
          .replace(/[\s\u2013\u2014/&-]+/g, ' ')
          .trim()
          .toLowerCase();
        if (bridge === 'and' || bridge === 'or') item.target = parsed[index + 1].target;
      });

      parsed.forEach(function (item) {
        if (!item.target) return;
        expandMatchingPromptColorTargets(item.color, item.target, item.phrase).forEach(function (expanded) {
          if (!expanded.target) return;
          var key = expanded.color + '|' + expanded.target.toLowerCase();
          if (seen[key]) return;
          seen[key] = true;
          expanded.index = item.index;
          expanded.swatch = TEST_PROMPT_COLOR_SWATCHES[expanded.color] || '#808080';
          targets.push(expanded);
        });
      });
    }

    return targets;
  }

  function promptClauseAt(source, index) {
    var text = String(source || '');
    var start = index;
    var end = index;
    while (start > 0 && !/[,.!?;\n:]/.test(text.charAt(start - 1))) start -= 1;
    while (end < text.length && !/[,.!?;\n:]/.test(text.charAt(end))) end += 1;
    return text.slice(start, end).trim();
  }

  function promptTermMatches(source, term) {
    var pattern = String(term || '').replace(/\s+/g, '\\s+');
    var regex = new RegExp('\\b' + pattern + '\\b', 'gi');
    var matches = [];
    var match;
    while ((match = regex.exec(String(source || ''))) !== null) {
      matches.push({ index: match.index, end: match.index + match[0].length, text: match[0] });
    }
    return matches;
  }

  function extractNamedPromptItems(prompt, terms, type) {
    var source = String(prompt || '');
    var items = [];
    var occupied = [];
    terms.slice().sort(function (a, b) { return b.length - a.length; }).forEach(function (term) {
      promptTermMatches(source, term).forEach(function (match) {
        var overlaps = occupied.some(function (range) {
          return match.index < range.end && match.end > range.start;
        });
        if (overlaps) return;
        occupied.push({ start: match.index, end: match.end });
        items.push({
          type: type,
          target: String(match.text || '').toLowerCase(),
          color: '',
          detail: '',
          phrase: promptClauseAt(source, match.index),
          index: match.index
        });
      });
    });
    return items.sort(function (a, b) { return a.index - b.index; });
  }

  function extractHairPromptItems(prompt) {
    var source = String(prompt || '');
    var items = [];
    promptTermMatches(source, 'hair').forEach(function (match) {
      var clause = promptClauseAt(source, match.index);
      var hairOffset = clause.toLowerCase().indexOf('hair');
      var before = hairOffset >= 0 ? clause.slice(0, hairOffset) : '';
      var after = hairOffset >= 0 ? clause.slice(hairOffset + 4) : '';
      var attributeTerms = TEST_PROMPT_COLOR_TERMS.concat(TEST_PROMPT_HAIR_STYLES).sort(function (a, b) {
        return b.length - a.length;
      });
      var directTerms = [];

      attributeTerms.forEach(function (term) {
        promptTermMatches(before, term).forEach(function (termMatch) {
          var tail = before.slice(termMatch.index);
          attributeTerms.forEach(function (candidate) {
            var candidatePattern = String(candidate).replace(/\s+/g, '\\s+');
            tail = tail.replace(new RegExp('\\b' + candidatePattern + '\\b', 'gi'), ' ');
          });
          if (!tail.replace(/[\s\u2013\u2014-]+/g, '')) {
            directTerms.push({ term: term.toLowerCase(), index: termMatch.index });
          }
        });
      });

      directTerms.sort(function (a, b) { return a.index - b.index; });
      var directColors = directTerms.filter(function (item) {
        return Object.prototype.hasOwnProperty.call(TEST_PROMPT_COLOR_SWATCHES, item.term);
      });
      var directStyles = directTerms.filter(function (item) {
        return TEST_PROMPT_HAIR_STYLES.indexOf(item.term) >= 0;
      }).map(function (item) { return item.term; });

      var afterStyle = String(after || '').match(/^\s*(tied back|slicked back)\b/i);
      if (!afterStyle) {
        afterStyle = String(after || '').match(/^\s*(?:(?:is\s+)?(?:worn|styled|pulled|tied)\s+)?(?:(?:in|into)\s+(?:a\s+)?)?(high ponytail|low ponytail|messy bun|ponytail|pigtails|pixie cut|bun|braids|braided)\b/i);
      }
      if (afterStyle && directStyles.indexOf(afterStyle[1].toLowerCase()) < 0) {
        directStyles.push(afterStyle[1].toLowerCase());
      }

      items.push({
        type: 'Hair',
        target: 'hair',
        color: directColors.length ? directColors[directColors.length - 1].term : '',
        detail: directStyles.join(' '),
        phrase: clause,
        index: match.index
      });
    });
    return items;
  }

  function normalizedPromptTarget(value) {
    return String(value || '').toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function promptTargetsMatch(first, second) {
    return normalizedPromptTarget(first) === normalizedPromptTarget(second);
  }

  function classifyColorTarget(target) {
    var normalized = normalizedPromptTarget(target);
    if (normalized === 'hair' || normalized.indexOf('hair ') === 0) return 'Hair';
    if (TEST_PROMPT_ACCESSORIES.some(function (term) { return promptTargetsMatch(normalized, term); })) return 'Accessory';
    if (TEST_PROMPT_SCENE_OBJECTS.some(function (term) { return promptTargetsMatch(normalized, term); })) return 'Scene';
    return 'Colour';
  }

  function extractPromptExpectations(prompt) {
    var source = String(prompt || '');
    var items = []
      .concat(extractHairPromptItems(source))
      .concat(extractNamedPromptItems(source, TEST_PROMPT_ACCESSORIES, 'Accessory'))
      .concat(extractNamedPromptItems(source, TEST_PROMPT_SCENE_OBJECTS, 'Scene'));

    extractPromptColorTargets(source).forEach(function (colorItem) {
      var type = classifyColorTarget(colorItem.target);
      var existing = items.find(function (item) {
        if (item.type !== type) return false;
        return promptTargetsMatch(item.target, colorItem.target);
      });
      if (existing) {
        var colors = String(existing.color || '').split(' + ').filter(Boolean);
        if (colors.indexOf(colorItem.color) < 0) colors.push(colorItem.color);
        existing.color = colors.join(' + ');
        if (colors.length === 1) {
          existing.swatch = colorItem.swatch;
        } else {
          var swatches = colors.map(function (color) {
            var value = TEST_PROMPT_COLOR_SWATCHES[color] || '#808080';
            return value.indexOf('gradient(') >= 0 ? '#808080' : value;
          });
          existing.swatch = 'linear-gradient(90deg, ' + swatches.join(', ') + ')';
        }
        if (!existing.phrase) existing.phrase = colorItem.phrase;
        return;
      }
      items.push({
        type: type,
        target: colorItem.target,
        color: colorItem.color,
        swatch: colorItem.swatch,
        detail: '',
        phrase: colorItem.phrase,
        index: colorItem.index
      });
    });

    var seen = {};
    return items
      .filter(function (item) {
        var key = item.type + '|' + normalizedPromptTarget(item.target) + '|' + String(item.color || '') + '|' + String(item.detail || '');
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      })
      .sort(function (a, b) { return a.index - b.index; });
  }

  function escapePromptExpectationTitle(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderPromptExpectations(prompt) {
    var items = extractPromptExpectations(prompt);
    if (!items.length) {
      return '<div class="test-generations-prompt-expectations">' +
        '<strong>Prompt expectations</strong>' +
        '<div class="test-generations-expectation-empty">No direct prompt attributes found.</div>' +
        '</div>';
    }
    return '<div class="test-generations-prompt-expectations">' +
      '<strong>Prompt expectations</strong>' +
      '<div class="test-generations-expectation-table">' +
      '<div class="test-generations-expectation-head"><span>Type</span><span>Target</span><span>Colour</span><span>Detail</span></div>' +
      items.map(function (item) {
        var swatch = item.color
          ? '<i class="test-generations-color-swatch" style="--test-color-swatch:' +
            (item.swatch || TEST_PROMPT_COLOR_SWATCHES[item.color] || '#808080') + '"></i>'
          : '';
        return '<div class="test-generations-expectation-row" title="' + escapePromptExpectationTitle(item.phrase) + '">' +
          '<span class="test-generations-expectation-type">' + escapeHtml(item.type) + '</span>' +
          '<span class="test-generations-expectation-target">' + escapeHtml(item.target) + '</span>' +
          '<span class="test-generations-expectation-color">' + swatch + escapeHtml(item.color || '—') + '</span>' +
          '<span class="test-generations-expectation-detail">' + escapeHtml(item.detail || '—') + '</span>' +
          '</div>';
      }).join('') +
      '</div>' +
      '<small>Only direct prompt correlations are shown. Hover a row for its full phrase.</small>' +
      '</div>';
  }


  function sessionMetaText(status) {
    if (!status || !status.session) return '';
    var parts = [];
    var modelId = String(status.modelId || status.model || '');
    var model = supportedTestModels[modelId] || {};
    var settings = status.settings && typeof status.settings === 'object' ? status.settings : status;
    if (String(status.name || '').trim()) parts.push(String(status.name).trim());
    parts.push(sessionLabel(status.session));
    if (String(model.label || '').trim()) parts.push(String(model.label).trim());
    if (settings.aspectRatio) parts.push(String(settings.aspectRatio));
    if (settings.megapixels !== undefined && settings.megapixels !== null && settings.megapixels !== '') parts.push(String(settings.megapixels) + ' MP');
    if (settings.duration !== undefined && settings.duration !== null && settings.duration !== '') parts.push(String(settings.duration) + 's');
    if (settings.dimensions) parts.push(String(settings.dimensions).trim());
    if (settings.seed !== undefined && settings.seed !== null && settings.seed !== '') parts.push('Seed ' + String(settings.seed));
    return parts.join(' · ');
  }

  function renderSessionMeta(status) {
    var summary = el('test-generations-session-meta');
    var infoBtn = el('test-generations-session-info-btn');
    var details = el('test-generations-session-details');
    var hasSession = !!(status && status.session);
    if (summary) {
      summary.textContent = hasSession ? sessionMetaText(status) : '';
      summary.classList.toggle('hidden', !hasSession);
    }
    if (infoBtn) infoBtn.classList.toggle('hidden', !hasSession);
    if (!details) return;
    if (!hasSession) {
      details.classList.add('hidden');
      details.innerHTML = '';
      if (infoBtn) {
        infoBtn.textContent = 'Details';
        infoBtn.setAttribute('aria-expanded', 'false');
        infoBtn.title = 'View frozen session settings and resolved prompt';
        infoBtn.setAttribute('aria-label', infoBtn.title);
      }
      return;
    }
    if (infoBtn) {
      var expanded = !details.classList.contains('hidden');
      infoBtn.textContent = expanded ? '×' : 'Details';
      infoBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      infoBtn.title = expanded ? 'Close session details' : 'View frozen session settings and resolved prompt';
      infoBtn.setAttribute('aria-label', infoBtn.title);
    }
    var resolvedPrompt = String(status.resolvedPrompt || status.prompt || '');
    var sourcePrompt = String(status.sourcePrompt || '');
    details.innerHTML = [
      '<div class="test-generations-session-info-grid">',
      renderPromptExpectations(resolvedPrompt),
      '<div class="test-generations-session-prompts">',
      '<div class="test-generations-session-prompt"><strong>Resolved prompt</strong><pre>' + escapeHtml(resolvedPrompt || '—') + '</pre></div>',
      '<div class="test-generations-session-prompt"><strong>Source prompt</strong><pre>' + escapeHtml(sourcePrompt || '—') + '</pre></div>',
      '</div>',
      '</div>'
    ].join('');
  }

  function selectSessionStatus(status) {
    status = status || {};
    currentSession = String(status.session || '');
    currentSessionFolder = currentSession ? String(launchFolder || '') : '';
    currentSessionModel = currentSession
      ? String(status.modelId || status.model || currentTestModelId() || '')
      : '';

    renderStatus(status);
  }

  function renderStatus(status) {
    currentStatus = status || {};
    syncActiveRunControls(status || {});
    syncSessionSelection();
    var statusEl = el('test-generations-status');
    var errorEl = el('test-generations-error');
    var live = status && (status.status === 'running' || status.status === 'stopping');
    if (statusEl) statusEl.textContent = live ? '' : statusText(status);
    if (errorEl) {
      errorEl.textContent = showSessionError && status && status.error ? String(status.error) : '';
      errorEl.classList.toggle('hidden', !errorEl.textContent);
    }
    renderSessionMeta(status || {});
    syncVisibleSessionProgress(status || {});
    renderResults(status || {});
  }

  function pollStatus() {
    if (pollTimer) clearTimeout(pollTimer);
    if (!isOpen()) return;
    request('test_status', { modelId: currentTestModelId() }).then(function (status) {
      syncActiveRunControls(status);
      refreshActivityButtonIfDue(15000);
      if (status && (status.status === 'running' || status.status === 'stopping')) showSessionError = true;
      var activeSession = String(status && status.session || '');
      var selectedPreviewLive = !!(
        currentSession &&
        currentSession !== activeSession &&
        currentStatus &&
        String(currentStatus.session || '') === currentSession &&
        (currentStatus.status === 'running' || currentStatus.status === 'stopping')
      );
      var previewRefresh = Promise.resolve();

      if (currentSession === activeSession) {
        renderStatus(status);
      } else if (selectedPreviewLive) {
        previewRefresh = request('test_open_session', { session: currentSession }).then(function (selectedStatus) {
          renderStatus(selectedStatus);
        });
      }

      return previewRefresh.then(function () {
        if (status && (status.status === 'running' || status.status === 'stopping')) {
          if (queuedTestJobs.length) refreshSessionsIfDue(10000).catch(showError);
          pollTimer = setTimeout(pollStatus, 4000);
          return null;
        }
        return refreshSessions().then(function () {
          if (queuedTestJobs.length && isOpen()) pollTimer = setTimeout(pollStatus, 8000);
        });
      });
    }).catch(showError);
  }

  function showError(err) {
    reportConsoleError('Test Generations', err);
    var errorEl = el('test-generations-error');
    if (errorEl) {
      errorEl.textContent = String(err && err.message ? err.message : err);
      errorEl.classList.remove('hidden');
    }
  }

  function revealTestSession(sessionName) {
    var name = String(sessionName || '').trim();
    if (!name) return Promise.resolve();
    return fetch('/fs/storage/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'tests', id: name, folder: '' })
    }).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.ok === false) {
          throw new Error(payload && payload.error ? payload.error : 'Could not open Test session folder.');
        }
        return payload;
      });
    });
  }

  function openResultsFolder(folder) {
    var targetFolder = String(folder || '').replace(/^[/\\]+|[/\\]+$/g, '');
    if (!targetFolder || !state || !state.dirStack || !state.dirStack.length) return;
    if (typeof clearFocusSet === 'function' && state.focusSet && state.focusSet.keys && state.focusSet.keys.length) {
      clearFocusSet();
    }
    closePane();
    setWorkspaceSurface('default');
    state.dirStack = [state.dirStack[0]].concat(targetFolder.split('/').filter(Boolean).map(function (name) {
      return { name: name };
    }));
    state.folder = targetFolder;
    state.currentItem = null;
    clearEditorAndPreview();
    clearCaptionFilterInputs();
    refreshCurrentDirectory();
  }

  function closePane() {
    var node = pane();
    var frame = el('app-frame');
    if (node) node.classList.add('hidden');
    if (frame) frame.classList.remove('workspace-test-open');
    launchFolder = '';
    if (pendingElapsedTimer) clearTimeout(pendingElapsedTimer);
    pendingElapsedTimer = null;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    refreshActivityButton();
    if (typeof window.syncApplicationShellContext === 'function') window.syncApplicationShellContext();
    if (typeof window.syncShellLocationRoute === 'function') window.syncShellLocationRoute();
  }

  function populateControls(payload) {
    var defaults = payload.defaults || {};
    var settings = Array.isArray(payload.settings) ? payload.settings : [];
    var saved = savedTestModelState();
    var savedSettings = saved.settings || {};
    var aspect = el('test-generations-aspect');
    var megapixels = el('test-generations-megapixels');
    var duration = el('test-generations-duration');
    var dimensions = el('test-generations-dimensions');
    var seed = el('test-generations-seed');
    var prompt = el('test-generations-prompt');

    [
      ['aspectRatio', 'test-generations-aspect-field'],
      ['megapixels', 'test-generations-megapixels-field'],
      ['duration', 'test-generations-duration-field'],
      ['dimensions', 'test-generations-dimensions-field'],
      ['seed', 'test-generations-seed-field']
    ].forEach(function (entry) {
      var field = el(entry[1]);
      if (field) field.classList.toggle('hidden', settings.indexOf(entry[0]) === -1);
    });

    var selectedAspect = String(savedSettings.aspectRatio || defaults.aspectRatio || '');
    var options = Array.isArray(payload.aspectRatioOptions) ? payload.aspectRatioOptions.slice() : [];
    if (selectedAspect && options.indexOf(selectedAspect) < 0) options.unshift(selectedAspect);
    if (aspect) {
      aspect.innerHTML = options.map(function (value) {
        return '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + '</option>';
      }).join('');
      aspect.value = selectedAspect;
    }
    if (megapixels) megapixels.value = String(savedSettings.megapixels || defaults.megapixels || '');
    if (duration) duration.value = String(savedSettings.duration || defaults.duration || '');
    if (dimensions) {
      var dimensionOptions = payload.settingOptions && Array.isArray(payload.settingOptions.dimensions)
        ? payload.settingOptions.dimensions.slice()
        : [];
      var selectedDimensions = String(savedSettings.dimensions || defaults.dimensions || '');
      if (selectedDimensions && dimensionOptions.indexOf(selectedDimensions) < 0) dimensionOptions.unshift(selectedDimensions);
      dimensions.innerHTML = dimensionOptions.map(function (value) {
        return '<option value="' + escapeHtml(value) + '">' + escapeHtml(String(value).trim()) + '</option>';
      }).join('');
      dimensions.value = selectedDimensions;
    }
    if (seed) seed.value = String(defaults.seed || '');
    if (prompt) {
      prompt.value = payload.workspacePromptPresent === true
        ? String(payload.workspacePrompt || '')
        : String(payload.defaultPrompt || '');
    }
  }

  function openPane() {
    if (typeof window.closeGenerateActivity === 'function') window.closeGenerateActivity();
    var node = pane();
    var frame = el('app-frame');
    var summary = el('test-generations-summary');
    var list = el('test-generations-files');
    var errorEl = el('test-generations-error');
    if (!node || !frame) throw new Error('Test Generations requires the app frame and Test workspace.');
    launchFolder = owningSetFolder((state && state.folder) || '');
    if (!launchFolder) throw new Error('Test Generations requires a current Set.');
    var requestedModelId = currentTestModelId();
    var rememberedSession = (
      currentSession &&
      currentSessionFolder === launchFolder &&
      currentSessionModel === requestedModelId
    ) ? currentSession : '';
    if (!rememberedSession) {
      currentSession = '';
      currentSessionFolder = '';
      currentSessionModel = '';
    }
    frame.classList.add('workspace-test-open');
    node.classList.remove('hidden');
    if (typeof window.syncApplicationShellContext === 'function') window.syncApplicationShellContext();
    if (typeof window.syncShellLocationRoute === 'function') window.syncShellLocationRoute();
    if (summary) summary.textContent = 'Loading Test folder...';
    if (list) list.textContent = '';
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.classList.add('hidden');
    }
    prepared = null;
    selectedCandidates = null;
    candidateStrengths = null;
    currentStatus = {};
    showSessionError = false;
    compareIndex = 0;
    wildcardDirector.analysis = null;
    renderWildcardAnalysis(null);
    el('test-generations-wildcard-status').textContent = '';
    setResultsView('grid');
    renderStatus({ status: 'idle' });
    refreshActivityButton();
    if (!isTestModelSupported()) {
      if (summary) summary.textContent = 'Testing unavailable for selected Base Model.';
      if (errorEl) {
        errorEl.textContent = 'Test Generations is not available for the selected Base Model.';
        errorEl.classList.remove('hidden');
      }
      syncActiveRunControls({ status: 'idle' });
      return;
    }
    refreshWildcardDirector().catch(function (err) {
      wildcardDirector.available = false;
      wildcardDirector.models = [];
      renderWildcardDirector();
      el('test-generations-wildcard-status').textContent = 'Director unavailable.';
      reportConsoleError('Test Generations', err);
    });
    request('test_prepare', { modelId: currentTestModelId() }).then(function (payload) {
      prepared = payload;
      syncCandidatesButton(payload);
      if (Array.isArray(payload.warnings)) {
        payload.warnings.forEach(function (warning) {
          if (String(warning || '').trim()) reportConsoleWarning('Test Generations', warning);
        });
      }
      renderStagedFiles(payload);
      renderSessions(payload.sessions, []);
      populateControls(payload);
      var initialStatus = payload.latest || { status: 'idle' };
      if (initialStatus.status === 'running' || initialStatus.status === 'stopping') showSessionError = true;
      syncActiveRunControls(initialStatus);
      var requestedSession = String(pendingActivitySession || rememberedSession || '');
      pendingActivitySession = '';
      var previewReady = requestedSession
        ? request('test_open_session', { session: requestedSession }).then(function (selectedStatus) {
            selectSessionStatus(selectedStatus);
          }).catch(function (err) {
            reportConsoleWarning(
              'Test Generations',
              'Could not open selected Test session ' + requestedSession + ': ' +
              String(err && err.message ? err.message : err)
            );
            currentSession = '';
            currentSessionFolder = '';
            currentSessionModel = '';
                  if (initialStatus && initialStatus.session) selectSessionStatus(initialStatus);
            else renderStatus(initialStatus);
          })
        : Promise.resolve(
            initialStatus && initialStatus.session
              ? selectSessionStatus(initialStatus)
              : renderStatus(initialStatus)
          );
      previewReady.then(function () {
        return refreshSessions();
      }).then(function () {
        if ((payload.latest && (payload.latest.status === 'running' || payload.latest.status === 'stopping')) || queuedTestJobs.length) pollStatus();
      }).catch(showError);
    }).catch(function (err) {
      if (summary) summary.textContent = 'Test Generations is unavailable.';
      showError(err);
    });
  }

  function startRun() {
    if (!isTestModelSupported()) {
      return showError(new Error('Test Generations is not available for the selected Base Model.'));
    }
    var name = String(el('test-generations-session-name') && el('test-generations-session-name').value || '').trim();
    var prompt = String(el('test-generations-prompt') && el('test-generations-prompt').value || '').trim();
    var selectedFiles = selectedCandidateFiles();
    var baseInclude = el('test-generations-base-include');
    var includeBase = !baseInclude || baseInclude.checked;
    var declaredSettings = prepared && Array.isArray(prepared.settings) ? prepared.settings : [];
    var settings = {};
    if (declaredSettings.indexOf('aspectRatio') !== -1) settings.aspectRatio = String(el('test-generations-aspect').value || '').trim();
    if (declaredSettings.indexOf('megapixels') !== -1) settings.megapixels = String(el('test-generations-megapixels').value || '').trim();
    if (declaredSettings.indexOf('duration') !== -1) settings.duration = String(el('test-generations-duration').value || '').trim();
    if (declaredSettings.indexOf('dimensions') !== -1) settings.dimensions = String(el('test-generations-dimensions').value || '');
    if (declaredSettings.indexOf('seed') !== -1) settings.seed = String(el('test-generations-seed').value || '').trim();
    if (!selectedFiles.length) return showError(new Error('Select at least one staged LoRA to test.'));
    if (!prompt) return showError(new Error('A test prompt is required.'));
    if (declaredSettings.indexOf('aspectRatio') !== -1 && !settings.aspectRatio) return showError(new Error('An aspect ratio is required.'));
    if (declaredSettings.indexOf('dimensions') !== -1 && !settings.dimensions.trim()) return showError(new Error('Dimensions are required.'));
    var selectedStrengths = {};
    for (var strengthIndex = 0; strengthIndex < selectedFiles.length; strengthIndex += 1) {
      var strengthFile = selectedFiles[strengthIndex];
      var strengthValue = Number(candidateStrengths && candidateStrengths[strengthFile]);
      if (!isFinite(strengthValue) || strengthValue < -2 || strengthValue > 2) {
        return showError(new Error('Strength must be between -2 and 2.'));
      }
      selectedStrengths[strengthFile] = strengthValue;
    }
    saveTestWorkspacePrompt(prompt);
    saveTestBenchState();
    var runBtn = el('test-generations-run-btn');
    var errorEl = el('test-generations-error');
    if (runBtn) runBtn.disabled = true;
    if (errorEl) errorEl.classList.add('hidden');
    request('test_enqueue', {
      name: name,
      selectedFiles: selectedFiles,
      modelId: currentTestModelId(),
      includeBase: includeBase,
      candidateStrengths: selectedStrengths,
      prompt: prompt,
      settings: settings
    }).then(function (payload) {
      var startedStatus = payload && payload.latest ? payload.latest : null;
      var status = startedStatus || currentStatus;
      syncActiveRunControls(status);
      refreshActivityButton();
      if (startedStatus && startedStatus.session) {
        showSessionError = true;
        if (currentSession === String(startedStatus.session || '')) renderStatus(startedStatus);
      }
      var nextSeed = el('test-generations-seed');
      if (nextSeed) nextSeed.value = String(randomSeed());
      var nameInput = el('test-generations-session-name');
      if (nameInput) nameInput.value = '';
      return refreshSessions();
    }).then(function () {
      pollStatus();
    }).catch(function (err) {
      syncActiveRunControls(currentStatus);
      showError(err);
    });
  }

  function stopRun(stopBtn) {
    if (stopBtn) stopBtn.disabled = true;
    request('test_stop', { session: String(stopBtn && stopBtn.dataset.sessionStop || '') }).then(function (status) {
      syncActiveRunControls(status);
      refreshActivityButton();
      if (currentSession === String(status && status.session || '')) renderStatus(status);
      pollStatus();
    }).catch(function (err) {
      if (stopBtn) stopBtn.disabled = false;
      showError(err);
    });
  }

  function openSession(sessionName) {
    request('test_open_session', { session: String(sessionName || '') }).then(function (status) {
      showSessionError = true;
      selectSessionStatus(status);
    }).catch(showError);
  }

  function removeDeletedSessionRow(sessionName) {
    var host = el('test-generations-sessions-list');
    if (!host) return;
    var key = 'session:' + String(sessionName || '');
    var row = null;
    Array.prototype.some.call(host.querySelectorAll('[data-session-row-key]'), function (candidate) {
      if (String(candidate.dataset.sessionRowKey || '') !== key) return false;
      row = candidate;
      return true;
    });
    if (!row) return;
    var group = row.closest('[data-session-group]');
    row.remove();

    if (group) {
      var body = group.querySelector('[data-session-group-list]');
      if (body && !body.children.length) group.remove();
    }

    var countEl = el('test-generations-sessions-count');
    if (countEl) {
      countEl.textContent = String(Math.max(0, Number(countEl.textContent || 0) - 1));
    }

    if (!host.querySelector('[data-session-row-key]') && !host.querySelector('.test-generations-library-empty')) {
      var empty = document.createElement('div');
      empty.className = 'test-generations-library-empty';
      empty.textContent = 'No test sessions yet.';
      host.appendChild(empty);
    }
  }

  function deleteSession(sessionName) {
    return request('test_delete_session', { session: String(sessionName || '') }).then(function (payload) {
      forgetTrackedTestSessions(launchFolder, String(payload && payload.deleted || ''));
      removeDeletedSessionRow(payload && payload.deleted);
      if (currentSession === String(payload.deleted || '')) {
        currentSession = '';
        currentSessionFolder = '';
        currentSessionModel = '';
        showSessionError = false;
        if (payload.latest && payload.latest.session) selectSessionStatus(payload.latest);
        else renderStatus({ status: 'idle' });
      }
    });
  }

  function removeCandidate(fileName, sessionName) {
    return request('test_remove_candidate', {
      fileName: String(fileName || ''),
      session: String(sessionName || ''),
      modelId: currentTestModelId()
    }).then(function (payload) {
      if (prepared && String(payload.modelId || '') === String(prepared.modelId || '')) {
        prepared.count = Number(payload.count || 0);
        prepared.files = Array.isArray(payload.files) ? payload.files.slice() : [];
        renderStagedFiles(prepared);
      }
      if (payload.sessionStatus && currentSession === String(payload.sessionStatus.session || '')) {
        renderStatus(payload.sessionStatus);
        syncVisibleSessionProgress(payload.sessionStatus);
      }
    });
  }


  function removeCurrentSessionCandidate(button) {
    var candidateFile = String(button && button.dataset.removeCandidate || '').trim();
    if (!candidateFile) return;
    var confirmed = window.confirm(
      'Remove ' + candidateFile + '?\n\n' +
      'This deletes the staged LoRA and its result from the current session. Other sessions are unchanged.'
    );
    if (!confirmed) return;
    button.disabled = true;
    removeCandidate(candidateFile, currentSession).catch(function (err) {
      button.disabled = false;
      showError(err);
    });
  }


  function bindUi() {
    var button = el('test-generations-open-btn');
    var workspace = el('test-generations-workspace');
    var node = el('test-generations-pane');
    if (!button || !workspace || !node) throw new Error('Test Generations requires its Training handoff and Test workspace markup.');

    button.onclick = openPane;
    var activityButton = el('activity-test-btn');
    if (activityButton) activityButton.oncontextmenu = openTestBenchActivityMenu;
    el('test-generations-run-btn').onclick = startRun;
    el('test-generations-wildcard-btn').onclick = function () {
      generateWildcardFromSet().catch(showError);
    };
    el('test-generations-wildcard-refresh').onclick = function () {
      var button = this;
      button.disabled = true;
      refreshWildcardDirector().catch(function (err) {
        wildcardDirector.available = false;
        wildcardDirector.models = [];
        renderWildcardDirector();
        el('test-generations-wildcard-status').textContent = 'Director unavailable.';
        reportConsoleError('Test Generations', err);
      }).then(function () {
        button.disabled = wildcardDirector.busy;
      });
    };
    el('test-generations-wildcard-model').addEventListener('change', function () {
      wildcardDirector.modelId = this.value;
      setDirectorModelPreference('webcap.testGenerations.directorModel', this.value);
    });
    window.addEventListener('webcap:director-model-changed', function (event) {
      var selected = String(event && event.detail && event.detail.modelId || '');
      if (!selected || selected === wildcardDirector.modelId) return;
      wildcardDirector.modelId = selected;
      var modelSelect = el('test-generations-wildcard-model');
      if (modelSelect && Array.prototype.some.call(modelSelect.options, function (option) { return option.value === selected; })) modelSelect.value = selected;
    });
    el('test-generations-director-stop').onclick = stopWildcardDirectorJob;
    el('test-generations-director-prompt-copy').onclick = function () {
      var button = this;
      var requestDiagnostic = wildcardDirector.requestDiagnostic;
      copyWildcardDirectorRequestDiagnostic(requestDiagnostic).then(function () {
        var original = wildcardDirectorRequestDiagnosticLabel(requestDiagnostic);
        button.textContent = 'Copied';
        window.setTimeout(function () {
          if (wildcardDirector.requestDiagnostic === requestDiagnostic) button.textContent = original;
        }, 1200);
      }).catch(showError);
    };
    el('test-generations-wildcard-use-btn').onclick = function () {
      try { useGeneratedWildcard(); } catch (err) { showError(err); }
    };
    el('test-generations-wildcard-output').addEventListener('input', function () {
      el('test-generations-wildcard-use-btn').disabled = !this.value.trim();
    });
    el('test-generations-rail-toggle-btn').onclick = toggleTestRailCollapsed;
    el('test-generations-clear-queue-btn').onclick = function () { var button = this; button.disabled = true; clearQueuedTests().catch(showError).then(function () { button.disabled = false; }); };
    el('test-generations-clear-sessions-btn').onclick = function () {
      var button = this;
      button.disabled = true;
      clearTestSessions().catch(showError).then(function () { button.disabled = false; });
    };
    el('test-generations-view-grid-btn').onclick = function () {
      setResultsView('grid');
    };
    el('test-generations-view-compare-btn').onclick = function () {
      setResultsView('compare');
    };
    el('test-generations-candidates-btn').onclick = function (event) {
      event.stopPropagation();
      try { openCandidateRunMenu(this); } catch (err) { showError(err); }
    };
    el('test-generations-recent-prompts-btn').onclick = function (event) {
      event.stopPropagation();
      try { openRecentPromptsMenu(this); } catch (err) { showError(err); }
    };
    el('test-generations-files').addEventListener('change', function (event) {
      var strengthInput = event.target.closest('[data-candidate-strength]');
      if (strengthInput) {
        var strengthFile = String(strengthInput.dataset.candidateStrength || '');
        var strengthValue = Number(strengthInput.value);
        if (!isFinite(strengthValue) || strengthValue < -2 || strengthValue > 2) {
          showError(new Error('Strength must be between -2 and 2.'));
          renderStagedFiles(prepared || { files: [], count: 0, candidateScores: {} });
          return;
        }
        candidateStrengths[strengthFile] = strengthValue;
        saveTestBenchState();
        return;
      }
      var checkbox = event.target.closest('[data-candidate-select]');
      if (!checkbox) return;
      var fileName = String(checkbox.dataset.candidateSelect || '');
      if (checkbox.checked) selectedCandidates.add(fileName);
      else selectedCandidates.delete(fileName);
      syncCandidateMasterSelect(prepared && Array.isArray(prepared.files) ? prepared.files : []);
      saveTestBenchState();
      syncActiveRunControls(currentStatus);
    });
    el('test-generations-master-select').addEventListener('change', function () {
      var files = prepared && Array.isArray(prepared.files) ? prepared.files : [];
      var allSelected = !!files.length && files.every(function (fileName) {
        return selectedCandidates instanceof Set && selectedCandidates.has(String(fileName || ''));
      });
      selectedCandidates = allSelected ? new Set() : new Set(files);
      renderStagedFiles(prepared || { files: [], count: 0, candidateScores: {} });
      saveTestBenchState();
      syncActiveRunControls(currentStatus);
    });
    el('test-generations-files').onclick = function (event) {
      var archiveButton = event.target.closest('[data-archive-candidate]');
      if (archiveButton) {
        var archiveFileName = String(archiveButton.dataset.archiveCandidate || '');
        var archiveMetadata = prepared && prepared.candidateMetadata && prepared.candidateMetadata[archiveFileName];
        if (!archiveMetadata || !archiveMetadata.selected || !archiveMetadata.folder || !archiveMetadata.stage) {
          throw new Error('Selected Test candidate has no archiveable training-run provenance.');
        }
        openTrainingArchiveModal({
          folder: archiveMetadata.folder,
          stage: archiveMetadata.stage,
          stagedFileName: archiveFileName
        });
        return;
      }
      var saveButton = event.target.closest('[data-save-candidate]');
      if (saveButton) {
        if (saveButton.disabled) return;
        var fileName = String(saveButton.dataset.saveCandidate || '');
        var metadata = prepared && prepared.candidateMetadata && prepared.candidateMetadata[fileName];
        if (!metadata) throw new Error('Test candidate has no training-run provenance.');
        if (typeof window.openEpochSaveModal !== 'function') throw new Error('Epoch Save modal is unavailable.');
        window.openEpochSaveModal({
          epoch: metadata.epoch,
          stage: metadata.stage,
          folder: metadata.folder,
          jobId: metadata.jobId,
          fileName: metadata.sourceFileName || fileName,
          stagedFileName: fileName,
          onSaved: function () {
            refreshStagedFilesAfterCandidates().catch(showError);
          }
        });
        return;
      }
      var button = event.target.closest('[data-file-name]');
      if (!button) return;
      button.disabled = true;
      removeCandidate(button.dataset.fileName, '').catch(function (err) {
        button.disabled = false;
        showError(err);
      });
    };
    el('test-generations-sessions-list').onclick = function (event) {
      var queueCancel = event.target.closest('[data-queue-cancel]');
      if (queueCancel) {
        queueCancel.disabled = true;
        cancelQueuedTest(queueCancel.dataset.queueCancel).catch(function (err) {
          queueCancel.disabled = false;
          showError(err);
        });
        return;
      }
      var sessionStop = event.target.closest('[data-session-stop]');
      if (sessionStop) {
        stopRun(sessionStop);
        return;
      }
      var folderOpen = event.target.closest('[data-session-folder-open], [data-session-reveal]');
      if (folderOpen) {
        if (folderOpen.dataset.sessionFolderOpen) {
          openResultsFolder(folderOpen.dataset.sessionFolderOpen);
        } else {
          revealTestSession(folderOpen.dataset.sessionReveal).catch(showError);
        }
        return;
      }
      var remove = event.target.closest('[data-session-delete]');
      if (remove) {
        remove.disabled = true;
        deleteSession(remove.dataset.sessionDelete).catch(function (err) {
          remove.disabled = false;
          showError(err);
        });
        return;
      }
      var row = event.target.closest('[data-session-name]');
      if (row) openSession(row.dataset.sessionName);
    };
    el('test-generations-results').onclick = function (event) {
      var rating = event.target.closest('[data-test-rating]');
      if (rating) {
        rateTestResult(rating);
        return;
      }
      var remove = event.target.closest('[data-remove-candidate]');
      if (remove) {
        removeCurrentSessionCandidate(remove);
        return;
      }
    };
    el('test-generations-compare').onclick = function (event) {
      var rating = event.target.closest('[data-test-rating]');
      if (rating) {
        rateTestResult(rating);
        return;
      }
      var remove = event.target.closest('[data-remove-candidate]');
      if (remove) {
        removeCurrentSessionCandidate(remove);
        return;
      }
      if (event.target.closest('[data-compare-previous]')) {
        compareIndex = Math.max(0, compareIndex - 1);
        renderCompare(currentStatus);
        return;
      }
      if (event.target.closest('[data-compare-next]')) {
        var results = currentStatus && Array.isArray(currentStatus.results) ? currentStatus.results : [];
        compareIndex = Math.min(Math.max(0, results.length - 2), compareIndex + 1);
        renderCompare(currentStatus);
      }
    };
    el('test-generations-prompt').addEventListener('input', function () {
      saveTestWorkspacePrompt(this.value);
    });
    ['test-generations-aspect', 'test-generations-megapixels', 'test-generations-duration', 'test-generations-dimensions'].forEach(function (id) {
      el(id).addEventListener('change', function () {
        saveTestBenchState();
      });
    });
    el('test-generations-info-btn').onclick = function () {
      el('test-generations-help').classList.toggle('hidden');
    };
    el('test-generations-session-info-btn').onclick = function () {
      var details = el('test-generations-session-details');
      var button = el('test-generations-session-info-btn');
      var expanded = details.classList.toggle('hidden') === false;
      button.textContent = expanded ? '×' : 'Details';
      button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      button.title = expanded ? 'Close session details' : 'View frozen session settings and resolved prompt';
      button.setAttribute('aria-label', button.title);
    };
    window.addEventListener('webcap:inference-queue-snapshot', function (event) {
      syncTestInferenceSnapshot(event && event.detail && event.detail.queue);
    });
    window.addEventListener('webcap:training-archived', function (event) {
      var folder = String(event && event.detail && event.detail.folder || '');
      if (!folder || !isOpen() || String(launchFolder || '') !== String(owningSetFolder(folder) || '')) return;
      refreshStagedFilesAfterCandidates().catch(showError);
    });
    window.addEventListener('webcap:test-sessions-cleared', function (event) {
      var folder = String(event && event.detail && event.detail.folder || '');
      if (!folder) return;
      forgetTrackedTestSessions(folder);
      if (String(currentSessionFolder || '') === String(owningSetFolder(folder) || '')) {
        currentSession = '';
        currentSessionFolder = '';
        currentSessionModel = '';
        showSessionError = false;
        if (isOpen() && String(launchFolder || '') === String(owningSetFolder(folder) || '')) {
          renderStatus({ status: 'idle' });
          refreshSessions().catch(showError);
        }
      }
    });
    if (typeof window.getInferenceQueueSnapshot === 'function') {
      syncTestInferenceSnapshot(window.getInferenceQueueSnapshot());
    }
    window.addEventListener('webcap:working-model-changed', function () {
      syncLaunchVisibility();
      syncActiveRunControls(currentStatus);
      if (isOpen()) openPane();
    });
    syncTestRailCollapseUi();
    syncLaunchVisibility();
    refreshSupportedTestModels().catch(showError);
    refreshActivityButton();
  }

  window.testGenerationsFolderLoaded = testGenerationsFolderLoaded;
  window.prepareTestBenchSetSwitch = prepareTestBenchSetSwitch;
  window.openTestBenchActivity = openTestBenchActivity;
  window.openTestBenchActivityMenu = openTestBenchActivityMenu;
  window.openTestBenchForFolder = openTestBenchForSetFolder;
  window.openTestBenchForCurrentFolder = openPane;
  window.closeTestBenchActivity = closePane;
  window.refreshTestBenchActivity = refreshActivityButton;
  bindUi();
})();
