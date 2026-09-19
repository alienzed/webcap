(function () {
  var PROFILE_ID = '__test_generations__';
  var H3_PROFILE_ID = 'minimax_h3';
  var pollTimer = null;
  var prepared = null;
  var launchFolder = '';
  var currentSession = '';
  var currentStatus = {};
  var resultsView = 'grid';
  var compareIndex = 0;
  var pendingActivityFolder = '';
  var testActivity = {};
  var debouncedPromptSave = debounceCreate(500);

  function el(id) { return document.getElementById(id); }

  function owningSetFolder(folder) {
    var value = String(folder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    var marker = '/test-generations/';
    var index = value.indexOf(marker);
    return index === -1 ? value : value.slice(0, index);
  }

  function request(mode, criteria) {
    var body = {
      folder: owningSetFolder(launchFolder || (state && state.folder) || ''),
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

  function currentPersistedSettings() {
    return {
      aspectRatio: String(el('test-generations-aspect') && el('test-generations-aspect').value || '').trim(),
      megapixels: Number(el('test-generations-megapixels') && el('test-generations-megapixels').value || 0),
      duration: Number(el('test-generations-duration') && el('test-generations-duration').value || 0)
    };
  }

  function captureTestBenchSave(prompt) {
    if (!state || String(state.folder || '') !== String(launchFolder || '')) return null;
    state.testGenerationPrompt = String(prompt || '');
    state.testGenerationSettings = currentPersistedSettings();
    var capturedSave = captureCurrentFolderStateSave();
    if (!capturedSave) return null;
    capturedSave.snapshot.test_generation_prompt = state.testGenerationPrompt;
    capturedSave.snapshot.test_generation_settings = JSON.parse(JSON.stringify(state.testGenerationSettings));
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
    var values = new Uint32Array(2);
    window.crypto.getRandomValues(values);
    return ((values[0] & 0x1fffff) * 4294967296) + values[1];
  }

  function isOpen() {
    var node = pane();
    return !!(node && !node.classList.contains('hidden'));
  }

  function syncActivityButton(payload) {
    testActivity = payload || {};
    var activityButton = el('activity-test-btn');
    if (!activityButton) return;
    var active = Array.isArray(testActivity.active) && testActivity.active.length ? testActivity.active[0] : null;
    var current = testActivity.current || {};
    var targetFolder = active && active.folder ? String(active.folder) : (current.hasTestData ? String(current.folder || '') : '');
    var visible = !!targetFolder;
    activityButton.classList.toggle('hidden', !visible);
    activityButton.classList.toggle('test-running', !!active);
    activityButton.classList.toggle('active', isOpen());
    activityButton.setAttribute('aria-pressed', isOpen() ? 'true' : 'false');
    activityButton.dataset.testBenchFolder = targetFolder;
    if (active) {
      var completed = Number(active.completed || 0);
      var total = Number(active.total || 0);
      activityButton.title = 'Test Bench · ' + String(active.status || 'running') + ' · ' + completed + ' / ' + total;
    } else {
      activityButton.title = 'Open Test Bench';
    }
    if (typeof window.syncApplicationShellContext === 'function') window.syncApplicationShellContext();
    if (typeof window.syncShellLocationRoute === 'function') window.syncShellLocationRoute();
    if (typeof window.syncShellLocationRoute === 'function') window.syncShellLocationRoute();
  }

  function refreshActivityButton() {
    var folder = String(state && state.folder || '');
    var url = '/fs/test_generations/activity' + (folder ? ('?folder=' + encodeURIComponent(folder)) : '');
    return fetch(url).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.ok === false) throw new Error(payload && payload.error ? payload.error : 'Could not read Test Bench activity.');
        syncActivityButton(payload);
        return payload;
      });
    }).catch(function () {
      var activityButton = el('activity-test-btn');
      if (activityButton) activityButton.classList.add('hidden');
      return null;
    });
  }

  function openTestBenchActivity() {
    var button = el('activity-test-btn');
    var folder = String(button && button.dataset.testBenchFolder || '');
    if (!folder) return;
    if (String(state && state.folder || '') === folder && state.folderStateWritable) {
      openPane();
      return;
    }
    pendingActivityFolder = folder;
    openTrainingWorkspaceFolder(folder);
  }

  function testGenerationsFolderLoaded() {
    refreshActivityButton();
    if (!pendingActivityFolder) return;
    if (String(state && state.folder || '') !== String(pendingActivityFolder)) return;
    pendingActivityFolder = '';
    openPane();
  }

  function syncLaunchVisibility() {
    var button = el('test-generations-open-btn');
    if (!button) return;
    var hasFolder = !!(state && state.folder);
    var supported = getWorkingModelProfileId() === H3_PROFILE_ID;
    button.classList.toggle('hidden', !hasFolder);
    button.disabled = hasFolder && !supported;
    button.textContent = supported ? 'Open Test Bench' : 'H3 Test Only';
    button.title = supported
      ? 'Compare staged H3 LoRAs with frozen generation settings.'
      : 'Test Bench currently supports MiniMax H3 only. Select MiniMax H3 as the working model to open it.';
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
    if (summary) summary.textContent = count + ' LoRA' + (count === 1 ? '' : 's') + ' staged';
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

    if (results.length < 2) {
      host.dataset.compareKey = '';
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

  function syncActiveRunControls(status) {
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
  }

  function sessionMetaText(status) {
    if (!status || !status.session) return '';
    var parts = [sessionLabel(status.session)];
    if (status.aspectRatio) parts.push(String(status.aspectRatio));
    if (status.megapixels !== undefined && status.megapixels !== null && status.megapixels !== '') parts.push(String(status.megapixels) + ' MP');
    if (status.duration !== undefined && status.duration !== null && status.duration !== '') parts.push(String(status.duration) + 's');
    if (status.seed !== undefined && status.seed !== null && status.seed !== '') parts.push('Seed ' + String(status.seed));
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
      '<div class="test-generations-session-detail-grid">',
      '<div><span>Status</span><strong>' + escapeHtml(String(status.status || '')) + '</strong></div>',
      '<div><span>Aspect ratio</span><strong>' + escapeHtml(String(status.aspectRatio || '—')) + '</strong></div>',
      '<div><span>Resolution</span><strong>' + escapeHtml(status.megapixels !== undefined && status.megapixels !== null ? String(status.megapixels) + ' MP' : '—') + '</strong></div>',
      '<div><span>Duration</span><strong>' + escapeHtml(status.duration !== undefined && status.duration !== null ? String(status.duration) + 's' : '—') + '</strong></div>',
      '<div><span>Seed</span><strong>' + escapeHtml(status.seed !== undefined && status.seed !== null ? String(status.seed) : '—') + '</strong></div>',
      '</div>',
      '<div class="test-generations-session-prompt"><strong>Resolved prompt</strong><pre>' + escapeHtml(resolvedPrompt || '—') + '</pre></div>',
      '<div class="test-generations-session-prompt"><strong>Source prompt</strong><pre>' + escapeHtml(sourcePrompt || '—') + '</pre></div>'
    ].join('');
  }

  function renderStatus(status) {
    currentStatus = status || {};
    if (status) currentSession = String(status.session || '');
    syncActiveRunControls(status || {});
    syncSessionSelection();
    var statusEl = el('test-generations-status');
    var errorEl = el('test-generations-error');
    if (statusEl) statusEl.textContent = statusText(status);
    if (errorEl) {
      errorEl.textContent = status && status.error ? String(status.error) : '';
      errorEl.classList.toggle('hidden', !errorEl.textContent);
    }
    renderSessionMeta(status || {});
    renderResults(status || {});
  }

  function pollStatus() {
    if (pollTimer) clearTimeout(pollTimer);
    if (!isOpen()) return;
    request('test_status').then(function (status) {
      syncActiveRunControls(status);
      refreshActivityButton();
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
    var aspect = el('test-generations-aspect');
    var megapixels = el('test-generations-megapixels');
    var duration = el('test-generations-duration');
    var seed = el('test-generations-seed');
    var prompt = el('test-generations-prompt');
    var savedSettings = state && String(state.folder || '') === String(launchFolder || '') && state.testGenerationSettings
      ? state.testGenerationSettings
      : {};
    var selectedAspect = String(savedSettings.aspectRatio || defaults.aspectRatio || '');
    var options = Array.isArray(payload.aspectRatioOptions) ? payload.aspectRatioOptions.slice() : [];
    if (selectedAspect && options.indexOf(selectedAspect) < 0) options.unshift(selectedAspect);
    if (aspect) {
      aspect.innerHTML = options.map(function (value) {
        return '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + '</option>';
      }).join('');
      aspect.value = selectedAspect;
    }
    if (megapixels) megapixels.value = String(savedSettings.megapixels || defaults.megapixels);
    if (duration) duration.value = String(savedSettings.duration || defaults.duration);
    if (seed) seed.value = String(defaults.seed);
    if (prompt) {
      var savedPrompt = state && String(state.folder || '') === String(launchFolder || '')
        ? String(state.testGenerationPrompt || '')
        : '';
      prompt.value = savedPrompt.trim() ? savedPrompt : String(payload.defaultPrompt || '');
    }
  }

  function openPane() {
    var node = pane();
    var frame = el('app-frame');
    var summary = el('test-generations-summary');
    var list = el('test-generations-files');
    var errorEl = el('test-generations-error');
    if (!node || !frame) throw new Error('Test Generations requires the app frame and Test workspace.');
    launchFolder = owningSetFolder(state && state.folder || '');
    frame.classList.add('workspace-test-open');
    node.classList.remove('hidden');
    if (typeof window.syncApplicationShellContext === 'function') window.syncApplicationShellContext();
    if (typeof window.syncShellLocationRoute === 'function') window.syncShellLocationRoute();
    if (summary) summary.textContent = 'Loading H3 Test folder...';
    if (list) list.textContent = '';
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.classList.add('hidden');
    }
    prepared = null;
    currentSession = '';
    currentStatus = {};
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
    saveTestBenchState(prompt);
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
      refreshActivityButton();
      renderStatus(status);
      var nextSeed = el('test-generations-seed');
      if (nextSeed) nextSeed.value = String(randomSeed());
      pollStatus();
    }).catch(function (err) {
      if (runBtn) runBtn.disabled = false;
      showError(err);
    });
  }

  function stopRun() {
    var stopBtn = el('test-generations-stop-btn');
    if (stopBtn) stopBtn.disabled = true;
    request('test_stop').then(function (status) {
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

  function bindUi() {
    var button = el('test-generations-open-btn');
    var workspace = el('test-generations-workspace');
    var node = el('test-generations-pane');
    if (!button || !workspace || !node) throw new Error('Test Generations requires its Training handoff and Test workspace markup.');

    button.onclick = openPane;
    el('test-generations-run-btn').onclick = startRun;
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
      saveTestBenchState(this.value);
    });
    ['test-generations-aspect', 'test-generations-megapixels', 'test-generations-duration'].forEach(function (id) {
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
    el('test-generations-reset-prompt-btn').onclick = function () {
      if (!prepared) throw new Error('Test Generations defaults are not loaded.');
      var defaults = prepared.defaults || {};
      var prompt = String(prepared.defaultPrompt || '');
      el('test-generations-prompt').value = prompt;
      el('test-generations-aspect').value = String(defaults.aspectRatio || '');
      el('test-generations-megapixels').value = String(defaults.megapixels || '');
      el('test-generations-duration').value = String(defaults.duration || '');
      el('test-generations-seed').value = String(randomSeed());
      saveTestBenchState(prompt);
    };

    window.addEventListener('webcap:working-model-changed', syncLaunchVisibility);
    syncLaunchVisibility();
    refreshActivityButton();
  }

  window.testGenerationsFolderLoaded = testGenerationsFolderLoaded;
  window.openTestBenchActivity = openTestBenchActivity;
  window.openTestBenchForCurrentFolder = openPane;
  window.closeTestBenchActivity = closePane;
  window.refreshTestBenchActivity = refreshActivityButton;
  bindUi();
})();
