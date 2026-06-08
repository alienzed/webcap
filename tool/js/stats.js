function parseTokenRules(multiline) {
  return String(multiline || '')
    .split(/\r?\n/)
    .map(function (line) { return line.trim(); })
    .filter(Boolean)
    .map(function (line) {
      var idx = line.indexOf('=>');
      if (idx === -1) {
        return null;
      }
      var left = line.slice(0, idx).trim().toLowerCase();
      var rightRaw = line.slice(idx + 2).trim();
      var right = rightRaw.toLowerCase();
      if (!left || !right) {
        return null;
      }

      // Primer assignment lines (e.g. file:fd => view=face down) are not validation rules.
      if (right.indexOf('=') !== -1) {
        return null;
      }

      var scope = 'file';
      var trigger = left;
      var colon = left.indexOf(':');
      if (colon > 0) {
        var prefix = left.slice(0, colon).trim();
        var value = left.slice(colon + 1).trim();
        if ((prefix === 'file' || prefix === 'caption') && value) {
          scope = prefix;
          trigger = value;
        }
      }

      if (!trigger) {
        return null;
      }

      return { scope: scope, trigger: trigger, required: right };
    })
    .filter(Boolean);
}

function parseStructuredReviewRules(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows
    .map(function (row) {
      var src = row || {};
      var scope = String(src.scope || 'file').toLowerCase();
      if (scope !== 'file' && scope !== 'caption') {
        scope = 'file';
      }
      var trigger = String(src.trigger || '').trim().toLowerCase();
      var required = String(src.required || '').trim().toLowerCase();
      var enabled = src.enabled !== false;
      if (!enabled || !trigger || !required) {
        return null;
      }
      return {
        scope: scope,
        trigger: trigger,
        required: required
      };
    })
    .filter(Boolean);
}

function normalizedCaptionKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(text) {
  return String(text || '').toLowerCase();
}

function tokenize(text) {
  return normalize(text).split(/[^a-z0-9]+/).filter(Boolean);
}

function computeLengthInsights(captionRows) {
  if (!captionRows.length) {
    return {
      shortestCaptions: [],
      longestCaptions: [],
      shortOutliers: [],
      longOutliers: []
    };
  }

  var sorted = captionRows.slice().sort(function (a, b) {
    return a.tokenCount - b.tokenCount || a.charCount - b.charCount || a.fileName.localeCompare(b.fileName);
  });

  var shortestCaptions = sorted.slice(0, 10);
  var longestCaptions = sorted.slice(-10).reverse();

  var cut = Math.max(1, Math.floor(sorted.length * 0.05));
  var shortOutliers = sorted.slice(0, cut);
  var longOutliers = sorted.slice(-cut).reverse();

  return {
    shortestCaptions: shortestCaptions,
    longestCaptions: longestCaptions,
    shortOutliers: shortOutliers,
    longOutliers: longOutliers
  };
}

