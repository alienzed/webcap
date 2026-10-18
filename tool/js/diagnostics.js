var diagnosticsActiveTab = 'health';
var diagnosticsLoadedConfig = null;
var diagnosticsAssessmentSelected = { director: new Set(), vision: new Set() };
var diagnosticsAssessmentCatalog = { directors: [], visions: [] };
var diagnosticsAssessmentRunId = '';
var diagnosticsAssessmentRunStatus = '';
var diagnosticsAssessmentStoppingId = '';

function diagnosticsEl(id) {
  return document.getElementById(id);
}

function diagnosticsProbeMetrics(attempt) {
  var result = attempt && attempt.result || {};
  var tokens = Number((result.usage || {}).completion_tokens || 0);
  var decodeSpeed = Number((result.timings || {}).predicted_per_second || 0);
  var requestSeconds = Number(result.requestSeconds || 0);
  var duration = requestSeconds || (Date.parse(attempt && attempt.finishedAt) - Date.parse(attempt && attempt.startedAt)) / 1000;
  return {
    speed: decodeSpeed > 0 ? decodeSpeed : tokens > 0 && duration > 0 ? tokens / duration : 0,
    tokens: tokens,
    hint: decodeSpeed > 0 ? 'Runtime-reported generation speed.' : requestSeconds > 0
      ? 'Effective request throughput, including prompt processing, model loading and network time; not decode-only speed.'
      : 'Effective probe throughput, including queue wait, prompt processing, model loading and network time; not decode-only speed.'
  };
}

function diagnosticsUpdateAssessmentMetrics(run) {
  if (!Array.isArray(run.attempts)) return;
  var latest = {};
  run.attempts.forEach(function (attempt) {
    if (attempt.finishedAt && diagnosticsProbeMetrics(attempt).tokens > 0) {
      latest[attempt.role + ':' + attempt.modelRef] = attempt;
    }
  });
  diagnosticsEl('diagnostics-assessment-results').querySelectorAll('[data-assessment-model]').forEach(function (row) {
    var role = row.dataset.assessmentModel.split(':')[0];
    var ref = row.dataset.assessmentModel.slice(role.length + 1);
    var attempts = run.attempts.filter(function (item) { return item.role === role && item.modelRef === ref; });
    if (attempts.length) {
      var primary = attempts.filter(function (item) { return item.kind === (role === 'vision' ? 'vision_open' : 'director_writing'); });
      var primaryText = primary.some(function (item) { return item.status === 'failed'; }) ? 'Failed'
        : primary.some(function (item) { return item.status === 'running'; }) ? 'Running'
        : primary.length && primary.every(function (item) { return item.status === 'completed'; }) ? 'Response received'
        : primary.length ? 'Incomplete' : 'Not tested';
      row.querySelector('[data-assessment-primary]').textContent = primaryText;
      row.querySelector('[data-assessment-state]').textContent = run.status;
      row.querySelector('[data-assessment-provenance]').textContent = 'Model Lab run: ' + run.id + ' · ' + run.status +
        (run.importedFrom ? ' · Imported from ' + run.importedFrom.host + ' (source runtime measurements)' : '');
      var counts = {};
      attempts.forEach(function (item) {
        var group = counts[item.kind] || (counts[item.kind] = {states: {}, errors: new Set()});
        group.states[item.status] = (group.states[item.status] || 0) + 1;
        if (item.error) group.errors.add(item.error);
      });
      row.querySelector('[data-assessment-capabilities]').textContent = Object.keys(counts).map(function (kind) {
        var group = counts[kind];
        return modelLabAttemptLabel(kind) + ': ' + Object.keys(group.states).map(function (status) {
          return group.states[status] + ' ' + status;
        }).join(', ') + (group.errors.size ? ' · ' + Array.from(group.errors).join(' · ') : '');
      }).join(' · ');
      // These are plain diagnostic text lines; the surrounding details/input DOM stays intact.
      row.querySelectorAll('[data-assessment-initial-evidence]').forEach(function (line) { line.remove(); });
    }
    var attempt = latest[row.dataset.assessmentModel];
    if (!attempt) return;
    var measured = diagnosticsProbeMetrics(attempt);
    var speed = row.querySelector('[data-assessment-speed]');
    speed.textContent = measured.speed > 0 ? measured.speed.toFixed(1) + ' tok/s' : '—';
    speed.title = measured.hint;
    row.querySelector('[data-assessment-output]').textContent = measured.tokens.toLocaleString() + ' tokens';
  });
}

