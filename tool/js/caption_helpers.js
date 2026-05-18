// Caption helper tabs: requirements, phrases, and tags (set notes live in Set Config).
var captionHelperActiveTab = 'requirements';
var captionHelperPhrases = [];
var captionHelperNotes = '';
var debouncedSetNotesSave = debounceCreate(500);

function captionHelperSort(a, b) {
  return String(a || '').toLowerCase().localeCompare(String(b || '').toLowerCase());
}

function setCaptionHelperTab(tabName) {
  if (tabName !== 'requirements' && tabName !== 'phrases' && tabName !== 'tags' && tabName !== 'metadata') {
    tabName = 'requirements';
  }
  captionHelperActiveTab = tabName;
  document.getElementById('caption-helper-tab-requirements-btn').classList.remove('active');
  document.getElementById('caption-helper-tab-phrases-btn').classList.remove('active');
  document.getElementById('caption-helper-tab-tags-btn').classList.remove('active');
  document.getElementById('caption-helper-tab-metadata-btn').classList.remove('active');
  document.getElementById('caption-helper-tab-requirements').classList.add('hidden');
  document.getElementById('caption-helper-tab-phrases').classList.add('hidden');
  document.getElementById('caption-helper-tab-tags').classList.add('hidden');
  document.getElementById('caption-helper-tab-metadata').classList.add('hidden');

  if (tabName === 'requirements') {
    document.getElementById('caption-helper-tab-requirements-btn').classList.add('active');
    document.getElementById('caption-helper-tab-requirements').classList.remove('hidden');
    return;
  }
  if (tabName === 'phrases') {
    document.getElementById('caption-helper-tab-phrases-btn').classList.add('active');
    document.getElementById('caption-helper-tab-phrases').classList.remove('hidden');
    return;
  }
  if (tabName === 'tags') {
    document.getElementById('caption-helper-tab-tags-btn').classList.add('active');
    document.getElementById('caption-helper-tab-tags').classList.remove('hidden');
    return;
  }
  if (tabName === 'metadata') {
    document.getElementById('caption-helper-tab-metadata-btn').classList.add('active');
    document.getElementById('caption-helper-tab-metadata').classList.remove('hidden');
    return;
  }
}

function saveCaptionHelpersToFolderState() {
  var snapshot = snapshotFolderStateFromDom();
  snapshot.caption_phrases = captionHelperPhrases.slice();
  snapshot.caption_set_notes = captionHelperNotes;
  writeFolderStateFile(state.folder, snapshot);
}

function captionPhraseBoundaryPattern(phrase) {
  var escapedPhrase = String(phrase || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escapedPhrase) return null;
  return new RegExp('(^|[^A-Za-z0-9_])(' + escapedPhrase + ')(?=$|[^A-Za-z0-9_])', 'i');
}

function captionPhraseMatch(value, phrase) {
  var pattern = captionPhraseBoundaryPattern(phrase);
  if (!pattern) return null;
  var text = String(value || '');
  var match = pattern.exec(text);
  if (!match) return null;
  var leading = match[1] || '';
  var matchedText = match[2] || '';
  var start = match.index + leading.length;
  var end = start + matchedText.length;
  return { start: start, end: end };
}

function captionContainsPhrase(value, phrase) {
  return !!captionPhraseMatch(value, phrase);
}

function joinCaptionParts(before, after) {
  if (before && after) {
    return before.replace(/[ \t]+$/, '') + ' ' + after.replace(/^[ \t]+/, '');
  }
  if (before) return before.replace(/[ \t]+$/, '');
  if (after) return after.replace(/^[ \t]+/, '');
  return '';
}

function insertCaptionPhraseAtCursor(text) {
  if (!ui || !ui.editorEl) return false;
  if (ui.editorEl.readOnly) {
    setStatus('Cannot insert while editor is read-only.');
    return false;
  }
  var phrase = String(text || '').trim();
  if (!phrase) return false;
  var editor = ui.editorEl;
  var value = editor.value || '';
  var start = typeof editor.selectionStart === 'number' ? editor.selectionStart : value.length;
  var end = typeof editor.selectionEnd === 'number' ? editor.selectionEnd : value.length;
  var before = value.slice(0, start).replace(/[ \t]+$/, '');
  var after = value.slice(end).replace(/^[ \t]+/, '');
  var leading = before && !/\s$/.test(before) ? ' ' : '';
  var trailing = after && /^\s/.test(after) ? '' : ' ';
  var insertion = leading + phrase + trailing;
  editor.value = before + insertion + after;
  var caret = before.length + insertion.length;
  editor.focus();
  editor.setSelectionRange(caret, caret);
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  setStatus('Inserted phrase at cursor.');
  return true;
}

