(function () {
  var PROFILE_ID = '__test_generations__';
  var H3_PROFILE_ID = 'minimax_h3';
  var pollTimer = null;
  var prepared = null;
  var launchFolder = '';
  var currentSession = '';
  var currentStatus = {};
  var activeStatus = {};
  var resultsView = 'grid';
  var compareIndex = 0;
  var pendingUtilityFolder = '';
  var utilityActivity = {};
  var debouncedPromptSave = debounceCreate(500);

  function el(id) { return document.getElementById(id); }

  function request(mode, criteria) {
    var body = {
      folder: String(launchFolder || ''),
      profileId: PROFILE_ID,
      mode: mode
    };
    if (criteria) body.selection_criteria = criteria;
    return fetch('/fs/training_setup', {
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

  function capturePromptSave(prompt) {
    if (!state || String(state.folder || '') !== String(launchFolder || '')) return null;
    state.testGenerationPrompt = String(prompt || '');
    var capturedSave = captureCurrentFolderStateSave();
    if (!capturedSave) return null;
    capturedSave.snapshot.test_generation_prompt = state.testGenerationPrompt;
    return capturedSave;
  }

  function savePrompt(prompt) {
    var capturedSave = capturePromptSave(prompt);
    if (!capturedSave) return;
    debouncedPromptSave(function () {
      writeCapturedFolderState(capturedSave);
    });
  }

  function isOpen() {
    var node = pane();
    return !!(node && !node.classList.contains('hidden'));
  }

  function syncUtilityButton(payload) {
    utilityActivity = payload || {};
    var button = el('utility-test-bench-btn');
    if (!button) return;
    var active = Array.isArray(utilityActivity.active) && utilityActivity.active.length ? utilityActivity.active[0] : null;
    var current = utilityActivity.current || {};
    var targetFolder = active && active.folder ? String(active.folder) : (current.hasTestData ? String(current.folder || '') : '');
    var visible = !!targetFolder;
    button.classList.toggle('hidden', !visible);
    button.classList.toggle('test-running', !!active);
    button.classList.toggle('active', isOpen());
    button.setAttribute('aria-pressed', isOpen() ? 'true' : 'false');
    button.dataset.testBenchFolder = targetFolder;
    if (active) {
      var completed = Number(active.completed || 0);
      var total = Number(active.total || 0);
      button.title = 'Test Bench · ' + String(active.status || 'running') + ' · ' + completed + ' / ' + total;
    } else {
      button.title = 'Open Test Bench';
    }
  }

  function refreshUtilityButton() {
    var folder = String(state && state.folder || '');
    var url = '/fs/test_generations/activity' + (folder ? ('?folder=' + encodeURIComponent(folder)) : '');
    return fetch(url).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.ok === false) throw new Error(payload && payload.error ? payload.error : 'Could not read Test Bench activity.');
        syncUtilityButton(payload);
        return payload;
      });
    }).catch(function () {
      var button = el('utility-test-bench-btn');
      if (button) button.classList.add('hidden');
      return null;
    });
  }

  function openUtilityTestBench() {
    var button = el('utility-test-bench-btn');
    var folder = String(button && button.dataset.testBenchFolder || '');
    if (!folder) return;
    if (String(state && state.folder || '') === folder && state.folderStateWritable) {
      openPane();
      return;
    }
    pendingUtilityFolder = folder;
    openTrainingWorkspaceFolder(folder);
  }

  function testGenerationsFolderLoaded() {
    refreshUtilityButton();
    if (!pendingUtilityFolder) return;
    if (String(state && state.folder || '') !== String(pendingUtilityFolder)) return;
    pendingUtilityFolder = '';
    openPane();
  }

  function syncLaunchVisibility() {
    var button = el('test-generations-open-btn');
    var select = el('training-model-profile-select');
    if (!button || !select) return;
    var available = String(select.value || '') === H3_PROFILE_ID && !!(state && state.folder);
    button.classList.toggle('hidden', !available);
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
    var match = name.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})-h3$/i);
    return match ? match[1] + ' · ' + match[2] + ':' + match[3] : name;
  }

  function syncSessionSelection() {
    var host = el('test-generations-sessions-list');
    if (!host) return;
    Array.prototype.forEach.call(host.querySelectorAll('[data-session-name]'), function (row) {
      row.classList.toggle('is-active', String(row.dataset.sessionName || '') === String(currentSession || ''));
    });
  }

  function renderStagedFiles(payload) {
    var count = Number(payload && payload.count || 0);
    var files = payload && Array.isArray(payload.files) ? payload.files : [];
    var summary = el('test-generations-summary');
    var countEl = el('test-generations-files-count');
    var host = el('test-generations-files');
    if (summary) summary.textContent = count + ' LoRA' + (count === 1 ? '' : 's') + ' staged · one frozen setting set for the whole batch.';
    if (countEl) countEl.textContent = String(count);
    if (!host) return;
    host.innerHTML = '';
    if (!files.length) {
      host.innerHTML = '<div class="test-generations-library-empty">No staged LoRAs.</div>';
      return;
    }
    files.forEach(function (fileName) {
      var parts = stagedFileParts(fileName);
      var row = document.createElement('div');
      row.className = 'test-generations-staged-row';
      row.title = parts.fileName;
      var copy = document.createElement('div');
      copy.className = 'test-generations-staged-copy';
      var name = document.createElement('strong');
      name.textContent = parts.label;
      var detail = document.createElement('span');
      detail.textContent = parts.detail;
      copy.appendChild(name);
      if (parts.detail) copy.appendChild(detail);
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'test-generations-remove-candidate';
      remove.dataset.fileName = String(fileName || '');
      remove.title = 'Remove this staged Test candidate';
      remove.setAttribute('aria-label', 'Remove ' + String(fileName || 'candidate'));
      remove.textContent = '×';
      row.appendChild(copy);
      row.appendChild(remove);
      host.appendChild(row);
    });
  }

  function renderSessions(sessions) {
    var items = Array.isArray(sessions) ? sessions : [];
    var countEl = el('test-generations-sessions-count');
    var host = el('test-generations-sessions-list');
    if (countEl) countEl.textContent = String(items.length);
    if (!host) return;
    host.innerHTML = '';
    if (!items.length) {
      host.innerHTML = '<div class="test-generations-library-empty">No test sessions yet.</div>';
      return;
    }
    items.forEach(function (session) {
      var name = String(session.session || '');
      var row = document.createElement('div');
      row.className = 'test-generations-session-row';
      row.dataset.sessionName = name;
      row.title = name;

      var copy = document.createElement('div');
      copy.className = 'test-generations-session-copy';
      var title = document.createElement('strong');
      title.textContent = sessionLabel(name);
      var meta = document.createElement('span');
      var completed = Number(session.completed || 0);
      var total = Number(session.total || 0);
      var failed = Number(session.failed || 0);
      meta.textContent = String(session.status || '') + ' · ' + completed + ' / ' + total + (failed ? ' · ' + failed + ' failed' : '');
      copy.appendChild(title);
      copy.appendChild(meta);

      var actions = document.createElement('div');
      actions.className = 'test-generations-session-actions';
      var open = document.createElement('button');
      open.type = 'button';
      open.className = 'review-captions-btn';
      open.dataset.sessionOpen = name;
      open.textContent = 'Open';
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'test-generations-remove-candidate';
      remove.dataset.sessionDelete = name;
      remove.title = 'Delete this Test session';
      remove.setAttribute('aria-label', 'Delete Test session ' + name);
      remove.textContent = '×';
      actions.appendChild(open);
      actions.appendChild(remove);

      row.appendChild(copy);
      row.appendChild(actions);
      host.appendChild(row);
    });
    syncSessionSelection();
  }

  function refreshSessions() {
    return request('test_sessions').then(function (payload) {
      renderSessions(payload && payload.sessions);
      return payload;
    });
  }

  function statusText(status) {
    if (!status || status.status === 'idle') return '';
    var completed = Number(status.completed || 0);
    var total = Number(status.total || 0);
    var failed = Number(status.failed || 0);
    if (status.status === 'running') return 'Running ' + completed + ' / ' + total + (failed ? ' · ' + failed + ' failed' : '') + (status.current ? ' · ' + status.current : '');
    if (status.status === 'stopping') return 'Stopping · ' + completed + ' / ' + total;
    if (status.status === 'stopped') return 'Stopped · ' + completed + ' / ' + total;
    if (status.status === 'complete') return 'Complete · ' + completed + ' / ' + total + (failed ? ' · ' + failed + ' failed' : '');
    if (status.status === 'failed') return 'Batch failed · ' + completed + ' / ' + total;
    return String(status.status || '');
  }

  function videoUrl(folder, fileName) {
    return '/caption/media?folder=' + encodeURIComponent(String(folder || '')) + '&media=' + encodeURIComponent(String(fileName || ''));
  }

  function candidateFileForResult(result) {
    var candidateFile = String(result && result.candidateFile || '');
    if (!candidateFile && String(result && result.kind || '') !== 'base' && /\.safetensors$/i.test(String(result && result.sourceLoRA || ''))) {
      candidateFile = String(result.sourceLoRA || '');
    }
    return candidateFile;
  }

  function setResultsView(mode) {
    resultsView = mode === 'compare' ? 'compare' : 'grid';
    var gridBtn = el('test-generations-view-grid-btn');
    var compareBtn = el('test-generations-view-compare-btn');
    var grid = el('test-generations-results');
    var compare = el('test-generations-compare');
    if (gridBtn) gridBtn.classList.toggle('active', resultsView === 'grid');
    if (compareBtn) compareBtn.classList.toggle('active', resultsView === 'compare');
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
    host.innerHTML = '';

    if (results.length < 2) {
      host.innerHTML = '<div class="test-generations-empty">At least two completed results are needed to compare.</div>';
      return;
    }

    compareIndex = Math.max(0, Math.min(compareIndex, results.length - 2));
    var pair = [results[compareIndex], results[compareIndex + 1]];
    var compareKey = resultFolder + '|' + pair.map(function (result, index) {
      return String(result.outputVideo || result.sourceLoRA || ('result-' + (compareIndex + index)));
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

      var video = document.createElement('video');
      video.controls = true;
      video.preload = 'metadata';
      video.muted = true;
      video.src = videoUrl(resultFolder, String(result.outputVideo || ''));
      item.appendChild(video);
      videos.push(video);

      var footer = document.createElement('div');
      footer.className = 'test-generations-result-footer';
      var label = document.createElement('div');
      label.className = 'test-generations-result-name';
      label.textContent = String(result.sourceLoRA || result.outputVideo || 'Result');
      footer.appendChild(label);

      var candidateFile = candidateFileForResult(result);
      if (candidateFile) {
        var remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'test-generations-remove-candidate';
        remove.dataset.removeCandidate = candidateFile;
        remove.title = 'Remove this candidate and its current Test render';
        remove.setAttribute('aria-label', 'Remove candidate ' + candidateFile);
        remove.textContent = '×';
        footer.appendChild(remove);
      }

      item.appendChild(footer);
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
    syncCompareVideos(videos);
  }

  function renderResults(status) {
    var host = el('test-generations-results');
    if (!host) return;
    var results = status && Array.isArray(status.results) ? status.results : [];
    var total = Number(status && status.total || (prepared && prepared.count) || 0);
    var resultFolder = String(status && status.resultFolder || '');
    var priorFolder = String(host.dataset.resultFolder || '');

    if (priorFolder !== resultFolder) {
      host.innerHTML = '';
      host.dataset.resultFolder = resultFolder;
    }

    var validKeys = results.map(function (result, index) {
      var outputVideo = String(result.outputVideo || '');
      return outputVideo || (String(result.sourceLoRA || 'result') + ':' + index);
    });
    Array.prototype.forEach.call(
      host.querySelectorAll('.test-generations-result-card:not(.is-pending)'),
      function (card) {
        if (validKeys.indexOf(String(card.dataset.resultKey || '')) === -1) card.remove();
      }
    );

    var empty = host.querySelector('.test-generations-empty');
    if ((results.length || (status && status.status === 'running')) && empty) empty.remove();

    results.forEach(function (result, index) {
      var outputVideo = String(result.outputVideo || '');
      var resultKey = outputVideo || (String(result.sourceLoRA || 'result') + ':' + index);
      var exists = Array.prototype.some.call(
        host.querySelectorAll('.test-generations-result-card:not(.is-pending)'),
        function (card) { return card.dataset.resultKey === resultKey; }
      );
      if (exists) return;

      var card = document.createElement('article');
      card.className = 'test-generations-result-card';
      card.dataset.resultKey = resultKey;
      card.dataset.compareIndex = String(index);

      if (resultFolder && outputVideo) {
        var video = document.createElement('video');
        video.controls = true;
        video.preload = 'metadata';
        video.src = videoUrl(resultFolder, outputVideo);
        card.appendChild(video);
      } else {
        var placeholder = document.createElement('div');
        placeholder.className = 'test-generations-preview-placeholder';
        placeholder.textContent = 'Preview unavailable';
        card.appendChild(placeholder);
      }

      var footer = document.createElement('div');
      footer.className = 'test-generations-result-footer';
      var label = document.createElement('div');
      label.className = 'test-generations-result-name';
      label.textContent = String(result.sourceLoRA || outputVideo || 'Result');
      footer.appendChild(label);

      var candidateFile = candidateFileForResult(result);
      if (candidateFile) {
        var remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'test-generations-remove-candidate';
        remove.dataset.removeCandidate = candidateFile;
        remove.title = 'Remove this candidate and its current Test render';
        remove.setAttribute('aria-label', 'Remove candidate ' + candidateFile);
        remove.textContent = '×';
        footer.appendChild(remove);
      }
      card.appendChild(footer);

      var pending = host.querySelector('.test-generations-result-card.is-pending');
      host.insertBefore(card, pending || null);
    });

    var pending = host.querySelector('.test-generations-result-card.is-pending');
    if (status && status.status === 'running' && results.length < total) {
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

    if (!results.length && !(status && status.status === 'running') && !host.querySelector('.test-generations-result-card')) {
      host.innerHTML = '<div class="test-generations-empty">Generated previews will appear here.</div>';
    }

    if (resultsView === 'compare') renderCompare(status || {});
  }

  function setRunSettingsDisabled(disabled) {
    ['test-generations-aspect', 'test-generations-megapixels', 'test-generations-duration', 'test-generations-seed'].forEach(function (id) {
      var node = el(id);
      if (node) node.disabled = !!disabled;
    });
  }

  function syncActiveRunControls(status) {
    activeStatus = status || {};
    var running = !!(status && status.status === 'running');
    var stopping = !!(status && status.status === 'stopping');
    var active = running || stopping;
    var runBtn = el('test-generations-run-btn');
    var stopBtn = el('test-generations-stop-btn');
    if (runBtn) runBtn.disabled = active || !prepared || !prepared.count;
    if (stopBtn) {
      stopBtn.classList.toggle('hidden', !active);
      stopBtn.disabled = stopping;
    }
    setRunSettingsDisabled(active);
  }

  function renderStatus(status) {
    currentStatus = status || {};
    if (status) currentSession = String(status.session || '');
    syncSessionSelection();
    var statusEl = el('test-generations-status');
    var errorEl = el('test-generations-error');
    if (statusEl) statusEl.textContent = statusText(status);
    if (errorEl) {
      errorEl.textContent = status && status.error ? String(status.error) : '';
      errorEl.classList.toggle('hidden', !errorEl.textContent);
    }
    renderResults(status || {});
  }

  function pollStatus() {
    if (pollTimer) clearTimeout(pollTimer);
    if (!isOpen()) return;
    request('test_status').then(function (status) {
      syncActiveRunControls(status);
      refreshUtilityButton();
      var activeSession = String(status && status.session || '');
      if (!currentSession || currentSession === activeSession) {
        renderStatus(status);
      }
      if (status && (status.status === 'running' || status.status === 'stopping')) {
        pollTimer = setTimeout(pollStatus, 2000);
      } else {
        refreshSessions().catch(showError);
      }
    }).catch(showError);
  }

  function showError(err) {
    var errorEl = el('test-generations-error');
    if (errorEl) {
      errorEl.textContent = String(err && err.message ? err.message : err);
      errorEl.classList.remove('hidden');
    }
  }

  function closePane() {
    var node = pane();
    var surface = document.querySelector('.editor-surface');
    var app = document.querySelector('.app');
    if (node) node.classList.add('hidden');
    if (surface) surface.classList.remove('test-generations-active');
    if (app) app.classList.remove('test-generations-workspace-open');
    launchFolder = '';
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    refreshUtilityButton();
  }

  function populateControls(payload) {
    var latest = payload.latest || {};
    var running = latest.status === 'running';
    var defaults = payload.defaults || {};
    var aspect = el('test-generations-aspect');
    var megapixels = el('test-generations-megapixels');
    var duration = el('test-generations-duration');
    var seed = el('test-generations-seed');
    var prompt = el('test-generations-prompt');
    var selectedAspect = running ? String(latest.aspectRatio || defaults.aspectRatio || '') : String(defaults.aspectRatio || '');
    var options = Array.isArray(payload.aspectRatioOptions) ? payload.aspectRatioOptions.slice() : [];
    if (selectedAspect && options.indexOf(selectedAspect) < 0) options.unshift(selectedAspect);
    if (aspect) {
      aspect.innerHTML = options.map(function (value) {
        return '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + '</option>';
      }).join('');
      aspect.value = selectedAspect;
    }
    if (megapixels) megapixels.value = String(running ? latest.megapixels : defaults.megapixels);
    if (duration) duration.value = String(running ? latest.duration : defaults.duration);
    if (seed) seed.value = String(running ? latest.seed : defaults.seed);
    if (prompt) {
      var savedPrompt = state && String(state.folder || '') === String(launchFolder || '')
        ? String(state.testGenerationPrompt || '')
        : '';
      prompt.value = savedPrompt.trim()
        ? savedPrompt
        : (running ? String(latest.prompt || payload.defaultPrompt || '') : String(payload.defaultPrompt || ''));
    }
  }

  function openPane() {
    var node = pane();
    var surface = document.querySelector('.editor-surface');
    var app = document.querySelector('.app');
    var summary = el('test-generations-summary');
    var list = el('test-generations-files');
    var errorEl = el('test-generations-error');
    if (!node || !surface || !app) throw new Error('Test Generations requires the app shell, editor surface, and test pane.');
    launchFolder = String(state && state.folder || '');
    surface.classList.add('test-generations-active');
    app.classList.add('test-generations-workspace-open');
    node.classList.remove('hidden');
    if (summary) summary.textContent = 'Loading H3 Test folder...';
    if (list) list.textContent = '';
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.classList.add('hidden');
    }
    prepared = null;
    currentSession = '';
    currentStatus = {};
    activeStatus = {};
    compareIndex = 0;
    setResultsView('grid');
    renderStatus({ status: 'idle' });
    request('test_prepare').then(function (payload) {
      prepared = payload;
      renderStagedFiles(payload);
      renderSessions(payload.sessions);
      populateControls(payload);
      syncActiveRunControls(payload.latest || { status: 'idle' });
      renderStatus(payload.latest || { status: 'idle' });
      if (payload.latest && (payload.latest.status === 'running' || payload.latest.status === 'stopping')) pollStatus();
    }).catch(function (err) {
      if (summary) summary.textContent = 'Test Generations is unavailable.';
      showError(err);
    });
  }

  function startRun() {
    var prompt = String(el('test-generations-prompt') && el('test-generations-prompt').value || '').trim();
    var aspectRatio = String(el('test-generations-aspect') && el('test-generations-aspect').value || '').trim();
    var megapixels = String(el('test-generations-megapixels') && el('test-generations-megapixels').value || '').trim();
    var duration = String(el('test-generations-duration') && el('test-generations-duration').value || '').trim();
    var seed = String(el('test-generations-seed') && el('test-generations-seed').value || '').trim();
    if (!prompt) return showError(new Error('A test prompt is required.'));
    savePrompt(prompt);
    if (!aspectRatio) return showError(new Error('An aspect ratio is required.'));
    var runBtn = el('test-generations-run-btn');
    var errorEl = el('test-generations-error');
    if (runBtn) runBtn.disabled = true;
    if (errorEl) errorEl.classList.add('hidden');
    request('test_start', {
      prompt: prompt,
      aspectRatio: aspectRatio,
      megapixels: megapixels,
      duration: duration,
      seed: seed
    }).then(function (status) {
      syncActiveRunControls(status);
      refreshUtilityButton();
      renderStatus(status);
      pollStatus();
    }).catch(function (err) {
      if (runBtn) runBtn.disabled = false;
      setRunSettingsDisabled(false);
      showError(err);
    });
  }

  function stopRun() {
    var stopBtn = el('test-generations-stop-btn');
    if (stopBtn) stopBtn.disabled = true;
    request('test_stop').then(function (status) {
      syncActiveRunControls(status);
      refreshUtilityButton();
      if (!currentSession || currentSession === String(status && status.session || '')) renderStatus(status);
      pollStatus();
    }).catch(function (err) {
      if (stopBtn) stopBtn.disabled = false;
      showError(err);
    });
  }

  function openSession(sessionName) {
    request('test_open_session', { session: String(sessionName || '') }).then(function (status) {
      renderStatus(status);
    }).catch(showError);
  }

  function deleteSession(sessionName) {
    request('test_delete_session', { session: String(sessionName || '') }).then(function (payload) {
      renderSessions(payload && payload.sessions);
      if (currentSession === String(payload.deleted || '')) {
        currentSession = '';
        renderStatus(payload.latest || { status: 'idle' });
      }
    }).catch(showError);
  }

  function removeCandidate(fileName) {
    request('test_remove_candidate', {
      fileName: String(fileName || ''),
      session: String(currentSession || '')
    }).then(function (payload) {
      if (prepared) {
        prepared.count = Number(payload.count || 0);
        prepared.files = Array.isArray(payload.files) ? payload.files.slice() : [];
        renderStagedFiles(prepared);
      }
      if (payload.sessionStatus) {
        renderStatus(payload.sessionStatus);
        return null;
      }
      return request('test_status').then(renderStatus);
    }).then(function () {
      return refreshSessions();
    }).catch(showError);
  }

  function buildUi() {
    if (el('test-generations-open-btn')) return;
    var actions = el('training-tests-actions');
    var surface = document.querySelector('.editor-surface');
    if (!actions || !surface) throw new Error('Test Generations requires the Training Tests stage and editor surface.');

    var button = document.createElement('button');
    button.id = 'test-generations-open-btn';
    button.type = 'button';
    button.className = 'review-captions-btn training-workflow-action hidden';
    button.textContent = 'Open Test Bench';
    button.title = 'Compare staged H3 LoRAs with frozen generation settings.';
    actions.appendChild(button);

    var node = document.createElement('section');
    node.id = 'test-generations-pane';
    node.className = 'test-generations-pane hidden';
    node.setAttribute('aria-label', 'Test Generations');
    node.innerHTML = [
      '<div class="test-generations-body">',
      '<aside class="test-generations-rail">',
      '<header class="test-generations-header"><div><h2>Test Generations</h2><p>MiniMax H3 · one frozen configuration per batch.</p></div><button id="test-generations-close-btn" type="button" class="review-captions-btn">Back</button></header>',
      '<section class="test-generations-controls">',
      '<div class="test-generations-setup-overview"><div id="test-generations-summary" class="test-generations-summary">Loading H3 Test folder...</div></div>',
      '<label class="training-run-option test-generations-prompt"><span>Prompt</span><textarea id="test-generations-prompt" rows="5"></textarea></label>',
      '<div class="test-generations-setup-options">',
      '<div class="test-generations-settings-grid">',
      '<label class="training-run-option"><span>Aspect ratio</span><select id="test-generations-aspect"></select></label>',
      '<label class="training-run-option"><span>Resolution (MP)</span><input id="test-generations-megapixels" type="number" min="0.01" step="0.01"></label>',
      '<label class="training-run-option"><span>Duration (seconds)</span><input id="test-generations-duration" type="number" min="0.1" step="0.1"></label>',
      '<label class="training-run-option"><span>Seed</span><input id="test-generations-seed" type="number" min="0" max="9007199254740991" step="1"></label>',
      '</div>',
      '<div class="test-generations-actions"><button id="test-generations-run-btn" type="button" class="training-btn training-launch-btn">Run Tests</button><button id="test-generations-stop-btn" type="button" class="review-captions-btn hidden">Stop</button><button id="test-generations-reset-prompt-btn" type="button" class="review-captions-btn">Reset Prompt</button></div>',
      '<div id="test-generations-status" class="training-command-status" aria-live="polite"></div>',
      '<div id="test-generations-error" class="training-command-status hidden" aria-live="polite"></div>',
      '<section class="test-generations-library">',
      '<div class="test-generations-library-panel"><div class="test-generations-library-heading"><strong>Staged LoRAs</strong><span id="test-generations-files-count">0</span></div><div id="test-generations-files" class="test-generations-staged-list"></div></div>',
      '<div class="test-generations-library-panel test-generations-sessions"><div class="test-generations-library-heading"><strong>Sessions</strong><span id="test-generations-sessions-count">0</span></div><div id="test-generations-sessions-list" class="test-generations-sessions-list"></div></div>',
      '</section>',
      '</div>',
      '</section>',
      '</aside>',
      '<section class="test-generations-results-section"><div class="test-generations-results-heading"><strong>Results</strong><div class="test-generations-view-toggle"><button id="test-generations-view-grid-btn" type="button" class="review-captions-btn active">Grid</button><button id="test-generations-view-compare-btn" type="button" class="review-captions-btn">Compare</button></div><span>Previews appear as each LoRA finishes.</span></div><div id="test-generations-results" class="test-generations-results"></div><div id="test-generations-compare" class="test-generations-compare hidden"></div></section>',
      '</div>'
    ].join('');
    surface.appendChild(node);

    button.onclick = openPane;
    el('test-generations-close-btn').onclick = closePane;
    ['sidebar-open-training-btn', 'utility-training-btn'].forEach(function (id) {
      el(id).addEventListener('click', function () {
        if (isOpen()) closePane();
      });
    });
    el('test-generations-run-btn').onclick = startRun;
    var utilityButton = el('utility-test-bench-btn');
    if (utilityButton) utilityButton.onclick = openUtilityTestBench;
    el('test-generations-stop-btn').onclick = stopRun;
    el('test-generations-view-grid-btn').onclick = function () {
      setResultsView('grid');
    };
    el('test-generations-view-compare-btn').onclick = function () {
      setResultsView('compare');
    };
    el('test-generations-files').onclick = function (event) {
      var button = event.target.closest('[data-file-name]');
      if (!button) return;
      button.disabled = true;
      removeCandidate(button.dataset.fileName);
    };
    el('test-generations-sessions-list').onclick = function (event) {
      var open = event.target.closest('[data-session-open]');
      if (open) {
        openSession(open.dataset.sessionOpen);
        return;
      }
      var remove = event.target.closest('[data-session-delete]');
      if (remove) {
        remove.disabled = true;
        deleteSession(remove.dataset.sessionDelete);
      }
    };
    el('test-generations-results').onclick = function (event) {
      var remove = event.target.closest('[data-remove-candidate]');
      if (remove) {
        remove.disabled = true;
        removeCandidate(remove.dataset.removeCandidate);
        return;
      }
      if (event.target.closest('video, button')) return;
      var card = event.target.closest('[data-compare-index]');
      if (!card) return;
      compareIndex = Number(card.dataset.compareIndex || 0);
      setResultsView('compare');
    };
    el('test-generations-compare').onclick = function (event) {
      var remove = event.target.closest('[data-remove-candidate]');
      if (remove) {
        remove.disabled = true;
        removeCandidate(remove.dataset.removeCandidate);
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
      savePrompt(this.value);
    });
    el('test-generations-reset-prompt-btn').onclick = function () {
      if (!prepared) throw new Error('Test Generations prompt defaults are not loaded.');
      var prompt = String(prepared.defaultPrompt || '');
      el('test-generations-prompt').value = prompt;
      savePrompt(prompt);
    };

    var select = el('training-model-profile-select');
    if (select) {
      select.addEventListener('change', syncLaunchVisibility);
      new MutationObserver(syncLaunchVisibility).observe(select, { childList: true, subtree: true });
    }
    syncLaunchVisibility();
    refreshUtilityButton();
  }

  window.testGenerationsFolderLoaded = testGenerationsFolderLoaded;
  window.refreshTestBenchUtility = refreshUtilityButton;
  buildUi();
})();
