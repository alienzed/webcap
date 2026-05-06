// Render config panel into the report iframe
function renderConfigPanel(doc) {
  var panel = doc.getElementById('config-panel');
  if (!panel) return;
  var configListEl = doc.getElementById('config-list');
  // Removed inline config editor logic

  function getCurrentFolder() {
    // Defensive: parent.state.folder is the canonical folder
    if (parent && parent.state && typeof parent.state.folder === 'string') {
      return parent.state.folder;
    }
    return '';
  }

  function listConfigFiles() {
    configListEl.textContent = 'Loading...';
    var folder = encodeURIComponent(getCurrentFolder());
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/fs/list_config?folder=' + folder);
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        try {
          var resp = JSON.parse(xhr.responseText);
          var files = resp.files || [];
          renderConfigList(files);
        } catch (e) {
          configListEl.textContent = 'Failed to parse config list.';
        }
      } else {
        configListEl.textContent = 'Failed to load config list (' + xhr.status + ')';
      }
    };
    xhr.send();
  }

  function renderConfigList(files) {
    if (!Array.isArray(files) || !files.length) {
      configListEl.textContent = 'No config files found.';
      return;
    }
    var html = '<ul style="padding-left:0;list-style:none;">' + files.map(function(f) {
      return '<li><a href="#" class="config-file-link" data-file="' + encodeURIComponent(f) + '">' + f + '</a></li>';
    }).join('') + '</ul>';
    configListEl.innerHTML = html;
    Array.prototype.forEach.call(configListEl.querySelectorAll('.config-file-link'), function(link) {
      link.onclick = function(e) {
        e.preventDefault();
        selectConfigFile(decodeURIComponent(link.getAttribute('data-file')));
      };
    });
  }

  function selectConfigFile(filename) {
    // Notify parent to load config file into main editor
    if (parent && parent.postMessage) {
      parent.postMessage({ type: 'config-file-select', fileName: filename }, '*');
    }
    // Unset any caption/media selection (strict separation)
    if (parent && parent.clearSelection) parent.clearSelection();
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function(s) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'})[s];
    });
  }

  // Initial load
  listConfigFiles();
}
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
  ui.consolePanelEl.style.display = 'block';
  var btn = document.getElementById('console-toggle-btn');
  if (btn) btn.innerHTML = '\u25BC';
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function(response) {
    if (!response.body || typeof ReadableStream === 'undefined') {
      response.text().then(function (text) {
        appendToConsolePanel(text.replace(/</g, '<').replace(/>/g, '>'));
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
          // Final output
          if (output) {
            appendToConsolePanel(output.replace(/</g, '<').replace(/>/g, '>'));
          }
          if (onDone) onDone();
          return;
        }
        var chunk = decoder.decode(result.value, { stream: true });
        output += chunk;
        appendToConsolePanel(chunk.replace(/</g, '<').replace(/>/g, '>'));
        // Auto-scroll
        if (ui.consolePanelEl) ui.consolePanelEl.scrollTop = ui.consolePanelEl.scrollHeight;
        readChunk();
      });
    }
    readChunk();
  }).catch(function (err) {
    setStatus('Streaming failed: ' + err);
    if (onError) onError(err);
  });
}


// Render media metadata panel into the report iframe
function renderMediaMetadataPanel(folder, doc) {
  var panel = doc.getElementById('media-metadata-panel');
  if (!panel) return;
  panel.textContent = 'Loading...';
  var url = '/fs/media_metadata?folder=' + encodeURIComponent(folder);
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url);
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) return;
    if (xhr.status === 200) {
      try {
        var data = JSON.parse(xhr.responseText);
        if (!Array.isArray(data)) throw new Error('Malformed metadata');
        var cols = ['file','resolution','fps','aspect','size','bitrate','codec','color','duration','frames'];
        var colLabels = {file:'File',resolution:'Resolution',fps:'FPS',aspect:'Aspect',size:'Size',bitrate:'Bitrate',codec:'Codec',color:'Color',duration:'Duration',frames:'Frames'};
        var html = '<table class="metadata-table"><thead><tr>' + cols.map(function(c){return '<th>' + escapeHtml(colLabels[c]) + '</th>';}).join('') + '</tr></thead><tbody>';
        data.forEach(function(row){
          html += '<tr>' + cols.map(function(c){
            var val = row[c] !== undefined ? String(row[c]) : '-';
            return '<td>' + escapeHtml(val) + '</td>';
          }).join('') + '</tr>';
        });
        html += '</tbody></table>';
        panel.innerHTML = html;
      } catch(e) {
        panel.textContent = 'Failed to parse media metadata: ' + (e && e.message ? e.message : e);
      }
    } else {
      panel.textContent = 'Failed to load media metadata (' + xhr.status + ')';
    }
  };
  xhr.send();
}

