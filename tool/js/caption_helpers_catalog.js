// Caption helper catalog, quick phrases, and caption phrase editing.

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

  var out = [];
  var seen = {};
  function pushTerm(raw) {
    var clean = normalizeCatalogTerm(raw);
    var low = clean.toLowerCase();
    if (!clean || seen[low]) return;
    seen[low] = true;
    out.push(clean);
  }

  if (vocabulary) {
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
  }

  var requirements = (cfg && cfg.requirements && typeof cfg.requirements === 'object')
    ? cfg.requirements
    : null;
  if (requirements && requirements.keywordsByItem && typeof requirements.keywordsByItem === 'object') {
    Object.keys(requirements.keywordsByItem).forEach(function (requirementLabel) {
      var raw = String(requirements.keywordsByItem[requirementLabel] || '');
      raw.split(',').forEach(pushTerm);
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

function insertCaptionPhraseAtCursor(text, options) {
  if (!ui || !ui.editorEl) return false;
  if (ui.editorEl.readOnly) {
    setStatus('Cannot insert while editor is read-only.');
    return false;
  }
  var insertOptions = (options && typeof options === 'object') ? options : {};
  var phrase = String(text || '').trim();
  if (!phrase) return false;
  var editor = ui.editorEl;
  var value = editor.value || '';
  var start = typeof editor.selectionStart === 'number' ? editor.selectionStart : value.length;
  var end = typeof editor.selectionEnd === 'number' ? editor.selectionEnd : value.length;
  var before = value.slice(0, start).replace(/[ \t]+$/, '');
  var after = value.slice(end).replace(/^[ \t]+/, '');
  var leading = before && !/\s$/.test(before) ? ' ' : '';
  var separator = typeof insertOptions.separator === 'string' ? insertOptions.separator : ', ';
  var insertion = leading + phrase + separator;
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
  var before = value.slice(0, start);
  var after = value.slice(end);
  var nextStart = start;
  var nextEnd = end;
  var trailingCommaMatch = after.match(/^[ \t]*,[ \t]*/);
  if (trailingCommaMatch) {
    nextEnd = end + trailingCommaMatch[0].length;
  } else {
    var leadingCommaMatch = before.match(/[ \t]*,[ \t]*$/);
    if (leadingCommaMatch) {
      nextStart = start - leadingCommaMatch[0].length;
    }
  }
  var nextValue = joinCaptionParts(value.slice(0, nextStart), value.slice(nextEnd));
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
  insertCaptionPhraseAtCursor(phrase, { separator: ', ' });
}

function toggleCaptionTagAtCursor(text) {
  var tag = String(text || '').trim();
  if (!tag || !ui || !ui.editorEl) return;
  var rendered = (typeof renderChecklistTermWithAffixes === 'function')
    ? renderChecklistTermWithAffixes(tag)
    : tag;
  var value = ui.editorEl.value || '';
  if (rendered && captionContainsPhrase(value, rendered)) {
    removeCaptionPhraseFromCaption(rendered);
    return;
  }
  if (tag && captionContainsPhrase(value, tag)) {
    removeCaptionPhraseFromCaption(tag);
    return;
  }
  insertCaptionPhraseAtCursor(rendered || tag, { separator: ', ' });
}

function setCaptionQuickPhrases(nextPhrases, triggerAutosave) {
  captionQuickPhrases = (nextPhrases || [])
    .map(function (phrase) { return normalizeCatalogTerm(phrase); })
    .filter(Boolean);
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

window.ensureCaptionHelperPhraseInCatalog = ensureCaptionHelperPhraseInCatalog;
window.mergeCaptionHelperPhrasesFromTagsMap = mergeCaptionHelperPhrasesFromTagsMap;
window.getCaptionHelperCatalogTerms = getCaptionHelperCatalogTerms;
window.moveCaptionQuickPhraseByOffset = moveCaptionQuickPhraseByOffset;
window.toggleCaptionPhraseAtCursor = toggleCaptionPhraseAtCursor;
window.toggleCaptionTagAtCursor = toggleCaptionTagAtCursor;
