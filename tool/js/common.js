// NOTE: This project intentionally uses plain global variables for all state and functions.
// No IIFE, encapsulation, or modular patterns are used by design.
var APP_CONFIG = {};

function setRuntimeAppConfig(cfg) {
  var next = (cfg && typeof cfg === 'object') ? JSON.parse(JSON.stringify(cfg)) : {};
  APP_CONFIG = next;
  window.APP_CONFIG = next;
  DEBUG = !!(next && next.debug);
}

// Load config.json synchronously and set ROOT_FOLDER_LABEL
try {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/static/config.json', false); // sync
  xhr.send(null);
  if (xhr.status === 200) {
    var config = JSON.parse(xhr.responseText);
    setRuntimeAppConfig(config);
    if (config && config.filesystem && config.filesystem.root) {
      var rootPath = config.filesystem.root;
      ROOT_FOLDER_PATH = String(rootPath || '');
      // Use last segment of root path as label
      ROOT_FOLDER_LABEL = String(rootPath).replace(/[\\/]+$/, '').split(/[\\/]/).pop();
    }
  }
} catch (e) {
  setRuntimeAppConfig({});
  console.warn('Failed to load config.json for ROOT_FOLDER_LABEL:', e);
}

window.setRuntimeAppConfig = setRuntimeAppConfig;

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

function recordUndoOperation(op) {
  if (!state || state.undoSuppress || !op || !op.type) return;
  state.undoStack = [op];
}

function restoreUndoMediaSelection(mediaKey, statusText) {
  if (!mediaKey || typeof selectPathMedia !== 'function' || !state || !Array.isArray(state.items)) {
    return false;
  }
  var target = null;
  for (var i = 0; i < state.items.length; i += 1) {
    var item = state.items[i];
    if (item && item.key === mediaKey) {
      target = item;
      break;
    }
  }
  if (!target) return false;
  setTimeout(function () {
    selectPathMedia(target).then(function () {
      if (statusText) setStatus(statusText);
    }).catch(function (err) {
      setStatus(String(err && err.message ? err.message : err));
    });
  }, 0);
  return true;
}

function undoLastOperation() {
  if (!state || !Array.isArray(state.undoStack) || !state.undoStack.length) {
    setStatus('Nothing to undo.');
    return false;
  }
  var op = state.undoStack.pop();
  state.undoSuppress = true;
  try {
    if (op.type === 'rating') {
      setRatingForMediaKey(op.mediaKey, op.previousRating);
      var ratingStatus = op.previousRating > 0 ? 'Undid rating: ' + op.previousRating + ' stars' : 'Undid rating: cleared';
      if (!restoreUndoMediaSelection(op.mediaKey, ratingStatus)) {
        setStatus(ratingStatus);
      }
      return true;
    }
    if (op.type === 'flag') {
      markFlag(op.itemKey, op.previousFlag || '');
      var flagStatus = op.previousFlag ? 'Undid flag: ' + op.previousFlag : 'Undid flag: cleared';
      if (!restoreUndoMediaSelection(op.itemKey, flagStatus)) {
        setStatus(flagStatus);
      }
      return true;
    }
    if (op.type === 'checklist-checked') {
      setChecklistRequirementCheckedForMediaKey(op.mediaKey, op.requirementLabel, !!op.previousValue);
      var checkedStatus = op.previousValue ? 'Undid group reviewed mark.' : 'Undid group reviewed clear.';
      if (!restoreUndoMediaSelection(op.mediaKey, checkedStatus)) {
        setStatus(checkedStatus);
      }
      return true;
    }
    if (op.type === 'checklist-na') {
      setChecklistRequirementNaForMediaKey(op.mediaKey, op.requirementLabel, !!op.previousValue);
      if (!op.previousValue && op.previousCheckedValue) {
        setChecklistRequirementCheckedForMediaKey(op.mediaKey, op.requirementLabel, true);
      }
      var naStatus = op.previousValue ? 'Undid group n/a clear.' : 'Undid group n/a mark.';
      if (!restoreUndoMediaSelection(op.mediaKey, naStatus)) {
        setStatus(naStatus);
      }
      return true;
    }
    if (op.type === 'tag') {
      if (op.previousValue) {
        addTagToMediaKey(op.mediaKey, op.tagText);
      } else if (!op.previousValue) {
        removeTagFromMediaKey(op.mediaKey, op.tagText);
      } else {
        setStatus('Nothing to undo.');
        return false;
      }
      var tagStatus = op.previousValue ? 'Undid tag removal: ' + op.tagText : 'Undid tag add: ' + op.tagText;
      if (!restoreUndoMediaSelection(op.mediaKey, tagStatus)) {
        setStatus(tagStatus);
      }
      return true;
    }
  } finally {
    state.undoSuppress = false;
  }
  setStatus('Nothing to undo.');
  return false;
}

