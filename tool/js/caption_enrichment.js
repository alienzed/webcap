// Director additions use saved Sight. Suggestions are never applied automatically.
var captionAssistEnrichment = null;
var captionAssistEnrichmentLookahead = null; // at most one speculative Director job
var captionAssistEnrichmentCache = new Map(); // small, session-only parsed suggestions

function parseCaptionAssistEnrichment(text, caption) {
  var raw = String(text || '').trim().replace(/^\x60{3}(?:json)?\s*/i, '').replace(/\s*\x60{3}$/, '');
  var value = JSON.parse(raw);
  if (!value || !Array.isArray(value.suggestions))
    throw new Error('Director enrichment must return a JSON suggestions array.');
  var seen = Object.create(null), suggestions = [], rejected = [];
  value.suggestions.forEach(function (entry, index) {
    var anchor = String(entry && entry.anchor || '');
    var addition = String(entry && entry.addition || '');
    var start = anchor ? caption.indexOf(anchor) : -1;
    var valid = start >= 0 && caption.indexOf(anchor, start + anchor.length) < 0 && !!addition.trim();
    var key = anchor + '\n' + addition;
    if (!valid || seen[key]) { rejected.push(index + 1); return; }
    seen[key] = true;
    suggestions.push({ anchor: anchor, addition: addition, pending: true });
  });
  if (rejected.length && !suggestions.length)
    throw new Error('Director returned no unique, applicable caption anchors (' + rejected.join(', ') + ').');
  return {suggestions: suggestions, rejected: rejected};
}

function cancelCaptionAssistEnrichment() {
  var old = captionAssistEnrichment;
  captionAssistEnrichment = null;
  if (!old) return Promise.resolve(false);
  old.cancelled = true;
  if (!old.jobId || old.phase !== 'pending') return Promise.resolve(false);
  return cancelCaptionAssistJob(old.jobId).catch(function (err) {
    reportConsoleWarning('Caption enrichment', 'Cancel failed: ' + String(err && err.message || err));
    return false;
  });
}

function captionAssistEnrichmentReviewActive(candidate) {
  return !!(candidate && captionAssistEnrichment &&
    captionAssistEnrichment.phase === 'review' &&
    captionAssistEnrichment.candidate === candidate &&
    captionAssistEnrichment.mediaKey === candidate.mediaKey);
}

function captionAssistEnrichmentPendingSuggestions() {
  return captionAssistEnrichment.suggestions.filter(function (row) { return row.pending; });
}

function captionAssistEnrichmentInsert(text, row) {
  var at = text.indexOf(row.anchor);
  if (at < 0 || text.indexOf(row.anchor, at + row.anchor.length) !== -1)
    throw new Error('Caption suggestion anchor is no longer unique.');
  at += row.anchor.length;
  return text.slice(0, at) + row.addition + text.slice(at);
}

function syncCaptionAssistEnrichmentUi(candidate) {
  if (captionAssistEnrichment && captionAssistEnrichment.candidate !== candidate)
    cancelCaptionAssistEnrichment();
  var button = document.getElementById('editor-caption-enrich');
  var preview = document.getElementById('editor-caption-enrichment-preview');
  var actions = document.getElementById('editor-caption-enrichment-actions');
  var status = document.getElementById('editor-caption-enrichment-status');
  var acceptAll = document.getElementById('editor-caption-enrichment-accept-all');
  var discard = document.getElementById('editor-caption-enrichment-discard');
  var restore = document.getElementById('editor-caption-enrichment-restore');
  var done = document.getElementById('editor-caption-enrichment-done');
  if (!button || !preview || !actions || !status || !acceptAll || !discard || !restore || !done)
    throw new Error('Caption enrichment controls are missing.');
  var item = candidate && state.currentItem;
  var sight = item && ((item.metadata && item.metadata.vision_sight) ||
    (getMetadataForMedia(item.fileName) || {}).vision_sight);
  var hasSight = !!(sight && String(sight.description || '').trim());
  var active = captionAssistEnrichment;
  var busy = !!(active && active.phase === 'pending' && active.candidate === candidate);
  button.classList.toggle('hidden', !candidate || isFocusedQaReviewMode());
  button.disabled = !hasSight || busy || isCaptionAssistRunning();
  button.title = hasSight ? 'Propose optional details using saved Sight; existing caption stays intact' :
    'Saved Sight required. Refresh Sight in Details first.';
  button.textContent = busy ? '✦ Director reviewing…' : '✦ Enrich with Sight';
  var reviewing = captionAssistEnrichmentReviewActive(candidate);
  preview.classList.toggle('hidden', !reviewing);
  actions.classList.toggle('hidden', !reviewing && !busy);
  preview.replaceChildren();
  if (busy) {
    acceptAll.disabled = discard.disabled = restore.disabled = done.disabled = true;
    status.textContent = 'Director looking for missing visual details…';
    return;
  }
  if (!reviewing) return;

  var text = String(candidate.text || '');
  var pending = captionAssistEnrichmentPendingSuggestions().map(function (row, i) {
    return { row: row, i: i, at: text.indexOf(row.anchor) + row.anchor.length };
  }).sort(function (a,b) {return a.at - b.at || a.i - b.i;});
  var offset = 0;
  pending.forEach(function (part) {
    if (part.at < offset || part.at < part.row.anchor.length)
      throw new Error('Caption enrichment anchor is no longer valid.');
    preview.appendChild(document.createTextNode(text.slice(offset, part.at)));
    var mark = document.createElement('span');
    mark.className = 'caption-enrichment-proposal';
    var addition = document.createElement('span');
    addition.textContent = part.row.addition;
    mark.appendChild(addition);
    function action(label, title, keep) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.title = title;
      button.setAttribute('aria-label', title + ': ' + part.row.addition.trim());
      button.addEventListener('click', function () {resolveCaptionAssistEnrichment(part.row, keep);});
      mark.appendChild(button);
    }
    action('✓', 'Keep suggestion', true);
    action('×', 'Reject suggestion', false);
    preview.appendChild(mark);
    offset = part.at;
  });
  preview.appendChild(document.createTextNode(text.slice(offset)));
  status.textContent = pending.length
    ? pending.length + ' proposed detail' + (pending.length === 1 ? '' : 's') + ' · accept or reject individually'
    : 'All suggestions reviewed. Continue editing or restore the original.';
  acceptAll.disabled = discard.disabled = !pending.length;
  restore.disabled = text === active.originalText;
  done.disabled = false;
  done.textContent = 'Edit caption';
}

