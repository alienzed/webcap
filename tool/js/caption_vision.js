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

function isCaptionVisionSupportedMedia(fileName) {
  return /\.(jpe?g|png|webp|bmp|gif)$/i.test(String(fileName || ''));
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
  var supported = !!(
    captionVisionCapabilities.models.length &&
    mediaItem &&
    isCaptionVisionSupportedMedia(mediaItem.fileName)
  );

  toggleWrap.classList.toggle('hidden', !candidateVisible || !supported);
  toggle.checked = !!captionVisionEnabled;
  toggle.disabled = false;

  findings.innerHTML = '';
  findings.classList.add('hidden');
  status.classList.add('hidden');
  status.textContent = '';

  if (!candidateVisible || !captionVisionEnabled || !supported) return;

  if (captionVisionActiveTask) {
    status.textContent = 'Vision checking image…';
    status.classList.remove('hidden');
    return;
  }
  if (captionVisionError) {
    status.textContent = 'Vision check failed: ' + captionVisionError;
    status.classList.remove('hidden');
    return;
  }
  if (!captionVisionResult) {
    status.textContent = 'Vision ready.';
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

function setCaptionVisionEnabled(enabled) {
  captionVisionEnabled = !!enabled;
  clearCaptionVisionResult();
  if (!captionVisionEnabled) {
    cancelCurrentCaptionVision();
    syncFocusedCaptionVisionPreference();
    return;
  }

  loadCaptionVisionCapabilities().then(function () {
    if (captionAssistCandidate) {
      return runCaptionVisionForCandidate(captionAssistCandidate).then(function () {
        return syncFocusedCaptionVisionPreference();
      });
    }
    return syncFocusedCaptionVisionPreference();
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
  return cancelCurrentCaptionVision().then(function () {
    if (typeof cancelFocusedCaptionPrefetch === 'function') {
      return cancelFocusedCaptionPrefetch();
    }
    return false;
  }).then(function () {
    if (!captionVisionEnabled || !captionAssistCandidate) return false;
    return runCaptionVisionForCandidate(captionAssistCandidate);
  }).then(function () {
    if (
      captionVisionEnabled &&
      isFocusedCaptionOpen() &&
      state && state.currentItem &&
      typeof startFocusedCaptionPrefetch === 'function'
    ) {
      return startFocusedCaptionPrefetch(state.currentItem.key);
    }
    return false;
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

window.createCaptionVisionTask = createCaptionVisionTask;
window.cancelCaptionVisionTask = cancelCaptionVisionTask;
