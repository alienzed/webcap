(function () {
  'use strict';
  var visible = false, items = [], offset = 0, total = 0, active = -1, role = '', loading = false;
  var selected = new Set(), anchor = -1;
  var source = '', pageSize = 60, serial = 0, full = false, complete = false, activeRequest = null;
  function el(id) { return document.getElementById(id); }
  function report(err) {
    var message = String(err && err.message || err);
    el('media-explorer-status').textContent = message;
    if (window.reportConsoleError) window.reportConsoleError('Media Explorer', message);
    else console.error('[Media Explorer]', err);
  }
  function text(node, value) { node.textContent = String(value == null ? '' : value); }
  function detail(label, value, dl) {
    if (value === undefined || value === null || value === '') return;
    var dt = document.createElement('dt'), dd = document.createElement('dd');
    text(dt, label); text(dd, value); dl.appendChild(dt); dl.appendChild(dd);
  }
  function mediaElement(item, controls) {
    var media = document.createElement(item.mediaKind === 'video' ? 'video' : 'img');
    media.src = item.mediaUrl;
    if (media.tagName === 'VIDEO') { media.controls = !!controls; media.preload = 'metadata'; }
    else media.alt = item.fileName;
    return media;
  }
  function updateSelection() {
    var panel = el('media-explorer-selection');
    panel.classList.toggle('hidden', !selected.size);
    text(el('media-explorer-selected-count'), selected.size + ' selected (loaded items)');
    var chosen = items.filter(function (item) { return selected.has(item.id); });
    el('media-explorer-compare').disabled = chosen.length < 2 || chosen.length > 4 || chosen.some(function (item) { return item.mediaKind !== chosen[0].mediaKind; });
    Array.prototype.forEach.call(el('media-explorer-grid').children, function (card, i) {
      card.classList.toggle('selected', selected.has(items[i].id));
      card.setAttribute('aria-pressed', selected.has(items[i].id) ? 'true' : 'false');
    });
  }
  function selectItem(index) {
    active = index;
    Array.prototype.forEach.call(el('media-explorer-grid').children, function (card, i) {
      card.classList.toggle('active', i === index);
    });
    var inspector = el('media-explorer-inspector'), host = el('media-explorer-inspector-body');
    host.replaceChildren();
    if (index < 0 || !items[index]) { inspector.classList.add('hidden'); return; }
    var item = items[index], preview = mediaElement(item, true);
    host.appendChild(preview);
    var dl = document.createElement('dl'); dl.className = 'media-explorer-detail';
    detail('Filename', item.fileName, dl); detail('Role', item.role, dl);
    detail('Owned by', item.source, dl); detail('Model', item.model, dl);
    if (item.rating !== null) detail('Rating', (item.rating || 'Unrated') + (item.rating ? ' / 5' : ''), dl);
    detail('Date', item.createdAt ? new Date(item.createdAt).toLocaleString() : '', dl);
    detail('Source record', item.storageId, dl);
    var uses = Array.isArray(item.uses) ? item.uses : [];
    if (uses.length) detail('Used by', uses.map(function (u) { return u.role + ' · ' + u.storageId; }).join(', '), dl);
    host.appendChild(dl);
    if (item.source === 'generate' && item.role === 'generated' && item.storageId) {
      var ratingRow = document.createElement('div');
      ratingRow.className = 'media-explorer-rating';
      var ratingLabel = document.createElement('span');
      text(ratingLabel, 'Rate generation');
      ratingRow.appendChild(ratingLabel);
      for (var score = 0; score <= 5; score++) {
        (function (value) {
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'review-captions-btn';
          text(button, value === 0 ? 'Clear' : String(value) + '★');
          button.setAttribute('aria-label', value === 0 ? 'Clear rating' : 'Rate ' + value + ' out of 5');
          button.setAttribute('aria-pressed', Number(item.rating || 0) === value ? 'true' : 'false');
          button.addEventListener('click', function () {
            Array.prototype.forEach.call(ratingRow.querySelectorAll('button'), function (node) { node.disabled = true; });
            fetch('/fs/generate/result/rating', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({storageId: item.storageId, rating: value})
            }).then(function (response) {
              return response.json().then(function (payload) {
                if (!response.ok || !payload || payload.ok === false) {
                  throw new Error(payload && payload.error || 'Could not update rating.');
                }
                return payload;
              });
            }).then(function (payload) {
              item.rating = payload.rating;
              if (visible && active >= 0 && items[active] === item) selectItem(active);
              var card = el('media-explorer-grid').children[items.indexOf(item)];
              if (card) {
                var sub = card.querySelector('.media-explorer-card-sub');
                if (sub) text(sub, item.role + ' · ' + (item.model || item.source) +
                  (item.rating ? ' · ★ ' + item.rating : ''));
              }
            }).catch(report).finally(function () {
              Array.prototype.forEach.call(ratingRow.querySelectorAll('button'), function (node) { node.disabled = false; });
            });
          });
          ratingRow.appendChild(button);
        })(score);
      }
      host.appendChild(ratingRow);
    }
    if (item.source === 'test' && item.ownerFolder && item.storageId) {
      var back = document.createElement('button');
      back.type = 'button';
      back.className = 'review-captions-btn';
      text(back, 'Open Test session');
      back.addEventListener('click', function () {
        if (typeof window.openTestBenchActivity !== 'function') throw new Error('Test navigation is unavailable.');
        window.openTestBenchActivity({folder: item.ownerFolder, sessionId: item.storageId, modelId: item.model || ''});
      });
      host.appendChild(back);
    }
    if (item.source === 'storyboard' && item.storageId) {
      var storyBtn = document.createElement('button');
      storyBtn.type = 'button'; storyBtn.className = 'review-captions-btn';
      text(storyBtn, 'Open Storyboard');
      storyBtn.addEventListener('click', function () {
        if (typeof window.openStoryboardActivity !== 'function') throw new Error('Storyboard navigation unavailable.');
        var scene = item.uses && item.uses[0] && item.uses[0].storageId || '';
        window.openStoryboardActivity({storyId: item.storageId, sceneId: scene});
      });
      host.appendChild(storyBtn);
    }
    var open = document.createElement('button'); open.type = 'button';
    open.className = 'review-captions-btn'; text(open, 'View full size');
    open.addEventListener('click', openLoupe); host.appendChild(open);
    inspector.classList.remove('hidden');
  }
  function openLoupe() {
    if (active < 0 || !items[active]) return;
    var dlg = el('media-explorer-loupe');
    el('media-explorer-loupe-content').replaceChildren(mediaElement(items[active], true));
    text(el('media-explorer-loupe-name'), items[active].fileName);
    if (!dlg.open) dlg.showModal();
  }
  function renderCard(item, index) {
    var card = document.createElement('button'); card.type = 'button';
    card.className = 'media-explorer-card'; card.title = item.fileName;
    card.setAttribute('aria-label', item.fileName + ', ' + item.role);
    var frame = document.createElement('div'); frame.className = 'media-explorer-card-thumb';
    frame.appendChild(mediaElement(item, false)); card.appendChild(frame);
    var meta = document.createElement('div'); meta.className = 'media-explorer-card-meta';
    var name = document.createElement('div'); name.className = 'media-explorer-card-name';
    text(name, item.fileName); meta.appendChild(name);
    var sub = document.createElement('div'); sub.className = 'media-explorer-card-sub';
    text(sub, item.role + ' · ' + (item.model || item.source) + (item.rating ? ' · ★ ' + item.rating : ''));
    meta.appendChild(sub); card.appendChild(meta);
    card.addEventListener('click', function (event) {
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        if (event.shiftKey && anchor >= 0) {
          for (var i = Math.min(index, anchor); i <= Math.max(index, anchor); i++) selected.add(items[i].id);
        } else if (selected.has(item.id)) selected.delete(item.id);
        else selected.add(item.id);
        anchor = index; updateSelection();
      } else { anchor = index; selectItem(index); }
    });
    card.addEventListener('dblclick', function () { selectItem(index); openLoupe(); });
    return card;
  }
  function count() {
    text(el('media-explorer-count'), items.length + ' of ' + total + ' media' + (complete ? ' · complete scan' : ' · recent results only'));
    el('media-explorer-more-btn').classList.toggle('hidden', items.length >= total);
  }
  function load(reset) {
    if (!visible) return;
    if (reset) {
      serial++; items = []; offset = 0; active = -1; loading = false;
      selected.clear(); anchor = -1; updateSelection();
      el('media-explorer-grid').replaceChildren();
      el('media-explorer-inspector').classList.add('hidden');
    }
    if (loading && !reset) return;
    if (reset && activeRequest) activeRequest.abort();
    var request = serial;
    loading = true;
    var controller = new AbortController(); activeRequest = controller;
    el('media-explorer-scan-all').disabled = full && loading;
    el('media-explorer-status').textContent = full ? 'Scanning all Generate manifests…' : 'Discovering recent Generate media…';
    var qs = new URLSearchParams({limit:pageSize, offset:offset, role:role,
      kind:el('media-explorer-kind').value, search:el('media-explorer-search').value.trim(),
      sort:el('media-explorer-sort').value, source:source, full:full ? '1' : '0'});
    fetch('/fs/media_explorer?' + qs, {signal: controller.signal}).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || !data.ok) throw new Error(data.error || 'Media discovery failed.');
        return data;
      });
    }).then(function (data) {
      if (request !== serial || !visible) return;
      total = data.total;
      complete = !!data.complete;
      var incoming = data.items || [];
      var host = el('media-explorer-grid');
      incoming.forEach(function (item) {
        var index = items.length; items.push(item); host.appendChild(renderCard(item, index));
      });
      offset += incoming.length;
      count(); updateSelection();
      text(el('media-explorer-status'), incoming.length ? '' : (items.length ? '' : 'No matching media found in this source.'));
    }).catch(function (err) { if (request === serial && err.name !== 'AbortError') report(err); })
      .finally(function () { if (request === serial) { loading = false; activeRequest = null; el('media-explorer-scan-all').disabled = false; } });
  }
  function open() {
    window.closeGenerateActivity(); window.closeTestBenchActivity();
    window.closeStoryboardActivity(); window.closeStorageActivity();
    visible = true;
    el('media-explorer-workspace').classList.remove('hidden');
    el('app-frame').classList.add('workspace-media-explorer-open');
    window.syncApplicationShellContext();
    window.syncShellLocationRoute();
    load(true);
  }
  function close() {
    visible = false; serial++;
    if (activeRequest) { activeRequest.abort(); activeRequest = null; }
    loading = false;
    el('media-explorer-workspace').classList.add('hidden');
    el('app-frame').classList.remove('workspace-media-explorer-open');
    var dlg = el('media-explorer-loupe'); if (dlg.open) dlg.close();
    var compare = el('media-explorer-compare-dialog'); if (compare.open) compare.close();
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-media-role]'), function (button) {
    button.addEventListener('click', function () {
      role = button.dataset.mediaRole;
      source = '';
      Array.prototype.forEach.call(document.querySelectorAll('.media-explorer-source'), function (node) {
        node.classList.toggle('active', node === button);
      });
      load(true);
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-media-source]'), function (button) {
    button.addEventListener('click', function () {
      source = button.dataset.mediaSource;
      role = '';
      Array.prototype.forEach.call(document.querySelectorAll('.media-explorer-source'), function (node) { node.classList.toggle('active', node === button); });
      load(true);
    });
  });
  el('media-explorer-clear-selection').addEventListener('click', function () { selected.clear(); updateSelection(); });
  el('media-explorer-compare').addEventListener('click', function () {
    var chosen = items.filter(function (item) { return selected.has(item.id); });
    if (chosen.length < 2 || chosen.length > 4 || chosen.some(function (item) { return item.mediaKind !== chosen[0].mediaKind; })) return;
    var host = el('media-explorer-compare-content');
    host.replaceChildren();
    chosen.forEach(function (item) {
      var pane = document.createElement('div'); pane.className = 'media-explorer-compare-pane';
      pane.appendChild(mediaElement(item, true));
      var label = document.createElement('span'); text(label, item.fileName); pane.appendChild(label);
      host.appendChild(pane);
    });
    el('media-explorer-compare-dialog').showModal();
  });
  el('media-explorer-compare-close').addEventListener('click', function () { el('media-explorer-compare-dialog').close(); });
  el('media-explorer-refresh').addEventListener('click', function () { load(true); });
  el('media-explorer-scan-all').addEventListener('click', function () { full = true; load(true); });
  el('media-explorer-more-btn').addEventListener('click', function () { load(false); });
  var debounce;
  el('media-explorer-search').addEventListener('input', function () {
    clearTimeout(debounce); debounce = setTimeout(function () { load(true); }, 250);
  });
  el('media-explorer-kind').addEventListener('change', function () { load(true); });
  el('media-explorer-sort').addEventListener('change', function () { load(true); });
  el('media-explorer-size').addEventListener('input', function () {
    el('media-explorer-grid').style.setProperty('--media-tile-width', this.value + 'px');
  });
  el('media-explorer-close-details').addEventListener('click', function () { selectItem(-1); });
  el('media-explorer-close-loupe').addEventListener('click', function () { el('media-explorer-loupe').close(); });
  el('media-explorer-next').addEventListener('click', function () { selectItem(Math.min(items.length - 1, active + 1)); openLoupe(); });
  el('media-explorer-previous').addEventListener('click', function () { selectItem(Math.max(0, active - 1)); openLoupe(); });
  document.addEventListener('keydown', function (event) {
    if (!visible || !el('media-explorer-loupe').open) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); selectItem(Math.max(0, Math.min(items.length - 1, active + (event.key === 'ArrowLeft' ? -1 : 1)))); openLoupe();
    }
  });
  window.openMediaExplorerActivity = open;
  window.closeMediaExplorerActivity = close;
})();