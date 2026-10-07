(function () {
  'use strict';

  var schemaState = {
    open: false,
    folder: '',
    visionModel: '',
    scanRunning: false,
    scanStopRequested: false,
    currentVisionJobId: '',
    schemaStarting: false,
    schemaJobId: '',
    schemaRequestToken: 0,
    statusPayload: null,
    analysis: null,
    schema: null,
    tagCandidates: null,
    mode: 'vocabulary',
    scopeFiles: [],
    guidedLaunch: false,
    rawResponses: [],
    guidedPass: null,
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
    return null;
  }

  function existingGroupsPayload() {
    return (Array.isArray(checklistItems) ? checklistItems : []).map(function (group) {
      return {
        group: String(group || ''),
        terms: getChecklistKeywordTermsForRequirement(group)
      };
    }).filter(function (row) { return !!row.group; });
  }


  function currentAssignmentsPayload(files) {
    var out = {};
    (files || []).forEach(function (fileName) {
      var item = findMediaItem(fileName);
      var entries = item && item.key ? getChecklistAssignmentEntriesForMediaKey(item.key) : [];
      out[String(fileName || '')] = entries.map(function (entry) {
        return {
          group: String(entry && entry.requirement || ''),
          term: String(entry && entry.term || '')
        };
      }).filter(function (entry) { return entry.group && entry.term; });
    });
    return out;
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

  function renderRawResponses() {
    var wrap = el('vision-schema-raw');
    var output = el('vision-schema-raw-output');
    if (!wrap || !output) throw new Error('Vision raw response controls are missing.');
    wrap.classList.toggle('hidden', !schemaState.guidedLaunch);
    if (!schemaState.guidedLaunch) {
      output.textContent = '';
      return;
    }
    output.textContent = schemaState.rawResponses.map(function (entry) {
      return '--- ' + String(entry.file || '') + ' ---\n' + String(entry.text || '');
    }).join('\n\n');
    wrap.scrollTop = wrap.scrollHeight;
  }

  function appendRawResponse(fileName, rawText) {
    schemaState.rawResponses.push({
      file: String(fileName || ''),
      text: String(rawText || '')
    });
    renderRawResponses();
  }

  function renderEvidence() {
    var host = el('vision-schema-evidence');
    if (!host) throw new Error('Schema Assist evidence host is missing.');
    host.innerHTML = '';
    var evidence = schemaState.analysis && Array.isArray(schemaState.analysis.evidence)
      ? schemaState.analysis.evidence
      : [];
    if (!evidence.length) {
      var empty = document.createElement('div');
      empty.className = 'vision-schema-empty';
      empty.textContent = schemaState.statusPayload && Number(schemaState.statusPayload.structured || 0)
        ? 'Structured Sight is ready. Build vocabulary or tag candidates.'
        : 'Run a Sight scan to collect structured visual evidence.';
      host.appendChild(empty);
      return;
    }
    evidence.slice(0, 100).forEach(function (entry) {
      var row = document.createElement('div');
      row.className = 'vision-schema-pattern';
      var label = document.createElement('strong');
      label.textContent = String(entry.label || '');
      var count = document.createElement('span');
      count.textContent = String(entry.count || 0) + ' items';
      var examples = document.createElement('small');
      examples.textContent = String(entry.category || '') + ((entry.examples || []).length ? ' · ' + (entry.examples || []).slice(0, 4).join(' · ') : '');
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

  function renderTagCandidates(host) {
    var result = schemaState.tagCandidates;
    var items = result && Array.isArray(result.items) ? result.items : [];
    if (!items.length) {
      var empty = document.createElement('div');
      empty.className = 'vision-schema-empty';
      empty.textContent = result ? 'No confident missing tags were found for this scope.' : 'Build Tag Candidates to map structured Sight onto your current vocabulary.';
      host.appendChild(empty);
      return;
    }

    items.forEach(function (item) {
      var card = document.createElement('div');
      card.className = 'vision-tag-item-card';
      card.dataset.file = String(item.file || '');

      var header = document.createElement('div');
      header.className = 'vision-tag-item-header';
      var thumb = document.createElement('img');
      thumb.className = 'vision-tag-item-thumb';
      thumb.loading = 'lazy';
      thumb.alt = String(item.file || '');
      thumb.src = '/caption/media?folder=' + encodeURIComponent(schemaState.folder) +
        '&media=' + encodeURIComponent(String(item.file || ''));
      var fileWrap = document.createElement('div');
      fileWrap.className = 'vision-tag-item-file';
      var file = document.createElement('strong');
      file.textContent = String(item.file || '');
      var count = document.createElement('span');
      count.textContent = String((item.candidates || []).length) + ' candidate' + ((item.candidates || []).length === 1 ? '' : 's');
      fileWrap.appendChild(file);
      fileWrap.appendChild(count);
      header.appendChild(thumb);
      header.appendChild(fileWrap);
      card.appendChild(header);

      if (!(item.candidates || []).length) {
        var none = document.createElement('div');
        none.className = 'vision-schema-empty vision-tag-none';
        none.textContent = 'No confident additions.';
        card.appendChild(none);
      }

      (item.candidates || []).forEach(function (candidate, candidateIndex) {
        var row = document.createElement('label');
        row.className = 'vision-tag-candidate-row';
        row.dataset.candidateIndex = String(candidateIndex);

        var check = document.createElement('input');
        check.type = 'checkbox';
        check.className = 'vision-tag-candidate-check';
        check.checked = candidate.confidence === 'high';

        var copy = document.createElement('span');
        copy.className = 'vision-tag-candidate-copy';
        var term = document.createElement('strong');
        term.textContent = String(candidate.group || '') + ': ' + String(candidate.term || '');
        var meta = document.createElement('span');
        meta.textContent = String(candidate.confidence || '') + ' confidence' + (candidate.existing ? ' · existing vocabulary' : ' · new term');
        copy.appendChild(term);
        copy.appendChild(meta);
        if (candidate.why) {
          var why = document.createElement('small');
          why.textContent = String(candidate.why || '');
          copy.appendChild(why);
        }

        row.appendChild(check);
        row.appendChild(copy);
        card.appendChild(row);
      });
      host.appendChild(card);
    });
  }

  function renderProposals() {
    var host = el('vision-schema-proposals');
    if (!host) throw new Error('Schema Assist proposal host is missing.');
    host.innerHTML = '';

    if (schemaState.mode === 'tags') {
      renderTagCandidates(host);
      return;
    }

    var groups = schemaState.schema && Array.isArray(schemaState.schema.groups)
      ? schemaState.schema.groups
      : [];
    if (!groups.length) {
      var empty = document.createElement('div');
      empty.className = 'vision-schema-empty';
      empty.textContent = schemaState.schema ? 'The Director did not find useful vocabulary to add.' : 'Vocabulary suggestions will appear here.';
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
        check.disabled = false;
        check.title = term.alreadyExists
          ? 'Already present in the suggested target; select it if you redirect this proposal elsewhere'
          : 'Merge this term';

        var termName = document.createElement('input');
        termName.type = 'text';
        termName.className = 'vision-schema-term-name';
        termName.value = String(term.term || '');
        termName.disabled = false;

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
        (term.examples || []).slice(0, 4).forEach(function (value) {
          var fileName = String(value || '');
          var ext = fileName.split('.').pop().toLowerCase();
          var isImage = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'].indexOf(ext) !== -1;
          if (isImage) {
            var thumb = document.createElement('span');
            thumb.className = 'vision-schema-example-thumb';
            thumb.title = fileName;
            var img = document.createElement('img');
            img.alt = fileName;
            img.loading = 'lazy';
            img.src = '/caption/media?folder=' + encodeURIComponent(schemaState.folder) +
              '&media=' + encodeURIComponent(fileName);
            thumb.appendChild(img);
            evidence.appendChild(thumb);
            return;
          }
          var chip = document.createElement('span');
          chip.className = 'vision-schema-example-chip';
          chip.textContent = fileName;
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
    var scope = {};
    (schemaState.scopeFiles || []).forEach(function (fileName) { scope[String(fileName || '')] = true; });
    var scopedItems = (payload.items || []).filter(function (item) {
      return !schemaState.scopeFiles.length || !!scope[String(item.file || '')];
    });
    var total = scopedItems.length;
    var cached = scopedItems.filter(function (item) { return !!item.structured; }).length;
    var percent = total > 0 ? Math.max(0, Math.min(100, cached / total * 100)) : 0;
    var fill = el('vision-schema-progress-fill');
    var text = el('vision-schema-progress-text');
    if (!fill || !text) throw new Error('Schema Assist progress controls are missing.');
    fill.style.width = percent.toFixed(1) + '%';
    text.textContent = total
      ? (String(cached) + ' / ' + String(total) + ' visible media have structured Sight for ' + (schemaState.visionModel || 'the selected Vision model'))
      : 'No supported media in this Set.';
  }

  function render() {
    var modal = el('vision-schema-modal');
    var scanBtn = el('vision-schema-scan-btn');
    var stopBtn = el('vision-schema-stop-btn');
    var suggestBtn = el('vision-schema-suggest-btn');
    var tagBtn = el('vision-schema-tags-btn');
    var applyBtn = el('vision-schema-apply-btn');
    var body = el('vision-schema-body');
    var title = el('vision-schema-title');
    var subtitle = el('vision-schema-subtitle');
    if (!modal || !scanBtn || !stopBtn || !suggestBtn || !tagBtn || !applyBtn || !body || !title || !subtitle) {
      throw new Error('Schema Assist UI is incomplete.');
    }
    modal.classList.toggle('hidden', !schemaState.open);
    title.textContent = schemaState.guidedLaunch ? 'Guided Tag Pass' : 'Discover Vocabulary';
    subtitle.textContent = schemaState.guidedLaunch
      ? 'Review raw Vision output before building an existing-vocabulary pass.'
      : 'Build a reusable annotation schema from batch Vision sight.';
    body.classList.toggle('hidden', schemaState.guidedLaunch);
    suggestBtn.classList.toggle('hidden', schemaState.guidedLaunch);
    applyBtn.classList.toggle('hidden', schemaState.guidedLaunch);
    var schemaBusy = schemaState.schemaStarting || !!schemaState.schemaJobId;
    scanBtn.disabled = schemaState.scanRunning || schemaBusy;
    scanBtn.textContent = schemaState.statusPayload && Number(schemaState.statusPayload.structured || 0)
      ? 'Scan Missing Sight'
      : 'Scan Visible';
    stopBtn.classList.toggle('hidden', !schemaState.scanRunning && !schemaBusy);
    var scope = {};
    (schemaState.scopeFiles || []).forEach(function (fileName) { scope[String(fileName || '')] = true; });
    var scopedStructured = ((schemaState.statusPayload && schemaState.statusPayload.items) || []).filter(function (item) {
      return (!schemaState.scopeFiles.length || !!scope[String(item.file || '')]) && !!item.structured;
    }).length;
    var allStructured = Number(schemaState.statusPayload && schemaState.statusPayload.structured || 0);
    suggestBtn.disabled = schemaState.scanRunning || schemaBusy || allStructured < 2;
    var scopedTotal = schemaState.scopeFiles.length;
    tagBtn.disabled = schemaState.scanRunning || schemaBusy || !scopedTotal || scopedStructured < scopedTotal;
    tagBtn.textContent = schemaState.guidedLaunch ? 'Build Guided Pass' : 'Build Tag Candidates';
    applyBtn.textContent = schemaState.mode === 'tags' ? 'Apply Selected Tags' : 'Merge Selected Vocabulary';
    var tagCandidateCount = schemaState.tagCandidates && Array.isArray(schemaState.tagCandidates.items)
      ? schemaState.tagCandidates.items.reduce(function (total, item) {
          return total + (Array.isArray(item.candidates) ? item.candidates.length : 0);
        }, 0)
      : 0;
    applyBtn.disabled = schemaState.scanRunning || schemaBusy || (
      schemaState.mode === 'tags'
        ? tagCandidateCount < 1
        : !(schemaState.schema && schemaState.schema.groups && schemaState.schema.groups.length)
    );
    var heading = el('vision-schema-proposal-heading');
    var headingNote = el('vision-schema-proposal-note');
    if (heading) heading.textContent = schemaState.mode === 'tags' ? 'Tag Candidates' : 'Schema Suggestions';
    if (headingNote) headingNote.textContent = schemaState.mode === 'tags'
      ? 'Toggle confident additions, including proposed new terms, then apply.'
      : 'Director-organized vocabulary grounded in structured Sight.';
    renderProgress();
    renderRawResponses();
    renderEvidence();
    renderProposals();
  }

  function saveSight(folder, model, media, sight) {
    return requestJson('/fs/vision_schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'save_sight',
        folder: folder,
        visionModel: model,
        media: media,
        sight: sight
      })
    });
  }

  function requestStructuredSight(folder, model, media) {
    return requestJson('/fs/vision_schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'scan_sight',
        folder: folder,
        visionModel: model,
        media: media
      })
    }).then(function (payload) {
      if (!payload.job || !payload.job.jobId) throw new Error('Vision Sight did not return a queued job.');
      schemaState.currentVisionJobId = String(payload.job.jobId || '');
      trackTransientLlmJob(payload.job);
      return waitForCaptionAssistJob(payload.job);
    }).then(function (job) {
      schemaState.currentVisionJobId = '';
      var sight = job.result && job.result.sight;
      if (!sight || !sight.description || !sight.inventory) {
        throw new Error('Vision Sight completed without structured evidence.');
      }
      return {
        sight: sight,
        text: String(job.result && job.result.text || '')
      };
    });
  }

  function scanNext(pending, index, folder, model) {
    if (schemaState.scanStopRequested || !schemaState.open) return Promise.resolve(false);
    if (currentFolder() !== folder) throw new Error('Set changed while Vision scan was running.');
    if (index >= pending.length) return Promise.resolve(true);

    var fileName = pending[index];
    setStatus('Structured Sight · ' + String(index + 1) + ' / ' + String(pending.length));
    return requestStructuredSight(folder, model, fileName).then(function (result) {
      if (schemaState.scanStopRequested) return false;
      appendRawResponse(fileName, result.text);
      return saveSight(folder, model, fileName, result.sight);
    }).then(function (saved) {
      if (saved === false) return false;
      return refreshStatus();
    }).then(function () {
      if (schemaState.scanStopRequested) return false;
      return scanNext(pending, index + 1, folder, model);
    });
  }

  function runScan() {
    if (schemaState.scanRunning || schemaState.schemaStarting || schemaState.schemaJobId) return;
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
    if (!schemaState.guidedLaunch || !schemaState.scopeFiles.length) {
      schemaState.scopeFiles = getVisibleMediaSelectionForTraining();
    }
    if (!schemaState.scopeFiles.length) {
      setStatus('No visible media to scan.', true);
      return;
    }
    schemaState.scanRunning = true;
    schemaState.scanStopRequested = false;
    schemaState.schema = null;
    schemaState.tagCandidates = null;
    schemaState.mode = 'tags';
    schemaState.analysis = null;
    render();
    setStatus('Checking cached Vision sight…');

    refreshStatus().then(function (payload) {
      var scope = {};
      schemaState.scopeFiles.forEach(function (fileName) { scope[String(fileName || '')] = true; });
      var pending = (payload.items || []).filter(function (item) {
        return !!scope[String(item.file || '')] && !item.structured;
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
      if (schemaState.guidedLaunch) return null;
      return analyze();
    }).then(function () {
      if (!schemaState.scanStopRequested) {
        setStatus(schemaState.guidedLaunch
          ? 'Vision review complete. Build the Guided Pass when the responses look useful.'
          : 'Structured Sight complete. Build tag candidates or vocabulary suggestions.');
      }
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
    schemaState.schemaRequestToken += 1;
    var jobs = [];
    if (schemaState.currentVisionJobId) jobs.push(cancelCaptionAssistJob(schemaState.currentVisionJobId));
    if (schemaState.schemaJobId) jobs.push(cancelCaptionAssistJob(schemaState.schemaJobId));
    schemaState.currentVisionJobId = '';
    schemaState.schemaStarting = false;
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
    if (schemaState.scanRunning || schemaState.schemaStarting || schemaState.schemaJobId) return;
    schemaState.mode = 'vocabulary';
    var director = currentDirectorModel();
    if (!director) {
      setStatus('Select a Director model first.', true);
      return;
    }
    var folder = schemaState.folder;
    var visionModel = schemaState.visionModel;
    var groups = existingGroupsPayload();
    var token = schemaState.schemaRequestToken + 1;
    schemaState.schemaRequestToken = token;
    schemaState.scanStopRequested = false;
    schemaState.schemaStarting = true;
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
      var jobId = String(payload.job && payload.job.jobId || '');
      if (!jobId) throw new Error('Schema Assist did not return a queued job.');
      if (
        token !== schemaState.schemaRequestToken ||
        schemaState.scanStopRequested ||
        !schemaState.open ||
        folder !== schemaState.folder ||
        visionModel !== schemaState.visionModel
      ) {
        schemaState.schemaStarting = false;
        return cancelCaptionAssistJob(jobId).then(function () { return null; });
      }
      schemaState.analysis = payload.analysis || schemaState.analysis;
      schemaState.schemaStarting = false;
      schemaState.schemaJobId = jobId;
      render();
      return waitForCaptionAssistJob(payload.job);
    }).then(function (job) {
      if (!job || token !== schemaState.schemaRequestToken) return;
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
      if (token !== schemaState.schemaRequestToken) return;
      schemaState.schemaStarting = false;
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

  function runTagSuggestions() {
    if (schemaState.scanRunning || schemaState.schemaStarting || schemaState.schemaJobId) return;
    var director = currentDirectorModel();
    if (!director) {
      setStatus('Select a Director model first.', true);
      return;
    }

    var files = schemaState.guidedLaunch && schemaState.scopeFiles.length
      ? schemaState.scopeFiles.slice()
      : getVisibleMediaSelectionForTraining();
    if (!files.length) {
      setStatus('No visible media to analyze.', true);
      return;
    }

    var folder = schemaState.folder;
    var visionModel = schemaState.visionModel;
    var token = schemaState.schemaRequestToken + 1;
    schemaState.schemaRequestToken = token;
    schemaState.scopeFiles = files.slice();
    schemaState.scanStopRequested = false;
    schemaState.schemaStarting = true;
    schemaState.mode = 'tags';
    schemaState.tagCandidates = null;
    setStatus('Mapping structured Sight onto existing groups and tags…');
    render();

    requestJson('/fs/vision_schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'suggest_tags',
        folder: folder,
        visionModel: visionModel,
        directorModel: director,
        files: files,
        existingGroups: existingGroupsPayload(),
        currentAssignments: currentAssignmentsPayload(files)
      })
    }).then(function (payload) {
      var jobId = String(payload.job && payload.job.jobId || '');
      if (!jobId) throw new Error('Vision Tag Assist did not return a queued job.');
      if (
        token !== schemaState.schemaRequestToken ||
        schemaState.scanStopRequested ||
        !schemaState.open ||
        folder !== schemaState.folder ||
        visionModel !== schemaState.visionModel
      ) {
        schemaState.schemaStarting = false;
        return cancelCaptionAssistJob(jobId).then(function () { return null; });
      }
      schemaState.schemaStarting = false;
      schemaState.schemaJobId = jobId;
      render();
      return waitForCaptionAssistJob(payload.job);
    }).then(function (job) {
      if (!job || token !== schemaState.schemaRequestToken) return;
      schemaState.schemaJobId = '';
      if (!schemaState.open || folder !== schemaState.folder || visionModel !== schemaState.visionModel) return;
      var result = job.result && job.result.tagCandidates;
      if (!result || !Array.isArray(result.items)) {
        throw new Error('Vision Tag Assist completed without structured candidates.');
      }
      schemaState.tagCandidates = result;
      if (schemaState.guidedLaunch) {
        if (startGuidedTagPass(result)) return;
      }
      var candidateCount = result.items.reduce(function (total, item) {
        return total + (Array.isArray(item.candidates) ? item.candidates.length : 0);
      }, 0);
      setStatus(
        candidateCount
          ? ('Found ' + String(candidateCount) + ' candidate tag' + (candidateCount === 1 ? '' : 's') + ' across ' + String(result.items.length) + ' media.')
          : 'No confident missing tags found for the visible media.'
      );
      render();
    }).catch(function (err) {
      if (token !== schemaState.schemaRequestToken) return;
      schemaState.schemaStarting = false;
      schemaState.schemaJobId = '';
      if (schemaState.scanStopRequested) {
        setStatus('Vision Tag Assist stopped.');
      } else {
        setStatus('Vision Tag Assist failed: ' + String(err && err.message ? err.message : err), true);
        reportConsoleError('Vision Tag Assist', err);
      }
      render();
    });
  }

  function buildGuidedTagPassSteps(result) {
    var byKey = {};
    (result && Array.isArray(result.items) ? result.items : []).forEach(function (item) {
      var fileName = String(item && item.file || '');
      (item && Array.isArray(item.candidates) ? item.candidates : []).forEach(function (candidate) {
        if (!candidate || !candidate.existing) return;
        var group = String(candidate.group || '');
        var term = String(candidate.term || '');
        var confidence = String(candidate.confidence || '');
        if (!group || !term || (confidence !== 'high' && confidence !== 'medium')) return;
        var key = group.toLowerCase() + '\u0000' + term.toLowerCase();
        if (!byKey[key]) {
          byKey[key] = { group: group, term: term, highFiles: [], mediumFiles: [] };
        }
        var target = confidence === 'high' ? byKey[key].highFiles : byKey[key].mediumFiles;
        if (target.indexOf(fileName) === -1) target.push(fileName);
      });
    });
    return Object.keys(byKey).map(function (key) {
      return byKey[key];
    }).filter(function (step) {
      return step.highFiles.length || step.mediumFiles.length;
    }).sort(function (a, b) {
      if (b.highFiles.length !== a.highFiles.length) return b.highFiles.length - a.highFiles.length;
      var bTotal = b.highFiles.length + b.mediumFiles.length;
      var aTotal = a.highFiles.length + a.mediumFiles.length;
      if (bTotal !== aTotal) return bTotal - aTotal;
      var groupCmp = a.group.localeCompare(b.group);
      return groupCmp || a.term.localeCompare(b.term);
    });
  }

  function getGuidedTagPassStep() {
    var pass = schemaState.guidedPass;
    if (!pass || !Array.isArray(pass.steps) || pass.index < 0 || pass.index >= pass.steps.length) return null;
    return pass.steps[pass.index];
  }

  function applyGuidedTagPassStep() {
    var step = getGuidedTagPassStep();
    if (!step || typeof mediaGridState === 'undefined' || !mediaGridState.open) return;
    var selected = new Set();
    step.highFiles.forEach(function (fileName) {
      var item = findMediaItem(fileName);
      if (item && item.key) selected.add(item.key);
    });
    mediaGridState.selectedKeys = selected;
    mediaGridState.lastSelectedKey = selected.size ? Array.from(selected)[selected.size - 1] : '';
    renderMediaGridSurface();
  }

  function startGuidedTagPass(result) {
    var steps = buildGuidedTagPassSteps(result);
    if (!steps.length) {
      setStatus('No useful existing-vocabulary tag passes were found for this scope.', true);
      return false;
    }
    schemaState.guidedPass = {
      steps: steps,
      index: 0,
      scopeFiles: schemaState.scopeFiles.slice()
    };
    schemaState.open = false;
    schemaState.guidedLaunch = false;
    render();
    if (typeof mediaGridState === 'undefined') throw new Error('Media Grid state is not available for Guided Tag Pass.');
    if (!mediaGridState.open) openMediaGridSurface();
    applyGuidedTagPassStep();
    setStatus('');
    return true;
  }

  function advanceGuidedTagPass() {
    var pass = schemaState.guidedPass;
    if (!pass) return;
    pass.index += 1;
    if (pass.index >= pass.steps.length) {
      exitGuidedTagPass({ keepGridOpen: true, completed: true });
      return;
    }
    applyGuidedTagPassStep();
  }

  function skipGuidedTagPassStep() {
    if (!schemaState.guidedPass) return;
    advanceGuidedTagPass();
  }

  function exitGuidedTagPass(options) {
    var opts = options || {};
    var hadPass = !!schemaState.guidedPass;
    schemaState.guidedPass = null;
    if (hadPass && opts.keepGridOpen !== false && typeof mediaGridState !== 'undefined' && mediaGridState.open) {
      mediaGridSetStatus(opts.completed ? 'Guided Tag Pass complete.' : 'Guided Tag Pass ended.');
      renderMediaGridSurface();
    }
  }

  function renderGuidedTagPassGridChrome() {
    var bar = el('media-grid-guided-pass');
    var progress = el('media-grid-guided-pass-progress');
    var label = el('media-grid-guided-pass-label');
    var launchBtn = el('media-grid-guided-pass-btn');
    if (!bar || !progress || !label || !launchBtn) throw new Error('Guided Tag Pass Grid controls are missing.');
    var pass = schemaState.guidedPass;
    var step = getGuidedTagPassStep();
    var canLaunch = typeof isSetFolderPath === 'function' && isSetFolderPath(state && state.folder);
    bar.classList.toggle('hidden', !pass || !step);
    launchBtn.classList.toggle('hidden', !!pass || !canLaunch);
    if (!pass || !step) return;
    progress.textContent = String(pass.index + 1) + ' / ' + String(pass.steps.length);
    label.textContent = step.group + ' · ' + step.term + ' — ' + String(step.highFiles.length) + ' likely';
  }

  function syncGuidedTagPassWorkbenchHighlight() {
    var target = el('group-workbench-list');
    if (!target) return;
    Array.prototype.forEach.call(target.querySelectorAll('.guided-tag-target'), function (node) {
      node.classList.remove('guided-tag-target');
    });
    var step = getGuidedTagPassStep();
    if (!step) return;
    var buttons = target.querySelectorAll('.group-workbench-term-btn[data-group][data-term]');
    for (var i = 0; i < buttons.length; i += 1) {
      if (
        String(buttons[i].dataset.group || '') === step.group &&
        String(buttons[i].dataset.term || '') === step.term
      ) {
        buttons[i].classList.add('guided-tag-target');
        buttons[i].scrollIntoView({ block: 'nearest', inline: 'nearest' });
        break;
      }
    }
  }

  function handleGuidedTagPassGridTermMutation(group, term, details) {
    var step = getGuidedTagPassStep();
    if (!step) return false;
    if (step.group !== String(group || '') || step.term !== String(term || '')) return false;
    if (details && details.removed) return false;
    if (!details || Number(details.changed || 0) <= 0) return false;
    advanceGuidedTagPass();
    return true;
  }

  function selectedTagCandidates() {
    var result = schemaState.tagCandidates;
    var items = result && Array.isArray(result.items) ? result.items : [];
    var selected = [];
    var cards = el('vision-schema-proposals').querySelectorAll('.vision-tag-item-card');
    Array.prototype.forEach.call(cards, function (card) {
      var fileName = String(card.dataset.file || '');
      var source = items.find(function (item) { return String(item.file || '') === fileName; });
      if (!source) return;
      Array.prototype.forEach.call(card.querySelectorAll('.vision-tag-candidate-row'), function (row) {
        var check = row.querySelector('.vision-tag-candidate-check');
        if (!check || !check.checked) return;
        var index = Number(row.dataset.candidateIndex);
        var candidate = source.candidates && source.candidates[index];
        if (!candidate) return;
        selected.push({
          file: fileName,
          group: String(candidate.group || ''),
          term: String(candidate.term || ''),
          existing: !!candidate.existing
        });
      });
    });
    return selected;
  }

  function applySelectedTags() {
    var selected = selectedTagCandidates();
    if (!selected.length) {
      setStatus('Select at least one candidate tag to apply.', true);
      return;
    }

    var newTermsByGroup = {};
    selected.forEach(function (candidate) {
      if (candidate.existing) return;
      if (!newTermsByGroup[candidate.group]) newTermsByGroup[candidate.group] = [];
      if (newTermsByGroup[candidate.group].indexOf(candidate.term) === -1) {
        newTermsByGroup[candidate.group].push(candidate.term);
      }
    });
    var vocabularyMutations = Object.keys(newTermsByGroup).map(function (group) {
      return { group: group, create: false, terms: newTermsByGroup[group] };
    });
    var merged = vocabularyMutations.length
      ? mergeChecklistSchemaVocabulary(vocabularyMutations)
      : { addedTerms: 0 };

    var applied = 0;
    selected.forEach(function (candidate) {
      var item = findMediaItem(candidate.file);
      if (!item || !item.key) throw new Error('Could not find media item for tag candidate: ' + candidate.file);
      if (assignChecklistTagToMediaKey(item.key, candidate.group, candidate.term, { skipRefresh: true })) {
        applied += 1;
      }
    });

    refreshCurrentPrimerDerivedUi();
    renderChecklistPanel();
    renderItemMetadataPanel();
    renderAnnotateStrip();
    renderItemTagsPanel();
    renderFileList(ui && ui.filterEl ? ui.filterEl.value : '');
    renderFocusedAnnotationSurface();

    setStatus(
      'Applied ' + String(applied) + ' tag' + (applied === 1 ? '' : 's') +
      (Number(merged.addedTerms || 0) ? (' and added ' + String(merged.addedTerms) + ' new vocabulary term' + (Number(merged.addedTerms) === 1 ? '' : 's')) : '') + '.'
    );
    schemaState.tagCandidates = null;
    render();
  }

  function canonicalExistingGroup(name) {
    var wanted = String(name || '').trim().toLowerCase();
    if (!wanted) return '';
    var groups = Array.isArray(checklistItems) ? checklistItems : [];
    for (var i = 0; i < groups.length; i += 1) {
      var current = String(groups[i] || '').trim();
      if (current.toLowerCase() === wanted) return current;
    }
    return '';
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
      var requested = selectedGroup || newName;
      var canonical = canonicalExistingGroup(requested);
      mutations.push({
        group: canonical || requested,
        create: !selectedGroup && !canonical,
        terms: terms
      });
    });
    return mutations;
  }

  function applySelected() {
    if (schemaState.mode === 'tags') {
      applySelectedTags();
      return;
    }
    var mutations = selectedProposalMutations();
    if (!mutations.length) {
      setStatus('Select at least one proposed term to merge.', true);
      return;
    }
    var merged = mergeChecklistSchemaVocabulary(mutations);
    var addedGroups = Number(merged.addedGroups || 0);
    var addedTerms = Number(merged.addedTerms || 0);
    setStatus(
      'Merged ' + String(addedTerms) + ' term' + (addedTerms === 1 ? '' : 's') +
      (addedGroups ? (' across ' + String(addedGroups) + ' new group' + (addedGroups === 1 ? '' : 's')) : '') + '.'
    );
    schemaState.schema = null;
    render();
  }

  function guidedScopeFiles(options) {
    var opts = options || {};
    if (opts.source === 'grid' && typeof mediaGridState !== 'undefined' && mediaGridState.open) {
      return (mediaGridState.items || []).map(function (item) {
        return String(item && item.fileName || '');
      }).filter(Boolean);
    }
    return getVisibleMediaSelectionForTraining();
  }

  function openGuidedTagPass(options) {
    var folder = currentFolder();
    var model = currentVisionModel();
    if (!folder) {
      setStatus('Open a Set before starting Guided Tag Pass.', true);
      return;
    }
    if (!model) {
      setStatus('Select a Vision model first.', true);
      return;
    }
    var files = guidedScopeFiles(options);
    if (!files.length) {
      setStatus('No visible media to review.', true);
      return;
    }
    schemaState.open = true;
    schemaState.folder = folder;
    schemaState.visionModel = model;
    schemaState.scopeFiles = files.slice();
    schemaState.scanStopRequested = false;
    schemaState.schema = null;
    schemaState.tagCandidates = null;
    schemaState.mode = 'tags';
    schemaState.analysis = null;
    schemaState.guidedLaunch = true;
    schemaState.rawResponses = [];
    render();
    setStatus('Loading current Sight coverage…');
    refreshStatus().then(function () {
      if (!schemaState.open || !schemaState.guidedLaunch) return;
      runScan();
    }).catch(function (err) {
      setStatus('Could not start Guided Tag Pass: ' + String(err && err.message ? err.message : err), true);
      reportConsoleError('Guided Tag Pass', err);
    });
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
    schemaState.scopeFiles = getVisibleMediaSelectionForTraining();
    schemaState.scanStopRequested = false;
    schemaState.schema = null;
    schemaState.tagCandidates = null;
    schemaState.mode = 'tags';
    schemaState.analysis = null;
    schemaState.guidedLaunch = false;
    schemaState.rawResponses = [];
    render();
    setStatus('Loading current Sight coverage…');
    refreshStatus().then(function () {
      if (schemaState.statusPayload && schemaState.statusPayload.structured) return analyze();
      return null;
    }).catch(function (err) {
      setStatus('Could not load Schema Assist: ' + String(err && err.message ? err.message : err), true);
      reportConsoleError('Schema Assist', err);
    });
  }

  function close() {
    if (schemaState.scanRunning || schemaState.schemaStarting || schemaState.schemaJobId) stopWork();
    schemaState.open = false;
    schemaState.guidedLaunch = false;
    render();
  }

  function bind() {
    var openBtn = el('vision-schema-open-btn');
    var guidedOpenBtn = el('guided-tag-pass-open-btn');
    var closeBtn = el('vision-schema-close-btn');
    var scanBtn = el('vision-schema-scan-btn');
    var stopBtn = el('vision-schema-stop-btn');
    var suggestBtn = el('vision-schema-suggest-btn');
    var tagBtn = el('vision-schema-tags-btn');
    var applyBtn = el('vision-schema-apply-btn');
    var modal = el('vision-schema-modal');
    if (!openBtn || !guidedOpenBtn || !closeBtn || !scanBtn || !stopBtn || !suggestBtn || !tagBtn || !applyBtn || !modal) {
      throw new Error('Schema Assist controls are missing.');
    }
    openBtn.onclick = open;
    guidedOpenBtn.onclick = function () { openGuidedTagPass({ source: 'set' }); };
    closeBtn.onclick = close;
    scanBtn.onclick = runScan;
    stopBtn.onclick = stopWork;
    suggestBtn.onclick = function () {
      schemaState.mode = 'vocabulary';
      render();
      runSuggestions();
    };
    tagBtn.onclick = runTagSuggestions;
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
  window.openGuidedTagPass = openGuidedTagPass;
  window.skipGuidedTagPassStep = skipGuidedTagPassStep;
  window.exitGuidedTagPass = exitGuidedTagPass;
  window.renderGuidedTagPassGridChrome = renderGuidedTagPassGridChrome;
  window.syncGuidedTagPassWorkbenchHighlight = syncGuidedTagPassWorkbenchHighlight;
  window.handleGuidedTagPassGridTermMutation = handleGuidedTagPassGridTermMutation;
  bind();
})();
