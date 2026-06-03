// Caption helper UI wiring and searchable term interactions.

function wireCaptionHelpersUi() {
  var requirementsBtn = document.getElementById('caption-helper-tab-requirements-btn');
  var phrasesBtn = document.getElementById('caption-helper-tab-phrases-btn');
  var tagsBtn = document.getElementById('caption-helper-tab-tags-btn');
  var metadataBtn = document.getElementById('caption-helper-tab-metadata-btn');
  var phraseInput = document.getElementById('phrase-term-input');
  var phraseApplyBtn = document.getElementById('phrase-term-apply-btn');
  var phraseResults = document.getElementById('phrase-term-results');
  var tagInput = document.getElementById('tag-term-input');
  var tagApplyBtn = document.getElementById('tag-term-apply-btn');
  var tagResults = document.getElementById('tag-term-results');
  var notesEditor = document.getElementById('set-notes-editor');
  var annotateStripToggleBtn = document.getElementById('annotate-strip-toggle-btn');
  var annotateStripToggleInlineBtn = document.getElementById('annotate-strip-toggle-inline-btn');
  var helperCollapseToggleBtn = document.getElementById('caption-helper-collapse-btn');
  var helperCollapseInlineToggleBtn = document.getElementById('caption-helper-collapse-inline-btn');

  function expandHelperPanelForTabSwitch() {
    if (captionHelperPanelCollapsed) {
      setCaptionHelperPanelCollapsed(false, true);
    }
  }

  requirementsBtn.onclick = function () {
    expandHelperPanelForTabSwitch();
    setCaptionHelperTab('requirements');
    if (typeof renderChecklistPanel === 'function') {
      renderChecklistPanel();
    }
  };
  phrasesBtn.onclick = function () {
    expandHelperPanelForTabSwitch();
    setCaptionHelperTab('phrases');
    renderPhraseCopyPanel();
  };
  if (tagsBtn) {
    tagsBtn.onclick = function () {
      expandHelperPanelForTabSwitch();
      setCaptionHelperTab('tags');
    };
  }
  if (metadataBtn) {
    metadataBtn.onclick = function () {
      expandHelperPanelForTabSwitch();
      setCaptionHelperTab('metadata');
    };
  }
  if (annotateStripToggleBtn) {
    annotateStripToggleBtn.onclick = function () {
      setAnnotateStripVisible(!annotateStripVisible, true);
    };
  }
  if (annotateStripToggleInlineBtn) {
    annotateStripToggleInlineBtn.onclick = function () {
      setAnnotateStripVisible(!annotateStripVisible, true);
    };
  }
  if (helperCollapseToggleBtn) {
    helperCollapseToggleBtn.onclick = function () {
      setCaptionHelperPanelCollapsed(!captionHelperPanelCollapsed, true);
    };
  }
  if (helperCollapseInlineToggleBtn) {
    helperCollapseInlineToggleBtn.onclick = function () {
      setCaptionHelperPanelCollapsed(!captionHelperPanelCollapsed, true);
    };
  }

  function clearResults(el) {
    if (!el) return;
    el.innerHTML = '';
    el.classList.add('hidden');
  }

  function rankCatalogTerms(query) {
    var q = normalizeCatalogTerm(query).toLowerCase();
    if (!q) return [];
    var allTerms = getCaptionHelperCatalogTerms();
    var exact = [];
    var startsWith = [];
    var contains = [];
    allTerms.forEach(function (term) {
      var low = term.toLowerCase();
      if (low === q) {
        exact.push(term);
        return;
      }
      if (low.indexOf(q) === 0) {
        startsWith.push(term);
        return;
      }
      if (low.indexOf(q) !== -1) {
        contains.push(term);
      }
    });
    return exact.concat(startsWith, contains).slice(0, 12);
  }

  function buildResultRow(mainText, onMain, secondaryText, onSecondary) {
    var row = document.createElement('div');
    row.className = 'caption-term-result-row';
    var mainBtn = document.createElement('button');
    mainBtn.type = 'button';
    mainBtn.className = 'phrase-copy-item-btn caption-term-result-main';
    mainBtn.textContent = mainText;
    mainBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    mainBtn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      onMain();
    };
    row.appendChild(mainBtn);
    if (secondaryText && typeof onSecondary === 'function') {
      var secondaryBtn = document.createElement('button');
      secondaryBtn.type = 'button';
      secondaryBtn.className = 'caption-term-result-quick';
      secondaryBtn.textContent = secondaryText;
      secondaryBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
      secondaryBtn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        onSecondary();
      };
      row.appendChild(secondaryBtn);
    }
    return row;
  }

  function applyTagTerm(rawText) {
    var text = normalizeCatalogTerm(rawText);
    if (!text) return;
    if (!state.currentItem || !state.currentItem.key) {
      setStatus('Select a media item to add tags.');
      return;
    }
    ensureCaptionHelperPhraseInCatalog(text, false);
    var alreadyTagged = hasTagForMediaKey(state.currentItem.key, text);
    if (!alreadyTagged) {
      addTagToCurrentMedia(text);
    } else {
      setStatus('Tag already assigned.');
    }
    saveCaptionHelpersToFolderState();
    renderPhraseCopyPanel();
    if (tagInput) tagInput.value = '';
    clearResults(tagResults);
  }

  function applyQuickPhraseTerm(rawText) {
    var text = normalizeCatalogTerm(rawText);
    if (!text) return;
    ensureCaptionHelperPhraseInCatalog(text, false);
    var added = addCaptionQuickPhrase(text, true);
    if (!added) {
      setStatus('Already in quicklist.');
      return;
    }
    renderPhraseCopyPanel();
    setStatus('Added to quicklist: ' + text);
    if (phraseInput) phraseInput.value = '';
    clearResults(phraseResults);
  }

  function renderPhraseResults(query) {
    if (!phraseResults) return;
    var q = normalizeCatalogTerm(query).toLowerCase();
    if (!q) {
      clearResults(phraseResults);
      return;
    }
    var ranked = rankCatalogTerms(q);
    phraseResults.innerHTML = '';
    if (!ranked.length) {
      phraseResults.appendChild(buildResultRow(
        'Create "' + normalizeCatalogTerm(query) + '"',
        function () { applyQuickPhraseTerm(query); },
        '\uD83D\uDCCC',
        function () { applyQuickPhraseTerm(query); }
      ));
      phraseResults.classList.remove('hidden');
      return;
    }
    ranked.forEach(function (term) {
      phraseResults.appendChild(buildResultRow(
        term,
        function () { applyQuickPhraseTerm(term); },
        '\uD83D\uDCCC',
        function () { applyQuickPhraseTerm(term); }
      ));
    });
    phraseResults.classList.remove('hidden');
  }

  function renderTagResults(query) {
    if (!tagResults) return;
    var q = normalizeCatalogTerm(query).toLowerCase();
    if (!q) {
      clearResults(tagResults);
      return;
    }
    var ranked = rankCatalogTerms(q);
    tagResults.innerHTML = '';
    if (!ranked.length) {
      tagResults.appendChild(buildResultRow(
        'Create "' + normalizeCatalogTerm(query) + '"',
        function () { applyTagTerm(query); }
      ));
      tagResults.classList.remove('hidden');
      return;
    }
    ranked.forEach(function (term) {
      tagResults.appendChild(buildResultRow(term, function () { applyTagTerm(term); }));
    });
    tagResults.classList.remove('hidden');
  }

  if (phraseApplyBtn && phraseInput) {
    phraseApplyBtn.onclick = function () {
      var text = normalizeCatalogTerm(phraseInput.value);
      if (!text) return;
      applyQuickPhraseTerm(text);
    };
    phraseInput.addEventListener('input', function () {
      renderPhraseResults(phraseInput.value);
    });
    phraseInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var text = normalizeCatalogTerm(phraseInput.value);
        if (!text) return;
        applyQuickPhraseTerm(text);
        return;
      }
      if (e.key === 'Escape') {
        clearResults(phraseResults);
      }
    });
    phraseInput.addEventListener('blur', function () {
      setTimeout(function () { clearResults(phraseResults); }, 150);
    });
  }

  if (tagApplyBtn && tagInput) {
    tagApplyBtn.onclick = function () {
      var text = normalizeCatalogTerm(tagInput.value);
      if (!text) return;
      applyTagTerm(text);
    };
    tagInput.addEventListener('input', function () {
      renderTagResults(tagInput.value);
    });
    tagInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var text = normalizeCatalogTerm(tagInput.value);
        if (!text) return;
        applyTagTerm(text);
        return;
      }
      if (e.key === 'Escape') {
        clearResults(tagResults);
      }
    });
    tagInput.addEventListener('blur', function () {
      setTimeout(function () { clearResults(tagResults); }, 150);
    });
  }

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
  updateAnnotateStripToggleUi();
  updateCaptionHelperCollapseUi();
  renderPhraseCopyPanel();
  renderAnnotateStrip();
}

window.wireCaptionHelpersUi = wireCaptionHelpersUi;