function renderReportPreview(report) {
  function encodeFocus(files) {
    var names = (files || []).map(function (name) { return String(name || ''); }).filter(Boolean);
    return encodeURIComponent(names.join('\n'));
  }

  var requiredLabel = report.requiredPhrase ? report.requiredPhrase : '(not set)';
  var phraseRows = report.phraseSummary.length ? report.phraseSummary.map(function (row) {
    return '<tr><td>' + escapeHtml(row.phrase) + '</td><td>' + row.count + '</td><td>' + row.percent + '%</td></tr>';
  }).join('') : '<tr><td colspan="3" style="color:#777;">No phrases configured.</td></tr>';

  var validationFocus = (report.ruleFailures || []).map(function (row) { return row.fileName; });
  var requiredFocus = (report.requiredMissing || []).map(function (row) { return row.fileName; });
  var shortestFocus = (report.shortestCaptions || []).map(function (row) { return row.fileName; });
  var longestFocus = (report.longestCaptions || []).map(function (row) { return row.fileName; });
  var shortOutlierFocus = (report.shortOutliers || []).map(function (row) { return row.fileName; });
  var longOutlierFocus = (report.longOutliers || []).map(function (row) { return row.fileName; });

  var failRows = report.ruleFailures.length ? report.ruleFailures.slice(0, 40).map(function (row) {
    return '<li><button class="fail-link" data-file="' + encodeURIComponent(row.fileName) + '" data-focus="' +
      encodeFocus(validationFocus) + '" data-source="' + encodeURIComponent('Validation Failures') + '">' +
      '<strong>' + escapeHtml(row.fileName) + '</strong></button> - ' + escapeHtml(row.reason) + '</li>';
  }).join('') : '<li style="color:#777;">No validation failures.</li>';

  var requiredRows = '';
  if (!report.requiredPhrase) {
    requiredRows = '<li style="color:#777;">Required key phrase is not set.</li>';
  } else if (!report.requiredMissing || !report.requiredMissing.length) {
    requiredRows = '<li style="color:#777;">All captions include required phrase.</li>';
  } else {
    requiredRows = report.requiredMissing.slice(0, 40).map(function (row) {
      return '<li><button class="fail-link" data-file="' + encodeURIComponent(row.fileName) + '" data-focus="' +
        encodeFocus(requiredFocus) + '" data-source="' + encodeURIComponent('Missing Required Phrase') + '">' +
        '<strong>' + escapeHtml(row.fileName) + '</strong></button> - ' + escapeHtml(row.reason) + '</li>';
    }).join('');
  }

  var topRows = report.topTokens.length ? report.topTokens.slice(0, 25).map(function (row) {
    return '<li><button class="token-link" data-token="' + encodeURIComponent(row.token) + '">' + escapeHtml(row.token) +
      '</button>: <strong>' + row.count + '</strong></li>';
  }).join('') : '<li style="color:#777;">No tokens found.</li>';

  var rareRows = report.rareTokens.length ? report.rareTokens.slice(0, 25).map(function (row) {
    return '<li><button class="token-link" data-token="' + encodeURIComponent(row.token) + '">' + escapeHtml(row.token) +
      '</button>: <strong>' + row.count + '</strong></li>';
  }).join('') : '<li style="color:#777;">No rare tokens found.</li>';

  var shortestRows = report.shortestCaptions && report.shortestCaptions.length ? report.shortestCaptions.map(function (row) {
    return '<li><button class="fail-link" data-file="' + encodeURIComponent(row.fileName) + '" data-focus="' +
      encodeFocus(shortestFocus) + '" data-source="' + encodeURIComponent('Shortest Captions') + '">' +
      escapeHtml(row.fileName) + '</button> - ' + row.tokenCount + ' tokens, ' + row.charCount + ' chars</li>';
  }).join('') : '<li style="color:#777;">No caption length data.</li>';

  var longestRows = report.longestCaptions && report.longestCaptions.length ? report.longestCaptions.map(function (row) {
    return '<li><button class="fail-link" data-file="' + encodeURIComponent(row.fileName) + '" data-focus="' +
      encodeFocus(longestFocus) + '" data-source="' + encodeURIComponent('Longest Captions') + '">' +
      escapeHtml(row.fileName) + '</button> - ' + row.tokenCount + ' tokens, ' + row.charCount + ' chars</li>';
  }).join('') : '<li style="color:#777;">No caption length data.</li>';

  var duplicateRows = report.duplicateCaptions && report.duplicateCaptions.length ? report.duplicateCaptions.map(function (group) {
    var groupFocus = encodeFocus(group.files || []);
    var shown = group.files.slice(0, 4).map(function (fileName) {
      return '<button class="fail-link" data-file="' + encodeURIComponent(fileName) + '" data-focus="' + groupFocus +
        '" data-source="' + encodeURIComponent('Duplicate Captions') + '">' + escapeHtml(fileName) + '</button>';
    }).join(', ');
    var extra = group.files.length > 4 ? ' +' + (group.files.length - 4) + ' more' : '';
    var sample = group.sample.length > 120 ? group.sample.slice(0, 117) + '...' : group.sample;
    return '<li><strong>' + group.count + ' files:</strong> ' + shown + extra +
      '<div class="small">"' + escapeHtml(sample) + '"</div></li>';
  }).join('') : '<li style="color:#777;">No duplicate captions detected.</li>';

  var shortOutlierRows = report.shortOutliers && report.shortOutliers.length ? report.shortOutliers.map(function (row) {
    return '<li><button class="fail-link" data-file="' + encodeURIComponent(row.fileName) + '" data-focus="' +
      encodeFocus(shortOutlierFocus) + '" data-source="' + encodeURIComponent('Length Outliers (Bottom 5%)') + '">' +
      escapeHtml(row.fileName) + '</button> - ' + row.tokenCount + ' tokens</li>';
  }).join('') : '<li style="color:#777;">No short outliers.</li>';

  var longOutlierRows = report.longOutliers && report.longOutliers.length ? report.longOutliers.map(function (row) {
    return '<li><button class="fail-link" data-file="' + encodeURIComponent(row.fileName) + '" data-focus="' +
      encodeFocus(longOutlierFocus) + '" data-source="' + encodeURIComponent('Length Outliers (Top 5%)') + '">' +
      escapeHtml(row.fileName) + '</button> - ' + row.tokenCount + ' tokens</li>';
  }).join('') : '<li style="color:#777;">No long outliers.</li>';


  var html = '' +
    '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<link rel="stylesheet" href="/static/css/report.css">' +
    '</head><body>' +
    '<div class="report-preview">' +
    '<div class="row config-row">' +
    '<div class="card"><h3>Summary</h3>' +
    '<div class="summary-row"><span>Total files</span><strong>' + report.total + '</strong></div>' +
    '<div class="summary-row"><span>With captions</span><strong>' + report.withCaption + '</strong></div>' +
    '<div class="summary-row"><span>Missing captions</span><strong>' + report.missingCaption + '</strong></div>' +
    '<div class="summary-row"><span>Required phrase</span><strong>' + escapeHtml(requiredLabel) + '</strong></div>' +
    '<div class="summary-row"><span>Required hits</span><strong>' + report.requiredHits + ' (' + report.requiredPercent + '%)</strong></div></div>' +
    '<div class="config-panel" id="config-panel"><h3>Config Files</h3><div id="config-list">Loading...</div></div>' +
    '</div>' +
    '<div class="row">' +
    '<div class="card"><h3>Missing Required Phrase</h3><ul>' + requiredRows + '</ul></div>' +
    '<div class="card"><h3>Balance Counts</h3><table><thead><tr><th>Phrase</th><th>Count</th><th>Percent</th></tr></thead><tbody>' + phraseRows + '</tbody></table></div>' +
    '</div>' +
    '<div class="row">' +
    '<div class="card"><h3>Validation Failures</h3><ul>' + failRows + '</ul></div>' +
    '<div class="card"><h3>Duplicate Captions</h3><ul>' + duplicateRows + '</ul></div>' +
    '</div>' +
    '<div class="row">' +
    '<div class="card"><h3>Shortest Captions</h3><ul>' + shortestRows + '</ul></div>' +
    '<div class="card"><h3>Longest Captions</h3><ul>' + longestRows + '</ul></div>' +
    '</div>' +
    '<div class="row">' +
    '<div class="card"><h3>Length Outliers (Bottom 5%)</h3><ul>' + shortOutlierRows + '</ul></div>' +
    '<div class="card"><h3>Length Outliers (Top 5%)</h3><ul>' + longOutlierRows + '</ul></div>' +
    '</div>' +
    '<div class="row">' +
    '<div class="card"><h3>Top Tokens</h3><ul class="token-grid">' + topRows + '</ul></div>' +
    '<div class="card"><h3>Rare Tokens (&lt;=2)</h3><ul class="token-grid">' + rareRows + '</ul></div>' +
    '</div>' +
    '<div class="row"><div class="card"><h3>Media Metadata</h3><div id="media-metadata-panel">Loading...</div></div></div>' +
    '</div>' +
    '</body></html>';

  var doc = ui.previewEl.contentDocument || ui.previewEl.contentdocument;
  doc.open();
  doc.write(html);
  doc.close();

  // Attach event listeners for file and token links after DOM is ready
  setTimeout(function() {
    // File/caption links
    Array.prototype.forEach.call(doc.querySelectorAll('.fail-link'), function(btn) {
      btn.addEventListener('click', function() {
        var f = btn.getAttribute('data-file') || '';
        var focus = btn.getAttribute('data-focus') || '';
        var source = btn.getAttribute('data-source') || '';
        var files = [];
        if (focus) { files = decodeURIComponent(focus).split('\n').filter(Boolean); }
        if (window.parent && window.parent.postMessage) {
          window.parent.postMessage({ type: 'caption-review-select', fileName: decodeURIComponent(f), focusFiles: files, focusSource: decodeURIComponent(source || '') }, '*');
        }
      });
    });
    // Token links
    Array.prototype.forEach.call(doc.querySelectorAll('.token-link'), function(btn) {
      btn.addEventListener('click', function() {
        var t = btn.getAttribute('data-token') || '';
        if (window.parent && window.parent.postMessage) {
          window.parent.postMessage({ type: 'caption-review-token', token: decodeURIComponent(t) }, '*');
        }
      });
    });
    // Render config and media metadata panels after iframe is loaded
    renderConfigPanel(doc);
    if (!parent || !parent.state || !parent.state.folder) return;
    renderMediaMetadataPanel(parent.state.folder, doc);
  }, 50);
}

