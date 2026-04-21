

// Define global state object (state)
// NOTE: This project intentionally uses plain global variables for all state and functions.
// If a name collision occurs, it should throw an error and be fixed explicitly.
// No IIFE, encapsulation, or modular patterns are used by design.
state = {
  folder: '',
  suppressInput: false,
  items: [],
  childFolders: [],
  currentItem: null,
  objectUrl: '',
  mode: 'path',
  dirStack: [],
  captionCache: {},
  listRenderSeq: 0,
  reviewedSet: new Set(),
  focusSet: null,
  flags: {} // key: file or folder name, value: color string (red/yellow/orange/green)
};

function markFlag(itemKey, color) {
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
  writeFolderStateFile(folderPath, snapshot);
}

// Define global UI object
ui = {
  editorEl: document.getElementById('editor'),
  previewEl: document.getElementById('preview'),
  mediaListEl: document.getElementById('media-list'),
  filterEl: document.getElementById('media-filter'),
  captionFilterCount: document.getElementById('caption-filter-count'),
  statusEl: document.getElementById('status'),
  refreshBtn: document.getElementById('refresh-btn'),
  reviewBtn: document.getElementById('review-captions-btn')
};

// Debounced auto-save for stats/primer changes
var debouncedSaveFolderState = debounceCreate(600);

// Set this to true to enable debug logging
var DEBUG = false;
var FOLDER_STATE_VERSION = 1;
var FOLDER_STATE_FILE = '.webcap_state.json';
var IMAGE_EXTENSIONS = { '.jpg': true, '.jpeg': true, '.png': true, '.gif': true, '.webp': true, '.bmp': true };
var MEDIA_EXTENSIONS = {
  '.mp4': true, '.webm': true, '.ogg': true, '.mov': true, '.mkv': true, '.avi': true, '.m4v': true,
  '.jpg': true, '.jpeg': true, '.png': true, '.gif': true, '.webp': true, '.bmp': true
};

// Global variable for the root folder label (set from config)
var ROOT_FOLDER_LABEL = '/';

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

function parentPath(pathText) {
  var p = String(pathText || '').trim();
  if (!p) {
    return '';
  }
  p = p.replace(/[\\\/]+$/, '');
  var idx1 = p.lastIndexOf('/');
  var idx2 = p.lastIndexOf('\\');
  var idx = Math.max(idx1, idx2);
  if (idx <= 0) {
    return p;
  }
  return p.slice(0, idx);
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

function renderPreviewHtml(isImage, src) {
  var tag = '';
  if (isImage) {
    tag = '<img src="' + src + '" alt="preview" style="max-width:100%;max-height:100%;object-fit:contain;">';
  } else {
    tag = '' +
      '<div id="video-wrap" style="max-width:100%;max-height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;">' +
      '  <video id="media-video" controls autoplay loop muted playsinline preload="metadata" style="max-width:100%;max-height:100%;">' +
      '    <source src="' + src + '">' +
      '  </video>' +
      '  <div id="video-error" style="display:none;color:#ddd;font:13px system-ui;text-align:center;max-width:420px;">' +
      '    Video failed to load in browser preview. The codec may be unsupported.' +
      '  </div>' +
      '</div>';
  }

  var doc = ui.previewEl.contentDocument || ui.previewEl.contentdocument;
  doc.open();
  doc.write(
    '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;display:flex;align-items:center;justify-content:center;background:#111;height:100vh;">' +
    tag +
    '<script>\n' +
    'var video=document.getElementById("media-video");\n' +
    'if(video){\n' +
    '  var error=document.getElementById("video-error");\n' +
    '  video.addEventListener("error",function(){ if(error){ error.style.display="block"; } });\n' +
    '  var source=video.querySelector("source");\n' +
    '  if(source){ source.addEventListener("error",function(){ if(error){ error.style.display="block"; } }); }\n' +
    '  var p=video.play(); if(p && p.catch){ p.catch(function(){}); }\n' +
    '}\n' +
    '<\/script></body></html>'
  );
  doc.close();
}

function renderTextPreview(title, text) {
  var doc = ui.previewEl.contentDocument || ui.previewEl.contentdocument;
  var safeTitle = escapeHtml(title || 'Output');
  var safeText = escapeHtml(text || '');
  doc.open();
  doc.write(
    '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;background:#111;color:#e6e6e6;font:13px Consolas,monospace;display:flex;flex-direction:column;height:100vh;">' +
    '<div style="padding:10px 12px;border-bottom:1px solid #333;font:600 12px system-ui,sans-serif;letter-spacing:.2px;">' + safeTitle + '</div>' +
    '<pre style="margin:0;padding:12px;white-space:pre-wrap;word-break:break-word;overflow:auto;flex:1;">' + safeText + '</pre>' +
    '</body></html>'
  );
  doc.close();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
    flags: (typeof src.flags === 'object' && src.flags) ? src.flags : {}
  };
}

