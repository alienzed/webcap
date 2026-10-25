// Opt-in Director additions from cached Sight. No edits until explicitly accepted.
var captionAssistEnrichment = null;
var captionAssistEnrichmentSequence = 0;

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
  captionAssistEnrichmentSequence++;
  if (!old || !old.jobId) return Promise.resolve(false);
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
  if (busy) { status.textContent = 'Director looking for missing visual details…'; return; }
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
}

function finishCaptionAssistEnrichment(mode) {
  if (!captionAssistEnrichmentReviewActive(captionAssistCandidate)) return false;
  var session = captionAssistEnrichment;
  if (mode === 'accept') {
    captionAssistEnrichmentPendingSuggestions().slice().forEach(function (row) {
      resolveCaptionAssistEnrichment(row, true);
    });
    return true;
  }
  if (mode === 'restore') updateCaptionAssistEnrichedDraft(session.originalText);
  else if (mode !== 'discard' && mode !== 'done')
    throw new Error('Unknown caption enrichment action: ' + mode);
  cancelCaptionAssistEnrichment();
  syncCaptionAssistCandidateUi();
  return true;
}

function runCaptionAssistEnrichment() {
  var candidate = captionAssistCandidate;
  var item = state && state.currentItem;
  if (!candidate || !item || item.key !== candidate.mediaKey)
    throw new Error('Enrich with Sight requires a current Caption Assist candidate.');
  if (isCaptionAssistRunning() || (captionAssistEnrichment && captionAssistEnrichment.phase === 'pending'))
    return Promise.resolve(false);
  var request = buildCaptionAssistRequest(item);
  request.openSight = request.openSight || (getMetadataForMedia(item.fileName) || {}).vision_sight || null;
  if (!request.openSight || !String(request.openSight.description || '').trim()) {
    setStatus('Save Sight for this item before enriching.');
    return Promise.resolve(false);
  }
  if (!request.model) {
    setStatus('Select a Director model to enrich captions.');
    return Promise.resolve(false);
  }
  cancelCaptionAssistEnrichment();
  var token = ++captionAssistEnrichmentSequence;
  var original = String(candidate.text || '');
  request.draft = original;
  request.mode = 'enrich';
  var session = {phase:'pending',candidate:candidate,mediaKey:item.key,
    folder:String(state.folder || ''), originalText:original,
    suggestions:[],jobId:'',token:token};
  captionAssistEnrichment = session;
  syncCaptionAssistCandidateUi();
  setStatus('Director examining saved Sight for missing caption details…');
  return captionAssistRequestJson('/caption/assist', {
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)
  }).then(function (payload) {
    if (!payload.job || !payload.job.jobId)
      throw new Error('Caption enrichment did not return a Director job.');
    if (captionAssistEnrichment !== session || token !== captionAssistEnrichmentSequence)
      return cancelCaptionAssistJob(payload.job.jobId).then(function () {return null;});
    session.jobId = String(payload.job.jobId);
    return waitForCaptionAssistJob(payload.job);
  }).then(function (job) {
    if (!job || captionAssistEnrichment !== session || token !== captionAssistEnrichmentSequence)
      return false;
    if (state.folder !== session.folder || !state.currentItem ||
        state.currentItem.key !== session.mediaKey ||
        captionAssistCandidate !== candidate || candidate.text !== original) {
      cancelCaptionAssistEnrichment();
      setStatus('Caption changed during enrichment; old suggestions were discarded.');
      return false;
    }
    var parsed = parseCaptionAssistEnrichment(job.result && job.result.text, original);
    if (parsed.rejected.length)
      reportConsoleWarning('Caption enrichment', 'Skipped ambiguous suggestions: ' + parsed.rejected.join(', '));
    session.phase = 'review';
    session.jobId = '';
    session.suggestions = parsed.suggestions;
    syncCaptionAssistCandidateUi();
    setStatus(parsed.suggestions.length
      ? 'Review proposed details inline; none have been applied.'
      : 'Director found no additional details to suggest.');
    return true;
  }).catch(function (err) {
    if (captionAssistEnrichment !== session || token !== captionAssistEnrichmentSequence) return false;
    cancelCaptionAssistEnrichment();
    syncCaptionAssistCandidateUi();
    reportConsoleError('Caption enrichment', err);
    setStatus('Caption enrichment failed: ' + String(err && err.message || err));
    return false;
  });
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
