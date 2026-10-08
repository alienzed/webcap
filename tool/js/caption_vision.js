var captionVisionCapabilities = {
  loaded: false,
  promise: null,
  models: [],
  defaultModel: ''
};
var captionVisionEnabled = false;
var captionVisionActiveTask = null;
var captionVisionTaskSequence = 0;
var captionVisionResult = null;
var captionVisionError = '';
var visionImageCaptionState = {
  open: false,
  mediaKey: '',
  model: '',
  jobId: '',
  pending: false,
  text: '',
  error: '',
  requestToken: 0
};

function isCaptionVisionSupportedMedia(fileName) {
  return /\.(jpe?g|png|webp|bmp|gif|mp4|webm|ogg|mov|mkv|avi|m4v|wmv|mpg|mpeg)$/i.test(String(fileName || ''));
}

function isCaptionVisionVideo(fileName) {
  return /\.(mp4|webm|ogg|mov|mkv|avi|m4v|wmv|mpg|mpeg)$/i.test(String(fileName || ''));
}

function loadCaptionVisionCapabilities() {
  if (captionVisionCapabilities.loaded) return Promise.resolve(captionVisionCapabilities);
  if (captionVisionCapabilities.promise) return captionVisionCapabilities.promise;
  captionVisionCapabilities.promise = captionAssistRequestJson('/caption/vision-capabilities')
    .then(function (payload) {
      captionVisionCapabilities.loaded = true;
      captionVisionCapabilities.models = Array.isArray(payload.models) ? payload.models : [];
      captionVisionCapabilities.defaultModel = String(payload.defaultModel || '');
      captionVisionCapabilities.promise = null;
      syncCaptionVisionUi();
      return captionVisionCapabilities;
    })
    .catch(function (err) {
      captionVisionCapabilities.promise = null;
      captionVisionCapabilities.loaded = true;
      captionVisionCapabilities.models = [];
      captionVisionCapabilities.defaultModel = '';
      captionVisionError = String(err && err.message ? err.message : err);
      reportConsoleError('Caption Vision', err);
      syncCaptionVisionUi();
      return captionVisionCapabilities;
    });
  return captionVisionCapabilities.promise;
}

function getCaptionVisionModelId() {
  var preferred = typeof getVisionModelPreference === 'function'
    ? String(getVisionModelPreference() || '')
    : '';
  var available = (captionVisionCapabilities.models || []).some(function (model) {
    return String(model && model.id || '') === preferred;
  });
  return available ? preferred : String(captionVisionCapabilities.defaultModel || '');
}

function buildCaptionVisionGroups(mediaKey) {
  return (Array.isArray(checklistItems) ? checklistItems : []).map(function (group) {
    var groupName = String(group || '').trim();
    var selected = getChecklistAssignedTagsForMediaKey(mediaKey, group).slice();
    return {
      group: groupName,
      options: getChecklistKeywordTermsForRequirement(group).slice(),
      selected: selected,
      reviewed: isChecklistRequirementCheckedForMediaKey(mediaKey, group)
    };
  }).filter(function (entry) {
    if (!entry.group) return false;
    // Selected groups are relevant for mismatch detection. Unreviewed groups are
    // relevant for omissions. Fully reviewed empty groups add prompt noise only.
    return entry.selected.length > 0 || !entry.reviewed;
  }).map(function (entry) {
    return {
      group: entry.group,
      options: entry.options,
      selected: entry.selected
    };
  });
}

function buildCaptionVisionRequest(mediaItem, captionText) {
  if (!mediaItem || !mediaItem.key || !mediaItem.fileName) {
    throw new Error('Caption Vision requires a selected media item.');
  }
  return {
    model: getCaptionVisionModelId(),
    folder: String((state && state.folder) || ''),
    media: String(mediaItem.fileName || ''),
    caption: String(captionText || '').trim(),
    groups: buildCaptionVisionGroups(mediaItem.key)
  };
}

function captionVisionRequestFingerprint(mediaItem, captionText) {
  return JSON.stringify(buildCaptionVisionRequest(mediaItem, captionText));
}

