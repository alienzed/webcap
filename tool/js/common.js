// NOTE: This project intentionally uses plain global variables for all state and functions.
// No IIFE, encapsulation, or modular patterns are used by design.

// Load config.json synchronously and set ROOT_FOLDER_LABEL
try {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/static/config.json', false); // sync
  xhr.send(null);
  if (xhr.status === 200) {
    var config = JSON.parse(xhr.responseText);
    if (config && config.filesystem && config.filesystem.root) {
      var rootPath = config.filesystem.root;
      // Use last segment of root path as label
      ROOT_FOLDER_LABEL = String(rootPath).replace(/[\\/]+$/, '').split(/[\\/]/).pop();
    }
  }
} catch (e) {
  console.warn('Failed to load config.json for ROOT_FOLDER_LABEL:', e);
}

function debugLog() {
  if (!DEBUG) return;
  if (arguments.length === 1) {
    console.log(arguments[0]);
  } else {
    console.log.apply(console, arguments);
  }
}

function setStatus(text) {
  ui.statusEl.textContent = text || '';
  appendToConsolePanel(text || '');
}

function normalizeFolderInput(value) {
  var text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length >= 2 && text[0] === '"' && text[text.length - 1] === '"') {
    text = text.slice(1, -1).trim();
  }
  return text;
}

function isBlacklistedSetSubfolderName(name) {
  var n = String(name || '').toLowerCase();
  return n === 'originals' || n === 'auto_dataset';
}

// Path-only check: non-root folder path that does not include known
// system subfolders (originals/auto_dataset) at any level.
function isSetFolderPath(path) {
  var value = String(path || '').trim();
  if (!value) return false;
  var parts = value.split(/[\\/]/).filter(Boolean).map(function (p) { return p.toLowerCase(); });
  if (!parts.length) return false;
  return !parts.some(isBlacklistedSetSubfolderName);
}

// Runtime "set context" check used by UI availability rules.
// A folder is actionable as a set only if it passes the path check and
// currently has media items loaded.
function isSetFolderContext(path, mediaItems) {
  if (!isSetFolderPath(path)) return false;
  return Array.isArray(mediaItems) && mediaItems.length > 0;
}

function getFileExtension(name) {
  var idx = name.lastIndexOf('.');
  if (idx === -1) {
    return '';
  }
  return name.slice(idx).toLowerCase();
}

function getErrorMessage(responseText, fallback) {
  try {
    var data = JSON.parse(responseText);
    return data.error || fallback;
  } catch (e) {
    console.warn('Failed to parse error response as JSON:', e);
    return fallback;
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildAutoPrimer(fileName) {
  var primerOptions = statsGetPrimerOptionsFromDom();
  if (!primerOptions || !primerOptions.template.trim()) {
    return '';
  }
  return buildPrimerFromConfig(fileName, primerOptions);
}
function debounceCreate(waitMs) {
  var timer = null;
  return function (callback) {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(callback, waitMs);
  };
}


// Network helper functions
var HttpModule = {
  get: function(url, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        callback(xhr.status, xhr.responseText);
      }
    };
    xhr.send();
  },
  postJson: function(url, data, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        callback(xhr.status, xhr.responseText);
      }
    };
    xhr.send(JSON.stringify(data));
  },
  postFormData: function(url, formData, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        callback(xhr.status, xhr.responseText);
      }
    };
    xhr.send(formData);
  }
};

// Save caption text for a given folder/media/text (atomic, stateless)
function saveCaptionDirect(folder, media, text, mediaKey) {
  return new Promise(function (resolve, reject) {
    HttpModule.postJson('/caption/save', {
      folder: folder,
      media: media,
      text: text || ''
    }, function(status, responseText) {
      if (status === 200) {
        setStatus('Saved: ' + (media || '').replace(/\.[^.]+$/, '.txt'));
        var hasCaption = !!(text && text.trim().length);
        var updatedKey = null;
        // Update state
        for (var i = 0; i < state.items.length; i++) {
          if (state.items[i].fileName === media) {
            state.items[i].caption = text;
            state.items[i].hasCaption = hasCaption;
            updatedKey = state.items[i].key;
            break;
          }
        }
        // Toggle class on row
        var row = ui.mediaListEl.querySelector('[data-type="media"][data-key="' + (updatedKey || mediaKey) + '"]');
        if (row) row.classList.toggle('empty-caption', !hasCaption);
        resolve();
        return;
      }
      reject(new Error(getErrorMessage(responseText, 'Could not save caption')));
    });
  });
}

// Save config file directly (for autosave and manual save from preview pane)
function saveConfigDirect(folder, file, text) {
  return new Promise(function (resolve, reject) {
    HttpModule.postJson('/fs/save_config', {
      folder: folder,
      file: file,
      text: text || ''
    }, function(status, responseText) {
      if (status === 200) {
        setStatus('Config saved.');
        resolve();
        return;
      }
      reject(new Error(getErrorMessage(responseText, 'Could not save config')));
    });
  });
}

// Save caption text for the current media item (fully global, fail-loudly)
function savePathCaption() {
  var mediaItem = state.currentItem;
  // Guard: only save if currentItem matches the visible editor context
  if (!mediaItem || !mediaItem.fileName || ui.editorEl.getAttribute('readonly')) {
    throw new Error('savePathCaption: invalid or stale mediaItem');
  }
  // Skip saving if editor contains only the primer caption
  var primer = '';
  if (mediaItem.fileName) {
    primer = buildAutoPrimer(mediaItem.fileName);
  }
  var editorValue = ui.editorEl.value || '';
  if (primer && editorValue.trim() === primer.trim()) {
    debugLog('[savePathCaption] Skipped save: editor contains only primer caption');
    return Promise.resolve();
  }
  // Skip saving if caption hasn't changed
  var currentCaption = mediaItem.caption || '';
  if (editorValue === currentCaption) {
    debugLog('[savePathCaption] Skipped save: caption unchanged');
    return Promise.resolve();
  }
  return saveCaptionDirect(state.folder, mediaItem.fileName, editorValue, mediaItem.key);
}

// Legacy/manual save entrypoint used by multiple UI paths.
// Returns a Promise and supports both caption and config editor modes.
function saveCurrentCaption() {
  if (state.currentConfigFile && state.currentConfigFile.file) {
    var cfgFolder = state.currentConfigFile.folder || state.folder || '';
    return saveConfigDirect(cfgFolder, state.currentConfigFile.file, ui.editorEl.value || '');
  }
  try {
    return Promise.resolve(savePathCaption());
  } catch (err) {
    return Promise.reject(err);
  }
}
