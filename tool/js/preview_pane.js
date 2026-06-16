// Render config panel into the report iframe
function renderConfigPanel(doc) {
  var panel = doc.getElementById('config-panel');
  if (!panel) return;
  var configListEl = doc.getElementById('config-list');
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
// Utility: Stream fetch output to preview pane
function streamPreviewFromFetch(url, body, ui, onDone, onError) {
  if (typeof showConsolePanel === 'function') {
    showConsolePanel();
  } else {
    ui.consolePanelEl.style.display = 'block';
    if (typeof syncConsoleToggleButton === 'function') {
      syncConsoleToggleButton();
    }
  }
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function(response) {
    var ok = response.ok;
    if (!response.body || typeof ReadableStream === 'undefined') {
      response.text().then(function (text) {
        appendToConsolePanel(text.replace(/</g, '<').replace(/>/g, '>'));
        if (ok) {
          if (onDone) onDone(text);
        } else {
          if (onError) onError(text || response.statusText);
        }
      });
      return;
    }
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var output = '';
    function readChunk() {
      reader.read().then(function (result) {
        if (result.done) {
          var tail = decoder.decode();
          if (tail) {
            output += tail;
            appendToConsolePanel(tail.replace(/</g, '<').replace(/>/g, '>'));
          }
          if (ok) {
            if (onDone) onDone(output);
          } else {
            if (onError) onError(output || response.statusText);
          }
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

// Utility: Fetch full preview output as one payload (no chunk streaming)
function fetchPreviewText(url, body, ui, onDone, onError) {
  if (typeof showConsolePanel === 'function') {
    showConsolePanel();
  } else {
    ui.consolePanelEl.style.display = 'block';
    if (typeof syncConsoleToggleButton === 'function') {
      syncConsoleToggleButton();
    }
  }
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function (response) {
    return response.text().then(function (text) {
      if (text) {
        appendToConsolePanel(text.replace(/</g, '<').replace(/>/g, '>'));
      }
      if (response.ok) {
        if (onDone) onDone(text || '');
        return;
      }
      if (onError) onError(text || response.statusText);
    });
  }).catch(function (err) {
    setStatus('Request failed: ' + err);
    if (onError) onError(err);
  });
}


// Render media metadata panel into the report iframe
function renderMediaMetadataPanel(folder, doc, scopedFileNames, includeFaceFocus, includeSelectionPose) {
  var panel = doc.getElementById('media-metadata-panel');
  if (!panel) return;
  panel.textContent = 'Loading...';
  var url = '/fs/media_metadata?folder=' + encodeURIComponent(folder) +
    (includeFaceFocus ? '&face_focus=1' : '') +
    (includeSelectionPose ? '&selection_pose=1' : '');
  if (Array.isArray(scopedFileNames) && scopedFileNames.length) {
    url += '&files=' + encodeURIComponent(scopedFileNames.join('\n'));
  }
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url);
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) return;
    if (xhr.status === 200) {
      try {
        var data = JSON.parse(xhr.responseText);
        if (!Array.isArray(data)) throw new Error('Malformed metadata');
        var allRows = data.slice();
        var scopedRows = allRows;
        if (Array.isArray(scopedFileNames)) {
          var allowed = {};
          scopedFileNames.forEach(function (name) {
            var key = String(name || '').trim();
            if (key) allowed[key] = true;
          });
          scopedRows = allRows.filter(function (row) {
            var fileName = String((row && row.file) || '').trim();
            return !!allowed[fileName];
          });
        }

        // UI: AR grouping toggle
        var arToggleId = 'ar-group-toggle';
        // Only render toggle and table inside the panel, never outside
        panel.innerHTML = '' +
          '<div style="margin-bottom:6px;">' +
            '<label style="font-size:13px;display:inline-flex;align-items:center;gap:4px;">' +
              '<input type="checkbox" id="' + arToggleId + '" style="vertical-align:middle;">' +
              'Group by Aspect Ratio' +
            '</label>' +
          '</div>' +
          '<div id="metadata-row-summary" class="small" style="margin:0 0 6px 0;"></div>' +
          '<div id="ar-group-table"></div>';
        var tableDiv = panel.querySelector('#ar-group-table');
        var summaryEl = panel.querySelector('#metadata-row-summary');
        if (!tableDiv) return;
        if (summaryEl) {
          summaryEl.textContent = 'Showing ' + scopedRows.length + ' of ' + allRows.length + ' metadata rows';
        }
        renderFaceFocusReportPanel(doc, allRows, scopedFileNames);
        renderSelectionPoseReportPanels(doc, allRows, scopedFileNames);
        renderSuggestedSelectionPanel(doc, allRows, scopedFileNames);

        function metadataCellHtml(row, column) {
          var val = row[column] !== undefined ? String(row[column]) : '-';
          if (column === 'file') {
            return '<td><button class="fail-link metadata-file-link" data-file="' + encodeURIComponent(val) + '">' + escapeHtml(val) + '</button></td>';
          }
          if (column === 'aspect') {
            var isSupported = hasSupportedAspectBucket(val);
            if (isSupported) {
              var bucket = typeof mapAspectRatioBucket === 'function' ? mapAspectRatioBucket(val) : val;
              var displayText = bucket !== val ? val + ' (' + bucket + ')' : val;
              return '<td class="metadata-value-ok" style="color: green;" title="Supported aspect ratio: ' + bucket + '.">' + escapeHtml(displayText) + '</td>';
            } else {
              return '<td class="metadata-value-error" title="Aspect ratio is outside supported buckets (square, 4:3, 3:4, 16:9, 9:16).">' + escapeHtml(val) + '</td>';
            }
          }
          return '<td>' + escapeHtml(val) + '</td>';
        }

        function wireMetadataFileLinks() {
          Array.prototype.forEach.call(tableDiv.querySelectorAll('.metadata-file-link'), function(btn) {
            btn.onclick = function () {
              var fileName = decodeURIComponent(btn.getAttribute('data-file') || '');
              if (!fileName) return;
              if (window.parent && window.parent.postMessage) {
                window.parent.postMessage({
                  type: 'caption-review-select',
                  fileName: fileName,
                  focusFiles: [fileName],
                  focusSource: 'Media Metadata',
                  reportType: 'selection'
                }, '*');
              }
            };
          });
        }

        function renderTable(groupByAR) {
          var cols = ['file','resolution','fps','aspect','scene','size','bitrate','codec','duration','frames'];
          var colLabels = {file:'File',resolution:'Resolution',fps:'FPS',aspect:'Aspect',scene:'Scene',size:'Size',bitrate:'Bitrate',codec:'Codec',duration:'Duration',frames:'Frames'};
          var html = '';
          if (groupByAR) {
            // Group rows by AR bucket
            var arGroups = {};
            scopedRows.forEach(function(row){
              var ar = mapAspectRatioToBucket(row.aspect);
              if (!arGroups[ar]) arGroups[ar] = [];
              arGroups[ar].push(row);
            });
            // Only show supported buckets in order
            var bucketOrder = ['square','4:3','3:4','16:9','9:16','Unknown'];
            bucketOrder.forEach(function(ar){
              if (!arGroups[ar] || !arGroups[ar].length) return;
              html += '<div style="margin:8px 0 2px 0;font-weight:bold;">Aspect Ratio: ' + escapeHtml(ar) + ' (' + arGroups[ar].length + ')</div>';
              html += '<table class="metadata-table"><thead><tr>' + cols.map(function(c){return '<th>' + escapeHtml(colLabels[c]) + '</th>';}).join('') + '</tr></thead><tbody>';
              arGroups[ar].forEach(function(row){
                if (row && row.scene_complexity_label && row.scene === undefined) row.scene = row.scene_complexity_label;
                html += '<tr>' + cols.map(function(c){ return metadataCellHtml(row, c); }).join('') + '</tr>';
              });
              html += '</tbody></table>';
            });
          } else {
            html += '<table class="metadata-table"><thead><tr>' + cols.map(function(c){return '<th>' + escapeHtml(colLabels[c]) + '</th>';}).join('') + '</tr></thead><tbody>';
            scopedRows.forEach(function(row){
              if (row && row.scene_complexity_label && row.scene === undefined) row.scene = row.scene_complexity_label;
              html += '<tr>' + cols.map(function(c){ return metadataCellHtml(row, c); }).join('') + '</tr>';
            });
            html += '</tbody></table>';
          }
          tableDiv.innerHTML = html;
          wireMetadataFileLinks();
        }

        // Initial render (ungrouped)
        renderTable(false);
        // Wire up toggle
        var arToggle = doc.getElementById(arToggleId);
        if (arToggle) {
          arToggle.onchange = function() {
            renderTable(arToggle.checked);
          };
        }
      } catch(e) {
        panel.textContent = 'Failed to parse media metadata: ' + (e && e.message ? e.message : e);
      }
    } else {
      panel.textContent = 'Failed to load media metadata (' + xhr.status + ')';
    }
  };
  xhr.send();
}

function renderReportPreview(report, reviewedFileNames) {
  function encodeFocus(files) {
    var names = (files || []).map(function (name) { return String(name || ''); }).filter(Boolean);
    return encodeURIComponent(names.join('\n'));
  }
  var theme = typeof getCurrentAppTheme === 'function' ? getCurrentAppTheme() : 'light';

  var requiredLabel = report.requiredPhrase ? report.requiredPhrase : '(not set)';
  var phraseRows = report.phraseSummary.length ? report.phraseSummary.map(function (row) {
    var phrase = String(row.phrase || '');
    var captionCount = (row.captionCount !== undefined) ? row.captionCount : row.count;
    var tagCount = (row.tagCount !== undefined) ? row.tagCount : 0;
    var captionPercent = (row.captionPercent !== undefined) ? row.captionPercent : row.percent;
    var tagPercent = (row.tagPercent !== undefined) ? row.tagPercent : 0;
    return '<tr><td><button class="balance-phrase-link" data-phrase="' + encodeURIComponent(phrase) + '">' +
      escapeHtml(phrase) + '</button></td><td>' + captionCount + ' (' + captionPercent + '%)</td><td>' + tagCount + ' (' + tagPercent + '%)</td></tr>';
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

  var similarCaption = (report.similarCaptions || []).map(function (row) { return row.fileName; });
  var similarRows = report.similarCaptions && report.similarCaptions.length ? report.similarCaptions.map(function (group) {
    var groupFocus = encodeFocus(group.files || []);
    var shown = group.files.slice(0, 4).map(function (fileName) {
      return '<button class="fail-link" data-file="' + encodeURIComponent(fileName) + '" data-focus="' + groupFocus +
        '" data-source="' + encodeURIComponent('Similar Captions') + '">' + escapeHtml(fileName) + '</button>';
    }).join(', ');
    var extra = group.files.length > 4 ? ' +' + (group.files.length - 4) + ' more' : '';
    return '<li><strong>' + group.similarity + '% match, ' + group.files.length + ' files:</strong> ' + shown + extra +
      '<div class="small">"' + escapeHtml(group.sample) + '"</div></li>';
  }).join('') : '<li style="color:#777;">No similar captions detected.</li>';

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
    '<!DOCTYPE html><html data-theme="' + theme + '"><head><meta charset="UTF-8">' +
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
    '<div class="card"><h3>Balance Counts</h3><table><thead><tr><th>Phrase</th><th>Caption</th><th>Tag</th></tr></thead><tbody>' + phraseRows + '</tbody></table></div>' +
    '</div>' +
    '<div class="row">' +
    '<div class="card"><h3>Validation Failures</h3><ul>' + failRows + '</ul></div>' +
    '<div class="card"><h3>Duplicate Captions</h3><ul>' + duplicateRows + '</ul></div>' +
    '<div class="card"><h3>Similar Captions (80%+)</h3><ul>' + similarRows + '</ul></div>' +
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
    '</body></html>';

  var doc = ui.previewEl.contentDocument || ui.previewEl.contentdocument;
  doc.open();
  doc.write(html);
  doc.close();
  hideBalanceDistributionWheel();

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
          window.parent.postMessage({
            type: 'caption-review-select',
            fileName: decodeURIComponent(f),
            focusFiles: files,
            focusSource: decodeURIComponent(source || ''),
            reportType: 'captions'
          }, '*');
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
    Array.prototype.forEach.call(doc.querySelectorAll('.balance-phrase-link'), function(btn) {
      btn.addEventListener('click', function() {
        var p = btn.getAttribute('data-phrase') || '';
        if (window.parent && window.parent.postMessage) {
          window.parent.postMessage({ type: 'caption-review-phrase', phrase: decodeURIComponent(p) }, '*');
        }
      });
    });
    // Render config and media metadata panels after iframe is loaded
    renderConfigPanel(doc);
  }, 50);
}

function renderSelectionPreview(report, reviewedFileNames) {
  var theme = typeof getCurrentAppTheme === 'function' ? getCurrentAppTheme() : 'light';
  var html = '' +
    '<!DOCTYPE html><html data-theme="' + theme + '"><head><meta charset="UTF-8">' +
    '<link rel="stylesheet" href="/static/css/report.css">' +
    '</head><body>' +
    '<div class="report-preview">' +
    '<div class="row">' +
    '<div class="card"><h3>Summary</h3>' +
    '<div class="summary-row"><span>Visible items</span><strong>' + report.total + '</strong></div>' +
    '<div class="summary-row"><span>Images</span><strong>' + report.images + '</strong></div>' +
    '<div class="summary-row"><span>Videos</span><strong>' + report.videos + '</strong></div>' +
    '<div class="summary-row"><span>With captions</span><strong>' + report.withCaption + '</strong></div>' +
    '<div class="summary-row"><span>Missing captions</span><strong>' + report.missingCaption + '</strong></div>' +
    '</div>' +
    '<div class="card"><h3>Scope</h3>' +
    '<p class="small" style="margin:0;line-height:1.45;">Selection Analysis runs only on the currently visible media items. Use filters first, then click a group to open a focus set for rating and inspection.</p>' +
    '</div>' +
    '</div>' +
    '<div class="row"><div class="card"><h3>Suggested Candidates</h3><p class="small" style="margin:0 0 6px 0;color:#666;font-size:12px;" title="Items with high-confidence multimodal signals from face direction, expression, body orientation, and pose class.">Items with consistent pose and expression signals</p><div id="selection-suggested-candidates-panel">Loading...</div></div></div>' +
    '<div class="row"><div class="card"><h3>Face Focus</h3><div id="face-focus-panel">Loading...</div></div></div>' +
    '<div class="row">' +
    '<div class="card"><h3>Face Direction</h3><div id="selection-face-direction-panel">Loading...</div></div>' +
    '<div class="card"><h3>Expression</h3><div id="selection-expression-panel">Loading...</div></div>' +
    '<div class="card"><h3>Body Orientation</h3><div id="selection-body-orientation-panel">Loading...</div></div>' +
    '</div>' +
    '<div class="row">' +
    '<div class="card"><h3>Pose Class</h3><div id="selection-pose-class-panel">Loading...</div></div>' +
    '<div class="card"><h3>Arm Placement</h3><div id="selection-arm-position-panel">Loading...</div></div>' +
    '</div>' +
    '<div class="row"><div class="card"><h3>Media Metadata</h3><div id="media-metadata-panel">Loading...</div></div></div>' +
    '</div>' +
    '</body></html>';

  var doc = ui.previewEl.contentDocument || ui.previewEl.contentdocument;
  doc.open();
  doc.write(html);
  doc.close();
  hideBalanceDistributionWheel();

  setTimeout(function () {
    if (!parent || !parent.state || !parent.state.folder) return;
    var faceFocusEnabled = !!(APP_CONFIG && APP_CONFIG.analysis && APP_CONFIG.analysis.enableFaceAnalysis);
    var selectionPoseEnabled = !!(APP_CONFIG && APP_CONFIG.analysis && APP_CONFIG.analysis.enableMediaPipeAnalysis);
    renderMediaMetadataPanel(parent.state.folder, doc, reviewedFileNames, faceFocusEnabled, selectionPoseEnabled);
  }, 50);
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
  if (typeof hideConsolePanel === 'function') {
    hideConsolePanel();
  } else if (ui && ui.consolePanelEl) {
    ui.consolePanelEl.style.display = 'none';
  }
  var consoleToggleBtn = document.getElementById('console-toggle-btn');
  if (consoleToggleBtn && typeof syncConsoleToggleButton === 'function') {
    syncConsoleToggleButton();
  }
  var folder = state.folder || '';
  var keepReviewPreview = false;
  if (ui && ui.previewEl) {
    var previewDoc = ui.previewEl.contentDocument || ui.previewEl.contentdocument;
    keepReviewPreview = !!(previewDoc && previewDoc.getElementById && previewDoc.getElementById('config-panel'));
  }
  state.currentItem = null;
  if (!keepReviewPreview) {
    clearEditorAndPreview();
    renderChecklistPanel();
  } else if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = '';
  }
  renderFileList(ui.filterEl.value);
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/fs/read_config?folder=' + encodeURIComponent(folder) + '&file=' + encodeURIComponent(fileName));
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) return;
    if (xhr.status === 200) {
      // Set editor content and update state
      ui.editorEl.value = xhr.responseText;
      ui.editorEl.removeAttribute('readonly'); // Ensure editor is editable for config files
      state.currentConfigFile = { folder: folder, file: fileName };
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
  if (state.currentItem && state.currentItem.fileName) {
    saveCurrentCaption();
    return;
  }
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
    xhr.send(JSON.stringify({folder: folder, file: file.file, text: text}));
    return;
  }
  // Otherwise, save caption as usual
  saveCurrentCaption();
}
