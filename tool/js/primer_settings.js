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
    '<p style="margin:0 0 10px 0;">Caption Template builds a starter caption from your tags and provides structure for Caption Assist. Saved Set templates take precedence over the app default.</p>' +
    '<h4 style="margin:12px 0 6px 0;font-size:14px;">How It Works</h4>' +
    '<ul style="margin:0 0 8px 18px;padding:0;">' +
    '<li style="margin:0 0 6px 0;">Write placeholders like <code>{position}</code>, <code>{lighting}</code>, and <code>{view}</code>.</li>' +
    '<li style="margin:0 0 6px 0;">Use the live group placeholder buttons under the template to insert the current requirement keys without typing them manually.</li>' +
    '<li style="margin:0 0 6px 0;">If a placeholder has no matching value, it disappears cleanly.</li>' +
    '<li style="margin:0 0 6px 0;">The built-in starter includes custom groups among the subject details. Use Template Assist to refine their placement from the group names and vocabulary, then review and accept the result.</li>' +
    '<li style="margin:0 0 6px 0;">Keep optional wording inside its placeholder: <code>{lighting| lighting.}</code> disappears entirely when lighting is absent.</li>' +
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
var captionAssistCandidate = null; // { mediaKey, text, missingGroups, omittedAssignments }
var captionAssistPresentationMediaKey = '';
var primerTemplateAssistPendingJobId = '';

function isCaptionAssistRunning() {
  return !!captionAssistPendingJobId;
}

function isCaptionAssistPresentationOpenFor(mediaKey) {
  var key = String(mediaKey || '').trim();
  return !!(key && captionAssistPresentationMediaKey === key);
}

function closeCaptionAssistPresentation() {
  captionAssistPresentationMediaKey = '';
}

function clearCaptionAssistCandidate() {
  captionAssistCandidate = null;
  cancelCurrentCaptionVision();
  clearCaptionVisionResult();
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
    closeCaptionAssistPresentation();
    captionAssistCandidate = null;
    applyEditorTextAndTriggerInput(nextCaption);
    syncCaptionAssistCandidateUi();
    ui.editorEl.focus();
    setStatus('AI caption candidate moved into the editor.');
    return Promise.resolve(true);
  }

  cancelEditorAutosaveForCaption(state.folder, mediaItem.fileName);
  var unchangedReview = isFocusedCaptionReviewMode() && nextCaption === String(mediaItem.caption || '');
  return cancelCurrentCaptionVision().then(function () {
    if (unchangedReview) return true;
    return saveCaptionDirect(state.folder, mediaItem.fileName, nextCaption, mediaItem.key, {
      skipRenderFileList: true
    });
  }).then(function () {
    captionAssistCandidate = null;
    syncCaptionAssistCandidateUi();
    ui.editorEl.value = nextCaption;
    setStatus(unchangedReview ? 'Caption accepted.' : 'Caption saved.');
    return advanceFocusedCaption();
  }).catch(function (err) {
    syncCaptionAssistCandidateUi();
    setStatus('Could not save AI caption candidate: ' + String(err && err.message ? err.message : err));
    return false;
  });
}

function cancelCaptionAssistGeneration() {
  if (isFocusedCaptionOpen()) return cancelFocusedCaptionCurrentRequest();

  var pendingJobId = String(captionAssistPendingJobId || '');
  var wasRunning = !!pendingJobId;
  closeCaptionAssistPresentation();
  captionAssistPendingJobId = '';
  captionAssistCandidate = null;
  updatePrimerCaptionResetUi();

  return cancelCurrentCaptionVision().then(function () {
    clearCaptionVisionResult();
    if (!pendingJobId || pendingJobId === 'submitting') return false;
    return cancelCaptionAssistJob(pendingJobId).catch(function (err) {
      reportConsoleWarning(
        'Caption Assist',
        'Could not cancel active Caption Assist job: ' + String(err && err.message ? err.message : err)
      );
      return false;
    });
  }).then(function () {
    syncCaptionAssistCandidateUi();
    if (wasRunning) setStatus('Caption Assist generation cancelled.');
    return wasRunning;
  });
}

