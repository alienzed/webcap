var StatsViewModule = (function() {
  function escapeHtml(str) {
    return CaptionUtils.escapeHtml(str);
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

  function getPrimerOptionsFromDom() {
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
    return items.map(function(item) {
      return item.fileName + ':\n' + (item.caption || '');
    }).join('\n\n');
  }

  function buildStatsPanelHtml(buttonLabel) {
    var label = buttonLabel || 'Recalculate';
    return '' +
      '<div class="stats-panel">' +
      '  <details id="stats-details" open>' +
      '    <summary><strong>Stats & Validation</strong></summary>' +
      '    <div class="stats-controls">' +
      '      <label>Required key phrase</label>' +
      '      <input id="stats-required-phrase" type="text" placeholder="e.g. subject name">' +
      '      <label>Balance phrases (one per line)</label>' +
      '      <textarea id="stats-phrases" rows="4" placeholder="face down\nface up\nfront view\nback view"></textarea>' +
      '      <label>Rules (file:token => phrase or caption:phrase => phrase)</label>' +
        '      <textarea id="stats-token-rules" rows="4" placeholder="fd => face down\nfile:fu => face up\ncaption:front view => face"></textarea>' +
      '      <button id="stats-run-btn" type="button">' + escapeHtml(label) + '</button>' +
      '      <button id="folder-settings-reset-btn" type="button" title="Delete .webcap_state.json for current folder">Reset Folder Settings</button>' +
      '    </div>' +
        '  </details>' +
        '  <details id="primer-details">' +
        '    <summary><strong>Template Primer</strong></summary>' +
        '    <div class="stats-controls">' +
        '      <label>Template (multiline, placeholders like {subject})</label>' +
        '      <textarea id="primer-template" rows="4" placeholder="{subject}\n{view}\n{lighting}"></textarea>' +
        '      <label>Defaults (key=value per line)</label>' +
        '      <textarea id="primer-defaults" rows="3" placeholder="lighting=soft light"></textarea>' +
        '      <label>Filename mappings (file:token => key=value)</label>' +
        '      <textarea id="primer-mappings" rows="4" placeholder="file:fd => view=face down\nfile:woman => subject=woman"></textarea>' +
        '      <div class="small">Applies automatically when a caption is empty.</div>' +
        '    </div>' +
        '  </details>' +
      '</div>';
  }

  function renderReportPreview(ui, report) {
    var requiredLabel = report.requiredPhrase ? report.requiredPhrase : '(not set)';
    var phraseRows = report.phraseSummary.length ? report.phraseSummary.map(function(row) {
      return '<tr><td>' + escapeHtml(row.phrase) + '</td><td>' + row.count + '</td><td>' + row.percent + '%</td></tr>';
    }).join('') : '<tr><td colspan="3" style="color:#777;">No phrases configured.</td></tr>';

    var failRows = report.ruleFailures.length ? report.ruleFailures.slice(0, 40).map(function(row) {
      return '<li><button class="fail-link" data-file="' + encodeURIComponent(row.fileName) + '">' +
        '<strong>' + escapeHtml(row.fileName) + '</strong></button> - ' + escapeHtml(row.reason) + '</li>';
    }).join('') : '<li style="color:#777;">No validation failures.</li>';

    var requiredRows = '';
    if (!report.requiredPhrase) {
      requiredRows = '<li style="color:#777;">Required key phrase is not set.</li>';
    } else if (!report.requiredMissing || !report.requiredMissing.length) {
      requiredRows = '<li style="color:#777;">All captions include required phrase.</li>';
    } else {
      requiredRows = report.requiredMissing.slice(0, 40).map(function(row) {
        return '<li><button class="fail-link" data-file="' + encodeURIComponent(row.fileName) + '">' +
          '<strong>' + escapeHtml(row.fileName) + '</strong></button> - ' + escapeHtml(row.reason) + '</li>';
      }).join('');
    }

    var topRows = report.topTokens.length ? report.topTokens.slice(0, 25).map(function(row) {
      return '<li><button class="token-link" data-token="' + encodeURIComponent(row.token) + '">' + escapeHtml(row.token) +
        '</button>: <strong>' + row.count + '</strong></li>';
    }).join('') : '<li style="color:#777;">No tokens found.</li>';

    var rareRows = report.rareTokens.length ? report.rareTokens.slice(0, 25).map(function(row) {
      return '<li><button class="token-link" data-token="' + encodeURIComponent(row.token) + '">' + escapeHtml(row.token) +
        '</button>: <strong>' + row.count + '</strong></li>';
    }).join('') : '<li style="color:#777;">No rare tokens found.</li>';

    var shortestRows = report.shortestCaptions && report.shortestCaptions.length ? report.shortestCaptions.map(function(row) {
      return '<li><button class="fail-link" data-file="' + encodeURIComponent(row.fileName) + '">' +
        escapeHtml(row.fileName) + '</button> - ' + row.tokenCount + ' tokens, ' + row.charCount + ' chars</li>';
    }).join('') : '<li style="color:#777;">No caption length data.</li>';

    var longestRows = report.longestCaptions && report.longestCaptions.length ? report.longestCaptions.map(function(row) {
      return '<li><button class="fail-link" data-file="' + encodeURIComponent(row.fileName) + '">' +
        escapeHtml(row.fileName) + '</button> - ' + row.tokenCount + ' tokens, ' + row.charCount + ' chars</li>';
    }).join('') : '<li style="color:#777;">No caption length data.</li>';

    var duplicateRows = report.duplicateCaptions && report.duplicateCaptions.length ? report.duplicateCaptions.map(function(group) {
      var shown = group.files.slice(0, 4).map(function(fileName) {
        return '<button class="fail-link" data-file="' + encodeURIComponent(fileName) + '">' + escapeHtml(fileName) + '</button>';
      }).join(', ');
      var extra = group.files.length > 4 ? ' +' + (group.files.length - 4) + ' more' : '';
      var sample = group.sample.length > 120 ? group.sample.slice(0, 117) + '...' : group.sample;
      return '<li><strong>' + group.count + ' files:</strong> ' + shown + extra +
        '<div class="small">"' + escapeHtml(sample) + '"</div></li>';
    }).join('') : '<li style="color:#777;">No duplicate captions detected.</li>';

    var shortOutlierRows = report.shortOutliers && report.shortOutliers.length ? report.shortOutliers.map(function(row) {
      return '<li><button class="fail-link" data-file="' + encodeURIComponent(row.fileName) + '">' +
        escapeHtml(row.fileName) + '</button> - ' + row.tokenCount + ' tokens</li>';
    }).join('') : '<li style="color:#777;">No short outliers.</li>';

    var longOutlierRows = report.longOutliers && report.longOutliers.length ? report.longOutliers.map(function(row) {
      return '<li><button class="fail-link" data-file="' + encodeURIComponent(row.fileName) + '">' +
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
      '<script>' +
      'document.querySelectorAll(".fail-link").forEach(function(btn){' +
      'btn.addEventListener("click",function(){' +
      'var f=btn.getAttribute("data-file")||"";' +
      'if(window.parent&&window.parent.postMessage){window.parent.postMessage({type:"caption-review-select",fileName:decodeURIComponent(f)},"*");}' +
      '});' +
      '});' +
      'document.querySelectorAll(".token-link").forEach(function(btn){' +
      'btn.addEventListener("click",function(){' +
      'var t=btn.getAttribute("data-token")||"";' +
      'if(window.parent&&window.parent.postMessage){window.parent.postMessage({type:"caption-review-token",token:decodeURIComponent(t)},"*");}' +
      '});' +
      '});' +
      '<\/script>' +
      '</body></html>';

    var doc = ui.previewEl.contentDocument || ui.previewEl.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
  }

  return {
    getOptionsFromDom: getOptionsFromDom,
    getPrimerOptionsFromDom: getPrimerOptionsFromDom,
    buildCombinedCaptionsText: buildCombinedCaptionsText,
    buildStatsPanelHtml: buildStatsPanelHtml,
    renderReportPreview: renderReportPreview
  };
})();