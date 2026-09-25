(function () {
  'use strict';

  var storageState = {
    open: false,
    loading: false,
    payload: null,
    scan: null,
    scanPollTimer: null,
    activeArea: '',
    bulkDelete: null
  };

  function el(id) { return document.getElementById(id); }

  function requestJson(url, options) {
    return fetch(url, options || {}).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.ok === false) {
          throw new Error((payload && payload.error) || 'Storage request failed.');
        }
        return payload;
      });
    });
  }

  function postJson(url, payload) {
    return requestJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
  }

  function reportError(err) {
    var message = String(err && err.message ? err.message : err || 'Storage request failed.');
    var status = el('storage-status');
    if (status) status.textContent = message;
    window.reportConsoleError('Storage', message);
  }

  function bytes(value) {
    var size = Number(value);
    if (!isFinite(size) || size < 0) return 'Not measured';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var index = 0;
    while (size >= 1024 && index < units.length - 1) {
      size /= 1024;
      index += 1;
    }
    var digits = size >= 100 || index === 0 ? 0 : (size >= 10 ? 1 : 2);
    return size.toFixed(digits) + ' ' + units[index];
  }

  function measurementAge(value) {
    var measuredAt = Number(value);
    if (!isFinite(measuredAt) || measuredAt <= 0) return '';
    var seconds = Math.max(0, Math.round(Date.now() / 1000 - measuredAt));
    if (seconds < 60) return 'measured just now';
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return 'measured ' + minutes + 'm ago';
    var hours = Math.round(minutes / 60);
    if (hours < 48) return 'measured ' + hours + 'h ago';
    return 'measured ' + Math.round(hours / 24) + 'd ago';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function currentFolder() {
    return String(window.state && window.state.folder || '');
  }

  function allItems() {
    var groups = storageState.payload && storageState.payload.items || {};
    return ['training', 'tests', 'staged', 'generate', 'storyboard', 'set', 'runtime', 'comfy'].reduce(function (rows, area) {
      return rows.concat((groups[area] || []).map(function (item) {
        return item;
      }));
    }, []);
  }

  function itemSort(a, b) {
    if (!!a.measured !== !!b.measured) return a.measured ? -1 : 1;
    if (a.measured && b.measured && Number(a.bytes) !== Number(b.bytes)) return Number(b.bytes) - Number(a.bytes);
    return String(a.label || '').localeCompare(String(b.label || ''));
  }

  function renderDisk() {
    var disk = storageState.payload && storageState.payload.disk;
    var host = el('storage-disk-summary');
    if (!host || !disk) return;
    var usedPercent = disk.total > 0 ? Math.max(0, Math.min(100, disk.used / disk.total * 100)) : 0;
    host.innerHTML =
      '<div class="storage-capacity-copy">' +
        '<strong>' + escapeHtml(bytes(disk.free)) + ' free</strong>' +
        '<span>' + escapeHtml(bytes(disk.used)) + ' used of ' + escapeHtml(bytes(disk.total)) + '</span>' +
      '</div>' +
      '<div class="storage-capacity-track" aria-label="' + Math.round(usedPercent) + '% disk used">' +
        '<span style="width:' + usedPercent.toFixed(2) + '%"></span>' +
      '</div>';
  }

  function renderCategories() {
    var host = el('storage-category-list');
    if (!host) return;
    var categories = (storageState.payload && storageState.payload.categories || []).slice();
    host.innerHTML = categories.map(function (category) {
      var complete = category.complete !== false;
      var sizeText = category.measuredCount ? bytes(category.bytes) : 'Not measured';
      var note = category.note ? '<span class="storage-category-note">' + escapeHtml(category.note) + '</span>' : '';
      return '<button type="button" class="storage-category-row" data-storage-area="' + escapeHtml(category.area) + '">' +
        '<span class="storage-category-main"><strong>' + escapeHtml(category.label) + '</strong>' +
        '<span>' + category.count + ' item' + (category.count === 1 ? '' : 's') +
        (complete ? '' : ' · partial inventory') + '</span>' + note + '</span>' +
        '<span class="storage-category-size">' + escapeHtml(sizeText) +
        '<span>' + category.measuredCount + '/' + category.count + ' measured</span></span>' +
        '<span class="storage-category-chevron" aria-hidden="true">›</span>' +
      '</button>';
    }).join('');
  }

  function actionButtons(item) {
    var payload = ' data-area="' + escapeHtml(item.area) + '" data-id="' + escapeHtml(item.id) + '" data-folder="' + escapeHtml(item.folder || '') + '"';
    var html = '<button type="button" class="review-captions-btn storage-open-btn"' + payload + (item.openable ? '' : ' disabled') + '>Open</button>';
    html += '<button type="button" class="review-captions-btn storage-measure-btn"' + payload + '>Measure</button>';
    if (item.purgeable) {
      var label = 'Delete';
      if (item.area === 'storyboard') label = 'Delete Take';
      else if (item.area === 'staged') label = 'Delete Copy';
      else if (item.area === 'runtime' && String(item.id || '').indexOf('h3-probe/') === 0) label = 'Delete Probe';
      else if (item.area === 'runtime' && String(item.id || '').indexOf('generate-reference/') === 0) label = 'Delete Reference';
      else if (item.area === 'comfy') label = 'Delete Scratch';
      html += '<button type="button" class="review-captions-btn storage-delete-btn"' + payload + '>' + label + '</button>';
    }
    return html;
  }

  function renderItems() {
    var host = el('storage-items');
    var categoriesHost = el('storage-category-list');
    if (!host) return;
    var groups = storageState.payload && storageState.payload.items || {};
    var areaLabels = {
      training: 'Training',
      tests: 'Tests',
      staged: 'Staged Test LoRAs',
      generate: 'Generations',
      storyboard: 'Storyboard Takes',
      set: 'Set Data (protected)',
      runtime: 'Runtime / Temporary',
      comfy: 'ComfyUI Scratch'
    };
    var area = String(storageState.activeArea || '');
    if (categoriesHost) categoriesHost.classList.toggle('hidden', !!area);
    if (!area) {
      host.innerHTML = '';
      return;
    }
    var rows = (groups[area] || []).slice().sort(itemSort);
    var purgeableTests = area === 'tests' ? rows.filter(function (item) { return !!item.purgeable; }) : [];
    var bulkDelete = storageState.bulkDelete;
    var bulkAction = area === 'tests' && purgeableTests.length
      ? '<button type="button" class="review-captions-btn storage-delete-btn storage-bulk-delete-tests"' +
        (bulkDelete ? ' disabled' : '') + '>' +
        escapeHtml(bulkDelete
          ? ('Deleting ' + String(bulkDelete.done) + ' / ' + String(bulkDelete.total) + '…')
          : ('Delete completed (' + String(purgeableTests.length) + ')…')) +
        '</button>'
      : '';
    var empty = rows.length
      ? ''
      : '<div class="storage-empty">' + (area === 'tests'
        ? (storageState.payload && storageState.payload.lastScan
          ? 'No Test Sessions were found in the last completed workspace scan.'
          : 'No Test Sessions are visible yet. Start scan to discover historical Tests across Sets.')
        : 'No managed items found.') + '</div>';
    var body = rows.map(function (item) {
      var measured = item.measured ? bytes(item.bytes) : 'Not measured';
      var age = item.measured ? measurementAge(item.measuredAt) : '';
      var fileCount = item.measured && item.fileCount != null ? Number(item.fileCount) : null;
      var fileText = fileCount == null ? '' : fileCount + ' file' + (fileCount === 1 ? '' : 's');
      var secondary = [item.kind, item.status, fileText, age].filter(Boolean).join(' · ');
      var reason = item.protectedReason ? '<span class="storage-item-reason">' + escapeHtml(item.protectedReason) + '</span>' : '';
      return '<article class="storage-item-row">' +
        '<div class="storage-item-copy"><strong title="' + escapeHtml(item.label) + '">' + escapeHtml(item.label) + '</strong>' +
        '<span>' + escapeHtml(secondary) + '</span>' + reason + '</div>' +
        '<div class="storage-item-size">' + escapeHtml(measured) + '</div>' +
        '<div class="storage-item-actions">' + actionButtons(item) + '</div>' +
      '</article>';
    }).join('');
    host.innerHTML =
      '<section class="storage-detail">' +
        '<header class="storage-detail-header">' +
          '<button type="button" class="review-captions-btn storage-overview-back">‹ Overview</button>' +
          '<div><strong>' + escapeHtml(areaLabels[area] || area) + '</strong><span>' + rows.length + ' item' + (rows.length === 1 ? '' : 's') + ' · largest first</span></div>' +
          '<div class="storage-detail-actions">' + bulkAction + '</div>' +
        '</header>' +
        '<section class="storage-section" data-storage-section="' + escapeHtml(area) + '">' +
          body + empty +
        '</section>' +
      '</section>';
  }

  function scanIsActive() {
    var status = String(storageState.scan && storageState.scan.status || '');
    return status === 'running' || status === 'cancelling';
  }

  function scanStatusText() {
    var scan = storageState.scan || {};
    var status = String(scan.status || '');
    if (status === 'running' || status === 'cancelling') {
      var phase = status === 'cancelling'
        ? 'Cancelling scan…'
        : (scan.phase === 'discovering' ? 'Discovering Sets and Tests…' : 'Scanning managed artifacts…');
      var parts = [phase];
      if (scan.current) parts.push(String(scan.current));
      if (Number(scan.directoriesScanned || 0)) parts.push(Number(scan.directoriesScanned) + ' folders');
      if (Number(scan.filesScanned || 0)) parts.push(Number(scan.filesScanned) + ' files');
      if (Number(scan.bytesScanned || 0)) parts.push(bytes(scan.bytesScanned) + ' inspected');
      if (Number(scan.itemsTotal || 0)) {
        parts.push(Number(scan.itemsMeasured || 0) + '/' + Number(scan.itemsTotal) + ' managed items measured');
      }
      return parts.join(' · ');
    }
    if (status === 'completed') {
      return 'Scan complete · ' + Number(scan.itemsMeasured || 0) + ' managed items measured · ' +
        Number(scan.testsDiscovered || 0) + ' Test Session' + (Number(scan.testsDiscovered || 0) === 1 ? '' : 's') +
        ' discovered' + (Number(scan.errors || 0) ? ' · ' + Number(scan.errors) + ' issue(s)' : '');
    }
    if (status === 'cancelled') {
      return 'Scan cancelled. Completed measurements were kept; workspace discovery remains partial.';
    }
    if (status === 'failed') {
      return 'Scan failed: ' + String(scan.error || scan.lastError || 'unknown error');
    }
    var lastScan = storageState.payload && storageState.payload.lastScan;
    if (lastScan && lastScan.completedAt) {
      return 'Last workspace scan ' + measurementAge(lastScan.completedAt).replace(/^measured /, '') +
        ' · ' + Number(lastScan.itemsMeasured || 0) + ' managed items measured.';
    }
    return 'Opening Storage is cheap. Start scan when you want a current workspace-wide disk inventory.';
  }

  function syncScanButton() {
    var button = el('storage-scan-btn');
    if (!button) return;
    var active = scanIsActive();
    button.textContent = active ? (String(storageState.scan.status) === 'cancelling' ? 'Cancelling…' : 'Cancel scan') : 'Start scan';
    button.disabled = String(storageState.scan && storageState.scan.status || '') === 'cancelling';
    button.title = active
      ? 'Stop the current disk inspection after the current filesystem operation.'
      : 'Inspect WebCap-owned storage scopes and discover historical Test Sessions.';
  }

  function render() {
    renderDisk();
    renderCategories();
    renderItems();
    syncScanButton();
    var status = el('storage-status');
    if (status) status.textContent = scanStatusText();
  }

  function refresh() {
    if (storageState.loading) return Promise.resolve();
    storageState.loading = true;
    var folder = currentFolder();
    var query = folder ? '?folder=' + encodeURIComponent(folder) : '';
    return requestJson('/fs/storage' + query).then(function (payload) {
      storageState.payload = payload;
      render();
    }).catch(reportError).then(function () {
      storageState.loading = false;
    });
  }

  function measureOne(item) {
    return postJson('/fs/storage/measure', {
      area: item.area,
      id: item.id,
      folder: item.folder || ''
    });
  }


  function stopScanPolling() {
    if (storageState.scanPollTimer) {
      window.clearTimeout(storageState.scanPollTimer);
      storageState.scanPollTimer = null;
    }
  }

  function scheduleScanPoll() {
    stopScanPolling();
    if (!storageState.open || !scanIsActive()) return;
    storageState.scanPollTimer = window.setTimeout(refreshScanStatus, 750);
  }

  function refreshScanStatus() {
    if (!storageState.open) return Promise.resolve();
    var wasActive = scanIsActive();
    return requestJson('/fs/storage/scan/status').then(function (payload) {
      storageState.scan = payload.scan || { status: 'idle' };
      render();
      if (scanIsActive()) {
        scheduleScanPoll();
      } else {
        stopScanPolling();
        if (wasActive) return refresh();
      }
    }).catch(function (err) {
      stopScanPolling();
      reportError(err);
    });
  }

  function startOrCancelScan() {
    if (scanIsActive()) {
      return postJson('/fs/storage/scan/cancel', {}).then(function (payload) {
        storageState.scan = payload.scan || storageState.scan;
        render();
        scheduleScanPoll();
      }).catch(reportError);
    }
    return postJson('/fs/storage/scan/start', { folder: currentFolder() }).then(function (payload) {
      storageState.scan = payload.scan || { status: 'running' };
      render();
      scheduleScanPoll();
    }).catch(reportError);
  }

  function confirmDelete(item) {
    var sizeText = item.measured ? ' This will reclaim about ' + bytes(item.bytes) + '.' : '';
    var label = 'artifact';
    var consequence = '';
    if (item.area === 'storyboard') {
      label = 'Storyboard Take';
      consequence = '\nThis removes only this generated Take. The Story and other Takes remain.';
      if (item.meta && item.meta.selected) consequence += '\nThis Take is currently selected for its Scene.';
    } else if (item.area === 'staged') {
      label = 'staged Test LoRA copy';
      consequence = '\nThe source training epoch is not deleted.';
    } else if (item.area === 'runtime' && String(item.id || '').indexOf('h3-probe/') === 0) {
      label = 'H3 probe';
      consequence = '\nThis removes the captured probe inputs, logs, and probe results.';
    } else if (item.area === 'runtime' && String(item.id || '').indexOf('generate-reference/') === 0) {
      label = 'Generate reference bundle';
      consequence = '\nThis may invalidate that reference in an unsubmitted Generate draft.';
    } else if (item.area === 'comfy') {
      label = 'ComfyUI scratch tree';
      consequence = '\nOnly this exact WebCap-prefixed provider job tree is removed.';
    }
    return window.confirm('Permanently delete this ' + label + '?\n\n' + item.label + sizeText + consequence + '\n\nThis cannot be undone.');
  }

  function testItemsForBulkDelete() {
    var groups = storageState.payload && storageState.payload.items || {};
    return (groups.tests || []).filter(function (item) { return !!item.purgeable; });
  }

  function confirmBulkDeleteTests(items) {
    var allTests = storageState.payload && storageState.payload.items && storageState.payload.items.tests || [];
    var protectedCount = Math.max(0, allTests.length - items.length);
    var measured = items.filter(function (item) { return !!item.measured; });
    var measuredBytes = measured.reduce(function (total, item) {
      return total + Math.max(0, Number(item.bytes) || 0);
    }, 0);
    var lines = [
      'Permanently delete ' + String(items.length) + ' completed Test Session' + (items.length === 1 ? '' : 's') + '?'
    ];
    if (measured.length) {
      lines.push('Measured reclaimable space: about ' + bytes(measuredBytes) + '.');
    }
    if (protectedCount) {
      lines.push(String(protectedCount) + ' active/protected session' + (protectedCount === 1 ? '' : 's') + ' will be kept.');
    }
    lines.push('', 'Each session is safety-checked again immediately before deletion.', '', 'This cannot be undone.');
    return window.confirm(lines.join('\n'));
  }

  function bulkDeleteCompletedTests() {
    if (storageState.bulkDelete) return Promise.resolve();
    var items = testItemsForBulkDelete();
    if (!items.length || !confirmBulkDeleteTests(items)) return Promise.resolve();

    storageState.bulkDelete = { done: 0, total: items.length };
    renderItems();

    var deleted = 0;
    var failures = [];
    var chain = Promise.resolve();
    items.forEach(function (item) {
      chain = chain.then(function () {
        return postJson('/fs/storage/purge', {
          area: item.area,
          id: item.id,
          folder: item.folder || ''
        }).then(function () {
          deleted += 1;
        }).catch(function (err) {
          var message = String(err && err.message ? err.message : err || 'Delete failed.');
          failures.push({ label: String(item.label || item.id), error: message });
          window.reportConsoleError('Storage', 'Could not delete Test Session "' + String(item.label || item.id) + '": ' + message);
        }).then(function () {
          storageState.bulkDelete.done += 1;
          renderItems();
        });
      });
    });

    return chain.then(function () {
      storageState.bulkDelete = null;
      return refresh().then(function () {
        var status = el('storage-status');
        if (status) {
          status.textContent = String(deleted) + ' Test Session' + (deleted === 1 ? '' : 's') + ' deleted' +
            (failures.length ? ' · ' + String(failures.length) + ' skipped/failed (see Console)' : '') + '.';
        }
      });
    });
  }

  function findItem(area, id, folder) {
    return allItems().find(function (item) {
      return item.area === area && item.id === id && String(item.folder || '') === String(folder || '');
    }) || null;
  }

  function handleClick(event) {
    var category = event.target.closest('button[data-storage-area]');
    if (category) {
      storageState.activeArea = category.getAttribute('data-storage-area') || '';
      render();
      return;
    }
    if (event.target.closest('.storage-overview-back')) {
      storageState.activeArea = '';
      render();
      return;
    }
    if (event.target.closest('.storage-bulk-delete-tests')) {
      bulkDeleteCompletedTests();
      return;
    }
    var button = event.target.closest('button[data-area][data-id]');
    if (!button) return;
    var area = button.getAttribute('data-area') || '';
    var id = button.getAttribute('data-id') || '';
    var folder = button.getAttribute('data-folder') || '';
    var item = findItem(area, id, folder);
    if (!item) return;

    if (button.classList.contains('storage-open-btn')) {
      postJson('/fs/storage/open', { area: area, id: id, folder: folder }).catch(reportError);
      return;
    }
    if (button.classList.contains('storage-measure-btn')) {
      button.disabled = true;
      measureOne(item).then(refresh).catch(reportError).then(function () { button.disabled = false; });
      return;
    }
    if (button.classList.contains('storage-delete-btn')) {
      if (!confirmDelete(item)) return;
      button.disabled = true;
      postJson('/fs/storage/purge', { area: area, id: id, folder: folder })
        .then(refresh)
        .catch(reportError)
        .then(function () { button.disabled = false; });
    }
  }

  function openStorageActivity() {
    var frame = el('app-frame');
    var workspace = el('storage-workspace');
    if (!frame || !workspace) throw new Error('Storage workspace markup is missing.');
    window.closeGenerateActivity();
    window.closeTestBenchActivity();
    window.closeStoryboardActivity();
    storageState.open = true;
    storageState.activeArea = '';
    frame.classList.add('workspace-storage-open');
    workspace.classList.remove('hidden');
    window.syncApplicationShellContext();
    window.syncShellLocationRoute();
    refresh();
    refreshScanStatus();
  }

  function closeStorageActivity() {
    var frame = el('app-frame');
    var workspace = el('storage-workspace');
    storageState.open = false;
    stopScanPolling();
    if (workspace) workspace.classList.add('hidden');
    if (frame) frame.classList.remove('workspace-storage-open');
  }

  function bindUi() {
    var workspace = el('storage-workspace');
    if (!workspace) throw new Error('Storage workspace markup is missing.');
    workspace.addEventListener('click', handleClick);
    el('storage-refresh-btn').onclick = refresh;
    el('storage-scan-btn').onclick = startOrCancelScan;
  }

  bindUi();
  window.openStorageActivity = openStorageActivity;
  window.closeStorageActivity = closeStorageActivity;
})();