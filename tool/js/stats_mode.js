(function() {
  var MEDIA_EXTENSIONS = {
    '.mp4': true, '.webm': true, '.ogg': true, '.mov': true, '.mkv': true, '.avi': true, '.m4v': true,
    '.jpg': true, '.jpeg': true, '.png': true, '.gif': true, '.webp': true, '.bmp': true
  };

  function startStatsMode(context) {
    var ui = context.ui;
    var state = {
      dirHandle: null,
      dirNames: [],
      runToken: 0,
      items: []
    };

    configureUiForStatsMode(ui);
    wireActions(ui, state);
    setStatus(ui, 'Stats mode ready. Choose Folder to begin.');
  }

  function configureUiForStatsMode(ui) {
    ui.createBtn.style.display = 'none';
    ui.topInputRow.classList.add('single');
    ui.newPageNameEl.readOnly = true;
    ui.newPageNameEl.classList.add('caption-folder-label');
    ui.newPageNameEl.value = 'No folder selected';
    ui.openPageBtn.textContent = 'Choose Folder';
    ui.captionUpBtn.style.display = '';
    ui.captionUpBtn.textContent = 'Refresh Stats';
    ui.captionUpBtn.title = 'Recalculate stats';
    ui.dropZone.style.display = 'none';
    ui.filterEl.style.display = 'none';
    if (ui.reviewBtn) {
      ui.reviewBtn.style.display = 'none';
    }
    ui.pageListEl.classList.add('stats-mode-list');
    ui.pageListEl.innerHTML = buildStatsPanelHtml();

    ui.editorEl.value = '';
    ui.editorEl.readOnly = true;
    ui.editorEl.placeholder = 'Combined captions will appear here after Recalculate.';

    renderReportPreview(ui, {
      total: 0,
      withCaption: 0,
      missingCaption: 0,
      requiredPhrase: '',
      requiredHits: 0,
      requiredPercent: 0,
      phraseSummary: [],
      ruleFailures: [],
      topTokens: [],
      rareTokens: []
    });
  }

  function wireActions(ui, state) {
    ui.openPageBtn.onclick = function() {
      chooseFolder(ui, state);
    };

    ui.captionUpBtn.onclick = function() {
      recalculateStats(ui, state);
    };

    var runBtn = document.getElementById('stats-run-btn');
    if (runBtn) {
      runBtn.onclick = function() {
        recalculateStats(ui, state);
      };
    }
  }

  function chooseFolder(ui, state) {
    if (typeof window.showDirectoryPicker !== 'function') {
      setStatus(ui, 'Choose Folder requires Chromium browser support.');
      return;
    }

    window.showDirectoryPicker().then(function(rootHandle) {
      state.dirHandle = rootHandle;
      state.dirNames = [rootHandle.name];
      ui.newPageNameEl.value = state.dirNames.join(' / ');
      recalculateStats(ui, state);
    }).catch(function(err) {
      if (err && err.name === 'AbortError') {
        setStatus(ui, 'Folder selection canceled');
        return;
      }
      setStatus(ui, String(err && err.message ? err.message : err));
    });
  }

  async function recalculateStats(ui, state) {
    if (!state.dirHandle) {
      setStatus(ui, 'No folder selected');
      return;
    }

    var token = ++state.runToken;
    setStatus(ui, 'Calculating stats...');

    try {
      var items = await readCaptionItems(state.dirHandle);
      if (token !== state.runToken) {
        return;
      }
      state.items = items;

      var requiredPhrase = getInputValue('stats-required-phrase');
      var phrases = getInputValue('stats-phrases');
      var tokenRules = getInputValue('stats-token-rules');
      var report = StatsEngineModule.compute(items, {
        requiredPhrase: requiredPhrase,
        phrases: phrases,
        tokenRules: tokenRules
      });

      ui.editorEl.value = buildCombinedCaptionsText(items);
      renderReportPreview(ui, report);
      setStatus(ui, 'Stats updated: ' + report.total + ' files');
    } catch (err) {
      setStatus(ui, String(err && err.message ? err.message : err));
    }
  }

  async function readCaptionItems(dirHandle) {
    var items = [];

    for await (var entry of dirHandle.values()) {
      if (entry.kind !== 'file') {
        continue;
      }
      var ext = CaptionUtils.getFileExtension(entry.name);
      if (!MEDIA_EXTENSIONS[ext]) {
        continue;
      }

      var captionName = entry.name.replace(/\.[^.]+$/, '.txt');
      var captionText = '';
      try {
        var captionHandle = await dirHandle.getFileHandle(captionName);
        var captionFile = await captionHandle.getFile();
        captionText = await captionFile.text();
      } catch (err) {
        captionText = '';
      }

      items.push({
        fileName: entry.name,
        caption: captionText
      });
    }

    items.sort(function(a, b) { return a.fileName.localeCompare(b.fileName); });
    return items;
  }

  function buildCombinedCaptionsText(items) {
    if (!items.length) {
      return '';
    }
    return items.map(function(item) {
      return item.fileName + ':\n' + (item.caption || '');
    }).join('\n\n');
  }

  function renderReportPreview(ui, report) {
    var requiredLabel = report.requiredPhrase ? report.requiredPhrase : '(not set)';
    var phraseRows = report.phraseSummary.length ? report.phraseSummary.map(function(row) {
      return '<tr><td>' + escapeHtml(row.phrase) + '</td><td>' + row.count + '</td><td>' + row.percent + '%</td></tr>';
    }).join('') : '<tr><td colspan="3" style="color:#777;">No phrases configured.</td></tr>';

    var failRows = report.ruleFailures.length ? report.ruleFailures.slice(0, 40).map(function(row) {
      return '<li><strong>' + escapeHtml(row.fileName) + '</strong> - ' + escapeHtml(row.reason) + '</li>';
    }).join('') : '<li style="color:#777;">No validation failures.</li>';

    var topRows = report.topTokens.length ? report.topTokens.slice(0, 25).map(function(row) {
      return '<li>' + escapeHtml(row.token) + ': <strong>' + row.count + '</strong></li>';
    }).join('') : '<li style="color:#777;">No tokens found.</li>';

    var rareRows = report.rareTokens.length ? report.rareTokens.slice(0, 25).map(function(row) {
      return '<li>' + escapeHtml(row.token) + ': <strong>' + row.count + '</strong></li>';
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
      '</style></head><body>' +
      '<div class="card"><h3>Summary</h3>' +
      '<div>Total files: <strong>' + report.total + '</strong></div>' +
      '<div>With captions: <strong>' + report.withCaption + '</strong></div>' +
      '<div>Missing captions: <strong>' + report.missingCaption + '</strong></div>' +
      '<div>Required phrase: <strong>' + escapeHtml(requiredLabel) + '</strong></div>' +
      '<div>Required hits: <strong>' + report.requiredHits + ' (' + report.requiredPercent + '%)</strong></div></div>' +
      '<div class="card"><h3>Balance Counts</h3><table><thead><tr><th>Phrase</th><th>Count</th><th>Percent</th></tr></thead><tbody>' + phraseRows + '</tbody></table></div>' +
      '<div class="card"><h3>Validation Failures</h3><ul>' + failRows + '</ul></div>' +
      '<div class="card"><h3>Top Tokens</h3><ul>' + topRows + '</ul></div>' +
      '<div class="card"><h3>Rare Tokens (&lt;=2)</h3><ul>' + rareRows + '</ul></div>' +
      '<div class="small">Stats mode is read-only and only recalculates on demand.</div>' +
      '</body></html>';

    var doc = ui.previewEl.contentDocument || ui.previewEl.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
  }

  function buildStatsPanelHtml() {
    return '' +
      '<div class="stats-panel">' +
      '  <details open>' +
      '    <summary><strong>Stats & Validation</strong></summary>' +
      '    <div class="stats-controls">' +
      '      <label>Required key phrase</label>' +
      '      <input id="stats-required-phrase" type="text" placeholder="e.g. subject name">' +
      '      <label>Balance phrases (one per line)</label>' +
      '      <textarea id="stats-phrases" rows="4" placeholder="face down\nface up\nfront view\nback view"></textarea>' +
      '      <label>Token rules (token => phrase, one per line)</label>' +
      '      <textarea id="stats-token-rules" rows="4" placeholder="fd => face down\nfu => face up"></textarea>' +
      '      <button id="stats-run-btn" type="button">Recalculate</button>' +
      '    </div>' +
      '  </details>' +
      '</div>';
  }

  function getInputValue(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }

  function setStatus(ui, text) {
    ui.statusEl.textContent = text || '';
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  ModeRouterModule.registerMode('stats', startStatsMode);
})();