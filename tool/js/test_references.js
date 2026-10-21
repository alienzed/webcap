(function () {
  'use strict';
  // These groups remain available, but are less likely to describe the Set's trained concept.
  var GENERIC_GROUPS = new Set(['viewpoint', 'position', 'hair', 'body', 'clothing', 'lighting', 'background']);
  var folder = '', runId = '', vocabulary = [], candidates = [], version = 0, selected = {}, positions = {};
  var loaded = false, pending = false, loadCounter = 0, runs = [], expandedOther = false;
  function el(name) { return document.getElementById('test-references-' + name); }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
  }); }
  function api(operation, criteria) {
    return fetch('/fs/epoch_finder', {method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({folder:folder, operation:operation, criteria:criteria || {}})})
      .then(function (response) { return response.json().then(function (json) {
        if (!response.ok || json.ok === false) throw new Error(json.error || 'Reference request failed.');
        return json;
      }); });
  }
  function report(error) {
    el('error').textContent = String(error.message || error);
    el('error').classList.remove('hidden');
    if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Training References', error);
    else console.error('[Training References]', error);
  }
  function resetError() { el('error').classList.add('hidden'); el('error').textContent = ''; }
  function mediaUrl(name) { return '/caption/media?folder=' + encodeURIComponent(folder) + '&media=' + encodeURIComponent(name); }
  function key(group, term) { return JSON.stringify([runId, group, term]); }
  function currentChoice() { return {group:currentGroup, term:currentTerm}; }
  var currentGroup = '', currentTerm = '';
  function groupTerms(groupName) {
    var group = vocabulary.find(function (entry) { return entry.group === groupName; });
    return group ? group.terms.filter(function (entry) { return Number(entry.count || 0) > 0; }) : [];
  }
  function prioritizedGroups() {
    return vocabulary.filter(function (entry) { return groupTerms(entry.group).length; }).sort(function (a, b) {
      return Number(GENERIC_GROUPS.has(a.group.trim().toLowerCase())) -
        Number(GENERIC_GROUPS.has(b.group.trim().toLowerCase()));
    });
  }
  function loadSelections() {
    var currentFolder = folder, token = ++loadCounter;
    loaded = false;
    return api('reference_selection_list').then(function (response) {
      if (folder !== currentFolder || token !== loadCounter) return;
      selected = {};
      (response.selections || []).forEach(function (item) {
        selected[JSON.stringify([item.runId, item.group, item.term])] = item;
      });
      loaded = true;
      drawGallery();
    }).catch(function (error) { if (folder === currentFolder && token === loadCounter) report(error); });
  }
  function changeSelection(operation, item, after) {
    if (!loaded || pending) { report(new Error(pending ? 'A reference save is still in progress. Try again when it completes.' : 'Training references have not loaded; selection was not saved.')); return; }
    pending = true;
    var saveFolder = folder, saveRun = runId, saveGroup = currentGroup, saveTerm = currentTerm;
    el('status').textContent = 'Saving reference…';
    resetError();
    api(operation, item).then(function () {
      if (saveFolder !== folder) return;
      if (operation === 'reference_selection_remove') delete selected[JSON.stringify([item.runId, item.group, item.term])];
      else selected[JSON.stringify([item.runId, item.group, item.term])] = item;
      drawGallery();
      if (saveRun === runId && saveGroup === currentGroup && saveTerm === currentTerm) {
        if (after) after();
        else el('status').textContent = operation === 'reference_selection_remove'
          ? 'Reference removed.' : 'Reference saved.';
      }
    }).catch(function (error) { if (saveFolder === folder) report(error); }).finally(function () { pending = false; });
  }
  function drawGroups() {
    var groups = prioritizedGroups();
    var concepts = groups.filter(function (group) { return !GENERIC_GROUPS.has(group.group.trim().toLowerCase()); });
    var other = groups.filter(function (group) { return GENERIC_GROUPS.has(group.group.trim().toLowerCase()); });
    function buttons(items) {
      return items.map(function (entry) {
        var chosen = groupTerms(entry.group).filter(function (term) { return selected[key(entry.group, term.term)]; }).length;
        var active = entry.group === currentGroup;
        var total = groupTerms(entry.group).length;
        return '<button type="button" class="test-references-group' + (active ? ' active' : '') +
          '" data-reference-group="' + esc(entry.group) + '" aria-pressed="' + active + '">' +
          '<span class="test-references-group-name">' + esc(entry.group) + '</span>' +
          '<span class="test-references-group-count">' + chosen + ' / ' + total + '</span>' +
          '<span class="test-references-group-track"><span style="width:' + Math.round(chosen / total * 100) + '%"></span></span></button>';
      }).join('');
    }
    el('groups').innerHTML = concepts.length ? buttons(concepts) : '';
    if (other.length) {
      if (concepts.length) {
        el('groups').innerHTML += '<button type="button" class="test-references-other-toggle" data-reference-other aria-expanded="' +
          expandedOther + '">Other groups (' + other.length + ') ' + (expandedOther ? '▴' : '▾') + '</button>';
        if (expandedOther || (currentGroup && GENERIC_GROUPS.has(currentGroup.trim().toLowerCase()))) {
          el('groups').innerHTML += buttons(other);
        }
      } else el('groups').innerHTML += buttons(other);
    }
  }
  function drawTags() {
    var choices = groupTerms(currentGroup);
    var position = choices.findIndex(function (entry) { return entry.term === currentTerm; });
    var chosen = choices.filter(function (entry) { return !!selected[key(currentGroup, entry.term)]; }).length;
    el('tag-progress').textContent = choices.length ? chosen + ' / ' + choices.length + ' chosen' : '';
    el('tags').innerHTML = choices.map(function (entry) {
      var active = entry.term === currentTerm, saved = !!selected[key(currentGroup, entry.term)];
      return '<button type="button" class="test-references-tag' + (active ? ' active' : '') +
        (saved ? ' chosen' : '') + '" data-reference-term="' + esc(entry.term) +
        '" aria-pressed="' + active + '"><span class="test-references-tag-name">' +
        (saved ? '✓ ' : '') + esc(entry.term) + '</span>' +
        '<small>' + Number(entry.count || 0) + ' images</small></button>';
    }).join('');
    el('previous').disabled = position <= 0;
    el('next').disabled = position < 0 || position >= choices.length - 1;
  }
  function drawSelections() {
    var keys = Object.keys(selected).filter(function (value) { return selected[value].runId === runId; });
    el('selected-count').textContent = keys.length + ' picked';
    el('selections').innerHTML = keys.length ? keys.map(function (value) {
      var item = selected[value];
      return '<div class="test-references-selection"><img loading="lazy" src="' + mediaUrl(item.media) + '" alt="">' +
        '<span><strong>' + esc(item.group + ' · ' + item.term) + '</strong><small>' + esc(item.media) + '</small></span>' +
        '<button type="button" data-remove-reference="' + esc(value) + '" aria-label="Clear ' + esc(item.term) + '">×</button></div>';
    }).join('') : 'Choose an example to use for its tag.';
  }
  function drawGallery() {
    var chosen = selected[key(currentGroup, currentTerm)];
    var terms = groupTerms(currentGroup);
    var covered = terms.filter(function (item) { return selected[key(currentGroup, item.term)]; }).length;
    el('active-heading').textContent = currentGroup && currentTerm
      ? currentGroup + ' · ' + currentTerm : 'Choose an annotation tag';
    el('active-chosen').classList.toggle('hidden', !chosen);
    el('coverage-label').textContent = terms.length ? covered + ' of ' + terms.length + ' tags covered' : 'Choose a group to begin';
    el('progress').setAttribute('aria-valuemax', String(terms.length));
    el('progress').setAttribute('aria-valuenow', String(covered));
    el('progress-fill').style.width = (terms.length ? Math.round(covered / terms.length * 100) : 0) + '%';
    el('count').textContent = candidates.length + ' matching images';
    el('status').textContent = candidates.length
      ? (chosen ? 'Reference saved for this tag. Choose another image to replace it, or continue.' :
         'Pick the strongest example for this tag; preview any image first.')
      : (runId && currentGroup && currentTerm ? 'No images carry this exact tag in this training run.' : 'Choose a group and tag to browse exact matches.');
    el('gallery').innerHTML = candidates.map(function (candidate, i) {
      var active = chosen && chosen.media === candidate.media;
      return '<div class="epoch-finder-reference-tile' + (active ? ' selected' : '') + '">' +
        '<img loading="lazy" src="' + mediaUrl(candidate.media) + '" alt="' + esc(candidate.media) + '">' +
        '<span class="test-references-filename" title="' + esc(candidate.media) + '">' + esc(candidate.media) + '</span>' +
        '<div class="epoch-finder-reference-tile-actions">' +
        '<button type="button" data-select-reference="' + i + '" aria-pressed="' + !!active + '">' +
        (active ? '✓ Chosen' : 'Choose this') + '</button>' +
        '<button type="button" data-preview-reference="' + i + '">Preview</button></div></div>';
    }).join('');
    drawSelections();
    drawGroups();
    drawTags();
  }
  function loadCandidates() {
    var choice = currentChoice(), token = ++version, currentFolder = folder, currentRun = runId;
    candidates = [];
    drawGallery();
    if (!runId || !choice.group || !choice.term) return;
    el('status').textContent = 'Finding exact-tag training images…';
    api('reference_candidates', {jobId:runId,group:choice.group,term:choice.term}).then(function (response) {
      if (token !== version || folder !== currentFolder || runId !== currentRun) return;
      candidates = response.references || [];
      drawGallery();
    }).catch(function (error) { if (token === version && currentFolder === folder) report(error); });
  }
  function showTerm(term) {
    currentTerm = term;
    positions[runId + '/' + currentGroup] = term;
    loadCandidates();
  }
  function showGroup(group) {
    currentGroup = group;
    var choices = groupTerms(group), saved = positions[runId + '/' + group];
    var firstOpen = choices.find(function (entry) { return !selected[key(group, entry.term)]; });
    currentTerm = choices.some(function (entry) { return entry.term === saved; }) ? saved :
      (firstOpen || choices[0] || {}).term || '';
    loadCandidates();
  }
  function advanceAfterPick() {
    var choices = groupTerms(currentGroup);
    var index = choices.findIndex(function (entry) { return entry.term === currentTerm; });
    for (var step = 1; step < choices.length; step++) {
      var item = choices[(index + step) % choices.length];
      if (!selected[key(currentGroup, item.term)]) { showTerm(item.term); return; }
    }
    el('status').textContent = 'Group complete! Every observed tag in this group has a chosen reference.';
  }
  function advance(step) {
    var choices = groupTerms(currentGroup), index = choices.findIndex(function (entry) { return entry.term === currentTerm; });
    var next = index + step;
    if (next >= 0 && next < choices.length) showTerm(choices[next].term);
    else el('status').textContent = step > 0 ? 'End of this group. Choose another group.' : 'Already at the first tag.';
  }
  function loadVocabulary() {
    runId = el('run').value;
    var token = ++version, currentFolder = folder, currentRun = runId;
    vocabulary = []; candidates = []; currentGroup = ''; currentTerm = ''; expandedOther = false;
    drawGallery();
    if (!runId) return;
    el('status').textContent = 'Loading trained Set annotations…';
    api('reference_vocabulary', {jobId:runId}).then(function (response) {
      if (token !== version || folder !== currentFolder || runId !== currentRun) return;
      vocabulary = response.vocabulary || [];
      var groups = prioritizedGroups();
      var preferred = groups.find(function (entry) {
        return groupTerms(entry.group).some(function (term) { return !selected[key(entry.group, term.term)]; });
      }) || groups[0];
      if (preferred) showGroup(preferred.group);
      else {
        drawGallery();
        el('status').textContent = 'No trained images have scoped Set annotations.';
      }
    }).catch(function (error) { if (token === version && folder === currentFolder) report(error); });
  }
  function refresh() {
    var token = ++version, currentFolder = folder;
    var previous = el('run').value || runId;
    resetError();
    el('status').textContent = 'Discovering training runs…';
    api('reference_runs').then(function (response) {
      if (token !== version || folder !== currentFolder) return;
      runs = response.runs || [];
      el('run').innerHTML = runs.map(function (run) {
        var title = [run.setName, run.runName || ('Run ' + (run.runSequence || run.jobId)), run.modelId].filter(Boolean).join(' · ');
        return '<option value="' + esc(run.jobId) + '">' + esc(title) + '</option>';
      }).join('');
      var found = runs.some(function (run) { return String(run.jobId) === previous; });
      el('run').value = found ? previous : (runs[0] ? runs[0].jobId : '');
      el('run-status').textContent = found ? 'Using your selected run.' :
        (runs.length ? 'Default: most recent available run. Change it above if needed.' : 'No training runs available for this Set.');
      if (el('run').value) loadVocabulary();
      else { runId = ''; candidates = []; vocabulary = []; currentGroup = ''; currentTerm = ''; drawGallery(); }
    }).catch(function (error) { if (token === version && folder === currentFolder) report(error); });
  }
  window.testReferencesPrepare = function (nextFolder) {
    if (folder === nextFolder) return;
    folder = nextFolder; runId = ''; selected = {}; positions = {}; loaded = false; version++; loadCounter++;
    runs = []; vocabulary = []; candidates = []; currentGroup = ''; currentTerm = ''; expandedOther = false;
    el('run').innerHTML = '<option value="">Loading runs…</option>';
    el('run-status').textContent = '';
    drawGallery(); resetError();
    if (folder) loadSelections();
  };
  window.testReferencesOpen = function () { if (!loaded) loadSelections(); refresh(); };
  window.testReferencesSelections = function (setFolder) {
    if (String(setFolder) !== String(folder) || !loaded) return [];
    return Object.keys(selected).map(function (id) { return Object.assign({}, selected[id]); });
  };
  window.testReferencesChoice = function (jobId, group, term) {
    return selected[JSON.stringify([String(jobId), String(group), String(term)])] || null;
  };
  el('refresh').onclick = refresh;
  el('run').onchange = function () { el('run-status').textContent = 'Manually selected run.'; loadVocabulary(); };
  el('groups').onclick = function (event) {
    var other = event.target.closest('[data-reference-other]');
    if (other) { expandedOther = !expandedOther; drawGroups(); return; }
    var button = event.target.closest('[data-reference-group]');
    if (button) showGroup(button.dataset.referenceGroup);
  };
  el('tags').onclick = function (event) {
    var button = event.target.closest('[data-reference-term]');
    if (button) showTerm(button.dataset.referenceTerm);
  };
  el('previous').onclick = function () { advance(-1); };
  el('next').onclick = function () { advance(1); };
  el('gallery').onclick = function (event) {
    var pick = event.target.closest('[data-select-reference]');
    var preview = event.target.closest('[data-preview-reference]');
    if (!pick && !preview) return;
    var index = Number(pick ? pick.dataset.selectReference : preview.dataset.previewReference);
    var candidate = candidates[index];
    if (!candidate) throw new Error('Reference candidate no longer exists.');
    if (pick) {
      var choice = currentChoice();
      changeSelection('reference_selection_save', {runId:runId,group:choice.group,term:choice.term,media:candidate.media},
        advanceAfterPick);
    } else {
      el('preview-image').src = mediaUrl(candidate.media);
      el('preview-image').alt = candidate.media;
      el('preview-caption').textContent = candidate.media + ' · ' + candidate.group + ': ' + candidate.term;
      el('preview-original').href = mediaUrl(candidate.media);
      el('preview').showModal();
    }
  };
  el('selections').onclick = function (event) {
    var button = event.target.closest('[data-remove-reference]');
    if (!button) return;
    var item = selected[button.dataset.removeReference];
    if (item) changeSelection('reference_selection_remove', item);
  };
})();
