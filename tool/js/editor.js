var EditorModule = (function() {
  var editor = null;
  var preview = null;
  var saveTimer = null;
  var onDebouncedSave = null;

  function init(config) {
    editor = config.editor;
    preview = config.preview;
    onDebouncedSave = config.onDebouncedSave;

    editor.addEventListener('input', function() {
      renderPreview(editor.value);
      if (saveTimer) {
        clearTimeout(saveTimer);
      }
      saveTimer = setTimeout(function() {
        if (onDebouncedSave) {
          onDebouncedSave();
        }
      }, 800);
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
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(function() {
      if (onDebouncedSave) {
        onDebouncedSave();
      }
    }, 800);
  }

  return {
    init: init,
    setContent: setContent,
    getContent: getContent,
    appendHtml: appendHtml,
    renderPreview: renderPreview
  };
})();
