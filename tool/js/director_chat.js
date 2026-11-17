(function () {
  var state = {
    open: false,
    pinned: false,
    pending: false,
    modelsLoaded: false,
    modelId: getDirectorModelPreference('webcap.directorChat.model'),
    activeMode: 'chat',
    // Same Assistant state owns the last surface selected inside Studio.
    lastStudioMode: 'chat',
    messages: [],
    storyboardAttachments: {},
    studioStoryAccess: null,
    studioAccessIndex: null,
    attachmentPending: false,
    workshop: null,
    workshopProposal: null,
    modeMessages: {},
    modeContextKeys: {},
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
    studioOperations: [],
    pendingReadAck: null,
    sceneRead: null,
    studioApprovedRead: null
  };
  var STORYBOARD_WORKSHOP_PRIMER = [
    'You are collaborating with an author developing short AI-generated videos.',
    'A Project (internally Story) has Concept / overview, Visual / atmosphere and Invariants. A Scene uses its complete H3 Prompt as creative content.',
    'Use Concept for premise and Scene relationships, Visual / atmosphere for the shared look, and Invariants for recurring fixed facts. Treat the saved H3 Prompt as the complete creative content for that Scene, including its Scene Overview when present. Author a complete usable H3 Prompt when writing a new Scene.',
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

  // Navigation is authoritative in Scene focus; a Scene toolbar entry also
  // binds its Scene when the Storyboard is in the overview/list view.
  function studioDirectorSelectedScene(navigation, authorRequest, explicitProject) {
    navigation = navigation || window.getStudioDirectorNavigation();
    if (!navigation.projectId) return null;
    // A contextual Scene entry is an explicit UI target even when a different
    // Project remains attached to the conversation. It grants no unrelated Read.
    var entry = state.sceneRead;
    if (entry && entry.projectId === navigation.projectId && entry.sceneId) return {
      projectId: entry.projectId, sceneId: entry.sceneId,
      sceneNumber:entry.sceneNumber, label: entry.label
    };
    if (!explicitProject && state.studioStoryAccess &&
        state.studioStoryAccess.storyId !== navigation.projectId) return null;
    // Passive Scene navigation may suggest a target in the attached Project;
    // neither navigation nor mentions in prose authorize another Project.
    if (navigation.sceneId) return {
      projectId: navigation.projectId, sceneId: navigation.sceneId,
      sceneNumber:navigation.sceneNumber,
      label: navigation.sceneNumber > 0 ? 'Scene ' + navigation.sceneNumber : 'Selected Scene'
    };
    return null;
  }

  var studioComposerMode = 'conversation';
  var studioRevisionRunning = false;
  function studioRevisionActive() {
    return state.activeMode === 'storyboard' && studioComposerMode === 'revision';
  }
  function syncStudioRevisionUi() {
    var studio = state.activeMode === 'storyboard';
    var revision = studioRevisionActive();
    var mode = el('director-studio-composer-mode');
    var drawer = el('director-chat-drawer');
    drawer.classList.toggle('studio-revision-mode', revision);
    if (revision) {
      drawer.classList.remove('studio-actions-open');
      el('studio-dw-open-tools').setAttribute('aria-expanded','false');
      el('director-chat-title').textContent = 'Revise Scenes';
    }
    el('director-chat-history-toggle').classList.toggle('hidden', revision);
    el('director-chat-clear').classList.toggle('hidden', revision);
    el('studio-dw-open-tools').classList.toggle('hidden', revision);
    mode.classList.toggle('hidden', !studio);
    el('director-studio-composer-mode-select').value = studioComposerMode;
    el('director-studio-revision-controls').classList.toggle('hidden', !revision);
    el('director-chat-input').classList.toggle('hidden', revision);
    el('director-chat-scene-context').classList.toggle('hidden', revision ||
      !state.studioApprovedRead);
    el('studio-director-inspect').classList.toggle('hidden', revision || !studio);
    var preset = el('director-studio-revision-preset').value;
    el('director-studio-revision-fresh-label').classList.toggle('hidden', !revision || preset === 'coherence');
    var input = el('director-studio-revision-input');
    input.readOnly = preset === 'coherence';
    el('director-chat-composer-hint').textContent = revision
      ? 'Ctrl+Enter to run' : 'Enter to send · Shift+Enter for newline';
    var target = el('director-studio-revision-target');
    target.classList.toggle('hidden', !revision);
    if (revision) {
      var scope = window.getStudioDirectorNavigation();
      target.textContent = (scope.projectTitle || 'Current Project') +
      ' · all ' + (scope.sceneOrder || []).length + ' Scenes';
    }
  }
  function setStudioComposerMode(mode, preset) {
    studioComposerMode = mode === 'revision' ? 'revision' : 'conversation';
    if (preset !== undefined) {
      var chooser = el('director-studio-revision-preset');
      chooser.value = preset;
      chooser.dispatchEvent(new Event('change'));
    }
    syncStudioRevisionUi();
    syncControls();
    (studioRevisionActive() ? el('director-studio-revision-input') : el('director-chat-input')).focus();
  }
  function runStudioRevision() {
    if (!studioRevisionActive() || studioRevisionRunning) return;
    var preset = el('director-studio-revision-preset').value;
    var input = el('director-studio-revision-input');
    var instruction = input.value.trim();
    var status = el('director-studio-revision-status');
    if (!instruction && preset !== 'coherence') {
      status.textContent = 'Enter a revision instruction or choose a preset.';
      input.focus();
      return;
    }
    var scope = window.getStudioDirectorNavigation();
    if (!scope.projectId || !(scope.sceneOrder || []).length) {
      status.textContent = 'Choose a Project with Scenes first.';
      return;
    }
    studioRevisionRunning = true;
    status.textContent = 'Starting ' + (preset === 'coherence' ? 'coherence review' : 'revision') + '…';
    syncControls();
    Promise.resolve(window.startStudioRevision({
      instruction:instruction,preset:preset,modelId:state.modelId,
      projectId:scope.projectId,
      generateFreshTakes:el('director-studio-revision-fresh').checked
    })).then(function () {
      status.textContent = preset === 'coherence'
        ? 'Coherence review completed.' : 'Scene revision completed.';
      if (studioRevisionActive()) {
        setOpen(false);
        studioComposerMode = 'conversation';
      }
    }).catch(function (error) {
      status.textContent = 'Revision: ' + String(error.message || error);
      window.reportConsoleError('Studio revision', error);
    }).finally(function () {
      studioRevisionRunning = false;
      syncControls();
    });
  }
  function syncModeUi() {
    var sceneContext = el('director-chat-scene-context');
    var approved = state.activeMode === 'storyboard' ? state.studioApprovedRead : null;
    sceneContext.classList.toggle('hidden', !approved);
    if (approved) {
      sceneContext.textContent = 'Approved context · ' + approved.label;
      sceneContext.title = 'Saved values for this approved selection refresh with each Director message. Change selection in Context.';
    }
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
    var contextButton = el('director-chat-context-approve');
    contextButton.classList.toggle('hidden', !studio || studioRevisionActive());
    contextButton.textContent = state.studioApprovedRead ? 'Context ✓' : 'Share Details…';
    var contextual = !persistentMode(state.activeMode);
    var context = active && typeof active.contextSnapshot === 'function'
      ? active.contextSnapshot() : null;
    var panel = el('director-chat-context-panel');
    panel.classList.toggle('hidden', !context);
    if (context) {
      el('director-chat-context-heading').textContent = 'Attached context · ' + context.title;
      el('director-chat-context-summary').textContent = context.summary;
      el('director-chat-context-body').textContent = context.prompt;
      var refreshContext = el('director-chat-context-refresh');
      refreshContext.classList.toggle('hidden', !context.hasUpdate);
      refreshContext.disabled = state.pending;
      el('director-chat-context-status').textContent = context.hasUpdate
        ? 'Updated evidence detected. Keep discussing this snapshot or start a new chat with the updated context.'
        : 'Snapshot only · changes to the Set are not included until you reopen Ask QA.';
    }
    el('director-chat-temporary-note').classList.toggle('hidden', !contextual);
    el('director-chat-history-toggle').classList.toggle('hidden', contextual);
    el('director-chat-save-status').classList.toggle('hidden', contextual);
    if (contextual) {
      el('director-chat-history-toggle').setAttribute('aria-expanded', 'false');
      if (el('director-chat-history-panel').open) el('director-chat-history-panel').close();
    }
    var newConversationLabel = context ? 'New QA chat' : studio ? 'New conversation' : 'New chat';
    el('director-chat-clear').querySelector('.director-header-button-label').textContent = newConversationLabel;
    el('director-chat-clear').setAttribute('aria-label', newConversationLabel);
    el('director-chat-clear').title = newConversationLabel;
    var drawer = el('director-chat-drawer');
    drawer.classList.toggle('studio-director', studio);
    el('app-frame').classList.toggle('studio-director-active', studio && state.open);
    drawer.setAttribute('aria-label', studio ? 'Projects Director' : 'Assistant');
    el('director-chat-title').textContent = studio ? studioWorkingStoryLabel() :
      (context ? 'Ask QA' : 'Assistant');
    el('director-chat-close').textContent = '×';
    el('director-chat-close').setAttribute('aria-label', studio ? 'Close Director' : 'Close Assistant');
    el('director-chat-empty-title').textContent = studio ? "Let's make something" :
      (context ? 'Discuss this recommendation' : 'Your conversation');
    el('director-chat-empty-description').textContent = studio
      ? 'Start with an idea or question. Approve saved Project details in Context when useful.'
      : (context ? 'Ask why this recommendation matters, challenge its evidence, or discuss a better correction.'
        : 'Start a conversation with the selected model.');
    el('director-studio-retry').classList.add('hidden');
    if (row) row.classList.toggle('hidden', studio || !modes.length);
    if (host) {
      host.innerHTML = '<button type="button" class="review-captions-btn' + (state.activeMode === 'chat' ? ' active' : '') + '" data-assistant-mode="chat">Chat</button>' +
        modes.map(function (mode) {
          return '<button type="button" class="review-captions-btn' + (state.activeMode === mode.id ? ' active' : '') +
            '" data-assistant-mode="' + mode.id + '">' + mode.label + '</button>';
        }).join('');
    }

    if (description) {
      description.textContent = studio
        ? (state.attachmentPending ? 'Connecting Project…'
          : (state.workshop ? 'Scene · ' + state.workshop.sceneTitle : ''))
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
    renderStoryboardAttachmentViewer();
    renderStudioStoryAccess();
    renderStudioOperations();
    if (studio) window.studioDirectorWorkbench.updateWorkingWrite();
    syncStudioRevisionUi();
    renderMessages();
    syncControls();
  }

  function studioWorkspaceVisible() {
    return !!document.querySelector('#storyboard-workspace:not(.hidden)');
  }

  function setMode(modeId) {
    modeId = String(modeId || 'chat');
    // Studio Director is not a global Assistant mode. Navigation cannot
    // expose a stale Studio conversation in the ordinary Assistant drawer.
    if (modeId === 'storyboard' && !studioWorkspaceVisible()) modeId = 'chat';
    if (modeId !== 'chat' && modeId !== 'storyboard') {
      var mode = contextualModes[modeId];
      if (!mode || !modeAvailable(mode)) modeId = 'chat';
    }
    if (state.pending) return;
    if (studioWorkspaceVisible() && (modeId === 'chat' || modeId === 'storyboard'))
      state.lastStudioMode = modeId;
    if (state.activeMode === modeId) return;
    var input = el('director-chat-input');
    state.draftByMode[state.activeMode] = input.value;
    if (persistentMode(state.activeMode) && state.sessionReady && state.sessionDirty[state.activeMode]) {
      flushSessionSave().catch(showSessionFailure);
    }
    state.activeMode = modeId;
    input.value = state.draftByMode[modeId] || '';
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
          var message = payload && payload.error ? payload.error : (response.statusText || 'Request failed');
          if (url === '/fs/director/chat' && /Unsupported Director Chat operation/i.test(message)) {
            message += ' The running WebCap backend does not recognize the requested chat operation. ' +
              'Restart or update the backend so it matches the current Studio Director frontend (studio_chat is supported in the current server code).';
          }
          throw new Error(message);
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

  function conversationTitle(messages) {
    for (var message of messages) {
      if (message.role !== 'user' || message.content.includes('[WEBCAP APPLIED FIELD VALUES]')) continue;
      var text = message.content.split('[WEBCAP EXPLICIT READ]')[0].trim();
      if (!text || text === 'Read the selected saved context and acknowledge receipt.') continue;
      return text.replace(/\s+/g, ' ').slice(0,72);
    }
    return 'New chat';
  }

  function historyDisplayTitle(chat) {
    // Older auto-titles captured the protocol instead of the author's subject.
    // Keep stored titles intact, including deliberate renames.
    if (/^Read the selected saved context and acknowledge receipt\./.test(chat.title))
      return chat.projectTitle ? chat.projectTitle + ' · context' : 'Project context';
    if (chat.title === 'New chat') return 'New conversation';
    return chat.title;
  }

  function upsertSessionSummary(chat) {
    var summary = {
      id: chat.id, mode: chat.mode, title: chat.title,
      projectTitle: chat.storyAccess ? chat.storyAccess.label : '',
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
    list.replaceChildren();
    if (!state.sessionList.length) {
      var empty = document.createElement('p');
      empty.textContent = 'No saved conversations yet.';
      list.appendChild(empty);
    }
    var filter = (el('director-chat-history-search').value || '').toLowerCase().trim();
    var matches = state.sessionList.filter(function (chat) {
      return !filter || [historyDisplayTitle(chat), chat.projectTitle, chat.mode].join(' ').toLowerCase().includes(filter);
    });
    matches.forEach(function (chat) {
      var item = document.createElement('div');
      item.className = 'director-chat-history-item';
      if (state.sessionByMode[state.activeMode] &&
          state.sessionByMode[state.activeMode].id === chat.id) item.classList.add('is-current');

      var open = document.createElement('button');
      open.type = 'button';
      open.className = 'review-captions-btn';
      var title = document.createElement('strong');
      title.textContent = historyDisplayTitle(chat);
      var meta = document.createElement('span');
      meta.className = 'director-chat-history-meta';
      meta.textContent = [chat.projectTitle || (chat.mode === 'storyboard' ? 'Projects' : 'Chat'),
        new Date(chat.updatedAt).toLocaleString()].join(' · ');
      open.append(title,meta);
      open.title = historyDisplayTitle(chat);
      open.onclick = function () { selectSession(chat.id); };
      item.appendChild(open);

      var rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'review-captions-btn director-chat-history-secondary';
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
      var menu = document.createElement('details');
      menu.className = 'director-chat-history-menu';
      var summary = document.createElement('summary');
      summary.textContent = 'More';
      summary.setAttribute('aria-label', 'Conversation actions for ' + historyDisplayTitle(chat));
      menu.appendChild(summary);
      menu.appendChild(rename);

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'review-captions-btn director-chat-history-secondary';
      remove.textContent = 'Delete';
      remove.title = 'Permanently delete this saved conversation';
      remove.onclick = function () { deleteSession(chat.id); };
      menu.appendChild(remove);
      item.appendChild(menu);
      list.appendChild(item);
    });
    if (!matches.length && state.sessionList.length) {
      var noMatches = document.createElement('p');
      noMatches.textContent = 'No matching conversations.';
      list.appendChild(noMatches);
    }
  }

  function showSessionFailure(error) {
    showSessionStatus('Save failed: ' + String(error.message || error), error);
    syncControls();
  }

  function persistSession(mode) {
    if (!persistentMode(mode)) return Promise.resolve();
    if (!state.sessionReady) return Promise.reject(new Error('Assistant conversation history has not loaded.'));
    var messages = (mode === 'chat' ? state.messages : state.modeMessages.storyboard || []).map(function (message) {
      var stored = { role: message.role, content: message.content };
      if (mode === 'storyboard' && message.role === 'assistant' && message.rawResponse)
        stored.rawResponse = message.rawResponse;
      if (mode === 'storyboard' && message.role === 'assistant' && message.writeAction)
        stored.writeAction = message.writeAction;
      if (mode === 'storyboard' && message.role === 'assistant' &&
          Array.isArray(message.otherWriteActions) && message.otherWriteActions.length)
        stored.otherWriteActions = message.otherWriteActions;
      return stored;
    });
    var draft = state.draftByMode[mode] || '';
    var attachments = mode === 'storyboard' ? JSON.parse(JSON.stringify(state.storyboardAttachments)) : {};
    var workshop = mode === 'storyboard' ? JSON.parse(JSON.stringify(state.workshop)) : null;
    var operations = mode === 'storyboard' ? state.studioOperations.slice() : [];
    var storyAccess = mode === 'storyboard' ? state.studioStoryAccess : null;
    var readiness = null;
    var workingDraft = null;
    var title = state.sessionByMode[mode] ? state.sessionByMode[mode].title : 'New chat';
    if (title === 'New chat') {
      title = conversationTitle(messages);
    }
    state.sessionDirty[mode] = false;
    showSessionStatus('Saving conversation…', false);
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
            operations: operations, storyAccess: storyAccess, readiness: readiness, workingDraft: workingDraft
          })
        });
      }).then(function (payload) {
        state.sessionByMode[mode] = payload.chat;
        upsertSessionSummary(payload.chat);
        if (!state.sessionDirty[mode]) showSessionStatus('Conversation saved', false);
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
    showSessionStatus('Conversation unsaved', false);
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
    state.sceneRead = null;
    state.studioApprovedRead = null;
    if (!chat || !persistentMode(chat.mode) || !Array.isArray(chat.messages)) {
      throw new Error('Saved Assistant conversation is invalid.');
    }
    state.sessionByMode[chat.mode] = chat;
    state.sessionActiveByMode[chat.mode] = chat.id;
    state.requestDiagnostic = null;
    state.lastStudioIoError = '';
    state.lastStudioIoRaw = '';
    el('studio-director-inspect').dataset.newResult = 'false';
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
      if (window.studioDirectorWorkbench) {
        window.studioDirectorWorkbench.resetConversation();
      }
      state.studioProjectProposal = null;
      state.studioScenesReviewsByResponse = {};
      state.workshopProposal = null;
    }
    state.draftByMode[chat.mode] = chat.draft || '';
    state.sessionDirty[chat.mode] = false;
    if (state.activeMode === chat.mode) {
      el('director-chat-input').value = state.draftByMode[chat.mode];
      syncModeUi();
    }
    upsertSessionSummary(chat);
    showSessionStatus('Conversation saved', false);
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
      if (studioWorkspaceVisible() && (result.chat.mode === 'chat' || result.chat.mode === 'storyboard'))
        state.lastStudioMode = result.chat.mode;
      restoreSession(result.chat);
      if (el('director-chat-history-panel').open) el('director-chat-history-panel').close();
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
      showSessionStatus('Conversation saved', false);
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
      showSessionStatus('Conversation deleted', false);
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

  function studioReplyText(content) {
    return String(content || '').replace(/^\s*RECEIVED:\s*(?:project\.\w+|scene:[\w-]+:\w+)(?:[ \t]*,[ \t]*(?:project\.\w+|scene:[\w-]+:\w+))*[ \t]*[.;]?[ \t]*(?:\r?\n)?/i, '').trim();
  }

  // Project fields, edits to a selected Scene, and new Scene records are
  // independent creative deliverables, even when one model turn returns all
  // of them. UI targeting and saving remain explicit WebCap operations.
  function renderMessages() {
    var host = el('director-chat-messages');
    var empty = el('director-chat-empty');
    if (!host || !empty) return;

    host.innerHTML = '';
    empty.classList.toggle('hidden', currentMessages().length > 0);

    currentMessages().forEach(function (message, index) {
      var studioReply = state.activeMode === 'storyboard' && message.role === 'assistant';
      var previous = currentMessages()[index-1];
      var readReceipt = studioReply && previous && previous.role === 'user' &&
        previous.content.includes('[WEBCAP EXPLICIT READ]');
      var visibleText = studioReply ? studioReplyText(message.content) : message.content;
      // Older saved conversations may contain the raw structured JSON as the
      // visible chat message. Re-render that material as a factual draft
      // summary without rewriting history or losing the original response.
      if (studioReply && message.rawResponse &&
          String(message.content || '').trim() === String(message.rawResponse).trim()) {
        visibleText = studioReplyText(parseStudioChatResponse(message.rawResponse).reply);
      }
      if (studioReply && !visibleText.trim() && !readReceipt)
        return;
      var row = document.createElement('div');
      row.className = 'director-chat-message director-chat-message-' + message.role;

      var label = document.createElement('div');
      label.className = 'director-chat-message-label';
      label.textContent = message.role === 'assistant' ? 'Director' :
        (message.content.indexOf('[WEBCAP APPLIED FIELD VALUES]') !== -1
          ? (message.content.startsWith('Director revision saved:') ? 'WebCap · Director revision' : 'WebCap · Reviewed Apply') :
         message.content.indexOf('[WEBCAP EXPLICIT READ]') !== -1 ? 'You · Read to Director' : 'You');

      var body = document.createElement('div');
      body.className = 'director-chat-message-body';
      body.textContent = visibleText;
      if (studioReply && visibleText.length > 1200) {
        var preview = document.createElement('div');
        preview.className = 'director-chat-reply-preview';
        var opening = visibleText.split(/\n\s*\n/)[0];
        preview.textContent = opening.length > 480 ? opening.slice(0,480).replace(/\s+\S*$/, '') + '…' : opening;
        var fullReply = document.createElement('details'), fullHeading = document.createElement('summary'),
          fullText = document.createElement('div');
        fullReply.className = 'director-chat-long-reply';
        fullHeading.textContent = 'Full Director reply';
        fullText.textContent = visibleText;
        fullReply.append(fullHeading,fullText);
        body.replaceChildren(preview,fullReply);
      }
      if (message.role === 'user' && message.content.indexOf('[WEBCAP APPLIED FIELD VALUES]') !== -1) {
        row.classList.add('director-chat-save-receipt');
        label.textContent = '✓ Saved';
      }
      if (message.role === 'user' && (message.content.indexOf('[WEBCAP EXPLICIT READ]') !== -1 ||
          message.content.indexOf('[WEBCAP APPLIED FIELD VALUES]') !== -1)) {
        var applied = message.content.indexOf('[WEBCAP APPLIED FIELD VALUES]') !== -1;
        var startMark = applied ? '[WEBCAP APPLIED FIELD VALUES]' : '[WEBCAP EXPLICIT READ]';
        var endMark = applied ? '[END WEBCAP APPLY]' : '[END WEBCAP READ]';
        var marker = message.content.indexOf(startMark);
        var closing = message.content.indexOf(endMark, marker);
        if (closing !== -1) {
          // Preserve the original payload in session history, not the creative chat.
          var description = message.content.slice(0, marker).trim();
          body.textContent = description === 'Read the selected saved context and acknowledge receipt.'
            ? 'Read saved Project fields'
            : (description || (applied ? 'Reviewed changes saved' : 'Read saved Project fields'));
        }
      }

      row.appendChild(label);
      if (readReceipt) {
        var receipt = document.createElement('span');
        receipt.className = 'director-chat-context-receipt';
        receipt.textContent = '✓ Context supplied';
        receipt.title = 'Saved Project material supplied with this request. Full response is available in I/O.';
        row.appendChild(receipt);
      }
      if (body.textContent || body.children.length) row.appendChild(body);
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
      sceneIds: (sceneIds || []).slice(0, 32), at: new Date().toISOString()
    });
    state.studioOperations = state.studioOperations.slice(-25);
    if (state.studioStoryAccess && state.studioStoryAccess.storyId === String(storyId || '')) {
      state.studioAccessIndex = null;
      el('director-studio-access-data').classList.add('hidden');
      el('director-studio-access-status').textContent = 'Project changed. Inspect fields again for current values.';
    }
    renderStudioOperations();
  }

  function renderStudioStoryAccess() {
    var access = state.studioStoryAccess;
    var visible = state.activeMode === 'storyboard' && !!access;
    el('director-studio-access').classList.toggle('hidden', !visible);
    if (visible) el('director-studio-access-summary').textContent = 'Project access · ' + access.label;
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
      studioActionStatus('Project access failed: ' + String(error.message || error), true);
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
    // Disconnect revokes all active context, including legacy snapshots that
    // could otherwise keep supplying Story data after the grant is removed.
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
      return Promise.reject(new Error('Connect a Project in this Studio conversation first.'));
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
      throw error;
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
      if (result.storyId !== storyId) throw new Error('Project changed while reading fields.');
      var output = el('director-studio-access-data');
      output.textContent = JSON.stringify(result.data, null, 2);
      output.classList.remove('hidden');
      // Explicit Read delivers selected saved fields; no silent auto-attachment.
      if (state.pending || !state.modelId) throw new Error('Select a Director model before sending Read.');
      var source = {projectId: result.storyId, sceneId: result.sceneId || null,
        field: result.field, savedAt: result.storyUpdatedAt, content: result.data};
      var composer = el('director-chat-input');
      var instruction = String(composer.value || '').trim();
      if (!instruction) instruction = 'Acknowledge the saved context without assessing it or suggesting next steps.';
      composer.value = '[WEBCAP EXPLICIT PROJECT READ — SAVED FIELD VALUES]\n' +
        JSON.stringify(source, null, 2) + '\n[END WEBCAP READ]\n\n' +
        'Acknowledge receipt in your own words, naming the Project and fields actually present. ' +
        'Then ' + instruction;
      el('director-studio-access-status').textContent = 'Read sent to Director. Awaiting the model acknowledgment…';
      sendMessage();
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
    title.textContent = 'Working with: ' + studioWorkingStoryLabel();
    description.textContent = 'Concept / overview · Visual / atmosphere · Invariants';
    capture.textContent = attached ? 'Write attached Project Overview · Save' : 'Create Project · Save';
    capture.disabled = state.pending || state.attachmentPending || !state.sessionReady || !state.modelId || !discussed;
    var useOpen = el('director-studio-flow-target');
    var canAttachOpen = !!openId && openId !== attached;
    useOpen.classList.toggle('hidden', !canAttachOpen);
    if (canAttachOpen) {
      el('director-studio-flow-target-label').textContent = attached
        ? 'A different Project is open in Studio.'
        : 'Already have a Project open?';
      el('director-studio-attach-current').disabled = state.pending || state.attachmentPending;
    }
  }

  function captureStudioCreativeBrief() {
    if (state.pending || state.attachmentPending || state.activeMode !== 'storyboard') return;
    // The existing explicit Story attachment identifies the editable target.
    // A conversation without one can always create a new independent Project.
    if (studioAttachedStoryId()) prepareStudioBrief({storyId:studioAttachedStoryId()});
    else prepareStudioProject();
  }

  function syncControls() {
    var send = el('director-chat-send');
    var inspect = el('studio-director-inspect');
    if (inspect) inspect.classList.toggle('hidden', state.activeMode !== 'storyboard');
    var input = el('director-chat-input');
    var model = el('director-chat-model');
    var refresh = el('director-chat-model-refresh');
    var clear = el('director-chat-clear');
    var revising = studioRevisionActive();
    var revisionInput = el('director-studio-revision-input');
    var revisionPreset = el('director-studio-revision-preset');
    if (send) {
      send.disabled = revising
        ? studioRevisionRunning || !state.modelId ||
          (!String(revisionInput.value || '').trim() && revisionPreset.value !== 'coherence')
        : state.pending || state.attachmentPending ||
          (persistentMode(state.activeMode) && !state.sessionReady) || !state.modelId ||
          !String(input && input.value || '').trim();
      send.textContent = revising
        ? (revisionPreset.value === 'coherence' ? 'Check Coherence' :
          el('director-studio-revision-fresh').checked ? 'Revise & Generate' : 'Revise Scenes')
        : 'Send';
    }
    revisionInput.disabled = studioRevisionRunning;
    el('director-studio-composer-mode-select').disabled = studioRevisionRunning;
    if (input) input.disabled = state.pending || (persistentMode(state.activeMode) && !state.sessionReady);
    if (model) model.disabled = state.pending || !state.modelsLoaded;
    if (refresh) refresh.disabled = state.pending;
    if (clear) clear.disabled = state.pending || (persistentMode(state.activeMode) && !state.sessionReady);
    var history = el('director-chat-history-toggle');
    if (history) history.disabled = state.pending || !state.sessionReady;
    syncStudioFlow();
    if (state.activeMode === 'storyboard' && window.studioDirectorWorkbench) {
      window.studioDirectorWorkbench.updateContext();
    }
    var prepare = el('director-chat-workshop-prepare');
    if (prepare) {
      prepare.disabled = state.pending || !state.modelId || !!(state.workshop && state.workshop.shotError) || !currentMessages().some(function (message) { return message.role === 'user'; });
      prepare.textContent = state.workshopProposal ? 'Review Proposal' : 'Prepare Revision';
    }
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
      // A transient discovery failure does not invalidate the existing model choice.
      if (state.modelId) {
        select.innerHTML = '';
        var retained = document.createElement('option');
        retained.value = state.modelId;
        retained.textContent = state.modelId + ' (model list unavailable)';
        select.appendChild(retained);
      } else {
        select.innerHTML = '<option value="">Director unavailable</option>';
      }
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

  function studioWorkingStoryLabel() {
    var storyId = studioAttachedStoryId();
    if (!storyId) return window.getStudioDirectorNavigation().projectTitle || 'New Project';
    if (state.studioStoryAccess && state.studioStoryAccess.storyId === storyId) {
      return String(state.studioStoryAccess.label || storyId);
    }
    var snapshot = state.storyboardAttachments['story:' + storyId];
    return snapshot && snapshot.label
      ? String(snapshot.label).replace(/^Story:\s*/i, '') || storyId
      : storyId;
  }

  function studioActionStatus(message, error) {
    var status = el('director-studio-action-status');
    // Routine operation receipts belong on their controls and in Console.
    // Preserve conspicuous feedback for real errors.
    status.classList.toggle('hidden', !message || !error);
    status.textContent = error ? (message || '') : '';
    status.dataset.error = error ? 'true' : 'false';
    if (state.activeMode === 'storyboard' && window.studioDirectorWorkbench) {
      window.studioDirectorWorkbench.setStatus(String(message || ''), !!error);
    }
  }


  function parseStudioProjectDraft(raw) {
    // A focused Write returns structured data, not conversational prose.
    var value;
    try { value = JSON.parse(String(raw || '')); }
    catch (error) {
      throw new Error('Director Project Write returned invalid JSON: ' + error.message +
        '\\nRaw response:\\n' + String(raw || ''));
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Project Write returned no object. Raw response:\\n' + String(raw || ''));
    return value;
  }

  function commitFocusedStudioProject(proposal) {
    return requestJson('/fs/studio/director/project-create', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({proposal:{
        title:proposal.title, concept:proposal.concept, style:proposal.style,
        invariants:proposal.invariants
      }})
    }).then(function (result) {
      if (!result.story || !result.story.id)
        throw new Error('Project creation returned no confirmed saved Project.');
      ['title','concept','style'].forEach(function (field) {
        window.webcapTextareaRevisions.recordFieldChange(
          'project:' + result.story.id + ':storyboard-story-' + field,
          '', result.story[field]);
      });
      recordStudioOperation('project.create','Created Project: ' +
        (result.story.title || result.story.id),result.story.id,result.story.sceneOrder || []);
      return window.studioDirectorBridge.recordApplied('project.create',result.story,{
        title:result.story.title, concept:result.story.concept,
        style:result.story.style, invariants:result.story.invariants
      }).catch(function (error) {
        error.saved = true;
        window.reportConsoleError('Project save receipt',error);
        throw error;
      }).then(function () {
        return window.refreshStudioDirectorStoryIfOpen(result.story.id).then(function () {
          studioActionStatus('Project created: ' + (result.story.title || result.story.id),false);
          return result.story;
        });
      });
    });
  }

  function prepareStudioProject(options) {
    if (state.pending || state.activeMode !== 'storyboard' || !state.sessionReady)
      throw new Error('Finish the current Director request before writing a Project.');
    var discussion = studioConversationMessages(state.modeMessages.storyboard);
    var task = {
      task:'Create one Project with a useful title, developed Concept, Visual / atmosphere and continuity Invariants based on our creative discussion.',
      instruction:String(options && options.instruction || '').trim()
    };
    state.pending = true;
    state.jobId = '';
    startProgress();
    syncControls();
    return studioDirectorRequestMessages(discussion.concat([
      {role:'user',content:JSON.stringify(task)}
    ]),false,true).then(function (messages) {
      state.requestDiagnostic = {model:state.modelId,operation:'studio_project_draft',messages:messages};
        window.studioDirectorWorkbench.showSentWriteContext('studio_project_draft',messages);
      return requestJson('/fs/director/chat',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({model:state.modelId,operation:'studio_project_draft',messages:messages})
      });
    }).then(function (payload) {
      if (!payload.job || !payload.job.jobId) throw new Error('Project Write did not queue.');
      state.jobId = String(payload.job.jobId);
      state.requestDiagnostic = payload.job.request || state.requestDiagnostic;
      trackTransientLlmJob(payload.job);
      return waitForJob(payload.job);
    }).then(function (job) {
      var raw = String(job.result && job.result.text || '');
      state.lastStudioIoRaw = raw;
      el('studio-director-inspect').dataset.newResult = 'true';
      var proposal = parseStudioProjectDraft(raw);
      return commitFocusedStudioProject(proposal);
    }).then(function (result) {
      finishProgress(null);
      return result;
    }).catch(function (error) {
      state.lastStudioIoError = String(error.message || error);
      el('studio-director-inspect').dataset.newResult = 'true';
      studioActionStatus((error.saved ? 'Project saved, reporting failed: ' :
        'Project Write failed: ') + state.lastStudioIoError,true);
      finishProgress(error);
      window.reportConsoleError('Studio Project Write',error);
      throw error;
    }).finally(function () {
      state.pending = false;state.jobId = '';syncControls();
    });
  }

  function parseStudioBriefDraft(raw) {
    var fields;
    try { fields = JSON.parse(String(raw || '')); }
    catch (error) {
      throw new Error('Overview Write returned invalid JSON: ' + error.message +
        '\\nRaw response:\\n' + String(raw || ''));
    }
    if (!fields || typeof fields !== 'object' || Array.isArray(fields))
      throw new Error('Overview Write returned no field object. Raw response:\\n' + String(raw || ''));
    return fields;
  }

  function commitFocusedStudioBrief(storyId, expected, authored, requestedFields) {
    var requested = requestedFields && requestedFields.length ? requestedFields :
      ['title','concept','style','invariants'];
    var changes = {},originals = {};
    requested.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(authored,key)) return;
      if (key === 'invariants') {
        if (!Array.isArray(authored.invariants)) return;
        var before = expected.invariants || [], after = authored.invariants;
        var operations = [];
        before.forEach(function (old) {
          var matching = after.find(function (item) {
            return item.kind === old.kind && item.title === old.title;
          });
          if (!matching) operations.push({op:'remove',before:old});
          else if (JSON.stringify(old) !== JSON.stringify(matching))
            operations.push({op:'update',before:old,after:matching});
        });
        after.forEach(function (item) {
          if (!before.some(function (old) {
            return item.kind === old.kind && item.title === old.title;
          })) operations.push({op:'add',after:item});
        });
        if (operations.length) changes.invariantOps = operations;
      } else if (['title','concept','style'].includes(key) &&
                 typeof authored[key] === 'string' && authored[key] !== expected[key]) {
        changes[key] = authored[key];
        originals[key] = expected[key];
      }
    });
    if (!Object.keys(changes).length) {
      studioActionStatus('Director returned no Project field changes.',true);
      return Promise.resolve(null);
    }
    return requestJson('/fs/studio/director/brief',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({storyId:storyId,expected:originals,changes:changes})
    }).then(function (result) {
      if (!result.story || !result.revisionId)
        throw new Error('Project revision returned no saved revision.');
      ['title','concept','style'].forEach(function (field) {
        if (!Object.prototype.hasOwnProperty.call(changes,field)) return;
        window.webcapTextareaRevisions.recordFieldChange(
          'project:' + storyId + ':storyboard-story-' + field,
          expected[field], result.story[field]);
      });
      recordStudioOperation('brief.apply','Updated Project fields: ' + Object.keys(changes).join(', '),storyId,[]);
      studioActionStatus('Project Overview saved.',false);
      return window.studioDirectorBridge.recordApplied('brief.apply',result.story,
        Object.fromEntries(Object.keys(changes).map(function (key) {
          var field = key === 'invariantOps' ? 'invariants' : key;
          return [field,result.story[field]];
        }))).then(function () {
          return window.refreshStudioDirectorStoryIfOpen(storyId);
        });
    });
  }

  function prepareStudioBrief(options) {
    if (state.pending || state.activeMode !== 'storyboard' || !state.sessionReady)
      throw new Error('Finish the current Director request before writing an Overview.');
    var storyId = String(options && options.storyId || '');
    if (!storyId) throw new Error('Select an existing Project destination for Overview Write.');
    var fields = Array.isArray(options && options.requestedFields) &&
      options.requestedFields.length ? options.requestedFields.slice() :
      ['title','concept','style','invariants'];
    var discussion = studioConversationMessages(state.modeMessages.storyboard);
    state.pending = true;
    state.jobId = '';
    startProgress();
    syncControls();
    return window.flushStudioDirectorStoryEdits(storyId).then(function () {
      return requestJson('/fs/storyboard?story=' + encodeURIComponent(storyId));
    }).then(function (payload) {
      var story = payload.story;
      if (!story || story.id !== storyId) throw new Error('Selected Project is unavailable.');
      var expected = {
        title:story.title, concept:story.concept,
        style:story.style, invariants:story.invariants
      };
      var task = {
        task:'Revise the selected Project Overview using our creative discussion and saved Project baseline. Return the complete values for requestedFields.',
        instruction:String(options && options.instruction || '').trim(),
        requestedFields:fields, project:expected
      };
      return studioDirectorRequestMessages(discussion.concat([
        {role:'user',content:JSON.stringify(task)}
      ]),false,true).then(function (messages) {
        state.requestDiagnostic = {model:state.modelId,operation:'studio_brief_draft',messages:messages};
        window.studioDirectorWorkbench.showSentWriteContext('studio_brief_draft',messages);
        return requestJson('/fs/director/chat',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({model:state.modelId,operation:'studio_brief_draft',
            requiredFields:fields,messages:messages})
        });
      }).then(function (payload) {
        if (!payload.job || !payload.job.jobId) throw new Error('Overview Write did not queue.');
        state.jobId = String(payload.job.jobId);
        state.requestDiagnostic = payload.job.request || state.requestDiagnostic;
        trackTransientLlmJob(payload.job);
        return waitForJob(payload.job);
      }).then(function (job) {
        var raw = String(job.result && job.result.text || '');
        state.lastStudioIoRaw = raw;
        el('studio-director-inspect').dataset.newResult = 'true';
        return commitFocusedStudioBrief(storyId,expected,parseStudioBriefDraft(raw),fields);
      });
    }).then(function (result) {
      finishProgress(null);
      return result;
    }).catch(function (error) {
      state.lastStudioIoError = String(error.message || error);
      el('studio-director-inspect').dataset.newResult = 'true';
      studioActionStatus((error.saved ? 'Overview saved, reporting failed: ' :
        'Overview Write failed: ') + state.lastStudioIoError,true);
      finishProgress(error);
      window.reportConsoleError('Studio Overview Write',error);
      throw error;
    }).finally(function () {
      state.pending = false;state.jobId = '';syncControls();
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
      state.requestDiagnostic = payload.job.request || state.requestDiagnostic;
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
    if (state.pending || (persistentMode(state.activeMode) && !state.sessionReady)) return;
    state.sceneRead = null;
    state.studioApprovedRead = null;
    var preserveContext = !!(options && options.preserveContext);
    if (!persistentMode(state.activeMode)) {
      state.modeMessages[state.activeMode] = [];
      state.modeElapsedByAssistantIndex[state.activeMode] = {};
      state.modeMetricsByAssistantIndex[state.activeMode] = {};
      state.draftByMode[state.activeMode] = '';
      el('director-chat-input').value = '';
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
      state.requestDiagnostic = null;
      state.lastStudioIoError = '';
      state.lastStudioIoRaw = '';
      el('studio-director-inspect').dataset.newResult = 'false';
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
        if (window.studioDirectorWorkbench) window.studioDirectorWorkbench.resetConversation();
          state.modeElapsedByAssistantIndex.storyboard = {};
        state.modeMetricsByAssistantIndex.storyboard = {};
        if (!preserveContext) {
          state.storyboardAttachments = {};
          state.studioStoryAccess = null;
          state.studioAccessIndex = null;
          state.workshop = null;
        }
        state.workshopProposal = null;
        el('director-chat-workshop-status').textContent = '';
      }
      el('director-chat-input').value = '';
      upsertSessionSummary(chat);
      showSessionStatus('Conversation saved', false);
      finishProgress(null);
      syncModeUi();
      el('director-chat-input').focus();
    }).catch(showSessionFailure).finally(function () {
      state.pending = false;
      syncControls();
      // Opening a Studio conversation is passive. The author sends the first request.
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

  function studioConversationMessages(messages) {
    // Keep the full human/model exchange; save receipts and raw structured
    // backend results are not conversation turns.
    return (messages || []).filter(function (message) {
      return message && (message.role === 'user' || message.role === 'assistant') &&
        !/\[WEBCAP APPLIED FIELD VALUES\]|\[WEBCAP EXPLICIT READ\]/.test(String(message.content || ''));
    }).map(function (message) {
      var content = String(message.content || '');
      // Read legacy transcripts without replaying old structured payloads
      // into a new conversational request.
      if (message.role === 'assistant' && typeof message.rawResponse === 'string' &&
          content.trim() === message.rawResponse.trim())
        content = parseStudioChatResponse(message.rawResponse).reply;
      return {role:message.role,content:content};
    });
  }

  function studioDirectorRequestMessages(messages, includePromptContract, explicitWrite, navigationSnapshot) {
    return requestJson('/fs/studio/director/guidance?targetModel=minimax_h3').then(function (payload) {
      var system = explicitWrite ? payload.system : payload.chatSystem;
      if (!system || typeof system !== 'string')
        throw new Error('Studio Director guidance is unavailable.');
      if (includePromptContract && (!payload.promptContract || typeof payload.promptContract !== 'string'))
        throw new Error('H3 prompt-authoring reference is unavailable.');
      var outbound = [{role:'system', content:system}].concat(studioConversationMessages(messages));
      if (includePromptContract)
        outbound[0].content += '\n\nH3 PROMPT AUTHORING REFERENCE:\n' + payload.promptContract;
      return outbound;
    });
  }

  function studioApprovedReadSources() {
    var approved = state.studioApprovedRead;
    if (!approved) return [];
    if (Array.isArray(approved.sources)) return approved.sources;
    // Compatibility with an existing in-memory single-Project selection.
    return approved.projectId ? [approved] : [];
  }

  function studioApprovedSavedContext(story) {
    var source = studioApprovedReadSources().find(function (item) {
      return item.projectId === story.id;
    });
    return source
      ? window.studioDirectorWorkbench.approvedReadPayload(story,source.keys)
      : null;
  }

  function studioDirectorChatRequestMessages(messages) {
    // Conversation is independent of navigation and destination. Only
    // explicit approved saved Read selections can add private saved context.
    var sources = studioApprovedReadSources();
    return Promise.all(sources.map(function (source) {
      return requestJson('/fs/storyboard?story=' + encodeURIComponent(source.projectId))
        .then(function (response) {
          var story = response && response.story;
          if (!story || story.id !== source.projectId)
            throw new Error('Approved Context Project is no longer available. Change Context.');
          return window.studioDirectorWorkbench.approvedReadPayload(story,source.keys);
        });
    })).then(function (approvedPayloads) {
      // Do not leak the selected editor's creative content through automatic navigation context.
      return studioDirectorRequestMessages(messages, false, false,
        {projectId:'',projectTitle:'',sceneId:'',sceneNumber:0,sceneOrder:[]}).then(function (outbound) {
        if (approvedPayloads.length) {
          outbound[0].content += '\nAUTHOR-APPROVED SAVED CONTEXT (independent sources; refreshed for this request):\n' +
            JSON.stringify(approvedPayloads) +
            '\nEach source retains its own Project identity and is reference material, not an automatic Write destination.\n';
        } else {
          outbound[0].content += '\nNo saved Project or Scene reference was supplied for this conversation.\n';
        }
        return outbound;
      });
    });
  }

  function parseStudioChatResponse(raw) {
    // Read-only adapter for previously saved combined-response transcripts.
    // Legacy authored fields and action metadata are not interpreted or run.
    var text = String(raw || '');
    try {
      var archived = JSON.parse(text);
      return {reply:archived && typeof archived.reply === 'string'
        ? archived.reply : 'Earlier structured Director response (see Director I/O).'};
    } catch (_) {
      return {reply:text};
    }
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
    }).map(function (message) {
      return {role:message.role,content:message.content};
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
      state.requestDiagnostic = payload.job.request || state.requestDiagnostic;
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
      // Navigation may suggest a destination, but sending a message cannot
      // attach the conversation or approve saved creative material.
      state.workshopProposal = null;
      // Keep authored Scene and Project reviews available across questions.
      // Explicit new Write actions own replacement of existing drafts.
      el('director-chat-workshop-status').textContent = '';
    }
    var messages = currentMessages();
    var elapsedMap = currentElapsedMap();
    var metricsMap = currentMetricsMap();
    var mode = activeContextMode();
    messages.push({ role: 'user', content: content });
    input.value = '';
    state.draftByMode[activeChatMode] = '';
    if (persistentMode(activeChatMode)) {
      if (state.sessionTimer) clearTimeout(state.sessionTimer);
      state.sessionTimer = 0;
      state.sessionDirty[activeChatMode] = true;
    }
    state.pending = true;
    state.jobId = '';
    renderMessages();
    syncControls();
    startProgress();
    if (activeChatMode === 'storyboard') {
      state.lastStudioIoError = '';
      state.lastStudioIoRaw = '';
    }

    var startedAt = performance.now();
    var requestError = null;
    // Commit the user's words BEFORE asking the model. A refresh or failed
    // inference can never discard the user's last sent message.
    var saved = persistentMode(activeChatMode) ? persistSession(activeChatMode) : Promise.resolve();
    var requestPromise = saved.then(function () {
      if (mode) {
        return Promise.resolve(mode.execute({
          instruction: content,
          modelId: state.modelId,
          messages: messages.slice()
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
          body: JSON.stringify({ model: state.modelId,
            operation: activeChatMode === 'storyboard' ? 'studio_chat' : 'freeform_chat',
            messages: outboundMessages })
        });
      }).then(function (payload) {
        if (!payload.job || !payload.job.jobId) throw new Error('Assistant did not return a queued job.');
        state.jobId = String(payload.job.jobId);
        state.requestDiagnostic = payload.job.request || state.requestDiagnostic;
        trackTransientLlmJob(payload.job);
        renderProgress({ phase: payload.job.status === 'queued' ? 'queued' : 'preparing', jobStatus: payload.job.status, model: payload.job.modelId });
        return waitForJob(payload.job);
      }).then(function (job) {
        var result = job.result && typeof job.result === 'object' ? job.result : {};
        if (activeChatMode !== 'storyboard') return result;
        // Explicit Read already placed the selected saved values in the conversation.
        // Do not allow model-generated hidden read tokens or private continuation.
        return result;
      }).then(function (result) {
        if (activeChatMode === 'storyboard') state.lastStudioIoRaw = String(result.text || '');
        var assistantText = String(result.text || '').trim();
        if (activeChatMode === 'storyboard' && !assistantText)
          throw new Error('Director returned an empty conversation response.');
        if (activeChatMode === 'storyboard' && state.pendingReadAck) {
          var fieldCount = state.pendingReadAck.length;
          state.pendingReadAck = null;
          // The selected saved fields are already in the completed request.
          // Model-generated wording cannot independently prove their delivery.
          var feedback = 'Director replied to Read · ' + fieldCount + ' saved fields supplied.';
          window.studioDirectorWorkbench.setReadStatus('success', feedback);
          studioActionStatus(feedback, false);
        }
        messages.push({ role: 'assistant', content: assistantText });
        // Only explicit Write operations produce structured material.
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
      if (activeChatMode === 'storyboard') {
        state.lastStudioIoError = String(err.message || err);
        el('studio-director-inspect').dataset.newResult = 'true';
      }
      if (activeChatMode === 'storyboard' && state.pendingReadAck) {
        state.pendingReadAck = null;
        if (window.studioDirectorWorkbench) {
          window.studioDirectorWorkbench.setReadStatus('error','Read failed: ' + String(err.message || err));
          window.studioDirectorWorkbench.setStatus('Read failed: ' + String(err.message || err), true);
        }
      }
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
    if (open && !studioWorkspaceVisible() && (!modeId || modeId === 'storyboard')) modeId = 'chat';
    if (modeId) setMode(modeId);
    // Changing modes is intentionally blocked during an active request.
    // Do not show its Studio UI in another workspace while the request finishes.
    if (open && !studioWorkspaceVisible() && state.activeMode === 'storyboard') open = false;
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
    el('app-frame').classList.toggle('studio-director-active', state.open && state.activeMode === 'storyboard');
    drawer.setAttribute('aria-hidden', state.open ? 'false' : 'true');
    toggle.classList.toggle('active', state.open);
    toggle.setAttribute('aria-expanded', state.open ? 'true' : 'false');
    syncPinnedUi();

    if (state.open) {
      syncModeUi();
      return (state.modelsLoaded ? Promise.resolve() : loadModels()).then(function () {
        // An async model refresh may finish after Studio was closed or left.
        if (!state.open) return;
        if (state.activeMode === 'storyboard') {
          if (!studioWorkspaceVisible()) return;
          if (!studioRevisionActive()) maybeOpenNewStudioConversation();
        }
        var input = studioRevisionActive() ? el('director-studio-revision-input') : el('director-chat-input');
        if (input) input.focus();
      });
    }
  }


  function studioDirectorOpenIo() {
    var dialog = el('studio-director-io-dialog'), chooser = el('studio-director-io-exchange');
    var responses = currentMessages().filter(function(m){return m.role === 'assistant';});
    if (state.lastStudioIoRaw)
      responses.push({
        content:state.lastStudioIoError ? 'Latest Write response (operation failed)' :
          'Latest Write response',
        rawResponse:state.lastStudioIoRaw
      });
    chooser.replaceChildren();
    responses.forEach(function(message,index){
      var option=document.createElement('option');
      option.value=String(index);
      option.textContent='Response ' + (index+1) + ' · ' + String(message.content || '').slice(0,55);
      chooser.appendChild(option);
    });
    function render() {
      var item = responses[Number(chooser.value)];
      var raw = item ? String(item.rawResponse || item.content) : '';
      el('studio-director-io-raw').textContent = raw || 'No model response recorded yet.';
      var parsed;
      try { parsed = item && !item.rawResponse ? raw : raw ? JSON.stringify(JSON.parse(raw),null,2) : 'No response to parse.'; }
      catch(error) { parsed = 'Response could not be parsed: ' + error.message; }
      el('studio-director-io-parsed').textContent = parsed;
    }
    chooser.onchange=render;
    if (responses.length) chooser.value=String(responses.length-1);
    render();
    var recorded = currentMessages().filter(function(message){
      return message.role === 'user' && (message.content.includes('[WEBCAP EXPLICIT READ]') ||
        message.content.includes('[WEBCAP APPLIED FIELD VALUES]'));
    });
    el('studio-director-io-history').textContent = recorded.length ? recorded.map(function(message,index){
      return 'Event ' + (index+1) + '\n' + message.content;
    }).join('\n\n') : 'No recorded Read or Apply payloads in this conversation.';
    var hasRequest=!!(state.requestDiagnostic && Array.isArray(state.requestDiagnostic.messages));
    el('studio-director-io-request').disabled=!hasRequest;
    el('studio-director-io-status').textContent = (state.lastStudioIoError
      ? 'Latest request failed: ' + state.lastStudioIoError + ' '
      : '') + (hasRequest
      ? 'Latest request is available.'
      : 'Exact request not retained for this conversation. Recorded responses remain inspectable.');
    el('studio-director-inspect').dataset.newResult='false';
    dialog.showModal();
  }

  function bindStudioDrawerResize() {
    var grip = el('studio-director-resizer'), drawer = el('director-chat-drawer');
    var start = null, key = 'webcap.studioDirector.width';
    function setWidth(width) {
      var maximum = Math.max(1, el('app-frame').clientWidth - 42);
      var minimum = Math.min(420, maximum);
      width = Math.round(Math.max(minimum, Math.min(maximum, width)));
      drawer.style.setProperty('--studio-director-width', width + 'px');
      el('app-frame').style.setProperty('--studio-director-width', width + 'px');
      grip.setAttribute('aria-valuemin', minimum);
      grip.setAttribute('aria-valuemax', maximum);
      grip.setAttribute('aria-valuenow', width);
      return width;
    }
    var saved = Number(localStorage.getItem(key));
    var preferred = saved > 0 && Number.isFinite(saved) ? saved : 820;
    drawer.style.setProperty('--studio-director-width', preferred + 'px');
    el('app-frame').style.setProperty('--studio-director-width', preferred + 'px');
    function refreshBounds(width) {
      var maximum = Math.max(1, el('app-frame').clientWidth - 42);
      grip.setAttribute('aria-valuemin', Math.min(420, maximum));
      grip.setAttribute('aria-valuemax', maximum);
      grip.setAttribute('aria-valuenow', Number.isFinite(width)
        ? Math.round(Math.min(maximum, Math.max(Math.min(420, maximum), width)))
        : Math.round(drawer.getBoundingClientRect().width));
    }
    refreshBounds(preferred);
    grip.addEventListener('focus', refreshBounds);
    window.addEventListener('resize', function () {
      if (state.open && state.activeMode === 'storyboard') refreshBounds();
    });
    grip.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) return;
      event.preventDefault();
      start = {x:event.clientX,width:drawer.getBoundingClientRect().width};
      grip.classList.add('dragging');
      grip.setPointerCapture(event.pointerId);
    });
    grip.addEventListener('pointermove', function (event) {
      if (start) setWidth(start.width + start.x - event.clientX);
    });
    function finish() {
      if (!start) return;
      start = null;
      grip.classList.remove('dragging');
      localStorage.setItem(key, Math.round(drawer.getBoundingClientRect().width));
    }
    grip.addEventListener('pointerup', finish);
    grip.addEventListener('pointercancel', finish);
    grip.addEventListener('lostpointercapture', finish);
    grip.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      localStorage.setItem(key, setWidth(drawer.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? 40 : -40)));
    });
    grip.addEventListener('dblclick', function () {localStorage.setItem(key, setWidth(820));});
  }

  function bind() {
    bindStudioDrawerResize();
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
    var contextRefresh = el('director-chat-context-refresh');
    if (!toggle || !drawer || !pin || !close || !clear || !send || !stop || !copy || !input || !model || !refresh || !modeSwitch || !presetsHost || !contextRefresh) {
      throw new Error('Assistant drawer controls are missing.');
    }

    toggle.onclick = function () {
      if (state.open) setOpen(false);
      else setOpen(true, studioWorkspaceVisible() ? state.lastStudioMode : 'chat');
    };
    pin.onclick = function () { setPinned(!state.pinned); };
    close.onclick = function () {
      var studio = state.activeMode === 'storyboard';
      setOpen(false);
      if (studio) toggle.focus();
    };
    clear.onclick = newChat;
    contextRefresh.onclick = function () {
      var mode = activeContextMode();
      if (!mode || typeof mode.refreshContext !== 'function') {
        throw new Error('This Assistant mode cannot refresh captured context.');
      }
      mode.refreshContext();
    };
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
    el('director-chat-history-toggle').onclick = function () {
      renderSessionHistory();
      el('director-chat-history-toggle').setAttribute('aria-expanded','true');
      el('director-chat-history-panel').showModal();
    };
    el('director-chat-history-close').onclick = function () {el('director-chat-history-panel').close();};
    el('director-chat-history-search').oninput = renderSessionHistory;
    el('director-chat-history-panel').addEventListener('close',function () {
      el('director-chat-history-toggle').setAttribute('aria-expanded','false');
      el('director-chat-history-toggle').focus();
    });
    send.onclick = function () {
      if (studioRevisionActive()) runStudioRevision();
      else sendMessage();
    };
    el('director-studio-composer-mode-select').onchange = function () {
      setStudioComposerMode(this.value);
    };
    el('director-studio-revision-preset').onchange = function () {
      var preset = this.value;
      if (preset) el('director-studio-revision-input').value = window.storyboardRevisionPreset(preset);
      el('director-studio-revision-status').textContent = '';
      syncStudioRevisionUi();
      syncControls();
    };
    el('director-studio-revision-input').oninput = syncControls;
    el('director-studio-revision-fresh').onchange = syncControls;
    el('director-studio-revision-input').addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        runStudioRevision();
      }
    });
    el('studio-director-inspect').onclick = studioDirectorOpenIo;
    el('studio-director-io-close').onclick = function(){el('studio-director-io-dialog').close();};
    el('studio-director-io-request').onclick = function(){
      openDirectorRequestInspector(state.requestDiagnostic,'Director request (latest)');
    };
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
    el('director-chat-attachments-clear').onclick = function () {
      if (state.pending || state.attachmentPending) return;
      state.storyboardAttachments = {};
      scheduleSessionSave();
      syncModeUi();
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
      state.draftByMode[state.activeMode] = input.value;
      if (persistentMode(state.activeMode) && state.sessionReady) scheduleSessionSave();
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
      if (!state.open || state.pinned || document.querySelector('dialog[open]') ||
          drawer.contains(event.target) || toggle.contains(event.target)) return;
      setOpen(false);
    });
    window.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && state.open && !state.pinned &&
          !document.querySelector('dialog[open]')) setOpen(false);
    });

    window.addEventListener('beforeunload', function (event) {
      if (state.sessionTimer || state.sessionSaving || state.sessionDirty.chat ||
          state.sessionDirty.storyboard || state.sessionError) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    state.sessionLoadPromise = loadSessionHistory();
    if (state.pinned) setOpen(true);
    else {
      syncPinnedUi();
      syncModeUi();
    }
  }

  window.studioDirectorBridge = {
    canReview: function () {
      return state.open && state.activeMode === 'storyboard' && state.sessionReady &&
        !state.pending && !state.attachmentPending;
    },
    isStudioMode: function () {return state.open && state.activeMode === 'storyboard';},
    isReady: function () { return !this.readinessMessage(); },
    // A model is selected automatically when discovery returns available models.
    // Being closed, loading conversation state, or busy is not a missing model.
    readinessMessage: function () {
      if (!state.open || state.activeMode !== 'storyboard') return 'Open Studio Director to continue.';
      if (!state.sessionReady) return state.sessionError
        ? 'Director conversation is unavailable. Check the Console.'
        : 'Director conversation is loading.';
      if (state.pending || state.attachmentPending) return 'Finish the current Director request first.';
      if (!state.modelId) return state.modelsLoaded
        ? 'No Director model is available. Refresh models.'
        : 'Director models are loading.';
      return '';
    },
    workingStoryId: function () { return studioAttachedStoryId() || window.getStudioDirectorNavigation().projectId; },
    modelId: function () { return state.modelId; },
    messages: function () {
      return (state.modeMessages.storyboard || []).map(function (message) {
        return {role:message.role,content:message.content};
      });
    },
    clearApprovedRead: function () {
      state.studioApprovedRead = null;
      syncModeUi();
    },
    approvedReadSources: function () {
      return studioApprovedReadSources().map(function (item) {
        return {projectId:item.projectId,keys:item.keys.slice(),label:item.label};
      });
    },
    removeApprovedRead: function (projectId) {
      var remaining = studioApprovedReadSources().filter(function (item) {
        return item.projectId !== projectId;
      });
      state.studioApprovedRead = remaining.length ? {
        sources:remaining,label:remaining.map(function (item) {return item.label;}).join(' · ')
      } : null;
      syncModeUi();
    },
    approveRead: function (projectId, keys) {
      if (!projectId || !Array.isArray(keys) || !keys.length)
        throw new Error('Choose saved Project details before approving Context.');
      var sources = studioApprovedReadSources().filter(function (item) {
        return item.projectId !== projectId;
      });
      sources.push({projectId:projectId,keys:keys.slice(),
        label:window.studioDirectorWorkbench.approvedReadLabel(projectId,keys)});
      state.studioApprovedRead = {
        sources:sources,label:sources.map(function (item) {return item.label;}).join(' · ')
      };
      syncModeUi();
    },
    sendRead: function (payload, keys, instruction) {
      if (!this.isReady()) throw new Error('Open Studio Director and select an available LLM before Read.');
      if (!Array.isArray(keys) || !keys.length) throw new Error('Select at least one field to Read.');
      state.sceneRead = null;
      el('director-chat-scene-context').classList.add('hidden');
      var composer = el('director-chat-input');
      var draft = String(composer.value || '').trim();
      var nl = String.fromCharCode(10);
      composer.value = (draft || instruction || 'Read the selected saved context and acknowledge receipt.') +
        nl + nl + '[WEBCAP EXPLICIT READ]' + nl +
        JSON.stringify(payload, null, 2) + nl + '[END WEBCAP READ]' + nl +
        'Briefly acknowledge the supplied context, then fulfil the author request above. For a context-only Read, stop after a brief confirmation.';
      state.pendingReadAck = keys.slice();
      sendMessage();
    },
    selectWriteProject: function (storyId) {
      if (!storyId) throw new Error('Select a Project destination for Write.');
    },
    prepareWrite: function (kind, storyId, storyTitle, options) {
      if (!this.isReady()) throw new Error(this.readinessMessage());
      if (kind === 'new-project') return prepareStudioProject(options);
      if (kind === 'project') return prepareStudioBrief(
        Object.assign({},options,{storyId:storyId}));
      throw new Error('Unsupported explicit Write operation: ' + kind);
    },
    recordApplied: function (kind, story, selected) {
      if (!story || !story.id || !selected || typeof selected !== 'object') {
        throw new Error('Write receipt requires saved Project data.');
      }
      var isDirectorRevision = kind === 'scene.director.revision';
      var names = {title:'Title',concept:'Concept',style:'Visual / atmosphere',invariants:'Invariants',prompt:'H3 Prompt',durationSeconds:'Duration'};
      var values = selected.savedFields || selected.fields || selected;
      var body = {
        operation:kind, projectId:story.id, savedAt:story.updatedAt,
        fieldNames:Object.keys(values).filter(function (key) {return !!names[key];})
      };
      window.studioDirectorWorkbench.markSavedFields(selected,story);
      var savedFields = Object.keys(values).filter(function(key){return names[key];}).map(function(key){
        return names[key] + (key === 'invariants' ? ' (' + values[key].length + ')' : '');
      });
      if (Array.isArray(selected.scenes)) savedFields.push(selected.scenes.length + (selected.scenes.length === 1 ? ' Scene' : ' Scenes'));
      var savedTarget = selected.sceneId && story.scenes && story.scenes[selected.sceneId]
        ? 'Scene ' + ((story.sceneOrder || []).indexOf(selected.sceneId) + 1) + ' · ' + (story.scenes[selected.sceneId].title || selected.sceneId)
        : story.title || story.id;
      state.modeMessages.storyboard.push({role:'user',
        content:'Saved ' + savedTarget + ': ' + (savedFields.join(' · ') || 'Scene changes') +
          String.fromCharCode(10) + '[WEBCAP APPLIED FIELD VALUES]' +
          String.fromCharCode(10) + JSON.stringify(body, null, 2) +
          String.fromCharCode(10) + '[END WEBCAP APPLY]'});
      renderMessages();
      state.sessionDirty.storyboard = true;
      return persistSession('storyboard');
    },
    checkProjectCoherence: function (storyId) {
      if (!this.isReady()) return Promise.reject(new Error('Studio Director must be ready to check Project coherence.'));
      if (!storyId) return Promise.reject(new Error('Select a Project to check.'));
      state.pending = true;
      state.jobId = '';
      syncControls();
      startProgress();
      return requestJson('/fs/storyboard/director', {
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({storyId:storyId,operation:'check_coherence_sequence',model:state.modelId})
      }).then(function (payload) {
        if (!payload.job || !payload.job.jobId) throw new Error('Coherence check did not queue a job.');
        state.jobId = String(payload.job.jobId);
        trackTransientLlmJob(payload.job);
        return waitForJob(payload.job);
      }).then(function (job) {
        var result = job.result || {};
        if (result.storyId !== storyId || !Array.isArray(result.scenes))
          throw new Error('Coherence check returned invalid Project results.');
        finishProgress(null);
        return result;
      }).catch(function (error) {
        finishProgress(error);
        if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Studio coherence check', error);
        throw error;
      }).finally(function () {
        state.pending = false;
        state.jobId = '';
        syncControls();
      });
    },
    writeNewScene: function (launch) {
      if (!this.isReady()) return Promise.reject(new Error(this.readinessMessage()));
      if (!launch || !launch.projectId || !String(launch.instruction || '').trim())
        return Promise.reject(new Error('Choose a Project and describe the Scene to write.'));
      var storyId = launch.projectId;
      state.pending = true;
      state.jobId = '';
      syncControls();
      return window.flushStudioDirectorStoryEdits(storyId).then(function () {
        return requestJson('/fs/storyboard?story=' + encodeURIComponent(storyId));
      }).then(function (payload) {
        var story = payload.story;
        if (!story || story.id !== storyId) throw new Error('The selected Project is no longer available.');
        var order = story.sceneOrder.slice();
        var prior = order.length && story.scenes[order[order.length-1]];
        var task = JSON.stringify({
          task:'Write the requested new independently generatable H3 Scene or Scenes. Return the complete Scene records.',
          authorDirection:launch.authorRequest || launch.instruction,
          project:{
            title:story.title,concept:story.concept,style:story.style,
            invariants:story.invariants,
            existingSceneTitles:order.map(function (id) {return story.scenes[id].title;}),
            previousScene:prior ? {
              title:prior.title,prompt:prior.prompt,durationSeconds:prior.durationSeconds
            } : null
          }
        });
        state.pending = false;
        return window.studioDirectorBridge.makeProposal(task,'studio_scenes_draft',true,
          {projectId:storyId,projectTitle:story.title,sceneOrder:order}).then(function (raw) {
          state.lastStudioIoRaw = raw;
          var authored;
          try {authored = JSON.parse(raw);}
          catch (error) {throw new Error('Scene Write JSON failed to parse: ' + error.message);}
          if (!authored || !Array.isArray(authored.scenes))
            throw new Error('Scene Write returned no Scenes array; full response is in Director I/O.');
          // The model authors creative values; WebCap binds their target.
          // Keep Director busy until the authoritative save is complete.
          state.pending = true;
          syncControls();
          return requestJson('/fs/studio/director/scenes-draft',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
              storyId:storyId,expectedSceneOrder:order,
              scenes:authored.scenes.map(function (scene) {
                return {
                  title:scene.title,prompt:scene.prompt,
                  durationSeconds:scene.durationSeconds
                };
              }),
              placement:'end',relativeSceneId:''
            })
          });
        }).then(function (result) {
          if (!result || !result.story || result.story.id !== storyId ||
              !Array.isArray(result.scenes))
            throw new Error('Scene Write returned no authoritative saved result.');
          result.scenes.forEach(function (scene) {
            ['title','prompt','durationSeconds'].forEach(function (field) {
              window.webcapTextareaRevisions.recordFieldChange(
                'project:' + storyId + ':scene:' + scene.id + ':field:' + field,
                '', scene[field]);
            });
          });
          return window.refreshStudioDirectorStoryIfOpen(storyId).then(function () {
            return window.studioDirectorBridge.recordApplied('scene.create',result.story,{
              scenes:result.scenes.map(function (scene) {
                return {id:scene.id,title:scene.title,prompt:scene.prompt,
                  durationSeconds:scene.durationSeconds};
              })
            });
          }).catch(function (error) {
            error.saved = true;throw error;
          }).then(function () {
            studioActionStatus(result.scenes.length + ' Scene(s) saved.',false);
            return result;
          });
        });
      }).catch(function (error) {
        state.lastStudioIoError = String(error.message || error);
        el('studio-director-inspect').dataset.newResult = 'true';
        studioActionStatus((error.saved ? 'Scenes saved but reporting failed: ' :
          'Scene Write failed: ') + state.lastStudioIoError,true);
        window.reportConsoleError('Studio Scene Write',error);
        throw error;
      }).finally(function () {
        state.pending = false;state.jobId = '';syncControls();
      });
    },
    writeSelectedScene: function (launch) {
      if (!this.isReady()) return Promise.reject(new Error(this.readinessMessage()));
      if (!launch || !launch.projectId || !launch.sceneId ||
          !String(launch.instruction || '').trim())
        return Promise.reject(new Error('Choose an existing Scene and revision instruction.'));
      var storyId = launch.projectId, sceneId = launch.sceneId;
      var fields = Array.isArray(launch.fields) && launch.fields.length ?
        launch.fields.slice() : ['prompt'];
      state.pending = true;
      state.jobId = '';
      syncControls();
      return window.flushStudioDirectorStoryEdits(storyId).then(function () {
        return requestJson('/fs/storyboard?story=' + encodeURIComponent(storyId));
      }).then(function (payload) {
        var story = payload.story;
        if (!story || story.id !== storyId ||
            !story.scenes || !story.scenes[sceneId])
          throw new Error('The selected saved Scene is unavailable.');
        var task = JSON.stringify({
          task:"Revise exactly the selected Scene fields using the author's creative direction. Return complete replacement values for requestedFields.",
          authorDirection:launch.authorRequest || launch.instruction,
          requestedFields:fields,
          savedScene:window.studioDirectorWorkbench.sceneRead(story,sceneId).payload
        });
        state.pending = false;
        return window.studioDirectorBridge.makeProposal(
          task,'studio_scene_field_draft',fields.includes('prompt'),
          {projectId:storyId,sceneId:sceneId},fields
        ).then(function (raw) {
          state.lastStudioIoRaw = raw;
          var authored;
          try {authored = JSON.parse(raw);}
          catch (error) {throw new Error('Scene revision JSON failed to parse: ' + error.message);}
          if (!authored || typeof authored !== 'object' || Array.isArray(authored))
            throw new Error('Scene revision returned no field object; see Director I/O.');
          var extras = {};
          if (fields.includes('title') && Object.prototype.hasOwnProperty.call(authored,'title'))
            extras.title = authored.title;
          if (fields.includes('durationSeconds') &&
              Object.prototype.hasOwnProperty.call(authored,'durationSeconds'))
            extras.durationSeconds = authored.durationSeconds;
          var prompt = fields.includes('prompt') ? authored.prompt : null;
          state.pending = true;
          syncControls();
          return window.studioDirectorWorkbench.applyScenePrompt(story,sceneId,prompt,extras);
        }).then(function (result) {
          studioActionStatus('Scene revision saved.',false);
          return result;
        });
      }).catch(function (error) {
        state.lastStudioIoError = String(error.message || error);
        el('studio-director-inspect').dataset.newResult = 'true';
        studioActionStatus((error.saved ? 'Scene saved but reporting failed: ' :
          'Scene revision failed: ') + state.lastStudioIoError,true);
        window.reportConsoleError('Studio Scene revision',error);
        throw error;
      }).finally(function () {
        state.pending = false;state.jobId = '';syncControls();
      });
    },
    makeProposal: function (instruction, operation, includePromptContract, navigationSnapshot, requiredFields) {
      if (!this.isReady()) return Promise.reject(new Error('Director must be ready to draft.'));
      state.pending = true;
      syncControls();
      startProgress();
      return studioDirectorRequestMessages(studioConversationMessages(state.modeMessages.storyboard).concat([{role:'user',content:instruction}]), includePromptContract, true, navigationSnapshot).then(function (messages) {
        state.requestDiagnostic = {model:state.modelId,operation:operation || 'studio_scene_field_draft',messages:messages};
        window.studioDirectorWorkbench.showSentWriteContext(operation || 'studio_scene_field_draft', messages);
        return requestJson('/fs/director/chat', {
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({model:state.modelId,operation:operation || 'studio_scene_field_draft',
            messages:messages,requiredFields:requiredFields || []})
        });
      }).then(function (payload) {
        if (!payload.job || !payload.job.jobId) throw new Error('Director did not queue a draft.');
        state.jobId = payload.job.jobId;
        state.requestDiagnostic = payload.job.request || state.requestDiagnostic;
        trackTransientLlmJob(payload.job);
        return waitForJob(payload.job);
      }).then(function (job) {
        var result = job.result || {};
        state.lastStudioIoRaw = String(result.text || '');
        el('studio-director-inspect').dataset.newResult = 'true';
        if (!String(result.text || '').trim()) throw new Error('Director returned an empty response.');
        finishProgress(null);
        return String(result.text);
      }).catch(function (err) {
        state.lastStudioIoError = String(err.message || err);
        el('studio-director-inspect').dataset.newResult = 'true';
        finishProgress(err);
        if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Studio Write', err);
        throw err;
      }).finally(function () {
        state.pending = false;state.jobId = '';syncControls();
      });
    }
  };

  window.syncStoryboardAssistantStory = function () {
    // Story navigation has no authority to mutate Assistant conversations or
    // their explicitly attached reference snapshots.
  };
  window.openStoryboardAssistant = function () {
    studioComposerMode = 'conversation';
    return setOpen(true, 'storyboard');
  };
  window.openStudioDirectorRevision = function (preset) {
    studioComposerMode = 'revision';
    el('director-studio-revision-status').textContent = '';
    return Promise.resolve(setOpen(true, 'storyboard')).then(function () {
      setStudioComposerMode('revision', preset === undefined ? undefined : preset);
    });
  };
  window.openStudioDirectorScene = function (story, sceneId, instruction) {
    if (state.pending || state.attachmentPending)
      return Promise.reject(new Error('Finish the current Director request first.'));
    var context = window.studioDirectorWorkbench.sceneRead(story, sceneId);
    studioComposerMode = 'conversation';
    return Promise.all([setOpen(true, 'storyboard'), state.sessionLoadPromise]).then(function () {
      if (!state.sessionReady) throw new Error('Director conversation could not load. Check the Console.');
      window.studioDirectorBridge.selectWriteProject(story.id, story.title);
      state.sceneRead = {projectId:story.id, sceneId:sceneId,
        sceneNumber:story.sceneOrder.indexOf(sceneId) + 1, label:context.label};
      if (!instruction) {
        syncModeUi();
        el('director-chat-input').focus();
        return;
      }
      // The explicit Scene Revise shortcut is the same single-Scene writer
      // used by conversation, rather than another model/schema/review path.
      return window.studioDirectorBridge.writeSelectedScene({
        projectId:story.id, sceneId:sceneId, instruction:instruction, fields:['prompt']
      });
    });
  };
  window.closeStudioDirectorOnExit = function () {
    if (state.activeMode !== 'storyboard') return;
    if (state.open) setOpen(false);
    // Leave the globally available Assistant on Chat when it is safe to
    // switch. In-flight Studio work retains its own conversation until done.
    if (!state.pending) setMode('chat');
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
    var modeId = String(target.mode || 'chat');
    if (target.contextKey) {
      if (state.pending) throw new Error('Finish the current Assistant response before opening a different QA finding.');
      var key = String(target.contextKey);
      if (state.modeContextKeys[modeId] !== key) {
        // Contextual conversations are transient, scoped to the evidence snapshot
        // that opened them. Switching a finding must never reuse another's chat.
        state.modeContextKeys[modeId] = key;
        state.modeMessages[modeId] = [];
        state.modeElapsedByAssistantIndex[modeId] = {};
        state.modeMetricsByAssistantIndex[modeId] = {};
        state.draftByMode[modeId] = '';
        // The visible input may still belong to another mode. Let setMode
        // capture that draft before restoring the new QA mode's empty draft.
        if (state.activeMode === modeId) el('director-chat-input').value = '';
      }
    }
    setOpen(true, modeId);
  };
  window.setDirectorChatOpen = setOpen;
  window.openDirectorChatActivity = function (target) {
    if (target && target.modelId) state.modelId = String(target.modelId);
    if (target && target.jobId) state.jobId = String(target.jobId);
    setOpen(true);
  };
  // Studio's navigation API is exported by storyboard.js later in tool.html.
  // Bind after classic scripts finish loading, keeping missing APIs loud errors.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
