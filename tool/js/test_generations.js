(function () {
  var supportedTestModelIds = [];
  var supportedTestModels = {};
  var testModelsLoaded = false;
  var pollTimer = null;
  var lastActivityRefreshAt = 0;
  var lastSessionsRefreshAt = 0;
  var prepared = null;
  var launchFolder = '';
  var currentSession = '';
  var currentSessionFolder = '';
  var currentSessionModel = '';
  var currentSessionSource = '';
  var currentStatus = {};
  var resultsView = 'grid';
  var compareIndex = 0;
  var pendingActivityFolder = '';
  var pendingRatingFolder = '';
  var pendingRatingReturn = null;
  var testActivity = {};
  var selectedCandidates = null;
  var testSource = null;
  var pendingTestSource = null;
  var pendingSourceOwnerFolder = '';
  var sourceBrowser = null;
  var queuedTestJobs = [];
  var showSessionError = false;
  var reportedFailureKeys = new Set();
  var debouncedPromptSave = debounceCreate(500);

  function el(id) { return document.getElementById(id); }

  function owningSetFolder(folder) {
    var value = String(folder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    var marker = '/test-generations/';
    var index = value.indexOf(marker);
    return index === -1 ? value : value.slice(0, index);
  }

  function setFolderName(folder) {
    var parts = String(owningSetFolder(folder) || '').split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }

  function sourceChildPath(parent, child) {
    return [String(parent || '').replace(/^\/+|\/+$/g, ''), String(child || '').replace(/^\/+|\/+$/g, '')]
      .filter(Boolean)
      .join('/');
  }

  function renderTestSourceBrowser(payload) {
    sourceBrowser = payload || {};
    var pathEl = el('test-generations-source-path');
    var up = el('test-generations-source-up-btn');
    var host = el('test-generations-source-folders');
    var source = String(sourceBrowser.source || '');
    if (pathEl) {
      pathEl.textContent = source || 'Test root';
      pathEl.title = source || 'Test root';
    }
    if (up) {
      up.disabled = !source;
      up.dataset.sourceParent = String(sourceBrowser.parent || '');
    }
    if (!host) return;
    host.innerHTML = '';
    (Array.isArray(sourceBrowser.folders) ? sourceBrowser.folders : []).forEach(function (folderName) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'test-generations-source-folder';
      button.dataset.testSource = sourceChildPath(source, folderName);
      var label = document.createElement('span');
      label.className = 'test-generations-source-folder-name';
      label.textContent = folderName;
      button.appendChild(label);
      host.appendChild(button);
    });
  }

  function refreshTestSourceBrowser() {
    if (!isTestModelSupported()) return Promise.resolve(null);
    var url = '/fs/test_generations/source?modelId=' + encodeURIComponent(currentTestModelId());
    if (testSource === null) {
      url += '&setName=' + encodeURIComponent(setFolderName(launchFolder));
    } else {
      url += '&source=' + encodeURIComponent(String(testSource || ''));
    }
    return fetch(url).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.ok === false) {
          throw new Error(payload && payload.error ? payload.error : 'Could not browse Test Sources.');
        }
        testSource = String(payload.source || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        renderTestSourceBrowser(payload);
        var ownerFolder = String(payload.ownerFolder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        var currentFolder = String(state && state.folder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        if (ownerFolder && ownerFolder !== currentFolder) {
          pendingSourceOwnerFolder = ownerFolder;
          pendingTestSource = testSource;
          openTrainingWorkspaceFolder(ownerFolder);
          return { navigated: true };
        }
        pendingSourceOwnerFolder = '';
        return payload;
      });
    });
  }

  function chooseTestSource(source) {
    testSource = String(source || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    pendingTestSource = testSource;
    currentSession = '';
    currentSessionFolder = '';
    currentSessionModel = '';
    currentSessionSource = '';
    selectedCandidates = null;
    openPane();
  }

  function request(operation, criteria) {
    var body = {
      folder: owningSetFolder(launchFolder || (state && state.folder) || ''),
      operation: operation
    };
    var resolvedCriteria = criteria ? Object.assign({}, criteria) : {};
    if (testSource !== null && !Object.prototype.hasOwnProperty.call(resolvedCriteria, 'source')) {
      resolvedCriteria.source = String(testSource || '');
    }
    if (Object.keys(resolvedCriteria).length) body.criteria = resolvedCriteria;
    return fetch('/fs/test_generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.ok === false) {
          throw new Error(payload && payload.error ? payload.error : 'Test Generations request failed.');
        }
        return payload;
      });
    });
  }

  function pane() { return el('test-generations-pane'); }

  function syncTestRailCollapseUi() {
    var body = el('test-generations-body');
    var toggle = el('test-generations-rail-toggle-btn');
    if (!body || !toggle) throw new Error('Test Generations requires its sidebar collapse controls.');
    var collapsed = body.classList.contains('test-generations-rail-collapsed');
    toggle.textContent = collapsed ? '>' : '<';
    toggle.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    toggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    toggle.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
  }

  function toggleTestRailCollapsed() {
    var body = el('test-generations-body');
    if (!body) throw new Error('Test Generations requires its sidebar container.');
    body.classList.toggle('test-generations-rail-collapsed');
    syncTestRailCollapseUi();
  }

  function currentTestModelId() {
    return String(getWorkingModelProfileId() || '');
  }

  function testPromptDraftKey() {
    var modelId = currentTestModelId();
    if (!modelId || testSource === null) return '';
    return 'webcap.test.promptDraft.' + encodeURIComponent(modelId) + '.' + encodeURIComponent(String(testSource || ''));
  }

  function loadTestPromptDraft() {
    var key = testPromptDraftKey();
    if (!key) return null;
    var value = window.localStorage.getItem(key);
    return value === null ? null : String(value);
  }

  function saveTestPromptDraft(prompt) {
    var key = testPromptDraftKey();
    if (!key) return;
    window.localStorage.setItem(key, String(prompt == null ? '' : prompt));
  }

  function savedTestModelState() {
    var modelId = currentTestModelId();
    var byModel = state && state.testGenerationByModel && typeof state.testGenerationByModel === 'object'
      ? state.testGenerationByModel
      : {};
    var saved = byModel[modelId];
    if (saved && typeof saved === 'object') {
      return {
        prompt: String(saved.prompt || ''),
        settings: saved.settings && typeof saved.settings === 'object'
          ? saved.settings
          : {}
      };
    }
    var model = supportedTestModels[modelId] || {};
    if (model.default === true) {
      return {
        prompt: String(state && state.testGenerationPrompt || ''),
        settings: state && state.testGenerationSettings && typeof state.testGenerationSettings === 'object'
          ? state.testGenerationSettings
          : {}
      };
    }
    return { prompt: '', settings: {} };
  }

  function currentPersistedSettings() {
    return {
      aspectRatio: String(el('test-generations-aspect') && el('test-generations-aspect').value || '').trim(),
      megapixels: Number(el('test-generations-megapixels') && el('test-generations-megapixels').value || 0),
      duration: Number(el('test-generations-duration') && el('test-generations-duration').value || 0),
      dimensions: String(el('test-generations-dimensions') && el('test-generations-dimensions').value || ''),
      selectedFiles: selectedCandidateFiles(),
      includeBase: !el('test-generations-base-include') || el('test-generations-base-include').checked
    };
  }

  function captureTestBenchSave(prompt) {
    if (!state || String(state.folder || '') !== String(launchFolder || '')) return null;
    var modelId = currentTestModelId();
    var settings = currentPersistedSettings();
    if (!state.testGenerationByModel || typeof state.testGenerationByModel !== 'object') state.testGenerationByModel = {};
    var currentModel = supportedTestModels[modelId] || {};
    if (currentModel.default !== true) {
      Object.keys(supportedTestModels).some(function (supportedId) {
        var supported = supportedTestModels[supportedId] || {};
        if (supported.default !== true || state.testGenerationByModel[supportedId]) return false;
        state.testGenerationByModel[supportedId] = {
          prompt: String(state.testGenerationPrompt || ''),
          settings: state.testGenerationSettings && typeof state.testGenerationSettings === 'object'
            ? JSON.parse(JSON.stringify(state.testGenerationSettings))
            : {}
        };
        return true;
      });
    }
    state.testGenerationByModel[modelId] = {
      prompt: String(prompt || ''),
      settings: JSON.parse(JSON.stringify(settings))
    };
    if (currentModel.default === true) {
      state.testGenerationPrompt = String(prompt || '');
      state.testGenerationSettings = settings;
    }
    var capturedSave = captureCurrentFolderStateSave();
    if (!capturedSave) return null;
    capturedSave.snapshot.test_generation_prompt = state.testGenerationPrompt;
    capturedSave.snapshot.test_generation_settings = JSON.parse(JSON.stringify(state.testGenerationSettings));
    capturedSave.snapshot.test_generation_by_model = JSON.parse(JSON.stringify(state.testGenerationByModel));
    return capturedSave;
  }

  function saveTestBenchState(prompt) {
    var capturedSave = captureTestBenchSave(prompt);
    if (!capturedSave) return;
    debouncedPromptSave(function () {
      writeCapturedFolderState(capturedSave);
    });
  }

  function randomSeed() {
    var values = new Uint32Array(1);
    window.crypto.getRandomValues(values);
    return values[0];
  }

  function isOpen() {
    var node = pane();
    return !!(node && !node.classList.contains('hidden'));
  }

  function recentSetLabel(folder) {
    var parts = String(folder || '').split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : String(folder || '');
  }

  function testSourceLabel(item) {
    var source = String(item && item.source || '');
    if (source) {
      var parts = source.split('/').filter(Boolean);
      return parts.length ? parts[parts.length - 1] : source;
    }
    return 'Test root';
  }

  function openTestBenchSource(folder, source, modelId) {
    var targetFolder = String(folder || '');
    pendingTestSource = String(source || '');
    if (modelId) setWorkingModelProfileId(String(modelId), targetFolder);
    if (targetFolder) {
      openTestBenchFolder(targetFolder, false);
      return;
    }
    openPane();
  }

  function buildTestActivityContextActions() {
    var actions = [];
    var seen = {};
    var active = Array.isArray(testActivity.active) ? testActivity.active : [];
    var recent = Array.isArray(testActivity.recent) ? testActivity.recent : [];

    active.forEach(function (item) {
      var folder = String(item && item.folder || '');
      var source = String(item && item.source || '');
      var modelId = String(item && item.modelId || '');
      var key = modelId + '|' + source;
      if (seen[key]) return;
      seen[key] = true;
      var completed = Number(item.completed || 0);
      var total = Number(item.total || 0);
      actions.push({
        label: 'Running · ' + testSourceLabel(item) + (total ? ' · ' + completed + ' / ' + total : ''),
        run: function () { openTestBenchSource(folder, source, modelId); }
      });
    });

    var recentActions = [];
    recent.some(function (item) {
      var folder = String(item && item.folder || '');
      var source = String(item && item.source || '');
      var modelId = String(item && item.modelId || '');
      var key = modelId + '|' + source;
      if (seen[key]) return false;
      seen[key] = true;
      var sessionCount = Number(item.sessionCount || 0);
      recentActions.push({
        label: testSourceLabel(item) + (sessionCount ? ' · ' + sessionCount + ' session' + (sessionCount === 1 ? '' : 's') : ''),
        run: function () { openTestBenchSource(folder, source, modelId); }
      });
      return recentActions.length >= 5;
    });

    if (actions.length && recentActions.length) actions.push({ separator: true });
    return actions.concat(recentActions);
  }

  function syncActivityButton(payload) {
    testActivity = payload || {};
    var activityButton = el('activity-test-btn');
    if (!activityButton) return;
    var active = Array.isArray(testActivity.active) && testActivity.active.length ? testActivity.active[0] : null;
    activityButton.classList.remove('hidden');
    activityButton.classList.toggle('test-running', !!active);
    activityButton.classList.toggle('active', isOpen());
    setShellTestingActive(!!active);
    activityButton.setAttribute('aria-pressed', isOpen() ? 'true' : 'false');
    if (active) {
      var completed = Number(active.completed || 0);
      var total = Number(active.total || 0);
      activityButton.title = 'Test Generations · ' + String(active.status || 'running') + ' · ' + completed + ' / ' + total + ' · Right-click for Test sources';
    } else {
      activityButton.title = 'Test Generations · Right-click for recent Test sources';
    }
    if (typeof window.syncApplicationShellContext === 'function') window.syncApplicationShellContext();
    if (typeof window.syncShellLocationRoute === 'function') window.syncShellLocationRoute();
  }

  function refreshActivityButton() {
    lastActivityRefreshAt = Date.now();
    var folder = String(state && state.folder || '');
    var url = '/fs/test_generations/activity' + (folder ? ('?folder=' + encodeURIComponent(folder)) : '');
    return fetch(url).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.ok === false) throw new Error(payload && payload.error ? payload.error : 'Could not read Test Bench activity.');
        syncActivityButton(payload);
        return payload;
      });
    }).catch(function () {
      return null;
    });
  }

  function refreshActivityButtonIfDue(intervalMs) {
    if ((Date.now() - lastActivityRefreshAt) < Number(intervalMs || 0)) return Promise.resolve(testActivity);
    return refreshActivityButton();
  }

  function openTestBenchFolder(folder, useSetSource) {
    var targetFolder = String(folder || '');
    if (!targetFolder) return;
    if (useSetSource) pendingTestSource = null;
    if (String(state && state.folder || '') === targetFolder && state.folderStateWritable) {
      openPane();
      return;
    }
    pendingActivityFolder = targetFolder;
    openTrainingWorkspaceFolder(targetFolder);
  }

  function openTestBenchForSetFolder(folder) {
    openTestBenchFolder(folder, true);
  }

  function openTestBenchActivity() {
    if (isOpen()) return;
    var active = Array.isArray(testActivity.active) && testActivity.active.length ? testActivity.active[0] : null;
    if (active) {
      openTestBenchSource(
        String(active.folder || ''),
        String(active.source || ''),
        String(active.modelId || '')
      );
      return;
    }
    openPane();
  }

  function openTestBenchActivityMenu(event) {
    if (event) event.preventDefault();
    var actions = buildTestActivityContextActions();
    if (!actions.length) return;
    showContextMenu(event.clientX, event.clientY, actions);
  }

  function testGenerationsFolderLoaded() {
    syncLaunchVisibility();
    refreshActivityButton();
    if (pendingSourceOwnerFolder && String(state && state.folder || '') === String(pendingSourceOwnerFolder)) {
      pendingSourceOwnerFolder = '';
      openPane();
      return;
    }
    if (pendingRatingFolder && String(state && state.folder || '') === String(pendingRatingFolder)) {
      var ratingFolder = pendingRatingFolder;
      pendingRatingFolder = '';
      initializeRatingReview(ratingFolder);
      return;
    }
    if (!pendingActivityFolder) return;
    if (String(state && state.folder || '') !== String(pendingActivityFolder)) return;
    pendingActivityFolder = '';
    openPane();
  }

  function isTestModelSupported() {
    return supportedTestModelIds.indexOf(String(getWorkingModelProfileId() || '')) !== -1;
  }

  function refreshSupportedTestModels() {
    return fetch('/fs/test_generations/models').then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.ok === false) {
          throw new Error(payload && payload.error ? payload.error : 'Could not read supported Test models.');
        }
        supportedTestModels = {};
        supportedTestModelIds = Array.isArray(payload.models)
          ? payload.models.map(function (item) {
              var id = String(item && item.id || '');
              if (id) supportedTestModels[id] = item;
              return id;
            }).filter(Boolean)
          : [];
        testModelsLoaded = true;
        syncLaunchVisibility();
        syncActiveRunControls(currentStatus);
        return payload;
      });
    }).catch(function (err) {
      testModelsLoaded = true;
      supportedTestModelIds = [];
      supportedTestModels = {};
      syncLaunchVisibility();
      throw err;
    });
  }

  function syncLaunchVisibility() {
    var button = el('test-generations-open-btn');
    if (!button) return;
    var hasFolder = !!(state && state.folder);
    var supported = isTestModelSupported();
    button.classList.toggle('hidden', !hasFolder);
    button.disabled = hasFolder && (!testModelsLoaded || !supported);
    button.textContent = !testModelsLoaded ? 'Loading Test Bench…' : (supported ? 'Open Test Bench' : 'Testing unavailable');
    button.title = supported
      ? 'Compare staged LoRAs with frozen generation settings.'
      : 'Test Generations is not available for the selected Base Model.';
  }

  function stagedFileParts(fileName) {
    var name = String(fileName || '');
    var match = name.match(/^(.*)__epoch(\d+)\.safetensors$/i);
    return match
      ? { label: 'Epoch ' + match[2], detail: match[1], fileName: name }
      : { label: name, detail: '', fileName: name };
  }

  function sessionLabel(sessionName) {
    var name = String(sessionName || '');
    var match = name.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})(?:-|$)/i);
    return match ? match[1] + ' · ' + match[2] + ':' + match[3] : name;
  }

  function syncSessionSelection() {
    var host = el('test-generations-sessions-list');
    if (!host) return;
    Array.prototype.forEach.call(host.querySelectorAll('[data-session-name]'), function (row) {
      row.classList.toggle('is-active', String(row.dataset.sessionName || '') === String(currentSession || ''));
    });
  }

  function selectedCandidateFiles() {
    if (!(selectedCandidates instanceof Set)) return [];
    return Array.from(selectedCandidates);
  }

  function syncCandidateMasterSelect(files) {
    var master = el('test-generations-master-select');
    if (!master) return;
    var available = Array.isArray(files) ? files : [];
    var selectedCount = available.reduce(function (count, fileName) {
      return count + (selectedCandidates instanceof Set && selectedCandidates.has(String(fileName || '')) ? 1 : 0);
    }, 0);
    master.disabled = !available.length;
    master.checked = !!available.length && selectedCount === available.length;
    master.indeterminate = selectedCount > 0 && selectedCount < available.length;
  }

  function renderStagedFiles(payload) {
    var count = Number(payload && payload.count || 0);
    var files = payload && Array.isArray(payload.files) ? payload.files : [];
    var scores = payload && payload.candidateScores && typeof payload.candidateScores === 'object'
      ? payload.candidateScores
      : {};
    var removableFiles = payload && Array.isArray(payload.removableFiles) ? payload.removableFiles : [];
    if (!(selectedCandidates instanceof Set)) {
      var savedSettings = savedTestModelState().settings;
      var savedSelection = state
        && String(state.folder || '') === String(launchFolder || '')
        && Array.isArray(savedSettings.selectedFiles)
          ? savedSettings.selectedFiles
          : null;
      selectedCandidates = new Set(savedSelection === null ? files : savedSelection);
    }
    Array.from(selectedCandidates).forEach(function (fileName) {
      if (files.indexOf(fileName) === -1) selectedCandidates.delete(fileName);
    });
    var summary = el('test-generations-summary');
    var countEl = el('test-generations-files-count');
    var host = el('test-generations-files');
    if (summary) {
      summary.textContent = (String(payload && payload.modelLabel || '').trim() ? String(payload.modelLabel).trim() + ' · ' : '') +
        count + ' LoRA' + (count === 1 ? '' : 's') + ' · ' + (String(testSource || '') || 'Test root');
    }
    if (countEl) countEl.textContent = String(count);
    if (!host) return;
    host.innerHTML = '';

    var baseRow = document.createElement('div');
    baseRow.className = 'test-generations-staged-row test-generations-base-row';
    baseRow.title = 'Include a Base rendition for comparison in the next Test run';

    var baseInclude = document.createElement('input');
    var savedSettings = savedTestModelState().settings;
    var includeBase = !(state
      && String(state.folder || '') === String(launchFolder || '')
      && savedSettings.includeBase === false);
    baseInclude.type = 'checkbox';
    baseInclude.id = 'test-generations-base-include';
    baseInclude.className = 'test-generations-candidate-checkbox';
    baseInclude.checked = includeBase;
    baseInclude.title = 'Include the Base rendition in the next Test run';
    baseInclude.setAttribute('aria-label', 'Include Base rendition in next Test run');
    baseInclude.addEventListener('change', function () {
      saveTestBenchState(String(el('test-generations-prompt') && el('test-generations-prompt').value || '').trim());
    });

    var baseCopy = document.createElement('div');
    baseCopy.className = 'test-generations-staged-copy';
    var baseName = document.createElement('strong');
    baseName.textContent = 'Base';
    var baseDetail = document.createElement('span');
    baseDetail.textContent = 'Reference comparison';
    baseCopy.appendChild(baseName);
    baseCopy.appendChild(baseDetail);

    baseRow.appendChild(baseInclude);
    baseRow.appendChild(baseCopy);
    host.appendChild(baseRow);

    if (!files.length) {
      var emptyCandidates = document.createElement('div');
      emptyCandidates.className = 'test-generations-library-empty';
      emptyCandidates.textContent = 'No LoRAs in this folder.';
      host.appendChild(emptyCandidates);
      syncCandidateMasterSelect(files);
      return;
    }
    files.forEach(function (fileName) {
      var parts = stagedFileParts(fileName);
      var row = document.createElement('div');
      row.className = 'test-generations-staged-row';
      row.title = parts.fileName;
      var include = document.createElement('input');
      include.type = 'checkbox';
      include.className = 'test-generations-candidate-checkbox';
      include.dataset.candidateSelect = String(fileName || '');
      include.checked = selectedCandidates.has(String(fileName || ''));
      include.title = 'Include this staged LoRA in the next Test run';
      include.setAttribute('aria-label', 'Include ' + String(fileName || 'candidate') + ' in next Test run');

      var copy = document.createElement('div');
      copy.className = 'test-generations-staged-copy';
      var name = document.createElement('strong');
      name.textContent = parts.label;
      var detail = document.createElement('span');
      var score = scores[String(fileName || '')];
      var scoreText = score && Number(score.count || 0)
        ? ('★ ' + Number(score.average || 0).toFixed(1) + ' (' + Number(score.count || 0) + ')')
        : '';
      detail.textContent = [parts.detail, scoreText].filter(Boolean).join(' · ');
      copy.appendChild(name);
      if (detail.textContent) copy.appendChild(detail);
      row.appendChild(include);
      row.appendChild(copy);
      if (removableFiles.indexOf(String(fileName || '')) !== -1) {
        var remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'test-generations-remove-candidate';
        remove.dataset.fileName = String(fileName || '');
        remove.title = 'Remove this WebCap-staged Test candidate';
        remove.setAttribute('aria-label', 'Remove ' + String(fileName || 'candidate'));
        remove.textContent = '×';
        row.appendChild(remove);
      }
      host.appendChild(row);
    });
    syncCandidateMasterSelect(files);
  }

  function sessionStatusText(session) {
    var completed = Number(session && session.completed || 0);
    var total = Number(session && session.total || 0);
    var failed = Number(session && session.failed || 0);
    var queued = Number(session && session.queued || 0);
    var running = Number(session && session.running || 0);
    var text = String(session && session.status || '') + ' · ' + completed + ' / ' + total + ' complete' +
      (running ? ' · ' + running + ' running' : '') +
      (queued ? ' · ' + queued + ' queued' : '') +
      (failed ? ' · ' + failed + ' failed' : '');
    var startedAt = Number(session && (session.candidateStartedAt || session.startedAt) || 0);
    if (startedAt && session && (session.status === 'running' || session.status === 'stopping')) {
      text += ' · ' + formatElapsedMs(Date.now() - startedAt);
    }
    if (
      session &&
      currentStatus &&
      String(currentStatus.session || '') === String(session.session || '') &&
      (session.status === 'running' || session.status === 'stopping')
    ) {
      text += liveStatusDetails(currentStatus);
    }
    return text;
  }

  function syncVisibleSessionProgress(status) {
    var sessionName = String(status && status.session || '');
    var host = el('test-generations-sessions-list');
    if (!sessionName || !host) return;
    var rows = host.querySelectorAll('.test-generations-session-row[data-session-name]');
    Array.prototype.some.call(rows, function (row) {
      if (String(row.dataset.sessionName || '') !== sessionName) return false;
      var meta = row.querySelector('.test-generations-session-copy > span');
      if (meta) meta.textContent = sessionStatusText(status);
      var progress = row.querySelector('.test-generations-session-progress');
      if (progress) {
        var completed = Number(status.completed || 0);
        var failed = Number(status.failed || 0);
        var total = Number(status.total || 0);
        var processed = Math.max(0, completed + failed);
        var percent = total > 0 ? Math.max(0, Math.min(100, processed / total * 100)) : 0;
        progress.setAttribute('aria-valuemax', String(total || 0));
        progress.setAttribute('aria-valuenow', String(processed));
        var fill = progress.querySelector('span');
        if (fill) fill.style.width = percent.toFixed(1) + '%';
      }
      return true;
    });
  }

  function renderSessions(sessions, queuedJobs) {
    var items = Array.isArray(sessions) ? sessions : [];
    var queued = Array.isArray(queuedJobs) ? queuedJobs : [];
    var countEl = el('test-generations-sessions-count');
    var host = el('test-generations-sessions-list');
    if (countEl) countEl.textContent = String(items.length + queued.length);
    var clearBtn = el('test-generations-clear-queue-btn');
    if (clearBtn) clearBtn.classList.toggle('hidden', !queued.length);
    if (!host) return;

    var activeItems = items.filter(function (session) {
      return session && (session.status === 'running' || session.status === 'stopping' || session.status === 'starting');
    });
    var historyItems = items.filter(function (session) {
      return activeItems.indexOf(session) === -1;
    });

    var empty = host.querySelector('.test-generations-library-empty');
    if ((items.length || queued.length) && empty) empty.remove();

    function ensureGroup(key, label, count, className) {
      var group = host.querySelector('[data-session-group="' + key + '"]');
      if (!group) {
        group = document.createElement('section');
        group.dataset.sessionGroup = key;
        var heading = document.createElement('div');
        heading.className = 'test-generations-session-group-heading';
        var title = document.createElement('strong');
        title.dataset.sessionGroupTitle = '1';
        var badge = document.createElement('span');
        badge.dataset.sessionGroupCount = '1';
        heading.appendChild(title);
        heading.appendChild(badge);
        var body = document.createElement('div');
        body.className = 'test-generations-session-group-list';
        body.dataset.sessionGroupList = '1';
        group.appendChild(heading);
        group.appendChild(body);
        host.appendChild(group);
      }
      group.className = 'test-generations-session-group ' + className;
      group.querySelector('[data-session-group-title]').textContent = label;
      group.querySelector('[data-session-group-count]').textContent = String(count);

      var order = { running: 0, queued: 1, history: 2 };
      var groups = host.querySelectorAll('[data-session-group]');
      var expected = groups[order[key]] || null;
      if (expected !== group) host.insertBefore(group, expected);

      return group.querySelector('[data-session-group-list]');
    }

    function ensureRow(key) {
      var row = null;
      Array.prototype.some.call(host.querySelectorAll('[data-session-row-key]'), function (candidate) {
        if (String(candidate.dataset.sessionRowKey || '') !== key) return false;
        row = candidate;
        return true;
      });
      if (row) return row;

      row = document.createElement('div');
      row.className = 'test-generations-session-row';
      row.dataset.sessionRowKey = key;

      var copy = document.createElement('div');
      copy.className = 'test-generations-session-copy';
      var title = document.createElement('strong');
      title.dataset.sessionRowTitle = '1';
      var meta = document.createElement('span');
      meta.dataset.sessionRowMeta = '1';
      copy.appendChild(title);
      copy.appendChild(meta);

      var actions = document.createElement('div');
      actions.className = 'test-generations-session-actions';
      actions.dataset.sessionRowActions = '1';

      row.appendChild(copy);
      row.appendChild(actions);
      return row;
    }

    function placeRow(target, row, index) {
      var current = target.children[index] || null;
      if (current !== row) target.insertBefore(row, current);
    }

    function ensureButton(actions, key, className, text) {
      var button = actions.querySelector('[data-session-control="' + key + '"]');
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.dataset.sessionControl = key;
        actions.appendChild(button);
      }
      button.className = className;
      button.textContent = text;
      return button;
    }

    function removeControl(actions, key) {
      var button = actions.querySelector('[data-session-control="' + key + '"]');
      if (button) button.remove();
    }

    function syncSessionRow(session, target, index) {
      var name = String(session.session || '');
      var row = ensureRow('session:' + name);
      row.className = 'test-generations-session-row';
      row.dataset.sessionName = name;
      row.title = name;

      row.querySelector('[data-session-row-title]').textContent =
        String(session.name || '').trim() || sessionLabel(name);
      row.querySelector('[data-session-row-meta]').textContent = sessionStatusText(session);

      var copy = row.querySelector('.test-generations-session-copy');
      var active = session.status === 'running' || session.status === 'stopping' || session.status === 'starting';
      var progress = copy.querySelector('.test-generations-session-progress');
      if (active) {
        var completed = Number(session.completed || 0);
        var failed = Number(session.failed || 0);
        var total = Number(session.total || 0);
        var processed = Math.max(0, completed + failed);
        var percent = total > 0 ? Math.max(0, Math.min(100, processed / total * 100)) : 0;
        if (!progress) {
          progress = document.createElement('div');
          progress.className = 'test-generations-session-progress';
          progress.setAttribute('role', 'progressbar');
          var fill = document.createElement('span');
          progress.appendChild(fill);
          copy.appendChild(progress);
        }
        progress.setAttribute('aria-valuemin', '0');
        progress.setAttribute('aria-valuemax', String(total || 0));
        progress.setAttribute('aria-valuenow', String(processed));
        progress.querySelector('span').style.width = percent.toFixed(1) + '%';
      } else if (progress) {
        progress.remove();
      }

      var actions = row.querySelector('[data-session-row-actions]');
      var resultFolder = String(session.resultFolder || '');
      var open = ensureButton(actions, 'open', 'review-captions-btn', 'Open');
      open.dataset.sessionFolderOpen = resultFolder;
      open.disabled = !resultFolder;

      var rate = ensureButton(actions, 'rate', 'review-captions-btn', 'Rate');
      rate.dataset.sessionRate = resultFolder;
      var unrated = Number(session.unrated || 0);
      rate.classList.toggle('hidden', !resultFolder || unrated <= 0);

      if (active) {
        removeControl(actions, 'delete');
        var stop = ensureButton(
          actions,
          'stop',
          'review-captions-btn test-generations-stop-btn',
          session.status === 'stopping' ? 'Stopping…' : 'Stop'
        );
        stop.dataset.sessionStop = name;
        stop.disabled = session.status === 'stopping';
      } else {
        removeControl(actions, 'stop');
        var remove = ensureButton(actions, 'delete', 'test-generations-remove-candidate', '×');
        remove.dataset.sessionDelete = name;
        remove.title = 'Delete this Test session';
        remove.setAttribute('aria-label', 'Delete Test session ' + name);
      }

      placeRow(target, row, index);
      return row;
    }

    function syncQueuedRow(job, target, index) {
      var jobId = String(job.id || '');
      var row = ensureRow('queue:' + jobId);
      row.className = 'test-generations-session-row';
      row.dataset.queueJobId = jobId;
      row.removeAttribute('data-session-name');
      row.querySelector('[data-session-row-title]').textContent =
        String(job.runName || '').trim() || 'Queued Test';

      var total = Number(job.testTotal || 0);
      var position = Number(job.queuePosition || 0);
      var queuedModel = supportedTestModels[String(job.modelId || '')] || {};
      row.querySelector('[data-session-row-meta]').textContent =
        (String(queuedModel.label || '').trim() ? String(queuedModel.label).trim() + ' · ' : '') +
        'queued' + (position ? ' · Queue #' + position : '') + (total ? ' · ' + total + ' renders' : '');

      var copy = row.querySelector('.test-generations-session-copy');
      var progress = copy.querySelector('.test-generations-session-progress');
      if (progress) progress.remove();

      var actions = row.querySelector('[data-session-row-actions]');
      Array.prototype.forEach.call(actions.querySelectorAll('[data-session-control]'), function (button) {
        if (button.dataset.sessionControl !== 'queue-cancel') button.remove();
      });
      var remove = ensureButton(actions, 'queue-cancel', 'test-generations-remove-candidate', '×');
      remove.dataset.queueCancel = jobId;
      remove.title = 'Remove this queued Test session';
      remove.setAttribute(
        'aria-label',
        'Remove queued Test session ' + row.querySelector('[data-session-row-title]').textContent
      );

      placeRow(target, row, index);
      return row;
    }

    var validRows = {};
    var usedGroups = {};

    if (activeItems.length) {
      usedGroups.running = true;
      var runningList = ensureGroup('running', 'Running', activeItems.length, 'is-running');
      activeItems.forEach(function (session, index) {
        var row = syncSessionRow(session, runningList, index);
        validRows[String(row.dataset.sessionRowKey || '')] = true;
      });
    }

    if (queued.length) {
      usedGroups.queued = true;
      var queuedList = ensureGroup('queued', 'Queued', queued.length, 'is-queued');
      queued.forEach(function (job, index) {
        var row = syncQueuedRow(job, queuedList, index);
        validRows[String(row.dataset.sessionRowKey || '')] = true;
      });
    }

    if (historyItems.length) {
      usedGroups.history = true;
      var historyList = ensureGroup('history', 'Finished', historyItems.length, 'is-history');
      historyItems.forEach(function (session, index) {
        var row = syncSessionRow(session, historyList, index);
        validRows[String(row.dataset.sessionRowKey || '')] = true;
      });
    }

    Array.prototype.forEach.call(host.querySelectorAll('[data-session-row-key]'), function (row) {
      if (!validRows[String(row.dataset.sessionRowKey || '')]) row.remove();
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-session-group]'), function (group) {
      if (!usedGroups[String(group.dataset.sessionGroup || '')]) group.remove();
    });

    if (!items.length && !queued.length && !host.querySelector('.test-generations-library-empty')) {
      empty = document.createElement('div');
      empty.className = 'test-generations-library-empty';
      empty.textContent = 'No test sessions yet.';
      host.appendChild(empty);
    }

    syncSessionSelection();
  }

  function refreshSessions() {
    lastSessionsRefreshAt = Date.now();
    var modelId = currentTestModelId();
    return Promise.all([
      request('test_sessions', { modelId: modelId }),
      request('test_queue', { modelId: modelId })
    ]).then(function (payloads) {
      var sessionPayload = payloads[0] || {};
      var queuePayload = payloads[1] || {};
      queuedTestJobs = Array.isArray(queuePayload.jobs) ? queuePayload.jobs : [];
      renderSessions(sessionPayload.sessions, queuedTestJobs);
      return { sessions: sessionPayload.sessions || [], jobs: queuedTestJobs };
    });
  }

  function refreshSessionsIfDue(intervalMs) {
    if ((Date.now() - lastSessionsRefreshAt) < Number(intervalMs || 0)) {
      return Promise.resolve({ jobs: queuedTestJobs });
    }
    return refreshSessions();
  }

  function cancelQueuedTest(jobId) {
    var id = String(jobId || '').trim();
    if (!id) return Promise.resolve();
    return request('test_queue_cancel', { jobId: id }).then(function () { return refreshSessions(); });
  }

  function clearQueuedTests() {
    return request('test_queue_clear', { modelId: currentTestModelId() }).then(function () { return refreshSessions(); });
  }

  function formatElapsedMs(milliseconds) {
    var seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
    var minutes = Math.floor(seconds / 60);
    var hours = Math.floor(minutes / 60);
    seconds %= 60;
    minutes %= 60;
    if (hours) return hours + 'h ' + String(minutes).padStart(2, '0') + 'm';
    if (minutes) return minutes + 'm ' + String(seconds).padStart(2, '0') + 's';
    return seconds + 's';
  }

  function liveStatusDetails(status) {
    if (!status || (status.status !== 'running' && status.status !== 'stopping')) return '';
    var parts = [];
    var comfyStatus = String(status.comfyStatus || '').trim();
    var jobId = String(status.comfyJobId || '').trim();
    var startedAt = Number(status.candidateStartedAt || status.startedAt || 0);
    var lastContactAt = Number(status.comfyLastContactAt || 0);
    if (comfyStatus) parts.push('Comfy ' + comfyStatus);
    if (jobId) parts.push('Job ' + jobId.slice(0, 8));
    if (startedAt) parts.push('elapsed ' + formatElapsedMs(Date.now() - startedAt));
    if (lastContactAt) parts.push('contact ' + formatElapsedMs(Date.now() - lastContactAt) + ' ago');
    return parts.length ? ' · ' + parts.join(' · ') : '';
  }

  function statusText(status) {
    if (!status || status.status === 'idle') return '';
    var completed = Number(status.completed || 0);
    var total = Number(status.total || 0);
    var failed = Number(status.failed || 0);
    if (status.status === 'running') return 'Running ' + completed + ' / ' + total + (failed ? ' · ' + failed + ' failed' : '') + (status.current ? ' · ' + status.current : '') + liveStatusDetails(status);
    if (status.status === 'stopping') return 'Stopping · ' + completed + ' / ' + total + liveStatusDetails(status);
    if (status.status === 'stopped') return 'Stopped · ' + completed + ' / ' + total;
    if (status.status === 'complete') return 'Complete · ' + completed + ' / ' + total + (failed ? ' · ' + failed + ' failed' : '');
    if (status.status === 'failed') return 'Batch failed · ' + completed + ' / ' + total;
    return String(status.status || '');
  }

  function mediaUrl(folder, fileName) {
    return '/caption/media?folder=' + encodeURIComponent(String(folder || '')) + '&media=' + encodeURIComponent(String(fileName || ''));
  }

  function appendTestPreview(container, resultFolder, result, options) {
    var fileName = resultMediaFile(result);
    var kind = resultMediaKind(result);
    if (!container || !resultFolder || !fileName) return null;
    if (kind === 'image') {
      var image = document.createElement('img');
      image.src = mediaUrl(resultFolder, fileName);
      image.alt = 'Test preview image';
      image.loading = 'lazy';
      container.appendChild(image);
      return image;
    }
    var video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = !!(options && options.muted);
    video.src = mediaUrl(resultFolder, fileName);
    appendTestPreviewVideo(container, video);
    return video;
  }

  function candidateFileForResult(result) {
    var candidateFile = String(result && result.candidateFile || '');
    if (!candidateFile && String(result && result.kind || '') !== 'base' && /\.safetensors$/i.test(String(result && result.sourceLoRA || ''))) {
      candidateFile = String(result.sourceLoRA || '');
    }
    return candidateFile;
  }

  function candidateIdentity(result) {
    if (String(result && result.kind || '') === 'base' || String(result && result.sourceLoRA || '') === 'Base') {
      return { primary: 'Base', secondary: '' };
    }

    var sourceFile = candidateFileForResult(result) || String(result && result.sourceLoRA || '');
    var provenance = result && result.provenance && typeof result.provenance === 'object' ? result.provenance : {};
    var runSequence = String(provenance.sourceRunSequence || '').trim();
    var epoch = provenance.sourceEpoch;
    var match = sourceFile.match(/^(.*)__epoch(\d+)\.safetensors$/i);

    if (!runSequence && match) {
      var runMatch = String(match[1] || '').match(/(?:^|[-_])(?:run[-_]?)?(\d+)$/i);
      if (runMatch) runSequence = runMatch[1];
    }
    if ((epoch === undefined || epoch === null || epoch === '') && match) epoch = match[2];

    var identity = [];
    if (runSequence) identity.push('Run ' + String(runSequence).padStart(2, '0'));
    if (epoch !== undefined && epoch !== null && String(epoch).trim() !== '') identity.push('Epoch ' + String(epoch).trim());

    return {
      primary: identity.length ? identity.join(' · ') : (stagedFileParts(sourceFile).label || sourceFile || 'Result'),
      secondary: sourceFile
    };
  }

  function formatCandidateElapsed(milliseconds) {
    var value = Number(milliseconds);
    if (!isFinite(value) || value < 0) return '';
    var seconds = Math.floor(value / 1000);
    var hours = Math.floor(seconds / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);
    seconds %= 60;
    if (hours) return hours + 'h ' + minutes + 'm';
    if (minutes) return minutes + 'm ' + seconds + 's';
    return seconds + 's';
  }

  function resultMediaFile(result) {
    return String(result && (result.mediaFile || result.outputVideo) || '').trim();
  }

  function resultMediaKind(result) {
    var explicitKind = String(result && result.mediaKind || '').trim().toLowerCase();
    if (explicitKind) return explicitKind;
    var fileName = resultMediaFile(result).toLowerCase();
    return /\.(?:png|jpe?g|webp|gif|bmp|avif)$/.test(fileName) ? 'image' : (fileName ? 'video' : '');
  }

  function buildResultRating(result, resultFolder) {
    var mediaFile = resultMediaFile(result);
    var ratingFolder = String(resultFolder || '').trim();
    if (!mediaFile) return null;

    var currentRating = Math.max(0, Math.min(5, Number(result && result.rating || 0)));
    var stars = document.createElement('div');
    stars.className = 'test-generations-result-rating';
    stars.setAttribute('aria-label', 'Rate this Test result');

    for (var value = 1; value <= 5; value += 1) {
      var star = document.createElement('button');
      star.type = 'button';
      star.className = 'test-generations-result-star' + (value <= currentRating ? ' active' : '');
      star.dataset.testRating = String(value);
      star.dataset.mediaFile = mediaFile;
      star.dataset.ratingFolder = ratingFolder;
      star.title = 'Rate ' + value + ' star' + (value === 1 ? '' : 's');
      star.setAttribute('aria-label', star.title);
      star.textContent = value <= currentRating ? '★' : '☆';
      stars.appendChild(star);
    }
    return stars;
  }

  function syncResultRatingButtons(resultFolder, mediaFile, rating) {
    var folder = String(resultFolder || '').trim();
    var name = String(mediaFile || '').trim();
    var value = Math.max(0, Math.min(5, Number(rating || 0)));
    if (!folder || !name) return;
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-test-rating][data-media-file][data-rating-folder]'),
      function (star) {
        if (String(star.dataset.ratingFolder || '') !== folder || String(star.dataset.mediaFile || '') !== name) return;
        var starValue = Number(star.dataset.testRating || 0);
        var active = starValue <= value;
        star.classList.toggle('active', active);
        star.textContent = active ? '★' : '☆';
        star.disabled = false;
      }
    );
  }

  function rateTestResult(button) {
    var rating = Number(button && button.dataset.testRating || 0);
    var mediaFile = String(button && button.dataset.mediaFile || '').trim();
    var resultFolder = String(button && button.dataset.ratingFolder || '').trim();
    if (!mediaFile || rating < 1 || rating > 5) return;
    if (!resultFolder) {
      showError(new Error('Test result has no result folder.'));
      return;
    }

    var row = button.closest('.test-generations-result-rating');
    if (row) {
      Array.prototype.forEach.call(row.querySelectorAll('[data-test-rating]'), function (star) {
        star.disabled = true;
      });
    }

    setMediaRating(resultFolder, mediaFile, rating).then(function (payload) {
      syncResultRatingButtons(resultFolder, mediaFile, payload && payload.rating);
      if (currentStatus && String(currentStatus.resultFolder || '') === resultFolder && Array.isArray(currentStatus.results)) {
        currentStatus.results.forEach(function (result) {
          if (resultMediaFile(result) === mediaFile) result.rating = payload.rating;
        });
      }
      return request('test_rating_summary', { modelId: currentTestModelId() });
    }).then(function (payload) {
      if (prepared && payload && payload.candidateScores) {
        prepared.candidateScores = payload.candidateScores;
        renderStagedFiles(prepared);
      }
      if (payload && payload.sessions) renderSessions(payload.sessions, queuedTestJobs);
    }).catch(function (err) {
      if (row) {
        Array.prototype.forEach.call(row.querySelectorAll('[data-test-rating]'), function (star) {
          star.disabled = false;
        });
      }
      showError(err);
    });
  }

  function buildResultRemoveButton(result) {
    var candidateFile = candidateFileForResult(result);
    if (!candidateFile) return null;

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'test-generations-result-remove';
    remove.dataset.removeCandidate = candidateFile;
    remove.title = 'Remove this staged candidate and its result from this session.';
    remove.setAttribute('aria-label', 'Remove staged candidate ' + candidateFile);
    remove.textContent = '×';
    return remove;
  }

  function buildResultFooter(result, options) {
    var opts = options || {};
    var footer = document.createElement('div');
    footer.className = 'test-generations-result-footer' + (opts.failed ? ' test-generations-failure-footer' : '');

    var copy = document.createElement('div');
    copy.className = opts.failed ? 'test-generations-failure-copy' : 'test-generations-result-copy';

    var identity = candidateIdentity(result);
    var primaryRow = document.createElement('div');
    primaryRow.className = 'test-generations-result-primary';

    var label = document.createElement('div');
    label.className = 'test-generations-result-name';
    label.textContent = identity.primary;
    primaryRow.appendChild(label);

    var elapsed = formatCandidateElapsed(result && result.elapsedMs);
    if (elapsed) {
      var timing = document.createElement('span');
      timing.className = 'test-generations-result-elapsed';
      timing.textContent = opts.failed ? 'Failed after ' + elapsed : elapsed;
      primaryRow.appendChild(timing);
    }
    copy.appendChild(primaryRow);

    var secondaryRow = document.createElement('div');
    secondaryRow.className = 'test-generations-result-secondary';

    if (identity.secondary) {
      var source = document.createElement('div');
      source.className = 'test-generations-result-source';
      source.textContent = identity.secondary;
      source.title = identity.secondary;
      secondaryRow.appendChild(source);
    }

    if (!opts.failed) {
      var rating = buildResultRating(result, opts.resultFolder);
      if (rating) secondaryRow.appendChild(rating);
    }

    if (secondaryRow.childNodes.length) copy.appendChild(secondaryRow);

    if (opts.failed) {
      var detail = document.createElement('div');
      detail.className = 'test-generations-result-error';
      detail.textContent = String(result && result.error || 'Generation failed.');
      copy.appendChild(detail);
    }

    footer.appendChild(copy);
    return footer;
  }

  function formatTestVideoTime(value) {
    var seconds = Math.max(0, Number(value) || 0);
    var minutes = Math.floor(seconds / 60);
    var wholeSeconds = Math.floor(seconds % 60);
    return minutes + ':' + String(wholeSeconds).padStart(2, '0');
  }

  function appendTestPreviewVideo(container, video) {
    if (!container || !video) return;
    video.controls = false;
    video.playsInline = true;
    video.tabIndex = 0;
    video.setAttribute('aria-label', 'Test preview video. Click or press Space to play or pause.');

    var transport = document.createElement('div');
    transport.className = 'test-generations-video-transport';

    var play = document.createElement('button');
    play.type = 'button';
    play.className = 'test-generations-video-play';
    play.textContent = '▶';
    play.setAttribute('aria-label', 'Play preview');

    var scrubber = document.createElement('input');
    scrubber.type = 'range';
    scrubber.className = 'test-generations-video-scrubber';
    scrubber.min = '0';
    scrubber.max = '1000';
    scrubber.step = '1';
    scrubber.value = '0';
    scrubber.setAttribute('aria-label', 'Preview position');

    var time = document.createElement('span');
    time.className = 'test-generations-video-time';
    time.textContent = '0:00 / 0:00';

    function updateTransport() {
      var duration = Number(video.duration);
      var current = Number(video.currentTime);
      var validDuration = isFinite(duration) && duration > 0;
      scrubber.disabled = !validDuration;
      scrubber.value = validDuration ? String(Math.round((Math.max(0, current) / duration) * 1000)) : '0';
      time.textContent = formatTestVideoTime(current) + ' / ' + formatTestVideoTime(validDuration ? duration : 0);
      play.textContent = video.paused ? '▶' : '❚❚';
      play.setAttribute('aria-label', video.paused ? 'Play preview' : 'Pause preview');
    }

    function togglePlayback() {
      if (video.paused) {
        var promise = video.play();
        if (promise && typeof promise.catch === 'function') promise.catch(showError);
      } else {
        video.pause();
      }
    }

    play.onclick = function () { togglePlayback(); };
    scrubber.oninput = function () {
      var duration = Number(video.duration);
      if (!isFinite(duration) || duration <= 0) return;
      video.currentTime = duration * (Number(scrubber.value) / 1000);
    };
    video.onclick = function () { togglePlayback(); };
    video.onkeydown = function (event) {
      if (!event) return;
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        var direction = event.key === 'ArrowLeft' ? -1 : 1;
        video.currentTime = Math.max(0, Math.min(Number(video.duration) || 0, Number(video.currentTime || 0) + direction));
      }
    };
    ['loadedmetadata', 'durationchange', 'timeupdate', 'play', 'pause', 'ended', 'seeked'].forEach(function (eventName) {
      video.addEventListener(eventName, updateTransport);
    });

    container.appendChild(video);
    transport.appendChild(play);
    transport.appendChild(scrubber);
    transport.appendChild(time);
    container.appendChild(transport);
    updateTransport();
  }

  function setResultsView(mode) {
    resultsView = mode === 'compare' ? 'compare' : 'grid';
    var gridBtn = el('test-generations-view-grid-btn');
    var compareBtn = el('test-generations-view-compare-btn');
    var grid = el('test-generations-results');
    var compare = el('test-generations-compare');
    if (gridBtn) {
      gridBtn.classList.toggle('active', resultsView === 'grid');
      gridBtn.setAttribute('aria-selected', resultsView === 'grid' ? 'true' : 'false');
    }
    if (compareBtn) {
      compareBtn.classList.toggle('active', resultsView === 'compare');
      compareBtn.setAttribute('aria-selected', resultsView === 'compare' ? 'true' : 'false');
    }
    if (grid) grid.classList.toggle('hidden', resultsView !== 'grid');
    if (compare) compare.classList.toggle('hidden', resultsView !== 'compare');
    renderResults(currentStatus);
  }

  function syncCompareVideos(videos) {
    if (!videos || videos.length !== 2) return;
    var syncing = false;

    function mirror(source, target, action) {
      if (syncing) return;
      syncing = true;
      try {
        if (action === 'seek' && Math.abs(target.currentTime - source.currentTime) > 0.03) {
          target.currentTime = source.currentTime;
        }
        if (action === 'rate' && target.playbackRate !== source.playbackRate) {
          target.playbackRate = source.playbackRate;
        }
        if (action === 'play') {
          if (Math.abs(target.currentTime - source.currentTime) > 0.03) target.currentTime = source.currentTime;
          if (target.playbackRate !== source.playbackRate) target.playbackRate = source.playbackRate;
          if (target.paused) {
            var playPromise = target.play();
            if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(showError);
          }
        }
        if (action === 'pause') {
          if (Math.abs(target.currentTime - source.currentTime) > 0.03) target.currentTime = source.currentTime;
          if (!target.paused) target.pause();
        }
      } finally {
        syncing = false;
      }
    }

    videos.forEach(function (video, index) {
      var other = videos[index ? 0 : 1];
      video.addEventListener('play', function () { mirror(video, other, 'play'); });
      video.addEventListener('pause', function () { mirror(video, other, 'pause'); });
      video.addEventListener('seeked', function () { mirror(video, other, 'seek'); });
      video.addEventListener('ratechange', function () { mirror(video, other, 'rate'); });
    });
  }

  function renderCompare(status) {
    var host = el('test-generations-compare');
    if (!host) return;
    var results = status && Array.isArray(status.results) ? status.results : [];
    var resultFolder = String(status && status.resultFolder || '');

    if (results.length < 2) {
      host.dataset.compareKey = '';
      host.innerHTML = '<div class="test-generations-empty">At least two completed results are needed to compare.</div>';
      return;
    }

    compareIndex = Math.max(0, Math.min(compareIndex, results.length - 2));
    var pair = [results[compareIndex], results[compareIndex + 1]];
    var compareKey = resultFolder + '|' + pair.map(function (result, index) {
      return String(resultMediaFile(result) || result.sourceLoRA || ('result-' + (compareIndex + index)));
    }).join('|');
    if (String(host.dataset.compareKey || '') === compareKey && host.querySelector('.test-generations-compare-stage')) {
      var existingPrevious = host.querySelector('[data-compare-previous]');
      var existingNext = host.querySelector('[data-compare-next]');
      var existingPosition = host.querySelector('[data-compare-position]');
      if (existingPrevious) existingPrevious.disabled = compareIndex <= 0;
      if (existingNext) existingNext.disabled = compareIndex >= results.length - 2;
      if (existingPosition) existingPosition.textContent = (compareIndex + 1) + ' / ' + (results.length - 1);
      return;
    }

    host.innerHTML = '';
    host.dataset.compareKey = compareKey;
    var stage = document.createElement('div');
    stage.className = 'test-generations-compare-stage';
    var videos = [];

    pair.forEach(function (result) {
      var item = document.createElement('article');
      item.className = 'test-generations-compare-item';

      var preview = appendTestPreview(item, resultFolder, result, { muted: true });
      if (preview && preview.tagName === 'VIDEO') videos.push(preview);

      var remove = buildResultRemoveButton(result);
      if (remove) item.appendChild(remove);
      item.appendChild(buildResultFooter(result, { resultFolder: resultFolder }));
      stage.appendChild(item);
    });

    var controls = document.createElement('div');
    controls.className = 'test-generations-compare-controls';

    var previous = document.createElement('button');
    previous.type = 'button';
    previous.className = 'review-captions-btn';
    previous.dataset.comparePrevious = '1';
    previous.disabled = compareIndex <= 0;
    previous.textContent = 'Previous';

    var position = document.createElement('span');
    position.dataset.comparePosition = '1';
    position.textContent = (compareIndex + 1) + ' / ' + (results.length - 1);

    var next = document.createElement('button');
    next.type = 'button';
    next.className = 'review-captions-btn';
    next.dataset.compareNext = '1';
    next.disabled = compareIndex >= results.length - 2;
    next.textContent = 'Next';

    controls.appendChild(previous);
    controls.appendChild(position);
    controls.appendChild(next);
    host.appendChild(stage);
    host.appendChild(controls);
    if (videos.length === pair.length) syncCompareVideos(videos);
  }

  function renderResults(status) {
    var host = el('test-generations-results');
    if (!host) return;
    var results = status && Array.isArray(status.results) ? status.results : [];
    var failures = status && Array.isArray(status.failures) ? status.failures : [];
    var total = Number(status && status.total || (prepared && prepared.count) || 0);
    var resultFolder = String(status && status.resultFolder || '');
    var priorFolder = String(host.dataset.resultFolder || '');

    if (priorFolder !== resultFolder) {
      host.innerHTML = '';
      host.dataset.resultFolder = resultFolder;
    }

    var validKeys = results.map(function (result, index) {
      var mediaFile = resultMediaFile(result);
      return mediaFile || (String(result.sourceLoRA || 'result') + ':' + index);
    }).concat(failures.map(function (failure, index) {
      return 'failure:' + String(failure.sourceLoRA || 'result') + ':' + index;
    }));
    Array.prototype.forEach.call(
      host.querySelectorAll('.test-generations-result-card:not(.is-pending)'),
      function (card) {
        if (validKeys.indexOf(String(card.dataset.resultKey || '')) === -1) card.remove();
      }
    );

    var empty = host.querySelector('.test-generations-empty');
    if ((results.length || failures.length || (status && status.status === 'running')) && empty) empty.remove();

    results.forEach(function (result, index) {
      var mediaFile = resultMediaFile(result);
      var resultKey = mediaFile || (String(result.sourceLoRA || 'result') + ':' + index);
      var exists = Array.prototype.some.call(
        host.querySelectorAll('.test-generations-result-card:not(.is-pending)'),
        function (card) { return card.dataset.resultKey === resultKey; }
      );
      if (exists) return;

      var card = document.createElement('article');
      card.className = 'test-generations-result-card';
      card.dataset.resultKey = resultKey;
      card.dataset.compareIndex = String(index);

      if (resultFolder && mediaFile) {
        appendTestPreview(card, resultFolder, result);
      } else {
        var placeholder = document.createElement('div');
        placeholder.className = 'test-generations-preview-placeholder';
        placeholder.textContent = 'Preview unavailable';
        card.appendChild(placeholder);
      }

      var remove = buildResultRemoveButton(result);
      if (remove) card.appendChild(remove);
      card.appendChild(buildResultFooter(result, { resultFolder: resultFolder }));

      var pending = host.querySelector('.test-generations-result-card.is-pending');
      host.insertBefore(card, pending || null);
    });

    failures.forEach(function (failure, index) {
      var failureKey = 'failure:' + String(failure.sourceLoRA || 'result') + ':' + index;
      var diagnosticKey = String(status && status.session || '') + ':' + failureKey + ':' + String(failure.error || '');
      if (!reportedFailureKeys.has(diagnosticKey)) {
        reportedFailureKeys.add(diagnosticKey);
        reportConsoleError(
          'Test Generations',
          new Error(
            (String(failure.sourceLoRA || failure.candidateFile || 'Generation') + ': ') +
            String(failure.error || 'Generation failed.')
          )
        );
      }
      var exists = Array.prototype.some.call(
        host.querySelectorAll('.test-generations-result-card:not(.is-pending)'),
        function (card) { return card.dataset.resultKey === failureKey; }
      );
      if (exists) return;

      var card = document.createElement('article');
      card.className = 'test-generations-result-card is-failed';
      card.dataset.resultKey = failureKey;

      var placeholder = document.createElement('div');
      placeholder.className = 'test-generations-preview-placeholder test-generations-failure-placeholder';
      placeholder.textContent = 'Generation failed';
      card.appendChild(placeholder);

      var remove = buildResultRemoveButton(failure);
      if (remove) card.appendChild(remove);
      card.appendChild(buildResultFooter(failure, { failed: true }));

      var pending = host.querySelector('.test-generations-result-card.is-pending');
      host.insertBefore(card, pending || null);
    });

    var pending = host.querySelector('.test-generations-result-card.is-pending');
    if (status && status.status === 'running' && (results.length + failures.length) < total) {
      if (!pending) {
        pending = document.createElement('article');
        pending.className = 'test-generations-result-card is-pending';

        var pendingPlaceholder = document.createElement('div');
        pendingPlaceholder.className = 'test-generations-preview-placeholder';
        pendingPlaceholder.textContent = 'Generating…';
        pending.appendChild(pendingPlaceholder);

        var pendingLabel = document.createElement('div');
        pendingLabel.className = 'test-generations-result-name';
        pending.appendChild(pendingLabel);

        host.appendChild(pending);
      }
      pending.querySelector('.test-generations-result-name').textContent = String(status.current || 'Next LoRA');
    } else if (pending) {
      pending.remove();
    }

    if (!results.length && !failures.length && !(status && status.status === 'running') && !host.querySelector('.test-generations-result-card')) {
      host.innerHTML = '<div class="test-generations-empty">Generated previews will appear here.</div>';
    }

    if (resultsView === 'compare') renderCompare(status || {});
  }

  function syncActiveRunControls(status) {
    var runBtn = el('test-generations-run-btn');
    if (runBtn) {
      var supported = isTestModelSupported();
      runBtn.disabled = !prepared || !prepared.count || !selectedCandidateFiles().length || !supported;
      runBtn.title = supported
        ? 'Queue this frozen Test batch.'
        : 'Test Generations is not available for the selected Base Model.';
    }
  }

  var TEST_PROMPT_COLOR_SWATCHES = {
    'black': '#111111',
    'white': '#f4f4f4',
    'gray': '#808080',
    'grey': '#808080',
    'silver': '#c0c0c0',
    'red': '#d13c3c',
    'dark red': '#8b0000',
    'burgundy': '#800020',
    'maroon': '#800000',
    'orange': '#e8892f',
    'yellow': '#e0c43b',
    'gold': '#d4af37',
    'green': '#3f8f5f',
    'dark green': '#1f5f3b',
    'forest green': '#228b22',
    'olive': '#808000',
    'olive green': '#6b7d2a',
    'lime': '#63b32e',
    'lime green': '#63b32e',
    'blue': '#3e73c7',
    'light blue': '#8ecae6',
    'sky blue': '#87ceeb',
    'dark blue': '#234f8a',
    'navy': '#000080',
    'navy blue': '#000080',
    'royal blue': '#4169e1',
    'teal': '#218a8a',
    'turquoise': '#40b8b3',
    'cyan': '#2ab7ca',
    'purple': '#7b4bb7',
    'violet': '#8f5cc7',
    'lavender': '#b8a1d9',
    'magenta': '#c33ca6',
    'pink': '#e979a6',
    'light pink': '#f1a7c3',
    'hot pink': '#e84a9b',
    'peach': '#f0b38f',
    'brown': '#8b5a3c',
    'tan': '#c49a6c',
    'beige': '#d8c7a5',
    'cream': '#eee1bd',
    'platinum blonde': '#e5dfc8',
    'strawberry blonde': '#c98262',
    'dirty blonde': '#b7a16b',
    'blonde': '#d8bd72',
    'blond': '#d8bd72',
    'auburn': '#8b4a2f',
    'brunette': '#5a3825',
    'skin-colored': '#c99a7a',
    'skin colored': '#c99a7a',
    'colorful': 'linear-gradient(90deg, #d13c3c, #e0c43b, #3f8f5f, #3e73c7, #7b4bb7)',
    'multicolored': 'linear-gradient(90deg, #d13c3c, #e0c43b, #3f8f5f, #3e73c7, #7b4bb7)',
    'multi-colored': 'linear-gradient(90deg, #d13c3c, #e0c43b, #3f8f5f, #3e73c7, #7b4bb7)'
  };
  var TEST_PROMPT_COLOR_TERMS = Object.keys(TEST_PROMPT_COLOR_SWATCHES).sort(function (a, b) {
    return b.length - a.length;
  });
  var TEST_PROMPT_COLOR_PATTERN = '\\b(?:' + TEST_PROMPT_COLOR_TERMS.map(function (value) {
    return value.replace(/\s+/g, '\\s+');
  }).join('|') + ')\\b';
  var TEST_PROMPT_HAIR_STYLES = [
    'shoulder-length', 'waist-length', 'chin-length', 'slicked back', 'tied back',
    'high ponytail', 'low ponytail', 'messy bun', 'pixie cut', 'ponytail',
    'pigtails', 'braided', 'braids', 'bangs', 'fringe', 'curly', 'straight',
    'wavy', 'long', 'short', 'bob', 'bun', 'loose'
  ];
  var TEST_PROMPT_ACCESSORIES = [
    'hoop earrings', 'bow tie', 'hair clip', 'sunglasses', 'eyeglasses', 'glasses',
    'earrings', 'necklace', 'choker', 'bracelet', 'wristwatch', 'headband', 'beanie',
    'handbag', 'backpack', 'gloves', 'scarf', 'belt', 'purse', 'brooch', 'rings',
    'ring', 'hat', 'cap'
  ];
  var TEST_PROMPT_SCENE_OBJECTS = [
    'curtains', 'curtain', 'blanket', 'bookshelf', 'bookshelves',
    'nightstand', 'countertop', 'television', 'paintings', 'painting', 'posters',
    'poster', 'pillows', 'pillow', 'cushions', 'cushion', 'windows', 'window',
    'doors', 'door', 'mirror', 'sofa', 'couch', 'chairs', 'chair', 'table',
    'desk', 'bed', 'lamps', 'lamp', 'rug', 'carpet', 'shelves', 'shelf',
    'plants', 'plant', 'dresser', 'wardrobe', 'stools', 'stool', 'tv'
  ];

  function promptColorMatches(text) {
    var matches = [];
    var pattern = new RegExp(TEST_PROMPT_COLOR_PATTERN, 'gi');
    var match;
    while ((match = pattern.exec(String(text || ''))) !== null) {
      matches.push({
        color: String(match[0] || '').toLowerCase(),
        index: match.index,
        end: match.index + match[0].length
      });
    }
    return matches;
  }

  function cleanPromptColorTarget(value, hasNextColor) {
    var target = String(value || '')
      .replace(/^[\s,:;()\[\]{}\u2013\u2014-]+/, '')
      .replace(/[\s,:;()\[\]{}\u2013\u2014-]+$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (hasNextColor) {
      target = target.replace(/\s+(?:with|and|or|plus|&)\s*$/i, '').trim();
      target = target.replace(/^(?:with|and|or|plus|&)$/i, '').trim();
    }
    target = target.replace(/^(?:a|an|the)\s+/i, '');
    target = target.replace(/\s+(?:who|that|which|while|where|when)\b.*$/i, '').trim();
    target = target.replace(/\s+(?:standing|sitting|walking|holding|wearing|creating)\b.*$/i, '').trim();
    var hasMatchingTarget = /\s+(?:and|with)\s+(?:(?:a|an|the)\s+)?matching\s+/i.test(target);
    if (!hasMatchingTarget) {
      target = target.replace(/\s+(?:with|in|on|at|near|beside|behind|under|over|against|inside|outside|by|from)\b.*$/i, '').trim();
      var words = target.split(/\s+/).filter(Boolean);
      if (words.length > 5) target = words.slice(0, 5).join(' ');
    }
    return target;
  }

  function expandMatchingPromptColorTargets(color, target, phrase) {
    var match = String(target || '').match(/^(.+?)\s+(?:and|with)\s+(?:(?:a|an|the)\s+)?matching\s+(.+)$/i);
    if (!match) return [{ color: color, target: target, phrase: phrase }];
    return [
      { color: color, target: cleanPromptColorTarget(match[1], false), phrase: phrase },
      { color: color, target: cleanPromptColorTarget(match[2], false), phrase: phrase }
    ];
  }

  function extractPromptColorTargets(prompt) {
    var targets = [];
    var seen = {};
    var clausePattern = /[^,;.!?\n:]+/g;
    var source = String(prompt || '');
    var clauseMatch;

    while ((clauseMatch = clausePattern.exec(source)) !== null) {
      var clause = String(clauseMatch[0] || '').trim();
      if (!clause) continue;
      var matches = promptColorMatches(clause);
      if (!matches.length) continue;

      var phrase = clause;
      var parsed = matches.map(function (match, index) {
        var next = matches[index + 1];
        return {
          color: match.color,
          target: cleanPromptColorTarget(
            clause.slice(match.end, next ? next.index : clause.length),
            !!next
          ),
          phrase: phrase,
          index: clauseMatch.index + match.index
        };
      });

      parsed.forEach(function (item, index) {
        if (item.target || index >= parsed.length - 1) return;
        var bridge = clause.slice(matches[index].end, matches[index + 1].index)
          .replace(/[\s\u2013\u2014/&-]+/g, ' ')
          .trim()
          .toLowerCase();
        if (bridge === 'and' || bridge === 'or') item.target = parsed[index + 1].target;
      });

      parsed.forEach(function (item) {
        if (!item.target) return;
        expandMatchingPromptColorTargets(item.color, item.target, item.phrase).forEach(function (expanded) {
          if (!expanded.target) return;
          var key = expanded.color + '|' + expanded.target.toLowerCase();
          if (seen[key]) return;
          seen[key] = true;
          expanded.index = item.index;
          expanded.swatch = TEST_PROMPT_COLOR_SWATCHES[expanded.color] || '#808080';
          targets.push(expanded);
        });
      });
    }

    return targets;
  }

  function promptClauseAt(source, index) {
    var text = String(source || '');
    var start = index;
    var end = index;
    while (start > 0 && !/[,.!?;\n:]/.test(text.charAt(start - 1))) start -= 1;
    while (end < text.length && !/[,.!?;\n:]/.test(text.charAt(end))) end += 1;
    return text.slice(start, end).trim();
  }

  function promptTermMatches(source, term) {
    var pattern = String(term || '').replace(/\s+/g, '\\s+');
    var regex = new RegExp('\\b' + pattern + '\\b', 'gi');
    var matches = [];
    var match;
    while ((match = regex.exec(String(source || ''))) !== null) {
      matches.push({ index: match.index, end: match.index + match[0].length, text: match[0] });
    }
    return matches;
  }

  function extractNamedPromptItems(prompt, terms, type) {
    var source = String(prompt || '');
    var items = [];
    var occupied = [];
    terms.slice().sort(function (a, b) { return b.length - a.length; }).forEach(function (term) {
      promptTermMatches(source, term).forEach(function (match) {
        var overlaps = occupied.some(function (range) {
          return match.index < range.end && match.end > range.start;
        });
        if (overlaps) return;
        occupied.push({ start: match.index, end: match.end });
        items.push({
          type: type,
          target: String(match.text || '').toLowerCase(),
          color: '',
          detail: '',
          phrase: promptClauseAt(source, match.index),
          index: match.index
        });
      });
    });
    return items.sort(function (a, b) { return a.index - b.index; });
  }

  function extractHairPromptItems(prompt) {
    var source = String(prompt || '');
    var items = [];
    promptTermMatches(source, 'hair').forEach(function (match) {
      var clause = promptClauseAt(source, match.index);
      var hairOffset = clause.toLowerCase().indexOf('hair');
      var before = hairOffset >= 0 ? clause.slice(0, hairOffset) : '';
      var after = hairOffset >= 0 ? clause.slice(hairOffset + 4) : '';
      var attributeTerms = TEST_PROMPT_COLOR_TERMS.concat(TEST_PROMPT_HAIR_STYLES).sort(function (a, b) {
        return b.length - a.length;
      });
      var directTerms = [];

      attributeTerms.forEach(function (term) {
        promptTermMatches(before, term).forEach(function (termMatch) {
          var tail = before.slice(termMatch.index);
          attributeTerms.forEach(function (candidate) {
            var candidatePattern = String(candidate).replace(/\s+/g, '\\s+');
            tail = tail.replace(new RegExp('\\b' + candidatePattern + '\\b', 'gi'), ' ');
          });
          if (!tail.replace(/[\s\u2013\u2014-]+/g, '')) {
            directTerms.push({ term: term.toLowerCase(), index: termMatch.index });
          }
        });
      });

      directTerms.sort(function (a, b) { return a.index - b.index; });
      var directColors = directTerms.filter(function (item) {
        return Object.prototype.hasOwnProperty.call(TEST_PROMPT_COLOR_SWATCHES, item.term);
      });
      var directStyles = directTerms.filter(function (item) {
        return TEST_PROMPT_HAIR_STYLES.indexOf(item.term) >= 0;
      }).map(function (item) { return item.term; });

      var afterStyle = String(after || '').match(/^\s*(tied back|slicked back)\b/i);
      if (!afterStyle) {
        afterStyle = String(after || '').match(/^\s*(?:(?:is\s+)?(?:worn|styled|pulled|tied)\s+)?(?:(?:in|into)\s+(?:a\s+)?)?(high ponytail|low ponytail|messy bun|ponytail|pigtails|pixie cut|bun|braids|braided)\b/i);
      }
      if (afterStyle && directStyles.indexOf(afterStyle[1].toLowerCase()) < 0) {
        directStyles.push(afterStyle[1].toLowerCase());
      }

      items.push({
        type: 'Hair',
        target: 'hair',
        color: directColors.length ? directColors[directColors.length - 1].term : '',
        detail: directStyles.join(' '),
        phrase: clause,
        index: match.index
      });
    });
    return items;
  }

  function normalizedPromptTarget(value) {
    return String(value || '').toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function promptTargetsMatch(first, second) {
    return normalizedPromptTarget(first) === normalizedPromptTarget(second);
  }

  function classifyColorTarget(target) {
    var normalized = normalizedPromptTarget(target);
    if (normalized === 'hair' || normalized.indexOf('hair ') === 0) return 'Hair';
    if (TEST_PROMPT_ACCESSORIES.some(function (term) { return promptTargetsMatch(normalized, term); })) return 'Accessory';
    if (TEST_PROMPT_SCENE_OBJECTS.some(function (term) { return promptTargetsMatch(normalized, term); })) return 'Scene';
    return 'Colour';
  }

  function extractPromptExpectations(prompt) {
    var source = String(prompt || '');
    var items = []
      .concat(extractHairPromptItems(source))
      .concat(extractNamedPromptItems(source, TEST_PROMPT_ACCESSORIES, 'Accessory'))
      .concat(extractNamedPromptItems(source, TEST_PROMPT_SCENE_OBJECTS, 'Scene'));

    extractPromptColorTargets(source).forEach(function (colorItem) {
      var type = classifyColorTarget(colorItem.target);
      var existing = items.find(function (item) {
        if (item.type !== type) return false;
        return promptTargetsMatch(item.target, colorItem.target);
      });
      if (existing) {
        var colors = String(existing.color || '').split(' + ').filter(Boolean);
        if (colors.indexOf(colorItem.color) < 0) colors.push(colorItem.color);
        existing.color = colors.join(' + ');
        if (colors.length === 1) {
          existing.swatch = colorItem.swatch;
        } else {
          var swatches = colors.map(function (color) {
            var value = TEST_PROMPT_COLOR_SWATCHES[color] || '#808080';
            return value.indexOf('gradient(') >= 0 ? '#808080' : value;
          });
          existing.swatch = 'linear-gradient(90deg, ' + swatches.join(', ') + ')';
        }
        if (!existing.phrase) existing.phrase = colorItem.phrase;
        return;
      }
      items.push({
        type: type,
        target: colorItem.target,
        color: colorItem.color,
        swatch: colorItem.swatch,
        detail: '',
        phrase: colorItem.phrase,
        index: colorItem.index
      });
    });

    var seen = {};
    return items
      .filter(function (item) {
        var key = item.type + '|' + normalizedPromptTarget(item.target) + '|' + String(item.color || '') + '|' + String(item.detail || '');
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      })
      .sort(function (a, b) { return a.index - b.index; });
  }

  function escapePromptExpectationTitle(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderPromptExpectations(prompt) {
    var items = extractPromptExpectations(prompt);
    if (!items.length) {
      return '<div class="test-generations-prompt-expectations">' +
        '<strong>Prompt expectations</strong>' +
        '<div class="test-generations-expectation-empty">No direct prompt attributes found.</div>' +
        '</div>';
    }
    return '<div class="test-generations-prompt-expectations">' +
      '<strong>Prompt expectations</strong>' +
      '<div class="test-generations-expectation-table">' +
      '<div class="test-generations-expectation-head"><span>Type</span><span>Target</span><span>Colour</span><span>Detail</span></div>' +
      items.map(function (item) {
        var swatch = item.color
          ? '<i class="test-generations-color-swatch" style="--test-color-swatch:' +
            (item.swatch || TEST_PROMPT_COLOR_SWATCHES[item.color] || '#808080') + '"></i>'
          : '';
        return '<div class="test-generations-expectation-row" title="' + escapePromptExpectationTitle(item.phrase) + '">' +
          '<span class="test-generations-expectation-type">' + escapeHtml(item.type) + '</span>' +
          '<span class="test-generations-expectation-target">' + escapeHtml(item.target) + '</span>' +
          '<span class="test-generations-expectation-color">' + swatch + escapeHtml(item.color || '—') + '</span>' +
          '<span class="test-generations-expectation-detail">' + escapeHtml(item.detail || '—') + '</span>' +
          '</div>';
      }).join('') +
      '</div>' +
      '<small>Only direct prompt correlations are shown. Hover a row for its full phrase.</small>' +
      '</div>';
  }


  function sessionMetaText(status) {
    if (!status || !status.session) return '';
    var parts = [];
    var modelId = String(status.modelId || status.model || '');
    var model = supportedTestModels[modelId] || {};
    var settings = status.settings && typeof status.settings === 'object' ? status.settings : status;
    if (String(status.name || '').trim()) parts.push(String(status.name).trim());
    parts.push(sessionLabel(status.session));
    if (String(model.label || '').trim()) parts.push(String(model.label).trim());
    if (settings.aspectRatio) parts.push(String(settings.aspectRatio));
    if (settings.megapixels !== undefined && settings.megapixels !== null && settings.megapixels !== '') parts.push(String(settings.megapixels) + ' MP');
    if (settings.duration !== undefined && settings.duration !== null && settings.duration !== '') parts.push(String(settings.duration) + 's');
    if (settings.dimensions) parts.push(String(settings.dimensions).trim());
    if (settings.seed !== undefined && settings.seed !== null && settings.seed !== '') parts.push('Seed ' + String(settings.seed));
    return parts.join(' · ');
  }

  function renderSessionMeta(status) {
    var summary = el('test-generations-session-meta');
    var infoBtn = el('test-generations-session-info-btn');
    var details = el('test-generations-session-details');
    var hasSession = !!(status && status.session);
    if (summary) {
      summary.textContent = hasSession ? sessionMetaText(status) : '';
      summary.classList.toggle('hidden', !hasSession);
    }
    if (infoBtn) infoBtn.classList.toggle('hidden', !hasSession);
    if (!details) return;
    if (!hasSession) {
      details.classList.add('hidden');
      details.innerHTML = '';
      return;
    }
    var resolvedPrompt = String(status.resolvedPrompt || status.prompt || '');
    var sourcePrompt = String(status.sourcePrompt || '');
    details.innerHTML = [
      '<div class="test-generations-session-info-grid">',
      renderPromptExpectations(resolvedPrompt),
      '<div class="test-generations-session-prompts">',
      '<div class="test-generations-session-prompt"><strong>Resolved prompt</strong><pre>' + escapeHtml(resolvedPrompt || '—') + '</pre></div>',
      '<div class="test-generations-session-prompt"><strong>Source prompt</strong><pre>' + escapeHtml(sourcePrompt || '—') + '</pre></div>',
      '</div>',
      '</div>'
    ].join('');
  }

  function renderStatus(status) {
    currentStatus = status || {};
    if (status && status.session) {
      currentSession = String(status.session || '');
      currentSessionFolder = String(launchFolder || '');
      currentSessionModel = String(status.modelId || status.model || currentTestModelId() || '');
      currentSessionSource = String(status.source == null ? testSource || '' : status.source);
    }
    syncActiveRunControls(status || {});
    var rateItemsBtn = el('test-generations-rate-items-btn');
    var resultFolder = String(status && status.resultFolder || '');
    if (rateItemsBtn) {
      var hasResults = !!(status && Array.isArray(status.results) && status.results.length);
      rateItemsBtn.dataset.resultFolder = resultFolder;
      rateItemsBtn.classList.toggle('hidden', !resultFolder || !hasResults);
    }
    syncSessionSelection();
    var statusEl = el('test-generations-status');
    var errorEl = el('test-generations-error');
    var live = status && (status.status === 'running' || status.status === 'stopping');
    if (statusEl) statusEl.textContent = live ? '' : statusText(status);
    if (errorEl) {
      errorEl.textContent = showSessionError && status && status.error ? String(status.error) : '';
      errorEl.classList.toggle('hidden', !errorEl.textContent);
    }
    renderSessionMeta(status || {});
    syncVisibleSessionProgress(status || {});
    renderResults(status || {});
  }

  function pollStatus() {
    if (pollTimer) clearTimeout(pollTimer);
    if (!isOpen()) return;
    request('test_status', { modelId: currentTestModelId() }).then(function (status) {
      syncActiveRunControls(status);
      refreshActivityButtonIfDue(5000);
      if (status && (status.status === 'running' || status.status === 'stopping')) showSessionError = true;
      var activeSession = String(status && status.session || '');
      var selectedWasLive = !!(
        currentSession &&
        currentSession !== activeSession &&
        currentStatus &&
        String(currentStatus.session || '') === currentSession &&
        (currentStatus.status === 'running' || currentStatus.status === 'stopping')
      );
      var previewRefresh = Promise.resolve();

      if (!currentSession || currentSession === activeSession) {
        renderStatus(status);
      } else if (selectedWasLive) {
        previewRefresh = request('test_open_session', { session: currentSession }).then(function (selectedStatus) {
          renderStatus(selectedStatus);
        });
      }

      return previewRefresh.then(function () {
        if (status && (status.status === 'running' || status.status === 'stopping')) {
          if (queuedTestJobs.length) refreshSessionsIfDue(5000).catch(showError);
          pollTimer = setTimeout(pollStatus, 2000);
          return null;
        }
        return refreshSessions().then(function () {
          if (queuedTestJobs.length && isOpen()) pollTimer = setTimeout(pollStatus, 5000);
        });
      });
    }).catch(showError);
  }

  function showError(err) {
    reportConsoleError('Test Generations', err);
    var errorEl = el('test-generations-error');
    if (errorEl) {
      errorEl.textContent = String(err && err.message ? err.message : err);
      errorEl.classList.remove('hidden');
    }
  }

  function openResultsFolder(folder, options) {
    var targetFolder = String(folder || '').replace(/^[/\\]+|[/\\]+$/g, '');
    if (!targetFolder || !state || !state.dirStack || !state.dirStack.length) return;
    var opts = options || {};
    pendingRatingFolder = opts.rateItems ? targetFolder : '';
    if (opts.rateItems) {
      pendingRatingReturn = {
        folder: String(launchFolder || ''),
        source: String(testSource || ''),
        modelId: currentTestModelId()
      };
    }
    if (typeof clearFocusSet === 'function' && state.focusSet && state.focusSet.keys && state.focusSet.keys.length) {
      clearFocusSet();
    }
    closePane();
    setWorkspaceSurface('default');
    state.dirStack = [state.dirStack[0]].concat(targetFolder.split('/').filter(Boolean).map(function (name) {
      return { name: name };
    }));
    state.folder = targetFolder;
    state.currentItem = null;
    clearEditorAndPreview();
    clearCaptionFilterInputs();
    refreshCurrentDirectory();
  }

  function isTestGenerationSessionFolder(folder) {
    var normalized = String(folder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    var marker = '/test-generations/';
    var markerIndex = normalized.indexOf(marker);
    return markerIndex > 0 && normalized.slice(markerIndex + marker.length).length > 0;
  }

  function hasOnlyUnratedFilter() {
    if (!ui || !ui.advancedFilterStarsEl) return false;
    if (String((ui.filterEl && ui.filterEl.value) || '').trim()) return false;
    if (ui.advancedFilterMissingCaptionsEl && ui.advancedFilterMissingCaptionsEl.checked) return false;
    if (ui.advancedFilterReviewedEl && ui.advancedFilterReviewedEl.checked) return false;
    if (ui.advancedFilterUnreviewedEl && ui.advancedFilterUnreviewedEl.checked) return false;
    if (ui.advancedFilterUntaggedEl && ui.advancedFilterUntaggedEl.checked) return false;
    if (ui.advancedFilterIncompleteEl && ui.advancedFilterIncompleteEl.checked) return false;
    if (ui.advancedFilterInvalidArEl && ui.advancedFilterInvalidArEl.checked) return false;
    if (ui.advancedFilterSupersetEl && ui.advancedFilterSupersetEl.checked) return false;
    if (ui.advancedFilterFlagEl && ui.advancedFilterFlagEl.querySelector('input[type="checkbox"]:checked')) return false;
    var checkedStars = Array.prototype.slice.call(
      ui.advancedFilterStarsEl.querySelectorAll('input[type="checkbox"]:checked')
    );
    return checkedStars.length === 1 && String(checkedStars[0].value || '') === 'no_star';
  }

  function finishRatingReview() {
    var sessionFolder = String(state && state.folder || '');
    if (!isTestGenerationSessionFolder(sessionFolder)) return false;
    clearCaptionFilterInputs();
    var capturedSave = typeof captureCurrentFolderStateSave === 'function'
      ? captureCurrentFolderStateSave()
      : null;
    var returnContext = pendingRatingReturn;
    pendingRatingReturn = null;
    var returnToTestGenerations = function () {
      if (returnContext) {
        openTestBenchSource(
          String(returnContext.folder || ''),
          String(returnContext.source || ''),
          String(returnContext.modelId || '')
        );
        return;
      }
      // Legacy per-set Test folders can still recover their owner from the path.
      var setFolder = owningSetFolder(sessionFolder);
      if (setFolder && setFolder !== '.webcap') openTestBenchFolder(setFolder, true);
    };
    if (capturedSave && typeof writeCapturedFolderState === 'function') {
      Promise.resolve(writeCapturedFolderState(capturedSave)).then(returnToTestGenerations, returnToTestGenerations);
    } else {
      returnToTestGenerations();
    }
    return true;
  }

  function initializeRatingReview(folder) {
    if (String(state && state.folder || '') !== String(folder || '')) return;
    clearCaptionFilterInputs();
    var noStarInput = ui && ui.advancedFilterStarsEl
      ? ui.advancedFilterStarsEl.querySelector('input[value="no_star"]')
      : null;
    if (!noStarInput) {
      setStatus('Unrated filter is unavailable.');
      return;
    }
    noStarInput.checked = true;
    renderFileList();
    var unratedItems = getFilteredMediaItems(false);
    if (!unratedItems.length) {
      finishRatingReview();
      return;
    }
    selectPathMedia(unratedItems[0]).catch(function (err) {
      setStatus(String(err && err.message ? err.message : err));
    });
  }

  function completeRatingReviewIfFinished() {
    if (!isTestGenerationSessionFolder(state && state.folder)) return false;
    if (!hasOnlyUnratedFilter()) return false;
    if (getFilteredMediaItems(false).length) return false;
    return finishRatingReview();
  }

  function closePane() {
    var node = pane();
    var frame = el('app-frame');
    if (node) node.classList.add('hidden');
    if (frame) frame.classList.remove('workspace-test-open');
    launchFolder = '';
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    refreshActivityButton();
    if (typeof window.syncApplicationShellContext === 'function') window.syncApplicationShellContext();
    if (typeof window.syncShellLocationRoute === 'function') window.syncShellLocationRoute();
  }

  function populateControls(payload) {
    var defaults = payload.defaults || {};
    var settings = Array.isArray(payload.settings) ? payload.settings : [];
    var saved = savedTestModelState();
    var savedSettings = saved.settings || {};
    var aspect = el('test-generations-aspect');
    var megapixels = el('test-generations-megapixels');
    var duration = el('test-generations-duration');
    var dimensions = el('test-generations-dimensions');
    var seed = el('test-generations-seed');
    var prompt = el('test-generations-prompt');

    [
      ['aspectRatio', 'test-generations-aspect-field'],
      ['megapixels', 'test-generations-megapixels-field'],
      ['duration', 'test-generations-duration-field'],
      ['dimensions', 'test-generations-dimensions-field'],
      ['seed', 'test-generations-seed-field']
    ].forEach(function (entry) {
      var field = el(entry[1]);
      if (field) field.classList.toggle('hidden', settings.indexOf(entry[0]) === -1);
    });

    var selectedAspect = String(savedSettings.aspectRatio || defaults.aspectRatio || '');
    var options = Array.isArray(payload.aspectRatioOptions) ? payload.aspectRatioOptions.slice() : [];
    if (selectedAspect && options.indexOf(selectedAspect) < 0) options.unshift(selectedAspect);
    if (aspect) {
      aspect.innerHTML = options.map(function (value) {
        return '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + '</option>';
      }).join('');
      aspect.value = selectedAspect;
    }
    if (megapixels) megapixels.value = String(savedSettings.megapixels || defaults.megapixels || '');
    if (duration) duration.value = String(savedSettings.duration || defaults.duration || '');
    if (dimensions) {
      var dimensionOptions = payload.settingOptions && Array.isArray(payload.settingOptions.dimensions)
        ? payload.settingOptions.dimensions.slice()
        : [];
      var selectedDimensions = String(savedSettings.dimensions || defaults.dimensions || '');
      if (selectedDimensions && dimensionOptions.indexOf(selectedDimensions) < 0) dimensionOptions.unshift(selectedDimensions);
      dimensions.innerHTML = dimensionOptions.map(function (value) {
        return '<option value="' + escapeHtml(value) + '">' + escapeHtml(String(value).trim()) + '</option>';
      }).join('');
      dimensions.value = selectedDimensions;
    }
    if (seed) seed.value = String(defaults.seed || '');
    if (prompt) {
      var draftPrompt = loadTestPromptDraft();
      prompt.value = draftPrompt !== null
        ? draftPrompt
        : (saved.prompt.trim() ? saved.prompt : String(payload.defaultPrompt || ''));
    }
  }

  function openPane() {
    if (typeof window.closeGenerateActivity === 'function') window.closeGenerateActivity();
    var node = pane();
    var frame = el('app-frame');
    var summary = el('test-generations-summary');
    var list = el('test-generations-files');
    var errorEl = el('test-generations-error');
    if (!node || !frame) throw new Error('Test Generations requires the app frame and Test workspace.');
    launchFolder = owningSetFolder(state && state.folder || '');
    var requestedModelId = currentTestModelId();
    if (pendingTestSource !== null) {
      testSource = String(pendingTestSource || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      pendingTestSource = null;
    } else {
      testSource = null;
    }
    var rememberedSession = (
      currentSession &&
      currentSessionFolder === launchFolder &&
      currentSessionModel === requestedModelId &&
      currentSessionSource === String(testSource || '')
    ) ? currentSession : '';
    if (!rememberedSession) {
      currentSession = '';
      currentSessionFolder = '';
      currentSessionModel = '';
      currentSessionSource = '';
    }
    frame.classList.add('workspace-test-open');
    node.classList.remove('hidden');
    if (typeof window.syncApplicationShellContext === 'function') window.syncApplicationShellContext();
    if (typeof window.syncShellLocationRoute === 'function') window.syncShellLocationRoute();
    if (summary) summary.textContent = 'Loading Test folder...';
    if (list) list.textContent = '';
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.classList.add('hidden');
    }
    prepared = null;
    selectedCandidates = null;
    currentStatus = {};
    showSessionError = false;
    compareIndex = 0;
    setResultsView('grid');
    renderStatus({ status: 'idle' });
    refreshActivityButton();
    if (!isTestModelSupported()) {
      if (summary) summary.textContent = 'Testing unavailable for selected Base Model.';
      if (errorEl) {
        errorEl.textContent = 'Test Generations is not available for the selected Base Model.';
        errorEl.classList.remove('hidden');
      }
      syncActiveRunControls({ status: 'idle' });
      return;
    }
    refreshTestSourceBrowser().then(function (sourcePayload) {
      if (sourcePayload && sourcePayload.navigated) return null;
      return request('test_prepare', { modelId: getWorkingModelProfileId() });
    }).then(function (payload) {
      if (!payload) return;
      prepared = payload;
      if (Array.isArray(payload.warnings)) {
        payload.warnings.forEach(function (warning) {
          if (String(warning || '').trim()) reportConsoleWarning('Test Generations', warning);
        });
      }
      renderStagedFiles(payload);
      renderSessions(payload.sessions, []);
      populateControls(payload);
      var initialStatus = payload.latest || { status: 'idle' };
      if (initialStatus.status === 'running' || initialStatus.status === 'stopping') showSessionError = true;
      syncActiveRunControls(initialStatus);
      var previewReady = rememberedSession
        ? request('test_open_session', { session: rememberedSession }).then(function (selectedStatus) {
            renderStatus(selectedStatus);
          }).catch(function (err) {
            reportConsoleWarning(
              'Test Generations',
              'Could not restore selected Test session ' + rememberedSession + ': ' +
              String(err && err.message ? err.message : err)
            );
            currentSession = '';
            currentSessionFolder = '';
            currentSessionModel = '';
            currentSessionSource = '';
            renderStatus(initialStatus);
          })
        : Promise.resolve(renderStatus(initialStatus));
      previewReady.then(function () {
        return refreshSessions();
      }).then(function () {
        if ((payload.latest && (payload.latest.status === 'running' || payload.latest.status === 'stopping')) || queuedTestJobs.length) pollStatus();
      }).catch(showError);
    }).catch(function (err) {
      if (summary) summary.textContent = 'Test Generations is unavailable.';
      showError(err);
    });
  }

  function startRun() {
    if (!isTestModelSupported()) {
      return showError(new Error('Test Generations is not available for the selected Base Model.'));
    }
    var name = String(el('test-generations-session-name') && el('test-generations-session-name').value || '').trim();
    var prompt = String(el('test-generations-prompt') && el('test-generations-prompt').value || '').trim();
    var selectedFiles = selectedCandidateFiles();
    var baseInclude = el('test-generations-base-include');
    var includeBase = !baseInclude || baseInclude.checked;
    var declaredSettings = prepared && Array.isArray(prepared.settings) ? prepared.settings : [];
    var settings = {};
    if (declaredSettings.indexOf('aspectRatio') !== -1) settings.aspectRatio = String(el('test-generations-aspect').value || '').trim();
    if (declaredSettings.indexOf('megapixels') !== -1) settings.megapixels = String(el('test-generations-megapixels').value || '').trim();
    if (declaredSettings.indexOf('duration') !== -1) settings.duration = String(el('test-generations-duration').value || '').trim();
    if (declaredSettings.indexOf('dimensions') !== -1) settings.dimensions = String(el('test-generations-dimensions').value || '');
    if (declaredSettings.indexOf('seed') !== -1) settings.seed = String(el('test-generations-seed').value || '').trim();
    if (!selectedFiles.length) return showError(new Error('Select at least one staged LoRA to test.'));
    if (!prompt) return showError(new Error('A test prompt is required.'));
    if (declaredSettings.indexOf('aspectRatio') !== -1 && !settings.aspectRatio) return showError(new Error('An aspect ratio is required.'));
    if (declaredSettings.indexOf('dimensions') !== -1 && !settings.dimensions.trim()) return showError(new Error('Dimensions are required.'));
    saveTestPromptDraft(prompt);
    saveTestBenchState(prompt);
    var runBtn = el('test-generations-run-btn');
    var errorEl = el('test-generations-error');
    if (runBtn) runBtn.disabled = true;
    if (errorEl) errorEl.classList.add('hidden');
    request('test_enqueue', {
      name: name,
      selectedFiles: selectedFiles,
      modelId: getWorkingModelProfileId(),
      includeBase: includeBase,
      prompt: prompt,
      settings: settings
    }).then(function (payload) {
      var startedStatus = payload && payload.latest ? payload.latest : null;
      var status = startedStatus || currentStatus;
      syncActiveRunControls(status);
      refreshActivityButton();
      if (startedStatus && startedStatus.session) {
        showSessionError = true;
        renderStatus(startedStatus);
      }
      var nextSeed = el('test-generations-seed');
      if (nextSeed) nextSeed.value = String(randomSeed());
      var nameInput = el('test-generations-session-name');
      if (nameInput) nameInput.value = '';
      return refreshSessions();
    }).then(function () {
      pollStatus();
    }).catch(function (err) {
      syncActiveRunControls(currentStatus);
      showError(err);
    });
  }

  function stopRun(stopBtn) {
    if (stopBtn) stopBtn.disabled = true;
    request('test_stop', { session: String(stopBtn && stopBtn.dataset.sessionStop || '') }).then(function (status) {
      syncActiveRunControls(status);
      refreshActivityButton();
      if (!currentSession || currentSession === String(status && status.session || '')) renderStatus(status);
      pollStatus();
    }).catch(function (err) {
      if (stopBtn) stopBtn.disabled = false;
      showError(err);
    });
  }

  function openSession(sessionName) {
    request('test_open_session', { session: String(sessionName || '') }).then(function (status) {
      showSessionError = true;
      renderStatus(status);
    }).catch(showError);
  }

  function deleteSession(sessionName) {
    return request('test_delete_session', { session: String(sessionName || '') }).then(function (payload) {
      renderSessions(payload && payload.sessions);
      if (currentSession === String(payload.deleted || '')) {
        currentSession = '';
        currentSessionFolder = '';
        currentSessionModel = '';
        currentSessionSource = '';
        showSessionError = false;
        renderStatus(payload.latest || { status: 'idle' });
      }
    });
  }

  function removeCandidate(fileName, sessionName) {
    return request('test_remove_candidate', {
      fileName: String(fileName || ''),
      session: String(sessionName || ''),
      modelId: getWorkingModelProfileId()
    }).then(function (payload) {
      if (prepared && String(payload.modelId || '') === String(prepared.modelId || '')) {
        prepared.count = Number(payload.count || 0);
        prepared.files = Array.isArray(payload.files) ? payload.files.slice() : [];
        renderStagedFiles(prepared);
      }
      if (payload.sessionStatus) {
        renderStatus(payload.sessionStatus);
        return null;
      }
      return request('test_status', { modelId: currentTestModelId() }).then(renderStatus);
    }).then(function () {
      return refreshSessions();
    });
  }


  function removeCurrentSessionCandidate(button) {
    var candidateFile = String(button && button.dataset.removeCandidate || '').trim();
    if (!candidateFile) return;
    var confirmed = window.confirm(
      'Remove ' + candidateFile + '?\n\n' +
      'This deletes the staged LoRA and its result from the current session. Other sessions are unchanged.'
    );
    if (!confirmed) return;
    button.disabled = true;
    removeCandidate(candidateFile, currentSession).catch(function (err) {
      button.disabled = false;
      showError(err);
    });
  }


  function bindUi() {
    var button = el('test-generations-open-btn');
    var workspace = el('test-generations-workspace');
    var node = el('test-generations-pane');
    if (!button || !workspace || !node) throw new Error('Test Generations requires its Training handoff and Test workspace markup.');

    button.onclick = function () {
      pendingTestSource = null;
      openPane();
    };
    var activityButton = el('activity-test-btn');
    if (activityButton) activityButton.oncontextmenu = openTestBenchActivityMenu;
    el('test-generations-run-btn').onclick = startRun;
    el('test-generations-source-up-btn').onclick = function () {
      if (!this.disabled) chooseTestSource(String(this.dataset.sourceParent || ''));
    };
    el('test-generations-source-path-btn').onclick = function () {
      if (String(testSource || '')) chooseTestSource('');
    };
    el('test-generations-source-folders').onclick = function (event) {
      var button = event.target.closest('[data-test-source]');
      if (button) chooseTestSource(String(button.dataset.testSource || ''));
    };
    el('test-generations-rail-toggle-btn').onclick = toggleTestRailCollapsed;
    el('test-generations-clear-queue-btn').onclick = function () { var button = this; button.disabled = true; clearQueuedTests().catch(showError).then(function () { button.disabled = false; }); };
    el('test-generations-rate-items-btn').onclick = function () {
      openResultsFolder(this.dataset.resultFolder, { rateItems: true });
    };
    el('test-generations-view-grid-btn').onclick = function () {
      setResultsView('grid');
    };
    el('test-generations-view-compare-btn').onclick = function () {
      setResultsView('compare');
    };
    el('test-generations-files').addEventListener('change', function (event) {
      var checkbox = event.target.closest('[data-candidate-select]');
      if (!checkbox) return;
      var fileName = String(checkbox.dataset.candidateSelect || '');
      if (checkbox.checked) selectedCandidates.add(fileName);
      else selectedCandidates.delete(fileName);
      syncCandidateMasterSelect(prepared && Array.isArray(prepared.files) ? prepared.files : []);
      saveTestBenchState(String(el('test-generations-prompt') && el('test-generations-prompt').value || ''));
      syncActiveRunControls(currentStatus);
    });
    el('test-generations-master-select').addEventListener('change', function () {
      var files = prepared && Array.isArray(prepared.files) ? prepared.files : [];
      var allSelected = !!files.length && files.every(function (fileName) {
        return selectedCandidates instanceof Set && selectedCandidates.has(String(fileName || ''));
      });
      selectedCandidates = allSelected ? new Set() : new Set(files);
      renderStagedFiles(prepared || { files: [], count: 0, candidateScores: {} });
      saveTestBenchState(String(el('test-generations-prompt') && el('test-generations-prompt').value || ''));
      syncActiveRunControls(currentStatus);
    });
    el('test-generations-files').onclick = function (event) {
      var button = event.target.closest('[data-file-name]');
      if (!button) return;
      button.disabled = true;
      removeCandidate(button.dataset.fileName, '').catch(function (err) {
        button.disabled = false;
        showError(err);
      });
    };
    el('test-generations-sessions-list').onclick = function (event) {
      var queueCancel = event.target.closest('[data-queue-cancel]');
      if (queueCancel) {
        queueCancel.disabled = true;
        cancelQueuedTest(queueCancel.dataset.queueCancel).catch(function (err) {
          queueCancel.disabled = false;
          showError(err);
        });
        return;
      }
      var sessionStop = event.target.closest('[data-session-stop]');
      if (sessionStop) {
        stopRun(sessionStop);
        return;
      }
      var folderOpen = event.target.closest('[data-session-folder-open]');
      if (folderOpen) {
        openResultsFolder(folderOpen.dataset.sessionFolderOpen);
        return;
      }
      var rate = event.target.closest('[data-session-rate]');
      if (rate) {
        openResultsFolder(rate.dataset.sessionRate, { rateItems: true });
        return;
      }
      var remove = event.target.closest('[data-session-delete]');
      if (remove) {
        remove.disabled = true;
        deleteSession(remove.dataset.sessionDelete).catch(function (err) {
          remove.disabled = false;
          showError(err);
        });
        return;
      }
      var row = event.target.closest('[data-session-name]');
      if (row) openSession(row.dataset.sessionName);
    };
    el('test-generations-results').onclick = function (event) {
      var rating = event.target.closest('[data-test-rating]');
      if (rating) {
        rateTestResult(rating);
        return;
      }
      var remove = event.target.closest('[data-remove-candidate]');
      if (remove) {
        removeCurrentSessionCandidate(remove);
        return;
      }
      if (event.target.closest('.test-generations-video-transport, video, button')) return;
      var card = event.target.closest('[data-compare-index]');
      if (!card) return;
      compareIndex = Number(card.dataset.compareIndex || 0);
      setResultsView('compare');
    };
    el('test-generations-compare').onclick = function (event) {
      var rating = event.target.closest('[data-test-rating]');
      if (rating) {
        rateTestResult(rating);
        return;
      }
      var remove = event.target.closest('[data-remove-candidate]');
      if (remove) {
        removeCurrentSessionCandidate(remove);
        return;
      }
      if (event.target.closest('[data-compare-previous]')) {
        compareIndex = Math.max(0, compareIndex - 1);
        renderCompare(currentStatus);
        return;
      }
      if (event.target.closest('[data-compare-next]')) {
        var results = currentStatus && Array.isArray(currentStatus.results) ? currentStatus.results : [];
        compareIndex = Math.min(Math.max(0, results.length - 2), compareIndex + 1);
        renderCompare(currentStatus);
      }
    };
    el('test-generations-prompt').addEventListener('input', function () {
      saveTestPromptDraft(this.value);
      saveTestBenchState(this.value);
    });
    ['test-generations-aspect', 'test-generations-megapixels', 'test-generations-duration', 'test-generations-dimensions'].forEach(function (id) {
      el(id).addEventListener('change', function () {
        saveTestBenchState(String(el('test-generations-prompt').value || ''));
      });
    });
    el('test-generations-info-btn').onclick = function () {
      el('test-generations-help').classList.toggle('hidden');
    };
    el('test-generations-session-info-btn').onclick = function () {
      el('test-generations-session-details').classList.toggle('hidden');
    };
    window.addEventListener('webcap:working-model-changed', function () {
      syncLaunchVisibility();
      syncActiveRunControls(currentStatus);
      if (isOpen()) openPane();
    });
    syncTestRailCollapseUi();
    syncLaunchVisibility();
    refreshSupportedTestModels().catch(showError);
    refreshActivityButton();
  }

  window.testGenerationsFolderLoaded = testGenerationsFolderLoaded;
  window.openTestBenchActivity = openTestBenchActivity;
  window.openTestBenchActivityMenu = openTestBenchActivityMenu;
  window.openTestBenchForFolder = openTestBenchForSetFolder;
  window.openTestBenchForCurrentFolder = openPane;
  window.closeTestBenchActivity = closePane;
  window.refreshTestBenchActivity = refreshActivityButton;
  window.testGenerationsRatingChanged = completeRatingReviewIfFinished;
  bindUi();
})();
