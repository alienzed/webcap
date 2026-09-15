function duplicateCandidateScopeFiles() {
  var focusSet = state.focusSet || {};
  if (focusSet.reportType === 'duplicateCandidates' && Array.isArray(state.duplicateCandidatesScopeFiles)) {
    return state.duplicateCandidatesScopeFiles.slice();
  }
  return getFilteredMediaItems(false)
    .map(function (item) { return String(item && (item.fileName || item.key) || '').trim(); })
    .filter(Boolean);
}

function duplicateCandidateScopeKey(files) {
  return files.slice().sort(function (left, right) { return left.localeCompare(right); }).join('\n');
}

function resetDuplicateCandidateState(status) {
  state.duplicateCandidateGroups = [];
  state.duplicateCandidatesFolder = String(state.folder || '');
  state.duplicateCandidatesScopeKey = '';
  state.duplicateCandidatesScopeFiles = [];
  state.duplicateCandidatesStatus = status || 'idle';
  state.duplicateCandidatesError = '';
  state.duplicateCandidatesPopulation = 0;
  state.duplicateCandidatesDirty = false;
  renderDuplicateCandidatesReport();
}

function invalidateDuplicateCandidates() {
  state.duplicateCandidatesSeq = Number(state.duplicateCandidatesSeq || 0) + 1;
  state.duplicateCandidateGroups = [];
  state.duplicateCandidatesStatus = 'idle';
  state.duplicateCandidatesError = '';
  state.duplicateCandidatesPopulation = 0;
  state.duplicateCandidatesDirty = true;
  renderDuplicateCandidatesReport();
}

function applyDuplicateCandidatePayload(folder, scopeFiles, scopeKey, payload) {
  if (!payload || !Array.isArray(payload.groups)) throw new Error('Malformed duplicate candidate response.');
  state.duplicateCandidateGroups = payload.groups.slice();
  state.duplicateCandidatesFolder = folder;
  state.duplicateCandidatesScopeKey = scopeKey;
  state.duplicateCandidatesScopeFiles = scopeFiles.slice();
  state.duplicateCandidatesPopulation = Number(payload.population_count || 0);
  state.duplicateCandidatesStatus = 'ready';
  state.duplicateCandidatesError = '';
  state.duplicateCandidatesDirty = false;
  renderDuplicateCandidatesReport();
}

function ensureDuplicateCandidatesForCurrentFolder(force) {
  var folder = String(state.folder || '').trim();
  if (!folder) {
    resetDuplicateCandidateState('ready');
    return Promise.resolve([]);
  }
  var scopeFiles = duplicateCandidateScopeFiles();
  var scopeKey = duplicateCandidateScopeKey(scopeFiles);
  if (!force && !state.duplicateCandidatesDirty && state.duplicateCandidatesFolder === folder && state.duplicateCandidatesScopeKey === scopeKey && state.duplicateCandidatesStatus === 'ready') {
    return Promise.resolve(state.duplicateCandidateGroups.slice());
  }
  if (!force && state.duplicateCandidatesFolder === folder && state.duplicateCandidatesScopeKey === scopeKey && state.duplicateCandidatesStatus === 'loading') {
    return Promise.resolve([]);
  }
  var seq = Number(state.duplicateCandidatesSeq || 0) + 1;
  state.duplicateCandidatesSeq = seq;
  state.duplicateCandidatesFolder = folder;
  state.duplicateCandidatesStatus = 'loading';
  state.duplicateCandidatesError = '';
  renderDuplicateCandidatesReport();
  return fetch('/fs/duplicate_candidates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: folder, selected_media: scopeFiles })
  })
    .then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok) throw new Error((payload && payload.error) || ('Duplicate candidate request failed (' + response.status + ')'));
        return payload;
      });
    })
    .then(function (payload) {
      if (state.folder !== folder || state.duplicateCandidatesSeq !== seq) return [];
      applyDuplicateCandidatePayload(folder, scopeFiles, scopeKey, payload);
      return state.duplicateCandidateGroups.slice();
    })
    .catch(function (err) {
      if (state.folder !== folder || state.duplicateCandidatesSeq !== seq) return [];
      state.duplicateCandidateGroups = [];
      state.duplicateCandidatesStatus = 'error';
      state.duplicateCandidatesError = String(err && err.message ? err.message : err);
      renderDuplicateCandidatesReport();
      setStatus('Duplicate analysis failed: ' + state.duplicateCandidatesError);
      throw err;
    });
}

