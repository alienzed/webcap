/* Browser-only, append-only revisions for editable textareas. */
(function () {
  'use strict';
  var histories = new Map();
  var active = null;
  var timer = 0;
  var idleMs = 10000;
  var toolbar = null;
  var originalPadding = '';
  var showingPreview = false;

  function identity(field) {
    if (field.dataset.revisionKey) return field.dataset.revisionKey;
    if (field.id === 'editor' && typeof getAutosaveTargetAndPayload === 'function') {
      var target = getAutosaveTargetAndPayload();
      if (target && target.key) return 'editor:' + target.key;
    }
    var scene = field.closest('[data-scene-id]');
    var project = '';
    if (scene && typeof window.getStudioDirectorNavigation === 'function') {
      var nav = window.getStudioDirectorNavigation();
      project = String(nav && nav.projectId || '');
    }
    var marker = field.id || field.getAttribute('name') ||
      (field.dataset.sceneField ? 'scene-field:' + field.dataset.sceneField :
       field.dataset.storyGuideline ? 'story-guideline:' + field.dataset.storyGuideline :
       field.getAttribute('aria-label') || 'textarea');
    var parent = field.parentElement;
    var siblings = parent ? Array.from(parent.querySelectorAll('textarea')).filter(function (item) {
      return !item.id && !item.name && !item.dataset.sceneField && !item.dataset.storyGuideline;
    }) : [];
    if (!field.id && !field.name && !field.dataset.sceneField && !field.dataset.storyGuideline)
      marker += ':' + siblings.indexOf(field);
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

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(function () {timer = 0; checkpoint();},idleMs);
  }

  function restorePreview() {
    if (!active || !showingPreview) return;
    active.field.value = active.live;
    showingPreview = false;
  }

  function position() {
    if (!active || !toolbar) return;
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
    clearTimeout(timer);
    timer = 0;
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
    field.style.paddingRight = '120px';
    schedule();
    draw();
  }

  function step(direction) {
    if (!active) return;
    clearTimeout(timer); timer = 0;
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
    style.textContent = '.webcap-revision-tools{position:fixed;display:none;align-items:center;gap:2px;z-index:1100;padding:2px;background:var(--surface, #262b33);color:var(--text, #fff);border:1px solid var(--border-color, #888);border-radius:7px;font:12px sans-serif;box-shadow:0 1px 4px #0003}.webcap-revision-tools button{border:0;background:transparent;color:inherit;cursor:pointer;min-width:24px;min-height:25px;padding:2px}.webcap-revision-tools button:disabled{opacity:.3;cursor:default}.webcap-revision-tools span{min-width:39px;text-align:center;font-variant-numeric:tabular-nums}';
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
    });
    document.addEventListener('focusout',function (event) {
      if (!active || event.target !== active.field) return;
      if (toolbar.contains(event.relatedTarget)) return;
      detach();
    },true);
    document.addEventListener('input',function (event) {
      if (!active || event.target !== active.field) return;
      showingPreview = false;
      active.live = active.field.value;
      schedule();
    },true);
    window.addEventListener('scroll',position,true);
    window.addEventListener('resize',position);
  }

  window.webcapTextareaRevisions = {identity:identity,capture:capture,history:function (key) {return histories.get(key);}};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',initialize);
  else initialize();
})();