function dismissCaptionAssistCandidate() {
  if (isFocusedCaptionOpen()) {
    if (!stopFocusedCaption('Focus Caption ended.')) return Promise.resolve(false);
    renderFileList();
    return Promise.resolve(true);
  }
  if (isCaptionAssistRunning()) return cancelCaptionAssistGeneration();
  closeCaptionAssistPresentation();
  clearCaptionAssistCandidate();
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

function markCaptionAssistGroupNotApplicable(mediaKey, requirementLabel) {
  var key = String(mediaKey || '').trim();
  var label = String(requirementLabel || '').trim();
  if (!key || !label) return false;
  setChecklistRequirementCheckedForMediaKey(key, label, true);
  if (captionAssistCandidate && captionAssistCandidate.mediaKey === key) {
    captionAssistCandidate.missingGroups = getCaptionAssistMissingGroups(key);
  }
  syncCaptionAssistCandidateUi();
  setStatus('Marked ' + label + ' N/A.');
  return true;
}

function renderCaptionAssistMissingGroups(container, mediaKey, missingGroups) {
  var groups = Array.isArray(missingGroups) ? missingGroups : [];
  container.innerHTML = '';
  container.classList.toggle('hidden', !groups.length);
  if (!groups.length) return;

  var label = document.createElement('span');
  label.className = 'caption-assist-missing-label';
  label.textContent = 'Still unreviewed:';
  container.appendChild(label);

  var list = document.createElement('span');
  list.className = 'caption-assist-missing-groups';
  groups.forEach(function (group) {
    var item = document.createElement('span');
    item.className = 'caption-assist-missing-group';

    var name = document.createElement('span');
    name.className = 'caption-assist-missing-group-name';
    name.textContent = group;
    item.appendChild(name);

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn caption-assist-na-btn';
    button.textContent = 'N/A';
    button.title = 'Mark ' + group + ' reviewed with no applicable tag';
    button.setAttribute('aria-label', 'Mark ' + group + ' not applicable');
    button.addEventListener('click', function () {
      markCaptionAssistGroupNotApplicable(mediaKey, group);
    });
    item.appendChild(button);
    list.appendChild(item);
  });
  container.appendChild(list);
}

function getFocusedCaptionCandidateSelectionOffsets(textEl) {
  var text = String(textEl && textEl.textContent || '');
  var selection = window.getSelection();
  if (!textEl || !selection || !selection.rangeCount) return { start: text.length, end: text.length };
  var range = selection.getRangeAt(0);
  if (!textEl.contains(range.startContainer) || !textEl.contains(range.endContainer)) {
    return { start: text.length, end: text.length };
  }
  var before = document.createRange();
  before.selectNodeContents(textEl);
  before.setEnd(range.startContainer, range.startOffset);
  var through = document.createRange();
  through.selectNodeContents(textEl);
  through.setEnd(range.endContainer, range.endOffset);
  return { start: before.toString().length, end: through.toString().length };
}

function setFocusedCaptionCandidateCaretOffset(textEl, offset) {
  var target = Math.max(0, Number(offset) || 0);
  var walker = document.createTreeWalker(textEl, NodeFilter.SHOW_TEXT);
  var node;
  while ((node = walker.nextNode())) {
    var length = node.nodeValue.length;
    if (target <= length) {
      var range = document.createRange();
      range.setStart(node, target);
      range.collapse(true);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    target -= length;
  }
  textEl.focus();
}

function insertFocusedCaptionVisionPhrase(phrase) {
  if (!isFocusedCaptionOpen() || !captionAssistCandidate || !state.currentItem) return false;
  if (captionAssistCandidate.mediaKey !== state.currentItem.key) return false;
  var textEl = document.getElementById('editor-caption-candidate-text');
  var value = String(phrase || '').trim();
  if (!textEl || !value) return false;

  var current = String(textEl.textContent || captionAssistCandidate.text || '');
  var offsets = getFocusedCaptionCandidateSelectionOffsets(textEl);
  var start = Math.max(0, Math.min(current.length, offsets.start));
  var end = Math.max(start, Math.min(current.length, offsets.end));
  var left = current.slice(0, start);
  var right = current.slice(end);
  var prefix = left && !/[\s([{"'/-]$/.test(left) ? ' ' : '';
  var suffix = right && !/^[\s.,;:!?)}\]"'/-]/.test(right) ? ' ' : '';
  var inserted = prefix + value + suffix;
  var next = left + inserted + right;

  captionAssistCandidate.text = next;
  resetFocusedCaptionUseArm();

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
  cancelCurrentCaptionVision();
  clearCaptionVisionResult();

  focusedCaptionVisionPhrases.phrases = focusedCaptionVisionPhrases.phrases.filter(function (extra) {
    return String(extra || '').trim().toLowerCase() !== value.toLowerCase();
  });

  textEl.textContent = next;
  textEl.focus();
  setFocusedCaptionCandidateCaretOffset(textEl, left.length + inserted.length);
  syncCaptionAssistCandidateUi();
  setStatus('Inserted Vision extra.');
  return true;
}

function syncFocusedCaptionVisionPhrasesUi() {
  var row = document.getElementById('editor-caption-vision-phrases');
  var trigger = document.getElementById('editor-caption-vision-phrases-btn');
  if (!row || !trigger) throw new Error('Focus Caption Vision extras controls are missing.');
  row.innerHTML = '';
  row.classList.add('hidden');
  trigger.classList.add('hidden');
  trigger.disabled = true;
}

function syncCaptionAssistCandidateUi() {
  var panel = document.getElementById('editor-caption-candidate');
  var titleEl = document.getElementById('editor-caption-candidate-title');
  var progressEl = document.getElementById('editor-caption-focus-progress');
  var loadingEl = document.getElementById('editor-caption-focus-loading');
  var loadingTextEl = document.getElementById('editor-caption-focus-loading-text');
  var omissionsEl = document.getElementById('editor-caption-candidate-omissions');
  var missingEl = document.getElementById('editor-caption-candidate-missing');
  var phrasesEl = document.getElementById('editor-caption-vision-phrases');
  var phrasesBtn = document.getElementById('editor-caption-vision-phrases-btn');
  var textEl = document.getElementById('editor-caption-candidate-text');
  var prevBtn = document.getElementById('editor-caption-focus-prev');
  var nextBtn = document.getElementById('editor-caption-focus-next');
  var cancelBtn = document.getElementById('editor-caption-focus-cancel');
  var useBtn = document.getElementById('editor-caption-candidate-use');
  var regenerateBtn = document.getElementById('editor-caption-candidate-regenerate');
  var dismissBtn = document.getElementById('editor-caption-candidate-dismiss');
  if (!panel || !titleEl || !progressEl || !loadingEl || !loadingTextEl || !omissionsEl || !missingEl || !phrasesEl || !phrasesBtn || !textEl || !prevBtn || !nextBtn || !cancelBtn || !useBtn || !regenerateBtn || !dismissBtn) {
    throw new Error('Caption Assist candidate markup is incomplete.');
  }

  var mediaKey = state && state.currentItem && state.currentItem.key;
  var candidate = captionAssistCandidate;
  var focusOpen = isFocusedCaptionOpen();
  var reviewMode = focusOpen && isFocusedCaptionReviewMode();
  var visible = !!(candidate && mediaKey && candidate.mediaKey === mediaKey && (reviewMode || candidate.text));
  var focusVisible = !!(focusOpen && mediaKey);
  var assistVisible = !!(!focusOpen && mediaKey && isCaptionAssistPresentationOpenFor(mediaKey));
  var panelVisible = focusVisible || assistVisible;
  var pending = panelVisible && isCaptionAssistRunning();
  var omittedAssignments = visible && Array.isArray(candidate.omittedAssignments) ? candidate.omittedAssignments : [];
  var missingGroups = visible ? getCaptionAssistMissingGroups(mediaKey) : [];

  panel.classList.toggle('hidden', !panelVisible);
  panel.classList.toggle('is-focus-caption', focusVisible);
  titleEl.textContent = reviewMode ? 'Focus Review' : (focusOpen ? 'Focus Caption' : 'Caption Assist');

  progressEl.classList.toggle('hidden', !focusOpen);
  progressEl.textContent = focusOpen ? getFocusedCaptionProgressText() : '';

  var loadingVisible = !visible && (focusOpen || pending);
  loadingEl.classList.toggle('hidden', !loadingVisible);
  if (loadingVisible) {
    loadingTextEl.textContent = pending
      ? 'Generating caption…'
      : (reviewMode ? 'Preparing review…' : 'Preparing caption…');
  }

  omissionsEl.classList.toggle('hidden', !omittedAssignments.length);
  omissionsEl.innerHTML = '';
  if (omittedAssignments.length) {
    var omissionText = document.createElement('span');
    omissionText.textContent = (reviewMode ? 'Caption' : 'Candidate') + ' omitted selected annotations: ' + omittedAssignments.join(' · ');
    omissionsEl.appendChild(omissionText);
    var fixOmissionsBtn = document.createElement('button');
    fixOmissionsBtn.type = 'button';
    fixOmissionsBtn.className = 'caption-assist-fix-btn';
    fixOmissionsBtn.textContent = 'Fix';
    fixOmissionsBtn.title = 'Revise this candidate to include the selected annotations';
    fixOmissionsBtn.addEventListener('click', function () {
      repairCaptionAssistCandidate(candidate.omittedCorrections || []);
    });
    omissionsEl.appendChild(fixOmissionsBtn);
  }

  renderCaptionAssistMissingGroups(missingEl, mediaKey, missingGroups);
  textEl.classList.toggle('hidden', !visible);
  textEl.setAttribute('contenteditable', visible ? 'true' : 'false');
  textEl.setAttribute('role', visible ? 'textbox' : 'document');
  textEl.setAttribute('aria-multiline', visible ? 'true' : 'false');
  var candidateText = visible ? String(candidate.text || '') : '';
  if (document.activeElement !== textEl || String(textEl.textContent || '') !== candidateText) {
    textEl.textContent = candidateText;
  }
  syncFocusedCaptionVisionPhrasesUi();

  prevBtn.classList.toggle('hidden', !focusOpen);
  nextBtn.classList.toggle('hidden', !focusOpen);
  prevBtn.disabled = focusOpen && !canNavigateFocusedCaption(-1);
  nextBtn.disabled = focusOpen && !canNavigateFocusedCaption(1);
  cancelBtn.classList.toggle('hidden', !pending);

  useBtn.classList.toggle('hidden', !visible);
  regenerateBtn.classList.toggle('hidden', !visible);
  useBtn.disabled = !!pending;
  regenerateBtn.disabled = !!pending;
  var useArmed = focusOpen && !reviewMode && visible && isFocusedCaptionUseArmedForCandidate(candidate);
  useBtn.classList.toggle('is-armed', !!useArmed);
  var reviewChanged = reviewMode && visible && String(candidate.text || '') !== String((state.currentItem && state.currentItem.caption) || '');
  useBtn.textContent = reviewMode
    ? (reviewChanged ? 'Save → Next' : 'Keep → Next')
    : (useArmed ? 'Press Enter again' : 'Apply Caption');

  regenerateBtn.textContent = '\u21bb';
  regenerateBtn.classList.toggle('is-primary', !!omittedAssignments.length);
  regenerateBtn.title = reviewMode
    ? 'Ask the Director for a rewritten caption'
    : (focusOpen && captionVisionEnabled
      ? 'Regenerate caption and recheck Vision'
      : 'Generate another caption candidate');
  regenerateBtn.setAttribute('aria-label', regenerateBtn.title);

  dismissBtn.textContent = '\u00d7';
  dismissBtn.title = focusOpen
    ? ('Exit ' + (reviewMode ? 'Focus Review' : 'Focus Caption'))
    : (pending ? 'Cancel generation and close Caption Assist' : 'Dismiss candidate and stay on this item');
  dismissBtn.setAttribute('aria-label', dismissBtn.title);

  syncCaptionVisionUi();
  if (focusOpen) syncFocusedCaptionPanelGeometry();
}
function updatePrimerCaptionResetUi() {
  var resetBtn = document.getElementById('primer-reset-caption-btn');
  var undoBtn = document.getElementById('primer-undo-reset-caption-btn');
  var applyCaptionBtn = ui && ui.editorApplyPrimerBtn ? ui.editorApplyPrimerBtn : null;
  var captionWandBtn = document.getElementById('editor-caption-wand-btn');
  if (!resetBtn || !undoBtn || !captionWandBtn) {
    throw new Error('Caption reset controls are missing.');
  }

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

function dismissPrimerTemplateAssistCandidate() {
  if (!primerTemplateAssistCandidate) return;
  primerTemplateAssistCandidate = '';
  syncPrimerTemplateAssistCandidateUi();
  setStatus('AI Caption Template candidate dismissed.');
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
  var panel = document.getElementById('primer-template-candidate');
  var templateEl = document.getElementById('primer-template');
  if (!wand || !use || !regenerate || !dismiss || !panel || !templateEl) return;

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
    dismiss.addEventListener('click', dismissPrimerTemplateAssistCandidate);
  }
  if (!panel.__primerTemplateAssistBackdropBound) {
    panel.__primerTemplateAssistBackdropBound = true;
    panel.addEventListener('click', function (event) {
      if (event.target === panel) dismissPrimerTemplateAssistCandidate();
    });
  }
  if (!document.__primerTemplateAssistEscapeBound) {
    document.__primerTemplateAssistEscapeBound = true;
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || !primerTemplateAssistCandidate) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dismissPrimerTemplateAssistCandidate();
    });
  }
}

function getCaptionAssistMissingGroups(mediaKey) {
  var assigned = {};
  getChecklistAssignmentEntriesForMediaKey(mediaKey).forEach(function (entry) {
    var group = String(entry && entry.requirement || '').trim().toLowerCase();
    var term = String(entry && entry.term || '').trim();
    if (group && term) assigned[group] = true;
  });
  return (Array.isArray(checklistItems) ? checklistItems : []).filter(function (label) {
    var key = String(label || '').trim().toLowerCase();
    if (!key || assigned[key]) return false;
    var reviewed = isChecklistRequirementCheckedForMediaKey(mediaKey, label);
    return !reviewed;
  });
}

function getCaptionAssistOmittedCorrections(mediaKey, captionText, assignments) {
  var seen = {};
  var omitted = [];
  (Array.isArray(assignments) ? assignments : []).forEach(function (entry) {
    var group = String(entry && entry.group || '').trim();
    var term = String(entry && entry.term || '').trim();
    if (!term) return;
    if (checklistGroupTermAppearsInCaptionText(group, term, mediaKey, captionText)) return;
    var key = (group + '\n' + term).toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    omitted.push({
      group: group,
      term: term,
      note: 'Selected annotation is missing from the current caption.'
    });
  });
  return omitted;
}

function getCaptionAssistOmittedAssignments(mediaKey, captionText, assignments) {
  return getCaptionAssistOmittedCorrections(mediaKey, captionText, assignments).map(function (entry) {
    return entry.group ? (entry.group + ' — ' + entry.term) : entry.term;
  });
}

function getCaptionAssistDraftForMediaItem(mediaItem) {
  var mediaKey = mediaItem && mediaItem.key;
  if (!mediaKey) throw new Error('Caption Assist requires a selected media item.');
  if (state && state.currentItem && state.currentItem.key === mediaKey && ui && ui.editorEl) {
    return String(ui.editorEl.value || '').trim();
  }
  var savedCaption = String(mediaItem.caption || '');
  if (savedCaption.trim()) return savedCaption.trim();
  return String(buildAutoPrimer(mediaItem.fileName, mediaKey) || '').trim();
}

function captionAssistRequestFingerprint(mediaItem, request) {
  return JSON.stringify({
    mediaKey: String(mediaItem && mediaItem.key || ''),
    request: request || {}
  });
}

function buildCaptionAssistRequest(mediaItem) {
  var mediaKey = mediaItem && mediaItem.key;
  if (!mediaKey) throw new Error('Caption Assist requires a selected media item.');

  var assignments = getChecklistAssignmentEntriesForMediaKey(mediaKey).map(function (entry) {
    return {
      group: String(entry.requirement || '').trim(),
      key: normalizeRequirementPrimerKey(entry.requirement),
      term: String(entry.term || '').trim()
    };
  }).filter(function (entry) {
    return !!entry.term;
  });

  var requiredPhraseEl = document.getElementById('stats-required-phrase');
  var primer = statsGetPrimerOptionsFromDom();
  return {
    model: getDirectorModelPreference('webcap.director.model'),
    assignments: assignments,
    tags: getUnscopedTagsForMediaKey(mediaKey),
    requiredPhrase: requiredPhraseEl ? String(requiredPhraseEl.value || '').trim() : '',
    preferredCaptionSequence: getPreferredCaptionSequence(),
    template: primer.template,
    renderedPrimer: buildPrimerFromConfig(mediaItem.fileName, mediaKey, primer),
    draft: getCaptionAssistDraftForMediaItem(mediaItem),
    openSight: mediaItem.metadata && mediaItem.metadata.vision_sight || null,
    contextSight: mediaItem.metadata && mediaItem.metadata.vision_vocabulary_sight || null
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

function cancelCaptionAssistJob(jobId) {
  var id = String(jobId || '').trim();
  if (!id) return Promise.resolve(false);
  return captionAssistRequestJson('/fs/director/job', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'cancel_job', jobId: id })
  }).then(function () {
    return true;
  });
}