function diagnosticsRenderAssessmentProgress(run) {
  if (String(run.id) !== diagnosticsAssessmentRunId || diagnosticsActiveTab !== 'assessment' ||
      diagnosticsEl('diagnostics-modal').classList.contains('hidden')) return;
  var host = diagnosticsEl('diagnostics-assessment-activity');
  var card = host.querySelector('[data-progress-card-id]');
  if (!card) { card = ProgressCard.create(); host.replaceChildren(card); }
  host.classList.remove('hidden');
  ProgressCard.update(card, modelLabProgressSnapshot(run), {
    className: 'model-assessment-progress-card',
    onOpen: function () { setDiagnosticsTab('model-lab', true, run.id); }
  });
  card.querySelector('[data-progress-open]').textContent = 'View probes';
  var wasRunning = diagnosticsAssessmentRunStatus === 'running';
  diagnosticsAssessmentRunStatus = String(run.status);
  diagnosticsEl('diagnostics-assessment-run').disabled = run.status === 'running';
  if (run.status !== 'running' && diagnosticsAssessmentStoppingId === String(run.id)) diagnosticsAssessmentStoppingId = '';
  var stop = diagnosticsEl('diagnostics-assessment-stop');
  stop.disabled = run.status !== 'running' || diagnosticsAssessmentStoppingId === String(run.id);
  stop.textContent = diagnosticsAssessmentStoppingId === String(run.id) ? 'Stopping…' : 'Stop Assessment';
  diagnosticsUpdateAssessmentMetrics(run);
  if (wasRunning && run.status !== 'running') refreshUnifiedModelAssessment().catch(function () {});
}

function diagnosticsAssessmentProgressError(runId, error) {
  if (String(runId) !== diagnosticsAssessmentRunId || diagnosticsActiveTab !== 'assessment' ||
      diagnosticsEl('diagnostics-modal').classList.contains('hidden')) return;
  var card = diagnosticsEl('diagnostics-assessment-activity').querySelector('[data-progress-card-id]');
  if (!card) return;
  card.querySelector('[data-progress-phase]').textContent = 'Progress unavailable · Refresh to reconnect';
  card.querySelector('[data-progress-detail]').textContent = String(error.message || error);
}

