(function () {
  'use strict';

  var schemaState = {
    open: false,
    folder: '',
    visionModel: '',
    workStopRequested: false,
    schemaStarting: false,
    schemaJobId: '',
    schemaRequestToken: 0,
    statusPayload: null,
    analysis: null,
    schema: null,
    reviewIndex: 0,
    tagCandidates: null,
    mode: 'vocabulary',
    scopeFiles: [],
    guidedLaunch: false,
    guidedPass: null,
    vocabularyScanIndex: 0,
    vocabularyScanTotal: 0,
    vocabularyComplete: false,
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

  function currentCaptionTemplate() {
    var primer = statsGetPrimerOptionsFromDom();
    return String(primer && primer.template || '');
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

  function requestVocabularyStatus(folder, model, groups, captionTemplate) {
    return requestJson('/fs/vision_schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'vocabulary_status',
        folder: folder,
        visionModel: model,
        existingGroups: groups,
        captionTemplate: String(captionTemplate || '')
      })
    });
  }

  function ensureVocabularySight() {
    var folder = schemaState.folder;
    var model = schemaState.visionModel;
    var groups = existingGroupsPayload();
    var captionTemplate = currentCaptionTemplate();
    if (!groups.length) {
      throw new Error('Discover Vocabulary needs at least one annotation group in Set Intelligence context.');
    }
    return requestVocabularyStatus(folder, model, groups, captionTemplate).then(function (payload) {
      var wanted = {};
      schemaState.scopeFiles.forEach(function (fileName) { wanted[fileName] = true; });
      var cached = (payload.items || []).filter(function (item) {
        return !!wanted[String(item.file || '')] && !!item.cached;
      }).length;
      if (!cached) {
        throw new Error('Discover Vocabulary needs current Context Sight. Run Set Intelligence first.');
      }
      setStatus(
        'Two-pass visual evidence is ready for ' + String(cached) + ' of ' +
        String(schemaState.scopeFiles.length) + ' media.'
      );
      return true;
    });
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

  function actionableVocabularyGroups() {
    var groups = schemaState.schema && Array.isArray(schemaState.schema.groups)
      ? schemaState.schema.groups
      : [];
    return groups.filter(function (group) {
      return (group.terms || []).some(function (term) { return !term.alreadyExists; });
    });
  }

  function currentVocabularyGroup() {
    var groups = actionableVocabularyGroups();
    if (!groups.length) return null;
    var index = Math.max(0, Math.min(Number(schemaState.reviewIndex || 0), groups.length - 1));
    schemaState.reviewIndex = index;
    return groups[index];
  }

  function updateVocabularyReviewControls() {
    var applyBtn = el('vision-schema-apply-btn');
    var skipBtn = el('vision-schema-skip-btn');
    var footerNote = el('vision-schema-footer-note');
    if (!applyBtn || !skipBtn || !footerNote) throw new Error('Vocabulary review controls are missing.');

    if (schemaState.guidedLaunch) {
      skipBtn.classList.add('hidden');
      applyBtn.classList.add('hidden');
      footerNote.textContent = 'Sight is cached in the Set; nothing is tagged until you act in Grid.';
      return;
    }

    if (schemaState.vocabularyComplete) {
      skipBtn.classList.add('hidden');
      applyBtn.classList.remove('hidden');
      applyBtn.disabled = false;
      applyBtn.textContent = 'Continue to Guided Tagging';
      applyBtn.classList.add('vision-schema-continue-btn');
      footerNote.textContent = 'Vocabulary is ready. Next: review likely tag matches in Grid.';
      return;
    }

    applyBtn.textContent = 'Add Selected to Vocabulary';
    applyBtn.classList.remove('vision-schema-continue-btn');
    var groups = actionableVocabularyGroups();
    var group = currentVocabularyGroup();
    var card = el('vision-schema-proposals').querySelector('.vision-schema-group-card');
    var selected = card
      ? Array.prototype.filter.call(card.querySelectorAll('.vision-schema-term-check'), function (check) {
          return !!check.checked;
        }).length
      : 0;
    var schemaBusy = schemaState.schemaStarting || !!schemaState.schemaJobId;

    skipBtn.classList.toggle('hidden', !group);
    applyBtn.classList.toggle('hidden', !group);
    skipBtn.disabled = schemaBusy;
    applyBtn.disabled = schemaBusy || selected < 1;

    if (group) {
      footerNote.textContent =
        String(selected) + ' term' + (selected === 1 ? '' : 's') + ' selected · Group ' +
        String(schemaState.reviewIndex + 1) + ' of ' + String(groups.length);
    } else {
      footerNote.textContent = 'Discovery changes vocabulary only; it does not tag media.';
    }
  }

  function renderProposals() {
    var host = el('vision-schema-proposals');
    if (!host) throw new Error('Schema Assist proposal host is missing.');
    host.innerHTML = '';

    if (schemaState.mode === 'tags') {
      renderTagCandidates(host);
      return;
    }

    var groups = actionableVocabularyGroups();
    if (!groups.length) {
      var empty = document.createElement('div');
      empty.className = 'vision-schema-empty';
      empty.textContent = schemaState.vocabularyComplete
        ? 'Vocabulary review complete. Ready to apply the mature vocabulary across the Set.'
        : (schemaState.schema
          ? 'The Director did not find useful vocabulary to add.'
          : 'Run Discover Vocabulary to find recurring concepts worth adding.');
      host.appendChild(empty);
      return;
    }

    var group = currentVocabularyGroup();
    var groupIndex = schemaState.reviewIndex;
    var card = document.createElement('div');
    card.className = 'vision-schema-group-card';
    card.dataset.groupIndex = String(groupIndex);

    var progress = document.createElement('div');
    progress.className = 'vision-schema-review-progress';
    progress.textContent = 'Group ' + String(groupIndex + 1) + ' of ' + String(groups.length);
    card.appendChild(progress);

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
        : 'Add this term';
      check.addEventListener('change', updateVocabularyReviewControls);

      var termName = document.createElement('input');
      termName.type = 'text';
      termName.className = 'vision-schema-term-name';
      termName.value = String(term.term || '');
      termName.disabled = false;

      var support = document.createElement('span');
      support.className = 'vision-schema-term-support';
      support.textContent = term.alreadyExists
        ? 'already present'
        : String(term.support || 0) + ' items';

      row.appendChild(check);
      row.appendChild(termName);
      row.appendChild(support);
      card.appendChild(row);
    });

    var evidenceDetails = document.createElement('details');
    evidenceDetails.className = 'vision-schema-evidence-details';
    var evidenceSummary = document.createElement('summary');
    evidenceSummary.textContent = 'Why these suggestions?';
    evidenceDetails.appendChild(evidenceSummary);
    if (group.rationale) {
      var rationale = document.createElement('p');
      rationale.textContent = String(group.rationale || '');
      evidenceDetails.appendChild(rationale);
    }
    (group.terms || []).forEach(function (term) {
      if (!(term.evidence || []).length && !(term.examples || []).length) return;
      var evidenceRow = document.createElement('div');
      evidenceRow.className = 'vision-schema-evidence-detail-row';
      var label = document.createElement('strong');
      label.textContent = String(term.term || '');
      var evidence = document.createElement('span');
      evidence.textContent = (term.evidence || []).slice(0, 4).join(' · ');
      var examples = document.createElement('div');
      examples.className = 'vision-schema-evidence-thumbs';
      (term.examples || []).slice(0, 4).forEach(function (fileName) {
        var thumb = document.createElement('img');
        thumb.loading = 'lazy';
        thumb.alt = String(fileName || '');
        thumb.title = String(fileName || '');
        thumb.src = '/caption/media?folder=' + encodeURIComponent(schemaState.folder) +
          '&media=' + encodeURIComponent(String(fileName || ''));
        examples.appendChild(thumb);
      });
      evidenceRow.appendChild(label);
      if (evidence.textContent) evidenceRow.appendChild(evidence);
      if (examples.children.length) evidenceRow.appendChild(examples);
      evidenceDetails.appendChild(evidenceRow);
    });
    if (evidenceDetails.children.length > 1) card.appendChild(evidenceDetails);

    host.appendChild(card);
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
    var usingVocabularyPass = !schemaState.guidedLaunch && schemaState.vocabularyScanTotal > 0;
    var percent = usingVocabularyPass
      ? Math.max(0, Math.min(100, schemaState.vocabularyScanIndex / schemaState.vocabularyScanTotal * 100))
      : (total > 0 ? Math.max(0, Math.min(100, cached / total * 100)) : 0);
    var fill = el('vision-schema-progress-fill');
    var text = el('vision-schema-progress-text');
    if (!fill || !text) throw new Error('Schema Assist progress controls are missing.');
    fill.style.width = percent.toFixed(1) + '%';
    text.textContent = usingVocabularyPass
      ? (String(schemaState.vocabularyScanIndex) + ' / ' + String(schemaState.vocabularyScanTotal) + ' fresh group-aware visual checks complete')
      : (total
        ? (String(cached) + ' / ' + String(total) + ' Set media have structured Sight for ' + (schemaState.visionModel || 'the selected Vision model'))
        : 'No supported media in this Set.');
  }

  function render() {
    var modal = el('vision-schema-modal');
    var stopBtn = el('vision-schema-stop-btn');
    var applyBtn = el('vision-schema-apply-btn');
    var footerNote = el('vision-schema-footer-note');
    var progressWrap = el('vision-schema-progress-wrap');
    var body = el('vision-schema-body');
    var title = el('vision-schema-title');
    var subtitle = el('vision-schema-subtitle');
    if (!modal || !stopBtn || !applyBtn || !footerNote || !progressWrap || !body || !title || !subtitle) {
      throw new Error('Schema Assist UI is incomplete.');
    }

    modal.classList.toggle('hidden', !schemaState.open);
    modal.classList.toggle('vision-schema-guided', !!schemaState.guidedLaunch);
    title.textContent = schemaState.guidedLaunch ? 'Guided Tag Pass' : 'Discover Vocabulary';
    subtitle.textContent = schemaState.guidedLaunch
      ? 'Use current Set intelligence to build an existing-vocabulary pass in Grid.'
      : 'Find recurring concepts and decide what belongs in this Set\'s vocabulary.';
    body.classList.toggle('hidden', schemaState.guidedLaunch);

    var schemaBusy = schemaState.schemaStarting || !!schemaState.schemaJobId;
    var hasVocabularyReview = !schemaState.guidedLaunch &&
      !!(schemaState.schema && schemaState.schema.groups && schemaState.schema.groups.length);
    progressWrap.classList.toggle('hidden', hasVocabularyReview);

    stopBtn.classList.toggle('hidden', !schemaBusy);

    var heading = el('vision-schema-proposal-heading');
    var headingNote = el('vision-schema-proposal-note');
    if (heading) heading.textContent = schemaState.mode === 'tags' ? 'Tag Candidates' : 'Vocabulary Changes';
    if (headingNote) {
      if (schemaState.mode === 'tags') {
        headingNote.textContent = 'Map structured Sight onto the current vocabulary.';
      } else {
        var groups = schemaState.schema && Array.isArray(schemaState.schema.groups)
          ? schemaState.schema.groups
          : [];
        headingNote.textContent = groups.length
          ? 'Review one proposed group at a time.'
          : 'Discovery will organize recurring visual concepts into proposed groups and terms.';
      }
    }

    renderProgress();
    renderProposals();
    updateVocabularyReviewControls();
  }

  function runDiscovery() {
    if (schemaState.schemaStarting || schemaState.schemaJobId) return;
    if (!currentDirectorModel()) {
      setStatus('Select a Director model first.', true);
      return;
    }
    schemaState.scopeFiles = getCurrentSetMediaFileNames();
    if (!schemaState.scopeFiles.length) {
      setStatus('This Set has no media to analyze.', true);
      return;
    }
    schemaState.mode = 'vocabulary';
    schemaState.reviewIndex = 0;
    schemaState.schema = null;
    schemaState.vocabularyComplete = false;
    schemaState.workStopRequested = false;
    schemaState.schemaStarting = true;
    setStatus('Checking current Set Intelligence…');
    render();

    refreshStatus().then(function (payload) {
      var wanted = {};
      schemaState.scopeFiles.forEach(function (fileName) { wanted[fileName] = true; });
      var structured = (payload.items || []).filter(function (item) {
        return !!wanted[String(item.file || '')] && !!item.structured;
      }).length;
      if (!structured) {
        throw new Error('Discover Vocabulary needs at least one usable Set Intelligence result for this Vision model.');
      }
      setStatus(
        'Open visual evidence is ready for ' + String(structured) + ' of ' +
        String(schemaState.scopeFiles.length) + ' items. Checking Context Sight from Set Intelligence…'
      );
      return ensureVocabularySight();
    }).then(function (ready) {
      if (ready === false || schemaState.workStopRequested) return false;
      setStatus('Usable visual evidence is ready. Making sense of the vocabulary…');
      return runVocabularySynthesis();
    }).then(function (draft) {
      if (!draft || schemaState.workStopRequested) return false;
      setStatus('Challenging the draft for missed distinctions and weak vocabulary…');
      return runVocabularyChallenge(draft);
    }).then(function (finalSchema) {
      if (!finalSchema || schemaState.workStopRequested) return;
      schemaState.schema = finalSchema;
      schemaState.schema.groups = actionableVocabularyGroups();
      schemaState.reviewIndex = 0;
      schemaState.vocabularyComplete = schemaState.schema.groups.length === 0;
      schemaState.schemaStarting = false;
      setStatus(finalSchema.groups.length
        ? ('Found ' + String(finalSchema.groups.length) + ' vocabulary group' + (finalSchema.groups.length === 1 ? '' : 's') + ' to review.')
        : 'The discovery passes did not find useful vocabulary additions.');
      render();
    }).catch(function (err) {
      schemaState.schemaStarting = false;
      schemaState.schemaJobId = '';
      if (schemaState.workStopRequested) {
        setStatus('Vocabulary discovery stopped.');
      } else {
        setStatus('Discover Vocabulary failed: ' + String(err && err.message ? err.message : err), true);
        reportConsoleError('Discover Vocabulary', err);
      }
      render();
    });
  }

  function stopWork() {
    schemaState.workStopRequested = true;
    schemaState.schemaRequestToken += 1;
    var jobs = [];
    if (schemaState.schemaJobId) jobs.push(cancelCaptionAssistJob(schemaState.schemaJobId));
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
        visionModel: schemaState.visionModel,
        files: schemaState.scopeFiles.slice()
      })
    }).then(function (payload) {
      schemaState.analysis = payload.analysis || null;
      render();
      return schemaState.analysis;
    });
  }

  function runVocabularySynthesis() {
    var director = currentDirectorModel();
    var folder = schemaState.folder;
    var visionModel = schemaState.visionModel;
    var groups = existingGroupsPayload();
    var token = schemaState.schemaRequestToken + 1;
    schemaState.schemaRequestToken = token;

    return requestJson('/fs/vision_schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'synthesize_vocabulary',
        folder: folder,
        visionModel: visionModel,
        directorModel: director,
        files: schemaState.scopeFiles.slice(),
        existingGroups: groups,
        captionTemplate: currentCaptionTemplate()
      })
    }).then(function (payload) {
      var jobId = String(payload.job && payload.job.jobId || '');
      if (!jobId) throw new Error('Vocabulary synthesis did not return a queued job.');
      schemaState.analysis = payload.analysis || schemaState.analysis;
      schemaState.schemaJobId = jobId;
      trackTransientLlmJob(payload.job);
      render();
      return waitForCaptionAssistJob(payload.job);
    }).then(function (job) {
      schemaState.schemaJobId = '';
      if (!job || token !== schemaState.schemaRequestToken) return null;
      var result = job.result && job.result.schema;
      if (!result || !Array.isArray(result.groups)) {
        throw new Error('Vocabulary synthesis completed without structured suggestions.');
      }
      return result;
    });
  }

  function runVocabularyChallenge(draftSchema) {
    var director = currentDirectorModel();
    var folder = schemaState.folder;
    var visionModel = schemaState.visionModel;
    var token = schemaState.schemaRequestToken + 1;
    schemaState.schemaRequestToken = token;

    return requestJson('/fs/vision_schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'challenge_vocabulary',
        folder: folder,
        visionModel: visionModel,
        directorModel: director,
        files: schemaState.scopeFiles.slice(),
        existingGroups: existingGroupsPayload(),
        captionTemplate: currentCaptionTemplate(),
        draftSchema: draftSchema
      })
    }).then(function (payload) {
      var jobId = String(payload.job && payload.job.jobId || '');
      if (!jobId) throw new Error('Vocabulary challenge did not return a queued job.');
      schemaState.analysis = payload.analysis || schemaState.analysis;
      schemaState.schemaJobId = jobId;
      trackTransientLlmJob(payload.job);
      render();
      return waitForCaptionAssistJob(payload.job);
    }).then(function (job) {
      schemaState.schemaJobId = '';
      if (!job || token !== schemaState.schemaRequestToken) return null;
      var result = job.result && job.result.schema;
      if (!result || !Array.isArray(result.groups)) {
        throw new Error('Vocabulary challenge completed without structured suggestions.');
      }
      return result;
    });
  }

  function runTagSuggestions() {
    if (schemaState.schemaStarting || schemaState.schemaJobId) return;
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
    schemaState.workStopRequested = false;
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
        captionTemplate: currentCaptionTemplate(),
        currentAssignments: currentAssignmentsPayload(files),
        existingOnly: !!schemaState.guidedLaunch
      })
    }).then(function (payload) {
      var jobId = String(payload.job && payload.job.jobId || '');
      if (!jobId) throw new Error('Vision Tag Assist did not return a queued job.');
      if (
        token !== schemaState.schemaRequestToken ||
        schemaState.workStopRequested ||
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
      if (schemaState.workStopRequested) {
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
        if (!group || !term || confidence !== 'high') return;
        var key = group.toLowerCase() + '\u0000' + term.toLowerCase();
        if (!byKey[key]) {
          byKey[key] = { group: group, term: term, highFiles: [] };
        }
        if (byKey[key].highFiles.indexOf(fileName) === -1) byKey[key].highFiles.push(fileName);
      });
    });
    return Object.keys(byKey).map(function (key) {
      return byKey[key];
    }).filter(function (step) {
      return step.highFiles.length;
    }).sort(function (a, b) {
      if (b.highFiles.length !== a.highFiles.length) return b.highFiles.length - a.highFiles.length;
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
    if (!step || !mediaGridIsOpen()) return;
    var selected = new Set();
    step.highFiles.forEach(function (fileName) {
      var item = findMediaItem(fileName);
      if (item && item.key) selected.add(item.key);
    });
    mediaGridReplaceSelection(Array.from(selected));
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
    if (!mediaGridIsOpen()) openMediaGridSurface();
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

  function applyGuidedTagPassTerm() {
    var step = getGuidedTagPassStep();
    if (!step || !mediaGridIsOpen()) return;
    var keys = mediaGridGetSelectedKeysSnapshot();
    if (!keys.length) {
      mediaGridSetStatus('Select at least one Grid item or Skip.');
      return;
    }
    if (!addGroupWorkbenchTermForMediaKeys(keys, step.group, step.term)) {
      throw new Error('Guided Tag Pass could not apply the current tag.');
    }
    advanceGuidedTagPass();
  }

  function skipGuidedTagPassStep() {
    if (!schemaState.guidedPass) return;
    advanceGuidedTagPass();
  }

  function exitGuidedTagPass(options) {
    var opts = options || {};
    var hadPass = !!schemaState.guidedPass;
    schemaState.guidedPass = null;
    if (mediaGridIsOpen()) mediaGridSetGuidedPresentation(false);
    if (hadPass && opts.keepGridOpen !== false && mediaGridIsOpen()) {
      mediaGridSetStatus(opts.completed ? 'Guided Tag Pass complete.' : 'Guided Tag Pass ended.');
      renderMediaGridSurface();
    }
  }

  function renderGuidedTagPassGridChrome() {
    var bar = el('media-grid-guided-pass');
    var progress = el('media-grid-guided-pass-progress');
    var label = el('media-grid-guided-pass-label');
    var launchBtn = el('media-grid-guided-pass-btn');
    var applyBtn = el('media-grid-guided-pass-apply-btn');
    if (!bar || !progress || !label || !launchBtn || !applyBtn) throw new Error('Guided Tag Pass Grid controls are missing.');
    var pass = schemaState.guidedPass;
    var step = getGuidedTagPassStep();
    var canLaunch = isSetFolderPath(state && state.folder);
    var active = !!pass && !!step;
    bar.classList.toggle('hidden', !active);
    launchBtn.classList.toggle('hidden', !!pass || !canLaunch);
    mediaGridSetGuidedPresentation(active);
    if (!active) return;
    var selectedCount = mediaGridGetSelectedKeysSnapshot().length;
    progress.textContent = String(pass.index + 1) + ' / ' + String(pass.steps.length);
    label.textContent = step.group + ' · ' + step.term + ' — ' + String(step.highFiles.length) + ' likely';
    applyBtn.disabled = selectedCount <= 0;
    applyBtn.textContent = 'Apply to ' + String(selectedCount);
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

  function advanceVocabularyReview(message) {
    var groups = schemaState.schema && Array.isArray(schemaState.schema.groups)
      ? schemaState.schema.groups
      : [];
    schemaState.reviewIndex += 1;
    if (!groups.length || schemaState.reviewIndex >= groups.length) {
      schemaState.schema = null;
      schemaState.reviewIndex = 0;
      schemaState.vocabularyComplete = true;
      setStatus((message ? message + ' ' : '') + 'Vocabulary review complete.');
      render();
      return;
    }
    setStatus(message || 'Ready for the next group.');
    render();
  }

  function skipCurrentVocabularyGroup() {
    if (!currentVocabularyGroup()) return;
    advanceVocabularyReview('Skipped group.');
  }

  function applySelected() {
    if (schemaState.vocabularyComplete && schemaState.mode === 'vocabulary') {
      close();
      openGuidedTagPass({ source: 'set' });
      return;
    }
    if (schemaState.mode === 'tags') {
      applySelectedTags();
      return;
    }
    var mutations = selectedProposalMutations();
    if (!mutations.length) {
      setStatus('Select at least one proposed term to add.', true);
      return;
    }
    var merged = mergeChecklistSchemaVocabulary(mutations);
    var addedGroups = Number(merged.addedGroups || 0);
    var addedTerms = Number(merged.addedTerms || 0);
    var message =
      'Added ' + String(addedTerms) + ' term' + (addedTerms === 1 ? '' : 's') +
      (addedGroups ? (' in ' + String(addedGroups) + ' new group' + (addedGroups === 1 ? '' : 's')) : '') + '.';
    advanceVocabularyReview(message);
  }

  function guidedScopeFiles(options) {
    var opts = options || {};
    if (opts.source === 'grid' && mediaGridIsOpen()) {
      return mediaGridGetVisibleFileNamesSnapshot();
    }
    if (opts.source === 'set') {
      return getCurrentSetMediaFileNames();
    }
    return getVisibleMediaSelectionForTraining();
  }

  function openGuidedTagPass(options) {
    var folder = currentFolder();
    var model = currentVisionModel();
    if (!folder) {
      window.setStatus('Open a Set before starting Guided Tag Pass.');
      return;
    }
    if (!model) {
      window.setStatus('Select a Vision model first.');
      return;
    }
    var files = guidedScopeFiles(options);
    if (!files.length) {
      window.setStatus('No visible media to review.');
      return;
    }
    schemaState.open = true;
    schemaState.folder = folder;
    schemaState.visionModel = model;
    schemaState.scopeFiles = files.slice();
    schemaState.workStopRequested = false;
    schemaState.schema = null;
    schemaState.reviewIndex = 0;
    schemaState.tagCandidates = null;
    schemaState.mode = 'tags';
    schemaState.analysis = null;
    schemaState.guidedLaunch = true;
    render();
    setStatus('Checking current Set intelligence…');
    refreshStatus().then(function (payload) {
      if (!schemaState.open || !schemaState.guidedLaunch) return null;
      var wanted = {};
      schemaState.scopeFiles.forEach(function (fileName) { wanted[fileName] = true; });
      var structured = (payload.items || []).filter(function (item) {
        return !!wanted[String(item.file || '')] && !!item.structured;
      }).length;
      if (!structured) {
        setStatus('Guided Tagging needs at least one usable Set Intelligence result for this Vision model.', true);
        return null;
      }
      return requestVocabularyStatus(
        folder,
        model,
        existingGroupsPayload(),
        currentCaptionTemplate()
      ).then(function (contextPayload) {
        return { structured: structured, contextPayload: contextPayload };
      });
    }).then(function (ready) {
      if (!ready || !schemaState.open || !schemaState.guidedLaunch) return;
      var wanted = {};
      schemaState.scopeFiles.forEach(function (fileName) { wanted[fileName] = true; });
      var contextAvailable = (ready.contextPayload.items || []).filter(function (item) {
        return !!wanted[String(item.file || '')] && !!item.available;
      }).length;
      if (!contextAvailable) {
        setStatus('Guided Tagging needs Context Sight from Set Intelligence. Run Set Intelligence first.', true);
        return;
      }
      setStatus(
        'Using two-pass Set intelligence for ' + String(Math.min(ready.structured, contextAvailable)) + ' of ' +
        String(schemaState.scopeFiles.length) + ' media. Building Guided Tag Pass…'
      );
      runTagSuggestions();
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
    schemaState.scopeFiles = getCurrentSetMediaFileNames();
    schemaState.workStopRequested = false;
    schemaState.schema = null;
    schemaState.reviewIndex = 0;
    schemaState.tagCandidates = null;
    schemaState.mode = 'vocabulary';
    schemaState.analysis = null;
    schemaState.vocabularyScanIndex = 0;
    schemaState.vocabularyScanTotal = 0;
    schemaState.vocabularyComplete = false;
    schemaState.guidedLaunch = false;
    render();
    setStatus('Loading current Set intelligence…');
    refreshStatus().then(function () {
      if (!schemaState.open || schemaState.guidedLaunch) return;
      runDiscovery();
    }).catch(function (err) {
      setStatus('Could not load Discover Vocabulary: ' + String(err && err.message ? err.message : err), true);
      reportConsoleError('Discover Vocabulary', err);
    });
  }

  function close() {
    if (schemaState.schemaStarting || schemaState.schemaJobId) stopWork();
    schemaState.open = false;
    schemaState.guidedLaunch = false;
    render();
  }

  function bind() {
    var openBtn = el('vision-schema-open-btn');
    var closeBtn = el('vision-schema-close-btn');
    var stopBtn = el('vision-schema-stop-btn');
    var skipBtn = el('vision-schema-skip-btn');
    var applyBtn = el('vision-schema-apply-btn');
    var modal = el('vision-schema-modal');
    if (!openBtn || !closeBtn || !stopBtn || !skipBtn || !applyBtn || !modal) {
      throw new Error('Schema Assist controls are missing.');
    }
    openBtn.onclick = open;
    closeBtn.onclick = close;
    stopBtn.onclick = stopWork;
    skipBtn.onclick = skipCurrentVocabularyGroup;
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
  window.applyGuidedTagPassTerm = applyGuidedTagPassTerm;
  window.skipGuidedTagPassStep = skipGuidedTagPassStep;
  window.exitGuidedTagPass = exitGuidedTagPass;
  window.renderGuidedTagPassGridChrome = renderGuidedTagPassGridChrome;
  window.syncGuidedTagPassWorkbenchHighlight = syncGuidedTagPassWorkbenchHighlight;
  window.handleGuidedTagPassGridTermMutation = handleGuidedTagPassGridTermMutation;
  bind();
})();
