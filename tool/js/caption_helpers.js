// Caption helper tabs: requirements, phrases, and tags (set notes live in Set Config).
var captionHelperActiveTab = 'requirements';
var captionHelperPhrases = [];
var captionQuickPhrases = [];
var captionHelperNotes = '';
var debouncedSetNotesSave = debounceCreate(500);
var annotateStripVisible = false;

function parseAnnotateStripTerms(raw) {
  var seen = {};
  return String(raw || '')
    .split(',')
    .map(function (part) { return normalizeCatalogTerm(part); })
    .filter(function (term) {
      var low = term.toLowerCase();
      if (!term || seen[low]) return false;
      seen[low] = true;
      return true;
    });
}

function getAnnotateStripGroups() {
  var groups = [];
  var requirements = Array.isArray(checklistItems) ? checklistItems : [];
  for (var i = 0; i < requirements.length; i++) {
    var groupName = normalizeCatalogTerm(requirements[i]);
    if (!groupName) continue;
    var rawTerms = (checklistKeywordsByItem && checklistKeywordsByItem[groupName]) || '';
    var terms = parseAnnotateStripTerms(rawTerms);
    if (!terms.length) continue;
    groups.push({ name: groupName, requirement: groupName, terms: terms });
  }
  return groups;
}

function updateAnnotateStripToggleUi() {
  var toggleBtn = document.getElementById('annotate-strip-toggle-btn');
  if (!toggleBtn) return;
  toggleBtn.setAttribute('aria-expanded', annotateStripVisible ? 'true' : 'false');
  toggleBtn.innerHTML = 'Annotate ' + (annotateStripVisible ? '&#9660;' : '&#9650;');
}

function setAnnotateStripVisible(nextVisible, persistNow) {
  annotateStripVisible = !!nextVisible;
  window.annotateStripVisible = annotateStripVisible;
  updateAnnotateStripToggleUi();
  renderAnnotateStrip();
  if (persistNow) {
    saveCaptionHelpersToFolderState();
  }
}

function toggleAnnotateTag(term) {
  var text = normalizeCatalogTerm(term);
  if (!text) return;
  if (!state.currentItem || !state.currentItem.key) {
    setStatus('Select a media item to annotate.');
    return;
  }
  var mediaKey = state.currentItem.key;
  if (hasTagForMediaKey(mediaKey, text)) {
    if (typeof removeTagFromCurrentMedia === 'function') {
      removeTagFromCurrentMedia(text);
    }
    renderAnnotateStrip();
    return;
  }
  addTagToCurrentMedia(text);
  renderAnnotateStrip();
}

function toggleAnnotateGroupNa(requirementLabel) {
  if (!state.currentItem || !state.currentItem.key) {
    setStatus('Select a media item to annotate.');
    return;
  }
  if (typeof isChecklistRequirementNaForMediaKey !== 'function' || typeof setChecklistRequirementNaForMediaKey !== 'function') {
    setStatus('n/a toggle is unavailable.');
    return;
  }
  var mediaKey = state.currentItem.key;
  var isNa = isChecklistRequirementNaForMediaKey(mediaKey, requirementLabel);
  setChecklistRequirementNaForMediaKey(mediaKey, requirementLabel, !isNa);
  setStatus(!isNa ? ('Marked n/a: ' + requirementLabel) : ('Cleared n/a: ' + requirementLabel));
  renderAnnotateStrip();
}

function renderAnnotateStrip() {
  var stripEl = document.getElementById('annotate-strip');
  if (!stripEl) return;
  var panelEl = document.getElementById('caption-checklist-panel');
  var editorPanelEl = panelEl ? panelEl.closest('.editor-panel') : null;
  var panelVisible = !!(panelEl && panelEl.style.display !== 'none');
  var canShow = !!(annotateStripVisible && panelVisible && state.currentItem && state.currentItem.key);

  if (!canShow) {
    stripEl.classList.add('hidden');
    stripEl.innerHTML = '';
    if (editorPanelEl) editorPanelEl.classList.remove('annotate-strip-visible');
    return;
  }

  if (editorPanelEl) editorPanelEl.classList.add('annotate-strip-visible');
  stripEl.classList.remove('hidden');
  var panelHeight = panelEl ? panelEl.offsetHeight : 0;
  stripEl.style.bottom = String(panelHeight + 30) + 'px';

  var groups = getAnnotateStripGroups();
  stripEl.innerHTML = '';

  if (!groups.length) {
    var empty = document.createElement('div');
    empty.className = 'annotate-strip-empty';
    empty.textContent = 'No annotation groups configured. Add requirement keywords to define group items.';
    stripEl.appendChild(empty);
    return;
  }

  var groupsWrap = document.createElement('div');
  groupsWrap.className = 'annotate-strip-groups';
  var mediaKey = state.currentItem.key;

  groups.forEach(function (group) {
    var groupEl = document.createElement('div');
    groupEl.className = 'annotate-strip-group';

    var titleEl = document.createElement('div');
    titleEl.className = 'annotate-strip-group-title';
    titleEl.textContent = group.name;
    groupEl.appendChild(titleEl);

    var chipWrap = document.createElement('div');
    chipWrap.className = 'annotate-strip-chip-wrap';
    var groupIsNa = (typeof isChecklistRequirementNaForMediaKey === 'function')
      ? isChecklistRequirementNaForMediaKey(mediaKey, group.requirement || group.name)
      : false;

    var naChip = document.createElement('button');
    naChip.type = 'button';
    naChip.className = 'annotate-strip-chip annotate-strip-chip-na';
    if (groupIsNa) {
      naChip.classList.add('active');
    }
    naChip.textContent = 'n/a';
    naChip.title = groupIsNa ? 'Clear n/a override' : 'Mark this group n/a for current item';
    naChip.onclick = function () {
      toggleAnnotateGroupNa(group.requirement || group.name);
    };
    chipWrap.appendChild(naChip);

    var hasActiveTerm = false;
    group.terms.forEach(function (term) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'annotate-strip-chip';
      if (hasTagForMediaKey(mediaKey, term)) {
        chip.classList.add('active');
        hasActiveTerm = true;
      }
      chip.textContent = term;
      chip.title = 'Toggle tag';
      chip.onclick = function () {
        if (groupIsNa && typeof setChecklistRequirementNaForMediaKey === 'function') {
          setChecklistRequirementNaForMediaKey(mediaKey, group.requirement || group.name, false);
        }
        toggleAnnotateTag(term);
      };
      chipWrap.appendChild(chip);
    });
    if (groupIsNa) titleEl.classList.add('annotate-strip-group-title-na');
    else titleEl.classList.add(hasActiveTerm ? 'annotate-strip-group-title-complete' : 'annotate-strip-group-title-incomplete');

    groupEl.appendChild(chipWrap);
    groupsWrap.appendChild(groupEl);
  });

  stripEl.appendChild(groupsWrap);
}