// When a caption/media file is selected, clear config editing state
function selectCaptionFile(fileName) {
  state.currentConfigFile = null;
}
// Handle config file selection from config panel (iframe)
window.addEventListener('message', function(event) {
  var msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'config-file-select' && typeof msg.fileName === 'string') {
    loadConfigFileToEditor(msg.fileName);
  }
});

// Loads config file content into the main editor for editing
function loadConfigFileToEditor(fileName) {
  setStatus('Loading config: ' + fileName);
  var folder = state.folder || '';
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/fs/read_config?folder=' + encodeURIComponent(folder) + '&file=' + encodeURIComponent(fileName));
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) return;
    if (xhr.status === 200) {
      // Set editor content and update state
      ui.editorEl.value = xhr.responseText;
      ui.editorEl.removeAttribute('readonly'); // Ensure editor is editable for config files
      state.currentConfigFile = fileName;
      state.currentCaptionFile = null;
      setStatus('Editing config: ' + fileName);
    } else {
      setStatus('Failed to load config (' + xhr.status + ')');
    }
  };
  xhr.send();
}

// Save logic for config files (overrides caption save if editing config)
function saveCurrentEditorContent() {
  if (state.currentConfigFile) {
    // Save config file
    var folder = state.folder || '';
    var file = state.currentConfigFile;
    var text = ui.editorEl.value;
    setStatus('Saving config...');
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/fs/save_config');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        setStatus('Config saved.');
      } else {
        setStatus('Config save failed (' + xhr.status + ')');
      }
    };
    xhr.send(JSON.stringify({folder: folder, file: file, text: text}));
    return;
  }
  // Otherwise, save caption as usual
  saveCurrentCaption();
}