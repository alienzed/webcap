/* Standalone Studio Blocks library. No Director integration. */
(function () {
  'use strict';
  var blocks = [], selectedId = null;
  function el(id) { return document.getElementById(id); }
  function report(error) {
    el('studio-blocks-status').textContent = String(error.message || error);
    if (window.reportConsoleError) window.reportConsoleError('Studio Blocks', error);
    else console.error('[Studio Blocks]', error);
  }
  async function api(path, options) {
    var response = await fetch('/fs/studio-blocks' + (path || ''), options);
    var data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Studio Blocks request failed.');
    return data;
  }
  function current() { return blocks.find(function (b) { return b.id === selectedId; }); }
  function edit(block) {
    selectedId = block ? block.id : null;
    el('studio-blocks-type').value = block ? block.type : 'idea';
    el('studio-blocks-title').value = block ? block.title : '';
    el('studio-blocks-content').value = block ? block.content : '';
    el('studio-blocks-delete').disabled = !block;
    el('studio-blocks-status').textContent = '';
    render();
  }
  function render() {
    var needle = el('studio-blocks-search').value.toLocaleLowerCase();
    var list = el('studio-blocks-list');
    list.replaceChildren();
    blocks.filter(function (b) { return (b.title + ' ' + b.type + ' ' + b.content).toLocaleLowerCase().includes(needle); })
      .sort(function (a, b) { return a.title.localeCompare(b.title); })
      .forEach(function (b) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'studio-blocks-list-item' + (selectedId === b.id ? ' selected' : '');
        var name = document.createElement('strong'), kind = document.createElement('small');
        name.textContent = b.title;
        kind.textContent = b.type === 'idea' ? 'Idea' : 'Guidance';
        button.append(name, kind);
        button.onclick = function () { edit(b); };
        list.append(button);
      });
    if (!list.childElementCount) list.textContent = needle ? 'No matching Blocks.' : 'No Blocks yet. Create your first one.';
  }
  async function reload() {
    blocks = (await api()).blocks;
    render();
  }
  async function open() {
    el('studio-blocks-dialog').showModal();
    try {
      await reload();
      edit(current() || null);
    } catch (error) { report(error); }
  }
  async function save() {
    var block = current();
    var payload = { type: el('studio-blocks-type').value, title: el('studio-blocks-title').value,
      content: el('studio-blocks-content').value };
    try {
      var result = await api(block ? '/' + encodeURIComponent(block.id) : '', {
        method: block ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      await reload();
      edit(result.block);
      el('studio-blocks-status').textContent = 'Saved.';
    } catch (error) { report(error); }
  }
  async function remove() {
    var block = current();
    if (!block || !confirm('Delete Block "' + block.title + '"?')) return;
    try {
      await api('/' + encodeURIComponent(block.id), { method: 'DELETE' });
      await reload();
      edit(null);
    } catch (error) { report(error); }
  }
  async function copy() {
    var text = el('studio-blocks-content').value;
    try {
      await navigator.clipboard.writeText(text);
      el('studio-blocks-status').textContent = 'Copied to clipboard.';
    } catch (error) { report(error); }
  }
  // Slash inserts author-owned text into the current Studio draft. It never
  // attaches hidden context, invokes Director, or writes Project fields.
  function slashMatch(text, caret) {
    var found = /(^|\s)\/([^\s/]*)$/.exec(String(text).slice(0, caret));
    return found ? {start:caret - found[2].length - 1, end:caret,
      query:found[2].toLocaleLowerCase()} : null;
  }
  function setupSlash() {
    var input = el('director-chat-input'), host = el('studio-blocks-slash');
    var available = [], filtered = [], active = 0, opened = false, loading = false, error = '';
    var selection = null, requestId = 0;
    function isStudio() { return window.studioDirectorBridge.isStudioMode(); }
    function close() {
      opened = false; selection = null; filtered = []; available = [];
      requestId++;
      host.replaceChildren();
      host.classList.add('hidden');
      input.setAttribute('aria-expanded', 'false');
    }
    function render() {
      if (!opened || !selection) return;
      host.classList.remove('hidden');
      input.setAttribute('aria-expanded', 'true');
      host.replaceChildren();
      filtered = available.filter(function (block) {
        return (block.title + ' ' + block.type + ' ' + block.content)
          .toLocaleLowerCase().includes(selection.query);
      }).slice(0, 8);
      if (active >= filtered.length) active = 0;
      if (!filtered.length) {
        var note = document.createElement('p');
        note.className = 'studio-blocks-slash-empty';
        note.textContent = loading ? 'Loading Blocks…' : error ||
          'No matching Blocks. Create Ideas or Guidance with the Blocks button.';
        host.appendChild(note);
        return;
      }
      filtered.forEach(function (block, index) {
        var button = document.createElement('button'),
          title = document.createElement('strong'), detail = document.createElement('small');
        button.type = 'button';
        button.tabIndex = -1;
        button.className = 'studio-blocks-slash-item' + (index === active ? ' active' : '');
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', index === active ? 'true' : 'false');
        title.textContent = block.title;
        detail.textContent = (block.type === 'guidance' ? 'Guidance' : 'Idea') +
          ' · ' + block.content.replace(/\s+/g, ' ').slice(0, 100);
        button.append(title, detail);
        button.onpointerdown = function (event) {event.preventDefault();};
        button.onclick = function () {insert(block);};
        host.appendChild(button);
      });
    }
    function insert(block) {
      // The exact visible slash span, never unrelated composer text, is replaced.
      var match = slashMatch(input.value, input.selectionStart);
      if (!match || !isStudio()) {close();return;}
      var before = input.value.slice(0, match.start), after = input.value.slice(match.end);
      var replacement = block.content + (/\s$/.test(block.content) ? '' : ' ');
      input.value = before + replacement + after;
      var caret = before.length + replacement.length;
      close();
      input.focus();
      input.setSelectionRange(caret, caret);
      input.dispatchEvent(new Event('input', {bubbles:true}));
    }
    function update() {
      var match = isStudio() ? slashMatch(input.value, input.selectionStart) : null;
      if (!match) {if (opened) close();return;}
      selection = match;
      if (!opened) {
        opened = true;
        active = 0;
        loading = true;
        error = '';
        render();
        var id = ++requestId;
        api('').then(function (result) {
          if (id !== requestId || !opened) return;
          available = result.blocks;
          loading = false;
          render();
        }).catch(function (failure) {
          if (id !== requestId || !opened) return;
          loading = false;
          error = 'Could not load Blocks; check the Console.';
          report(failure);
          render();
        });
      } else {active = 0;render();}
    }
    input.setAttribute('aria-controls', 'studio-blocks-slash');
    input.setAttribute('aria-expanded', 'false');
    input.addEventListener('input', update);
    input.addEventListener('click', update);
    // Capture before Director's Enter-to-send and arrow-history handlers.
    input.addEventListener('keydown', function (event) {
      if (!opened || !isStudio()) return;
      if (event.key === 'Escape') {
        event.preventDefault();event.stopImmediatePropagation();close();return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();event.stopImmediatePropagation();
        if (filtered.length) active = (active + (event.key === 'ArrowDown' ? 1 : -1) +
          filtered.length) % filtered.length;
        render();return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        if (!filtered.length) return;
        event.preventDefault();event.stopImmediatePropagation();
        insert(filtered[active]);return;
      }
    }, true);
    input.addEventListener('blur', close);
  }
  function bind() {
    el('studio-blocks-open').onclick = open;
    el('studio-blocks-close').onclick = function () { el('studio-blocks-dialog').close(); };
    el('studio-blocks-new').onclick = function () { edit(null); el('studio-blocks-title').focus(); };
    el('studio-blocks-save').onclick = save;
    el('studio-blocks-delete').onclick = remove;
    el('studio-blocks-copy').onclick = copy;
    el('studio-blocks-search').oninput = render;
    setupSlash();
    edit(null);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
