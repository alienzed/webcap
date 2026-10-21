(function () {
  'use strict';
  var visible = false, items = [], offset = 0, total = 0, active = -1, role = '', loading = false;
  var selected = new Set(), anchor = -1;
  var source = '', pageSize = 60, serial = 0, full = false, complete = false, activeRequest = null;
  var exportMode = 'copy', exportItems = [];
  function chooseExport(mode, chosen) {
    exportMode = mode; exportItems = chosen;
    if (!chosen.length) return;
    var dialog = el('media-explorer-export-dialog');
    text(el('media-explorer-export-heading'), mode === 'clip' ? 'Clip to Set' : 'Copy to Set');
    text(el('media-explorer-export-count'), chosen.length + ' source file' + (chosen.length === 1 ? '' : 's'));
    el('media-explorer-export-trim').classList.toggle('hidden', mode !== 'clip');
    el('media-explorer-export-submit').textContent = mode === 'clip' ? 'Export clip' : 'Copy to Set';
    el('media-explorer-export-status').textContent = '';
    el('media-explorer-export-new-set').value = '';
    browseDestinations();
    dialog.showModal();
  }
  function browseDestinations() {
    var path = el('media-explorer-export-destination').value.trim();
    var host = el('media-explorer-export-folders'); host.replaceChildren();
    return fetch('/fs/media_explorer/external/destinations?destination=' + encodeURIComponent(path))
      .then(function (res) { return res.json().then(function (data) {
        if (!res.ok || !data.ok) throw Error(data.error || 'Could not list Set folders');
        return data;
      }); }).then(function (data) {
        (data.folders || []).forEach(function (name) {
          var button = document.createElement('button'); button.type = 'button';
          button.textContent = '📁 ' + name; button.onclick = function () {
            el('media-explorer-export-destination').value = [path, name].filter(Boolean).join('/');
            browseDestinations();
          }; host.appendChild(button);
        });
      }).catch(function (err) {
        el('media-explorer-export-status').textContent = err.message; report(err);
      });
  }
  var needsLoad = true;
  var externalDirectory = '', externalFolders = [], reverseSort = false, galleryHome = null;
  function setExternalDirectory(path) {
    externalDirectory = path; selected.clear(); anchor = -1;
    el('media-explorer-recursive').checked = false; selectItem(-1); load(true);
  }
  function renderExternalFolders() {
    var host = el('media-explorer-folder-rows'); host.replaceChildren();
    el('media-explorer-external-navigation').classList.toggle('hidden', !isExternal());
    el('media-explorer-directory-label').textContent = '/' + externalDirectory;
    el('media-explorer-up').disabled = !externalDirectory;
    if (!isExternal() || el('media-explorer-recursive').checked) return;
    externalFolders.forEach(function (name) {
      var button = document.createElement('button');
      button.type = 'button'; button.textContent = '📁 ' + name;
      button.onclick = function () { setExternalDirectory([externalDirectory, name].filter(Boolean).join('/')); };
      host.appendChild(button);
    });
  }
  function renderMainPreview() {
    var stage = el('media-explorer-preview-stage');
    if (explorerMode === 'grid') return;
    var item = active >= 0 ? items[active] : null;
    var id = item ? item.id : '';
    if (stage.dataset.id === id && stage.children.length && !stage.querySelector('#media-explorer-grid')) return;
    stage.dataset.id = id;
    stage.replaceChildren();
    if (item) stage.appendChild(mediaElement(item, true));
    else { var label = document.createElement('span'); label.textContent = 'Select a file to preview'; stage.appendChild(label); }
  }
  function selectSideRow(id, event, checkbox) {
    var index = items.findIndex(function (item) { return item.id === id; });
    if (index < 0) return;
    if (checkbox || event.ctrlKey || event.metaKey || event.shiftKey) {
      if (event.shiftKey && anchor >= 0) {
        for (var i = Math.min(index, anchor); i <= Math.max(index, anchor); i++) selected.add(items[i].id);
      } else if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      anchor = index;
    } else {
      anchor = index; selected.clear(); selectItem(index);
    }
    updateSelection();
  }
  function syncSideListSelection() {
    Array.prototype.forEach.call(el('media-explorer-side-list').children, function (row) {
      var id = row.dataset.id;
      row.classList.toggle('active', active >= 0 && items[active] && items[active].id === id);
      row.classList.toggle('selected', selected.has(id));
      row.querySelector('input').checked = selected.has(id);
    });
  }
  function renderSideList() {
    if (explorerMode !== 'grid') return;
    var host = el('media-explorer-side-list');
    var existing = new Map(Array.prototype.map.call(host.children, function (row) { return [row.dataset.id, row]; }));
    var keep = new Set(items.map(function (item) { return item.id; }));
    existing.forEach(function (row, id) { if (!keep.has(id)) row.remove(); });
    items.forEach(function (item, index) {
      var row = existing.get(item.id);
      if (!row) {
        row = document.createElement('div'); row.className = 'media-explorer-side-row'; row.dataset.id = item.id; row.dataset.mediaKind = item.mediaKind;
        var check = document.createElement('input'); check.type = 'checkbox';
        check.setAttribute('aria-label', 'Select ' + item.fileName);
        check.addEventListener('click', function (event) { event.stopPropagation(); selectSideRow(item.id, event, true); });
        var button = document.createElement('button'); button.type = 'button'; button.className = 'media-explorer-side-open';
        button.addEventListener('click', function (event) { selectSideRow(item.id, event, false); });
        button.addEventListener('dblclick', function () {
          var next = items.findIndex(function (candidate) { return candidate.id === item.id; });
          if (next >= 0) { selectItem(next); openLoupe(); }
        });
        row.appendChild(check); row.appendChild(button);
      }
      row.dataset.mediaKind = item.mediaKind;
      row.querySelector('button').textContent = item.fileName;
      row.querySelector('button').title = item.relativePath || item.fileName;
      row.querySelector('input').setAttribute('aria-label', 'Select ' + item.fileName);
      if (host.children[index] !== row) host.insertBefore(row, host.children[index] || null);
    });
    syncSideListSelection();
  }
  function placeGallery() {
    var gallery = el('media-explorer-grid'), stage = el('media-explorer-preview-stage');
    if (!galleryHome) galleryHome = el('media-explorer-gallery-area');
    el('media-explorer-workspace').classList.toggle('explorer-grid-mode', explorerMode === 'grid');
    el('media-explorer-side-list').classList.toggle('hidden', explorerMode !== 'grid');
    if (explorerMode === 'grid') { stage.dataset.id = ''; stage.replaceChildren(); stage.appendChild(gallery); renderSideList(); }
    else { galleryHome.appendChild(gallery); renderMainPreview(); }
  }
  var explorerMode = 'list', externalPath = '', externalDiscoveryTimer = null, externalMetadataTimer = null;
  var externalRevision = -1, externalPendingRefresh = false, externalOverview = '', externalJobSummary = '', lastExternalError = '';
  function externalSummary() {
    var node = el('media-explorer-metadata-progress');
    text(node, [externalOverview, externalJobSummary].filter(Boolean).join(' · '));
    node.classList.toggle('hidden', !node.textContent);
    el('media-explorer-stop-metadata').classList.toggle('hidden', !externalJobRunning);
  }
  var externalJobRunning = false;
  function canRefreshExternalPage() {
    return !loading && !selected.size && active < 0 && offset <= pageSize &&
      !el('media-explorer-loupe').open && !el('media-explorer-compare-dialog').open;
  }
  function pollExternalDiscovery() {
    if (!visible || !isExternal() || !externalPath) return;
    fetch('/fs/media_explorer/external/status?path=' + encodeURIComponent(externalPath))
      .then(function (res) { return res.json().then(function (data) {
        if (!res.ok || !data.ok) throw Error(data.error || 'External discovery status failed');
        return data;
      }); }).then(function (data) {
        if (!visible || !isExternal()) return;
        externalOverview = data.discovered + ' found · ' + data.analyzed + ' analyzed' +
          (data.complete ? '' : ' · discovering') + (data.warnings ? ' · ' + data.warnings + ' warnings' : '');
        externalSummary();
        if (data.error && data.error !== lastExternalError) { lastExternalError = data.error; report(new Error(data.error)); }
        if (data.lastWarning && data.lastWarning !== lastExternalError) { lastExternalError = data.lastWarning; window.reportConsoleError('External media discovery', data.lastWarning); }
        if (data.revision !== externalRevision) {
          if (canRefreshExternalPage()) load(true, {soft:true});
          else {
            externalPendingRefresh = true;
            externalOverview += ' · Refresh to include changes';
            externalSummary(); count();
          }
        }
        if (!data.complete) externalDiscoveryTimer = setTimeout(pollExternalDiscovery, 1400);
      }).catch(report);
  }
  function isExternal() { return source === 'external'; }
  function externalParams() { return {directory:externalDirectory, recursive:el('media-explorer-recursive').checked ? '1' : '0', path:externalPath, min_side:el('media-explorer-min-side').value, min_mp:el('media-explorer-min-mp').value, min_duration:el('media-explorer-min-duration').value, max_duration:el('media-explorer-max-duration').value}; }
  function syncExternalControls() {
    var external = isExternal();
    el('media-explorer-external-path-bar').classList.toggle('hidden', !external);
    el('media-explorer-external-navigation').classList.toggle('hidden', !external);
    el('media-explorer-folder-rows').classList.toggle('hidden', !external);
    el('media-explorer-external-filters').classList.toggle('hidden', !external);
    el('media-explorer-scan-all').classList.toggle('hidden', external);
    el('media-explorer-model').classList.toggle('hidden', external);
    el('media-explorer-folder').classList.toggle('hidden', external);
    el('media-explorer-rating').classList.toggle('hidden', external);
    el('media-explorer-date').classList.toggle('hidden', external);
    el('media-explorer-size').disabled = explorerMode !== 'grid';
    el('media-explorer-workspace').querySelector('.media-explorer-size-label').classList.toggle('hidden', explorerMode !== 'grid');
    el('media-explorer-workspace').querySelector('.media-explorer-fit-controls').classList.toggle('hidden', explorerMode !== 'grid');
    el('media-explorer-metadata-progress').classList.toggle('hidden', !external || !(externalOverview || externalJobSummary));
    el('media-explorer-stop-metadata').classList.toggle('hidden', !external || !externalJobRunning);
    el('media-explorer-search').placeholder = external ? 'Search filenames and relative paths…' : 'Search generated media, prompts, models…';
    ['path', 'type', 'size', 'resolution', 'megapixels', 'duration'].forEach(function (value) {
      var option = el('media-explorer-sort').querySelector('option[value="' + value + '"]');
      option.hidden = !external;
    });
    el('media-explorer-sort').querySelector('option[value="rating"]').hidden = external;
    el('media-explorer-sort-reverse').classList.toggle('hidden', !external);
  }
  function setExplorerMode(next) {
    if (next === 'single') {
      if (items.length) openLoupe(active >= 0 ? active : 0);
      return; // Existing fullscreen viewer is the Single Item presentation.
    }
    explorerMode = next;
    var gallery = el('media-explorer-grid');
    gallery.classList.toggle('explorer-list', next === 'list');
    document.querySelectorAll('[data-explorer-mode]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(btn.dataset.explorerMode === next));
    });
    items.forEach(function (item, index) {
      var card = gallery.children[index];
      if (!card || card.dataset.id !== item.id) return;
      var frame = card.querySelector('.media-explorer-card-thumb');
      var media = frame.querySelector('img, video, .external-video-placeholder');
      if (next === 'list' && media) media.remove();
      if (next !== 'list' && !media) frame.prepend(
        item.source === 'external' ? externalTileMedia(item) : mediaElement(item, false));
    });
    syncExternalControls(); placeGallery();
  }
  function externalTileMedia(item) {
    if (item.mediaKind === 'video') {
      var placeholder = document.createElement('span');
      placeholder.className = 'external-video-placeholder';
      text(placeholder, '▶ Video');
      return placeholder;
    }
    return mediaElement(item, false);
  }
  function stopExternalTimers() {
    clearTimeout(externalDiscoveryTimer); clearTimeout(externalMetadataTimer);
    externalDiscoveryTimer = null; externalMetadataTimer = null;
  }
  function externalMetadataStatus() {
    if (!visible || !isExternal() || !externalPath) return;
    fetch('/fs/media_explorer/external/metadata/status').then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || !data.ok) throw Error(data.error || 'Metadata status failed');
        return data;
      });
    }).then(function (job) {
      if (!visible || !isExternal()) return;
      externalJobRunning = !!job.running;
      externalJobSummary = job.total
        ? 'Metadata ' + job.completed + '/' + job.total + ' · ' + job.failed + ' failed' +
          (job.uncached ? ' · ' + job.uncached + ' uncached' : '') +
          (job.running && job.current ? ' · ' + job.current : '') + (job.canceled ? ' · stopped' : '')
        : '';
      externalSummary();
      if (job.lastError && job.lastError !== lastExternalError) {
        lastExternalError = job.lastError;
        window.reportConsoleError('Media Explorer metadata', job.lastError);
      }
      if (job.running) externalMetadataTimer = setTimeout(externalMetadataStatus, 1600);
      else if (job.total && canRefreshExternalPage() && externalRevision !== -1) load(true, {soft:true});
      else if (job.total) {
        externalPendingRefresh = true;
        externalJobSummary += ' · Refresh to show updated metadata';
        externalSummary(); count();
      }
    }).catch(report);
  }
  function requestExternalMetadata(scope, files) {
    var payload = Object.assign(externalParams(), {
      scope:scope, files:files || [], kind:el('media-explorer-kind').value,
      search:el('media-explorer-search').value.trim()
    });
    return fetch('/fs/media_explorer/external/metadata', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || !data.ok) throw Error(data.error || 'Metadata scan failed');
        return data;
      });
    }).then(function (job) {
      externalJobRunning = !!job.running;
      if (!job.discoveryComplete && scope === 'filtered') {
        externalJobSummary = 'Scanning discovered matches; folder discovery is still running';
      }
      externalSummary();
      if (job.running) {
        clearTimeout(externalMetadataTimer);
        externalMetadataTimer = setTimeout(externalMetadataStatus, 300);
      }
    }).catch(report);
  }

  var routeInitialized = false;
  var sourceNames = {generate: 'Generate', test: 'Test Generations', epoch: 'Epoch Finder', storyboard: 'Storyboard', external: 'External folders'};
  var roleNames = {generated: 'Generated', reference: 'Reference', source: 'Source media'};
  var mediaFacts = new Map();
  var loupeReturn = null;
  var artifact = '', owner = '';
  function storyboardType() { return source === 'storyboard' ? el('media-explorer-storyboard-type').value : ''; }
  function syncStoryboardType() { el('media-explorer-storyboard-type').classList.toggle('hidden', source !== 'storyboard'); }
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
    detail('Path', item.relativePath, dl);
    detail('Dimensions', facts.resolution || (item.metadata && item.metadata.resolution) || item.resolution, dl);
    if (item.metadata && item.metadata.resolution) { var wh = item.metadata.resolution.split('x').map(Number); detail('Megapixels', (wh[0] * wh[1] / 1000000).toFixed(2) + ' MP', dl); }
    if (item.mediaKind === 'video') detail('Duration', duration(Number.isFinite(facts.duration) ? facts.duration : (item.metadata && item.metadata.duration != null ? item.metadata.duration : item.duration)), dl);
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
    text(el('media-explorer-selection-hint'), selected.size > 4 ? 'Compare supports up to 4 selected items' : selected.size < 2 ? 'Select 2–4 to compare' : 'Ready to compare');
    var chosen = items.filter(function (item) { return selected.has(item.id); });
    el('media-explorer-copy-selected').classList.toggle('hidden', !isExternal());
    el('media-explorer-compare').disabled = chosen.length < 2 || chosen.length > 4;
    text(el('media-explorer-compare'), chosen.length > 2 && chosen.length <= 4 ? 'Survey' : 'Compare');
    el('media-explorer-compare').title = 'Compare 2–4 media; videos play independently';
    syncSideListSelection();
    Array.prototype.forEach.call(el('media-explorer-grid').children, function (card, i) {
      card.classList.toggle('selected', selected.has(items[i].id));
      card.querySelector('.media-explorer-card-check').checked = selected.has(items[i].id);
    });
  }
  function selectItem(index) {
    active = index;
    syncSideListSelection();
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
    if (index < 0 || !items[index]) { inspector.classList.add('hidden'); renderMainPreview(); return; }
    var item = items[index];
    text(el('media-explorer-inspector-name'), item.fileName);
    el('media-explorer-inspector-name').title = item.fileName;
    var provenance = document.createElement('div'); provenance.className = 'media-explorer-provenance';
    text(provenance, item.source === 'external' ? 'External · ' + item.relativePath : 'Owned by · ' + sourceNames[item.source] + ' › ' + (item.contextLabel || item.storageId)); host.appendChild(provenance);
    var actions = document.createElement('div'); actions.className = 'media-explorer-inspector-actions'; host.appendChild(actions);
    if (item.storageId) {
      var related = document.createElement('button');
      related.type = 'button';
      related.className = 'review-captions-btn';
      text(related, 'Show media from this ' + (sourceNames[item.source] || 'source'));
      related.addEventListener('click', function () {
        owner = item.storageId; source = item.source; role = ''; artifact = '';
        el('media-explorer-search').value = '';
        facetIds.forEach(function (id) { el('media-explorer-' + id).value = ''; });
        el('media-explorer-storyboard-type').value = '';
        sourceButtons.forEach(function (button) {
          button.classList.toggle('active', button.dataset.mediaSource === source);
        });
        load(true);
      });
      actions.appendChild(related);
    }
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
    var uses = Array.from(new Map((item.uses || []).map(function (use) { return [use.source + ':' + use.storageId + ':' + (use.takeId || '') + ':' + use.role, use]; })).values());
    if (uses.length) {
      var relationships = document.createElement('details'), relationshipsTitle = document.createElement('summary');
      relationships.className = 'media-explorer-inspector-section'; relationships.open = true;
      text(relationshipsTitle, 'Used by · ' + uses.length); relationships.appendChild(relationshipsTitle);
      uses.forEach(function (use) {
        var canOpen = ['generate', 'storyboard', 'test', 'epoch'].indexOf(use.source) !== -1;
        var row = document.createElement(canOpen ? 'button' : 'p');
        text(row, (use.label || use.storageId) + ' · ' + use.role);
        if (canOpen) {
          row.type = 'button'; row.className = 'media-explorer-use-link';
          row.addEventListener('click', function () {
            if (use.source === 'generate') window.openGenerateActivity({storageId: use.storageId});
            else if (use.source === 'storyboard') window.openStoryboardActivity({storyId: item.storageId, sceneId: use.storageId, takeId: use.takeId || ''});
            else if (use.source === 'test') window.openTestBenchActivity({folder: item.ownerFolder, sessionId: item.storageId, modelId: item.model || ''});
            else if (use.source === 'epoch') window.openTestBenchActivity({folder: item.ownerFolder, campaignId: item.storageId, modelId: item.model || ''});
          });
        }
        relationships.appendChild(row);
      });
      host.appendChild(relationships);
      if (item.source === 'storyboard' && uses.length > 1) {
        text(relationshipsTitle, 'Choose owning scene · ' + uses.length);
      }
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
                text(sub, isExternal() ? ((item.metadata && item.metadata.resolution) || 'Metadata unknown') + (item.metadata && item.metadata.duration != null ? ' · ' + duration(item.metadata.duration) : '') : cardSummary(item));
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
    if (item.source === 'test' && item.ownerFolder && item.storageId && item.fileName) {
      var testRating = document.createElement('div');
      testRating.className = 'media-explorer-rating';
      var testRatingLabel = document.createElement('span');
      text(testRatingLabel, 'Rate Test result');
      testRating.appendChild(testRatingLabel);
      for (var testScore = 0; testScore <= 5; testScore++) {
        (function (value) {
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'review-captions-btn';
          text(button, value === 0 ? 'Clear' : String(value) + '★');
          button.setAttribute('aria-label', value === 0 ? 'Clear Test rating' : 'Rate Test result ' + value + ' out of 5');
          button.setAttribute('aria-pressed', String(Number(item.rating || 0) === value));
          button.addEventListener('click', function () {
            testRating.querySelectorAll('button').forEach(function (node) { node.disabled = true; });
            fetch('/fs/test_generations', {
              method: 'POST', headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({folder: item.ownerFolder, operation: 'test_rate_result',
                criteria: {session: item.storageId, mediaFile: item.fileName, rating: value}})
            }).then(function (response) {
              return response.json().then(function (payload) {
                if (!response.ok || !payload || !payload.ok) throw new Error(payload && payload.error || 'Could not rate Test result.');
                return payload;
              });
            }).then(function (payload) {
              item.rating = payload.rating;
              testRating.querySelectorAll('button').forEach(function (node, score) {
                node.setAttribute('aria-pressed', String(Number(item.rating || 0) === score));
              });
              renderDetails(item, dl);
              var card = el('media-explorer-grid').children[items.indexOf(item)];
              if (card) text(card.querySelector('.media-explorer-card-sub'), isExternal() ? ((item.metadata && item.metadata.resolution) || 'Metadata unknown') : cardSummary(item));
              if (visible && (el('media-explorer-rating').value || el('media-explorer-sort').value === 'rating')) load(true);
            }).catch(report).finally(function () {
              testRating.querySelectorAll('button').forEach(function (node) { node.disabled = false; });
            });
          });
          testRating.appendChild(button);
        })(testScore);
      }
      host.appendChild(testRating);
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
      text(storyBtn, (item.uses || []).length > 1 ? 'Choose owning scene in Used by' : 'Manage in Storyboard');
      storyBtn.disabled = (item.uses || []).length !== 1;
      storyBtn.addEventListener('click', function () {
        var scene = item.uses && item.uses[0] && item.uses[0].storageId || '';
        window.openStoryboardActivity({storyId: item.storageId, sceneId: scene, takeId: item.uses && item.uses[0] && item.uses[0].takeId || ''});
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
    var deletion = null;
    if (item.source === 'generate' && item.role === 'generated' && item.storageId) {
      deletion = {label: 'Delete generation', description: 'generation and its stored references',
        url: '/fs/generate/result/delete', data: {storageId: item.storageId}};
    } else if (item.source === 'test' && item.ownerFolder && item.storageId) {
      deletion = {label: 'Delete Test session', description: 'entire Test session and all its generated results',
        url: '/fs/test_generations', data: {folder: item.ownerFolder, operation: 'test_delete_session',
          criteria: {session: item.storageId}}};
    } else if (item.source === 'epoch' && item.ownerFolder && item.storageId) {
      deletion = {label: 'Delete Epoch campaign', description: 'entire Epoch Finder campaign and its generated results',
        url: '/fs/epoch_finder', data: {folder: item.ownerFolder, operation: 'delete',
          criteria: {campaignId: item.storageId}}};
    }
    if (deletion) {
      var deleteButton = document.createElement('button');
      deleteButton.type = 'button'; deleteButton.className = 'review-captions-btn';
      text(deleteButton, deletion.label);
      deleteButton.addEventListener('click', function () {
        if (!window.confirm('Delete the ' + deletion.description + '? This cannot be undone.')) return;
        deleteButton.disabled = true;
        fetch(deletion.url, {method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(deletion.data)})
          .then(function (response) { return response.json().then(function (payload) {
            if (!response.ok || !payload || !payload.ok)
              throw new Error(payload && payload.error || 'Could not delete generated media.');
            return payload;
          }); })
          .then(function () { selected.clear(); active = -1; artifact = ''; selectItem(-1); load(true); })
          .catch(report).finally(function () { deleteButton.disabled = false; });
      });
      var destructive = document.createElement('div'); destructive.className = 'media-explorer-danger-actions';
      destructive.appendChild(deleteButton); host.appendChild(destructive);
    }
    if (item.source === 'external') {
      var copy = document.createElement('button'); copy.type = 'button'; copy.className = 'review-captions-btn';
      copy.textContent = 'Copy to Set';
      copy.onclick = function () {
        var choices = items.filter(function (candidate) { return selected.has(candidate.id); });
        chooseExport('copy', choices.length ? choices : [item]);
      }; actions.appendChild(copy);
      if (item.mediaKind === 'video') {
        var clip = document.createElement('button'); clip.type = 'button'; clip.className = 'review-captions-btn';
        clip.textContent = 'Clip to Set'; clip.onclick = function () { chooseExport('clip', [item]); };
        actions.appendChild(clip);
      }
    }
    if (item.mediaUrl) {
      var download = document.createElement('a');
      download.className = 'review-captions-btn';
      download.href = item.mediaUrl;
      download.download = item.fileName || 'media';
      download.textContent = 'Download original';
      actions.appendChild(download);
    }
    var open = document.createElement('button'); open.type = 'button';
    open.className = 'review-captions-btn'; text(open, 'View full size');
    open.addEventListener('click', function () { openLoupe(); }); actions.appendChild(open);
    if (typeof related !== 'undefined') actions.appendChild(related);
    inspector.classList.remove('hidden'); renderMainPreview();
  }
  function openLoupe(index) {
    var dlg = el('media-explorer-loupe');
    if (!dlg.open) loupeReturn = {inspectorOpen: !el('media-explorer-inspector').classList.contains('hidden'), scroll: (explorerMode === 'grid' ? el('media-explorer-preview-stage').parentElement : el('media-explorer-gallery-area')).scrollTop};
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
    card.dataset.mediaKind = item.mediaKind;
    card.dataset.index = index;
    var open = document.createElement('button'); open.type = 'button'; open.className = 'media-explorer-card-open';
    open.tabIndex = index === 0 ? 0 : -1;
    open.setAttribute('aria-label', item.fileName + ', ' + item.role);
    card.appendChild(open);
    var frame = document.createElement('div'); frame.className = 'media-explorer-card-thumb';
    if (explorerMode === 'grid') frame.appendChild(
      item.source === 'external' ? externalTileMedia(item) : mediaElement(item, false));
    open.appendChild(frame);
    var badge = document.createElement('span'); badge.className = 'media-explorer-card-badge';
    text(badge, badgeText(item));
    frame.appendChild(badge);
    var meta = document.createElement('div'); meta.className = 'media-explorer-card-meta';
    var name = document.createElement('div'); name.className = 'media-explorer-card-name';
    text(name, item.fileName); meta.appendChild(name);
    if (item.relativePath) { var relative = document.createElement('div'); relative.className = 'media-explorer-card-path'; text(relative, item.relativePath); meta.appendChild(relative); }
    var sub = document.createElement('div'); sub.className = 'media-explorer-card-sub';
    text(sub, isExternal() ? ((item.metadata && item.metadata.resolution) || 'Metadata unknown') + (item.metadata && item.metadata.duration != null ? ' · ' + duration(item.metadata.duration) : '') : cardSummary(item));
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
  function maybeLoadMore() {
    if (!visible || loading || offset >= total || externalPendingRefresh) return;
    var side = el('media-explorer-gallery-area');
    var center = el('media-explorer-preview-stage').parentElement;
    var scrollers = explorerMode === 'grid' ? [side, center] : [side];
    if (scrollers.some(function (node) {
      return node.clientHeight > 0 && node.scrollHeight - node.scrollTop - node.clientHeight < 350;
    })) load(false);
  }
  function count() {
    text(el('media-explorer-count'), items.length + (items.length < total ? ' of ' + total : '') + (total === 1 ? ' item' : ' items') + (isExternal() ? (complete ? '' : ' · discovering…') : (complete ? '' : ' · recent')));
    el('media-explorer-more-btn').classList.toggle('hidden', !externalPendingRefresh);
    text(el('media-explorer-more-btn'), externalPendingRefresh ? 'Refresh results' : 'Load more');
    el('media-explorer-scope').classList.toggle('hidden', complete || isExternal());
    el('media-explorer-view-full-size').disabled = !items.length;
  }
  var facetIds = ['kind', 'model', 'folder', 'rating', 'date'];
  function hasFilters() {
    if (isExternal()) return el('media-explorer-search').value.trim() ||
      el('media-explorer-kind').value ||
      ['min-side', 'min-mp', 'min-duration', 'max-duration'].some(function (name) { return el('media-explorer-' + name).value; });
    return artifact || owner || role || source || storyboardType() || el('media-explorer-search').value.trim() || facetIds.some(function (id) { return el('media-explorer-' + id).value; });
  }
  function emptyState() {
    var empty = el('media-explorer-empty'); empty.classList.toggle('hidden', items.length > 0 || loading);
    var filtered = hasFilters();
    if (el('media-explorer-status').dataset.state === 'error' && el('media-explorer-status').textContent) {
      text(el('media-explorer-empty-title'), 'Could not load this view');
      text(el('media-explorer-empty-description'), 'Your filters are kept. Try again, or open the Console for the full error.');
      text(el('media-explorer-empty-action'), 'Try again'); return;
    }
    text(el('media-explorer-empty-title'), isExternal() && !complete && externalPath
      ? 'Discovering files…' : filtered ? 'No matching media' :
      (isExternal() ? 'Choose an external folder' : 'Generated media, in one place'));
    text(el('media-explorer-empty-description'), isExternal()
      ? (!complete && externalPath ? 'Files will appear as they are discovered. Browsing remains responsive.' :
        'Browse another folder or adjust the filters. Technical metadata filters show verified matches only.')
      : (filtered ? 'Try a different source, search or filter.' : 'Generated outputs and saved references appear here. Scan full history for older generated media.'));
    text(el('media-explorer-empty-action'), isExternal() ? 'Refresh' : (!full ? 'Scan full history' : filtered ? 'Clear filters' : 'Refresh library'));
  }
  function filterControls() {
    var chips = el('media-explorer-filter-chips'); chips.replaceChildren();
    function chip(label, clear) {
      var button = document.createElement('button'); button.type = 'button'; text(button, label + ' ×');
      button.title = label; button.setAttribute('aria-label', 'Remove filter: ' + label); button.addEventListener('click', clear); chips.appendChild(button);
    }
    var search = el('media-explorer-search');
    if (artifact) chip('Focused media', function () { artifact = ''; load(true); });
    if (owner) chip('Related to ' + owner, function () { owner = ''; load(true); });
    if (storyboardType()) chip(storyboardType() === 'exports' ? 'Exported Sequences' : 'Scenes', function () { el('media-explorer-storyboard-type').value = ''; load(true); });
    if (search.value.trim()) chip('“' + search.value.trim() + '”', function () { search.value = ''; load(true); });
    if (isExternal()) {
      ['min-side', 'min-mp', 'min-duration', 'max-duration'].forEach(function (name) {
        var input = el('media-explorer-' + name);
        if (input.value) chip(input.closest('label').textContent.trim() + ' ' + input.value, function () { input.value = ''; load(true); });
      });
    } else facetIds.slice(1).forEach(function (id) {
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
  function load(reset, options) {
    options = options || {};
    if (!visible) return;
    syncExternalControls();
    if (isExternal() && !externalPath) {
      items = []; total = 0; active = -1; selected.clear();
      selectItem(-1); renderExternalFolders();
      el('media-explorer-grid').replaceChildren();
      text(el('media-explorer-count'), 'No folder selected');
      el('media-explorer-view-full-size').disabled = true;
      text(el('media-explorer-status'), 'Enter a folder path and select Browse.');
      return;
    }
    clearTimeout(debounce);
    window.syncShellLocationRoute();
    syncStoryboardType();
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
    el('media-explorer-status').textContent = isExternal() ? 'Discovering external media…' : (full ? 'Scanning full generated-media history…' : 'Discovering recent media…');
    el('media-explorer-status').dataset.state = 'loading';
    var qs = new URLSearchParams({limit:pageSize, offset:reset ? 0 : offset, role:role,
      kind:el('media-explorer-kind').value, search:el('media-explorer-search').value.trim(),
      sort:el('media-explorer-sort').value, source:source, full:full ? '1' : '0',
      storyboard_type:storyboardType(), model:el('media-explorer-model').value, folder:el('media-explorer-folder').value, rating:el('media-explorer-rating').value, date:el('media-explorer-date').value, artifact:artifact, owner:owner});
    if (isExternal()) {
      Object.entries(externalParams()).forEach(function (entry) { qs.set(entry[0], entry[1]); });
      qs.set('directory', externalDirectory);
      qs.set('recursive', el('media-explorer-recursive').checked ? '1' : '0');
      qs.set('direction', reverseSort ? 'asc' : 'desc');
    }
    if (isExternal() && options.refreshFilesystem) qs.set('refresh', '1');
    fetch((isExternal() ? '/fs/media_explorer/external?' : '/fs/media_explorer?') + qs, {signal: controller.signal}).then(function (res) {
      return res.json().catch(function (err) { throw new Error('Media discovery HTTP ' + res.status + ': ' + err.message); }).then(function (data) {
        if (!res.ok || !data.ok) throw new Error(data.error || 'Media discovery failed.');
        return data;
      });
    }).then(function (data) {
      if (request !== serial || !visible) return;
      total = data.total;
      if (reset && isExternal()) externalPendingRefresh = false;
      complete = !!data.complete;
      if (isExternal()) {
        externalFolders = data.folders || []; renderExternalFolders();
        externalRevision = data.revision;
        externalOverview = data.discovered + ' found · ' + data.analyzed + ' analyzed' + (data.complete ? '' : ' · discovering');
        if (data.warnings) externalOverview += ' · ' + data.warnings + ' warnings';
        externalSummary();
        if (data.error) report(new Error(data.error));
        if (data.lastWarning && data.lastWarning !== lastExternalError) {
          lastExternalError = data.lastWarning;
          window.reportConsoleError('External media discovery', data.lastWarning);
        }
      }
      var incoming = data.items || [];
      var host = el('media-explorer-grid');
      if (reset) {
        var previousItems = new Map(items.map(function (item) { return [item.id, item]; }));
        var previous = items[active], cards = new Map();
        Array.prototype.forEach.call(host.children, function (card) { cards.set(card.dataset.id, card); });
        var keep = new Set(incoming.map(function (item) { return item.id; }));
        cards.forEach(function (card, id) { if (!keep.has(id)) card.remove(); });
        items = []; offset = 0; active = -1; anchor = -1;
        if (!options.soft) selected.forEach(function (id) { if (!keep.has(id)) selected.delete(id); });
        incoming.forEach(function (item, index) {
          var card = cards.get(item.id);
          if (card) item = Object.assign(previousItems.get(item.id), item);
          items.push(item);
          if (!card) card = renderCard(item, index);
          text(card.querySelector('.media-explorer-card-sub'), isExternal() ? ((item.metadata && item.metadata.resolution) || 'Metadata unknown') + (item.metadata && item.metadata.duration != null ? ' · ' + duration(item.metadata.duration) : '') : cardSummary(item));
          text(card.querySelector('.media-explorer-card-badge'), badgeText(item));
          card.querySelector('.media-explorer-card-open').setAttribute('aria-label', item.fileName + ', ' + item.role);
          card.dataset.index = index;
          card.dataset.mediaKind = item.mediaKind;
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
      count(); renderSideList(); updateSelection(); renderMainPreview();
      if (!isExternal()) facets(data.facets);
      needsLoad = false;
      if (isExternal()) {
        if (!data.complete) {
          clearTimeout(externalDiscoveryTimer);
          externalDiscoveryTimer = setTimeout(pollExternalDiscovery, 1400);
        }

      }
      if (!data.error) text(el('media-explorer-status'), '');
    }).catch(function (err) { if (request === serial && err.name !== 'AbortError') report(err); })
      .finally(function () { if (request === serial) {
        loading = false; activeRequest = null; el('media-explorer-scan-all').disabled = false;
        el('media-explorer-more-btn').disabled = false; el('media-explorer-grid').setAttribute('aria-busy', 'false'); emptyState();
        maybeLoadMore();
      } });
  }
  function open(target) {
    if (visible && !target) return;
    if (!routeInitialized) {
      routeInitialized = true;
      if (window.location.hash.split('?')[0] === '#/media') {
        var params = new URLSearchParams(window.location.hash.split('?')[1] || '');
        role = params.get('role') || ''; source = params.get('source') || '';
        artifact = params.get('artifact') || ''; owner = params.get('owner') || '';
        full = params.get('full') === '1';
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
      source = target.source; role = ''; artifact = target.id; owner = ''; full = true; needsLoad = true;
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
    syncExternalControls(); setExplorerMode(explorerMode);
    el('media-explorer-workspace').classList.remove('hidden');
    el('app-frame').classList.add('workspace-media-explorer-open');
    window.syncApplicationShellContext();
    window.syncShellLocationRoute();
    if (needsLoad || isExternal()) load(true);
    if (isExternal() && externalPath) externalMetadataStatus();
  }
  function close() {
    visible = false; serial++;
    stopExternalTimers();
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
      artifact = ''; owner = '';
      source = '';
      if (!['newest', 'oldest', 'name', 'rating'].includes(el('media-explorer-sort').value)) {
        el('media-explorer-sort').value = 'newest';
      }
      stopExternalTimers(); externalJobRunning = false;

      syncExternalControls();
      Array.prototype.forEach.call(document.querySelectorAll('.media-explorer-source'), function (node) {
        node.classList.toggle('active', node === button);
      });
      load(true);
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-media-source]'), function (button) {
    button.addEventListener('click', function () {
      source = button.dataset.mediaSource;
      stopExternalTimers(); externalJobRunning = false;

      if (isExternal()) {
        explorerMode = 'list'; externalDirectory = ''; externalFolders = [];
        facetIds.slice(1).forEach(function (id) { el('media-explorer-' + id).value = ''; });
        if (!['newest', 'oldest', 'name', 'path', 'type', 'size', 'resolution', 'megapixels', 'duration'].includes(el('media-explorer-sort').value)) el('media-explorer-sort').value = 'newest';
      } else if (!['newest', 'oldest', 'name', 'rating'].includes(el('media-explorer-sort').value)) el('media-explorer-sort').value = 'newest';
      setExplorerMode(explorerMode);
      syncExternalControls();
      artifact = ''; owner = '';
      role = '';
      Array.prototype.forEach.call(document.querySelectorAll('.media-explorer-source'), function (node) { node.classList.toggle('active', node === button); });
      load(true);
    });
  });
  document.querySelectorAll('[data-explorer-mode]').forEach(function (btn) { btn.addEventListener('click', function () { setExplorerMode(btn.dataset.explorerMode); }); });
  el('media-explorer-open-path').addEventListener('click', function () {
    var nextPath = el('media-explorer-external-path').value.trim();
    externalPath = nextPath; externalDirectory = ''; externalFolders = [];
    mediaFacts.clear();
    externalRevision = -1; externalPendingRefresh = false; externalOverview = ''; externalJobSummary = ''; externalJobRunning = false;
    stopExternalTimers(); selected.clear(); updateSelection();
    load(true, {refreshFilesystem:true});
  });
  el('media-explorer-external-path').addEventListener('keydown', function (e) { if (e.key === 'Enter') el('media-explorer-open-path').click(); });
  el('media-explorer-gallery-area').addEventListener('scroll', maybeLoadMore);
  el('media-explorer-preview-stage').parentElement.addEventListener('scroll', maybeLoadMore);
  el('media-explorer-copy-selected').addEventListener('click', function () {
    chooseExport('copy', items.filter(function (item) { return selected.has(item.id); }));
  });
  el('media-explorer-export-destination').addEventListener('change', browseDestinations);
  el('media-explorer-export-up').addEventListener('click', function () {
    var field = el('media-explorer-export-destination');
    field.value = field.value.trim().split('/').slice(0,-1).join('/'); browseDestinations();
  });
  el('media-explorer-export-cancel').addEventListener('click', function () { el('media-explorer-export-dialog').close(); });
  el('media-explorer-export-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var submit = el('media-explorer-export-submit');
    var payload = {
      path: externalPath, files: exportItems.map(function (item) { return item.relativePath; }),
      destination: el('media-explorer-export-destination').value.trim(),
      newSet: el('media-explorer-export-new-set').value.trim(),
      start: el('media-explorer-export-start').value, duration: el('media-explorer-export-duration').value
    };
    submit.disabled = true;
    text(el('media-explorer-export-status'), exportMode === 'clip' ? 'Exporting video clip…' : 'Copying media…');
    fetch('/fs/media_explorer/external/' + exportMode, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
    }).then(function (res) { return res.json().then(function (data) {
      if (!res.ok || !data.ok) throw Error(data.error || 'Export failed'); return data;
    }); }).then(function (data) {
      var count = data.copied ? data.copied.length + ' files copied' : 'Clip exported: ' + data.clip;
      text(el('media-explorer-export-status'), count + ' to ' + data.destination);
    }).catch(function (err) { text(el('media-explorer-export-status'), err.message); report(err); })
      .finally(function () { submit.disabled = false; });
  });
  el('media-explorer-up').addEventListener('click', function () { setExternalDirectory(externalDirectory.split('/').slice(0, -1).join('/')); });
  el('media-explorer-recursive').addEventListener('change', function () { renderExternalFolders(); load(true); });
  el('media-explorer-sort-reverse').addEventListener('click', function () {
    reverseSort = !reverseSort; el('media-explorer-sort-reverse').setAttribute('aria-pressed', String(reverseSort)); load(true);
  });
  var grip = el('media-explorer-resizer'), explorerWorkspace = el('media-explorer-workspace'), resizing = false;
  grip.addEventListener('pointerdown', function (e) { resizing = true; grip.classList.add('dragging'); grip.setPointerCapture(e.pointerId); });
  grip.addEventListener('pointermove', function (e) {
    if (!resizing) return;
    var rect = explorerWorkspace.querySelector('.media-explorer-main').getBoundingClientRect();
    explorerWorkspace.style.setProperty('--explorer-list-width', Math.max(220, Math.min(650, e.clientX - rect.left)) + 'px');
  });
  function endResize() { resizing = false; grip.classList.remove('dragging'); }
  grip.addEventListener('pointerup', endResize);
  grip.addEventListener('pointercancel', endResize);
  grip.addEventListener('lostpointercapture', endResize);
  grip.addEventListener('dblclick', function () { explorerWorkspace.style.setProperty('--explorer-list-width', '260px'); });
  grip.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault();
    var width = parseInt(explorerWorkspace.style.getPropertyValue('--explorer-list-width'), 10) || 260;
    explorerWorkspace.style.setProperty('--explorer-list-width', Math.max(220, Math.min(650, width + (e.key === 'ArrowRight' ? 20 : -20))) + 'px');
  });
  el('media-explorer-generate-metadata').addEventListener('click', function () { requestExternalMetadata('filtered'); });
  el('media-explorer-stop-metadata').addEventListener('click', function () {
    fetch('/fs/media_explorer/external/metadata/stop', {method:'POST'}).then(function (res) {
      if (!res.ok) throw Error('Could not stop metadata analysis');
      return res.json();
    }).then(function () { externalMetadataStatus(); }).catch(report);
  });
  ['min-side', 'min-mp', 'min-duration', 'max-duration'].forEach(function (name) { el('media-explorer-' + name).addEventListener('change', function () { load(true); }); });
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
      pane.setAttribute('role', 'group'); pane.setAttribute('aria-label', item.fileName);
      pane.appendChild(mediaElement(item, true));
      var label = document.createElement('span'); text(label, item.fileName); pane.appendChild(label);
      host.appendChild(pane);
    });
    text(el('media-explorer-compare-dialog').querySelector('strong'), (chosen.length > 2 ? 'Survey' : 'Compare') + ' · ' + chosen.length + ' selected');
    text(el('media-explorer-compare-hint'), chosen.some(function (item) { return item.mediaKind === 'video'; }) ? 'Original media · independent playback' : 'Original media · ← → move focus');
    el('media-explorer-compare-dialog').showModal();
  });
  el('media-explorer-compare-close').addEventListener('click', function () { el('media-explorer-compare-dialog').close(); });
  el('media-explorer-refresh').addEventListener('click', function () {
    if (isExternal()) { mediaFacts.clear(); externalRevision = -1; externalPendingRefresh = false; load(true, {refreshFilesystem:true}); }
    else load(true);
  });
  el('media-explorer-scan-all').addEventListener('click', function () { full = true; load(true); });
  el('media-explorer-more-btn').addEventListener('click', function () { load(externalPendingRefresh, externalPendingRefresh ? {} : undefined); });
  var debounce;
  el('media-explorer-search').addEventListener('input', function () {
    artifact = ''; owner = '';
    clearTimeout(debounce); debounce = setTimeout(function () { load(true); }, 250);
  });
  el('media-explorer-kind').addEventListener('change', function () { load(true); });
  el('media-explorer-storyboard-type').addEventListener('change', function () { load(true); });
  facetIds.slice(1).forEach(function (id) { el('media-explorer-' + id).addEventListener('change', function () { load(true); }); });
  el('media-explorer-sort').addEventListener('change', function () { if (!isExternal() && ['path', 'type', 'resolution', 'megapixels', 'duration'].includes(this.value)) this.value = 'newest'; load(true); });
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
    el('media-explorer-storyboard-type').value = '';
    if (isExternal()) {
      ['min-side', 'min-mp', 'min-duration', 'max-duration'].forEach(function (name) {
        el('media-explorer-' + name).value = '';
      });
      load(true);
    } else {
      sourceButtons.find(function (btn) { return btn.hasAttribute('data-media-role') && btn.dataset.mediaRole === ''; }).click();
    }
  });
  el('media-explorer-empty-action').addEventListener('click', function () {
    if (isExternal()) load(true, {refreshFilesystem:true});
    else if (el('media-explorer-status').dataset.state === 'error' && el('media-explorer-status').textContent) load(true);
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
        (explorerMode === 'grid' ? el('media-explorer-preview-stage').parentElement :
          el('media-explorer-gallery-area')).scrollTop = loupeReturn.scroll;
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
    if (owner) params.set('owner', owner);
    if (full) params.set('full', '1');
    if (el('media-explorer-search').value.trim()) params.set('q', el('media-explorer-search').value.trim());
    if (el('media-explorer-kind').value) params.set('kind', el('media-explorer-kind').value);
    facetIds.slice(1).forEach(function (id) { if (el('media-explorer-' + id).value) params.set(id === 'folder' ? 'mediaSet' : id, el('media-explorer-' + id).value); });
    if (el('media-explorer-sort').value !== 'newest') params.set('sort', el('media-explorer-sort').value);
  };
})();
