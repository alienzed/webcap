(function () {
  var PROFILE_ID = '__test_generations__';
  var H3_PROFILE_ID = 'minimax_h3';
  var pollTimer = null;
  var prepared = null;

  function el(id) { return document.getElementById(id); }

  function request(mode, extra) {
    var body = {
      folder: String(state && state.folder || ''),
      profileId: PROFILE_ID,
      mode: mode
    };
    if (extra && extra.prompt != null) {
      body.selection_criteria = { prompt: String(extra.prompt || '') };
    }
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

  function isOpen() {
    var modal = el('test-generations-modal');
    return !!(modal && !modal.classList.contains('hidden'));
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
    if (status.status === 'running') {
      return 'Running ' + completed + ' / ' + total + (status.current ? ' · ' + status.current : '');
    }
    if (status.status === 'complete') return 'Complete · ' + completed + ' / ' + total;
    if (status.status === 'failed') return 'Stopped after failure · ' + completed + ' / ' + total;
    return String(status.status || '');
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
    if (openBtn) {
      var resultFolder = status && status.resultFolder ? String(status.resultFolder) : '';
      openBtn.dataset.resultFolder = resultFolder;
      openBtn.classList.toggle('hidden', !resultFolder || (status.status !== 'complete' && status.status !== 'failed'));
    }
  }

  function pollStatus() {
    if (pollTimer) clearTimeout(pollTimer);
    if (!isOpen()) return;
    request('test_status').then(function (status) {
      renderStatus(status);
      if (status && status.status === 'running') {
        pollTimer = setTimeout(pollStatus, 2000);
      }
    }).catch(function (err) {
      var errorEl = el('test-generations-error');
      if (errorEl) {
        errorEl.textContent = String(err && err.message ? err.message : err);
        errorEl.classList.remove('hidden');
      }
    });
  }

  function openResults(folder) {
    var targetFolder = String(folder || '').replace(/^[/\\]+|[/\\]+$/g, '');
    if (!targetFolder || !state || !state.dirStack || !state.dirStack.length) return;
    if (typeof clearFocusSet === 'function' && state.focusSet && state.focusSet.keys && state.focusSet.keys.length) {
      clearFocusSet();
    }
    closeModal();
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

  function closeModal() {
    var modal = el('test-generations-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function openModal() {
    var modal = el('test-generations-modal');
    var summary = el('test-generations-summary');
    var list = el('test-generations-files');
    var prompt = el('test-generations-prompt');
    var errorEl = el('test-generations-error');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
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
      if (summary) {
        summary.textContent = payload.count + ' LoRA' + (payload.count === 1 ? '' : 's') + ' queued from the H3 Test folder, in filename order.';
      }
      if (list) list.textContent = (payload.files || []).join('\n');
      if (prompt && !prompt.value.trim()) prompt.value = String(payload.defaultPrompt || '');
      renderStatus(payload.latest || { status: 'idle' });
      if (payload.latest && payload.latest.status === 'running') pollStatus();
    }).catch(function (err) {
      if (summary) summary.textContent = 'Test Generations is unavailable.';
      if (errorEl) {
        errorEl.textContent = String(err && err.message ? err.message : err);
        errorEl.classList.remove('hidden');
      }
    });
  }

  function startRun() {
    var prompt = el('test-generations-prompt');
    var runBtn = el('test-generations-run-btn');
    var errorEl = el('test-generations-error');
    var value = String(prompt && prompt.value || '').trim();
    if (!value) {
      if (errorEl) {
        errorEl.textContent = 'A test prompt is required.';
        errorEl.classList.remove('hidden');
      }
      return;
    }
    if (runBtn) runBtn.disabled = true;
    if (errorEl) errorEl.classList.add('hidden');
    request('test_start', { prompt: value }).then(function (status) {
      renderStatus(status);
      pollStatus();
    }).catch(function (err) {
      if (runBtn) runBtn.disabled = false;
      if (errorEl) {
        errorEl.textContent = String(err && err.message ? err.message : err);
        errorEl.classList.remove('hidden');
      }
    });
  }

  function buildUi() {
    if (el('test-generations-open-btn')) return;
    var actions = document.querySelector('.training-run-setup-actions');
    var overlays = el('workspace-overlays');
    if (!actions || !overlays) return;

    var button = document.createElement('button');
    button.id = 'test-generations-open-btn';
    button.type = 'button';
    button.className = 'review-captions-btn hidden';
    button.textContent = 'Test Generations';
    button.title = 'Generate one comparable H3 test video for every LoRA in this set\'s H3 Test folder.';
    actions.insertBefore(button, actions.firstChild);

    var modal = document.createElement('div');
    modal.id = 'test-generations-modal';
    modal.className = 'training-review-modal hidden';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = [
      '<section class="training-review-dialog" role="dialog" aria-modal="true" aria-labelledby="test-generations-title">',
      '<header class="training-review-modal-header"><div><h2 id="test-generations-title">Test Generations</h2><p>MiniMax H3 · every .safetensors file currently staged in this set\'s H3 Test folder.</p></div><button id="test-generations-close-btn" type="button" class="training-review-modal-close" aria-label="Close Test Generations">&times;</button></header>',
      '<div class="training-review-modal-content">',
      '<p id="test-generations-summary">Loading H3 Test folder...</p>',
      '<pre id="test-generations-files" class="training-command-text" style="max-height:140px;overflow:auto;"></pre>',
      '<label class="training-run-option" style="display:block;"><span>Prompt</span><textarea id="test-generations-prompt" rows="9" style="width:100%;resize:vertical;"></textarea></label>',
      '<div id="test-generations-status" class="training-command-status" aria-live="polite"></div>',
      '<div id="test-generations-error" class="training-command-status hidden" aria-live="polite"></div>',
      '</div>',
      '<footer class="training-review-modal-footer"><button id="test-generations-open-results-btn" type="button" class="review-captions-btn hidden">Open Results</button><button id="test-generations-run-btn" type="button" class="training-btn training-launch-btn">Run</button></footer>',
      '</section>'
    ].join('');
    overlays.appendChild(modal);

    button.onclick = openModal;
    el('test-generations-close-btn').onclick = closeModal;
    el('test-generations-run-btn').onclick = startRun;
    el('test-generations-open-results-btn').onclick = function () {
      openResults(this.dataset.resultFolder || '');
    };
    modal.addEventListener('click', function (event) {
      if (event.target === modal) closeModal();
    });

    var select = el('training-model-profile-select');
    if (select) {
      select.addEventListener('change', syncLaunchVisibility);
      new MutationObserver(syncLaunchVisibility).observe(select, { childList: true, subtree: true });
    }
    syncLaunchVisibility();
  }

  buildUi();
})();
