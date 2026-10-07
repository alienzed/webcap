(function () {
  'use strict';

  var setScanState = {
    open: false,
    running: false,
    stopRequested: false,
    folder: '',
    files: [],
    visionModel: '',
    currentVisionJobId: '',
    rawResponses: [],
    stage: 'ready'
  };

  function el(id) {
    return document.getElementById(id);
  }

  function requestJson(url, options) {
    return fetch(url, options || {}).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.ok === false) {
          throw new Error((payload && payload.error) || (response.statusText || 'Set Scan request failed.'));
        }
        return payload;
      });
    });
  }

  function setScanSetStage(stage, message) {
    setScanState.stage = stage;
    var stageEl = el('set-scan-stage');
    var statusEl = el('set-scan-status');
    if (!stageEl || !statusEl) throw new Error('Set Scan status controls are missing.');
    var labels = {
      metadata: 'WebCap analysis',
      vision: 'Vision Sight',
      ready: 'Reusable intelligence'
    };
    stageEl.textContent = labels[stage] || stage;
    statusEl.textContent = String(message || '');
    renderSetScanStages();
  }

  function renderSetScanStages() {
    var modal = el('set-scan-modal');
    var stopBtn = el('set-scan-stop-btn');
    var progressFill = el('set-scan-progress-fill');
    if (!modal || !stopBtn || !progressFill) throw new Error('Set Scan UI is incomplete.');

    modal.classList.toggle('hidden', !setScanState.open);
    stopBtn.classList.toggle('hidden', !setScanState.running);

    var stageOrder = ['metadata', 'vision', 'ready'];
    var activeIndex = stageOrder.indexOf(setScanState.stage);
    var stageNodes = document.querySelectorAll('#set-scan-stages .set-scan-stage');
    Array.prototype.forEach.call(stageNodes, function (node) {
      var stage = String(node.getAttribute('data-stage') || '');
      var index = stageOrder.indexOf(stage);
      node.classList.toggle('is-active', index === activeIndex && setScanState.running);
      node.classList.toggle('is-complete', index < activeIndex || (!setScanState.running && stage === 'ready' && setScanState.stage === 'ready'));
    });

    var percent = 0;
    if (setScanState.stage === 'metadata') percent = 20;
    if (setScanState.stage === 'vision') percent = 60;
    if (setScanState.stage === 'ready') percent = setScanState.running ? 90 : 100;
    progressFill.style.width = String(percent) + '%';

    renderSetScanRaw();
  }

  function renderSetScanRaw() {
    var wrap = el('set-scan-raw-wrap');
    var output = el('set-scan-raw-output');
    if (!wrap || !output) throw new Error('Set Scan raw output controls are missing.');
    wrap.classList.toggle('hidden', !setScanState.rawResponses.length);
    output.textContent = setScanState.rawResponses.map(function (entry) {
      return '--- ' + String(entry.file || '') + ' ---\n' + String(entry.text || '');
    }).join('\n\n');
    wrap.scrollTop = wrap.scrollHeight;
  }

  function appendSetScanRaw(fileName, text) {
    setScanState.rawResponses.push({
      file: String(fileName || ''),
      text: String(text || '')
    });
    renderSetScanRaw();
  }

  function saveSetScanSight(folder, model, media, sight) {
    return requestJson('/fs/vision_schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'save_sight',
        folder: folder,
        visionModel: model,
        media: media,
        sight: sight
      })
    });
  }

  function requestSetScanSight(folder, model, media) {
    return requestJson('/fs/vision_schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'scan_sight',
        folder: folder,
        visionModel: model,
        media: media
      })
    }).then(function (payload) {
      if (!payload.job || !payload.job.jobId) {
        throw new Error('Vision Sight did not return a queued job.');
      }
      setScanState.currentVisionJobId = String(payload.job.jobId || '');
      trackTransientLlmJob(payload.job);
      return waitForCaptionAssistJob(payload.job);
    }).then(function (job) {
      setScanState.currentVisionJobId = '';
      var sight = job && job.result && job.result.sight;
      if (!sight || !sight.description || !sight.inventory) {
        throw new Error('Vision Sight completed without structured evidence.');
      }
      return {
        sight: sight,
        text: String(job.result && job.result.text || '')
      };
    });
  }

  function scanSetVisionNext(pending, index, folder, model) {
    if (setScanState.stopRequested || !setScanState.open) return Promise.resolve(false);
    if (String(state.folder || '') !== folder) {
      throw new Error('Set changed while Scan Set was running.');
    }
    if (index >= pending.length) return Promise.resolve(true);

    var fileName = pending[index];
    setScanSetStage('vision', String(index + 1) + ' / ' + String(pending.length) + ' missing Sight');
    return requestSetScanSight(folder, model, fileName).then(function (result) {
      if (setScanState.stopRequested) return false;
      appendSetScanRaw(fileName, result.text);
      return saveSetScanSight(folder, model, fileName, result.sight);
    }).then(function (saved) {
      if (saved === false || setScanState.stopRequested) return false;
      return scanSetVisionNext(pending, index + 1, folder, model);
    });
  }

  function runSetScanVision(folder, files, model) {
    if (!model) {
      setScanSetStage('vision', 'Skipped — no Vision model selected.');
      return Promise.resolve(true);
    }
    return requestJson(
      '/fs/vision_schema?folder=' + encodeURIComponent(folder) + '&model=' + encodeURIComponent(model)
    ).then(function (payload) {
      var wanted = {};
      files.forEach(function (fileName) { wanted[fileName] = true; });
      var pending = (payload.items || []).filter(function (item) {
        return !!wanted[String(item.file || '')] && !item.structured;
      }).map(function (item) {
        return String(item.file || '');
      }).filter(Boolean);

      if (!pending.length) {
        setScanSetStage('vision', 'Current for ' + String(files.length) + ' media item' + (files.length === 1 ? '' : 's') + '.');
        return true;
      }
      return scanSetVisionNext(pending, 0, folder, model);
    });
  }

  function finishSetScan(success, message) {
    setScanState.running = false;
    setScanState.currentVisionJobId = '';
    if (success) {
      setScanSetStage('ready', message || 'Set intelligence is current.');
      window.setStatus(message || 'Set intelligence is current.');
    }
    renderSetScanStages();
  }

  function runSetScan() {
    if (setScanState.running) return;
    var folder = String(state && state.folder || '');
    var files = getCurrentSetMediaFileNames();
    if (!folder || !isSetFolderContext(folder, state && state.items)) {
      window.setStatus('Open a Set before scanning.');
      return;
    }
    if (!files.length) {
      window.setStatus('This Set has no media to scan.');
      return;
    }

    setScanState.folder = folder;
    setScanState.files = files.slice();
    setScanState.visionModel = String(getCaptionVisionModelId() || '').trim();
    setScanState.running = true;
    setScanState.stopRequested = false;
    setScanState.currentVisionJobId = '';
    setScanState.rawResponses = [];
    setScanSetStage('metadata', 'Checking ' + String(files.length) + ' Set media item' + (files.length === 1 ? '' : 's') + '…');
    renderSetScanStages();

    refreshMediaResolutionCache({
      includeFaceFocus: true,
      includeSelectionPose: true,
      suppressUpdatedEvent: true,
      successStatus: 'WebCap Set analysis is current.'
    }).then(function (metadataResult) {
      if (!metadataResult || metadataResult.ok === false) {
        throw new Error((metadataResult && metadataResult.error) || 'WebCap Set analysis failed.');
      }
      if (setScanState.stopRequested) return false;
      return runSetScanVision(folder, files, setScanState.visionModel);
    }).then(function (visionSuccess) {
      if (visionSuccess === false || setScanState.stopRequested) return false;
      setScanSetStage('ready', 'Refreshing reusable Set intelligence…');
      return refreshMediaResolutionCache({
        includeFaceFocus: true,
        includeSelectionPose: true,
        successStatus: 'Set intelligence is current.'
      }).then(function (result) {
        if (!result || result.ok === false) {
          throw new Error((result && result.error) || 'Final Set intelligence refresh failed.');
        }
        return true;
      });
    }).then(function (success) {
      if (success === false || setScanState.stopRequested) {
        finishSetScan(false);
        setScanSetStage('ready', 'Scan stopped. Completed analysis remains cached.');
        window.setStatus('Set scan stopped. Completed analysis remains cached.');
        return;
      }
      var modelNote = setScanState.visionModel
        ? ' Vision Sight is current for the selected model.'
        : ' Vision Sight was skipped because no Vision model is selected.';
      finishSetScan(true, 'Set scan complete.' + modelNote);
    }).catch(function (err) {
      setScanState.running = false;
      setScanState.currentVisionJobId = '';
      setScanSetStage(setScanState.stage || 'ready', 'Scan failed: ' + String(err && err.message ? err.message : err));
      reportConsoleError('Scan Set', err);
      window.setStatus('Set scan failed.');
      renderSetScanStages();
    });
  }

  function stopSetScan() {
    if (!setScanState.running) return;
    setScanState.stopRequested = true;
    var jobId = setScanState.currentVisionJobId;
    setScanState.currentVisionJobId = '';
    setScanSetStage(setScanState.stage, 'Stopping…');
    if (jobId) {
      cancelCaptionAssistJob(jobId).catch(function (err) {
        reportConsoleError('Scan Set', err);
      });
    }
  }

  function openSetScan() {
    var folder = String(state && state.folder || '');
    if (!folder || !isSetFolderContext(folder, state && state.items)) {
      window.setStatus('Open a Set before scanning.');
      return;
    }
    setScanState.open = true;
    renderSetScanStages();
    runSetScan();
  }

  function closeSetScan() {
    if (setScanState.running) stopSetScan();
    setScanState.open = false;
    renderSetScanStages();
  }

  function bindSetScan() {
    var openBtn = el('set-scan-open-btn');
    var closeBtn = el('set-scan-close-btn');
    var stopBtn = el('set-scan-stop-btn');
    var modal = el('set-scan-modal');
    if (!openBtn || !closeBtn || !stopBtn || !modal) {
      throw new Error('Set Scan controls are missing.');
    }
    openBtn.onclick = openSetScan;
    closeBtn.onclick = closeSetScan;
    stopBtn.onclick = stopSetScan;
    modal.addEventListener('click', function (event) {
      if (event.target === modal) closeSetScan();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && setScanState.open) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeSetScan();
      }
    }, true);
  }

  window.openSetScan = openSetScan;
  window.stopSetScan = stopSetScan;

  bindSetScan();
})();
