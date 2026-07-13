var trainingWorkspaceState = {
  manifest: null,
  configFiles: [],
  runnerJobs: [],
  runnerActiveJobId: '',
  runnerSelectedJobId: '',
  runnerLogOffsets: {},
  runnerPollTimer: 0,
  runnerStatusPending: false,
  runnerPreflight: null
};

function classifyTrainingConfigFile(fileName) {
  var lower = String(fileName || '').toLowerCase();
  if (/(^|[._-])hi([._-]|$)/.test(lower)) return 'hi';
  if (/(^|[._-])lo([._-]|$)/.test(lower)) return 'lo';
  var hasHi = lower.indexOf('hi') !== -1;
  var hasLo = lower.indexOf('lo') !== -1;
  if (hasHi && !hasLo) return 'hi';
  return 'lo';
}

function isTrainingWorkspaceActive() {
  return normalizeWorkspaceSurface(workspaceState.surface) === 'training';
}

function getTrainingWorkspaceEls() {
  return {
    navigator: document.getElementById('training-navigator'),
    folder: document.getElementById('training-navigator-folder'),
    readiness: document.getElementById('training-readiness'),
    configList: document.getElementById('training-workspace-config-list'),
    commandStatus: document.getElementById('training-command-status'),
    commandText: document.getElementById('training-command-text'),
    copyCommandBtn: document.getElementById('training-copy-command-btn'),
    itemOverview: document.getElementById('training-item-overview'),
    itemOverviewSummary: document.getElementById('training-item-overview-summary'),
    runnerSummary: document.getElementById('training-runner-summary'),
    runnerActions: document.getElementById('training-runner-actions'),
    runnerStopBtn: document.getElementById('training-runner-stop-btn'),
    runnerCancelBtn: document.getElementById('training-runner-cancel-btn'),
    runnerConsoleBtn: document.getElementById('training-runner-console-btn'),
    runnerPreflight: document.getElementById('training-runner-preflight')
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
  var selectedId = trainingWorkspaceState.runnerSelectedJobId;
  for (var i = 0; i < jobs.length; i++) {
    if (jobs[i].id === selectedId) return jobs[i];
  }
  for (var j = 0; j < jobs.length; j++) {
    if (jobs[j].id === trainingWorkspaceState.runnerActiveJobId) return jobs[j];
  }
  for (var k = jobs.length - 1; k >= 0; k--) {
    if (jobs[k].folder === state.folder) return jobs[k];
  }
  return jobs.length ? jobs[jobs.length - 1] : null;
}

function formatTrainingRunnerElapsed(job) {
  var started = Number(job && job.startedAt || 0);
  if (!started) return '';
  var seconds = Math.max(0, Math.floor(Date.now() / 1000 - started));
  var hours = Math.floor(seconds / 3600);
  var minutes = Math.floor((seconds % 3600) / 60);
  return hours ? hours + 'h ' + minutes + 'm' : minutes + 'm';
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
  if (!els.runnerSummary || !els.runnerActions) return;
  var jobs = trainingWorkspaceState.runnerJobs || [];
  var activeCount = jobs.filter(function (job) { return job.status === 'running' || job.status === 'stopping'; }).length;
  var queuedCount = jobs.filter(function (job) { return job.status === 'queued'; }).length;
  var job = getTrainingRunnerSelectedJob();
  if (!job) {
    els.runnerSummary.textContent = 'No managed training jobs.';
    els.runnerActions.classList.add('hidden');
    return;
  }
  trainingWorkspaceState.runnerSelectedJobId = job.id;
  var elapsed = formatTrainingRunnerElapsed(job);
  var status = String(job.status || 'unknown');
  var stage = String(job.stage || '');
  els.runnerSummary.innerHTML = '<strong>' + escapeHtml(status.charAt(0).toUpperCase() + status.slice(1)) + '</strong>' +
    (stage ? ' - ' + escapeHtml(stage.toUpperCase()) : '') +
    (elapsed ? ' - ' + escapeHtml(elapsed) : '') +
    '<br><span>' + escapeHtml(job.folder || '') + '</span>' +
    (queuedCount ? '<br><span>' + queuedCount + ' queued job' + (queuedCount === 1 ? '' : 's') + '.</span>' : '') +
    (job.error ? '<br><span>' + escapeHtml(job.error) + '</span>' : '');
  els.runnerActions.classList.remove('hidden');
  var running = status === 'running' || status === 'stopping';
  var queued = status === 'queued';
  if (els.runnerStopBtn) els.runnerStopBtn.classList.toggle('hidden', !running);
  if (els.runnerCancelBtn) els.runnerCancelBtn.classList.toggle('hidden', !queued);
  if (!activeCount && !queuedCount && status !== 'failed' && status !== 'completed' && status !== 'stopped') {
    els.runnerActions.classList.add('hidden');
  }
}

function appendTrainingRunnerValidationToConsole(payload) {
  var checks = Array.isArray(payload.checks) ? payload.checks : [];
  var lines = ['[training-runner] Validation results:'];
  checks.forEach(function (check) {
    lines.push((check.ok ? '[OK] ' : '[FAIL] ') + (check.message || check.id));
    if (check.details) lines.push(String(check.details));
  });
  if (payload.runnerScript) lines.push('[training-runner] Generated runner script:\n' + payload.runnerScript);
  appendToConsolePanel(lines.join('\n') + '\n');
}

function fetchTrainingRunnerLog(job) {
  if (!job || !job.id) return;
  var offset = Number(trainingWorkspaceState.runnerLogOffsets[job.id] || 0);
  fetch('/fs/training_runner/log?jobId=' + encodeURIComponent(job.id) + '&offset=' + encodeURIComponent(offset))
    .then(function (response) { return response.json(); })
    .then(function (payload) {
      if (!payload || !payload.ok) return;
      trainingWorkspaceState.runnerLogOffsets[job.id] = Number(payload.nextOffset || offset);
      if (payload.text) appendToConsolePanel(payload.text);
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
    });
}

function scheduleTrainingRunnerPoll() {
  if (trainingWorkspaceState.runnerPollTimer) clearTimeout(trainingWorkspaceState.runnerPollTimer);
  if (!isTrainingWorkspaceActive()) return;
  trainingWorkspaceState.runnerPollTimer = setTimeout(function () {
    refreshTrainingRunnerStatus();
  }, 1500);
}

function refreshTrainingRunnerStatus() {
  if (!isTrainingWorkspaceActive() || trainingWorkspaceState.runnerStatusPending) return;
  trainingWorkspaceState.runnerStatusPending = true;
  trainingRunnerRequest('/fs/training_runner/status')
    .then(function (payload) {
      trainingWorkspaceState.runnerJobs = Array.isArray(payload.jobs) ? payload.jobs : [];
      trainingWorkspaceState.runnerActiveJobId = String(payload.activeJobId || '');
      renderTrainingRunner();
      var selected = getTrainingRunnerSelectedJob();
      if (selected && (selected.status === 'running' || selected.status === 'stopping')) fetchTrainingRunnerLog(selected);
    })
    .catch(function (err) {
      if (window.console && console.error) console.error('[Training runner] Status refresh failed:', err);
    })
    .then(function () {
      trainingWorkspaceState.runnerStatusPending = false;
      scheduleTrainingRunnerPoll();
    });
}

function validateTrainingRunner() {
  if (!state.folder) return Promise.reject(new Error('No folder selected for training validation.'));
  setStatus('Validating managed training runner...');
  showConsolePanel();
  return trainingRunnerRequest('/fs/training_runner/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: state.folder }),
    allowNotOk: true
  }).then(function (payload) {
    renderTrainingRunnerPreflight(payload);
    appendTrainingRunnerValidationToConsole(payload);
    setStatus(payload.ok ? 'Training runner validation passed.' : 'Training runner validation found blockers.');
    return payload;
  });
}

