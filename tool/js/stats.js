function parseTokenRules(multiline) {
  return String(multiline || '')
    .split(/\r?\n/)
    .map(function (line) { return line.trim(); })
    .filter(Boolean)
    .map(function (line) {
      var idx = line.indexOf('=>');
      if (idx === -1) {
        return null;
      }
      var left = line.slice(0, idx).trim().toLowerCase();
      var rightRaw = line.slice(idx + 2).trim();
      var right = rightRaw.toLowerCase();
      if (!left || !right) {
        return null;
      }

      // Primer assignment lines (e.g. file:fd => view=face down) are not validation rules.
      if (right.indexOf('=') !== -1) {
        return null;
      }

      var scope = 'file';
      var trigger = left;
      var colon = left.indexOf(':');
      if (colon > 0) {
        var prefix = left.slice(0, colon).trim();
        var value = left.slice(colon + 1).trim();
        if ((prefix === 'file' || prefix === 'caption') && value) {
          scope = prefix;
          trigger = value;
        }
      }

      if (!trigger) {
        return null;
      }

      return { scope: scope, trigger: trigger, required: right };
    })
    .filter(Boolean);
}

function normalizedCaptionKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(text) {
  return String(text || '').toLowerCase();
}

function tokenize(text) {
  return normalize(text).split(/[^a-z0-9]+/).filter(Boolean);
}

function computeLengthInsights(captionRows) {
  if (!captionRows.length) {
    return {
      shortestCaptions: [],
      longestCaptions: [],
      shortOutliers: [],
      longOutliers: []
    };
  }

  var sorted = captionRows.slice().sort(function (a, b) {
    return a.tokenCount - b.tokenCount || a.charCount - b.charCount || a.fileName.localeCompare(b.fileName);
  });

  var shortestCaptions = sorted.slice(0, 10);
  var longestCaptions = sorted.slice(-10).reverse();

  var cut = Math.max(1, Math.floor(sorted.length * 0.05));
  var shortOutliers = sorted.slice(0, cut);
  var longOutliers = sorted.slice(-cut).reverse();

  return {
    shortestCaptions: shortestCaptions,
    longestCaptions: longestCaptions,
    shortOutliers: shortOutliers,
    longOutliers: longOutliers
  };
}

function computeDuplicateInsights(duplicatesMap) {
  return Object.keys(duplicatesMap)
    .map(function (key) {
      return duplicatesMap[key];
    })
    .filter(function (group) { return group.count > 1; })
    .sort(function (a, b) { return b.count - a.count || a.files[0].localeCompare(b.files[0]); })
    .slice(0, 20);
}

function parsePhrases(multiline) {
  return String(multiline || '')
    .split(/\r?\n/)
    .map(function (line) { return line.trim(); })
    .filter(Boolean);
}

