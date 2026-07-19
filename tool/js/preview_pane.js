// Utility: Stream fetch output to preview pane
function streamPreviewFromFetch(url, body, ui, onDone, onError, options) {
  var opts = options || {};
  if (opts.showConsole !== false) showConsolePanel();
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
                  reportType: 'review'
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

function renderReviewSetPreview(report, reviewedFileNames, scopeSummary) {
  function encodeFocus(files) {
    var names = (files || []).map(function (name) { return String(name || ''); }).filter(Boolean);
    return encodeURIComponent(names.join('\n'));
  }
  var theme = typeof getCurrentAppTheme === 'function' ? getCurrentAppTheme() : 'light';
  var scope = scopeSummary || {};

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

  var requirementsCards = '';
  if (report.requiredPhrase && report.requiredMissing && report.requiredMissing.length) {
    requirementsCards += '<div class="card"><h3>Missing Required Phrase</h3><ul>' + requiredRows + '</ul></div>';
  }
  if (report.phraseSummary && report.phraseSummary.length) {
    requirementsCards += '<div class="card"><h3>Balance Counts</h3><table><thead><tr><th>Phrase</th><th>Caption</th><th>Tag</th></tr></thead><tbody>' + phraseRows + '</tbody></table></div>';
  }

  var findingsCards = '';
  if (report.ruleFailures && report.ruleFailures.length) {
    findingsCards += '<div class="card"><h3>Validation Failures</h3><ul>' + failRows + '</ul></div>';
  }
  if (report.duplicateCaptions && report.duplicateCaptions.length) {
    findingsCards += '<div class="card"><h3>Duplicate Captions</h3><ul>' + duplicateRows + '</ul></div>';
  }
  if (report.similarCaptions && report.similarCaptions.length) {
    findingsCards += '<div class="card"><h3>Similar Captions (80%+)</h3><ul>' + similarRows + '</ul></div>';
  }

  var outlierCard = '';
  if ((report.shortOutliers && report.shortOutliers.length) || (report.longOutliers && report.longOutliers.length)) {
    outlierCard = '<div class="row"><div class="card"><h3>Caption Length Outliers</h3><h4>Shorter than usual</h4><ul>' + shortOutlierRows + '</ul><h4>Longer than usual</h4><ul>' + longOutlierRows + '</ul></div></div>';
  }


  var html = '' +
    '<!DOCTYPE html><html data-theme="' + theme + '"><head><meta charset="UTF-8">' +
    '<link rel="stylesheet" href="/static/css/report.css">' +
    '</head><body>' +
    '<div class="report-preview">' +
    '<div class="row config-row">' +
    '<div class="card"><h3>Review Set</h3>' +
    '<div class="summary-row"><span>Visible items</span><strong>' + report.total + '</strong></div>' +
    '<div class="summary-row"><span>Images</span><strong>' + (scope.images || 0) + '</strong></div>' +
    '<div class="summary-row"><span>Videos</span><strong>' + (scope.videos || 0) + '</strong></div>' +
    '<div class="summary-row"><span>With captions</span><strong>' + report.withCaption + '</strong></div>' +
    '<div class="summary-row"><span>Missing captions</span><strong>' + report.missingCaption + '</strong></div>' +
    '<div class="summary-row"><span>Required phrase</span><strong>' + escapeHtml(requiredLabel) + '</strong></div>' +
    '<div class="summary-row"><span>Required hits</span><strong>' + report.requiredHits + ' (' + report.requiredPercent + '%)</strong></div></div>' +
    '</div>' +
    (requirementsCards ? '<div class="row">' + requirementsCards + '</div>' : '') +
    (findingsCards ? '<div class="row">' + findingsCards + '</div>' : '') +
    outlierCard +
    '<details id="review-analysis-details" class="card">' +
    '<summary><strong>Analysis details</strong> <span class="small">Optional curation signals and media metadata</span></summary>' +
    '<div class="row"><div class="card"><h3>Suggested Candidates</h3><div id="selection-suggested-candidates-panel">Open Analysis details to load.</div></div></div>' +
    '<div class="row"><div class="card"><h3>Face Focus</h3><div id="face-focus-panel">Open Analysis details to load.</div></div></div>' +
    '<div class="row">' +
    '<div class="card"><h3>Face Direction</h3><div id="selection-face-direction-panel">Open Analysis details to load.</div></div>' +
    '<div class="card"><h3>Expression</h3><div id="selection-expression-panel">Open Analysis details to load.</div></div>' +
    '<div class="card"><h3>Body Orientation</h3><div id="selection-body-orientation-panel">Open Analysis details to load.</div></div>' +
    '</div>' +
    '<div class="row">' +
    '<div class="card"><h3>Pose Class</h3><div id="selection-pose-class-panel">Open Analysis details to load.</div></div>' +
    '<div class="card"><h3>Arm Placement</h3><div id="selection-arm-position-panel">Open Analysis details to load.</div></div>' +
    '</div>' +
    '<div class="row"><div class="card"><h3>Media Metadata</h3><div id="media-metadata-panel">Open Analysis details to load.</div></div></div>' +
    '</details>' +
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
            reportType: 'review'
          }, '*');
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
    var analysisDetails = doc.getElementById('review-analysis-details');
    var analysisLoaded = false;
    if (analysisDetails) {
      analysisDetails.addEventListener('toggle', function () {
        if (!analysisDetails.open || analysisLoaded) return;
        analysisLoaded = true;
        var faceFocusEnabled = !!(APP_CONFIG && APP_CONFIG.analysis && APP_CONFIG.analysis.enableFaceAnalysis);
        var selectionPoseEnabled = !!(APP_CONFIG && APP_CONFIG.analysis && APP_CONFIG.analysis.enableMediaPipeAnalysis);
        renderMediaMetadataPanel(state.folder, doc, reviewedFileNames, faceFocusEnabled, selectionPoseEnabled);
      });
    }
  }, 50);
}

// Loads config file content into the main editor for editing
function loadConfigFileToEditor(fileName, options) {
  var opts = options || {};
  var preserveTrainingWorkspace = !!opts.preserveTrainingWorkspace;
  setStatus('Loading config: ' + fileName);
  if (preserveTrainingWorkspace && isTrainingRunnerConsoleVisible()) hideTrainingRunnerConsole();
  if (!preserveTrainingWorkspace) hideConsolePanel();
  var folder = state.folder || '';
  state.currentItem = null;
  clearEditorAndPreview();
  var loadToken = Number(state.configLoadToken || 0) + 1;
  state.configLoadToken = loadToken;
  renderChecklistPanel();
  renderFileList(ui.filterEl.value);
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/fs/read_config?folder=' + encodeURIComponent(folder) + '&file=' + encodeURIComponent(fileName));
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) return;
    if (state.configLoadToken !== loadToken || state.folder !== folder) return;
    if (xhr.status === 200) {
      // Set editor content and update state
      ui.editorEl.value = xhr.responseText;
      ui.editorEl.removeAttribute('readonly'); // Ensure editor is editable for config files
      state.currentConfigFile = { folder: folder, file: fileName };
      state.currentCaptionFile = null;
      if (workspaceState.surface !== 'training') {
        setWorkspaceSurface('configEditor');
      } else {
        syncWorkspaceConfigEditorUi();
        syncTrainingWorkspaceConfigSelection();
      }
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
    return saveCurrentCaption();
  }
  if (state.currentConfigFile) {
    return saveCurrentCaption();
  }
  // Otherwise, save caption as usual
  return saveCurrentCaption();
}
