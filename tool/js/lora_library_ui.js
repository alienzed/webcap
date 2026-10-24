// LoRA profile browser. The backend sidecars remain the sole source of truth.
var loraBrowser = {items: [], selected: null, saved: '', busy: false, origin: null, target: null, scan: 0, profile: 0};

function loraEl(id) { return document.getElementById('lora-library-' + id); }
function loraKey(item) { return item.stage + '/' + item.path; }
function loraFolder(item) { var i = item.path.lastIndexOf('/'); return i < 0 ? '(root)' : item.path.slice(0, i); }
function loraStatus(item) {
  if (!item.enriched) return 'missing';
  var e = item.enrichment || {};
  return String(e.description || '').trim() && ((e.trainedWords || []).length || Object.keys(e.promptOptions || {}).length) ? 'ready' : 'partial';
}
function loraLabel(status) { return {missing:'Unprofiled',partial:'Needs details',ready:'Profiled'}[status]; }
function loraReport(error) {
  var message = String(error && error.message || error);
  loraEl('status').textContent = message;
  window.reportConsoleError('LoRA Library', message);
}
function loraRequest(method, body) {
  return fetch('/fs/lora_library', {method: method, headers: {'Content-Type':'application/json'}, body:body ? JSON.stringify(body) : undefined}).then(function (response) {
    return response.json().then(function (data) {
      if (!response.ok || data.ok === false) throw new Error(data.error || 'LoRA Library request failed.');
      return data;
    });
  });
}
function loraConfirmChanges() {
  if (!loraBrowser.selected || !loraBrowser.saved || loraSnapshot() === loraBrowser.saved) return true;
  return window.confirm('Discard unsaved LoRA profile edits?');
}
function loraRow(item) {
  var row = document.createElement('button');
  row.type = 'button';
  row.className = 'lora-library-item';
  row.dataset.key = loraKey(item);
  var main = document.createElement('span'); main.className = 'lora-library-item-main';
  var name = document.createElement('strong'); name.textContent = item.path.split('/').pop().replace(/\.safetensors$/i, '');
  var folder = document.createElement('small'); folder.textContent = item.stage.toUpperCase() + ' / ' + loraFolder(item);
  main.append(name, folder);
  var badge = document.createElement('span'); badge.className = 'lora-library-pill'; badge.textContent = loraLabel(loraStatus(item));
  badge.dataset.state = loraStatus(item);
  row.append(main, badge);
  row.addEventListener('click', function () { loraSelect(item); });
  return row;
}
function loraFilters() {
  var stage = loraEl('stage').value, folder = loraEl('folder').value, profile = loraEl('filter').value;
  var search = loraEl('search').value.trim().toLocaleLowerCase(), sort = loraEl('sort').value;
  var filtered = loraBrowser.items.filter(function (item) {
    if (stage && item.stage !== stage) return false;
    if (folder && item.stage + '/' + loraFolder(item) !== folder) return false;
    if (profile && loraStatus(item) !== profile) return false;
    var e = item.enrichment || {};
    return !search || [item.stage, item.path, e.description, e.guidance].concat(e.trainedWords || [], Object.keys(e.promptOptions || {}), ...Object.values(e.promptOptions || {})).join(' ').toLocaleLowerCase().includes(search);
  });
  filtered.sort(function (a,b) {
    if (sort === 'profile') return loraStatus(a).localeCompare(loraStatus(b)) || a.path.localeCompare(b.path);
    if (sort === 'name') return a.path.split('/').pop().localeCompare(b.path.split('/').pop()) || a.stage.localeCompare(b.stage);
    return loraKey(a).localeCompare(loraKey(b));
  });
  var list = loraEl('list'), present = new Map(Array.from(list.children).map(function (row) { return [row.dataset.key, row]; }));
  var keep = new Set(filtered.map(loraKey));
  present.forEach(function (row, key) { if (!keep.has(key)) row.remove(); });
  filtered.forEach(function (item, index) {
    var key = loraKey(item), row = present.get(key);
    if (!row) row = loraRow(item);
    row.classList.toggle('selected', !!loraBrowser.selected && key === loraKey(loraBrowser.selected));
    row.setAttribute('aria-pressed', row.classList.contains('selected') ? 'true' : 'false');
    if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
  });
  if (!filtered.length) {
    var empty = document.createElement('p'); empty.className = 'lora-library-no-results';
    empty.textContent = loraBrowser.items.length ? 'No matching LoRAs.' : 'No LoRAs found in configured roots.';
    list.appendChild(empty);
  }
  loraEl('status').textContent = filtered.length + ' shown / ' + loraBrowser.items.length + ' discovered · ' +
    loraBrowser.items.filter(function (x) { return loraStatus(x) === 'ready'; }).length + ' profiled';
}
function loraChoices() {
  var stages = Array.from(new Set(loraBrowser.items.map(function (i) { return i.stage; }))).sort();
  var stage = loraEl('stage'), oldStage = stage.value;
  stage.replaceChildren(new Option('All models', ''));
  stages.forEach(function (s) { stage.add(new Option(s.toUpperCase(), s)); });
  stage.value = stages.includes(oldStage) ? oldStage : '';
  var folder = loraEl('folder'), oldFolder = folder.value;
  folder.replaceChildren(new Option('All folders', ''));
  var folders = Array.from(new Set(loraBrowser.items.filter(function (i) { return !stage.value || i.stage === stage.value; }).map(function (i) { return i.stage + '/' + loraFolder(i); }))).sort();
  folders.forEach(function (f) { folder.add(new Option(f, f)); });
  folder.value = folders.includes(oldFolder) ? oldFolder : '';
}
function loraScan(target) {
  var scan = ++loraBrowser.scan; loraEl('status').textContent = 'Scanning configured LoRA roots…';
  return loraRequest('GET').then(function (data) {
    if (scan !== loraBrowser.scan) return;
    loraBrowser.items = data.items || [];
    loraChoices(); loraFilters();
    (data.warnings || []).forEach(function (w) { window.reportConsoleWarning('LoRA Library', 'Missing configured root: ' + w.stage + ' / ' + w.path); });
    if (data.warnings && data.warnings.length) loraEl('status').textContent += ' · ' + data.warnings.length + ' missing root(s)';
    if (target) {
      var exact = loraBrowser.items.filter(function (item) { return (!target.stage || item.stage === target.stage) && (item.name.toLowerCase() === target.name.toLowerCase() || item.path.toLowerCase() === target.name.toLowerCase()); });
      if (exact.length !== 1) throw new Error(exact.length ? 'LoRA name is ambiguous across configured roots.' : 'LoRA is not present in configured model roots.');
      return loraSelect(exact[0]);
    }
    if (loraBrowser.selected) {
      var found = loraBrowser.items.find(function (item) { return loraKey(item) === loraKey(loraBrowser.selected); });
      if (found) { loraBrowser.selected = found; loraFilters(); }
      else loraDeselect();
    }
  }).catch(loraReport);
}
function loraSnapshot() {
  return JSON.stringify({description:loraEl('description').value.trim(),trainedWords:loraEl('words').value.split(/\r?\n/).map(function(s){return s.trim();}).filter(Boolean),promptOptions:loraOptions(),guidance:loraEl('guidance').value.trim()});
}
function loraOptions() {
  if (loraEl('json-edit').checked) return JSON.parse(loraEl('options').value || '{}');
  var groups = {};
  loraEl('groups').querySelectorAll('.lora-library-group').forEach(function (group) {
    var name = group.querySelector('.lora-library-group-name').value.trim();
    if (!name) throw new Error('Each prompt-option group needs a name.');
    if (Object.prototype.hasOwnProperty.call(groups, name)) throw new Error('Duplicate prompt-option group: ' + name);
    groups[name] = Array.from(group.querySelectorAll('.lora-library-phrase')).map(function (input) { return input.value.trim(); }).filter(Boolean);
  });
  return groups;
}
function loraSyncJson() {
  if (!loraEl('json-edit').checked) loraEl('options').value = JSON.stringify(loraOptions(), null, 2);
}
function loraGroup(name, phrases) {
  var group = document.createElement('div'); group.className = 'lora-library-group';
  var heading = document.createElement('div'); heading.className = 'lora-library-group-heading';
  var input = document.createElement('input'); input.className = 'lora-library-group-name'; input.value = name || ''; input.placeholder = 'Group name'; input.setAttribute('aria-label', 'Prompt-option group name');
  var add = document.createElement('button'); add.type = 'button'; add.textContent = '+ Phrase'; add.addEventListener('click', function () { loraPhrase(group); loraSyncJson(); });
  var remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove group'; remove.addEventListener('click', function () { group.remove(); loraSyncJson(); });
  heading.append(input, add, remove); group.appendChild(heading);
  var body = document.createElement('div'); body.className = 'lora-library-phrases'; group.appendChild(body);
  (phrases || []).forEach(function (v) { loraPhrase(group, v); });
  loraEl('groups').appendChild(group);
  return group;
}
function loraPhrase(group, phrase) {
  var row = document.createElement('div'); row.className = 'lora-library-phrase-row';
  var input = document.createElement('input'); input.className = 'lora-library-phrase'; input.value = phrase || ''; input.placeholder = 'Phrase'; input.setAttribute('aria-label', 'Prompt option phrase');
  var remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.title = 'Remove phrase';
  remove.addEventListener('click', function () { row.remove(); loraSyncJson(); });
  row.append(input, remove); group.querySelector('.lora-library-phrases').appendChild(row); return input;
}
function loraSetOptions(groups) {
  loraEl('groups').replaceChildren();
  Object.keys(groups).forEach(function (name) { loraGroup(name, groups[name]); });
  loraEl('options').value = JSON.stringify(groups, null, 2);
}
function loraDeselect() {
  loraBrowser.selected = null; loraBrowser.saved = '';
  loraEl('editor').classList.add('hidden'); loraEl('empty').classList.remove('hidden');
  loraFilters();
}
function loraSelect(item) {
  if (loraBrowser.selected && loraKey(item) === loraKey(loraBrowser.selected)) return Promise.resolve();
  if (!loraConfirmChanges()) return Promise.resolve();
  var load = ++loraBrowser.profile; loraEl('status').textContent = 'Loading profile…';
  return loraRequest('POST', {stage:item.stage,path:item.path}).then(function (data) {
    if (load !== loraBrowser.profile || loraEl('modal').classList.contains('hidden')) return;
    var e = (data.modelProfile || {}).enrichment || {};
    loraBrowser.selected = item;
    loraEl('profile-heading').textContent = item.path.split('/').pop().replace(/\.safetensors$/i, '');
    loraEl('profile-path').textContent = item.stage.toUpperCase() + ' / ' + item.path;
    loraEl('profile-state').textContent = loraLabel(loraStatus(item));
    loraEl('description').value = e.description || '';
    loraEl('words').value = (e.trainedWords || []).join('\n');
    loraEl('guidance').value = e.guidance || '';
    loraEl('json-edit').checked = false; loraEl('options').readOnly = true;
    loraEl('groups').classList.remove('hidden'); loraSetOptions(e.promptOptions || {});
    loraEl('json-details').open = false;
    loraBrowser.saved = loraSnapshot(); loraEl('save-state').textContent = '';
    loraEl('empty').classList.add('hidden'); loraEl('editor').classList.remove('hidden');
    loraFilters();
  }).catch(loraReport);
}
function loraSave() {
  if (!loraBrowser.selected || loraBrowser.busy) return;
  var snapshot;
  try { snapshot = loraSnapshot(); } catch (e) { loraReport(e); return; }
  var data = JSON.parse(snapshot), item = loraBrowser.selected;
  loraBrowser.busy = true; loraEl('save').disabled = true; loraEl('save-state').textContent = 'Saving…';
  loraRequest('POST', {stage:item.stage,path:item.path,enrichment:data}).then(function () {
    loraBrowser.saved = snapshot;
    item.enriched = true; item.enrichment = data;
    loraEl('profile-state').textContent = loraLabel(loraStatus(item));
    loraEl('save-state').textContent = 'Saved';
    loraFilters();
  }).catch(loraReport).finally(function () { loraBrowser.busy = false; loraEl('save').disabled = false; });
}
function loraClose() {
  if (!loraConfirmChanges()) return;
  ++loraBrowser.profile; ++loraBrowser.scan;
  loraEl('modal').classList.add('hidden'); loraEl('modal').setAttribute('aria-hidden', 'true');
  if (loraBrowser.origin && loraBrowser.origin.isConnected) loraBrowser.origin.focus();
}
window.openLoraLibrary = function (target) {
  loraBrowser.origin = document.activeElement;
  loraEl('modal').classList.remove('hidden'); loraEl('modal').setAttribute('aria-hidden','false');
  loraEl('search').focus();
  loraScan(target || null);
};
function wireLoraLibrary() {
  loraEl('close').addEventListener('click', loraClose);
  loraEl('modal').addEventListener('mousedown', function (event) { if (event.target === loraEl('modal')) loraClose(); });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !loraEl('modal').classList.contains('hidden')) { event.stopImmediatePropagation(); event.preventDefault(); loraClose(); }
  }, true);
  loraEl('refresh').addEventListener('click', function () { if (loraConfirmChanges()) loraScan(); });
  ['search','filter','sort','folder'].forEach(function (id) {
    loraEl(id).addEventListener(id === 'search' ? 'input' : 'change', loraFilters);
  });
  loraEl('stage').addEventListener('change', function () { loraChoices(); loraFilters(); });
  loraEl('editor-close').addEventListener('click', function () { if (loraConfirmChanges()) loraDeselect(); });
  loraEl('save').addEventListener('click', loraSave);
  loraEl('add-group').addEventListener('click', function () { loraGroup('', []); loraSyncJson(); });
  loraEl('groups').addEventListener('input', loraSyncJson);
  loraEl('json-edit').addEventListener('change', function () {
    var enabled = loraEl('json-edit').checked;
    if (!enabled) {
      try { var parsed = JSON.parse(loraEl('options').value || '{}'); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Expected an object.'); loraSetOptions(parsed); }
      catch (e) { loraEl('json-edit').checked = true; loraReport(e); return; }
    } else loraSyncJson();
    loraEl('options').readOnly = !enabled;
    loraEl('groups').classList.toggle('hidden', enabled);
    loraEl('add-group').disabled = enabled;
  });
  document.getElementById('generate-lora-library-open').addEventListener('click', function () { openLoraLibrary(); });
}
wireLoraLibrary();
