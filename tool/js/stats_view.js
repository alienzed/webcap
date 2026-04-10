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
      '      <textarea id="stats-token-rules" rows="4" placeholder="template: {subject}, {view}, {lighting}\ndefault:lighting=soft light\nfile:fd => view=face down\ncaption:front view => face"></textarea>' +
      '      <button id="stats-run-btn" type="button">' + escapeHtml(label) + '</button>' +
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

    var html = '' +
      '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
      '<style>' +
      'body{font-family:system-ui;margin:0;padding:12px;background:#f7f8fa;color:#2b2f33;}' +
      '.card{background:#fff;border:1px solid #d6d8dc;border-radius:8px;padding:10px;margin-bottom:10px;}' +
      'h3{margin:0 0 8px 0;font-size:14px;}' +
      'table{width:100%;border-collapse:collapse;font-size:13px;}' +
      'th,td{border-bottom:1px solid #eceef1;padding:6px;text-align:left;vertical-align:top;}' +
      'ul{margin:0;padding-left:18px;font-size:13px;}' +
      '.small{color:#666;font-size:12px;}' +
      '.fail-link,.token-link{background:none;border:none;color:#1266d6;cursor:pointer;padding:0;font:inherit;text-align:left;}' +
      '.fail-link:hover,.token-link:hover{text-decoration:underline;}' +
      '</style></head><body>' +
      '<div class="card"><h3>Summary</h3>' +
      '<div>Total files: <strong>' + report.total + '</strong></div>' +
      '<div>With captions: <strong>' + report.withCaption + '</strong></div>' +
      '<div>Missing captions: <strong>' + report.missingCaption + '</strong></div>' +
      '<div>Required phrase: <strong>' + escapeHtml(requiredLabel) + '</strong></div>' +
      '<div>Required hits: <strong>' + report.requiredHits + ' (' + report.requiredPercent + '%)</strong></div></div>' +
      '<div class="card"><h3>Missing Required Phrase</h3><ul>' + requiredRows + '</ul></div>' +
      '<div class="card"><h3>Balance Counts</h3><table><thead><tr><th>Phrase</th><th>Count</th><th>Percent</th></tr></thead><tbody>' + phraseRows + '</tbody></table></div>' +
      '<div class="card"><h3>Validation Failures</h3><ul>' + failRows + '</ul></div>' +
      '<div class="card"><h3>Top Tokens</h3><ul>' + topRows + '</ul></div>' +
      '<div class="card"><h3>Rare Tokens (&lt;=2)</h3><ul>' + rareRows + '</ul></div>' +
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
    buildCombinedCaptionsText: buildCombinedCaptionsText,
    buildStatsPanelHtml: buildStatsPanelHtml,
    renderReportPreview: renderReportPreview
  };
})();