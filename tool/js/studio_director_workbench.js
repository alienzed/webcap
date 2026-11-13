(function () {
  'use strict';
  var readStory = null, writeStory = null, projects = [], proposedScene = null, proposedBatch = null;
  var readiness = [], recommendations = {readHints:[],writeHint:'',writeFields:[],sceneId:''};
  var readinessStale = false;
  var readChoices = {}, writeOperationChosen = false, lastReadSource = null;
  var sceneSelectionManual = false, sceneSelectionProject = '', recommendationProject = '';
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
      node.textContent = error ? (message || '') : '';
      node.dataset.error = error ? 'true' : 'false';
      node.classList.toggle('hidden', !message || !error);
    }
    if (error) window.reportConsoleError('Studio Director workbench', new Error(message));
    else if (message) window.reportConsoleInfo('Studio Director workbench', message);
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
  // Read choices are complete Project and Scene units; the existing field IDs
  // remain the wire format so the preview, receipt and chat history stay compatible.
  function renderReadStory(story) {
    readStory = story;
    var fields = el('studio-dw-project-fields'), scenes = el('studio-dw-scene-fields');
    fields.replaceChildren(); scenes.replaceChildren();
    if (!story) { updateReadSelection(); return; }
    var chosen = readChoices[story.id], firstSelection = !chosen;
    if (firstSelection) chosen = new Set();
    function addUnit(label, paths, host, suggested) {
      if (firstSelection && suggested) paths.forEach(function (path) { chosen.add(path); });
      var row = document.createElement('label'), toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.dataset.groupSelect = 'true';
      toggle.groupPaths = paths;
      toggle.checked = paths.every(function (path) {return chosen.has(path);});
      row.append(toggle, document.createTextNode(label));
      toggle.onchange = function () {
        paths.forEach(function (path) {
          if (toggle.checked) chosen.add(path);
          else chosen.delete(path);
        });
        updateReadSelection();
      };
      host.appendChild(row);
    }
    var overview = projectFields.map(function (key) {return 'project.' + key;});
    addUnit('Project Overview', overview, fields,
      recommendations.readHints.length
        ? overview.some(function (path) {return recommendations.readHints.includes(path);})
        : !!(story.concept || story.style || (story.invariants || []).length));
    (story.sceneOrder || []).forEach(function (id, index) {
      var scene = story.scenes && story.scenes[id];
      if (!scene) throw new Error('Project has a Scene index with no matching Scene.');
      var paths = ['title', 'summary', 'prompt', 'durationSeconds'].map(function (field) {
        return 'scene:' + id + ':' + field;
      });
      var current = id === (recommendedSceneId(story) || activeTarget().sceneId);
      var suggested = recommendations.readHints.some(function (hint) {
        return paths.includes(hint) || (current && hint.startsWith('scene.current.') &&
          paths.some(function (path) {return path.endsWith(':' + hint.slice(14));}));
      }) || (!recommendations.readHints.length && current && !!(scene.summary || scene.prompt));
      addUnit('Scene ' + (index + 1) + ' · ' + (scene.title || 'Untitled'), paths, scenes, suggested);
    });
    readChoices[story.id] = chosen;
    updateReadSelection();
  }
  function selectedPaths() {
    return Array.from(el('studio-dw-read-panel').querySelectorAll('input[data-group-select]:checked'))
      .flatMap(function (toggle) {return toggle.groupPaths;});
  }
  function selectEntireReadProject() {
    if (!readStory) return;
    el('studio-dw-read-panel').querySelectorAll('input[data-group-select]').forEach(function (toggle) {
      toggle.checked = true;
      toggle.groupPaths.forEach(function (path) { readChoices[readStory.id].add(path); });
    });
    updateReadSelection();
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
    var bytes = readStory ? JSON.stringify(readPayload(readStory, keys)).length : 0;
    var units = el('studio-dw-read-panel').querySelectorAll('input[data-group-select]:checked').length;
    el('studio-dw-read-count').textContent = units +
      (units === 1 ? ' selection' : ' selections') + ' · ' + bytes.toLocaleString() + ' characters';
    el('studio-dw-read-send').disabled = !keys.length || !el('studio-dw-read-project').value;
    el('studio-dw-read-all').disabled = !readStory || !el('studio-dw-read-project').value;
    var details = el('studio-dw-read-preview');
    if (details.open && readStory) el('studio-dw-read-preview-data').textContent =
      JSON.stringify(readPayload(readStory, keys), null, 2);
  }
  function readSend() {
    var id = el('studio-dw-read-project').value, keys = selectedPaths();
    if (!id || !keys.length) { status('Choose a Project and at least one field.', true); return; }
    if (!window.studioDirectorBridge.isReady()) { status('Open Director and choose a model first.', true); return; }
    el('studio-dw-read-send').disabled = true;
    window.studioDirectorWorkbench.setReadStatus('working','Reading selected saved fields…');
    // Same exact serializer drives the inspector and the outbound LLM message.
    loadStory(id).then(function (story) {
      var payload = readPayload(story, keys);
      var length = JSON.stringify(payload).length;
      if (length > 48000) throw new Error('Selected Read is ' + length.toLocaleString() +
        ' characters. Select the Project Overview or fewer Scenes.');
      el('studio-dw-read-preview-data').textContent = JSON.stringify(payload, null, 2);
      window.studioDirectorBridge.sendRead(payload, keys);
      lastReadSource = story.id;
      status('Selected fields sent. Awaiting Director’s own acknowledgment.', false);
      el('studio-dw-read-panel').classList.add('hidden');
      el('studio-dw-read').setAttribute('aria-expanded', 'false');
      updateScope();
      if (el('director-chat-drawer').classList.contains('studio-actions-open'))
        el('studio-dw-close-actions').click();
    }).catch(function (error) {
      window.studioDirectorWorkbench.setReadStatus('error','Read failed: ' + String(error.message || error));
      status('Read failed: ' + String(error.message || error), true);
    })
      .finally(function () { updateReadSelection(); });
  }
  function showWriteContext() {
    var operation=el('studio-dw-write-operation').value, text='';
    var writingNewScenes = operation === 'scene-write' && el('studio-dw-scene-mode').value === 'create';
    var revisingScenes = operation === 'scene-write' && el('studio-dw-scene-mode').value === 'revise';
    if (operation==='new-project') {
      text='Conversation only. No saved Project fields are included.';
    } else if (!writeStory) {
      text='Select a Project to inspect the content Director will use.';
    } else {
      var p=writeStory;
      var data={projectId:p.id,title:p.title,concept:p.concept,style:p.style,invariants:p.invariants};
      if (writingNewScenes) {
        data.currentScenes=(p.sceneOrder||[]).map(function (id,index) {
          var scene=p.scenes[id];
          return {id:id,position:index+1,title:scene.title,intent:scene.summary};
        });
      }
      if (revisingScenes) {
        data.selectedScenes = Array.from(el('studio-dw-batch-scenes').querySelectorAll('input:checked'))
          .map(function (check) {return p.scenes && p.scenes[check.value];})
          .filter(Boolean).map(function (scene) {
            return {id:scene.id,title:scene.title,intent:scene.summary,prompt:scene.prompt,
              durationSeconds:scene.durationSeconds,invariantRefs:scene.invariantRefs};
          });
      }
      text='Current saved snapshot (reloaded before drafting):' +
        String.fromCharCode(10) + JSON.stringify(data,null,2) +
        String.fromCharCode(10) + 'Recent conversation context is also supplied.';
    }
    el('studio-dw-write-context').querySelector('summary').textContent =
      'Inspect draft context';
    el('studio-dw-write-context-json').textContent=text;
  }

  function updateScope() {
    var current = activeTarget();
    // The Storyboard form reuses input nodes across Projects. Do not carry a
    // "just updated" indication onto a different Project's saved fields.
    ['storyboard-story-title','storyboard-story-concept','storyboard-story-style'].forEach(function(id) {
      var field = el(id);
      if (field && field.dataset.directorUpdatedProject &&
          field.dataset.directorUpdatedProject !== current.storyId) {
        delete field.dataset.directorUpdated;
        delete field.dataset.directorUpdatedProject;
        if (field.title.startsWith('Updated by Studio Director')) field.title = '';
      }
    });
    var ready = window.studioDirectorBridge.isReady();
    el('studio-dw-current-brief').disabled = !current.storyId || !ready;
    el('studio-dw-current-prompt').disabled = !current.storyId || !current.sceneId || !ready;
    var writeId = el('studio-dw-write-project').value;
    var op = el('studio-dw-write-operation').value;
    var unresolvedScene = op === 'scene-write' && writeStory && writeStory.id === writeId &&
      !readinessStale && (recommendations.sceneId || recommendations.sceneNumber) &&
      !recommendedSceneId(writeStory);
    el('studio-dw-write-scope').textContent = [
      op !== 'new-project' && lastReadSource && writeId && lastReadSource !== writeId
        ? 'Destination differs from the last Read source.' : '',
      unresolvedScene ? 'Scene target unresolved. Select a Scene.' : ''
    ].filter(Boolean).join(' ');
    var mode = !el('studio-dw-read-panel').classList.contains('hidden') ? 'Read' :
      !el('studio-dw-write-panel').classList.contains('hidden') ? 'Write' : '';
    el('studio-dw-heading').textContent = mode ? mode + ' · Director' : 'Director actions';
    el('studio-dw-heading').title = mode === 'Read'
      ? 'Explicit source · nothing sent until Send'
      : mode === 'Write' ? 'Reviewed destination · nothing saved until Apply'
      : 'Conversation is independent of Studio navigation';
  }
  // An already-developed single Scene can enter the existing review without another Director call.
  // A deliberate manual Write choice still uses the full one-or-many drafting workflow.
  function readyNewSceneCapture() {
    return !readinessStale && !writeOperationChosen && creativeCapture &&
      creativeCapture.field === 'scene' && !creativeCapture.sceneId ? creativeCapture : null;
  }
  function setOperation() {
    var operation = el('studio-dw-write-operation').value;
    var sceneWrite = operation === 'scene-write';
    var revise = sceneWrite && el('studio-dw-scene-mode').value === 'revise';
    el('studio-dw-scene-mode-row').classList.toggle('hidden', !sceneWrite);
    el('studio-dw-batch-controls').classList.toggle('hidden', !revise);
    el('studio-dw-write-project').disabled = operation === 'new-project';
    el('studio-dw-write-prepare').textContent = sceneWrite
      ? (revise ? 'Draft Scene revisions' : readyNewSceneCapture() ? 'Review prepared Scene' : 'Draft new Scenes')
      : 'Prepare editable review';
    showWriteContext();
    updateScope();
  }
  function recommendedSceneId(story) {
    if (readinessStale || !story || !Array.isArray(story.sceneOrder)) return '';
    // If both recommendations exist, they must identify the same saved Scene.
    // A conflict means no automatic destination, not a reason to guess.
    var id = recommendations.sceneId, number = recommendations.sceneNumber;
    if (id && !story.sceneOrder.includes(id)) return '';
    if (number) {
      if (recommendationProject !== story.id || !Number.isInteger(number) ||
          number < 1 || number > story.sceneOrder.length) return '';
      var numberedId = story.sceneOrder[number - 1];
      return id && id !== numberedId ? '' : numberedId;
    }
    return id || '';
  }
  function renderWriteStory(story) {
    writeStory = story;
    if (!story) { showWriteContext(); return; }
    var batchHost = el('studio-dw-batch-scenes');
    if (sceneSelectionProject !== story.id) {
      sceneSelectionManual = false;
      sceneSelectionProject = story.id;
    }
    var checked = new Set(Array.from(batchHost.querySelectorAll('input:checked'))
      .map(function (input) {return input.value;}));
    var suggestedScene = recommendedSceneId(story);
    var hasUnresolvedHint = !readinessStale &&
      !!(recommendations.sceneId || recommendations.sceneNumber);
    if (!suggestedScene && !hasUnresolvedHint) suggestedScene = activeTarget().sceneId;
    batchHost.replaceChildren();
    (story.sceneOrder || []).forEach(function (id, index) {
      var label = document.createElement('label'), input = document.createElement('input');
      input.type = 'checkbox'; input.value = id;
      input.checked = sceneSelectionManual ? checked.has(id) : id === suggestedScene;
      input.onchange = function () { sceneSelectionManual = true; };
      label.append(input, document.createTextNode('Scene ' + (index+1) + ' · ' + (story.scenes[id].title || 'Untitled')));
      batchHost.appendChild(label);
    });
    showWriteContext();
    updateScope();
  }
  function recommendedWriteFields(operation) {
    if (readinessStale) return [];
    var allowed = operation === 'project' ? projectFields :
      ['scene-write','scene','scenes','scene-edit','scenes-batch'].includes(operation) ? sceneFields : [];
    return recommendations.writeFields.filter(function (field) { return allowed.indexOf(field) !== -1; });
  }
  function refreshRead() {
    return refreshProjects().then(function () {return loadStory(el('studio-dw-read-project').value);})
      .then(renderReadStory).catch(function (e) { status('Read setup failed: ' + e.message, true); });
  }
  function refreshWrite() {
    return refreshProjects().then(function () {return loadStory(el('studio-dw-write-project').value);})
      .then(renderWriteStory).then(function () {
        if (!writeOperationChosen) {
          var hint = recommendations.writeHint;
          if (hint === 'new-project' || hint === 'project') {
            el('studio-dw-write-operation').value = hint;
          } else if (['scene', 'scenes', 'scene-edit', 'scenes-batch'].includes(hint)) {
            el('studio-dw-write-operation').value = 'scene-write';
            el('studio-dw-scene-mode').value =
              (recommendations.sceneId || recommendations.sceneNumber || hint === 'scene-edit' || hint === 'scenes-batch') ? 'revise' : 'create';
          } else if (!projects.length) el('studio-dw-write-operation').value = 'new-project';
        }
        setOperation();
        return true;
      })
      .catch(function (e) { status('Write setup failed: ' + e.message, true); return false; });
  }
  function toggle(which) {
    var other = which === 'read' ? 'write' : 'read', panel = el('studio-dw-' + which + '-panel'),
      button = el('studio-dw-' + which), show = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !show);
    button.setAttribute('aria-expanded', show ? 'true' : 'false');
    el('studio-dw-' + other + '-panel').classList.add('hidden');
    el('studio-dw-' + other).setAttribute('aria-expanded', 'false');
    el('studio-dw-quick-' + which).setAttribute('aria-expanded', show ? 'true' : 'false');
    el('studio-dw-quick-' + other).setAttribute('aria-expanded', 'false');
    updateScope();
    if (show) return which === 'read' ? refreshRead() : refreshWrite();
  }
  function parseProposal(raw) {
    var text = String(raw || '').trim();
    if (text.slice(0,3) === '```') text = text.replace(/^\`\`\`(?:json)?/i,'').replace(/\`\`\`$/,'').trim();
    var object;
    try {
      object = JSON.parse(text);
    } catch (error) {
      // Keep the exact reply available for diagnosis; do not attempt a creative rewrite.
      var detail = 'Director returned invalid structured JSON: ' + error.message +
        '\nRaw Director response:\n' + String(raw || '');
      throw new Error(detail);
    }
    if (!object || typeof object !== 'object' || Array.isArray(object)) {
      throw new Error('Director returned JSON, but the expected top-level object is missing.\nRaw Director response:\n' + String(raw || ''));
    }
    return object;
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
        var label = document.createElement('label'), saved = document.createElement('details'),
          hint = document.createElement('summary'), before = document.createElement('pre'),
          textarea = document.createElement('textarea');
        label.textContent = labels[key];hint.textContent = 'Saved ' + labels[key];
        before.textContent = old || '(empty)'; saved.append(hint,before);
        var diff = document.createElement('details'), diffSummary = document.createElement('summary'), diffBody = document.createElement('div');
        diff.className = 'studio-director-diff'; diffSummary.textContent = 'What changes?';
        diff.open = old !== candidate[key];
        diffBody.className = 'studio-director-diff-content';
        window.studioDirectorRenderDiff(diffBody,old,candidate[key]);
        diff.append(diffSummary,diffBody);
        textarea.dataset.field = key;textarea.value = candidate[key];
        textarea.addEventListener('input',function(){window.studioDirectorRenderDiff(diffBody,old,textarea.value);});textarea.rows = key === 'prompt' ? 13 : 5;
        textarea.setAttribute('aria-label',labels[key]);
        label.append(textarea);host.append(saved,diff,label);
      });
      el('studio-dw-scene-target').textContent = storyName(story) + ' · ' + (scene.title || sceneId);
      el('studio-dw-scene-review-title').textContent = fields.length === 1 ? 'Review ' + labels[fields[0]] : 'Review Scene changes';
      el('studio-dw-scene-summary').textContent = 'Selected: ' + fields.map(function(key){return labels[key];}).join(' · ') +
        ' · Scene duration: ' + scene.durationSeconds + ' seconds';
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
        var scene = story.scenes && story.scenes[sceneTarget];
        if (!scene || !story.sceneOrder.includes(sceneTarget)) throw new Error('Select a saved Scene to review.');
        var draft = {sceneId:sceneTarget};
        draft[capture.field] = capture.content;
        proposedBatch = {storyId:story.id,scenes:[{sceneId:sceneTarget,
          before:{position:story.sceneOrder.indexOf(sceneTarget)+1,title:scene.title,summary:scene.summary,prompt:scene.prompt},
          draft:draft}]};
        renderBatchReview();
      }).catch(function (error) {
        status('Creative Scene review failed: ' + String(error.message || error), true);
      }).finally(function () {el('studio-dw-write-prepare').disabled = false;});
  }
  function openWriteForCapture() {
    el('director-chat-drawer').classList.add('studio-actions-open');
    if (el('studio-dw-write-panel').classList.contains('hidden')) el('studio-dw-write').click();
    refreshWrite();
  }
  function prepareCurrentWrite(operation) {
    var target = activeTarget();
    if (!window.studioDirectorBridge.isReady()) { status('Finish the current request and choose a Director model before drafting.', false); return; }
    el('studio-dw-current-brief').disabled = true;
    el('studio-dw-current-prompt').disabled = true;
    return refreshProjects().then(function () {
      el('studio-dw-write-project').value = target.storyId;
      el('studio-dw-write-operation').value = operation;
      writeOperationChosen = true;
      return loadStory(target.storyId);
    }).then(function (story) {
      renderWriteStory(story);
      if (operation === 'scene-write') {
        el('studio-dw-scene-mode').value = 'revise';
        Array.from(el('studio-dw-batch-scenes').querySelectorAll('input')).forEach(function (check) {
          check.checked = check.value === target.sceneId;
        });
        sceneSelectionManual = true; // "Revise current Scene" was an explicit choice.
        sceneSelectionProject = story.id;
      }
      el('studio-dw-read-panel').classList.add('hidden');
      el('studio-dw-read').setAttribute('aria-expanded','false');
      el('studio-dw-write-panel').classList.remove('hidden');
      el('studio-dw-write').setAttribute('aria-expanded','true');
      setOperation();
      writePrepare();
    }).catch(function (error) {status('Current Project draft failed: ' + error.message,true);})
      .finally(updateScope);
  }
  function writePrepare() {
    var bridge = window.studioDirectorBridge;
    var operation = el('studio-dw-write-operation').value;
    var id = el('studio-dw-write-project').value;
    if (!bridge.isReady()) {status('Choose a Director model first.',true);return;}
    if (operation !== 'new-project' && !id) {status('Choose a destination Project.',true);return;}
    if (operation === 'scene-write') {
      if (el('studio-dw-scene-mode').value === 'revise') return prepareBatchScenes(id);
      var capturedScene = readyNewSceneCapture();
      if (capturedScene) return reviewCreativeCapture(capturedScene);
      try {
        var selected = projects.find(function (p) {return p.id === id;});
        bridge.prepareWrite('scenes', id, selected && storyName(selected));
        status('Preparing new Scenes for reviewed insertion.', false);
      } catch (error) {status('Write Scenes failed: ' + error.message, true);}
      return;
    }
    if (operation !== 'new-project' && operation !== 'project')
      throw new Error('Unsupported Studio creative Write goal: ' + operation);
    try {
      var item = projects.find(function (p) {return p.id === id;});
      bridge.prepareWrite(operation, id, item && storyName(item));
      status('Preparing a reviewed proposal. No saved fields have changed.', false);
    } catch (error) {status('Write failed: ' + error.message, true);}
  }
  function prepareProjectCoherence(storyId) {
    var button = el('studio-dw-write-prepare');
    button.disabled = true;
    status('Checking saved H3 Prompts across the selected Project. Nothing will be saved.', false);
    var originalStory;
    Promise.resolve().then(function () {
      return window.flushStudioDirectorStoryEdits(storyId);
    }).then(function () {
      return loadStory(storyId);
    }).then(function (story) {
      var ids = story.sceneOrder || [];
      if (!ids.length) throw new Error('This Project has no Scenes to check.');
      if (ids.some(function (id) {
        return !story.scenes || !story.scenes[id] || !String(story.scenes[id].prompt || '').trim();
      })) throw new Error('Check Coherence requires a saved H3 Prompt in every Scene.');
      originalStory = story;
      return window.studioDirectorBridge.checkProjectCoherence(storyId);
    }).then(function (result) {
      return loadStory(storyId).then(function (fresh) {
        if (fresh.updatedAt !== originalStory.updatedAt)
          throw new Error('The Project changed during coherence analysis. Run the check again before reviewing changes.');
        var ids = originalStory.sceneOrder || [], seen = new Set();
        if (result.scenes.length !== ids.length)
          throw new Error('Coherence analysis did not return every Scene.');
        var changed = result.scenes.filter(function (entry) {
          if (!entry || !ids.includes(entry.sceneId) || seen.has(entry.sceneId) ||
              typeof entry.originalPrompt !== 'string' || typeof entry.prompt !== 'string' ||
              !entry.prompt.trim() || entry.originalPrompt !== originalStory.scenes[entry.sceneId].prompt) {
            throw new Error('Coherence analysis returned mismatched Scene prompts.');
          }
          seen.add(entry.sceneId);
          return entry.prompt !== entry.originalPrompt;
        });
        if (seen.size !== ids.length) throw new Error('Coherence analysis omitted a Scene.');
        if (!changed.length) {
          status('Checked ' + ids.length + ' Scenes; no H3 Prompt changes proposed.', false);
          return;
        }
        proposedBatch = {
          storyId:storyId,
          fields:['prompt'],
          scenes:changed.map(function (entry) {
            var scene = originalStory.scenes[entry.sceneId];
            return {
              sceneId:entry.sceneId,
              before:{sceneId:entry.sceneId,position:ids.indexOf(entry.sceneId)+1,
                title:scene.title,summary:scene.summary,prompt:scene.prompt},
              draft:{sceneId:entry.sceneId,prompt:entry.prompt}
            };
          })
        };
        renderBatchReview();
        status('Coherence check proposed H3 Prompt changes for ' + changed.length +
          ' of ' + ids.length + ' Scenes. Review before applying.', false);
      });
    }).catch(function (error) {
      status('Project coherence check failed: ' + String(error.message || error), true);
    }).finally(function () {button.disabled = false;});
  }
  // Validate model-produced revisions before presenting them for review. The saved
  // Scene identity and untouched fields remain authoritative.
  function validateSceneRevisionDraft(result, ids, selected, raw) {
    if (!Array.isArray(result.scenes) || result.scenes.length !== ids.length)
      throw new Error('Director returned ' + (Array.isArray(result.scenes) ? result.scenes.length : 'no') +
        ' Scenes; expected ' + ids.length + '.\nRaw Director response:\n' + raw);
    var seen = new Set();
    result.scenes.forEach(function (candidate, index) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
        throw new Error('Director Scene ' + (index + 1) + ' is not an object.\nRaw Director response:\n' + raw);
      if (!ids.includes(candidate.sceneId) || seen.has(candidate.sceneId))
        throw new Error('Director returned a missing, duplicate, or unknown Scene ID at record ' +
          (index + 1) + ': ' + String(candidate.sceneId) + '.\nRaw Director response:\n' + raw);
      seen.add(candidate.sceneId);
      Object.keys(candidate).forEach(function (key) {
        if (key === 'sceneId') return;
        if (!sceneFields.includes(key) || typeof candidate[key] !== 'string' ||
            !candidate[key].trim())
          throw new Error('Director returned invalid Scene field "' + key +
            '" for Scene ' + candidate.sceneId + ' (allowed: title, summary, prompt; nonempty strings).\nRaw Director response:\n' + raw);
      });
    });
    return ids.map(function (id) {
      var before = selected.find(function (row) {return row.sceneId === id;});
      var response = result.scenes.find(function (row) {return row.sceneId === id;});
      var changed = {sceneId:id};
      sceneFields.forEach(function (field) {
        if (Object.prototype.hasOwnProperty.call(response, field) &&
            response[field] !== String(before[field] || '')) changed[field] = response[field];
      });
      return {sceneId:id, before:before, draft:changed};
    }).filter(function (entry) {return Object.keys(entry.draft).length > 1;});
  }
  function prepareBatchScenes(storyId) {
    var ids = Array.from(el('studio-dw-batch-scenes').querySelectorAll('input:checked'))
      .map(function (node) {return node.value;});
    if (!ids.length || ids.length > 32) {
      status('Choose one to 32 Scenes to revise.', true);
      return;
    }
    var button = el('studio-dw-write-prepare');
    button.disabled = true;
    status('Director is developing the selected Scenes together…', false);
    Promise.resolve().then(function () {
      return window.flushStudioDirectorStoryEdits(storyId);
    }).then(function () {return loadStory(storyId);})
      .then(function (story) {
        window.studioDirectorBridge.selectWriteProject(story.id, storyName(story));
        var selected = ids.map(function (id) {
          var scene = story.scenes && story.scenes[id];
          if (!scene || (story.sceneOrder || []).indexOf(id) === -1)
            throw new Error('A selected Scene no longer exists.');
          return {sceneId:id, position:(story.sceneOrder || []).indexOf(id) + 1,
            title:scene.title, summary:scene.summary, prompt:scene.prompt,
            durationSeconds:scene.durationSeconds, invariantRefs:scene.invariantRefs};
        });
        var suggested = recommendedSceneId(story);
        var targetWarning = suggested && !ids.includes(suggested)
          ? 'Director suggested Scene ' + (story.sceneOrder.indexOf(suggested) + 1) + ' · ' +
            (story.scenes[suggested].title || 'Untitled') +
            ', but Write targets ' + ids.map(function (id) {
              return 'Scene ' + (story.sceneOrder.indexOf(id) + 1);
            }).join(', ') + '. Confirm that this is intentional.' : '';
        var history = window.studioDirectorBridge.messages().filter(function (message) {
          return message && (message.role === 'user' || message.role === 'assistant');
        }).map(function (message) {
          return {role:message.role, text:String(message.content || '')};
        });
        var request = [
          ids.length === 1
            ? 'Revise the one selected existing Scene (' + ids[0] + ') according to the agreed creative discussion.'
            : 'Revise the selected existing Scenes according to the agreed creative discussion.',
          'Return ONLY a JSON object with a scenes array, with one entry per selected Scene ID in the same order.',
          'Each entry includes its exact saved sceneId and the complete final text of whichever fields need changing: title, summary (Scene Intent), and/or prompt (H3 Prompt). Omit unchanged fields.',
          'Consider Title, Intent and H3 Prompt together as one Scene. Align the affected parts with the agreed change, preserving parts that remain appropriate and respecting any explicit limits from the author.',
          ids.length === 1
            ? 'Example of an Intent-only revision for this Scene: ' + JSON.stringify({scenes:[{sceneId:ids[0],summary:'complete revised Scene Intent'}]}) + '. For a prompt-only revision, use prompt instead of summary.'
            : 'For each selected Scene, return only the relevant changed fields. Every entry must use its corresponding saved sceneId.',
          'Use the saved Scene values as the baseline. Return complete replacement text for changed fields; omit unchanged fields. If no changes are needed, return only sceneId.',
          'Preserve unrelated creative content and untouched Scene fields.',
          'Project context: '+JSON.stringify({id:story.id,concept:story.concept,style:story.style,invariants:story.invariants}),
          'Selected Scenes: '+JSON.stringify(selected),
          'Creative discussion: '+JSON.stringify(history),
          'For H3 Prompt revisions, time each Scene to its durationSeconds and preserve linked Character/Location Invariants. Duration and links remain read-only context.'
        ].join('\n');
        return window.studioDirectorBridge.makeProposal(request, 'studio_scene_batch_draft', true)
          .then(function (raw) {
            var result = parseProposal(raw);
            proposedBatch = {storyId:storyId, targetWarning:targetWarning,
              scenes:validateSceneRevisionDraft(result, ids, selected, raw)};
            if (!proposedBatch.scenes.length) {
              proposedBatch = null;
              status('Director proposed no changes to the selected Scenes.', false);
              return;
            }
            renderBatchReview();
          });
      }).catch(function (error) {
        status('Scene revision draft failed: ' + String(error.message || error), true);
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
      var unchanged = document.createElement('details'), unchangedTitle = document.createElement('summary');
      unchangedTitle.textContent = 'Other parts';
      unchangedTitle.title = 'Parts retained by Director; expand to inspect or edit.';
      unchanged.appendChild(unchangedTitle);
      ['title','summary','prompt'].forEach(function (field) {
        var row = document.createElement('div'), selection = document.createElement('label'), checkbox = document.createElement('input'),
          editor = document.createElement('textarea'), old = entry.before[field] || '';
        var value = Object.prototype.hasOwnProperty.call(entry.draft, field) ? entry.draft[field] : old;
        row.className = 'studio-dw-review-part';
        checkbox.type = 'checkbox';
        checkbox.dataset.selectField = field;
        checkbox.checked = value !== old;
        editor.dataset.field = field;
        editor.value = value;
        editor.setAttribute('aria-label',labels[field]);
        editor.rows = field === 'prompt' ? 12 : field === 'title' ? 1 : 4;
        editor.addEventListener('input', function () {
          checkbox.checked = true;
          window.studioDirectorRenderDiff(diffBody,old,editor.value);
        });
        var name = document.createElement('strong'), saved = document.createElement('details'),
          savedTitle = document.createElement('summary'), before = document.createElement('pre');
        name.textContent = labels[field];
        checkbox.setAttribute('aria-label','Include ' + labels[field] + ' change');
        savedTitle.textContent = 'Saved ' + labels[field];
        before.textContent = old || '(empty)';
        saved.append(savedTitle,before);
        var diff = document.createElement('details'), diffSummary = document.createElement('summary');
        let diffBody = document.createElement('div');
        diff.className = 'studio-director-diff'; diffSummary.textContent = 'What changes?';
        diff.open = old !== value;
        diffBody.className = 'studio-director-diff-content';
        window.studioDirectorRenderDiff(diffBody,old,value);
        diff.append(diffSummary,diffBody);
        selection.append(checkbox,name);
        row.append(selection,diff,saved,editor);
        if (checkbox.checked) section.appendChild(row);
        else unchanged.appendChild(row);
      });
      if (unchanged.children.length > 1) section.appendChild(unchanged);
      host.appendChild(section);
    });
    el('studio-dw-batch-target-warning').textContent = proposedBatch.targetWarning || '';
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
    if (draft.targetWarning && !window.confirm(draft.targetWarning + '\nApply to the selected Scenes anyway?')) return;
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
    renderReadiness(readiness);
    if (!el('studio-dw-write-panel').classList.contains('hidden')) setOperation();
    var label = el('studio-dw-readiness-freshness');
    label.textContent = readinessStale ? 'Outdated' : readiness.length ? 'Current' : 'No assessment';
    var empty = el('studio-dw-readiness-list').querySelector('p');
    if (empty) empty.textContent = readinessStale ? 'No current assessment.' : 'Not assessed yet';
  }
  function openRecommendedWrite() {
    var hint = recommendations.writeHint;
    if (!hint) return;
    var operation = ['scene', 'scenes', 'scene-edit', 'scenes-batch'].includes(hint)
      ? 'scene-write' : hint;
    var select = el('studio-dw-write-operation');
    if (!Array.from(select.options).some(function (item) {return item.value === operation;})) {
      status('The recommended Studio operation is not available.', true);
      return;
    }
    select.value = operation;
    if (operation === 'scene-write') el('studio-dw-scene-mode').value =
      (recommendations.sceneId || recommendations.sceneNumber || hint === 'scene-edit' || hint === 'scenes-batch') ? 'revise' : 'create';
    writeOperationChosen = true;
    sceneSelectionManual = false; // Explicitly follow Director's proposed Write target.
    var setup = el('studio-dw-write-panel').classList.contains('hidden') ? toggle('write') : refreshWrite();
    return setup.then(function (ready) {
      if (ready) writePrepare();
    });
  }
  function captureActionLabel(capture) {
    return capture.field === 'scene' ? 'Review new Scene' :
      ['summary','prompt'].includes(capture.field) ? 'Review Scene' : 'Review Project Overview';
  }
  function writeActionLabel() {
    var hint = recommendations.writeHint;
    if (hint === 'new-project') return 'Create Project';
    if (hint === 'project') return 'Revise Project Overview';
    if (['scene', 'scenes', 'scene-edit', 'scenes-batch'].includes(hint))
      return recommendations.sceneNumber ? 'Draft Scene ' + recommendations.sceneNumber :
        recommendations.sceneId ? 'Draft Scene revisions' : 'Draft Scenes';
    return '';
  }
  function renderReadiness(list) {
    var actions = el('studio-dw-suggestions');
    var assessment = el('studio-dw-readiness-list');
    actions.replaceChildren();
    assessment.replaceChildren();
    var available = [];
    if (!readinessStale && creativeCapture) available.push({
      kind:'capture', label:captureActionLabel(creativeCapture),
      run:function () { reviewCreativeCapture(creativeCapture); }
    });
    if (!readinessStale && recommendations.writeHint) {
      var fields = recommendedWriteFields(recommendations.writeHint);
      var captureField = creativeCapture && creativeCapture.field === 'invariant' ? 'invariants' :
        creativeCapture && creativeCapture.field;
      var sceneHint = ['scene', 'scenes', 'scene-edit', 'scenes-batch'].includes(recommendations.writeHint);
      var sameTarget = creativeCapture && (sceneHint
        ? recommendations.sceneId === creativeCapture.sceneId
        : recommendations.writeHint === 'project' && projectFields.includes(captureField));
      var duplicatesCapture = sameTarget && fields.length > 0 && fields.every(function (field) {
        return field === captureField || (creativeCapture.field === 'scene' && ['title','summary'].includes(field));
      });
      var label = writeActionLabel();
      if (label && !duplicatesCapture) available.push({
        kind:'write', label:label, run:openRecommendedWrite
      });
    }
    available.slice(0,1).forEach(function (action) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'studio-dw-suggestion-action';
      button.dataset.suggestionKind = action.kind;
      if (action.kind === 'capture') button.dataset.captureAction = 'true';
      if (action.kind === 'write') button.dataset.guidedWrite = 'true';
      button.textContent = action.label;
      button.onclick = action.run;
      actions.appendChild(button);
    });
    window.studioDirectorBridge.placeSuggestedAction(actions);
    if (!list.length) {
      var empty = document.createElement('p');
      empty.textContent = readinessStale ? 'No current assessment.' : 'No assessment details yet.';
      assessment.appendChild(empty);
      return;
    }
    list.forEach(function (item) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'studio-dw-assessment-item';
      var subject = item.scope === 'project' ? 'Project' : 'Scene (current discussion)';
      button.textContent = (item.ready ? '✓ ' : '○ ') + subject + ' · ' + item.name;
      button.title = 'Inspect Director assessment details';
      button.onclick = function () {
        el('studio-dw-assessment-title').textContent = subject + ' · ' + item.name +
          (item.ready ? ' · developed' : ' · needs development');
        el('studio-dw-assessment-content').textContent = item.content;
        el('studio-dw-assessment-dialog').showModal();
      };
      assessment.appendChild(button);
    });
  }
  window.studioDirectorWorkbench = {
    setStatus:status,
    markSavedFields:function(selected,story){
      if (!story || !story.id) throw new Error('Field update feedback needs the saved Project identity.');
      var values=selected.savedFields || selected.fields || selected;
      var keys=Object.keys(values).filter(function(key){return ['title','concept','style','invariants','summary','prompt'].includes(key);});
      if (selected.scenes && typeof selected.scenes==='object') keys.push('Scene revisions');
      var descriptions={title:'Title',concept:'Concept',style:'Visual / atmosphere',invariants:'Invariants',summary:'Scene Intent',prompt:'H3 Prompt'};
      var label=keys.map(function(key){return descriptions[key] || key;}).join(', ');
      ['studio-dw-write','studio-dw-quick-write'].forEach(function(id){
        var button=el(id);
        button.dataset.result='success';
        button.title='Saved to ' + storyName(story) + ': ' + (label || 'reviewed changes');
      });
      window.reportConsoleInfo('Studio Director', 'Saved to ' + storyName(story) + ': ' + (label || 'reviewed changes'));
      if (activeTarget().storyId !== story.id) return;
      [['title','storyboard-story-title'],['concept','storyboard-story-concept'],['style','storyboard-story-style']].forEach(function(item){
        if (!keys.includes(item[0])) return;
        var input=el(item[1]);
        if (input) {
          input.dataset.directorUpdated='true';
          input.dataset.directorUpdatedProject=story.id;
          input.title='Updated by Studio Director — ' + descriptions[item[0]];
          if (!input.dataset.directorUpdateListener) {
            input.dataset.directorUpdateListener='true';
            input.addEventListener('input',function(){
              delete input.dataset.directorUpdated;
              delete input.dataset.directorUpdatedProject;
              if (input.title.startsWith('Updated by Studio Director')) input.title='';
            });
          }
        }
      });
    },
    setReadStatus:function(state,detail){
      ['studio-dw-read','studio-dw-quick-read'].forEach(function(id){
        var button=el(id);
        button.dataset.result=state;
        button.title=detail || 'Read selected Project fields';
      });
    },
    reviewGeneratedCapture:reviewCreativeCapture,
    updateContext:updateScope,
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
      sceneSelectionManual = false;
      sceneSelectionProject = '';
      recommendationProject = '';
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
      var operations = ['', 'project','new-project','scene','scenes','scene-edit','scenes-batch','scene-move','scene-duplicate','scene-split','scene-invariants','playbook','coherence-check'];
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
      var sceneNumber = result && result.sceneNumber === undefined ? 0 : result.sceneNumber;
      var allowedWriteFields = writeHint === 'project' ? projectFields :
        ['scenes', 'scene-edit', 'scenes-batch'].includes(writeHint) ? sceneFields : [];
      if (!Array.isArray(hints) || hints.length > 15 ||
          hints.some(function(key) {return typeof key !== 'string' || key.length > 120;}) ||
          operations.indexOf(writeHint) < 0 || typeof sceneId !== 'string' || sceneId.length > 160 ||
          !Number.isInteger(sceneNumber) || sceneNumber < 0 || sceneNumber > 10000 ||
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
      recommendations = {readHints:hints, writeHint:writeHint, writeFields:writeFields,
        sceneId:sceneId, sceneNumber:sceneNumber};
      recommendationProject = window.studioDirectorBridge.workingStoryId() || activeTarget().storyId || '';
      creativeCapture = capture;
      readiness = list;
      setReadinessFreshness(!!(restoring && result && result.stale));
      renderReadiness(list);
      if (!restoring) window.studioDirectorBridge.updateReadiness({
        checks:list,readHints:hints,writeHint:writeHint,writeFields:writeFields,
        sceneId:sceneId,sceneNumber:sceneNumber,stale:false,
        ...(capture ? {capture:capture} : {})
      });
      return true;
    }
  };

  function bind() {
    var rail = el('studio-director-workbench');if (!rail) return;
    el('studio-dw-read').onclick=function () { toggle('read'); };
    el('studio-dw-write').onclick=function () { toggle('write'); };
    el('studio-dw-current-brief').onclick=function () {return prepareCurrentWrite('project');};
    el('studio-dw-current-prompt').onclick=function () {return prepareCurrentWrite('scene-write');};
    el('studio-dw-read-project').onchange=function () {
      loadStory(this.value).then(renderReadStory).catch(function(e) { status(e.message,true); });
    };
    el('studio-dw-write-project').onchange=function () {
      loadStory(this.value).then(renderWriteStory).catch(function(e) { status(e.message,true); });
    };
    el('studio-dw-write-operation').onchange=function () {
      writeOperationChosen = true;
      return refreshWrite();
    };
    el('studio-dw-scene-mode').onchange=function () {
      writeOperationChosen = true;
      setOperation();
    };
    el('studio-dw-coherence-check').onclick=function () {
      var id = el('studio-dw-write-project').value;
      if (!id) {status('Choose a Project to check.',true);return;}
      if (!window.studioDirectorBridge.isReady()) {status('Choose a Director model first.',true);return;}
      prepareProjectCoherence(id);
    };
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
    el('studio-dw-undo-button').onclick=function () {
      if (window.confirm('Revert the latest reviewed Project Overview update? The saved Concept, Visual / atmosphere and/or Invariants changed by that update will be restored to their previous values.'))
        window.studioDirectorBridge.undoBrief();
    };
    el('studio-dw-assessment-close').onclick=function(){el('studio-dw-assessment-dialog').close();};
    el('studio-dw-read-send').onclick=readSend;
    el('studio-dw-read-all').onclick=selectEntireReadProject;
    el('studio-dw-write-prepare').onclick=writePrepare;
    el('studio-dw-scene-apply').onclick=applyScene;
    el('studio-dw-batch-apply').onclick=applyBatchScenes;
    ['studio-dw-batch-close','studio-dw-batch-cancel'].forEach(function (id) {
      el(id).onclick=function () {el('studio-dw-batch-review').close();};
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