function setDiagnosticsTab(tabName, focusTab, modelLabRunId) {
  // Legacy deep links still open their specialist tool panels; only consolidated
  // primary destinations appear in the tab bar.
  var next = ['health', 'assessment', 'h3', 'models', 'benchmark', 'model-lab'].indexOf(tabName) !== -1 ? tabName : 'health';
  diagnosticsActiveTab = next;
  var selectedButton = null;

  Array.prototype.forEach.call(document.querySelectorAll('[data-diagnostics-tab]'), function (button) {
    var active = button.getAttribute('data-diagnostics-tab') === (next === 'models' || next === 'benchmark' ? 'assessment' : next);
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
  if (next === 'model-lab') {
    if (modelLabRunId) modelLabFetch(modelLabRunId).catch(function (error) { reportConsoleError('Model Lab', error); });
    else modelLabRefresh();
  }
  if (focusTab && selectedButton) selectedButton.focus();
}

function selectUnifiedAssessmentModels(select) {
  var selected = diagnosticsAssessmentSelected;
  ['director', 'vision'].forEach(function (kind) {
    selected[kind].clear();
    if (select) {
      var models = diagnosticsAssessmentCatalog[kind === 'director' ? 'directors' : 'visions'] || [];
      models.forEach(function (model) {
        var ref = String(kind === 'director' ? model.id || '' : model.modelRef || '');
        if (ref) selected[kind].add(ref);
      });
    }
  });
  document.querySelectorAll('#diagnostics-assessment-results .model-assessment-row-head input').forEach(function (input) {
    input.checked = select;
  });
  diagnosticsEl('diagnostics-assessment-selection').textContent =
    (selected.director.size + selected.vision.size) + ' model(s) selected · Run Selected Tests starts the server-owned suite.';
}

function refreshUnifiedModelAssessment() {
  var summary = diagnosticsEl('diagnostics-assessment-summary');
  var results = diagnosticsEl('diagnostics-assessment-results');
  if (!summary || !results) throw new Error('Unified assessment markup is missing.');
  summary.textContent = 'Loading model findings…';
  return Promise.all([
    fetch('/fs/storyboard/director').then(function (r) { return r.json().then(function (p) { if (!r.ok || p.ok === false) throw new Error(p.error || 'Director discovery failed.'); return p; }); }),
    fetch('/app/director-model-test').then(function (r) { return r.json().then(function (p) { if (!r.ok || p.ok === false) throw new Error(p.error || 'Director findings failed.'); return p; }); }),
    fetch('/app/model-lab?summary=1').then(function (r) { return r.json().then(function (p) { if (!r.ok || p.ok === false) throw new Error(p.error || 'Model Lab findings failed.'); return p; }); })
  ]).then(function (values) {
    var directors = values[0].models || [];
    var reports = values[1].calibrationReports || [];
    var labRuns = values[2].runs || [];
    var capabilityRuns = values[2].capabilityRuns || [];
    var labModels = values[2].models || {};
    var vision = labModels.visions || [];
    diagnosticsAssessmentCatalog = { directors: directors, visions: vision };
    var activeRun = labRuns.find(function (run) { return run.active || run.status === 'running'; });
    summary.textContent = directors.length + ' Director models · ' + vision.length +
      ' Vision models · ' + labRuns.length + ' Model Lab runs' +
      (activeRun ? ' · Running: ' + activeRun.id + ' (' + activeRun.attemptCount + ' probes recorded)' : '');
    results.replaceChildren();
    var selectedBefore = diagnosticsAssessmentSelected;
    var present = { director: new Set(), vision: new Set() };
    function refreshSelectionSummary() {
      diagnosticsEl('diagnostics-assessment-selection').textContent =
        (diagnosticsAssessmentSelected.director.size + diagnosticsAssessmentSelected.vision.size) +
        ' model(s) selected · Run Selected Tests starts the server-owned suite.';
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
    function addRow(title, kind, ref, report) {
      var row = document.createElement('div');
      row.className = 'model-assessment-row';
      row.dataset.assessmentModel = kind + ':' + ref;
      var heading = document.createElement('strong');
      heading.textContent = title;
      var head = document.createElement('div');
      head.className = 'model-assessment-row-head';
      head.appendChild(heading);
      row.appendChild(head);
      addChoice(head, kind, ref);
      var findings = [];
      var relevant = capabilityRuns.filter(function (run) {
        return run.models && run.models[ref] && Object.keys(run.models[ref]).some(function (key) {
          var visionProbe = ['vision_open', 'vision_group_aware', 'vision_model_error'].indexOf(key) !== -1;
          return kind === 'vision' ? visionProbe : !visionProbe;
        });
      });
      var latest = relevant[0];
      var tests = latest && latest.models[ref] || {};
      var families = kind === 'vision'
        ? [{label:'Open Vision', keys:['vision_open']}, {label:'Annotation-aware Vision', keys:['vision_group_aware']}]
        : [{label:'Writing', keys:['director_writing']},
           {label:'Structured synthesis', keys:['language_synthesis','set_vocabulary_synthesis']},
           {label:'Schema challenge', keys:['language_challenge','set_vocabulary_challenge']}];
      families.forEach(function (family) {
        var entries = family.keys.filter(function (key) { return tests[key]; }).map(function (key) { return tests[key]; });
        var text = 'Not tested';
        if (entries.length) {
          if (entries.some(function (item) { return item.status === 'failed'; })) text = 'Failed';
          else if (entries.some(function (item) { return item.status === 'running'; })) text = 'Running';
          else if (entries.some(function (item) { return item.status === 'skipped'; })) text = 'Skipped';
          else if (entries.every(function (item) { return item.status === 'completed'; })) text = 'Response received';
          else text = 'Incomplete';
        }
        findings.push(family.label + ': ' + text);
      });
      if (kind === 'director' && report) findings.push('Legacy writing assessment: ' + String(report.health || report.status || 'recorded'));
      var metrics = document.createElement('div');
      metrics.className = 'model-assessment-metrics';
      function metric(label, value, hint) {
        var cell = document.createElement('div');
        cell.className = 'model-assessment-metric';
        var name = document.createElement('small');
        name.textContent = label;
        var data = document.createElement('strong');
        data.textContent = value;
        if (hint) data.title = hint;
        cell.appendChild(name);
        cell.appendChild(data);
        metrics.appendChild(cell);
        return data;
      }
      var attempts = report && Array.isArray(report.attempts) ? report.attempts : [];
      var measured = attempts.filter(function (attempt) {
        return attempt.status === 'passed' && Number(attempt.tokensPerSecond) > 0;
      });
      var speed = measured.length ? Number(measured[measured.length - 1].tokensPerSecond).toFixed(1) + ' tok/s' : '—';
      var abilities = report && report.abilities || {};
      var output = Number(abilities.coherentOutputTokens || 0);
      var quality = kind === 'director' && report ? String(report.health || report.status || 'Recorded') : '—';
      var samples = Object.keys(tests).filter(function (key) {
        return kind === 'vision' ? key === 'vision_open' || key === 'vision_group_aware' : key === 'director_writing';
      }).map(function (key) { return tests[key].measurement; }).filter(Boolean).sort(function (a, b) {
        return Date.parse(b.finishedAt) - Date.parse(a.finishedAt);
      });
      var probe = samples.length ? diagnosticsProbeMetrics(samples[0]) : null;
      var speedMetric = metric('Speed', probe && probe.speed > 0 ? probe.speed.toFixed(1) + ' tok/s' : speed,
        probe ? probe.hint : 'Measured from saved Director assessment probe, not a model-wide speed guarantee');
      speedMetric.setAttribute('data-assessment-speed', '');
      var outputMetric = metric('Output observed', probe ? probe.tokens.toLocaleString() + ' tokens' : output > 0 ? output.toLocaleString() + ' tokens' : '—',
        'Latest measured probe token count; may include provider reasoning. Not a verified maximum or a quality score.');
      outputMetric.setAttribute('data-assessment-output', '');
      var primary = findings[0] || 'Not tested';
      metric(kind === 'vision' ? 'Vision' : 'Writing', primary.split(': ').slice(1).join(': ') || 'Not tested').setAttribute('data-assessment-primary', '');
      metric('Assessment', latest ? latest.status || 'Recorded' : quality === '—' ? 'Not tested' : quality).setAttribute('data-assessment-state', '');
      row.appendChild(metrics);
      var details = document.createElement('details');
      var caption = document.createElement('summary');
      caption.textContent = 'More capabilities, limits and evidence';
      details.appendChild(caption);
      var provenance = document.createElement('div');
      provenance.className = 'app-settings-help';
      provenance.setAttribute('data-assessment-provenance', '');
      provenance.textContent = latest
        ? 'Latest matching Model Lab run: ' + latest.id + ' · ' + (latest.status || 'unknown') +
          (latest.startedAt ? ' · ' + latest.startedAt : '')
        : 'No saved Model Lab evidence for this model.';
      details.appendChild(provenance);
      if (latest && latest.importedFrom) {
        provenance.textContent += ' · Imported from ' + latest.importedFrom.host + ' (measurements from source runtime)';
      }
      if (report && report.importedFrom) {
        provenance.textContent += ' · Legacy report imported from ' + report.importedFrom.host + ' (source runtime measurements)';
      }
      var other = document.createElement('div');
      other.className = 'app-settings-help';
      other.setAttribute('data-assessment-capabilities', '');
      other.textContent = findings.join(' · ') + ' · Context limit: not established by this assessment';
      details.appendChild(other);
      Object.keys(tests).forEach(function (key) {
        var line = document.createElement('div');
        line.className = 'app-settings-help';
        line.setAttribute('data-assessment-initial-evidence', '');
        var item = tests[key];
        var counts = Object.keys(item.counts || {}).map(function (status) { return item.counts[status] + ' ' + status; }).join(', ');
        line.textContent = key + ': ' + (counts || item.status) + (item.error ? ' · ' + item.error : '');
        details.appendChild(line);
      });
      row.appendChild(details);
      results.appendChild(row);
    }
    directors.forEach(function (model) {
      var ref = String(model.id || '');
      var report = reports.find(function (entry) { return String(entry.modelRef || '') === ref; });
      addRow(String(model.label || model.modelId || ref), 'director', ref, report);
    });
    vision.forEach(function (model) {
      var ref = String(model.modelRef || '');
      addRow(String(model.label || model.modelId || ref), 'vision', ref, null);
    });
    ['director', 'vision'].forEach(function (kind) {
      diagnosticsAssessmentSelected[kind].forEach(function (ref) {
        if (!present[kind].has(ref)) diagnosticsAssessmentSelected[kind].delete(ref);
      });
    });
    refreshSelectionSummary();
    var followed = activeRun || labRuns[0];
    if (followed) {
      if (diagnosticsAssessmentRunId !== String(followed.id)) diagnosticsAssessmentRunStatus = '';
      diagnosticsAssessmentRunId = String(followed.id);
      modelLabPublishProgress(followed);
      modelLabSchedulePoll();
    } else {
      diagnosticsAssessmentRunId = ''; diagnosticsAssessmentRunStatus = '';
      diagnosticsEl('diagnostics-assessment-activity').classList.add('hidden');
      diagnosticsEl('diagnostics-assessment-run').disabled = false;
      diagnosticsEl('diagnostics-assessment-stop').disabled = true;
    }
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
  if (!canLab) throw new Error('Open a Set with at least two media items to run the assessment.');
  status.textContent = 'Starting standard assessment…';
  var runButton = diagnosticsEl('diagnostics-assessment-run');
  runButton.disabled = true;
  return Promise.resolve().then(function () {

    // The server owns active-run admission; a cached historical preview must
    // not block a new assessment after its worker has already failed.
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
      diagnosticsAssessmentRunId = String(payload.run.id);
      diagnosticsAssessmentRunStatus = '';
      modelLabState.run = payload.run;
      modelLabState.runs = payload.runs || modelLabState.runs;
      modelLabRender();
      modelLabSchedulePoll();
      if (payload.run.status === 'error' || payload.run.status === 'interrupted') {
        throw new Error(payload.run.error || 'Assessment failed before probes could complete.');
      }
      diagnosticsEl('diagnostics-assessment-summary').textContent = 'Live assessment progress · findings update when the run finishes.';
      reportConsoleInfo('Model Assessment', 'Started persistent Model Lab run ' + payload.run.id + '.');
      return payload.run;
    });
  }).then(function (labRun) {
    status.textContent = labRun.status === 'running'
      ? 'Assessment running. You may close Diagnostics.'
      : 'Assessment ' + String(labRun.status) + '.';
  }).catch(function (error) {
    status.textContent = 'Assessment could not complete: ' + String(error.message || error);
    reportConsoleError('Model Assessment', error);
    throw error;
  }).finally(function () {
    runButton.disabled = diagnosticsAssessmentRunStatus === 'running';
  });
}

async function stopUnifiedModelAssessment() {
  var runId = diagnosticsAssessmentRunId;
  if (!runId || diagnosticsAssessmentRunStatus !== 'running' || diagnosticsAssessmentStoppingId === runId) return;
  var button = diagnosticsEl('diagnostics-assessment-stop');
  diagnosticsAssessmentStoppingId = runId;
  button.disabled = true; button.textContent = 'Stopping…';
  try {
    var payload = await modelLabPost({action: 'stop', runId: runId});
    modelLabState.runs = payload.runs || modelLabState.runs;
    modelLabPublishProgress(payload.run);
    modelLabSchedulePoll();
    diagnosticsEl('diagnostics-assessment-selection').textContent = payload.run.status === 'running'
      ? 'Stop requested. Cancelling the current probe; completed results are preserved.'
      : 'Assessment stopped. Completed results are preserved.';
  } catch (error) {
    diagnosticsAssessmentStoppingId = '';
    button.disabled = diagnosticsAssessmentRunStatus !== 'running'; button.textContent = 'Stop Assessment';
    diagnosticsEl('diagnostics-assessment-selection').textContent = 'Could not stop assessment: ' + String(error.message || error);
    reportConsoleError('Model Assessment', error);
  }
}

var diagnosticsAssessmentImportBundle = null;

function diagnosticsAssessmentTransferError(error) {
  diagnosticsEl('diagnostics-assessment-transfer-status').textContent = String(error.message || error);
  reportConsoleError('Assessment transfer', error);
}

async function exportAssessmentResults() {
  try {
    var bundle = await modelLabRequest('/app/model-lab?export=1');
    var url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], {type: 'application/json'}));
    var link = document.createElement('a');
    link.href = url; link.download = 'webcap-assessments-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    diagnosticsEl('diagnostics-assessment-transfer-status').textContent =
      'Exported ' + bundle.runs.length + ' runs and ' + bundle.reports.length + ' reports.' +
      (bundle.activeRunsExcluded ? ' Running assessments are excluded; export again when they finish.' : '');
  } catch (error) { diagnosticsAssessmentTransferError(error); }
}

