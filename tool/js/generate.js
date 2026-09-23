(function () {
  'use strict';

  var generateState = {
    models: [],
    unavailableModels: [],
    modelId: window.localStorage.getItem('webcap.generate.model') || '',
    lorasByModel: {},
    director: {
      models: [],
      modelId: window.localStorage.getItem('webcap.generate.directorModel') || '',
      available: false,
      busy: false,
      previousPrompt: null,
      status: '',
      activityTimer: 0,
      activityStartedAt: 0
    },
    queue: { jobs: [], paused: false },
    trackedJobIds: loadTrackedGenerateJobs(),
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

  function reportError(err) {
    var message = String(err && err.message ? err.message : err);
    var status = el('generate-status');
    if (status) status.textContent = message;
    if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Generate', message);
    else console.error('[Generate]', err);
  }

  function setStatus(message) {
    var status = el('generate-status');
    if (status) status.textContent = String(message || '');
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
        ? 'Base workflow: ' + model.baseLoras.join(', ')
        : 'No fixed base LoRAs.';
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
    items.push({ name: name, strength: 1 });
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
      setStatus('Queued' + (payload.job.queuePosition ? ' · #' + payload.job.queuePosition : '') + '.');
      return refreshQueue();
    }).catch(function (err) {
      reportError(err);
    }).then(function () {
      button.disabled = false;
    });
  }

  function queueClientLabel(job) {
    if (job.client === 'storyboard') return 'Storyboard';
    if (job.client === 'test') return 'Test';
    return 'Generate';
  }

  function createQueueRow(job) {
    var row = document.createElement('article');
    row.className = 'generate-queue-row';
    row.dataset.inferenceJobId = String(job.jobId || '');

    var position = document.createElement('div');
    position.className = 'generate-queue-position';
    position.dataset.queuePosition = '1';

    var copy = document.createElement('div');
    copy.className = 'generate-queue-copy';
    var title = document.createElement('strong');
    title.dataset.queueTitle = '1';
    var detail = document.createElement('span');
    detail.dataset.queueDetail = '1';
    copy.appendChild(title);
    copy.appendChild(detail);

    var actions = document.createElement('div');
    actions.className = 'generate-queue-actions';

    row.appendChild(position);
    row.appendChild(copy);
    row.appendChild(actions);
    return row;
  }

  function syncQueueActions(row, job) {
    var actions = row.querySelector('.generate-queue-actions');
    if (!actions) return;
    var queued = job.status === 'queued';
    var active = ['starting', 'running', 'stopping'].indexOf(job.status) !== -1;
    var desired = queued ? ['up', 'down', 'cancel'] : (active ? ['stop'] : []);
    var labels = { up: '↑', down: '↓', cancel: 'Cancel', stop: 'Stop' };
    var existing = {};
    Array.prototype.forEach.call(actions.querySelectorAll('[data-inference-action]'), function (button) {
      existing[String(button.dataset.inferenceAction || '')] = button;
    });

    Object.keys(existing).forEach(function (action) {
      if (desired.indexOf(action) === -1) existing[action].remove();
    });

    desired.forEach(function (action) {
      var button = existing[action];
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'review-captions-btn';
        button.dataset.inferenceAction = action;
      }
      button.dataset.jobId = String(job.jobId || '');
      button.textContent = labels[action];
      button.disabled = action === 'stop' && job.status === 'stopping';
      if (actions.children[desired.indexOf(action)] !== button) actions.appendChild(button);
    });
  }

  function syncQueueRow(row, job) {
    row.className = 'generate-queue-row status-' + String(job.status || '');
    row.dataset.inferenceJobId = String(job.jobId || '');
    var position = row.querySelector('[data-queue-position]');
    var title = row.querySelector('[data-queue-title]');
    var detail = row.querySelector('[data-queue-detail]');
    var queued = job.status === 'queued';
    if (position) {
      position.textContent = queued && job.queuePosition
        ? '#' + job.queuePosition
        : String(job.status || '').replace(/_/g, ' ');
    }
    if (title) title.textContent = queueClientLabel(job) + ' · ' + (job.label || 'Generation');
    if (detail) {
      detail.textContent = String(job.modelId || '') +
        (job.providerStatus ? ' · ' + String(job.providerStatus) : '');
    }
    syncQueueActions(row, job);
  }

  function renderQueue() {
    var host = el('generate-queue-list');
    var pause = el('generate-queue-pause');
    if (pause) pause.textContent = generateState.queue.paused ? 'Resume queue' : 'Pause queue';
    if (!host) return;

    var jobs = Array.isArray(generateState.queue.jobs) ? generateState.queue.jobs : [];
    var running = jobs.some(function (job) {
      return ['starting', 'running', 'stopping'].indexOf(String(job.status || '')) !== -1;
    });
    if (typeof window.setShellInferenceActive === 'function') window.setShellInferenceActive(running);

    var empty = host.querySelector('.generate-queue-empty');
    if (jobs.length && empty) empty.remove();

    var rows = {};
    Array.prototype.forEach.call(
      host.querySelectorAll('.generate-queue-row[data-inference-job-id]'),
      function (row) { rows[String(row.dataset.inferenceJobId || '')] = row; }
    );
    var valid = {};

    jobs.forEach(function (job, index) {
      var key = String(job.jobId || '');
      if (!key) return;
      valid[key] = true;
      var row = rows[key];
      if (!row) {
        row = createQueueRow(job);
        rows[key] = row;
      }
      syncQueueRow(row, job);

      var currentRows = host.querySelectorAll('.generate-queue-row[data-inference-job-id]');
      var expected = currentRows[index] || null;
      if (expected !== row) host.insertBefore(row, expected);
      else if (!row.parentNode) host.appendChild(row);
    });

    Object.keys(rows).forEach(function (key) {
      if (!valid[key]) rows[key].remove();
    });

    if (!jobs.length && !host.querySelector('.generate-queue-empty')) {
      empty = document.createElement('div');
      empty.className = 'generate-queue-empty';
      empty.textContent = 'No queued inference.';
      host.appendChild(empty);
    }
  }

  function refreshQueue() {
    return requestJson('/fs/inference').then(function (payload) {
      generateState.queue = payload.queue || { jobs: [], paused: false };
      renderQueue();
      return payload.queue;
    }).catch(function (err) {
      reportError(err);
      return null;
    });
  }

  function queueAction(operation, jobId, direction) {
    return postJson('/fs/inference', {
      operation: operation,
      jobId: jobId || '',
      direction: direction || ''
    }).then(function () {
      if (operation === 'cancel') untrackGenerateJob(jobId);
      return refreshQueue();
    }).catch(reportError);
  }

  function refreshTrackedGenerateJobs() {
    var ids = (generateState.trackedJobIds || []).slice();
    if (!ids.length) return Promise.resolve([]);

    return Promise.all(ids.map(function (jobId) {
      return requestJson('/fs/inference?job=' + encodeURIComponent(jobId)).then(function (payload) {
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
        if (['completed', 'failed', 'interrupted', 'cancelled', 'stopped', 'missing'].indexOf(status) === -1) return;

        untrackGenerateJob(jobId);
        if (status === 'completed') {
          refreshResultsNeeded = true;
          if (generateState.open) setStatus('Generation complete.');
          return;
        }
        if (status === 'failed' || status === 'interrupted') {
          reportError(new Error(
            'Generation ' + status + (job.error ? ': ' + job.error : '.')
          ));
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

    footer.appendChild(model);
    footer.appendChild(details);
    footer.appendChild(prompt);
    card.appendChild(mediaHost);
    card.appendChild(footer);
    return card;
  }

  function renderResults(results) {
    var host = el('generate-results');
    if (!host) return;
    var items = Array.isArray(results) ? results : [];
    var cards = host.querySelectorAll('.generate-result-card[data-result-key]');
    var existingKeys = {};
    Array.prototype.forEach.call(cards, function (card) {
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
  }

  function refreshResults() {
    return requestJson('/fs/generate/results?limit=60').then(function (payload) {
      renderResults(payload.results || []);
    }).catch(reportError);
  }

  function directorPhaseLabel(phase) {
    var labels = {
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

  function renderDirectorActivity(activity, system) {
    var card = el('generate-director-activity');
    var phase = el('generate-director-activity-phase');
    var detail = el('generate-director-activity-detail');
    if (!card || !phase || !detail) throw new Error('Prompt Assistant activity markup is missing.');

    var terminal = activity && ['complete', 'error'].indexOf(String(activity.phase || '')) !== -1;
    var visible = generateState.director.busy || (activity && activity.active) || terminal;
    card.classList.toggle('hidden', !visible);
    if (!visible) return;

    phase.textContent = directorPhaseLabel(activity && activity.phase);
    var startedAt = Number(activity && activity.startedAt) || generateState.director.activityStartedAt;
    var parts = [];
    if (startedAt) parts.push(Math.max(0, Math.round(Date.now() / 1000 - startedAt)) + 's elapsed');

    var gpu = system && system.gpu;
    var primary = gpu && gpu.available && Array.isArray(gpu.gpus) ? gpu.gpus[0] : null;
    if (primary) {
      var utilization = Number(primary.utilization);
      if (isFinite(utilization)) parts.push('GPU ' + Math.round(utilization) + '%');
      var used = directorMemoryGiB(primary.memoryUsed);
      var total = directorMemoryGiB(primary.memoryTotal);
      if (used && total) parts.push('VRAM ' + used + ' / ' + total);
    }

    var ram = system && system.ram;
    if (ram && ram.available) {
      var ramUsed = directorBytesGiB(ram.used);
      var ramTotal = directorBytesGiB(ram.total);
      if (ramUsed && ramTotal) parts.push('RAM ' + ramUsed + ' / ' + ramTotal);
    }
    detail.textContent = parts.join(' · ');
  }

  function refreshDirectorActivity() {
    if (!generateState.director.busy) return Promise.resolve();
    return Promise.all([
      requestJson('/fs/director/activity'),
      requestJson('/fs/system_status')
    ]).then(function (values) {
      renderDirectorActivity(values[0], values[1]);
    }).catch(function () {
      renderDirectorActivity({ phase: 'preparing', active: true }, null);
    }).then(function () {
      if (!generateState.director.busy) return;
      if (generateState.director.activityTimer) clearTimeout(generateState.director.activityTimer);
      generateState.director.activityTimer = setTimeout(refreshDirectorActivity, 1500);
    });
  }

  function startDirectorActivity() {
    generateState.director.activityStartedAt = Date.now() / 1000;
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
        if (!generateState.director.busy && card) card.classList.add('hidden');
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
    return postJson('/fs/generate/director', {
      operation: operation,
      directorModel: generateState.director.modelId,
      modelId: generateState.modelId,
      prompt: prompt,
      instruction: instruction,
      settings: collectSettings()
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
    }).catch(reportError);
  }

  function schedulePoll() {
    if (generateState.timer) clearTimeout(generateState.timer);
    generateState.timer = setTimeout(function () {
      Promise.all([
        refreshQueue(),
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
    frame.classList.add('workspace-generate-open');
    workspace.classList.remove('hidden');
    if (typeof window.syncApplicationShellContext === 'function') window.syncApplicationShellContext();
    if (typeof window.syncShellLocationRoute === 'function') window.syncShellLocationRoute();
    Promise.all([refreshCapabilities(), refreshDirector(), refreshQueue(), refreshTrackedGenerateJobs(), refreshResults()]).catch(reportError);
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
      try { runGenerate(); } catch (err) { reportError(err); }
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
    el('generate-director-model').addEventListener('change', function () {
      generateState.director.modelId = this.value;
      setDirectorStatus('');
      window.localStorage.setItem('webcap.generate.directorModel', this.value);
      renderDirector();
    });
    el('generate-queue-pause').onclick = function () {
      queueAction(generateState.queue.paused ? 'resume_queue' : 'pause_queue');
    };

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
    el('generate-queue-list').addEventListener('click', function (event) {
      var button = event.target.closest('[data-inference-action]');
      if (!button) return;
      var action = button.dataset.inferenceAction;
      if (action === 'up' || action === 'down') queueAction('reorder', button.dataset.jobId, action);
      else queueAction(action, button.dataset.jobId);
    });

    refreshQueue();
    schedulePoll();
  }

  window.openGenerateActivity = openGenerateActivity;
  window.closeGenerateActivity = closeGenerateActivity;
  bindUi();
})();
