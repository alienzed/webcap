(function () {
  'use strict';
  var readStory = null, writeStory = null, projects = [];
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
      text='Saved context preview (reloaded before Write):' +
        String.fromCharCode(10) + JSON.stringify(data,null,2) +
        String.fromCharCode(10) + 'The full conversation is also supplied.';
    }
    el('studio-dw-write-context').querySelector('summary').textContent =
      'Inspect Write context';
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
      : mode === 'Write' ? 'Explicit destination · direct save after response'
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
    if (sceneWrite) seedManualSceneInstruction();
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
      bridge.prepareWrite(operation, id, item && storyName(item), {forceAuthor:true});
      status('Writing Project fields with Director…', false);
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
        var report = changed.map(function (entry) {
          return {sceneId:entry.sceneId,prompt:entry.prompt};
        });
        el('studio-dw-write-context-json').textContent = JSON.stringify(
          {operation:'check-coherence',suggestedScenePrompts:report},null,2);
        window.reportConsoleInfo('Studio Coherence suggestions',JSON.stringify(report,null,2));
        status(summary + ' · ' + report.length +
          ' suggested Prompt changes available in the Write context and Console. ' +
          'No fields were changed.',!!failures.length,true);
      });
    }).catch(function (error) {
      status('Project coherence check failed: ' + String(error.message || error), true);
    }).finally(function () {button.disabled = false;});
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
    // The selected Scene IDs and fields, not conversation wording, own the write.
    var fields = ['prompt'];
    var button = el('studio-dw-write-prepare');
    button.disabled = true;
    var outcome = {saved:[],unchanged:[],failed:[],notAttempted:[],reportingErrors:[]};
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
        Object.keys(changes).forEach(function (key) {
          savedFields[key] = result.scene[key];
          window.webcapTextareaRevisions.recordFieldChange(
            'project:' + story.id + ':scene:' + sceneId + ':field:' + key,
            expected[key], result.scene[key]);
        });
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
    updateContext:function () {updateScope();},
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
      if (el('studio-dw-' + which + '-panel').classList.contains('hidden'))
        el('studio-dw-' + which).click();
      el('studio-dw-open-tools').setAttribute('aria-expanded','true');
      el('studio-dw-close-actions').focus();
    }
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
    updateScope();
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind);
  else bind();
})();