function filterCaptionVisionFindings(mediaItem, captionText, findings) {
  var mediaKey = String(mediaItem && mediaItem.key || '');
  var text = String(captionText || '').trim();
  return (Array.isArray(findings) ? findings : []).filter(function (finding) {
    if (!finding || String(finding.type || '').toLowerCase() !== 'omitted' || !finding.knownTag) return true;
    var group = String(finding.knownTag.group || '').trim();
    var term = String(finding.knownTag.term || '').trim();
    if (!mediaKey || !group || !term) return true;
    return !checklistGroupTermAppearsInCaptionText(group, term, mediaKey, text);
  });
}

function requestCaptionVisionCandidate(mediaItem, captionText, options) {
  var opts = options || {};
  return loadCaptionVisionCapabilities().then(function () {
    var request = buildCaptionVisionRequest(mediaItem, captionText);
    if (!request.model) throw new Error('No Vision model is available.');
    return captionAssistRequestJson('/caption/vision-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    }).then(function (payload) {
      if (!payload.job || !payload.job.jobId) throw new Error('Caption Vision did not return a queued job.');
      trackTransientLlmJob(payload.job);
      var hookResult = opts.onJob ? opts.onJob(payload.job) : null;
      return Promise.resolve(hookResult).then(function () {
        return waitForCaptionAssistJob(payload.job);
      });
    }).then(function (job) {
      var result = job.result && typeof job.result === 'object' ? job.result : {};
      var vision = result.vision && typeof result.vision === 'object' ? result.vision : null;
      if (!vision || !Array.isArray(vision.findings)) {
        throw new Error('Caption Vision returned no normalized findings.');
      }
      return {
        mediaKey: String(mediaItem.key || ''),
        captionText: String(captionText || '').trim(),
        findings: filterCaptionVisionFindings(mediaItem, captionText, vision.findings),
        model: String(result.model || ''),
        requestFingerprint: JSON.stringify(request)
      };
    });
  });
}

function clearCaptionVisionResult() {
  captionVisionResult = null;
  captionVisionError = '';
  syncCaptionVisionUi();
}

function createCaptionVisionTask(mediaItem, captionText) {
  var task = {
    id: ++captionVisionTaskSequence,
    mediaKey: String(mediaItem && mediaItem.key || ''),
    captionText: String(captionText || '').trim(),
    jobId: '',
    cancelled: false,
    result: null,
    promise: null
  };

  task.promise = requestCaptionVisionCandidate(mediaItem, captionText, {
    onJob: function (job) {
      task.jobId = String(job.jobId || '');
      if (!task.cancelled) return null;
      return cancelCaptionAssistJob(task.jobId).catch(function (err) {
        reportConsoleWarning(
          'Caption Vision',
          'Could not cancel a superseded vision job: ' + String(err && err.message ? err.message : err)
        );
        return false;
      });
    }
  }).then(function (result) {
    if (task.cancelled) return null;
    task.result = result;
    return result;
  });

  return task;
}

function cancelCaptionVisionTask(task, label) {
  if (!task) return Promise.resolve(false);
  task.cancelled = true;
  var jobId = String(task.jobId || '');
  if (!jobId) return Promise.resolve(true);
  return cancelCaptionAssistJob(jobId).catch(function (err) {
    reportConsoleWarning(
      label || 'Caption Vision',
      'Could not cancel vision job: ' + String(err && err.message ? err.message : err)
    );
    return false;
  });
}

function cancelCurrentCaptionVision() {
  var task = captionVisionActiveTask;
  if (!task) {
    syncCaptionVisionUi();
    return Promise.resolve(false);
  }
  captionVisionActiveTask = null;
  syncCaptionVisionUi();
  return cancelCaptionVisionTask(task, 'Caption Vision').then(function (result) {
    syncCaptionVisionUi();
    return result;
  });
}

function isCaptionVisionCandidateCurrent(candidate) {
  return !!(
    candidate &&
    captionAssistCandidate === candidate &&
    state && state.currentItem &&
    state.currentItem.key === candidate.mediaKey
  );
}

