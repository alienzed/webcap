// Global functions:
// isMediaMutated, getMediaMutationSource, markMediaMutated, clearMediaMutated,
// moveMediaMutationState, markAllCurrentFolderMediaMutated, refreshDeterministicMutationStatus

function normalizeMutationSource(source) {
  var value = String(source || '').trim().toLowerCase();
  if (value === 'deterministic') return 'deterministic';
  return 'best_effort';
}

function ensureMutationStateShape() {
  if (!state.mutatedSet || !(state.mutatedSet instanceof Set)) {
    state.mutatedSet = new Set();
  }
  if (!state.mutatedByMediaSource || typeof state.mutatedByMediaSource !== 'object') {
    state.mutatedByMediaSource = {};
  }
}

function isMediaMutated(mediaKey) {
  ensureMutationStateShape();
  var key = String(mediaKey || '').trim();
  if (!key) return false;
  return state.mutatedSet.has(key);
}

function getMediaMutationSource(mediaKey) {
  ensureMutationStateShape();
  var key = String(mediaKey || '').trim();
  if (!key) return '';
  return String(state.mutatedByMediaSource[key] || '');
}

function setMediaMutated(mediaKey, mutated, source) {
  ensureMutationStateShape();
  var key = String(mediaKey || '').trim();
  if (!key) return false;
  var changed = false;
  if (mutated) {
    if (!state.mutatedSet.has(key)) {
      state.mutatedSet.add(key);
      changed = true;
    }
    var normSource = normalizeMutationSource(source);
    if (state.mutatedByMediaSource[key] !== normSource) {
      state.mutatedByMediaSource[key] = normSource;
      changed = true;
    }
  } else {
    if (state.mutatedSet.delete(key)) {
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(state.mutatedByMediaSource, key)) {
      delete state.mutatedByMediaSource[key];
      changed = true;
    }
  }
  return changed;
}

function markMediaMutated(mediaKey, source) {
  return setMediaMutated(mediaKey, true, source || 'best_effort');
}

function clearMediaMutated(mediaKey) {
  return setMediaMutated(mediaKey, false, '');
}

function moveMediaMutationState(oldKey, newKey) {
  ensureMutationStateShape();
  var from = String(oldKey || '').trim();
  var to = String(newKey || '').trim();
  if (!from || !to || from === to) return false;
  var wasMutated = state.mutatedSet.has(from);
  var src = state.mutatedByMediaSource[from] || 'best_effort';
  var changed = clearMediaMutated(from);
  if (wasMutated) {
    changed = setMediaMutated(to, true, src) || changed;
  }
  return changed;
}

function markAllCurrentFolderMediaMutated(source) {
  ensureMutationStateShape();
  var changed = false;
  (state.items || []).forEach(function (item) {
    if (!item || !item.key) return;
    changed = markMediaMutated(item.key, source || 'best_effort') || changed;
  });
  return changed;
}

function applyDeterministicMutationStatus(statusByMedia) {
  ensureMutationStateShape();
  var changed = false;
  var map = (statusByMedia && typeof statusByMedia === 'object') ? statusByMedia : {};
  Object.keys(map).forEach(function (mediaKey) {
    var row = map[mediaKey];
    if (!row || row.deterministic_available !== true) return;
    changed = setMediaMutated(mediaKey, !!row.mutated, 'deterministic') || changed;
  });
  return changed;
}

function refreshDeterministicMutationStatus() {
  if (!state.folder) return;
  var folderLeaf = String(state.folder || '').split(/[\\/]/).pop().toLowerCase();
  if (folderLeaf === 'originals') return;
  var requestFolder = String(state.folder || '');
  var requestSeq = (state.mutationStatusSeq || 0) + 1;
  state.mutationStatusSeq = requestSeq;
  fetch('/fs/mutation_status?folder=' + encodeURIComponent(requestFolder))
    .then(function (resp) {
      return resp.json().then(function (data) {
        return { status: resp.status, data: data };
      });
    })
    .then(function (res) {
      if (requestSeq !== state.mutationStatusSeq) return;
      if (requestFolder !== String(state.folder || '')) return;
      if (res.status !== 200 || !res.data || !res.data.ok) return;
      var changed = applyDeterministicMutationStatus(res.data.status_by_media || {});
      if (!changed) return;
      renderFileList();
      updatePreviewActionControls();
      saveFolderStateForCurrentRoot();
    })
    .catch(function (_err) {
      // Hash verification is additive; best-effort state stays active if route fails.
    });
}

