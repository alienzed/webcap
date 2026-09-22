(function () {
  'use strict';

  var storyState = {
    stories: [],
    story: null,
    saveTimer: 0,
    sceneTimers: {},
    generationJobs: {}
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

  function renderSequencePreview() {
    var host = el('storyboard-sequence-preview');
    if (!host || !storyState.story) return;
    var story = storyState.story;
    var selected = [];
    (story.sceneOrder || []).forEach(function (sceneId, index) {
      var scene = (story.scenes || {})[sceneId] || {};
      var takeId = scene.selectedTakeId;
      var take = takeId && scene.takes ? scene.takes[takeId] : null;
      if (!take) return;
      selected.push({ sceneId: sceneId, scene: scene, take: take, number: index + 1 });
    });
    if (!selected.length) {
      host.innerHTML = '';
      host.classList.add('hidden');
      return;
    }
    host.classList.remove('hidden');
    host.innerHTML = '<header class="storyboard-sequence-header"><div><strong>Selected sequence</strong><span>' +
      selected.length + ' selected Take' + (selected.length === 1 ? '' : 's') +
      '</span></div></header><div class="storyboard-sequence-list">' +
      selected.map(function (item) {
        return '<article class="storyboard-sequence-card">' +
          '<div class="storyboard-sequence-label">Scene ' + String(item.number).padStart(2, '0') + ' · ' +
            escapeHtml(item.scene.title || 'Untitled Scene') + '</div>' +
          '<div class="storyboard-sequence-media">' + takePreviewHtml(story.id, item.sceneId, item.take) + '</div>' +
        '</article>';
      }).join('') + '</div>';
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
      var takes = scene.takes && typeof scene.takes === 'object' ? scene.takes : {};
      var removedTakes = scene.removedTakes && typeof scene.removedTakes === 'object' ? scene.removedTakes : {};
      var takeOrder = Array.isArray(scene.takeOrder) ? scene.takeOrder : [];
      var previousSceneId = index > 0 ? order[index - 1] : '';
      var previousScene = previousSceneId ? scenes[previousSceneId] || {} : {};
      var previousSelectedTakeId = previousScene.selectedTakeId || '';
      var firstFrameReference = referenceForRole(scene, 'first_frame');
      var generationJob = storyState.generationJobs[sceneId] || null;
      var generationRunning = generationJob && generationJob.status === 'running';
      var generationStatus = '';
      if (generationJob) {
        if (generationJob.status === 'running') {
          generationStatus = 'ComfyUI · ' + escapeHtml(generationJob.comfyStatus || 'starting');
        } else if (generationJob.status === 'failed') {
          generationStatus = 'Failed · ' + escapeHtml(generationJob.error || 'Generation failed');
        } else if (generationJob.status === 'completed') {
          generationStatus = 'Completed';
        }
      }
      var referencesHtml = (Array.isArray(scene.references) ? scene.references : []).map(function (reference) {
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
            '<strong>Take ' + String(takeIndex + 1).padStart(2, '0') + '</strong>' +
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
            '<button type="button" class="review-captions-btn" data-scene-action="up" title="Move Scene up" ' + (index === 0 ? 'disabled' : '') + '>↑</button>' +
            '<button type="button" class="review-captions-btn" data-scene-action="down" title="Move Scene down" ' + (index === order.length - 1 ? 'disabled' : '') + '>↓</button>' +
            '<button type="button" class="review-captions-btn" data-scene-action="duplicate" title="Duplicate Scene">Duplicate</button>' +
            '<button type="button" class="review-captions-btn" data-scene-action="delete" title="Remove Scene">Remove</button>' +
          '</div>' +
        '</header>' +
        '<div class="storyboard-scene-body">' +
          '<div class="storyboard-scene-main">' +
            '<label class="storyboard-field"><span>Summary / intent</span><textarea data-scene-field="summary" rows="2" placeholder="What happens in this scene?">' + escapeHtml(sceneValue(scene, 'summary', '')) + '</textarea></label>' +
            '<label class="storyboard-field"><span>Generation prompt</span><textarea data-scene-field="prompt" rows="7" placeholder="Paste or write the full model-facing prompt here.">' + escapeHtml(sceneValue(scene, 'prompt', '')) + '</textarea></label>' +
            '<label class="storyboard-field"><span>Notes</span><textarea data-scene-field="notes" rows="2" placeholder="Continuity reminders, corrections, ideas...">' + escapeHtml(sceneValue(scene, 'notes', '')) + '</textarea></label>' +
          '</div>' +
          '<div class="storyboard-scene-meta">' +
            '<div class="storyboard-scene-meta-row">' +
              '<label class="storyboard-field"><span>Duration (s)</span><input type="number" min="0.1" step="0.1" data-scene-field="durationSeconds" value="' + escapeHtml(sceneValue(scene, 'durationSeconds', 6)) + '"></label>' +
              '<label class="storyboard-field"><span>Seed mode</span><select data-scene-field="seedMode"><option value="random"' + (seedMode === 'random' ? ' selected' : '') + '>Random</option><option value="fixed"' + (seedMode === 'fixed' ? ' selected' : '') + '>Fixed</option></select></label>' +
            '</div>' +
            '<div class="storyboard-scene-meta-row">' +
              '<label class="storyboard-field"><span>Aspect ratio</span><select data-scene-field="aspectRatio">' +
                ['1:1 (Square)', '2:3 (Portrait Photo)', '3:2 (Photo)', '3:4 (Portrait Standard)', '4:3 (Standard)', '9:16 (Portrait Widescreen)', '16:9 (Widescreen)', '21:9 (Ultrawide)'].map(function (value) {
                  return '<option value="' + escapeHtml(value) + '"' + (sceneValue(scene, 'aspectRatio', '4:3 (Standard)') === value ? ' selected' : '') + '>' + escapeHtml(value) + '</option>';
                }).join('') +
              '</select></label>' +
              '<label class="storyboard-field"><span>Megapixels</span><input type="number" min="0.05" step="0.05" data-scene-field="megapixels" value="' + escapeHtml(sceneValue(scene, 'megapixels', 0.2)) + '"></label>' +
            '</div>' +
            '<label class="storyboard-field"><span>Seed</span><input type="number" min="0" step="1" data-scene-field="seed" value="' + escapeHtml(seed) + '" placeholder="Set when fixed"></label>' +
            '<label class="storyboard-inline-check"><input type="checkbox" data-scene-field="wildcardsEnabled"' + (scene.wildcardsEnabled ? ' checked' : '') + '> Wildcards intended</label>' +
            '<div class="storyboard-reference-panel">' +
              '<strong>References</strong>' +
              (referencesHtml ? '<div class="storyboard-reference-chips">' + referencesHtml + '</div>' : '<span class="storyboard-reference-empty">No references assigned.</span>') +
              (previousSelectedTakeId
                ? '<button type="button" class="review-captions-btn storyboard-reference-quick" data-reference-previous>Previous selected Take → first frame</button>'
                : (index > 0 ? '<span class="storyboard-reference-empty">Select a Take in the previous Scene for quick continuity.</span>' : '')) +
              '<div class="storyboard-reference-editor">' +
                '<select data-reference-role><option value="first_frame">First frame</option><option value="last_frame">Last frame</option><option value="guide_frame">Guide frame</option></select>' +
                '<select data-reference-source>' + activeTakeOptions(story, firstFrameReference && firstFrameReference.sourceTakeId) + '</select>' +
                '<select data-reference-frame><option value="last">Last frame</option><option value="first">First frame</option></select>' +
                '<button type="button" class="review-captions-btn" data-reference-apply>Assign</button>' +
              '</div>' +
            '</div>' +
            '<div class="storyboard-generate-panel">' +
              '<button type="button" class="storyboard-primary-btn storyboard-generate-btn" data-scene-generate' + (generationRunning ? ' disabled' : '') + '>' +
                (generationRunning ? 'Generating…' : 'Generate Take') +
              '</button>' +
              '<span class="storyboard-generation-status">' + generationStatus + '</span>' +
            '</div>' +
          '</div>' +
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
    renderScenes();
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
      renderStory();
      setSaveState('Saved');
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
    return request({
      operation: 'update_story',
      storyId: storyState.story.id,
      story: storyPayloadFromUi()
    }).then(function (payload) {
      storyState.story = payload.story;
      setSaveState('Saved');
      return refreshLibrary();
    }).catch(reportError);
  }

  function scheduleStorySave() {
    if (storyState.saveTimer) clearTimeout(storyState.saveTimer);
    setSaveState('Unsaved changes');
    storyState.saveTimer = setTimeout(function () {
      storyState.saveTimer = 0;
      saveStoryNow();
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
    return {
      title: field('title').value,
      summary: field('summary').value,
      prompt: field('prompt').value,
      notes: field('notes').value,
      durationSeconds: field('durationSeconds').value,
      aspectRatio: field('aspectRatio').value,
      megapixels: field('megapixels').value,
      seedMode: field('seedMode').value,
      seed: seedNode.value === '' ? null : seedNode.value,
      wildcardsEnabled: field('wildcardsEnabled').checked
    };
  }

  function saveSceneNow(sceneId) {
    if (!storyState.story) return Promise.resolve();
    setSaveState('Saving...');
    return request({
      operation: 'update_scene',
      storyId: storyState.story.id,
      sceneId: sceneId,
      scene: scenePayloadFromUi(sceneId)
    }).then(function (payload) {
      storyState.story = payload.story;
      setSaveState('Saved');
      return refreshLibrary();
    }).catch(reportError);
  }

  function scheduleSceneSave(sceneId) {
    if (storyState.sceneTimers[sceneId]) clearTimeout(storyState.sceneTimers[sceneId]);
    setSaveState('Unsaved changes');
    storyState.sceneTimers[sceneId] = setTimeout(function () {
      delete storyState.sceneTimers[sceneId];
      saveSceneNow(sceneId);
    }, 450);
  }

  function flushPendingSaves() {
    var chain = Promise.resolve();
    if (storyState.saveTimer) {
      clearTimeout(storyState.saveTimer);
      storyState.saveTimer = 0;
      chain = chain.then(saveStoryNow);
    }
    Object.keys(storyState.sceneTimers).forEach(function (sceneId) {
      clearTimeout(storyState.sceneTimers[sceneId]);
      delete storyState.sceneTimers[sceneId];
      chain = chain.then(function () { return saveSceneNow(sceneId); });
    });
    return chain;
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

  function pollGeneration(storyId, sceneId, jobId) {
    window.setTimeout(function () {
      generationRequest(null, 'job=' + encodeURIComponent(jobId)).then(function (payload) {
        var job = payload.job;
        storyState.generationJobs[sceneId] = job;
        if (job.status === 'running') {
          pollGeneration(storyId, sceneId, jobId);
          return;
        }
        if (job.status === 'failed') {
          if (storyState.story && storyState.story.id === storyId) renderScenes();
          throw new Error(job.error || 'Storyboard generation failed.');
        }
        if (job.status === 'completed') {
          if (!storyState.story || storyState.story.id !== storyId) {
            return refreshLibrary();
          }
          return request(null, 'story=' + encodeURIComponent(storyId)).then(function (storyPayload) {
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
      storyState.generationJobs[sceneId] = payload.job;
      renderScenes();
      setSaveState('Saved');
      pollGeneration(storyState.story.id, sceneId, payload.job.jobId);
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
    var frame = el('app-frame');
    var workspace = el('storyboard-workspace');
    if (!frame || !workspace) throw new Error('Storyboard workspace markup is missing.');
    if (typeof window.closeTestBenchActivity === 'function') window.closeTestBenchActivity();
    frame.classList.add('workspace-storyboard-open');
    workspace.classList.remove('hidden');
    if (typeof window.syncApplicationShellContext === 'function') window.syncApplicationShellContext();
    if (typeof window.syncShellLocationRoute === 'function') window.syncShellLocationRoute();
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
    el('storyboard-add-scene-btn').onclick = addScene;

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

    el('storyboard-scenes-list').addEventListener('input', handleSceneInput);
    el('storyboard-scenes-list').addEventListener('change', function (event) {
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