function isBlacklistedSetSubfolderName(name) {
  var n = String(name || '').toLowerCase();
  return n === 'originals' || n === 'auto_dataset' || n === 'src_videos';
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

function mapAspectRatioToBucket(aspect) {
  if (!aspect) return 'Unknown';
  var norm = String(aspect).replace(/\s/g, '').toLowerCase();
  if (norm === '1:1' || norm === 'square') return 'square';
  if (norm === '4:3') return '4:3';
  if (norm === '3:4') return '3:4';
  if (norm === '16:9') return '16:9';
  if (norm === '9:16') return '9:16';

  var val = 0;
  if (/^[0-9.]+$/.test(norm)) {
    val = parseFloat(norm);
  } else {
    var match = norm.match(/^([0-9]*\.?[0-9]+):([0-9]*\.?[0-9]+)$/);
    if (match) {
      var left = parseFloat(match[1]);
      var right = parseFloat(match[2]);
      if (right > 0) val = left / right;
    }
  }
  if (!isFinite(val) || val <= 0) return 'Unknown';

  if (Math.abs(val - 1.0) < 0.05) return 'square';
  if (Math.abs(val - (4 / 3)) < 0.05) return '4:3';
  if (Math.abs(val - (3 / 4)) < 0.05) return '3:4';
  if (Math.abs(val - (16 / 9)) < 0.05) return '16:9';
  if (Math.abs(val - (9 / 16)) < 0.05) return '9:16';
  return 'Unknown';
}

function hasSupportedAspectBucket(aspect) {
  return mapAspectRatioToBucket(aspect) !== 'Unknown';
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

function buildAutoPrimer(fileName, mediaKey) {
  var primerOptions = statsGetPrimerOptionsFromDom();
  if (!primerOptions || !primerOptions.template.trim()) {
    return '';
  }
  return buildPrimerFromConfig(fileName, mediaKey, primerOptions);
}

function refreshPrimerPreviewForCurrentItem() {
  if (!state || !state.currentItem || !state.currentItem.fileName || !state.currentItem.key || !ui || !ui.editorEl || ui.editorEl.readOnly) {
    return false;
  }
  if (state.currentItem.hasCaption) {
    return false;
  }
  var nextPrimer = String(buildAutoPrimer(state.currentItem.fileName, state.currentItem.key) || '');
  var currentEditorText = String(ui.editorEl.value || '');
  if (currentEditorText === nextPrimer) {
    return false;
  }
  applyEditorTextAndTriggerInput(nextPrimer);
  return true;
}

function refreshCurrentPrimerDerivedUi() {
  refreshPrimerPreviewForCurrentItem();
  updatePrimerCaptionResetUi();
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

var APP_THEME_STORAGE_KEY = 'webcap.theme';

function getStoredAppTheme() {
  try {
    var theme = localStorage.getItem(APP_THEME_STORAGE_KEY);
    if (theme === 'dark' || theme === 'light') return theme;
  } catch (e) {}
  return '';
}

function getSystemPreferredAppTheme() {
  try {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch (e) {}
  return 'light';
}

function getInitialAppTheme() {
  return getStoredAppTheme() || getSystemPreferredAppTheme();
}

function getCurrentAppTheme() {
  var theme = '';
  if (document && document.documentElement) {
    theme = document.documentElement.getAttribute('data-theme') || '';
  }
  theme = theme || getInitialAppTheme();
  return String(theme || '').toLowerCase() === 'dark' ? 'dark' : 'light';
}

function updateThemeToggleUi(theme) {
  if (!ui || !ui.utilityThemeBtn) return;
  var currentTheme = String(theme || '').toLowerCase() === 'dark' ? 'dark' : 'light';
  var nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
  ui.utilityThemeBtn.textContent = nextTheme === 'dark' ? 'Dark' : 'Light';
  ui.utilityThemeBtn.title = 'Switch to ' + nextTheme + ' theme';
  ui.utilityThemeBtn.setAttribute('aria-pressed', currentTheme === 'dark' ? 'true' : 'false');
  ui.utilityThemeBtn.setAttribute('aria-label', 'Switch to ' + nextTheme + ' theme');
}

function applyAppTheme(theme, persist) {
  var nextTheme = String(theme || '').toLowerCase() === 'dark' ? 'dark' : 'light';
  if (document && document.documentElement) {
    document.documentElement.setAttribute('data-theme', nextTheme);
    document.documentElement.style.colorScheme = nextTheme;
  }
  if (persist) {
    try {
      localStorage.setItem(APP_THEME_STORAGE_KEY, nextTheme);
    } catch (e) {}
  }
  updateThemeToggleUi(nextTheme);
  return nextTheme;
}

function toggleAppTheme() {
  var currentTheme = (document && document.documentElement && document.documentElement.getAttribute('data-theme')) || getInitialAppTheme();
  var nextTheme = String(currentTheme || '').toLowerCase() === 'dark' ? 'light' : 'dark';
  return applyAppTheme(nextTheme, true);
}

function wireThemeToggleUi() {
  if (ui && ui.utilityThemeBtn && !ui.utilityThemeBtn.__themeWired) {
    ui.utilityThemeBtn.__themeWired = true;
    ui.utilityThemeBtn.onclick = function () {
      toggleAppTheme();
    };
  }
  applyAppTheme(getInitialAppTheme(), false);
}

window.applyAppTheme = applyAppTheme;
window.toggleAppTheme = toggleAppTheme;
window.wireThemeToggleUi = wireThemeToggleUi;
window.getCurrentAppTheme = getCurrentAppTheme;
window.refreshCurrentPrimerDerivedUi = refreshCurrentPrimerDerivedUi;

wireThemeToggleUi();


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
        updatePrimerCaptionResetUi();
        if (typeof renderFileList === 'function') {
          renderFileList();
        }
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
    primer = buildAutoPrimer(mediaItem.fileName, mediaItem.key);
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
  if (state.currentItem && state.currentItem.fileName) {
    try {
      return Promise.resolve(savePathCaption());
    } catch (err) {
      return Promise.reject(err);
    }
  }
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
