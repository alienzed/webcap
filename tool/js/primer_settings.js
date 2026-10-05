function getPrimerTemplatePlaceholderItems() {
  var requirements = (
    typeof checklistItems !== 'undefined' &&
    Array.isArray(checklistItems) &&
    checklistItems.length
  )
    ? checklistItems.slice()
    : getDefaultRequirementItems().slice();
  var seen = {};
  var out = [];
  requirements.forEach(function (requirementLabel) {
    var label = String(requirementLabel || '').trim();
    if (!label) return;
    var key = typeof normalizeRequirementPrimerKey === 'function'
      ? normalizeRequirementPrimerKey(label)
      : label.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push({
      label: label,
      key: key,
      placeholder: '{' + key + '}'
    });
  });
  return out;
}

function insertPrimerTemplatePlaceholder(placeholderText) {
  var templateEl = document.getElementById('primer-template');
  if (!templateEl) return false;
  var insertion = String(placeholderText || '');
  if (!insertion) return false;
  var value = String(templateEl.value || '');
  var start = typeof templateEl.selectionStart === 'number' ? templateEl.selectionStart : value.length;
  var end = typeof templateEl.selectionEnd === 'number' ? templateEl.selectionEnd : value.length;
  templateEl.value = value.slice(0, start) + insertion + value.slice(end);
  if (state) state.folderHasSavedPrimerTemplate = true;
  var caret = start + insertion.length;
  templateEl.focus();
  templateEl.setSelectionRange(caret, caret);
  templateEl.dispatchEvent(new Event('input', { bubbles: true }));
  setStatus('Inserted placeholder: ' + insertion);
  return true;
}

function renderPrimerTemplatePlaceholderButtons() {
  var target = document.getElementById('primer-template-placeholders');
  if (!target) return;
  target.innerHTML = '';
  var items = getPrimerTemplatePlaceholderItems();
  if (!items.length) {
    var empty = document.createElement('div');
    empty.className = 'primer-template-placeholder-empty';
    empty.textContent = 'No requirement groups configured.';
    target.appendChild(empty);
    return;
  }
  items.forEach(function (item) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'primer-template-placeholder-btn';
    btn.textContent = item.label;
    btn.title = 'Insert placeholder for ' + item.label;
    btn.addEventListener('click', function () {
      insertPrimerTemplatePlaceholder(item.placeholder);
    });
    target.appendChild(btn);
  });
}

function resetPrimerTemplateSectionCollapsed() {
  var sectionEl = document.getElementById('primer-template-section');
  if (sectionEl) {
    sectionEl.open = false;
  }
}

function openPrimerTemplateHelpInPreview() {
  if (typeof renderAdvancedHelpPreview !== 'function') {
    setStatus('Help preview unavailable.');
    return;
  }
  renderAdvancedHelpPreview(
    'Caption Template Help',
    '<p style="margin:0 0 10px 0;">Caption Template builds a starter caption from your tags and template keys.</p>' +
    '<h4 style="margin:12px 0 6px 0;font-size:14px;">How It Works</h4>' +
    '<ul style="margin:0 0 8px 18px;padding:0;">' +
    '<li style="margin:0 0 6px 0;">Write placeholders like <code>{position}</code>, <code>{lighting}</code>, and <code>{view}</code>.</li>' +
    '<li style="margin:0 0 6px 0;">Use the live group placeholder buttons under the template to insert the current requirement keys without typing them manually.</li>' +
    '<li style="margin:0 0 6px 0;">If a placeholder has no matching value, it disappears cleanly.</li>' +
    '<li style="margin:0 0 6px 0;">Punctuation inside braces stays attached to the value, for example <code>{surface, }</code> becomes <code>wood floor, </code> only when a surface value exists.</li>' +
    '</ul>' +
    '<h4 style="margin:12px 0 6px 0;font-size:14px;">Default Template</h4>' +
    '<pre style="margin:0 0 8px 0;padding:10px;border-radius:6px;background:#f8fafc;overflow:auto;"><code>' + escapeHtml(getDefaultPrimerTemplate()) + '</code></pre>' +
    '<h4 style="margin:12px 0 6px 0;font-size:14px;">Example</h4>' +
    '<p style="margin:0 0 6px 0;">If the current item resolves to <code>standing</code>, <code>studio</code>, <code>smiling</code>, <code>soft</code>, and <code>front</code>, the result becomes:</p>' +
    '<p style="margin:0;"><code>standing studio, smiling,\nsoft lighting, front view.</code></p>'
  );
}

