// Caption helper tab switching, phrase panel, and folder-state loading.

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
  var phraseResults = document.getElementById('phrase-term-results');
  var tagResults = document.getElementById('tag-term-results');
  if (phraseResults) phraseResults.classList.add('hidden');
  if (tagResults) tagResults.classList.add('hidden');

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

function renderPhraseCopyPanel() {
  var container = document.getElementById('phrase-copy-items');
  if (!container) return;
  container.innerHTML = '';
  var activePhrases = Array.isArray(captionQuickPhrases) ? captionQuickPhrases.slice() : [];

  var liveCaption = (ui && ui.editorEl && typeof ui.editorEl.value === 'string')
    ? ui.editorEl.value
    : (state && state.currentItem && typeof state.currentItem.caption === 'string' ? state.currentItem.caption : '');

  if (!activePhrases.length) {
    var empty = document.createElement('div');
    empty.className = 'small';
    empty.textContent = 'No quick phrases. Add terms from phrase search.';
    container.appendChild(empty);
    return;
  }

  for (var i = 0; i < activePhrases.length; i++) {
    (function (idx) {
      var phrase = activePhrases[idx];
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

      var tagBtn = document.createElement('button');
      tagBtn.type = 'button';
      tagBtn.title = 'Add as tag to current media';
      tagBtn.textContent = 'Tag';
      (function (text) {
        tagBtn.onclick = function () {
          addTagToCurrentMedia(text);
        };
      })(phrase);

      var actions = document.createElement('div');
      actions.className = 'phrase-copy-actions';

      var moveUpBtn = document.createElement('button');
      moveUpBtn.type = 'button';
      moveUpBtn.className = 'stats-phrase-move-btn';
      moveUpBtn.title = 'Move up';
      moveUpBtn.textContent = '\u2191';
      moveUpBtn.onclick = function () {
        var moved = moveCaptionQuickPhraseByOffset(idx, -1);
        if (moved) {
          setStatus('Moved quick phrase up: ' + phrase);
        }
      };
      actions.appendChild(moveUpBtn);

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'stats-phrase-mini-btn';
      removeBtn.title = 'Remove quick phrase';
      removeBtn.textContent = 'X';
      removeBtn.onclick = function () {
        var next = captionQuickPhrases.slice();
        next.splice(idx, 1);
        setCaptionQuickPhrases(next, true);
        renderPhraseCopyPanel();
      };

      row.appendChild(phraseBtn);
      row.appendChild(tagBtn);
      actions.appendChild(removeBtn);
      row.appendChild(actions);
      container.appendChild(row);
    })(i);
  }
}

function loadCaptionHelpersFromFolderState(folderState) {
  captionHelperPhrases = [];
  (folderState.caption_phrases || []).forEach(function (phrase) {
    ensureCaptionHelperPhraseInCatalog(phrase, false, true);
  });
  setCaptionQuickPhrases(Array.isArray(folderState.quick_phrases) ? folderState.quick_phrases : [], false);
  captionQuickPhrases.forEach(function (phrase) {
    ensureCaptionHelperPhraseInCatalog(phrase, false, true);
  });
  captionHelperNotes = String(folderState.caption_set_notes || '');
  annotateStripVisible = !!folderState.annotate_strip_visible;
  captionHelperPanelCollapsed = !!folderState.caption_helper_panel_collapsed;
  updateAnnotateStripToggleUi();
  updateCaptionHelperCollapseUi();
  var notesEditor = document.getElementById('set-notes-editor');
  if (notesEditor) {
    notesEditor.value = captionHelperNotes;
  }
  renderPhraseCopyPanel();
  renderAnnotateStrip();
}

window.loadCaptionHelpersFromFolderState = loadCaptionHelpersFromFolderState;
window.renderPhraseCopyPanel = renderPhraseCopyPanel;
window.setCaptionHelperTab = setCaptionHelperTab;
