function getPruneCandidateLookup() {
  return (state.pruneCandidateLookup && typeof state.pruneCandidateLookup === 'object')
    ? state.pruneCandidateLookup
    : {};
}

function isPruneCandidateFile(fileName) {
  if (state.pruneCandidatesStatus !== 'ready') return false;
  return !!getPruneCandidateLookup()[String(fileName || '')];
}

function getPruneCandidateFiles(scopeItems) {
  var lookup = getPruneCandidateLookup();
  var items = Array.isArray(scopeItems) ? scopeItems : (state.items || []);
  return items
    .map(function (item) { return String(item && (item.fileName || item.key) || ''); })
    .filter(function (fileName) { return !!lookup[fileName]; });
}

function syncPruneCandidateConsumers() {
  var ready = state.pruneCandidatesStatus === 'ready';
  var loading = state.pruneCandidatesStatus === 'loading';
  ui.advancedFilterPruneCandidatesEl.disabled = !ready;
  ui.advancedFilterPruneCandidatesEl.title = loading
    ? 'Prune candidate analysis is loading.'
    : (state.pruneCandidatesStatus === 'error'
      ? 'Prune candidate analysis failed: ' + String(state.pruneCandidatesError || 'unknown error')
      : 'Show whole-set prune candidates.');
  renderFocusSetControls();
  if (mediaGridState && mediaGridState.open) {
    if (mediaGridIsSurfaceMode()) renderMediaGridSurface();
    else renderMediaGridModal();
  }
}

function resetPruneCandidateState(status) {
  state.pruneCandidates = [];
  state.pruneCandidateLookup = {};
  state.pruneCandidatesFolder = String(state.folder || '');
  state.pruneCandidatesStatus = status || 'idle';
  state.pruneCandidatesError = '';
  state.pruneCandidatesPopulation = 0;
  state.pruneCandidatesDirty = false;
  syncPruneCandidateConsumers();
}

function invalidatePruneCandidates() {
  state.pruneCandidatesSeq = Number(state.pruneCandidatesSeq || 0) + 1;
  resetPruneCandidateState('idle');
}

function applyPruneCandidatePayload(folder, payload) {
  if (!payload || !Array.isArray(payload.candidates)) throw new Error('Malformed prune candidate response.');
  var lookup = {};
  payload.candidates.forEach(function (candidate) {
    var fileName = String(candidate && candidate.file || '').trim();
    if (fileName) lookup[fileName] = candidate;
  });
  state.pruneCandidates = payload.candidates.slice();
  state.pruneCandidateLookup = lookup;
  state.pruneCandidatesFolder = folder;
  state.pruneCandidatesPopulation = Number(payload.population_count || 0);
  state.pruneCandidatesStatus = 'ready';
  state.pruneCandidatesError = '';
  state.pruneCandidatesDirty = false;
  syncPruneCandidateConsumers();
  if (ui.advancedFilterPruneCandidatesEl.checked) {
    renderFileList();
  }
}

function ensurePruneCandidatesForCurrentFolder(force) {
  var folder = String(state.folder || '').trim();
  if (!folder || !Array.isArray(state.items) || !state.items.length) {
    resetPruneCandidateState('ready');
    return Promise.resolve([]);
  }
  if (!force && !state.pruneCandidatesDirty && state.pruneCandidatesFolder === folder && state.pruneCandidatesStatus === 'ready') {
    return Promise.resolve(state.pruneCandidates.slice());
  }
  if (!force && state.pruneCandidatesFolder === folder && state.pruneCandidatesStatus === 'loading') {
    return Promise.resolve([]);
  }
  var seq = Number(state.pruneCandidatesSeq || 0) + 1;
  state.pruneCandidatesSeq = seq;
  state.pruneCandidatesFolder = folder;
  state.pruneCandidatesStatus = 'loading';
  state.pruneCandidatesError = '';
  syncPruneCandidateConsumers();
  return fetch('/fs/prune_candidates?folder=' + encodeURIComponent(folder))
    .then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok) throw new Error((payload && payload.error) || ('Prune candidate request failed (' + response.status + ')'));
        return payload;
      });
    })
    .then(function (payload) {
      if (state.folder !== folder || state.pruneCandidatesSeq !== seq) return [];
      applyPruneCandidatePayload(folder, payload);
      return state.pruneCandidates.slice();
    })
    .catch(function (err) {
      if (state.folder !== folder || state.pruneCandidatesSeq !== seq) return [];
      state.pruneCandidates = [];
      state.pruneCandidateLookup = {};
      state.pruneCandidatesStatus = 'error';
      state.pruneCandidatesError = String(err && err.message ? err.message : err);
      syncPruneCandidateConsumers();
      setStatus('Prune candidate analysis failed: ' + state.pruneCandidatesError);
      throw err;
    });
}

function removePruneCandidateFile(fileName) {
  var target = String(fileName || '');
  if (!target) return;
  state.pruneCandidates = (state.pruneCandidates || []).filter(function (candidate) {
    return String(candidate && candidate.file || '') !== target;
  });
  delete state.pruneCandidateLookup[target];
  state.pruneCandidatesPopulation = Math.max(0, Number(state.pruneCandidatesPopulation || 0) - 1);
  state.pruneCandidatesDirty = true;
  syncPruneCandidateConsumers();
}