function compute(items, options) {
  var requiredPhrase = normalize(options && options.requiredPhrase || '').trim();
  var phrases = parsePhrases(options && options.phrases || '');
  var tokenRules = parseTokenRules(options && options.tokenRules || '');

  var total = items.length;
  var withCaption = 0;
  var missingCaption = 0;
  var requiredHits = 0;
  var requiredMissing = [];
  var phraseCounts = {};
  var ruleFailures = [];
  var tokenCounts = {};
  var captionRows = [];
  var duplicatesMap = {};

  phrases.forEach(function (p) {
    phraseCounts[p] = 0;
  });

  items.forEach(function (item) {
    var caption = String(item.caption || '');
    var captionNorm = normalize(caption);
    var fileNorm = normalize(item.fileName || '');

    if (caption.trim()) {
      withCaption += 1;
    } else {
      missingCaption += 1;
    }

    if (requiredPhrase && captionNorm.indexOf(requiredPhrase) !== -1) {
      requiredHits += 1;
    } else if (requiredPhrase) {
      requiredMissing.push({
        fileName: item.fileName,
        reason: 'Missing required phrase "' + requiredPhrase + '"'
      });
    }

    phrases.forEach(function (p) {
      if (captionNorm.indexOf(normalize(p)) !== -1) {
        phraseCounts[p] += 1;
      }
    });

    tokenRules.forEach(function (rule) {
      if (rule.scope === 'caption') {
        if (captionNorm.indexOf(rule.trigger) !== -1 && captionNorm.indexOf(rule.required) === -1) {
          ruleFailures.push({
            fileName: item.fileName,
            reason: 'Caption phrase "' + rule.trigger + '" requires phrase "' + rule.required + '"'
          });
        }
        return;
      }
      if (fileNorm.indexOf(rule.trigger) !== -1 && captionNorm.indexOf(rule.required) === -1) {
        ruleFailures.push({
          fileName: item.fileName,
          reason: 'Filename token "' + rule.trigger + '" requires phrase "' + rule.required + '"'
        });
      }
    });

    tokenize(caption).forEach(function (tok) {
      if (TOKEN_BLACKLIST[tok]) {
        return;
      }
      tokenCounts[tok] = (tokenCounts[tok] || 0) + 1;
    });

    var trimmed = caption.trim();
    if (trimmed) {
      var row = {
        fileName: item.fileName,
        charCount: caption.length,
        tokenCount: tokenize(caption).length
      };
      captionRows.push(row);

      var dupKey = normalizedCaptionKey(caption);
      if (!duplicatesMap[dupKey]) {
        duplicatesMap[dupKey] = {
          normalizedCaption: dupKey,
          sample: trimmed,
          count: 0,
          files: []
        };
      }
      duplicatesMap[dupKey].count += 1;
      duplicatesMap[dupKey].files.push(item.fileName);
    }
  });

  var rareTokens = Object.keys(tokenCounts)
    .filter(function (tok) { return tokenCounts[tok] <= 2; })
    .sort(function (a, b) { return tokenCounts[a] - tokenCounts[b] || a.localeCompare(b); })
    .slice(0, 50)
    .map(function (tok) { return { token: tok, count: tokenCounts[tok] }; });

  var topTokens = Object.keys(tokenCounts)
    .sort(function (a, b) { return tokenCounts[b] - tokenCounts[a] || a.localeCompare(b); })
    .slice(0, 50)
    .map(function (tok) { return { token: tok, count: tokenCounts[tok] }; });

  var phraseSummary = phrases.map(function (p) {
    var count = phraseCounts[p] || 0;
    var pct = total ? Math.round((count / total) * 1000) / 10 : 0;
    return { phrase: p, count: count, percent: pct };
  });

  var requiredPercent = total ? Math.round((requiredHits / total) * 1000) / 10 : 0;
  var lengthInsights = computeLengthInsights(captionRows);
  var duplicateCaptions = computeDuplicateInsights(duplicatesMap);

  return {
    total: total,
    withCaption: withCaption,
    missingCaption: missingCaption,
    requiredPhrase: requiredPhrase,
    requiredHits: requiredHits,
    requiredPercent: requiredPercent,
    requiredMissing: requiredMissing,
    phraseSummary: phraseSummary,
    ruleFailures: ruleFailures,
    shortestCaptions: lengthInsights.shortestCaptions,
    longestCaptions: lengthInsights.longestCaptions,
    shortOutliers: lengthInsights.shortOutliers,
    longOutliers: lengthInsights.longOutliers,
    duplicateCaptions: duplicateCaptions,
    topTokens: topTokens,
    rareTokens: rareTokens
  };
}

function getOptionsFromDom() {
  var requiredPhraseEl = document.getElementById('stats-required-phrase');
  var phrasesEl = document.getElementById('stats-phrases');
  var tokenRulesEl = document.getElementById('stats-token-rules');
  return {
    requiredPhrase: requiredPhraseEl ? requiredPhraseEl.value : '',
    phrases: phrasesEl ? phrasesEl.value : '',
    tokenRules: tokenRulesEl ? tokenRulesEl.value : ''
  };
}

function statsGetPrimerOptionsFromDom() {
  var templateEl = document.getElementById('primer-template');
  var defaultsEl = document.getElementById('primer-defaults');
  var mappingsEl = document.getElementById('primer-mappings');
  return {
    template: templateEl ? templateEl.value : '',
    defaults: defaultsEl ? defaultsEl.value : '',
    mappings: mappingsEl ? mappingsEl.value : ''
  };
}