function statsGetPrimerOptionsFromDom() {
  var templateEl = document.getElementById('primer-template');
  return {
    template: templateEl ? templateEl.value : '',
    mappings: []
  };
}

var debouncedSaveFolderState = debounceCreate(600);
var primerResetUndoState = null; // { mediaKey, text }
var captionAssistPendingJobId = '';
var captionAssistCandidate = null; // { mediaKey, text }
var primerTemplateAssistPendingJobId = '';

function isCaptionAssistRunning() {
  return !!captionAssistPendingJobId;
}

function clearCaptionAssistCandidate() {
  captionAssistCandidate = null;
  syncCaptionAssistCandidateUi();
}

function useCaptionAssistCandidate() {
  var mediaItem = getPrimerResetCurrentMediaItem();
  if (!mediaItem || !captionAssistCandidate || captionAssistCandidate.mediaKey !== mediaItem.key) {
    setStatus('No AI caption candidate is available for this item.');
    syncCaptionAssistCandidateUi();
    return Promise.resolve(false);
  }

  var nextCaption = String(captionAssistCandidate.text || '');
  if (!isFocusedCaptionOpen()) {
    captionAssistCandidate = null;
    applyEditorTextAndTriggerInput(nextCaption);
    syncCaptionAssistCandidateUi();
    ui.editorEl.focus();
    setStatus('AI caption candidate moved into the editor.');
    return Promise.resolve(true);
  }

  cancelEditorAutosaveForCaption(state.folder, mediaItem.fileName);
  return saveCaptionDirect(state.folder, mediaItem.fileName, nextCaption, mediaItem.key, {
    skipRenderFileList: true
  }).then(function () {
    captionAssistCandidate = null;
    syncCaptionAssistCandidateUi();
    ui.editorEl.value = nextCaption;
    return advanceFocusedCaption();
  }).catch(function (err) {
    syncCaptionAssistCandidateUi();
    setStatus('Could not save AI caption candidate: ' + String(err && err.message ? err.message : err));
    return false;
  });
}

function dismissCaptionAssistCandidate() {
  clearCaptionAssistCandidate();
  if (isFocusedCaptionOpen()) {
    return advanceFocusedCaption();
  }
  setStatus('AI caption candidate dismissed.');
  return Promise.resolve(true);
}

var primerTemplateAssistCandidate = '';

function wireStatsPrimerAutoSave() {
  wirePrimerTemplateAssistUi();
  var statsFields = [
    document.getElementById('stats-required-phrase'),
    document.getElementById('stats-phrases'),
    document.getElementById('primer-template')
  ];
  statsFields.forEach(function (el) {
    if (el && !el.__autoSaveBound) {
      el.__autoSaveBound = true;
      el.addEventListener('input', function () {
        if (state && el.id === 'primer-template') {
          state.folderHasSavedPrimerTemplate = true;
        }
        refreshPrimerPreviewForCurrentItem();
        var capturedSave = captureCurrentFolderStateSave();
        debouncedSaveFolderState(function () {
          writeCapturedFolderState(capturedSave);
        });
        if (typeof updatePrimerCaptionResetUi === 'function') {
          updatePrimerCaptionResetUi();
        }
      });
    }
  });
}

function getPrimerResetCurrentMediaItem() {
  if (!state || !state.currentItem || !state.currentItem.fileName || !state.currentItem.key) return null;
  return state.currentItem;
}