function requestCaptionAssistCandidate(mediaItem, request, options) {
  var opts = options || {};
  var sourceMediaKey = String(mediaItem && mediaItem.key || '').trim();
  if (!sourceMediaKey) return Promise.reject(new Error('Caption Assist requires a selected media item.'));
  if (!request || !request.model) return Promise.reject(new Error('Select a Director model before using Caption Assist.'));
  var missingGroups = getCaptionAssistMissingGroups(sourceMediaKey);

  return captionAssistRequestJson('/caption/assist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  }).then(function (payload) {
    if (!payload.job || !payload.job.jobId) throw new Error('Caption Assist did not return a queued job.');
    trackTransientLlmJob(payload.job);
    var hookResult = opts.onJob ? opts.onJob(payload.job) : null;
    return Promise.resolve(hookResult).then(function () {
      return waitForCaptionAssistJob(payload.job);
    });
  }).then(function (job) {
    var result = job.result && typeof job.result === 'object' ? job.result : {};
    var nextCaption = String(result.text || '').trim();
    if (!nextCaption) throw new Error('Caption Assist returned an empty caption.');
    return {
      mediaKey: sourceMediaKey,
      text: nextCaption,
      missingGroups: missingGroups,
      omittedAssignments: getCaptionAssistOmittedAssignments(
        sourceMediaKey,
        nextCaption,
        request.assignments
      ),
      omittedCorrections: getCaptionAssistOmittedCorrections(
        sourceMediaKey,
        nextCaption,
        request.assignments
      ),
      requestFingerprint: captionAssistRequestFingerprint(mediaItem, request)
    };
  });
}

