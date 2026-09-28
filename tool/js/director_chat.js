(function () {
  var state = {
    open: false,
    pending: false,
    modelsLoaded: false,
    modelId: '',
    messages: [],
    elapsedByAssistantIndex: {},
    progressTimer: 0,
    requestStartedAt: 0
  };

  function el(id) {
    return document.getElementById(id);
  }

  function requestJson(url, options) {
    return fetch(url, options || {}).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.ok === false) {
          throw new Error(payload && payload.error ? payload.error : (response.statusText || 'Request failed'));
        }
        return payload;
      });
    });
  }

  function formatElapsed(ms) {
    var seconds = Math.max(0, Number(ms || 0)) / 1000;
    return seconds < 10 ? seconds.toFixed(1) + 's' : Math.round(seconds) + 's';
  }

  function directorPhaseLabel(phase) {
    return {
      queued: 'Waiting',
      preparing: 'Preparing',
      freeing_comfy: 'Preparing runtime',
      loading_model: 'Loading model',
      generating: 'Generating',
      complete: 'Complete',
      stopped: 'Stopped',
      error: 'Failed'
    }[String(phase || '')] || 'Working';
  }

  function setProgressVisible(visible) {
    var progress = el('director-chat-progress');
    if (progress) progress.classList.toggle('hidden', !visible);
  }

  function renderProgress(activity) {
    var phaseEl = el('director-chat-progress-phase');
    var detailEl = el('director-chat-progress-detail');
    var elapsedEl = el('director-chat-progress-elapsed');
    var progress = el('director-chat-progress');
    if (!phaseEl || !detailEl || !elapsedEl || !progress) return;

    var activityOperation = String(activity && activity.operation || '');
    var ownActivity = activityOperation === 'freeform_chat';
    var active = !!(activity && activity.active);
    var phase = ownActivity ? String(activity.phase || 'preparing') : (active ? 'queued' : 'preparing');
    var detail = '';

    if (ownActivity) {
      if (phase === 'loading_model') detail = 'Loading ' + String(activity.model || state.modelId || 'model');
      else if (phase === 'generating') detail = String(activity.model || state.modelId || 'Selected model');
      else if (phase === 'freeing_comfy') detail = 'Releasing local GPU resources';
      else detail = String(activity.model || state.modelId || '');
    } else if (active) {
      detail = 'Waiting for current Director work to finish';
    } else {
      detail = String(state.modelId || '');
    }

    phaseEl.textContent = directorPhaseLabel(phase);
    detailEl.textContent = detail;
    elapsedEl.textContent = formatElapsed(performance.now() - state.requestStartedAt);
    progress.dataset.phase = phase;
  }

  function stopProgressPolling() {
    if (state.progressTimer) clearTimeout(state.progressTimer);
    state.progressTimer = 0;
  }

  function pollProgress() {
    stopProgressPolling();
    if (!state.pending) return;
    requestJson('/fs/director/activity').then(function (activity) {
      if (state.pending) renderProgress(activity);
    }).catch(function () {
      if (state.pending) renderProgress(null);
    }).then(function () {
      if (state.pending) state.progressTimer = setTimeout(pollProgress, 500);
    });
  }

  function startProgress() {
    state.requestStartedAt = performance.now();
    setProgressVisible(true);
    renderProgress(null);
    pollProgress();
  }

  function finishProgress(error) {
    stopProgressPolling();
    if (error) {
      var phaseEl = el('director-chat-progress-phase');
      var detailEl = el('director-chat-progress-detail');
      var elapsedEl = el('director-chat-progress-elapsed');
      var progress = el('director-chat-progress');
      if (phaseEl) phaseEl.textContent = 'Failed';
      if (detailEl) detailEl.textContent = String(error && error.message ? error.message : error);
      if (elapsedEl) elapsedEl.textContent = formatElapsed(performance.now() - state.requestStartedAt);
      if (progress) progress.dataset.phase = 'error';
      setProgressVisible(true);
      return;
    }
    setProgressVisible(false);
  }

  function renderMessages() {
    var host = el('director-chat-messages');
    var empty = el('director-chat-empty');
    if (!host || !empty) return;

    host.innerHTML = '';
    empty.classList.toggle('hidden', state.messages.length > 0);

    state.messages.forEach(function (message, index) {
      var row = document.createElement('div');
      row.className = 'director-chat-message director-chat-message-' + message.role;

      var label = document.createElement('div');
      label.className = 'director-chat-message-label';
      label.textContent = message.role === 'assistant' ? 'Assistant' : 'You';

      var body = document.createElement('div');
      body.className = 'director-chat-message-body';
      body.textContent = message.content;

      row.appendChild(label);
      row.appendChild(body);

      if (message.role === 'assistant' && Object.prototype.hasOwnProperty.call(state.elapsedByAssistantIndex, index)) {
        var meta = document.createElement('div');
        meta.className = 'director-chat-message-meta';
        meta.textContent = formatElapsed(state.elapsedByAssistantIndex[index]);
        row.appendChild(meta);
      }
      host.appendChild(row);
    });

    host.scrollTop = host.scrollHeight;
  }

  function syncControls() {
    var send = el('director-chat-send');
    var input = el('director-chat-input');
    var model = el('director-chat-model');
    var clear = el('director-chat-clear');
    if (send) send.disabled = state.pending || !state.modelId || !String(input && input.value || '').trim();
    if (input) input.disabled = state.pending;
    if (model) model.disabled = state.pending || !state.modelsLoaded;
    if (clear) clear.disabled = state.pending || !state.messages.length;
  }

  function loadModels() {
    var select = el('director-chat-model');
    if (!select) return Promise.resolve();
    select.disabled = true;
    select.innerHTML = '<option value="">Loading models...</option>';

    return requestJson('/fs/storyboard/director').then(function (payload) {
      var models = Array.isArray(payload.models) ? payload.models : [];
      select.innerHTML = '';
      if (!payload.available || !models.length) {
        var unavailable = document.createElement('option');
        unavailable.value = '';
        unavailable.textContent = payload.error || 'No Director models available';
        select.appendChild(unavailable);
        state.modelId = '';
        state.modelsLoaded = true;
        syncControls();
        return;
      }

      models.forEach(function (model) {
        var option = document.createElement('option');
        option.value = String(model.id || '');
        option.textContent = formatDirectorModelLabel(model);
        select.appendChild(option);
      });

      var stillAvailable = models.some(function (model) {
        return String(model.id || '') === state.modelId;
      });
      if (!stillAvailable) state.modelId = String(models[0].id || '');
      select.value = state.modelId;
      state.modelsLoaded = true;
      syncControls();
    }).catch(function (err) {
      state.modelsLoaded = true;
      state.modelId = '';
      select.innerHTML = '<option value="">Director unavailable</option>';
      syncControls();
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Director Chat', err);
    });
  }

  function newChat() {
    state.messages = [];
    state.elapsedByAssistantIndex = {};
    finishProgress(null);
    renderMessages();
    syncControls();
    var input = el('director-chat-input');
    if (input) input.focus();
  }

  function sendMessage() {
    var input = el('director-chat-input');
    if (!input || state.pending) return;

    var content = String(input.value || '').trim();
    if (!content || !state.modelId) return;

    state.messages.push({ role: 'user', content: content });
    input.value = '';
    state.pending = true;
    renderMessages();
    syncControls();
    startProgress();

    var startedAt = performance.now();
    var requestError = null;
    requestJson('/fs/director/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: state.modelId,
        messages: state.messages
      })
    }).then(function (payload) {
      state.messages.push({ role: 'assistant', content: String(payload.text || '') });
      state.elapsedByAssistantIndex[state.messages.length - 1] = performance.now() - startedAt;
    }).catch(function (err) {
      requestError = err;
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Director Chat', err);
    }).then(function () {
      state.pending = false;
      finishProgress(requestError);
      renderMessages();
      syncControls();
      if (input) input.focus();
    });
  }

  function setOpen(open) {
    state.open = !!open;
    var drawer = el('director-chat-drawer');
    var toggle = el('director-chat-rail-btn');
    if (!drawer || !toggle) return;

    if (state.open) {
      if (typeof window.setActivityDrawerOpen === 'function') window.setActivityDrawerOpen(false);
      if (typeof window.setInferenceQueueOpen === 'function') window.setInferenceQueueOpen(false);
    }

    drawer.classList.toggle('hidden', !state.open);
    drawer.setAttribute('aria-hidden', state.open ? 'false' : 'true');
    toggle.classList.toggle('active', state.open);
    toggle.setAttribute('aria-expanded', state.open ? 'true' : 'false');

    if (state.open) {
      loadModels().then(function () {
        var input = el('director-chat-input');
        if (input) input.focus();
      });
    }
  }

  function bind() {
    var toggle = el('director-chat-rail-btn');
    var drawer = el('director-chat-drawer');
    var close = el('director-chat-close');
    var clear = el('director-chat-clear');
    var send = el('director-chat-send');
    var input = el('director-chat-input');
    var model = el('director-chat-model');
    if (!toggle || !drawer || !close || !clear || !send || !input || !model) return;

    toggle.onclick = function () { setOpen(!state.open); };
    close.onclick = function () { setOpen(false); };
    clear.onclick = newChat;
    send.onclick = sendMessage;
    model.onchange = function () {
      state.modelId = String(model.value || '');
      syncControls();
    };
    input.addEventListener('input', syncControls);
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });
    document.addEventListener('pointerdown', function (event) {
      if (!state.open || drawer.contains(event.target) || toggle.contains(event.target)) return;
      setOpen(false);
    });
    window.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && state.open) setOpen(false);
    });

    renderMessages();
    syncControls();
  }

  window.setDirectorChatOpen = setOpen;
  bind();
})();
