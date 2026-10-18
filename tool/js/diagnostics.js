var diagnosticsActiveTab = 'health';
var diagnosticsLoadedConfig = null;
var diagnosticsAssessmentSelected = { director: new Set(), vision: new Set() };
var diagnosticsAssessmentCatalog = { directors: [], visions: [] };

function diagnosticsEl(id) {
  return document.getElementById(id);
}

function setDiagnosticsTab(tabName, focusTab) {
  var next = ['health', 'assessment', 'h3', 'models', 'benchmark', 'model-lab'].indexOf(tabName) !== -1 ? tabName : 'health';
  diagnosticsActiveTab = next;
  var selectedButton = null;

  Array.prototype.forEach.call(document.querySelectorAll('[data-diagnostics-tab]'), function (button) {
    var active = button.getAttribute('data-diagnostics-tab') === next;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.tabIndex = active ? 0 : -1;
    if (active) selectedButton = button;
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-diagnostics-panel]'), function (panel) {
    var active = panel.getAttribute('data-diagnostics-panel') === next;
    panel.classList.toggle('hidden', !active);
    panel.hidden = !active;
  });

  if (next === 'assessment') refreshUnifiedModelAssessment();
  if (next === 'h3') refreshH3CalibrationSettings();
  if ((next === 'models' || next === 'benchmark') && !directorModelTestState.loaded) directorModelTestRefresh();
  if (next === 'model-lab') modelLabRefresh();
  if (focusTab && selectedButton) selectedButton.focus();
}

function refreshUnifiedModelAssessment() {
  var summary = diagnosticsEl('diagnostics-assessment-summary');
  var results = diagnosticsEl('diagnostics-assessment-results');
  if (!summary || !results) throw new Error('Unified assessment markup is missing.');
  summary.textContent = 'Loading model findings…';
  return Promise.all([
    fetch('/fs/storyboard/director').then(function (r) { return r.json().then(function (p) { if (!r.ok || p.ok === false) throw new Error(p.error || 'Director discovery failed.'); return p; }); }),
    fetch('/app/director-model-test').then(function (r) { return r.json().then(function (p) { if (!r.ok || p.ok === false) throw new Error(p.error || 'Director findings failed.'); return p; }); }),
    fetch('/app/model-lab').then(function (r) { return r.json().then(function (p) { if (!r.ok || p.ok === false) throw new Error(p.error || 'Model Lab findings failed.'); return p; }); })
  ]).then(function (values) {
    var directors = values[0].models || [];
    var reports = values[1].calibrationReports || [];
    var labRuns = values[2].runs || [];
    var labModels = values[2].models || {};
    var vision = labModels.visions || [];
    diagnosticsAssessmentCatalog = { directors: directors, visions: vision };
    summary.textContent = directors.length + ' Director models · ' + vision.length + ' Vision models · ' + labRuns.length + ' Model Lab runs';
    results.replaceChildren();
    var selectedBefore = diagnosticsAssessmentSelected;
    var present = { director: new Set(), vision: new Set() };
    function refreshSelectionSummary() {
      diagnosticsEl('diagnostics-assessment-selection').textContent =
        (diagnosticsAssessmentSelected.director.size + diagnosticsAssessmentSelected.vision.size) +
        ' model(s) selected · selection is preview-only; tests still launch from the existing tabs.';
    }
    function addChoice(row, kind, ref) {
      present[kind].add(ref);
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedBefore[kind].has(ref);
      checkbox.setAttribute('aria-label', 'Select ' + kind + ' model ' + ref);
      checkbox.addEventListener('change', function () {
        if (checkbox.checked) diagnosticsAssessmentSelected[kind].add(ref);
        else diagnosticsAssessmentSelected[kind].delete(ref);
        refreshSelectionSummary();
      });
      row.insertBefore(checkbox, row.firstChild);
    }
    function addRow(title, detail, kind, ref) {
      var row = document.createElement('div');
      row.className = 'app-settings-environment-result';
      var heading = document.createElement('strong');
      heading.textContent = title;
      var description = document.createElement('div');
      description.className = 'app-settings-help';
      description.textContent = detail;
      row.appendChild(heading);
      row.appendChild(description);
      addChoice(row, kind, ref);
      results.appendChild(row);
    }
    directors.forEach(function (model) {
      var ref = String(model.id || '');
      var report = reports.find(function (entry) { return String(entry.modelRef || '') === ref; });
      var matchingRuns = labRuns.filter(function (run) {
        return !!(run.summary && run.summary.byModel && run.summary.byModel[ref]);
      });
      addRow(String(model.label || model.modelId || ref), 'Director · ' +
        (report ? 'Writing: ' + String(report.health || report.status || 'recorded') : 'Writing: unassessed') +
        ' · Structured: ' + (matchingRuns.length ? matchingRuns.length + ' Lab run(s)' : 'not tested here'), 'director', ref);
    });
    vision.forEach(function (model) {
      var ref = String(model.modelRef || '');
      var matchingRuns = labRuns.filter(function (run) {
        return !!(run.summary && run.summary.byModel && run.summary.byModel[ref]);
      });
      addRow(String(model.label || model.modelId || ref), 'Vision · ' +
        (matchingRuns.length ? matchingRuns.length + ' Lab run(s)' : 'No saved Lab runs'), 'vision', ref);
    });
    ['director', 'vision'].forEach(function (kind) {
      diagnosticsAssessmentSelected[kind].forEach(function (ref) {
        if (!present[kind].has(ref)) diagnosticsAssessmentSelected[kind].delete(ref);
      });
    });
    refreshSelectionSummary();
  }).catch(function (error) {
    summary.textContent = 'Could not load assessment findings: ' + String(error.message || error);
    reportConsoleError('Model Assessment', error);
    throw error;
  });
}