var captionApplyConfirmation = null;

function syncCaptionApplyConfirmationUi() {
  var applyCaptionBtn = ui && ui.editorApplyPrimerBtn ? ui.editorApplyPrimerBtn : null;
  if (!applyCaptionBtn) return;
  var mediaItem = getPrimerResetCurrentMediaItem();
  var editorText = String((ui && ui.editorEl && ui.editorEl.value) || '');
  var confirmation = captionApplyConfirmation;
  if (!confirmation || !mediaItem || confirmation.mediaKey !== mediaItem.key || confirmation.text !== editorText) {
    captionApplyConfirmation = null;
    applyCaptionBtn.classList.remove('is-caption-apply-saving', 'is-caption-apply-saved', 'is-caption-apply-autosaved');
    applyCaptionBtn.disabled = false;
    applyCaptionBtn.textContent = 'Apply';
    applyCaptionBtn.title = 'Write the current caption to disk. Shift+click to apply it and go to the next captionless item.';
    return;
  }
  var isSaving = confirmation.state === 'saving';
  var isAutoSaved = confirmation.state === 'autosaved';
  applyCaptionBtn.classList.toggle('is-caption-apply-saving', isSaving);
  applyCaptionBtn.classList.toggle('is-caption-apply-saved', !isSaving && !isAutoSaved);
  applyCaptionBtn.classList.toggle('is-caption-apply-autosaved', isAutoSaved);
  applyCaptionBtn.disabled = isSaving;
  applyCaptionBtn.textContent = isSaving ? 'Saving…' : (confirmation.state === 'unchanged' ? 'Already saved' : (isAutoSaved ? 'Apply' : 'Saved ✓'));
  applyCaptionBtn.title = isSaving
    ? 'Saving current caption.'
    : (confirmation.state === 'unchanged'
      ? 'This caption is already saved.'
      : (isAutoSaved ? 'Caption saved automatically. Type to make further changes.' : 'Caption saved. Type to make further changes.'));
}

function setCaptionApplyConfirmation(mediaKey, text, confirmationState) {
  captionApplyConfirmation = {
    mediaKey: String(mediaKey || ''),
    text: String(text || ''),
    state: confirmationState || 'saved'
  };
  syncCaptionApplyConfirmationUi();
}

function clearCaptionApplyConfirmation() {
  if (!captionApplyConfirmation) return;
  captionApplyConfirmation = null;
  syncCaptionApplyConfirmationUi();
}

function syncCaptionAssistCandidateUi() {
  var panel = document.getElementById('editor-caption-candidate');
  var textEl = document.getElementById('editor-caption-candidate-text');
  if (!panel || !textEl) return;
  var mediaKey = state && state.currentItem && state.currentItem.key;
  var candidate = captionAssistCandidate;
  var visible = !!(candidate && mediaKey && candidate.mediaKey === mediaKey && candidate.text);
  panel.classList.toggle('hidden', !visible);
  textEl.textContent = visible ? candidate.text : '';
}

