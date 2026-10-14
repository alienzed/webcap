(function () {
  'use strict';

  var setScanState = {
    open: false,
    running: false,
    stopRequested: false,
    folder: '',
    files: [],
    scopeRequestToken: 0,
    visionModel: '',
    currentVisionJobId: '',
    activityId: '',
    activityStartedAt: 0,
    currentRawResponse: null,
    rawResponses: [],
    rawResponseIndex: -1,
    hasRun: false,
    failures: [],
    sightItems: [],
    completed: 0,
    total: 0,
    phase: 'idle',
    coverage: {
      known: false,
      total: 0,
      openCurrent: 0
    }
  };

  function el(id) {
    return document.getElementById(id);
  }

  function getSetIntelligenceScopeFiles() {
    var entireSet = el('set-scan-entire-set');
    if (!entireSet) throw new Error('Set Intelligence scope control is missing.');
    return entireSet.checked ? getCurrentSetMediaFileNames() : getVisibleMediaSelectionForTraining();
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

  function setCoverage(total, current) {
    setScanState.coverage = {
      known: true,
      total: Math.max(0, Number(total) || 0),
      openCurrent: Math.max(0, Number(current) || 0)
    };
  }

  function applyCoveragePayload(payload, scopedTotal) {
    setScanState.sightItems = (payload && payload.open && payload.open.items || []).slice();
    var items = payload && payload.open && Array.isArray(payload.open.items) ? payload.open.items : [];
    setCoverage(scopedTotal, items.filter(function (item) { return !!(item && item.structured); }).length);
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

  function coverageIsUsable() {
    return setScanState.coverage.known && setScanState.coverage.openCurrent > 0;
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
    var forceBtn = el('set-scan-force-btn');
    var forceMode = el('set-scan-force-mode');
    var scopeToggle = el('set-scan-entire-set');
    var scopeSummary = el('set-scan-scope-summary');
    var issues = el('set-scan-issues');
    var issueCount = el('set-scan-issue-count');
    var itemSelect = el('set-scan-item-select');
    var itemRetry = el('set-scan-item-retry');
    var badRetry = el('set-scan-bad-retry');
    var openCard = el('set-scan-open-card');
    var openBadge = el('set-scan-open-badge');
    var openCount = el('set-scan-open-count');
    var openDetail = el('set-scan-open-detail');
    if (
      !modal || !stopBtn || !progressFill || !next || !details || !responseSelect || !output ||
      !reportCount || !rescanBtn || !forceBtn || !forceMode || !scopeToggle || !scopeSummary || !openCard || !openBadge || !openCount || !openDetail
    ) {
      throw new Error('Set Intelligence UI is incomplete.');
    }

    modal.classList.toggle('hidden', !setScanState.open);
    scopeToggle.disabled = setScanState.running;
    var scopeCount = setScanState.running ? setScanState.files.length : getSetIntelligenceScopeFiles().length;
    scopeSummary.textContent = (scopeToggle.checked ? 'Entire Set' : 'Current training selection') +
      ' · ' + String(scopeCount) + ' / ' + String(getCurrentSetMediaFileNames().length) + ' media';
    stopBtn.classList.toggle('hidden', !setScanState.running);
    // Saved partial Sight is useful downstream; do not turn coverage gaps into a wizard gate.
    next.classList.toggle('hidden', setScanState.running || !coverageIsUsable());

    var coverage = setScanState.coverage;
    var totalCoverage = coverage.known ? coverage.total : 0;
    var openMissing = coverage.known ? Math.max(0, totalCoverage - coverage.openCurrent) : 0;
    var actionLabel = '';
    if (!setScanState.running) {
      if (!setScanState.hasRun || !coverage.known) {
        actionLabel = 'Run Set Intelligence';
      } else if (openMissing) {
        actionLabel = 'Resume ' + String(openMissing) + ' Sight';
      } else {
        actionLabel = 'Sight current';
      }
    }
    rescanBtn.classList.toggle('hidden', setScanState.running);
    rescanBtn.disabled = !scopeCount || !!(coverage.known && !openMissing);
    rescanBtn.textContent = actionLabel || 'Run Set Intelligence';
    forceBtn.disabled = setScanState.running || !scopeCount;
    forceMode.disabled = setScanState.running;
    var previousSelection = itemSelect.value;
    var items = setScanState.sightItems;
    var flagged = items.filter(function (item) { return !!item.issue || !item.structured; });
    issues.classList.toggle('hidden', !items.length);
    issueCount.textContent = flagged.length + ' items need attention';
    itemSelect.innerHTML = '';
    items.forEach(function (item) {
      var option = document.createElement('option');
      option.value = item.file;
      option.textContent = item.file + (item.issue ? ' · ' + item.issue : (!item.structured ? ' · Missing Sight' : ''));
      itemSelect.appendChild(option);
    });
    if (items.some(function (item) { return item.file === previousSelection; })) itemSelect.value = previousSelection;
    else if (flagged.length) itemSelect.value = flagged[0].file;
    itemSelect.disabled = setScanState.running;
    itemRetry.disabled = setScanState.running || !items.length;
    badRetry.disabled = setScanState.running || !flagged.length;

    var percent = 0;
    if (setScanState.phase === 'preparing') percent = 8;
    if (setScanState.phase === 'scanning-open') {
      percent = setScanState.total
        ? 10 + Math.round((setScanState.completed / setScanState.total) * 85)
        : 10;
    }
    if (setScanState.phase === 'complete') percent = 100;
    progressFill.style.width = String(percent) + '%';

    if (!coverage.known) {
      setEvidenceCard(openCard, openBadge, openCount, openDetail, 'checking', 'Checking', '—', 'Looking for saved Sight…');
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
          ? 'All media have saved reusable Sight.'
          : String(openMissing) + ' media still need Sight. Saved results will be reused.'
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

  function publishSetIntelligenceActivity(title, message) {
    if (!setScanState.running || !setScanState.activityId) return;
    var total = Number(setScanState.total || 0);
    var completed = Number(setScanState.completed || 0);
    window.publishActivityProgress({
      id: setScanState.activityId,
      kind: 'set-intelligence',
      title: 'Set Intelligence',
      status: setScanState.stopRequested ? 'stopping' : 'running',
      detail: String(message || ''),
      phase: String(title || 'Preparing Sight'),
      progressLabel: total > 0 ? completed + ' / ' + total + ' Sight checks attempted' : '',
      progress: total > 0 ? { completed: completed, total: total } : null,
      childJobId: setScanState.currentVisionJobId,
      startedAt: setScanState.activityStartedAt
    });
  }

  function finishSetIntelligenceActivity(status) {
    if (!setScanState.activityId) return;
    window.finishActivityProgress(setScanState.activityId, status);
    setScanState.activityId = '';
    setScanState.activityStartedAt = 0;
  }

  function setSetIntelligenceStatus(title, message) {
    var stageEl = el('set-scan-stage');
    var statusEl = el('set-scan-status');
    if (!stageEl || !statusEl) throw new Error('Set Intelligence status controls are missing.');
    stageEl.textContent = String(title || '');
    statusEl.textContent = String(message || '');
    renderSetIntelligence();
    publishSetIntelligenceActivity(title, message);
  }

  function showRawResponse(fileName, passLabel, text) {
    var response = {
      file: String(fileName || '') + ' · ' + String(passLabel || 'Vision'),
      text: String(text || '')
    };
    setScanState.rawResponses.push(response);
    setScanState.rawResponseIndex = setScanState.rawResponses.length - 1;
    setScanState.currentRawResponse = response;
    // Raw model output stays opt-in; live progress remains the primary signal.
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
          alias: getRequirementGroupAlias(group),
          terms: getChecklistKeywordTermsForRequirement(group)
        };
      }).filter(function (row) { return !!row.group; }),
      captionTemplate: String(primer && primer.template || '')
    };
  }

  function setCachedReportResponses(payload) {
    var responses = [];
    var items = payload && payload.open && Array.isArray(payload.open.items) ? payload.open.items : [];
    items.forEach(function (item) {
      if (!item) return;
      var attempt = item.attempt;
      if ((!item.structured || item.issue) && attempt && attempt.text) {
        responses.push({file: String(item.file || '') + ' · ' + (item.issue || 'Sight attempt'), text: attempt.text});
      } else if (item.structured && item.sight) {
        responses.push({file: String(item.file || '') + ' · Sight', text: JSON.stringify(item.sight, null, 2)});
      }
    });
    setScanState.rawResponses = responses;
    setScanState.rawResponseIndex = responses.length ? responses.length - 1 : -1;
    setScanState.currentRawResponse = responses.length ? responses[responses.length - 1] : null;
  }

  function requestCachedIntelligenceReport(folder, files, model) {
    return requestJson('/fs/vision_schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'intelligence_report',
        folder: folder,
        visionModel: model,
        files: files
      })
    });
  }

  function restoreCachedIntelligence(folder, files, requestToken) {
    return loadCaptionVisionCapabilities().then(function () {
      if (requestToken !== setScanState.scopeRequestToken || setScanState.running || !setScanState.open) return null;
      var model = String(getCaptionVisionModelId() || '').trim();
      if (!model) return false;
      return requestCachedIntelligenceReport(folder, files, model).then(function (payload) {
        if (requestToken !== setScanState.scopeRequestToken || setScanState.running || !setScanState.open) return null;
        var count = Number(payload && payload.open && payload.open.structured || 0);
        setScanState.folder = folder;
        setScanState.files = files.slice();
        setScanState.visionModel = model;
        setScanState.hasRun = !!count;
        setScanState.running = false;
        setCachedReportResponses(payload);
        applyCoveragePayload(payload, files.length);
        setScanState.phase = count >= files.length ? 'complete' : 'idle';
        if (count >= files.length) {
          setSetIntelligenceStatus('Set understood', 'Cached Sight is available.');
        } else if (count) {
          setSetIntelligenceStatus('Saved intelligence found',
            String(Math.max(0, files.length - count)) + ' media still need Sight.');
        }
        return !!count;
      });
    });
  }

  function publishSetIntelligenceMetadata(folder, media, blockName, block) {
    var expectedFolder = String(folder || '');
    var fileName = String(media || '');
    if (!expectedFolder || !fileName || !block || typeof block !== 'object') {
      throw new Error('Set Intelligence saved evidence is invalid.');
    }
    if (String(state.folder || '') !== expectedFolder) {
      throw new Error('Set changed before saved Set Intelligence evidence could be published.');
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
      publishSetIntelligenceMetadata(folder, media, 'vision_sight', payload.sight);
      return payload;
    });
  }

  function requestSight(folder, model, media, isCancelled, groups) {
    return requestJson('/fs/vision_schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'scan_sight',
        folder: folder,
        visionModel: model,
        media: media,
        existingGroups: groups || []
      })
    }).then(function (payload) {
      if (!payload.job || !payload.job.jobId) {
        throw new Error('Set Intelligence Vision scan did not return a queued job.');
      }
      setScanState.currentVisionJobId = String(payload.job.jobId || '');
      if (setScanState.running) publishSetIntelligenceActivity('Sight', 'Collecting visual evidence…');
      trackTransientLlmJob(payload.job);
      if (isCancelled && isCancelled()) {
        return cancelCaptionAssistJob(setScanState.currentVisionJobId).then(function () {
          throw new Error('Sight refresh cancelled.');
        });
      }
      return waitForCaptionAssistJob(payload.job);
    }).then(function (job) {
      setScanState.currentVisionJobId = '';
      return {
        sight: job && job.result && job.result.sight || null,
        text: String(job && job.result && job.result.text || ''),
        warning: String(job && job.result && job.result.structureWarning || ''),
        finishReason: String(job && job.result && job.result.finishReason || '')
      };
    });
  }

  function saveSightAttempt(folder, model, media, result, issue) {
    return requestJson('/fs/vision_schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'save_sight_attempt', folder: folder, visionModel: model,
        media: media, text: result.text, finishReason: result.finishReason, issue: issue
      })
    });
  }

  function scanNext(pending, index, folder, model, groups) {
    if (setScanState.stopRequested) return Promise.resolve(false);
    if (String(state.folder || '') !== folder) {
      throw new Error('Set changed while Set Intelligence was scanning.');
    }
    if (index >= pending.length) return Promise.resolve(true);

    setScanState.completed = index;
    setSetIntelligenceStatus('Sight',
      String(index + 1) + ' of ' + String(pending.length) + ' · exploring visual details');

    var fileName = pending[index];
    return requestSight(folder, model, fileName, function () { return setScanState.stopRequested; }, groups).then(function (result) {
      if (setScanState.stopRequested) return false;
      showRawResponse(fileName, 'Sight', result.text);
      var issue = result.warning || (result.sight ? '' : 'Unstructured Vision response');
      var save = result.sight ? saveSight(folder, model, fileName, result.sight) : Promise.resolve(null);
      return save.then(function () { return saveSightAttempt(folder, model, fileName, result, issue); })
        .then(function () { return !!result.sight; });
    }).catch(function (err) {
      setScanState.currentVisionJobId = '';
      if (setScanState.stopRequested) return false;
      recordSetIntelligenceFailure('Sight', fileName, err);
      reportConsoleError('Set Intelligence item ' + fileName, err);
      return null;
    }).then(function (saved) {
      if (saved === false || setScanState.stopRequested) return false;
      if (saved) setScanState.coverage.openCurrent = Math.min(
        setScanState.coverage.total, setScanState.coverage.openCurrent + 1);
      setScanState.completed = index + 1;
      publishSetIntelligenceActivity('Sight', 'Saving completed visual evidence…');
      if ((index + 1) % Math.max(1, Math.ceil(pending.length / 10)) === 0 && index + 1 < pending.length) {
        reportConsoleInfo('Set Intelligence', 'Sight: ' + (index + 1) + '/' + pending.length + ' attempted.');
      }
      return scanNext(pending, index + 1, folder, model, groups);
    });
  }

  function scanVision(folder, files, model, force, groups, explicitFiles) {
    return requestJson(
      '/fs/vision_schema?folder=' + encodeURIComponent(folder) + '&model=' + encodeURIComponent(model)
    ).then(function (payload) {
      var wanted = {};
      files.forEach(function (fileName) { wanted[fileName] = true; });
      var scopedItems = (payload.items || []).filter(function (item) {
        return !!wanted[String(item.file || '')];
      });
      var selected = explicitFiles ? new Set(explicitFiles) : null;
      var pending = scopedItems.filter(function (item) {
        return selected ? selected.has(item.file) : (!!force || !item.structured);
      }).map(function (item) { return String(item.file || ''); }).filter(Boolean);

      setCoverage(files.length, scopedItems.filter(function (item) { return !!item.structured; }).length);
      setScanState.total = pending.length;
      setScanState.completed = 0;
      setScanState.phase = 'scanning-open';
      if (!pending.length) {
        reportConsoleInfo('Set Intelligence', 'Sight: reusing existing evidence for ' + files.length + ' items.');
        setScanState.total = 1;
        setScanState.completed = 1;
        setSetIntelligenceStatus('Sight', 'Saved visual understanding is already reusable.');
        return true;
      }
      reportConsoleInfo('Set Intelligence', 'Sight: inspecting ' + pending.length + ' items; reusing ' + (scopedItems.length - pending.length) + '.');
      return scanNext(pending, 0, folder, model, groups);
    });
  }

  function finishScan(message) {
    setScanState.running = false;
    setScanState.currentVisionJobId = '';
    setScanState.phase = setScanState.coverage.openCurrent >= setScanState.coverage.total
      ? 'complete' : 'idle';
    qaInputsUpdated();
    var failureCount = setScanState.failures.length;
    reportConsoleInfo('Set Intelligence', 'Scan finished: ' + setScanState.coverage.openCurrent + '/' + setScanState.coverage.total + ' Sight current; ' + failureCount + ' item failures.');
    if (failureCount) {
      finishSetIntelligenceActivity('completed');
      setSetIntelligenceStatus(
        'Set understood with gaps',
        String(failureCount) + ' Vision item failure' + (failureCount === 1 ? '' : 's') +
        ' occurred. Completed evidence remains usable; see Console for details or Resume the missing coverage.'
      );
      window.setStatus('Set Intelligence completed with ' + String(failureCount) + ' Vision gap' + (failureCount === 1 ? '' : 's') + '.');
      return;
    }
    finishSetIntelligenceActivity('completed');
    setSetIntelligenceStatus('Set understood', message || 'Ready for the next decision.');
    window.setStatus('Set Intelligence is ready.');
  }

  function runSetIntelligence(forceMode, explicitFiles) {
    var selectedMode = typeof forceMode === 'string' ? forceMode : '';
    if (selectedMode && selectedMode !== 'open') {
      throw new Error('Invalid Sight refresh selection.');
    }
    if (setScanState.running) return;
    if (itemSightRefreshActive) {
      window.setStatus('Finish the current item Sight refresh before starting a full Set scan.');
      return;
    }

    var folder = String(state && state.folder || '');
    var scopeFiles = getSetIntelligenceScopeFiles();
    var files = explicitFiles ? scopeFiles.filter(function (file) { return explicitFiles.indexOf(file) !== -1; }) : scopeFiles;
    if (!folder || !isSetFolderContext(folder, state && state.items)) {
      window.setStatus('Open a Set before using Set Intelligence.');
      return;
    }
    if (!files.length) {
      setSetIntelligenceStatus('Empty selection', 'No media match the current selection. Adjust filters or scan the entire Set.');
      return;
    }
    setScanState.scopeRequestToken += 1;

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
    setScanState.activityStartedAt = Date.now() / 1000;
    setScanState.activityId = 'set-intelligence:' + String(Date.now());
    setSetIntelligenceStatus('Understanding Set', 'Preparing ' + String(files.length) + ' media item' + (files.length === 1 ? '' : 's') + '…');
    reportConsoleInfo('Set Intelligence', 'Scan started: ' + files.length + ' visible items; mode ' + (selectedMode || 'missing Sight') + '.');

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
      var metadataResult = results[1];
      if (!metadataResult || metadataResult.ok === false) {
        throw new Error((metadataResult && metadataResult.error) || 'Supporting Set analysis failed.');
      }
      if (setScanState.stopRequested) return false;
      visionContext = setIntelligenceVisionContext();
      return scanVision(folder, files, setScanState.visionModel, !!selectedMode, visionContext.groups, explicitFiles);
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
        return requestCachedIntelligenceReport(folder, scopeFiles, setScanState.visionModel).then(function (payload) {
          setCachedReportResponses(payload);
          applyCoveragePayload(payload, scopeFiles.length);
          return true;
        });
      });
    }).then(function (success) {
      if (success === false || setScanState.stopRequested) {
        setScanState.running = false;
        setScanState.phase = 'idle';
        qaInputsUpdated();
        finishSetIntelligenceActivity('stopped');
        setSetIntelligenceStatus('Scan stopped', 'Completed understanding remains cached.');
        window.setStatus('Set Intelligence stopped. Completed understanding remains cached.');
        reportConsoleInfo('Set Intelligence', 'Scan stopped; saved evidence retained.');
        return;
      }
      finishScan('Ready to shape the vocabulary, or skip ahead if this Set is already mature.');
    }).catch(function (err) {
      setScanState.running = false;
      setScanState.currentVisionJobId = '';
      qaInputsUpdated();
      finishSetIntelligenceActivity('failed');
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
    publishSetIntelligenceActivity('Stopping', 'Completed understanding will remain cached.');
    reportConsoleInfo('Set Intelligence', 'Stop requested.');
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
    var files = setScanState.running ? setScanState.files.slice() : getSetIntelligenceScopeFiles();
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
        openCurrent: 0
      };
      setScanState.rawResponses = [];
      setScanState.rawResponseIndex = -1;
      setScanState.currentRawResponse = null;
    }
    setScanState.open = true;
    if (setScanState.running) {
      renderSetIntelligence();
      return;
    }
    var requestToken = ++setScanState.scopeRequestToken;
    setScanState.files = files.slice();
    setScanState.hasRun = false;
    setScanState.phase = 'idle';
    setScanState.coverage.known = false;
    setScanState.rawResponses = [];
    setScanState.rawResponseIndex = -1;
    setScanState.currentRawResponse = null;
    setScanState.sightItems = [];
    renderSetIntelligence();
    if (!files.length) {
      setCoverage(0, 0);
      setSetIntelligenceStatus('Empty selection', 'No media match the current filters. Adjust filters or scan the entire Set.');
      return;
    }
    setSetIntelligenceStatus('Checking selection', 'Checking saved Sight for ' + String(files.length) + ' selected media…');
    restoreCachedIntelligence(folder, files, requestToken).then(function (restored) {
      if (!setScanState.open || requestToken !== setScanState.scopeRequestToken || restored === null || restored) return;
      setScanState.hasRun = false;
      setScanState.phase = 'idle';
      setSetIntelligenceStatus(
        'Ready to scan',
        'No saved Set Intelligence is available for this Set. Run it when the GPU and selected models are ready.'
      );
    }).catch(function (err) {
      reportConsoleError('Set Intelligence cached report', err);
      if (!setScanState.open || requestToken !== setScanState.scopeRequestToken) return;
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

  function closeSavedIntelligence() {
    el('saved-intelligence-modal').classList.add('hidden');
  }

  function openSavedIntelligenceForMedia(mediaItem) {
    if (!mediaItem || !mediaItem.fileName) throw new Error('Select a media item to view saved intelligence.');
    var modal = el('saved-intelligence-modal');
    var filename = el('saved-intelligence-file');
    var status = el('saved-intelligence-status');
    var output = el('saved-intelligence-output');
    if (!modal || !filename || !status || !output) throw new Error('Saved Intelligence UI is incomplete.');

    filename.textContent = mediaItem.fileName;
    var sight = mediaItem.metadata && mediaItem.metadata.vision_sight;
    if (sight && typeof sight === 'object' && String(sight.description || '').trim()) {
      status.textContent = 'Cached Sight' + (sight.model ? ' · ' + sight.model : '');
      output.textContent = JSON.stringify({
        description: String(sight.description || ''),
        inventory: sight.inventory && typeof sight.inventory === 'object' ? sight.inventory : {}
      }, null, 2);
    } else {
      status.textContent = 'No saved Sight';
      output.textContent = isMediaMetadataLoading()
        ? 'Metadata is still loading. Reopen this view when loading finishes.'
        : 'No Sight has been saved for this item. Run Set Intelligence to collect it.';
    }
    modal.classList.remove('hidden');
    el('saved-intelligence-close-btn').focus();
  }

  function bindSetIntelligence() {
    var openBtn = el('set-intelligence-open-btn');
    var closeBtn = el('set-scan-close-btn');
    var stopBtn = el('set-scan-stop-btn');
    var rescanBtn = el('set-scan-rescan-btn');
    var forceBtn = el('set-scan-force-btn');
    var forceMode = el('set-scan-force-mode');
    var entireSetToggle = el('set-scan-entire-set');
    var responseSelect = el('set-scan-response-select');
    var primaryBtn = el('set-intelligence-primary-btn');
    var guidedBtn = el('set-intelligence-guided-btn');
    var qaBtn = el('set-intelligence-qa-btn');
    var modal = el('set-scan-modal');
    var savedModal = el('saved-intelligence-modal');
    var savedCloseBtn = el('saved-intelligence-close-btn');
    if (!savedModal || !savedCloseBtn) throw new Error('Saved Intelligence controls are missing.');
    if (!openBtn || !closeBtn || !stopBtn || !rescanBtn || !forceBtn || !forceMode || !entireSetToggle || !responseSelect || !primaryBtn || !guidedBtn || !qaBtn || !modal) {
      throw new Error('Set Intelligence controls are missing.');
    }

    openBtn.onclick = openSetIntelligence;
    closeBtn.onclick = closeSetIntelligence;
    stopBtn.onclick = stopSetIntelligence;
    rescanBtn.onclick = function () { runSetIntelligence(); };
    forceBtn.onclick = function () { runSetIntelligence(forceMode.value); };
    el('set-scan-item-retry').onclick = function () {
      var file = el('set-scan-item-select').value;
      if (file) runSetIntelligence('open', [file]);
    };
    el('set-scan-bad-retry').onclick = function () {
      var files = setScanState.sightItems.filter(function (item) { return !!item.issue || !item.structured; }).map(function (item) { return item.file; });
      if (files.length) runSetIntelligence('open', files);
    };
    entireSetToggle.onchange = openSetIntelligence;
    responseSelect.onchange = selectRawResponse;
    primaryBtn.onclick = continueToVocabulary;
    guidedBtn.onclick = continueToGuidedTagging;
    qaBtn.onclick = continueToQa;

    modal.addEventListener('click', function (event) {
      if (event.target === modal) closeSetIntelligence();
    });
    savedCloseBtn.onclick = closeSavedIntelligence;
    savedModal.addEventListener('click', function (event) {
      if (event.target === savedModal) closeSavedIntelligence();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !savedModal.classList.contains('hidden')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeSavedIntelligence();
      }
    }, true);
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

  // Explicit item-level refresh, independent of the full-Set workflow.
  // Each valid observation is saved immediately; failed reads keep older evidence.
  var itemSightRefreshActive = false;
  function refreshSetIntelligenceItem(mediaItem, options) {
    var opts = options || {};
    if (opts.isCancelled && opts.isCancelled()) return Promise.resolve(false);
    if (!mediaItem || !mediaItem.fileName) return Promise.reject(new Error('Select a media item to refresh Sight.'));
    if (setScanState.running || itemSightRefreshActive) {
      return Promise.reject(new Error('A Sight scan is already running.'));
    }
    var folder = String(state.folder || '');
    var file = String(mediaItem.fileName);
    var model = String(getCaptionVisionModelId() || '').trim();
    if (!folder || !model) return Promise.reject(new Error('Select a Set and Vision model first.'));
    var groups = setIntelligenceVisionContext().groups;
    var shouldScan = opts.open !== false;
    itemSightRefreshActive = true;
    return Promise.resolve().then(function () {
      if (opts.open !== 'missing') return null;
      return requestJson('/fs/vision_schema?folder=' + encodeURIComponent(folder) + '&model=' + encodeURIComponent(model))
        .then(function (report) {
          var row = (report.items || []).find(function (entry) { return entry.file === file; });
          if (!row) throw new Error('Sight status did not include ' + file + '.');
          shouldScan = !row.structured;
        });
    }).then(function () {
      if (opts.isCancelled && opts.isCancelled()) return false;
      if (!shouldScan) return true;
      return requestSight(folder, model, file, opts.isCancelled, groups).then(function (result) {
        if (opts.isCancelled && opts.isCancelled()) return false;
        if (!result.sight) throw new Error(result.warning || 'Sight returned no structured observation.');
        return saveSight(folder, model, file, result.sight).then(function () {
          if (result.warning) reportConsoleWarning('Sight refresh ' + file, result.warning);
          if (!opts.silent) window.setStatus('Sight refreshed for ' + file + '.');
          return true;
        });
      });
    }).catch(function (err) {
      if (opts.isCancelled && opts.isCancelled()) return false;
      reportConsoleError('Sight refresh ' + file, err);
      if (!opts.allowOpenFailure) throw err;
      if (!opts.silent) window.setStatus('Sight unavailable for ' + file + '; continuing without it (see Console).');
      return true;
    }).finally(function () {
      setScanState.currentVisionJobId = '';
      itemSightRefreshActive = false;
    });
  }

  function cancelItemSightRefresh() {
    if (!itemSightRefreshActive) return Promise.resolve(false);
    var jobId = setScanState.currentVisionJobId;
    if (!jobId) return Promise.resolve(false);
    return cancelCaptionAssistJob(jobId);
  }

  window.cancelItemSightRefresh = cancelItemSightRefresh;
  window.refreshSetIntelligenceItem = refreshSetIntelligenceItem;
  window.openSavedIntelligenceForMedia = openSavedIntelligenceForMedia;
  window.openSetIntelligence = openSetIntelligence;
  window.stopSetIntelligence = stopSetIntelligence;
  window.isSetIntelligenceRunning = isSetIntelligenceRunning;

  bindSetIntelligence();
})();