function runUnifiedModelAssessment() {
  var selectedDirectors = diagnosticsAssessmentCatalog.directors.filter(function (model) {
    return diagnosticsAssessmentSelected.director.has(String(model.id || ''));
  }).map(function (model) {
    return {
      modelRef: String(model.id || ''),
      runtimeId: String(model.runtimeId || ''),
      runtimeName: String(model.runtimeName || ''),
      modelId: String(model.modelId || ''),
      label: String(model.label || model.modelId || ''),
      sizeBytes: Number(model.sizeBytes || 0)
    };
  });
  var directorRefs = diagnosticsAssessmentSelected.director;
  var visionRefs = diagnosticsAssessmentSelected.vision;
  if (!directorRefs.size && !visionRefs.size) throw new Error('Choose at least one model.');
  if (diagnosticsEl('diagnostics-assessment-deep').checked) {
    throw new Error('Deep Assessment is not available yet. Uncheck it to run the standard suite.');
  }
  if (directorModelTestState.running) throw new Error('Director assessment or benchmark is already running.');
  var catalog = diagnosticsAssessmentCatalog;
  var visions = (catalog.visions || []).filter(function (model) { return visionRefs.has(String(model.modelRef || '')); });
  var directors = selectedDirectors;
  if (selectedDirectors.length !== directorRefs.size || visions.length !== visionRefs.size || directors.length !== directorRefs.size) {
    throw new Error('Model selections are stale; refresh assessment findings and retry.');
  }
  var sourceFolder = String(state && state.folder || '').trim();
  var files = modelLabCurrentFiles();
  var canLab = !!sourceFolder && files.length >= 2;
  var status = diagnosticsEl('diagnostics-assessment-selection');
  if (!canLab && !selectedDirectors.length) throw new Error('Vision testing requires a Set with at least two media items.');
  status.textContent = 'Starting standard assessment…';
  var runButton = diagnosticsEl('diagnostics-assessment-run');
  runButton.disabled = true;
  return Promise.resolve().then(function () {
    if (!canLab) return null;
    if (modelLabState.run && modelLabState.run.status === 'running') throw new Error('Model Lab is already running. Stop or complete that run first.');
    return modelLabPost({
      action: 'start',
      config: {
        folder: sourceFolder, files: files, groups: modelLabGroups(), sampleCount: 8,
        visionModels: visions, directorModels: directors,
        referenceVisionRef: visions.length ? String(visions[0].modelRef) : '',
        referenceDirectorRef: directors.length ? String(directors[0].modelRef) : '',
        referenceVision: visions.length ? visions[0] : null,
        referenceDirector: directors.length ? directors[0] : null
      }
    }).then(function (payload) {
      modelLabState.run = payload.run;
      modelLabState.runs = payload.runs || modelLabState.runs;
      modelLabRender();
      modelLabSchedulePoll();
      reportConsoleInfo('Model Assessment', 'Started persistent Model Lab run ' + payload.run.id + '.');
      return payload.run;
    });
  }).then(function (labRun) {
    if (!selectedDirectors.length) {
      status.textContent = 'Vision suite started in Model Lab. You may close Diagnostics.';
      return;
    }
    status.textContent = labRun
      ? 'Model Lab running; Director writing assessment started separately. Keep this page open for writing tests.'
      : 'Director writing assessment running. Keep this page open until it completes.';
    return directorModelTestRefresh().then(function () {
      return directorModelTestStartCalibrationForModels(selectedDirectors);
    });
  }).then(function () {
    status.textContent = 'Writing assessment complete. Model Lab continues independently; refresh findings for results.';
  }).catch(function (error) {
    status.textContent = 'Assessment could not complete: ' + String(error.message || error);
    reportConsoleError('Model Assessment', error);
    throw error;
  }).finally(function () {
    runButton.disabled = false;
  });
}

