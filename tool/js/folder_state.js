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
  var reviewedKeys = Array.isArray(src.reviewedKeys) ? src.reviewedKeys : [];
  reviewedKeys = reviewedKeys.map(function (key) { return String(key || ''); }).filter(Boolean);
  return {
    version: FOLDER_STATE_VERSION,
    stats: {
      requiredPhrase: String(stats.requiredPhrase || ''),
      phrases: String(stats.phrases || ''),
      tokenRules: String(stats.tokenRules || '')
    },
    primer: {
      template: String(primer.template || ''),
      defaults: String(primer.defaults || ''),
      mappings: String(primer.mappings || '')
    },
    reviewedKeys: reviewedKeys,
    flags: (typeof src.flags === 'object' && src.flags) ? src.flags : {},
    caption_requirements: Array.isArray(src.caption_requirements) ? src.caption_requirements.slice() : undefined,
    caption_requirements_checked: (typeof src.caption_requirements_checked === 'object' && src.caption_requirements_checked) ? JSON.parse(JSON.stringify(src.caption_requirements_checked)) : undefined
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
  // Add new fields here as needed
  return sanitizeFolderState({
    stats: stats,
    primer: primer,
    reviewedKeys: Array.from(state.reviewedSet || []).sort(),
    flags: (typeof state.flags === 'object' && state.flags) ? state.flags : {},
    caption_requirements: (typeof window.checklistItems !== 'undefined') ? window.checklistItems.slice() : undefined,
    caption_requirements_checked: (typeof window.checklistCheckedByMedia !== 'undefined') ? JSON.parse(JSON.stringify(window.checklistCheckedByMedia)) : undefined
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
  // Restore stats and primer fields to DOM
  var requiredPhraseEl = document.getElementById('stats-required-phrase');
  var phrasesEl = document.getElementById('stats-phrases');
  var tokenRulesEl = document.getElementById('stats-token-rules');
  var templateEl = document.getElementById('primer-template');
  var defaultsEl = document.getElementById('primer-defaults');
  var mappingsEl = document.getElementById('primer-mappings');

  if (requiredPhraseEl) {
    requiredPhraseEl.value = clean.stats.requiredPhrase;
  }
  if (phrasesEl) {
    phrasesEl.value = clean.stats.phrases;
  }
  if (tokenRulesEl) {
    tokenRulesEl.value = clean.stats.tokenRules;
  }
  if (templateEl) {
    templateEl.value = clean.primer.template;
  }
  if (defaultsEl) {
    defaultsEl.value = clean.primer.defaults;
  }
  if (mappingsEl) {
    mappingsEl.value = clean.primer.mappings;
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


/**
 * Setup folder state persistence by binding input events to save the state.
 * 
 * @param {object} ui - The global UI object containing references to DOM elements
 *  
 */
function setupFolderStatePersistence() {
  var saveLater = debounceCreate(300);
  state.scheduleFolderStateSave = function () {
    saveLater(function () {
      saveFolderStateForCurrentRoot().catch(function (err) {
        setStatus(String(err && err.message ? err.message : err));
      });
    });
  };
  var ids = [
    'stats-required-phrase',
    'stats-phrases',
    'stats-token-rules',
    'primer-template',
    'primer-defaults',
    'primer-mappings'
  ];

  ids.forEach(function (id) {
    var el = document.getElementById(id);
    if (!el || el.__folderStateBound) {
      return;
    }
    el.__folderStateBound = true;
    el.addEventListener('input', function () {
      state.scheduleFolderStateSave();
    });
  });
}

function setupFolderStateReset() {
  var btn = document.getElementById('folder-settings-reset-btn');
  if (!btn || btn.__folderResetBound) {
    return;
  }
  btn.__folderResetBound = true;
  btn.addEventListener('click', function () {
    resetFolderState().catch(function (err) {
      setStatus(String(err && err.message ? err.message : err));
    });
  });
}

function captionCacheKey(mediaItem) {
  return 'path:' + (state.folder || '') + ':' + mediaItem.fileName;
}

function renderMultilineTemplate(template, values) {
  var rendered = String(template || '').replace(/\{\s*([a-zA-Z0-9_]+)\s*\}/g, function (_, rawKey) {
    var key = String(rawKey || '').toLowerCase();
    return values.hasOwnProperty(key) ? values[key] : '';
  });

  rendered = rendered
    .split(/\r?\n/)
    .map(function (line) { return line.replace(/[ \t]+$/g, ''); })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return rendered;
}

function buildPrimerFromConfig(fileName, config) {
  var template = String(config && config.template || '');
  if (!template.trim()) {
    return '';
  }
  // Fallback: treat defaults/mappings as empty
  var values = {};
  return renderMultilineTemplate(template, values);
}

function parseRules(multiline) {
  var template = '';
  var defaults = {};
  var assignments = [];

  String(multiline || '')
    .split(/\r?\n/)
    .map(function (line) { return line.trim(); })
    .filter(Boolean)
    .forEach(function (line) {
      var lower = line.toLowerCase();

      if (lower.indexOf('template:') === 0) {
        template = line.slice('template:'.length).trim();
        return;
      }

      if (lower.indexOf('default:') === 0) {
        var defaultPart = line.slice('default:'.length).trim();
        var eq = defaultPart.indexOf('=');
        if (eq > 0) {
          var key = defaultPart.slice(0, eq).trim().toLowerCase();
          var value = defaultPart.slice(eq + 1).trim();
          if (key) {
            defaults[key] = value;
          }
        }
        return;
      }

      var idx = line.indexOf('=>');
      if (idx === -1) {
        return;
      }

      var left = line.slice(0, idx).trim().toLowerCase();
      var right = line.slice(idx + 2).trim();
      var eq = right.indexOf('=');
      if (!left || !right || eq <= 0) {
        return;
      }

      var key = right.slice(0, eq).trim().toLowerCase();
      var value = right.slice(eq + 1).trim();
      if (!key || !value) {
        return;
      }

      var scope = 'file';
      var trigger = left;
      var colon = left.indexOf(':');
      if (colon > 0) {
        var prefix = left.slice(0, colon).trim();
        var scopedTrigger = left.slice(colon + 1).trim();
        if ((prefix === 'file' || prefix === 'caption') && scopedTrigger) {
          scope = prefix;
          trigger = scopedTrigger;
        }
      }

      if (scope !== 'file') {
        return;
      }

      assignments.push({ trigger: trigger, key: key, value: value });
    });

  return {
    template: template,
    defaults: defaults,
    assignments: assignments
  };
}

function renderTemplate(template, values) {
  var rendered = String(template || '').replace(/\{\s*([a-zA-Z0-9_]+)\s*\}/g, function (_, rawKey) {
    var key = String(rawKey || '').toLowerCase();
    return values.hasOwnProperty(key) ? values[key] : '';
  });

  rendered = rendered
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,+/g, ', ')
    .replace(/^,\s*/, '')
    .replace(/,\s*$/, '')
    .trim();

  return rendered;
}

function buildPrimer(fileName, rulesText) {
  var cfg = parseRules(rulesText);
  if (!cfg.template) {
    return '';
  }

  var fileNorm = String(fileName || '').toLowerCase();
  var values = {};

  Object.keys(cfg.defaults).forEach(function (key) {
    values[key] = cfg.defaults[key];
  });

  cfg.assignments.forEach(function (rule) {
    if (fileNorm.indexOf(rule.trigger) !== -1) {
      values[rule.key] = rule.value;
    }
  });

  return renderTemplate(cfg.template, values);
}
