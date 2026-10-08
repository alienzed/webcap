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
    failures: [],
    completed: 0,
    total: 0,
    phase: 'idle',
    coverage: {
      known: false,
      total: 0,
      openCurrent: 0,
      contextCurrent: 0,
      contextAvailable: 0,
      contextRequired: true
    }
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

  function setCoverage(total, openCurrent, contextCurrent, contextAvailable, contextRequired) {
    setScanState.coverage = {
      known: true,
      total: Math.max(0, Number(total) || 0),
      openCurrent: Math.max(0, Number(openCurrent) || 0),
      contextCurrent: Math.max(0, Number(contextCurrent) || 0),
      contextAvailable: Math.max(0, Number(contextAvailable) || 0),
      contextRequired: contextRequired === undefined
        ? setScanState.coverage.contextRequired !== false
        : !!contextRequired
    };
  }

  function applyCoveragePayload(payload, scopedTotal, contextRequired) {
    var openItems = payload && payload.open && Array.isArray(payload.open.items) ? payload.open.items : [];
    var contextItems = payload && payload.context && Array.isArray(payload.context.items) ? payload.context.items : [];
    var total = Number(scopedTotal);
    if (!Number.isFinite(total)) total = Math.max(openItems.length, contextItems.length);
    var openCurrent = openItems.filter(function (item) { return !!(item && item.structured); }).length;
    var contextCurrent = contextItems.filter(function (item) { return !!(item && item.cached); }).length;
    var contextAvailable = contextItems.filter(function (item) { return !!(item && item.available); }).length;
    setCoverage(total, openCurrent, contextCurrent, contextAvailable, contextRequired);
  }

  function setEvidenceCard(card, badge, count, detail, stateName, badgeText, countText, detailText) {
    ['current', 'partial', 'stale', 'missing', 'running', 'checking'].forEach(function (name) {
      card.classList.toggle('is-' + name, name === stateName);
      badge.classList.toggle('is-' + name, name === stateName);
    });
    badge.textContent = badgeText;
    count.textContent = countText;
    detail.textContent = detailText;
  }

  function renderSetIntelligence() {
    var modal = el('set-scan-modal');
    var stopBtn = el('set-scan-stop-btn');
    var progressFill = el('set-scan-progress-fill');
    var next = el('set-intelligence-next');
    var details = el('set-scan-details');
    var responseSelect = el('set-scan-response-select');
    var output = el('set-scan-raw-output');
    var reportCount = el('set-scan-report-count');
    var rescanBtn = el('set-scan-rescan-btn');
    var openCard = el('set-scan-open-card');
    var openBadge = el('set-scan-open-badge');
    var openCount = el('set-scan-open-count');
    var openDetail = el('set-scan-open-detail');
    var contextCard = el('set-scan-context-card');
    var contextBadge = el('set-scan-context-badge');
    var contextCount = el('set-scan-context-count');
    var contextDetail = el('set-scan-context-detail');
    if (
      !modal || !stopBtn || !progressFill || !next || !details || !responseSelect || !output ||
      !reportCount || !rescanBtn || !openCard || !openBadge || !openCount || !openDetail ||
      !contextCard || !contextBadge || !contextCount || !contextDetail
    ) {
      throw new Error('Set Intelligence UI is incomplete.');
    }

    modal.classList.toggle('hidden', !setScanState.open);
    stopBtn.classList.toggle('hidden', !setScanState.running);
    next.classList.toggle('hidden', setScanState.phase !== 'complete');

    var coverage = setScanState.coverage;
    var totalCoverage = coverage.known ? coverage.total : 0;
    var openMissing = coverage.known ? Math.max(0, totalCoverage - coverage.openCurrent) : 0;
    var contextMissing = coverage.known && coverage.contextRequired
      ? Math.max(0, totalCoverage - coverage.contextAvailable)
      : 0;
    var contextStale = coverage.known && coverage.contextRequired
      ? Math.max(0, coverage.contextAvailable - coverage.contextCurrent)
      : 0;
    var actionLabel = '';
    if (!setScanState.running) {
      if (!setScanState.hasRun || !coverage.known) {
        actionLabel = 'Run Set Intelligence';
      } else if (openMissing) {
        actionLabel = 'Resume ' + String(openMissing) + ' Open Sight';
      } else if (contextMissing) {
        actionLabel = 'Resume ' + String(contextMissing) + ' Context Sight';
      } else if (contextStale) {
        actionLabel = 'Refresh ' + String(contextStale) + ' Context Sight';
      } else {
        actionLabel = 'Refresh Set Intelligence';
      }
    }
    rescanBtn.classList.toggle('hidden', setScanState.running);
    rescanBtn.textContent = actionLabel || 'Run Set Intelligence';

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

    if (!coverage.known) {
      setEvidenceCard(openCard, openBadge, openCount, openDetail, 'checking', 'Checking', '—', 'Looking for saved Open Sight…');
      setEvidenceCard(contextCard, contextBadge, contextCount, contextDetail, 'checking', 'Checking', '—', 'Looking for saved Context Sight…');
    } else {
      var openState = coverage.openCurrent >= totalCoverage
        ? 'current'
        : (coverage.openCurrent ? 'partial' : 'missing');
      if (setScanState.phase === 'scanning-open') openState = 'running';
      setEvidenceCard(
        openCard,
        openBadge,
        openCount,
        openDetail,
        openState,
        openState === 'current' ? 'Current' : (openState === 'running' ? 'Scanning' : (coverage.openCurrent ? 'Partial' : 'Missing')),
        String(coverage.openCurrent) + ' / ' + String(totalCoverage),
        coverage.openCurrent >= totalCoverage
          ? 'All media have saved reusable Open Sight.'
          : String(openMissing) + ' media still need Open Sight. Saved results will be reused.'
      );

      var contextState = 'missing';
      var contextBadgeText = 'Missing';
      var contextDetailText = '';
      var contextCountText = String(coverage.contextCurrent) + ' / ' + String(totalCoverage);
      if (!coverage.contextRequired) {
        contextState = 'current';
        contextBadgeText = 'Not required';
        contextCountText = '—';
        contextDetailText = 'No annotation groups are configured, so Context Sight is skipped.';
      } else if (coverage.contextCurrent >= totalCoverage) {
        contextState = 'current';
        contextBadgeText = 'Current';
        contextDetailText = 'All Context Sight matches the current vocabulary and caption template.';
      } else if (setScanState.phase === 'scanning-context') {
        contextState = 'running';
        contextBadgeText = 'Scanning';
      } else if (contextStale) {
        contextState = 'stale';
        contextBadgeText = 'Refresh needed';
      } else if (coverage.contextCurrent) {
        contextState = 'partial';
        contextBadgeText = 'Partial';
      }
      if (!contextDetailText) {
        var contextParts = [
          String(coverage.contextCurrent) + ' current'
        ];
        if (contextStale) contextParts.push(String(contextStale) + ' saved but stale');
        if (contextMissing) contextParts.push(String(contextMissing) + ' missing');
        contextDetailText = contextParts.join(' · ') + '.';
      }
      setEvidenceCard(
        contextCard,
        contextBadge,
        contextCount,
        contextDetail,
        contextState,
        contextBadgeText,
        contextCountText,
        contextDetailText
      );
    }

    var responses = Array.isArray(setScanState.rawResponses) ? setScanState.rawResponses : [];
    var currentRaw = responses[setScanState.rawResponseIndex] || null;
    setScanState.currentRawResponse = currentRaw;
    details.classList.toggle('hidden', !responses.length);
    reportCount.textContent = String(responses.length) + ' saved response' + (responses.length === 1 ? '' : 's');
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

  function recordSetIntelligenceFailure(passLabel, fileName, error) {
    var message = String(error && error.message ? error.message : error || 'Unknown Vision failure.');
    setScanState.failures.push({
      pass: String(passLabel || 'Vision'),
      file: String(fileName || ''),
      message: message
    });
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

  function setCachedReportResponses(payload) {
    var responses = [];
    var openItems = payload && payload.open && Array.isArray(payload.open.items) ? payload.open.items : [];
    openItems.forEach(function (item) {
      if (!item || !item.structured || !item.sight) return;
      responses.push({
        file: String(item.file || '') + ' · Open Sight',
        text: JSON.stringify(item.sight, null, 2)
      });
    });
    var contextRecords = payload && payload.context && Array.isArray(payload.context.records)
      ? payload.context.records
      : [];
    contextRecords.forEach(function (record) {
      if (!record || !record.file) return;
      responses.push({
        file: String(record.file || '') + ' · Context Sight',
        text: JSON.stringify({
          caption: String(record.caption || ''),
          matches: Array.isArray(record.matches) ? record.matches : [],
          diagnostics: record.diagnostics && typeof record.diagnostics === 'object' ? record.diagnostics : {}
        }, null, 2)
      });
    });
    setScanState.rawResponses = responses;
    setScanState.rawResponseIndex = responses.length ? responses.length - 1 : -1;
    setScanState.currentRawResponse = responses.length ? responses[responses.length - 1] : null;
  }

  function requestCachedIntelligenceReport(folder, files, model, context) {
    return requestJson('/fs/vision_schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'intelligence_report',
        folder: folder,
        visionModel: model,
        files: files,
        existingGroups: context.groups,
        captionTemplate: context.captionTemplate
      })
    });
  }

  function restoreCachedIntelligence(folder, files) {
    return loadCaptionVisionCapabilities().then(function () {
      var model = String(getCaptionVisionModelId() || '').trim();
      if (!model) return false;
      var context = setIntelligenceVisionContext();
      return requestCachedIntelligenceReport(folder, files, model, context).then(function (payload) {
        var openCount = Number(payload && payload.open && payload.open.structured || 0);
        var contextAvailable = Number(payload && payload.context && payload.context.available || 0);
        if (!openCount && !contextAvailable) {
          setScanState.folder = folder;
          setScanState.files = files.slice();
          setScanState.visionModel = model;
          setScanState.hasRun = false;
          setScanState.running = false;
          setCachedReportResponses(payload);
          applyCoveragePayload(payload, files.length, context.groups.length > 0);
          setScanState.phase = 'idle';
          return false;
        }
        setScanState.folder = folder;
        setScanState.files = files.slice();
        setScanState.visionModel = model;
        setScanState.hasRun = true;
        setScanState.running = false;
        setCachedReportResponses(payload);
        applyCoveragePayload(payload, files.length, context.groups.length > 0);
        var complete = openCount >= files.length && (
          !context.groups.length ||
          Number(payload && payload.context && payload.context.cached || 0) >= files.length
        );
        setScanState.phase = complete ? 'complete' : 'idle';
        if (complete) {
          setSetIntelligenceStatus('Set understood', 'Cached two-pass Set Intelligence is current. Review the report or continue.');
        } else {
          var currentContext = Number(payload && payload.context && payload.context.cached || 0);
          var staleContext = Math.max(0, contextAvailable - currentContext);
          var missingContext = Math.max(0, files.length - contextAvailable);
          var remaining = [];
          if (openCount < files.length) remaining.push(String(files.length - openCount) + ' Open Sight missing');
          if (staleContext) remaining.push(String(staleContext) + ' Context Sight stale');
          if (missingContext) remaining.push(String(missingContext) + ' Context Sight missing');
          setSetIntelligenceStatus(
            'Saved intelligence found',
            remaining.join(' · ') + '. Resume only what is missing or stale.'
          );
        }
        return true;
      });
    });
  }

  function publishSetIntelligenceMetadata(media, blockName, block) {
    var fileName = String(media || '');
    if (!fileName || !block || typeof block !== 'object') {
      throw new Error('Set Intelligence saved evidence is invalid.');
    }
    var item = (state.items || []).find(function (candidate) {
      return candidate && String(candidate.fileName || '') === fileName;
    });
    if (!item) {
      throw new Error('Set Intelligence could not publish saved evidence for ' + fileName + '.');
    }
    if (!item.metadata || typeof item.metadata !== 'object') item.metadata = {};
    item.metadata[blockName] = block;
    if (
      state.currentItem &&
      state.currentItem !== item &&
      String(state.currentItem.fileName || '') === fileName
    ) {
      if (!state.currentItem.metadata || typeof state.currentItem.metadata !== 'object') {
        state.currentItem.metadata = {};
      }
      state.currentItem.metadata[blockName] = block;
    }
    qaInputsUpdated();
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
    }).then(function (payload) {
      publishSetIntelligenceMetadata(media, 'vision_sight', payload.sight);
      return payload;
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
    }).then(function (payload) {
      publishSetIntelligenceMetadata(media, 'vision_vocabulary_sight', payload.sight);
      return payload;
    });
  }

  function scanNext(pending, index, folder, model) {
    if (setScanState.stopRequested) return Promise.resolve(false);
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
      recordSetIntelligenceFailure('Open Sight', fileName, err);
      reportConsoleError('Set Intelligence item ' + fileName, err);
      return null;
    }).then(function (result) {
      if (result === false || setScanState.stopRequested) return false;
      if (!result) return true;
      showRawResponse(fileName, 'Open Sight', result.text);
      if (!result.sight) {
        var sightError = new Error(result.warning || ('Vision returned unstructured evidence for ' + fileName + '.'));
        recordSetIntelligenceFailure('Open Sight', fileName, sightError);
        reportConsoleError('Set Intelligence', sightError);
        return true;
      }
      return saveSight(folder, model, fileName, result.sight);
    }).then(function (saved) {
      if (saved === false || setScanState.stopRequested) return false;
      setScanState.coverage.openCurrent = Math.min(
        setScanState.coverage.total,
        setScanState.coverage.openCurrent + 1
      );
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
      var scopedItems = (payload.items || []).filter(function (item) {
        return !!wanted[String(item.file || '')];
      });
      var pending = scopedItems.filter(function (item) {
        return !item.structured;
      }).map(function (item) {
        return String(item.file || '');
      }).filter(Boolean);

      setCoverage(
        files.length,
        scopedItems.filter(function (item) { return !!item.structured; }).length,
        setScanState.coverage.known ? setScanState.coverage.contextCurrent : 0,
        setScanState.coverage.known ? setScanState.coverage.contextAvailable : 0,
        setScanState.coverage.contextRequired
      );
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
    if (setScanState.stopRequested) return Promise.resolve(false);
    if (String(state.folder || '') !== folder) {
      throw new Error('Set changed while Context Sight was scanning.');
    }
    if (index >= pending.length) return Promise.resolve(true);

    setScanState.completed = index;
    setSetIntelligenceStatus(
      'Context Sight',
      String(index + 1) + ' of ' + String(pending.length) + ' · refreshing only missing or stale Context Sight'
    );

    var pendingItem = pending[index];
    var fileName = pendingItem.file;
    return requestContextSight(folder, model, fileName, context).catch(function (err) {
      setScanState.currentVisionJobId = '';
      if (setScanState.stopRequested) return false;
      recordSetIntelligenceFailure('Context Sight', fileName, err);
      reportConsoleError('Set Intelligence Context Sight ' + fileName, err);
      return null;
    }).then(function (result) {
      if (result === false || setScanState.stopRequested) return false;
      if (!result) return true;
      showRawResponse(fileName, 'Context Sight', result.text);
      if (!result.sight) {
        var contextError = new Error(result.warning || ('Vision returned unstructured Context Sight for ' + fileName + '.'));
        recordSetIntelligenceFailure('Context Sight', fileName, contextError);
        reportConsoleError('Set Intelligence', contextError);
        return true;
      }
      return saveContextSight(folder, model, fileName, context, result.sight);
    }).then(function (saved) {
      if (saved === false || setScanState.stopRequested) return false;
      setScanState.coverage.contextCurrent = Math.min(
        setScanState.coverage.total,
        setScanState.coverage.contextCurrent + 1
      );
      if (!pendingItem.available) {
        setScanState.coverage.contextAvailable = Math.min(
          setScanState.coverage.total,
          setScanState.coverage.contextAvailable + 1
        );
      }
      setScanState.completed = index + 1;
      return scanContextNext(pending, index + 1, folder, model, context);
    });
  }

  function scanContextVision(folder, files, model, context) {
    setScanState.phase = 'scanning-context';
    if (!context.groups.length) {
      setScanState.coverage.contextRequired = false;
      setScanState.coverage.contextCurrent = 0;
      setScanState.coverage.contextAvailable = 0;
      setScanState.total = 1;
      setScanState.completed = 1;
      setSetIntelligenceStatus('Context Sight', 'No annotation groups are configured, so the second visual read is skipped.');
      return Promise.resolve(true);
    }
    setScanState.coverage.contextRequired = true;
    return requestContextStatus(folder, model, context).then(function (payload) {
      var wanted = {};
      files.forEach(function (fileName) { wanted[fileName] = true; });
      var scopedItems = (payload.items || []).filter(function (item) {
        return !!wanted[String(item.file || '')];
      });
      var pending = scopedItems.filter(function (item) {
        return !item.cached;
      }).map(function (item) {
        return {
          file: String(item.file || ''),
          available: !!item.available
        };
      }).filter(function (item) { return !!item.file; });

      setCoverage(
        files.length,
        setScanState.coverage.known ? setScanState.coverage.openCurrent : files.length,
        scopedItems.filter(function (item) { return !!item.cached; }).length,
        scopedItems.filter(function (item) { return !!item.available; }).length,
        true
      );
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
    qaInputsUpdated();
    var failureCount = setScanState.failures.length;
    if (failureCount) {
      setSetIntelligenceStatus(
        'Set understood with gaps',
        String(failureCount) + ' Vision item failure' + (failureCount === 1 ? '' : 's') +
        ' occurred. Completed evidence remains usable; see Console for details or Resume the missing coverage.'
      );
      window.setStatus('Set Intelligence completed with ' + String(failureCount) + ' Vision gap' + (failureCount === 1 ? '' : 's') + '.');
      return;
    }
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

    var previousReport = {
      hasRun: setScanState.hasRun,
      phase: setScanState.phase,
      rawResponses: setScanState.rawResponses.slice(),
      rawResponseIndex: setScanState.rawResponseIndex,
      currentRawResponse: setScanState.currentRawResponse,
      coverage: Object.assign({}, setScanState.coverage)
    };

    setScanState.folder = folder;
    setScanState.files = files.slice();
    setScanState.visionModel = '';
    setScanState.running = true;
    setScanState.hasRun = true;
    setScanState.failures = [];
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
        return requestCachedIntelligenceReport(
          folder,
          files,
          setScanState.visionModel,
          visionContext
        ).then(function (payload) {
          setCachedReportResponses(payload);
          applyCoveragePayload(payload, files.length, visionContext.groups.length > 0);
          return true;
        });
      });
    }).then(function (success) {
      if (success === false || setScanState.stopRequested) {
        setScanState.running = false;
        setScanState.phase = 'idle';
        qaInputsUpdated();
        setSetIntelligenceStatus('Scan stopped', 'Completed understanding remains cached.');
        window.setStatus('Set Intelligence stopped. Completed understanding remains cached.');
        return;
      }
      finishScan('Ready to shape the vocabulary, or skip ahead if this Set is already mature.');
    }).catch(function (err) {
      setScanState.running = false;
      setScanState.currentVisionJobId = '';
      qaInputsUpdated();
      if (previousReport.hasRun) {
        setScanState.hasRun = true;
        setScanState.phase = previousReport.phase;
        setScanState.rawResponses = previousReport.rawResponses;
        setScanState.rawResponseIndex = previousReport.rawResponseIndex;
        setScanState.currentRawResponse = previousReport.currentRawResponse;
        setScanState.coverage = previousReport.coverage;
        setSetIntelligenceStatus(
          'Set Intelligence refresh failed',
          String(err && err.message ? err.message : err) + ' Previous report preserved.'
        );
      } else {
        setScanState.hasRun = false;
        setScanState.phase = 'idle';
        setSetIntelligenceStatus('Set Intelligence unavailable', String(err && err.message ? err.message : err));
      }
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
    var files = getCurrentSetMediaFileNames();
    if (!folder || !isSetFolderContext(folder, state && state.items)) {
      window.setStatus('Open a Set before using Set Intelligence.');
      return;
    }
    if (setScanState.folder && setScanState.folder !== folder) {
      setScanState.hasRun = false;
      setScanState.phase = 'idle';
      setScanState.coverage = {
        known: false,
        total: 0,
        openCurrent: 0,
        contextCurrent: 0,
        contextAvailable: 0,
        contextRequired: true
      };
      setScanState.rawResponses = [];
      setScanState.rawResponseIndex = -1;
      setScanState.currentRawResponse = null;
    }
    setScanState.open = true;
    renderSetIntelligence();

    setSetIntelligenceStatus('Checking Set', 'Checking saved Open Sight and Context Sight against the current Set…');
    restoreCachedIntelligence(folder, files).then(function (restored) {
      if (!setScanState.open || restored) return;
      setScanState.hasRun = false;
      setScanState.phase = 'idle';
      setSetIntelligenceStatus(
        'Ready to scan',
        'No saved Set Intelligence is available for this Set. Run it when the GPU and selected models are ready.'
      );
    }).catch(function (err) {
      reportConsoleError('Set Intelligence cached report', err);
      if (!setScanState.open) return;
      setScanState.hasRun = false;
      setScanState.phase = 'idle';
      setSetIntelligenceStatus(
        'Ready to scan',
        'Saved intelligence could not be checked. Run Set Intelligence when you are ready; opening this view does not start model work.'
      );
    });
  }

  function closeSetIntelligence() {
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

  function isSetIntelligenceRunning() {
    return !!setScanState.running;
  }

  window.openSetIntelligence = openSetIntelligence;
  window.stopSetIntelligence = stopSetIntelligence;
  window.isSetIntelligenceRunning = isSetIntelligenceRunning;

  bindSetIntelligence();
})();
