/* QA-only, opt-in set curation. No Focus Set or training queue mutation. */
(function () {
  'use strict';

  var session = {
    token: 0, phase: 'idle', folder: '', signature: '', rows: [], concepts: [],
    eligible: [], order: [], choices: new Set(), sizes: {}, preset: 'balanced',
    filter: 'selected', limit: 72, summary: '', jobId: '', error: '',
    status: '', missingSight: 0, ignored: 0
  };

  function normalize(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function addConcept(lookup, row, group, term, source) {
    group = normalize(group);
    term = normalize(term);
    if (!group || !term) return;
    var key = group.toLowerCase() + '\u001f' + term.toLowerCase();
    if (!lookup.has(key)) {
      lookup.set(key, {
        key: key, id: '', group: group, term: term,
        source: source, files: new Set(), example: ''
      });
    }
    var feature = lookup.get(key);
    feature.files.add(row.fileName);
    row.keys.add(key);
    if (!feature.example && source === 'tag') {
      feature.example = normalize(row.caption).slice(0, 110);
    }
  }

  function buildInventory(items) {
    var lookup = new Map();
    var rows = (items || []).map(function (raw) {
      var row = {
        fileName: String(raw.fileName || ''), caption: String(raw.caption || ''),
        analysis: raw.analysis || {}, keys: new Set(), ids: [], hash: ''
      };
      (raw.groupedTags || []).forEach(function (tag) {
        addConcept(lookup, row, tag.group, tag.term, 'tag');
      });
      var sight = row.analysis.visionSight;
      var inventory = sight && sight.inventory;
      if (inventory) {
        (inventory.things || []).forEach(function (thing) {
          addConcept(lookup, row, 'Sight · object', thing.name, 'sight');
          (thing.qualities || []).slice(0, 4).forEach(function (quality) {
            addConcept(lookup, row, 'Sight · detail', thing.name + ': ' + quality, 'sight');
          });
        });
        (inventory.details || []).slice(0, 12).forEach(function (detail) {
          addConcept(lookup, row, 'Sight · detail', detail, 'sight');
        });
        (inventory.viewpoint || []).slice(0, 2).forEach(function (view) {
          addConcept(lookup, row, 'Sight · viewpoint', view, 'sight');
        });
      }
      return row;
    });
    var all = Array.from(lookup.values()).sort(function (a, b) {
      return b.files.size - a.files.size || a.key.localeCompare(b.key);
    });
    // Retain frequent evidence and rare construction observations in a bounded
    // Director request; never send the entire caption corpus.
    var chosen = [];
    var seen = new Set();
    function append(feature) {
      if (chosen.length >= 120 || seen.has(feature.key)) return;
      seen.add(feature.key);
      chosen.push(feature);
    }
    all.slice(0, 72).forEach(append);
    all.filter(function (row) { return row.files.size <= 3; })
      .slice(0, 32).forEach(append);
    all.forEach(append);
    chosen.forEach(function (row, index) { row.id = 'c' + String(index + 1).padStart(3, '0'); });
    var byKey = new Map(chosen.map(function (feature) { return [feature.key, feature.id]; }));
    rows.forEach(function (row) {
      row.ids = Array.from(row.keys).map(function (key) { return byKey.get(key); }).filter(Boolean);
      delete row.keys;
    });
    return {
      rows: rows,
      concepts: chosen.map(function (row) {
        return {
          id: row.id, group: row.group, term: row.term,
          count: row.files.size, source: row.source,
          example: chosen.indexOf(row) < 22 ? row.example : ''
        };
      }),
      ignored: Math.max(0, all.length - chosen.length)
    };
  }

  function strength(count, role) {
    return 1 - Math.exp(-count / (role === 'core' ? 3 : 2));
  }

  function deriveEligible(concepts, analysis, rows) {
    var core = new Set(analysis.coreIds);
    var supporting = new Set(analysis.supportingIds);
    var available = new Map(concepts.map(function (row) { return [row.id, row]; }));
    var selected = new Map();
    core.forEach(function (id) {
      var row = available.get(id);
      if (!row) throw new Error('Curation result references unknown core concept: ' + id);
      selected.set(id, { id: id, label: row.term, group: row.group, role: 'core',
        count: row.count, weight: row.source === 'sight' ? 0.62 : 1 });
    });
    supporting.forEach(function (id) {
      if (selected.has(id)) throw new Error('Curation classified a concept twice: ' + id);
      var row = available.get(id);
      if (!row) throw new Error('Curation result references unknown supporting concept: ' + id);
      selected.set(id, { id: id, label: row.term, group: row.group, role: 'supporting',
        count: row.count, weight: row.source === 'sight' ? 0.13 : 0.28 });
    });
    if (!core.size) throw new Error('Director found no core visual concepts.');
    rows.forEach(function (row) {
      row.ids = row.ids.filter(function (id) { return selected.has(id); });
    });
    return Array.from(selected.values());
  }

  function coverage(rows, concepts, selectedFiles) {
    var byId = new Map(concepts.map(function (c) { return [c.id, 0]; }));
    rows.forEach(function (row) {
      if (!selectedFiles.has(row.fileName)) return;
      row.ids.forEach(function (id) { byId.set(id, byId.get(id) + 1); });
    });
    var obtained = 0, available = 0, represented = 0;
    concepts.forEach(function (c) {
      var n = byId.get(c.id) || 0;
      if (n > 0) represented += 1;
      obtained += c.weight * strength(n, c.role);
      available += c.weight * strength(c.count, c.role);
    });
    return { ratio: available ? obtained / available : 0, represented: represented,
      total: concepts.length };
  }

  function score(row, concepts, byId, selected) {
    var delta = 0;
    row.ids.forEach(function (id) {
      var c = byId.get(id);
      var n = selected.get(id) || 0;
      delta += c.weight * (strength(n + 1, c.role) - strength(n, c.role));
    });
    var complexity = Number(row.analysis.sceneComplexity && row.analysis.sceneComplexity.score);
    var quality = Number.isFinite(complexity) && row.analysis.sceneComplexity
      ? 1 - Math.min(0.14, Math.max(0, complexity) * 0.14) : 1;
    return delta * quality;
  }

  function rank(rows, concepts) {
    var byId = new Map(concepts.map(function (feature) { return [feature.id, feature]; }));
    var counts = new Map(concepts.map(function (feature) { return [feature.id, 0]; }));
    var remaining = rows.slice(), ordered = [], gains = [];
    while (remaining.length) {
      var best = -1, bestScore = -Infinity;
      for (var i = 0; i < remaining.length; i += 1) {
        var value = score(remaining[i], concepts, byId, counts);
        if (value > bestScore) { bestScore = value; best = i; }
      }
      var chosen = remaining.splice(best, 1)[0];
      ordered.push(chosen.fileName);
      gains.push(bestScore);
      chosen.ids.forEach(function (id) { counts.set(id, counts.get(id) + 1); });
    }
    var selected = new Set(), levels = [], ratios = [];
    ordered.forEach(function (file) {
      selected.add(file);
      ratios.push(coverage(rows, concepts, selected).ratio);
    });
    var first = gains.slice(0, Math.min(6, gains.length));
    var baseline = first.reduce(function (sum, value) { return sum + value; }, 0) / first.length;
    function bend(target, fraction) {
      for (var i = 0; i < gains.length; i += 1) {
        if (i < Math.min(7, gains.length - 1) || ratios[i] < target) continue;
        var tail = gains.slice(Math.max(0, i - 4), i + 1);
        var current = tail.reduce(function (sum, n) { return sum + n; }, 0) / tail.length;
        if (current <= baseline * fraction) return i + 1;
      }
      return gains.length;
    }
    return { order: ordered, gains: gains, ratios: ratios,
      sizes: {lean: bend(0.83, 0.14), balanced: bend(0.91, 0.085),
        broad: bend(0.97, 0.045)} };
  }

  function clearNode(el) { el.replaceChildren(); }
  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function button(label, click, className) {
    var node = element('button', className || 'review-captions-btn', label);
    node.type = 'button';
    node.onclick = click;
    return node;
  }
  function currentSelection() {
    return new Set(session.choices);
  }
  function selectedCount() { return session.choices.size; }
  function updateStats(root) {
    var selected = currentSelection();
    var metric = coverage(session.rows, session.eligible, selected);
    var number = root.querySelector('[data-curation-selected]');
    var completeness = root.querySelector('[data-curation-coverage]');
    var variations = root.querySelector('[data-curation-variations]');
    var bar = root.querySelector('[data-curation-bar]');
    var exportButton = root.querySelector('[data-curation-create]');
    if (number) number.textContent = String(selectedCount());
    if (completeness) completeness.textContent = Math.round(metric.ratio * 100) + '%';
    if (variations) variations.textContent = metric.represented + ' / ' + metric.total;
    if (bar) { bar.value = Math.round(metric.ratio * 100); }
    if (exportButton) {
      exportButton.disabled = !selectedCount();
      exportButton.textContent = 'Create Set · ' + selectedCount() + ' images';
    }
  }

  function showProposal(host) {
    var title = element('h2', 'qa-curation-heading', 'Your training shortlist');
    host.appendChild(title);
    var counters = element('div', 'qa-curation-metrics');
    [
      ['Selected', 'selected'], ['Evidence coverage', 'coverage'], ['Represented concepts', 'variations']
    ].forEach(function (entry) {
      var tile = element('div', 'qa-curation-metric');
      tile.appendChild(element('strong', '', '0')).setAttribute('data-curation-' + entry[1], '');
      tile.appendChild(element('span', '', entry[0]));
      counters.appendChild(tile);
    });
    host.appendChild(counters);
    var progress = element('progress', 'qa-curation-progress');
    progress.max = 100;
    progress.value = 0;
    progress.setAttribute('data-curation-bar', '');
    progress.setAttribute('aria-label', 'Weighted concept evidence represented');
    host.appendChild(progress);
    host.appendChild(element('p', 'qa-curation-helper',
      'Coverage is measured against available annotated evidence, not predicted LoRA accuracy.'));
    host.appendChild(element('p', 'qa-curation-summary', session.summary));
    if (session.ignored) host.appendChild(element('p', 'qa-curation-helper',
      session.ignored + ' uncommon or redundant labels fell outside the Director inventory; they were not scored.'));
    if (session.missingSight) host.appendChild(element('p', 'qa-curation-helper',
      session.missingSight + ' images have no cached Sight; saved tags still contribute.'));

    var presets = element('div', 'qa-curation-controls');
    ['lean', 'balanced', 'broad'].forEach(function (name) {
      var active = session.preset === name;
      var control = button(name[0].toUpperCase() + name.slice(1) + ' · ' + session.sizes[name],
        function () {
          session.preset = name;
          session.choices = new Set(session.order.slice(0, session.sizes[name]));
          renderQaCuration(host, session.signature);
        }, 'review-captions-btn' + (active ? ' qa-curation-active' : ''));
      control.setAttribute('aria-pressed', active ? 'true' : 'false');
      presets.appendChild(control);
    });
    host.appendChild(presets);

    var controls = element('div', 'qa-curation-controls');
    ['selected', 'all'].forEach(function (filter) {
      var ctl = button(filter === 'selected' ? 'Selected' : 'All images',
        function () { session.filter = filter; session.limit = 72; renderQaCuration(host, session.signature); },
        'review-captions-btn' + (session.filter === filter ? ' qa-curation-active' : ''));
      ctl.setAttribute('aria-pressed', session.filter === filter ? 'true' : 'false');
      controls.appendChild(ctl);
    });
    host.appendChild(controls);

    var images = session.filter === 'selected'
      ? session.order.filter(function (file) { return session.choices.has(file); })
      : session.order;
    var grid = element('div', 'qa-curation-grid');
    var byFile = new Map(session.rows.map(function (row) { return [row.fileName, row]; }));
    images.slice(0, session.limit).forEach(function (fileName) {
      var row = byFile.get(fileName), checked = session.choices.has(fileName);
      var card = element('label', 'qa-curation-card' + (checked ? ' is-selected' : ''));
      var source = mediaGridMediaUrl({fileName: fileName, key: fileName});
      if (isPreviewVideoFileName(fileName)) {
        var video = element('video', 'qa-curation-thumb');
        video.src = source;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        card.appendChild(video);
      } else {
        var image = element('img', 'qa-curation-thumb');
        image.src = source;
        image.loading = 'lazy';
        image.alt = fileName;
        card.appendChild(image);
      }
      var foot = element('div', 'qa-curation-tile-foot');
      var input = element('input');
      input.type = 'checkbox';
      input.checked = checked;
      input.setAttribute('aria-label', 'Include ' + fileName);
      input.onchange = function () {
        if (input.checked) session.choices.add(fileName);
        else session.choices.delete(fileName);
        session.preset = 'custom';
        card.classList.toggle('is-selected', input.checked);
        updateStats(host);
        if (session.filter === 'selected' && !input.checked) {
          card.remove();
        }
      };
      foot.appendChild(input);
      foot.appendChild(element('span', 'qa-curation-filename', fileName));
      card.appendChild(foot);
      grid.appendChild(card);
    });
    host.appendChild(grid);
    if (images.length > session.limit) {
      host.appendChild(button('Show more · ' + (images.length - session.limit) + ' remaining',
        function () { session.limit += 72; renderQaCuration(host, session.signature); }));
    }
    var actions = element('div', 'qa-curation-actions');
    var create = button('Create Set · ' + selectedCount() + ' images', function () {
      var chosen = session.order.filter(function (file) { return session.choices.has(file); });
      if (!chosen.length) throw new Error('Select at least one image before creating a Set.');
      if (String(state.folder || '') !== session.folder ||
          qaCurrentCurationSignature() !== session.signature) {
        throw new Error('QA Curation inputs changed; analyze the current selection again.');
      }
      runCreateSetFromResultsFlow(chosen.map(function (file) {
        return {source_media_rel: buildSourceMediaRelPath(file)};
      }));
    }, 'review-captions-btn qa-curation-primary');
    create.setAttribute('data-curation-create', '');
    actions.appendChild(create);
    host.appendChild(actions);
    updateStats(host);
  }

  function renderQaCuration(host, signature) {
    if (!host) throw new Error('QA curation requires the QA workbench root.');
    clearNode(host);
    var header = element('div', 'qa-curation-header');
    header.appendChild(button('← Quality Assurance', function () {
      if (session.phase === 'analyzing') stopQaCuration();
      window.qaShowOverviewFromCuration();
    }));
    header.appendChild(element('span', '', 'Training Set Curation'));
    host.appendChild(header);
    if (session.signature !== signature || qaCurrentCurationSignature() !== session.signature ||
        String(state.folder || '') !== session.folder) {
      host.appendChild(element('p', 'qa-curation-status', 'The training selection changed. Return to QA and analyze it again.'));
      return;
    }
    if (session.phase !== 'ready') {
      host.appendChild(element('h2', 'qa-curation-heading',
        session.phase === 'failed' ? 'Curation failed' : 'Finding the useful variation'));
      host.appendChild(element('p', 'qa-curation-status', session.error || session.status));
      if (session.phase === 'analyzing') {
        var loading = element('progress', 'qa-curation-progress');
        loading.removeAttribute('value');
        host.appendChild(loading);
        host.appendChild(button('Stop analysis', stopQaCuration));
      } else if (session.phase === 'failed') {
        host.appendChild(button('Try again', function () { startQaCuration(session.input, session.focus, session.signature); }));
      }
      return;
    }
    showProposal(host);
  }

  function renderCurrent() {
    var host = document.getElementById('qa-workbench');
    if (host) renderQaCuration(host, qaCurrentCurationSignature());
  }

  function request(url, payload) {
    return fetch(url, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    }).then(function (response) {
      return response.json().then(function (result) {
        if (!response.ok || result.ok !== true) throw new Error(result.error || 'QA curation request failed.');
        return result;
      });
    });
  }

  function poll(jobId, token) {
    if (token !== session.token) return Promise.resolve(null);
    return fetch('/fs/director/job?job=' + encodeURIComponent(jobId) + '&consume=1').then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'Director polling failed.');
        return payload.job;
      });
    }).then(function (job) {
      if (token !== session.token) return null;
      if (job.status === 'completed') return job;
      if (['failed', 'cancelled', 'stopped', 'interrupted'].includes(job.status)) {
        throw new Error(job.error || ('Director ' + job.status));
      }
      session.status = job.status === 'queued' ? 'Director queued · waiting for available runtime'
        : 'Director interpreting training concepts…';
      renderCurrent();
      return new Promise(function (resolve) { setTimeout(resolve, 1800); })
        .then(function () { return poll(jobId, token); });
    });
  }

  function stopQaCuration() {
    session.token += 1;
    var jobId = session.jobId;
    session.jobId = '';
    session.phase = 'stopped';
    session.status = 'Analysis stopped.';
    if (jobId) request('/fs/director/job', {operation:'cancel_job',jobId:jobId})
      .catch(function (err) { window.reportConsoleError('QA Curation · Stop Director', err); });
    renderCurrent();
  }

  function startQaCuration(items, focus, signature) {
    var token = ++session.token;
    var inventory = buildInventory(items);
    if (!inventory.concepts.length) {
      throw new Error('QA Curation needs grouped annotations or saved visual Sight.');
    }
    var model = String(getDirectorModelPreference() || '').trim();
    if (!model) throw new Error('Choose a Director model for QA Curation.');
    session.input = items;
    session.focus = String(focus || '');
    session.folder = String(state.folder || '');
    session.signature = signature;
    session.phase = 'analyzing';
    session.rows = inventory.rows;
    session.concepts = inventory.concepts;
    session.ignored = inventory.ignored;
    session.missingSight = inventory.rows.filter(function (row) {return !row.analysis.visionSight;}).length;
    session.status = 'Step 1/3 · Indexed ' + items.length + ' images into ' + inventory.concepts.length + ' candidate concepts.';
    session.error = '';
    session.jobId = '';
    window.qaShowCuration();
    renderCurrent();
    session.status = 'Step 2/3 · Asking Director what matters for training…';
    renderCurrent();
    request('/fs/qa/curate', {
      folder: session.folder,
      files: items.map(function (item) {return item.fileName;}),
      trainingFocus: session.focus,
      concepts: session.concepts,
      model: model
    }).then(function (result) {
      if (token !== session.token) return null;
      session.jobId = result.job.jobId;
      return poll(session.jobId, token);
    }).then(function (job) {
      if (!job || token !== session.token) return;
      if (String(state.folder || '') !== session.folder ||
          qaCurrentCurationSignature() !== session.signature) {
        throw new Error('QA Curation inputs changed while Director was running.');
      }
      var result = job.result && job.result.analysis;
      if (!result || !Array.isArray(result.coreIds) || !Array.isArray(result.supportingIds))
        throw new Error('Director did not return a validated concept priority analysis.');
      session.status = 'Step 3/3 · Choosing complementary images…';
      renderCurrent();
      session.eligible = deriveEligible(session.concepts, result, session.rows);
      var ranked = rank(session.rows, session.eligible);
      session.order = ranked.order;
      session.sizes = ranked.sizes;
      session.choices = new Set(session.order.slice(0, session.sizes.balanced));
      session.preset = 'balanced';
      session.filter = 'selected';
      session.summary = String(result.summary || 'A curated mix of key constructions and supporting variation.');
      session.phase = 'ready';
      session.jobId = '';
      renderCurrent();
    }).catch(function (err) {
      if (token !== session.token) return;
      session.phase = 'failed';
      session.error = String(err && err.message || err);
      window.reportConsoleError('QA Curation', err);
      renderCurrent();
    });
  }

  window.startQaCuration = startQaCuration;
  window.renderQaCuration = renderQaCuration;
  window.stopQaCuration = stopQaCuration;
  window.qaCurationCoverage = coverage;
  window.qaCurationInventory = buildInventory;
  window.qaCurationRank = rank;
})();
