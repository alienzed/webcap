var modelLabState = {
  loaded: false,
  polling: 0,
  models: { visions: [], directors: [] },
  runs: [],
  run: null
};

function modelLabEl(id) {
  var node = document.getElementById(id);
  if (!node) throw new Error('Model Lab control is missing: ' + id);
  return node;
}

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

function modelLabModelMap(models) {
  var out = {};
  (models || []).forEach(function (model) {
    out[String(model.modelRef || '')] = model;
  });
  return out;
}

function modelLabRenderModelList(hostId, models, role) {
  var host = modelLabEl(hostId);
  var checked = {};
  Array.prototype.forEach.call(host.querySelectorAll('input[type="checkbox"]:checked'), function (input) {
    checked[input.value] = true;
  });
  host.innerHTML = '';
  if (!models.length) {
    host.innerHTML = '<p class="app-settings-help">No ' + escapeHtml(role) + ' models available.</p>';
    return;
  }
  models.forEach(function (model) {
    var label = document.createElement('label');
    label.className = 'director-model-test-model-row';
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.value = String(model.modelRef || '');
    input.setAttribute('data-model-lab-' + role.toLowerCase() + '-model', '');
    input.checked = Object.keys(checked).length ? !!checked[input.value] : true;
    var copy = document.createElement('span');
    copy.innerHTML = '<strong>' + escapeHtml(model.label || model.modelId || model.modelRef) + '</strong>' +
      '<small>' + escapeHtml(model.runtimeName || model.runtimeId || 'runtime') + '</small>';
    label.appendChild(input);
    label.appendChild(copy);
    host.appendChild(label);
  });
}

function modelLabRenderReferenceSelect(id, models, preferred) {
  var select = modelLabEl(id);
  var current = String(select.value || preferred || '');
  select.innerHTML = '<option value="">None</option>';
  (models || []).forEach(function (model) {
    var option = document.createElement('option');
    option.value = String(model.modelRef || '');
    option.textContent = String(model.label || model.modelId || model.modelRef) +
      ' · ' + String(model.runtimeName || model.runtimeId || 'runtime');
    select.appendChild(option);
  });
  if (current && Array.prototype.some.call(select.options, function (option) { return option.value === current; })) {
    select.value = current;
  } else if (models.length) {
    select.value = String(models[0].modelRef || '');
  }
}

function modelLabSelectedModels(selector, models) {
  var byRef = modelLabModelMap(models);
  return Array.prototype.map.call(document.querySelectorAll(selector + ':checked'), function (input) {
    return byRef[String(input.value || '')];
  }).filter(Boolean);
}

function modelLabAttemptLabel(kind) {
  var labels = {
    vision_open: 'Open Vision',
    vision_group_aware: 'Group-aware Vision',
    language_synthesis: 'Language synthesis',
    language_challenge: 'Language challenge',
    set_vocabulary_synthesis: 'Set vocabulary synthesis',
    set_vocabulary_challenge: 'Set vocabulary challenge'
  };
  if (labels[kind]) return labels[kind];
  if (String(kind || '').indexOf('vision:') === 0) {
    return String(kind).endsWith('_challenge') ? 'Vision vocabulary challenge' : 'Vision vocabulary synthesis';
  }
  return String(kind || '').replace(/_/g, ' ');
}

function modelLabRunProgress(run) {
  var summary = run && run.summary || {};
  var completed = Number(summary.completed || 0);
  var failed = Number(summary.failed || 0);
  var skipped = Number(summary.skipped || 0);
  var interrupted = Number(summary.interrupted || 0);
  var bits = [completed + ' completed'];
  if (failed) bits.push(failed + ' failed');
  if (skipped) bits.push(skipped + ' skipped');
  if (interrupted) bits.push(interrupted + ' interrupted');
  return bits.join(' · ');
}