function repairCaptionAssistCandidate(corrections) {
  var mediaItem = getPrimerResetCurrentMediaItem();
  var candidate = captionAssistCandidate;
  var cleanCorrections = (Array.isArray(corrections) ? corrections : []).map(function (entry) {
    return {
      group: String(entry && entry.group || '').trim(),
      term: String(entry && entry.term || '').trim(),
      note: String(entry && entry.note || entry && entry.description || '').trim()
    };
  }).filter(function (entry) { return !!entry.term; });

  if (!mediaItem || !candidate || candidate.mediaKey !== mediaItem.key || !cleanCorrections.length) {
    setStatus('No caption correction is available.');
    return Promise.resolve(false);
  }
  if (captionAssistPendingJobId) {
    setStatus('Caption Assist is already running.');
    return Promise.resolve(false);
  }

  var request = buildCaptionAssistRequest(mediaItem);
  request.draft = String(candidate.text || '').trim();
  request.corrections = cleanCorrections;
  if (!request.model) {
    setStatus('Select a Director model before revising the caption.');
    return Promise.resolve(false);
  }

  var sourceMediaKey = mediaItem.key;
  var focusRequest = isFocusedCaptionOpen() ? beginFocusedCaptionRequest(sourceMediaKey) : null;
  if (!focusRequest) captionAssistPresentationMediaKey = sourceMediaKey;
  captionAssistPendingJobId = 'submitting';
  updatePrimerCaptionResetUi();
  setStatus('Caption Assist revising candidate...');
  return cancelCurrentCaptionVision().then(function () {
    return cancelFocusedCaptionPrefetch();
  }).then(function () {
    return requestCaptionAssistCandidate(mediaItem, request, {
      onJob: function (job) {
        if (
          (focusRequest && !isFocusedCaptionRequestCurrent(sourceMediaKey, focusRequest.token)) ||
          (!focusRequest && !isCaptionAssistPresentationOpenFor(sourceMediaKey))
        ) {
          return cancelCaptionAssistJob(String(job.jobId || ''));
        }
        captionAssistPendingJobId = String(job.jobId || '');
        updatePrimerCaptionResetUi();
        setStatus(job.status === 'queued' ? 'Caption repair waiting in the LLM queue...' : 'Caption Assist revising...');
        return null;
      }
    });
  }).then(function (nextCandidate) {
    if (focusRequest && !isFocusedCaptionRequestCurrent(sourceMediaKey, focusRequest.token)) return false;
    if (!focusRequest && !isCaptionAssistPresentationOpenFor(sourceMediaKey)) return false;
    if (!state.currentItem || state.currentItem.key !== sourceMediaKey) {
      setStatus('Caption repair finished, but the selected media item changed; result was not applied.');
      return false;
    }
    captionAssistCandidate = nextCandidate;
    syncCaptionAssistCandidateUi();
    setStatus(
      nextCandidate.omittedAssignments.length
        ? 'Caption repair still omits selected annotations.'
        : 'Caption repaired.'
    );
    if (isFocusedCaptionOpen()) {
      if (captionVisionEnabled) {
        return maybeRunCaptionVisionForCandidate(nextCandidate).then(function () {
          if (isFocusedCaptionOpen() && state.currentItem && state.currentItem.key === sourceMediaKey) {
            return startFocusedCaptionPrefetch(sourceMediaKey);
          }
          return true;
        });
      }
      return startFocusedCaptionPrefetch(sourceMediaKey);
    }
    return true;
  }).catch(function (err) {
    if (focusRequest && !isFocusedCaptionRequestCurrent(sourceMediaKey, focusRequest.token)) return false;
    if (!focusRequest && !isCaptionAssistPresentationOpenFor(sourceMediaKey)) return false;
    setStatus('Caption repair failed: ' + String(err && err.message ? err.message : err));
    reportConsoleError('Caption Assist', err);
    return false;
  }).then(function (result) {
    if (!focusRequest || isFocusedCaptionRequestCurrent(sourceMediaKey, focusRequest.token)) {
      captionAssistPendingJobId = '';
      updatePrimerCaptionResetUi();
      syncFocusedCaptionAfterAssist(sourceMediaKey);
    }
    return result;
  }, function (err) {
    if (!focusRequest || isFocusedCaptionRequestCurrent(sourceMediaKey, focusRequest.token)) {
      captionAssistPendingJobId = '';
      updatePrimerCaptionResetUi();
      syncFocusedCaptionAfterAssist(sourceMediaKey);
    }
    throw err;
  });
}