function appendPruneCandidateContext(container, candidate) {
  var context = candidate && candidate.context && typeof candidate.context === 'object' ? candidate.context : {};
  var values = [];
  var scene = context.scene_complexity;
  var face = context.face_focus;
  var pose = context.selection_pose;
  if (scene && scene.bucket) values.push('Scene: ' + scene.bucket + (isFinite(Number(scene.score)) ? ' ' + Math.round(Number(scene.score) * 100) + '%' : ''));
  if (face && face.bucket) values.push('Face: ' + face.bucket + ' · ' + Number(face.face_count || 0));
  if (pose && pose.pose_class && pose.pose_class !== 'unknown') values.push('Pose: ' + pose.pose_class);
  if (context.fps) values.push('FPS: ' + Number(context.fps).toFixed(2));
  if (context.duration) values.push('Duration: ' + Number(context.duration).toFixed(2) + 's');
  if (context.codec) values.push('Codec: ' + context.codec);
  if (context.rating) values.push('Rating: ' + context.rating + '/5');
  if (context.flag) values.push('Flag: ' + context.flag);
  if (!values.length) return;
  var row = document.createElement('div');
  row.className = 'prune-candidate-context';
  values.forEach(function (value) {
    var chip = document.createElement('span');
    chip.textContent = value;
    row.appendChild(chip);
  });
  container.appendChild(row);
}

function inspectPruneCandidates(startFile) {
  var files = getPruneCandidateFiles();
  if (!files.length) {
    setStatus('No prune candidates to inspect.');
    return;
  }
  var selected = String(startFile || files[0]);
  selectByFileName(selected, files, 'Prune Candidates', 'pruneCandidates');
}

function renderPruneCandidatesReport() {
  ui.pruneCandidatesListEl.innerHTML = '';
  var status = state.pruneCandidatesStatus;
  var candidates = Array.isArray(state.pruneCandidates) ? state.pruneCandidates : [];
  ui.pruneCandidatesInspectBtn.disabled = status !== 'ready' || !candidates.length;
  if (status === 'loading') {
    ui.pruneCandidatesSummaryEl.textContent = 'Analyzing the whole set...';
    return;
  }
  if (status === 'error') {
    ui.pruneCandidatesSummaryEl.textContent = 'Analysis failed.';
    var error = document.createElement('div');
    error.className = 'prune-candidates-empty prune-candidates-error';
    error.textContent = state.pruneCandidatesError || 'Unknown prune candidate error.';
    ui.pruneCandidatesListEl.appendChild(error);
    var retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'review-captions-btn';
    retry.textContent = 'Retry Analysis';
    retry.onclick = function () {
      ensurePruneCandidatesForCurrentFolder(true).then(renderPruneCandidatesReport).catch(renderPruneCandidatesReport);
    };
    ui.pruneCandidatesListEl.appendChild(retry);
    return;
  }
  ui.pruneCandidatesSummaryEl.textContent = candidates.length + ' of ' + Number(state.pruneCandidatesPopulation || 0) + ' media item' + (Number(state.pruneCandidatesPopulation || 0) === 1 ? '' : 's') + ' flagged.';
  if (!candidates.length) {
    var empty = document.createElement('div');
    empty.className = 'prune-candidates-empty';
    empty.textContent = 'No technical prune candidates found.';
    ui.pruneCandidatesListEl.appendChild(empty);
    return;
  }
  candidates.forEach(function (candidate) {
    var card = document.createElement('button');
    card.type = 'button';
    card.className = 'prune-candidate-card prune-candidate-card--' + String(candidate.priority || 'outlier');
    card.onclick = function () { inspectPruneCandidates(candidate.file); };
    var header = document.createElement('div');
    header.className = 'prune-candidate-header';
    var name = document.createElement('strong');
    name.textContent = String(candidate.file || 'Unknown media');
    var priority = document.createElement('span');
    priority.className = 'prune-candidate-priority';
    priority.textContent = candidate.priority === 'blocking' ? 'Blocking' : 'Outlier';
    header.appendChild(name);
    header.appendChild(priority);
    card.appendChild(header);
    var metrics = candidate.metrics || {};
    var meta = document.createElement('div');
    meta.className = 'prune-candidate-meta';
    meta.textContent = [candidate.kind, metrics.resolution, metrics.aspect_bucket].filter(Boolean).join(' · ');
    card.appendChild(meta);
    var reasons = document.createElement('ul');
    reasons.className = 'prune-candidate-reasons';
    (candidate.reasons || []).forEach(function (reason) {
      var item = document.createElement('li');
      item.textContent = String(reason && reason.message || 'Candidate signal');
      reasons.appendChild(item);
    });
    card.appendChild(reasons);
    appendPruneCandidateContext(card, candidate);
    ui.pruneCandidatesListEl.appendChild(card);
  });
}

function openPruneCandidatesReport() {
  setWorkspaceWorkflowMode('review');
  setWorkspaceSurface('reviewOutput');
  var reviewPane = document.getElementById('review-output-review-pane');
  if (reviewPane) reviewPane.classList.add('hidden');
  if (ui.captionSheetPane) ui.captionSheetPane.classList.add('hidden');
  ui.pruneCandidatesPane.classList.remove('hidden');
  ui.captionSheetBtn.setAttribute('aria-pressed', 'false');
  ui.pruneCandidatesBtn.setAttribute('aria-pressed', 'true');
  renderPruneCandidatesReport();
  ensurePruneCandidatesForCurrentFolder(false).then(renderPruneCandidatesReport).catch(renderPruneCandidatesReport);
}

function wirePruneCandidatesUi() {
  ui.pruneCandidatesBtn.onclick = openPruneCandidatesReport;
  ui.pruneCandidatesInspectBtn.onclick = function () { inspectPruneCandidates(''); };
  syncPruneCandidateConsumers();
}

window.addEventListener('webcap:media-metadata-updated', function (event) {
  var folder = String(event && event.detail && event.detail.folder || '');
  if (!folder || folder !== String(state.folder || '')) return;
  ensurePruneCandidatesForCurrentFolder(true).catch(function () {});
});
