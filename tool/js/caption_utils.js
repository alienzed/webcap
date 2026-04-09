var CaptionUtils = (function() {
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
    var tag = isImage
      ? '<img src="' + src + '" alt="preview" style="max-width:100%;max-height:100%;object-fit:contain;">'
      : '<video controls style="max-width:100%;max-height:100%;"><source src="' + src + '"></video>';

    var doc = ui.previewEl.contentDocument || ui.previewEl.contentWindow.document;
    doc.open();
    doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;display:flex;align-items:center;justify-content:center;background:#111;height:100vh;">' + tag + '</body></html>');
    doc.close();
  }

  return {
    normalizeFolderInput: normalizeFolderInput,
    parentPath: parentPath,
    getFileExtension: getFileExtension,
    getErrorMessage: getErrorMessage,
    escapeHtml: escapeHtml,
    renderPreviewHtml: renderPreviewHtml
  };
})();