function levenshteinDistance(a, b) {
  // Compute edit distance between two strings
  var aLen = a.length;
  var bLen = b.length;
  var matrix = [];
  for (var i = 0; i <= aLen; i++) {
    matrix[i] = [i];
  }
  for (var j = 0; j <= bLen; j++) {
    matrix[0][j] = j;
  }
  for (var i = 1; i <= aLen; i++) {
    for (var j = 1; j <= bLen; j++) {
      var cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,     // deletion
        matrix[i][j - 1] + 1,     // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return matrix[aLen][bLen];
}

function captionSimilarity(a, b) {
  // Return similarity as percentage (0-100)
  var maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 100;
  var distance = levenshteinDistance(a, b);
  return Math.round(((maxLen - distance) / maxLen) * 1000) / 10;
}

function computeSimilarCaptions(captionRows, threshold) {
  // Find similar caption pairs above threshold (e.g., 80%)
  if (!captionRows.length) return [];
  var threshold_pct = threshold || 80;
  var groups = [];
  var processed = {};
  
  for (var i = 0; i < captionRows.length; i++) {
    var caption_a = captionRows[i].caption;
    if (!caption_a || processed[i]) continue;
    
    var similar = [{ fileName: captionRows[i].fileName, caption: caption_a }];
    
    for (var j = i + 1; j < captionRows.length; j++) {
      var caption_b = captionRows[j].caption;
      if (!caption_b || processed[j]) continue;
      
      var similarity = captionSimilarity(caption_a, caption_b);
      if (similarity >= threshold_pct) {
        similar.push({ fileName: captionRows[j].fileName, caption: caption_b });
        processed[j] = true;
      }
    }
    
    if (similar.length > 1) {
      groups.push({
        similarity: Math.round(captionSimilarity(caption_a, similar[1].caption) * 10) / 10,
        sample: caption_a.length > 120 ? caption_a.slice(0, 117) + '...' : caption_a,
        files: similar.map(function (s) { return s.fileName; })
      });
      processed[i] = true;
    }
  }
  
  return groups.sort(function (a, b) {
    return b.similarity - a.similarity || a.files[0].localeCompare(b.files[0]);
  }).slice(0, 15);
}

function computeDuplicateInsights(duplicatesMap) {
  return Object.keys(duplicatesMap)
    .map(function (key) {
      return duplicatesMap[key];
    })
    .filter(function (group) { return group.count > 1; })
    .sort(function (a, b) { return b.count - a.count || a.files[0].localeCompare(b.files[0]); })
    .slice(0, 20);
}

function parsePhrases(multiline) {
  return String(multiline || '')
    .split(/\r?\n/)
    .map(function (line) { return line.trim(); })
    .filter(Boolean);
}

var statsBalancePhrases = [];

function normalizeBalancePhrase(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

function setFilterFromBalancePhrase(phrase) {
  var text = normalizeBalancePhrase(phrase);
  if (!text || !ui || !ui.filterEl) return;
  ui.filterEl.value = text;
  ui.filterEl.dispatchEvent(new Event('input', { bubbles: true }));
  setStatus('Filter applied from balance phrase: ' + text);
}

function addBalancePhraseTagToCurrentMedia(phrase) {
  var text = normalizeBalancePhrase(phrase);
  if (!text) return false;
  if (!state.currentItem || !state.currentItem.key) {
    setStatus('Select a media item.');
    return false;
  }
  if (typeof addTagToCurrentMedia !== 'function') {
    setStatus('Tagging is unavailable.');
    return false;
  }
  return addTagToCurrentMedia(text);
}

function setStatsBalancePhrases(nextPhrases, triggerAutosave) {
  var seen = {};
  statsBalancePhrases = (nextPhrases || [])
    .map(normalizeBalancePhrase)
    .filter(function (phrase) {
      if (!phrase) return false;
      var low = phrase.toLowerCase();
      if (seen[low]) return false;
      seen[low] = true;
      return true;
    });

  var phrasesEl = ui && ui.statsPhrasesEl ? ui.statsPhrasesEl : document.getElementById('stats-phrases');
  if (phrasesEl) {
    phrasesEl.value = statsBalancePhrases.join('\n');
    if (triggerAutosave) {
      phrasesEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  renderPhraseCopyPanel();
  updateBalanceDistributionWheel();
}

function moveStatsBalancePhraseByOffset(index, offset) {
  var idx = Number(index);
  var step = Number(offset);
  if (!isFinite(idx) || !isFinite(step)) return false;
  if (!Array.isArray(statsBalancePhrases) || !statsBalancePhrases.length) return false;
  if (idx < 0 || idx >= statsBalancePhrases.length) return false;
  var nextIdx = idx + step;
  if (nextIdx < 0 || nextIdx >= statsBalancePhrases.length) return false;
  var next = statsBalancePhrases.slice();
  var temp = next[idx];
  next[idx] = next[nextIdx];
  next[nextIdx] = temp;
  setStatsBalancePhrases(next, true);
  renderStatsBalancePhraseList();
  return true;
}

function loadStatsBalancePhrasesFromTextarea() {
  var phrasesEl = ui && ui.statsPhrasesEl ? ui.statsPhrasesEl : document.getElementById('stats-phrases');
  var parsed = parsePhrases(phrasesEl ? phrasesEl.value : '');
  setStatsBalancePhrases(parsed, false);
}

function renderStatsBalancePhraseList() {
  var listEl = ui && ui.statsPhrasesItemsEl ? ui.statsPhrasesItemsEl : document.getElementById('stats-phrases-items');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (!statsBalancePhrases.length) {
    var empty = document.createElement('div');
    empty.className = 'small';
    empty.textContent = 'No balance phrases configured.';
    listEl.appendChild(empty);
    return;
  }

  for (var i = 0; i < statsBalancePhrases.length; i++) {
    (function (idx) {
      var phrase = statsBalancePhrases[idx];
      var row = document.createElement('div');
      row.className = 'row-inline stats-phrase-row';

      var phraseBtn = document.createElement('button');
      phraseBtn.type = 'button';
      phraseBtn.className = 'phrase-copy-item-btn';
      phraseBtn.title = 'Add as tag to current media';
      phraseBtn.textContent = phrase;
      phraseBtn.onclick = function () {
        addBalancePhraseTagToCurrentMedia(phrase);
      };

      var actions = document.createElement('div');
      actions.className = 'stats-phrase-actions';

      var moveUpBtn = document.createElement('button');
      moveUpBtn.type = 'button';
      moveUpBtn.className = 'stats-phrase-move-btn';
      moveUpBtn.title = 'Move up';
      moveUpBtn.textContent = '\u2191';
      moveUpBtn.onclick = function () {
        var moved = moveStatsBalancePhraseByOffset(idx, -1);
        if (moved) {
          setStatus('Moved balance phrase up: ' + phrase);
        }
      };
      actions.appendChild(moveUpBtn);

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'stats-phrase-mini-btn';
      removeBtn.title = 'Remove phrase';
      removeBtn.textContent = 'x';
      removeBtn.onclick = function () {
        var next = statsBalancePhrases.slice();
        next.splice(idx, 1);
        setStatsBalancePhrases(next, true);
        renderStatsBalancePhraseList();
      };
      actions.appendChild(removeBtn);

      row.appendChild(phraseBtn);
      row.appendChild(actions);
      listEl.appendChild(row);
    })(i);
  }
}

function addStatsBalancePhraseFromInput() {
  var inputEl = ui && ui.statsPhrasesAddInputEl ? ui.statsPhrasesAddInputEl : document.getElementById('stats-phrases-add-input');
  var text = normalizeBalancePhrase(inputEl ? inputEl.value : '');
  if (!text) return;
  var exists = statsBalancePhrases.some(function (p) { return String(p).toLowerCase() === text.toLowerCase(); });
  if (exists) {
    if (inputEl) inputEl.value = '';
    return;
  }
  var next = statsBalancePhrases.slice();
  next.push(text);
  setStatsBalancePhrases(next, true);
  renderStatsBalancePhraseList();
  if (inputEl) inputEl.value = '';
  var resultsEl = document.getElementById('stats-phrases-add-results');
  if (resultsEl) {
    resultsEl.innerHTML = '';
    resultsEl.classList.add('hidden');
  }
}

function renderStatsBalancePhraseResults(query) {
  var resultsEl = document.getElementById('stats-phrases-add-results');
  if (!resultsEl) return;
  var q = normalizeBalancePhrase(query).toLowerCase();
  if (!q) {
    resultsEl.innerHTML = '';
    resultsEl.classList.add('hidden');
    return;
  }
  var catalog = (typeof getCaptionHelperCatalogTerms === 'function') ? getCaptionHelperCatalogTerms() : [];
  var exact = [];
  var startsWith = [];
  var contains = [];
  catalog.forEach(function (term) {
    var clean = normalizeBalancePhrase(term);
    var low = clean.toLowerCase();
    if (!clean) return;
    if (low === q) {
      exact.push(clean);
      return;
    }
    if (low.indexOf(q) === 0) {
      startsWith.push(clean);
      return;
    }
    if (low.indexOf(q) !== -1) contains.push(clean);
  });
  var ranked = exact.concat(startsWith, contains).slice(0, 12);
  resultsEl.innerHTML = '';
  ranked.forEach(function (term) {
    var row = document.createElement('div');
    row.className = 'caption-term-result-row';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'phrase-copy-item-btn caption-term-result-main';
    btn.textContent = term;
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      var inputEl = ui && ui.statsPhrasesAddInputEl ? ui.statsPhrasesAddInputEl : document.getElementById('stats-phrases-add-input');
      if (inputEl) inputEl.value = term;
      addStatsBalancePhraseFromInput();
    };
    row.appendChild(btn);
    resultsEl.appendChild(row);
  });
  resultsEl.classList.toggle('hidden', !ranked.length);
}

function openBalancePhrasesHelpInPreview() {
  if (typeof renderAdvancedHelpPreview !== 'function') {
    setStatus('Help preview unavailable.');
    return;
  }
  renderAdvancedHelpPreview(
    'Balance Phrases Help',
    '<p style="margin:0 0 10px 0;">Balance phrases help you check phrase coverage across the set.</p>' +
    '<h4 style="margin:12px 0 6px 0;font-size:14px;">What This Is</h4>' +
    '<ul style="margin:0 0 8px 18px;padding:0;">' +
    '<li style="margin:0 0 6px 0;">A short list of phrases you care about, like <code>front view</code>, <code>indoor lighting</code>, or <code>close-up</code>.</li>' +
    '<li style="margin:0 0 6px 0;">Review shows phrase counts in both captions and tags.</li>' +
    '<li style="margin:0 0 6px 0;">This helps you spot gaps before training.</li>' +
    '</ul>' +
    '<h4 style="margin:12px 0 6px 0;font-size:14px;">How To Use It</h4>' +
    '<ol style="margin:0 0 8px 18px;padding:0;">' +
    '<li style="margin:0 0 6px 0;">Add phrases you want to track (catalog suggestions are optional).</li>' +
    '<li style="margin:0 0 6px 0;">Run Review Captions and check the Phrase Balance section.</li>' +
    '<li style="margin:0 0 6px 0;">If a phrase is missing or low, add/edit captions for those examples.</li>' +
    '<li style="margin:0 0 6px 0;">Repeat until coverage looks balanced for the set.</li>' +
    '</ol>' +
    '<h4 style="margin:12px 0 6px 0;font-size:14px;">Tip</h4>' +
    '<p style="margin:0;">Click a balance phrase row to add it as a tag to the current media item.</p>'
  );
}

function wireStatsBalancePhraseUi() {
  loadStatsBalancePhrasesFromTextarea();
  renderStatsBalancePhraseList();

  var addBtn = ui && ui.statsPhrasesAddBtnEl ? ui.statsPhrasesAddBtnEl : document.getElementById('stats-phrases-add-btn');
  var addInput = ui && ui.statsPhrasesAddInputEl ? ui.statsPhrasesAddInputEl : document.getElementById('stats-phrases-add-input');
  var infoBtn = document.getElementById('stats-balance-info-btn');
  if (addBtn && !addBtn.__statsPhrasesBound) {
    addBtn.__statsPhrasesBound = true;
    addBtn.onclick = addStatsBalancePhraseFromInput;
  }
  if (infoBtn && !infoBtn.__statsPhrasesBound) {
    infoBtn.__statsPhrasesBound = true;
    infoBtn.addEventListener('click', openBalancePhrasesHelpInPreview);
  }
  if (addInput && !addInput.__statsPhrasesBound) {
    addInput.__statsPhrasesBound = true;
    addInput.addEventListener('input', function () {
      renderStatsBalancePhraseResults(addInput.value);
    });
    addInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addStatsBalancePhraseFromInput();
      } else if (e.key === 'Escape') {
        var resultsEl = document.getElementById('stats-phrases-add-results');
        if (resultsEl) {
          resultsEl.innerHTML = '';
          resultsEl.classList.add('hidden');
        }
      }
    });
    addInput.addEventListener('blur', function () {
      setTimeout(function () {
        var resultsEl = document.getElementById('stats-phrases-add-results');
        if (resultsEl) {
          resultsEl.innerHTML = '';
          resultsEl.classList.add('hidden');
        }
      }, 150);
    });
  }
}

function compute(items, options) {
  var requiredPhrase = normalize(options && options.requiredPhrase || '').trim();
  var phrases = parsePhrases(options && options.phrases || '');
  var reviewRules = parseStructuredReviewRules(options && options.reviewRules || []);

  var total = items.length;
  var withCaption = 0;
  var missingCaption = 0;
  var requiredHits = 0;
  var requiredMissing = [];
  var phraseCounts = {};
  var phraseTagCounts = {};
  var ruleFailures = [];
  var tokenCounts = {};
  var captionRows = [];
  var duplicatesMap = {};

  phrases.forEach(function (p) {
    phraseCounts[p] = 0;
    phraseTagCounts[p] = 0;
  });

  items.forEach(function (item) {
    var caption = String(item.caption || '');
    var captionNorm = normalize(caption);
    var fileNorm = normalize(item.fileName || '');

    if (caption.trim()) {
      withCaption += 1;
    } else {
      missingCaption += 1;
    }

    if (requiredPhrase && captionNorm.indexOf(requiredPhrase) !== -1) {
      requiredHits += 1;
    } else if (requiredPhrase) {
      requiredMissing.push({
        fileName: item.fileName,
        reason: 'Missing required phrase "' + requiredPhrase + '"'
      });
    }

    phrases.forEach(function (p) {
      if (captionNorm.indexOf(normalize(p)) !== -1) {
        phraseCounts[p] += 1;
      }
    });

    var normalizedTags = Array.isArray(item.tags)
      ? item.tags
          .map(function (tag) { return normalizeBalancePhrase(tag).toLowerCase(); })
          .filter(Boolean)
      : [];
    phrases.forEach(function (p) {
      var phraseNorm = normalizeBalancePhrase(p).toLowerCase();
      if (!phraseNorm) return;
      if (normalizedTags.indexOf(phraseNorm) !== -1) {
        phraseTagCounts[p] += 1;
      }
    });

    reviewRules.forEach(function (rule) {
      if (rule.scope === 'caption') {
        if (captionNorm.indexOf(rule.trigger) !== -1 && captionNorm.indexOf(rule.required) === -1) {
          ruleFailures.push({
            fileName: item.fileName,
            reason: 'Caption phrase "' + rule.trigger + '" requires phrase "' + rule.required + '"'
          });
        }
        return;
      }
      if (fileNorm.indexOf(rule.trigger) !== -1 && captionNorm.indexOf(rule.required) === -1) {
        ruleFailures.push({
          fileName: item.fileName,
          reason: 'Filename token "' + rule.trigger + '" requires phrase "' + rule.required + '"'
        });
      }
    });

    tokenize(caption).forEach(function (tok) {
      if (TOKEN_BLACKLIST[tok]) {
        return;
      }
      tokenCounts[tok] = (tokenCounts[tok] || 0) + 1;
    });

    var trimmed = caption.trim();
    if (trimmed) {
      var row = {
        fileName: item.fileName,
        caption: trimmed,
        charCount: caption.length,
        tokenCount: tokenize(caption).length
      };
      captionRows.push(row);

      var dupKey = normalizedCaptionKey(caption);
      if (!duplicatesMap[dupKey]) {
        duplicatesMap[dupKey] = {
          normalizedCaption: dupKey,
          sample: trimmed,
          count: 0,
          files: []
        };
      }
      duplicatesMap[dupKey].count += 1;
      duplicatesMap[dupKey].files.push(item.fileName);
    }
  });

  var rareTokens = Object.keys(tokenCounts)
    .filter(function (tok) { return tokenCounts[tok] <= 2; })
    .sort(function (a, b) { return tokenCounts[a] - tokenCounts[b] || a.localeCompare(b); })
    .slice(0, 50)
    .map(function (tok) { return { token: tok, count: tokenCounts[tok] }; });

  var topTokens = Object.keys(tokenCounts)
    .sort(function (a, b) { return tokenCounts[b] - tokenCounts[a] || a.localeCompare(b); })
    .slice(0, 50)
    .map(function (tok) { return { token: tok, count: tokenCounts[tok] }; });

  var phraseSummary = phrases.map(function (p) {
    var captionCount = phraseCounts[p] || 0;
    var tagCount = phraseTagCounts[p] || 0;
    var captionPercent = total ? Math.round((captionCount / total) * 1000) / 10 : 0;
    var tagPercent = total ? Math.round((tagCount / total) * 1000) / 10 : 0;
    return {
      phrase: p,
      count: captionCount,
      percent: captionPercent,
      captionCount: captionCount,
      tagCount: tagCount,
      captionPercent: captionPercent,
      tagPercent: tagPercent
    };
  });

  var requiredPercent = total ? Math.round((requiredHits / total) * 1000) / 10 : 0;
  var lengthInsights = computeLengthInsights(captionRows);
  var duplicateCaptions = computeDuplicateInsights(duplicatesMap);
  var similarCaptions = computeSimilarCaptions(captionRows, 80);

  return {
    total: total,
    withCaption: withCaption,
    missingCaption: missingCaption,
    requiredPhrase: requiredPhrase,
    requiredHits: requiredHits,
    requiredPercent: requiredPercent,
    requiredMissing: requiredMissing,
    phraseSummary: phraseSummary,
    ruleFailures: ruleFailures,
    shortestCaptions: lengthInsights.shortestCaptions,
    longestCaptions: lengthInsights.longestCaptions,
    shortOutliers: lengthInsights.shortOutliers,
    longOutliers: lengthInsights.longOutliers,
    duplicateCaptions: duplicateCaptions,
    similarCaptions: similarCaptions,
    topTokens: topTokens,
    rareTokens: rareTokens
  };
}

function buildCombinedCaptionsText(items) {
  if (!items.length) {
    return '';
  }
  return items.map(function (item) {
    return item.fileName + ':\n' + (item.caption || '');
  }).join('\n\n');
}

// Stats/primer DOM helpers and auto-save wiring (moved from common.js)
function getOptionsFromDom() {
  var requiredPhraseEl = document.getElementById('stats-required-phrase');
  var phrasesEl = document.getElementById('stats-phrases');
  var phrasesValue = Array.isArray(statsBalancePhrases) && statsBalancePhrases.length
    ? statsBalancePhrases.join('\n')
    : (phrasesEl ? phrasesEl.value : '');
  var reviewRulesRows = [];
  if (typeof getReviewRulesRows === 'function') {
    reviewRulesRows = getReviewRulesRows();
  }
  return {
    requiredPhrase: requiredPhraseEl ? requiredPhraseEl.value : '',
    phrases: phrasesValue,
    reviewRules: reviewRulesRows
  };
}

function statsGetPrimerOptionsFromDom() {
  var templateEl = document.getElementById('primer-template');
  var mappingsRows = [];
  if (typeof getPrimerMappingsRows === 'function') {
    mappingsRows = getPrimerMappingsRows();
  }
  return {
    template: templateEl ? templateEl.value : '',
    mappings: mappingsRows
  };
}

// Debounced auto-save for stats/primer changes
var debouncedSaveFolderState = debounceCreate(600);
var primerResetUndoState = null; // { mediaKey, text }
var primerTemplateSnapshot = '';

function syncMissingCaptionEditorToUpdatedPrimer(previousTemplate, nextTemplate) {
  if (!ui || !ui.editorEl || ui.editorEl.readOnly) return;
  var mediaItem = getPrimerResetCurrentMediaItem();
  if (!mediaItem || mediaItem.hasCaption) return;

  var previousPrimer = '';
  var previousConfig = statsGetPrimerOptionsFromDom();
  previousConfig.template = String(previousTemplate || '');
  if (previousConfig.template.trim()) {
    previousPrimer = String(buildPrimerFromConfig(mediaItem.fileName, mediaItem.key, previousConfig) || '');
  }

  var currentEditorText = String(ui.editorEl.value || '');
  if (currentEditorText.trim() !== previousPrimer.trim()) return;

  var nextConfig = statsGetPrimerOptionsFromDom();
  nextConfig.template = String(nextTemplate || '');
  var nextPrimer = String(buildPrimerFromConfig(mediaItem.fileName, mediaItem.key, nextConfig) || '');
  if (currentEditorText === nextPrimer) return;

  applyEditorTextAndTriggerInput(nextPrimer);
}

function wireStatsPrimerAutoSave() {
  var templateEl = document.getElementById('primer-template');
  if (templateEl) primerTemplateSnapshot = String(templateEl.value || '');
  var statsFields = [
    document.getElementById('stats-required-phrase'),
    document.getElementById('stats-phrases'),
    templateEl
  ];
  statsFields.forEach(function (el) {
    if (el && !el.__autoSaveBound) {
      el.__autoSaveBound = true;
      el.addEventListener('input', function (evt) {
        if (el.id === 'primer-template') {
          var nextTemplate = String((evt && evt.target && evt.target.value) || '');
          var previousTemplate = primerTemplateSnapshot;
          primerTemplateSnapshot = nextTemplate;
          syncMissingCaptionEditorToUpdatedPrimer(previousTemplate, nextTemplate);
        }
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

function isPrimerInEffectForCurrentItem(mediaItem) {
  if (!mediaItem || !ui || !ui.editorEl || ui.editorEl.readOnly) return false;
  if (mediaItem.hasCaption) return false;
  var primerText = String(buildAutoPrimer(mediaItem.fileName, mediaItem.key) || '');
  if (!primerText.trim()) return false;
  var editorText = String(ui.editorEl.value || '');
  return editorText.trim() === primerText.trim();
}

function updatePrimerCaptionResetUi() {
  var resetBtn = document.getElementById('primer-reset-caption-btn');
  var undoBtn = document.getElementById('primer-undo-reset-caption-btn');
  var applyPrimerBtn = ui && ui.editorApplyPrimerBtn ? ui.editorApplyPrimerBtn : null;
  if (!resetBtn || !undoBtn) return;

  var mediaItem = getPrimerResetCurrentMediaItem();
  var hasSelectedMedia = !!(mediaItem && ui && ui.editorEl && !ui.editorEl.readOnly);
  if (!hasSelectedMedia) {
    resetBtn.classList.add('hidden');
    undoBtn.classList.add('hidden');
    if (applyPrimerBtn) applyPrimerBtn.classList.add('hidden');
    return;
  }

  var primerText = String(buildAutoPrimer(mediaItem.fileName, mediaItem.key) || '');
  var editorText = String(ui.editorEl.value || '');
  var canReset = editorText.trim() !== primerText.trim();
  resetBtn.classList.toggle('hidden', !canReset);

  var canUndo = !!(primerResetUndoState && primerResetUndoState.mediaKey === mediaItem.key);
  undoBtn.classList.toggle('hidden', !canUndo);
  if (applyPrimerBtn) {
    applyPrimerBtn.classList.toggle('hidden', !isPrimerInEffectForCurrentItem(mediaItem));
  }
}

function applyEditorTextAndTriggerInput(nextText) {
  if (!ui || !ui.editorEl) return;
  ui.editorEl.value = String(nextText || '');
  ui.editorEl.dispatchEvent(new Event('input', { bubbles: true }));
}

function wirePrimerCaptionResetUi() {
  var resetBtn = document.getElementById('primer-reset-caption-btn');
  var undoBtn = document.getElementById('primer-undo-reset-caption-btn');
  var applyPrimerBtn = ui && ui.editorApplyPrimerBtn ? ui.editorApplyPrimerBtn : null;
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
      if (!nextPrimer.trim()) {
        if (!confirm('Primer output is empty. Clear current caption?')) return;
      } else {
        if (!confirm('Reset current caption to primer output?')) return;
      }
      var previousText = String((ui && ui.editorEl && ui.editorEl.value) || '');
      if (previousText === nextPrimer) {
        setStatus('Caption already matches primer output (nothing to reset).');
        return;
      }
      primerResetUndoState = {
        mediaKey: mediaItem.key,
        text: previousText
      };
      applyEditorTextAndTriggerInput(nextPrimer);
      updatePrimerCaptionResetUi();
      saveCaptionDirect(state.folder, mediaItem.fileName, nextPrimer, mediaItem.key).catch(function (err) {
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
      primerResetUndoState = null;
      applyEditorTextAndTriggerInput(restoreText);
      updatePrimerCaptionResetUi();
      saveCaptionDirect(state.folder, mediaItem.fileName, restoreText, mediaItem.key).catch(function (err) {
        setStatus(String(err && err.message ? err.message : err));
      });
    });
  }

  if (applyPrimerBtn && !applyPrimerBtn.__primerApplyBound) {
    applyPrimerBtn.__primerApplyBound = true;
    applyPrimerBtn.addEventListener('click', function () {
      var mediaItem = getPrimerResetCurrentMediaItem();
      if (!mediaItem) {
        setStatus('Select a media item first.');
        updatePrimerCaptionResetUi();
        return;
      }
      if (!isPrimerInEffectForCurrentItem(mediaItem)) {
        setStatus('Apply is only available while primer text is currently in effect.');
        updatePrimerCaptionResetUi();
        return;
      }
      var textToSave = String((ui && ui.editorEl && ui.editorEl.value) || '');
      saveCaptionDirect(state.folder, mediaItem.fileName, textToSave, mediaItem.key)
        .then(function () {
          updatePrimerCaptionResetUi();
        })
        .catch(function (err) {
          setStatus(String(err && err.message ? err.message : err));
        });
    });
  }

  updatePrimerCaptionResetUi();
}
