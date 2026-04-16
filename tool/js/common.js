// Global common helpers for webcap

// Set this to true to enable debug logging
window.DEBUG = false;

/**
 * Logs messages to the console if debugging is enabled.
 * @arguments The messages to log. Can be one or more arguments similar to console.log.
 *  
 */
function debugLog() {
  if (!window.DEBUG) return;
  if (arguments.length === 1) {
    console.log(arguments[0]);
  } else {
    console.log.apply(console, arguments);
  }
}

function setStatus(ui, text) {
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
    return fallback;
  }
}

function renderPreviewHtml(ui, isImage, src) {
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

  var doc = ui.previewEl.contentDocument || ui.previewEl.contentWindow.document;
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

function renderTextPreview(ui, title, text) {
  var doc = ui.previewEl.contentDocument || ui.previewEl.contentWindow.document;
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


window.setStatus = setStatus;
window.normalizeFolderInput = normalizeFolderInput;
window.parentPath = parentPath;
window.getFileExtension = getFileExtension;
window.getErrorMessage = getErrorMessage;
window.escapeHtml = escapeHtml;
window.renderPreviewHtml = renderPreviewHtml;
window.renderTextPreview = renderTextPreview;


var DebounceModule = (function() {
  function create(waitMs) {
    var timer = null;
    return function(callback) {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(callback, waitMs);
    };
  }

  return {
    create: create
  };
})();

var EditorModule = (function() {
  var editor = null;
  var preview = null;
  var scheduleSave = null;
  var onDebouncedSave = null;

  function init(config) {
    editor = config.editor;
    preview = config.preview;
    onDebouncedSave = config.onDebouncedSave;
    scheduleSave = DebounceModule.create(800);

    editor.addEventListener('input', function() {
      renderPreview(editor.value);
      scheduleSave(function() {
        if (onDebouncedSave) {
          onDebouncedSave();
        }
      });
    });
  }

  function renderPreview(html) {
    var doc = preview.contentDocument || preview.contentWindow.document;
    var fullHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
      '<link rel="stylesheet" href="/static/css/bootstrap.min.css"></head><body>' +
      html + '</body></html>';
    doc.open();
    doc.write(fullHtml);
    doc.close();
  }

  function setContent(html) {
    editor.value = html;
    renderPreview(html);
  }

  function getContent() {
    return editor.value;
  }

  function appendHtml(html) {
    var current = editor.value;
    if (current && current.slice(-1) !== '\n') {
      current += '\n';
    }
    editor.value = current + html + '\n';
    renderPreview(editor.value);
    scheduleSave(function() {
      if (onDebouncedSave) {
        onDebouncedSave();
      }
    });
  }

  return {
    init: init,
    setContent: setContent,
    getContent: getContent,
    appendHtml: appendHtml,
    renderPreview: renderPreview
  };
})();

var HttpModule = (function() {
  function get(url, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onload = function() {
      callback(xhr.status, xhr.responseText);
    };
    xhr.send();
  }

  function postJson(url, data, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function() {
      callback(xhr.status, xhr.responseText);
    };
    xhr.send(JSON.stringify(data));
  }

  function postFormData(url, formData, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.onload = function() {
      callback(xhr.status, xhr.responseText);
    };
    xhr.send(formData);
  }

  return {
    get: get,
    postJson: postJson,
    postFormData: postFormData
  };
})();

var DirHandleStoreModule = (function() {
  var DB_NAME = 'mediaweb-local';
  var STORE_NAME = 'kv';
  var KEY_LAST_DIR = 'last-caption-dir';

  function openDb() {
    return new Promise(function(resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB not available'));
        return;
      }

      var req = window.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function() {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = function() {
        resolve(req.result);
      };
      req.onerror = function() {
        reject(req.error || new Error('Failed to open IndexedDB'));
      };
    });
  }

  function saveLastDir(handle, dirNames) {
    if (!handle) {
      return Promise.resolve();
    }

    return openDb().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        var data = {
          handle: handle,
          dirNames: Array.isArray(dirNames) ? dirNames.slice(0, 64) : []
        };
        store.put(data, KEY_LAST_DIR);
        tx.oncomplete = function() {
          db.close();
          resolve();
        };
        tx.onerror = function() {
          db.close();
          reject(tx.error || new Error('Failed to save directory handle'));
        };
      });
    }).catch(function() {
      return Promise.resolve();
    });
  }

  function loadLastDir() {
    return openDb().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var store = tx.objectStore(STORE_NAME);
        var req = store.get(KEY_LAST_DIR);
        req.onsuccess = function() {
          db.close();
          resolve(req.result || null);
        };
        req.onerror = function() {
          db.close();
          reject(req.error || new Error('Failed to load directory handle'));
        };
      });
    }).catch(function() {
      return null;
    });
  }

  return {
    saveLastDir: saveLastDir,
    loadLastDir: loadLastDir
  };
})();