var debouncedRefreshDuplicateCandidatesForScope = debounceCreate(250);

function isDuplicateCandidatesReviewActive() {
  return reviewWorkspaceState.detailTab === 'duplicates' && normalizeWorkspaceSurface(workspaceState.surface) === 'reviewOutput';
}

function duplicateCandidatesScopeChanged() {
  if (state.focusSet && state.focusSet.reportType === 'duplicateCandidates') return;
  invalidateDuplicateCandidates();
  if (!isDuplicateCandidatesReviewActive()) return;
  debouncedRefreshDuplicateCandidatesForScope(function () {
    if (!isDuplicateCandidatesReviewActive()) return;
    ensureDuplicateCandidatesForCurrentFolder(false).catch(function () {});
  });
}

function formatDuplicateCandidateBytes(value) {
  var bytes = Number(value || 0);
  if (!isFinite(bytes) || bytes <= 0) return '';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function cloneDuplicateFocusSet(focusSet) {
  if (!focusSet || !Array.isArray(focusSet.keys)) return null;
  return {
    keys: focusSet.keys.slice(),
    source: String(focusSet.source || ''),
    reportType: String(focusSet.reportType || '')
  };
}

function inspectDuplicateCandidateGroup(group) {
  var files = (group && Array.isArray(group.items) ? group.items : [])
    .map(function (item) { return String(item && item.file || ''); })
    .filter(Boolean);
  if (!files.length) {
    setStatus('No duplicate group to inspect.');
    return;
  }
  if (!state.focusSet || state.focusSet.reportType !== 'duplicateCandidates') {
    state.duplicateCandidatesParentFocusSet = cloneDuplicateFocusSet(state.focusSet);
  }
  var label = 'Duplicate Candidates · ' + (group.match_type === 'exact' ? 'Exact' : 'Similar');
  activateFocusSet(files, label, 'duplicateCandidates');
  openMediaGridSurface();
}

function returnToDuplicateCandidatesReport() {
  var parent = state.duplicateCandidatesParentFocusSet;
  if (parent !== undefined) {
    state.focusSet = parent ? cloneDuplicateFocusSet(parent) : null;
    state.duplicateCandidatesParentFocusSet = undefined;
    updateFocusSetUi();
    renderFileList(ui.filterEl.value);
    pruneCandidatesScopeChanged();
  }
  openDuplicateCandidatesReport();
}

function removeDuplicateCandidateFile(fileName) {
  var target = String(fileName || '');
  if (!target) return;
  var wasInScope = (state.duplicateCandidatesScopeFiles || []).indexOf(target) !== -1;
  state.duplicateCandidateGroups = (state.duplicateCandidateGroups || []).map(function (group) {
    var items = (group.items || []).filter(function (item) { return String(item && item.file || '') !== target; });
    return Object.assign({}, group, { items: items });
  }).filter(function (group) { return group.items.length >= 2; });
  var parent = state.duplicateCandidatesParentFocusSet;
  if (parent && Array.isArray(parent.keys)) {
    parent.keys = parent.keys.filter(function (key) { return key !== target; });
    if (!parent.keys.length) state.duplicateCandidatesParentFocusSet = null;
  }
  if (wasInScope) state.duplicateCandidatesPopulation = Math.max(0, Number(state.duplicateCandidatesPopulation || 0) - 1);
  state.duplicateCandidatesDirty = true;
  renderDuplicateCandidatesReport();
}

function duplicateCandidatePreview(item) {
  var wrap = document.createElement('div');
  wrap.className = 'duplicate-candidate-preview';
  var source = mediaGridMediaUrl({ fileName: item.file, key: item.file });
  if (item.kind === 'video') {
    var video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = source;
    wrap.appendChild(video);
  } else {
    var image = document.createElement('img');
    image.loading = 'lazy';
    image.src = source;
    image.alt = item.file;
    wrap.appendChild(image);
  }
  return wrap;
}

function renderDuplicateCandidatesReport() {
  ui.duplicateCandidatesListEl.innerHTML = '';
  var status = state.duplicateCandidatesStatus;
  var groups = Array.isArray(state.duplicateCandidateGroups) ? state.duplicateCandidateGroups : [];
  if (status === 'loading') {
    ui.duplicateCandidatesSummaryEl.textContent = 'Analyzing visible media...';
    return;
  }
  if (status === 'error') {
    ui.duplicateCandidatesSummaryEl.textContent = 'Analysis failed.';
    var error = document.createElement('div');
    error.className = 'duplicate-candidates-empty duplicate-candidates-error';
    error.textContent = state.duplicateCandidatesError || 'Unknown duplicate analysis error.';
    ui.duplicateCandidatesListEl.appendChild(error);
    var retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'review-captions-btn';
    retry.textContent = 'Retry Analysis';
    retry.onclick = function () { ensureDuplicateCandidatesForCurrentFolder(true).catch(function () {}); };
    ui.duplicateCandidatesListEl.appendChild(retry);
    return;
  }
  if (status !== 'ready') {
    ui.duplicateCandidatesSummaryEl.textContent = 'Analysis has not run.';
    return;
  }
  ui.duplicateCandidatesSummaryEl.textContent = groups.length + ' possible duplicate group' + (groups.length === 1 ? '' : 's') + ' found in ' + Number(state.duplicateCandidatesPopulation || 0) + ' visible media.';
  if (!groups.length) {
    var empty = document.createElement('div');
    empty.className = 'duplicate-candidates-empty';
    empty.textContent = 'No possible duplicate groups found.';
    ui.duplicateCandidatesListEl.appendChild(empty);
    return;
  }
  groups.forEach(function (group) {
    var card = document.createElement('div');
    card.className = 'duplicate-candidate-card';
    var header = document.createElement('div');
    header.className = 'duplicate-candidate-header';
    var title = document.createElement('strong');
    var allVideo = group.items.length && group.items.every(function (item) { return item.kind === 'video'; });
    title.textContent = (group.match_type === 'exact' ? 'Exact' : 'Similar') + (allVideo ? ' · Video' : '');
    header.appendChild(title);
    card.appendChild(header);
    var items = document.createElement('div');
    items.className = 'duplicate-candidate-items';
    group.items.forEach(function (item) {
      var media = document.createElement('div');
      media.className = 'duplicate-candidate-media';
      media.appendChild(duplicateCandidatePreview(item));
      var name = document.createElement('strong');
      name.className = 'duplicate-candidate-file';
      name.textContent = item.file;
      media.appendChild(name);
      var details = [item.resolution, formatDuplicateCandidateBytes(item.size_bytes)];
      if (item.kind === 'video') {
        if (isFinite(Number(item.duration))) details.push(Number(item.duration).toFixed(1) + 's');
        if (isFinite(Number(item.fps))) details.push(Number(item.fps).toFixed(2) + ' fps');
      }
      var meta = document.createElement('span');
      meta.className = 'duplicate-candidate-meta';
      meta.textContent = details.filter(Boolean).join(' · ');
      media.appendChild(meta);
      items.appendChild(media);
    });
    card.appendChild(items);
    var inspect = document.createElement('button');
    inspect.type = 'button';
    inspect.className = 'review-captions-btn duplicate-candidate-inspect';
    inspect.textContent = 'Inspect Group';
    inspect.onclick = function () { inspectDuplicateCandidateGroup(group); };
    card.appendChild(inspect);
    ui.duplicateCandidatesListEl.appendChild(card);
  });
}

function openDuplicateCandidatesReport() {
  setWorkspaceWorkflowMode('review');
  setWorkspaceSurface('reviewOutput');
  setReviewDetailTab('duplicates');
}

function wireDuplicateCandidatesUi() {
  renderDuplicateCandidatesReport();
}

window.addEventListener('webcap:media-metadata-updated', function (event) {
  var detail = event && event.detail ? event.detail : {};
  if (String(detail.folder || '') !== String(state.folder || '')) return;
  invalidateDuplicateCandidates();
  if (isDuplicateCandidatesReviewActive()) {
    ensureDuplicateCandidatesForCurrentFolder(true).catch(function () {});
  }
});