function bindCaptionVisionTaskToCandidate(task, candidate) {
  if (!task || !candidate) return Promise.resolve(false);
  captionVisionActiveTask = task;
  captionVisionResult = task.result || null;
  captionVisionError = '';
  syncCaptionVisionUi();

  return task.promise.then(function (result) {
    if (
      task.cancelled ||
      captionVisionActiveTask !== task ||
      !captionVisionEnabled ||
      !isCaptionVisionCandidateCurrent(candidate)
    ) {
      return false;
    }
    if (!result) return false;
    captionVisionResult = result;
    captionVisionError = '';
    return true;
  }).catch(function (err) {
    if (
      !task.cancelled &&
      captionVisionActiveTask === task &&
      captionVisionEnabled &&
      isCaptionVisionCandidateCurrent(candidate)
    ) {
      captionVisionError = String(err && err.message ? err.message : err);
      reportConsoleError('Caption Vision', err);
    }
    return false;
  }).then(function (ok) {
    if (captionVisionActiveTask === task) {
      captionVisionActiveTask = null;
      syncCaptionVisionUi();
    }
    return ok;
  });
}

function runCaptionVisionForCandidate(candidate) {
  if (!captionVisionEnabled || !candidate) return Promise.resolve(false);
  if (!state.currentItem || state.currentItem.key !== candidate.mediaKey) return Promise.resolve(false);
  if (!isCaptionVisionSupportedMedia(state.currentItem.fileName)) return Promise.resolve(false);

  var previous = captionVisionActiveTask;
  if (previous) {
    captionVisionActiveTask = null;
    cancelCaptionVisionTask(previous, 'Caption Vision');
  }

  captionVisionResult = null;
  captionVisionError = '';
  var task = createCaptionVisionTask(state.currentItem, candidate.text);
  return bindCaptionVisionTaskToCandidate(task, candidate);
}

function maybeRunCaptionVisionForCandidate(candidate) {
  if (!captionVisionEnabled) {
    syncCaptionVisionUi();
    return Promise.resolve(false);
  }
  return runCaptionVisionForCandidate(candidate);
}

function adoptCaptionVisionPrefetch(prefetch, candidate) {
  if (!captionVisionEnabled || !prefetch || !candidate) return Promise.resolve(false);
  var task = prefetch.visionTask;
  if (!task) return runCaptionVisionForCandidate(candidate);

  var previous = captionVisionActiveTask;
  if (previous && previous !== task) {
    captionVisionActiveTask = null;
    cancelCaptionVisionTask(previous, 'Caption Vision');
  }
  return bindCaptionVisionTaskToCandidate(task, candidate);
}

function isCaptionVisionKnownTagSelected(mediaKey, group, term) {
  var wanted = String(term || '').trim().toLowerCase();
  return getChecklistAssignedTagsForMediaKey(mediaKey, group).some(function (value) {
    return String(value || '').trim().toLowerCase() === wanted;
  });
}

function applyCaptionVisionKnownTag(finding) {
  if (!finding || !finding.knownTag || !state.currentItem || !captionAssistCandidate) return;
  var mediaKey = state.currentItem.key;
  var group = String(finding.knownTag.group || '');
  var term = String(finding.knownTag.term || '');
  if (!group || !term) return;

  var alreadySelected = isCaptionVisionKnownTagSelected(mediaKey, group, term);
  if (!alreadySelected) {
    assignChecklistTagToMediaKey(mediaKey, group, term);
  }

  setStatus(
    (alreadySelected ? 'Revising caption for ' : 'Selected ' + group + ': ' + term + '. Revising caption for ')
    + group + ': ' + term + '...'
  );
  captionVisionResult = null;
  captionVisionError = '';
  repairCaptionAssistCandidate([{
    group: group,
    term: term,
    note: String(finding.description || '').trim()
  }]);
}