function updatePrimerCaptionResetUi() {
  var resetBtn = document.getElementById('primer-reset-caption-btn');
  var undoBtn = document.getElementById('primer-undo-reset-caption-btn');
  var applyCaptionBtn = ui && ui.editorApplyPrimerBtn ? ui.editorApplyPrimerBtn : null;
  var captionWandBtn = document.getElementById('editor-caption-wand-btn');
  if (!resetBtn || !undoBtn || !captionWandBtn) return;

  var mediaItem = getPrimerResetCurrentMediaItem();
  var hasSelectedMedia = !!(mediaItem && ui && ui.editorEl && !ui.editorEl.readOnly);
  if (!hasSelectedMedia) {
    resetBtn.classList.add('hidden');
    undoBtn.classList.add('hidden');
    captionWandBtn.classList.add('hidden');
    syncCaptionAssistCandidateUi();
    if (applyCaptionBtn) {
      syncCaptionApplyConfirmationUi();
      applyCaptionBtn.classList.add('hidden');
    }
    syncFocusedCaptionControls();
    return;
  }

  var primerText = String(buildAutoPrimer(mediaItem.fileName, mediaItem.key) || '');
  var editorText = String(ui.editorEl.value || '');
  var canReset = !!mediaItem.hasCaption && editorText.trim() !== primerText.trim();
  resetBtn.classList.toggle('hidden', !canReset);

  var canUndo = !!(primerResetUndoState && primerResetUndoState.mediaKey === mediaItem.key);
  undoBtn.classList.toggle('hidden', !canUndo);
  captionWandBtn.classList.remove('hidden');
  captionWandBtn.disabled = !!captionAssistPendingJobId;
  captionWandBtn.classList.toggle('is-pending', !!captionAssistPendingJobId);
  captionWandBtn.title = captionAssistPendingJobId
    ? 'AI caption candidate is being generated'
    : 'Generate a candidate caption from the selected annotations using the current Director model';
  syncCaptionAssistCandidateUi();
  if (applyCaptionBtn) {
    applyCaptionBtn.classList.remove('hidden');
    applyCaptionBtn.classList.toggle('is-captionless-apply', !mediaItem.hasCaption);
    syncCaptionApplyConfirmationUi();
  }
  syncFocusedCaptionControls();
}

function applyEditorTextAndTriggerInput(nextText) {
  if (!ui || !ui.editorEl) return;
  ui.editorEl.value = String(nextText || '');
  ui.editorEl.dispatchEvent(new Event('input', { bubbles: true }));
}

function syncCurrentFolderPrimerTemplateFromAppDefault() {
  var templateEl = document.getElementById('primer-template');
  if (!templateEl || (state && state.folderHasSavedPrimerTemplate)) {
    refreshCurrentPrimerDerivedUi();
    return false;
  }
  var nextTemplate = getDefaultPrimerTemplate();
  if (String(templateEl.value || '') !== String(nextTemplate || '')) {
    templateEl.value = nextTemplate;
  }
  refreshCurrentPrimerDerivedUi();
  return true;
}

function buildPrimerTemplateAssistRequest() {
  var templateEl = document.getElementById('primer-template');
  var groups = [];
  var items = Array.isArray(checklistItems) ? checklistItems.slice() : [];
  items.forEach(function (label) {
    var key = normalizeRequirementPrimerKey(label);
    if (!key) return;
    var terms = getChecklistKeywordTermsForRequirement(label).map(function (term) {
      var affixes = getChecklistGroupTermAffixes(label, term, '');
      return {
        value: term,
        descriptorPrefix: affixes.descriptorPrefix || '',
        descriptorSuffix: affixes.descriptorSuffix || '',
        wrapperPrefix: affixes.wrapperPrefix || '',
        wrapperSuffix: affixes.wrapperSuffix || '',
        renderedDefault: renderChecklistGroupTermWithAffixes(label, term, '') || term
      };
    });
    groups.push({
      label: label,
      key: key,
      separator: getChecklistPrimerSeparatorForRequirement(label),
      precedence: JSON.parse(JSON.stringify(checklistPrimerPrecedenceByGroup[label] || {})),
      terms: terms
    });
  });
  return {
    model: getDirectorModelPreference('webcap.director.model'),
    groups: groups,
    mappings: typeof getPrimerMappingsRows === 'function' ? getPrimerMappingsRows() : [],
    currentTemplate: templateEl ? String(templateEl.value || '') : ''
  };
}