async function previewAssessmentImport(file) {
  diagnosticsAssessmentImportBundle = null;
  diagnosticsEl('diagnostics-assessment-transfer').classList.add('hidden');
  if (!file) return;
  try {
    var bundle = JSON.parse(await file.text());
    if (bundle.format !== 'webcap-assessments' || bundle.version !== 1 || !Array.isArray(bundle.runs) || !Array.isArray(bundle.reports)) {
      throw new Error('Choose a WebCap assessment export (version 1).');
    }
    var catalog = (await modelLabRequest('/app/model-lab')).models;
    var targets = new Map();
    (catalog.directors || []).concat(catalog.visions || []).forEach(function (model) {
      targets.set(model.runtimeId, model.runtimeName || model.runtimeId);
    });
    var sources = new Set();
    bundle.runs.forEach(function (run) {
      (run.attempts || []).forEach(function (attempt) { sources.add(String(attempt.modelRef).split('::')[0]); });
      ['visionModels', 'directorModels', 'allVisionModels', 'allDirectorModels'].forEach(function (field) {
        (run[field] || []).forEach(function (model) { sources.add(String(model.modelRef).split('::')[0]); });
      });
    });
    bundle.reports.forEach(function (report) { sources.add(String(report.modelRef).split('::')[0]); });
    var host = diagnosticsEl('diagnostics-assessment-runtime-map');
    host.replaceChildren();
    sources.forEach(function (source) {
      var label = document.createElement('label');
      label.textContent = source + ' → ';
      var select = document.createElement('select');
      select.dataset.sourceRuntime = source;
      select.setAttribute('aria-label', 'Destination runtime for ' + source);
      var placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose runtime…'; select.appendChild(placeholder);
      targets.forEach(function (name, id) {
        var option = document.createElement('option'); option.value = id; option.textContent = name + ' (' + id + ')'; select.appendChild(option);
      });
      label.appendChild(select); host.appendChild(label);
    });
    diagnosticsAssessmentImportBundle = bundle;
    diagnosticsEl('diagnostics-assessment-transfer-copy').textContent = bundle.runs.length + ' runs · ' + bundle.reports.length +
      ' reports · Exported from ' + bundle.sourceHost + ' · ' + bundle.exportedAt;
    diagnosticsEl('diagnostics-assessment-transfer').classList.remove('hidden');
    diagnosticsEl('diagnostics-assessment-transfer-status').textContent = '';
  } catch (error) { diagnosticsAssessmentTransferError(error); }
}

