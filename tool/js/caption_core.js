// caption_core.js
// Global functions: captionCacheKey, renderMultilineTemplate, buildPrimerFromConfig, parseRules, renderTemplate, buildPrimer, makeTrashName, getOriginalNameFromTrashName, setupFolderStatePersistence, setupFolderStateReset
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

// All functions are now global: buildPrimer, buildPrimerFromConfig

// File mutation helpers for prune/restore and trash naming.
// All functions are now global: makeTrashName, getOriginalNameFromTrashName


function setupFolderStatePersistence(ui) {
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

function setupFolderStateReset(ui) {
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

