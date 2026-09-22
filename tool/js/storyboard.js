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
    sequenceExport: null,
    generationCapabilities: {
      loras: [],
      baseLoras: [],
      available: false,
      error: ''
    },
    director: {
      models: [],
      modelId: window.localStorage.getItem('webcap.storyboard.directorModel') || '',
      available: false,
      busy: false,
      error: ''
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
        if (storyState.story) renderScenes();
        return body;
      });
    }).catch(function (err) {
      storyState.generationCapabilities.available = false;
      storyState.generationCapabilities.loras = [];
      storyState.generationCapabilities.baseLoras = [];
      storyState.generationCapabilities.error = String(err && err.message ? err.message : err);
      if (storyState.story) renderScenes();
      return null;
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
        return body;
      });
    });
  }

  function renderDirectorSelector() {
    var select = el('storyboard-director-model');
    var status = el('storyboard-director-status');
    if (!select || !status) return;

    var models = storyState.director.models || [];
    if (!storyState.director.available) {
      select.innerHTML = '<option value="">Director unavailable</option>';
      select.disabled = true;
      status.textContent = storyState.director.error || '';
      return;
    }

    if (!models.length) {
      select.innerHTML = '<option value="">No GGUF models found</option>';
      select.disabled = true;
      status.textContent = 'Add GGUFs to the Director model folder.';
      return;
    }

    select.disabled = !!storyState.director.busy;
    select.innerHTML = models.map(function (model) {
      return '<option value="' + escapeHtml(model.id) + '">' + escapeHtml(model.label || model.id) + '</option>';
    }).join('');

    var selected = storyState.director.modelId;
    if (!models.some(function (model) { return model.id === selected; })) {
      selected = models[0].id;
      storyState.director.modelId = selected;
      window.localStorage.setItem('webcap.storyboard.directorModel', selected);
    }
    select.value = selected;
    status.textContent = 'llama.cpp';
  }

  function refreshDirector() {
    return directorRequest(null).then(function (payload) {
      storyState.director.available = !!payload.available;
      storyState.director.models = payload.models || [];
      storyState.director.error = payload.error || '';
      renderDirectorSelector();
      return payload;
    }).catch(function (err) {
      storyState.director.available = false;
      storyState.director.models = [];
      storyState.director.error = String(err && err.message ? err.message : err);
      renderDirectorSelector();
    });
  }

  function updateSceneDirectorStatus(sceneId, text) {
    var root = sceneElement(sceneId);
    var node = root && root.querySelector('[data-director-status]');
    if (node) node.textContent = text || '';
  }

  function runDirector(sceneId, operation) {
    if (!storyState.story || storyState.director.busy) return;
    var modelId = storyState.director.modelId;
    if (!modelId) {
      reportError(new Error('Choose a Storyboard Director model first.'));
      return;
    }
    var root = sceneElement(sceneId);
    if (!root) throw new Error('Scene editor is missing for ' + sceneId + '.');

    var instruction = '';
    if (operation === 'refine_prompt') {
      var correction = root.querySelector('[data-director-correction]');
      instruction = correction ? correction.value.trim() : '';
      if (!instruction) {
        updateSceneDirectorStatus(sceneId, 'Enter a correction first.');
        return;
      }
    }

    setDirectorBusy(true);
    updateSceneDirectorStatus(sceneId, 'Director working…');
    flushPendingSaves().then(function () {
      return directorRequest({
        storyId: storyState.story.id,
        sceneId: sceneId,
        operation: operation,
        model: modelId,
        instruction: instruction
      });
    }).then(function (payload) {
      var prompt = root.querySelector('[data-scene-field="prompt"]');
      if (!prompt) throw new Error('Scene generation prompt field is missing.');
      prompt.value = payload.result || '';
      updateSceneDirectorStatus(sceneId, 'Generated with ' + String(payload.model || modelId));
      return saveSceneNow(sceneId);
    }).catch(function (err) {
      updateSceneDirectorStatus(sceneId, 'Director failed');
      reportError(err);
    }).finally(function () {
      setDirectorBusy(false);
    });
  }

  function setDevelopStatus(text) {
    var node = el('storyboard-develop-status');
    if (node) node.textContent = text || '';
  }

  function setStoryDirectorInputsDisabled(disabled) {
    ['storyboard-story-title', 'storyboard-story-concept', 'storyboard-story-style'].forEach(function (id) {
      el(id).disabled = !!disabled;
    });
  }

  function setDirectorBusy(busy) {
    storyState.director.busy = !!busy;
    setStoryDirectorInputsDisabled(busy);
    ['storyboard-expand-concept-btn', 'storyboard-develop-btn'].forEach(function (id) {
      var node = el(id);
      if (node) node.disabled = !!busy;
    });
    var restore = el('storyboard-restore-concept-btn');
    if (restore) restore.disabled = !!busy;
    var selector = el('storyboard-director-model');
    if (selector) selector.disabled = !!busy || !storyState.director.available || !(storyState.director.models || []).length;
    Array.prototype.forEach.call(document.querySelectorAll('[data-director-write], [data-director-refine]'), function (button) {
      button.disabled = !!busy;
    });
  }

  function expandConcept() {
    if (!storyState.story || storyState.director.busy) return;
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

    var storyId = storyState.story.id;
    setDirectorBusy(true);
    setDevelopStatus('Director is expanding the concept…');
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
      return refreshLibrary();
    }).catch(function (err) {
      setDevelopStatus('Concept expansion failed.');
      reportError(err);
    }).finally(function () {
      setDirectorBusy(false);
    });
  }

  function restorePreviousConcept() {
    if (!storyState.story || storyState.director.busy || typeof storyState.story.previousConcept !== 'string') return;
    var storyId = storyState.story.id;
    setDirectorBusy(true);
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
      setDirectorBusy(false);
    });
  }

  function developStory() {
    if (!storyState.story || storyState.director.busy) return;
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

    var storyId = storyState.story.id;
    var hasScenes = Array.isArray(storyState.story.sceneOrder) && storyState.story.sceneOrder.length > 0;
    if (hasScenes && !window.confirm(
      'Developing this Story again will replace the active Scene plan. Existing Scenes and Takes will remain recoverable in Removed Scenes. Continue?'
    )) return;

    setDirectorBusy(true);
    setDevelopStatus('Director is developing the Story…');
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
      renderStory();
      setDevelopStatus('Developed ' + String(payload.sceneCount || 0) + ' Scenes with ' + String(payload.model || modelId) + '.');
      setSaveState('Saved');
      return refreshLibrary();
    }).catch(function (err) {
      setDevelopStatus('Story development failed.');
      reportError(err);
    }).finally(function () {
      setDirectorBusy(false);
    });
  }

  function setSaveState(text) {
    var node = el('storyboard-save-state');
    if (node) node.textContent = text || '';
  }

  function storyTagsText(story) {
    return Array.isArray(story && story.tags) ? story.tags.join(', ') : '';
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
    if (!selected.length) {
      host.innerHTML = '';
      host.classList.add('hidden');
      return;
    }
    host.classList.remove('hidden');
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
      '<button type="button" class="storyboard-primary-btn" data-sequence-export>Export Sequence</button>' +
      '<span class="storyboard-save-state" data-sequence-status>' + assemblyStatus + '</span>' +
      '</div></header>' + outputHtml + '<div class="storyboard-sequence-list">' +
      selected.map(function (item) {
        return '<article class="storyboard-sequence-card">' +
          '<div class="storyboard-sequence-label">Scene ' + String(item.number).padStart(2, '0') + ' · ' +
            escapeHtml(item.scene.title || 'Untitled Scene') + '</div>' +
          '<div class="storyboard-sequence-media">' + takePreviewHtml(story.id, item.sceneId, item.take) + '</div>' +
        '</article>';
      }).join('') + '</div>';
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
        return '<button type="button" class="storyboard-story-row' + (active ? ' active' : '') + '" data-story-id="' + escapeHtml(story.id) + '">' +
          '<strong>' + escapeHtml(story.title || 'Untitled Story') + '</strong>' +
          '<span>' + escapeHtml(meta.join(' · ')) + '</span>' +
          '</button>';
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

  function loraOptions(selectedName, filterText) {
    var names = (storyState.generationCapabilities.loras || []).slice();
    var filter = String(filterText || '').trim().toLowerCase();
    if (filter) {
      names = names.filter(function (name) {
        return String(name || '').toLowerCase().indexOf(filter) !== -1;
      });
    }
    if (selectedName && names.indexOf(selectedName) < 0) names.unshift(selectedName);
    if (!names.length) return '<option value="">No matching LoRAs</option>';
    return names.map(function (name) {
      return '<option value="' + escapeHtml(name) + '"' + (name === selectedName ? ' selected' : '') + '>' +
        escapeHtml(name) + '</option>';
    }).join('');
  }

  function loraRowHtml(lora, filterText) {
    lora = lora || {};
    var name = String(lora.name || '');
    var strength = lora.strength == null ? 1 : lora.strength;
    return '<div class="storyboard-lora-row" data-scene-lora-row>' +
      '<select data-scene-lora-name>' + loraOptions(name, filterText) + '</select>' +
      '<input type="number" step="0.05" data-scene-lora-strength value="' + escapeHtml(strength) + '" aria-label="LoRA strength">' +
      '<button type="button" class="review-captions-btn" data-scene-lora-remove title="Remove LoRA">×</button>' +
    '</div>';
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

  function renderScenes() {
    var host = el('storyboard-scenes-list');
    if (!host || !storyState.story) return;
    var story = storyState.story;
    var order = Array.isArray(story.sceneOrder) ? story.sceneOrder : [];
    var scenes = story.scenes || {};
    var removedScenes = story.removedScenes || {};

    var activeHtml = order.map(function (sceneId, index) {
      var scene = scenes[sceneId] || {};
      var seedMode = sceneValue(scene, 'seedMode', 'random');
      var seed = sceneValue(scene, 'seed', '');
      var seedDisplay = seedMode === 'fixed' && seed !== '' && seed != null ? seed : -1;
      var sceneReferences = Array.isArray(scene.references) ? scene.references : [];
      var continuityConfigured = !!(
        String(sceneValue(scene, 'entryState', '')).trim() ||
        String(sceneValue(scene, 'exitState', '')).trim() ||
        String(sceneValue(scene, 'notes', '')).trim()
      );
      var takes = scene.takes && typeof scene.takes === 'object' ? scene.takes : {};
      var removedTakes = scene.removedTakes && typeof scene.removedTakes === 'object' ? scene.removedTakes : {};
      var takeOrder = Array.isArray(scene.takeOrder) ? scene.takeOrder : [];
      var previousSceneId = index > 0 ? order[index - 1] : '';
      var previousScene = previousSceneId ? scenes[previousSceneId] || {} : {};
      var previousSelectedTakeId = previousScene.selectedTakeId || '';
      var generationJob = storyState.generationJobs[sceneId] || null;
      var generationQueued = generationJob && generationJob.status === 'queued';
      var generationRunning = generationJob && generationJob.status === 'running';
      var generationBusy = generationQueued || generationRunning;
      var sceneLoras = Array.isArray(scene.loras) ? scene.loras : [];
      var loraRowsHtml = sceneLoras.map(loraRowHtml).join('');
      var advancedSummaryParts = [];
      if (seedMode === 'fixed') advancedSummaryParts.push('Fixed seed');
      if (scene.wildcardsEnabled) advancedSummaryParts.push('Wildcards');
      if (sceneLoras.length) advancedSummaryParts.push(sceneLoras.length + ' LoRA' + (sceneLoras.length === 1 ? '' : 's'));
      var advancedSummary = advancedSummaryParts.length ? advancedSummaryParts.join(' · ') : 'Optional';
      var baseLoras = storyState.generationCapabilities.baseLoras || [];
      var loraStatus = storyState.generationCapabilities.available
        ? (baseLoras.length ? 'Base: ' + baseLoras.join(', ') : 'ComfyUI LoRAs loaded.')
        : (storyState.generationCapabilities.error || 'ComfyUI LoRAs unavailable.');
      var canAddLora = storyState.generationCapabilities.available && (storyState.generationCapabilities.loras || []).length > 0;
      var referencesHtml = sceneReferences.map(function (reference) {
        if (!reference || !reference.role) return '';
        return '<span class="storyboard-reference-chip">' +
          escapeHtml(reference.role.replace(/_/g, ' ')) + ' · ' +
          escapeHtml(reference.frame || 'source') +
          '<button type="button" data-reference-clear="' + escapeHtml(reference.role) + '" title="Clear reference" aria-label="Clear reference">×</button>' +
        '</span>';
      }).join('');
      var removedTakeIds = Object.keys(removedTakes);
      var removedTakesHtml = removedTakeIds.length
        ? '<div class="storyboard-removed-takes"><span>Removed Takes</span>' +
          removedTakeIds.map(function (takeId) {
            var take = removedTakes[takeId] || {};
            return '<button type="button" class="review-captions-btn" data-take-action="restore" data-take-id="' +
              escapeHtml(takeId) + '">Restore ' + escapeHtml(take.sourceFilename || takeId) + '</button>';
          }).join('') + '</div>'
        : '';
      var takesHtml = takeOrder.map(function (takeId, takeIndex) {
        var take = takes[takeId];
        if (!take) return '';
        var rating = take.rating == null ? '' : String(take.rating);
        var selected = scene.selectedTakeId === takeId;
        var ratingOptions = '<option value="">Unrated</option>';
        [1, 2, 3, 4, 5].forEach(function (value) {
          ratingOptions += '<option value="' + value + '"' + (rating === String(value) ? ' selected' : '') + '>' + value + ' star' + (value === 1 ? '' : 's') + '</option>';
        });
        return '<article class="storyboard-take' + (selected ? ' selected' : '') + '" data-take-id="' + escapeHtml(takeId) + '">' +
          '<div class="storyboard-take-media">' + takePreviewHtml(story.id, sceneId, take) + '</div>' +
          '<div class="storyboard-take-footer">' +
            '<div class="storyboard-take-identity" title="' + escapeHtml(take.sourceFilename || '') + '">' +
              '<strong>Take ' + String(takeIndex + 1).padStart(2, '0') + '</strong>' +
              '<span>' + escapeHtml(takeMetaLabel(take)) + '</span>' +
            '</div>' +
            '<select data-take-rating="' + escapeHtml(takeId) + '" aria-label="Take rating">' + ratingOptions + '</select>' +
            '<button type="button" class="review-captions-btn" data-take-action="select" data-take-id="' + escapeHtml(takeId) + '"' + (selected ? ' disabled' : '') + '>' + (selected ? 'Selected' : 'Select') + '</button>' +
            '<button type="button" class="review-captions-btn" data-take-action="remove" data-take-id="' + escapeHtml(takeId) + '">Remove</button>' +
          '</div>' +
        '</article>';
      }).join('');
      return '<section class="storyboard-scene" data-scene-id="' + escapeHtml(sceneId) + '">' +
        '<header class="storyboard-scene-header">' +
          '<span class="storyboard-scene-number">Scene ' + String(index + 1).padStart(2, '0') + '</span>' +
          '<input class="storyboard-scene-title" data-scene-field="title" value="' + escapeHtml(sceneValue(scene, 'title', '')) + '" placeholder="Scene title">' +
          '<div class="storyboard-scene-actions">' +
            '<button type="button" class="review-captions-btn" data-scene-action="up" title="Move Scene up" aria-label="Move Scene up" ' + (index === 0 ? 'disabled' : '') + '>↑</button>' +
            '<button type="button" class="review-captions-btn" data-scene-action="down" title="Move Scene down" aria-label="Move Scene down" ' + (index === order.length - 1 ? 'disabled' : '') + '>↓</button>' +
            '<button type="button" class="review-captions-btn" data-scene-action="duplicate" title="Duplicate this Scene, including its current authoring settings">Duplicate</button>' +
            '<button type="button" class="review-captions-btn" data-scene-action="delete" title="Remove this Scene; it remains recoverable under Removed Scenes">Remove</button>' +
          '</div>' +
        '</header>' +
        '<div class="storyboard-scene-body">' +
          '<div class="storyboard-scene-main">' +
            '<label class="storyboard-field storyboard-scene-intent"><span>Scene intent</span><textarea data-scene-field="summary" rows="2" placeholder="Describe what happens in this Scene.">' + escapeHtml(sceneValue(scene, 'summary', '')) + '</textarea></label>' +
            '<div class="storyboard-prompt-block">' +
              '<div class="storyboard-prompt-heading">' +
                '<span>Generation prompt</span>' +
                '<button type="button" class="review-captions-btn" data-director-write title="Draft a complete H3 prompt from this Scene intent and the useful Story context.">Write with Director</button>' +
              '</div>' +
              '<textarea class="storyboard-prompt-textarea" data-scene-field="prompt" rows="7" placeholder="Full model-facing prompt. Write it directly or let the Director draft it from the Scene intent.">' + escapeHtml(sceneValue(scene, 'prompt', '')) + '</textarea>' +
              '<div class="storyboard-director-actions">' +
                '<input type="text" data-director-correction placeholder="Tell the Director what to change in this prompt...">' +
                '<button type="button" class="review-captions-btn" data-director-refine title="Apply this correction to the existing generation prompt.">Refine</button>' +
                '<span class="storyboard-save-state" data-director-status></span>' +
              '</div>' +
            '</div>' +
            '<details class="storyboard-scene-disclosure storyboard-continuity-details">' +
              '<summary><span>Continuity &amp; notes</span><span class="storyboard-disclosure-summary-state">' + (continuityConfigured ? 'Configured' : 'Optional') + '</span></summary>' +
              '<div class="storyboard-disclosure-body">' +
                '<div class="storyboard-scene-handoff-row">' +
                  '<label class="storyboard-field"><span>Entry state</span><textarea data-scene-field="entryState" rows="2" placeholder="What must already be true when this Scene begins?">' + escapeHtml(sceneValue(scene, 'entryState', '')) + '</textarea></label>' +
                  '<label class="storyboard-field"><span>Exit state</span><textarea data-scene-field="exitState" rows="2" placeholder="What should be true when this Scene ends?">' + escapeHtml(sceneValue(scene, 'exitState', '')) + '</textarea></label>' +
                '</div>' +
                '<label class="storyboard-field"><span>Notes</span><textarea data-scene-field="notes" rows="2" placeholder="Continuity reminders, corrections, ideas...">' + escapeHtml(sceneValue(scene, 'notes', '')) + '</textarea></label>' +
              '</div>' +
            '</details>' +
          '</div>' +
          '<aside class="storyboard-scene-meta">' +
            '<div class="storyboard-scene-quick">' +
              '<label class="storyboard-field" title="Scene-specific clip duration."><span>Duration (s)</span><input type="number" min="4" max="15" step="0.1" data-scene-field="durationSeconds" value="' + escapeHtml(sceneValue(scene, 'durationSeconds', 6)) + '"></label>' +
              '<div class="storyboard-generate-panel">' +
                '<button type="button" class="storyboard-primary-btn storyboard-generate-btn" data-scene-generate title="Generate a new Take from the current saved Scene."' + (generationBusy ? ' disabled' : '') + '>' +
                  (generationQueued ? 'Queued…' : (generationRunning ? 'Generating…' : 'Generate Take')) +
                '</button>' +
              '</div>' +
            '</div>' +
            '<details class="storyboard-scene-disclosure storyboard-advanced-details">' +
              '<summary><span>Advanced</span><span class="storyboard-disclosure-summary-state">' + escapeHtml(advancedSummary) + '</span></summary>' +
              '<div class="storyboard-disclosure-body">' +
                '<div class="storyboard-scene-meta-row">' +
                  '<label class="storyboard-field" title="Currently stored per Scene; keep this consistent across a Story unless you intentionally need an override."><span>Aspect ratio</span><select data-scene-field="aspectRatio">' +
                    ['1:1 (Square)', '2:3 (Portrait Photo)', '3:2 (Photo)', '3:4 (Portrait Standard)', '4:3 (Standard)', '9:16 (Portrait Widescreen)', '16:9 (Widescreen)', '21:9 (Ultrawide)'].map(function (value) {
                      return '<option value="' + escapeHtml(value) + '"' + (sceneValue(scene, 'aspectRatio', '4:3 (Standard)') === value ? ' selected' : '') + '>' + escapeHtml(value) + '</option>';
                    }).join('') +
                  '</select></label>' +
                  '<label class="storyboard-field" title="Output size target for this Scene. Useful when promoting a shot toward final output."><span>Megapixels</span><input type="number" min="0.05" step="0.05" data-scene-field="megapixels" value="' + escapeHtml(sceneValue(scene, 'megapixels', 0.2)) + '"></label>' +
                '</div>' +
                '<label class="storyboard-field" title="Use -1 for a random seed, or enter a non-negative integer for a fixed seed."><span>Seed</span><input type="number" min="-1" step="1" data-scene-field="seed" value="' + escapeHtml(seedDisplay) + '"></label>' +
                '<label class="storyboard-inline-check" title="Allow wildcard syntax in the generation prompt."><input type="checkbox" data-scene-field="wildcardsEnabled"' + (scene.wildcardsEnabled ? ' checked' : '') + '> Wildcards intended</label>' +
                '<div class="storyboard-lora-panel">' +
                  '<div class="storyboard-lora-header"><strong>LoRAs</strong><input type="search" class="storyboard-lora-filter" data-scene-lora-filter placeholder="Filter LoRAs…" aria-label="Filter available LoRAs"><button type="button" class="review-captions-btn" data-scene-lora-add title="Add a Scene-specific LoRA override."' + (canAddLora ? '' : ' disabled') + '>Add LoRA</button></div>' +
                  '<div class="storyboard-lora-list" data-scene-lora-list>' + loraRowsHtml + '</div>' +
                  '<span class="storyboard-reference-empty">' + escapeHtml(loraStatus) + '</span>' +
                '</div>' +
              '</div>' +
            '</details>' +
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
                  '<button type="button" class="review-captions-btn" data-reference-apply title="Assign the selected Take frame to this reference slot.">Assign</button>' +
                '</div>' +
              '</div>' +
            '</details>' +
          '</aside>' +
        '</div>' +
        '<div class="storyboard-takes">' +
          '<div class="storyboard-takes-header"><div><strong>Takes</strong><span>Imported media is copied into this Story and keeps a frozen Scene snapshot.</span></div>' +
            '<label class="review-captions-btn storyboard-take-upload-btn">Add Take<input type="file" accept="image/*,video/*" data-take-upload hidden></label>' +
          '</div>' +
          '<div class="storyboard-takes-grid">' + (takesHtml || '<div class="storyboard-takes-empty">No Takes yet.</div>') + '</div>' +
          removedTakesHtml +
        '</div>' +
      '</section>';
    }).join('');

    if (!activeHtml) activeHtml = '<div class="storyboard-library-empty">No Scenes yet. Add the first generatable scene.</div>';

    var removedIds = Object.keys(removedScenes);
    var removedHtml = '';
    if (removedIds.length) {
      removedHtml = '<section class="storyboard-removed-scenes"><div class="storyboard-list-section-title">Removed Scenes</div>' +
        removedIds.map(function (sceneId) {
          var scene = removedScenes[sceneId] || {};
          return '<div class="storyboard-removed-scene" data-removed-scene-id="' + escapeHtml(sceneId) + '">' +
            '<span>' + escapeHtml(scene.title || 'Untitled Scene') + '</span>' +
            '<button type="button" class="review-captions-btn" data-restore-scene="' + escapeHtml(sceneId) + '">Restore</button>' +
          '</div>';
        }).join('') + '</section>';
    }

    host.innerHTML = activeHtml + removedHtml;
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
    el('storyboard-story-tags').value = storyTagsText(storyState.story);
    el('storyboard-story-status').value = storyState.story.status || 'active';
    el('storyboard-story-pinned').checked = !!storyState.story.pinned;
    var developButton = el('storyboard-develop-btn');
    if (developButton) {
      developButton.textContent = (storyState.story.sceneOrder || []).length ? 'Develop Again' : 'Develop Story';
    }
    var restoreConceptButton = el('storyboard-restore-concept-btn');
    if (restoreConceptButton) {
      restoreConceptButton.classList.toggle('hidden', typeof storyState.story.previousConcept !== 'string');
    }
    renderScenes();
    setDirectorBusy(storyState.director.busy);
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
    setSaveState('Loading...');
    return flushPendingSaves().then(function () {
      return request(null, 'story=' + encodeURIComponent(storyId));
    }).then(function (payload) {
      storyState.story = payload.story;
      storyState.sequenceExport = null;
      renderStory();
      setSaveState('Saved');
      return refreshSequenceExport(storyId);
    }).catch(reportError);
  }

  function createStory() {
    return flushPendingSaves().then(function () {
      return request({
        operation: 'create_story',
        story: { title: 'Untitled Story', concept: '', style: '', tags: [], status: 'active', pinned: false }
      });
    }).then(function (payload) {
      storyState.story = payload.story;
      storyState.sequenceExport = null;
      return refreshLibrary().then(function () {
        renderStory();
        setSaveState('Saved');
      });
    }).catch(reportError);
  }

  function storyPayloadFromUi() {
    return {
      title: el('storyboard-story-title').value,
      concept: el('storyboard-story-concept').value,
      style: el('storyboard-story-style').value,
      tags: el('storyboard-story-tags').value.split(',').map(function (value) { return value.trim(); }).filter(Boolean),
      status: el('storyboard-story-status').value,
      pinned: el('storyboard-story-pinned').checked
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
    function field(name) {
      return root.querySelector('[data-scene-field="' + name + '"]');
    }
    var seedNode = field('seed');
    var seedText = String(seedNode.value || '').trim();
    var randomSeed = seedText === '' || seedText === '-1';
    return {
      title: field('title').value,
      summary: field('summary').value,
      entryState: field('entryState').value,
      exitState: field('exitState').value,
      prompt: field('prompt').value,
      notes: field('notes').value,
      durationSeconds: field('durationSeconds').value,
      aspectRatio: field('aspectRatio').value,
      megapixels: field('megapixels').value,
      seedMode: randomSeed ? 'random' : 'fixed',
      seed: randomSeed ? null : seedText,
      wildcardsEnabled: field('wildcardsEnabled').checked,
      loras: Array.prototype.map.call(root.querySelectorAll('[data-scene-lora-row]'), function (row) {
        return {
          name: row.querySelector('[data-scene-lora-name]').value,
          strength: row.querySelector('[data-scene-lora-strength]').value
        };
      }).filter(function (item) { return !!item.name; })
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
      scene: { title: 'New Scene', durationSeconds: 6, aspectRatio: '4:3 (Standard)', megapixels: 0.2, seedMode: 'random' }
    }); }).then(function (payload) {
      storyState.story = payload.story;
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

  function syncGenerationButton(sceneId, job) {
    var root = sceneElement(sceneId);
    if (!root) return;
    var button = root.querySelector('[data-scene-generate]');
    if (!button) return;
    var queued = !!(job && job.status === 'queued');
    var running = !!(job && job.status === 'running');
    button.disabled = queued || running;
    if (queued) button.textContent = 'Queued…';
    else button.textContent = running ? 'Generating…' : 'Generate Take';
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
    } else if (job.status === 'running') {
      reportConsoleInfo(generationConsoleLabel(sceneId), 'ComfyUI · ' + String(job.comfyStatus || 'starting'));
    } else if (job.status === 'completed') {
      reportConsoleInfo(generationConsoleLabel(sceneId), 'Take generation completed.');
    }
  }

  function pollGeneration(storyId, sceneId, jobId) {
    window.setTimeout(function () {
      generationRequest(null, 'job=' + encodeURIComponent(jobId)).then(function (payload) {
        var job = payload.job;
        var previousJob = storyState.generationJobs[sceneId] || null;
        storyState.generationJobs[sceneId] = job;
        syncGenerationButton(sceneId, job);
        reportGenerationStatus(sceneId, job, previousJob);
        if (job.status === 'queued' || job.status === 'running') {
          pollGeneration(storyId, sceneId, jobId);
          return;
        }
        if (job.status === 'failed') {
          throw new Error(job.error || 'Storyboard generation failed.');
        }
        if (job.status === 'completed') {
          if (!storyState.story || storyState.story.id !== storyId) {
            return refreshLibrary();
          }
          return flushPendingSaves().then(function () {
            return request(null, 'story=' + encodeURIComponent(storyId));
          }).then(function (storyPayload) {
            storyState.story = storyPayload.story;
            renderStory();
            setSaveState('Saved');
          });
        }
        throw new Error('Storyboard generation returned unknown status: ' + String(job.status || 'empty'));
      }).catch(reportError);
    }, 2000);
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
      var previousJob = storyState.generationJobs[sceneId] || null;
      storyState.generationJobs[sceneId] = payload.job;
      syncGenerationButton(sceneId, payload.job);
      reportGenerationStatus(sceneId, payload.job, previousJob);
      setSaveState('Saved');
      pollGeneration(storyState.story.id, sceneId, payload.job.jobId);
    }).catch(function (err) {
      syncGenerationButton(sceneId, null);
      reportError(err);
    });
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
    var frame = el('app-frame');
    var workspace = el('storyboard-workspace');
    if (!frame || !workspace) throw new Error('Storyboard workspace markup is missing.');
    if (typeof window.closeTestBenchActivity === 'function') window.closeTestBenchActivity();
    frame.classList.add('workspace-storyboard-open');
    workspace.classList.remove('hidden');
    if (typeof window.syncApplicationShellContext === 'function') window.syncApplicationShellContext();
    if (typeof window.syncShellLocationRoute === 'function') window.syncShellLocationRoute();
    refreshDirector();
    refreshGenerationCapabilities();
    refreshLibrary().then(function () {
      if (storyState.story) {
        renderStory();
        return;
      }
      var first = storyState.stories && storyState.stories[0];
      if (first) openStory(first.id);
      else renderStory();
    }).catch(reportError);
  }

  function bindUi() {
    var workspace = el('storyboard-workspace');
    if (!workspace) throw new Error('Storyboard workspace markup is missing.');

    el('storyboard-new-btn').onclick = createStory;
    el('storyboard-expand-concept-btn').onclick = expandConcept;
    el('storyboard-restore-concept-btn').onclick = restorePreviousConcept;
    el('storyboard-develop-btn').onclick = developStory;
    el('storyboard-add-scene-btn').onclick = addScene;
    el('storyboard-director-model').addEventListener('change', function () {
      storyState.director.modelId = this.value;
      window.localStorage.setItem('webcap.storyboard.directorModel', this.value);
    });

    el('storyboard-sequence-preview').addEventListener('click', function (event) {
      if (event.target.closest('[data-sequence-export]')) exportSelectedSequence();
    });

    el('storyboard-library-list').onclick = function (event) {
      var row = event.target.closest('[data-story-id]');
      if (row) openStory(row.dataset.storyId);
    };

    ['storyboard-story-title', 'storyboard-story-concept', 'storyboard-story-style', 'storyboard-story-tags'].forEach(function (id) {
      el(id).addEventListener('input', scheduleStorySave);
    });
    ['storyboard-story-status', 'storyboard-story-pinned'].forEach(function (id) {
      el(id).addEventListener('change', scheduleStorySave);
    });

    el('storyboard-scenes-list').addEventListener('input', function (event) {
      var loraFilter = event.target.closest('[data-scene-lora-filter]');
      if (loraFilter) {
        var filterScene = loraFilter.closest('.storyboard-scene[data-scene-id]');
        if (!filterScene) throw new Error('LoRA filter Scene is missing.');
        Array.prototype.forEach.call(filterScene.querySelectorAll('[data-scene-lora-name]'), function (select) {
          var selected = select.value;
          select.innerHTML = loraOptions(selected, loraFilter.value);
          select.value = selected;
        });
        return;
      }
      var loraRow = event.target.closest('[data-scene-lora-row]');
      if (loraRow) {
        var loraScene = loraRow.closest('.storyboard-scene[data-scene-id]');
        if (!loraScene) throw new Error('LoRA Scene is missing.');
        scheduleSceneSave(loraScene.dataset.sceneId);
        return;
      }
      handleSceneInput(event);
    });
    el('storyboard-scenes-list').addEventListener('change', function (event) {
      var loraRow = event.target.closest('[data-scene-lora-row]');
      if (loraRow) {
        var loraScene = loraRow.closest('.storyboard-scene[data-scene-id]');
        if (!loraScene) throw new Error('LoRA Scene is missing.');
        scheduleSceneSave(loraScene.dataset.sceneId);
        return;
      }
      var upload = event.target.closest('[data-take-upload]');
      if (upload) {
        var uploadScene = upload.closest('.storyboard-scene[data-scene-id]');
        if (!uploadScene) throw new Error('Take upload Scene is missing.');
        uploadTake(uploadScene.dataset.sceneId, upload.files && upload.files[0]);
        return;
      }
      var rating = event.target.closest('[data-take-rating]');
      if (rating) {
        var ratingScene = rating.closest('.storyboard-scene[data-scene-id]');
        if (!ratingScene) throw new Error('Take rating Scene is missing.');
        rateTake(ratingScene.dataset.sceneId, rating.dataset.takeRating, rating.value);
        return;
      }
      handleSceneInput(event);
    });
    el('storyboard-scenes-list').addEventListener('click', function (event) {
      var addLora = event.target.closest('[data-scene-lora-add]');
      if (addLora) {
        var addLoraScene = addLora.closest('.storyboard-scene[data-scene-id]');
        if (!addLoraScene) throw new Error('LoRA Scene is missing.');
        var list = addLoraScene.querySelector('[data-scene-lora-list]');
        if (!list) throw new Error('LoRA list is missing.');
        var filter = addLoraScene.querySelector('[data-scene-lora-filter]');
        list.insertAdjacentHTML('beforeend', loraRowHtml({}, filter ? filter.value : ''));
        scheduleSceneSave(addLoraScene.dataset.sceneId);
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
      var generate = event.target.closest('[data-scene-generate]');
      if (generate) {
        var generateSceneRoot = generate.closest('.storyboard-scene[data-scene-id]');
        if (!generateSceneRoot) throw new Error('Generation Scene is missing.');
        generateScene(generateSceneRoot.dataset.sceneId);
        return;
      }
      var takeAction = event.target.closest('[data-take-action]');
      if (takeAction) {
        var takeScene = takeAction.closest('.storyboard-scene[data-scene-id]');
        if (!takeScene) throw new Error('Take action Scene is missing.');
        if (takeAction.dataset.takeAction === 'select') selectTake(takeScene.dataset.sceneId, takeAction.dataset.takeId);
        else if (takeAction.dataset.takeAction === 'remove') removeTake(takeScene.dataset.sceneId, takeAction.dataset.takeId);
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
