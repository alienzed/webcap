(function () {
  'use strict';

  var storyState = {
    stories: [],
    story: null,
    saveTimer: 0,
    sceneTimers: {},
    storySavePromise: null,
    storySaveError: null,
    sceneSavePromises: {},
    sceneSaveErrors: {},
    generationJobs: {},
    generationPolls: {},
    newTakeCounts: {},
    sequenceExport: null,
    sequenceCollapsed: window.localStorage.getItem('webcap.storyboard.sequenceCollapsed') === '1',
    sceneViewMode: window.localStorage.getItem('webcap.storyboard.sceneView') || 'focus',
    activeSceneId: '',
    storyCollapsed: window.localStorage.getItem('webcap.storyboard.storyCollapsed') === '1',
    generationCapabilities: {
      loras: [],
      baseLoras: [],
      available: false,
      error: ''
    },
    director: {
      models: [],
      modelId: '',
      available: false,
      busy: false,
      pendingTargets: {},
      pendingOrder: [],
      recoveryJobs: {},
      runtimeLabel: '',
      error: '',
      previousPrompts: {},
      activityTimer: 0,
      activityStartedAt: 0,
      activityHistory: [],
      activityLastMemory: null,
      activityLoadBaseline: null,
      activityLoadModelId: '',
      activityTarget: null
    }
  };

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function reportError(err) {
    var message = String(err && err.message ? err.message : err || 'Storyboard request failed.');
    var status = el('storyboard-save-state');
    if (status) status.textContent = 'Error: ' + message;
    if (typeof reportConsoleError === 'function') reportConsoleError('Storyboard', err);
    else if (window.console && console.error) console.error('[Storyboard] ' + message, err);
  }

  function request(payload, query) {
    var url = '/fs/storyboard' + (query ? '?' + query : '');
    var options = payload
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      : {};
    return fetch(url, options).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body || !body.ok) {
          throw new Error((body && body.error) || 'Storyboard request failed.');
        }
        return body;
      });
    });
  }

  function assemblyRequest(payload, query) {
    var url = '/fs/storyboard/assembly' + (query ? '?' + query : '');
    var options = payload
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      : {};
    return fetch(url, options).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body || !body.ok) {
          throw new Error((body && body.error) || 'Storyboard sequence export failed.');
        }
        return body;
      });
    });
  }

  function refreshGenerationCapabilities() {
    return fetch('/fs/storyboard/generation/capabilities').then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body || !body.ok) {
          throw new Error((body && body.error) || 'Storyboard generation capabilities failed.');
        }
        storyState.generationCapabilities.available = true;
        storyState.generationCapabilities.loras = body.loras || [];
        storyState.generationCapabilities.baseLoras = body.baseLoras || [];
        storyState.generationCapabilities.error = '';
        if (storyState.story) {
          renderStoryLoras();
          renderScenes();
        }
        return body;
      });
    }).catch(function (err) {
      storyState.generationCapabilities.available = false;
      storyState.generationCapabilities.loras = [];
      storyState.generationCapabilities.baseLoras = [];
      storyState.generationCapabilities.error = String(err && err.message ? err.message : err);
      if (storyState.story) {
        renderStoryLoras();
        renderScenes();
      }
      return null;
    });
  }

  function directorJobRequest(jobId, consume) {
    var url = '/fs/director/job?job=' + encodeURIComponent(jobId);
    if (consume) url += '&consume=1';
    return fetch(url).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body || !body.ok || !body.job) {
          throw new Error((body && body.error) || 'Storyboard Director job request failed.');
        }
        return body.job;
      });
    });
  }

  function waitForDirectorJob(job) {
    if (!job || !job.jobId) throw new Error('Storyboard Director did not return a queued job.');
    function poll(current) {
      var status = String(current.status || '');
      if (status === 'completed') return Promise.resolve(current.result || {});
      if (['failed', 'cancelled', 'stopped', 'interrupted'].indexOf(status) !== -1) {
        throw new Error(current.error || ('Storyboard Director job ' + status + '.'));
      }
      return new Promise(function (resolve) { setTimeout(resolve, 750); }).then(function () {
        return directorJobRequest(current.jobId, false);
      }).then(poll);
    }
    return poll(job);
  }

  function directorQueueSnapshot(includeTerminal) {
    var url = '/fs/director/queue' + (includeTerminal ? '?includeTerminal=1' : '');
    return fetch(url).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body || !body.ok || !body.queue) {
          throw new Error((body && body.error) || 'Director queue snapshot failed.');
        }
        return body.queue;
      });
    });
  }

  function consumeDirectorJob(jobId) {
    return directorJobRequest(jobId, true);
  }

  function directorTargetFromJob(job) {
    if (!job || job.client !== 'storyboard' || !job.storyId) return null;
    if (job.operation === 'expand_concept') return { kind: 'concept', storyId: job.storyId };
    if (job.operation === 'develop_story') return { kind: 'scenes', storyId: job.storyId };
    if ((job.operation === 'write_prompt' || job.operation === 'refine_prompt') && job.sceneId) {
      return { kind: 'scene-prompt', storyId: job.storyId, sceneId: job.sceneId };
    }
    return null;
  }

  function applyRecoveredDirectorResult(job) {
    var result = job.result || {};
    var storyId = String(job.storyId || '');
    var sceneId = String(job.sceneId || '');

    if (job.operation === 'write_prompt' || job.operation === 'refine_prompt') {
      var previousPrompt = '';
      return request(null, 'story=' + encodeURIComponent(storyId)).then(function (payload) {
        var scene = payload.story && payload.story.scenes ? payload.story.scenes[sceneId] : null;
        if (!scene) throw new Error('Recovered Director Scene no longer exists.');
        if (String(scene.promptDirectorJobId || '') === String(job.jobId || '')) return null;
        previousPrompt = String(scene.prompt || '');
        return request({
          operation: 'update_scene',
          storyId: storyId,
          sceneId: sceneId,
          scene: {
            prompt: String(result.result || ''),
            promptDirectorModel: String(result.model || job.modelId || ''),
            promptDirectorJobId: String(job.jobId || '')
          }
        });
      }).then(function (saved) {
        if (!saved) return;
        if (storyState.story && storyState.story.id === storyId) {
          storyState.story = saved.story;
          storyState.director.previousPrompts[sceneId] = previousPrompt;
          renderStory();
          updateSceneDirectorStatus(sceneId, 'Recovered Director result.');
        }
        return refreshLibrary();
      });
    }

    if (job.operation === 'expand_concept' || job.operation === 'develop_story') {
      return request(null, 'story=' + encodeURIComponent(storyId)).then(function (payload) {
        if (storyState.story && storyState.story.id === storyId) {
          storyState.story = payload.story;
          renderStory();
        }
        return refreshLibrary();
      });
    }

    return Promise.resolve();
  }

  function watchRecoveredDirectorJob(job) {
    if (!job || !job.jobId || storyState.director.recoveryJobs[job.jobId]) return;
    var target = directorTargetFromJob(job);
    if (!target) return;

    storyState.director.recoveryJobs[job.jobId] = true;
    if (!directorTargetPending(target)) setDirectorPending(target, true);
    startDirectorActivity();

    function poll(current) {
      var status = String(current.status || '');
      if (status === 'completed') {
        return applyRecoveredDirectorResult(current).then(function () {
          return consumeDirectorJob(current.jobId);
        });
      }
      if (['failed', 'cancelled', 'stopped', 'interrupted'].indexOf(status) !== -1) {
        return consumeDirectorJob(current.jobId).then(function () {
          throw new Error(current.error || ('Storyboard Director job ' + status + '.'));
        });
      }
      return new Promise(function (resolve) { setTimeout(resolve, 750); }).then(function () {
        return directorJobRequest(current.jobId, false);
      }).then(poll);
    }

    poll(job).catch(reportError).finally(function () {
      delete storyState.director.recoveryJobs[job.jobId];
      setDirectorPending(target, false);
      finishDirectorActivity();
    });
  }

  function reconcileDirectorJobs() {
    return directorQueueSnapshot(true).then(function (queue) {
      (queue.jobs || []).forEach(function (job) {
        if (!job || job.client !== 'storyboard') return;
        var target = directorTargetFromJob(job);
        if (target && !directorTargetPending(target)) watchRecoveredDirectorJob(job);
      });
    });
  }

  function directorRequest(payload) {
    var options = payload
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      : {};
    return fetch('/fs/storyboard/director', options).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body || !body.ok) {
          throw new Error((body && body.error) || 'Storyboard Director request failed.');
        }
        if (payload && body.job) {
          return waitForDirectorJob(body.job).then(function (result) {
            result.jobId = body.job.jobId;
            if (payload.operation !== 'expand_concept' && payload.operation !== 'develop_story') return result;
            return request(null, 'story=' + encodeURIComponent(payload.storyId)).then(function (storyPayload) {
              result.story = storyPayload.story;
              return result;
            });
          }).catch(function (err) {
            return consumeDirectorJob(body.job.jobId).catch(function () {}).then(function () { throw err; });
          });
        }
        return body;
      });
    });
  }

  function renderDirectorSelector() {
    var select = el('storyboard-director-model');
    if (!select) return;

    var models = storyState.director.models || [];
    if (!storyState.director.available) {
      select.innerHTML = '<option value="">Director unavailable</option>';
      select.disabled = true;
      select.title = storyState.director.error || 'Director unavailable';
      return;
    }

    if (!models.length) {
      select.innerHTML = '<option value="">No Director models found</option>';
      select.disabled = true;
      select.title = 'No Director models available';
      return;
    }

    select.disabled = false;
    select.innerHTML = models.map(function (model) {
      return '<option value="' + escapeHtml(model.id) + '">' + escapeHtml(model.label || model.id) + '</option>';
    }).join('');

    var selected = storyState.director.modelId;
    if (!models.some(function (model) { return model.id === selected; })) {
      selected = models[0].id;
      storyState.director.modelId = selected;
      setSharedDirectorModelPreference(selected);
    }
    select.value = selected;
    select.title = '';
  }

  function refreshDirector() {
    return directorRequest(null).then(function (payload) {
      storyState.director.available = !!payload.available;
      storyState.director.models = payload.models || [];
      storyState.director.runtimeLabel = payload.runtime || '';
      storyState.director.error = payload.error || '';
      renderDirectorSelector();
      return payload;
    }).catch(function (err) {
      storyState.director.available = false;
      storyState.director.models = [];
      storyState.director.runtimeLabel = '';
      storyState.director.error = String(err && err.message ? err.message : err);
      renderDirectorSelector();
    });
  }

  function directorActivityRequest(url) {
    return fetch(url).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body || body.ok === false) {
          throw new Error((body && body.error) || 'Director activity request failed.');
        }
        return body;
      });
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
    var meter = el('storyboard-director-model-load');
    var label = el('storyboard-director-model-load-label');
    var fill = el('storyboard-director-model-load-fill');
    if (!meter || !label || !fill) return;

    var phase = String(activity && activity.phase || '');
    var sample = directorMemorySample(system);
    if (phase !== 'loading_model') {
      meter.classList.add('hidden');
      if (sample) storyState.director.activityLastMemory = sample;
      if (phase === 'preparing' || phase === 'queued' || phase === 'freeing_comfy') {
        storyState.director.activityLoadBaseline = null;
        storyState.director.activityLoadModelId = '';
      }
      return;
    }

    var modelId = String(activity && activity.model || '');
    if (storyState.director.activityLoadModelId !== modelId) {
      storyState.director.activityLoadModelId = modelId;
      storyState.director.activityLoadBaseline = storyState.director.activityLastMemory || sample;
    } else if (!storyState.director.activityLoadBaseline && sample) {
      storyState.director.activityLoadBaseline = storyState.director.activityLastMemory || sample;
    }

    var modelSizeBytes = Number(activity && activity.modelSizeBytes);
    var baseline = storyState.director.activityLoadBaseline;
    if (!sample || !baseline || !isFinite(modelSizeBytes) || modelSizeBytes <= 0) {
      meter.classList.add('hidden');
      return;
    }

    var ramDelta = Math.max(0, sample.ramBytes - baseline.ramBytes);
    var vramDelta = Math.max(0, sample.vramBytes - baseline.vramBytes);
    var residentBytes = Math.max(0, ramDelta + vramDelta);
    var displayBytes = Math.min(modelSizeBytes, residentBytes);
    var percent = Math.max(0, Math.min(100, residentBytes / modelSizeBytes * 100));
    label.textContent = '≈ ' + directorBytesGiB(displayBytes) + ' / ' + directorBytesGiB(modelSizeBytes) + ' · ~' + Math.round(percent) + '%';
    fill.style.width = percent.toFixed(1) + '%';
    var track = meter.querySelector('.director-model-load-track');
    if (track) track.setAttribute('aria-valuenow', String(Math.round(percent)));
    meter.title = 'Approximate model residency from RAM + VRAM growth since loading began. mmap, caching, and GPU offload can make this differ from the GGUF file size.';
    meter.classList.remove('hidden');
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
    var graph = el('storyboard-director-activity-trend');
    if (!graph) throw new Error('Storyboard Director memory history markup is missing.');
    var gpu = system && system.gpu;
    var primary = gpu && gpu.available && Array.isArray(gpu.gpus) ? gpu.gpus[0] : null;
    var ram = system && system.ram;
    var vramPercent = primary ? Number(primary.memoryUsed) / Number(primary.memoryTotal) * 100 : NaN;
    var ramPercent = ram && ram.available ? Number(ram.used) / Number(ram.total) * 100 : NaN;
    if (isFinite(vramPercent) && isFinite(ramPercent)) {
      storyState.director.activityHistory.push({ time: Date.now(), ram: ramPercent, vram: vramPercent });
      if (storyState.director.activityHistory.length > 40) storyState.director.activityHistory.shift();
    }
    var cutoff = Date.now() - 60000;
    while (storyState.director.activityHistory.length && storyState.director.activityHistory[0].time < cutoff) storyState.director.activityHistory.shift();
    var history = storyState.director.activityHistory;
    graph.querySelector('.director-activity-trend-ram-line').setAttribute('d', directorTrendPath(history, 'ram'));
    graph.querySelector('.director-activity-trend-vram-line').setAttribute('d', directorTrendPath(history, 'vram'));
    var latest = history[history.length - 1];
    graph.setAttribute('aria-label', latest
      ? 'RAM and VRAM use history for the last minute. Latest: RAM ' + Math.round(latest.ram) + '%, VRAM ' + Math.round(latest.vram) + '%. ' + history.length + ' samples.'
      : 'RAM and VRAM history, waiting for samples');
  }

  function directorActivityTargetElement() {
    var target = storyState.director.activityTarget || {};
    if (target.kind === 'concept') {
      return el('storyboard-story-concept');
    }
    if (target.kind === 'scene-prompt') {
      var sceneRoot = sceneElement(target.sceneId);
      return sceneRoot && sceneRoot.querySelector('[data-scene-field="prompt"]');
    }
    if (target.kind === 'scenes') {
      var concept = el('storyboard-story-concept');
      return concept && concept.offsetParent !== null ? concept : null;
    }
    return document.querySelector('.storyboard-scene-workspace');
  }

  function positionDirectorActivity() {
    var card = el('storyboard-director-activity');
    var editor = document.querySelector('.storyboard-editor');
    var kind = String((storyState.director.activityTarget || {}).kind || '');
    var target = directorActivityTargetElement();
    if (!card || !editor) return;

    var detachedTarget = (kind === 'scene-prompt' || kind === 'scenes') && !target;
    card.classList.toggle('is-detached-target', detachedTarget);
    if (detachedTarget || !target || card.classList.contains('hidden')) return;

    var editorRect = editor.getBoundingClientRect();
    var targetRect = target.getBoundingClientRect();
    var fillsField = kind === 'concept' || kind === 'scene-prompt' || kind === 'scenes';
    card.classList.toggle('is-field-overlay', fillsField);
    card.classList.toggle('is-structure-overlay', !fillsField);

    if (fillsField) {
      var inset = 7;
      var width = Math.max(260, targetRect.width - inset * 2);
      var height = Math.max(96, targetRect.height - inset * 2);
      card.style.width = Math.round(width) + 'px';
      card.style.height = Math.round(height) + 'px';
      card.style.left = Math.round(targetRect.left - editorRect.left + inset) + 'px';
      card.style.top = Math.round(targetRect.top - editorRect.top + inset) + 'px';
      return;
    }

    card.style.height = '';

    var preferredWidth = 440;
    var targetWidth = Math.max(0, targetRect.width - 24);
    var editorWidth = Math.max(0, editorRect.width - 24);
    var structureWidth = Math.min(preferredWidth, targetWidth || preferredWidth, editorWidth || preferredWidth);
    structureWidth = Math.max(300, structureWidth);
    if (structureWidth > editorWidth && editorWidth > 0) structureWidth = editorWidth;

    card.style.width = Math.round(structureWidth) + 'px';

    var left = targetRect.right - editorRect.left - structureWidth - 12;
    var top = targetRect.top - editorRect.top + 12;
    var maxLeft = Math.max(12, editorRect.width - structureWidth - 12);
    left = Math.max(12, Math.min(maxLeft, left));

    card.style.left = Math.round(left) + 'px';
    card.style.top = Math.round(Math.max(12, top)) + 'px';

    window.requestAnimationFrame(function () {
      if (card.classList.contains('hidden')) return;
      var maxTop = Math.max(12, editorRect.height - card.offsetHeight - 12);
      var currentTop = parseFloat(card.style.top) || 12;
      card.style.top = Math.round(Math.max(12, Math.min(maxTop, currentTop))) + 'px';
    });
  }

  function renderDirectorActivity(activity, system) {
    var card = el('storyboard-director-activity');
    var phase = el('storyboard-director-activity-phase');
    var detail = el('storyboard-director-activity-detail');
    if (!card || !phase || !detail) throw new Error('Storyboard Director activity markup is missing.');

    var terminal = activity && ['complete', 'error'].indexOf(String(activity.phase || '')) !== -1;
    var visible = directorActivityActive() || (activity && activity.active) || terminal;
    card.classList.toggle('hidden', !visible);
    if (!visible) return;

    positionDirectorActivity();
    updateDirectorTrend(system);
    updateDirectorModelLoad(activity, system);
    phase.textContent = directorPhaseLabel(activity && activity.phase);
    var startedAt = Number(activity && activity.startedAt) || storyState.director.activityStartedAt;
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
    return storyState.director.busy;
  }

  function directorActivityForCurrentRun(activity) {
    if (!activity) return activity;

    var localStartedAt = Number(storyState.director.activityStartedAt) || 0;
    var phase = String(activity.phase || '');
    var terminal = ['complete', 'error'].indexOf(phase) !== -1;
    if (!localStartedAt || !terminal) return activity;

    var activityTime = Math.max(
      Number(activity.startedAt) || 0,
      Number(activity.updatedAt) || 0
    );
    if (activityTime >= localStartedAt) return activity;

    return {
      phase: 'preparing',
      active: true,
      startedAt: localStartedAt
    };
  }

  function refreshDirectorActivity() {
    if (!directorActivityActive()) return Promise.resolve();
    return Promise.all([
      directorActivityRequest('/fs/director/activity'),
      directorActivityRequest('/fs/system_status').catch(function () { return null; })
    ]).then(function (values) {
      renderDirectorActivity(directorActivityForCurrentRun(values[0]), values[1]);
    }).catch(function () {
      renderDirectorActivity({ phase: 'preparing', active: true }, null);
    }).then(function () {
      if (!directorActivityActive()) return;
      if (storyState.director.activityTimer) clearTimeout(storyState.director.activityTimer);
      storyState.director.activityTimer = setTimeout(refreshDirectorActivity, 1500);
    });
  }

  function startDirectorActivity() {
    if (storyState.director.pendingOrder.length === 1) {
      storyState.director.activityStartedAt = Date.now() / 1000;
      storyState.director.activityHistory = [];
      renderDirectorActivity({ phase: 'preparing', active: true, startedAt: storyState.director.activityStartedAt }, null);
    } else {
      positionDirectorActivity();
    }
    if (!storyState.director.activityTimer) refreshDirectorActivity();
  }

  function finishDirectorActivity() {
    if (storyState.director.activityTimer) clearTimeout(storyState.director.activityTimer);
    storyState.director.activityTimer = 0;
    if (directorActivityActive()) {
      positionDirectorActivity();
      refreshDirectorActivity();
      return;
    }
    directorActivityRequest('/fs/director/activity').then(function (activity) {
      var localStartedAt = Number(storyState.director.activityStartedAt) || 0;
      var phase = String(activity && activity.phase || '');
      var terminal = ['complete', 'error'].indexOf(phase) !== -1;
      var activityTime = Math.max(
        Number(activity && activity.startedAt) || 0,
        Number(activity && activity.updatedAt) || 0
      );
      if (terminal && (!localStartedAt || activityTime >= localStartedAt)) {
        renderDirectorActivity(activity, null);
        return;
      }
      var staleCard = el('storyboard-director-activity');
      if (staleCard) staleCard.classList.add('hidden');
    }).catch(function () {
      var card = el('storyboard-director-activity');
      if (card) card.classList.add('hidden');
    }).then(function () {
      setTimeout(function () {
        var card = el('storyboard-director-activity');
        if (!directorActivityActive() && card) {
          card.classList.add('hidden');
          storyState.director.activityTarget = null;
          storyState.director.activityStartedAt = 0;
        }
      }, 2200);
    });
  }

  function updateSceneDirectorStatus(sceneId, text) {
    var root = sceneElement(sceneId);
    var node = root && root.querySelector('[data-director-status]');
    if (node) node.textContent = text || '';
  }

  function syncSceneDirectorRestore(sceneId) {
    var root = sceneElement(sceneId);
    var button = root && root.querySelector('[data-director-restore]');
    if (!button) return;
    button.classList.toggle(
      'hidden',
      typeof storyState.director.previousPrompts[sceneId] !== 'string'
    );
  }

  function restoreSceneDirectorPrompt(sceneId) {
    if (!storyState.story) return;
    var directorTarget = { kind: 'scene-prompt', storyId: storyState.story.id, sceneId: sceneId };
    if (directorTargetPending(directorTarget)) return;
    var previous = storyState.director.previousPrompts[sceneId];
    if (typeof previous !== 'string') return;
    var root = sceneElement(sceneId);
    var prompt = root && root.querySelector('[data-scene-field="prompt"]');
    if (!prompt) throw new Error('Scene generation prompt field is missing.');
    prompt.value = previous;
    delete storyState.director.previousPrompts[sceneId];
    syncSceneDirectorRestore(sceneId);
    updateSceneDirectorStatus(sceneId, 'Previous prompt restored.');
    saveSceneNow(sceneId).catch(reportError);
  }

  function directorContractPreviewText(contract) {
    contract = contract || {};
    var parts = [String(contract.prompt || '')];
    if (contract.response_schema) {
      parts.push('--- OUTPUT SCHEMA ---\n' + JSON.stringify(contract.response_schema, null, 2));
    } else {
      parts.push('--- OUTPUT ---\n' + String(contract.output || 'text'));
    }
    if (contract.result_renderer) {
      parts.push('--- WEBCAP RESULT RENDERER ---\n' + JSON.stringify(contract.result_renderer, null, 2));
    }
    return parts.filter(Boolean).join('\n\n');
  }

  function previewDirectorRequest(sceneId, operation) {
    if (!storyState.story) return;
    var storyId = storyState.story.id;
    var root = sceneElement(sceneId);
    if (!root) throw new Error('Scene editor is missing for ' + sceneId + '.');
    var output = root.querySelector('[data-director-request-preview-output]');
    if (!output) throw new Error('Director request preview output is missing.');

    var instruction = '';
    if (operation === 'refine_prompt') {
      var correction = root.querySelector('[data-director-correction]');
      instruction = correction ? correction.value.trim() : '';
      if (!instruction) {
        output.textContent = 'Enter a refinement instruction first.';
        return;
      }
    }

    output.textContent = 'Building exact Director request…';
    flushPendingSaves().then(function () {
      return directorRequest({
        storyId: storyId,
        sceneId: sceneId,
        operation: operation,
        model: storyState.director.modelId,
        instruction: instruction,
        previewOnly: true
      });
    }).then(function (payload) {
      output.textContent = directorContractPreviewText(payload.contract);
    }).catch(function (err) {
      output.textContent = 'Director request preview failed: ' + String(err && err.message ? err.message : err);
      reportError(err);
    });
  }

  function runDirector(sceneId, operation) {
    if (!storyState.story) return;
    var storyId = storyState.story.id;
    var directorTarget = { kind: 'scene-prompt', storyId: storyId, sceneId: sceneId };
    if (directorTargetPending(directorTarget)) return;
    var modelId = storyState.director.modelId;
    if (!modelId) {
      reportError(new Error('Choose a Storyboard Director model first.'));
      return;
    }
    var root = sceneElement(sceneId);
    if (!root) throw new Error('Scene editor is missing for ' + sceneId + '.');
    var prompt = root.querySelector('[data-scene-field="prompt"]');
    if (!prompt) throw new Error('Scene generation prompt field is missing.');
    var previousPrompt = prompt.value;

    var instruction = '';
    if (operation === 'refine_prompt') {
      var correction = root.querySelector('[data-director-correction]');
      instruction = correction ? correction.value.trim() : '';
      if (!instruction) {
        updateSceneDirectorStatus(sceneId, 'Enter a correction first.');
        return;
      }
    }

    setDirectorPending(directorTarget, true);
    updateSceneDirectorStatus(sceneId, 'Director working…');
    startDirectorActivity();
    flushPendingSaves().then(function () {
      return directorRequest({
        storyId: storyId,
        sceneId: sceneId,
        operation: operation,
        model: modelId,
        instruction: instruction
      });
    }).then(function (payload) {
      var generatedPrompt = payload.result || '';
      storyState.director.previousPrompts[sceneId] = previousPrompt;
      return request({
        operation: 'update_scene',
        storyId: storyId,
        sceneId: sceneId,
        scene: {
          prompt: generatedPrompt,
          promptDirectorModel: String(payload.model || modelId),
          promptDirectorJobId: String(payload.jobId || '')
        }
      }).then(function (saved) {
        if (storyState.story && storyState.story.id === storyId && storyState.story.scenes && saved.scene) {
          storyState.story.scenes[sceneId] = saved.scene;
          if (saved.story && saved.story.updatedAt) storyState.story.updatedAt = saved.story.updatedAt;
        }
        var currentRoot = sceneElement(sceneId);
        var currentPrompt = currentRoot && currentRoot.querySelector('[data-scene-field="prompt"]');
        if (currentPrompt) currentPrompt.value = generatedPrompt;
        syncSceneDirectorRestore(sceneId);
        updateSceneDirectorStatus(sceneId, 'Generated with ' + String(payload.model || modelId));
        setSaveState('Saved');
        return refreshLibrary().then(function () {
          return consumeDirectorJob(payload.jobId);
        });
      });
    }).catch(function (err) {
      updateSceneDirectorStatus(sceneId, 'Director failed');
      reportError(err);
    }).finally(function () {
      setDirectorPending(directorTarget, false);
      finishDirectorActivity();
    });
  }

  function setDevelopStatus(text) {
    var node = el('storyboard-develop-status');
    if (node) node.textContent = text || '';
  }

  function directorTargetKey(target) {
    target = target || {};
    var storyId = String(target.storyId || '');
    if (!storyId) return '';
    if (target.kind === 'concept' || target.kind === 'scenes') {
      return 'story-plan:' + storyId;
    }
    if (target.kind === 'scene-prompt' && target.sceneId) {
      return 'scene-prompt:' + storyId + ':' + String(target.sceneId);
    }
    return '';
  }

  function directorTargetPending(target) {
    var key = directorTargetKey(target);
    return !!(key && storyState.director.pendingTargets[key]);
  }

  function setDirectorTargetProtected(target, protectedState) {
    target = target || {};
    if (!storyState.story || String(target.storyId || '') !== String(storyState.story.id || '')) return;
    if (target.kind === 'concept') {
      var concept = el('storyboard-story-concept');
      if (concept) concept.disabled = !!protectedState;
      return;
    }
    if (target.kind === 'scene-prompt') {
      var root = sceneElement(target.sceneId);
      if (!root) return;
      var prompt = root.querySelector('[data-scene-field="prompt"]');
      var correction = root.querySelector('[data-director-correction]');
      if (prompt) prompt.disabled = !!protectedState;
      if (correction) correction.disabled = !!protectedState;
    }
  }

  function syncDirectorPendingControls() {
    var currentStoryId = storyState.story ? String(storyState.story.id || '') : '';
    var storyPlanPending = !!storyState.director.pendingTargets['story-plan:' + currentStoryId];
    ['storyboard-expand-concept-btn', 'storyboard-develop-btn'].forEach(function (id) {
      var node = el(id);
      if (node) node.disabled = storyPlanPending;
    });
    var restore = el('storyboard-restore-concept-btn');
    if (restore) restore.disabled = storyPlanPending;
    var selector = el('storyboard-director-model');
    if (selector) selector.disabled = !storyState.director.available || !(storyState.director.models || []).length;

    Array.prototype.forEach.call(document.querySelectorAll('.storyboard-scene[data-scene-id]'), function (root) {
      var sceneTarget = {
        kind: 'scene-prompt',
        storyId: currentStoryId,
        sceneId: root.dataset.sceneId
      };
      var pending = directorTargetPending(sceneTarget);
      Array.prototype.forEach.call(root.querySelectorAll('[data-director-write], [data-director-refine], [data-director-restore]'), function (button) {
        button.disabled = pending;
      });
    });

    Object.keys(storyState.director.pendingTargets).forEach(function (key) {
      setDirectorTargetProtected(storyState.director.pendingTargets[key], true);
    });
  }

  function setDirectorPending(target, pending) {
    var key = directorTargetKey(target);
    if (!key) throw new Error('Storyboard Director target is missing its Story identity.');

    if (pending) {
      if (storyState.director.pendingTargets[key]) {
        throw new Error('Storyboard Director target is already pending: ' + key);
      }
      storyState.director.pendingTargets[key] = target;
      storyState.director.pendingOrder.push(key);
    } else {
      var existing = storyState.director.pendingTargets[key];
      if (existing) setDirectorTargetProtected(existing, false);
      delete storyState.director.pendingTargets[key];
      storyState.director.pendingOrder = storyState.director.pendingOrder.filter(function (pendingKey) {
        return pendingKey !== key;
      });
    }

    storyState.director.busy = storyState.director.pendingOrder.length > 0;
    storyState.director.activityTarget = storyState.director.pendingOrder.length
      ? storyState.director.pendingTargets[storyState.director.pendingOrder[0]]
      : null;
    syncDirectorPendingControls();
  }

  function expandConcept() {
    if (!storyState.story) return;
    var storyId = storyState.story.id;
    var directorTarget = { kind: 'concept', storyId: storyId };
    if (directorTargetPending(directorTarget)) return;
    var modelId = storyState.director.modelId;
    if (!modelId) {
      reportError(new Error('Choose a Storyboard Director model first.'));
      return;
    }
    var concept = el('storyboard-story-concept').value.trim();
    if (!concept) {
      setDevelopStatus('Write a Story concept first.');
      return;
    }

    setDirectorPending(directorTarget, true);
    setDevelopStatus('Director is expanding the concept…');
    startDirectorActivity();
    flushPendingSaves().then(function () {
      return directorRequest({
        storyId: storyId,
        operation: 'expand_concept',
        model: modelId
      });
    }).then(function (payload) {
      if (!storyState.story || storyState.story.id !== storyId) return;
      storyState.story = payload.story;
      renderStory();
      setDevelopStatus('Concept expanded with ' + String(payload.model || modelId) + '.');
      setSaveState('Saved');
      return refreshLibrary().then(function () {
        return consumeDirectorJob(payload.jobId);
      });
    }).catch(function (err) {
      setDevelopStatus('Concept expansion failed.');
      reportError(err);
    }).finally(function () {
      setDirectorPending(directorTarget, false);
      finishDirectorActivity();
    });
  }

  function restorePreviousConcept() {
    if (!storyState.story || typeof storyState.story.previousConcept !== 'string') return;
    var storyId = storyState.story.id;
    var directorTarget = { kind: 'concept', storyId: storyId };
    if (directorTargetPending(directorTarget)) return;
    setDirectorPending(directorTarget, true);
    setSaveState('Saving...');
    flushPendingSaves().then(function () {
      return request({
        operation: 'restore_previous_concept',
        storyId: storyId
      });
    }).then(function (payload) {
      if (!storyState.story || storyState.story.id !== storyId) return;
      storyState.story = payload.story;
      renderStory();
      setDevelopStatus('Previous concept restored.');
      setSaveState('Saved');
      return refreshLibrary();
    }).catch(reportError).finally(function () {
      setDirectorPending(directorTarget, false);
    });
  }

  function developStory() {
    if (!storyState.story) return;
    var storyId = storyState.story.id;
    var directorTarget = { kind: 'scenes', storyId: storyId };
    if (directorTargetPending(directorTarget)) return;
    var modelId = storyState.director.modelId;
    if (!modelId) {
      reportError(new Error('Choose a Storyboard Director model first.'));
      return;
    }
    var concept = el('storyboard-story-concept').value.trim();
    if (!concept) {
      setDevelopStatus('Write a Story concept first.');
      return;
    }

    var hasScenes = Array.isArray(storyState.story.sceneOrder) && storyState.story.sceneOrder.length > 0;
    if (hasScenes && !window.confirm(
      'Developing this Story again will replace the active Scene plan. Existing Scenes and Takes will remain recoverable in Removed Scenes. Continue?'
    )) return;

    setDirectorPending(directorTarget, true);
    setDevelopStatus('Director is developing the Story…');
    startDirectorActivity();
    flushPendingSaves().then(function () {
      return directorRequest({
        storyId: storyId,
        operation: 'develop_story',
        model: modelId,
        replaceExisting: hasScenes
      });
    }).then(function (payload) {
      if (!storyState.story || storyState.story.id !== storyId) return;
      storyState.story = payload.story;
      storyState.sequenceExport = null;
      storyState.director.previousPrompts = {};
      renderStory();
      setDevelopStatus('Developed ' + String(payload.sceneCount || 0) + ' Scenes with ' + String(payload.model || modelId) + '.');
      setSaveState('Saved');
      return refreshLibrary().then(function () {
        return consumeDirectorJob(payload.jobId);
      });
    }).catch(function (err) {
      setDevelopStatus('Story development failed.');
      reportError(err);
    }).finally(function () {
      setDirectorPending(directorTarget, false);
      finishDirectorActivity();
    });
  }

  function setSaveState(text) {
    var node = el('storyboard-save-state');
    if (node) node.textContent = text || '';
    if (text && typeof reportConsoleInfo === 'function' && text !== 'Saved') {
      reportConsoleInfo('Storyboard', text);
    }
  }

  function storyTagsText(story) {
    return Array.isArray(story && story.tags) ? story.tags.join(', ') : '';
  }

  function invariantRowHtml(item) {
    item = item || {};
    var kind = String(item.kind || 'custom');
    var title = String(item.title || '');
    var text = String(item.text || '');
    var labels = { visual: 'Visual', character: 'Character', world: 'World', sound: 'Sound', custom: 'Custom' };
    return '<div class="storyboard-invariant-row" data-story-invariant-row>' +
      '<select data-story-invariant-kind aria-label="Invariant type">' +
        Object.keys(labels).map(function (value) {
          return '<option value="' + value + '"' + (value === kind ? ' selected' : '') + '>' + labels[value] + '</option>';
        }).join('') +
      '</select>' +
      '<input type="text" data-story-invariant-title value="' + escapeHtml(title) + '" placeholder="Name / subject" aria-label="Invariant name">' +
      '<textarea data-story-invariant-text rows="2" placeholder="What must stay consistent across Scenes?" aria-label="Invariant description">' + escapeHtml(text) + '</textarea>' +
      '<button type="button" class="review-captions-btn" data-story-invariant-remove title="Remove invariant">×</button>' +
    '</div>';
  }

  function storyInvariantsFromUi() {
    var list = el('storyboard-invariants-list');
    if (!list) return [];
    return Array.prototype.map.call(list.querySelectorAll('[data-story-invariant-row]'), function (row) {
      return {
        kind: row.querySelector('[data-story-invariant-kind]').value,
        title: row.querySelector('[data-story-invariant-title]').value,
        text: row.querySelector('[data-story-invariant-text]').value
      };
    }).filter(function (item) { return !!String(item.text || '').trim(); });
  }

  function renderStoryInvariants() {
    var list = el('storyboard-invariants-list');
    if (!list || !storyState.story) return;
    var invariants = Array.isArray(storyState.story.invariants) ? storyState.story.invariants : [];
    list.innerHTML = invariants.map(invariantRowHtml).join('');
  }

  function setStoryCollapsed(collapsed) {
    storyState.storyCollapsed = !!collapsed;
    window.localStorage.setItem('webcap.storyboard.storyCollapsed', storyState.storyCollapsed ? '1' : '0');
    var authoring = el('storyboard-story-authoring');
    var editor = el('storyboard-editor-content');
    var collapseButton = el('storyboard-story-toggle');
    var expandButton = el('storyboard-story-expand-toggle');
    authoring.classList.toggle('hidden', storyState.storyCollapsed);
    editor.classList.toggle('story-collapsed', storyState.storyCollapsed);
    collapseButton.classList.toggle('hidden', storyState.storyCollapsed);
    collapseButton.setAttribute('aria-expanded', storyState.storyCollapsed ? 'false' : 'true');
    expandButton.classList.toggle('hidden', !storyState.storyCollapsed);
    expandButton.setAttribute('aria-expanded', storyState.storyCollapsed ? 'false' : 'true');
  }

  function ensureActiveScene(order) {
    order = Array.isArray(order) ? order : [];
    if (!order.length) {
      storyState.activeSceneId = '';
      return '';
    }
    if (order.indexOf(storyState.activeSceneId) < 0) storyState.activeSceneId = order[0];
    return storyState.activeSceneId;
  }

  function clearSceneNewTakeCount(sceneId) {
    if (!sceneId) return;
    delete storyState.newTakeCounts[sceneId];
  }

  function markSceneNewTake(sceneId) {
    if (!sceneId || !storyState.story) return;
    if (storyState.sceneViewMode === 'focus' && storyState.activeSceneId === sceneId) return;
    storyState.newTakeCounts[sceneId] = Number(storyState.newTakeCounts[sceneId] || 0) + 1;
    renderSceneProgression(storyState.story.sceneOrder || []);
  }

  function renderSceneProgression(order) {
    var host = el('storyboard-scene-progression');
    if (!host || !storyState.story) return;
    order = Array.isArray(order) ? order : [];
    var scenes = storyState.story.scenes || {};
    var active = ensureActiveScene(order);
    host.innerHTML = order.map(function (sceneId, index) {
      var scene = scenes[sceneId] || {};
      var newTakeCount = Number(storyState.newTakeCounts[sceneId] || 0);
      var jobs = generationJobsForScene(sceneId);
      var queuedCount = jobs.filter(function (job) { return String(job.status || '') === 'queued'; }).length;
      var activeCount = jobs.filter(function (job) {
        return ['starting', 'running', 'stopping'].indexOf(String(job.status || '')) !== -1;
      }).length;
      var workBadge = activeCount
        ? '<span class="storyboard-scene-progress-work is-active" title="' + String(activeCount) + ' active generation' + (activeCount === 1 ? '' : 's') + '"></span>'
        : (queuedCount
          ? '<span class="storyboard-scene-progress-work is-queued" title="' + String(queuedCount) + ' queued generation' + (queuedCount === 1 ? '' : 's') + '">Q' + (queuedCount > 1 ? String(queuedCount) : '') + '</span>'
          : '');
      return '<button type="button" class="storyboard-scene-progress-step' + (sceneId === active ? ' active' : '') + '" data-scene-progress="' + escapeHtml(sceneId) + '">' +
        '<span class="storyboard-scene-progress-kicker">Scene ' + String(index + 1).padStart(2, '0') +
          '<span class="storyboard-scene-progress-indicators">' +
            workBadge +
            (newTakeCount ? '<span class="storyboard-scene-progress-badge" title="' + String(newTakeCount) + ' new Take' + (newTakeCount === 1 ? '' : 's') + '">' + String(newTakeCount) + '</span>' : '') +
          '</span>' +
        '</span>' +
        '<strong>' + escapeHtml(scene.title || 'Untitled Scene') + '</strong>' +
      '</button>';
    }).join('') +
      '<button type="button" class="storyboard-scene-progress-add" data-scene-progress-add title="Add Scene" aria-label="Add Scene">+</button>';
  }

  function syncSceneViewControls(order) {
    order = Array.isArray(order) ? order : [];
    if (['overview', 'focus', 'sequence'].indexOf(storyState.sceneViewMode) === -1) storyState.sceneViewMode = 'focus';
    ensureActiveScene(order);
    [
      ['storyboard-scenes-overview-btn', 'overview'],
      ['storyboard-scenes-focus-btn', 'focus'],
      ['storyboard-scenes-sequence-btn', 'sequence']
    ].forEach(function (item) {
      var button = el(item[0]);
      var active = storyState.sceneViewMode === item[1];
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    var modeTitle = el('storyboard-workspace-mode-title');
    if (modeTitle) modeTitle.textContent = storyState.sceneViewMode === 'sequence' ? 'Sequence' : 'Scenes';
    var progression = el('storyboard-scene-progression');
    if (progression) progression.classList.toggle('hidden', storyState.sceneViewMode === 'sequence');
    var directorHeader = document.querySelector('.storyboard-scenes-heading .storyboard-director-header');
    if (directorHeader) directorHeader.classList.toggle('hidden', storyState.sceneViewMode === 'sequence');
    renderSceneProgression(order);
  }

  function setSceneViewMode(mode, sceneId) {
    if (['overview', 'focus', 'sequence'].indexOf(mode) === -1) throw new Error('Unknown Storyboard Scene view.');
    var previousMode = storyState.sceneViewMode;
    return flushPendingSaves().then(function () {
      storyState.sceneViewMode = mode;
      if (sceneId) storyState.activeSceneId = sceneId;
      if (mode === 'focus') {
        var order = storyState.story && Array.isArray(storyState.story.sceneOrder) ? storyState.story.sceneOrder : [];
        clearSceneNewTakeCount(ensureActiveScene(order));
      }
      window.localStorage.setItem('webcap.storyboard.sceneView', mode);
      renderScenes();
      renderSequencePreview();
      if (mode !== previousMode || sceneId) {
        var sceneWorkspace = document.querySelector('.storyboard-scene-workspace');
        if (sceneWorkspace) sceneWorkspace.scrollTop = 0;
      }
    }).catch(reportError);
  }

  function takeMediaUrl(storyId, sceneId, take) {
    var mediaPath = String(take && take.mediaPath ? take.mediaPath : '');
    var filename = mediaPath.split('/').pop();
    var folder = 'output/storyboards/' + storyId + '/takes/' + sceneId;
    return '/caption/media?folder=' + encodeURIComponent(folder) + '&media=' + encodeURIComponent(filename);
  }

  function takePreviewHtml(storyId, sceneId, take) {
    var url = takeMediaUrl(storyId, sceneId, take);
    var path = String(take && take.mediaPath ? take.mediaPath : '').toLowerCase();
    if (/\.(png|jpe?g|webp|gif|bmp)$/.test(path)) {
      return '<img src="' + escapeHtml(url) + '" alt="">';
    }
    return '<video src="' + escapeHtml(url) + '" controls muted preload="metadata"></video>';
  }

  function takeAspectRatioCss(take) {
    var value = String(take && take.aspectRatio || '').trim();
    var match = value.match(/^(\d+)\s*:\s*(\d+)/);
    if (!match) return '16 / 9';
    var width = Number(match[1]);
    var height = Number(match[2]);
    if (!width || !height) return '16 / 9';
    return String(width) + ' / ' + String(height);
  }

  function selectedSequenceItems(story) {
    var selected = [];
    (story.sceneOrder || []).forEach(function (sceneId, index) {
      var scene = (story.scenes || {})[sceneId] || {};
      var takeId = scene.selectedTakeId;
      var take = takeId && scene.takes ? scene.takes[takeId] : null;
      if (!take) return;
      selected.push({ sceneId: sceneId, scene: scene, take: take, number: index + 1 });
    });
    return selected;
  }

  function renderStoryReadiness() {
    var node = el('storyboard-progress-summary');
    if (!node || !storyState.story) return;
    var story = storyState.story;
    var order = Array.isArray(story.sceneOrder) ? story.sceneOrder : [];
    var selected = 0;
    var selectedSeconds = 0;
    var generating = 0;
    var needsTake = 0;
    var needsSelection = 0;

    order.forEach(function (sceneId) {
      var scene = (story.scenes || {})[sceneId] || {};
      var takes = scene.takes && typeof scene.takes === 'object' ? scene.takes : {};
      var takeIds = Array.isArray(scene.takeOrder) ? scene.takeOrder.filter(function (takeId) {
        return !!takes[takeId];
      }) : [];
      var jobs = generationJobsForScene(sceneId);
      if (jobs.length) generating += jobs.length;

      var selectedTake = scene.selectedTakeId && takes[scene.selectedTakeId];
      if (selectedTake) {
        selected += 1;
        var seconds = Number(selectedTake.durationSeconds);
        if (!Number.isFinite(seconds)) seconds = Number(scene.durationSeconds || 0);
        if (Number.isFinite(seconds) && seconds > 0) selectedSeconds += seconds;
      } else if (takeIds.length) {
        needsSelection += 1;
      } else if (!jobs.length) {
        needsTake += 1;
      }
    });

    var parts = [String(order.length) + ' Scene' + (order.length === 1 ? '' : 's')];
    if (selected) parts.push(String(selected) + ' selected');
    if (generating) parts.push(String(generating) + ' generating');
    if (needsTake) parts.push(String(needsTake) + ' needs Take');
    if (needsSelection) parts.push(String(needsSelection) + ' needs selection');
    if (selectedSeconds > 0) {
      var displaySeconds = Math.round(selectedSeconds * 10) / 10;
      parts.push(String(displaySeconds) + 's selected');
    }
    node.textContent = parts.join(' · ');
    node.title = selected === order.length && order.length
      ? 'All Scenes have a selected Take and are ready to export.'
      : 'Story completion summary';
  }

  function assemblyMatchesSelection(job, selected) {
    if (!job || !storyState.story || job.storyId !== storyState.story.id || !Array.isArray(job.selection)) return false;
    if (job.selection.length !== selected.length) return false;
    return job.selection.every(function (item, index) {
      return item.sceneId === selected[index].sceneId && item.takeId === selected[index].take.id;
    });
  }

  function renderSequencePreview() {
    var host = el('storyboard-sequence-preview');
    if (!host || !storyState.story) return;
    var story = storyState.story;
    var selected = selectedSequenceItems(story);
    if (storyState.sceneViewMode !== 'sequence') {
      host.innerHTML = '';
      host.classList.add('hidden');
      return;
    }
    host.classList.remove('hidden');
    if (!selected.length) {
      host.innerHTML = '<header class="storyboard-sequence-header"><div><strong>Selected sequence</strong><span>No Takes selected yet</span></div></header>' +
        '<div class="storyboard-sequence-empty">Select a Take in one or more Scenes to build the sequence.</div>';
      return;
    }
    var assembly = storyState.sequenceExport;
    var assemblyCurrent = assemblyMatchesSelection(assembly, selected) && assembly.current !== false;
    var assemblyStatus = '';
    if (assemblyCurrent) assemblyStatus = 'Exported · ' + String(assembly.itemCount || selected.length) + ' Takes';
    else if (assembly && !assemblyCurrent) assemblyStatus = 'Selection changed since last export';

    var outputHtml = '';
    if (assemblyCurrent) {
      var outputUrl = '/caption/media?folder=' + encodeURIComponent(assembly.folder) +
        '&media=' + encodeURIComponent(assembly.media);
      outputHtml = '<div class="storyboard-sequence-output"><video src="' + escapeHtml(outputUrl) +
        '" controls preload="metadata"></video></div>';
    }

    host.innerHTML = '<header class="storyboard-sequence-header"><div><strong>Selected sequence</strong><span>' +
      selected.length + ' selected Take' + (selected.length === 1 ? '' : 's') +
      '</span></div><div class="storyboard-sequence-actions">' +
      '<button type="button" class="review-captions-btn" data-sequence-toggle aria-expanded="' + (storyState.sequenceCollapsed ? 'false' : 'true') + '">' +
        (storyState.sequenceCollapsed ? 'Show' : 'Hide') +
      '</button>' +
      '<button type="button" class="storyboard-primary-btn" data-sequence-export>Export Sequence</button>' +
      '<span class="storyboard-save-state" data-sequence-status>' + assemblyStatus + '</span>' +
      '</div></header><div class="storyboard-sequence-body' + (storyState.sequenceCollapsed ? ' hidden' : '') + '">' +
      outputHtml + '<div class="storyboard-sequence-list">' +
      selected.map(function (item) {
        return '<article class="storyboard-sequence-card">' +
          '<div class="storyboard-sequence-label">Scene ' + String(item.number).padStart(2, '0') + ' · ' +
            escapeHtml(item.scene.title || 'Untitled Scene') + '</div>' +
          '<div class="storyboard-sequence-media">' + takePreviewHtml(story.id, item.sceneId, item.take) + '</div>' +
        '</article>';
      }).join('') + '</div></div>';
  }

  function refreshSequenceExport(storyId) {
    return assemblyRequest(null, 'story=' + encodeURIComponent(storyId)).then(function (payload) {
      if (storyState.story && storyState.story.id === storyId) {
        storyState.sequenceExport = payload.export || null;
        renderSequencePreview();
      }
      return payload;
    });
  }

  function exportSelectedSequence() {
    if (!storyState.story) return;
    var storyId = storyState.story.id;
    setSaveState('Exporting sequence...');
    flushPendingSaves().then(function () {
      return assemblyRequest({ storyId: storyId });
    }).then(function (payload) {
      if (storyState.story && storyState.story.id === storyId) {
        storyState.sequenceExport = payload.export || null;
        renderSequencePreview();
      }
      setSaveState('Saved');
    }).catch(reportError);
  }

  function closeStoryActionMenus(exceptMenu) {
    document.querySelectorAll('.storyboard-story-menu[open]').forEach(function (menu) {
      if (menu !== exceptMenu) menu.open = false;
    });
  }

  function positionStoryActionMenu(menu) {
    if (!menu || !menu.open) return;
    var summary = menu.querySelector('summary');
    var popover = menu.querySelector('.storyboard-story-menu-popover');
    if (!summary || !popover) return;

    var anchorRect = summary.getBoundingClientRect();
    var width = popover.offsetWidth || 150;
    var height = popover.offsetHeight || 0;
    var gap = 4;
    var margin = 8;
    var left = Math.min(
      Math.max(margin, anchorRect.right - width),
      Math.max(margin, window.innerWidth - width - margin)
    );
    var below = anchorRect.bottom + gap;
    var above = anchorRect.top - height - gap;
    var top = below + height <= window.innerHeight - margin || above < margin
      ? below
      : above;

    popover.style.left = Math.round(left) + 'px';
    popover.style.top = Math.round(Math.max(margin, top)) + 'px';
  }

  function renderLibrary() {
    var host = el('storyboard-library-list');
    if (!host) return;
    var stories = Array.isArray(storyState.stories) ? storyState.stories : [];
    if (!stories.length) {
      host.innerHTML = '<div class="storyboard-library-empty">No Stories yet.</div>';
      return;
    }

    var pinned = stories.filter(function (story) { return !!story.pinned; });
    var recent = stories.filter(function (story) { return !story.pinned && story.status !== 'archived'; });
    var archived = stories.filter(function (story) { return !story.pinned && story.status === 'archived'; });

    function rows(items) {
      return items.map(function (story) {
        var active = storyState.story && storyState.story.id === story.id;
        var meta = [];
        if (story.status && story.status !== 'active') meta.push(story.status);
        meta.push(String(Number(story.sceneCount || 0)) + ' scene' + (Number(story.sceneCount || 0) === 1 ? '' : 's'));
        return '<div class="storyboard-story-row' + (active ? ' active' : '') + '" data-story-id="' + escapeHtml(story.id) + '">' +
          '<button type="button" class="storyboard-story-open" data-story-open>' +
            '<strong>' + escapeHtml(story.title || 'Untitled Story') + '</strong>' +
            '<span>' + escapeHtml(meta.join(' · ')) + '</span>' +
          '</button>' +
          '<details class="storyboard-story-menu">' +
            '<summary aria-label="Story actions">⋯</summary>' +
            '<div class="storyboard-story-menu-popover">' +
              '<button type="button" data-story-action="duplicate">Duplicate</button>' +
              '<button type="button" data-story-action="pin">' + (story.pinned ? 'Unpin' : 'Pin') + '</button>' +
              '<button type="button" data-story-action="archive">' + (story.status === 'archived' ? 'Restore' : 'Archive') + '</button>' +
              '<button type="button" data-story-action="export">Export</button>' +
              '<button type="button" class="danger" data-story-action="delete">Delete…</button>' +
            '</div>' +
          '</details>' +
        '</div>';
      }).join('');
    }

    var html = '';
    if (pinned.length) html += '<div class="storyboard-list-section-title">Pinned</div>' + rows(pinned);
    if (recent.length) html += '<div class="storyboard-list-section-title">Recent</div>' + rows(recent);
    if (archived.length) html += '<div class="storyboard-list-section-title">Archived</div>' + rows(archived);
    host.innerHTML = html;
  }

  function sceneValue(scene, key, fallback) {
    var value = scene && scene[key];
    return value == null ? fallback : value;
  }

  function syncSceneGenerationDefaultHints() {
    var aspectNode = el('storyboard-story-aspect-ratio');
    var megapixelsNode = el('storyboard-story-megapixels');
    if (!aspectNode || !megapixelsNode) return;
    var aspectRatio = aspectNode.value || '4:3 (Standard)';
    var megapixels = megapixelsNode.value || '0.2';
    Array.prototype.forEach.call(document.querySelectorAll('[data-scene-field="aspectRatio"]'), function (select) {
      var inherit = select.querySelector('option[value=""]');
      if (inherit) inherit.textContent = 'Inherit · ' + aspectRatio;
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-scene-field="megapixels"]'), function (input) {
      input.placeholder = 'Inherit · ' + megapixels;
    });
  }

  function seedInheritedSceneMegapixels(input) {
    if (!input || String(input.value || '').trim() !== '') return;
    var defaults = storyState.story && storyState.story.generationDefaults || {};
    input.value = String(defaults.megapixels == null ? 0.2 : defaults.megapixels);
  }

  function loraOptions(selectedName) {
    var names = (storyState.generationCapabilities.loras || []).slice();
    if (selectedName && names.indexOf(selectedName) < 0) names.unshift(selectedName);
    if (!names.length) return '<option value="">No selectable LoRAs</option>';
    return names.map(function (name) {
      return '<option value="' + escapeHtml(name) + '"' + (name === selectedName ? ' selected' : '') + '>' +
        escapeHtml(name) + '</option>';
    }).join('');
  }

  function loraNamesMatching(query, excludedNames) {
    var needle = String(query || '').trim().toLowerCase();
    var excluded = {};
    (excludedNames || []).forEach(function (name) {
      excluded[String(name || '').toLowerCase()] = true;
    });
    return (storyState.generationCapabilities.loras || []).filter(function (name) {
      var key = String(name || '').toLowerCase();
      return !excluded[key] && (!needle || key.indexOf(needle) !== -1);
    });
  }

  function availableLoraName(typedName, excludedNames) {
    var typed = String(typedName || '').trim().toLowerCase();
    if (!typed) return '';
    return loraNamesMatching('', excludedNames).find(function (name) {
      return String(name || '').toLowerCase() === typed;
    }) || '';
  }

  function loraPickerMenuFor(picker) {
    var wrap = picker && picker.closest('.storyboard-lora-picker-wrap');
    return wrap && wrap.querySelector('[data-lora-picker-menu]');
  }

  function loraPickerExcludedNames(picker) {
    if (!picker) return [];
    if (picker.id === 'storyboard-story-lora-picker') {
      return storyLorasFromUi().map(function (item) { return item.name; });
    }
    var scene = picker.closest('.storyboard-scene[data-scene-id]');
    if (!scene) throw new Error('LoRA picker Scene is missing.');
    var names = storyLorasFromUi().map(function (item) { return item.name; });
    Array.prototype.forEach.call(scene.querySelectorAll('[data-scene-lora-row]'), function (row) {
      var select = row.querySelector('[data-scene-lora-name]');
      if (select && select.value) names.push(select.value);
    });
    return names;
  }

  function setLoraPickerActive(menu, index) {
    var options = Array.prototype.slice.call(menu.querySelectorAll('[data-lora-picker-option]'));
    if (!options.length) {
      menu.dataset.activeIndex = '-1';
      return;
    }
    var next = Math.max(0, Math.min(index, options.length - 1));
    menu.dataset.activeIndex = String(next);
    options.forEach(function (option, optionIndex) {
      option.classList.toggle('active', optionIndex === next);
    });
    options[next].scrollIntoView({ block: 'nearest' });
  }

  function renderLoraPickerMenu(picker) {
    var menu = loraPickerMenuFor(picker);
    if (!menu) throw new Error('LoRA picker menu is missing.');
    var matches = loraNamesMatching(picker.value, loraPickerExcludedNames(picker));
    menu.innerHTML = matches.length
      ? matches.map(function (name) {
          return '<button type="button" class="storyboard-lora-picker-option" data-lora-picker-option="' +
            escapeHtml(name) + '" role="option">' + escapeHtml(name) + '</button>';
        }).join('')
      : '<div class="storyboard-lora-picker-empty">No matching LoRAs</div>';
    menu.classList.remove('hidden');
    picker.setAttribute('aria-expanded', 'true');
    setLoraPickerActive(menu, matches.length ? 0 : -1);
  }

  function closeLoraPicker(picker) {
    var menu = loraPickerMenuFor(picker);
    if (!menu) return;
    menu.classList.add('hidden');
    menu.dataset.activeIndex = '-1';
    picker.setAttribute('aria-expanded', 'false');
  }

  function closeAllLoraPickers() {
    Array.prototype.forEach.call(document.querySelectorAll('.storyboard-lora-picker[aria-expanded="true"]'), function (picker) {
      closeLoraPicker(picker);
    });
  }

  function chooseLoraPickerOption(picker, name) {
    var selectedName = availableLoraName(name, loraPickerExcludedNames(picker));
    if (!selectedName) return;

    if (picker.id === 'storyboard-story-lora-picker') {
      el('storyboard-story-lora-list').insertAdjacentHTML('beforeend', storyLoraRowHtml({ name: selectedName, strength: 1 }));
      picker.value = '';
      closeLoraPicker(picker);
      syncStoryLorasIntoScenes();
      scheduleStorySave();
      picker.focus();
      return;
    }

    var scene = picker.closest('.storyboard-scene[data-scene-id]');
    if (!scene) throw new Error('LoRA picker Scene is missing.');
    var list = scene.querySelector('[data-scene-lora-list]');
    if (!list) throw new Error('LoRA list is missing.');
    list.insertAdjacentHTML('beforeend', sceneLoraRowHtml({ name: selectedName, strength: 1 }));
    picker.value = '';
    closeLoraPicker(picker);
    scheduleSceneSave(scene.dataset.sceneId);
    picker.focus();
  }

  function handleLoraPickerKeydown(event) {
    var picker = event.target.closest('.storyboard-lora-picker');
    if (!picker) return;
    var menu = loraPickerMenuFor(picker);
    if (!menu) throw new Error('LoRA picker menu is missing.');

    if (event.key === 'Escape') {
      closeLoraPicker(picker);
      return;
    }

    if (menu.classList.contains('hidden')) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        renderLoraPickerMenu(picker);
      }
      return;
    }

    var options = Array.prototype.slice.call(menu.querySelectorAll('[data-lora-picker-option]'));
    var active = Number(menu.dataset.activeIndex || 0);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setLoraPickerActive(menu, Math.min(active + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setLoraPickerActive(menu, Math.max(active - 1, 0));
    } else if (event.key === 'Enter' && options.length) {
      event.preventDefault();
      chooseLoraPickerOption(picker, options[Math.max(0, active)].dataset.loraPickerOption);
    }
  }

  function storyLorasFromUi() {
    var list = el('storyboard-story-lora-list');
    if (!list) return [];
    return Array.prototype.map.call(list.querySelectorAll('[data-story-lora-row]'), function (row) {
      var item = {
        name: row.querySelector('[data-story-lora-name]').value,
        strength: row.querySelector('[data-story-lora-strength]').value
      };
      if (!row.querySelector('[data-story-lora-global-enabled]').checked) item.enabled = false;
      return item;
    }).filter(function (item) { return !!item.name; });
  }

  function storyLoraRowHtml(lora) {
    lora = lora || {};
    var name = String(lora.name || '');
    var strength = lora.strength == null ? 1 : lora.strength;
    var enabled = lora.enabled !== false;
    return '<div class="storyboard-lora-row storyboard-lora-row-story" data-story-lora-row>' +
      '<label class="storyboard-lora-enabled storyboard-lora-story-enabled" title="Enable this Story LoRA">' +
        '<input type="checkbox" data-story-lora-global-enabled' + (enabled ? ' checked' : '') +
          ' aria-label="Enable Story LoRA ' + escapeHtml(name) + '">' +
      '</label>' +
      '<select data-story-lora-name>' + loraOptions(name) + '</select>' +
      '<input type="number" step="0.05" data-story-lora-strength value="' + escapeHtml(strength) + '" aria-label="Story LoRA strength">' +
      '<button type="button" class="review-captions-btn" data-story-lora-remove title="Remove Story LoRA">×</button>' +
    '</div>';
  }

  function renderStoryLoras() {
    var list = el('storyboard-story-lora-list');
    var status = el('storyboard-story-lora-status');
    if (!list || !status || !storyState.story) return;
    var loras = Array.isArray(storyState.story.loras) ? storyState.story.loras : [];
    list.innerHTML = loras.map(storyLoraRowHtml).join('');
    var picker = el('storyboard-story-lora-picker');
    if (picker) {
      picker.value = '';
      closeLoraPicker(picker);
    }
    status.textContent = storyState.generationCapabilities.available
      ? (loras.length ? 'Applied to every Scene by default.' : 'No Story-wide LoRAs.')
      : (storyState.generationCapabilities.error || 'ComfyUI LoRAs unavailable.');
  }

  function sceneLoraRowHtml(lora) {
    lora = lora || {};
    var name = String(lora.name || '');
    var strength = lora.strength == null ? 1 : lora.strength;
    return '<div class="storyboard-lora-row" data-scene-lora-row>' +
      '<select data-scene-lora-name>' + loraOptions(name) + '</select>' +
      '<input type="number" step="0.05" data-scene-lora-strength value="' + escapeHtml(strength) + '" aria-label="Scene LoRA strength">' +
      '<button type="button" class="review-captions-btn" data-scene-lora-remove title="Remove Scene LoRA">×</button>' +
    '</div>';
  }

  function storyLoraOverrideMap(scene) {
    var result = {};
    var overrides = Array.isArray(scene && scene.storyLoraOverrides) ? scene.storyLoraOverrides : [];
    overrides.forEach(function (item) {
      if (item && item.name) result[String(item.name).toLowerCase()] = item;
    });
    return result;
  }

  function inheritedLoraRowHtml(lora, override) {
    lora = lora || {};
    override = override || {};
    var storyEnabled = lora.enabled !== false;
    var enabled = override.enabled !== false;
    var defaultStrength = Number(lora.strength == null ? 1 : lora.strength);
    var strength = override.strength == null ? defaultStrength : Number(override.strength);
    var disabledAttr = storyEnabled ? '' : ' disabled';
    return '<div class="storyboard-lora-row storyboard-lora-row-inherited' + (storyEnabled ? '' : ' storyboard-lora-row-story-disabled') +
      '" data-story-lora-inherited-row data-lora-name="' +
      escapeHtml(lora.name || '') + '" data-story-default-strength="' + escapeHtml(defaultStrength) + '">' +
      '<label class="storyboard-lora-enabled" title="' + escapeHtml(storyEnabled ? 'Use this Story LoRA in this Scene' : 'Disabled at Story level') +
        '"><input type="checkbox" data-story-lora-enabled' + (enabled ? ' checked' : '') + disabledAttr + '><span>Story</span></label>' +
      '<span class="storyboard-lora-inherited-name" title="' + escapeHtml(lora.name || '') + '">' + escapeHtml(lora.name || '') + '</span>' +
      '<input type="number" step="0.05" data-story-lora-scene-strength value="' + escapeHtml(strength) +
        '" aria-label="Inherited Story LoRA strength"' + disabledAttr + '>' +
    '</div>';
  }

  function syncStoryLorasIntoScenes() {
    var storyLoras = storyLorasFromUi();
    var storyNames = storyLoras.map(function (item) { return item.name; });
    Array.prototype.forEach.call(document.querySelectorAll('.storyboard-scene[data-scene-id]'), function (root) {
      var list = root.querySelector('[data-story-lora-inherited-list]');
      if (!list) return;
      var previous = {};
      Array.prototype.forEach.call(list.querySelectorAll('[data-story-lora-inherited-row]'), function (row) {
        var name = String(row.dataset.loraName || '').toLowerCase();
        var defaultStrength = Number(row.dataset.storyDefaultStrength);
        var input = row.querySelector('[data-story-lora-scene-strength]');
        previous[name] = {
          enabled: !!row.querySelector('[data-story-lora-enabled]').checked,
          strength: Number(input.value),
          overridden: Number(input.value) !== defaultStrength
        };
      });
      var sceneId = root.dataset.sceneId;
      var scene = storyState.story && storyState.story.scenes ? storyState.story.scenes[sceneId] : {};
      var stored = storyLoraOverrideMap(scene);
      list.innerHTML = storyLoras.map(function (lora) {
        var key = String(lora.name || '').toLowerCase();
        var old = previous[key];
        var override = old
          ? { enabled: old.enabled, strength: old.overridden ? old.strength : null }
          : (stored[key] || {});
        return inheritedLoraRowHtml(lora, override);
      }).join('');
      var picker = root.querySelector('[data-scene-lora-picker]');
      if (picker) {
        if (picker.value && !availableLoraName(picker.value, loraPickerExcludedNames(picker))) picker.value = '';
        closeLoraPicker(picker);
      }
    });
  }

  function takeMetaLabel(take) {
    var parts = [take && take.generated ? 'Generated' : 'Imported'];
    var createdAt = take && take.createdAt ? new Date(take.createdAt) : null;
    if (createdAt && !Number.isNaN(createdAt.getTime())) {
      parts.push(createdAt.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      }));
    }
    if (take && take.generated && take.seed !== undefined && take.seed !== null && take.seed !== '') {
      parts.push('Seed ' + String(take.seed));
    }
    return parts.join(' · ');
  }

  function takeEffectiveInputHtml(take) {
    if (!take || !take.generated || !take.effectiveInput) return '';
    var input = take.effectiveInput || {};
    var references = input.references && typeof input.references === 'object' ? input.references : {};
    var loras = Array.isArray(input.loras) ? input.loras : [];
    var facts = [
      'Duration: ' + String(input.durationSeconds == null ? '' : input.durationSeconds) + 's',
      'Aspect: ' + String(input.aspectRatio || ''),
      'Megapixels: ' + String(input.megapixels == null ? '' : input.megapixels),
      'Seed: ' + String(input.seed == null ? '' : input.seed),
      'Prompt mode: ' + String(input.promptMode || '')
    ].filter(function (value) { return !/:\s*$/.test(value); });

    var referenceLines = Object.keys(references).map(function (role) {
      return role + ': ' + String(references[role] || '');
    });
    var loraLines = loras.map(function (item) {
      return String(item.name || '') + ' @ ' + String(item.strength == null ? 1 : item.strength);
    });

    return '<details class="storyboard-take-effective-input">' +
      '<summary>Effective H3 Input</summary>' +
      '<div class="storyboard-take-effective-input-body">' +
        '<div class="storyboard-effective-input-meta">' + escapeHtml(facts.join(' · ')) + '</div>' +
        '<strong>Exact prompt sent to ComfyUI</strong>' +
        '<pre>' + escapeHtml(String(input.prompt || take.prompt || '')) + '</pre>' +
        (referenceLines.length ? '<strong>Reference inputs</strong><pre>' + escapeHtml(referenceLines.join('\n')) + '</pre>' : '') +
        (loraLines.length ? '<strong>Effective LoRAs</strong><pre>' + escapeHtml(loraLines.join('\n')) + '</pre>' : '') +
      '</div>' +
    '</details>';
  }

  function takeCardHtml(storyId, sceneId, takeId, take, takeIndex, selectedTakeId) {
    var rating = Math.max(0, Math.min(5, Number(take && take.rating || 0)));
    var selected = selectedTakeId === takeId;
    var ratingHtml = '<div class="storyboard-take-rating" aria-label="Rate this Take">';
    [1, 2, 3, 4, 5].forEach(function (value) {
      ratingHtml += '<button type="button" class="storyboard-take-star' + (value <= rating ? ' active' : '') +
        '" data-take-rating="' + escapeHtml(takeId) + '" data-rating-value="' + value +
        '" title="Rate ' + value + ' star' + (value === 1 ? '' : 's') + '" aria-label="Rate ' + value + ' star' + (value === 1 ? '' : 's') + '">' +
        (value <= rating ? '★' : '☆') + '</button>';
    });
    ratingHtml += '</div>';
    return '<article class="storyboard-take' + (selected ? ' selected' : '') + '" data-take-id="' + escapeHtml(takeId) + '">' +
      '<div class="storyboard-take-media" style="--take-aspect: ' + escapeHtml(takeAspectRatioCss(take)) + ';">' + takePreviewHtml(storyId, sceneId, take) +
        '<button type="button" class="storyboard-take-remove" data-take-action="remove" data-take-id="' + escapeHtml(takeId) + '" title="Remove Take" aria-label="Remove Take">×</button>' +
      '</div>' +
      '<div class="storyboard-take-footer">' +
        '<div class="storyboard-take-identity" title="' + escapeHtml(take.sourceFilename || '') + '">' +
          '<strong>Take ' + String(takeIndex + 1).padStart(2, '0') + '</strong>' +
          '<span>' + escapeHtml(takeMetaLabel(take)) + '</span>' +
          '<input type="text" maxlength="120" data-take-label="' + escapeHtml(takeId) + '" value="' + escapeHtml(take.label || '') + '" placeholder="Label this Take…" aria-label="Take label">' +
        '</div>' +
        ratingHtml +
        '<button type="button" class="review-captions-btn" data-take-action="select" data-take-id="' + escapeHtml(takeId) + '"' + (selected ? ' disabled' : '') + '>' + (selected ? 'Selected' : 'Select') + '</button>' +
        '<button type="button" class="review-captions-btn storyboard-take-delete" data-take-action="delete" data-take-id="' + escapeHtml(takeId) + '">Delete</button>' +
      '</div>' +
      takeEffectiveInputHtml(take) +
    '</article>';
  }

  function pendingTakeCardHtml(job, takeIndex) {
    var status = String(job && job.status || '');
    var queuePosition = Number(job && job.queuePosition || 0);
    var statusText = status === 'queued'
      ? ('Queued' + (queuePosition ? ' · #' + queuePosition : ''))
      : status === 'starting'
        ? 'Starting…'
        : status === 'stopping'
          ? 'Stopping…'
          : ('Generating…' + (job && job.comfyStatus ? ' · ' + String(job.comfyStatus).replace(/_/g, ' ') : ''));
    var action = status === 'queued'
      ? '<button type="button" class="review-captions-btn" data-generation-action="cancel" data-job-id="' + escapeHtml(job.jobId) + '">Cancel</button>'
      : (status === 'starting' || status === 'running')
        ? '<button type="button" class="review-captions-btn" data-generation-action="stop" data-job-id="' + escapeHtml(job.jobId) + '">Stop</button>'
        : '';
    return '<article class="storyboard-take storyboard-take-pending" data-generation-job-id="' + escapeHtml(job.jobId) + '">' +
      '<div class="storyboard-take-media storyboard-take-pending-media"><div class="storyboard-take-pending-indicator" aria-hidden="true"></div><strong>' + escapeHtml(statusText) + '</strong></div>' +
      '<div class="storyboard-take-footer storyboard-take-pending-footer">' +
        '<div class="storyboard-take-identity"><strong>Take ' + String(takeIndex + 1).padStart(2, '0') + '</strong><span>' + escapeHtml(statusText) + '</span></div>' +
        action +
      '</div>' +
    '</article>';
  }

  function activeTakeOptions(story, selectedTakeId) {
    var options = '<option value="">Choose a Take</option>';
    (story.sceneOrder || []).forEach(function (sourceSceneId, sceneIndex) {
      var sourceScene = (story.scenes || {})[sourceSceneId] || {};
      (sourceScene.takeOrder || []).forEach(function (takeId, takeIndex) {
        if (!sourceScene.takes || !sourceScene.takes[takeId]) return;
        options += '<option value="' + escapeHtml(sourceSceneId + '|' + takeId) + '"' +
          (takeId === selectedTakeId ? ' selected' : '') + '>Scene ' +
          String(sceneIndex + 1).padStart(2, '0') + ' · Take ' + String(takeIndex + 1).padStart(2, '0') +
          '</option>';
      });
    });
    return options;
  }

  function referenceForRole(scene, role) {
    var references = Array.isArray(scene && scene.references) ? scene.references : [];
    for (var i = 0; i < references.length; i += 1) {
      if (references[i] && references[i].role === role) return references[i];
    }
    return null;
  }

  function removedScenesHtml(removedScenes) {
    removedScenes = removedScenes && typeof removedScenes === 'object' ? removedScenes : {};
    var ids = Object.keys(removedScenes);
    if (!ids.length) return '';
    return '<details class="storyboard-removed-scenes">' +
      '<summary><span>Removed Scenes</span><span class="storyboard-removed-scenes-count">' + String(ids.length) + '</span></summary>' +
      '<div class="storyboard-removed-scenes-list">' +
        ids.map(function (sceneId) {
          var scene = removedScenes[sceneId] || {};
          return '<div class="storyboard-removed-scene" data-removed-scene-id="' + escapeHtml(sceneId) + '">' +
            '<span class="storyboard-removed-scene-title">' + escapeHtml(scene.title || 'Untitled Scene') + '</span>' +
            '<button type="button" class="storyboard-restore-scene-btn" data-restore-scene="' + escapeHtml(sceneId) + '" title="Restore Scene">↺ Restore</button>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</details>';
  }

  function renderScenes() {
    var host = el('storyboard-scenes-list');
    if (!host || !storyState.story) return;
    var story = storyState.story;
    var order = Array.isArray(story.sceneOrder) ? story.sceneOrder : [];
    var scenes = story.scenes || {};
    var removedScenes = story.removedScenes || {};
    var storyLoras = Array.isArray(story.loras) ? story.loras : [];
    var activeStoryLoras = storyLoras.filter(function (lora) { return lora && lora.enabled !== false; });

    syncSceneViewControls(order);
    if (storyState.sceneViewMode === 'sequence') {
      host.classList.remove('is-focus', 'is-overview');
      host.classList.add('is-sequence');
      host.innerHTML = '';
      return;
    }
    host.classList.remove('is-sequence');
    if (storyState.sceneViewMode === 'overview') {
      host.classList.remove('is-focus');
      host.classList.add('is-overview');
      var overviewHtml = order.map(function (sceneId, index) {
        var scene = scenes[sceneId] || {};
        var takeCount = Array.isArray(scene.takeOrder) ? scene.takeOrder.length : 0;
        var pendingTakeCount = generationJobsForScene(sceneId).length;
        return '<button type="button" class="storyboard-scene-overview-card" data-scene-open="' + escapeHtml(sceneId) + '">' +
          '<span class="storyboard-scene-overview-number">Scene ' + String(index + 1).padStart(2, '0') + '</span>' +
          '<strong>' + escapeHtml(scene.title || 'Untitled Scene') + '</strong>' +
          '<span class="storyboard-scene-overview-summary">' + escapeHtml(scene.summary || 'No Scene intent yet.') + '</span>' +
          '<span class="storyboard-scene-overview-meta">' + String(takeCount) + ' Take' + (takeCount === 1 ? '' : 's') +
            (pendingTakeCount ? ' · ' + String(pendingTakeCount) + ' pending' : '') +
            (scene.selectedTakeId ? ' · selected' : '') + '</span>' +
        '</button>';
      }).join('');
      overviewHtml += removedScenesHtml(removedScenes);
      host.innerHTML = overviewHtml || '<div class="storyboard-library-empty">No Scenes yet. Add the first generatable scene.</div>';
      return;
    }

    host.classList.remove('is-overview');
    host.classList.add('is-focus');
    var focusedSceneId = ensureActiveScene(order);
    var renderOrder = focusedSceneId ? [focusedSceneId] : [];

    var activeHtml = renderOrder.map(function (sceneId) {
      var index = order.indexOf(sceneId);
      var scene = scenes[sceneId] || {};
      var planDirectorModel = String(scene.planDirectorModel || '').trim();
      var promptDirectorModel = String(scene.promptDirectorModel || '').trim();
      var seedMode = sceneValue(scene, 'seedMode', 'random');
      var seed = sceneValue(scene, 'seed', '');
      var seedDisplay = seedMode === 'fixed' && seed !== '' && seed != null ? seed : -1;
      var sceneReferences = Array.isArray(scene.references) ? scene.references : [];
      var takes = scene.takes && typeof scene.takes === 'object' ? scene.takes : {};
      var removedTakes = scene.removedTakes && typeof scene.removedTakes === 'object' ? scene.removedTakes : {};
      var takeOrder = Array.isArray(scene.takeOrder) ? scene.takeOrder : [];
      var previousSceneId = index > 0 ? order[index - 1] : '';
      var previousScene = previousSceneId ? scenes[previousSceneId] || {} : {};
      var previousSelectedTakeId = previousScene.selectedTakeId || '';
      var sceneGenerationJobs = generationJobsForScene(sceneId);
      var storyGenerationDefaults = story.generationDefaults || {};
      var inheritedAspectRatio = storyGenerationDefaults.aspectRatio || '4:3 (Standard)';
      var inheritedMegapixels = storyGenerationDefaults.megapixels == null ? 0.2 : storyGenerationDefaults.megapixels;
      var sceneAspectRatio = scene.aspectRatio == null ? '' : scene.aspectRatio;
      var sceneMegapixels = scene.megapixels == null ? '' : scene.megapixels;
      var sceneLoras = Array.isArray(scene.loras) ? scene.loras : [];
      var overrides = storyLoraOverrideMap(scene);
      var inheritedLoraRowsHtml = storyLoras.map(function (lora) {
        return inheritedLoraRowHtml(lora, overrides[String(lora.name || '').toLowerCase()]);
      }).join('');
      var loraRowsHtml = sceneLoras.map(sceneLoraRowHtml).join('');
      var baseLoras = storyState.generationCapabilities.baseLoras || [];
      var loraStatusTitle = storyState.generationCapabilities.available
        ? (baseLoras.length ? 'Base: ' + baseLoras.join(', ') : 'ComfyUI LoRAs loaded.')
        : (storyState.generationCapabilities.error || 'ComfyUI LoRAs unavailable.');
      var loraStatusText = storyState.generationCapabilities.available
        ? (baseLoras.length ? 'Base LoRA active' : 'LoRAs ready')
        : 'LoRAs unavailable';
      var referencesHtml = sceneReferences.map(function (reference) {
        if (!reference || !reference.role) return '';
        return '<span class="storyboard-reference-chip">' +
          escapeHtml(reference.role.replace(/_/g, ' ')) + ' · ' +
          escapeHtml(reference.frame || reference.sourceFilename || reference.source || 'source') +
          '<button type="button" data-reference-clear="' + escapeHtml(reference.role) + '" title="Clear reference" aria-label="Clear reference">×</button>' +
        '</span>';
      }).join('');
      var conditioningSummaryParts = [];
      if (activeStoryLoras.length) conditioningSummaryParts.push(String(activeStoryLoras.length) + ' inherited');
      var overrideCount = Object.keys(overrides).length;
      if (overrideCount) conditioningSummaryParts.push(String(overrideCount) + ' override' + (overrideCount === 1 ? '' : 's'));
      if (sceneLoras.length) conditioningSummaryParts.push(String(sceneLoras.length) + ' Scene');
      if (sceneReferences.length) conditioningSummaryParts.push(String(sceneReferences.length) + ' ref' + (sceneReferences.length === 1 ? '' : 's'));
      var conditioningSummary = conditioningSummaryParts.length ? conditioningSummaryParts.join(' · ') : 'None';
      var removedTakeIds = Object.keys(removedTakes);
      var removedTakesHtml = removedTakeIds.length
        ? '<div class="storyboard-removed-takes"><span>Removed Takes</span>' +
          removedTakeIds.map(function (takeId) {
            var take = removedTakes[takeId] || {};
            return '<span class="storyboard-removed-take-actions">' +
              '<button type="button" class="review-captions-btn" data-take-action="restore" data-take-id="' +
                escapeHtml(takeId) + '">Restore ' + escapeHtml(take.sourceFilename || takeId) + '</button>' +
              '<button type="button" class="review-captions-btn storyboard-take-delete" data-take-action="delete" data-take-id="' +
                escapeHtml(takeId) + '">Delete</button>' +
            '</span>';
          }).join('') + '</div>'
        : '';
      var takesHtml = takeOrder.map(function (takeId, takeIndex) {
        var take = takes[takeId];
        return take ? takeCardHtml(story.id, sceneId, takeId, take, takeIndex, scene.selectedTakeId) : '';
      }).join('');
      var pendingTakesHtml = sceneGenerationJobs.map(function (job, pendingIndex) {
        return pendingTakeCardHtml(job, takeOrder.length + pendingIndex);
      }).join('');
      var takeSummaryParts = [
        String(takeOrder.length) + ' Take' + (takeOrder.length === 1 ? '' : 's')
      ];
      if (scene.selectedTakeId) takeSummaryParts.push('1 selected');
      if (sceneGenerationJobs.length) {
        takeSummaryParts.push(String(sceneGenerationJobs.length) + ' pending');
      }
      return '<section class="storyboard-scene" data-scene-id="' + escapeHtml(sceneId) + '">' +
        '<header class="storyboard-scene-header">' +
          '<span class="storyboard-scene-number"' +
            (planDirectorModel ? ' title="Scene plan originated from Director model ' + escapeHtml(planDirectorModel) + '"' : '') +
          '>Scene ' + String(index + 1).padStart(2, '0') + '</span>' +
          '<details class="storyboard-scene-menu">' +
            '<summary title="Scene actions" aria-label="Scene actions">•••</summary>' +
            '<div class="storyboard-scene-menu-popover">' +
              '<button type="button" data-scene-action="duplicate">Duplicate Scene</button>' +
              '<button type="button" data-scene-action="up"' + (index === 0 ? ' disabled' : '') + '>Move earlier</button>' +
              '<button type="button" data-scene-action="down"' + (index === order.length - 1 ? ' disabled' : '') + '>Move later</button>' +
              '<button type="button" class="danger" data-scene-action="delete">Remove Scene</button>' +
            '</div>' +
          '</details>' +
        '</header>' +
        '<div class="storyboard-scene-body">' +
          '<div class="storyboard-scene-main">' +
            '<label class="storyboard-field storyboard-scene-title-field"><span>Title</span><input data-scene-field="title" value="' + escapeHtml(sceneValue(scene, 'title', '')) + '" placeholder="Scene title"></label>' +
            '<label class="storyboard-field storyboard-scene-intent"><span>Scene intent</span><textarea data-scene-field="summary" rows="2" placeholder="Describe what happens in this Scene.">' + escapeHtml(sceneValue(scene, 'summary', '')) + '</textarea></label>' +
            '<div class="storyboard-prompt-block">' +
              '<div class="storyboard-prompt-heading">' +
                '<span' +
                  (promptDirectorModel ? ' title="Last populated by Director model ' + escapeHtml(promptDirectorModel) + '"' : '') +
                '>Generation prompt</span>' +
                '<div class="storyboard-prompt-actions">' +
                  '<button type="button" class="review-captions-btn" data-director-write title="Draft a complete H3 prompt from this Scene intent and the useful Story context.">Write with Director</button>' +
                  '<button type="button" class="review-captions-btn' +
                    (typeof storyState.director.previousPrompts[sceneId] === 'string' ? '' : ' hidden') +
                    '" data-director-restore title="Restore the prompt from before the last Director edit.">Restore Previous</button>' +
                '</div>' +
              '</div>' +
              '<textarea class="storyboard-prompt-textarea" data-scene-field="prompt" rows="7" placeholder="Full model-facing prompt. Write it directly or let the Director draft it from the Scene intent.">' + escapeHtml(sceneValue(scene, 'prompt', '')) + '</textarea>' +
              '<div class="storyboard-director-actions">' +
                '<input type="text" data-director-correction placeholder="Tell the Director what to change in this prompt...">' +
                '<button type="button" class="review-captions-btn" data-director-refine title="Apply this correction to the existing generation prompt.">Refine</button>' +
                '<span class="storyboard-save-state" data-director-status></span>' +
              '</div>' +
              '<details class="storyboard-scene-disclosure storyboard-prompt-pipeline-details">' +
                '<summary><span>Prompt pipeline</span><span class="storyboard-disclosure-summary-state">Inspect Director → H3</span></summary>' +
                '<div class="storyboard-disclosure-body storyboard-prompt-pipeline-body">' +
                  '<div class="storyboard-prompt-pipeline-actions">' +
                    '<button type="button" class="review-captions-btn" data-director-preview="write_prompt">Preview Write request</button>' +
                    '<button type="button" class="review-captions-btn" data-director-preview="refine_prompt">Preview Refine request</button>' +
                  '</div>' +
                  '<span class="storyboard-prompt-pipeline-note">This is the exact current Director contract. Generated Takes preserve the exact effective H3 input separately.</span>' +
                  '<pre data-director-request-preview-output>Choose a request to inspect what WebCap will send to the Director.</pre>' +
                '</div>' +
              '</details>' +
            '</div>' +
            '<details class="storyboard-scene-disclosure storyboard-continuity-details">' +
              '<summary><span>Continuity</span><span class="storyboard-disclosure-summary-state">' +
                ((String(sceneValue(scene, 'entryState', '')).trim() || String(sceneValue(scene, 'exitState', '')).trim()) ? 'Entry + Exit defined' : 'Optional') +
              '</span></summary>' +
              '<div class="storyboard-disclosure-body">' +
                '<div class="storyboard-scene-handoff-row storyboard-scene-handoff-primary">' +
                  '<label class="storyboard-field"><span>Entry state</span><textarea data-scene-field="entryState" rows="3" placeholder="What must already be true when this Scene begins?">' + escapeHtml(sceneValue(scene, 'entryState', '')) + '</textarea></label>' +
                  '<label class="storyboard-field"><span>Exit state</span><textarea data-scene-field="exitState" rows="3" placeholder="What should be true when this Scene ends?">' + escapeHtml(sceneValue(scene, 'exitState', '')) + '</textarea></label>' +
                '</div>' +
              '</div>' +
            '</details>' +
            '<details class="storyboard-scene-disclosure storyboard-notes-details">' +
              '<summary><span>Notes</span><span class="storyboard-disclosure-summary-state">' + (String(sceneValue(scene, 'notes', '')).trim() ? 'Added' : 'Optional') + '</span></summary>' +
              '<div class="storyboard-disclosure-body">' +
                '<label class="storyboard-field"><textarea data-scene-field="notes" rows="3" placeholder="Continuity reminders, corrections, ideas...">' + escapeHtml(sceneValue(scene, 'notes', '')) + '</textarea></label>' +
              '</div>' +
            '</details>' +
          '</div>' +
          '<aside class="storyboard-scene-inspector" aria-label="Scene inspector">' +
            '<section class="storyboard-inspector-section storyboard-generation-inspector">' +
              '<div class="storyboard-inspector-section-heading"><strong>Generation</strong><span>Current Scene</span></div>' +
              '<div class="storyboard-generation-settings">' +
                '<label class="storyboard-field" title="Scene-specific clip duration."><span>Duration (s)</span><input type="number" min="4" max="15" step="0.1" data-scene-field="durationSeconds" value="' + escapeHtml(sceneValue(scene, 'durationSeconds', 6)) + '"></label>' +
                '<label class="storyboard-field" title="Inherit the Story aspect ratio unless this Scene needs an override."><span>Aspect ratio</span><select data-scene-field="aspectRatio">' +
                  '<option value=""' + (sceneAspectRatio === '' ? ' selected' : '') + '>Inherit · ' + escapeHtml(inheritedAspectRatio) + '</option>' +
                  ['1:1 (Square)', '2:3 (Portrait Photo)', '3:2 (Photo)', '3:4 (Portrait Standard)', '4:3 (Standard)', '9:16 (Portrait Widescreen)', '16:9 (Widescreen)', '21:9 (Ultrawide)'].map(function (value) {
                    return '<option value="' + escapeHtml(value) + '"' + (sceneAspectRatio === value ? ' selected' : '') + '>' + escapeHtml(value) + '</option>';
                  }).join('') +
                '</select></label>' +
                '<label class="storyboard-field" title="Leave blank to inherit the Story megapixel target."><span>Megapixels</span><input type="number" min="0.05" step="0.05" data-scene-field="megapixels" value="' + escapeHtml(sceneMegapixels) + '" placeholder="Inherit · ' + escapeHtml(inheritedMegapixels) + '"></label>' +
                '<label class="storyboard-field" title="Use -1 for a random seed, or enter a non-negative integer for a fixed seed."><span>Seed</span><input type="number" min="-1" step="1" data-scene-field="seed" value="' + escapeHtml(seedDisplay) + '"></label>' +
              '</div>' +
              '<label class="storyboard-inline-check storyboard-generation-wildcards" title="Allow wildcard syntax in the generation prompt."><input type="checkbox" data-scene-field="wildcardsEnabled"' + (scene.wildcardsEnabled ? ' checked' : '') + '> Wildcards intended</label>' +
              '<button type="button" class="storyboard-primary-btn storyboard-generate-btn" data-scene-generate title="Queue a new Take from the current saved Scene.">' +
                (sceneGenerationJobs.length ? 'Generate Another Take' : 'Generate Take') +
              '</button>' +
            '</section>' +
            '<section class="storyboard-inspector-section storyboard-conditioning-panel">' +
              '<div class="storyboard-inspector-section-heading"><strong>Conditioning</strong><span>' + escapeHtml(conditioningSummary) + '</span></div>' +
              '<div class="storyboard-conditioning-body">' +
                '<div class="storyboard-lora-panel">' +
                  '<div class="storyboard-lora-header"><strong>LoRAs</strong></div>' +
                  (storyLoras.length ? '<div class="storyboard-lora-subsection"><span class="storyboard-lora-subtitle">Inherited from Story</span><div class="storyboard-lora-list" data-story-lora-inherited-list>' + inheritedLoraRowsHtml + '</div></div>' : '<div class="storyboard-lora-list hidden" data-story-lora-inherited-list></div>') +
                  (storyLoras.length ? '<div class="storyboard-lora-subsection"><span class="storyboard-lora-subtitle">Scene only</span><div class="storyboard-lora-list" data-scene-lora-list>' + loraRowsHtml + '</div></div>' : '<div class="storyboard-lora-list" data-scene-lora-list>' + loraRowsHtml + '</div>') +
                  '<div class="storyboard-lora-picker-wrap">' +
                    '<input type="search" class="storyboard-lora-picker" data-scene-lora-picker autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" placeholder="Filter / choose LoRA…" aria-label="Filter and choose available LoRA">' +
                    '<div class="storyboard-lora-picker-menu hidden" data-lora-picker-menu role="listbox"></div>' +
                  '</div>' +
                  '<span class="storyboard-lora-status" title="' + escapeHtml(loraStatusTitle) + '">' + escapeHtml(loraStatusText) + '</span>' +
                '</div>' +
                '<details class="storyboard-scene-disclosure storyboard-reference-details">' +
                  '<summary><span>References</span><span class="storyboard-disclosure-summary-state">' + (sceneReferences.length ? sceneReferences.length + ' assigned' : 'None') + '</span></summary>' +
                  '<div class="storyboard-disclosure-body">' +
                    (referencesHtml ? '<div class="storyboard-reference-chips">' + referencesHtml + '</div>' : '<span class="storyboard-reference-empty">No references assigned.</span>') +
                    (previousSelectedTakeId
                      ? '<button type="button" class="review-captions-btn storyboard-reference-quick" data-reference-previous title="Use the previous Scene\'s selected Take as this Scene\'s first-frame reference.">Previous selected Take → first frame</button>'
                      : (index > 0 ? '<span class="storyboard-reference-empty">Select a Take in the previous Scene for quick continuity.</span>' : '')) +
                    '<div class="storyboard-reference-editor">' +
                      '<select data-reference-role title="Which reference slot this media should fill."><option value="first_frame">First frame</option><option value="last_frame">Last frame</option></select>' +
                      '<select data-reference-source title="Choose an existing Take to use as a reference.">' + activeTakeOptions(story, '') + '</select>' +
                      '<select data-reference-frame title="Choose which frame from the source Take to use."><option value="last">Last frame</option><option value="first">First frame</option></select>' +
                      '<button type="button" class="review-captions-btn" data-reference-apply title="Assign the selected Take frame to this reference slot.">Assign Take</button>' +
                      '<label class="review-captions-btn storyboard-reference-upload-btn" title="Upload an image directly into the selected first/last-frame reference slot.">Upload image<input type="file" accept="image/*" data-reference-upload hidden></label>' +
                    '</div>' +
                  '</div>' +
                '</details>' +
              '</div>' +
            '</section>' +
          '</aside>' +
        '</div>' +
        '<details class="storyboard-takes" open>' +
          '<summary class="storyboard-takes-summary"><strong>Takes</strong><span>' + escapeHtml(takeSummaryParts.join(' · ')) + '</span></summary>' +
          '<div class="storyboard-takes-content">' +
            '<div class="storyboard-takes-header"><span>Imported media is copied into this Story and keeps a frozen Scene snapshot.</span>' +
              '<label class="review-captions-btn storyboard-take-upload-btn" title="Import existing image or video media as a Take for this Scene.">Import Take<input type="file" accept="image/*,video/*" data-take-upload hidden></label>' +
            '</div>' +
            '<div class="storyboard-takes-grid">' + (takesHtml + pendingTakesHtml || '<div class="storyboard-takes-empty">No Takes yet.</div>') + '</div>' +
            removedTakesHtml +
          '</div>' +
        '</details>' +
      '</section>';
    }).join('');

    if (!activeHtml) activeHtml = '<div class="storyboard-library-empty">No Scenes yet. Add the first generatable scene.</div>';

    host.innerHTML = activeHtml + removedScenesHtml(removedScenes);
    syncDirectorPendingControls();
    if (storyState.director.busy && storyState.director.activityTarget) positionDirectorActivity();
  }

  function renderStory() {
    var empty = el('storyboard-editor-empty');
    var editor = el('storyboard-editor-content');
    if (!storyState.story) {
      if (empty) empty.classList.remove('hidden');
      if (editor) editor.classList.add('hidden');
      setSaveState('');
      return;
    }
    if (empty) empty.classList.add('hidden');
    if (editor) editor.classList.remove('hidden');

    el('storyboard-story-title').value = storyState.story.title || '';
    el('storyboard-story-concept').value = storyState.story.concept || '';
    el('storyboard-story-style').value = storyState.story.style || '';
    renderStoryInvariants();
    el('storyboard-story-tags').value = storyTagsText(storyState.story);
    el('storyboard-story-status').value = storyState.story.status || 'active';
    el('storyboard-story-target-scenes').value = storyState.story.targetSceneCount || 12;
    var storyDefaults = storyState.story.generationDefaults || {};
    el('storyboard-story-aspect-ratio').value = storyDefaults.aspectRatio || '4:3 (Standard)';
    el('storyboard-story-megapixels').value = storyDefaults.megapixels == null ? 0.2 : storyDefaults.megapixels;
    var developButton = el('storyboard-develop-btn');
    if (developButton) {
      var hasScenes = (storyState.story.sceneOrder || []).length > 0;
      developButton.textContent = hasScenes ? 'Re-develop Scenes…' : 'Develop Scenes';
      developButton.classList.toggle('storyboard-redevelop-btn', hasScenes);
      var developRow = developButton.closest('.storyboard-develop-row');
      if (developRow) developRow.classList.toggle('has-scenes', hasScenes);
    }
    var restoreConceptButton = el('storyboard-restore-concept-btn');
    if (restoreConceptButton) {
      restoreConceptButton.classList.toggle('hidden', typeof storyState.story.previousConcept !== 'string');
    }
    setStoryCollapsed(storyState.storyCollapsed);
    renderStoryLoras();
    renderScenes();
    renderStoryReadiness();
    syncDirectorPendingControls();
    renderSequencePreview();
    renderLibrary();
  }

  function refreshLibrary() {
    return request(null, '').then(function (payload) {
      storyState.stories = payload.stories || [];
      renderLibrary();
      return payload;
    });
  }

  function openStory(storyId) {
    var previousStoryId = storyState.story && storyState.story.id;
    setSaveState('Loading...');
    return flushPendingSaves().then(function () {
      return request(null, 'story=' + encodeURIComponent(storyId));
    }).then(function (payload) {
      storyState.story = payload.story;
      if (previousStoryId !== payload.story.id && storyState.storyCollapsed) setStoryCollapsed(false);
      storyState.sequenceExport = null;
      storyState.newTakeCounts = {};
      storyState.director.previousPrompts = {};
      return refreshGenerationQueue(storyId);
    }).then(function () {
      renderStory();
      setSaveState('Saved');
      return refreshSequenceExport(storyId);
    }).catch(reportError);
  }

  function createStory() {
    return flushPendingSaves().then(function () {
      return request({
        operation: 'create_story',
        story: {
          title: 'Untitled Story',
          concept: '',
          style: '',
          invariants: [],
          tags: [],
          status: 'active',
          pinned: false,
          targetSceneCount: 12,
          generationDefaults: { aspectRatio: '4:3 (Standard)', megapixels: 0.2 }
        }
      });
    }).then(function (payload) {
      storyState.story = payload.story;
      if (storyState.storyCollapsed) setStoryCollapsed(false);
      storyState.sequenceExport = null;
      storyState.newTakeCounts = {};
      storyState.director.previousPrompts = {};
      storyState.generationJobs = {};
      Object.keys(storyState.generationPolls).forEach(clearGenerationPoll);
      syncStoryboardGenerationActivity();
      return refreshLibrary().then(function () {
        renderStory();
        setSaveState('Saved');
      });
    }).catch(reportError);
  }

  function deleteStory(storyId, title) {
    if (!storyId) return;
    var deletedWasOpen = !!(storyState.story && storyState.story.id === storyId);
    title = String(title || 'Untitled Story');
    if (!window.confirm(
      'Delete "' + title + '" and permanently remove all of its Scenes, Takes, references, and exports? This cannot be undone.'
    )) return;

    setSaveState('Deleting...');
    flushPendingSaves().then(function () {
      return request({
        operation: 'delete_story',
        storyId: storyId
      });
    }).then(function () {
      if (deletedWasOpen) {
        storyState.story = null;
        storyState.sequenceExport = null;
        storyState.newTakeCounts = {};
        storyState.activeSceneId = '';
        storyState.director.previousPrompts = {};
        storyState.generationJobs = {};
        Object.keys(storyState.generationPolls).forEach(clearGenerationPoll);
        syncStoryboardGenerationActivity();
      }
      return refreshLibrary();
    }).then(function () {
      if (!deletedWasOpen) {
        renderLibrary();
        setSaveState('');
        return;
      }
      var next = storyState.stories && storyState.stories[0];
      if (next) return openStory(next.id);
      renderStory();
      setSaveState('');
    }).catch(reportError);
  }

  function libraryStory(storyId) {
    return (storyState.stories || []).find(function (story) { return story.id === storyId; }) || null;
  }

  function updateStoryFromLibrary(storyId, changes) {
    return request(null, 'story=' + encodeURIComponent(storyId)).then(function (payload) {
      var story = payload.story;
      var next = {
        title: story.title || '',
        concept: story.concept || '',
        style: story.style || '',
        invariants: story.invariants || [],
        loras: story.loras || [],
        tags: story.tags || [],
        status: story.status || 'active',
        pinned: !!story.pinned
      };
      Object.keys(changes || {}).forEach(function (key) { next[key] = changes[key]; });
      return request({ operation: 'update_story', storyId: storyId, story: next });
    }).then(function (payload) {
      if (storyState.story && storyState.story.id === storyId) storyState.story = payload.story;
      return refreshLibrary().then(function () {
        renderStory();
        return payload.story;
      });
    });
  }

  function duplicateStory(storyId) {
    setSaveState('Duplicating...');
    return flushPendingSaves().then(function () {
      return request({ operation: 'duplicate_story', storyId: storyId });
    }).then(function (payload) {
      return refreshLibrary().then(function () {
        setSaveState('Saved');
        return openStory(payload.story.id);
      });
    }).catch(reportError);
  }

  function toggleStoryPin(storyId) {
    var story = libraryStory(storyId);
    if (!story) return;
    setSaveState(story.pinned ? 'Unpinning...' : 'Pinning...');
    updateStoryFromLibrary(storyId, { pinned: !story.pinned }).then(function () {
      setSaveState('Saved');
    }).catch(reportError);
  }

  function toggleStoryArchive(storyId) {
    var story = libraryStory(storyId);
    if (!story) return;
    var archived = story.status === 'archived';
    setSaveState(archived ? 'Restoring...' : 'Archiving...');
    updateStoryFromLibrary(storyId, { status: archived ? 'active' : 'archived' }).then(function () {
      setSaveState('Saved');
    }).catch(reportError);
  }

  function exportStory(storyId) {
    setSaveState('Exporting sequence...');
    flushPendingSaves().then(function () {
      return assemblyRequest({ storyId: storyId });
    }).then(function (payload) {
      if (storyState.story && storyState.story.id === storyId) {
        storyState.sequenceExport = payload.export || null;
        renderSequencePreview();
      }
      setSaveState('Saved');
    }).catch(reportError);
  }

  function storyPayloadFromUi() {
    return {
      title: el('storyboard-story-title').value,
      concept: el('storyboard-story-concept').value,
      style: el('storyboard-story-style').value,
      invariants: storyInvariantsFromUi(),
      loras: storyLorasFromUi(),
      targetSceneCount: el('storyboard-story-target-scenes').value || 12,
      generationDefaults: {
        aspectRatio: el('storyboard-story-aspect-ratio').value || '4:3 (Standard)',
        megapixels: el('storyboard-story-megapixels').value || 0.2
      },
      tags: el('storyboard-story-tags').value.split(',').map(function (value) { return value.trim(); }).filter(Boolean),
      status: el('storyboard-story-status').value,
      pinned: !!storyState.story.pinned
    };
  }

  function saveStoryNow() {
    if (!storyState.story) return Promise.resolve();
    setSaveState('Saving...');
    var storyId = storyState.story.id;
    var storyPayload = storyPayloadFromUi();
    var previous = storyState.storySavePromise;
    var promise = (previous ? previous.catch(function () {}) : Promise.resolve()).then(function () {
      return request({
        operation: 'update_story',
        storyId: storyId,
        story: storyPayload
      });
    }).then(function (payload) {
      storyState.story = payload.story;
      if (storyState.storySavePromise === promise) storyState.storySaveError = null;
      setSaveState('Saved');
      return refreshLibrary();
    }).catch(function (err) {
      if (storyState.storySavePromise === promise) storyState.storySaveError = err;
      throw err;
    }).finally(function () {
      if (storyState.storySavePromise === promise) storyState.storySavePromise = null;
    });
    storyState.storySavePromise = promise;
    return promise;
  }

  function scheduleStorySave() {
    if (storyState.saveTimer) clearTimeout(storyState.saveTimer);
    setSaveState('Unsaved changes');
    storyState.saveTimer = setTimeout(function () {
      storyState.saveTimer = 0;
      saveStoryNow().catch(reportError);
    }, 450);
  }

  function sceneElement(sceneId) {
    return document.querySelector('.storyboard-scene[data-scene-id="' + CSS.escape(sceneId) + '"]');
  }

  function scenePayloadFromUi(sceneId) {
    var root = sceneElement(sceneId);
    if (!root) throw new Error('Scene editor is missing for ' + sceneId + '.');
    var currentScene = storyState.story && storyState.story.scenes
      ? storyState.story.scenes[sceneId] || {}
      : {};
    function field(name) {
      return root.querySelector('[data-scene-field="' + name + '"]');
    }
    var seedNode = field('seed');
    var seedText = String(seedNode.value || '').trim();
    var randomSeed = seedText === '' || seedText === '-1';
    var promptValue = field('prompt').value;
    var promptDirectorModel = promptValue === String(currentScene.prompt || '')
      ? String(currentScene.promptDirectorModel || '')
      : '';
    return {
      title: field('title').value,
      summary: field('summary').value,
      entryState: field('entryState').value,
      exitState: field('exitState').value,
      prompt: promptValue,
      promptDirectorModel: promptDirectorModel,
      notes: field('notes').value,
      durationSeconds: field('durationSeconds').value,
      aspectRatio: field('aspectRatio').value || null,
      megapixels: String(field('megapixels').value || '').trim() || null,
      seedMode: randomSeed ? 'random' : 'fixed',
      seed: randomSeed ? null : seedText,
      wildcardsEnabled: field('wildcardsEnabled').checked,
      loras: Array.prototype.map.call(root.querySelectorAll('[data-scene-lora-row]'), function (row) {
        return {
          name: row.querySelector('[data-scene-lora-name]').value,
          strength: row.querySelector('[data-scene-lora-strength]').value
        };
      }).filter(function (item) { return !!item.name; }),
      storyLoraOverrides: Array.prototype.map.call(root.querySelectorAll('[data-story-lora-inherited-row]'), function (row) {
        var name = String(row.dataset.loraName || '');
        var enabled = row.querySelector('[data-story-lora-enabled]').checked;
        var strength = Number(row.querySelector('[data-story-lora-scene-strength]').value);
        var defaultStrength = Number(row.dataset.storyDefaultStrength);
        if (!name) return null;
        if (!enabled) return { name: name, enabled: false };
        if (strength !== defaultStrength) return { name: name, strength: strength };
        return null;
      }).filter(Boolean)
    };
  }

  function saveSceneNow(sceneId) {
    if (!storyState.story) return Promise.resolve();
    setSaveState('Saving...');
    var storyId = storyState.story.id;
    var scenePayload = scenePayloadFromUi(sceneId);
    var previous = storyState.sceneSavePromises[sceneId];
    var promise = (previous ? previous.catch(function () {}) : Promise.resolve()).then(function () {
      return request({
        operation: 'update_scene',
        storyId: storyId,
        sceneId: sceneId,
        scene: scenePayload
      });
    }).then(function (payload) {
      storyState.story = payload.story;
      if (storyState.sceneSavePromises[sceneId] === promise) delete storyState.sceneSaveErrors[sceneId];
      setSaveState('Saved');
      return refreshLibrary();
    }).catch(function (err) {
      if (storyState.sceneSavePromises[sceneId] === promise) storyState.sceneSaveErrors[sceneId] = err;
      throw err;
    }).finally(function () {
      if (storyState.sceneSavePromises[sceneId] === promise) delete storyState.sceneSavePromises[sceneId];
    });
    storyState.sceneSavePromises[sceneId] = promise;
    return promise;
  }

  function scheduleSceneSave(sceneId) {
    if (storyState.sceneTimers[sceneId]) clearTimeout(storyState.sceneTimers[sceneId]);
    setSaveState('Unsaved changes');
    storyState.sceneTimers[sceneId] = setTimeout(function () {
      delete storyState.sceneTimers[sceneId];
      saveSceneNow(sceneId).catch(reportError);
    }, 450);
  }

  function flushPendingSaves() {
    if (storyState.saveTimer) {
      clearTimeout(storyState.saveTimer);
      storyState.saveTimer = 0;
      saveStoryNow();
    }
    Object.keys(storyState.sceneTimers).forEach(function (sceneId) {
      clearTimeout(storyState.sceneTimers[sceneId]);
      delete storyState.sceneTimers[sceneId];
      saveSceneNow(sceneId);
    });

    var pending = [];
    if (storyState.storySavePromise) pending.push(storyState.storySavePromise);
    Object.keys(storyState.sceneSavePromises).forEach(function (sceneId) {
      pending.push(storyState.sceneSavePromises[sceneId]);
    });

    return Promise.all(pending).then(function () {
      if (storyState.storySaveError) throw storyState.storySaveError;
      var failedSceneIds = Object.keys(storyState.sceneSaveErrors);
      if (failedSceneIds.length) throw storyState.sceneSaveErrors[failedSceneIds[0]];
    });
  }

  function addScene() {
    if (!storyState.story) return;
    setSaveState('Saving...');
    flushPendingSaves().then(function () { return request({
      operation: 'add_scene',
      storyId: storyState.story.id,
      scene: { title: 'New Scene', durationSeconds: 6, seedMode: 'random' }
    }); }).then(function (payload) {
      storyState.story = payload.story;
      storyState.sceneViewMode = 'focus';
      storyState.activeSceneId = (payload.story.sceneOrder || []).slice(-1)[0] || '';
      window.localStorage.setItem('webcap.storyboard.sceneView', 'focus');
      renderStory();
      setSaveState('Saved');
      refreshLibrary();
    }).catch(reportError);
  }

  function reorderScene(sceneId, delta) {
    var order = storyState.story && Array.isArray(storyState.story.sceneOrder)
      ? storyState.story.sceneOrder.slice()
      : [];
    var index = order.indexOf(sceneId);
    var next = index + delta;
    if (index < 0 || next < 0 || next >= order.length) return;
    var temp = order[index];
    order[index] = order[next];
    order[next] = temp;
    setSaveState('Saving...');
    flushPendingSaves().then(function () { return request({
      operation: 'reorder_scenes',
      storyId: storyState.story.id,
      sceneOrder: order
    }); }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
    }).catch(reportError);
  }

  function duplicateScene(sceneId) {
    setSaveState('Saving...');
    flushPendingSaves().then(function () { return request({
      operation: 'duplicate_scene',
      storyId: storyState.story.id,
      sceneId: sceneId
    }); }).then(function (payload) {
      storyState.story = payload.story;
      var duplicatedOrder = payload.story.sceneOrder || [];
      var sourceIndex = duplicatedOrder.indexOf(sceneId);
      storyState.sceneViewMode = 'focus';
      storyState.activeSceneId = duplicatedOrder[sourceIndex + 1] || sceneId;
      window.localStorage.setItem('webcap.storyboard.sceneView', 'focus');
      renderStory();
      setSaveState('Saved');
      refreshLibrary();
    }).catch(reportError);
  }

  function deleteScene(sceneId) {
    var scene = storyState.story && storyState.story.scenes ? storyState.story.scenes[sceneId] : null;
    var label = scene && scene.title ? scene.title : 'this Scene';
    if (!window.confirm('Remove "' + label + '" from this Story? It will remain recoverable in Removed Scenes.')) return;
    setSaveState('Saving...');
    flushPendingSaves().then(function () { return request({
      operation: 'delete_scene',
      storyId: storyState.story.id,
      sceneId: sceneId
    }); }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
      refreshLibrary();
    }).catch(reportError);
  }

  function restoreScene(sceneId) {
    setSaveState('Saving...');
    flushPendingSaves().then(function () { return request({
      operation: 'restore_scene',
      storyId: storyState.story.id,
      sceneId: sceneId
    }); }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
      refreshLibrary();
    }).catch(reportError);
  }

  function uploadTake(sceneId, file) {
    if (!storyState.story || !file) return;
    setSaveState('Adding Take...');
    flushPendingSaves().then(function () {
      var form = new FormData();
      form.append('storyId', storyState.story.id);
      form.append('sceneId', sceneId);
      form.append('file', file, file.name);
      return fetch('/fs/storyboard/take_upload', { method: 'POST', body: form }).then(function (response) {
        return response.json().then(function (body) {
          if (!response.ok || !body || !body.ok) throw new Error((body && body.error) || 'Take upload failed.');
          return body;
        });
      });
    }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
      refreshLibrary();
    }).catch(reportError);
  }

  function labelTake(sceneId, takeId, label) {
    setSaveState('Saving...');
    flushPendingSaves().then(function () { return request({
      operation: 'label_take',
      storyId: storyState.story.id,
      sceneId: sceneId,
      takeId: takeId,
      label: String(label || '').trim()
    }); }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
    }).catch(reportError);
  }

  function rateTake(sceneId, takeId, rating) {
    setSaveState('Saving...');
    flushPendingSaves().then(function () { return request({
      operation: 'rate_take',
      storyId: storyState.story.id,
      sceneId: sceneId,
      takeId: takeId,
      rating: rating === '' ? null : Number(rating)
    }); }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
    }).catch(reportError);
  }

  function selectTake(sceneId, takeId) {
    setSaveState('Saving...');
    flushPendingSaves().then(function () { return request({
      operation: 'select_take',
      storyId: storyState.story.id,
      sceneId: sceneId,
      takeId: takeId
    }); }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
    }).catch(reportError);
  }

  function removeTake(sceneId, takeId) {
    var scene = storyState.story && storyState.story.scenes ? storyState.story.scenes[sceneId] : null;
    var take = scene && scene.takes ? scene.takes[takeId] : null;
    var label = take && take.sourceFilename ? take.sourceFilename : 'this Take';
    if (!window.confirm('Remove "' + label + '"? Its media and metadata will remain recoverable.')) return;
    setSaveState('Saving...');
    flushPendingSaves().then(function () { return request({
      operation: 'remove_take',
      storyId: storyState.story.id,
      sceneId: sceneId,
      takeId: takeId
    }); }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
    }).catch(reportError);
  }

  function deleteTake(sceneId, takeId) {
    var scene = storyState.story && storyState.story.scenes ? storyState.story.scenes[sceneId] : null;
    var take = scene && scene.takes ? scene.takes[takeId] : null;
    if (!take && scene && scene.removedTakes) take = scene.removedTakes[takeId];
    var label = take && (take.label || take.sourceFilename) ? (take.label || take.sourceFilename) : 'this Take';
    var selected = !!(scene && scene.selectedTakeId === takeId);
    var message = 'Delete "' + label + '" permanently? This deletes its media and metadata and cannot be undone.';
    if (selected) {
      message += '\n\nThis Take is currently selected. Deleting it will leave the Scene without a selected Take.';
    }
    if (!window.confirm(message)) return;
    setSaveState('Deleting...');
    flushPendingSaves().then(function () { return request({
      operation: 'delete_take',
      storyId: storyState.story.id,
      sceneId: sceneId,
      takeId: takeId
    }); }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
    }).catch(reportError);
  }

  function restoreTake(sceneId, takeId) {
    setSaveState('Saving...');
    flushPendingSaves().then(function () { return request({
      operation: 'restore_take',
      storyId: storyState.story.id,
      sceneId: sceneId,
      takeId: takeId
    }); }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
    }).catch(reportError);
  }

  function setSceneReference(sceneId, role, sourceSceneId, sourceTakeId, frame) {
    setSaveState('Saving...');
    flushPendingSaves().then(function () { return request({
      operation: 'set_scene_reference_from_take',
      storyId: storyState.story.id,
      sceneId: sceneId,
      role: role,
      sourceSceneId: sourceSceneId,
      sourceTakeId: sourceTakeId,
      frame: frame
    }); }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
    }).catch(reportError);
  }

  function clearSceneReference(sceneId, role) {
    setSaveState('Saving...');
    flushPendingSaves().then(function () { return request({
      operation: 'clear_scene_reference',
      storyId: storyState.story.id,
      sceneId: sceneId,
      role: role
    }); }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
    }).catch(reportError);
  }

  function uploadSceneReference(sceneId, role, file) {
    if (!storyState.story || !file) return;
    setSaveState('Adding reference...');
    flushPendingSaves().then(function () {
      var form = new FormData();
      form.append('storyId', storyState.story.id);
      form.append('sceneId', sceneId);
      form.append('role', role);
      form.append('file', file, file.name);
      return fetch('/fs/storyboard/reference_upload', { method: 'POST', body: form }).then(function (response) {
        return response.json().then(function (body) {
          if (!response.ok || !body || !body.ok) {
            throw new Error((body && body.error) || 'Reference upload failed.');
          }
          return body;
        });
      });
    }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
    }).catch(reportError);
  }

  function generationRequest(payload, query) {
    var url = '/fs/storyboard/generation' + (query ? '?' + query : '');
    var options = payload
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      : {};
    return fetch(url, options).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body || !body.ok) {
          throw new Error((body && body.error) || 'Storyboard generation request failed.');
        }
        return body;
      });
    });
  }

  function generationConsoleLabel(sceneId) {
    if (!storyState.story) return 'Storyboard';
    var order = Array.isArray(storyState.story.sceneOrder) ? storyState.story.sceneOrder : [];
    var scene = storyState.story.scenes && storyState.story.scenes[sceneId];
    var index = order.indexOf(sceneId);
    var label = index >= 0 ? 'Scene ' + String(index + 1).padStart(2, '0') : 'Scene';
    var title = String(scene && scene.title || '').trim();
    return title ? label + ' · ' + title : label;
  }

  function generationJobIsActive(job) {
    return !!job && ['queued', 'starting', 'running', 'stopping'].indexOf(String(job.status || '')) !== -1;
  }

  function generationJobsForScene(sceneId) {
    return Object.keys(storyState.generationJobs).map(function (jobId) {
      return storyState.generationJobs[jobId];
    }).filter(function (job) {
      return job && job.sceneId === sceneId && generationJobIsActive(job);
    }).sort(function (a, b) {
      return Number(a.queuedAt || 0) - Number(b.queuedAt || 0);
    });
  }

  function syncStoryboardGenerationActivity() {
    var running = Object.keys(storyState.generationJobs).some(function (jobId) {
      var status = String(storyState.generationJobs[jobId] && storyState.generationJobs[jobId].status || '');
      return status === 'starting' || status === 'running' || status === 'stopping';
    });
    setShellGeneratingActive(running);
    renderStoryReadiness();
  }

  function reportGenerationStatus(sceneId, job, previousJob) {
    if (!job) return;
    var currentKey = String(job.status || '') + '|' + String(job.comfyStatus || '');
    var previousKey = previousJob
      ? String(previousJob.status || '') + '|' + String(previousJob.comfyStatus || '')
      : '';
    if (currentKey === previousKey) return;
    if (job.status === 'queued') {
      var queuePosition = Number(job.queuePosition || 0);
      reportConsoleInfo(
        generationConsoleLabel(sceneId),
        'Take generation queued' + (queuePosition ? ' · #' + queuePosition : '') + '.'
      );
    } else if (job.status === 'starting') {
      reportConsoleInfo(generationConsoleLabel(sceneId), 'Take generation starting.');
    } else if (job.status === 'running') {
      reportConsoleInfo(generationConsoleLabel(sceneId), 'ComfyUI · ' + String(job.comfyStatus || 'starting'));
    } else if (job.status === 'stopping') {
      reportConsoleInfo(generationConsoleLabel(sceneId), 'Take generation stopping.');
    } else if (job.status === 'completed') {
      reportConsoleInfo(generationConsoleLabel(sceneId), 'Take generation completed.');
    } else if (job.status === 'stopped' || job.status === 'cancelled') {
      reportConsoleInfo(generationConsoleLabel(sceneId), 'Take generation ' + job.status + '.');
    }
  }


  function sceneTakeCardById(grid, takeId) {
    return Array.prototype.find.call(grid.querySelectorAll('[data-take-id]'), function (card) {
      return card.dataset.takeId === takeId;
    }) || null;
  }

  function sceneGenerationCardById(grid, jobId) {
    return Array.prototype.find.call(grid.querySelectorAll('[data-generation-job-id]'), function (card) {
      return card.dataset.generationJobId === jobId;
    }) || null;
  }

  function syncSceneTakeDom(sceneId) {
    if (!storyState.story || !storyState.story.scenes) return;
    var root = sceneElement(sceneId);
    if (!root) return;
    var grid = root.querySelector('.storyboard-takes-grid');
    if (!grid) throw new Error('Storyboard Takes grid is missing.');

    var scene = storyState.story.scenes[sceneId] || {};
    var takes = scene.takes && typeof scene.takes === 'object' ? scene.takes : {};
    var takeOrder = Array.isArray(scene.takeOrder) ? scene.takeOrder : [];
    var jobs = generationJobsForScene(sceneId);
    var activeJobIds = {};
    var empty = grid.querySelector('.storyboard-takes-empty');
    if ((takeOrder.length || jobs.length) && empty) empty.remove();

    takeOrder.forEach(function (takeId, takeIndex) {
      var take = takes[takeId];
      if (!take || sceneTakeCardById(grid, takeId)) return;
      var pending = grid.querySelector('[data-generation-job-id]');
      var html = takeCardHtml(storyState.story.id, sceneId, takeId, take, takeIndex, scene.selectedTakeId);
      if (pending) pending.insertAdjacentHTML('beforebegin', html);
      else grid.insertAdjacentHTML('beforeend', html);
    });

    jobs.forEach(function (job, pendingIndex) {
      activeJobIds[job.jobId] = true;
      var card = sceneGenerationCardById(grid, job.jobId);
      if (!card) {
        grid.insertAdjacentHTML('beforeend', pendingTakeCardHtml(job, takeOrder.length + pendingIndex));
        card = sceneGenerationCardById(grid, job.jobId);
      }
      syncGenerationJobCard(job, card);
    });

    Array.prototype.forEach.call(grid.querySelectorAll('[data-generation-job-id]'), function (card) {
      if (!activeJobIds[card.dataset.generationJobId]) card.remove();
    });

    if (!grid.querySelector('[data-take-id], [data-generation-job-id]') && !grid.querySelector('.storyboard-takes-empty')) {
      grid.insertAdjacentHTML('beforeend', '<div class="storyboard-takes-empty">No Takes yet.</div>');
    }

    var generateButton = root.querySelector('[data-scene-generate]');
    if (generateButton) generateButton.textContent = (takeOrder.length || jobs.length) ? 'Generate Another Take' : 'Generate Take';
  }

  function mergeFetchedSceneTakeState(storyId, sceneId, latestStory) {
    if (!storyState.story || storyState.story.id !== storyId || !latestStory || latestStory.id !== storyId) return;
    var currentScene = storyState.story.scenes && storyState.story.scenes[sceneId];
    var latestScene = latestStory.scenes && latestStory.scenes[sceneId];
    if (!currentScene || !latestScene) return;
    currentScene.takes = latestScene.takes && typeof latestScene.takes === 'object' ? latestScene.takes : {};
    currentScene.removedTakes = latestScene.removedTakes && typeof latestScene.removedTakes === 'object' ? latestScene.removedTakes : {};
    currentScene.takeOrder = Array.isArray(latestScene.takeOrder) ? latestScene.takeOrder : [];
    currentScene.selectedTakeId = latestScene.selectedTakeId || null;
    currentScene.updatedAt = latestScene.updatedAt || currentScene.updatedAt;
    storyState.story.updatedAt = latestStory.updatedAt || storyState.story.updatedAt;
    syncSceneTakeDom(sceneId);
  }

  function syncGenerationJobCard(job, card) {
    if (!job) return;
    if (!card) {
      var root = sceneElement(job.sceneId);
      var grid = root && root.querySelector('.storyboard-takes-grid');
      card = grid && sceneGenerationCardById(grid, String(job.jobId || ''));
    }
    if (!card) return;
    var status = String(job.status || '');
    var queuePosition = Number(job.queuePosition || 0);
    var statusText = status === 'queued'
      ? ('Queued' + (queuePosition ? ' · #' + queuePosition : ''))
      : status === 'starting'
        ? 'Starting…'
        : status === 'stopping'
          ? 'Stopping…'
          : ('Generating…' + (job.comfyStatus ? ' · ' + String(job.comfyStatus).replace(/_/g, ' ') : ''));
    var mediaStatus = card.querySelector('.storyboard-take-pending-media strong');
    var footerStatus = card.querySelector('.storyboard-take-identity span');
    if (mediaStatus) mediaStatus.textContent = statusText;
    if (footerStatus) footerStatus.textContent = statusText;

    var actionHost = card.querySelector('.storyboard-take-pending-footer');
    var action = card.querySelector('[data-generation-action]');
    var wantedAction = status === 'queued'
      ? 'cancel'
      : ((status === 'starting' || status === 'running') ? 'stop' : '');
    if (!wantedAction) {
      if (action) action.remove();
      return;
    }
    if (!action || action.dataset.generationAction !== wantedAction) {
      if (action) action.remove();
      action = document.createElement('button');
      action.type = 'button';
      action.className = 'review-captions-btn';
      action.dataset.generationAction = wantedAction;
      action.dataset.jobId = String(job.jobId || '');
      action.textContent = wantedAction === 'cancel' ? 'Cancel' : 'Stop';
      actionHost.appendChild(action);
    }
  }

  function clearGenerationPoll(jobId) {
    var timer = storyState.generationPolls[jobId];
    if (timer) window.clearTimeout(timer);
    delete storyState.generationPolls[jobId];
  }

  function pollGeneration(storyId, jobId) {
    if (storyState.generationPolls[jobId]) return;
    storyState.generationPolls[jobId] = window.setTimeout(function () {
      delete storyState.generationPolls[jobId];
      generationRequest(null, 'job=' + encodeURIComponent(jobId) + '&consume=1').then(function (payload) {
        var job = payload.job;
        var previousJob = storyState.generationJobs[jobId] || null;
        storyState.generationJobs[jobId] = job;
        reportGenerationStatus(job.sceneId, job, previousJob);
        syncStoryboardGenerationActivity();

        if (generationJobIsActive(job)) {
          if (storyState.story && storyState.story.id === storyId) syncSceneTakeDom(job.sceneId);
          pollGeneration(storyId, jobId);
          return;
        }

        delete storyState.generationJobs[jobId];
        clearGenerationPoll(jobId);
        syncStoryboardGenerationActivity();

        if (job.status === 'failed') {
          if (storyState.story && storyState.story.id === storyId) syncSceneTakeDom(job.sceneId);
          throw new Error(job.error || 'Storyboard generation failed.');
        }

        if (job.status === 'stopped' || job.status === 'cancelled') {
          if (storyState.story && storyState.story.id === storyId) syncSceneTakeDom(job.sceneId);
          return;
        }

        if (job.status === 'completed') {
          if (!storyState.story || storyState.story.id !== storyId) {
            return refreshLibrary();
          }
          return request(null, 'story=' + encodeURIComponent(storyId)).then(function (storyPayload) {
            mergeFetchedSceneTakeState(storyId, job.sceneId, storyPayload.story);
            markSceneNewTake(job.sceneId);
            setSaveState('Saved');
          });
        }

        throw new Error('Storyboard generation returned unknown status: ' + String(job.status || 'empty'));
      }).catch(function (err) {
        clearGenerationPoll(jobId);
        reportError(err);
      });
    }, 2000);
  }

  function refreshGenerationQueue(storyId) {
    Object.keys(storyState.generationPolls).forEach(clearGenerationPoll);
    storyState.generationJobs = {};
    if (!storyId) {
      syncStoryboardGenerationActivity();
      return Promise.resolve();
    }
    return generationRequest(null, 'story=' + encodeURIComponent(storyId)).then(function (payload) {
      var jobs = payload.queue && Array.isArray(payload.queue.jobs) ? payload.queue.jobs : [];
      jobs.forEach(function (job) {
        storyState.generationJobs[job.jobId] = job;
      });
      syncStoryboardGenerationActivity();
      jobs.forEach(function (job) {
        if (generationJobIsActive(job)) pollGeneration(storyId, job.jobId);
      });
      return payload.queue;
    });
  }

  function generationAction(operation, jobId) {
    return generationRequest({ operation: operation, jobId: jobId }).then(function (payload) {
      if (payload.job) {
        storyState.generationJobs[payload.job.jobId] = payload.job;
        reportGenerationStatus(payload.job.sceneId, payload.job, null);
        if (!generationJobIsActive(payload.job)) delete storyState.generationJobs[payload.job.jobId];
        syncSceneTakeDom(payload.job.sceneId);
      }
      syncStoryboardGenerationActivity();
      return payload;
    }).catch(reportError);
  }

  function generateScene(sceneId) {
    if (!storyState.story) return;
    setSaveState('Saving...');
    flushPendingSaves().then(function () {
      return generationRequest({
        storyId: storyState.story.id,
        sceneId: sceneId
      });
    }).then(function (payload) {
      var job = payload.job;
      var previousJob = storyState.generationJobs[job.jobId] || null;
      storyState.generationJobs[job.jobId] = job;
      reportGenerationStatus(sceneId, job, previousJob);
      syncStoryboardGenerationActivity();
      syncSceneTakeDom(sceneId);
      setSaveState('Saved');
      pollGeneration(storyState.story.id, job.jobId);
    }).catch(reportError);
  }

  function handleSceneInput(event) {
    var field = event.target.closest('[data-scene-field]');
    if (!field) return;
    var scene = field.closest('.storyboard-scene[data-scene-id]');
    if (!scene) return;
    scheduleSceneSave(scene.dataset.sceneId);
  }

  function handleSceneAction(event) {
    var button = event.target.closest('[data-scene-action]');
    if (!button) return;
    var scene = button.closest('.storyboard-scene[data-scene-id]');
    if (!scene) return;
    var sceneId = scene.dataset.sceneId;
    var action = button.dataset.sceneAction;
    if (action === 'up') reorderScene(sceneId, -1);
    else if (action === 'down') reorderScene(sceneId, 1);
    else if (action === 'duplicate') duplicateScene(sceneId);
    else if (action === 'delete') deleteScene(sceneId);
  }

  function closeStoryboardActivity() {
    var frame = el('app-frame');
    var workspace = el('storyboard-workspace');
    if (workspace) workspace.classList.add('hidden');
    if (frame) frame.classList.remove('workspace-storyboard-open');
    if (typeof window.syncApplicationShellContext === 'function') window.syncApplicationShellContext();
    if (typeof window.syncShellLocationRoute === 'function') window.syncShellLocationRoute();
  }

  function openStoryboardActivity() {
    if (typeof window.closeGenerateActivity === 'function') window.closeGenerateActivity();
    var frame = el('app-frame');
    var workspace = el('storyboard-workspace');
    if (!frame || !workspace) throw new Error('Storyboard workspace markup is missing.');
    if (typeof window.closeTestBenchActivity === 'function') window.closeTestBenchActivity();
    storyState.director.modelId = getSharedDirectorModelPreference('webcap.storyboard.directorModel');
    frame.classList.add('workspace-storyboard-open');
    workspace.classList.remove('hidden');
    if (typeof window.syncApplicationShellContext === 'function') window.syncApplicationShellContext();
    if (typeof window.syncShellLocationRoute === 'function') window.syncShellLocationRoute();
    refreshDirector();
    refreshGenerationCapabilities();
    refreshLibrary().then(function () {
      return reconcileDirectorJobs();
    }).then(function () {
      if (storyState.story) {
        return refreshGenerationQueue(storyState.story.id).then(function () {
          renderStory();
        });
      }
      var first = storyState.stories && storyState.stories[0];
      if (first) return openStory(first.id);
      renderStory();
    }).catch(reportError);
  }

  function bindUi() {
    var workspace = el('storyboard-workspace');
    if (!workspace) throw new Error('Storyboard workspace markup is missing.');

    el('storyboard-new-btn').onclick = createStory;
    el('storyboard-story-toggle').onclick = function () { setStoryCollapsed(true); };
    el('storyboard-story-expand-toggle').onclick = function () { setStoryCollapsed(false); };
    el('storyboard-scenes-overview-btn').onclick = function () { setSceneViewMode('overview'); };
    el('storyboard-scenes-focus-btn').onclick = function () { setSceneViewMode('focus'); };
    el('storyboard-scenes-sequence-btn').onclick = function () { setSceneViewMode('sequence'); };
    el('storyboard-expand-concept-btn').onclick = expandConcept;
    el('storyboard-restore-concept-btn').onclick = restorePreviousConcept;
    el('storyboard-develop-btn').onclick = developStory;
    var sceneWorkspace = document.querySelector('.storyboard-scene-workspace');
    if (sceneWorkspace) {
      sceneWorkspace.addEventListener('scroll', function () {
        if (directorActivityActive()) positionDirectorActivity();
      }, { passive: true });
    }

    el('storyboard-scene-progression').addEventListener('click', function (event) {
      var sceneButton = event.target.closest('[data-scene-progress]');
      if (sceneButton) {
        setSceneViewMode('focus', sceneButton.dataset.sceneProgress);
        return;
      }
      if (event.target.closest('[data-scene-progress-add]')) addScene();
    });
    el('storyboard-director-model').addEventListener('change', function () {
      storyState.director.modelId = this.value;
      setSharedDirectorModelPreference(this.value);
    });

    el('storyboard-sequence-preview').addEventListener('click', function (event) {
      if (event.target.closest('[data-sequence-export]')) {
        exportSelectedSequence();
        return;
      }
      if (event.target.closest('[data-sequence-toggle]')) {
        storyState.sequenceCollapsed = !storyState.sequenceCollapsed;
        window.localStorage.setItem('webcap.storyboard.sequenceCollapsed', storyState.sequenceCollapsed ? '1' : '0');
        renderSequencePreview();
      }
    });

    var storyLibraryList = el('storyboard-library-list');
    storyLibraryList.onclick = function (event) {
      var row = event.target.closest('[data-story-id]');
      if (!row) return;
      var storyId = row.dataset.storyId;
      var menuSummary = event.target.closest('.storyboard-story-menu > summary');
      if (menuSummary) {
        var storyMenu = menuSummary.closest('.storyboard-story-menu');
        window.setTimeout(function () {
          if (!storyMenu.open) return;
          closeStoryActionMenus(storyMenu);
          positionStoryActionMenu(storyMenu);
        }, 0);
        return;
      }
      var actionButton = event.target.closest('[data-story-action]');
      if (actionButton) {
        var story = libraryStory(storyId);
        var action = actionButton.dataset.storyAction;
        var menu = actionButton.closest('details');
        if (menu) menu.open = false;
        if (action === 'duplicate') duplicateStory(storyId);
        else if (action === 'pin') toggleStoryPin(storyId);
        else if (action === 'archive') toggleStoryArchive(storyId);
        else if (action === 'export') exportStory(storyId);
        else if (action === 'delete') deleteStory(storyId, story && story.title);
        return;
      }
      if (event.target.closest('[data-story-open]')) openStory(storyId);
    };
    storyLibraryList.addEventListener('scroll', function () {
      closeStoryActionMenus();
    });
    document.addEventListener('click', function (event) {
      if (!event.target.closest('.storyboard-story-menu')) closeStoryActionMenus();
    });
    window.addEventListener('resize', function () {
      closeStoryActionMenus();
      if (directorActivityActive()) positionDirectorActivity();
    });
    workspace.addEventListener('scroll', function () {
      if (directorActivityActive()) positionDirectorActivity();
    }, true);

    ['storyboard-story-title', 'storyboard-story-concept', 'storyboard-story-style', 'storyboard-story-tags', 'storyboard-story-target-scenes'].forEach(function (id) {
      el(id).addEventListener('input', scheduleStorySave);
    });
    el('storyboard-story-megapixels').addEventListener('input', function () {
      syncSceneGenerationDefaultHints();
      scheduleStorySave();
    });
    el('storyboard-story-aspect-ratio').addEventListener('change', function () {
      syncSceneGenerationDefaultHints();
      scheduleStorySave();
    });
    el('storyboard-invariants-list').addEventListener('input', scheduleStorySave);
    el('storyboard-invariants-list').addEventListener('change', scheduleStorySave);
    el('storyboard-invariant-add').addEventListener('click', function () {
      el('storyboard-invariants-list').insertAdjacentHTML('beforeend', invariantRowHtml({ kind: 'character', title: '', text: '' }));
    });
    el('storyboard-invariants-list').addEventListener('click', function (event) {
      var remove = event.target.closest('[data-story-invariant-remove]');
      if (!remove) return;
      var row = remove.closest('[data-story-invariant-row]');
      if (!row) throw new Error('Story invariant row is missing.');
      row.remove();
      scheduleStorySave();
    });
    el('storyboard-story-status').addEventListener('change', scheduleStorySave);

    el('storyboard-story-lora-list').addEventListener('input', function (event) {
      if (!event.target.closest('[data-story-lora-row]')) return;
      syncStoryLorasIntoScenes();
      scheduleStorySave();
    });
    el('storyboard-story-lora-list').addEventListener('change', function (event) {
      if (!event.target.closest('[data-story-lora-row]')) return;
      syncStoryLorasIntoScenes();
      scheduleStorySave();
    });
    var storyLoraPicker = el('storyboard-story-lora-picker');
    storyLoraPicker.addEventListener('focus', function () { renderLoraPickerMenu(storyLoraPicker); });
    storyLoraPicker.addEventListener('click', function () { renderLoraPickerMenu(storyLoraPicker); });
    storyLoraPicker.addEventListener('input', function () { renderLoraPickerMenu(storyLoraPicker); });
    storyLoraPicker.addEventListener('keydown', handleLoraPickerKeydown);
    storyLoraPicker.closest('.storyboard-lora-picker-wrap').addEventListener('click', function (event) {
      var option = event.target.closest('[data-lora-picker-option]');
      if (option) chooseLoraPickerOption(storyLoraPicker, option.dataset.loraPickerOption);
    });

    el('storyboard-story-lora-list').addEventListener('click', function (event) {
      var remove = event.target.closest('[data-story-lora-remove]');
      if (!remove) return;
      var row = remove.closest('[data-story-lora-row]');
      if (!row) return;
      row.remove();
      syncStoryLorasIntoScenes();
      scheduleStorySave();
    });

    el('storyboard-scenes-list').addEventListener('focusin', function (event) {
      var inheritedMegapixels = event.target.closest('[data-scene-field="megapixels"]');
      if (inheritedMegapixels) seedInheritedSceneMegapixels(inheritedMegapixels);
      var picker = event.target.closest('[data-scene-lora-picker]');
      if (picker) renderLoraPickerMenu(picker);
    });
    el('storyboard-scenes-list').addEventListener('keydown', handleLoraPickerKeydown);
    el('storyboard-scenes-list').addEventListener('input', function (event) {
      var picker = event.target.closest('[data-scene-lora-picker]');
      if (picker) {
        renderLoraPickerMenu(picker);
        return;
      }
      var loraRow = event.target.closest('[data-scene-lora-row], [data-story-lora-inherited-row]');
      if (loraRow) {
        var loraScene = loraRow.closest('.storyboard-scene[data-scene-id]');
        if (!loraScene) throw new Error('LoRA Scene is missing.');
        scheduleSceneSave(loraScene.dataset.sceneId);
        return;
      }
      handleSceneInput(event);
    });
    el('storyboard-scenes-list').addEventListener('change', function (event) {
      var loraRow = event.target.closest('[data-scene-lora-row], [data-story-lora-inherited-row]');
      if (loraRow) {
        var loraScene = loraRow.closest('.storyboard-scene[data-scene-id]');
        if (!loraScene) throw new Error('LoRA Scene is missing.');
        scheduleSceneSave(loraScene.dataset.sceneId);
        return;
      }
      var referenceUpload = event.target.closest('[data-reference-upload]');
      if (referenceUpload) {
        var referenceUploadScene = referenceUpload.closest('.storyboard-scene[data-scene-id]');
        if (!referenceUploadScene) throw new Error('Reference upload Scene is missing.');
        var referenceRole = referenceUploadScene.querySelector('[data-reference-role]');
        uploadSceneReference(
          referenceUploadScene.dataset.sceneId,
          referenceRole ? referenceRole.value : 'first_frame',
          referenceUpload.files && referenceUpload.files[0]
        );
        return;
      }
      var upload = event.target.closest('[data-take-upload]');
      if (upload) {
        var uploadScene = upload.closest('.storyboard-scene[data-scene-id]');
        if (!uploadScene) throw new Error('Take upload Scene is missing.');
        uploadTake(uploadScene.dataset.sceneId, upload.files && upload.files[0]);
        return;
      }
      var takeLabel = event.target.closest('[data-take-label]');
      if (takeLabel) {
        var labelScene = takeLabel.closest('.storyboard-scene[data-scene-id]');
        if (!labelScene) throw new Error('Take label Scene is missing.');
        labelTake(labelScene.dataset.sceneId, takeLabel.dataset.takeLabel, takeLabel.value);
        return;
      }
      handleSceneInput(event);
    });
    workspace.addEventListener('click', function (event) {
      if (event.target.closest('.storyboard-lora-picker-wrap')) return;
      closeAllLoraPickers();
    });

    el('storyboard-scenes-list').addEventListener('click', function (event) {
      var openScene = event.target.closest('[data-scene-open]');
      if (openScene) {
        setSceneViewMode('focus', openScene.dataset.sceneOpen);
        return;
      }
      var pickerOption = event.target.closest('[data-lora-picker-option]');
      if (pickerOption) {
        var pickerWrap = pickerOption.closest('.storyboard-lora-picker-wrap');
        var optionPicker = pickerWrap && pickerWrap.querySelector('[data-scene-lora-picker]');
        if (!optionPicker) throw new Error('Scene LoRA picker is missing.');
        chooseLoraPickerOption(optionPicker, pickerOption.dataset.loraPickerOption);
        return;
      }
      var clickedPicker = event.target.closest('[data-scene-lora-picker]');
      if (clickedPicker) {
        renderLoraPickerMenu(clickedPicker);
        return;
      }
      var removeLora = event.target.closest('[data-scene-lora-remove]');
      if (removeLora) {
        var removeLoraScene = removeLora.closest('.storyboard-scene[data-scene-id]');
        if (!removeLoraScene) throw new Error('LoRA Scene is missing.');
        var removeRow = removeLora.closest('[data-scene-lora-row]');
        if (!removeRow) throw new Error('LoRA row is missing.');
        removeRow.remove();
        scheduleSceneSave(removeLoraScene.dataset.sceneId);
        return;
      }
      var directorPreview = event.target.closest('[data-director-preview]');
      if (directorPreview) {
        var previewScene = directorPreview.closest('.storyboard-scene[data-scene-id]');
        if (!previewScene) throw new Error('Director preview Scene is missing.');
        previewDirectorRequest(previewScene.dataset.sceneId, directorPreview.dataset.directorPreview);
        return;
      }
      var directorWrite = event.target.closest('[data-director-write]');
      if (directorWrite) {
        var writeScene = directorWrite.closest('.storyboard-scene[data-scene-id]');
        if (!writeScene) throw new Error('Director Scene is missing.');
        runDirector(writeScene.dataset.sceneId, 'write_prompt');
        return;
      }
      var directorRefine = event.target.closest('[data-director-refine]');
      if (directorRefine) {
        var refineScene = directorRefine.closest('.storyboard-scene[data-scene-id]');
        if (!refineScene) throw new Error('Director Scene is missing.');
        runDirector(refineScene.dataset.sceneId, 'refine_prompt');
        return;
      }
      var directorRestore = event.target.closest('[data-director-restore]');
      if (directorRestore) {
        var restorePromptScene = directorRestore.closest('.storyboard-scene[data-scene-id]');
        if (!restorePromptScene) throw new Error('Director Scene is missing.');
        restoreSceneDirectorPrompt(restorePromptScene.dataset.sceneId);
        return;
      }
      var generate = event.target.closest('[data-scene-generate]');
      if (generate) {
        var generateSceneRoot = generate.closest('.storyboard-scene[data-scene-id]');
        if (!generateSceneRoot) throw new Error('Generation Scene is missing.');
        generateScene(generateSceneRoot.dataset.sceneId);
        return;
      }
      var executionAction = event.target.closest('[data-generation-action]');
      if (executionAction) {
        generationAction(executionAction.dataset.generationAction, executionAction.dataset.jobId);
        return;
      }
      var takeRating = event.target.closest('[data-take-rating][data-rating-value]');
      if (takeRating) {
        var ratingScene = takeRating.closest('.storyboard-scene[data-scene-id]');
        if (!ratingScene) throw new Error('Take rating Scene is missing.');
        rateTake(ratingScene.dataset.sceneId, takeRating.dataset.takeRating, takeRating.dataset.ratingValue);
        return;
      }
      var takeAction = event.target.closest('[data-take-action]');
      if (takeAction) {
        var takeScene = takeAction.closest('.storyboard-scene[data-scene-id]');
        if (!takeScene) throw new Error('Take action Scene is missing.');
        if (takeAction.dataset.takeAction === 'select') selectTake(takeScene.dataset.sceneId, takeAction.dataset.takeId);
        else if (takeAction.dataset.takeAction === 'remove') removeTake(takeScene.dataset.sceneId, takeAction.dataset.takeId);
        else if (takeAction.dataset.takeAction === 'delete') deleteTake(takeScene.dataset.sceneId, takeAction.dataset.takeId);
        else if (takeAction.dataset.takeAction === 'restore') restoreTake(takeScene.dataset.sceneId, takeAction.dataset.takeId);
        return;
      }
      var referenceClear = event.target.closest('[data-reference-clear]');
      if (referenceClear) {
        var clearScene = referenceClear.closest('.storyboard-scene[data-scene-id]');
        if (!clearScene) throw new Error('Reference Scene is missing.');
        clearSceneReference(clearScene.dataset.sceneId, referenceClear.dataset.referenceClear);
        return;
      }
      var previousReference = event.target.closest('[data-reference-previous]');
      if (previousReference) {
        var targetScene = previousReference.closest('.storyboard-scene[data-scene-id]');
        if (!targetScene) throw new Error('Reference Scene is missing.');
        var order = storyState.story.sceneOrder || [];
        var targetIndex = order.indexOf(targetScene.dataset.sceneId);
        if (targetIndex <= 0) throw new Error('Previous Scene is missing.');
        var sourceSceneId = order[targetIndex - 1];
        var sourceScene = storyState.story.scenes[sourceSceneId];
        if (!sourceScene || !sourceScene.selectedTakeId) throw new Error('Previous Scene has no selected Take.');
        setSceneReference(targetScene.dataset.sceneId, 'first_frame', sourceSceneId, sourceScene.selectedTakeId, 'last');
        return;
      }
      var referenceApply = event.target.closest('[data-reference-apply]');
      if (referenceApply) {
        var referenceScene = referenceApply.closest('.storyboard-scene[data-scene-id]');
        if (!referenceScene) throw new Error('Reference Scene is missing.');
        var role = referenceScene.querySelector('[data-reference-role]').value;
        var sourceValue = referenceScene.querySelector('[data-reference-source]').value;
        var frame = referenceScene.querySelector('[data-reference-frame]').value;
        if (!sourceValue || sourceValue.indexOf('|') < 0) {
          window.alert('Choose a Take to assign as a reference.');
          return;
        }
        var sourceParts = sourceValue.split('|');
        setSceneReference(referenceScene.dataset.sceneId, role, sourceParts[0], sourceParts[1], frame);
        return;
      }
      var restore = event.target.closest('[data-restore-scene]');
      if (restore) {
        restoreScene(restore.dataset.restoreScene);
        return;
      }
      handleSceneAction(event);
    });
  }

  window.openStoryboardActivity = openStoryboardActivity;
  window.closeStoryboardActivity = closeStoryboardActivity;
  bindUi();
})();