function validatePrimerTemplateCandidate(template, request) {
  var text = String(template || '').trim();
  if (!text) throw new Error('Template Assist returned an empty template.');
  var available = {};
  (request.groups || []).forEach(function (group) { if (group && group.key) available[String(group.key).toLowerCase()] = true; });
  (request.mappings || []).forEach(function (mapping) { if (mapping && mapping.key) available[String(mapping.key).toLowerCase()] = true; });

  if (/^```/.test(text) || /```$/.test(text)) throw new Error('Template Assist returned markdown instead of template text.');
  var placeholderCount = 0;
  var stripped = text.replace(/\{([^{}]+)\}/g, function (_, rawInner) {
    placeholderCount += 1;
    var inner = String(rawInner || '');
    var parts = inner.split('|');
    var key = '';
    if (parts.length === 2) key = String(parts[0] || '').trim().toLowerCase();
    else if (parts.length === 3) key = String(parts[1] || '').trim().toLowerCase();
    else {
      var punctuated = inner.match(/^([^A-Za-z0-9_]*)([A-Za-z0-9_]+)([^A-Za-z0-9_]*)$/);
      key = punctuated ? String(punctuated[2] || '').toLowerCase() : String(inner || '').trim().toLowerCase();
    }
    if (!key || !available[key]) throw new Error('Template Assist invented an unavailable placeholder: {' + inner + '}');
    return '';
  });
  if (/[{}]/.test(stripped)) throw new Error('Template Assist returned malformed placeholder braces.');
  if (!placeholderCount) throw new Error('Template Assist returned no usable placeholders.');
  return text;
}

function syncPrimerTemplateAssistCandidateUi() {
  var panel = document.getElementById('primer-template-candidate');
  var textEl = document.getElementById('primer-template-candidate-text');
  if (!panel || !textEl) return;
  panel.classList.toggle('hidden', !primerTemplateAssistCandidate);
  textEl.textContent = primerTemplateAssistCandidate || '';
}

function runPrimerTemplateAssist() {
  if (primerTemplateAssistPendingJobId) {
    setStatus('Caption Template Assist is already running.');
    return Promise.resolve(false);
  }
  var request = buildPrimerTemplateAssistRequest();
  if (!request.model) {
    setStatus('Select a Director model before generating a Caption Template.');
    return Promise.resolve(false);
  }
  if (!request.groups.length && !request.mappings.length) {
    setStatus('Configure at least one tag group or Primer mapping first.');
    return Promise.resolve(false);
  }

  primerTemplateAssistPendingJobId = 'submitting';
  var wand = document.getElementById('primer-template-wand-btn');
  if (wand) wand.disabled = true;
  setStatus('Caption Template Assist queued...');
  return captionAssistRequestJson('/caption/template-assist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  }).then(function (payload) {
    if (!payload.job || !payload.job.jobId) throw new Error('Caption Template Assist did not return a queued job.');
    primerTemplateAssistPendingJobId = String(payload.job.jobId);
    trackTransientLlmJob(payload.job);
    setStatus(payload.job.status === 'queued' ? 'Caption Template Assist waiting in the LLM queue...' : 'Caption Template Assist writing...');
    return waitForCaptionAssistJob(payload.job);
  }).then(function (job) {
    var result = job.result && typeof job.result === 'object' ? job.result : {};
    primerTemplateAssistCandidate = validatePrimerTemplateCandidate(result.text, request);
    syncPrimerTemplateAssistCandidateUi();
    setStatus('AI Caption Template candidate ready.');
    return true;
  }).catch(function (err) {
    setStatus('Caption Template Assist failed: ' + String(err && err.message ? err.message : err));
    return false;
  }).then(function (result) {
    primerTemplateAssistPendingJobId = '';
    if (wand) wand.disabled = false;
    return result;
  }, function (err) {
    primerTemplateAssistPendingJobId = '';
    if (wand) wand.disabled = false;
    throw err;
  });
}