function loadDiagnosticsConfig() {
  return fetch('/app/config')
    .then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok) throw new Error(payload && payload.error ? payload.error : 'Could not load WebCap configuration.');
        return payload;
      });
    })
    .then(function (cfg) {
      diagnosticsLoadedConfig = normalizeAppConfigShape(cfg);
      return diagnosticsLoadedConfig;
    });
}

function openDiagnosticsModal(tabName) {
  var modal = diagnosticsEl('diagnostics-modal');
  if (!modal) throw new Error('Diagnostics modal markup is missing.');
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');

  return loadDiagnosticsConfig()
    .then(function () {
      setDiagnosticsTab(tabName || diagnosticsActiveTab, false);
    })
    .catch(function (error) {
      reportConsoleError('Diagnostics', error);
      closeDiagnosticsModal();
      throw error;
    });
}

function closeDiagnosticsModal() {
  var modal = diagnosticsEl('diagnostics-modal');
  if (!modal) throw new Error('Diagnostics modal markup is missing.');
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');

  // Diagnostics can contain very large model/evidence trees. Once the modal
  // closes they provide no value to the active workspace, so release them.
  ['director-model-assessment-models', 'director-model-assessment-history'].forEach(function (id) {
    var host = diagnosticsEl(id);
    if (host) host.replaceChildren();
  });
  if (typeof directorModelTestState !== 'undefined') {
    directorModelTestState.loaded = false;
  }
}

