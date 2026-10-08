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
    currentRawResponse: null,
    rawResponses: [],
    rawResponseIndex: -1,
    hasRun: false,
    completed: 0,
    total: 0,
    phase: 'idle'
  };

  function el(id) {
    return document.getElementById(id);
  }

  function requestJson(url, options) {
    return fetch(url, options || {}).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.ok === false) {
          throw new Error((payload && payload.error) || (response.statusText || 'Set Intelligence request failed.'));
        }
        return payload;
      });
    });
  }

  function renderSetIntelligence() {
    var modal = el('set-scan-modal');
    var stopBtn = el('set-scan-stop-btn');
    var progressFill = el('set-scan-progress-fill');
    var next = el('set-intelligence-next');
    var details = el('set-scan-details');
    var responseSelect = el('set-scan-response-select');
    var output = el('set-scan-raw-output');
    var rescanBtn = el('set-scan-rescan-btn');
    if (!modal || !stopBtn || !progressFill || !next || !details || !responseSelect || !output || !rescanBtn) {
      throw new Error('Set Intelligence UI is incomplete.');
    }

    modal.classList.toggle('hidden', !setScanState.open);
    stopBtn.classList.toggle('hidden', !setScanState.running);
    rescanBtn.classList.toggle('hidden', setScanState.running || !setScanState.hasRun);
    next.classList.toggle('hidden', setScanState.phase !== 'complete');

    var percent = 0;
    if (setScanState.phase === 'preparing') percent = 8;
    if (setScanState.phase === 'scanning-open') {
      percent = setScanState.total
        ? 10 + Math.round((setScanState.completed / setScanState.total) * 38)
        : 10;
    }
    if (setScanState.phase === 'scanning-context') {
      percent = setScanState.total
        ? 50 + Math.round((setScanState.completed / setScanState.total) * 45)
        : 50;
    }
    if (setScanState.phase === 'complete') percent = 100;
    progressFill.style.width = String(percent) + '%';

    var responses = Array.isArray(setScanState.rawResponses) ? setScanState.rawResponses : [];
    var currentRaw = responses[setScanState.rawResponseIndex] || null;
    setScanState.currentRawResponse = currentRaw;
    details.classList.toggle('hidden', !responses.length);
    responseSelect.innerHTML = '';
    responses.forEach(function (response, index) {
      var option = document.createElement('option');
      option.value = String(index);
      option.textContent = String(response.file || 'Vision response');
      option.selected = index === setScanState.rawResponseIndex;
      responseSelect.appendChild(option);
    });
    if (currentRaw) {
      output.textContent = String(currentRaw.text || '');
    } else {
      output.textContent = '';
    }
  }

  function setSetIntelligenceStatus(title, message) {
    var stageEl = el('set-scan-stage');
    var statusEl = el('set-scan-status');
    if (!stageEl || !statusEl) throw new Error('Set Intelligence status controls are missing.');
    stageEl.textContent = String(title || '');
    statusEl.textContent = String(message || '');
    renderSetIntelligence();
  }

  function showRawResponse(fileName, passLabel, text) {
    var response = {
      file: String(fileName || '') + ' · ' + String(passLabel || 'Vision'),
      text: String(text || '')
    };
    setScanState.rawResponses.push(response);
    setScanState.rawResponseIndex = setScanState.rawResponses.length - 1;
    setScanState.currentRawResponse = response;
    el('set-scan-details').open = true;
    renderSetIntelligence();
  }

  function selectRawResponse() {
    var select = el('set-scan-response-select');
    var index = Number(select && select.value);
    if (!Number.isInteger(index) || index < 0 || index >= setScanState.rawResponses.length) return;
    setScanState.rawResponseIndex = index;
    setScanState.currentRawResponse = setScanState.rawResponses[index];
    renderSetIntelligence();
  }

  function setIntelligenceVisionContext() {
    var primer = statsGetPrimerOptionsFromDom();
    return {
      groups: (Array.isArray(checklistItems) ? checklistItems : []).map(function (group) {
        return {
          group: String(group || ''),
          terms: getChecklistKeywordTermsForRequirement(group)
        };
      }).filter(function (row) { return !!row.group; }),
      captionTemplate: String(primer && primer.template || '')
    };
  }

  function saveSight(folder, model, media, sight) {
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

  function requestSight(folder, model, media) {
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
        throw new Error('Set Intelligence Vision scan did not return a queued job.');
      }
      setScanState.currentVisionJobId = String(payload.job.jobId || '');
      trackTransientLlmJob(payload.job);
      return waitForCaptionAssistJob(payload.job);
    }).then(function (job) {
      setScanState.currentVisionJobId = '';
      return {
        sight: job && job.result && job.result.sight || null,
        text: String(job && job.result && job.result.text || ''),
        warning: String(job && job.result && job.result.structureWarning || '')
      };
    });
  }

  function requestContextStatus(folder, model, context) {
    return requestJson('/fs/vision_schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'vocabulary_status',
        folder: folder,
        visionModel: model,
        existingGroups: context.groups,
        captionTemplate: context.captionTemplate
      })
    });
  }

  function requestContextSight(folder, model, media, context) {
    return requestJson('/fs/vision_schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'scan_vocabulary_sight',
        folder: folder,
        visionModel: model,
        media: media,
        existingGroups: context.groups,
        captionTemplate: context.captionTemplate
      })
    }).then(function (payload) {
      if (!payload.job || !payload.job.jobId) {
        throw new Error('Set Intelligence Context Sight did not return a queued job.');
      }
      setScanState.currentVisionJobId = String(payload.job.jobId || '');
      trackTransientLlmJob(payload.job);
      return waitForCaptionAssistJob(payload.job);
    }).then(function (job) {
      setScanState.currentVisionJobId = '';
      return {
        sight: job && job.result && job.result.vocabularySight || null,
        text: String(job && job.result && job.result.text || ''),
        warning: String(job && job.result && job.result.structureWarning || '')
      };
    });
  }

  function saveContextSight(folder, model, media, context, sight) {
    return requestJson('/fs/vision_schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'save_vocabulary_sight',
        folder: folder,
        visionModel: model,
        media: media,
        existingGroups: context.groups,
        captionTemplate: context.captionTemplate,
        sight: sight
      })
    });
  }

  function scanNext(pending, index, folder, model) {
    if (setScanState.stopRequested || !setScanState.open) return Promise.resolve(false);
    if (String(state.folder || '') !== folder) {
      throw new Error('Set changed while Set Intelligence was scanning.');
    }
    if (index >= pending.length) return Promise.resolve(true);

    setScanState.completed = index;
    setSetIntelligenceStatus(
      'Open Sight',
      String(index + 1) + ' of ' + String(pending.length) + ' · reading the image without vocabulary guidance'
    );

    var fileName = pending[index];
    return requestSight(folder, model, fileName).catch(function (err) {
      setScanState.currentVisionJobId = '';
      if (setScanState.stopRequested) return false;
      reportConsoleError('Set Intelligence item ' + fileName, err);
      return null;
    }).then(function (result) {
      if (result === false || setScanState.stopRequested) return false;
      if (!result) return true;
      showRawResponse(fileName, 'Open Sight', result.text);
      if (!result.sight) {
        reportConsoleError(
          'Set Intelligence',
          new Error(result.warning || ('Vision returned unstructured evidence for ' + fileName + '.'))
        );
        return true;
      }
      return saveSight(folder, model, fileName, result.sight);
    }).then(function (saved) {
      if (saved === false || setScanState.stopRequested) return false;
      setScanState.completed = index + 1;
      return scanNext(pending, index + 1, folder, model);
    });
  }

  function scanVision(folder, files, model) {
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

      setScanState.total = pending.length;
      setScanState.completed = 0;
      setScanState.phase = 'scanning-open';

      if (!pending.length) {
        setScanState.total = 1;
        setScanState.completed = 1;
        setSetIntelligenceStatus('Open Sight', 'Vocabulary-agnostic visual understanding is already reusable.');
        return true;
      }
      return scanNext(pending, 0, folder, model);
    });
  }

  function scanContextNext(pending, index, folder, model, context) {
    if (setScanState.stopRequested || !setScanState.open) return Promise.resolve(false);
    if (String(state.folder || '') !== folder) {
      throw new Error('Set changed while Context Sight was scanning.');
    }
    if (index >= pending.length) return Promise.resolve(true);

    setScanState.completed = index;
    setSetIntelligenceStatus(
      'Context Sight',
      String(index + 1) + ' of ' + String(pending.length) + ' · reading the image with groups, tags, and caption structure'
    );

    var fileName = pending[index];
    return requestContextSight(folder, model, fileName, context).catch(function (err) {
      setScanState.currentVisionJobId = '';
      if (setScanState.stopRequested) return false;
      reportConsoleError('Set Intelligence Context Sight ' + fileName, err);
      return null;
    }).then(function (result) {
      if (result === false || setScanState.stopRequested) return false;
      if (!result) return true;
      showRawResponse(fileName, 'Context Sight', result.text);
      if (!result.sight) {
        reportConsoleError(
          'Set Intelligence',
          new Error(result.warning || ('Vision returned unstructured Context Sight for ' + fileName + '.'))
        );
        return true;
      }
      return saveContextSight(folder, model, fileName, context, result.sight);
    }).then(function (saved) {
      if (saved === false || setScanState.stopRequested) return false;
      setScanState.completed = index + 1;
      return scanContextNext(pending, index + 1, folder, model, context);
    });
  }

  function scanContextVision(folder, files, model, context) {
    setScanState.phase = 'scanning-context';
    if (!context.groups.length) {
      setScanState.total = 1;
      setScanState.completed = 1;
      setSetIntelligenceStatus('Context Sight', 'No annotation groups are configured, so the second visual read is skipped.');
      return Promise.resolve(true);
    }
    return requestContextStatus(folder, model, context).then(function (payload) {
      var wanted = {};
      files.forEach(function (fileName) { wanted[fileName] = true; });
      var pending = (payload.items || []).filter(function (item) {
        return !!wanted[String(item.file || '')] && !item.cached;
      }).map(function (item) {
        return String(item.file || '');
      }).filter(Boolean);

      setScanState.total = pending.length;
      setScanState.completed = 0;
      if (!pending.length) {
        setScanState.total = 1;
        setScanState.completed = 1;
        setSetIntelligenceStatus('Context Sight', 'Template- and vocabulary-guided visual understanding is already reusable.');
        return true;
      }
      return scanContextNext(pending, 0, folder, model, context);
    });
  }

  function finishScan(message) {
    setScanState.running = false;
    setScanState.currentVisionJobId = '';
    setScanState.phase = 'complete';
    setSetIntelligenceStatus('Set understood', message || 'Ready for the next decision.');
    window.setStatus('Set Intelligence is ready.');
  }

  function runSetIntelligence() {
    if (setScanState.running) return;

    var folder = String(state && state.folder || '');
    var files = getCurrentSetMediaFileNames();
    if (!folder || !isSetFolderContext(folder, state && state.items)) {
      window.setStatus('Open a Set before using Set Intelligence.');
      return;
    }
    if (!files.length) {
      window.setStatus('This Set has no media to analyze.');
      return;
    }

    setScanState.folder = folder;
    setScanState.files = files.slice();
    setScanState.visionModel = '';
    setScanState.running = true;
    setScanState.hasRun = true;
    setScanState.stopRequested = false;
    setScanState.currentVisionJobId = '';
    setScanState.currentRawResponse = null;
    setScanState.rawResponses = [];
    setScanState.rawResponseIndex = -1;
    el('set-scan-details').open = false;
    setScanState.completed = 0;
    setScanState.total = 0;
    setScanState.phase = 'preparing';
    setSetIntelligenceStatus('Understanding Set', 'Preparing ' + String(files.length) + ' media item' + (files.length === 1 ? '' : 's') + '…');

    var visionContext = null;

    Promise.all([
      loadCaptionVisionCapabilities(),
      refreshMediaResolutionCache({
        includeFaceFocus: true,
        includeSelectionPose: true,
        suppressUpdatedEvent: true,
        successStatus: 'Supporting Set analysis is current.'
      })
    ]).then(function (results) {
      setScanState.visionModel = String(getCaptionVisionModelId() || '').trim();
      if (!setScanState.visionModel) {
        throw new Error('Select an available Vision model before running Set Intelligence.');
      }
      if (!String(getDirectorModelPreference() || '').trim()) {
        throw new Error('Select a Director model before running Set Intelligence.');
      }
      var metadataResult = results[1];
      if (!metadataResult || metadataResult.ok === false) {
        throw new Error((metadataResult && metadataResult.error) || 'Supporting Set analysis failed.');
      }
      if (setScanState.stopRequested) return false;
      visionContext = setIntelligenceVisionContext();
      return scanVision(folder, files, setScanState.visionModel);
    }).then(function (openSuccess) {
      if (openSuccess === false || setScanState.stopRequested) return false;
      return scanContextVision(folder, files, setScanState.visionModel, visionContext);
    }).then(function (visionSuccess) {
      if (visionSuccess === false || setScanState.stopRequested) return false;
      return refreshMediaResolutionCache({
        includeFaceFocus: true,
        includeSelectionPose: true,
        successStatus: 'Set Intelligence is current.'
      }).then(function (result) {
        if (!result || result.ok === false) {
          throw new Error((result && result.error) || 'Set Intelligence refresh failed.');
        }
        return true;
      });
    }).then(function (success) {
      if (success === false || setScanState.stopRequested) {
        setScanState.running = false;
        setScanState.phase = 'idle';
        setSetIntelligenceStatus('Scan stopped', 'Completed understanding remains cached.');
        window.setStatus('Set Intelligence stopped. Completed understanding remains cached.');
        return;
      }
      finishScan('Ready to shape the vocabulary, or skip ahead if this Set is already mature.');
    }).catch(function (err) {
      setScanState.running = false;
      setScanState.currentVisionJobId = '';
      setScanState.phase = 'idle';
      setSetIntelligenceStatus('Set Intelligence unavailable', String(err && err.message ? err.message : err));
      reportConsoleError('Set Intelligence', err);
      window.setStatus('Set Intelligence failed.');
    });
  }

  function stopSetIntelligence() {
    if (!setScanState.running) return;
    setScanState.stopRequested = true;
    var jobId = setScanState.currentVisionJobId;
    setScanState.currentVisionJobId = '';
    setSetIntelligenceStatus('Stopping', 'Completed understanding will remain cached.');
    if (jobId) {
      cancelCaptionAssistJob(jobId).catch(function (err) {
        reportConsoleError('Set Intelligence', err);
      });
    }
  }

  function openSetIntelligence() {
    var folder = String(state && state.folder || '');
    if (!folder || !isSetFolderContext(folder, state && state.items)) {
      window.setStatus('Open a Set before using Set Intelligence.');
      return;
    }
    if (setScanState.folder && setScanState.folder !== folder) {
      setScanState.hasRun = false;
      setScanState.phase = 'idle';
      setScanState.rawResponses = [];
      setScanState.rawResponseIndex = -1;
      setScanState.currentRawResponse = null;
    }
    setScanState.open = true;
    renderSetIntelligence();
    if (!setScanState.hasRun) runSetIntelligence();
  }

  function closeSetIntelligence() {
    if (setScanState.running) stopSetIntelligence();
    setScanState.open = false;
    renderSetIntelligence();
  }

  function continueToVocabulary() {
    closeSetIntelligence();
    openVisionSchemaAssist();
  }

  function continueToGuidedTagging() {
    closeSetIntelligence();
    openGuidedTagPass({ source: 'set' });
  }

  function continueToQa() {
    closeSetIntelligence();
    setWorkspaceSurface('reviewOutput');
    setReviewDetailTab('qa');
  }

  function bindSetIntelligence() {
    var openBtn = el('set-intelligence-open-btn');
    var closeBtn = el('set-scan-close-btn');
    var stopBtn = el('set-scan-stop-btn');
    var rescanBtn = el('set-scan-rescan-btn');
    var responseSelect = el('set-scan-response-select');
    var primaryBtn = el('set-intelligence-primary-btn');
    var guidedBtn = el('set-intelligence-guided-btn');
    var qaBtn = el('set-intelligence-qa-btn');
    var modal = el('set-scan-modal');
    if (!openBtn || !closeBtn || !stopBtn || !rescanBtn || !responseSelect || !primaryBtn || !guidedBtn || !qaBtn || !modal) {
      throw new Error('Set Intelligence controls are missing.');
    }

    openBtn.onclick = openSetIntelligence;
    closeBtn.onclick = closeSetIntelligence;
    stopBtn.onclick = stopSetIntelligence;
    rescanBtn.onclick = runSetIntelligence;
    responseSelect.onchange = selectRawResponse;
    primaryBtn.onclick = continueToVocabulary;
    guidedBtn.onclick = continueToGuidedTagging;
    qaBtn.onclick = continueToQa;

    modal.addEventListener('click', function (event) {
      if (event.target === modal) closeSetIntelligence();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && setScanState.open) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeSetIntelligence();
      }
    }, true);
  }

  window.openSetIntelligence = openSetIntelligence;
  window.stopSetIntelligence = stopSetIntelligence;

  bindSetIntelligence();
})();