function renderCaptionVisionFinding(finding) {
  var row = document.createElement('div');
  row.className = 'caption-vision-finding caption-vision-confidence-' + String(finding.confidence || 'low');

  var copy = document.createElement('div');
  copy.className = 'caption-vision-finding-copy';
  var meta = document.createElement('div');
  meta.className = 'caption-vision-finding-meta';
  meta.textContent = String(finding.type || '') + ' · ' + String(finding.confidence || '');
  var text = document.createElement('div');
  text.className = 'caption-vision-finding-text';
  text.textContent = String(finding.description || '');
  copy.appendChild(meta);
  copy.appendChild(text);
  row.appendChild(copy);

  if (finding.knownTag) {
    var group = String(finding.knownTag.group || '');
    var term = String(finding.knownTag.term || '');
    var mediaKey = state && state.currentItem ? state.currentItem.key : '';
    var selected = !!(mediaKey && isCaptionVisionKnownTagSelected(mediaKey, group, term));
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'caption-vision-tag-action';
    button.textContent = selected ? 'Fix caption' : 'Apply + fix';
    button.title = selected
      ? ('Revise the caption to include ' + group + ': ' + term)
      : ('Select ' + group + ': ' + term + ' and revise the caption');
    button.addEventListener('click', function () {
      applyCaptionVisionKnownTag(finding);
    });
    row.appendChild(button);
  } else {
    var novel = document.createElement('span');
    novel.className = 'caption-vision-novel';
    novel.textContent = 'Novel';
    novel.title = 'No exact configured tag matched this observation';
    row.appendChild(novel);
  }
  return row;
}

function syncCaptionVisionUi() {
  var toggleWrap = document.getElementById('editor-caption-vision-toggle-wrap');
  var toggle = document.getElementById('editor-caption-vision-toggle');
  var status = document.getElementById('editor-caption-vision-status');
  var findings = document.getElementById('editor-caption-vision-findings');
  if (!toggleWrap || !toggle || !status || !findings) return;

  var mediaItem = state && state.currentItem;
  var candidateVisible = !!(
    captionAssistCandidate &&
    mediaItem &&
    captionAssistCandidate.mediaKey === mediaItem.key
  );
  var mediaSupported = !!(mediaItem && isCaptionVisionSupportedMedia(mediaItem.fileName));
  var modelAvailable = !!captionVisionCapabilities.models.length;
  var supported = mediaSupported && modelAvailable;

  toggleWrap.classList.toggle('hidden', !candidateVisible || !mediaSupported);
  toggle.checked = !!captionVisionEnabled;
  toggle.disabled = !modelAvailable;
  toggleWrap.title = modelAvailable
    ? 'Scan for incorrect or omitted visual details using the selected Vision model.'
    : (captionVisionCapabilities.loaded ? 'No Vision model is available.' : 'Vision models are still loading.');
  syncVisionImageCaptionActionUi();

  findings.innerHTML = '';
  findings.classList.add('hidden');
  status.classList.add('hidden');
  status.textContent = '';

  if (!candidateVisible || !captionVisionEnabled) return;
  if (!modelAvailable) {
    status.textContent = captionVisionCapabilities.loaded
      ? 'Vision enabled · no Vision model is currently available.'
      : 'Vision enabled · loading Vision models…';
    status.classList.remove('hidden');
    return;
  }
  if (!mediaSupported) return;

  if (captionVisionActiveTask) {
    status.textContent = isCaptionVisionVideo(mediaItem.fileName)
      ? 'Vision checking first video frame…'
      : 'Vision checking image…';
    status.classList.remove('hidden');
    return;
  }
  if (captionVisionError) {
    status.textContent = 'Vision check failed: ' + captionVisionError;
    status.classList.remove('hidden');
    return;
  }
  if (!captionVisionResult) {
    status.textContent = 'Vision enabled · checks run automatically for each caption candidate.';
    status.classList.remove('hidden');
    return;
  }
  if (!captionVisionResult.findings.length) {
    status.textContent = 'Vision found no meaningful discrepancy.';
    status.classList.remove('hidden');
    return;
  }

  captionVisionResult.findings.forEach(function (finding) {
    findings.appendChild(renderCaptionVisionFinding(finding));
  });
  findings.classList.remove('hidden');
}

