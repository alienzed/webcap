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
  // A single text-insertion picker serves Studio chat and Project Invariant
  // descriptions. Neither source becomes a stored reference or hidden context.
  function setupSlash() {
    var chat = el('director-chat-input');
    var chatHost = el('studio-blocks-slash');
    var invariantHost = document.createElement('div');
    invariantHost.className = 'studio-blocks-slash studio-blocks-slash-floating hidden';
    invariantHost.setAttribute('role', 'listbox');
    invariantHost.setAttribute('aria-label', 'Insert Studio Block');
    invariantHost.id = 'studio-blocks-invariant-slash';
    document.body.appendChild(invariantHost);

    var input = null, host = null, match = null, available = [], filtered = [];
    var active = 0, requestId = 0, loading = false, error = '';
    function isInvariant(element) {
      return !!element && element.matches('[data-story-invariant-text]');
    }
    function isSupported(element) {
      return element === chat ? window.studioDirectorBridge.isStudioMode() : isInvariant(element);
    }
    function close() {
      requestId++;
      if (input) input.setAttribute('aria-expanded', 'false');
      if (host) { host.replaceChildren(); host.classList.add('hidden'); }
      input = null; host = null; match = null; filtered = []; available = [];
      loading = false; error = '';
    }
    function position() {
      if (host !== invariantHost || !input) return;
      var rect = input.getBoundingClientRect();
      var width = Math.min(Math.max(260, rect.width), window.innerWidth - 16);
      host.style.left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8) + 'px';
      host.style.width = width + 'px';
      var roomBelow = window.innerHeight - rect.bottom;
      if (roomBelow >= 180 || roomBelow >= rect.top) {
        host.style.top = Math.min(window.innerHeight - 16, rect.bottom + 4) + 'px';
        host.style.bottom = 'auto';
      } else {
        host.style.top = 'auto';
        host.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
      }
    }
    function render() {
      if (!input || !match) return;
      host.classList.remove('hidden');
      input.setAttribute('aria-expanded', 'true');
      position();
      host.replaceChildren();
      filtered = available.filter(function (item) {
        return (item.title + ' ' + item.kind + ' ' + item.text)
          .toLocaleLowerCase().includes(match.query);
      }).slice(0, 8);
      if (active >= filtered.length) active = 0;
      if (!filtered.length) {
        var note = document.createElement('p');
        note.className = 'studio-blocks-slash-empty';
        note.textContent = loading ? 'Loading Blocks…' : error ||
          (isInvariant(input) ? 'No matching Blocks.' : 'No matching Blocks or Invariants.');
        host.appendChild(note);
        return;
      }
      filtered.forEach(function (item, index) {
        var button = document.createElement('button');
        var title = document.createElement('strong'), detail = document.createElement('small');
        button.type = 'button';
        button.tabIndex = -1;
        button.className = 'studio-blocks-slash-item' + (index === active ? ' active' : '');
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', index === active ? 'true' : 'false');
        title.textContent = item.title;
        detail.textContent = item.kind + ' · ' + item.text.replace(/\s+/g, ' ').slice(0, 100);
        button.append(title, detail);
        button.onpointerdown = function (event) { event.preventDefault(); };
        button.onclick = function () { insert(item); };
        host.appendChild(button);
      });
    }
    function insert(item) {
      if (!input || !isSupported(input)) { close(); return; }
      var current = slashMatch(input.value, input.selectionStart);
      if (!current) { close(); return; }
      var target = input, before = target.value.slice(0, current.start);
      var after = target.value.slice(current.end);
      var replacement = item.text + (/\s$/.test(item.text) || /^\s/.test(after) ? '' : ' ');
      target.value = before + replacement + after;
      var caret = before.length + replacement.length;
      close();
      target.focus();
      target.setSelectionRange(caret, caret);
      target.dispatchEvent(new Event('input', {bubbles:true}));
    }
    function update(target) {
      var current = target && isSupported(target)
        ? slashMatch(target.value, target.selectionStart) : null;
      if (!current) {
        if (target === input) close();
        return;
      }
      var switched = input !== target;
      if (switched) close();
      input = target;
      host = isInvariant(target) ? invariantHost : chatHost;
      match = current;
      active = 0;
      if (!switched) {
        // Project Invariants are read from the live editor, not an old saved copy.
        if (host === chatHost) available = available.filter(function (item) { return item.source !== 'invariant'; })
          .concat(invariants());
        render();
        return;
      }
      target.setAttribute('aria-controls', host.id);
      loading = true;
      available = host === chatHost ? invariants() : [];
      render();
      var id = ++requestId;
      api('').then(function (result) {
        if (id !== requestId || target !== input) return;
        available = (result.blocks || []).map(function (block) {
          return {source:'block', title:block.title, kind:block.type === 'guidance' ? 'Guidance Block' : 'Idea Block',
            text:block.content};
        }).concat(host === chatHost ? invariants() : []);
        loading = false;
        render();
      }).catch(function (failure) {
        if (id !== requestId || target !== input) return;
        loading = false;
        error = 'Could not load Blocks; check the Console.';
        report(failure);
        render();
      });
    }
    function invariants() {
      return window.getStoryboardSlashInvariants().map(function (item) {
        return {source:'invariant', title:item.title || 'Untitled Invariant',
          kind:(item.kind || 'Project') + ' Invariant', text:item.text};
      });
    }
    chat.setAttribute('aria-controls', chatHost.id);
    chat.setAttribute('aria-expanded', 'false');
    document.addEventListener('input', function (event) {
      if (event.target === chat || isInvariant(event.target)) update(event.target);
    });
    document.addEventListener('click', function (event) {
      if (event.target === chat || isInvariant(event.target)) update(event.target);
      else if (input && !event.target.closest('.studio-blocks-slash')) close();
    });
    // Capture before Director's Enter-to-send/history handlers.
    document.addEventListener('keydown', function (event) {
      if (!input || event.target !== input || !isSupported(input)) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); close(); return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (filtered.length) active = (active + (event.key === 'ArrowDown' ? 1 : -1) +
          filtered.length) % filtered.length;
        render(); return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && filtered.length) {
        event.preventDefault(); event.stopImmediatePropagation();
        insert(filtered[active]);
      }
    }, true);
    document.addEventListener('focusout', function (event) {
      if (event.target === input) close();
    });
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
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