function refreshH3CalibrationSettings() {
  var summary = diagnosticsEl('h3-calibration-summary');
  var source = diagnosticsEl('h3-calibration-source');
  var run = diagnosticsEl('h3-calibration-run-btn');
  var stop = diagnosticsEl('h3-calibration-stop-btn');
  var reset = diagnosticsEl('h3-calibration-reset-btn');
  if (!summary || !source || !run || !stop || !reset) throw new Error('H3 calibration Diagnostics markup is incomplete.');

  var calibration = diagnosticsLoadedConfig && diagnosticsLoadedConfig.training && diagnosticsLoadedConfig.training.h3_calibration;
  renderH3CalibrationResults(calibration);
  var results = calibration && calibration.results ? calibration.results : {};
  var hardware = calibration && calibration.hardware;
  summary.textContent = hardware
    ? ('Saved hardware: ' + hardware.gpu_model + ' · ' + hardware.total_vram_mib + ' MiB VRAM · ' + Object.keys(results).length + ' tested candidates.')
    : 'No saved calibration results.';
  reset.classList.toggle('hidden', !calibration);

  fetch('/fs/media_metadata?folder=' + encodeURIComponent(state.folder || ''))
    .then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok) throw new Error(payload && payload.error ? payload.error : 'Could not load calibration source metadata.');
        return payload;
      });
    })
    .then(function (metadataRows) {
      var metadata = {};
      (Array.isArray(metadataRows) ? metadataRows : []).forEach(function (row) {
        metadata[row.file] = { duration: Number(String(row.duration || '').replace('s', '')) };
      });
      source.innerHTML = '';
      var choices = (state.items || []).filter(function (item) {
        var ext = String(item.fileName || '').split('.').pop().toLowerCase();
        var data = metadata[item.fileName];
        return item.hasCaption &&
          ['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi', 'm4v'].indexOf(ext) !== -1 &&
          data && Number(data.duration) >= 102 / 24;
      }).sort(function (a, b) {
        var ad = Number(metadata[a.fileName].duration || 0);
        var bd = Number(metadata[b.fileName].duration || 0);
        return bd - ad || String(a.fileName).localeCompare(String(b.fileName));
      });
      choices.forEach(function (item) {
        var option = document.createElement('option');
        option.value = item.fileName;
        option.textContent = item.fileName + ' · ' + Number(metadata[item.fileName].duration).toFixed(1) + 's';
        source.appendChild(option);
      });
      run.disabled = !choices.length;
      if (!choices.length) summary.textContent += ' Choose or prepare a captioned video at least 4.25 seconds long.';
    })
    .catch(function (error) {
      reportConsoleError('H3 Calibration', error);
      summary.textContent = 'Could not load calibration source metadata. See Console.';
      run.disabled = true;
    });

  fetch('/fs/h3_probe/status')
    .then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok) throw new Error(payload && payload.error ? payload.error : 'Could not read H3 calibration status.');
        return payload;
      });
    })
    .then(function (status) {
      var active = !!(status && status.active);
      stop.classList.toggle('hidden', !active);
      run.classList.toggle('hidden', active);
      if (active) summary.textContent += ' Calibration is running.';
    })
    .catch(function (error) {
      reportConsoleError('H3 Calibration', error);
    });
}

function runH3Calibration(options) {
  options = options || {};
  var fileName = String(options.fileName || '').trim();
  if (!fileName) {
    diagnosticsEl('h3-calibration-summary').textContent = 'Choose a calibration source video.';
    return;
  }
  var run = diagnosticsEl('h3-calibration-run-btn');
  run.disabled = true;
  fetch('/fs/h3_probe/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: state.folder || '', fileName: fileName })
  }).then(function (response) {
    return response.json().then(function (payload) {
      if (!response.ok) throw new Error(payload && payload.error ? payload.error : 'Could not start H3 calibration.');
      return payload;
    });
  }).then(function () {
    reportConsoleInfo('H3 Calibration', 'Calibration started.');
    return loadDiagnosticsConfig();
  }).then(refreshH3CalibrationSettings).catch(function (error) {
    reportConsoleError('H3 Calibration', error);
    diagnosticsEl('h3-calibration-summary').textContent = 'Could not start calibration. See Console.';
    run.disabled = false;
  });
}

function stopH3Calibration() {
  var stop = diagnosticsEl('h3-calibration-stop-btn');
  stop.disabled = true;
  fetch('/fs/h3_probe/stop', { method: 'POST' })
    .then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok) throw new Error(payload && payload.error ? payload.error : 'Could not stop H3 calibration.');
        return payload;
      });
    })
    .then(function () {
      reportConsoleInfo('H3 Calibration', 'Calibration stop requested.');
      return loadDiagnosticsConfig();
    })
    .then(refreshH3CalibrationSettings)
    .catch(function (error) {
      reportConsoleError('H3 Calibration', error);
      diagnosticsEl('h3-calibration-summary').textContent = 'Could not stop calibration. See Console.';
    })
    .finally(function () {
      stop.disabled = false;
    });
}

function resetH3CalibrationSettings() {
  if (!confirm('Reset saved H3 calibration results? Existing probe logs and dataset TOMLs are unchanged.')) return;
  var payload = normalizeAppConfigShape(diagnosticsLoadedConfig || {});
  delete payload.training.h3_calibration;
  HttpModule.postJson('/app/config', payload, function (status, responseText) {
    if (status !== 200) {
      reportConsoleError('H3 Calibration', new Error(getErrorMessage(responseText, 'Could not reset H3 calibration.')));
      return;
    }
    var saved = JSON.parse(responseText);
    diagnosticsLoadedConfig = normalizeAppConfigShape(saved.config || payload);
    refreshH3CalibrationSettings();
  });
}