function modelLabRenderRun() {
  var run = modelLabState.run;
  var results = modelLabEl('model-lab-results');
  var activity = modelLabEl('model-lab-activity');
  var badge = modelLabEl('model-lab-summary-status');
  var stop = modelLabEl('model-lab-stop');
  var resume = modelLabEl('model-lab-resume');
  var runBtn = modelLabEl('model-lab-run');

  if (!run) {
    results.innerHTML = '<p class="app-settings-help">No Model Lab run selected.</p>';
    activity.textContent = '';
    badge.textContent = 'Ready';
    badge.dataset.state = 'ready';
    stop.classList.add('hidden');
    resume.classList.add('hidden');
    runBtn.disabled = false;
    return;
  }

  var status = String(run.status || '');
  badge.textContent = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
  badge.dataset.state = status === 'completed' ? 'complete' : (status === 'running' ? 'running' : (status === 'error' ? 'error' : 'stopped'));
  stop.classList.toggle('hidden', status !== 'running');
  resume.classList.toggle('hidden', ['stopped', 'interrupted', 'error'].indexOf(status) === -1);
  runBtn.disabled = status === 'running';

  var progress = run.progress || {};
  activity.textContent = status === 'running'
    ? [
        progress.phase ? ('Phase: ' + progress.phase) : '',
        progress.currentModelRef ? ('Model: ' + progress.currentModelRef) : '',
        progress.currentFile ? ('File: ' + progress.currentFile) : '',
        progress.currentKind ? ('Probe: ' + modelLabAttemptLabel(progress.currentKind)) : '',
        modelLabRunProgress(run)
      ].filter(Boolean).join(' · ')
    : modelLabRunProgress(run);

  var attempts = Array.isArray(run.attempts) ? run.attempts : [];
  if (!attempts.length) {
    results.innerHTML = '<p class="app-settings-help">Run started. Waiting for the first probe result.</p>';
    return;
  }

  var grouped = {};
  attempts.forEach(function (attempt) {
    var modelRef = String(attempt.modelRef || 'unknown');
    if (!grouped[modelRef]) grouped[modelRef] = [];
    grouped[modelRef].push(attempt);
  });

  results.innerHTML = Object.keys(grouped).map(function (modelRef) {
    var rows = grouped[modelRef];
    var complete = rows.filter(function (row) { return row.status === 'completed'; }).length;
    var failed = rows.filter(function (row) { return row.status === 'failed'; }).length;
    var skipped = rows.filter(function (row) { return row.status === 'skipped'; }).length;
    var details = rows.map(function (row) {
      var state = String(row.status || '');
      var error = row.error ? (' — ' + escapeHtml(row.error)) : '';
      var file = row.file ? (' · ' + escapeHtml(row.file)) : '';
      var raw = row.result && Object.keys(row.result).length
        ? '<details><summary>Evidence</summary><pre>' + escapeHtml(JSON.stringify(row.result, null, 2)) + '</pre></details>'
        : '';
      return '<div class="model-lab-attempt model-lab-attempt-' + escapeHtml(state) + '">' +
        '<strong>' + escapeHtml(modelLabAttemptLabel(row.kind)) + '</strong>' +
        '<span>' + escapeHtml(state) + file + error + '</span>' + raw + '</div>';
    }).join('');
    return '<details class="model-lab-model-result" ' + (failed ? 'open' : '') + '>' +
      '<summary><strong>' + escapeHtml(modelRef) + '</strong><span>' +
      complete + ' complete' + (failed ? (' · ' + failed + ' failed') : '') + (skipped ? (' · ' + skipped + ' skipped') : '') +
      '</span></summary><div class="app-settings-disclosure-body">' + details + '</div></details>';
  }).join('');
}

function modelLabRenderHistory() {
  var host = modelLabEl('model-lab-history');
  if (!modelLabState.runs.length) {
    host.innerHTML = '<p class="app-settings-help">No Model Lab runs yet.</p>';
    return;
  }
  host.innerHTML = modelLabState.runs.map(function (run) {
    return '<button type="button" class="model-lab-history-row" data-model-lab-run="' + escapeHtml(run.id) + '">' +
      '<strong>' + escapeHtml(run.folder || 'Set') + '</strong>' +
      '<span>' + escapeHtml(run.status || '') + ' · ' + escapeHtml(run.startedAt || '') + ' · ' +
      Number(run.attemptCount || 0) + ' probes</span></button>';
  }).join('');
}

function modelLabRenderSource() {
  var files = modelLabCurrentFiles();
  var folder = String(state && state.folder || '').trim();
  modelLabEl('model-lab-source').textContent = folder
    ? (folder + ' · ' + String(files.length) + ' media available · representative sampling is deterministic')
    : 'Open a Set before starting Model Lab.';
  modelLabEl('model-lab-run').disabled = !folder || files.length < 2 || (modelLabState.run && modelLabState.run.status === 'running');
}

function modelLabRender() {
  modelLabRenderSource();
  modelLabRenderModelList('model-lab-vision-models', modelLabState.models.visions || [], 'Vision');
  modelLabRenderModelList('model-lab-director-models', modelLabState.models.directors || [], 'Director');
  modelLabRenderReferenceSelect('model-lab-reference-vision', modelLabState.models.visions || [], '');
  modelLabRenderReferenceSelect('model-lab-reference-director', modelLabState.models.directors || [], '');
  modelLabRenderRun();
  modelLabRenderHistory();
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
    modelLabRender();
    modelLabSchedulePoll();
    return payload;
  });
}

function modelLabSchedulePoll() {
  if (modelLabState.polling) {
    window.clearTimeout(modelLabState.polling);
    modelLabState.polling = 0;
  }
  if (!modelLabState.run || modelLabState.run.status !== 'running') return;
  modelLabState.polling = window.setTimeout(function () {
    modelLabState.polling = 0;
    modelLabFetch(modelLabState.run.id).catch(function (error) {
      reportConsoleError('Model Lab', error);
    });
  }, 1500);
}