function getVisionImageCaptionEls() {
  var els = {
    actionBtn: document.getElementById('preview-vision-caption-btn'),
    modal: document.getElementById('vision-image-caption-modal'),
    model: document.getElementById('vision-image-caption-model'),
    loading: document.getElementById('vision-image-caption-loading'),
    error: document.getElementById('vision-image-caption-error'),
    text: document.getElementById('vision-image-caption-text'),
    closeBtn: document.getElementById('vision-image-caption-close'),
    copyBtn: document.getElementById('vision-image-caption-copy'),
    useBtn: document.getElementById('vision-image-caption-use'),
    cancelBtn: document.getElementById('vision-image-caption-cancel')
  };
  Object.keys(els).forEach(function (key) {
    if (!els[key]) throw new Error('Vision Caption UI is missing: ' + key);
  });
  return els;
}

function syncVisionImageCaptionActionUi() {
  var btn = document.getElementById('preview-vision-caption-btn');
  if (!btn) throw new Error('Vision Caption preview action is missing.');
  var mediaItem = state && state.currentItem;
  var focusedCaptionOpen = isFocusedCaptionOpen();
  var supported = !!(
    captionVisionCapabilities.models.length &&
    mediaItem &&
    isCaptionVisionSupportedMedia(mediaItem.fileName)
  );
  btn.classList.toggle('hidden', !supported || focusedCaptionOpen);
  btn.disabled = !!visionImageCaptionState.pending;
}

function syncVisionImageCaptionModal() {
  var els = getVisionImageCaptionEls();
  var open = !!visionImageCaptionState.open;
  var hasText = !!String(visionImageCaptionState.text || '').trim();
  els.modal.classList.toggle('hidden', !open);
  els.model.textContent = visionImageCaptionState.model ? ('Vision model · ' + visionImageCaptionState.model) : '';
  els.loading.classList.toggle('hidden', !open || !visionImageCaptionState.pending);
  els.error.classList.toggle('hidden', !open || !visionImageCaptionState.error);
  els.error.textContent = visionImageCaptionState.error || '';
  els.text.classList.toggle('hidden', !open || !hasText);
  els.text.textContent = hasText ? visionImageCaptionState.text : '';
  els.copyBtn.disabled = !hasText || visionImageCaptionState.pending;
  els.useBtn.disabled = !(
    hasText &&
    !visionImageCaptionState.pending &&
    state && state.currentItem &&
    state.currentItem.key === visionImageCaptionState.mediaKey
  );
  els.cancelBtn.classList.toggle('hidden', !open || !visionImageCaptionState.pending);
  syncVisionImageCaptionActionUi();
}

function cancelVisionImageCaptionRequest() {
  var jobId = String(visionImageCaptionState.jobId || '');
  if (!visionImageCaptionState.pending && !jobId) return Promise.resolve(false);
  visionImageCaptionState.requestToken += 1;
  visionImageCaptionState.jobId = '';
  visionImageCaptionState.pending = false;
  syncVisionImageCaptionModal();
  if (!jobId) return Promise.resolve(true);
  return cancelCaptionAssistJob(jobId).catch(function (err) {
    reportConsoleWarning('Vision Caption', 'Could not cancel Vision Caption job: ' + String(err && err.message ? err.message : err));
    return false;
  });
}

function closeVisionImageCaption() {
  var pending = visionImageCaptionState.pending || !!visionImageCaptionState.jobId;
  visionImageCaptionState.open = false;
  visionImageCaptionState.text = '';
  visionImageCaptionState.error = '';
  syncVisionImageCaptionModal();
  if (pending) cancelVisionImageCaptionRequest();
}

function syncVisionImageCaptionSelection(mediaKey) {
  var key = String(mediaKey || '').trim();
  if (!visionImageCaptionState.open || !visionImageCaptionState.mediaKey) return;
  if (key === visionImageCaptionState.mediaKey) return;
  closeVisionImageCaption();
}