function updateCaptionAssistEnrichedDraft(text) {
  var candidate = captionAssistCandidate;
  if (!candidate || !state.currentItem || candidate.mediaKey !== state.currentItem.key)
    throw new Error('Caption enrichment lost its selected item.');
  candidate.text = text;
  var req = buildCaptionAssistRequest(state.currentItem);
  candidate.omittedAssignments = getCaptionAssistOmittedAssignments(
    candidate.mediaKey, text, req.assignments, req.tags);
  candidate.omittedCorrections = getCaptionAssistOmittedCorrections(
    candidate.mediaKey, text, req.assignments, req.tags);
  resetFocusedCaptionUseArm();
  syncCaptionAssistCandidateUi();
}

function resolveCaptionAssistEnrichment(row, keep) {
  if (!captionAssistEnrichmentReviewActive(captionAssistCandidate) ||
      captionAssistEnrichment.suggestions.indexOf(row) < 0 || !row.pending)
    throw new Error('Caption suggestion is no longer active.');
  row.pending = false;
  if (keep)
    updateCaptionAssistEnrichedDraft(captionAssistEnrichmentInsert(captionAssistCandidate.text, row));
  else
    syncCaptionAssistCandidateUi();
  // Once every suggestion is resolved, return to the normal editable draft.
  if (!captionAssistEnrichmentPendingSuggestions().length)
    finishCaptionAssistEnrichment('done');
}

function finishCaptionAssistEnrichment(mode) {
  if (!captionAssistEnrichmentReviewActive(captionAssistCandidate)) return false;
  var session = captionAssistEnrichment;
  if (mode === 'accept') {
    captionAssistEnrichmentPendingSuggestions().slice().forEach(function (row) {
      resolveCaptionAssistEnrichment(row, true);
    });
    // Resolving the last suggestion closes the read-only review automatically.
    return true;
  }
  if (mode === 'restore') updateCaptionAssistEnrichedDraft(session.originalText);
  else if (mode !== 'discard' && mode !== 'done')
    throw new Error('Unknown caption enrichment action: ' + mode);
  var cached = captionAssistEnrichmentCache.get(session.fingerprint);
  if (cached) cached.handled = true; // Explicit review is not offered again automatically.
  cancelCaptionAssistEnrichment();
  syncCaptionAssistCandidateUi();
  return true;
}

function captionAssistEnrichmentInputs(item, candidate) {
  if (!item || !candidate || item.key !== candidate.mediaKey || !String(candidate.text || '').trim()) return null;
  var request = buildCaptionAssistRequest(item);
  request.openSight = request.openSight || (getMetadataForMedia(item.fileName) || {}).vision_sight || null;
  if (!request.model || !request.openSight || !String(request.openSight.description || '').trim()) return null;
  var original = String(candidate.text || '');
  var fingerprint = JSON.stringify([
    String(state.folder || ''), item.key, original, request.model,
    captionAssistSightFingerprint(request.openSight),
    request.renderedPrimer, request.preferredCaptionSequence, request.assignments, request.tags
  ]);
  request.draft = original;
  request.mode = 'enrich';
  request.folder = String(state.folder || '');
  request.media = String(item.fileName || '');
  return {request:request, fingerprint:fingerprint, original:original};
}

