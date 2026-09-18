(function () {
  var PROFILE_ID = '__test_generations__';
  var H3_PROFILE_ID = 'minimax_h3';
  var pollTimer = null;
  var prepared = null;
  var paneFolder = '';
  var debouncedPromptSave = debounceCreate(500);

  function el(id) { return document.getElementById(id); }

  function request(mode, criteria) {
    var body = {
      folder: String(paneFolder || (state && state.folder) || ''),
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

  function syncLaunchVisibility() {
    var button = el('test-generations-open-btn');
    var select = el('training-model-profile-select');
    if (!button || !select) return;
    var available = String(select.value || '') === H3_PROFILE_ID && !!(state && state.folder);
    button.classList.toggle('hidden', !available);
  }

  function statusText(status) {
    if (!status || status.status === 'idle') return '';
    var completed = Number(status.completed || 0);
    var total = Number(status.total || 0);
    if (status.status === 'running') return 'Running ' + completed + ' / ' + total + (status.current ? ' · ' + status.current : '');
    if (status.status === 'complete') return 'Complete · ' + completed + ' / ' + total;
    if (status.status === 'failed') return 'Stopped after failure · ' + completed + ' / ' + total;
    return String(status.status || '');
  }

  function videoUrl(folder, fileName) {
    return '/caption/media?folder=' + encodeURIComponent(String(folder || '')) + '&media=' + encodeURIComponent(String(fileName || ''));
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

      var label = document.createElement('div');
      label.className = 'test-generations-result-name';
      label.textContent = String(result.sourceLoRA || outputVideo || 'Result');
      card.appendChild(label);

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
  }

  function setControlsDisabled(disabled) {
    ['test-generations-prompt', 'test-generations-aspect', 'test-generations-megapixels', 'test-generations-duration', 'test-generations-seed', 'test-generations-reset-prompt-btn'].forEach(function (id) {
      var node = el(id);
      if (node) node.disabled = !!disabled;
    });
  }

  function renderStatus(status) {
    var statusEl = el('test-generations-status');
    var errorEl = el('test-generations-error');
    var runBtn = el('test-generations-run-btn');
    var openBtn = el('test-generations-open-results-btn');
    if (statusEl) statusEl.textContent = statusText(status);
    if (errorEl) {
      errorEl.textContent = status && status.error ? String(status.error) : '';
      errorEl.classList.toggle('hidden', !errorEl.textContent);
    }
    var running = !!(status && status.status === 'running');
    if (runBtn) runBtn.disabled = running || !prepared || !prepared.count;
    setControlsDisabled(running);
    if (openBtn) {
      var resultFolder = status && status.resultFolder ? String(status.resultFolder) : '';
      openBtn.dataset.resultFolder = resultFolder;
      openBtn.classList.toggle('hidden', !resultFolder || (status.status !== 'complete' && status.status !== 'failed'));
    }
    renderResults(status || {});
  }

  function pollStatus() {
    if (pollTimer) clearTimeout(pollTimer);
    if (!isOpen()) return;
    request('test_status').then(function (status) {
      renderStatus(status);
      if (status && status.status === 'running') pollTimer = setTimeout(pollStatus, 2000);
    }).catch(showError);
  }

  function showError(err) {
    var errorEl = el('test-generations-error');
    if (errorEl) {
      errorEl.textContent = String(err && err.message ? err.message : err);
      errorEl.classList.remove('hidden');
    }
  }

  function openResults(folder) {
    var targetFolder = String(folder || '').replace(/^[/\\]+|[/\\]+$/g, '');
    if (!targetFolder || !state || !state.dirStack || !state.dirStack.length) return;
    if (typeof clearFocusSet === 'function' && state.focusSet && state.focusSet.keys && state.focusSet.keys.length) clearFocusSet();
    closePane();
    setWorkspaceSurface('default');
    state.dirStack = [state.dirStack[0]].concat(targetFolder.split('/').filter(Boolean).map(function (name) { return { name: name }; }));
    state.folder = targetFolder;
    state.currentItem = null;
    clearEditorAndPreview();
    clearCaptionFilterInputs();
    refreshCurrentDirectory();
  }

  function closePane() {
    var node = pane();
    var surface = document.querySelector('.editor-surface');
    var app = document.querySelector('.app');
    if (node) node.classList.add('hidden');
    if (surface) surface.classList.remove('test-generations-active');
    if (app) app.classList.remove('test-generations-workspace-open');
    paneFolder = '';
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
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
      var savedPrompt = String(state.testGenerationPrompt || '');
      prompt.value = running
        ? String(latest.prompt || payload.defaultPrompt || '')
        : (savedPrompt.trim() ? savedPrompt : String(payload.defaultPrompt || ''));
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
    paneFolder = String(state && state.folder || '');
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
    renderStatus({ status: 'idle' });
    request('test_prepare').then(function (payload) {
      prepared = payload;
      if (summary) summary.textContent = payload.count + ' LoRA' + (payload.count === 1 ? '' : 's') + ' staged · one frozen setting set for the whole batch.';
      var filesToggle = el('test-generations-files-toggle');
      if (filesToggle) filesToggle.textContent = 'View ' + payload.count + ' staged LoRA' + (payload.count === 1 ? '' : 's');
      if (list) list.textContent = (payload.files || []).join('\n');
      populateControls(payload);
      renderStatus(payload.latest || { status: 'idle' });
      if (payload.latest && payload.latest.status === 'running') pollStatus();
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
      renderStatus(status);
      pollStatus();
    }).catch(function (err) {
      if (runBtn) runBtn.disabled = false;
      setControlsDisabled(false);
      showError(err);
    });
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
      '<header class="test-generations-header"><div><h2>Test Generations</h2><p>MiniMax H3 · compare staged LoRAs with one frozen configuration per batch.</p></div><button id="test-generations-close-btn" type="button" class="review-captions-btn">Back</button></header>',
      '<div class="test-generations-body">',
      '<section class="test-generations-controls">',
      '<div class="test-generations-setup-overview"><div id="test-generations-summary" class="test-generations-summary">Loading H3 Test folder...</div><details><summary id="test-generations-files-toggle">View staged LoRAs</summary><pre id="test-generations-files" class="training-command-text"></pre></details></div>',
      '<label class="training-run-option test-generations-prompt"><span>Prompt</span><textarea id="test-generations-prompt" rows="5"></textarea></label>',
      '<div class="test-generations-setup-options">',
      '<div class="test-generations-settings-grid">',
      '<label class="training-run-option"><span>Aspect ratio</span><select id="test-generations-aspect"></select></label>',
      '<label class="training-run-option"><span>Resolution (MP)</span><input id="test-generations-megapixels" type="number" min="0.01" step="0.01"></label>',
      '<label class="training-run-option"><span>Duration (seconds)</span><input id="test-generations-duration" type="number" min="0.1" step="0.1"></label>',
      '<label class="training-run-option"><span>Seed</span><input id="test-generations-seed" type="number" min="0" max="9007199254740991" step="1"></label>',
      '</div>',
      '<div class="test-generations-actions"><button id="test-generations-run-btn" type="button" class="training-btn training-launch-btn">Run Tests</button><button id="test-generations-reset-prompt-btn" type="button" class="review-captions-btn">Reset Prompt</button><button id="test-generations-open-results-btn" type="button" class="review-captions-btn hidden">Open Results</button></div>',
      '<div id="test-generations-status" class="training-command-status" aria-live="polite"></div>',
      '<div id="test-generations-error" class="training-command-status hidden" aria-live="polite"></div>',
      '</div>',
      '</section>',
      '<section class="test-generations-results-section"><div class="test-generations-results-heading"><strong>Results</strong><span>Previews appear as each LoRA finishes.</span></div><div id="test-generations-results" class="test-generations-results"></div></section>',
      '</div>'
    ].join('');
    surface.appendChild(node);

    button.onclick = openPane;
    el('test-generations-close-btn').onclick = closePane;
    el('test-generations-run-btn').onclick = startRun;
    el('test-generations-prompt').addEventListener('input', function () {
      savePrompt(this.value);
    });
    el('test-generations-reset-prompt-btn').onclick = function () {
      if (!prepared) throw new Error('Test Generations prompt defaults are not loaded.');
      var prompt = String(prepared.defaultPrompt || '');
      el('test-generations-prompt').value = prompt;
      savePrompt(prompt);
    };
    el('test-generations-open-results-btn').onclick = function () { openResults(this.dataset.resultFolder || ''); };

    var select = el('training-model-profile-select');
    if (select) {
      select.addEventListener('change', syncLaunchVisibility);
      new MutationObserver(syncLaunchVisibility).observe(select, { childList: true, subtree: true });
    }
    syncLaunchVisibility();
  }

  buildUi();
})();
