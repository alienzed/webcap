/**
 * Sanitize the folder state data by ensuring all fields have valid types and default values.
 * 
 * @param {*} data - The raw folder state data to sanitize
 * 
 * @returns {object} - The sanitized folder state object
 */
function sanitizeFolderState(data) {
  var src = data || {};
  var stats = src.stats || {};
  var primer = src.primer || {};
  var reviewRulesValue = Array.isArray(stats.reviewRules)
    ? JSON.parse(JSON.stringify(stats.reviewRules))
    : (typeof stats.reviewRules === 'string' ? String(stats.reviewRules) : []);
  var primerMappingsValue = Array.isArray(primer.mappings)
    ? JSON.parse(JSON.stringify(primer.mappings))
    : (typeof primer.mappings === 'string' ? String(primer.mappings) : []);
  var reviewedKeys = Array.isArray(src.reviewedKeys) ? src.reviewedKeys : [];
  reviewedKeys = reviewedKeys.map(function (key) { return String(key || ''); }).filter(Boolean);
  var tagMap = {};
  if (typeof src.caption_tags_by_media === 'object' && src.caption_tags_by_media) {
    Object.keys(src.caption_tags_by_media).forEach(function (mediaKey) {
      var list = Array.isArray(src.caption_tags_by_media[mediaKey]) ? src.caption_tags_by_media[mediaKey] : [];
      var clean = list.map(function (v) { return String(v || '').trim(); }).filter(Boolean);
      if (clean.length) {
        tagMap[String(mediaKey || '')] = clean;
      }
    });
  }
  var ratingsByMedia = {};
  if (typeof src.ratings_by_media === 'object' && src.ratings_by_media) {
    Object.keys(src.ratings_by_media).forEach(function (mediaKey) {
      var n = Number(src.ratings_by_media[mediaKey]);
      if (!isFinite(n)) return;
      var rating = Math.max(1, Math.min(5, Math.round(n)));
      ratingsByMedia[String(mediaKey || '')] = rating;
    });
  }
  var mutatedMediaKeys = Array.isArray(src.mutated_media_keys) ? src.mutated_media_keys : [];
  mutatedMediaKeys = Array.from(new Set(mutatedMediaKeys
    .map(function (key) { return String(key || '').trim(); })
    .filter(Boolean)));
  var captionTermAffixes = {};
  if (typeof src.caption_term_affixes === 'object' && src.caption_term_affixes) {
    Object.keys(src.caption_term_affixes).forEach(function (termKey) {
      var entry = src.caption_term_affixes[termKey];
      if (!entry || typeof entry !== 'object') return;
      var key = String(termKey || '').trim().toLowerCase();
      if (!key) return;
      var prefix = String(entry.prefix || '').trim();
      var suffix = String(entry.suffix || '').trim();
      if (!prefix && !suffix) return;
      captionTermAffixes[key] = { prefix: prefix, suffix: suffix };
    });
  }
  var requirementsNaByMedia = {};
  if (typeof src.caption_requirements_na_by_media === 'object' && src.caption_requirements_na_by_media) {
    Object.keys(src.caption_requirements_na_by_media).forEach(function (mediaKey) {
      var rawMap = src.caption_requirements_na_by_media[mediaKey];
      if (!rawMap || typeof rawMap !== 'object') return;
      var cleanMap = {};
      Object.keys(rawMap).forEach(function (requirementLabel) {
        var req = String(requirementLabel || '').trim();
        if (!req) return;
        if (rawMap[requirementLabel]) {
          cleanMap[req] = true;
        }
      });
      if (Object.keys(cleanMap).length) {
        requirementsNaByMedia[String(mediaKey || '').trim()] = cleanMap;
      }
    });
  }
  return {
    version: FOLDER_STATE_VERSION,
    stats: {
      requiredPhrase: String(stats.requiredPhrase || ''),
      phrases: String(stats.phrases || ''),
      reviewRules: reviewRulesValue
    },
    primer: {
      template: String(primer.template || ''),
      mappings: primerMappingsValue
    },
    reviewedKeys: reviewedKeys,
    flags: (typeof src.flags === 'object' && src.flags) ? src.flags : {},
    caption_requirements: Array.isArray(src.caption_requirements) ? src.caption_requirements.slice() : getDefaultRequirementItems().slice(),
    caption_requirements_checked: (typeof src.caption_requirements_checked === 'object' && src.caption_requirements_checked) ? JSON.parse(JSON.stringify(src.caption_requirements_checked)) : {},
    caption_requirement_keywords: (typeof src.caption_requirement_keywords === 'object' && src.caption_requirement_keywords) ? JSON.parse(JSON.stringify(src.caption_requirement_keywords)) : {},
    caption_requirements_na_by_media: requirementsNaByMedia,
    caption_term_affixes: captionTermAffixes,
    caption_phrases: Array.isArray(src.caption_phrases) ? src.caption_phrases.slice() : undefined,
    quick_phrases: Array.isArray(src.quick_phrases) ? src.quick_phrases.slice() : undefined,
    caption_set_notes: String(src.caption_set_notes || ''),
    annotate_strip_visible: !!src.annotate_strip_visible,
    caption_helper_panel_collapsed: !!src.caption_helper_panel_collapsed,
    caption_tags_by_media: tagMap,
    ratings_by_media: ratingsByMedia,
    mutated_media_keys: mutatedMediaKeys
  };
}