function requestVisionImageCaptionDescription(mediaItem, options) {
  var opts = options || {};
  if (!mediaItem || !mediaItem.key || !mediaItem.fileName) {
    return Promise.reject(new Error('Vision Caption requires selected media.'));
  }
  if (!isCaptionVisionSupportedMedia(mediaItem.fileName)) {
    return Promise.reject(new Error('Vision Caption supports images and the first frame of videos.'));
  }
  return loadCaptionVisionCapabilities().then(function () {
    var model = String(opts.model || getCaptionVisionModelId() || '');
    if (!model) throw new Error('Select an available Vision model.');
    return captionAssistRequestJson('/caption/vision-caption', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        folder: String((state && state.folder) || ''),
        media: String(mediaItem.fileName || '')
      })
    }).then(function (payload) {
      if (!payload.job || !payload.job.jobId) throw new Error('Vision Caption did not return a queued job.');
      trackTransientLlmJob(payload.job);
      var hookResult = opts.onJob ? opts.onJob(payload.job) : null;
      return Promise.resolve(hookResult).then(function () {
        return waitForCaptionAssistJob(payload.job);
      });
    }).then(function (job) {
      var result = job.result && typeof job.result === 'object' ? job.result : {};
      var text = String(result.text || '').trim();
      if (!text) throw new Error('Vision model returned an empty caption.');
      return {
        mediaKey: String(mediaItem.key || ''),
        text: text,
        model: String(result.model || model)
      };
    });
  });
}

function requestVisionCaptionExtras(mediaItem, captionText, options) {
  var opts = options || {};
  if (!mediaItem || !mediaItem.key || !mediaItem.fileName) {
    return Promise.reject(new Error('Vision extras requires selected media.'));
  }
  if (!isCaptionVisionSupportedMedia(mediaItem.fileName)) {
    return Promise.reject(new Error('Vision extras supports images and the first frame of videos.'));
  }
  return loadCaptionVisionCapabilities().then(function () {
    var model = String(opts.model || getCaptionVisionModelId() || '');
    if (!model) throw new Error('Select an available Vision model.');
    return captionAssistRequestJson('/caption/vision-extras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        folder: String((state && state.folder) || ''),
        media: String(mediaItem.fileName || ''),
        caption: String(captionText || '')
      })
    }).then(function (payload) {
      if (!payload.job || !payload.job.jobId) throw new Error('Vision extras did not return a queued job.');
      trackTransientLlmJob(payload.job);
      var hookResult = opts.onJob ? opts.onJob(payload.job) : null;
      return Promise.resolve(hookResult).then(function () {
        return waitForCaptionAssistJob(payload.job);
      });
    }).then(function (job) {
      var result = job.result && typeof job.result === 'object' ? job.result : {};
      var extras = result.visionExtras && Array.isArray(result.visionExtras.extras) ? result.visionExtras.extras : null;
      if (!extras) throw new Error('Vision extras completed without structured extras.');
      return {
        mediaKey: String(mediaItem.key || ''),
        extras: extras.slice(),
        model: String(result.model || model)
      };
    });
  });
}
function runVisionImageCaption() {
  var mediaItem = state && state.currentItem;
  if (!mediaItem || !mediaItem.key || !mediaItem.fileName) {
    setStatus('Select media first.');
    return Promise.resolve(false);
  }
  if (!isCaptionVisionSupportedMedia(mediaItem.fileName)) {
    setStatus('Vision Caption supports images and the first frame of videos.');
    return Promise.resolve(false);
  }
  if (visionImageCaptionState.pending) {
    setStatus('Vision Caption is already running.');
    return Promise.resolve(false);
  }

  return loadCaptionVisionCapabilities().then(function () {
    var model = getCaptionVisionModelId();
    if (!model) throw new Error('Select an available Vision model.');

    var token = visionImageCaptionState.requestToken + 1;
    visionImageCaptionState.open = true;
    visionImageCaptionState.mediaKey = String(mediaItem.key || '');
    visionImageCaptionState.model = model;
    visionImageCaptionState.jobId = '';
    visionImageCaptionState.pending = true;
    visionImageCaptionState.text = '';
    visionImageCaptionState.error = '';
    visionImageCaptionState.requestToken = token;
    syncVisionImageCaptionModal();
    setStatus('Vision Caption starting...');

    return requestVisionImageCaptionDescription(mediaItem, {
      model: model,
      onJob: function (job) {
        if (visionImageCaptionState.requestToken !== token || !visionImageCaptionState.open) {
          return cancelCaptionAssistJob(String(job.jobId || ''));
        }
        visionImageCaptionState.jobId = String(job.jobId || '');
        syncVisionImageCaptionModal();
        return null;
      }
    }).then(function (result) {
      if (!result || visionImageCaptionState.requestToken !== token || !visionImageCaptionState.open) return false;
      visionImageCaptionState.jobId = '';
      visionImageCaptionState.pending = false;
      visionImageCaptionState.text = String(result.text || '');
      visionImageCaptionState.error = '';
      visionImageCaptionState.model = String(result.model || model);
      syncVisionImageCaptionModal();
      setStatus('Vision Caption ready.');
      return true;
    });
  }).catch(function (err) {
    if (!visionImageCaptionState.open) return false;
    visionImageCaptionState.jobId = '';
    visionImageCaptionState.pending = false;
    visionImageCaptionState.error = String(err && err.message ? err.message : err);
    syncVisionImageCaptionModal();
    setStatus('Vision Caption failed: ' + visionImageCaptionState.error);
    reportConsoleError('Vision Caption', err);
    return false;
  });
}

