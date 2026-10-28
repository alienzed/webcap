/* Studio Blocks: owns its library editor and opt-in slash insertion. */
(function () {
  'use strict';
  var blocks = [], selected = null, dirty = false, pickerItems = [], active = 0, catalogLoaded = false, catalogLoading = false;
  var $ = function (id) { return document.getElementById(id); };
  function error(e) {
    $('studio-blocks-status').textContent = e.message || String(e);
    if (window.reportConsoleError) window.reportConsoleError('Studio Blocks', e);
    else console.error('[Studio Blocks]', e);
  }
  async function api(path, options) {
    var response = await fetch('/fs/studio-blocks' + (path || ''), options);
    var result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Studio Blocks request failed.');
    return result;
  }
  function readEditor() {
    return { type: $('studio-blocks-type').value, title: $('studio-blocks-title').value, content: $('studio-blocks-content').value };
  }
  function confirmDiscard() { return !dirty || window.confirm('Discard unsaved Block edits?'); }
  function show(block) {
    if (!confirmDiscard()) return;
    selected = block ? block.id : null;
    $('studio-blocks-type').value = block ? block.type : 'idea';
    $('studio-blocks-title').value = block ? block.title : '';
    $('studio-blocks-content').value = block ? block.content : '';
    $('studio-blocks-delete').disabled = !block;
    $('studio-blocks-status').textContent = '';
    dirty = false;
    renderList();
    $('studio-blocks-title').focus();
  }
  function matching(query) {
    var needle = query.toLocaleLowerCase();
    return blocks.filter(function (b) {
      return (b.title + ' ' + b.type + ' ' + b.content).toLocaleLowerCase().includes(needle);
    }).sort(function (a, b) { return a.title.localeCompare(b.title); });
  }
  function renderList() {
    var list = $('studio-blocks-list'), query = $('studio-blocks-search').value;
    list.replaceChildren();
    matching(query).forEach(function (block) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'studio-blocks-list-item' + (selected === block.id ? ' selected' : '');
      var name = document.createElement('strong'), type = document.createElement('small');
      name.textContent = block.title;
      type.textContent = block.type === 'idea' ? 'Idea' : 'Guidance';
      button.append(name, type);
      button.onclick = function () { show(block); };
      list.append(button);
    });
  }
  async function load() {
    blocks = (await api()).blocks;
    catalogLoaded = true;
    renderList();
    updatePicker();
  }
  async function open() {
    $('studio-blocks-dialog').showModal();
    try { await load(); if (!selected && !dirty) show(null); }
    catch (e) { error(e); }
  }
  async function save() {
    var data = readEditor();
    try {
      var previous = blocks.find(function (b) { return b.id === selected; });
      var path = previous ? '/' + encodeURIComponent(previous.id) : '';
      var result = await api(path, { method: previous ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({}, data, previous ? { revision: previous.revision } : {})) });
      dirty = false;
      await load();
      show(result.block);
      $('studio-blocks-status').textContent = 'Saved.';
    } catch (e) { error(e); }
  }
  async function remove() {
    var previous = blocks.find(function (b) { return b.id === selected; });
    if (!previous || !window.confirm('Permanently delete "' + previous.title + '"?')) return;
    try {
      await api('/' + encodeURIComponent(previous.id), { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: previous.revision }) });
      dirty = false;
      selected = null;
      await load();
      show(null);
    } catch (e) { error(e); }
  }
  function studioActive() {
    var root = $('storyboard-workspace'), drawer = $('director-chat-drawer');
    return root && !root.classList.contains('hidden') && drawer && drawer.classList.contains('studio-director');
  }
  function slashMatch() {
    var input = $('director-chat-input');
    if (!input || !studioActive() || $('studio-blocks-dialog').open) return null;
    var before = input.value.slice(0, input.selectionStart);
    var match = /(^|\s)\/([\w -]*)$/.exec(before);
    if (!match || input.selectionStart !== input.selectionEnd) return null;
    return { start: input.selectionStart - match[2].length - 1, end: input.selectionStart, query: match[2] };
  }
  function hidePicker() {
    $('studio-blocks-picker').classList.add('hidden');
    pickerItems = [];
  }
  function insert(block) {
    var input = $('director-chat-input'), match = slashMatch();
    if (!match) return;
    var snapshot = '[Studio Block · ' + block.type + ': ' + block.title + ']\n' + block.content + '\n[/Studio Block]';
    input.setRangeText(snapshot, match.start, match.end, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    hidePicker();
    input.focus();
  }
  function updatePicker() {
    var target = $('studio-blocks-picker'), match = slashMatch();
    if (!match) return hidePicker();
    pickerItems = matching(match.query).slice(0, 9);
    active = 0;
    target.replaceChildren();
    pickerItems.forEach(function (block, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'option');
      button.textContent = block.title + ' · ' + block.type;
      button.className = index === active ? 'active' : '';
      button.onmousedown = function (e) { e.preventDefault(); };
      button.onclick = function () { insert(block); };
      target.append(button);
    });
    target.classList.toggle('hidden', !pickerItems.length);
  }
  function bind() {
    $('studio-blocks-open').onclick = open;
    $('studio-blocks-close').onclick = function () { if (confirmDiscard()) $('studio-blocks-dialog').close(); };
    $('studio-blocks-dialog').addEventListener('cancel', function (e) { if (!confirmDiscard()) e.preventDefault(); });
    $('studio-blocks-new').onclick = function () { show(null); };
    $('studio-blocks-save').onclick = save;
    $('studio-blocks-delete').onclick = remove;
    $('studio-blocks-search').oninput = renderList;
    ['studio-blocks-type', 'studio-blocks-title', 'studio-blocks-content'].forEach(function (id) {
      $(id).addEventListener('input', function () { dirty = true; });
      $(id).addEventListener('change', function () { dirty = true; });
    });
    var input = $('director-chat-input');
    input.addEventListener('input', updatePicker);
    input.addEventListener('click', updatePicker);
    input.addEventListener('keydown', function (e) {
      if ($('studio-blocks-picker').classList.contains('hidden')) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); hidePicker(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopImmediatePropagation();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + pickerItems.length) % pickerItems.length;
        Array.from($('studio-blocks-picker').children).forEach(function (b, i) { b.classList.toggle('active', i === active); });
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && pickerItems.length) {
        e.preventDefault(); e.stopImmediatePropagation(); insert(pickerItems[active]);
      }
    }, true);
    // The catalog is only fetched when opening Blocks or requesting slash suggestions.
    input.addEventListener('input', function () {
      if (!slashMatch() || catalogLoaded || catalogLoading) return;
      catalogLoading = true;
      load().catch(error).finally(function () { catalogLoading = false; });
    });
    $('director-chat-send').addEventListener('click', hidePicker);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