function renderEnvironmentCheck(payload) {
  var summaryEl = diagnosticsEl('app-settings-environment-summary');
  var resultsEl = diagnosticsEl('app-settings-environment-results');
  if (!payload || !Array.isArray(payload.checks)) {
    summaryEl.textContent = 'Environment check did not return a valid report.';
    resultsEl.innerHTML = '';
    resultsEl.classList.add('hidden');
    return;
  }

  var summary = payload.summary || {};
  var groupOrder = ['core', 'training', 'inference', 'director', 'optional_analysis'];
  var groupLabels = {
    core: 'Core',
    training: 'Training',
    inference: 'Inference',
    director: 'Director',
    optional_analysis: 'Optional Analysis'
  };
  var core = summary.core || {};
  summaryEl.textContent = core.ready
    ? ('WebCap ready · ' + Number(summary.passed || 0) + '/' + Number(summary.total || 0) + ' checks passed')
    : (Number(core.requiredFailures || 0) + ' core issue(s) · ' + Number(summary.passed || 0) + '/' + Number(summary.total || 0) + ' checks passed');

  resultsEl.innerHTML = groupOrder.map(function (groupName) {
    var checks = payload.checks.filter(function (check) { return check.group === groupName; });
    if (!checks.length) return '';
    var groupSummary = summary[groupName] || {};
    var requiredFailures = Number(groupSummary.requiredFailures || 0);
    var optionalFailures = Number(groupSummary.optionalFailures || 0);
    var groupState = requiredFailures
      ? (requiredFailures + ' issue(s)')
      : (optionalFailures ? ('Ready · ' + optionalFailures + ' optional unavailable') : 'Ready');
    var rows = checks.map(function (check) {
      var stateClass = check.ok ? 'ok' : (check.required ? 'failed' : 'optional');
      var detail = check.details ? '<div class="app-settings-environment-detail">' + escapeHtml(check.details) + '</div>' : '';
      var guidance = check.guidance ? '<div class="app-settings-environment-guidance">' + escapeHtml(check.guidance) + '</div>' : '';
      return '<div class="app-settings-environment-check ' + stateClass + '">' +
        '<span class="app-settings-environment-mark">' + (check.ok ? '&#10003;' : '!') + '</span>' +
        '<span><strong>' + escapeHtml(check.message || check.id) + '</strong>' + detail + guidance + '</span>' +
        '</div>';
    }).join('');
    return '<section class="app-settings-environment-group">' +
      '<div class="app-settings-environment-group-header"><strong>' + escapeHtml(groupLabels[groupName] || groupName) + '</strong><span>' + escapeHtml(groupState) + '</span></div>' +
      rows +
      '</section>';
  }).join('');

  resultsEl.classList.remove('hidden');
  diagnosticsEl('app-settings-environment-details').open = !core.ready;
}

function appendRequirementsOutputToConsole(payload) {
  payload = payload && typeof payload === 'object' ? payload : {};
  var command = Array.isArray(payload.command) ? payload.command.join(' ') : '';
  if (command) reportConsoleInfo('Python Requirements', '$ ' + command);
  String(payload.stdout || '').split(/\r?\n/).forEach(function (line) {
    if (line) reportConsoleInfo('Python Requirements', line);
  });
  String(payload.stderr || '').split(/\r?\n/).forEach(function (line) {
    if (line) reportConsoleWarning('Python Requirements', line);
  });
}

