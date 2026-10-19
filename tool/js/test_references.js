(function () {
  'use strict';
  var folder = '', runId = '', vocabulary = [], candidates = [], version = 0, selected = {};
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
  function currentChoice() { return {group:el('group').value, term:el('option').value}; }
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
      if (chosen && !candidates.some(function (item) { return item.media === chosen.media; })) {
        delete selected[key(choice.group, choice.term)];
      }
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
    folder = nextFolder; runId = ''; selected = {}; version++;
    el('run').innerHTML = '<option value="">Choose source training run…</option>';
    el('group').innerHTML = '<option value="">Select a run first</option>';
    el('option').innerHTML = '<option value="">Select a group first</option>';
    el('group').disabled = true; el('option').disabled = true;
    candidates = []; vocabulary = []; drawGallery(); resetError();
  };
  window.testReferencesOpen = refresh;
  window.testReferencesChoice = function (jobId, group, term) {
    return selected[JSON.stringify([String(jobId), String(group), String(term)])] || null;
  };
  el('refresh').onclick = refresh;
  el('run').onchange = loadVocabulary;
  el('group').onchange = loadOptions;
  el('option').onchange = loadCandidates;
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
      selected[key(choice.group, choice.term)] = {runId:runId,group:choice.group,term:choice.term,media:candidate.media};
      drawGallery();
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
    delete selected[button.dataset.removeReference];
    drawGallery();
  };
})();