function removeCaptionPhraseFromCaption(text) {
  if (!ui || !ui.editorEl) return false;
  if (ui.editorEl.readOnly) {
    setStatus('Cannot edit while editor is read-only.');
    return false;
  }
  var phrase = String(text || '').trim();
  if (!phrase) return false;
  var editor = ui.editorEl;
  var value = editor.value || '';
  var match = captionPhraseMatch(value, phrase);
  if (!match) return false;

  var start = match.start;
  var end = match.end;
  var nextValue = joinCaptionParts(value.slice(0, start), value.slice(end));
  editor.value = nextValue;
  var caret = Math.min(start, nextValue.length);
  editor.focus();
  editor.setSelectionRange(caret, caret);
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  setStatus('Removed phrase from caption.');
  return true;
}

function toggleCaptionPhraseAtCursor(text) {
  var phrase = String(text || '').trim();
  if (!phrase || !ui || !ui.editorEl) return;
  var value = ui.editorEl.value || '';
  if (captionContainsPhrase(value, phrase)) {
    removeCaptionPhraseFromCaption(phrase);
    return;
  }
  insertCaptionPhraseAtCursor(phrase);
}

function renderPhraseCopyPanel() {
  var container = document.getElementById('phrase-copy-items');
  if (!container) return;
  container.innerHTML = '';
  captionHelperPhrases.sort(captionHelperSort);

  var liveCaption = (ui && ui.editorEl && typeof ui.editorEl.value === 'string')
    ? ui.editorEl.value
    : (state && state.currentItem && typeof state.currentItem.caption === 'string' ? state.currentItem.caption : '');

  for (var i = 0; i < captionHelperPhrases.length; i++) {
    var phrase = captionHelperPhrases[i];
    var isMatched = !!(phrase && captionContainsPhrase(liveCaption, phrase));
    var row = document.createElement('div');
    row.className = 'row-inline phrase-row-inline';

    var phraseBtn = document.createElement('button');
    phraseBtn.type = 'button';
    phraseBtn.className = 'phrase-copy-item-btn';
    phraseBtn.title = isMatched ? 'Remove from caption' : 'Insert at cursor';
    phraseBtn.textContent = phrase;
    if (isMatched) {
      phraseBtn.classList.add('phrase-copy-item-matched');
    }
    (function (text) {
      phraseBtn.onclick = function () {
        toggleCaptionPhraseAtCursor(text);
      };
    })(phrase);

    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.title = 'Copy phrase';
    copyBtn.textContent = '📋';
    (function (text) {
      copyBtn.onclick = function () {
        navigator.clipboard.writeText(text);
        setStatus('Copied phrase');
      };
    })(phrase);

    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = 'X';
    (function (idx) {
      removeBtn.onclick = function () {
        captionHelperPhrases.splice(idx, 1);
        saveCaptionHelpersToFolderState();
        renderPhraseCopyPanel();
      };
    })(i);

    row.appendChild(phraseBtn);
    row.appendChild(copyBtn);
    row.appendChild(removeBtn);
    container.appendChild(row);
  }
}

function loadCaptionHelpersFromFolderState(folderState) {
  captionHelperPhrases = (folderState.caption_phrases || []).slice();
  captionHelperNotes = String(folderState.caption_set_notes || '');
  var notesEditor = document.getElementById('set-notes-editor');
  if (notesEditor) {
    notesEditor.value = captionHelperNotes;
  }
  renderPhraseCopyPanel();
}

function wireCaptionHelpersUi() {
  var requirementsBtn = document.getElementById('caption-helper-tab-requirements-btn');
  var phrasesBtn = document.getElementById('caption-helper-tab-phrases-btn');
  var tagsBtn = document.getElementById('caption-helper-tab-tags-btn');
  var metadataBtn = document.getElementById('caption-helper-tab-metadata-btn');
  var phraseAddInput = document.getElementById('phrase-copy-add-input');
  var phraseAddBtn = document.getElementById('phrase-copy-add-btn');
  var notesEditor = document.getElementById('set-notes-editor');

  requirementsBtn.onclick = function () {
    setCaptionHelperTab('requirements');
    if (typeof renderChecklistPanel === 'function') {
      renderChecklistPanel();
    }
  };
  phrasesBtn.onclick = function () {
    setCaptionHelperTab('phrases');
    renderPhraseCopyPanel();
  };
  if (tagsBtn) {
    tagsBtn.onclick = function () { setCaptionHelperTab('tags'); };
  }
  if (metadataBtn) {
    metadataBtn.onclick = function () { setCaptionHelperTab('metadata'); };
  }

  phraseAddBtn.onclick = function () {
    var text = phraseAddInput.value.trim();
    if (!text || captionHelperPhrases.indexOf(text) !== -1) return;
    captionHelperPhrases.push(text);
    phraseAddInput.value = '';
    saveCaptionHelpersToFolderState();
    renderPhraseCopyPanel();
  };

  phraseAddInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      phraseAddBtn.onclick();
    }
  });

  if (notesEditor) {
    notesEditor.addEventListener('input', function () {
      captionHelperNotes = notesEditor.value;
      debouncedSetNotesSave(saveCaptionHelpersToFolderState);
    });

    notesEditor.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        captionHelperNotes = notesEditor.value;
        saveCaptionHelpersToFolderState();
        setStatus('Set notes saved.');
      }
    });
  }

  setCaptionHelperTab(captionHelperActiveTab);
  renderPhraseCopyPanel();
}