function copyVisionImageCaption() {
  var text = String(visionImageCaptionState.text || '').trim();
  if (!text) return Promise.resolve(false);
  if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
    setStatus('Clipboard access is unavailable in this browser.');
    return Promise.resolve(false);
  }
  return navigator.clipboard.writeText(text).then(function () {
    setStatus('Vision Caption copied.');
    return true;
  }).catch(function (err) {
    reportConsoleError('Vision Caption', err);
    setStatus('Could not copy Vision Caption.');
    return false;
  });
}

function useVisionImageCaptionInEditor() {
  var text = String(visionImageCaptionState.text || '').trim();
  if (!text || !state || !state.currentItem || state.currentItem.key !== visionImageCaptionState.mediaKey) {
    setStatus('Vision Caption no longer matches the selected item.');
    return false;
  }
  applyEditorTextAndTriggerInput(text);
  visionImageCaptionState.open = false;
  visionImageCaptionState.text = '';
  syncVisionImageCaptionModal();
  if (ui && ui.editorEl) ui.editorEl.focus();
  setStatus('Vision Caption moved into the editor.');
  return true;
}

function wireVisionImageCaptionUi() {
  var els = getVisionImageCaptionEls();
  if (!els.actionBtn.__visionImageCaptionBound) {
    els.actionBtn.__visionImageCaptionBound = true;
    els.actionBtn.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      runVisionImageCaption();
    });
  }
  if (!els.closeBtn.__visionImageCaptionBound) {
    els.closeBtn.__visionImageCaptionBound = true;
    els.closeBtn.addEventListener('click', closeVisionImageCaption);
  }
  if (!els.cancelBtn.__visionImageCaptionBound) {
    els.cancelBtn.__visionImageCaptionBound = true;
    els.cancelBtn.addEventListener('click', function () {
      cancelVisionImageCaptionRequest().then(function () {
        if (!visionImageCaptionState.open) return;
        visionImageCaptionState.error = 'Vision Caption generation cancelled.';
        syncVisionImageCaptionModal();
      });
    });
  }
  if (!els.copyBtn.__visionImageCaptionBound) {
    els.copyBtn.__visionImageCaptionBound = true;
    els.copyBtn.addEventListener('click', copyVisionImageCaption);
  }
  if (!els.useBtn.__visionImageCaptionBound) {
    els.useBtn.__visionImageCaptionBound = true;
    els.useBtn.addEventListener('click', useVisionImageCaptionInEditor);
  }
  if (!els.modal.__visionImageCaptionBackdropBound) {
    els.modal.__visionImageCaptionBackdropBound = true;
    els.modal.addEventListener('click', function (event) {
      if (event.target === els.modal) closeVisionImageCaption();
    });
  }
  if (!document.__visionImageCaptionEscapeBound) {
    document.__visionImageCaptionEscapeBound = true;
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || !visionImageCaptionState.open) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeVisionImageCaption();
    }, true);
  }
  syncVisionImageCaptionModal();
}