function wirePrimerTemplateAssistUi() {
  var wand = document.getElementById('primer-template-wand-btn');
  var use = document.getElementById('primer-template-candidate-use');
  var regenerate = document.getElementById('primer-template-candidate-regenerate');
  var dismiss = document.getElementById('primer-template-candidate-dismiss');
  var templateEl = document.getElementById('primer-template');
  if (!wand || !use || !regenerate || !dismiss || !templateEl) return;

  if (!wand.__primerTemplateAssistBound) {
    wand.__primerTemplateAssistBound = true;
    wand.addEventListener('click', runPrimerTemplateAssist);
  }
  if (!use.__primerTemplateAssistBound) {
    use.__primerTemplateAssistBound = true;
    use.addEventListener('click', function () {
      if (!primerTemplateAssistCandidate) return;
      templateEl.value = primerTemplateAssistCandidate;
      primerTemplateAssistCandidate = '';
      if (state) state.folderHasSavedPrimerTemplate = true;
      templateEl.dispatchEvent(new Event('input', { bubbles: true }));
      syncPrimerTemplateAssistCandidateUi();
      templateEl.focus();
      setStatus('AI Caption Template moved into the editor.');
    });
  }
  if (!regenerate.__primerTemplateAssistBound) {
    regenerate.__primerTemplateAssistBound = true;
    regenerate.addEventListener('click', function () {
      primerTemplateAssistCandidate = '';
      syncPrimerTemplateAssistCandidateUi();
      runPrimerTemplateAssist();
    });
  }
  if (!dismiss.__primerTemplateAssistBound) {
    dismiss.__primerTemplateAssistBound = true;
    dismiss.addEventListener('click', function () {
      primerTemplateAssistCandidate = '';
      syncPrimerTemplateAssistCandidateUi();
      setStatus('AI Caption Template candidate dismissed.');
    });
  }
}

function buildCaptionAssistRequest(mediaItem) {
  var mediaKey = mediaItem && mediaItem.key;
  if (!mediaKey) throw new Error('Caption Assist requires a selected media item.');

  var assignments = getChecklistAssignmentEntriesForMediaKey(mediaKey).map(function (entry) {
    return {
      group: String(entry.requirement || '').trim(),
      term: String(entry.term || '').trim()
    };
  }).filter(function (entry) {
    return !!entry.term;
  });

  var requiredPhraseEl = document.getElementById('stats-required-phrase');
  return {
    model: getDirectorModelPreference('webcap.director.model'),
    assignments: assignments,
    tags: getUnscopedTagsForMediaKey(mediaKey),
    requiredPhrase: requiredPhraseEl ? String(requiredPhraseEl.value || '').trim() : '',
    draft: String((ui && ui.editorEl && ui.editorEl.value) || '').trim()
  };
}

function captionAssistRequestJson(url, options) {
  return fetch(url, options || {}).then(function (response) {
    return response.json().then(function (payload) {
      if (!response.ok || !payload || payload.ok === false) {
        throw new Error(payload && payload.error ? payload.error : (response.statusText || 'Caption Assist request failed.'));
      }
      return payload;
    });
  });
}

function waitForCaptionAssistJob(job) {
  if (!job || !job.jobId) throw new Error('Caption Assist did not return a queued job.');
  trackTransientLlmJob(job);
  function poll(current) {
    var status = String(current.status || '');
    if (status === 'completed') return Promise.resolve(current);
    if (['failed', 'cancelled', 'stopped', 'interrupted'].indexOf(status) !== -1) {
      throw new Error(current.error || ('Caption Assist job ' + status + '.'));
    }
    return new Promise(function (resolve) { setTimeout(resolve, status === 'queued' ? 2000 : 1200); })
      .then(function () {
        return captionAssistRequestJson('/fs/director/job?job=' + encodeURIComponent(current.jobId) + '&consume=1');
      })
      .then(function (payload) {
        if (!payload.job) throw new Error('Caption Assist job response is missing its job.');
        trackTransientLlmJob(payload.job);
        return poll(payload.job);
      });
  }
  return poll(job);
}