function startManagedTraining(queue) {
  if (!state.folder) {
    setStatus('No folder selected for managed training.');
    return;
  }
  ensureGeneratedTrainingArtifactsForCurrentFolder()
    .then(function () { return validateTrainingRunner(); })
    .then(function (preflight) {
      if (!preflight.ok) return null;
      var verb = queue ? 'queue this HI to LO training job' : 'start this HI to LO training job';
      if (!window.confirm('Runner validation passed. Continue and ' + verb + '?')) return null;
      return trainingRunnerRequest('/fs/training_runner/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: state.folder, queue: !!queue })
      });
    })
    .then(function (payload) {
      if (!payload) return;
      trainingWorkspaceState.runnerSelectedJobId = payload.job.id;
      trainingWorkspaceState.runnerLogOffsets[payload.job.id] = 0;
      trainingWorkspaceState.runnerPreflight = null;
      renderTrainingRunnerPreflight(null);
      showConsolePanel();
      setStatus(payload.queued ? 'Training job queued.' : 'Managed training started.');
      refreshTrainingRunnerStatus();
    })
    .catch(function (err) {
      setStatus('Managed training did not start: ' + String(err && err.message ? err.message : err));
    });
}

function stopManagedTraining(cancel) {
  var job = getTrainingRunnerSelectedJob();
  if (!job || !job.id) return;
  var label = cancel ? 'Cancel this queued training job?' : 'Stop the running training job?';
  if (!window.confirm(label)) return;
  trainingRunnerRequest('/fs/training_runner/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: job.id, cancel: !!cancel })
  }).then(function () {
    setStatus(cancel ? 'Queued training job cancelled.' : 'Stopping managed training...');
    refreshTrainingRunnerStatus();
  }).catch(function (err) {
    setStatus('Could not change training job: ' + String(err && err.message ? err.message : err));
  });
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
  if (!els.itemOverview || !els.itemOverviewSummary) return;
  els.itemOverview.replaceChildren();

  if (errorMessage) {
    els.itemOverviewSummary.textContent = errorMessage;
    return;
  }

  var items = getTrainingManifestItems(manifest);
  if (!manifest) {
    els.itemOverviewSummary.textContent = 'Prepare the dataset to see its training items here.';
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
    return;
  }

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

