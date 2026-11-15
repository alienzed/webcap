/* Browser-only, append-only revisions for editable textareas. */
(function () {
  'use strict';
  var histories = new Map();
  var active = null;
  var timers = new Map();
  var idleMs = 10000;
  var toolbar = null;
  var originalPadding = '';
  var showingPreview = false;

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
    toolbar.style.display = rect.width < 135 || rect.bottom < 0 || rect.top > innerHeight
      ? 'none' : 'flex';
    toolbar.style.top = Math.max(0,rect.top + 5) + 'px';
    toolbar.style.left = Math.max(0,rect.right - 113) + 'px';
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
    active.field.style.paddingRight = originalPadding;
    active = null;
    if (toolbar) toolbar.style.display = 'none';
  }

  function attach(field) {
    if (field.disabled || field.readOnly || field.dataset.noRevisionHistory === 'true') return;
    var key = identity(field);
    if (active && active.field === field && active.key === key) return;
    detach();
    if (!histories.has(key)) capture(key,field.value);
    active = {field:field,key:key,live:field.value};
    originalPadding = field.style.paddingRight;
    if (field.getBoundingClientRect().width >= 135) field.style.paddingRight = '120px';
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
    style.textContent = '.webcap-revision-tools{position:fixed;display:none;align-items:center;gap:2px;z-index:99999;padding:2px;background:var(--panel, Canvas);color:var(--text, CanvasText);border:1px solid var(--border, #888);border-radius:7px;font:12px sans-serif;box-shadow:0 1px 4px #0003}.webcap-revision-tools button{border:0;background:transparent;color:inherit;cursor:pointer;min-width:24px;min-height:25px;padding:2px}.webcap-revision-tools button:disabled{opacity:.3;cursor:default}.webcap-revision-tools span{min-width:39px;text-align:center;font-variant-numeric:tabular-nums}';
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
      if (event.target.matches && event.target.matches('textarea')) attach(event.target);
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
  }

  window.webcapTextareaRevisions = {identity:identity,capture:capture,history:function (key) {return histories.get(key);}};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',initialize);
  else initialize();
})();