function runCaptionAssist() {
  var mediaItem = getPrimerResetCurrentMediaItem();
  if (!mediaItem) {
    setStatus('Select a media item first.');
    return Promise.resolve(false);
  }
  if (captionAssistPendingJobId) {
    setStatus('Caption Assist is already running.');
    return Promise.resolve(false);
  }

  var request = buildCaptionAssistRequest(mediaItem);
  if (!request.model) {
    setStatus('Select a Director model before using Caption Assist.');
    return Promise.resolve(false);
  }

  var sourceMediaKey = mediaItem.key;
  setStatus('Caption Assist queued...');
  return captionAssistRequestJson('/caption/assist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  }).then(function (payload) {
    if (!payload.job || !payload.job.jobId) throw new Error('Caption Assist did not return a queued job.');
    captionAssistPendingJobId = String(payload.job.jobId);
    trackTransientLlmJob(payload.job);
    updatePrimerCaptionResetUi();
    setStatus(payload.job.status === 'queued' ? 'Caption Assist waiting in the LLM queue...' : 'Caption Assist writing...');
    return waitForCaptionAssistJob(payload.job);
  }).then(function (job) {
    var result = job.result && typeof job.result === 'object' ? job.result : {};
    var nextCaption = String(result.text || '').trim();
    if (!nextCaption) throw new Error('Caption Assist returned an empty caption.');
    if (!state.currentItem || state.currentItem.key !== sourceMediaKey) {
      setStatus('Caption Assist finished, but the selected media item changed; result was not applied.');
      return false;
    }
    captionAssistCandidate = {
      mediaKey: sourceMediaKey,
      text: nextCaption
    };
    syncCaptionAssistCandidateUi();
    setStatus('AI caption candidate ready.');
    return true;
  }).catch(function (err) {
    setStatus('Caption Assist failed: ' + String(err && err.message ? err.message : err));
    return false;
  }).then(function (result) {
    captionAssistPendingJobId = '';
    updatePrimerCaptionResetUi();
    syncFocusedCaptionAfterAssist(sourceMediaKey);
    return result;
  }, function (err) {
    captionAssistPendingJobId = '';
    updatePrimerCaptionResetUi();
    syncFocusedCaptionAfterAssist(sourceMediaKey);
    throw err;
  });
}