async function importAssessmentResults() {
  var runtimeMap = {};
  var choices = diagnosticsEl('diagnostics-assessment-runtime-map').querySelectorAll('select');
  for (var select of choices) {
    if (!select.value) {
      diagnosticsEl('diagnostics-assessment-transfer-status').textContent = 'Choose a destination for each source runtime.';
      select.focus(); return;
    }
    runtimeMap[select.dataset.sourceRuntime] = select.value;
  }
  var button = diagnosticsEl('diagnostics-assessment-import-apply'); button.disabled = true;
  try {
    var result = await modelLabPost({action: 'import', bundle: diagnosticsAssessmentImportBundle, runtimeMap: runtimeMap});
    diagnosticsEl('diagnostics-assessment-transfer-status').textContent = 'Imported ' + result.runsImported + ' runs and ' + result.reportsImported +
      ' reports · ' + result.runsAlreadyPresent + ' runs already present.';
    diagnosticsAssessmentImportBundle = null;
    diagnosticsEl('diagnostics-assessment-transfer').classList.add('hidden');
    await refreshUnifiedModelAssessment();
  } catch (error) { diagnosticsAssessmentTransferError(error); }
  finally { button.disabled = false; }
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
  diagnosticsEl('diagnostics-assessment-all').onclick = function () { selectUnifiedAssessmentModels(true); };
  diagnosticsEl('diagnostics-assessment-none').onclick = function () { selectUnifiedAssessmentModels(false); };
  diagnosticsEl('diagnostics-assessment-run').onclick = function () {
    try {
      Promise.resolve(runUnifiedModelAssessment()).catch(function (error) {
        diagnosticsEl('diagnostics-assessment-selection').textContent =
          'Assessment failed: ' + String(error.message || error);
        reportConsoleError('Model Assessment', error);
      });
    } catch (error) {
      diagnosticsEl('diagnostics-assessment-selection').textContent =
        'Cannot start assessment: ' + String(error.message || error);
      reportConsoleError('Model Assessment', error);
    }
  };
  diagnosticsEl('diagnostics-assessment-refresh').onclick = function () { refreshUnifiedModelAssessment().catch(function () {}); };
  diagnosticsEl('diagnostics-assessment-stop').onclick = stopUnifiedModelAssessment;
  diagnosticsEl('diagnostics-assessment-export').onclick = exportAssessmentResults;
  diagnosticsEl('diagnostics-assessment-import').onclick = function () { diagnosticsEl('diagnostics-assessment-file').click(); };
  diagnosticsEl('diagnostics-assessment-file').onchange = function () { previewAssessmentImport(this.files[0]); this.value = ''; };
  diagnosticsEl('diagnostics-assessment-import-apply').onclick = importAssessmentResults;
  diagnosticsEl('diagnostics-assessment-import-cancel').onclick = function () {
    diagnosticsAssessmentImportBundle = null; diagnosticsEl('diagnostics-assessment-transfer').classList.add('hidden');
  };
  diagnosticsEl('diagnostics-assessment-director').onclick = function () { setDiagnosticsTab('models', true); };
  diagnosticsEl('diagnostics-assessment-lab').onclick = function () { setDiagnosticsTab('model-lab', true); };
  diagnosticsEl('diagnostics-assessment-benchmark').onclick = function () { setDiagnosticsTab('benchmark', true); };

  Array.prototype.forEach.call(document.querySelectorAll('[data-diagnostics-tab]'), function (button) {
    button.onclick = function () {
      setDiagnosticsTab(button.getAttribute('data-diagnostics-tab'), false);
    };
    button.onkeydown = function (event) {
      var tabs = ['health', 'assessment', 'h3', 'model-lab'];
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
