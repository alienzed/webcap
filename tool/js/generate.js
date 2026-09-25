(function () {
  'use strict';

  var generateState = {
    models: [],
    unavailableModels: [],
    modelId: window.localStorage.getItem('webcap.generate.model') || '',
    lorasByModel: {},
    director: {
      models: [],
      modelId: '',
      available: false,
      busy: false,
      previousPrompt: null,
      status: '',
      activityTimer: 0,
      activityStartedAt: 0,
      activityHistory: [],
      activityLastMemory: null,
      activityLoadBaseline: null,
      activityLoadModelId: ''
    },
    trackedJobIds: loadTrackedGenerateJobs(),
    results: [],
    viewMode: window.localStorage.getItem('webcap.generate.viewMode') === 'library' ? 'library' : 'create',
    activeResultKey: '',
    activePendingJobId: '',
    takesCollapsed: window.localStorage.getItem('webcap.generate.takesCollapsed') === '1',
    open: false,
    timer: 0
  };

  function el(id) { return document.getElementById(id); }

  function requestJson(url, options) {
    return fetch(url, options || {}).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.ok === false) {
          throw new Error((payload && payload.error) || 'Generate request failed.');
        }
        return payload;
      });
    });
  }

  function postJson(url, payload) {
    return requestJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
  }

  function currentModel() {
    return generateState.models.find(function (model) {
      return String(model.id) === String(generateState.modelId);
    }) || null;
  }

  function reportError(err, uiMessage) {
    var message = String(err && err.message ? err.message : err);
    if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Generate', message);
    else console.error('[Generate]', err);
    if (uiMessage) setStatus(uiMessage, 'error');
  }

  function conciseGenerateError(err, fallback) {
    var message = String(err && err.message ? err.message : err);
    if (/ComfyUI|127\\.0\\.0\\.1[^\\n]*8188|port 8188/i.test(message)) return 'ComfyUI unavailable';
    if (message === 'Choose a Base Model.') return 'Choose a Base Model';
    if (message === 'Enter a generation prompt.') return 'Prompt required';
    return String(fallback || 'Generation failed');
  }

  function setStatus(message, tone) {
    var status = el('generate-status');
    if (!status) return;
    var text = String(message || '').trim();
    status.textContent = text;
    status.classList.toggle('hidden', !text);
    status.classList.toggle('is-error', tone === 'error');
    status.title = tone === 'error' ? 'See Console for details.' : '';
  }

  function loadTrackedGenerateJobs() {
    try {
      var parsed = JSON.parse(window.localStorage.getItem('webcap.generate.trackedJobs') || '[]');
      return Array.isArray(parsed)
        ? parsed.map(function (value) { return String(value || '').trim(); }).filter(Boolean)
        : [];
    } catch (_err) {
      return [];
    }
  }

  function saveTrackedGenerateJobs() {
    window.localStorage.setItem('webcap.generate.trackedJobs', JSON.stringify(generateState.trackedJobIds || []));
  }

  function trackGenerateJob(jobId) {
    var id = String(jobId || '').trim();
    if (!id || generateState.trackedJobIds.indexOf(id) !== -1) return;
    generateState.trackedJobIds.push(id);
    saveTrackedGenerateJobs();
  }

  function untrackGenerateJob(jobId) {
    var id = String(jobId || '').trim();
    var before = generateState.trackedJobIds.length;
    generateState.trackedJobIds = generateState.trackedJobIds.filter(function (value) { return value !== id; });
    if (generateState.trackedJobIds.length !== before) saveTrackedGenerateJobs();
  }

  function savedLoras(modelId) {
    if (generateState.lorasByModel[modelId]) return generateState.lorasByModel[modelId];
    try {
      var parsed = JSON.parse(window.localStorage.getItem('webcap.generate.loras.' + modelId) || '[]');
      generateState.lorasByModel[modelId] = Array.isArray(parsed) ? parsed : [];
    } catch (_err) {
      generateState.lorasByModel[modelId] = [];
    }
    return generateState.lorasByModel[modelId];
  }

  function saveLoras() {
    var id = String(generateState.modelId || '');
    window.localStorage.setItem('webcap.generate.loras.' + id, JSON.stringify(savedLoras(id)));
  }

  function populateModelSelector() {
    var select = el('generate-model');
    if (!select) return;
    select.innerHTML = generateState.models.map(function (model) {
      return '<option value="' + escapeHtml(model.id) + '">' + escapeHtml(model.label) + '</option>';
    }).join('');
    var selected = generateState.models.some(function (model) { return model.id === generateState.modelId; })
      ? generateState.modelId
      : String((generateState.models.find(function (model) { return model.default; }) || generateState.models[0] || {}).id || '');
    generateState.modelId = selected;
    select.value = selected;
    window.localStorage.setItem('webcap.generate.model', selected);
    renderModelForm();
  }

  function fieldVisible(name) {
    var model = currentModel();
    return !!model && Array.isArray(model.settings) && model.settings.indexOf(name) !== -1;
  }

  function renderModelForm() {
    var model = currentModel();
    if (!model) return;

    ['aspectRatio', 'megapixels', 'duration', 'dimensions', 'seed'].forEach(function (name) {
      var node = el('generate-field-' + name);
      if (node) node.classList.toggle('hidden', !fieldVisible(name));
    });

    var aspect = el('generate-aspect');
    if (aspect) {
      var aspects = (model.settingOptions && model.settingOptions.aspectRatio) || [];
      aspect.innerHTML = aspects.map(function (value) {
        return '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + '</option>';
      }).join('');
      aspect.value = String((model.defaultSettings || {}).aspectRatio || '');
    }

    var dimensions = el('generate-dimensions');
    if (dimensions) {
      var options = (model.settingOptions && model.settingOptions.dimensions) || [];
      dimensions.innerHTML = options.map(function (value) {
        return '<option value="' + escapeHtml(value) + '">' + escapeHtml(String(value).trim()) + '</option>';
      }).join('');
      dimensions.value = String((model.defaultSettings || {}).dimensions || '');
    }

    if (el('generate-megapixels')) el('generate-megapixels').value = String((model.defaultSettings || {}).megapixels || '');
    if (el('generate-duration')) el('generate-duration').value = String((model.defaultSettings || {}).duration || '');
    if (el('generate-seed')) el('generate-seed').value = '-1';

    var prompt = el('generate-prompt');
    var promptStorageKey = 'webcap.generate.prompt.' + model.id;
    var savedPrompt = window.localStorage.getItem(promptStorageKey);
    if (savedPrompt === 'Storyboard prompt is injected at runtime.') {
      window.localStorage.removeItem(promptStorageKey);
      savedPrompt = null;
    }
    if (prompt && (!prompt.value.trim() || prompt.dataset.modelId !== model.id)) {
      prompt.value = savedPrompt !== null ? savedPrompt : String(model.defaultPrompt || '');
      prompt.dataset.modelId = model.id;
    }

    var list = el('generate-lora-options');
    if (list) {
      list.innerHTML = (model.loras || []).map(function (name) {
        return '<option value="' + escapeHtml(name) + '"></option>';
      }).join('');
    }

    var referencePanel = el('generate-references');
    if (referencePanel) referencePanel.classList.toggle('hidden', !(model.references || []).length);
    ['first_frame', 'last_frame'].forEach(function (role) {
      var field = el('generate-reference-' + role + '-field');
      if (field) field.classList.toggle('hidden', (model.references || []).indexOf(role) === -1);
    });

    var base = el('generate-base-loras');
    if (base) {
      base.textContent = (model.baseLoras || []).length
        ? 'Required workflow LoRA: ' + model.baseLoras.join(', ')
        : 'No required workflow LoRAs.';
    }
    renderLoras();
  }

  function renderLoras() {
    var host = el('generate-lora-list');
    if (!host) return;
    var items = savedLoras(String(generateState.modelId || ''));
    if (!items.length) {
      host.innerHTML = '<div class="generate-empty-inline">No added LoRAs.</div>';
      return;
    }
    host.innerHTML = items.map(function (item, index) {
      return '<div class="generate-lora-row" data-generate-lora-index="' + index + '">' +
        '<span title="' + escapeHtml(item.name) + '">' + escapeHtml(item.name) + '</span>' +
        '<input type="number" min="-2" max="2" step="0.05" value="' + escapeHtml(String(item.strength)) + '" data-generate-lora-strength="' + index + '" aria-label="LoRA strength">' +
        '<button type="button" class="review-captions-btn" data-generate-lora-remove="' + index + '">Remove</button>' +
      '</div>';
    }).join('');
  }

  function addLora() {
    var input = el('generate-lora-picker');
    var name = String(input && input.value || '').trim();
    if (!name) return;
    var model = currentModel();
    if (!model || (model.loras || []).indexOf(name) === -1) {
      throw new Error('Choose an available LoRA.');
    }
    var items = savedLoras(model.id);
    if (items.some(function (item) { return item.name === name; })) {
      throw new Error('That LoRA is already added.');
    }
    items.push({ name: name, strength: 0.9 });
    input.value = '';
    saveLoras();
    renderLoras();
  }

  function collectSettings() {
    var settings = {};
    if (fieldVisible('aspectRatio')) settings.aspectRatio = el('generate-aspect').value;
    if (fieldVisible('megapixels')) settings.megapixels = el('generate-megapixels').value;
    if (fieldVisible('duration')) settings.duration = el('generate-duration').value;
    if (fieldVisible('dimensions')) settings.dimensions = el('generate-dimensions').value;
    if (fieldVisible('seed')) settings.seed = el('generate-seed').value;
    return settings;
  }

  function uploadReference(file) {
    var body = new FormData();
    body.append('file', file);
    return requestJson('/fs/generate/reference', { method: 'POST', body: body }).then(function (payload) {
      return payload.reference.path;
    });
  }

  function cleanupUploadedReferences(paths) {
    var values = Array.isArray(paths) ? paths.filter(Boolean) : [];
    if (!values.length) return Promise.resolve();
    return postJson('/fs/generate/reference/cleanup', { paths: values }).catch(function (err) {
      if (typeof window.reportConsoleError === 'function') {
        window.reportConsoleError(
          'Generate',
          'Could not clean abandoned Generate reference uploads: ' +
            String(err && err.message ? err.message : err)
        );
      }
    });
  }

  function collectReferences() {
    var model = currentModel();
    var references = {};
    var uploadedPaths = [];
    var roles = (model && model.references || []).slice();
    var chain = Promise.resolve();

    roles.forEach(function (role) {
      var input = el('generate-reference-' + role);
      var file = input && input.files && input.files[0];
      if (!file) return;
      chain = chain.then(function () {
        return uploadReference(file).then(function (path) {
          references[role] = path;
          uploadedPaths.push(path);
        });
      });
    });

    return chain.then(function () {
      return references;
    }).catch(function (err) {
      return cleanupUploadedReferences(uploadedPaths).then(function () {
        throw err;
      });
    });
  }

  function runGenerate() {
    var model = currentModel();
    var prompt = String(el('generate-prompt').value || '').trim();
    if (!model) throw new Error('Choose a Base Model.');
    if (!prompt) throw new Error('Enter a generation prompt.');
    var button = el('generate-run-btn');
    button.disabled = true;
    setStatus('Preparing generation…');

    return collectReferences().then(function (references) {
      return postJson('/fs/generate', {
        modelId: model.id,
        prompt: prompt,
        settings: collectSettings(),
        wildcardsEnabled: !!el('generate-wildcards').checked,
        loras: savedLoras(model.id),
        references: references
      });
    }).then(function (payload) {
      trackGenerateJob(payload.job && payload.job.jobId);
      syncGenerationPreviewCard(payload.job);
      var submittedStatus = String(payload.job && payload.job.status || '');
      setStatus(
        submittedStatus === 'backlog'
          ? 'Added to backlog.'
          : ('Queued' + (payload.job.queuePosition ? ' · #' + payload.job.queuePosition : '') + '.')
      );
      if (typeof window.refreshInferenceQueue === 'function') window.refreshInferenceQueue();
      return typeof window.refreshInferenceQueue === 'function' ? window.refreshInferenceQueue() : null;
    }).catch(function (err) {
      reportError(err, conciseGenerateError(err, 'Generation failed'));
    }).then(function () {
      button.disabled = false;
    });
  }


  function setGenerateViewMode(mode) {
    mode = mode === 'library' ? 'library' : 'create';
    generateState.viewMode = mode;
    window.localStorage.setItem('webcap.generate.viewMode', mode);
    var createView = el('generate-create-view');
    var libraryView = el('generate-library-view');
    var createButton = el('generate-create-mode-btn');
    var libraryButton = el('generate-library-mode-btn');
    if (!createView || !libraryView || !createButton || !libraryButton) {
      throw new Error('Generations view switcher markup is missing.');
    }
    createView.classList.toggle('hidden', mode !== 'create');
    libraryView.classList.toggle('hidden', mode !== 'library');
    createButton.classList.toggle('active', mode === 'create');
    libraryButton.classList.toggle('active', mode === 'library');
    createButton.setAttribute('aria-pressed', mode === 'create' ? 'true' : 'false');
    libraryButton.setAttribute('aria-pressed', mode === 'library' ? 'true' : 'false');
  }

  function setTakesCollapsed(collapsed) {
    generateState.takesCollapsed = !!collapsed;
    window.localStorage.setItem('webcap.generate.takesCollapsed', generateState.takesCollapsed ? '1' : '0');
    var createView = el('generate-create-view');
    var button = el('generate-takes-collapse-btn');
    if (!createView || !button) throw new Error('Generations Takes controls are missing.');
    createView.classList.toggle('takes-collapsed', generateState.takesCollapsed);
    button.textContent = generateState.takesCollapsed ? 'Show' : 'Hide';
    button.title = generateState.takesCollapsed ? 'Show Takes' : 'Collapse Takes';
    button.setAttribute('aria-expanded', generateState.takesCollapsed ? 'false' : 'true');
  }

  function resultSummary(result) {
    var settings = result && result.settings || {};
    var summary = [];
    if (settings.dimensions) summary.push(String(settings.dimensions).trim());
    if (settings.aspectRatio) summary.push(String(settings.aspectRatio));
    if (settings.duration) summary.push(String(settings.duration) + 's');
    if (result && result.seed !== undefined && result.seed !== null) summary.push('Seed ' + result.seed);
    return summary.join(' · ');
  }

  function resultMediaElement(result, controls) {
    var src = '/fs/generate/media?path=' + encodeURIComponent(result.mediaPath || '');
    if (result.mediaKind === 'video') {
      var video = document.createElement('video');
      video.controls = !!controls;
      video.muted = !controls;
      video.preload = 'metadata';
      video.src = src;
      return video;
    }
    var image = document.createElement('img');
    image.loading = controls ? 'eager' : 'lazy';
    image.src = src;
    image.alt = '';
    return image;
  }

  function renderActiveResult(result) {
    var host = el('generate-active-preview');
    var summary = el('generate-stage-summary');
    if (!host || !summary) throw new Error('Generations active preview markup is missing.');
    var key = resultKey(result);
    if (!key) throw new Error('Generate result is missing its stable identity.');
    generateState.activeResultKey = key;
    generateState.activePendingJobId = '';
    summary.textContent = [String(result.modelId || 'Generated'), resultSummary(result)].filter(Boolean).join(' · ');

    if (String(host.dataset.resultKey || '') === key) return;
    host.innerHTML = '';
    host.dataset.resultKey = key;
    host.removeAttribute('data-generation-job-id');

    var media = document.createElement('div');
    media.className = 'generate-stage-media';
    media.appendChild(resultMediaElement(result, true));

    var caption = document.createElement('div');
    caption.className = 'generate-stage-caption';
    var prompt = document.createElement('p');
    prompt.textContent = String(result.resolvedPrompt || result.sourcePrompt || '');
    prompt.title = prompt.textContent;
    caption.appendChild(prompt);

    host.appendChild(media);
    host.appendChild(caption);
    syncActiveTakeState();
  }

  function renderPendingStage(job) {
    var host = el('generate-active-preview');
    var summary = el('generate-stage-summary');
    if (!host || !summary) throw new Error('Generations active preview markup is missing.');
    var jobId = String(job && job.jobId || '');
    if (!jobId) throw new Error('Generate inference job is missing its job ID.');
    generateState.activePendingJobId = jobId;
    generateState.activeResultKey = '';
    summary.textContent = [String(job.modelId || 'Generate'), generationPreviewStatus(job)].filter(Boolean).join(' · ');

    if (String(host.dataset.generationJobId || '') !== jobId) {
      host.innerHTML = '';
      host.removeAttribute('data-result-key');
      host.dataset.generationJobId = jobId;
      var pending = document.createElement('div');
      pending.className = 'generate-stage-pending';
      pending.innerHTML = '<div class="generate-result-pending-indicator" aria-hidden="true"></div><strong data-generation-stage-status></strong><span>Your Take will appear here when it is ready.</span>';
      host.appendChild(pending);
    }
    var statusNode = host.querySelector('[data-generation-stage-status]');
    if (statusNode) statusNode.textContent = generationPreviewStatus(job);
  }

  function renderStageEmpty() {
    var host = el('generate-active-preview');
    var summary = el('generate-stage-summary');
    if (!host || !summary) throw new Error('Generations active preview markup is missing.');
    if (generateState.activePendingJobId || generateState.activeResultKey) return;
    host.innerHTML = '<div class="generate-stage-empty"><strong>Ready to create</strong><span>Generate something or choose a Take.</span></div>';
    host.removeAttribute('data-result-key');
    host.removeAttribute('data-generation-job-id');
    summary.textContent = 'Your active Take appears here.';
  }

  function syncActiveTakeState() {
    var host = el('generate-takes');
    if (!host) throw new Error('Generations Takes markup is missing.');
    host.querySelectorAll('[data-generate-take-key]').forEach(function (card) {
      card.classList.toggle('active', String(card.dataset.generateTakeKey || '') === String(generateState.activeResultKey || ''));
    });
  }

  function buildTakeCard(result) {
    var key = resultKey(result);
    var card = document.createElement('button');
    card.type = 'button';
    card.className = 'generate-take-card';
    card.dataset.generateTakeKey = key;
    card.title = String(result.resolvedPrompt || result.sourcePrompt || '');

    var media = document.createElement('span');
    media.className = 'generate-take-media';
    media.appendChild(resultMediaElement(result, false));

    var copy = document.createElement('span');
    copy.className = 'generate-take-copy';
    var model = document.createElement('strong');
    model.textContent = String(result.modelId || 'Generated');
    var details = document.createElement('small');
    details.textContent = resultSummary(result);
    copy.appendChild(model);
    copy.appendChild(details);

    card.appendChild(media);
    card.appendChild(copy);
    return card;
  }

  function renderTakes(results) {
    var host = el('generate-takes');
    var summary = el('generate-takes-summary');
    if (!host || !summary) throw new Error('Generations Takes markup is missing.');
    var items = Array.isArray(results) ? results : [];
    summary.textContent = items.length ? String(items.length) + ' recent' : 'No Takes yet';

    var desired = {};
    items.forEach(function (result) {
      desired[resultKey(result)] = result;
    });
    host.querySelectorAll('.generate-take-card[data-generate-take-key]').forEach(function (card) {
      if (!desired[String(card.dataset.generateTakeKey || '')]) card.remove();
    });

    var pendingCards = host.querySelectorAll('.generate-take-card.is-pending');
    var anchor = pendingCards.length ? pendingCards[pendingCards.length - 1].nextSibling : host.firstChild;
    items.forEach(function (result) {
      var key = resultKey(result);
      if (!key) return;
      var card = Array.prototype.find.call(
        host.querySelectorAll('.generate-take-card[data-generate-take-key]'),
        function (candidate) { return String(candidate.dataset.generateTakeKey || '') === key; }
      );
      if (!card) card = buildTakeCard(result);
      host.insertBefore(card, anchor);
      anchor = card.nextSibling;
    });

    if (!generateState.activeResultKey && !generateState.activePendingJobId && items.length) {
      renderActiveResult(items[0]);
    } else {
      syncActiveTakeState();
    }
  }

  function generationPreviewStatus(job) {
    var status = String(job && job.status || '');
    var queuePosition = Number(job && job.queuePosition || 0);
    if (status === 'backlog') return 'Backlog';
    if (status === 'queued') return 'Queued' + (queuePosition ? ' · #' + queuePosition : '');
    if (status === 'starting') return 'Starting…';
    if (status === 'stopping') return 'Stopping…';
    return 'Generating…';
  }

  function generationPreviewCard(jobId) {
    var host = el('generate-takes');
    if (!host) throw new Error('Generations Takes markup is missing.');
    var wanted = String(jobId || '');
    var cards = host.querySelectorAll('.generate-take-card.is-pending[data-generation-job-id]');
    for (var index = 0; index < cards.length; index += 1) {
      if (String(cards[index].dataset.generationJobId || '') === wanted) return cards[index];
    }
    return null;
  }

  function removeGenerationPreviewCard(jobId) {
    var card = generationPreviewCard(jobId);
    if (card) card.remove();
    if (String(generateState.activePendingJobId || '') === String(jobId || '')) {
      generateState.activePendingJobId = '';
      renderStageEmpty();
    }
  }

  function syncGenerationPreviewCard(job) {
    var host = el('generate-takes');
    var jobId = String(job && job.jobId || '');
    if (!host) throw new Error('Generations Takes markup is missing.');
    if (!jobId) throw new Error('Generate inference job is missing its job ID.');

    var status = String(job.status || '');
    if (['backlog', 'queued', 'starting', 'running', 'stopping'].indexOf(status) === -1) {
      removeGenerationPreviewCard(jobId);
      return;
    }

    var card = generationPreviewCard(jobId);
    if (!card) {
      card = document.createElement('button');
      card.type = 'button';
      card.className = 'generate-take-card is-pending';
      card.dataset.generationJobId = jobId;

      var mediaHost = document.createElement('span');
      mediaHost.className = 'generate-take-media generate-result-pending-media';
      var indicator = document.createElement('span');
      indicator.className = 'generate-result-pending-indicator';
      indicator.setAttribute('aria-hidden', 'true');
      mediaHost.appendChild(indicator);

      var copy = document.createElement('span');
      copy.className = 'generate-take-copy';
      var model = document.createElement('strong');
      model.dataset.generationPreviewModel = '1';
      var details = document.createElement('small');
      details.dataset.generationPreviewStatus = '1';
      copy.appendChild(model);
      copy.appendChild(details);

      card.appendChild(mediaHost);
      card.appendChild(copy);
      host.insertBefore(card, host.firstChild);
    }

    var statusText = generationPreviewStatus(job);
    var statusNode = card.querySelector('[data-generation-preview-status]');
    var modelNode = card.querySelector('[data-generation-preview-model]');
    if (statusNode) statusNode.textContent = statusText;
    if (modelNode) modelNode.textContent = String(job.modelId || 'Generate');

    renderPendingStage(job);
  }


  function refreshTrackedGenerateJobs() {
    var ids = (generateState.trackedJobIds || []).slice();
    if (!ids.length) return Promise.resolve([]);

    return Promise.all(ids.map(function (jobId) {
      return requestJson('/fs/inference?job=' + encodeURIComponent(jobId) + '&consume=1').then(function (payload) {
        return payload.job || null;
      }).catch(function (err) {
        return { jobId: jobId, status: 'missing', error: String(err && err.message ? err.message : err) };
      });
    })).then(function (jobs) {
      var refreshResultsNeeded = false;
      jobs.forEach(function (job) {
        if (!job) return;
        var jobId = String(job.jobId || '');
        var status = String(job.status || '');
        syncGenerationPreviewCard(job);
        if (['completed', 'failed', 'interrupted', 'cancelled', 'stopped', 'missing'].indexOf(status) === -1) return;

        untrackGenerateJob(jobId);
        if (status === 'completed') {
          refreshResultsNeeded = true;
          if (generateState.open) setStatus('Generation complete.');
          return;
        }
        if (status === 'failed' || status === 'interrupted') {
          var generationError = new Error(
            'Generation ' + status + (job.error ? ': ' + job.error : '.')
          );
          reportError(generationError, conciseGenerateError(generationError, status === 'failed' ? 'Generation failed' : 'Generation interrupted'));
          return;
        }
        if (status === 'missing') {
          var warning = 'Tracked generation job ' + jobId + ' is no longer available in the execution queue.';
          if (typeof window.reportConsoleWarning === 'function') window.reportConsoleWarning('Generate', warning);
          else console.warn('[Generate]', warning);
          return;
        }
        if (generateState.open) setStatus('Generation ' + status + '.');
      });
      return refreshResultsNeeded ? refreshResults() : jobs;
    });
  }

  function resultKey(result) {
    return String(result && (result.jobId || result.mediaPath || result.manifestPath) || '');
  }

  function buildResultCard(result) {
    var card = document.createElement('article');
    card.className = 'generate-result-card';
    card.dataset.resultKey = resultKey(result);

    var mediaHost = document.createElement('div');
    mediaHost.className = 'generate-result-media';
    var src = '/fs/generate/media?path=' + encodeURIComponent(result.mediaPath || '');
    if (result.mediaKind === 'video') {
      var video = document.createElement('video');
      video.controls = true;
      video.preload = 'metadata';
      video.src = src;
      mediaHost.appendChild(video);
    } else {
      var image = document.createElement('img');
      image.loading = 'lazy';
      image.src = src;
      image.alt = '';
      mediaHost.appendChild(image);
    }

    var settings = result.settings || {};
    var summary = [];
    if (settings.dimensions) summary.push(String(settings.dimensions).trim());
    if (settings.aspectRatio) summary.push(settings.aspectRatio);
    if (settings.duration) summary.push(settings.duration + 's');
    if (result.seed !== undefined && result.seed !== null) summary.push('Seed ' + result.seed);

    var footer = document.createElement('div');
    footer.className = 'generate-result-footer';
    var model = document.createElement('strong');
    model.textContent = String(result.modelId || 'Generated');
    var details = document.createElement('span');
    details.textContent = summary.join(' · ');
    var prompt = document.createElement('p');
    prompt.title = String(result.resolvedPrompt || '');
    prompt.textContent = String(result.resolvedPrompt || '');

    var actions = document.createElement('div');
    actions.className = 'generate-result-actions';

    var openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'review-captions-btn';
    openButton.textContent = 'Open';
    openButton.dataset.generateOpenResultKey = resultKey(result);

    var deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'review-captions-btn generate-result-delete';
    deleteButton.textContent = 'Delete';
    deleteButton.dataset.generateDeleteStorageId = String(result.storageId || '');

    actions.appendChild(openButton);
    actions.appendChild(deleteButton);

    footer.appendChild(model);
    footer.appendChild(details);
    footer.appendChild(prompt);
    footer.appendChild(actions);
    card.appendChild(mediaHost);
    card.appendChild(footer);
    return card;
  }

  function renderResults(results) {
    var host = el('generate-results');
    var librarySummary = el('generate-library-summary');
    if (!host || !librarySummary) throw new Error('Generations Library markup is missing.');
    var items = Array.isArray(results) ? results : [];
    generateState.results = items;
    librarySummary.textContent = items.length ? String(items.length) + ' generated item' + (items.length === 1 ? '' : 's') : 'No generated media yet';

    var desired = {};
    items.forEach(function (result) { desired[resultKey(result)] = result; });
    host.querySelectorAll('.generate-result-card[data-result-key]').forEach(function (card) {
      if (!desired[String(card.dataset.resultKey || '')]) card.remove();
    });

    var existingKeys = {};
    host.querySelectorAll('.generate-result-card[data-result-key]').forEach(function (card) {
      existingKeys[String(card.dataset.resultKey || '')] = true;
    });

    var empty = host.querySelector('.generate-results-empty');
    if (items.length && empty) empty.remove();

    items.slice().reverse().forEach(function (result) {
      var key = resultKey(result);
      if (!key || existingKeys[key]) return;
      host.insertBefore(buildResultCard(result), host.firstChild);
      existingKeys[key] = true;
    });

    if (!items.length && !host.querySelector('.generate-result-card') && !host.querySelector('.generate-results-empty')) {
      empty = document.createElement('div');
      empty.className = 'generate-results-empty';
      empty.textContent = 'Generated media will appear here.';
      host.appendChild(empty);
    }

    renderTakes(items.slice(0, 12));
    if (generateState.activePendingJobId) {
      var completed = items.find(function (result) {
        return String(result.jobId || '') === String(generateState.activePendingJobId || '');
      });
      if (completed) renderActiveResult(completed);
    } else if (generateState.activeResultKey) {
      var selected = items.find(function (result) {
        return resultKey(result) === generateState.activeResultKey;
      });
      if (selected) renderActiveResult(selected);
      else {
        generateState.activeResultKey = '';
        if (items.length) renderActiveResult(items[0]);
        else renderStageEmpty();
      }
    } else if (items.length) {
      renderActiveResult(items[0]);
    } else {
      renderStageEmpty();
    }
  }

  function refreshResults() {
    return requestJson('/fs/generate/results?limit=60').then(function (payload) {
      renderResults(payload.results || []);
      return payload.results || [];
    }).catch(function (err) {
      reportError(err);
      return generateState.results;
    });
  }

  function directorJobRequest(jobId) {
    return requestJson('/fs/director/job?job=' + encodeURIComponent(jobId) + '&consume=1').then(function (payload) {
      if (!payload.job) throw new Error('Prompt Assistant job response is missing its job.');
      return payload.job;
    });
  }

  function waitForDirectorJob(job) {
    if (!job || !job.jobId) throw new Error('Prompt Assistant did not return a queued job.');
    function poll(current) {
      var status = String(current.status || '');
      if (status === 'completed') return Promise.resolve(current.result || {});
      if (['failed', 'cancelled', 'stopped', 'interrupted'].indexOf(status) !== -1) {
        throw new Error(current.error || ('Prompt Assistant job ' + status + '.'));
      }
      return new Promise(function (resolve) { setTimeout(resolve, 750); }).then(function () {
        return directorJobRequest(current.jobId);
      }).then(poll);
    }
    return poll(job);
  }

  function queueDirectorRequest(payload) {
    return postJson('/fs/generate/director', payload).then(function (response) {
      return waitForDirectorJob(response.job);
    });
  }

  function directorPhaseLabel(phase) {
    var labels = {
      queued: 'Queued…',
      preparing: 'Preparing…',
      freeing_comfy: 'Preparing GPU…',
      loading_model: 'Loading model…',
      generating: 'Generating response…',
      complete: 'Complete',
      error: 'Failed'
    };
    return labels[String(phase || '')] || 'Working…';
  }

  function directorMemoryGiB(mib) {
    var value = Number(mib);
    return isFinite(value) && value >= 0 ? (value / 1024).toFixed(1) + ' GiB' : '';
  }

  function directorBytesGiB(bytes) {
    var value = Number(bytes);
    return isFinite(value) && value >= 0 ? (value / (1024 * 1024 * 1024)).toFixed(1) + ' GiB' : '';
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

  function updateDirectorModelLoad(activity, system) {
    var meter = el('generate-director-model-load');
    var label = el('generate-director-model-load-label');
    var fill = el('generate-director-model-load-fill');
    if (!meter || !label || !fill) return;

    var phase = String(activity && activity.phase || '');
    var sample = directorMemorySample(system);
    if (phase !== 'loading_model') {
      meter.classList.add('hidden');
      if (sample) generateState.director.activityLastMemory = sample;
      if (phase === 'preparing' || phase === 'queued' || phase === 'freeing_comfy') {
        generateState.director.activityLoadBaseline = null;
        generateState.director.activityLoadModelId = '';
      }
      return;
    }

    var modelId = String(activity && activity.model || '');
    if (generateState.director.activityLoadModelId !== modelId) {
      generateState.director.activityLoadModelId = modelId;
      generateState.director.activityLoadBaseline = generateState.director.activityLastMemory || sample;
    } else if (!generateState.director.activityLoadBaseline && sample) {
      generateState.director.activityLoadBaseline = generateState.director.activityLastMemory || sample;
    }

    var track = meter.querySelector('.director-model-load-track');
    var modelSizeBytes = Number(activity && activity.modelSizeBytes);
    var baseline = generateState.director.activityLoadBaseline;
    meter.classList.remove('hidden');

    if (!sample || !baseline) {
      label.textContent = 'Waiting for memory sample…';
      fill.style.width = '0%';
      if (track) track.removeAttribute('aria-valuenow');
      meter.title = 'Waiting for a RAM / VRAM sample before estimating Director model residency.';
      return;
    }

    if (!isFinite(modelSizeBytes) || modelSizeBytes <= 0) {
      label.textContent = 'Model size unavailable';
      fill.style.width = '0%';
      if (track) track.removeAttribute('aria-valuenow');
      meter.title = 'llama.cpp did not expose a usable size for the selected model. WebCap does not scan the model directory to estimate it.';
      return;
    }

    var ramDelta = Math.max(0, sample.ramBytes - baseline.ramBytes);
    var vramDelta = Math.max(0, sample.vramBytes - baseline.vramBytes);
    var residentBytes = Math.max(0, ramDelta + vramDelta);
    var displayBytes = Math.min(modelSizeBytes, residentBytes);
    var percent = Math.max(0, Math.min(100, residentBytes / modelSizeBytes * 100));
    label.textContent = '≈ ' + directorBytesGiB(displayBytes) + ' / ' + directorBytesGiB(modelSizeBytes) + ' · ~' + Math.round(percent) + '%';
    fill.style.width = percent.toFixed(1) + '%';
    if (track) track.setAttribute('aria-valuenow', String(Math.round(percent)));
    meter.title = 'Approximate model residency from RAM + VRAM growth since loading began. mmap, caching, and GPU offload can make this differ from the GGUF file size.';
  }

  function directorTrendPath(history, key) {
    var path = '';
    var cutoff = Date.now() - 60000;
    history.forEach(function (sample, index) {
      var value = sample[key];
      if (!isFinite(value)) return;
      var x = Math.max(0, Math.min(120, (sample.time - cutoff) / 60000 * 120));
      var y = 28 - Math.max(0, Math.min(100, value)) * 0.26;
      path += (path ? ' L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    });
    return path;
  }

  function updateDirectorTrend(system) {
    var graph = el('generate-director-activity-trend');
    if (!graph) throw new Error('Prompt Assistant memory history markup is missing.');
    var gpu = system && system.gpu;
    var primary = gpu && gpu.available && Array.isArray(gpu.gpus) ? gpu.gpus[0] : null;
    var ram = system && system.ram;
    var vramPercent = primary ? Number(primary.memoryUsed) / Number(primary.memoryTotal) * 100 : NaN;
    var ramPercent = ram && ram.available ? Number(ram.used) / Number(ram.total) * 100 : NaN;
    if (isFinite(vramPercent) && isFinite(ramPercent)) {
      generateState.director.activityHistory.push({ time: Date.now(), ram: ramPercent, vram: vramPercent });
      if (generateState.director.activityHistory.length > 40) generateState.director.activityHistory.shift();
    }
    var cutoff = Date.now() - 60000;
    while (generateState.director.activityHistory.length && generateState.director.activityHistory[0].time < cutoff) generateState.director.activityHistory.shift();
    var history = generateState.director.activityHistory;
    graph.querySelector('.director-activity-trend-ram-line').setAttribute('d', directorTrendPath(history, 'ram'));
    graph.querySelector('.director-activity-trend-vram-line').setAttribute('d', directorTrendPath(history, 'vram'));
    var latest = history[history.length - 1];
    graph.setAttribute('aria-label', latest
      ? 'RAM and VRAM use history for the last minute. Latest: RAM ' + Math.round(latest.ram) + '%, VRAM ' + Math.round(latest.vram) + '%. ' + history.length + ' samples.'
      : 'RAM and VRAM history, waiting for samples');
  }

  function positionDirectorActivity() {
    var card = el('generate-director-activity');
    var panel = card && card.closest('.generate-prompt-panel');
    var target = el('generate-prompt');
    if (!card || !panel || !target || card.classList.contains('hidden')) return;
    var panelRect = panel.getBoundingClientRect();
    var targetRect = target.getBoundingClientRect();
    var inset = 7;
    card.style.left = Math.round(targetRect.left - panelRect.left + inset) + 'px';
    card.style.top = Math.round(targetRect.top - panelRect.top + inset) + 'px';
    card.style.width = Math.round(Math.max(260, targetRect.width - inset * 2)) + 'px';
    card.style.height = Math.round(Math.max(110, targetRect.height - inset * 2)) + 'px';
  }

  function renderDirectorActivity(activity, system) {
    var card = el('generate-director-activity');
    var phase = el('generate-director-activity-phase');
    var detail = el('generate-director-activity-detail');
    if (!card || !phase || !detail) throw new Error('Prompt Assistant activity markup is missing.');

    var terminal = activity && ['complete', 'error'].indexOf(String(activity.phase || '')) !== -1;
    var visible = directorActivityActive() || (activity && activity.active) || terminal;
    card.classList.toggle('hidden', !visible);
    if (!visible) return;

    positionDirectorActivity();
    updateDirectorTrend(system);
    updateDirectorModelLoad(activity, system);
    phase.textContent = directorPhaseLabel(activity && activity.phase);
    var startedAt = Number(activity && activity.startedAt) || generateState.director.activityStartedAt;
    var parts = [];
    if (startedAt) {
      parts.push('<span>' + escapeHtml(String(Math.max(0, Math.round(Date.now() / 1000 - startedAt))) + 's elapsed') + '</span>');
    }

    var gpu = system && system.gpu;
    var primary = gpu && gpu.available && Array.isArray(gpu.gpus) ? gpu.gpus[0] : null;
    if (primary) {
      var utilization = Number(primary.utilization);
      if (isFinite(utilization)) {
        parts.push('<span title="GPU utilization">GPU ' + Math.round(utilization) + '%</span>');
      }
      var memoryUsed = Number(primary.memoryUsed);
      var memoryTotal = Number(primary.memoryTotal);
      var used = directorMemoryGiB(memoryUsed);
      var total = directorMemoryGiB(memoryTotal);
      var vramPercent = memoryTotal > 0 ? memoryUsed / memoryTotal * 100 : NaN;
      if (isFinite(vramPercent)) {
        var vramTitle = used && total ? used + ' used of ' + total : '';
        parts.push('<span' + (vramTitle ? ' title="' + escapeHtml(vramTitle) + '"' : '') + '>VRAM ' + Math.round(vramPercent) + '%</span>');
      }
    }

    var ram = system && system.ram;
    if (ram && ram.available) {
      var ramUsedBytes = Number(ram.used);
      var ramTotalBytes = Number(ram.total);
      var ramUsed = directorBytesGiB(ramUsedBytes);
      var ramTotal = directorBytesGiB(ramTotalBytes);
      var ramPercent = ramTotalBytes > 0 ? ramUsedBytes / ramTotalBytes * 100 : NaN;
      if (isFinite(ramPercent)) {
        var ramTitle = ramUsed && ramTotal ? ramUsed + ' used of ' + ramTotal : '';
        parts.push('<span' + (ramTitle ? ' title="' + escapeHtml(ramTitle) + '"' : '') + '>RAM ' + Math.round(ramPercent) + '%</span>');
      }
    }
    detail.innerHTML = parts.join(' · ');
  }

  function directorActivityActive() {
    return generateState.director.busy;
  }

  function refreshDirectorActivity() {
    if (!directorActivityActive()) return Promise.resolve();
    return Promise.all([
      requestJson('/fs/director/activity'),
      requestJson('/fs/system_status').catch(function () { return null; })
    ]).then(function (values) {
      renderDirectorActivity(values[0], values[1]);
    }).catch(function () {
      renderDirectorActivity({ phase: 'preparing', active: true }, null);
    }).then(function () {
      if (!directorActivityActive()) return;
      if (generateState.director.activityTimer) clearTimeout(generateState.director.activityTimer);
      generateState.director.activityTimer = setTimeout(refreshDirectorActivity, 1500);
    });
  }

  function startDirectorActivity() {
    generateState.director.activityStartedAt = Date.now() / 1000;
    generateState.director.activityHistory = [];
    renderDirectorActivity({ phase: 'preparing', active: true, startedAt: generateState.director.activityStartedAt }, null);
    refreshDirectorActivity();
  }

  function finishDirectorActivity() {
    if (generateState.director.activityTimer) clearTimeout(generateState.director.activityTimer);
    generateState.director.activityTimer = 0;
    requestJson('/fs/director/activity').then(function (activity) {
      renderDirectorActivity(activity, null);
    }).catch(function () {
      renderDirectorActivity({ phase: 'complete', active: false }, null);
    }).then(function () {
      setTimeout(function () {
        var card = el('generate-director-activity');
        if (!directorActivityActive() && card) card.classList.add('hidden');
      }, 2200);
    });
  }

  function setDirectorStatus(message) {
    generateState.director.status = String(message || '');
    var status = el('generate-director-status');
    if (status) status.textContent = generateState.director.status;
  }

  function renderDirector() {
    var select = el('generate-director-model');
    var status = el('generate-director-status');
    var restore = el('generate-director-restore');
    var expand = el('generate-director-write');
    var refine = el('generate-director-refine');
    if (!select || !status || !restore || !expand || !refine) return;

    restore.classList.toggle('hidden', generateState.director.previousPrompt === null);
    if (!generateState.director.available) {
      select.innerHTML = '<option value="">Prompt Assistant unavailable</option>';
      select.disabled = true;
      expand.disabled = true;
      refine.disabled = true;
      status.textContent = generateState.director.status;
      return;
    }

    select.innerHTML = generateState.director.models.map(function (model) {
      return '<option value="' + escapeHtml(model.id) + '">' + escapeHtml(model.label || model.id) + '</option>';
    }).join('');
    var chosen = generateState.director.models.some(function (model) { return model.id === generateState.director.modelId; })
      ? generateState.director.modelId
      : String((generateState.director.models[0] || {}).id || '');
    generateState.director.modelId = chosen;
    if (chosen) setDirectorModelPreference('webcap.generate.directorModel', chosen);
    select.value = chosen;
    select.disabled = generateState.director.busy || !chosen;
    expand.disabled = generateState.director.busy || !chosen;
    refine.disabled = generateState.director.busy || !chosen;
    restore.disabled = generateState.director.busy;
    status.textContent = chosen ? generateState.director.status : 'No Prompt Assistant models';
  }

  function refreshDirector() {
    return requestJson('/fs/generate/director').then(function (payload) {
      generateState.director.available = !!payload.available;
      generateState.director.models = payload.models || [];
      renderDirector();
      return payload;
    }).catch(function (err) {
      generateState.director.available = false;
      renderDirector();
      reportError(err);
    });
  }

  function restoreDirectorPrompt() {
    if (generateState.director.busy || generateState.director.previousPrompt === null) return;
    var prompt = el('generate-prompt');
    prompt.value = generateState.director.previousPrompt;
    generateState.director.previousPrompt = null;
    window.localStorage.setItem('webcap.generate.prompt.' + generateState.modelId, prompt.value);
    setDirectorStatus('Previous prompt restored.');
    renderDirector();
  }

  function runDirector(operation) {
    if (generateState.director.busy) return;
    if (!generateState.director.modelId) throw new Error('Choose a Prompt Assistant model.');
    var promptNode = el('generate-prompt');
    var prompt = String(promptNode.value || '').trim();
    var instruction = String(el('generate-director-instruction').value || '').trim();
    var previousPrompt = promptNode.value;
    generateState.director.busy = true;
    setDirectorStatus('Prompt Assistant working…');
    renderDirector();
    startDirectorActivity();
    return queueDirectorRequest({
      operation: operation,
      directorModel: generateState.director.modelId,
      modelId: generateState.modelId,
      prompt: prompt,
      instruction: instruction,
      settings: collectSettings(),
      referenceRoles: ['first_frame', 'last_frame'].filter(function (role) {
        var input = el('generate-reference-' + role);
        return !!(input && input.files && input.files[0]);
      })
    }).then(function (payload) {
      promptNode.value = String(payload.result || '');
      generateState.director.previousPrompt = previousPrompt;
      window.localStorage.setItem('webcap.generate.prompt.' + generateState.modelId, promptNode.value);
      if (operation === 'refine_prompt') el('generate-director-instruction').value = '';
      setDirectorStatus(operation === 'write_prompt' ? 'Prompt expanded.' : 'Prompt refined.');
    }).catch(function (err) {
      setDirectorStatus('Prompt Assistant failed.');
      reportError(err);
    }).then(function () {
      generateState.director.busy = false;
      renderDirector();
      finishDirectorActivity();
    });
  }

  function refreshCapabilities() {
    setStatus('Loading generation capabilities…');
    return requestJson('/fs/generate/capabilities').then(function (payload) {
      generateState.models = payload.models || [];
      generateState.unavailableModels = payload.unavailableModels || [];
      populateModelSelector();

      if (!generateState.models.length) {
        var unavailable = generateState.unavailableModels.map(function (model) {
          return model.label + ': ' + model.error;
        }).join(' · ');
        throw new Error(unavailable || 'No generation models are available.');
      }

      if (generateState.unavailableModels.length && typeof window.reportConsoleWarning === 'function') {
        generateState.unavailableModels.forEach(function (model) {
          window.reportConsoleWarning('Generate', model.label + ' unavailable: ' + model.error);
        });
      }
      setStatus('Ready.');
    }).catch(function (err) {
      reportError(err, conciseGenerateError(err, 'Setup unavailable'));
    });
  }

  function schedulePoll() {
    if (generateState.timer) clearTimeout(generateState.timer);
    generateState.timer = setTimeout(function () {
      Promise.all([
        refreshTrackedGenerateJobs(),
        generateState.open ? refreshResults() : Promise.resolve()
      ]).then(schedulePoll);
    }, generateState.open ? 2000 : 5000);
  }

  function openGenerateActivity() {
    var frame = el('app-frame');
    var workspace = el('generate-workspace');
    if (!frame || !workspace) throw new Error('Generate workspace markup is missing.');
    if (typeof window.closeTestBenchActivity === 'function') window.closeTestBenchActivity();
    if (typeof window.closeStoryboardActivity === 'function') window.closeStoryboardActivity();
    generateState.open = true;
    generateState.director.modelId = getDirectorModelPreference('webcap.generate.directorModel');
    frame.classList.add('workspace-generate-open');
    workspace.classList.remove('hidden');
    setGenerateViewMode(generateState.viewMode);
    setTakesCollapsed(generateState.takesCollapsed);
    if (typeof window.syncApplicationShellContext === 'function') window.syncApplicationShellContext();
    if (typeof window.syncShellLocationRoute === 'function') window.syncShellLocationRoute();
    Promise.all([
      refreshCapabilities(),
      refreshDirector(),
      refreshTrackedGenerateJobs(),
      refreshResults()
    ]).catch(reportError);
    schedulePoll();
  }

  function closeGenerateActivity() {
    var frame = el('app-frame');
    var workspace = el('generate-workspace');
    generateState.open = false;
    if (workspace) workspace.classList.add('hidden');
    if (frame) frame.classList.remove('workspace-generate-open');
    if (typeof window.syncApplicationShellContext === 'function') window.syncApplicationShellContext();
    if (typeof window.syncShellLocationRoute === 'function') window.syncShellLocationRoute();
    schedulePoll();
  }

  function bindUi() {
    var workspace = el('generate-workspace');
    if (!workspace) throw new Error('Generate workspace markup is missing.');

    el('generate-create-mode-btn').onclick = function () {
      setGenerateViewMode('create');
    };
    el('generate-library-mode-btn').onclick = function () {
      setGenerateViewMode('library');
    };
    el('generate-takes-collapse-btn').onclick = function () {
      setTakesCollapsed(!generateState.takesCollapsed);
    };
    el('generate-takes').addEventListener('click', function (event) {
      var card = event.target.closest('[data-generate-take-key]');
      if (!card) return;
      var key = String(card.dataset.generateTakeKey || '');
      var result = generateState.results.find(function (item) { return resultKey(item) === key; });
      if (result) renderActiveResult(result);
    });

    el('generate-model').addEventListener('change', function () {
      generateState.modelId = this.value;
      generateState.director.previousPrompt = null;
      setDirectorStatus('');
      window.localStorage.setItem('webcap.generate.model', this.value);
      renderModelForm();
      renderDirector();
    });
    el('generate-prompt').addEventListener('input', function () {
      window.localStorage.setItem('webcap.generate.prompt.' + generateState.modelId, this.value);
    });
    el('generate-lora-add').onclick = function () {
      try { addLora(); } catch (err) { reportError(err); }
    };
    el('generate-run-btn').onclick = function () {
      try { runGenerate(); } catch (err) { reportError(err, conciseGenerateError(err, 'Generation blocked')); }
    };
    el('generate-director-write').onclick = function () {
      try { runDirector('write_prompt'); } catch (err) { reportError(err); }
    };
    el('generate-director-refine').onclick = function () {
      try { runDirector('refine_prompt'); } catch (err) { reportError(err); }
    };
    el('generate-director-restore').onclick = function () {
      restoreDirectorPrompt();
    };
    window.addEventListener('resize', function () {
      if (directorActivityActive()) positionDirectorActivity();
    });

    el('generate-director-model').addEventListener('change', function () {
      generateState.director.modelId = this.value;
      setDirectorStatus('');
      setDirectorModelPreference('webcap.generate.directorModel', this.value);
      renderDirector();
    });
    el('generate-lora-list').addEventListener('input', function (event) {
      var input = event.target.closest('[data-generate-lora-strength]');
      if (!input) return;
      var index = Number(input.dataset.generateLoraStrength);
      var items = savedLoras(generateState.modelId);
      if (!items[index]) return;
      items[index].strength = Number(input.value);
      saveLoras();
    });
    el('generate-lora-list').addEventListener('click', function (event) {
      var button = event.target.closest('[data-generate-lora-remove]');
      if (!button) return;
      savedLoras(generateState.modelId).splice(Number(button.dataset.generateLoraRemove), 1);
      saveLoras();
      renderLoras();
    });
    el('generate-results').addEventListener('click', function (event) {
      var deleteButton = event.target.closest('[data-generate-delete-storage-id]');
      if (deleteButton) {
        var storageId = String(deleteButton.dataset.generateDeleteStorageId || '').trim();
        if (!storageId) throw new Error('Generation result is missing its storage identity.');
        if (!window.confirm('Permanently delete this generation and all of its artifacts?')) return;
        deleteButton.disabled = true;
        postJson('/fs/generate/result/delete', { storageId: storageId }).then(function () {
          var card = deleteButton.closest('.generate-result-card');
          if (card) card.remove();
          return refreshResults();
        }).catch(function (err) {
          deleteButton.disabled = false;
          reportError(err, 'Delete failed');
        });
        return;
      }

      var openButton = event.target.closest('[data-generate-open-result-key]');
      if (!openButton) return;
      var key = String(openButton.dataset.generateOpenResultKey || '');
      var result = generateState.results.find(function (item) { return resultKey(item) === key; });
      if (!result) return;
      renderActiveResult(result);
      setGenerateViewMode('create');
    });
    schedulePoll();
  }

  window.openGenerateActivity = openGenerateActivity;
  window.closeGenerateActivity = closeGenerateActivity;
  bindUi();
})();
