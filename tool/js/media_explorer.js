(function () {
  'use strict';
  var visible = false, items = [], offset = 0, total = 0, active = -1, role = '', loading = false;
  var selected = new Set(), anchor = -1;
  var source = '', pageSize = 60, serial = 0, full = false, complete = false, activeRequest = null;
  var needsLoad = true;
  var routeInitialized = false;
  function el(id) { return document.getElementById(id); }
  function report(err) {
    var message = String(err && err.message || err);
    el('media-explorer-status').textContent = message;
    window.reportConsoleError('Media Explorer', message);
  }
  function text(node, value) { node.textContent = String(value == null ? '' : value); }
  function detail(label, value, dl) {
    if (value === undefined || value === null || value === '') return;
    var dt = document.createElement('dt'), dd = document.createElement('dd');
    text(dt, label); text(dd, value); dl.appendChild(dt); dl.appendChild(dd);
  }
  function cardSummary(item) {
    return (item.mediaKind === 'video' ? '▶ Video · ' : '') + item.role + ' · ' +
      (item.model || item.source) + (item.rating ? ' · ★ ' + item.rating : '');
  }
  function renderDetails(item, dl) {
    dl.replaceChildren();
    detail('Filename', item.fileName, dl); detail('Role', item.role, dl);
    detail('Owned by', item.source, dl); detail('Model', item.model, dl);
    if (item.rating !== null) detail('Rating', item.rating ? item.rating + ' / 5' : 'Unrated', dl);
    detail('Date', item.createdAt ? new Date(item.createdAt).toLocaleString() : '', dl);
    detail('Source record', item.storageId, dl);
    var uses = Array.isArray(item.uses) ? item.uses : [];
    if (uses.length) detail('Used by', uses.map(function (u) { return u.role + ' · ' + u.storageId; }).join(', '), dl);
  }
  function mediaElement(item, controls) {
    var media = document.createElement(item.mediaKind === 'video' ? 'video' : 'img');
    media.src = item.mediaUrl;
    if (media.tagName === 'VIDEO') { media.controls = !!controls; media.preload = 'metadata'; }
    else { media.alt = item.fileName; media.loading = controls ? 'eager' : 'lazy'; }
    media.addEventListener('error', function () {
      report(new Error('Could not load media: ' + item.fileName + ' (' + item.mediaUrl + ')' +
        (media.error ? ' · ' + media.error.message + ' (code ' + media.error.code + ')' : '')));
    });
    return media;
  }
  function updateSelection() {
    var panel = el('media-explorer-selection');
    panel.classList.toggle('hidden', !selected.size);
    text(el('media-explorer-selected-count'), selected.size + ' selected (loaded items)');
    var chosen = items.filter(function (item) { return selected.has(item.id); });
    el('media-explorer-compare').disabled = chosen.length < 2 || chosen.length > 4 || chosen.some(function (item) { return item.mediaKind !== chosen[0].mediaKind; });
    text(el('media-explorer-compare'), chosen.length > 2 && chosen.length <= 4 ? 'Survey' : 'Compare');
    el('media-explorer-compare').title = 'Select 2–4 images or 2–4 videos';
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
    if (items[index] && host.dataset.id === items[index].id && !inspector.classList.contains('hidden')) {
      renderDetails(items[index], host.querySelector('.media-explorer-detail'));
      host.querySelectorAll('.media-explorer-rating button').forEach(function (button, score) {
        button.setAttribute('aria-pressed', Number(items[index].rating || 0) === score ? 'true' : 'false');
      });
      return;
    }
    host.dataset.id = items[index] ? items[index].id : '';
    host.replaceChildren();
    if (index < 0 || !items[index]) { inspector.classList.add('hidden'); return; }
    var item = items[index], preview = mediaElement(item, true);
    host.appendChild(preview);
    var dl = document.createElement('dl'); dl.className = 'media-explorer-detail';
    renderDetails(item, dl);
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
              if (visible && active >= 0 && items[active] === item) {
                Array.prototype.forEach.call(ratingRow.querySelectorAll('button'), function (node, score) {
                  node.setAttribute('aria-pressed', Number(item.rating || 0) === score ? 'true' : 'false');
                });
                dl.querySelectorAll('dt').forEach(function (node) { if (node.textContent === 'Rating') text(node.nextElementSibling, item.rating ? item.rating + ' / 5' : 'Unrated'); });
              }
              var card = el('media-explorer-grid').children[items.indexOf(item)];
              if (card) {
                var sub = card.querySelector('.media-explorer-card-sub');
                text(sub, cardSummary(item));
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
        window.openTestBenchActivity({folder: item.ownerFolder, sessionId: item.storageId, modelId: item.model || ''});
      });
      host.appendChild(back);
    }
    if (item.source === 'storyboard' && item.storageId) {
      var storyBtn = document.createElement('button');
      storyBtn.type = 'button'; storyBtn.className = 'review-captions-btn';
      text(storyBtn, 'Open Storyboard');
      storyBtn.addEventListener('click', function () {
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
    el('media-explorer-loupe-content').classList.remove('zoomed');
    el('media-explorer-zoom').setAttribute('aria-pressed', 'false');
    el('media-explorer-zoom').disabled = items[active].mediaKind === 'video';
    el('media-explorer-inspector-body').querySelectorAll('video').forEach(function (video) { video.pause(); });
    el('media-explorer-loupe-content').replaceChildren(mediaElement(items[active], true));
    text(el('media-explorer-loupe-name'), (active + 1) + ' / ' + items.length + ' · ' + items[active].fileName);
    el('media-explorer-previous').disabled = active === 0;
    el('media-explorer-next').disabled = active === items.length - 1;
    if (!dlg.open) dlg.showModal();
  }
  function renderCard(item, index) {
    var card = document.createElement('button'); card.type = 'button';
    card.className = 'media-explorer-card'; card.title = item.fileName;
    card.dataset.id = item.id;
    card.dataset.index = index;
    card.setAttribute('aria-label', item.fileName + ', ' + item.role);
    var frame = document.createElement('div'); frame.className = 'media-explorer-card-thumb';
    frame.appendChild(mediaElement(item, false)); card.appendChild(frame);
    var meta = document.createElement('div'); meta.className = 'media-explorer-card-meta';
    var name = document.createElement('div'); name.className = 'media-explorer-card-name';
    text(name, item.fileName); meta.appendChild(name);
    var sub = document.createElement('div'); sub.className = 'media-explorer-card-sub';
    text(sub, cardSummary(item));
    meta.appendChild(sub); card.appendChild(meta);
    card.addEventListener('click', function (event) {
      var index = Number(card.dataset.index), item = items[index];
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        if (event.shiftKey && anchor >= 0) {
          for (var i = Math.min(index, anchor); i <= Math.max(index, anchor); i++) selected.add(items[i].id);
        } else if (selected.has(item.id)) selected.delete(item.id);
        else selected.add(item.id);
        anchor = index; updateSelection();
      } else { anchor = index; selected.clear(); updateSelection(); selectItem(index); }
    });
    card.addEventListener('dblclick', function () { selectItem(Number(card.dataset.index)); openLoupe(); });
    return card;
  }
  function count() {
    text(el('media-explorer-count'), items.length + ' of ' + total + ' media' + (complete ? ' · full discovery scope' : ' · partial discovery scope'));
    el('media-explorer-more-btn').classList.toggle('hidden', offset >= total);
  }
  function load(reset) {
    if (!visible) return;
    clearTimeout(debounce);
    window.syncShellLocationRoute();
    el('media-explorer-clear-filters').classList.toggle('hidden', !role && !source && !el('media-explorer-search').value && !el('media-explorer-kind').value && el('media-explorer-sort').value === 'newest');
    if (reset) {
      serial++; loading = false; needsLoad = true;
    }
    if (loading && !reset) return;
    if (reset && activeRequest) activeRequest.abort();
    var request = serial;
    loading = true;
    var controller = new AbortController(); activeRequest = controller;
    el('media-explorer-scan-all').disabled = full && loading;
    el('media-explorer-status').textContent = full ? 'Scanning all recognized media sources…' : 'Discovering recent media…';
    var qs = new URLSearchParams({limit:pageSize, offset:reset ? 0 : offset, role:role,
      kind:el('media-explorer-kind').value, search:el('media-explorer-search').value.trim(),
      sort:el('media-explorer-sort').value, source:source, full:full ? '1' : '0'});
    fetch('/fs/media_explorer?' + qs, {signal: controller.signal}).then(function (res) {
      return res.json().catch(function (err) { throw new Error('Media discovery HTTP ' + res.status + ': ' + err.message); }).then(function (data) {
        if (!res.ok || !data.ok) throw new Error(data.error || 'Media discovery failed.');
        return data;
      });
    }).then(function (data) {
      if (request !== serial || !visible) return;
      total = data.total;
      complete = !!data.complete;
      var incoming = data.items || [];
      var host = el('media-explorer-grid');
      if (reset) {
        var previousItems = new Map(items.map(function (item) { return [item.id, item]; }));
        var previous = items[active], cards = new Map();
        Array.prototype.forEach.call(host.children, function (card) { cards.set(card.dataset.id, card); });
        var keep = new Set(incoming.map(function (item) { return item.id; }));
        cards.forEach(function (card, id) { if (!keep.has(id)) card.remove(); });
        items = []; offset = 0; active = -1; anchor = -1;
        selected.forEach(function (id) { if (!keep.has(id)) selected.delete(id); });
        incoming.forEach(function (item, index) {
          var card = cards.get(item.id);
          if (card) item = Object.assign(previousItems.get(item.id), item);
          items.push(item);
          if (!card) card = renderCard(item, index);
          text(card.querySelector('.media-explorer-card-sub'), cardSummary(item));
          card.dataset.index = index;
          if (host.children[index] !== card) host.insertBefore(card, host.children[index] || null);
          if (previous && previous.id === item.id) active = index;
        });
        offset = incoming.length;
        if (active < 0) selectItem(-1);
        else selectItem(active);
      } else {
        var loaded = new Set(items.map(function (item) { return item.id; }));
        incoming.forEach(function (item) {
          if (loaded.has(item.id)) return;
          loaded.add(item.id);
          var index = items.length; items.push(item); host.appendChild(renderCard(item, index));
        });
        offset += incoming.length;
      }
      count(); updateSelection();
      needsLoad = false;
      text(el('media-explorer-status'), incoming.length ? '' : (items.length ? '' : 'No matching media found in this source.'));
    }).catch(function (err) { if (request === serial && err.name !== 'AbortError') report(err); })
      .finally(function () { if (request === serial) { loading = false; activeRequest = null; el('media-explorer-scan-all').disabled = false; } });
  }
  function open() {
    if (visible) return;
    if (!routeInitialized) {
      routeInitialized = true;
      if (window.location.hash.split('?')[0] === '#/media') {
        var params = new URLSearchParams(window.location.hash.split('?')[1] || '');
        role = params.get('role') || ''; source = params.get('source') || '';
        full = params.get('full') === '1' || source === 'set';
        el('media-explorer-search').value = params.get('q') || '';
        el('media-explorer-kind').value = params.get('kind') || '';
        el('media-explorer-sort').value = params.get('sort') || 'newest';
        sourceButtons.forEach(function (button, index) {
          var match = source ? button.dataset.mediaSource === source : button.dataset.mediaRole === role;
          button.classList.toggle('active', match);
          if (match) el('media-explorer-source-chooser').value = index;
        });
      }
    }
    window.closeGenerateActivity(); window.closeTestBenchActivity();
    window.closeStoryboardActivity(); window.closeStorageActivity();
    visible = true;
    el('media-explorer-workspace').classList.remove('hidden');
    el('app-frame').classList.add('workspace-media-explorer-open');
    window.syncApplicationShellContext();
    window.syncShellLocationRoute();
    if (needsLoad) load(true);
  }
  function close() {
    visible = false; serial++;
    clearTimeout(debounce);
    el('media-explorer-scan-all').disabled = false;
    el('media-explorer-workspace').querySelectorAll('video').forEach(function (video) { video.pause(); });
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
      if (source === 'set') full = true;
      role = '';
      Array.prototype.forEach.call(document.querySelectorAll('.media-explorer-source'), function (node) { node.classList.toggle('active', node === button); });
      load(true);
    });
  });
  el('media-explorer-clear-selection').addEventListener('click', function () { selected.clear(); updateSelection(); });
  el('media-explorer-compare').addEventListener('click', function () {
    var chosen = items.filter(function (item) { return selected.has(item.id); });
    if (chosen.length < 2 || chosen.length > 4 || chosen.some(function (item) { return item.mediaKind !== chosen[0].mediaKind; })) return;
    el('media-explorer-inspector-body').querySelectorAll('video').forEach(function (video) { video.pause(); });
    var host = el('media-explorer-compare-content');
    host.replaceChildren();
    chosen.forEach(function (item) {
      var pane = document.createElement('div'); pane.className = 'media-explorer-compare-pane';
      pane.appendChild(mediaElement(item, true));
      var label = document.createElement('span'); text(label, item.fileName); pane.appendChild(label);
      host.appendChild(pane);
    });
    text(el('media-explorer-compare-dialog').querySelector('strong'), (chosen.length > 2 ? 'Survey' : 'Compare') + ' · ' + chosen.length + ' selected');
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
  var sourceButtons = Array.prototype.slice.call(document.querySelectorAll('.media-explorer-source'));
  sourceButtons.forEach(function (button, index) {
    var option = document.createElement('option'); option.value = index; text(option, button.textContent);
    el('media-explorer-source-chooser').appendChild(option);
    button.addEventListener('click', function () { el('media-explorer-source-chooser').value = index; });
  });
  el('media-explorer-source-chooser').addEventListener('change', function () { sourceButtons[Number(this.value)].click(); });
  el('media-explorer-clear-filters').addEventListener('click', function () {
    el('media-explorer-search').value = ''; el('media-explorer-kind').value = ''; el('media-explorer-sort').value = 'newest';
    sourceButtons[0].click();
  });
  ['media-explorer-loupe', 'media-explorer-compare-dialog'].forEach(function (id) {
    el(id).addEventListener('close', function () {
      this.querySelectorAll('video').forEach(function (video) { video.pause(); });
      if (active >= 0 && visible) el('media-explorer-grid').children[active].focus({preventScroll: true});
    });
  });
  el('media-explorer-zoom').addEventListener('click', function () {
    var zoomed = el('media-explorer-loupe-content').classList.toggle('zoomed');
    this.setAttribute('aria-pressed', String(zoomed));
  });
  el('media-explorer-close-details').addEventListener('click', function () { selectItem(-1); });
  el('media-explorer-close-loupe').addEventListener('click', function () { el('media-explorer-loupe').close(); });
  el('media-explorer-next').addEventListener('click', function () { selectItem(Math.min(items.length - 1, active + 1)); openLoupe(); });
  el('media-explorer-previous').addEventListener('click', function () { selectItem(Math.max(0, active - 1)); openLoupe(); });
  document.addEventListener('keydown', function (event) {
    if (!visible || event.defaultPrevented || el('media-explorer-compare-dialog').open) return;
    if (!el('media-explorer-workspace').contains(event.target)) return;
    if (event.target.closest('input, select, textarea, [contenteditable="true"]')) return;
    var loupe = el('media-explorer-loupe').open;
    if (!loupe && event.key === 'Escape') { selected.clear(); updateSelection(); selectItem(-1); return; }
    if (!loupe && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault(); items.forEach(function (item) { selected.add(item.id); }); updateSelection(); return;
    }
    if (!loupe && !event.target.closest('.media-explorer-card')) return;
    var focused = Number(event.target.closest('.media-explorer-card') && event.target.closest('.media-explorer-card').dataset.index);
    if (!loupe && event.key === 'Enter') { event.preventDefault(); selectItem(focused); openLoupe(); return; }
    var columns = getComputedStyle(el('media-explorer-grid')).gridTemplateColumns.split(' ').length;
    var delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : !loupe && event.key === 'ArrowUp' ? -columns : !loupe && event.key === 'ArrowDown' ? columns : 0;
    if (delta && items.length) {
      event.preventDefault(); var next = Math.max(0, Math.min(items.length - 1, (loupe ? active : focused) + delta));
      selectItem(next);
      if (loupe) openLoupe(); else el('media-explorer-grid').children[next].focus();
    }
  });
  window.openMediaExplorerActivity = open;
  window.closeMediaExplorerActivity = close;
  window.appendMediaExplorerRouteParams = function (params) {
    if (role) params.set('role', role);
    if (source) params.set('source', source);
    if (full) params.set('full', '1');
    if (el('media-explorer-search').value.trim()) params.set('q', el('media-explorer-search').value.trim());
    if (el('media-explorer-kind').value) params.set('kind', el('media-explorer-kind').value);
    if (el('media-explorer-sort').value !== 'newest') params.set('sort', el('media-explorer-sort').value);
  };
})();
