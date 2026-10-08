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
var captionVisionPreviewCaretIndex = null;
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
  var preferred = String(getVisionModelPreference() || '');
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

function captionVisionFindExactOccurrence(text, needle) {
  var source = String(text || '');
  var wanted = String(needle || '');
  if (!wanted) return { count: 0, index: -1 };
  var count = 0;
  var index = -1;
  var from = 0;
  while (from <= source.length) {
    var found = source.indexOf(wanted, from);
    if (found === -1) break;
    count += 1;
    if (index === -1) index = found;
    from = found + Math.max(1, wanted.length);
  }
  return { count: count, index: index };
}

function captionVisionValidatePatch(captionText, finding) {
  var text = String(captionText || '');
  var action = String(finding && finding.action || '').toLowerCase();
  var sourceText = String(finding && finding.sourceText || '');
  var replacementText = String(finding && finding.replacementText || '');
  var anchorText = String(finding && finding.anchorText || '');

  if (action === 'add') {
    if (!replacementText || sourceText) return null;
    if (!anchorText) {
      return {
        action: action,
        sourceText: '',
        replacementText: replacementText,
        anchorText: '',
        index: -1
      };
    }
    var anchorMatch = captionVisionFindExactOccurrence(text, anchorText);
    if (anchorMatch.count !== 1) return null;
    return {
      action: action,
      sourceText: '',
      replacementText: replacementText,
      anchorText: anchorText,
      index: anchorMatch.index + anchorText.length
    };
  }

  if (action === 'replace' || action === 'remove') {
    if (!sourceText) return null;
    if (action === 'replace' && (!replacementText || replacementText === sourceText)) return null;
    if (action === 'remove' && replacementText) return null;
    var sourceMatch = captionVisionFindExactOccurrence(text, sourceText);
    if (sourceMatch.count !== 1) return null;
    return {
      action: action,
      sourceText: sourceText,
      replacementText: replacementText,
      anchorText: '',
      index: sourceMatch.index
    };
  }
  return null;
}