function blendFocusedCaptionVisionPhrase(phrase) {
  var mediaItem = getPrimerResetCurrentMediaItem();
  var candidate = captionAssistCandidate;
  var detail = String(phrase || '').trim();
  if (
    !isFocusedCaptionOpen() ||
    !mediaItem ||
    !candidate ||
    candidate.mediaKey !== mediaItem.key ||
    !detail
  ) {
    setStatus('No Vision extra is available to blend.');
    return Promise.resolve(false);
  }
  if (captionAssistPendingJobId) {
    setStatus('Caption Assist is already running.');
    return Promise.resolve(false);
  }

  var request = buildCaptionAssistRequest(mediaItem);
  var currentDraft = String(candidate.text || '').trim();
  request.draft = currentDraft
    ? (currentDraft + (/[.!?]$/.test(currentDraft) ? ' ' : ', ') + detail)
    : detail;
  if (!request.model) {
    setStatus('Select a Director model before blending the Vision extra.');
    return Promise.resolve(false);
  }

  var sourceMediaKey = mediaItem.key;
  var focusRequest = beginFocusedCaptionRequest(sourceMediaKey);
  captionAssistPendingJobId = 'submitting';
  updatePrimerCaptionResetUi();
  setStatus('Blending Vision extra into caption...');

  return cancelCurrentCaptionVision().then(function () {
    return cancelFocusedCaptionPrefetch();
  }).then(function () {
    return requestCaptionAssistCandidate(mediaItem, request, {
      onJob: function (job) {
        if (!isFocusedCaptionRequestCurrent(sourceMediaKey, focusRequest.token)) {
          return cancelCaptionAssistJob(String(job.jobId || ''));
        }
        captionAssistPendingJobId = String(job.jobId || '');
        updatePrimerCaptionResetUi();
        setStatus(job.status === 'queued' ? 'Vision extra blend waiting in the LLM queue...' : 'Blending Vision extra...');
        return null;
      }
    });
  }).then(function (nextCandidate) {
    if (!isFocusedCaptionRequestCurrent(sourceMediaKey, focusRequest.token)) return false;
    if (!state.currentItem || state.currentItem.key !== sourceMediaKey) return false;
    captionAssistCandidate = nextCandidate;
    syncCaptionAssistCandidateUi();
    setStatus('Vision extra blended.');
    if (captionVisionEnabled) {
      return maybeRunCaptionVisionForCandidate(nextCandidate).then(function () {
        if (isFocusedCaptionOpen() && state.currentItem && state.currentItem.key === sourceMediaKey) {
          return startFocusedCaptionPrefetch(sourceMediaKey);
        }
        return true;
      });
    }
    return startFocusedCaptionPrefetch(sourceMediaKey);
  }).catch(function (err) {
    if (isFocusedCaptionRequestCurrent(sourceMediaKey, focusRequest.token)) {
      setStatus('Vision extra blend failed: ' + String(err && err.message ? err.message : err));
      reportConsoleError('Caption Assist', err);
    }
    return false;
  }).then(function (result) {
    if (isFocusedCaptionRequestCurrent(sourceMediaKey, focusRequest.token)) {
      captionAssistPendingJobId = '';
      updatePrimerCaptionResetUi();
    }
    return result;
  }, function (err) {
    if (isFocusedCaptionRequestCurrent(sourceMediaKey, focusRequest.token)) {
      captionAssistPendingJobId = '';
      updatePrimerCaptionResetUi();
    }
    throw err;
  });
}

