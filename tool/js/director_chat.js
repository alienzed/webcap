(function () {
  var state = {
    open: false,
    pinned: false,
    pending: false,
    modelsLoaded: false,
    modelId: getDirectorModelPreference('webcap.directorChat.model'),
    activeMode: 'chat',
    messages: [],
    storyboardAttachments: {},
    studioStoryAccess: null,
    studioAccessIndex: null,
    attachmentPending: false,
    workshop: null,
    workshopProposal: null,
    storyGuidelineProposal: null,
    modeMessages: {},
    elapsedByAssistantIndex: {},
    modeElapsedByAssistantIndex: {},
    metricsByAssistantIndex: {},
    modeMetricsByAssistantIndex: {},
    progressTimer: 0,
    requestStartedAt: 0,
    generationStartedAt: 0,
    lastGeneratedTokens: 0,
    jobId: '',
    requestDiagnostic: null,
    systemStatus: null,
    systemStatusAt: 0,
    systemStatusRequest: null,
    activityLastMemory: null,
    activityLoadBaseline: null,
    activityLoadModelId: '',
    sessionByMode: { chat: null, storyboard: null },
    sessionActiveByMode: {},
    sessionList: [],
    sessionReady: false,
    sessionWrite: Promise.resolve(),
    sessionSaving: false,
    sessionTimer: 0,
    sessionDirty: { chat: false, storyboard: false },
    sessionError: false,
    draftByMode: { chat: '', storyboard: '' },
    studioIntroPending: false,
    studioSceneProposal: null,
    studioProjectProposal: null,
    studioScenesProposal: null,
    studioBriefProposal: null,
    studioBriefUndo: null,
    studioOperations: []
  };
  var STORYBOARD_WORKSHOP_PRIMER = [
    'You are collaborating with an author developing short AI-generated videos.',
    'A Story contains the concept, optional Directing Guidelines, and independently generatable Scenes.',
    'Each Scene is one video clip lasting at most 15 seconds. A Scene prompt has established subject, environment, visual treatment and audio sections, with timed shots in integrated_multimodal_description describing actions and changes.',
    'This is a creative workshop. Explore the author\'s current interests for the selected Scene: actions, choreography, interactions, dialogue, camera behavior, timing, and visual development.',
    'Storyboard references are supplied as readable text inside the request, including inline material in the latest user message. Use that text as source context and build on the author\'s decisions as the discussion develops.',
    'Respond briefly. Ask one focused question when useful. Offer concise alternatives and elaborate as the author requests.'
  ].join('\n\n');

  var contextualModes = {};
  var inputHistory = [];
  var inputHistoryIndex = 0;
  var inputHistoryDraft = '';
  var applyingHistoryValue = false;

  function el(id) {
    return document.getElementById(id);
  }

  function activeContextMode() {
    return state.activeMode === 'chat' || state.activeMode === 'storyboard' ? null : (contextualModes[state.activeMode] || null);
  }

  function currentMessages() {
    if (state.activeMode === 'chat') return state.messages;
    if (!state.modeMessages[state.activeMode]) state.modeMessages[state.activeMode] = [];
    return state.modeMessages[state.activeMode];
  }

  function currentElapsedMap() {
    if (state.activeMode === 'chat') return state.elapsedByAssistantIndex;
    if (!state.modeElapsedByAssistantIndex[state.activeMode]) state.modeElapsedByAssistantIndex[state.activeMode] = {};
    return state.modeElapsedByAssistantIndex[state.activeMode];
  }

  function currentMetricsMap() {
    if (state.activeMode === 'chat') return state.metricsByAssistantIndex;
    if (!state.modeMetricsByAssistantIndex[state.activeMode]) state.modeMetricsByAssistantIndex[state.activeMode] = {};
    return state.modeMetricsByAssistantIndex[state.activeMode];
  }

  function modeAvailable(mode) {
    if (!mode || typeof mode.available !== 'function') return false;
    try { return !!mode.available(); }
    catch (err) {
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Assistant', err);
      return false;
    }
  }

  function availableModes() {
    return Object.keys(contextualModes).map(function (id) {
      return contextualModes[id];
    }).filter(modeAvailable);
  }

  function guidelineStoryId() {
    if (state.workshop) return state.workshop.storyId;
    var attached = Object.keys(state.storyboardAttachments).filter(function (key) { return key.indexOf('story:') === 0; });
    return attached.length === 1 ? attached[0].slice(6) : '';
  }

  function storyboardContextPresets() {
    if (state.workshop) {
      return Object.keys(state.workshop.extraSections || {}).map(function (label) {
        return { label: label, section: label, title: 'Include this Scene section in the conversation' };
      }).concat([{ label: 'Exit Workshop', exitWorkshop: true }]);
    }
    return [
      { label: 'Attach Story', contextKind: 'story' },
      { label: 'Attach Scene', contextKind: 'scene' },
      { label: 'Clear context', clearContext: true }
    ];
  }

  var renderedStoryboardAttachmentSnapshot = '';

  function storyboardAttachmentItems() {
    return Object.keys(state.storyboardAttachments).map(function (key) {
      var item = state.storyboardAttachments[key];
      if (!item || typeof item.label !== 'string' || typeof item.content !== 'string') {
        throw new Error('Storyboard Chat attachment has invalid reference content: ' + key);
      }
      return { key: key, label: item.label, content: item.content };
    });
  }

  function storyboardAttachmentCopyAll() {
    return storyboardAttachmentItems().map(function (item) {
      return item.label + ':\n' + item.content;
    }).join('\n\n');
  }

  function storyboardAttachmentFields(item) {
    var parsed;
    try { parsed = JSON.parse(item.content); }
    catch (err) { return [{ label: 'Reference text', text: item.content }]; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return [{ label: 'Reference text', text: item.content }];
    }
    var labels = {
      title: 'Title',
      concept: 'Concept / Overview',
      style: 'Visual / Atmosphere',
      summary: 'Summary',
      entryState: 'Entry State',
      exitState: 'Exit State',
      prompt: 'Generation Prompt',
      notes: 'Notes',
      invariants: 'Invariants',
      scenes: 'Scenes'
    };
    var guidelineLabels = {
      visualFocus: 'Visual Focus',
      creativeDirection: 'Creative Direction',
      variation: 'Variation / Repetition',
      pacing: 'Pacing / Rhythm',
      sceneRelationships: 'Scene Relationships'
    };
    function valueText(value) {
      return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    }
    function displayLabel(key) {
      return labels[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, function (first) { return first.toUpperCase(); });
    }
    var fields = [];
    Object.keys(parsed).forEach(function (key) {
      var value = parsed[key];
      if (key === 'guidelines' && value && typeof value === 'object' && !Array.isArray(value)) {
        var guidelineKeys = Object.keys(value);
        if (!guidelineKeys.length) fields.push({ label: 'Directing Guidelines', text: '{}' });
        guidelineKeys.forEach(function (name) {
          fields.push({ label: 'Guidelines · ' + (guidelineLabels[name] || displayLabel(name)), text: valueText(value[name]) });
        });
      } else if ((key === 'scenes' || key === 'invariants') && Array.isArray(value) && value.length) {
        value.forEach(function (entry, index) {
          var name = key === 'scenes'
            ? 'Scene ' + String(entry && entry.number || index + 1) + (entry && entry.title ? ' · ' + entry.title : '')
            : 'Invariant ' + String(index + 1) + (entry && entry.title ? ' · ' + entry.title : '');
          fields.push({ label: name, text: valueText(entry) });
        });
      } else {
        fields.push({ label: displayLabel(key), text: valueText(value) });
      }
    });
    return fields;
  }

  function copyStoryboardAttachment(text, label) {
    var status = el('director-chat-attachments-status');
    var promise;
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        throw new Error('Clipboard access is unavailable. Select the reference text to copy it manually.');
      }
      promise = navigator.clipboard.writeText(text);
    } catch (err) {
      promise = Promise.reject(err);
    }
    return Promise.resolve(promise).then(function () {
      status.textContent = 'Copied ' + label + '.';
    }).catch(function (err) {
      status.textContent = 'Copy failed: ' + String(err.message || err);
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Storyboard context copy', err);
      else console.error('[Storyboard context copy]', err);
    });
  }

  function renderStoryboardAttachmentViewer() {
    var panel = el('director-chat-attachments');
    var toggle = el('director-chat-attachments-toggle');
    var body = el('director-chat-attachments-body');
    var list = el('director-chat-attachments-list');
    var status = el('director-chat-attachments-status');
    if (!panel || !toggle || !body || !list || !status) {
      throw new Error('Storyboard Chat attachment viewer markup is missing.');
    }
    var items = storyboardAttachmentItems();
    var visible = state.activeMode === 'storyboard' && items.length > 0;
    panel.classList.toggle('hidden', !visible);
    if (!visible) {
      toggle.setAttribute('aria-expanded', 'false');
      body.classList.add('hidden');
      renderedStoryboardAttachmentSnapshot = '';
      list.replaceChildren();
      status.textContent = '';
      return;
    }
    var expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.textContent = (expanded ? 'Hide' : 'View') + ' attached context · ' + items.length;
    body.classList.toggle('hidden', !expanded);
    if (!expanded) return;
    var snapshot = JSON.stringify(items);
    if (snapshot === renderedStoryboardAttachmentSnapshot) return;
    renderedStoryboardAttachmentSnapshot = snapshot;
    status.textContent = '';
    var previousScroll = list.scrollTop;
    list.replaceChildren();
    items.forEach(function (item) {
      var container = document.createElement('section');
      container.className = 'director-chat-attachment';
      var header = document.createElement('div');
      header.className = 'director-chat-attachment-head';
      var title = document.createElement('strong');
      title.textContent = item.label;
      var copyReference = document.createElement('button');
      copyReference.type = 'button';
      copyReference.className = 'review-captions-btn';
      copyReference.textContent = 'Copy reference';
      copyReference.setAttribute('aria-label', 'Copy ' + item.label + ' reference');
      copyReference.onclick = function () {
        copyStoryboardAttachment(item.label + ':\n' + item.content, item.label);
      };
      header.append(title, copyReference);
      container.appendChild(header);
      storyboardAttachmentFields(item).forEach(function (field) {
        var section = document.createElement('section');
        section.className = 'director-chat-attachment-field';
        var line = document.createElement('div');
        line.className = 'director-chat-attachment-field-head';
        var name = document.createElement('strong');
        name.textContent = field.label;
        var copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'review-captions-btn';
        copy.textContent = 'Copy field';
        copy.setAttribute('aria-label', 'Copy ' + field.label + ' from ' + item.label);
        copy.onclick = function () {
          copyStoryboardAttachment(field.text, field.label);
        };
        var value = document.createElement('pre');
        value.textContent = field.text || '(empty)';
        value.classList.toggle('is-empty', !field.text);
        line.append(name, copy);
        section.append(line, value);
        container.appendChild(section);
      });
      list.appendChild(container);
    });
    list.scrollTop = previousScroll;
  }

  function syncModeUi() {
    var row = el('director-chat-mode-row');
    var host = el('director-chat-mode-switch');
    var description = el('director-chat-mode-description');
    var input = el('director-chat-input');
    var toolsRow = el('director-chat-mode-tools');
    var presetsHost = el('director-chat-mode-presets');
    var studioVisible = !!document.querySelector('#storyboard-workspace:not(.hidden)');
    var modes = (studioVisible ? [{ id: 'storyboard', label: 'Studio Director' }] : []).concat(availableModes());
    var active = activeContextMode();

    if (state.activeMode !== 'chat' && state.activeMode !== 'storyboard' && (!active || !modeAvailable(active))) {
      state.activeMode = 'chat';
      active = null;
    }

    var studio = state.activeMode === 'storyboard';
    var drawer = el('director-chat-drawer');
    drawer.classList.toggle('studio-director', studio);
    el('app-frame').classList.toggle('studio-director-active', studio && state.open);
    el('director-chat-title').textContent = studio ? 'Studio Director' : 'Assistant';
    el('director-studio-starters').classList.toggle('hidden', !studio);
    el('director-chat-empty-title').textContent = studio ? "Let's make something" : 'Your conversation';
    el('director-chat-empty-description').textContent = studio
      ? (state.studioIntroPending ? 'Director is discovering a starting question…' : 'Start with a feeling, a moment, or an unfinished idea. Director will ask one question at a time.')
      : 'Start a conversation with the selected model.';
    el('director-studio-retry').classList.toggle('hidden',
      !studio || !!currentMessages().length || state.pending || !state.sessionReady);
    if (row) row.classList.toggle('hidden', studio || !modes.length);
    if (host) {
      host.innerHTML = '<button type="button" class="review-captions-btn' + (state.activeMode === 'chat' ? ' active' : '') + '" data-assistant-mode="chat">Chat</button>' +
        modes.map(function (mode) {
          return '<button type="button" class="review-captions-btn' + (state.activeMode === mode.id ? ' active' : '') +
            '" data-assistant-mode="' + mode.id + '">' + mode.label + '</button>';
        }).join('');
    }

    if (description) {
      description.textContent = state.activeMode === 'storyboard'
        ? (state.workshop ? 'Working on ' + state.workshop.sceneTitle : (state.attachmentPending ? 'Attaching selected context…' : 'Writer’s Workshop · ' + (Object.keys(state.storyboardAttachments).map(function (key) { return state.storyboardAttachments[key].label; }).join(', ') || 'Explore an idea')))
        : (active ? String(active.description || active.label || '') : 'Saved Assistant conversation');
    }
    if (input) {
      input.placeholder = state.activeMode === 'storyboard' ? 'What are you imagining? You can start anywhere…' :
        (active ? String(active.placeholder || 'What should the Assistant do?') : 'Ask the model anything…');
    }

    var presets = state.activeMode === 'storyboard'
      ? storyboardContextPresets()
      : (active && Array.isArray(active.presets) ? active.presets : []);
    if (toolsRow) toolsRow.classList.toggle('hidden', studio || !presets.length);
    if (presetsHost) {
      var wasExpanded = !!presetsHost.querySelector('details[data-workshop-context][open]');
      var items = presets.map(function (preset, index) {
        var selected = !!(
          (preset.section && state.storyboardAttachments['section:' + preset.section]) ||
          (preset.contextKind === 'story' && Object.keys(state.storyboardAttachments).some(function (key) { return key.indexOf('story:') === 0; })) ||
          (preset.contextKind === 'scene' && Object.keys(state.storyboardAttachments).some(function (key) { return key.indexOf('scene:') === 0; }))
        );
        return '<button type="button" class="review-captions-btn' + (selected ? ' active' : '') +
          '" data-assistant-preset="' + String(index) + '"' +
          ((preset.section || preset.contextKind) ? ' aria-pressed="' + (selected ? 'true' : 'false') + '"' : '') +
          ' title="' + String(preset.title || preset.label || '') + '">' +
          (state.attachmentPending && preset.contextKind ? 'Attaching…' : (selected && preset.contextKind === 'story' ? 'Story attached' : (selected && preset.contextKind === 'scene' ? 'Scene attached' : String(preset.label || 'Preset')))) + '</button>';
      }).join('');
      presetsHost.innerHTML = state.activeMode === 'storyboard' && state.workshop
        ? '<details data-workshop-context' + (wasExpanded ? ' open' : '') +
          '><summary>Context · ' + Object.keys(state.storyboardAttachments).length +
          ' additional</summary><div class="director-chat-workshop-context-options">' + items + '</div></details>'
        : items;
    }
    var prepare = el('director-chat-workshop-prepare');
    if (prepare) prepare.classList.toggle('hidden', state.activeMode !== 'storyboard' || !state.workshop);
    var storyPrepare = el('director-chat-story-prepare');
    storyPrepare.classList.toggle('hidden', state.activeMode !== 'storyboard' || !guidelineStoryId());
    renderStoryboardAttachmentViewer();
    renderStudioStoryAccess();
    renderStudioOperations();
    renderMessages();
    syncControls();
  }

  function setMode(modeId) {
    modeId = String(modeId || 'chat');
    if (modeId !== 'chat' && modeId !== 'storyboard') {
      var mode = contextualModes[modeId];
      if (!mode || !modeAvailable(mode)) modeId = 'chat';
    }
    if (state.pending || state.activeMode === modeId) return;
    var input = el('director-chat-input');
    if (persistentMode(state.activeMode) && state.sessionReady) {
      state.draftByMode[state.activeMode] = input.value;
      if (state.sessionDirty[state.activeMode]) flushSessionSave().catch(showSessionFailure);
    }
    state.activeMode = modeId;
    if (persistentMode(modeId)) input.value = state.draftByMode[modeId] || '';
    finishProgress(null);
    syncModeUi();
    if (input) input.focus();
  }

  function registerContextMode(mode) {
    if (!mode || !mode.id || typeof mode.execute !== 'function' || typeof mode.available !== 'function') {
      throw new Error('Assistant contextual mode requires id, available(), and execute().');
    }
    contextualModes[String(mode.id)] = mode;
    if (state.open) syncModeUi();
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

  // Chat sessions are independent of Story navigation. Only explicitly attached
  // reference snapshots are persisted alongside their conversation.
  function persistentMode(mode) {
    return mode === 'chat' || mode === 'storyboard';
  }

  function showSessionStatus(message, error) {
    var status = el('director-chat-save-status');
    if (status) {
      status.textContent = message;
      status.dataset.error = error ? 'true' : 'false';
    }
    state.sessionError = !!error;
    if (error && typeof window.reportConsoleError === 'function') {
      window.reportConsoleError('Assistant conversation save', error);
    }
  }

  function upsertSessionSummary(chat) {
    var summary = {
      id: chat.id, mode: chat.mode, title: chat.title,
      createdAt: chat.createdAt, updatedAt: chat.updatedAt, revision: chat.revision
    };
    state.sessionList = state.sessionList.filter(function (item) { return item.id !== chat.id; });
    state.sessionList.unshift(summary);
    state.sessionList.sort(function (a, b) { return b.updatedAt.localeCompare(a.updatedAt); });
    renderSessionHistory();
  }

  function renderSessionHistory() {
    var list = el('director-chat-history-list');
    var button = el('director-chat-history-toggle');
    var panel = el('director-chat-history-panel');
    if (!list || !button || !panel) return;
    var expanded = button.getAttribute('aria-expanded') === 'true';
    panel.classList.toggle('hidden', !expanded);
    list.replaceChildren();
    if (!state.sessionList.length) {
      var empty = document.createElement('p');
      empty.textContent = 'No saved conversations yet.';
      list.appendChild(empty);
    }
    state.sessionList.forEach(function (chat) {
      var item = document.createElement('div');
      item.className = 'director-chat-history-item';
      if (state.sessionByMode[state.activeMode] &&
          state.sessionByMode[state.activeMode].id === chat.id) item.classList.add('is-current');

      var open = document.createElement('button');
      open.type = 'button';
      open.className = 'review-captions-btn';
      open.textContent = (chat.mode === 'storyboard' ? 'Storyboard · ' : '') + chat.title;
      open.title = chat.title + ' · ' + new Date(chat.updatedAt).toLocaleString();
      open.onclick = function () { selectSession(chat.id); };
      item.appendChild(open);

      var rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'review-captions-btn';
      rename.textContent = 'Rename';
      rename.title = 'Rename conversation';
      rename.onclick = function () {
        item.replaceChildren();
        var input = document.createElement('input');
        input.value = chat.title;
        input.setAttribute('aria-label', 'Conversation title');
        var save = document.createElement('button');
        save.type = 'button';
        save.className = 'review-captions-btn';
        save.textContent = 'Save';
        save.onclick = function () {
          renameSession(chat.id, input.value.trim());
        };
        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'review-captions-btn';
        cancel.textContent = 'Cancel';
        cancel.onclick = renderSessionHistory;
        item.append(input, save, cancel);
        input.focus();
        input.select();
        input.onkeydown = function (event) {
          if (event.key === 'Enter') save.click();
          if (event.key === 'Escape') renderSessionHistory();
        };
      };
      item.appendChild(rename);

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'review-captions-btn';
      remove.textContent = 'Delete';
      remove.title = 'Permanently delete this saved conversation';
      remove.onclick = function () { deleteSession(chat.id); };
      item.appendChild(remove);
      list.appendChild(item);
    });
  }

  function showSessionFailure(error) {
    showSessionStatus('Save failed: ' + String(error.message || error), error);
    syncControls();
  }

  function persistSession(mode) {
    if (!persistentMode(mode)) return Promise.resolve();
    if (!state.sessionReady) return Promise.reject(new Error('Assistant conversation history has not loaded.'));
    var messages = (mode === 'chat' ? state.messages : state.modeMessages.storyboard || []).map(function (message) {
      return { role: message.role, content: message.content };
    });
    var draft = state.draftByMode[mode] || '';
    var attachments = mode === 'storyboard' ? JSON.parse(JSON.stringify(state.storyboardAttachments)) : {};
    var workshop = mode === 'storyboard' ? JSON.parse(JSON.stringify(state.workshop)) : null;
    var operations = mode === 'storyboard' ? state.studioOperations.slice() : [];
    var storyAccess = mode === 'storyboard' ? state.studioStoryAccess : null;
    var title = state.sessionByMode[mode] ? state.sessionByMode[mode].title : 'New chat';
    if (title === 'New chat') {
      var first = messages.find(function (message) { return message.role === 'user' && message.content.trim(); });
      if (first) title = first.content.replace(/\s+/g, ' ').trim().slice(0, 72);
    }
    state.sessionDirty[mode] = false;
    showSessionStatus('Saving…', false);
    state.sessionSaving = true;
    var action = state.sessionWrite.catch(function () {}).then(function () {
      var session = state.sessionByMode[mode];
      var ready = session ? Promise.resolve(session) : requestJson('/fs/director/chats', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: mode })
      }).then(function (payload) {
        state.sessionByMode[mode] = payload.chat;
        state.sessionActiveByMode[mode] = payload.chat.id;
        upsertSessionSummary(payload.chat);
        return payload.chat;
      });
      return ready.then(function (current) {
        return requestJson('/fs/director/chats/' + encodeURIComponent(current.id), {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedRevision: current.revision, title: title,
            messages: messages, draft: draft, attachments: attachments, workshop: workshop,
            operations: operations, storyAccess: storyAccess
          })
        });
      }).then(function (payload) {
        state.sessionByMode[mode] = payload.chat;
        upsertSessionSummary(payload.chat);
        if (!state.sessionDirty[mode]) showSessionStatus('Saved', false);
        return payload.chat;
      });
    });
    state.sessionWrite = action;
    action.finally(function () { if (state.sessionWrite === action) state.sessionSaving = false; }).catch(function () {});
    return action.catch(function (error) {
      state.sessionDirty[mode] = true;
      showSessionFailure(error);
      throw error;
    });
  }

  function scheduleSessionSave() {
    var mode = state.activeMode;
    if (!persistentMode(mode) || !state.sessionReady) return;
    state.sessionDirty[mode] = true;
    showSessionStatus('Unsaved changes', false);
    if (state.sessionTimer) clearTimeout(state.sessionTimer);
    state.sessionTimer = setTimeout(function () {
      state.sessionTimer = 0;
      persistSession(mode).catch(function () {});
    }, 450);
  }

  function flushSessionSave() {
    if (state.sessionTimer) {
      clearTimeout(state.sessionTimer);
      state.sessionTimer = 0;
    }
    var mode = state.activeMode;
    return state.sessionDirty[mode] ? persistSession(mode) : state.sessionWrite;
  }

  function restoreSession(chat) {
    if (!chat || !persistentMode(chat.mode) || !Array.isArray(chat.messages)) {
      throw new Error('Saved Assistant conversation is invalid.');
    }
    state.sessionByMode[chat.mode] = chat;
    state.sessionActiveByMode[chat.mode] = chat.id;
    if (chat.mode === 'chat') {
      state.messages = chat.messages.slice();
      state.elapsedByAssistantIndex = {};
      state.metricsByAssistantIndex = {};
    } else {
      state.modeMessages.storyboard = chat.messages.slice();
      state.modeElapsedByAssistantIndex.storyboard = {};
      state.modeMetricsByAssistantIndex.storyboard = {};
      state.storyboardAttachments = Object.assign({}, chat.attachments || {});
      state.studioStoryAccess = chat.storyAccess || null;
      state.studioAccessIndex = null;
      state.workshop = chat.workshop || null;
      state.studioOperations = Array.isArray(chat.operations) ? chat.operations.slice() : [];
      state.studioSceneProposal = null;
      state.studioProjectProposal = null;
      state.studioScenesProposal = null;
      state.studioBriefProposal = null;
      state.workshopProposal = null;
      state.storyGuidelineProposal = null;
    }
    state.draftByMode[chat.mode] = chat.draft || '';
    state.sessionDirty[chat.mode] = false;
    if (state.activeMode === chat.mode) {
      el('director-chat-input').value = state.draftByMode[chat.mode];
      syncModeUi();
    }
    upsertSessionSummary(chat);
    showSessionStatus('Saved', false);
  }

  function loadSessionHistory() {
    return requestJson('/fs/director/chats').then(function (payload) {
      state.sessionList = payload.chats || [];
      state.sessionActiveByMode = payload.activeByMode || {};
      return Promise.all(['chat', 'storyboard'].filter(function (mode) {
        return state.sessionActiveByMode[mode];
      }).map(function (mode) {
        return requestJson('/fs/director/chats/' + encodeURIComponent(state.sessionActiveByMode[mode]))
          .then(function (result) { restoreSession(result.chat); });
      }));
    }).then(function () {
      state.sessionReady = true;
      renderSessionHistory();
      syncModeUi();
      maybeOpenNewStudioConversation();
    }).catch(function (error) {
      showSessionFailure(error);
    });
  }

  function selectSession(chatId) {
    if (!state.sessionReady || state.pending || state.attachmentPending) return;
    state.pending = true;
    syncControls();
    flushSessionSave().then(function () {
      return requestJson('/fs/director/chats/' + encodeURIComponent(chatId));
    }).then(function (result) {
      state.activeMode = result.chat.mode;
      restoreSession(result.chat);
      finishProgress(null);
      syncModeUi();
    }).catch(showSessionFailure).finally(function () {
      state.pending = false;
      syncControls();
    });
  }

  function renameSession(chatId, title) {
    if (!title || state.pending) return;
    selectSessionForEdit(chatId, function (chat) { chat.title = title; });
  }

  function selectSessionForEdit(chatId, edit) {
    if (!state.sessionReady || state.pending) return;
    state.pending = true;
    syncControls();
    flushSessionSave().then(function () {
      return requestJson('/fs/director/chats/' + encodeURIComponent(chatId) + '?inspect=1');
    }).then(function (result) {
      var chat = result.chat;
      edit(chat);
      return requestJson('/fs/director/chats/' + encodeURIComponent(chat.id), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: chat.revision, title: chat.title,
          messages: chat.messages, draft: chat.draft, attachments: chat.attachments,
          workshop: chat.workshop || null
        })
      });
    }).then(function (result) {
      state.sessionByMode[result.chat.mode] = result.chat.id === (state.sessionByMode[result.chat.mode] || {}).id
        ? result.chat : state.sessionByMode[result.chat.mode];
      upsertSessionSummary(result.chat);
      showSessionStatus('Saved', false);
    }).catch(showSessionFailure).finally(function () {
      state.pending = false;
      syncControls();
    });
  }

  function deleteSession(chatId) {
    if (!state.sessionReady || state.pending) return;
    var chat = state.sessionList.find(function (item) { return item.id === chatId; });
    if (!chat || !window.confirm('Permanently delete conversation "' + chat.title + '"?')) return;
    state.pending = true;
    syncControls();
    flushSessionSave().then(function () {
      return requestJson('/fs/director/chats/' + encodeURIComponent(chatId), { method: 'DELETE' });
    }).then(function () {
      state.sessionList = state.sessionList.filter(function (item) { return item.id !== chatId; });
      var current = state.sessionByMode[chat.mode];
      if (current && current.id === chatId) {
        state.sessionByMode[chat.mode] = null;
        state.sessionActiveByMode[chat.mode] = null;
        if (chat.mode === 'chat') state.messages = [];
        else {
          state.modeMessages.storyboard = [];
          state.storyboardAttachments = {};
          state.studioStoryAccess = null;
          state.studioAccessIndex = null;
          state.workshop = null;
        }
        state.draftByMode[chat.mode] = '';
        if (state.activeMode === chat.mode) el('director-chat-input').value = '';
      }
      renderSessionHistory();
      syncModeUi();
      showSessionStatus('Deleted', false);
    }).catch(showSessionFailure).finally(function () {
      state.pending = false;
      syncControls();
    });
  }

  function formatElapsed(ms) {
    var seconds = Math.max(0, Number(ms || 0)) / 1000;
    if (seconds < 10) return seconds.toFixed(1) + 's';
    if (seconds < 60) return Math.round(seconds) + 's';
    var rounded = Math.round(seconds);
    return Math.floor(rounded / 60) + 'm ' + String(rounded % 60) + 's';
  }

  function positiveNumber(value) {
    value = Number(value);
    return isFinite(value) && value > 0 ? value : 0;
  }

  function generatedTokenCount(result) {
    result = result && typeof result === 'object' ? result : {};
    var usage = result.usage && typeof result.usage === 'object' ? result.usage : {};
    var timings = result.timings && typeof result.timings === 'object' ? result.timings : {};
    var candidates = [
      usage.completion_tokens,
      usage.completionTokens,
      usage.output_tokens,
      usage.outputTokens,
      usage.eval_count,
      timings.predicted_n
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      var count = positiveNumber(candidates[i]);
      if (count) return Math.round(count);
    }
    return Math.round(positiveNumber(state.lastGeneratedTokens));
  }

  function generationMilliseconds(result) {
    result = result && typeof result === 'object' ? result : {};
    var timings = result.timings && typeof result.timings === 'object' ? result.timings : {};
    var measured = positiveNumber(timings.predicted_ms);
    if (measured) return measured;
    if (state.generationStartedAt) return Math.max(0, performance.now() - state.generationStartedAt);
    return 0;
  }

  function generationRate(result, tokenCount, generationMs) {
    result = result && typeof result === 'object' ? result : {};
    var timings = result.timings && typeof result.timings === 'object' ? result.timings : {};
    var measured = positiveNumber(timings.predicted_per_second);
    if (measured) return measured;
    return tokenCount > 0 && generationMs > 0 ? tokenCount / (generationMs / 1000) : 0;
  }

  function formatResponseMetrics(metrics, elapsedMs) {
    metrics = metrics && typeof metrics === 'object' ? metrics : {};
    var parts = [];
    var tokenCount = positiveNumber(metrics.generatedTokens);
    var rate = positiveNumber(metrics.tokensPerSecond);
    if (tokenCount) parts.push(Math.round(tokenCount) + ' tokens');
    if (rate) parts.push(rate.toFixed(1) + ' tok/s');
    parts.push(formatElapsed(elapsedMs));
    return parts.join(' · ');
  }

  function completedResponseMetrics(result) {
    var tokenCount = generatedTokenCount(result);
    var generationMs = generationMilliseconds(result);
    return {
      generatedTokens: tokenCount,
      tokensPerSecond: generationRate(result, tokenCount, generationMs)
    };
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

  function directorBytesGiB(bytes) {
    var value = Number(bytes);
    return isFinite(value) && value > 0 ? (value / (1024 * 1024 * 1024)).toFixed(1) + ' GiB' : '';
  }

  function directorMemorySample(system) {
    var gpu = system && system.gpu;
    var primary = gpu && gpu.available && Array.isArray(gpu.gpus) ? gpu.gpus[0] : null;
    var ram = system && system.ram;
    var ramBytes = ram && ram.available ? Number(ram.used) : NaN;
    var vramMiB = primary ? Number(primary.memoryUsed) : NaN;
    if (!isFinite(ramBytes) || !isFinite(vramMiB)) return null;
    return {
      ramBytes: ramBytes,
      vramBytes: vramMiB * 1024 * 1024
    };
  }

  function progressSystemStatus(activity) {
    if (String(activity && activity.runtimeMode || '') === 'remote') return Promise.resolve(null);
    var now = performance.now();
    if (state.systemStatus && now - state.systemStatusAt < 1250) return Promise.resolve(state.systemStatus);
    if (state.systemStatusRequest) return state.systemStatusRequest;

    state.systemStatusRequest = requestJson('/fs/system_status').then(function (system) {
      state.systemStatus = system;
      state.systemStatusAt = performance.now();
      return system;
    }).catch(function () {
      return state.systemStatus;
    }).then(function (system) {
      state.systemStatusRequest = null;
      return system;
    });
    return state.systemStatusRequest;
  }

  function updateModelLoadProgress(activity, system) {
    var progress = el('director-chat-progress');
    var fill = progress && progress.querySelector('.director-chat-progress-track span');
    if (!progress || !fill) return '';

    var phase = String(activity && activity.phase || '');
    var sample = directorMemorySample(system);
    if (phase !== 'loading_model') {
      delete progress.dataset.loadKnown;
      fill.style.width = '';
      if (sample) state.activityLastMemory = sample;
      if (phase === 'preparing' || phase === 'queued' || phase === 'freeing_comfy') {
        state.activityLoadBaseline = null;
        state.activityLoadModelId = '';
      }
      return '';
    }

    var modelId = String(activity && activity.model || state.modelId || '');
    if (state.activityLoadModelId !== modelId) {
      state.activityLoadModelId = modelId;
      state.activityLoadBaseline = state.activityLastMemory || sample;
    } else if (!state.activityLoadBaseline && sample) {
      state.activityLoadBaseline = state.activityLastMemory || sample;
    }

    var modelSizeBytes = Number(activity && activity.modelSizeBytes);
    var baseline = state.activityLoadBaseline;
    if (!sample || !baseline || !isFinite(modelSizeBytes) || modelSizeBytes <= 0) {
      delete progress.dataset.loadKnown;
      fill.style.width = '';
      return '';
    }

    var ramDelta = Math.max(0, sample.ramBytes - baseline.ramBytes);
    var vramDelta = Math.max(0, sample.vramBytes - baseline.vramBytes);
    var residentBytes = Math.max(0, ramDelta + vramDelta);
    var displayBytes = Math.min(modelSizeBytes, residentBytes);
    var percent = Math.max(0, Math.min(100, residentBytes / modelSizeBytes * 100));
    progress.dataset.loadKnown = '1';
    fill.style.width = percent.toFixed(1) + '%';
    return '≈ ' + directorBytesGiB(displayBytes) + ' / ' + directorBytesGiB(modelSizeBytes) + ' · ~' + Math.round(percent) + '%';
  }

  function setProgressVisible(visible) {
    var progress = el('director-chat-progress');
    if (progress) progress.classList.toggle('hidden', !visible);
  }

  function activityForCurrentJob(activity) {
    var jobId = String(state.jobId || '');
    var queue = activity && activity.queue;
    if (!jobId || !queue || !Array.isArray(queue.jobs)) return null;
    var job = queue.jobs.find(function (candidate) {
      return String(candidate && candidate.jobId || '') === jobId;
    });
    if (!job) return null;

    var status = String(job.status || '');
    var active = String(queue.activeJobId || '') === jobId;
    if (status === 'queued' && !active) {
      return {
        active: true,
        phase: 'queued',
        model: job.modelId || state.modelId,
        operation: job.operation || 'freeform_chat',
        startedAt: job.createdAt,
        jobStatus: status,
        queuePosition: job.queuePosition || 0
      };
    }
    if (!active) {
      return {
        active: true,
        phase: 'preparing',
        model: job.modelId || state.modelId,
        operation: job.operation || 'freeform_chat',
        startedAt: job.startedAt || job.createdAt,
        jobStatus: status
      };
    }
    return Object.assign({}, activity || {}, {
      jobStatus: status,
      model: job.modelId || (activity && activity.model) || state.modelId,
      operation: job.operation || (activity && activity.operation) || 'freeform_chat'
    });
  }

  function formatRequestDiagnostic(request) {
    request = request && typeof request === 'object' ? request : null;
    if (!request) return '';
    var count = Number(request.messageCount) || 0;
    var chars = Number(request.contentChars) || 0;
    var messageLabel = count === 1 ? '1 msg' : String(count) + ' msgs';
    return 'Prompt sent · ' + messageLabel + ' · ' + chars.toLocaleString() + ' chars · Inspect';
  }

  function renderProgress(activity, system) {
    var phaseEl = el('director-chat-progress-phase');
    var detailEl = el('director-chat-progress-detail');
    var elapsedEl = el('director-chat-progress-elapsed');
    var progress = el('director-chat-progress');
    var stop = el('director-chat-stop');
    var copy = el('director-chat-prompt-copy');
    if (!phaseEl || !detailEl || !elapsedEl || !progress || !stop || !copy) return;

    activity = activityForCurrentJob(activity);
    var phase = String(activity && activity.phase || 'preparing');
    var detail = '';
    if (phase === 'queued') {
      var position = Number(activity && activity.queuePosition || 0);
      detail = position > 1 ? ('Queue #' + position) : 'Waiting for Director runtime';
    } else if (phase === 'loading_model') {
      var loadDetail = updateModelLoadProgress(activity, system);
      detail = String(activity && activity.model || state.modelId || 'model') + (loadDetail ? (' · ' + loadDetail) : '');
    } else if (phase === 'generating') {
      var now = performance.now();
      if (!state.generationStartedAt) state.generationStartedAt = now;
      var slot = activity && activity.slot && typeof activity.slot === 'object' ? activity.slot : {};
      var generatedTokens = positiveNumber(slot.generatedTokens);
      if (generatedTokens) state.lastGeneratedTokens = Math.max(state.lastGeneratedTokens, generatedTokens);
      var liveParts = [];
      if (state.lastGeneratedTokens > 0) {
        liveParts.push(Math.round(state.lastGeneratedTokens) + ' tokens');
        var liveRate = state.lastGeneratedTokens / Math.max(0.001, (now - state.generationStartedAt) / 1000);
        if (liveRate > 0) liveParts.push(liveRate.toFixed(1) + ' tok/s');
      }
      liveParts.push(String(activity && activity.model || state.modelId || 'Selected model'));
      detail = liveParts.join(' · ');
    } else if (phase === 'freeing_comfy') detail = 'Releasing local GPU resources';
    else detail = String(activity && activity.model || state.modelId || '');
    if (phase !== 'loading_model') updateModelLoadProgress(activity, system);

    var jobStatus = String(activity && activity.jobStatus || '');
    var terminal = ['completed', 'failed', 'cancelled', 'stopped', 'interrupted'].indexOf(jobStatus) !== -1;
    var mode = activeContextMode();
    var canCancel = !!state.jobId || !!(mode && typeof mode.cancel === 'function');
    stop.classList.toggle('hidden', !state.pending || terminal || !canCancel);
    stop.disabled = jobStatus === 'stopping';
    stop.textContent = jobStatus === 'stopping' ? 'Stopping…' : 'Stop';

    var requestLabel = formatRequestDiagnostic(state.requestDiagnostic);
    copy.classList.toggle('hidden', !requestLabel);
    copy.textContent = requestLabel;
    copy.title = requestLabel ? 'Inspect the exact messages WebCap sent to the LLM' : '';

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
      observeTransientLlmActivity(activity);
      return progressSystemStatus(activity).then(function (system) {
        if (state.pending) renderProgress(activity, system);
      });
    }).catch(function () {
      if (state.pending) renderProgress(null, null);
    }).then(function () {
      if (state.pending) state.progressTimer = setTimeout(pollProgress, 2500);
    });
  }

  function startProgress() {
    state.requestStartedAt = performance.now();
    state.generationStartedAt = 0;
    state.lastGeneratedTokens = 0;
    state.requestDiagnostic = null;
    state.activityLoadBaseline = null;
    state.activityLoadModelId = '';
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
    var stop = el('director-chat-stop');
    if (stop) stop.classList.add('hidden');
    setProgressVisible(false);
  }

  function renderMessages() {
    var host = el('director-chat-messages');
    var empty = el('director-chat-empty');
    if (!host || !empty) return;

    host.innerHTML = '';
    empty.classList.toggle('hidden', currentMessages().length > 0);

    currentMessages().forEach(function (message, index) {
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

      var elapsedMap = currentElapsedMap();
      var metricsMap = currentMetricsMap();
      if (message.role === 'assistant' && Object.prototype.hasOwnProperty.call(elapsedMap, index)) {
        var meta = document.createElement('div');
        meta.className = 'director-chat-message-meta';
        meta.textContent = formatResponseMetrics(metricsMap[index], elapsedMap[index]);
        row.appendChild(meta);
      }
      host.appendChild(row);
    });

    host.scrollTop = host.scrollHeight;
  }

  function renderStudioOperations() {
    var host = el('director-studio-operation-history');
    var list = el('director-studio-operation-list');
    var studio = state.activeMode === 'storyboard';
    var entries = state.studioOperations || [];
    host.classList.toggle('hidden', !studio || !entries.length);
    if (!studio || !entries.length) { list.replaceChildren(); return; }
    el('director-studio-operation-summary').textContent = 'Studio changes · ' + entries.length;
    list.replaceChildren();
    entries.slice().reverse().forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'director-studio-operation-item';
      var name = document.createElement('strong');
      name.textContent = item.label;
      var meta = document.createElement('small');
      meta.textContent = item.storyId + ' · ' + new Date(item.at).toLocaleString();
      row.append(name, meta);
      list.appendChild(row);
    });
  }

  function recordStudioOperation(kind, label, storyId, sceneIds) {
    state.studioOperations.push({
      kind: kind, label: String(label || '').slice(0, 200), storyId: String(storyId || ''),
      sceneIds: (sceneIds || []).slice(0, 8), at: new Date().toISOString()
    });
    state.studioOperations = state.studioOperations.slice(-25);
    renderStudioOperations();
  }

  function renderStudioStoryAccess() {
    var access = state.studioStoryAccess;
    var visible = state.activeMode === 'storyboard' && !!access;
    el('director-studio-access').classList.toggle('hidden', !visible);
    if (visible) el('director-studio-access-summary').textContent = 'Story access · ' + access.label;
  }

  function grantStudioStoryAccess() {
    if (state.pending || state.attachmentPending || state.activeMode !== 'storyboard') return;
    state.attachmentPending = true;
    syncControls();
    return Promise.resolve().then(function () {
      return window.getStoryboardAssistantAccessTarget();
    }).then(function (target) {
      if (!target || !target.storyId) throw new Error('Studio did not return a Story ID.');
      state.studioStoryAccess = {storyId: target.storyId, label: target.label || target.storyId};
      state.studioAccessIndex = null;
      state.studioSceneProposal = null;
      state.studioScenesProposal = null;
      state.studioBriefProposal = null;
      el('director-studio-access-data').classList.add('hidden');
      el('director-studio-access-status').textContent = 'Granted access. No fields read yet.';
      scheduleSessionSave();
      syncModeUi();
    }).catch(function (error) {
      studioActionStatus('Story access failed: ' + String(error.message || error), true);
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Studio Story access', error);
      else throw error;
    }).finally(function () {
      state.attachmentPending = false;
      syncControls();
    });
  }

  function clearStudioStoryAccess() {
    if (state.pending || state.attachmentPending) return;
    state.studioStoryAccess = null;
    state.studioAccessIndex = null;
    // Disconnect removes active snapshot references too; saved dialogue remains intact.
    state.storyboardAttachments = {};
    state.studioSceneProposal = null;
    state.studioScenesProposal = null;
    state.studioBriefProposal = null;
    el('director-studio-access-data').classList.add('hidden');
    scheduleSessionSave();
    syncModeUi();
  }

  function readStudioStoryScope(field, sceneId) {
    var chat = state.sessionByMode.storyboard;
    if (!chat || !state.studioStoryAccess || !chat.id) {
      return Promise.reject(new Error('Grant access in a saved Studio conversation first.'));
    }
    var url = '/fs/studio/director/story-read?chatId=' + encodeURIComponent(chat.id) +
      '&field=' + encodeURIComponent(field) + '&sceneId=' + encodeURIComponent(sceneId || '');
    return flushSessionSave().then(function () { return requestJson(url); });
  }

  function loadStudioAccessIndex() {
    if (!state.studioStoryAccess || state.studioAccessIndex) return Promise.resolve();
    return readStudioStoryScope('index', '').then(function (result) {
      if (!Array.isArray(result.data)) throw new Error('Story index returned invalid data.');
      state.studioAccessIndex = result.data;
      var scene = el('director-studio-access-scene');
      scene.replaceChildren();
      result.data.forEach(function (item, index) {
        var option = document.createElement('option');
        option.value = item.id;
        option.textContent = 'Scene ' + (index + 1) + (item.title ? ' · ' + item.title : '');
        scene.appendChild(option);
      });
      el('director-studio-access-status').textContent = 'Read Scene index (' + result.data.length + ' Scenes).';
    }).catch(function (error) {
      el('director-studio-access-status').textContent = 'Read failed: ' + String(error.message || error);
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Studio Story read', error);
      else throw error;
    });
  }

  function inspectStudioStoryScope() {
    var field = el('director-studio-access-field').value;
    var needsScene = ['scene', 'prompt', 'takes'].indexOf(field) !== -1;
    var scene = el('director-studio-access-scene');
    var storyId = state.studioStoryAccess && state.studioStoryAccess.storyId;
    if (!storyId) throw new Error('Choose a Story to inspect.');
    return (needsScene ? loadStudioAccessIndex() : Promise.resolve()).then(function () {
      if (needsScene && !scene.value) throw new Error('Select a Scene first.');
      return readStudioStoryScope(field, needsScene ? scene.value : '');
    }).then(function (result) {
      if (result.storyId !== storyId) throw new Error('Story changed while reading fields.');
      var output = el('director-studio-access-data');
      output.textContent = JSON.stringify(result.data, null, 2);
      output.classList.remove('hidden');
      el('director-studio-access-status').textContent = 'Read ' + field + ' from the saved Story. Not sent to Director.';
    }).catch(function (error) {
      el('director-studio-access-status').textContent = 'Read failed: ' + String(error.message || error);
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Studio Story read', error);
      else throw error;
    });
  }

  function syncStudioFlow() {
    var studio = state.activeMode === 'storyboard';
    var discussed = (state.modeMessages.storyboard || []).some(function (message) {
      return message && message.role === 'user' && String(message.content || '').trim();
    });
    var flow = el('director-studio-flow');
    flow.classList.toggle('hidden', !studio);
    if (!studio) return;
    var attached = studioAttachedStoryId();
    var open = window.getStoryboardRouteTarget();
    var openId = String(open && open.storyId || '');
    var title = el('director-studio-flow-title');
    var description = el('director-studio-flow-description');
    var capture = el('director-studio-capture');
    if (attached) {
      title.textContent = 'Concept / overview · Visual / atmosphere';
      description.textContent = 'Review these fields and Invariants in the attached Project. Scenes and Takes stay untouched.';
      capture.textContent = 'Review fields';
    } else {
      title.textContent = 'Concept / overview · Visual / atmosphere';
      description.textContent = 'Capture these fields and optional Invariants in a new Project, or attach an existing one.';
      capture.textContent = 'Review fields';
    }
    capture.disabled = state.pending || state.attachmentPending || !state.sessionReady || !state.modelId || !discussed;
    var useOpen = el('director-studio-flow-target');
    var canAttachOpen = !!openId && openId !== attached;
    useOpen.classList.toggle('hidden', !canAttachOpen);
    if (canAttachOpen) {
      el('director-studio-flow-target-label').textContent = attached
        ? 'Want to work on the Project currently open in Studio instead?'
        : 'Already working in a Project?';
      el('director-studio-attach-current').disabled = state.pending || state.attachmentPending;
    }
  }

  function captureStudioCreativeBrief() {
    if (state.pending || state.attachmentPending || state.activeMode !== 'storyboard') return;
    // The existing explicit Story attachment identifies the editable target.
    // A conversation without one can always create a new independent Project.
    if (studioAttachedStoryId()) prepareStudioBrief();
    else prepareStudioProject();
  }

  function syncControls() {
    var send = el('director-chat-send');
    var input = el('director-chat-input');
    var model = el('director-chat-model');
    var refresh = el('director-chat-model-refresh');
    var clear = el('director-chat-clear');
    if (send) send.disabled = state.pending || state.attachmentPending ||
      (persistentMode(state.activeMode) && !state.sessionReady) || !state.modelId ||
      !String(input && input.value || '').trim();
    if (input) input.disabled = state.pending || (persistentMode(state.activeMode) && !state.sessionReady);
    if (model) model.disabled = state.pending || !state.modelsLoaded;
    if (refresh) refresh.disabled = state.pending;
    if (clear) clear.disabled = state.pending || (persistentMode(state.activeMode) && !state.sessionReady);
    var history = el('director-chat-history-toggle');
    if (history) history.disabled = state.pending || !state.sessionReady;
    syncStudioFlow();
    el('director-studio-prepare-scene').disabled = state.pending || !state.sessionReady ||
      state.activeMode !== 'storyboard';
    el('director-studio-prepare-project').disabled = state.pending || !state.sessionReady ||
      state.activeMode !== 'storyboard' || !state.modelId;
    el('director-studio-prepare-scenes').disabled = state.pending || !state.sessionReady ||
      state.activeMode !== 'storyboard' || !state.modelId;
    el('director-studio-propose-brief').disabled = state.pending || !state.sessionReady ||
      state.activeMode !== 'storyboard' || !state.modelId;
    var briefUndo = el('director-studio-undo-brief');
    briefUndo.classList.toggle('hidden', state.activeMode !== 'storyboard' || !state.studioBriefUndo);
    briefUndo.disabled = state.pending || !state.studioBriefUndo;
    var prepare = el('director-chat-workshop-prepare');
    if (prepare) {
      prepare.disabled = state.pending || !state.modelId || !!(state.workshop && state.workshop.shotError) || !currentMessages().some(function (message) { return message.role === 'user'; });
      prepare.textContent = state.workshopProposal ? 'Review Proposal' : 'Prepare Revision';
    }
    var storyPrepare = el('director-chat-story-prepare');
    storyPrepare.disabled = state.pending || !state.modelId || !guidelineStoryId() || !currentMessages().some(function (message) { return message.role === 'user'; });
    storyPrepare.textContent = state.storyGuidelineProposal ? 'Review Story Changes' : 'Propose Story Changes';
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

      state.modelId = renderDirectorModelOptions(select, models, state.modelId);
      setDirectorModelPreference('webcap.directorChat.model', state.modelId);
      state.modelsLoaded = true;
      syncControls();
    }).catch(function (err) {
      state.modelsLoaded = true;
      state.modelId = '';
      select.innerHTML = '<option value="">Director unavailable</option>';
      syncControls();
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Assistant', err);
    });
  }

  function studioAttachedStoryId() {
    if (state.studioStoryAccess) return state.studioStoryAccess.storyId;
    var ids = Object.keys(state.storyboardAttachments).filter(function (key) {
      return key.indexOf('story:') === 0;
    }).map(function (key) { return key.slice(6); });
    return ids.length === 1 ? ids[0] : '';
  }

  function studioActionStatus(message, error) {
    var status = el('director-studio-action-status');
    status.classList.toggle('hidden', !message);
    status.textContent = message || '';
    status.dataset.error = error ? 'true' : 'false';
  }


  function parseStudioProjectDraft(raw) {
    var value = String(raw || '').trim();
    var fence = String.fromCharCode(96).repeat(3);
    if (value.startsWith(fence) && value.endsWith(fence)) {
      var newline = value.indexOf('\n');
      if (newline >= 0) value = value.slice(newline + 1, -3).trim();
    }
    var proposal;
    try { proposal = JSON.parse(value); }
    catch (error) { throw new Error('Director returned invalid Project JSON: ' + error.message); }
    if (!proposal || Array.isArray(proposal) || typeof proposal !== 'object' ||
        ['title', 'concept', 'style', 'rationale'].some(function (field) { return typeof proposal[field] !== 'string'; }) ||
        !Array.isArray(proposal.invariants) ||
        proposal.invariants.length > 30 ||
        proposal.invariants.some(function (item) {
          return !item || typeof item !== 'object' || Array.isArray(item) ||
            typeof item.kind !== 'string' || typeof item.title !== 'string' || typeof item.text !== 'string' ||
            ['visual', 'character', 'location', 'world', 'sound', 'custom'].indexOf(item.kind) === -1;
        }) ||
        (proposal.firstScene != null && (
          typeof proposal.firstScene !== 'object' || Array.isArray(proposal.firstScene) ||
          typeof proposal.firstScene.title !== 'string' || typeof proposal.firstScene.summary !== 'string' ||
          !proposal.firstScene.summary.trim()
        ))) {
      throw new Error('Project proposal must contain Concept, Style, optional Invariants, and an optional first Scene.');
    }
    if (!proposal.concept.trim() && !proposal.firstScene) {
      throw new Error('Director needs at least an idea or first Scene to prepare a Project.');
    }
    return proposal;
  }

  function addStudioProjectInvariant(item, destination) {
    var host = el(typeof destination === 'string' ? destination : 'studio-project-invariants');
    var row = document.createElement('div');
    row.className = 'studio-project-invariant';
    row.style.cssText = 'display:grid;grid-template-columns:minmax(0,130px) minmax(0,1fr) auto;gap:8px;margin:8px 0;';
    var kind = document.createElement('select');
    kind.setAttribute('aria-label', 'Invariant type');
    ['character', 'location', 'visual', 'world', 'sound', 'custom'].forEach(function (value) {
      var option = document.createElement('option');
      option.value = value;
      option.textContent = value.charAt(0).toUpperCase() + value.slice(1);
      kind.appendChild(option);
    });
    kind.value = item && item.kind || 'character';
    var title = document.createElement('input');
    title.placeholder = 'Name';
    title.setAttribute('aria-label', 'Invariant name');
    title.value = item && item.title || '';
    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'review-captions-btn';
    remove.textContent = 'Remove';
    remove.onclick = function () { row.remove(); };
    var details = document.createElement('textarea');
    details.placeholder = 'Only what must stay consistent';
    details.setAttribute('aria-label', 'Invariant detail');
    details.rows = 2;
    details.style.gridColumn = '1 / -1';
    details.value = item && item.text || '';
    row.append(kind, title, remove, details);
    host.appendChild(row);
  }

  function showStudioProjectReview() {
    var proposal = state.studioProjectProposal;
    if (!proposal) throw new Error('Prepare a Project before opening review.');
    el('studio-project-title').value = proposal.title;
    el('studio-project-concept').value = proposal.concept;
    el('studio-project-style').value = proposal.style;
    el('studio-project-rationale').textContent = proposal.rationale ||
      'Review Concept, Style and Invariants before creating anything.';
    el('studio-project-error').textContent = '';
    el('studio-project-invariants').replaceChildren();
    proposal.invariants.forEach(addStudioProjectInvariant);
    el('studio-project-include-scene').checked = !!proposal.firstScene;
    el('studio-project-first-scene-fields').classList.toggle('hidden', !proposal.firstScene);
    el('studio-project-scene-title').value = proposal.firstScene ? proposal.firstScene.title : '';
    el('studio-project-scene-summary').value = proposal.firstScene ? proposal.firstScene.summary : '';
    var dialog = el('studio-project-review');
    if (dialog.open) dialog.close();
    dialog.showModal();
  }

  function prepareStudioProject() {
    if (state.pending || state.activeMode !== 'storyboard' || !state.sessionReady) return;
    if (state.studioProjectProposal) { showStudioProjectReview(); return; }
    if (!state.modelId) { studioActionStatus('Choose a Director model first.', true); return; }
    var discussion = (state.modeMessages.storyboard || []).filter(function (message) {
      return message && (message.role === 'assistant' || message.role === 'user');
    });
    if (!discussion.some(function (message) { return message.role === 'user'; })) {
      studioActionStatus('Discuss an idea first, then prepare a Project.', true);
      return;
    }
    state.pending = true;
    state.jobId = '';
    studioActionStatus('Preparing a new Project for review…', false);
    startProgress();
    syncControls();
    var input = {
      task: 'Extract only the agreed creative direction into ONE new Studio Project. ' +
        'Provide an editable title (may be blank), concise Concept including the core appeal, ' +
        'optional Style, and only essential Invariants. Include firstScene only if one concrete ' +
        'tentative clip has actually emerged. It is fine to have no first Scene or no full outline. ' +
        'Do not invent a fixed Scene count or prepare a generation prompt. ' +
        'Use a short rationale. Nothing should be created yet.',
      discussion: discussion
    };
    studioDirectorRequestMessages([{ role: 'user', content: JSON.stringify(input) }])
      .then(function (messages) {
        return requestJson('/fs/director/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: state.modelId, operation: 'studio_project_draft', messages: messages })
        });
      }).then(function (payload) {
        if (!payload.job || !payload.job.jobId) throw new Error('Project extraction was not queued.');
        state.jobId = String(payload.job.jobId);
        state.requestDiagnostic = payload.job.request || null;
        trackTransientLlmJob(payload.job);
        return waitForJob(payload.job);
      }).then(function (job) {
        var result = job.result && typeof job.result === 'object' ? job.result : {};
        state.studioProjectProposal = parseStudioProjectDraft(result.text);
        finishProgress(null);
        studioActionStatus('Project ready for review. Nothing has been created.', false);
        showStudioProjectReview();
      }).catch(function (error) {
        finishProgress(error);
        studioActionStatus('Project proposal failed: ' + String(error.message || error), true);
        if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Studio Project proposal', error);
        else throw error;
      }).finally(function () {
        state.pending = false;
        state.jobId = '';
        syncControls();
      });
  }

  function applyStudioProject() {
    if (!state.studioProjectProposal || state.pending) return;
    var proposal = {
      title: el('studio-project-title').value.trim(),
      concept: el('studio-project-concept').value.trim(),
      style: el('studio-project-style').value.trim(),
      invariants: []
    };
    var rows = el('studio-project-invariants').querySelectorAll('.studio-project-invariant');
    rows.forEach(function (row) {
      var fields = row.querySelectorAll('select, input, textarea');
      var text = fields[2].value.trim();
      if (text) proposal.invariants.push({
        kind: fields[0].value, title: fields[1].value.trim(), text: text
      });
    });
    if (el('studio-project-include-scene').checked) {
      proposal.firstScene = {
        title: el('studio-project-scene-title').value.trim(),
        summary: el('studio-project-scene-summary').value.trim()
      };
      if (!proposal.firstScene.summary) {
        el('studio-project-error').textContent = 'Describe the first Scene or uncheck it.';
        return;
      }
    }
    if (!proposal.concept && !proposal.firstScene) {
      el('studio-project-error').textContent = 'Describe the idea or include a first Scene.';
      return;
    }
    state.pending = true;
    syncControls();
    el('studio-project-error').textContent = '';
    var createdStory = null;
    requestJson('/fs/studio/director/project-create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposal: proposal })
    }).then(function (payload) {
      if (!payload.story || !payload.story.id) throw new Error('Project creation returned no authoritative Story ID.');
      createdStory = payload.story;
      state.studioProjectProposal = null;
      el('studio-project-review').close();
      var name = payload.story.title || 'Untitled Project';
      recordStudioOperation('project.create', 'Created Project: ' + name, payload.story.id, payload.story.sceneOrder);
      studioActionStatus('Project created: ' + name + '. Open it from the Studio Library.', false);
      return persistSession('storyboard').then(function () {
        return window.refreshStudioDirectorStoryIfOpen(payload.story.id);
      });
    }).catch(function (error) {
      var detail = String(error.message || error);
      if (createdStory) {
        studioActionStatus('Project ' + (createdStory.title || createdStory.id) +
          ' was created, but the conversation save or Library refresh failed: ' + detail, true);
      } else {
        el('studio-project-error').textContent = 'Creation could not be confirmed: ' + detail +
          '. Check Studio Library before retrying to avoid a duplicate.';
      }
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Studio Project Apply', error);
      else throw error;
    }).finally(function () {
      state.pending = false;
      syncControls();
    });
  }



  function parseStudioBriefDraft(raw) {
    var value = String(raw || '').trim();
    var fence = String.fromCharCode(96).repeat(3);
    if (value.startsWith(fence) && value.endsWith(fence)) {
      var newline = value.indexOf('\n');
      if (newline >= 0) value = value.slice(newline + 1, -3).trim();
    }
    var result;
    try { result = JSON.parse(value); }
    catch (error) { throw new Error('Director returned invalid Concept / Style / Invariants JSON: ' + error.message); }
    if (!result || typeof result !== 'object' || Array.isArray(result) ||
        typeof result.concept !== 'string' || typeof result.style !== 'string' ||
        typeof result.rationale !== 'string' || !Array.isArray(result.invariants) ||
        result.invariants.length > 30 || result.invariants.some(function (item) {
          return !item || typeof item !== 'object' || Array.isArray(item) ||
            typeof item.kind !== 'string' || typeof item.title !== 'string' ||
            typeof item.text !== 'string' ||
            ['character', 'location', 'visual', 'world', 'sound', 'custom'].indexOf(item.kind) === -1;
        })) {
      throw new Error('The proposal must contain Concept, Style, Invariants and a rationale.');
    }
    return result;
  }

  function showStudioBriefReview() {
    var proposal = state.studioBriefProposal;
    if (!proposal) throw new Error('Prepare Concept, Style and Invariants before reviewing.');
    el('studio-brief-target').textContent = 'Project: ' + (proposal.storyTitle || proposal.storyId);
    el('studio-brief-rationale').textContent = proposal.rationale;
    el('studio-brief-concept-before').textContent = 'Current: ' + (proposal.expected.concept || '(empty)');
    el('studio-brief-style-before').textContent = 'Current: ' + (proposal.expected.style || '(empty)');
    el('studio-brief-concept').value = proposal.draft.concept;
    el('studio-brief-style').value = proposal.draft.style;
    el('studio-brief-concept-selected').checked = proposal.draft.concept !== proposal.expected.concept;
    el('studio-brief-style-selected').checked = proposal.draft.style !== proposal.expected.style;
    el('studio-brief-invariants-selected').checked =
      JSON.stringify(proposal.draft.invariants) !== JSON.stringify(proposal.expected.invariants);
    el('studio-brief-invariants').replaceChildren();
    proposal.draft.invariants.forEach(function (item) {
      addStudioProjectInvariant(item, 'studio-brief-invariants');
    });
    el('studio-brief-error').textContent = '';
    var dialog = el('studio-brief-review');
    if (dialog.open) dialog.close();
    dialog.showModal();
  }

  function prepareStudioBrief() {
    if (state.pending || state.activeMode !== 'storyboard' || !state.sessionReady) return;
    if (state.studioBriefProposal) { showStudioBriefReview(); return; }
    if (!state.modelId) { studioActionStatus('Select a Director model.', true); return; }
    var storyId = studioAttachedStoryId();
    if (!storyId) {
      studioActionStatus('Attach a Project explicitly before updating Concept, Style or Invariants.', true);
      return;
    }
    var discussion = (state.modeMessages.storyboard || []).filter(function (message) {
      return message && (message.role === 'assistant' || message.role === 'user');
    });
    state.pending = true;
    state.jobId = '';
    studioActionStatus('Preparing Concept, Style and Invariants for review…', false);
    startProgress();
    syncControls();
    Promise.resolve().then(function () {
      return window.flushStudioDirectorStoryEdits(storyId);
    }).then(function () {
      return requestJson('/fs/storyboard?story=' + encodeURIComponent(storyId));
    }).then(function (payload) {
      var story = payload.story;
      if (!story || story.id !== storyId) throw new Error('Attached Project is unavailable.');
      var expected = { concept: story.concept, style: story.style, invariants: story.invariants };
      var input = {
        task: 'Propose narrowly scoped creative brief changes that the author has actually discussed. ' +
          'Return the FULL revised Concept, Style and Invariant list as reviewable suggestions. ' +
          'Core Appeal stays within Concept. Preserve established details and unrelated facts. ' +
          'Do not change Scenes or prompts. Prefer no change where ideas remain undecided. ' +
          'Any changes must be reviewed by the author before WebCap stores them.',
        project: { id: story.id, title: story.title, concept: story.concept,
          style: story.style, invariants: story.invariants, guidelines: story.guidelines },
        discussion: discussion
      };
      return studioDirectorRequestMessages([{ role: 'user', content: JSON.stringify(input) }])
        .then(function (messages) {
          return requestJson('/fs/director/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({model: state.modelId, operation: 'studio_brief_draft', messages: messages})
          });
        }).then(function (result) {
          if (!result.job || !result.job.jobId) throw new Error('Creative brief extraction was not queued.');
          state.jobId = String(result.job.jobId);
          state.requestDiagnostic = result.job.request || null;
          trackTransientLlmJob(result.job);
          return waitForJob(result.job);
        }).then(function (job) {
          var result = job.result && typeof job.result === 'object' ? job.result : {};
          var draft = parseStudioBriefDraft(result.text);
          state.studioBriefProposal = {
            storyId: storyId, storyTitle: story.title, expected: expected, draft: draft,
            rationale: draft.rationale
          };
          finishProgress(null);
          studioActionStatus('Concept, Style and Invariants ready for review. Nothing has changed.', false);
          showStudioBriefReview();
        });
    }).catch(function (error) {
      finishProgress(error);
      studioActionStatus('Creative brief proposal failed: ' + String(error.message || error), true);
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Studio Brief proposal', error);
      else throw error;
    }).finally(function () {
      state.pending = false;
      state.jobId = '';
      syncControls();
    });
  }

  function applyStudioBrief() {
    var proposal = state.studioBriefProposal;
    if (!proposal || state.pending) return;
    var changes = {};
    if (el('studio-brief-concept-selected').checked) changes.concept = el('studio-brief-concept').value.trim();
    if (el('studio-brief-style-selected').checked) changes.style = el('studio-brief-style').value.trim();
    if (el('studio-brief-invariants-selected').checked) {
      changes.invariants = Array.prototype.map.call(
        el('studio-brief-invariants').querySelectorAll('.studio-project-invariant'), function (row) {
          var fields = row.querySelectorAll('select, input, textarea');
          return {kind: fields[0].value, title: fields[1].value.trim(), text: fields[2].value.trim()};
        }
      );
      if (changes.invariants.some(function (item) { return !item.text; })) {
        el('studio-brief-error').textContent = 'Every retained invariant needs a description.';
        return;
      }
    }
    Object.keys(changes).forEach(function (key) {
      if (JSON.stringify(changes[key]) === JSON.stringify(proposal.expected[key])) delete changes[key];
    });
    if (!Object.keys(changes).length) {
      el('studio-brief-error').textContent = 'Select at least one actual change.';
      return;
    }
    var expected = {};
    Object.keys(changes).forEach(function (field) {
      expected[field] = proposal.expected[field];
    });
    state.pending = true;
    syncControls();
    el('studio-brief-error').textContent = '';
    var applied = false;
    Promise.resolve().then(function () {
      return window.flushStudioDirectorStoryEdits(proposal.storyId);
    }).then(function () {
      return requestJson('/fs/studio/director/brief', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({storyId: proposal.storyId, expected: expected, changes: changes})
      });
    }).then(function (result) {
      if (!result.story || !result.revisionId) throw new Error('Brief Apply did not return its revision ID.');
      applied = true;
      state.studioBriefUndo = {storyId: proposal.storyId, revisionId: result.revisionId};
      state.studioBriefProposal = null;
      el('studio-brief-review').close();
      recordStudioOperation('brief.apply', 'Updated ' + Object.keys(changes).join(', '),
        proposal.storyId, []);
      studioActionStatus('Story brief updated. Undo is available.', false);
      return persistSession('storyboard').then(function () {
        return window.refreshStudioDirectorStoryIfOpen(proposal.storyId);
      });
    }).catch(function (error) {
      if (applied) {
        studioActionStatus('Selected Concept, Style or Invariants changes were applied, but history save or refresh failed: ' +
          String(error.message || error), true);
      } else {
        el('studio-brief-error').textContent = 'Apply was not confirmed: ' +
          String(error.message || error) + '. Refresh the current Story if the connection was lost.';
      }
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Studio Brief Apply', error);
      else throw error;
    }).finally(function () {
      state.pending = false;
      syncControls();
    });
  }

  function undoStudioBrief() {
    var receipt = state.studioBriefUndo;
    if (!receipt || state.pending) return;
    state.pending = true;
    syncControls();
    Promise.resolve().then(function () {
      return window.flushStudioDirectorStoryEdits(receipt.storyId);
    }).then(function () {
      return requestJson('/fs/studio/director/brief/undo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(receipt)
      });
    }).then(function (payload) {
      if (!payload.story || payload.story.id !== receipt.storyId) {
        throw new Error('Concept / Style / Invariants Undo returned an unexpected Project.');
      }
      state.studioBriefUndo = null;
      recordStudioOperation('brief.undo', 'Reverted last Concept / Style / Invariants change', receipt.storyId, []);
      studioActionStatus('Last Concept / Style / Invariants change undone.', false);
      return persistSession('storyboard').then(function () {
        return window.refreshStudioDirectorStoryIfOpen(receipt.storyId);
      });
    }).catch(function (error) {
      studioActionStatus('Concept / Style / Invariants Undo failed: ' + String(error.message || error), true);
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Studio Brief Undo', error);
      else throw error;
    }).finally(function () {
      state.pending = false;
      syncControls();
    });
  }

  function parseStudioScenesDraft(raw) {
    var value = String(raw || '').trim();
    var fence = String.fromCharCode(96).repeat(3);
    if (value.startsWith(fence) && value.endsWith(fence)) {
      var newline = value.indexOf('\n');
      if (newline >= 0) value = value.slice(newline + 1, -3).trim();
    }
    var result;
    try { result = JSON.parse(value); }
    catch (error) { throw new Error('Director returned invalid Scene sequence JSON: ' + error.message); }
    if (!result || typeof result !== 'object' || Array.isArray(result) ||
        !Array.isArray(result.scenes) || result.scenes.length < 1 || result.scenes.length > 8 ||
        typeof result.rationale !== 'string' || result.scenes.some(function (item) {
          return !item || typeof item !== 'object' || Array.isArray(item) ||
            typeof item.title !== 'string' || typeof item.summary !== 'string' || !item.summary.trim();
        })) {
      throw new Error('Director must return one to eight titled/described Scenes and a rationale.');
    }
    return result;
  }

  function addStudioScenesRow(item) {
    var row = document.createElement('section');
    row.className = 'studio-scenes-row';
    row.style.cssText = 'display:grid;gap:8px;margin:0 0 20px;padding:15px;border:1px solid var(--border);border-radius:10px;';
    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;';
    var label = document.createElement('strong');
    label.textContent = 'Tentative Scene';
    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'review-captions-btn';
    remove.textContent = 'Remove';
    remove.onclick = function () { row.remove(); };
    header.append(label, remove);
    var title = document.createElement('input');
    title.setAttribute('aria-label', 'Tentative Scene title');
    title.placeholder = 'Working title (optional)';
    title.maxLength = 240;
    title.value = item.title || '';
    var summary = document.createElement('textarea');
    summary.setAttribute('aria-label', 'Tentative Scene description');
    summary.placeholder = 'What happens in this one generatable clip?';
    summary.rows = 3;
    summary.value = item.summary || '';
    row.append(header, title, summary);
    el('studio-scenes-rows').appendChild(row);
  }

  function showStudioScenesReview() {
    var proposal = state.studioScenesProposal;
    if (!proposal) throw new Error('Prepare Scenes before reviewing them.');
    el('studio-scenes-target').textContent = 'Project: ' + (proposal.storyTitle || proposal.storyId);
    el('studio-scenes-rationale').textContent = proposal.rationale;
    el('studio-scenes-error').textContent = '';
    var host = el('studio-scenes-rows');
    host.replaceChildren();
    proposal.drafts.forEach(addStudioScenesRow);
    var placement = el('studio-scenes-placement');
    placement.replaceChildren();
    function option(value, label) {
      var node = document.createElement('option');
      node.value = value;
      node.textContent = label;
      placement.appendChild(node);
    }
    option('end', 'At the end');
    option('start', 'At the beginning');
    proposal.sceneOrder.forEach(function (id, index) {
      var scene = proposal.scenes[id] || {};
      var text = 'Scene ' + (index + 1) + (scene.title ? ' · ' + scene.title : '');
      option('before|' + id, 'Before ' + text);
      option('after|' + id, 'After ' + text);
    });
    placement.value = 'end';
    var dialog = el('studio-scenes-review');
    if (dialog.open) dialog.close();
    dialog.showModal();
  }

  function prepareStudioScenes() {
    if (state.pending || state.activeMode !== 'storyboard' || !state.sessionReady) return;
    if (state.studioScenesProposal) { showStudioScenesReview(); return; }
    if (!state.modelId) { studioActionStatus('Select a Director model.', true); return; }
    var storyId = studioAttachedStoryId();
    if (!storyId) {
      studioActionStatus('Attach one Project explicitly before preparing a Scene sequence.', true);
      return;
    }
    var discussion = (state.modeMessages.storyboard || []).filter(function (message) {
      return message && (message.role === 'assistant' || message.role === 'user');
    });
    if (!discussion.some(function (message) { return message.role === 'user'; })) {
      studioActionStatus('Discuss the Scenes first, then prepare a sequence.', true);
      return;
    }
    state.pending = true;
    state.jobId = '';
    studioActionStatus('Preparing a Scene sequence for review…', false);
    startProgress();
    syncControls();
    Promise.resolve().then(function () {
      return window.flushStudioDirectorStoryEdits(storyId);
    }).then(function () {
      return requestJson('/fs/storyboard?story=' + encodeURIComponent(storyId));
    }).then(function (payload) {
      var story = payload.story;
      if (!story || story.id !== storyId) throw new Error('Attached Project is no longer available.');
      var order = (story.sceneOrder || []).slice();
      var input = {
        task: 'Extract between one and eight distinct tentative Scenes from the agreed discussion. ' +
          'Keep each Scene independently generatable and preserve the core appeal. ' +
          'Use as many Scenes as the author explicitly requested, up to eight; otherwise ' +
          'select a modest number that fits the discussion. Return title, concise specific ' +
          'what-happens description, and brief rationale. Do not write H3 prompts or modify existing Scenes.',
        project: {
          id: story.id, title: story.title, concept: story.concept, style: story.style,
          invariants: story.invariants,
          currentScenes: order.map(function (id, index) {
            var scene = story.scenes[id];
            return { id: id, position: index + 1, title: scene.title, summary: scene.summary };
          })
        },
        discussion: discussion
      };
      return studioDirectorRequestMessages([{ role: 'user', content: JSON.stringify(input) }])
        .then(function (messages) {
          return requestJson('/fs/director/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: state.modelId, operation: 'studio_scene_sequence_draft', messages: messages })
          });
        }).then(function (result) {
          if (!result.job || !result.job.jobId) throw new Error('Sequence extraction was not queued.');
          state.jobId = String(result.job.jobId);
          state.requestDiagnostic = result.job.request || null;
          trackTransientLlmJob(result.job);
          return waitForJob(result.job);
        }).then(function (job) {
          var result = job.result && typeof job.result === 'object' ? job.result : {};
          var draft = parseStudioScenesDraft(result.text);
          state.studioScenesProposal = {
            storyId: storyId, storyTitle: story.title, sceneOrder: order,
            scenes: story.scenes, drafts: draft.scenes, rationale: draft.rationale
          };
          finishProgress(null);
          studioActionStatus('Scene sequence prepared; review the whole block before creating.', false);
          showStudioScenesReview();
        });
    }).catch(function (error) {
      finishProgress(error);
      studioActionStatus('Scene sequence failed: ' + String(error.message || error), true);
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Studio Scene sequence', error);
      else throw error;
    }).finally(function () {
      state.pending = false;
      state.jobId = '';
      syncControls();
    });
  }

  function applyStudioScenes() {
    var proposal = state.studioScenesProposal;
    if (!proposal || state.pending) return;
    var drafts = Array.prototype.map.call(el('studio-scenes-rows').querySelectorAll('.studio-scenes-row'), function (row) {
      return {
        title: row.querySelector('input').value.trim(),
        summary: row.querySelector('textarea').value.trim()
      };
    });
    if (!drafts.length || drafts.length > 8 || drafts.some(function (item) { return !item.summary; })) {
      el('studio-scenes-error').textContent = 'Review between one and eight Scenes with descriptions.';
      return;
    }
    var pieces = el('studio-scenes-placement').value.split('|');
    var placement = pieces[0];
    var relativeSceneId = pieces[1] || '';
    state.pending = true;
    syncControls();
    el('studio-scenes-error').textContent = '';
    var applied = false;
    Promise.resolve().then(function () {
      return window.flushStudioDirectorStoryEdits(proposal.storyId);
    }).then(function () {
      return requestJson('/fs/studio/director/scenes-draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyId: proposal.storyId, expectedSceneOrder: proposal.sceneOrder,
          scenes: drafts, placement: placement, relativeSceneId: relativeSceneId
        })
      });
    }).then(function (payload) {
      if (!payload.story || !Array.isArray(payload.scenes) ||
          payload.scenes.length !== drafts.length || payload.story.id !== proposal.storyId) {
        throw new Error('Scene sequence Apply returned an incomplete result.');
      }
      applied = true;
      state.studioScenesProposal = null;
      el('studio-scenes-review').close();
      recordStudioOperation('scenes.create', 'Created ' + payload.scenes.length + ' tentative Scenes',
        proposal.storyId, payload.scenes.map(function (scene) { return scene.id; }));
      studioActionStatus(payload.scenes.length + ' Scenes created.', false);
      return persistSession('storyboard').then(function () {
        return window.refreshStudioDirectorStoryIfOpen(proposal.storyId);
      });
    }).catch(function (error) {
      if (applied) {
        studioActionStatus('Scenes were created, but history save or refresh failed: ' +
          String(error.message || error), true);
      } else {
        el('studio-scenes-error').textContent = 'Apply could not be confirmed: ' +
          String(error.message || error) + '. Refresh Project before retrying.';
      }
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Studio Scene sequence Apply', error);
      else throw error;
    }).finally(function () {
      state.pending = false;
      syncControls();
    });
  }

  function parseStudioSceneDraft(raw) {
    var value = String(raw || '').trim();
    var fence = String.fromCharCode(96).repeat(3);
    if (value.startsWith(fence) && value.endsWith(fence)) {
      var newline = value.indexOf('\n');
      if (newline >= 0) value = value.slice(newline + 1, -3).trim();
    }
    var draft;
    try { draft = JSON.parse(value); }
    catch (error) { throw new Error('Director returned invalid Scene draft JSON: ' + error.message); }
    if (!draft || typeof draft !== 'object' || Array.isArray(draft) ||
        typeof draft.title !== 'string' || typeof draft.summary !== 'string' ||
        typeof draft.rationale !== 'string' || !draft.summary.trim()) {
      throw new Error('Scene draft must include a title, description and rationale.');
    }
    return {
      title: draft.title.trim(),
      summary: draft.summary.trim(),
      rationale: draft.rationale.trim()
    };
  }

  function showStudioSceneDraftReview() {
    var proposal = state.studioSceneProposal;
    if (!proposal) throw new Error('Prepare a Studio Scene before reviewing it.');
    var dialog = el('studio-scene-draft-review');
    el('studio-scene-draft-target').textContent = 'Project: ' + (proposal.storyTitle || proposal.storyId);
    el('studio-scene-draft-rationale').textContent = proposal.rationale ||
      'A tentative Scene. No prompt, Takes or generation job will be created.';
    el('studio-scene-draft-title').value = proposal.title;
    el('studio-scene-draft-summary').value = proposal.summary;
    el('studio-scene-draft-error').textContent = '';
    var placement = el('studio-scene-draft-placement');
    placement.replaceChildren();
    function option(value, label) {
      var node = document.createElement('option');
      node.value = value;
      node.textContent = label;
      placement.appendChild(node);
    }
    option('end', 'At the end');
    option('start', 'At the beginning');
    proposal.sceneOrder.forEach(function (sceneId, index) {
      var scene = proposal.scenes[sceneId] || {};
      var name = 'Scene ' + (index + 1) + (scene.title ? ' · ' + scene.title : '');
      option('before|' + sceneId, 'Before ' + name);
      option('after|' + sceneId, 'After ' + name);
    });
    placement.value = proposal.placement || 'end';
    if (dialog.open) dialog.close();
    dialog.showModal();
  }

  function prepareStudioSceneDraft() {
    if (state.pending || state.activeMode !== 'storyboard' || !state.sessionReady) return;
    if (!state.modelId) {
      studioActionStatus('Select a Director model before preparing a Scene.', true);
      return;
    }
    if (state.studioSceneProposal) {
      showStudioSceneDraftReview();
      return;
    }
    var storyId = studioAttachedStoryId();
    if (!storyId) {
      studioActionStatus('Attach one Story using the explicit context controls before preparing a Scene.', true);
      return;
    }
    var discussion = (state.modeMessages.storyboard || []).filter(function (message) {
      return message && (message.role === 'assistant' || message.role === 'user');
    });
    if (!discussion.some(function (message) { return message.role === 'user'; })) {
      studioActionStatus('Explore the idea with Director first, then prepare a Scene from your conversation.', true);
      return;
    }
    state.pending = true;
    state.jobId = '';
    studioActionStatus('Extracting one tentative Scene for review…', false);
    startProgress();
    syncControls();
    Promise.resolve().then(function () {
      return window.flushStudioDirectorStoryEdits(storyId);
    }).then(function () {
      return requestJson('/fs/storyboard?story=' + encodeURIComponent(storyId));
    }).then(function (payload) {
      var story = payload.story;
      if (!story || story.id !== storyId) throw new Error('Attached Story was not found.');
      var order = story.sceneOrder || [];
      state.studioSceneProposal = null;
      var input = {
        task: 'Draft exactly ONE tentative, feasible Scene from this creative discussion. ' +
          'Select the strongest agreed direction. Keep the core appeal. ' +
          'Return a short working title (it may be blank), a concrete description of what ' +
          'happens and why it matters, and a brief production rationale. ' +
          'No generation prompt, new project or existing Scene edits yet.',
        project: {
          id: story.id, title: story.title, concept: story.concept,
          style: story.style, invariants: story.invariants, guidelines: story.guidelines,
          currentScenes: order.map(function (id, index) {
            var scene = story.scenes[id];
            return { id: id, position: index + 1, title: scene.title, intent: scene.summary };
          })
        },
        discussion: discussion.slice(-60)
      };
      return studioDirectorRequestMessages([{ role: 'user', content: JSON.stringify(input, null, 2) }])
        .then(function (messages) {
          return requestJson('/fs/director/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: state.modelId, operation: 'studio_scene_draft', messages: messages
            })
          });
        }).then(function (response) {
          if (!response.job || !response.job.jobId) throw new Error('Scene draft job was not queued.');
          state.jobId = String(response.job.jobId);
          state.requestDiagnostic = response.job.request || null;
          trackTransientLlmJob(response.job);
          return waitForJob(response.job);
        }).then(function (job) {
          var result = job.result && typeof job.result === 'object' ? job.result : {};
          var draft = parseStudioSceneDraft(result.text);
          state.studioSceneProposal = {
            storyId: storyId,
            storyTitle: story.title,
            expectedUpdatedAt: story.updatedAt,
            sceneOrder: order.slice(),
            scenes: story.scenes,
            title: draft.title,
            summary: draft.summary,
            rationale: draft.rationale,
            placement: 'end'
          };
          finishProgress(null);
          studioActionStatus('Scene draft ready. Review and choose its position before creating.', false);
          showStudioSceneDraftReview();
        });
    }).catch(function (error) {
      finishProgress(error);
      studioActionStatus('Scene proposal failed: ' + String(error.message || error), true);
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Studio Scene proposal', error);
      else throw error;
    }).finally(function () {
      state.pending = false;
      state.jobId = '';
      syncControls();
    });
  }

  function applyStudioSceneDraft() {
    var proposal = state.studioSceneProposal;
    if (!proposal || state.pending) return;
    var title = el('studio-scene-draft-title').value.trim();
    var summary = el('studio-scene-draft-summary').value.trim();
    var placementValue = el('studio-scene-draft-placement').value.split('|');
    var placement = placementValue[0];
    var relativeSceneId = placementValue[1] || '';
    if (!summary) {
      el('studio-scene-draft-error').textContent = 'Describe what happens before creating this Scene.';
      return;
    }
    var apply = el('studio-scene-draft-apply');
    apply.disabled = true;
    state.pending = true;
    syncControls();
    el('studio-scene-draft-error').textContent = '';
    var created = null;
    Promise.resolve().then(function () {
      return window.flushStudioDirectorStoryEdits(proposal.storyId);
    }).then(function () {
      return requestJson('/fs/studio/director/scene-draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyId: proposal.storyId,
          expectedUpdatedAt: proposal.expectedUpdatedAt,
          scene: { title: title, summary: summary },
          placement: placement,
          relativeSceneId: relativeSceneId
        })
      });
    }).then(function (payload) {
      if (!payload.scene || !payload.story || payload.story.id !== proposal.storyId) {
        throw new Error('Scene creation returned an incomplete result.');
      }
      created = payload.scene;
      state.studioSceneProposal = null;
      el('studio-scene-draft-review').close();
      var index = payload.story.sceneOrder.indexOf(created.id) + 1;
      var receipt = 'Created tentative Scene ' + index + (title ? ' · ' + title : '') +
        ' in ' + (proposal.storyTitle || proposal.storyId) +
        '. Its intent is saved; the production prompt and Takes remain empty.';
      recordStudioOperation('scene.create', receipt, proposal.storyId, [created.id]);
      studioActionStatus(receipt, false);
      return persistSession('storyboard').catch(function (error) {
        studioActionStatus(receipt + ' Conversation receipt could not be saved: ' + String(error.message || error), true);
      }).then(function () {
        return window.refreshStudioDirectorStoryIfOpen(proposal.storyId);
      });
    }).catch(function (error) {
      var message = String(error.message || error);
      if (!created) el('studio-scene-draft-error').textContent = message;
      studioActionStatus((created ? 'Scene created, but workspace refresh failed: ' : 'Scene creation failed: ') + message, true);
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Studio Scene Apply', error);
      else throw error;
    }).finally(function () {
      state.pending = false;
      apply.disabled = false;
      syncControls();
    });
  }

  function startStudioWorkshop() {
    if (!state.open || state.activeMode !== 'storyboard' || !state.sessionReady ||
        !state.modelsLoaded || state.pending || state.studioIntroPending ||
        currentMessages().length || !state.sessionByMode.storyboard) return;
    if (!state.modelId) {
      finishProgress(new Error('Select an available Director model to begin Writer\'s Workshop.'));
      return;
    }
    state.studioIntroPending = true;
    state.pending = true;
    state.jobId = '';
    syncModeUi();
    startProgress();
    var startedAt = performance.now();
    var opening = [{
      role: 'user',
      content: "Let's develop an idea together. Ask me questions one at a time, " +
        "help me discover what makes it interesting, and let's figure out how to make it work as a video."
    }];
    studioDirectorRequestMessages(opening).then(function (messages) {
      return requestJson('/fs/director/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: state.modelId, messages: messages })
      });
    }).then(function (payload) {
      if (!payload.job || !payload.job.jobId) throw new Error('Studio Director did not return a queued job.');
      state.jobId = String(payload.job.jobId);
      state.requestDiagnostic = payload.job.request || null;
      trackTransientLlmJob(payload.job);
      return waitForJob(payload.job);
    }).then(function (job) {
      var result = job.result && typeof job.result === 'object' ? job.result : {};
      var answer = String(result.text || '').trim();
      if (!answer) throw new Error('Studio Director returned an empty opening question.');
      var messages = state.modeMessages.storyboard;
      messages.push({ role: 'assistant', content: answer });
      var index = messages.length - 1;
      state.modeElapsedByAssistantIndex.storyboard[index] = performance.now() - startedAt;
      state.modeMetricsByAssistantIndex.storyboard[index] = completedResponseMetrics(result);
      renderMessages();
      return persistSession('storyboard');
    }).then(function () {
      finishProgress(null);
    }).catch(function (error) {
      finishProgress(error);
      el('director-chat-empty-description').textContent = 'Director could not start: ' +
        String(error.message || error) + '. Use Start Writer\'s Workshop to retry.';
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Studio Director', error);
      else throw error;
    }).finally(function () {
      state.studioIntroPending = false;
      state.pending = false;
      state.jobId = '';
      syncModeUi();
    });
  }

  function maybeOpenNewStudioConversation() {
    if (state.open && state.activeMode === 'storyboard' && state.sessionReady &&
        state.modelsLoaded && !state.pending && !state.sessionByMode.storyboard) {
      newChat({ preserveContext: !!state.workshop || !!Object.keys(state.storyboardAttachments).length });
    }
  }

  function newChat(options) {
    if (state.pending || !state.sessionReady) return;
    var preserveContext = !!(options && options.preserveContext);
    if (!persistentMode(state.activeMode)) {
      state.modeMessages[state.activeMode] = [];
      state.modeElapsedByAssistantIndex[state.activeMode] = {};
      state.modeMetricsByAssistantIndex[state.activeMode] = {};
      syncModeUi();
      return;
    }
    var mode = state.activeMode;
    var created = false;
    state.pending = true;
    syncControls();
    flushSessionSave().then(function () {
      return requestJson('/fs/director/chats', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: mode })
      });
    }).then(function (payload) {
      var chat = payload.chat;
      state.sessionByMode[mode] = chat;
      state.sessionActiveByMode[mode] = chat.id;
      created = true;
      state.draftByMode[mode] = '';
      state.sessionDirty[mode] = false;
      if (mode === 'chat') {
        state.messages = [];
        state.elapsedByAssistantIndex = {};
        state.metricsByAssistantIndex = {};
      } else {
        state.modeMessages.storyboard = [];
        state.studioOperations = [];
        state.modeElapsedByAssistantIndex.storyboard = {};
        state.modeMetricsByAssistantIndex.storyboard = {};
        if (!preserveContext) {
          state.storyboardAttachments = {};
          state.studioStoryAccess = null;
          state.studioAccessIndex = null;
          state.workshop = null;
        }
        state.workshopProposal = null;
        state.studioSceneProposal = null;
        state.studioProjectProposal = null;
        state.studioScenesProposal = null;
        state.studioBriefProposal = null;
        state.storyGuidelineProposal = null;
        el('director-chat-workshop-status').textContent = '';
      }
      el('director-chat-input').value = '';
      upsertSessionSummary(chat);
      showSessionStatus('Saved', false);
      finishProgress(null);
      syncModeUi();
      el('director-chat-input').focus();
    }).catch(showSessionFailure).finally(function () {
      state.pending = false;
      syncControls();
      if (created && mode === 'storyboard' && !preserveContext &&
          state.open && state.activeMode === mode) startStudioWorkshop();
    });
  }

  function jobRequest(jobId) {
    return requestJson('/fs/director/job?job=' + encodeURIComponent(jobId) + '&consume=1').then(function (payload) {
      if (!payload.job) throw new Error('Assistant job response is missing its job.');
      trackTransientLlmJob(payload.job);
      if (['completed', 'failed', 'cancelled', 'stopped', 'interrupted'].indexOf(String(payload.job.status || '')) !== -1) {
        reportTransientLlmTiming(payload.job);
      }
      return payload.job;
    });
  }

  function waitForJob(job) {
    if (!job || !job.jobId) throw new Error('Assistant did not return a queued job.');
    function poll(current) {
      var status = String(current.status || '');
      if (status === 'completed') return Promise.resolve(current);
      if (['failed', 'cancelled', 'stopped', 'interrupted'].indexOf(status) !== -1) {
        var terminalError = new Error(current.error || ('Assistant job ' + status + '.'));
        terminalError.jobStatus = status;
        throw terminalError;
      }
      var delay = status === 'queued' ? 4000 : 2500;
      return new Promise(function (resolve) { setTimeout(resolve, delay); })
        .then(function () { return jobRequest(current.jobId); })
        .then(poll);
    }
    return poll(job);
  }

  function stopJob() {
    var stop = el('director-chat-stop');
    var mode = activeContextMode();
    if (!stop || stop.disabled) return;
    if (mode && typeof mode.cancel === 'function' && state.pending) {
      stop.disabled = true;
      stop.textContent = 'Stopping…';
      Promise.resolve(mode.cancel()).catch(function (err) {
        stop.disabled = false;
        stop.textContent = 'Stop';
        if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Assistant', err);
      });
      return;
    }
    if (!state.jobId) return;
    stop.disabled = true;
    stop.textContent = 'Stopping…';
    resetLlmExecution().then(function () {
      renderProgress({
        phase: 'stopped',
        jobStatus: 'stopped',
        model: state.modelId
      });
    }).catch(function (err) {
      stop.disabled = false;
      stop.textContent = 'Stop';
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Assistant', err);
    });
  }

  function studioDirectorRequestMessages(messages) {
    return requestJson('/fs/studio/director/guidance?targetModel=minimax_h3').then(function (payload) {
      if (!payload.system || typeof payload.system !== 'string') {
        throw new Error('Studio Director production guidance is missing.');
      }
      var outbound = storyboardRequestMessages(messages, false);
      // Conversation context is opt-in. The workbench state only tells Director
      // what WebCap can review next; it is not a fresh Story or Scene attachment.
      var storyRefs = Object.keys(state.storyboardAttachments || {}).filter(function (key) {
        return key.indexOf('story:') === 0;
      });
      var workbench = state.studioStoryAccess
        ? 'The author granted read access to Story ' + state.studioStoryAccess.storyId +
          '. Grant alone supplies no field values; only fields explicitly present in a particular ' +
          'request may be used. Never claim to have inspected other data.'
        : storyRefs.length === 1
          ? 'A historical Story snapshot is attached (' + storyRefs[0].slice(6) + ').'
          : 'No Story access was granted; review of fields would propose creating a Project.';
      outbound[0] = { role: 'system', content: payload.system +
        '\n\nSTUDIO WORKBENCH STATE (controls, not saved Story facts):\n' + workbench +
        '\nWhen choices are clear, offer to review Concept / overview, Visual / atmosphere and Invariants. ' +
        'Keep exploring when they are still tentative; never claim a proposal was saved.\n' +
        outbound[0].content };
      return outbound;
    });
  }

  function studioDirectorChatRequestMessages(messages) {
    return studioDirectorRequestMessages(messages).then(function (outbound) {
      if (state.studioStoryAccess) {
        outbound[0] = {role: 'system', content: outbound[0].content + '\n' +
          'ON-DEMAND STORY READ: If the author asks about current Story details you have not been given, ' +
          'respond ONLY with one of these exact standalone tokens: ' +
          '[[WEBCAP_READ:brief]], [[WEBCAP_READ:index]], [[WEBCAP_READ:scene:N]], ' +
          '[[WEBCAP_READ:prompt:N]], [[WEBCAP_READ:takes:N]], where N is a 1-based Scene number. ' +
          'WebCap will privately retrieve the requested fields and ask you to answer again. ' +
          'Do not use the token for ordinary brainstorming, and never claim a read or update without evidence. ' +
          'The tokens are not conversation content and do not grant write access.'};
      }
      return outbound;
    });
  }

  function parseStudioReadRequest(text) {
    var answer = String(text || '').trim();
    var match = /^\[\[WEBCAP_READ:(brief|index|scene|prompt|takes)(?::([1-9][0-9]{0,2}))?\]\]$/.exec(answer);
    if (!match) {
      if (answer.indexOf('[[WEBCAP_READ:') !== -1) {
        throw new Error('Director returned an invalid Story read request.');
      }
      return null;
    }
    var field = match[1], number = match[2] ? Number(match[2]) : 0;
    if ((['scene', 'prompt', 'takes'].indexOf(field) !== -1) !== !!number) {
      throw new Error('Director Story read request has invalid Scene selection.');
    }
    return {field: field, position: number};
  }

  function resumeStudioAfterRead(messages, command) {
    if (!state.studioStoryAccess) throw new Error('Director requested Story data without author access.');
    var locate = command.position
      ? readStudioStoryScope('index', '').then(function (result) {
          if (!Array.isArray(result.data) || command.position > result.data.length) {
            throw new Error('Requested Scene is not in the attached Story.');
          }
          return result.data[command.position - 1].id;
        })
      : Promise.resolve('');
    return locate.then(function (sceneId) {
      return readStudioStoryScope(command.field, sceneId);
    }).then(function (reading) {
      var original = messages[messages.length - 1];
      if (!original || original.role !== 'user') throw new Error('Studio read requires a user question.');
      // This copy goes ONLY to the second model request, never the saved transcript.
      var resumed = messages.slice(0, -1).concat([{
        role: 'user',
        content: original.content + '\n\n[WEBCAP CURRENT STORY READ — private request context]\n' +
          JSON.stringify({
            storyId: reading.storyId, storyUpdatedAt: reading.storyUpdatedAt,
            field: reading.field, sceneId: reading.sceneId, data: reading.data
          }) +
          '\n[END READ]\nAnswer my original question conversationally. Do not repeat the full field data or request more reads.'
      }]);
      return studioDirectorRequestMessages(resumed).then(function (outbound) {
        return requestJson('/fs/director/chat', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({model: state.modelId, messages: outbound})
        });
      }).then(function (payload) {
        if (!payload.job || !payload.job.jobId) throw new Error('Story read continuation did not queue.');
        state.jobId = String(payload.job.jobId);
        state.requestDiagnostic = payload.job.request || null;
        trackTransientLlmJob(payload.job);
        return waitForJob(payload.job);
      }).then(function (job) {
        var result = job.result && typeof job.result === 'object' ? job.result : {};
        if (parseStudioReadRequest(result.text)) {
          throw new Error('Director requested another read; only one read per turn is supported.');
        }
        var view = el('director-studio-access-data');
        view.textContent = JSON.stringify(reading.data, null, 2);
        view.classList.remove('hidden');
        el('director-studio-access-status').textContent =
          'Director read ' + reading.field + (reading.sceneId ? ' · ' + reading.sceneId : '') + ' for this reply.';
        return result;
      });
    });
  }

  function storyboardRequestMessages(messages, includePrimer) {
    var context = includePrimer === false ? [] : [STORYBOARD_WORKSHOP_PRIMER];
    if (state.workshop) {
      var scene = state.workshop;
      context.push('[CURRENT STORY AND SCENE - CREATIVE WORKING CONTEXT]\n' + JSON.stringify({
        storyTitle: scene.storyTitle,
        storyConcept: scene.concept,
        directingGuidelines: scene.guidelines,
        sceneTitle: scene.sceneTitle,
        sceneIntent: scene.sceneSummary,
        durationSeconds: scene.durationSeconds,
        timedShots: scene.shots,
        shotAvailability: scene.shotError || 'Timed shots attached for creative discussion'
      }, null, 2));
    }
    var outbound = messages.slice();
    var attached = Object.keys(state.storyboardAttachments).filter(function (key) {
      return !state.studioStoryAccess || (key.indexOf('story:') !== 0 && key.indexOf('scene:') !== 0);
    }).map(function (key) {
      var item = state.storyboardAttachments[key];
      return item.label + ':\n' + item.content;
    });
    if (attached.length) {
      // Put the actual reference alongside the current user request. Some chat
      // templates give system-only reference text less weight than user content.
      var last = outbound.length - 1;
      if (last < 0 || outbound[last].role !== 'user') {
        throw new Error('Storyboard attachment requires a current user message.');
      }
      outbound[last] = {
        role: 'user',
        content: '[ATTACHED STORYBOARD REFERENCE - supplied inline in this request]\n'
          + attached.join('\n\n')
          + '\n[END ATTACHED STORYBOARD REFERENCE]\n\n[AUTHOR MESSAGE]\n'
          + outbound[last].content
      };
    }
    return [{ role: 'system', content: context.join('\n\n') }].concat(outbound);
  }

  function attachStoryboardContext(kind) {
    if (state.pending || state.attachmentPending) return;
    if (typeof window.getStoryboardAssistantContext !== 'function') throw new Error('Storyboard context provider is missing.');
    state.attachmentPending = true;
    syncModeUi();
    return Promise.resolve().then(function () {
      return window.getStoryboardAssistantContext(kind);
    }).then(function (item) {
      if (!item || !item.key || !item.content) throw new Error('No Storyboard ' + kind + ' available to attach.');
      if (kind === 'story') {
        Object.keys(state.storyboardAttachments).forEach(function (key) {
          if (key.indexOf('story:') === 0 && key !== item.key) delete state.storyboardAttachments[key];
        });
      }
      state.storyboardAttachments[item.key] = item;
      if (kind === 'story') state.studioSceneProposal = null;
      state.storyGuidelineProposal = null;
      scheduleSessionSave();
      el('director-chat-attachments-toggle').setAttribute('aria-expanded', 'true');
      syncModeUi();
      el('director-chat-attachments-status').textContent = 'Attached ' + item.label + '.';
    }).catch(function (err) {
      el('director-chat-workshop-status').textContent = 'Attach failed: ' + String(err.message || err);
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Storyboard attachment', err);
      else throw err;
    }).finally(function () {
      state.attachmentPending = false;
      syncModeUi();
    });
  }

  function renderWorkshopDiff(before, after) {
    var host = el('storyboard-workshop-review-diff');
    if (!host) throw new Error('Workshop review diff markup is missing.');
    host.replaceChildren();
    var beforeLines = String(before || '').replace(/\r\n/g, '\n').split('\n');
    var afterLines = String(after || '').replace(/\r\n/g, '\n').split('\n');
    function line(kind, content) {
      var item = document.createElement('div');
      item.className = 'storyboard-workshop-diff-line';
      item.dataset.kind = kind;
      item.textContent = (kind === 'removed' ? '- ' : kind === 'added' ? '+ ' : '  ') + content;
      host.appendChild(item);
    }
    // Bounded line comparison; large inputs still receive an honest before/after view.
    if (beforeLines.length * afterLines.length > 60000) {
      beforeLines.forEach(function (value) { line('removed', value); });
      afterLines.forEach(function (value) { line('added', value); });
      return;
    }
    var dp = Array.from({ length: beforeLines.length + 1 }, function () {
      return Array(afterLines.length + 1).fill(0);
    });
    for (var i = beforeLines.length - 1; i >= 0; i -= 1) {
      for (var j = afterLines.length - 1; j >= 0; j -= 1) {
        dp[i][j] = beforeLines[i] === afterLines[j] ? dp[i + 1][j + 1] + 1 :
          Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var a = 0;
    var b = 0;
    while (a < beforeLines.length || b < afterLines.length) {
      if (a < beforeLines.length && b < afterLines.length && beforeLines[a] === afterLines[b]) {
        line('same', beforeLines[a++]); b += 1;
      } else if (a < beforeLines.length && (b === afterLines.length || dp[a + 1][b] >= dp[a][b + 1])) {
        line('removed', beforeLines[a++]);
      } else {
        line('added', afterLines[b++]);
      }
    }
  }

  function showWorkshopReview() {
    if (!state.workshop || !state.workshopProposal) throw new Error('No prepared Scene Workshop revision is available.');
    var modal = el('storyboard-workshop-review');
    if (!modal) throw new Error('Scene Workshop review dialog is missing.');
    modal.dataset.mode = 'proposal';
    el('storyboard-workshop-review-title').textContent = 'Review Scene Revision';
    el('storyboard-workshop-review-target').textContent = state.workshop.sceneTitle + ' · Timed shots';
    el('storyboard-workshop-review-summary').textContent = state.workshopProposal.summary;
    el('storyboard-workshop-review-error').textContent = '';
    el('storyboard-workshop-review-apply').hidden = false;
    modal.querySelector('.storyboard-workshop-review-note').hidden = false;
    el('storyboard-workshop-review-back').textContent = 'Back to discussion';
    renderWorkshopDiff(state.workshop.shots, state.workshopProposal.shots);
    if (modal.open) modal.close();
    modal.showModal();
  }

  window.openStoryboardPromptChanges = function (original, current, title) {
    var modal = el('storyboard-workshop-review');
    if (!modal) throw new Error('Scene Workshop review dialog is missing.');
    modal.dataset.mode = 'history';
    el('storyboard-workshop-review-title').textContent = 'Last Scene Changes';
    el('storyboard-workshop-review-target').textContent = title || 'Generation prompt';
    el('storyboard-workshop-review-summary').textContent = 'Comparison with the previously saved prompt.';
    el('storyboard-workshop-review-error').textContent = '';
    el('storyboard-workshop-review-apply').hidden = true;
    modal.querySelector('.storyboard-workshop-review-note').hidden = true;
    el('storyboard-workshop-review-back').textContent = 'Close';
    renderWorkshopDiff(original, current);
    if (modal.open) modal.close();
    modal.showModal();
  };


  function parseWorkshopProposal(raw) {
    var value = String(raw || '').trim();
    var fence = String.fromCharCode(96).repeat(3);
    if (value.startsWith(fence) && value.endsWith(fence)) {
      var start = value.indexOf('\n');
      if (start >= 0) value = value.slice(start + 1, -3).trim();
    }
    var proposed;
    try { proposed = JSON.parse(value); }
    catch (error) { throw new Error('Director returned invalid Workshop JSON: ' + error.message); }
    if (!proposed || typeof proposed.summary !== 'string' || typeof proposed.shots !== 'string' ||
        !proposed.summary.trim() || !proposed.shots.trim()) {
      throw new Error('Workshop proposal requires a summary and complete replacement shots.');
    }
    if (!/^\s*\[Shot\s+\d+\]/im.test(proposed.shots)) {
      throw new Error('Workshop proposal requires numbered [Shot N] entries.');
    }
    return { summary: proposed.summary.trim(), shots: proposed.shots.trim() };
  }

  function prepareWorkshopRevision() {
    if (!state.workshop || state.activeMode !== 'storyboard') throw new Error('Open a Scene Workshop first.');
    if (state.workshop.shotError) throw new Error(state.workshop.shotError);
    if (state.pending || !state.modelId) return;
    if (state.workshopProposal) { showWorkshopReview(); return; }
    var decisions = (state.modeMessages.storyboard || []).filter(function (message) {
      return message && (message.role === 'assistant' || message.role === 'user');
    });
    if (!decisions.some(function (message) { return message.role === 'user'; })) {
      throw new Error('Discuss an improvement before preparing the revision.');
    }
    var scene = state.workshop;
    var instructions = [
      'Prepare a focused revision of the timed shots in a short AI-generated video Scene.',
      'Use the creative decisions in the workshop conversation to author a complete replacement timed-shot section.',
      'Preserve established identities, visual facts and the intended duration while improving the elements discussed.',
      'Write numbered [Shot N] entries with appropriate time intervals and concrete visual actions.',
      'The application keeps Subject, Scene Overview, Environment, Style and audio unchanged by replacing only timed-shot text.',
      'Return one JSON object with string fields "summary" (brief intended changes) and "shots" (complete replacement timed-shot text).'
    ].join('\n');
    var messages = [
      { role: 'system', content: instructions },
      { role: 'user', content: JSON.stringify({
        storyConcept: scene.concept,
        directingGuidelines: scene.guidelines,
        sceneIntent: scene.sceneSummary,
        durationSeconds: scene.durationSeconds,
        originalTimedShots: scene.shots,
        selectedSceneSections: Object.keys(state.storyboardAttachments).map(function (key) {
          return state.storyboardAttachments[key];
        }),
        workshopDiscussion: decisions
      }, null, 2) }
    ];
    state.pending = true;
    state.jobId = '';
    el('director-chat-workshop-status').textContent = 'Preparing shot proposal…';
    startProgress();
    syncControls();
    requestJson('/fs/director/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: state.modelId, operation: "storyboard_workshop_shots", messages: messages })
    }).then(function (payload) {
      if (!payload.job || !payload.job.jobId) throw new Error('Workshop proposal job was not queued.');
      state.jobId = String(payload.job.jobId);
      state.requestDiagnostic = payload.job.request || null;
      trackTransientLlmJob(payload.job);
      return waitForJob(payload.job);
    }).then(function (job) {
      if (state.workshop !== scene) throw new Error('Scene Workshop changed during the proposal. Open the selected Scene and prepare again.');
      var result = job.result && typeof job.result === 'object' ? job.result : {};
      state.workshopProposal = parseWorkshopProposal(result.text);
      el('director-chat-workshop-status').textContent = 'Proposal ready for review';
      showWorkshopReview();
    }).catch(function (error) {
      el('director-chat-workshop-status').textContent = 'Proposal failed: ' + String(error.message || error);
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Scene Workshop', error);
      else throw error;
    }).finally(function () {
      state.pending = false;
      state.jobId = '';
      finishProgress(null);
      syncControls();
    });
  }

  function parseStoryGuidelineProposal(raw) {
    var value = String(raw || '').trim();
    var fence = String.fromCharCode(96).repeat(3);
    if (value.startsWith(fence) && value.endsWith(fence)) {
      var firstLine = value.indexOf('\n');
      if (firstLine >= 0) value = value.slice(firstLine + 1, -3).trim();
    }
    var parsed;
    try { parsed = JSON.parse(value); }
    catch (err) { throw new Error('Director returned invalid guideline JSON: ' + err.message); }
    if (!parsed || typeof parsed.summary !== 'string' || !parsed.guidelines ||
        typeof parsed.guidelines !== 'object' || Array.isArray(parsed.guidelines)) {
      throw new Error('Director guideline proposal must contain summary and named guideline fields.');
    }
    var allowed = ['visualFocus', 'creativeDirection', 'variation', 'pacing', 'sceneRelationships'];
    Object.keys(parsed.guidelines).forEach(function (key) {
      if (allowed.indexOf(key) < 0 || typeof parsed.guidelines[key] !== 'string') {
        throw new Error('Director returned an unsupported Story guideline field: ' + key);
      }
    });
    return parsed;
  }

  function reviewStoryChanges() {
    var proposal = state.storyGuidelineProposal;
    if (!proposal) throw new Error('Prepare Story changes before reviewing.');
    if (typeof window.openStoryboardGuidelineReview !== 'function') throw new Error('Storyboard guideline review is unavailable.');
    window.openStoryboardGuidelineReview({
      storyId: proposal.storyId,
      title: 'Review Story Changes',
      summary: proposal.summary || 'Suggested by Storyboard Chat',
      expectedGuidelines: proposal.expectedGuidelines,
      changes: proposal.changes,
      onApplied: function (story) {
        state.storyGuidelineProposal = null;
        var attachedKey = 'story:' + proposal.storyId;
        if (state.storyboardAttachments[attachedKey]) {
          // The Story provider now returns a Promise after flushing saves.
          // Reuse the normal attach path so no Promise is stored as reference data.
          attachStoryboardContext('story');
        }
        if (state.workshop && state.workshop.storyId === proposal.storyId) {
          state.workshop.guidelines = Object.assign({}, story.guidelines || {});
        }
        el('director-chat-workshop-status').textContent = 'Story guidelines updated';
        syncControls();
      }
    });
  }

  function prepareStoryChanges() {
    if (state.activeMode !== 'storyboard' || !guidelineStoryId()) throw new Error('Attach a Story or open its Scene Workshop first.');
    if (state.pending || !state.modelId) return;
    if (state.storyGuidelineProposal) { reviewStoryChanges(); return; }
    var discussion = currentMessages().filter(function (message) {
      return message && (message.role === 'assistant' || message.role === 'user');
    });
    if (!discussion.some(function (message) { return message.role === 'user'; })) {
      throw new Error('Discuss the desired Story direction before preparing changes.');
    }
    if (typeof window.getStoryboardGuidelineSnapshot !== 'function') throw new Error('Storyboard guideline context is unavailable.');
    var storyId = guidelineStoryId();
    state.pending = true;
    state.jobId = '';
    el('director-chat-workshop-status').textContent = 'Preparing Story guideline proposal…';
    startProgress();
    syncControls();
    Promise.resolve().then(function () {
      return window.getStoryboardGuidelineSnapshot(storyId);
    }).then(function (story) {
      var messages = [
        { role: 'system', content: [
          'Review this Storyboard creative discussion for explicitly agreed changes to the five Story Directing Guideline fields.',
          'The fields are visualFocus, creativeDirection, variation, pacing, and sceneRelationships. Preserve the author\'s meaning.',
          'Propose only fields that need a change based on the discussion, keeping existing detail not contradicted by those decisions.',
          'Use a brief summary and a guidelines object containing only changed field values. Return an empty guidelines object when no edit is warranted.',
          'All proposals require separate human review before any Story data changes.'
        ].join('\n') },
        { role: 'user', content: JSON.stringify({ story: story, workshopDiscussion: discussion }, null, 2) }
      ];
      return requestJson('/fs/director/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: state.modelId, operation: 'storyboard_story_guidelines', messages: messages })
      }).then(function (payload) {
        if (!payload.job || !payload.job.jobId) throw new Error('Story guideline proposal job was not queued.');
        state.jobId = String(payload.job.jobId);
        state.requestDiagnostic = payload.job.request || null;
        trackTransientLlmJob(payload.job);
        return waitForJob(payload.job);
      }).then(function (job) {
        var result = job.result && typeof job.result === 'object' ? job.result : {};
        var proposed = parseStoryGuidelineProposal(result.text);
        var changes = {};
        Object.keys(proposed.guidelines).forEach(function (key) {
          var suggested = proposed.guidelines[key].trim();
          if (suggested !== String((story.guidelines || {})[key] || '').trim()) changes[key] = suggested;
        });
        if (!Object.keys(changes).length) {
          el('director-chat-workshop-status').textContent = 'No Story guideline changes suggested';
          return;
        }
        state.storyGuidelineProposal = {
          storyId: storyId,
          expectedGuidelines: story.guidelines,
          changes: changes,
          summary: proposed.summary
        };
        el('director-chat-workshop-status').textContent = 'Story changes ready for review';
        reviewStoryChanges();
      });
    }).catch(function (error) {
      el('director-chat-workshop-status').textContent = 'Story proposal failed: ' + String(error.message || error);
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Storyboard Story proposal', error);
      else throw error;
    }).finally(function () {
      state.pending = false;
      state.jobId = '';
      finishProgress(null);
      syncControls();
    });
  }

  function applyWorkshopRevision() {
    if (!state.workshopProposal || !state.workshop) throw new Error('A prepared Scene revision is required.');
    var proposal = state.workshopProposal;
    var scene = state.workshop;
    var button = el('storyboard-workshop-review-apply');
    button.disabled = true;
    state.pending = true;
    syncControls();
    button.textContent = 'Applying…';
    el('storyboard-workshop-review-error').textContent = '';
    Promise.resolve(window.applyStoryboardWorkshopRevision({
      storyId: scene.storyId,
      sceneId: scene.sceneId,
      expectedPrompt: scene.expectedPrompt,
      shots: proposal.shots
    })).then(function (payload) {
      if (!payload || !payload.scene || typeof payload.scene.prompt !== 'string') {
        throw new Error('Workshop Apply did not return an updated Scene.');
      }
      scene.expectedPrompt = payload.scene.prompt;
      scene.shots = proposal.shots;
      state.workshopProposal = null;
      scheduleSessionSave();
      el('director-chat-workshop-status').textContent = 'Revision applied · previous version saved';
      el('storyboard-workshop-review').close();
      syncControls();
    }).catch(function (error) {
      el('storyboard-workshop-review-error').textContent = String(error.message || error);
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Scene Workshop Apply', error);
      else throw error;
    }).finally(function () {
      state.pending = false;
      button.disabled = false;
      button.textContent = 'Apply Revision';
      syncControls();
    });
  }

  function sendMessage() {
    var input = el('director-chat-input');
    if (!input || state.pending || state.attachmentPending) return;
    var content = String(input.value || '').trim();
    if (!content || !state.modelId) return;
    var activeChatMode = state.activeMode;
    if (persistentMode(activeChatMode) && !state.sessionReady) {
      showSessionFailure(new Error('Conversation history must load before sending a message.'));
      return;
    }

    if (!inputHistory.length || inputHistory[inputHistory.length - 1] !== content) inputHistory.push(content);
    inputHistoryIndex = inputHistory.length;
    inputHistoryDraft = '';

    if (activeChatMode === 'storyboard') {
      state.storyGuidelineProposal = null;
      state.workshopProposal = null;
      state.studioSceneProposal = null;
      state.studioProjectProposal = null;
      state.studioScenesProposal = null;
      state.studioBriefProposal = null;
      el('director-chat-workshop-status').textContent = '';
    }
    var messages = currentMessages();
    var elapsedMap = currentElapsedMap();
    var metricsMap = currentMetricsMap();
    var mode = activeContextMode();
    messages.push({ role: 'user', content: content });
    input.value = '';
    if (persistentMode(activeChatMode)) {
      state.draftByMode[activeChatMode] = '';
      if (state.sessionTimer) clearTimeout(state.sessionTimer);
      state.sessionTimer = 0;
      state.sessionDirty[activeChatMode] = true;
    }
    state.pending = true;
    state.jobId = '';
    renderMessages();
    syncControls();
    startProgress();

    var startedAt = performance.now();
    var requestError = null;
    // Commit the user's words BEFORE asking the model. A refresh or failed
    // inference can never discard the user's last sent message.
    var saved = persistentMode(activeChatMode) ? persistSession(activeChatMode) : Promise.resolve();
    var requestPromise = saved.then(function () {
      if (mode) {
        return Promise.resolve(mode.execute({
          instruction: content,
          modelId: state.modelId
        })).then(function (result) {
          result = result && typeof result === 'object' ? result : {};
          messages.push({
            role: 'assistant',
            content: String(result.text || mode.successMessage || (mode.label + ' completed.'))
          });
          elapsedMap[messages.length - 1] = performance.now() - startedAt;
        });
      }
      return (activeChatMode === 'storyboard'
        ? studioDirectorChatRequestMessages(messages)
        : Promise.resolve(messages)).then(function (outboundMessages) {
        return requestJson('/fs/director/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: state.modelId, messages: outboundMessages })
        });
      }).then(function (payload) {
        if (!payload.job || !payload.job.jobId) throw new Error('Assistant did not return a queued job.');
        state.jobId = String(payload.job.jobId);
        state.requestDiagnostic = payload.job.request || null;
        trackTransientLlmJob(payload.job);
        renderProgress({ phase: payload.job.status === 'queued' ? 'queued' : 'preparing', jobStatus: payload.job.status, model: payload.job.modelId });
        return waitForJob(payload.job);
      }).then(function (job) {
        var result = job.result && typeof job.result === 'object' ? job.result : {};
        if (activeChatMode !== 'storyboard') return result;
        var read = parseStudioReadRequest(result.text);
        return read ? resumeStudioAfterRead(messages, read) : result;
      }).then(function (result) {
        messages.push({ role: 'assistant', content: String(result.text || '') });
        var assistantIndex = messages.length - 1;
        elapsedMap[assistantIndex] = performance.now() - startedAt;
        metricsMap[assistantIndex] = completedResponseMetrics(result);
      });
    }).then(function () {
      // Keep the response visible while its durable save completes.
      if (persistentMode(activeChatMode)) return persistSession(activeChatMode);
    });

    requestPromise.catch(function (err) {
      requestError = err;
      if (['stopped', 'cancelled'].indexOf(String(err && err.jobStatus || '')) === -1) {
        if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Assistant', err);
      }
    }).then(function () {
      state.pending = false;
      state.jobId = '';
      finishProgress(requestError && ['stopped', 'cancelled'].indexOf(String(requestError && requestError.jobStatus || '')) === -1 ? requestError : null);
      renderMessages();
      syncControls();
      if (input) input.focus();
    });
  }

  function syncPinnedUi() {
    var frame = el('app-frame');
    var pin = el('director-chat-pin');
    if (!frame || !pin) return;

    frame.classList.toggle('director-chat-pinned', state.pinned && state.open);
    pin.classList.toggle('active', state.pinned);
    pin.setAttribute('aria-pressed', state.pinned ? 'true' : 'false');
    pin.setAttribute('aria-label', state.pinned ? 'Unpin Assistant' : 'Pin Assistant');
    pin.title = state.pinned ? 'Unpin Assistant' : 'Pin Assistant';
  }

  function setPinned(pinned) {
    state.pinned = !!pinned;
    syncPinnedUi();
  }

  function setOpen(open, modeId) {
    if (modeId) setMode(modeId);
    state.open = !!open;
    if (!state.open && state.pinned) {
      state.pinned = false;
    }
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
    syncPinnedUi();

    if (state.open) {
      syncModeUi();
      (state.modelsLoaded ? Promise.resolve() : loadModels()).then(function () {
        if (state.activeMode === 'storyboard') maybeOpenNewStudioConversation();
        var input = el('director-chat-input');
        if (input) input.focus();
      });
    }
  }

  function bind() {
    var toggle = el('director-chat-rail-btn');
    var drawer = el('director-chat-drawer');
    var pin = el('director-chat-pin');
    var close = el('director-chat-close');
    var clear = el('director-chat-clear');
    var send = el('director-chat-send');
    var stop = el('director-chat-stop');
    var copy = el('director-chat-prompt-copy');
    var input = el('director-chat-input');
    var model = el('director-chat-model');
    var refresh = el('director-chat-model-refresh');
    var modeSwitch = el('director-chat-mode-switch');
    var presetsHost = el('director-chat-mode-presets');
    if (!toggle || !drawer || !pin || !close || !clear || !send || !stop || !copy || !input || !model || !refresh || !modeSwitch || !presetsHost) return;

    toggle.onclick = function () {
      if (state.open && state.activeMode === 'chat') setOpen(false);
      else setOpen(true, 'chat');
    };
    pin.onclick = function () { setPinned(!state.pinned); };
    close.onclick = function () { setOpen(false); };
    clear.onclick = newChat;
    el('director-studio-retry').onclick = startStudioWorkshop;
    el('director-studio-capture').onclick = captureStudioCreativeBrief;
    el('director-studio-attach-current').onclick = grantStudioStoryAccess;
    el('director-studio-access-clear').onclick = clearStudioStoryAccess;
    el('director-studio-access-read').onclick = inspectStudioStoryScope;
    el('director-studio-access-field').onchange = function () {
      el('director-studio-access-scene').classList.toggle('hidden', ['scene', 'prompt', 'takes'].indexOf(this.value) < 0);
    };
    el('director-studio-access-details').ontoggle = function () {
      if (this.open && state.studioStoryAccess && !state.studioAccessIndex) loadStudioAccessIndex();
    };
    el('director-studio-prepare-scene').onclick = prepareStudioSceneDraft;
    el('director-studio-prepare-project').onclick = prepareStudioProject;
    el('director-studio-prepare-scenes').onclick = prepareStudioScenes;
    el('director-studio-propose-brief').onclick = prepareStudioBrief;
    el('director-studio-undo-brief').onclick = undoStudioBrief;
    el('studio-brief-close').onclick = function () { el('studio-brief-review').close(); };
    el('studio-brief-discard').onclick = function () { el('studio-brief-review').close(); };
    el('studio-brief-apply').onclick = applyStudioBrief;
    el('studio-brief-add-invariant').onclick = function () {
      addStudioProjectInvariant(null, 'studio-brief-invariants');
      el('studio-brief-invariants-selected').checked = true;
    };
    el('studio-scenes-close').onclick = function () { el('studio-scenes-review').close(); };
    el('studio-scenes-discard').onclick = function () { el('studio-scenes-review').close(); };
    el('studio-scenes-apply').onclick = applyStudioScenes;
    el('studio-scenes-add').onclick = function () {
      if (el('studio-scenes-rows').children.length >= 8) {
        el('studio-scenes-error').textContent = 'Review up to eight Scenes at a time.';
        return;
      }
      addStudioScenesRow({ title: '', summary: '' });
    };
    el('studio-project-close').onclick = function () { el('studio-project-review').close(); };
    el('studio-project-discard').onclick = function () { el('studio-project-review').close(); };
    el('studio-project-create').onclick = applyStudioProject;
    el('studio-project-add-invariant').onclick = function () { addStudioProjectInvariant(); };
    el('studio-project-include-scene').onchange = function () {
      el('studio-project-first-scene-fields').classList.toggle('hidden', !this.checked);
    };
    el('studio-scene-draft-discard').onclick = function () { el('studio-scene-draft-review').close(); };
    el('studio-scene-draft-close').onclick = function () { el('studio-scene-draft-review').close(); };
    el('studio-scene-draft-apply').onclick = applyStudioSceneDraft;
    el('director-studio-starters').onclick = function (event) {
      var button = event.target.closest('[data-studio-starter]');
      if (!button || state.pending || state.activeMode !== 'storyboard') return;
      var ideas = {
        hook: "What makes this idea worth watching? Help me find the core appeal.",
        scene: "Let's sketch one achievable Scene from what we've discussed. Don't create it yet; let's decide what really happens.",
        feasibility: "Challenge this idea against MiniMax H3's practical strengths and weaknesses. What's the simplest renderable version?"
      };
      var suggestion = ideas[button.dataset.studioStarter];
      if (!suggestion) throw new Error('Unknown Studio Director conversation starter.');
      var editor = el('director-chat-input');
      editor.value = suggestion;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.focus();
    };
    el('director-chat-history-toggle').onclick = function () {
      var button = el('director-chat-history-toggle');
      button.setAttribute('aria-expanded', button.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
      renderSessionHistory();
    };
    send.onclick = sendMessage;
    stop.onclick = stopJob;
    copy.onclick = function () {
      openDirectorRequestInspector(state.requestDiagnostic, 'Director Chat Request');
    };
    var contextToggle = el('director-chat-attachments-toggle');
    contextToggle.onclick = function () {
      var expanded = contextToggle.getAttribute('aria-expanded') === 'true';
      contextToggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      renderStoryboardAttachmentViewer();
    };
    el('director-chat-attachments-copy-all').onclick = function () {
      copyStoryboardAttachment(storyboardAttachmentCopyAll(), 'all attached references');
    };
    el('director-chat-story-prepare').onclick = function () {
      try { prepareStoryChanges(); }
      catch (error) {
        el('director-chat-workshop-status').textContent = String(error.message || error);
        if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Storyboard Story proposal', error);
        else throw error;
      }
    };
    el('director-chat-workshop-prepare').onclick = function () {
      try { prepareWorkshopRevision(); }
      catch (error) {
        el('director-chat-workshop-status').textContent = String(error.message || error);
        if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Scene Workshop', error);
        else throw error;
      }
    };
    el('storyboard-workshop-review-back').onclick = function () { el('storyboard-workshop-review').close(); };
    el('storyboard-workshop-review-close').onclick = function () { el('storyboard-workshop-review').close(); };
    el('storyboard-workshop-review-apply').onclick = function () {
      try { applyWorkshopRevision(); }
      catch (error) {
        if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Scene Workshop Apply', error);
        else throw error;
      }
    };
    modeSwitch.onclick = function (event) {
      var button = event.target.closest('[data-assistant-mode]');
      if (button) setMode(button.dataset.assistantMode);
    };
    presetsHost.onclick = function (event) {
      var button = event.target.closest('[data-assistant-preset]');
      if (!button) return;
      if (state.activeMode === 'storyboard') {
        if (state.pending || state.attachmentPending) return;
        var preset = storyboardContextPresets()[Number(button.dataset.assistantPreset)];
        if (!preset) throw new Error('Unknown Storyboard context selection.');
        if (preset.exitWorkshop) {
          state.workshop = null;
          state.workshopProposal = null;
          state.storyGuidelineProposal = null;
          // Exiting a Workshop must never destroy the conversation.
          scheduleSessionSave();
          el('director-chat-workshop-status').textContent = '';
          syncModeUi();
        } else if (preset.section) {
          var key = 'section:' + preset.section;
          if (state.storyboardAttachments[key]) delete state.storyboardAttachments[key];
          else state.storyboardAttachments[key] = {
            label: preset.section,
            content: state.workshop.extraSections[preset.section]
          };
          state.workshopProposal = null;
          scheduleSessionSave();
          syncModeUi();
        } else if (preset.clearContext) {
          state.storyGuidelineProposal = null;
          state.storyboardAttachments = {};
          scheduleSessionSave();
          syncModeUi();
        } else {
          attachStoryboardContext(preset.contextKind);
        }
        return;
      }
      var mode = activeContextMode();
      if (!mode || !Array.isArray(mode.presets)) return;
      var preset = mode.presets[Number(button.dataset.assistantPreset)];
      if (!preset) return;
      input.value = String(preset.instruction || '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    };
    refresh.onclick = function () {
      refresh.disabled = true;
      loadModels().then(function () {
        refresh.disabled = state.pending;
      });
    };
    model.onchange = function () {
      state.modelId = String(model.value || '');
      setDirectorModelPreference('webcap.directorChat.model', state.modelId);
      syncControls();
    };
    window.addEventListener('webcap:director-model-changed', function (event) {
      var selected = String(event && event.detail && event.detail.modelId || '');
      if (!selected || selected === state.modelId) return;
      state.modelId = selected;
      if (Array.prototype.some.call(model.options, function (option) { return option.value === selected; })) model.value = selected;
      syncControls();
    });
    input.addEventListener('input', function () {
      if (!applyingHistoryValue) {
        inputHistoryIndex = inputHistory.length;
        inputHistoryDraft = input.value;
      }
      if (persistentMode(state.activeMode) && state.sessionReady) {
        state.draftByMode[state.activeMode] = input.value;
        scheduleSessionSave();
      }
      syncControls();
    });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        var start = Number(input.selectionStart || 0);
        var end = Number(input.selectionEnd || 0);
        var onFirstLine = input.value.lastIndexOf('\n', Math.max(0, start - 1)) === -1;
        var onLastLine = input.value.indexOf('\n', end) === -1;
        var direction = event.key === 'ArrowUp' ? -1 : 1;

        if ((direction < 0 && onFirstLine) || (direction > 0 && onLastLine)) {
          if (inputHistory.length) {
            if (direction < 0) {
              if (inputHistoryIndex === inputHistory.length) inputHistoryDraft = input.value;
              if (inputHistoryIndex > 0) inputHistoryIndex -= 1;
            } else if (inputHistoryIndex < inputHistory.length) {
              inputHistoryIndex += 1;
            }

            if (inputHistoryIndex >= 0 && inputHistoryIndex <= inputHistory.length) {
              event.preventDefault();
              applyingHistoryValue = true;
              input.value = inputHistoryIndex === inputHistory.length
                ? inputHistoryDraft
                : inputHistory[inputHistoryIndex];
              input.dispatchEvent(new Event('input', { bubbles: true }));
              applyingHistoryValue = false;
              input.setSelectionRange(input.value.length, input.value.length);
            }
          }
          return;
        }
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });
    document.addEventListener('pointerdown', function (event) {
      if (!state.open || state.pinned || el('storyboard-workshop-review').open ||
          el('storyboard-guidelines-review').open || el('studio-scene-draft-review').open ||
          drawer.contains(event.target) || toggle.contains(event.target)) return;
      setOpen(false);
    });
    window.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && state.open && !el('storyboard-workshop-review').open &&
          !el('storyboard-guidelines-review').open && !el('studio-scene-draft-review').open) setOpen(false);
    });

    window.addEventListener('beforeunload', function (event) {
      if (state.sessionTimer || state.sessionSaving || state.sessionDirty.chat ||
          state.sessionDirty.storyboard || state.sessionError) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    loadSessionHistory();
    if (state.pinned) setOpen(true);
    else {
      syncPinnedUi();
      syncModeUi();
    }
  }

  window.syncStoryboardAssistantStory = function () {
    // Story navigation has no authority to mutate Assistant conversations or
    // their explicitly attached reference snapshots.
  };
  window.openStoryboardAssistant = function () { setOpen(true, 'storyboard'); };
  window.closeStudioDirectorOnExit = function () {
    if (state.open && state.activeMode === 'storyboard') setOpen(false);
  };
  window.openStoryboardSceneWorkshop = function (context) {
    if (state.pending) throw new Error('Finish the current Assistant job before switching Workshop Scenes.');
    if (!context || !context.storyId || !context.sceneId || typeof context.expectedPrompt !== 'string') {
      throw new Error('Scene Workshop requires a complete saved Scene snapshot.');
    }
    var old = state.workshop;
    if (!old || old.storyId !== context.storyId || old.sceneId !== context.sceneId || old.expectedPrompt !== context.expectedPrompt) {
      // Opening another Workshop changes the current working excerpt but does
      // not delete the conversation or its previously attached references.
      state.workshopProposal = null;
      state.storyGuidelineProposal = null;
      el('director-chat-workshop-status').textContent = '';
    }
    state.workshop = context;
    el('director-chat-workshop-status').textContent = context.shotError ? ('Automatic shot revisions unavailable: ' + context.shotError) : '';
    setOpen(true, 'storyboard');
    scheduleSessionSave();
  };
  window.registerAssistantMode = registerContextMode;
  window.refreshAssistantModes = syncModeUi;
  window.openAssistant = function (target) {
    target = target && typeof target === 'object' ? target : {};
    setOpen(true, target.mode || 'chat');
  };
  window.setDirectorChatOpen = setOpen;
  window.openDirectorChatActivity = function (target) {
    if (target && target.modelId) state.modelId = String(target.modelId);
    if (target && target.jobId) state.jobId = String(target.jobId);
    setOpen(true);
  };
  bind();
})();