function moveCaptionQuickPhraseByOffset(index, offset) {
  var idx = Number(index);
  var step = Number(offset);
  if (!isFinite(idx) || !isFinite(step)) return false;
  if (!Array.isArray(captionQuickPhrases) || !captionQuickPhrases.length) return false;
  if (idx < 0 || idx >= captionQuickPhrases.length) return false;
  var nextIdx = idx + step;
  if (nextIdx < 0 || nextIdx >= captionQuickPhrases.length) return false;
  var next = captionQuickPhrases.slice();
  var temp = next[idx];
  next[idx] = next[nextIdx];
  next[nextIdx] = temp;
  setCaptionQuickPhrases(next, true);
  renderPhraseCopyPanel();
  return true;
}

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

function getRequirementKeywordCatalogTerms() {
  var out = [];
  var seen = {};
  var requirements = Array.isArray(checklistItems) ? checklistItems : [];
  requirements.forEach(function (requirementLabel) {
    var groupName = normalizeCatalogTerm(requirementLabel);
    if (!groupName) return;
    var rawTerms = (checklistKeywordsByItem && checklistKeywordsByItem[groupName]) || '';
    parseAnnotateStripTerms(rawTerms).forEach(function (term) {
      var clean = normalizeCatalogTerm(term);
      var low = clean.toLowerCase();
      if (!clean || seen[low]) return;
      seen[low] = true;
      out.push(clean);
    });
  });
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
  getRequirementKeywordCatalogTerms().forEach(function (phrase) {
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

function saveCaptionHelpersToFolderState() {
  var snapshot = snapshotFolderStateFromDom();
  snapshot.caption_phrases = captionHelperPhrases.slice();
  snapshot.quick_phrases = captionQuickPhrases.slice();
  snapshot.caption_set_notes = captionHelperNotes;
  snapshot.annotate_strip_visible = !!annotateStripVisible;
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

function setCaptionQuickPhrases(nextPhrases, triggerAutosave) {
  captionQuickPhrases = (nextPhrases || [])
    .map(function (phrase) { return normalizeCatalogTerm(phrase); })
    .filter(Boolean);
  window.captionQuickPhrases = captionQuickPhrases;
  if (triggerAutosave) {
    saveCaptionHelpersToFolderState();
  }
}

function addCaptionQuickPhrase(text, triggerAutosave) {
  var clean = normalizeCatalogTerm(text);
  if (!clean) return false;
  var exists = captionQuickPhrases.some(function (p) {
    return String(p || '').toLowerCase() === clean.toLowerCase();
  });
  if (exists) return false;
  var next = captionQuickPhrases.slice();
  next.push(clean);
  setCaptionQuickPhrases(next, triggerAutosave);
  return true;
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

      var keyHint = document.createElement('button');
      keyHint.type = 'button';
      keyHint.className = 'stats-phrase-keyhint';
      keyHint.title = 'Move up';
      keyHint.textContent = '\u21e7';
      keyHint.onclick = function () {
        var moved = moveCaptionQuickPhraseByOffset(idx, -1);
        if (moved) {
          setStatus('Moved quick phrase up: ' + phrase);
        }
      };
      actions.appendChild(keyHint);

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
  window.annotateStripVisible = annotateStripVisible;
  updateAnnotateStripToggleUi();
  var notesEditor = document.getElementById('set-notes-editor');
  if (notesEditor) {
    notesEditor.value = captionHelperNotes;
  }
  renderPhraseCopyPanel();
  renderAnnotateStrip();
}

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
  if (annotateStripToggleBtn) {
    annotateStripToggleBtn.onclick = function () {
      setAnnotateStripVisible(!annotateStripVisible, true);
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
  renderPhraseCopyPanel();
  renderAnnotateStrip();
}

window.ensureCaptionHelperPhraseInCatalog = ensureCaptionHelperPhraseInCatalog;
window.mergeCaptionHelperPhrasesFromTagsMap = mergeCaptionHelperPhrasesFromTagsMap;
window.getCaptionHelperCatalogTerms = getCaptionHelperCatalogTerms;
window.renderAnnotateStrip = renderAnnotateStrip;
window.setAnnotateStripVisible = setAnnotateStripVisible;
