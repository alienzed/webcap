// caption_core.js
(function(global) {

  function captionCacheKey(state, mediaItem) {
    return 'path:' + (state.folder || '') + ':' + mediaItem.fileName;
  }

  // All caption reads now use backend endpoint /caption/load
  function readCaptionFromBackend(state, mediaItem) {
    var key = captionCacheKey(state, mediaItem);
    return new Promise(function(resolve) {
      var url = '/caption/load?folder=' + encodeURIComponent(state.folder || '') + '&media=' + encodeURIComponent(mediaItem.fileName);
      HttpModule.get(url, function(status, responseText) {
        if (status !== 200) {
          resolve({ text: '', exists: false });
          return;
        }
        try {
          var resp = JSON.parse(responseText);
          resolve({ text: resp.caption || '', exists: !!resp.exists });
        } catch (e) {
          resolve({ text: '', exists: false });
        }
      });
    });
  }

  function loadCaptionTextForItem(state, mediaItem) {
    var key = captionCacheKey(state, mediaItem);
    if (Object.prototype.hasOwnProperty.call(state.captionCache, key)) {
      return Promise.resolve(state.captionCache[key]);
    }
    return readCaptionFromBackend(state, mediaItem).then(function(result) {
      state.captionCache[key] = result.text || '';
      return state.captionCache[key];
    });
  }

  function savePathCaption(ui, state, mediaItem, text) {
    return new Promise(function(resolve, reject) {
      HttpModule.postJson('/caption/save', { folder: state.folder, media: mediaItem.fileName, text: text }, function(status, responseText) {
        if (status === 200) {
          if (ui && ui.statusEl) {
            ui.statusEl.textContent = 'Saved: ' + mediaItem.fileName.replace(/\.[^.]+$/, '.txt');
          }
          resolve();
          return;
        }
        reject(new Error(getErrorMessage(responseText, 'Could not save caption')));
      });
    });
  }

  global.CaptionOps = {
    captionCacheKey: captionCacheKey,
    loadCaptionTextForItem: loadCaptionTextForItem,
    savePathCaption: savePathCaption
  };
})(window);

var CaptionTemplateModule = (function() {
  function parseDefaults(multiline) {
    var defaults = {};
    String(multiline || '')
      .split(/\r?\n/)
      .map(function(line) { return line.trim(); })
      .filter(Boolean)
      .forEach(function(line) {
        var eq = line.indexOf('=');
        if (eq <= 0) {
          return;
        }
        var key = line.slice(0, eq).trim().toLowerCase();
        var value = line.slice(eq + 1).trim();
        if (key) {
          defaults[key] = value;
        }
      });
    return defaults;
  }

  function parseMappings(multiline) {
    return String(multiline || '')
      .split(/\r?\n/)
      .map(function(line) { return line.trim(); })
      .filter(Boolean)
      .map(function(line) {
        var idx = line.indexOf('=>');
        if (idx === -1) {
          return null;
        }

        var left = line.slice(0, idx).trim().toLowerCase();
        var right = line.slice(idx + 2).trim();
        var eq = right.indexOf('=');
        if (!left || !right || eq <= 0) {
          return null;
        }

        var key = right.slice(0, eq).trim().toLowerCase();
        var value = right.slice(eq + 1).trim();
        if (!key || !value) {
          return null;
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
          return null;
        }

        return { trigger: trigger, key: key, value: value };
      })
      .filter(Boolean);
  }

  function renderMultilineTemplate(template, values) {
    var rendered = String(template || '').replace(/\{\s*([a-zA-Z0-9_]+)\s*\}/g, function(_, rawKey) {
      var key = String(rawKey || '').toLowerCase();
      return values.hasOwnProperty(key) ? values[key] : '';
    });

    rendered = rendered
      .split(/\r?\n/)
      .map(function(line) { return line.replace(/[ \t]+$/g, ''); })
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

    var defaults = parseDefaults(config && config.defaults || '');
    var mappings = parseMappings(config && config.mappings || '');
    var fileNorm = String(fileName || '').toLowerCase();
    var values = {};

    Object.keys(defaults).forEach(function(key) {
      values[key] = defaults[key];
    });

    mappings.forEach(function(rule) {
      if (fileNorm.indexOf(rule.trigger) !== -1) {
        values[rule.key] = rule.value;
      }
    });

    return renderMultilineTemplate(template, values);
  }

  function parseRules(multiline) {
    var template = '';
    var defaults = {};
    var assignments = [];

    String(multiline || '')
      .split(/\r?\n/)
      .map(function(line) { return line.trim(); })
      .filter(Boolean)
      .forEach(function(line) {
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
    var rendered = String(template || '').replace(/\{\s*([a-zA-Z0-9_]+)\s*\}/g, function(_, rawKey) {
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

    Object.keys(cfg.defaults).forEach(function(key) {
      values[key] = cfg.defaults[key];
    });

    cfg.assignments.forEach(function(rule) {
      if (fileNorm.indexOf(rule.trigger) !== -1) {
        values[rule.key] = rule.value;
      }
    });

    return renderTemplate(cfg.template, values);
  }

  return {
    buildPrimer: buildPrimer,
    buildPrimerFromConfig: buildPrimerFromConfig
  };
})();

// File mutation helpers for prune/restore and trash naming.

var CaptionTrashOps = (function() {
  var TRASH_NAME_PATTERN = /^[^_]+_[^_]+__.+$/;

  async function writeFileFromArrayBuffer(dirHandle, name, buffer) {
    var handle = await dirHandle.getFileHandle(name, { create: true });
    var writer = await handle.createWritable();
    await writer.write(buffer);
    await writer.close();
  }

  async function writeFileFromText(dirHandle, name, text) {
    var handle = await dirHandle.getFileHandle(name, { create: true });
    var writer = await handle.createWritable();
    await writer.write(text);
    await writer.close();
  }

  function makeTrashName(baseName) {
    var stamp = Date.now().toString(36);
    var rand = Math.floor(Math.random() * 0xffff).toString(16);
    return stamp + '_' + rand + '__' + baseName;
  }

  function getOriginalNameFromTrashName(name) {
    var fileName = String(name || '');
    if (!TRASH_NAME_PATTERN.test(fileName)) {
      return '';
    }
    var splitAt = fileName.indexOf('__');
    if (splitAt < 0) {
      return '';
    }
    return fileName.slice(splitAt + 2);
  }

  return {
    makeTrashName: makeTrashName,
    getOriginalNameFromTrashName: getOriginalNameFromTrashName
  };
})();

// Minimal state management for caption mode

(function(global) {
  var state = {
    folder: '',
    suppressInput: false,
    items: [],
    childFolders: [],
    currentItem: null,
    objectUrl: '',
    mode: 'path',
    dirStack: [],
    reviewMode: false,
    captionCache: {},
    listRenderSeq: 0,
    reviewedSet: new Set(),
    focusSet: null
  };
  global.CaptionState = state;
})(window);