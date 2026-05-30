// Caption helper tabs: requirements, phrases, and tags (set notes live in Set Config).
var captionHelperActiveTab = 'requirements';
var captionHelperPhrases = [];
var captionHelperNotes = '';
var debouncedSetNotesSave = debounceCreate(500);

function captionHelperSort(a, b) {
  return String(a || '').toLowerCase().localeCompare(String(b || '').toLowerCase());
}

function normalizeCatalogTerm(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

function getConfigVocabularyTerms() {
  var cfg = (window && window.APP_CONFIG && typeof window.APP_CONFIG === 'object') ? window.APP_CONFIG : {};
  var vocabulary = (cfg && cfg.vocabulary && typeof cfg.vocabulary === 'object') ? cfg.vocabulary : null;
  if (!vocabulary) return [];

  var out = [];
  var seen = {};
  function pushTerm(raw) {
    var clean = normalizeCatalogTerm(raw);
    var low = clean.toLowerCase();
    if (!clean || seen[low]) return;
    seen[low] = true;
    out.push(clean);
  }

  if (Array.isArray(vocabulary.terms)) {
    vocabulary.terms.forEach(pushTerm);
  }
  if (Array.isArray(vocabulary.groups)) {
    vocabulary.groups.forEach(function (group) {
      if (!group || typeof group !== 'object') return;
      var terms = Array.isArray(group.terms) ? group.terms : [];
      terms.forEach(pushTerm);
    });
  }
  return out;
}

function hasCaptionHelperPhrase(text) {
  var target = normalizeCatalogTerm(text).toLowerCase();
  if (!target) return false;
  for (var i = 0; i < captionHelperPhrases.length; i++) {
    var current = normalizeCatalogTerm(captionHelperPhrases[i]).toLowerCase();
    if (current === target) return true;
  }
  return false;
}

function ensureCaptionHelperPhraseInCatalog(text, persistNow, skipRender) {
  var term = normalizeCatalogTerm(text);
  if (!term) return false;
  if (hasCaptionHelperPhrase(term)) return false;
  captionHelperPhrases.push(term);
  captionHelperPhrases.sort(captionHelperSort);
  if (persistNow) {
    saveCaptionHelpersToFolderState();
  }
  if (!skipRender) {
    renderPhraseCopyPanel();
  }
  return true;
}

function mergeCaptionHelperPhrasesFromTagsMap(tagsMap, persistNow) {
  var source = (tagsMap && typeof tagsMap === 'object') ? tagsMap : {};
  var changed = false;
  Object.keys(source).forEach(function (mediaKey) {
    var tags = Array.isArray(source[mediaKey]) ? source[mediaKey] : [];
    tags.forEach(function (tag) {
      changed = ensureCaptionHelperPhraseInCatalog(tag, false, true) || changed;
    });
  });
  if (changed && persistNow) {
    saveCaptionHelpersToFolderState();
  }
  if (changed) {
    renderPhraseCopyPanel();
  }
  return changed;
}

function getCaptionHelperCatalogTerms() {
  var seen = {};
  var out = [];
  getConfigVocabularyTerms().forEach(function (phrase) {
    var clean = normalizeCatalogTerm(phrase);
    var low = clean.toLowerCase();
    if (!clean || seen[low]) return;
    seen[low] = true;
    out.push(clean);
  });
  captionHelperPhrases.forEach(function (phrase) {
    var clean = normalizeCatalogTerm(phrase);
    var low = clean.toLowerCase();
    if (!clean || seen[low]) return;
    seen[low] = true;
    out.push(clean);
  });
  if (Array.isArray(statsBalancePhrases)) {
    statsBalancePhrases.forEach(function (phrase) {
      var clean = normalizeCatalogTerm(phrase);
      var low = clean.toLowerCase();
      if (!clean || seen[low]) return;
      seen[low] = true;
      out.push(clean);
    });
  }
  if (captionItemTagsByMedia && typeof captionItemTagsByMedia === 'object') {
    Object.keys(captionItemTagsByMedia).forEach(function (mediaKey) {
      var tags = Array.isArray(captionItemTagsByMedia[mediaKey]) ? captionItemTagsByMedia[mediaKey] : [];
      tags.forEach(function (tag) {
        var clean = normalizeCatalogTerm(tag);
        var low = clean.toLowerCase();
        if (!clean || seen[low]) return;
        seen[low] = true;
        out.push(clean);
      });
    });
  }
  out.sort(captionHelperSort);
  return out;
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
  document.getElementById('caption-term-results').classList.add('hidden');

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
  var activePhrases = Array.isArray(statsBalancePhrases) ? statsBalancePhrases.slice() : [];

  var liveCaption = (ui && ui.editorEl && typeof ui.editorEl.value === 'string')
    ? ui.editorEl.value
    : (state && state.currentItem && typeof state.currentItem.caption === 'string' ? state.currentItem.caption : '');

  if (!activePhrases.length) {
    var empty = document.createElement('div');
    empty.className = 'small';
    empty.textContent = 'No active phrases. Add terms in Balance phrases.';
    container.appendChild(empty);
    return;
  }

  for (var i = 0; i < activePhrases.length; i++) {
    var phrase = activePhrases[i];
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

    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = 'X';
    (function (idx) {
      removeBtn.onclick = function () {
        var next = statsBalancePhrases.slice();
        next.splice(idx, 1);
        setStatsBalancePhrases(next, true);
        renderStatsBalancePhraseList();
        renderPhraseCopyPanel();
      };
    })(i);

    row.appendChild(phraseBtn);
    row.appendChild(tagBtn);
    row.appendChild(removeBtn);
    container.appendChild(row);
  }
}

function loadCaptionHelpersFromFolderState(folderState) {
  captionHelperPhrases = [];
  (folderState.caption_phrases || []).forEach(function (phrase) {
    ensureCaptionHelperPhraseInCatalog(phrase, false, true);
  });
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
  var sharedInput = document.getElementById('caption-term-input');
  var sharedApplyBtn = document.getElementById('caption-term-apply-btn');
  var sharedResults = document.getElementById('caption-term-results');
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

  function clearSharedResults() {
    sharedResults.innerHTML = '';
    sharedResults.classList.add('hidden');
  }

  function applySharedTerm(rawText) {
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
    sharedInput.value = '';
    clearSharedResults();
  }

  function renderSharedResults(query) {
    var q = normalizeCatalogTerm(query).toLowerCase();
    if (!q) {
      clearSharedResults();
      return;
    }
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
    var ranked = exact.concat(startsWith, contains).slice(0, 12);
    sharedResults.innerHTML = '';
    if (!ranked.length) {
      var createBtn = document.createElement('button');
      createBtn.type = 'button';
      createBtn.className = 'phrase-copy-item-btn';
      createBtn.textContent = 'Create "' + normalizeCatalogTerm(query) + '"';
      createBtn.onclick = function () {
        applySharedTerm(query);
      };
      sharedResults.appendChild(createBtn);
      sharedResults.classList.remove('hidden');
      return;
    }
    ranked.forEach(function (term) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'phrase-copy-item-btn';
      btn.textContent = term;
      btn.onclick = function () {
        applySharedTerm(term);
      };
      sharedResults.appendChild(btn);
    });
    sharedResults.classList.remove('hidden');
  }

  sharedApplyBtn.onclick = function () {
    var text = normalizeCatalogTerm(sharedInput.value);
    if (!text) return;
    applySharedTerm(text);
  };
  sharedInput.addEventListener('input', function () {
    renderSharedResults(sharedInput.value);
  });
  sharedInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      var text = normalizeCatalogTerm(sharedInput.value);
      if (!text) return;
      applySharedTerm(text);
      return;
    }
    if (e.key === 'Escape') {
      clearSharedResults();
      return;
    }
  });
  sharedInput.addEventListener('blur', function () {
    setTimeout(function () {
      clearSharedResults();
    }, 120);
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

window.ensureCaptionHelperPhraseInCatalog = ensureCaptionHelperPhraseInCatalog;
window.mergeCaptionHelperPhrasesFromTagsMap = mergeCaptionHelperPhrasesFromTagsMap;
window.getCaptionHelperCatalogTerms = getCaptionHelperCatalogTerms;