function captionVisionApplyPatchToText(captionText, patch, caretIndex) {
  var text = String(captionText || '');
  if (!patch) return text;
  if (patch.action === 'add') {
    var index = patch.index;
    if (index < 0) {
      index = Number.isFinite(caretIndex) ? Math.max(0, Math.min(text.length, caretIndex)) : text.length;
    }
    var left = text.slice(0, index);
    var right = text.slice(index);
    var value = String(patch.replacementText || '').trim();
    var prefix = left && !/[\s([{"'/-]$/.test(left) ? ' ' : '';
    var suffix = right && !/^[\s.,;:!?)}\]"'/-]/.test(right) ? ' ' : '';
    return left + prefix + value + suffix + right;
  }
  if (patch.action === 'replace') {
    return text.slice(0, patch.index) + patch.replacementText + text.slice(patch.index + patch.sourceText.length);
  }
  if (patch.action === 'remove') {
    return text.slice(0, patch.index) + text.slice(patch.index + patch.sourceText.length);
  }
  return text;
}

function filterCaptionVisionFindings(mediaItem, captionText, findings) {
  var text = String(captionText || '');
  return (Array.isArray(findings) ? findings : []).filter(function (finding) {
    if (String(finding && finding.confidence || '').toLowerCase() === 'low') return false;
    return !!captionVisionValidatePatch(text, finding);
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

function setCaptionDiscrepancyFindingsForCandidate(candidate, findings, sourceLabel) {
  if (!candidate || !state.currentItem || candidate.mediaKey !== state.currentItem.key) {
    throw new Error('Caption discrepancy findings require the current Caption Assist candidate.');
  }
  var normalized = filterCaptionVisionFindings(state.currentItem, candidate.text, findings);
  captionVisionResult = {
    mediaKey: String(candidate.mediaKey || ''),
    captionText: String(candidate.text || ''),
    findings: normalized,
    model: String(sourceLabel || ''),
    requestFingerprint: ''
  };
  captionVisionError = '';
  syncCaptionVisionUi();
  return normalized.length;
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

function getCaptionVisionCandidateTextElement() {
  var el = document.getElementById('editor-caption-candidate-text');
  if (!el) throw new Error('Caption Vision candidate text is missing.');
  return el;
}

function getCaptionVisionCaretIndex() {
  var candidateEl = getCaptionVisionCandidateTextElement();
  if (!candidateEl.isContentEditable) return String(captionAssistCandidate && captionAssistCandidate.text || '').length;
  var selection = window.getSelection();
  if (!selection || !selection.rangeCount || !candidateEl.contains(selection.anchorNode)) {
    return String(captionAssistCandidate && captionAssistCandidate.text || '').length;
  }
  var range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(candidateEl);
  range.setEnd(selection.anchorNode, selection.anchorOffset);
  return range.toString().length;
}

function setCaptionVisionCaretIndex(index) {
  var candidateEl = getCaptionVisionCandidateTextElement();
  var target = Math.max(0, Number(index) || 0);
  var walker = document.createTreeWalker(candidateEl, NodeFilter.SHOW_TEXT);
  var node;
  while ((node = walker.nextNode())) {
    if (target <= node.nodeValue.length) {
      var range = document.createRange();
      range.setStart(node, target);
      range.collapse(true);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    target -= node.nodeValue.length;
  }
}

function setCaptionVisionCandidatePreview(text, active) {
  var candidateEl = getCaptionVisionCandidateTextElement();
  candidateEl.textContent = String(text || '');
  candidateEl.classList.toggle('is-patch-preview', !!active);
}

function restoreCaptionVisionCandidatePreview() {
  if (!captionAssistCandidate) return;
  var candidateEl = getCaptionVisionCandidateTextElement();
  var restoreCaret = captionVisionPreviewCaretIndex;
  setCaptionVisionCandidatePreview(captionAssistCandidate.text, false);
  if (restoreCaret !== null && document.activeElement === candidateEl) {
    setCaptionVisionCaretIndex(restoreCaret);
  }
  captionVisionPreviewCaretIndex = null;
}

function captionVisionPatchLabel(finding) {
  var action = String(finding && finding.action || '');
  var sourceText = String(finding && finding.sourceText || '');
  var replacementText = String(finding && finding.replacementText || '');
  if (action === 'add') return '+ ' + replacementText;
  if (action === 'replace') return sourceText + ' → ' + replacementText;
  if (action === 'remove') return '− ' + sourceText;
  return '';
}

function rejectCaptionVisionFinding(finding) {
  if (!captionVisionResult || !Array.isArray(captionVisionResult.findings)) return;
  captionVisionResult.findings = captionVisionResult.findings.filter(function (candidate) {
    return candidate !== finding;
  });
  restoreCaptionVisionCandidatePreview();
  syncCaptionVisionUi();
}

function applyCaptionVisionFinding(finding) {
  if (!captionAssistCandidate) return;
  var patch = captionVisionValidatePatch(captionAssistCandidate.text, finding);
  if (!patch) {
    rejectCaptionVisionFinding(finding);
    setStatus('Caption changed; this suggestion is no longer applicable.');
    return;
  }
  var caretIndex = captionVisionPreviewCaretIndex !== null ? captionVisionPreviewCaretIndex : getCaptionVisionCaretIndex();
  captionAssistCandidate.text = captionVisionApplyPatchToText(captionAssistCandidate.text, patch, caretIndex);
  if (captionVisionResult) {
    captionVisionResult.captionText = String(captionAssistCandidate.text || '');
    captionVisionResult.findings = filterCaptionVisionFindings(
      state.currentItem,
      captionAssistCandidate.text,
      captionVisionResult.findings
    );
  }
  if (state && state.currentItem && captionAssistCandidate.mediaKey === state.currentItem.key) {
    var liveRequest = buildCaptionAssistRequest(state.currentItem);
    captionAssistCandidate.omittedAssignments = getCaptionAssistOmittedAssignments(
      captionAssistCandidate.mediaKey,
      captionAssistCandidate.text,
      liveRequest.assignments
    );
    captionAssistCandidate.omittedCorrections = getCaptionAssistOmittedCorrections(
      captionAssistCandidate.mediaKey,
      captionAssistCandidate.text,
      liveRequest.assignments
    );
  }
  if (isFocusedCaptionOpen()) resetFocusedCaptionUseArm();
  rejectCaptionVisionFinding(finding);
  syncCaptionAssistCandidateUi();
  setStatus('Applied caption edit.');
}

function renderCaptionVisionFinding(finding) {
  if (!captionAssistCandidate) return null;
  var patch = captionVisionValidatePatch(captionAssistCandidate.text, finding);
  if (!patch) return null;

  var wrap = document.createElement('span');
  wrap.className = 'caption-vision-patch';

  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'caption-vision-patch-action';
  button.textContent = captionVisionPatchLabel(finding);
  button.title = 'Preview this exact caption edit';
  button.addEventListener('pointerdown', function (event) {
    event.preventDefault();
  });
  button.addEventListener('mouseenter', function () {
    var currentPatch = captionVisionValidatePatch(captionAssistCandidate.text, finding);
    if (!currentPatch) return;
    captionVisionPreviewCaretIndex = getCaptionVisionCaretIndex();
    setCaptionVisionCandidatePreview(
      captionVisionApplyPatchToText(captionAssistCandidate.text, currentPatch, captionVisionPreviewCaretIndex),
      true
    );
  });
  button.addEventListener('mouseleave', restoreCaptionVisionCandidatePreview);
  button.addEventListener('focus', function () {
    var currentPatch = captionVisionValidatePatch(captionAssistCandidate.text, finding);
    if (!currentPatch) return;
    captionVisionPreviewCaretIndex = getCaptionVisionCaretIndex();
    setCaptionVisionCandidatePreview(
      captionVisionApplyPatchToText(captionAssistCandidate.text, currentPatch, captionVisionPreviewCaretIndex),
      true
    );
  });
  button.addEventListener('blur', restoreCaptionVisionCandidatePreview);
  button.addEventListener('click', function () {
    applyCaptionVisionFinding(finding);
  });
  wrap.appendChild(button);

  var reject = document.createElement('button');
  reject.type = 'button';
  reject.className = 'caption-vision-patch-reject';
  reject.textContent = '×';
  reject.title = 'Reject this suggestion';
  reject.setAttribute('aria-label', 'Reject ' + captionVisionPatchLabel(finding));
  reject.addEventListener('click', function (event) {
    event.stopPropagation();
    rejectCaptionVisionFinding(finding);
  });
  wrap.appendChild(reject);
  return wrap;
}

function syncCaptionVisionUi() {
  var toggleWrap = document.getElementById('editor-caption-vision-toggle-wrap');
  var toggle = document.getElementById('editor-caption-vision-toggle');
  var status = document.getElementById('editor-caption-vision-status');
  var findings = document.getElementById('editor-caption-vision-findings');
  if (!toggleWrap || !toggle || !status || !findings) {
    throw new Error('Caption Vision controls are missing.');
  }

  var mediaItem = state && state.currentItem;
  var candidateVisible = !!(
    captionAssistCandidate &&
    mediaItem &&
    captionAssistCandidate.mediaKey === mediaItem.key
  );
  var mediaSupported = !!(mediaItem && isCaptionVisionSupportedMedia(mediaItem.fileName));
  var modelAvailable = !!captionVisionCapabilities.models.length;
  var supported = mediaSupported && modelAvailable;

  findings.innerHTML = '';
  findings.classList.add('hidden');
  status.classList.add('hidden');
  status.textContent = '';

  var suppliedResultVisible = !!(
    candidateVisible &&
    captionVisionResult &&
    captionVisionResult.mediaKey === mediaItem.key &&
    captionVisionResult.captionText === String(captionAssistCandidate.text || '') &&
    !captionVisionResult.requestFingerprint
  );

  toggleWrap.classList.toggle('hidden', !candidateVisible || !mediaSupported);
  toggle.checked = !!captionVisionEnabled;
  toggle.disabled = !modelAvailable;
  toggleWrap.title = modelAvailable
    ? 'Scan for incorrect or omitted visual details using the selected Vision model.'
    : (captionVisionCapabilities.loaded ? 'No Vision model is available.' : 'Vision models are still loading.');

  if (!candidateVisible || (!captionVisionEnabled && !suppliedResultVisible)) return;
  if (!suppliedResultVisible && !modelAvailable) {
    status.textContent = captionVisionCapabilities.loaded
      ? 'Vision enabled · no Vision model is currently available.'
      : 'Vision enabled · loading Vision models…';
    status.classList.remove('hidden');
    return;
  }
  if (!suppliedResultVisible && !mediaSupported) return;

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
    status.textContent = suppliedResultVisible
      ? 'No remaining actionable caption discrepancies.'
      : 'Vision found no meaningful discrepancy.';
    status.classList.remove('hidden');
    return;
  }

  captionVisionResult.findings.forEach(function (finding) {
    var pill = renderCaptionVisionFinding(finding);
    if (pill) findings.appendChild(pill);
  });
  if (findings.childNodes.length) findings.classList.remove('hidden');
}

window.setCaptionDiscrepancyFindingsForCandidate = setCaptionDiscrepancyFindingsForCandidate;

function getVisionImageCaptionEls() {
  var els = {
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
window.syncVisionImageCaptionSelection = syncVisionImageCaptionSelection;
window.runVisionImageCaption = runVisionImageCaption;
window.requestVisionImageCaptionDescription = requestVisionImageCaptionDescription;
window.requestVisionCaptionExtras = requestVisionCaptionExtras;

window.createCaptionVisionTask = createCaptionVisionTask;
window.cancelCaptionVisionTask = cancelCaptionVisionTask;
