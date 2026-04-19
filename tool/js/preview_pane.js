// preview_pane.js
// Centralized preview pane helpers for iframe-based output

function clearPreview(previewEl) {
  if (previewEl && previewEl.contentDocument) {
    var doc = previewEl.contentDocument;
    doc.open();
    doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:monospace;font-size:13px;background:#222;color:#eee;padding:8px;white-space:pre-wrap;"></body></html>');
    doc.close();
  }
}

function writePreview(previewEl, html) {
  if (previewEl && previewEl.contentDocument) {
    var doc = previewEl.contentDocument;
    doc.open();
    doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:monospace;font-size:13px;background:#222;color:#eee;padding:8px;white-space:pre-wrap;">');
    doc.write(html);
    doc.write('</body></html>');
    doc.close();
  }
}

function appendPreview(previewEl, html) {
  if (previewEl && previewEl.contentDocument) {
    var doc = previewEl.contentDocument;
    var body = doc.body;
    if (body) {
      body.innerHTML += html;
    }
  }
}

function scrollPreviewToBottom(previewEl) {
  if (previewEl && previewEl.contentDocument && previewEl.contentWindow) {
    var body = previewEl.contentDocument.body;
    if (body) body.scrollTop = body.scrollHeight;
  }
}

// Export for use in other modules
window.PreviewPane = {
  clearPreview: clearPreview,
  writePreview: writePreview,
  appendPreview: appendPreview,
  scrollPreviewToBottom: scrollPreviewToBottom
};
