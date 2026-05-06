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
        // Toggle empty-caption class on the relevant media item if key provided
        if (ui && ui.mediaListEl && mediaKey) {
          var itemEl = ui.mediaListEl.querySelector('[data-type="media"][data-key="' + mediaKey + '"]');
          if (itemEl) {
            if (text && text.trim().length > 0) {
              itemEl.classList.remove('empty-caption');
            } else {
              itemEl.classList.add('empty-caption');
            }
          }
        }
        // --- Carefully update state.items with the new caption (match by fileName only) ---
        if (window.state && Array.isArray(state.items)) {
          var updated = false;
          for (var i = 0; i < state.items.length; i++) {
            var item = state.items[i];
            if (item && item.fileName === media) {
              item.caption = text;
              updated = true;
              break;
            }
          }
          // Optionally: log if not found (should not happen)
          // if (!updated) console.warn('saveCaptionDirect: No matching state.items entry found for', media);
        }
        resolve();
        return;
      }
      reject(new Error(getErrorMessage(responseText, 'Could not save caption')));
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
  return saveCaptionDirect(state.folder, mediaItem.fileName, editorValue, mediaItem.key);
}