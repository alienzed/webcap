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

function wireStatsPrimerAutoSave() {
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
        debouncedSaveFolderState(function () {
          saveFolderStateForCurrentRoot();
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

function updatePrimerCaptionResetUi() {
  var resetBtn = document.getElementById('primer-reset-caption-btn');
  var undoBtn = document.getElementById('primer-undo-reset-caption-btn');
  var applyCaptionBtn = ui && ui.editorApplyPrimerBtn ? ui.editorApplyPrimerBtn : null;
  if (!resetBtn || !undoBtn) return;

  var mediaItem = getPrimerResetCurrentMediaItem();
  var hasSelectedMedia = !!(mediaItem && ui && ui.editorEl && !ui.editorEl.readOnly);
  if (!hasSelectedMedia) {
    resetBtn.classList.add('hidden');
    undoBtn.classList.add('hidden');
    if (applyCaptionBtn) applyCaptionBtn.classList.add('hidden');
    return;
  }

  var primerText = String(buildAutoPrimer(mediaItem.fileName, mediaItem.key) || '');
  var editorText = String(ui.editorEl.value || '');
  var canReset = !!mediaItem.hasCaption && editorText.trim() !== primerText.trim();
  resetBtn.classList.toggle('hidden', !canReset);

  var canUndo = !!(primerResetUndoState && primerResetUndoState.mediaKey === mediaItem.key);
  undoBtn.classList.toggle('hidden', !canUndo);
  if (applyCaptionBtn) {
    applyCaptionBtn.classList.remove('hidden');
    applyCaptionBtn.classList.toggle('is-captionless-apply', !mediaItem.hasCaption);
  }
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

function wirePrimerCaptionResetUi() {
  var resetBtn = document.getElementById('primer-reset-caption-btn');
  var undoBtn = document.getElementById('primer-undo-reset-caption-btn');
  var applyCaptionBtn = ui && ui.editorApplyPrimerBtn ? ui.editorApplyPrimerBtn : null;
  if (!resetBtn || !undoBtn) return;

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
      saveCaptionDirect(state.folder, mediaItem.fileName, textToSave, mediaItem.key)
        .then(function () {
          primerResetUndoState = null;
          updatePrimerCaptionResetUi();
          if (!event.shiftKey) return;
          return selectNextCaptionlessMediaItem(mediaKey).catch(function (err) {
            setStatus(String(err && err.message ? err.message : err));
          });
        })
        .catch(function (err) {
          setStatus(String(err && err.message ? err.message : err));
        });
    });
  }

  updatePrimerCaptionResetUi();
}
