/* Browser-only, append-only revisions for editable textareas. */
(function () {
  'use strict';
  var histories = new Map();
  var active = null;
  var timers = new Map();
  var idleMs = 10000;
  var toolbar = null;
  var originalPaddingBottom = '';
  var showingPreview = false;

  // Explicit field types, shared by Settings and the live editor. New textareas
  // have no revision history until deliberately classified here.
  var fieldTypes = [
    {
      "group": "Studio — Project",
      "id": "project.overview",
      "label": "Project overview / concept",
      "selector": "#storyboard-story-concept, #studio-brief-concept, #studio-project-concept",
      "enabled": true
    },
    {
      "group": "Studio — Project",
      "id": "project.style",
      "label": "Visual style / atmosphere",
      "selector": "#storyboard-story-style, #studio-brief-style, #studio-project-style",
      "enabled": true
    },
    {
      "group": "Studio — Project",
      "id": "project.invariants",
      "label": "Project invariants / guidelines",
      "selector": ".studio-project-invariant textarea, textarea[data-story-guideline]",
      "enabled": true
    },
    {
      "group": "Studio — Project",
      "id": "project.sceneBrief",
      "label": "Project creation Scene brief",
      "selector": "#studio-project-scene-prompt",
      "enabled": false
    },
    {
      "group": "Studio — Scenes",
      "id": "scene.prompt",
      "label": "Scene production prompts",
      "selector": "textarea[data-scene-field=\"prompt\"], #studio-scene-draft-prompt, #studio-scenes-rows textarea[data-field=\"prompt\"], #studio-dw-scene-editors textarea[data-field=\"prompt\"], #studio-dw-batch-editors textarea[data-field=\"prompt\"]",
      "enabled": true
    },
    {
      "group": "Studio — Scenes",
      "id": "scene.entry",
      "label": "Scene entry state",
      "selector": "textarea[data-scene-field=\"entryState\"]",
      "enabled": false
    },
    {
      "group": "Studio — Scenes",
      "id": "scene.exit",
      "label": "Scene exit state",
      "selector": "textarea[data-scene-field=\"exitState\"]",
      "enabled": false
    },
    {
      "group": "Studio — Scenes",
      "id": "scene.instructions",
      "label": "Scene creation / Director instructions",
      "selector": "#storyboard-scene-creation-instruction, #storyboard-director-tools-instruction, #studio-dw-write-instruction, #director-studio-revision-input",
      "enabled": false
    },
    {
      "group": "Generations",
      "id": "generation.prompt",
      "label": "Generation prompt",
      "selector": "#generate-prompt",
      "enabled": true
    },
    {
      "group": "Generations",
      "id": "generation.testPrompt",
      "label": "Test Generations prompt",
      "selector": "#test-generations-prompt",
      "enabled": false
    },
    {
      "group": "Generations",
      "id": "generation.wildcard",
      "label": "Wildcard prompt output",
      "selector": "#test-generations-wildcard-output",
      "enabled": false
    },
    {
      "group": "Generations",
      "id": "generation.epochPrompt",
      "label": "Epoch Finder test prompt",
      "selector": "#epoch-finder-prompt",
      "enabled": false
    },
    {
      "group": "Captions & Prep",
      "id": "caption.editor",
      "label": "Caption editor",
      "selector": "#editor",
      "enabled": false
    },
    {
      "group": "Captions & Prep",
      "id": "caption.primer",
      "label": "Set caption template",
      "selector": "#primer-template",
      "enabled": false
    },
    {
      "group": "Captions & Prep",
      "id": "caption.setNotes",
      "label": "Set notes",
      "selector": "#set-notes-editor",
      "enabled": false
    },
    {
      "group": "Captions & Prep",
      "id": "caption.sheet",
      "label": "Combined caption sheet (read-only)",
      "selector": "#caption-sheet-text",
      "enabled": false
    },
    {
      "group": "Evaluations & Utilities",
      "id": "evaluation.vision",
      "label": "Ask Vision question",
      "selector": "#ask-vision-question",
      "enabled": false
    },
    {
      "group": "Evaluations & Utilities",
      "id": "evaluation.stats",
      "label": "Statistics phrases",
      "selector": "#stats-phrases",
      "enabled": false
    },
    {
      "group": "LoRA Profiles",
      "id": "lora.epochDescription",
      "label": "Epoch profile description",
      "selector": "#epoch-profile-description",
      "enabled": false
    },
    {
      "group": "LoRA Profiles",
      "id": "lora.epochWords",
      "label": "Epoch trigger words",
      "selector": "#epoch-profile-words",
      "enabled": false
    },
    {
      "group": "LoRA Profiles",
      "id": "lora.epochOptions",
      "label": "Epoch named options JSON",
      "selector": "#epoch-profile-options",
      "enabled": false
    },
    {
      "group": "LoRA Profiles",
      "id": "lora.epochGuidance",
      "label": "Epoch Director guidance",
      "selector": "#epoch-profile-guidance",
      "enabled": false
    },
    {
      "group": "LoRA Profiles",
      "id": "lora.libraryDescription",
      "label": "Library profile description",
      "selector": "#lora-library-description",
      "enabled": false
    },
    {
      "group": "LoRA Profiles",
      "id": "lora.libraryWords",
      "label": "Library trained phrases",
      "selector": "#lora-library-words",
      "enabled": false
    },
    {
      "group": "LoRA Profiles",
      "id": "lora.libraryOptions",
      "label": "Library options JSON (read-only unless enabled)",
      "selector": "#lora-library-options",
      "enabled": false
    },
    {
      "group": "LoRA Profiles",
      "id": "lora.libraryGuidance",
      "label": "Library guidance",
      "selector": "#lora-library-guidance",
      "enabled": false
    },
    {
      "group": "Settings & Reusable Content",
      "id": "settings.primer",
      "label": "Default caption template",
      "selector": "#app-settings-primer-template",
      "enabled": false
    },
    {
      "group": "Settings & Reusable Content",
      "id": "settings.modelGuidance",
      "label": "Model guidance",
      "selector": "#app-settings-model-guidance-minimax_h3, #app-settings-model-guidance-krea2_raw",
      "enabled": false
    },
    {
      "group": "Settings & Reusable Content",
      "id": "settings.sequence",
      "label": "Caption sequence hint",
      "selector": "#app-settings-caption-sequence",
      "enabled": false
    },
    {
      "group": "Settings & Reusable Content",
      "id": "settings.json",
      "label": "Advanced configuration JSON",
      "selector": "#app-settings-json",
      "enabled": false
    },
    {
      "group": "Settings & Reusable Content",
      "id": "studio.blocks",
      "label": "Reusable Studio Block",
      "selector": "#studio-blocks-content",
      "enabled": false
    }
  ];
  var preferenceKey = 'webcap.textarea-history.preferences.v1';
  var preferenceDefaults = {};
  fieldTypes.forEach(function (item) { preferenceDefaults[item.id] = item.enabled; });
  var preferences = {master:true, fields:Object.assign({},preferenceDefaults)};
  try {
    var stored = JSON.parse(window.localStorage.getItem(preferenceKey) || 'null');
    if (stored && typeof stored === 'object') {
      if (typeof stored.master === 'boolean') preferences.master = stored.master;
      if (stored.fields && typeof stored.fields === 'object') {
        Object.keys(preferenceDefaults).forEach(function (id) {
          if (typeof stored.fields[id] === 'boolean') preferences.fields[id] = stored.fields[id];
        });
      }
    }
  } catch (error) { /* Browser storage can be disabled; defaults still work. */ }

  function fieldType(field) {
    if (!field || !field.matches) return null;
    for (var i=0; i<fieldTypes.length; i++) {
      if (field.matches(fieldTypes[i].selector)) return fieldTypes[i];
    }
    return null;
  }
  function enabledFor(field) {
    var type = fieldType(field);
    return !!(type && preferences.master && preferences.fields[type.id] &&
      !field.disabled && !field.readOnly && field.dataset.noRevisionHistory !== 'true');
  }
  function savePreferences() {
    try { window.localStorage.setItem(preferenceKey, JSON.stringify(preferences)); }
    catch (error) { /* Keep current-session choices if browser storage is unavailable. */ }
  }
  function updatePreferences() {
    if (active && !enabledFor(active.field)) detach();
    renderSettings();
  }
  function setEnabled(id, value) {
    if (!Object.prototype.hasOwnProperty.call(preferenceDefaults,id)) return;
    preferences.fields[id] = !!value;
    savePreferences();
    updatePreferences();
  }
  function setMasterEnabled(value) {
    preferences.master = !!value;
    savePreferences();
    updatePreferences();
  }
  function renderSettings() {
    var host = document.getElementById('app-settings-textarea-history');
    if (!host) return;
    host.replaceChildren();
    var master = document.createElement('label'), masterInput = document.createElement('input'),
      masterText = document.createElement('span');
    master.className = 'app-settings-toggle';
    masterInput.type = 'checkbox'; masterInput.checked = preferences.master;
    masterInput.setAttribute('aria-label','Enable textarea history');
    masterInput.addEventListener('change',function () {setMasterEnabled(masterInput.checked);});
    masterText.textContent = 'Enable textarea history';
    master.append(masterInput,masterText);
    host.appendChild(master);
    var current = '', group = null;
    fieldTypes.forEach(function (item) {
      if (item.group !== current) {
        current = item.group;
        group = document.createElement('fieldset');
        group.className = 'webcap-history-group';
        var heading = document.createElement('legend');
        heading.textContent = current;
        group.appendChild(heading);
        host.appendChild(group);
      }
      var label = document.createElement('label'), input = document.createElement('input'),
        text = document.createElement('span');
      label.className = 'app-settings-toggle';
      input.type = 'checkbox'; input.checked = !!preferences.fields[item.id];
      input.disabled = !preferences.master;
      input.setAttribute('data-history-field',item.id);
      input.addEventListener('change',function () {setEnabled(item.id,input.checked);});
      text.textContent = item.label;
      label.append(input,text);
      group.appendChild(label);
    });
  }

  // Fallback for unnamed editors created from templates. Stable while their
  // surrounding row structure remains the same; semantic data keys win above.
  function structuralKey(field) {
    var parts = [], node = field;
    while (node && node.tagName && parts.length < 10) {
      if (node.id) {parts.unshift('#' + node.id);break;}
      var parent = node.parentElement;
      var sameTag = parent ? Array.from(parent.children).filter(function (item) {
        return item.tagName === node.tagName;
      }) : [node];
      parts.unshift(node.tagName.toLowerCase() + ':' + sameTag.indexOf(node));
      node = parent;
    }
    return parts.join('/');
  }

  function identity(field) {
    if (field.dataset.revisionKey) return field.dataset.revisionKey;
    if (field.id === 'editor' && typeof getAutosaveTargetAndPayload === 'function') {
      var target = getAutosaveTargetAndPayload();
      if (target && target.key) return 'editor:' + target.key;
    }
    var scene = field.closest('[data-scene-id]');
    var project = '';
    var isStudio = scene || /^(storyboard-|studio-brief-|studio-scene-)/.test(field.id) ||
      !!field.closest('#storyboard-workspace, #studio-director-workbench, #director-chat-drawer');
    if (isStudio && typeof window.getStudioDirectorNavigation === 'function') {
      var nav = window.getStudioDirectorNavigation();
      project = String(nav && nav.projectId || '');
    }
    var marker = field.id || field.getAttribute('name') ||
      (field.dataset.sceneField ? 'scene-field:' + field.dataset.sceneField :
       field.dataset.storyGuideline ? 'story-guideline:' + field.dataset.storyGuideline :
       field.getAttribute('aria-label') || 'textarea');
    if (!field.id && !field.dataset.sceneField && !field.dataset.storyGuideline)
      marker += ':' + structuralKey(field);
    var scope = field.closest('[data-item-id],[data-file-name],[data-media-id],[data-set-id],[data-scene-id]');
    var scoped = scope && Array.from(scope.attributes).filter(function (a) {
      return /^(data-item-id|data-file-name|data-media-id|data-set-id|data-scene-id)$/.test(a.name);
    }).map(function (a) {return a.name + '=' + a.value;}).join(':');
    return (project ? 'project:' + project + ':' : '') + (scoped ? scoped + ':' : '') + marker;
  }

  function capture(key, value) {
    var h = histories.get(key);
    if (!h) {h = {versions:[], index:0}; histories.set(key,h);}
    value = String(value == null ? '' : value);
    if (!h.versions.length || h.versions[h.versions.length-1] !== value) h.versions.push(value);
    h.index = h.versions.length-1;
    return h;
  }

  function checkpoint() {
    if (!active || showingPreview) return;
    capture(active.key, active.field.value);
    draw();
  }

  function schedule(key, value) {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(function () {
      timers.delete(key);
      capture(key, value);
      if (active && active.key === key && !showingPreview) draw();
    }, idleMs));
  }

  function restorePreview() {
    if (!active || !showingPreview) return;
    var h = histories.get(active.key);
    if (active.field.isConnected && identity(active.field) === active.key && h &&
        active.field.value === h.versions[h.index]) active.field.value = active.live;
    if (h) h.index = h.versions.length - 1;
    showingPreview = false;
  }

  function position() {
    if (!active || !toolbar) return;
    if (!active.field.isConnected) {detach();return;}
    var rect = active.field.getBoundingClientRect();
    toolbar.style.display = rect.width < 100 || rect.bottom <= 0 || rect.top >= innerHeight ||
      rect.bottom > innerHeight + 1 ? 'none' : 'flex';
    // Keep the small, opaque control at the bottom-right; no centered
    // overlay spanning the text. The background masks scrollable text below.
    toolbar.style.top = (rect.bottom - (toolbar.offsetHeight || 23) - 4) + 'px';
    toolbar.style.left = Math.max(rect.left || 0,
      rect.right - (toolbar.offsetWidth || 66) - 5) + 'px';
  }

  function draw() {
    if (!active || !toolbar) return;
    var h = histories.get(active.key);
    toolbar.querySelector('[data-rev-count]').textContent =
      h && h.versions.length ? (h.index+1) + '/' + h.versions.length : '1/1';
    toolbar.querySelector('[data-rev-prev]').disabled = !h || h.index === 0;
    toolbar.querySelector('[data-rev-next]').disabled = !h || h.index >= h.versions.length-1;
    position();
  }

  function detach() {
    if (!active) return;
    restorePreview();
    active.field.style.paddingBottom = originalPaddingBottom;
    active = null;
    if (toolbar) toolbar.style.display = 'none';
  }

  function attach(field) {
    if (!enabledFor(field)) return;
    var key = identity(field);
    if (active && active.field === field && active.key === key) return;
    detach();
    if (!histories.has(key)) capture(key,field.value);
    active = {field:field,key:key,live:field.value};
    originalPaddingBottom = field.style.paddingBottom;
    if (field.getBoundingClientRect().width >= 100) {
      var bottomPadding = parseFloat(getComputedStyle(field).paddingBottom) || 0;
      field.style.paddingBottom = Math.max(bottomPadding, 29) + 'px';
    }
    var host = field.closest('dialog[open]') || document.body;
    if (toolbar.parentNode !== host) host.appendChild(toolbar);
    var h = histories.get(key);
    if (h && h.versions[h.versions.length - 1] !== field.value) schedule(key,field.value);
    draw();
  }

  function step(direction) {
    if (!active) return;
    if (identity(active.field) !== active.key) attach(active.field);
    clearTimeout(timers.get(active.key));
    timers.delete(active.key);
    if (!showingPreview) {
      capture(active.key,active.field.value);
      active.live = active.field.value;
    }
    var h = histories.get(active.key);
    var next = h.index + direction;
    if (next < 0 || next >= h.versions.length) {draw();return;}
    h.index = next;
    active.field.value = h.versions[next];
    showingPreview = h.index !== h.versions.length-1;
    if (!showingPreview) active.live = active.field.value;
    draw();
  }

  function initialize() {
    var style = document.createElement('style');
    style.textContent = '.webcap-revision-tools{position:fixed;box-sizing:border-box;display:none;align-items:center;gap:1px;z-index:99999;height:23px;padding:0 3px;pointer-events:none;background:var(--panel, Canvas);color:var(--text, CanvasText);border:0;border-radius:3px;box-shadow:none;font:12px sans-serif}.webcap-revision-tools button{border:0;background:transparent;color:inherit;cursor:pointer;pointer-events:auto;min-width:17px;min-height:20px;padding:0}.webcap-revision-tools button:disabled{opacity:.3;cursor:default}.webcap-revision-tools span{min-width:27px;text-align:center;font-variant-numeric:tabular-nums}';
    document.head.appendChild(style);
    toolbar = document.createElement('div');
    toolbar.className = 'webcap-revision-tools';
    toolbar.setAttribute('aria-label','Textarea revisions');
    toolbar.innerHTML = '<button type="button" data-rev-prev aria-label="Previous revision" title="Previous revision">&#x2039;</button><span data-rev-count>1/1</span><button type="button" data-rev-next aria-label="Next revision" title="Next revision">&#x203a;</button>';
    document.body.appendChild(toolbar);
    toolbar.addEventListener('pointerdown',function (event) {event.preventDefault();});
    toolbar.addEventListener('click',function (event) {
      var prev = event.target.closest('[data-rev-prev]');
      var next = event.target.closest('[data-rev-next]');
      if (prev || next) step(prev ? -1 : 1);
    });
    document.addEventListener('focusin',function (event) {
      if (event.target.matches && event.target.matches('textarea') && enabledFor(event.target)) attach(event.target);
      else if (!toolbar.contains(event.target)) detach();
    });
    document.addEventListener('focusout',function (event) {
      if (!active || event.target !== active.field) return;
      if (toolbar.contains(event.relatedTarget)) return;
      detach();
    },true);
    document.addEventListener('change',function (event) {
      if (active && event.target === active.field && showingPreview) restorePreview();
    },true);
    document.addEventListener('input',function (event) {
      if (!active || event.target !== active.field) return;
      if (identity(event.target) !== active.key) attach(event.target);
      showingPreview = false;
      active.live = active.field.value;
      schedule(active.key,active.live);
    },true);
    window.addEventListener('scroll',position,true);
    window.addEventListener('resize',position);
    renderSettings();
  }

  window.webcapTextareaRevisions = {identity:identity,capture:capture,history:function (key) {return histories.get(key);}, fieldTypes:fieldTypes, enabledFor:enabledFor, setEnabled:setEnabled, setMasterEnabled:setMasterEnabled, renderSettings:renderSettings};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',initialize);
  else initialize();
})();
