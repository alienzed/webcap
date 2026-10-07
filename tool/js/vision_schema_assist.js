(function () {
  'use strict';

  var schemaState = {
    open: false,
    folder: '',
    visionModel: '',
    scanRunning: false,
    scanStopRequested: false,
    currentVisionJobId: '',
    schemaJobId: '',
    statusPayload: null,
    analysis: null,
    schema: null,
    error: ''
  };

  function el(id) { return document.getElementById(id); }

  function requestJson(url, options) {
    return fetch(url, options || {}).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.ok === false) {
          throw new Error((payload && payload.error) || 'Schema Assist request failed.');
        }
        return payload;
      });
    });
  }

  function currentFolder() {
    return String(state && state.folder || '');
  }

  function currentVisionModel() {
    return String(getCaptionVisionModelId() || '').trim();
  }

  function currentDirectorModel() {
    return String(getDirectorModelPreference() || '').trim();
  }

  function findMediaItem(fileName) {
    var items = state && Array.isArray(state.items) ? state.items : [];
    for (var i = 0; i < items.length; i += 1) {
      if (items[i] && String(items[i].fileName || '') === String(fileName || '')) return items[i];
    }
    return { key: String(fileName || ''), fileName: String(fileName || '') };
  }

  function existingGroupsPayload() {
    return (Array.isArray(checklistItems) ? checklistItems : []).map(function (group) {
      return {
        group: String(group || ''),
        terms: getChecklistKeywordTermsForRequirement(group)
      };
    }).filter(function (row) { return !!row.group; });
  }

  function schemaStatusUrl(folder, model) {
    return '/fs/vision_schema?folder=' + encodeURIComponent(folder) + '&model=' + encodeURIComponent(model);
  }

  function setStatus(message, error) {
    schemaState.error = error ? String(message || '') : '';
    var node = el('vision-schema-status');
    if (!node) throw new Error('Schema Assist status control is missing.');
    node.textContent = String(message || '');
    node.classList.toggle('is-error', !!error);
  }

  function refreshStatus() {
    var folder = schemaState.folder;
    var model = schemaState.visionModel;
    return requestJson(schemaStatusUrl(folder, model)).then(function (payload) {
      if (!schemaState.open || folder !== schemaState.folder || model !== schemaState.visionModel) return null;
      schemaState.statusPayload = payload;
      render();
      return payload;
    });
  }

  function renderEvidence() {
    var host = el('vision-schema-evidence');
    if (!host) throw new Error('Schema Assist evidence host is missing.');
    host.innerHTML = '';
    var patterns = schemaState.analysis && Array.isArray(schemaState.analysis.patterns)
      ? schemaState.analysis.patterns
      : [];
    if (!patterns.length) {
      var empty = document.createElement('div');
      empty.className = 'vision-schema-empty';
      empty.textContent = schemaState.statusPayload && schemaState.statusPayload.cached
        ? 'Run Build Suggestions to organize the available Sight evidence.'
        : 'Run a Sight scan to discover recurring visual patterns.';
      host.appendChild(empty);
      return;
    }
    patterns.slice(0, 80).forEach(function (pattern) {
      var row = document.createElement('div');
      row.className = 'vision-schema-pattern';
      var label = document.createElement('strong');
      label.textContent = String(pattern.label || '');
      var count = document.createElement('span');
      count.textContent = String(pattern.count || 0) + ' items';
      var examples = document.createElement('small');
      examples.textContent = (pattern.examples || []).slice(0, 4).join(' · ');
      row.appendChild(label);
      row.appendChild(count);
      row.appendChild(examples);
      host.appendChild(row);
    });
  }

  function createTargetSelect(group) {
    var select = document.createElement('select');
    select.className = 'vision-schema-group-target';
    var create = document.createElement('option');
    create.value = '';
    create.textContent = 'Create new group';
    select.appendChild(create);
    existingGroupsPayload().forEach(function (existing) {
      var option = document.createElement('option');
      option.value = existing.group;
      option.textContent = 'Merge into ' + existing.group;
      select.appendChild(option);
    });
    select.value = String(group.targetGroup || '');
    return select;
  }

  function renderProposals() {
    var host = el('vision-schema-proposals');
    if (!host) throw new Error('Schema Assist proposal host is missing.');
    host.innerHTML = '';
    var groups = schemaState.schema && Array.isArray(schemaState.schema.groups)
      ? schemaState.schema.groups
      : [];
    if (!groups.length) {
      var empty = document.createElement('div');
      empty.className = 'vision-schema-empty';
      empty.textContent = schemaState.schema ? 'The Director did not find useful vocabulary to add.' : 'Schema suggestions will appear here.';
      host.appendChild(empty);
      return;
    }

    groups.forEach(function (group, groupIndex) {
      var card = document.createElement('div');
      card.className = 'vision-schema-group-card';
      card.dataset.groupIndex = String(groupIndex);

      var top = document.createElement('div');
      top.className = 'vision-schema-group-top';
      var name = document.createElement('input');
      name.type = 'text';
      name.className = 'vision-schema-group-name';
      name.value = String(group.name || '');
      name.title = 'Group name used when creating a new group';
      var target = createTargetSelect(group);
      top.appendChild(name);
      top.appendChild(target);
      card.appendChild(top);

      if (group.rationale) {
        var rationale = document.createElement('div');
        rationale.className = 'vision-schema-group-rationale';
        rationale.textContent = String(group.rationale || '');
        card.appendChild(rationale);
      }

      (group.terms || []).forEach(function (term, termIndex) {
        var row = document.createElement('div');
        row.className = 'vision-schema-term-row' + (term.alreadyExists ? ' vision-schema-existing' : '');
        row.dataset.termIndex = String(termIndex);

        var check = document.createElement('input');
        check.type = 'checkbox';
        check.className = 'vision-schema-term-check';
        check.checked = !term.alreadyExists;
        check.disabled = !!term.alreadyExists;
        check.title = term.alreadyExists ? 'Already present in this group' : 'Merge this term';

        var termName = document.createElement('input');
        termName.type = 'text';
        termName.className = 'vision-schema-term-name';
        termName.value = String(term.term || '');
        termName.disabled = !!term.alreadyExists;

        var support = document.createElement('span');
        support.className = 'vision-schema-term-support';
        support.textContent = term.alreadyExists
          ? 'already present'
          : String(term.support || 0) + ' supporting items';

        row.appendChild(check);
        row.appendChild(termName);
        row.appendChild(support);

        var evidence = document.createElement('div');
        evidence.className = 'vision-schema-term-evidence';
        (term.evidence || []).slice(0, 4).forEach(function (value) {
          var chip = document.createElement('span');
          chip.className = 'vision-schema-evidence-chip';
          chip.textContent = String(value || '');
          evidence.appendChild(chip);
        });
        (term.examples || []).slice(0, 3).forEach(function (value) {
          var chip = document.createElement('span');
          chip.className = 'vision-schema-example-chip';
          chip.textContent = String(value || '');
          evidence.appendChild(chip);
        });
        row.appendChild(evidence);
        card.appendChild(row);
      });
      host.appendChild(card);
    });
  }

  function renderProgress() {
    var payload = schemaState.statusPayload || {};
    var total = Number(payload.total || 0);
    var cached = Number(payload.cached || 0);
    var percent = total > 0 ? Math.max(0, Math.min(100, cached / total * 100)) : 0;
    var fill = el('vision-schema-progress-fill');
    var text = el('vision-schema-progress-text');
    if (!fill || !text) throw new Error('Schema Assist progress controls are missing.');
    fill.style.width = percent.toFixed(1) + '%';
    text.textContent = total
      ? (String(cached) + ' / ' + String(total) + ' media have current Sight for ' + (schemaState.visionModel || 'the selected Vision model'))
      : 'No supported media in this Set.';
  }

  function render() {
    var modal = el('vision-schema-modal');
    var scanBtn = el('vision-schema-scan-btn');
    var stopBtn = el('vision-schema-stop-btn');
    var suggestBtn = el('vision-schema-suggest-btn');
    var applyBtn = el('vision-schema-apply-btn');
    if (!modal || !scanBtn || !stopBtn || !suggestBtn || !applyBtn) {
      throw new Error('Schema Assist UI is incomplete.');
    }
    modal.classList.toggle('hidden', !schemaState.open);
    scanBtn.disabled = schemaState.scanRunning || !!schemaState.schemaJobId;
    scanBtn.textContent = schemaState.statusPayload && Number(schemaState.statusPayload.cached || 0)
      ? 'Resume / Refresh Sight'
      : 'Scan Set';
    stopBtn.classList.toggle('hidden', !schemaState.scanRunning && !schemaState.schemaJobId);
    suggestBtn.disabled = schemaState.scanRunning || !!schemaState.schemaJobId || !(schemaState.statusPayload && Number(schemaState.statusPayload.cached || 0) >= 2);
    applyBtn.disabled = schemaState.scanRunning || !!schemaState.schemaJobId || !(schemaState.schema && schemaState.schema.groups && schemaState.schema.groups.length);
    renderProgress();
    renderEvidence();
    renderProposals();
  }

  function saveSight(folder, model, media, description) {
    return requestJson('/fs/vision_schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'save_sight',
        folder: folder,
        visionModel: model,
        media: media,
        description: description
      })
    });
  }

  function scanNext(pending, index, folder, model) {
    if (schemaState.scanStopRequested || !schemaState.open) return Promise.resolve(false);
    if (currentFolder() !== folder) throw new Error('Set changed while Vision scan was running.');
    if (index >= pending.length) return Promise.resolve(true);

    var fileName = pending[index];
    var mediaItem = findMediaItem(fileName);
    setStatus('Vision sight · ' + String(index + 1) + ' / ' + String(pending.length) + ' remaining');
    return requestVisionImageCaptionDescription(mediaItem, {
      model: model,
      onJob: function (job) {
        schemaState.currentVisionJobId = String(job.jobId || '');
        return null;
      }
    }).then(function (result) {
      schemaState.currentVisionJobId = '';
      if (schemaState.scanStopRequested) return false;
      return saveSight(folder, model, fileName, result.text);
    }).then(function (saved) {
      if (saved === false) return false;
      return refreshStatus();
    }).then(function () {
      if (schemaState.scanStopRequested) return false;
      return scanNext(pending, index + 1, folder, model);
    });
  }

  function runScan() {
    if (schemaState.scanRunning || schemaState.schemaJobId) return;
    var folder = currentFolder();
    var model = currentVisionModel();
    if (!folder) {
      setStatus('Open a Set before scanning.', true);
      return;
    }
    if (!model) {
      setStatus('Select a Vision model first.', true);
      return;
    }

    schemaState.folder = folder;
    schemaState.visionModel = model;
    schemaState.scanRunning = true;
    schemaState.scanStopRequested = false;
    schemaState.schema = null;
    schemaState.analysis = null;
    render();
    setStatus('Checking cached Vision sight…');

    refreshStatus().then(function (payload) {
      var pending = (payload.items || []).filter(function (item) {
        return !item.cached;
      }).map(function (item) {
        return item.file;
      });
      if (!pending.length) return true;
      return scanNext(pending, 0, folder, model);
    }).then(function () {
      if (schemaState.scanStopRequested) {
        setStatus('Sight scan stopped. Completed items are cached.');
        return null;
      }
      return analyze();
    }).then(function () {
      if (!schemaState.scanStopRequested) setStatus('Sight scan complete. Review recurring evidence or build suggestions.');
    }).catch(function (err) {
      if (schemaState.scanStopRequested) {
        setStatus('Sight scan stopped. Completed items are cached.');
      } else {
        setStatus('Sight scan failed: ' + String(err && err.message ? err.message : err), true);
        reportConsoleError('Schema Assist', err);
      }
    }).then(function () {
      schemaState.scanRunning = false;
      schemaState.currentVisionJobId = '';
      render();
    });
  }

  function stopWork() {
    schemaState.scanStopRequested = true;
    var jobs = [];
    if (schemaState.currentVisionJobId) jobs.push(cancelCaptionAssistJob(schemaState.currentVisionJobId));
    if (schemaState.schemaJobId) jobs.push(cancelCaptionAssistJob(schemaState.schemaJobId));
    schemaState.currentVisionJobId = '';
    schemaState.schemaJobId = '';
    setStatus('Stopping…');
    Promise.all(jobs).catch(function (err) {
      reportConsoleError('Schema Assist', err);
    }).then(render);
  }

  function analyze() {
    return requestJson('/fs/vision_schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'analyze',
        folder: schemaState.folder,
        visionModel: schemaState.visionModel
      })
    }).then(function (payload) {
      schemaState.analysis = payload.analysis || null;
      render();
      return schemaState.analysis;
    });
  }

  function runSuggestions() {
    if (schemaState.scanRunning || schemaState.schemaJobId) return;
    var director = currentDirectorModel();
    if (!director) {
      setStatus('Select a Director model first.', true);
      return;
    }
    var folder = schemaState.folder;
    var visionModel = schemaState.visionModel;
    var groups = existingGroupsPayload();
    schemaState.schema = null;
    setStatus('Schema Assist organizing recurring visual evidence…');
    render();

    requestJson('/fs/vision_schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'synthesize',
        folder: folder,
        visionModel: visionModel,
        directorModel: director,
        existingGroups: groups
      })
    }).then(function (payload) {
      schemaState.analysis = payload.analysis || schemaState.analysis;
      schemaState.schemaJobId = String(payload.job && payload.job.jobId || '');
      if (!schemaState.schemaJobId) throw new Error('Schema Assist did not return a queued job.');
      render();
      return waitForCaptionAssistJob(payload.job);
    }).then(function (job) {
      schemaState.schemaJobId = '';
      if (!schemaState.open || folder !== schemaState.folder || visionModel !== schemaState.visionModel) return;
      var result = job.result && job.result.schema;
      if (!result || !Array.isArray(result.groups)) throw new Error('Schema Assist completed without structured suggestions.');
      schemaState.schema = result;
      setStatus(result.groups.length
        ? ('Schema Assist proposed ' + String(result.groups.length) + ' group' + (result.groups.length === 1 ? '' : 's') + '.')
        : 'Schema Assist found no useful vocabulary to add.');
      render();
    }).catch(function (err) {
      schemaState.schemaJobId = '';
      if (schemaState.scanStopRequested) {
        setStatus('Schema Assist stopped.');
      } else {
        setStatus('Schema Assist failed: ' + String(err && err.message ? err.message : err), true);
        reportConsoleError('Schema Assist', err);
      }
      render();
    });
  }

  function selectedProposalMutations() {
    var mutations = [];
    var cards = el('vision-schema-proposals').querySelectorAll('.vision-schema-group-card');
    Array.prototype.forEach.call(cards, function (card) {
      var target = card.querySelector('.vision-schema-group-target');
      var groupName = card.querySelector('.vision-schema-group-name');
      var selectedGroup = String(target && target.value || '').trim();
      var newName = String(groupName && groupName.value || '').trim();
      var terms = [];
      Array.prototype.forEach.call(card.querySelectorAll('.vision-schema-term-row'), function (row) {
        var check = row.querySelector('.vision-schema-term-check');
        var input = row.querySelector('.vision-schema-term-name');
        if (!check || check.disabled || !check.checked) return;
        var term = String(input && input.value || '').trim();
        if (term && terms.indexOf(term) === -1) terms.push(term);
      });
      if (!terms.length) return;
      mutations.push({
        group: selectedGroup || newName,
        create: !selectedGroup,
        terms: terms
      });
    });
    return mutations;
  }

  function applySelected() {
    var mutations = selectedProposalMutations();
    if (!mutations.length) {
      setStatus('Select at least one proposed term to merge.', true);
      return;
    }
    var addedGroups = 0;
    var addedTerms = 0;
    mutations.forEach(function (mutation) {
      var group = String(mutation.group || '').trim();
      if (!group) return;
      if (mutation.create && addChecklistGroup(group)) addedGroups += 1;
      addedTerms += mergeChecklistKeywordTermsForRequirement(group, mutation.terms).length;
    });
    setStatus(
      'Merged ' + String(addedTerms) + ' term' + (addedTerms === 1 ? '' : 's') +
      (addedGroups ? (' across ' + String(addedGroups) + ' new group' + (addedGroups === 1 ? '' : 's')) : '') + '.'
    );
    schemaState.schema = null;
    render();
  }

  function open() {
    var folder = currentFolder();
    var model = currentVisionModel();
    if (!folder) {
      setStatus('Open a Set before discovering vocabulary.', true);
      return;
    }
    if (!model) {
      setStatus('Select a Vision model first.', true);
      return;
    }
    schemaState.open = true;
    schemaState.folder = folder;
    schemaState.visionModel = model;
    schemaState.scanStopRequested = false;
    schemaState.schema = null;
    schemaState.analysis = null;
    render();
    setStatus('Loading current Sight coverage…');
    refreshStatus().then(function () {
      if (schemaState.statusPayload && schemaState.statusPayload.cached) return analyze();
      return null;
    }).catch(function (err) {
      setStatus('Could not load Schema Assist: ' + String(err && err.message ? err.message : err), true);
      reportConsoleError('Schema Assist', err);
    });
  }

  function close() {
    if (schemaState.scanRunning || schemaState.schemaJobId) stopWork();
    schemaState.open = false;
    render();
  }

  function bind() {
    var openBtn = el('vision-schema-open-btn');
    var closeBtn = el('vision-schema-close-btn');
    var scanBtn = el('vision-schema-scan-btn');
    var stopBtn = el('vision-schema-stop-btn');
    var suggestBtn = el('vision-schema-suggest-btn');
    var applyBtn = el('vision-schema-apply-btn');
    var modal = el('vision-schema-modal');
    if (!openBtn || !closeBtn || !scanBtn || !stopBtn || !suggestBtn || !applyBtn || !modal) {
      throw new Error('Schema Assist controls are missing.');
    }
    openBtn.onclick = open;
    closeBtn.onclick = close;
    scanBtn.onclick = runScan;
    stopBtn.onclick = stopWork;
    suggestBtn.onclick = runSuggestions;
    applyBtn.onclick = applySelected;
    modal.addEventListener('click', function (event) {
      if (event.target === modal) close();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && schemaState.open) {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
    }, true);
  }

  window.openVisionSchemaAssist = open;
  bind();
})();
