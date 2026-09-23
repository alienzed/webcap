(function () {
  'use strict';

  var generateState = {
    models: [],
    modelId: window.localStorage.getItem('webcap.generate.model') || '',
    lorasByModel: {},
    director: {
      models: [],
      modelId: window.localStorage.getItem('webcap.generate.directorModel') || '',
      available: false,
      busy: false
    },
    queue: { jobs: [], paused: false },
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
    var savedPrompt = window.localStorage.getItem('webcap.generate.prompt.' + model.id);
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

  function collectReferences() {
    var model = currentModel();
    var references = {};
    var uploads = [];
    (model && model.references || []).forEach(function (role) {
      var input = el('generate-reference-' + role);
      var file = input && input.files && input.files[0];
      if (!file) return;
      uploads.push(uploadReference(file).then(function (path) { references[role] = path; }));
    });
    return Promise.all(uploads).then(function () { return references; });
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

  function renderQueue() {
    var host = el('generate-queue-list');
    var pause = el('generate-queue-pause');
    if (pause) pause.textContent = generateState.queue.paused ? 'Resume queue' : 'Pause queue';
    if (!host) return;
    var jobs = Array.isArray(generateState.queue.jobs) ? generateState.queue.jobs : [];
    if (!jobs.length) {
      host.innerHTML = '<div class="generate-queue-empty">No queued inference.</div>';
      if (typeof window.setShellInferenceActive === 'function') window.setShellInferenceActive(false);
      return;
    }
    var running = jobs.some(function (job) {
      return ['starting', 'running', 'stopping'].indexOf(String(job.status || '')) !== -1;
    });
    if (typeof window.setShellInferenceActive === 'function') window.setShellInferenceActive(running);

    host.innerHTML = jobs.map(function (job) {
      var queued = job.status === 'queued';
      var active = ['starting', 'running', 'stopping'].indexOf(job.status) !== -1;
      var position = queued && job.queuePosition ? '#' + job.queuePosition : String(job.status || '').replace(/_/g, ' ');
      var controls = '';
      if (queued) {
        controls =
          '<button type="button" class="review-captions-btn" data-inference-action="up" data-job-id="' + escapeHtml(job.jobId) + '">↑</button>' +
          '<button type="button" class="review-captions-btn" data-inference-action="down" data-job-id="' + escapeHtml(job.jobId) + '">↓</button>' +
          '<button type="button" class="review-captions-btn" data-inference-action="cancel" data-job-id="' + escapeHtml(job.jobId) + '">Cancel</button>';
      } else if (active) {
        controls = '<button type="button" class="review-captions-btn" data-inference-action="stop" data-job-id="' + escapeHtml(job.jobId) + '">Stop</button>';
      }
      return '<article class="generate-queue-row status-' + escapeHtml(job.status) + '">' +
        '<div class="generate-queue-position">' + escapeHtml(position) + '</div>' +
        '<div class="generate-queue-copy">' +
          '<strong>' + escapeHtml(queueClientLabel(job) + ' · ' + (job.label || 'Generation')) + '</strong>' +
          '<span>' + escapeHtml(job.modelId || '') + (job.providerStatus ? ' · ' + escapeHtml(job.providerStatus) : '') + '</span>' +
        '</div>' +
        '<div class="generate-queue-actions">' + controls + '</div>' +
      '</article>';
    }).join('');
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
      return refreshQueue();
    }).catch(reportError);
  }

  function renderResults(results) {
    var host = el('generate-results');
    if (!host) return;
    if (!results.length) {
      host.innerHTML = '<div class="generate-results-empty">Generated media will appear here.</div>';
      return;
    }
    host.innerHTML = results.map(function (result) {
      var src = '/fs/generate/media?path=' + encodeURIComponent(result.mediaPath || '');
      var media = result.mediaKind === 'video'
        ? '<video controls preload="metadata" src="' + src + '"></video>'
        : '<img loading="lazy" src="' + src + '" alt="">';
      var settings = result.settings || {};
      var summary = [];
      if (settings.dimensions) summary.push(String(settings.dimensions).trim());
      if (settings.aspectRatio) summary.push(settings.aspectRatio);
      if (settings.duration) summary.push(settings.duration + 's');
      if (result.seed !== undefined && result.seed !== null) summary.push('Seed ' + result.seed);
      return '<article class="generate-result-card">' +
        '<div class="generate-result-media">' + media + '</div>' +
        '<div class="generate-result-footer">' +
          '<strong>' + escapeHtml(result.modelId || 'Generated') + '</strong>' +
          '<span>' + escapeHtml(summary.join(' · ')) + '</span>' +
          '<p title="' + escapeHtml(result.resolvedPrompt || '') + '">' + escapeHtml(result.resolvedPrompt || '') + '</p>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  function refreshResults() {
    return requestJson('/fs/generate/results?limit=60').then(function (payload) {
      renderResults(payload.results || []);
    }).catch(reportError);
  }

  function renderDirector() {
    var select = el('generate-director-model');
    var status = el('generate-director-status');
    if (!select || !status) return;
    if (!generateState.director.available) {
      select.innerHTML = '<option value="">Director unavailable</option>';
      select.disabled = true;
      status.textContent = '';
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
    status.textContent = chosen ? 'Ready' : 'No Director models';
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

  function runDirector(operation) {
    if (generateState.director.busy) return;
    if (!generateState.director.modelId) throw new Error('Choose a Director model.');
    var prompt = String(el('generate-prompt').value || '').trim();
    var instruction = String(el('generate-director-instruction').value || '').trim();
    generateState.director.busy = true;
    renderDirector();
    el('generate-director-status').textContent = 'Director working…';
    return postJson('/fs/generate/director', {
      operation: operation,
      directorModel: generateState.director.modelId,
      modelId: generateState.modelId,
      prompt: prompt,
      instruction: instruction,
      settings: collectSettings()
    }).then(function (payload) {
      el('generate-prompt').value = String(payload.result || '');
      window.localStorage.setItem('webcap.generate.prompt.' + generateState.modelId, el('generate-prompt').value);
      if (operation === 'refine_prompt') el('generate-director-instruction').value = '';
      el('generate-director-status').textContent = 'Updated with ' + String(payload.model || generateState.director.modelId);
    }).catch(reportError).then(function () {
      generateState.director.busy = false;
      renderDirector();
    });
  }

  function refreshCapabilities() {
    setStatus('Loading generation capabilities…');
    return requestJson('/fs/generate/capabilities').then(function (payload) {
      generateState.models = payload.models || [];
      populateModelSelector();
      setStatus('Ready.');
    }).catch(reportError);
  }

  function schedulePoll() {
    if (generateState.timer) clearTimeout(generateState.timer);
    generateState.timer = setTimeout(function () {
      Promise.all([
        refreshQueue(),
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
    Promise.all([refreshCapabilities(), refreshDirector(), refreshQueue(), refreshResults()]).catch(reportError);
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
      window.localStorage.setItem('webcap.generate.model', this.value);
      renderModelForm();
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
    el('generate-director-model').addEventListener('change', function () {
      generateState.director.modelId = this.value;
      window.localStorage.setItem('webcap.generate.directorModel', this.value);
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
