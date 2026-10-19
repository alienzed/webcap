(function () {
  'use strict';
  var folder = '', runId = '', vocabulary = [], candidates = [], version = 0, selected = {}, positions = {};
  var loaded = false, pending = false, loadCounter = 0;
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
    if (!loaded || pending) return;
    pending = true;
    resetError();
    api(operation, item).then(function () {
      if (operation === 'reference_selection_remove') delete selected[JSON.stringify([item.runId, item.group, item.term])];
      else selected[JSON.stringify([item.runId, item.group, item.term])] = item;
      drawGallery();
      if (after) after();
    }).catch(report).finally(function () { pending = false; });
  }
  function mediaUrl(name) { return '/caption/media?folder=' + encodeURIComponent(folder) + '&media=' + encodeURIComponent(name); }
  function key(group, term) { return JSON.stringify([runId, group, term]); }
  function currentChoice() { return {group:el('group').value, term:el('option').value}; }
  function terms() {
    var group = vocabulary.find(function (entry) { return entry.group === el('group').value; });
    return group ? group.terms.filter(function (entry) { return Number(entry.count || 0) > 0; }) : [];
  }
  function showTerm(term) {
    el('option').value = term;
    positions[runId + '/' + el('group').value] = term;
    loadCandidates();
  }
  function advance(step) {
    var choices = terms(), current = el('option').value;
    if (!choices.length) return;
    var index = choices.findIndex(function (entry) { return entry.term === current; });
    var next = index + step;
    if (next >= 0 && next < choices.length) showTerm(choices[next].term);
    else { el('status').textContent = step > 0 ? 'End of this group. Choose another tag or group.' : 'Already at the first tag.'; }
  }
  function drawTags() {
    var choices = terms(), current = currentChoice(), position = choices.findIndex(function (entry) { return entry.term === current.term; });
    el('tag-progress').textContent = choices.length ? (position + 1) + ' / ' + choices.length + ' tags · ' +
      choices.filter(function (entry) { return !!selected[key(current.group, entry.term)]; }).length + ' chosen' : '';
    el('tags').innerHTML = choices.map(function (entry) {
      var active = entry.term === current.term, chosen = !!selected[key(current.group, entry.term)];
      return '<button type="button" class="test-references-tag' + (active ? ' active' : '') +
        (chosen ? ' chosen' : '') + '" data-reference-term="' + esc(entry.term) +
        '" aria-pressed="' + active + '">' + (chosen ? '✓ ' : '') + esc(entry.term) +
        ' <small>' + Number(entry.count || 0) + '</small></button>';
    }).join('');
    el('previous').disabled = position <= 0;
    el('next').disabled = position < 0 || position >= choices.length - 1;
    el('skip').disabled = position < 0 || position >= choices.length - 1;
  }
  function drawSelections() {
    var keys = Object.keys(selected).filter(function (value) { return selected[value].runId === runId; });
    el('selected-count').textContent = keys.length + ' chosen';
    el('selections').innerHTML = keys.length ? keys.map(function (value) {
      var item = selected[value];
      return '<div class="test-references-selection"><img src="' + mediaUrl(item.media) + '" alt="">' +
        '<span><strong>' + esc(item.group + ' · ' + item.term) + '</strong><small>' + esc(item.media) + '</small></span>' +
        '<button type="button" data-remove-reference="' + esc(value) + '" aria-label="Clear ' + esc(item.term) + '">×</button></div>';
    }).join('') : 'Choose an example to use for its tag.';
  }
  function drawGallery() {
    var choice = currentChoice(), chosen = selected[key(choice.group, choice.term)];
    el('count').textContent = candidates.length + ' images';
    el('status').textContent = candidates.length ? 'Select a representative full image, or preview it at a larger size.' :
      (runId && choice.group && choice.term ? 'No images carry this exact tag in this training run.' : 'Choose a run, group and tag to browse.');
    el('gallery').innerHTML = candidates.map(function (candidate, i) {
      var active = chosen && chosen.media === candidate.media;
      return '<div class="epoch-finder-reference-tile' + (active ? ' selected' : '') + '">' +
        '<img loading="lazy" src="' + mediaUrl(candidate.media) + '" alt="' + esc(candidate.media) + '">' +
        '<span title="' + esc(candidate.media) + '">' + esc(candidate.media) + '</span>' +
        '<div class="epoch-finder-reference-tile-actions">' +
        '<button type="button" data-select-reference="' + i + '" aria-pressed="' + !!active + '">' +
        (active ? '✓ Selected' : 'Select') + '</button>' +
        '<button type="button" data-preview-reference="' + i + '">Preview</button></div></div>';
    }).join('');
    drawSelections();
    drawTags();
  }
  function loadCandidates() {
    var choice = currentChoice(), token = ++version, currentFolder = folder, currentRun = runId;
    candidates = []; drawGallery();
    if (!runId || !choice.group || !choice.term) return;
    el('status').textContent = 'Finding exact-tag training images…';
    api('reference_candidates', {jobId:runId,group:choice.group,term:choice.term}).then(function (response) {
      if (token !== version || folder !== currentFolder || runId !== currentRun) return;
      candidates = response.references || [];
      var chosen = selected[key(choice.group, choice.term)];
      // Missing candidates retain their saved choice until the user explicitly clears it.
      drawGallery();
    }).catch(function (error) { if (token === version) report(error); });
  }
  function loadOptions() {
    var group = vocabulary.find(function (entry) { return entry.group === el('group').value; });
    el('option').innerHTML = '<option value="">Choose tagged option…</option>' +
      (group ? group.terms : []).map(function (entry) {
        return '<option value="' + esc(entry.term) + '">' + esc(entry.term) + ' (' + Number(entry.count || 0) + ')</option>';
      }).join('');
    el('option').disabled = !group;
    var choices = terms(), saved = positions[runId + '/' + el('group').value];
    var firstOpen = choices.find(function (entry) { return !selected[key(el('group').value, entry.term)]; });
    el('option').value = choices.some(function (entry) { return entry.term === saved; }) ? saved :
      (firstOpen || choices[0] || {}).term || '';
    loadCandidates();
  }
  function loadVocabulary() {
    runId = el('run').value;
    var token = ++version, currentFolder = folder, currentRun = runId;
    vocabulary = []; candidates = [];
    el('group').disabled = true;
    el('group').innerHTML = '<option value="">Choose annotation group…</option>';
    el('option').disabled = true;
    el('option').innerHTML = '<option value="">Choose tagged option…</option>';
    drawGallery();
    if (!runId) return;
    el('status').textContent = 'Loading trained Set annotations…';
    api('reference_vocabulary', {jobId:runId}).then(function (response) {
      if (token !== version || folder !== currentFolder || runId !== currentRun) return;
      vocabulary = response.vocabulary || [];
      el('group').innerHTML = '<option value="">Choose annotation group…</option>' + vocabulary.map(function (entry) {
        return '<option value="' + esc(entry.group) + '">' + esc(entry.group) + '</option>';
      }).join('');
      el('group').disabled = !vocabulary.length;
      el('status').textContent = vocabulary.length ?
        vocabulary.length + ' annotated groups available for this training run.' : 'No trained images have scoped Set annotations.';
    }).catch(function (error) { if (token === version) report(error); });
  }
  function refresh() {
    var token = ++version, currentFolder = folder;
    var previous = el('run').value;
    resetError();
    el('status').textContent = 'Discovering training runs…';
    api('reference_runs').then(function (response) {
      if (token !== version || folder !== currentFolder) return;
      var runs = response.runs || [];
      el('run').innerHTML = '<option value="">Choose source training run…</option>' + runs.map(function (run) {
        var title = [run.setName, run.runName || ('Run ' + (run.runSequence || run.jobId)), run.modelId].filter(Boolean).join(' · ');
        return '<option value="' + esc(run.jobId) + '">' + esc(title) + '</option>';
      }).join('');
      if (runs.some(function (run) { return String(run.jobId) === previous; })) el('run').value = previous;
      if (el('run').value) loadVocabulary();
      else { runId = ''; candidates = []; vocabulary = []; drawGallery();
        el('status').textContent = runs.length ? 'Select a source training run.' : 'No training runs found for this Set.'; }
    }).catch(function (error) { if (token === version) report(error); });
  }
  window.testReferencesPrepare = function (nextFolder) {
    if (folder === nextFolder) return;
    folder = nextFolder; runId = ''; selected = {}; positions = {}; loaded = false; version++; loadCounter++;
    el('run').innerHTML = '<option value="">Choose source training run…</option>';
    el('group').innerHTML = '<option value="">Select a run first</option>';
    el('option').innerHTML = '<option value="">Select a group first</option>';
    el('group').disabled = true; el('option').disabled = true;
    candidates = []; vocabulary = []; drawGallery(); resetError();
    if (folder) loadSelections();
  };
  window.testReferencesOpen = function () { if (!loaded) loadSelections(); refresh(); };
  // Read-only snapshot for evaluators; source of truth stays in this workspace.
  window.testReferencesSelections = function (setFolder) {
    if (String(setFolder) !== String(folder) || !loaded) return [];
    return Object.keys(selected).map(function (id) {
      return Object.assign({}, selected[id]);
    });
  };
  window.testReferencesChoice = function (jobId, group, term) {
    return selected[JSON.stringify([String(jobId), String(group), String(term)])] || null;
  };
  el('refresh').onclick = refresh;
  el('run').onchange = loadVocabulary;
  el('group').onchange = loadOptions;
  el('option').onchange = function () {
    positions[runId + '/' + el('group').value] = el('option').value;
    loadCandidates();
  };
  el('previous').onclick = function () { advance(-1); };
  el('next').onclick = el('skip').onclick = function () { advance(1); };
  el('tags').onclick = function (event) {
    var button = event.target.closest('[data-reference-term]');
    if (button) showTerm(button.dataset.referenceTerm);
  };
  el('gallery').onclick = function (event) {
    var pick = event.target.closest('[data-select-reference]');
    var preview = event.target.closest('[data-preview-reference]');
    var button = pick || preview;
    if (!button) return;
    var index = Number(pick ? pick.dataset.selectReference : preview.dataset.previewReference);
    var candidate = candidates[index];
    if (!candidate) throw new Error('Reference candidate no longer exists.');
    if (pick) {
      var choice = currentChoice();
      changeSelection('reference_selection_save', {runId:runId,group:choice.group,term:choice.term,media:candidate.media}, function () { advance(1); });
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