function captionAssistEnrichmentInputsMatchCandidate(item, candidate, input) {
  var request = input.request;
  return (!candidate.model || candidate.model === request.model) &&
    (!candidate.sourceCaption || candidate.sourceCaption === String(item.caption || '')) &&
    (!candidate.annotationsAtGeneration ||
      candidate.annotationsAtGeneration === JSON.stringify([request.assignments, request.tags])) &&
    (!candidate.sightFingerprint ||
      candidate.sightFingerprint === captionAssistSightFingerprint(request.openSight));
}

function cancelCaptionAssistEnrichmentLookahead(preserveMediaKey) {
  var old = captionAssistEnrichmentLookahead;
  if (!old || (preserveMediaKey && old.mediaKey === preserveMediaKey)) return Promise.resolve(false);
  captionAssistEnrichmentLookahead = null;
  old.cancelled = true;
  if (!old.jobId || old.phase !== 'pending') return Promise.resolve(false);
  return cancelCaptionAssistJob(old.jobId).catch(function (err) {
    reportConsoleWarning('Caption enrichment lookahead', 'Cancel failed: ' + String(err && err.message || err));
    return false;
  });
}

function captionAssistEnrichmentRemember(task) {
  captionAssistEnrichmentCache.delete(task.fingerprint);
  captionAssistEnrichmentCache.set(task.fingerprint, {
    suggestions:task.suggestions.map(function (row) { return {anchor:row.anchor, addition:row.addition}; }),
    handled:false
  });
  while (captionAssistEnrichmentCache.size > 3)
    captionAssistEnrichmentCache.delete(captionAssistEnrichmentCache.keys().next().value);
}

function startCaptionAssistEnrichmentTask(item, candidate, input) {
  var task = {
    candidate:candidate, mediaKey:item.key, folder:String(state.folder || ''),
    fingerprint:input.fingerprint, originalText:input.original,
    phase:'pending', suggestions:[], jobId:'', cancelled:false, promise:null
  };
  task.promise = captionAssistRequestJson('/caption/assist', {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(input.request)
  }).then(function (payload) {
    if (!payload.job || !payload.job.jobId)
      throw new Error('Caption enrichment did not return a Director job.');
    if (task.cancelled) return cancelCaptionAssistJob(payload.job.jobId).then(function () { return null; });
    task.jobId = String(payload.job.jobId);
    return waitForCaptionAssistJob(payload.job);
  }).then(function (job) {
    if (task.cancelled || !job) return false;
    if (captionAssistEnrichment === task) {
      var currentInput = captionAssistEnrichmentInputs(state.currentItem, task.candidate);
      if (state.folder !== task.folder || !state.currentItem ||
          state.currentItem.key !== task.mediaKey ||
          captionAssistCandidate !== task.candidate ||
          task.candidate.text !== task.originalText ||
          !currentInput || currentInput.fingerprint !== task.fingerprint) {
        cancelCaptionAssistEnrichment();
        setStatus('Caption or Sight inputs changed during enrichment; old suggestions were discarded.');
        return false;
      }
    }
    var parsed = parseCaptionAssistEnrichment(job.result && job.result.text, task.originalText);
    if (parsed.rejected.length)
      reportConsoleWarning('Caption enrichment', 'Skipped ambiguous suggestions: ' + parsed.rejected.join(', '));
    task.phase = parsed.suggestions.length ? 'review' : 'empty';
    task.jobId = '';
    task.suggestions = parsed.suggestions;
    captionAssistEnrichmentRemember(task);
    if (captionAssistEnrichment === task) {
      if (task.phase === 'empty') captionAssistEnrichment = null;
      syncCaptionAssistCandidateUi();
      setStatus(task.suggestions.length
        ? 'Review proposed details inline; none have been applied.'
        : 'Director found no additional details to suggest.');
    }
    return true;
  }).catch(function (err) {
    if (task.cancelled) return false;
    if (captionAssistEnrichment === task) {
      captionAssistEnrichment = null;
      syncCaptionAssistCandidateUi();
      setStatus('Caption enrichment failed: ' + String(err && err.message || err));
    }
    reportConsoleError('Caption enrichment', err);
    return false;
  });
  return task;
}

function presentCaptionAssistEnrichmentTask(task, candidate) {
  if (!task || task.cancelled) return Promise.resolve(false);
  cancelCaptionAssistEnrichment();
  task.candidate = candidate;
  if (task.phase === 'empty') {
    setStatus('Director found no additional details to suggest.');
    return Promise.resolve(true);
  }
  captionAssistEnrichment = task;
  syncCaptionAssistCandidateUi();
  if (task.phase === 'pending') setStatus('Director examining saved Sight for missing caption details…');
  else setStatus('Review proposed details inline; none have been applied.');
  return task.promise || Promise.resolve(true);
}

