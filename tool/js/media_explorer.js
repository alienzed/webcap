(function () {
  'use strict';
  var visible = false, items = [], offset = 0, total = 0, active = -1, role = '', loading = false;
  var selected = new Set(), anchor = -1;
  var source = '', pageSize = 60, serial = 0, full = false, complete = false, activeRequest = null;
  var needsLoad = true;
  var routeInitialized = false;
  var sourceNames = {generate: 'Generate', test: 'Test Generations', epoch: 'Epoch Finder', storyboard: 'Storyboard', set: 'Source Set'};
  var roleNames = {generated: 'Generated', reference: 'Reference', source: 'Source media'};
  var mediaFacts = new Map();
  var loupeReturn = null;
  var artifact = '';
  function el(id) { return document.getElementById(id); }
  function report(err) {
    var message = String(err && err.message || err);
    el('media-explorer-status').textContent = message;
    el('media-explorer-status').dataset.state = 'error';
    window.reportConsoleError('Media Explorer', message);
  }
  function text(node, value) { node.textContent = String(value == null ? '' : value); }
  function detail(label, value, dl) {
    if (value === undefined || value === null || value === '') return;
    var dt = document.createElement('dt'), dd = document.createElement('dd');
    text(dt, label); text(dd, value); dl.appendChild(dt); dl.appendChild(dd);
  }
  function cardSummary(item) {
    return ((item.source === 'generate' && item.role !== 'reference' ? item.model : item.contextLabel) || item.model || sourceNames[item.source]) +
      (item.rating ? ' · ★ ' + item.rating : '');
  }
  function badgeText(item) {
    var facts = mediaFacts.get(item.id) || {};
    return item.mediaKind === 'video' ? '▶ ' + (duration(Number.isFinite(facts.duration) ? facts.duration : item.duration) || 'Video') :
      (item.roles || [item.role]).map(function (role) { return roleNames[role] || role; }).join(' · ');
  }
  function duration(value) {
    if (!Number.isFinite(Number(value)) || value == null) return '';
    var seconds = Math.floor(Number(value));
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }
  function bytes(value) {
    if (value == null) return '';
    return value >= 1048576 ? (value / 1048576).toFixed(1) + ' MB' : Math.ceil(value / 1024) + ' KB';
  }
  function renderDetails(item, dl) {
    dl.replaceChildren();
    var facts = mediaFacts.get(item.id) || {};
    detail('Roles', (item.roles || [item.role]).map(function (role) { return roleNames[role] || role; }).join(' · '), dl);
    detail('Producer', sourceNames[item.source], dl); detail('Model', item.model, dl);
    detail('Workflow', item.workflow, dl);
    detail('Set', item.ownerFolder, dl);
    detail('Dimensions', facts.resolution || item.resolution, dl);
    if (item.mediaKind === 'video') detail('Duration', duration(Number.isFinite(facts.duration) ? facts.duration : item.duration), dl);
    detail('File size', bytes(item.fileSize), dl);
    detail('Seed', item.seed, dl); detail('Epoch', item.epoch, dl);
    if (item.rating !== null) detail('Rating', item.rating ? item.rating + ' / 5' : 'Unrated', dl);
    detail('Date', item.createdAt ? new Date(item.createdAt).toLocaleString() : '', dl);
    detail('LoRAs', (item.loras || []).map(function (lora) { return lora.name + (lora.strength != null ? ' × ' + lora.strength : ''); }).join(', '), dl);
  }
  function mediaElement(item, controls) {
    var media = document.createElement(item.mediaKind === 'video' ? 'video' : 'img');
    media.src = item.mediaUrl;
    if (media.tagName === 'VIDEO') { media.controls = !!controls; media.preload = 'metadata'; }
    else { media.alt = item.fileName; media.loading = controls ? 'eager' : 'lazy'; }
    media.addEventListener(item.mediaKind === 'video' ? 'loadedmetadata' : 'load', function () {
      var width = media.videoWidth || media.naturalWidth, height = media.videoHeight || media.naturalHeight;
      mediaFacts.set(item.id, {resolution: width && height ? width + ' × ' + height : '', duration: media.duration});
      if (visible && items[active] && items[active].id === item.id) {
        renderDetails(items[active], el('media-explorer-inspector-body').querySelector('.media-explorer-detail'));
      }
      if (!controls && item.mediaKind === 'video') text(media.parentElement.querySelector('.media-explorer-card-badge'), badgeText(item));
    });
    media.addEventListener('error', function () {
      var message = 'Could not load media: ' + item.fileName + ' (' + item.mediaUrl + ')' +
        (media.error ? ' · ' + media.error.message + ' (code ' + media.error.code + ')' : '');
      window.reportConsoleError('Media Explorer', message);
      var host = media.parentElement, error = host.querySelector('.media-explorer-card-error');
      if (!error) { error = document.createElement('div'); error.className = 'media-explorer-card-error'; host.appendChild(error); }
      text(error, 'Preview unavailable · Open the Console for details.');
      error.title = message;
    });
    return media;
  }
  function updateSelection() {
    var panel = el('media-explorer-selection');
    panel.classList.toggle('hidden', !selected.size);
    text(el('media-explorer-selected-count'), selected.size + ' selected (loaded items)');
    var chosen = items.filter(function (item) { return selected.has(item.id); });
    el('media-explorer-compare').disabled = chosen.length < 2 || chosen.length > 4;
    text(el('media-explorer-compare'), chosen.length > 2 && chosen.length <= 4 ? 'Survey' : 'Compare');
    el('media-explorer-compare').title = 'Compare 2–4 media; videos play independently';
    Array.prototype.forEach.call(el('media-explorer-grid').children, function (card, i) {
      card.classList.toggle('selected', selected.has(items[i].id));
      card.querySelector('.media-explorer-card-check').checked = selected.has(items[i].id);
    });
  }
  function selectItem(index) {
    active = index;
    Array.prototype.forEach.call(el('media-explorer-grid').children, function (card, i) {
      card.classList.toggle('active', i === index);
      var button = card.querySelector('.media-explorer-card-open');
      button.tabIndex = i === (index < 0 ? 0 : index) ? 0 : -1;
      card.querySelector('.media-explorer-card-check').tabIndex = button.tabIndex;
      button.setAttribute('aria-current', i === index ? 'true' : 'false');
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
    text(el('media-explorer-inspector-name'), item.fileName);
    el('media-explorer-inspector-name').title = item.fileName;
    var previewFrame = document.createElement('div'); previewFrame.className = 'media-explorer-inspector-preview';
    previewFrame.appendChild(preview); host.appendChild(previewFrame);
    var provenance = document.createElement('div'); provenance.className = 'media-explorer-provenance';
    text(provenance, 'Owned by · ' + sourceNames[item.source] + ' › ' + (item.contextLabel || item.storageId)); host.appendChild(provenance);
    var actions = document.createElement('div'); actions.className = 'media-explorer-inspector-actions'; host.appendChild(actions);
    var dl = document.createElement('dl'); dl.className = 'media-explorer-detail';
    renderDetails(item, dl);
    host.appendChild(dl);
    function section(title, value, expanded) {
      if (!value) return;
      var group = document.createElement('details'), summary = document.createElement('summary'), content = document.createElement('p');
      group.className = 'media-explorer-inspector-section'; group.open = !!expanded;
      text(summary, title); text(content, value); group.appendChild(summary); group.appendChild(content); host.appendChild(group);
    }
    section('Prompt', item.prompt, true);
    if (item.sourcePrompt !== item.prompt) section('Original prompt', item.sourcePrompt, false);
    if (item.assessment) section(item.assessment.label + (item.assessment.model ? ' · ' + item.assessment.model : ''), item.assessment.text, false);
    var uses = Array.from(new Map((item.uses || []).map(function (use) { return [use.storageId + ':' + use.role, use]; })).values());
    if (uses.length) {
      var relationships = document.createElement('details'), relationshipsTitle = document.createElement('summary');
      relationships.className = 'media-explorer-inspector-section'; relationships.open = true;
      text(relationshipsTitle, 'Used by · ' + uses.length); relationships.appendChild(relationshipsTitle);
      uses.forEach(function (use) {
        var canOpen = use.source === 'generate' || use.source === 'storyboard';
        var row = document.createElement(canOpen ? 'button' : 'p');
        text(row, (use.label || use.storageId) + ' · ' + use.role);
        if (canOpen) {
          row.type = 'button'; row.className = 'media-explorer-use-link';
          row.addEventListener('click', function () {
            if (use.source === 'generate') window.openGenerateActivity({storageId: use.storageId});
            else window.openStoryboardActivity({storyId: item.storageId, sceneId: use.storageId});
          });
        }
        relationships.appendChild(row);
      });
      host.appendChild(relationships);
    }
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
              if (visible && (el('media-explorer-rating').value || el('media-explorer-sort').value === 'rating')) load(true);
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
      actions.appendChild(back);
    }
    if (item.source === 'storyboard' && item.storageId) {
      var storyBtn = document.createElement('button');
      storyBtn.type = 'button'; storyBtn.className = 'review-captions-btn';
      text(storyBtn, 'Open Storyboard');
      storyBtn.addEventListener('click', function () {
        var scene = item.uses && item.uses[0] && item.uses[0].storageId || '';
        window.openStoryboardActivity({storyId: item.storageId, sceneId: scene});
      });
      actions.appendChild(storyBtn);
    }
    if (item.source === 'generate') {
      var generate = document.createElement('button'); generate.type = 'button'; generate.className = 'review-captions-btn';
      text(generate, item.role === 'reference' ? 'Open using generation' : 'Open in Generate');
      generate.addEventListener('click', function () { window.openGenerateActivity({storageId: item.storageId}); }); actions.appendChild(generate);
    }
    if (item.source === 'epoch' && item.ownerFolder && item.model) {
      var epoch = document.createElement('button'); epoch.type = 'button'; epoch.className = 'review-captions-btn';
      text(epoch, 'Open Epoch Finder'); epoch.addEventListener('click', function () {
        window.openTestBenchActivity({folder: item.ownerFolder, modelId: item.model, campaignId: item.storageId});
      }); actions.appendChild(epoch);
    }
    if (item.source === 'set') {
      var reveal = document.createElement('button'); reveal.type = 'button'; reveal.className = 'review-captions-btn';
      text(reveal, 'Reveal file'); reveal.addEventListener('click', function () { window.openPathInExplorer(item.mediaPath); }); actions.appendChild(reveal);
    }
    var open = document.createElement('button'); open.type = 'button';
    open.className = 'review-captions-btn'; text(open, 'View full size');
    open.addEventListener('click', function () { openLoupe(); }); actions.appendChild(open);
    inspector.classList.remove('hidden');
  }
  function openLoupe(index) {
    var dlg = el('media-explorer-loupe');
    if (!dlg.open) loupeReturn = {inspectorOpen: !el('media-explorer-inspector').classList.contains('hidden'), scroll: document.querySelector('.media-explorer-main').scrollTop};
    if (typeof index === 'number') selectItem(index);
    if (active < 0 || !items[active]) return;
    el('media-explorer-loupe-content').classList.remove('zoomed');
    el('media-explorer-zoom').setAttribute('aria-pressed', 'false');
    el('media-explorer-zoom').disabled = items[active].mediaKind === 'video';
    el('media-explorer-inspector-body').querySelectorAll('video').forEach(function (video) { video.pause(); });
    el('media-explorer-loupe-content').replaceChildren(mediaElement(items[active], true));
    text(el('media-explorer-loupe-name'), (active + 1) + ' / ' + items.length + ' · ' + items[active].fileName);
    text(el('media-explorer-loupe-caption'), (items[active].roles || [items[active].role]).join(' · ') + ' · ' + cardSummary(items[active]));
    el('media-explorer-previous').disabled = active === 0;
    el('media-explorer-next').disabled = active === items.length - 1;
    if (!dlg.open) dlg.showModal();
  }
  function renderCard(item, index) {
    var card = document.createElement('article');
    card.className = 'media-explorer-card'; card.title = item.fileName;
    card.dataset.id = item.id;
    card.dataset.index = index;
    var open = document.createElement('button'); open.type = 'button'; open.className = 'media-explorer-card-open';
    open.tabIndex = index === 0 ? 0 : -1;
    open.setAttribute('aria-label', item.fileName + ', ' + item.role);
    card.appendChild(open);
    var frame = document.createElement('div'); frame.className = 'media-explorer-card-thumb';
    frame.appendChild(mediaElement(item, false)); open.appendChild(frame);
    var badge = document.createElement('span'); badge.className = 'media-explorer-card-badge';
    text(badge, badgeText(item));
    frame.appendChild(badge);
    var meta = document.createElement('div'); meta.className = 'media-explorer-card-meta';
    var name = document.createElement('div'); name.className = 'media-explorer-card-name';
    text(name, item.fileName); meta.appendChild(name);
    var sub = document.createElement('div'); sub.className = 'media-explorer-card-sub';
    text(sub, cardSummary(item));
    meta.appendChild(sub); open.appendChild(meta);
    var check = document.createElement('input'); check.type = 'checkbox'; check.className = 'media-explorer-card-check';
    check.tabIndex = index === 0 ? 0 : -1;
    check.setAttribute('aria-label', 'Select ' + item.fileName);
    check.addEventListener('click', function (event) {
      event.stopPropagation();
      var index = Number(card.dataset.index);
      if (event.shiftKey && anchor >= 0) {
        for (var i = Math.min(index, anchor); i <= Math.max(index, anchor); i++) selected.add(items[i].id);
      } else if (selected.has(item.id)) selected.delete(item.id);
      else selected.add(item.id);
      anchor = index; updateSelection();
    });
    card.appendChild(check);
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
    text(el('media-explorer-count'), items.length + (items.length < total ? ' of ' + total : '') + (total === 1 ? ' item' : ' items') + (complete ? '' : ' · recent'));
    el('media-explorer-more-btn').classList.toggle('hidden', offset >= total);
    el('media-explorer-scope').classList.toggle('hidden', complete);
  }
  var facetIds = ['kind', 'model', 'folder', 'rating'];
  function hasFilters() {
    return artifact || role || source || el('media-explorer-search').value.trim() || facetIds.some(function (id) { return el('media-explorer-' + id).value; });
  }
  function emptyState() {
    var empty = el('media-explorer-empty'); empty.classList.toggle('hidden', items.length > 0 || loading);
    var filtered = hasFilters();
    if (el('media-explorer-status').dataset.state === 'error' && el('media-explorer-status').textContent) {
      text(el('media-explorer-empty-title'), 'Could not load this view');
      text(el('media-explorer-empty-description'), 'Your filters are kept. Try again, or open the Console for the full error.');
      text(el('media-explorer-empty-action'), 'Try again'); return;
    }
    text(el('media-explorer-empty-title'), filtered ? 'No matching media' : 'Your library, in one place');
    text(el('media-explorer-empty-description'), filtered ? 'Try a different source, search or filter.' : 'Generated outputs and saved references appear here. Discover all to include recognized source Sets.');
    text(el('media-explorer-empty-action'), !full ? 'Discover all media' : filtered ? 'Clear filters' : 'Refresh library');
  }
  function filterControls() {
    var chips = el('media-explorer-filter-chips'); chips.replaceChildren();
    function chip(label, clear) {
      var button = document.createElement('button'); button.type = 'button'; text(button, label + ' ×');
      button.title = label; button.setAttribute('aria-label', 'Remove filter: ' + label); button.addEventListener('click', clear); chips.appendChild(button);
    }
    var search = el('media-explorer-search');
    if (artifact) chip('Focused media', function () { artifact = ''; load(true); });
    if (search.value.trim()) chip('“' + search.value.trim() + '”', function () { search.value = ''; load(true); });
    facetIds.slice(1).forEach(function (id) {
      var select = el('media-explorer-' + id);
      if (select.value) chip(select.options[select.selectedIndex].textContent, function () { select.value = ''; load(true); });
    });
    el('media-explorer-clear-filters').classList.toggle('hidden', !hasFilters() && el('media-explorer-sort').value === 'newest');
    var activeSource = sourceButtons.find(function (button) { return button.classList.contains('active'); });
    text(el('media-explorer-heading'), activeSource ? activeSource.textContent : 'All media');
    sourceButtons.forEach(function (button) { button.setAttribute('aria-pressed', String(button.classList.contains('active'))); });
  }
  function facets(data) {
    ['model', 'folder'].forEach(function (id) {
      var select = el('media-explorer-' + id), current = select.value;
      var options = (data || {})[id === 'model' ? 'models' : 'folders'] || [];
      if (current && options.indexOf(current) < 0) options = options.concat([current]);
      select.replaceChildren();
      var any = document.createElement('option'); any.value = ''; text(any, id === 'model' ? 'All models' : 'All Sets'); select.appendChild(any);
      options.forEach(function (value) { var option = document.createElement('option'); option.value = value; text(option, value); select.appendChild(option); });
      select.value = current;
      select.classList.toggle('hidden', !options.length);
    });
  }
  function load(reset) {
    if (!visible) return;
    clearTimeout(debounce);
    window.syncShellLocationRoute();
    filterControls();
    if (reset) {
      serial++; loading = false; needsLoad = true;
    }
    if (loading && !reset) return;
    if (reset && activeRequest) activeRequest.abort();
    var request = serial;
    loading = true;
    el('media-explorer-grid').setAttribute('aria-busy', 'true');
    el('media-explorer-more-btn').disabled = true;
    emptyState();
    var controller = new AbortController(); activeRequest = controller;
    el('media-explorer-scan-all').disabled = full && loading;
    el('media-explorer-status').textContent = full ? 'Scanning all recognized media sources…' : 'Discovering recent media…';
    el('media-explorer-status').dataset.state = 'loading';
    var qs = new URLSearchParams({limit:pageSize, offset:reset ? 0 : offset, role:role,
      kind:el('media-explorer-kind').value, search:el('media-explorer-search').value.trim(),
      sort:el('media-explorer-sort').value, source:source, full:full ? '1' : '0',
      model:el('media-explorer-model').value, folder:el('media-explorer-folder').value, rating:el('media-explorer-rating').value, artifact:artifact});
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
          text(card.querySelector('.media-explorer-card-badge'), badgeText(item));
          card.querySelector('.media-explorer-card-open').setAttribute('aria-label', item.fileName + ', ' + item.role);
          card.dataset.index = index;
          if (host.children[index] !== card) host.insertBefore(card, host.children[index] || null);
          if (previous && previous.id === item.id) active = index;
        });
        offset = incoming.length;
        if (artifact) active = items.findIndex(function (item) { return item.id === artifact; });
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
      facets(data.facets);
      needsLoad = false;
      text(el('media-explorer-status'), '');
    }).catch(function (err) { if (request === serial && err.name !== 'AbortError') report(err); })
      .finally(function () { if (request === serial) {
        loading = false; activeRequest = null; el('media-explorer-scan-all').disabled = false;
        el('media-explorer-more-btn').disabled = false; el('media-explorer-grid').setAttribute('aria-busy', 'false'); emptyState();
      } });
  }
  function open(target) {
    if (visible && !target) return;
    if (!routeInitialized) {
      routeInitialized = true;
      if (window.location.hash.split('?')[0] === '#/media') {
        var params = new URLSearchParams(window.location.hash.split('?')[1] || '');
        role = params.get('role') || ''; source = params.get('source') || '';
        artifact = params.get('artifact') || '';
        full = params.get('full') === '1' || source === 'set';
        el('media-explorer-search').value = params.get('q') || '';
        el('media-explorer-kind').value = params.get('kind') || '';
        el('media-explorer-sort').value = params.get('sort') || 'newest';
        facetIds.slice(1).forEach(function (id) {
          var value = params.get(id === 'folder' ? 'mediaSet' : id) || '';
          if (value && (id === 'model' || id === 'folder')) {
            var option = document.createElement('option'); option.value = value; text(option, value); el('media-explorer-' + id).appendChild(option);
          }
          el('media-explorer-' + id).value = value;
        });
        sourceButtons.forEach(function (button, index) {
          var match = source ? button.dataset.mediaSource === source : button.dataset.mediaRole === role;
          button.classList.toggle('active', match);
          if (match) el('media-explorer-source-chooser').value = index;
        });
      }
    }
    if (target) {
      source = target.source; role = ''; artifact = target.id; full = true; needsLoad = true;
      el('media-explorer-search').value = ''; el('media-explorer-sort').value = 'newest';
      facetIds.forEach(function (id) { el('media-explorer-' + id).value = ''; });
      sourceButtons.forEach(function (button, index) {
        var match = button.dataset.mediaSource === source;
        button.classList.toggle('active', match);
        if (match) el('media-explorer-source-chooser').value = index;
      });
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
      artifact = '';
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
      artifact = '';
      if (source === 'set') full = true;
      role = '';
      Array.prototype.forEach.call(document.querySelectorAll('.media-explorer-source'), function (node) { node.classList.toggle('active', node === button); });
      load(true);
    });
  });
  el('media-explorer-clear-selection').addEventListener('click', function () { selected.clear(); updateSelection(); });
  el('media-explorer-compare').addEventListener('click', function () {
    var chosen = items.filter(function (item) { return selected.has(item.id); });
    if (chosen.length < 2 || chosen.length > 4) return;
    el('media-explorer-inspector-body').querySelectorAll('video').forEach(function (video) { video.pause(); });
    var host = el('media-explorer-compare-content');
    host.replaceChildren();
    host.classList.toggle('survey', chosen.length > 2);
    chosen.forEach(function (item) {
      var pane = document.createElement('div'); pane.className = 'media-explorer-compare-pane';
      pane.tabIndex = 0;
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
    artifact = '';
    clearTimeout(debounce); debounce = setTimeout(function () { load(true); }, 250);
  });
  el('media-explorer-kind').addEventListener('change', function () { load(true); });
  facetIds.slice(1).forEach(function (id) { el('media-explorer-' + id).addEventListener('change', function () { load(true); }); });
  el('media-explorer-sort').addEventListener('change', function () { load(true); });
  el('media-explorer-size').addEventListener('input', function () {
    el('media-explorer-grid').style.setProperty('--media-tile-width', this.value + 'px');
  });
  var sourceButtons = Array.prototype.slice.call(document.querySelectorAll('.media-explorer-source'));
  sourceButtons.forEach(function (button, index) {
    button.setAttribute('aria-label', button.textContent);
    var option = document.createElement('option'); option.value = index; text(option, button.textContent);
    el('media-explorer-source-chooser').appendChild(option);
    button.addEventListener('click', function () { el('media-explorer-source-chooser').value = index; });
  });
  el('media-explorer-source-chooser').addEventListener('change', function () { sourceButtons[Number(this.value)].click(); });
  el('media-explorer-clear-filters').addEventListener('click', function () {
    el('media-explorer-search').value = ''; el('media-explorer-sort').value = 'newest';
    facetIds.forEach(function (id) { el('media-explorer-' + id).value = ''; });
    sourceButtons[0].click();
  });
  el('media-explorer-empty-action').addEventListener('click', function () {
    if (el('media-explorer-status').dataset.state === 'error' && el('media-explorer-status').textContent) load(true);
    else if (!full) { full = true; load(true); }
    else if (hasFilters()) el('media-explorer-clear-filters').click();
    else load(true);
  });
  ['fit', 'fill'].forEach(function (mode) {
    el('media-explorer-' + mode).addEventListener('click', function () {
      el('media-explorer-grid').classList.toggle('fill', mode === 'fill');
      el('media-explorer-fit').setAttribute('aria-pressed', String(mode === 'fit'));
      el('media-explorer-fill').setAttribute('aria-pressed', String(mode === 'fill'));
    });
  });
  ['media-explorer-loupe', 'media-explorer-compare-dialog'].forEach(function (id) {
    el(id).addEventListener('close', function () {
      this.querySelectorAll('video').forEach(function (video) { video.pause(); });
      if (id === 'media-explorer-loupe' && loupeReturn) {
        if (!loupeReturn.inspectorOpen) el('media-explorer-inspector').classList.add('hidden');
        document.querySelector('.media-explorer-main').scrollTop = loupeReturn.scroll;
        loupeReturn = null;
      }
      if (active >= 0 && visible) el('media-explorer-grid').children[active].querySelector('.media-explorer-card-open').focus({preventScroll: true});
    });
  });
  el('media-explorer-zoom').addEventListener('click', function () {
    var zoomed = el('media-explorer-loupe-content').classList.toggle('zoomed');
    this.setAttribute('aria-pressed', String(zoomed));
  });
  el('media-explorer-compare-dialog').addEventListener('keydown', function (event) {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || event.target.tagName === 'VIDEO') return;
    event.preventDefault();
    var panes = Array.prototype.slice.call(el('media-explorer-compare-content').children);
    var current = panes.indexOf(event.target.closest('.media-explorer-compare-pane'));
    panes[Math.max(0, Math.min(panes.length - 1, current + (event.key === 'ArrowLeft' ? -1 : 1)))].focus();
  });
  el('media-explorer-close-details').addEventListener('click', function () {
    var previous = active; selectItem(-1);
    if (previous >= 0) el('media-explorer-grid').children[previous].querySelector('.media-explorer-card-open').focus({preventScroll: true});
  });
  el('media-explorer-close-loupe').addEventListener('click', function () { el('media-explorer-loupe').close(); });
  el('media-explorer-next').addEventListener('click', function () { selectItem(Math.min(items.length - 1, active + 1)); openLoupe(); });
  el('media-explorer-previous').addEventListener('click', function () { selectItem(Math.max(0, active - 1)); openLoupe(); });
  document.addEventListener('keydown', function (event) {
    if (!visible || event.defaultPrevented || el('media-explorer-compare-dialog').open) return;
    if (!el('media-explorer-workspace').contains(event.target)) return;
    if (event.target.closest('input, select, textarea, [contenteditable="true"]') && event.target.type !== 'checkbox') return;
    var loupe = el('media-explorer-loupe').open;
    if (!loupe && event.key === 'Escape') { selected.clear(); updateSelection(); selectItem(-1); return; }
    if (!loupe && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault(); items.forEach(function (item) { selected.add(item.id); }); updateSelection(); return;
    }
    if (!loupe && !event.target.closest('.media-explorer-card')) return;
    var focused = Number(event.target.closest('.media-explorer-card') && event.target.closest('.media-explorer-card').dataset.index);
    if (!loupe && event.key === 'Enter') { event.preventDefault(); openLoupe(focused); return; }
    if (!loupe && event.key === ' ' && event.target.type !== 'checkbox') {
      event.preventDefault();
      var id = items[focused].id;
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      anchor = focused; updateSelection(); return;
    }
    if (loupe && event.key.toLowerCase() === 'z' && !event.ctrlKey && !event.metaKey && !el('media-explorer-zoom').disabled) {
      event.preventDefault(); el('media-explorer-zoom').click(); return;
    }
    var columns = getComputedStyle(el('media-explorer-grid')).gridTemplateColumns.split(' ').length;
    var delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : !loupe && event.key === 'ArrowUp' ? -columns : !loupe && event.key === 'ArrowDown' ? columns : !loupe && event.key === 'Home' ? -focused : !loupe && event.key === 'End' ? items.length - 1 - focused : 0;
    if (delta && items.length) {
      event.preventDefault(); var next = Math.max(0, Math.min(items.length - 1, (loupe ? active : focused) + delta));
      selectItem(next);
      if (loupe) openLoupe(); else {
        if (event.shiftKey) {
          if (anchor < 0) anchor = focused;
          for (var i = Math.min(anchor, next); i <= Math.max(anchor, next); i++) selected.add(items[i].id);
          updateSelection();
        }
        el('media-explorer-grid').children[next].querySelector('.media-explorer-card-open').focus();
      }
    }
  });
  window.openMediaExplorerActivity = open;
  window.closeMediaExplorerActivity = close;
  window.appendMediaExplorerRouteParams = function (params) {
    if (role) params.set('role', role);
    if (source) params.set('source', source);
    if (artifact) params.set('artifact', artifact);
    if (full) params.set('full', '1');
    if (el('media-explorer-search').value.trim()) params.set('q', el('media-explorer-search').value.trim());
    if (el('media-explorer-kind').value) params.set('kind', el('media-explorer-kind').value);
    facetIds.slice(1).forEach(function (id) { if (el('media-explorer-' + id).value) params.set(id === 'folder' ? 'mediaSet' : id, el('media-explorer-' + id).value); });
    if (el('media-explorer-sort').value !== 'newest') params.set('sort', el('media-explorer-sort').value);
  };
})();
