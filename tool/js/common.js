// Global common helpers for webcap

// Set this to true to enable debug logging
window.DEBUG = true;

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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

window.setStatus = setStatus;
window.normalizeFolderInput = normalizeFolderInput;
window.parentPath = parentPath;
window.getFileExtension = getFileExtension;
window.getErrorMessage = getErrorMessage;
window.escapeHtml = escapeHtml;
window.renderPreviewHtml = renderPreviewHtml;
window.renderTextPreview = renderTextPreview;
