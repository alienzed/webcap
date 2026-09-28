(function () {
  var state = {
    open: false,
    pending: false,
    modelsLoaded: false,
    modelId: '',
    messages: [],
    elapsedByAssistantIndex: {}
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
        option.textContent = String(model.label || model.id || '');
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

    var startedAt = performance.now();
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
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Director Chat', err);
      var status = el('director-chat-status');
      if (status) status.textContent = String(err && err.message ? err.message : err);
    }).then(function () {
      state.pending = false;
      renderMessages();
      syncControls();
      var status = el('director-chat-status');
      if (status && state.messages.length && state.messages[state.messages.length - 1].role === 'assistant') {
        status.textContent = '';
      }
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
