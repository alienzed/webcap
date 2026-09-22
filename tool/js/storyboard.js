(function () {
  'use strict';

  var storyState = {
    stories: [],
    story: null,
    saveTimer: 0,
    sceneTimers: {}
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

  function renderScenes() {
    var host = el('storyboard-scenes-list');
    if (!host || !storyState.story) return;
    var story = storyState.story;
    var order = Array.isArray(story.sceneOrder) ? story.sceneOrder : [];
    var scenes = story.scenes || {};
    if (!order.length) {
      host.innerHTML = '<div class="storyboard-library-empty">No Scenes yet. Add the first generatable scene.</div>';
      return;
    }

    host.innerHTML = order.map(function (sceneId, index) {
      var scene = scenes[sceneId] || {};
      var seedMode = sceneValue(scene, 'seedMode', 'random');
      var seed = sceneValue(scene, 'seed', '');
      return '<section class="storyboard-scene" data-scene-id="' + escapeHtml(sceneId) + '">' +
        '<header class="storyboard-scene-header">' +
          '<span class="storyboard-scene-number">Scene ' + String(index + 1).padStart(2, '0') + '</span>' +
          '<input class="storyboard-scene-title" data-scene-field="title" value="' + escapeHtml(sceneValue(scene, 'title', '')) + '" placeholder="Scene title">' +
          '<div class="storyboard-scene-actions">' +
            '<button type="button" class="review-captions-btn" data-scene-action="up" title="Move Scene up" ' + (index === 0 ? 'disabled' : '') + '>↑</button>' +
            '<button type="button" class="review-captions-btn" data-scene-action="down" title="Move Scene down" ' + (index === order.length - 1 ? 'disabled' : '') + '>↓</button>' +
            '<button type="button" class="review-captions-btn" data-scene-action="duplicate" title="Duplicate Scene">Duplicate</button>' +
            '<button type="button" class="review-captions-btn" data-scene-action="delete" title="Delete Scene">Delete</button>' +
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
            '<label class="storyboard-field"><span>Seed</span><input type="number" min="0" step="1" data-scene-field="seed" value="' + escapeHtml(seed) + '" placeholder="Set when fixed"></label>' +
            '<label class="storyboard-inline-check"><input type="checkbox" data-scene-field="wildcardsEnabled"' + (scene.wildcardsEnabled ? ' checked' : '') + '> Wildcards intended</label>' +
            '<div class="storyboard-planned"><strong>Planned integrations</strong><br>LoRA chain · image/reference inputs · generated Takes. Phase 1 keeps these provider-independent and manual.</div>' +
          '</div>' +
        '</div>' +
      '</section>';
    }).join('');
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
    el('storyboard-story-tags').value = storyTagsText(storyState.story);
    el('storyboard-story-status').value = storyState.story.status || 'active';
    el('storyboard-story-pinned').checked = !!storyState.story.pinned;
    renderScenes();
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
    return request(null, 'story=' + encodeURIComponent(storyId)).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
    }).catch(reportError);
  }

  function createStory() {
    return request({
      operation: 'create_story',
      story: { title: 'Untitled Story', concept: '', tags: [], status: 'active', pinned: false }
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

  function addScene() {
    if (!storyState.story) return;
    setSaveState('Saving...');
    request({
      operation: 'add_scene',
      storyId: storyState.story.id,
      scene: { title: 'New Scene', durationSeconds: 6, seedMode: 'random' }
    }).then(function (payload) {
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
    request({
      operation: 'reorder_scenes',
      storyId: storyState.story.id,
      sceneOrder: order
    }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
    }).catch(reportError);
  }

  function duplicateScene(sceneId) {
    setSaveState('Saving...');
    request({
      operation: 'duplicate_scene',
      storyId: storyState.story.id,
      sceneId: sceneId
    }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
      refreshLibrary();
    }).catch(reportError);
  }

  function deleteScene(sceneId) {
    var scene = storyState.story && storyState.story.scenes ? storyState.story.scenes[sceneId] : null;
    var label = scene && scene.title ? scene.title : 'this Scene';
    if (!window.confirm('Delete "' + label + '" from this Story? Existing take files, if any, are left on disk.')) return;
    setSaveState('Saving...');
    request({
      operation: 'delete_scene',
      storyId: storyState.story.id,
      sceneId: sceneId
    }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
      refreshLibrary();
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

    ['storyboard-story-title', 'storyboard-story-concept', 'storyboard-story-tags'].forEach(function (id) {
      el(id).addEventListener('input', scheduleStorySave);
    });
    ['storyboard-story-status', 'storyboard-story-pinned'].forEach(function (id) {
      el(id).addEventListener('change', scheduleStorySave);
    });

    el('storyboard-scenes-list').addEventListener('input', handleSceneInput);
    el('storyboard-scenes-list').addEventListener('change', handleSceneInput);
    el('storyboard-scenes-list').addEventListener('click', handleSceneAction);
  }

  window.openStoryboardActivity = openStoryboardActivity;
  window.closeStoryboardActivity = closeStoryboardActivity;
  bindUi();
})();