function buildCombinedCaptionsText(items) {
  if (!items.length) {
    return '';
  }
  return items.map(function (item) {
    return item.fileName + ':\n' + (item.caption || '');
  }).join('\n\n');
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
    '<style>' +
    'body{font-family:system-ui;margin:0;padding:10px;background:#f7f8fa;color:#2b2f33;}' +
    '.card{background:#fff;border:1px solid #d6d8dc;border-radius:8px;padding:8px;margin-bottom:8px;}' +
    '.row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;}' +
    '.row .card{margin-bottom:0;}' +
    'h3{margin:0 0 6px 0;font-size:14px;}' +
    'table{width:100%;border-collapse:collapse;font-size:12px;}' +
    'th,td{border-bottom:1px solid #eceef1;padding:5px;text-align:left;vertical-align:top;}' +
    'ul{margin:0;padding-left:16px;font-size:12px;}' +
    'li{margin:2px 0;}' +
    '.summary-row{display:flex;justify-content:space-between;gap:8px;padding:2px 0;border-bottom:1px solid #f0f1f3;font-size:12px;}' +
    '.summary-row:last-child{border-bottom:none;}' +
    '.token-grid{column-count:2;column-gap:14px;}' +
    '.token-grid li{break-inside:avoid;}' +
    '.small{color:#666;font-size:12px;}' +
    '.fail-link,.token-link{background:none;border:none;color:#1266d6;cursor:pointer;padding:0;font:inherit;text-align:left;}' +
    '.fail-link:hover,.token-link:hover{text-decoration:underline;}' +
    '</style></head><body>' +
    '<div class="card"><h3>Summary</h3>' +
    '<div class="summary-row"><span>Total files</span><strong>' + report.total + '</strong></div>' +
    '<div class="summary-row"><span>With captions</span><strong>' + report.withCaption + '</strong></div>' +
    '<div class="summary-row"><span>Missing captions</span><strong>' + report.missingCaption + '</strong></div>' +
    '<div class="summary-row"><span>Required phrase</span><strong>' + escapeHtml(requiredLabel) + '</strong></div>' +
    '<div class="summary-row"><span>Required hits</span><strong>' + report.requiredHits + ' (' + report.requiredPercent + '%)</strong></div></div>' +
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
    // Media metadata panel placeholder:
    '<div class="row"><div class="card"><h3>Media Metadata</h3><div id="media-metadata-panel">Loading...</div></div></div>' +
    '</body></html>';

  var doc = ui.previewEl.contentDocument || ui.previewEl.contentdocument;
  doc.open();
  doc.write(html);
  doc.close();

  // Render media metadata panel after iframe is loaded
  setTimeout(function() {
    if (!parent || !parent.state || !parent.state.folder) return;
    renderMediaMetadataPanel(parent.state.folder, doc);
  }, 50);
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

// Stats/primer DOM helpers and auto-save wiring (moved from common.js)
function getOptionsFromDom() {
  var requiredPhraseEl = document.getElementById('stats-required-phrase');
  var phrasesEl = document.getElementById('stats-phrases');
  var tokenRulesEl = document.getElementById('stats-token-rules');
  return {
    requiredPhrase: requiredPhraseEl ? requiredPhraseEl.value : '',
    phrases: phrasesEl ? phrasesEl.value : '',
    tokenRules: tokenRulesEl ? tokenRulesEl.value : ''
  };
}

function statsGetPrimerOptionsFromDom() {
  var templateEl = document.getElementById('primer-template');
  var defaultsEl = document.getElementById('primer-defaults');
  var mappingsEl = document.getElementById('primer-mappings');
  return {
    template: templateEl ? templateEl.value : '',
    defaults: defaultsEl ? defaultsEl.value : '',
    mappings: mappingsEl ? mappingsEl.value : ''
  };
}

// Debounced auto-save for stats/primer changes
var debouncedSaveFolderState = debounceCreate(600);

function wireStatsPrimerAutoSave() {
  var statsFields = [
    document.getElementById('stats-required-phrase'),
    document.getElementById('stats-phrases'),
    document.getElementById('stats-token-rules'),
    document.getElementById('primer-template'),
    document.getElementById('primer-defaults'),
    document.getElementById('primer-mappings')
  ];
  statsFields.forEach(function (el) {
    if (el && !el.__autoSaveBound) {
      el.__autoSaveBound = true;
      el.addEventListener('input', function () {
        debouncedSaveFolderState(function () {
          saveFolderStateForCurrentRoot();
        });
      });
    }
  });
}