function maybeRunCaptionAssistEnrichment() {
  var candidate = captionAssistCandidate;
  var item = state && state.currentItem;
  if (!candidate || !item || isFocusedQaReviewMode() || isCaptionAssistRunning()) return Promise.resolve(false);
  var input = captionAssistEnrichmentInputs(item, candidate);
  if (!input || !captionAssistEnrichmentInputsMatchCandidate(item, candidate, input)) return Promise.resolve(false);
  if (captionAssistEnrichment && captionAssistEnrichment.candidate === candidate &&
      captionAssistEnrichment.fingerprint === input.fingerprint)
    return captionAssistEnrichment.promise || Promise.resolve(true);
  if (captionAssistEnrichmentLookahead &&
      captionAssistEnrichmentLookahead.fingerprint === input.fingerprint) {
    var warmed = captionAssistEnrichmentLookahead;
    captionAssistEnrichmentLookahead = null;
    return presentCaptionAssistEnrichmentTask(warmed, candidate);
  }
  var cached = captionAssistEnrichmentCache.get(input.fingerprint);
  if (cached) {
    if (cached.handled || !cached.suggestions.length) return Promise.resolve(true);
    return presentCaptionAssistEnrichmentTask({
      candidate:candidate, mediaKey:item.key, folder:String(state.folder || ''),
      fingerprint:input.fingerprint, originalText:input.original, phase:'review', jobId:'',
      suggestions:cached.suggestions.map(function (row) {
        return {anchor:row.anchor, addition:row.addition, pending:true};
      })
    }, candidate);
  }
  return presentCaptionAssistEnrichmentTask(startCaptionAssistEnrichmentTask(item, candidate, input), candidate);
}

function warmCaptionAssistEnrichment(mediaItem, candidate) {
  if (!focusedCaptionState.open || isFocusedQaReviewMode()) return Promise.resolve(false);
  var input = captionAssistEnrichmentInputs(mediaItem, candidate);
  if (!input || !captionAssistEnrichmentInputsMatchCandidate(mediaItem, candidate, input))
    return Promise.resolve(false);
  if (captionAssistEnrichmentCache.has(input.fingerprint)) return Promise.resolve(true);
  if (captionAssistEnrichmentLookahead &&
      captionAssistEnrichmentLookahead.fingerprint === input.fingerprint)
    return captionAssistEnrichmentLookahead.promise;
  // No extra queue lane. One speculative request is allowed for the captured next item.
  cancelCaptionAssistEnrichmentLookahead();
  var task = startCaptionAssistEnrichmentTask(mediaItem, candidate, input);
  captionAssistEnrichmentLookahead = task;
  return task.promise;
}

function runCaptionAssistEnrichment() {
  var candidate = captionAssistCandidate;
  var item = state && state.currentItem;
  if (!candidate || !item || item.key !== candidate.mediaKey)
    throw new Error('Enrich with Sight requires a current Caption Assist candidate.');
  if (isCaptionAssistRunning() || (captionAssistEnrichment && captionAssistEnrichment.phase === 'pending'))
    return Promise.resolve(false);
  var input = captionAssistEnrichmentInputs(item, candidate);
  if (!input) {
    var request = buildCaptionAssistRequest(item);
    setStatus(!request.openSight || !String(request.openSight.description || '').trim()
      ? 'Save Sight for this item before enriching.'
      : (!request.model ? 'Select a Director model to enrich captions.' : 'Add a caption draft before enriching.'));
    return Promise.resolve(false);
  }
  // An explicit click refreshes the suggestions; automatic calls use the small cache.
  cancelCaptionAssistEnrichmentLookahead();
  return presentCaptionAssistEnrichmentTask(startCaptionAssistEnrichmentTask(item, candidate, input), candidate);
}

function wireCaptionAssistEnrichment() {
  var actions = {
    'editor-caption-enrich': runCaptionAssistEnrichment,
    'editor-caption-enrichment-accept-all': function () { finishCaptionAssistEnrichment('accept'); },
    'editor-caption-enrichment-discard': function () { finishCaptionAssistEnrichment('discard'); },
    'editor-caption-enrichment-restore': function () { finishCaptionAssistEnrichment('restore'); },
    'editor-caption-enrichment-done': function () { finishCaptionAssistEnrichment('done'); }
  };
  Object.keys(actions).forEach(function (id) {
    var button = document.getElementById(id);
    if (!button) throw new Error('Caption enrichment action missing: ' + id);
    button.addEventListener('click', actions[id]);
  });
}