function setCaptionVisionEnabled(enabled) {
  captionVisionEnabled = !!enabled;
  clearCaptionVisionResult();
  if (!captionVisionEnabled) {
    cancelCurrentCaptionVision();
    if (isFocusedCaptionOpen()) setFocusedCaptionVisionSightEnabled(false);
    syncFocusedCaptionVisionPreference();
    return;
  }

  loadCaptionVisionCapabilities().then(function () {
    if (isFocusedCaptionOpen()) setFocusedCaptionVisionSightEnabled(true);
    if (!captionAssistCandidate) return syncFocusedCaptionVisionPreference();

    var tasks = [runCaptionVisionForCandidate(captionAssistCandidate)];
    if (isFocusedCaptionOpen()) {
      tasks.push(loadFocusedCaptionVisionPhrases());
    }
    return Promise.all(tasks).then(function () {
      return syncFocusedCaptionVisionPreference();
    });
  });
}

function syncCaptionVisionCapabilitiesFromPayload(payload) {
  payload = payload && typeof payload === 'object' ? payload : {};
  captionVisionCapabilities.loaded = true;
  captionVisionCapabilities.models = Array.isArray(payload.models) ? payload.models : [];
  captionVisionCapabilities.defaultModel = String(payload.defaultModel || '');
  captionVisionCapabilities.promise = null;
  syncCaptionVisionUi();
}

function handleCaptionVisionModelChange() {
  clearCaptionVisionResult();
  var focusPhrasesEnabled = isFocusedCaptionOpen() && isFocusedCaptionVisionPhrasesEnabled();
  if (focusPhrasesEnabled) {
    clearFocusedCaptionVisionPhrases({ keepEnabled: true });
  }
  return cancelCurrentCaptionVision().then(function () {
    return cancelFocusedCaptionPrefetch();
  }).then(function () {
    if (!captionVisionEnabled || !captionAssistCandidate) return false;
    return runCaptionVisionForCandidate(captionAssistCandidate);
  }).then(function () {
    if (!isFocusedCaptionOpen() || !state || !state.currentItem) return false;
    return startFocusedCaptionPrefetch(state.currentItem.key).then(function (result) {
      if (focusPhrasesEnabled && captionAssistCandidate) {
        loadFocusedCaptionVisionPhrases();
      }
      return result;
    });
  });
}

function wireCaptionVisionUi() {
  var toggle = document.getElementById('editor-caption-vision-toggle');
  if (!toggle) throw new Error('Caption Vision toggle is missing.');
  if (!toggle.__captionVisionBound) {
    toggle.__captionVisionBound = true;
    toggle.addEventListener('change', function () {
      setCaptionVisionEnabled(toggle.checked);
    });
  }
  syncCaptionVisionUi();
  wireVisionImageCaptionUi();
}

wireCaptionVisionUi();

window.addEventListener('webcap:vision-capabilities-refreshed', function (event) {
  syncCaptionVisionCapabilitiesFromPayload(event && event.detail);
});

window.addEventListener('webcap:vision-model-changed', function () {
  handleCaptionVisionModelChange().catch(function (err) {
    reportConsoleError('Caption Vision', err);
  });
});

window.loadCaptionVisionCapabilities = loadCaptionVisionCapabilities;
window.syncCaptionVisionUi = syncCaptionVisionUi;
window.maybeRunCaptionVisionForCandidate = maybeRunCaptionVisionForCandidate;
window.requestCaptionVisionCandidate = requestCaptionVisionCandidate;
window.captionVisionRequestFingerprint = captionVisionRequestFingerprint;
window.adoptCaptionVisionPrefetch = adoptCaptionVisionPrefetch;
window.isCaptionVisionSupportedMedia = isCaptionVisionSupportedMedia;
window.getCaptionVisionModelId = getCaptionVisionModelId;
window.syncVisionImageCaptionActionUi = syncVisionImageCaptionActionUi;
window.syncVisionImageCaptionSelection = syncVisionImageCaptionSelection;
window.runVisionImageCaption = runVisionImageCaption;
window.requestVisionImageCaptionDescription = requestVisionImageCaptionDescription;
window.requestVisionCaptionExtras = requestVisionCaptionExtras;

window.createCaptionVisionTask = createCaptionVisionTask;
window.cancelCaptionVisionTask = cancelCaptionVisionTask;
