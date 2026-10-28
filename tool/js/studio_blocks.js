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
  function bind() {
    el('studio-blocks-open').onclick = open;
    el('studio-blocks-close').onclick = function () { el('studio-blocks-dialog').close(); };
    el('studio-blocks-new').onclick = function () { edit(null); el('studio-blocks-title').focus(); };
    el('studio-blocks-save').onclick = save;
    el('studio-blocks-delete').onclick = remove;
    el('studio-blocks-copy').onclick = copy;
    el('studio-blocks-search').oninput = render;
    edit(null);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
