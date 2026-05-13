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

function renderPhraseCopyPanel() {
  var container = document.getElementById('phrase-copy-items');
  container.innerHTML = '';
  captionHelperPhrases.sort(captionHelperSort);

  for (var i = 0; i < captionHelperPhrases.length; i++) {
    var phrase = captionHelperPhrases[i];
    var row = document.createElement('div');
    row.className = 'row-inline phrase-row-inline';

    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'phrase-copy-item-btn';
    copyBtn.textContent = phrase;
    (function (text) {
      copyBtn.onclick = function () {
        navigator.clipboard.writeText(text);
        setStatus('Copied phrase');
      };
    })(phrase);

    var insertBtn = document.createElement('button');
    insertBtn.type = 'button';
    insertBtn.title = 'Insert at cursor';
    insertBtn.textContent = '↑';
    (function (text) {
      insertBtn.onclick = function () {
        if (!ui || !ui.editorEl) return;
        if (ui.editorEl.readOnly) {
          setStatus('Cannot insert while editor is read-only.');
          return;
        }
        var editor = ui.editorEl;
        var value = editor.value || '';
        var start = typeof editor.selectionStart === 'number' ? editor.selectionStart : value.length;
        var end = typeof editor.selectionEnd === 'number' ? editor.selectionEnd : value.length;
        editor.value = value.slice(0, start) + text + value.slice(end);
        var caret = start + text.length;
        editor.focus();
        editor.setSelectionRange(caret, caret);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        setStatus('Inserted phrase at cursor.');
      };
    })(phrase);

    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '×';
    (function (idx) {
      removeBtn.onclick = function () {
        captionHelperPhrases.splice(idx, 1);
        saveCaptionHelpersToFolderState();
        renderPhraseCopyPanel();
      };
    })(i);

    row.appendChild(copyBtn);
    row.appendChild(insertBtn);
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

  requirementsBtn.onclick = function () { setCaptionHelperTab('requirements'); };
  phrasesBtn.onclick = function () { setCaptionHelperTab('phrases'); };
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