function emptyFolderState() {
  return sanitizeFolderState({
    stats: {
      requiredPhrase: '',
      phrases: '',
      tokenRules: ''
    },
    primer: {
      template: '',
      defaults: '',
      mappings: ''
    },
    reviewedKeys: []
  });
}

function buildAutoPrimer(fileName) {
  var primerOptions = statsGetPrimerOptionsFromDom();
  if (!primerOptions || !primerOptions.template.trim()) {
    return '';
  }
  return buildPrimerFromConfig(fileName, primerOptions);
}

async function readFolderStateFile(folderPath) {
  // folderPath: relative path from FS root ('' for root)
  try {
    const resp = await fetch('/fs/folder_state/load?folder=' + encodeURIComponent(folderPath), { method: 'GET' });
    if (!resp.ok) throw new Error('Failed to load folder state');
    const data = await resp.json();
    return sanitizeFolderState(data || {});
  } catch (err) {
    console.warn('Could not read folder state file:', err);
    return null;
  }
}

async function writeFolderStateFile(folderPath, folderState) {
  // folderPath: relative path from FS root ('' for root)
  try {
    const resp = await fetch('/fs/folder_state/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: folderPath, state: folderState })
    });
    if (!resp.ok) throw new Error('Failed to save folder state');
    return true;
  } catch (err) {
    console.warn('Could not write folder state file:', err);
    return false;
  }
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

function httpGet(url, callback) {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.onload = function () {
    callback(xhr.status, xhr.responseText);
  };
  xhr.send();
}
function httpPostJson(url, data, callback) {
  var xhr = new XMLHttpRequest();
  xhr.open('POST', url, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.onload = function () {
    callback(xhr.status, xhr.responseText);
  };
  xhr.send(JSON.stringify(data));
}
function httpPostFormData(url, formData, callback) {
  var xhr = new XMLHttpRequest();
  xhr.open('POST', url, true);
  xhr.onload = function () {
    callback(xhr.status, xhr.responseText);
  };
  xhr.send(formData);
}
HttpModule = {
  get: httpGet,
  postJson: httpPostJson,
  postFormData: httpPostFormData
};

// --- Shared functions moved from caption_mode.js ---
function clearEditorAndPreview() {
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

function snapshotFolderStateFromDom() {
  // IMPORTANT: If you add new fields to the folder state, you MUST include them here
  // so they are persisted. This function must snapshot ALL fields that should be saved.
  var stats = getOptionsFromDom();
  var primer = statsGetPrimerOptionsFromDom();
  return sanitizeFolderState({
    stats: stats,
    primer: primer,
    reviewedKeys: Array.from(state.reviewedSet || []).sort(),
    flags: (typeof state.flags === 'object' && state.flags) ? state.flags : {}
    // Add new fields here as needed
  });
}

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

async function saveFolderStateForCurrentRoot() {
  if (!state.folder) {
    return;
  }
  var folderPath = state.folder;
  var snapshot = snapshotFolderStateFromDom();
  await writeFolderStateFile(folderPath, snapshot);
}

async function resetFolderState() {
  if (!state.folder) {
    setStatus('No folder loaded');
    return;
  }
  var confirmed = confirm('Reset saved folder settings?\n\nThis deletes .webcap_state.json in the current folder.');
  if (!confirmed) {
    return;
  }
  var folderPath = state.folder;
  // Save empty state to backend (overwrites file)
  await writeFolderStateFile(folderPath, emptyFolderState());
  applyFolderStateToDom(emptyFolderState());
  state.reviewedSet = new Set();
  renderFileList(ui.filterEl.value);
  setStatus('Folder settings reset (.webcap_state.json overwritten)');
}

// Global adapters for legacy UI context menu and renderFileList.js
pruneMedia = async function( mediaItem) {
  // Confirm before pruning
  if (!state.folder || !mediaItem || !mediaItem.key) {
    setStatus('No folder or media selected for prune');
    return;
  }
  var confirmed = confirm('Permanently remove this media file?\n\n' + mediaItem.key + '\n\nThis cannot be undone.');
  if (!confirmed) {
    setStatus('Prune cancelled');
    return;
  }
  setStatus('Pruning media: ' + mediaItem.key + ' ...');
  try {
    const resp = await fetch('/fs/prune', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: state.folder, media: mediaItem.key })
    });
    if (!resp.ok) {
      const msg = await resp.text();
      setStatus('Prune failed: ' + getErrorMessage(msg, resp.statusText));
      return;
    }
    setStatus('Media pruned: ' + mediaItem.key);
    // Refresh file list
    refreshCurrentDirectory();
  } catch (err) {
    setStatus('Prune error: ' + (err && err.message ? err.message : err));
  }
};
restoreMedia = function( mediaItem) {
  // Adapter for context menu and renderFileList.js
  return restoreMediaItem( mediaItem);
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