function installPythonRequirements() {
  var button = diagnosticsEl('app-settings-environment-install-btn');
  button.disabled = true;
  button.textContent = 'Installing...';
  reportConsoleInfo('Python Requirements', 'Installing / repairing requirements.txt in the current WebCap Python environment...');
  fetch('/app/environment/install-requirements', { method: 'POST' })
    .then(function (response) {
      return response.json().then(function (payload) {
        appendRequirementsOutputToConsole(payload);
        if (!response.ok || !payload.ok) throw new Error(payload && payload.error ? payload.error : 'Python requirements install failed.');
        return payload;
      });
    })
    .then(function () {
      reportConsoleInfo('Python Requirements', 'Install / repair completed successfully.');
      return runEnvironmentCheck();
    })
    .catch(function (error) {
      reportConsoleError('Python Requirements', error);
      diagnosticsEl('app-settings-environment-summary').textContent = 'Requirements install failed. See Console.';
    })
    .finally(function () {
      button.disabled = false;
      button.textContent = 'Install / Repair Python Requirements';
    });
}

function runEnvironmentCheck() {
  var button = diagnosticsEl('app-settings-environment-run-btn');
  var summary = diagnosticsEl('app-settings-environment-summary');
  var results = diagnosticsEl('app-settings-environment-results');
  button.disabled = true;
  summary.textContent = 'Checking...';
  return fetch('/app/environment')
    .then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok) throw new Error(payload && payload.error ? payload.error : 'Environment check failed.');
        return payload;
      });
    })
    .then(renderEnvironmentCheck)
    .catch(function (error) {
      reportConsoleError('Environment Check', error);
      summary.textContent = 'Environment check failed.';
      results.innerHTML = '<div class="app-settings-environment-check failed"><span class="app-settings-environment-mark">!</span><span><strong>' + escapeHtml(error.message || String(error)) + '</strong></span></div>';
      results.classList.remove('hidden');
    })
    .finally(function () {
      button.disabled = false;
    });
}

function wireDiagnosticsUi() {
  diagnosticsEl('shell-diagnostics-btn').onclick = function () { openDiagnosticsModal(); };
  diagnosticsEl('diagnostics-close-btn').onclick = closeDiagnosticsModal;
  diagnosticsEl('app-settings-environment-run-btn').onclick = runEnvironmentCheck;
  diagnosticsEl('app-settings-environment-install-btn').onclick = installPythonRequirements;
  diagnosticsEl('h3-calibration-run-btn').onclick = function () {
    runH3Calibration({ fileName: diagnosticsEl('h3-calibration-source').value });
  };
  diagnosticsEl('h3-calibration-stop-btn').onclick = stopH3Calibration;
  diagnosticsEl('h3-calibration-reset-btn').onclick = resetH3CalibrationSettings;
  diagnosticsEl('h3-calibration-console-btn').onclick = showConsolePanel;
  diagnosticsEl('diagnostics-assessment-run').onclick = function () { runUnifiedModelAssessment().catch(function (error) { reportConsoleError('Model Assessment', error); }); };
  diagnosticsEl('diagnostics-assessment-refresh').onclick = function () { refreshUnifiedModelAssessment().catch(function () {}); };
  diagnosticsEl('diagnostics-assessment-director').onclick = function () { setDiagnosticsTab('models', true); };
  diagnosticsEl('diagnostics-assessment-lab').onclick = function () { setDiagnosticsTab('model-lab', true); };
  diagnosticsEl('diagnostics-assessment-benchmark').onclick = function () { setDiagnosticsTab('benchmark', true); };

  Array.prototype.forEach.call(document.querySelectorAll('[data-diagnostics-tab]'), function (button) {
    button.onclick = function () {
      setDiagnosticsTab(button.getAttribute('data-diagnostics-tab'), false);
    };
    button.onkeydown = function (event) {
      var tabs = ['health', 'h3', 'models', 'benchmark'];
      var current = tabs.indexOf(button.getAttribute('data-diagnostics-tab'));
      var next = current;
      if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
      else return;
      event.preventDefault();
      setDiagnosticsTab(tabs[next], true);
    };
  });

  diagnosticsEl('diagnostics-modal').addEventListener('mousedown', function (event) {
    if (event.target === diagnosticsEl('diagnostics-modal')) closeDiagnosticsModal();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    var modal = diagnosticsEl('diagnostics-modal');
    if (!modal.classList.contains('hidden')) closeDiagnosticsModal();
  });
}

wireDiagnosticsUi();
