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

// Called whenever the preview pane is cleared or replaced
function clearEditorAndPreview() {
  backgroundDefaceIfActive();
  ui.editorEl.value = '';
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = '';
  }
  var doc = ui.previewEl.contentDocument || ui.previewEl.contentdocument;
  doc.open();
  doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:system-ui;padding:1rem;color:#666;">No media to preview.</body></html>');
  doc.close();
}

// Stub: Background the Deface stream if it is active in the preview pane
function backgroundDefaceIfActive() {
  // TODO: Implement logic to detect if Deface is running in the preview pane
  // and background it, showing a status indicator elsewhere in the UI.
  // For now, this is a placeholder for the central trigger.
}


// File/Folder Flags
function markFlag(itemKey, color) {
  debugLog('[markFlag] itemKey:', itemKey, 'color:', color, 'state.folder:', state.folder);
  if (color) {
    state.flags[itemKey] = color;
  } else {
    delete state.flags[itemKey];
  }
  saveFlags();
  refreshCurrentDirectory();
}

function saveFlags() {
  // Save the full folder state (including flags, reviewedKeys, stats, primer, etc.)
  var folderPath = state.folder || '';
  var snapshot = snapshotFolderStateFromDom();
  debugLog('[saveFlags] folderPath:', folderPath, 'snapshot:', snapshot);
  writeFolderStateFile(folderPath, snapshot);
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

// Save caption text for the current media item (fully global, fail-loudly)
function savePathCaption() {
  var mediaItem = state.currentItem;
  // Guard: only save if currentItem matches the visible editor context
  if (!mediaItem || !mediaItem.fileName || ui.editorEl.getAttribute('readonly')) {
    throw new Error('savePathCaption: invalid or stale mediaItem');
  }
  return new Promise(function (resolve, reject) {
    HttpModule.postJson('/caption/save', {
      folder: state.folder,
      media: mediaItem.fileName,
      text: ui.editorEl.value || ''
    }, function(status, responseText) {
      if (status === 200) {
        setStatus('Saved: ' + mediaItem.fileName.replace(/\.[^.]+$/, '.txt'));
        // Toggle empty-caption class on the relevant media item
        if (ui && ui.mediaListEl && mediaItem && mediaItem.key) {
          var itemEl = ui.mediaListEl.querySelector('[data-type="media"][data-key="' + mediaItem.key + '"]');
          if (itemEl) {
            if (ui.editorEl.value && ui.editorEl.value.trim().length > 0) {
              itemEl.classList.remove('empty-caption');
            } else {
              itemEl.classList.add('empty-caption');
            }
          }
        }
        resolve();
        return;
      }
      reject(new Error(getErrorMessage(responseText, 'Could not save caption')));
    });
  });
}