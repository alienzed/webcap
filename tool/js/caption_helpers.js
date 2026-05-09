// Caption helper tabs: requirements, phrases, set notes
var captionHelperActiveTab = 'requirements';
var captionHelperPhrases = [];
var captionHelperNotes = '';
var debouncedSetNotesSave = debounceCreate(500);

function captionHelperSort(a, b) {
  return String(a || '').toLowerCase().localeCompare(String(b || '').toLowerCase());
}

function setCaptionHelperTab(tabName) {
  captionHelperActiveTab = tabName;
  document.getElementById('caption-helper-tab-requirements-btn').classList.remove('active');
  document.getElementById('caption-helper-tab-phrases-btn').classList.remove('active');
  document.getElementById('caption-helper-tab-notes-btn').classList.remove('active');
  document.getElementById('caption-helper-tab-requirements').classList.add('hidden');
  document.getElementById('caption-helper-tab-phrases').classList.add('hidden');
  document.getElementById('caption-helper-tab-notes').classList.add('hidden');

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
  if (tabName === 'notes') {
    document.getElementById('caption-helper-tab-notes-btn').classList.add('active');
    document.getElementById('caption-helper-tab-notes').classList.remove('hidden');
    return;
  }

  throw new Error('Unknown caption helper tab: ' + tabName);
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
    row.className = 'row-inline';

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
    row.appendChild(removeBtn);
    container.appendChild(row);
  }
}

function loadCaptionHelpersFromFolderState(folderState) {
  captionHelperPhrases = (folderState.caption_phrases || []).slice();
  captionHelperNotes = String(folderState.caption_set_notes || '');
  document.getElementById('set-notes-editor').value = captionHelperNotes;
  renderPhraseCopyPanel();
}

function wireCaptionHelpersUi() {
  var requirementsBtn = document.getElementById('caption-helper-tab-requirements-btn');
  var phrasesBtn = document.getElementById('caption-helper-tab-phrases-btn');
  var notesBtn = document.getElementById('caption-helper-tab-notes-btn');
  var phraseAddInput = document.getElementById('phrase-copy-add-input');
  var phraseAddBtn = document.getElementById('phrase-copy-add-btn');
  var notesEditor = document.getElementById('set-notes-editor');

  requirementsBtn.onclick = function () { setCaptionHelperTab('requirements'); };
  phrasesBtn.onclick = function () { setCaptionHelperTab('phrases'); };
  notesBtn.onclick = function () { setCaptionHelperTab('notes'); };

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

  setCaptionHelperTab(captionHelperActiveTab);
  renderPhraseCopyPanel();
}