function wirePrimerCaptionResetUi() {
  var resetBtn = document.getElementById('primer-reset-caption-btn');
  var undoBtn = document.getElementById('primer-undo-reset-caption-btn');
  var applyCaptionBtn = ui && ui.editorApplyPrimerBtn ? ui.editorApplyPrimerBtn : null;
  var captionWandBtn = document.getElementById('editor-caption-wand-btn');
  var candidateUseBtn = document.getElementById('editor-caption-candidate-use');
  var candidateRegenerateBtn = document.getElementById('editor-caption-candidate-regenerate');
  var candidateDismissBtn = document.getElementById('editor-caption-candidate-dismiss');
  if (!resetBtn || !undoBtn || !captionWandBtn || !candidateUseBtn || !candidateRegenerateBtn || !candidateDismissBtn) return;

  if (!candidateUseBtn.__captionAssistBound) {
    candidateUseBtn.__captionAssistBound = true;
    candidateUseBtn.addEventListener('click', function () {
      useCaptionAssistCandidate();
    });
  }

  if (!candidateRegenerateBtn.__captionAssistBound) {
    candidateRegenerateBtn.__captionAssistBound = true;
    candidateRegenerateBtn.addEventListener('click', function () {
      captionAssistCandidate = null;
      syncCaptionAssistCandidateUi();
      runCaptionAssist();
    });
  }

  if (!candidateDismissBtn.__captionAssistBound) {
    candidateDismissBtn.__captionAssistBound = true;
    candidateDismissBtn.addEventListener('click', function () {
      dismissCaptionAssistCandidate();
    });
  }

  if (!captionWandBtn.__captionAssistBound) {
    captionWandBtn.__captionAssistBound = true;
    captionWandBtn.addEventListener('click', function () {
      runCaptionAssist();
    });
  }

  if (!resetBtn.__primerResetBound) {
    resetBtn.__primerResetBound = true;
    resetBtn.addEventListener('click', function () {
      var mediaItem = getPrimerResetCurrentMediaItem();
      if (!mediaItem) {
        setStatus('Select a media item first.');
        return;
      }
      var nextPrimer = buildAutoPrimer(mediaItem.fileName, mediaItem.key) || '';
      var previousText = String((ui && ui.editorEl && ui.editorEl.value) || '');
      if (previousText === nextPrimer) {
        setStatus('Caption already matches primer output (nothing to reset).');
        return;
      }
      primerResetUndoState = {
        mediaKey: mediaItem.key,
        text: previousText
      };
      saveCaptionDirect(state.folder, mediaItem.fileName, '', mediaItem.key)
        .then(function () {
          if (state.currentItem && state.currentItem.key === mediaItem.key) {
            state.currentItem.primerPreviewText = String(nextPrimer || '');
          }
          applyEditorTextAndTriggerInput(nextPrimer);
          refreshCurrentPrimerDerivedUi();
        })
        .catch(function (err) {
          primerResetUndoState = null;
          setStatus(String(err && err.message ? err.message : err));
        });
    });
  }

  if (!undoBtn.__primerResetBound) {
    undoBtn.__primerResetBound = true;
    undoBtn.addEventListener('click', function () {
      var mediaItem = getPrimerResetCurrentMediaItem();
      if (!mediaItem || !primerResetUndoState || primerResetUndoState.mediaKey !== mediaItem.key) {
        setStatus('No reset to undo for this item.');
        updatePrimerCaptionResetUi();
        return;
      }
      var restoreText = String(primerResetUndoState.text || '');
      saveCaptionDirect(state.folder, mediaItem.fileName, restoreText, mediaItem.key)
        .then(function () {
          primerResetUndoState = null;
          applyEditorTextAndTriggerInput(restoreText);
          updatePrimerCaptionResetUi();
        })
        .catch(function (err) {
          setStatus(String(err && err.message ? err.message : err));
        });
    });
  }

  if (applyCaptionBtn && !applyCaptionBtn.__captionApplyBound) {
    applyCaptionBtn.__captionApplyBound = true;
    applyCaptionBtn.addEventListener('click', function (event) {
      var mediaItem = getPrimerResetCurrentMediaItem();
      if (!mediaItem) {
        setStatus('Select a media item first.');
        updatePrimerCaptionResetUi();
        return;
      }
      var textToSave = String((ui && ui.editorEl && ui.editorEl.value) || '');
      var mediaKey = mediaItem.key;
      cancelEditorAutosaveForCaption(state.folder, mediaItem.fileName);
      if (textToSave === String(mediaItem.caption || '')) {
        setCaptionApplyConfirmation(mediaKey, textToSave, 'unchanged');
        setStatus('Caption already saved.');
        if (!event.shiftKey) return;
        return selectNextCaptionlessMediaItem(mediaKey).catch(function (err) {
          setStatus(String(err && err.message ? err.message : err));
        });
      }
      setCaptionApplyConfirmation(mediaKey, textToSave, 'saving');
      saveCaptionDirect(state.folder, mediaItem.fileName, textToSave, mediaItem.key, {
        skipRenderFileList: !!event.shiftKey
      })
        .then(function () {
          primerResetUndoState = null;
          if (state.currentItem && state.currentItem.key === mediaKey && String(ui.editorEl.value || '') === textToSave) {
            setCaptionApplyConfirmation(mediaKey, textToSave, 'saved');
          }
          updatePrimerCaptionResetUi();
          if (!event.shiftKey) return;
          return selectNextCaptionlessMediaItem(mediaKey)
            .then(function (moved) {
              if (!moved) renderFileList();
              return moved;
            })
            .catch(function (err) {
              setStatus(String(err && err.message ? err.message : err));
            });
        })
        .catch(function (err) {
          clearCaptionApplyConfirmation();
          setStatus(String(err && err.message ? err.message : err));
        });
    });
  }

  updatePrimerCaptionResetUi();
}
