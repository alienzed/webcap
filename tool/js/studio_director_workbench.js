(function () {
  'use strict';
  var readStory = null, writeStory = null, projects = [], proposedScene = null, proposedStructure = null, proposedBatch = null, proposedSplit = null, proposedInvariantLinks = null, playbookExpected = null;
  var readiness = [], recommendations = {readHints:[],writeHint:'',writeFields:[],sceneId:''};
  var readinessStale = false;
  var readChoices = {}, writeOperationChosen = false, writeFieldsManuallyChanged = false, lastReadSource = null;
  var lastQuickAction = 'read', creativeCapture = null;
  var sceneFields = ['summary', 'prompt', 'title'];
  var projectFields = ['title', 'concept', 'style', 'invariants'];
  var labels = {title:'Title', concept:'Concept', style:'Visual / atmosphere',
    invariants:'Invariants', invariant:'Invariant', scene:'New Scene', summary:'Intent', prompt:'H3 Prompt',
    references:'Reference frames', durationSeconds:'Duration',
    generationSettings:'Generation settings'};
  function el(id) { return document.getElementById(id); }
  function api(url, options) {
    return fetch(url, options || {}).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body || !body.ok) throw new Error((body && body.error) || 'Studio request failed.');
        return body;
      });
    });
  }
  function status(message, error) {
    var node = el('studio-dw-status');
    if (node) {
      node.textContent = message || '';
      node.dataset.error = error ? 'true' : 'false';
      node.classList.toggle('hidden', !message);
    }
    if (error && typeof window.reportConsoleError === 'function')
      window.reportConsoleError('Studio Director workbench', new Error(message));
  }
  function option(select, id, name) {
    var node = document.createElement('option');
    node.value = id; node.textContent = name; select.appendChild(node);
  }
  function activeTarget() {
    var route = typeof window.getStoryboardRouteTarget === 'function' ? window.getStoryboardRouteTarget() : null;
    return route || {};
  }
  function storyName(story) { return String(story.title || story.name || story.id || 'Untitled Project'); }
  function refreshProjects() {
    return api('/fs/storyboard').then(function (response) {
      projects = response.stories || [];
      if (!Array.isArray(projects)) throw new Error('Project listing is invalid.');
      var preferredRead = (readStory && readStory.id) || activeTarget().storyId ||
        window.studioDirectorBridge.workingStoryId() || '';
      var preferredWrite = window.studioDirectorBridge.workingStoryId() || activeTarget().storyId || '';
      [['studio-dw-read-project', preferredRead], ['studio-dw-write-project', preferredWrite]]
        .forEach(function (item) {
          var select = el(item[0]), original = select.value;
          select.replaceChildren();
          option(select, '', 'Choose Project…');
          projects.forEach(function (p) { option(select, p.id, storyName(p)); });
          if (projects.some(function (p) { return p.id === original; })) select.value = original;
          else if (projects.some(function (p) { return p.id === item[1]; })) select.value = item[1];
        });
      return projects;
    });
  }
  function loadStory(id) {
    if (!id) return Promise.resolve(null);
    return api('/fs/storyboard?story=' + encodeURIComponent(id)).then(function (body) {
      if (!body.story || body.story.id !== id) throw new Error('Project selection no longer matches saved data.');
      return body.story;
    });
  }
  function fieldCheckbox(path, label, checked) {
    var row = document.createElement('label'), check = document.createElement('input');
    check.type = 'checkbox';check.dataset.path = path;check.checked = !!checked;
    row.append(check, document.createTextNode(label));
    return row;
  }
  function renderReadStory(story) {
    readStory = story;
    var fields = el('studio-dw-project-fields'), scenes = el('studio-dw-scene-fields');
    fields.replaceChildren(); scenes.replaceChildren();
    if (!story) { updateReadSelection(); return; }
    var chosen = readChoices[story.id], firstSelection = !chosen;
    if (firstSelection) chosen = new Set();
    function addField(path, label, suggested, host) {
      if (firstSelection && suggested) chosen.add(path);
      var row = fieldCheckbox(path, label, chosen.has(path));
      row.querySelector('input').onchange = function () {
        if (this.checked) chosen.add(path);
        else chosen.delete(path);
        updateReadSelection();
      };
      host.appendChild(row);
    }
    function addGroup(label, paths, host) {
      if (!paths.length) return;
      var row = document.createElement('label'), toggle = document.createElement('input');
      toggle.type = 'checkbox'; toggle.dataset.groupSelect = 'true';
      toggle.groupPaths = paths;
      row.append(toggle, document.createTextNode(label));
      toggle.onchange = function () {
        paths.forEach(function (path) {if (toggle.checked) chosen.add(path); else chosen.delete(path);});
        Array.from(el('studio-dw-read-panel').querySelectorAll('input[data-path]')).forEach(function (node) {
          node.checked = chosen.has(node.dataset.path);
        });
        updateReadSelection();
      };
      host.appendChild(row);
    }
    addGroup('Entire Project brief', projectFields.map(function (key) {return 'project.' + key;}), fields);
    projectFields.forEach(function (key) {
      var path = 'project.' + key;
      addField(path, labels[key], recommendations.readHints.length
        ? recommendations.readHints.indexOf(path) !== -1
        : key !== 'title' && !!story[key], fields);
    });
    var sceneOrder = story.sceneOrder || [];
    addGroup('All Scene overviews (without H3 prompts)', sceneOrder.reduce(function (paths, id) {
      ['title', 'summary', 'durationSeconds'].forEach(function (field) {
        paths.push('scene:' + id + ':' + field);
      });
      return paths;
    }, []), scenes);
    sceneOrder.forEach(function (id, index) {
      var scene = story.scenes && story.scenes[id];
      if (!scene) throw new Error('Project has a Scene index with no matching Scene.');
      var details = document.createElement('details'), heading = document.createElement('summary');
      heading.textContent = 'Scene ' + (index + 1) + ' · ' + (scene.title || 'Untitled');
      details.appendChild(heading);
      var sceneFields = ['title', 'summary', 'prompt', 'durationSeconds'];
      addGroup('Entire Scene', sceneFields.map(function (field) {
        return 'scene:' + id + ':' + field;
      }), details);
      sceneFields.forEach(function (field) {
        var path = 'scene:' + id + ':' + field;
        var current = id === (recommendations.sceneId || activeTarget().sceneId);
        var suggested = recommendations.readHints.indexOf(path) !== -1 ||
          (current && recommendations.readHints.indexOf('scene.current.' + field) !== -1) ||
          (!recommendations.readHints.length && current &&
           (field === 'summary' || field === 'prompt') && !!scene[field]);
        addField(path, labels[field], suggested, details);
        if (chosen.has(path)) details.open = true;
      });
      scenes.appendChild(details);
    });
    readChoices[story.id] = chosen;
    updateReadSelection();
  }
  function selectedPaths() {
    return Array.from(el('studio-dw-read-panel').querySelectorAll('input[data-path]:checked'))
      .map(function (node) { return node.dataset.path; });
  }
  function readPayload(story, keys) {
    return {
      projectId: story.id, projectTitle: storyName(story), savedAt: story.updatedAt,
      fields: keys.map(function (key) {
        var parts = key.split(':'), value;
        if (key.indexOf('project.') === 0) {
          var field = key.slice(8);
          if (projectFields.indexOf(field) === -1) throw new Error('Unknown Project field: ' + field);
          value = story[field];
        } else {
          if (parts.length !== 3 || parts[0] !== 'scene' ||
              ['title','summary','prompt','durationSeconds'].indexOf(parts[2]) === -1 ||
              !story.scenes || !story.scenes[parts[1]] ||
              (story.sceneOrder || []).indexOf(parts[1]) === -1)
            throw new Error('Selected Scene field is not in this Project: ' + key);
          value = story.scenes[parts[1]][parts[2]];
        }
        return {id:key, value:value === undefined ? null : value};
      })
    };
  }
  function updateReadSelection() {
    var keys = selectedPaths();
    Array.from(el('studio-dw-read-panel').querySelectorAll('input[data-group-select]')).forEach(function (toggle) {
      var chosenCount = toggle.groupPaths.filter(function (key) {return keys.indexOf(key) !== -1;}).length;
      toggle.checked = chosenCount === toggle.groupPaths.length;
      toggle.indeterminate = chosenCount > 0 && chosenCount < toggle.groupPaths.length;
    });
    var bytes = readStory ? JSON.stringify(readPayload(readStory, keys)).length : 0;
    el('studio-dw-read-count').textContent = keys.length +
      (keys.length === 1 ? ' field' : ' fields') + ' · ' + bytes.toLocaleString() + ' characters';
    el('studio-dw-read-send').disabled = !keys.length || !el('studio-dw-read-project').value;
    var name = readStory ? storyName(readStory) : 'No Project selected';
    el('studio-dw-read-scope').textContent = 'Read source: ' + name + '. Not an automatic attachment.';
    var details = el('studio-dw-read-preview');
    if (details.open && readStory) el('studio-dw-read-preview-data').textContent =
      JSON.stringify(readPayload(readStory, keys), null, 2);
  }
  function readSend() {
    var id = el('studio-dw-read-project').value, keys = selectedPaths();
    if (!id || !keys.length) { status('Choose a Project and at least one field.', true); return; }
    if (!window.studioDirectorBridge.isReady()) { status('Open Director and choose a model first.', true); return; }
    el('studio-dw-read-send').disabled = true;
    // Same exact serializer drives the inspector and the outbound LLM message.
    loadStory(id).then(function (story) {
      var payload = readPayload(story, keys);
      var length = JSON.stringify(payload).length;
      if (length > 48000) throw new Error('Selected Read is ' + length.toLocaleString() +
        ' characters. Narrow the selection to a Project overview or fewer full Scene Prompts.');
      el('studio-dw-read-preview-data').textContent = JSON.stringify(payload, null, 2);
      window.studioDirectorBridge.sendRead(payload, keys);
      lastReadSource = story.id;
      status('Selected fields sent. Awaiting Director’s own acknowledgment.', false);
      el('studio-dw-read-panel').classList.add('hidden');
      el('studio-dw-read').setAttribute('aria-expanded', 'false');
      updateScope();
      if (el('director-chat-drawer').classList.contains('studio-actions-open'))
        el('studio-dw-close-actions').click();
    }).catch(function (error) { status('Read failed: ' + String(error.message || error), true); })
      .finally(function () { updateReadSelection(); });
  }
  function showWriteContext() {
    var operation=el('studio-dw-write-operation').value, text='';
    if (operation==='new-project') {
      text='Conversation only. No saved Project fields are included.';
    } else if (operation==='playbook') {
      text='The saved H3 Playbook and current conversation are used. The complete saved Playbook appears in the editable review.';
    } else if (!writeStory) {
      text='Select a Project to inspect the content Director will use.';
    } else {
      var p=writeStory;
      var data={projectId:p.id,title:p.title,concept:p.concept,style:p.style,invariants:p.invariants};
      if (operation==='scene' || operation==='scenes') {
        data.currentScenes=(p.sceneOrder||[]).map(function (id,index) {
          var scene=p.scenes[id];
          return {id:id,position:index+1,title:scene.title,intent:scene.summary};
        });
      }
      if (operation==='scene-edit') {
        var id=el('studio-dw-write-scene').value, scene=p.scenes&&p.scenes[id];
        if (scene) data.selectedScene={id:id,title:scene.title,intent:scene.summary,prompt:scene.prompt,
          durationSeconds:scene.durationSeconds,invariantRefs:scene.invariantRefs};
      }
      if (operation==='scene-move' || operation==='scene-duplicate') {
        var sourceId=el('studio-dw-write-scene').value;
        data.sceneOrder=(p.sceneOrder||[]).map(function (id, index) {
          return {id:id,position:index+1,title:(p.scenes[id]||{}).title};
        });
        data.sourceSceneId=sourceId;
        if (operation==='scene-move') data.destination={
          relativeSceneId:el('studio-dw-move-target').value,
          placement:el('studio-dw-move-placement').value
        };
      }
      text='Current saved snapshot (reloaded before drafting):' +
        String.fromCharCode(10) + JSON.stringify(data,null,2) +
        String.fromCharCode(10) + 'Recent conversation context is also supplied.';
    }
    el('studio-dw-write-context').querySelector('summary').textContent =
      'Inspect saved context for this draft (preview)';
    el('studio-dw-write-context-json').textContent=text;
  }

  function updateScope() {
    var readId = el('studio-dw-read-project').value;
    var writeId = el('studio-dw-write-project').value;
    var op = el('studio-dw-write-operation').value;
    el('studio-dw-write-scope').textContent = op === 'new-project'
      ? 'Creates a new Project. No existing destination.'
      : 'Write destination: ' + (projects.find(function(p){return p.id===writeId;}) || {title:'Choose a Project'}).title +
        (lastReadSource && writeId && lastReadSource !== writeId
          ? ' · Different from last Read source.' : '');
    var mode = !el('studio-dw-read-panel').classList.contains('hidden') ? 'Read' :
      !el('studio-dw-write-panel').classList.contains('hidden') ? 'Write' : '';
    el('studio-dw-heading').textContent = mode ? mode + ' · Director' : 'Director actions';
    el('studio-dw-context').textContent = mode === 'Read'
      ? 'Explicit source · nothing sent until Send'
      : mode === 'Write' ? 'Reviewed destination · nothing saved until Apply'
      : 'Conversation is independent of Studio navigation';
  }
  function setOperation() {
    var operation = el('studio-dw-write-operation').value;
    var structural = operation === 'scene-move' || operation === 'scene-duplicate';
    el('studio-dw-write-scene-row').classList.toggle('hidden', operation !== 'scene-edit' && operation !== 'scene-split' && !structural);
    el('studio-dw-write-fields').classList.toggle('hidden', operation !== 'scene-edit');
    el('studio-dw-batch-controls').classList.toggle('hidden', operation !== 'scenes-batch');
    el('studio-dw-invariant-controls').classList.toggle('hidden', operation !== 'scene-invariants');
    el('studio-dw-move-target-row').classList.toggle('hidden', operation !== 'scene-move');
    el('studio-dw-move-placement-row').classList.toggle('hidden', operation !== 'scene-move');
    el('studio-dw-write-project').disabled = operation === 'new-project' || operation === 'playbook';
    el('studio-dw-write-prepare').textContent =
      operation === 'scene-edit' ? 'Draft Scene revision' :
      structural ? 'Review change' : 'Prepare editable review';
    showWriteContext();
    updateScope();
  }
  function renderWriteStory(story) {
    writeStory = story;
    var select = el('studio-dw-write-scene'), relative = el('studio-dw-move-target');
    var previousSource = select.value, previousRelative = relative.value;
    select.replaceChildren();
    relative.replaceChildren();
    if (!story) { showWriteContext(); return; }
    (story.sceneOrder || []).forEach(function (id, index) {
      var scene = story.scenes && story.scenes[id];
      if (scene) {
        var label = 'Scene ' + (index + 1) + ' · ' + (scene.title || 'Untitled');
        option(select, id, label);
        option(relative, id, label);
      }
    });
    if (previousSource && story.scenes[previousSource]) select.value = previousSource;
    if (previousRelative && story.scenes[previousRelative]) relative.value = previousRelative;
    var batchHost = el('studio-dw-batch-scenes');
    var checked = Array.from(batchHost.querySelectorAll('input:checked')).map(function (input) {return input.value;});
    batchHost.replaceChildren();
    (story.sceneOrder || []).forEach(function (id, index) {
      var label = document.createElement('label'), input = document.createElement('input');
      input.type = 'checkbox'; input.value = id;
      input.checked = checked.length ? checked.indexOf(id) !== -1 : id === (recommendations.sceneId || activeTarget().sceneId);
      label.append(input, document.createTextNode('Scene ' + (index+1) + ' · ' + (story.scenes[id].title || 'Untitled')));
      batchHost.appendChild(label);
    });
    renderInvariantChoices(story);
    var preferredScene = recommendations.sceneId || activeTarget().sceneId;
    if (preferredScene && story.scenes && story.scenes[preferredScene])
      select.value = preferredScene;
    showWriteContext();
    updateScope();
  }
  function recommendedWriteFields(operation) {
    if (readinessStale) return [];
    var allowed = operation === 'project' ? projectFields :
      (operation === 'scene-edit' || operation === 'scenes-batch') ? sceneFields : [];
    return recommendations.writeFields.filter(function (field) { return allowed.indexOf(field) !== -1; });
  }
  function applySuggestedWriteFields() {
    if (writeFieldsManuallyChanged) return;
    var operation = el('studio-dw-write-operation').value;
    if (operation !== 'scene-edit' && operation !== 'scenes-batch') return;
    var hints = recommendedWriteFields(operation);
    if (!hints.length) return;
    var host = el(operation === 'scene-edit' ? 'studio-dw-write-fields' : 'studio-dw-batch-fields');
    Array.from(host.querySelectorAll('input')).forEach(function (check) {
      check.checked = hints.indexOf(check.value) !== -1;
    });
  }
  function refreshRead() {
    return refreshProjects().then(function () {return loadStory(el('studio-dw-read-project').value);})
      .then(renderReadStory).catch(function (e) { status('Read setup failed: ' + e.message, true); });
  }
  function refreshWrite() {
    return refreshProjects().then(function () {return loadStory(el('studio-dw-write-project').value);})
      .then(renderWriteStory).then(function () {
        if (!writeOperationChosen) {
          if (recommendations.writeHint && recommendations.writeHint !== 'playbook')
            el('studio-dw-write-operation').value =
              recommendations.writeHint === 'scene' ? 'scenes' : recommendations.writeHint;
          else if (!projects.length) el('studio-dw-write-operation').value = 'new-project';
        }
        setOperation();
        applySuggestedWriteFields();
      })
      .catch(function (e) { status('Write setup failed: ' + e.message, true); });
  }
  function toggle(which) {
    var other = which === 'read' ? 'write' : 'read', panel = el('studio-dw-' + which + '-panel'),
      button = el('studio-dw-' + which), show = panel.classList.contains('hidden');
    if (show && which === 'write') writeFieldsManuallyChanged = false;
    panel.classList.toggle('hidden', !show);
    button.setAttribute('aria-expanded', show ? 'true' : 'false');
    el('studio-dw-' + other + '-panel').classList.add('hidden');
    el('studio-dw-' + other).setAttribute('aria-expanded', 'false');
    el('studio-dw-quick-' + which).setAttribute('aria-expanded', show ? 'true' : 'false');
    el('studio-dw-quick-' + other).setAttribute('aria-expanded', 'false');
    updateScope();
    if (show) (which === 'read' ? refreshRead() : refreshWrite());
  }
  function parseProposal(raw) {
    var text = String(raw || '').trim();
    if (text.slice(0,3) === '```') text = text.replace(/^\`\`\`(?:json)?/i,'').replace(/\`\`\`$/,'').trim();
    var object = JSON.parse(text);
    if (!object || typeof object !== 'object' || Array.isArray(object)) throw new Error('Director returned an invalid Scene revision.');
    return object;
  }
  function editScene(story, sceneId, fields) {
    var scene = story.scenes && story.scenes[sceneId];
    if (!scene) throw new Error('Select an existing Scene.');
    status('Director is drafting a scoped revision…', false);
    var history = window.studioDirectorBridge.messages().slice(-18).map(function (m) {
      return {role:m.role, text:String(m.content || '').slice(0,3200)};
    });
    var request = [
      'You are Studio Director. Propose a scoped Scene revision based on the creative discussion.',
      'Return ONLY a JSON object with exactly the selected keys: ' + fields.join(', ') + '.',
      'Preserve the author\'s vision, subject identity, and previously approved details.',
      'If no change is warranted, preserve the original field value. Produce complete usable values.',
      'Project context (for drafting only; do not save it): ' + JSON.stringify({
        id:story.id,concept:story.concept,style:story.style,invariants:story.invariants
      }),
      'Selected Scene: ' + JSON.stringify({id:sceneId, title:scene.title,summary:scene.summary,prompt:scene.prompt,
        durationSeconds:scene.durationSeconds,invariantRefs:scene.invariantRefs}),
      'Recent conversation: ' + JSON.stringify(history),
      'For H3 Prompt revisions, use the selected Scene durationSeconds for consecutive timed shots spanning that clip and its linked Character/Location Invariants for continuity. Duration and links are context, not editable output fields.',
      'Write a specific useful revision of the selected fields. No markdown.'
    ].join(String.fromCharCode(10));
    return window.studioDirectorBridge.makeProposal(request,'studio_scene_field_draft',fields.indexOf('prompt') !== -1).then(function (text) {
      var candidate = parseProposal(text);
      return showSceneReview(story, sceneId, fields, candidate);
    });
  }
  function showSceneReview(story, sceneId, fields, candidate) {
    var scene = story.scenes && story.scenes[sceneId];
    if (!scene || (story.sceneOrder || []).indexOf(sceneId) === -1)
      throw new Error('Select a saved Scene to review.');
    fields.forEach(function (key) {
      if (['title','summary','prompt'].indexOf(key) === -1 || typeof candidate[key] !== 'string')
        throw new Error('Director did not supply complete ' + key + ' material.');
    });
      proposedScene = {storyId:story.id,sceneId:sceneId,expected:{},fields:fields};
      var host = el('studio-dw-scene-editors');host.replaceChildren();
      fields.forEach(function (key) {
        var old = String(scene[key] || '');
        proposedScene.expected[key] = old;
        var label = document.createElement('label'), hint = document.createElement('small'),
          textarea = document.createElement('textarea');
        label.textContent = labels[key];hint.textContent = 'Saved: ' + (old || '(empty)');
        textarea.dataset.field = key;textarea.value = candidate[key];textarea.rows = key === 'prompt' ? 13 : 5;
        label.append(hint,textarea);host.appendChild(label);
      });
      el('studio-dw-scene-target').textContent = storyName(story) + ' · ' + (scene.title || sceneId);
      el('studio-dw-scene-error').textContent = '';
      el('studio-dw-scene-review').showModal();
      status('Draft is ready for field-by-field editing and Apply.', false);
    return Promise.resolve();
  }

  function reviewCreativeCapture(capture) {
    if (!capture || !capture.content || !['title','concept','style','summary','prompt','invariant','scene'].includes(capture.field))
      throw new Error('No valid authored material is ready for review.');
    if (!window.studioDirectorBridge.canReview())
      throw new Error('Open the Studio conversation before reviewing this change.');
    var projectSelect = el('studio-dw-write-project');
    var id = projectSelect.value || window.studioDirectorBridge.workingStoryId();
    if (!id) {
      status('Choose a destination Project in Write, then review this suggestion.', false);
      openWriteForCapture();
      return;
    }
    if (capture.field === 'scene') {
      window.studioDirectorBridge.reviewSceneCapture(capture,id).catch(function (error) {
        status('Creative Scene creation review failed: ' + String(error.message || error),true);
      });
      return;
    }
    if (['title','concept','style','invariant'].indexOf(capture.field) !== -1) {
      window.studioDirectorBridge.reviewCapture(capture, id).catch(function (e) {
        status('Creative review failed: ' + String(e.message || e), true);
      });
      return;
    }
    if (!capture.sceneId) {
      status('Choose a specific saved Scene before reviewing this suggestion.', true);
      return;
    }
    var sceneTarget = capture.sceneId;
    el('studio-dw-write-prepare').disabled = true;
    Promise.resolve().then(function () {
      return window.flushStudioDirectorStoryEdits(id);
    }).then(function () {return loadStory(id);})
      .then(function (story) {
        var draft = {};
        draft[capture.field] = capture.content;
        return showSceneReview(story, sceneTarget, [capture.field], draft);
      }).catch(function (error) {
        status('Creative Scene review failed: ' + String(error.message || error), true);
      }).finally(function () {el('studio-dw-write-prepare').disabled = false;});
  }
  function openWriteForCapture() {
    el('director-chat-drawer').classList.add('studio-actions-open');
    if (el('studio-dw-write-panel').classList.contains('hidden')) el('studio-dw-write').click();
    refreshWrite();
  }
  function writePrepare() {
    var bridge = window.studioDirectorBridge, operation = el('studio-dw-write-operation').value,
      id = el('studio-dw-write-project').value;
    if (operation === 'scene-invariants') {
      if (!id) {status('Select a Project.',true);return;}
      prepareInvariantLinks(id);
      return;
    }
    if (operation === 'scene-move' || operation === 'scene-duplicate') {
      if (!id) {status('Select a destination Project.', true);return;}
      prepareStructure(operation, id);
      return;
    }
    if (!bridge.isReady()) { status('Open Studio Director and choose a model first.', true);return; }
    if (operation === 'playbook') { preparePlaybook(); return; }
    if (operation !== 'new-project' && !id) { status('Select a destination Project.', true);return; }
    if (operation === 'scene-move' || operation === 'scene-duplicate') {
      prepareStructure(operation, id);
      return;
    }
    if (operation === 'scenes-batch') {
      prepareBatchScenes(id);
      return;
    }
    if (operation === 'scene-split') {
      prepareSplitScene(id);
      return;
    }
    if (operation !== 'scene-edit') {
      try {
        var item = projects.find(function (p) {return p.id === id;});
        bridge.prepareWrite(operation, id, item && storyName(item), recommendedWriteFields(operation));
        status('Preparing a reviewed proposal. No saved fields have changed.', false);
      } catch (e) { status('Write failed: ' + e.message, true); }
      return;
    }
    var sceneId = el('studio-dw-write-scene').value;
    var fields = Array.from(el('studio-dw-write-fields').querySelectorAll('input:checked'))
      .map(function (node) { return node.value; });
    if (!sceneId || !fields.length) { status('Choose a Scene and at least one field.', true);return; }
    el('studio-dw-write-prepare').disabled = true;
    Promise.resolve().then(function () {
      return window.flushStudioDirectorStoryEdits(id);
    }).then(function () {return loadStory(id);})
      .then(function (story) {return editScene(story,sceneId,fields);})
      .catch(function (e) {status('Scene revision failed: ' + String(e.message || e),true);})
      .finally(function () { el('studio-dw-write-prepare').disabled = false; });
  }
  function renderInvariantChoices(story) {
    var select = el('studio-dw-invariant-choice'), previous = select.value;
    select.replaceChildren();
    (story.invariants || []).filter(function (entry) {
      return ['character','location'].indexOf(entry.kind) !== -1 && entry.title;
    }).forEach(function (entry) {
      option(select, JSON.stringify({kind:entry.kind,title:entry.title}),
        (entry.kind === 'character' ? 'Character · ' : 'Location · ') + entry.title);
    });
    if (Array.from(select.options).some(function (entry) {return entry.value === previous;}))
      select.value = previous;
    renderInvariantScenes(story);
  }
  function renderInvariantScenes(story) {
    var host = el('studio-dw-invariant-scenes');
    host.replaceChildren();
    if (!story || !el('studio-dw-invariant-choice').value) {
      host.textContent = 'Define a Character or Location Invariant in the Project first.';
      return;
    }
    var target = JSON.parse(el('studio-dw-invariant-choice').value);
    (story.sceneOrder || []).forEach(function (id,index) {
      var scene = story.scenes[id], row = document.createElement('label'),
        check = document.createElement('input');
      check.type = 'checkbox';
      check.value = id;
      check.checked = (scene.invariantRefs || []).some(function (ref) {
        return ref.kind === target.kind && ref.title.toLowerCase() === target.title.toLowerCase();
      });
      row.append(check, document.createTextNode('Scene ' + (index + 1) + ' · ' + (scene.title || 'Untitled')));
      host.appendChild(row);
    });
  }
  function prepareInvariantLinks(storyId) {
    var choice = el('studio-dw-invariant-choice').value;
    if (!choice) {status('Choose a Character or Location Invariant.',true);return;}
    var target = JSON.parse(choice), host = el('studio-dw-invariant-scenes');
    var selected = new Set(Array.from(host.querySelectorAll('input:checked')).map(function (node) {
      return node.value;
    }));
    var button = el('studio-dw-write-prepare');
    button.disabled = true;
    Promise.resolve().then(function () {
      return window.flushStudioDirectorStoryEdits(storyId);
    }).then(function () {return loadStory(storyId);})
      .then(function (story) {
        var exists = (story.invariants || []).some(function (entry) {
          return entry.kind === target.kind && entry.title.toLowerCase() === target.title.toLowerCase();
        });
        if (!exists) throw new Error('The selected Invariant is no longer in the Project.');
        var changes = (story.sceneOrder || []).reduce(function (items,id) {
          var before = story.scenes[id].invariantRefs || [];
          var currently = before.some(function (ref) {
            return ref.kind === target.kind && ref.title.toLowerCase() === target.title.toLowerCase();
          });
          var linked = selected.has(id);
          if (currently !== linked) items.push({
            sceneId:id,expectedRefs:before,linked:linked
          });
          return items;
        },[]);
        if (!changes.length) {
          status('These Scenes already have the selected Invariant associations.',false);
          return;
        }
        proposedInvariantLinks = {storyId:storyId,kind:target.kind,title:target.title,changes:changes};
        var diff = el('studio-dw-invariant-diff');
        diff.replaceChildren();
        changes.forEach(function (entry) {
          var note = document.createElement('p'), scene = story.scenes[entry.sceneId];
          note.textContent = (entry.linked ? 'Use in: ' : 'Unlink from: ') +
            (scene.title || entry.sceneId) + ' (' + (story.sceneOrder.indexOf(entry.sceneId) + 1) + ')';
          diff.appendChild(note);
        });
        el('studio-dw-invariant-summary').textContent =
          target.kind + ' · ' + target.title + ' · ' + changes.length + ' Scene associations';
        el('studio-dw-invariant-error').textContent = '';
        el('studio-dw-invariant-review').showModal();
      }).catch(function (error) {
        status('Scene association review failed: ' + String(error.message || error),true);
      }).finally(function () {button.disabled=false;});
  }
  function applyInvariantLinks() {
    if (!proposedInvariantLinks) throw new Error('No reviewed Scene associations exist.');
    var proposal = proposedInvariantLinks, button = el('studio-dw-invariant-apply');
    button.disabled = true;
    var applied = false;
    Promise.resolve().then(function () {
      return window.flushStudioDirectorStoryEdits(proposal.storyId);
    }).then(function () {
      return api('/fs/studio/director/scene-invariants', {
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(proposal)
      });
    }).then(function (result) {
      if (!result.story || !result.savedLinksByScene)
        throw new Error('Association Apply returned no authoritative saved links.');
      applied = true;
      proposedInvariantLinks = null;
      el('studio-dw-invariant-review').close();
      return window.studioDirectorBridge.recordApplied('scene.invariant-links',result.story,{
        invariant:{kind:proposal.kind,title:proposal.title},
        scenes:result.savedLinksByScene
      }).then(function () {
        status('Reviewed Scene associations saved.',false);
        if (typeof window.refreshStudioDirectorStoryIfOpen === 'function')
          return window.refreshStudioDirectorStoryIfOpen(result.story.id);
      });
    }).catch(function (error) {
      var message = String(error.message || error);
      el('studio-dw-invariant-error').textContent = applied
        ? 'Scene links saved, but conversation recording or refresh failed: ' + message
        : 'Apply was not confirmed: ' + message;
      status('Scene association Apply: ' + message,true);
    }).finally(function () {button.disabled=false;});
  }
  function prepareSplitScene(storyId) {
    var sceneId = el('studio-dw-write-scene').value, button = el('studio-dw-write-prepare');
    if (!sceneId) {status('Choose the Scene to split.',true);return;}
    button.disabled = true;
    status('Director is developing two independently renderable Scene Intents…',false);
    Promise.resolve().then(function () {
      return window.flushStudioDirectorStoryEdits(storyId);
    }).then(function () {return loadStory(storyId);})
      .then(function (story) {
        var scene = story.scenes && story.scenes[sceneId];
        if (!scene || (story.sceneOrder || []).indexOf(sceneId) < 0)
          throw new Error('Source Scene no longer exists.');
        var recent = window.studioDirectorBridge.messages().slice(-18).map(function (m) {
          return {role:m.role,content:String(m.content || '').slice(0,3200)};
        });
        var request = [
          'Studio Director: split this one overloaded Scene into TWO independently generatable clips.',
          'Return JSON with firstSummary (complete revised Intent for original), secondTitle, secondSummary, rationale.',
          'Do not create a third Scene, rewrite the Prompt or change existing Takes.',
          'Make each event feasible within its own short H3 clip (4-15 seconds); preserve the author\'s vision.',
          'Project: '+JSON.stringify({id:story.id,concept:story.concept,style:story.style,invariants:story.invariants}),
          'Source Scene: '+JSON.stringify({id:sceneId,title:scene.title,summary:scene.summary,prompt:scene.prompt,
            durationSeconds:scene.durationSeconds}),
          'Discussion: '+JSON.stringify(recent)
        ].join('\n');
        return window.studioDirectorBridge.makeProposal(request,'studio_scene_split_draft').then(function (raw) {
          var candidate = parseProposal(raw);
          if (['firstSummary','secondTitle','secondSummary','rationale'].some(function (key) {
            return typeof candidate[key] !== 'string';
          }) || !candidate.firstSummary.trim() || !candidate.secondSummary.trim()) {
            throw new Error('Director did not supply two complete Scene Intents.');
          }
          proposedSplit = {
            storyId:storyId,sceneId:sceneId,expectedSceneOrder:(story.sceneOrder||[]).slice(),
            expectedSummary:scene.summary,firstSummary:candidate.firstSummary,
            secondScene:{title:candidate.secondTitle,summary:candidate.secondSummary}
          };
          el('studio-dw-split-target').textContent = storyName(story)+' · '+(scene.title||sceneId);
          el('studio-dw-split-before').textContent = 'Saved Intent: '+(scene.summary||'(empty)')+
            (scene.prompt ? ' · Existing H3 Prompt and Takes will remain with this Scene.' : '');
          el('studio-dw-split-first').value = candidate.firstSummary;
          el('studio-dw-split-second-title').value = candidate.secondTitle;
          el('studio-dw-split-second-summary').value = candidate.secondSummary;
          el('studio-dw-split-error').textContent = '';
          el('studio-dw-split-review').showModal();
          status('Two Scene Intents ready for one reviewed split.',false);
        });
      }).catch(function (error) {
        status('Scene split draft failed: '+String(error.message||error),true);
      }).finally(function () {button.disabled = false;});
  }
  function applySplitScene() {
    if (!proposedSplit) throw new Error('No reviewed Scene split exists.');
    var proposal = Object.assign({},proposedSplit), button=el('studio-dw-split-apply');
    proposal.firstSummary=el('studio-dw-split-first').value.trim();
    proposal.secondScene={
      title:el('studio-dw-split-second-title').value.trim(),
      summary:el('studio-dw-split-second-summary').value.trim()
    };
    if (!proposal.firstSummary || !proposal.secondScene.summary) {
      el('studio-dw-split-error').textContent='Both new Scene Intents must describe an event.';
      return;
    }
    button.disabled=true;
    var applied=false;
    Promise.resolve().then(function () {
      return window.flushStudioDirectorStoryEdits(proposal.storyId);
    }).then(function () {
      return api('/fs/studio/director/scene-split',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(proposal)
      });
    }).then(function (result) {
      if (!result.story || !result.scene || !result.scene.id)
        throw new Error('Split Apply returned no saved new Scene.');
      applied=true;
      proposedSplit=null;
      el('studio-dw-split-review').close();
      var saved={
        sourceSceneId:proposal.sceneId,
        sourceSummary:result.story.scenes[proposal.sceneId].summary,
        createdScene:{id:result.scene.id,title:result.scene.title,summary:result.scene.summary},
        sceneOrder:result.story.sceneOrder
      };
      return window.studioDirectorBridge.recordApplied('scene.split',result.story,saved).then(function () {
        status('Reviewed Scene split saved. Review the original H3 Prompt before generating.',false);
        if (typeof window.refreshStudioDirectorStoryIfOpen === 'function')
          return window.refreshStudioDirectorStoryIfOpen(result.story.id);
      });
    }).catch(function (error) {
      var message=String(error.message||error);
      el('studio-dw-split-error').textContent=applied
        ? 'Scene split saved, but conversation recording or refresh failed: '+message
        : 'Apply was not confirmed: '+message;
      status('Scene split Apply: '+message,true);
    }).finally(function () {button.disabled=false;});
  }
  function prepareBatchScenes(storyId) {
    var ids = Array.from(el('studio-dw-batch-scenes').querySelectorAll('input:checked'))
      .map(function (node) {return node.value;});
    var fields = Array.from(el('studio-dw-batch-fields').querySelectorAll('input:checked'))
      .map(function (node) {return node.value;});
    if (!ids.length || ids.length > 32 || !fields.length) {
      status('Choose one to 32 Scenes and at least one creative field.',true);
      return;
    }
    var button = el('studio-dw-write-prepare');
    button.disabled = true;
    status('Director is developing the selected Scenes together…',false);
    Promise.resolve().then(function () {
      return window.flushStudioDirectorStoryEdits(storyId);
    }).then(function () {return loadStory(storyId);})
      .then(function (story) {
        var selected = ids.map(function (id) {
          var scene = story.scenes && story.scenes[id];
          if (!scene || (story.sceneOrder || []).indexOf(id) === -1)
            throw new Error('A selected Scene no longer exists.');
          var current = {sceneId:id, position:(story.sceneOrder || []).indexOf(id) + 1,
            title:scene.title, summary:scene.summary, prompt:scene.prompt,
            durationSeconds:scene.durationSeconds, invariantRefs:scene.invariantRefs};
          return current;
        });
        var history = window.studioDirectorBridge.messages().slice(-18).map(function (message) {
          return {role:message.role, text:String(message.content || '').slice(0,3200)};
        });
        var request = [
          'You are Studio Director. Develop these specific existing Scenes as one coherent creative revision.',
          'Return ONLY JSON: {"scenes":[{"sceneId":"existing stable ID", selected field:"complete final text"}]}.',
          'Return exactly one record per selected ID, in the same order, using ONLY sceneId and fields: '+fields.join(', ')+'.',
          'Do not invent Scenes or IDs. For unchanged fields, return their exact current text.',
          'Preserve independent renderability, the author\'s core appeal and unrelated content.',
          'Project context: '+JSON.stringify({id:story.id,concept:story.concept,style:story.style,invariants:story.invariants}),
          'Selected Scenes: '+JSON.stringify(selected),
          'Recent creative discussion: '+JSON.stringify(history),
          'For H3 Prompt revisions, time each selected Scene to its own durationSeconds and preserve its linked Character/Location Invariants. Duration and links are read-only context, not output fields.'
        ].join('\n');
        return window.studioDirectorBridge.makeProposal(request, 'studio_scene_batch_draft', fields.indexOf('prompt') !== -1)
          .then(function (raw) {
            var result = parseProposal(raw);
            if (!Array.isArray(result.scenes) || result.scenes.length !== ids.length)
              throw new Error('Director did not return the selected Scenes.');
            var seen = new Set();
            result.scenes.forEach(function (candidate) {
              if (!candidate || typeof candidate !== 'object' || !ids.includes(candidate.sceneId) ||
                  seen.has(candidate.sceneId) ||
                  Object.keys(candidate).some(function (key) {return key !== 'sceneId' && !fields.includes(key);}) ||
                  fields.some(function (field) {return typeof candidate[field] !== 'string';})) {
                throw new Error('Director returned invalid or mismatched Scene fields.');
              }
              seen.add(candidate.sceneId);
            });
            proposedBatch = {storyId:storyId, scenes:ids.map(function (id) {
              return {sceneId:id, before:selected.find(function (row) {return row.sceneId === id;}),
                draft:result.scenes.find(function (row) {return row.sceneId === id;})};
            }),fields:fields};
            renderBatchReview();
          });
      }).catch(function (error) {
        status('Multi-Scene draft failed: ' + String(error.message || error),true);
      }).finally(function () {button.disabled = false;});
  }
  function renderBatchReview() {
    if (!proposedBatch) throw new Error('No multi-Scene proposal is available.');
    var host = el('studio-dw-batch-editors');
    host.replaceChildren();
    proposedBatch.scenes.forEach(function (entry,index) {
      var section = document.createElement('section'), heading = document.createElement('h3');
      heading.textContent = 'Scene ' + entry.before.position + ' · ' + (entry.before.title || entry.sceneId);
      section.dataset.sceneId = entry.sceneId;
      section.appendChild(heading);
      proposedBatch.fields.forEach(function (field) {
        var row = document.createElement('label'), checkbox = document.createElement('input'),
          editor = document.createElement('textarea'), old = entry.before[field] || '';
        checkbox.type = 'checkbox';
        checkbox.dataset.selectField = field;
        checkbox.checked = entry.draft[field] !== old;
        editor.dataset.field = field;
        editor.value = entry.draft[field];
        editor.rows = field === 'prompt' ? 12 : 5;
        editor.addEventListener('input', function () {checkbox.checked = true;});
        var name = document.createElement('strong'), before = document.createElement('small');
        name.textContent = labels[field] + ' · include this change';
        before.textContent = 'Saved: ' + (old || '(empty)');
        row.append(checkbox, name, before, editor);
        section.appendChild(row);
      });
      host.appendChild(section);
    });
    el('studio-dw-batch-error').textContent = '';
    el('studio-dw-batch-review').showModal();
    status('Selected Scene drafts are ready for one reviewed Apply.',false);
  }
  function applyBatchScenes() {
    if (!proposedBatch) throw new Error('No reviewed multi-Scene draft.');
    var draft = proposedBatch, revisions = [];
    Array.from(el('studio-dw-batch-editors').querySelectorAll('section[data-scene-id]')).forEach(function (section) {
      var entry = draft.scenes.find(function (item) {return item.sceneId === section.dataset.sceneId;});
      var changes = {}, expected = {};
      Array.from(section.querySelectorAll('input[data-select-field]:checked')).forEach(function (checkbox) {
        var field = checkbox.dataset.selectField, value = section.querySelector('textarea[data-field="'+field+'"]').value;
        if (value.trim() !== (entry.before[field] || '')) {
          changes[field] = value;
          expected[field] = entry.before[field] || '';
        }
      });
      if (Object.keys(changes).length) revisions.push({sceneId:entry.sceneId,expected:expected,changes:changes});
    });
    if (!revisions.length) {
      el('studio-dw-batch-error').textContent = 'Select at least one actual Scene change.';
      return;
    }
    var button = el('studio-dw-batch-apply');
    button.disabled = true;
    var applied = false;
    Promise.resolve().then(function () {
      return window.flushStudioDirectorStoryEdits(draft.storyId);
    }).then(function () {
      return api('/fs/studio/director/scene-fields-batch', {
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({storyId:draft.storyId,revisions:revisions})
      });
    }).then(function (result) {
      if (!result.story || !result.savedFieldsByScene) throw new Error('Batch Apply returned no authoritative saved fields.');
      applied = true;
      proposedBatch = null;
      el('studio-dw-batch-review').close();
      return window.studioDirectorBridge.recordApplied('scene.batch.update',result.story,
        {scenes:result.savedFieldsByScene}).then(function () {
          status('Reviewed Scene revisions saved together.',false);
          if (typeof window.refreshStudioDirectorStoryIfOpen === 'function')
            return window.refreshStudioDirectorStoryIfOpen(result.story.id);
      });
    }).catch(function (error) {
      var detail = String(error.message || error);
      el('studio-dw-batch-error').textContent = applied
        ? 'Scenes saved, but conversation recording or refresh failed: '+detail
        : 'Apply was not confirmed: '+detail;
      status('Multi-Scene Apply: '+detail,true);
    }).finally(function () {button.disabled = false;});
  }
  function prepareStructure(operation, storyId) {
    var sceneId = el('studio-dw-write-scene').value;
    var relativeId = operation === 'scene-move' ? el('studio-dw-move-target').value : '';
    var placement = operation === 'scene-move' ? el('studio-dw-move-placement').value : '';
    if (!sceneId || (operation === 'scene-move' && (!relativeId || sceneId === relativeId))) {
      status('Choose a source Scene and a different destination Scene.', true);
      return;
    }
    var button = el('studio-dw-write-prepare');
    button.disabled = true;
    Promise.resolve().then(function () {
      return window.flushStudioDirectorStoryEdits(storyId);
    }).then(function () { return loadStory(storyId); })
      .then(function (story) {
        var order = (story.sceneOrder || []).slice(), scene = story.scenes && story.scenes[sceneId];
        if (!scene || order.indexOf(sceneId) < 0) throw new Error('Source Scene is no longer available.');
        var after = order.slice();
        if (operation === 'scene-move') {
          if (after.indexOf(relativeId) < 0) throw new Error('Destination Scene is no longer available.');
          after.splice(after.indexOf(sceneId), 1);
          after.splice(after.indexOf(relativeId) + (placement === 'after' ? 1 : 0), 0, sceneId);
          if (after.join('|') === order.join('|'))
            throw new Error('The Scene is already in that position.');
        }
        var title = function (id) { return (story.scenes[id] || {}).title || 'Untitled'; };
        proposedStructure = {
          storyId:storyId, operation:operation === 'scene-move' ? 'move' : 'duplicate',
          sceneId:sceneId, relativeSceneId:relativeId, placement:placement,
          expectedSceneOrder:order, expectedSourceUpdatedAt:scene.updatedAt
        };
        el('studio-dw-structure-title').textContent = operation === 'scene-move'
          ? 'Review Scene move' : 'Review Scene duplicate';
        el('studio-dw-structure-summary').textContent = operation === 'scene-move'
          ? 'Move “' + title(sceneId) + '” ' + placement + ' “' + title(relativeId) + '”.'
          : 'Create a copy of “' + title(sceneId) + '” immediately after it. The copy retains its authored setup and Prompt, not its Takes.';
        var describe = function (ids) {
          return ids.map(function (id, index) {return (index + 1) + '. ' + title(id);}).join('\n');
        };
        el('studio-dw-structure-before').textContent = 'Before\n' + describe(order);
        el('studio-dw-structure-after').textContent = operation === 'scene-move'
          ? 'After\n' + describe(after)
          : 'After\n' + order.reduce(function (rows, id, index) {
              rows.push((rows.length + 1) + '. ' + title(id));
              if (id === sceneId) rows.push((rows.length + 1) + '. ' + title(id) + ' Copy (new Scene)');
              return rows;
            }, []).join('\n');
        el('studio-dw-structure-error').textContent = '';
        el('studio-dw-structure-review').showModal();
      }).catch(function (error) {
        status('Scene structure review failed: ' + String(error.message || error), true);
      }).finally(function () {button.disabled = false;});
  }
  function applyStructure() {
    if (!proposedStructure) throw new Error('No reviewed Scene structure change exists.');
    var proposal = proposedStructure, button = el('studio-dw-structure-apply');
    button.disabled = true;
    var applied = false;
    Promise.resolve().then(function () {
      return window.flushStudioDirectorStoryEdits(proposal.storyId);
    }).then(function () {
      return api('/fs/studio/director/scene-structure', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify(proposal)
      });
    }).then(function (payload) {
      if (!payload.story || !Array.isArray(payload.story.sceneOrder))
        throw new Error('Reviewed structure Apply returned no saved Scene order.');
      applied = true;
      proposedStructure = null;
      el('studio-dw-structure-review').close();
      var saved = {sceneOrder:payload.story.sceneOrder, sourceSceneId:proposal.sceneId};
      if (payload.scene) saved.newScene = {id:payload.scene.id,title:payload.scene.title,summary:payload.scene.summary};
      return window.studioDirectorBridge.recordApplied(
        'scene.' + proposal.operation,payload.story,saved
      ).then(function () {
        status('Reviewed Scene structure saved and recorded in conversation.',false);
        if (typeof window.refreshStudioDirectorStoryIfOpen === 'function')
          return window.refreshStudioDirectorStoryIfOpen(payload.story.id);
      });
    }).catch(function (error) {
      var message = String(error.message || error);
      el('studio-dw-structure-error').textContent = applied
        ? 'Scene change saved, but conversation recording or refresh failed: ' + message
        : 'Apply was not confirmed: ' + message;
      status('Scene structure Apply: ' + message,true);
    }).finally(function () {button.disabled = false;});
  }
  function preparePlaybook() {
    var button = el('studio-dw-playbook-open');
    button.disabled = true;
    status('Reading saved Playbook and drafting a focused improvement…',false);
    api('/fs/studio/director/playbook').then(function (payload) {
      playbookExpected = payload.guidance;
      var history = window.studioDirectorBridge.messages().slice(-16).map(function (m) {
        return {role:m.role,text:String(m.content||'').slice(0,3000)};
      });
      var request = 'Suggest a concise, reusable H3 production Playbook improvement based on this discussion. ' +
        'First determine whether the issue concerns model technique rather than missing context or a WebCap code defect. ' +
        'Return a JSON object with a single guidance key containing the COMPLETE revised Playbook. ' +
        'Preserve valuable existing advice, revise conflicting wording rather than stacking prohibitions, ' +
        'and do not put runtime facts or executable instructions in editable guidance. ' +
        'Current saved Playbook: ' + JSON.stringify(payload.guidance) +
        '. Conversation: ' + JSON.stringify(history);
      return window.studioDirectorBridge.makeProposal(request,'studio_playbook_draft');
    }).then(function (text) {
      var proposal = parseProposal(text);
      if (typeof proposal.guidance !== 'string') throw new Error('Director did not return complete guidance.');
      el('studio-dw-playbook-before').textContent = playbookExpected || '(empty)';
      el('studio-dw-playbook-after').value = proposal.guidance;
      el('studio-dw-playbook-error').textContent = '';
      el('studio-dw-playbook-review').showModal();
      status('Playbook proposal ready. Nothing is saved until Apply.',false);
    }).catch(function (error) {status('Playbook proposal failed: '+String(error.message||error),true);})
      .finally(function () {button.disabled=false;});
  }
  function applyPlaybook() {
    if (playbookExpected === null) throw new Error('No reviewed Playbook proposal.');
    var button=el('studio-dw-playbook-apply'); button.disabled=true;
    api('/fs/studio/director/playbook',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({expected:playbookExpected,guidance:el('studio-dw-playbook-after').value})
    }).then(function (payload) {
      if (typeof payload.guidance !== 'string') throw new Error('Playbook Apply was not confirmed.');
      el('studio-dw-playbook-review').close();playbookExpected=null;
      status('Reviewed Playbook saved. New Director requests use the updated guidance.',false);
    }).catch(function (error) {
      el('studio-dw-playbook-error').textContent=String(error.message||error);
      status('Playbook Apply failed: '+String(error.message||error),true);
    }).finally(function () {button.disabled=false;});
  }
  function applyScene() {
    if (!proposedScene) throw new Error('There is no reviewed Scene proposal.');
    var changes = {};
    Array.from(el('studio-dw-scene-editors').querySelectorAll('textarea[data-field]')).forEach(function (node) {
      changes[node.dataset.field] = node.value;
    });
    var button = el('studio-dw-scene-apply');
    button.disabled = true;
    var applied = false;
    Promise.resolve().then(function () {
      return window.flushStudioDirectorStoryEdits(proposedScene.storyId);
    }).then(function () {return api('/fs/studio/director/scene-fields', {
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({storyId:proposedScene.storyId,sceneId:proposedScene.sceneId,
        expected:proposedScene.expected,changes:changes})
    });}).then(function (result) {
      if (!result.scene || !result.story) throw new Error('Scene Apply returned no saved Scene.');
      applied = true;
      var selected = {};
      proposedScene.fields.forEach(function (field) {selected[field] = result.scene[field];});
      var sceneId = proposedScene.sceneId;
      el('studio-dw-scene-review').close(); proposedScene=null;
      return window.studioDirectorBridge.recordApplied('scene.update',result.story,{
        sceneId:sceneId, savedFields:selected
      }).then(function () {
        status('Reviewed Scene changes saved and recorded in Director conversation.',false);
        if (typeof window.refreshStudioDirectorStoryIfOpen === 'function')
          return window.refreshStudioDirectorStoryIfOpen(result.story.id);
      });
    }).catch(function (err) {
      var message = String(err.message || err);
      el('studio-dw-scene-error').textContent = applied
        ? 'Scene saved, but conversation recording or refresh failed: ' + message
        : 'Apply was not confirmed: ' + message;
      status('Scene Apply: ' + message,true);
    }).finally(function () {button.disabled=false;});
  }
  function setReadinessFreshness(stale) {
    readinessStale = !!stale;
    Array.from(el('studio-dw-readiness-list').querySelectorAll('button[data-capture-action], button[data-guided-write]'))
      .forEach(function (action) {action.disabled = readinessStale;});
    var label = el('studio-dw-readiness-freshness');
    label.textContent = readinessStale
      ? (readiness.length ? 'Outdated · latest exchange not assessed' : 'Latest exchange not assessed')
      : (readiness.length ? 'Assessed for latest reply · advisory only' : 'Not assessed yet');
    var empty = el('studio-dw-readiness-list').querySelector('p');
    if (empty) empty.textContent = readinessStale ? 'No current assessment.' : 'Not assessed yet';
  }
  function openRecommendedWrite() {
    var hint = recommendations.writeHint;
    if (!hint) return;
    var operation = hint === 'scene' ? 'scenes' : hint;
    var select = el('studio-dw-write-operation');
    if (!Array.from(select.options).some(function (item) {return item.value === operation;})) {
      status('The recommended Studio operation is not available.', true);
      return;
    }
    select.value = operation;
    writeOperationChosen = true;
    writeFieldsManuallyChanged = false;
    if (el('studio-dw-write-panel').classList.contains('hidden')) toggle('write');
    else refreshWrite();
    status('Director suggested this operation. Choose the exact saved targets, then review.', false);
  }
  function renderReadiness(list) {
    readiness = list;
    var host = el('studio-dw-readiness-list');
    host.replaceChildren();
    if (creativeCapture && !readinessStale) {
      var captureButton = document.createElement('button');
      captureButton.type = 'button';
      captureButton.className = 'studio-dw-assessment-item';
      captureButton.dataset.captureAction = 'true';
      var fieldName = labels[creativeCapture.field] || creativeCapture.field;
      captureButton.textContent = 'Review ' + fieldName + ' change';
      captureButton.title = 'Review Director-authored material in the saved field; no additional model request';
      captureButton.onclick = function () {reviewCreativeCapture(creativeCapture);};
      host.appendChild(captureButton);
    }
    if (!creativeCapture && recommendations.writeHint && !readinessStale) {
      var nextButton = document.createElement('button');
      nextButton.type = 'button';
      nextButton.className = 'studio-dw-assessment-item';
      nextButton.dataset.guidedWrite = 'true';
      var names = {
        project:'Update Project', 'new-project':'Create Project', scene:'Add Scene',
        scenes:'Add Scenes', 'scene-edit':'Revise Scene', 'scenes-batch':'Revise several Scenes',
        'scene-move':'Move Scene', 'scene-duplicate':'Duplicate Scene',
        'scene-split':'Split Scene', 'scene-invariants':'Use Invariant in Scenes', playbook:'Revise H3 Playbook'
      };
      nextButton.textContent = 'Review next step · ' + (names[recommendations.writeHint] || 'Studio Write');
      nextButton.onclick = openRecommendedWrite;
      host.appendChild(nextButton);
    }
    if (!list.length) {
      var empty = document.createElement('p');
      empty.textContent = readinessStale ? 'No current assessment.' : 'Not assessed yet.';
      host.appendChild(empty);
      return;
    }
    list.forEach(function (item) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'studio-dw-assessment-item';
      var subject = item.scope === 'project' ? 'Project' : 'Scene (current discussion)';
      button.textContent = (item.ready ? '☑ ' : '□ ') + subject + ' · ' + item.name;
      button.title = 'Inspect complete Director proposal';
      button.onclick = function () {
        el('studio-dw-assessment-title').textContent = subject + ' · ' + item.name +
          (item.ready ? ' · developed' : ' · needs development');
        el('studio-dw-assessment-content').textContent = item.content;
        el('studio-dw-assessment-dialog').showModal();
      };
      host.appendChild(button);
    });
  }
  window.studioDirectorWorkbench = {
    setStatus:status,
    showSentWriteContext: function(operation, messages) {
      var preview = el('studio-dw-write-context-json');
      var details = el('studio-dw-write-context');
      details.querySelector('summary').textContent = 'Inspect exact Director request just sent';
      preview.textContent = JSON.stringify({
        operation:operation,model:window.studioDirectorBridge.modelId(),messages:messages
      }, null, 2);
    },
    setUndo: function (receipt) {
      var host = el('studio-dw-undo');
      host.classList.toggle('hidden', !receipt);
      if (receipt) el('studio-dw-undo-label').textContent =
        'Project brief updated · ' + (receipt.label || receipt.storyId);
    },
    resetConversation: function () {
      readChoices = {};
      writeOperationChosen = false;
      writeFieldsManuallyChanged = false;
      lastReadSource = null;
      readStory = null;
      writeStory = null;
      creativeCapture = null;
      el('studio-dw-read-panel').classList.add('hidden');
      el('studio-dw-write-panel').classList.add('hidden');
      el('studio-dw-read').setAttribute('aria-expanded','false');
      el('studio-dw-write').setAttribute('aria-expanded','false');
      el('studio-dw-quick-read').setAttribute('aria-expanded','false');
      el('studio-dw-quick-write').setAttribute('aria-expanded','false');
      el('director-chat-drawer').classList.remove('studio-actions-open');
      status('', false);
      updateScope();
    },
    setReadinessFreshness:setReadinessFreshness,
    updateReadiness:function (result, restoring) {
      var list = Array.isArray(result) ? result : result && result.checks;
      var allowed = ['Concept','Characters','Setting','Action','Dialogue','Visual / atmosphere',
        'Visual focus','Structure / formula','Variation / repetition','Production feasibility'];
      var operations = ['', 'project','new-project','scene','scenes','scene-edit','scenes-batch','scene-move','scene-duplicate','scene-split','scene-invariants','playbook'];
      if (!Array.isArray(list) || list.length > 30 ||
          list.some(function (item) {
            return !item || typeof item !== 'object' || Array.isArray(item) ||
              Object.keys(item).sort().join(',') !== 'content,name,ready,scope' ||
              allowed.indexOf(item.name) < 0 ||
              ['project','scene'].indexOf(item.scope) < 0 ||
              typeof item.ready !== 'boolean' ||
              typeof item.content !== 'string' || item.content.length > 8000;
          })) {
        status('Director readiness has invalid or unsupported assessments.',true);
        return false;
      }
      var hints = result && result.readHints === undefined ? [] : result.readHints;
      var writeHint = result && result.writeHint === undefined ? '' : result.writeHint;
      var sceneId = result && result.sceneId === undefined ? '' : result.sceneId;
      var writeFields = result && result.writeFields === undefined ? [] : result.writeFields;
      var allowedWriteFields = writeHint === 'project' ? projectFields :
        (writeHint === 'scene-edit' || writeHint === 'scenes-batch') ? sceneFields : [];
      if (!Array.isArray(hints) || hints.length > 15 ||
          hints.some(function(key) {return typeof key !== 'string' || key.length > 120;}) ||
          operations.indexOf(writeHint) < 0 || typeof sceneId !== 'string' || sceneId.length > 160 ||
          !Array.isArray(writeFields) || writeFields.length > 4 ||
          writeFields.some(function (field) { return typeof field !== 'string' || allowedWriteFields.indexOf(field) < 0; }) ||
          (new Set(writeFields)).size !== writeFields.length) {
        status('Director readiness recommendations do not match the saved contract.',true);
        return false;
      }
      var capture = result && result.capture || null;
      if (capture) {
        var isInvariant = capture.field === 'invariant';
        var expectedKeys = isInvariant ? 'beforeKind,beforeTitle,content,field,kind,sceneId,title' :
          capture.field === 'scene' ? 'content,field,sceneId,title' : 'content,field,sceneId';
        if (typeof capture !== 'object' || Array.isArray(capture) ||
            Object.keys(capture).sort().join(',') !== expectedKeys ||
            ['title','concept','style','summary','prompt','invariant','scene'].indexOf(capture.field) === -1 ||
            typeof capture.content !== 'string' || !capture.content.trim() || capture.content.length > 20000 ||
            typeof capture.sceneId !== 'string' || capture.sceneId.length > 160 ||
            (['title','concept','style','invariant','scene'].indexOf(capture.field) !== -1 && capture.sceneId) ||
            (['summary','prompt'].indexOf(capture.field) !== -1 && !capture.sceneId) ||
            (capture.field === 'scene' && (typeof capture.title !== 'string' || capture.title.length > 240)) ||
            (isInvariant && (
              ['character','location','visual','world','sound','custom'].indexOf(capture.kind) === -1 ||
              typeof capture.title !== 'string' || !capture.title.trim() || capture.title.length > 240 ||
              typeof capture.beforeKind !== 'string' || typeof capture.beforeTitle !== 'string' ||
              (!!capture.beforeKind !== !!capture.beforeTitle) ||
              (capture.beforeKind && ['character','location','visual','world','sound','custom'].indexOf(capture.beforeKind) === -1)
            ))) {
          status('Director creative capture did not match the expected contract.',true);
          return false;
        }
      }
      recommendations = {readHints:hints, writeHint:writeHint, writeFields:writeFields, sceneId:sceneId};
      creativeCapture = capture;
      setReadinessFreshness(!!(restoring && result && result.stale));
      renderReadiness(list);
      if (!restoring) window.studioDirectorBridge.updateReadiness({
        checks:list,readHints:hints,writeHint:writeHint,writeFields:writeFields,sceneId:sceneId,stale:false,
        ...(capture ? {capture:capture} : {})
      });
      return true;
    }
  };

  function bind() {
    var rail = el('studio-director-workbench');if (!rail) return;
    el('studio-dw-read').onclick=function () { toggle('read'); };
    el('studio-dw-write').onclick=function () { toggle('write'); };
    el('studio-dw-read-project').onchange=function () {
      loadStory(this.value).then(renderReadStory).catch(function(e) { status(e.message,true); });
    };
    el('studio-dw-write-project').onchange=function () {
      loadStory(this.value).then(renderWriteStory).catch(function(e) { status(e.message,true); });
    };
    el('studio-dw-write-operation').onchange=function () {
      writeOperationChosen = true;
      writeFieldsManuallyChanged = false;
      setOperation();
      applySuggestedWriteFields();
    };
    ['studio-dw-write-fields', 'studio-dw-batch-fields'].forEach(function (id) {
      Array.from(el(id).querySelectorAll('input[type="checkbox"]')).forEach(function (check) {
        check.onchange = function () { writeFieldsManuallyChanged = true; };
      });
    });
    el('studio-dw-read-preview').ontoggle = function () {
      if (!this.open) return;
      var id = el('studio-dw-read-project').value;
      if (!id) return;
      loadStory(id).then(function (story) {
        el('studio-dw-read-preview-data').textContent =
          JSON.stringify(readPayload(story, selectedPaths()), null, 2);
      }).catch(function(error){status('Read preview failed: '+error.message,true);});
    };
    function openDirectAction(which) {
      lastQuickAction = which;
      el('director-chat-drawer').classList.add('studio-actions-open');
      if (el('studio-dw-' + which + '-panel').classList.contains('hidden'))
        el('studio-dw-' + which).click();
      el('studio-dw-quick-' + which).setAttribute('aria-expanded','true');
      el('studio-dw-quick-' + (which === 'read' ? 'write' : 'read'))
        .setAttribute('aria-expanded','false');
      el('studio-dw-close-actions').focus();
    }
    el('studio-dw-quick-read').onclick=function () { openDirectAction('read'); };
    el('studio-dw-quick-write').onclick=function () { openDirectAction('write'); };
    el('studio-dw-close-actions').onclick=function () {
      el('director-chat-drawer').classList.remove('studio-actions-open');
      el('studio-dw-quick-read').setAttribute('aria-expanded','false');
      el('studio-dw-quick-write').setAttribute('aria-expanded','false');
      el('studio-dw-quick-' + lastQuickAction).focus();
    };
    rail.addEventListener('keydown',function(event){
      if(event.key==='Escape' && el('director-chat-drawer').classList.contains('studio-actions-open')) {
        event.preventDefault();
        el('studio-dw-close-actions').click();
      }
    });
    el('studio-dw-undo-button').onclick=function () { window.studioDirectorBridge.undoBrief(); };
    el('studio-dw-playbook-open').onclick=preparePlaybook;
    el('studio-dw-assessment-close').onclick=function(){el('studio-dw-assessment-dialog').close();};
    el('studio-dw-write-scene').onchange=showWriteContext;
    el('studio-dw-invariant-choice').onchange=function () {renderInvariantScenes(writeStory);showWriteContext();};
    el('studio-dw-move-target').onchange=showWriteContext;
    el('studio-dw-move-placement').onchange=showWriteContext;
    el('studio-dw-read-send').onclick=readSend;
    el('studio-dw-write-prepare').onclick=writePrepare;
    el('studio-dw-scene-apply').onclick=applyScene;
    el('studio-dw-structure-apply').onclick=applyStructure;
    el('studio-dw-batch-apply').onclick=applyBatchScenes;
    el('studio-dw-invariant-apply').onclick=applyInvariantLinks;
    ['studio-dw-invariant-close','studio-dw-invariant-cancel'].forEach(function (id) {
      el(id).onclick=function () {el('studio-dw-invariant-review').close();};
    });
    el('studio-dw-split-apply').onclick=applySplitScene;
    ['studio-dw-split-close','studio-dw-split-cancel'].forEach(function (id) {
      el(id).onclick=function () {el('studio-dw-split-review').close();};
    });
    ['studio-dw-batch-close','studio-dw-batch-cancel'].forEach(function (id) {
      el(id).onclick=function () {el('studio-dw-batch-review').close();};
    });
    ['studio-dw-structure-close','studio-dw-structure-cancel'].forEach(function (id) {
      el(id).onclick=function () {el('studio-dw-structure-review').close();};
    });
    el('studio-dw-playbook-apply').onclick=applyPlaybook;
    ['studio-dw-playbook-close','studio-dw-playbook-cancel'].forEach(function (id) {
      el(id).onclick=function () {el('studio-dw-playbook-review').close();};
    });
    ['studio-dw-scene-close','studio-dw-scene-cancel'].forEach(function (id) {
      el(id).onclick=function () {el('studio-dw-scene-review').close();};
    });
    renderReadiness(readiness);
    setReadinessFreshness(false);
    updateScope();
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind);
  else bind();
})();
