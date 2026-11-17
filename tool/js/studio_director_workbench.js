(function () {
  'use strict';
  var readStory = null, writeStory = null, projects = [], proposedScene = null, proposedBatch = null;
  var readChoices = {}, writeOperationChosen = false, lastReadSource = null;
  var sceneSelectionManual = false, sceneSelectionProject = '';
  var lastQuickAction = 'write';
  var sceneFields = ['prompt', 'title', 'durationSeconds'];
  var projectFields = ['title', 'concept', 'style', 'invariants'];
  var labels = {title:'Title', concept:'Concept', style:'Visual / atmosphere',
    invariants:'Invariants', invariant:'Invariant', scene:'New Scene', prompt:'H3 Prompt',
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
  function status(message, error, showSuccess) {
    var node = el('studio-dw-status');
    if (node) {
      node.textContent = (error || showSuccess) ? (message || '') : '';
      node.dataset.error = error ? 'true' : 'false';
      node.classList.toggle('hidden', !message || (!error && !showSuccess));
    }
    if (error) {
      el('director-chat-drawer').classList.add('studio-actions-open');
      el('studio-dw-open-tools').setAttribute('aria-expanded','true');
      window.reportConsoleError('Studio Director workbench', new Error(message));
    }
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
    var route = activeTarget();
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
    addUnit('Overview', overview, fields, true);
    // An individual Invariant can be shared without sharing the entire Overview.
    (story.invariants || []).forEach(function (item) {
      var key = 'invariant:' + encodeURIComponent(item.kind) + ':' + encodeURIComponent(item.title);
      addUnit('Invariant · ' + (item.title || 'Untitled'), [key], fields, false);
    });
    (story.sceneOrder || []).forEach(function (id, index) {
      var scene = story.scenes && story.scenes[id];
      if (!scene) throw new Error('Project has a Scene index with no matching Scene.');
      // Once authored, the complete H3 Prompt replaces the separate outline in Director context.
      var contextFields = ['title', 'prompt', 'durationSeconds'];
      var paths = contextFields.map(function (field) {
        return 'scene:' + id + ':' + field;
      });
      var suggested = route.storyId === story.id && route.sceneId === id;
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
        } else if (parts[0] === 'invariant' && parts.length === 3) {
          var kind = decodeURIComponent(parts[1]), title = decodeURIComponent(parts[2]);
          value = (story.invariants || []).find(function (item) {
            return item.kind === kind && item.title === title;
          });
          if (!value) throw new Error('Selected Invariant is no longer in this Project: ' + key);
        } else {
          if (parts.length !== 3 || parts[0] !== 'scene' ||
              ['title','prompt','durationSeconds'].indexOf(parts[2]) === -1 ||
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
    var toggles = Array.from(el('studio-dw-read-panel').querySelectorAll('input[data-group-select]'));
    var overview = toggles.some(function (toggle) {return toggle.checked && toggle.groupPaths[0].startsWith('project.');});
    var sceneCount = toggles.filter(function (toggle) {return toggle.checked && toggle.groupPaths[0].startsWith('scene:');}).length;
    var invariantCount = toggles.filter(function (toggle) {return toggle.checked && toggle.groupPaths[0].startsWith('invariant:');}).length;
    el('studio-dw-read-selection-summary').textContent = units && units === toggles.length ? 'Entire Project' :
      [overview ? 'Overview' : '', invariantCount ? invariantCount + (invariantCount === 1 ? ' Invariant' : ' Invariants') : '',
        sceneCount ? sceneCount + (sceneCount === 1 ? ' Scene' : ' Scenes') : '']
        .filter(Boolean).join(' + ') || 'Choose material';
    el('studio-dw-read-count').textContent = units +
      (units === 1 ? ' selection' : ' selections') + ' · ' + bytes.toLocaleString() + ' characters';
    el('studio-dw-read-send').disabled = !keys.length || !el('studio-dw-read-project').value;
    el('studio-dw-read-all').disabled = !readStory || !el('studio-dw-read-project').value;
    var details = el('studio-dw-read-preview');
    if (details.open && readStory) el('studio-dw-read-preview-data').textContent =
      JSON.stringify(readPayload(readStory, keys), null, 2);
  }
  function readSend(instruction) {
    var id = el('studio-dw-read-project').value, keys = selectedPaths();
    if (!id || !keys.length) { status('Choose a Project and at least one field.', true); return; }
    el('studio-dw-read-send').disabled = true;
    window.studioDirectorWorkbench.setReadStatus('working','Preparing saved context selection…');
    // Same exact serializer drives the inspector and the outbound LLM message.
    loadStory(id).then(function (story) {
      var payload = readPayload(story, keys);
      el('studio-dw-read-preview-data').textContent = JSON.stringify(payload, null, 2);
      window.studioDirectorBridge.approveRead(story.id, keys);
      renderApprovedSources();
      lastReadSource = story.id;
      status('Context approved for subsequent Director messages. No model request sent.', false, true);
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
          return {id:id,position:index+1,title:scene.title,prompt:scene.prompt};
        });
      }
      if (revisingScenes) {
        data.selectedScenes = Array.from(el('studio-dw-batch-scenes').querySelectorAll('input:checked'))
          .map(function (check) {return p.scenes && p.scenes[check.value];})
          .filter(Boolean).map(function (scene) {
            return {id:scene.id,title:scene.title,prompt:scene.prompt,
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
    var mode = !el('studio-dw-read-panel').classList.contains('hidden') ? 'Read' :
      !el('studio-dw-write-panel').classList.contains('hidden') ? 'Write' : '';
    el('studio-dw-heading').textContent = 'Write';
    el('studio-dw-heading').title = mode === 'Read'
      ? 'Explicit source · nothing sent until Send'
      : mode === 'Write' ? 'Reviewed destination · nothing saved until Apply'
      : 'Conversation is independent of Studio navigation';
  }
  function manualSceneInstruction() {
    return el('studio-dw-write-instruction').value.trim();
  }
  function seedManualSceneInstruction() {
    var input = el('studio-dw-write-instruction');
    if (input.dataset.instructionSeeded === 'true') return;
    input.dataset.instructionSeeded = 'true';
    var messages = window.studioDirectorBridge.messages().filter(function (message) {
      return message.role === 'user' &&
        !String(message.content || '').includes('[WEBCAP APPLIED FIELD VALUES]');
    });
    input.value = String(messages.length && messages[messages.length - 1].content || '').trim();
  }
  function setOperation() {
    var operation = el('studio-dw-write-operation').value;
    var sceneWrite = operation === 'scene-write';
    var revise = sceneWrite && el('studio-dw-scene-mode').value === 'revise';
    el('studio-dw-scene-mode-row').classList.toggle('hidden', !sceneWrite);
    el('studio-dw-write-instruction-row').classList.toggle('hidden', !sceneWrite);
    el('studio-dw-batch-controls').classList.toggle('hidden', !revise);
    el('studio-dw-write-project').disabled = operation === 'new-project';
    el('studio-dw-write-prepare').textContent = sceneWrite
      ? (revise ? 'Revise selected Scenes · Save' : 'Create Scene · Save')
      : (operation === 'new-project' ? 'Create Project · Save' : 'Revise Overview · Save');
    showWriteContext();
    updateScope();
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
    var route = activeTarget();
    var suggestedScene = route.storyId === story.id ? route.sceneId : '';
    batchHost.replaceChildren();
    (story.sceneOrder || []).forEach(function (id, index) {
      var label = document.createElement('label'), input = document.createElement('input');
      input.type = 'checkbox'; input.value = id;
      input.checked = sceneSelectionManual ? checked.has(id) : id === suggestedScene;
      input.onchange = function () {
        sceneSelectionManual = true;
        if (pendingCreativeAction && pendingCreativeAction.kind === 'write_scenes')
          pendingCreativeAction.chosenSceneIds = Array.from(
            el('studio-dw-batch-scenes').querySelectorAll('input:checked')
          ).map(function (node) {return node.value;});
      };
      label.append(input, document.createTextNode('Scene ' + (index+1) + ' · ' + (story.scenes[id].title || 'Untitled')));
      batchHost.appendChild(label);
    });
    showWriteContext();
    updateScope();
  }
  function selectWriteScenes(checked) {
    var inputs = Array.from(el('studio-dw-batch-scenes').querySelectorAll('input[type="checkbox"]'));
    inputs.forEach(function (input) { input.checked = checked; });
    sceneSelectionManual = true;
    if (pendingCreativeAction && pendingCreativeAction.kind === 'write_scenes')
      pendingCreativeAction.chosenSceneIds = checked ? inputs.map(function (input) { return input.value; }) : [];
    showWriteContext();
  }
  function renderApprovedSources() {
    var host = el('studio-dw-approved-sources');
    host.replaceChildren();
    window.studioDirectorBridge.approvedReadSources().forEach(function (source) {
      var row = document.createElement('div');
      row.className = 'studio-dw-approved-source';
      var label = document.createElement('span');
      label.textContent = source.label;
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Remove';
      button.title = 'Stop sharing this Project source';
      button.onclick = function () {
        window.studioDirectorBridge.removeApprovedRead(source.projectId);
        renderApprovedSources();
        status('Selected source removed; other approved sources retained.',false,true);
      };
      row.append(label,button);
      host.appendChild(row);
    });
  }
  function refreshRead() {
    renderApprovedSources();
    return refreshProjects().then(function () {return loadStory(el('studio-dw-read-project').value);})
      .then(renderReadStory).catch(function (e) { status('Read setup failed: ' + e.message, true); });
  }
  function refreshWrite() {
    return refreshProjects().then(function () {return loadStory(el('studio-dw-write-project').value);})
      .then(renderWriteStory).then(function () {
        if (!writeOperationChosen) {
          var route = activeTarget();
          if (!projects.length) el('studio-dw-write-operation').value = 'new-project';
          else if (writeStory && route.storyId === writeStory.id && route.sceneId) {
            el('studio-dw-write-operation').value = 'scene-write';
            el('studio-dw-scene-mode').value = 'revise';
          } else el('studio-dw-write-operation').value = 'project';
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
  function showSceneReview(story, sceneId, fields, candidate, options) {
    var scene = story.scenes && story.scenes[sceneId];
    if (!scene || (story.sceneOrder || []).indexOf(sceneId) === -1)
      throw new Error('Select a saved Scene to review.');
    fields.forEach(function (key) {
      if (key === 'durationSeconds') {
        if (!Number.isInteger(candidate[key])) throw new Error('Director did not supply a numeric Scene duration.');
      } else if (!['title','prompt'].includes(key) || typeof candidate[key] !== 'string')
        throw new Error('Director did not supply complete ' + key + ' material.');
    });
      proposedScene = {storyId:story.id,sceneId:sceneId,expected:{},fields:fields};
      var host = el('studio-dw-scene-editors');host.replaceChildren();
      fields.forEach(function (key) {
        var old = String(scene[key] == null ? '' : scene[key]);
        proposedScene.expected[key] = scene[key];
        var label = document.createElement('label'), saved = document.createElement('details'),
          hint = document.createElement('summary'), before = document.createElement('pre'),
          textarea = document.createElement(key === 'durationSeconds' ? 'input' : 'textarea');
        label.textContent = labels[key];hint.textContent = 'Saved ' + labels[key];
        before.textContent = old || '(empty)'; saved.append(hint,before);
        var diff = document.createElement('details'), diffSummary = document.createElement('summary'), diffBody = document.createElement('div');
        diff.className = 'studio-director-diff'; diffSummary.textContent = 'What changes?';
        var editableValue = options && options.values &&
          Object.prototype.hasOwnProperty.call(options.values,key)
          ? options.values[key] : candidate[key];
        diff.open = old !== String(editableValue);
        diffBody.className = 'studio-director-diff-content';
        window.studioDirectorRenderDiff(diffBody,old,String(editableValue));
        diff.append(diffSummary,diffBody);
        textarea.dataset.field = key;
        if (key === 'prompt') textarea.dataset.revisionKey = 'project:' + story.id + ':scene:' + sceneId + ':field:' + key;
        textarea.value = editableValue;
        if (key === 'durationSeconds') {textarea.type='number';textarea.min=4;textarea.max=15;textarea.step=1;}
        textarea.addEventListener('input',function(){
          window.studioDirectorRenderDiff(diffBody,old,textarea.value);
          if (options && options.onEdit) options.onEdit(key,textarea.value);
        });
        if (key !== 'durationSeconds') textarea.rows = key === 'prompt' ? 13 : 5;
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

  function openWriteForCapture() {
    el('director-chat-drawer').classList.add('studio-actions-open');
    el('studio-dw-open-tools').setAttribute('aria-expanded','true');
    // Keep the existing Scene checklist when a conversational action needs targets.
    if (pendingCreativeAction && pendingCreativeAction.awaitingScenes) {
      writeOperationChosen = true;
      el('studio-dw-write-operation').value = 'scene-write';
      el('studio-dw-scene-mode').value = 'revise';
    }
    showConversationWrite();
    return refreshWrite().then(showConversationWrite);
  }
  function writePrepare(options) {
    var bridge = window.studioDirectorBridge;
    var operation = el('studio-dw-write-operation').value;
    var id = el('studio-dw-write-project').value;
    if (!bridge.isReady()) {status(bridge.readinessMessage(),true);return;}
    if (operation !== 'new-project' && !id) {status('Choose a destination Project.',true);return;}
    if (operation === 'scene-write') {
      if (el('studio-dw-scene-mode').value === 'revise') return prepareBatchScenes(id);
      var instruction = manualSceneInstruction();
      if (!instruction) {
        status('Enter an instruction for the new Scene before launch.', true);
        return;
      }
      return bridge.writeNewScene({
        projectId:id, instruction:instruction, authorRequest:instruction,
        forceAuthor:true, directSave:true
      });
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
      originalStory = story;
      return window.studioDirectorBridge.checkProjectCoherence(storyId);
    }).then(function (result) {
      return loadStory(storyId).then(function (fresh) {
        if (fresh.updatedAt !== originalStory.updatedAt)
          throw new Error('The Project changed during coherence analysis. Run the check again before reviewing changes.');
        var ids = originalStory.sceneOrder || [], seen = new Set(), failures = [];
        (result.errors || []).forEach(function (item) {
          failures.push('Scene ' + (ids.indexOf(item.sceneId) + 1) + ': ' + item.error);
        });
        var changed = [];
        (result.scenes || []).forEach(function (entry) {
          if (!entry || !ids.includes(entry.sceneId) || seen.has(entry.sceneId) ||
              typeof entry.originalPrompt !== 'string' || typeof entry.prompt !== 'string' ||
              !entry.prompt.trim() || entry.originalPrompt !== originalStory.scenes[entry.sceneId].prompt) {
            failures.push('An invalid or outdated Scene proposal was excluded.');
            return;
          }
          seen.add(entry.sceneId);
          if (entry.prompt !== entry.originalPrompt) changed.push(entry);
        });
        if (failures.length && typeof window.reportConsoleError === 'function')
          window.reportConsoleError('Studio Coherence incomplete', failures.join(' | '));
        var summary = 'Checked ' + seen.size + ' of ' + ids.length + ' Scenes' +
          (failures.length ? ' · ' + failures.length + ' skipped/failed: ' + failures.join(' | ') : '');
        if (!changed.length) {
          status(summary + ' · No H3 Prompt changes proposed.', !!failures.length);
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
                title:scene.title,prompt:scene.prompt},
              draft:{sceneId:entry.sceneId,prompt:entry.prompt}
            };
          })
        };
        renderBatchReview();
        status(summary + ' · Review ' + changed.length + ' proposed Prompt changes before applying.', !!failures.length);
      });
    }).catch(function (error) {
      status('Project coherence check failed: ' + String(error.message || error), true);
    }).finally(function () {button.disabled = false;});
  }
  // Validate model-produced revisions before presenting them for review. The saved
  // Scene identity and untouched fields remain authoritative.
  function validateSceneRevisionDraft(result, ids, selected, raw) {
    if (!result || !Array.isArray(result.scenes))
      throw new Error('Director returned no Scene revisions.\nRaw Director response:\n' + raw);
    var seen = new Set(), warnings = [];
    var revisions = [];
    result.scenes.forEach(function (candidate, index) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) ||
          !ids.includes(candidate.sceneId) || seen.has(candidate.sceneId)) {
        warnings.push('Scene record ' + (index + 1) + ' has no unique selected Scene identity.');
        return;
      }
      seen.add(candidate.sceneId);
      var before = selected.find(function (row) {return row.sceneId === candidate.sceneId;});
      if (!before) {
        warnings.push('Scene record ' + (index + 1) + ' has no saved baseline.');
        return;
      }
      var changed = {sceneId:candidate.sceneId};
      sceneFields.forEach(function (field) {
        if (!Object.prototype.hasOwnProperty.call(candidate, field)) return;
        if (typeof candidate[field] !== 'string' || !candidate[field].trim()) {
          warnings.push('Scene ' + candidate.sceneId + ' has an invalid ' + field + ' (ignored).');
        } else if (candidate[field] !== String(before[field] || '')) {
          changed[field] = candidate[field];
        }
      });
      Object.keys(candidate).forEach(function (key) {
        if (key !== 'sceneId' && !sceneFields.includes(key))
          warnings.push('Scene ' + candidate.sceneId + ' has an unsupported ' + key + ' (ignored).');
      });
      if (Object.keys(changed).length > 1)
        revisions.push({sceneId:candidate.sceneId, before:before, draft:changed});
    });
    ids.forEach(function (id) {
      if (!seen.has(id)) warnings.push('No usable revision for Scene ' + id + '.');
    });
    if (warnings.length && typeof window.reportConsoleError === 'function')
      window.reportConsoleError('Studio Scene revision incomplete', warnings.join(' | '));
    return revisions;
  }
  function prepareBatchScenes(storyId) {
    var ids = Array.from(el('studio-dw-batch-scenes').querySelectorAll('input:checked'))
      .map(function (node) { return node.value; });
    if (!ids.length || ids.length > 32) {
      status('Choose one to 32 Scenes to revise.', true);
      return Promise.resolve();
    }
    var instruction = manualSceneInstruction();
    if (!instruction) {
      status('Enter a revision instruction before launch.', true);
      return Promise.resolve();
    }
    // The existing batch authoring action revises Scene Prompts.
    // Additional title and duration drafts arrive as actual structured
    // content in conversation; never infer field mutations from prose.
    var fields = ['prompt'];
    var button = el('studio-dw-write-prepare');
    button.disabled = true;
    var outcome = {saved:[],unchanged:[],review:[],failed:[],notAttempted:[],reportingErrors:[]};
    var current = 0, story;
    status('Writing ' + ids.length + ' selected Scenes · saves occur after each Scene.',false,true);
    function run() {
      if (current >= ids.length) return Promise.resolve(outcome);
      var id = ids[current++], position = story.sceneOrder.indexOf(id) + 1;
      var label = 'Scene ' + position + ' · ' + (story.scenes[id].title || id);
      status('Writing ' + label + ' (' + current + '/' + ids.length + ') · Save on completion',false,true);
      return window.studioDirectorBridge.writeSelectedScene({
        projectId:storyId,sceneId:id,instruction:instruction,fields:fields.slice(),
        forceAuthor:true
      }).then(function (result) {
        if (result === null) outcome.unchanged.push(label);
        else if (result && result.review) outcome.review.push(label);
        else outcome.saved.push(label);
      }).catch(function (error) {
        if (error.saved) {
          outcome.saved.push(label);
          outcome.reportingErrors.push(label);
        } else {
          outcome.failed.push(label + ': ' + String(error.message || error));
        }
        // Cancellation or a common dependency failure stops the remaining list.
        var stopped = ['stopped','cancelled','interrupted'].includes(String(error.jobStatus || ''));
        var shared = stopped || /Failed to fetch|No Director model is available|Director must be ready|runtime unavailable|Project is no longer available/i.test(String(error.message || ''));
        if (shared) {
          outcome.notAttempted = ids.slice(current).map(function (nextId) {
            return 'Scene ' + (story.sceneOrder.indexOf(nextId) + 1) + ' · ' +
              (story.scenes[nextId].title || nextId);
          });
          current = ids.length;
        }
      }).then(run);
    }
    return window.flushStudioDirectorStoryEdits(storyId).then(function () {
      return loadStory(storyId);
    }).then(function (loaded) {
      story = loaded;
      if (!story || !Array.isArray(story.sceneOrder) || ids.some(function (id) {
        return !story.sceneOrder.includes(id) || !story.scenes[id];
      })) throw new Error('One or more selected Scenes are no longer in the destination Project.');
      window.studioDirectorBridge.selectWriteProject(story.id,storyName(story));
      return run();
    }).then(function () {
      var summary = 'Saved ' + outcome.saved.length +
        (outcome.saved.length ? ': ' + outcome.saved.join(', ') : '') +
        ' · Unchanged ' + outcome.unchanged.length +
        (outcome.unchanged.length ? ': ' + outcome.unchanged.join(', ') : '') +
        ' · Needs review ' + outcome.review.length +
        (outcome.review.length ? ': ' + outcome.review.join(', ') : '') +
        ' · Failed ' + outcome.failed.length +
        (outcome.failed.length ? ': ' + outcome.failed.join(' | ') : '') +
        ' · Not attempted ' + outcome.notAttempted.length +
        (outcome.notAttempted.length ? ': ' + outcome.notAttempted.join(', ') : '');
      if (outcome.reportingErrors.length) summary +=
        ' · Saved but follow-up reporting failed: ' + outcome.reportingErrors.join(', ');
      status(summary,!!(outcome.failed.length || outcome.notAttempted.length || outcome.reportingErrors.length),true);
      return outcome;
    }).catch(function (error) {
      status('Selected Scene write could not start: ' + String(error.message || error),true);
      throw error;
    }).finally(function () { button.disabled = false; });
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
      ['title','prompt'].forEach(function (field) {
        var row = document.createElement('div'), selection = document.createElement('label'), checkbox = document.createElement('input'),
          editor = document.createElement('textarea'), old = entry.before[field] || '';
        var value = Object.prototype.hasOwnProperty.call(entry.draft, field) ? entry.draft[field] : old;
        row.className = 'studio-dw-review-part';
        checkbox.type = 'checkbox';
        checkbox.dataset.selectField = field;
        checkbox.checked = value !== old;
        editor.dataset.field = field;
        if (field === 'prompt') editor.dataset.revisionKey = 'project:' + proposedBatch.storyId + ':scene:' + entry.sceneId + ':field:' + field;
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
    Array.from(el('studio-dw-scene-editors').querySelectorAll('[data-field]')).forEach(function (node) {
      changes[node.dataset.field] = node.dataset.field === 'durationSeconds'
        ? Number(node.value) : node.value;
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
      window.studioDirectorBridge.forgetSavedSceneDraft(result.story.id,proposedScene.sceneId,result.scene);
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
  // The only conversational Director handoff: an optional authoring proposal.
  // WebCap binds actual Projects/Scenes; the model supplies no persisted IDs.
  var pendingCreativeAction = null;
  // Write reflects an explicit conversational proposal, not a standalone operation picker.
  function showConversationWrite() {
    var action = pendingCreativeAction;
    var selectedDraft = !action || action.reviewReady
      ? window.studioDirectorBridge.preparedWrite() : null;
    var prepared = action && !(action.reviewReady && selectedDraft && selectedDraft.kind === 'scene')
      ? null : selectedDraft;
    var ready = !!(action || prepared);
    var awaitingProject = !!(action && action.awaitingProject);
    var awaitingScenes = !!(action && action.awaitingScenes);
    el('studio-dw-write-empty').classList.toggle('hidden', ready);
    el('studio-dw-write-ready').classList.toggle('hidden', !ready);
    el('studio-dw-write-panel').classList.toggle('hidden', !(awaitingProject || awaitingScenes));
    el('studio-dw-write-panel').classList.toggle('studio-dw-awaiting-project', awaitingProject);
    el('studio-dw-write-panel').classList.toggle('studio-dw-awaiting-scenes', awaitingScenes);
    if (!ready) return;
    if (prepared) {
      var fieldLabels = prepared.fields.map(function (field) {return labels[field] || field;});
      var scope = ({scene:'Scene',project:'Project', 'new-project':'New Project',
        'new-scene':'New Scene'})[prepared.kind];
      el('studio-dw-write-ready-title').textContent = scope + ' draft prepared';
      el('studio-dw-write-ready-direction').textContent = fieldLabels.join(' · ');
      el('studio-dw-write-ready-launch').textContent = 'Review ' + scope;
      return;
    }
    var title = ({create_project:'Create Project',write_project:'Revise Project',
      create_scene:'Create Scenes',write_scenes:'Revise Scenes'})[action.kind];
    el('studio-dw-write-ready-title').textContent = title;
    el('studio-dw-write-ready-direction').textContent = action.instruction;
    el('studio-dw-write-ready-launch').textContent = awaitingProject || awaitingScenes
      ? 'Continue with selected target' : title;
  }

  // Scene targets belong to the selected Studio context or the explicit Write
  // checkboxes, never to a scene number guessed from conversational text.
  function selectedSceneIds(story, selectedScene) {
    return selectedScene && selectedScene.projectId === story.id &&
      story.sceneOrder.includes(selectedScene.sceneId) ? [selectedScene.sceneId] : [];
  }

  function presentAction(action, selectedScene, selectedProject, authorRequest, messageIndex) {
    if (!action || !['create_project','write_project','create_scene','write_scenes'].includes(action.kind) ||
        !String(action.instruction || '').trim()) return;
    // Do not offer a creative Review based on an LLM action promise or user prose.
    if (!(Array.isArray(action.scenes) && action.scenes.length) &&
        !(action.authoredFields && Object.keys(action.authoredFields).length)) return;
    var frozen = {
      kind:action.kind, actionKey:action.actionKey || 'primary',
      reviewDraft:action.reviewDraft || null,
      instruction:String(action.instruction).trim(),
      fields:Array.isArray(action.fields) ? action.fields.slice() : [],
      scenes:action.kind === 'create_scene' && Array.isArray(action.scenes)
        ? action.scenes.slice() : null,
      authoredFields:action.authoredFields && typeof action.authoredFields === 'object'
        ? Object.assign({},action.authoredFields) : null,
      request:String(authorRequest || ''),
      sourceMessageIndex:messageIndex,
      projectId:String(selectedProject && selectedProject.projectId || ''),
      scene:selectedScene && {projectId:selectedScene.projectId,sceneId:selectedScene.sceneId,
        sceneNumber:selectedScene.sceneNumber}
    };
    pendingCreativeAction = frozen;
    showConversationWrite();
    function finishSceneAction(saved) {
      if (pendingCreativeAction !== frozen) return;
      pendingCreativeAction = null;
      el('studio-dw-suggestions').replaceChildren();
      showConversationWrite();
      if (saved !== false) window.studioDirectorBridge.finishWriteAction(frozen);
    }
    var host = el('studio-dw-suggestions');
    host.replaceChildren();
    // Every conversation-authored result has a visible, correctable destination.
    // The open editor remains a suggestion, not an automatic save authorization.
    var isProjectMaterial = (frozen.kind === 'create_project' ||
      frozen.kind === 'write_project') && !!frozen.authoredFields;
    if (isProjectMaterial || frozen.kind === 'create_scene' ||
        frozen.kind === 'write_scenes') {
      var destination = document.createElement('select');
      var destinationLabel = document.createElement('label');
      destinationLabel.textContent = 'Destination ';
      destination.setAttribute('aria-label',isProjectMaterial
        ? 'Project material destination' : 'Scene material destination');
      var defaultOption = document.createElement('option');
      defaultOption.value = '';
      defaultOption.textContent = isProjectMaterial ? 'New Project' : 'Choose Project…';
      destination.appendChild(defaultOption);
      destination.onchange = function () {
        frozen.chosenProjectId = destination.value;
        if (isProjectMaterial)
          frozen.kind = destination.value ? 'write_project' : 'create_project';
        showConversationWrite();
      };
      destinationLabel.appendChild(destination);
      host.appendChild(destinationLabel);
      refreshProjects().then(function (items) {
        items.forEach(function (item) {
          var option = document.createElement('option');
          option.value = item.id;
          option.textContent = (isProjectMaterial ? 'Revise ' : '') + storyName(item);
          destination.appendChild(option);
        });
        // Only a deterministically launched operation may suggest a revision.
        // Conversation fields (including title) never classify create vs revise.
        var knownProject = items.some(function (item) {return item.id === frozen.projectId;});
        destination.value = isProjectMaterial
          ? frozen.kind === 'write_project' && knownProject ? frozen.projectId : ''
          : knownProject ? frozen.projectId : '';
        destination.onchange();
      }).catch(function (error) {
        status('Project destinations could not load: ' + error.message,true);
      });
    }
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'studio-dw-suggestion-action';
    button.dataset.suggestionKind = 'write';
    button.dataset.guidedWrite = 'true';
    button.textContent = ({
      create_project:'Review authored Project',
      write_project:'Review authored Project',
      create_scene:frozen.scenes && frozen.scenes.length
        ? 'Review authored Scene(s)' : 'Create Scene(s) · Review',
      write_scenes:'Review authored Scene'
    })[frozen.kind];
    button.title = frozen.instruction;
    button.onclick = function () {
      if (pendingCreativeAction !== frozen) return;
      var reviewingScenes = !!frozen.authoredFields || frozen.kind === 'create_scene' &&
        (frozen.draftReady || (frozen.scenes && frozen.scenes.length)) ||
        frozen.kind === 'write_scenes' && !!frozen.authoredFields;
      if (reviewingScenes ? !window.studioDirectorBridge.canReview() :
          !window.studioDirectorBridge.isReady()) {
        status(reviewingScenes ? 'Open an available Studio conversation to review authored material.' :
          window.studioDirectorBridge.readinessMessage(),true);
        return;
      }
      button.disabled = true;
      // Resolve destination only from the attached Project or an explicit Write selection.
      refreshProjects().then(function (items) {
        if (frozen.kind === 'create_project')
          return window.studioDirectorBridge.prepareWrite('new-project','', '',{
            instruction:frozen.instruction,authorRequest:frozen.request,
            authoredFields:frozen.authoredFields
          });
        var projectId = Object.prototype.hasOwnProperty.call(frozen, 'chosenProjectId')
          ? frozen.chosenProjectId : frozen.projectId;
        if (!projectId) {
          frozen.awaitingProject = true;
          showConversationWrite();
          status('Select the Project in Write, then click this action again.',true);
          openWriteForCapture();
          return;
        }
        var item = items.find(function (p) {return p.id === projectId;});
        if (!item) {
          frozen.awaitingProject = true;
          showConversationWrite();
          status('Select an available Project in Write, then click this action again.',true);
          openWriteForCapture();
          return;
        }
        // Record WebCap's resolved destination for the matching save receipt.
        frozen.chosenProjectId = projectId;
        if (frozen.kind === 'write_project') {
          var fields = frozen.fields.filter(function (name) {return projectFields.includes(name);});
          return window.studioDirectorBridge.prepareWrite('project',projectId,storyName(item),{
            instruction:frozen.instruction,authorRequest:frozen.request,requestedFields:fields,
            authoredFields:frozen.authoredFields
          });
        }
        if (frozen.kind === 'create_scene') {
          // Authored records are reviewed directly, without a second model call.
          // Otherwise authorize one authoring call, and retain its review action.
          var operation = frozen.draftReady ?
            window.studioDirectorBridge.reviewPendingScenes(projectId,frozen.sourceMessageIndex) :
            frozen.scenes && frozen.scenes.length ?
            window.studioDirectorBridge.reviewAuthoredScenes({
              projectId:projectId,scenes:frozen.scenes,
              sourceMessageIndex:frozen.sourceMessageIndex,
              rationale:'Authored in Studio Director conversation.'
            }) :
            window.studioDirectorBridge.writeNewScene({
              projectId:projectId,instruction:frozen.instruction,
              authorRequest:frozen.request,directSave:false,
              sourceMessageIndex:frozen.sourceMessageIndex
            });
          return operation.then(function (result) {
            if (result && result.review) {
              status('Review the authored Scenes and save the useful drafts.',false,true);
              frozen.draftReady = true;
              button.textContent = 'Review authored Scene(s)';
            }
          });
        }
        return loadStory(projectId).then(function (story) {
          var ids = selectedSceneIds(story,frozen.scene);
          if (frozen.kind === 'write_scenes' && frozen.authoredFields) {
            if (ids.length !== 1) {
              frozen.awaitingScenes = true;
              showConversationWrite();
              status('Select the Scene to review in Write.',true);
              openWriteForCapture();
              return;
            }
            var candidate = frozen.authoredFields;
            var edited = ['title','prompt','durationSeconds'].filter(function (name) {
              return Object.prototype.hasOwnProperty.call(candidate,name) &&
                JSON.stringify(candidate[name]) !== JSON.stringify(story.scenes[ids[0]][name]);
            });
            if (edited.length) {
              var retained = frozen.reviewDraft &&
                frozen.reviewDraft.projectId === projectId &&
                frozen.reviewDraft.sceneId === ids[0] ? frozen.reviewDraft.values : null;
              showSceneReview(story,ids[0],edited,candidate,{
                values:retained,
                onEdit:function (field,value) {
                  if (!frozen.reviewDraft || frozen.reviewDraft.projectId !== projectId ||
                      frozen.reviewDraft.sceneId !== ids[0])
                    frozen.reviewDraft = {projectId:projectId,sceneId:ids[0],values:{}};
                  frozen.reviewDraft.values[field] = value;
                  window.studioDirectorBridge.markWriteActionEdited(frozen);
                }
              });
            }
            else status('Returned fields already match the saved Scene.',false,true);
            return;
          }
          if (Array.isArray(frozen.chosenSceneIds))
            ids = frozen.chosenSceneIds.filter(function (id) {return story.sceneOrder.includes(id);});
          if (!ids.length) {
            frozen.awaitingScenes = true;
            showConversationWrite();
            status('Select the Scene(s) in Write, then click this action again.',true);
            el('studio-dw-write-project').value = projectId;
            el('studio-dw-write-operation').value = 'scene-write';
            el('studio-dw-scene-mode').value = 'revise';
            openWriteForCapture();
            return;
          }
          var fields = frozen.fields.filter(function (name) {
            return ['title','prompt','durationSeconds'].includes(name);
          });
          // Explicit field selection, not wording in the author's request,
          // determines a scoped Write. Actual conversational drafts have
          // already supplied their own fields.
          if (!fields.length) fields = ['prompt'];
          var completed = [], unchanged = [], review = [], failed = [], notAttempted = [], reportingErrors = [];
          function next(i) {
            if (i >= ids.length) {
              var reviewLabels = review.map(function (id) {
                return 'Scene ' + (story.sceneOrder.indexOf(id) + 1);
              });
              status('Saved ' + completed.length + ' · Unchanged ' + unchanged.length +
                ' · Drafts needing review ' + review.length +
                (review.length ? ' (' + reviewLabels.join(', ') +
                  '): select each Scene in Studio and use Write to review' : '') +
                ' · Failed ' + failed.length + ' · Not attempted ' + notAttempted.length +
                (failed.length ? ': ' + failed.join(' | ') : '') +
                (reportingErrors.length ? ' · Saved, but reporting failed for ' +
                  reportingErrors.join(', ') : ''),failed.length > 0 || notAttempted.length > 0 || reportingErrors.length > 0,true);
              if (review.length && !failed.length && !notAttempted.length)
                finishSceneAction(false);
              else if (review.length) {
                frozen.reviewReady = true;
                showConversationWrite();
              } else if (!failed.length && !notAttempted.length) finishSceneAction();
              return;
            }
            return window.studioDirectorBridge.writeSelectedScene({
              projectId:projectId,sceneId:ids[i],instruction:frozen.instruction,
              authorRequest:frozen.request,fields:fields.slice()
            }).then(function (result) {
              if (result === null) unchanged.push(ids[i]);
              else if (result && result.review) review.push(ids[i]);
              else completed.push(ids[i]);
              return next(i + 1);
            }).catch(function (error) {
              if (error.saved) {
                completed.push(ids[i]);
                reportingErrors.push('Scene ' + (story.sceneOrder.indexOf(ids[i]) + 1));
              } else failed.push(ids[i] + ': ' + String(error.message || error));
              var shared = ['stopped','cancelled','interrupted'].includes(String(error.jobStatus || '')) ||
                /Failed to fetch|No Director model is available|runtime unavailable|Project is no longer available/i.test(String(error.message || ''));
              if (shared) {
                notAttempted = ids.slice(i + 1);
                status('Saved ' + completed.length + ' · Failed ' + failed.length +
                  ' · Not attempted ' + notAttempted.length,true,true);
                return;
              }
              return next(i + 1);
            });
          }
          return next(0);
        });
      }).catch(function (error) {
        status('Director action failed: ' + String(error.message || error),true);
      }).finally(function () {button.disabled = false;});
    };
    host.appendChild(button);
    window.studioDirectorBridge.placeSuggestedAction(host, messageIndex, frozen);
    showConversationWrite();
    return frozen;
  }

  window.studioDirectorWorkbench = {
    approvedReadPayload:readPayload,
    approvedReadLabel:function (projectId,keys) {
      var name = readStory && readStory.id === projectId ? storyName(readStory) : projectId;
      var sceneIds = new Set(keys.filter(function (key) {return key.startsWith('scene:');})
        .map(function (key) {return key.split(':')[1];}));
      var labels = [];
      if (keys.some(function (key) {return key.startsWith('project.');})) labels.push('Overview');
      sceneIds.forEach(function (id) {
        var index = readStory && readStory.id === projectId ? readStory.sceneOrder.indexOf(id) : -1;
        labels.push(index >= 0 ? 'Scene ' + (index + 1) : 'Scene');
      });
      keys.filter(function (key) {return key.startsWith('invariant:');}).forEach(function (key) {
        labels.push('Invariant ' + decodeURIComponent(key.split(':')[2]));
      });
      return name + ' · ' + labels.join(' + ');
    },
    presentAction:presentAction,
    updateWorkingWrite:showConversationWrite,
    completeWriteAction:function (kind, story, selected) {
      var action = pendingCreativeAction;
      if (!action) return;
      var projectId = action.chosenProjectId || action.projectId;
      var matches =
        (action.kind === 'create_project' && kind === 'project.create') ||
        (projectId === story.id && action.kind === 'write_project' && kind === 'brief.apply') ||
        (projectId === story.id && action.kind === 'create_scene' && kind === 'scenes.create') ||
        (projectId === story.id && action.kind === 'write_scenes' &&
          kind === 'scene.update' && selected.sceneId === (action.scene && action.scene.sceneId));
      if (!matches) return;
      pendingCreativeAction = null;
      el('studio-dw-suggestions').replaceChildren();
      showConversationWrite();
      return true;
    },
    sceneRead: function (story, sceneId) {
      if (!story || !story.sceneOrder.includes(sceneId)) throw new Error('Select a saved Scene in this Project.');
      var scene = story.scenes[sceneId];
      var fields = ['title','prompt','durationSeconds'];
      var keys = projectFields.map(function (field) {return 'project.' + field;})
        .concat(fields.map(function (field) {return 'scene:' + sceneId + ':' + field;}));
      return {payload:readPayload(story, keys), keys:keys,
        label:'Scene ' + (story.sceneOrder.indexOf(sceneId) + 1) + ' · ' + (story.scenes[sceneId].title || 'Untitled')};
    },
    applyScenePrompt: function (story, sceneId, prompt, extraChanges) {
      if (prompt !== null && (typeof prompt !== 'string' || !prompt.trim()))
        throw new Error('Director returned an empty Scene prompt.');
      var scene = story && story.scenes && story.scenes[sceneId];
      if (!scene || !story.sceneOrder.includes(sceneId)) throw new Error('The selected Scene no longer exists.');
      var changes = {}, expected = {};
      if (prompt !== null) {
        changes.prompt = prompt;
        expected.prompt = scene.prompt || '';
      }
      Object.keys(extraChanges || {}).forEach(function (key) {
        if (!['title','durationSeconds'].includes(key)) throw new Error('Unsupported Scene change: ' + key);
        changes[key] = extraChanges[key];
        expected[key] = scene[key];
      });
      if (!Object.keys(changes).length) throw new Error('No Scene fields were selected for saving.');
      return window.flushStudioDirectorStoryEdits(story.id).then(function () {
        return api('/fs/studio/director/scene-fields', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({storyId:story.id, sceneId:sceneId, expected:expected, changes:changes})
        });
      }).then(function (result) {
        if (!result || !result.story || !result.scene)
          throw new Error('Scene save returned no authoritative saved result.');
        var savedFields = {};
        Object.keys(changes).forEach(function (key) {savedFields[key] = result.scene[key];});
        return window.refreshStudioDirectorStoryIfOpen(story.id).then(function () {
          return window.studioDirectorBridge.recordApplied('scene.director.revision',result.story,{
            sceneId:sceneId, savedFields:savedFields
          });
        }).catch(function (error) {
          error.saved = true;
          error.savedScene = result.scene;
          throw error;
        }).then(function () {return result;});
      });
    },
    setStatus:status,
    markSavedFields:function(selected,story){
      if (!story || !story.id) throw new Error('Field update feedback needs the saved Project identity.');
      var values=selected.savedFields || selected.fields || selected;
      var keys=Object.keys(values).filter(function(key){return ['title','concept','style','invariants','prompt','durationSeconds'].includes(key);});
      if (selected.scenes && typeof selected.scenes==='object') keys.push('Scene revisions');
      var descriptions={title:'Title',concept:'Concept',style:'Visual / atmosphere',invariants:'Invariants',prompt:'H3 Prompt',durationSeconds:'Duration'};
      var label=keys.map(function(key){return descriptions[key] || key;}).join(', ');
      var button=el('studio-dw-write');
      button.dataset.result='success';
      button.title='Saved to ' + storyName(story) + ': ' + (label || 'reviewed changes');
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
      var button=el('studio-dw-read');
      button.dataset.result=state;
      button.title=detail || 'Read selected Project fields';
    },
    updateContext:function () {updateScope(); showConversationWrite();},
    showSentWriteContext: function(operation, messages) {
      var preview = el('studio-dw-write-context-json');
      var details = el('studio-dw-write-context');
      details.querySelector('summary').textContent = 'Inspect exact Director request just sent';
      preview.textContent = JSON.stringify({
        operation:operation,model:window.studioDirectorBridge.modelId(),messages:messages
      }, null, 2);
    },
    resetConversation: function () {
      var instruction = el('studio-dw-write-instruction');
      instruction.value = '';
      delete instruction.dataset.instructionSeeded;
      pendingCreativeAction = null;
      el('studio-dw-suggestions').replaceChildren();
      showConversationWrite();
      readChoices = {};
      writeOperationChosen = false;
      sceneSelectionManual = false;
      sceneSelectionProject = '';
      lastReadSource = null;
      readStory = null;
      writeStory = null;
      el('studio-dw-read-panel').classList.add('hidden');
      el('studio-dw-write-panel').classList.add('hidden');
      el('studio-dw-read').setAttribute('aria-expanded','false');
      el('studio-dw-write').setAttribute('aria-expanded','false');
      el('studio-dw-open-tools').setAttribute('aria-expanded','false');
      el('director-chat-drawer').classList.remove('studio-actions-open');
      status('', false);
      updateScope();
    }
  };

  function bind() {
    var rail = el('studio-director-workbench');if (!rail) return;
    el('studio-dw-read').onclick=function () { lastQuickAction='read'; return toggle('read'); };
    el('studio-dw-write').onclick=function () { lastQuickAction='write'; return toggle('write'); };
    el('studio-dw-read-project').onchange=function () {
      loadStory(this.value).then(renderReadStory).catch(function(e) { status(e.message,true); });
    };
    el('studio-dw-write-project').onchange=function () {
      if (pendingCreativeAction && pendingCreativeAction.kind !== 'create_project')
        pendingCreativeAction.chosenProjectId = this.value;
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
      if (!window.studioDirectorBridge.isReady()) {status(window.studioDirectorBridge.readinessMessage(),true);return;}
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
      if (which === 'write') showConversationWrite();
      else if (el('studio-dw-' + which + '-panel').classList.contains('hidden'))
        el('studio-dw-' + which).click();
      el('studio-dw-open-tools').setAttribute('aria-expanded','true');
      el('studio-dw-close-actions').focus();
    }
    el('studio-dw-write-ready-launch').onclick=function () {
      var reviewDraft = !pendingCreativeAction || pendingCreativeAction.reviewReady
        ? window.studioDirectorBridge.preparedWrite() : null;
      if (!pendingCreativeAction || (pendingCreativeAction.reviewReady && reviewDraft && reviewDraft.kind === 'scene')) {
        var draft = reviewDraft;
        if (!draft) {showConversationWrite();return;}
        if (draft.kind === 'scene') {
          return window.flushStudioDirectorStoryEdits(draft.projectId)
            .then(function () {return loadStory(draft.projectId);})
            .then(function (story) {
              var changes = window.studioDirectorBridge.preparedWrite();
              if (!changes || changes.kind !== 'scene' ||
                  changes.projectId !== draft.projectId || changes.sceneId !== draft.sceneId)
                throw new Error('Prepared Scene target changed. Reopen Write.');
              var candidate = window.studioDirectorBridge.preparedSceneFields(draft.sceneId);
              var changed = changes.fields.filter(function (field) {
                return JSON.stringify(candidate[field]) !== JSON.stringify(story.scenes[draft.sceneId][field]);
              });
              if (!changed.length) {status('These Scene fields already match the saved values.',false,true);return;}
              showSceneReview(story,draft.sceneId,changed,candidate);
            }).catch(function (error) {status('Prepared Scene review failed: '+error.message,true);});
        }
        return window.studioDirectorBridge.reviewPreparedWrite(draft);
      }
      var proposed = el('studio-dw-suggestions').querySelector('[data-guided-write]');
      if (!proposed) throw new Error('The proposed Director action is no longer available.');
      proposed.click();
    };
    el('director-chat-context-approve').onclick=function () {openDirectAction('read');};
    el('studio-dw-open-tools').onclick=function () {
      if (el('director-chat-drawer').classList.contains('studio-actions-open')) el('studio-dw-close-actions').click();
      else openDirectAction(lastQuickAction);
    };
    el('studio-dw-close-actions').onclick=function () {
      el('director-chat-drawer').classList.remove('studio-actions-open');
      el('studio-dw-open-tools').setAttribute('aria-expanded','false');
      el('studio-dw-open-tools').focus();
    };
    rail.addEventListener('keydown',function(event){
      if(event.key==='Escape' && el('director-chat-drawer').classList.contains('studio-actions-open')) {
        event.preventDefault();
        el('studio-dw-close-actions').click();
      }
    });
    el('studio-dw-read-send').onclick=readSend;
    el('studio-dw-read-clear').onclick=function () {
      window.studioDirectorBridge.clearApprovedRead();
      renderApprovedSources();
      status('Saved context cleared. No Project or Scene details will be shared.',false,true);
    };
    el('studio-dw-read-all').onclick=selectEntireReadProject;
    el('studio-dw-scenes-select-all').onclick=function () {selectWriteScenes(true);};
    el('studio-dw-scenes-select-none').onclick=function () {selectWriteScenes(false);};
    el('studio-dw-write-prepare').onclick=writePrepare;
    el('studio-dw-scene-apply').onclick=applyScene;
    el('studio-dw-batch-apply').onclick=applyBatchScenes;
    ['studio-dw-batch-close','studio-dw-batch-cancel'].forEach(function (id) {
      el(id).onclick=function () {el('studio-dw-batch-review').close();};
    });
    ['studio-dw-scene-close','studio-dw-scene-cancel'].forEach(function (id) {
      el(id).onclick=function () {el('studio-dw-scene-review').close();};
    });
    updateScope();
    showConversationWrite();
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind);
  else bind();
})();
