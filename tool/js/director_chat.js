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
    studioActionIndex: -1,
    studioWorkingDraft: {projects:{},scenes:{},newProject:{},newScene:{},sourceRequest:''},
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
    studioSceneProposal: null,
    studioScenesReviewsByResponse: {},
    studioProjectProposal: null,
    studioScenesProposal: null,
    studioBriefProposal: null,
    studioOperations: [],
    studioWriteIo: [],
    sceneRead: null,
    studioReadiness: {checks:[], readHints:[], writeHint:'', writeFields:[], sceneId:'', sceneNumber:0}
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
  var studioRevisionSelectionProject = '';
  function studioRevisionActive() {
    return state.activeMode === 'storyboard' && studioComposerMode === 'revision';
  }
  function selectedStudioRevisionScenes() {
    return Array.from(el('director-studio-revision-scenes').querySelectorAll('[data-revise-scene]:checked'))
      .map(function (input) { return input.value; });
  }
  function syncStudioRevisionScenes(scope) {
    var host = el('director-studio-revision-scenes');
    var choices = scope.sceneChoices || [];
    var ids = choices.map(function (choice) { return choice.id; });
    var previous = studioRevisionSelectionProject === scope.projectId
      ? new Set(selectedStudioRevisionScenes()) : new Set(ids);
    var existing = Array.from(host.querySelectorAll('[data-revise-scene]')).map(function (item) {
      return {id: item.value, title: item.dataset.sceneTitle};
    });
    var same = existing.length === choices.length && existing.every(function (item, index) {
      return item.id === choices[index].id && item.title === choices[index].title;
    });
    if (!same || studioRevisionSelectionProject !== scope.projectId) {
      host.replaceChildren();
      var allLabel = document.createElement('label');
      var all = document.createElement('input');
      all.type = 'checkbox';
      all.setAttribute('data-revise-scene-all', '');
      allLabel.append(all, document.createTextNode('All Scenes'));
      allLabel.className = 'storyboard-director-scene-select-all';
      host.appendChild(allLabel);
      choices.forEach(function (choice, index) {
        var label = document.createElement('label');
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.value = choice.id;
        box.dataset.reviseScene = '';
        box.dataset.sceneTitle = choice.title;
        box.checked = previous.has(choice.id);
        label.append(box, document.createTextNode(' ' + (index + 1) + '. ' + choice.title));
        host.appendChild(label);
      });
      all.onchange = function () {
        host.querySelectorAll('[data-revise-scene]').forEach(function (box) {
          box.checked = all.checked;
        });
        all.indeterminate = false;
        syncControls();
      };
      host.querySelectorAll('[data-revise-scene]').forEach(function (box) {
        box.onchange = function () { syncStudioRevisionSceneSelection(); syncControls(); };
      });
      studioRevisionSelectionProject = scope.projectId;
    }
    syncStudioRevisionSceneSelection();
  }
  function syncStudioRevisionSceneSelection() {
    var host = el('director-studio-revision-scenes');
    var all = host.querySelector('[data-revise-scene-all]');
    if (!all) return;
    var boxes = Array.from(host.querySelectorAll('[data-revise-scene]'));
    var count = boxes.filter(function (box) { return box.checked; }).length;
    all.checked = boxes.length > 0 && count === boxes.length;
    all.indeterminate = count > 0 && count < boxes.length;
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
    el('director-chat-scene-context').classList.add('hidden');
    el('studio-director-inspect').classList.toggle('hidden', revision || !studio);
    var preset = el('director-studio-revision-preset').value;
    el('director-studio-revision-fresh-label').classList.toggle('hidden', !revision || preset === 'coherence');
    el('director-studio-revision-selection').classList.toggle('hidden', !revision || preset === 'coherence');
    var input = el('director-studio-revision-input');
    input.readOnly = preset === 'coherence';
    var instructionLabel = document.querySelector('label[for="director-studio-revision-input"]');
    instructionLabel.textContent = preset === 'visual_direction' ? 'Additional direction (optional)' : 'Revision instruction';
    input.placeholder = preset === 'visual_direction' ? 'Optional visual direction for the selected Scenes.' :
      'Describe what should be revised across these Scenes.';
    el('director-chat-composer-hint').textContent = revision
      ? 'Ctrl+Enter to run' : 'Enter to send · Shift+Enter for newline';
    var target = el('director-studio-revision-target');
    target.classList.toggle('hidden', !revision);
    if (revision) {
      var scope = window.getStudioDirectorNavigation();
      if (preset !== 'coherence') syncStudioRevisionScenes(scope);
      var selected = preset === 'coherence' ? (scope.sceneOrder || []).length : selectedStudioRevisionScenes().length;
      target.textContent = (scope.projectTitle || 'Current Project') +
        ' · ' + selected + ' of ' + (scope.sceneOrder || []).length + ' Scenes selected';
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
    if (!instruction && preset !== 'coherence' && preset !== 'visual_direction') {
      status.textContent = 'Enter a revision instruction or choose a preset.';
      input.focus();
      return;
    }
    var scope = window.getStudioDirectorNavigation();
    if (!scope.projectId || !(scope.sceneOrder || []).length) {
      status.textContent = 'Choose a Project with Scenes first.';
      return;
    }
    var sceneIds = preset === 'coherence' ? undefined : selectedStudioRevisionScenes();
    if (sceneIds && !sceneIds.length) {
      status.textContent = 'Select at least one Scene.';
      return;
    }
    studioRevisionRunning = true;
    status.textContent = 'Starting ' + (preset === 'coherence' ? 'coherence review' : 'revision') + '…';
    syncControls();
    Promise.resolve(window.startStudioRevision({
      instruction:instruction,preset:preset,modelId:state.modelId,
      projectId:scope.projectId,sceneIds:sceneIds,
      generateFreshTakes:el('director-studio-revision-fresh').checked
    })).then(function (outcome) {
      var failures = outcome && outcome.result && outcome.result.failedScenes || [];
      if (failures.length) {
        status.textContent = outcome.text || 'Scene revision had failures.';
        window.reportConsoleError('Studio revision', new Error(status.textContent));
        return;
      }
      status.textContent = preset === 'coherence'
        ? 'Coherence review completed.' : (outcome && outcome.text || 'Scene revision completed.');
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
    sceneContext.classList.add('hidden');
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
    el('studio-action-advisor').classList.toggle('hidden', !studio ||
      (!el('studio-action-advisor-status').textContent &&
        !el('studio-action-advisor-actions').children.length));
    var contextButton = el('director-chat-context-approve');
    contextButton.classList.toggle('hidden', !studio || studioRevisionActive());
    contextButton.textContent = 'Read…';
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
      if (message.role !== 'user' || message.content.includes('[WEBCAP APPLIED FIELD VALUES]') ||
          message.content.startsWith('[WEBCAP EXPLICIT READ')) continue;
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
    var writeIo = mode === 'storyboard' ? state.studioWriteIo.slice() : [];
    var storyAccess = mode === 'storyboard' ? state.studioStoryAccess : null;
    var readiness = mode === 'storyboard' ? state.studioReadiness : null;
    var workingDraft = mode === 'storyboard' ? JSON.parse(JSON.stringify(state.studioWorkingDraft)) : null;
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
            operations: operations, writeIo: writeIo, storyAccess: storyAccess, readiness: readiness, workingDraft: workingDraft
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
      state.studioActionIndex = -1;
      state.studioWorkingDraft = Object.assign({
        projects:{},scenes:{},newProject:{},newScene:{},sourceRequest:''
      }, chat.workingDraft || {});
      state.modeElapsedByAssistantIndex.storyboard = {};
      state.modeMetricsByAssistantIndex.storyboard = {};
      state.storyboardAttachments = Object.assign({}, chat.attachments || {});
      state.studioStoryAccess = chat.storyAccess || null;
      state.studioAccessIndex = null;
      state.workshop = chat.workshop || null;
      state.studioOperations = Array.isArray(chat.operations) ? chat.operations.slice() : [];
      state.studioWriteIo = Array.isArray(chat.writeIo) ? chat.writeIo.slice() : [];
      if (window.studioDirectorWorkbench) {
        window.studioDirectorWorkbench.resetConversation();
        // Recover the last unsaved proposal with its original bound target.
        // A saved receipt closes that task, while ordinary follow-ups need not.
        for (var actionIndex = chat.messages.length - 1; actionIndex >= 0; actionIndex--) {
          var entry = chat.messages[actionIndex];
          var options = studioStoredActions(entry);
          // A completed Project action never hides an unsaved Scene from the
          // same reply (or vice versa). Each stays bound to the original raw
          // material and the original response index.
          var proposal = options.map(function (item) {
            return item.completed ? null : studioRestoreAuthoredAction(item,entry.rawResponse);
          }).find(function (item) {return !!item;});
          if (proposal) {
            window.studioDirectorWorkbench.presentAction(proposal, proposal.scene,
              {projectId:proposal.projectId}, proposal.request, actionIndex);
            break;
          }
          if (options.some(function (item) {return item.completed;})) break;
        }
      }
      state.studioReadiness = chat.readiness || {checks:[],readHints:[],writeHint:'',writeFields:[],sceneId:''};
      state.studioSceneProposal = null;
      state.studioProjectProposal = null;
      state.studioScenesProposal = null;
      state.studioScenesReviewsByResponse = {};
      state.studioBriefProposal = null;
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
  function studioStoredActions(entry) {
    return entry ? [entry.writeAction].concat(entry.otherWriteActions || []).filter(Boolean) : [];
  }

  function studioActiveStoredAction(entry) {
    return studioStoredActions(entry).find(function (item) {
      return (item.actionKey || 'primary') === (state.studioActionKey || 'primary');
    });
  }

  function placeStudioSuggestion(node, messageIndex, action) {
    // The workbench displays one active action, but a reply can own several
    // independent Project/Scene deliverables. Keep their identities separate.
    if (state.activeMode === 'storyboard' || Number.isInteger(messageIndex))
      state.studioActionIndex = Number.isInteger(messageIndex) ? messageIndex : currentMessages().length - 1;
    state.studioActionKey = action && action.actionKey || 'primary';
    var entry = state.modeMessages.storyboard[state.studioActionIndex];
    if (entry && action) {
      if (entry.writeAction && (entry.writeAction.actionKey || 'primary') === state.studioActionKey)
        entry.writeAction = action;
      else if (Array.isArray(entry.otherWriteActions)) {
        var alternate = entry.otherWriteActions.findIndex(function (item) {
          return item.actionKey === state.studioActionKey;
        });
        if (alternate >= 0) entry.otherWriteActions[alternate] = action;
      }
    }
    node.classList.add('hidden');
  }

  function studioRestoreAuthoredAction(action, rawResponse) {
    if (!action || !rawResponse) return null;
    var response = parseStudioChatResponse(rawResponse);
    var restored = Object.assign({},action);
    if (action.kind === 'create_scene' && response.scenes && response.scenes.length)
      restored.scenes = response.scenes;
    else if (action.kind === 'create_scene' && response.changes && response.changes.scene)
      restored.scenes = [response.changes.scene];
    else if ((action.kind === 'write_project' || action.kind === 'create_project') &&
             response.changes && response.changes.project)
      restored.authoredFields = studioWorkingFieldChanges(response.changes.project,
        ['title','concept','style','invariants']);
    else if (action.kind === 'write_scenes' && response.changes && response.changes.scene)
      restored.authoredFields = studioWorkingFieldChanges(response.changes.scene,
        ['title','prompt','durationSeconds']);
    return (restored.scenes && restored.scenes.length) ||
      (restored.authoredFields && Object.keys(restored.authoredFields).length) ? restored : null;
  }

  function renderMessages() {
    var host = el('director-chat-messages');
    var empty = el('director-chat-empty');
    if (!host || !empty) return;

    // Preserve the workbench-owned action while rebuilding message rows.
    var suggestion = el('studio-dw-suggestions');
    host.before(suggestion);
    suggestion.classList.add('hidden');
    host.innerHTML = '';
    empty.classList.toggle('hidden', currentMessages().length > 0);

    var suggestionRow = null;
    currentMessages().forEach(function (message, index) {
      var studioReply = state.activeMode === 'storyboard' && message.role === 'assistant';
      var visibleText = studioReply ? studioReplyText(message.content) : message.content;
      // Older saved conversations may contain the raw structured JSON as the
      // visible chat message. Re-render that material as a factual draft
      // summary without rewriting history or losing the original response.
      if (studioReply && message.rawResponse &&
          String(message.content || '').trim() === String(message.rawResponse).trim()) {
        visibleText = studioReplyText(parseStudioChatResponse(message.rawResponse).reply);
      }
      if (studioReply && !visibleText.trim())
        return;
      var row = document.createElement('div');
      row.className = 'director-chat-message director-chat-message-' + message.role;

      var label = document.createElement('div');
      label.className = 'director-chat-message-label';
      label.textContent = message.role === 'assistant' ? 'Director' :
        (message.content.indexOf('[WEBCAP APPLIED FIELD VALUES]') !== -1
          ? (message.content.startsWith('Director revision saved:') ? 'WebCap · Director revision' : 'WebCap · Reviewed Apply') :
         message.content.startsWith('[WEBCAP EXPLICIT READ') ? 'You · Read snapshot' : 'You');

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
      // The full Read message is exactly what subsequent LLM requests receive.
      // Do not collapse it into a receipt or alter its source values.
      if (message.role === 'user' && message.content.startsWith('[WEBCAP EXPLICIT READ'))
        body.textContent = message.content;

      row.appendChild(label);
      if (body.textContent || body.children.length) row.appendChild(body);
      var elapsedMap = currentElapsedMap();
      var metricsMap = currentMetricsMap();
      if (message.role === 'assistant' && Object.prototype.hasOwnProperty.call(elapsedMap, index)) {
        var meta = document.createElement('div');
        meta.className = 'director-chat-message-meta';
        meta.textContent = formatResponseMetrics(metricsMap[index], elapsedMap[index]);
        row.appendChild(meta);
      }
      // Saved historical action metadata remains readable, but conversation
      // responses no longer launch implicit Write/Review operations.
      host.appendChild(row);
      if (studioReply && index === state.studioActionIndex) suggestionRow = row;
    });

    if (state.activeMode === 'storyboard' && suggestionRow && suggestion.children.length) {
      suggestionRow.appendChild(suggestion);
      suggestion.classList.remove('hidden');
    }
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
      sceneIds: (sceneIds || []).slice(), at: new Date().toISOString()
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

  function readStudioStoryScope(field, sceneId, readConversationId) {
    if (readConversationId) window.studioDirectorBridge.assertReadConversation(readConversationId);
    var chat = state.sessionByMode.storyboard;
    if (!chat || !state.studioStoryAccess || !chat.id) {
      return Promise.reject(new Error('Connect a Project in this Studio conversation first.'));
    }
    var url = '/fs/studio/director/story-read?chatId=' + encodeURIComponent(chat.id) +
      '&field=' + encodeURIComponent(field) + '&sceneId=' + encodeURIComponent(sceneId || '');
    return flushSessionSave().then(function () {
      if (readConversationId) window.studioDirectorBridge.assertReadConversation(readConversationId);
      return requestJson(url);
    });
  }

  function loadStudioAccessIndex(readConversationId) {
    if (!state.studioStoryAccess || state.studioAccessIndex) return Promise.resolve();
    return readStudioStoryScope('index', '', readConversationId).then(function (result) {
      if (readConversationId) window.studioDirectorBridge.assertReadConversation(readConversationId);
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
    // Capture ownership before even the optional Scene-index fetch.
    var readConversationId = window.studioDirectorBridge.readConversationId();
    var field = el('director-studio-access-field').value;
    var needsScene = ['scene', 'prompt', 'takes'].indexOf(field) !== -1;
    var scene = el('director-studio-access-scene');
    var storyId = state.studioStoryAccess && state.studioStoryAccess.storyId;
    if (!storyId) throw new Error('Choose a Story to inspect.');
    return (needsScene ? loadStudioAccessIndex(readConversationId) : Promise.resolve()).then(function () {
      window.studioDirectorBridge.assertReadConversation(readConversationId);
      if (needsScene && !scene.value) throw new Error('Select a Scene first.');
      return readStudioStoryScope(field, needsScene ? scene.value : '', readConversationId);
    }).then(function (result) {
      window.studioDirectorBridge.assertReadConversation(readConversationId);
      if (result.storyId !== storyId) throw new Error('Project changed while reading fields.');
      var payload = {project: {title: state.studioStoryAccess.label}, savedAt: result.storyUpdatedAt};
      if (field === 'brief') Object.assign(payload.project, result.data);
      else if (field === 'index') payload.scenes = result.data.map(function (item) {
        return {number: item.position, title: item.title};
      });
      else {
        var selected = state.studioAccessIndex.find(function (item) { return item.id === result.sceneId; });
        var savedScene = {number: selected.position, title: selected.title};
        Object.keys(result.data).forEach(function (key) {
          if (key !== 'id') savedScene[key] = result.data[key];
        });
        payload.scenes = [savedScene];
      }
      var output = el('director-studio-access-data');
      output.textContent = JSON.stringify(payload, null, 2);
      output.classList.remove('hidden');
      return window.studioDirectorBridge.appendReadSnapshot(payload, readConversationId, result.storyId);
    }).catch(function (error) {
      el('director-studio-access-status').textContent = 'Read failed: ' + String(error.message || error);
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Studio Story read', error);
      else throw error;
    });
  }

  function syncStudioFlow() {
    var studio = state.activeMode === 'storyboard';
    var discussed = (state.modeMessages && state.modeMessages.storyboard || []).some(function (message) {
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
    capture.textContent = attached ? 'Review Project changes' : 'Review new Project';
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
    if (studioAttachedStoryId()) prepareStudioBrief();
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
          (!String(revisionInput.value || '').trim() &&
            revisionPreset.value !== 'coherence' && revisionPreset.value !== 'visual_direction') ||
          (revisionPreset.value !== 'coherence' && selectedStudioRevisionScenes().length === 0)
        : state.pending || state.attachmentPending ||
          (persistentMode(state.activeMode) && !state.sessionReady) || !state.modelId ||
          !String(input && input.value || '').trim();
      send.textContent = revising
        ? (revisionPreset.value === 'coherence' ? 'Check Coherence' :
          revisionPreset.value === 'visual_direction'
            ? (el('director-studio-revision-fresh').checked ? 'Visual Direction & Generate' : 'Run Visual Direction')
            : el('director-studio-revision-fresh').checked ? 'Revise & Generate' : 'Revise Scenes')
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

  function studioActionStatus(message, error, showPartial) {
    var status = el('director-studio-action-status');
    // Routine receipts stay quiet; incomplete saved results remain visibly explained.
    status.classList.toggle('hidden', !message || (!error && !showPartial));
    status.textContent = error || showPartial ? (message || '') : '';
    status.dataset.error = error ? 'true' : 'false';
    if (state.activeMode === 'storyboard' && window.studioDirectorWorkbench) {
      window.studioDirectorWorkbench.setStatus(String(message || ''), !!error, !!showPartial);
    }
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
    catch (error) { throw new Error('Director returned invalid Project JSON: ' + error.message + '\nRaw Director response:\n' + String(raw || '')); }
    if (!proposal || Array.isArray(proposal) || typeof proposal !== 'object')
      throw new Error('Director returned no Project proposal.\nRaw Director response:\n' + String(raw || ''));
    // The review owns completeness: missing explanatory fields or one imperfect
    // initial Scene must not erase the usable Project proposal.
    proposal.title = typeof proposal.title === 'string' ? proposal.title : '';
    proposal.concept = typeof proposal.concept === 'string' ? proposal.concept : '';
    proposal.style = typeof proposal.style === 'string' ? proposal.style : '';
    proposal.rationale = typeof proposal.rationale === 'string' ? proposal.rationale : '';
    proposal.invariants = Array.isArray(proposal.invariants) ? proposal.invariants.map(function (item) {
      var row = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
      var kinds = ['visual', 'character', 'location', 'world', 'sound', 'custom'];
      return {
        kind: kinds.includes(row.kind) ? row.kind : 'custom',
        title: typeof row.title === 'string' ? row.title : '',
        text: typeof row.text === 'string' ? row.text : ''
      };
    }) : [];
    proposal.initialScenes = Array.isArray(proposal.initialScenes) ? proposal.initialScenes.map(function (item) {
      var row = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
      return {
        title: typeof row.title === 'string' ? row.title : '',
        brief: typeof row.brief === 'string' ? row.brief : '',
        // Preserve an unsupported value for explicit correction in Review.
        durationSeconds: row.durationSeconds == null ? 6 : row.durationSeconds
      };
    }) : [];
    if (!proposal.title.trim() && !proposal.concept.trim() && !proposal.style.trim() &&
        !proposal.invariants.length && !proposal.initialScenes.length)
      throw new Error('Director returned no usable Project material.\nRaw Director response:\n' + String(raw || ''));
    return proposal;
  }

  function addStudioProjectInvariant(item, destination, original) {
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
    remove.onclick = function () {
      row.remove();
      if (destination === 'studio-brief-invariants') el('studio-brief-invariants-selected').checked = true;
    };
    var details = document.createElement('textarea');
    details.placeholder = 'Only what must stay consistent';
    details.setAttribute('aria-label', 'Invariant detail');
    details.rows = 2;
    details.style.gridColumn = '1 / -1';
    details.value = item && item.text || '';
    if (destination === 'studio-brief-invariants') {
      row.dataset.original = original ? JSON.stringify(original) : '';
      [kind, title, details].forEach(function (field) {
        field.addEventListener('input', function () {el('studio-brief-invariants-selected').checked = true;});
        field.addEventListener('change', function () {el('studio-brief-invariants-selected').checked = true;});
      });
    }
    row.append(kind, title, remove, details);
    if (destination === 'studio-brief-invariants' && original) {
      var saved = document.createElement('small');
      saved.style.gridColumn = '1 / -1';
      saved.textContent = 'Saved ' + original.kind + ' · ' + original.title +
        ': ' + original.text +
        (original.kind !== kind.value || original.title !== title.value
          ? ' · A reviewed rename also updates linked Scene references.' : '');
      row.appendChild(saved);
    }
    host.appendChild(row);
  }

  function addStudioProjectExtraScene(scene) {
    var host = el('studio-project-extra-scenes');
    var row = document.createElement('div');
    row.className = 'studio-project-extra-scene';
    var title = document.createElement('input'), duration = document.createElement('input'),
      prompt = document.createElement('textarea'), remove = document.createElement('button'),
      label = document.createElement('strong');
    label.textContent = 'Additional Scene';
    title.type = 'text'; title.placeholder = 'Scene title'; title.value = scene && scene.title || '';
    title.setAttribute('aria-label', 'Additional Scene title');
    duration.type = 'number'; duration.min = 4; duration.max = 15; duration.step = 1;
    duration.value = scene && scene.durationSeconds || 6;
    duration.setAttribute('aria-label', 'Additional Scene duration in seconds');
    prompt.placeholder = 'Short Scene brief for Director to author after Project creation';
    prompt.value = scene && scene.brief || '';
    prompt.rows = 3; prompt.setAttribute('aria-label', 'Additional Scene brief');
    remove.type = 'button'; remove.className = 'review-captions-btn';
    remove.textContent = 'Remove Scene'; remove.onclick = function () {row.remove();};
    row.append(label, title, duration, prompt, remove); host.appendChild(row);
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
    var initial = proposal.initialScenes || [];
    var first = initial[0] || null;
    el('studio-project-extra-scenes').replaceChildren();
    initial.slice(1).forEach(addStudioProjectExtraScene);
    el('studio-project-include-scene').checked = !!first;
    el('studio-project-continue').checked = true;
    el('studio-project-first-scene-fields').classList.toggle('hidden', !first);
    el('studio-project-scene-title').value = first ? first.title : '';
    el('studio-project-scene-prompt').value = first ? first.brief : '';
    el('studio-project-scene-duration').value = first ? first.durationSeconds : 6;
    var dialog = el('studio-project-review');
    if (dialog.open) dialog.close();
    dialog.showModal();
  }

  // Project Writes accept usable model material without manufacturing missing fields.
  // Invariants are identified by their existing (kind, title) identity.
  function studioProjectFieldsFromModel(authored) {
    var values = {}, skipped = [];
    ['title','concept','style'].forEach(function (field) {
      if (!Object.prototype.hasOwnProperty.call(authored,field)) return;
      if (typeof authored[field] === 'string') values[field] = authored[field];
      else skipped.push(field + ' (not text)');
    });
    if (Object.prototype.hasOwnProperty.call(authored,'invariants')) {
      if (!Array.isArray(authored.invariants)) skipped.push('Invariants (not a list)');
      else {
        values.invariants = authored.invariants.map(function (item) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
          return Object.assign({},item,{
            kind:item.kind || 'custom',title:item.title == null ? '' : item.title
          });
        }).filter(function (item,index) {
          var valid = item && typeof item === 'object' && !Array.isArray(item) &&
            ['character','location','visual','world','sound','custom'].includes(item.kind) &&
            typeof item.title === 'string' &&
            typeof item.text === 'string' && item.text.trim();
          if (!valid) skipped.push('Invariant ' + (index+1) + ' (incomplete or invalid)');
          return valid;
        });
      }
    }
    Object.keys(authored).forEach(function (field) {
      if (!['title','concept','style','invariants'].includes(field))
        skipped.push(field + ' (not a Project field)');
    });
    return {values:values,skipped:skipped};
  }

  function studioProjectInvariantChanges(original, suggested) {
    var operations = [], skipped = [], seen = new Set();
    var existing = original || [];
    suggested.forEach(function (item,index) {
      if (!item.title.trim()) {
        skipped.push('Invariant ' + (index+1) + ' (a name is required for individual updates)');
        return;
      }
      var key = item.kind + '\\u0000' + item.title.trim().toLowerCase();
      if (seen.has(key)) {
        skipped.push('Invariant ' + (index+1) + ' (duplicate identity)');
        return;
      }
      seen.add(key);
      var matches = existing.filter(function (saved) {
        return saved.kind === item.kind && saved.title.trim().toLowerCase() === item.title.trim().toLowerCase();
      });
      if (matches.length > 1) {
        skipped.push('Invariant ' + (index+1) + ' (ambiguous saved identity)');
      } else if (matches.length === 1) {
        if (JSON.stringify(matches[0]) !== JSON.stringify(item))
          operations.push({op:'update',before:matches[0],after:item});
      } else operations.push({op:'add',after:item});
    });
    return {operations:operations,skipped:skipped};
  }

  function prepareStudioProject(options) {
    if (state.pending || state.activeMode !== 'storyboard' || !state.sessionReady) return;
    if (!state.modelId) {
      studioActionStatus('No Director model is available. Refresh models.', true);
      return;
    }
    var instruction = String(options && options.instruction || '');
    var saved = false, skippedCreate = [];
    state.lastStudioIoRaw = '';
    state.lastStudioIoError = '';
    var input = {
      task:'Create one Project with its title, Concept, Visual / atmosphere and relevant Invariants. ' +
        'Return complete Project field values in the supplied response format. ' +
        'Scene writing is a separate Write → Scene(s) action.',
      instruction:instruction
    };
    state.pending = true;
    state.jobId = '';
    studioActionStatus('Writing Project…', false);
    startProgress();
    syncControls();
    return studioDirectorRequestMessages((state.modeMessages && state.modeMessages.storyboard || []).concat([
      {role:'user',content:JSON.stringify(input)}
    ]), false, true).then(function (messages) {
      window.studioDirectorWorkbench.showSentWriteContext('studio_project_draft', messages);
      return requestJson('/fs/director/chat', {
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({model:state.modelId,operation:'studio_project_draft',messages:messages})
      });
    }).then(function (payload) {
      if (!payload.job || !payload.job.jobId) throw new Error('Project Write did not queue a job.');
      state.jobId = String(payload.job.jobId);
      state.requestDiagnostic = payload.job.request || null;
      trackTransientLlmJob(payload.job);
      return waitForJob(payload.job);
    }).then(function (job) {
      var raw = String(job.result && job.result.text || '');
      state.lastStudioIoRaw = raw;
      var proposal;
      try { proposal = JSON.parse(raw); }
      catch (error) { throw new Error('Director returned invalid Project JSON: '+error.message+'\\nRaw response:\\n'+raw); }
      if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal))
        throw new Error('Director returned no Project object.\\nRaw response:\\n'+raw);
      var material = studioProjectFieldsFromModel(proposal);
      if (!Object.keys(material.values).some(function (field) {
        return field === 'invariants' ? material.values.invariants.length :
          material.values[field].trim().length;
      })) throw new Error('Director returned no usable Project fields. Raw response remains available in I/O.');
      skippedCreate = material.skipped;
      if (skippedCreate.length)
        studioActionStatus('Saving usable Project fields; skipped: ' + skippedCreate.join(', '),false,true);
      return requestJson('/fs/studio/director/project-create', {
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({proposal:material.values})
      });
    }).then(function (payload) {
      if (!payload.story || !payload.story.id) throw new Error('Project save returned no saved Project.');
      var story = payload.story;
      saved = true;
      recordStudioOperation('project.create','Created Project: '+(story.title || story.id),story.id,[]);
      studioActionStatus('Project saved: '+(story.title || story.id) +
        (skippedCreate.length ? '. Skipped: ' + skippedCreate.join(', ') + '. Raw output is in I/O.' : ''),false,!!skippedCreate.length);
      return window.studioDirectorBridge.recordApplied('project.create',story,{
        title:story.title,concept:story.concept,style:story.style,invariants:story.invariants
      }).then(function () {return window.refreshStudioDirectorStoryIfOpen(story.id);});
    }).catch(function (error) {
      state.lastStudioIoError = String(error.message || error);
      studioActionStatus(saved ? 'Project saved, but reporting failed: '+state.lastStudioIoError :
        'Project Write failed: '+state.lastStudioIoError,true);
      if (typeof window.reportConsoleError === 'function')
        window.reportConsoleError('Studio Project Write',error);
      throw error;
    }).finally(function () {
      state.pending = false;
      state.jobId = '';
      finishProgress(null);
      syncControls();
    });
  }

  // The reviewed Project is saved before any Scene authoring. Each approved
  // brief uses the existing one-Scene writer schema and Studio insertion route.
  function writeInitialProjectScenes(story, briefs) {
    var outcome = {saved:[],failed:[],notAttempted:[],reportingErrors:[]}, current = story;
    function next(index) {
      if (index >= briefs.length) return Promise.resolve(outcome);
      var brief = briefs[index], label = brief.title || ('Scene ' + (index + 1));
      recordStudioOperation('project.scene.progress',
        'Writing initial Scene ' + (index + 1) + '/' + briefs.length + ' · ' + label,
        story.id, []);
      var input = {
        task:'Author exactly ONE new Scene with one complete usable H3 Prompt. ' +
          'Return one JSON object with prompt and title (and durationSeconds if supplied). ' +
          'Use the approved Project direction and Scene brief, matching the requested ' +
          'title and duration in the prompt timing.',
        instruction:brief.brief, requestedTitle:brief.title, durationSeconds:brief.durationSeconds,
        project:{title:current.title,concept:current.concept,style:current.style,
          invariants:current.invariants}
      };
      return studioDirectorRequestMessages((state.modeMessages && state.modeMessages.storyboard || []).concat([{role:'user',content:JSON.stringify(input)}]),
        true,true,{projectId:story.id,projectTitle:story.title,sceneOrder:current.sceneOrder})
        .then(function (messages) {
          window.studioDirectorWorkbench.showSentWriteContext('studio_scene_field_draft',messages);
          return requestJson('/fs/director/chat', {
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({model:state.modelId,operation:'studio_scene_field_draft',
              messages:messages})
          });
        }).then(function (payload) {
          if (!payload.job || !payload.job.jobId)
            throw new Error('Initial Scene authoring did not queue a job.');
          state.jobId = String(payload.job.jobId);
          trackTransientLlmJob(payload.job);
          return waitForJob(payload.job);
        }).then(function (job) {
          var raw = String(job.result && job.result.text || '');
          state.lastStudioIoRaw = raw;
          var authored;
          try { authored = JSON.parse(raw); }
          catch (error) { throw new Error('Director returned invalid Scene JSON.\\nRaw response:\\n' + raw); }
          if (!authored || typeof authored !== 'object' || Array.isArray(authored) ||
              typeof authored.prompt !== 'string' || !authored.prompt.trim())
            throw new Error('Director did not return a usable Prompt for this initial Scene.');
          // The reviewed brief, not model metadata, owns the saved title and duration.
          var scene = {title:brief.title || String(authored.title || '').trim() || label,
            prompt:authored.prompt, durationSeconds:brief.durationSeconds};
          return requestJson('/fs/studio/director/scenes-draft', {
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
              storyId:story.id,expectedSceneOrder:current.sceneOrder.slice(),
              scenes:[scene],placement:'end',relativeSceneId:''
            })
          });
        }).then(function (result) {
          if (!result.story || result.story.id !== story.id ||
              !Array.isArray(result.scenes) || result.scenes.length !== 1 ||
              !result.scenes[0].id) {
            throw new Error('Scene creation result is incomplete; inspect the Project before retrying.');
          }
          current = result.story;
          var saved = result.scenes[0];
          outcome.saved.push(saved.id);
          recordStudioOperation('scene.create','Saved initial Scene · ' +
            (saved.title || saved.id),story.id,[saved.id]);
          return window.studioDirectorBridge.recordApplied('scene.create',result.story,{
            scenes:[{id:saved.id,title:saved.title,prompt:saved.prompt,
              durationSeconds:saved.durationSeconds}]
          }).catch(function (error) {
            outcome.reportingErrors.push(label + ': ' + String(error.message || error));
            window.reportConsoleError('Initial Scene receipt after save',error);
          });
        }).catch(function (error) {
          outcome.failed.push(label + ': ' + String(error.message || error));
          window.reportConsoleError('Initial Scene write · ' + label,error);
          var stopped = ['stopped','cancelled','interrupted'].includes(String(error.jobStatus || ''));
          var shared = stopped ||
            /Failed to fetch|No Director model is available|runtime unavailable/i.test(String(error.message || ''));
          if (shared) {
            outcome.notAttempted = briefs.slice(index + 1).map(function (item,offset) {
              return item.title || ('Scene ' + (index + offset + 2));
            });
            return outcome;
          }
        }).then(function (result) {
          state.jobId = '';
          return result === outcome ? outcome : next(index + 1);
        });
    }
    return next(0);
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
    var firstScenes = [];
    if (el('studio-project-include-scene').checked) {
      firstScenes.push({
        title:el('studio-project-scene-title').value.trim(),
        brief:el('studio-project-scene-prompt').value.trim(),
        durationSeconds:Number(el('studio-project-scene-duration').value)
      });
    }
    el('studio-project-extra-scenes').querySelectorAll('.studio-project-extra-scene').forEach(function (row) {
      firstScenes.push({
        title:row.querySelector('input[type="text"]').value.trim(),
        brief:row.querySelector('textarea').value.trim(),
        durationSeconds:Number(row.querySelector('input[type="number"]').value)
      });
    });
    if (firstScenes.some(function (scene) {
      return !scene.brief || !Number.isInteger(scene.durationSeconds) ||
        scene.durationSeconds < 4 || scene.durationSeconds > 15;
    })) {
      el('studio-project-error').textContent = 'Each initial Scene needs a brief and a duration from 4 to 15 seconds.';
      return;
    }
    if (firstScenes.length > 32) {
      el('studio-project-error').textContent = 'One new Project review can include up to 32 Scenes.';
      return;
    }
    if (!proposal.title && !proposal.concept && !proposal.style && !proposal.invariants.length && !firstScenes.length) {
      el('studio-project-error').textContent = 'Add some Project material before creating.';
      return;
    }
    state.pending = true;
    syncControls();
    el('studio-project-error').textContent = '';
    var createdStory = null, receiptError = '';
    var continueWithProject = el('studio-project-continue').checked;
    requestJson('/fs/studio/director/project-create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposal: proposal })
    }).then(function (payload) {
      if (!payload.story || !payload.story.id) throw new Error('Project creation returned no authoritative Story ID.');
      createdStory = payload.story;
      state.studioProjectProposal = null;
      state.studioWorkingDraft.newProject = {};
      if (state.studioWorkingDraft.draftOrigins)
        state.studioWorkingDraft.draftOrigins.newProject = null;
      scheduleSessionSave();
      el('studio-project-review').close();
      var name = payload.story.title || 'Untitled Project';
      if (continueWithProject) {
        // The author explicitly approved this read grant in the Create review.
        // Conversation history stays independent of which Project is open in Studio.
        state.studioStoryAccess = {storyId: payload.story.id, label: name};
        // Continuing with the new Project changes the deliberate attachment,
        // not the author's independently approved cross-Project references.
        // The Scene from the previous Project cannot become a new write target.
        state.sceneRead = null;
        state.studioAccessIndex = null;
        el('director-studio-access-status').textContent = 'Connected to ' + name + '. No fields read yet.';
        el('director-studio-access-data').classList.add('hidden');
        syncModeUi();
      }
      recordStudioOperation('project.create', 'Created Project: ' + name, payload.story.id, payload.story.sceneOrder);
      studioActionStatus('Project saved: ' + name +
        (firstScenes.length ? '. Writing ' + firstScenes.length + ' initial Scenes…' : '.'), false);
      var projectValues = {
        concept:payload.story.concept,style:payload.story.style,invariants:payload.story.invariants,
        scenes:(payload.story.sceneOrder || []).map(function (id) {
          var scene=payload.story.scenes[id];
          return {id:id,title:scene.title,prompt:scene.prompt};
        })
      };
      return window.studioDirectorBridge.recordApplied('project.create',payload.story,projectValues)
        .catch(function (error) {
          receiptError = String(error.message || error);
          window.reportConsoleError('Project receipt after save',error);
        })
        .then(function () {return writeInitialProjectScenes(payload.story,firstScenes);})
        .then(function (outcome) {
          if (firstScenes.length || receiptError) {
            var summary = 'Project saved' + (firstScenes.length
              ? ' · ' + outcome.saved.length + ' Scenes saved' : '') +
              (outcome.failed.length ? ' · failed: ' + outcome.failed.join(' | ') : '') +
              (outcome.notAttempted.length ? ' · not attempted: ' + outcome.notAttempted.join(', ') : '') +
              (outcome.reportingErrors.length ? ' · Scene receipts failed: ' + outcome.reportingErrors.join(' | ') : '') +
              (receiptError ? ' · Project receipt failed: ' + receiptError : '');
            recordStudioOperation('project.initial-scenes',summary,payload.story.id,outcome.saved);
            studioActionStatus(summary,!!(outcome.failed.length || outcome.notAttempted.length ||
              outcome.reportingErrors.length || receiptError));
          }
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
    var result;
    try { result = JSON.parse(String(raw || '')); }
    catch(error) {
      throw new Error('Director returned invalid Project JSON: '+error.message+
        '\\nRaw response:\\n'+String(raw || ''));
    }
    if (!result || typeof result !== 'object' || Array.isArray(result))
      throw new Error('Director returned no Project field object.\\nRaw response:\\n'+raw);
    // Do not silently reinterpret or discard field values. The save endpoint
    // determines which values can be stored in the selected Project fields.
    return result;
  }

  // A bounded, editable-review-only word comparison. No source text is rewritten.
  function studioDirectorRenderDiff(host, before, after) {
    before = String(before || ''); after = String(after || '');
    host.replaceChildren();
    if (before === after) { host.textContent = 'No text changes.'; return; }
    var oldWords = before.match(/\s+|[^\s]+/g) || [];
    var newWords = after.match(/\s+|[^\s]+/g) || [];
    if (oldWords.length > 650 || newWords.length > 650) {
      var prefix = 0;
      while (prefix < Math.min(before.length, after.length) && before[prefix] === after[prefix]) prefix++;
      var suffix = 0;
      while (suffix < Math.min(before.length, after.length) - prefix &&
        before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
      var append = function(tag, value) {
        if (!value) return;
        var element = document.createElement(tag);
        element.textContent = value; host.appendChild(element);
      };
      append('span', before.slice(0,prefix));
      append('del', before.slice(prefix,before.length-suffix));
      append('ins', after.slice(prefix,after.length-suffix));
      append('span', after.slice(after.length-suffix));
      return;
    }
    var rows = Array.from({length:oldWords.length+1},function(){return new Uint16Array(newWords.length+1);});
    for(var i=oldWords.length-1;i>=0;i--)
      for(var j=newWords.length-1;j>=0;j--)
        rows[i][j] = oldWords[i] === newWords[j] ? rows[i+1][j+1]+1 :
          Math.max(rows[i+1][j],rows[i][j+1]);
    var i=0,j=0,segments=[];
    function add(tag,word) {
      var last=segments[segments.length-1];
      if (last && last.tag === tag) last.text+=word;
      else segments.push({tag:tag,text:word});
    }
    while(i<oldWords.length || j<newWords.length){
      if(i<oldWords.length && j<newWords.length && oldWords[i]===newWords[j]){
        add('span',oldWords[i]);i++;j++;
      } else if(i<oldWords.length && (j===newWords.length || rows[i+1][j]>=rows[i][j+1])) add('del',oldWords[i++]);
      else add('ins',newWords[j++]);
    }
    segments.forEach(function(segment){
      var node=document.createElement(segment.tag);
      node.textContent=segment.text;
      host.appendChild(node);
    });
  }
  window.studioDirectorRenderDiff = studioDirectorRenderDiff;

  function showStudioBriefReview() {
    var proposal = state.studioBriefProposal;
    if (!proposal) throw new Error('Prepare Concept, Style and Invariants before reviewing.');
    el('studio-brief-target').textContent = 'Project: ' + (proposal.storyTitle || proposal.storyId);
    el('studio-brief-rationale').textContent = proposal.rationale;
    el('studio-brief-title-before').textContent = 'Current: ' + (proposal.expected.title || '(untitled)');
    el('studio-brief-title').value = proposal.draft.title;
    var requested = Array.isArray(proposal.requestedFields) && proposal.requestedFields.length
      ? proposal.requestedFields : null;
    el('studio-brief-title-selected').checked = proposal.draft.title !== proposal.expected.title &&
      (!requested || requested.includes('title'));
    el('studio-brief-concept-before').textContent = 'Current: ' + (proposal.expected.concept || '(empty)');
    el('studio-brief-style-before').textContent = 'Current: ' + (proposal.expected.style || '(empty)');
    el('studio-brief-concept').value = proposal.draft.concept;
    el('studio-brief-style').value = proposal.draft.style;
    ['title','concept','style'].forEach(function(key){
      studioDirectorRenderDiff(el('studio-brief-'+key+'-diff'), proposal.expected[key], proposal.draft[key]);
    });
    el('studio-brief-concept-selected').checked = proposal.draft.concept !== proposal.expected.concept &&
      (!requested || requested.includes('concept'));
    el('studio-brief-style-selected').checked = proposal.draft.style !== proposal.expected.style &&
      (!requested || requested.includes('style'));
    // A model's omission never becomes a proposed deletion by accident.
    // Match existing rows by their current composite identity; the author
    // explicitly removes a row to approve its deletion.
    var existing = proposal.expected.invariants || [];
    var suggested = proposal.draft.invariants || [];
    var matched = new Set();
    var reviewed = existing.map(function (before) {
      var redirect = (proposal.renames || []).find(function (rename) {
        return rename.beforeKind === before.kind &&
          rename.beforeTitle.toLowerCase() === before.title.toLowerCase();
      });
      var index = suggested.findIndex(function (item) {
        return item.kind === (redirect ? redirect.afterKind : before.kind) &&
          item.title.toLowerCase() === (redirect ? redirect.afterTitle : before.title).toLowerCase();
      });
      if (index >= 0) matched.add(index);
      return {item:index >= 0 ? suggested[index] : before, original:before};
    });
    suggested.forEach(function (item, index) {
      if (!matched.has(index)) reviewed.push({item:item, original:null});
    });
    el('studio-brief-invariants-selected').checked = (!requested || requested.includes('invariants')) &&
      (reviewed.length !== existing.length || reviewed.some(function (row, index) {
        return !existing[index] || ['kind','title','text'].some(function (field) {
          return row.item[field] !== existing[index][field];
        });
      }));
    el('studio-brief-invariants').replaceChildren();
    reviewed.forEach(function (row) {
      addStudioProjectInvariant(row.item, 'studio-brief-invariants', row.original);
    });
    updateStudioBriefReviewSummary();
    groupStudioBriefReviewParts();
    el('studio-brief-error').textContent = '';
    var dialog = el('studio-brief-review');
    if (dialog.open) dialog.close();
    dialog.showModal();
  }

  function updateStudioBriefReviewSummary() {
    var proposal = state.studioBriefProposal;
    if (!proposal) return;
    var names = {title:'Project title',concept:'Concept',style:'Visual / atmosphere',invariants:'Invariants'};
    var rows = Array.from(el('studio-brief-invariants').querySelectorAll('.studio-project-invariant'));
    var invariants = rows.map(function (row) {
      var fields = row.querySelectorAll('select, input, textarea');
      return {kind:fields[0].value,title:fields[1].value.trim(),text:fields[2].value.trim()};
    });
    var existing = proposal.expected.invariants || [];
    var selected = [];
    Object.keys(names).forEach(function (key) {
      var changed = key === 'invariants' ? invariants.length !== existing.length || invariants.some(function (item,index) {
        return !existing[index] || ['kind','title','text'].some(function (field) {return item[field] !== existing[index][field];});
      }) : el('studio-brief-' + key).value.trim() !== String(proposal.expected[key] || '').trim();
      var checked = el('studio-brief-' + key + '-selected').checked;
      var section = el('studio-brief-' + key + '-state').closest('.studio-brief-field');
      section.dataset.changed = String(changed);
      if (key !== 'invariants') studioDirectorRenderDiff(el('studio-brief-' + key + '-diff'),
      proposal.expected[key], el('studio-brief-' + key).value);
    el('studio-brief-' + key + '-state').textContent = (changed ? 'Changed' : 'Unchanged') +
        (checked ? ' · selected' : ' · not selected');
      if (checked) selected.push(names[key] + (key === 'invariants' ? ' (' + invariants.length + ')' : ''));
    });
    el('studio-brief-summary').textContent = selected.length ? 'Selected: ' + selected.join(' · ') : 'No fields selected';
  }

  function groupStudioBriefReviewParts() {
    var parts = el('studio-brief-parts'), unchanged = el('studio-brief-unchanged');
    unchanged.open = false;
    ['title','concept','style','invariants'].forEach(function (key) {
      var section = el('studio-brief-' + key + '-state').closest('.studio-brief-field');
      if (section.dataset.changed === 'true') parts.insertBefore(section,unchanged);
      else unchanged.appendChild(section);
    });
    unchanged.classList.toggle('hidden', !unchanged.querySelector('.studio-brief-field'));
  }

  function prepareStudioBrief(options) {
    if (state.pending || state.activeMode !== 'storyboard' || !state.sessionReady) return;
    var storyId = String(options && options.storyId || studioAttachedStoryId() || '');
    if (!storyId) {studioActionStatus('Choose a Project destination before Write.',true);return;}
    if (!state.modelId) {studioActionStatus('No Director model is available.',true);return;}
    var instruction = String(options && options.instruction || '');
    var requestedFields = Array.isArray(options && options.requestedFields)
      ? options.requestedFields.slice() : [];
    if (requestedFields.some(function (field) {
      return !['title','concept','style','invariants'].includes(field);
    })) throw new Error('Project Write includes an unsupported requested field.');
    state.pending = true;
    state.jobId = '';
    startProgress();
    syncControls();
    studioActionStatus('Writing Project fields…',false);
    var original, saved = false, skippedRevise = [];
    state.lastStudioIoRaw = '';
    state.lastStudioIoError = '';
    return window.flushStudioDirectorStoryEdits(storyId).then(function () {
      return requestJson('/fs/storyboard?story='+encodeURIComponent(storyId));
    }).then(function (response) {
      original = response.story;
      if (!original || original.id !== storyId) throw new Error('Selected Project is unavailable.');
      var input = {
        task:'Revise only the requested Project fields in the author’s direction. ' +
          'Return changed values for those fields; preserve all other Project and Scene content. ' +
          'For Invariants, return additions or updates identified by kind and title; omissions do not delete saved Invariants.',
        instruction:instruction,
        requestedFields:requestedFields,
        project:{title:original.title,concept:original.concept,
          style:original.style,invariants:original.invariants}
      };
      return studioDirectorRequestMessages((state.modeMessages && state.modeMessages.storyboard || []).concat([
        {role:'user',content:JSON.stringify(input)}
      ]),false,true);
    }).then(function (messages) {
      window.studioDirectorWorkbench.showSentWriteContext('studio_brief_draft',messages);
      return requestJson('/fs/director/chat',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({model:state.modelId,operation:'studio_brief_draft',
          messages:messages,requiredFields:requestedFields})
      });
    }).then(function (payload) {
      if (!payload.job || !payload.job.jobId) throw new Error('Project Write did not queue.');
      state.jobId = String(payload.job.jobId);
      state.requestDiagnostic = payload.job.request || null;
      trackTransientLlmJob(payload.job);
      return waitForJob(payload.job);
    }).then(function (job) {
      var raw = String(job.result && job.result.text || '');
      state.lastStudioIoRaw = raw;
      var authored = parseStudioBriefDraft(raw);
      var material = studioProjectFieldsFromModel(authored), changes = {}, expected = {};
      var permitted = requestedFields.length ? requestedFields : ['title','concept','style','invariants'];
      var ignored = Object.keys(authored).filter(function (field) {
        return ['title','concept','style','invariants'].includes(field) && !permitted.includes(field);
      });
      permitted.forEach(function (field) {
        if (!Object.prototype.hasOwnProperty.call(material.values,field)) return;
        if (field === 'invariants') {
          var delta = studioProjectInvariantChanges(original.invariants,material.values.invariants);
          if (delta.operations.length) changes.invariantOps = delta.operations;
          material.skipped.push.apply(material.skipped,delta.skipped);
        } else if (material.values[field] !== original[field]) {
          changes[field] = material.values[field];
          expected[field] = original[field];
        }
      });
      skippedRevise = ignored.map(function (field) {return field + ' (outside Write scope)';})
        .concat(material.skipped,requestedFields.filter(function (field) {
          return !Object.prototype.hasOwnProperty.call(authored,field);
        }).map(function (field) {return field + ' (not returned)';}));
      if (skippedRevise.length)
        studioActionStatus('Director response ignored: ' + skippedRevise.join(', ') +
          '. Raw output is available in I/O.',false,true);
      if (!Object.keys(changes).length) {
        studioActionStatus('Director returned no usable changes for the requested Project fields.' +
          (skippedRevise.length ? ' Inspect raw output in I/O.' : ''),false,true);
        return null;
      }
      return requestJson('/fs/studio/director/brief',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({storyId:storyId,expected:expected,changes:changes})
      }).then(function (result) {
        if (!result.story || !result.revisionId)
          throw new Error('Project save returned no authoritative revision.');
        saved = true;
        recordStudioOperation('brief.apply','Updated '+Object.keys(changes).join(', '),storyId,[]);
        studioActionStatus('Project fields saved.' + (skippedRevise.length ?
          ' Ignored: ' + skippedRevise.join(', ') + '. Raw output is in I/O.' : ''),false,!!skippedRevise.length);
        var values = {};
        Object.keys(changes).forEach(function (key) {values[key === 'invariantOps' ? 'invariants' : key]=result.story[key === 'invariantOps' ? 'invariants' : key];});
        return window.studioDirectorBridge.recordApplied('brief.apply',result.story,values)
          .then(function () {return window.refreshStudioDirectorStoryIfOpen(storyId);});
      });
    }).catch(function (error) {
      state.lastStudioIoError = String(error.message || error);
      studioActionStatus(saved ? 'Project saved, but reporting failed: '+state.lastStudioIoError
        : 'Project Write failed: '+state.lastStudioIoError,true);
      if (typeof window.reportConsoleError === 'function')
        window.reportConsoleError('Studio Project Write',error);
      throw error;
    }).finally(function () {
      state.pending = false;
      state.jobId = '';
      finishProgress(null);
      syncControls();
    });
  }

  function applyStudioBrief() {
    var proposal = state.studioBriefProposal;
    if (!proposal || state.pending) return;
    var changes = {};
    if (el('studio-brief-title-selected').checked) changes.title = el('studio-brief-title').value.trim();
    if (el('studio-brief-concept-selected').checked) changes.concept = el('studio-brief-concept').value.trim();
    if (el('studio-brief-style-selected').checked) changes.style = el('studio-brief-style').value.trim();
    if (el('studio-brief-invariants-selected').checked) {
      var reviewed = Array.from(el('studio-brief-invariants').querySelectorAll('.studio-project-invariant')).map(function (row) {
        var fields = row.querySelectorAll('select, input, textarea');
        return {
          before: row.dataset.original ? JSON.parse(row.dataset.original) : null,
          after: {kind:fields[0].value, title:fields[1].value.trim(), text:fields[2].value.trim()}
        };
      });
      if (reviewed.some(function (item) {return !item.after.title || !item.after.text;})) {
        el('studio-brief-error').textContent = 'Every Invariant needs a name and description.';
        return;
      }
      var operations = [];
      proposal.expected.invariants.forEach(function (before) {
        var row = reviewed.find(function (item) {
          return item.before && item.before.kind === before.kind && item.before.title === before.title;
        });
        if (!row) operations.push({op:'remove', before:before});
        else if (JSON.stringify(before) !== JSON.stringify(row.after))
          operations.push({op:'update', before:before, after:row.after});
      });
      reviewed.forEach(function (row) {
        if (!row.before) operations.push({op:'add', after:row.after});
      });
      if (operations.length) changes.invariantOps = operations;
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
      if (field !== 'invariantOps') expected[field] = proposal.expected[field];
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
      state.studioBriefProposal = null;
      // Clear only fields whose value was actually persisted, preserving
      // independent unsaved work for a later revision.
      var retained = state.studioWorkingDraft.projects[proposal.storyId];
      if (retained) {
        Object.keys(retained).forEach(function (field) {
          if (Object.prototype.hasOwnProperty.call(result.story,field) &&
              JSON.stringify(retained[field]) === JSON.stringify(result.story[field]))
            delete retained[field];
        });
        if (!Object.keys(retained).length) {
          delete state.studioWorkingDraft.projects[proposal.storyId];
          if (state.studioWorkingDraft.draftOrigins &&
              state.studioWorkingDraft.draftOrigins.projects)
            delete state.studioWorkingDraft.draftOrigins.projects[proposal.storyId];
        }
        scheduleSessionSave();
      }
      el('studio-brief-review').close();
      recordStudioOperation('brief.apply', 'Updated ' + Object.keys(changes).join(', '),
        proposal.storyId, []);
      studioActionStatus('Project brief saved.', false);
      var saved = {};
      Object.keys(changes).forEach(function (key) {saved[key === 'invariantOps' ? 'invariants' : key] = result.story[key === 'invariantOps' ? 'invariants' : key];});
      return window.studioDirectorBridge.recordApplied('brief.apply',result.story,saved)
        .then(function () {return window.refreshStudioDirectorStoryIfOpen(proposal.storyId);});
    }).catch(function (error) {
      if (applied) {
        studioActionStatus('Selected Concept, Style or Invariants changes were applied, but history save or refresh failed: ' +
          String(error.message || error), true);
      } else {
        el('studio-brief-error').textContent = 'Apply was not confirmed: ' +
          String(error.message || error) + '. Refresh the current Project if the connection was lost.';
      }
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Studio Brief Apply', error);
      else throw error;
    }).finally(function () {
      state.pending = false;
      syncControls();
    });
  }

  function addStudioScenesRow(item) {
    var row = document.createElement('section');
    row.className = 'studio-scenes-row';
    row.style.cssText = 'display:grid;gap:8px;margin:0 0 20px;padding:15px;border:1px solid var(--border);border-radius:10px;';
    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;';
    var label = document.createElement('strong');
    label.textContent = 'New Scene';
    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'review-captions-btn';
    remove.textContent = 'Remove';
    remove.onclick = function () { row.remove(); rememberStudioScenesReview(); };
    header.append(label, remove);
    var title = document.createElement('input');
    title.setAttribute('aria-label', 'Scene title');
    title.dataset.field = 'title';
    title.placeholder = 'Working title (optional)';
    title.value = item.title || '';
    var durationLabel = document.createElement('label');
    durationLabel.textContent = 'Duration (s)';
    var duration = document.createElement('input');
    duration.type = 'text'; duration.inputMode = 'decimal'; duration.placeholder = '6';
    duration.dataset.field = 'durationSeconds';
    var suppliedDuration = (typeof item.durationSeconds === 'number' ||
      typeof item.durationSeconds === 'string') && String(item.durationSeconds).trim() !== '';
    var numericDuration = Number(item.durationSeconds);
    var usableDuration = suppliedDuration && Number.isFinite(numericDuration) &&
      numericDuration >= 4 && numericDuration <= 15;
    duration.value = suppliedDuration ? String(item.durationSeconds) : '6';
    durationLabel.appendChild(duration);
    if (!usableDuration) {
      var durationNote = document.createElement('span');
      durationNote.textContent = !suppliedDuration
        ? 'Duration missing; using the 6s default. You can change it.'
        : 'Duration ' + String(item.durationSeconds) + ' needs correction before this Scene can be saved.';
      durationLabel.appendChild(durationNote);
    }
    var promptLabel = document.createElement('label');
    promptLabel.textContent = 'H3 Prompt';
    var prompt = document.createElement('textarea');
    prompt.dataset.field = 'prompt'; prompt.rows = 8;
    prompt.value = item.prompt || '';
    promptLabel.appendChild(prompt);
    if (!prompt.value.trim()) {
      var promptNote = document.createElement('span');
      promptNote.textContent = 'No Prompt supplied. This Scene stays in review until completed; other Scenes can be saved.';
      promptLabel.appendChild(promptNote);
    }
    row.append(header, title, durationLabel, promptLabel);
    el('studio-scenes-rows').appendChild(row);
  }

  // Keep edits in the existing Scene review when the author closes or switches
  // responses. A Project match alone does not make two drafts interchangeable.
  var displayedStudioScenesProposal = null;
  function rememberStudioScenesReview() {
    var proposal = displayedStudioScenesProposal;
    if (!proposal || !el('studio-scenes-review').open) return;
    proposal.drafts = Array.from(el('studio-scenes-rows').querySelectorAll('.studio-scenes-row'))
      .map(function (row) {
        return {
          title:row.querySelector('[data-field="title"]').value,
          prompt:row.querySelector('[data-field="prompt"]').value,
          durationSeconds:row.querySelector('[data-field="durationSeconds"]').value
        };
      });
    proposal.placement = el('studio-scenes-placement').value;
  }

  function showStudioScenesReview() {
    if (el('studio-scenes-review').open) rememberStudioScenesReview();
    var proposal = state.studioScenesProposal;
    if (!proposal) throw new Error('Prepare Scenes before reviewing them.');
    displayedStudioScenesProposal = proposal;
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
    placement.value = proposal.placement || 'end';
    var dialog = el('studio-scenes-review');
    if (dialog.open) dialog.close();
    dialog.showModal();
  }

  function applyStudioScenes() {
    var proposal = state.studioScenesProposal;
    if (!proposal || state.pending) return;
    var rows = Array.from(el('studio-scenes-rows').querySelectorAll('.studio-scenes-row'));
    var readyRows = [], incompleteRows = [], defaulted = 0;
    rows.forEach(function (row) {
      var title = row.querySelector('[data-field="title"]').value.trim();
      var prompt = row.querySelector('[data-field="prompt"]').value.trim();
      if (!prompt) {
        incompleteRows.push(row);
        return;
      }
      var durationInput = row.querySelector('[data-field="durationSeconds"]');
      var supplied = String(durationInput.value || '').trim();
      var duration = supplied ? Number(supplied) : 6;
      if (supplied && (!Number.isFinite(duration) || duration < 4 || duration > 15)) {
        incompleteRows.push(row);
        return;
      }
      if (!supplied) {
        durationInput.value = '6';
        defaulted++;
      }
      readyRows.push({row:row, draft:{title:title,prompt:prompt,durationSeconds:duration}});
    });
    if (!readyRows.length) {
      el('studio-scenes-error').textContent = rows.length
        ? 'No Scenes are ready to save. Complete a Prompt or correct an unsupported duration; your drafts are preserved.'
        : 'Add a Scene with a Prompt before applying.';
      return;
    }
    var drafts = readyRows.map(function (item) {return item.draft;});
    var pieces = el('studio-scenes-placement').value.split('|');
    var placement = pieces[0];
    var relativeSceneId = pieces[1] || '';
    state.pending = true;
    syncControls();
    el('studio-scenes-error').textContent = '';
    var applied = false;
    return Promise.resolve().then(function () {
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
      var savedCount = payload.scenes.length;
      if (incompleteRows.length) {
        // Leave incomplete work editable and retain a fresh order for the next Apply.
        proposal.sceneOrder = payload.story.sceneOrder.slice();
        proposal.scenes = payload.story.scenes;
        proposal.drafts = incompleteRows.map(function (row) {
          return {
            title:row.querySelector('[data-field="title"]').value.trim(),
            prompt:row.querySelector('[data-field="prompt"]').value,
            durationSeconds:row.querySelector('[data-field="durationSeconds"]').value
          };
        });
        readyRows.forEach(function (item) {item.row.remove();});
        el('studio-scenes-error').textContent = savedCount + ' Scene' +
          (savedCount === 1 ? '' : 's') + ' saved. ' + incompleteRows.length +
          ' still need a Prompt or duration correction; edit or remove them here.' +
          (defaulted ? ' ' + defaulted + ' saved using the 6s duration default.' : '');
      } else {
        state.studioScenesProposal = null;
        if (Number.isInteger(proposal.sourceMessageIndex))
          delete state.studioScenesReviewsByResponse[proposal.sourceMessageIndex];
        el('studio-scenes-review').close();
      }
      var durationNotice = defaulted ? ' · ' + defaulted + ' duration' +
        (defaulted === 1 ? '' : 's') + ' defaulted to 6s' : '';
      recordStudioOperation('scenes.create', 'Created ' + savedCount + ' Scenes with prompts' +
        durationNotice, proposal.storyId, payload.scenes.map(function (scene) { return scene.id; }));
      studioActionStatus((savedCount === 1 ? 'Scene created.' : savedCount + ' Scenes created.') +
        durationNotice, false);
      return window.studioDirectorBridge.recordApplied('scenes.create',payload.story,{
        scenes:payload.scenes.map(function (scene) {
          return {id:scene.id,title:scene.title,prompt:scene.prompt,durationSeconds:scene.durationSeconds};
        })
      }).then(function () {return window.refreshStudioDirectorStoryIfOpen(proposal.storyId);});
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

  function showStudioSceneDraftReview() {
    var proposal = state.studioSceneProposal;
    if (!proposal) throw new Error('Prepare a Studio Scene before reviewing it.');
    var dialog = el('studio-scene-draft-review');
    el('studio-scene-draft-target').textContent = 'Project: ' + (proposal.storyTitle || proposal.storyId);
    el('studio-scene-draft-rationale').textContent = proposal.rationale ||
      'A tentative Scene. No prompt, Takes or generation job will be created.';
    el('studio-scene-draft-title').value = proposal.title;
    el('studio-scene-draft-prompt').value = proposal.prompt;
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

  function applyStudioSceneDraft() {
    var proposal = state.studioSceneProposal;
    if (!proposal || state.pending) return;
    var title = el('studio-scene-draft-title').value.trim();
    var prompt = el('studio-scene-draft-prompt').value.trim();
    var reviewedScene = {title: title, prompt: prompt};
    var placementValue = el('studio-scene-draft-placement').value.split('|');
    var placement = placementValue[0];
    var relativeSceneId = placementValue[1] || '';
    if (!prompt) {
      el('studio-scene-draft-error').textContent = 'Write a full Prompt before creating this Scene.';
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
          scene: reviewedScene,
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
      var receipt = 'Created Scene ' + index + (title ? ' · ' + title : '') +
        ' in ' + (proposal.storyTitle || proposal.storyId) +
        '. H3 Prompt saved; Takes remain empty.';
      recordStudioOperation('scene.create', receipt, proposal.storyId, [created.id]);
      studioActionStatus(receipt, false);
      return window.studioDirectorBridge.recordApplied('scene.create',payload.story,{
        scenes:[{id:created.id,title:created.title,prompt:created.prompt}]
      }).catch(function (error) {
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
    if (state.pending || (persistentMode(state.activeMode) && !state.sessionReady)) return;
    state.sceneRead = null;
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
        state.studioActionIndex = -1;
        state.studioWorkingDraft = {projects:{},scenes:{},newProject:{},newScene:{},sourceRequest:''};
        state.studioOperations = [];
        if (window.studioDirectorWorkbench) window.studioDirectorWorkbench.resetConversation();
        state.studioReadiness = {checks:[],readHints:[],writeHint:'',writeFields:[],sceneId:''};
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
        state.studioScenesReviewsByResponse = {};
        state.studioBriefProposal = null;
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

  function studioDirectorRequestMessages(messages, includePromptContract, explicitWrite, navigationSnapshot) {
    // Creative requests need the author's task and relevant source material.
    // Navigation, available buttons, IDs and save policy remain WebCap concerns.
    // Keep the existing call signature for contextual Write callers.
    return requestJson('/fs/studio/director/guidance?targetModel=minimax_h3').then(function (payload) {
      if (!payload.system || typeof payload.system !== 'string')
        throw new Error('Studio Director creative guidance is unavailable.');
      if (includePromptContract && (!payload.promptContract || typeof payload.promptContract !== 'string'))
        throw new Error('H3 prompt-authoring reference is unavailable.');
      // Preserve the complete actual conversation, including long messages.
      // Task-specific Write material is supplied separately by the caller.
      var outbound = [{role:'system', content:payload.system}].concat(messages.map(function(message) {
        return {role:message.role, content:String(message.content || '')};
      }));
      if (includePromptContract)
        outbound[0].content += '\n\nH3 PROMPT AUTHORING REFERENCE:\n' + payload.promptContract;
      // Read snapshots travel as ordinary persisted conversation messages.
      // Explicit Write callers supply their own authoritative current baselines.
      return outbound;
    });
  }

  function studioDirectorChatRequestMessages(messages, selectedScene, navigationSnapshot, boundTarget) {
    var navigation = navigationSnapshot || window.getStudioDirectorNavigation();
    var targetProjectId = selectedScene ? selectedScene.projectId :
      (studioAttachedStoryId() || navigation.projectId || '');
    if (boundTarget) {
      boundTarget.projectId = targetProjectId;
      boundTarget.sceneId = selectedScene && selectedScene.projectId === targetProjectId ? selectedScene.sceneId : '';
      boundTarget.sceneNumber = boundTarget.sceneId ? selectedScene.sceneNumber : 0;
    }
    return studioDirectorRequestMessages(messages, false, false).then(function (outbound) {
      outbound[0].content += '\n\nAnswer the author conversationally. Project and Scene writing are explicit functions, not conversational output requirements.\n';
      return outbound;
    });
  }

  // Retain available conversational work across ordinary follow-up questions.
  function markStudioReadinessOutdated() {
    // Kept only for old conversation metadata; it never invalidates a useful
    // current action or a completed draft.
    state.sessionDirty.storyboard = true;
  }

  // A Studio conversation owns unsaved sparse field replacements. Saved
  // Project/Scene records stay authoritative until a deliberate Write.
  function studioWorkingFieldChanges(source, names) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
    var result = {};
    names.forEach(function (name) {
      if (!Object.prototype.hasOwnProperty.call(source,name)) return;
      var value = source[name];
      if (name === 'invariants') {
        // A malformed optional entry must not replace a valid saved list.
        if (Array.isArray(value) && value.every(function (item) {
          return item && typeof item === 'object' && !Array.isArray(item) &&
            ['character','location','visual','world','sound','custom'].includes(item.kind) &&
            typeof item.title === 'string' && typeof item.text === 'string';
        })) result[name] = value;
      } else if (name === 'durationSeconds') {
        if (Number.isInteger(value) && value >= 4 && value <= 15) result[name] = value;
      } else if (typeof value === 'string' && value.trim()) {
        result[name] = value;
      }
    });
    return result;
  }

  function parseStudioChatResponse(raw) {
    // Ordinary Director is conversation only. Display exactly what the model
    // returned; do not infer authoring fields, actions, or completion.
    var text=String(raw == null ? '' : raw);
    if (!text.trim()) throw new Error('Director returned no answer.');
    return {reply:text,action:null,changes:null,scenes:null};
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
      if (kind === 'story') state.studioSceneProposal = null;
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
    var decisions = (state.modeMessages && state.modeMessages.storyboard || []).filter(function (message) {
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

    // Freeze the selected Scene before conversation persistence or network work.
    // Fetch its latest saved fields later, when building the actual LLM request.
    var selectedNavigation = activeChatMode === 'storyboard' ? window.getStudioDirectorNavigation() : null;
    var selectedScene = selectedNavigation ? studioDirectorSelectedScene(selectedNavigation, content) : null;

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
    // Freeze the Project destination alongside the user's instruction.
    var selectedProjectId = activeChatMode === 'storyboard' ?
      (studioAttachedStoryId() || (selectedNavigation && selectedNavigation.projectId) || '') : '';
    var selectedProject = selectedProjectId ? {projectId:selectedProjectId} : null;
    var resolvedTarget = {};
    var messages = currentMessages();
    var elapsedMap = currentElapsedMap();
    var metricsMap = currentMetricsMap();
    var mode = activeContextMode();
    messages.push({ role: 'user', content: content });
    if (activeChatMode === 'storyboard') {
      markStudioReadinessOutdated();
      window.studioDirectorWorkbench.clearActionAdvice();
    }
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
        ? studioDirectorChatRequestMessages(messages, selectedScene, selectedNavigation, resolvedTarget)
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
        state.requestDiagnostic = payload.job.request || null;
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
        var studioResponse = activeChatMode === 'storyboard' ? parseStudioChatResponse(result.text) : null;
        var assistantText = studioResponse ? studioResponse.reply : String(result.text || '');
        messages.push({ role: 'assistant', content: assistantText });
        var targetScene = resolvedTarget.sceneId ? {
          projectId:resolvedTarget.projectId,sceneId:resolvedTarget.sceneId,
          sceneNumber:resolvedTarget.sceneNumber
        } : selectedScene;
        var targetProject = resolvedTarget.projectId ? {projectId:resolvedTarget.projectId} : selectedProject;
        if (studioResponse) messages[messages.length - 1].rawResponse = String(result.text || '');
        if (activeChatMode === 'storyboard' && studioResponse) el('studio-director-inspect').dataset.newResult = 'true';
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
      if (!requestError && activeChatMode === 'storyboard' && state.sessionByMode.storyboard) {
        // Sidecar has its own job and UI; it cannot delay or fail this chat turn.
        var scope = {
          conversationId:state.sessionByMode.storyboard.id,
          modelId:state.modelId,
          messages:messages.map(function (message) {
            return {role:message.role,content:String(message.content || '')};
          }),
          projectId:selectedProjectId,
          sceneId:selectedScene && selectedScene.sceneId || ''
        };
        Promise.resolve().then(function () {
          window.studioDirectorWorkbench.offerActionAdvice(scope);
        }).catch(function (error) {
          window.reportConsoleError('Studio Action Advisor',error);
        });
      }
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
    (state.studioWriteIo || []).forEach(function(entry) {
      responses.push({content:'Write · ' + entry.operation + ' · ' + entry.at,
        rawResponse:entry.rawResponse});
    });
    if (state.lastStudioIoError && state.lastStudioIoRaw)
      responses.push({content:'Failed response',rawResponse:state.lastStudioIoRaw});
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
      return message.role === 'user' && (message.content.startsWith('[WEBCAP EXPLICIT READ') ||
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
    el('studio-project-add-scene').onclick = function () {
      if (el('studio-project-extra-scenes').children.length +
          (el('studio-project-include-scene').checked ? 1 : 0) >= 32) {
        el('studio-project-error').textContent = 'At most 32 initial Scenes.';
        return;
      }
      addStudioProjectExtraScene({title:'',prompt:''});
    };
    el('studio-brief-close').onclick = function () { el('studio-brief-review').close(); };
    el('studio-brief-discard').onclick = function () { el('studio-brief-review').close(); };
    el('studio-brief-apply').onclick = applyStudioBrief;
    ['title','concept','style'].forEach(function (key) {
      el('studio-brief-' + key).addEventListener('input', function () {
        el('studio-brief-' + key + '-selected').checked = true;
      });
    });
    ['input','change','click'].forEach(function (eventName) {
      el('studio-brief-review').addEventListener(eventName, updateStudioBriefReviewSummary);
    });
    el('studio-brief-add-invariant').onclick = function () {
      addStudioProjectInvariant(null, 'studio-brief-invariants');
      el('studio-brief-invariants-selected').checked = true;
    };
    el('studio-scenes-close').onclick = function () { rememberStudioScenesReview(); el('studio-scenes-review').close(); };
    el('studio-scenes-discard').onclick = function () { rememberStudioScenesReview(); el('studio-scenes-review').close(); };
    el('studio-scenes-apply').onclick = applyStudioScenes;
    el('studio-scenes-rows').addEventListener('input',rememberStudioScenesReview);
    el('studio-scenes-placement').onchange = rememberStudioScenesReview;
    el('studio-scenes-add').onclick = function () {
      if (el('studio-scenes-rows').children.length >= 32) {
        el('studio-scenes-error').textContent = 'Review up to 32 Scenes at a time.';
        return;
      }
      addStudioScenesRow({ title: '', prompt: '' });
      rememberStudioScenesReview();
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
      el('director-studio-revision-input').value = preset ? window.storyboardRevisionPreset(preset) : '';
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

  // Only actual persisted field values clear a retained draft. Keep unrelated
  // fields available if the save applied only part of the author's material.
  function forgetSavedStudioSceneFields(storyId, sceneId, savedScene) {
    if (!storyId || !sceneId || !savedScene || typeof savedScene !== 'object') return;
    var draft = state.studioWorkingDraft.scenes[sceneId];
    if (!draft) return;
    var changed = false;
    Object.keys(draft).forEach(function (field) {
      if (Object.prototype.hasOwnProperty.call(savedScene,field) &&
          JSON.stringify(draft[field]) === JSON.stringify(savedScene[field])) {
        delete draft[field];
        changed = true;
      }
    });
    if (changed) {
      if (!Object.keys(draft).length) {
        delete state.studioWorkingDraft.scenes[sceneId];
        if (state.studioWorkingDraft.draftOrigins &&
            state.studioWorkingDraft.draftOrigins.scenes)
          delete state.studioWorkingDraft.draftOrigins.scenes[sceneId];
      }
      scheduleSessionSave();
    }
  }

  window.studioDirectorBridge = {
    placeSuggestedAction: placeStudioSuggestion,
    markWriteActionEdited:function (action) {
      var entry = state.modeMessages.storyboard[state.studioActionIndex];
      if (studioActiveStoredAction(entry) !== action)
        throw new Error('Edited Scene Review is no longer bound to its original Director proposal.');
      scheduleSessionSave();
    },
    finishWriteAction:function (action) {
      var entry = state.modeMessages.storyboard[state.studioActionIndex];
      var stored = studioActiveStoredAction(entry);
      if (!stored || stored.kind !== action.kind ||
          stored.instruction !== action.instruction)
        throw new Error('Completed Write action no longer matches its conversation proposal.');
      stored.completed = true;
      scheduleSessionSave();
    },
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
    preparedWrite: function () {
      var working = state.studioWorkingDraft;
      var navigation = window.getStudioDirectorNavigation();
      var projectId = navigation.projectId || studioAttachedStoryId();
      var sceneId = navigation.sceneId;
      var fields = sceneId && working.scenes[sceneId];
      if (projectId && fields && Object.keys(fields).length)
        return {kind:'scene',projectId:projectId,sceneId:sceneId,fields:Object.keys(fields)};
      fields = projectId && working.projects[projectId];
      if (fields && Object.keys(fields).length)
        return {kind:'project',projectId:projectId,fields:Object.keys(fields)};
      if (projectId && working.newScene && working.newScene.prompt)
        return {kind:'new-scene',projectId:projectId,fields:Object.keys(working.newScene)};
      if (working.newProject && working.newProject.concept && working.newProject.style)
        return {kind:'new-project',fields:Object.keys(working.newProject)};
      return null;
    },
    preparedSceneFields: function (sceneId) {
      return Object.assign({}, state.studioWorkingDraft.scenes[sceneId] || {});
    },
    forgetSavedSceneDraft: forgetSavedStudioSceneFields,
    reviewPreparedWrite: function (draft) {
      if (!this.canReview()) throw new Error('Open the Studio conversation to review its prepared material.');
      if (draft.kind === 'project') {
        return prepareStudioBrief({storyId:draft.projectId,requestedFields:draft.fields});
      }
      if (draft.kind === 'new-project') return prepareStudioProject({});
      if (draft.kind === 'new-scene') return this.writeNewScene({
        projectId:draft.projectId,instruction:'Review prepared new Scene material.',
        authorRequest:'Save that prompt'
      });
      throw new Error('Scene drafts are reviewed by the Scene workbench.');
    },
    modelId: function () { return state.modelId; },
    messages: function () {
      return (state.modeMessages && state.modeMessages.storyboard || []).map(function (message) {
        return {role:message.role,content:message.content};
      });
    },
    isCurrentConversation: function (conversationId) {
      return !!(conversationId && state.activeMode === 'storyboard' && state.sessionReady &&
        state.sessionByMode.storyboard && state.sessionByMode.storyboard.id === conversationId);
    },
    readConversationId: function () {
      if (state.activeMode !== 'storyboard' || !state.sessionReady || state.pending || state.attachmentPending ||
          !state.sessionByMode.storyboard || !state.sessionByMode.storyboard.id)
        throw new Error('Open an idle saved Studio Director conversation before Read.');
      return state.sessionByMode.storyboard.id;
    },
    assertReadConversation: function (conversationId) {
      if (!conversationId || this.readConversationId() !== conversationId)
        throw new Error('Conversation changed during Read. Return to the originating conversation and Read again.');
    },
    appendReadSnapshot: function (payload, conversationId, projectId) {
      this.assertReadConversation(conversationId);
      if (!payload || !projectId) throw new Error('Read requires a saved Project snapshot.');
      var content = '[WEBCAP EXPLICIT READ — SAVED SNAPSHOT]\n' +
        JSON.stringify(payload, null, 2) + '\n[END WEBCAP READ]';
      var messages = state.modeMessages.storyboard;
      messages.push({role:'user',content:content});
      state.sessionDirty.storyboard = true;
      renderMessages();
      syncModeUi();
      return persistSession('storyboard');
    },
    selectWriteProject: function (storyId, storyTitle) {
      if (!storyId) throw new Error('Select a Project destination for Write.');
      // Selecting a destination is operation-local. Do not change the
      // conversation attachment, approved Read selections, or navigation.
      if (state.studioBriefProposal && state.studioBriefProposal.storyId !== storyId)
        state.studioBriefProposal = null;
      if (state.studioSceneProposal && state.studioSceneProposal.storyId !== storyId)
        state.studioSceneProposal = null;
      if (state.studioScenesProposal && state.studioScenesProposal.storyId !== storyId)
        state.studioScenesProposal = null;
    },
    prepareWrite: function (kind, storyId, storyTitle, options) {
      var authored = options && options.authoredFields;
      if (authored ? !this.canReview() : !this.isReady())
        throw new Error(authored ? 'Open the Studio conversation to review authored material.' :
          this.readinessMessage());
      if (kind !== 'new-project') this.selectWriteProject(storyId,storyTitle);
      if (kind === 'new-project') {
        state.studioProjectProposal = null; // Create a fresh review from current conversation.
        return prepareStudioProject(options);
      }
      if (kind === 'project') return prepareStudioBrief(Object.assign({},options,{storyId:storyId}));
      throw new Error('Unsupported reviewed Write operation: ' + kind);
    },
    recordApplied: function (kind, story, selected) {
      if (!story || !story.id || !selected || typeof selected !== 'object') {
        throw new Error('Reviewed Apply receipt requires saved Project data.');
      }
      var isDirectorRevision = kind === 'scene.director.revision';
      var names = {title:'Title',concept:'Concept',style:'Visual / atmosphere',invariants:'Invariants',prompt:'H3 Prompt',durationSeconds:'Duration'};
      var values = selected.savedFields || selected.fields || selected;
      var working = state.studioWorkingDraft;
      if (kind === 'project.create') working.newProject = {};
      if (Array.isArray(selected.scenes)) working.newScene = {};
      // A successful receipt clears only fields that actually match saved data.
      var target = selected.sceneId ? working.scenes[selected.sceneId] :
        working.projects[story.id];
      if (target) {
        Object.keys(values).forEach(function (field) {
          if (Object.prototype.hasOwnProperty.call(target,field) &&
              JSON.stringify(target[field]) === JSON.stringify(values[field]))
            delete target[field];
        });
        if (!Object.keys(target).length) {
          if (selected.sceneId) delete working.scenes[selected.sceneId];
          else delete working.projects[story.id];
        }
      }
      var body = {
        operation:kind, projectId:story.id, savedAt:story.updatedAt,
        fieldNames:Object.keys(values).filter(function (key) {return !!names[key];})
      };
      markStudioReadinessOutdated();
      window.studioDirectorWorkbench.updateWorkingWrite();
      window.studioDirectorWorkbench.markSavedFields(selected,story);
      var savedFields = Object.keys(values).filter(function(key){return names[key];}).map(function(key){
        return names[key] + (key === 'invariants' ? ' (' + values[key].length + ')' : '');
      });
      if (Array.isArray(selected.scenes)) savedFields.push(selected.scenes.length + (selected.scenes.length === 1 ? ' Scene' : ' Scenes'));
      var savedTarget = selected.sceneId && story.scenes && story.scenes[selected.sceneId]
        ? 'Scene ' + ((story.sceneOrder || []).indexOf(selected.sceneId) + 1) + ' · ' + (story.scenes[selected.sceneId].title || selected.sceneId)
        : story.title || story.id;
      if ((kind !== 'scenes.create' || !state.studioScenesProposal) &&
          window.studioDirectorWorkbench.completeWriteAction(kind, story, selected)) {
        var sourceMessage = state.modeMessages.storyboard[state.studioActionIndex];
        var activeAction = studioActiveStoredAction(sourceMessage);
        if (activeAction) activeAction.completed = true;
      }
      state.modeMessages.storyboard.push({role:'user',
        content:'Saved ' + savedTarget + ': ' + (savedFields.join(' · ') || 'Scene changes') +
          String.fromCharCode(10) + '[WEBCAP APPLIED FIELD VALUES]' +
          String.fromCharCode(10) + JSON.stringify(body, null, 2) +
          String.fromCharCode(10) + '[END WEBCAP APPLY]'});
      renderMessages();
      state.sessionDirty.storyboard = true;
      return persistSession('storyboard');
    },
    reviewCapture: function (capture, storyId) {
      if (!this.canReview()) return Promise.reject(new Error('Open an available Studio conversation before reviewing.'));
      if (!storyId || !capture || ['title','concept','style','invariant'].indexOf(capture.field) === -1 ||
          typeof capture.content !== 'string' || !capture.content.trim()) {
        return Promise.reject(new Error('Choose a saved Project and a complete creative field proposal.'));
      }
      if (state.studioBriefProposal) {
        return Promise.reject(new Error('A Project proposal is already being reviewed. Finish or discard it before capturing another.'));
      }
      state.pending = true;
      syncControls();
      return Promise.resolve().then(function () {
        return window.flushStudioDirectorStoryEdits(storyId);
      }).then(function () {
        return requestJson('/fs/storyboard?story=' + encodeURIComponent(storyId));
      }).then(function (payload) {
        var story = payload.story;
        if (!story || story.id !== storyId) throw new Error('Selected Project is unavailable.');
        var expected = {title:story.title,concept:story.concept,style:story.style,invariants:story.invariants};
        var proposed = {title:story.title,concept:story.concept,style:story.style,invariants:story.invariants};
        var renames = [];
        if (capture.field === 'invariant') {
          var after = {kind:capture.kind, title:capture.title.trim(), text:capture.content.trim()};
          proposed.invariants = (story.invariants || []).slice();
          if (capture.beforeKind && capture.beforeTitle) {
            var index = proposed.invariants.findIndex(function (item) {
              return item.kind === capture.beforeKind &&
                item.title.toLowerCase() === capture.beforeTitle.toLowerCase();
            });
            if (index < 0) throw new Error('The referenced Invariant no longer exists. Read and select the saved identity.');
            var before = proposed.invariants[index];
            proposed.invariants[index] = after;
            renames.push({
              beforeKind:before.kind,beforeTitle:before.title,
              afterKind:after.kind,afterTitle:after.title
            });
          } else {
            if (proposed.invariants.some(function (item) {
              return item.kind === after.kind && item.title.toLowerCase() === after.title.toLowerCase();
            })) throw new Error('An Invariant with this identity already exists. Review it as an update instead.');
            proposed.invariants.push(after);
          }
        } else {
          proposed[capture.field] = capture.content;
        }
        state.studioBriefProposal = {
          storyId:storyId,storyTitle:story.title,expected:expected,draft:proposed,renames:renames,
          rationale:'Director developed this material in conversation. Review and edit before saving.'
        };
        showStudioBriefReview();
        studioActionStatus('Review the Project Overview without another model request.',false);
      }).finally(function () {
        state.pending = false;
        syncControls();
      });
    },
    reviewSceneCapture: function (capture, storyId) {
      if (!this.canReview()) return Promise.reject(new Error('Open an available Studio conversation before reviewing.'));
      if (!storyId || !capture || capture.field !== 'scene' ||
          typeof capture.content !== 'string' || !capture.content.trim() ||
          typeof capture.title !== 'string') {
        return Promise.reject(new Error('Choose a Project and a complete Scene Prompt.'));
      }
      if (state.studioSceneProposal || state.studioScenesProposal) {
        return Promise.reject(new Error('An unfinished Scene draft exists. Finish or discard it first.'));
      }
      state.pending = true;
      syncControls();
      return Promise.resolve().then(function () {
        return window.flushStudioDirectorStoryEdits(storyId);
      }).then(function () {
        return requestJson('/fs/storyboard?story=' + encodeURIComponent(storyId));
      }).then(function (payload) {
        var story = payload.story;
        if (!story || story.id !== storyId) throw new Error('Selected Project is unavailable.');
        if (Number.isInteger(capture.durationSeconds)) {
          // Reuse complete authored material with its duration in the existing review.
          state.studioScenesProposal = {
            storyId:storyId, storyTitle:story.title, sceneOrder:(story.sceneOrder || []).slice(),
            scenes:story.scenes, drafts:[{title:capture.title,prompt:capture.content,
              durationSeconds:capture.durationSeconds}],
            rationale:'Director developed this Scene in conversation. Review before saving.'
          };
          showStudioScenesReview();
        } else {
          // Old captures did not carry a duration; retain their original review.
          state.studioSceneProposal = {
            storyId:storyId, storyTitle:story.title, expectedUpdatedAt:story.updatedAt,
            sceneOrder:(story.sceneOrder || []).slice(), scenes:story.scenes,
            title:capture.title, prompt:capture.content,
            rationale:'Director developed this Scene in conversation. Review before saving.',
            placement:'end'
          };
          showStudioSceneDraftReview();
        }
        studioActionStatus('Review the developed Scene without another model request.',false);
      }).finally(function () {
        state.pending = false;
        syncControls();
      });
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
    reviewPendingScenes: function (projectId, sourceMessageIndex) {
      var proposal = state.studioScenesProposal;
      var retained = proposal && proposal.sourceMessageIndex === sourceMessageIndex
        ? proposal : state.studioScenesReviewsByResponse[sourceMessageIndex];
      if (retained && retained.storyId !== projectId)
        return this.reviewAuthoredScenes({projectId:projectId,sourceMessageIndex:sourceMessageIndex,
          scenes:JSON.parse(retained.sourceScenesSignature),rationale:retained.rationale});
      if (!proposal || proposal.storyId !== projectId ||
          proposal.sourceMessageIndex !== sourceMessageIndex) {
        var saved = state.studioScenesReviewsByResponse[sourceMessageIndex];
        if (!saved || saved.storyId !== projectId)
          return Promise.reject(new Error('This response\'s authored Scene review is no longer available.'));
        if (proposal) {
          if (!Number.isInteger(proposal.sourceMessageIndex))
            return Promise.reject(new Error('Finish the independent Scene review before switching.'));
          rememberStudioScenesReview();
          state.studioScenesReviewsByResponse[proposal.sourceMessageIndex] = proposal;
        }
        state.studioScenesProposal = saved;
        proposal = saved;
      }
      showStudioScenesReview();
      return Promise.resolve({review:true,count:proposal.drafts.length});
    },
    reviewAuthoredScenes: function (launch) {
      if (!launch || !launch.projectId || !Array.isArray(launch.scenes))
        return Promise.reject(new Error('Select a saved Project and authored Scene records.'));
      var drafts = launch.scenes.filter(function (item) {
        return item && typeof item === 'object' && !Array.isArray(item);
      }).map(function (item) {
        return {
          title:typeof item.title === 'string' ? item.title : '',
          prompt:typeof item.prompt === 'string' ? item.prompt : '',
          durationSeconds:item.durationSeconds
        };
      }).filter(function (item) {
        return item.title.trim() || item.prompt.trim() || item.durationSeconds !== undefined;
      });
      if (!drafts.length)
        return Promise.reject(new Error('No usable Scene fields were authored.'));
      var responseIndex = launch.sourceMessageIndex;
      var hasResponse = Number.isInteger(responseIndex) && responseIndex >= 0;
      var signature = JSON.stringify(drafts);
      var existing = state.studioScenesProposal;
      if (existing && hasResponse && existing.sourceMessageIndex === responseIndex &&
          existing.sourceScenesSignature !== signature)
        return Promise.reject(new Error('This response\'s authored Scene material no longer matches the active review.'));
      if (existing && existing.storyId === launch.projectId &&
          hasResponse && existing.sourceMessageIndex === responseIndex &&
          existing.sourceScenesSignature === signature) {
        showStudioScenesReview();
        return Promise.resolve({review:true,count:existing.drafts.length});
      }
      if (existing && !Number.isInteger(existing.sourceMessageIndex))
        return Promise.reject(new Error('An independent Scene review is still open. Finish it before reviewing this response.'));
      var saved = existing && hasResponse && existing.sourceMessageIndex === responseIndex
        ? existing : hasResponse && state.studioScenesReviewsByResponse[responseIndex];
      if (saved && saved.sourceScenesSignature !== signature)
        return Promise.reject(new Error('The saved review does not match this response\'s authored Scene records.'));
      if (saved && saved.storyId === launch.projectId) {
        if (existing && existing !== saved) {
          rememberStudioScenesReview();
          state.studioScenesReviewsByResponse[existing.sourceMessageIndex] = existing;
        }
        state.studioScenesProposal = saved;
        showStudioScenesReview();
        return Promise.resolve({review:true,count:saved.drafts.length});
      }
      return window.flushStudioDirectorStoryEdits(launch.projectId).then(function () {
        return requestJson('/fs/storyboard?story=' + encodeURIComponent(launch.projectId));
      }).then(function (payload) {
        var story = payload && payload.story;
        if (!story || story.id !== launch.projectId)
          throw new Error('The Project is no longer available.');
        if (existing) {
          rememberStudioScenesReview();
          state.studioScenesReviewsByResponse[existing.sourceMessageIndex] = existing;
        }
        state.studioScenesProposal = Object.assign({},saved || {},{
          storyId:story.id,storyTitle:story.title,
          sceneOrder:story.sceneOrder.slice(),scenes:story.scenes,
          drafts:saved ? saved.drafts : drafts,rationale:launch.rationale || '',
          placement:saved && ['start','end'].includes(saved.placement) ? saved.placement : 'end',
          sourceMessageIndex:hasResponse ? responseIndex : null,
          sourceScenesSignature:signature
        });
        showStudioScenesReview();
        studioActionStatus(drafts.length + ' authored Scene' +
          (drafts.length === 1 ? '' : 's') + ' ready for review. Nothing saved.',false);
        return {review:true,count:drafts.length};
      });
    },
    writeNewScene: function (launch) {
      // Each explicit Write is a new model request. Historical draft caches are
      // not an alternative authoring path and never suppress a Write.
      if (!this.isReady()) return Promise.reject(new Error(this.readinessMessage()));
      if (!launch || !launch.projectId || !String(launch.instruction || '').trim())
        return Promise.reject(new Error('A saved Project and agreed new-Scene brief are required.'));
      var storyId = launch.projectId;
      state.lastStudioIoRaw = '';
      state.lastStudioIoError = '';
      state.pending = true;
      syncControls();
      return window.flushStudioDirectorStoryEdits(storyId).then(function () {
        return requestJson('/fs/storyboard?story=' + encodeURIComponent(storyId));
      }).then(function (payload) {
        var story = payload && payload.story;
        if (!story || story.id !== storyId || !Array.isArray(story.sceneOrder) || !story.scenes)
          throw new Error('The selected Project is no longer available.');
        var order = story.sceneOrder.slice();
        var creativeContext = {
          title:story.title,concept:story.concept,style:story.style,
          invariants:story.invariants,
          existingSceneTitles:order.map(function (id) {
            var scene = story.scenes[id];
            return scene && scene.title || '';
          }),
          // Give an explicit Scene Write all saved Scene continuity; never
          // assume the most recent Scene is the only relevant reference.
          existingScenes:order.map(function (id) {
            var scene = story.scenes[id];
            return {id:id,title:scene.title,prompt:scene.prompt,
              durationSeconds:scene.durationSeconds};
          }),
          previousScene:order.length ? (function () {
            var prior = story.scenes[order[order.length - 1]];
            return {title:prior.title,prompt:prior.prompt,durationSeconds:prior.durationSeconds};
          })() : null
        };
        var instruction = JSON.stringify({
          task:'Create the requested independently generatable H3 Scenes for this Project. ' +
            'Give each Scene a useful title, complete H3 Prompt and durationSeconds. ' +
            'Follow the author\'s specified timing. When timing is unspecified, choose a ' +
            'duration that supports the supplied actions, shot transitions and dialogue. ' +
            'Deliver the authored Scenes now.',
          authorDirection:launch.authorRequest || launch.instruction,
          project:creativeContext
        });
        // The model, not an old single-Scene working draft, authors this request.
        state.pending = false;
        return window.studioDirectorBridge.makeProposal(instruction,
          'studio_scenes_draft', true,
          {projectId:storyId,projectTitle:story.title,sceneOrder:order})
        .then(function (raw) {
          state.lastStudioIoRaw = raw;
          // Keep the exact model result inspectable after reload, even if
          // parsing or persistence fails. This is diagnostics, not chat context.
          state.studioWriteIo.push({operation:'studio_scenes_draft',projectId:storyId,
            at:new Date().toISOString(),rawResponse:raw});
          scheduleSessionSave();
          var fields;
          try { fields = JSON.parse(raw); }
          catch (error) { throw new Error('Director returned invalid Scene JSON.\\nRaw response:\\n' + raw); }
          if (!fields || typeof fields !== 'object' || Array.isArray(fields))
            throw new Error('Director returned no Scene object.\\nRaw response:\\n' + raw);
          var records = Array.isArray(fields.scenes) ? fields.scenes : [fields];
          if (!records.length)
            throw new Error('Director returned zero Scenes.\\nRaw response:\\n' + raw);
          // Preserve source order and report incomplete items explicitly. Only
          // fields actually returned can be saved; never fabricate a duration.
          var creations = [], incomplete = [], notMapped = [];
          records.forEach(function (item, index) {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
              incomplete.push('Scene ' + (index + 1) + ': expected an object');
              return;
            }
            var extras = Object.keys(item).filter(function (key) {
              return !['title','prompt','durationSeconds'].includes(key);
            });
            if (extras.length)
              notMapped.push('Scene ' + (index + 1) + ' additional properties in raw I/O: ' + extras.join(', '));
            var title = typeof item.title === 'string' ? item.title : '';
            var prompt = typeof item.prompt === 'string' ? item.prompt : '';
            var duration = item.durationSeconds;
            var problems = [];
            if (!prompt.trim()) problems.push('missing Prompt');
            if (duration === undefined || duration === null || duration === '' ||
                typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0)
              problems.push('missing or unusable durationSeconds');
            if (problems.length) {
              incomplete.push('Scene ' + (index + 1) + ': ' + problems.join(', '));
              return;
            }
            creations.push({title:title,prompt:prompt,durationSeconds:duration});
          });
          if (!creations.length)
            throw new Error('Director returned no Scenes WebCap could save. ' +
              incomplete.join('; ') + '\\nRaw response:\\n' + raw);
          state.pending = true;
          syncControls();
          return requestJson('/fs/studio/director/scenes-draft',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({storyId:storyId,expectedSceneOrder:order,
              scenes:creations,placement:'end',relativeSceneId:''})
          }).then(function (result) {
            if (!result || !result.story || result.story.id !== storyId ||
                !Array.isArray(result.scenes) || result.scenes.length !== creations.length ||
                result.scenes.some(function(item){return !item.id;}))
              throw new Error('Scene save did not confirm the returned Scene records.');
            var saved = result.scenes;
            if (saved.length===1 && state.studioWorkingDraft.newScene.prompt===saved[0].prompt) {
              state.studioWorkingDraft.newScene={};
              if (state.studioWorkingDraft.draftOrigins)
                state.studioWorkingDraft.draftOrigins.newScene=null;
              scheduleSessionSave();
            }
            recordStudioOperation('scenes.create','Created '+saved.length+' Scene(s)',storyId,
              saved.map(function(item){return item.id;}));
            return window.studioDirectorBridge.recordApplied('scenes.create',result.story,{
              scenes:saved.map(function(item){
                return {id:item.id,title:item.title,prompt:item.prompt,
                  durationSeconds:item.durationSeconds};
              })
            }).then(function(){return window.refreshStudioDirectorStoryIfOpen(storyId);})
              .catch(function(error){error.saved=true;throw error;})
              .then(function(){
                studioActionStatus(saved.length+' Scene(s) saved.'+
                  (incomplete.length || notMapped.length
                    ? ' ' + incomplete.concat(notMapped).join('; ') + '. Inspect raw I/O.' : ''),
                  !!(incomplete.length || notMapped.length));
                return result;
              });
          });
        });
      }).catch(function (error) {
        state.lastStudioIoError = String(error.message || error);
        studioActionStatus(error.saved
          ? 'Scenes saved, but recording or refreshing failed: ' + state.lastStudioIoError
          : 'New Scene Write failed: ' + state.lastStudioIoError, true);
        window.reportConsoleError('Director new Scene', error);
        throw error;
      }).finally(function () {
        state.pending = false;
        state.jobId = '';
        syncControls();
      });
    },
    writeSelectedScene: function (launch) {
      if (!this.isReady()) return Promise.reject(new Error(this.readinessMessage()));
      if (!launch || !launch.projectId || !launch.sceneId || !String(launch.instruction || '').trim())
        return Promise.reject(new Error('A specific saved Scene and agreed revision instruction are required.'));
      var storyId = launch.projectId, sceneId = launch.sceneId;
      var fields = Array.isArray(launch.fields) ? launch.fields : [];
      var wantsTitle = fields.includes('title'), wantsDuration = fields.includes('durationSeconds');
      var wantsPrompt = fields.includes('prompt') || !fields.length;
      var requestedFields = (wantsPrompt ? ['prompt'] : [])
        .concat(wantsTitle ? ['title'] : [], wantsDuration ? ['durationSeconds'] : []);
      state.lastStudioIoRaw = '';
      state.lastStudioIoError = '';
      // Lock the launch while flushing/fetching; makeProposal takes over the
      // busy state synchronously once the fresh Scene has been loaded.
      state.pending = true;
      syncControls();
      return window.flushStudioDirectorStoryEdits(storyId).then(function () {
        return requestJson('/fs/storyboard?story=' + encodeURIComponent(storyId));
      }).then(function (payload) {
        var story = payload && payload.story;
        if (!story || story.id !== storyId || !Array.isArray(story.sceneOrder) ||
            !story.sceneOrder.includes(sceneId) || !story.scenes || !story.scenes[sceneId])
          throw new Error('Selected Scene is no longer available in its saved Project.');
        var original = story.scenes[sceneId];
        var baseline = JSON.stringify({
          title:original.title,prompt:original.prompt,durationSeconds:original.durationSeconds
        });
        // An explicit selected-Scene Write always asks the model anew. Saved
        // fields are the authoritative baseline; no Review cache can shortcut it.
        // Explicitly launching revision of this saved Scene authorizes its baseline.
        var context = window.studioDirectorWorkbench.sceneRead(story,sceneId).payload;
        var instruction = JSON.stringify({
          task:'Revise the requested Scene fields in the author\'s direction. ' +
            'Return complete replacement values for requestedFields, including a standalone H3 Prompt ' +
            'when prompt is selected. Preserve all unaffected creative content and fields. ' +
            'Deliver the actual authored values in one JSON object.',
          authorDirection:launch.authorRequest || launch.instruction,
          requestedFields:requestedFields,
          savedScene:context
        });
        state.pending = false;
        return window.studioDirectorBridge.makeProposal(instruction, 'studio_scene_field_draft', wantsPrompt,
          {projectId:storyId,projectTitle:story.title,sceneId:sceneId,
            sceneNumber:story.sceneOrder.indexOf(sceneId)+1,sceneOrder:story.sceneOrder.slice()},
          requestedFields)
          .then(function (raw) {
            state.lastStudioIoRaw = raw;
            state.studioWriteIo.push({operation:'studio_scene_field_draft',projectId:storyId,
              at:new Date().toISOString(),rawResponse:raw});
            scheduleSessionSave();
            var proposed;
            try {proposed = JSON.parse(raw);}
            catch (error) {throw new Error('Director returned invalid Scene JSON.\nRaw response:\n' + raw);}
            if (!proposed || typeof proposed !== 'object' || Array.isArray(proposed))
              throw new Error('Director returned no usable Scene fields.\nRaw response:\n' + raw);
            var extras = {}, missing = [];
            if (wantsTitle) {
              if (typeof proposed.title === 'string')
                extras.title = proposed.title.trim();
              else missing.push('title');
            }
            if (wantsDuration) {
              if (typeof proposed.durationSeconds === 'number' &&
                  Number.isFinite(proposed.durationSeconds) && proposed.durationSeconds > 0)
                extras.durationSeconds = proposed.durationSeconds;
              else missing.push('durationSeconds');
            }
            var prompt = wantsPrompt && typeof proposed.prompt === 'string' && proposed.prompt.trim()
              ? proposed.prompt : null;
            if (wantsPrompt && prompt === null) missing.push('prompt');
            var authored = Object.assign({},extras,prompt !== null ? {prompt:prompt} : {});
            // An explicit Write has no Review cache. Save each mechanically
            // usable requested field and report independently missing fields.
            if (!Object.keys(authored).length)
              throw new Error('Director did not return any usable requested Scene fields.\\nRaw response:\\n' + raw);
            if ((prompt === null || prompt.trim() === String(original.prompt || '').trim()) &&
                (!Object.hasOwn(extras,'title') || extras.title === String(original.title || '').trim()) &&
                (!Object.hasOwn(extras,'durationSeconds') || extras.durationSeconds === original.durationSeconds)) {
              forgetSavedStudioSceneFields(storyId,sceneId,original);
              studioActionStatus('Director returned no Scene changes.' +
                (missing.length ? ' Requested ' + missing.join(' and ') + ' not supplied.' : ''),!!missing.length);
              return null;
            }
            state.pending = true;
            syncControls();
            return window.studioDirectorWorkbench.applyScenePrompt(story, sceneId, prompt, extras)
              .then(function (savedResult) {
                studioActionStatus('Scene ' + (story.sceneOrder.indexOf(sceneId)+1) + ' saved.' +
                   (missing.length ? ' Requested ' + missing.join(' and ') + ' not supplied; inspect raw I/O.' : ''),!!missing.length);
                return savedResult;
              });
          });
      }).then(function (result) {
        if (result && result.story && result.story.id === storyId && result.scene)
          forgetSavedStudioSceneFields(storyId,sceneId,result.scene);
        return result;
      }).catch(function (error) {
        if (error.saved && error.savedScene)
          forgetSavedStudioSceneFields(storyId,sceneId,error.savedScene);
        state.lastStudioIoError = String(error.message || error);
        studioActionStatus(error.saved
          ? 'Scene saved, but refreshing or recording it failed: ' + state.lastStudioIoError
          : 'Scene revision failed: ' + state.lastStudioIoError, true);
        window.reportConsoleError('Director Scene write', error);
        throw error;
      }).finally(function () {
        state.pending = false;
        state.jobId = '';
        syncControls();
      });
    },
    makeProposal: function (instruction, operation, includePromptContract, navigationSnapshot, requiredFields) {
      if (!this.isReady()) return Promise.reject(new Error('Director must be ready to draft.'));
      state.pending = true;
      syncControls();
      startProgress();
      return studioDirectorRequestMessages((state.modeMessages && state.modeMessages.storyboard || []).concat([{role:'user',content:instruction}]), includePromptContract, true, navigationSnapshot).then(function (messages) {
        window.studioDirectorWorkbench.showSentWriteContext(operation || 'studio_scene_field_draft', messages);
        return requestJson('/fs/director/chat', {
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({model:state.modelId,operation:operation || 'studio_scene_field_draft',
            messages:messages,requiredFields:requiredFields || []})
        });
      }).then(function (payload) {
        if (!payload.job || !payload.job.jobId) throw new Error('Director did not queue a draft.');
        state.jobId = payload.job.jobId;
        trackTransientLlmJob(payload.job);
        return waitForJob(payload.job);
      }).then(function (job) {
        var result = job.result || {};
        if (!String(result.text || '').trim()) throw new Error('Director returned no draft.');
        finishProgress(null);
        return String(result.text);
      }).catch(function (err) {
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
