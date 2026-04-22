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

// Utility: Stream fetch output to preview pane
function streamPreviewFromFetch(url, body, ui, onDone, onError) {
  clearPreview(ui.previewEl);
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function(response) {
    if (!response.body || typeof ReadableStream === 'undefined') {
      response.text().then(function (text) {
        writePreview(ui.previewEl, text.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
        if (onDone) onDone();
      });
      return;
    }
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var output = '';
    function readChunk() {
      reader.read().then(function (result) {
        if (result.done) {
          writePreview(ui.previewEl, output.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
          if (onDone) onDone();
          return;
        }
        output += decoder.decode(result.value, { stream: true });
        writePreview(ui.previewEl, output.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
        scrollPreviewToBottom(ui.previewEl);
        readChunk();
      });
    }
    readChunk();
  }).catch(function (err) {
    setStatus('Streaming failed: ' + err);
    if (onError) onError(err);
  });
}