/**
 * Save the folder state to the server.
 * 
 * @param {string} folderPath - The relative path from the FS root ('' for root)
 * @param {*} folderState - The folder state to save
 * 
 * @returns {Promise<boolean>} - Resolves to true if successful, false otherwise
 */
async function writeFolderStateFile(folderPath, folderState) {
  // folderPath: relative path from FS root ('' for root)
  debugLog('[writeFolderStateFile] folderPath:', folderPath, 'folderState:', folderState);
  try {
    const payload = { folder: folderPath, state: folderState };
    debugLog('[writeFolderStateFile] Sending payload:', payload);
    const resp = await fetch('/fs/folder_state/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    debugLog('[writeFolderStateFile] Response status:', resp.status);
    if (!resp.ok) throw new Error('Failed to save folder state');
    return true;
  } catch (err) {
    console.warn('Could not write folder state file:', err);
    return false;
  }
}

/**
 * Snapshot the current folder state from the DOM.
 * 
 * @returns {object} - The sanitized folder state object
 */
function snapshotFolderStateFromDom() {
  // IMPORTANT: If you add new fields to the folder state, you MUST include them here
  // so they are persisted. This function must snapshot ALL fields that should be saved.
  var stats = getOptionsFromDom();
  var primer = statsGetPrimerOptionsFromDom();
  var mediaKeys = new Set((state.items || []).map(function (item) { return item && item.key; }).filter(Boolean));
  var folderKeys = new Set((state.childFolders || []).map(function (item) { return item && item.name; }).filter(Boolean));
  var validFlagKeys = new Set(Array.from(mediaKeys));
  folderKeys.forEach(function (k) { validFlagKeys.add(k); });
  var reviewedKeys = Array.from(state.reviewedSet || []).filter(function (k) { return mediaKeys.has(k); }).sort();
  var flags = {};
  var srcFlags = (typeof state.flags === 'object' && state.flags) ? state.flags : {};
  Object.keys(srcFlags).forEach(function (k) {
    if (validFlagKeys.has(k)) flags[k] = srcFlags[k];
  });
  var tagsByMedia = {};
  var srcTagsByMedia = (typeof window.captionItemTagsByMedia === 'object' && window.captionItemTagsByMedia)
    ? window.captionItemTagsByMedia
    : {};
  Object.keys(srcTagsByMedia).forEach(function (k) {
    if (!mediaKeys.has(k)) return;
    var list = Array.isArray(srcTagsByMedia[k]) ? srcTagsByMedia[k] : [];
    if (list.length) {
      tagsByMedia[k] = list.slice();
    }
  });
  var ratingsByMedia = {};
  var srcRatingsByMedia = (typeof state.ratings === 'object' && state.ratings) ? state.ratings : {};
  Object.keys(srcRatingsByMedia).forEach(function (k) {
    if (!mediaKeys.has(k)) return;
    var n = Number(srcRatingsByMedia[k]);
    if (!isFinite(n)) return;
    var rating = Math.max(1, Math.min(5, Math.round(n)));
    ratingsByMedia[k] = rating;
  });
  var mutatedKeys = Array.from(state.mutatedSet || [])
    .map(function (k) { return String(k || '').trim(); })
    .filter(function (k) { return mediaKeys.has(k); })
    .sort();
  // Add new fields here as needed
  return sanitizeFolderState({
    stats: stats,
    primer: primer,
    reviewedKeys: reviewedKeys,
    flags: flags,
    caption_requirements: (typeof window.checklistItems !== 'undefined') ? window.checklistItems.slice() : undefined,
    caption_requirements_checked: (typeof window.checklistCheckedByMedia !== 'undefined') ? JSON.parse(JSON.stringify(window.checklistCheckedByMedia)) : undefined,
    caption_requirement_keywords: (typeof window.checklistKeywordsByItem !== 'undefined') ? JSON.parse(JSON.stringify(window.checklistKeywordsByItem)) : undefined,
    caption_requirements_na_by_media: (typeof window.checklistRequirementsNaByMedia !== 'undefined') ? JSON.parse(JSON.stringify(window.checklistRequirementsNaByMedia)) : undefined,
    caption_term_affixes: (typeof window.checklistTermAffixesByKey !== 'undefined') ? JSON.parse(JSON.stringify(window.checklistTermAffixesByKey)) : undefined,
    caption_phrases: window.captionHelperPhrases.slice(),
    quick_phrases: (typeof window.captionQuickPhrases !== 'undefined' && Array.isArray(window.captionQuickPhrases))
      ? window.captionQuickPhrases.slice()
      : undefined,
    caption_set_notes: String(window.captionHelperNotes || ''),
    annotate_strip_visible: !!window.annotateStripVisible,
    caption_helper_panel_collapsed: !!window.captionHelperPanelCollapsed,
    caption_tags_by_media: tagsByMedia,
    ratings_by_media: ratingsByMedia,
    mutated_media_keys: mutatedKeys
  });
}

/**
 * Apply the given folder state to the DOM and global state.
 * 
 * @param {*} folderState 
 * 
 * @return
 */
function applyFolderStateToDom(folderState) {
  // IMPORTANT: If you add new fields to the folder state, you MUST handle them here
  // so they are restored to both the global state and the UI. This function must apply ALL fields.
  var clean = sanitizeFolderState(folderState);
  // Restore reviewedSet from reviewedKeys for persistence
  if (Array.isArray(clean.reviewedKeys)) {
    state.reviewedSet = new Set(clean.reviewedKeys);
  }
  // Restore flags from loaded state
  if (clean.flags) {
    state.flags = clean.flags;
  }
  state.ratings = (clean && clean.ratings_by_media && typeof clean.ratings_by_media === 'object')
    ? clean.ratings_by_media
    : {};
  state.mutatedSet = new Set(Array.isArray(clean.mutated_media_keys) ? clean.mutated_media_keys : []);
  state.mutatedByMediaSource = {};
  state.mutatedSet.forEach(function (key) {
    state.mutatedByMediaSource[key] = 'best_effort';
  });
  // Restore stats and primer fields to DOM
  var requiredPhraseEl = document.getElementById('stats-required-phrase');
  var phrasesEl = document.getElementById('stats-phrases');
  var templateEl = document.getElementById('primer-template');

  if (requiredPhraseEl) {
    requiredPhraseEl.value = clean.stats.requiredPhrase;
  }
  if (phrasesEl) {
    phrasesEl.value = clean.stats.phrases;
  }
  if (typeof loadStatsBalancePhrasesFromTextarea === 'function') {
    loadStatsBalancePhrasesFromTextarea();
  }
  if (typeof renderStatsBalancePhraseList === 'function') {
    renderStatsBalancePhraseList();
  }
  if (typeof loadReviewRulesRows === 'function') {
    loadReviewRulesRows(clean.stats.reviewRules);
  }
  if (templateEl) {
    templateEl.value = clean.primer.template;
  }
  if (typeof loadPrimerMappingsRows === 'function') {
    loadPrimerMappingsRows(clean.primer.mappings);
  }
  // Add new field restoration logic here as needed
}

/**
 * Save the current folder state for the current root folder.
 * 
 * @returns {Promise<void>} - Resolves when the save is complete
 */
async function saveFolderStateForCurrentRoot() {
  if (!state.folder) {
    return;
  }
  var folderPath = state.folder;
  var snapshot = snapshotFolderStateFromDom();
  await writeFolderStateFile(folderPath, snapshot);
}


function renderMultilineTemplate(template, values) {
  var rendered = String(template || '').replace(/\{([^{}]+)\}/g, function (_, rawInner) {
    var inner = String(rawInner || '');
    var conditional = inner.split('|');
    if (conditional.length === 2 || conditional.length === 3) {
      var conditionalPrefix = '';
      var conditionalKey = '';
      var conditionalSuffix = '';
      if (conditional.length === 2) {
        conditionalKey = String(conditional[0] || '').trim().toLowerCase();
        conditionalSuffix = String(conditional[1] || '');
      } else {
        conditionalPrefix = String(conditional[0] || '');
        conditionalKey = String(conditional[1] || '').trim().toLowerCase();
        conditionalSuffix = String(conditional[2] || '');
      }
      if (!conditionalKey || !values.hasOwnProperty(conditionalKey)) return '';
      var conditionalValue = String(values[conditionalKey] || '').trim();
      if (!conditionalValue) return '';
      return conditionalPrefix + conditionalValue + conditionalSuffix;
    }

    var key = '';
    var prefix = '';
    var suffix = '';
    // Support conditional punctuation by allowing non-key chars around key:
    // {view,} => "front,"
    // {,view} => ",front"
    // { (view) } => " (front) "
    var punctuated = inner.match(/^([^A-Za-z0-9_]*)([A-Za-z0-9_]+)([^A-Za-z0-9_]*)$/);
    if (punctuated) {
      prefix = punctuated[1] || '';
      key = String(punctuated[2] || '').toLowerCase();
      suffix = punctuated[3] || '';
    } else {
      key = String(inner || '').trim().toLowerCase();
    }
    if (!key || !values.hasOwnProperty(key)) return '';
    var value = String(values[key] || '').trim();
    if (!value) return '';
    return prefix + value + suffix;
  });

  rendered = rendered
    .split(/\r?\n/)
    .map(function (line) { return line.replace(/[ \t]+$/g, ''); })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return rendered;
}

function normalizeRequirementPrimerKey(requirementLabel) {
  var label = String(requirementLabel || '').trim();
  if (!label) return '';
  var lower = label.toLowerCase();
  var aliases = DEFAULT_REQUIREMENT_PRIMER_KEY_ALIASES;
  if (
    typeof MAPPINGS_SYSTEM_DEFAULTS === 'object' &&
    MAPPINGS_SYSTEM_DEFAULTS &&
    MAPPINGS_SYSTEM_DEFAULTS.primer &&
    typeof MAPPINGS_SYSTEM_DEFAULTS.primer.keyAliases === 'object'
  ) {
    aliases = MAPPINGS_SYSTEM_DEFAULTS.primer.keyAliases;
  }
  if (
    typeof aliases === 'object' &&
    aliases &&
    aliases[lower]
  ) {
    return String(aliases[lower] || '').trim().toLowerCase();
  }
  return lower.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
}

function parseRequirementKeywordList(raw) {
  return String(raw || '')
    .split(',')
    .map(function (part) { return String(part || '').trim(); })
    .filter(Boolean);
}

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textContainsWholeToken(text, token) {
  var hay = String(text || '').toLowerCase();
  var needle = String(token || '').trim().toLowerCase();
  if (!hay || !needle) return false;
  var pattern = new RegExp('(^|[^a-z0-9])' + escapeRegex(needle) + '(?=$|[^a-z0-9])', 'i');
  return pattern.test(hay);
}

function textMatchesNormalizedText(text, token) {
  var hay = String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();
  var needle = String(token || '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!hay || !needle) return false;
  return hay === needle;
}

function countTokenWords(text) {
  var words = String(text || '').toLowerCase().match(/[a-z0-9]+/g);
  return words ? words.length : 0;
}

function removeSubsumedPrimerValues(values) {
  if (!Array.isArray(values) || values.length < 2) return Array.isArray(values) ? values.slice() : [];
  var normalized = values.map(function (value) { return String(value || '').trim().toLowerCase(); });
  var keep = values.map(function () { return true; });
  for (var i = 0; i < normalized.length; i++) {
    var current = normalized[i];
    if (!current) {
      keep[i] = false;
      continue;
    }
    var currentWordCount = countTokenWords(current);
    for (var j = 0; j < normalized.length; j++) {
      if (i === j) continue;
      var candidate = normalized[j];
      if (!candidate || candidate === current) continue;
      var candidateWordCount = countTokenWords(candidate);
      if (candidateWordCount <= currentWordCount) continue;
      if (textContainsWholeToken(candidate, current)) {
        keep[i] = false;
        break;
      }
    }
  }
  return values.filter(function (_, idx) { return keep[idx]; });
}

function getRequirementDefaultPrimerMappings() {
  var requirements = (
    typeof checklistItems !== 'undefined' &&
    Array.isArray(checklistItems) &&
    checklistItems.length
  )
    ? checklistItems.slice()
    : getDefaultRequirementItems().slice();
  var keywordsByRequirement = (
    typeof checklistKeywordsByItem === 'object' &&
    checklistKeywordsByItem
  )
    ? checklistKeywordsByItem
    : {};
  var rows = [];
  var seen = {};
  var defaultsByItem = getDefaultRequirementKeywordsByItem();
  var requirementScope = 'tag';
  if (
    typeof MAPPINGS_SYSTEM_DEFAULTS === 'object' &&
    MAPPINGS_SYSTEM_DEFAULTS &&
    MAPPINGS_SYSTEM_DEFAULTS.primer &&
    MAPPINGS_SYSTEM_DEFAULTS.primer.requirementDefaultScope
  ) {
    var configuredScope = String(MAPPINGS_SYSTEM_DEFAULTS.primer.requirementDefaultScope || '').toLowerCase();
    if (configuredScope === 'file' || configuredScope === 'tag') {
      requirementScope = configuredScope;
    }
  }

  requirements.forEach(function (requirement) {
    var key = normalizeRequirementPrimerKey(requirement);
    if (!key) return;
    var rawKeywords = String(keywordsByRequirement[requirement] || '').trim();
    if (!rawKeywords) {
      rawKeywords = String(defaultsByItem[requirement] || '').trim();
    }
    var keywords = parseRequirementKeywordList(rawKeywords);
    keywords.forEach(function (keyword) {
      var token = String(keyword || '').trim().toLowerCase();
      if (!token) return;
      var dedupeKey = key + '::' + token;
      if (seen[dedupeKey]) return;
      seen[dedupeKey] = true;
      rows.push({
        scope: requirementScope,
        token: token,
        key: key,
        value: keyword,
        enabled: true
      });
    });
  });

  return rows;
}

function buildPrimerFromConfig(fileName, mediaKey, config) {
  var template = String(config && config.template || '');
  if (!template.trim()) {
    return '';
  }
  var valuesByKey = {};
  var seenValueByKey = {};
  var fileNorm = String(fileName || '').toLowerCase();
  var customRows = Array.isArray(config && config.mappings) ? config.mappings : [];
  var defaultRows = getRequirementDefaultPrimerMappings();
  // Row order is preserved; matching values for the same key are appended in order.
  var rows = customRows.concat(defaultRows);
  var mediaTags = [];
  if (mediaKey && typeof getTagsForMediaKey === 'function') {
    mediaTags = getTagsForMediaKey(mediaKey).map(function (tag) { return String(tag || '').toLowerCase(); });
  }
  rows.forEach(function (rawRow) {
    var row = rawRow || {};
    var enabled = row.enabled !== false;
    if (!enabled) return;
    var scope = String(row.scope || 'file').toLowerCase();
    var token = String(row.token || '').trim().toLowerCase();
    var key = String(row.key || '').trim().toLowerCase();
    var value = String(row.value || '').trim();
    if (!value) value = token;
    if (!token || !key) return;
    var matched = false;
    if (scope === 'tag') {
      matched = mediaTags.some(function (tagValue) {
        return textMatchesNormalizedText(tagValue, token);
      });
    } else {
      matched = textContainsWholeToken(fileNorm, token);
    }
    if (!matched) return;
    if (!valuesByKey[key]) {
      valuesByKey[key] = [];
      seenValueByKey[key] = {};
    }
    var dedupeValue = value.toLowerCase();
    if (seenValueByKey[key][dedupeValue]) return;
    seenValueByKey[key][dedupeValue] = true;
    valuesByKey[key].push(value);
  });
  var values = {};
  Object.keys(valuesByKey).forEach(function (key) {
    values[key] = removeSubsumedPrimerValues(valuesByKey[key]).join(', ');
  });
  return renderMultilineTemplate(template, values);
}
