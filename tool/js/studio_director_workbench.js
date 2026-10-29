(function () {
  'use strict';
  var readStory = null, writeStory = null, projects = [], proposedScene = null, playbookExpected = null;
  var readiness = [], recommendations = {readHints:[],writeHint:'',sceneId:''};
  var sceneFields = ['summary', 'prompt', 'title'];
  var projectFields = ['title', 'concept', 'style', 'invariants'];
  var labels = {title:'Title', concept:'Concept', style:'Visual / atmosphere',
    invariants:'Invariants', summary:'Intent', prompt:'H3 Prompt',
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
    if (node) { node.textContent = message; node.dataset.error = error ? 'true' : 'false'; }
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
      var preferred = (readStory && readStory.id) || window.studioDirectorBridge.workingStoryId() ||
        activeTarget().storyId || '';
      ['studio-dw-read-project', 'studio-dw-write-project'].forEach(function (id) {
        var select = el(id), original = select.value;
        select.replaceChildren();
        option(select, '', 'Choose Project…');
        projects.forEach(function (p) { option(select, p.id, storyName(p)); });
        if (projects.some(function (p) { return p.id === original; })) select.value = original;
        else if (projects.some(function (p) { return p.id === preferred; })) select.value = preferred;
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
    if (!story) { status('Choose a Project to select fields.', false); return; }
    projectFields.forEach(function (key) {
      var path = 'project.' + key;
      var preferred = recommendations.readHints.length
        ? recommendations.readHints.indexOf(path) !== -1
        : key !== 'title' && !!story[key];
      fields.appendChild(fieldCheckbox(path, labels[key], preferred));
    });
    (story.sceneOrder || []).forEach(function (id, index) {
      var scene = story.scenes && story.scenes[id];
      if (!scene) throw new Error('Project has a Scene index with no matching Scene.');
      var details = document.createElement('details'), heading = document.createElement('summary');
      heading.textContent = 'Scene ' + (index + 1) + ' · ' + (scene.title || 'Untitled');
      details.appendChild(heading);
      ['title', 'summary', 'prompt', 'references', 'durationSeconds'].forEach(function (field) {
        var path = 'scene:' + id + ':' + field;
        var recommended = recommendations.readHints.indexOf(path) !== -1 ||
          (id === (recommendations.sceneId || activeTarget().sceneId) &&
           recommendations.readHints.indexOf('scene.current.' + field) !== -1);
        details.appendChild(fieldCheckbox(path, labels[field], recommended));
        if (recommended) details.open = true;
      });
      scenes.appendChild(details);
    });
    status('Select the saved fields Director should actually receive. Nothing is sent yet.', false);
  }
  function selectedPaths() {
    return Array.from(el('studio-dw-read-panel').querySelectorAll('input[data-path]:checked'))
      .map(function (node) { return node.dataset.path; });
  }
  function readSend() {
    var id = el('studio-dw-read-project').value, keys = selectedPaths();
    if (!id || !keys.length) { status('Choose a Project and at least one field.', true); return; }
    if (!window.studioDirectorBridge.isReady()) { status('Open Studio Director and choose a model first.', true); return; }
    el('studio-dw-read-send').disabled = true;
    // Fresh saved content is fetched at the explicit Send boundary, not injected by navigation.
    loadStory(id).then(function (story) {
      var items = keys.map(function (key) {
        var parts = key.split(':'), value;
        if (key.indexOf('project.') === 0) {
          var field = key.slice(8);
          if (projectFields.indexOf(field) === -1) throw new Error('Unknown Project field: ' + field);
          value = story[field];
        } else {
          if (parts.length !== 3 || parts[0] !== 'scene' ||
              ['title','summary','prompt','references','durationSeconds'].indexOf(parts[2]) === -1 ||
              !story.scenes || !story.scenes[parts[1]] ||
              (story.sceneOrder || []).indexOf(parts[1]) === -1)
            throw new Error('Selected Scene field is not in the current Project: ' + key);
          value = story.scenes[parts[1]][parts[2]];
        }
        return {id:key, value:value === undefined ? null : value};
      });
      window.studioDirectorBridge.sendRead({
        projectId:story.id, projectTitle:storyName(story), savedAt:story.updatedAt,
        fields:items
      }, keys);
      status('Selected fields sent. Director must acknowledge their identifiers in its reply.', false);
      el('studio-dw-read-panel').classList.add('hidden');
      el('studio-dw-read').setAttribute('aria-expanded', 'false');
    }).catch(function (error) { status('Read failed: ' + String(error.message || error), true); })
      .finally(function () { el('studio-dw-read-send').disabled = false; });
  }
  function setOperation() {
    var operation = el('studio-dw-write-operation').value;
    el('studio-dw-write-scene-row').classList.toggle('hidden', operation !== 'scene-edit');
    el('studio-dw-write-fields').classList.toggle('hidden', operation !== 'scene-edit');
    el('studio-dw-write-project').disabled = operation === 'new-project' || operation === 'playbook';
    el('studio-dw-write-prepare').textContent = operation === 'scene-edit' ? 'Draft Scene revision' : 'Prepare editable review';
  }
  function renderWriteStory(story) {
    writeStory = story;
    var select = el('studio-dw-write-scene');
    select.replaceChildren();
    if (!story) return;
    (story.sceneOrder || []).forEach(function (id, index) {
      var scene = story.scenes && story.scenes[id];
      if (scene) option(select, id, 'Scene ' + (index + 1) + ' · ' + (scene.title || 'Untitled'));
    });
    var preferredScene = recommendations.sceneId || activeTarget().sceneId;
    if (preferredScene && story.scenes && story.scenes[preferredScene])
      select.value = preferredScene;
  }
  function refreshRead() {
    return refreshProjects().then(function () {return loadStory(el('studio-dw-read-project').value);})
      .then(renderReadStory).catch(function (e) { status('Read setup failed: ' + e.message, true); });
  }
  function refreshWrite() {
    return refreshProjects().then(function () {return loadStory(el('studio-dw-write-project').value);})
      .then(renderWriteStory).then(function () {
        if (recommendations.writeHint) el('studio-dw-write-operation').value = recommendations.writeHint;
        setOperation();
      })
      .catch(function (e) { status('Write setup failed: ' + e.message, true); });
  }
  function toggle(which) {
    var other = which === 'read' ? 'write' : 'read', panel = el('studio-dw-' + which + '-panel'),
      button = el('studio-dw-' + which), show = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !show);
    button.setAttribute('aria-expanded', show ? 'true' : 'false');
    el('studio-dw-' + other + '-panel').classList.add('hidden');
    el('studio-dw-' + other).setAttribute('aria-expanded', 'false');
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
      'Selected Scene: ' + JSON.stringify({id:sceneId, title:scene.title,summary:scene.summary,prompt:scene.prompt}),
      'Recent conversation: ' + JSON.stringify(history),
      'Write a specific useful revision of the selected fields. No markdown.'
    ].join(String.fromCharCode(10));
    return window.studioDirectorBridge.makeProposal(request).then(function (text) {
      var candidate = parseProposal(text);
      fields.forEach(function (key) { if (typeof candidate[key] !== 'string') throw new Error('Director omitted proposed ' + key + '.'); });
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
    });
  }
  function writePrepare() {
    var bridge = window.studioDirectorBridge, operation = el('studio-dw-write-operation').value,
      id = el('studio-dw-write-project').value;
    if (!bridge.isReady()) { status('Open Studio Director and choose a model first.', true);return; }
    if (operation === 'playbook') { preparePlaybook(); return; }
    if (operation !== 'new-project' && !id) { status('Select a destination Project.', true);return; }
    if (operation !== 'scene-edit') {
      try {
        var item = projects.find(function (p) {return p.id === id;});
        bridge.prepareWrite(operation, id, item && storyName(item));
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
  function preparePlaybook() {
    var button = el('studio-dw-write-prepare');
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
    Promise.resolve().then(function () {
      return window.flushStudioDirectorStoryEdits(proposedScene.storyId);
    }).then(function () {return api('/fs/studio/director/scene-fields', {
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({storyId:proposedScene.storyId,sceneId:proposedScene.sceneId,
        expected:proposedScene.expected,changes:changes})
    });}).then(function (result) {
      if (!result.scene || !result.story) throw new Error('Scene Apply returned no saved Scene.');
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
      el('studio-dw-scene-error').textContent = String(err.message || err);
      status('Scene Apply failed: ' + String(err.message || err),true);
    }).finally(function () {button.disabled=false;});
  }
  function renderReadiness(list) {
    readiness = list;
    var host = el('studio-dw-readiness-list');if (!host) return;
    host.replaceChildren();
    if (!list.length) {
      var p = document.createElement('p');p.textContent = 'Director has not provided a readiness assessment yet.';
      host.appendChild(p);return;
    }
    list.forEach(function (item) {
      var details=document.createElement('details'), heading=document.createElement('summary'), content=document.createElement('pre');
      details.dataset.ready=item.ready ? 'true':'false';
      var checkbox = document.createElement('input'), name = document.createElement('span');
      checkbox.type = 'checkbox'; checkbox.checked = !!item.ready; checkbox.disabled = true;
      checkbox.setAttribute('aria-label', item.name + (item.ready ? ' ready' : ' still developing'));
      name.textContent = (item.scope === 'scene' ?
        'Scene' + (recommendations.sceneId ? ' ' + recommendations.sceneId : '') + ' · ' :
        'Project · ') + item.name;
      heading.append(checkbox, name);
      content.textContent = item.content;
      details.append(heading,content);host.appendChild(details);
    });
  }
  window.studioDirectorWorkbench = {setStatus:status, updateReadiness:function (result, restoring) {
    var list = Array.isArray(result) ? result : result && result.checks;
    if (!Array.isArray(list)) { status('Director readiness response was invalid.',true);return; }
    var allowed = ['Concept','Characters','Setting','Action','Dialogue','Visual / atmosphere',
      'Visual focus','Structure / formula','Variation / repetition','Production feasibility'];
    var valid=list.filter(function (item) {return item && allowed.indexOf(item.name)!==-1 &&
      (item.scope==='project'||item.scope==='scene') && typeof item.ready==='boolean' &&
      typeof item.content==='string' && item.content.length<=8000;}).slice(0,30);
    if (valid.length!==list.length) status('Some Director readiness proposals were invalid; review the conversation.',true);
    recommendations = {
      readHints:Array.isArray(result.readHints) ? result.readHints.filter(function (key) {
        return typeof key==='string' && key.length<=120;}).slice(0,15) : [],
      writeHint:['project','new-project','scene','scenes','scene-edit','playbook'].indexOf(result.writeHint) !== -1 ?
        result.writeHint : '',
      sceneId:typeof result.sceneId === 'string' ? result.sceneId : ''
    };
    renderReadiness(valid);
    if (!restoring && window.studioDirectorBridge && window.studioDirectorBridge.updateReadiness)
      window.studioDirectorBridge.updateReadiness({
        checks:valid,readHints:recommendations.readHints,
        writeHint:recommendations.writeHint,sceneId:recommendations.sceneId
      });
  }};

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
    el('studio-dw-write-operation').onchange=setOperation;
    el('studio-dw-read-send').onclick=readSend;
    el('studio-dw-write-prepare').onclick=writePrepare;
    el('studio-dw-scene-apply').onclick=applyScene;
    el('studio-dw-playbook-apply').onclick=applyPlaybook;
    ['studio-dw-playbook-close','studio-dw-playbook-cancel'].forEach(function (id) {
      el(id).onclick=function () {el('studio-dw-playbook-review').close();};
    });
    ['studio-dw-scene-close','studio-dw-scene-cancel'].forEach(function (id) {
      el(id).onclick=function () {el('studio-dw-scene-review').close();};
    });
    renderReadiness(readiness);
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind);
  else bind();
})();