function modelLabRefresh() {
  var runId = modelLabState.run ? String(modelLabState.run.id || '') : '';
  return modelLabFetch(runId).catch(function (error) {
    reportConsoleError('Model Lab', error);
    modelLabEl('model-lab-activity').textContent = 'Could not refresh Model Lab. See Console.';
    throw error;
  });
}

function modelLabFindModel(models, ref) {
  ref = String(ref || '');
  return (models || []).find(function (model) { return String(model.modelRef || '') === ref; }) || null;
}

function modelLabStart() {
  var visionModels = modelLabSelectedModels('[data-model-lab-vision-model]', modelLabState.models.visions || []);
  var directorModels = modelLabSelectedModels('[data-model-lab-director-model]', modelLabState.models.directors || []);
  if (!visionModels.length && !directorModels.length) {
    modelLabEl('model-lab-activity').textContent = 'Choose at least one Vision or Director model.';
    return;
  }

  var folder = String(state && state.folder || '').trim();
  var files = modelLabCurrentFiles();
  if (!folder || files.length < 2) {
    modelLabEl('model-lab-activity').textContent = 'Open a Set with at least two supported media items.';
    return;
  }

  var referenceVisionRef = String(modelLabEl('model-lab-reference-vision').value || '');
  var referenceDirectorRef = String(modelLabEl('model-lab-reference-director').value || '');
  var sampleCount = Math.max(2, Math.min(24, Number(modelLabEl('model-lab-sample-count').value || 8)));

  modelLabEl('model-lab-activity').textContent = 'Starting persistent Model Lab run…';
  modelLabPost({
    action: 'start',
    config: {
      folder: folder,
      files: files,
      groups: modelLabGroups(),
      sampleCount: sampleCount,
      visionModels: visionModels,
      directorModels: directorModels,
      referenceVisionRef: referenceVisionRef,
      referenceDirectorRef: referenceDirectorRef,
      referenceVision: modelLabFindModel(modelLabState.models.visions, referenceVisionRef),
      referenceDirector: modelLabFindModel(modelLabState.models.directors, referenceDirectorRef)
    }
  }).then(function (payload) {
    modelLabState.run = payload.run;
    modelLabState.runs = payload.runs || modelLabState.runs;
    reportConsoleInfo('Model Lab', 'Persistent diagnostics run started. You may close Diagnostics; the server owns the run.');
    modelLabRender();
    modelLabSchedulePoll();
  }).catch(function (error) {
    reportConsoleError('Model Lab', error);
    modelLabEl('model-lab-activity').textContent = 'Could not start Model Lab. See Console.';
  });
}

function modelLabStop() {
  if (!modelLabState.run) return;
  modelLabPost({ action: 'stop', runId: modelLabState.run.id }).then(function (payload) {
    modelLabState.run = payload.run;
    modelLabState.runs = payload.runs || modelLabState.runs;
    modelLabRender();
    modelLabSchedulePoll();
  }).catch(function (error) {
    reportConsoleError('Model Lab', error);
  });
}

function modelLabResume() {
  if (!modelLabState.run) return;
  modelLabPost({ action: 'resume', runId: modelLabState.run.id }).then(function (payload) {
    modelLabState.run = payload.run;
    modelLabState.runs = payload.runs || modelLabState.runs;
    reportConsoleInfo('Model Lab', 'Diagnostics run resumed from completed probe journal.');
    modelLabRender();
    modelLabSchedulePoll();
  }).catch(function (error) {
    reportConsoleError('Model Lab', error);
  });
}

function modelLabSetAll(role, checked) {
  Array.prototype.forEach.call(document.querySelectorAll('[data-model-lab-' + role + '-model]'), function (input) {
    input.checked = !!checked;
  });
}

function initializeModelLab() {
  modelLabEl('model-lab-run').addEventListener('click', modelLabStart);
  modelLabEl('model-lab-stop').addEventListener('click', modelLabStop);
  modelLabEl('model-lab-resume').addEventListener('click', modelLabResume);
  modelLabEl('model-lab-refresh').addEventListener('click', modelLabRefresh);
  modelLabEl('model-lab-vision-all').addEventListener('click', function () { modelLabSetAll('vision', true); });
  modelLabEl('model-lab-director-all').addEventListener('click', function () { modelLabSetAll('director', true); });
  modelLabEl('model-lab-history').addEventListener('click', function (event) {
    var row = event.target.closest('[data-model-lab-run]');
    if (!row) return;
    modelLabFetch(row.getAttribute('data-model-lab-run')).catch(function (error) {
      reportConsoleError('Model Lab', error);
    });
  });
  modelLabRenderSource();
  modelLabRenderRun();
  modelLabRenderHistory();
}

initializeModelLab();