function runCaptionAssist() {
  var item = getPrimerResetCurrentMediaItem();
  if (!item) return Promise.resolve(false);
  var sourceKey = item.key;
  if (!getDirectorModelPreference('webcap.director.model')) {
    setStatus('Select a Director model before using Caption Assist.');
    return Promise.resolve(false);
  }
  var existingSight = item.metadata && item.metadata.vision_sight;
  setStatus('Caption Assist: preparing visual evidence…');
  return refreshSetIntelligenceItem(item, {
    open: !existingSight || !existingSight.description || !existingSight.inventory,
    context: true
  }).then(function () {
    if (!state.currentItem || state.currentItem.key !== sourceKey) return false;
    return runCaptionAssistAfterSight();
  }).catch(function (err) {
    reportConsoleError('Caption Assist Sight', err);
    setStatus('Caption Assist could not prepare Sight: ' + String(err && err.message || err));
    return false;
  });
}

function runCaptionAssistAfterSight() {
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
  var focusRequest = isFocusedCaptionOpen() ? beginFocusedCaptionRequest(sourceMediaKey) : null;
  if (!focusRequest) captionAssistPresentationMediaKey = sourceMediaKey;
  captionAssistPendingJobId = 'submitting';
  updatePrimerCaptionResetUi();
  setStatus('Caption Assist queued...');
  return requestCaptionAssistCandidate(mediaItem, request, {
    onJob: function (job) {
      if (
        (focusRequest && !isFocusedCaptionRequestCurrent(sourceMediaKey, focusRequest.token)) ||
        (!focusRequest && !isCaptionAssistPresentationOpenFor(sourceMediaKey))
      ) {
        return cancelCaptionAssistJob(String(job.jobId || ''));
      }
      captionAssistPendingJobId = String(job.jobId || '');
      updatePrimerCaptionResetUi();
      setStatus(job.status === 'queued' ? 'Caption Assist waiting in the LLM queue...' : 'Caption Assist writing...');
      return null;
    }
  }).then(function (candidate) {
    if (focusRequest && !isFocusedCaptionRequestCurrent(sourceMediaKey, focusRequest.token)) return false;
    if (!focusRequest && !isCaptionAssistPresentationOpenFor(sourceMediaKey)) return false;
    if (!state.currentItem || state.currentItem.key !== sourceMediaKey) {
      if (!focusRequest) closeCaptionAssistPresentation();
      setStatus('Caption Assist finished, but the selected media item changed; result was not applied.');
      return false;
    }
    captionAssistCandidate = candidate;
    syncCaptionAssistCandidateUi();
    setStatus(
      candidate.omittedAssignments.length
        ? 'Caption Assist candidate failed annotation validation.'
        : 'AI caption candidate ready.'
    );
    // The current item's fresh Context Sight preceded this Director result.
    // A second pixel read is only requested by the explicit Recheck Vision action.
    // The item pipeline has already obtained fresh Context Sight. Do not
    // enqueue an unrelated Vision Extras read or speculative next-item LLM.

    return true;
  }).catch(function (err) {
    if (focusRequest && !isFocusedCaptionRequestCurrent(sourceMediaKey, focusRequest.token)) return false;
    if (!focusRequest && !isCaptionAssistPresentationOpenFor(sourceMediaKey)) return false;
    if (!focusRequest) closeCaptionAssistPresentation();
    setStatus('Caption Assist failed: ' + String(err && err.message ? err.message : err));
    return false;
  }).then(function (result) {
    if (!focusRequest || isFocusedCaptionRequestCurrent(sourceMediaKey, focusRequest.token)) {
      captionAssistPendingJobId = '';
      updatePrimerCaptionResetUi();
      syncFocusedCaptionAfterAssist(sourceMediaKey);
    }
    return result;
  }, function (err) {
    if (!focusRequest || isFocusedCaptionRequestCurrent(sourceMediaKey, focusRequest.token)) {
      captionAssistPendingJobId = '';
      updatePrimerCaptionResetUi();
      syncFocusedCaptionAfterAssist(sourceMediaKey);
    }
    throw err;
  });
}