function buildTrainingWorkspaceConfigColumn(title, files) {
  var buttons = files.map(function (fileName) {
    var active = !!(state.currentConfigFile && state.currentConfigFile.folder === state.folder && state.currentConfigFile.file === fileName);
    return '<button type="button" class="training-config-link' + (active ? ' active' : '') + '" data-training-config="' + encodeURIComponent(fileName) + '">' + escapeHtml(fileName) + '</button>';
  }).join('');
  return '<div class="training-config-col"><div class="training-config-col-title">' + title + '</div>' + (buttons || '<div class="training-config-empty">No files</div>') + '</div>';
}

function renderTrainingWorkspaceConfigList(files) {
  var els = getTrainingWorkspaceEls();
  if (!els.configList) return;
  if (!files.length) {
    els.configList.textContent = 'Generate configs to inspect and edit them here.';
    return;
  }
  var hiFiles = [];
  var loFiles = [];
  files.forEach(function (fileName) {
    if (classifyTrainingConfigFile(fileName) === 'hi') hiFiles.push(fileName);
    else loFiles.push(fileName);
  });
  els.configList.innerHTML = '<div class="training-config-grid">' +
    buildTrainingWorkspaceConfigColumn('High Noise', hiFiles) +
    buildTrainingWorkspaceConfigColumn('Low Noise', loFiles) +
    '</div>';
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
    ? 'Command generated and copied to the clipboard.'
    : 'Run Train to generate and copy the command.';
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
  if (els.folder) els.folder.textContent = folder || 'No folder selected';
  if (!folder) {
    trainingWorkspaceState.manifest = null;
    trainingWorkspaceState.configFiles = [];
    if (els.readiness) els.readiness.textContent = 'Select a set folder to prepare a dataset.';
    renderTrainingItemOverview(null);
    renderTrainingWorkspaceConfigList([]);
    renderTrainingCommandHandoff();
    return;
  }
  if (els.readiness) els.readiness.textContent = 'Loading dataset readiness...';
  Promise.all([fetchTrainingWorkspaceManifest(folder), fetchTrainingWorkspaceConfigFiles(folder)])
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

function runTrainingWorkspaceAction(action) {
  var runner = action === 'prepare'
    ? runPrepareDatasetForCurrentFolder
    : action === 'generate'
      ? runGenerateDatasetConfigsForCurrentFolder
      : runTrainCommandPreviewForCurrentFolder;
  var request = runner();
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

function wireTrainingWorkspace() {
  var backBtn = document.getElementById('training-workspace-back-btn');
  var prepareBtn = document.getElementById('training-workspace-prepare-btn');
  var generateBtn = document.getElementById('training-workspace-generate-btn');
  var trainBtn = document.getElementById('training-workspace-train-btn');
  var trainMenu = document.getElementById('training-run-menu-panel');
  var previewCommandBtn = document.getElementById('training-preview-command-btn');
  var validateRunnerBtn = document.getElementById('training-validate-runner-btn');
  var runInAppBtn = document.getElementById('training-run-in-app-btn');
  var queueJobBtn = document.getElementById('training-queue-job-btn');
  var copyCommandBtn = document.getElementById('training-copy-command-btn');
  var consoleBtn = document.getElementById('training-console-btn');
  var runnerStopBtn = document.getElementById('training-runner-stop-btn');
  var runnerCancelBtn = document.getElementById('training-runner-cancel-btn');
  var runnerConsoleBtn = document.getElementById('training-runner-console-btn');
  backBtn.onclick = function () { exitWorkspaceSurface(); };
  prepareBtn.onclick = function () { runTrainingWorkspaceAction('prepare'); };
  generateBtn.onclick = function () { runTrainingWorkspaceAction('generate'); };
  trainBtn.onclick = function () {
    var open = trainMenu.classList.contains('hidden');
    trainMenu.classList.toggle('hidden', !open);
    trainBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  previewCommandBtn.onclick = function () {
    trainMenu.classList.add('hidden');
    trainBtn.setAttribute('aria-expanded', 'false');
    runTrainingWorkspaceAction('train');
  };
  validateRunnerBtn.onclick = function () {
    trainMenu.classList.add('hidden');
    trainBtn.setAttribute('aria-expanded', 'false');
    validateTrainingRunner().catch(function (err) {
      setStatus('Training runner validation failed: ' + String(err && err.message ? err.message : err));
    });
  };
  runInAppBtn.onclick = function () {
    trainMenu.classList.add('hidden');
    trainBtn.setAttribute('aria-expanded', 'false');
    startManagedTraining(false);
  };
  queueJobBtn.onclick = function () {
    trainMenu.classList.add('hidden');
    trainBtn.setAttribute('aria-expanded', 'false');
    startManagedTraining(true);
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
    toggleConsolePanel();
    syncTrainingConsoleUi();
  };
  runnerStopBtn.onclick = function () { stopManagedTraining(false); };
  runnerCancelBtn.onclick = function () { stopManagedTraining(true); };
  runnerConsoleBtn.onclick = function () {
    showConsolePanel();
    fetchTrainingRunnerLog(getTrainingRunnerSelectedJob());
  };
}

function syncTrainingConsoleUi() {
  var consoleBtn = document.getElementById('training-console-btn');
  if (!consoleBtn) return;
  var visible = isConsolePanelVisible();
  consoleBtn.classList.toggle('active', visible);
  consoleBtn.setAttribute('aria-pressed', visible ? 'true' : 'false');
}

function syncTrainingWorkspaceUi() {
  if (!isTrainingWorkspaceActive()) return;
  syncTrainingConsoleUi();
  refreshTrainingWorkspace();
  refreshTrainingRunnerStatus();
}

wireTrainingWorkspace();