window.repairCaptionAssistCandidate = repairCaptionAssistCandidate;
window.blendFocusedCaptionVisionPhrase = blendFocusedCaptionVisionPhrase;

function runCaptionAssistFromUi() {
  if (!isFocusedCaptionOpen()) return runCaptionAssist();
  return cancelFocusedCaptionPrefetch().then(function () {
    return runCaptionAssist();
  });
}

function wirePrimerCaptionResetUi() {
  var resetBtn = document.getElementById('primer-reset-caption-btn');
  var undoBtn = document.getElementById('primer-undo-reset-caption-btn');
  var applyCaptionBtn = ui && ui.editorApplyPrimerBtn ? ui.editorApplyPrimerBtn : null;
  var captionWandBtn = document.getElementById('editor-caption-wand-btn');
  var candidatePanel = document.getElementById('editor-caption-candidate');
  var candidateUseBtn = document.getElementById('editor-caption-candidate-use');
  var candidateTextEl = document.getElementById('editor-caption-candidate-text');
  var visionPhrasesBtn = document.getElementById('editor-caption-vision-phrases-btn');
  var candidateRegenerateBtn = document.getElementById('editor-caption-candidate-regenerate');
  var candidateDismissBtn = document.getElementById('editor-caption-candidate-dismiss');
  var focusPrevBtn = document.getElementById('editor-caption-focus-prev');
  var focusNextBtn = document.getElementById('editor-caption-focus-next');
  var focusCancelBtn = document.getElementById('editor-caption-focus-cancel');
  if (!resetBtn || !undoBtn || !captionWandBtn || !candidatePanel || !candidateUseBtn || !candidateTextEl || !visionPhrasesBtn || !candidateRegenerateBtn || !candidateDismissBtn || !focusPrevBtn || !focusNextBtn || !focusCancelBtn) {
    throw new Error('Caption Assist controls are missing.');
  }

  if (!candidateTextEl.__captionAssistEditBound) {
    candidateTextEl.__captionAssistEditBound = true;
    candidateTextEl.addEventListener('input', function () {
      if (!captionAssistCandidate || !state.currentItem) return;
      if (captionAssistCandidate.mediaKey !== state.currentItem.key) return;
      captionAssistCandidate.text = String(candidateTextEl.textContent || '');
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
      cancelCurrentCaptionVision();
      clearCaptionVisionResult();
      if (isFocusedCaptionOpen()) {
        resetFocusedCaptionUseArm();
      }
      syncCaptionAssistCandidateUi();
    });
  }

  if (!visionPhrasesBtn.__focusedCaptionPhrasesBound) {
    visionPhrasesBtn.__focusedCaptionPhrasesBound = true;
    visionPhrasesBtn.addEventListener('click', function () {
      loadFocusedCaptionVisionPhrases();
    });
  }

  if (!candidateUseBtn.__captionAssistBound) {
    candidateUseBtn.__captionAssistBound = true;
    candidateUseBtn.addEventListener('click', function () {
      if (isFocusedCaptionOpen()) resetFocusedCaptionUseArm();
      useCaptionAssistCandidate();
    });
  }

  if (!candidateRegenerateBtn.__captionAssistBound) {
    candidateRegenerateBtn.__captionAssistBound = true;
    candidateRegenerateBtn.addEventListener('click', function () {
      if (isFocusedCaptionOpen()) {
        regenerateFocusedCaption();
        return;
      }
      cancelCurrentCaptionVision().then(function () {
        captionAssistCandidate = null;
        return runCaptionAssistFromUi();
      });
    });
  }

  if (!focusPrevBtn.__captionAssistBound) {
    focusPrevBtn.__captionAssistBound = true;
    focusPrevBtn.addEventListener('click', function () {
      if (isFocusedCaptionOpen()) moveFocusedCaption(-1);
    });
  }
  if (!focusNextBtn.__captionAssistBound) {
    focusNextBtn.__captionAssistBound = true;
    focusNextBtn.addEventListener('click', function () {
      if (isFocusedCaptionOpen()) moveFocusedCaption(1);
    });
  }
  if (!focusCancelBtn.__captionAssistBound) {
    focusCancelBtn.__captionAssistBound = true;
    focusCancelBtn.addEventListener('click', function () {
      if (!isFocusedCaptionOpen()) {
        cancelCaptionAssistGeneration();
        return;
      }
      cancelFocusedCaptionCurrentRequest().then(function () {
        if (isFocusedCaptionOpen()) {
          syncCaptionAssistCandidateUi();
          setStatus('Focus Caption generation cancelled.');
        }
      });
    });
  }

  if (!candidateDismissBtn.__captionAssistBound) {
    candidateDismissBtn.__captionAssistBound = true;
    candidateDismissBtn.addEventListener('click', function () {
      dismissCaptionAssistCandidate();
    });
  }

  if (!candidatePanel.__captionAssistBackdropBound) {
    candidatePanel.__captionAssistBackdropBound = true;
    candidatePanel.addEventListener('click', function (event) {
      if (event.target !== candidatePanel) return;
      if (isFocusedCaptionOpen()) {
        if (!stopFocusedCaption('Focus Caption ended.')) return;
        renderFileList();
        return;
      }
      dismissCaptionAssistCandidate();
    });
  }

  if (!document.__captionAssistEscapeBound) {
    document.__captionAssistEscapeBound = true;
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if (isFocusedCaptionOpen()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!stopFocusedCaption('Focus Caption ended.')) return;
        renderFileList();
        return;
      }
      var mediaKey = state && state.currentItem && state.currentItem.key;
      if (!captionAssistCandidate && !isCaptionAssistPresentationOpenFor(mediaKey)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dismissCaptionAssistCandidate();
    }, true);
  }

  if (!captionWandBtn.__captionAssistBound) {
    captionWandBtn.__captionAssistBound = true;
    captionWandBtn.addEventListener('click', function () {
      runCaptionAssistFromUi();
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
